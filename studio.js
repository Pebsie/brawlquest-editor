"use strict";
// Quest Studio: the player journey, the cast and their dialogue in one place.
// Reads and writes the same tables as the Quests and NPCs tabs (quest_def,
// npc, conversation) through save()/api(), so History autosave, Save .db and
// Export SQL all see the edits. Server rules mirrored from the API's
// questline.go / npc.go (questMenuLocked, talkTo, chatNode):
//   menu order: turn-ins, talk steps, offers, in progress; offer -> "I'll do
//   it." / "Not right now."; accept -> "On it." (closes); turn-in ->
//   "Anything else?" (the NPC's next offer, else the greeting); Land Agents
//   add [Plot] rows. A quest is available when not started, every prereq is
//   done and the player's level >= MinLevel. Objectives all count at once
//   unless Sequential ("in order") is ticked.
const QS = {
  view: "journey", arg: null, sel: null, undo: [], redo: [], cam: null, layout: "story", filter: "",
  play: { level: 1, done: new Set(), state: {}, follow: true, log: [] }, preview: null, notes: null,
};
const QS_ICON = { kill: "assets/ui/studio/target.png", boss: "assets/ui/studio/crown.png", collect: "assets/ui/studio/loot.png", talk: "assets/ui/studio/alert.png",
  reach: "assets/ui/studio/arrow.png", use: "assets/ui/studio/alert-item.png", craft: "assets/items/reagent/Hilt.png", equip: "assets/items/reagent/Metal.png", level: "assets/ui/studio/xp.png" };
const USE_ACTIONS = ["swing", "shield", "sprint", "potion", "mount", "spell", "build", "stat", "forge", "party", "enchant"];
const LINE_COLOURS = ["#f2cc59", "#7ac8ff", "#99e699", "#ff9ad5", "#ffb45a", "#c59bff", "#6be3d6", "#ff7b6b", "#d8e07a", "#a0a8ff"];
const qsImg = p => assetURL(p && p !== "None" ? p : "assets/npc/Person.png");
const pix = (path, cls, title) => h("img", { class: "px " + (cls || ""), src: qsImg(path), alt: "", title: title || null, draggable: "false", onerror: e => { e.target.src = "assets/error.png"; } });
const qById = id => S.c.quests.find(q => q.id === id);
const qPre = q => parseJSON(q.Prereqs, []).map(Number);
const qSteps = q => parseJSON(q.Steps, []);
const qRw = q => parseJSON(q.Rewards, []);
const enemyByName = () => (QS._eb && QS._eb.v === S.c ? QS._eb.m : (QS._eb = { v: S.c, m: Object.fromEntries(S.c.enemies.map(e => [e.Name.toLowerCase(), e])) }).m);
const itemByName = () => (QS._ib && QS._ib.v === S.c ? QS._ib.m : (QS._ib = { v: S.c, m: Object.fromEntries(S.c.items.map(e => [e.Name.toLowerCase(), e])) }).m);
const stepNames = s => [s.Target, ...stepExtras(s)].map(x => String(x || "").trim()).filter(Boolean);
function stepIcon(s) {
  const n = stepNames(s)[0] || "";
  if ((s.Type === "kill" || s.Type === "boss") && enemyByName()[n.toLowerCase()]) return enemyByName()[n.toLowerCase()].Image;
  if (["collect", "craft", "equip"].includes(s.Type) && itemByName()[n.toLowerCase()]) return itemByName()[n.toLowerCase()].ImgPath;
  if (s.Type === "talk" && S.npcBy[s.NPC]) return S.npcBy[s.NPC].ImgPath;
  return QS_ICON[s.Type] || "assets/error.png";
}
function stepLabel(s) {
  const names = stepNames(s), c = +s.Count || 1;
  if (s.Type === "kill") return `Kill ${c} ${names.join(" or ") || "?"}`;
  if (s.Type === "boss") return `Defeat ${names.join(" or ") || "?"}`;
  if (s.Type === "collect") return `Collect ${c} ${names.join(" or ") || "?"}`;
  if (s.Type === "talk") return `Talk to ${S.npcBy[s.NPC] ? S.npcBy[s.NPC].Name : "?"}`;
  if (s.Type === "reach") return `Reach ${s.X},${s.Y}`;
  if (s.Type === "use") return `${s.Target || "use"} x${c}`;
  if (s.Type === "level") return `Reach level ${c}`;
  return `${s.Type} ${s.Target || ""}`;
}
// Zone (world.Name) at a tile, once the world is loaded.
const zoneAt = (x, y) => { if (!S.world) return ""; const t = S.world.tiles.get(x + "," + y); return t ? S.world.strings[t[4]] || "" : ""; };

// ------------------------------------------------------------------ analysis
// Everything the map flags, worked out from content data only.
function qsAnalyse() {
  if (QS._an && QS._an.v === S.c) return QS._an;
  const quests = S.c.quests, by = new Map(quests.map(q => [q.id, q]));
  const issues = new Map(), add = (id, sev, code, msg) => { if (!issues.has(id)) issues.set(id, []); issues.get(id).push({ sev, code, msg }); };
  const pre = new Map(quests.map(q => [q.id, qPre(q)]));
  const next = new Map(quests.map(q => [q.id, []]));
  for (const q of quests) for (const p of pre.get(q.id)) if (by.has(p)) next.get(p).push(q.id);
  // cycles (Tarjan-lite: DFS colours)
  const colour = new Map(), inCycle = new Set();
  const dfs = (id, stack) => {
    colour.set(id, 1); stack.push(id);
    for (const p of pre.get(id)) {
      if (!by.has(p)) continue;
      if (colour.get(p) === 1) { for (let i = stack.indexOf(p); i < stack.length; i++) inCycle.add(stack[i]); }
      else if (!colour.get(p)) dfs(p, stack);
    }
    stack.pop(); colour.set(id, 2);
  };
  for (const q of quests) if (!colour.get(q.id)) dfs(q.id, []);
  // reachable: fixpoint over prerequisites (levels rise as you play)
  const ok = new Set(); let grew = true;
  while (grew) { grew = false; for (const q of quests) if (!ok.has(q.id) && pre.get(q.id).every(p => ok.has(p))) { ok.add(q.id); grew = true; } }
  // depth = longest prerequisite chain
  const depth = new Map(), seen = new Set();
  const dep = id => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0; seen.add(id);
    let d = 0; for (const p of pre.get(id) || []) if (by.has(p)) d = Math.max(d, dep(p) + 1);
    depth.set(id, d); return d;
  };
  quests.forEach(q => dep(q.id));
  for (const q of quests) {
    const ps = pre.get(q.id);
    const missing = ps.filter(p => !by.has(p));
    if (missing.length) add(q.id, "err", "prereq", `Needs quest ${missing.join(", ")} first, which doesn't exist`);
    if (ps.includes(q.id)) add(q.id, "err", "cycle", "Needs itself first");
    else if (inCycle.has(q.id)) add(q.id, "err", "cycle", "Circular prerequisites: it can never unlock");
    if (!ok.has(q.id) && !missing.length && !inCycle.has(q.id)) {
      // blocked by something earlier: name the quest that is actually broken
      let b = null; const st = [...ps], seen2 = new Set();
      while (st.length && !b) { const x = st.shift(); if (seen2.has(x)) continue; seen2.add(x); const xq = by.get(x); if (!xq) continue; if (pre.get(x).some(p => !by.has(p)) || inCycle.has(x)) b = xq; else st.push(...pre.get(x)); }
      add(q.id, "warn", "blocked", b ? `Locked for everyone: it comes after “${b.Title}”, which can never unlock` : "Locked for everyone: an earlier quest can never unlock");
    }
    else if (!ok.has(q.id) && missing.length) add(q.id, "err", "unreach", `Unreachable for every player, and so is everything after it`);
    if (!S.npcBy[q.Giver]) add(q.id, "err", "giver", q.Giver ? `Giver NPC ${q.Giver} doesn't exist` : "Nobody gives this quest");
    if (!S.npcBy[q.TurnIn]) add(q.id, "err", "turnin", q.TurnIn ? `Hand-in NPC ${q.TurnIn} doesn't exist` : "Nobody takes the hand-in");
    const pl = ps.map(p => by.get(p)).filter(Boolean).map(p => p.Level);
    if (pl.length) {
      const mx = Math.max(...pl);
      if (q.Level < mx) add(q.id, "warn", "level", `Level drops: Lv ${q.Level} after a Lv ${mx} quest`);
      else if (q.Level - mx > 3) add(q.id, "warn", "level", `Level jump: Lv ${mx} to Lv ${q.Level}`);
    } else if (q.Level > 1 && !ps.length) add(q.id, "info", "root", "Starts a new line: no prerequisites");
    if (q.MinLevel > q.Level) add(q.id, "warn", "level", `Min level ${q.MinLevel} is above the quest level ${q.Level}`);
    if (!(+q.XP) && !(+q.Gold) && !qRw(q).length) add(q.id, "warn", "reward", "No reward: no XP, gold or items");
    const steps = qSteps(q);
    if (!steps.length) add(q.id, "err", "steps", "No objectives");
    steps.forEach((s, i) => {
      const names = stepNames(s);
      if ((s.Type === "kill" || s.Type === "boss")) { const bad = names.filter(n => !enemyByName()[n.toLowerCase()]); if (!names.length || bad.length) add(q.id, "err", "target", `Objective ${i + 1}: no enemy called ${bad.join(", ") || "(blank)"}`); }
      if (s.Type === "collect" || s.Type === "craft") { const bad = names.filter(n => !itemByName()[n.toLowerCase()]); if (!names.length || bad.length) add(q.id, "warn", "target", `Objective ${i + 1}: no item called ${bad.join(", ") || "(blank)"}`); }
      if (s.Type === "talk" && !S.npcBy[s.NPC]) add(q.id, "err", "target", `Objective ${i + 1}: talk to a missing NPC`);
      if (s.Type === "talk" && !String(s.Line || "").trim()) add(q.id, "warn", "line", `Objective ${i + 1}: the NPC has nothing to say`);
      if (!String(s.Text || "").trim()) add(q.id, "warn", "text", `Objective ${i + 1} has no tracker text`);
    });
    if (steps.length > 1 && !+q.Sequential && steps.slice(1).some(s => s.Type === "talk" || s.Type === "reach")) add(q.id, "info", "order", "Objectives all count at once. Tick \"in order\" if it's a story sequence");
    for (const k of ["Offer", "Complete"]) if (!String(q[k] || "").trim()) add(q.id, "warn", "line", `No ${k.toLowerCase()} line`);
  }
  // questlines: connected groups of prerequisite links
  const line = new Map(); let nLines = 0;
  for (const q of [...quests].sort((a, b) => a.Level - b.Level || a.id - b.id)) {
    if (line.has(q.id)) continue;
    const L = nLines++, stack = [q.id];
    while (stack.length) { const id = stack.pop(); if (line.has(id) || !by.has(id)) continue; line.set(id, L); stack.push(...pre.get(id), ...next.get(id)); }
  }
  const lines = [...Array(nLines)].map((_, i) => {
    const qs = quests.filter(q => line.get(q.id) === i).sort((a, b) => (depth.get(a.id) - depth.get(b.id)) || a.Level - b.Level);
    const zones = [...new Set(qs.map(q => q.Zone).filter(Boolean))];
    return { i, quests: qs, name: qs.length > 1 ? `From “${qs[0].Title}”` : qs[0].Title, zones, minLevel: Math.min(...qs.map(q => q.Level)), colour: LINE_COLOURS[i % LINE_COLOURS.length] };
  }).sort((a, b) => a.minLevel - b.minLevel || b.quests.length - a.quests.length);
  // NPC problems: dead-end dialogue, missing greeting
  const npcIssues = new Map(), addN = (id, sev, msg) => { if (!npcIssues.has(id)) npcIssues.set(id, []); npcIssues.get(id).push({ sev, msg }); };
  for (const n of S.c.npcs) {
    if (n.Conversation && !S.convBy[n.Conversation]) addN(n.id, "err", `Greeting node "${n.Conversation}" doesn't exist`);
    for (const c of n.Conversation ? reachable(n.Conversation) : []) {
      if (c.missing && c.Identifier !== n.Conversation) addN(n.id, "err", `Dead end: an answer leads to missing node "${c.Identifier}"`);
    }
  }
  return (QS._an = { v: S.c, issues, pre, next, depth, ok, inCycle, line, lines, npcIssues });
}
const sevRank = { err: 3, warn: 2, info: 1 };
const worstSev = list => (list || []).reduce((a, x) => (sevRank[x.sev] > sevRank[a] ? x.sev : a), "") || "";

// ------------------------------------------------------------------ saving, undo, redo
// Every studio edit goes through commit(): stored in the working db at once
// (History autosaves it), with an undo record.
async function qsCommit(table, row, label) {
  const list = { quest_def: S.c.quests, npc: S.c.npcs, conversation: S.c.conversations }[table];
  const before = row.id ? list.find(r => r.id === row.id) : null;
  const id = await save(table, row);
  QS.undo.push({ table, before: before ? { ...before } : null, after: { ...row, id }, label });
  if (QS.undo.length > 200) QS.undo.shift();
  QS.redo = [];
  qsToast(`${label}. Saved in the working db (autosaved to History).`);
  qsBar();
  return id;
}
async function qsApplyRec(rec, dir) {
  const target = dir === "undo" ? rec.before : rec.after;
  if (target) await api("save", { table: rec.table, row: { ...target } });
  else await api("delete", { table: rec.table, id: rec.after.id });
  await loadAll();
}
async function qsUndo() {
  const r = QS.undo.pop(); if (!r) return;
  try { await qsApplyRec(r, "undo"); QS.redo.push(r); qsToast("Undid: " + r.label); } catch (e) { status(e.message, true); }
  qsRerender();
}
async function qsRedo() {
  const r = QS.redo.pop(); if (!r) return;
  try { await qsApplyRec(r, "redo"); QS.undo.push(r); qsToast("Redid: " + r.label); } catch (e) { status(e.message, true); }
  qsRerender();
}
function qsToast(msg) {
  let t = $("#qs-toast");
  if (!t) { t = h("div", { id: "qs-toast", class: "qs-toast" }); document.body.append(t); }
  t.textContent = msg; t.classList.remove("on"); void t.offsetWidth; t.classList.add("on");
  clearTimeout(QS._tt); QS._tt = setTimeout(() => t.classList.remove("on"), 2600);
}
document.addEventListener("keydown", e => {
  if (S.tab !== "studio" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? qsRedo() : qsUndo(); }
  else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); qsRedo(); }
});

// Quest edits: patch one quest's stored row.
async function qsPatchQuest(id, patch, label) {
  const q = qById(id); if (!q) return;
  const row = { ...q, ...patch };
  await qsCommit("quest_def", row, label || `Edited ${q.Title}`);
  qsRerender();
}

// ------------------------------------------------------------------ shell
// Routes: #studio  #studio/journey[/QID]  #studio/cast  #studio/npc/ID  #studio/play  #studio/new[/AFTER]
function qsRoute(a, b) {
  QS.view = a || "journey"; QS.arg = b;
  if (QS.view === "journey" && b) QS.sel = +b;
}
function renderStudio(m) {
  if (!S.c.hasQuestline) { m.append(h("div", { class: "form" }, h("h2", {}, "Quest Studio needs quest_def"), h("p", {}, "Apply the questline migration first (see the Quests tab)."))); return; }
  const root = h("div", { class: "qs", id: "qs" });
  m.append(root);
  QS.root = root;
  if (!S.world) loadWorld().then(() => { QS._an = null; if (S.tab === "studio" && QS.view !== "journey") qsRerender(); }).catch(() => {});
  qsRerender();
}
function qsGo(view, arg) { go("#studio/" + view + (arg != null ? "/" + arg : "")); }
function qsRerender() {
  const root = QS.root; if (!root || !root.isConnected) return;
  root.replaceChildren(qsNav(), h("div", { class: "qs-body", id: "qs-body" }));
  const body = $("#qs-body");
  if (QS.view === "cast") qsCast(body);
  else if (QS.view === "npc") qsNpcSheet(body, +QS.arg);
  else if (QS.view === "play") qsPlay(body);
  else if (QS.view === "new") { qsJourney(body); qsNewQuest(QS.arg ? +QS.arg : 0); }
  else qsJourney(body);
  qsBar();
}
function qsNav() {
  const an = qsAnalyse();
  const probs = [...an.issues.values()].flat().filter(x => x.sev === "err").length;
  const tab = (v, label, icon) => h("button", { class: "qs-tab" + (QS.view === v || (v === "cast" && QS.view === "npc") ? " on" : ""), onclick: () => qsGo(v) }, pix(icon, "ico"), label);
  return h("div", { class: "qs-nav" },
    h("span", { class: "qs-logo" }, "QUEST STUDIO"),
    tab("journey", "Journey", "assets/ui/studio/arrow.png"),
    tab("cast", "Cast", "assets/npc/Adventurer.png"),
    tab("play", "Playtest", "assets/ui/studio/xp.png"),
    h("span", { class: "qs-sp" }),
    probs ? h("button", { class: "qs-probs", title: "Errors the journey map found: show the list", onclick: () => { QS.showProbs = true; qsGo("journey"); } }, pix("assets/ui/studio/alert.png", "ico"), String(probs), h("span", { class: "qs-pw" }, ` problem${probs === 1 ? "" : "s"}`)) : null,
    h("button", { class: "qs-btn", id: "qs-undo", title: "Undo (Ctrl+Z)", onclick: qsUndo }, "Undo"),
    h("button", { class: "qs-btn", id: "qs-redo", title: "Redo (Ctrl+Shift+Z)", onclick: qsRedo }, "Redo"),
    h("button", { class: "qs-btn hot", onclick: () => qsNewQuest(QS.sel || 0) }, "+ Quest"),
    h("button", { class: "qs-btn hot", onclick: () => qsNewNpc() }, "+ NPC"));
}
function qsBar() {
  const u = $("#qs-undo"), r = $("#qs-redo");
  if (u) { u.disabled = !QS.undo.length; u.title = QS.undo.length ? "Undo: " + QS.undo[QS.undo.length - 1].label : "Nothing to undo"; }
  if (r) { r.disabled = !QS.redo.length; r.title = QS.redo.length ? "Redo: " + QS.redo[QS.redo.length - 1].label : "Nothing to redo"; }
}

// ------------------------------------------------------------------ pan and zoom
// Pointer (mouse, pen, touch) drag pans; two fingers pinch; wheel pans
// (trackpad scroll) and ctrl+wheel / trackpad pinch zooms.
function qsPanZoom(view, world, cam, onChange) {
  const apply = () => { world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.z})`; view.style.setProperty("--z", cam.z); if (onChange) onChange(); };
  const zoomAt = (px, py, f) => {
    const z = Math.max(0.2, Math.min(2.5, cam.z * f)); f = z / cam.z;
    cam.x = px - (px - cam.x) * f; cam.y = py - (py - cam.y) * f; cam.z = z; apply();
  };
  const pts = new Map(); let last = null, moved = 0;
  view.addEventListener("pointerdown", e => {
    if (e.target.closest("button, input, textarea, select, .qs-port, a")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    view.setPointerCapture(e.pointerId); moved = 0;
    last = pts.size === 2 ? pinchInfo() : { x: e.clientX, y: e.clientY };
  });
  const pinchInfo = () => { const [a, b] = [...pts.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  view.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = view.getBoundingClientRect();
    if (pts.size === 2) {
      const p = pinchInfo();
      if (last && last.d) { cam.x += p.cx - last.cx; cam.y += p.cy - last.cy; zoomAt(p.cx - r.left, p.cy - r.top, p.d / last.d); }
      last = p; moved += 10;
    } else if (last) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) { view.classList.add("panning"); cam.x += dx; cam.y += dy; apply(); }
      last = { x: e.clientX, y: e.clientY };
    }
  });
  const up = e => { pts.delete(e.pointerId); view.classList.remove("panning"); last = pts.size === 1 ? { ...[...pts.values()][0] } : null; if (moved > 4) view.dataset.dragged = "1"; };
  view.addEventListener("pointerup", up); view.addEventListener("pointercancel", up);
  view.addEventListener("click", e => { if (view.dataset.dragged) { e.stopPropagation(); e.preventDefault(); delete view.dataset.dragged; } }, true);
  view.addEventListener("wheel", e => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    else if (e.deltaMode === 1 || (!e.deltaX && Math.abs(e.deltaY) >= 100 && Number.isInteger(e.deltaY))) zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15); // a mouse wheel notch
    else { cam.x -= e.deltaX; cam.y -= e.deltaY; apply(); }
  }, { passive: false });
  apply();
  return { apply, zoomAt };
}

// ------------------------------------------------------------------ journey map
const QJ = { CW: 216, CH: 108, GX: 70, GY: 22, BAND: 54, LEFT: 110, TOP: 40 };
function qsLayout(an) {
  const pos = new Map(), bands = [];
  const col = q => (QS.layout === "level" ? Math.max(0, q.Level - 1) : an.depth.get(q.id) || 0);
  const big = an.lines.filter(l => l.quests.length > 1), loose = an.lines.filter(l => l.quests.length === 1);
  const groups = [...big.map(l => ({ name: l.name, colour: l.colour, quests: l.quests, zones: l.zones, i: l.i }))];
  if (loose.length) groups.push({ name: "Standalone quests", colour: "#9a9a9a", quests: loose.flatMap(l => l.quests).sort((a, b) => col(a) - col(b) || a.Level - b.Level), zones: [], loose: true });
  let y = QJ.TOP; let maxX = 0;
  for (const g of groups) {
    const occ = new Map(); let maxRow = 0;
    const qs = [...g.quests].sort((a, b) => col(a) - col(b) || a.Level - b.Level || a.id - b.id);
    for (const q of qs) {
      const c = col(q);
      const pr = an.pre.get(q.id).map(p => pos.get(p)).filter(p => p && p.band === bands.length);
      let row = pr.length ? Math.min(...pr.map(p => p.row)) : 0;
      if (!occ.has(c)) occ.set(c, new Set());
      while (occ.get(c).has(row)) row++;
      occ.get(c).add(row); maxRow = Math.max(maxRow, row);
      const x = QJ.LEFT + c * (QJ.CW + QJ.GX);
      pos.set(q.id, { x, y: y + 26 + row * (QJ.CH + QJ.GY), row, band: bands.length, colour: g.colour });
      maxX = Math.max(maxX, x + QJ.CW);
    }
    const hgt = 26 + (maxRow + 1) * (QJ.CH + QJ.GY);
    bands.push({ ...g, y, h: hgt });
    y += hgt + QJ.BAND;
  }
  return { pos, bands, w: maxX + 200, h: y };
}
function qsCard(q, an, p) {
  const iss = an.issues.get(q.id) || [], sev = worstSev(iss);
  const steps = qSteps(q), seq = !!+q.Sequential;
  const giver = S.npcBy[q.Giver], turn = S.npcBy[q.TurnIn];
  const ps = QS.play.overlay ? qsPlayStatus(q) : "";
  const hit = QS.filter && !(`${q.Title} ${q.Zone} ${q.id} ${npcName(q.Giver)} ${npcName(q.TurnIn)}`.toLowerCase().includes(QS.filter.toLowerCase()));
  const card = h("div", { class: `qs-card ${sev ? "sev-" + sev : ""} ${QS.sel === q.id ? "sel" : ""} ${ps ? "ps-" + ps : ""} ${hit ? "dim" : ""}`, "data-id": q.id,
    style: `left:${p.x}px;top:${p.y}px;--lc:${p.colour}`, tabindex: 0,
    onclick: () => qsSelect(q.id), onkeydown: e => { if (e.key === "Enter") qsSelect(q.id); } },
    h("div", { class: "qc-top" }, h("span", { class: "qc-lv", title: `Level ${q.Level}, min level ${q.MinLevel}` }, q.Level), h("span", { class: "qc-t", title: q.Title }, q.Title),
      iss.length ? h("span", { class: "qc-iss " + sev, title: iss.map(x => x.msg).join("\n") }, sev === "info" ? "i" : "!") : null),
    h("div", { class: "qc-mid" },
      h("span", { class: "qc-who", title: `Given by ${giver ? giver.Name : "nobody"}` }, giver ? pix(giver.ImgPath, "pt") : h("span", { class: "pt none" }, "?")),
      h("span", { class: "qc-arrow" }, ">"),
      h("span", { class: "qc-steps " + (seq ? "seq" : "par"), title: (seq ? "In order:\n" : "All at once:\n") + steps.map(stepLabel).join("\n") },
        steps.slice(0, 4).map((s, i) => [i && seq ? h("i", { class: "qc-then" }) : null, pix(stepIcon(s), "si " + s.Type)]), steps.length > 4 ? h("b", {}, "+" + (steps.length - 4)) : null),
      h("span", { class: "qc-arrow" }, ">"),
      h("span", { class: "qc-who", title: `Hand in to ${turn ? turn.Name : "nobody"}` }, turn ? pix(turn.ImgPath, "pt") : h("span", { class: "pt none" }, "?"))),
    h("div", { class: "qc-bot" }, h("span", { class: "qc-zone" }, q.Zone || "no zone"),
      h("span", { class: "qc-rw" }, +q.XP ? [pix("assets/ui/studio/xp.png", "mi"), q.XP] : null, " ", +q.Gold ? [pix("assets/ui/studio/gold.png", "mi"), q.Gold] : null,
        qRw(q).slice(0, 2).map(r => S.itemBy[r.ItemID] ? pix(S.itemBy[r.ItemID].ImgPath, "mi", S.itemBy[r.ItemID].Name) : null))),
    ps === "done" ? h("span", { class: "qc-stamp" }, pix("assets/ui/studio/complete.png", "mi")) : null,
    h("button", { class: "qs-port", title: "Drag onto another quest: it then needs this one first. Click: add a quest after this one.", "data-id": q.id }, "+"));
  return card;
}
function qsJourney(body) {
  const an = qsAnalyse(), L = qsLayout(an);
  QS._layout = L;
  const view = h("div", { class: "qs-view", id: "qs-view" });
  const world = h("div", { class: "qs-world", style: `width:${L.w}px;height:${L.h}px` });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "qs-edges"); svg.setAttribute("width", L.w); svg.setAttribute("height", L.h);
  const sv = (tag, a) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  for (const b of L.bands) {
    world.append(h("div", { class: "qs-band" + (b.loose ? " loose" : ""), style: `top:${b.y}px;height:${b.h}px;width:${L.w}px;--lc:${b.colour}` },
      h("div", { class: "qs-band-l" }, h("b", {}, b.name), " ", h("span", {}, `${b.quests.length} quest${b.quests.length === 1 ? "" : "s"}${b.zones.length ? " - " + b.zones.slice(0, 4).join(", ") + (b.zones.length > 4 ? "..." : "") : ""}`))));
  }
  const edgeHit = [];
  for (const q of S.c.quests) {
    const p2 = L.pos.get(q.id); if (!p2) continue;
    const x2 = p2.x, y2 = p2.y + QJ.CH / 2;
    an.pre.get(q.id).forEach((pid, k) => {
      const p1 = L.pos.get(pid);
      if (!p1) {
        // missing prerequisite: a ghost card to the left
        const gx = x2 - 54, gy = y2 - 14 + k * 30;
        world.append(h("div", { class: "qs-ghost", style: `left:${gx - 40}px;top:${gy}px`, title: `Quest ${pid} doesn't exist` }, `#${pid}?`));
        svg.append(sv("path", { d: `M${gx + 20} ${gy + 14} L${x2} ${y2}`, class: "edge bad" }));
        return;
      }
      const x1 = p1.x + QJ.CW, y1 = p1.y + QJ.CH / 2;
      const from = qById(pid);
      const bad = an.inCycle.has(q.id) && an.inCycle.has(pid);
      const jump = from && (q.Level < from.Level || q.Level - from.Level > 3);
      const back = x2 <= x1;
      const d = back ? `M${x1} ${y1} C${x1 + 60} ${y1 + 80}, ${x2 - 60} ${y2 + 80}, ${x2} ${y2}` : `M${x1} ${y1} C${x1 + QJ.GX / 2 + 10} ${y1}, ${x2 - QJ.GX / 2 - 10} ${y2}, ${x2} ${y2}`;
      svg.append(sv("path", { d, class: "edge" + (bad ? " bad" : jump ? " jump" : ""), style: `stroke:${bad ? "" : p1.colour}` }));
      const hp = sv("path", { d, class: "edge-hit" }); hp.dataset.from = pid; hp.dataset.to = q.id;
      edgeHit.push(hp);
    });
  }
  edgeHit.forEach(e => svg.append(e));
  const tmp = sv("path", { class: "edge drag", d: "" }); svg.append(tmp);
  world.prepend(svg);
  for (const q of S.c.quests) { const p = L.pos.get(q.id); if (p) world.append(qsCard(q, an, p)); }
  view.append(world);
  // toolbar
  const search = h("input", { type: "search", class: "qs-in", placeholder: "Find a quest, NPC or zone...", value: QS.filter });
  search.addEventListener("input", () => { QS.filter = search.value; world.querySelectorAll(".qs-card").forEach(c => { const q = qById(+c.dataset.id); c.classList.toggle("dim", !!QS.filter && !(`${q.Title} ${q.Zone} ${q.id} ${npcName(q.Giver)} ${npcName(q.TurnIn)}`.toLowerCase().includes(QS.filter.toLowerCase()))); }); });
  search.addEventListener("keydown", e => { if (e.key === "Enter") { const c = world.querySelector(".qs-card:not(.dim)"); if (c) qsFocus(+c.dataset.id); } });
  const seg2 = (v, l) => h("button", { class: "qs-btn" + (QS.layout === v ? " on" : ""), onclick: () => { QS.layout = v; QS.cam = null; qsRerender(); } }, l);
  const probList = qsProblemList(an);
  const tools = h("div", { class: "qs-tools" }, seg2("story", "Story order"), seg2("level", "By level"), search,
    h("button", { class: "qs-btn", title: "Zoom out", onclick: () => pz.zoomAt(view.clientWidth / 2, view.clientHeight / 2, 1 / 1.25) }, "-"),
    h("button", { class: "qs-btn", title: "Zoom in", onclick: () => pz.zoomAt(view.clientWidth / 2, view.clientHeight / 2, 1.25) }, "+"),
    h("button", { class: "qs-btn", title: "Fit the whole journey", onclick: () => { fit(); pz.apply(); } }, "Fit"),
    h("label", { class: "qs-chk", title: "Colour quests by the Playtest character: done, available now, locked" }, h("input", { type: "checkbox", checked: !!QS.play.overlay, onchange: e => { QS.play.overlay = e.target.checked; qsRerender(); } }), ` Lv ${QS.play.level} player`),
    h("button", { class: "qs-btn" + (QS.showProbs ? " on" : ""), onclick: () => { QS.showProbs = !QS.showProbs; qsRerender(); } }, `Problems (${probList.count})`));
  const legend = h("div", { class: "qs-legend" },
    h("span", {}, h("i", { class: "lg err" }), "broken"), h("span", {}, h("i", { class: "lg warn" }), "check"), h("span", {}, h("i", { class: "lg info" }), "note"),
    h("span", {}, pix("assets/ui/studio/target.png", "mi"), "→", pix("assets/ui/studio/loot.png", "mi"), " in order"), h("span", {}, pix("assets/ui/studio/target.png", "mi"), pix("assets/ui/studio/loot.png", "mi"), " all at once"),
    h("span", { class: "hint" }, "Drag to pan, pinch or Ctrl+scroll to zoom. Drag a card's + onto another quest to link them."));
  const wrap = h("div", { class: "qs-jwrap" }, tools, view, legend, QS.showProbs ? probList.el : null, h("div", { class: "qs-drawer", id: "qs-drawer" }));
  body.append(wrap);
  // camera
  const fit = () => {
    const vw = view.clientWidth || 1000, vh = view.clientHeight || 600;
    const z = Math.max(0.2, Math.min(1, Math.min(vw / L.w, vh / Math.min(L.h, 1400))));
    Object.assign(QS.cam, { z, x: (vw - L.w * z) / 2 > 0 ? (vw - L.w * z) / 2 : 10, y: 10 });
  };
  const fresh = !QS.cam; if (fresh) QS.cam = { x: 0, y: 0, z: 1 };
  const pz = qsPanZoom(view, world, QS.cam);
  QS._pz = pz; QS._view = view;
  requestAnimationFrame(() => { if (fresh) { Object.assign(QS.cam, { z: view.clientWidth < 700 ? 0.6 : 0.8, x: 10, y: 4 }); pz.apply(); } if (QS.sel && QS.view === "journey" && QS.arg) { qsFocus(QS.sel); QS.arg = null; } });
  // links: drag from a card's port
  let drag = null;
  world.addEventListener("pointerdown", e => {
    const port = e.target.closest(".qs-port"); if (!port) return;
    e.stopPropagation(); e.preventDefault();
    const p = L.pos.get(+port.dataset.id);
    drag = { from: +port.dataset.id, x1: p.x + QJ.CW, y1: p.y + QJ.CH / 2, moved: 0, id: e.pointerId };
    port.setPointerCapture(e.pointerId);
  });
  world.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = world.getBoundingClientRect(), z = QS.cam.z;
    const x = (e.clientX - r.left) / z, y = (e.clientY - r.top) / z;
    drag.moved++;
    tmp.setAttribute("d", `M${drag.x1} ${drag.y1} C${drag.x1 + 60} ${drag.y1}, ${x - 60} ${y}, ${x} ${y}`);
    world.querySelectorAll(".qs-card.target").forEach(c => c.classList.remove("target"));
    const over = document.elementFromPoint(e.clientX, e.clientY); const c = over && over.closest(".qs-card");
    if (c && +c.dataset.id !== drag.from) c.classList.add("target");
  });
  const endDrag = async e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; tmp.setAttribute("d", "");
    world.querySelectorAll(".qs-card.target").forEach(c => c.classList.remove("target"));
    const over = document.elementFromPoint(e.clientX, e.clientY); const c = over && over.closest(".qs-card");
    if (d.moved < 3 || !c) { if (d.moved < 3) qsNewQuest(d.from); return; }
    const to = +c.dataset.id; if (to === d.from) return;
    await qsLink(d.from, to);
  };
  world.addEventListener("pointerup", endDrag); world.addEventListener("pointercancel", () => { drag = null; tmp.setAttribute("d", ""); });
  svg.addEventListener("click", e => {
    const p = e.target.closest(".edge-hit"); if (!p) return;
    e.stopPropagation();
    qsEdgePop(e.clientX, e.clientY, +p.dataset.from, +p.dataset.to);
  });
  if (QS.sel && qById(QS.sel)) qsQuestSheet(QS.sel);
}
function qsProblemList(an) {
  const rows = [];
  for (const q of S.c.quests) for (const x of an.issues.get(q.id) || []) rows.push({ q, ...x });
  for (const n of S.c.npcs) for (const x of an.npcIssues.get(n.id) || []) rows.push({ n, ...x });
  rows.sort((a, b) => sevRank[b.sev] - sevRank[a.sev]);
  const count = rows.filter(r => r.sev !== "info").length;
  const el = h("div", { class: "qs-problems", id: "qs-problems" }, h("div", { class: "qs-ph" }, h("b", {}, "What the map found"), h("button", { class: "qs-btn", onclick: () => { QS.showProbs = false; qsRerender(); } }, "x")),
    rows.length ? rows.map(r => h("div", { class: "qs-prob " + r.sev, onclick: () => (r.q ? qsFocus(r.q.id, true) : qsGo("npc", r.n.id)) },
      h("i", { class: "lg " + r.sev }), h("b", {}, r.q ? r.q.Title : r.n.Name), " ", h("span", {}, r.msg))) : h("p", {}, "Nothing. Lovely."));
  return { el, count };
}
function qsFocus(id, open) {
  const L = QS._layout, p = L && L.pos.get(id), view = QS._view;
  if (!p || !view) return;
  QS.cam.z = Math.max(QS.cam.z, 0.8);
  QS.cam.x = view.clientWidth / 2 - (p.x + QJ.CW / 2) * QS.cam.z - (view.clientWidth > 900 ? 180 : 0);
  QS.cam.y = view.clientHeight / 2 - (p.y + QJ.CH / 2) * QS.cam.z;
  QS._pz.apply();
  const c = view.querySelector(`.qs-card[data-id="${id}"]`);
  if (c) { c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); }
  if (open) qsSelect(id);
}
function qsSelect(id) {
  QS.sel = id;
  document.querySelectorAll(".qs-card.sel").forEach(c => c.classList.remove("sel"));
  const c = document.querySelector(`.qs-card[data-id="${id}"]`); if (c) c.classList.add("sel");
  syncHash("#studio/journey/" + id);
  qsQuestSheet(id);
}
function qsAncestors(id) {
  const out = new Set(), st = [id];
  while (st.length) { const x = st.pop(); const q = qById(x); if (!q) continue; for (const p of qPre(q)) if (!out.has(p)) { out.add(p); st.push(p); } }
  return out;
}
async function qsLink(from, to) {
  const q = qById(to), f = qById(from);
  const pre = qPre(q);
  if (pre.includes(from)) { qsToast(`${q.Title} already needs ${f.Title}`); return; }
  if (from === to || qsAncestors(from).has(to)) { qsToast(`That would make a loop: ${f.Title} already comes after ${q.Title}`); return; }
  await qsPatchQuest(to, { Prereqs: JSON.stringify([...pre, from]) }, `${q.Title} now needs ${f.Title} first`);
}
function qsEdgePop(x, y, from, to) {
  document.querySelectorAll(".qs-pop").forEach(p => p.remove());
  const f = qById(from), t = qById(to);
  const pop = h("div", { class: "qs-pop", style: `left:${Math.min(x, innerWidth - 260)}px;top:${y}px` },
    h("div", {}, h("b", {}, t.Title), " needs ", h("b", {}, f.Title), " first."),
    h("div", { class: "qs-row" }, h("button", { class: "qs-btn hot", onclick: async () => { pop.remove(); await qsPatchQuest(to, { Prereqs: JSON.stringify(qPre(t).filter(p => p !== from)) }, `Unlinked ${f.Title} from ${t.Title}`); } }, "Unlink"),
      h("button", { class: "qs-btn", onclick: () => pop.remove() }, "Keep")));
  document.body.append(pop);
  setTimeout(() => document.addEventListener("pointerdown", function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("pointerdown", off); } }), 0);
}

// ------------------------------------------------------------------ inline editing
// Click the text to edit it where it is. Enter (or leaving the field) saves,
// Shift+Enter is a new line in long text, Esc cancels.
function qsInline(value, onSave, o = {}) {
  const span = h(o.tag || "span", { class: "qs-ed " + (o.cls || "") + (value ? "" : " empty"), tabindex: 0, title: o.title || "Click to edit", "data-ph": o.ph || "" }, value || o.ph || "(empty)");
  const open = () => {
    if (span.querySelector("input,textarea")) return;
    const el = o.multi ? h("textarea", { class: "qs-edit", rows: 2 }) : h("input", { class: "qs-edit", type: o.num ? "number" : "text" });
    el.value = value ?? "";
    if (o.list) el.setAttribute("list", o.list);
    const grow = () => { if (o.multi) { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; } };
    let done = false;
    const finish = async ok => {
      if (done) return; done = true;
      const v = o.num ? +el.value : el.value;
      if (ok && v !== value) { try { await onSave(v); } catch (e) { status(e.message, true); qsToast(e.message); } }
      else span.replaceChildren(value || o.ph || "(empty)");
    };
    el.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === "Enter" && !(o.multi && e.shiftKey)) { e.preventDefault(); finish(true); }
    });
    el.addEventListener("blur", () => finish(true));
    el.addEventListener("input", grow);
    span.replaceChildren(el); el.focus(); el.select && !o.multi && el.select(); grow();
  };
  span.addEventListener("click", e => { e.stopPropagation(); open(); });
  span.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === span) { e.preventDefault(); open(); } });
  span.open = open;
  return span;
}
// A picker in a small pixel window: NPCs, enemies, items.
function qsPickModal(title, entries, onPick, o = {}) {
  const close = () => { ov.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const q = h("input", { type: "search", class: "qs-in", placeholder: "Search..." });
  const grid = h("div", { class: "qs-pgrid" });
  const sel = new Set(o.selected || []);
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    grid.replaceChildren(...entries.filter(e => !f || (e.label + " " + (e.note || "")).toLowerCase().includes(f)).slice(0, 400).map(e =>
      h("button", { class: "qs-pcell" + (sel.has(e.value) ? " on" : ""), title: e.note || e.label, onclick: () => {
        if (o.multi) { sel.has(e.value) ? sel.delete(e.value) : sel.add(e.value); draw(); } else { close(); onPick(e.value); }
      } }, pix(e.img, "pc"), h("span", {}, e.label), e.note ? h("small", {}, e.note) : null)));
  };
  q.addEventListener("input", draw);
  const ov = h("div", { class: "qs-modal", onclick: e => { if (e.target === ov) close(); } },
    h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, title.toUpperCase()), h("button", { class: "qs-x", onclick: close }, "x")),
      h("div", { class: "qs-wbody" }, q, grid,
        o.multi ? h("div", { class: "qs-row" }, h("button", { class: "qs-btn hot", onclick: () => { close(); onPick([...sel]); } }, "Use these"), h("span", { class: "hint" }, "Pick every enemy that should count")) : null)));
  document.body.append(ov); document.addEventListener("keydown", esc, true);
  draw(); q.focus();
}
const npcEntries = () => S.c.npcs.map(n => ({ value: n.id, img: n.ImgPath, label: n.Name, note: `${n.Faction || "no faction"} - ${n.SpawnX},${n.SpawnY}` }));
const enemyEntries = () => S.c.enemies.map(e => ({ value: e.Name, img: e.Image, label: e.Name, note: `HP ${e.HP} - XP ${e.XP}` }));
const itemEntries = () => S.c.items.map(i => ({ value: i.id, img: i.ImgPath, label: i.Name, note: i.Type }));

// ------------------------------------------------------------------ quest sheet (drawer)
function qsQuestSheet(id) {
  const d = $("#qs-drawer"); if (!d) return;
  const q = qById(id); if (!q) { d.classList.remove("open"); return; }
  const keep = d.dataset.id === String(id) ? d.scrollTop : 0;
  d.dataset.id = id; d.classList.add("open");
  const an = qsAnalyse(), iss = an.issues.get(id) || [];
  const P = (patch, label) => qsPatchQuest(id, patch, label);
  const steps = qSteps(q);
  const setSteps = (ss, label) => P({ Steps: JSON.stringify(ss) }, label);
  const who = (nid, role, key) => {
    const n = S.npcBy[nid];
    return h("div", { class: "qs-who" },
      h("button", { class: "qs-portrait", title: `Change who ${role}`, onclick: () => qsPickModal(`Who ${role}?`, npcEntries(), v => P({ [key]: +v }, `${npcName(+v)} ${role} ${q.Title}`)) }, n ? pix(n.ImgPath, "big") : h("span", { class: "big none" }, "?")),
      h("div", {}, h("small", {}, role), n ? h("a", { href: "#studio/npc/" + n.id }, n.Name) : h("b", { class: "bad" }, "nobody")));
  };
  const pre = qPre(q), next = an.next.get(id) || [];
  const fixFor = pid => {
    // the likeliest meant quest: highest level below this one, same zone first, not after this one
    const after = new Set([id]); let grew = true; while (grew) { grew = false; for (const x of S.c.quests) if (!after.has(x.id) && qPre(x).some(p => after.has(p))) { after.add(x.id); grew = true; } }
    const c = S.c.quests.filter(x => !after.has(x.id) && x.Level <= q.Level && !(an.issues.get(x.id) || []).some(i => i.code === "prereq" || i.code === "cycle"));
    c.sort((a, b) => (b.Zone === q.Zone) - (a.Zone === q.Zone) || b.Level - a.Level || Math.abs(a.id - pid) - Math.abs(b.id - pid));
    return c[0];
  };
  const chipQ = (pid, rm) => { const p = qById(pid); if (!p && rm) { const f = fixFor(pid); if (f) return h("span", { class: "qs-chip bad" }, `#${pid} (missing)`, h("button", { title: "Remove", onclick: () => P({ Prereqs: JSON.stringify(pre.filter(x => x !== pid)) }, `${q.Title} no longer needs #${pid}`) }, "x"), h("button", { class: "qs-mini fix", title: `Same zone, just before it: Lv ${f.Level} ${f.Title}`, onclick: () => P({ Prereqs: JSON.stringify(pre.map(x => (x === pid ? f.id : x))) }, `${q.Title} now comes after ${f.Title}`) }, `fix: after “${f.Title}”?`)); }
    return h("span", { class: "qs-chip" + (p ? "" : " bad") }, p ? h("a", { href: "#", onclick: e => { e.preventDefault(); qsFocus(pid, true); } }, `Lv ${p.Level} ${p.Title}`) : `#${pid} (missing)`, rm ? h("button", { title: "Remove", onclick: () => P({ Prereqs: JSON.stringify(pre.filter(x => x !== pid)) }, `${q.Title} no longer needs ${p ? p.Title : "#" + pid}`) }, "x") : null); };
  const addPre = h("select", { class: "qs-sel" }, h("option", { value: "" }, "+ needs..."), S.c.quests.filter(x => x.id !== id && !pre.includes(x.id) && !qsAncestors(x.id).has(id)).map(x => h("option", { value: x.id }, `Lv ${x.Level} - ${x.Title}`)));
  addPre.onchange = () => addPre.value && qsLink(+addPre.value, id);
  // objectives
  const stepRow = (s, i) => {
    const ss = () => qSteps(qById(id));
    const upd = (fn, label) => { const a = ss(); fn(a[i]); setSteps(a, label); };
    const names = stepNames(s);
    let targets = null;
    if (s.Type === "kill" || s.Type === "boss") targets = h("span", { class: "qs-targets" }, names.map(n => h("span", { class: "qs-chip" + (enemyByName()[n.toLowerCase()] ? "" : " bad") }, pix(enemyByName()[n.toLowerCase()] ? enemyByName()[n.toLowerCase()].Image : "assets/error.png", "mi"), n)),
      h("button", { class: "qs-mini", title: "Pick the enemies that count", onclick: () => qsPickModal("Which enemies count?", enemyEntries(), list => upd(x => { x.Target = list[0] || ""; setStepExtras(x, list.slice(1)); }, `Objective ${i + 1}: ${list.join(" or ")}`), { multi: true, selected: names }) }, names.length ? "change" : "+ enemy"));
    else if (s.Type === "collect" || s.Type === "craft" || s.Type === "equip") targets = h("span", { class: "qs-targets" }, names.map(n => h("span", { class: "qs-chip" + (itemByName()[n.toLowerCase()] || s.Type === "equip" ? "" : " bad") }, itemByName()[n.toLowerCase()] ? pix(itemByName()[n.toLowerCase()].ImgPath, "mi") : null, n)),
      h("button", { class: "qs-mini", onclick: () => qsPickModal("Which item?", itemEntries(), v => upd(x => { x.Target = S.itemBy[v].Name; delete x.Targets; }, `Objective ${i + 1}: ${S.itemBy[v].Name}`)) }, names.length ? "change" : "+ item"));
    else if (s.Type === "talk") targets = h("span", { class: "qs-targets" }, h("button", { class: "qs-chip", onclick: () => qsPickModal("Talk to whom?", npcEntries(), v => upd(x => (x.NPC = +v), `Objective ${i + 1}: talk to ${npcName(+v)}`)) }, S.npcBy[s.NPC] ? [pix(S.npcBy[s.NPC].ImgPath, "mi"), S.npcBy[s.NPC].Name] : "pick an NPC"));
    else if (s.Type === "use") { const sel = h("select", { class: "qs-sel" }, USE_ACTIONS.map(a => h("option", { value: a }, a))); sel.value = s.Target; sel.onchange = () => upd(x => (x.Target = sel.value), `Objective ${i + 1}: ${sel.value}`); targets = sel; }
    const count = ["kill", "collect", "use", "craft", "level"].includes(s.Type) ? h("span", { class: "qs-count" }, "x", qsInline(String(+s.Count || 1), v => upd(x => (x.Count = Math.max(1, +v || 1)), `Objective ${i + 1}: count ${v}`), { num: true })) : null;
    const row = h("div", { class: "qs-step t-" + s.Type },
      h("div", { class: "qs-step-h" }, h("b", { class: "qs-n" }, i + 1), pix(stepIcon(s), "si"), h("span", { class: "qs-type" }, s.Type), targets, count, h("span", { class: "qs-sp" }),
        i ? h("button", { class: "qs-mini", title: "Move up", onclick: () => { const a = ss(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; setSteps(a, `Moved objective ${i + 1} up`); } }, "^") : null,
        h("button", { class: "qs-mini", title: "Remove", onclick: () => { const a = ss(); if (a.length < 2) { qsToast("A quest needs at least one objective"); return; } a.splice(i, 1); setSteps(a, `Removed objective ${i + 1}`); } }, "x")),
      h("div", { class: "qs-step-t" }, qsInline(s.Text, v => upd(x => (x.Text = v), `Objective ${i + 1} text`), { ph: "What the quest tracker says" })),
      s.Type === "talk" ? h("div", { class: "qs-say" }, pix(S.npcBy[s.NPC] ? S.npcBy[s.NPC].ImgPath : "", "mi"), qsInline(s.Line, v => upd(x => (x.Line = v), `${npcName(s.NPC)}'s line`), { multi: true, ph: "What they say when you get there", cls: "rh" })) : null);
    if (s.Type === "reach") {
      const tmp = { ...s };
      const mini = reachMap(tmp, () => upd(x => { x.X = tmp.X; x.Y = tmp.Y; }, `Objective ${i + 1}: reach ${tmp.X},${tmp.Y}`));
      row.append(h("div", { class: "qs-reach" }, mini.el, h("span", { class: "qs-count" }, "radius ", qsInline(String(+s.Radius || 3), v => upd(x => (x.Radius = Math.max(1, +v || 3)), `Objective ${i + 1}: radius ${v}`), { num: true }), " tiles - blue ground aura in game")));
    }
    return row;
  };
  const addStep = h("select", { class: "qs-sel" }, h("option", { value: "" }, "+ objective..."), ["kill", "reach", "collect", "talk", "use", "build", "craft", "equip", "boss", "level"].map(t => h("option", { value: t }, t)));
  addStep.onchange = () => { const t = addStep.value; if (!t) return; const a = qSteps(q); a.push(qsBlankStep(t, q)); setSteps(a, `Added a ${t} objective`); };
  const seq = !!+q.Sequential;
  // rewards
  const rw = qRw(q);
  const rwBox = h("div", { class: "qs-rw" },
    h("span", { class: "qs-chip" }, pix("assets/ui/studio/xp.png", "mi"), qsInline(String(q.XP), v => P({ XP: Math.max(0, +v || 0) }, `XP ${v}`), { num: true }), " XP"),
    h("span", { class: "qs-chip" }, pix("assets/ui/studio/gold.png", "mi"), qsInline(String(q.Gold), v => P({ Gold: Math.max(0, +v || 0) }, `Gold ${v}`), { num: true }), " gold"),
    rw.map((r, i) => h("span", { class: "qs-chip" }, S.itemBy[r.ItemID] ? pix(S.itemBy[r.ItemID].ImgPath, "mi") : null, S.itemBy[r.ItemID] ? S.itemBy[r.ItemID].Name : `item ${r.ItemID}?`, " x", qsInline(String(r.Amount), v => { const a = qRw(q); a[i].Amount = Math.max(1, +v || 1); return P({ Rewards: JSON.stringify(a) }, "Reward amount"); }, { num: true }),
      h("button", { onclick: () => { const a = qRw(q); a.splice(i, 1); P({ Rewards: JSON.stringify(a) }, "Removed a reward"); } }, "x"))),
    h("button", { class: "qs-mini", onclick: () => qsPickModal("Reward item", itemEntries(), v => { const a = qRw(q); a.push({ ItemID: +v, Amount: 1 }); P({ Rewards: JSON.stringify(a) }, `Reward: ${S.itemBy[v].Name}`); }) }, "+ item"));
  const zones = [...new Set(S.c.quests.map(x => x.Zone).filter(Boolean))].sort();
  if (!$("#qs-zones")) document.body.append(h("datalist", { id: "qs-zones" }));
  $("#qs-zones").replaceChildren(...zones.map(z => h("option", { value: z })));
  d.replaceChildren(
    h("div", { class: "qs-wtitle" }, h("span", {}, `QUEST ${q.id}`), h("span", { class: "qs-sp" }), h("a", { href: "#quest/" + q.id, class: "qs-link", title: "The full form in the Quests tab" }, "form"), h("button", { class: "qs-x", title: "Close", onclick: () => { QS.sel = null; d.classList.remove("open"); syncHash("#studio/journey"); document.querySelectorAll(".qs-card.sel").forEach(c => c.classList.remove("sel")); } }, "x")),
    h("div", { class: "qs-sheet" },
      h("div", { class: "qs-title" }, h("span", { class: "qc-lv big", title: "Quest level" }, qsInline(String(q.Level), v => P({ Level: Math.max(1, +v || 1) }, `Level ${v}`), { num: true })),
        qsInline(q.Title, v => P({ Title: v || q.Title }, `Renamed to ${v}`), { cls: "qs-h", ph: "Quest title" })),
      h("div", { class: "qs-meta" }, "Zone ", qsInline(q.Zone, v => P({ Zone: v }, `Zone ${v}`), { list: "qs-zones", ph: "zone" }), " - Act ", qsInline(String(q.Act), v => P({ Act: +v || 1 }, `Act ${v}`), { num: true }),
        " - min level ", qsInline(String(q.MinLevel), v => P({ MinLevel: Math.max(1, +v || 1) }, `Min level ${v}`), { num: true })),
      iss.length ? h("div", { class: "qs-iss" }, iss.map(x => h("div", { class: "qs-prob " + x.sev }, h("i", { class: "lg " + x.sev }), x.msg))) : null,
      h("div", { class: "qs-whos" }, who(q.Giver, "gives it", "Giver"), h("span", { class: "qs-bigarrow" }, ">>"), who(q.TurnIn, "takes the hand-in", "TurnIn")),
      h("h4", {}, "Story"),
      h("div", { class: "qs-chips" }, h("small", {}, "Needs first: "), pre.length ? pre.map(p => chipQ(p, true)) : h("span", { class: "hint" }, "nothing (a starting quest) "), addPre),
      h("div", { class: "qs-chips" }, h("small", {}, "Unlocks: "), next.length ? next.map(p => chipQ(p, false)) : h("span", { class: "hint" }, "nothing yet "), h("button", { class: "qs-mini", onclick: () => qsNewQuest(id) }, "+ quest after this")),
      h("h4", {}, "Objectives"),
      h("div", { class: "qs-seg" }, h("button", { class: seq ? "" : "on", onclick: () => seq && P({ Sequential: 0 }, "Objectives all at once") }, "All at once"), h("button", { class: seq ? "on" : "", onclick: () => !seq && P({ Sequential: 1 }, "Objectives in order") }, "In order"),
        h("span", { class: "hint" }, seq ? "One at a time, top to bottom: only the current one counts." : "Every objective counts from the start; kills of any listed enemy count.")),
      h("div", { class: "qs-steps " + (seq ? "seq" : "par") }, steps.map(stepRow)), addStep,
      qsDailyBox(q, P),
      h("h4", {}, "Rewards"), rwBox,
      h("h4", {}, "What they say ", h("button", { class: "qs-mini", onclick: () => qsPreviewQuest(q) }, "play it")),
      qsQuestScript(q, P)));
  d.scrollTop = keep;
}
function qsBlankStep(t, q) {
  const g = S.npcBy[q.Giver];
  if (t === "kill") return { Type: "kill", Target: "", Count: 5, Text: "" };
  if (t === "boss") return { Type: "boss", Target: "", Count: 1, Text: "" };
  if (t === "reach") return { Type: "reach", X: g ? g.SpawnX : 0, Y: g ? g.SpawnY : 0, Radius: 3, Count: 1, Text: "Go somewhere" };
  if (t === "collect") return { Type: "collect", Target: "", Count: 3, Text: "" };
  if (t === "talk") return { Type: "talk", NPC: q.TurnIn || q.Giver, Count: 1, Text: `Talk to ${npcName(q.TurnIn || q.Giver)}`, Line: "" };
  if (t === "use" || t === "build") return { Type: "use", Target: t === "build" ? "build" : "swing", Count: 1, Text: t === "build" ? "Build something" : "" };
  if (t === "level") return { Type: "level", Count: (q.Level || 1) + 1, Text: `Reach level ${(q.Level || 1) + 1}` };
  return { Type: t, Target: "", Count: 1, Text: "" };
}
// The quest's own lines, in the order the player hears them.
function qsQuestScript(q, P) {
  const g = S.npcBy[q.Giver], t = S.npcBy[q.TurnIn];
  const steps = qSteps(q);
  const npcLine = (n, key, label, extra) => h("div", { class: "qs-bub npc", "data-line": key },
    pix(n ? n.ImgPath : "", "bp"), h("div", {}, h("small", {}, `${n ? n.Name : "Nobody"} - ${label}`),
      qsInline(q[key], v => P({ [key]: v }, `${label} line`), { multi: true, cls: "rh", ph: "Write what they say" }), extra ? h("div", { class: "qs-auto" }, extra) : null));
  const you = (txt, note) => h("div", { class: "qs-bub you" }, h("span", { class: "qs-opt" }, txt), note ? h("small", {}, note) : null);
  const rewards = [+q.XP ? `${q.XP} XP` : "", +q.Gold ? `${q.Gold} Gold` : "", ...qRw(q).map(r => S.itemBy[r.ItemID] ? `${r.Amount}x ${S.itemBy[r.ItemID].Name}` : "")].filter(Boolean);
  return h("div", { class: "qs-script" },
    you("[Quest] " + q.Title, `on ${g ? g.Name : "the giver"}'s menu once it unlocks`),
    npcLine(g, "Offer", "offer", steps.map(s => "- " + (s.Text || stepLabel(s))).join("\n")),
    you("I'll do it.", "or \"Not right now.\" (back to the start)"),
    npcLine(g, "Accept", "accept"),
    you("On it.", "takes the quest and closes the window"),
    ...steps.map((s, i) => s.Type === "talk" ? h("div", { class: "qs-bub npc" }, pix(S.npcBy[s.NPC] ? S.npcBy[s.NPC].ImgPath : "", "bp"), h("div", {}, h("small", {}, `${npcName(s.NPC)} - objective ${i + 1}`),
      qsInline(s.Line, v => { const a = qSteps(q); a[i].Line = v; return P({ Steps: JSON.stringify(a) }, `${npcName(s.NPC)}'s line`); }, { multi: true, cls: "rh", ph: "What they say" }), h("div", { class: "qs-auto" }, "then \"Right.\""))) : null),
    you("[In progress] " + q.Title, `if you talk to ${t ? t.Name : "them"} before it's done`),
    npcLine(t, "Progress", "in progress"),
    you("[Complete] " + q.Title, "when every objective is done"),
    npcLine(t, "Complete", "complete", rewards.length ? "Reward: " + rewards.join(", ") : "No reward"),
    you("Anything else?", "goes to their next quest on offer, else their greeting"));
}

// ------------------------------------------------------------------ the game's dialogue, simulated
// Same rules as the API's talkTo / questMenuLocked / chatNode, on a pretend
// player (QS.play or a scratch copy).
const qsOrder = () => [...S.c.quests].sort((a, b) => a.Level - b.Level || a.id - b.id);
function qsAvail(P, q) { return !P.done.has(q.id) && !P.state[q.id] && qPre(q).every(p => P.done.has(p)) && P.level >= q.MinLevel; }
function qsTalkStep(P, q, npcId) {
  if (P.state[q.id] !== "active") return -1;
  const ss = qSteps(q), talked = (P.talked && P.talked[q.id]) || new Set();
  for (let i = 0; i < ss.length; i++) {
    if (ss[i].Type === "talk" && ss[i].NPC === npcId && !talked.has(i)) return i;
    if (+q.Sequential && !(ss[i].Type === "talk" && talked.has(i))) return -1;
  }
  return -1;
}
function qsMenu(P, npcId) {
  const t = [], k = [], o = [], w = [];
  for (const q of qsOrder()) {
    const st = P.state[q.id];
    if (!st && !P.done.has(q.id)) { if (q.Giver === npcId && qsAvail(P, q)) o.push({ t: "[Quest] " + q.Title, k: "offer:" + q.id }); }
    else if (st === "ready" && q.TurnIn === npcId) t.push({ t: "[Complete] " + q.Title, k: "turnin:" + q.id });
    else if (st === "active" && qsTalkStep(P, q, npcId) >= 0) k.push({ t: `[${q.Title}] ${qSteps(q)[qsTalkStep(P, q, npcId)].Text}`, k: "talk:" + q.id });
    else if (st === "active" && (q.TurnIn === npcId || q.Giver === npcId)) w.push({ t: "[In progress] " + q.Title, k: "progress:" + q.id });
  }
  return [...t, ...k, ...o, ...w];
}
const qsNextOffer = (P, npcId) => qsOrder().find(q => q.Giver === npcId && qsAvail(P, q));
function qsTalk(P, n, key) {
  const v = { name: n.Name, img: n.ImgPath, text: "", options: [], key };
  const close = { t: "Goodbye.", k: "close" };
  if (key === "close") return { ...v, closed: true };
  if (key === "plot") return { ...v, text: "(The land agent's plot list: rent a plot, see yours, give one up. The game builds this from the plot table.)", options: [{ t: "Back.", k: "" }, close] };
  if (key.startsWith("chat:")) return qsChat(P, n, key.slice(5), v);
  if (key === "more") { const nq = qsNextOffer(P, n.id); key = nq ? "offer:" + nq.id : ""; }
  const id = +(key.split(":")[1] || 0), q = qById(id), kind = key.split(":")[0];
  let handled = true;
  if (kind === "offer" && q && q.Giver === n.id && qsAvail(P, q)) { v.text = q.Offer + "\n\n" + qSteps(q).map(s => "- " + s.Text).join("\n"); v.options = [{ t: "I'll do it.", k: "accept:" + id }, { t: "Not right now.", k: "" }]; v.quest = id; v.line = "Offer"; }
  else if (kind === "accept" && q && q.Giver === n.id && qsAvail(P, q)) { P.state[id] = "active"; P.log && P.log.push({ t: "took", q: id }); v.text = q.Accept; v.options = [{ t: "On it.", k: "close" }]; v.quest = id; v.line = "Accept"; }
  else if (kind === "talk" && q && qsTalkStep(P, q, n.id) >= 0) { const i = qsTalkStep(P, q, n.id); P.talked = P.talked || {}; (P.talked[id] = P.talked[id] || new Set()).add(i); v.text = qSteps(q)[i].Line || ""; v.options = [{ t: "Right.", k: "" }]; v.quest = id; v.line = "step:" + i; }
  else if (kind === "turnin" && q && P.state[id] === "ready" && q.TurnIn === n.id) {
    delete P.state[id]; P.done.add(id); if (P.follow) P.level = Math.max(P.level, q.Level); P.log && P.log.push({ t: "done", q: id });
    const rw = [+q.XP ? q.XP + " XP" : "", +q.Gold ? q.Gold + " Gold" : "", ...qRw(q).map(r => (S.itemBy[r.ItemID] ? `${r.Amount}x ${S.itemBy[r.ItemID].Name}` : ""))].filter(Boolean);
    v.text = q.Complete + (rw.length ? "\n\nReward: " + rw.join(", ") : ""); v.options = [{ t: "Anything else?", k: "more" }]; v.quest = id; v.line = "Complete";
  }
  else if (kind === "progress" && q) { v.text = q.Progress; v.options = [{ t: "Back.", k: "" }]; v.quest = id; v.line = "Progress"; }
  else handled = false;
  if (handled) { if (!v.options.some(o => o.k === "close")) v.options.push(close); return v; }
  const items = qsMenu(P, n.id);
  if (n.Faction === "Land Agent") items.push({ t: "[Plot] Rent a plot", k: "plot" });
  if (items.length === 1 && (!n.Conversation || /^(turnin|talk):/.test(items[0].k))) return qsTalk(P, n, items[0].k);
  if (n.Conversation && S.convBy[n.Conversation]) { const c = qsChat(P, n, n.Conversation, v); c.options = [...items, ...c.options]; return c; }
  v.text = items.length ? "Yes?" : "..."; v.options = [...items, close];
  return v;
}
function qsChat(P, n, ident, v) {
  const c = S.convBy[ident];
  if (!c || ident === "1") return { ...v, closed: true };
  v.text = c.Title; v.node = ident;
  if (hasPortrait(c)) v.img = c.ImgPath;
  let nextQ;
  for (const [label, to] of parseOptions(c.Options)) {
    let k = to === "1" || to === "" ? "close" : "chat:" + to;
    if (label.trim().toLowerCase() === "anything else?") { if (nextQ === undefined) nextQ = qsNextOffer(P, n.id) || null; if (nextQ) k = "offer:" + nextQ.id; }
    v.options.push({ t: label, k });
  }
  if (!v.options.length) v.options = [{ t: "Goodbye.", k: "close" }];
  return v;
}
const qsFill = t => String(t || "").replace(/\{([A-Z]+)\}/g, (m, k) => ({ SHIELD: "Q", INTERACT: "E", MOUNTS: "M", CHARACTER: "C", SPRINT: "SHIFT" }[k] || k));
function qsSceneFor(n) {
  let ground = "assets/world/grounds/grass.png", tree = "assets/world/objects/tree.png";
  if (S.world && n) {
    const t = S.world.tiles.get(n.SpawnX + "," + n.SpawnY);
    if (t && S.world.strings[t[2]]) ground = S.world.strings[t[2]];
    for (let x = n.SpawnX; x <= n.SpawnX + 30; x++) { const u = S.world.tiles.get(x + "," + n.SpawnY); if (u && u[5] && S.world.strings[u[3]]) { tree = S.world.strings[u[3]]; break; } }
  }
  return { ground, tree };
}
function qsScene(n, img, cls) {
  const sc = qsSceneFor(n);
  return h("div", { class: "qs-scene " + (cls || ""), style: `--tree:url("${qsImg(sc.tree)}");--ground:url("${qsImg(sc.ground)}")` }, h("div", { class: "qs-trees" }), h("div", { class: "qs-ground" }), pix(img || (n && n.ImgPath), "qs-actor"));
}
// The game's conversation window: title bar with the speaker, the stage,
// typed speech in rainyhearts, numbered answers.
function qsGamePanel(n, o = {}) {
  const P = o.P || qsScratch();
  let view = qsTalk(P, n, o.start || "");
  const el = h("div", { class: "qs-game" });
  let timer = 0;
  const draw = () => {
    clearInterval(timer);
    if (view.closed) {
      el.replaceChildren(h("div", { class: "qs-gtitle" }, h("span", {}, n.Name.toUpperCase())), h("div", { class: "qs-gclosed" }, h("span", {}, "The window closes."), h("button", { class: "qs-btn", onclick: () => { view = qsTalk(P, n, ""); draw(); o.onChange && o.onChange(); } }, "Talk again")));
      return;
    }
    const full = qsFill(view.text);
    const speech = h("div", { class: "qs-speech rh", title: "Click to show it all" });
    let i = 0;
    const tick = () => { i = Math.min(full.length, i + 2); speech.textContent = full.slice(0, i); if (i >= full.length) clearInterval(timer); };
    if (o.instant || !full.length) speech.textContent = full; else { timer = setInterval(tick, 28); }
    speech.addEventListener("click", () => { clearInterval(timer); speech.textContent = full; });
    const opts = h("div", { class: "qs-gopts" }, view.options.map((op, j) => h("button", { class: "qs-gopt rh" + (op.t.startsWith("[Plot]") ? " plot" : ""), onclick: () => { view = qsTalk(P, n, op.k); draw(); o.onChange && o.onChange(view); } },
      h("b", {}, j < 9 ? j + 1 + "." : ""), qsFill(op.t))));
    el.replaceChildren(h("div", { class: "qs-gtitle" }, h("span", {}, view.name.toUpperCase()), view.node ? h("small", {}, view.node) : view.line ? h("small", {}, view.line) : null),
      h("div", { class: "qs-gbody" }, qsScene(n, view.img), h("div", { class: "qs-gright" }, speech, opts)));
    if (o.onView) o.onView(view);
  };
  el.restart = () => { view = qsTalk(P, n, ""); draw(); };
  el.show = key => { view = qsTalk(P, n, key); draw(); };
  draw();
  return el;
}
function qsScratch() { const p = QS.play; return { level: p.level, done: new Set(p.done), state: { ...p.state }, follow: p.follow, talked: {} }; }
function qsPreviewQuest(q) {
  const n = S.npcBy[q.Giver]; if (!n) { qsToast("Give the quest a giver first"); return; }
  const P = { level: Math.max(q.MinLevel, q.Level), done: new Set(qsAncestors(q.id)), state: {}, follow: false, talked: {} };
  const close = () => { ov.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const panel = qsGamePanel(n, { P, start: "offer:" + q.id });
  const ov = h("div", { class: "qs-modal", onclick: e => { if (e.target === ov) close(); } }, h("div", { class: "qs-gwrap" }, panel,
    h("div", { class: "qs-row" }, h("span", { class: "hint" }, `As a level ${P.level} player who has done everything before it.`), h("button", { class: "qs-btn", onclick: close }, "Close"))));
  document.body.append(ov); document.addEventListener("keydown", esc, true);
}

// ------------------------------------------------------------------ cast
function qsRoles(n) {
  const gives = [], takes = [], talks = [];
  for (const q of S.c.quests) {
    if (q.Giver === n.id) gives.push(q);
    if (q.TurnIn === n.id) takes.push(q);
    if (qSteps(q).some(s => s.Type === "talk" && s.NPC === n.id)) talks.push(q);
  }
  const all = [...new Set([...gives, ...takes, ...talks])].sort((a, b) => a.Level - b.Level || a.id - b.id);
  return { gives, takes, talks, all, first: all.length ? all[0].Level : 999 };
}
// Who this NPC is linked to: other NPCs in the same quests.
function qsLinks(n) {
  const m = new Map();
  for (const q of qsRoles(n).all) {
    const others = [q.Giver, q.TurnIn, ...qSteps(q).filter(s => s.Type === "talk").map(s => s.NPC)].filter(x => x !== n.id && S.npcBy[x]);
    for (const o of new Set(others)) { if (!m.has(o)) m.set(o, []); m.get(o).push(q); }
  }
  return [...m.entries()].map(([id, qs]) => ({ n: S.npcBy[id], qs })).sort((a, b) => b.qs.length - a.qs.length);
}
function qsCast(body) {
  const an = qsAnalyse();
  const f = (QS.castFilter || "").toLowerCase();
  const list = S.c.npcs.map(n => ({ n, r: qsRoles(n) })).filter(({ n }) => !f || `${n.Name} ${n.Faction} ${zoneAt(n.SpawnX, n.SpawnY)}`.toLowerCase().includes(f));
  const story = list.filter(x => x.r.all.length).sort((a, b) => a.r.first - b.r.first || a.n.Name.localeCompare(b.n.Name));
  const extras = list.filter(x => !x.r.all.length).sort((a, b) => a.n.Name.localeCompare(b.n.Name));
  const card = ({ n, r }) => {
    const iss = an.npcIssues.get(n.id) || [];
    return h("button", { class: "qs-ncard" + (iss.length ? " sev-err" : ""), "data-id": n.id, onclick: () => qsGo("npc", n.id) },
      qsScene(n, null, "small"),
      h("div", { class: "qs-nname" }, n.Name),
      h("div", { class: "qs-nsub" }, n.Faction || "no faction", " - ", zoneAt(n.SpawnX, n.SpawnY) || `${n.SpawnX},${n.SpawnY}`),
      h("div", { class: "qs-nstats" },
        r.gives.length ? h("span", { title: "Gives" }, pix("assets/ui/studio/alert.png", "mi"), r.gives.length) : null,
        r.takes.length ? h("span", { title: "Takes hand-ins" }, pix("assets/ui/studio/complete.png", "mi"), r.takes.length) : null,
        r.talks.length ? h("span", { title: "Talk objectives" }, pix("assets/ui/studio/alert-item.png", "mi"), r.talks.length) : null,
        r.all.length ? h("span", { class: "lv" }, `Lv ${r.all[0].Level}${r.all.length > 1 ? "-" + r.all[r.all.length - 1].Level : ""}`) : h("span", { class: "hint" }, "no quests"),
        n.Conversation ? h("span", { title: "Has chat dialogue" }, "“...”") : null),
      iss.length ? h("div", { class: "qs-nbad" }, iss[0].msg) : null);
  };
  const s = h("input", { type: "search", class: "qs-in", placeholder: "Find someone by name, faction or zone...", value: QS.castFilter || "" });
  s.addEventListener("input", () => { QS.castFilter = s.value; const p = s.selectionStart; qsRerender(); const n = $(".qs-cast .qs-in"); if (n) { n.focus(); n.setSelectionRange(p, p); } });
  body.append(h("div", { class: "qs-cast" },
    h("div", { class: "qs-tools" }, s, h("button", { class: "qs-btn hot", onclick: () => qsNewNpc() }, "+ New NPC"), h("span", { class: "hint" }, `${story.length} in the story, ${extras.length} extras. In journey order: who you meet first comes first.`)),
    h("h3", { class: "qs-h3" }, "The story cast"), h("div", { class: "qs-ngrid" }, story.map(card)),
    h("h3", { class: "qs-h3" }, "Extras (no quests yet)"), h("div", { class: "qs-ngrid" }, extras.map(card))));
}

// ------------------------------------------------------------------ world patch (real tiles)
function qsWorldCanvas(o) {
  const W = o.w || 320, H = o.h || 200;
  const cv = h("canvas", { class: "qs-wmap", width: W, height: H });
  const st = { cx: o.cx, cy: o.cy, sc: o.sc || 16 };
  const draw = () => {
    if (!cv.isConnected && cv.dataset.drawn) { MINI_REDRAW.delete(draw); return; }
    cv.dataset.drawn = 1;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    g.fillStyle = "#101010"; g.fillRect(0, 0, W, H);
    if (!S.world) { g.fillStyle = "#ccc"; g.font = "12px monospace"; g.fillText("Loading the world...", 10, 20); return; }
    const sc = st.sc, hw = Math.ceil(W / sc / 2) + 1, hh = Math.ceil(H / sc / 2) + 1;
    const px = x => Math.round((x - st.cx) * sc + W / 2 - sc / 2), py = y => Math.round((y - st.cy) * sc + H / 2 - sc / 2);
    for (let y = Math.floor(st.cy) - hh; y <= st.cy + hh; y++) for (let x = Math.floor(st.cx) - hw; x <= st.cx + hw; x++) {
      const t = S.world.tiles.get(x + "," + y); if (!t) continue;
      for (const p of [S.world.strings[t[2]], S.world.strings[t[3]]]) {
        if (!p) continue;
        const im = imgFor(p);
        if (im && sc >= 8) g.drawImage(im, px(x), py(y), sc, sc);
        else if (M.colours[p]) { g.fillStyle = M.colours[p]; g.fillRect(px(x), py(y), sc, sc); }
      }
    }
    for (const n of S.c.npcs) {
      if (Math.abs(n.SpawnX - st.cx) > hw || Math.abs(n.SpawnY - st.cy) > hh) continue;
      const im = imgFor(n.ImgPath);
      if (im) g.drawImage(im, px(n.SpawnX), py(n.SpawnY), sc, sc);
      if (o.mark === n.id) { g.strokeStyle = "#f2cc59"; g.lineWidth = 2; g.strokeRect(px(n.SpawnX) - 1, py(n.SpawnY) - 1, sc + 2, sc + 2); }
    }
    if (o.pin) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(px(o.pin.x) - 1, py(o.pin.y) - 1, sc + 2, sc + 2); if (o.pinImg) { const im = imgFor(o.pinImg); if (im) g.drawImage(im, px(o.pin.x), py(o.pin.y), sc, sc); } }
  };
  cv.addEventListener("click", e => {
    if (!o.onPick) return;
    const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * (W / r.width), my = (e.clientY - r.top) * (H / r.height);
    const x = Math.floor(st.cx + (mx - W / 2 + st.sc / 2) / st.sc), y = Math.floor(st.cy + (my - H / 2 + st.sc / 2) / st.sc);
    o.onPick(x, y); draw();
  });
  cv.addEventListener("wheel", e => { e.preventDefault(); if (e.ctrlKey || Math.abs(e.deltaY) >= 50) st.sc = Math.max(4, Math.min(32, st.sc * (e.deltaY < 0 ? 1.25 : 0.8))); else { st.cx += e.deltaX / st.sc; st.cy += e.deltaY / st.sc; } draw(); }, { passive: false });
  let dragAt = null;
  cv.addEventListener("pointerdown", e => { dragAt = { x: e.clientX, y: e.clientY, m: 0 }; });
  cv.addEventListener("pointermove", e => { if (!dragAt || !e.buttons) return; const dx = e.clientX - dragAt.x, dy = e.clientY - dragAt.y; dragAt.m += Math.abs(dx) + Math.abs(dy); if (dragAt.m > 6) { st.cx -= dx / st.sc; st.cy -= dy / st.sc; dragAt.x = e.clientX; dragAt.y = e.clientY; draw(); } });
  cv.addEventListener("click", e => { if (dragAt && dragAt.m > 6) e.stopImmediatePropagation(); dragAt = null; }, true);
  cv.style.touchAction = "none";
  MINI_REDRAW.add(draw);
  setTimeout(draw, 0);
  cv.redraw = draw; cv.st = st;
  return cv;
}

// ------------------------------------------------------------------ NPC character sheet
function qsNotesGet(id) { return ((S.c.npcNotes || []).find(r => r.NPC === id) || {}).Notes || ""; }
async function qsNotesSet(id, text) {
  const old = (S.c.npcNotes || []).find(r => r.NPC === id);
  await api("save", { table: "npc_notes", row: { id: old ? old.id : 0, NPC: id, Notes: text } });
  await loadAll();
  qsToast(`Notes saved (editor-only npc_notes table; the game ignores it)`);
}
function qsNpcSheet(body, id) {
  const n = S.npcBy[id];
  if (!n) { body.append(h("div", { class: "qs-empty" }, "No NPC ", id, ". ", h("a", { href: "#studio/cast" }, "Back to the cast"))); return; }
  syncHash("#studio/npc/" + id);
  const an = qsAnalyse(), r = qsRoles(n), links = qsLinks(n), iss = an.npcIssues.get(n.id) || [];
  const P = (patch, label) => qsCommit("npc", { ...S.npcBy[id], ...patch }, label).then(qsRerender);
  const zone = zoneAt(n.SpawnX, n.SpawnY);
  const map = qsWorldCanvas({ cx: n.SpawnX, cy: n.SpawnY, w: 360, h: 220, sc: 16, mark: n.id, onPick: (x, y) => { if (confirm(`Move ${n.Name} to ${x},${y}?`)) P({ SpawnX: x, SpawnY: y }, `Moved ${n.Name} to ${x},${y}`); } });
  const factions = [...new Set(S.c.npcs.map(x => x.Faction).filter(Boolean))].sort();
  if (!$("#qs-factions")) document.body.append(h("datalist", { id: "qs-factions" }));
  $("#qs-factions").replaceChildren(...factions.map(z => h("option", { value: z })));
  const roleTag = q => [q.Giver === n.id ? "gives" : null, q.TurnIn === n.id ? "takes it in" : null, qSteps(q).some(s => s.Type === "talk" && s.NPC === n.id) ? "talk objective" : null].filter(Boolean).join(" - ");
  const preview = qsGamePanel(n, { P: qsScratch() });
  const notes = qsInline(qsNotesGet(id), v => qsNotesSet(id, v).then(qsRerender), { multi: true, cls: "rh qs-notes", ph: "Who are they? How do they talk? What do they want? (Your notes: not shown in game.)", tag: "div" });
  body.append(h("div", { class: "qs-sheetpage" },
    h("div", { class: "qs-col" },
      h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, "CHARACTER"), h("span", { class: "qs-sp" }), h("a", { class: "qs-link", href: "#studio/cast" }, "cast"), h("a", { class: "qs-link", href: "#npc/" + id }, "form")),
        h("div", { class: "qs-wbody" },
          h("div", { class: "qs-hero" }, h("button", { class: "qs-herobtn", title: "Change sprite", onclick: () => openPicker({ title: `Sprite for ${n.Name}`, groups: npcSpriteGroups, recentKey: "npc", value: n.ImgPath, onPick: v => v && P({ ImgPath: v }, `New look for ${n.Name}`) }) }, qsScene(n, null, "hero")),
            h("div", { class: "qs-heroinfo" }, qsInline(n.Name, v => P({ Name: v || n.Name }, `Renamed to ${v}`), { cls: "qs-h big" }),
              h("div", {}, h("small", {}, "Faction "), qsInline(n.Faction, v => P({ Faction: v }, `Faction ${v}`), { list: "qs-factions", ph: "none" })),
              n.Faction === "Land Agent" ? h("div", { class: "qs-plot" }, "Land Agent: lists rent plots ([Plot] rows) after their quests") : null,
              h("div", {}, h("small", {}, "Lives at "), `${n.SpawnX},${n.SpawnY}`, zone ? ` - ${zone}` : ""),
              h("div", { class: "qs-nstats" }, h("span", {}, pix("assets/ui/studio/alert.png", "mi"), `gives ${r.gives.length}`), h("span", {}, pix("assets/ui/studio/complete.png", "mi"), `takes ${r.takes.length}`), h("span", {}, pix("assets/ui/studio/alert-item.png", "mi"), `talk ${r.talks.length}`)))),
          iss.length ? h("div", { class: "qs-iss" }, iss.map(x => h("div", { class: "qs-prob " + x.sev }, h("i", { class: "lg " + x.sev }), x.msg))) : null,
          h("h4", {}, "Personality notes"), notes,
          h("h4", {}, "Where they stand ", h("span", { class: "hint" }, "click the map to move them, drag to look around")), map,
          h("div", {}, h("a", { class: "qs-link", href: `#map/${n.SpawnX},${n.SpawnY}` }, "open on the big map")))),
      h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, "THEIR QUESTS")),
        h("div", { class: "qs-wbody" }, r.all.length ? h("div", { class: "qs-qlist" }, r.all.map(q => h("a", { class: "qs-qrow", href: "#studio/journey/" + q.id }, h("span", { class: "qc-lv" }, q.Level), h("b", {}, q.Title), h("small", {}, roleTag(q))))) : h("p", { class: "hint" }, "None yet."),
          h("button", { class: "qs-btn hot", onclick: () => qsNewQuest(0, n.id) }, `+ A quest from ${n.Name}`))),
      h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, "CONNECTED TO")),
        h("div", { class: "qs-wbody" }, links.length ? h("div", { class: "qs-links" }, links.map(l => h("a", { class: "qs-lnk", href: "#studio/npc/" + l.n.id, title: l.qs.map(q => q.Title).join("\n") }, pix(l.n.ImgPath, "pt"), h("b", {}, l.n.Name), h("small", {}, l.qs.length === 1 ? l.qs[0].Title : `${l.qs.length} quests`)))) : h("p", { class: "hint" }, "Nobody, yet. Give them a quest that sends the player to someone.")))),
    h("div", { class: "qs-col wide" },
      h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, "DIALOGUE"), h("span", { class: "qs-sp" }), h("small", {}, "click any line to edit it")),
        h("div", { class: "qs-wbody" }, qsDialogue(n, preview))),
      h("div", { class: "qs-win sticky" }, h("div", { class: "qs-wtitle" }, h("span", {}, "IN GAME"), h("span", { class: "qs-sp" }), h("button", { class: "qs-mini", onclick: () => preview.restart() }, "restart")),
        h("div", { class: "qs-wbody" }, preview, h("p", { class: "hint" }, `As the Playtest character (level ${QS.play.level}, ${QS.play.done.size} quests done). Answers work.`))))));
}

// Dialogue as a conversation: the greeting tree as chat, then each quest's lines.
function qsDialogue(n, preview) {
  const box = h("div", { class: "qs-dlg" });
  const prefix = (n.Conversation || "npc-" + n.Name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-1").replace(/-\d+$/, "");
  const newIdent = () => { let i = 1; while (S.convBy[`${prefix}-${i}`]) i++; return `${prefix}-${i}`; };
  const saveNode = (c, patch, label) => qsCommit("conversation", { id: c.id, Identifier: c.Identifier, Title: c.Title, ImgPath: c.ImgPath || "", Options: c.Options, ReputationChange: c.ReputationChange || "", ItemsGiven: c.ItemsGiven || "", QuestStart: c.QuestStart || 0, ...patch }, label).then(qsRerender);
  const nodeIds = () => (n.Conversation ? treeNodes(n.Conversation) : []).map(c => c.Identifier);
  const r = qsRoles(n);
  box.append(h("div", { class: "qs-rule" }, "When you talk to ", h("b", {}, n.Name), ", quest business comes first: hand-ins, talk objectives, new quests, then quests in progress. Then their own chat below."));
  if (r.all.length) box.append(h("div", { class: "qs-menu" }, r.takes.map(q => h("span", { class: "qs-opt" }, "[Complete] " + q.Title)), r.talks.map(q => h("span", { class: "qs-opt" }, `[${q.Title}] ...`)), r.gives.map(q => h("span", { class: "qs-opt" }, "[Quest] " + q.Title)), n.Faction === "Land Agent" ? h("span", { class: "qs-opt plot" }, "[Plot] Rent a plot") : null));
  const thread = h("div", { class: "qs-thread" });
  if (!n.Conversation || !S.convBy[n.Conversation]) {
    thread.append(h("div", { class: "qs-bub npc" }, pix(n.ImgPath, "bp"), h("div", {}, h("small", {}, n.Conversation ? `greeting node "${n.Conversation}" is missing` : "no chat yet"),
      h("button", { class: "qs-btn hot", onclick: async () => {
        const ident = n.Conversation && !S.convBy[n.Conversation] ? n.Conversation : newIdent();
        await qsCommit("conversation", { id: 0, Identifier: ident, Title: "Hello there.", ImgPath: "", Options: "[['Goodbye.','1']]", ReputationChange: "", ItemsGiven: "", QuestStart: 0 }, `Greeting for ${n.Name}`);
        if (n.Conversation !== ident) await qsCommit("npc", { ...S.npcBy[n.id], Conversation: ident }, `${n.Name} greets with ${ident}`);
        qsRerender();
      } }, `Give ${n.Name} something to say`))));
  } else {
    const shown = new Set();
    const nodeEl = (ident, depth) => {
      const c = S.convBy[ident];
      if (!c) return h("div", { class: "qs-bub bad" }, `Missing node "${ident}": this answer is a dead end. `, h("button", { class: "qs-mini", onclick: () => qsCommit("conversation", { id: 0, Identifier: ident, Title: "", ImgPath: "", Options: "[['Goodbye.','1']]", ReputationChange: "", ItemsGiven: "", QuestStart: 0 }, `Created ${ident}`).then(qsRerender) }, "create it"));
      if (shown.has(ident)) return h("a", { class: "qs-back", href: "#", onclick: e => { e.preventDefault(); const t = box.querySelector(`[data-node="${CSS.escape(ident)}"]`); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); } } }, "<- back to “", (c.Title || "").slice(0, 40), "...”");
      shown.add(ident);
      const opts = parseOptions(c.Options);
      const setOpts = (o, label) => saveNode(c, { Options: formatOptions(o) }, label);
      const el = h("div", { class: "qs-node", "data-node": ident },
        h("div", { class: "qs-bub npc", onclick: e => { if (!e.target.closest(".qs-ed")) preview.show("chat:" + ident); } }, pix(hasPortrait(c) ? c.ImgPath : n.ImgPath, "bp"),
          h("div", {}, h("small", {}, ident === n.Conversation ? "greeting - " + ident : ident), qsInline(c.Title, v => saveNode(c, { Title: v }, `${n.Name}: line edited`), { multi: true, cls: "rh", ph: "What they say" }))));
      const answers = h("div", { class: "qs-answers" });
      opts.forEach(([label, to], i) => {
        const ae = label.trim().toLowerCase() === "anything else?";
        const sel = h("select", { class: "qs-sel tiny", title: "Where this answer goes" }, h("option", { value: "1" }, "ends the chat"), nodeIds().map(x => h("option", { value: x }, "→ " + x)), !nodeIds().includes(to) && to !== "1" && to ? h("option", { value: to }, "→ " + to + " (missing)") : null, h("option", { value: "+new" }, "+ new line..."));
        sel.value = to === "" ? "1" : to;
        sel.onchange = async () => {
          const o = parseOptions(c.Options);
          if (sel.value === "+new") {
            const ni = newIdent();
            await qsCommit("conversation", { id: 0, Identifier: ni, Title: "", ImgPath: "", Options: "[['Goodbye.','1']]", ReputationChange: "", ItemsGiven: "", QuestStart: 0 }, `New line ${ni}`);
            o[i][1] = ni; await setOpts(o, `Answer leads to ${ni}`);
            setTimeout(() => { const t = box.isConnected ? null : document.querySelector(`[data-node="${CSS.escape(ni)}"] .qs-ed`); if (t) t.open(); }, 50);
          } else { o[i][1] = sel.value; setOpts(o, "Answer re-routed"); }
        };
        const a = h("div", { class: "qs-ans" },
          h("div", { class: "qs-bub you" }, h("span", { class: "qs-opt" }, qsInline(label, v => { const o = parseOptions(c.Options); o[i][0] = v || label; return setOpts(o, "Answer edited"); }, { cls: "rh" })), sel,
            h("button", { class: "qs-mini", title: "Remove this answer", onclick: () => { const o = parseOptions(c.Options); o.splice(i, 1); setOpts(o, "Answer removed"); } }, "x")),
          ae ? h("div", { class: "qs-auto" }, "“Anything else?” opens their next quest on offer, if there is one; otherwise it goes ", to === "1" ? "nowhere (ends)" : "to " + to) : null);
        if (to && to !== "1") a.append(nodeEl(to, depth + 1)); else if (!ae) a.append(h("div", { class: "qs-end" }, "the window closes"));
        answers.append(a);
      });
      answers.append(h("button", { class: "qs-mini add", onclick: () => { const o = parseOptions(c.Options); o.push(["...", "1"]); setOpts(o, "Answer added"); } }, "+ answer"));
      el.append(answers);
      return el;
    };
    thread.append(nodeEl(n.Conversation, 0));
    const loose = S.c.conversations.filter(c => c.Identifier.startsWith(prefix + "-") && !shown.has(c.Identifier) && !nodeOwners(c.Identifier).length);
    if (loose.length) thread.append(h("div", { class: "qs-rule" }, "Lines nobody reaches: ", loose.map(c => h("span", { class: "qs-chip" }, c.Identifier))));
  }
  box.append(h("h4", {}, "Their chat"), thread);
  if (r.all.length) {
    box.append(h("h4", {}, "Their quest lines"));
    for (const q of r.all) {
      const det = h("details", { class: "qs-qthread" }, h("summary", {}, h("span", { class: "qc-lv" }, q.Level), " ", q.Title, " ", h("small", {}, [q.Giver === n.id ? "gives" : "", q.TurnIn === n.id ? "takes in" : "", qSteps(q).some(s => s.Type === "talk" && s.NPC === n.id) ? "talk" : ""].filter(Boolean).join(" - "))));
      det.addEventListener("toggle", () => { if (det.open && det.children.length === 1) det.append(qsQuestScript(q, (patch, label) => qsPatchQuest(q.id, patch, label))); });
      box.append(det);
    }
  }
  return box;
}

// ------------------------------------------------------------------ playtest
function qsPlayStatus(q) {
  const P = QS.play;
  if (P.done.has(q.id)) return "done";
  if (P.state[q.id]) return P.state[q.id];
  if (qsAvail(P, q)) return "avail";
  return "locked";
}
function qsWhyLocked(q) {
  const P = QS.play, why = [];
  const missing = qPre(q).filter(p => !P.done.has(p));
  if (missing.length) why.push("after " + missing.map(p => (qById(p) ? `“${qById(p).Title}”` : `#${p} (missing!)`)).join(" and "));
  if (P.level < q.MinLevel) why.push(`at level ${q.MinLevel}`);
  return why.join(", ");
}
function qsSkipTo(level) {
  const P = QS.play; let grew = true;
  for (const id of Object.keys(P.state)) { const q = qById(+id); if (q && q.Level < level) { P.done.add(q.id); delete P.state[id]; } }
  while (grew) { grew = false; for (const q of qsOrder()) if (q.Level < level && qsAvail({ ...P, level: Math.max(P.level, q.MinLevel) }, q) && q.MinLevel <= level) { P.done.add(q.id); delete P.state[q.id]; grew = true; } }
  P.level = level; P.log.push({ t: "skip", level });
}
function qsPlay(body) {
  const P = QS.play;
  const all = qsOrder();
  const ready = all.filter(q => P.state[q.id] === "ready"), active = all.filter(q => P.state[q.id] === "active");
  const avail = all.filter(q => qsAvail(P, q));
  const soon = all.filter(q => !P.done.has(q.id) && !P.state[q.id] && !qsAvail(P, q) && qPre(q).filter(p => !P.done.has(p)).length <= 1).slice(0, 12);
  const sel = S.npcBy[QS.playNpc] || (ready[0] && S.npcBy[ready[0].TurnIn]) || (avail[0] && S.npcBy[avail[0].Giver]) || null;
  const lvl = h("input", { type: "range", min: 1, max: 40, value: P.level, class: "qs-range" });
  const lvlN = h("b", { class: "qc-lv big" }, P.level);
  lvl.oninput = () => { lvlN.textContent = lvl.value; };
  lvl.onchange = () => { P.level = +lvl.value; qsRerender(); };
  const talkBtn = (nid, label) => S.npcBy[nid] ? h("button", { class: "qs-chip talk", onclick: () => { QS.playNpc = nid; qsRerender(); } }, pix(S.npcBy[nid].ImgPath, "mi"), label || S.npcBy[nid].Name) : h("span", { class: "qs-chip bad" }, "nobody");
  const qrow = (q, extra) => h("div", { class: "qs-prow" }, h("span", { class: "qc-lv" }, q.Level), h("a", { href: "#studio/journey/" + q.id, title: "Show on the journey" }, q.Title), h("small", {}, q.Zone), h("span", { class: "qs-sp" }), extra);
  const byGiver = new Map(); for (const q of avail) { if (!byGiver.has(q.Giver)) byGiver.set(q.Giver, []); byGiver.get(q.Giver).push(q); }
  const panel = sel ? qsGamePanel(sel, { P, onChange: v => { if (!v || /^(accept|turnin|talk):/.test(v.key || "") || v.key === "more") setTimeout(qsRerender, 400); } }) : h("p", { class: "hint" }, "Pick someone to talk to.");
  body.append(h("div", { class: "qs-play" },
    h("div", { class: "qs-col" },
      h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, "YOUR CHARACTER")),
        h("div", { class: "qs-wbody" },
          h("div", { class: "qs-row" }, pix("assets/npc/Adventurer.png", "big"), h("div", {}, "Level ", lvlN, h("br"), h("small", {}, `${P.done.size} of ${all.length} quests done`))), lvl,
          h("label", { class: "qs-chk" }, h("input", { type: "checkbox", checked: P.follow, onchange: e => { P.follow = e.target.checked; } }), " level up with the story (to each quest's level)"),
          h("div", { class: "qs-row wrap" },
            h("button", { class: "qs-btn", onclick: () => { QS.play = { level: 1, done: new Set(), state: {}, follow: P.follow, log: [], overlay: P.overlay, talked: {} }; QS.playNpc = null; qsRerender(); } }, "New character"),
            h("button", { class: "qs-btn", title: "Do every quest below this level that can be done", onclick: () => { qsSkipTo(+lvl.value); qsRerender(); } }, `Skip to Lv ${P.level}`),
            h("button", { class: "qs-btn hot", onclick: () => { P.overlay = true; qsGo("journey"); } }, "See it on the journey")))),
      h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, "JOURNAL")),
        h("div", { class: "qs-wbody qs-log" }, P.log.length ? [...P.log].reverse().slice(0, 40).map(l => h("div", {}, l.t === "skip" ? `Skipped ahead to level ${l.level}` : `${l.t === "done" ? "Finished" : l.t === "took" ? "Took" : "Objectives done:"} ${qById(l.q) ? qById(l.q).Title : "#" + l.q}`)) : h("p", { class: "hint" }, "Nothing yet. Talk to someone with a ! quest.")))),
    h("div", { class: "qs-col wide" },
      h("div", { class: "qs-win" }, h("div", { class: "qs-wtitle" }, h("span", {}, "WHAT YOU CAN DO NOW")),
        h("div", { class: "qs-wbody" },
          ready.length ? [h("h4", {}, pix("assets/ui/studio/complete.png", "mi"), " Ready to hand in"), ready.map(q => qrow(q, talkBtn(q.TurnIn, "hand in to " + npcName(q.TurnIn))))] : null,
          active.length ? [h("h4", {}, "In progress"), active.map(q => qrow(q, [h("small", { class: "hint" }, qSteps(q).map(s => s.Text || stepLabel(s)).join(" - ")), " ",
            h("button", { class: "qs-mini", title: "Pretend you've done every objective", onclick: () => { P.state[q.id] = "ready"; P.log.push({ t: "obj", q: q.id }); qsRerender(); } }, "do objectives")]))] : null,
          h("h4", {}, pix("assets/ui/studio/alert.png", "mi"), ` Quests on offer (${avail.length})`),
          avail.length ? [...byGiver.entries()].map(([gid, qs]) => h("div", { class: "qs-pgiver" }, talkBtn(gid), h("small", {}, S.npcBy[gid] ? zoneAt(S.npcBy[gid].SpawnX, S.npcBy[gid].SpawnY) : ""), h("div", {}, qs.map(q => qrow(q))))) : h("p", { class: "hint" }, active.length || ready.length ? "Nothing new: finish what you have." : "Nothing on offer at this level. Dead end! Check the journey for broken links."),
          h("h4", {}, "Coming up"),
          soon.length ? soon.map(q => qrow(q, h("small", { class: "hint" }, qsWhyLocked(q)))) : h("p", { class: "hint" }, "That's the lot.")))),
    h("div", { class: "qs-col" },
      h("div", { class: "qs-win sticky" }, h("div", { class: "qs-wtitle" }, h("span", {}, sel ? "TALKING TO " + sel.Name.toUpperCase() : "TALK"), h("span", { class: "qs-sp" }), sel ? h("a", { class: "qs-link", href: "#studio/npc/" + sel.id }, "edit") : null),
        h("div", { class: "qs-wbody" }, panel, h("p", { class: "hint" }, "Taking, talking and handing in here change your pretend character."))))));
}

// ------------------------------------------------------------------ quick creation
function qsSuggest(level) {
  const near = S.c.quests.filter(q => Math.abs(q.Level - level) <= 2);
  const med = a => { a = a.filter(x => x > 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  return { XP: med(near.map(q => +q.XP)) || 100 * level, Gold: med(near.map(q => +q.Gold)) || 10 * level };
}
function qsNewQuest(afterId, giverId) {
  const after = afterId ? qById(afterId) : null;
  const level = after ? after.Level + 1 : 1;
  const sug = qsSuggest(level);
  const st = { Giver: giverId || (after ? after.TurnIn : 0), TurnIn: 0, type: "kill", targets: [], item: "", count: 5, x: 0, y: 0, npc: 0, use: "swing",
    Title: "", Offer: "", Level: level, MinLevel: Math.max(1, level - 2), XP: sug.XP, Gold: sug.Gold, Zone: after ? after.Zone : "", Act: after ? after.Act : 1 };
  const g0 = S.npcBy[st.Giver]; if (g0) { st.x = g0.SpawnX + 5; st.y = g0.SpawnY; if (!st.Zone) st.Zone = zoneAt(g0.SpawnX, g0.SpawnY); }
  const close = () => { ov.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key === "Escape" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.stopPropagation(); close(); } };
  const body = h("div", { class: "qs-wbody qs-new" });
  const ov = h("div", { class: "qs-modal", onclick: e => { if (e.target === ov) close(); } },
    h("div", { class: "qs-win qs-newwin" }, h("div", { class: "qs-wtitle" }, h("span", {}, after ? `NEW QUEST AFTER “${after.Title.toUpperCase()}”` : "NEW QUEST"), h("button", { class: "qs-x", onclick: close }, "x")), body));
  const types = [["kill", "Kill", "assets/ui/studio/target.png"], ["reach", "Go to", "assets/ui/studio/arrow.png"], ["collect", "Collect", "assets/ui/studio/loot.png"], ["talk", "Talk to", "assets/ui/studio/alert.png"], ["use", "Use", "assets/ui/studio/alert-item.png"], ["build", "Build", "assets/world/objects/Crude Sign.png"], ["boss", "Boss", "assets/ui/studio/crown.png"]];
  const draw = () => {
    const g = S.npcBy[st.Giver], t = S.npcBy[st.TurnIn || st.Giver];
    let cfg;
    if (st.type === "kill" || st.type === "boss") cfg = h("div", { class: "qs-row wrap" }, st.targets.map(n => h("span", { class: "qs-chip" }, pix(enemyByName()[n.toLowerCase()].Image, "mi"), n)),
      h("button", { class: "qs-btn", onclick: () => qsPickModal("Which enemies count?", enemyEntries(), l => { st.targets = l; draw(); }, { multi: true, selected: st.targets }) }, st.targets.length ? "change enemies" : "pick enemies (any of them count)"),
      st.type === "kill" ? h("label", {}, " how many ", numIn("count")) : null);
    else if (st.type === "collect") cfg = h("div", { class: "qs-row wrap" }, st.item ? h("span", { class: "qs-chip" }, pix(itemByName()[st.item.toLowerCase()].ImgPath, "mi"), st.item) : null,
      h("button", { class: "qs-btn", onclick: () => qsPickModal("Which item?", itemEntries(), v => { st.item = S.itemBy[v].Name; draw(); }) }, st.item ? "change item" : "pick an item"), h("label", {}, " how many ", numIn("count")));
    else if (st.type === "reach") { cfg = h("div", {}, h("div", { class: "hint" }, `Click the map where they should go: ${st.x},${st.y} (a blue ground aura shows there in game)`), qsWorldCanvas({ cx: st.x, cy: st.y, w: 420, h: 200, sc: 12, pin: { x: st.x, y: st.y }, onPick: (x, y) => { st.x = x; st.y = y; draw(); } })); }
    else if (st.type === "talk") cfg = h("button", { class: "qs-btn", onclick: () => qsPickModal("Talk to whom?", npcEntries(), v => { st.npc = +v; draw(); }) }, S.npcBy[st.npc] ? [pix(S.npcBy[st.npc].ImgPath, "mi"), " " + S.npcBy[st.npc].Name] : "pick who");
    else if (st.type === "use") { const s = h("select", { class: "qs-sel" }, USE_ACTIONS.map(a => h("option", { value: a }, a))); s.value = st.use; s.onchange = () => (st.use = s.value); cfg = h("div", { class: "qs-row" }, s, h("label", {}, " times ", numIn("count"))); }
    else cfg = h("div", { class: "hint" }, "Build anything (use: build). Your plot or a free-build area.");
    body.replaceChildren(
      h("div", { class: "qs-step1" }, h("h4", {}, "1. Who asks?"),
        h("div", { class: "qs-row wrap" }, h("button", { class: "qs-portrait", onclick: () => qsPickModal("Who gives it?", npcEntries(), v => { st.Giver = +v; const n = S.npcBy[v]; st.x = n.SpawnX + 5; st.y = n.SpawnY; if (!after) st.Zone = zoneAt(n.SpawnX, n.SpawnY); draw(); }) }, g ? pix(g.ImgPath, "big") : h("span", { class: "big none" }, "?")),
          h("div", {}, h("b", {}, g ? g.Name : "Pick a giver"), h("br"), h("small", {}, "hand in to "), h("button", { class: "qs-mini", onclick: () => qsPickModal("Who takes the hand-in?", npcEntries(), v => { st.TurnIn = +v; draw(); }) }, t ? t.Name : "same person")))),
      h("h4", {}, "2. What do they want?"),
      h("div", { class: "qs-types" }, types.map(([k, l, ic]) => h("button", { class: "qs-type" + (st.type === k ? " on" : ""), onclick: () => { st.type = k; if (k === "boss") st.count = 1; draw(); } }, pix(ic, "ti"), l))), cfg,
      h("h4", {}, "3. In your words"),
      h("div", { class: "qs-grid2" }, h("label", {}, "Title"), txtIn("Title", "e.g. Pelt Me, Please"), h("label", {}, "Offer"), areaIn("Offer", `What does ${g ? g.Name : "the giver"} say when they ask?`)),
      h("details", { class: "qs-more" }, h("summary", {}, `Level ${st.Level} (min ${st.MinLevel}) - ${st.XP} XP - ${st.Gold} gold - ${st.Zone || "no zone"} `, h("small", {}, "suggested from nearby quests")),
        h("div", { class: "qs-grid2" }, h("label", {}, "Level"), numIn("Level"), h("label", {}, "Min level"), numIn("MinLevel"), h("label", {}, "XP"), numIn("XP"), h("label", {}, "Gold"), numIn("Gold"), h("label", {}, "Zone"), txtIn("Zone", "zone", "qs-zones"))),
      h("div", { class: "qs-row" }, h("button", { class: "qs-btn hot big", onclick: create }, "Make the quest"), h("span", { class: "hint" }, after ? `It unlocks when “${after.Title}” is done.` : "No prerequisite: it's on offer from the start (link it on the map).")));
  };
  const numIn = k => { const i = h("input", { type: "number", class: "qs-in num", value: st[k] }); i.oninput = () => (st[k] = +i.value); return i; };
  const txtIn = (k, ph, list) => { const i = h("input", { class: "qs-in", value: st[k], placeholder: ph }); if (list) i.setAttribute("list", list); i.oninput = () => (st[k] = i.value); return i; };
  const areaIn = (k, ph) => { const i = h("textarea", { class: "qs-in rh", placeholder: ph, rows: 3 }); i.value = st[k]; i.oninput = () => (st[k] = i.value); return i; };
  async function create() {
    if (!S.npcBy[st.Giver]) { qsToast("Pick who gives it first"); return; }
    let step;
    if (st.type === "kill" || st.type === "boss") { if (!st.targets.length) { qsToast("Pick at least one enemy"); return; } step = { Type: st.type, Target: st.targets[0], Count: st.type === "boss" ? 1 : Math.max(1, st.count), Text: st.type === "boss" ? `Defeat the ${st.targets[0]}` : `Kill ${st.count} ${st.targets.join(" or ")}` }; if (st.targets.length > 1) step.Targets = [...st.targets]; }
    else if (st.type === "collect") { if (!st.item) { qsToast("Pick an item"); return; } step = { Type: "collect", Target: st.item, Count: Math.max(1, st.count), Text: `Collect ${st.count} ${st.item}` }; }
    else if (st.type === "reach") step = { Type: "reach", X: st.x, Y: st.y, Radius: 3, Count: 1, Text: `Go to ${zoneAt(st.x, st.y) || st.x + "," + st.y}` };
    else if (st.type === "talk") { if (!S.npcBy[st.npc]) { qsToast("Pick who to talk to"); return; } step = { Type: "talk", NPC: st.npc, Count: 1, Text: `Talk to ${npcName(st.npc)}`, Line: "" }; }
    else if (st.type === "use") step = { Type: "use", Target: st.use, Count: Math.max(1, st.count), Text: `${st.use} x${st.count}` };
    else step = { Type: "use", Target: "build", Count: 1, Text: "Build something" };
    const row = { id: 0, Act: +st.Act || 1, Zone: st.Zone || "", Title: st.Title.trim() || "Untitled quest", Summary: "", Level: Math.max(1, st.Level), MinLevel: Math.max(1, st.MinLevel), Giver: st.Giver, TurnIn: st.TurnIn || st.Giver,
      Prereqs: JSON.stringify(after ? [after.id] : []), Offer: st.Offer, Accept: "", Progress: "", Complete: "", XP: Math.max(0, st.XP), Gold: Math.max(0, st.Gold), Rewards: "[]", Steps: JSON.stringify([step]), Sequential: 0 };
    try {
      const id = await qsCommit("quest_def", row, `New quest: ${row.Title}`);
      close(); QS.sel = id; QS.view = "journey"; QS.arg = id; go("#studio/journey/" + id);
    } catch (e) { qsToast(e.message); }
  }
  draw();
  document.body.append(ov); document.addEventListener("keydown", esc, true);
}
function qsNewNpc() {
  const sel = QS.sel && qById(QS.sel), near = sel && S.npcBy[sel.Giver];
  const st = { Name: "", ImgPath: "assets/npc/Person.png", Faction: "", x: near ? near.SpawnX + 3 : 0, y: near ? near.SpawnY : 0 };
  const close = () => { ov.remove(); };
  const body = h("div", { class: "qs-wbody qs-new" });
  const ov = h("div", { class: "qs-modal", onclick: e => { if (e.target === ov) close(); } }, h("div", { class: "qs-win qs-newwin" }, h("div", { class: "qs-wtitle" }, h("span", {}, "NEW NPC"), h("button", { class: "qs-x", onclick: close }, "x")), body));
  const name = h("input", { class: "qs-in", placeholder: "e.g. Gideon Gazump", oninput: () => (st.Name = name.value) });
  const fac = h("input", { class: "qs-in", placeholder: "faction (optional)", list: "qs-factions", oninput: () => (st.Faction = fac.value) });
  if (!$("#qs-factions")) document.body.append(h("datalist", { id: "qs-factions" }, [...new Set(S.c.npcs.map(x => x.Faction).filter(Boolean))].map(z => h("option", { value: z }))));
  const look = h("button", { class: "qs-herobtn", title: "Pick their sprite" });
  const drawLook = () => look.replaceChildren(qsScene({ SpawnX: st.x, SpawnY: st.y }, st.ImgPath, "hero"));
  look.onclick = () => openPicker({ title: "Their look", groups: npcSpriteGroups, recentKey: "npc", value: st.ImgPath, onPick: v => { if (v) { st.ImgPath = v; drawLook(); map.redraw(); } } });
  const zones = [...new Set(S.c.quests.map(q => q.Zone).filter(Boolean))];
  const jump = h("select", { class: "qs-sel" }, h("option", { value: "" }, "jump to a zone..."), zones.map(z => h("option", { value: z }, z)));
  jump.onchange = () => { const q = S.c.quests.find(x => x.Zone === jump.value), n = q && S.npcBy[q.Giver]; if (n) { map.st.cx = n.SpawnX; map.st.cy = n.SpawnY; st.x = n.SpawnX + 2; st.y = n.SpawnY; map.redraw(); where.textContent = `${st.x},${st.y}`; } };
  const where = h("b", {}, `${st.x},${st.y}`);
  const pin = { x: st.x, y: st.y };
  const map = qsWorldCanvas({ cx: st.x, cy: st.y, w: 460, h: 240, sc: 16, pin, pinImg: st.ImgPath, onPick: (x, y) => { st.x = pin.x = x; st.y = pin.y = y; where.textContent = `${x},${y} ${zoneAt(x, y)}`; drawLook(); } });
  drawLook();
  body.append(h("div", { class: "qs-row wrap" }, look, h("div", { class: "qs-grid2" }, h("label", {}, "Name"), name, h("label", {}, "Faction"), fac)),
    h("h4", {}, "Drop them on the map ", jump), map, h("div", {}, "Standing at ", where),
    h("div", { class: "qs-row" }, h("button", { class: "qs-btn hot big", onclick: async () => {
      if (!st.Name.trim()) { qsToast("Give them a name"); name.focus(); return; }
      const id = await qsCommit("npc", { id: 0, Name: st.Name.trim(), ImgPath: st.ImgPath, Faction: st.Faction, Conversation: "", SpawnX: st.x, SpawnY: st.y }, `New NPC: ${st.Name}`);
      close(); qsGo("npc", id);
    } }, "Bring them to life")));
  document.body.append(ov); name.focus();
}

// Daily quests slot in here: a daily flag and pools of candidate mobs/items
// are being added to the API (schema note: /workspace/dailyquests/SCHEMA.md).
// Until quest_def has that column this shows nothing; once it does, the
// toggle works on it and the pool picker reuses qsPickModal({ multi: true }).
function qsDailyBox(q, P) {
  if (!("Daily" in q)) return null;
  const on = !!+q.Daily;
  return h("div", { class: "qs-seg" }, h("button", { class: on ? "" : "on", onclick: () => on && P({ Daily: 0 }, "Not a daily") }, "Once"), h("button", { class: on ? "on" : "", onclick: () => !on && P({ Daily: 1 }, "Daily quest") }, "Daily"),
    h("span", { class: "hint" }, on ? "Rolls a new variant at each daily reset; {mob} {item} {count} in the text are filled in." : "Done once per character."));
}
