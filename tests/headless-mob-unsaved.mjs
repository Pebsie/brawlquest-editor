// Headless: the user's flow. Open from GitHub (mock), Bandit: tick Sleeps at night, add sounds, commit.
//   python3 -m http.server 8766 &  then  DB=bq-content.db (with sounds: sfx id 1) URL=http://localhost:8766/index.html PW=.../playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-mob-unsaved.mjs
import fs from "fs";
import { mockGitHub } from "./github-mock.mjs";
const { chromium } = await import(process.env.PW);
const TOKEN = "github_pat_11TESTONLY_abcdefghijklmnopqrstuvwxyz0123456789";
const gh = mockGitHub({ token: TOKEN, files: { "README.md": "#\n", "bq-content.db": fs.readFileSync(process.env.DB) } });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const p = await ctx.newPage();
p.on("pageerror", e => console.log("PAGEERR", String(e))); p.on("dialog", d => d.accept());
await ctx.route("https://api.github.com/**", gh.handler);
const SAVE = process.env.SAVE === "1";
await p.goto(process.env.URL);
await p.click("#btn-github"); await p.fill(".sync-modal input[type=password]", TOKEN);
await p.click(".sync-modal button:has-text('Connect')"); await p.waitForSelector(".sync-modal button:has-text('Open latest from GitHub')");
await p.click(".sync-modal button:has-text('Open latest from GitHub')");
await p.waitForSelector("#tabs:not([hidden])"); await p.waitForFunction(() => BQSync.state.lastId > 0 && BQSync.state.baseFp);
await p.evaluate(() => { location.hash = "#mob/9"; }); await p.waitForTimeout(800);
console.log("form:", await p.textContent(".form h2"));
const tick = () => p.evaluate(() => { const l = [...document.querySelectorAll(".form .grid > label")].find(x => x.textContent === "Sleeps at night"); const i = l.nextElementSibling.querySelector("input"); i.click(); return i.checked; });
console.log("ticked:", await tick());
if (SAVE) { await p.click(".form .bar button.primary"); await p.waitForTimeout(500); }
// a sound into idle, like the user did (an existing sfx row via the slot API)
await p.evaluate(async () => { await api("slotSet", { Kind: "enemy", RefID: 9, Slot: "attack", sfx: [1] }); await loadAll(); });
console.log("checkbox still:", await p.evaluate(() => { const l = [...document.querySelectorAll(".form .grid > label")].find(x => x.textContent === "Sleeps at night"); return l && l.nextElementSibling.querySelector("input").checked; }));
console.log("db SleepsAtNight:", JSON.stringify(await p.evaluate(() => BQ.query("SELECT SleepsAtNight FROM enemies WHERE id = 9"))));
await p.evaluate(() => document.querySelectorAll(".sync-modal").forEach(m => m.remove()));
await p.click("#btn-github"); await p.waitForSelector(".sync-modal button:has-text('Commit to GitHub')");
console.log("auto message:", await p.getAttribute(".sync-modal input[type=text]", "placeholder"));
console.log("flag:", await p.textContent(".mob-unsaved"));
const warn = await p.$(".sync-modal .gh-unsaved");
console.log("warning:", warn ? await warn.textContent() : "none");
if (warn) {
  await p.click(".sync-modal .gh-unsaved button"); await p.waitForTimeout(800);
  console.log("after Save mob first: db", JSON.stringify(await p.evaluate(() => BQ.query("SELECT SleepsAtNight FROM enemies WHERE id = 9"))), "warning gone:", !(await p.$(".sync-modal .gh-unsaved")), "message:", await p.getAttribute(".sync-modal input[type=text]", "placeholder"));
  await p.click(".sync-modal button:has-text('Commit to GitHub')"); await p.waitForTimeout(3000);
  const c = gh.refs.get("main"); const sql = gh.blob(gh.fileAt(c, "content/enemies.sql")).toString();
  console.log("commit:", gh.commits.get(c).message, "| enemies.sql Bandit row:", sql.split("\n").find(l => /\(9, ?'Bandit'/.test(l)));
}
await b.close();
