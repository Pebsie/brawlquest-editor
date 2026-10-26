// Regression: on a fresh load, clicking or tapping a Journey card opens its
// quest sheet without ever touching + first (pointer capture used to send the
// click to the map, not the card). A real drag still pans and opens nothing.
// Serve this folder on 127.0.0.1:8977 first (or set URL).
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html", DB = process.env.DB || "/workspace/queststudio/data/bq-content.db";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const open = async (w, hgt, mob) => {
  const m = await (await b.newContext({ viewport: { width: w, height: hgt }, hasTouch: mob, isMobile: mob })).newPage();
  m.on("pageerror", e => errs.push(`${w} pageerror ` + e.message)); m.on("console", x => { if (x.type() === "error" && !/404/.test(x.text())) errs.push(`${w} console ` + x.text()); });
  await m.goto(URL); await m.setInputFiles("#open", DB); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(600);
  await m.evaluate(() => { location.hash = "#studio/journey"; }); await m.waitForSelector(".qs-card"); await m.waitForTimeout(800);
  return m;
};
// Visible cards (centre of the title, really on top at that point).
const cards = m => m.evaluate(() => { const vr = document.querySelector("#qs-view").getBoundingClientRect(), out = [];
  for (const c of document.querySelectorAll(".qs-card .qc-t")) { const r = c.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (x > vr.left + 5 && x < vr.right - 5 && y > vr.top + 5 && y < vr.bottom - 5 && document.elementFromPoint(x, y) === c) out.push({ x, y, id: c.closest(".qs-card").dataset.id }); }
  return out; });
const sheet = m => m.evaluate(() => { const d = document.querySelector("#qs-drawer"); return d && d.classList.contains("open") ? d.dataset.id : ""; });
const closeSheet = m => m.evaluate(() => document.querySelector("#qs-drawer").classList.remove("open"));
const noModal = m => m.evaluate(() => !document.querySelector(".qs-modal"));

{ // desktop mouse / trackpad
  const m = await open(1400, 900, false);
  const [a, c2] = await cards(m);
  ok(a && c2, `desktop: cards on screen (${a && a.id}, ${c2 && c2.id})`);
  await m.mouse.click(a.x, a.y); await m.waitForTimeout(300);
  ok((await sheet(m)) === a.id && (await noModal(m)), `desktop: plain mouse click opens quest ${a.id} on a fresh load (+ never touched)`);
  await closeSheet(m);
  await m.mouse.move(c2.x, c2.y); await m.mouse.down(); await m.mouse.move(c2.x + 2, c2.y + 1); await m.mouse.move(c2.x + 3, c2.y + 2); await m.mouse.up(); await m.waitForTimeout(300);
  ok((await sheet(m)) === c2.id, `desktop: down, a few px of trackpad jitter, up opens quest ${c2.id}`);
  await m.mouse.click(a.x, a.y); await m.waitForTimeout(300);
  ok((await sheet(m)) === a.id, "desktop: clicking another card switches the sheet");
  await closeSheet(m);
  const cam0 = await m.evaluate(() => document.querySelector(".qs-world").style.transform);
  await m.mouse.move(a.x, a.y); await m.mouse.down(); await m.mouse.move(a.x + 40, a.y + 30, { steps: 6 }); await m.mouse.up(); await m.waitForTimeout(300);
  const cam1 = await m.evaluate(() => document.querySelector(".qs-world").style.transform);
  ok(cam1 !== cam0 && !(await sheet(m)), "desktop: a real drag from a card pans and opens nothing");
  const [d] = await cards(m);
  await m.mouse.move(d.x, d.y); await m.mouse.down(); await m.mouse.move(5, 5, { steps: 10 }); await m.mouse.up(); await m.waitForTimeout(200);
  await m.mouse.click(d.x - 0 , d.y); await m.waitForTimeout(300);
  ok(!!(await sheet(m)), "desktop: a drag released off the map, then a click, still opens a sheet");
  await m.screenshot({ path: "/workspace/queststudio/card-click-desktop.png" });
}
for (const [w, hgt] of [[390, 844], [360, 740]]) { // phones: touch
  const m = await open(w, hgt, true);
  const [a, c2] = await cards(m);
  ok(a, `${w}px: a card on screen (${a && a.id})`);
  await m.touchscreen.tap(a.x, a.y); await m.waitForTimeout(400);
  ok((await sheet(m)) === a.id && (await noModal(m)), `${w}px: tapping quest ${a.id} opens its sheet on a fresh load`);
  await closeSheet(m);
  if (c2) {
    const s = await m.context().newCDPSession(m);
    await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c2.x, y: c2.y }] });
    await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c2.x + 2, y: c2.y + 2 }] });
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await m.waitForTimeout(400);
    ok((await sheet(m)) === c2.id, `${w}px: a slightly shaky tap on ${c2.id} still opens it`);
  }
  // a mouse on a phone-sized window (narrow desktop browser)
  await closeSheet(m);
  if (w === 390) await m.screenshot({ path: "/workspace/queststudio/card-click-mobile.png" });
}
{ // a narrow desktop window with a mouse
  const m = await open(390, 844, false);
  const [a] = await cards(m);
  await m.mouse.click(a.x, a.y); await m.waitForTimeout(300);
  ok((await sheet(m)) === a.id, `390px mouse: click opens quest ${a.id}`);
}
ok(!errs.length, "no page errors " + errs.join("\n"));
await b.close();
