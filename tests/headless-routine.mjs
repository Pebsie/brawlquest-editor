// NPC routine editor (Quest Studio > NPC > Daily routine, studio-routine.js):
// the day's hours, a walk per start hour, points laid by tapping the map and
// moved by dragging, waits, once / round and round / there and back, pace,
// the walk played back; a routine per placement (npc_spawn), the first
// keeping the old routines (Spawn 0); reachable from the Map's NPCs tool.
// Desktop and a 390x844 phone with touch.
// Serve this folder on 127.0.0.1:8977 first (or set URL); DB is a content db
// from before 2026-10-27-routine-placements.sql (the editor upgrades it on
// the first routine saved).
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
  await m.evaluate(h => { location.hash = h; }, hash); await m.waitForTimeout(1800);
  return m;
};
// page coordinates of the middle of tile x,y on the routine map
const tileAt = async (m, x, y) => (await m.locator(".qs-rtmap").scrollIntoViewIfNeeded(), m.evaluate(([x, y]) => { const cv = document.querySelector(".qs-rtmap"), r = cv.getBoundingClientRect(), v = QS.rt.view, k = r.width / cv.width; return { x: r.left + ((x - v.cx) * v.sc + cv.width / 2) * k, y: r.top + ((y - v.cy) * v.sc + cv.height / 2) * k }; }, [x, y]));
const walks = (m, npc) => m.evaluate(npc => { const c = BQ.api.content(); return c.routines.filter(r => r.NPC === npc).map(r => ({ ...r, nodes: c.routineNodes.filter(p => p.Routine === r.id).map(p => [p.X, p.Y, p.Wait]) })); }, npc);
const hourBtn = (m, i) => m.locator(".qs-rtday .qs-rth").nth(i);
const touchDrag = async (m, a, z) => {
  const s = await m.context().newCDPSession(m);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 6; i++) await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + (z.x - a.x) * i / 6, y: a.y + (z.y - a.y) * i / 6 }] });
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};

{ // ---- desktop
  const m = await open(1400, 900, "#studio/npc/4/routine");
  ok(await m.$("#qs-routine") !== null, "#studio/npc/4/routine opens the Farmer's sheet with the routine editor");
  ok(!(await m.evaluate(() => BQ.api.content().hasRoutineSpawn)), "an old db has no routine.Spawn yet");
  const w0 = await walks(m, 4);
  ok(await m.locator(".qs-rtwalk").count() === w0.length && w0.length === 2, `the first placement shows the Farmer's ${w0.length} walks (Spawn 0)`);
  ok(await hourBtn(m, 6).evaluate(e => e.classList.contains("start")) && await hourBtn(m, 14).evaluate(e => e.classList.contains("start")), "06:00 and 14:00 are marked on the day");
  ok(await hourBtn(m, 20).evaluate(e => e.classList.contains("night")) && !(await hourBtn(m, 12).evaluate(e => e.classList.contains("night"))), "night hours (18:00-06:00) are dark");
  await m.locator(".qs-rtwalk").nth(1).click(); await m.waitForTimeout(300);
  ok(await m.evaluate(() => QS.rt.sel === 1), "picking the 14:00 walk");
  await m.locator("#qs-routine").scrollIntoViewIfNeeded();
  await m.click('button:has-text("Watch this walk")'); await m.waitForTimeout(1500);
  const pos = await m.evaluate(() => document.querySelector(".qs-rtclock").textContent);
  ok(/^14:\d\d/.test(pos), "the walk plays back with the clock: " + pos);
  await m.setViewportSize({ width: 1400, height: 1500 }); await m.waitForTimeout(300);
  await m.locator("#qs-routine").screenshot({ path: OUT + "routine-desktop-play.png" });
  await m.setViewportSize({ width: 1400, height: 900 });
  await m.click('button:has-text("Stop")'); await m.waitForTimeout(200);

  // a new walk at 20:00, three taps on the map
  await hourBtn(m, 20).click(); await m.waitForTimeout(600);
  ok(await m.evaluate(() => BQ.api.content().hasRoutineSpawn), "the first routine save upgraded the db (Spawn, Speed, Wait)");
  let w = await walks(m, 4);
  ok(w.length === 3 && w.some(r => r.TriggerHour === 20 && r.Spawn === 0 && r.nodes.length === 0), "a tap on 20:00 adds a walk for the first placement (Spawn 0)");
  ok(JSON.stringify(w.filter(r => r.TriggerHour !== 20).map(r => r.nodes)) === JSON.stringify(w0.map(r => r.nodes.map(p => [p[0], p[1], 0]))), "the old walks are untouched");
  for (const [dx, dy] of [[2, 0], [2, 2], [0, 2]]) { const p = await tileAt(m, 31 + dx, -14 + dy); await m.mouse.click(p.x, p.y); await m.waitForTimeout(450); }
  w = await walks(m, 4); let r20 = w.find(r => r.TriggerHour === 20);
  ok(JSON.stringify(r20.nodes) === JSON.stringify([[33, -14, 0], [33, -12, 0], [31, -12, 0]]), "three taps lay three points: " + JSON.stringify(r20.nodes));
  // drag point 2 one tile further
  let a = await tileAt(m, 33, -12), z = await tileAt(m, 32, -13);
  await m.mouse.move(a.x, a.y); await m.mouse.down(); await m.mouse.move(z.x, z.y, { steps: 6 }); await m.mouse.up(); await m.waitForTimeout(500);
  r20 = (await walks(m, 4)).find(r => r.TriggerHour === 20);
  ok(JSON.stringify(r20.nodes[1]) === JSON.stringify([32, -13, 0]) && r20.nodes.length === 3, "dragging point 2 moves it: " + JSON.stringify(r20.nodes));
  // tap point 2: wait 15 s
  a = await tileAt(m, 32, -13); await m.mouse.click(a.x, a.y); await m.waitForTimeout(300);
  ok(await m.$(".qs-rtpt") !== null, "tapping a point opens it");
  await m.click('.qs-rtpt button:has-text("15 s")'); await m.waitForTimeout(400);
  await m.click('.qs-rtpt button[aria-label="Wait more"]'); await m.waitForTimeout(400);
  r20 = (await walks(m, 4)).find(r => r.TriggerHour === 20);
  ok(r20.nodes[1][2] === 20, "its wait: 15 s, then + makes 20 s (" + r20.nodes[1][2] + ")");
  // with the point open, a tap inserts after it
  a = await tileAt(m, 32, -12); await m.mouse.click(a.x, a.y); await m.waitForTimeout(450);
  r20 = (await walks(m, 4)).find(r => r.TriggerHour === 20);
  ok(r20.nodes.length === 4 && r20.nodes[2][0] === 32 && r20.nodes[2][1] === -12, "with a point open a tap inserts after it: " + JSON.stringify(r20.nodes));
  await m.click('.qs-rtpt button:has-text("Remove point")'); await m.waitForTimeout(450);
  r20 = (await walks(m, 4)).find(r => r.TriggerHour === 20);
  ok(r20.nodes.length === 3, "Remove point");
  await m.click('.qs-rtloop button:has-text("There and back")'); await m.waitForTimeout(400);
  await m.click('.qs-rtspeed button:has-text("Hurry")'); await m.waitForTimeout(400);
  r20 = (await walks(m, 4)).find(r => r.TriggerHour === 20);
  ok(r20.Loop === 2 && r20.Speed === 2, "There and back, Hurry: Loop 2, Speed 2");
  await m.keyboard.press("Control+z"); await m.waitForTimeout(600);
  r20 = (await walks(m, 4)).find(r => r.TriggerHour === 20);
  ok(r20.Speed === 1 && r20.Loop === 2, "Ctrl+Z undoes the pace");
  await m.keyboard.press("Control+Shift+z"); await m.waitForTimeout(600);
  ok((await walks(m, 4)).find(r => r.TriggerHour === 20).Speed === 2, "and redo");
  // a wall in the way is flagged
  ok(await m.$("#qs-routine .qs-prob.err") === null, "a path round the house has no wall flag");
  const wall = [34, -13];
  if (wall) {
    const p = await tileAt(m, wall[0], wall[1]); await m.click('.qs-rtpts .qs-chip >> nth=2'); await m.click('.qs-rtpt button:has-text("Done")'); await m.waitForTimeout(200);
    await m.evaluate(v => { QS.rt.view.cx = v[0]; QS.rt.view.cy = v[1]; document.querySelector(".qs-rtmap").redraw(); }, wall);
    const q = await tileAt(m, wall[0], wall[1]); await m.mouse.click(q.x, q.y); await m.waitForTimeout(450);
    ok(await m.$("#qs-routine .qs-prob.err") !== null, `a point on a wall (${wall}) is flagged`);
    await m.keyboard.press("Control+z"); await m.waitForTimeout(500);
    ok(await m.$("#qs-routine .qs-prob.err") === null, "and the flag goes with the undo");
  }
  await m.locator(".qs-rtwalk").nth(2).click(); await m.waitForTimeout(300);
  await m.evaluate(() => { QS.rt.view.cx = 32; QS.rt.view.cy = -13; QS.rt.view.sc = 28; QS.rt.pt = -1; document.querySelector(".qs-rtpts .qs-chip:nth-child(2)").click(); });
  await m.waitForTimeout(300);
  await m.evaluate(() => { QS.rt.view.cx = 32; QS.rt.view.cy = -12.5; document.querySelector(".qs-rtmap").redraw(); });
  await m.setViewportSize({ width: 1400, height: 1500 }); await m.waitForTimeout(300);
  await m.locator("#qs-routine").screenshot({ path: OUT + "routine-desktop.png" });
  await m.setViewportSize({ width: 1400, height: 900 });
  await m.screenshot({ path: OUT + "routine-desktop-sheet.png" });

  // a second placement: its own routine, none to start with
  await m.evaluate(async () => { await api("save", { table: "npc_spawn", row: { id: 0, NPC: 4, X: 40, Y: -20 } }); await loadAll(); });
  await m.evaluate(() => { location.hash = "#studio/npc/4/routine/40,-20"; }); await m.waitForTimeout(1200);
  ok(await m.evaluate(() => QS.spot.X === 40 && QS.spot.Y === -20), "#studio/npc/4/routine/40,-20 picks the second placement");
  ok(await m.locator(".qs-rtwalk").count() === 0 && /stands still/.test(await m.$eval("#qs-routine", e => e.textContent)), "a new placement has no routine");
  await hourBtn(m, 9).click(); await m.waitForTimeout(500);
  a = await tileAt(m, 42, -20); await m.mouse.click(a.x, a.y); await m.waitForTimeout(450);
  const sid = await m.evaluate(() => BQ.api.content().npcSpawns.find(s => s.X === 40 && s.Y === -20).id);
  w = await walks(m, 4);
  ok(w.some(r => r.TriggerHour === 9 && r.Spawn === sid && r.nodes.length === 1) && w.filter(r => r.Spawn === 0).length === 3, `its walk is its own (Spawn ${sid}); the first placement keeps its 3`);
  // the Map's NPCs tool
  await m.evaluate(() => { location.hash = "#map/npc/4/40,-20"; }); await m.waitForTimeout(1500);
  const rb = await m.$$eval(".npcspot .rtbtn", l => l.map(e => e.textContent));
  ok(rb.length === 2 && rb[0] === "Routine (3)" && rb[1] === "Routine (1)", "the NPCs tool lists each place's routine: " + rb);
  await m.screenshot({ path: OUT + "routine-map-tool-desktop.png" });
  await m.click(".npcspot >> nth=0 >> .rtbtn"); await m.waitForTimeout(1500);
  ok(await m.evaluate(() => location.hash === "#studio/npc/4/routine/31,-14" || location.hash.startsWith("#studio/npc/4")) && await m.evaluate(() => QS.spot.X === 31), "Routine opens that place's routine in Quest Studio");
  // removing the second placement takes its routine
  await m.evaluate(async id => { await api("delete", { table: "npc_spawn", id }); await loadAll(); }, sid);
  w = await walks(m, 4);
  ok(!w.some(r => r.Spawn === sid) && w.length === 3, "removing a placement removes its routine");
  const ex = await m.evaluate(() => BQ.api.export().sql);
  ok(/CREATE TABLE routine_upgrade/.test(ex) && /INSERT INTO routineNode \(id, Routine, X, Y, Position, Wait\)/.test(ex), "the SQL export carries the migration and the routine rows");
  await m.close();
}

{ // ---- phone
  const m = await open(390, 844, "#studio/npc/4/routine");
  await m.locator("#qs-routine").scrollIntoViewIfNeeded();
  const hb = await hourBtn(m, 7).boundingBox();
  ok(hb.height >= 44, "hour blocks are 44px tall on a phone (" + hb.height + ")");
  const mb = await m.locator(".qs-rtmap").boundingBox();
  ok(mb.width <= 390 && mb.width > 300, "the map fits the phone (" + Math.round(mb.width) + "px)");
  const wide = await m.evaluate(() => document.documentElement.scrollWidth);
  ok(wide <= 392, "no sideways scroll (" + wide + ")");
  await hourBtn(m, 7).tap(); await m.waitForTimeout(600);
  for (const [dx, dy] of [[1, 1], [2, 1]]) { const p = await tileAt(m, 31 + dx, -14 + dy); await m.touchscreen.tap(p.x, p.y); await m.waitForTimeout(500); }
  let r7 = (await walks(m, 4)).find(r => r.TriggerHour === 7);
  ok(r7 && JSON.stringify(r7.nodes) === JSON.stringify([[32, -13, 0], [33, -13, 0]]), "taps lay points on a phone: " + JSON.stringify(r7 && r7.nodes));
  const a = await tileAt(m, 33, -13), z = await tileAt(m, 33, -12);
  await touchDrag(m, a, z); await m.waitForTimeout(600);
  r7 = (await walks(m, 4)).find(r => r.TriggerHour === 7);
  ok(JSON.stringify(r7.nodes[1]) === JSON.stringify([33, -12, 0]), "a finger drags a point: " + JSON.stringify(r7.nodes));
  const p2 = await tileAt(m, 33, -12); await m.touchscreen.tap(p2.x, p2.y); await m.waitForTimeout(400);
  await m.locator('.qs-rtpt button:has-text("5 s")').first().tap(); await m.waitForTimeout(400);
  r7 = (await walks(m, 4)).find(r => r.TriggerHour === 7);
  ok(r7.nodes[1][2] === 5, "and sets a wait");
  const btns = await m.$$eval("#qs-routine .qs-seg button, #qs-routine .qs-rtplay .qs-btn", l => l.filter(e => e.offsetParent).map(e => e.getBoundingClientRect().height));
  ok(btns.length && btns.every(x => x >= 44), "routine buttons are 44px+ on a phone");
  await m.evaluate(() => document.querySelector("#qs-routine").scrollIntoView({ block: "start" })); await m.waitForTimeout(300);
  await m.screenshot({ path: OUT + "routine-phone.png" });
  await m.evaluate(() => document.querySelector(".qs-rtpt").scrollIntoView({ block: "center" })); await m.waitForTimeout(300);
  await m.screenshot({ path: OUT + "routine-phone-point.png" });
  await m.locator('button:has-text("Watch their day")').tap(); await m.waitForTimeout(2500);
  ok(await m.evaluate(() => /^\d\d:\d\d/.test(document.querySelector(".qs-rtclock").textContent)), "the whole day plays back");
  await m.evaluate(() => document.querySelector(".qs-rtday").scrollIntoView({ block: "start" })); await m.waitForTimeout(300);
  await m.screenshot({ path: OUT + "routine-phone-play.png" });
  await m.close();
}
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("\n") : ""));
await b.close();
