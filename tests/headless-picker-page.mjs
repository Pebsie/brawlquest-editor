// The item image picker's Everything chip used to stop at 500 sprites and
// tell you to search. You can now scroll through the lot: batches of 160,
// a "Showing N of M" count, lazy thumbnails, search over the full set
// (which resets paging), and the filter/scroll stay when you pick one.
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-picker-page.mjs
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
await p.click("#tabs button[data-tab=items]");
await p.waitForSelector(".form button");
await p.waitForTimeout(200);
await p.click('.form button:has-text("Pick…")');
await p.waitForSelector(".modal .picker");

const chip = label => p.click(`.modal .picker-chips button:text-matches("^${label} \\\\(")`);
const cells = () => p.$$eval(".modal .picker-grid .pcell", els => els.map(e => e.dataset.value));
const countOf = async () => {
  const t = await p.$eval(".modal .picker-count", e => e.hidden ? "" : e.textContent.trim());
  const m = t.match(/Showing (\d+) of (\d+)/);
  return { text: t, n: m ? +m[1] : 0, total: m ? +m[2] : 0 };
};
const scrollBottom = async () => {
  await p.evaluate(() => {
    const g = document.querySelector(".modal .picker-grid");
    g.scrollTop = g.scrollHeight;
  });
  await p.waitForTimeout(250);
};

await chip("Everything");
await p.waitForTimeout(400);
let c = await countOf();
const first = await cells();
ok(c.total > 500, "Everything has more than the old 500 cap (" + c.total + " sprites)");
ok(c.n > 0 && c.n <= 200, "first page is a batch, not the whole set (Showing " + c.n + " of " + c.total + ")");
ok(c.text === `Showing ${c.n} of ${c.total}`, "count reads " + JSON.stringify(c.text));
ok(first.length === c.n, "grid shows " + first.length + " cells, matching the count");
const lazy = await p.$$eval(".modal .picker-grid .pcell img", els => els.length && els.every(i => i.getAttribute("loading") === "lazy"));
ok(lazy, "thumbnails use loading=lazy");
ok(!await p.$(".modal .hint.wide"), "no leftover 'type to narrow it down' hint");

const pageSize = c.n;
const total = c.total;
const beforeLast = first[first.length - 1];
await scrollBottom();
c = await countOf();
const mid = await cells();
ok(c.n > pageSize && c.n <= pageSize * 2 + 20, "scrolling the bottom loads the next batch (now " + c.n + ")");
ok(c.total === total, "total stays " + total + " after loading more");
ok(mid.length === c.n && mid[pageSize - 1] === beforeLast, "first batch is still there; new cells are appended");
ok(mid.slice(pageSize).every(v => !first.includes(v)), "the new cells were not on the first page");

await scrollBottom();
c = await countOf();
ok(c.n > pageSize * 2 || c.n === total, "a second scroll loads more still (now " + c.n + " of " + c.total + ")");

// Keep going until everything is on the grid, so you can browse without search.
for (let i = 0; i < 30 && (await countOf()).n < total; i++) await scrollBottom();
c = await countOf();
const all = await cells();
ok(c.n === total && all.length === total, "scrolling far enough shows every sprite (" + c.n + " of " + c.total + ")");

// Search filters the full set and resets paging.
await p.fill(".modal .picker-q", "sword");
await p.waitForTimeout(200);
c = await countOf();
const swords = await cells();
ok(c.n === c.total && c.total >= 1 && c.total < total, "search 'sword' filters the full set (" + c.text + ")");
ok(swords.length === c.n && swords.every(v => v.toLowerCase().includes("sword")), "every visible cell matches the search");
const swordScroll = await p.evaluate(() => document.querySelector(".modal .picker-grid").scrollTop);
ok(swordScroll === 0, "search resets scroll to the top");

await p.fill(".modal .picker-q", "");
await p.waitForTimeout(200);
c = await countOf();
ok(c.total === total && c.n <= 200 && c.n >= 1, "clearing search resets paging (Showing " + c.n + " of " + c.total + ")");

// Scroll deep on the unfiltered list, pick, reopen: page and scroll stay.
await scrollBottom();
await scrollBottom();
c = await countOf();
ok(c.n >= pageSize * 2, "two more scrolls load at least two pages (Showing " + c.n + " of " + c.total + ")");
const deepCells = await cells();
const pickDeep = deepCells[Math.min(pageSize + 40, deepCells.length - 1)];
const scrollDeep = await p.evaluate(() => document.querySelector(".modal .picker-grid").scrollTop);
ok(scrollDeep > 40, "the grid has been scrolled down (" + scrollDeep + ")");
await p.evaluate(v => document.querySelector(`.modal .picker-grid .pcell[data-value="${CSS.escape(v)}"]`).click(), pickDeep);
await p.waitForTimeout(300);
ok(await p.evaluate(v => [...document.querySelectorAll(".form input")].some(i => i.value === v), pickDeep),
  "picking a scrolled-to sprite fills the form (" + pickDeep + ")");
await p.click('.form button:has-text("Pick…")');
await p.waitForSelector(".modal .picker");
await p.waitForTimeout(350);
const deepRest = await p.evaluate(() => {
  const on = [...document.querySelectorAll(".modal .picker-chips button")].find(b => b.classList.contains("on"));
  const q = document.querySelector(".modal .picker-q");
  const g = document.querySelector(".modal .picker-grid");
  return { chip: on && on.textContent, q: q.value, scroll: g.scrollTop, n: g.querySelectorAll(".pcell").length, sel: [...g.querySelectorAll(".pcell.sel")].map(e => e.dataset.value) };
});
const deepCount = await countOf();
ok(/^Everything \(/.test(deepRest.chip || "") && deepRest.q === "", "reopening after a deep pick keeps Everything and a clear search");
ok(deepCount.n >= pageSize * 2 && deepCount.total === total, "reopening still has the loaded pages (" + deepCount.text + ")");
ok(Math.abs(deepRest.scroll - scrollDeep) <= 30, "reopening keeps the deep scroll (" + deepRest.scroll + ", was " + scrollDeep + ")");
ok(deepRest.sel.includes(pickDeep), "the deep-picked sprite stays selected");
await p.keyboard.press("Escape");
await p.waitForTimeout(200);
await p.click('.form button:has-text("Pick…")');
await p.waitForSelector(".modal .picker");
await p.waitForTimeout(200);

// Scroll, then pick; reopen should keep Everything, the filter, the page and the scroll.
await p.fill(".modal .picker-q", "shield");
await p.waitForTimeout(200);
c = await countOf();
ok(c.total >= 1, "search 'shield' has matches (" + c.text + ")");
let shields = await cells();
if (c.n < c.total) {
  await scrollBottom();
  shields = await cells();
}
const pickValue = shields[Math.min(3, shields.length - 1)];
const scrollBefore = await p.evaluate(() => document.querySelector(".modal .picker-grid").scrollTop);
await p.evaluate(v => document.querySelector(`.modal .picker-grid .pcell[data-value="${CSS.escape(v)}"]`).click(), pickValue);
await p.waitForTimeout(300);
ok(await p.evaluate(v => [...document.querySelectorAll(".form input")].some(i => i.value === v), pickValue),
  "picking fills the item image with " + pickValue);
ok(await p.$(".modal .picker") === null, "the picker closes after a pick");

await p.click('.form button:has-text("Pick…")');
await p.waitForSelector(".modal .picker");
await p.waitForTimeout(300);
const restored = await p.evaluate(() => {
  const on = [...document.querySelectorAll(".modal .picker-chips button")].find(b => b.classList.contains("on"));
  const q = document.querySelector(".modal .picker-q");
  const g = document.querySelector(".modal .picker-grid");
  const count = document.querySelector(".modal .picker-count").textContent.trim();
  return { chip: on && on.textContent, q: q.value, scroll: g.scrollTop, count, sel: [...g.querySelectorAll(".pcell.sel")].map(e => e.dataset.value) };
});
ok(/^Everything \(/.test(restored.chip || ""), "reopening keeps the Everything chip (" + restored.chip + ")");
ok(restored.q === "shield", "reopening keeps the search text (" + JSON.stringify(restored.q) + ")");
ok(restored.count.startsWith("Showing ") && restored.count.includes(" of "), "reopening still shows a count (" + restored.count + ")");
const restoredCells = await cells();
ok(restoredCells.every(v => v.toLowerCase().includes("shield")) && restoredCells.includes(pickValue),
  "reopening still shows the filtered 'shield' results, including the one you picked");
ok(Math.abs(restored.scroll - scrollBefore) <= 20, "reopening keeps scroll (" + restored.scroll + ", was " + scrollBefore + ")");
ok(restored.sel.includes(pickValue), "the picked sprite stays selected");

ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (process.exitCode) console.log("FAILED");
else console.log("all ok");
