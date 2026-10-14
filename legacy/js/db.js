/* global initSqlJs */
"use strict";

const BQDB = (() => {
  let SQL = null;
  let db = null;
  let dirty = false;
  let sourceName = "";

  async function init() {
    if (SQL) return SQL;
    SQL = await initSqlJs({ locateFile: (file) => `vendor/${file}` });
    return SQL;
  }

  function markDirty(v = true) { dirty = !!v; }
  function isDirty() { return dirty; }
  function getName() { return sourceName; }
  function hasDb() { return !!db; }
  function raw() { return db; }

  async function openArrayBuffer(buf, name) {
    await init();
    if (db) try { db.close(); } catch (_) {}
    db = new SQL.Database(new Uint8Array(buf));
    sourceName = name || "content.db";
    dirty = false;
    return db;
  }

  async function openUrl(url, name) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    return openArrayBuffer(await res.arrayBuffer(), name || url.split("/").pop());
  }

  function all(sql, params = []) {
    if (!db) return [];
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function one(sql, params = []) {
    return all(sql, params)[0] || null;
  }

  function run(sql, params = []) {
    if (!db) throw new Error("No database loaded");
    db.run(sql, params);
    dirty = true;
  }

  function nextId(table, idCol = "id") {
    const row = one(`SELECT MAX("${idCol}") AS m FROM "${table}"`);
    const m = row && row.m != null ? Number(row.m) : 0;
    return (Number.isFinite(m) ? m : 0) + 1;
  }

  function exportBytes() {
    if (!db) throw new Error("No database loaded");
    return db.export();
  }

  function download(filename) {
    const data = exportBytes();
    const blob = new Blob([data], { type: "application/octet-stream" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename || (sourceName.replace(/\.db$/i, "") + "-edited.db") || "bq-content-edited.db";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    dirty = false;
  }

  function itemName(id) {
    const r = one("SELECT Name FROM items WHERE id=?", [id]);
    return r ? r.Name : null;
  }
  function enemyName(id) {
    const r = one("SELECT Name FROM enemies WHERE id=?", [id]);
    return r ? r.Name : null;
  }
  function npcName(id) {
    const r = one("SELECT Name FROM npc WHERE id=?", [id]);
    return r ? r.Name : null;
  }
  function enemyIdByName(name) {
    const r = one("SELECT id FROM enemies WHERE Name=?", [name]);
    return r ? r.id : null;
  }
  function itemIdByName(name) {
    const r = one("SELECT id FROM items WHERE Name=?", [name]);
    return r ? r.id : null;
  }
  function hasIdentifier(ident) {
    return !!one("SELECT id FROM conversation WHERE Identifier=?", [ident]);
  }

  /** Validate references before download. Never recreate schema — only UPDATE/INSERT. */
  function validateContent() {
    const issues = [];
    const ITEM_TYPES = new Set(["wep","arm_head","arm_chest","arm_legs","arm_leg","shield","mount","hp_potion","mana_potion","spell","reagent","buddy","currency","quest","furniture","floor","wall","ore"]);
    const ITEM_SUBTYPES = new Set(["None","Light","Medium","Heavy","High Mastery",""]);
    const QUEST_TYPES = new Set(["kill","gather","go"]);

    const enemyNames = new Set(all("SELECT Name FROM enemies").map((r) => r.Name));
    const itemNames = new Set(all("SELECT Name FROM items").map((r) => r.Name));
    const itemIds = new Set(all("SELECT id FROM items").map((r) => Number(r.id)));
    const idents = new Set(all("SELECT Identifier FROM conversation").map((r) => r.Identifier));

    for (const it of all("SELECT id, Type, Subtype, Attributes FROM items")) {
      if (it.Type && !ITEM_TYPES.has(it.Type)) issues.push(`Item ${it.id}: unknown Type "${it.Type}"`);
      const st = it.Subtype == null ? "None" : it.Subtype;
      if (!ITEM_SUBTYPES.has(st)) issues.push(`Item ${it.id}: unknown Subtype "${it.Subtype}"`);
    }
    for (const q of all("SELECT id, Type, Value FROM quest")) {
      if (q.Type && !QUEST_TYPES.has(q.Type)) issues.push(`Quest ${q.id}: unknown Type "${q.Type}"`);
      if (q.Type === "kill" && q.Value && !enemyNames.has(q.Value)) issues.push(`Quest ${q.id}: Value "${q.Value}" is not an enemy Name`);
      if (q.Type === "gather" && q.Value && !itemNames.has(q.Value)) issues.push(`Quest ${q.id}: Value "${q.Value}" is not an item Name`);
    }
    const xy = new Set();
    for (const w of all("SELECT id, X, Y, Enemy FROM world")) {
      const key = w.X + "," + w.Y;
      if (xy.has(key)) issues.push(`World duplicate X,Y ${key} (id ${w.id})`);
      xy.add(key);
      if (w.Enemy && w.Enemy !== "" && !enemyNames.has(w.Enemy)) {
        issues.push(`World ${w.X},${w.Y}: Enemy "${w.Enemy}" is not an enemy Name`);
      }
    }
    for (const c of all("SELECT id, Identifier, Options, ItemsGiven FROM conversation")) {
      const opts = BQOptions.parse(c.Options);
      for (const [label, next] of opts) {
        if (next !== "1" && next !== "0" && next !== "" && !idents.has(next)) {
          issues.push(`Conversation ${c.Identifier}: option "${label}" → missing Identifier "${next}"`);
        }
      }
      for (const it of BQOptions.parseItemsGiven(c.ItemsGiven)) {
        if (!itemIds.has(Number(it.ItemID))) issues.push(`Conversation ${c.Identifier}: ItemsGiven ItemID ${it.ItemID} missing`);
      }
    }
    for (const q of all("SELECT id, ItemsGiven FROM quest")) {
      for (const it of BQOptions.parseItemsGiven(q.ItemsGiven)) {
        if (!itemIds.has(Number(it.ItemID))) issues.push(`Quest ${q.id}: ItemsGiven ItemID ${it.ItemID} missing`);
      }
    }
    for (const l of all("SELECT id, EnemyID, ItemID FROM loot")) {
      if (!one("SELECT id FROM enemies WHERE id=?", [l.EnemyID])) issues.push(`Loot ${l.id}: EnemyID ${l.EnemyID} missing`);
      if (!itemIds.has(Number(l.ItemID))) issues.push(`Loot ${l.id}: ItemID ${l.ItemID} missing`);
    }
    for (const c of all("SELECT id, ItemID, Items FROM craft")) {
      if (!itemIds.has(Number(c.ItemID))) issues.push(`Craft ${c.id}: result ItemID ${c.ItemID} missing`);
      try {
        const arr = JSON.parse(c.Items || "[]");
        for (const it of arr) {
          if (!itemIds.has(Number(it.ItemID))) issues.push(`Craft ${c.id}: ingredient ItemID ${it.ItemID} missing`);
        }
      } catch {
        issues.push(`Craft ${c.id}: Items is not valid JSON`);
      }
    }
    for (const f of all("SELECT id, EnterID, ResultID FROM forge")) {
      if (!itemIds.has(Number(f.EnterID))) issues.push(`Forge ${f.id}: EnterID ${f.EnterID} missing`);
      if (!itemIds.has(Number(f.ResultID))) issues.push(`Forge ${f.id}: ResultID ${f.ResultID} missing`);
    }
    for (const n of all("SELECT id, Name, Conversation FROM npc WHERE Conversation IS NOT NULL AND Conversation != ''")) {
      if (!idents.has(n.Conversation)) issues.push(`NPC ${n.id} (${n.Name}): Conversation "${n.Conversation}" not found`);
    }
    return issues;
  }

  return {
    init, openArrayBuffer, openUrl, all, one, run, nextId,
    exportBytes, download, markDirty, isDirty, getName, hasDb, raw,
    itemName, enemyName, npcName, enemyIdByName, itemIdByName, hasIdentifier,
    validateContent,
  };
})();
