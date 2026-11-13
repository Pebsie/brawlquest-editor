// node tests/itembalance.test.mjs
// Scoring for the item Balance panel, against a small fixture plus (when
// ITEM_DB is set) the real content database.
import { createRequire } from "module";
import { spawnSync } from "child_process";
const require = createRequire(import.meta.url);
const B = require("../itembalance.js");

const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };

const items = [
  { id: 1, Name: "Long Stick", Type: "wep", Val: "1", Worth: 1, Attributes: "None", Subtype: "Light" },
  { id: 3, Name: "Green Shirt", Type: "arm_chest", Val: "1", Worth: 1, Attributes: "None", Subtype: "Light" },
  { id: 13, Name: "Bandit's Cloak", Type: "arm_head", Val: "20", Worth: 3, Attributes: "STR,10", Subtype: "Light", ImgPath: "assets/items/cloak.png" },
  { id: 35, Name: "Leather Chestplate", Type: "arm_chest", Val: "30", Worth: 5, Attributes: "None", Subtype: "Light" },
  { id: 39, Name: "Iron Chestplate", Type: "arm_chest", Val: "50", Worth: 10, Attributes: "None", Subtype: "Medium" },
  { id: 48, Name: "Guardian's Chestplate", Type: "arm_chest", Val: "70", Worth: 15, Attributes: "None", Subtype: "Heavy" },
  { id: 73, Name: "Hero's Chestplate", Type: "arm_chest", Val: "100", Worth: 25, Attributes: "None", Subtype: "Heavy" },
  { id: 102, Name: "Studded Chestplate", Type: "arm_chest", Val: "80", Worth: 25, Attributes: "STR,10", Subtype: "Medium" },
  { id: 36, Name: "Leather Helmet", Type: "arm_head", Val: "35", Worth: 5, Attributes: "None", Subtype: "Light" },
  { id: 38, Name: "Iron Helmet", Type: "arm_head", Val: "40", Worth: 10, Attributes: "None", Subtype: "Medium" },
  { id: 47, Name: "Guardian's Helmet", Type: "arm_head", Val: "50", Worth: 15, Attributes: "None", Subtype: "Heavy" },
  { id: 72, Name: "Hero's Helmet", Type: "arm_head", Val: "70", Worth: 25, Attributes: "None", Subtype: "Heavy" },
  { id: 113, Name: "Master Wizard's Cloak", Type: "arm_head", Val: "30", Worth: 40, Attributes: "INT,25", Subtype: "Light" },
  { id: 41, Name: "Longsword", Type: "wep", Val: "13", Worth: 10, Attributes: "None", Subtype: "Medium" },
  { id: 89, Name: "Guardian's Axe", Type: "wep", Val: "30", Worth: 15, Attributes: "None", Subtype: "Heavy" },
  { id: 108, Name: "Hero's Blade", Type: "wep", Val: "60", Worth: 30, Attributes: "STA,10;STR,10;INT,10", Subtype: "Heavy" },
  { id: 127, Name: "Master Blade of Fire", Type: "wep", Val: "70", Worth: 40, Attributes: "None", Subtype: "Heavy" },
  { id: 42, Name: "Pickaxe", Type: "wep", Val: "2", Worth: 3, Attributes: "None", Subtype: "Light" },
  { id: 81, Name: "Chair", Type: "furniture", Val: "true", Worth: 1, Attributes: "None", Subtype: "None" },
  { id: 32, Name: "Wooden Shield", Type: "shield", Val: "20", Worth: 3, Attributes: "None", Subtype: "Light" },
  { id: 51, Name: "Iron Shield", Type: "shield", Val: "50", Worth: 10, Attributes: "None", Subtype: "Heavy" },
  { id: 75, Name: "Hero's Shield", Type: "shield", Val: "100", Worth: 25, Attributes: "None", Subtype: "Heavy" },
];

const iron = items.find(i => i.id === 39);
const aIron = B.analyse(iron, items);
ok(aIron.suggested, "Iron Chestplate gets a suggested level");
ok(aIron.suggested && Math.abs(aIron.suggested.level - 10) <= 5, "Iron Chestplate (Val 50, Worth 10) suggests around 10, got " + (aIron.suggested && aIron.suggested.level));
ok(!aIron.far, "Iron Chestplate is not flagged as far off");
ok(aIron.nearest.every(p => p.Type === "arm_chest" && p.id !== 39), "peers for a chest piece are other chest pieces");
ok(/Val/.test(aIron.formula) && /armour|chest/i.test(aIron.formula), "formula is in plain words and mentions Val: " + aIron.formula);

const cloak = items.find(i => i.id === 13);
const aCloak = B.analyse(cloak, items);
ok(aCloak.suggested && aCloak.suggested.level >= 8, "Bandit's Cloak (Val 20 + 10 STR at required 3) suggests well above 3, got ~" + (aCloak.suggested && aCloak.suggested.level));
ok(aCloak.far && aCloak.off > 0, "Bandit's Cloak is flagged as stronger than its required level");

const wiz = items.find(i => i.id === 113);
const aWiz = B.analyse(wiz, items);
ok(aWiz.suggested && aWiz.far && aWiz.off < 0, "Master Wizard's Cloak (required 40, modest armour) is flagged as weaker than that level, suggested ~" + (aWiz.suggested && aWiz.suggested.level));

const shirt = items.find(i => i.id === 3);
const aShirt = B.analyse(shirt, items);
ok(aShirt.suggested && aShirt.suggested.level <= 4, "starter Green Shirt suggests a very low level, got ~" + (aShirt.suggested && aShirt.suggested.level));

const boosted = B.analyse({ ...iron, Val: "200", Attributes: "None" }, items);
ok(boosted.suggested.level > aIron.suggested.level, "raising Val raises the suggested level (" + aIron.suggested.level + " → " + boosted.suggested.level + ")");
ok(B.powerOf({ ...iron, Attributes: "STR,20" }, aIron.model) > B.powerOf(iron, aIron.model), "stat bonuses increase power");

const chair = B.analyse(items.find(i => i.id === 81), items);
ok(!chair.suggested && !chair.gear, "furniture has no suggested level");

const pick = B.analyse(items.find(i => i.id === 42), items);
ok(pick.tool, "a pickaxe is treated as a tool, not on the weapon curve");

const shield = B.analyse(items.find(i => i.id === 51), items);
ok(shield.suggested && Math.abs(shield.suggested.level - 10) <= 3, "Iron Shield suggests around 10, got ~" + (shield.suggested && shield.suggested.level));

// live fit against the real db, when asked
const db = process.env.ITEM_DB;
if (db) {
  const py = spawnSync("python3", ["-c", "import sqlite3,json,sys; db=sqlite3.connect(sys.argv[1]); db.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in db.execute('select * from items')]))", db], { encoding: "utf8" });
  if (py.status !== 0) { ok(false, "could not read ITEM_DB: " + py.stderr); }
  else {
    const real = JSON.parse(py.stdout);
    const a = B.analyse(real.find(i => i.id === 39), real);
    ok(a.suggested && Math.abs(a.suggested.level - 10) <= 6, "real db: Iron Chestplate suggests around 10, got ~" + (a.suggested && a.suggested.level) + (a.formula ? " — " + a.formula : ""));
    const b = B.analyse(real.find(i => i.id === 13), real);
    ok(b.suggested && b.far, "real db: Bandit's Cloak is still flagged (suggested ~" + (b.suggested && b.suggested.level) + " vs required 3)");
  }
}

if (process.exitCode) console.log("FAILED");
else console.log("all ok");
