"use strict";
// Boss-pattern simulator for the Mobs tab preview. A port of the API's
// enemies.go (runBossPatterns, spawnZone, tickZones, spawnSoak, tickSoaks) and
// zone_script.go (formations, stagger, movement): 20 ticks a second, patterns
// and damage once a second, zone movement every tick. Positions are tiles.
const BQSim = (() => {
  const TPS = 20, MAX_ZONES = 24;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const FORMATIONS = ["", "ring", "line", "spread", "list"];
  const MOVES = ["", "dir", "out", "follow", "orbit", "path"];
  const SCRIPT_KEYS = ["count", "formation", "spacing", "offsets", "anchor", "angle", "aim", "delay", "stagger", "move", "speed", "spin", "path", "loop"];

  function scripted(a) {
    return (a.count || 0) > 1 || !!a.formation || (a.offsets || []).length > 0 || a.anchor === "boss" ||
      (a.delay || 0) > 0 || (a.stagger || 0) > 0 || !!a.move || (a.angle || 0) !== 0 || !!a.aim;
  }
  function centre(b) { return [b.x + (Math.max(1, b.w || 1) - 1) / 2, b.y + (Math.max(1, b.h || 1) - 1) / 2]; }

  function offsets(a, rot, fromBoss, rnd) {
    let n = a.count || 0;
    if (a.formation === "list" && (a.offsets || []).length) n = a.offsets.length;
    n = clamp(Math.trunc(n) || 1, 1, MAX_ZONES);
    let sp = a.spacing > 0 ? a.spacing : 1.5; sp = Math.min(sp, 20);
    const c = Math.cos(rot), s = Math.sin(rot), turn = (x, y) => [x * c - y * s, x * s + y * c];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (a.formation === "ring") { const t = 2 * Math.PI * i / n; out.push(turn(sp * Math.cos(t), sp * Math.sin(t))); }
      else if (a.formation === "line") out.push(turn(fromBoss ? (i + 1) * sp : (i - (n - 1) / 2) * sp, 0));
      else if (a.formation === "spread") { const t = rnd() * 2 * Math.PI, r = sp * Math.sqrt(rnd()); out.push([r * Math.cos(t), r * Math.sin(t)]); }
      else if (a.formation === "list" && a.offsets && a.offsets[i]) out.push(turn(clamp(+a.offsets[i][0] || 0, -20, 20), clamp(+a.offsets[i][1] || 0, -20, 20)));
      else out.push([0, 0]);
    }
    return out;
  }

  function create(o) {
    return { tick: 0, zones: [], soaks: [], timers: [], seq: 0, hits: 0, damage: 0, flashes: [],
      boss: o.boss || { x: 0, y: 0, w: 1, h: 1 }, player: o.player || { x: 4, y: 0 }, patterns: o.patterns || [], rnd: o.rnd || Math.random };
  }

  function spawnZone(st, a) {
    const p = st.player;
    let radius = a.radius > 0 ? a.radius : 0.75;
    const maxR = a.maxRadius > 0 ? Math.min(a.maxRadius, 6) : 0.75;
    if (radius > maxR) radius = maxR;
    const duration = a.duration >= 1 ? a.duration : 4, damage = a.damage >= 1 ? a.damage : 10;
    let zx = p.x, zy = p.y;
    if (a.tile) { zx = Math.floor(p.x + .5); zy = Math.floor(p.y + .5); }
    const base = { r: radius, damage, left: duration, duration, windup: Math.max(0, a.windup || 0), windup0: Math.max(0, a.windup || 0), once: !!a.once, tile: !!a.tile, delay: 0 };
    if (!scripted(a)) { st.zones.push({ ...base, id: ++st.seq, x: zx, y: zy }); return; }
    const [bx, by] = centre(st.boss), fromBoss = a.anchor === "boss";
    const ax = fromBoss ? bx : p.x, ay = fromBoss ? by : p.y;
    let rot = (a.angle || 0) * Math.PI / 180;
    if (a.aim) rot += Math.atan2(p.y - by, p.x - bx);
    const speed = clamp(a.speed || 2, -12, 12), spin = clamp(a.spin || 90, -720, 720) * Math.PI / 180;
    const delay = clamp(Math.trunc(a.delay || 0), 0, 30), stagger = clamp(Math.trunc(a.stagger || 0), 0, 10);
    offsets(a, rot, fromBoss, st.rnd).forEach((o, i) => {
      const z = { ...base, id: ++st.seq, x: ax + o[0], y: ay + o[1], delay: delay + i * stagger };
      if (base.tile) { z.x = Math.floor(z.x + .5); z.y = Math.floor(z.y + .5); }
      if (a.move === "dir") z.m = { k: "vel", vx: speed * Math.cos(rot), vy: speed * Math.sin(rot) };
      else if (a.move === "out") { let dx = z.x - ax, dy = z.y - ay, d = Math.hypot(dx, dy); if (d < 1e-6) { dx = Math.cos(rot); dy = Math.sin(rot); d = 1; } z.m = { k: "vel", vx: speed * dx / d, vy: speed * dy / d }; }
      else if (a.move === "follow") z.m = { k: "follow", speed: Math.abs(speed) };
      else if (a.move === "orbit") z.m = { k: "orbit", spin, ang: Math.atan2(z.y - by, z.x - bx), rad: Math.hypot(z.x - bx, z.y - by) };
      else if (a.move === "path" && (a.path || []).length) {
        const path = a.path.slice(0, 32).map(w => [z.x + clamp(+w[0] || 0, -30, 30), z.y + clamp(+w[1] || 0, -30, 30)]);
        if (a.loop) path.push([z.x, z.y]);
        z.m = { k: "path", speed: Math.abs(speed), path, next: 0, loop: !!a.loop };
      }
      st.zones.push(z);
    });
  }
  function spawnSoak(st, a) {
    let radius = a.radius > 0 ? a.radius : 1.5; if (radius > 3) radius = 3;
    const duration = a.duration >= 1 ? a.duration : 4, damage = a.damage >= 1 ? a.damage : 40;
    let fail = a.failRadius; if (!(fail >= radius)) fail = 8;
    st.soaks.push({ id: ++st.seq, x: st.player.x, y: st.player.y, r: radius, damage, left: duration, duration, fail });
  }
  function toward(z, x, y, step) { const dx = x - z.x, dy = y - z.y, d = Math.hypot(dx, dy); if (d <= step || d < 1e-9) { z.x = x; z.y = y; } else { z.x += dx / d * step; z.y += dy / d * step; } }
  function motion(st, dt) {
    const [bx, by] = centre(st.boss);
    for (const z of st.zones) {
      const m = z.m; if (!m || z.delay > 0) continue;
      if (m.k === "vel") { z.x += m.vx * dt; z.y += m.vy * dt; }
      else if (m.k === "follow") toward(z, st.player.x, st.player.y, m.speed * dt);
      else if (m.k === "orbit") { m.ang += m.spin * dt; z.x = bx + m.rad * Math.cos(m.ang); z.y = by + m.rad * Math.sin(m.ang); }
      else if (m.k === "path") {
        let left = m.speed * dt;
        for (let g = 0; left > 1e-9 && m.next < m.path.length && g < 64; g++) {
          const w = m.path[m.next], d = Math.hypot(w[0] - z.x, w[1] - z.y);
          if (d <= left) { z.x = w[0]; z.y = w[1]; left -= d; m.next++; if (m.next >= m.path.length && m.loop) m.next = 0; }
          else { toward(z, w[0], w[1], left); left = 0; }
        }
      }
    }
  }
  function hit(st, dmg, what) { st.hits++; st.damage += dmg; st.flashes.push({ t: st.tick, what }); }
  function tickZones(st) {
    const p = st.player, kept = [];
    for (const z of st.zones) {
      if (z.delay > 0) { z.delay--; if (z.delay > 0 || z.windup > 0) { kept.push(z); continue; } }
      if (z.windup > 0) { z.windup--; if (z.windup > 0) { kept.push(z); continue; } }
      else { z.left--; if (z.left < 0) continue; }
      z.landed = st.tick;
      const inside = z.tile ? Math.floor(p.x + .5) === Math.floor(z.x + .5) && Math.floor(p.y + .5) === Math.floor(z.y + .5)
        : Math.hypot(z.x - p.x, z.y - p.y) <= z.r;
      if (inside) hit(st, z.damage, "zone");
      if (z.once) { st.flashes.push({ t: st.tick, zone: { x: z.x, y: z.y, r: z.r, tile: z.tile } }); continue; }
      kept.push(z);
    }
    st.zones = kept;
  }
  function tickSoaks(st) {
    const p = st.player, kept = [];
    for (const s of st.soaks) {
      s.left--; if (s.left > 0) { kept.push(s); continue; }
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= s.r) hit(st, s.damage, "soak (split)"); else if (d <= s.fail) hit(st, s.damage, "soak (failed)");
      st.flashes.push({ t: st.tick, soak: { x: s.x, y: s.y, r: s.r } });
    }
    st.soaks = kept;
  }
  function step(st) {
    st.tick++;
    const second = st.tick % TPS === 0;
    if (second) {
      st.patterns.forEach((a, i) => {
        if (st.timers[i] === undefined) st.timers[i] = 0;
        st.timers[i]--;
        if (st.timers[i] > 0) return;
        st.timers[i] = Math.max(1, Math.trunc(a.every) || 1);
        if (a.do === "zone") spawnZone(st, a); else if (a.do === "soak") spawnSoak(st, a);
      });
    }
    motion(st, 1 / TPS);
    if (second) { tickZones(st); tickSoaks(st); }
    st.flashes = st.flashes.filter(f => st.tick - f.t < 8);
  }

  // Clean one primitive for storage: drop defaults and unknown keys, keep the
  // key names the server reads. Old rows stay as they were.
  function clean(a) {
    const out = { every: Math.max(1, Math.trunc(+a.every || 1)), do: a.do === "soak" ? "soak" : "zone", target: a.target || "target" };
    const numk = a.do === "soak" ? ["radius", "damage", "duration", "failRadius"] : ["radius", "maxRadius", "windup", "damage", "duration"];
    for (const k of numk) if (+a[k]) out[k] = +a[k];
    if (out.do === "zone") {
      if (a.once) out.once = true;
      if (a.tile) out.tile = true;
      if ((+a.count || 0) > 1) out.count = Math.trunc(+a.count);
      if (FORMATIONS.includes(a.formation) && a.formation) out.formation = a.formation;
      if (+a.spacing) out.spacing = +a.spacing;
      if (a.formation === "list" && (a.offsets || []).length) out.offsets = a.offsets.map(p => [+p[0] || 0, +p[1] || 0]);
      if (a.anchor === "boss") out.anchor = "boss";
      if (+a.angle) out.angle = +a.angle;
      if (a.aim) out.aim = true;
      if (+a.delay > 0) out.delay = Math.trunc(+a.delay);
      if (+a.stagger > 0) out.stagger = Math.trunc(+a.stagger);
      if (MOVES.includes(a.move) && a.move) out.move = a.move;
      if (out.move && out.move !== "orbit" && +a.speed) out.speed = +a.speed;
      if (out.move === "orbit" && +a.spin) out.spin = +a.spin;
      if (out.move === "path" && (a.path || []).length) { out.path = a.path.map(p => [+p[0] || 0, +p[1] || 0]); if (a.loop) out.loop = true; }
    }
    return out;
  }
  function validate(a, i) {
    const w = `primitive ${i + 1}: `;
    if (a.do !== "zone" && a.do !== "soak") throw new Error(w + `only "zone" and "soak" exist (got "${a.do}")`);
    if (!(a.every >= 1)) throw new Error(w + "every must be at least 1 second");
    if (a.formation && !FORMATIONS.includes(a.formation)) throw new Error(w + "unknown formation " + a.formation);
    if (a.move && !MOVES.includes(a.move)) throw new Error(w + "unknown move " + a.move);
    if (a.formation === "list" && !(a.offsets || []).length) throw new Error(w + "a list formation needs offsets");
    if (a.move === "path" && !(a.path || []).length) throw new Error(w + "a path move needs waypoints");
    for (const k of ["offsets", "path"]) if (a[k] && !(Array.isArray(a[k]) && a[k].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))) throw new Error(w + k + " must be [[dx,dy],...]");
  }
  return { TPS, create, step, clean, validate, scripted, FORMATIONS, MOVES, SCRIPT_KEYS, centre };
})();
if (typeof module !== "undefined") module.exports = BQSim;
