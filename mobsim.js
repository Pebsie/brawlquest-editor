"use strict";
// Boss-pattern simulator for the Mobs tab preview. A port of the API's
// enemies.go (runBossPatterns, spawnZone, tickZones, spawnSoak, tickSoaks),
// zone_script.go (formations, stagger, movement), mob_shots.go (projectile),
// mob_casts.go (cast times, interrupts, spawn / suicide / effect) and
// effects.go (status effects on the player): 20 ticks a second, patterns
// and damage once a second, zone movement every tick. Positions are tiles.
const BQSim = (() => {
  const TPS = 20, MAX_ZONES = 24;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const FORMATIONS = ["", "ring", "line", "spread", "list"];
  const MOVES = ["", "dir", "out", "follow", "orbit", "path"];
  const KINDS = ["zone", "soak", "projectile", "spawn", "suicide", "effect"];
  const MAX_CAST = 10;
  const FX = typeof BQFX !== "undefined" ? BQFX : (typeof require !== "undefined" ? require("./fx.js") : null);
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
      casts: [], shots: [], effects: [], effectDefs: o.effects || {}, enemyDefs: o.enemies || {}, adds: [], breaks: [], bossDead: false,
      bossRange: o.bossRange === undefined ? 1 : o.bossRange,
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
    const base = { r: radius, damage, left: duration, duration, windup: Math.max(0, a.windup || 0), windup0: Math.max(0, a.windup || 0), once: !!a.once, tile: !!a.tile, delay: 0, spr: a.sprite || null, born: st.tick };
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
    st.soaks.push({ id: ++st.seq, x: st.player.x, y: st.player.y, r: radius, damage, left: duration, duration, fail, spr: a.sprite || null, born: st.tick });
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
  // ---- projectile (mob_shots.go) and status effects (effects.go)
  const SHOT_SUB = 0.2, SPLAT_TICKS = 12, INSET = 0.2;
  function shotDefaults(a) {
    let cast = a.castTime > 0 ? a.castTime : a.cast > 0 ? a.cast : (a.windup > 0 ? a.windup : 0.5); cast = clamp(cast, 0, MAX_CAST);
    const speed = Math.min(a.speed > 0 ? a.speed : 6, 20), rng = Math.min(a.range > 0 ? a.range : 6, 15), r = Math.min(a.radius > 0 ? a.radius : 0.3, 1.5);
    return { cast, speed, rng, r };
  }
  // ---- generic casts (mob_casts.go)
  function castTicks(a) {
    const secs = a.do === "projectile" ? shotDefaults(a).cast : clamp(+a.castTime || 0, 0, MAX_CAST);
    return Math.round(secs * TPS);
  }
  function castName(a) {
    if (a.name) return a.name;
    return { projectile: a.visual === "web" ? "Web" : "Shot", spawn: "Summon", suicide: "Self-destruct", effect: "Curse", soak: "Soak" }[a.do] || "Zone";
  }
  const inEffectRange = (st, a) => { const [cx, cy] = centre(st.boss), r = a.range > 0 ? a.range : Math.max(1, st.bossRange); return Math.hypot(st.player.x - cx, st.player.y - cy) <= r + .5; };
  const addsAlive = st => st.adds.length;
  function spawnSpots(st, a) {
    const [bx, by] = centre(st.boss), p = st.player, fromBoss = a.anchor !== "target";
    const s = { ...a, count: Math.max(1, Math.trunc(a.count) || 1) };
    if (!s.formation && fromBoss) s.formation = "spread";
    let rot = (a.angle || 0) * Math.PI / 180; if (a.aim) rot += Math.atan2(p.y - by, p.x - bx);
    let n = s.count; if (a.max > 0) n = Math.min(n, a.max - addsAlive(st));
    if (n <= 0) return [];
    const ax = fromBoss ? bx : p.x, ay = fromBoss ? by : p.y, used = new Set(), out = [];
    for (const o of offsets(s, rot, fromBoss, st.rnd)) {
      if (out.length >= n) break;
      const x = Math.floor(ax + o[0] + .5), y = Math.floor(ay + o[1] + .5), k = x + "," + y;
      if (!used.has(k)) { used.add(k); out.push([x, y]); }
    }
    return out;
  }
  // begin: false when it cannot go now (already casting, out of range,
  // nothing to spawn); the timer then retries next second.
  function begin(st, a) {
    if (st.casts.length || st.bossDead) return false;
    const p = st.player, c = { a, tx: p.x + .5, ty: p.y + .5, spots: null, name: castName(a), locked: !a.interruptible };
    if (a.do === "projectile") { const [cx, cy] = centre(st.boss); if (Math.hypot(c.tx - (cx + .5), c.ty - (cy + .5)) > shotDefaults(a).rng + .5) return false; }
    else if (a.do === "effect") { if (!st.effectDefs[a.effect] || !inEffectRange(st, a)) return false; }
    else if (a.do === "spawn") { c.spots = spawnSpots(st, a); if (!c.spots.length) return false; }
    else if (!KINDS.includes(a.do)) return false;
    c.total = c.left = castTicks(a);
    if (!c.total) { execute(st, c); return true; }
    st.casts.push(c);
    return true;
  }
  function execute(st, c) {
    const a = c.a;
    if (a.do === "zone") spawnZone(st, a);
    else if (a.do === "soak") spawnSoak(st, a);
    else if (a.do === "projectile") fire(st, c);
    else if (a.do === "spawn") {
      for (const [x, y] of c.spots) { if (a.max > 0 && addsAlive(st) >= a.max) break; st.adds.push({ id: ++st.seq, enemy: a.enemy, x, y, born: st.tick }); }
    } else if (a.do === "suicide") {
      const [cx, cy] = centre(st.boss);
      if (a.damage > 0) {
        const r = a.radius > 0 ? a.radius : 1.5;
        if (Math.hypot(st.player.x - cx, st.player.y - cy) <= r) hit(st, a.damage, "suicide");
      }
      if (a.damage > 0 || a.sprite) st.flashes.push({ t: st.tick, splat: { x: cx + .5, y: cy + .5, visual: "burst", r: a.radius > 0 ? a.radius : 1.5, spr: a.sprite || null } });
      st.bossDead = true; st.casts = [];
    } else if (a.do === "effect") {
      if (inEffectRange(st, a) && applyEffect(st, a.effect) && (a.visual || a.sprite)) st.flashes.push({ t: st.tick, splat: { x: st.player.x + .5, y: st.player.y + .5, visual: a.visual || "", hit: true, spr: a.sprite || null } });
    }
  }
  // interrupt: cancels an interruptible cast (the server's interruptCast).
  function interrupt(st) {
    const c = st.casts[0];
    if (!c || c.locked) return false;
    st.casts = [];
    st.breaks.push({ t: st.tick, name: c.name, k: 1 - c.left / Math.max(1, c.total) });
    return true;
  }
  function fire(st, c) {
    const a = c.a, d = shotDefaults(a), b = st.boss;
    const ox = b.x + Math.max(1, b.w || 1) / 2, oy = b.y + Math.max(1, b.h || 1) / 2;
    const base = Math.atan2(c.ty - oy, c.tx - ox) + (a.angle || 0) * Math.PI / 180;
    const n = clamp(Math.trunc(a.count) || 1, 1, MAX_ZONES), spread = a.spread || 15, stagger = Math.max(0, Math.trunc(a.stagger || 0));
    for (let i = 0; i < n; i++) {
      const ang = a.formation === "ring" ? base + 2 * Math.PI * i / n : base + (i - (n - 1) / 2) * spread * Math.PI / 180;
      st.shots.push({ id: ++st.seq, x: ox, y: oy, dx: Math.cos(ang), dy: Math.sin(ang), speed: d.speed, r: d.r, rng: d.rng, traveled: 0,
        damage: Math.max(0, a.damage || 0), effect: a.effect || 0, visual: a.visual || "", wait: i * stagger, spr: a.sprite || null, hitSpr: a.hitSprite || null });
    }
  }
  function shotHitsPlayer(st, x, y, r) {
    const p = st.player, L = p.x + INSET, T = p.y + INSET, R = p.x + 1 - INSET, B = p.y + 1 - INSET;
    return x - r < R && x + r > L && y - r < B && y + r > T;
  }
  function applyEffect(st, id) {
    const d = st.effectDefs[id]; if (!d) return false;
    const dur = d.Duration > 0 ? d.Duration : 3, max = Math.max(1, d.MaxStacks || 1), mode = d.Stacking || "refresh";
    const a = st.effects.find(e => e.id === id);
    if (!a) { st.effects.push({ id, left: dur, stacks: 1, dur }); return true; }
    if (mode === "ignore") return false;
    if (mode === "extend") a.left = Math.min(a.left + dur, dur * max);
    else { if (mode === "stack" && a.stacks < max) a.stacks++; a.left = dur; }
    return true;
  }
  function moveMult(st) {
    let m = 1;
    for (const e of st.effects) for (const mod of parseMods(st.effectDefs[e.id])) {
      if (mod.type === "move_speed" && mod.mult >= 0) m *= Math.pow(mod.mult, e.stacks);
      if (mod.type === "stun") m = 0;
    }
    return clamp(m, 0, 3);
  }
  function parseMods(d) { if (!d) return []; if (Array.isArray(d.Modifiers)) return d.Modifiers; try { return JSON.parse(d.Modifiers || "[]") || []; } catch { return []; } }
  function tickShots(st) {
    const done = [];
    st.casts = st.casts.filter(c => { c.left--; if (c.left > 0) return true; done.push(c); return false; });
    done.forEach(c => execute(st, c));
    st.breaks = st.breaks.filter(b => st.tick - b.t < 15);
    const live = [];
    for (const s of st.shots) {
      if (s.wait > 0) { s.wait--; live.push(s); continue; }
      const step = s.speed / TPS; let moved = 0, done = false, hit = false;
      while (moved < step - 1e-9 && !done) {
        let d = Math.min(SHOT_SUB, step - moved);
        if (s.traveled + d > s.rng) d = s.rng - s.traveled;
        s.x += s.dx * d; s.y += s.dy * d; s.traveled += d; moved += d;
        if (shotHitsPlayer(st, s.x, s.y, s.r)) done = hit = true;
        else if (s.traveled >= s.rng - 1e-9) done = true;
      }
      if (!done) { live.push(s); continue; }
      const sp = { t: st.tick, splat: { x: hit ? st.player.x + .5 : s.x, y: hit ? st.player.y + .5 : s.y, visual: s.visual, hit, spr: s.hitSpr } };
      if (hit) { if (s.damage > 0) hit_(st, s.damage, "projectile"); if (s.effect) applyEffect(st, s.effect); }
      st.flashes.push(sp);
    }
    st.shots = live;
  }
  function tickEffects(st, dt) {
    st.effects = st.effects.filter(e => {
      e.left -= dt;
      const d = st.effectDefs[e.id];
      for (const mod of parseMods(d)) if (mod.type === "dot" && mod.damage > 0) {
        const every = Math.max(0.25, mod.every || 1);
        e.dot = (e.dot === undefined ? every : e.dot) - dt;
        if (e.dot <= 1e-9) { e.dot += every; hit_(st, mod.damage * e.stacks, "dot"); }
      }
      return e.left > 1e-9;
    });
  }
  const hit_ = (st, dmg, what) => hit(st, dmg, what);

  function step(st) {
    st.tick++;
    const second = st.tick % TPS === 0;
    if (second && !st.bossDead) {
      st.patterns.forEach((a, i) => {
        if (st.timers[i] === undefined) st.timers[i] = Math.max(0, Math.trunc(a.first) || 0);
        st.timers[i]--;
        if (st.timers[i] > 0) return;
        st.timers[i] = Math.max(1, Math.trunc(a.every) || 1);
        if (!begin(st, a)) st.timers[i] = 1;
      });
    }
    motion(st, 1 / TPS);
    tickShots(st);
    tickEffects(st, 1 / TPS);
    if (second) { tickZones(st); tickSoaks(st); }
    st.flashes = st.flashes.filter(f => st.tick - f.t < (f.splat ? SPLAT_TICKS : 8));
  }

  // Clean one primitive for storage: drop defaults and unknown keys, keep the
  // key names the server reads. Old rows stay as they were.
  function clean(a) {
    const kind = KINDS.includes(a.do) ? a.do : "zone";
    const out = { every: Math.max(1, Math.trunc(+a.every || 1)), do: kind, target: a.target || "target" };
    // generic cast keys, every primitive. A projectile's old "cast" becomes castTime.
    const ct = +a.castTime || (kind === "projectile" ? +a.cast || 0 : 0);
    if (ct > 0) out.castTime = clamp(ct, 0, MAX_CAST);
    if (a.interruptible) out.interruptible = true;
    if (a.name) out.name = String(a.name);
    if (+a.first > 0) out.first = Math.trunc(+a.first);
    // sprite: art for the zone / soak / shot / spawn telegraph / burst / splat
    // (fx.js); hitSprite: a projectile's splat. Unset = the default look.
    const spr = FX && FX.clean(a.sprite);
    if (spr) out.sprite = spr;
    if (kind === "projectile") { const hs = FX && FX.clean(a.hitSprite); if (hs) out.hitSprite = hs; }
    if (kind === "spawn") {
      if (+a.enemy > 0) out.enemy = Math.trunc(+a.enemy);
      if ((+a.count || 0) > 1) out.count = Math.trunc(+a.count);
      if (a.anchor === "target") out.anchor = "target";
      if (FORMATIONS.includes(a.formation) && a.formation) out.formation = a.formation;
      if (+a.spacing) out.spacing = +a.spacing;
      if (a.formation === "list" && (a.offsets || []).length) out.offsets = a.offsets.map(p => [+p[0] || 0, +p[1] || 0]);
      if (+a.angle) out.angle = +a.angle;
      if (a.aim) out.aim = true;
      if (+a.max > 0) out.max = Math.trunc(+a.max);
      return out;
    }
    if (kind === "suicide") { for (const k of ["damage", "radius"]) if (+a[k]) out[k] = +a[k]; return out; }
    if (kind === "effect") {
      if (+a.effect > 0) out.effect = Math.trunc(+a.effect);
      if (+a.range) out.range = +a.range;
      if (a.visual) out.visual = String(a.visual);
      return out;
    }
    if (kind === "projectile") {
      for (const k of ["speed", "range", "radius", "damage", "spread", "angle"]) if (+a[k]) out[k] = +a[k];
      if (+a.effect > 0) out.effect = Math.trunc(+a.effect);
      if (a.visual) out.visual = String(a.visual);
      if ((+a.count || 0) > 1) out.count = Math.trunc(+a.count);
      if (a.formation === "ring") out.formation = "ring";
      if (+a.stagger > 0) out.stagger = Math.trunc(+a.stagger);
      return out;
    }
    const numk = kind === "soak" ? ["radius", "damage", "duration", "failRadius"] : ["radius", "maxRadius", "windup", "damage", "duration"];
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
    if (!KINDS.includes(a.do)) throw new Error(w + `only ${KINDS.map(k => '"' + k + '"').join(", ")} exist (got "${a.do}")`);
    if (!(a.every >= 1)) throw new Error(w + "every must be at least 1 second");
    if (a.castTime !== undefined && !(a.castTime >= 0 && a.castTime <= MAX_CAST)) throw new Error(w + "castTime must be 0 to 10 seconds");
    if (FX) { FX.validate(a.sprite, w + "sprite"); FX.validate(a.hitSprite, w + "hit sprite"); }
    if (a.do === "spawn" && !(a.enemy > 0)) throw new Error(w + "spawn needs an enemy");
    if (a.do === "effect" && !(a.effect > 0)) throw new Error(w + "effect needs an effect");
    if (a.formation && !FORMATIONS.includes(a.formation)) throw new Error(w + "unknown formation " + a.formation);
    if (a.move && !MOVES.includes(a.move)) throw new Error(w + "unknown move " + a.move);
    if (a.formation === "list" && !(a.offsets || []).length) throw new Error(w + "a list formation needs offsets");
    if (a.move === "path" && !(a.path || []).length) throw new Error(w + "a path move needs waypoints");
    for (const k of ["offsets", "path"]) if (a[k] && !(Array.isArray(a[k]) && a[k].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))) throw new Error(w + k + " must be [[dx,dy],...]");
  }
  return { TPS, create, step, clean, validate, scripted, FORMATIONS, MOVES, SCRIPT_KEYS, KINDS, centre, moveMult, applyEffect, shotDefaults, interrupt, castName, castTicks };
})();
if (typeof module !== "undefined") module.exports = BQSim;
