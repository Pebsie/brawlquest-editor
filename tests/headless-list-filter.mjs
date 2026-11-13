// Headless check that searchable lists keep their filter text, filtered
// rows and scroll position when you pick a row (which re-renders the tab).
// Covers every listPanel tab (items, NPCs, quests, mobs, loot, effects,
// sounds) and the Areas list on the map.
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-list-filter.mjs
const { chromium } = await import(process.env.PW || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8768/index.html";
const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }

const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };

const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
await p.goto(URL);
await p.setInputFiles("#open", DB);
await p.waitForSelector("#tabs:not([hidden])");
await p.waitForTimeout(400);

function pickTerm(labels, prefer) {
  const all = labels.map(l => String(l).toLowerCase());
  if (prefer && all.some(l => l.includes(prefer))) return prefer;
  const counts = {};
  for (const l of all) {
    for (const t of l.split(/[^a-z0-9]+/).filter(x => x.length >= 3)) counts[t] = (counts[t] || 0) + 1;
  }
  const cand = Object.entries(counts).filter(([, n]) => n >= 2 && n < all.length)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  if (cand.length) return cand[0][0];
  // Fall back to a letter that still filters something.
  for (const ch of "aeioujunkstr") {
    const n = all.filter(l => l.includes(ch)).length;
    if (n >= 1 && n < all.length) return ch;
  }
  return all[0] ? all[0].slice(0, 3) : "a";
}

async function checkList(tab, name, prefer) {
  await p.click(`#tabs button[data-tab=${tab}]`);
  await p.waitForSelector(".list .row, .list input[type=search]");
  await p.waitForTimeout(200);
  const labels = await p.$$eval(".list .row", els => els.map(e => e.textContent));
  if (!labels.length) { ok(true, name + ": no rows in this db (skipped)"); return; }
  const term = pickTerm(labels, prefer);
  const beforeAll = labels.length;
  const q = p.locator(".list input[type=search]");
  await q.fill(term);
  await p.waitForTimeout(80);
  const afterFilter = await p.evaluate(() => {
    const list = document.querySelector(".list");
    const rows = [...list.querySelectorAll(".row")].map(e => e.textContent);
    return { q: list.querySelector("input[type=search]").value, rows, count: rows.length, max: Math.max(0, list.scrollHeight - list.clientHeight) };
  });
  ok(afterFilter.q === term, name + ": typed filter is " + JSON.stringify(term) + " (got " + JSON.stringify(afterFilter.q) + ")");
  ok(afterFilter.count >= 1, name + ": filter \"" + term + "\" has rows (" + afterFilter.count + " of " + beforeAll + ")");
  ok(afterFilter.count < beforeAll || beforeAll === 1, name + ": filter reduced the list (or the list had one row)");
  ok(afterFilter.rows.every(t => t.toLowerCase().includes(term.toLowerCase())), name + ": every visible row matches the filter");

  const scrolled = await p.evaluate(() => {
    const list = document.querySelector(".list");
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    if (max < 30) return { top: list.scrollTop, max, did: false };
    list.scrollTop = Math.max(40, Math.floor(max * 0.6));
    if (typeof BQScroll !== "undefined" && BQScroll.note) BQScroll.note(list);
    return { top: list.scrollTop, max, did: true };
  });
  await p.waitForTimeout(40);

  const clicked = await p.evaluate(() => {
    const list = document.querySelector(".list");
    const rows = [...list.querySelectorAll(".row")];
    const mid = rows.find(r => r.offsetTop > list.scrollTop + 20) || rows[Math.min(rows.length - 1, 1)] || rows[0];
    mid.click();
    return mid.textContent;
  });
  await p.waitForTimeout(400);

  const afterClick = await p.evaluate(() => {
    const list = document.querySelector(".list");
    const q = list && list.querySelector("input[type=search]");
    const rows = list ? [...list.querySelectorAll(".row")].map(e => e.textContent) : [];
    const sel = list && list.querySelector(".row.sel");
    return {
      q: q ? q.value : null,
      rows,
      count: rows.length,
      top: list ? list.scrollTop : null,
      sel: sel ? sel.textContent : null,
      stored: (typeof S !== "undefined" && S.listFilter) ? S.listFilter[S.tab] : null
    };
  });
  ok(afterClick.q === term, name + ": filter text stayed \"" + term + "\" after picking \"" + clicked + "\" (got " + JSON.stringify(afterClick.q) + ")");
  ok(afterClick.stored === term, name + ": S.listFilter remembered \"" + term + "\"");
  ok(afterClick.count === afterFilter.count, name + ": filtered row count stayed " + afterFilter.count + " (got " + afterClick.count + ")");
  ok(JSON.stringify(afterClick.rows) === JSON.stringify(afterFilter.rows), name + ": filtered rows stayed the same after pick");
  ok(afterClick.sel && afterClick.sel.includes(clicked.trim() ? clicked : afterClick.sel), name + ": picked row is still selected");
  if (scrolled.did) {
    ok(Math.abs((afterClick.top || 0) - scrolled.top) <= 6,
      name + ": scroll stayed at " + afterClick.top + " (was " + scrolled.top + ")");
  } else {
    ok(true, name + ": list not tall enough to scroll after filter (skipped scroll)");
  }
}

await checkList("items", "Items", "junk");
await checkList("npcs", "NPCs");
await checkList("quests", "Quests");
await checkList("mobs", "Mobs");
await checkList("loot", "Loot");
await checkList("effects", "Effects");
await checkList("sounds", "Sounds");

// Coming back to Items must still show the earlier filter.
await p.click("#tabs button[data-tab=items]");
await p.waitForSelector(".list input[type=search]");
await p.waitForTimeout(250);
const back = await p.evaluate(() => {
  const q = document.querySelector(".list input[type=search]");
  const rows = [...document.querySelectorAll(".list .row")].map(e => e.textContent);
  return { q: q && q.value, rows, stored: S.listFilter && S.listFilter.items };
});
ok(!!back.q, "Items: filter still filled after leaving and coming back (" + JSON.stringify(back.q) + ")");
ok(back.q === back.stored, "Items: input matches S.listFilter.items");
ok(back.rows.length >= 1 && back.rows.every(t => t.toLowerCase().includes(String(back.q).toLowerCase())),
  "Items: rows still match the remembered filter");

// Areas list on the map tool (filter already lives on AR.filter).
await p.click("#tabs button[data-tab=map]");
await p.waitForTimeout(800);
const areasOpen = await p.evaluate(() => {
  const b = [...document.querySelectorAll("button, .seg button, .side button")].find(x => x.textContent.trim() === "Areas");
  if (b) { b.click(); return true; }
  return false;
});
if (areasOpen) {
  await p.waitForTimeout(300);
  const has = await p.$("input[placeholder='Filter areas']");
  if (has) {
    const labels = await p.$$eval(".arealist .arearow .an, .arealist .arearow", els => els.map(e => e.textContent));
    const names = await p.$$eval(".arealist .arearow .an", els => els.map(e => e.textContent)).catch(() => labels);
    const use = names.length ? names : labels;
    if (use.length) {
      const term = pickTerm(use);
      await p.fill("input[placeholder='Filter areas']", term);
      await p.waitForTimeout(80);
      const before = await p.evaluate(() => ({
        q: document.querySelector("input[placeholder='Filter areas']").value,
        rows: [...document.querySelectorAll(".arealist .arearow")].map(e => e.textContent)
      }));
      await p.evaluate(() => {
        const rows = [...document.querySelectorAll(".arealist .arearow")];
        (rows[rows.length - 1] || rows[0]).click();
      });
      await p.waitForTimeout(300);
      const after = await p.evaluate(() => ({
        q: document.querySelector("input[placeholder='Filter areas']")?.value,
        rows: [...document.querySelectorAll(".arealist .arearow")].map(e => e.textContent),
        stored: typeof AR !== "undefined" ? AR.filter : null
      }));
      ok(after.q === term && after.stored === term, "Areas: filter stayed \"" + term + "\" after picking a row");
      ok(JSON.stringify(after.rows) === JSON.stringify(before.rows), "Areas: filtered rows stayed the same after pick");
    } else ok(true, "Areas: no area rows in this db (skipped)");
  } else ok(true, "Areas: no filter box (tables may be missing; skipped)");
} else ok(false, "Areas: could not find the Areas tool button");

ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (process.exitCode) console.log("FAILED");
else console.log("all ok");
