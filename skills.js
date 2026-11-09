"use strict";
// Skills tab: the skill trees (skill_node), the points curve (skill_points),
// the respec prices (skill_config) and who can retrain you (skill_trainer).
// The API (skills.go) reads them and does all the work: this tab only edits
// rows. Tables are created on the first save; Export SQL carries the same
// statements. The rules in skillIssues() are the ones the server and client
// rely on, so a tree that passes here loads cleanly.

const SKILL_TREES = ["Warrior Order", "Mage Order", "Stoic Order", "None"];
const SKILL_ICONS = ["axe", "banner", "blink", "book", "boot", "counter", "crystal", "edge", "eye", "fist", "flame", "heart", "horn", "hush", "lance", "lung", "plate", "quake", "shield", "siphon", "storm", "sweep", "veil", "wall"];
const SKILL_MODS = {
  STR: "Strength", INT: "Intelligence", STA: "Stamina (10 health each)", DEF: "Defence", HP: "Max health",
  MOVE: "Move speed, percent", DMG: "Damage dealt, percent", CRIT: "Critical chance, percent",
  STAREG: "Stamina regeneration, percent", MANAREG: "Mana regeneration", MANACOST: "Mana cost, percent less",
  REGEN: "Health regeneration, tenths of a percent of max health a second", CDR: "Cooldown reduction, percent",
};
const SKILL_TYPES = {
  cone: "an arc in front of you", nova: "a burst around you", dash: "a quick move forward that hits what it passes",
  beam: "a line that pierces", buff: "an effect on yourself",
};
// every ability field: [key, label, step, which types show it (empty = all)]
const SKILL_AB_FIELDS = [
  ["cd", "Cooldown (s)", "0.5", []], ["stamina", "Stamina cost", "1", []], ["mana", "Mana cost", "1", []], ["hp_pct", "Health cost (% max)", "1", []],
  ["dmg", "Damage (x weapon power)", "0.1", ["cone", "nova", "dash", "beam"]], ["range", "Reach (tiles)", "0.1", ["cone", "beam"]], ["arc", "Arc half-angle (deg)", "5", ["cone"]],
  ["radius", "Radius (tiles)", "0.1", ["nova", "beam"]], ["dist", "Distance (tiles)", "0.5", ["dash"]], ["width", "Half-width (tiles)", "0.1", ["dash", "beam"]],
  ["pierce", "Enemies passed", "1", ["beam"]], ["knock", "Knockback (tiles)", "0.1", ["cone", "nova", "dash", "beam"]], ["stun", "Daze (s)", "0.1", ["cone", "nova", "dash", "beam"]],
  ["heal", "Heal (% max)", "1", []], ["drain", "Damage returned as health (0-1)", "0.05", ["cone", "nova", "dash", "beam"]], ["give_mana", "Mana given", "1", []],
  ["iframes", "Untouchable for (s)", "0.1", []], ["rank_dmg", "Damage added per rank (0 = 0.2)", "0.05", []], ["rank_cd", "Cooldown cut per rank (0 = 0.08)", "0.01", []],
];
const SKILL_NEW = { id: 0, Tree: "Warrior Order", Branch: "", Name: "New skill", Desc: "", Icon: "fist", Tier: 1, Col: 1, Kind: "passive", MaxRank: 5, Cost: 1, ReqLevel: 2, ReqBranch: 0, Requires: "", Mods: '{"DMG":1}', Ability: "{}" };

// ------------------------------------------------------------------ rules

function skillParse(s, def) { try { const v = JSON.parse(s || ""); return v && typeof v === "object" ? v : def; } catch { return def; } }
function skillRequires(n) { return String(n.Requires || "").split(",").map(x => +x.trim()).filter(x => x > 0); }

// What would break or surprise in the game. Returns [{ id, text }].
function skillIssues(nodes, effectIds) {
  const out = [], byId = new Map(nodes.map(n => [+n.id, n]));
  const add = (n, text) => out.push({ id: n ? +n.id : 0, text: (n ? `${n.Name} (${n.id}): ` : "") + text });
  const seen = new Map();
  for (const n of nodes) {
    if (!n.Name) add(n, "needs a name");
    if (!SKILL_TREES.includes(n.Tree) && !n.Tree) add(n, "has no tree");
    if (n.Kind !== "passive" && n.Kind !== "active") add(n, "Kind must be passive or active");
    if (!(+n.MaxRank >= 1)) add(n, "MaxRank must be at least 1");
    if (!(+n.Cost >= 1)) add(n, "Cost must be at least 1 point");
    if (!(+n.Tier >= 1 && +n.Tier <= 6)) add(n, "Tier must be 1 to 6");
    if (!(+n.Col >= 0 && +n.Col <= 2)) add(n, "Col must be 0, 1 or 2");
    const pos = `${n.Tree}/${n.Branch}/${n.Tier}/${n.Col}`;
    if (seen.has(pos)) add(n, `sits on the same spot as ${seen.get(pos)}`); else seen.set(pos, n.Name);
    for (const r of skillRequires(n)) {
      const p = byId.get(r);
      if (!p) add(n, `requires node ${r}, which does not exist`);
      else if (p.Tree !== n.Tree) add(n, `requires ${p.Name}, which is in another tree`);
      else if (+p.Tier >= +n.Tier) add(n, `requires ${p.Name}, which is not on an earlier tier`);
      else if (p.Branch !== n.Branch) add(n, `requires ${p.Name} from another branch`);
    }
    if (+n.Tier > 1 && skillRequires(n).length === 0) add(n, "tier 2 and up needs something it requires, or it can be taken first");
    const mods = skillParse(n.Mods, null), ab = skillParse(n.Ability, null);
    if (mods === null) add(n, "Mods is not valid JSON");
    else for (const k of Object.keys(mods)) { if (!(k in SKILL_MODS)) add(n, `unknown stat ${k}`); else if (typeof mods[k] !== "number") add(n, `${k} must be a number`); }
    if (n.Kind === "active") {
      if (!ab || !SKILL_TYPES[ab.type]) add(n, "an active needs an ability type (cone, nova, dash, beam or buff)");
      else {
        if (!(ab.cd > 0)) add(n, "an active needs a cooldown above 0");
        if (["cone", "nova", "beam"].includes(ab.type) && !(ab.dmg > 0) && !(ab.stun > 0)) add(n, "this attack deals no damage");
        if (ab.type === "dash" && !(ab.dist > 0)) add(n, "a dash needs a distance");
        if (ab.type === "nova" && !(ab.radius > 0)) add(n, "a nova needs a radius");
        if (ab.effect && effectIds && !effectIds.has(+ab.effect)) add(n, `effect ${ab.effect} is not in the Effects tab`);
      }
      if (mods && Object.keys(mods).length) add(n, "an active uses Ability, not Mods");
    } else if (ab && Object.keys(ab).length) add(n, "a passive uses Mods, not Ability");
    if (n.Kind === "passive" && mods && !Object.keys(mods).length) add(n, "a passive with no Mods does nothing");
  }
  // an order's tree: size, branches, actives
  for (const tree of [...new Set(nodes.map(n => n.Tree))]) {
    const t = nodes.filter(n => n.Tree === tree);
    if (tree !== "None") {
      if (t.length < 12 || t.length > 18) out.push({ id: 0, text: `${tree}: ${t.length} nodes (12 to 18 is the plan)` });
      if (t.filter(n => n.Kind === "active").length < 4) out.push({ id: 0, text: `${tree}: fewer than 4 abilities` });
      if (new Set(t.map(n => n.Branch)).size !== 3) out.push({ id: 0, text: `${tree}: should have 3 branches` });
    }
  }
  return out;
}

// Points to buy everything in a tree, and how much of it a character can reach.
function skillTreeCost(nodes, tree) {
  return nodes.filter(n => n.Tree === tree).reduce((a, n) => a + (+n.Cost || 0) * (+n.MaxRank || 0), 0);
}
function skillPointsAt(level, curve) {
  let total = 0;
  const rows = [...curve].sort((a, b) => a.FromLevel - b.FromLevel);
  for (let l = 2; l <= level; l++) {
    let p = 0;
    for (const r of rows) if (l >= r.FromLevel) p = r.Points;
    total += p;
  }
  return total;
}

// ----------------------------------------------------------------- the tab


async function renderSkills(m) {
  const data = await api("loreTables");
  const nodes = data.skill_node.rows, curve = data.skill_points.rows, cfg = data.skill_config.rows, trainers = data.skill_trainer.rows;
  const effects = S.c.effects || [];
  const effectIds = new Set(effects.map(e => +e.id));
  if (!S.skillTree) S.skillTree = SKILL_TREES[0];
  const treeNodes = nodes.filter(n => n.Tree === S.skillTree);
  const sel = S.skillSel === 0 ? { ...SKILL_NEW, Tree: S.skillTree, ...(S.skillDraft || {}) } : nodes.find(n => +n.id === S.skillSel) || (S.skillSel = null);
  const main = h("div", { class: "form", style: "max-width:1200px;margin:0 auto;padding:12px 16px" },
    h("h2", {}, "Skills: trees, abilities and points"),
    h("p", { class: "hint" }, "Each Order has its own tree: three branches, tiers top to bottom. A node is a passive (Mods: stat bonuses per rank) or an active ability (Ability: what it does in real time). Points come from the curve below; a node needs its tier's level, points spent in its branch, and one of the nodes it requires. Edit a node, then Save skill. The API (skills.go) reads these tables; a db without them has no skills."));
  const tabs = h("div", { class: "bar" }, ...SKILL_TREES.map(t => h("button", { class: t === S.skillTree ? "primary" : "", onclick: () => { S.skillTree = t; S.skillSel = null; renderTab(); } }, `${t} (${nodes.filter(n => n.Tree === t).length})`)));
  main.append(tabs);

  // the grid
  const branches = [];
  for (const n of treeNodes) if (!branches.includes(n.Branch)) branches.push(n.Branch);
  const rows = Math.max(4, ...treeNodes.map(n => +n.Tier || 1));
  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(" + Math.max(1, branches.length) + ",1fr);gap:10px;margin:8px 0" });
  for (const b of branches) {
    const col = h("div", { style: "border:1px solid #555;padding:6px;background:#1c1c1c" }, h("div", { style: "text-align:center;opacity:.8;margin-bottom:6px" }, `${b}  ·  ${treeNodes.filter(n => n.Branch === b).reduce((a, n) => a + n.Cost * n.MaxRank, 0)} pts`));
    const cells = h("div", { style: `display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(${rows},auto);gap:4px` });
    for (let tier = 1; tier <= rows; tier++) for (let c = 0; c <= 2; c++) {
      const n = treeNodes.find(x => x.Branch === b && +x.Tier === tier && +x.Col === c);
      cells.append(n ? h("button", { "data-node": n.id, class: +n.id === S.skillSel ? "primary" : "", style: `min-height:54px;text-align:center;${n.Kind === "active" ? "border-width:2px;" : ""}`,
        onclick: () => { S.skillSel = +n.id; S.skillDraft = null; renderTab(); } },
        h("div", {}, n.Name), h("div", { class: "hint" }, `${n.Kind === "active" ? "ability" : "passive"} · ${n.MaxRank}×${n.Cost}p · L${n.ReqLevel}`)) : h("div", {}));
    }
    col.append(cells);
    grid.append(col);
  }
  main.append(grid, h("div", { class: "bar" }, h("button", { "data-act": "new", onclick: () => { S.skillSel = 0; S.skillDraft = { Branch: branches[0] || "" }; renderTab(); } }, "+ New skill in " + S.skillTree)));
  if (sel) main.append(skillForm(sel, treeNodes, nodes, effects));

  // problems
  const issues = skillIssues(nodes, effectIds);
  main.append(h("h3", {}, "Checks ", h("span", { class: "hint" }, issues.length ? `${issues.length} to look at` : "all clear")),
    issues.length ? h("ul", { "data-issues": "1" }, ...issues.map(i => h("li", { class: "hint", style: "color:#e88" }, i.text))) : h("p", { class: "hint" }, "No problems found."));

  // points
  const cost = SKILL_TREES.map(t => ({ t, c: skillTreeCost(nodes, t) }));
  const pts = [10, 20, 30, 40].map(l => `level ${l}: ${skillPointsAt(l, curve)}`).join("  ·  ");
  main.append(h("h3", {}, "Points"),
    h("p", { class: "hint" }, "From level F on, a level gives P points. Total points to spend: " + pts + ". A whole tree costs: " + cost.map(x => `${x.t} ${x.c}`).join(", ") + ". Keep an Order's tree a little above what level 40 can buy, so players choose."));
  main.append(skillSimpleTable("skill_points", ["FromLevel", "Points"], curve, "FromLevel"));
  main.append(h("h3", {}, "Retraining"), h("p", { class: "hint" }, "Keys: respec_base (gold), respec_per_level (gold a level), respec_free_until (free up to and including this level)."));
  main.append(skillSimpleTable("skill_config", ["Key", "Value"], cfg, "Key"));
  main.append(h("h3", {}, "Trainers"), h("p", { class: "hint" }, "NPC ids you can retrain next to (standing within talking range)."));
  main.append(skillSimpleTable("skill_trainer", ["NPC"], trainers, "NPC", r => npcName(r.NPC)));
  m.append(main);
}

function skillSimpleTable(table, cols, rows, key, label) {
  const tbl = h("table", { class: "grid-table", style: "border-collapse:collapse" });
  tbl.append(h("tr", {}, ...cols.map(c => h("th", { style: "text-align:left;padding:2px 4px;font-weight:normal;opacity:.7" }, c)), h("th", {}, ""), h("th", {}, "")));
  const add = row => {
    const inputs = {};
    const tr = h("tr", {}, ...cols.map(c => { const el = h("input", { type: "text", value: row[c] ?? "", style: "width:" + (c === "Key" ? 170 : 80) + "px", "data-key": c }); inputs[c] = el; return h("td", { style: "padding:1px 3px" }, el); }),
      h("td", { style: "padding:1px 3px" }, h("button", { class: "primary", onclick: async () => {
        const out = {}; for (const c of cols) out[c] = inputs[c].value;
        try { await api("loreSave", { table, row: out }); status(`Saved ${table}. Use Save .db or Export SQL to keep it.`); renderTab(); } catch (e) { status(e.message, true); }
      } }, "Save"), " ", h("button", { class: "danger", onclick: async () => {
        if (row[key] === "" || row[key] == null) { tr.remove(); return; }
        try { await api("loreDelete", { table, id: row[key] }); renderTab(); } catch (e) { status(e.message, true); }
      } }, "Delete")), h("td", { class: "hint", style: "padding:1px 6px" }, label ? label(row) : ""));
    tbl.append(tr);
  };
  for (const r of rows) add(r);
  return h("div", {}, tbl, h("div", { class: "bar" }, h("button", { onclick: () => add(Object.fromEntries(cols.map(c => [c, ""]))) }, "+ Add row")));
}

function skillForm(n, treeNodes, allNodes, effects) {
  const f = {
    Name: txt(n.Name), Branch: h("input", { type: "text", list: "skillBranches", value: n.Branch ?? "" }), Desc: area(n.Desc),
    Tier: num(n.Tier), Col: num(n.Col), MaxRank: num(n.MaxRank), Cost: num(n.Cost), ReqLevel: num(n.ReqLevel), ReqBranch: num(n.ReqBranch),
  };
  const tree = h("select", {}, SKILL_TREES.map(t => h("option", { value: t }, t))); tree.value = n.Tree;
  const kind = h("select", {}, ["passive", "active"].map(k => h("option", { value: k }, k))); kind.value = n.Kind;
  const icon = h("select", {}, SKILL_ICONS.map(k => h("option", { value: k }, k))); icon.value = SKILL_ICONS.includes(n.Icon) ? n.Icon : SKILL_ICONS[0];
  // requires: any one of these, from the same tree on an earlier tier
  const reqSet = new Set(skillRequires(n));
  const reqBox = h("div", {}, ...allNodes.filter(x => x.Tree === n.Tree && +x.id !== +n.id).map(x =>
    h("label", { style: "display:inline-block;margin-right:12px" }, h("input", { type: "checkbox", "data-req": x.id, checked: reqSet.has(+x.id) ? "checked" : null }), ` ${x.Name} (T${x.Tier})`)));
  // mods
  const mods = skillParse(n.Mods, {});
  const modBox = h("div", { class: "rewards" });
  const drawMods = () => modBox.replaceChildren(...Object.keys(mods).map(k => {
    const key = h("select", { onchange: () => { const v = mods[k]; delete mods[k]; mods[key.value] = v; drawMods(); } }, Object.keys(SKILL_MODS).map(x => h("option", { value: x }, x))); key.value = k;
    const val = h("input", { type: "number", class: "num", step: "0.25", value: mods[k], "data-mod": k }); val.addEventListener("input", () => { mods[k] = +val.value; });
    return h("div", { class: "rw" }, key, val, h("span", { class: "hint" }, SKILL_MODS[k] + " per rank"), h("button", { class: "danger", onclick: () => { delete mods[k]; drawMods(); } }, "×"));
  }));
  drawMods();
  // ability
  const ab = skillParse(n.Ability, {});
  const abBox = h("div", {});
  const type = h("select", { onchange: () => { ab.type = type.value; drawAb(); } }, Object.keys(SKILL_TYPES).map(k => h("option", { value: k }, `${k}: ${SKILL_TYPES[k]}`)));
  type.value = ab.type || "cone";
  const effect = h("select", { onchange: () => { if (+effect.value) ab.effect = +effect.value; else delete ab.effect; } }, h("option", { value: 0 }, "none"), ...effects.map(e => h("option", { value: e.id }, `${e.Name} (${e.id})`)));
  effect.value = ab.effect || 0;
  const cleanse = h("input", { type: "checkbox", checked: ab.cleanse ? "checked" : null, onchange: () => { if (cleanse.checked) ab.cleanse = true; else delete ab.cleanse; } });
  const drawAb = () => {
    const showing = SKILL_AB_FIELDS.filter(([, , , types]) => !types.length || types.includes(ab.type || type.value));
    abBox.replaceChildren(h("div", { class: "rw" }, "Type ", type),
      ...showing.map(([k, lbl, step]) => { const el = h("input", { type: "number", class: "num", step, value: ab[k] ?? "", "data-ab": k }); el.addEventListener("input", () => { if (el.value === "") delete ab[k]; else ab[k] = +el.value; }); return h("div", { class: "rw" }, h("span", { style: "display:inline-block;width:260px" }, lbl), el); }),
      h("div", { class: "rw" }, h("span", { style: "display:inline-block;width:260px" }, "Effect put on you"), effect, h("span", { class: "hint" }, " from the Effects tab (buffs: Braced, Battle Cry ...)")),
      h("div", { class: "rw" }, h("span", { style: "display:inline-block;width:260px" }, "Removes harmful effects"), cleanse));
  };
  if (n.Kind === "active") ab.type = ab.type || "cone";
  drawAb();
  const modWrap = h("div", {}, modBox, h("button", { onclick: () => { const k = Object.keys(SKILL_MODS).find(x => !(x in mods)); if (k) { mods[k] = 1; drawMods(); } } }, "+ Stat"));
  const showKind = () => { modWrap.style.display = kind.value === "passive" ? "" : "none"; abBox.style.display = kind.value === "active" ? "" : "none"; if (kind.value === "active" && !ab.type) { ab.type = type.value; drawAb(); } };
  kind.addEventListener("change", showKind);
  showKind();
  const collect = () => {
    const out = { id: +n.id || 0, Tree: tree.value, Branch: f.Branch.value.trim(), Name: f.Name.value.trim(), Desc: f.Desc.value, Icon: icon.value, Tier: +f.Tier.value, Col: +f.Col.value,
      Kind: kind.value, MaxRank: +f.MaxRank.value, Cost: +f.Cost.value, ReqLevel: +f.ReqLevel.value, ReqBranch: +f.ReqBranch.value,
      Requires: [...reqBox.querySelectorAll("input[data-req]")].filter(i => i.checked).map(i => i.dataset.req).join(","),
      Mods: kind.value === "passive" ? JSON.stringify(mods) : "{}", Ability: kind.value === "active" ? JSON.stringify(ab) : "{}" };
    if (!out.id) {
      const base = { "Warrior Order": 100, "Mage Order": 200, "Stoic Order": 300, None: 400 }[out.Tree] || 500;
      const used = allNodes.filter(x => +x.id > base && +x.id < base + 100).map(x => +x.id);
      out.id = used.length ? Math.max(...used) + 1 : base + 1;
    }
    return out;
  };
  const dups = allNodes.filter(x => x.Tree === n.Tree).map(x => x.Branch).filter((b, i, a) => b && a.indexOf(b) === i);
  return h("div", { class: "form", style: "border:1px solid #555;padding:10px;margin:8px 0" },
    h("datalist", { id: "skillBranches" }, ...dups.map(b => h("option", { value: b }))),
    h("h3", {}, n.id ? `${n.Name} (skill ${n.id})` : "New skill"),
    h("div", { class: "grid" },
      ...field("Name", f.Name), ...field("Description", h("div", {}, f.Desc, h("span", { class: "hint" }, "plain words: the tooltip shows this, then the numbers"))),
      ...field("Tree", tree), ...field("Branch", f.Branch), ...field("Kind", kind), ...field("Icon", icon),
      ...field("Tier", h("div", {}, f.Tier, h("span", { class: "hint" }, " row, 1 at the top"))), ...field("Column", h("div", {}, f.Col, h("span", { class: "hint" }, " 0 left, 1 middle, 2 right"))),
      ...field("Max rank", f.MaxRank), ...field("Cost (points a rank)", f.Cost),
      ...field("Needs level", f.ReqLevel), ...field("Points in branch", h("div", {}, f.ReqBranch, h("span", { class: "hint" }, " spent in this branch before it opens"))),
      ...field("Requires one of", reqBox),
      h("label", {}, "Stats a rank gives"), modWrap,
      h("label", {}, "Ability"), abBox),
    h("div", { class: "bar" },
      h("button", { class: "primary", "data-act": "save", onclick: async () => {
        const row = collect();
        const merged = allNodes.filter(x => +x.id !== row.id).concat([row]);
        const problems = skillIssues(merged, new Set((S.c.effects || []).map(e => +e.id))).filter(i => i.id === row.id);
        if (problems.length && !confirm("This skill has problems:\n\n" + problems.map(p => p.text).join("\n") + "\n\nSave anyway?")) return;
        try { await api("loreSave", { table: "skill_node", row }); S.skillSel = row.id; S.skillDraft = null; status("Saved skill. Use Save .db or Export SQL to keep it."); renderTab(); } catch (e) { status(e.message, true); }
      } }, n.id ? "Save skill" : "Create skill"),
      n.id ? h("button", { onclick: () => { const c = collect(); c.id = 0; c.Name += " (copy)"; c.Col = c.Col; S.skillSel = 0; S.skillDraft = c; renderTab(); } }, "Duplicate") : null,
      n.id ? h("button", { class: "danger", onclick: async () => {
        const users = allNodes.filter(x => skillRequires(x).includes(+n.id)).map(x => x.Name);
        if (!confirm(`Delete ${n.Name}?` + (users.length ? `\n\n${users.join(", ")} require it and will need another prerequisite.` : "") + "\nCharacters who bought it keep their points: they simply stop counting.")) return;
        try { await api("loreDelete", { table: "skill_node", id: n.id }); S.skillSel = null; renderTab(); } catch (e) { status(e.message, true); }
      } }, "Delete") : null));
}
