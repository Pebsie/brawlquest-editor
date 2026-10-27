// NPC placements (npc_spawn): the Map's NPCs tool places someone you have or
// a new NPC where you tap, drags a placement, removes one; the NPC sheet lists
// every place; saves keep columns the form doesn't send (Daily, the dialogue
// columns). Desktop and a 390x844 phone with touch.
// Serve this folder on 127.0.0.1:8977 first (or set URL); DB is a content db
// from before npc_spawn (the editor adds it on the first placement).
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html", DB = process.env.DB || "/workspace/npcwork/test.db", OUT = process.env.OUT || "/workspace/npcwork/";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const open = async (w, hgt, hash, mob = w < 700) => {
  const m = await (await b.newContext({ viewport: { width: w, height: hgt }, hasTouch: mob, isMobile: mob, deviceScaleFactor: mob ? 2 : 1 })).newPage();
  m.on("pageerror", e => errs.push(`${w} pageerror ` + e.stack)); m.on("console", x => { if (x.type() === "error" && !/404/.test(x.text())) errs.push(`${w} console ` + x.text()); });
  m.on("dialog", d => d.accept());
  await m.goto(URL); await m.setInputFiles("#open", DB); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(500);
  await m.evaluate(h => { location.hash = h; }, hash); await m.waitForTimeout(1500);
  return m;
};
// page coordinates of the middle of tile x,y on the big map
const tileAt = (m, x, y) => m.evaluate(([x, y]) => { const r = M.cv.getBoundingClientRect(); return { x: r.left + (x - M.cx) * M.scale + M.cv.width / 2 + M.scale / 2, y: r.top + (y - M.cy) * M.scale + M.cv.height / 2 + M.scale / 2 }; }, [x, y]);
const spawns = (m, id) => m.evaluate(id => BQ.api.content().npcSpawns.filter(s => s.NPC === id).map(s => [s.X, s.Y]), id);
const npcRow = (m, id) => m.evaluate(id => BQ.api.content().npcs.find(n => n.id === id), id);

{ // ---- desktop
  const m = await open(1400, 900, "#map/npc/1300");
  ok(await m.evaluate(() => M.tool === "npc" && M.npcPick === 1300), "#map/npc/1300 opens the NPCs tool with Sergeant Crumb picked");
  ok(!(await m.evaluate(() => BQ.api.content().hasSpawns)), "an old db has no npc_spawn yet");
  const c0 = await npcRow(m, 1300);
  let p = await tileAt(m, c0.SpawnX + 4, c0.SpawnY + 1);
  await m.mouse.click(p.x, p.y); await m.waitForTimeout(600);
  let sp = await spawns(m, 1300);
  ok(sp.length === 2 && sp.some(s => s[0] === c0.SpawnX && s[1] === c0.SpawnY) && sp.some(s => s[0] === c0.SpawnX + 4 && s[1] === c0.SpawnY + 1), "a click puts Crumb in a second place (first kept from SpawnX/Y): " + JSON.stringify(sp));
  const all = await m.evaluate(() => { const c = BQ.api.content(); return { npcs: c.npcs.filter(n => n.SpawnX > -999).length, spawns: c.npcSpawns.length }; });
  ok(all.spawns === all.npcs + 1, `the first placement turned npc_spawn on for every placed NPC (${all.spawns} placements, ${all.npcs} placed NPCs)`);
  ok(await m.$eval(".side", e => /2 places/.test(e.textContent)), "the panel lists both of Crumb's places");
  await m.screenshot({ path: OUT + "map-npc-desktop.png" });

  // drag the new one 2 tiles right
  p = await tileAt(m, c0.SpawnX + 4, c0.SpawnY + 1); const q = await tileAt(m, c0.SpawnX + 6, c0.SpawnY + 1);
  await m.mouse.move(p.x, p.y); await m.mouse.down(); await m.mouse.move(q.x, q.y, { steps: 5 }); await m.mouse.up(); await m.waitForTimeout(600);
  sp = await spawns(m, 1300);
  ok(sp.some(s => s[0] === c0.SpawnX + 6) && !sp.some(s => s[0] === c0.SpawnX + 4), "dragging moves that placement: " + JSON.stringify(sp));
  ok((await npcRow(m, 1300)).SpawnX === c0.SpawnX, "SpawnX still mirrors the first placement");

  // a brand new NPC
  await m.click('.side .seg button:has-text("A new NPC")'); await m.waitForTimeout(200);
  await m.fill('.npcnew input[placeholder^="Name"]', "Gate Warden");
  p = await tileAt(m, c0.SpawnX + 2, c0.SpawnY + 3);
  await m.mouse.click(p.x, p.y); await m.waitForTimeout(700);
  const gw = await m.evaluate(() => BQ.api.content().npcs.find(n => n.Name === "Gate Warden"));
  ok(gw && gw.SpawnX === c0.SpawnX + 2, "a tap with 'A new NPC' makes Gate Warden there");
  ok(gw && (await spawns(m, gw.id)).length === 1, "with one placement row");
  p = await tileAt(m, c0.SpawnX + 1, c0.SpawnY + 5);
  await m.mouse.click(p.x, p.y); await m.waitForTimeout(600);
  ok((await spawns(m, gw.id)).length === 2, "the next tap puts the same new NPC in a second place");
  await m.screenshot({ path: OUT + "map-npc-desktop-new.png" });
  // remove both: the NPC stays, standing nowhere
  for (let i = 0; i < 2; i++) { await m.click(".npcspot button.danger"); await m.waitForTimeout(500); }
  ok((await spawns(m, gw.id)).length === 0 && (await npcRow(m, gw.id)).SpawnX === -999, "removing every place leaves Gate Warden in the db at -999");

  // saving never resets a column the save doesn't send
  // (the content repo's 9001 lost its Daily in an editor save on 2026-10-27; set it, then save as the form does)
  await m.evaluate(() => { const q = BQ.api.content().quests.find(q => q.id === 9001); BQ.api.save({ table: "quest_def", row: { ...q, Daily: 1 } }); });
  const before = await m.evaluate(() => BQ.api.content().quests.find(q => q.id === 9001));
  // as the Quests tab form saves (no Daily, Sequential or dialogue columns)
  await m.evaluate(b => BQ.api.save({ table: "quest_def", row: { id: 9001, Act: 1, Zone: b.Zone, Title: b.Title, Summary: "x", Level: 3, MinLevel: 3, Giver: 1300, TurnIn: 1300, Prereqs: b.Prereqs, Offer: b.Offer, Accept: b.Accept, Progress: b.Progress, Complete: b.Complete, XP: 60, Gold: 5, Rewards: "[]", Steps: b.Steps } }), before);
  const after = await m.evaluate(() => BQ.api.content().quests.find(q => q.id === 9001));
  ok(after.Daily === before.Daily && before.Daily === 1, "a quest_def save without Daily keeps Daily (9001 stays 1)");
  ok(after.OfferTree === before.OfferTree && after.Replies === before.Replies && after.Sequential === before.Sequential, "and keeps OfferTree, Replies and Sequential");
  await m.evaluate(() => BQ.api.save({ table: "npc", row: { id: 1300, Name: "Sergeant Crumb" } }));
  ok((await spawns(m, 1300)).length === 2 && (await npcRow(m, 1300)).ImgPath === c0.ImgPath, "an npc save with only a name keeps the sprite and every placement");
  const sql = await m.evaluate(() => BQ.api.export().sql);
  ok(/CREATE TABLE IF NOT EXISTS npc_spawn/.test(sql) && /INSERT OR REPLACE INTO npc_spawn/.test(sql), "Export SQL carries the npc_spawn migration and the placements");

  // NPC sheet: every place
  await m.evaluate(() => { location.hash = "#studio/npc/1300"; }); await m.waitForTimeout(1500);
  ok((await m.$$(".qs-spots .qs-spot:not(.add)")).length === 2, "Crumb's sheet lists both places");
  await (await m.$(".qs-spots")).scrollIntoViewIfNeeded();
  await m.screenshot({ path: OUT + "npc-sheet-placements-desktop.png" });
  await m.close();
}

{ // ---- phone, touch
  const m = await open(390, 844, "#map/npc/1300");
  const c0 = await npcRow(m, 1300);
  const wrapH = await m.$eval(".mapwrap", e => e.getBoundingClientRect().height);
  ok(wrapH > 300 && wrapH < 600, `phone: map on top (${Math.round(wrapH)}px), panel below`);
  ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone: no sideways scroll");
  let p = await tileAt(m, c0.SpawnX + 3, c0.SpawnY - 2);
  await m.touchscreen.tap(p.x, p.y); await m.waitForTimeout(700);
  let sp = await spawns(m, 1300);
  ok(sp.some(s => s[0] === c0.SpawnX + 3 && s[1] === c0.SpawnY - 2), "phone: a tap places Crumb: " + JSON.stringify(sp));
  // a one-finger drag on empty ground pans, it doesn't place
  const n0 = sp.length, cx0 = await m.evaluate(() => M.cx);
  const cdp = await m.context().newCDPSession(m);
  p = await tileAt(m, c0.SpawnX - 3, c0.SpawnY + 4);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x - i * 15, y: p.y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await m.waitForTimeout(500);
  ok((await spawns(m, 1300)).length === n0 && (await m.evaluate(() => M.cx)) > cx0, "phone: dragging empty ground pans, places nothing");
  // two-finger pinch zooms
  const s0 = await m.evaluate(() => M.scale);
  const r = await m.$eval("#map", e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x - 30, y: r.y, id: 1 }, { x: r.x + 30, y: r.y, id: 2 }] });
  for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r.x - 30 - i * 12, y: r.y, id: 1 }, { x: r.x + 30 + i * 12, y: r.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await m.waitForTimeout(400);
  ok((await m.evaluate(() => M.scale)) > s0 * 1.5 && (await spawns(m, 1300)).length === n0, "phone: pinch zooms in, places nothing");
  await m.evaluate(([x, y]) => { M.cx = x + 1; M.cy = y; drawMap(); }, [c0.SpawnX, c0.SpawnY]); await m.waitForTimeout(300);
  await m.screenshot({ path: OUT + "map-npc-phone.png" });
  // move one with a finger
  p = await tileAt(m, c0.SpawnX + 3, c0.SpawnY - 2); const q = await tileAt(m, c0.SpawnX + 3, c0.SpawnY);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
  for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y + (q.y - p.y) * i / 5 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await m.waitForTimeout(600);
  sp = await spawns(m, 1300);
  ok(sp.some(s => s[0] === c0.SpawnX + 3 && s[1] === c0.SpawnY) && !sp.some(s => s[1] === c0.SpawnY - 2), "phone: dragging a placement moves it: " + JSON.stringify(sp));
  const small = await m.$$eval(".side button", els => els.filter(e => e.offsetParent).map(e => [e.textContent.trim(), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 40));
  ok(!small.length, "phone: panel tap targets >= 40px " + JSON.stringify(small));
  await m.evaluate(() => { document.querySelector(".side").scrollTop = 99999; });
  await m.screenshot({ path: OUT + "map-npc-phone-panel.png" });
  await m.evaluate(() => { location.hash = "#studio/npc/1300"; }); await m.waitForTimeout(1500);
  ok((await m.$$(".qs-spots .qs-spot:not(.add)")).length === 2, "phone: the NPC sheet lists every place");
  await (await m.$(".qs-spots")).scrollIntoViewIfNeeded();
  await m.screenshot({ path: OUT + "npc-sheet-placements-phone.png" });
  await m.close();
}
console.log("ERRORS:\n" + errs.join("\n"));
if (errs.length) process.exitCode = 1;
await b.close();
