// Headless check of effect sprites: the sprite field on primitive forms (picker
// with the effects categories, settings, stored JSON, preview drawing) and the
// Effects tab overlay sprite.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/copy.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-fx.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const OUT = process.env.OUT || "/tmp";
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const stored = async () => JSON.parse(await p.$eval(".mobprims details pre", e => e.textContent));

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(600);
ok(await p.evaluate(() => BQFX.manifest.sprites.length) >= 100, "effects manifest loaded (" + await p.evaluate(() => BQFX.manifest.sprites.length) + " sprites)");

await p.click("#tabs button[data-tab=mobs]"); await p.waitForSelector(".list .row");
await p.click(".list .row >> nth=0"); await wait(300);
const n0 = await p.$$eval(".prim", x => x.length);
await p.selectOption(".mobprims select:has(option:text('+ Add preset…'))", "Ring burst"); await wait(200);
const card = `.prim[data-i="${n0}"]`;
ok(/default \(no sprite\)/.test(await p.textContent(`${card} [data-key=sprite]`)), "new ring burst: sprite field, default look");
await p.click(`${card} [data-key=sprite] .fxpick`); await p.waitForSelector(".modal .picker");
const chips = await p.$$eval(".modal .picker-chips button", b => b.map(x => x.textContent));
ok(chips.some(c => /^All effects \(\d+\)/.test(c)) && ["fire", "ice", "poison", "lightning", "web", "explosion", "rune", "smoke", "procedural"].every(k => chips.some(c => c.startsWith(k + " "))), "picker categories: " + chips.slice(0, 26).join(" | "));
await p.click(".modal .picker-chips button:has-text('fire (')"); await wait(100);
ok(await p.$$eval(".modal .pcell", x => x.length) >= 5, "fire category has art");
await p.fill(".modal .picker-q", "ring burst fire"); await wait(100);
ok(await p.$$eval(".modal .pcell img.anim", x => x.length) >= 1, "search finds the animated ring burst (strip thumbnail)");
await p.click(".modal .pcell[data-value='assets/fx/ring-burst-fire.png']"); await wait(200);
ok(!(await p.$(".modal")), "picker closed on pick");
let s = (await stored())[n0].sprite;
ok(s && s.img === "assets/fx/ring-burst-fire.png" && s.frames === 8, "stored sprite with the strip's frames: " + JSON.stringify(s));
await p.click(`${card} [data-key=sprite] details summary`);
await p.fill(`${card} [data-fx=alpha]`, "0.8");
await p.check(`${card} [data-fx=blend]`);
await p.selectOption(`${card} [data-fx=fit]`, "tile");
s = (await stored())[n0].sprite;
ok(s.alpha === 0.8 && s.blend === "add" && s.fit === "tile", "settings stored: " + JSON.stringify(s));
// preview draws the sprite (fx image loaded, zones carry it)
await p.click(".mobprev button:has-text('Pause')"); await p.click(".mobprev button:has-text('Restart')");
await p.evaluate(() => { const st = S.mobPreview.state; for (let i = 0; i < 25 * 20 && !st.zones.some(z => z.spr); i++) BQSim.step(st); });
ok(await p.evaluate(() => S.mobPreview.state.zones.some(z => z.spr && z.spr.img === "assets/fx/ring-burst-fire.png")), "preview zones carry the sprite");
await wait(400);
await p.locator(".mobcv").screenshot({ path: OUT + "/fx-preview.png" });
const px = await p.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  for (let i = 0; i < 20; i++) { BQFX.draw(g, { img: "assets/fx/ring-burst-fire.png", frames: 8 }, 32, 32, 30, .3); await new Promise(r => setTimeout(r, 50)); }
  const d = g.getImageData(0, 0, 64, 64).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n;
});
ok(px > 100, "fx.js draws the sprite frame onto a canvas (" + px + " px)");
// procedural style
await p.click(`${card} [data-key=sprite] .fxpick`); await p.waitForSelector(".modal .picker");
await p.click(".modal .picker-chips button:has-text('procedural')");
await p.click(".modal .pcell[data-value='style:runes']"); await wait(150);
s = (await stored())[n0].sprite;
ok(s.style === "runes" && s.alpha === 0.8 && s.blend === "add" && !s.img && !s.frames, "procedural runes keeps the look settings: " + JSON.stringify(s));
await p.click(`${card} [data-key=sprite] button:has-text('Clear')`);
ok(!(await stored())[n0].sprite, "Clear removes the sprite");
// projectile: face + hit sprite
await p.click(".mobprims button:has-text('+ Projectile')"); await wait(150);
const pc = `.prim[data-i="${n0 + 1}"]`;
ok(await p.$(`${pc} [data-key=hitSprite]`) !== null, "projectile has a Hit sprite field");
await p.click(`${pc} [data-key=sprite] .fxpick`); await p.fill(".modal .picker-q", "fireball"); await wait(100);
await p.click(".modal .pcell[data-value='assets/fx/fireball.png']"); await wait(150);
await p.click(`${pc} [data-key=hitSprite] .fxpick`); await p.fill(".modal .picker-q", "explode fire"); await wait(100);
await p.click(".modal .pcell[data-value='assets/fx/explode-fire.png']"); await wait(150);
const pj = (await stored())[n0 + 1];
ok(pj.sprite.img === "assets/fx/fireball.png" && pj.sprite.face === true && pj.hitSprite.frames === 3, "projectile sprite faces travel, hit sprite animated: " + JSON.stringify([pj.sprite, pj.hitSprite]));
// validation and save
ok(await p.evaluate(() => { try { BQSim.validate({ every: 1, do: "zone", sprite: { img: "x".repeat(700) + ".png" } }, 0); return false; } catch (e) { return /600/.test(e.message); } }), "oversized sprite refused (600 char cap like the API)");
ok(await p.evaluate(() => JSON.stringify(BQSim.clean({ every: 2, do: "zone", radius: 1, sprite: { junk: 1 } }))) === '{"every":2,"do":"zone","target":"target","radius":1}', "a sprite without img/style is dropped");
await p.click("#save-patterns"); await wait(500);
const mobId = await p.evaluate(() => S.mob.id);
const rows = await p.evaluate(id => S.c.patterns.filter(r => r.EnemyID === id).map(r => JSON.parse(r.Pattern)), mobId);
ok(rows.flat().some(a => a.hitSprite && a.hitSprite.img === "assets/fx/explode-fire.png"), "saved to boss_patterns with the sprites");

// Effects tab: overlay sprite stored in Visual, icon picker has effect icons
await p.click("#tabs button[data-tab=effects]"); await p.waitForSelector(".list .row");
await p.click(".list .row >> nth=0"); await wait(200);
await p.click(".form [data-key=VisualSprite] .fxpick"); await p.waitForSelector(".modal .picker");
await p.fill(".modal .picker-q", "poison skulls"); await wait(100);
await p.click(".modal .pcell[data-value='assets/fx/poison-skulls.png']"); await wait(150);
await p.click(".form button:has-text('Save effect')"); await wait(300);
const eff = await p.evaluate(() => S.c.effects[0]);
ok(JSON.parse(eff.Visual).img === "assets/fx/poison-skulls.png" && JSON.parse(eff.Visual).frames > 1, "effect Visual saved as a sprite: " + eff.Visual);
ok(await p.inputValue(".form input[list=effectVisuals]") === "", "tag box empty while a sprite is set");
await p.click(".form button:has-text('Pick icon')"); await p.waitForSelector(".modal .picker");
ok(/Effect icons \(\d+\)/.test(await p.textContent(".modal .picker-chips")), "icon picker lists effect icons");
await p.keyboard.press("Escape");
await p.screenshot({ path: OUT + "/fx-effects.png" });
ok(errs.length === 0, "no page errors " + errs.join("; "));
await b.close();
