// Quest conversations in Quest Studio: the quest-first greeting flow, the
// editable greeting on the NPC sheet, the sequence a player sees with every
// line editable, and the branching offer editor (+ question, destinations,
// custom accept/decline wording, click-through preview). Desktop, 390 and 360.
// Serve this folder on 127.0.0.1:8977 first (or set URL).
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html", OLD = process.env.OLDDB || "/workspace/queststudio/data/bq-content.db", OUT = "/workspace/queststudio/";
const NEW = process.env.NEWDB || "/workspace/queststudio/data/bq-content-dialogue.db";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const open = async (w, hgt, db, hash, mob = w < 700) => {
  const m = await (await b.newContext({ viewport: { width: w, height: hgt }, hasTouch: mob, isMobile: mob, deviceScaleFactor: mob ? 2 : 1 })).newPage();
  m.on("pageerror", e => errs.push(`${w} pageerror ` + e.stack)); m.on("console", x => { if (x.type() === "error" && !/404/.test(x.text())) errs.push(`${w} console ` + x.text()); });
  await m.goto(URL); await m.setInputFiles("#open", db); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(500);
  await m.evaluate(h => { location.hash = h; }, hash); await m.waitForTimeout(1500);
  return m;
};
const quest = (m, id) => m.evaluate(id => { const q = S.c.quests.find(q => q.id === id); return q && { OfferTree: q.OfferTree, Replies: q.Replies, Offer: q.Offer }; }, id);
const node = (m, ident) => m.evaluate(i => { const c = S.c.conversations.find(c => c.Identifier === i); return c && { Title: c.Title, Options: c.Options }; }, ident);
const edit = async (m, sel, text) => { await m.click(sel); await m.waitForTimeout(100); await m.fill(sel.replace(/\.qs-ed$/, "") + " .qs-edit, " + sel + " .qs-edit", text); await m.keyboard.press("Enter"); await m.waitForTimeout(500); };
const noOverflow = m => m.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const FLOW = "#qs-drawer .qs-flow";

{ // ---- an old db: nothing breaks, one tap turns conversations on
  const m = await open(1400, 1000, OLD, "#studio/journey/1300");
  await m.waitForSelector(FLOW);
  ok(await m.$("#qs-dlg-enable") !== null, "old db: the sheet offers 'Enable quest conversations in this db'");
  ok((await m.$$(`${FLOW} .qs-stage`)).length >= 4, "old db: the four stages show (offer, after accepting, in progress, hand-in)");
  ok(await m.$(`${FLOW} .qs-conv`) === null, "old db: no 'Turn into a conversation' until it is enabled");
  const t = await m.$eval(`${FLOW} .qs-stage[data-stage="offer"] .qs-op.k-accept .rh`, e => e.textContent);
  ok(/I'll do it\./.test(t), "old db: the greyed default 'I'll do it.' is shown (" + t + ")");
  await m.click("#qs-dlg-enable"); await m.waitForTimeout(1500);
  ok(await m.evaluate(() => S.c.hasDialogue && S.c.hasDaily), "enable: the db has the dialogue columns (and daily, which they build on)");
  ok(await m.$("#qs-dlg-enable") === null && await m.$(`${FLOW} .qs-conv`) !== null, "enable: banner gone, 'Turn into a conversation' available");
  ok((await quest(m, 1300)).OfferTree === "", "enable: existing quests stay single-box");
  await m.close();
}

{ // ---- desktop: replies, tree, +question, destinations, preview
  const m = await open(1400, 1300, NEW, "#studio/journey/1300");
  await m.waitForSelector(FLOW);
  const S1 = `${FLOW} .qs-stage[data-stage="offer"]`;
  await edit(m, `${S1} .qs-op.k-accept .qs-ed`, "Right, I'm in.");
  ok((await quest(m, 1300)).Replies === '{"Accept":"Right, I\'m in."}', "own wording for accept saved in Replies: " + (await quest(m, 1300)).Replies);
  await edit(m, `${S1} .qs-op.k-menu .qs-ed`, "Not now, Dancing Man.");
  ok(/"Decline":"Not now, Dancing Man\."/.test((await quest(m, 1300)).Replies), "own wording for decline saved");
  await edit(m, `${FLOW} .qs-stage[data-stage="accept"] .qs-op .qs-ed`, "Consider it done.");
  ok(/"OnIt":"Consider it done\."/.test((await quest(m, 1300)).Replies), "own wording for 'On it.' saved");
  // a different line to the single box: edit the offer text
  await m.click(`${S1} [data-line="Offer"] .qs-ed`); await m.fill(`${S1} [data-line="Offer"] textarea`, "Oi! Beach boy! Up you get."); await m.keyboard.press("Enter"); await m.waitForTimeout(400);
  ok((await quest(m, 1300)).Offer === "Oi! Beach boy! Up you get.", "the single-box offer is editable in the sequence");
  // convert
  await m.click(`${S1.replace('.qs-stage[data-stage="offer"]', ".qs-stage")} .qs-conv[data-stage="offer"]`); await m.waitForTimeout(900);
  const tree = (await quest(m, 1300)).OfferTree;
  ok(tree === "q1300-offer", "turned into a conversation: OfferTree = " + tree);
  const root = await node(m, "q1300-offer");
  ok(root.Title === "Oi! Beach boy! Up you get." && root.Options === "[['Right, I\\'m in.','@accept'],['Not now, Dancing Man.','@decline']]".replace("\\'", "'"), "first line keeps the text; answers keep the author's wording: " + root.Options);
  // + question
  await m.click(`${S1} .qs-sc.root .qs-addq`); await m.waitForTimeout(700);
  ok(await m.$(`${S1} .qs-sc.root .qs-op-t .qs-edit`) !== null, "+ question opens the new answer for typing");
  await m.fill(`${S1} .qs-sc.root .qs-op-t .qs-edit`, "Who are you again?"); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  let r = await node(m, "q1300-offer");
  ok(/^\[\['Who are you again\?','q1300-ask'\],\['Right, I'm in\.','@accept'\],\['Not now, Dancing Man\.','@decline'\]\]$/.test(r.Options), "the question goes before accept/decline: " + r.Options);
  const sub = `${S1} .qs-sc.sub`;
  await edit(m, `${sub} .qs-sc-say .qs-ed`, "The Dancing Man. Obviously.");
  ok((await node(m, "q1300-ask")).Title === "The Dancing Man. Obviously.", "the NPC's reply is editable");
  await edit(m, `${sub} .qs-op .qs-ed`, "Ah. Right. Of course.");
  ok(/'Ah\. Right\. Of course\.','@offer'/.test((await node(m, "q1300-ask")).Options), "the new line's answer goes back to the offer by default");
  // a second question with a different accept wording on its own line
  await m.click(`${S1} .qs-sc.root .qs-addq`); await m.waitForTimeout(600);
  await m.fill(`${S1} .qs-sc.root .qs-op-t .qs-edit`, "What's in it for me?"); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  const subs = await m.$$(`${S1} .qs-sc.sub`);
  ok(subs.length === 2, "two questions, two replies");
  const sub2 = m.locator(`${S1} .qs-sc.sub`).nth(1);
  await sub2.locator(".qs-sc-say .qs-ed").click(); await sub2.locator(".qs-sc-say textarea").fill("Fame. Glory. A free dance."); await m.keyboard.press("Enter"); await m.waitForTimeout(500);
  await sub2.locator(".qs-op .qs-ed").click(); await sub2.locator(".qs-op .qs-edit").fill("Free dance? Done."); await m.keyboard.press("Enter"); await m.waitForTimeout(500);
  await m.locator(`${S1} .qs-sc.sub`).nth(1).locator("select.qs-act").selectOption("@accept"); await m.waitForTimeout(600);
  r = await node(m, "q1300-ask2");
  ok(/'Free dance\? Done\.','@accept'/.test(r.Options), "an answer on another line can accept, with its own wording: " + r.Options);
  ok(await m.$(`${S1} .qs-outline`) !== null && (await m.$$(`${S1} .qs-outline .qs-tag.act-accept`)).length >= 2, "the whole tree at a glance, accept answers tagged");
  // preview: click through
  await m.click(`${S1} .qs-sc.root .qs-play-from`); await m.waitForSelector(".qs-modal .qs-game"); await m.waitForTimeout(300);
  const say = async () => { await m.click(".qs-modal .qs-speech").catch(() => {}); return m.$eval(".qs-modal .qs-speech", e => e.textContent); };
  const opts = () => m.$$eval(".qs-modal .qs-gopt", els => els.map(e => e.textContent.replace(/^\d+\./, "")));
  ok(/Oi! Beach boy/.test(await say()) && /Beach boy[\s\S]*Walk|- /.test(await say()), "preview opens on the offer line + objectives");
  ok(JSON.stringify(await opts()) === JSON.stringify(["Who are you again?", "What's in it for me?", "Right, I'm in.", "Not now, Dancing Man.", "Goodbye."]), "preview options are the authored ones: " + JSON.stringify(await opts()));
  await m.click('.qs-modal .qs-gopt:has-text("Who are you again?")'); await m.waitForTimeout(300);
  ok(/Dancing Man\. Obviously\./.test(await say()), "click-through: the question shows the reply");
  await m.click('.qs-modal .qs-gopt:has-text("Ah. Right. Of course.")'); await m.waitForTimeout(300);
  ok(/Oi! Beach boy/.test(await say()), "click-through: back to the offer");
  await m.click('.qs-modal .qs-gopt:has-text("What\'s in it for me?")'); await m.waitForTimeout(300);
  await m.click('.qs-modal .qs-gopt:has-text("Free dance? Done.")'); await m.waitForTimeout(300);
  ok(JSON.stringify(await opts()) === JSON.stringify(["Consider it done.", "Goodbye."]) || (await opts()).includes("Consider it done."), "click-through: accepting shows the author's 'On it.' wording: " + JSON.stringify(await opts()));
  await m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; }); await m.screenshot({ path: OUT + "quest-tree-preview.png" });
  await m.click("#qs-prev-close"); await m.waitForTimeout(200);
  // removing a question removes its line
  await m.click(`${S1} .qs-sc.root .qs-op:has-text("What's in it for me?") .qs-op-x`); await m.waitForTimeout(700);
  ok(await node(m, "q1300-ask2") == null, "removing the question removed its line too (undoable)");
  await m.click("#qs-undo, button:has-text('Undo')").catch(() => {}); await m.waitForTimeout(700);
  ok(await node(m, "q1300-ask2") != null, "undo brings it back");
  // a warning
  await m.locator(`${S1} .qs-sc.root .qs-op`).nth(2).locator("select.qs-act").selectOption("@decline"); await m.waitForTimeout(600);
  ok(await m.$eval(S1, e => /only offered deeper|No answer accepts/.test(e.textContent)), "warns when the accept isn't on the first line");
  await m.evaluate(() => { const d = document.querySelector("#qs-drawer"); d.scrollTop = d.querySelector('.qs-stage[data-stage="offer"]').offsetTop - 70; });
  await m.waitForTimeout(300); await m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; }); await m.screenshot({ path: OUT + "quest-tree-desktop.png" });
  await m.evaluate(() => { const d = document.querySelector("#qs-drawer"); d.scrollTop = d.querySelector('.qs-stage[data-stage="accept"]').offsetTop - 70; });
  await m.waitForTimeout(300); await m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; }); await m.screenshot({ path: OUT + "greeting-flow-sequence-desktop.png" });
  ok(await noOverflow(m), "desktop: no sideways scroll");
  // Commit-to-GitHub validation understands @actions and the new columns
  const probs = await m.evaluate(() => BQCheck.run(BQ.query).all.map(x => `${x.level} ${x.where}: ${x.msg}`).filter(x => /q1300|q9001|@accept|@decline|OfferTree|Replies/.test(x)));
  ok(!probs.some(x => /^error/.test(x)), "validation: @accept / @decline / @offer answers are not 'missing nodes' " + JSON.stringify(probs.slice(0, 3)));
  await m.close();
}

{ // ---- the greeting: top of the NPC sheet, quest-first playtest
  const m = await open(1400, 1000, NEW, "#studio/npc/15");
  await m.waitForSelector("#qs-greeting");
  ok(/GREETING \(SHOWN WHEN THEY HAVE NOTHING FOR YOU\)/.test(await m.$eval("#qs-greeting .qs-wtitle", e => e.textContent)), "NPC sheet: greeting window at the top, labelled");
  const first = await m.$eval(".qs-sheetpage", e => e.firstElementChild.id);
  ok(first === "qs-greeting", "the greeting is the first thing on the sheet");
  ok(await m.$eval("#qs-greeting", e => /Hellooooo again/.test(e.textContent) && /shared/i.test(e.textContent)), "shows their greeting and flags it as shared");
  await edit(m, "#qs-greeting .qs-sc-say .qs-ed", "Nothing for you, mate.");
  ok((await node(m, "ql-dancing-man")).Title === "Nothing for you, mate.", "the greeting edits in place");
  await m.evaluate(() => document.querySelectorAll("*").forEach(e => { if (e.scrollTop) e.scrollTop = 0; })); await m.waitForTimeout(300);
  await m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; }); await m.screenshot({ path: OUT + "greeting-flow-desktop.png" });
  // the in-game preview opens on the offer, not the greeting
  await m.waitForSelector(".qs-win.sticky .qs-game");
  const t0 = await m.$eval(".qs-win.sticky .qs-speech", e => e.textContent); await m.click(".qs-win.sticky .qs-speech"); const t1 = await m.$eval(".qs-win.sticky .qs-speech", e => e.textContent);
  ok(/Well my friend/.test(t1) && !/Nothing for you/.test(t1), "in game: talking to Dancing Man opens on the quest offer, not the greeting");
  // decline goes to the menu with the greeting
  await m.click('.qs-win.sticky .qs-gopt:has-text("Not right now.")'); await m.waitForTimeout(200); await m.click(".qs-win.sticky .qs-speech");
  ok(/Nothing for you, mate\./.test(await m.$eval(".qs-win.sticky .qs-speech", e => e.textContent)), "in game: 'Not right now.' goes to the menu and the greeting");
  ok(await m.$$eval(".qs-win.sticky .qs-gopt", e => e.some(x => /\[Quest\] Rise and Shine/.test(x.textContent))), "...with the quest as a menu row (no loop back into the offer)");
  // the quest's sequence in the NPC's quest lines
  await m.click(".qs-dlg details.qs-qthread >> nth=0 >> summary"); await m.waitForTimeout(600);
  ok(await m.$(".qs-dlg details[open] .qs-flow .qs-stage") !== null, "the NPC sheet lists each quest's sequence too");
  ok(await m.$$eval(".qs-dlg details[open] .qs-flow .qs-greet", e => e.length) === 0, "...without repeating the greeting (it is at the top)");
  // playtest
  await m.evaluate(() => { location.hash = "#studio/play"; }); await m.waitForTimeout(800);
  await m.evaluate(() => { QS.playNpc = 15; qsRerender(); }); await m.waitForTimeout(500);
  await m.click(".qs-play .qs-game .qs-speech").catch(() => {});
  ok(/Well my friend/.test(await m.$eval(".qs-play .qs-game .qs-speech", e => e.textContent)), "playtest: opens on the offer when a quest is available");
  await m.click('.qs-play .qs-gopt:has-text("I\'ll do it.")'); await m.waitForTimeout(300);
  await m.click('.qs-play .qs-gopt:has-text("On it.")'); await m.waitForTimeout(300); await m.click('.qs-play .qs-gopt:has-text("Talk again")').catch(() => {}); await m.waitForTimeout(500);
  await m.click(".qs-play .qs-speech").catch(() => {});
  ok(/Nothing for you/.test(await m.$eval(".qs-play .qs-game .qs-speech", e => e.textContent)) || /Yes\?|\.\.\./.test(await m.$eval(".qs-play .qs-game .qs-speech", e => e.textContent)), "playtest: with the quest taken, talking again opens the greeting/menu");
  await m.close();
}

for (const [w, hgt] of [[390, 844], [360, 740]]) { // ---- phones
  const m = await open(w, hgt, NEW, "#studio/journey/9001");
  await m.waitForSelector(FLOW);
  ok(await noOverflow(m), `${w}px: quest sheet has no sideways scroll`);
  const d = await m.$eval("#qs-drawer", e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; });
  ok(d[0] >= -1 && d[1] <= w + 1, `${w}px: drawer fits the screen`);
  const small = await m.$$eval(`${FLOW} .qs-act, ${FLOW} .qs-op-x, ${FLOW} .qs-sc-add .qs-btn, ${FLOW} .qs-play-from`, els => els.filter(e => e.offsetParent).map(e => [e.className.slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 44));
  ok(!small.length, `${w}px: answers' action pickers and buttons are 44px+ ${JSON.stringify(small.slice(0, 4))}`);
  const wide = await m.$$eval(`${FLOW} .qs-sc, ${FLOW} .qs-op, ${FLOW} .qs-act`, els => els.filter(e => e.getBoundingClientRect().right > innerWidth + 1).length);
  ok(wide === 0, `${w}px: no line or picker sticks out of the screen`);
  await m.click(`${FLOW} .qs-addq >> nth=0`); await m.waitForTimeout(700);
  ok(await m.$(`${FLOW} .qs-op-t .qs-edit`) !== null, `${w}px: + question works by touch`);
  await m.keyboard.press("Escape"); await m.waitForTimeout(300);
  if (w === 390) { await m.evaluate(() => { const d = document.querySelector("#qs-drawer"); d.style.height = "92%"; d.scrollTop = document.querySelector("#qs-drawer .qs-stage[data-stage=offer]").offsetTop - 80; }); await m.waitForTimeout(300); await m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; }); await m.screenshot({ path: OUT + "quest-tree-mobile.png" }); }
  ok(await noOverflow(m), `${w}px: still no sideways scroll after + question`);
  await m.close();
  const n = await open(w, hgt, NEW, "#studio/npc/15");
  await n.waitForSelector("#qs-greeting");
  ok(await noOverflow(n), `${w}px: NPC sheet no sideways scroll`);
  if (w === 390) { await n.evaluate(() => document.querySelectorAll("*").forEach(e => { if (e.scrollTop) e.scrollTop = 0; })); await n.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; }); await n.screenshot({ path: OUT + "greeting-flow-mobile.png" }); }
  await n.close();
}
console.log("ERRORS:\n" + errs.join("\n"));
if (errs.length) process.exitCode = 1;
await b.close();
