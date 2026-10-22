// Headless check of multi-target quest steps: a kill step can count more
// enemies ("+ also counts"), stored as Targets (full list, Target first) in
// quest_def.Steps; removing them drops the key; the checks (validate.js)
// report every listed enemy that doesn't exist and a Targets of the wrong
// type. Uses quest 1304 (kill Spider) of a content db copy.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/copy.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-quest-targets.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const QID = +(process.env.QID || 1304);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const stored = async () => JSON.parse((await p.evaluate(id => BQ.query(`SELECT Steps FROM quest_def WHERE id = ${id}`)[0].Steps, QID)));
const run = () => p.evaluate(() => BQCheck.run(BQ.query).all.map(x => `${x.level} ${x.where}: ${x.msg}`));
const saveQuest = async () => { await p.click("#qstep-0 >> xpath=ancestor::div[contains(@class,'form')]//button[text()='Save']"); await wait(400); };

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(500);
const base = await run();
await p.evaluate(id => { location.hash = "#quest/" + id; }, QID); await p.waitForSelector("#qstep-0 .also-add"); await wait(200);
const s0 = (await stored())[0];
ok(s0.Type === "kill" && s0.Target === "Spider" && !("Targets" in s0), "quest starts as a single-target kill step");

await p.selectOption("#qstep-0 .also-add", "Cave Spider"); await wait(100);
ok(await p.$$eval("#qstep-0 .also .chip", x => x.map(e => e.textContent.replace("×", "")).join(",")) === "Cave Spider", "chip shows the added enemy");
ok(!(await p.$$eval("#qstep-0 .also-add option", x => x.map(o => o.value))).includes("Cave Spider"), "an enemy already listed is not offered again");
await saveQuest();
let s = (await stored())[0];
ok(s.Target === "Spider" && JSON.stringify(s.Targets) === '["Spider","Cave Spider"]' && s.Count === 5 && s.Text === "Squash 5 Spiders around Squall's End",
  "saved: Target stays first, Targets is the full list, Count and Text kept: " + JSON.stringify(s));
ok(JSON.stringify(await run()) === JSON.stringify(base), "the checks pass with both enemies");
ok(/kill .*Spider.* or .*Cave Spider/.test(await p.textContent("#quest-links")), "objectives panel lists both");

// Text is the author's label
await p.fill("#qstep-0 input[placeholder='Objective shown in the tracker']", "Squash 5 spiders"); await saveQuest();
ok((await stored())[0].Text === "Squash 5 spiders", "Text is the label players see");

// removing the extra drops Targets
await p.click("#qstep-0 .also .chip button"); await saveQuest();
s = (await stored())[0];
ok(s.Target === "Spider" && !("Targets" in s), "no extras: no Targets key: " + JSON.stringify(s));

// checks: every listed enemy must exist; Targets must be names
const set = steps => p.evaluate(([id, j]) => BQ.query(`UPDATE quest_def SET Steps = '${j.replace(/'/g, "''")}' WHERE id = ${id}`), [QID, JSON.stringify(steps)]);
await set([{ Type: "kill", Target: "Spider", Targets: ["Spider", "Cave Spider", "Nobody At All"], Count: 5, Text: "x" }]);
let r = await run();
ok(r.some(x => /error quest 1304.*step 1 \(kill\): no enemy named "Nobody At All"/.test(x)) && !r.some(x => /no enemy named "(Cave )?Spider"/.test(x)), "a listed enemy that doesn't exist is an error");
await set([{ Type: "collect", Target: "Nothing Here", Targets: ["Nothing Here", "Also Nothing"], Count: 1, Text: "x" }]);
r = await run();
ok(r.some(x => /no item named "Also Nothing"/.test(x)) && r.some(x => /no item named "Nothing Here"/.test(x)), "collect: every listed item checked");
await set([{ Type: "kill", Target: "Spider", Targets: [3], Count: 5, Text: "x" }]);
r = await run();
ok(r.some(x => /Steps\[0\]\.Targets is \[3\], the API needs a list of names/.test(x)), "Targets of numbers stops quests loading: error");
await set([{ Type: "boss", Targets: ["Cave Spider"], Text: "x" }]);
r = await run();
ok(!r.some(x => /error quest 1304/.test(x)), "Targets without Target is fine");
ok(!errs.length, "no page errors " + errs.join(" | "));
await b.close();
