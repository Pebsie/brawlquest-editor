// node tests/mobsim.test.cjs : the preview simulator matches the API's rules
// (same cases as the Go zone_script_test.go).
const S = require("../mobsim.js");
let fails = 0; const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const run = (pats, secs, o = {}) => { const st = S.create({ boss: { x: 5, y: 10, w: 1, h: 1 }, player: { x: 10, y: 10 }, patterns: pats, ...o }); for (let i = 0; i < secs * S.TPS; i++) S.step(st); return st; };
let st = run([{ every: 2, do: "zone", tile: true, radius: .5, maxRadius: .5, windup: 2, once: true, damage: 40, duration: 1 }], 1);
ok(st.zones.length === 1 && !S.scripted(st.patterns[0]), "old row: one plain zone");
st = run([{ every: 2, do: "zone", tile: true, radius: .5, maxRadius: .5, windup: 2, once: true, damage: 40, duration: 1 }], 4);
ok(st.damage === 80, "wraith: 40 every 2s after windup (" + st.damage + ")");
st = run([{ every: 5, do: "zone", count: 8, formation: "ring", spacing: 3, radius: 1, maxRadius: 1 }], 1);
ok(st.zones.length === 8 && st.zones.every(z => near(Math.hypot(z.x - 10, z.y - 10), 3)) && st.hits === 0, "ring of 8, centre safe");
st = run([{ do: "zone", count: 3, formation: "line", anchor: "boss", aim: true, spacing: 2 }], 1);
ok(st.zones.map(z => z.x).join() === "7,9,11", "aimed line from boss");
st = run([{ do: "zone", move: "dir", angle: 90, speed: 4, duration: 9 }], 2);
ok(near(st.zones[0].y, 14.2), "dir move 4 t/s: cast tick + 20 ticks, as the server loop (" + st.zones[0].y + ")");
st = run([{ do: "zone", formation: "list", offsets: [[0, 0], [1, 0], [2, 0]], delay: 1, stagger: 2, duration: 9 }], 1);
ok(st.zones.map(z => z.delay).join() === "0,2,4" && st.hits === 1, "stagger delays and first lands");
console.log(JSON.stringify(S.clean({ every: 3, do: "zone", target: "aggro", radius: .75, damage: 15, duration: 4 })));
ok(JSON.stringify(S.clean({ every: 3, do: "zone", target: "aggro", radius: .75, damage: 15, duration: 4 })) === '{"every":3,"do":"zone","target":"aggro","radius":0.75,"damage":15,"duration":4}', "clean keeps old rows identical");
// Projectile + effects, as the Go TestProjectile* / TestEffect* cases.
const web = { 1: { id: 1, Name: "Webbed Up", Duration: 3, Stacking: "refresh", MaxStacks: 1, Modifiers: '[{"type":"move_speed","mult":0.5}]', Visual: "web" } };
st = run([{ every: 5, do: "projectile", cast: 0.5, speed: 10, range: 8, radius: 0.3, damage: 3, effect: 1, visual: "web" }], 1.5, { effects: web });
ok(st.shots.length === 1 && st.casts.length === 0, "cast at 1s, fired 0.5s later");
st = run([{ every: 5, do: "projectile", cast: 0.5, speed: 10, range: 8, radius: 0.3, damage: 3, effect: 1, visual: "web" }], 2.5, { effects: web });
ok(st.damage === 3 && S.moveMult(st) === 0.5 && st.effects[0].left > 2, "web hits: 3 damage and Webbed Up (x0.5)");
st = run([{ every: 5, do: "projectile", effect: 1, range: 8 }], 6, { effects: web });
ok(st.effects.length === 0 && S.moveMult(st) === 1, "Webbed Up expires after 3s");
st = run([{ every: 5, do: "projectile", effect: 1, range: 3 }], 2, { effects: web });
ok(st.casts.length === 0 && st.shots.length === 0 && st.hits === 0, "target out of range: no cast");
st = run([{ every: 9, do: "projectile", count: 3, spread: 20, range: 8, speed: 1 }], 1.6, { effects: web });
ok(st.shots.length === 3 && Math.abs(st.shots[0].dy + st.shots[2].dy) < 1e-9, "fan of 3 symmetric about the aim");
const dot = { 2: { Duration: 2, Stacking: "stack", MaxStacks: 3, Modifiers: [{ type: "dot", damage: 4, every: 1 }] } };
const s2 = S.create({ boss: { x: 0, y: 0 }, player: { x: 4, y: 0 }, patterns: [], effects: dot });
S.applyEffect(s2, 2); S.applyEffect(s2, 2);
for (let i = 0; i < 20; i++) S.step(s2);
ok(s2.damage === 8 && s2.effects[0].stacks === 2, "dot x2 stacks after 1s");
ok(JSON.stringify(S.clean({ every: 5, do: "projectile", target: "target", cast: 0.6, speed: 7, range: 5, radius: 0.3, effect: 1, visual: "web", duration: 4, maxRadius: 2 })) ===
  '{"every":5,"do":"projectile","target":"target","cast":0.6,"speed":7,"range":5,"radius":0.3,"effect":1,"visual":"web"}', "clean projectile = migration JSON (zone keys dropped)");
process.exit(fails ? 1 : 0);
