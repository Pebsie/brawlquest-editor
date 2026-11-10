// Headless check of the Skills tab: trees, a node's form, edit and save, a new
// skill, checks list, points and retraining tables.
// Use a copy of a db with content/migrations/2026-11-10-skilltree.sql applied.
//   python3 -m http.server 8766 &   (in this folder)
//   DB=/path/to/copy.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome SHOTS=/dir node tests/headless-skills.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8766/index.html";
const SHOTS = process.env.SHOTS || "";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const shot = n => SHOTS ? p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false }) : null;

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(600);
await p.click("#tabs button[data-tab=skills]");
await p.waitForSelector("[data-node]");
ok((await p.$$("[data-node]")).length >= 12, "Warrior tree drawn as nodes");
ok(/all clear/.test(await p.textContent("#main")), "no problems reported for the shipped trees");
await shot("skills-editor-tree");

// switch tree
await p.click("#main .bar button:has-text('Mage Order')"); await wait(150);
const mageNodes = await p.$$eval("[data-node]", e => e.length);
ok(mageNodes >= 12 && mageNodes <= 18, "Mage tree has " + mageNodes + " nodes");

// open an active, check fields, change cooldown, save
await p.click("#main .bar button:has-text('Warrior Order')"); await wait(150);
const first = await p.$eval("[data-node]", e => +e.dataset.node);
const activeBtn = await p.$("[data-node]:has-text('ability')");
await activeBtn.click(); await wait(150);
const cd0 = await p.inputValue("[data-ab=cd]");
ok(+cd0 > 0, "ability form shows cooldown " + cd0);
await shot("skills-editor-ability");
await p.fill("[data-ab=cd]", "7.5");
await p.click("[data-act=save]"); await wait(250);
const saved = await p.evaluate(() => BQ.api.loreTables().skill_node.rows.find(r => r.id === S.skillSel));
ok(JSON.parse(saved.Ability).cd === 7.5, "cooldown saved: " + saved.Ability);

// icons: drawn in the tree, shown in the form, pickable
ok((await p.$$("img.skill-ico[data-icon^='assets/skills/']")).length >= 12, "tree nodes show their sprite");
ok(await p.$eval("[data-key=Icon]", e => e.value.startsWith("assets/skills/")), "form shows the icon path");
ok(await p.$eval(".form img.sprite", e => e.complete && e.naturalWidth === 32), "form previews the 32 px sprite");
await p.click("[data-act=pick-icon]"); await wait(300);
ok(await p.$$eval(".picker .pcell", e => e.length) >= 60, "picker lists the skill icons");
await shot("skills-editor-picker");
await p.click(".picker .pcell[data-value='assets/skills/none-sprint.png']"); await wait(150);
ok(await p.inputValue("[data-key=Icon]") === "assets/skills/none-sprint.png", "picking an icon fills the field");
await p.click("[data-act=save]"); await wait(250);
const pickedRow = await p.evaluate(() => BQ.api.loreTables().skill_node.rows.find(r => r.id === S.skillSel));
ok(pickedRow.Icon === "assets/skills/none-sprint.png", "icon saved on the node: " + pickedRow.Icon);
ok(/shares its icon with/.test(await p.textContent("[data-issues]")), "a shared icon is reported in the checks");

// a passive's stat
await p.click("[data-node]:has-text('passive')"); await wait(150);
ok((await p.$$("[data-mod]")).length >= 1, "passive shows its stats");

// new skill
await p.click("[data-act=new]"); await wait(150);
await p.fill(".form .grid input[type=text] >> nth=0", "Test Skill");
await p.click("[data-act=save]"); await wait(250);
const made = await p.evaluate(() => BQ.api.loreTables().skill_node.rows.find(r => r.Name === "Test Skill"));
ok(made && made.id > 100 && made.id < 200, "new warrior skill got an id in the 100s: " + (made && made.id));
// it needs a place: same spot as another? the checks list tells us
// delete it
await p.click("[data-act=save] ~ button.danger"); await wait(250);
ok(!(await p.evaluate(() => BQ.api.loreTables().skill_node.rows.some(r => r.Name === "Test Skill"))), "skill deleted");

// retraining table and trainers
const txt = await p.textContent("#main");
ok(/respec_base/.test(txt) && /Trainers/.test(txt), "retraining keys and trainers shown");
await p.evaluate(() => window.scrollTo(0, 99999)); await p.evaluate(() => document.querySelector("#main").scrollTo?.(0, 99999)); await wait(100);
await shot("skills-editor-points");
ok(errs.length === 0, "no page errors: " + errs.join("; "));
await b.close();
