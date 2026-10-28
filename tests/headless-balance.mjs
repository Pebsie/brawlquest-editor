// Mob form: Speed (slider + number), Passive, Flip beside the sprite, and the
// balance guide (stage chips, the player at that level, what happens with the
// current numbers, bands, chart). Desktop and a 390x844 phone with touch.
// Serve this folder on 127.0.0.1:8988 first (or set URL); DB: a content db.
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8988/index.html", DB = process.env.DB || "/tmp/bal.db", OUT = process.env.OUT || "/workspace/balance/";
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
const fieldOf = (m, label) => m.evaluateHandle(l => [...document.querySelectorAll(".form .grid > label")].find(x => x.textContent === l)?.nextElementSibling, label);
for (const [w, hgt, tag] of [[1400, 900, "desktop"], [390, 844, "phone"]]) {
  const m = await open(w, hgt, "#mob/7");
  const name = await m.$eval(".form h2", x => x.textContent);
  ok(await m.$(".mg") !== null, `${tag}: balance guide under ${name}`);
  const text = await m.$eval(".mg", x => x.innerText);
  ok(/A level \d+ player has about \d+ HP/.test(text) && /You kill it in about \d+ swing/.test(text) && /kills a level|No XP/.test(text), `${tag}: player and fight read out`);
  ok(/From quests: \d+/.test(text), `${tag}: stage from its kill quests`);
  ok(await m.$$eval(".mg-bandrow", l => l.length) === 5, `${tag}: five bands`);
  ok(await m.$eval(".mg-chart canvas", c => c.width > 200), `${tag}: chart drawn`);
  // the speed slider and words
  const sp = await m.$(".mg-speed");
  await sp.evaluate(r => { r.value = 3; r.dispatchEvent(new Event("input", { bubbles: true })); });
  await m.waitForTimeout(400);
  ok(await m.$eval(".mg-speedbox input.num", n => n.value) === "3" && /only a sprint .*gets away/.test(await m.$eval(".mg", x => x.innerText)), `${tag}: speed 3 reads "keeps up with a walk" in the guide`);
  // flip mirrors the preview
  await m.click(".mg-flip input"); await m.waitForTimeout(100);
  ok(await m.$eval(".form img.sprite, .form .bar img", i => i.style.transform) === "scaleX(-1)", `${tag}: Flip mirrors the sprite preview`);
  // passive
  await m.evaluate(() => { const l = [...document.querySelectorAll(".form .grid > label")].find(x => x.textContent === "Passive"); l.nextElementSibling.querySelector("input").click(); });
  await m.waitForTimeout(400);
  ok(/Passive: it never starts a fight/.test(await m.$eval(".mg", x => x.innerText)), `${tag}: passive is an optional fight in the guide`);
  // a band row sets HP and ATK
  await m.click(".mg-bandrow:nth-child(3)"); await m.waitForTimeout(300);
  const band = await m.$eval(".mg-now .mg-band", x => x.textContent);
  ok(band === "Tough", `${tag}: tapping Tough makes it read Tough (${band})`);
  // the level slider
  await m.$eval(".mg-level", r => { r.value = 30; r.dispatchEvent(new Event("change", { bubbles: true })); }); await m.waitForTimeout(300);
  ok(/A level 30 player/.test(await m.$eval(".mg", x => x.innerText)), `${tag}: level slider moves the player`);
  await m.$eval(".mg", x => x.scrollIntoView());
  await m.screenshot({ path: OUT + `editor-balance-${tag}.png`, fullPage: false });
  const box = await m.$(".mg");
  await box.screenshot({ path: OUT + `editor-balance-panel-${tag}.png` });
  // tap a dot
  const cv = await m.$(".mg-chart canvas"); const bb = await cv.boundingBox();
  const hit = await m.evaluate(() => { const c = document.querySelector(".mg-chart canvas"); return null; });
  await m.$eval(".form .grid", g => g.scrollIntoView());
  await m.screenshot({ path: OUT + `editor-mob-fields-${tag}.png` });
  // save keeps speed / passive / flip
  await m.click('.form button.primary'); await m.waitForTimeout(800);
  const row = await m.evaluate(() => S.c.enemies.find(e => e.id === 7));
  ok(+row.Speed === 3 && +row.Passive === 1 && +row.Flip === 1, `${tag}: saved Speed ${row.Speed}, Passive ${row.Passive}, Flip ${row.Flip}`);
  await m.context().close();
}
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("\n") : ""));
await b.close();
