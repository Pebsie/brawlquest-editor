// A small in-memory stand-in for the parts of api.github.com the editor uses
// (repo, branches, refs, commits, trees, blobs, compare, commits?path=), for
// Playwright's page.route. Real git blob ids, so "skip unchanged files" is
// exercised. Nothing here talks to GitHub.
import crypto from "crypto";
const REPO = "/repos/BrawlQuest/brawlquest-content";
export function mockGitHub({ token = "github_pat_TESTTOKEN_123", files = {} } = {}) {
  const blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map();
  const log = [];
  let clock = Date.parse("2026-10-20T10:00:00Z");
  const sha1 = b => crypto.createHash("sha1").update(b).digest("hex");
  const putBlob = buf => { const b = Buffer.from(buf); const s = sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])); blobs.set(s, b); return s; };
  const putTree = map => { const entries = Object.keys(map).sort().map(p => ({ path: p, mode: "100644", type: "blob", sha: map[p] })); const s = sha1("tree" + JSON.stringify(entries)); trees.set(s, map); return s; };
  const putCommit = (tree, parents, message, author = "Pebsie") => { clock += 60e3; const date = new Date(clock).toISOString(); const s = sha1(JSON.stringify({ tree, parents, message, date })); commits.set(s, { tree, parents, message, date, author }); return s; };
  const ancestors = s => { const out = new Set(), st = [s]; while (st.length) { const c = st.pop(); if (!c || out.has(c)) continue; out.add(c); st.push(...commits.get(c).parents); } return out; };
  const fileAt = (c, p) => trees.get(commits.get(c).tree)[p];
  // seed
  const seed = {};
  for (const [p, b] of Object.entries(files)) seed[p] = putBlob(b);
  const root = putCommit(putTree(seed), [], "Add current bq-content.db as baseline");
  refs.set("main", root);

  // Test helper: commit straight to a branch as "someone else".
  function external(branch, changes, message) {
    const parent = refs.get(branch); const map = { ...trees.get(commits.get(parent).tree) };
    for (const [p, b] of Object.entries(changes)) map[p] = putBlob(b);
    const s = putCommit(putTree(map), [parent], message, "someone-else"); refs.set(branch, s); return s;
  }
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json; charset=utf-8", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  const commitJSON = s => ({ sha: s, tree: { sha: commits.get(s).tree }, message: commits.get(s).message, parents: commits.get(s).parents.map(p => ({ sha: p })), committer: { date: commits.get(s).date }, author: { name: commits.get(s).author } });

  async function handler(route) {
    const req = route.request(), u = new URL(req.url()), m = req.method(), path = u.pathname;
    const auth = req.headers()["authorization"];
    let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    log.push({ m, path: path + u.search, auth, body: m === "POST" && path.endsWith("/git/blobs") ? { encoding: body.encoding, length: body.content.length } : body });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (auth !== "Bearer " + token) return json(route, 401, { message: "Bad credentials" });
    let x;
    if (m === "GET" && path === REPO) return json(route, 200, { full_name: "BrawlQuest/brawlquest-content", private: true, default_branch: "main", permissions: { pull: true, push: true } });
    if (m === "GET" && path === "/user") return json(route, 200, { login: "Pebsie" });
    if (m === "GET" && path === REPO + "/branches") return json(route, 200, [...refs.keys()].map(name => ({ name, commit: { sha: refs.get(name) } })));
    if ((x = path.match(/\/git\/ref\/heads\/(.+)$/)) && m === "GET") { const b = decodeURIComponent(x[1]); return refs.has(b) ? json(route, 200, { ref: "refs/heads/" + b, object: { sha: refs.get(b), type: "commit" } }) : json(route, 404, { message: "Not Found" }); }
    if ((x = path.match(/\/git\/commits\/([0-9a-f]{40})$/)) && m === "GET") return commits.has(x[1]) ? json(route, 200, commitJSON(x[1])) : json(route, 404, { message: "Not Found" });
    if ((x = path.match(/\/git\/trees\/([0-9a-f]{40})$/)) && m === "GET") {
      const map = trees.get(x[1]); if (!map) return json(route, 404, { message: "Not Found" });
      const entries = Object.keys(map).sort().map(p => ({ path: p, mode: "100644", type: "blob", sha: map[p], size: blobs.get(map[p]).length }));
      const dirs = [...new Set(Object.keys(map).filter(p => p.includes("/")).map(p => p.split("/")[0]))].map(d => ({ path: d, mode: "040000", type: "tree", sha: sha1(d) }));
      return json(route, 200, { sha: x[1], tree: u.searchParams.get("recursive") ? [...dirs, ...entries] : [...dirs, ...entries.filter(e => !e.path.includes("/"))], truncated: false });
    }
    if ((x = path.match(/\/git\/blobs\/([0-9a-f]{40})$/)) && m === "GET") {
      const b = blobs.get(x[1]); if (!b) return json(route, 404, { message: "Not Found" });
      if (/raw/.test(req.headers()["accept"] || "")) return route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "access-control-allow-origin": "*" }, body: b });
      return json(route, 200, { sha: x[1], encoding: "base64", content: b.toString("base64"), size: b.length });
    }
    if (m === "POST" && path === REPO + "/git/blobs") { const s = putBlob(Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8")); return json(route, 201, { sha: s }); }
    if (m === "POST" && path === REPO + "/git/trees") {
      const map = { ...(body.base_tree ? trees.get(body.base_tree) : {}) };
      for (const e of body.tree) { if (e.sha === null) delete map[e.path]; else { if (!blobs.has(e.sha)) return json(route, 422, { message: "bad sha" }); map[e.path] = e.sha; } }
      return json(route, 201, { sha: putTree(map) });
    }
    if (m === "POST" && path === REPO + "/git/commits") { if (!trees.has(body.tree) || body.parents.some(p => !commits.has(p))) return json(route, 422, { message: "bad tree or parent" }); return json(route, 201, commitJSON(putCommit(body.tree, body.parents, body.message))); }
    if ((x = path.match(/\/git\/refs\/heads\/(.+)$/)) && m === "PATCH") {
      const b = decodeURIComponent(x[1]);
      if (!refs.has(b)) return json(route, 422, { message: "Reference does not exist" });
      if (body.force) return json(route, 400, { message: "the mock refuses force" });
      if (!ancestors(body.sha).has(refs.get(b))) return json(route, 422, { message: "Update is not a fast forward" });
      refs.set(b, body.sha); return json(route, 200, { ref: "refs/heads/" + b, object: { sha: body.sha } });
    }
    if (m === "POST" && path === REPO + "/git/refs") {
      const b = body.ref.replace(/^refs\/heads\//, "");
      if (refs.has(b)) return json(route, 422, { message: "Reference already exists" });
      refs.set(b, body.sha); return json(route, 201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (m === "GET" && path === REPO + "/commits") {
      const p = u.searchParams.get("path"); let c = refs.get(u.searchParams.get("sha") || "main"); const out = [];
      while (c) { const cm = commits.get(c), par = cm.parents[0]; if (!p || !par || fileAt(c, p) !== fileAt(par, p)) out.push({ sha: c, commit: { message: cm.message, committer: { date: cm.date }, author: { name: cm.author } }, author: { login: cm.author } }); c = par; }
      return json(route, 200, out.slice(0, +u.searchParams.get("per_page") || 30));
    }
    if ((x = path.match(/\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/)) && m === "GET") {
      const [, a, bb] = x; const anc = ancestors(a); const list = []; let c = bb;
      while (c && !anc.has(c)) { list.unshift(c); c = commits.get(c).parents[0]; }
      const A = trees.get(commits.get(a).tree), B = trees.get(commits.get(bb).tree);
      const changed = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(p => A[p] !== B[p]).map(f => ({ filename: f, status: "modified" }));
      return json(route, 200, { status: list.length ? "ahead" : "identical", commits: list.map(s => ({ sha: s, commit: { message: commits.get(s).message, committer: { date: commits.get(s).date }, author: { name: commits.get(s).author } }, author: { login: commits.get(s).author } })), files: changed });
    }
    return json(route, 404, { message: "mock: no route for " + m + " " + path });
  }
  return { handler, log, refs, commits, trees, blobs, external, root, fileAt, token, blob: s => blobs.get(s) };
}
