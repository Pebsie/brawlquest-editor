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
process.exit(fails ? 1 : 0);
