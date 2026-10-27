"use strict";
// BrawlQuest content editor. Talks to the API's localhost-only editor endpoints.
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

const S = { tab: new URLSearchParams(location.search).get("tab") || "map", c: null, world: null,
  quest: null, npc: null, item: null, dirty: false };

function status(msg, err) { const s = $("#status"); s.textContent = msg; s.className = err ? "err" : ""; }

// Same calls the server editor made, answered by sql.js in the page (db.js).
async function api(path, body) {
  if (!BQ.has()) throw new Error("Open a bq-content.db first");
  const fn = { content: () => BQ.api.content(), world: () => BQ.api.world(), save: () => BQ.api.save(body),
    delete: () => BQ.api.delete(body), tiles: () => BQ.api.tiles(body), patterns: () => BQ.api.patterns(body),
    export: () => (body === undefined ? BQ.api.export() : BQ.api.clearExport()), portraits: () => BQ.api.portraits(body),
    areas: () => BQ.api.areas(), areasCreate: () => BQ.api.areasCreate(), areaSave: () => BQ.api.areaSave(body),
    areaDelete: () => BQ.api.areaDelete(body), areaTiles: () => BQ.api.areaTiles(body),
    dailyEnable: () => BQ.api.dailyEnable(), dialogueEnable: () => BQ.api.dialogueEnable(), saveMany: () => BQ.api.saveMany(body),
    spawnsEnable: () => BQ.api.spawnsEnable() }[path];
  const v = BQ.st.version;
  const out = fn();
  syncFile();
  if (BQ.st.version !== v) document.dispatchEvent(new CustomEvent("bq:change", { detail: { path } }));
  return out;
}

// ------------------------------------------------------------------ sprites
// Bundled copy of the client's art (default), a local client folder, or a URL.
const ASSETS = { mode: localStorage.getItem("bqAssetMode") || "bundled", base: localStorage.getItem("bqAssetBase") || "", local: null, index: [] };
function assetURL(path) {
  path = path || "assets/error.png";
  if (ASSETS.mode === "local" && ASSETS.local) return ASSETS.local.get(path) || ASSETS.local.get(path.toLowerCase()) || "assets/error.png";
  if (ASSETS.mode === "url" && ASSETS.base) return ASSETS.base.replace(/\/?$/, "/") + path.split("/").map(encodeURIComponent).join("/");
  return path.split("/").map(encodeURIComponent).join("/");
}
function assetPaths() {
  if (ASSETS.mode === "local" && ASSETS.localList) return ASSETS.localList;
  return ASSETS.index;
}
fetch("assets/index.json").then(r => r.json()).then(j => (ASSETS.index = j)).catch(() => {});
function pickLocalFolder(files) {
  const m = new Map();
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    const i = rel.indexOf("assets/");
    if (i < 0 || !/\.png$/i.test(rel)) continue;
    const key = rel.slice(i);
    const url = URL.createObjectURL(f);
    m.set(key, url); m.set(key.toLowerCase(), url);
  }
  if (!m.size) { status("No assets/*.png found in that folder. Pick the BrawlQuest-Client folder.", true); return; }
  ASSETS.local = m;

  ASSETS.localList = [...files].map(f => f.webkitRelativePath || f.name).filter(r => r.includes("assets/") && /\.png$/i.test(r)).map(r => r.slice(r.indexOf("assets/"))).sort();
  setAssetMode("local");
  status(`Using ${m.size / 2} sprites from your client folder.`);
}
function setAssetMode(mode) {
  ASSETS.mode = mode; localStorage.setItem("bqAssetMode", mode);
  M.imgs = {}; M.colours = {};
  if (S.c) renderTab();
}

// ------------------------------------------------------------------ file
function syncFile() {
  const d = BQ.st.dirty;
  $("#btn-save").disabled = !BQ.has();
  $("#file").textContent = BQ.has() ? `${BQ.st.name}${d ? " · unsaved changes" : ""}` : "No database open";
  $("#file").classList.toggle("dirty", d);
}
async function openFile(file) {
  if (/users/i.test(file.name)) { alert("That looks like a player database. Open bq-content.db only."); return; }
  status("Opening " + file.name + "…");
  try { await openBytes(await file.arrayBuffer(), file.name, { source: "file", lastModified: file.lastModified }); }
  catch (e) { status(e.message, true); alert(e.message); }
}
// Open a db from bytes. o.source: "file", "github" or "history"; the history
// and GitHub modules (sync.js) are told through the bq:open event.
async function openBytes(buf, name, o = {}) {
  const warnings = await BQ.open(buf, name);
  if (o.restore) {
    BQ.st.dirty = !!o.restore.dirty; BQ.st.changes = o.restore.changes || [];
    BQ.st.plotUpgraded = !!o.restore.plotUpgraded; BQ.st.enemiesUpgraded = !!o.restore.enemiesUpgraded; BQ.st.questsUpgraded = !!o.restore.questsUpgraded;
  }
  S.world = null; S.quest = S.npc = S.item = null;
  $("#welcome").hidden = true; $("#main").hidden = false; $("#tabs").hidden = false;
  $("#warn").hidden = !warnings.length; $("#warn").textContent = warnings.join(" ");
  await loadAll(); syncFile();
  document.dispatchEvent(new CustomEvent("bq:open", { detail: { name, ...o } }));
  if (location.hash.length > 1) await applyRoute(); else renderTab();
}
async function saveDb() {
  if (typeof BQSync !== "undefined" && !(await BQSync.checkBefore("Save .db"))) return;
  const name = BQ.st.name.replace(/(\.db|\.sqlite3?)?$/i, "") + "-edited.db";
  download(new Blob([BQ.bytes()], { type: "application/x-sqlite3" }), /edited/.test(BQ.st.name) ? BQ.st.name : name);
  BQ.st.dirty = false; syncFile();
  document.dispatchEvent(new CustomEvent("bq:saved", { detail: { how: "download" } }));
  status("Downloaded. Copy it over bq-content.db on the server (keep a backup) and restart the API.");
}
function download(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}

async function loadAll() {
  status("Loading…");
  S.c = await api("content");
  S.c.quests = S.c.quests || []; S.c.conversations = S.c.conversations || [];
  S.convBy = Object.fromEntries(S.c.conversations.map(c => [c.Identifier, c]));
  S.npcBy = Object.fromEntries(S.c.npcs.map(n => [n.id, n]));
  S.c.npcSpawns = S.c.npcSpawns || [];
  S.spawnBy = {};
  for (const sp of S.c.npcSpawns) (S.spawnBy[sp.NPC] = S.spawnBy[sp.NPC] || []).push(sp);
  S.ownerCache = null;
  S.c.items = S.c.items || [];
  S.itemBy = Object.fromEntries(S.c.items.map(i => [i.id, i]));
  S.enemyBy = Object.fromEntries(S.c.enemies.map(e => [e.id, e]));
  S.c.npcNotes = S.c.npcNotes || [];
  status(`${S.c.items.length} items · ${S.c.quests.length} quests · ${S.c.npcs.length} NPCs · ${S.c.conversations.length} dialogue nodes`);
}
async function loadWorld() {
  const w = await api("world");
  S.world = { strings: w.strings, tiles: new Map() };
  for (const t of w.tiles) S.world.tiles.set(t[0] + "," + t[1], t);
  await loadAreas();
}

async function save(table, row) {
  status("Saving…");
  try {
    const r = await api("save", { table, row });
    await loadAll();
    status(`Saved ${table} ${r.id} in memory. Use Save .db or Export SQL to keep it.`);
    return r.id;
  } catch (e) { status(e.message, true); throw e; }
}
async function del(table, id) {
  if (!confirm(`Delete ${table} ${id}?`)) return false;
  try { await api("delete", { table, id }); await loadAll(); status(`Deleted ${table} ${id}`); return true; }
  catch (e) { status(e.message, true); return false; }
}

const npcName = id => (S.npcBy[id] ? S.npcBy[id].Name : id ? "#" + id : "—");
function npcSelect(val, onchange) {
  const s = h("select", { onchange }, h("option", { value: 0 }, "— none —"),
    S.c.npcs.map(n => h("option", { value: n.id }, `${n.Name} (${n.id})`)));
  s.value = val || 0; return s;
}
function enemySelect(val) {
  const s = h("select", {}, h("option", { value: "" }, "— none —"), S.c.enemies.map(e => h("option", { value: e.Name }, e.Name)));
  s.value = val || ""; return s;
}
function itemSelect(val) {
  const s = h("select", {}, S.c.items.map(i => h("option", { value: i.id }, `${i.Name} (${i.id})`)));
  s.value = val; return s;
}
function sprite(path) { return h("img", { class: "sprite", src: assetURL(path), onerror: e => { e.target.style.opacity = .3; } }); }
const field = (lbl, el) => [h("label", {}, lbl), el];
const txt = (v, ph) => h("input", { type: "text", value: v ?? "", placeholder: ph || "" });
const num = v => h("input", { type: "number", class: "num", value: v ?? 0 });
const area = v => h("textarea", { value: v ?? "" });
const parseJSON = (s, d) => { try { return JSON.parse(s || ""); } catch { return d; } };

// ------------------------------------------------------------------ list helper
function listPanel(items, label, selKey, onPick, onNew) {
  const box = h("div", { class: "list" });
  const q = h("input", { type: "search", placeholder: "Filter…" });
  const rows = h("div");
  const draw = () => {
    rows.textContent = "";
    const f = q.value.toLowerCase();
    for (const it of items()) {
      const l = label(it);
      if (f && !l.toLowerCase().includes(f)) continue;
      rows.append(h("div", { class: "row" + (it.id === selKey() ? " sel" : ""), onclick: () => onPick(it) }, ...[].concat(labelNode(it, l))));
    }
  };
  const labelNode = (it, l) => it.Level !== undefined ? [h("span", { class: "lv" }, it.Level), l.replace(/^\d+ /, "")] : [l];
  q.addEventListener("input", draw);
  if (onNew) box.append(h("div", { class: "bar", style: "margin:6px" }, h("button", { class: "primary", onclick: onNew }, "+ New")));
  box.append(q, rows);
  draw();
  return box;
}

// ------------------------------------------------------------------ quests
const STEP_FIELDS = {
  kill: ["Target", "Count"], boss: ["Target"], collect: ["Target", "Count", "Consume"], talk: ["NPC", "Line"],
  reach: ["X", "Y", "Radius"], use: ["Target", "Count"], craft: ["Target", "Count"], equip: ["Target"], level: ["Count"],
};
const STEP_HELP = {
  kill: "Target = enemy name. \"+ also counts\" adds more enemies that count towards the same Count (e.g. Spider and Cave Spider for \"Kill 10 spiders\"); the Text below is what players see",
  boss: "Target = boss enemy name (\"+ also counts\" for more than one)",
  collect: "Target = item name; Consume takes the items at hand-in. \"+ also counts\" adds more items: held amounts add up, Consume takes them in list order",
  talk: "Talk to an NPC; Line is what they say", reach: "Walk within Radius tiles of X,Y",
  use: "Target = action: swing, shield, sprint, potion, mount, spell, build, stat, forge, party, enchant…",
  craft: "Target = item name crafted", equip: "Target = item name or slot", level: "Count = level to reach",
};

// Reach step: a small map around X,Y with the completion radius (the blue
// ring players see in game). Click a tile to move the target there.
const MINI_REDRAW = new Set();
function reachMap(s, onPick) {
  const W = 300, H = 180, sc = 8;
  const cv = h("canvas", { class: "reachmap", width: W, height: H, title: "Click to set the reach target" });
  const info = h("span", { class: "hint" });
  const el = h("div", { class: "reachbox" }, cv, h("div", {}, info, " ", h("a", { href: "#", onclick: ev => { ev.preventDefault(); go(`#map/${s.X || 0},${s.Y || 0}`); } }, "open on map")));
  const draw = () => {
    if (!cv.isConnected && el.dataset.drawn) { MINI_REDRAW.delete(draw); return; }
    el.dataset.drawn = 1;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    g.fillStyle = "#0b0d10"; g.fillRect(0, 0, W, H);
    const cx = +s.X || 0, cy = +s.Y || 0, R = (+s.Radius > 0 ? +s.Radius : 3);
    info.textContent = `Target ${cx},${cy}, radius ${R} tile${R === 1 ? "" : "s"}` + (S.world ? "" : " (loading world…)");
    const px = x => Math.round((x - cx) * sc + W / 2 - sc / 2), py = y => Math.round((y - cy) * sc + H / 2 - sc / 2);
    if (S.world) {
      const hw = Math.ceil(W / sc / 2) + 1, hh = Math.ceil(H / sc / 2) + 1;
      for (let y = cy - hh; y <= cy + hh; y++) for (let x = cx - hw; x <= cx + hw; x++) {
        const t = tile(x, y); if (!t) continue;
        const gp = str(t[2]), fp = str(t[3]);
        imgFor(gp); g.fillStyle = M.colours[gp] || "#3a5"; g.fillRect(px(x), py(y), sc, sc);
        if (fp) { imgFor(fp); if (M.colours[fp]) { g.fillStyle = M.colours[fp]; g.globalAlpha = .7; g.fillRect(px(x), py(y), sc, sc); g.globalAlpha = 1; } }
        if (t[5]) { g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(px(x), py(y), sc, sc); }
      }
      g.fillStyle = "#ffd34d";
      for (const n of S.c.npcs) if (Math.abs(n.SpawnX - cx) <= hw && Math.abs(n.SpawnY - cy) <= hh) g.fillRect(px(n.SpawnX) + 2, py(n.SpawnY) + 2, sc - 4, sc - 4);
    }
    const mx = W / 2, my = H / 2;
    g.fillStyle = "rgba(77,166,255,.22)"; g.beginPath(); g.arc(mx, my, R * sc, 0, 7); g.fill();
    g.strokeStyle = "#4da6ff"; g.lineWidth = 2; g.beginPath(); g.arc(mx, my, R * sc, 0, 7); g.stroke(); g.lineWidth = 1;
    g.strokeStyle = "#fff"; g.strokeRect(px(cx) - .5, py(cy) - .5, sc + 1, sc + 1);
  };
  cv.addEventListener("click", ev => {
    const r = cv.getBoundingClientRect();
    const mx = (ev.clientX - r.left) * (W / r.width), my = (ev.clientY - r.top) * (H / r.height);
    s.X = (+s.X || 0) + Math.floor((mx - W / 2 + sc / 2) / sc);
    s.Y = (+s.Y || 0) + Math.floor((my - H / 2 + sc / 2) / sc);
    onPick(); draw();
  });
  MINI_REDRAW.add(draw);
  if (!S.world) loadWorld().then(() => MINI_REDRAW.forEach(f => f())).catch(e => (info.textContent = "World not loaded: " + e.message));
  setTimeout(draw, 0);
  return { el, draw };
}

// "Also counts": more enemies (kill, boss) or items (collect) towards the
// same step. Stored as Targets, the full list with Target first; Target stays
// the first so older servers still count it. No extras: no Targets key.
function stepExtras(s) {
  const t = String(s.Target || "").trim().toLowerCase(), seen = new Set([t]);
  const raw = Array.isArray(s.Targets) ? s.Targets : (typeof s.Targets === "string" ? [s.Targets] : []);
  return raw.map(x => String(x ?? "").trim()).filter(x => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}
function setStepExtras(s, extras) {
  if (!String(s.Target || "").trim() && extras.length) s.Target = extras.shift();
  if (extras.length) s.Targets = [s.Target, ...extras]; else delete s.Targets;
}
function alsoCounts(s, names, redraw) {
  const extras = stepExtras(s);
  const box = h("span", { class: "also" });
  extras.forEach((n, i) => box.append(h("span", { class: "chip" }, n,
    h("button", { title: "Remove", onclick: () => { extras.splice(i, 1); setStepExtras(s, extras); redraw(); } }, "×"))));
  const taken = new Set([String(s.Target || "").toLowerCase(), ...extras.map(x => x.toLowerCase())]);
  const add = h("select", { class: "also-add" }, h("option", { value: "" }, "+ also counts…"),
    names.filter(n => !taken.has(n.toLowerCase())).map(n => h("option", { value: n }, n)));
  add.onchange = () => { if (add.value) { extras.push(add.value); setStepExtras(s, extras); redraw(); } };
  box.append(add);
  return box;
}

function renderQuests(m) {
  if (!S.c.hasQuestline) {
    m.append(h("div", { class: "form" }, h("h2", {}, "No questline in this database"),
      h("p", {}, "This bq-content.db has no quest_def table, so it has not had the questline migration. Apply it, then open the file again:"),
      h("pre", { class: "sql" }, "cp bq-content.db bq-content.db.bak\nsqlite3 bq-content.db < content/migrations/2026-10-13-questline.sql")));
    return;
  }
  const form = h("div", { class: "form" });
  const pick = q => { S.quest = q; m.replaceChildren(listPanel(() => S.c.quests, q => `${q.Level} ${q.Title}`, () => S.quest && S.quest.id, it => go("#quest/" + it.id), newQ), form); questForm(form, q); };
  const newQ = () => pick({ id: 0, Act: 1, Zone: "", Title: "New quest", Summary: "", Level: 1, MinLevel: 1, Giver: 0, TurnIn: 0,
    Prereqs: "[]", Offer: "", Accept: "", Progress: "", Complete: "", XP: 100, Gold: 10, Rewards: "[]", Sequential: 0,
    Steps: JSON.stringify([{ Type: "kill", Target: "", Count: 1, Text: "" }]) });
  pick(S.quest ? (S.c.quests.find(q => q.id === S.quest.id) || S.c.quests[0]) : S.c.quests[0] || null);
  if (!S.c.quests.length) newQ();
}

function questForm(form, q) {
  form.textContent = "";
  if (!q) return;
  // A saved quest's dialogue (every line, answer and conversation of it) is
  // edited in place by the Quest Studio view embedded below and saved as you
  // go; Save here keeps those columns as they are stored.
  const saved = !!q.id && S.c.quests.some(x => x.id === q.id);
  if (q.id) syncHash("#quest/" + q.id);
  const f = {
    Title: txt(q.Title), Act: num(q.Act), Zone: txt(q.Zone), Level: num(q.Level), MinLevel: num(q.MinLevel),
    Giver: npcSelect(q.Giver), TurnIn: npcSelect(q.TurnIn), Summary: area(q.Summary),
    Offer: area(q.Offer), Accept: area(q.Accept), Progress: area(q.Progress), Complete: area(q.Complete),
    XP: num(q.XP), Gold: num(q.Gold),
    Sequential: h("input", { type: "checkbox", id: "q-sequential" }),
    Daily: "Daily" in q ? h("input", { type: "checkbox", id: "q-daily" }) : null,
  };
  if (f.Daily) f.Daily.checked = !!+q.Daily;
  f.Sequential.checked = !!+q.Sequential;
  for (const k of ["Offer", "Accept", "Progress", "Complete", "Summary"]) f[k].id = "qline-" + k;
  for (const k of QUEST_LINES) f[k].addEventListener("input", () => { if (conv) conv.refresh(); });
  const prereqs = new Set(parseJSON(q.Prereqs, []));
  const preBox = h("div");
  const drawPre = () => {
    preBox.textContent = "";
    for (const id of prereqs) {
      const pq = S.c.quests.find(x => x.id === id);
      preBox.append(h("div", {}, `${id} · ${pq ? pq.Title : "(missing)"} `, h("button", { onclick: () => { prereqs.delete(id); drawPre(); } }, "×")));
    }
    const add = h("select", {}, h("option", { value: "" }, "+ add prerequisite…"),
      S.c.quests.filter(x => x.id !== q.id && !prereqs.has(x.id)).map(x => h("option", { value: x.id }, `${x.Level} · ${x.Title}`)));
    add.onchange = () => { if (add.value) { prereqs.add(+add.value); drawPre(); } };
    preBox.append(add);
  };
  drawPre();

  const steps = parseJSON(q.Steps, []);
  const stepBox = h("div", { class: "steps" });
  const drawSteps = () => {
    stepBox.textContent = "";
    steps.forEach((s, i) => {
      const type = h("select", { onchange: () => { if ((s.Type === "collect") !== (type.value === "collect")) delete s.Targets; s.Type = type.value; drawSteps(); } }, Object.keys(STEP_FIELDS).map(t => h("option", { value: t }, t)));
      type.value = s.Type;
      const top = h("div", { class: "top" }, h("b", {}, `${i + 1}.`), type);
      const inputs = {};
      let mini = null;
      for (const k of STEP_FIELDS[s.Type] || []) {
        let el;
        if (k === "NPC") { el = npcSelect(s.NPC, () => (s.NPC = +el.value)); }
        else if (k === "Consume") { el = h("input", { type: "checkbox", onchange: () => (s.Consume = el.checked) }); el.checked = !!s.Consume; }
        else if (k === "Target" && (s.Type === "kill" || s.Type === "boss")) { el = enemySelect(s.Target); el.onchange = () => { const ex = stepExtras(s); s.Target = el.value; setStepExtras(s, ex.filter(x => x.toLowerCase() !== el.value.toLowerCase())); drawSteps(); }; }
        else if (k === "Target" && s.Type === "collect") { el = txt(s.Target); el.setAttribute("list", "bq-item-names"); el.onchange = () => { const ex = stepExtras(s); s.Target = el.value; setStepExtras(s, ex.filter(x => x.toLowerCase() !== el.value.trim().toLowerCase())); drawSteps(); }; el.oninput = () => (s.Target = el.value); }
        else if (k === "Target") { el = txt(s.Target); el.oninput = () => (s.Target = el.value); }
        else if (k === "Line" && saved) { el = h("a", { href: "#", class: "hint", onclick: ev => { ev.preventDefault(); highlight("qline-step-" + i); } }, s.Tree ? "a conversation: edit it in the dialogue above" : "edit it in the dialogue above"); }
        else if (k === "Line") { el = txt(s.Line || "", "What the NPC says"); el.classList.add("qline-in"); el.dataset.step = i; el.oninput = () => { s.Line = el.value; if (conv) conv.refresh(); }; }
        else { el = num(s[k]); el.oninput = () => { s[k] = +el.value; if (mini) mini.draw(); }; }
        inputs[k] = el;
        top.append(h("span", { class: "hint" }, k), el);
        if (k === "Target" && (s.Type === "kill" || s.Type === "boss")) top.append(alsoCounts(s, S.c.enemies.map(e => e.Name), drawSteps));
        if (k === "Target" && s.Type === "collect") top.append(alsoCounts(s, S.c.items.map(i => i.Name), drawSteps));
      }
      if (!["kill", "boss", "collect"].includes(s.Type)) delete s.Targets;
      top.append(h("span", { style: "flex:1" }),
        h("button", { onclick: () => { if (i) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; drawSteps(); } } }, "↑"),
        h("button", { onclick: () => { steps.splice(i, 1); drawSteps(); } }, "×"));
      const text = txt(s.Text, "Objective shown in the tracker"); text.style.width = "100%"; text.oninput = () => (s.Text = text.value);
      const hint = txt(s.Hint, "Hint (optional, shown in the quest log)"); hint.style.width = "100%"; hint.oninput = () => (s.Hint = hint.value);
      if (s.Type === "reach") mini = reachMap(s, () => { inputs.X.value = s.X; inputs.Y.value = s.Y; });
      stepBox.append(h("div", { class: "step", id: "qstep-" + i }, top, h("div", { class: "hint" }, STEP_HELP[s.Type] || ""), mini ? mini.el : "", text, hint));
    });
    stepBox.append(h("button", { onclick: () => { steps.push({ Type: "kill", Target: "", Count: 1, Text: "" }); drawSteps(); } }, "+ Step"));
    if (!document.getElementById("bq-item-names")) document.body.append(h("datalist", { id: "bq-item-names" }, S.c.items.map(i => h("option", { value: i.Name }))));
    if (conv) conv.refresh();
  };
  let conv = null;
  drawSteps();

  const rewards = parseJSON(q.Rewards, []);
  const rwBox = h("div", { class: "rewards" });
  const drawRw = () => {
    rwBox.textContent = "";
    rewards.forEach((r, i) => {
      const it = itemSelect(r.ItemID); it.onchange = () => (r.ItemID = +it.value);
      const am = num(r.Amount); am.oninput = () => (r.Amount = +am.value);
      rwBox.append(h("div", { class: "rw" }, it, "×", am, h("button", { onclick: () => { rewards.splice(i, 1); drawRw(); } }, "×")));
    });
    rwBox.append(h("button", { onclick: () => { rewards.push({ ItemID: S.c.items[0].id, Amount: 1 }); drawRw(); } }, "+ Item reward"));
  };
  drawRw();

  // dialogue columns as stored (edited live above), talk steps' lines too
  const dlg = () => {
    const st = saved && S.c.quests.find(x => x.id === q.id);
    if (!st) return { Offer: f.Offer.value, Accept: f.Accept.value, Progress: f.Progress.value, Complete: f.Complete.value, Steps: JSON.stringify(steps) };
    const ss = parseJSON(st.Steps, []);
    const merged = steps.map((s, i) => {
      if (s.Type !== "talk") return s;
      const o = ss[i] && ss[i].Type === "talk" && ss[i].NPC === s.NPC ? ss[i] : null;
      const m = { ...s }; delete m.Line; delete m.Reply; delete m.Tree;
      if (o) for (const k of ["Line", "Reply", "Tree"]) { if (o[k] != null && o[k] !== "") m[k] = o[k]; }
      else if (s.Line != null) m.Line = s.Line;
      return m;
    });
    return { Offer: st.Offer, Accept: st.Accept, Progress: st.Progress, Complete: st.Complete, Steps: JSON.stringify(merged) };
  };
  const collect = () => ({
    id: q.id, Act: +f.Act.value, Zone: f.Zone.value, Title: f.Title.value, Summary: f.Summary.value, Level: +f.Level.value,
    MinLevel: +f.MinLevel.value, Giver: +f.Giver.value, TurnIn: +f.TurnIn.value, Prereqs: JSON.stringify([...prereqs]),
    XP: +f.XP.value, Gold: +f.Gold.value, Rewards: JSON.stringify(rewards), ...dlg(),
    Sequential: f.Sequential.checked ? 1 : 0,
    ...(f.Daily ? { Daily: f.Daily.checked ? 1 : 0 } : {}),
  });
  form.append(
    h("h2", {}, q.id ? `Quest ${q.id}` : "New quest"),
    q.id ? questLinks(q) : null,
    h("div", { class: "grid" },
      field("Title", f.Title), field("Act / Zone", h("div", {}, f.Act, " ", f.Zone)),
      field("Level / min", h("div", {}, f.Level, " min level ", f.MinLevel)),
      field("Giver", f.Giver), field("Turn in to", f.TurnIn), field("Prerequisites", preBox),
      field("Summary", f.Summary),
      saved ? null : [field("Offer", f.Offer), field("Accept", f.Accept), field("In progress", f.Progress), field("Complete", f.Complete)],
      field("XP / Gold", h("div", {}, f.XP, " XP  ", f.Gold, " gold"))),
    h("p", { class: "hint" }, "Text can use {SHIELD}, {INTERACT}, {MOUNTS}, {CHARACTER} for the player's keys."),
    saved ? questDialogueEmbed(q) : q.id ? (conv = questConversation(q, f, steps, stepBox)) : h("p", { class: "hint" }, "Save the quest to write its conversations: greeting, offer and answers, talk objectives, hand-in."),
    h("h3", {}, "Steps"),
    h("label", { class: "chk", title: "Off: every objective counts at once (kill 3 Spiders and kill 3 Cave Spiders fill together). On: one objective at a time, in order: only the current one counts." },
      f.Sequential, " Complete objectives in order"),
    f.Daily ? h("label", { class: "chk", title: "A daily: a new variant at every 21:00 reset, from its pool of mobs, items, counts and places. Edit the pool in Quest Studio." },
      f.Daily, " Daily quest ", q.id ? h("a", { href: "#studio/journey/" + q.id }, "(pool and roll preview in Quest Studio)") : null) : null,
    h("p", { class: "hint" }, "Unticked (the default): players can work on every objective at once; the quest is ready when all are done."),
    stepBox,
    h("h3", {}, "Item rewards"), rwBox,
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => { const id = await save("quest_def", collect()); S.quest = { id }; renderTab(); } }, "Save"),
      h("button", { onclick: () => { const c = collect(); c.id = 0; c.Title += " (copy)"; S.quest = c; questForm(form, c); } }, "Duplicate"),
      q.id ? h("button", { class: "danger", onclick: async () => { if (await del("quest_def", q.id)) { S.quest = null; renderTab(); } } }, "Delete") : null));
}

// ------------------------------------------------------------------ NPCs & dialogue
function reachable(root) {
  const out = [], seen = new Set(), queue = [root];
  while (queue.length) {
    const id = queue.shift();
    if (!id || id === "1" || seen.has(id)) continue;
    seen.add(id);
    const c = S.convBy[id];
    out.push(c || { Identifier: id, missing: true });
    if (c) for (const [, next] of parseOptions(c.Options)) if (!String(next).startsWith("@")) queue.push(next); // @accept, @menu... are actions, not nodes
  }
  return out;
}
function parseOptions(raw) {
  const out = []; const re = /\[\s*['"](.*?)['"]\s*,\s*['"]([^'"]*)['"]\s*\]/g; let m;
  while ((m = re.exec(raw || ""))) out.push([m[1], m[2]]);
  return out;
}
function formatOptions(opts) {
  return "[" + opts.map(([l, n]) => `['${l.replace(/'(?=\s*,)/g, "’").replace(/\[|\]/g, "")}','${n}']`).join(",") + "]";
}

function renderNPCs(m) {
  const form = h("div", { class: "form" });
  const pick = n => { S.npc = n; m.replaceChildren(listPanel(() => S.c.npcs, n => `${n.Name} (${n.SpawnX}, ${n.SpawnY})`, () => S.npc && S.npc.id, it => go("#npc/" + it.id), newN), form); npcForm(form, n); };
  const newN = () => pick({ id: 0, Name: "New NPC", ImgPath: "assets/npc/Person.png", Faction: "", Conversation: "", SpawnX: 0, SpawnY: 0 });
  pick(S.npc ? (S.c.npcs.find(n => n.id === S.npc.id) || S.c.npcs[0]) : S.c.npcs[0]);
}

function npcForm(form, n) {
  form.textContent = "";
  if (!n) return;
  if (n.id) syncHash("#npc/" + n.id);
  const f = { Name: txt(n.Name), ImgPath: txt(n.ImgPath), Faction: txt(n.Faction), Conversation: txt(n.Conversation), SpawnX: num(n.SpawnX), SpawnY: num(n.SpawnY) };
  const img = sprite(n.ImgPath);
  f.ImgPath.oninput = () => (img.src = assetURL(f.ImgPath.value));
  const pickImg = () => openPicker({ title: `Sprite for ${f.Name.value || "this NPC"}`, groups: npcSpriteGroups, recentKey: "npc", value: f.ImgPath.value,
    onPick: v => { if (v) { f.ImgPath.value = v; img.src = assetURL(v); } } });
  img.addEventListener("click", pickImg); img.style.cursor = "pointer"; img.title = "Pick a sprite";
  const collect = () => ({ id: n.id, Name: f.Name.value, ImgPath: f.ImgPath.value, Faction: f.Faction.value, Conversation: f.Conversation.value, SpawnX: +f.SpawnX.value, SpawnY: +f.SpawnY.value });
  form.append(h("h2", {}, n.id ? `${n.Name} (${n.id})` : "New NPC"),
    h("div", { class: "grid" },
      field("Name", f.Name), field("Sprite", h("div", {}, img, " ", f.ImgPath, " ", h("button", { onclick: pickImg }, "Pick…"))), field("Faction", f.Faction),
      field("Greeting node", f.Conversation), field("Position", h("div", {}, "X ", f.SpawnX, "  Y ", f.SpawnY, " ",
        link(`#map/${n.SpawnX},${n.SpawnY}`, "Show on map", "btnlink")))),
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => {
        const row = collect(), old = n.ImgPath || "";
        const id = await save("npc", row); S.npc = { id };
        // Nodes holding the old sprite were copies (older editors saved the NPC
        // sprite into every node): clear them so the portrait follows.
        if (n.id && old && old !== row.ImgPath) {
          const ids = treeNodes(row.Conversation).filter(c => c.ImgPath === old).map(c => c.id);
          if (ids.length) { await api("portraits", { ids, from: old }); await loadAll(); status(`Saved NPC ${id}; ${ids.length} dialogue node(s) that copied the old sprite now use the NPC sprite.`); }
        }
        renderTab();
      } }, "Save NPC"),
      n.id ? h("button", { class: "danger", onclick: async () => { if (await del("npc", n.id)) { S.npc = null; renderTab(); } } }, "Delete NPC") : null));
  if (!n.id) return;

  form.append(npcQuestPanel(n));

  form.append(h("h3", {}, "Dialogue tree (free chat when no quest is waiting)"),
    h("p", { class: "hint" }, "Each node is a line and its answers. An answer points to another node, or to 1 to end. Quest offers and hand-ins are added to the menu automatically."));
  const nodes = n.Conversation ? reachable(n.Conversation) : [];
  if (nodes.length) form.append(h("div", { class: "jump" }, "Nodes: ", nodes.filter(c => !c.missing).map(c => [link("#dialog/" + c.Identifier, c.Identifier), " "])));
  const overrides = nodes.filter(c => !c.missing && hasPortrait(c));
  if (overrides.length) form.append(h("div", { class: "panel", id: "portrait-overrides" },
    h("b", {}, `${overrides.length} node(s) override the portrait`), " ",
    h("span", { class: "hint" }, "the game shows a node's own portrait instead of the NPC sprite: ", overrides.map(c => `${c.Identifier} (${spriteLabel(c.ImgPath)})`).join(", "), ". "),
    h("button", { onclick: async () => { await api("portraits", { ids: overrides.map(c => c.id) }); await loadAll(); status(`${overrides.length} node(s) now use ${n.Name}'s sprite. Save .db or Export SQL to keep it.`); renderTab(); } }, "Use the NPC sprite on all")));
  for (const c of nodes) form.append(nodeEditor(c, c.Identifier === n.Conversation, n));
  const prefix = (n.Conversation || "npc-" + n.id).replace(/-\d+$/, "");
  form.append(h("div", { class: "bar" }, h("button", { onclick: () => {
    let i = 1; while (S.convBy[`${prefix}-${i}`]) i++;
    const id = `${prefix}-${i}`;
    form.append(nodeEditor({ id: 0, Identifier: id, Title: "", ImgPath: "", Options: "[['Goodbye.','1']]", ItemsGiven: "", ReputationChange: "", QuestStart: 0 }, false, n));
  } }, "+ New node"), !n.Conversation ? h("span", { class: "hint" }, "Create a node, then set it as the greeting node above.") : null));
}

const hasPortrait = c => !!c.ImgPath && c.ImgPath !== "None";
// Nodes reachable from a greeting node (empty list for none).
const treeNodes = root => (root ? reachable(root).filter(c => !c.missing) : []);
function nodeEditor(c, isRoot, n) {
  if (c.missing) return h("div", { class: "node err" }, `Missing node ${c.Identifier}`);
  const ident = txt(c.Identifier); ident.style.width = "260px";
  const title = area(c.Title);
  const given = txt(c.ItemsGiven, '[{"ItemID":9,"Amount":1}]  (optional gift)'); given.style.width = "100%";
  const opts = parseOptions(c.Options);
  const optBox = h("div", { class: "opts" });
  const ids = S.c.conversations.map(x => x.Identifier);
  const drawOpts = () => {
    optBox.textContent = "";
    opts.forEach((o, i) => {
      const l = txt(o[0]); l.style.flex = "1"; l.oninput = () => (o[0] = l.value);
      const nx = h("input", { type: "text", list: "convIds", value: o[1], size: 18 }); nx.oninput = () => (o[1] = nx.value);
      optBox.append(h("div", { class: "opt" }, "→", l, nx, h("button", { onclick: () => { opts.splice(i, 1); drawOpts(); } }, "×")));
    });
    optBox.append(h("button", { onclick: () => { opts.push(["Goodbye.", "1"]); drawOpts(); } }, "+ Answer"));
  };
  drawOpts();
  let dl = $("#convIds");
  if (!dl) { dl = h("datalist", { id: "convIds" }); document.body.append(dl); }
  dl.replaceChildren(h("option", { value: "1" }, "end"), ...ids.map(i => h("option", { value: i })));
  // Portrait: blank = the speaking NPC's sprite (follows it); set = this node's own override.
  let portrait = hasPortrait(c) ? c.ImgPath : "";
  const pBox = h("div", { class: "portrait" });
  const drawPortrait = () => {
    const npcImg = n.ImgPath || "";
    pBox.replaceChildren(h("span", { class: "hint" }, "Portrait: "), sprite(portrait || npcImg || "assets/npc/Person.png"), " ",
      portrait ? h("span", { class: "povr" }, "override ", h("code", {}, portrait), portrait === npcImg ? h("span", { class: "hint" }, " (same as the NPC sprite: use the NPC sprite so it follows changes)") : null)
        : h("span", { class: "hint" }, npcImg ? `NPC sprite (${spriteLabel(npcImg)}), follows it` : "the speaking NPC's sprite"),
      " ", h("button", { onclick: () => openPicker({ title: `Portrait override for ${c.Identifier}`, groups: npcSpriteGroups, recentKey: "npc", value: portrait || npcImg, onPick: v => { if (v) { portrait = v; drawPortrait(); } } }) }, portrait ? "Change override…" : "Override…"),
      portrait ? h("button", { class: "use-npc", onclick: () => { portrait = ""; drawPortrait(); } }, "Use NPC sprite") : null,
      portrait !== (hasPortrait(c) ? c.ImgPath : "") ? h("span", { class: "dirtyflag on" }, "unsaved: Save node") : null);
  };
  drawPortrait();
  const owners = nodeOwners(c.Identifier);
  const ownerQuests = S.c.quests.filter(q => owners.some(o => q.Giver === o.id || q.TurnIn === o.id));
  return h("div", { class: "node" + (isRoot ? " root" : ""), id: "node-" + c.Identifier },
    h("div", {}, h("span", { class: "id" }, isRoot ? "greeting · " : ""), ident),
    h("div", { class: "hint" }, "Spoken by: ", owners.length ? owners.map(o => [link("#npc/" + o.id, o.Name), " "]) : "no NPC (unreachable)",
      ownerQuests.length ? [" · their quests: ", ownerQuests.map(q => [link("#quest/" + q.id, q.Title), " "])] : null),
    pBox, title, optBox, given,
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => {
        const row = { id: c.id, Identifier: ident.value.trim(), Title: title.value, ImgPath: portrait, Options: formatOptions(opts),
          ItemsGiven: given.value, ReputationChange: c.ReputationChange || "", QuestStart: c.QuestStart || 0 };
        await save("conversation", row); renderTab();
      } }, "Save node"),
      c.id ? h("button", { class: "danger", onclick: async () => { if (await del("conversation", c.id)) renderTab(); } }, "Delete") : null));
}

// ------------------------------------------------------------------ export
async function renderExport(m) {
  const r = await api("export");
  const pre = h("pre", { class: "sql" }, r.sql);
  m.append(h("div", { class: "form" },
    h("h2", {}, "Export changes as a SQL migration"),
    h("p", { class: "hint" }, "Every save is recorded here as the exact SQL that was run on this file. Save it as content/migrations/<date>-<name>.sql and apply it to other copies of bq-content.db with sqlite3. Or just use Save .db to download the whole edited database."),
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: () => {
        download(new Blob([r.sql], { type: "text/plain" }), `${new Date().toISOString().slice(0, 10)}-editor.sql`);
      } }, "Download .sql"),
      h("button", { onclick: async () => { if (confirm("Clear the change list? (The edits stay in the database.)")) { await api("export", {}); renderTab(); } } }, "Start fresh"),
      h("button", { onclick: saveDb }, "Save .db")),
    pre));
}

// ------------------------------------------------------------------ sprite picker
// A searchable grid of thumbnails from the editor's sprites (bundled, local
// folder or URL; see the Sprites tab). groups() gives [{id, label, entries}],
// each entry {value, img?, label?, note?}. Picking calls onPick(value).
const RECENT_MAX = 14;
function recentGet(key) { try { return JSON.parse(localStorage.getItem("bqRecent-" + key) || "[]"); } catch { return []; } }
function recentPush(key, v) { const r = recentGet(key).filter(x => x !== v); r.unshift(v); localStorage.setItem("bqRecent-" + key, JSON.stringify(r.slice(0, RECENT_MAX))); }
const spriteLabel = p => String(p || "").split("/").pop().replace(/\.png$/i, "");
function spritePicker(o) {
  let group = o.group || (o.groups()[0] || {}).id, filter = "";
  const box = h("div", { class: "picker" });
  const q = h("input", { type: "search", class: "picker-q", placeholder: o.placeholder || "Search sprites by name…" });
  const chips = h("div", { class: "picker-chips" }), recent = h("div", { class: "picker-recent" }), grid = h("div", { class: "picker-grid" });
  if (o.height) grid.style.maxHeight = o.height;
  const cell = (e, small) => {
    const c = h("button", { type: "button", class: "pcell" + (e.value === box.value ? " sel" : "") + (small ? " small" : ""), title: e.value || o.noneLabel || "none",
      onclick: () => pick(e.value) },
      e.img === null ? h("span", { class: "pnone" }, "×") : h("img", { src: e.raw ? e.img : assetURL(e.img || e.value), loading: "lazy", alt: "", class: e.anim ? "anim" : "", style: e.anim ? `--n:${e.anim}` : "", onerror: ev => { ev.target.classList.add("missing"); } }),
      h("span", { class: "plabel" }, e.label || spriteLabel(e.value)), e.note ? h("span", { class: "pnote" }, e.note) : null);
    c.dataset.value = e.value;
    return c;
  };
  const draw = () => {
    const groups = o.groups(), byVal = new Map();
    for (const g of groups) for (const e of g.entries) if (!byVal.has(e.value)) byVal.set(e.value, e);
    chips.replaceChildren(...groups.map(g => h("button", { type: "button", class: g.id === group ? "on" : "", onclick: () => { group = g.id; draw(); } }, `${g.label} (${g.entries.length})`)));
    const rec = recentGet(o.recentKey).filter(v => byVal.has(v));
    recent.replaceChildren(...(rec.length ? [h("span", { class: "plabel" }, "Recent:"), ...rec.map(v => cell(byVal.get(v), true))] : []));
    const f = filter.trim().toLowerCase();
    let list = f ? [...byVal.values()].filter(e => (e.value + " " + (e.label || "")).toLowerCase().includes(f))
      : (groups.find(g => g.id === group) || groups[0] || { entries: [] }).entries;
    const cells = o.allowNone && !f ? [cell({ value: "", img: null, label: o.noneLabel || "None" })] : [];
    for (const e of list.slice(0, 500)) cells.push(cell(e));
    grid.replaceChildren(...cells);
    if (list.length > 500) grid.append(h("div", { class: "hint wide" }, `${list.length - 500} more. Type to narrow it down.`));
    if (!cells.length) grid.append(h("div", { class: "hint wide" }, "No sprites match."));
  };
  const pick = v => { box.value = v; if (v) recentPush(o.recentKey, v); draw(); o.onPick(v); };
  q.addEventListener("input", () => { filter = q.value; draw(); });
  box.value = o.value;
  box.setValue = v => { box.value = v; draw(); };
  box.setGroups = (groups, g) => { o.groups = groups; group = g || (groups()[0] || {}).id; draw(); };
  box.append(q, chips, recent, grid);
  draw();
  return box;
}
function openPicker(o) {
  const close = () => { ov.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const p = spritePicker({ ...o, height: "calc(85vh - 190px)", onPick: v => { close(); o.onPick(v); } });
  const ov = h("div", { class: "modal", onclick: e => { if (e.target === ov) close(); } },
    h("div", { class: "modal-box" }, h("div", { class: "modal-head" }, h("b", {}, o.title || "Pick a sprite"), h("button", { onclick: close }, "Close (Esc)")), p));
  document.body.append(ov); document.addEventListener("keydown", esc, true);
  p.querySelector("input").focus();
}
const folderEntries = (...prefixes) => assetPaths().filter(p => prefixes.some(f => p.startsWith(f))).map(v => ({ value: v }));
function usageCounts() {
  if (!M.usage) {
    const g = new Map(), f = new Map();
    for (const t of S.world.tiles.values()) {
      const a = str(t[2]), b = str(t[3]);
      if (a) g.set(a, (g.get(a) || 0) + 1);
      if (b) f.set(b, (f.get(b) || 0) + 1);
    }
    M.usage = { ground: g, fore: f };
  }
  return M.usage;
}
function worldGroups(layer) {
  return () => {
    const used = [...usageCounts()[layer]].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ value: v, note: c + " tiles" }));
    const g = [{ id: "used", label: layer === "ground" ? "On the map" : "On the map", entries: used }];
    if (layer === "ground") g.push({ id: "grounds", label: "Grounds", entries: folderEntries("assets/world/grounds/") },
      { id: "water", label: "Water", entries: folderEntries("assets/world/water/") });
    else g.push({ id: "objects", label: "Objects", entries: folderEntries("assets/world/objects/") },
      { id: "doors", label: "Doors & walls", entries: folderEntries("assets/world/doors/", "assets/world/walls/") },
      { id: "water", label: "Water", entries: folderEntries("assets/world/water/") });
    g.push({ id: "all", label: "All world art", entries: folderEntries("assets/world/") });
    return g;
  };
}
const enemyGroups = () => [{ id: "enemies", label: "Enemies", entries: S.c.enemies.map(e => ({ value: e.Name, img: e.Image || "assets/error.png", label: e.Name, note: `HP ${e.HP} · XP ${e.XP}` })) }];
const npcSpriteGroups = () => {
  const used = [...new Set(S.c.npcs.map(n => n.ImgPath).filter(Boolean))].sort().map(v => ({ value: v, note: S.c.npcs.filter(n => n.ImgPath === v).length + " NPCs" }));
  return [{ id: "npc", label: "NPC art", entries: folderEntries("assets/npc/") }, { id: "used", label: "Used by NPCs", entries: used },
    { id: "monsters", label: "Monsters", entries: folderEntries("assets/monsters/") }, { id: "player", label: "Player", entries: folderEntries("assets/player/base/", "assets/player/gen/") }];
};
const itemSpriteGroups = () => [{ id: "items", label: "Items", entries: folderEntries("assets/items/") }, { id: "gear", label: "Gear", entries: folderEntries("assets/player/gear/") },
  { id: "spells", label: "Spells", entries: folderEntries("assets/player/spells/", "assets/items/spells/") }, { id: "world", label: "World objects", entries: folderEntries("assets/world/objects/") },
  { id: "all", label: "Everything", entries: assetPaths().map(v => ({ value: v })) }];

// ------------------------------------------------------------------ map
const M = { scale: 12, cx: 0, cy: 0, tool: "select", drag: null, pending: new Map(), imgs: {}, colours: {}, failed: {}, sel: null, hover: null, raf: 0,
  brush: { ground: null, fore: undefined, flip: false, coll: "", area: null, size: 1, target: "ground" }, showColl: false, showAreas: false };

function imgFor(path) {
  if (!path) return null;
  let i = M.imgs[path];
  if (!i) {
    i = M.imgs[path] = new Image();
    i.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 1;
        const x = c.getContext("2d"); x.drawImage(i, 0, 0, 1, 1);
        const d = x.getImageData(0, 0, 1, 1).data; M.colours[path] = `rgb(${d[0]},${d[1]},${d[2]})`;
      } catch { M.colours[path] = "#777"; } // a URL without CORS: no colour, still drawable
      drawMap();
      MINI_REDRAW.forEach(f => f());
    };
    i.onerror = () => { M.failed[path] = true; drawMap(); };
    if (ASSETS.mode === "url") i.crossOrigin = "anonymous";
    i.src = assetURL(path);
  }
  return i.complete && i.naturalWidth ? i : null;
}

function renderMap(m) {
  const cv = h("canvas", { id: "map", tabindex: 0 });
  const wrap = h("div", { class: "mapwrap" }, cv);
  const side = h("div", { class: "side" + (M.tool === "paint" || M.tool === "spawn" ? " wide" : "") });
  m.append(wrap, side);
  M.cv = cv; M.side = side; M.usage = null;
  if (S.focus) { M.cx = S.focus.x; M.cy = S.focus.y; M.scale = 24; S.focus = null; }
  if (M.ro) M.ro.disconnect();
  M.ro = new ResizeObserver(() => { cv.width = wrap.clientWidth; cv.height = wrap.clientHeight; drawMapNow(); });
  M.ro.observe(wrap);
  cv.addEventListener("wheel", e => { e.preventDefault(); M.scale = Math.max(2, Math.min(48, M.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); drawMap(); }, { passive: false });
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("mousedown", mapDown);
  mapTouch(cv);
  cv.addEventListener("mouseleave", () => { if (!M.drag) { M.hover = null; drawMap(); } });
  window.onmousemove = mapMove; window.onmouseup = mapUp;
  drawSide();
}

const toTile = e => { const r = M.cv.getBoundingClientRect(); return { x: Math.floor((e.clientX - r.left - M.cv.width / 2) / M.scale + M.cx), y: Math.floor((e.clientY - r.top - M.cv.height / 2) / M.scale + M.cy) }; };
const toFrac = e => { const r = M.cv.getBoundingClientRect(); return { x: (e.clientX - r.left - M.cv.width / 2) / M.scale + M.cx, y: (e.clientY - r.top - M.cv.height / 2) / M.scale + M.cy }; };
const tile = (x, y) => S.world.tiles.get(x + "," + y);
const str = i => S.world.strings[i] || "";
// NPC placements (npc_spawn, docs/NPC_SPAWNS.md in the API): every place an
// NPC stands. One without rows there stands at its own SpawnX/SpawnY (a
// "legacy" placement, id 0); -999 is nowhere.
function spawnsOf(n) {
  const l = (S.spawnBy && S.spawnBy[n.id]) || [];
  if (l.length) return l;
  return n.SpawnX > -999 ? [{ id: 0, NPC: n.id, X: n.SpawnX, Y: n.SpawnY, legacy: true }] : [];
}
const placements = () => S.c.npcs.flatMap(n => spawnsOf(n).map(sp => ({ n, sp })));
function placementAt(x, y) { return placements().find(p => p.sp.X === x && p.sp.Y === y) || null; }
function npcAt(x, y) { const p = placementAt(x, y); return p ? p.n : undefined; }
// Move one placement (a legacy one moves the NPC's own SpawnX/SpawnY).
async function movePlacement(n, sp, x, y) {
  if (sp.id) await save("npc_spawn", { id: sp.id, NPC: n.id, X: x, Y: y });
  else await save("npc", { id: n.id, SpawnX: x, SpawnY: y });
}
async function addPlacement(n, x, y) {
  await api("spawnsEnable");
  return save("npc_spawn", { id: 0, NPC: n.id, X: x, Y: y });
}
async function removePlacement(n, sp) {
  const all = spawnsOf(n);
  const msg = all.length > 1 ? `Remove ${n.Name} from ${sp.X}, ${sp.Y}? They still stand in ${all.length - 1} other place${all.length > 2 ? "s" : ""}.`
    : `Remove ${n.Name} from ${sp.X}, ${sp.Y}? It's their only place, so they won't be in the world (the NPC, their words and quests stay; place them again any time).`;
  if (!confirm(msg)) return false;
  try {
    if (sp.id) await api("delete", { table: "npc_spawn", id: sp.id });
    else await api("save", { table: "npc", row: { id: n.id, SpawnX: -999, SpawnY: -999 } });
    await loadAll(); status(`Removed a placement of ${n.Name}`); return true;
  } catch (e) { status(e.message, true); return false; }
}
// ---- NPCs tool: place an NPC (one you have, or a new one) where you tap,
// drag a placement to move it, remove it from the panel. One NPC can stand
// in many places; each is a row in npc_spawn.
function npcToolDown(e, t) {
  const p = placementAt(t.x, t.y);
  if (p) {
    M.npcSel = { npc: p.n.id, x: p.sp.X, y: p.sp.Y };
    M.drag = { npc: p.n, sp: p.sp, from: t };
    drawSide(); drawMap(); return;
  }
  // Empty ground: a drag pans, a tap (released where it went down) places.
  M.drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: M.cx, cy: M.cy, tap: t };
}
function npcArmed() {
  if (M.npcMode === "new") return !!(M.npcNew && M.npcNew.Name.trim());
  return !!(M.npcPick && S.npcBy[M.npcPick]);
}
async function npcToolTap(t) {
  if (!npcArmed()) {
    if (M.npcSel) { M.npcSel = null; drawSide(); drawMap(); }
    status(M.npcMode === "new" ? "Give the new NPC a name first, then tap the map." : "Pick an NPC in the panel first, then tap the map.", true);
    return;
  }
  if (placementAt(t.x, t.y)) return;
  try {
    let n;
    if (M.npcMode === "new") {
      await api("spawnsEnable");
      const nn = M.npcNew;
      const id = await save("npc", { id: 0, Name: nn.Name.trim(), ImgPath: nn.ImgPath, Faction: nn.Faction || "", Conversation: "", SpawnX: t.x, SpawnY: t.y });
      n = S.npcBy[id];
      M.npcMode = "existing"; M.npcPick = id; M.npcNew = { Name: "", ImgPath: nn.ImgPath, Faction: "" };
      status(`${n.Name} is in the world at ${t.x}, ${t.y}. Tap again to put them somewhere else too.`);
    } else {
      n = S.npcBy[M.npcPick];
      await addPlacement(n, t.x, t.y);
      status(`${n.Name} now stands at ${t.x}, ${t.y} (${spawnsOf(S.npcBy[n.id]).length} places).`);
    }
    M.npcSel = { npc: n.id, x: t.x, y: t.y };
  } catch (err) { status(err.message, true); }
  drawSide(); drawMap();
}
function npcToolDraw(g, px, py, sc) {
  if (M.npcSel) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(px(M.npcSel.x) - 2, py(M.npcSel.y) - 2, sc + 4, sc + 4); g.lineWidth = 1; }
  const pick = M.npcMode === "existing" && S.npcBy[M.npcPick];
  if (pick) { // the other places the picked NPC stands: a ring each
    g.strokeStyle = "#fff"; g.setLineDash([3, 3]);
    for (const sp of spawnsOf(pick)) g.strokeRect(px(sp.X) - 4, py(sp.Y) - 4, sc + 8, sc + 8);
    g.setLineDash([]);
  }
  if (M.hover && npcArmed() && !M.drag) {
    const img = imgFor(M.npcMode === "new" ? M.npcNew.ImgPath : pick && pick.ImgPath);
    g.globalAlpha = .6; if (img) g.drawImage(img, px(M.hover.x), py(M.hover.y), sc, sc); g.globalAlpha = 1;
  }
}
function npcSide(s) {
  M.npcMode = M.npcMode || "existing";
  M.npcNew = M.npcNew || { Name: "", ImgPath: "assets/npc/Person.png", Faction: "" };
  s.append(h("h3", {}, "NPCs"),
    seg([["existing", "Someone you have"], ["new", "A new NPC"]], M.npcMode, v => { M.npcMode = v; drawSide(); drawMap(); }),
    h("p", { class: "hint" }, "Tap the map to put them there. Drag a placed NPC to move them. One NPC can stand in many places: same name, words and quests at each."));
  if (M.npcMode === "new") {
    const nn = M.npcNew;
    const name = h("input", { type: "text", value: nn.Name, placeholder: "Name, e.g. Gate Guard", oninput: () => { nn.Name = name.value; drawMap(); } });
    const fac = h("input", { type: "text", value: nn.Faction, placeholder: "Faction (optional)", oninput: () => { nn.Faction = fac.value; } });
    const pickImg = () => openPicker({ title: "How they look", groups: npcSpriteGroups, recentKey: "npc", value: nn.ImgPath, onPick: v => { if (v) { nn.ImgPath = v; drawSide(); drawMap(); } } });
    s.append(h("div", { class: "npcnew" }, thumb(nn.ImgPath, pickImg, "Change sprite"), h("div", { class: "npcnew-f" }, name, fac, h("button", { type: "button", onclick: pickImg }, "Change look…"))));
  } else {
    const f = h("input", { type: "search", value: M.npcFilter || "", placeholder: "Search NPCs…", oninput: () => { M.npcFilter = f.value; drawList(); } });
    const list = h("div", { class: "npclist" });
    const drawList = () => {
      const q = (M.npcFilter || "").toLowerCase();
      const rows = S.c.npcs.filter(n => !q || `${n.Name} ${n.Faction}`.toLowerCase().includes(q)).slice(0, 80);
      list.replaceChildren(...rows.map(n => {
        const k = spawnsOf(n).length;
        return h("button", { type: "button", class: "npcrow" + (M.npcPick === n.id ? " on" : ""), onclick: () => { M.npcPick = n.id; drawSide(); drawMap(); } },
          h("img", { src: assetURL(n.ImgPath), alt: "" }), h("span", {}, h("b", {}, n.Name), h("small", {}, k ? `${k} place${k > 1 ? "s" : ""}` : "not placed")));
      }));
    };
    drawList();
    s.append(f, list);
  }
  const sel = M.npcSel && S.npcBy[M.npcSel.npc];
  if (sel) {
    const all = spawnsOf(sel), here = all.find(sp => sp.X === M.npcSel.x && sp.Y === M.npcSel.y);
    s.append(h("h3", {}, sel.Name),
      h("div", { class: "bar" }, thumb(sel.ImgPath, null, sel.Name), h("span", {}, `${all.length} place${all.length === 1 ? "" : "s"}`), link("#studio/npc/" + sel.id, "Open in Quest Studio", "btnlink")),
      h("div", { class: "npcspots" }, all.map(sp => h("div", { class: "npcspot" + (sp === here ? " on" : "") },
        h("button", { type: "button", onclick: () => { M.cx = sp.X; M.cy = sp.Y; M.npcSel = { npc: sel.id, x: sp.X, y: sp.Y }; drawSide(); drawMap(); } }, `${sp.X}, ${sp.Y}`),
        h("span", { class: "hint" }, zoneName(sp.X, sp.Y)),
        h("button", { type: "button", class: "danger", onclick: async () => { if (await removePlacement(sel, sp)) { if (sp === here) M.npcSel = null; drawSide(); drawMap(); } } }, "Remove")))),
      h("div", { class: "bar" }, h("button", { type: "button", onclick: () => { M.npcMode = "existing"; M.npcPick = sel.id; drawSide(); drawMap(); status(`Tap the map to put ${sel.Name} somewhere else too.`); } }, "+ Another place")));
  }
}
function zoneName(x, y) { const t = tile(x, y); return t ? str(t[4]) : ""; }
// Touch and pen: one finger works as the mouse does (tools, drags), two
// fingers pan and pinch-zoom. The mouse keeps its own handlers.
function mapTouch(cv) {
  const pts = new Map();
  let pinch = null;
  const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  cv.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse") return;
    e.preventDefault(); // no emulated mouse events after
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { M.hover = toTile(e); mapDown(e); }
    else if (pts.size === 2) {
      if (M.drag && (M.drag.paint || M.drag.area)) mapUp(); else M.drag = null; // a second finger: no tap, no drag
      const t = two(); pinch = { ...t, scale: M.scale, cx: M.cx, cy: M.cy };
    }
  });
  cv.addEventListener("pointermove", e => {
    if (e.pointerType === "mouse" || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const t = two(), r = cv.getBoundingClientRect();
      const sc = Math.max(2, Math.min(48, pinch.scale * t.d / pinch.d));
      // keep the world point under the first centre under the fingers
      const wx = (pinch.x - r.left - cv.width / 2) / pinch.scale + pinch.cx, wy = (pinch.y - r.top - cv.height / 2) / pinch.scale + pinch.cy;
      M.scale = sc; M.cx = wx - (t.x - r.left - cv.width / 2) / sc; M.cy = wy - (t.y - r.top - cv.height / 2) / sc;
      drawMap(); return;
    }
    if (!pinch) mapMove(e);
  });
  const end = e => {
    if (e.pointerType === "mouse" || !pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) { if (!pts.size) pinch = null; return; }
    if (!pts.size) mapUp(e);
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", e => { if (e.pointerType !== "mouse") { pts.delete(e.pointerId); if (!pts.size) { pinch = null; M.drag = null; } } });
}
// Tiles on the line from a to b (so a fast drag leaves no gaps).
function lineTiles(a, b) {
  const out = []; let x = a.x, y = a.y;
  const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1; let err = dx + dy;
  for (let n = 0; n < 4000; n++) { out.push({ x, y }); if (x === b.x && y === b.y) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
  return out;
}

function mapDown(e) {
  const t = toTile(e);
  M.cv.focus({ preventScroll: true });
  if (e.button === 2 || e.button === 1 || (M.tool === "select" && e.shiftKey)) { M.drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: M.cx, cy: M.cy }; return; }
  if (M.tool === "npc") { npcToolDown(e, t); return; }
  if (M.tool === "select") {
    const p = placementAt(t.x, t.y), tl = tile(t.x, t.y);
    M.sel = { x: t.x, y: t.y };
    if (p) M.drag = { npc: p.n, sp: p.sp, from: t };
    else if (tl && str(tl[6])) M.drag = { mob: str(tl[6]), from: t };
    else M.drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: M.cx, cy: M.cy };
    drawSide(); drawMap();
  } else if (M.tool === "plot") plotDown(e, t);
  else if (M.tool === "spawn") placeSpawns(t);
  else if (M.tool === "erase") { brushTiles(t).forEach(b => patch(b.x, b.y, { Enemy: "" })); M.drag = { paint: true, last: t }; }
  else if (M.tool === "areas") arDown(e, t);
  else if (M.tool === "paint") {
    if (e.altKey) { eyedrop(t); return; }
    paintAt(t); M.drag = { paint: true, last: t };
  }
}
function mapMove(e) {
  if (!M.cv) return;
  const t = toTile(e);
  if (!M.drag) {
    const r = M.cv.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    if (M.tool === "plot") M.cv.style.cursor = plotCursor(e);
    if (!M.hover || M.hover.x !== t.x || M.hover.y !== t.y) { M.hover = t; drawMap(); }
    return;
  }
  if (M.drag.pan) {
    if (M.drag.tap && Math.hypot(e.clientX - M.drag.sx, e.clientY - M.drag.sy) > 8) M.drag.tap = null; // a drag pans, a tap places
    M.cx = M.drag.cx - (e.clientX - M.drag.sx) / M.scale; M.cy = M.drag.cy - (e.clientY - M.drag.sy) / M.scale; drawMap(); return;
  }
  M.hover = t;
  if (M.drag.npc || M.drag.mob) { M.drag.to = t; drawMap(); }
  else if (M.drag.plotRect || M.drag.movePlot || M.drag.resize) plotMove(t, e);
  else if (M.drag.area) arDrag(t);
  else if (M.drag.paint) {
    for (const s of lineTiles(M.drag.last, t).slice(1)) {
      if (M.tool === "erase") brushTiles(s).forEach(b => patch(b.x, b.y, { Enemy: "" })); else paintAt(s);
    }
    M.drag.last = t; drawMap();
  }
}
async function mapUp() {
  const d = M.drag; M.drag = null;
  if (!d) return;
  if (d.plotRect || d.movePlot || d.resize) { plotUp(d); return; }
  if (d.tap) { await npcToolTap(d.tap); return; }
  if (d.npc && d.to && (d.to.x !== d.from.x || d.to.y !== d.from.y)) {
    await movePlacement(d.npc, d.sp, d.to.x, d.to.y);
    M.sel = d.to;
    if (M.npcSel) M.npcSel = { npc: d.npc.id, x: d.to.x, y: d.to.y };
    drawSide(); drawMap();
  } else if (d.mob && d.to && (d.to.x !== d.from.x || d.to.y !== d.from.y)) {
    patch(d.from.x, d.from.y, { Enemy: "" }); patch(d.to.x, d.to.y, { Enemy: d.mob }); M.sel = d.to; await flush();
  } else if (d.paint) await flush();
  else if (d.area) await arFlush();
}

// Edits show at once: the tile is changed in S.world (what drawMap draws)
// and a redraw is queued; the database write happens on mouse-up (flush).
function patch(x, y, set) {
  const k = x + "," + y;
  const p = M.pending.get(k) || { X: x, Y: y, Set: {} };
  Object.assign(p.Set, set); M.pending.set(k, p);
  let t = tile(x, y);
  if (!t) { t = [x, y, idx("assets/world/grounds/grass.png"), 0, 0, 0, 0, 0, 0]; S.world.tiles.set(k, t); }
  const col = { GroundTile: 2, ForegroundTile: 3, Name: 4, Collision: 5, Enemy: 6, Flip: 8 };
  for (const [c, v] of Object.entries(set)) t[col[c]] = c === "Collision" || c === "Flip" ? (v ? 1 : 0) : idx(v);
  M.usage = null;
  drawMap();
}
function idx(s) { let i = S.world.strings.indexOf(s); if (i < 0) { S.world.strings.push(s); i = S.world.strings.length - 1; } return i; }
async function flush() {
  if (!M.pending.size) return;
  const list = [...M.pending.values()]; M.pending.clear();
  status("Saving tiles…");
  try { await api("tiles", list); status(`Saved ${list.length} tile(s) in memory. Save .db or Export SQL to keep them.`); }
  catch (e) { status(e.message, true); await loadWorld(); }
  if (M.tool === "select") drawSide();
  drawMap();
}

function placeSpawns(t) {
  const name = M.spawnEnemy, count = Math.max(1, +(M.spawnCount && M.spawnCount.value) || 1);
  if (!name) { status("Pick an enemy first", true); return; }
  let placed = 0;
  for (let r = 0; r < 6 && placed < count; r++)
    for (let dy = -r; dy <= r && placed < count; dy++)
      for (let dx = -r; dx <= r && placed < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = t.x + dx * 2, y = t.y + dy * 2, tl = tile(x, y);
        if (!tl || tl[5] || str(tl[6]) || npcAt(x, y)) continue;
        patch(x, y, { Enemy: name }); placed++;
      }
  flush();
}
function brushTiles(t) {
  const n = M.brush.size || 1, o = Math.floor((n - 1) / 2), out = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push({ x: t.x - o + dx, y: t.y - o + dy });
  return out;
}
function brushSet() {
  const b = M.brush, set = {};
  if (b.ground) set.GroundTile = b.ground;
  if (b.fore !== undefined) { set.ForegroundTile = b.fore; set.Flip = !!b.fore && !!b.flip; }
  if (b.coll !== "") set.Collision = b.coll === "1";
  if (b.area != null) set.Name = b.area;
  return set;
}
function paintAt(t) {
  const set = brushSet();
  if (!Object.keys(set).length) { status("The brush is empty: pick a ground or object sprite, or set collision or a zone.", true); return; }
  for (const b of brushTiles(t)) patch(b.x, b.y, set);
}
function eyedrop(t) {
  const tl = tile(t.x, t.y); if (!tl) return;
  M.brush.ground = str(tl[2]) || null; M.brush.fore = str(tl[3]); M.brush.flip = !!tl[8];
  status(`Brush copied from ${t.x}, ${t.y}: ${spriteLabel(M.brush.ground) || "-"} / ${spriteLabel(M.brush.fore) || "no object"}`);
  drawSide(); drawMap();
}

// Segmented buttons: opts [[value, label]].
function seg(opts, cur, onpick) {
  return h("div", { class: "seg" }, opts.map(([v, l]) => h("button", { type: "button", class: v === cur ? "on" : "", onclick: () => onpick(v) }, l)));
}
function thumb(path, onclick, title) {
  return h("button", { type: "button", class: "thumb", title: title || path || "", onclick },
    path ? h("img", { src: assetURL(path), onerror: e => e.target.classList.add("missing") }) : h("span", { class: "pnone" }, path === "" ? "×" : "?"));
}

function drawSide() {
  const s = M.side; if (!s) return;
  s.className = "side" + (M.tool === "paint" || M.tool === "spawn" ? " wide" : "");
  s.textContent = "";
  const tools = h("div", { class: "tools" });
  for (const [k, l] of [["select", "Select / drag"], ["npc", "NPCs"], ["spawn", "Place mobs"], ["erase", "Erase mobs"], ["paint", "Paint tiles"], ["areas", "Areas"], ["plot", "Plots"]])
    tools.append(h("button", { class: M.tool === k ? "on" : "", onclick: () => { if (M.tool === "plot" && k !== "plot" && !plotConfirmDiscard()) return; M.tool = k; M.cv.style.cursor = ""; drawSide(); drawMap(); } }, l));
  s.append(h("h3", {}, "Tools"), tools,
    h("p", { class: "hint" }, "Wheel or pinch zooms. Right-drag, two fingers, or dragging empty ground in Select / NPCs pans. In Select, drag an NPC or a mob to move it."));
  if (M.tool === "plot") plotSide(s);
  if (M.tool === "spawn") spawnSide(s);
  if (M.tool === "npc") npcSide(s);
  if (M.tool === "paint") paintSide(s);
  if (M.tool === "areas") areasSide(s);
  if (M.tool === "erase") s.append(h("h3", {}, "Erase mobs"), h("div", { class: "row2" }, h("span", {}, "Brush size"), seg([[1, "1"], [2, "2"], [3, "3"], [5, "5"]], M.brush.size, v => { M.brush.size = v; drawSide(); })),
    h("p", { class: "hint" }, "Click or drag over spawns to remove them."));
  s.append(h("h3", {}, "Overlays"), h("div", { class: "legend" }, h("span", { style: "background:#ffd34d" }), "NPC  ", h("span", { style: "background:#ff4d4d" }), "mob spawn  ",
    h("span", { style: "background:#5af" }), "quest reach point  ", h("span", { style: "background:#78ff8c" }), "plot"),
    h("label", { class: "chk" }, (() => { const c = h("input", { type: "checkbox", onchange: () => { M.showColl = c.checked; drawMap(); } }); c.checked = M.showColl; return c; })(), " Show collision"),
    h("label", { class: "chk" }, (() => { const c = h("input", { type: "checkbox", onchange: () => { M.showAreas = c.checked; drawMap(); } }); c.checked = M.showAreas; return c; })(), " Show zone names"),
    M.tool === "areas" ? null : h("label", { class: "chk" }, (() => { const c = h("input", { type: "checkbox", onchange: () => { AR.show = c.checked; drawMap(); } }); c.checked = AR.show; return c; })(), " Show areas"));
  if (M.sel && M.tool === "select") selSide(s);
  const go = { x: num(Math.round(M.cx)), y: num(Math.round(M.cy)) };
  const npcJump = npcSelect(0, () => { const n = S.npcBy[npcJump.value]; if (n) { M.cx = n.SpawnX; M.cy = n.SpawnY; M.scale = 24; M.sel = { x: n.SpawnX, y: n.SpawnY }; drawSide(); drawMap(); } });
  s.append(h("h3", {}, "Go to"), h("div", { class: "bar" }, "X", go.x, "Y", go.y, h("button", { onclick: () => { M.cx = +go.x.value; M.cy = +go.y.value; drawMap(); } }, "Go")), npcJump);
}
function selSide(s) {
  const t = tile(M.sel.x, M.sel.y), n = npcAt(M.sel.x, M.sel.y);
  s.append(h("h3", {}, `Tile ${M.sel.x}, ${M.sel.y}`));
  if (t) s.append(h("div", { class: "tileinfo" }, thumb(str(t[2]), null, "ground"), thumb(str(t[3]) || "", null, "object"),
    h("div", { class: "hint" }, `Zone: ${str(t[4]) || "-"}`, h("br"), `Area: ${areaNameAt(M.sel.x, M.sel.y) || "-"}`, h("br"), `Ground: ${spriteLabel(str(t[2]))}`, h("br"),
      `Object: ${spriteLabel(str(t[3])) || "-"}${t[8] && str(t[3]) ? " (flipped)" : ""}`, h("br"), t[5] ? "Blocked" : "Walkable")));
  if (t && str(t[3])) s.append(h("div", { class: "bar" }, h("button", { title: "Mirror the object left to right (F)", onclick: flipSelected }, t[8] ? "Unflip object" : "Flip object"),
    h("span", { class: "hint" }, "F")));
  if (t && str(t[6])) {
    const en = S.c.enemies.find(v => v.Name === str(t[6]));
    s.append(h("div", { class: "bar" }, thumb(en && en.Image, () => openPicker({ title: "Change the mob here", groups: enemyGroups, recentKey: "enemy", value: str(t[6]),
      onPick: v => { if (v) { patch(M.sel.x, M.sel.y, { Enemy: v }); flush(); } } }), "Change mob"), h("b", {}, str(t[6])),
      h("button", { onclick: () => openPicker({ title: "Change the mob here", groups: enemyGroups, recentKey: "enemy", value: str(t[6]), onPick: v => { if (v) { patch(M.sel.x, M.sel.y, { Enemy: v }); flush(); } } }) }, "Change…"),
      h("button", { class: "danger", onclick: () => { patch(M.sel.x, M.sel.y, { Enemy: "" }); flush(); } }, "Remove")));
  }
  if (n) {
    const pickNpc = () => openPicker({ title: `Sprite for ${n.Name}`, groups: npcSpriteGroups, recentKey: "npc", value: n.ImgPath,
      onPick: async v => { if (!v) return; await save("npc", { id: n.id, Name: n.Name, ImgPath: v, Faction: n.Faction, Conversation: n.Conversation, SpawnX: n.SpawnX, SpawnY: n.SpawnY }); drawSide(); drawMap(); } });
    s.append(h("div", { class: "bar" }, thumb(n.ImgPath, pickNpc, "Change sprite"), h("b", {}, n.Name), h("button", { onclick: pickNpc }, "Change sprite…"), link("#npc/" + n.id, "Edit NPC & dialogue", "btnlink")),
      h("h3", {}, "Quests here"), npcQuestList(n, true));
  }
}
function spawnSide(s) {
  M.spawnCount = M.spawnCount || num(3);
  const en = S.c.enemies.find(v => v.Name === M.spawnEnemy);
  s.append(h("h3", {}, "Place mobs"),
    h("div", { class: "row2" }, h("span", {}, "Enemy"), h("b", { class: "big" }, en ? en.Name : "pick one below"), h("span", {}, "Count"), M.spawnCount),
    h("p", { class: "hint" }, "Click the map to place. Mobs go on free walkable tiles, two tiles apart, around the click."),
    spritePicker({ groups: enemyGroups, recentKey: "enemy", value: M.spawnEnemy || "", placeholder: "Search enemies…", height: "50vh",
      onPick: v => { M.spawnEnemy = v; drawSide(); } }));
}
function paintSide(s) {
  const b = M.brush;
  const target = b.target;
  const areas = [...new Set([...S.world.tiles.values()].map(t => str(t[4])))].filter(Boolean).sort();
  let dl = $("#areaNames"); if (!dl) { dl = h("datalist", { id: "areaNames" }); document.body.append(dl); }
  dl.replaceChildren(...areas.map(a => h("option", { value: a })));
  const area = h("input", { type: "text", list: "areaNames", value: b.area ?? "", placeholder: "Zone name", oninput: () => { b.area = area.value; drawMap(); } });
  const refresh = () => { drawSide(); drawMap(); };
  s.append(h("h3", {}, "Brush"),
    h("div", { class: "brush" },
      h("div", { class: "brow" + (target === "ground" ? " target" : "") }, h("span", { class: "bl" }, "Ground"),
        thumb(b.ground, () => { b.target = "ground"; refresh(); }, "Pick a ground below"),
        h("span", { class: "bn" }, b.ground ? spriteLabel(b.ground) : "keep"),
        seg([["keep", "Keep"], ["set", "Paint"]], b.ground ? "set" : "keep", v => { if (v === "keep") b.ground = null; else { b.target = "ground"; b.ground = b.ground || recentGet("ground")[0] || "assets/world/grounds/grass.png"; } refresh(); })),
      h("div", { class: "brow" + (target === "fore" ? " target" : "") }, h("span", { class: "bl" }, "Object"),
        thumb(b.fore === undefined ? null : b.fore, () => { b.target = "fore"; refresh(); }, "Pick an object below"),
        h("span", { class: "bn" }, b.fore === undefined ? "keep" : b.fore === "" ? "clear" : spriteLabel(b.fore)),
        seg([["keep", "Keep"], ["set", "Paint"], ["clear", "Clear"]], b.fore === undefined ? "keep" : b.fore === "" ? "clear" : "set",
          v => { if (v === "keep") b.fore = undefined; else if (v === "clear") b.fore = ""; else { b.target = "fore"; b.fore = b.fore || recentGet("fore")[0] || "assets/world/objects/tree.png"; } refresh(); })),
      h("div", { class: "brow" }, h("span", { class: "bl", title: "Paint the object mirrored left to right (F)" }, "Flip"),
        seg([[false, "Normal"], [true, "Flipped"]], !!b.flip, v => { b.flip = v; refresh(); }), h("span", { class: "hint" }, "F")),
      h("div", { class: "brow" }, h("span", { class: "bl" }, "Collision"), seg([["", "Keep"], ["1", "Blocked"], ["0", "Walkable"]], b.coll, v => { b.coll = v; refresh(); })),
      h("div", { class: "brow" }, h("span", { class: "bl", title: "The zone (world.Name): lighting, music, quest zones. Inside/outside and reverb are the Areas tool." }, "Zone"), seg([["keep", "Keep"], ["set", "Set"]], b.area == null ? "keep" : "set", v => { b.area = v === "keep" ? null : (b.area || areas[0] || ""); refresh(); }),
        b.area != null ? area : null),
      h("div", { class: "brow" }, h("span", { class: "bl" }, "Size"), seg([[1, "1"], [2, "2"], [3, "3"], [5, "5"]], b.size, v => { b.size = v; refresh(); }))),
    h("p", { class: "hint" }, "Click or drag on the map to paint; the change shows straight away and is stored when you let go. Alt-click a tile to copy its ground and object into the brush. F flips the object."),
    h("div", { class: "seg pick-target" }, h("span", {}, "Picking: "),
      h("button", { type: "button", class: target === "ground" ? "on" : "", onclick: () => { b.target = "ground"; refresh(); } }, "Ground"),
      h("button", { type: "button", class: target === "fore" ? "on" : "", onclick: () => { b.target = "fore"; refresh(); } }, "Object")),
    spritePicker({ groups: worldGroups(target === "ground" ? "ground" : "fore"), recentKey: target, value: target === "ground" ? b.ground : b.fore,
      allowNone: target === "fore", noneLabel: "No object (clear)", height: "48vh",
      onPick: v => { if (target === "ground") { if (v) b.ground = v; } else b.fore = v; refresh(); } }));
}

// An object sprite, mirrored left to right when flip is set (world_flip),
// in the same square.
function drawObj(g, img, x, y, w, h, flip) {
  if (!flip) { g.drawImage(img, x, y, w, h); return; }
  g.save(); g.translate(x + w, y); g.scale(-1, 1); g.drawImage(img, 0, 0, w, h); g.restore();
}
// Flip the object on the selected tile (Select tool: F or the button).
function flipSelected() {
  const t = M.sel && tile(M.sel.x, M.sel.y);
  if (!t || !str(t[3])) { status("No object on this tile to flip.", true); return; }
  patch(M.sel.x, M.sel.y, { Flip: !t[8] }); flush(); drawSide();
}
function drawMap() { if (!M.raf) M.raf = requestAnimationFrame(() => { M.raf = 0; drawMapNow(); }); }
function drawMapNow() {
  const cv = M.cv; if (!cv || !S.world || !cv.width) return;
  const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
  g.fillStyle = "#0b0d10"; g.fillRect(0, 0, cv.width, cv.height);
  const sc = M.scale, w = cv.width / sc / 2 + 1, hh = cv.height / sc / 2 + 1;
  const x0 = Math.floor(M.cx - w), x1 = Math.ceil(M.cx + w), y0 = Math.floor(M.cy - hh), y1 = Math.ceil(M.cy + hh);
  const px = x => (x - M.cx) * sc + cv.width / 2, py = y => (y - M.cy) * sc + cv.height / 2;
  const sprites = sc >= 10;
  const showColl = M.showColl || (M.tool === "paint" && M.brush.coll !== "");
  const areaHi = M.tool === "paint" && M.brush.area != null ? M.brush.area : null;
  const forest = M.tool === "plot";
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tile(x, y); if (!t) continue;
    const gp = str(t[2]), fp = str(t[3]);
    const gi = imgFor(gp);
    if (sprites && gi) g.drawImage(gi, px(x), py(y), sc + .5, sc + .5);
    else { g.fillStyle = M.failed[gp] ? "#a0a" : M.colours[gp] || "#3a5"; g.fillRect(px(x), py(y), sc + .5, sc + .5); }
    if (fp) {
      const fi = imgFor(fp);
      if (sprites && fi) drawObj(g, fi, px(x), py(y), sc + .5, sc + .5, t[8]);
      else if (M.failed[fp]) { g.strokeStyle = "#f0f"; g.beginPath(); g.moveTo(px(x) + 2, py(y) + 2); g.lineTo(px(x) + sc - 2, py(y) + sc - 2); g.moveTo(px(x) + sc - 2, py(y) + 2); g.lineTo(px(x) + 2, py(y) + sc - 2); g.stroke(); }
      else if (M.colours[fp]) { g.fillStyle = M.colours[fp]; g.globalAlpha = .7; g.fillRect(px(x), py(y), sc + .5, sc + .5); g.globalAlpha = 1; }
    }
    if (t[5] && !sprites && !showColl) { g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(px(x), py(y), sc, sc); }
    if (showColl && t[5]) { g.fillStyle = "rgba(255,40,40,.38)"; g.fillRect(px(x), py(y), sc, sc); }
    if (areaHi !== null && str(t[4]) === areaHi) { g.fillStyle = "rgba(80,200,255,.28)"; g.fillRect(px(x), py(y), sc, sc); }
    if (forest && isFreeBuild(str(t[4]))) { g.fillStyle = "rgba(255,140,0,.22)"; g.fillRect(px(x), py(y), sc + .5, sc + .5); }
  }
  drawAreasLayer(g, x0, x1, y0, y1, px, py, sc);
  // zone names
  if (M.tool !== "areas" && (sc < 10 || M.showAreas || areaHi !== null)) {
    g.font = "bold 13px sans-serif"; const shown = new Set(); const step = Math.max(3, Math.ceil(90 / sc));
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const t = tile(x, y); const n = t && str(t[4]);
      if (n && !shown.has(n)) { shown.add(n); g.fillStyle = "rgba(0,0,0,.6)"; g.fillText(n, px(x) + 1, py(y) + 1); g.fillStyle = "#fff"; g.fillText(n, px(x), py(y)); }
    }
  }
  // mob spawns
  const r = Math.max(2, sc / 3);
  g.font = `${Math.max(10, Math.min(14, sc / 2))}px sans-serif`;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tile(x, y); const e = t && str(t[6]); if (!e) continue;
    if (M.drag && M.drag.mob && M.drag.from.x === x && M.drag.from.y === y) continue;
    mobMarker(g, e, px(x), py(y), sc, r);
  }
  if (M.drag && M.drag.mob && M.drag.to) mobMarker(g, M.drag.mob, px(M.drag.to.x), py(M.drag.to.y), sc, r);
  drawPlotsLayer(g, px, py, sc);
  // quest reach points
  g.strokeStyle = "#5af";
  for (const q of S.c.quests) for (const s of parseJSON(q.Steps, [])) if (s.Type === "reach") {
    g.beginPath(); g.arc(px(s.X) + sc / 2, py(s.Y) + sc / 2, (s.Radius || 3) * sc, 0, 7); g.stroke();
  }
  // NPCs
  g.font = `${Math.max(11, Math.min(14, sc / 2))}px sans-serif`;
  for (const { n, sp } of placements()) {
    let x = sp.X, y = sp.Y;
    if (M.drag && M.drag.npc === n && M.drag.sp === sp && M.drag.to) { x = M.drag.to.x; y = M.drag.to.y; }
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const i = sprites && imgFor(n.ImgPath);
    if (i) g.drawImage(i, px(x), py(y), sc, sc);
    const agent = n.Faction === "Land Agent";
    g.strokeStyle = agent ? "#ff9ad5" : "#ffd34d"; g.lineWidth = 2; g.strokeRect(px(x), py(y), sc, sc); g.lineWidth = 1;
    if (!i) { g.fillStyle = g.strokeStyle; g.fillRect(px(x) + sc / 4, py(y) + sc / 4, sc / 2, sc / 2); }
    if (sc >= 6) { g.fillStyle = agent ? "#ff9ad5" : "#ffd34d"; g.fillText(n.Name + (agent && M.tool === "plot" ? " (Land Agent)" : ""), px(x), py(y) - 3); }
  }
  if (M.sel && M.tool === "select") { g.strokeStyle = "#fff"; g.strokeRect(px(M.sel.x) - 1, py(M.sel.y) - 1, sc + 2, sc + 2); }
  if (M.tool === "npc") npcToolDraw(g, px, py, sc);
  // brush preview under the cursor
  if (M.hover && (M.tool === "paint" || M.tool === "erase")) {
    const b = M.brush;
    for (const t of brushTiles(M.hover)) {
      if (M.tool === "paint") {
        g.globalAlpha = .75;
        const gi = b.ground && imgFor(b.ground), fi = b.fore && imgFor(b.fore);
        if (gi) g.drawImage(gi, px(t.x), py(t.y), sc, sc);
        if (fi) drawObj(g, fi, px(t.x), py(t.y), sc, sc, b.flip);
        g.globalAlpha = 1;
      }
      g.strokeStyle = M.tool === "erase" ? "#f55" : "#fff"; g.lineWidth = 2; g.strokeRect(px(t.x) + 1, py(t.y) + 1, sc - 2, sc - 2); g.lineWidth = 1;
    }
  }
  drawAreasBrush(g, px, py, sc);
  // hover readout
  if (M.hover) {
    const t = tile(M.hover.x, M.hover.y), an = areaNameAt(M.hover.x, M.hover.y);
    const txt = `${M.hover.x}, ${M.hover.y}` + (t ? `  ·  ${str(t[4]) || "no zone"}${an ? "  ·  area " + an : ""}  ·  ${spriteLabel(str(t[2]))}${str(t[3]) ? " + " + spriteLabel(str(t[3])) + (t[8] ? " (flipped)" : "") : ""}${t[5] ? "  ·  blocked" : ""}` : "  ·  off the map");
    g.font = "14px sans-serif"; const tw = g.measureText(txt).width;
    g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(8, cv.height - 30, tw + 16, 24);
    g.fillStyle = "#fff"; g.fillText(txt, 16, cv.height - 13);
  }
}
function mobMarker(g, e, x, y, sc, r) {
  const en = S.c.enemies.find(v => v.Name === e);
  const i = sc >= 10 && en && imgFor(en.Image);
  if (i) g.drawImage(i, x, y, sc, sc);
  g.fillStyle = "#ff4d4d"; g.beginPath(); g.arc(x + sc / 2, y + sc / 2, i ? 3 : r, 0, 7); g.fill();
  if (sc >= 16) { g.fillStyle = "#fbb"; g.fillText(e, x, y + sc + 10); }
}

// ------------------------------------------------------------------ plots
// Table plot (id, Name, X, Y, W, H, Rent, MinLevel, Agent). X,Y is the top-left
// tile; W,H are tiles (1-12, the API clamps to that). Agent is the npc id of the
// Land Agent (Faction 'Land Agent') who lets it, 0 = any. The API lists a plot
// at its agent's "What plots have you got?" and draws it on the player's map.
const PLOT_MAX = 12;
const PLOT_BAD_GROUND = ["Path", "Cobblestone", "Walkway", "Stone Floor", "Wood Floor", "Tiled Floor", "Water", "Lava", "Bridge"];
const PLOT_DOORS = ["Portal", "Hole", "Door", "Sign", "Class Machine", "Well"];
const PLOT_COLOURS = ["#78ff8c", "#7ac8ff", "#ff9ad5", "#ffb45a", "#c59bff", "#fff36b"];
const isFreeBuild = name => name === "Foundation Forest" || /^Dominion of /.test(name || "");
const landAgents = () => S.c.npcs.filter(n => n.Faction === "Land Agent");
const agentName = id => (+id ? (S.npcBy[id] ? S.npcBy[id].Name : `missing NPC ${id}`) : "Any Land Agent");
function plotColour(p) {
  if (!+p.Agent) return PLOT_COLOURS[0];
  const i = landAgents().findIndex(n => n.id === +p.Agent);
  return PLOT_COLOURS[1 + ((i < 0 ? 4 : i) % (PLOT_COLOURS.length - 1))];
}
function plotAt(x, y) { return (S.c.plots || []).find(p => x >= p.X && x < p.X + p.W && y >= p.Y && y < p.Y + p.H); }
const plotHas = (p, x, y) => x >= p.X && x < p.X + p.W && y >= p.Y && y < p.Y + p.H;
// Rules the database enforces too (db.js): errors stop a save.
function plotIssues(p) {
  const errors = [], warnings = [];
  if (!String(p.Name || "").trim()) errors.push("Give it a name.");
  if (!(p.W >= 1 && p.H >= 1 && p.W <= PLOT_MAX && p.H <= PLOT_MAX)) errors.push(`Size must be 1 to ${PLOT_MAX} tiles a side (it is ${p.W} x ${p.H}).`);
  if (!(p.Rent >= 0)) errors.push("Rent can't be negative.");
  if (!(p.MinLevel >= 1 && p.MinLevel <= 40)) errors.push("Min level must be 1 to 40.");
  if (+p.Agent && !landAgents().some(n => n.id === +p.Agent)) errors.push(`${agentName(p.Agent)} is not a Land Agent (Faction 'Land Agent').`);
  for (const o of S.c.plots || []) if (o.id !== p.id && p.X < o.X + o.W && o.X < p.X + p.W && p.Y < o.Y + o.H && o.Y < p.Y + p.H) errors.push(`Overlaps ${o.Name}.`);
  let forest = 0, missing = 0;
  const pr = { road: 0, blocked: 0, door: 0, spawn: 0, npc: 0 }; let unusable = 0;
  for (let y = p.Y; y < p.Y + Math.min(p.H, 40); y++) for (let x = p.X; x < p.X + Math.min(p.W, 40); x++) {
    const t = tile(x, y);
    if (!t) { missing++; continue; }
    if (isFreeBuild(str(t[4]))) forest++;
    const before = pr.road + pr.blocked + pr.door + pr.spawn + pr.npc;
    if (t[5]) pr.blocked++;
    if (PLOT_BAD_GROUND.some(b => str(t[2]).includes(b) || str(t[3]).includes(b))) pr.road++;
    let door = false, spawn = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const n = tile(x + dx, y + dy); if (!n) continue;
      if (PLOT_DOORS.some(d => str(n[3]).includes(d))) door = true;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && str(n[6])) spawn = true;
    }
    if (door) pr.door++;
    if (spawn) pr.spawn++;
    if (S.c.npcs.some(n => Math.abs(n.SpawnX - x) <= 1 && Math.abs(n.SpawnY - y) <= 1)) pr.npc++;
    if (pr.road + pr.blocked + pr.door + pr.spawn + pr.npc > before) unusable++;
  }
  if (forest) errors.push(`${forest} tile(s) in Foundation Forest (or a Dominion there). Building is free in the forest, so plots go outside it.`);
  if (missing) errors.push(`${missing} tile(s) are off the map.`);
  const cells = p.W * p.H, bad = [];
  if (pr.road) bad.push(`${pr.road} on roads, floors or water`);
  if (pr.blocked) bad.push(`${pr.blocked} blocked`);
  if (pr.door) bad.push(`${pr.door} within 2 tiles of a doorway or sign`);
  if (pr.spawn) bad.push(`${pr.spawn} next to a mob spawn`);
  if (pr.npc) bad.push(`${pr.npc} next to an NPC`);
  if (bad.length) warnings.push(`Players can't build on some tiles: ${bad.join("; ")}.`);
  if (unusable >= cells && cells > 0) warnings.push("No tile here is buildable at all.");
  else if (bad.length) warnings.push(`${cells - unusable} of ${cells} tiles are buildable.`);
  if (!landAgents().length) warnings.push("No NPC has Faction 'Land Agent', so nobody can let this plot.");
  return { errors, warnings };
}
const plotDirty = () => M.plotSel && JSON.stringify(plotRow(M.plotSel)) !== M.plotOrig;
const plotRow = p => ({ id: p.id || 0, Name: String(p.Name || "").trim(), X: +p.X, Y: +p.Y, W: +p.W, H: +p.H, Rent: +p.Rent, MinLevel: +p.MinLevel, Agent: +p.Agent || 0 });
function plotConfirmDiscard() {
  if (!plotDirty()) return true;
  if (!confirm(`Discard unsaved changes to ${M.plotSel.Name || "this plot"}?`)) return false;
  M.plotSel = null; return true;
}
function selectPlot(p, centre) {
  M.plotSel = { ...p, Agent: +p.Agent || 0 }; M.plotOrig = p.id ? JSON.stringify(plotRow(M.plotSel)) : "";
  if (centre) { M.cx = p.X + p.W / 2; M.cy = p.Y + p.H / 2; M.scale = Math.max(M.scale, 16); }
  if (p.id) syncHash("#plot/" + p.id);
  drawSide(); drawMap();
}
// Which edge or corner of the selected plot the mouse is on ("n", "se", "move", or "").
function plotHandle(e) {
  const p = M.plotSel; if (!p) return "";
  const f = toFrac(e), tol = Math.max(0.3, 7 / M.scale);
  if (f.x < p.X - tol || f.x > p.X + p.W + tol || f.y < p.Y - tol || f.y > p.Y + p.H + tol) return "";
  let k = "";
  if (Math.abs(f.y - p.Y) <= tol) k += "n"; else if (Math.abs(f.y - (p.Y + p.H)) <= tol) k += "s";
  if (Math.abs(f.x - p.X) <= tol) k += "w"; else if (Math.abs(f.x - (p.X + p.W)) <= tol) k += "e";
  return k || (plotHas(p, Math.floor(f.x), Math.floor(f.y)) ? "move" : "");
}
function plotCursor(e) {
  const k = plotHandle(e);
  return { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize", move: "move" }[k]
    || (plotAt(toTile(e).x, toTile(e).y) ? "pointer" : "crosshair");
}
function plotDown(e, t) {
  const k = plotHandle(e);
  if (k && k !== "move") { M.drag = { resize: k, orig: { ...M.plotSel } }; return; }
  if (k === "move" && !e.altKey) { M.drag = { movePlot: true, from: t, ox: M.plotSel.X, oy: M.plotSel.Y, moved: false }; return; }
  const p = plotAt(t.x, t.y);
  if (p && !e.altKey) {
    if (!plotConfirmDiscard()) return;
    selectPlot(p);
    M.drag = { movePlot: true, from: t, ox: p.X, oy: p.Y, moved: false };
    return;
  }
  M.drag = { plotRect: true, from: t, to: t };
  drawMap();
}
function plotRectOf(d) {
  const x0 = Math.min(d.from.x, d.to.x), y0 = Math.min(d.from.y, d.to.y);
  const W = Math.abs(d.to.x - d.from.x) + 1, H = Math.abs(d.to.y - d.from.y) + 1;
  return { X: d.to.x < d.from.x ? d.from.x - Math.min(W, PLOT_MAX) + 1 : x0, Y: d.to.y < d.from.y ? d.from.y - Math.min(H, PLOT_MAX) + 1 : y0,
    W: Math.min(W, PLOT_MAX), H: Math.min(H, PLOT_MAX), clamped: W > PLOT_MAX || H > PLOT_MAX };
}
function plotMove(t, e) {
  const d = M.drag, p = M.plotSel;
  if (d.plotRect) d.to = t;
  else if (d.movePlot) { const nx = d.ox + t.x - d.from.x, ny = d.oy + t.y - d.from.y; if (nx !== p.X || ny !== p.Y) d.moved = true; p.X = nx; p.Y = ny; }
  else if (d.resize) {
    // edges snap to the nearest tile boundary under the mouse
    const o = d.orig, right = o.X + o.W, bottom = o.Y + o.H, f = e ? toFrac(e) : { x: t.x + .5, y: t.y + .5 };
    const bx = Math.round(f.x), by = Math.round(f.y);
    if (d.resize.includes("e")) p.W = Math.max(1, Math.min(PLOT_MAX, bx - o.X));
    if (d.resize.includes("w")) { const nx = Math.max(right - PLOT_MAX, Math.min(right - 1, bx)); p.X = nx; p.W = right - nx; }
    if (d.resize.includes("s")) p.H = Math.max(1, Math.min(PLOT_MAX, by - o.Y));
    if (d.resize.includes("n")) { const ny = Math.max(bottom - PLOT_MAX, Math.min(bottom - 1, by)); p.Y = ny; p.H = bottom - ny; }
  }
  drawMap();
}
function plotUp(d) {
  if (d.plotRect) {
    if (d.from.x === d.to.x && d.from.y === d.to.y) { // a click on empty ground
      if (M.plotSel && plotConfirmDiscard()) { M.plotSel = null; drawSide(); drawMap(); }
      return;
    }
    if (!plotConfirmDiscard()) return;
    const r = plotRectOf(d);
    const t = tile(r.X + Math.floor(r.W / 2), r.Y + Math.floor(r.H / 2));
    const base = (t && str(t[4])) || "Plot";
    let n = 1; while ((S.c.plots || []).some(p => p.Name === `${base} plot ${n}`)) n++;
    M.plotSel = { id: 0, Name: `${base} plot ${n}`, X: r.X, Y: r.Y, W: r.W, H: r.H, Rent: M.lastRent ?? 50, MinLevel: M.lastLevel ?? 1, Agent: M.lastAgent ?? 0 };
    M.plotOrig = "";
    if (r.clamped) status(`Plots are at most ${PLOT_MAX} x ${PLOT_MAX}: trimmed to ${r.W} x ${r.H}.`);
    drawSide(); drawMap();
    const nm = $("#plot-name"); if (nm) { nm.focus(); nm.select(); }
    return;
  }
  drawSide(); drawMap();
}
async function plotSave() {
  const p = M.plotSel; if (!p) return;
  const iss = plotIssues(plotRow(p));
  if (iss.errors.length) { status("Can't save: " + iss.errors[0], true); return; }
  let id; try { id = await save("plot", plotRow(p)); } catch (e) { return; }
  M.lastRent = +p.Rent; M.lastLevel = +p.MinLevel; M.lastAgent = +p.Agent || 0;
  const saved = S.c.plots.find(v => v.id === id);
  status(`Saved plot ${id} (${saved.Name}) in memory. Save .db or Export SQL to keep it.`);
  selectPlot(saved);
}
async function plotDelete() {
  const p = M.plotSel; if (!p) return;
  if (!p.id) { M.plotSel = null; drawSide(); drawMap(); return; }
  if (await del("plot", p.id)) { M.plotSel = null; drawSide(); drawMap(); }
}
function drawPlotsLayer(g, px, py, sc) {
  const sel = M.plotSel;
  for (const p of S.c.plots || []) if (!sel || sel.id !== p.id) plotRect(g, p, px, py, sc, plotColour(p), false);
  if (M.drag && M.drag.plotRect && M.drag.to) {
    const r = plotRectOf(M.drag);
    const iss = plotIssues({ ...r, id: -1, Name: "x", Rent: 0, MinLevel: 1, Agent: 0 });
    plotRect(g, { Name: "", ...r }, px, py, sc, iss.errors.length ? "#ff4d4d" : "#fff", true, `${r.W} x ${r.H}${r.clamped ? " (max)" : ""}`, iss.errors[0]);
  } else if (sel) {
    const iss = plotIssues(plotRow(sel));
    plotRect(g, sel, px, py, sc, iss.errors.length ? "#ff4d4d" : "#ffd34d", true, `${sel.W} x ${sel.H}`, iss.errors[0]);
    // who lets it
    const cx = px(sel.X + sel.W / 2), cy = py(sel.Y + sel.H / 2);
    g.save(); g.setLineDash([4, 6]); g.strokeStyle = "rgba(255,154,213,.8)"; g.lineWidth = 1.5;
    for (const n of landAgents()) if (!+sel.Agent || n.id === +sel.Agent) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(px(n.SpawnX + .5), py(n.SpawnY + .5)); g.stroke(); }
    g.restore();
    if (sc >= 6) for (const [hx, hy] of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, 0], [.5, 1], [0, .5], [1, .5]]) {
      g.fillStyle = "#fff"; g.fillRect(px(sel.X + sel.W * hx) - 4, py(sel.Y + sel.H * hy) - 4, 8, 8);
      g.strokeStyle = "#000"; g.strokeRect(px(sel.X + sel.W * hx) - 4, py(sel.Y + sel.H * hy) - 4, 8, 8);
    }
  }
}
function plotRect(g, p, px, py, sc, colour, sel, centreText, problem) {
  g.save(); g.strokeStyle = colour; g.lineWidth = sel ? 3 : 2; g.setLineDash(sel ? [] : [6, 4]);
  g.strokeRect(px(p.X), py(p.Y), p.W * sc, p.H * sc);
  g.fillStyle = colour; g.globalAlpha = sel ? .2 : .12; g.fillRect(px(p.X), py(p.Y), p.W * sc, p.H * sc); g.globalAlpha = 1;
  g.setLineDash([]);
  const fs = Math.max(12, Math.min(16, sc * .7));
  if (p.Name && sc >= 3) {
    const label = p.Name + (p.Rent != null ? `  ${p.Rent}g/wk  Lv${p.MinLevel}+  ${+p.Agent ? agentName(p.Agent).split(" ")[0] : "any agent"}` : "");
    g.font = `bold ${fs}px sans-serif`; const tw = g.measureText(label).width;
    g.fillStyle = "rgba(0,0,0,.7)"; g.fillRect(px(p.X), py(p.Y) - fs - 8, tw + 10, fs + 6);
    g.fillStyle = colour; g.fillText(label, px(p.X) + 5, py(p.Y) - 6);
  }
  if (centreText) {
    g.font = `bold ${Math.max(14, Math.min(28, sc))}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    const cx = px(p.X + p.W / 2), cy = py(p.Y + p.H / 2);
    g.fillStyle = "rgba(0,0,0,.65)"; const tw = g.measureText(centreText).width; g.fillRect(cx - tw / 2 - 6, cy - 16, tw + 12, 32);
    g.fillStyle = "#fff"; g.fillText(centreText, cx, cy);
    if (problem) { g.font = "bold 14px sans-serif"; const pw = g.measureText(problem).width; g.fillStyle = "rgba(120,0,0,.85)"; g.fillRect(cx - pw / 2 - 6, cy + 18, pw + 12, 22); g.fillStyle = "#fff"; g.fillText(problem, cx, cy + 29); }
  }
  g.restore();
}
function plotSide(s) {
  const agents = landAgents();
  s.append(h("h3", {}, "Plots"), h("ul", { class: "steps-help" },
    h("li", {}, h("b", {}, "Draw: "), `drag on the map (up to ${PLOT_MAX} x ${PLOT_MAX}). Red means it can't go there.`),
    h("li", {}, h("b", {}, "Edit: "), "click a plot, then drag it to move or drag an edge or corner handle to resize. Arrow keys nudge it, Shift+arrows resize."),
    h("li", {}, h("b", {}, "Keys: "), "Enter saves, Esc deselects, Delete removes."),
    h("li", {}, h("span", { class: "sw", style: "background:rgba(255,140,0,.6)" }), " Foundation Forest: no plots (building there is free).")));
  const p = M.plotSel;
  if (p) {
    const box = h("div", { class: "panel", id: "plot-form-box" });
    const f = { Name: txt(p.Name), Rent: num(p.Rent), MinLevel: num(p.MinLevel), X: num(p.X), Y: num(p.Y), W: num(p.W), H: num(p.H) };
    f.Name.id = "plot-name"; f.Rent.id = "plot-rent"; f.MinLevel.id = "plot-level";
    const agentSel = h("select", { id: "plot-agent" }, h("option", { value: 0 }, "Any Land Agent"), agents.map(n => h("option", { value: n.id }, `${n.Name} (at ${n.SpawnX}, ${n.SpawnY})`)));
    if (+p.Agent && !agents.some(n => n.id === +p.Agent)) agentSel.append(h("option", { value: p.Agent }, agentName(p.Agent)));
    agentSel.value = +p.Agent || 0;
    const checks = h("div", { id: "plot-check" });
    const saveBtn = h("button", { class: "primary", id: "plot-save", onclick: plotSave }, p.id ? "Save changes" : "Save new plot");
    const drawChecks = () => {
      const iss = plotIssues(plotRow(p));
      checks.replaceChildren(...[...iss.errors.map(e => h("div", { class: "chk-err" }, "✖ " + e)), ...iss.warnings.map(e => h("div", { class: "chk-warn" }, "⚠ " + e)),
        !iss.errors.length && !iss.warnings.length ? h("div", { class: "chk-ok" }, `✔ All ${p.W * p.H} tiles look buildable.`) : null,
        !iss.errors.length && iss.warnings.length ? h("div", { class: "chk-ok" }, "✔ Can be saved.") : null].filter(Boolean));
      saveBtn.disabled = !!iss.errors.length;
      dirty.textContent = plotDirty() || !p.id ? (p.id ? "Unsaved changes" : "Not saved yet") : "Saved";
      dirty.className = "dirtyflag" + (plotDirty() || !p.id ? " on" : "");
    };
    const dirty = h("span", { class: "dirtyflag" });
    for (const [k, el] of Object.entries(f)) el.addEventListener("input", () => { p[k] = k === "Name" ? el.value : +el.value; drawChecks(); drawMap(); });
    agentSel.addEventListener("change", () => { p.Agent = +agentSel.value; drawChecks(); drawMap(); });
    box.append(h("h3", { id: "plot-form" }, p.id ? `Plot ${p.id}` : "New plot", " ", dirty),
      h("div", { class: "grid" }, field("Name", f.Name), field("Offered by", agentSel), field("Rent", h("div", {}, f.Rent, " gold / week")), field("Min level", f.MinLevel),
        field("Top-left", h("div", {}, "X ", f.X, " Y ", f.Y)), field("Size", h("div", {}, f.W, " x ", f.H, " tiles"))),
      checks,
      h("div", { class: "bar" }, saveBtn,
        p.id ? h("button", { onclick: () => { const o = S.c.plots.find(v => v.id === p.id); if (o) selectPlot(o); } }, "Revert") : null,
        h("button", { class: "danger", onclick: plotDelete }, p.id ? "Delete" : "Discard"),
        h("button", { onclick: () => { if (plotConfirmDiscard()) { M.plotSel = null; drawSide(); drawMap(); } } }, "Deselect"),
        h("button", { onclick: () => { M.cx = p.X + p.W / 2; M.cy = p.Y + p.H / 2; M.scale = Math.max(M.scale, 16); drawMap(); } }, "Zoom to")));
    if (!agents.length) box.append(h("p", { class: "chk-warn" }, "No NPC in this database has Faction 'Land Agent'. Apply content/migrations/2026-10-14-plots.sql (Gideon and Sharon Gazump), or set an NPC's Faction to Land Agent."));
    drawChecks();
    s.append(box);
  }
  const list = (S.c.plots || []).slice().sort((a, b) => a.Name.localeCompare(b.Name));
  s.append(h("h3", {}, `All plots (${list.length})`));
  if (!list.length) s.append(h("p", { class: "hint" }, "No plots yet. Drag on the map outside Foundation Forest to make one."));
  for (const v of list) {
    const iss = plotIssues(v);
    s.append(h("div", { class: "plotrow" + (p && p.id === v.id ? " sel" : ""), onclick: () => { if (plotConfirmDiscard()) selectPlot(v, true); } },
      h("span", { class: "sw", style: "background:" + plotColour(v) }), h("b", {}, v.Name),
      h("div", { class: "hint" }, `${v.W} x ${v.H} at ${v.X}, ${v.Y} · ${v.Rent}g/wk · Lv ${v.MinLevel}+ · ${agentName(v.Agent)}`),
      iss.errors.length ? h("div", { class: "chk-err" }, "✖ " + iss.errors[0]) : null));
  }
  if (agents.length) s.append(h("h3", {}, "Land Agents"), ...agents.map(n => h("div", { class: "plotrow", onclick: () => { M.cx = n.SpawnX; M.cy = n.SpawnY; drawMap(); } },
    h("span", { class: "sw", style: "background:" + plotColour({ Agent: n.id }) }), h("b", {}, n.Name), h("div", { class: "hint" },
      `at ${n.SpawnX}, ${n.SpawnY} · ${(S.c.plots || []).filter(p => +p.Agent === n.id).length} own plots, plus ${(S.c.plots || []).filter(p => !+p.Agent).length} any-agent plots`))));
}
document.addEventListener("keydown", e => {
  if (S.tab !== "map" || !M.cv || document.querySelector(".modal")) return;
  const inForm = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if (M.tool === "plot" && M.plotSel) {
    if (e.key === "Enter" && (!inForm || e.target.closest("#plot-form-box"))) { e.preventDefault(); plotSave(); return; }
    if (inForm) return;
    if (e.key === "Escape") { if (plotConfirmDiscard()) { M.plotSel = null; drawSide(); drawMap(); } return; }
    if (e.key === "Delete") { e.preventDefault(); plotDelete(); return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault(); const p = M.plotSel;
      if (e.shiftKey) { p.W = Math.max(1, Math.min(PLOT_MAX, p.W + d[0])); p.H = Math.max(1, Math.min(PLOT_MAX, p.H + d[1])); }
      else { p.X += d[0]; p.Y += d[1]; }
      drawMap(); clearTimeout(M.sideT); M.sideT = setTimeout(drawSide, 150);
    }
  } else if (!inForm && e.key === "Escape" && M.drag) { M.drag = null; drawMap(); }
  else if (!inForm && (e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (M.tool === "paint") { e.preventDefault(); M.brush.flip = !M.brush.flip; drawSide(); drawMap(); }
    else if (M.tool === "select" && M.sel) { e.preventDefault(); flipSelected(); }
  }
});

// ------------------------------------------------------------------ items
const STATS = ["STR", "INT", "STA"];
function assetInput(val, onchange, filter) {
  const id = "assets-" + (filter || "all").replace(/\W/g, "");
  let dl = document.getElementById(id);
  if (!dl) { dl = h("datalist", { id }); document.body.append(dl); }
  dl.replaceChildren(...assetPaths().filter(p => !filter || p.includes(filter)).map(p => h("option", { value: p })));
  const i = h("input", { type: "text", list: id, value: val || "", style: "width:100%" });
  i.addEventListener("input", () => onchange(i.value));
  return i;
}
function renderItems(m) {
  const form = h("div", { class: "form" });
  const pick = it => { S.item = it; m.replaceChildren(listPanel(() => S.c.items, i => `${i.Name} · ${i.Type} (${i.id})`, () => S.item && S.item.id, it => go("#item/" + it.id), newI), form); itemForm(form, it); };
  const newI = () => pick({ id: 0, Name: "New item", Type: "reagent", Val: "0", ImgPath: "assets/items/Mould.png", Desc: "", Worth: 1, Attributes: "None", Subtype: "None", Cooldown: 1 });
  pick(S.item ? (S.c.items.find(i => i.id === S.item.id) || S.c.items[0]) : S.c.items[0]);
}
function itemForm(form, it) {
  form.textContent = "";
  if (!it) return;
  if (it.id) syncHash("#item/" + it.id);
  const dl = (id, vals) => { let d = document.getElementById(id); if (!d) { d = h("datalist", { id }); document.body.append(d); } d.replaceChildren(...vals.map(v => h("option", { value: v }))); };
  dl("itemTypes", S.c.itemTypes); dl("itemSubtypes", S.c.subtypes.concat(["None"]));
  const f = {
    Name: txt(it.Name), Type: h("input", { type: "text", list: "itemTypes", value: it.Type }), Val: txt(it.Val),
    Desc: area(it.Desc), Worth: num(it.Worth), Subtype: h("input", { type: "text", list: "itemSubtypes", value: it.Subtype || "None" }),
    Cooldown: num(it.Cooldown),
  };
  let imgPath = it.ImgPath;
  const img = sprite(imgPath);
  const imgIn = assetInput(imgPath, v => { imgPath = v; img.src = assetURL(v); });
  const pickImg = () => openPicker({ title: `Image for ${f.Name.value || "this item"}`, groups: itemSpriteGroups, recentKey: "item", value: imgPath,
    onPick: v => { if (v) { imgPath = v; imgIn.value = v; img.src = assetURL(v); } } });
  img.addEventListener("click", pickImg); img.style.cursor = "pointer"; img.title = "Pick an image";
  // attributes: None or STAT,N;STAT,N
  const attrs = String(it.Attributes || "None") === "None" || !it.Attributes ? [] : String(it.Attributes).split(";").map(p => p.split(","));
  const attrBox = h("div");
  const drawAttrs = () => {
    attrBox.textContent = "";
    attrs.forEach((a, i) => {
      const st = h("select", { onchange: () => (a[0] = st.value) }, STATS.map(x => h("option", { value: x }, x))); st.value = a[0];
      const n = num(+a[1]); n.oninput = () => (a[1] = n.value);
      attrBox.append(h("div", { class: "rw" }, st, "+", n, h("button", { onclick: () => { attrs.splice(i, 1); drawAttrs(); } }, "×")));
    });
    attrBox.append(h("button", { onclick: () => { attrs.push(["STR", "1"]); drawAttrs(); } }, "+ Stat bonus"));
  };
  drawAttrs();
  const collect = () => ({
    id: it.id, Name: f.Name.value, Type: f.Type.value.trim(), Val: f.Val.value, ImgPath: imgPath, Desc: f.Desc.value,
    Worth: +f.Worth.value, Attributes: attrs.length ? attrs.map(a => `${a[0]},${+a[1]}`).join(";") : "None",
    Subtype: f.Subtype.value.trim() || "None", Cooldown: +f.Cooldown.value,
  });
  const drops = S.c.loot.filter(l => l.ItemID === it.id);
  form.append(h("h2", {}, it.id ? `${it.Name} (${it.id})` : "New item"),
    h("div", { class: "grid" },
      field("Name", f.Name), field("Image", h("div", {}, img, " ", h("button", { onclick: pickImg }, "Pick…"), " ", imgIn)), field("Type", f.Type),
      field("Val", h("div", {}, f.Val, h("div", { class: "hint" }, "Power for gear, HP for potions, mount speed, spell id… depends on Type."))),
      field("Description", f.Desc), field("Worth", f.Worth), field("Attributes", attrBox),
      field("Subtype", h("div", {}, f.Subtype, h("div", { class: "hint" }, "Gear weight (Light / Medium / Heavy / High Mastery) or None."))),
      field("Cooldown", h("div", {}, f.Cooldown, " seconds"))),
    h("p", { class: "hint" }, "Ids 1-3 (starter gear), 11 (Gold), 23, 53, 116-118 and 135 are used by the game code: edit them but don't delete them."),
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => { const id = await save("items", collect()); S.item = { id }; renderTab(); } }, "Save item"),
      h("button", { onclick: () => { const c = collect(); c.id = 0; c.Name += " (copy)"; S.item = c; itemForm(form, c); } }, "Duplicate"),
      it.id ? h("button", { class: "danger", onclick: async () => { if (await del("items", it.id)) { S.item = null; renderTab(); } } }, "Delete") : null),
    h("h3", {}, "Dropped by"),
    drops.length ? drops.map(l => h("div", {}, `${(S.enemyBy[l.EnemyID] || {}).Name || "#" + l.EnemyID}: ${l.Chance}% × ${l.Amount} (±${l.AmountVariance})`)) : h("div", { class: "hint" }, "Nothing drops this."),
    h("p", { class: "hint" }, "Edit drops in the Loot tab."));
}

// ------------------------------------------------------------------ loot
function renderLoot(m) {
  const form = h("div", { class: "form" });
  const pick = e => { S.lootEnemy = e; m.replaceChildren(listPanel(() => S.c.enemies, e => `${e.Name} (${S.c.loot.filter(l => l.EnemyID === e.id).length})`, () => S.lootEnemy && S.lootEnemy.id, it => go("#loot/" + it.id), null), form); lootForm(form, e); };
  pick(S.lootEnemy ? S.enemyBy[S.lootEnemy.id] : S.c.enemies[0]);
}
function lootForm(form, e) {
  form.textContent = "";
  if (!e) return;
  syncHash("#loot/" + e.id);
  form.append(h("h2", {}, `${e.Name} loot`), h("div", { class: "bar" }, sprite(e.Image), h("span", { class: "hint" }, `HP ${e.HP} · ATK ${e.ATK} · XP ${e.XP}`)),
    h("p", { class: "hint" }, "Chance is a percent per kill. Amount ± variance is how many drop."));
  const rows = S.c.loot.filter(l => l.EnemyID === e.id);
  const row = l => {
    const it = itemSelect(l.ItemID), ch = num(l.Chance), am = num(l.Amount), va = num(l.AmountVariance);
    const icon = sprite((S.itemBy[l.ItemID] || {}).ImgPath); icon.style.width = icon.style.height = "32px";
    it.onchange = () => (icon.src = assetURL((S.itemBy[it.value] || {}).ImgPath));
    return h("div", { class: "rw" }, icon, it, "chance", ch, "%  amount", am, "±", va,
      h("button", { class: "primary", onclick: async () => { await save("loot", { id: l.id, EnemyID: e.id, ItemID: +it.value, Chance: +ch.value, Amount: +am.value, AmountVariance: +va.value }); lootForm(form, e); } }, "Save"),
      l.id ? h("button", { class: "danger", onclick: async () => { if (await del("loot", l.id)) lootForm(form, e); } }, "×") : null);
  };
  const box = h("div", { class: "rewards" }, rows.map(row));
  form.append(box, h("button", { onclick: () => box.append(row({ id: 0, ItemID: S.c.items[0].id, Chance: 10, Amount: 1, AmountVariance: 0 })) }, "+ Drop"));
}

// ------------------------------------------------------------------ sprites
function renderSprites(m) {
  const base = txt(ASSETS.base, "https://example.com/BrawlQuest-Client/"); base.style.width = "420px";
  const folder = h("input", { type: "file", webkitdirectory: true, multiple: true });
  folder.addEventListener("change", () => pickLocalFolder(folder.files));
  const radio = (mode, label) => { const r = h("input", { type: "radio", name: "am", onchange: () => setAssetMode(mode) }); r.checked = ASSETS.mode === mode; return h("label", { style: "display:block;margin:6px 0" }, r, " ", label); };
  m.append(h("div", { class: "form" }, h("h2", {}, "Where sprites come from"),
    radio("bundled", "Bundled with the editor (copy of the client's new-ui art; default)"),
    radio("local", "My BrawlQuest-Client folder (newest art, nothing uploaded)"), h("div", { style: "margin-left:24px" }, folder,
      h("div", { class: "hint" }, ASSETS.local ? `${ASSETS.localList.length} sprites loaded.` : "Pick the client folder. Files stay on your computer.")),
    radio("url", "A URL that serves the client folder"), h("div", { style: "margin-left:24px" }, base, " ",
      h("button", { onclick: () => { ASSETS.base = base.value.trim(); localStorage.setItem("bqAssetBase", ASSETS.base); setAssetMode("url"); } }, "Use URL"),
      h("div", { class: "hint" }, "The BrawlQuest-Client repo is private, so raw.githubusercontent / jsDelivr links don't work without making it public."))));
}

// ------------------------------------------------------------------ shell
// ------------------------------------------------------------------ navigation
// Hash routes, so Back/Forward work and links can be shared:
//   #map  #map/X,Y  #map/npc/ID[/X,Y]  #quests  #quest/ID  #quest/ID/line/Offer  #quest/ID/step/N
//   #npcs  #npc/ID  #npc/ID/quest/QID  #dialog/IDENTIFIER  #items  #item/ID  #loot/ENEMYID  #export  #sprites
function link(hash, text, cls) { return h("a", { href: hash, class: cls || null }, text); }
function go(hash) { if (location.hash === hash) applyRoute(); else location.hash = hash; }
function syncHash(hash) { if (location.hash !== hash && !S.routing) history.replaceState(null, "", hash); }
function highlight(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  if (el.focus && /TEXTAREA|INPUT/.test(el.tagName)) el.focus({ preventScroll: true });
}
function nodeOwners(ident) {
  if (!S.ownerCache) {
    S.ownerCache = {};
    for (const n of S.c.npcs) if (n.Conversation) for (const c of reachable(n.Conversation)) (S.ownerCache[c.Identifier] = S.ownerCache[c.Identifier] || []).push(n);
  }
  return S.ownerCache[ident] || [];
}
const TABS = ["studio", "map", "quests", "npcs", "items", "mobs", "effects", "loot", "export", "sprites"];
async function applyRoute() {
  if (!BQ.has() || !S.c) return;
  const [kind, a, b, c] = location.hash.slice(1).split("/").map(decodeURIComponent);
  let target = null;
  if (kind === "quest") { S.tab = "quests"; S.quest = { id: +a }; if (b === "line") target = "qline-" + c; if (b === "step") target = "qline-step-" + c; }
  else if (kind === "npc") { S.tab = "npcs"; S.npc = { id: +a }; if (b === "quest") target = "npcq-" + c; }
  else if (kind === "dialog") {
    const owner = nodeOwners(a)[0];
    if (owner) { S.tab = "npcs"; S.npc = { id: owner.id }; } else { S.tab = "dialog"; S.orphan = a; }
    target = "node-" + a;
  }
  else if (kind === "item") { S.tab = "items"; S.item = { id: +a }; }
  else if (kind === "loot") { S.tab = "loot"; S.lootEnemy = { id: +a }; }
  else if (kind === "mob") { S.tab = "mobs"; S.mob = { id: +a }; }
  else if (kind === "effect") { S.tab = "effects"; S.effect = { id: +a }; }
  else if (kind === "plot") { S.tab = "map"; M.tool = "plot"; const p = (S.c.plots || []).find(v => v.id === +a); if (p) { M.plotSel = { ...p, Agent: +p.Agent || 0 }; M.plotOrig = JSON.stringify(plotRow(M.plotSel)); S.focus = { x: p.X + p.W / 2, y: p.Y + p.H / 2 }; } }
  else if (kind === "studio") { S.tab = "studio"; qsRoute(a, b); }
  else if (kind === "map" && a === "npc") {
    // #map/npc/ID[/X,Y]: the NPCs tool with that NPC picked, at a placement
    S.tab = "map"; M.tool = "npc"; M.npcMode = "existing"; M.npcPick = +b;
    const n = S.npcBy[+b], at = c ? c.split(",").map(Number) : null, sp = n && (at ? { X: at[0], Y: at[1] } : spawnsOf(n)[0]);
    if (sp) { S.focus = { x: sp.X, y: sp.Y }; M.npcSel = { npc: +b, x: sp.X, y: sp.Y }; }
  }
  else if (kind === "map") { S.tab = "map"; if (a) { const [x, y] = a.split(",").map(Number); S.focus = { x, y }; M.sel = { x, y }; } }
  else if (TABS.includes(kind)) S.tab = kind;
  S.routing = true;
  try { await renderTab(); } finally { S.routing = false; }
  if (target && !document.getElementById(target) && target.startsWith("qline-step-")) target = "qstep-" + target.slice(11);
  if (target) highlight(target);
}
window.addEventListener("hashchange", applyRoute);

// Quests that involve an NPC, and in what role.
function npcRoles(n) {
  const out = [];
  for (const q of S.c.quests) {
    const roles = [];
    if (q.Giver === n.id) roles.push({ role: "gives", lines: [["Offer", `#quest/${q.id}/line/Offer`], ["Accept", `#quest/${q.id}/line/Accept`]] });
    if (q.TurnIn === n.id) roles.push({ role: "takes hand-in", lines: [["In progress", `#quest/${q.id}/line/Progress`], ["Complete", `#quest/${q.id}/line/Complete`]] });
    parseJSON(q.Steps, []).forEach((st, i) => { if (st.Type === "talk" && st.NPC === n.id) roles.push({ role: `talk step ${i + 1}`, lines: [[`Step ${i + 1} line`, `#quest/${q.id}/step/${i}`]] }); });
    if (roles.length) out.push({ q, roles });
  }
  return out.sort((x, y) => x.q.Level - y.q.Level || x.q.id - y.q.id);
}
function npcQuestList(n, compact) {
  const rel = npcRoles(n);
  if (!rel.length) return h("div", { class: "hint" }, "No quests involve this NPC.");
  return h("div", { class: "qrel" }, rel.map(({ q, roles }) => h("div", { class: "qcard", id: "npcq-" + q.id },
    h("div", {}, h("span", { class: "lvl" }, "Lv " + q.Level), " ", link("#quest/" + q.id, q.Title, "qt"), " ",
      roles.map(r => h("span", { class: "role" }, r.role))),
    compact ? null : h("div", { class: "why" }, (q.Summary || q.Offer || "").slice(0, 200)),
    h("div", { class: "lines" }, roles.flatMap(r => r.lines).map(([l, hsh]) => [link(hsh, l), " "])))));
}
function npcQuestPanel(n) {
  return h("div", { class: "panel" }, h("h3", {}, "Quests involving this NPC"),
    h("p", { class: "hint" }, "Quest lines live on the quest. The free-chat dialogue tree is further down."), npcQuestList(n, false));
}
function questLinks(q) {
  const steps = parseJSON(q.Steps, []);
  const npcL = id => (S.npcBy[id] ? link("#npc/" + id, S.npcBy[id].Name) : h("span", { class: "hint" }, "none"));
  const enemyBy = Object.fromEntries(S.c.enemies.map(e => [e.Name, e]));
  const itemByName = Object.fromEntries(S.c.items.map(i => [i.Name, i]));
  const targets = [];
  steps.forEach((st, i) => {
    let l = null;
    const all = [st.Target, ...stepExtras(st)].filter(Boolean);
    if ((st.Type === "kill" || st.Type === "boss") && all.some(n => enemyBy[n])) l = h("span", {}, st.Type + " ", all.map((n, j) => [j ? " or " : "", enemyBy[n] ? link("#loot/" + enemyBy[n].id, n) : n]));
    else if (st.Type === "collect" && all.some(n => itemByName[n])) l = h("span", {}, st.Type + " ", all.map((n, j) => [j ? " or " : "", itemByName[n] ? link("#item/" + itemByName[n].id, n) : n]));
    else if (["craft", "equip"].includes(st.Type) && itemByName[st.Target]) l = link("#item/" + itemByName[st.Target].id, `${st.Type} ${st.Target}`);
    else if (st.Type === "talk" && S.npcBy[st.NPC]) l = link("#npc/" + st.NPC, "talk to " + S.npcBy[st.NPC].Name);
    else if (st.Type === "reach") l = link(`#map/${st.X},${st.Y}`, `reach ${st.X},${st.Y}`);
    else l = h("span", {}, `${st.Type} ${st.Target || st.Count || ""}`);
    targets.push(h("div", {}, link(`#quest/${q.id}/step/${i}`, `${i + 1}.`), " ", l));
  });
  const pre = parseJSON(q.Prereqs, []).map(id => S.c.quests.find(x => x.id === id)).filter(Boolean);
  const next = S.c.quests.filter(x => parseJSON(x.Prereqs, []).includes(q.id));
  const rw = parseJSON(q.Rewards, []).filter(r => S.itemBy[r.ItemID]);
  const ql = list => list.length ? list.map(x => [link("#quest/" + x.id, `${x.Title} (Lv ${x.Level})`), "  "]) : h("span", { class: "hint" }, "none");
  return h("div", { class: "panel", id: "quest-links" },
    h("div", { class: "grid" },
      field("Giver", h("div", {}, npcL(q.Giver), q.Giver ? [" · ", link(`#npc/${q.Giver}/quest/${q.id}`, "see in NPC")] : null)),
      field("Turn in to", h("div", {}, npcL(q.TurnIn), q.TurnIn && q.TurnIn !== q.Giver ? [" · ", link(`#npc/${q.TurnIn}/quest/${q.id}`, "see in NPC")] : null)),
      field("Objectives", h("div", {}, targets.length ? targets : h("span", { class: "hint" }, "none"))),
      rw.length ? field("Rewards", h("div", {}, rw.map(r => [link("#item/" + r.ItemID, `${S.itemBy[r.ItemID].Name} ×${r.Amount}`), "  "]))) : null,
      field("Needs first", h("div", {}, ql(pre))),
      field("Leads to", h("div", {}, ql(next)))));
}
// Quest dialogue, in order: every line is quest_def text (Offer, Accept,
// Progress, Complete columns; talk steps' Line inside Steps JSON). "edit" or a
// click on the text opens it inline; Save writes that one field to the stored
// row (so Save .db / Export SQL include it) and to the form above, leaving
// other unsaved form edits alone.
const QUEST_LINES = ["Offer", "Accept", "Progress", "Complete"];
function questConversation(q, f, steps, stepBox) {
  const who = id => (S.npcBy[id] ? S.npcBy[id].Name : "NPC");
  const box = h("div", { class: "panel", id: "quest-dialogue" });
  let editing = null; // key being edited ("Offer" … or "step:N")
  const stored = () => S.c.quests.find(x => x.id === q.id);
  async function commit(key, text) {
    const row = { ...stored() };
    if (!row.id) throw new Error("save the quest first");
    if (key.startsWith("step:")) {
      const i = +key.slice(5), ss = parseJSON(row.Steps, []);
      if (!ss[i] || ss[i].Type !== "talk" || ss[i].NPC !== steps[i].NPC) throw new Error(`step ${i + 1} differs from the saved quest: press Save on the quest first`);
      ss[i].Line = text; row.Steps = JSON.stringify(ss);
      steps[i].Line = text;
      const inp = stepBox.querySelector(`.qline-in[data-step="${i}"]`); if (inp) inp.value = text;
    } else { row[key] = text; f[key].value = text; }
    q[key.startsWith("step:") ? "Steps" : key] = row[key.startsWith("step:") ? "Steps" : key];
    await save("quest_def", row);
  }
  const lines = () => [
    ...QUEST_LINES.map(k => ({ key: k, id: k === "Accept" ? 0 : k === "Offer" ? +f.Giver.value : +f.TurnIn.value, label: k === "Progress" ? "in progress" : k.toLowerCase(), text: f[k].value })),
    ...steps.map((st, i) => st.Type === "talk" ? { key: "step:" + i, id: st.NPC, label: `step ${i + 1}`, text: st.Line || "" } : null).filter(Boolean)];
  function bubble(l) {
    const b = h("div", { class: "bubble", "data-line": l.key });
    const speaker = h("b", {}, l.id ? link("#npc/" + l.id, who(l.id)) : l.key === "Accept" ? "On accepting" : "(no NPC)", ` (${l.label}): `);
    if (editing !== l.key) {
      const t = h("span", { class: "btext", title: "Click to edit" }, l.text || h("span", { class: "hint" }, l.key.startsWith("step:") ? "(no line)" : "(empty)"));
      t.addEventListener("click", () => open(l.key));
      b.append(speaker, t, " ", h("a", { href: "#", class: "edit", onclick: ev => { ev.preventDefault(); open(l.key); } }, "edit"));
      return b;
    }
    const ta = h("textarea", { class: "bedit", rows: 2 }); ta.value = l.text;
    const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
    const done = async ok => {
      if (ok) { try { await commit(l.key, ta.value); } catch (e) { status(e.message, true); return; } status(`Saved the ${l.label} line of quest ${q.id} in memory. Use Save .db or Export SQL to keep it.`); }
      editing = null; refresh();
    };
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", ev => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); done(false); }
      else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); done(true); }
    });
    b.append(speaker, ta, h("div", { class: "bar", style: "margin:4px 0 0" },
      h("button", { class: "primary", onclick: () => done(true) }, "Save"), h("button", { onclick: () => done(false) }, "Cancel"),
      h("span", { class: "hint" }, "Enter saves, Shift+Enter new line, Esc cancels. Tokens like {SHIELD} and {INTERACT} are kept as typed.")));
    requestAnimationFrame(() => { grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    return b;
  }
  function open(key) { editing = key; refresh(); }
  function refresh() { box.replaceChildren(h("h3", {}, "Quest dialogue, in order"), ...lines().map(bubble)); }
  refresh();
  box.refresh = () => { if (!editing) refresh(); };
  box.open = open;
  return box;
}
// Every piece of dialogue of a saved quest, as in Quest Studio's quest sheet:
// the giver's chat that brings it up, the offer and its answers, after
// accepting, talk objectives at other NPCs, in progress, the hand-in, and the
// quests it unlocks. Each edit saves at once (with undo in Quest Studio).
function questDialogueEmbed(q) {
  const box = h("div", { class: "panel qs-embed", id: "quest-dialogue" });
  const draw = () => {
    const cur = S.c.quests.find(x => x.id === q.id); if (!cur) { box.replaceChildren(); return; }
    const keep = window.scrollY;
    box.replaceChildren(h("h3", {}, "Dialogue ", h("span", { class: "hint" }, "everything said in this quest, in order: click any line or answer to edit it; saved as you go. "), h("a", { href: "#studio/journey/" + q.id }, "Quest Studio")),
      qsQuestInConvo(cur, { ids: true }));
    window.scrollTo(0, keep);
  };
  QS.embed = { el: box, draw };
  draw();
  return box;
}
function renderOrphan(m) {
  const c = S.convBy[S.orphan];
  const f = h("div", { class: "form" }, h("h2", {}, "Dialogue node " + S.orphan),
    h("p", { class: "hint" }, c ? "No NPC's greeting leads to this node, so players can't reach it." : "There is no node with this identifier."));
  if (c) f.append(nodeEditor(c, false, {}));
  m.append(f);
}

function switchTab(t) { go("#" + t); }

async function renderTab() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  if (!S.routing && TABS.includes(S.tab) && !/^#(quest|npc|item|loot|mob|effect|dialog|map|plot|studio)\//.test(location.hash)) syncHash("#" + S.tab);
  document.body.classList.toggle("in-studio", S.tab === "studio");
  const m = $("#main"); m.textContent = ""; window.onmousemove = window.onmouseup = null; M.cv = null;
  try {
    if (S.tab === "map") { if (!S.world) { status("Loading world…"); await loadWorld(); status(""); } renderMap(m); }
    else if (S.tab === "studio") renderStudio(m);
    else if (S.tab === "quests") renderQuests(m);
    else if (S.tab === "npcs") renderNPCs(m);
    else if (S.tab === "items") renderItems(m);
    else if (S.tab === "loot") renderLoot(m);
    else if (S.tab === "mobs") renderMobs(m);
    else if (S.tab === "effects") renderEffects(m);
    else if (S.tab === "sprites") renderSprites(m);
    else if (S.tab === "dialog") renderOrphan(m);
    else await renderExport(m);
  } catch (e) { status(e.message, true); }
}

document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => { switchTab(b.dataset.tab); setMenu(false); }));
// Phones: one slim bar (Open, Save, Menu); Menu opens the tabs, GitHub and History.
function setMenu(open) { const hd = $("header"); hd.classList.toggle("menu-open", open); $("#btn-menu").setAttribute("aria-expanded", open); $("#btn-menu").textContent = open ? "Close" : "Menu"; }
$("#btn-menu").addEventListener("click", () => setMenu(!$("header").classList.contains("menu-open")));
for (const id of ["#btn-github", "#btn-history"]) $(id).addEventListener("click", () => setMenu(false));
$("#open").addEventListener("change", e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; });
$("#btn-save").addEventListener("click", saveDb);
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
window.addEventListener("beforeunload", e => { if (BQ.st.dirty) { e.preventDefault(); e.returnValue = ""; } });
syncFile();
BQ.init().catch(e => status("Could not load sql.js: " + e.message, true));
