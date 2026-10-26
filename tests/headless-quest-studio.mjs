// Headless click-through of Quest Studio on a real bq-content.db (screenshots into OUT).
//   python3 -m http.server 8977 --bind 127.0.0.1 &   (in this folder), then node tests/headless-quest-studio.mjs
import fs from "fs";
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = "http://127.0.0.1:8977/index.html", DB = "/workspace/queststudio/data/bq-content.db", OUT = "/workspace/queststudio/";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await b.newContext({ viewport: { width: 1500, height: 920 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push("pageerror " + e.stack)); p.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errs.push("console " + m.text()); });
p.on("dialog", d => d.accept());
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const wait = ms => p.waitForTimeout(ms);
const hash = async hsh => { await p.evaluate(x => { location.hash = x; }, hsh); await wait(700); };
await p.goto(URL);
await p.setInputFiles("#open", DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(500);
await hash("#studio/journey"); await p.waitForSelector(".qs-card"); await wait(1200);
ok(await p.$$eval(".qs-card", x => x.length) === 61, "journey shows all 61 quests");
ok(await p.$$eval(".qs-ghost", x => x.map(e => e.textContent).join()) === "#1311?", "missing prerequisite 1311 drawn as a ghost");
await p.screenshot({ path: OUT + "01-journey-map.png" });
// pan + zoom
const cam0 = await p.evaluate(() => ({ ...QS.cam }));
await p.mouse.move(700, 600); await p.mouse.down(); await p.mouse.move(500, 500, { steps: 5 }); await p.mouse.up();
const cam1 = await p.evaluate(() => ({ ...QS.cam }));
ok(cam1.x < cam0.x - 100, "drag pans");
await p.keyboard.down("Control"); await p.mouse.wheel(0, -200); await p.keyboard.up("Control"); await wait(100);
ok((await p.evaluate(() => QS.cam.z)) > cam1.z, "ctrl+wheel zooms");
// open 1312
await p.evaluate(() => qsFocus(1312, true)); await wait(500);
ok(await p.$eval("#qs-drawer", d => d.classList.contains("open") && d.textContent.includes("Collective Bargaining")), "quest sheet opens for 1312");
await p.screenshot({ path: OUT + "02-journey-quest-sheet-1312.png" });
const fixT = await p.$eval(".qs-mini.fix", e => e.textContent).catch(() => "");
console.log("fix suggestion:", fixT);
// inline edit the offer
await p.click('#qs-drawer .qs-bub[data-line="Offer"] .qs-ed');
await p.fill('#qs-drawer .qs-bub[data-line="Offer"] textarea', "Eight non-union bandits. Persuade them. Gently, if you can.");
await p.press('#qs-drawer .qs-bub[data-line="Offer"] textarea', "Enter"); await wait(500);
ok((await p.evaluate(() => qById(1312).Offer)) === "Eight non-union bandits. Persuade them. Gently, if you can.", "offer edited inline is in quest_def");
await p.click("#qs-undo"); await wait(500);
ok((await p.evaluate(() => qById(1312).Offer)) !== "Eight non-union bandits. Persuade them. Gently, if you can.", "undo restores the offer");
await p.click("#qs-redo"); await wait(500);
ok((await p.evaluate(() => qById(1312).Offer)) === "Eight non-union bandits. Persuade them. Gently, if you can.", "redo re-applies it");
// sequential toggle
await p.click('#qs-drawer .qs-seg button:has-text("In order")'); await wait(400);
ok((await p.evaluate(() => qById(1312).Sequential)) === 1, "In order ticks Sequential");
await p.click('#qs-drawer .qs-seg button:has-text("All at once")'); await wait(400);
// drag-link: link 1701 to need 1300? use API-level qsLink check for cycle refusal
const loop = await p.evaluate(async () => { await qsLink(1302, 1300); return qPre(qById(1300)); });
ok(loop.length === 0, "a link that would make a loop is refused");
// drag the port of 1300's card onto 1701 card
await p.evaluate(() => { QS.sel = null; QS.cam.z = 0.8; QS.cam.x = 10; QS.cam.y = 4; });
await hash("#studio/journey"); await wait(300);
const src = await p.$('.qs-card[data-id="1300"] .qs-port'), dst = await p.$('.qs-card[data-id="1305"]');
const sb = await src.boundingBox(), db2 = await dst.boundingBox();
await p.mouse.move(sb.x + 10, sb.y + 10); await p.mouse.down(); await p.mouse.move(db2.x + 60, db2.y + 50, { steps: 8 }); await p.mouse.up(); await wait(600);
ok((await p.evaluate(() => qPre(qById(1701)))).includes(1300) || (await p.evaluate(() => qPre(qById(1305)))).includes(1300), "dragging a port onto a card links the prerequisite");
await p.click("#qs-undo"); await wait(500);
ok(!(await p.evaluate(() => qPre(qById(1305)))).includes(1300), "undo removes the link");
// quick create after 1309
await p.evaluate(() => qsNewQuest(1309)); await wait(300);
await p.screenshot({ path: OUT + "06-quick-create.png" });
await p.click('.qs-modal .qs-btn:has-text("pick enemies")'); await wait(200);
await p.click('.qs-modal .qs-pcell[title^="HP"] >> text="Wolf"'); await p.click('.qs-modal .qs-pcell >> text="Gray Wolf"');
await p.click('.qs-modal .qs-btn:has-text("Use these")'); await wait(200);
await p.fill('.qs-modal input[placeholder^="e.g. Pelt"]', "Howl at the Moon");
await p.fill('.qs-modal textarea', "Them wolves won't stop howling. Make them stop. Any wolf will do.");
await p.click('.qs-modal .qs-btn:has-text("Make the quest")'); await wait(900);
console.log("toast:", await p.textContent("#qs-toast"));
const nq = await p.evaluate(() => S.c.quests.find(q => q.Title === "Howl at the Moon"));
ok(nq && JSON.parse(nq.Prereqs)[0] === 1309 && JSON.parse(nq.Steps)[0].Targets.length === 2 && nq.Giver === 13, "quick create: after 1309, giver = its hand-in NPC, multi-enemy kill");
console.log("new quest", nq && { id: nq.id, Level: nq.Level, XP: nq.XP, Gold: nq.Gold, Steps: nq.Steps });
await p.screenshot({ path: OUT + "03-journey-new-quest.png" });
// cast
await hash("#studio/cast"); await wait(600);
ok(await p.$$eval(".qs-ncard", x => x.length) === 81, "cast shows all 81 NPCs");
await p.screenshot({ path: OUT + "04-cast.png" });
// NPC sheet: Brother Dan (5) has a chat tree
await hash("#studio/npc/5"); await wait(900);
await p.screenshot({ path: OUT + "05-npc-sheet-brother-dan.png", fullPage: false });
await p.click('.qs-node[data-node="npc-priest-1"] > .qs-bub .qs-ed');
await p.fill('.qs-node[data-node="npc-priest-1"] > .qs-bub textarea', "Hello, child. Dan sees you. Dan always sees you.");
await p.press('.qs-node[data-node="npc-priest-1"] > .qs-bub textarea', "Enter"); await wait(600);
ok((await p.evaluate(() => S.convBy["npc-priest-1"].Title)) === "Hello, child. Dan sees you. Dan always sees you.", "dialogue line edited in conversation");
// edit an answer label
await p.click('.qs-node[data-node="npc-priest-1"] .qs-ans >> nth=0 >> .qs-opt .qs-ed');
await p.fill('.qs-node[data-node="npc-priest-1"] .qs-ans >> nth=0 >> .qs-opt input', "Heard anything juicy?");
await p.press('.qs-node[data-node="npc-priest-1"] .qs-ans >> nth=0 >> .qs-opt input', "Enter"); await wait(600);
ok((await p.evaluate(() => parseOptions(S.convBy["npc-priest-1"].Options)[0][0])) === "Heard anything juicy?", "answer label edited");
// notes
await p.click(".qs-notes"); await p.fill(".qs-notes textarea", "Kindly, a bit smug. Talks about himself in the third person.");
await p.press(".qs-notes textarea", "Enter"); await wait(600);
ok((await p.evaluate(() => qsNotesGet(5))).startsWith("Kindly"), "personality notes saved");
// preview reflects edit
ok((await p.textContent(".qs-game .qs-gtitle")).includes("BROTHER DAN"), "in-game preview shows the speaker");
await wait(2500);
await p.screenshot({ path: OUT + "05-npc-sheet-brother-dan.png" });
await p.evaluate(() => document.querySelector(".qs-dlg").scrollIntoView());
await p.screenshot({ path: OUT + "07-dialogue-editor.png" });
// Save .db, reload it, check edits survived
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-save")]);
const path2 = OUT + "data/edited.db"; await dl.saveAs(path2);
await p.goto(URL); await p.setInputFiles("#open", path2); await p.waitForSelector("#tabs:not([hidden])"); await wait(600);
const after = await p.evaluate(() => ({ t: S.convBy["npc-priest-1"].Title, o: qById(1312).Offer, n: qsNotesGet(5), q: !!S.c.quests.find(q => q.Title === "Howl at the Moon") }));
ok(after.t.startsWith("Hello, child") && after.o.startsWith("Eight") && after.n.startsWith("Kindly") && after.q, "edits survive Save .db and reopening");
// playtest
await hash("#studio/play"); await wait(500);
await p.click('.qs-gopt:has-text("[Quest] Rise and Shine")').catch(() => {});
await wait(300);
await p.click('.qs-gopt:has-text("I\'ll do it.")').catch(() => {}); await wait(300);
const opts = await p.$$eval(".qs-gopt", x => x.map(e => e.textContent));
ok(opts.some(o => o.includes("On it.")), "playtest: accepting shows On it. " + opts.join("|"));
await p.click('.qs-gopt:has-text("On it.")'); await wait(700);
ok(await p.evaluate(() => QS.play.state[1300] === "active"), "playtest: quest taken");
await p.click('.qs-prow button:has-text("do objectives")'); await wait(400);
await p.screenshot({ path: OUT + "08-playtest.png" });
await p.evaluate(() => { QS.play.level = 8; qsSkipTo(8); qsRerender(); }); await wait(500);
const stuck = await p.evaluate(() => S.c.quests.filter(q => qsAvail(QS.play, q)).map(q => q.Title));
console.log("available at 8 after skip:", stuck);
await p.screenshot({ path: OUT + "09-playtest-level8.png" });
// journey overlay
await p.evaluate(() => { QS.play.overlay = true; }); await hash("#studio/journey"); await wait(600);
await p.screenshot({ path: OUT + "10-journey-playtest-overlay.png" });
// other tabs still work
for (const t of ["map", "quests", "npcs", "items", "mobs"]) { await hash("#" + t); await wait(500); }
ok(true, "old tabs open");
// mobile
const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
m.on("pageerror", e => errs.push("mobile pageerror " + e.stack));
await m.goto(URL); await m.setInputFiles("#open", DB); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(500);
await m.evaluate(() => { location.hash = "#studio/journey"; }); await m.waitForTimeout(1200);
await m.screenshot({ path: OUT + "11-mobile-journey.png" });
await m.evaluate(() => qsFocus(1304, true)); await m.waitForTimeout(500);
await m.screenshot({ path: OUT + "12-mobile-quest-sheet.png" });
await m.evaluate(() => { location.hash = "#studio/npc/6"; }); await m.waitForTimeout(1500);
await m.screenshot({ path: OUT + "13-mobile-npc.png" });
console.log("ERRORS:\n" + errs.join("\n"));
await b.close();
