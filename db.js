"use strict";
// In-browser content database (sql.js). Same rules as the API's editor.go:
// table/column whitelist, validation, keyed SQL that is also recorded for the
// SQL migration export.
const BQ = (() => {
  let SQL = null, db = null;
  const st = { name: "", changes: [], dirty: false, warnings: [] };
  const EDITABLE = ["quest_def", "npc", "conversation", "items", "loot", "plot", "enemies", "effects"];
  // Status effects (the API's effects.go creates the same table at startup).
  const EFFECT_TABLE = "CREATE TABLE IF NOT EXISTS effects (id INTEGER PRIMARY KEY, Name TEXT NOT NULL, Description TEXT NOT NULL DEFAULT '', Icon TEXT NOT NULL DEFAULT '', Visual TEXT NOT NULL DEFAULT '', Duration REAL NOT NULL DEFAULT 3, Stacking TEXT NOT NULL DEFAULT 'refresh', MaxStacks INTEGER NOT NULL DEFAULT 1, Modifiers TEXT NOT NULL DEFAULT '[]');";
  const STACKING = ["refresh", "stack", "extend", "ignore"];
  const MOD_TYPES = ["move_speed", "stun", "dot"];
  // Same table the API creates at startup (enemies.go); one JSON array of
  // primitives per row, all rows of an enemy run together.
  const PATTERN_TABLE = "CREATE TABLE IF NOT EXISTS boss_patterns (id INTEGER PRIMARY KEY, EnemyID INTEGER NOT NULL, Pattern TEXT NOT NULL);";
  const PLOT_MAX = 12;
  const PLOT_COLS = "id INTEGER PRIMARY KEY, Name TEXT NOT NULL DEFAULT '', X INTEGER NOT NULL, Y INTEGER NOT NULL, W INTEGER NOT NULL DEFAULT 8, H INTEGER NOT NULL DEFAULT 8, Rent INTEGER NOT NULL DEFAULT 50, MinLevel INTEGER NOT NULL DEFAULT 1, Agent INTEGER NOT NULL DEFAULT 0";
  const PLOT_TABLE = `CREATE TABLE IF NOT EXISTS plot (${PLOT_COLS});`;
  // Same as the API's content/migrations/2026-10-19-plot-agents.sql: adds
  // plot.Agent (Land Agent npc id, 0 = any) and is safe to run twice.
  const PLOT_UPGRADE = [PLOT_TABLE, "DROP TABLE IF EXISTS plot_upgrade;", `CREATE TABLE plot_upgrade (${PLOT_COLS});`,
    "INSERT INTO plot_upgrade (id, Name, X, Y, W, H, Rent, MinLevel, Agent) SELECT p.id, p.Name, p.X, p.Y, p.W, p.H, p.Rent, p.MinLevel, IFNULL((SELECT Agent FROM plot q WHERE q.id = p.id), 0) FROM plot p, (SELECT 0 AS Agent) d;",
    "DROP TABLE plot;", "ALTER TABLE plot_upgrade RENAME TO plot;"];
  const WORLD_COLS = { GroundTile: 1, ForegroundTile: 1, Name: 1, Music: 1, Collision: 1, Enemy: 1 };
  const STEP_TYPES = ["kill", "boss", "collect", "talk", "reach", "use", "craft", "equip", "level"];

  async function init() {
    if (!SQL) SQL = await initSqlJs({ locateFile: f => "vendor/" + f });
  }
  async function open(buf, name) {
    await init();
    if (db) db.close();
    db = new SQL.Database(new Uint8Array(buf));
    st.name = name; st.changes = []; st.dirty = false; st.plotUpgraded = false;
    st.warnings = checkSchema();
    if (has("plot") && !cols("plot").includes("Agent")) {
      db.exec("BEGIN;" + PLOT_UPGRADE.join("\n") + "COMMIT;");
      st.plotUpgraded = true;
      st.warnings.push("Added the plot.Agent column (which Land Agent lets each plot) to this copy. The server needs content/migrations/2026-10-19-plot-agents.sql, or a restart of the new API, which adds it itself.");
    }
    return st.warnings;
  }
  const has = t => !!q("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t]).length;
  function checkSchema() {
    for (const t of ["items", "enemies", "npc", "conversation", "world"])
      if (!has(t)) throw new Error(`This is not a BrawlQuest content database: table "${t}" is missing.`);
    const w = [];
    if (!has("quest_def")) w.push("No quest_def table: this database has not had the questline migration (content/migrations/2026-10-13-questline.sql). Quests are read-only empty until you apply it with sqlite3. Items, NPCs, dialogue, loot and the map still work.");
    if (!has("plot")) w.push("No plot table yet (content/migrations/2026-10-14-plots.sql). It is created for you when you save your first plot.");
    if (!has("effects")) w.push("No effects table yet (content/migrations/2026-10-20-webbed-up.sql adds it with Webbed Up). It is created for you when you save your first effect.");
    if (has("quest")) w.push("Old 'quest' table found: the questline migration drops it.");
    return w;
  }
  function q(sql, params) {
    const s = db.prepare(sql); const out = [];
    if (params) s.bind(params);
    while (s.step()) out.push(s.getAsObject());
    s.free(); return out;
  }
  function cols(t) { return q(`PRAGMA table_info(${t})`).map(r => r.name); }
  const lit = v => {
    if (v === null || v === undefined) return "''";
    if (typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "number") { if (!isFinite(v)) throw new Error("bad number"); return String(v); }
    return "'" + String(v).replace(/'/g, "''") + "'";
  };
  function apply(stmts, note) {
    db.exec("BEGIN");
    try { for (const s of stmts) db.exec(s); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw new Error(e.message + " (in: " + stmts.find(Boolean).slice(0, 120) + ")"); }
    st.changes.push(`-- ${new Date().toISOString().replace("T", " ").slice(0, 19)} ${note}\n${stmts.join("\n")}`);
    st.dirty = true;
  }

  function validate(table, row) {
    const need = (k, msg) => { if (!String(row[k] ?? "").trim()) throw new Error(msg); };
    if (table === "quest_def") {
      for (const k of ["Steps", "Rewards", "Prereqs"]) {
        if (!String(row[k] ?? "").trim()) { row[k] = "[]"; continue; }
        try { JSON.parse(row[k]); } catch (e) { throw new Error(`${k} is not valid JSON: ${e.message}`); }
      }
      const steps = JSON.parse(row.Steps);
      if (!steps.length) throw new Error("a quest needs at least one step");
      steps.forEach((s, i) => { if (!STEP_TYPES.includes(s.Type)) throw new Error(`step ${i + 1}: unknown type "${s.Type}"`); });
      need("Title", "title is required");
    } else if (table === "conversation") {
      need("Identifier", "identifier is required");
      const o = String(row.Options || "").trim();
      if (o && o !== "[]" && !/\[\s*['"].*?['"]\s*,\s*['"][^'"]*['"]\s*\]/.test(o)) throw new Error("options must look like [['Label','next-id']]");
    } else if (table === "npc") need("Name", "name is required");
    else if (table === "items") {
      need("Name", "name is required"); need("Type", "type is required");
      const a = String(row.Attributes || "None");
      if (a !== "None" && a !== "" && !/^([A-Z]{3},-?\d+)(;[A-Z]{3},-?\d+)*$/.test(a)) throw new Error("attributes must be None or like STR,10;INT,5");
    } else if (table === "plot") {
      need("Name", "name is required");
      for (const k of ["X", "Y", "W", "H", "Rent", "MinLevel"]) { row[k] = Math.trunc(+row[k] || 0); }
      if (row.W < 1 || row.H < 1 || row.W > PLOT_MAX || row.H > PLOT_MAX) throw new Error(`plots are 1 to ${PLOT_MAX} tiles a side`);
      if (row.Rent < 0) throw new Error("rent can't be negative");
      if (row.MinLevel < 1 || row.MinLevel > 40) throw new Error("min level must be 1 to 40");
      row.Agent = Math.trunc(+row.Agent || 0);
      if (row.Agent && !q("SELECT 1 FROM npc WHERE id=? AND Faction='Land Agent'", [row.Agent]).length) throw new Error(`npc ${row.Agent} is not a Land Agent`);
      const hit = q("SELECT Name FROM plot WHERE id <> ? AND X < ? AND X + W > ? AND Y < ? AND Y + H > ?", [row.id, row.X + row.W, row.X, row.Y + row.H, row.Y]);
      if (hit.length) throw new Error("overlaps plot " + hit[0].Name);
      const area = [row.X, row.X + row.W - 1, row.Y, row.Y + row.H - 1];
      const forest = q("SELECT COUNT(*) AS n FROM world WHERE X BETWEEN ? AND ? AND Y BETWEEN ? AND ? AND (Name = 'Foundation Forest' OR Name LIKE 'Dominion of %')", area)[0].n;
      if (forest) throw new Error(`${forest} tile(s) are in Foundation Forest, where building is free: plots go outside it`);
      const onMap = q("SELECT COUNT(DISTINCT X || ',' || Y) AS n FROM world WHERE X BETWEEN ? AND ? AND Y BETWEEN ? AND ?", area)[0].n;
      if (onMap < row.W * row.H) throw new Error(`${row.W * row.H - onMap} tile(s) are off the map`);
    } else if (table === "enemies") {
      need("Name", "name is required");
      row.Name = String(row.Name).trim();
      if (q("SELECT 1 FROM enemies WHERE Name = ? AND id <> ?", [row.Name, row.id]).length) throw new Error("another enemy is already called " + row.Name);
      for (const k of ["ATK", "HP", "Range", "XP", "Width", "Height", "AttackSpeed"]) if (k in row) row[k] = Math.trunc(+row[k] || 0);
      row.CanMove = row.CanMove ? 1 : 0;
      if (row.HP < 1) throw new Error("HP must be at least 1");
      if (row.Width < 1 || row.Height < 1 || row.Width > 8 || row.Height > 8) throw new Error("width and height are 1 to 8 tiles");
      if ("AttackSpeed" in row && row.AttackSpeed < 1) row.AttackSpeed = 1;
      if (!String(row.Attributes ?? "").trim()) row.Attributes = "None";
    } else if (table === "effects") {
      need("Name", "name is required");
      row.Name = String(row.Name).trim();
      if (q("SELECT 1 FROM effects WHERE Name = ? AND id <> ?", [row.Name, row.id]).length) throw new Error("another effect is already called " + row.Name);
      row.Duration = +row.Duration;
      if (!(row.Duration > 0 && row.Duration <= 600)) throw new Error("duration is 0.1 to 600 seconds");
      if (!STACKING.includes(row.Stacking)) throw new Error("stacking must be one of " + STACKING.join(", "));
      row.MaxStacks = Math.trunc(+row.MaxStacks || 1);
      if (row.MaxStacks < 1 || row.MaxStacks > 20) throw new Error("max stacks is 1 to 20");
      let mods;
      try { mods = JSON.parse(row.Modifiers || "[]"); } catch (e) { throw new Error("modifiers are not valid JSON: " + e.message); }
      if (!Array.isArray(mods)) throw new Error("modifiers must be a JSON array");
      mods.forEach((m, i) => {
        if (!MOD_TYPES.includes(m.type)) throw new Error(`modifier ${i + 1}: type must be one of ${MOD_TYPES.join(", ")}`);
        if (m.type === "move_speed" && !(m.mult >= 0 && m.mult <= 3)) throw new Error(`modifier ${i + 1}: move_speed mult is 0 to 3 (0.5 = half speed)`);
        if (m.type === "dot" && !(m.damage > 0)) throw new Error(`modifier ${i + 1}: dot needs damage`);
      });
      row.Modifiers = JSON.stringify(mods);
      for (const k of ["Description", "Icon", "Visual"]) row[k] = String(row[k] ?? "");
    } else if (table === "loot") {
      if (!q("SELECT id FROM enemies WHERE id=?", [row.EnemyID]).length) throw new Error("unknown enemy");
      if (!q("SELECT id FROM items WHERE id=?", [row.ItemID]).length) throw new Error("unknown item");
    }
  }

  // Enemy names whose boss_patterns apply this effect.
  function effectUsers(id) {
    if (!has("boss_patterns")) return [];
    const out = [];
    for (const r of q("SELECT p.Pattern, e.Name FROM boss_patterns p LEFT JOIN enemies e ON e.id = p.EnemyID")) {
      let a; try { a = JSON.parse(r.Pattern); } catch { continue; }
      if (Array.isArray(a) && a.some(x => +x.effect === id)) out.push(r.Name || "?");
    }
    return out;
  }

  const api = {
    content() {
      const quests = has("quest_def") ? q("SELECT * FROM quest_def ORDER BY Level, id") : [];
      return {
        quests, hasQuestline: has("quest_def"),
        plots: has("plot") ? q("SELECT * FROM plot ORDER BY Name") : [],
        npcs: q("SELECT id, Name, ImgPath, Faction, Conversation, SpawnX, SpawnY FROM npc ORDER BY Name"),
        conversations: q("SELECT id, Identifier, Title, ImgPath, Options, ReputationChange, ItemsGiven, QuestStart FROM conversation ORDER BY Identifier"),
        enemies: q("SELECT * FROM enemies ORDER BY Name"),
        enemyCols: cols("enemies"),
        effects: has("effects") ? q("SELECT * FROM effects ORDER BY Name") : [],
        patterns: has("boss_patterns") ? q("SELECT * FROM boss_patterns ORDER BY EnemyID, id") : [],
        spells: has("enemySpells") ? q("SELECT * FROM enemySpells ORDER BY EnemyID, id") : [],
        items: q("SELECT * FROM items ORDER BY Name"),
        loot: q("SELECT * FROM loot ORDER BY EnemyID, id"),
        itemTypes: q("SELECT DISTINCT Type FROM items WHERE Type <> '' ORDER BY Type").map(r => r.Type),
        subtypes: q("SELECT DISTINCT Subtype FROM items WHERE Subtype <> '' ORDER BY Subtype").map(r => r.Subtype),
      };
    },
    world() {
      const strings = [""], idx = new Map([["", 0]]);
      const s = v => { v = v == null ? "" : String(v); if (!idx.has(v)) { idx.set(v, strings.length); strings.push(v); } return idx.get(v); };
      const stmt = db.prepare("SELECT X, Y, IFNULL(GroundTile,''), IFNULL(ForegroundTile,''), IFNULL(Name,''), IFNULL(Collision,0), IFNULL(Enemy,''), IFNULL(Music,'') FROM world");
      const tiles = [];
      while (stmt.step()) {
        const r = stmt.get();
        const c = r[5] === 1 || r[5] === "1" || String(r[5]).toLowerCase() === "true" ? 1 : 0;
        tiles.push([r[0], r[1], s(r[2]), s(r[3]), s(r[4]), c, s(r[6]), s(r[7])]);
      }
      stmt.free();
      return { strings, tiles };
    },
    save({ table, row }) {
      if (!EDITABLE.includes(table)) throw new Error("table not editable: " + table);
      if (table === "quest_def" && !has("quest_def")) throw new Error("This database has no quest_def table. Apply the questline migration first.");
      if (table === "plot" && !has("plot")) apply([PLOT_TABLE], "create plot table");
      if (table === "effects" && !has("effects")) apply([EFFECT_TABLE], "create effects table");
      if (table === "plot") row.Agent = +row.Agent || 0;
      const allowed = cols(table);
      for (const k of Object.keys(row)) if (!allowed.includes(k)) throw new Error(`${table} has no column ${k}`);
      let id = +row.id || 0;
      if (id <= 0) {
        id = q(`SELECT IFNULL(MAX(id),0)+1 AS n FROM ${table}`)[0].n;
        if ((table === "quest_def" || table === "npc") && id < 1700) id = 1700;
        if (table === "plot") id = q("SELECT IFNULL(MAX(id),0)+1 AS n FROM plot")[0].n;
        row.id = id;
      }
      validate(table, row);
      const names = allowed.filter(c => c in row);
      const stmts = [`INSERT OR REPLACE INTO ${table} (${names.join(", ")}) VALUES (${names.map(c => lit(row[c])).join(", ")});`];
      if (table === "enemies") {
        // Map spawns name the enemy (world.Enemy): a rename moves them along.
        const old = q("SELECT Name FROM enemies WHERE id = ?", [id])[0];
        if (old && old.Name && old.Name !== row.Name) stmts.push(`UPDATE world SET Enemy = ${lit(row.Name)} WHERE Enemy = ${lit(old.Name)};`);
      }
      apply(stmts, `save ${table} ${id}`);
      return { id };
    },
    delete({ table, id }) {
      if (!EDITABLE.includes(table) || !(id > 0)) throw new Error("bad delete");
      const s = [`DELETE FROM ${table} WHERE id = ${+id};`];
      if (table === "npc") s.push(`DELETE FROM routineNode WHERE Routine IN (SELECT id FROM routine WHERE NPC = ${+id});`, `DELETE FROM routine WHERE NPC = ${+id};`);
      if (table === "items") s.push(`DELETE FROM loot WHERE ItemID = ${+id};`);
      if (table === "effects") {
        const users = effectUsers(+id);
        if (users.length) throw new Error(`used by ${users.join(", ")}: remove it from their patterns first`);
      }
      if (table === "enemies") {
        const e = q("SELECT Name FROM enemies WHERE id = ?", [+id])[0];
        const placed = e ? q("SELECT COUNT(*) AS n FROM world WHERE Enemy = ?", [e.Name])[0].n : 0;
        if (placed) throw new Error(`${e.Name} is placed on ${placed} map tile(s): clear those spawns first (Map > Select)`);
        s.push(`DELETE FROM loot WHERE EnemyID = ${+id};`, `DELETE FROM enemySpells WHERE EnemyID = ${+id};`, PATTERN_TABLE, `DELETE FROM boss_patterns WHERE EnemyID = ${+id};`);
      }
      apply(s, `delete ${table} ${id}`);
      return { ok: true };
    },
    // Replace an enemy's boss_patterns with one row holding these primitives
    // (zone / soak only). Keeps the enemy's lowest existing row id.
    patterns({ enemyId, actions }) {
      enemyId = Math.trunc(+enemyId);
      if (!(enemyId > 0) || !q("SELECT 1 FROM enemies WHERE id = ?", [enemyId]).length) throw new Error("save the enemy first");
      const clean = actions.map(BQSim.clean);
      clean.forEach(BQSim.validate);
      clean.forEach((a, i) => { if (a.effect && !(has("effects") && q("SELECT 1 FROM effects WHERE id = ?", [a.effect]).length)) throw new Error(`primitive ${i + 1}: no effect ${a.effect} (make it in the Effects tab)`); });
      const s = [PATTERN_TABLE];
      const rows = has("boss_patterns") ? q("SELECT id FROM boss_patterns WHERE EnemyID = ? ORDER BY id", [enemyId]) : [];
      let id = rows.length ? rows[0].id : 0;
      if (!id) id = has("boss_patterns") ? Math.max(2000, q("SELECT IFNULL(MAX(id),0)+1 AS n FROM boss_patterns")[0].n) : 2000;
      s.push(`DELETE FROM boss_patterns WHERE EnemyID = ${enemyId} AND id <> ${id};`);
      if (clean.length) s.push(`INSERT OR REPLACE INTO boss_patterns (id, EnemyID, Pattern) VALUES (${id}, ${enemyId}, ${lit(JSON.stringify(clean))});`);
      else s.push(`DELETE FROM boss_patterns WHERE id = ${id};`);
      apply(s, `boss patterns for enemy ${enemyId}`);
      return { id, actions: clean };
    },
    tiles(patches) {
      if (patches.length > 5000) throw new Error("too many tiles in one save");
      const s = [];
      for (const p of patches) {
        const sets = [];
        for (const [k, v] of Object.entries(p.Set)) {
          if (!WORLD_COLS[k]) throw new Error("world has no editable column " + k);
          if (k === "Enemy" && v && !q("SELECT 1 FROM enemies WHERE Name=?", [v]).length) throw new Error("unknown enemy " + v);
          sets.push(`${k} = ${lit(v)}`);
        }
        if (!sets.length) continue;
        const x = Math.trunc(p.X), y = Math.trunc(p.Y);
        s.push(`INSERT INTO world (GroundTile, ForegroundTile, Name, X, Y, Music, Collision, Enemy) SELECT 'assets/world/grounds/grass.png', '', '', ${x}, ${y}, '', 0, '' WHERE NOT EXISTS (SELECT 1 FROM world WHERE X = ${x} AND Y = ${y});`,
          `UPDATE world SET ${sets.join(", ")} WHERE X = ${x} AND Y = ${y};`);
      }
      if (s.length) apply(s, `tiles x${patches.length}`);
      return { tiles: patches.length };
    },
    export() {
      const head = `-- BrawlQuest content changes from the editor (${st.name}), ${new Date().toISOString().slice(0, 10)}.\n` +
        "-- Apply: cp bq-content.db bq-content.db.bak && sqlite3 bq-content.db < this-file.sql\n" +
        "-- Statements are INSERT OR REPLACE / UPDATE by key, so applying twice is safe.\n.bail on\nBEGIN;\n";
      const plots = st.plotUpgraded || st.changes.some(c => /\bplot\b/.test(c));
      const schema = plots ? "-- plot table with the Agent column (as content/migrations/2026-10-19-plot-agents.sql)\n" + PLOT_UPGRADE.join("\n") + "\n" : "";
      return { sql: head + schema + st.changes.join("\n") + (st.changes.length ? "\n" : "") + "COMMIT;\n" };
    },
    clearExport() { st.changes = []; return { ok: true }; },
  };

  return {
    init, open, api, st, has: () => !!db, effectUsers: id => effectUsers(id),
    bytes: () => db.export(),
  };
})();
