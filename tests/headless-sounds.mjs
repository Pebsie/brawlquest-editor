// Sound workshop (sound.js): record from the mic (Chrome's fake mic playing
// FAKE, a voice-like wav), trim on the waveform, pitch and length on their
// own and linked (tape speed), volume and fades, presets, save (32 kHz mono
// WAV + the raw recording), upload a file; the slots in the mob form, the
// classic NPC form and the Quest Studio NPC sheet; validate and dump.
// Desktop and a 390x844 phone with touch.
// Serve this folder on 127.0.0.1:8977 first (or set URL); DB is a content db
// from before 2026-10-28-sound-slots.sql (the first sound saved adds the tables).
const { chromium } = await import("/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8977/index.html", DB = process.env.DB || "/workspace/npcwork/test.db", OUT = process.env.OUT || "/workspace/sfxwork/";
const FAKE = process.env.FAKE || "/workspace/sfxwork/fake-voice.wav", OGG = process.env.OGG || "/workspace/wt/npcspawn-client/assets/sfx/monsters/Wolf/aggro/1.ogg";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${FAKE}`, "--autoplay-policy=no-user-gesture-required"] });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
let promptAnswer = "";
const open = async (w, hgt, hash, mob = w < 700) => {
  const ctx = await b.newContext({ viewport: { width: w, height: hgt }, hasTouch: mob, isMobile: mob, deviceScaleFactor: mob ? 2 : 1, permissions: ["microphone"] });
  const m = await ctx.newPage();
  m.on("pageerror", e => errs.push(`${w} pageerror ` + e.stack)); m.on("console", x => { if (x.type() === "error" && !/404/.test(x.text())) errs.push(`${w} console ` + x.text()); });
  m.on("dialog", d => d.type() === "prompt" ? d.accept(promptAnswer) : d.accept());
  await m.goto(URL); await m.setInputFiles("#open", DB); await m.waitForSelector("#tabs:not([hidden])", { state: "attached" }); await m.waitForTimeout(500);
  await m.evaluate(h => { location.hash = h; }, hash); await m.waitForTimeout(1200);
  return m;
};
const content = m => m.evaluate(() => { const c = BQ.api.content(); return { has: c.hasSounds, sfx: c.sfx, slots: c.soundSlots, presets: c.sfxPresets }; });
const record = async (m, ms, scope = "body") => {
  await m.locator(scope + " .sfx-rec").first().click();
  await m.waitForTimeout(ms);
  ok(await m.evaluate(s => !!document.querySelector(s + " .sfx-rec").closest(".recording"), scope), "recording: the button turns to Stop with a timer: " + await m.locator(scope + " .sfx-rec").first().textContent());
  await m.locator(scope + " .sfx-rec").first().click(); await m.waitForTimeout(900);
};
const setRange = (m, label, v, scope = "body") => m.evaluate(([label, v, scope]) => {
  const row = [...document.querySelectorAll(scope + " .sfx-row")].find(r => r.querySelector("label").textContent === label);
  const r = row.querySelector("input"); r.value = v; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change"));
  return row.querySelector(".sfx-val").textContent;
}, [label, v, scope]);
const info = (m, scope = "body") => m.locator(scope + " .panel:last-child .bar .hint").first().textContent();
const wav = (m, id) => m.evaluate(id => { const d = BQ.api.sfxGet(id); const f = u => u ? { len: u.length, riff: String.fromCharCode(...u.slice(0, 4)), rate: new DataView(u.buffer, u.byteOffset).getUint32(24, true), ch: new DataView(u.buffer, u.byteOffset).getUint16(22, true) } : null; return { data: f(d.Data), raw: f(d.Raw) }; }, id);

{ // ---- desktop
  const m = await open(1400, 1000, "#sounds");
  ok(await m.locator("#tabs button[data-tab=sounds]").count() === 1, "a Sounds tab");
  ok(!(await content(m)).has, "an old db has no sound tables yet");
  ok(await m.locator(".sfx-rec").count() === 1 && await m.locator("canvas.sfx-wave").count() === 2, "the workshop: Record, the trim waveform and the result waveform");
  await record(m, 2600);
  const t = await m.locator(".panel .bar .hint").first().textContent();
  ok(/^Keeping 0\.\d+-[12]\.\d+ s of 2\.\d+ s/.test(t), "recorded from the mic and trimmed the silence: " + t);
  await m.waitForTimeout(400);
  const i0 = await info(m); ok(/Result 1\.\d+ s at 32 kHz/.test(i0), "result: " + i0);
  await m.locator(".sfx-src").screenshot({ path: OUT + "sfx-recorder-src.png" });
  // drag the left trim handle right with the mouse
  const tr0 = await m.evaluate(() => document.querySelector(".panel .bar .hint").textContent);
  const box = await m.locator("canvas.sfx-wave").first().boundingBox();
  const raw = +tr0.match(/of ([\d.]+) s/)[1], a0 = +tr0.match(/Keeping ([\d.]+)/)[1];
  const x0 = box.x + a0 / raw * box.width + 2;
  await m.mouse.move(x0, box.y + 10); await m.mouse.down(); await m.mouse.move(x0 + 40, box.y + 30, { steps: 5 }); await m.mouse.up(); await m.waitForTimeout(400);
  const a1 = +(await m.locator(".panel .bar .hint").first().textContent()).match(/Keeping ([\d.]+)/)[1];
  ok(a1 > a0 + 0.05, `dragging the left handle trims the start: ${a0} -> ${a1} s`);
  await m.locator(".sfx-form").screenshot({ path: OUT + "sfx-recorder.png" });
  // pitch and length on their own
  const p = await setRange(m, "Pitch", 7); ok(p === "+7 semitones", "pitch +7: " + p);
  const l = await setRange(m, "Length", Math.log2(1.5)); ok(/^1\.50x \(\d\.\d\d s\)/.test(l), "length 1.5x: " + l);
  await m.waitForTimeout(500);
  const i1 = await info(m), exp = +l.match(/\(([\d.]+) s/)[1];
  ok(Math.abs(+i1.match(/Result ([\d.]+) s/)[1] - exp) < 0.02, `the result is 1.5x as long with the pitch up: ${i1}`);
  // tape speed
  await m.click('button:has-text("Tape speed (linked)")'); await m.waitForTimeout(200);
  ok(await m.locator(".sfx-row:has-text('Pitch')").isHidden() && await m.locator(".sfx-row:has-text('Speed')").isVisible(), "tape mode swaps pitch and length for one speed");
  const sp = await setRange(m, "Speed", Math.log2(2)); ok(/^2\.00x = \+12\.0 semitones, 0\.50x length/.test(sp), "tape speed 2x: " + sp);
  await m.waitForTimeout(400);
  await setRange(m, "Volume", -3); await setRange(m, "Fade out", 200); await m.waitForTimeout(400);
  await m.locator(".sfx-form .panel").nth(2).screenshot({ path: OUT + "sfx-pitch-stretch.png" });
  // presets: a starter, then my own
  await m.selectOption(".sfx-presets", { label: "Spider (high, long)" }); await m.waitForTimeout(400);
  ok(await m.locator(".sfx-seg button.on").textContent() === "Pitch and length" && (await m.locator(".sfx-row:has-text('Pitch') .sfx-val").textContent()) === "+14 semitones", "the Spider starter: +14 semitones, pitch and length mode");
  promptAnswer = "My spider";
  await m.click('button:has-text("Save as preset")'); await m.waitForTimeout(500);
  let c = await content(m);
  ok(c.has && c.presets.length === 1 && JSON.parse(c.presets[0].Recipe).semitones === 14 && !("trim" in JSON.parse(c.presets[0].Recipe)), "saved a preset (shape only, not the trim); the db got its sound tables");
  await m.fill(".sfx-name input", "Wolf growl");
  await m.click('button:has-text("Save new sound")'); await m.waitForTimeout(800);
  c = await content(m);
  ok(c.sfx.length === 1 && c.sfx[0].Name === "Wolf growl" && /^[0-9a-f]{40}$/.test(c.sfx[0].Hash) && c.sfx[0].HasRaw === 1, "saved sound 1 with its hash and the raw recording");
  const w1 = await wav(m, 1);
  ok(w1.data.riff === "RIFF" && w1.data.rate === 32000 && w1.data.ch === 1 && w1.raw.rate === 32000, `stored as 32 kHz mono WAV (${w1.data.len} bytes; raw ${w1.raw.len})`);
  ok(await m.evaluate(async () => { const r = BQ.api.content().sfx[0]; const d = BQ.api.sfxGet(1).Data; return (await sfxSha1(d)) === r.Hash; }), "the hash is the SHA-1 of the WAV (what /sfx/<hash> serves)");
  const rec = JSON.parse(c.sfx[0].Recipe); ok(rec.semitones === 14 && rec.trim[0] > 0.05, "the settings are kept with it (recipe)");
  ok(/sounds\/1$/.test(await m.evaluate(() => location.hash)), "the library selects it: " + await m.evaluate(() => location.hash));
  // reopen: the raw comes back with the recipe
  await m.evaluate(() => { location.hash = "#mob/1"; }); await m.waitForTimeout(600);
  await m.evaluate(() => { location.hash = "#sounds/1"; }); await m.waitForTimeout(1200);
  ok(/Keeping/.test(await m.locator(".panel .bar .hint").first().textContent()) && (await m.locator(".sfx-row:has-text('Pitch') .sfx-val").textContent()) === "+14 semitones", "reopened: the raw recording and its settings come back to redo");
  // upload a file (one of the game's OGGs)
  await m.locator(".list .row").first().click(); await m.waitForTimeout(300);
  await m.click(".list + .form, .form"); // focus
  await m.evaluate(() => { S.sfxSel = { id: 0 }; renderTab(); }); await m.waitForTimeout(300);
  await m.setInputFiles(".sfx-src input[type=file]", OGG); await m.waitForTimeout(1200);
  ok(await m.locator(".sfx-name input").inputValue() === "1" && /Keeping/.test(await m.locator(".panel .bar .hint").first().textContent()), "an uploaded OGG opens in the workshop");
  await m.fill(".sfx-name input", "Old wolf"); await m.click('button:has-text("Save new sound")'); await m.waitForTimeout(800);
  ok((await content(m)).sfx.length === 2, "saved the upload as sound 2");

  // ---- mob form slots
  await m.evaluate(() => { location.hash = "#mob/1"; }); await m.waitForTimeout(800);
  ok(await m.locator("#sfx-slots .sfx-slot").count() === 5, "the mob form has aggro, attack, hurt, death and idle");
  ok(/empty: its folder sound/.test(await m.locator("#sfx-slots .sfx-slot").first().textContent()), "an empty slot says what plays instead");
  await m.locator("#sfx-slots .sfx-slot").first().locator(".sfx-add").click(); await m.waitForTimeout(300);
  ok(await m.locator(".sfx-librow").count() === 2, "the chooser lists the library");
  await m.locator(".sfx-librow:has-text('Wolf growl') button:has-text('Use')").click(); await m.waitForTimeout(500);
  c = await content(m);
  ok(c.slots.length === 1 && c.slots[0].Kind === "enemy" && c.slots[0].RefID === 1 && c.slots[0].Slot === "aggro" && c.slots[0].Sfx === 1, "Use puts it in the mob's aggro slot");
  // a second variant recorded straight from the slot
  await m.locator("#sfx-slots .sfx-slot").first().locator(".sfx-add").click(); await m.waitForTimeout(300);
  await m.click("button.sfx-new"); await m.waitForTimeout(300);
  ok(await m.locator(".sfx-modal .sfx-rec").count() === 1, "Record a new one opens the workshop over the form");
  await record(m, 1800, ".sfx-modal");
  await m.waitForTimeout(400);
  await m.locator(".sfx-modal").screenshot({ path: OUT + "sfx-slot-record-modal.png" });
  await m.click(".sfx-modal button:has-text('Save and use for aggro')"); await m.waitForTimeout(900);
  c = await content(m);
  ok(c.sfx.length === 3 && c.slots.filter(s => s.Slot === "aggro" && s.RefID === 1).length === 2 && await m.locator(".sfx-modal").count() === 0, "saved and added as a second aggro variant");
  ok(await m.locator("#sfx-slots .sfx-slot").first().locator(".sfx-chip").count() === 2, "two chips in the aggro slot");
  await m.locator("#sfx-slots .sfx-slot").nth(3).locator(".sfx-add").click(); await m.waitForTimeout(300);
  await m.locator(".sfx-librow:has-text('Old wolf') button:has-text('Use')").click(); await m.waitForTimeout(500);
  await m.locator("#sfx-slots").scrollIntoViewIfNeeded();
  await m.locator("#sfx-slots").screenshot({ path: OUT + "sfx-mob-slots.png" });
  // edit from the chip
  await m.locator("#sfx-slots .sfx-chip").first().locator("button:has-text('edit')").click(); await m.waitForTimeout(1200);
  ok(/Keeping/.test(await m.locator(".sfx-modal .panel .bar .hint").first().textContent()), "edit opens the sound with its raw recording");
  await m.keyboard.press("Escape"); await m.waitForTimeout(200);
  // remove a variant
  await m.locator("#sfx-slots .sfx-chip").nth(1).locator(".sfx-x").click(); await m.waitForTimeout(500);
  ok((await content(m)).slots.filter(s => s.Slot === "aggro").length === 1, "× takes a variant out");

  // ---- NPC: classic form and the Quest Studio sheet
  await m.evaluate(() => { location.hash = "#npc/4"; }); await m.waitForTimeout(800);
  ok(await m.locator("#sfx-slots .sfx-slot").count() === 2 && /person\.ogg/.test(await m.locator("#sfx-slots").textContent()), "the NPC form has greet and talk; empty greet says person.ogg");
  await m.locator("#sfx-slots .sfx-slot").first().locator(".sfx-add").click(); await m.waitForTimeout(300);
  await m.locator(".sfx-librow:has-text('Wolf growl') button:has-text('Use')").click(); await m.waitForTimeout(500);
  await m.locator("#sfx-slots").screenshot({ path: OUT + "sfx-npc-form-slots.png" });
  await m.evaluate(() => { location.hash = "#studio/npc/4"; }); await m.waitForTimeout(1500);
  ok(await m.locator(".qs-sfx .sfx-chip").count() === 1, "the Quest Studio sheet shows the same greet sound");
  await m.locator(".qs-sfx .sfx-slot").nth(1).locator(".sfx-add").click(); await m.waitForTimeout(300);
  await m.locator(".sfx-librow:has-text('Old wolf') button:has-text('Use')").click(); await m.waitForTimeout(800);
  c = await content(m);
  ok(c.slots.some(s => s.Kind === "npc" && s.RefID === 4 && s.Slot === "talk" && s.Sfx === 2), "talk set from the sheet");
  await m.locator(".qs-sfx").scrollIntoViewIfNeeded();
  await m.locator(".qs-win:has(.qs-sfx)").screenshot({ path: OUT + "sfx-npc-slots.png" });

  // ---- checks and the dump
  const v = await m.evaluate(() => BQCheck.run(BQ.query).all.filter(p => p.table === "sound_slot" || p.table === "sfx"));
  ok(v.length === 0, "no problems in the sound tables: " + JSON.stringify(v));
  await m.evaluate(() => BQ.query("INSERT INTO sound_slot (Kind, RefID, Slot, Sfx) VALUES ('npc', 4, 'dance', 99)"));
  const v2 = await m.evaluate(() => BQCheck.run(BQ.query).all.filter(p => p.table === "sound_slot").map(p => p.msg));
  ok(v2.some(x => /dance/.test(x)) && v2.some(x => /sound 99/.test(x)), "a bad slot is flagged: " + v2.join(" / "));
  await m.evaluate(() => BQ.query("DELETE FROM sound_slot WHERE Slot = 'dance'"));
  const d = await m.evaluate(() => { const f = BQDump.dump(BQ.query); return { k: f.map(x => x.path).filter(x => /sfx|sound/.test(x)), sfx: (f.find(x => x.path === "content/sfx.sql") || { text: "" }).text.slice(0, 900) }; });
  ok(d.k.length === 3 && /X'52494646/.test(d.sfx), "the dump writes sfx.sql (the WAV as X'52494646...'), sound_slot.sql and sfx_preset.sql: " + d.k.join(", "));
  // delete a sound: its slots go
  await m.evaluate(() => { location.hash = "#sounds/2"; }); await m.waitForTimeout(1000);
  await m.click(".form .bar button.danger:has-text('Delete')"); await m.waitForTimeout(600);
  c = await content(m);
  ok(c.sfx.length === 2 && !c.slots.some(s => s.Sfx === 2), "deleting a sound clears its slots");
  await m.close();
}

{ // ---- phone
  const m = await open(390, 844, "#sounds");
  const sz = await m.evaluate(() => ({ w: document.documentElement.scrollWidth, rec: document.querySelector(".sfx-rec").getBoundingClientRect().height }));
  ok(sz.w <= 390, "no sideways scroll on a phone: " + sz.w);
  ok(sz.rec >= 50, "a big Record button: " + sz.rec + "px");
  await m.locator(".sfx-rec").tap(); await m.waitForTimeout(2200); await m.locator(".sfx-rec").tap(); await m.waitForTimeout(1000);
  ok(/Keeping/.test(await m.locator(".panel .bar .hint").first().textContent()), "recorded with taps");
  // drag the right handle with a finger
  const t0 = await m.locator(".panel .bar .hint").first().textContent(), raw = +t0.match(/of ([\d.]+) s/)[1], e0 = +t0.match(/-([\d.]+) s of/)[1];
  const box = await m.locator("canvas.sfx-wave").first().boundingBox(), x = box.x + e0 / raw * box.width - 2;
  const s = await m.context().newCDPSession(m);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: box.y + 60 }] });
  for (let i = 1; i <= 6; i++) await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - i * 8, y: box.y + 60 }] });
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await m.waitForTimeout(400);
  const e1 = +(await m.locator(".panel .bar .hint").first().textContent()).match(/-([\d.]+) s of/)[1];
  ok(e1 < e0 - 0.05, `a finger drag trims the end: ${e0} -> ${e1}`);
  await setRange(m, "Pitch", -5); await m.waitForTimeout(400);
  await m.screenshot({ path: OUT + "sfx-phone.png", fullPage: false });
  await m.locator(".sfx-form .panel").nth(2).scrollIntoViewIfNeeded();
  await m.screenshot({ path: OUT + "sfx-phone-shape.png" });
  await m.fill(".sfx-name input", "Phone grunt"); await m.locator('button:has-text("Save new sound")').tap(); await m.waitForTimeout(800);
  ok((await content(m)).sfx.length === 1, "saved on the phone");
  await m.evaluate(() => { location.hash = "#mob/1"; }); await m.waitForTimeout(900);
  await m.locator("#sfx-slots").scrollIntoViewIfNeeded();
  await m.locator("#sfx-slots .sfx-slot").nth(1).locator(".sfx-add").tap(); await m.waitForTimeout(300);
  await m.screenshot({ path: OUT + "sfx-phone-chooser.png" });
  await m.locator(".sfx-librow button:has-text('Use')").first().tap(); await m.waitForTimeout(600);
  ok((await content(m)).slots.some(s => s.Slot === "attack"), "attack slot set with a tap");
  await m.locator("#sfx-slots").scrollIntoViewIfNeeded();
  await m.screenshot({ path: OUT + "sfx-phone-mob-slots.png" });
  await m.locator("#sfx-slots .sfx-slot").first().locator(".sfx-add").tap(); await m.waitForTimeout(300);
  await m.locator("button.sfx-new").tap(); await m.waitForTimeout(400);
  const mw = await m.evaluate(() => document.querySelector(".sfx-ov .modal-box").getBoundingClientRect().width);
  ok(mw >= 380, "the workshop opens full screen over the form: " + mw);
  await m.screenshot({ path: OUT + "sfx-phone-modal.png" });
  await m.close();
}
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("\n") : ""));
await b.close();
