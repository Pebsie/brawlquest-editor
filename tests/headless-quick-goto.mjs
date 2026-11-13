// Quick Quest: a quest with three Go-to destinations saves as three reach
// steps (the API's existing quest step format), in order, with their own
// coordinates. Add, remove and reorder are part of the flow.
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-quick-goto.mjs
const { chromium } = await import(process.env.PW || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8768/index.html";
const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }

const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const wait = ms => p.waitForTimeout(ms);

const p = await (await b.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
await p.goto(URL);
await p.setInputFiles("#open", DB);
await p.waitForFunction(() => typeof S !== "undefined" && S.c && S.c.quests);
await wait(400);
const before = await p.evaluate(() => S.c.quests.length);

await p.evaluate(() => { location.hash = "#studio/quick"; });
await p.waitForFunction(() => typeof S !== "undefined" && S.world && S.c && S.c.npcs && S.c.npcs.length, { timeout: 60000 });
await p.waitForSelector(".qq-pc[data-npc]", { timeout: 30000 });
await wait(400);

const fred = await p.evaluate(() => S.c.npcs.find(n => n.Name === "Bartender Fred").id);
ok(fred != null, "Bartender Fred is in the database");
// If a giver is already folded (e.g. an NPC with id 0), open the picker again.
if (!await p.$(".qq-pc[data-npc]")) {
  const change = await p.$(".qq-card[data-card=giver] button:has-text('change')");
  if (change) await change.click();
  else await p.click("text=Start again");
  await p.waitForSelector(".qq-pc[data-npc]", { timeout: 15000 });
}
const find = await p.$('input[data-qq="npcfind"]');
if (find) { await find.fill("Bartender Fred"); await wait(200); }
await p.click(`.qq-pc[data-npc="${fred}"]`);
await wait(300);
await p.click('.qq-type[data-type="reach"]');
await p.waitForSelector('.qq-obj[data-type="reach"] canvas');

const STOPS = [
  { x: 10, y: -9, place: "the barracks" },
  { x: 0, y: -3, place: "the beach" },
  { x: 8, y: 20, place: "the enrolment office" }
];

async function setStop(index, stop) {
  await p.evaluate(({ index, stop }) => {
    const o = QQ.st.objs[index];
    o.x = stop.x; o.y = stop.y; o.unset = false; o.picking = false; o.place = stop.place;
    o.view = { cx: stop.x, cy: stop.y, sc: 12 };
    qqDraw();
  }, { index, stop });
  await wait(200);
}

await setStop(0, STOPS[0]);
ok(await p.$(".qq-add-place") !== null, "a set destination offers Add another place");
await p.click(".qq-add-place");
await wait(200);
ok(await p.evaluate(() => QQ.st.objs.length === 2 && QQ.st.objs[1].type === "reach" && QQ.st.objs[1].unset), "Add another place appends a second goto that still needs a pin");
await p.waitForSelector('.qq-obj[data-obj="1"] canvas');
await setStop(1, STOPS[1]);
await p.click('.qq-obj[data-obj="1"] .qq-add-place');
await wait(200);
await p.waitForSelector('.qq-obj[data-obj="2"] canvas');
await setStop(2, STOPS[2]);
ok(await p.evaluate(() => QQ.st.objs.filter(o => o.type === "reach" && !o.unset).length === 3), "three goto destinations are set");
ok(await p.evaluate(() => QQ.st.inOrder === true), "several gotos default to In this order");

// reorder: move the last stop up once, then up again, then we put it back
// by moving the new first (office) down twice — or just swap 0 and 1 and assert.
await p.click('.qq-obj[data-obj="2"] .qq-up');
await wait(150);
await p.click('.qq-obj[data-obj="1"] .qq-up');
await wait(150);
const orderAfter = await p.evaluate(() => QQ.st.objs.map(o => o.place));
ok(orderAfter[0] === "the enrolment office" && orderAfter[1] === "the barracks" && orderAfter[2] === "the beach",
  "reorder moves destinations (got " + JSON.stringify(orderAfter) + ")");
// put them back to barracks, beach, office with two downs on the first
await p.click('.qq-obj[data-obj="0"] .qq-down');
await wait(150);
await p.click('.qq-obj[data-obj="1"] .qq-down');
await wait(150);
const orderRestored = await p.evaluate(() => QQ.st.objs.map(o => o.place));
ok(orderRestored.join(",") === "the barracks,the beach,the enrolment office",
  "reorder down restores the original order (got " + JSON.stringify(orderRestored) + ")");

await p.click("#qq-objs-ok");
await wait(300);
await p.fill('textarea[data-qq="Offer"]', "I need you to walk a loop: the barracks, the beach, then the enrolment office. In that order.");
await p.fill('textarea[data-qq="Complete"]', "That's the route. Thank you.");
await p.click("#qq-words-ok");
await wait(300);
await p.fill('input[data-qq="title"]', "Three Stops on the Shore");
await p.click("#qq-make");
await wait(900);

const q = await p.evaluate(() => S.c.quests.find(q => q.Title === "Three Stops on the Shore"));
ok(!!q, "the quest was saved");
const steps = q ? JSON.parse(q.Steps) : [];
console.log("saved steps:", JSON.stringify(steps), "Sequential=" + (q && q.Sequential));
ok(steps.length === 3 && steps.every(s => s.Type === "reach"), "saved three reach steps (the API's existing format)");
ok(steps[0].X === 10 && steps[0].Y === -9 && /barracks/i.test(steps[0].Text), "first stop is the barracks at 10,-9");
ok(steps[1].X === 0 && steps[1].Y === -3 && /beach/i.test(steps[1].Text), "second stop is the beach at 0,-3");
ok(steps[2].X === 8 && steps[2].Y === 20 && /enrolment/i.test(steps[2].Text), "third stop is the enrolment office at 8,20");
ok(steps.every(s => s.Radius === 3 && s.Count === 1), "each reach step has Radius 3 and Count 1, as the API expects");
ok(q && +q.Sequential === 1, "Sequential is set so the destinations run in order");
ok((await p.evaluate(() => S.c.quests.length)) === before + 1, "one quest added");

ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (process.exitCode) console.log("FAILED");
else console.log("all ok");
