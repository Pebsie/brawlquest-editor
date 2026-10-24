// Headless check of the Mobs tab's day/night boxes (enemies.SpawnsDay /
// SpawnsNight). Use a db from before 2026-10-25-day-night-spawns.sql: opening
// it adds both columns at 1 for every mob; the boxes show, save and load;
// Export SQL carries the step. OUTDB (optional) gets the upgraded, untouched
// copy, to compare its dump with the API migration's.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-day-night.mjs
import fs from "fs";
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await p.waitForTimeout(800);
ok(await p.evaluate(() => BQ.st.enemiesUpgraded), "older db: enemies upgraded on open");
ok(await p.evaluate(() => BQ.st.warnings.some(w => /SpawnsDay/.test(w))), "the upgrade is reported");
if (process.env.OUTDB) fs.writeFileSync(process.env.OUTDB, Buffer.from(await p.evaluate(() => Array.from(BQ.bytes()))));
const all = await p.evaluate(() => BQ.query("SELECT COUNT(*) AS n, SUM(SpawnsDay) AS d, SUM(SpawnsNight) AS m FROM enemies")[0]);
ok(all.n > 10 && all.d === all.n && all.m === all.n, `every mob out day and night (${all.d}/${all.m} of ${all.n})`);

await p.click("#tabs button[data-tab=mobs]");
await p.waitForSelector(".list .row");
await p.fill(".list input[type=search]", "wolf");
await p.click(".list .row:has-text('Wolf (7)')"); await p.waitForTimeout(300);
const labels = await p.$$eval(".form .grid > label", r => r.map(x => x.textContent));
ok(labels.includes("Spawns in day") && labels.includes("Spawns at night"), "both boxes are labelled");
ok(await p.$eval("input[name=SpawnsDay]", e => e.type === "checkbox" && e.checked), "Spawns in day ticked");
ok(await p.$eval("input[name=SpawnsNight]", e => e.checked), "Spawns at night ticked");

// night only
await p.uncheck("input[name=SpawnsDay]");
await p.click(".form .bar button.primary"); await p.waitForTimeout(300);
const wolf = await p.evaluate(() => BQ.query("SELECT SpawnsDay, SpawnsNight FROM enemies WHERE Name = 'Wolf'")[0]);
ok(wolf.SpawnsDay === 0 && wolf.SpawnsNight === 1, "Wolf saved night only");
await p.fill(".list input[type=search]", "wolf");
await p.click(".list .row:has-text('Wolf (7)')"); await p.waitForTimeout(300);
ok(await p.$eval("input[name=SpawnsDay]", e => !e.checked) && await p.$eval("input[name=SpawnsNight]", e => e.checked), "reopened: boxes as saved");

// new mobs default to both
await p.click(".list button.primary"); await p.waitForTimeout(200);
ok(await p.$eval("input[name=SpawnsDay]", e => e.checked) && await p.$eval("input[name=SpawnsNight]", e => e.checked), "new mob: both ticked");

const sql = await p.evaluate(() => BQ.api.export().sql);
{
  ok(/SpawnsDay INTEGER NOT NULL DEFAULT 1, SpawnsNight INTEGER NOT NULL DEFAULT 1/.test(sql), "Export SQL adds the columns");
  ok(/INSERT OR REPLACE INTO enemies|INTO enemies/.test(sql) && /'Wolf'/.test(sql), "Export SQL has the Wolf change");
}
ok(!errs.length, "no page errors " + errs.join(" | "));
await b.close();
