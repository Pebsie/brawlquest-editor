// Headless check of the quest form's "Complete objectives in order" box
// (quest_def.Sequential: 0 = every objective at once, the default; 1 = in
// order). Opening a db without the column adds it (every quest 0), the same
// step as the API's content/migrations/2026-10-24-quest-sequential.sql, and
// Export SQL carries it. Uses quest 1304 of a content db copy.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/copy.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-quest-sequential.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const QID = +(process.env.QID || 1304);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const seq = () => p.evaluate(id => BQ.query(`SELECT Sequential FROM quest_def WHERE id = ${id}`)[0].Sequential, QID);
const saveQuest = async () => { await p.click("#q-sequential >> xpath=ancestor::div[contains(@class,'form')]//button[text()='Save']"); await wait(400); };

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(500);
const hadCol = await p.evaluate(() => BQ.query("PRAGMA table_info(quest_def)").some(c => c.name === "Sequential"));
ok(hadCol, "quest_def has Sequential after open");
const sums = await p.evaluate(() => BQ.query("SELECT COUNT(*) AS n, SUM(Sequential) AS s FROM quest_def")[0]);
ok(sums.n > 50 && sums.s === 0, "every quest starts with objectives at once: " + JSON.stringify(sums));
await p.evaluate(id => { location.hash = "#quest/" + id; }, QID); await p.waitForSelector("#q-sequential"); await wait(200);
ok(!(await p.isChecked("#q-sequential")), "box unticked by default");
ok(/Complete objectives in order/.test(await p.textContent("label:has(#q-sequential)")), "label text");
await p.check("#q-sequential"); await saveQuest();
ok(await seq() === 1, "ticked + Save stores Sequential = 1");
await p.evaluate(id => { location.hash = "#quest/0"; location.hash = "#quest/" + id; }, QID); await wait(300);
ok(await p.isChecked("#q-sequential"), "reopened quest shows the box ticked");
await p.uncheck("#q-sequential"); await saveQuest();
ok(await seq() === 0, "unticked + Save stores 0");
const sql = await p.evaluate(() => BQ.api.export().sql);
ok(/2026-10-24-quest-sequential/.test(sql) && /Sequential INTEGER NOT NULL DEFAULT 0/.test(sql) && /INSERT OR REPLACE INTO quest_def .*Sequential/.test(sql), "Export SQL carries the column step");
const checks = await p.evaluate(() => BQCheck.run(BQ.query).all.filter(x => x.level === "error").map(x => x.msg));
ok(checks.length === 0, "no check errors: " + checks.join("; "));
ok(!errs.length, "no page errors: " + errs.join("; "));
await b.close();
