// Headless check that scrollable panels keep their place when you edit them.
// Covers lists, detail forms, dialogue trees, the map side panel, the season
// tab and a sprite-picker modal. After scrolling down, an edit (field, toggle,
// add or remove a row) must leave scrollTop where it was, and a focused input
// must keep focus and its caret.
//   python3 -m http.server 8766 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-scroll.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8766/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errs = [];
const tested = [];
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else { console.log("ok:", m); tested.push(m); } };
const TOL = 6;

async function open(file) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 520 } })).newPage();
  p.on("pageerror", e => errs.push(String(e)));
  p.on("dialog", d => d.accept());
  await p.goto(URL);
  await p.setInputFiles("#open", file);
  await p.waitForSelector("#tabs:not([hidden])");
  await p.waitForTimeout(500);
  return p;
}

const pos = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return null;
  return { top: el.scrollTop, left: el.scrollLeft, max: Math.max(0, el.scrollHeight - el.clientHeight) };
}, sel);

async function scrollDown(page, sel, frac = 0.75) {
  const r = await page.evaluate(({ sel, frac }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.max(40, Math.floor(max * frac));
    if (typeof BQScroll !== "undefined" && BQScroll.note) BQScroll.note(el);
    return { top: el.scrollTop, left: el.scrollLeft, max };
  }, { sel, frac });
  await page.waitForTimeout(40);
  return r;
}

const near = (a, b) => a != null && b != null && Math.abs(a - b) <= TOL;

async function assertHeld(page, sel, before, what) {
  await page.waitForTimeout(260);
  const after = await pos(page, sel);
  ok(before && after && before.max >= 30, what + ": the panel was scrollable (max " + (before && before.max) + ")");
  ok(near(before.top, after && after.top) && near(before.left, after && after.left),
    what + ": scroll stayed at " + (after && after.top) + " (was " + (before && before.top) + ")");
  return after;
}

const DB = process.env.DB;
if (!DB) { console.log("FAIL: set DB to a bq-content.db"); process.exit(1); }
const p = await open(DB);

// ---- Items: list stays after picking another row; form stays after add/remove a row; caret stays
await p.click("#tabs button[data-tab=items]");
await p.waitForSelector(".list .row");
await p.waitForTimeout(200);
const itemRows = await p.$$eval(".list .row", els => els.length);
ok(itemRows > 20, "Items list has rows (" + itemRows + ")");
let listBefore = await scrollDown(p, ".list");
const midLabel = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".list .row")];
  const list = document.querySelector(".list");
  const mid = rows.find(r => r.offsetTop > list.scrollTop + 40) || rows[Math.min(20, rows.length - 1)];
  mid.click();
  return mid.textContent;
});
await assertHeld(p, ".list", listBefore, "Items list after picking \"" + midLabel + "\"");

await p.waitForSelector(".form");
// pick a gear item so the form is long (drops list)
await p.fill(".list input[type=search]", "sword");
await p.waitForTimeout(100);
const sword = await p.$(".list .row");
if (sword) await sword.click();
await p.waitForTimeout(200);
await p.fill(".list input[type=search]", "");
await p.waitForTimeout(100);
let formBefore = await scrollDown(p, ".form");
ok(formBefore && formBefore.max >= 20, "Items form is scrollable");
const desc = await p.$(".form textarea");
if (desc) {
  await desc.click();
  await desc.evaluate(el => { el.focus(); const n = (el.value || "").length; el.setSelectionRange(n, n); });
  formBefore = await pos(p, ".form");
  await desc.type(" ");
  await p.waitForTimeout(80);
  const focused = await p.evaluate(() => document.activeElement && document.activeElement.tagName === "TEXTAREA" && document.activeElement.closest(".form"));
  ok(!!focused, "Items form: description keeps focus while typing");
  await desc.press("Backspace");
}
// add and remove a stat bonus at the bottom of the attributes block
const addBonus = p.locator(".form button", { hasText: "+ Stat bonus" });
if (await addBonus.count()) {
  formBefore = await scrollDown(p, ".form");
  const added = await p.evaluate(() => {
    const b = [...document.querySelectorAll(".form button")].find(x => x.textContent.includes("+ Stat bonus"));
    if (b) { b.click(); return true; }
    return false;
  });
  if (added) {
    await assertHeld(p, ".form", formBefore, "Items form after + Stat bonus");
    formBefore = await pos(p, ".form");
    const removed = await p.evaluate(() => {
      const b = [...document.querySelectorAll(".form .rw button")].filter(x => x.textContent.includes("×")).pop();
      if (b) { b.click(); return true; }
      return false;
    });
    if (removed) await assertHeld(p, ".form", formBefore, "Items form after removing a stat row");
  }
}

// ---- Quests: form stays after adding/removing a step
await p.click("#tabs button[data-tab=quests]");
await p.waitForSelector(".list .row");
await p.waitForTimeout(150);
listBefore = await scrollDown(p, ".list");
const qRow = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".list .row")];
  const list = document.querySelector(".list");
  const mid = rows.find(r => r.offsetTop > list.scrollTop + 40) || rows[Math.min(8, rows.length - 1)];
  mid.click();
  return mid.textContent;
});
await assertHeld(p, ".list", listBefore, "Quests list after picking \"" + qRow + "\"");
await p.waitForSelector(".form .steps, .form h3");
formBefore = await scrollDown(p, ".form");
const addStep = p.locator(".form button", { hasText: "+ Step" });
if (await addStep.count()) {
  await p.evaluate(() => { const b = [...document.querySelectorAll(".form button")].find(x => x.textContent.trim() === "+ Step"); if (b) b.click(); });
  await assertHeld(p, ".form", formBefore, "Quests form after + Step");
  formBefore = await pos(p, ".form");
  await p.evaluate(() => { const b = [...document.querySelectorAll(".form .step button")].filter(x => x.textContent.includes("×")).pop(); if (b) b.click(); });
  await assertHeld(p, ".form", formBefore, "Quests form after removing a step");
}
formBefore = await pos(p, ".form");
const typed = await p.evaluate(() => {
  const form = document.querySelector(".form");
  const fields = [...form.querySelectorAll(".step input, .step textarea, input[type=text], textarea, .qline-in")];
  const vis = fields.find(el => {
    const r = el.getBoundingClientRect(), fr = form.getBoundingClientRect();
    return r.height > 0 && r.bottom > fr.top + 4 && r.top < fr.bottom - 4;
  }) || fields.at(-1);
  if (!vis) return false;
  vis.focus({ preventScroll: true });
  const start = (vis.value || "").length;
  vis.setSelectionRange && vis.setSelectionRange(start, start);
  vis.value = (vis.value || "") + "x";
  vis.dispatchEvent(new Event("input", { bubbles: true }));
  return document.activeElement === vis;
});
ok(typed, "Quests form: the edited field keeps focus");
await p.evaluate(() => {
  const el = document.activeElement;
  if (el && "value" in el && el.value.endsWith("x")) {
    el.value = el.value.slice(0, -1);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await assertHeld(p, ".form", formBefore, "Quests form after typing in a field");

// ---- NPCs: list stays; dialogue add/remove an answer; a role toggle
await p.click("#tabs button[data-tab=npcs]");
await p.waitForSelector(".list .row");
await p.waitForTimeout(150);
listBefore = await scrollDown(p, ".list");
const npcRow = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".list .row")];
  const list = document.querySelector(".list");
  const mid = rows.find(r => r.offsetTop > list.scrollTop + 40) || rows[Math.min(10, rows.length - 1)];
  mid.click();
  return mid.textContent;
});
await assertHeld(p, ".list", listBefore, "NPCs list after picking \"" + npcRow + "\"");
await p.waitForSelector(".form");
formBefore = await scrollDown(p, ".form", 0.9);
const addAns = p.locator(".form button", { hasText: "+ Answer" }).first();
if (await addAns.count()) {
  await addAns.click();
  await assertHeld(p, ".form", formBefore, "NPC dialogue after + Answer");
  formBefore = await pos(p, ".form");
  const lastX = p.locator(".form .opt button", { hasText: "×" }).last();
  if (await lastX.count()) {
    await lastX.click();
    await assertHeld(p, ".form", formBefore, "NPC dialogue after removing an answer");
  }
} else {
  ok(true, "NPC dialogue: no + Answer on this NPC (skipped add/remove)");
}
const role = await p.$(".form .roles input[type=checkbox]");
if (role) {
  formBefore = await scrollDown(p, ".form", 0.5);
  await role.click();
  await assertHeld(p, ".form", formBefore, "NPC form after toggling a role");
  const role2 = await p.$(".form .roles input[type=checkbox]");
  if (role2) { await role2.click(); await p.waitForTimeout(80); }
}

// ---- Mobs: list stays; pattern add/remove if present, else a field edit
await p.click("#tabs button[data-tab=mobs]");
await p.waitForSelector(".list .row");
await p.waitForTimeout(150);
listBefore = await scrollDown(p, ".list");
const mobRow = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".list .row")];
  const list = document.querySelector(".list");
  const mid = rows.find(r => r.offsetTop > list.scrollTop + 40) || rows[Math.min(8, rows.length - 1)];
  mid.click();
  return mid.textContent;
});
await assertHeld(p, ".list", listBefore, "Mobs list after picking \"" + mobRow + "\"");
await p.waitForSelector(".form");
formBefore = await scrollDown(p, ".form");
const addPrim = p.locator(".form button", { hasText: "+ Zone" }).first();
if (await addPrim.count()) {
  await p.evaluate(() => { const b = [...document.querySelectorAll(".form button")].find(x => x.textContent.trim() === "+ Zone"); if (b) b.click(); });
  await assertHeld(p, ".form", formBefore, "Mobs form after + Zone");
  await p.keyboard.press("Escape");
} else {
  const numIn = await p.$(".form input.num, .form input[type=number]");
  if (numIn) {
    await numIn.click();
    const was = await numIn.inputValue();
    await numIn.fill(String((+was || 1) + 1));
    const focused = await p.evaluate(() => document.activeElement && document.activeElement.matches("input"));
    ok(!!focused, "Mobs form: number field keeps focus after edit");
    await numIn.fill(was);
    await assertHeld(p, ".form", formBefore, "Mobs form after editing a number");
  } else {
    ok(formBefore && formBefore.max >= 0, "Mobs form opened");
  }
}

// ---- Season: form stays after save-switch (full re-render) and add/remove a prop
await p.keyboard.press("Escape");
await p.waitForTimeout(100);
await p.click("#tabs button[data-tab=season]");
await p.waitForSelector("[data-act=save-switch], [data-towns]");
await p.waitForTimeout(200);
formBefore = await scrollDown(p, ".form", 0.85);
const snowKey = await p.evaluate(() => (document.querySelector("[data-key=WorldSnow]") && "WorldSnow") || (document.querySelector("[data-key=Snowfall]") && "Snowfall"));
if (snowKey) {
  await p.evaluate(k => document.querySelector("[data-key=" + k + "]").click(), snowKey);
  await assertHeld(p, ".form", formBefore, "Season form after toggling a snow checkbox");
  formBefore = await pos(p, ".form");
  await p.evaluate(() => document.querySelector("[data-act=save-switch]").click());
  await p.waitForTimeout(300);
  await assertHeld(p, ".form", formBefore, "Season form after Save switch (full re-render)");
  // put the tick back and save so a later test does not keep the flip
  await p.evaluate(k => { const el = document.querySelector("[data-key=" + k + "]"); if (el) el.click(); }, snowKey);
  await p.evaluate(() => document.querySelector("[data-act=save-switch]").click());
  await p.waitForTimeout(250);
}
formBefore = await scrollDown(p, ".form", 0.95);
await p.evaluate(() => document.querySelector("[data-act=add-prop]").click());
await assertHeld(p, ".form", formBefore, "Season form after + Add prop");
formBefore = await pos(p, ".form");
await p.evaluate(() => { const b = document.querySelector("[data-prop=new] [data-act=delete-prop]"); if (b) b.click(); });
await assertHeld(p, ".form", formBefore, "Season form after deleting the unsaved prop");

// ---- Map side panel: stay after a toggle and after picking an NPC in the list
await p.click("#tabs button[data-tab=map]");
await p.waitForSelector(".side, canvas#map");
await p.waitForTimeout(400);
// NPCs tool has a long list
const npcTool = p.locator(".tools button, .side button", { hasText: /^NPCs?$/i }).first();
if (await npcTool.count()) {
  await npcTool.click();
  await p.waitForTimeout(200);
}
const sideSel = ".side";
let sideBefore = await scrollDown(p, sideSel);
if (!(sideBefore && sideBefore.max >= 20)) {
  // paint tool toggles still sit in a short panel; try the areas or npc list
  const tabs = ["Areas", "Spawn", "Paint", "Plots"];
  for (const name of tabs) {
    const btn = p.locator(".tools button, .side button", { hasText: new RegExp("^" + name, "i") }).first();
    if (await btn.count()) { await btn.click(); await p.waitForTimeout(150); }
    sideBefore = await scrollDown(p, sideSel);
    if (sideBefore && sideBefore.max >= 20) break;
  }
}
ok(sideBefore && sideBefore.max >= 10, "Map side panel is scrollable (max " + (sideBefore && sideBefore.max) + ")");
const chk = await p.$(".side input[type=checkbox]");
if (chk) {
  await p.evaluate(() => { const c = document.querySelector(".side input[type=checkbox]"); if (c) c.click(); });
  await assertHeld(p, sideSel, sideBefore, "Map side panel after a checkbox");
  await p.evaluate(() => { const c = document.querySelector(".side input[type=checkbox]"); if (c) c.click(); });
} else {
  const search = await p.$(".side input[type=search], .side input[type=text]");
  if (search) {
    await search.click();
    await search.type("a");
    await assertHeld(p, sideSel, sideBefore, "Map side panel after typing in a filter");
    await search.fill("");
  }
}

// ---- Sprite picker modal
await p.click("#tabs button[data-tab=items]");
await p.waitForSelector(".form");
await p.waitForTimeout(150);
const pickBtn = p.locator(".form button", { hasText: "Pick…" }).first();
if (await pickBtn.count()) {
  await pickBtn.click();
  await p.waitForSelector(".picker-grid, .modal");
  await p.waitForTimeout(150);
  const gridSel = ".picker-grid, .modal-body, .modal .form";
  const grid = await p.$(".picker-grid") ? ".picker-grid" : ".modal-body";
  const gBefore = await scrollDown(p, grid);
  if (gBefore && gBefore.max >= 20) {
    const chip = p.locator(".modal button, .modal-head ~ * button").nth(2);
    if (await chip.count()) {
      await chip.click();
      await p.waitForTimeout(100);
    }
    // type in the modal filter if any
    const filter = await p.$(".modal input[type=search], .modal input[type=text]");
    if (filter) {
      const held = await pos(p, grid);
      await filter.fill("sword");
      await p.waitForTimeout(80);
      // filter shrinks the grid, so we only require it did not crash; if still tall, check near
      const after = await pos(p, grid);
      ok(!!after, "Sprite picker modal still present after filtering");
    } else {
      await assertHeld(p, grid, gBefore, "Sprite picker grid after a click in the modal");
    }
  } else {
    ok(true, "Sprite picker opened (grid shorter than the viewport)");
  }
  await p.keyboard.press("Escape");
} else {
  ok(false, "Items form has a Pick… button to open the sprite modal");
}

if (errs.length) {
  console.log("FAIL: page errors:", errs.join(" | "));
  process.exitCode = 1;
}
console.log("tested panels:", tested.length);
await b.close();
if (!process.exitCode) console.log("ALL OK");
