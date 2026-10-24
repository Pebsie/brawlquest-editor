"use strict";
// Checks run before Commit to GitHub and Save .db. They follow what the API's
// loaders read at startup (new-ui: items.go initItems, enemies.go initEnemies,
// effects.go, npc.go initNPC, questline.go loadQuestDefs, crafting.go,
// forging.go, world.go). Each problem is
// { level: "error" | "warning", table, where, msg, route }.
// Errors are what crashes the API or silently drops content when it loads;
// warnings are content that loads but is probably wrong.
const BQCheck = (() => {
  // Go's encoding/json rules for the structs the API decodes into: an int
  // field refuses 1.5 or "3", keys match case-insensitively, unknown keys and
  // null are ignored.
  const PAIR = { list: "pair" };
  const T = {
    step: { Type: "string", Target: "string", Targets: "names", NPC: "int", Count: "int", X: "int", Y: "int", Radius: "float", Consume: "bool", Text: "string", Line: "string", Hint: "string" },
    reward: { ItemID: "int", Amount: "int" },
    invItem: { ID: "int", Amount: "int", ItemID: "int", Enchantment: "string", PlayerID: "int" },
    action: {
      every: "int", do: "string", target: "string", radius: "float", damage: "int", duration: "int", failRadius: "float",
      maxRadius: "float", windup: "int", once: "bool", tile: "bool",
      count: "int", formation: "string", spacing: "float", offsets: PAIR, anchor: "string", angle: "float", aim: "bool",
      delay: "int", stagger: "int", move: "string", speed: "float", spin: "float", path: PAIR, loop: "bool",
      cast: "float", range: "float", effect: "int", visual: "string", spread: "float",
      castTime: "float", interruptible: "bool", name: "string", first: "int", enemy: "int", max: "int", sprite: "raw", hitSprite: "raw",
    },
    mod: { type: "string", mult: "float", damage: "int", every: "float" },
  };
  const KINDS = ["zone", "soak", "projectile", "spawn", "suicide", "effect"];
  const STEP_TYPES = ["kill", "boss", "collect", "talk", "reach", "use", "craft", "equip", "level"];

  function goType(v, t, path, out) {
    if (v === null || t === "raw") return;
    const bad = want => out.push(`${path} is ${JSON.stringify(v).slice(0, 40)}, the API needs ${want}`);
    if (t === "int") { if (typeof v !== "number" || !Number.isInteger(v)) bad("a whole number"); }
    else if (t === "float") { if (typeof v !== "number") bad("a number"); }
    else if (t === "string") { if (typeof v !== "string") bad("text"); }
    else if (t === "bool") { if (typeof v !== "boolean") bad("true or false"); }
    // questline.go nameList: a list of names (one name alone also loads)
    else if (t === "names") { if (typeof v !== "string" && !(Array.isArray(v) && v.every(x => typeof x === "string" || x === null))) bad("a list of names [\"...\"]"); }
    else if (t === PAIR) {
      if (!Array.isArray(v)) return bad("a list of [x, y]");
      v.forEach((p, i) => { if (!Array.isArray(p) || p.some(n => typeof n !== "number")) out.push(`${path}[${i}] must be [x, y] numbers`); });
    } else if (typeof t === "object") goStruct(v, t, path, out);
  }
  function goStruct(v, schema, path, out) {
    if (v === null) return;
    if (typeof v !== "object" || Array.isArray(v)) { out.push(`${path} must be an object {...}`); return; }
    const keys = Object.fromEntries(Object.keys(schema).map(k => [k.toLowerCase(), k]));
    for (const [k, val] of Object.entries(v)) {
      const f = keys[k.toLowerCase()];
      if (f) goType(val, schema[f], path ? `${path}.${k}` : k, out);
    }
  }
  // Parse raw as a JSON list of schema structs (or of ints with schema "int").
  function goList(raw, schema, label) {
    const out = [];
    let v;
    try { v = JSON.parse(raw); } catch (e) { return { errs: [`${label} is not valid JSON (${e.message})`], v: null }; }
    if (v === null) return { errs: [], v: [] };
    if (!Array.isArray(v)) return { errs: [`${label} must be a JSON list [...]`], v: null };
    v.forEach((x, i) => schema === "int" ? goType(x, "int", `${label}[${i}]`, out) : goStruct(x, schema, `${label}[${i}]`, out));
    return { errs: out, v };
  }

  function run(q) {
    const P = [];
    const add = (level, table, where, msg, route) => P.push({ level, table, where, msg, route: route || "" });
    const tables = new Set(q("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name));
    const colsOf = t => q(`PRAGMA table_info("${t}")`).map(r => r.name);
    const ident = s => `"${String(s).replace(/"/g, '""')}"`;
    const sample = (rows, key = "id") => rows.slice(0, 5).map(r => r[key]).join(", ") + (rows.length > 5 ? ` and ${rows.length - 5} more` : "");

    // 1. SQLite itself.
    let ic;
    try { ic = q("PRAGMA integrity_check").map(r => Object.values(r)[0]); } catch (e) { ic = [e.message]; }
    if (!(ic.length === 1 && ic[0] === "ok")) add("error", "", "SQLite", "integrity_check failed: " + ic.slice(0, 5).join("; "));

    // 2. Tables and columns the loaders read. need = columns read by name;
    // star = SELECT * scanned into exactly that many fields; types per column
    // (s = text, i = whole number, b = bool, n = number) where NULL or a wrong
    // type makes Go's Scan fail and the rest of that row load blank.
    const L = {
      items: { star: 10, why: "initItems (SELECT * FROM items) exits the API without it", types: { id: "i", Name: "s", Type: "s", Val: "s", ImgPath: "s", Desc: "s", Worth: "i", Attributes: "s", Subtype: "s", Cooldown: "i" } },
      enemies: { why: "initEnemies panics (nil rows) without it", types: { id: "i", Name: "s", ATK: "i", Image: "s", HP: "i", Range: "i", CanMove: "b", XP: "i", Width: "i", Height: "i", Attributes: "s" }, opt: { AttackSpeed: "i", KnockbackResist: "n", HitEffect: "s" } },
      enemySpells: { why: "initEnemies panics (nil rows) without it", types: { EnemyID: "i", Name: "s", Value: "s", Frequency: "i" } },
      loot: { why: "initEnemies panics (nil rows) without it", types: { EnemyID: "i", AmountVariance: "i", Chance: "i", ItemID: "i", Amount: "i" } },
      npc: { why: "initNPC loads no NPCs without it", types: { id: "i", Name: "s", ImgPath: "s", SpawnX: "i", SpawnY: "i" }, nullable: ["Faction", "Conversation"] },
      conversation: { why: "initNPC loads no dialogue without it", types: { id: "i", Identifier: "s", Title: "s" }, nullable: ["ImgPath", "Options", "ItemsGiven"] },
      quest_def: { soft: true, why: "the API runs with no quests (apply content/migrations/2026-10-13-questline.sql)", whole: true, types: { id: "i", Act: "i", Zone: "s", Title: "s", Summary: "s", Level: "i", MinLevel: "i", Giver: "i", TurnIn: "i", Prereqs: "s", Offer: "s", Accept: "s", Progress: "s", Complete: "s", XP: "i", Gold: "i", Rewards: "s", Steps: "s" }, opt: { Sequential: "i" } },
      craft: { star: 4, why: "initCraftItems panics (nil rows) without it", types: { id: "i", ItemID: "i", Items: "s", Chance: "i" } },
      forge: { star: 3, why: "initForging panics (nil rows) without it", types: { id: "i", EnterID: "i", ResultID: "i" } },
      world: { star: 9, why: "initWorld panics (nil rows) without it", types: { id: "i", GroundTile: "s", ForegroundTile: "s", Name: "s", X: "i", Y: "i", Music: "s", Collision: "b", Enemy: "s" } },
      effects: { optional: true, types: { id: "i", Name: "s", Description: "s", Icon: "s", Visual: "s", Duration: "n", Stacking: "s", MaxStacks: "i", Modifiers: "s" } },
      boss_patterns: { optional: true, types: { id: "i", EnemyID: "i", Pattern: "s" } },
      plot: { optional: true, types: { id: "i", Name: "s", X: "i", Y: "i", W: "i", H: "i", Rent: "i", MinLevel: "i" } },
    };
    const ok = {};
    for (const [t, d] of Object.entries(L)) {
      if (!tables.has(t)) { if (!d.optional) add(d.soft ? "warning" : "error", t, t, `table ${t} is missing: ${d.why}`); continue; }
      const have = colsOf(t);
      if (d.star && have.length !== d.star) { add("error", t, t, `${t} has ${have.length} columns; the API reads SELECT * into exactly ${d.star} (${Object.keys(d.types).join(", ")}). Every row would load wrong.`); continue; }
      if (d.star) Object.keys(d.types).forEach((c, i) => { if (have[i] !== c) add("warning", t, t, `${t} column ${i + 1} is ${have[i]}, the API reads it as ${c} (SELECT * goes by position)`); });
      const missing = [...Object.keys(d.types), ...(d.nullable || [])].filter(c => !have.includes(c));
      if (missing.length) { add("error", t, t, `${t} has no column ${missing.join(", ")}: ${d.why || "the API can't read it"}`); continue; }
      ok[t] = true;
      const types = { ...d.types };
      for (const [c, ty] of Object.entries(d.opt || {})) if (have.includes(c)) types[c] = ty;
      const pk = have.includes("id") ? "id" : "rowid";
      for (const [c, ty] of Object.entries(types)) {
        const col = ident(c);
        const cond = { s: `${col} IS NULL`, i: `${col} IS NULL OR typeof(${col}) = 'blob' OR (typeof(${col}) = 'real' AND ${col} <> CAST(${col} AS INTEGER)) OR (typeof(${col}) = 'text' AND (trim(${col}) = '' OR trim(${col}) GLOB '*[^0-9-]*'))`,
          n: `${col} IS NULL OR typeof(${col}) = 'blob' OR (typeof(${col}) = 'text' AND (trim(${col}) = '' OR trim(${col}) GLOB '*[^0-9.eE+-]*'))`,
          b: `${col} IS NULL OR (typeof(${col}) IN ('integer', 'real') AND ${col} NOT IN (0, 1)) OR (typeof(${col}) = 'text' AND lower(${col}) NOT IN ('1', '0', 't', 'f', 'true', 'false')) OR typeof(${col}) = 'blob'` }[ty];
        const bad = q(`SELECT ${pk} AS id FROM ${ident(t)} WHERE ${cond} ORDER BY ${pk}`);
        if (!bad.length) continue;
        const want = { s: "text (not NULL)", i: "a whole number", n: "a number", b: "0 or 1" }[ty];
        const effect = d.whole ? "the API stops loading quests at the first bad row, so every quest after it is missing" : "the API's Scan fails there and the rest of that row loads blank";
        add("error", t, `${t}.${c}`, `${bad.length} row(s) where ${c} is not ${want} (id ${sample(bad)}): ${effect}`, routeFor(t, bad[0].id));
      }
      const dup = have.includes("id") ? q(`SELECT id FROM ${ident(t)} GROUP BY id HAVING COUNT(*) > 1`) : [];
      if (dup.length) add("error", t, `${t}.id`, `duplicate id ${sample(dup)}`);
    }
    function routeFor(t, id) {
      const base = { quest_def: "#quest/", npc: "#npc/", items: "#item/", enemies: "#mob/", effects: "#effect/" }[t];
      return base ? base + id : "";
    }

    // 3. JSON fields and references.
    const itemIds = ok.items ? new Set(q("SELECT id FROM items").map(r => r.id)) : null;
    const itemNames = ok.items ? new Set(q("SELECT lower(Name) AS n FROM items").map(r => r.n)) : null;
    const enemyIds = ok.enemies ? new Set(q("SELECT id FROM enemies").map(r => r.id)) : null;
    const enemyNames = ok.enemies ? new Set(q("SELECT lower(Name) AS n FROM enemies").map(r => r.n)) : null;
    const enemyExact = ok.enemies ? new Set(q("SELECT Name FROM enemies").map(r => r.Name)) : null;
    const npcIds = ok.npc ? new Set(q("SELECT id FROM npc").map(r => r.id)) : null;
    const nodeIds = ok.conversation ? new Set(q("SELECT Identifier FROM conversation").map(r => r.Identifier)) : null;
    const effectIds = ok.effects ? new Set(q("SELECT id FROM effects").map(r => r.id)) : (tables.has("effects") ? null : new Set());
    const questIds = ok.quest_def ? new Set(q("SELECT id FROM quest_def").map(r => r.id)) : null;
    const item = (id, lvl, t, where, ctx, route) => { if (itemIds && !itemIds.has(+id)) add(lvl, t, where, `${ctx} points at item ${id}, which doesn't exist`, route); };

    if (ok.quest_def) for (const r of q("SELECT id, Title, Giver, TurnIn, Prereqs, Rewards, Steps FROM quest_def ORDER BY id")) {
      const w = `quest ${r.id} ${r.Title || ""}`.trim(), route = "#quest/" + r.id;
      const lists = {};
      for (const [k, sch] of [["Prereqs", "int"], ["Rewards", T.reward], ["Steps", T.step]]) {
        if (!String(r[k] ?? "").trim()) { lists[k] = []; continue; }
        const g = goList(r[k], sch, k);
        g.errs.forEach(e => add("error", "quest_def", w, e + " (the API stops loading quests here)", route));
        lists[k] = g.errs.length ? null : g.v;
      }
      if (npcIds && r.Giver && !npcIds.has(r.Giver)) add("error", "quest_def", w, `Giver is NPC ${r.Giver}, which doesn't exist`, route);
      if (npcIds && r.TurnIn && !npcIds.has(r.TurnIn)) add("error", "quest_def", w, `TurnIn is NPC ${r.TurnIn}, which doesn't exist`, route);
      (lists.Prereqs || []).forEach(p => { if (questIds && !questIds.has(p)) add("warning", "quest_def", w, `prerequisite quest ${p} doesn't exist, so this quest is never offered`, route); });
      (lists.Rewards || []).forEach((rw, i) => rw && item(rw.ItemID ?? rw.itemid, "error", "quest_def", w, `reward ${i + 1}`, route));
      (lists.Steps || []).forEach((s, i) => {
        if (!s || typeof s !== "object") return;
        const g = k => s[Object.keys(s).find(x => x.toLowerCase() === k.toLowerCase())];
        const type = g("Type"), target = String(g("Target") ?? ""), at = `step ${i + 1} (${type})`, sr = `#quest/${r.id}/step/${i}`;
        // Target plus Targets (more enemies or items counting towards the
        // same step), as questline.go questStep.names reads them.
        const tl = g("Targets"), extra = (Array.isArray(tl) ? tl : typeof tl === "string" ? [tl] : []).filter(x => typeof x === "string" && x.trim());
        const names = [...new Set([target, ...extra].map(x => x.trim()).filter(Boolean))];
        if (!STEP_TYPES.includes(type)) add("error", "quest_def", w, `${at}: unknown step type`, sr);
        if ((type === "kill" || type === "boss") && enemyNames) {
          if (!names.length) add("error", "quest_def", w, `${at}: no enemy named ""`, sr);
          names.forEach(n => { if (!enemyNames.has(n.toLowerCase())) add("error", "quest_def", w, `${at}: no enemy named "${n}"`, sr); });
        }
        if (type === "collect" && itemNames) {
          if (!names.length) add("error", "quest_def", w, `${at}: no item named ""`, sr);
          names.forEach(n => { if (!itemNames.has(n.toLowerCase())) add("error", "quest_def", w, `${at}: no item named "${n}"`, sr); });
        }
        if (extra.length && ["talk", "reach", "equip", "level"].includes(type)) add("warning", "quest_def", w, `${at}: Targets is ignored on ${type} steps`, sr);
        if (type === "craft" && target && itemNames && !itemNames.has(target.toLowerCase())) add("error", "quest_def", w, `${at}: no item named "${target}"`, sr);
        if (type === "equip" && target && itemNames && !["weapon", "shield", "head", "chest", "legs", "mount"].includes(target.toLowerCase()) && !itemNames.has(target.toLowerCase())) add("error", "quest_def", w, `${at}: "${target}" is not an item or a slot`, sr);
        if (type === "talk" && npcIds && !npcIds.has(+g("NPC"))) add("error", "quest_def", w, `${at}: NPC ${g("NPC") ?? "(none)"} doesn't exist`, sr);
      });
    }

    if (ok.conversation) for (const r of q("SELECT id, Identifier, Options, ItemsGiven FROM conversation ORDER BY Identifier")) {
      const w = `dialogue ${r.Identifier}`, route = "#dialog/" + encodeURIComponent(r.Identifier || "");
      const re = /\[\s*['"](.*?)['"]\s*,\s*['"]([^'"]*)['"]\s*\]/g;
      let m;
      while ((m = re.exec(String(r.Options || "")))) if (m[2] !== "1" && !nodeIds.has(m[2])) add("error", "conversation", w, `answer "${m[1]}" leads to node "${m[2]}", which doesn't exist`, route);
      if (String(r.ItemsGiven || "").trim()) {
        const g = goList(r.ItemsGiven, T.invItem, "ItemsGiven");
        g.errs.forEach(e => add("error", "conversation", w, e + " (the API gives nothing)", route));
        if (!g.errs.length) g.v.forEach((x, i) => x && item(x.ItemID, "error", "conversation", w, `ItemsGiven ${i + 1}`, route));
      }
    }
    if (ok.npc && nodeIds) for (const r of q("SELECT id, Name, Conversation FROM npc WHERE IFNULL(Conversation, '') <> '' ORDER BY id"))
      if (!nodeIds.has(r.Conversation)) add("warning", "npc", `NPC ${r.id} ${r.Name}`, `greeting node "${r.Conversation}" doesn't exist`, "#npc/" + r.id);

    if (ok.loot) {
      const orphan = new Map();
      for (const r of q("SELECT id, EnemyID, ItemID FROM loot ORDER BY id")) {
        item(r.ItemID, "error", "loot", `loot ${r.id}`, `drop of enemy ${r.EnemyID}`, "#loot/" + r.EnemyID);
        if (enemyIds && !enemyIds.has(r.EnemyID)) orphan.set(r.EnemyID, [...(orphan.get(r.EnemyID) || []), r.id]);
      }
      for (const [e, ids] of orphan) add("warning", "loot", `loot of enemy ${e}`, `enemy ${e} doesn't exist, so loot row(s) ${ids.join(", ")} are never used`);
    }
    if (ok.craft) for (const r of q("SELECT id, ItemID, Items FROM craft ORDER BY id")) {
      const w = `craft ${r.id}`;
      item(r.ItemID, "error", "craft", w, "result");
      const g = goList(r.Items || "", T.invItem, "Items");
      if (!String(r.Items || "").trim()) add("error", "craft", w, "Items is empty: initCraftItems panics on it");
      else g.errs.forEach(e => add("error", "craft", w, e + " (initCraftItems panics on it)"));
      if (g.v && !g.errs.length) g.v.forEach((x, i) => x && item(x.ItemID, "error", "craft", w, `ingredient ${i + 1}`));
    }
    if (ok.forge) for (const r of q("SELECT id, EnterID, ResultID FROM forge ORDER BY id")) {
      item(r.EnterID, "error", "forge", `forge ${r.id}`, "input"); item(r.ResultID, "error", "forge", `forge ${r.id}`, "result");
    }
    if (ok.boss_patterns) for (const r of q("SELECT id, EnemyID, Pattern FROM boss_patterns ORDER BY id")) {
      const w = `boss_patterns ${r.id} (enemy ${r.EnemyID})`, route = "#mob/" + r.EnemyID;
      if (enemyIds && !enemyIds.has(r.EnemyID)) add("warning", "boss_patterns", w, `enemy ${r.EnemyID} doesn't exist`);
      const g = goList(r.Pattern, T.action, "Pattern");
      g.errs.forEach(e => add("error", "boss_patterns", w, e + " (the API drops every primitive in this row)", route));
      if (g.v && !g.errs.length) g.v.forEach((a, i) => {
        if (!a || typeof a !== "object") return;
        const at = `primitive ${i + 1}`;
        if (!KINDS.includes(a.do)) add("warning", "boss_patterns", w, `${at}: "do" is ${JSON.stringify(a.do)}, the API runs ${KINDS.join(", ")}`, route);
        if (a.do === "spawn" && enemyIds && !enemyIds.has(a.enemy)) add("error", "boss_patterns", w, `${at}: spawns enemy ${a.enemy}, which doesn't exist`, route);
        if (a.effect && effectIds && !effectIds.has(a.effect)) add("error", "boss_patterns", w, `${at}: effect ${a.effect} doesn't exist`, route);
      });
    }
    if (ok.effects) for (const r of q("SELECT id, Name, Modifiers FROM effects ORDER BY id")) {
      const g = goList(r.Modifiers, T.mod, "Modifiers");
      g.errs.forEach(e => add("error", "effects", `effect ${r.id} ${r.Name}`, e + " (the API loads the effect with no modifiers)", "#effect/" + r.id));
    }
    if (ok.world && enemyExact) {
      const bad = q("SELECT Enemy, COUNT(*) AS n, MIN(X) AS x, MIN(Y) AS y FROM world WHERE Enemy <> '' GROUP BY Enemy ORDER BY Enemy").filter(r => !enemyExact.has(r.Enemy));
      bad.forEach(r => add("error", "world", "map", `${r.n} tile(s) spawn "${r.Enemy}", which is not an enemy name (exact match, case too)`, `#map/${r.x},${r.y}`));
    }
    return { errors: P.filter(p => p.level === "error"), warnings: P.filter(p => p.level === "warning"), all: P };
  }
  return { run, goList, T };
})();
