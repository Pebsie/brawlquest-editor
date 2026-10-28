// node tests/balance.test.mjs : balance.js does the server's combat maths.
// tests/balance-cases.json is a copy of the API's testdata/balance_cases.json,
// written by the Go functions themselves (TestBalanceCases in the API keeps it
// honest). If this fails after an API change, copy the file across and update
// balance.js to match.
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const B = require("../balance.js");
const cases = JSON.parse(readFileSync(new URL("./balance-cases.json", import.meta.url)));
let fails = 0; const ok = (c, m) => { if (!c) { console.log("FAIL: " + m); fails++; } };
for (const [k, v] of Object.entries(cases.constants)) ok(B.C[k] === v, `constant ${k}: ${B.C[k]} vs ${v}`);
for (const [w, s, o, d] of cases.melee) ok(B.meleeHitDamage(w, s, o) === d, `melee ${w} STR ${s} ${o}: ${B.meleeHitDamage(w, s, o)} vs ${d}`);
for (const [a, ar, boss, ex, d] of cases.mitigate) ok(B.mitigateArmor(a, ar, B.armorK(a, boss, ex)) === d, `mitigate ATK ${a} armour ${ar} boss ${boss} exotic ${ex}: ${B.mitigateArmor(a, ar, B.armorK(a, boss, ex))} vs ${d}`);
for (const [sta, str, o, l, hp] of cases.maxHP) ok(B.maxHP(sta, str, o, l) === hp, `maxHP ${sta}/${str} ${o} level ${l}: ${B.maxHP(sta, str, o, l)} vs ${hp}`);
for (const [xp, l, got] of cases.killXP) ok(B.killXP(xp, l) === got, `kill XP ${xp} at ${l}: ${B.killXP(xp, l)} vs ${got}`);
for (const [l, cp] of cases.charPoints) ok(B.charPoints(l) === cp, `character points at ${l}: ${B.charPoints(l)} vs ${cp}`);
for (const [as, r, t] of cases.strikeTicks) ok(B.strikeTicks(as, r) === t, `strike ticks speed ${as} range ${r}`);
// The model on a tiny catalogue.
const c = { items: [
  { id: 1, Name: "Long Stick", Type: "wep", Val: "1", Worth: 1 }, { id: 2, Name: "Brown Trousers", Type: "arm_legs", Val: "1", Worth: 1 },
  { id: 3, Name: "Green Shirt", Type: "arm_chest", Val: "1", Worth: 1 }, { id: 41, Name: "Longsword", Type: "wep", Val: "13", Worth: 10 },
  { id: 90, Name: "Guardian's Staff", Type: "wep", Val: "45", Worth: 5 }, { id: 39, Name: "Iron Chestplate", Type: "arm_chest", Val: "50", Worth: 10 }],
  loot: [{ EnemyID: 9, ItemID: 39 }, { EnemyID: 9, ItemID: 90 }], crafts: [{ ItemID: 41 }], enemies: [{ id: 9, Name: "Tank" }],
  quests: [{ Title: "Rats", Level: 4, Zone: "Farm", Steps: JSON.stringify([{ Type: "kill", Target: "Rat", Count: 5 }]), Rewards: "[]" }, { Title: "Other", Level: 6, Zone: "Farm", Steps: "[]", Rewards: "[]" }] };
const p1 = B.player(c, 1), p10 = B.player(c, 10);
ok(p1.gear.wep.Name === "Long Stick" && p1.hp === 100 + 10 + 5 && p1.armour === 2, "level 1: starting kit, 115 HP " + JSON.stringify([p1.hp, p1.armour]));
ok(p10.gear.wep.Name === "Longsword" && p10.gear.chest.Name === "Iron Chestplate", "level 10: Longsword and Iron Chestplate, never the staff");
ok(B.player(c, 10, { behind: 5 }).gear.wep.Name === "Long Stick", "five levels behind: still the stick");
const rat = { Name: "Rat", HP: 20, ATK: 3, XP: 10, CanMove: 1, AttackSpeed: 1, Range: 1 };
const f = B.fight(p1, rat);
ok(f.swings === Math.ceil(20 / (p1.hit * 1.2)) && Math.abs(f.ttk - f.swings / 2) < 1e-9, "swings and seconds");
ok(f.xp === 10 && f.killsPerLevel === 40, "XP 10 at level 1: 40 kills a level");
ok(B.fight(p1, rat, { pack: 3 }).taken === f.taken * 6, "a pack of 3 costs 1+2+3 times one");
ok(B.fight(p1, { ...rat, CanMove: 0, HP: 6 }).swings === 6, "stationary things lose 1 a swing");
const st = B.stageOf(c, rat, { Rat: ["Farm"] });
ok(st[0].from === "quests" && st[0].level === 4 && st[1].from === "map" && st[1].level === 4, "stage from quests and from the map " + JSON.stringify(st));
const br = B.bandRanges(p10, rat);
ok(br.length === 5 && br.every((b, i) => i === 0 || b.hp[0] >= br[i - 1].hp[0]) && br[1].atk[1] > br[1].atk[0], "bands rise");
ok(B.bandOf(B.fight(p10, { ...rat, HP: br[1].hp[0] + 1, ATK: br[1].atk[0] }), false).id === "fair", "a mob made from the Fair band reads as Fair");
ok(B.mobSpeed(0) === 1 && B.mobSpeed(99) === 6 && B.speedWords(3) === "keeps up with a walk, a sprint gets away", "speed clamp and words");
console.log(fails ? `${fails} failed` : "balance: all ok");
process.exitCode = fails ? 1 : 0;
