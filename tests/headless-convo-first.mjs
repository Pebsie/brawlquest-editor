// Conversation first: an NPC's conversation is one tree (greeting -> chat
// lines -> the quests it brings up -> offer, accept / decline, progress,
// hand-in), every line editable in place; a new quest is made from a line of
// the chat; a quest's sheet shows the way to it through the giver's chat.
// Desktop and a 390x844 phone with touch.
// Serve this folder on 127.0.0.1:8977 first (or set URL); DB has the quest
// dialogue columns (the content repo's db).
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html", DB = process.env.DB || "/workspace/npcwork/test.db", OUT = process.env.OUT || "/workspace/npcwork/";
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
const greet = m => m.evaluate(() => { const n = S.npcBy[15]; return { id: n.Conversation, o: parseOptions(S.convBy[n.Conversation].Options) }; });
const tap = (m, sel) => m.tap ? m.tap(sel) : m.click(sel);
const noOverflow = m => m.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const hideToast = m => m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; });
const C = "#qs-greeting .qs-convo";

{ // ---- desktop: Dancing Man (15), giver of Rise and Shine (1300)
  const m = await open(1400, 1000, "#studio/npc/15");
  await m.waitForSelector(C);
  ok(await m.$(`${C} .qs-own details.qs-qbranch[data-quest="1300"]`) !== null, "a quest nobody brings up is listed as opening straight away");
  ok(await m.$$eval(".qs-dlg, .greet-win", e => e.length) === 0, "no separate greeting / dialogue / quest-line panels: one conversation");
  await m.click(`${C} .qs-own .qs-tochat >> nth=0`); await m.waitForTimeout(800);
  let g = await greet(m);
  ok(g.o.some(([l, t]) => t === "@quest:1300" && l === "Got any work for me?"), "'bring it up from the greeting' adds an answer that brings up the quest " + JSON.stringify(g.o));
  ok(await m.$(`${C} .qs-branches details.qs-qbranch[data-quest="1300"][open] .qs-flow .qs-stage[data-stage=offer]`) !== null, "the quest now hangs off the greeting, unfolded with its offer");
  ok(await m.$(`${C} .qs-own details.qs-qbranch[data-quest="1300"]`) === null, "...and is no longer 'opens straight away'");
  // edit the player's answer that brings it up, and the offer, in place
  const row = `${C} .qs-sc.greeting .qs-op[data-kind=quest]`;
  await m.click(`${row} .qs-ed`); await m.fill(`${row} .qs-edit`, "Need a hand with anything?"); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  g = await greet(m);
  ok(g.o.some(([l, t]) => t === "@quest:1300" && l === "Need a hand with anything?"), "the answer's words edit in place");
  const offer = `${C} details.qs-qbranch[data-quest="1300"] .qs-stage[data-stage=offer] .qs-sc-say .qs-ed`;
  await m.click(offer); await m.fill(`${C} details.qs-qbranch[data-quest="1300"] .qs-stage[data-stage=offer] .qs-sc-say .qs-edit`, "Well my friend, the beach needs walking."); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  ok(/beach needs walking/.test(await m.evaluate(() => qById(1300).Offer)), "the offer edits inside the conversation");
  // the in-game preview / playtest: greeting first, then the answer brings it up
  await m.evaluate(() => { location.hash = "#studio/play"; }); await m.waitForTimeout(700);
  await m.evaluate(() => { QS.playNpc = 15; qsRerender(); }); await m.waitForTimeout(500);
  await m.click(".qs-play .qs-game .qs-speech").catch(() => {});
  let opts = await m.$$eval(".qs-play .qs-gopt", x => x.map(e => e.textContent));
  ok(opts.some(o => /Need a hand with anything\?/.test(o)) && !opts.some(o => /\[Quest\] Rise and Shine/.test(o)), "playtest: the greeting opens and brings the quest up as an answer (no quest-first, no [Quest] row) " + JSON.stringify(opts));
  await m.click('.qs-play .qs-gopt:has-text("Need a hand with anything?")'); await m.waitForTimeout(300); await m.click(".qs-play .qs-speech").catch(() => {});
  ok(/beach needs walking/.test(await m.$eval(".qs-play .qs-game .qs-speech", e => e.textContent)), "playtest: picking it opens the offer");
  // + quest from here: a new quest made from a line, linked in, no page jump
  await m.evaluate(() => { location.hash = "#studio/npc/15"; }); await m.waitForTimeout(1200);
  await m.click(`${C} .qs-sc.greeting .qs-addquest`); await m.waitForTimeout(400);
  await m.click('.qs-modal .qs-btn:has-text("pick enemies")').catch(() => {}); await m.waitForTimeout(200);
  await m.click('.qs-modal .qs-pcell >> text="Wolf"').catch(() => {});
  await m.click('.qs-modal .qs-btn:has-text("Use these")').catch(() => {}); await m.waitForTimeout(200);
  await m.fill('.qs-modal input[placeholder^="e.g. Pelt"]', "Dance Off");
  await m.fill(".qs-modal textarea", "Them wolves have no rhythm. Show them how it's done.");
  await m.click('.qs-modal .qs-btn:has-text("Make the quest")'); await m.waitForTimeout(1200);
  const nq = await m.evaluate(() => S.c.quests.find(q => q.Title === "Dance Off"));
  g = await greet(m);
  ok(nq && nq.Giver === 15, "+ quest from here makes a quest given by this NPC");
  ok(nq && g.o.some(([, t]) => t === "@quest:" + nq.id), "...that the greeting brings up");
  ok(/#studio\/npc\/15/.test(await m.evaluate(() => location.hash)) && await m.$(`${C} details.qs-qbranch[data-quest="${nq && nq.id}"][open]`) !== null, "...and stays on the conversation, with the new quest unfolded");
  // + question, then route its answer to a quest via the destination picker
  const before = (await greet(m)).o.length;
  await m.click(`${C} .qs-sc.greeting .qs-addq`); await m.waitForTimeout(800); await m.keyboard.press("Escape"); await m.waitForTimeout(200);
  g = await greet(m);
  const sub = g.o.find(([, t]) => !/^@|^1$/.test(String(t).trim()) && !String(t).startsWith("@"));
  ok(g.o.length === before + 1 && sub, "+ question adds an answer leading to a new line");
  const subSel = `${C} .qs-sc[data-node="${sub[1]}"] .qs-op >> nth=0 >> select.qs-act`;
  await m.selectOption(subSel, "@quest:" + nq.id); await m.waitForTimeout(600);
  ok(await m.evaluate(id => parseOptions(S.convBy[id].Options)[0][1], sub[1]) === "@quest:" + nq.id, "a deeper line's answer re-routes to a quest from its picker");
  await m.evaluate(() => document.querySelectorAll("*").forEach(e => { if (e.scrollTop) e.scrollTop = 0; })); await hideToast(m);
  await m.evaluate(() => document.querySelector("#qs-greeting").scrollIntoView()); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + "convo-npc-desktop.png" });
  // the quest sheet: the way to it through the chat, editable
  await m.evaluate(() => { location.hash = "#studio/journey/1300"; }); await m.waitForTimeout(1300);
  ok(await m.$('#qs-drawer .qs-stage[data-stage=lead] .qs-sc.path .qs-op.way') !== null, "quest sheet: 'In the chat' shows the greeting with the answer that brings it up marked");
  await m.click('#qs-drawer .qs-stage[data-stage=lead] .qs-sc-say .qs-ed'); await m.fill('#qs-drawer .qs-stage[data-stage=lead] .qs-sc-say .qs-edit', "Oi! You. Yes, you.");
  await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  ok((await m.evaluate(() => S.convBy[S.npcBy[15].Conversation].Title)) === "Oi! You. Yes, you.", "quest sheet: the giver's greeting edits there");
  await m.click("#qs-drawer .qs-widen"); await m.waitForTimeout(300);
  ok(await m.$eval("#qs-drawer", e => e.getBoundingClientRect().width > 700), "the drawer widens for the conversation");
  await hideToast(m); await m.screenshot({ path: OUT + "convo-quest-desktop.png" });
  // a quest not brought up: one button links it
  await m.evaluate(() => { location.hash = "#studio/journey/1301"; }); await m.waitForTimeout(1200);
  const g1301 = await m.evaluate(() => qById(1301).Giver);
  if (await m.$("#qs-bring-up")) {
    await m.click("#qs-bring-up"); await m.waitForTimeout(800);
    ok(await m.evaluate(g => parseOptions(S.convBy[S.npcBy[g].Conversation].Options).some(([, t]) => t === "@quest:1301"), g1301), "'Bring it up in their chat' links a quest from its own sheet");
  } else ok(true, "quest 1301 already brought up / no greeting");
  // save and reopen keeps the links
  const [dl] = await Promise.all([m.waitForEvent("download"), m.click("#btn-save")]);
  await dl.saveAs("/tmp/convo-first.db");
  await m.goto(URL); await m.setInputFiles("#open", "/tmp/convo-first.db"); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(600);
  g = await greet(m);
  ok(g.o.some(([, t]) => t === "@quest:1300"), "links survive Save .db and reopening");
  const probs = await m.evaluate(() => BQCheck.run(BQ.query).all.filter(x => x.level === "error" && /@quest/.test(x.msg)).map(x => x.msg));
  ok(!probs.length, "validation: @quest answers are not missing lines " + JSON.stringify(probs.slice(0, 2)));
  await m.close();
}

{ // ---- phone, touch
  const m = await open(390, 844, "#studio/npc/15");
  await m.waitForSelector(C);
  ok(await noOverflow(m), "390px: NPC conversation has no sideways scroll");
  await m.tap(`${C} .qs-own .qs-tochat >> nth=0`); await m.waitForTimeout(800);
  ok((await greet(m)).o.some(([, t]) => t === "@quest:1300"), "390px: tap brings a quest up from the greeting");
  const small = await m.$$eval(`${C} .qs-act, ${C} .qs-op-x, ${C} .qs-sc-add .qs-btn, ${C} .qs-qbranch > summary`, els => els.filter(e => e.offsetParent).map(e => [e.className.slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 40));
  ok(!small.length, "390px: pickers, buttons and quest headers are finger-sized " + JSON.stringify(small.slice(0, 4)));
  const wide = await m.$$eval(`${C} .qs-sc, ${C} .qs-op, ${C} .qs-act, ${C} .qs-qbranch`, els => els.filter(e => e.getBoundingClientRect().right > innerWidth + 1).length);
  ok(wide === 0, "390px: nothing sticks out of the screen");
  await m.tap(`${C} .qs-sc.greeting .qs-op[data-kind=quest] .qs-ed`); await m.waitForTimeout(200);
  await m.fill(`${C} .qs-sc.greeting .qs-op[data-kind=quest] .qs-edit`, "Any jobs going?"); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  ok((await greet(m)).o.some(([l, t]) => t === "@quest:1300" && l === "Any jobs going?"), "390px: an answer edits by touch");
  await m.evaluate(() => document.querySelector("#qs-greeting").scrollIntoView()); await hideToast(m); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + "convo-npc-phone.png" });
  await m.evaluate(() => document.querySelector('details.qs-qbranch[data-quest="1300"] .qs-stage[data-stage=offer]').scrollIntoView()); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + "convo-npc-phone-offer.png" });
  await m.evaluate(() => { location.hash = "#studio/journey/1300"; }); await m.waitForTimeout(1300);
  ok(await noOverflow(m), "390px: quest sheet has no sideways scroll");
  await m.evaluate(() => { const d = document.querySelector("#qs-drawer"); d.style.height = "92%"; d.scrollTop = document.querySelector("#qs-drawer .qs-stage[data-stage=lead]").offsetTop - 60; }); await m.waitForTimeout(300);
  ok(await m.$('#qs-drawer .qs-stage[data-stage=lead] .qs-op.way') !== null, "390px: quest sheet shows the way in through the chat");
  await hideToast(m); await m.screenshot({ path: OUT + "convo-quest-phone.png" });
  await m.close();
}
console.log("ERRORS:\n" + errs.join("\n"));
if (errs.length) process.exitCode = 1;
await b.close();
