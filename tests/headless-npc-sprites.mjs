// NPC sprite picker: the Tome NPC art in assets/npc/<group>/ is listed in
// assets/index.json, every group gets a chip, and the new sprites can be picked
// from the classic NPC form, a Quest Studio character sheet and the Map's NPCs
// tool. Desktop and a 390x844 phone with touch.
// Serve this folder on 127.0.0.1:8986 first (or set URL); DB is any content db.
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8986/index.html", DB = process.env.DB || "/workspace/npcsprites/work/test.db", OUT = process.env.OUT || "/workspace/npcsprites/";
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
const chip = (m, label) => m.click(`.modal .picker-chips button:text-matches("^${label} \\\\(")`);
const shown = m => m.$$eval(".modal .picker-grid .pcell", l => l.map(c => c.dataset.value));
const allLoaded = m => m.$$eval(".modal .picker-grid .pcell img", l => l.length > 0 && l.every(i => i.complete && i.naturalWidth === 32));
const GROUPS = ["Clergy", "Demons", "Mages", "Nobles", "Orcs and Ogres", "Rogues", "Strangers", "Townsfolk", "Undead", "Warriors"];

for (const [w, hgt, tag] of [[1400, 900, "desktop"], [390, 844, "phone"]]) {
  // ---- classic NPC form
  const m = await open(w, hgt, "#npc/1300");
  const idx = await m.evaluate(() => fetch("assets/index.json").then(r => r.json()));
  const npcArt = idx.filter(p => p.startsWith("assets/npc/"));
  ok(GROUPS.every(g => npcArt.some(p => p.startsWith(`assets/npc/${g}/`))), `${tag}: index.json lists every NPC group (${npcArt.length} NPC sprites)`);
  await m.click('.form button:has-text("Pick…")'); await m.waitForSelector(".modal .picker");
  const chips = await m.$$eval(".modal .picker-chips button", l => l.map(b => b.textContent));
  ok(GROUPS.every(g => chips.some(c => c.startsWith(g + " ("))), `${tag}: a chip per group: ${chips.join(", ")}`);
  await chip(m, "Townsfolk"); await m.waitForTimeout(600);
  const town = await shown(m);
  ok(town.length > 0 && town.every(v => v.startsWith("assets/npc/Townsfolk/")), `${tag}: Townsfolk chip shows only townsfolk (${town.length})`);
  ok(await allLoaded(m), `${tag}: every townsfolk sprite loads as 32x32`);
  await m.screenshot({ path: OUT + `editor-npc-form-${tag}.png` });
  await m.fill(".modal .picker-q", "washerwoman"); await m.waitForTimeout(300);
  await m.click('.modal .pcell[data-value="assets/npc/Townsfolk/Washerwoman.png"]'); await m.waitForTimeout(300);
  ok(await m.evaluate(() => [...document.querySelectorAll(".form input")].some(i => i.value === "assets/npc/Townsfolk/Washerwoman.png")), `${tag}: picking Washerwoman fills the classic form's sprite`);

  // ---- Quest Studio character sheet
  await m.evaluate(() => { location.hash = "#studio/npc/1300"; }); await m.waitForTimeout(1500);
  await m.click(".qs-herobtn"); await m.waitForSelector(".modal .picker");
  await chip(m, "Mages"); await m.waitForTimeout(600);
  ok((await shown(m)).every(v => v.startsWith("assets/npc/Mages/")) && await allLoaded(m), `${tag}: Quest Studio sheet picker shows the Mages group`);
  await m.screenshot({ path: OUT + `editor-studio-${tag}.png` });
  await m.keyboard.press("Escape"); await m.waitForTimeout(300);

  // ---- Map NPCs tool, a new NPC
  await m.evaluate(() => { location.hash = "#map/npc/1300"; }); await m.waitForTimeout(1500);
  await m.click('.side .seg button:has-text("A new NPC")'); await m.waitForTimeout(300);
  await m.click('.npcnew button:has-text("Change look")'); await m.waitForSelector(".modal .picker");
  await chip(m, "Undead"); await m.waitForTimeout(600);
  ok((await shown(m)).every(v => v.startsWith("assets/npc/Undead/")) && await allLoaded(m), `${tag}: Map NPCs tool picker shows the Undead group`);
  await m.screenshot({ path: OUT + `editor-map-${tag}.png` });
  await m.click('.modal .pcell[data-value="assets/npc/Undead/Grey Ghost.png"]'); await m.waitForTimeout(300);
  ok(await m.evaluate(() => M.npcNew.ImgPath === "assets/npc/Undead/Grey Ghost.png"), `${tag}: a new NPC on the map takes the Grey Ghost look`);
  await m.context().close();
}
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("\n") : ""));
await b.close();
