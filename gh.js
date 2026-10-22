"use strict";
// GitHub sync for BrawlQuest/brawlquest-content through the Git Data API
// (blobs, trees, commits, refs), which takes the 8 MB db comfortably.
// The token lives in this browser's localStorage only and is sent to
// https://api.github.com and nowhere else. It is never logged or put in an
// error message.
const BQGitHub = (() => {
  const API = "https://api.github.com";
  const REPO = "BrawlQuest/brawlquest-content", FILE = "bq-content.db", DUMP_DIR = "content/";
  const KEY = "bqGitHubToken";
  const token = () => localStorage.getItem(KEY) || "";
  const connected = () => !!token();
  function setToken(t) { localStorage.setItem(KEY, t); }
  function disconnect() { localStorage.removeItem(KEY); }

  class GitHubError extends Error {
    constructor(msg, status, data) { super(msg); this.status = status; this.data = data; }
  }
  async function call(method, path, body, o = {}) {
    const t = o.token || token();
    if (!t) throw new GitHubError("Not connected to GitHub", 401);
    const headers = { Accept: o.accept || "application/vnd.github+json", Authorization: "Bearer " + t };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let r;
    try { r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" }); }
    catch (e) { throw new GitHubError("Could not reach api.github.com (offline?)", 0); }
    if (o.raw && r.ok) return new Uint8Array(await r.arrayBuffer());
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) {
      const m = (data && data.message) || r.statusText || "error";
      const hint = r.status === 401 ? " (the token is wrong or expired: connect again)"
        : r.status === 403 ? " (the token can't do this: it needs Contents read and write on " + REPO + ")"
        : r.status === 404 ? " (not found, or the token can't see " + REPO + ")" : "";
      throw new GitHubError(`GitHub ${method} ${path.replace(/\?.*/, "")}: ${r.status} ${m}${hint}`, r.status, data);
    }
    return data;
  }
  const R = p => `/repos/${REPO}${p}`;
  const enc = s => s.split("/").map(encodeURIComponent).join("/");

  // Check a token before keeping it. Returns { login, push }.
  async function check(t) {
    const repo = await call("GET", R(""), undefined, { token: t });
    let login = "";
    try { login = (await call("GET", "/user", undefined, { token: t })).login; } catch { /* fine-grained tokens may not read /user */ }
    return { login, push: !!(repo.permissions && repo.permissions.push), branch: repo.default_branch || "main", private: repo.private };
  }
  const branches = async () => (await call("GET", R("/branches?per_page=100"))).map(b => b.name);
  async function head(branch) { return (await call("GET", R("/git/ref/heads/" + enc(branch)))).object.sha; }
  async function treeOf(commit) {
    const c = await call("GET", R("/git/commits/" + commit));
    const t = await call("GET", R("/git/trees/" + c.tree.sha + "?recursive=1"));
    const files = {};
    for (const e of t.tree) if (e.type === "blob") files[e.path] = e.sha;
    return { commit: c, tree: c.tree.sha, files, truncated: !!t.truncated };
  }
  async function blob(sha) {
    const b = await call("GET", R("/git/blobs/" + sha), undefined, { accept: "application/vnd.github.raw+json", raw: true });
    return b;
  }
  // The db at a commit (default: the head of branch).
  async function load({ branch = "main", commit } = {}) {
    const sha = commit || await head(branch);
    const t = await treeOf(sha);
    if (!t.files[FILE]) throw new GitHubError(`${FILE} is not in ${REPO} at ${sha.slice(0, 7)}`, 404);
    const bytes = await blob(t.files[FILE]);
    return { bytes, base: { branch, commit: sha, blob: t.files[FILE], message: t.commit.message, date: t.commit.committer && t.commit.committer.date } };
  }
  async function history(branch = "main", n = 30) {
    const list = await call("GET", R(`/commits?sha=${encodeURIComponent(branch)}&path=${FILE}&per_page=${n}`));
    return list.map(c => ({ sha: c.sha, message: c.commit.message, date: c.commit.committer.date, author: (c.author && c.author.login) || c.commit.author.name }));
  }
  // Commits on branch since base that changed the db: [] when only other
  // files moved (safe to commit on top).
  async function moved(base, headSha) {
    const c = await call("GET", R(`/compare/${base}...${headSha}`));
    const touched = (c.files || []).some(f => f.filename === FILE || f.previous_filename === FILE);
    return { touched: touched || (c.files || []).length >= 300, commits: (c.commits || []).map(x => ({ sha: x.sha, message: x.commit.message, date: x.commit.committer.date, author: (x.author && x.author.login) || x.commit.author.name })), status: c.status };
  }

  // git's blob id, to skip uploading files that have not changed.
  async function gitSha(bytes) {
    if (!(window.crypto && crypto.subtle)) return "";
    const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length); all.set(head); all.set(bytes, head.length);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
    return [...h].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function base64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // Commit bytes (the db) and dump files [{path, text}] on top of parent.
  // ref: "update" moves branch (fast-forward only, never forced), "create"
  // makes branch at the new commit. Returns { sha, nothing, uploaded }.
  async function commit({ bytes, dump, message, parent, branch, ref = "update", progress = () => {} }) {
    progress("Reading " + parent.slice(0, 7) + "…");
    const t = await treeOf(parent);
    const files = [{ path: FILE, bytes }, ...dump.map(f => ({ path: f.path, bytes: new TextEncoder().encode(f.text) }))];
    const entries = [];
    let uploaded = 0;
    for (const f of files) {
      const sha = await gitSha(f.bytes);
      if (sha && t.files[f.path] === sha) continue;
      progress(`Uploading ${f.path} (${Math.round(f.bytes.length / 1024)} KB)…`);
      const b = await call("POST", R("/git/blobs"), { content: base64(f.bytes), encoding: "base64" });
      entries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
      uploaded++;
    }
    const keep = new Set(files.map(f => f.path));
    for (const p of Object.keys(t.files)) if (p.startsWith(DUMP_DIR) && p.endsWith(".sql") && !keep.has(p)) entries.push({ path: p, mode: "100644", type: "blob", sha: null });
    if (!entries.length && ref === "update") return { sha: parent, nothing: true, uploaded: 0 };
    progress("Writing the commit…");
    const tree = entries.length ? (await call("POST", R("/git/trees"), { base_tree: t.tree, tree: entries })).sha : t.tree;
    const c = await call("POST", R("/git/commits"), { message, tree, parents: [parent] });
    progress(ref === "create" ? `Creating branch ${branch}…` : `Moving ${branch} to ${c.sha.slice(0, 7)}…`);
    try {
      if (ref === "create") await call("POST", R("/git/refs"), { ref: "refs/heads/" + branch, sha: c.sha });
      else await call("PATCH", R("/git/refs/heads/" + enc(branch)), { sha: c.sha, force: false });
    } catch (e) {
      if (ref === "update" && (e.status === 422 || e.status === 409)) { const m = new GitHubError(`${branch} moved while committing`, 409); m.moved = true; throw m; }
      throw e;
    }
    return { sha: c.sha, nothing: false, uploaded, tree };
  }
  return { REPO, FILE, connected, setToken, disconnect, check, branches, head, load, history, moved, commit, gitSha, GitHubError,
    tokenURL: "https://github.com/settings/personal-access-tokens/new" };
})();
