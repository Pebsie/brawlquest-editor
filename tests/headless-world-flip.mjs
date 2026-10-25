// Headless check of flipped map objects: the Paint brush Flip toggle and F,
// painting a flipped object (world_flip row, drawn mirrored), Alt-click
// copying the flip, Select > Flip object / F, unflip, Export SQL carrying the
// table, and a db that has no world_flip table yet.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-world-flip.mjs
// SHOT=/path/to.png writes a screenshot of a flipped and an unflipped object.
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 1500, height: 920 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const scr = (x, y) => p.evaluate(([x, y]) => { const r = M.cv.getBoundingClientRect(); return [r.left + (x + .5 - M.cx) * M.scale + M.cv.width / 2, r.top + (y + .5 - M.cy) * M.scale + M.cv.height / 2]; }, [x, y]);
const look = (x, y, s) => p.evaluate(([x, y, s]) => { M.cx = x; M.cy = y; M.scale = s; drawMapNow(); }, [x, y, s]);
const flipped = (x, y) => p.evaluate(([x, y]) => BQ.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'world_flip'")[0].n ? BQ.query("SELECT COUNT(*) AS n FROM world_flip WHERE X = ? AND Y = ?", [x, y])[0].n : 0, [x, y]);
const click = async (x, y, mods) => { const [sx, sy] = await scr(x, y); await p.mouse.move(sx, sy); if (mods) await p.keyboard.down(mods); await p.mouse.down(); await p.mouse.up(); if (mods) await p.keyboard.up(mods); await p.waitForTimeout(150); };

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("canvas#map"); await p.waitForTimeout(1000);
const hadTable = await p.evaluate(() => BQ.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'world_flip'")[0].n > 0);
console.log("db has world_flip:", hadTable);

// Paint a chair, normal then flipped, side by side
const X = 20, Y = 20, OBJ = "assets/world/objects/Chair1.png";
await p.click(".tools button:has-text('Paint tiles')");
ok(await p.$(".side .brow .bl:text-is('Flip')") !== null, "the brush has a Flip row");
await p.evaluate(o => { M.brush.fore = o; M.brush.flip = false; drawSide(); }, OBJ);
await look(X + 0.5, Y, 48); await p.waitForTimeout(200);
await click(X, Y);
ok(await flipped(X, Y) === 0, "a normal paint adds no flip row");
await p.keyboard.press("f");
ok(await p.evaluate(() => M.brush.flip === true), "F flips the brush");
ok(await p.$(".side .brow .seg button.on:text-is('Flipped')") !== null, "the toggle shows Flipped");
await click(X + 1, Y);
ok(await flipped(X + 1, Y) === 1, "a flipped paint writes world_flip");
ok(await p.evaluate(([x, y]) => tile(x, y)[8] === 1, [X + 1, Y]), "the map tile is flipped in memory");
ok(await p.evaluate(([x, y]) => BQ.query("SELECT ForegroundTile FROM world WHERE X = ? AND Y = ?", [x, y])[0].ForegroundTile, [X + 1, Y]) === OBJ, "the object is painted too");
if (process.env.SHOT) { await p.evaluate(() => { M.hover = null; drawMapNow(); }); await p.locator("canvas#map").screenshot({ path: process.env.SHOT }); }
await p.keyboard.press("f");
ok(await p.evaluate(() => M.brush.flip === false), "F again: normal");
// Alt-click copies the flip
await click(X + 1, Y, "Alt");
ok(await p.evaluate(() => M.brush.flip === true && M.brush.fore === "assets/world/objects/Chair1.png"), "Alt-click copies the object and its flip");
// Painting an object over a flipped one with a normal brush unflips it
await p.evaluate(() => { M.brush.flip = false; });
await click(X + 1, Y);
ok(await flipped(X + 1, Y) === 0, "repainting normal clears the flip");

// Select: button and F
await p.click(".tools button:has-text('Select')");
await click(X, Y);
ok(await p.$(".side button:text-is('Flip object')") !== null, "Select shows Flip object");
await p.click(".side button:text-is('Flip object')"); await p.waitForTimeout(150);
ok(await flipped(X, Y) === 1, "Flip object flips the selected tile");
ok(await p.$(".side button:text-is('Unflip object')") !== null, "then offers Unflip");
await p.keyboard.press("f"); await p.waitForTimeout(150);
ok(await flipped(X, Y) === 0, "F on the selection unflips");
await p.keyboard.press("f"); await p.waitForTimeout(150);
ok(await flipped(X, Y) === 1, "F flips again");

// Export carries the table and the rows
const sql = await p.evaluate(() => BQ.api.export().sql);
ok(/CREATE TABLE IF NOT EXISTS world_flip/.test(sql), "export has the world_flip table");
ok(sql.includes(`INSERT OR IGNORE INTO world_flip (X, Y) VALUES (${X}, ${Y});`), "export has the flip");
ok(sql.includes(`DELETE FROM world_flip WHERE X = ${X + 1} AND Y = ${Y};`), "export has the unflip");
// Reload from the db: flips come back
await p.evaluate(() => loadWorld()); await p.waitForTimeout(300);
ok(await p.evaluate(([x, y]) => tile(x, y)[8] === 1 && tile(x + 1, y)[8] === 0, [X, Y]), "world reload reads world_flip");

ok(errs.length === 0, "no page errors " + errs.join(" | "));
await b.close();
