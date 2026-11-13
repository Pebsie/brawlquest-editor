// Talk objectives: picking who to talk to rewrites the tracker text that only
// named an NPC ("Talk to Brother Dan" from the new-objective default) and
// keeps the author's own words; the checks flag "Talk to X" aimed at someone
// else; the Quest Studio play-through ticks each talk without handing in and
// hands in only back at the turn-in NPC (also when the turn-in NPC is the
// last talk). Uses pebsie's "Spreading the GOOD NEWS" (quest 1701).
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-talk-steps.mjs
const { chromium } = await import(process.env.PW || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8768/index.html";
const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const wait = ms => p.waitForTimeout(ms);
p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
await p.goto(URL);
await p.setInputFiles("#open", DB);
await p.waitForFunction(() => typeof S !== "undefined" && S.c && S.c.quests && S.npcBy);
await wait(400);
const steps = () => p.evaluate(() => JSON.parse(S.c.quests.find(q => q.id === 1701).Steps));

// ---- the rules
const unit = await p.evaluate(() => {
  const s1 = { Type: "talk", NPC: 5, Text: "Talk to Brother Dan" }; setTalkNPC(s1, 6);
  const s2 = { Type: "talk", NPC: 5, Text: "Ask Fred about the beer" }; setTalkNPC(s2, 6);
  const s3 = { Type: "talk", NPC: 6, Text: "" }; setTalkNPC(s3, 20);
  const s4 = { Type: "talk", NPC: 6, Text: "Talk to Brother Dan" }; setTalkNPC(s4, 1700); // his data: stale, then re-picked
  return { s1, s2, s3, s4, mis: talkTextMismatch({ Type: "talk", NPC: 6, Text: "Talk to Brother Dan" }), fine: talkTextMismatch({ Type: "talk", NPC: 6, Text: "Talk to Bartender Fred" }), own: talkTextMismatch({ Type: "talk", NPC: 6, Text: "Talk to the barman" }) };
});
ok(unit.s1.NPC === 6 && unit.s1.Text === "Talk to Bartender Fred", "picking Fred rewrites the default text: " + unit.s1.Text);
ok(unit.s2.NPC === 6 && unit.s2.Text === "Ask Fred about the beer", "the author's own words stay");
ok(unit.s3.Text === "Talk to Blacksmith", "empty text gets the name");
ok(unit.s4.Text === "Talk to Matt Dealer", "stale 'Talk to Brother Dan' on a Fred step is fixed on the next pick");
ok(unit.mis === "Brother Dan" && unit.fine === "" && unit.own === "", "mismatch check names the other NPC only");

// ---- Quest Studio sheet: the warning, and add + pick
await p.evaluate(() => { location.hash = "#studio/journey/1701"; });
await p.waitForSelector("#qs-drawer .qs-steps .qs-step", { timeout: 30000 });
await wait(600);
const iss = await p.$eval("#qs-drawer", d => d.textContent);
ok(/Objective 1 says "Talk to Brother Dan" but you talk to Bartender Fred/.test(iss), "sheet warns about the stale text on objective 1");
await p.selectOption("#qs-drawer select.qs-sel:not([class*=x])>>nth=-1", "talk").catch(async () => {
  const sels = await p.$$("#qs-drawer select.qs-sel");
  for (const s of sels) if (await s.evaluate(e => [...e.options].some(o => o.textContent === "+ objective..."))) { await s.selectOption("talk"); break; }
});
await wait(600);
let st = await steps();
ok(st.length === 5 && st[4].NPC === 5 && st[4].Text === "Talk to Brother Dan", "a new talk objective starts at the hand-in NPC: " + JSON.stringify(st[4]));
await p.click("#qs-drawer .qs-step >> nth=4 >> .qs-chip");
await p.waitForSelector(".qs-pgrid .qs-pcell");
await p.fill("input.qs-in[type=search] >> nth=-1", "Matt Dealer"); await p.dispatchEvent("input.qs-in[type=search] >> nth=-1", "input"); await wait(300);
await p.click(".qs-pgrid .qs-pcell:has-text('Matt Dealer') >> nth=0"); await wait(600);
st = await steps();
ok(st[4].NPC === 1700 && st[4].Text === "Talk to Matt Dealer", "picking Matt Dealer: aimed at him and the text says so: " + JSON.stringify(st[4]));
await p.click("#qs-drawer .qs-step >> nth=4 >> button.qs-mini[title=Remove]"); await wait(500);
ok((await steps()).length === 4, "removed the test objective again");

// ---- Quests tab form: the NPC dropdown does the same
await p.evaluate(() => { location.hash = "#quest/1701"; });
await p.waitForSelector(".steps select", { timeout: 30000 }); await wait(400);
const npcSel = await p.$$(".steps .top select");
let picked = false;
for (const s of npcSel) if (await s.evaluate(e => [...e.options].some(o => o.value === "1700") && e.value === "6")) { await s.selectOption("20"); picked = true; break; }
await wait(200);
const formText = await p.evaluate(() => [...document.querySelectorAll(".steps input")].map(i => i.value).find(v => /^Talk to /.test(v)));
ok(picked && formText === "Talk to Blacksmith", "form: picking the Blacksmith on step 1 rewrites its stale text: " + formText);

// ---- the play-through (same rules as the game)
const play = await p.evaluate(() => {
  const P = { level: 5, done: new Set(), state: {}, follow: false, talked: {}, log: [], day: qsToday(), claims: {}, variant: {} };
  const n = id => ({ id, Name: S.npcBy[id].Name, ImgPath: S.npcBy[id].ImgPath, Conversation: S.npcBy[id].Conversation });
  const out = [];
  qsTalk(P, n(5), "accept:1701");
  for (const id of [20, 6, 1700, 16]) {
    const v = qsTalk(P, n(id), "");
    const after = qsTalk(P, n(id), v.options[0].k);
    const dan = qsTalk(P, n(5), "");
    out.push({ id, text: v.text, done: P.done.has(1701), state: P.state[1701], turnin: v.options.concat(after.options).some(o => /^turnin:/.test(o.k)), dan: dan.line, danText: dan.text });
  }
  return { out, done: P.done.has(1701) };
});
const mid = play.out.slice(0, 3);
ok(mid.every(r => r.state === "active" && !r.done && !r.turnin && r.dan !== "Complete"), "play: the first three talks tick only, Dan is still waiting: " + JSON.stringify(mid.map(r => [r.id, r.state, r.dan])));
ok(play.out.every(r => r.text && !/All sorted/.test(r.text)), "play: each says their own line, never the hand-in");
ok(play.out[3].dan === "Complete" && play.done, "play: after the fourth, back at Dan it's handed in");

// the turn-in NPC as the last talk: ticks, then the same conversation hands in
const last = await p.evaluate(() => {
  const q = S.c.quests.find(q => q.id === 1701), keep = q.Steps, seq = q.Sequential;
  const ss = JSON.parse(keep); ss.push({ Type: "talk", NPC: 5, Count: 1, Text: "Talk to Brother Dan", Line: "So, what did they say?" }); q.Steps = JSON.stringify(ss); q.Sequential = 1;
  try {
    const P = { level: 5, done: new Set(), state: {}, follow: false, talked: {}, log: [], day: qsToday(), claims: {}, variant: {} };
    const n = id => ({ id, Name: S.npcBy[id].Name, ImgPath: S.npcBy[id].ImgPath, Conversation: S.npcBy[id].Conversation });
    qsTalk(P, n(5), "accept:1701");
    const early = qsTalk(P, n(5), "");
    for (const id of [6, 16, 20, 1700]) qsTalk(P, n(id), "");
    const v = qsTalk(P, n(5), ""), st = P.state[1701];
    const w = qsTalk(P, n(5), v.options[0].k);
    return { early: early.text, line: v.text, st, after: w.line, done: P.done.has(1701) };
  } finally { q.Steps = keep; q.Sequential = seq; }
});
ok(!/what did they say/.test(last.early), "in order: Dan's own talk waits its turn");
ok(last.line === "So, what did they say?" && last.st === "ready" && last.after === "Complete" && last.done, "in order: Dan's talk last, then the same conversation hands in: " + JSON.stringify(last));

ok(!errs.length, "no page errors " + errs.join(" | "));
await b.close();
