// "Enable quest conversations in this db" runs the API's
// content/migrations/2026-10-26-quest-dialogue.sql (after the daily one): the
// result must dump the same as both files applied with Python's sqlite3.
// Run: node tests/dialogue-migration.mjs pre-daily.db daily.sql dialogue.sql
import { createRequire } from "module";
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { execFileSync } from "child_process";
const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url).pathname;
process.chdir(ROOT);
globalThis.initSqlJs = require(ROOT + "vendor/sql-wasm.js");
const BQ = new Function(readFileSync(ROOT + "db.js", "utf8") + "\nreturn BQ;")();
const [src, daily, dlg] = process.argv.slice(2);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const py = (code, ...a) => execFileSync("python3", ["-c", code, ...a], { maxBuffer: 1 << 28 }).toString();
const DUMP = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print('\\n'.join(c.iterdump()))";
const RUN = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); [c.executescript(open(f).read()) for f in sys.argv[2:]]";
copyFileSync(src, "/tmp/qs-dlg-py.db");
py(RUN, "/tmp/qs-dlg-py.db", daily, dlg);
const want = py(DUMP, "/tmp/qs-dlg-py.db");
await BQ.open(readFileSync(src), "t.db");
ok(!BQ.api.content().hasDialogue, "old db has no quest conversations");
BQ.api.dialogueEnable();
writeFileSync("/tmp/qs-dlg-ed.db", BQ.bytes());
ok(py(DUMP, "/tmp/qs-dlg-ed.db") === want, "editor enable dumps the same as the API's two migrations");
BQ.api.dialogueEnable();
writeFileSync("/tmp/qs-dlg-ed2.db", BQ.bytes());
ok(py(DUMP, "/tmp/qs-dlg-ed2.db") === want, "second run changes nothing");
const c = BQ.api.content();
const ex = c.quests.find(q => q.id === 9001);
ok(c.hasDialogue && ex.OfferTree === "q9001-offer" && ex.Replies === '{"OnIt":"Yes, Sergeant!"}', "example offer tree on 9001");
ok(c.conversations.filter(x => x.Identifier.startsWith("q9001-")).length === 3, "3 example nodes");
// a save without the dialogue columns keeps them (the Quests tab form)
const row = { ...ex }; for (const k of ["OfferTree", "AcceptTree", "ProgressTree", "CompleteTree", "Replies"]) delete row[k]; row.Title = "Daily Drill: {mob}!";
BQ.api.save({ table: "quest_def", row });
const after = BQ.api.content().quests.find(q => q.id === 9001);
ok(after.OfferTree === "q9001-offer" && after.Replies === ex.Replies, "a save without the columns keeps them");
let bad = ""; try { BQ.api.save({ table: "quest_def", row: { ...after, Replies: "{nope" } }); } catch (e) { bad = e.message; }
ok(/Replies is not valid JSON/.test(bad), "bad Replies refused");
bad = ""; try { BQ.api.save({ table: "quest_def", row: { ...after, Replies: '{"Yes":"x"}' } }); } catch (e) { bad = e.message; }
ok(/no line called Yes/.test(bad), "unknown reply refused");
// a new tree in an edit, then Export SQL onto the original db
BQ.api.save({ table: "conversation", row: { id: 0, Identifier: "q9001-extra", Title: "Hm.", ImgPath: "", Options: "[['Back.','@offer']]", ReputationChange: "", ItemsGiven: "", QuestStart: 0 } });
BQ.api.save({ table: "quest_def", row: { ...after, Replies: '{"Accept":"Count me in."}' } });
const sql = BQ.api.export().sql.replace(".bail on\n", "");
copyFileSync(src, "/tmp/qs-dlg-exp.db");
writeFileSync("/tmp/qs-dlg-exp.sql", sql);
py(RUN, "/tmp/qs-dlg-exp.db", "/tmp/qs-dlg-exp.sql");
const got = JSON.parse(py("import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); print(json.dumps([c.execute('select Daily, Title, OfferTree, Replies from quest_def where id=9001').fetchone(), c.execute(\"select count(*) from conversation where Identifier like 'q9001-extra'\").fetchone()[0]]))", "/tmp/qs-dlg-exp.db"));
ok(got[0][0] === 1 && got[0][2] === "q9001-offer" && got[0][3] === '{"Accept":"Count me in."}' && got[1] === 1, "Export SQL brings the columns, the edit and the node: " + JSON.stringify(got));
console.log(`dialogue-migration: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
