// Mob sprite picker: the Tome monster art in assets/monsters/<Group>/ is listed
// in assets/index.json, every group gets a chip in the classic mob form's
// picker, the sprites load, and picking a "(2x2)" / "(3x3)" sprite sets the
// mob's Width/Height to match. Desktop and a 390x844 phone with touch.
// Serve this folder on 127.0.0.1:8987 first (or set URL); DB is any content db.
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8987/index.html", DB = process.env.DB || "/workspace/npcsprites/work/test.db", OUT = process.env.OUT || "/workspace/mobsprites/";
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
const sizes = m => m.$$eval(".modal .picker-grid .pcell img", l => l.map(i => i.complete ? i.naturalWidth : 0));
const GROUPS = ["Aberrations", "Beasts", "Demons and Devils", "Dragons", "Giants and Golems", "Humanoids", "Insects and Spiders", "Plants and Fungi", "Reptiles", "Slimes and Oozes", "Spirits and Elementals", "Undead"];
const pickBtn = '.form button:has-text("Pick sprite")';

for (const [w, hgt, tag] of [[1400, 900, "desktop"], [390, 844, "phone"]]) {
  const m = await open(w, hgt, "#mob/2");
  const idx = await m.evaluate(() => fetch("assets/index.json").then(r => r.json()));
  const art = idx.filter(p => GROUPS.some(g => p.startsWith(`assets/monsters/${g}/`)));
  ok(GROUPS.every(g => art.some(p => p.startsWith(`assets/monsters/${g}/`))), `${tag}: index.json lists every monster group (${art.length} sprites)`);
  await m.click(pickBtn); await m.waitForSelector(".modal .picker");
  const chips = await m.$$eval(".modal .picker-chips button", l => l.map(b => b.textContent));
  ok(GROUPS.every(g => chips.some(c => c.startsWith(g + " ("))), `${tag}: a chip per group: ${chips.join(", ")}`);
  await chip(m, "Beasts"); await m.waitForTimeout(800);
  const beasts = await shown(m);
  ok(beasts.length > 0 && beasts.every(v => v.startsWith("assets/monsters/Beasts/")), `${tag}: Beasts chip shows only beasts (${beasts.length})`);
  ok((await sizes(m)).every(s => s === 32 || s === 64 || s === 96), `${tag}: every beast sprite loads (32/64/96 px)`);
  await m.screenshot({ path: OUT + `editor-mob-beasts-${tag}.png` });
  await chip(m, "Undead"); await m.waitForTimeout(800);
  ok((await shown(m)).every(v => v.startsWith("assets/monsters/Undead/")), `${tag}: Undead chip shows only undead`);
  await m.screenshot({ path: OUT + `editor-mob-undead-${tag}.png` });
  await m.fill(".modal .picker-q", "brown bear"); await m.waitForTimeout(300);
  await chip(m, "Beasts"); await m.waitForTimeout(300);
  await m.click('.modal .pcell[data-value="assets/monsters/Beasts/Brown Bear.png"]'); await m.waitForTimeout(300);
  ok(await m.evaluate(() => [...document.querySelectorAll(".form input")].some(i => i.value === "assets/monsters/Beasts/Brown Bear.png")), `${tag}: picking Brown Bear fills the mob's sprite`);
  await m.click(pickBtn); await m.waitForSelector(".modal .picker");
  await chip(m, "Dragons"); await m.waitForTimeout(800);
  await m.fill(".modal .picker-q", "acid dragon"); await m.waitForTimeout(300);
  await m.screenshot({ path: OUT + `editor-mob-dragons-${tag}.png` });
  await m.click('.modal .pcell[data-value="assets/monsters/Dragons/Acid Dragon (3x3).png"]'); await m.waitForTimeout(300);
  const wh = await m.evaluate(() => ["Width", "Height"].map(k => [...document.querySelectorAll(".form .grid > label")].find(l => l.textContent === k)?.nextElementSibling.querySelector("input").value));
  ok(wh[0] === "3" && wh[1] === "3", `${tag}: picking Acid Dragon (3x3) sets Width/Height to 3x3 (${wh})`);
  await m.screenshot({ path: OUT + `editor-mob-form-${tag}.png`, fullPage: false });
  await m.context().close();
}
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("\n") : ""));
await b.close();
