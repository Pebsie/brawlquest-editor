"use strict";
// Safe saving: local autosave history (store.js), checks before Save .db or
// a commit (validate.js), and GitHub sync (gh.js). Uses app.js's h, $, status,
// openBytes, download and syncFile.
const BQSync = (() => {
  const DELAY = 45e3, MAX_WAIT = 120e3;
  const SY = { fp: null, snapFp: null, base: null, baseFp: null, baseIssues: new Set(), timer: 0, firstChange: 0, lastChange: 0,
    lastHash: 0, lastSnap: null, lastCommitAt: Date.now(), busy: false, storeOk: true };
  const autoMins = () => +(localStorage.getItem("bqAutoCommit") || 0);
  const when = t => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const clock = t => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  const mb = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
  const short = s => String(s || "").slice(0, 7);
  const commitURL = sha => `https://github.com/${BQGitHub.REPO}/commit/${sha}`;
  function bytesHash(b) {
    let h1 = 0x811c9dc5, h2 = b.length;
    for (let i = 0; i < b.length; i += 4) { h1 = Math.imul(h1 ^ (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24), 16777619); h2 = (h2 + h1) | 0; }
    return (h1 >>> 0) * 4096 + ((h2 >>> 0) & 4095);
  }
  function indicator(msg, err) {
    const el = $("#sync");
    el.textContent = msg; el.classList.toggle("err", !!err);
  }
  function showSync() {
    if (!SY.storeOk) return;
    const parts = [];
    if (SY.lastSnap) parts.push(`Autosaved ${clock(SY.lastSnap)}`);
    if (SY.base) parts.push(`GitHub ${SY.base.branch}@${short(SY.base.commit)}`);
    indicator(parts.join(" · "));
  }

  // ------------------------------------------------------------ fingerprints
  function currentFp() {
    if (!BQ.has()) return null;
    SY.fp = BQDump.fingerprint(BQ.query, SY.fp, BQ.st.touched);
    BQ.st.touched = new Set();
    return SY.fp;
  }
  const changesSince = fp => BQDump.diff(fp, currentFp()).text;
  const issueKey = p => p.level + "|" + p.where + "|" + p.msg;

  // ------------------------------------------------------------ snapshots
  function schedule() {
    const now = Date.now();
    if (!SY.firstChange) SY.firstChange = now;
    SY.lastChange = now;
    clearTimeout(SY.timer);
    const wait = Math.max(0, Math.min(DELAY, SY.firstChange + MAX_WAIT - now));
    SY.timer = setTimeout(() => snapshot(), wait);
  }
  async function snapshot(o = {}) {
    if (!BQ.has()) return null;
    clearTimeout(SY.timer); SY.timer = 0; SY.firstChange = 0;
    try {
      const bytes = BQ.bytes(), hash = bytesHash(bytes), unsaved = !!BQ.st.dirty;
      if (hash === SY.lastHash && SY.lastId) {
        const patch = { unsaved };
        if (o.label) patch.label = o.label;
        await BQStore.update(SY.lastId, patch);
        SY.lastSnap = Date.now(); showSync();
        return SY.lastId;
      }
      const fp = currentFp();
      const summary = SY.snapFp ? BQDump.diff(SY.snapFp, fp).text : "";
      const id = await BQStore.add({ bytes, name: BQ.st.name, summary, unsaved, label: o.label || "",
        base: SY.base, hash, changes: BQ.st.changes, flags: { plotUpgraded: !!BQ.st.plotUpgraded, enemiesUpgraded: !!BQ.st.enemiesUpgraded } }, o.fast);
      SY.snapFp = fp; SY.lastHash = hash; SY.lastId = id; SY.lastSnap = Date.now(); SY.storeOk = true;
      showSync();
      return id;
    } catch (e) {
      SY.storeOk = false;
      indicator("Autosave failed: " + e.message, true);
      return null;
    }
  }

  // ------------------------------------------------------------ open hooks
  document.addEventListener("bq:change", () => schedule());
  document.addEventListener("bq:saved", () => { snapshot({ label: "Saved .db" }); });
  document.addEventListener("bq:open", async ev => {
    const d = ev.detail;
    clearTimeout(SY.timer); SY.timer = 0; SY.firstChange = 0;
    const prev = await BQStore.latest().catch(() => null);
    SY.fp = null; SY.fp = currentFp(); SY.snapFp = SY.fp;
    SY.baseIssues = new Set(BQCheck.run(BQ.query).all.map(issueKey));
    SY.base = d.base || null; SY.baseFp = null; SY.lastCommitAt = Date.now();
    if (d.baseBytes) SY.baseFp = await BQ.withBytes(d.baseBytes, q => BQDump.fingerprint(q));
    else if (SY.base) loadBaseFp(SY.base);
    if (d.source === "history") { SY.lastHash = d.meta.hash; SY.lastId = d.meta.id; SY.lastSnap = d.meta.time; showSync(); }
    else {
      SY.lastHash = 0; SY.lastId = 0;
      await snapshot({ label: d.source === "github" ? `Opened ${SY.base.branch}@${short(SY.base.commit)} from GitHub` : `Opened ${d.name}` });
      if (d.source === "file" && prev && prev.unsaved && prev.name === d.name && prev.time > (d.lastModified || 0)) offerRestore(prev, "newer");
    }
    hideNotice();
  });
  async function loadBaseFp(base) {
    try {
      const kb = await BQStore.kvGet("base");
      if (kb && kb.commit === base.commit) SY.baseFp = await BQ.withBytes(await gunzipMaybe(kb), q => BQDump.fingerprint(q));
    } catch { /* summary falls back to the last commit */ }
  }
  async function keepBase(base, bytes) {
    let data = bytes, gz = false;
    if (BQStore.canGzip) { try { data = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()); gz = true; } catch { /* raw */ } }
    await BQStore.kvSet("base", { commit: base.commit, gz, bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }).catch(() => {});
  }
  async function gunzipMaybe(kb) {
    const raw = new Uint8Array(kb.bytes);
    return kb.gz ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()) : raw;
  }
  // Tab hidden or closing: snapshot now if there are edits waiting. Hidden
  // fires before unload in every current browser, and the tab still runs.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && SY.timer) snapshot({ fast: true }); });
  window.addEventListener("pagehide", () => { if (SY.timer) snapshot({ fast: true }); });

  // ------------------------------------------------------------ notices
  function notice(...kids) {
    const n = $("#notice");
    n.replaceChildren(...kids, " ", h("button", { onclick: hideNotice }, "Dismiss"));
    n.hidden = false;
  }
  function hideNotice() { $("#notice").hidden = true; }
  function offerRestore(m, why) {
    notice(h("b", {}, why === "newer" ? "There is a newer autosave of this file. " : "Unsaved work found. "),
      `${m.name}, ${when(m.time)} (${ago(m.time)})${m.summary ? ": " + m.summary : ""}. `,
      h("button", { class: "primary", onclick: () => restore(m) }, "Restore it"), " ",
      h("button", { onclick: () => historyModal() }, "History…"));
  }
  async function startup() {
    if (!(await BQStore.available())) { SY.storeOk = false; indicator("Autosave off: this browser won't store data here (private window?)", true); return; }
    BQStore.persist();
    const m = await BQStore.latest().catch(() => null);
    if (m && m.unsaved && !BQ.has()) offerRestore(m, "unsaved");
  }

  async function restore(m) {
    try {
      if (BQ.has() && BQ.st.dirty) await snapshot({ label: "Before restoring " + when(m.time) });
      status("Restoring " + when(m.time) + "…");
      const s = await BQStore.get(m.id);
      closeModal();
      await openBytes(s.bytes, m.name, { source: "history", base: m.base, meta: m, restore: { dirty: m.unsaved, changes: s.changes, ...s.flags } });
      status(`Restored ${m.name} from ${when(m.time)}.` + (m.unsaved ? " It has unsaved changes." : ""));
    } catch (e) { status("Restore failed: " + e.message, true); alert("Restore failed: " + e.message); }
  }

  // ------------------------------------------------------------ modal
  function modal(title, body) {
    closeModal();
    const ov = h("div", { class: "modal sync-modal", onclick: e => { if (e.target === ov) closeModal(); } },
      h("div", { class: "modal-box" }, h("div", { class: "modal-head" }, h("b", {}, title), h("button", { onclick: closeModal }, "Close (Esc)")),
        h("div", { class: "modal-body" }, body)));
    document.body.append(ov);
    return ov.querySelector(".modal-body");
  }
  function closeModal() { document.querySelectorAll(".sync-modal").forEach(m => m.remove()); }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.querySelector(".sync-modal")) closeModal(); });

  // ------------------------------------------------------------ history UI
  async function historyModal() {
    const body = modal("History", h("p", { class: "hint" }, "Loading…"));
    let list, u;
    try { list = await BQStore.list(); u = await BQStore.usage(); }
    catch (e) { body.replaceChildren(h("p", { class: "err" }, "History is not available: " + e.message)); return; }
    const rows = list.map(m => h("tr", { "data-id": m.id },
      h("td", { class: "nowrap" }, when(m.time), h("div", { class: "hint" }, ago(m.time))),
      h("td", {}, h("div", {}, m.summary || m.label || h("span", { class: "hint" }, "no row changes")),
        h("div", { class: "hint" }, m.name, m.label && m.summary ? " · " + m.label : "", m.base ? ` · from ${m.base.branch}@${short(m.base.commit)}` : "")),
      h("td", {}, m.unsaved ? h("span", { class: "tag unsaved" }, "unsaved") : h("span", { class: "tag" }, "saved")),
      h("td", { class: "nowrap" }, h("button", { onclick: () => restore(m) }, "Restore"), " ",
        h("button", { onclick: async () => { const s = await BQStore.get(m.id); download(new Blob([s.bytes], { type: "application/x-sqlite3" }), snapName(m)); } }, "Download"))));
    body.replaceChildren(
      h("p", { class: "hint" }, `Snapshots of the open db, kept in this browser only: about ${DELAY / 1000} s after an edit, when you switch away from the tab, and when you open, save or commit. The newest ${BQStore.MAX} are kept (fewer if storage runs short). Restore snapshots what is open first, so nothing is lost.`),
      h("p", { class: "hint" }, `${u.count} snapshot(s), ${mb(u.stored)} stored` + (u.quota ? `; this site may use about ${mb(u.quota)} in this browser.` : ".")),
      h("div", { class: "bar" }, h("button", { disabled: !BQ.has(), onclick: async () => { await snapshot({ label: "Snapshot" }); historyModal(); } }, "Snapshot now")),
      list.length ? h("table", { class: "snaps" }, h("tbody", {}, rows)) : h("p", {}, "No snapshots yet. They start once a db is open."));
  }
  const snapName = m => m.name.replace(/(\.db|\.sqlite3?)?$/i, "") + "-" + new Date(m.time).toISOString().slice(0, 16).replace(/[T:]/g, "") + ".db";

  // ------------------------------------------------------------ checks
  // Resolves true when action may go ahead: no errors and no warnings that
  // were not already in the db as it was opened (or the user said go ahead).
  function checkBefore(action, o = {}) {
    if (!BQ.has()) return Promise.resolve(false);
    status("Checking the db…");
    const r = BQCheck.run(BQ.query);
    const fresh = r.warnings.filter(p => !SY.baseIssues.has(issueKey(p)));
    const old = r.warnings.filter(p => SY.baseIssues.has(issueKey(p)));
    status(r.errors.length ? `${r.errors.length} problem(s) to fix before ${action}` : "");
    if (o.quiet) return Promise.resolve(!r.errors.length && !fresh.length ? true : r);
    if (!r.errors.length && !fresh.length) return Promise.resolve(true);
    return new Promise(res => {
      const item = p => h("li", {}, h("b", {}, p.where), ": ", p.msg, p.route ? h("span", {}, " ", h("a", { href: p.route, onclick: () => { closeModal(); res(false); } }, "open")) : null);
      const body = modal(r.errors.length ? `Fix these before ${action}` : `Check before ${action}`, []);
      body.append(
        r.errors.length ? h("div", {}, h("h3", {}, `${r.errors.length} error(s)`), h("p", { class: "hint" }, "These crash the API or make it drop content when it loads this db."), h("ul", { class: "issues err" }, r.errors.map(item))) : null,
        fresh.length ? h("div", {}, h("h3", {}, `${fresh.length} new warning(s)`), h("ul", { class: "issues" }, fresh.map(item))) : null,
        old.length ? h("details", {}, h("summary", {}, `${old.length} warning(s) that were already there when you opened it`), h("ul", { class: "issues" }, old.map(item))) : null,
        h("p", { class: "hint" }, "Your edits are safe in History while you fix them."),
        h("div", { class: "bar" },
          !r.errors.length ? h("button", { class: "primary", onclick: () => { closeModal(); res(true); } }, `${action} anyway`) : null,
          h("button", { onclick: () => { closeModal(); res(false); } }, r.errors.length ? "OK" : "Cancel")));
      const obs = new MutationObserver(() => { if (!document.body.contains(body)) { obs.disconnect(); res(false); } });
      obs.observe(document.body, { childList: true });
    });
  }

  // ------------------------------------------------------------ GitHub UI
  async function openFromGitHub(o = {}) {
    const what = o.commit ? `commit ${short(o.commit)}` : `the latest bq-content.db on ${o.branch || "main"}`;
    if (BQ.has() && BQ.st.dirty && !confirm(`Open ${what}? Your current edits stay in History.`)) return;
    try {
      if (BQ.has()) await snapshot({ label: "Before opening from GitHub" });
      status(`Downloading ${what}…`);
      const r = await BQGitHub.load({ branch: o.branch || "main", commit: o.commit });
      if (o.commit && o.branch) r.base.branch = o.branch;
      await keepBase(r.base, r.bytes);
      closeModal();
      await openBytes(r.bytes.slice(), BQGitHub.FILE, { source: "github", base: r.base, baseBytes: r.bytes });
      status(`Opened ${r.base.branch}@${short(r.base.commit)}: ${r.base.message.split("\n")[0]}`);
    } catch (e) { status(e.message, true); alert(e.message); }
  }

  const autoMessage = () => (SY.baseFp ? changesSince(SY.baseFp) : "") || "Content edits from the editor";
  function fullMessage(typed, summary) {
    const first = (typed || summary).trim();
    let msg = first.length > 72 && !typed ? first.slice(0, 69).replace(/[;,]?\s*\S*$/, "") + "…" : first;
    if (typed && summary) msg += "\n\n" + summary;
    else if (msg !== first) msg += "\n\n" + first;
    return msg;
  }

  // Commit the open db to branch. Never forced: when the branch has moved on
  // and its db changed, nothing is written and the user picks what to do.
  async function commitNow(o = {}) {
    if (SY.busy) return { busy: true };
    if (!BQ.has()) throw new Error("Open a db first");
    const branch = o.branch || (SY.base && SY.base.branch) || "main";
    if (!o.auto && !o.skipCheck && !(await checkBefore("Commit"))) return { cancelled: true };
    if (o.auto) { const c = await checkBefore("auto-commit", { quiet: true }); if (c !== true) return { skipped: c }; }
    SY.busy = true;
    const say = m => { status(m); if (o.progress) o.progress(m); };
    try {
      say(`Checking ${branch} on GitHub…`);
      let parent, ref = "update";
      if (o.newBranch) { parent = (SY.base && SY.base.commit) || await BQGitHub.head("main"); ref = "create"; }
      else {
        const headSha = await BQGitHub.head(branch);
        if (!SY.base) {
          if (!o.overFile) return { conflict: "file", branch, head: headSha };
          parent = headSha;
        } else if (SY.base.commit === headSha) parent = headSha;
        else {
          const mv = await BQGitHub.moved(SY.base.commit, headSha);
          if (mv.touched && !o.overMoved) return { conflict: "moved", branch, head: headSha, commits: mv.commits };
          parent = headSha;
        }
      }
      const summary = SY.baseFp ? changesSince(SY.baseFp) : "";
      const message = fullMessage(o.message, summary || (SY.base ? "" : `Replace bq-content.db with ${BQ.st.name}`) || "Content edits from the editor");
      const bytes = BQ.bytes();
      say("Writing the text dump…");
      const dump = BQDump.dump(BQ.query);
      let r;
      try { r = await BQGitHub.commit({ bytes, dump, message, parent, branch: o.newBranch || branch, ref, progress: say }); }
      catch (e) { if (e.moved) return { conflict: "moved", branch, head: "", commits: [] }; throw e; }
      if (r.nothing) { say(`Nothing to commit: bq-content.db on ${branch} is already this.`); SY.base = SY.base || { branch, commit: parent }; return r; }
      const nb = o.newBranch || branch;
      SY.base = { branch: nb, commit: r.sha, message, date: new Date().toISOString() };
      SY.baseFp = currentFp(); SY.baseIssues = new Set(BQCheck.run(BQ.query).all.map(issueKey));
      SY.lastCommitAt = Date.now();
      BQ.st.dirty = false; syncFile();
      keepBase(SY.base, bytes);
      SY.lastHash = 0;
      await snapshot({ label: `Committed ${short(r.sha)} to ${nb}` });
      say(`Committed ${short(r.sha)} to ${nb}: ${message.split("\n")[0]}`);
      return { ...r, branch: nb, message };
    } finally { SY.busy = false; }
  }

  async function githubModal() {
    if (!BQGitHub.connected()) return connectView(modal("GitHub", []));
    const body = modal("GitHub: " + BQGitHub.REPO, h("p", { class: "hint" }, "Loading…"));
    renderGitHub(body);
  }
  function connectView(body) {
    const tok = h("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "github_pat_…", style: "width:100%" });
    const msg = h("p", { class: "hint" });
    const go = async () => {
      const t = tok.value.trim();
      if (!t) return;
      msg.className = "hint"; msg.textContent = "Checking the token…";
      try {
        const c = await BQGitHub.check(t);
        if (!c.push) throw new Error(`The token can read ${BQGitHub.REPO} but not write to it: set Contents to "Read and write".`);
        BQGitHub.setToken(t); localStorage.setItem("bqGitHubLogin", c.login || "");
        tok.value = "";
        renderGitHub(body);
      } catch (e) { msg.className = "err"; msg.textContent = e.message; }
    };
    tok.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    body.replaceChildren(
      h("p", {}, `Connect once to open, commit and browse versions of bq-content.db in ${BQGitHub.REPO}.`),
      h("ol", { class: "steps-list" },
        h("li", {}, "Open ", h("a", { href: BQGitHub.tokenURL, target: "_blank", rel: "noopener" }, "GitHub: new fine-grained token"), " (Settings > Developer settings > Personal access tokens > Fine-grained tokens)."),
        h("li", {}, "Token name: BrawlQuest editor. Expiration: up to you (90 days is fine; you just reconnect when it runs out)."),
        h("li", {}, "Resource owner: BrawlQuest. Repository access: Only select repositories > brawlquest-content."),
        h("li", {}, "Repository permissions: Contents > Read and write. Leave everything else as it is (Metadata read-only is added for you)."),
        h("li", {}, "Generate token, copy it and paste it here.")),
      h("div", { class: "bar" }, tok, h("button", { class: "primary", onclick: go }, "Connect")),
      msg,
      h("p", { class: "hint" }, "The token stays in this browser's local storage on this machine and is only ever sent to api.github.com. Disconnect removes it. If BrawlQuest's settings require it, an owner approves the token on GitHub before it works."));
  }
  async function renderGitHub(body) {
    const login = localStorage.getItem("bqGitHubLogin");
    const out = h("div", { class: "gh-out" });
    const msgIn = h("input", { type: "text", style: "width:100%", placeholder: "" });
    const brSel = h("select", {}, h("option", { value: "main" }, "main"));
    const cur = (SY.base && SY.base.branch) || "main";
    BQGitHub.branches().then(list => {
      brSel.replaceChildren(...[...new Set(["main", cur, ...list])].map(b => h("option", { value: b }, b)));
      brSel.value = cur;
    }).catch(e => { out.className = "gh-out err"; out.textContent = e.message; });
    brSel.value = cur;
    const changes = BQ.has() && SY.baseFp ? changesSince(SY.baseFp) : "";
    msgIn.placeholder = BQ.has() ? (changes || (SY.base ? "No row changes since " + short(SY.base.commit) : "Commit message")) : "";
    const auto = h("select", { onchange: () => { localStorage.setItem("bqAutoCommit", auto.value); } },
      [0, 5, 10, 15, 30].map(n => h("option", { value: n }, n ? `every ${n} minutes` : "off")));
    auto.value = String(autoMins());
    const hist = h("div", { class: "gh-hist" }, h("p", { class: "hint" }, "Loading versions…"));
    const doCommit = async () => {
      out.className = "gh-out"; out.textContent = "";
      try {
        const r = await commitNow({ message: msgIn.value.trim(), branch: brSel.value, progress: m => { out.textContent = m; } });
        if (r.conflict) return conflictView(body, r, msgIn.value.trim());
        if (r.cancelled) { out.textContent = ""; return; }
        renderGitHub(body);
      } catch (e) { out.className = "gh-out err"; out.textContent = e.message; }
    };
    body.replaceChildren(
      h("p", {}, "Connected to ", h("b", {}, BQGitHub.REPO), login ? ` as ${login}. ` : ". ",
        h("button", { onclick: () => { if (confirm("Disconnect GitHub? The token is removed from this browser.")) { BQGitHub.disconnect(); localStorage.removeItem("bqGitHubLogin"); connectView(body); } } }, "Disconnect")),
      h("h3", {}, "The open db"),
      h("p", {}, !BQ.has() ? "No db open." : SY.base ? h("span", {}, `${BQ.st.name}, from ${SY.base.branch} at `, h("a", { href: commitURL(SY.base.commit), target: "_blank", rel: "noopener" }, short(SY.base.commit)), SY.base.message ? ` (${SY.base.message.split("\n")[0]})` : "", ". ", changes ? "Changed since: " + changes + "." : "No changes since.")
        : `${BQ.st.name}, opened from a file, not from GitHub. Committing it replaces bq-content.db on the branch (the old one stays in the history).`),
      h("div", { class: "bar" },
        h("button", { onclick: () => openFromGitHub({ branch: brSel.value }) }, "Open latest from GitHub")),
      BQ.has() ? h("div", {}, h("h3", {}, "Commit"),
        h("div", { class: "grid" },
          h("label", {}, "Message"), msgIn,
          h("label", {}, "Branch"), h("div", {}, brSel),
          h("label", {}, "Auto-commit"), h("div", {}, auto, h("span", { class: "hint" }, " while editing, to the same branch; skipped when the checks find something. Off by default: autosave already covers minute-to-minute."))),
        h("div", { class: "bar" }, h("button", { class: "primary", onclick: doCommit }, "Commit to GitHub")),
        h("p", { class: "hint" }, "Commits bq-content.db and a readable dump (content/<table>.sql) so diffs on GitHub show what changed. Blank message: the summary of changes is used.")) : null,
      out,
      h("h3", {}, "Version history of bq-content.db"),
      hist);
    try {
      const list = await BQGitHub.history(brSel.value || "main");
      hist.replaceChildren(list.length ? h("table", { class: "snaps" }, h("tbody", {}, list.map(c => h("tr", {},
        h("td", { class: "nowrap" }, when(c.date)),
        h("td", {}, c.message.split("\n")[0], h("div", { class: "hint" }, c.author, " · ", h("a", { href: commitURL(c.sha), target: "_blank", rel: "noopener" }, short(c.sha)))),
        h("td", {}, h("button", { onclick: () => openFromGitHub({ commit: c.sha, branch: brSel.value }) }, "Open")))))) : h("p", { class: "hint" }, "No commits yet."));
    } catch (e) { hist.replaceChildren(h("p", { class: "err" }, e.message)); }
  }
  function conflictView(body, r, typed) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const name = h("input", { type: "text", value: `editor/${stamp}`, style: "width:260px" });
    const out = h("div", { class: "gh-out" });
    const run = async o => {
      out.className = "gh-out";
      try {
        const x = await commitNow({ message: typed, skipCheck: true, progress: m => { out.textContent = m; }, ...o });
        if (x.conflict) return conflictView(body, x, typed);
        renderGitHub(body);
      } catch (e) { out.className = "gh-out err"; out.textContent = e.message; }
    };
    const branchRow = h("div", { class: "bar" }, h("button", { class: "primary", onclick: () => run({ newBranch: name.value.trim() }) }, "Commit to a new branch"), name);
    if (r.conflict === "file") {
      body.replaceChildren(h("h3", {}, "This db wasn't opened from GitHub"),
        h("p", {}, `It came from a file (${BQ.st.name}), so the editor can't tell what changed on ${r.branch} since. Committing it makes ${r.branch}'s bq-content.db exactly this file. The current one stays in the git history and is not overwritten in place.`),
        h("div", { class: "bar" }, h("button", { class: "primary", onclick: () => run({ branch: r.branch, overFile: true }) }, `Commit this file to ${r.branch}`)),
        branchRow, h("div", { class: "bar" }, h("button", { onclick: () => renderGitHub(body) }, "Cancel")), out);
      return;
    }
    body.replaceChildren(h("h3", {}, `${r.branch} has moved on since you opened it`),
      h("p", {}, "Someone (or another tab) committed a different bq-content.db. Committing yours on top would undo their changes, so nothing was written. Your edits are safe here and in History."),
      r.commits.length ? h("ul", {}, r.commits.slice(-10).map(c => h("li", {}, `${when(c.date)} ${c.author}: ${c.message.split("\n")[0]} `, h("a", { href: commitURL(c.sha), target: "_blank", rel: "noopener" }, short(c.sha))))) : null,
      branchRow,
      h("p", { class: "hint" }, "A branch keeps both: merge it on GitHub (or redo the edits on the latest)."),
      h("div", { class: "bar" },
        h("button", { onclick: () => openFromGitHub({ branch: r.branch }) }, `Open the latest ${r.branch} instead`),
        h("button", { onclick: () => renderGitHub(body) }, "Cancel")),
      h("p", { class: "hint" }, "Opening the latest replaces what is open; your current db is snapshotted to History first."), out);
  }

  // Auto-commit: every N minutes while there are changes, never while the
  // user is mid-edit, never over a moved branch.
  setInterval(async () => {
    const n = autoMins();
    if (!n || !BQGitHub.connected() || !BQ.has() || !SY.base || SY.busy || !BQ.st.dirty) return;
    if (Date.now() - SY.lastCommitAt < n * 60e3 || Date.now() - SY.lastChange < 15e3) return;
    try {
      const r = await commitNow({ auto: true });
      if (r.skipped) { SY.lastCommitAt = Date.now(); status(`Auto-commit skipped: the checks found ${r.skipped.errors.length} error(s), ${r.skipped.warnings.length} warning(s). Commit by hand to see them.`, true); }
      else if (r.conflict) { localStorage.setItem("bqAutoCommit", "0"); notice(h("b", {}, "Auto-commit is off: "), `${r.branch} moved on since you opened it. Open GitHub to commit on a branch or reload.`, " ", h("button", { onclick: githubModal }, "GitHub…")); }
    } catch (e) { SY.lastCommitAt = Date.now(); status("Auto-commit failed: " + e.message, true); }
  }, 30e3);

  $("#btn-history").addEventListener("click", historyModal);
  $("#btn-github").addEventListener("click", githubModal);
  startup();
  return { snapshot, checkBefore, commitNow, openFromGitHub, historyModal, githubModal, restore, state: SY, currentFp };
})();
