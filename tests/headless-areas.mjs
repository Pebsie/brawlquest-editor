// Headless check of Map > Areas: the list, New / Duplicate / Delete, the
// properties panel, paint, erase, room fill, Alt-click pick, the overlay, the
// Zone brush rename, Export SQL and a db without the areas tables.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/seeded/bq-content.db BARE=/path/to/db-without-areas PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-areas.mjs
// SHOT=/path/to.png writes a screenshot of the Areas tool.
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
const dbArea = (x, y) => p.evaluate(([x, y]) => { const r = BQ.query("SELECT AreaID FROM area_tiles WHERE X = ? AND Y = ?", [x, y]); return r.length ? r[0].AreaID : 0; }, [x, y]);
const click = async (x, y, mods) => { const [sx, sy] = await scr(x, y); await p.mouse.move(sx, sy); if (mods) await p.keyboard.down(mods); await p.mouse.down(); await p.mouse.up(); if (mods) await p.keyboard.up(mods); await p.waitForTimeout(150); };

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("canvas#map"); await p.waitForTimeout(1000);

// Zone brush rename
await p.click(".tools button:has-text('Paint tiles')");
ok(await p.$(".side .brow .bl:text-is('Zone')") !== null && await p.$(".side .brow .bl:text-is('Area')") === null, "the old Area brush is called Zone");
ok(await p.$(".side label:has-text('Show zone names')") !== null, "overlay says Show zone names");

await p.click(".tools button:text-is('Areas')");
const n0 = await p.evaluate(() => AR.list.length);
ok(n0 === 44 && (await p.$$(".arearow")).length === 44, `area list shows the ${n0} seeded areas`);
ok(/Squall's End \(inside\)/.test(await p.textContent(".arealist")), "names listed");

// select by Alt-click on a seeded house tile
await look(11, -5, 24); await p.waitForTimeout(300);
await click(11, -5, "Alt");
const squall = await p.evaluate(() => AR.sel && AR.byId.get(AR.sel).Name);
ok(squall === "Squall's End (inside)", "Alt-click picks the area under the cursor: " + squall);
ok(await p.$(".areaprops #area-name") !== null, "properties panel shows for the selection");

// new area, rename, properties
await p.click(".side button:text-is('New')");
const nid = await p.evaluate(() => AR.sel);
await p.fill("#area-name", "Test porch");
await p.waitForTimeout(500);
ok(await p.evaluate(id => BQ.query("SELECT Name FROM areas WHERE id = ?", [id])[0].Name, nid) === "Test porch", "New + rename saves to areas");
await p.click(".areaprops .seg button:text-is('Outside')");
await p.waitForTimeout(100);
const rainBox = await p.$(".areaprops input[type=checkbox]");
ok(!(await rainBox.isDisabled()) && await rainBox.isChecked(), "outside: rain toggle enabled and on");
await rainBox.uncheck(); await p.waitForTimeout(100);
await p.selectOption(".areaprops select", "hall"); await p.waitForTimeout(100);
const row = await p.evaluate(id => BQ.query("SELECT Interior, Weather, Reverb FROM areas WHERE id = ?", [id])[0], nid);
ok(row.Interior === "none" && row.Weather === 0 && row.Reverb === "hall", "Interior, rain and reverb saved: " + JSON.stringify(row));

// paint with a 2 brush, then erase one tile
await p.click(".side .brow .seg button:text-is('2')");
const free = await p.evaluate(() => { for (const t of S.world.tiles.values()) { let all = true; for (let dx = 0; dx < 6; dx++) for (let dy = 0; dy < 3; dy++) { const u = S.world.tiles.get((t[0] + dx) + "," + (t[1] + dy)); if (!u || AR.at.has((t[0] + dx) + "," + (t[1] + dy))) all = false; } if (all) return [t[0], t[1]]; } });
await look(free[0] + 3, free[1] + 1, 24); await p.waitForTimeout(200);
{ const [ax, ay] = await scr(free[0] + 1, free[1] + 1), [bx, by] = await scr(free[0] + 4, free[1] + 1);
  await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 1 }); await p.mouse.up(); await p.waitForTimeout(200); }
const painted = await p.evaluate(id => BQ.query("SELECT COUNT(*) AS n FROM area_tiles WHERE AreaID = ?", [id])[0].n, nid);
ok(painted === 10, `a 2-wide drag over 5 columns paints 10 tiles, no gaps (${painted})`);
await p.click(".side .seg button:text-is('Erase')");
await p.click(".side .brow .seg button:text-is('1')");
await click(free[0] + 2, free[1] + 1);
ok(await dbArea(free[0] + 2, free[1] + 1) === 0 && await dbArea(free[0] + 3, free[1] + 1) === nid, "erase unpaints just that tile");

// room fill: a floor of the Office of National Class Enrollment
await p.click(".arearow:has-text('Test porch')");
await p.click(".side .seg button:text-is('Room fill')");
const room = await p.evaluate(() => { const t = S.world.tiles.get("12,19"); return t && S.world.strings[t[2]]; });
await look(12, 19, 24); await p.waitForTimeout(200);
await click(12, 19);
const filled = await p.evaluate(([id, g]) => { const r = BQ.query("SELECT a.X, a.Y FROM area_tiles a WHERE AreaID = ?", [id]);
  return { n: r.length, same: r.filter(t => { const u = S.world.tiles.get(t.X + "," + t.Y); return u && S.world.strings[u[2]] === g; }).length }; }, [nid, room]);
ok(filled.n > 15 && filled.same >= filled.n - 9, `room fill took the connected ${room.split("/").pop()} (${filled.same} of ${filled.n} tiles with that ground)`);

// overlay draws in the area colour
const px = await p.evaluate(() => { const c = M.cv, g = c.getContext("2d"); const x = (12 + .5 - M.cx) * M.scale + c.width / 2, y = (19 + .5 - M.cy) * M.scale + c.height / 2; return [...g.getImageData(x, y, 1, 1).data].slice(0, 3); });
ok(px.some(v => v > 0), "overlay drawn");
ok(await p.evaluate(() => areaNameAt(12, 19)) === "Test porch", "hover readout and tile info read the area (areaNameAt)");

// duplicate, delete
await p.click(".side button:text-is('Duplicate')");
ok(await p.evaluate(() => AR.byId.get(AR.sel).Name) === "Test porch copy", "Duplicate copies the properties");
await p.click(".side button:text-is('Delete')"); await p.waitForTimeout(150);
ok(await p.evaluate(() => AR.list.length) === n0 + 1, "Delete removes it");

// export
await p.click("#tabs button[data-tab=export]"); await p.waitForTimeout(400);
const sql = await p.evaluate(() => BQ.api.export().sql);
ok(/CREATE TABLE IF NOT EXISTS areas/.test(sql) && /INSERT OR REPLACE INTO area_tiles/.test(sql) && /INSERT OR REPLACE INTO areas/.test(sql), "Export SQL has the areas schema and keyed rows");
ok(/Areas: /.test(await p.evaluate(() => BQDump.diff(BQDump.fingerprint(() => []), BQDump.fingerprint(BQ.query)).text)), "change summaries label the Areas table");

if (process.env.SHOT) {
  await p.click("#tabs button[data-tab=map]"); await p.waitForTimeout(300);
  await p.click(".tools button:text-is('Areas')");
  await p.evaluate(() => { const a = AR.list.find(a => a.Name === "Squall's End (inside)"); AR.sel = a.id; AR.mode = "paint"; AR.size = 2; drawSide(); });
  await look(9, -3, 26); await p.waitForTimeout(1500);
  const [hx, hy] = await scr(11, -5); await p.mouse.move(hx, hy); await p.waitForTimeout(300);
  await p.screenshot({ path: process.env.SHOT });
  console.log("screenshot", process.env.SHOT);
}

// a db without the tables
if (process.env.BARE) {
  await p.setInputFiles("#open", process.env.BARE);
  await p.waitForTimeout(1200);
  await p.click("#tabs button[data-tab=map]"); await p.waitForTimeout(300);
  await p.click(".tools button:text-is('Areas')");
  ok(await p.$(".side button:has-text('Create the tables')") !== null, "no tables: offers to create them");
  await p.click(".side button:has-text('Create the tables')"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !AR.missing && AR.list.length === 0), "created, empty");
}
ok(!errs.length, "no page errors " + errs.join(" | "));
await b.close();
