// Phone layout check (390x844, 360x740) and desktop header unchanged. Serve this folder on 127.0.0.1:8977 first.
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html", DB = "/workspace/queststudio/data/bq-content.db", OUT = "/workspace/queststudio/";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
for (const [w, hgt, tag] of [[390, 844, "v2"], [360, 740, "360"]]) {
  const m = await (await b.newContext({ viewport: { width: w, height: hgt }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
  m.on("pageerror", e => errs.push(`${w} pageerror ` + e.stack)); m.on("console", x => { if (x.type() === "error" && !/404/.test(x.text())) errs.push(`${w} console ` + x.text()); });
  await m.goto(URL); await m.setInputFiles("#open", DB); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(500);
  await m.evaluate(() => { location.hash = "#studio/journey"; }); await m.waitForTimeout(1200);
  const hh = await m.$eval("header", e => e.getBoundingClientRect().height);
  ok(hh <= 60, `${w}px header is slim (${hh}px)`);
  const nav = await m.$$eval(".qs-nav > *", els => els.filter(e => getComputedStyle(e).display !== "none").map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), l: r.left, r: r.right, h: r.height }; }));
  ok(nav.every(n => n.l >= 0 && n.r <= w + 0.5), `${w}px studio bar fits: ` + nav.map(n => n.t).join(" | "));
  const small = await m.$$eval("header button:not([hidden]), header .btn, .qs-nav button", els => els.filter(e => e.offsetParent).map(e => [e.textContent.trim(), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 44));
  ok(!small.length, `${w}px tap targets >= 44px ${JSON.stringify(small)}`);
  const sw = await m.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= w, `${w}px no sideways scroll (${sw})`);
  if (tag === "v2") await m.screenshot({ path: OUT + "mobile-journey-v2.png" });
  await m.click("#btn-menu"); await m.waitForTimeout(200);
  ok(await m.$eval("#tabs", e => getComputedStyle(e).display === "flex"), `${w}px menu opens the tabs`);
  if (tag === "v2") await m.screenshot({ path: OUT + "mobile-menu-v2.png" });
  await m.click('#tabs button[data-tab="quests"]'); await m.waitForTimeout(500);
  ok(!(await m.$eval("header", e => e.classList.contains("menu-open"))) && /quest/.test(await m.evaluate(() => location.hash)), `${w}px picking a tab closes the menu`);
  await m.evaluate(() => { location.hash = "#studio/npc/6"; }); await m.waitForTimeout(1500);
  if (tag === "v2") await m.screenshot({ path: OUT + "mobile-npc-v2.png" });
  await m.evaluate(() => { location.hash = "#studio/play"; }); await m.waitForTimeout(800);
  await m.click('.qs-gopt:has-text("[Quest] Rise and Shine")').catch(() => {}); await m.waitForTimeout(600);
  if (tag === "v2") await m.screenshot({ path: OUT + "mobile-playtest-v2.png" }); else await m.screenshot({ path: OUT + "mobile-journey-360.png" });
  const sw2 = await m.evaluate(() => document.documentElement.scrollWidth);
  ok(sw2 <= w, `${w}px playtest no sideways scroll (${sw2})`);
}
// desktop unchanged header
const d = await (await b.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
await d.goto(URL); await d.setInputFiles("#open", DB); await d.waitForTimeout(800);
ok(await d.$eval("#btn-menu", e => getComputedStyle(e).display === "none") && await d.$eval("#tabs", e => getComputedStyle(e).display !== "none"), "desktop: no Menu button, tabs inline");
ok((await d.$eval("header", e => e.getBoundingClientRect().height)) <= 60, "desktop header one row (as before)");
console.log("ERRORS:\n" + errs.join("\n"));
await b.close();
