"use strict";
// In-browser content database (sql.js). Same rules as the API's editor.go:
// table/column whitelist, validation, keyed SQL that is also recorded for the
// SQL migration export.
const BQ = (() => {
  let SQL = null, db = null;
  // version counts edits; touched names the tables edited since the history
  // module last looked (null = all of them, after an open).
  const st = { name: "", changes: [], dirty: false, warnings: [], version: 0, touched: null };
  const EDITABLE = ["quest_def", "npc", "conversation", "items", "loot", "plot", "enemies", "effects", "npc_notes", "quest_daily_pool", "npc_spawn"];
  // NPC placements (the API's content/migrations/2026-10-27-npc-spawns.sql,
  // docs/NPC_SPAWNS.md): one NPC standing in many places. Same statements as
  // the migration (so either path dumps the same): the table, and every
  // placed NPC's current SpawnX/SpawnY as its first placement. npc.SpawnX /
  // SpawnY stay as a mirror of the first placement (-999: none).
  const SPAWN_MIGRATION = ["CREATE TABLE IF NOT EXISTS npc_spawn (\n  id INTEGER PRIMARY KEY,\n  NPC INTEGER NOT NULL,\n  X INTEGER NOT NULL,\n  Y INTEGER NOT NULL\n);",
    "CREATE INDEX IF NOT EXISTS npc_spawn_npc ON npc_spawn(NPC);",
    "INSERT INTO npc_spawn (NPC, X, Y)\n  SELECT n.id, n.SpawnX, n.SpawnY FROM npc n\n  WHERE n.SpawnX > -999 AND NOT EXISTS (SELECT 1 FROM npc_spawn s WHERE s.NPC = n.id)\n  ORDER BY n.id;"];
  const mirrorSpawn = id => `UPDATE npc SET SpawnX = IFNULL((SELECT X FROM npc_spawn WHERE NPC = ${+id} ORDER BY id LIMIT 1), -999), SpawnY = IFNULL((SELECT Y FROM npc_spawn WHERE NPC = ${+id} ORDER BY id LIMIT 1), -999) WHERE id = ${+id};`;
  // NPC routines per placement, with a pace and waits (the API's
  // content/migrations/2026-10-27-routine-placements.sql, docs/NPC_ROUTINES.md):
  // routine.Spawn (0: the NPC's first placement), routine.Speed (tiles a
  // second), Loop 2 (there and back), routineNode.Wait (seconds). Same
  // statements as the migration; run by itself on the first routine saved.
  const ROUTINE_MIGRATION = [
    "CREATE TABLE IF NOT EXISTS routine (id INTEGER PRIMARY KEY, NPC INTEGER, TriggerHour INTEGER, Loop INTEGER);",
    "CREATE TABLE IF NOT EXISTS routineNode (id INTEGER PRIMARY KEY, Routine INTEGER, X INTEGER, Y INTEGER, Position INTEGER);",
    "DROP TABLE IF EXISTS routine_upgrade;",
    "CREATE TABLE routine_upgrade (\n  id INTEGER PRIMARY KEY,\n  NPC INTEGER,\n  TriggerHour INTEGER,\n  Loop INTEGER,\n  Spawn INTEGER NOT NULL DEFAULT 0,\n  Speed REAL NOT NULL DEFAULT 1\n);",
    "INSERT INTO routine_upgrade (id, NPC, TriggerHour, Loop, Spawn, Speed)\n  SELECT e.id, e.NPC, e.TriggerHour, e.Loop,\n    IFNULL((SELECT Spawn FROM routine r WHERE r.id = e.id), 0),\n    IFNULL((SELECT Speed FROM routine r WHERE r.id = e.id), 1)\n  FROM routine e, (SELECT 0 AS Spawn, 1 AS Speed) d;",
    "DROP TABLE routine;",
    "ALTER TABLE routine_upgrade RENAME TO routine;",
    "DROP TABLE IF EXISTS routineNode_upgrade;",
    "CREATE TABLE routineNode_upgrade (\n  id INTEGER PRIMARY KEY,\n  Routine INTEGER,\n  X INTEGER,\n  Y INTEGER,\n  Position INTEGER,\n  Wait INTEGER NOT NULL DEFAULT 0\n);",
    "INSERT INTO routineNode_upgrade (id, Routine, X, Y, Position, Wait)\n  SELECT e.id, e.Routine, e.X, e.Y, e.Position,\n    IFNULL((SELECT Wait FROM routineNode r WHERE r.id = e.id), 0)\n  FROM routineNode e, (SELECT 0 AS Wait) d;",
    "DROP TABLE routineNode;",
    "ALTER TABLE routineNode_upgrade RENAME TO routineNode;"];
  // Quest Studio's personality notes per NPC (content/migrations/2026-10-26-npc-notes.sql
  // in the API). Editor-only: the game never reads it. Created on the first note.
  const NOTES_TABLE = "CREATE TABLE IF NOT EXISTS npc_notes (id INTEGER PRIMARY KEY, NPC INTEGER NOT NULL UNIQUE, Notes TEXT NOT NULL DEFAULT '');";
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
  // Areas (content/migrations/2026-10-24-areas.sql in the API): named regions
  // painted per tile, a layer beside the zones (world.Name). The API creates
  // the same two tables, empty, at startup.
  const AREA_TABLES = [`CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY, Name TEXT NOT NULL,
  Interior TEXT NOT NULL DEFAULT 'none',
  Weather INTEGER NOT NULL DEFAULT 1,
  Reverb TEXT NOT NULL DEFAULT 'none',
  ReverbWet REAL NOT NULL DEFAULT 0.5,
  ReverbDry REAL NOT NULL DEFAULT 1.0,
  Ambient TEXT NOT NULL DEFAULT '',
  AmbientVol REAL NOT NULL DEFAULT 0.5,
  Light REAL,
  Priority INTEGER NOT NULL DEFAULT 0);`,
    "CREATE TABLE IF NOT EXISTS area_tiles (X INTEGER NOT NULL, Y INTEGER NOT NULL, AreaID INTEGER NOT NULL, PRIMARY KEY (X, Y));"];
  // Flipped map objects (content/migrations/2026-10-25-world-flip.sql in the
  // API): one row per tile whose object is drawn mirrored left to right. The
  // API creates the same table, empty, at startup.
  const WORLD_FLIP_TABLE = "CREATE TABLE IF NOT EXISTS world_flip (X INTEGER NOT NULL, Y INTEGER NOT NULL, PRIMARY KEY (X, Y));";
  const INTERIORS = ["none", "roofed", "cave"];
  const REVERBS = ["none", "small", "room", "hall", "cave", "largecave"];
  // Same as the API's content/migrations/2026-10-19-plot-agents.sql: adds
  // plot.Agent (Land Agent npc id, 0 = any) and is safe to run twice.
  const PLOT_UPGRADE = [PLOT_TABLE, "DROP TABLE IF EXISTS plot_upgrade;", `CREATE TABLE plot_upgrade (${PLOT_COLS});`,
    "INSERT INTO plot_upgrade (id, Name, X, Y, W, H, Rent, MinLevel, Agent) SELECT p.id, p.Name, p.X, p.Y, p.W, p.H, p.Rent, p.MinLevel, IFNULL((SELECT Agent FROM plot q WHERE q.id = p.id), 0) FROM plot p, (SELECT 0 AS Agent) d;",
    "DROP TABLE plot;", "ALTER TABLE plot_upgrade RENAME TO plot;"];
  // Same as the API's content/migrations/2026-10-20-boss-knockback.sql and
  // 2026-10-22-hit-effects.sql: adds enemies.KnockbackResist (0 = full
  // knockback, 1 = immune), bosses (Old World Crystal loot, the Rift Colossus)
  // immune, and enemies.HitEffect (what comes off a mob when hit: blood, wood,
  // stone...; the audited values). Safe to run twice; tuned values are kept.
  // 2026-10-25-day-night-spawns.sql adds enemies.SpawnsDay and SpawnsNight
  // (1 = the spawner puts it out then; every mob 1 and 1). Same text as the
  // migration's CREATE, so either path dumps the same.
  const ENEMY_COLS = '\n\t\t\tid INTEGER PRIMARY KEY,\n\t\t\tName TEXT,\n\t\t\tATK INTEGER,\n\t\t\tImage TEXT,\n\t\t\tHP INTEGER,\n\t\t\tRange INTEGER,\n\t\t\tCanMove BOOL,\n\t\t\tXP INTEGER\n\t\t, Width INTEGER DEFAULT 1, Height INTEGER DEFAULT 1, Attributes TEXT DEFAULT "None", AttackSpeed INTEGER NOT NULL DEFAULT 1, KnockbackResist REAL NOT NULL DEFAULT 0, HitEffect TEXT NOT NULL DEFAULT \'blood\', SpawnsDay INTEGER NOT NULL DEFAULT 1, SpawnsNight INTEGER NOT NULL DEFAULT 1';
  const ENEMY_REBUILD = ["DROP TABLE IF EXISTS enemies_upgrade;", `CREATE TABLE enemies_upgrade (${ENEMY_COLS});`,
    "INSERT INTO enemies_upgrade (id, Name, ATK, Image, HP, Range, CanMove, XP, Width, Height, Attributes, AttackSpeed, KnockbackResist, HitEffect, SpawnsDay, SpawnsNight) SELECT e.id, e.Name, e.ATK, e.Image, e.HP, e.Range, e.CanMove, e.XP, e.Width, e.Height, e.Attributes, IFNULL((SELECT AttackSpeed FROM enemies q WHERE q.id = e.id), 1), IFNULL((SELECT KnockbackResist FROM enemies q WHERE q.id = e.id), 0), IFNULL(NULLIF((SELECT HitEffect FROM enemies q WHERE q.id = e.id), ''), 'blood'), IFNULL((SELECT SpawnsDay FROM enemies q WHERE q.id = e.id), 1), IFNULL((SELECT SpawnsNight FROM enemies q WHERE q.id = e.id), 1) FROM enemies e, (SELECT 1 AS AttackSpeed, 0 AS KnockbackResist, 'blood' AS HitEffect, 1 AS SpawnsDay, 1 AS SpawnsNight) d;",
    "DROP TABLE enemies;", "ALTER TABLE enemies_upgrade RENAME TO enemies;"];
  const ENEMY_KB_UPGRADE = [...ENEMY_REBUILD,
    "UPDATE enemies SET KnockbackResist = 1 WHERE KnockbackResist = 0 AND (id IN (SELECT EnemyID FROM loot WHERE ItemID = 53) OR Name = 'Rift Colossus');",
    "UPDATE enemies SET HitEffect = 'bone' WHERE HitEffect = 'blood' AND id IN (52, 54, 55, 56);",
    "UPDATE enemies SET HitEffect = 'crystal' WHERE HitEffect = 'blood' AND id IN (13, 1201, 1202, 1203);",
    "UPDATE enemies SET HitEffect = 'ectoplasm' WHERE HitEffect = 'blood' AND id IN (30, 39, 40, 41, 42, 1200);",
    "UPDATE enemies SET HitEffect = 'embers' WHERE HitEffect = 'blood' AND id IN (31, 35, 36);",
    "UPDATE enemies SET HitEffect = 'ice' WHERE HitEffect = 'blood' AND id IN (32, 33, 34);",
    "UPDATE enemies SET HitEffect = 'ichor' WHERE HitEffect = 'blood' AND id IN (2, 6);",
    "UPDATE enemies SET HitEffect = 'leaf' WHERE HitEffect = 'blood' AND id IN (49, 51, 53);",
    "UPDATE enemies SET HitEffect = 'metal' WHERE HitEffect = 'blood' AND id IN (38, 57);",
    "UPDATE enemies SET HitEffect = 'pulp' WHERE HitEffect = 'blood' AND id IN (59);",
    "UPDATE enemies SET HitEffect = 'slime' WHERE HitEffect = 'blood' AND id IN (48, 50);",
    "UPDATE enemies SET HitEffect = 'stone' WHERE HitEffect = 'blood' AND id IN (3, 4, 22);",
    "UPDATE enemies SET HitEffect = 'water' WHERE HitEffect = 'blood' AND id IN (60);",
    "UPDATE enemies SET HitEffect = 'wood' WHERE HitEffect = 'blood' AND id IN (1, 5, 29, 37, 58);"];
  // What the client draws for enemies.HitEffect (scripts/effects/hit_materials.lua);
  // anything else falls back to blood there.
  const HIT_EFFECTS = ["blood", "wood", "stone", "crystal", "ice", "bone", "slime", "ichor", "ectoplasm", "water", "metal", "embers", "leaf", "pulp", "none"];
  // Same as the API's content/migrations/2026-10-24-quest-sequential.sql:
  // adds quest_def.Sequential (0 = every objective counts at once, the
  // default for every quest; 1 = one at a time, in order). Safe to run twice;
  // values already set are kept.
  // Same text as the migration's CREATE, so either path dumps the same.
  const QUEST_COLS = '\n  id INTEGER PRIMARY KEY,\n  Act INTEGER NOT NULL DEFAULT 1,\n  Zone TEXT NOT NULL DEFAULT \'\',\n  Title TEXT NOT NULL,\n  Summary TEXT NOT NULL DEFAULT \'\',\n  Level INTEGER NOT NULL DEFAULT 1,\n  MinLevel INTEGER NOT NULL DEFAULT 1,\n  Giver INTEGER NOT NULL,\n  TurnIn INTEGER NOT NULL,\n  Prereqs TEXT NOT NULL DEFAULT \'[]\',\n  Offer TEXT NOT NULL DEFAULT \'\',\n  Accept TEXT NOT NULL DEFAULT \'\',\n  Progress TEXT NOT NULL DEFAULT \'\',\n  Complete TEXT NOT NULL DEFAULT \'\',\n  XP INTEGER NOT NULL DEFAULT 0,\n  Gold INTEGER NOT NULL DEFAULT 0,\n  Rewards TEXT NOT NULL DEFAULT \'[]\',\n  Steps TEXT NOT NULL DEFAULT \'[]\',\n  Sequential INTEGER NOT NULL DEFAULT 0\n';
  const QUEST_SEQ_UPGRADE = ["DROP TABLE IF EXISTS quest_def_upgrade;", `CREATE TABLE quest_def_upgrade (${QUEST_COLS});`,
    "INSERT INTO quest_def_upgrade (id, Act, Zone, Title, Summary, Level, MinLevel, Giver, TurnIn, Prereqs, Offer, Accept, Progress, Complete, XP, Gold, Rewards, Steps, Sequential) SELECT e.id, e.Act, e.Zone, e.Title, e.Summary, e.Level, e.MinLevel, e.Giver, e.TurnIn, e.Prereqs, e.Offer, e.Accept, e.Progress, e.Complete, e.XP, e.Gold, e.Rewards, e.Steps, IFNULL((SELECT Sequential FROM quest_def q WHERE q.id = e.id), 0) FROM quest_def e, (SELECT 0 AS Sequential) d;",
    "DROP TABLE quest_def;", "ALTER TABLE quest_def_upgrade RENAME TO quest_def;"];
  // Daily quests: the API's content/migrations/2026-10-26-daily-quests.sql,
  // statement for statement (quest_def.Daily, quest_daily_pool and the
  // example daily 9001 with its three pool rows). Safe to run twice; values
  // set in between are kept. Same CREATE text, so either path dumps the same.
  const QUEST_DAILY_COLS = QUEST_COLS.replace("Sequential INTEGER NOT NULL DEFAULT 0\n", "Sequential INTEGER NOT NULL DEFAULT 0,\n  Daily INTEGER NOT NULL DEFAULT 0\n");
  const DAILY_POOL_TABLE = "CREATE TABLE IF NOT EXISTS quest_daily_pool (\n  id INTEGER PRIMARY KEY,\n  QuestID INTEGER NOT NULL,\n  Kind TEXT NOT NULL,\n  Slot INTEGER NOT NULL DEFAULT 1,\n  RefID INTEGER NOT NULL DEFAULT 0,\n  Name TEXT NOT NULL DEFAULT '',\n  Label TEXT NOT NULL DEFAULT '',\n  Min INTEGER NOT NULL DEFAULT 0,\n  Max INTEGER NOT NULL DEFAULT 0,\n  X INTEGER NOT NULL DEFAULT 0,\n  Y INTEGER NOT NULL DEFAULT 0,\n  Radius REAL NOT NULL DEFAULT 0,\n  Weight INTEGER NOT NULL DEFAULT 1\n);";
  const DAILY_MIGRATION = ["DROP TABLE IF EXISTS quest_def_upgrade;", `CREATE TABLE quest_def_upgrade (${QUEST_DAILY_COLS});`,
    "INSERT INTO quest_def_upgrade (id, Act, Zone, Title, Summary, Level, MinLevel, Giver, TurnIn, Prereqs,\n    Offer, Accept, Progress, Complete, XP, Gold, Rewards, Steps, Sequential, Daily)\n  SELECT e.id, e.Act, e.Zone, e.Title, e.Summary, e.Level, e.MinLevel, e.Giver, e.TurnIn, e.Prereqs,\n    e.Offer, e.Accept, e.Progress, e.Complete, e.XP, e.Gold, e.Rewards, e.Steps, e.Sequential,\n    IFNULL((SELECT Daily FROM quest_def q WHERE q.id = e.id), 0)\n  FROM quest_def e, (SELECT 0 AS Daily) d;",
    "DROP TABLE quest_def;", "ALTER TABLE quest_def_upgrade RENAME TO quest_def;", DAILY_POOL_TABLE,
    "INSERT OR IGNORE INTO quest_def (id, Act, Zone, Title, Summary, Level, MinLevel, Giver, TurnIn, Prereqs,\n    Offer, Accept, Progress, Complete, XP, Gold, Rewards, Steps, Sequential, Daily)\n  VALUES (9001, 1, 'Squall''s End', 'Daily Drill: {mob}', 'Example daily quest. Crumb wants {count} {mob} gone today.', 3, 3, 1300, 1300, '[1303]',\n    'Daily drill, recruit. Today it''s {mob}. {count} of them. Same time tomorrow, something else.',\n    'Off you go. {count}. I''m counting.',\n    '{count} {mob}. That is the number. Can you count?',\n    'Not bad. Come back after the bell tonight for the next one.',\n    60, 5, '[]',\n    '[{\"Type\":\"kill\",\"Target\":\"{mob}\",\"Count\":\"{count}\",\"Text\":\"Defeat {count} {mob}\",\"Hint\":\"A new drill every day at the reset.\"}]',\n    0, 1);",
    "INSERT OR IGNORE INTO quest_daily_pool (id, QuestID, Kind, Slot, Name, Label, Min, Max) VALUES\n  (1, 9001, 'mob', 1, 'Spider', 'Spiders', 4, 6),\n  (2, 9001, 'mob', 1, 'Spider|Cave Spider', 'spiders of any kind', 6, 8),\n  (3, 9001, 'mob', 1, 'Tree', 'Trees', 2, 3);"];
  // For Export SQL once this copy has Daily: the quest_def rebuild that
  // works on a server db with or without Sequential and Daily (keeping both),
  // and the pool table. Not the example rows.
  const QUEST_DAILY_UPGRADE = ["DROP TABLE IF EXISTS quest_def_upgrade;", `CREATE TABLE quest_def_upgrade (${QUEST_DAILY_COLS});`,
    "INSERT INTO quest_def_upgrade (id, Act, Zone, Title, Summary, Level, MinLevel, Giver, TurnIn, Prereqs, Offer, Accept, Progress, Complete, XP, Gold, Rewards, Steps, Sequential, Daily) SELECT e.id, e.Act, e.Zone, e.Title, e.Summary, e.Level, e.MinLevel, e.Giver, e.TurnIn, e.Prereqs, e.Offer, e.Accept, e.Progress, e.Complete, e.XP, e.Gold, e.Rewards, e.Steps, IFNULL((SELECT Sequential FROM quest_def q WHERE q.id = e.id), 0), IFNULL((SELECT Daily FROM quest_def q WHERE q.id = e.id), 0) FROM quest_def e, (SELECT 0 AS Sequential, 0 AS Daily) d;",
    "DROP TABLE quest_def;", "ALTER TABLE quest_def_upgrade RENAME TO quest_def;", DAILY_POOL_TABLE];
  const hasDaily = () => has("quest_def") && cols("quest_def").includes("Daily") && has("quest_daily_pool");
  // Quest conversations: the API's content/migrations/2026-10-26-quest-dialogue.sql,
  // statement for statement (quest_def.OfferTree, AcceptTree, ProgressTree,
  // CompleteTree and Replies, plus the example branching offer on the
  // example daily 9001). Needs Daily first, as the migration does. Safe to run
  // twice. QUEST_DIALOGUE_UPGRADE (for Export SQL) is the rebuild alone.
  const DIALOGUE_COLS = ["OfferTree", "AcceptTree", "ProgressTree", "CompleteTree", "Replies"];
  const DIALOGUE_MIGRATION = [
      "DROP TABLE IF EXISTS quest_def_upgrade;",
      "CREATE TABLE quest_def_upgrade (\n  id INTEGER PRIMARY KEY,\n  Act INTEGER NOT NULL DEFAULT 1,\n  Zone TEXT NOT NULL DEFAULT '',\n  Title TEXT NOT NULL,\n  Summary TEXT NOT NULL DEFAULT '',\n  Level INTEGER NOT NULL DEFAULT 1,\n  MinLevel INTEGER NOT NULL DEFAULT 1,\n  Giver INTEGER NOT NULL,\n  TurnIn INTEGER NOT NULL,\n  Prereqs TEXT NOT NULL DEFAULT '[]',\n  Offer TEXT NOT NULL DEFAULT '',\n  Accept TEXT NOT NULL DEFAULT '',\n  Progress TEXT NOT NULL DEFAULT '',\n  Complete TEXT NOT NULL DEFAULT '',\n  XP INTEGER NOT NULL DEFAULT 0,\n  Gold INTEGER NOT NULL DEFAULT 0,\n  Rewards TEXT NOT NULL DEFAULT '[]',\n  Steps TEXT NOT NULL DEFAULT '[]',\n  Sequential INTEGER NOT NULL DEFAULT 0,\n  Daily INTEGER NOT NULL DEFAULT 0,\n  OfferTree TEXT NOT NULL DEFAULT '',\n  AcceptTree TEXT NOT NULL DEFAULT '',\n  ProgressTree TEXT NOT NULL DEFAULT '',\n  CompleteTree TEXT NOT NULL DEFAULT '',\n  Replies TEXT NOT NULL DEFAULT '{}'\n);",
      "INSERT INTO quest_def_upgrade (id, Act, Zone, Title, Summary, Level, MinLevel, Giver, TurnIn, Prereqs,\n    Offer, Accept, Progress, Complete, XP, Gold, Rewards, Steps, Sequential, Daily,\n    OfferTree, AcceptTree, ProgressTree, CompleteTree, Replies)\n  SELECT e.id, e.Act, e.Zone, e.Title, e.Summary, e.Level, e.MinLevel, e.Giver, e.TurnIn, e.Prereqs,\n    e.Offer, e.Accept, e.Progress, e.Complete, e.XP, e.Gold, e.Rewards, e.Steps, e.Sequential, e.Daily,\n    IFNULL((SELECT OfferTree FROM quest_def q WHERE q.id = e.id), ''),\n    IFNULL((SELECT AcceptTree FROM quest_def q WHERE q.id = e.id), ''),\n    IFNULL((SELECT ProgressTree FROM quest_def q WHERE q.id = e.id), ''),\n    IFNULL((SELECT CompleteTree FROM quest_def q WHERE q.id = e.id), ''),\n    IFNULL((SELECT Replies FROM quest_def q WHERE q.id = e.id), '{}')\n  FROM quest_def e,\n    (SELECT '' AS OfferTree, '' AS AcceptTree, '' AS ProgressTree, '' AS CompleteTree, '{}' AS Replies) d;",
      "DROP TABLE quest_def;",
      "ALTER TABLE quest_def_upgrade RENAME TO quest_def;",
      "INSERT INTO conversation (id, Identifier, Title, ImgPath, Options, ReputationChange, ItemsGiven, QuestStart)\n  SELECT 9001, 'q9001-offer', 'Daily drill, recruit. Today it''s {mob}. {count} of them. Same time tomorrow, something else.', '',\n    '[[''Why {mob}?'',''q9001-why''],[''What do I get out of it?'',''q9001-pay''],[''Fine. {count} {mob}, coming up.'',''@accept''],[''Not today, Sergeant.'',''@decline'']]', '0', '', NULL\n  WHERE NOT EXISTS (SELECT 1 FROM conversation WHERE id = 9001 OR Identifier = 'q9001-offer');",
      "INSERT INTO conversation (id, Identifier, Title, ImgPath, Options, ReputationChange, ItemsGiven, QuestStart)\n  SELECT 9002, 'q9001-why', 'Because I said so. And because they keep wandering into my yard and frightening the targets.', '',\n    '[[''Fair enough. Sign me up.'',''@accept''],[''Back to the drill.'',''@offer'']]', '0', '', NULL\n  WHERE NOT EXISTS (SELECT 1 FROM conversation WHERE id = 9002 OR Identifier = 'q9001-why');",
      "INSERT INTO conversation (id, Identifier, Title, ImgPath, Options, ReputationChange, ItemsGiven, QuestStart)\n  SELECT 9003, 'q9001-pay', 'Coin. Experience. My undying respect. Mostly the coin.', '',\n    '[[''Deal. Where are they?'',''@accept''],[''Let me think about it.'',''@decline'']]', '0', '', NULL\n  WHERE NOT EXISTS (SELECT 1 FROM conversation WHERE id = 9003 OR Identifier = 'q9001-pay');",
      "UPDATE quest_def SET OfferTree = 'q9001-offer', Replies = '{\"OnIt\":\"Yes, Sergeant!\"}'\n  WHERE id = 9001 AND OfferTree = '' AND Replies = '{}';"
  ];
  const QUEST_DIALOGUE_UPGRADE = [...QUEST_DAILY_UPGRADE, ...DIALOGUE_MIGRATION.slice(0, 5)];
  const hasDialogue = () => has("quest_def") && DIALOGUE_COLS.every(c => cols("quest_def").includes(c));
  const WORLD_COLS = { GroundTile: 1, ForegroundTile: 1, Name: 1, Music: 1, Collision: 1, Enemy: 1 };
  const STEP_TYPES = ["kill", "boss", "collect", "talk", "reach", "use", "craft", "equip", "level"];

  async function init() {
    if (!SQL) SQL = await initSqlJs({ locateFile: f => "vendor/" + f });
  }
  async function open(buf, name) {
    await init();
    if (db) db.close();
    db = new SQL.Database(new Uint8Array(buf));
    st.name = name; st.changes = []; st.dirty = false; st.plotUpgraded = false; st.enemiesUpgraded = false; st.questsUpgraded = false; st.dailyUpgraded = false; st.dialogueUpgraded = false; st.touched = null; st.version++;
    st.warnings = checkSchema();
    const ec = cols("enemies");
    if (!ec.includes("KnockbackResist") || !ec.includes("HitEffect")) {
      db.exec("BEGIN;" + ENEMY_KB_UPGRADE.join("\n") + "COMMIT;");
      st.enemiesUpgraded = true;
      const added = [!ec.includes("KnockbackResist") && "enemies.KnockbackResist (0 = full knockback, 1 = immune; bosses set to 1)",
        !ec.includes("HitEffect") && "enemies.HitEffect (what comes off a mob when hit: wood for trees, bone for skeletons...)",
        !ec.includes("SpawnsDay") && "enemies.SpawnsDay/SpawnsNight (every mob out day and night)"].filter(Boolean);
      st.warnings.push(`Added ${added.join(" and ")} to this copy. The server needs content/migrations/2026-10-20-boss-knockback.sql, 2026-10-22-hit-effects.sql and 2026-10-25-day-night-spawns.sql; Export SQL includes the same step.`);
    } else if (!ec.includes("SpawnsDay") || !ec.includes("SpawnsNight")) {
      // Only the day/night columns are missing: rebuild the table without
      // re-running the knockback and hit effect defaults over tuned values.
      db.exec("BEGIN;" + ENEMY_REBUILD.join("\n") + "COMMIT;");
      st.enemiesUpgraded = true;
      st.warnings.push("Added enemies.SpawnsDay and SpawnsNight (Spawns in day / Spawns at night; every mob out at both) to this copy. The server needs content/migrations/2026-10-25-day-night-spawns.sql, or a restart of the new API, which adds them itself; Export SQL includes the same step.");
    }
    if (has("quest_def") && !cols("quest_def").includes("Sequential")) {
      db.exec("BEGIN;" + QUEST_SEQ_UPGRADE.join("\n") + "COMMIT;");
      st.questsUpgraded = true;
      st.warnings.push("Added quest_def.Sequential (objectives in order or all at once; every quest all at once) to this copy. The server needs content/migrations/2026-10-24-quest-sequential.sql, or a restart of the new API, which adds it itself; Export SQL includes the same step.");
    }
    if (has("plot") && !cols("plot").includes("Agent")) {
      db.exec("BEGIN;" + PLOT_UPGRADE.join("\n") + "COMMIT;");
      st.plotUpgraded = true;
      st.warnings.push("Added the plot.Agent column (which Land Agent lets each plot) to this copy. The server needs content/migrations/2026-10-19-plot-agents.sql, or a restart of the new API, which adds it itself.");
    }
    return st.warnings;
  }
  const has = t => !!q("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t]).length;
  const hasRoutineCols = () => has("routine") && has("routineNode") && cols("routine").includes("Spawn") && cols("routineNode").includes("Wait");
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
    st.version++;
    if (st.touched) for (const s of stmts) for (const m of s.matchAll(/\b(?:INTO|UPDATE|FROM|TABLE(?: IF (?:NOT )?EXISTS)?)\s+"?(\w+)/gi)) st.touched.add(m[1]);
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
      if (String(row.Replies ?? "").trim()) {
        let r; try { r = JSON.parse(row.Replies); } catch (e) { throw new Error("Replies is not valid JSON: " + e.message); }
        if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("Replies must be a JSON object");
        for (const k of Object.keys(r)) if (!["Accept", "Decline", "OnIt", "Back", "AnythingElse"].includes(k)) throw new Error(`Replies has no line called ${k}`);
      }
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
      if ("KnockbackResist" in row) {
        const kb = +row.KnockbackResist;
        if (!(kb >= 0 && kb <= 1)) throw new Error("knockback resist is 0 (full knockback) to 1 (immune)");
        row.KnockbackResist = kb;
      }
      for (const k of ["SpawnsDay", "SpawnsNight"]) if (k in row) row[k] = +row[k] ? 1 : 0;
      if ("HitEffect" in row) {
        row.HitEffect = String(row.HitEffect ?? "").trim().toLowerCase() || "blood";
        if (!HIT_EFFECTS.includes(row.HitEffect)) throw new Error("hit effect must be one of " + HIT_EFFECTS.join(", "));
      }
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
    } else if (table === "quest_daily_pool") {
      // editor.go validateEditorRow, plus the types the API scans into.
      row.Kind = String(row.Kind ?? "").trim().toLowerCase();
      if (!["mob", "item", "count", "place"].includes(row.Kind)) throw new Error("Kind must be mob, item, count or place");
      for (const k of ["QuestID", "Slot", "RefID", "Min", "Max", "X", "Y", "Weight"]) if (k in row) row[k] = Math.trunc(+row[k] || 0);
      if (!(row.QuestID > 0)) throw new Error("QuestID is required");
      if (!q("SELECT 1 FROM quest_def WHERE id = ?", [row.QuestID]).length) throw new Error("no quest " + row.QuestID);
      if ("Slot" in row && row.Slot < 1) row.Slot = 1;
      if ("Weight" in row && row.Weight < 1) row.Weight = 1;
      if ("Radius" in row) row.Radius = Math.max(0, +row.Radius || 0);
      for (const k of ["Name", "Label"]) if (k in row) row[k] = String(row[k] ?? "");
    } else if (table === "loot") {
      if (!q("SELECT id FROM enemies WHERE id=?", [row.EnemyID]).length) throw new Error("unknown enemy");
      if (!q("SELECT id FROM items WHERE id=?", [row.ItemID]).length) throw new Error("unknown item");
    }
  }

  // Enemy names whose boss_patterns apply this effect / spawn this enemy.
  function patternUsers(test, skipEnemy) {
    if (!has("boss_patterns")) return [];
    const out = [];
    for (const r of q("SELECT p.Pattern, p.EnemyID, e.Name FROM boss_patterns p LEFT JOIN enemies e ON e.id = p.EnemyID")) {
      if (r.EnemyID === skipEnemy) continue;
      let a; try { a = JSON.parse(r.Pattern); } catch { continue; }
      if (Array.isArray(a) && a.some(test)) out.push(r.Name || "?");
    }
    return out;
  }
  const effectUsers = id => patternUsers(x => +x.effect === id);
  const spawnUsers = id => patternUsers(x => x.do === "spawn" && +x.enemy === id, id);

  const api = {
    content() {
      const quests = has("quest_def") ? q("SELECT * FROM quest_def ORDER BY Level, id") : [];
      return {
        quests, hasQuestline: has("quest_def"),
        npcNotes: has("npc_notes") ? q("SELECT * FROM npc_notes") : [],
        hasDaily: hasDaily(), hasDialogue: hasDialogue(),
        dailyPools: has("quest_daily_pool") ? q("SELECT * FROM quest_daily_pool ORDER BY QuestID, Kind, Slot, id") : [],
        plots: has("plot") ? q("SELECT * FROM plot ORDER BY Name") : [],
        npcs: q("SELECT id, Name, ImgPath, Faction, Conversation, SpawnX, SpawnY FROM npc ORDER BY Name"),
        hasSpawns: has("npc_spawn"),
        npcSpawns: has("npc_spawn") ? q("SELECT id, NPC, X, Y FROM npc_spawn ORDER BY NPC, id") : [],
        hasRoutineSpawn: hasRoutineCols(),
        routines: has("routine") ? q(`SELECT id, NPC, TriggerHour, Loop, ${hasRoutineCols() ? "Spawn, Speed" : "0 AS Spawn, 1 AS Speed"} FROM routine ORDER BY NPC, TriggerHour, id`) : [],
        routineNodes: has("routineNode") ? q(`SELECT id, Routine, X, Y, Position, ${hasRoutineCols() ? "Wait" : "0 AS Wait"} FROM routineNode ORDER BY Routine, Position, id`) : [],
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
      const flips = new Set(has("world_flip") ? q("SELECT X, Y FROM world_flip").map(r => r.X + "," + r.Y) : []);
      while (stmt.step()) {
        const r = stmt.get();
        const c = r[5] === 1 || r[5] === "1" || String(r[5]).toLowerCase() === "true" ? 1 : 0;
        tiles.push([r[0], r[1], s(r[2]), s(r[3]), s(r[4]), c, s(r[6]), s(r[7]), flips.has(r[0] + "," + r[1]) ? 1 : 0]);
      }
      stmt.free();
      return { strings, tiles };
    },
    save({ table, row }) {
      if (!EDITABLE.includes(table)) throw new Error("table not editable: " + table);
      if (table === "quest_def" && !has("quest_def")) throw new Error("This database has no quest_def table. Apply the questline migration first.");
      if (table === "plot" && !has("plot")) apply([PLOT_TABLE], "create plot table");
      if (table === "effects" && !has("effects")) apply([EFFECT_TABLE], "create effects table");
      if (table === "npc_notes" && !has("npc_notes")) apply([NOTES_TABLE], "create npc_notes table");
      if (table === "plot") row.Agent = +row.Agent || 0;
      if (table === "quest_def" && "Sequential" in row) row.Sequential = row.Sequential ? 1 : 0;
      if (table === "quest_daily_pool" && !hasDaily()) throw new Error("This db has no daily quests yet: use Enable daily quests in this db first");
      if (table === "quest_def" && cols("quest_def").includes("Daily")) {
        // As the API's editor: a save without Daily (the Quests tab form)
        // keeps the quest's current value instead of resetting it to 0.
        if (!("Daily" in row)) { const cur = +row.id > 0 ? q("SELECT IFNULL(Daily, 0) AS d FROM quest_def WHERE id = ?", [+row.id])[0] : null; row.Daily = cur ? cur.d : 0; }
        row.Daily = +row.Daily ? 1 : 0;
      }
      if (table === "quest_def" && hasDialogue()) {
        // As the API's editor: a save without the dialogue columns (the Quests
        // tab form, an old client) keeps what the quest has.
        const cur = +row.id > 0 ? q("SELECT * FROM quest_def WHERE id = ?", [+row.id])[0] : null;
        for (const c of DIALOGUE_COLS) if (!(c in row)) row[c] = cur && cur[c] != null ? cur[c] : c === "Replies" ? "{}" : "";
        for (const c of DIALOGUE_COLS) row[c] = String(row[c] ?? (c === "Replies" ? "{}" : ""));
      }
      if (table === "npc_spawn") {
        if (!has("npc_spawn")) api.spawnsEnable();
        row.NPC = Math.trunc(+row.NPC); row.X = Math.round(+row.X); row.Y = Math.round(+row.Y);
        if (!q("SELECT 1 FROM npc WHERE id = ?", [row.NPC]).length) throw new Error("no NPC " + row.NPC);
        if (!isFinite(row.X) || !isFinite(row.Y)) throw new Error("a placement needs a whole-tile X and Y");
      }
      const allowed = cols(table);
      for (const k of Object.keys(row)) if (!allowed.includes(k)) throw new Error(`${table} has no column ${k}`);
      // A save never resets a column it doesn't send (Daily, Sequential, the
      // dialogue columns, anything newer than this editor): they keep the
      // row's current value.
      const prev = +row.id > 0 ? q(`SELECT * FROM ${table} WHERE id = ?`, [+row.id])[0] : null;
      if (prev) for (const c of allowed) if (!(c in row) && prev[c] !== undefined) row[c] = prev[c];
      let id = +row.id || 0;
      if (id <= 0) {
        id = q(`SELECT IFNULL(MAX(id),0)+1 AS n FROM ${table}`)[0].n;
        if ((table === "quest_def" || table === "npc" || table === "quest_daily_pool") && id < 1700) id = 1700;
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
      if (table === "npc_spawn") stmts.push(mirrorSpawn(row.NPC), ...(prev && +prev.NPC !== row.NPC ? [mirrorSpawn(prev.NPC)] : []));
      if (table === "npc" && has("npc_spawn") && "SpawnX" in row) {
        // An old-style move (SpawnX/SpawnY: the NPCs tab, Quest Studio's
        // "Lives at") moves the first placement, or makes one.
        const first = q("SELECT id, X, Y FROM npc_spawn WHERE NPC = ? ORDER BY id LIMIT 1", [id])[0];
        const x = Math.round(+row.SpawnX), y = Math.round(+row.SpawnY);
        if (first && (first.X !== x || first.Y !== y)) stmts.push(x > -999 ? `UPDATE npc_spawn SET X = ${x}, Y = ${y} WHERE id = ${first.id};` : `DELETE FROM npc_spawn WHERE id = ${first.id};`, mirrorSpawn(id));
        else if (!first && x > -999) stmts.push(`INSERT INTO npc_spawn (NPC, X, Y) VALUES (${id}, ${x}, ${y});`);
      }
      apply(stmts, `save ${table} ${id}`);
      return { id };
    },
    delete({ table, id }) {
      if (!EDITABLE.includes(table) || !(id > 0)) throw new Error("bad delete");
      const s = [`DELETE FROM ${table} WHERE id = ${+id};`];
      if (table === "npc") s.push(`DELETE FROM routineNode WHERE Routine IN (SELECT id FROM routine WHERE NPC = ${+id});`, `DELETE FROM routine WHERE NPC = ${+id};`);
      if (table === "npc" && has("npc_spawn")) s.push(`DELETE FROM npc_spawn WHERE NPC = ${+id};`);
      if (table === "npc_spawn") {
        const sp = q("SELECT NPC FROM npc_spawn WHERE id = ?", [+id])[0];
        if (sp && hasRoutineCols()) {
          // its routines go with it (the first placement's are Spawn 0)
          const first = q("SELECT id FROM npc_spawn WHERE NPC = ? ORDER BY id LIMIT 1", [sp.NPC])[0];
          const which = `NPC = ${+sp.NPC} AND (Spawn = ${+id}${first && first.id === +id ? " OR Spawn = 0" : ""})`;
          s.push(`DELETE FROM routineNode WHERE Routine IN (SELECT id FROM routine WHERE ${which});`, `DELETE FROM routine WHERE ${which};`);
        }
        if (sp) s.push(mirrorSpawn(sp.NPC));
      }
      if (table === "items") s.push(`DELETE FROM loot WHERE ItemID = ${+id};`);
      if (table === "effects") {
        const users = effectUsers(+id);
        if (users.length) throw new Error(`used by ${users.join(", ")}: remove it from their patterns first`);
      }
      if (table === "enemies") {
        const e = q("SELECT Name FROM enemies WHERE id = ?", [+id])[0];
        const placed = e ? q("SELECT COUNT(*) AS n FROM world WHERE Enemy = ?", [e.Name])[0].n : 0;
        if (placed) throw new Error(`${e.Name} is placed on ${placed} map tile(s): clear those spawns first (Map > Select)`);
        const spawners = spawnUsers(+id);
        if (spawners.length) throw new Error(`${e.Name} is spawned by ${spawners.join(", ")}: remove those spawn primitives first`);
        s.push(`DELETE FROM loot WHERE EnemyID = ${+id};`, `DELETE FROM enemySpells WHERE EnemyID = ${+id};`, PATTERN_TABLE, `DELETE FROM boss_patterns WHERE EnemyID = ${+id};`);
      }
      apply(s, `delete ${table} ${id}`);
      return { ok: true };
    },
    // Replace an enemy's boss_patterns with one row holding these primitives
    // (any BQSim.KINDS primitive). Keeps the enemy's lowest existing row id.
    patterns({ enemyId, actions }) {
      enemyId = Math.trunc(+enemyId);
      if (!(enemyId > 0) || !q("SELECT 1 FROM enemies WHERE id = ?", [enemyId]).length) throw new Error("save the enemy first");
      const clean = actions.map(BQSim.clean);
      clean.forEach(BQSim.validate);
      clean.forEach((a, i) => { if (a.do === "spawn" && !q("SELECT 1 FROM enemies WHERE id = ?", [a.enemy]).length) throw new Error(`primitive ${i + 1}: no enemy ${a.enemy} to spawn`); });
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
      let flipTable = has("world_flip");
      for (const p of patches) {
        const sets = [];
        for (const [k, v] of Object.entries(p.Set)) {
          if (k === "Flip") {
            // Not a world column: the world_flip layer (see WORLD_FLIP_TABLE).
            const x = Math.trunc(p.X), y = Math.trunc(p.Y);
            if (!flipTable) { s.push(WORLD_FLIP_TABLE); flipTable = true; }
            s.push(v ? `INSERT OR IGNORE INTO world_flip (X, Y) VALUES (${x}, ${y});` : `DELETE FROM world_flip WHERE X = ${x} AND Y = ${y};`);
            continue;
          }
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
      let schema = plots ? "-- plot table with the Agent column (as content/migrations/2026-10-19-plot-agents.sql)\n" + PLOT_UPGRADE.join("\n") + "\n" : "";
      if (st.enemiesUpgraded || st.changes.some(c => /INTO enemies\b/.test(c)))
        schema += "-- enemies.KnockbackResist, HitEffect, SpawnsDay and SpawnsNight (as content/migrations/2026-10-20-boss-knockback.sql, 2026-10-22-hit-effects.sql and 2026-10-25-day-night-spawns.sql)\n" + ENEMY_KB_UPGRADE.join("\n") + "\n";
      if (st.changes.some(c => /\bworld_flip\b/.test(c))) schema += "-- world_flip table (as content/migrations/2026-10-25-world-flip.sql)\n" + WORLD_FLIP_TABLE + "\n";
      if (st.changes.some(c => /\barea(_tiles|s)\b/.test(c))) schema += "-- areas tables (as content/migrations/2026-10-24-areas.sql)\n" + AREA_TABLES.join("\n") + "\n";
      const daily = hasDaily(), dialogue = hasDialogue();
      if (dialogue && (st.dialogueUpgraded || st.dailyUpgraded || st.questsUpgraded || st.changes.some(c => /INTO quest_def\b|\bquest_daily_pool\b/.test(c))))
        schema += "-- quest_def.Sequential, Daily, OfferTree, AcceptTree, ProgressTree, CompleteTree and Replies, and the quest_daily_pool table (as content/migrations/2026-10-24-quest-sequential.sql, 2026-10-26-daily-quests.sql and 2026-10-26-quest-dialogue.sql; keeps every column's values)\n" + QUEST_DIALOGUE_UPGRADE.join("\n") + "\n";
      else if (daily && (st.dailyUpgraded || st.questsUpgraded || st.changes.some(c => /INTO quest_def\b|\bquest_daily_pool\b/.test(c))))
        schema += "-- quest_def.Sequential and Daily, and the quest_daily_pool table (as content/migrations/2026-10-24-quest-sequential.sql and 2026-10-26-daily-quests.sql; keeps both columns' values)\n" + QUEST_DAILY_UPGRADE.join("\n") + "\n";
      else if (st.questsUpgraded || st.changes.some(c => /INTO quest_def\b/.test(c)))
        schema += "-- quest_def.Sequential (as content/migrations/2026-10-24-quest-sequential.sql)\n" + QUEST_SEQ_UPGRADE.join("\n") + "\n";
      return { sql: head + schema + st.changes.join("\n") + (st.changes.length ? "\n" : "") + "COMMIT;\n" };
    },
    clearExport() { st.changes = []; return { ok: true }; },
    // One tap: the API's daily quests migration on this copy.
    dailyEnable() {
      if (!has("quest_def")) throw new Error("This database has no quest_def table. Apply the questline migration first.");
      if (!cols("quest_def").includes("Sequential")) apply(QUEST_SEQ_UPGRADE, "quest_def.Sequential (as content/migrations/2026-10-24-quest-sequential.sql)");
      apply(DAILY_MIGRATION, "daily quests (as content/migrations/2026-10-26-daily-quests.sql)");
      st.dailyUpgraded = true;
      return { ok: true };
    },
    // One tap: the API's quest conversations migration (which needs daily
    // quests first, as the API's migrations are ordered).
    dialogueEnable() {
      if (!has("quest_def")) throw new Error("This database has no quest_def table. Apply the questline migration first.");
      if (!hasDaily()) api.dailyEnable();
      if (!hasDialogue()) apply(DIALOGUE_MIGRATION, "quest conversations (as content/migrations/2026-10-26-quest-dialogue.sql)");
      st.dialogueUpgraded = true;
      return { ok: true };
    },
    // Routines on this copy (the API's 2026-10-27-routine-placements.sql);
    // done by itself on the first routine saved.
    routinesEnable() {
      if (!hasRoutineCols()) apply(ROUTINE_MIGRATION, "npc routines per placement (as content/migrations/2026-10-27-routine-placements.sql)");
      return { ok: true };
    },
    // Every walk one placement does, replaced in one change:
    // { npc, spawn (npc_spawn id; 0 = the NPC's first placement), routines:
    // [{ id?, TriggerHour 1-24, Loop 0|1|2, Speed, nodes: [{ id?, X, Y, Wait }] }] }.
    // Rows keep their ids where given, so an edit only changes what changed.
    routineSet({ npc, spawn, routines }) {
      npc = Math.trunc(+npc); spawn = Math.trunc(+spawn) || 0;
      if (!q("SELECT 1 FROM npc WHERE id = ?", [npc]).length) throw new Error("no NPC " + npc);
      const pre = [];
      if (!has("routine") || !has("routineNode") || !hasRoutineCols()) pre.push(...ROUTINE_MIGRATION);
      const first = has("npc_spawn") ? q("SELECT id FROM npc_spawn WHERE NPC = ? ORDER BY id LIMIT 1", [npc])[0] : null;
      if (spawn && has("npc_spawn") && !q("SELECT 1 FROM npc_spawn WHERE id = ? AND NPC = ?", [spawn, npc]).length) throw new Error(`placement ${spawn} isn't one of NPC ${npc}'s`);
      // the first placement keeps Spawn 0 (as every routine before placements)
      const isFirst = !spawn || (first && first.id === spawn);
      const store = isFirst ? 0 : spawn;
      const which = `NPC = ${npc} AND (Spawn = ${store}${isFirst && first ? " OR Spawn = " + first.id : ""})`;
      const stmts = [...pre];
      const curR = pre.length ? (has("routine") ? q(`SELECT id FROM routine WHERE NPC = ? ${spawn && !isFirst ? "AND 0" : ""}`, [npc]) : []) : q(`SELECT id FROM routine WHERE ${which}`);
      const curIds = new Set(curR.map(r => r.id));
      stmts.push(`DELETE FROM routineNode WHERE Routine IN (SELECT id FROM routine WHERE ${which});`, `DELETE FROM routine WHERE ${which};`);
      let nextR = has("routine") ? q("SELECT IFNULL(MAX(id),0) AS n FROM routine")[0].n : 0;
      let nextN = has("routineNode") ? q("SELECT IFNULL(MAX(id),0) AS n FROM routineNode")[0].n : 0;
      const usedR = new Set(), usedN = new Set();
      const taken = (t, id) => has(t) && q(`SELECT 1 FROM ${t} WHERE id = ?`, [id]).length;
      const nodeOwner = id => (has("routineNode") ? q("SELECT Routine FROM routineNode WHERE id = ?", [id])[0] : null);
      const ids = [];
      for (const r of routines || []) {
        const hour = Math.trunc(+r.TriggerHour);
        if (!(hour >= 1 && hour <= 24)) throw new Error("a walk starts at an hour from 1 to 24 (24 is midnight)");
        const loop = Math.trunc(+r.Loop || 0);
        if (![0, 1, 2].includes(loop)) throw new Error("Loop is 0 (once), 1 (repeat) or 2 (there and back)");
        const speed = r.Speed === undefined || r.Speed === "" ? 1 : +r.Speed;
        if (!(speed > 0 && speed <= 4)) throw new Error("speed is more than 0 and at most 4 tiles a second");
        let rid = Math.trunc(+r.id || 0);
        if (!(rid > 0) || usedR.has(rid) || (taken("routine", rid) && !curIds.has(rid))) rid = ++nextR;
        nextR = Math.max(nextR, rid); usedR.add(rid); ids.push(rid);
        stmts.push(`INSERT INTO routine (id, NPC, TriggerHour, Loop, Spawn, Speed) VALUES (${rid}, ${npc}, ${hour}, ${loop}, ${store}, ${lit(speed)});`);
        (r.nodes || []).forEach((p, i) => {
          const x = Math.round(+p.X), y = Math.round(+p.Y), wait = Math.max(0, Math.min(3600, Math.round(+p.Wait || 0)));
          if (!isFinite(x) || !isFinite(y)) throw new Error("a point needs a whole-tile X and Y");
          let nid = Math.trunc(+p.id || 0);
          const own = nid > 0 ? nodeOwner(nid) : null;
          if (!(nid > 0) || usedN.has(nid) || (own && !curIds.has(own.Routine))) nid = ++nextN;
          nextN = Math.max(nextN, nid); usedN.add(nid);
          stmts.push(`INSERT INTO routineNode (id, Routine, X, Y, Position, Wait) VALUES (${nid}, ${rid}, ${x}, ${y}, ${i + 1}, ${wait});`);
        });
      }
      apply(stmts, `routine of NPC ${npc}` + (store ? ` at placement ${store}` : ""));
      return { ids };
    },
    // NPC placements on this copy (the API's 2026-10-27-npc-spawns.sql);
    // done by itself on the first placement saved.
    spawnsEnable() {
      if (!has("npc_spawn")) apply(SPAWN_MIGRATION, "npc placements (as content/migrations/2026-10-27-npc-spawns.sql)");
      return { ok: true };
    },
    // Several rows in one change (one undo step in Quest Studio).
    saveMany(list) {
      const ids = [];
      for (const it of list) ids.push(it.delete ? api.delete(it).ok && it.id : api.save(it).id);
      return { ids };
    },
    // ---- areas
    areas() {
      if (!has("areas") || !has("area_tiles")) return { missing: true, areas: [], tiles: [] };
      return { missing: false,
        areas: q("SELECT id, Name, Interior, Weather, Reverb, ReverbWet, ReverbDry, Ambient, AmbientVol, Light, Priority FROM areas ORDER BY id"),
        tiles: q("SELECT X, Y, AreaID FROM area_tiles").map(r => [r.X, r.Y, r.AreaID]) };
    },
    areasCreate() { apply(AREA_TABLES, "areas tables (as content/migrations/2026-10-24-areas.sql)"); return { ok: true }; },
    areaSave(row) {
      if (!has("areas")) apply(AREA_TABLES, "areas tables (as content/migrations/2026-10-24-areas.sql)");
      const name = String(row.Name || "").trim();
      if (!name) throw new Error("An area needs a name");
      const n = (v, d, lo, hi) => { v = v === "" || v == null ? d : +v; if (!isFinite(v)) v = d; return Math.min(hi, Math.max(lo, v)); };
      const r = { Name: name, Interior: INTERIORS.includes(row.Interior) ? row.Interior : "none", Weather: row.Weather ? 1 : 0,
        Reverb: REVERBS.includes(row.Reverb) ? row.Reverb : "none", ReverbWet: n(row.ReverbWet, 0.5, 0, 1), ReverbDry: n(row.ReverbDry, 1, 0, 1),
        Ambient: String(row.Ambient || ""), AmbientVol: n(row.AmbientVol, 0.5, 0, 1),
        Light: row.Light === null || row.Light === undefined || row.Light === "" ? null : n(row.Light, 1, 0, 2), Priority: Math.trunc(n(row.Priority, 0, -100, 100)) };
      let id = Math.trunc(+row.id || 0);
      if (!id) id = (q("SELECT IFNULL(MAX(id), 0) + 1 AS n FROM areas")[0].n);
      const lv = v => v === null ? "NULL" : lit(v);
      apply([`INSERT OR REPLACE INTO areas (id, Name, Interior, Weather, Reverb, ReverbWet, ReverbDry, Ambient, AmbientVol, Light, Priority) VALUES (${id}, ${lit(r.Name)}, ${lit(r.Interior)}, ${r.Weather}, ${lit(r.Reverb)}, ${r.ReverbWet}, ${r.ReverbDry}, ${lit(r.Ambient)}, ${r.AmbientVol}, ${lv(r.Light)}, ${r.Priority});`],
        `area ${id} ${r.Name}`);
      return { id };
    },
    areaDelete(id) {
      id = Math.trunc(+id);
      apply([`DELETE FROM area_tiles WHERE AreaID = ${id};`, `DELETE FROM areas WHERE id = ${id};`], `area ${id} deleted`);
      return { ok: true };
    },
    // [{X, Y, AreaID}]: AreaID 0 unpaints the tile.
    areaTiles(patches) {
      if (!has("area_tiles")) apply(AREA_TABLES, "areas tables (as content/migrations/2026-10-24-areas.sql)");
      if (patches.length > 20000) throw new Error("too many tiles in one save");
      const known = new Set(q("SELECT id FROM areas").map(r => r.id));
      const s = [];
      for (const p of patches) {
        const x = Math.trunc(p.X), y = Math.trunc(p.Y), a = Math.trunc(+p.AreaID || 0);
        if (!a) s.push(`DELETE FROM area_tiles WHERE X = ${x} AND Y = ${y};`);
        else if (!known.has(a)) throw new Error("unknown area " + a);
        else s.push(`INSERT OR REPLACE INTO area_tiles (X, Y, AreaID) VALUES (${x}, ${y}, ${a});`);
      }
      if (s.length) apply(s, `area tiles x${patches.length}`);
      return { tiles: patches.length };
    },
    // Clear dialogue node portrait overrides (ids); with from, only nodes that
    // still hold that image. The node then shows the speaking NPC's sprite.
    portraits({ ids, from }) {
      const list = (ids || []).map(Math.trunc).filter(i => i > 0);
      if (!list.length) return { n: 0 };
      apply([`UPDATE conversation SET ImgPath = '' WHERE id IN (${list.join(", ")})` + (from ? ` AND ImgPath = ${lit(from)}` : "") + ";"], `dialogue portraits follow the NPC sprite (${list.length} node(s))`);
      return { n: list.length };
    },
  };

  return {
    init, open, api, st, has: () => !!db, effectUsers: id => effectUsers(id), HIT_EFFECTS,
    bytes: () => db.export(),
    // Read-only helpers for the history, GitHub and check modules.
    query: (sql, params) => q(sql, params),
    // Run fn(q) on a throwaway copy opened from bytes (not the open db).
    async withBytes(bytes, fn) {
      await init();
      const tmp = new SQL.Database(new Uint8Array(bytes));
      const tq = (sql, params) => { const s = tmp.prepare(sql); const out = []; if (params) s.bind(params); while (s.step()) out.push(s.getAsObject()); s.free(); return out; };
      try { return await fn(tq); } finally { tmp.close(); }
    },
  };
})();
