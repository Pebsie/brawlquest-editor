// Daily quests in Quest Studio: Enable daily quests, the pool editor (sprite
// pickers, groups, ranges, odds, places), placeholder chips, the roll
// preview, marks on the journey / NPC sheet / playtest, and the daily
// playtest cycle (offered, taken, claimed, hidden until the reset).
// Serve this folder on 127.0.0.1:8977 first (or set URL). Desktop, 390, 360.
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
const noOverflow = m => m.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const pool = m => m.evaluate(() => S.c.dailyPools.filter(r => r.QuestID === 9001).map(r => ({ id: r.id, Kind: r.Kind, Slot: r.Slot, Name: r.Name, Min: r.Min, Max: r.Max, Weight: r.Weight, X: r.X, Y: r.Y })));
const hide = m => m.evaluate(() => { const t = document.querySelector("#qs-toast"); if (t) t.style.display = "none"; });
const scrollTo = (m, sel) => m.evaluate(s => { const d = document.querySelector("#qs-drawer"), e = document.querySelector(s); if (d && e) d.scrollTop = e.offsetTop - 60 + (e.offsetParent && e.offsetParent !== d ? e.offsetParent.offsetTop : 0); }, sel);

{ // ---- old db: enable
  const m = await open(1400, 1000, OLD, "#studio/journey/1300");
  await m.waitForSelector("#qs-drawer .qs-flow");
  ok(await m.$("#qs-daily-enable") !== null, "old db: 'Enable daily quests in this db' on the quest sheet");
  await m.click("#qs-daily-enable"); await m.waitForTimeout(1500);
  ok(await m.evaluate(() => S.c.hasDaily && S.c.dailyPools.length === 3), "enable: Daily column, pool table and the example daily");
  ok(await m.$("#qs-daily-on") !== null && await m.$("#qs-daily-enable") === null, "enable: the Once / Daily switch appears");
  await m.click("#qs-daily-on"); await m.waitForSelector("#qs-daily"); await m.waitForTimeout(500);
  ok(await m.evaluate(() => !!+S.c.quests.find(q => q.id === 1300).Daily), "Daily switch saves quest_def.Daily");
  ok(await m.$("#qs-daily-convert") !== null, "a plain quest offers 'let objective 1 change each day'");
  await m.close();
}

{ // ---- desktop: the pool editor on the example daily
  const m = await open(1400, 1300, NEW, "#studio/journey/9001");
  await m.waitForSelector("#qs-daily");
  const rows0 = await pool(m);
  ok(rows0.filter(r => r.Kind === "mob").length === 3, "9001 starts with its 3 mob rows");
  ok((await m.$$("#qs-roll .qs-rollday")).length === 7, "roll preview: seven days");
  ok(/Today/.test(await m.$eval("#qs-roll .qs-rollday.today", e => e.textContent)) && /Tomorrow/.test(await m.$eval("#qs-roll .qs-rollday:nth-child(2)", e => e.textContent)), "roll preview: today and tomorrow");
  ok(!(await m.$$eval("#qs-roll .qs-rd-t", e => e.some(x => /[{}]/.test(x.textContent)))), "roll preview: titles are filled in, no {braces}");
  ok(await m.$eval("#qs-roll", e => /server's own roll/.test(e.textContent)), "roll preview says it is the server's own roll");
  // sprites on the rows
  ok((await m.$$('.qs-slot[data-key="mob"] .qs-cand .pc2')).length >= 3, "rows show the real sprites");
  // + enemies, each
  await m.click('.qs-slot[data-key="mob"] [data-add="mob"]'); await m.waitForSelector(".qs-modal .qs-pcell");
  await m.click('.qs-modal .qs-pcell >> nth=0'); await m.click('.qs-modal .qs-pcell >> nth=1');
  await m.click("#qs-pick-each"); await m.waitForTimeout(900);
  const rows1 = await pool(m);
  ok(rows1.length >= rows0.length + 1 && rows1.length <= rows0.length + 2, `+ enemies: each one gets a row (${rows0.length} -> ${rows1.length})`);
  ok(rows1.every(r => r.id >= 1 && (r.id <= 3 || r.id >= 1700)), "new pool ids start at 1700 like the API editor");
  // group
  await m.click('.qs-slot[data-key="mob"] [data-add="mob"]'); await m.waitForSelector(".qs-modal .qs-pcell");
  await m.click('.qs-modal .qs-pcell >> nth=3'); await m.click('.qs-modal .qs-pcell >> nth=4');
  await m.click("#qs-pick-group"); await m.waitForTimeout(900);
  const rows2 = await pool(m);
  ok(rows2.some(r => /\|/.test(r.Name)), "+ enemies as one group: Name is 'A|B': " + JSON.stringify(rows2.filter(r => /\|/.test(r.Name)).map(r => r.Name)));
  // weights
  const before = await m.$eval('.qs-slot[data-key="mob"] .qs-cand >> nth=0', e => e.querySelector(".qs-pct").textContent);
  await m.click('.qs-slot[data-key="mob"] .qs-cand >> nth=0 >> [data-act="more"]'); await m.waitForTimeout(600);
  const after = await m.$eval('.qs-slot[data-key="mob"] .qs-cand >> nth=0', e => e.querySelector(".qs-pct").textContent);
  const w = (await pool(m)).find(r => r.id === rows0[0].id).Weight;
  ok(w === 2 && before !== after, `odds: + makes the first more likely (weight ${w}, ${before} -> ${after})`);
  // range
  const firstId = rows0[0].id;
  await m.click(`.qs-cand[data-row="${firstId}"] .qs-ed >> nth=1`); await m.fill(`.qs-cand[data-row="${firstId}"] .qs-edit`, "3-5"); await m.keyboard.press("Enter"); await m.waitForTimeout(600);
  const r0 = (await pool(m)).find(r => r.id === firstId);
  ok(r0.Min === 3 && r0.Max === 5, `a count range '3-5' saved (Min ${r0.Min}, Max ${r0.Max})`);
  // place by clicking the map
  await m.click('[data-newlist="place"]'); await m.waitForSelector("#qs-place-ok"); await m.waitForTimeout(600);
  const cv = await m.$(".qs-modal canvas"); const bb = await cv.boundingBox();
  await m.mouse.click(bb.x + bb.width / 2 + 40, bb.y + bb.height / 2 + 20); await m.waitForTimeout(200);
  await m.click("#qs-place-ok"); await m.waitForTimeout(900);
  const pl = (await pool(m)).filter(r => r.Kind === "place");
  ok(pl.length === 1 && (pl[0].X || pl[0].Y), "a place picked by clicking the map: " + JSON.stringify(pl));
  ok(await m.$('.qs-slot[data-key="place"]') !== null, "the {place} list is on the sheet");
  // chips
  await m.click("#qs-drawer .qs-step-t .qs-ed"); await m.waitForSelector(".qs-phchip");
  await m.click('.qs-phchip[data-k="mob"]'); await m.waitForTimeout(100);
  ok(/\{mob\}/.test(await m.$eval("#qs-drawer .qs-step-t .qs-edit", e => e.value)), "tapping the {mob} chip writes it into the text");
  await m.keyboard.press("Escape"); await m.waitForTimeout(300);
  // marks
  await m.screenshot({ path: OUT + "daily-roll-preview.png", clip: undefined }).catch(() => {});
  await hide(m);
  await scrollTo(m, "#qs-daily"); await m.waitForTimeout(300); await m.screenshot({ path: OUT + "daily-pool-desktop.png" });
  await scrollTo(m, "#qs-roll"); await m.waitForTimeout(300); await m.screenshot({ path: OUT + "daily-roll-preview.png" });
  ok(await m.$('.qs-card.daily[data-id="9001"] .qs-dbadge') !== null, "journey: the daily card has the blue ! badge");
  ok(await noOverflow(m), "desktop: no sideways scroll");
  // validation
  const probs = await m.evaluate(() => BQCheck.run(BQ.query).all.filter(x => /9001|daily/i.test(x.where + x.msg)).map(x => `${x.level} ${x.msg}`));
  ok(!probs.some(x => /^error/.test(x)), "validation: no errors for the daily " + JSON.stringify(probs.slice(0, 3)));
  await m.close();
}

{ // ---- NPC sheet + playtest cycle
  const m = await open(1400, 1000, NEW, "#studio/npc/1300");
  await m.waitForSelector("#qs-greeting");
  ok(await m.$(".qs-qrow.daily .qs-dbadge") !== null, "NPC sheet: the daily has the blue ! in their quests");
  await m.evaluate(() => { qsSkipTo(10); QS.playNpc = 1300; });
  await m.evaluate(() => { location.hash = "#studio/play"; }); await m.waitForTimeout(1200);
  ok(await m.$('#qs-play-daily [data-daily="9001"][data-state="offer"]') !== null, "playtest: the daily is on offer");
  const say = () => m.evaluate(() => document.querySelector(".qs-play .qs-game .qs-speech").innerText);
  const opts = () => m.evaluate(() => [...document.querySelectorAll(".qs-play .qs-game .qs-gopt")].map(e => e.innerText));
  ok(/Daily drill/i.test(await say()), "playtest: talking to its giver opens on the daily's offer: " + (await say()).slice(0, 50));
  ok(!/\{/.test(await say()) && !(await opts()).some(o => /[{}]/.test(o)), "playtest: the offer is filled in, no {braces}");
  await m.click('.qs-play .qs-gopt:has-text("coming up")'); await m.waitForTimeout(800);
  ok(await m.$('#qs-play-daily [data-daily="9001"][data-state="active"]') !== null, "playtest: accepted, now taken");
  ok((await opts()).some(o => /In progress/.test(o)), "playtest: the NPC now shows it in progress");
  await m.click('#qs-play-daily [data-daily="9001"] button:has-text("do objectives")'); await m.waitForTimeout(900);
  ok(/Not bad|reward|bell/i.test(await say()), "playtest: opens on the hand-in: " + (await say()).slice(0, 40));
  ok(await m.$('#qs-play-daily [data-daily="9001"][data-state="claimed"]') !== null, "playtest: claimed, hidden until the reset");
  await m.evaluate(() => qsRerender()); await m.waitForTimeout(700);
  ok(!/Daily drill/i.test(await say()) && !(await opts()).some(o => /coming up/.test(o)), "playtest: not offered again today");
  await m.click("#qs-next-reset"); await m.waitForTimeout(800);
  ok(await m.$('#qs-play-daily [data-daily="9001"][data-state="offer"]') !== null, "playtest: after the next reset it is on offer again");
  await m.close();
}

for (const [w, hgt] of [[390, 844], [360, 740]]) { // ---- phones
  const m = await open(w, hgt, NEW, "#studio/journey/9001");
  await m.waitForSelector("#qs-daily");
  ok(await noOverflow(m), `${w}px: daily sheet no sideways scroll`);
  const wide = await m.$$eval("#qs-daily *", els => els.filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== "fixed").length);
  ok(wide === 0, `${w}px: nothing in the pool editor sticks out`);
  const small = await m.$$eval("#qs-daily button, #qs-roll select, #qs-daily .qs-phchip", els => els.filter(e => e.offsetParent).map(e => [e.textContent.slice(0, 14), Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 44));
  ok(!small.length, `${w}px: pool buttons are 44px+ ${JSON.stringify(small.slice(0, 5))}`);
  if (w === 390) { await hide(m); await m.evaluate(() => { const d = document.querySelector("#qs-drawer"); d.style.height = "92%"; }); await scrollTo(m, "#qs-daily"); await m.waitForTimeout(300); await m.screenshot({ path: OUT + "daily-pool-mobile.png" }); }
  await m.close();
}
console.log("ERRORS:\n" + errs.join("\n"));
if (errs.length) process.exitCode = 1;
await b.close();
