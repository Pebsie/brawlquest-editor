// Headless check of the restored original NPCs and quests (content migration 2026-11-10-originals): they load,
// their roles (junk buyer / vendor, skill trainer) read and save, the quest sheet and the conversation tree open and edit,
// and the editor's checks report no errors.
//   python3 -m http.server 8977 --bind 127.0.0.1 &   (in the editor folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-originals.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errs.push(m.text()); });
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const hash = async h => { await p.evaluate(x => { location.hash = x; }, h); await wait(900); };
const roles = id => p.evaluate(id => BQ.api.npcRoles({ id }), id);

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(900);
const n = await p.evaluate(() => ({ npcs: S.c.npcs.length, quests: S.c.quests.length, spawns: S.c.npcSpawns.length, conv: S.c.conversations.length }));
ok(n.npcs >= 60 && n.quests >= 20 && n.spawns >= 60, "NPCs, quests and placements load: " + JSON.stringify(n));
ok(await p.evaluate(() => [6, 19, 20, 30].every(id => S.c.npcRoles[id] && S.c.npcRoles[id].vendor) && [18, 44].every(id => S.c.npcRoles[id] && S.c.npcRoles[id].trainer)), "vendors 6, 19, 20, 30 and trainers 18, 44 show as roles");
const checks = await p.evaluate(() => BQCheck.run(BQ.query).all.filter(x => x.level === "error").map(x => `${x.where}: ${x.msg}`));
ok(checks.length === 0, "no editor check errors" + (checks.length ? ": " + checks.slice(0, 5).join(" | ") : ""));

// roles save on a restored NPC and come back
const vid = 6;
let r = await roles(vid); ok(r.vendor && r.vendor.Buys, "vendor " + vid + " reads: " + JSON.stringify(r.vendor));
r = await p.evaluate(id => BQ.api.npcRolesSave({ id, roles: { vendor: { BuyPct: 80, Greeting: "Show me what you have.", Buys: "junk,misc" } } }), vid);
ok(r.vendor && r.vendor.BuyPct === 80, "npcRolesSave changes the vendor on restored NPC " + vid);
r = await p.evaluate(() => BQ.api.npcRolesSave({ id: 15, roles: { trainer: true, plot: true } }));
ok(r.trainer && r.plot && (await roles(15)).plot, "a restored NPC can be made a skill trainer and plot seller");
r = await p.evaluate(() => BQ.api.npcRolesSave({ id: 15, roles: { trainer: false, plot: false } }));
ok(!r.trainer && !r.plot, "...and the roles can be removed again");

// NPC form: a restored NPC opens and saves
const first = await p.evaluate(() => S.c.npcs.find(x => x.id === 15).Name);
await hash("#npcs"); await hash("#npc/15");
ok(await p.$(".roles [data-role=vendor] input") !== null, "NPC form for " + first + " shows the role ticks");
await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(400);
ok(await p.evaluate(() => S.c.npcs.some(x => x.id === 15)), "NPC saved from the form");

// quest sheet + conversation tree
const qid = await p.evaluate(() => { const q = S.c.quests.find(q => !q.Prereqs || q.Prereqs === "[]" || q.Prereqs === ""); return q.id; });
await hash("#studio/journey"); await p.waitForSelector(".qs-card"); await wait(600);
ok(await p.$$eval(".qs-card", x => x.length) >= 20, "journey shows the restored quests");
await p.evaluate(id => qsFocus(id, true), qid); await wait(500);
ok(await p.$eval("#qs-drawer", d => d.classList.contains("open")), "quest sheet opens for " + qid);
const sel = '#qs-drawer .qs-stage[data-stage="offer"] [data-line="Offer"]';
if (await p.$(sel + " .qs-ed")) {
  await p.click(sel + " .qs-ed"); await p.fill(sel + " textarea", "Edited offer text."); await p.press(sel + " textarea", "Enter"); await wait(500);
  ok(await p.evaluate(id => { const q = qById(id); return (q.OfferTree ? S.convBy[q.OfferTree].Title : q.Offer) === "Edited offer text."; }, qid), "the offer edits inline (in the quest's offer node)");
  await p.click("#qs-undo"); await wait(500);
  ok(await p.evaluate(id => { const q = qById(id); return (q.OfferTree ? S.convBy[q.OfferTree].Title : q.Offer) !== "Edited offer text."; }, qid), "undo restores it");
} else ok(false, "offer line is editable on quest " + qid);
const giver = await p.evaluate(id => qById(id).Giver, qid);
await hash("#studio/npc/" + giver); await p.waitForSelector("#qs-greeting .qs-convo"); await wait(500);
ok(await p.$("#qs-greeting .qs-convo details.qs-qbranch, #qs-greeting .qs-convo .qs-own") !== null, "the giver's conversation tree shows the quest");
ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
await b.close();
