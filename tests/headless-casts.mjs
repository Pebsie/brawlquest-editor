// Headless check of the generic cast system in the Mobs tab: cast fields on
// every primitive, locked vs interruptible cast bars in the preview, the
// Interrupt test button, spawn / suicide / effect primitives, and the
// converted legacy spells. Use a db copy with the 2026-10-19 wraith,
// 2026-10-20 webbed-up and 2026-10-20 spells-to-patterns migrations applied.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-casts.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const OUT = process.env.OUT || "/tmp";
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const st = () => p.evaluate(() => { const s = S.mobPreview.state; return { tick: s.tick, cast: s.casts[0] && { name: s.casts[0].name, locked: s.casts[0].locked, spots: (s.casts[0].spots || []).length }, adds: s.adds.length, breaks: s.breaks.length, dead: s.bossDead, effects: s.effects.length }; });
const pixels = (r, g, bl) => p.evaluate(([r, g, bl]) => { const c = document.querySelector(".mobcv"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 6 && Math.abs(d[i + 1] - g) < 6 && Math.abs(d[i + 2] - bl) < 6) n++; return n; }, [r, g, bl]);

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await p.waitForTimeout(800);

// Converted legacy spells show as primitives.
await p.evaluate(() => go("#mob/20")); await p.waitForTimeout(400);
ok(/Barbarian Pet Handler/.test(await p.textContent(".form h2")), "Pet Handler opens");
ok(await p.$eval(".prim select[data-key=enemy]", e => e.value) === "21", "converted Spawn: spawn primitive with enemy Barbarian Dog");
ok(await p.$eval(".prim [data-key=castTime]", e => e.value) === "1" && await p.$eval(".prim [data-key=interruptible]", e => e.checked), "cast time 1 s, interruptible");
ok(!(await p.$("h3:has-text('Legacy spells')")), "no legacy spells left on it");
await p.evaluate(() => go("#mob/2")); await p.waitForTimeout(400);
ok(await p.$eval(".prim [data-key=castTime]", e => e.value) === "0.6" && await p.$eval(".prim [data-key=name]", e => e.value) === "Web", "Spider web: castTime 0.6, name Web");

// New mob with a locked zone cast.
await p.evaluate(() => go("#mobs")); await p.waitForTimeout(300);
await p.click(".list button.primary");
await p.fill(".form .grid input[type=text]", "Test Caster");
await p.click(".form .bar button.primary"); await p.waitForTimeout(400);
await p.click(".mobprims button:has-text('+ Zone')");
ok(await p.$$eval(".prim [data-key=castTime]", r => r.length) === 1 && await p.$$eval(".prim [data-key=interruptible]", r => r.length) === 1, "zone form has cast time and interruptible");
await p.fill(".prim [data-key=castTime]", "2");
await p.fill(".prim [data-key=name]", "Slam");
await p.waitForTimeout(1300);
let s = await st();
ok(s.cast && s.cast.name === "Slam" && s.cast.locked, "preview: boss is casting Slam, locked " + JSON.stringify(s));
ok(await pixels(0x9e, 0x9e, 0x9e) > 10, "grey (locked) cast bar drawn over the boss");
ok(/2s locked cast/.test(await p.textContent(".prim .pill.locked")), "card shows a locked cast pill");
await p.click(".mobprev button:has-text('Interrupt')");
ok(/locked/.test(await p.textContent("#status")) && (await st()).cast, "Interrupt refused on a locked cast");
await p.check(".prim [data-key=interruptible]");
await p.waitForTimeout(1400);
ok(await pixels(0x6b, 0xb8, 0xf2) > 10, "blue (interruptible) cast bar drawn");
await p.screenshot({ path: OUT + "/casts-bar.png" });
await p.click(".mobprev button:has-text('Interrupt')");
s = await st();
ok(!s.cast && s.breaks === 1 && /Interrupted Slam/.test(await p.textContent("#status")), "interruptible cast breaks");
await p.waitForTimeout(100);
await p.screenshot({ path: OUT + "/casts-break.png" });

// Spawn primitive: telegraph, then adds.
await p.click(".prim button.danger");
await p.click(".mobprims button:has-text('+ Spawn')");
ok(await p.$$eval(".prim [data-key=castTime]", r => r.length) === 1 && await p.$$eval(".prim select[data-key=enemy]", r => r.length) === 1, "spawn form: enemy and cast fields");
await p.selectOption(".prim select[data-key=enemy]", "21");
await p.waitForTimeout(1300);
s = await st();
ok(s.cast && s.cast.name === "Summon" && s.cast.spots === 2, "spawn cast telegraphs 2 spots " + JSON.stringify(s));
await p.waitForTimeout(1100);
s = await st();
ok(s.adds === 2, "two adds after the cast " + JSON.stringify(s));
await p.waitForTimeout(60);
await p.locator(".mobcv").screenshot({ path: OUT + "/casts-spawn.png" });

// Suicide and effect forms; save; stored JSON.
await p.click(".mobprims button:has-text('+ Suicide')");
await p.click(".mobprims button:has-text('+ Effect')");
const json = JSON.parse(await p.textContent(".mobprims details pre"));
ok(json[0].do === "spawn" && json[0].enemy === 21 && json[0].castTime === 1 && json[0].interruptible === true && json[0].max === 4, "spawn JSON " + JSON.stringify(json[0]));
ok(json[1].do === "suicide" && json[1].damage === 30 && !("castTime" in json[1]), "suicide JSON (instant) " + JSON.stringify(json[1]));
ok(json[2].do === "effect" && json[2].castTime === 0.5 && json[2].effect > 0, "effect JSON " + JSON.stringify(json[2]));
await p.click("#save-patterns"); await p.waitForTimeout(400);
const saved = await p.evaluate(() => { const e = S.c.enemies.find(x => x.Name === "Test Caster"); return S.c.patterns.filter(r => r.EnemyID === e.id).map(r => JSON.parse(r.Pattern)); });
ok(saved.length === 1 && saved[0].length === 3, "saved one row of 3 primitives");
await p.selectOption(".prim[data-i='0'] select[data-key=enemy]", "");
await p.click("#save-patterns");
ok(/needs an enemy/.test(await p.textContent("#status")), "spawn without an enemy refused: " + await p.textContent("#status"));
ok(errs.length === 0, "no page errors " + errs.join(" | "));
await b.close();
