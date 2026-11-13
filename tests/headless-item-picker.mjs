// The shared item picker: search by name/id/type, item images, incremental
// scroll, and it replaces the old bare <select> on loot, quest rewards and
// collect steps. Stored values stay an item id or item name as before.
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-item-picker.mjs
const { chromium } = await import(process.env.PW || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8768/index.html";
const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };

const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
await p.goto(URL);
await p.setInputFiles("#open", DB);
await p.waitForSelector("#tabs:not([hidden])");
await p.waitForTimeout(400);

const openLoot = async () => {
  await p.click("#tabs button[data-tab=loot]");
  await p.waitForSelector(".form .itemsel-btn");
  await p.waitForTimeout(200);
};

await openLoot();
ok(await p.$(".form select") === null || !(await p.$eval(".form .rw", el => !!el.querySelector("select") && !el.querySelector(".itemsel"))),
  "loot rows use the item picker, not a bare item <select>");
ok(await p.$(".form .itemsel-btn img, .form .itemsel-btn .sprite"), "loot row shows the item image");
const before = await p.$eval(".form .itemsel", el => ({ value: el.value, label: el.textContent }));
await p.click(".form .itemsel-btn");
await p.waitForSelector(".modal .ip-list");
await p.waitForTimeout(200);
const first = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".modal .ip-row")];
  const count = document.querySelector(".modal .picker-count")?.textContent || "";
  const m = count.match(/Showing (\d+) of (\d+)/);
  const imgs = [...document.querySelectorAll(".modal .ip-row img, .modal .ip-row .sprite")];
  return { n: rows.length, total: m ? +m[2] : 0, shown: m ? +m[1] : 0, count, hasImgs: imgs.length === rows.length && rows.length > 0, q: document.querySelector(".modal .picker-q")?.placeholder };
});
ok(first.total >= 20 && first.n === first.shown, "picker opens with a count (" + first.count + ")");
ok(/name, id or type/i.test(first.q || ""), "search placeholder mentions name, id and type");
ok(first.hasImgs, "every visible row has an item image");

await p.fill(".modal .picker-q", "sword");
await p.waitForTimeout(200);
const swords = await p.evaluate(() => [...document.querySelectorAll(".modal .ip-row")].map(r => ({ val: r.dataset.val, text: r.textContent })));
ok(swords.length >= 1 && swords.every(r => /sword/i.test(r.text) || /sword/i.test(r.val)), "search 'sword' filters by name (" + swords.length + ")");
const pick = swords[0];
await p.click(`.modal .ip-row[data-val="${pick.val}"]`);
await p.waitForTimeout(300);
ok(await p.$(".modal .ip-list") === null, "picker closes after a pick");
const after = await p.$eval(".form .itemsel", el => ({ value: el.value, label: el.textContent }));
ok(String(after.value) === String(pick.val), "loot ItemID is still a numeric id (" + after.value + ")");
ok(after.label.includes(pick.text.trim().split("·")[0].trim().split("?")[0].slice(0, 4)) || after.label.toLowerCase().includes("sword"),
  "loot button shows the picked item (" + after.label.replace(/\s+/g, " ").trim() + ")");

// Incremental load: open again, clear search, if total > 80, first page < total, scroll loads more.
await p.click(".form .itemsel-btn");
await p.waitForSelector(".modal .ip-list");
await p.fill(".modal .picker-q", "");
await p.waitForTimeout(200);
const page1 = await p.evaluate(() => {
  const c = document.querySelector(".modal .picker-count")?.textContent || "";
  const m = c.match(/Showing (\d+) of (\d+)/);
  return { n: m ? +m[1] : 0, total: m ? +m[2] : 0 };
});
if (page1.total > page1.n) {
  await p.evaluate(() => { const g = document.querySelector(".modal .ip-list"); g.scrollTop = g.scrollHeight; });
  await p.waitForTimeout(300);
  const page2 = await p.evaluate(() => {
    const c = document.querySelector(".modal .picker-count")?.textContent || "";
    const m = c.match(/Showing (\d+) of (\d+)/);
    return { n: m ? +m[1] : 0, total: m ? +m[2] : 0 };
  });
  ok(page2.n > page1.n, "scrolling loads the next batch (" + page1.n + " → " + page2.n + " of " + page2.total + ")");
} else ok(true, "item list fits on one page (" + page1.n + ")");
await p.keyboard.press("Escape");
await p.waitForTimeout(150);

// Quest rewards
await p.click("#tabs button[data-tab=quests]");
await p.waitForSelector(".form");
await p.waitForTimeout(200);
const hasReward = await p.$(".form .rewards .itemsel-btn");
if (!hasReward) {
  const added = await p.evaluate(() => {
    const b = [...document.querySelectorAll(".form button")].find(x => /item reward/i.test(x.textContent));
    if (b) { b.click(); return true; }
    return false;
  });
  ok(added, "quest form has + Item reward");
  await p.waitForTimeout(200);
} else ok(true, "quest already has an item reward row");
await p.click(".form .rewards .itemsel-btn");
await p.waitForSelector(".modal .ip-list");
await p.fill(".modal .picker-q", "gold");
await p.waitForTimeout(200);
const gold = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".modal .ip-row")];
  const hit = rows.find(r => /gold/i.test(r.textContent)) || rows[0];
  if (hit) hit.click();
  return hit && hit.dataset.val;
});
await p.waitForTimeout(250);
const rwVal = await p.$eval(".form .rewards .itemsel", el => el.value);
ok(String(rwVal) === String(gold), "quest reward ItemID stays an id (" + rwVal + ")");

// Collect step target (item name)
const collectReady = await p.evaluate(() => {
  const already = [...document.querySelectorAll(".form .step .top > select")].find(s => s.value === "collect");
  if (already) return "exists";
  const add = [...document.querySelectorAll(".form .steps button")].find(b => b.textContent.trim() === "+ Step");
  if (!add) return "";
  add.click();
  const step = [...document.querySelectorAll(".form .step")].pop();
  const typeSel = step && step.querySelector(".top > select");
  if (!typeSel) return "";
  typeSel.value = "collect";
  typeSel.dispatchEvent(new Event("change", { bubbles: true }));
  return "added";
});
ok(!!collectReady, "quest has a collect step (" + collectReady + ")");
await p.waitForTimeout(250);
await p.click(".form .step .itemsel-btn");
await p.waitForSelector(".modal .ip-list");
await p.fill(".modal .picker-q", "string");
await p.waitForTimeout(200);
const itemName = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".modal .ip-row")];
  const hit = rows.find(r => /string/i.test(r.textContent)) || rows[0];
  const name = hit.querySelector("b")?.textContent;
  if (hit) hit.click();
  return name;
});
await p.waitForTimeout(250);
const stepVal = await p.$eval(".form .step .itemsel", el => el.value);
ok(typeof stepVal === "string" && stepVal.length > 0 && !/^\d+$/.test(stepVal),
  "collect Target is still an item name (" + stepVal + ")");
ok(stepVal === itemName, "collect Target matches the picked name");

ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (process.exitCode) console.log("FAILED");
else console.log("all ok");
