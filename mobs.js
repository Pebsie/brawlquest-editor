"use strict";
// Mobs tab: enemies (all columns) and their boss_patterns primitives, with a
// top-down preview driven by mobsim.js (the same rules as the API).

const MOB_NEW = { id: 0, Name: "New mob", ATK: 5, Image: "assets/monsters/spider.png", HP: 20, Range: 1, CanMove: 1, XP: 10, Width: 1, Height: 1, Attributes: "None", AttackSpeed: 1, KnockbackResist: 0, HitEffect: "blood" };
const PRIM_NEW = {
  zone: { every: 3, do: "zone", target: "target", radius: 1, maxRadius: 1, windup: 2, once: true, damage: 20, duration: 2 },
  soak: { every: 10, do: "soak", target: "target", radius: 1.5, damage: 60, duration: 4, failRadius: 8 },
  projectile: { every: 5, do: "projectile", target: "target", castTime: 0.6, interruptible: true, speed: 7, range: 5, radius: 0.3, visual: "web" },
  spawn: { every: 10, do: "spawn", target: "target", castTime: 1, interruptible: true, name: "Summon", count: 2, formation: "spread", spacing: 1.5, max: 4 },
  suicide: { every: 10, do: "suicide", target: "target", damage: 30, radius: 1.5 },
  effect: { every: 8, do: "effect", target: "target", castTime: 0.5, interruptible: true, name: "Curse" },
};
const PRIM_PRESETS = {
  "Ring burst": { every: 6, do: "zone", target: "target", radius: 0.75, maxRadius: 0.75, windup: 2, once: true, damage: 30, duration: 1, count: 8, formation: "ring", anchor: "boss", spacing: 2.5 },
  "Expanding ring": { every: 8, do: "zone", target: "target", radius: 0.75, damage: 15, duration: 4, count: 10, formation: "ring", anchor: "boss", spacing: 1, move: "out", speed: 2 },
  "Aimed line": { every: 5, do: "zone", target: "target", radius: 0.75, maxRadius: 0.75, windup: 2, once: true, damage: 35, duration: 1, count: 6, formation: "line", anchor: "boss", aim: true, spacing: 1.2, stagger: 0 },
  "Rolling wave": { every: 7, do: "zone", target: "target", radius: 1, maxRadius: 1, damage: 20, duration: 5, count: 5, formation: "line", anchor: "boss", aim: true, angle: 90, spacing: 1.5, move: "dir", speed: 2 },
  "Orbiting blades": { every: 12, do: "zone", target: "target", radius: 0.75, damage: 15, duration: 10, count: 3, formation: "ring", anchor: "boss", spacing: 2.5, move: "orbit", spin: 90 },
  "Homing orb": { every: 9, do: "zone", target: "target", radius: 1, maxRadius: 1, windup: 1, damage: 20, duration: 6, formation: "list", offsets: [[0, -4]], move: "follow", speed: 1.5 },
  "Spider web (projectile)": { every: 5, do: "projectile", target: "target", castTime: 0.6, interruptible: true, name: "Web", speed: 7, range: 5, radius: 0.3, effect: 1, visual: "web" },
  "Web fan x3 (projectile)": { every: 7, do: "projectile", target: "target", castTime: 0.8, interruptible: true, name: "Web", speed: 6, range: 6, radius: 0.3, effect: 1, visual: "web", count: 3, spread: 20 },
  "Locked slam (1.5 s cast)": { every: 8, do: "zone", target: "target", castTime: 1.5, name: "Ground Slam", radius: 2, maxRadius: 2, windup: 1, once: true, damage: 40, duration: 1, anchor: "boss", formation: "list", offsets: [[0, 0]] },
  "Summon ring of 4 (spawn)": { every: 20, do: "spawn", target: "target", castTime: 1.5, interruptible: true, name: "Summon", count: 4, formation: "ring", spacing: 2, max: 4 },
  "Self-destruct (suicide)": { every: 6, first: 6, do: "suicide", target: "target", castTime: 1, name: "Self-destruct", damage: 40, radius: 1.5 },
  "Stepping tiles": { every: 6, do: "zone", target: "target", tile: true, radius: 0.5, maxRadius: 0.5, windup: 2, once: true, damage: 40, duration: 1, formation: "list", offsets: [[-1, 0], [0, 0], [1, 0]], stagger: 1 },
};
// [key, label, kind, help, show(a)]
const isZone = a => a.do === "zone", isScr = a => isZone(a), isProj = a => a.do === "projectile", notProj = a => !isProj(a);
const isSpawn = a => a.do === "spawn", isEff = a => a.do === "effect", isBoom = a => a.do === "suicide";
const zoneOrSoak = a => a.do === "zone" || a.do === "soak";
const PRIM_FIELDS = [
  ["every", "Every (s)", "num", "seconds between casts while aggro'd"],
  ["first", "First (s)", "num", "seconds after aggro before the first cast (blank = 1 s)"],
  ["-", "Cast", "head", "the mob stands still and does not attack while it casts; a cast bar shows the name and time left"],
  ["castTime", "Cast time (s)", "num", "0 / blank = instant (projectile: default 0.5). Fractions allowed, max 10. A zone's Windup is its own telegraph after the cast"],
  ["interruptible", "Interruptible", "chk", "off = locked: nothing can interrupt it (grey bar with a lock); on = blue bar, an interrupt cancels it"],
  ["name", "Spell name", "text", "cast bar label (default: Zone, Soak, Web/Shot, Summon, Self-destruct, Curse)"],
  ["damage", "Damage", "num", "per hit (zone: every second it is active; soak: split between players inside; projectile: on hit, 0 = effect only; suicide: burst on players within Radius)", a => !isSpawn(a) && !isEff(a)],
  ["duration", "Duration (s)", "num", "seconds active (zone) or until it resolves (soak)", zoneOrSoak],
  ["radius", "Radius", "num", "tiles; zone is capped at Max radius (0.75 unless raised), soak at 3, projectile hit size (default 0.3, max 1.5), suicide burst (default 1.5)", a => !isSpawn(a) && !isEff(a)],
  ["effect", "Applies effect", "effect", "status effect put on the player (Effects tab): projectile on hit, effect primitive straight on the target", a => isProj(a) || isEff(a)],
  ["visual", "Visual", "vis", "client art: web (projectile), poison (effect splat); others draw a plain bolt / puff", a => isProj(a) || isEff(a)],
  ["speed", "Speed", "num", "tiles/second (default 6, max 20)", isProj],
  ["range", "Range", "num", "tiles; not cast while the target is farther (projectile default 6, max 15; effect default the mob's Range)", a => isProj(a) || isEff(a)],
  ["count", "Count", "num", "shots per cast (max 24)", isProj],
  ["spread", "Spread (deg)", "num", "angle between shots of a fan (default 15)", isProj],
  ["formation", "Formation", "sel:|ring", "ring = count shots evenly all round", isProj],
  ["angle", "Angle (deg)", "num", "added to the aim", isProj],
  ["stagger", "Stagger (ticks)", "num", "1/20 s between each shot of a cast (0 = together)", isProj],
  ["maxRadius", "Max radius", "num", "zone only: raises the 0.75 cap (up to 6)", isZone],
  ["windup", "Windup (s)", "num", "telegraph before it hurts (the cast tick counts one off)", isZone],
  ["once", "Once", "chk", "hit once when it lands, then vanish", isZone],
  ["tile", "Tile", "chk", "snap to the tile and hit whoever stands on it", isZone],
  ["failRadius", "Fail radius", "num", "soak only: if nobody is inside, everyone within this takes full damage", a => a.do === "soak"],
  ["target", "Target", "text", "target / aggro (both mean the mob's current target)"],
  ["-", "Spawn", "head", "adds rise out of the ground in sparks, aggro'd on the caster's target; they never respawn", isSpawn],
  ["enemy", "Enemy", "enemy", "which mob to spawn (Mobs list)", isSpawn],
  ["count", "Count", "num", "adds per cast (max 24)", isSpawn],
  ["max", "Max alive", "num", "most live adds from this caster (0 / blank = no cap)", isSpawn],
  ["anchor", "Anchor", "sel:boss|target", "spawn round the boss (default) or the target", isSpawn],
  ["formation", "Formation", "sel:" + BQSim.FORMATIONS.join("|"), "blank round the boss = spread; ring; line; list (Offsets). Walls are skipped", isSpawn],
  ["spacing", "Spacing", "num", "ring radius / line gap / spread radius (tiles, default 1.5)", isSpawn],
  ["offsets", "Offsets", "pts", "list formation: dx,dy; dx,dy ... in tiles from the anchor", a => isSpawn(a) && a.formation === "list"],
  ["angle", "Angle (deg)", "num", "rotates the formation", isSpawn],
  ["aim", "Aim at target", "chk", "add the boss-to-target bearing to Angle", isSpawn],
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
  ["-", "Look", "head", "art for this primitive; blank = the default red telegraph / bolt. The danger outline is always drawn on top"],
  ["sprite", "Sprite", "sprite", ""],
  ["hitSprite", "Hit sprite", "sprite", "splat where the shot hits or stops (blank = the Visual / default)", isProj],
];
const SPRITE_HINT = { zone: "drawn in the zone (fit radius = stretched to it, tile = repeated). Half strength during windup", soak: "drawn in the soak circle under the timer",
  projectile: "the flying shot (fit scale = native size; Face turns it along its path)", spawn: "telegraph on each spawn spot during the cast",
  suicide: "burst when the mob dies (sized to Radius)", effect: "splat on the target when the effect lands" };
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
    XP: "XP per kill", Width: "tiles wide", Height: "tiles tall", Attributes: "free text, None by default", AttackSpeed: "melee hits per second (1 = once a second)",
    KnockbackResist: "0 = full knockback from hits, 0.5 = half, 1 = immune (bosses hold their ground and walk home after a fight)",
    HitEffect: "what comes off it when hit or killed: blood for flesh, wood chips for trees and chests, stone/crystal/ice shards, bone for skeletons, ectoplasm for ghosts, slime, ichor (spiders), water (fishing spots), metal sparks, embers, leaf, pulp, or none" };
  for (const c of cols) {
    if (c === "id") continue;
    if (c === "Image") { grid.append(h("label", {}, "Sprite"), h("div", {}, h("div", { class: "bar", style: "margin:0;align-items:center" }, img, h("button", { onclick: pickImg }, "Pick sprite…")), imgIn)); continue; }
    if (c === "CanMove") f[c] = h("input", { type: "checkbox" }), f[c].checked = !!+e[c];
    else if (c === "Name" || c === "Attributes") f[c] = txt(e[c]);
    else if (c === "KnockbackResist") f[c] = h("input", { type: "number", class: "num", min: 0, max: 1, step: 0.05, value: e[c] ?? 0 });
    else if (c === "HitEffect") {
      const cur = String(e[c] || "blood").trim().toLowerCase();
      const opts = BQ.HIT_EFFECTS.includes(cur) ? BQ.HIT_EFFECTS : [...BQ.HIT_EFFECTS, cur];
      f[c] = h("select", { name: "HitEffect" }, opts.map(v => h("option", { value: v }, v)));
      f[c].value = cur;
    }
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
      h("button", { class: "primary", onclick: async () => { try { const r = collect(); const id = await save("enemies", r); S.mob = { id }; if (!e.id && S.mobDraft) { await savePatterns(id, S.mobDraft); } renderTab(); } catch { /* shown in the status bar */ } } }, e.id ? "Save mob" : "Create mob"),
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
  // Older projectile rows say "cast"; the form edits castTime (same meaning).
  let acts = initial.map(a => { const b = { ...a }; if (b.do === "projectile" && b.cast && !b.castTime) { b.castTime = b.cast; } delete b.cast; return b; });
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
    const kind = h("select", { onchange: () => { const keep = { every: a.every, target: a.target }; acts[i] = { ...PRIM_NEW[kind.value], ...keep }; draw(); changed(); } },
      BQSim.KINDS.map(k => h("option", { value: k }, k)));
    kind.value = BQSim.KINDS.includes(a.do) ? a.do : "zone";
    const pill = h("span", {});
    const refreshPill = () => { const t = +a.castTime || (isProj(a) ? 0.5 : 0); pill.className = t > 0 ? "pill" + (a.interruptible ? "" : " locked") : ""; pill.textContent = t > 0 ? `${t}s ${a.interruptible ? "interruptible" : "locked"} cast` : "instant"; };
    refreshPill();
    for (const [k, lbl, type, hint, show] of PRIM_FIELDS) {
      if (show && !show(a)) continue;
      if (type === "head") { g.append(h("div", { class: "phead" }, h("b", {}, lbl), " ", h("span", { class: "hint" }, hint))); continue; }
      let el;
      const set = v => { if (v === "" || v === false || v === undefined) delete a[k]; else a[k] = v; refreshPill(); changed(); };
      if (type === "num") { el = h("input", { type: "number", class: "num", step: "any", value: a[k] ?? "" }); el.addEventListener("input", () => set(el.value === "" ? "" : +el.value)); }
      else if (type === "chk") { el = h("input", { type: "checkbox" }); el.checked = !!a[k]; el.addEventListener("change", () => set(el.checked)); }
      else if (type === "text") { el = txt(a[k] || ""); el.addEventListener("input", () => set(el.value)); }
      else if (type === "effect") {
        el = h("select", {}, h("option", { value: "" }, "(none)"), (S.c.effects || []).map(x => h("option", { value: x.id }, `${x.Name} (${x.id})`)));
        el.value = a[k] || ""; el.addEventListener("change", () => set(el.value ? +el.value : ""));
        if (a[k] && !(S.c.effects || []).some(x => x.id === +a[k])) el.append(h("option", { value: a[k] }, `missing effect ${a[k]}`)), el.value = a[k];
      }
      else if (type === "enemy") {
        el = h("select", {}, h("option", { value: "" }, "(pick a mob)"), (S.c.enemies || []).map(x => h("option", { value: x.id }, `${x.Name} (${x.id})`)));
        el.value = a[k] || ""; el.addEventListener("change", () => set(el.value ? +el.value : ""));
        if (a[k] && !(S.c.enemies || []).some(x => x.id === +a[k])) el.append(h("option", { value: a[k] }, `missing enemy ${a[k]}`)), el.value = a[k];
      }
      else if (type === "sprite") {
        el = spriteEditor(() => a[k], v => set(v || ""), { face: isProj(a) && k === "sprite", over: zoneOrSoak(a) && k === "sprite", title: `${k === "hitSprite" ? "Hit sprite" : "Sprite"} for primitive #${i + 1} (${a.do})` });
        el.dataset.key = k;
        g.append(h("label", {}, lbl), h("div", {}, el, h("div", { class: "hint" }, hint || SPRITE_HINT[a.do] || "")));
        continue;
      }
      else if (type === "vis") { el = h("input", { type: "text", list: "shotVisuals", value: a[k] || "" }); el.style.width = "120px"; el.addEventListener("input", () => set(el.value.trim())); }
      else if (type === "pts") { el = txt(fmtPts(a[k]), "e.g. 0,-2; 2,0; 0,2"); el.addEventListener("input", () => { const p = parsePts(el.value); set(p.length ? p : ""); }); }
      else { el = h("select", {}, type.slice(4).split("|").map(o => h("option", { value: o }, o || "(none)"))); el.value = a[k] || ""; el.addEventListener("change", () => { set(el.value); draw(); }); }
      el.dataset.key = k;
      g.append(h("label", {}, lbl), h("div", {}, el, " ", h("span", { class: "hint" }, hint)));
    }
    return h("div", { class: "step prim", "data-i": i },
      h("div", { class: "top" }, h("b", {}, `#${i + 1}`), kind,
        h("span", { class: "hint" }, ({ soak: "shared circle on the target; resolves when its timer runs out", projectile: "cast, then shots fly at the target; walls stop them",
          spawn: "summons adds", suicide: "the mob dies (optional burst)", effect: "puts a status effect on the target in range" })[a.do] || (BQSim.scripted(a) ? "scripted zone" : "plain zone on the target")),
        pill,
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
    h("p", { class: "hint" }, "Mobs and bosses use only these primitives (boss_patterns). Each one runs on its own timer while the mob is aggro'd; the first cast is one second after aggro unless First is set. One cast at a time: a primitive that comes due mid-cast waits a second. Projectiles and the effect primitive apply effects from the ", link("#effects", "Effects tab"), "."),
    h("datalist", { id: "shotVisuals" }, h("option", { value: "web" }), h("option", { value: "poison" })),
    h("div", { class: "mobsplit" },
      h("div", { class: "mobprims" }, list,
        h("div", { class: "bar" },
          h("button", { onclick: () => { acts.push({ ...PRIM_NEW.zone }); draw(); changed(); } }, "+ Zone"),
          h("button", { onclick: () => { acts.push({ ...PRIM_NEW.soak }); draw(); changed(); } }, "+ Soak"),
          h("button", { onclick: () => { const p = { ...PRIM_NEW.projectile }; if ((S.c.effects || [])[0]) p.effect = S.c.effects[0].id; acts.push(p); draw(); changed(); } }, "+ Projectile"),
          h("button", { onclick: () => { const p = { ...PRIM_NEW.spawn }; const o = (S.c.enemies || []).find(x => x.id !== e.id) || (S.c.enemies || [])[0]; if (o) p.enemy = o.id; acts.push(p); draw(); changed(); } }, "+ Spawn"),
          h("button", { onclick: () => { acts.push({ ...PRIM_NEW.suicide }); draw(); changed(); } }, "+ Suicide"),
          h("button", { onclick: () => { const p = { ...PRIM_NEW.effect }; if ((S.c.effects || [])[0]) p.effect = S.c.effects[0].id; acts.push(p); draw(); changed(); } }, "+ Effect"), preset,
          h("button", { class: "primary", id: "save-patterns", onclick: async () => {
            if (!e.id) { status("Create the mob first: its patterns are saved with it.", true); return; }
            try { acts.forEach((a, i) => BQSim.validate(BQSim.clean(a), i)); } catch (err) { status(err.message, true); return; }
            try { await savePatterns(e.id, acts); } catch { return; }
            S.mob = { id: e.id }; dirty = false; renderTab();
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
  const effDefs = () => Object.fromEntries((S.c.effects || []).map(x => [x.id, x]));
  const enemyDefs = () => Object.fromEntries((S.c.enemies || []).map(x => [x.id, x]));
  const reset = () => { st = BQSim.create({ boss, player: { ...player }, patterns: pats, effects: effDefs(), enemies: enemyDefs(), bossRange: +e.Range || 1 }); acc = 0; sparks = []; seenAdds = new Set(); };
  let sparks = [], seenAdds = new Set();
  const addImgs = {};
  const addImg = id => { const d = (S.c.enemies || []).find(x => x.id === +id); if (!d) return null; if (!addImgs[id]) { addImgs[id] = new Image(); addImgs[id].src = assetURL(d.Image || ""); } return addImgs[id]; };
  // Anvil-style sparks (client mob-casts.lua): up and out, gravity, fade orange.
  const burst = (x, y) => { for (let i = 0; i < 18; i++) { const a = -Math.PI / 2 + (Math.random() * 2 - 1) * 1.3, v = 1.6 + Math.random() * 3.7, life = .3 + Math.random() * .45; sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: 2 + Math.random() * 2 }); } };
  // Cast bar over the boss: grey panel, blue fill when interruptible, grey with a lock when locked.
  const castBar = (g, cx, top, c) => {
    const w = 64, hgt = 8, x = Math.round(cx - w / 2), y = Math.round(top - 14), k = 1 - c.left / Math.max(1, c.total);
    g.fillStyle = "rgba(41,41,41,.9)"; g.fillRect(x, y, w, hgt);
    g.fillStyle = c.locked ? "#9e9e9e" : "#6bb8f2"; g.fillRect(x + 1, y + 1, (w - 2) * k, hgt - 2);
    g.strokeStyle = "#8c8c8c"; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, hgt - 1);
    if (c.locked) { g.strokeStyle = "#555"; g.beginPath(); g.arc(x - 7, y + 3, 2.5, Math.PI, 0); g.stroke(); g.fillStyle = "#555"; g.fillRect(x - 10.5, y + 3, 7, 5); }
    g.fillStyle = "#222"; g.font = "11px system-ui"; g.fillText(c.name, x, y - 3);
    const left = (c.left / BQSim.TPS).toFixed(1) + "s"; g.fillText(left, x + w - g.measureText(left).width, y + hgt + 11);
  };
  const castBreak = (g, cx, top, b) => {
    const t = (st.tick - b.t) / 15, w = 64, hgt = 8, x = Math.round(cx - w / 2), y = Math.round(top - 14) + 20 * t * t, split = (w - 2) * b.k;
    g.globalAlpha = 1 - t; g.fillStyle = "#cc4d40"; g.save(); g.translate(x + split / 2, y); g.rotate(-.5 * t); g.fillRect(-split / 2, 0, Math.max(2, split), hgt); g.restore();
    g.fillStyle = "rgba(41,41,41,.9)"; g.save(); g.translate(x + split + (w - split) / 2 + 4 * t, y); g.rotate(.4 * t); g.fillRect(-(w - split) / 2, 0, w - split, hgt); g.restore();
    g.fillStyle = "#c0392b"; g.font = "11px system-ui"; g.fillText("Interrupted", x, Math.round(top - 17) - 6 * t); g.globalAlpha = 1;
  };
  const webImg = new Image(); webImg.src = assetURL("assets/world/objects/Web.png");
  const webStar = (g, x, y, rad, rot) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.strokeStyle = "#555"; g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.moveTo(0, 0); g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
    g.stroke(); g.beginPath(); g.arc(0, 0, rad * .55, 0, Math.PI * 2); g.stroke(); g.restore();
  };
  const toScr = (x, y) => [W / 2 + x * sc, H / 2 + y * sc];
  const toWorld = (px, py) => [(px - W / 2) / sc, (py - H / 2) / sc];
  function drawNow() {
    const g = cv.getContext("2d");
    g.fillStyle = "#e9ecef"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#d0d4d9"; g.lineWidth = 1;
    for (let i = -20; i <= 20; i++) { const [x] = toScr(i - .5, 0), [, y] = toScr(0, i - .5); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const [bx, by] = toScr(boss.x - .5, boss.y - .5);
    if (st.bossDead) { g.strokeStyle = "#999"; g.setLineDash([3, 3]); g.strokeRect(bx, by, boss.w * sc, boss.h * sc); g.setLineDash([]); g.fillStyle = "#777"; g.font = "11px system-ui"; g.fillText("dead (suicide)", bx, by - 4); }
    else if (bossImg.complete && bossImg.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(bossImg, bx, by, boss.w * sc, boss.h * sc); }
    else { g.fillStyle = "#666"; g.fillRect(bx, by, boss.w * sc, boss.h * sc); }
    // spawn telegraph, then adds rising out of the ground over 0.4 s
    for (const c of st.casts) for (const [sx, sy] of c.spots || []) {
      const [x, y] = toScr(sx, sy), k = 1 - c.left / Math.max(1, c.total);
      if (c.a.sprite) BQFX.draw(g, c.a.sprite, x, y + sc * .05, sc * .5, (c.total - c.left) / BQSim.TPS, { alpha: .5 + .5 * k, zoom: sc / 32 });
      else { g.fillStyle = `rgba(120,140,190,${.15 + .25 * k})`; g.beginPath(); g.ellipse(x, y + sc * .3, sc * (.2 + .3 * k), sc * (.1 + .15 * k), 0, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = "#7d8fb8"; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y + sc * .3, sc * .5, sc * .25, 0, 0, Math.PI * 2); g.stroke();
    }
    for (const a of st.adds) {
      const [x, y] = toScr(a.x - .5, a.y - .5);
      if (!seenAdds.has(a.id)) { seenAdds.add(a.id); burst(x + sc / 2, y + sc); }
      const k = Math.min(1, (st.tick - a.born + acc) / (.4 * BQSim.TPS)), e2 = 1 - (1 - k) * (1 - k), im = addImg(a.enemy);
      g.save(); g.translate(x + sc / 2, y + sc); g.scale(e2, e2); g.globalAlpha = e2;
      if (im && im.complete && im.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(im, -sc / 2, -sc, sc, sc); } else { g.fillStyle = "#888"; g.fillRect(-sc / 2, -sc, sc, sc); }
      g.restore(); g.globalAlpha = 1;
    }
    const sdt = 1 / 60;
    sparks = sparks.filter(p => { p.life -= sdt; if (p.life <= 0) return false; p.vy += .17; p.vx *= .97; p.x += p.vx; p.y += p.vy; const t = 1 - p.life / p.max; g.fillStyle = `rgba(255,${Math.round(255 * (1 - t * .75))},${Math.round(255 * Math.max(0, .6 - t * 1.6))},${1 - t * t})`; g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); return true; });
    const shape = (z, fill, stroke, k = 1) => {
      const [x, y] = toScr(z.x, z.y);
      g.beginPath();
      if (z.tile) g.rect(x - sc / 2 * k, y - sc / 2 * k, sc * k, sc * k); else g.arc(x, y, Math.max(1, z.r * sc * k), 0, Math.PI * 2);
      if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); }
    };
    for (const z of st.zones) {
      if (z.delay > 0) { g.setLineDash([3, 3]); g.lineWidth = 1; shape(z, null, "rgba(200,40,20,.35)"); g.setLineDash([]); continue; }
      g.lineWidth = 2;
      // sprite (fx.js) instead of the red fill unless "over"; the outline stays
      const fx = z.spr ? BQFX.norm(z.spr) : null, plain = !fx || fx.over, age = (st.tick - (z.born || 0) + acc) / BQSim.TPS;
      const spr = al => { const [x, y] = toScr(z.x, z.y); BQFX.draw(g, fx, x, y, z.r * sc, age, { alpha: al, zoom: sc / 32 }); };
      if (z.windup > 0) {
        const k = Math.min(1, (z.windup0 - z.windup + (st.tick % BQSim.TPS) / BQSim.TPS) / Math.max(1, z.windup0));
        if (plain) shape(z, "rgba(255,64,26,.18)", null);
        if (fx) spr(.35 + .25 * k);
        shape(z, null, "rgba(255,110,50,.9)"); shape(z, null, "rgba(255,110,50,.9)", .15 + .85 * k);
      } else { if (plain) shape(z, "rgba(255,30,20,.45)", null); if (fx) spr(1); shape(z, null, "rgba(220,40,20,1)"); }
    }
    for (const s of st.soaks) {
      const [x, y] = toScr(s.x, s.y), k = 1 - s.left / s.duration;
      g.lineWidth = 1; g.setLineDash([4, 4]); g.strokeStyle = "rgba(160,120,0,.5)"; g.beginPath(); g.arc(x, y, s.fail * sc, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      if (s.spr) BQFX.draw(g, s.spr, x, y, s.r * sc, (st.tick - (s.born || 0) + acc) / BQSim.TPS, { zoom: sc / 32 });
      g.fillStyle = s.spr && !BQFX.norm(s.spr).over ? "rgba(240,190,20,.2)" : "rgba(240,190,20,.35)"; g.beginPath(); g.moveTo(x, y); g.arc(x, y, s.r * sc, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.closePath(); g.fill();
      g.lineWidth = 2; g.strokeStyle = "#b8860b"; g.beginPath(); g.arc(x, y, s.r * sc, 0, Math.PI * 2); g.stroke();
    }
    for (const f of st.flashes) {
      const o = f.zone || f.soak; if (!o) continue;
      g.globalAlpha = 1 - (st.tick - f.t) / 8; g.lineWidth = 3; shape(o, f.zone ? "rgba(255,30,20,.5)" : "rgba(240,190,20,.5)", "#c00"); g.globalAlpha = 1;
    }
    // projectile casts (aim line, locked at cast start), shots and splats
    const [bcx, bcy] = toScr(boss.x - .5 + boss.w / 2, boss.y - .5 + boss.h / 2);
    for (const c of st.casts) {
      if (c.a.do !== "projectile") continue;
      const [ax, ay] = toScr(c.tx - .5, c.ty - .5), k = 1 - c.left / Math.max(1, c.total);
      g.setLineDash([5, 4]); g.strokeStyle = `rgba(90,90,90,${.3 + .5 * k})`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bcx, bcy); g.lineTo(ax, ay); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#fff"; g.strokeStyle = "#555"; g.beginPath(); g.arc(bcx, bcy, 2 + 4 * k, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    for (const s of st.shots) {
      if (s.wait > 0) continue;
      const [x, y] = toScr(s.x - .5, s.y - .5);
      if (s.spr) BQFX.draw(g, s.spr, x, y, Math.max(5, s.r * sc), (st.tick + acc) / BQSim.TPS, { fit: "scale", angle: Math.atan2(s.dy, s.dx), zoom: sc / 32 });
      else if (s.visual === "web") webStar(g, x, y, Math.max(5, s.r * sc * 1.4), st.tick * .3);
      else { g.fillStyle = "#7a3d8c"; g.beginPath(); g.arc(x, y, Math.max(3, s.r * sc), 0, Math.PI * 2); g.fill(); }
    }
    for (const f of st.flashes) {
      if (!f.splat) continue;
      const k = (st.tick - f.t) / 12, [x, y] = toScr(f.splat.x - .5, f.splat.y - .5);
      g.globalAlpha = 1 - k;
      if (f.splat.spr) { g.globalAlpha = 1; const r = f.splat.visual === "burst" ? (f.splat.r || 1.5) * sc : 24 * sc / 32; BQFX.draw(g, f.splat.spr, x, y, r, (st.tick - f.t + acc) / BQSim.TPS, { fit: f.splat.visual === "burst" ? "radius" : "scale", alpha: 1 - k * k, zoom: sc / 32 }); }
      else if (f.splat.visual === "web" && webImg.complete && webImg.naturalWidth) { const w = sc * (.6 + .8 * Math.min(1, k * 3)); g.drawImage(webImg, x - w / 2, y - w / 2, w, w); }
      else if (f.splat.visual === "burst") { g.fillStyle = "rgba(255,140,60,.5)"; g.beginPath(); g.arc(x, y, (f.splat.r || 1.5) * sc * Math.min(1, .3 + k * 2), 0, Math.PI * 2); g.fill(); }
      else if (f.splat.visual === "poison") { g.fillStyle = "rgba(110,200,80,.7)"; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.arc(x + Math.cos(a) * 8 * k, y + Math.sin(a) * 5 * k - 10 * k, 3, 0, Math.PI * 2); g.fill(); } }
      else { g.strokeStyle = "#7a3d8c"; g.beginPath(); g.arc(x, y, 4 + 10 * k, 0, Math.PI * 2); g.stroke(); }
      g.globalAlpha = 1;
    }
    const bossTop = toScr(0, boss.y - .5)[1];
    if (st.casts[0] && !st.bossDead) castBar(g, bcx, bossTop, st.casts[0]);
    else if (st.breaks.length) castBreak(g, bcx, bossTop, st.breaks[st.breaks.length - 1]);
    const [px, py] = toScr(st.player.x, st.player.y);
    const mult = BQSim.moveMult(st);
    g.fillStyle = mult < 1 ? "#6d8fcf" : "#2a62c9"; g.beginPath(); g.arc(px, py, sc * .35, 0, Math.PI * 2); g.fill();
    const defs = st.effectDefs;
    if (st.effects.some(e => (defs[e.id] || {}).Visual === "web") && webImg.complete && webImg.naturalWidth) g.drawImage(webImg, px - sc * .5, py - sc * .5, sc, sc);
    for (const e of st.effects) { const v = (defs[e.id] || {}).Visual; if (v && BQFX.parse(v)) BQFX.draw(g, v, px, py, sc * .5, (st.tick + acc) / BQSim.TPS, { fit: "scale", zoom: sc / 32 }); }
    g.fillStyle = "#222"; g.font = "12px system-ui"; g.fillText("player (drag)", px + sc * .45, py + 4);
    st.effects.forEach((e, i) => { const d = defs[e.id] || {}; g.fillText(`${d.Name || "effect " + e.id} ${e.left.toFixed(1)}s${e.stacks > 1 ? " x" + e.stacks : ""}`, px + sc * .45, py + 18 + i * 14); });
    info.textContent = `t = ${(st.tick / BQSim.TPS).toFixed(1)}s · zones ${st.zones.length} · soaks ${st.soaks.length} · shots ${st.shots.length}` + (st.adds.length ? ` · adds ${st.adds.length}` : "") +
      (st.casts[0] ? ` · casting ${st.casts[0].name}${st.casts[0].locked ? " (locked)" : ""}` : "") + ` · player hit ${st.hits}× for ${st.damage}` +
      (mult !== 1 ? ` · move x${mult.toFixed(2)}` : "") + ` · ${speed}x${playing ? "" : " (paused)"}`;
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
    h("div", { class: "hint" }, "Same timing as the server: casts and damage once a second, movement 20 times a second. Drag the player; wheel zooms. Dashed = waiting (delay/stagger, not yet visible in game). Spawned adds stand still here (their own patterns are not run)."),
    cv, h("div", { class: "bar" }, playBtn, h("button", { onclick: reset }, "Restart"),
      h("select", { class: "speed", onchange: ev => { speed = +ev.target.value; } }, [1, 2, 4].map(v => h("option", { value: v }, v + "x"))),
      h("button", { onclick: () => { playing = false; playBtn.textContent = "Play"; BQSim.step(st); } }, "Step 1/20s"),
      h("button", { title: "Test an interrupt (no player ability triggers one in game yet)", onclick: () => { const c = st.casts[0]; status(!c ? "Nothing is casting." : BQSim.interrupt(st) ? `Interrupted ${c.name}.` : `${c.name} is locked: it cannot be interrupted.`, !!c && c.locked); } }, "Interrupt")), info);
  return {
    el, stop,
    load(p) { pats = p; reset(); if (!raf) raf = requestAnimationFrame(loop); },
    setImage(v) { bossImg = new Image(); bossImg.src = assetURL(v); },
    get state() { return st; },
  };
}

// Effect sprite field (primitive forms and the Effects tab): live preview,
// Pick… opens the sprite picker on the effect art, plus animation settings.
// get() returns the stored definition; set(def or null).
const fxPickerGroups = () => [...BQFX.groups(), { id: "objects", label: "World objects", entries: folderEntries("assets/world/objects/") },
  { id: "items", label: "Items", entries: folderEntries("assets/items/") }, { id: "monsters", label: "Monsters", entries: folderEntries("assets/monsters/") },
  { id: "all", label: "Everything", entries: assetPaths().map(v => ({ value: v })) }];
const FX_LOOK_KEYS = ["scale", "tint", "alpha", "rot", "spin", "blend", "over", "face"];
function spriteEditor(get, set, o = {}) {
  const box = h("div", { class: "fxedit" });
  const draw = () => {
    const s = BQFX.parse(get());
    const name = h("span", { class: "fxname" }, s ? (s.style ? "procedural: " + s.style : spriteLabel(s.img)) : "default (no sprite)");
    const pick = () => openPicker({ title: o.title || "Effect sprite", groups: fxPickerGroups, group: "fx", recentKey: "fx", value: s ? (s.style ? "style:" + s.style : s.img) : "",
      onPick: v => {
        if (!v) return;
        const cur = BQFX.parse(get()), keep = {}; if (cur) for (const k of FX_LOOK_KEYS) if (cur[k] !== undefined) keep[k] = cur[k];
        const def = v.startsWith("style:") ? { style: v.slice(6) } : BQFX.fromManifest(v);
        set(BQFX.clean({ ...def, ...keep, ...(def.face && keep.face === undefined ? { face: true } : {}) })); draw();
      } });
    const head = h("div", { class: "bar", style: "margin:0;align-items:center" }, BQFX.previewCanvas(get, 56), name,
      h("button", { class: "fxpick", onclick: pick }, s ? "Change…" : "Pick sprite…"), s ? h("button", { onclick: () => { set(null); draw(); } }, "Clear") : null);
    box.replaceChildren(head);
    if (!s) return;
    const upd = (k, v) => { const c = { ...BQFX.parse(get()) }; if (v === "" || v === undefined || v === false) delete c[k]; else c[k] = v; set(BQFX.clean(c)); };
    const numIn = (k, step, ph) => { const el = h("input", { type: "number", class: "num", step, placeholder: ph || "", value: s[k] ?? "", "data-fx": k }); el.addEventListener("input", () => upd(k, el.value === "" ? "" : +el.value)); return el; };
    const chk = (k, on) => { const el = h("input", { type: "checkbox", "data-fx": k }); el.checked = on === undefined ? !!s[k] : on; return el; };
    const fit = h("select", { "data-fx": "fit" }, ["", "radius", "tile", "scale"].map(v => h("option", { value: v }, v || "(default)"))); fit.value = s.fit || "";
    fit.addEventListener("change", () => upd("fit", fit.value));
    const tintOn = chk("tint", !!s.tint), tint = h("input", { type: "color", value: s.tint || "#ffffff", "data-fx": "tintColor" });
    tintOn.addEventListener("change", () => upd("tint", tintOn.checked ? tint.value : "")); tint.addEventListener("input", () => { tintOn.checked = true; upd("tint", tint.value); });
    const loop = chk("loop", s.loop !== false); loop.addEventListener("change", () => upd("loop", loop.checked ? "" : false));
    const add = chk("blend", s.blend === "add"); add.addEventListener("change", () => upd("blend", add.checked ? "add" : ""));
    const row = (...k) => h("div", { class: "fxrow" }, ...k);
    const parts = [];
    if (!s.style) parts.push(row("frames", numIn("frames", "1", "1"), "frame w", numIn("fw", "1", "auto"), "h", numIn("fh", "1", "auto"), "cols", numIn("cols", "1", "all"), "fps", numIn("fps", "1", "10"), h("label", {}, loop, " loop")));
    parts.push(row("fit", fit, "scale", numIn("scale", "0.1", "1"), "alpha", numIn("alpha", "0.05", "1"), "rotate°", numIn("rot", "1", "0"), "spin°/s", numIn("spin", "1", "0")));
    const extra = [h("label", {}, tintOn, " tint "), tint, h("label", {}, add, " additive")];
    if (o.face) { const f = chk("face", s.face !== false && !!s.face); f.addEventListener("change", () => upd("face", f.checked)); extra.push(h("label", {}, f, " face travel")); }
    if (o.over) { const ov = chk("over"); ov.addEventListener("change", () => upd("over", ov.checked)); extra.push(h("label", {}, ov, " keep red fill under it")); }
    parts.push(row(...extra));
    box.append(h("details", { class: "fxset" }, h("summary", { class: "hint" }, "Animation and look"), ...parts,
      h("div", { class: "hint" }, "Frames are cut left to right (cols per row for a grid sheet). fit: radius stretches one frame over the circle, tile repeats it at native size clipped to the circle, scale draws it at native size × scale.")));
  };
  draw();
  return box;
}
