// Headless check of the reach-step mini map in the Quests tab: it shows the
// world around X,Y with the completion radius (blue ring), clicking a tile
// moves the target (X/Y inputs follow), typing in X/Y redraws it, and Save
// stores the new X,Y in quest_def.Steps. Uses quest 1300 (Rise and Shine).
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/copy.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-reach-map.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const QID = +(process.env.QID || 1300);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const stored = () => p.evaluate(id => JSON.parse(S.c.quests.find(x => x.id === id).Steps), QID);

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(500);
await p.evaluate(id => { location.hash = "#quest/" + id; }, QID); await p.waitForSelector("#quest-dialogue"); await wait(300);
const s0 = await stored();
const ri = s0.findIndex(s => s.Type === "reach");
ok(ri >= 0, "quest has a reach step");
const box = `#qstep-${ri} .reachbox`;
ok(!!(await p.$(`${box} canvas.reachmap`)), "reach step shows a mini map");
ok((await p.$$(".reachbox")).length === s0.filter(s => s.Type === "reach").length, "only reach steps get one");
await p.waitForFunction(() => !!S.world, null, { timeout: 15000 }); await wait(500);
const info = await p.textContent(`${box} .hint`);
ok(info.includes(`Target ${s0[ri].X},${s0[ri].Y}`) && info.includes(`radius ${s0[ri].Radius}`) && !info.includes("loading"), "shows target and radius: " + info);
const px = (x, y) => p.$eval(`${box} canvas`, (c, [x, y]) => [...c.getContext("2d").getImageData(x, y, 1, 1).data], [x, y]);
const ring = await px(150 + s0[ri].Radius * 8, 90);
ok(ring[2] > 200 && ring[2] > ring[0] + 60, "blue ring drawn at the radius: " + ring);
const far = await px(5, 5);
ok(!(far[2] > 200 && far[0] < 120), "no ring far from the target");
ok(await p.$$eval(`${box} canvas`, c => { const d = c[0].getContext("2d").getImageData(0, 0, 300, 180).data; const set = new Set(); for (let i = 0; i < d.length; i += 400) set.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return set.size; }) > 3, "world tiles drawn");

// click 2 tiles right, 1 tile down of the centre
await p.click(`${box} canvas`, { position: { x: 150 + 2 * 8 + 1, y: 90 + 8 + 1 } }); await wait(200);
const xs = `#qstep-${ri} .top input[type=number]`;
const vals = await p.$$eval(xs, e => e.map(x => +x.value));
ok(vals[0] === s0[ri].X + 2 && vals[1] === s0[ri].Y + 1, "click moves the target, X/Y inputs follow: " + vals);
ok((await p.textContent(`${box} .hint`)).includes(`Target ${s0[ri].X + 2},${s0[ri].Y + 1}`), "info follows the click");

// typing the radius redraws
await p.fill(`${xs} >> nth=2`, "5"); await p.dispatchEvent(`${xs} >> nth=2`, "input"); await wait(100);
ok((await p.textContent(`${box} .hint`)).includes("radius 5"), "typing Radius redraws");
const ring5 = await px(150 + 5 * 8, 90);
ok(ring5[2] > 200, "ring at the new radius");

await p.click(".form button.primary:has-text('Save')"); await wait(600);
const s1 = await stored();
ok(s1[ri].X === s0[ri].X + 2 && s1[ri].Y === s0[ri].Y + 1 && s1[ri].Radius === 5, "Save stores the new X,Y,Radius in quest_def.Steps");
const sql = await p.evaluate(() => S.changes.join("\n")).catch(() => "");
ok(!sql || sql.includes(`"X":${s0[ri].X + 2}`), "Export SQL has the new target");
ok(errs.length === 0, "no page errors " + errs.join(" | "));
await b.close();
