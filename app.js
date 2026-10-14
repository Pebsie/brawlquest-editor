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
    delete: () => BQ.api.delete(body), tiles: () => BQ.api.tiles(body),
    export: () => (body === undefined ? BQ.api.export() : BQ.api.clearExport()) }[path];
  const out = fn();
  syncFile();
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
  try {
    const warnings = await BQ.open(await file.arrayBuffer(), file.name);
    S.world = null; S.quest = S.npc = S.item = null;
    $("#welcome").hidden = true; $("#main").hidden = false; $("#tabs").hidden = false;
    $("#warn").hidden = !warnings.length; $("#warn").textContent = warnings.join(" ");
    await loadAll(); syncFile();
    if (location.hash.length > 1) await applyRoute(); else renderTab();
  } catch (e) { status(e.message, true); alert(e.message); }
}
function saveDb() {
  const name = BQ.st.name.replace(/(\.db|\.sqlite3?)?$/i, "") + "-edited.db";
  download(new Blob([BQ.bytes()], { type: "application/x-sqlite3" }), /edited/.test(BQ.st.name) ? BQ.st.name : name);
  BQ.st.dirty = false; syncFile();
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
  S.ownerCache = null;
  S.c.items = S.c.items || [];
  S.itemBy = Object.fromEntries(S.c.items.map(i => [i.id, i]));
  S.enemyBy = Object.fromEntries(S.c.enemies.map(e => [e.id, e]));
  status(`${S.c.items.length} items · ${S.c.quests.length} quests · ${S.c.npcs.length} NPCs · ${S.c.conversations.length} dialogue nodes`);
}
async function loadWorld() {
  const w = await api("world");
  S.world = { strings: w.strings, tiles: new Map() };
  for (const t of w.tiles) S.world.tiles.set(t[0] + "," + t[1], t);
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
  kill: "Target = enemy name", boss: "Target = boss enemy name", collect: "Target = item name; Consume takes the items at hand-in",
  talk: "Talk to an NPC; Line is what they say", reach: "Walk within Radius tiles of X,Y",
  use: "Target = action: swing, shield, sprint, potion, mount, spell, build, stat, forge, party, enchant…",
  craft: "Target = item name crafted", equip: "Target = item name or slot", level: "Count = level to reach",
};

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
    Prereqs: "[]", Offer: "", Accept: "", Progress: "", Complete: "", XP: 100, Gold: 10, Rewards: "[]",
    Steps: JSON.stringify([{ Type: "kill", Target: "", Count: 1, Text: "" }]) });
  pick(S.quest ? (S.c.quests.find(q => q.id === S.quest.id) || S.c.quests[0]) : S.c.quests[0] || null);
  if (!S.c.quests.length) newQ();
}

function questForm(form, q) {
  form.textContent = "";
  if (!q) return;
  if (q.id) syncHash("#quest/" + q.id);
  const f = {
    Title: txt(q.Title), Act: num(q.Act), Zone: txt(q.Zone), Level: num(q.Level), MinLevel: num(q.MinLevel),
    Giver: npcSelect(q.Giver), TurnIn: npcSelect(q.TurnIn), Summary: area(q.Summary),
    Offer: area(q.Offer), Accept: area(q.Accept), Progress: area(q.Progress), Complete: area(q.Complete),
    XP: num(q.XP), Gold: num(q.Gold),
  };
  for (const k of ["Offer", "Accept", "Progress", "Complete", "Summary"]) f[k].id = "qline-" + k;
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
      const type = h("select", { onchange: () => { s.Type = type.value; drawSteps(); } }, Object.keys(STEP_FIELDS).map(t => h("option", { value: t }, t)));
      type.value = s.Type;
      const top = h("div", { class: "top" }, h("b", {}, `${i + 1}.`), type);
      for (const k of STEP_FIELDS[s.Type] || []) {
        let el;
        if (k === "NPC") { el = npcSelect(s.NPC, () => (s.NPC = +el.value)); }
        else if (k === "Consume") { el = h("input", { type: "checkbox", onchange: () => (s.Consume = el.checked) }); el.checked = !!s.Consume; }
        else if (k === "Target" && (s.Type === "kill" || s.Type === "boss")) { el = enemySelect(s.Target); el.onchange = () => (s.Target = el.value); }
        else if (k === "Target") { el = txt(s.Target); el.oninput = () => (s.Target = el.value); }
        else { el = num(s[k]); el.oninput = () => (s[k] = +el.value); }
        top.append(h("span", { class: "hint" }, k), el);
      }
      top.append(h("span", { style: "flex:1" }),
        h("button", { onclick: () => { if (i) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; drawSteps(); } } }, "↑"),
        h("button", { onclick: () => { steps.splice(i, 1); drawSteps(); } }, "×"));
      const text = txt(s.Text, "Objective shown in the tracker"); text.style.width = "100%"; text.oninput = () => (s.Text = text.value);
      const hint = txt(s.Hint, "Hint (optional, shown in the quest log)"); hint.style.width = "100%"; hint.oninput = () => (s.Hint = hint.value);
      stepBox.append(h("div", { class: "step", id: "qstep-" + i }, top, h("div", { class: "hint" }, STEP_HELP[s.Type] || ""), text, hint));
    });
    stepBox.append(h("button", { onclick: () => { steps.push({ Type: "kill", Target: "", Count: 1, Text: "" }); drawSteps(); } }, "+ Step"));
  };
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

  const collect = () => ({
    id: q.id, Act: +f.Act.value, Zone: f.Zone.value, Title: f.Title.value, Summary: f.Summary.value, Level: +f.Level.value,
    MinLevel: +f.MinLevel.value, Giver: +f.Giver.value, TurnIn: +f.TurnIn.value, Prereqs: JSON.stringify([...prereqs]),
    Offer: f.Offer.value, Accept: f.Accept.value, Progress: f.Progress.value, Complete: f.Complete.value,
    XP: +f.XP.value, Gold: +f.Gold.value, Rewards: JSON.stringify(rewards), Steps: JSON.stringify(steps),
  });
  form.append(
    h("h2", {}, q.id ? `Quest ${q.id}` : "New quest"),
    q.id ? questLinks(q) : null,
    h("div", { class: "grid" },
      field("Title", f.Title), field("Act / Zone", h("div", {}, f.Act, " ", f.Zone)),
      field("Level / min", h("div", {}, f.Level, " min level ", f.MinLevel)),
      field("Giver", f.Giver), field("Turn in to", f.TurnIn), field("Prerequisites", preBox),
      field("Summary", f.Summary),
      field("Offer", f.Offer), field("Accept", f.Accept), field("In progress", f.Progress), field("Complete", f.Complete),
      field("XP / Gold", h("div", {}, f.XP, " XP  ", f.Gold, " gold"))),
    h("p", { class: "hint" }, "Text can use {SHIELD}, {INTERACT}, {MOUNTS}, {CHARACTER} for the player's keys."),
    q.id ? questConversation(q) : null,
    h("h3", {}, "Steps (done in order)"), stepBox,
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
    if (c) for (const [, next] of parseOptions(c.Options)) queue.push(next);
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
  const collect = () => ({ id: n.id, Name: f.Name.value, ImgPath: f.ImgPath.value, Faction: f.Faction.value, Conversation: f.Conversation.value, SpawnX: +f.SpawnX.value, SpawnY: +f.SpawnY.value });
  form.append(h("h2", {}, n.id ? `${n.Name} (${n.id})` : "New NPC"),
    h("div", { class: "grid" },
      field("Name", f.Name), field("Sprite", h("div", {}, img, " ", f.ImgPath)), field("Faction", f.Faction),
      field("Greeting node", f.Conversation), field("Position", h("div", {}, "X ", f.SpawnX, "  Y ", f.SpawnY, " ",
        link(`#map/${n.SpawnX},${n.SpawnY}`, "Show on map", "btnlink")))),
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => { const id = await save("npc", collect()); S.npc = { id }; renderTab(); } }, "Save NPC"),
      n.id ? h("button", { class: "danger", onclick: async () => { if (await del("npc", n.id)) { S.npc = null; renderTab(); } } }, "Delete NPC") : null));
  if (!n.id) return;

  form.append(npcQuestPanel(n));

  form.append(h("h3", {}, "Dialogue tree (free chat when no quest is waiting)"),
    h("p", { class: "hint" }, "Each node is a line and its answers. An answer points to another node, or to 1 to end. Quest offers and hand-ins are added to the menu automatically."));
  const nodes = n.Conversation ? reachable(n.Conversation) : [];
  if (nodes.length) form.append(h("div", { class: "jump" }, "Nodes: ", nodes.filter(c => !c.missing).map(c => [link("#dialog/" + c.Identifier, c.Identifier), " "])));
  for (const c of nodes) form.append(nodeEditor(c, c.Identifier === n.Conversation, n));
  const prefix = (n.Conversation || "npc-" + n.id).replace(/-\d+$/, "");
  form.append(h("div", { class: "bar" }, h("button", { onclick: () => {
    let i = 1; while (S.convBy[`${prefix}-${i}`]) i++;
    const id = `${prefix}-${i}`;
    form.append(nodeEditor({ id: 0, Identifier: id, Title: "", ImgPath: n.ImgPath, Options: "[['Goodbye.','1']]", ItemsGiven: "", ReputationChange: "", QuestStart: 0 }, false, n));
  } }, "+ New node"), !n.Conversation ? h("span", { class: "hint" }, "Create a node, then set it as the greeting node above.") : null));
}

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
  const owners = nodeOwners(c.Identifier);
  const ownerQuests = S.c.quests.filter(q => owners.some(o => q.Giver === o.id || q.TurnIn === o.id));
  return h("div", { class: "node" + (isRoot ? " root" : ""), id: "node-" + c.Identifier },
    h("div", {}, h("span", { class: "id" }, isRoot ? "greeting · " : ""), ident),
    h("div", { class: "hint" }, "Spoken by: ", owners.length ? owners.map(o => [link("#npc/" + o.id, o.Name), " "]) : "no NPC (unreachable)",
      ownerQuests.length ? [" · their quests: ", ownerQuests.map(q => [link("#quest/" + q.id, q.Title), " "])] : null),
    title, optBox, given,
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => {
        const row = { id: c.id, Identifier: ident.value.trim(), Title: title.value, ImgPath: c.ImgPath || n.ImgPath, Options: formatOptions(opts),
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

// ------------------------------------------------------------------ map
const M = { scale: 12, cx: 0, cy: 0, tool: "select", drag: null, pending: new Map(), imgs: {}, colours: {}, sel: null };

function imgFor(path) {
  if (!path) return null;
  let i = M.imgs[path];
  if (!i) {
    i = M.imgs[path] = new Image();
    i.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 1;
      const x = c.getContext("2d"); x.drawImage(i, 0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data; M.colours[path] = `rgb(${d[0]},${d[1]},${d[2]})`;
      drawMap();
    };
    if (ASSETS.mode === "url") i.crossOrigin = "anonymous";
    i.src = assetURL(path);
  }
  return i.complete && i.naturalWidth ? i : null;
}

function renderMap(m) {
  const cv = h("canvas", { id: "map" });
  const wrap = h("div", { class: "mapwrap" }, cv);
  const side = h("div", { class: "side" });
  m.append(wrap, side);
  M.cv = cv; M.side = side;
  if (S.focus) { M.cx = S.focus.x; M.cy = S.focus.y; M.scale = 24; S.focus = null; }
  new ResizeObserver(() => { cv.width = wrap.clientWidth; cv.height = wrap.clientHeight; drawMap(); }).observe(wrap);
  cv.addEventListener("wheel", e => { e.preventDefault(); M.scale = Math.max(2, Math.min(48, M.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); drawMap(); }, { passive: false });
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("mousedown", mapDown);
  window.onmousemove = mapMove; window.onmouseup = mapUp;
  drawSide();
}

const toTile = e => { const r = M.cv.getBoundingClientRect(); return { x: Math.floor((e.clientX - r.left - M.cv.width / 2) / M.scale + M.cx), y: Math.floor((e.clientY - r.top - M.cv.height / 2) / M.scale + M.cy) }; };
const tile = (x, y) => S.world.tiles.get(x + "," + y);
const str = i => S.world.strings[i] || "";
function npcAt(x, y) { return S.c.npcs.find(n => n.SpawnX === x && n.SpawnY === y); }

function mapDown(e) {
  const t = toTile(e);
  if (e.button === 2 || e.button === 1 || (M.tool === "select" && e.shiftKey)) { M.drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: M.cx, cy: M.cy }; return; }
  if (M.tool === "select") {
    const n = npcAt(t.x, t.y), tl = tile(t.x, t.y);
    M.sel = { x: t.x, y: t.y };
    if (n) M.drag = { npc: n, from: t };
    else if (tl && str(tl[6])) M.drag = { mob: str(tl[6]), from: t };
    else M.drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: M.cx, cy: M.cy };
    drawSide(); drawMap();
  } else if (M.tool === "spawn") placeSpawns(t);
  else if (M.tool === "erase") { patch(t.x, t.y, { Enemy: "" }); M.drag = { paint: true }; }
  else if (M.tool === "paint") { paintAt(t); M.drag = { paint: true }; }
}
function mapMove(e) {
  if (!M.drag || !M.cv) return;
  if (M.drag.pan) { M.cx = M.drag.cx - (e.clientX - M.drag.sx) / M.scale; M.cy = M.drag.cy - (e.clientY - M.drag.sy) / M.scale; drawMap(); return; }
  const t = toTile(e);
  if (M.drag.npc || M.drag.mob) { M.drag.to = t; drawMap(); }
  else if (M.drag.paint) { if (M.tool === "erase") patch(t.x, t.y, { Enemy: "" }); else paintAt(t); }
}
async function mapUp() {
  const d = M.drag; M.drag = null;
  if (!d) return;
  if (d.npc && d.to && (d.to.x !== d.from.x || d.to.y !== d.from.y)) {
    const n = d.npc; await save("npc", { id: n.id, Name: n.Name, ImgPath: n.ImgPath, Faction: n.Faction, Conversation: n.Conversation, SpawnX: d.to.x, SpawnY: d.to.y });
    M.sel = d.to; drawSide(); drawMap();
  } else if (d.mob && d.to && (d.to.x !== d.from.x || d.to.y !== d.from.y)) {
    patch(d.from.x, d.from.y, { Enemy: "" }); patch(d.to.x, d.to.y, { Enemy: d.mob }); M.sel = d.to; await flush();
  } else if (d.paint) await flush();
}

function patch(x, y, set) {
  const k = x + "," + y;
  const p = M.pending.get(k) || { X: x, Y: y, Set: {} };
  Object.assign(p.Set, set); M.pending.set(k, p);
  // local preview
  let t = tile(x, y);
  if (!t) { t = [x, y, idx("assets/world/grounds/grass.png"), 0, 0, 0, 0, 0]; S.world.tiles.set(k, t); }
  const col = { GroundTile: 2, ForegroundTile: 3, Name: 4, Collision: 5, Enemy: 6 };
  for (const [c, v] of Object.entries(set)) t[col[c]] = c === "Collision" ? (v ? 1 : 0) : idx(v);
  drawMap();
}
function idx(s) { let i = S.world.strings.indexOf(s); if (i < 0) { S.world.strings.push(s); i = S.world.strings.length - 1; } return i; }
async function flush() {
  if (!M.pending.size) return;
  const list = [...M.pending.values()]; M.pending.clear();
  status("Saving tiles…");
  try { await api("tiles", list); status(`Saved ${list.length} tile(s) in memory.`); }
  catch (e) { status(e.message, true); await loadWorld(); }
  drawSide(); drawMap();
}

function placeSpawns(t) {
  const name = M.spawnEnemy.value, count = Math.max(1, +M.spawnCount.value || 1);
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
function paintAt(t) {
  const set = {};
  if (M.pGround.value) set.GroundTile = M.pGround.value;
  if (M.pFore.checked) set.ForegroundTile = M.pForeVal.value;
  if (M.pColl.value !== "") set.Collision = M.pColl.value === "1";
  if (M.pName.checked) set.Name = M.pNameVal.value;
  if (Object.keys(set).length) patch(t.x, t.y, set);
}

function drawSide() {
  const s = M.side; if (!s) return;
  s.textContent = "";
  const tools = h("div", { class: "tools" });
  for (const [k, l] of [["select", "Select / drag"], ["spawn", "Place mobs"], ["erase", "Erase mobs"], ["paint", "Paint tiles"]])
    tools.append(h("button", { class: M.tool === k ? "on" : "", onclick: () => { M.tool = k; drawSide(); } }, l));
  s.append(h("h3", {}, "Tools"), tools,
    h("p", { class: "hint" }, "Wheel zooms. Right-drag (or drag empty ground) pans. In Select, drag an NPC or a mob to move it."));
  M.spawnEnemy = M.spawnEnemy || enemySelect("");
  M.spawnCount = M.spawnCount || num(3);
  if (M.tool === "spawn") s.append(h("h3", {}, "Place mobs"), h("div", { class: "grid" }, field("Enemy", M.spawnEnemy), field("Count", M.spawnCount)),
    h("p", { class: "hint" }, "Click to place. Mobs go on free walkable tiles, two tiles apart, around the click."));
  if (!M.pGround) {
    const grounds = [...new Set([...S.world.tiles.values()].map(t => str(t[2])))].filter(Boolean).sort();
    const fores = [...new Set([...S.world.tiles.values()].map(t => str(t[3])))].filter(Boolean).sort();
    M.pGround = h("select", {}, h("option", { value: "" }, "— keep —"), grounds.map(g => h("option", { value: g }, g.split("/").pop())));
    M.pFore = h("input", { type: "checkbox" }); M.pForeVal = h("select", {}, h("option", { value: "" }, "(none)"), fores.map(g => h("option", { value: g }, g.split("/").pop())));
    M.pColl = h("select", {}, h("option", { value: "" }, "— keep —"), h("option", { value: "1" }, "blocked"), h("option", { value: "0" }, "walkable"));
    M.pName = h("input", { type: "checkbox" }); M.pNameVal = txt("", "Area name");
  }
  if (M.tool === "paint") s.append(h("h3", {}, "Paint"), h("div", { class: "grid" },
    field("Ground", M.pGround), field("Object", h("div", {}, M.pFore, " set ", M.pForeVal)), field("Collision", M.pColl),
    field("Area", h("div", {}, M.pName, " set ", M.pNameVal))), h("p", { class: "hint" }, "Click or drag to paint. Saved when you let go."));
  s.append(h("h3", {}, "Overlays"), h("div", { class: "legend" }, h("span", { style: "background:#ffd34d" }), "NPC  ", h("span", { style: "background:#ff4d4d" }), "mob spawn  ", h("span", { style: "background:#5af" }), "quest reach point"));
  if (M.sel) {
    const t = tile(M.sel.x, M.sel.y), n = npcAt(M.sel.x, M.sel.y);
    s.append(h("h3", {}, `Tile ${M.sel.x}, ${M.sel.y}`));
    if (t) s.append(h("div", { class: "hint" }, `Area: ${str(t[4]) || "—"}`, h("br"), `Ground: ${str(t[2]).split("/").pop()}`, h("br"),
      `Object: ${str(t[3]).split("/").pop() || "—"}`, h("br"), t[5] ? "Blocked" : "Walkable"));
    if (t && str(t[6])) {
      const sel = enemySelect(str(t[6]));
      s.append(h("div", { class: "bar" }, "Mob: ", sel,
        h("button", { onclick: () => { patch(M.sel.x, M.sel.y, { Enemy: sel.value }); flush(); } }, "Set"),
        h("button", { class: "danger", onclick: () => { patch(M.sel.x, M.sel.y, { Enemy: "" }); flush(); } }, "Remove")));
    }
    if (n) s.append(h("div", { class: "bar" }, sprite(n.ImgPath), h("b", {}, n.Name), link("#npc/" + n.id, "Edit NPC & dialogue", "btnlink")),
      h("h3", {}, "Quests here"), npcQuestList(n, true));
  }
  const go = { x: num(Math.round(M.cx)), y: num(Math.round(M.cy)) };
  const npcJump = npcSelect(0, () => { const n = S.npcBy[npcJump.value]; if (n) { M.cx = n.SpawnX; M.cy = n.SpawnY; M.scale = 24; M.sel = { x: n.SpawnX, y: n.SpawnY }; drawSide(); drawMap(); } });
  s.append(h("h3", {}, "Go to"), h("div", { class: "bar" }, "X", go.x, "Y", go.y, h("button", { onclick: () => { M.cx = +go.x.value; M.cy = +go.y.value; drawMap(); } }, "Go")), npcJump);
}

function drawMap() {
  const cv = M.cv; if (!cv || !S.world) return;
  const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
  g.fillStyle = "#0b0d10"; g.fillRect(0, 0, cv.width, cv.height);
  const sc = M.scale, w = cv.width / sc / 2 + 1, hh = cv.height / sc / 2 + 1;
  const x0 = Math.floor(M.cx - w), x1 = Math.ceil(M.cx + w), y0 = Math.floor(M.cy - hh), y1 = Math.ceil(M.cy + hh);
  const px = x => (x - M.cx) * sc + cv.width / 2, py = y => (y - M.cy) * sc + cv.height / 2;
  const sprites = sc >= 10;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tile(x, y); if (!t) continue;
    const gp = str(t[2]), fp = str(t[3]);
    const gi = imgFor(gp);
    if (sprites && gi) g.drawImage(gi, px(x), py(y), sc + .5, sc + .5);
    else { g.fillStyle = M.colours[gp] || "#3a5"; g.fillRect(px(x), py(y), sc + .5, sc + .5); }
    if (fp) { const fi = imgFor(fp); if (sprites && fi) g.drawImage(fi, px(x), py(y), sc + .5, sc + .5); else if (M.colours[fp]) { g.fillStyle = M.colours[fp]; g.globalAlpha = .7; g.fillRect(px(x), py(y), sc + .5, sc + .5); g.globalAlpha = 1; } }
    if (t[5] && !sprites) { g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(px(x), py(y), sc, sc); }
  }
  // area names
  if (sc < 10) {
    g.font = "12px sans-serif"; g.fillStyle = "rgba(255,255,255,.7)"; const shown = new Set();
    for (let y = y0; y <= y1; y += 6) for (let x = x0; x <= x1; x += 6) { const t = tile(x, y); const n = t && str(t[4]); if (n && !shown.has(n)) { shown.add(n); g.fillText(n, px(x), py(y)); } }
  }
  // mob spawns
  const r = Math.max(2, sc / 3);
  g.font = `${Math.max(9, Math.min(13, sc / 2))}px sans-serif`;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tile(x, y); const e = t && str(t[6]); if (!e) continue;
    if (M.drag && M.drag.mob && M.drag.from.x === x && M.drag.from.y === y) continue;
    mobMarker(g, e, px(x), py(y), sc, r);
  }
  if (M.drag && M.drag.mob && M.drag.to) mobMarker(g, M.drag.mob, px(M.drag.to.x), py(M.drag.to.y), sc, r);
  // quest reach points
  g.strokeStyle = "#5af";
  for (const q of S.c.quests) for (const s of parseJSON(q.Steps, [])) if (s.Type === "reach") {
    g.beginPath(); g.arc(px(s.X) + sc / 2, py(s.Y) + sc / 2, (s.Radius || 3) * sc, 0, 7); g.stroke();
  }
  // NPCs
  for (const n of S.c.npcs) {
    let x = n.SpawnX, y = n.SpawnY;
    if (M.drag && M.drag.npc === n && M.drag.to) { x = M.drag.to.x; y = M.drag.to.y; }
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const i = sprites && imgFor(n.ImgPath);
    if (i) g.drawImage(i, px(x), py(y), sc, sc);
    g.strokeStyle = "#ffd34d"; g.lineWidth = 2; g.strokeRect(px(x), py(y), sc, sc); g.lineWidth = 1;
    if (!i) { g.fillStyle = "#ffd34d"; g.fillRect(px(x) + sc / 4, py(y) + sc / 4, sc / 2, sc / 2); }
    if (sc >= 6) { g.fillStyle = "#ffd34d"; g.fillText(n.Name, px(x), py(y) - 3); }
  }
  if (M.sel) { g.strokeStyle = "#fff"; g.strokeRect(px(M.sel.x) - 1, py(M.sel.y) - 1, sc + 2, sc + 2); }
}
function mobMarker(g, e, x, y, sc, r) {
  const en = S.c.enemies.find(v => v.Name === e);
  const i = sc >= 10 && en && imgFor(en.Image);
  if (i) g.drawImage(i, x, y, sc, sc);
  g.fillStyle = "#ff4d4d"; g.beginPath(); g.arc(x + sc / 2, y + sc / 2, i ? 3 : r, 0, 7); g.fill();
  if (sc >= 16) { g.fillStyle = "#fbb"; g.fillText(e, x, y + sc + 10); }
}

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
      field("Name", f.Name), field("Image", h("div", {}, img, " ", imgIn)), field("Type", f.Type),
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
//   #map  #map/X,Y  #quests  #quest/ID  #quest/ID/line/Offer  #quest/ID/step/N
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
const TABS = ["map", "quests", "npcs", "items", "loot", "export", "sprites"];
async function applyRoute() {
  if (!BQ.has() || !S.c) return;
  const [kind, a, b, c] = location.hash.slice(1).split("/").map(decodeURIComponent);
  let target = null;
  if (kind === "quest") { S.tab = "quests"; S.quest = { id: +a }; if (b === "line") target = "qline-" + c; if (b === "step") target = "qstep-" + c; }
  else if (kind === "npc") { S.tab = "npcs"; S.npc = { id: +a }; if (b === "quest") target = "npcq-" + c; }
  else if (kind === "dialog") {
    const owner = nodeOwners(a)[0];
    if (owner) { S.tab = "npcs"; S.npc = { id: owner.id }; } else { S.tab = "dialog"; S.orphan = a; }
    target = "node-" + a;
  }
  else if (kind === "item") { S.tab = "items"; S.item = { id: +a }; }
  else if (kind === "loot") { S.tab = "loot"; S.lootEnemy = { id: +a }; }
  else if (kind === "map") { S.tab = "map"; if (a) { const [x, y] = a.split(",").map(Number); S.focus = { x, y }; M.sel = { x, y }; } }
  else if (TABS.includes(kind)) S.tab = kind;
  S.routing = true;
  try { await renderTab(); } finally { S.routing = false; }
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
    if ((st.Type === "kill" || st.Type === "boss") && enemyBy[st.Target]) l = link("#loot/" + enemyBy[st.Target].id, `${st.Type} ${st.Target}`);
    else if (["collect", "craft", "equip"].includes(st.Type) && itemByName[st.Target]) l = link("#item/" + itemByName[st.Target].id, `${st.Type} ${st.Target}`);
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
function questConversation(q) {
  const who = id => (S.npcBy[id] ? S.npcBy[id].Name : "NPC");
  const lines = [[q.Giver, "Offer", q.Offer], [0, "Accept", q.Accept], [q.TurnIn, "Progress", q.Progress], [q.TurnIn, "Complete", q.Complete]];
  return h("div", { class: "panel" }, h("h3", {}, "Quest dialogue, in order"),
    lines.map(([id, key, text]) => h("div", { class: "bubble" },
      h("b", {}, id ? link("#npc/" + id, who(id)) : "On accepting", ` (${key === "Progress" ? "in progress" : key.toLowerCase()}): `),
      text || h("span", { class: "hint" }, "(empty)"), " ", link(`#quest/${q.id}/line/${key}`, "edit", "edit"))),
    parseJSON(q.Steps, []).map((st, i) => st.Type === "talk" ? h("div", { class: "bubble" },
      h("b", {}, link("#npc/" + st.NPC, who(st.NPC)), ` (step ${i + 1}): `), st.Line || h("span", { class: "hint" }, "(no line)"), " ",
      link(`#quest/${q.id}/step/${i}`, "edit", "edit")) : null));
}
function renderOrphan(m) {
  const c = S.convBy[S.orphan];
  const f = h("div", { class: "form" }, h("h2", {}, "Dialogue node " + S.orphan),
    h("p", { class: "hint" }, c ? "No NPC's greeting leads to this node, so players can't reach it." : "There is no node with this identifier."));
  if (c) f.append(nodeEditor(c, false, { ImgPath: c.ImgPath }));
  m.append(f);
}

function switchTab(t) { go("#" + t); }

async function renderTab() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  if (!S.routing && TABS.includes(S.tab) && !/^#(quest|npc|item|loot|dialog|map)\//.test(location.hash)) syncHash("#" + S.tab);
  const m = $("#main"); m.textContent = ""; window.onmousemove = window.onmouseup = null; M.cv = null;
  try {
    if (S.tab === "map") { if (!S.world) { status("Loading world…"); await loadWorld(); status(""); } renderMap(m); }
    else if (S.tab === "quests") renderQuests(m);
    else if (S.tab === "npcs") renderNPCs(m);
    else if (S.tab === "items") renderItems(m);
    else if (S.tab === "loot") renderLoot(m);
    else if (S.tab === "sprites") renderSprites(m);
    else if (S.tab === "dialog") renderOrphan(m);
    else await renderExport(m);
  } catch (e) { status(e.message, true); }
}

document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
$("#open").addEventListener("change", e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; });
$("#btn-save").addEventListener("click", saveDb);
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
window.addEventListener("beforeunload", e => { if (BQ.st.dirty) { e.preventDefault(); e.returnValue = ""; } });
syncFile();
BQ.init().catch(e => status("Could not load sql.js: " + e.message, true));
