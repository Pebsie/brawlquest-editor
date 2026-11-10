// Headless check of the Season tab: the switch (on / off / auto with dates), the per-town list, adding,
// editing and deleting a prop, the checks, and that the tables are created when the db has none.
// Use a copy of a db with content/migrations/2026-11-10-christmas.sql applied (DB) and, optionally, one
// without the season tables (DB_EMPTY).
//   python3 -m http.server 8766 &   (in this folder)
//   DB=/path/with.db DB_EMPTY=/path/without.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome SHOTS=/dir node tests/headless-season.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8766/index.html";
const SHOTS = process.env.SHOTS || "";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errs = [];
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
async function open(file) {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on("pageerror", e => errs.push(String(e)));
  p.on("dialog", d => d.accept());
  await p.goto(URL);
  await p.setInputFiles("#open", file);
  await p.waitForSelector("#tabs:not([hidden])"); await p.waitForTimeout(600);
  await p.click("#tabs button[data-tab=season]");
  await p.waitForSelector("[data-towns], [data-act=save-switch]");
  return p;
}
const tables = p => p.evaluate(() => BQ.api.loreTables());

let p = await open(process.env.DB);
const shot = n => SHOTS ? p.screenshot({ path: `${SHOTS}/${n}.png` }) : null;
const t0 = await tables(p);
const n0 = t0.season_deco.rows.length;
ok(n0 >= 100 && t0.season.rows[0].Name === "christmas", "the shipped season has " + n0 + " props and a switch row");
const towns = await p.$$eval("[data-town]", e => e.map(x => x.dataset.town));
for (const t of ["Squall's End", "Riverbridge", "Elodine's Gift", "Rise Village", "Hunter's Farm", "Shieldbreak", "Great Arena"]) ok(towns.includes(t), "town listed: " + t);
ok(/all clear/.test(await p.textContent("#main")), "no problems reported for the shipped props");
await shot("season-editor-towns");

// pick a town: only its props are listed
await p.click("[data-town='Riverbridge'] button"); await p.waitForTimeout(150);
const rb = await p.$$eval("[data-prop]", e => e.length);
ok(rb > 10 && rb < n0 && (await p.$$eval("[data-prop] [data-key=Town]", e => e.every(x => x.value === "Riverbridge"))), "a town lists only its own props (" + rb + ")");

// the switch
ok(/Shown today/.test(await p.textContent("[data-active]")), "mode on: shown today");
await p.selectOption("[data-key=Mode]", "off"); await p.waitForTimeout(100);
ok(/Not shown today/.test(await p.textContent("[data-active]")), "mode off: not shown");
await p.click("[data-act=save-switch]"); await p.waitForTimeout(250);
ok((await tables(p)).season.rows[0].Mode === "off", "switch saved as off");
ok((await tables(p)).season_deco.rows.length === n0, "no prop was deleted by switching off");
await p.selectOption("[data-key=Mode]", "auto");
await p.fill("[data-key=AutoFrom]", "13/01");
await p.click("[data-act=save-switch]"); await p.waitForTimeout(150);
ok((await tables(p)).season.rows[0].Mode === "off", "bad dates are refused");
await p.fill("[data-key=AutoFrom]", "12-01"); await p.fill("[data-key=AutoTo]", "01-06");
await p.click("[data-act=save-switch]"); await p.waitForTimeout(250);
const auto = (await tables(p)).season.rows[0];
ok(auto.Mode === "auto" && auto.AutoFrom === "12-01" && auto.AutoTo === "01-06", "auto window saved");
const win = await p.evaluate(() => [new Date(2026, 11, 25), new Date(2027, 0, 3), new Date(2026, 6, 1), new Date(2026, 10, 30), new Date(2027, 0, 7)].map(d => seasonActive({ Mode: "auto", AutoFrom: "12-01", AutoTo: "01-06" }, d)));
ok(JSON.stringify(win) === "[true,true,false,false,false]", "the window wraps the new year: " + win);
await p.selectOption("[data-key=Mode]", "on");
await p.click("[data-act=save-switch]"); await p.waitForTimeout(250);

// add, edit, delete a prop
await p.click("[data-act=add-prop]"); await p.waitForTimeout(100);
const row = await p.$("[data-prop=new]");
await (await row.$("[data-key=Kind]")).fill("snowman");
await (await row.$("[data-key=X]")).fill("33");
await (await row.$("[data-key=Y]")).fill("-1");
await (await row.$("[data-act=save-prop]")).click(); await p.waitForTimeout(250);
const made = (await tables(p)).season_deco.rows.find(r => r.Kind === "snowman" && r.X === 33 && r.Y === -1);
ok(made && made.Season === "christmas" && made.Town === "Riverbridge", "new prop saved in the open town: " + JSON.stringify(made));
await p.fill(`[data-prop='${made.id}'] [data-key=Kind]`, "lights");
await p.click(`[data-prop='${made.id}'] [data-act=save-prop]`); await p.waitForTimeout(250);
ok(/needs X2 and Y2/.test(await p.textContent("[data-issues]")), "lights without a far end are reported");
await p.fill(`[data-prop='${made.id}'] [data-key=X2]`, "36");
await p.fill(`[data-prop='${made.id}'] [data-key=Y2]`, "-1");
await p.click(`[data-prop='${made.id}'] [data-act=save-prop]`); await p.waitForTimeout(250);
const lit = (await tables(p)).season_deco.rows.find(r => r.id === made.id);
ok(lit.Kind === "lights" && lit.X2 === 36 && lit.Y2 === -1, "edited prop saved with its far end");
ok(/all clear/.test(await p.textContent("#main")), "checks clear again");
await p.click(`[data-prop='${made.id}'] [data-act=delete-prop]`); await p.waitForTimeout(250);
ok((await tables(p)).season_deco.rows.length === n0, "prop deleted, the rest untouched");
await p.fill("[data-prop] [data-key=Kind] >> nth=0", "snowmann");
await p.click("[data-prop] [data-act=save-prop] >> nth=0"); await p.waitForTimeout(150);
ok((await tables(p)).season_deco.rows.length === n0 && !(await tables(p)).season_deco.rows.some(r => r.Kind === "snowmann"), "an unknown kind is refused");

// the migration export carries the changes
await p.click("#tabs button[data-tab=export]"); await p.waitForSelector("pre.sql");
const sql = await p.textContent("pre.sql");
ok(/season_deco/.test(sql) && /UPDATE|INSERT OR REPLACE INTO season/.test(sql), "Export SQL records the season edits");
ok(errs.length === 0, "no page errors: " + errs.join("; "));

// a db without the tables: the tab explains, and the first save creates them
if (process.env.DB_EMPTY) {
  p = await open(process.env.DB_EMPTY);
  ok(/no switch row/.test(await p.textContent("#main")), "no tables: the tab says there is no switch");
  await p.selectOption("[data-key=Mode]", "on");
  await p.click("[data-act=save-switch]"); await p.waitForTimeout(250);
  let t = await tables(p);
  ok(t.season.exists && t.season.rows[0].Mode === "on", "the switch table is created on the first save");
  await p.click("[data-act=add-prop]"); await p.waitForTimeout(100);
  const r2 = await p.$("[data-prop=new]");
  await (await r2.$("[data-key=Kind]")).fill("tree"); await (await r2.$("[data-key=Variant]")).fill("2");
  await (await r2.$("[data-key=Town]")).fill("Test");
  await (await r2.$("[data-act=save-prop]")).click(); await p.waitForTimeout(250);
  t = await tables(p);
  ok(t.season_deco.exists && t.season_deco.rows.length === 1 && t.season_deco.rows[0].Season === "christmas", "the props table is created on the first prop");
  ok(errs.length === 0, "no page errors (empty db): " + errs.join("; "));
}
await b.close();
