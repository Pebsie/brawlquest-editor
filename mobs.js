"use strict";
// Mobs tab: enemies (all columns) and their boss_patterns primitives, with a
// top-down preview driven by mobsim.js (the same rules as the API).

const MOB_NEW = { id: 0, Name: "New mob", ATK: 5, Image: "assets/monsters/spider.png", HP: 20, Range: 1, CanMove: 1, XP: 10, Width: 1, Height: 1, Attributes: "None", AttackSpeed: 1 };
const PRIM_NEW = {
  zone: { every: 3, do: "zone", target: "target", radius: 1, maxRadius: 1, windup: 2, once: true, damage: 20, duration: 2 },
  soak: { every: 10, do: "soak", target: "target", radius: 1.5, damage: 60, duration: 4, failRadius: 8 },
};
const PRIM_PRESETS = {
  "Ring burst": { every: 6, do: "zone", target: "target", radius: 0.75, maxRadius: 0.75, windup: 2, once: true, damage: 30, duration: 1, count: 8, formation: "ring", anchor: "boss", spacing: 2.5 },
  "Expanding ring": { every: 8, do: "zone", target: "target", radius: 0.75, damage: 15, duration: 4, count: 10, formation: "ring", anchor: "boss", spacing: 1, move: "out", speed: 2 },
  "Aimed line": { every: 5, do: "zone", target: "target", radius: 0.75, maxRadius: 0.75, windup: 2, once: true, damage: 35, duration: 1, count: 6, formation: "line", anchor: "boss", aim: true, spacing: 1.2, stagger: 0 },
  "Rolling wave": { every: 7, do: "zone", target: "target", radius: 1, maxRadius: 1, damage: 20, duration: 5, count: 5, formation: "line", anchor: "boss", aim: true, angle: 90, spacing: 1.5, move: "dir", speed: 2 },
  "Orbiting blades": { every: 12, do: "zone", target: "target", radius: 0.75, damage: 15, duration: 10, count: 3, formation: "ring", anchor: "boss", spacing: 2.5, move: "orbit", spin: 90 },
  "Homing orb": { every: 9, do: "zone", target: "target", radius: 1, maxRadius: 1, windup: 1, damage: 20, duration: 6, formation: "list", offsets: [[0, -4]], move: "follow", speed: 1.5 },
  "Stepping tiles": { every: 6, do: "zone", target: "target", tile: true, radius: 0.5, maxRadius: 0.5, windup: 2, once: true, damage: 40, duration: 1, formation: "list", offsets: [[-1, 0], [0, 0], [1, 0]], stagger: 1 },
};
// [key, label, kind, help, show(a)]
const isZone = a => a.do === "zone", isScr = a => isZone(a);
const PRIM_FIELDS = [
  ["every", "Every (s)", "num", "seconds between casts while aggro'd"],
  ["damage", "Damage", "num", "per hit (zone: every second it is active; soak: split between players inside)"],
  ["duration", "Duration (s)", "num", "seconds active (zone) or until it resolves (soak)"],
  ["radius", "Radius", "num", "tiles; zone is capped at Max radius (0.75 unless raised), soak at 3"],
  ["maxRadius", "Max radius", "num", "zone only: raises the 0.75 cap (up to 6)", isZone],
  ["windup", "Windup (s)", "num", "telegraph before it hurts (the cast tick counts one off)", isZone],
  ["once", "Once", "chk", "hit once when it lands, then vanish", isZone],
  ["tile", "Tile", "chk", "snap to the tile and hit whoever stands on it", isZone],
  ["failRadius", "Fail radius", "num", "soak only: if nobody is inside, everyone within this takes full damage", a => a.do === "soak"],
  ["target", "Target", "text", "target / aggro (both mean the mob's current target)"],
  ["-", "Scripting (zone)", "head", "multiple zones per cast, stagger and movement. Leave empty for a plain zone.", isScr],
  ["count", "Count", "num", "zones per cast (max 24)", isScr],
  ["formation", "Formation", "sel:" + BQSim.FORMATIONS.join("|"), "blank = all on the anchor; ring; line; spread (random in Spacing); list (Offsets)", isScr],
  ["spacing", "Spacing", "num", "ring radius / gap between line zones / spread radius (tiles, default 1.5)", isScr],
  ["offsets", "Offsets", "pts", "list formation: dx,dy; dx,dy ... in tiles from the anchor (x east, y south)", a => isZone(a) && a.formation === "list"],
  ["anchor", "Anchor", "sel:target|boss", "centre of the formation", isScr],
  ["angle", "Angle (deg)", "num", "rotates the formation; direction for move dir. 0 east, 90 south", isScr],
  ["aim", "Aim at target", "chk", "add the boss-to-target bearing to Angle", isScr],
  ["delay", "Delay (s)", "num", "before the first zone appears", isScr],
  ["stagger", "Stagger (s)", "num", "extra seconds between each zone of the cast (0 = all at once)", isScr],
  ["move", "Move", "sel:" + BQSim.MOVES.join("|"), "dir (along Angle), out (away from anchor), follow (homes on target), orbit (around boss), path", isScr],
  ["speed", "Speed", "num", "tiles/second (default 2, max 12; negative out = pull in)", a => isZone(a) && a.move && a.move !== "orbit"],
  ["spin", "Spin (deg/s)", "num", "orbit speed (default 90; negative = anticlockwise)", a => isZone(a) && a.move === "orbit"],
  ["path", "Path", "pts", "waypoints dx,dy; dx,dy ... from the zone's spawn point", a => isZone(a) && a.move === "path"],
  ["loop", "Loop", "chk", "walk back to the start and repeat", a => isZone(a) && a.move === "path"],
];
const fmtPts = p => (p || []).map(v => v.join(",")).join("; ");
const parsePts = s => String(s || "").split(";").map(t => t.trim()).filter(Boolean).map(t => t.split(",").map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite));

function mobPatterns(id) {
  const out = [];
  for (const r of S.c.patterns || []) if (r.EnemyID === id) { const a = parseJSON(r.Pattern, []); if (Array.isArray(a)) out.push(...a); }
  return out;
}

function renderMobs(m) {
  const form = h("div", { class: "form" });
  const label = e => `${e.Name} (${e.id})` + (mobPatterns(e.id).length ? " · patterns" : "");
  const pick = e => { S.mob = e; m.replaceChildren(listPanel(() => S.c.enemies, label, () => S.mob && S.mob.id, it => go("#mob/" + it.id), () => pick({ ...MOB_NEW })), form); mobForm(form, e); };
  pick(S.mob ? (S.mob.id ? S.c.enemies.find(e => e.id === S.mob.id) || S.c.enemies[0] : S.mob) : S.c.enemies[0]);
}

function mobForm(form, e) {
  form.textContent = "";
  if (S.mobPreview) { S.mobPreview.stop(); S.mobPreview = null; }
  if (!e) return;
  if (e.id) syncHash("#mob/" + e.id);
  const cols = S.c.enemyCols || Object.keys(MOB_NEW);
  const f = {};
  const grid = h("div", { class: "grid" });
  let imgPath = e.Image || "";
  const img = sprite(imgPath);
  const imgIn = assetInput(imgPath, v => { imgPath = v; img.src = assetURL(v); });
  const pickImg = () => openPicker({ title: `Sprite for ${f.Name.value || "this mob"}`, groups: mobSpriteGroups, group: "monsters", recentKey: "mob", value: imgPath,
    onPick: v => { if (v) { imgPath = v; imgIn.value = v; img.src = assetURL(v); if (S.mobPreview) S.mobPreview.setImage(v); } } });
  img.addEventListener("click", pickImg); img.style.cursor = "pointer"; img.title = "Pick a sprite";
  const help = { ATK: "melee damage per hit", HP: "hit points", Range: "attack/aggro reach in tiles (0 = never attacks)", CanMove: "walks and chases; off = static (spawned adds despawn)",
    XP: "XP per kill", Width: "tiles wide", Height: "tiles tall", Attributes: "free text, None by default", AttackSpeed: "melee hits per second (1 = once a second)" };
  for (const c of cols) {
    if (c === "id") continue;
    if (c === "Image") { grid.append(h("label", {}, "Sprite"), h("div", {}, h("div", { class: "bar", style: "margin:0;align-items:center" }, img, h("button", { onclick: pickImg }, "Pick sprite…")), imgIn)); continue; }
    if (c === "CanMove") f[c] = h("input", { type: "checkbox" }), f[c].checked = !!+e[c];
    else if (c === "Name" || c === "Attributes") f[c] = txt(e[c]);
    else f[c] = num(e[c]);
    grid.append(h("label", {}, c), h("div", {}, f[c], help[c] ? h("span", { class: "hint" }, " " + help[c]) : null));
  }
  const collect = () => {
    const r = { id: e.id || 0, Image: imgPath };
    for (const [k, el] of Object.entries(f)) r[k] = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.type === "number" ? +el.value : el.value;
    return r;
  };
  const placed = e.id ? (S.world ? [...S.world.tiles.values()].filter(t => S.world.strings[t[6]] === e.Name).length : null) : 0;
  const spells = (S.c.spells || []).filter(s => s.EnemyID === e.id);
  form.append(h("h2", {}, e.id ? `${e.Name} (${e.id})` : "New mob"), grid,
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => { const r = collect(); const id = await save("enemies", r); S.mob = { id }; if (!e.id && S.mobDraft) { await savePatterns(id, S.mobDraft); } renderTab(); } }, e.id ? "Save mob" : "Create mob"),
      e.id ? h("button", { onclick: () => { const c = collect(); c.id = 0; c.Name += " (copy)"; S.mobDraft = mobPatterns(e.id); S.mob = c; mobForm(form, c); } }, "Duplicate") : null,
      e.id ? h("button", { class: "danger", onclick: async () => { if (await del("enemies", e.id)) { S.mob = null; renderTab(); } } }, "Delete") : null,
      e.id ? link("#loot/" + e.id, "Loot table →", "btnlink") : null),
    h("p", { class: "hint" }, e.id ? (placed === null ? "Open the Map tab once to count spawns. " : `Placed on ${placed} map tile(s). `) + "Renaming moves its map spawns along; quest steps that name it are not changed. Deleting also removes its loot and patterns." : "Create the mob, then it can be placed from Map > Place mobs."));
  if (spells.length) form.append(h("div", { class: "panel" }, h("h3", {}, "Legacy spells (enemySpells)"),
    h("p", { class: "hint" }, "Older mechanics, kept as they are and not edited here. New boss mechanics should use the pattern primitives below."),
    spells.map(s => h("div", {}, `${s.Name} ${s.Value} every ${s.Frequency}s`))));
  patternEditor(form, e, e.id ? mobPatterns(e.id) : (S.mobDraft || []), () => imgPath, collect);
}

const mobSpriteGroups = () => {
  const used = [...new Set(S.c.enemies.map(e => e.Image).filter(Boolean))].sort().map(v => ({ value: v, note: S.c.enemies.filter(e => e.Image === v).map(e => e.Name).join(", ").slice(0, 40) }));
  return [{ id: "monsters", label: "Monsters", entries: folderEntries("assets/monsters/") }, { id: "used", label: "Used by mobs", entries: used },
    { id: "npc", label: "NPC art", entries: folderEntries("assets/npc/") }, { id: "objects", label: "World objects", entries: folderEntries("assets/world/objects/") }];
};

async function savePatterns(id, actions) {
  status("Saving patterns…");
  try {
    const r = await api("patterns", { enemyId: id, actions });
    await loadAll();
    status(`Saved ${r.actions.length} primitive(s) for enemy ${id} (boss_patterns row ${r.id}). Use Save .db or Export SQL to keep it.`);
    return r;
  } catch (err) { status(err.message, true); throw err; }
}

function patternEditor(form, e, initial, imgOf, collect) {
  let acts = initial.map(a => ({ ...a }));
  let dirty = false;
  const list = h("div", { class: "steps" });
  const json = h("pre", { class: "sql", style: "max-height:160px" });
  const flag = h("span", { class: "dirtyflag" });
  const changed = () => {
    dirty = true; flag.textContent = "unsaved changes"; flag.className = "dirtyflag on";
    if (!e.id) S.mobDraft = acts;
    let txt = ""; try { txt = JSON.stringify(acts.map(BQSim.clean)); } catch (err) { txt = err.message; }
    json.textContent = txt; preview.load(acts.map(BQSim.clean));
  };
  const draw = () => {
    list.replaceChildren(...acts.map((a, i) => primCard(a, i)));
    if (!acts.length) list.append(h("p", { class: "hint" }, "No primitives: this mob only uses its melee attack."));
    json.textContent = JSON.stringify(acts.map(BQSim.clean));
  };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= acts.length) return; [acts[i], acts[j]] = [acts[j], acts[i]]; draw(); changed(); };
  function primCard(a, i) {
    const g = h("div", { class: "grid pgrid" });
    const kind = h("select", { onchange: () => { const keep = { every: a.every, damage: a.damage, target: a.target }; acts[i] = { ...PRIM_NEW[kind.value], ...keep }; draw(); changed(); } },
      h("option", { value: "zone" }, "zone"), h("option", { value: "soak" }, "soak"));
    kind.value = a.do === "soak" ? "soak" : "zone";
    for (const [k, lbl, type, hint, show] of PRIM_FIELDS) {
      if (show && !show(a)) continue;
      if (type === "head") { g.append(h("div", { class: "phead" }, h("b", {}, lbl), " ", h("span", { class: "hint" }, hint))); continue; }
      let el;
      const set = v => { if (v === "" || v === false || v === undefined) delete a[k]; else a[k] = v; changed(); };
      if (type === "num") { el = h("input", { type: "number", class: "num", step: "any", value: a[k] ?? "" }); el.addEventListener("input", () => set(el.value === "" ? "" : +el.value)); }
      else if (type === "chk") { el = h("input", { type: "checkbox" }); el.checked = !!a[k]; el.addEventListener("change", () => set(el.checked)); }
      else if (type === "text") { el = txt(a[k] || ""); el.addEventListener("input", () => set(el.value)); }
      else if (type === "pts") { el = txt(fmtPts(a[k]), "e.g. 0,-2; 2,0; 0,2"); el.addEventListener("input", () => { const p = parsePts(el.value); set(p.length ? p : ""); }); }
      else { el = h("select", {}, type.slice(4).split("|").map(o => h("option", { value: o }, o || "(none)"))); el.value = a[k] || ""; el.addEventListener("change", () => { set(el.value); draw(); }); }
      el.dataset.key = k;
      g.append(h("label", {}, lbl), h("div", {}, el, " ", h("span", { class: "hint" }, hint)));
    }
    return h("div", { class: "step prim", "data-i": i },
      h("div", { class: "top" }, h("b", {}, `#${i + 1}`), kind,
        h("span", { class: "hint" }, a.do === "soak" ? "shared circle on the target; resolves when its timer runs out" : BQSim.scripted(a) ? "scripted zone" : "plain zone on the target"),
        h("span", { style: "flex:1" }),
        h("button", { title: "Move up", onclick: () => move(i, -1) }, "↑"), h("button", { title: "Move down", onclick: () => move(i, 1) }, "↓"),
        h("button", { onclick: () => { acts.splice(i + 1, 0, JSON.parse(JSON.stringify(a))); draw(); changed(); } }, "Duplicate"),
        h("button", { class: "danger", onclick: () => { acts.splice(i, 1); draw(); changed(); } }, "Remove")), g);
  }
  const preset = h("select", { onchange: () => { if (preset.value) { acts.push(JSON.parse(JSON.stringify(PRIM_PRESETS[preset.value]))); preset.value = ""; draw(); changed(); } } },
    h("option", { value: "" }, "+ Add preset…"), Object.keys(PRIM_PRESETS).map(k => h("option", { value: k }, k)));
  const preview = mobPreview(e, imgOf);
  S.mobPreview = preview;
  form.append(h("h3", {}, "Boss pattern primitives ", flag),
    h("p", { class: "hint" }, "Mobs and bosses use only these primitives (boss_patterns). Each one runs on its own timer while the mob is aggro'd; the first cast is one second after aggro."),
    h("div", { class: "mobsplit" },
      h("div", { class: "mobprims" }, list,
        h("div", { class: "bar" },
          h("button", { onclick: () => { acts.push({ ...PRIM_NEW.zone }); draw(); changed(); } }, "+ Zone"),
          h("button", { onclick: () => { acts.push({ ...PRIM_NEW.soak }); draw(); changed(); } }, "+ Soak"), preset,
          h("button", { class: "primary", id: "save-patterns", onclick: async () => {
            if (!e.id) { status("Create the mob first: its patterns are saved with it.", true); return; }
            try { acts.forEach((a, i) => BQSim.validate(BQSim.clean(a), i)); } catch (err) { status(err.message, true); return; }
            await savePatterns(e.id, acts); S.mob = { id: e.id }; dirty = false; renderTab();
          } }, "Save patterns")),
        h("details", {}, h("summary", { class: "hint" }, "Stored JSON (boss_patterns.Pattern)"), json)),
      preview.el));
  draw();
  preview.load(acts.map(BQSim.clean));
}

// Top-down preview: boss in the middle, a draggable player, zones and soaks
// animated by BQSim at real speed.
function mobPreview(e, imgOf) {
  const W = 420, H = 420, cv = h("canvas", { width: W, height: H, class: "mobcv" });
  const info = h("div", { class: "hint" });
  let sc = 22, st = null, pats = [], playing = true, speed = 1, raf = 0, last = 0, acc = 0, drag = false;
  let player = { x: 4, y: 0 };
  const boss = { x: 0, y: 0, w: Math.max(1, +e.Width || 1), h: Math.max(1, +e.Height || 1) };
  let bossImg = new Image(); bossImg.src = assetURL(imgOf());
  const reset = () => { st = BQSim.create({ boss, player: { ...player }, patterns: pats }); acc = 0; };
  const toScr = (x, y) => [W / 2 + x * sc, H / 2 + y * sc];
  const toWorld = (px, py) => [(px - W / 2) / sc, (py - H / 2) / sc];
  function drawNow() {
    const g = cv.getContext("2d");
    g.fillStyle = "#e9ecef"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#d0d4d9"; g.lineWidth = 1;
    for (let i = -20; i <= 20; i++) { const [x] = toScr(i - .5, 0), [, y] = toScr(0, i - .5); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const [bx, by] = toScr(boss.x - .5, boss.y - .5);
    if (bossImg.complete && bossImg.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(bossImg, bx, by, boss.w * sc, boss.h * sc); }
    else { g.fillStyle = "#666"; g.fillRect(bx, by, boss.w * sc, boss.h * sc); }
    const shape = (z, fill, stroke, k = 1) => {
      const [x, y] = toScr(z.x, z.y);
      g.beginPath();
      if (z.tile) g.rect(x - sc / 2 * k, y - sc / 2 * k, sc * k, sc * k); else g.arc(x, y, Math.max(1, z.r * sc * k), 0, Math.PI * 2);
      if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); }
    };
    for (const z of st.zones) {
      if (z.delay > 0) { g.setLineDash([3, 3]); g.lineWidth = 1; shape(z, null, "rgba(200,40,20,.35)"); g.setLineDash([]); continue; }
      g.lineWidth = 2;
      if (z.windup > 0) { shape(z, "rgba(255,64,26,.18)", "rgba(255,110,50,.9)"); const k = Math.min(1, (z.windup0 - z.windup + (st.tick % BQSim.TPS) / BQSim.TPS) / Math.max(1, z.windup0)); shape(z, null, "rgba(255,110,50,.9)", .15 + .85 * k); }
      else shape(z, "rgba(255,30,20,.45)", "rgba(220,40,20,1)");
    }
    for (const s of st.soaks) {
      const [x, y] = toScr(s.x, s.y), k = 1 - s.left / s.duration;
      g.lineWidth = 1; g.setLineDash([4, 4]); g.strokeStyle = "rgba(160,120,0,.5)"; g.beginPath(); g.arc(x, y, s.fail * sc, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.fillStyle = "rgba(240,190,20,.35)"; g.beginPath(); g.moveTo(x, y); g.arc(x, y, s.r * sc, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.closePath(); g.fill();
      g.lineWidth = 2; g.strokeStyle = "#b8860b"; g.beginPath(); g.arc(x, y, s.r * sc, 0, Math.PI * 2); g.stroke();
    }
    for (const f of st.flashes) {
      const o = f.zone || f.soak; if (!o) continue;
      g.globalAlpha = 1 - (st.tick - f.t) / 8; g.lineWidth = 3; shape(o, f.zone ? "rgba(255,30,20,.5)" : "rgba(240,190,20,.5)", "#c00"); g.globalAlpha = 1;
    }
    const [px, py] = toScr(st.player.x, st.player.y);
    g.fillStyle = "#2a62c9"; g.beginPath(); g.arc(px, py, sc * .35, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#222"; g.font = "12px system-ui"; g.fillText("player (drag)", px + sc * .45, py + 4);
    info.textContent = `t = ${(st.tick / BQSim.TPS).toFixed(1)}s · zones ${st.zones.length} · soaks ${st.soaks.length} · player hit ${st.hits}× for ${st.damage} · ${speed}x${playing ? "" : " (paused)"}`;
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!cv.isConnected) { stop(); return; }
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
    if (playing) { acc += dt * speed * BQSim.TPS; while (acc >= 1) { BQSim.step(st); acc--; } }
    drawNow();
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  cv.addEventListener("mousedown", ev => { drag = true; move(ev); });
  const move = ev => { if (!drag) return; const r = cv.getBoundingClientRect(); const [x, y] = toWorld((ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height); player = { x: Math.round(x * 4) / 4, y: Math.round(y * 4) / 4 }; st.player.x = player.x; st.player.y = player.y; };
  cv.addEventListener("mousemove", move); window.addEventListener("mouseup", () => { drag = false; });
  cv.addEventListener("wheel", ev => { ev.preventDefault(); sc = Math.max(8, Math.min(48, sc * (ev.deltaY < 0 ? 1.15 : 1 / 1.15))); }, { passive: false });
  const playBtn = h("button", { onclick: () => { playing = !playing; playBtn.textContent = playing ? "Pause" : "Play"; } }, "Pause");
  const el = h("div", { class: "mobprev" }, h("b", {}, "Preview"),
    h("div", { class: "hint" }, "Same timing as the server: casts and damage once a second, movement 20 times a second. Drag the player; wheel zooms. Dashed = waiting (delay/stagger, not yet visible in game)."),
    cv, h("div", { class: "bar" }, playBtn, h("button", { onclick: reset }, "Restart"),
      h("select", { class: "speed", onchange: ev => { speed = +ev.target.value; } }, [1, 2, 4].map(v => h("option", { value: v }, v + "x"))),
      h("button", { onclick: () => { playing = false; playBtn.textContent = "Play"; BQSim.step(st); } }, "Step 1/20s")), info);
  return {
    el, stop,
    load(p) { pats = p; reset(); if (!raf) raf = requestAnimationFrame(loop); },
    setImage(v) { bossImg = new Image(); bossImg.src = assetURL(v); },
    get state() { return st; },
  };
}
