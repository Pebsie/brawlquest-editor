// The Skills tab: its db layer (tables created on first save, text keys, ids),
// the rules in skills.js, the retraining/points helpers, and the shipped trees.
// Run: node tests/skills.mjs path/to/bq-content.db
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url).pathname;
process.chdir(ROOT);
globalThis.initSqlJs = require(ROOT + "vendor/sql-wasm.js");
const BQ = new Function(readFileSync(ROOT + "db.js", "utf8") + "\nreturn BQ;")();
const SK = new Function(readFileSync(ROOT + "skills.js", "utf8") + "\nreturn { skillIssues, skillTreeCost, skillPointsAt, skillRequires, SKILL_TREES };")();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
await BQ.open(readFileSync(process.argv[2]), "t.db");

let t = BQ.api.loreTables();
ok(t.skill_node.exists, "the db has the skill tables (apply 2026-11-10-skilltree.sql first)");
const nodes = t.skill_node.rows, curve = t.skill_points.rows;
const effectIds = new Set(BQ.api.content().effects.map(e => +e.id));

// the shipped content is clean and meets the plan
const issues = SK.skillIssues(nodes, effectIds);
ok(issues.length === 0, "shipped trees have no problems: " + issues.map(i => i.text).join("; "));
for (const tree of ["Warrior Order", "Mage Order", "Stoic Order"]) {
  const tn = nodes.filter(n => n.Tree === tree);
  ok(tn.length >= 12 && tn.length <= 18, tree + " has 12-18 nodes (" + tn.length + ")");
  ok(tn.filter(n => n.Kind === "active").length >= 4, tree + " has 4+ abilities");
  ok(SK.skillTreeCost(nodes, tree) > SK.skillPointsAt(40, curve) * 0.7, tree + " tree is not trivially small");
  ok(SK.skillTreeCost(nodes, tree) >= SK.skillPointsAt(40, curve), tree + " costs at least what level 40 buys, so there is a choice");
}
ok(nodes.some(n => n.Tree === "None"), "None has a tree");
ok(SK.skillPointsAt(1, curve) === 0 && SK.skillPointsAt(10, curve) === 9 && SK.skillPointsAt(25, curve) === 9 + 30 && SK.skillPointsAt(40, curve) === 9 + 30 + 45, "curve: 1 a level to 10, 2 to 25, 3 to 40 (84)");

// the rules catch what would go wrong
const good = nodes.find(n => n.Kind === "active");
const bad = (patch, re) => {
  const c = nodes.filter(n => n !== good).concat([{ ...good, ...patch }]);
  const out = SK.skillIssues(c, effectIds).filter(i => i.id === +good.id).map(i => i.text).join("|");
  ok(re.test(out), `rule: ${JSON.stringify(patch).slice(0, 50)} -> ${out}`);
};
bad({ Requires: "99999" }, /does not exist/);
bad({ Requires: String(nodes.find(n => n.Tree !== good.Tree).id) }, /another tree/);
bad({ Cost: 0 }, /Cost/);
bad({ Mods: "{" }, /not valid JSON/);
bad({ Mods: '{"LUCK":3}' }, /unknown stat/);
bad({ Ability: '{"type":"cone","cd":0,"dmg":1}' }, /cooldown/);
bad({ Ability: '{"type":"dash","cd":4,"dmg":1}' }, /distance/);
bad({ Ability: '{"type":"cone","cd":4,"dmg":1,"effect":55555}' }, /Effects tab/);
bad({ Kind: "passive" }, /passive uses Mods/);

// db layer: ids and text keys
const r = BQ.api.loreSave({ table: "skill_node", row: { id: 999, Tree: "None", Branch: "Test", Name: "It's a test", Desc: "", Icon: "fist", Tier: "1", Col: "1", Kind: "passive", MaxRank: "2", Cost: "1", ReqLevel: "2", ReqBranch: "0", Requires: "", Mods: '{"STR":1}', Ability: "{}" } });
ok(r.id === 999, "node saved under its id");
ok(BQ.api.loreTables().skill_node.rows.some(x => x.id === 999 && x.Name === "It's a test" && x.MaxRank === 2), "quote safe, numbers coerced");
BQ.api.loreSave({ table: "skill_config", row: { Key: "respec_base", Value: "9" } });
ok(BQ.api.loreTables().skill_config.rows.find(x => x.Key === "respec_base").Value === 9, "text key replaces its row");
BQ.api.loreDelete({ table: "skill_config", id: "respec_base" });
ok(!BQ.api.loreTables().skill_config.rows.some(x => x.Key === "respec_base"), "text key deleted");
BQ.api.loreDelete({ table: "skill_node", id: 999 });
ok(!BQ.api.loreTables().skill_node.rows.some(x => x.id === 999), "node deleted");
BQ.api.loreSave({ table: "skill_trainer", row: { NPC: 4242 } });
ok(BQ.api.loreTables().skill_trainer.rows.some(x => x.NPC === 4242), "trainer added");
ok(/INSERT OR REPLACE INTO skill_trainer/.test(BQ.api.export().sql), "Export SQL carries it");

// effects tab validation accepts the skill effect types
const eff = { id: 0, Name: "Test Guard", Description: "", Icon: "", Visual: "", Duration: 5, Stacking: "refresh", MaxStacks: 1, Modifiers: '[{"type":"dmg_in","mult":0.7},{"type":"regen","pct":2},{"type":"counter","mult":1,"radius":2,"stun":0.5,"knock":1}]' };
let saved = true; try { BQ.api.save({ table: "effects", row: eff }); } catch (e) { saved = e.message; }
ok(saved === true, "effects accept dmg_in, regen and counter: " + saved);
let rej = false; try { BQ.api.save({ table: "effects", row: { ...eff, Modifiers: '[{"type":"dmg_in","mult":0}]' } }); } catch { rej = true; }
ok(rej, "dmg_in mult 0 is refused");

console.log(`skills: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
