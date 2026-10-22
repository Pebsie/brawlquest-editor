// Headless check of GitHub sync against a mocked api.github.com (no network:
// every https://api.github.com request is answered by tests/github-mock.mjs).
// Connect, open from GitHub, commit with the auto message and the text dump,
// nothing-to-commit, the branch moving on (README only: fine; db: blocked,
// commit on a branch instead), version history, a file-opened db, the checks
// blocking a commit, token handling, disconnect.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-github.mjs
import fs from "fs";
import { mockGitHub } from "./github-mock.mjs";
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const TOKEN = "github_pat_11TESTONLY_abcdefghijklmnopqrstuvwxyz0123456789";
const dbBytes = fs.readFileSync(process.env.DB);
const gh = mockGitHub({ token: TOKEN, files: { "README.md": "# brawlquest-content\n", "bq-content.db": dbBytes } });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [], consoleText = [], leaks = [];
p.on("pageerror", e => errs.push(String(e)));
p.on("console", m => consoleText.push(m.text()));
p.on("dialog", d => d.accept());
await ctx.route("https://api.github.com/**", gh.handler);
// Anything not to api.github.com must never carry the token.
p.on("request", r => {
  const u = new globalThis.URL(r.url());
  if (u.host === "api.github.com") return;
  const all = r.url() + JSON.stringify(r.headers()) + (r.postData() || "");
  if (all.includes(TOKEN)) leaks.push(r.url());
});
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const main = () => gh.refs.get("main");
const msgOf = s => gh.commits.get(s).message;
const fileAt = (c, path) => gh.fileAt(c, path);
const modalText = () => p.textContent(".sync-modal");
const openGH = async sel => { await p.evaluate(() => document.querySelectorAll(".sync-modal").forEach(m => m.remove())); await p.click("#btn-github"); await p.waitForSelector(sel || ".sync-modal button:has-text('Commit to GitHub')"); };
const waitOut = async re => { await p.waitForFunction(r => new RegExp(r).test((document.querySelector(".sync-modal") || {}).textContent || "") || new RegExp(r).test(document.querySelector("#status").textContent), re.source, { timeout: 30000 }); };

await p.goto(URL);
// --- connect
await p.click("#btn-github"); await p.waitForSelector(".sync-modal input[type=password]");
ok(/fine-grained token/.test(await modalText()) && await p.$(".sync-modal a[href='https://github.com/settings/personal-access-tokens/new']"), "connect view: instructions and the token link");
await p.fill(".sync-modal input[type=password]", "github_pat_wrong");
await p.click(".sync-modal button:has-text('Connect')");
await p.waitForSelector(".sync-modal p.err");
ok(/401/.test(await p.textContent(".sync-modal p.err")) && !(await p.evaluate(() => localStorage.getItem("bqGitHubToken"))), "a bad token is refused and not stored");
await p.fill(".sync-modal input[type=password]", TOKEN);
await p.click(".sync-modal button:has-text('Connect')");
await p.waitForSelector(".sync-modal button:has-text('Disconnect')");
ok(await p.evaluate(() => localStorage.getItem("bqGitHubToken")) === TOKEN, "token kept in localStorage");
ok(/as Pebsie/.test(await modalText()), "shows who is connected");
await p.waitForSelector(".sync-modal .gh-hist table");
ok((await p.$$(".sync-modal .gh-hist tr")).length === 1, "version history lists the baseline commit");

// --- open from GitHub
await p.click(".sync-modal button:has-text('Open latest from GitHub')");
await p.waitForSelector("#tabs:not([hidden])"); await p.waitForFunction(() => BQSync.state.lastId > 0 && BQSync.state.baseFp);
ok(await p.evaluate(() => BQSync.state.base.commit) === gh.root, "opened main at the baseline commit");
ok(/GitHub main@/.test(await p.textContent("#sync")), "header shows the GitHub version");

// --- edit, commit with the auto message
const q1 = await p.evaluate(async () => {
  const q = S.c.quests[0]; await api("save", { table: "quest_def", row: { ...q, Title: q.Title + " (edited)" } }); await loadAll();
  const c = S.c.conversations[0]; await api("save", { table: "conversation", row: { ...c, Title: (c.Title || "") + " x" } }); await loadAll();
  return q.id;
});
await openGH();
const ph = await p.getAttribute(".sync-modal input[type=text]", "placeholder");
// A db from before 2026-10-22 gets enemies.KnockbackResist/HitEffect on open: named once.
const AUTO = (await p.evaluate(() => BQ.st.enemiesUpgraded) ? "Mobs: added the KnockbackResist/HitEffect columns; " : "") + "Quests: edited 1; Dialogue: edited 1";
ok(ph === AUTO, "auto message: " + ph);
await p.click(".sync-modal button:has-text('Commit to GitHub')");
await waitOut(/Committed [0-9a-f]{7} to main/);
const c1 = main();
ok(c1 !== gh.root && (AUTO.length <= 72 ? msgOf(c1) === AUTO : msgOf(c1).split("\n")[0].length <= 72 && msgOf(c1).endsWith("\n\n" + AUTO) && AUTO.startsWith(msgOf(c1).split("\n")[0].replace(/…$/, ""))), "committed to main with the auto message (long: short first line, all of it in the body)");
ok(gh.commits.get(c1).parents[0] === gh.root, "parent is the commit it was opened from");
const dbNow = Buffer.from(await p.evaluate(() => Array.from(BQ.bytes())));
ok(gh.blob(fileAt(c1, "bq-content.db")).equals(dbNow), "bq-content.db in the commit is the open db");
ok(fileAt(c1, "README.md") === fileAt(gh.root, "README.md"), "README.md untouched");
const qsql = gh.blob(fileAt(c1, "content/quest_def.sql")).toString();
ok(/\(edited\)/.test(qsql) && /^-- quest_def: \d+ row\(s\)/.test(qsql), "content/quest_def.sql dump has the edit");
ok(!!fileAt(c1, "content/world.sql") && !!fileAt(c1, "content/items.sql"), "dump has a file per table");
ok(!gh.log.some(l => l.m === "PATCH" && l.body && l.body.force), "never forced");
ok(await p.evaluate(() => BQ.st.dirty) === false && /Committed/.test(await p.evaluate(async () => (await BQStore.latest()).label)), "after commit: saved, snapshot labelled");
// deterministic dump: same db, same text
const dumpA = await p.evaluate(() => JSON.stringify(BQDump.dump(BQ.query)));
const dumpB = await p.evaluate(() => BQ.withBytes(BQ.bytes(), q => JSON.stringify(BQDump.dump(q))));
ok(dumpA === dumpB, "dump is the same for the same content");

// --- nothing to commit; second commit only uploads what changed
let posts = gh.log.filter(l => l.m === "POST" && l.path.endsWith("/git/blobs")).length;
await openGH();
await p.click(".sync-modal button:has-text('Commit to GitHub')");
await waitOut(/Nothing to commit/);
ok(main() === c1, "no changes: nothing committed");
await p.evaluate(async () => { const i = S.c.items[0]; await api("save", { table: "items", row: { ...i, Worth: (+i.Worth || 0) + 1 } }); await loadAll(); });
posts = gh.log.filter(l => l.m === "POST" && l.path.endsWith("/git/blobs")).length;
await openGH();
await p.fill(".sync-modal input[type=text]", "Rebalance the first item");
await p.click(".sync-modal button:has-text('Commit to GitHub')");
await waitOut(/Committed [0-9a-f]{7} to main/);
const c2 = main();
const newBlobs = gh.log.filter(l => l.m === "POST" && l.path.endsWith("/git/blobs")).length - posts;
ok(newBlobs === 2, "only the db and content/items.sql uploaded (" + newBlobs + ")");
ok(msgOf(c2) === "Rebalance the first item\n\nItems: edited 1", "typed message, with the summary as the body");

// --- main moves on, README only: commit goes on top
const ext1 = gh.external("main", { "README.md": "# brawlquest-content\nNotes.\n" }, "Notes in README");
await p.evaluate(async () => { const i = S.c.items[1]; await api("save", { table: "items", row: { ...i, Worth: (+i.Worth || 0) + 1 } }); await loadAll(); });
await openGH();
await p.click(".sync-modal button:has-text('Commit to GitHub')");
await waitOut(/Committed [0-9a-f]{7} to main/);
const c3 = main();
ok(gh.commits.get(c3).parents[0] === ext1 && gh.blob(fileAt(c3, "README.md")).toString().includes("Notes."), "README-only move: committed on top, their README kept");

// --- main moves on with a different db: blocked, commit on a branch
const other = Buffer.from(dbBytes); other[100] ^= 1; // a different db file
const ext2 = gh.external("main", { "bq-content.db": other }, "Someone else's content change");
await p.evaluate(async () => { const i = S.c.items[2]; await api("save", { table: "items", row: { ...i, Worth: (+i.Worth || 0) + 1 } }); await loadAll(); });
await openGH();
await p.click(".sync-modal button:has-text('Commit to GitHub')");
await p.waitForSelector(".sync-modal h3:has-text('has moved on')");
ok(main() === ext2, "moved db: main untouched");
ok(/Someone else's content change/.test(await modalText()), "the conflict lists their commit");
const bname = await p.inputValue(".sync-modal input[type=text]");
ok(/^editor\/\d{4}-\d\d-\d\d-\d{4}$/.test(bname), "branch name offered: " + bname);
await p.click(".sync-modal button:has-text('Commit to a new branch')");
await waitOut(/Committed [0-9a-f]{7} to editor\//);
const br = gh.refs.get(bname);
ok(!!br && gh.commits.get(br).parents[0] === c3 && main() === ext2, "branch made from the version it was opened from; main still theirs");
ok(await p.evaluate(() => BQSync.state.base.branch) === bname, "later commits go to the branch");

// --- version history and opening an old version
await openGH(".sync-modal .gh-hist table");
await p.selectOption(".sync-modal select >> nth=0", "main").catch(() => {});
await p.click(".sync-modal button:has-text('Disconnect')").catch(() => {}); // dialog accepted: disconnects
ok(!(await p.evaluate(() => localStorage.getItem("bqGitHubToken"))), "disconnect removes the token");
await p.fill(".sync-modal input[type=password]", TOKEN); await p.click(".sync-modal button:has-text('Connect')");
await p.waitForSelector(".sync-modal .gh-hist table");
const histRows = await p.$$eval(".sync-modal .gh-hist tr", r => r.map(x => x.textContent));
ok(histRows.length >= 4 && histRows.some(t => /baseline/.test(t)), "version history lists db commits on the branch (" + histRows.length + ")");
await p.click(".sync-modal .gh-hist tr:last-child button:has-text('Open')");
await p.waitForFunction(r => BQSync.state.base && BQSync.state.base.commit === r, gh.root);
ok(Buffer.from(await p.evaluate(() => Array.from(BQ.bytes()))).length > 0 && await p.evaluate(q => !/\(edited\)/.test(S.c.quests.find(x => x.id === q).Title), q1), "opened the baseline: without the later edits");

// --- the checks block a commit
await p.evaluate(() => BQ.query("UPDATE boss_patterns SET Pattern = '[{\"do\":\"zone\",\"every\":2.5}' WHERE id = (SELECT MIN(id) FROM boss_patterns)"));
const before = gh.log.length;
await openGH();
await p.click(".sync-modal button:has-text('Commit to GitHub')");
await p.waitForSelector(".sync-modal h3:has-text('error')");
ok(/Pattern is not valid JSON/.test(await modalText()) && !(await p.$(".sync-modal button:has-text('anyway')")), "invalid pattern JSON blocks the commit (no override for errors)");
ok(!gh.log.slice(before).some(l => l.m !== "GET"), "nothing written while blocked");
await p.click(".sync-modal button:has-text('OK')");

// --- a db opened from a file
await p.evaluate(() => { localStorage.setItem("x", "1"); });
await p.setInputFiles("#open", process.env.DB);
await p.waitForFunction(() => BQSync.state.base === null && BQSync.state.lastId > 0);
await p.evaluate(async () => { const i = S.c.items[3]; await api("save", { table: "items", row: { ...i, Worth: (+i.Worth || 0) + 7 } }); await loadAll(); });
await openGH();
ok(/opened from a file/.test(await modalText()), "file-opened db is described as such");
await p.selectOption(".sync-modal select >> nth=0", "main");
await p.click(".sync-modal button:has-text('Commit to GitHub')");
await p.waitForSelector(".sync-modal h3:has-text(\"wasn't opened from GitHub\")");
const mainBefore = main();
ok(mainBefore === ext2, "file commit waits for a choice");
await p.click(".sync-modal button:has-text('Commit this file to main')");
await waitOut(/Committed [0-9a-f]{7} to main/);
ok(gh.commits.get(main()).parents[0] === mainBefore && /Replace bq-content.db with/.test(msgOf(main())), "file committed on top of main (history kept): " + msgOf(main()).split("\n")[0]);

// --- token never leaves for anywhere else, never logged, every API call authorised
ok(leaks.length === 0, "token never sent outside api.github.com " + leaks.join(" "));
ok(!consoleText.some(t => t.includes(TOKEN)), "token never logged");
ok(gh.log.filter(l => l.m !== "OPTIONS").every(l => /^Bearer /.test(l.auth || "")), "every API call is authorised");
ok(!(await p.evaluate(async () => JSON.stringify(await BQStore.list()))).includes(TOKEN), "token not in the history store");
ok(errs.length === 0, "no page errors " + errs.join("; "));
await b.close();
