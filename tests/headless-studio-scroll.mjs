// Quest Studio used to jump the quest-sheet sidebar (and other panels) back
// to the top on every edit, because qsRerender rebuilt an empty drawer
// before putting the content back. Scroll and focus must stay put.
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-studio-scroll.mjs
const { chromium } = await import(process.env.PW || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8768/index.html";
const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }

const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };
const TOL = 8;

const p = await (await b.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
await p.goto(URL);
await p.setInputFiles("#open", DB);
await p.waitForSelector("#tabs:not([hidden])", { state: "attached" });
await p.waitForTimeout(400);

const pos = sel => p.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  return { top: el.scrollTop, left: el.scrollLeft, max: Math.max(0, el.scrollHeight - el.clientHeight) };
}, sel);

async function scrollDown(sel, frac = 0.75) {
  const r = await p.evaluate(({ sel, frac }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.max(40, Math.floor(max * frac));
    if (typeof BQScroll !== "undefined" && BQScroll.note) BQScroll.note(el);
    return { top: el.scrollTop, left: el.scrollLeft, max };
  }, { sel, frac });
  await p.waitForTimeout(40);
  return r;
}

const near = (a, b) => a != null && b != null && Math.abs(a - b) <= TOL;

// ---- Journey quest sheet (the sidebar drawer)
const qid = await p.evaluate(() => {
  const q = (S.c.quests || []).slice().sort((a, b) => (JSON.parse(b.Steps || "[]").length - JSON.parse(a.Steps || "[]").length) || b.id - a.id)[0];
  return q ? q.id : 0;
});
ok(qid > 0, "found a quest to open (" + qid + ")");
await p.evaluate(id => { location.hash = "#studio/journey/" + id; }, qid);
await p.waitForSelector("#qs-drawer.open");
await p.waitForTimeout(600);
let before = await scrollDown("#qs-drawer");
ok(before && before.max >= 30, "quest sheet sidebar is scrollable (max " + (before && before.max) + ")");
ok(before.top >= 40, "scrolled the sidebar down to " + (before && before.top));

const edited = await p.evaluate(() => {
  const gold = [...document.querySelectorAll("#qs-drawer .qs-rw .qs-chip")].find(c => /gold/i.test(c.textContent));
  const ed = gold && gold.querySelector(".qs-ed");
  if (!ed) return { ok: false, why: "no gold field" };
  ed.click();
  const inp = ed.querySelector("input");
  if (!inp) return { ok: false, why: "gold did not open" };
  const start = inp.value;
  inp.value = String((+start || 0) + 1);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return { ok: true, from: start, to: inp.value };
});
ok(edited.ok, "edited a field in the sheet (" + JSON.stringify(edited) + ")");
await p.waitForTimeout(450);
const after = await pos("#qs-drawer");
ok(near(before.top, after && after.top) && near(before.left, after && after.left),
  "sidebar scroll stayed at " + (after && after.top) + " (was " + before.top + ")");

// A second edit, on a field nearer the top, must also leave scroll alone.
before = await pos("#qs-drawer");
const edited2 = await p.evaluate(() => {
  const min = [...document.querySelectorAll("#qs-drawer .qs-meta .qs-ed")].pop();
  if (!min) return { ok: false };
  min.click();
  const inp = min.querySelector("input");
  if (!inp) return { ok: false };
  const start = inp.value;
  inp.value = String(Math.max(1, (+start || 1) + 1));
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return { ok: true, from: start };
});
ok(edited2.ok, "edited a second field (min level / meta)");
await p.waitForTimeout(450);
const after2 = await pos("#qs-drawer");
ok(near(before.top, after2 && after2.top),
  "sidebar scroll still held after a second edit (" + (after2 && after2.top) + ", was " + before.top + ")");

// ---- NPC character sheet (the main scrolling panel)
const nid = await p.evaluate(() => (S.c.npcs || []).find(n => n.Conversation)?.id || (S.c.npcs || [])[0]?.id || 0);
ok(nid > 0, "found an NPC to open (" + nid + ")");
await p.evaluate(id => { location.hash = "#studio/npc/" + id; }, nid);
await p.waitForSelector(".qs-sheetpage");
await p.waitForTimeout(600);
before = await scrollDown(".qs-sheetpage", 0.7);
ok(before && before.max >= 20, "NPC sheet is scrollable (max " + (before && before.max) + ")");
const editedNpc = await p.evaluate(() => {
  const fac = [...document.querySelectorAll(".qs-sheetpage .qs-ed")].find(el => /faction/i.test((el.previousElementSibling && el.previousElementSibling.textContent) || el.parentElement.textContent));
  const ed = fac || document.querySelector(".qs-sheetpage .qs-ed");
  if (!ed) return { ok: false, why: "no inline field" };
  ed.click();
  const inp = ed.querySelector("input,textarea");
  if (!inp) return { ok: false, why: "did not open" };
  const start = inp.value;
  inp.value = start ? start : "x";
  if (inp.value === start) inp.value = start + " ";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return { ok: true };
});
ok(editedNpc.ok, "edited a field on the NPC sheet (" + JSON.stringify(editedNpc) + ")");
await p.waitForTimeout(450);
const afterNpc = await pos(".qs-sheetpage");
ok(near(before.top, afterNpc && afterNpc.top),
  "NPC sheet scroll stayed at " + (afterNpc && afterNpc.top) + " (was " + before.top + ")");

ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (process.exitCode) console.log("FAILED");
else console.log("all ok");
