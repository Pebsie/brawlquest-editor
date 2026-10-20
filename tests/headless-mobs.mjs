// Headless check of the Mobs tab (use a db with the 2026-10-19 Wraith migration applied): list/search, create, edit, rename, delete,
// boss pattern primitives (add, edit, reorder, scripted zones), the preview,
// and Export SQL.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-mobs.mjs
import fs from "fs";
const { chromium } = await import(process.env.PW || "playwright-core");
const OUT = process.env.OUT || "/tmp";
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
await p.click("#tabs button[data-tab=mobs]");
await p.waitForSelector(".list .row");
const n = await p.$$eval(".list .row", r => r.length);
ok(n > 10, `mob list shows ${n} enemies`);
await p.fill(".list input[type=search]", "wraith");
ok((await p.$$eval(".list .row", r => r.map(x => x.textContent))).every(t => /wraith/i.test(t)), "filter narrows the list");
await p.click(".list .row"); await p.waitForTimeout(300);
ok(/Wraith/.test(await p.textContent(".form h2")), "Wraith opens");
ok(await p.$$eval(".prim", r => r.length) >= 1, "Wraith shows its zone primitive");
ok(await p.$eval(".prim [data-key=tile]", e => e.checked), "tile option shown checked");

// Create
await p.click(".list button.primary");
await p.fill(".form .grid input[type=text]", "Test Bullet Lord");
await p.click(".form .bar button.primary");
await p.waitForTimeout(300);
const created = await p.evaluate(() => S.c.enemies.find(e => e.Name === "Test Bullet Lord"));
ok(created && created.id > 0, "new mob created with id " + (created && created.id));
ok(/#mob\/\d+/.test(await p.evaluate(() => location.hash)), "route is #mob/ID");

// Sprite picker
await p.click(".form button:has-text('Pick sprite')");
await p.waitForSelector(".modal .pcell");
const val = await p.getAttribute(".modal .pcell[data-value*='monsters']", "data-value");
await p.click(`.modal .pcell[data-value='${val}']`);
await p.click(".form .bar button.primary");
await p.waitForTimeout(300);
ok(await p.evaluate(n => S.c.enemies.find(e => e.Name === n).Image, "Test Bullet Lord") === val, "sprite picked and saved: " + val);

// Knockback resist (enemies.KnockbackResist): bosses immune, tunable 0..1
ok(await p.evaluate(() => S.c.enemyCols.includes("KnockbackResist")), "enemies have the KnockbackResist column");
ok(await p.evaluate(() => S.c.enemies.filter(e => e.KnockbackResist === 1).some(e => e.Name === "Skeleton King")), "bosses are knockback immune (Skeleton King = 1)");
ok(await p.evaluate(() => S.c.enemies.find(e => e.Name === "Spider").KnockbackResist === 0), "normal mobs keep full knockback (Spider = 0)");
const kbIn = ".form .grid input[type=number][max='1']";
ok(await p.$eval(kbIn, e => e.value) === "0", "new mob defaults to full knockback");
await p.fill(kbIn, "2");
await p.click(".form .bar button.primary"); await p.waitForTimeout(300);
ok(/knockback resist is 0/.test(await p.textContent("#status")), "out-of-range knockback refused");
await p.fill(kbIn, "0.75");
await p.click(".form .bar button.primary"); await p.waitForTimeout(300);
ok(await p.evaluate(n => S.c.enemies.find(e => e.Name === n).KnockbackResist, "Test Bullet Lord") === 0.75, "knockback resist 0.75 saved");

// Primitives: preset ring, add zone, edit, scripted move, reorder
await p.selectOption(".mobprims select:not([data-key])", "Ring burst");
await p.click(".mobprims button:has-text('+ Zone')");
await p.click(".mobprims button:has-text('+ Soak')");
ok(await p.$$eval(".prim", r => r.length) === 3, "three primitives added");
const z2 = ".prim[data-i='1']";
await p.fill(`${z2} [data-key=count]`, "4");
await p.selectOption(`${z2} [data-key=formation]`, "line");
await p.selectOption(`${z2} [data-key=move]`, "path");
await p.fill(`${z2} [data-key=path]`, "2,0; 2,2");
await p.check(`${z2} [data-key=loop]`);
await p.click(".prim[data-i='2'] button[title='Move up']");
const json = JSON.parse(await p.textContent(".mobprims details pre"));
ok(json.length === 3 && json[1].do === "soak" && json[2].move === "path" && json[2].loop && json[2].count === 4 && json[0].formation === "ring", "stored JSON reflects edits and reorder: " + JSON.stringify(json[2]));
await p.click("#save-patterns");
await p.waitForTimeout(300);
const rows = await p.evaluate(id => S.c.patterns.filter(r => r.EnemyID === id), created.id);
ok(rows.length === 1 && JSON.parse(rows[0].Pattern).length === 3, "saved as one boss_patterns row");

// Preview runs and draws zones
await p.waitForTimeout(1500);
const sim = await p.evaluate(() => ({ t: S.mobPreview.state.tick, z: S.mobPreview.state.zones.length + S.mobPreview.state.flashes.length }));
ok(sim.t >= 20 && sim.z > 0, `preview ticking (t=${sim.t}, zones=${sim.z})`);
const painted = await p.evaluate(() => { const c = document.querySelector(".mobcv"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let r = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 160 && d[i + 2] < 140) r++; return r; });
ok(painted > 50, "red zones drawn on the preview canvas (" + painted + " px)");
await p.screenshot({ path: OUT + "/mobs-tab.png" });

// Validation: list formation without offsets
await p.selectOption(".prim[data-i='0'] [data-key=formation]", "list");
await p.click("#save-patterns");
ok(/needs offsets/.test(await p.textContent("#status")), "invalid primitive refused: " + await p.textContent("#status"));

// Rename moves spawns; delete blocked while placed
await p.evaluate(async id => { await api("tiles", [{ X: 0, Y: 0, Set: { Enemy: "Test Bullet Lord" } }]); await loadAll(); S.mob = { id }; renderTab(); }, created.id);
await p.waitForTimeout(200);
await p.fill(".form .grid input[type=text]", "Test Bullet King");
await p.click(".form .bar button.primary"); await p.waitForTimeout(300);
ok(await p.evaluate(() => BQ.api.world().strings.includes("Test Bullet King")), "rename updated map spawns");
await p.click(".form .bar button.danger"); await p.waitForTimeout(200);
ok(/placed on 1 map tile/.test(await p.textContent("#status")), "delete refused while placed");
await p.evaluate(async () => { await api("tiles", [{ X: 0, Y: 0, Set: { Enemy: "" } }]); await loadAll(); renderTab(); });
await p.waitForTimeout(200);
await p.click(".form .bar button.danger"); await p.waitForTimeout(300);
ok(await p.evaluate(id => !S.c.enemies.some(e => e.id === id) && !S.c.patterns.some(r => r.EnemyID === id), created.id), "deleted with its patterns");

// Export
await p.click("#tabs button[data-tab=export]");
await p.waitForSelector("h2:has-text('Export changes')");
const sql = await p.textContent(".form > pre.sql");
ok(/CREATE TABLE IF NOT EXISTS boss_patterns/.test(sql) && /INSERT OR REPLACE INTO enemies/.test(sql) && /DELETE FROM boss_patterns WHERE EnemyID/.test(sql), "Export SQL has the enemy and pattern statements");
ok(/KnockbackResist REAL NOT NULL DEFAULT 0/.test(sql) && sql.indexOf("enemies_upgrade") < sql.indexOf("INSERT OR REPLACE INTO enemies"), "Export SQL adds KnockbackResist before the enemy rows");
fs.writeFileSync(OUT + "/mobs-export.sql", sql);
ok(errs.length === 0, "no page errors " + errs.join(" | "));
await b.close();
