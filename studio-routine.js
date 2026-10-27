"use strict";
// NPC routines: where one placement of an NPC walks, at what time of day,
// how fast, and how long it stands at each point. The server walks them
// (the API's npc.go tickRoutine, docs/NPC_ROUTINES.md); this draws them on the
// map, lets you lay and drag the points, and plays the walk back the way the
// server will (one tick a second, a step of one tile, diagonals first).
//
// Data: routine (NPC, TriggerHour 1-24, Loop 0 once / 1 repeat / 2 there and
// back, Spawn: the npc_spawn row, 0 the first placement, Speed tiles a
// second) and routineNode (Routine, X, Y, Position, Wait seconds).
// A day is 30 minutes; one game hour is 75 seconds.

const RT_HOUR = 75, RT_DAY = 24 * RT_HOUR;
const RT_LOOP = [[0, "Once", "walks the path once, then stays at the end until their next walk"], [1, "Round and round", "walks it, then starts again from the first point, all hour"], [2, "There and back", "walks to the end and back again, all hour"]];
const RT_SPEED = [[0.5, "Stroll"], [1, "Walk"], [2, "Hurry"]];
const rtHourLabel = h => String(h % 24).padStart(2, "0") + ":00";
const rtNight = h => (h % 24) < 6 || (h % 24) >= 18;

// The NPC's walks at one placement: the first placement's are Spawn 0 (and
// its own id); any other's are Spawn = its npc_spawn id.
function rtFor(n, sp) {
  if (!n || !sp) return [];
  const spots = spawnsOf(n), first = spots[0];
  const isFirst = !first || (first.X === sp.X && first.Y === sp.Y && first.id === sp.id);
  const nodes = rtNodesBy();
  return (S.c.routines || []).filter(r => r.NPC === n.id && (isFirst ? r.Spawn === 0 || (sp.id && r.Spawn === sp.id) : sp.id && r.Spawn === sp.id))
    .map(r => ({ id: r.id, TriggerHour: r.TriggerHour, Loop: +r.Loop || 0, Speed: +r.Speed > 0 ? +r.Speed : 1, nodes: (nodes[r.id] || []).map(p => ({ id: p.id, X: p.X, Y: p.Y, Wait: +p.Wait || 0 })) }))
    .sort((a, b) => (a.TriggerHour % 24) - (b.TriggerHour % 24) || a.id - b.id);
}
function rtNodesBy() {
  if (S._rtNodes && S._rtNodes.src === S.c.routineNodes) return S._rtNodes.by;
  const by = {};
  for (const p of S.c.routineNodes || []) (by[p.Routine] = by[p.Routine] || []).push(p);
  for (const k in by) by[k].sort((a, b) => (a.Position - b.Position) || (a.id - b.id));
  S._rtNodes = { src: S.c.routineNodes, by };
  return by;
}
const rtKids = (...a) => a.flat().filter(x => x != null && x !== false);

// ---- the server's walk, tick by tick (npc.go tickRoutine / routineAdvance)
function rtAdvance(v, r, h) {
  const n = r.nodes.length;
  if (!v.dir) v.dir = 1;
  if (r.Loop === 2 && n > 1) {
    let next = v.node + v.dir;
    if (next >= n || next < 0) {
      if (h !== r.TriggerHour) { v.cur = -1; v.node = 0; return false; }
      v.dir = -v.dir; next = v.node + v.dir;
    }
    v.node = next; return true;
  }
  v.node++;
  if (v.node >= n) {
    if (r.Loop === 1 || h !== r.TriggerHour) { v.cur = -1; v.node = 0; } else v.node = n - 1;
    return false;
  }
  return true;
}
function rtTick(v, list, h) {
  if (v.wait > 0) { v.wait--; return; }
  const r = list[v.cur];
  if (!r || !r.nodes.length || v.node >= r.nodes.length) {
    v.cur = -1; v.node = 0;
    list.forEach((x, k) => { if (x.TriggerHour === h) { v.cur = k; v.node = 0; v.dir = 1; v.wait = 0; v.step = 0; } });
    return;
  }
  const speed = r.Speed > 0 ? r.Speed : 1;
  v.step += speed;
  for (let g = 0; v.step >= 1 && g < 2 * r.nodes.length + Math.trunc(speed) + 2; g++) {
    const p = r.nodes[v.node];
    if (p.X !== v.x || p.Y !== v.y) {
      v.x += Math.sign(p.X - v.x); v.y += Math.sign(p.Y - v.y); v.step--;
      if (p.X !== v.x || p.Y !== v.y) continue;
    }
    v.wait = p.Wait || 0;
    if (!rtAdvance(v, r, h) || v.wait > 0) { v.step = 0; return; }
  }
  if (v.step >= 1) v.step = 0;
}
// A whole day (tick 0 is 00:00), run twice so where they start the day is
// where yesterday left them. frames[t] = { x, y, cur, wait }.
function rtSimDay(sp, list) {
  const v = { x: sp.X, y: sp.Y, cur: -1, node: 0, dir: 1, wait: 0, step: 0 };
  const frames = new Array(RT_DAY);
  for (let pass = 0; pass < 2; pass++) for (let t = 0; t < RT_DAY; t++) {
    const h = Math.floor(t / RT_HOUR) || 24;
    rtTick(v, list, h);
    if (pass) frames[t] = { x: v.x, y: v.y, cur: v.cur, wait: v.wait };
  }
  return frames;
}
// One walk inside the day: the ticks it runs, the tiles it steps on.
function rtWalkInfo(frames, k, r) {
  const start = (r.TriggerHour % 24) * RT_HOUR;
  let end = start, arrive = -1;
  for (let i = 0; i < RT_DAY; i++) {
    const t = (start + i) % RT_DAY, f = frames[t];
    if (f.cur !== k) { if (i > 1) break; continue; }
    end = start + i;
  }
  const tiles = new Map();
  let prev = frames[(start + RT_DAY - 1) % RT_DAY];
  const from = { x: prev.x, y: prev.y };
  for (let t = start; t <= end + 1; t++) {
    const f = frames[t % RT_DAY];
    // fill the tiles stepped over between two ticks (speed above 1)
    let x = prev.x, y = prev.y;
    while (x !== f.x || y !== f.y) { x += Math.sign(f.x - x); y += Math.sign(f.y - y); tiles.set(x + "," + y, { x, y }); }
    if (arrive < 0 && r.nodes.length && f.x === r.nodes[r.nodes.length - 1].X && f.y === r.nodes[r.nodes.length - 1].Y) arrive = t - start;
    prev = f;
  }
  return { start, end, len: end - start + 1, from, tiles: [...tiles.values()], arrive };
}
const rtSolid = (x, y) => { if (!S.world) return false; const t = S.world.tiles.get(x + "," + y); return !t || t[5] === 1; };
const rtSecs = s => (s >= 60 ? Math.floor(s / 60) + " min " + (s % 60 ? (s % 60) + " s" : "") : s + " s").trim();

// ---- the editor
async function rtSave(n, sp, list, label) {
  const spawn = sp.id || 0, before = rtFor(n, sp);
  const clean = list.map(r => ({ id: r.id, TriggerHour: r.TriggerHour, Loop: r.Loop, Speed: r.Speed, nodes: r.nodes.map(p => ({ id: p.id, X: p.X, Y: p.Y, Wait: p.Wait })) }));
  try { await api("routineSet", { npc: n.id, spawn, routines: clean }); }
  catch (e) { await loadAll(); qsToast(e.message); status(e.message, true); throw e; }
  await loadAll();
  QS.undo.push({ routine: { npc: n.id, spawn, before, after: rtFor(n, sp) }, label });
  if (QS.undo.length > 200) QS.undo.shift();
  QS.redo = [];
  qsToast(`${label}. Saved in the working db (autosaved to History).`);
  qsBar();
}

function qsRoutinePanel(n) {
  const sp = spawnsOf(n).find(v => QS.spot && !QS.spot.add && v.X === QS.spot.X && v.Y === QS.spot.Y) || spawnsOf(n)[0];
  const box = h("div", { class: "qs-win qs-routine", id: "qs-routine" });
  if (!sp) {
    box.append(h("div", { class: "qs-wtitle" }, h("span", {}, "DAILY ROUTINE")), h("div", { class: "qs-wbody" }, h("p", { class: "hint" }, `Put ${n.Name} somewhere first (Where they stand), then give them somewhere to walk.`)));
    return box;
  }
  const key = n.id + ":" + sp.id + ":" + sp.X + "," + sp.Y;
  if (!QS.rt || QS.rt.key !== key) QS.rt = { key, sel: 0, pt: -1, view: { cx: sp.X, cy: sp.Y, sc: 16 } };
  const R = QS.rt;
  let list = rtFor(n, sp), frames = rtSimDay(sp, list);
  const anim = { on: false };
  const cur = () => list[R.sel];
  const commit = async (next, label) => { await rtSave(n, sp, next, label); list = rtFor(n, sp); frames = rtSimDay(sp, list); controls(); map.redraw(); };
  const copy = () => list.map(r => ({ ...r, nodes: r.nodes.map(p => ({ ...p })) }));

  // the map: tap to lay a point, drag a point to move it, tap one to pick it
  let drag = null;
  const map = qsWorldCanvas({ st: R.view, w: 460, h: 300, mark: n.id,
    hide: () => (anim.on ? { npc: n.id, X: sp.X, Y: sp.Y } : null),
    overlay: (g, px, py, sc) => rtDraw(g, px, py, sc),
    grab: (x, y) => {
      const r = cur(); if (!r || anim.on) return false;
      const i = r.nodes.findIndex(p => p.X === x && p.Y === y);
      if (i < 0) return false;
      drag = { i, x, y }; return true;
    },
    drag: (x, y) => { if (drag) { drag.x = x; drag.y = y; } },
    drop: async (x, y, moved) => {
      const d = drag; drag = null; if (!d) return;
      if (!moved || (x === cur().nodes[d.i].X && y === cur().nodes[d.i].Y)) { R.pt = R.pt === d.i ? -1 : d.i; controls(); map.redraw(); return; }
      const next = copy(); next[R.sel].nodes[d.i] = { ...next[R.sel].nodes[d.i], X: x, Y: y };
      await commit(next, `Moved point ${d.i + 1} of ${n.Name}'s ${rtHourLabel(cur().TriggerHour)} walk to ${x},${y}`);
    },
    onPick: async (x, y) => {
      const r = cur(); if (anim.on) return;
      if (!r) { qsToast("Pick an hour above to start a walk first"); return; }
      const next = copy(), at = R.pt >= 0 ? R.pt + 1 : r.nodes.length;
      next[R.sel].nodes.splice(at, 0, { id: 0, X: x, Y: y, Wait: 0 });
      R.pt = R.pt >= 0 ? at : -1;
      await commit(next, `${n.Name} walks to ${x},${y} at ${rtHourLabel(r.TriggerHour)}`);
    } });
  map.classList.add("qs-rtmap");

  function rtDraw(g, px, py, sc) {
    const c = s => [px(s.X ?? s.x) + sc / 2, py(s.Y ?? s.y) + sc / 2];
    list.forEach((r, k) => {
      if (!r.nodes.length) return;
      const on = k === R.sel, info = rtWalkInfo(frames, k, r);
      // the tiles they actually step on (straight, diagonals first)
      for (const t of info.tiles) {
        const bad = rtSolid(t.x, t.y);
        g.fillStyle = bad ? "rgba(255,89,89,.85)" : on ? "rgba(242,204,89,.55)" : "rgba(255,255,255,.25)";
        const s = Math.max(3, sc / 3);
        g.fillRect(px(t.x) + sc / 2 - s / 2, py(t.y) + sc / 2 - s / 2, s, s);
      }
      // lines point to point (dashed back to the first: round and round)
      g.strokeStyle = on ? "#f2cc59" : "rgba(255,255,255,.5)"; g.lineWidth = on ? 2 : 1;
      g.beginPath();
      const pts = drag && on ? r.nodes.map((p, i) => (i === drag.i ? { X: drag.x, Y: drag.y } : p)) : r.nodes;
      pts.forEach((p, i) => { const [x, y] = c(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
      if (r.Loop === 1 && pts.length > 1) { g.setLineDash([4, 4]); g.beginPath(); g.moveTo(...c(pts[pts.length - 1])); g.lineTo(...c(pts[0])); g.stroke(); g.setLineDash([]); }
      if (!on) return;
      pts.forEach((p, i) => {
        const [x, y] = c(p), rad = Math.max(7, sc / 2.4);
        g.fillStyle = i === R.pt ? "#731f1f" : "#000"; g.strokeStyle = i === R.pt ? "#fff" : "#f2cc59"; g.lineWidth = 2;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.strokeRect(x - rad, y - rad, rad * 2, rad * 2);
        g.fillStyle = "#fff"; g.font = `${Math.round(rad * 1.5)}px BMmini, monospace`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(i + 1), x, y + 1);
        if (p.Wait || (r.nodes[i] && r.nodes[i].Wait)) { g.fillStyle = "#f2cc59"; g.font = "12px BMmini, monospace"; g.fillText((r.nodes[i].Wait) + "s", x, y - rad - 6); }
      });
      g.textAlign = "start"; g.textBaseline = "alphabetic";
    });
    // where they stand (home) when no walk moves them
    g.strokeStyle = "#fff"; g.setLineDash([2, 2]); g.strokeRect(px(sp.X) - 2, py(sp.Y) - 2, sc + 4, sc + 4); g.setLineDash([]);
    if (anim.on && anim.pos) {
      const im = imgFor(n.ImgPath), bob = anim.moving ? Math.round(Math.abs(Math.sin(anim.t * 9)) * sc / 8) : 0;
      const x = (anim.pos.x - R.view.cx) * sc + map.width / 2 - sc / 2, y = (anim.pos.y - R.view.cy) * sc + map.height / 2 - sc / 2 - bob;
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x + sc * .15, y + bob + sc * .8, sc * .7, sc * .2);
      if (im) g.drawImage(im, Math.round(x), Math.round(y), sc, sc);
      g.strokeStyle = "#f2cc59"; g.lineWidth = 2; g.strokeRect(Math.round(x) - 1, Math.round(y) - 1, sc + 2, sc + 2);
    }
  }

  // ---- play: the walk (or the whole day) as the server will walk it
  const clock = h("span", { class: "qs-rtclock" }, "");
  function play(mode, rate) {
    stop();
    const r = cur();
    let t0, t1;
    if (mode === "walk") {
      if (!r || !r.nodes.length) { qsToast("Lay a point or two first"); return; }
      const info = rtWalkInfo(frames, R.sel, r);
      t0 = info.start - 1; t1 = Math.min(info.end + 3, info.start + RT_DAY - 1);
    } else { t0 = 6 * RT_HOUR; t1 = t0 + RT_DAY; }
    anim.on = true; anim.mode = mode; anim.rate = rate; anim.t = 0;
    const began = performance.now();
    const frame = now => {
      if (!anim.on || !map.isConnected) { anim.on = false; return; }
      const el = (now - began) / 1000 * rate, ft = t0 + el;
      if (ft >= t1) { stop(); return; }
      const a = frames[((Math.floor(ft) % RT_DAY) + RT_DAY) % RT_DAY], b = frames[((Math.floor(ft) + 1) % RT_DAY + RT_DAY) % RT_DAY], f = ft - Math.floor(ft);
      anim.pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; anim.moving = a.x !== b.x || a.y !== b.y; anim.t = now / 1000;
      const dt = ((ft % RT_DAY) + RT_DAY) % RT_DAY, hh = Math.floor(dt / RT_HOUR), mm = Math.floor((dt % RT_HOUR) / RT_HOUR * 60);
      clock.textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${rtNight(hh) ? "night" : "day"}${a.wait > 0 ? " - waiting" : anim.moving ? " - walking" : ""}`;
      clock.className = "qs-rtclock" + (rtNight(hh) ? " night" : "");
      if (anim.mode === "day" || anim.rate > 4) { R.view.cx = R.view.cx + (anim.pos.x - R.view.cx) * 0.08; R.view.cy = R.view.cy + (anim.pos.y - R.view.cy) * 0.08; }
      map.redraw();
      anim.raf = requestAnimationFrame(frame);
    };
    anim.raf = requestAnimationFrame(frame);
    controls();
  }
  function stop() { if (anim.raf) cancelAnimationFrame(anim.raf); const was = anim.on; anim.on = false; anim.pos = null; clock.textContent = ""; if (was) { controls(); map.redraw(); } }
  box.rtPlay = play; box.rtStop = stop;

  // ---- controls around the map
  const top = h("div", { class: "qs-rttop" }), under = h("div", { class: "qs-rtunder" });
  function controls() {
    if (R.sel >= list.length) R.sel = Math.max(0, list.length - 1);
    const r = cur();
    if (r && R.pt >= r.nodes.length) R.pt = -1;
    // the day: 24 hours, a walk marked where it starts and across the hours it runs
    const runs = new Map();
    list.forEach((x, k) => { if (!x.nodes.length) { runs.set(x.TriggerHour % 24, k); return; } const info = rtWalkInfo(frames, k, x); for (let t = info.start; t <= info.end; t += RT_HOUR) if (!runs.has((t / RT_HOUR | 0) % 24)) runs.set((t / RT_HOUR | 0) % 24, k); });
    const strip = h("div", { class: "qs-rtday", role: "group", "aria-label": "Hours of the day" },
      Array.from({ length: 24 }, (_, i) => {
        const hour = i || 24, k = list.findIndex(x => x.TriggerHour === hour), runK = runs.get(i);
        return h("button", { type: "button", class: "qs-rth" + (rtNight(i) ? " night" : "") + (k >= 0 ? " start" : "") + (runK !== undefined && k < 0 ? " runs" : "") + (k >= 0 && k === R.sel ? " on" : ""),
          title: k >= 0 ? `${rtHourLabel(i)}: a walk starts` : `${rtHourLabel(i)}: tap to start a walk here`,
          onclick: async () => {
            if (anim.on) stop();
            if (k >= 0) { R.sel = k; R.pt = -1; controls(); map.redraw(); return; }
            const next = copy();
            next.push({ id: 0, TriggerHour: hour, Loop: 0, Speed: 1, nodes: [] });
            await commit(next, `${n.Name} gets a walk at ${rtHourLabel(i)}`);
            R.sel = list.findIndex(x => x.TriggerHour === hour); R.pt = -1; controls(); map.redraw();
            qsToast(`Now tap the map to lay the ${rtHourLabel(i)} path`);
          } }, h("span", {}, String(i).padStart(2, "0")), k >= 0 ? h("i", {}) : null);
      }));
    const spots = spawnsOf(n);
    top.replaceChildren(...rtKids(
      spots.length > 1 ? h("p", { class: "hint" }, "Each place has its own routine. This is the one at ", h("b", {}, `${sp.X},${sp.Y}`), sp === spots[0] ? " (the first place)" : "", ": pick another place under Where they stand.") : null,
      h("div", { class: "qs-rtdayhead" }, h("small", {}, "THE DAY"), h("span", { class: "hint" }, "a day is 30 min; an hour is 75 s. Tap an hour to start a walk then.")),
      strip,
      list.length ? h("div", { class: "qs-rtwalks" }, list.map((x, k) => h("button", { type: "button", class: "qs-rtwalk" + (k === R.sel ? " on" : ""), onclick: () => { stop(); R.sel = k; R.pt = -1; controls(); if (x.nodes.length) { R.view.cx = x.nodes[0].X; R.view.cy = x.nodes[0].Y; } map.redraw(); } },
        h("b", {}, rtHourLabel(x.TriggerHour)), " ", RT_LOOP[x.Loop] ? RT_LOOP[x.Loop][1].toLowerCase() : "?", h("small", {}, ` ${x.nodes.length} point${x.nodes.length === 1 ? "" : "s"}`)))) : h("p", { class: "hint" }, `${n.Name} stands still here all day. Tap an hour to give them somewhere to be.`)));
    if (!r) { under.replaceChildren(); return; }
    const info = r.nodes.length ? rtWalkInfo(frames, R.sel, r) : null;
    const walls = info ? info.tiles.filter(t => rtSolid(t.x, t.y)) : [];
    const set = (patch, label) => { const next = copy(); Object.assign(next[R.sel], patch); return commit(next, label); };
    const hourSel = h("select", { class: "qs-sel", "aria-label": "Starts at", onchange: async () => {
      const hr = +hourSel.value; if (list.some((x, k) => k !== R.sel && x.TriggerHour === hr)) { qsToast(`There's already a walk at ${rtHourLabel(hr)}`); hourSel.value = r.TriggerHour; return; }
      await set({ TriggerHour: hr }, `${n.Name}'s walk now starts at ${rtHourLabel(hr)}`); R.sel = list.findIndex(x => x.TriggerHour === hr); controls(); } },
      Array.from({ length: 24 }, (_, i) => h("option", { value: i || 24 }, rtHourLabel(i) + (rtNight(i) ? " (night)" : ""))));
    hourSel.value = r.TriggerHour;
    const p = R.pt >= 0 ? r.nodes[R.pt] : null;
    const setWait = w => { const next = copy(); next[R.sel].nodes[R.pt].Wait = Math.max(0, Math.min(3600, w)); return commit(next, `${n.Name} waits ${rtSecs(Math.max(0, w))} at point ${R.pt + 1}`); };
    under.replaceChildren(...rtKids(
      h("div", { class: "qs-rtplay" },
        h("button", { type: "button", class: "qs-btn hot", onclick: () => (anim.on && anim.mode === "walk" ? stop() : play("walk", 4)) }, anim.on && anim.mode === "walk" ? "■ Stop" : "▶ Watch this walk"),
        h("button", { type: "button", class: "qs-btn", onclick: () => (anim.on && anim.mode === "day" ? stop() : play("day", 30)) }, anim.on && anim.mode === "day" ? "■ Stop" : "▶ Watch their day"),
        clock),
      p ? h("div", { class: "qs-rtpt" },
        h("b", {}, `Point ${R.pt + 1}`), h("span", { class: "hint" }, ` at ${p.X},${p.Y}${zoneAt(p.X, p.Y) ? " - " + zoneAt(p.X, p.Y) : ""}`),
        h("div", { class: "qs-seg" }, h("small", {}, "Wait here "),
          h("button", { type: "button", "aria-label": "Wait less", onclick: () => setWait(p.Wait - (p.Wait > 10 ? 5 : 1)) }, "−"),
          h("b", { class: "qs-rtwait" }, rtSecs(p.Wait)),
          h("button", { type: "button", "aria-label": "Wait more", onclick: () => setWait(p.Wait + (p.Wait >= 10 ? 5 : 1)) }, "+"),
          [0, 5, 15, 30].map(w => h("button", { type: "button", class: p.Wait === w ? "on" : "", onclick: () => setWait(w) }, w ? w + " s" : "none"))),
        h("div", { class: "qs-seg" },
          h("button", { type: "button", onclick: async () => { const next = copy(); next[R.sel].nodes.splice(R.pt, 1); const at = R.pt; R.pt = -1; await commit(next, `Removed point ${at + 1}`); } }, "Remove point"),
          h("button", { type: "button", onclick: () => { R.pt = -1; controls(); map.redraw(); } }, "Done"),
          h("span", { class: "hint" }, "Taps on the map now add points after this one. Drag a point to move it."))) :
        h("p", { class: "hint qs-rthint" }, r.nodes.length ? "Tap the map to add a point at the end. Drag a point to move it; tap one to set a wait or remove it." : "Tap the map where they should walk to. Each tap adds a point."),
      h("div", { class: "qs-rtrow" }, h("small", {}, "Starts at "), hourSel,
        h("button", { type: "button", class: "qs-mini", title: "Remove this walk", onclick: async () => { if (!confirm(`Remove ${n.Name}'s ${rtHourLabel(r.TriggerHour)} walk?`)) return; const next = copy(); next.splice(R.sel, 1); R.sel = 0; R.pt = -1; await commit(next, `Removed ${n.Name}'s ${rtHourLabel(r.TriggerHour)} walk`); } }, "Remove walk")),
      h("div", { class: "qs-seg qs-rtloop" }, RT_LOOP.map(([v, label, why]) => h("button", { type: "button", class: r.Loop === v ? "on" : "", title: why, onclick: () => set({ Loop: v }, `${rtHourLabel(r.TriggerHour)} walk: ${label.toLowerCase()}`) }, label))),
      h("div", { class: "qs-seg qs-rtspeed" }, h("small", {}, "Pace "), RT_SPEED.map(([v, label]) => h("button", { type: "button", class: r.Speed === v ? "on" : "", title: `${v} tile${v === 1 ? "" : "s"} a second`, onclick: () => set({ Speed: v }, `${rtHourLabel(r.TriggerHour)} walk: ${label.toLowerCase()}`) }, label)),
        !RT_SPEED.some(([v]) => v === r.Speed) ? h("span", { class: "hint" }, ` ${r.Speed} tiles/s`) : null),
      h("p", { class: "hint" }, RT_LOOP[r.Loop] ? RT_LOOP[r.Loop][2] : "", info ? `. ${r.Loop === 0 ? "Gets there in" : "One go takes"} ${rtSecs(info.arrive >= 0 ? info.arrive : info.len)}${r.Loop ? "" : ` (the hour is ${RT_HOUR} s)`}.` : "."),
      info && r.Loop === 0 && info.arrive > RT_HOUR ? h("div", { class: "qs-prob warn" }, h("i", { class: "lg warn" }), `Still walking when ${rtHourLabel(r.TriggerHour + 1)} comes: they finish anyway, but a walk at the next hour waits for it.`) : null,
      walls.length ? h("div", { class: "qs-prob err" }, h("i", { class: "lg err" }), `Walks through ${walls.length === 1 ? "a wall" : walls.length + " blocked tiles"} at ${walls.slice(0, 3).map(t => t.x + "," + t.y).join(" ")}${walls.length > 3 ? "..." : ""}. They go in straight lines (diagonals first), no path finding: add a point to go round.`) : null,
      r.nodes.length ? h("div", { class: "qs-rtpts" }, r.nodes.map((q, i) => h("button", { type: "button", class: "qs-chip" + (i === R.pt ? " on" : ""), onclick: () => { R.pt = R.pt === i ? -1 : i; R.view.cx = q.X; R.view.cy = q.Y; controls(); map.redraw(); } }, `${i + 1}  ${q.X},${q.Y}`, q.Wait ? h("small", {}, ` ${q.Wait}s`) : null))) : null));
  }
  const zoom = f => { R.view.sc = Math.max(6, Math.min(40, R.view.sc * f)); map.redraw(); };
  controls();
  box.append(h("div", { class: "qs-wtitle" }, h("span", {}, "DAILY ROUTINE"), h("span", { class: "qs-sp" }), h("small", {}, `${list.length ? list.length + " walk" + (list.length === 1 ? "" : "s") : "stands still"}`)),
    h("div", { class: "qs-wbody" }, top,
      h("div", { class: "qs-rtmapbox" }, map,
        h("div", { class: "qs-rtzoom" }, h("button", { type: "button", class: "qs-mini", "aria-label": "Zoom in", onclick: () => zoom(1.25) }, "+"), h("button", { type: "button", class: "qs-mini", "aria-label": "Zoom out", onclick: () => zoom(0.8) }, "−"), h("button", { type: "button", class: "qs-mini", title: "Back to where they stand", onclick: () => { R.view.cx = sp.X; R.view.cy = sp.Y; map.redraw(); } }, "home"))),
      under));
  return box;
}
