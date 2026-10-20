// Headless check of inline editing in the Quests tab "Quest dialogue, in
// order" panel: Offer / Accept / Progress / Complete (quest_def columns) and
// talk-step Line (inside quest_def.Steps), synced with the form, the saved db
// and Export SQL. Uses quest 1300 (Rise and Shine) of a content db copy.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/copy.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-quest-lines.mjs
import fs from "fs";
import { execFileSync } from "child_process";
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const QID = +(process.env.QID || 1300);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const stored = () => p.evaluate(id => S.c.quests.find(x => x.id === id), QID);
const B = k => `#quest-dialogue .bubble[data-line="${k}"]`;

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(500);
await p.evaluate(id => { location.hash = "#quest/" + id; }, QID); await p.waitForSelector("#quest-dialogue"); await wait(300);
const q0 = await stored();
const talkIdx = JSON.parse(q0.Steps).findIndex(s => s.Type === "talk");
ok(talkIdx >= 0, "quest has a talk step (" + talkIdx + ")");
ok(await p.$$eval("#quest-dialogue .bubble", x => x.length) === 4 + JSON.parse(q0.Steps).filter(s => s.Type === "talk").length, "one bubble per line");
ok(await p.$eval(`.qline-in[data-step="${talkIdx}"]`, e => e.type) === "text" && await p.inputValue(`.qline-in[data-step="${talkIdx}"]`) === JSON.parse(q0.Steps)[talkIdx].Line, "talk step Line input is text and shows the stored line");

// an unrelated unsaved form edit must survive inline saves
await p.fill(".form .grid input[type=text] >> nth=0", "Unsaved Title");

// Offer: edit link, auto-grow, Enter saves
const offer = "Press {SHIELD} to block, {INTERACT} to talk. Don't panic, it's fine.";
await p.click(`${B("Offer")} a.edit`);
const h1 = await p.$eval(`${B("Offer")} textarea`, e => e.offsetHeight);
await p.fill(`${B("Offer")} textarea`, offer + "\n" + "x".repeat(400)); await p.dispatchEvent(`${B("Offer")} textarea`, "input");
ok(await p.$eval(`${B("Offer")} textarea`, e => e.offsetHeight) > h1, "textarea grows with the text");
await p.fill(`${B("Offer")} textarea`, offer);
await p.press(`${B("Offer")} textarea`, "Enter"); await wait(300);
ok(!(await p.$(`${B("Offer")} textarea`)) && (await p.textContent(`${B("Offer")} .btext`)) === offer, "Enter saves Offer, back to text");
ok((await stored()).Offer === offer, "Offer stored in quest_def");
ok(await p.inputValue("#qline-Offer") === offer, "form Offer field updated");
ok((await stored()).Title === q0.Title && await p.inputValue(".form .grid input[type=text] >> nth=0") === "Unsaved Title", "other unsaved edits left alone (not saved, still in the form)");
ok(/unsaved changes/.test(await p.textContent("#file")), "db marked as unsaved changes");

// Accept: click the text, Shift+Enter new line, Save button
const accept = "Off you go, it's up the beach.";
await p.click(`${B("Accept")} .btext`);
await p.fill(`${B("Accept")} textarea`, accept);
await p.press(`${B("Accept")} textarea`, "Shift+Enter");
await p.type(`${B("Accept")} textarea`, "Second line.");
ok(!!(await p.$(`${B("Accept")} textarea`)), "Shift+Enter adds a line, does not save");
await p.click(`${B("Accept")} button:has-text('Save')`); await wait(300);
ok((await stored()).Accept === accept + "\nSecond line.", "Accept stored with the new line");

// Progress: Esc cancels, then save
await p.click(`${B("Progress")} a.edit`);
await p.fill(`${B("Progress")} textarea`, "should not be saved");
await p.press(`${B("Progress")} textarea`, "Escape"); await wait(150);
ok((await stored()).Progress === q0.Progress && !(await p.$(`${B("Progress")} textarea`)), "Esc cancels");
await p.click(`${B("Progress")} a.edit`);
await p.fill(`${B("Progress")} textarea`, "Still here? {MOUNTS} won't help.");
await p.click(`${B("Progress")} button:has-text('Save')`); await wait(300);
ok((await stored()).Progress === "Still here? {MOUNTS} won't help.", "Progress stored");
await p.click(`${B("Complete")} a.edit`);
await p.fill(`${B("Complete")} textarea`, "Done! {CHARACTER} is your sheet.");
await p.press(`${B("Complete")} textarea`, "Enter"); await wait(300);
ok((await stored()).Complete === "Done! {CHARACTER} is your sheet.", "Complete stored");

// talk step line -> Steps JSON, Line input in sync
const line = "Ah, the barrel singer. I'll be at the end of this.";
await p.click(`${B("step:" + talkIdx)} a.edit`);
await p.fill(`${B("step:" + talkIdx)} textarea`, line);
await p.press(`${B("step:" + talkIdx)} textarea`, "Enter"); await wait(300);
const ss = JSON.parse((await stored()).Steps);
ok(ss[talkIdx].Line === line && ss.length === JSON.parse(q0.Steps).length && JSON.stringify(ss.map(s => s.Text)) === JSON.stringify(JSON.parse(q0.Steps).map(s => s.Text)), "step Line stored in Steps, other steps unchanged");
ok(await p.inputValue(`.qline-in[data-step="${talkIdx}"]`) === line, "talk step Line input updated");
// reverse: typing in the Line input updates the bubble
await p.fill(`.qline-in[data-step="${talkIdx}"]`, line + " Typed.");
ok((await p.textContent(`${B("step:" + talkIdx)} .btext`)) === line + " Typed.", "Line input -> dialogue panel");
await p.fill(`.qline-in[data-step="${talkIdx}"]`, line);

// Save .db: the downloaded bytes have every line
const dbRow = async name => {
  const bytes = await p.evaluate(() => Array.from(BQ.bytes()));
  const out = (process.env.OUT || "/tmp") + "/" + name;
  fs.writeFileSync(out, Buffer.from(bytes));
  return JSON.parse(execFileSync("sqlite3", ["-json", out, `SELECT Title, Offer, Accept, Progress, Complete, Steps FROM quest_def WHERE id = ${QID}`]).toString())[0];
};
const row = await dbRow("quest-lines-saved.db");
ok(row.Offer === offer && row.Accept === accept + "\nSecond line." && row.Complete === "Done! {CHARACTER} is your sheet." && JSON.parse(row.Steps)[talkIdx].Line === line && row.Title === q0.Title, "saved .db has every line");
// the main Save still saves the whole form, including inline edits
await p.click(".form .bar button.primary:has-text('Save')"); await wait(300);
const q2 = await stored();
ok(q2.Title === "Unsaved Title" && q2.Offer === offer && JSON.parse(q2.Steps)[talkIdx].Line === line, "quest Save keeps the inline edits");
const final = await dbRow("quest-lines-saved2.db");
// Export SQL tab, applied to the original copy with sqlite3, gives the same row
await p.click("#tabs button[data-tab=export]"); await p.waitForSelector("pre.sql"); await wait(200);
const sql = await p.textContent("pre.sql");
ok(sql.includes("Don''t panic, it''s fine.") && sql.includes("{SHIELD}") && sql.includes("I''ll be at the end of this.") && /INSERT OR REPLACE INTO quest_def/.test(sql), "Export SQL has the edits (apostrophes escaped, tokens kept)");
const tmp = (process.env.OUT || "/tmp") + "/quest-lines-applied.db";
fs.copyFileSync(process.env.DB, tmp);
execFileSync("sqlite3", [tmp], { input: sql });
const row2 = JSON.parse(execFileSync("sqlite3", ["-json", tmp, `SELECT Title, Offer, Accept, Progress, Complete, Steps FROM quest_def WHERE id = ${QID}`]).toString())[0];
ok(JSON.stringify(row2) === JSON.stringify(final), "Export SQL applied with sqlite3 gives the same row as the saved .db");
ok(errs.length === 0, "no page errors " + errs.join("; "));
await b.close();
