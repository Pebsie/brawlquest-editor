// The Lore tab's db layer: tables are created on first save, rows save and
// delete, ids are handed out for id-keyed tables, and Export SQL carries it.
// Run: node tests/lore-tables.mjs path/to/bq-content.db
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url).pathname;
process.chdir(ROOT);
globalThis.initSqlJs = require(ROOT + "vendor/sql-wasm.js");
const BQ = new Function(readFileSync(ROOT + "db.js", "utf8") + "\nreturn BQ;")();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
await BQ.open(readFileSync(process.argv[2]), "t.db");
let t = BQ.api.loreTables();
const hadSets = t.item_set.exists;
if (!hadSets) { ok(!t.item_set.exists && t.item_set.rows.length === 0, "a db without the tables reads as empty"); }
const r = BQ.api.loreSave({ table: "item_set", row: { id: 0, Name: "Test Set", Desc: "it's a test" } });
ok(r.id > 0, "id handed out");
t = BQ.api.loreTables();
ok(t.item_set.exists && t.item_set.rows.some(x => x.Name === "Test Set" && x.Desc === "it's a test"), "set saved, quote safe");
BQ.api.loreSave({ table: "item_set_bonus", row: { id: 0, SetID: r.id, Pieces: "2", Attributes: "STR,3", Desc: "" } });
ok(BQ.api.loreTables().item_set_bonus.rows.some(x => x.SetID === r.id && x.Pieces === 2), "bonus saved, number coerced");
BQ.api.loreSave({ table: "item_ext", row: { ItemID: 1, Sell: "7", Junk: 0, SetID: r.id, Rarity: 2 } });
BQ.api.loreSave({ table: "item_ext", row: { ItemID: 1, Sell: "9", Junk: 0, SetID: r.id, Rarity: 2 } });
const ie = BQ.api.loreTables().item_ext.rows.filter(x => x.ItemID === 1);
ok(ie.length === 1 && ie[0].Sell === 9, "keyed table replaces its row");
let threw = false; try { BQ.api.loreSave({ table: "items", row: { id: 1 } }); } catch { threw = true; }
ok(threw, "other tables are refused");
BQ.api.loreDelete({ table: "item_set", id: r.id });
ok(!BQ.api.loreTables().item_set.rows.some(x => x.id === r.id), "row deleted");
const sql = BQ.api.export().sql;
ok(/INSERT OR REPLACE INTO item_ext/.test(sql), "Export SQL carries the row");
console.log(`lore-tables: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
