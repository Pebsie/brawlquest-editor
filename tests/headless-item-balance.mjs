// Live Balance panel on the item form: suggested level, peers, updates as you
// type without stealing focus or jumping the form scroll.
//   python3 -m http.server 8768 --bind 127.0.0.1
//   DB=/path/to/bq-content.db node tests/headless-item-balance.mjs
const { chromium } = await import(process.env.PW || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs");
const URL = process.env.URL || "http://127.0.0.1:8768/index.html";
const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }

const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const errs = [];
const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };

const p = await (await b.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
await p.goto(URL);
await p.setInputFiles("#open", DB);
await p.waitForSelector("#tabs:not([hidden])", { state: "attached" });
await p.waitForTimeout(400);

await p.evaluate(() => { location.hash = "#item/39"; });
await p.waitForSelector("#item-bal");
await p.waitForTimeout(200);

const first = await p.evaluate(() => ({
  sug: document.querySelector("[data-ib=suggested]")?.textContent || "",
  flag: document.querySelector("[data-ib=flag]")?.textContent || "",
  formula: document.querySelector("[data-ib=formula]")?.textContent || "",
  peers: [...document.querySelectorAll(".ib-peer")].map(e => +e.dataset.id),
  math: BQItemBal.analyse(S.c.items.find(i => i.id === 39), S.c.items)
}));
ok(/Suggested level:\s*~\d+/.test(first.sug), "Iron Chestplate shows a suggested level (" + first.sug + ")");
ok(first.math.suggested && Math.abs(first.math.suggested.level - 10) <= 6, "score for Iron Chestplate is around level 10, got " + (first.math.suggested && first.math.suggested.level));
ok(/Val/.test(first.formula), "the formula is on the panel");
ok(first.peers.length >= 2 && first.peers.every(id => id !== 39), "clickable peer items are listed");

// Bandit's Cloak should be flagged
await p.evaluate(() => { location.hash = "#item/13"; });
await p.waitForTimeout(400);
const cloak = await p.evaluate(() => ({
  sug: document.querySelector("[data-ib=suggested]")?.textContent || "",
  flag: document.querySelector("[data-ib=flag]")?.className || "",
  text: document.querySelector("[data-ib=flag]")?.textContent || "",
  math: BQItemBal.analyse(S.c.items.find(i => i.id === 13), S.c.items)
}));
ok(cloak.math.far && /off/.test(cloak.flag), "Bandit's Cloak is flagged as off (" + cloak.sug + "; " + cloak.text + ")");

// live update + scroll/focus hold, back on the chestplate
await p.evaluate(() => { location.hash = "#item/39"; });
await p.waitForTimeout(400);
const val = await p.$('input[data-k="Val"]');
ok(!!val, "Val field is marked for the test");
await p.evaluate(() => {
  const f = document.querySelector(".form");
  const max = Math.max(0, f.scrollHeight - f.clientHeight);
  f.scrollTop = Math.min(Math.max(80, Math.floor(max * 0.45)), Math.max(0, max - 40));
  if (typeof BQScroll !== "undefined" && BQScroll.note) BQScroll.note(f);
});
const beforeTop = await p.$eval(".form", e => e.scrollTop);
const beforeSug = await p.$eval("[data-ib=suggested]", e => e.textContent);
await val.click();
await val.fill("200");
await p.waitForTimeout(200);
const after = await p.evaluate(() => ({
  top: document.querySelector(".form").scrollTop,
  focus: document.activeElement && document.activeElement.getAttribute("data-k"),
  sug: document.querySelector("[data-ib=suggested]")?.textContent || ""
}));
ok(after.focus === "Val", "focus stayed on Val after the panel refreshed (got " + after.focus + ")");
const afterMax = await p.$eval(".form", e => Math.max(0, e.scrollHeight - e.clientHeight));
ok(after.top > 0 && Math.abs(after.top - Math.min(beforeTop, afterMax)) <= 8,
  "form scroll stayed put (" + after.top + ", was " + beforeTop + ", max now " + afterMax + ")");
ok(after.sug !== beforeSug && /~\d+/.test(after.sug), "suggested level updated live (" + beforeSug + " → " + after.sug + ")");

// a chair has no suggested level
await p.evaluate(() => { location.hash = "#item/81"; });
await p.waitForTimeout(400);
ok(await p.$("[data-ib=nolevel]") !== null && await p.$("[data-ib=suggested]") === null, "a chair has no suggested level, just a peer comparison");

// clicking a peer on the chestplate opens that item
await p.evaluate(() => { location.hash = "#item/39"; });
await p.waitForTimeout(400);
const peerId = await p.$eval(".ib-peer", e => +e.dataset.id);
await p.click(".ib-peer");
await p.waitForTimeout(400);
ok(await p.evaluate(id => S.item && S.item.id === id, peerId), "clicking a comparable item opens it (#" + peerId + ")");

ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
if (process.exitCode) console.log("FAILED");
else console.log("all ok");
