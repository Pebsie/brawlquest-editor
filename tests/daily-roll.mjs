// The editor's daily roll (daily.js) against the API's own rollDaily output.
// tests/fixtures/daily-roll-gold.json was written by a throwaway Go test in
// BrawlQuest-API new-ui d8d5d64 (rollDaily, dailySeed, dropResetDay; RefID
// names stubbed as "mob#5"). Run: node tests/daily-roll.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const D = require("../daily.js");
const G = JSON.parse(readFileSync(new URL("./fixtures/daily-roll-gold.json", import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const pools = Object.fromEntries(G.cases.map(c => [c.id, c.pool.map(r => ({ id: r.ID, ...r }))]));
const strip = v => { const o = {}; for (const [k, x] of Object.entries(v)) { const y = { Text: x.Text }; if (x.Names && x.Names.length) y.Names = x.Names; if (x.Count) y.Count = x.Count; if (x.X) y.X = x.X; if (x.Y) y.Y = x.Y; if (x.Radius) y.Radius = x.Radius; o[k] = y; } return o; };
for (const g of G.rolls) {
  const mine = D.roll(g.id, pools[g.id], g.day, (k, id) => `${k}#${id}`);
  const a = JSON.stringify(strip(mine.Vals), Object.keys(strip(mine.Vals)).sort()), b = JSON.stringify(g.roll.Vals, Object.keys(g.roll.Vals).sort());
  ok(JSON.stringify(Object.entries(strip(mine.Vals)).sort()) === JSON.stringify(Object.entries(g.roll.Vals).map(([k, v]) => [k, v]).sort()) && mine.Day === g.roll.Day, `quest ${g.id} day ${g.day}: ${a} vs ${b}`);
}
for (const r of G.raw) {
  const [k, s, n1, n2] = r.split(":");
  const st = D.seed(20389, 9001, k);
  // Go evaluates the two next() calls before reading the state (s), so s is
  // the state after them.
  ok(String(D.next(st)) === n1 && String(D.next(st)) === n2 && String(st.s) === s, "seed " + k);
}
for (const d of G.days) {
  const [when, n] = d.split("=");
  const [Y, Mo, Dd, h, mi, s] = when.match(/\d+/g).map(Number);
  ok(D.day(D.wall(Y, Mo, Dd, h, "Europe/London") + (mi * 60 + s) * 1000, "Europe/London") === +n, `loot day at ${when} London = ${n}`);
}
// resolve: the API's TestDailyResolve shape
const q = { id: 1, Title: "Cull the {mob}", Offer: "Bring down {count} {mob} today.", Steps: JSON.stringify([{ Type: "kill", Target: "{mob}", Count: "{count}", Text: "Kill {count} {mob}" }, { Type: "reach", At: "{place}", Text: "Scout {place}" }, { Type: "collect", Target: "{item}", Count: "{count2}", Text: "{count2} {item}" }]) };
const r = { Day: 1, Vals: { mob: { Text: "spiders", Names: ["Spider", "Cave Spider"] }, count: { Text: "4", Count: 4 }, place: { Text: "the well", X: 5, Y: 6, Radius: 2 } } };
const out = D.resolve(q, r);
ok(out.Title === "Cull the spiders" && out.Steps[0].Target === "Spider" && out.Steps[0].Targets[0] === "Cave Spider" && out.Steps[0].Count === 4 && out.Steps[0].Text === "Kill 4 spiders", "resolve kill");
ok(out.Steps[1].X === 5 && out.Steps[1].Y === 6 && out.Steps[1].Radius === 2 && out.Steps[1].Count === 1, "resolve place");
ok(out.Steps[2].Target === "{item}" && out.Steps[2].Count === 1 && out.Steps[2].Text === "{count2} {item}", "unknown placeholders stay, count 1");
ok(D.stepCount("7").n === 7 && D.stepCount(" {count} ").v === "{count}" && D.stepCount("lots").v === "", "Count forms");
// resolve against the API's questDef.resolve, ten days of one busy daily
// (tests/fixtures/daily-resolve-gold.json, same throwaway Go test).
const R = JSON.parse(readFileSync(new URL("./fixtures/daily-resolve-gold.json", import.meta.url)));
const rq = { ...R.quest, Steps: R.steps }, rpool = R.pool.map(r => ({ id: r.ID, ...r }));
for (const g of R.out) {
  const d = D.resolve(rq, D.roll(rq.id, rpool, g.day));
  const norm = s => ({ Type: s.Type, Target: s.Target || "", Targets: s.Targets && s.Targets.length ? s.Targets : null, NPC: s.NPC || 0, Count: s.Count || 0, X: s.X || 0, Y: s.Y || 0, Radius: s.Radius || 0, Text: s.Text || "", Hint: s.Hint || "", Line: s.Line || "" });
  const same = ["Title", "Summary", "Offer", "Accept", "Progress", "Complete"].every(k => d[k] === g[k]) && JSON.stringify(d.Steps.map(norm)) === JSON.stringify(g.Steps.map(norm));
  ok(same, `resolve day ${g.day}: ${JSON.stringify(d.Steps.map(norm))} vs ${JSON.stringify(g.Steps.map(norm))}`);
}
console.log(`daily-roll: ${pass} passed, ${fail} failed (${G.rolls.length} server rolls)`);
process.exit(fail ? 1 : 0);
