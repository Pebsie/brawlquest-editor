// "Enable daily quests in this db" runs the API's
// content/migrations/2026-10-26-daily-quests.sql: the result must dump the
// same as that file applied with Python's sqlite3, and Export SQL must carry
// Daily and the pool rows to a server db that has neither.
// Run: node tests/daily-migration.mjs path/to/pre-daily-bq-content.db path/to/2026-10-26-daily-quests.sql
import { createRequire } from "module";
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { execFileSync } from "child_process";
const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url).pathname;
process.chdir(ROOT);
globalThis.initSqlJs = require(ROOT + "vendor/sql-wasm.js");
const load = f => new Function(readFileSync(ROOT + f, "utf8") + "\nreturn " + { "db.js": "BQ", "dump.js": "BQDump" }[f] + ";")();
const BQ = load("db.js");
const [src, mig] = process.argv.slice(2);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const py = (code, ...a) => execFileSync("python3", ["-c", code, ...a], { maxBuffer: 1 << 28 }).toString();
const DUMP = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print('\\n'.join(c.iterdump()))";
copyFileSync(src, "/tmp/qs-mig-py.db");
py("import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(open(sys.argv[2]).read())", "/tmp/qs-mig-py.db", mig);
const want = py(DUMP, "/tmp/qs-mig-py.db");
await BQ.open(readFileSync(src), "t.db");
ok(!BQ.api.content().hasDaily, "old db has no daily quests");
BQ.api.dailyEnable();
writeFileSync("/tmp/qs-mig-ed.db", BQ.bytes());
ok(py(DUMP, "/tmp/qs-mig-ed.db") === want, "editor migration dumps the same as the API's migration");
BQ.api.dailyEnable();
writeFileSync("/tmp/qs-mig-ed2.db", BQ.bytes());
ok(py(DUMP, "/tmp/qs-mig-ed2.db") === want, "second run changes nothing");
const c = BQ.api.content();
ok(c.hasDaily && c.dailyPools.length === 3 && c.quests.find(q => q.id === 9001).Daily === 1, "content() has the pool and the example daily");
// the Quests tab form saves without Daily: kept
const q = c.quests.find(q => q.id === 9001); const row = { ...q }; delete row.Daily; row.Title = "Daily Drill: {mob}!";
BQ.api.save({ table: "quest_def", row });
ok(BQ.api.content().quests.find(q => q.id === 9001).Daily === 1, "a save without Daily keeps it");
const id = BQ.api.save({ table: "quest_daily_pool", row: { id: 0, QuestID: 9001, Kind: " MOB ", Slot: 1, Name: "Wolf", Label: "", Min: 3, Max: 5, Weight: 2 } }).id;
ok(id === 1700 && BQ.api.content().dailyPools.find(r => r.id === id).Kind === "mob", "new pool row id 1700, kind cleaned");
let bad = ""; try { BQ.api.save({ table: "quest_daily_pool", row: { id: 0, QuestID: 9001, Kind: "boss" } }); } catch (e) { bad = e.message; }
ok(/Kind must be/.test(bad), "bad kind refused");
// Export SQL onto the original (pre-daily) db
const sql = BQ.api.export().sql.replace(".bail on\n", "");
copyFileSync(src, "/tmp/qs-mig-exp.db");
py("import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(open(sys.argv[2]).read())", "/tmp/qs-mig-exp.db", (writeFileSync("/tmp/qs-mig-exp.sql", sql), "/tmp/qs-mig-exp.sql"));
const got = JSON.parse(py("import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); print(json.dumps([c.execute('select Daily, Title from quest_def where id=9001').fetchone(), c.execute('select count(*) from quest_daily_pool').fetchone()[0], c.execute('select sum(Sequential) from quest_def').fetchone()[0]]))", "/tmp/qs-mig-exp.db"));
ok(got[0][0] === 1 && got[0][1] === "Daily Drill: {mob}!" && got[1] === 4, "Export SQL brings Daily, the edit and the pool rows: " + JSON.stringify(got));
console.log(`daily-migration: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
