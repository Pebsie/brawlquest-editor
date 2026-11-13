"use strict";
// Quick quest: a guided way to make a quest, idea first.
//   1. Who gives it?  (sprite cards, by place)
//   2. What do they ask you to do?  (a sentence: Kill 6 Spiders near Squall's End)
//   3. What do they say?  (the offer, then the hand-in line)
//   4. Hand-in and reward  (filled in for you; More for the rest)
// Beside it: the quest as the game's quest log shows it, the conversation
// window, and plain-word checks. Making it writes one quest_def row through
// qsCommit (same as + Quest), so undo, History, Save .db and GitHub all see it.
// Everything else (branching talk, daily pools, use/craft/equip steps) stays
// in the quest sheet and the Quests tab.
const QQ = { st: null, done: null, npcZone: "", npcFind: "", pickAll: false };

// ---------------------------------------------------------------- words
function qqPlural(name, n) {
  if (n === 1) return name;
  const m = /^(.*?)( of .*)$/.exec(name);
  if (m) return qqPlural(m[1], 2) + m[2];
  if (/(s|x|z|ch|sh)$/i.test(name)) return name + "es";
  if (/[^aeiou]y$/i.test(name)) return name.slice(0, -1) + "ies";
  return name + "s";
}
const qqThe = name => (/^the /i.test(name) ? name : "the " + name);

// ---------------------------------------------------------------- what the world knows
// Enemy spawns from the map's world tiles: name -> [[x, y, zone]].
function qqSpawns() {
  if (!S.world) return {};
  if (QQ._sp && QQ._sp.w === S.world) return QQ._sp.m;
  const m = {};
  for (const t of S.world.tiles.values()) { const n = S.world.strings[t[6]]; if (n) (m[n] = m[n] || []).push([t[0], t[1], S.world.strings[t[4]] || ""]); }
  QQ._sp = { w: S.world, m };
  return m;
}
const QQ_NEAR = 60; // tiles: "near" the giver
function qqNear(name, g) {
  const all = qqSpawns()[name] || [];
  if (!g) return { all: all.length, near: 0, nearest: null, zones: [] };
  const d = p => Math.hypot(p[0] - g.SpawnX, p[1] - g.SpawnY);
  const near = all.filter(p => d(p) <= QQ_NEAR);
  const nearest = all.length ? all.reduce((a, p) => (d(p) < d(a) ? p : a)) : null;
  const zc = {}; for (const p of near.length ? near : all) if (p[2]) zc[p[2]] = (zc[p[2]] || 0) + 1;
  return { all: all.length, near: near.length, nearest, dist: nearest ? Math.round(d(nearest)) : 0, zones: Object.entries(zc).sort((a, b) => b[1] - a[1]).map(x => x[0]) };
}
// Where an item comes from: enemies that drop it (chance %, amount).
function qqDrops(itemId) {
  return (S.c.loot || []).filter(l => +l.ItemID === +itemId).map(l => ({ e: S.enemyBy[l.EnemyID], chance: +l.Chance, amount: Math.max(1, +l.Amount) })).filter(x => x.e);
}
const qqIsBoss = e => BQBal.isBoss(e, S.c.loot || []);
function qqZoneOf(n) { return n ? zoneAt(n.SpawnX, n.SpawnY) || "" : ""; }
function qqZoneLevel(zone) {
  const ls = S.c.quests.filter(q => zone && q.Zone === zone).map(q => +q.Level || 1);
  return ls.length ? BQBal.median(ls) : null;
}
// A mob's level, as the balance guide works it out (quests that hunt it, the
// zones it is placed in, then its numbers). Cached per db load.
function qqMobLevel(e) {
  if (!e) return null;
  if (!QQ._ml || QQ._ml.c !== S.c || QQ._ml.w !== S.world) QQ._ml = { c: S.c, w: S.world, m: {}, z: BQBal.spawnZones(S.world) };
  if (!(e.Name in QQ._ml.m)) { const st = BQBal.stageOf(S.c, e, QQ._ml.z); QQ._ml.m[e.Name] = st.length ? st[0].level : null; }
  return QQ._ml.m[e.Name];
}

// ---------------------------------------------------------------- smart defaults
function qqKillCount(name, g) {
  const n = qqNear(name, g), k = n.near || n.all;
  if (k >= 20) return 10; if (k >= 10) return 8; if (k >= 5) return 6; return Math.max(3, k);
}
function qqCollectCount(itemId) {
  // about six kills' worth of the best drop, 1 to 8
  const ds = qqDrops(itemId); if (!ds.length) return 1;
  const best = Math.max(...ds.map(d => (d.chance / 100) * d.amount));
  return Math.max(1, Math.min(8, Math.floor(6 * best)));
}
function qqAuto(st) {
  const g = S.npcBy[st.Giver];
  const zone = qqZoneOf(g) || (g && (S.c.quests.find(q => q.Giver === g.id && q.Zone) || {}).Zone) || "";
  let level = qqZoneLevel(zone), why = level != null ? `the usual level of quests in ${zone}` : "";
  const mobs = st.objs.filter(o => o.type === "kill" || o.type === "boss").map(o => enemyByName()[String(o.target).toLowerCase()]).filter(Boolean);
  for (const o of st.objs.filter(o => o.type === "collect" && o.item)) { const d = qqDrops(o.item).sort((a, b) => b.chance - a.chance)[0]; if (d) mobs.push(d.e); }
  const ml = mobs.map(qqMobLevel).filter(x => x != null);
  if (ml.length && (level == null || Math.max(...ml) > level + 2)) { level = Math.max(...ml); why = `where ${mobs[ml.indexOf(Math.max(...ml))].Name} is pitched`; }
  const own = g ? S.c.quests.filter(q => q.Giver === g.id).map(q => +q.Level) : [];
  if (level == null && own.length) { level = BQBal.median(own); why = `${g.Name}'s other quests`; }
  if (level == null) { level = 1; why = "the start of the game"; }
  level = Math.max(1, Math.round(level));
  const sug = qsSuggest(level);
  let mult = 1;
  if (st.objs.some(o => o.type === "boss")) mult += 1;
  mult += 0.5 * Math.max(0, st.objs.length - 1);
  let XP = Math.round(sug.XP * mult / 5) * 5, Gold = Math.round(sug.Gold * mult / 5) * 5;
  // later in a story never pays less than the quest before it
  const prev = st.after && qById(st.after);
  if (prev) { XP = Math.max(XP, +prev.XP || 0); Gold = Math.max(Gold, +prev.Gold || 0); }
  return { zone, level, why, MinLevel: Math.max(1, level - 2), XP, Gold };
}
// The live values: what you set under More wins over the suggestion.
function qqVals(st) {
  const a = qqAuto(st), o = st.over;
  return { ...a, zone: o.zone ?? a.zone, level: o.level ?? a.level, MinLevel: o.MinLevel ?? (o.level != null ? Math.max(1, o.level - 2) : a.MinLevel), XP: o.XP ?? a.XP, Gold: o.Gold ?? a.Gold };
}

// ---------------------------------------------------------------- objectives
const QQ_TYPES = [
  ["kill", "Kill some enemies", "assets/ui/studio/target.png"],
  ["collect", "Bring back items", "assets/ui/studio/loot.png"],
  ["boss", "Beat a boss", "assets/ui/studio/crown.png"],
  ["talk", "Talk to someone", "assets/ui/studio/alert.png"],
  ["reach", "Go somewhere", "assets/ui/studio/arrow.png"],
];
function qqObjText(o, st) {
  const g = S.npcBy[st.Giver], t = S.npcBy[st.TurnIn || st.Giver];
  if (o.type === "kill") return o.target ? `Kill ${o.count} ${qqPlural(o.target, o.count)}` : "Kill ...";
  if (o.type === "boss") return o.target ? `Defeat ${qqThe(o.target)}` : "Defeat ...";
  if (o.type === "collect") { const it = S.itemBy[o.item]; return it ? `Bring ${o.count} ${qqPlural(it.Name, o.count)} to ${t ? t.Name : "..."}` : "Bring ..."; }
  if (o.type === "talk") return S.npcBy[o.npc] ? `Talk to ${S.npcBy[o.npc].Name}` : "Talk to ...";
  if (o.type === "reach") return o.x != null ? `Go to ${o.place || zoneAt(o.x, o.y) || "the marked place"}` : "Go to ...";
  return "";
}
function qqObjWhere(o, st) {
  const g = S.npcBy[st.Giver];
  if ((o.type === "kill" || o.type === "boss") && o.target) { const n = qqNear(o.target, g); return n.zones[0] ? `near ${n.zones[0]}` : ""; }
  return "";
}
// The hint the quest log shows under the current step ("How: ...").
function qqHint(o, st) {
  const g = S.npcBy[st.Giver];
  if ((o.type === "kill" || o.type === "boss") && o.target) { const n = qqNear(o.target, g); return n.zones[0] ? `${qqPlural(o.target, 2)} are found around ${n.zones[0]}.` : ""; }
  if (o.type === "collect" && S.itemBy[o.item]) { const d = qqDrops(o.item).sort((a, b) => b.chance - a.chance)[0]; return d ? `${qqPlural(d.e.Name, 2)} drop them.` : ""; }
  return "";
}
function qqStep(o, st) {
  const text = qqObjText(o, st), hint = qqHint(o, st);
  const s = o.type === "kill" ? { Type: "kill", Target: o.target, Count: Math.max(1, o.count), Text: text }
    : o.type === "boss" ? { Type: "boss", Target: o.target, Count: 1, Text: text }
    : o.type === "collect" ? { Type: "collect", Target: S.itemBy[o.item].Name, Count: Math.max(1, o.count), Consume: true, Text: text }
    : o.type === "talk" ? { Type: "talk", NPC: o.npc, Count: 1, Text: text, Line: o.line || "" }
    : { Type: "reach", X: o.x, Y: o.y, Radius: 3, Count: 1, Text: text };
  if (hint) s.Hint = hint;
  return s;
}
const qqObjReady = o => (o.type === "kill" || o.type === "boss" ? !!o.target : o.type === "collect" ? !!S.itemBy[o.item] : o.type === "talk" ? !!S.npcBy[o.npc] : o.x != null);

// ---------------------------------------------------------------- checks, in plain words
function qqChecks(st) {
  const out = [], add = (sev, msg) => out.push({ sev, msg });
  const g = S.npcBy[st.Giver], v = qqVals(st);
  if (!g) add("err", "Pick who gives the quest.");
  if (!st.objs.length) add("err", "Say what they ask you to do.");
  st.objs.forEach((o, i) => {
    const which = st.objs.length > 1 ? `Thing ${i + 1}: ` : "";
    if (!qqObjReady(o)) { add("err", which + ({ kill: "pick which enemy.", boss: "pick which boss.", collect: "pick which item.", talk: "pick who to talk to.", reach: "click the map where they should go." })[o.type]); return; }
    if (o.type === "kill" || o.type === "boss") {
      const n = qqNear(o.target, g);
      if (!n.all) add("err", `${which}there are no ${qqPlural(o.target, 2)} anywhere on the map, so nobody can finish this.`);
      else if (!n.near) add("warn", `${which}no ${qqPlural(o.target, 2)} live near ${g ? g.Name : "the giver"}. The nearest is ${n.dist} tiles away${n.zones[0] ? " in " + n.zones[0] : ""}.`);
      else if (o.type === "kill" && o.count > n.near * 3 && o.count > 10) add("warn", `${which}${o.count} is a lot: there are only ${n.near} nearby, so players will wait on respawns.`);
      const ml = qqMobLevel(enemyByName()[o.target.toLowerCase()]);
      if (ml != null && Math.abs(ml - v.level) > 4) add("warn", `${which}${qqPlural(o.target, 2)} suit level ${ml}, but this is a level ${v.level} quest.`);
    }
    if (o.type === "collect") {
      const ds = qqDrops(o.item), it = S.itemBy[o.item];
      if (!ds.length) add("warn", `${which}nothing drops ${it.Name}. Players can only get it if someone gives it to them or they craft it.`);
      else { const best = ds.reduce((a, d) => (d.chance * d.amount > a.chance * a.amount ? d : a)); const kills = Math.ceil(o.count / ((best.chance / 100) * best.amount)); if (kills > 40) add("warn", `${which}about ${kills} ${qqPlural(best.e.Name, 2)} to kill for ${o.count} (${best.chance}% drop). Try fewer.`); }
    }
    if (o.type === "talk" && !String(o.line || "").trim()) add("warn", `${which}write what ${S.npcBy[o.npc].Name} says when you get there.`);
    if (o.type === "talk" && o.npc === st.Giver) add("warn", `${which}that's the same person who gives the quest.`);
  });
  if (!String(st.Offer || "").trim()) add("err", `Write what ${g ? g.Name : "they"} say${g ? "s" : ""} when they ask. It's the first thing players read.`);
  if (!String(st.Complete || "").trim()) add("warn", `Write what ${S.npcBy[st.TurnIn || st.Giver] ? S.npcBy[st.TurnIn || st.Giver].Name : "they"} says when you hand it in, or the hand-in box is empty.`);
  if (st.after && qById(st.after)) add("info", `Follows “${qById(st.after).Title}”: players are offered it once they've handed that in.`);
  if (st.after && qById(st.after) && qById(st.after).Level > v.level) add("warn", `It comes after a level ${qById(st.after).Level} quest but is level ${v.level}.`);
  if (st.reward && v.level < 10 && S.itemBy[st.reward] && /wep|arm|shield|mount/i.test(S.itemBy[st.reward].Type)) add("info", "Gear as a quest reward is rare. Keep it for the end of a story.");
  if (g && S.c.quests.filter(q => q.Giver === g.id && !qPre(q).length).length >= 3 && !st.after) add("info", `${g.Name} already has ${S.c.quests.filter(q => q.Giver === g.id && !qPre(q).length).length} quests on offer from the start.`);
  return out;
}

// ---------------------------------------------------------------- the page
function qqNew(giver) {
  QQ.st = { Giver: giver || 0, TurnIn: 0, objs: [], Offer: "", Complete: "", Title: "", titleSet: false, inOrder: false, after: 0, reward: 0, rewardN: 1, over: {}, open: null };
  QQ.done = null;
}
// "What happens next?": the same giver, after the quest just made, a level up.
function qqNext(prevId) {
  const prev = qById(prevId); if (!prev) { qqNew(0); return; }
  qqNew(prev.Giver);
  QQ.st.after = prev.id;
  QQ.st.over.level = Math.min(BQBal.C.maxLevel, (+prev.Level || 1) + 1);
  QQ.st.levelWhy = `one up from “${prev.Title}” (level ${prev.Level})`;
}

// ---------------------------------------------------------------- chains
// Story chains through an NPC, from the prerequisite links: each starts at a
// quest of theirs that doesn't follow another of theirs and follows the
// quests that need it (the chain may move on to someone else).
function qqChains(nid) {
  const mine = S.c.quests.filter(q => q.Giver === nid || q.TurnIn === nid), ids = new Set(mine.map(q => q.id));
  const next = id => S.c.quests.filter(q => qPre(q).includes(id)).sort((a, b) => a.Level - b.Level || a.id - b.id);
  const heads = mine.filter(q => !qPre(q).some(p => ids.has(p))).sort((a, b) => a.Level - b.Level || a.id - b.id);
  const out = [];
  for (const hq of heads) {
    const ch = [hq], seen = new Set([hq.id]);
    for (let n = next(hq.id)[0]; n && !seen.has(n.id) && ch.length < 12; n = next(n.id)[0]) { ch.push(n); seen.add(n.id); }
    out.push(ch);
  }
  return out;
}
function qqChainRow(nid, o = {}) {
  const n = S.npcBy[nid]; if (!n) return null;
  const chains = qqChains(nid), linked = chains.filter(c => c.length > 1), lone = chains.filter(c => c.length === 1);
  if (!chains.length) return h("div", { class: "qq-chains hint" }, `${n.Name} has no quests yet.`);
  const link = q => h("a", { href: "#studio/journey/" + q.id, class: "qq-cq" + (o.mark === q.id ? " mark" : ""), "data-q": q.id, title: `Lv ${q.Level}: open in the quest sheet`, onclick: e => { e.preventDefault(); QS.sel = q.id; qsGo("journey", q.id); } }, q.Title);
  return h("div", { class: "qq-chains" }, h("div", { class: "qq-ch-h" }, `${n.Name}'s stories`),
    linked.map(c => h("div", { class: "qq-chain" }, c.map((q, i) => [i ? h("span", { class: "qq-arrow" }, "->") : null, link(q)]))),
    lone.length ? h("div", { class: "qq-chain lone" }, h("small", { class: "hint" }, linked.length ? "On their own: " : "Quests on their own: "), lone.map((c, i) => [i ? ", " : null, link(c[0])])) : null);
}
function qsQuick(body, arg) {
  if (!QQ.st || (arg && +arg !== QQ.st.Giver && !QQ.st.objs.length)) qqNew(arg ? +arg : 0);
  const wrap = h("div", { class: "qq" });
  const left = h("div", { class: "qq-flow", id: "qq-flow" }), right = h("div", { class: "qq-side", id: "qq-side" });
  wrap.append(left, right);
  body.append(wrap);
  QQ.left = left; QQ.right = right;
  qqDraw();
}
// Redraw keeps the scroll where it was and the text box you were in.
function qqDraw() {
  const L = QQ.left; if (!L || !L.isConnected) return;
  const keep = L.scrollTop, act = document.activeElement, actKey = act && act.dataset ? act.dataset.qq : null, sel = actKey && act.selectionStart;
  L.replaceChildren(...qqFlow());
  L.classList.toggle("made", !!QQ.done);
  L.scrollTop = keep;
  if (actKey) { const n = L.querySelector(`[data-qq="${actKey}"]`); if (n) { n.focus(); try { n.setSelectionRange(sel, sel); } catch {} } }
  qqSide();
}
function qqSide() {
  const R = QQ.right; if (!R || !R.isConnected) return;
  const keep = R.scrollTop;
  R.replaceChildren(...qqPreview().flat().filter(Boolean));
  R.scrollTop = keep;
}
function qqCard(n, title, done, summary, body, key) {
  const st = QQ.st, open = st.open === key || !done;
  return h("section", { class: "qq-card" + (done ? " done" : "") + (open ? " open" : ""), "data-card": key },
    h("div", { class: "qq-chead" }, h("span", { class: "qq-num" }, done ? "✓" : n), h("h3", {}, title),
      done && !open ? h("div", { class: "qq-sum" }, summary) : null, h("span", { class: "qs-sp" }),
      done ? h("button", { class: "qs-mini", onclick: () => { st.open = open ? null : key; qqDraw(); } }, open ? "done" : "change") : null),
    open ? h("div", { class: "qq-cbody" }, body) : null);
}
function qqFlow() {
  const st = QQ.st, g = S.npcBy[st.Giver];
  if (!S.world) return [h("p", { class: "hint" }, "Loading the world...")];
  const cards = [h("div", { class: "qq-intro" }, h("h2", {}, "Quick quest"), h("p", {}, "Start with an idea. Pick who asks, what they want and what they say. Level, rewards and the fiddly bits are filled in for you."),
    h("button", { class: "qs-mini", onclick: () => { qqNew(0); qqDraw(); } }, "Start again"))];
  // 1. giver
  cards.push(qqCard(1, "Who gives it?", !!g, g ? [pix(g.ImgPath, "mi"), ` ${g.Name}`, h("small", {}, ` in ${qqZoneOf(g) || "the wilds"}`)] : null, qqNpcPicker(id => { st.Giver = id; st.open = null; qqDraw(); }, st.Giver), "giver"));
  if (!g) return cards;
  cards.push(qqChainRow(g.id, { mark: st.after }));
  // 2. what to do
  const objsReady = st.objs.length && st.objs.every(qqObjReady);
  if (!objsReady) st.objsOk = false;
  cards.push(qqCard(2, "What do they ask you to do?", objsReady && st.objsOk && !st.adding, st.objs.map(o => qqObjText(o, st)).join(", then "), qqObjectives(), "objs"));
  if (!objsReady || !st.objsOk) return cards;
  // 3. words
  const wordsDone = !!String(st.Offer).trim() && st.open !== "words";
  cards.push(qqCard(3, `What does ${g.Name} say?`, wordsDone && !!String(st.Complete).trim(), h("span", { class: "rh" }, `“${String(st.Offer).slice(0, 70)}${st.Offer.length > 70 ? "..." : ""}”`), qqWords(), "words"));
  if (!String(st.Offer).trim()) return cards;
  // 4. hand-in and reward
  cards.push(qqCard(4, "Hand-in and reward", false, null, qqReward(), "reward"));
  return cards;
}
function qqNpcPicker(onPick, cur) {
  const by = {};
  for (const n of S.c.npcs) { const z = qqZoneOf(n) || "Elsewhere"; (by[z] = by[z] || []).push(n); }
  const zl = z => qqZoneLevel(z) ?? 99;
  const zones = Object.keys(by).sort((a, b) => (a === "Elsewhere") - (b === "Elsewhere") || zl(a) - zl(b) || by[b].length - by[a].length);
  if (!QQ.npcZone || !by[QQ.npcZone]) QQ.npcZone = (S.npcBy[cur] && qqZoneOf(S.npcBy[cur])) || zones[0];
  const f = QQ.npcFind.trim().toLowerCase();
  const list = f ? S.c.npcs.filter(n => `${n.Name} ${n.Faction}`.toLowerCase().includes(f)) : by[QQ.npcZone];
  const find = h("input", { type: "search", class: "qs-in", "data-qq": "npcfind", placeholder: "Find someone by name...", value: QQ.npcFind });
  find.addEventListener("input", () => { QQ.npcFind = find.value; qqDraw(); });
  const gives = n => S.c.quests.filter(q => q.Giver === n.id).length;
  return [
    h("div", { class: "qq-zones" }, zones.map(z => h("button", { class: "qq-zone" + (z === QQ.npcZone && !f ? " on" : ""), onclick: () => { QQ.npcZone = z; QQ.npcFind = ""; qqDraw(); } }, z, h("small", {}, ` ${by[z].length}`)))),
    find,
    h("div", { class: "qq-cards" }, (list || []).slice(0, 60).map(n => h("button", { class: "qq-pc" + (n.id === cur ? " on" : ""), "data-npc": n.id, onclick: () => onPick(n.id) },
      qsScene(n, null, "small"), h("b", {}, n.Name), h("small", {}, f ? qqZoneOf(n) || "elsewhere" : gives(n) ? `${gives(n)} quest${gives(n) > 1 ? "s" : ""}` : "no quests yet")))),
  ];
}
function qqObjectives() {
  const st = QQ.st, g = S.npcBy[st.Giver];
  const rows = st.objs.map((o, i) => qqObjRow(o, i));
  const last = st.objs[st.objs.length - 1];
  const adding = !st.objs.length || st.adding;
  const typeBtns = h("div", { class: "qq-types" }, QQ_TYPES.map(([k, label, ic]) => h("button", { class: "qq-type", "data-type": k, onclick: () => {
    const o = { type: k, target: "", item: 0, npc: 0, count: 1, x: null, y: null, line: "" };
    st.objs.push(o); st.adding = false; QQ.pickAll = false; qqDraw();
  } }, pix(ic, "ti"), label)));
  return [
    rows,
    adding ? [st.objs.length ? h("p", { class: "hint" }, "And then:") : h("p", { class: "hint" }, `Pick one. You can add more after.`), typeBtns,
      st.objs.length ? h("button", { class: "qs-mini", onclick: () => { st.adding = false; qqDraw(); } }, "cancel") : null] :
      h("div", { class: "qs-row" }, last && qqObjReady(last) ? h("button", { class: "qs-mini", id: "qq-add", onclick: () => { st.adding = true; qqDraw(); } }, "+ and also...") : null,
        st.objs.length > 1 ? h("div", { class: "qs-seg" }, h("button", { class: st.inOrder ? "" : "on", onclick: () => { st.inOrder = false; qqDraw(); } }, "Any order"), h("button", { class: st.inOrder ? "on" : "", onclick: () => { st.inOrder = true; qqDraw(); } }, "In this order")) : null,
        st.objs.length && qqObjReady(last) ? h("button", { class: "qs-btn hot", id: "qq-objs-ok", onclick: () => { st.open = null; st.objsOk = true; qqDraw(); } }, "That's it") : null),
  ];
}
function qqObjRow(o, i) {
  const st = QQ.st, g = S.npcBy[st.Giver];
  const rm = h("button", { class: "qs-mini", title: "Remove", onclick: () => { st.objs.splice(i, 1); qqDraw(); } }, "x");
  const stepper = () => h("span", { class: "qq-count" },
    h("button", { class: "qs-mini", onclick: () => { o.count = Math.max(1, o.count - 1); qqDraw(); } }, "-"), h("b", {}, o.count),
    h("button", { class: "qs-mini", onclick: () => { o.count = Math.min(99, o.count + 1); qqDraw(); } }, "+"));
  const ready = qqObjReady(o);
  let sentence, note = null, picker = null;
  if (o.type === "kill" || o.type === "boss") {
    const e = enemyByName()[String(o.target).toLowerCase()];
    sentence = o.type === "kill" ? ["Kill ", e ? stepper() : null, " ", e ? h("span", { class: "qq-thing" }, pix(e.Image, "mi"), qqPlural(e.Name, o.count)) : h("i", {}, "which enemy?"), " ", qqObjWhere(o, st)]
      : ["Defeat ", e ? h("span", { class: "qq-thing" }, pix(e.Image, "mi"), qqThe(e.Name)) : h("i", {}, "which boss?"), " ", qqObjWhere(o, st)];
    if (e) { const n = qqNear(e.Name, g); note = n.near ? `${n.near} of them live within ${QQ_NEAR} tiles of ${g.Name}.` : n.all ? `None near ${g.Name}: the nearest is ${n.dist} tiles away.` : "None on the map yet."; }
    if (!e || o.picking) picker = qqEnemyPicker(o);
  } else if (o.type === "collect") {
    const it = S.itemBy[o.item];
    sentence = ["Bring ", it ? stepper() : null, " ", it ? h("span", { class: "qq-thing" }, pix(it.ImgPath, "mi"), qqPlural(it.Name, o.count)) : h("i", {}, "which item?"), ` to ${npcName(st.TurnIn || st.Giver)}`];
    if (it) { const ds = qqDrops(it.id).sort((a, b) => b.chance - a.chance); note = ds.length ? `Dropped by ${ds.slice(0, 3).map(d => `${d.e.Name} (${d.chance}%)`).join(", ")}.` : "Nothing drops this."; }
    if (!it || o.picking) picker = qqItemPicker(o);
  } else if (o.type === "talk") {
    const n = S.npcBy[o.npc];
    sentence = ["Talk to ", n ? h("span", { class: "qq-thing" }, pix(n.ImgPath, "mi"), n.Name) : h("i", {}, "who?"), n ? h("small", {}, ` in ${qqZoneOf(n) || "the wilds"}`) : null];
    if (!n || o.picking) picker = qqNpcPicker(id => { o.npc = id; o.picking = false; qqDraw(); }, o.npc);
    else { const ta = h("textarea", { class: "qs-in rh", rows: 2, "data-qq": "line" + i, placeholder: `What does ${n.Name} say when you get there?` }); ta.value = o.line; ta.addEventListener("input", () => { o.line = ta.value; qqSide(); }); picker = h("label", { class: "qq-lab" }, `${n.Name} says:`, ta); }
  } else {
    if (o.x == null) { o.x = g.SpawnX + 6; o.y = g.SpawnY; o.unset = true; }
    sentence = ["Go to ", o.unset ? h("i", {}, "click the map") : h("span", { class: "qq-thing" }, pix("assets/ui/studio/arrow.png", "mi"), o.place || zoneAt(o.x, o.y) || `${o.x},${o.y}`)];
    o.view = o.view || { cx: o.x, cy: o.y, sc: 12 };
    const pl = h("input", { class: "qs-in", "data-qq": "place" + i, placeholder: "Name the place (optional), e.g. the old well", value: o.place || "" });
    pl.addEventListener("input", () => { o.place = pl.value; qqSide(); });
    picker = [qsWorldCanvas({ w: 560, h: 220, st: o.view, pin: o.unset ? null : { x: o.x, y: o.y }, onPick: (x, y) => { o.x = x; o.y = y; o.unset = false; qqDraw(); } }), h("div", { class: "hint" }, "Drag to look around, scroll to zoom, click to set the spot. Players need to get within 3 tiles."), pl];
    note = null;
  }
  const change = ready && (o.type !== "reach") && !o.picking ? h("button", { class: "qs-mini", onclick: () => { o.picking = true; qqDraw(); } }, "change") : null;
  return h("div", { class: "qq-obj" + (ready ? " ready" : ""), "data-obj": i },
    h("div", { class: "qq-sentence" }, pix(QQ_TYPES.find(t => t[0] === o.type)[2], "ti"), h("span", {}, sentence), h("span", { class: "qs-sp" }), change, rm),
    note ? h("div", { class: "hint qq-note" }, note) : null, picker ? h("div", { class: "qq-pick" }, picker) : null);
}
function qqEnemyPicker(o) {
  const st = QQ.st, g = S.npcBy[st.Giver];
  let list = S.c.enemies.map(e => ({ e, n: qqNear(e.Name, g), boss: qqIsBoss(e) }));
  if (o.type === "boss") list = list.filter(x => x.boss); else list = list.filter(x => !x.boss);
  const near = list.filter(x => x.n.near).sort((a, b) => b.n.near - a.n.near), far = list.filter(x => !x.n.near).sort((a, b) => (a.n.all ? a.n.dist : 1e9) - (b.n.all ? b.n.dist : 1e9));
  const cell = x => h("button", { class: "qq-pc mob", "data-mob": x.e.Name, onclick: () => {
    o.target = x.e.Name; o.picking = false; if (o.type === "kill") o.count = qqKillCount(x.e.Name, g); qqDraw();
  } }, pix(x.e.Image, "pc"), h("b", {}, x.e.Name), h("small", {}, x.n.near ? `${x.n.near} nearby` : x.n.all ? `${x.n.dist} tiles away` : "not on the map"));
  return [near.length ? h("div", { class: "qq-cards" }, near.map(cell)) : h("p", { class: "hint" }, `Nothing ${o.type === "boss" ? "boss-like " : ""}lives near ${g.Name}.`),
    QQ.pickAll ? [h("p", { class: "hint" }, "Further away:"), h("div", { class: "qq-cards" }, far.map(cell))] : h("button", { class: "qs-mini", onclick: () => { QQ.pickAll = true; qqDraw(); } }, `show the rest (${far.length})`)];
}
function qqItemPicker(o) {
  const st = QQ.st, g = S.npcBy[st.Giver];
  const nearMobs = new Set(S.c.enemies.filter(e => qqNear(e.Name, g).near).map(e => e.id));
  const drops = new Map();
  for (const l of S.c.loot || []) if (nearMobs.has(+l.EnemyID) && +l.ItemID !== 11) { const it = S.itemBy[l.ItemID]; if (it) { const d = drops.get(it.id); if (!d || +l.Chance > d.chance) drops.set(it.id, { it, chance: +l.Chance, from: S.enemyBy[l.EnemyID].Name }); } }
  const cell = (it, sub) => h("button", { class: "qq-pc item", "data-item": it.id, onclick: () => { o.item = it.id; o.picking = false; o.count = qqCollectCount(it.id); qqDraw(); } }, pix(it.ImgPath, "pc"), h("b", {}, it.Name), h("small", {}, sub));
  const near = [...drops.values()].sort((a, b) => b.chance - a.chance);
  const f = (QQ.itemFind || "").trim().toLowerCase();
  const find = h("input", { type: "search", class: "qs-in", "data-qq": "itemfind", placeholder: "Find any item...", value: QQ.itemFind || "" });
  find.addEventListener("input", () => { QQ.itemFind = find.value; qqDraw(); });
  const browse = h("button", { type: "button", class: "qs-mini", onclick: () => openItemPicker({ title: "Find any item", onPick: id => { o.item = id; o.picking = false; o.count = qqCollectCount(id); qqDraw(); } }) }, "Browse all items…");
  return [h("p", { class: "hint" }, `Dropped by enemies near ${g.Name}:`), near.length ? h("div", { class: "qq-cards" }, near.slice(0, 24).map(d => cell(d.it, `${d.from}, ${d.chance}%`))) : h("p", { class: "hint" }, "Nothing nearby drops anything."),
    h("div", { class: "qq-row" }, find, browse), f ? h("div", { class: "qq-cards" }, S.c.items.filter(i => i.Name.toLowerCase().includes(f)).map(i => cell(i, i.Type))) : null];
}
function qqWords() {
  const st = QQ.st, g = S.npcBy[st.Giver], t = S.npcBy[st.TurnIn || st.Giver];
  const ta = (key, ph, rows) => { const e = h("textarea", { class: "qs-in rh", rows, "data-qq": key, placeholder: ph }); e.value = st[key]; e.addEventListener("input", () => { const was = !!st[key].trim(); st[key] = e.value; if (key === "Offer" && was !== !!e.value.trim()) qqDraw(); else qqSide(); }); return e; };
  const first = st.objs[0], what = first ? qqObjText(first, st).toLowerCase() : "";
  return [
    h("label", { class: "qq-lab" }, `When ${g.Name} asks:`, ta("Offer", st.after && qById(st.after) ? `Carry on from “${qById(st.after).Title}”: what has happened since, and why they now need you to ${what}.` : `In their own words: why they need you to ${what}. A sentence or two is plenty.`, 3)),
    h("label", { class: "qq-lab" }, `When you hand it in to ${t.Name}:`, ta("Complete", "What they say when it's done. Leave it for later if you like.", 2)),
    h("p", { class: "hint" }, "Plain and in character. Players answer with “I'll do it.” or “Not right now.”, which you can change in the quest sheet."),
    !String(st.Offer).trim() ? null : h("button", { class: "qs-btn hot", id: "qq-words-ok", onclick: () => { st.open = "reward"; qqDraw(); } }, "Next"),
  ];
}
function qqTitle(st) {
  if (st.titleSet || st.Title) return st.Title;
  const t = qqTitleBase(st);
  if (!t || !S.c.quests.some(q => q.Title === t)) return t;
  for (let i = 2; ; i++) if (!S.c.quests.some(q => q.Title === `${t} ${i}`)) return `${t} ${i}`;
}
function qqTitleBase(st) {
  const g = S.npcBy[st.Giver], o = st.objs[0]; if (!g || !o || !qqObjReady(o)) return "";
  if (o.type === "kill") return `${qqPlural(o.target, 2)} for ${g.Name}`;
  if (o.type === "boss") return `${qqThe(o.target).replace(/^the/, "The")}`;
  if (o.type === "collect" && S.itemBy[o.item]) return `${qqPlural(S.itemBy[o.item].Name, 2)} for ${g.Name}`;
  if (o.type === "talk" && S.npcBy[o.npc]) return `A Word with ${S.npcBy[o.npc].Name}`;
  if (o.type === "reach") return `To ${o.place || zoneAt(o.x, o.y) || "the Marked Place"}`;
  return "";
}
function qqReward() {
  const st = QQ.st, v = qqVals(st), g = S.npcBy[st.Giver], t = S.npcBy[st.TurnIn || st.Giver];
  const title = h("input", { class: "qs-in qq-title", "data-qq": "title", value: qqTitle(st), placeholder: "Title" });
  title.addEventListener("input", () => { st.Title = title.value; st.titleSet = !!title.value; qqSide(); });
  const num = (k, min) => { const i = h("input", { type: "number", class: "qs-in num", min, "data-qq": "n" + k, value: v[k === "level" ? "level" : k] }); i.addEventListener("change", () => { st.over[k] = Math.max(min, +i.value || min); if (k === "level") st.levelWhy = ""; qqDraw(); }); return i; };
  const rw = S.itemBy[st.reward];
  const sameLv = S.c.quests.filter(q => Math.abs(q.Level - v.level) <= 3), withItem = sameLv.filter(q => qRw(q).length).length;
  const chain = S.c.quests.filter(q => q.Giver === st.Giver || q.TurnIn === st.Giver).sort((a, b) => a.Level - b.Level);
  const after = h("select", { class: "qs-sel", "data-qq": "after" }, h("option", { value: 0 }, "No: it's on offer from the start"), chain.map(q => h("option", { value: q.id }, `Yes, after “${q.Title}” (Lv ${q.Level})`)));
  after.value = st.after || 0; after.addEventListener("change", () => { st.after = +after.value; qqDraw(); });
  return [
    h("div", { class: "qq-grid" },
      h("label", {}, "Title"), h("div", {}, title, !st.titleSet ? h("small", { class: "hint" }, " suggested, type to change") : null),
      h("label", {}, "Hand in to"), h("div", {}, h("button", { class: "qq-who", onclick: () => qsPickModal("Who takes the hand-in?", npcEntries(), id => { st.TurnIn = +id === st.Giver ? 0 : +id; qqDraw(); }) }, pix(t.ImgPath, "mi"), t.Name), st.TurnIn ? null : h("small", { class: "hint" }, " back to the same person")),
      h("label", {}, "Reward"), h("div", { class: "qq-rw" }, h("b", {}, `Level ${v.level}`), " quest: ", h("b", {}, `${v.XP} XP`), " and ", h("b", {}, `${v.Gold} gold`), rw ? [" and ", h("span", { class: "qq-thing" }, pix(rw.ImgPath, "mi"), `${st.rewardN} ${qqPlural(rw.Name, st.rewardN)}`)] : null,
        h("div", { class: "hint" }, `Level ${st.levelWhy ? st.levelWhy : "from " + v.why + (st.over.level != null ? " (you set it)" : "")}. XP and gold match quests around level ${v.level}.`))),
    h("details", { class: "qq-more", open: !!st.moreOpen, ontoggle: e => { st.moreOpen = e.target.open; } }, h("summary", {}, "More options"),
      h("div", { class: "qq-grid" },
        h("label", {}, "Part of a story?"), after,
        h("label", {}, "Level"), h("div", {}, num("level", 1), " players can take it from level ", num("MinLevel", 1)),
        h("label", {}, "XP / gold"), h("div", {}, num("XP", 0), " XP ", num("Gold", 0), " gold ", Object.keys(st.over).length ? h("button", { class: "qs-mini", onclick: () => { st.over = {}; st.levelWhy = ""; qqDraw(); } }, "back to suggested") : null),
        h("label", {}, "Item reward"), h("div", {}, rw ? [h("span", { class: "qq-thing" }, pix(rw.ImgPath, "mi"), rw.Name), " x ", (() => { const i = h("input", { type: "number", class: "qs-in num", min: 1, value: st.rewardN, "data-qq": "rewardN" }); i.addEventListener("change", () => { st.rewardN = Math.max(1, +i.value || 1); qqDraw(); }); return i; })(), h("button", { class: "qs-mini", onclick: () => { st.reward = 0; qqDraw(); } }, "none")]
          : h("button", { class: "qs-mini", onclick: () => openItemPicker({ title: "Item reward", onPick: id => { st.reward = +id; qqDraw(); } }) }, "add an item"),
          h("div", { class: "hint" }, `Keep these rare: ${withItem} of ${sameLv.length} quests around this level give an item.`)),
        h("label", {}, "Zone"), h("div", {}, (() => { const i = h("input", { class: "qs-in", value: v.zone, "data-qq": "zone" }); i.addEventListener("change", () => { st.over.zone = i.value; qqDraw(); }); return i; })(), h("small", { class: "hint" }, " shown in the quest log"))),
      h("p", { class: "hint" }, "Branching conversations, daily quests and other kinds of objective (use, craft, equip, level) are in the quest sheet once it's made.")),
  ];
}

// ---------------------------------------------------------------- preview + make
function qqRow(st) {
  const v = qqVals(st), daily = 0;
  const steps = st.objs.filter(qqObjReady).map(o => qqStep(o, st));
  return { id: 0, Act: 1, Zone: v.zone || "", Title: (qqTitle(st) || "Untitled quest").trim(), Summary: "", Level: v.level, MinLevel: Math.min(v.MinLevel, v.level), Giver: st.Giver, TurnIn: st.TurnIn || st.Giver,
    Prereqs: JSON.stringify(st.after ? [st.after] : []), Offer: st.Offer.trim(), Accept: "", Progress: "", Complete: st.Complete.trim(), XP: v.XP, Gold: v.Gold,
    Rewards: JSON.stringify(st.reward ? [{ ItemID: st.reward, Amount: st.rewardN }] : []), Steps: JSON.stringify(steps), Sequential: st.inOrder ? 1 : 0, ...(S.c.hasDaily ? { Daily: daily } : {}) };
}
function qqPreview() {
  const st = QQ.st;
  if (QQ.done) return qqDone();
  const g = S.npcBy[st.Giver];
  const row = qqRow(st), steps = JSON.parse(row.Steps), checks = qqChecks(st);
  const errs = checks.filter(c => c.sev === "err");
  // the quest log, laid out as the game's quest panel draws it (client scripts/ui/panels/quests.lua drawDetail)
  const log = h("div", { class: "qs-win qq-log" }, h("div", { class: "qs-wtitle" }, h("span", {}, "QUEST LOG"), h("small", {}, "how it looks in the game")),
    h("div", { class: "qq-logb" },
      h("div", { class: "qq-lt" }, row.Title || "Untitled quest"),
      h("div", { class: "qq-ll" }, `Act ${row.Act}  -  ${row.Zone}  -  Recommended level ${row.Level}`),
      st.after && qById(st.after) ? h("div", { class: "qq-follows", id: "qq-follows" }, `Follows: ${qById(st.after).Title}`, h("small", {}, " (editor note: on offer once that is handed in)")) : null,
      h("div", { class: "qq-lstat" }, "In progress"),
      steps.length ? [h("div", { class: "qq-ll" }, "STEPS"), steps.map((s, i) => [h("div", { class: "qq-ls" + (i === 0 || !row.Sequential ? " now" : "") }, `Step ${i + 1} of ${steps.length} (${i === 0 || !row.Sequential ? "Now" : "Later"}): ${s.Text} 0/${s.Count}`),
        s.Hint && (i === 0 || !row.Sequential) ? h("div", { class: "qq-lh" }, "How: " + s.Hint) : null])] : h("div", { class: "qq-ll" }, "No steps yet"),
      h("div", { class: "qq-lr" }, `Reward: ${row.XP} XP and ${row.Gold} gold` + (qRw(row).length ? `, plus ${qRw(row).length} item` : ""))));
  // the conversation window
  const stage = QQ.talk || "offer";
  const who = stage === "complete" ? S.npcBy[row.TurnIn] : g;
  const talk = who ? h("div", { class: "qs-game qq-talk" }, h("div", { class: "qs-gtitle" }, h("span", {}, who.Name.toUpperCase()),
      h("span", { class: "qq-tabs" }, [["offer", "Asking"], ["complete", "Hand-in"]].map(([k, l]) => h("button", { class: "qs-mini" + (stage === k ? " on" : ""), onclick: () => { QQ.talk = k; qqSide(); } }, l)))),
    h("div", { class: "qs-gbody" }, qsScene(who), h("div", { class: "qs-gright" },
      h("div", { class: "qs-speech rh" }, qsFill(stage === "offer" ? row.Offer : row.Complete) || h("span", { class: "hint" }, stage === "offer" ? "(what they say when they ask)" : "(what they say when you hand it in)")),
      h("div", { class: "qs-gopts" }, (stage === "offer" ? ["I'll do it.", "Not right now.", "Goodbye."] : ["Anything else?", "Goodbye."]).map((t, j) => h("div", { class: "qs-gopt rh" }, h("b", {}, j + 1 + "."), t)))))) : null;
  const chk = h("div", { class: "qs-win qq-checks" }, h("div", { class: "qs-wtitle" }, h("span", {}, "CHECKS")),
    h("div", { class: "qs-wbody" }, checks.length ? checks.map(c => h("div", { class: "qq-chk " + c.sev }, h("b", {}, c.sev === "err" ? "Needed" : c.sev === "warn" ? "Worth a look" : "Note"), " ", c.msg)) : h("div", { class: "qq-chk ok" }, "All good. Ready to make.")));
  const make = h("button", { class: "qs-btn hot big", id: "qq-make", disabled: !!errs.length, onclick: qqMake }, "Make the quest");
  return [log, talk, chk, h("div", { class: "qs-row" }, make, errs.length ? h("span", { class: "hint" }, `${errs.length} thing${errs.length > 1 ? "s" : ""} needed first`) : h("span", { class: "hint" }, "Saved into the open db. Undo works."))];
}
async function qqMake() {
  const st = QQ.st;
  if (qqChecks(st).some(c => c.sev === "err")) return;
  const row = qqRow(st);
  try {
    const id = await qsCommit("quest_def", row, `New quest: ${row.Title}`);
    QQ.done = { id, giver: st.Giver };
    qqDraw();
  } catch (e) { qsToast(e.message); }
}
function qqDone() {
  const q = qById(QQ.done.id), g = S.npcBy[QQ.done.giver];
  if (!q) { QQ.done = null; return qqPreview(); }
  const issues = (qsAnalyse().issues.get(q.id) || []).filter(x => x.sev !== "info");
  return [h("div", { class: "qs-win qq-made" }, h("div", { class: "qs-wtitle" }, h("span", {}, "MADE")),
    h("div", { class: "qs-wbody" },
      h("p", { class: "rh" }, `“${q.Title}” is quest ${q.id}. It's in the open db and History has it.`),
      issues.length ? h("div", {}, h("p", { class: "hint" }, "The journey map flags:"), issues.map(x => h("div", { class: "qq-chk warn" }, x.msg))) : h("p", { class: "hint" }, "The journey map has no problems with it."),
      h("button", { class: "qs-btn hot big qq-nextbtn", id: "qq-next", onclick: () => { qqNext(q.id); qqDraw(); } }, "What happens next?"),
      h("p", { class: "hint" }, `Starts the next quest in this story: ${g ? g.Name : "the same person"} again (you can change who you hand it in to), after this one, at level ${Math.min(BQBal.C.maxLevel, q.Level + 1)}.`),
      qqChainRow(q.Giver, { mark: q.id }),
      h("div", { class: "qq-actions" },
        h("button", { class: "qs-btn", id: "qq-play", onclick: () => qsPreviewQuest(q, "offer") }, "Play the conversation"),
        h("button", { class: "qs-btn", id: "qq-another", onclick: () => { qqNew(g ? g.id : 0); qqDraw(); } }, `Another from ${g ? g.Name : "them"}`),
        h("button", { class: "qs-btn", onclick: () => { qqNew(0); qqDraw(); } }, "A new idea"),
        h("button", { class: "qs-btn", id: "qq-open", onclick: () => { QS.sel = q.id; qsGo("journey", q.id); } }, "Open the full quest sheet"))))];
}
