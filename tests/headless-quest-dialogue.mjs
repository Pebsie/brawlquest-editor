// Every piece of a quest's dialogue from the quest itself: the whole path at
// a glance (who says what, which answer goes where), the giver's chat that
// brings it up (and all of it), offer / after accepting / talk objectives at
// other NPCs (line and answer, or a conversation of their own) / in progress /
// hand-in, the quests it unlocks, each line's portrait and gift ("more"), in
// Quest Studio's quest sheet and in the classic Quests form. Desktop and a
// 390x844 phone with touch. Serve this folder on 127.0.0.1:8977 first.
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html", DB = process.env.DB || "/workspace/npcwork/test.db", OUT = process.env.OUT || "/workspace/npcwork/";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const open = async (w, hgt, hash, mob = w < 700, db = DB) => {
  const m = await (await b.newContext({ viewport: { width: w, height: hgt }, hasTouch: mob, isMobile: mob, deviceScaleFactor: mob ? 2 : 1 })).newPage();
  m.on("pageerror", e => errs.push(`${w} pageerror ` + e.stack)); m.on("console", x => { if (x.type() === "error" && !/404/.test(x.text())) errs.push(`${w} console ` + x.text()); });
  m.on("dialog", d => d.accept());
  await m.goto(URL); await m.setInputFiles("#open", db); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(500);
  await m.evaluate(h => { location.hash = h; }, hash); await m.waitForTimeout(1500);
  return m;
};
const step = (m, qid, i) => m.evaluate(([qid, i]) => JSON.parse(qById(qid).Steps)[i], [qid, i]);
const hideToast = m => m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; });
const noOverflow = m => m.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const D = "#qs-drawer", T = `${D} .qs-stage[data-stage="talk-1"]`; // Rise and Shine (1300): objective 2 is talking to Robert Squalton

{ // ---- desktop, Quest Studio's quest sheet
  const m = await open(1400, 1000, "#studio/journey/1300");
  await m.waitForSelector(`${D} .qs-mapbox`);
  const beats = await m.$$eval(`${D} .qs-map > .qs-beat`, e => e.map(x => x.className.replace("qs-beat ", "") + ":" + x.querySelector(".qs-beat-h b").textContent));
  ok(beats.join("|") === "lead:Dancing Man|st:Dancing Man|st:Dancing Man|talk:Robert Squalton|st:Robert Squalton|st:Robert Squalton|next:Then", "the path at a glance: way in, offer, after accepting, Robert's talk objective, in progress, hand-in, then " + beats.join("|"));
  ok(await m.$$eval(`${D} .qs-map .qs-tag`, e => e.length) >= 7, "...with every player answer and what it does");
  await m.click(`${D} .qs-map > .qs-beat.talk .qs-beat-h`); await m.waitForTimeout(500);
  ok(await m.$eval(T, e => e.classList.contains("flash")), "tapping a beat jumps to its lines");
  // Robert's line and the player's answer
  await m.click(`${T} .qs-sc-say .qs-ed`); await m.fill(`${T} .qs-sc-say .qs-edit`, "Better, are you? Sit. We need words."); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  ok((await step(m, 1300, 1)).Line === "Better, are you? Sit. We need words.", "the talk objective's NPC line edits in the quest");
  await m.click(`${T} .qs-op .qs-ed`); await m.fill(`${T} .qs-op .qs-edit`, "Fine, fine."); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  ok((await step(m, 1300, 1)).Reply === "Fine, fine.", "...and the player's answer to it (was the fixed \"Right.\")");
  // a conversation of its own
  await m.click(`${T} .qs-conv`); await m.waitForTimeout(900);
  let s1 = await step(m, 1300, 1);
  const root = await m.evaluate(id => { const c = S.convBy[id]; return c && { t: c.Title, o: parseOptions(c.Options) }; }, s1.Tree || "");
  ok(s1.Tree && root && root.t === "Better, are you? Sit. We need words." && root.o[0][0] === "Fine, fine." && root.o[0][1] === "@next", "Turn into a conversation: Steps[1].Tree, first line = the line, answer carries on " + JSON.stringify(root));
  await m.click(`${T} .qs-sc.root .qs-addq`); await m.waitForTimeout(900); await m.keyboard.press("Escape");
  const r2 = await m.evaluate(id => parseOptions(S.convBy[id].Options), s1.Tree);
  ok(r2.length === 2 && r2.some(([, t]) => t.startsWith("q1300-")), "+ question in Robert's conversation adds a branch " + JSON.stringify(r2));
  const picks = await m.$$eval(`${T} .qs-sc.root .qs-op select.qs-act >> nth=0`, e => [...e[0].options].map(o => o.value)).catch(() => m.$eval(`${T} .qs-sc.root .qs-op select.qs-act`, e => [...e.options].map(o => o.value)));
  ok(picks.includes("@next") && picks.includes("@close") && picks.includes("+new") && !picks.includes("@accept"), "its 'where it goes' picker: carry on, end, other lines, + a new line " + JSON.stringify(picks));
  ok(await m.$$eval(`${D} .qs-map > .qs-beat.talk .qs-ol`, e => e.length) >= 2, "the path at a glance shows Robert's branches");
  // play it from there
  await m.click(`${T} .qs-sc.root .qs-play-from`); await m.waitForTimeout(500);
  const sp = await m.$eval(".qs-modal .qs-speech", e => e.textContent).catch(() => "");
  ok(/Sit\. We need words/.test(sp), "play: the game window opens at Robert on the objective: " + sp.slice(0, 60));
  await m.click("#qs-prev-close").catch(() => {}); await m.waitForTimeout(200);
  // "more": portrait, gift and identifier of a line, in place
  await m.click(`${T} .qs-sc.root .qs-more`); await m.waitForTimeout(300);
  ok(await m.$(`${T} .qs-morebox .node textarea`) !== null, "'more' opens the line's full fields (portrait, items given, answers) in place");
  // the next quest's lines
  await m.click(`${D} .qs-stage[data-stage=next] details.qs-qbranch.next >> nth=0 >> summary`); await m.waitForTimeout(700);
  const nq = await m.$eval(`${D} .qs-stage[data-stage=next] details.qs-qbranch.next`, e => +e.dataset.quest);
  const nOffer = `${D} .qs-stage[data-stage=next] details[open] .qs-stage[data-stage=offer] .qs-sc-say`;
  ok(await m.$(nOffer) !== null, `the quest it unlocks (${nq}) unfolds with its own lines`);
  await m.click(`${nOffer} .qs-ed`); await m.fill(`${nOffer} .qs-edit`, "Swing it low, swing it proud."); await m.keyboard.press("Enter"); await m.waitForTimeout(700);
  const no = await m.evaluate(id => { const q = qById(id); return q.OfferTree && S.convBy[q.OfferTree] ? S.convBy[q.OfferTree].Title : q.Offer; }, nq);
  ok(no === "Swing it low, swing it proud.", "...and its offer edits from here");
  // all of the giver's chat
  await m.click(`${D} .qs-stage[data-stage=lead] details.qs-rest > summary`); await m.waitForTimeout(700);
  ok(await m.$(`${D} .qs-stage[data-stage=lead] details.qs-rest[open] .qs-convo .qs-sc.greeting`) !== null, "the giver's whole conversation opens inside the quest");
  await m.click(`${D} .qs-stage[data-stage=lead] details.qs-rest > summary`); await m.waitForTimeout(300);
  await m.click(`${D} .qs-widen`); await m.waitForTimeout(200);
  await m.evaluate(() => { const d = document.querySelector("#qs-drawer"); d.scrollTop = document.querySelector("#qs-drawer .qs-mapbox").offsetTop - 50; }); await hideToast(m); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + "quest-dialogue-desktop.png" });
  await m.evaluate(() => { const d = document.querySelector("#qs-drawer"); d.scrollTop = document.querySelector('#qs-drawer .qs-stage[data-stage="talk-1"]').offsetTop - 50; }); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + "quest-dialogue-talk-desktop.png" });
  const [dl] = await Promise.all([m.waitForEvent("download"), m.click("#btn-save")]);
  await dl.saveAs("/tmp/quest-dialogue.db");
  await m.close();
}

{ // ---- desktop, the classic Quests form, on the saved db
  const m = await open(1400, 1000, "#quest/1300", false, "/tmp/quest-dialogue.db");
  ok(await m.$("#qline-Offer") !== null && await m.$eval("#qline-Offer", e => e.classList.contains("qs-stage")), "classic quest form: the offer box is now the quest's conversation (no plain text area)");
  ok(await m.$("#quest-dialogue .qs-mapbox") !== null && await m.$('#quest-dialogue .qs-stage[data-stage="talk-1"] .qs-tree') !== null, "...with the path at a glance and Robert's conversation");
  ok(await m.$('#quest-dialogue .qs-stage[data-stage="lead"]') !== null && await m.$('#quest-dialogue .qs-stage[data-stage="next"]') !== null, "...and the way in and what it unlocks");
  const acc = '#quest-dialogue .qs-stage[data-stage=accept] .qs-sc-say';
  await m.click(`${acc} .qs-ed`); await m.fill(`${acc} .qs-edit`, "Off you pop then."); await m.keyboard.press("Enter"); await m.waitForTimeout(800);
  const accNow = await m.evaluate(() => { const q = qById(1300); return q.AcceptTree && S.convBy[q.AcceptTree] ? S.convBy[q.AcceptTree].Title : q.Accept; });
  ok(accNow === "Off you pop then.", "classic form: a line edits in place and saves at once");
  ok(await m.$("#quest-dialogue .qs-mapbox") !== null, "...and the dialogue redraws in the form");
  // Save on the form keeps the dialogue edits and the talk conversation
  const tree = (await step(m, 1300, 1)).Tree;
  await m.fill(".form .grid input[type=text] >> nth=0", "Rise and Shine!"); await m.click('.form .bar button.primary:has-text("Save")'); await m.waitForTimeout(900);
  const after = await m.evaluate(() => { const q = qById(1300); return { t: q.Title, s: JSON.parse(q.Steps)[1], a: q.AcceptTree && S.convBy[q.AcceptTree] ? S.convBy[q.AcceptTree].Title : q.Accept }; });
  ok(after.t === "Rise and Shine!" && after.a === "Off you pop then." && after.s.Tree === tree && after.s.Reply === "Fine, fine.", "Save on the form keeps every dialogue edit (lines, talk Reply and Tree) " + JSON.stringify(after));
  await m.evaluate(() => { location.hash = "#quest/1300/line/Complete"; }); await m.waitForTimeout(900);
  ok(await m.evaluate(() => { const r = document.querySelector("#qline-Complete").getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), "#quest/ID/line/Complete (the NPCs tab's links) lands on the hand-in lines");
  await m.evaluate(() => document.querySelector("#quest-dialogue").scrollIntoView()); await hideToast(m); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + "quest-dialogue-classic-desktop.png" });
  const probs = await m.evaluate(() => BQCheck.run(BQ.query).all.filter(x => /q(uest )?1300/.test(x.where) && /conversation|Tree|Reply/.test(x.msg)).map(x => x.msg));
  ok(!probs.length, "validation: talk Tree / Reply are fine " + JSON.stringify(probs));
  await m.close();
}

for (const hash of ["#studio/journey/1300", "#quest/1300"]) { // ---- phone, touch
  const m = await open(390, 844, hash, true, "/tmp/quest-dialogue.db");
  const P = hash.startsWith("#studio") ? D : "#quest-dialogue", tag = hash.startsWith("#studio") ? "phone" : "classic-phone";
  await m.waitForSelector(`${P} .qs-mapbox`);
  ok(await noOverflow(m), `390px ${hash}: no sideways scroll`);
  const small = await m.$$eval(`${P} .qs-beat-h, ${P} .qs-act, ${P} .qs-sc-add .qs-btn, ${P} .qs-op-x`, els => els.filter(e => e.offsetParent).map(e => [e.className.slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 40));
  ok(!small.length, `390px ${hash}: beats, pickers and buttons are finger-sized ${JSON.stringify(small.slice(0, 4))}`);
  const wide = await m.$$eval(`${P} .qs-sc, ${P} .qs-op, ${P} .qs-act, ${P} .qs-beat`, els => els.filter(e => e.getBoundingClientRect().right > innerWidth + 1).length);
  ok(wide === 0, `390px ${hash}: nothing sticks out of the screen`);
  if (hash.startsWith("#studio")) await m.evaluate(() => { document.querySelector("#qs-drawer").style.height = "92%"; });
  await m.tap(`${P} .qs-map > .qs-beat.talk .qs-beat-h`); await m.waitForTimeout(600);
  const tr = `${P} .qs-stage[data-stage="talk-1"] .qs-sc.root .qs-op >> nth=0`;
  await m.tap(`${tr} >> .qs-ed`); await m.waitForTimeout(200);
  await m.fill(`${P} .qs-stage[data-stage="talk-1"] .qs-sc.root .qs-op .qs-edit`, "Go on then."); await m.keyboard.press("Enter"); await m.waitForTimeout(700);
  ok(await m.evaluate(() => { const s = JSON.parse(qById(1300).Steps)[1]; return parseOptions(S.convBy[s.Tree].Options)[0][0]; }) === "Go on then.", `390px ${hash}: Robert's answer edits by touch`);
  await hideToast(m);
  await m.evaluate(p => { const t = document.querySelector(p + " .qs-mapbox"); t.scrollIntoView(); }, P); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + `quest-dialogue-${tag}.png` });
  await m.evaluate(p => { const t = document.querySelector(p + ' .qs-stage[data-stage="talk-1"]'); t.scrollIntoView(); }, P); await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + `quest-dialogue-talk-${tag}.png` });
  await m.close();
}
console.log("ERRORS:\n" + errs.join("\n"));
if (errs.length) process.exitCode = 1;
await b.close();
