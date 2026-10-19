// Headless check of the map editor: painting redraws at once, sprite pickers,
// plots (draw, edit, move, resize, validation), Export SQL and Save .db.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-map-plots.mjs
// Writes export.sql and edited.db to OUT (default /tmp). Use a copy of the database.
import fs from "fs";
const { chromium } = await import(process.env.PW || "playwright-core");
const OUT = process.env.OUT || "/tmp";
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const frame = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const scr = (x, y) => p.evaluate(([x, y]) => { const r = M.cv.getBoundingClientRect(); return [r.left + (x + .5 - M.cx) * M.scale + M.cv.width / 2, r.top + (y + .5 - M.cy) * M.scale + M.cv.height / 2]; }, [x, y]);
const pix = (x, y) => p.evaluate(([x, y]) => { const c = M.cv; const px = (x + .5 - M.cx) * M.scale + c.width / 2, py = (y + .5 - M.cy) * M.scale + c.height / 2; return [...c.getContext("2d").getImageData(px, py, 1, 1).data].slice(0, 3).join(","); }, [x, y]);
const look = (x, y, s) => p.evaluate(([x, y, s]) => { M.cx = x; M.cy = y; M.scale = s; drawMapNow(); }, [x, y, s]);

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("canvas#map"); await p.waitForTimeout(1200);

// ---------- paint: picker, immediate redraw, objects without a checkbox, gapless drag
const T = await p.evaluate(() => { for (const t of S.world.tiles.values()) { const ok = k => { const u = S.world.tiles.get(k); return u && !/water|lava/i.test(S.world.strings[u[2]]) && !u[5] && !S.world.strings[u[3]] && !S.world.strings[u[6]]; };
  let all = true; for (let i = 0; i < 11; i++) if (!ok((t[0] + i) + "," + t[1])) { all = false; break; } if (all) return [t[0], t[1]]; } });
await look(T[0] + 6, T[1], 24); await p.waitForTimeout(800);
await p.click(".tools button:has-text('Paint tiles')");
ok(await p.$(".side .picker .pcell") !== null, "paint tool shows a sprite picker grid");
await p.fill(".side .picker-q", "Water");
await p.waitForTimeout(200);
const waterCell = await p.$(".side .picker .pcell[data-value*='Water' i]");
const waterVal = await waterCell.getAttribute("data-value");
await waterCell.click();
ok(await p.evaluate(() => M.brush.ground) === waterVal, "clicking a thumbnail sets the ground brush: " + waterVal);
ok(await p.$(".side .picker .pcell.sel") !== null, "picked sprite is highlighted");
await look(T[0] + 6, T[1], 24); await p.waitForTimeout(600);
const before = await pix(T[0], T[1]); const mid0 = await pix(T[0] + 5, T[1]);
let [sx, sy] = await scr(T[0], T[1]);
await p.mouse.move(sx, sy); await p.mouse.down(); await frame();
const during = await pix(T[0], T[1]);
ok(before !== during, `ground paint shows while the button is still down (${before} -> ${during})`);
// fast drag: one jump of 10 tiles
const [ex, ey] = await scr(T[0] + 10, T[1]);
await p.mouse.move(ex, ey, { steps: 1 }); await frame();
const gaps = await p.evaluate(([x, y, v]) => { const out = []; for (let i = 0; i <= 10; i++) { const t = S.world.tiles.get((x + i) + "," + y); if (S.world.strings[t[2]] !== v) out.push(x + i); } return out; }, [T[0], T[1], waterVal]);
ok(gaps.length === 0, "a fast drag paints every tile on the line (gaps: " + gaps.join(",") + ")");
ok(await pix(T[0] + 5, T[1]) !== mid0, "middle of the drag line is redrawn");
await p.mouse.up(); await p.waitForTimeout(300);
ok(/Saved 11 tile/.test(await p.textContent("#status")), "tiles stored on release: " + await p.textContent("#status"));
// object without any checkbox
await p.click(".side .pick-target button:has-text('Object')");
await p.fill(".side .picker-q", "Bar");
await p.click(".side .picker .pcell[data-value$='doors/Bar.png']");
ok(await p.evaluate(() => M.brush.fore) === "assets/world/doors/Bar.png", "object brush set by one click on its thumbnail");
const b2 = await pix(T[0] + 2, T[1]);
[sx, sy] = await scr(T[0] + 2, T[1]);
await p.mouse.click(sx, sy); await frame();
ok(await pix(T[0] + 2, T[1]) !== b2, "object paint visible at once");
// collision brush shows an overlay at sprite zoom
await p.click(".side .brow:has-text('Collision') button:has-text('Blocked')");
const b3 = await pix(T[0] + 4, T[1]);
[sx, sy] = await scr(T[0] + 4, T[1]);
await p.mouse.click(sx, sy); await frame();
ok(await pix(T[0] + 4, T[1]) !== b3, "collision paint visible (overlay) at sprite zoom");
// low zoom colour mode
await p.click(".side .brow:has-text('Collision') button:has-text('Keep')");
await p.click(".side .brow:has-text('Object') button:has-text('Keep')");
await look(T[0] + 6, T[1], 4); await p.waitForTimeout(500);
await p.click(".side .pick-target button:has-text('Ground')");
await p.fill(".side .picker-q", "Lava");
await p.click(".side .picker .pcell[data-value*='Lava']");
await look(T[0] + 6, T[1], 4); await p.waitForTimeout(300);
const b4 = await pix(T[0] + 7, T[1]);
[sx, sy] = await scr(T[0] + 7, T[1]);
await p.mouse.click(sx, sy); await p.waitForTimeout(400);
ok(await pix(T[0] + 7, T[1]) !== b4, `paint visible at low zoom (${b4} -> ${await pix(T[0] + 7, T[1])})`);
// recent row
ok((await p.$$(".side .picker-recent .pcell")).length >= 1, "recently used row shows");

// ---------- NPC sprite picker (modal) on the map
await p.click(".tools button:has-text('Select / drag')");
const sharon = await p.evaluate(() => S.c.npcs.find(n => n.Name === "Sharon Gazump"));
await look(sharon.SpawnX, sharon.SpawnY, 24); await p.waitForTimeout(400);
[sx, sy] = await scr(sharon.SpawnX, sharon.SpawnY);
await p.mouse.click(sx, sy); await p.waitForTimeout(300);
await p.click(".side button:has-text('Change sprite')");
ok(await p.$(".modal .picker .pcell") !== null, "NPC sprite picker opens as a modal grid");
await p.keyboard.press("Escape");
ok(await p.$(".modal") === null, "Esc closes the picker");

// ---------- plots
await p.click(".tools button:has-text('Plots')");
// find a free 6x5 area outside the forest, all tiles on the map, near Sharon
const spot = await p.evaluate(([sxx, syy]) => {
  for (let r = 3; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = sxx + dx, Y = syy + dy; let good = true;
    for (let y = Y; y < Y + 5 && good; y++) for (let x = X; x < X + 6 && good; x++) { const t = S.world.tiles.get(x + "," + y); if (!t || isFreeBuild(S.world.strings[t[4]])) good = false; }
    if (good && !plotIssues({ id: 0, Name: "x", X, Y, W: 6, H: 5, Rent: 1, MinLevel: 1, Agent: 0 }).errors.length) return [X, Y];
  } }, [sharon.SpawnX + 4, sharon.SpawnY + 4]);
ok(!!spot, "found a test spot " + spot);
await look(spot[0] + 3, spot[1] + 2, 20); await p.waitForTimeout(300);
let [ax, ay] = await scr(spot[0], spot[1]); let [bx, by] = await scr(spot[0] + 5, spot[1] + 4);
await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 5 });
await frame();
ok(await p.evaluate(() => M.drag && M.drag.plotRect && plotRectOf(M.drag).W === 6), "live rectangle while dragging");
await p.mouse.up(); await p.waitForTimeout(200);
ok(await p.evaluate(() => M.plotSel && M.plotSel.W === 6 && M.plotSel.H === 5 && M.plotSel.id === 0), "new plot selected after drawing");
ok(await p.evaluate(() => document.activeElement && document.activeElement.id === "plot-name"), "name field focused");
await p.fill("#plot-name", "Test Acre");
await p.fill("#plot-rent", "75");
await p.fill("#plot-level", "8");
await p.selectOption("#plot-agent", String(sharon.id));
await p.keyboard.press("Enter"); await p.waitForTimeout(300);
let rows = await p.evaluate(() => S.c.plots);
ok(rows.length === 1 && rows[0].Name === "Test Acre" && rows[0].Rent === 75 && rows[0].MinLevel === 8 && rows[0].Agent === sharon.id && rows[0].X === spot[0] && rows[0].Y === spot[1], "Enter saved the plot: " + JSON.stringify(rows[0]));
// move by dragging inside
[ax, ay] = await scr(spot[0] + 2, spot[1] + 2); [bx, by] = await scr(spot[0] + 3, spot[1] + 3);
await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(200);
ok(await p.evaluate(() => M.plotSel.X) === spot[0] + 1 && await p.evaluate(() => plotDirty()), "dragging moves the plot (unsaved)");
// resize by the east edge (handle)
const edge = await p.evaluate(() => { const s = M.plotSel, r = M.cv.getBoundingClientRect(); return [r.left + (s.X + s.W - M.cx) * M.scale + M.cv.width / 2, r.top + (s.Y + s.H / 2 - M.cy) * M.scale + M.cv.height / 2]; });
await p.mouse.move(edge[0], edge[1]); 
ok(await p.evaluate(() => M.cv.style.cursor) === "ew-resize", "resize cursor on the edge");
await p.mouse.down(); await p.mouse.move(edge[0] - 2 * 20, edge[1], { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(200);
ok(await p.evaluate(() => M.plotSel.W) === 4, "edge drag resizes to 4 wide: " + await p.evaluate(() => M.plotSel.W));
await p.click("#plot-save"); await p.waitForTimeout(300);
rows = await p.evaluate(() => S.c.plots);
ok(rows[0].X === spot[0] + 1 && rows[0].Y === spot[1] + 1 && rows[0].W === 4 && rows[0].H === 5, "moved/resized plot saved: " + JSON.stringify(rows[0]));
// overlap: draw over it
await p.keyboard.press("Escape");
[ax, ay] = await scr(spot[0], spot[1]); [bx, by] = await scr(spot[0] + 2, spot[1] + 2);
await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(200);
ok(await p.$eval("#plot-save", b => b.disabled) && /Overlaps/.test(await p.textContent("#plot-check")), "overlapping plot can't be saved");
const dbErr = await p.evaluate(() => { try { BQ.api.save({ table: "plot", row: { id: 0, Name: "Bad", X: M.plotSel.X, Y: M.plotSel.Y, W: 3, H: 3, Rent: 1, MinLevel: 1, Agent: 0 } }); return ""; } catch (e) { return e.message; } });
ok(/overlaps/.test(dbErr), "database refuses overlap too: " + dbErr);
p.on("dialog", d => d.accept());
await p.click("#plot-form-box button:has-text('Discard')");
// forest
const ff = await p.evaluate(() => { for (const t of S.world.tiles.values()) if (S.world.strings[t[4]] === "Foundation Forest") return [t[0], t[1]]; });
const ffErr = await p.evaluate(([x, y]) => { try { BQ.api.save({ table: "plot", row: { id: 0, Name: "Forest", X: x, Y: y, W: 2, H: 2, Rent: 1, MinLevel: 1, Agent: 0 } }); return ""; } catch (e) { return e.message; } }, ff);
ok(/Foundation Forest/.test(ffErr), "database refuses a plot in Foundation Forest: " + ffErr);
ok(await p.evaluate(([x, y]) => plotIssues({ id: 0, Name: "F", X: x, Y: y, W: 2, H: 2, Rent: 1, MinLevel: 1, Agent: 0 }).errors.some(e => /Foundation Forest/.test(e)), ff), "editor flags Foundation Forest live");
const agErr = await p.evaluate(([x, y]) => { try { BQ.api.save({ table: "plot", row: { id: 0, Name: "A", X: x, Y: y, W: 2, H: 2, Rent: 1, MinLevel: 1, Agent: 1 } }); return ""; } catch (e) { return e.message; } }, [spot[0] + 30, spot[1]]);
ok(/Land Agent|overlap|off the map|Forest/.test(agErr), "database refuses a non-agent Agent: " + agErr);

// ---------- export SQL and Save .db
await p.click("#tabs button[data-tab=export]"); await p.waitForTimeout(300);
const sql = await p.textContent("pre.sql");
fs.writeFileSync(OUT + "/export.sql", sql);
ok(/plot_upgrade/.test(sql) && /INSERT OR REPLACE INTO plot/.test(sql), "export has the plot schema block and the plot rows");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-save")]);
await dl.saveAs(OUT + "/edited.db");
ok(fs.existsSync(OUT + "/edited.db"), "Save .db downloaded");
ok(errs.length === 0, "no page errors " + errs.join(" | "));
await b.close();
