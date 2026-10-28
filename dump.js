"use strict";
// Deterministic text dump and change summaries of a content db.
// BQDump.dump(q): one file per table, content/<table>.sql: its CREATE (and
// any index or trigger on it) and one INSERT per row in primary key order, as
// SQLite's own quote() writes the values. The same db always gives the same
// text, so git diffs show what changed. Running every file through sqlite3
// rebuilds the db.
// BQDump.fingerprint(q): a hash per row, keyed by primary key, for "what
// changed" between two versions; BQDump.diff(a, b) counts it per table.
const BQDump = (() => {
  const ident = s => `"${String(s).replace(/"/g, '""')}"`;
  const LABEL = { quest_def: "Quests", conversation: "Dialogue", npc: "NPCs", items: "Items", enemies: "Mobs", loot: "Loot", sfx: "Sounds", sound_slot: "Mob and NPC sounds", sfx_preset: "Sound presets",
    world: "Map tiles", craft: "Craft", forge: "Forge", boss_patterns: "Boss patterns", effects: "Effects", plot: "Plots",
    enemySpells: "Mob spells", routine: "NPC routines", routineNode: "NPC routine nodes", areas: "Areas", area_tiles: "Area tiles", world_flip: "Flipped objects", quest_daily_pool: "Daily quest pools", npc_spawn: "NPC placements" };
  const ORDER = ["quest_def", "quest_daily_pool", "conversation", "npc", "npc_spawn", "items", "enemies", "boss_patterns", "effects", "loot", "craft", "forge", "plot", "world", "world_flip", "areas", "area_tiles", "sfx", "sound_slot", "sfx_preset"];

  function tables(q) {
    return q("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  }
  // Primary key expression and ORDER BY that do not depend on file layout.
  function keyOf(q, t) {
    const info = q(`PRAGMA table_info(${ident(t)})`);
    const pk = info.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
    const cols = info.map(c => c.name);
    if (pk.length) return { cols, key: pk.map(c => `quote(${ident(c.name)})`).join(" || ',' || "), order: pk.map(c => ident(c.name)).join(", ") + (pk.length < cols.length ? ", " + cols.map(ident).join(", ") : "") };
    return { cols, key: null, order: cols.map((_, i) => i + 1).join(", ") };
  }
  const rowExpr = cols => cols.map(c => `quote(${ident(c)})`).join(" || ',' || ") || "''";

  function dump(q) {
    const files = [];
    for (const t of tables(q)) {
      const { cols, order } = keyOf(q, t.name);
      const extra = q("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type <> 'table' AND sql IS NOT NULL ORDER BY type, name", [t.name]).map(r => r.sql + ";");
      const rows = q(`SELECT 'INSERT INTO ${ident(t.name).replace(/'/g, "''")} VALUES(' || ${rowExpr(cols)} || ');' AS s FROM ${ident(t.name)} ORDER BY ${order}`).map(r => r.s);
      const text = [`-- ${t.name}: ${rows.length} row(s). Written by the BrawlQuest editor from bq-content.db on every commit; edit the db, not this file.`,
        `-- columns: ${cols.join(", ")}`, t.sql + ";", ...extra, ...rows, ""].join("\n");
      files.push({ path: `content/${t.name}.sql`, text });
    }
    return files;
  }

  // cyrb53: a quick 53-bit string hash (not for security).
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  // With prev and touched (a Set of table names), only touched tables are
  // read again; the rest are taken from prev.
  function fingerprint(q, prev, touched) {
    const fp = {};
    for (const t of tables(q)) {
      if (prev && touched && !touched.has(t.name) && prev[t.name] && prev[t.name].sql === t.sql) { fp[t.name] = prev[t.name]; continue; }
      const { cols, key } = keyOf(q, t.name);
      const rows = new Map();
      const sel = `SELECT ${key || rowExpr(cols)} AS k, ${rowExpr(cols)} AS v FROM ${ident(t.name)}`;
      for (const r of q(sel)) rows.set(r.k, hash(r.v));
      fp[t.name] = { sql: t.sql, rows };
    }
    return fp;
  }
  // { tables: [{ table, label, added, edited, removed, schema }], text }
  function diff(a, b) {
    const out = [];
    const names = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
    names.sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99) || x.localeCompare(y));
    for (const t of names) {
      const A = a && a[t], B = b && b[t];
      const d = { table: t, label: LABEL[t] || t, added: 0, edited: 0, removed: 0, schema: "" };
      if (!A) { d.schema = "new table"; d.added = B.rows.size; }
      else if (!B) { d.schema = "table removed"; d.removed = A.rows.size; }
      else {
        if (A.sql !== B.sql) d.schema = "columns changed";
        for (const [k, h] of B.rows) { const o = A.rows.get(k); if (o === undefined) d.added++; else if (o !== h) d.edited++; }
        for (const k of A.rows.keys()) if (!B.rows.has(k)) d.removed++;
      }
      if (d.added || d.edited || d.removed || d.schema) out.push(d);
    }
    return { tables: out, text: summary(out) };
  }
  function summary(list) {
    return list.map(d => {
      const parts = [d.edited && `edited ${d.edited}`, d.added && `added ${d.added}`, d.removed && `removed ${d.removed}`, d.schema].filter(Boolean);
      return `${d.label}: ${parts.join(", ")}`;
    }).join("; ");
  }
  return { dump, fingerprint, diff, hash, LABEL };
})();
