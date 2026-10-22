// Headless check of the Effects tab and the projectile primitive (Mobs tab).
// Use a copy of a db with content/migrations/2026-10-20-webbed-up.sql applied.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/copy.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-effects.mjs
import fs from "fs";
const { chromium } = await import(process.env.PW || "playwright-core");
const OUT = process.env.OUT || "/tmp";
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(600);

// Effects tab
await p.click("#tabs button[data-tab=effects]");
await p.waitForSelector(".list .row");
ok(/Webbed Up/.test(await p.textContent(".list")), "Webbed Up listed");
await p.click(".list .row:has-text('Webbed Up')"); await wait(200);
ok(await p.inputValue(".rw [data-key=mult]") === "0.5", "move_speed 0.5 modifier shown");
ok(/Spider/.test(await p.textContent(".form")), "Applied by lists the spiders");
// Create a stacking poison with a dot and a slow
await p.click(".list button.primary"); await wait(100);
await p.fill(".form .grid input[type=text]", "Test Venom");
await p.selectOption(".form .grid select", "stack");
await p.fill(".form .grid input.num >> nth=1", "3");
await p.selectOption(".rw select", "dot");
await p.fill(".rw [data-key=damage]", "4");
await p.click(".form button:has-text('+ Modifier')");
await p.click(".form button:has-text('Create effect')"); await wait(300);
const venom = await p.evaluate(() => S.c.effects.find(e => e.Name === "Test Venom"));
ok(venom && venom.Stacking === "stack" && venom.MaxStacks === 3 && JSON.parse(venom.Modifiers).length === 2 && JSON.parse(venom.Modifiers)[0].type === "dot", "new effect saved: " + (venom && venom.Modifiers));
// validation
await p.fill(".rw [data-key=mult]", "9");
await p.click(".form button:has-text('Save effect')"); await wait(200);
ok(/mult is 0 to 3/.test(await p.textContent("#status")), "bad multiplier refused");
// delete in use refused
await p.click(".list .row:has-text('Webbed Up')"); await wait(200);
await p.click(".form .bar button.danger"); await wait(200);
ok(/used by .*Spider/.test(await p.textContent("#status")), "deleting an effect in use is refused");

// Mobs: spider has the projectile
await p.click("#tabs button[data-tab=mobs]"); await p.waitForSelector(".list .row");
// (opening a db that needed a column upgrade re-renders the tab once more
// after load: re-type the filter until it sticks)
for (let i = 0; i < 20; i++) {
  await p.fill(".list input[type=search]", "cave spider"); await wait(150);
  if ((await p.$$eval(".list .row", r => r.map(x => x.textContent))).every(t => /cave spider/i.test(t))) break;
}
await p.click(".list .row"); await wait(300);
ok(await p.$eval(".prim select", s => s.value) === "projectile", "Cave Spider primitive is a projectile");
ok(await p.$eval(".prim [data-key=effect]", s => s.selectedOptions[0].textContent) === "Webbed Up (1)", "effect select shows Webbed Up");
ok(await p.$(".prim [data-key=duration]") === null && await p.$eval(".prim [data-key=castTime]", e => e.value) === "0.5", "projectile form: cast time shown (0.5), zone duration hidden");
// preview: cast, web flies, player webbed
await wait(300);
await p.click(".mobprev button:has-text('Pause')");
await p.click(".mobprev button:has-text('Restart')");
await p.evaluate(() => { for (let i = 0; i < 50; i++) BQSim.step(S.mobPreview.state); }); // 2.5 s: cast at 1s, hit ~1.9s
await wait(200);
const st = await p.evaluate(() => { const s = S.mobPreview.state; return { t: s.tick, fx: s.effects.map(e => e.id), mult: BQSim.moveMult(s), hits: s.hits }; });
ok(st.fx.includes(1) && st.mult === 0.5, `preview: web hit the player and Webbed Up shows (t=${st.t}, mult=${st.mult})`);
ok(/move x0\.50/.test(await p.textContent(".mobprev")), "preview info shows the slow");
await p.screenshot({ path: OUT + "/effects-preview.png" });
// Switch to the venom effect and a fan of 3, save
await p.selectOption(".prim [data-key=effect]", String(venom.id));
await p.fill(".prim [data-key=count]", "3");
await p.click("#save-patterns"); await wait(300);
const pat = await p.evaluate(() => JSON.parse(S.c.patterns.find(r => r.EnemyID === 6).Pattern));
ok(pat[0].do === "projectile" && pat[0].effect === venom.id && pat[0].count === 3 && pat[0].visual === "web", "projectile saved: " + JSON.stringify(pat[0]));
// add a projectile from the button on another mob
await p.fill(".list input[type=search]", "bandit");
await p.click(".list .row"); await wait(300);
await p.click(".mobprims button:has-text('+ Projectile')");
ok(await p.$eval(".prim:last-of-type select", s => s.value) === "projectile", "+ Projectile adds one");

// Effects tab screenshot and export
await p.click("#tabs button[data-tab=effects]"); await wait(200);
await p.click(".list .row:has-text('Webbed Up')"); await wait(200);
await p.screenshot({ path: OUT + "/effects-tab.png" });
await p.click("#tabs button[data-tab=export]");
await p.waitForSelector("h2:has-text('Export changes')");
const sql = await p.textContent(".form > pre.sql");
ok(/INSERT OR REPLACE INTO effects/.test(sql) && /"do":"projectile"/.test(sql), "Export SQL has the effect and projectile pattern");
fs.writeFileSync(OUT + "/effects-export.sql", sql);
ok(errs.length === 0, "no page errors " + errs.join(" | "));
await b.close();
