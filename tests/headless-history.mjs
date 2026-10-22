// Headless check of local autosave history (IndexedDB): a snapshot on open,
// autosave after an edit and when the tab is hidden, change summaries, the
// History panel (restore, download), the restore offer after a reload, the
// newer-autosave notice when opening a file, Save .db marking it saved, and
// pruning to 50.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-history.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const snaps = () => p.evaluate(async () => (await BQStore.list()).map(m => ({ id: m.id, summary: m.summary, label: m.label, unsaved: m.unsaved, name: m.name, stored: m.stored, size: m.size })));
const editItem = (i, delta) => p.evaluate(async ([i, delta]) => { const it = S.c.items[i]; await api("save", { table: "items", row: { ...it, Worth: (+it.Worth || 0) + delta } }); await loadAll(); return it.id; }, [i, delta]);

await p.goto(URL);
await p.evaluate(() => localStorage.setItem("bqAutosaveMs", "800"));
await p.reload();
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])");
await p.waitForFunction(() => BQSync.state.lastId > 0);
let s = await snaps();
ok(s.length === 1 && /^Opened /.test(s[0].label) && !s[0].unsaved, "snapshot on open");
ok(s[0].stored < s[0].size || !(await p.evaluate(() => BQStore.canGzip)), `stored compressed (${s[0].stored} of ${s[0].size} bytes)`);

// autosave after an edit (delay set to 0.8 s for the test)
const id0 = await editItem(0, 5);
await p.waitForFunction(() => BQSync.state.lastId > 1, null, { timeout: 10000 });
s = await snaps();
ok(s[0].summary === "Items: edited 1" && s[0].unsaved, "autosave after an edit, summary " + s[0].summary);
ok(/Autosaved \d\d:\d\d/.test(await p.textContent("#sync")), "header says when it last autosaved");

// tab hidden: snapshot straight away
await p.evaluate(() => localStorage.setItem("bqAutosaveMs", "600000"));
await p.reload(); await p.setInputFiles("#open", process.env.DB); await p.waitForFunction(() => BQSync.state.lastId > 0);
const before = (await snaps()).length;
await editItem(1, 3);
await p.evaluate(async () => { const c = S.c.conversations[0]; await api("save", { table: "conversation", row: { ...c, Title: (c.Title || "") + "!" } }); await loadAll(); });
await wait(300);
ok((await snaps()).length === before, "no snapshot yet (long delay)");
await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await p.waitForFunction(n => BQStore.list().then(l => l.length > n), before, { timeout: 10000 }).catch(() => {});
await wait(300);
s = await snaps();
ok(s.length === before + 1 && s[0].summary === "Dialogue: edited 1; Items: edited 1" || s[0].summary === "Items: edited 1; Dialogue: edited 1", "tab hidden: snapshot now, " + s[0].summary);
await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); });

// reload with unsaved work: offered
await p.reload();
await p.waitForSelector("#notice:not([hidden])");
ok(/Unsaved work found/.test(await p.textContent("#notice")), "after reload: unsaved work offered");
await p.click("#notice button:has-text('Restore it')");
await p.waitForSelector("#tabs:not([hidden])"); await wait(300);
ok(await p.evaluate(() => BQ.st.dirty) && /unsaved/.test(await p.textContent("#file")), "restored, still marked unsaved");
await p.click("#tabs button[data-tab=export]"); await p.waitForSelector("pre.sql");
ok(/INSERT OR REPLACE INTO conversation/.test(await p.textContent("pre.sql")), "Export SQL change list restored too");

// History panel: list, download, restore an older one
await p.click("#btn-history"); await p.waitForSelector(".sync-modal table.snaps");
const rows = await p.$$eval(".sync-modal table.snaps tr", r => r.map(x => x.textContent));
ok(rows.length === (await snaps()).length && rows.some(t => /Items: edited 1/.test(t)) && rows.some(t => /unsaved/.test(t)), "History lists snapshots with time, summary and state");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click(".sync-modal table.snaps tr:first-child button:has-text('Download')")]);
ok(/\.db$/.test(dl.suggestedFilename()) && (await (await import("fs")).promises.stat(await dl.path())).size > 1e6, "Download gives the db " + dl.suggestedFilename());
const count = (await snaps()).length;
await editItem(2, 1); // unsaved edit on top of the restored one
await p.click("#btn-history").catch(() => {}); await p.waitForSelector(".sync-modal table.snaps");
await p.click(".sync-modal table.snaps tr:last-child button:has-text('Restore')");
await p.waitForFunction(() => !document.querySelector(".sync-modal")); await wait(300);
s = await snaps();
ok(s.length === count + 1 && /^Before restoring/.test(s[0].label), "restoring snapshots what was open first");
ok(await p.evaluate(i => S.itemBy[i].Worth, id0) === (await p.evaluate(() => BQ.withBytes(BQ.bytes(), q => q("SELECT Worth FROM items WHERE id = ?", [S.c.items[0].id])[0].Worth))) && !(await p.evaluate(() => BQ.st.dirty)), "oldest snapshot restored (as opened, saved)");

// Save .db marks the history saved: no offer after reload
await editItem(0, 2);
const [dl2] = await Promise.all([p.waitForEvent("download"), p.click("#btn-save")]);
await wait(800);
s = await snaps();
ok(s[0].label === "Saved .db" && !s[0].unsaved, "Save .db: latest snapshot saved");
await p.reload(); await wait(800);
ok(await p.isHidden("#notice"), "no restore offer when everything was saved");

// newer autosave than the file being opened
await p.setInputFiles("#open", process.env.DB); await p.waitForFunction(() => BQSync.state.lastId > 0);
await editItem(4, 1); await p.evaluate(() => BQSync.snapshot());
await p.setInputFiles("#open", process.env.DB); await wait(1500);
ok(/newer autosave/.test(await p.textContent("#notice")), "opening a file older than an unsaved autosave of it: offered");

// prune to 50
await p.evaluate(async () => { for (let i = 0; i < 55; i++) await BQStore.add({ bytes: new Uint8Array(2000).fill(i), name: "t.db", summary: "x" + i }); });
s = await snaps();
ok(s.length === 50 && s[0].summary === "x54", "pruned to the newest 50");
ok(errs.length === 0, "no page errors " + errs.join("; "));
await b.close();
