"use strict";
// Map > Areas: named regions painted per tile (a house, a mine). Each says
// whether it is inside (Interior: outside, roofed, cave), whether rain can
// fall there, which room reverb the game uses, and optionally an ambient loop
// and a light level (stored, not used by the game yet). Tables areas and
// area_tiles (content/migrations/2026-10-24-areas.sql); a layer of its own,
// separate from the zones (world.Name, the Zone brush in Paint tiles).
// Uses app.js: h, $, api, status, M, tile, str, seg, lineTiles, drawMap, drawSide.

const AR = { list: [], byId: new Map(), at: new Map(), counts: new Map(), missing: false, sel: null,
  mode: "paint", size: 1, show: false, pending: new Map(), filter: "", saveTimer: 0 };

const AREA_INTERIOR = [["none", "Outside"], ["roofed", "Roofed"], ["cave", "Cave"]];
const AREA_REVERB = [["none", "None"], ["small", "Small room"], ["room", "Room"], ["hall", "Hall"], ["cave", "Cave"], ["largecave", "Large cave"]];

async function loadAreas() {
  const r = await api("areas");
  AR.missing = r.missing;
  AR.list = r.areas; AR.byId = new Map(r.areas.map(a => [a.id, a]));
  AR.at = new Map(r.tiles.map(t => [t[0] + "," + t[1], t[2]]));
  recountAreas();
  if (AR.sel && !AR.byId.has(AR.sel)) AR.sel = null;
}
function recountAreas() {
  AR.counts = new Map();
  for (const id of AR.at.values()) AR.counts.set(id, (AR.counts.get(id) || 0) + 1);
}
const areaIdAt = (x, y) => AR.at.get(x + "," + y) || 0;
// Even hue steps per id, so neighbouring areas differ.
function areaColour(id, a) {
  const hue = Math.round((id * 137.508) % 360);
  return a == null ? `hsl(${hue} 62% 56%)` : `hsl(${hue} 62% 56% / ${a})`;
}
function areaSummary(a) {
  const parts = [a.Interior === "none" ? (a.Weather ? "outside" : "outside, no rain") : a.Interior];
  if (a.Reverb !== "none") parts.push(`${(AREA_REVERB.find(r => r[0] === a.Reverb) || [0, a.Reverb])[1].toLowerCase()} reverb`);
  return parts.join(" · ");
}

// ---- painting
function arPatch(x, y, id) {
  const k = x + "," + y;
  if ((AR.at.get(k) || 0) === id) return;
  if (id) AR.at.set(k, id); else AR.at.delete(k);
  AR.pending.set(k, { X: x, Y: y, AreaID: id });
}
function arBrushTiles(t) {
  const n = AR.size || 1, o = Math.floor((n - 1) / 2), out = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push({ x: t.x - o + dx, y: t.y - o + dy });
  return out;
}
function arPaintAt(t) {
  const id = AR.mode === "erase" ? 0 : AR.sel;
  if (AR.mode !== "erase" && !AR.sel) { status("Pick or create an area first.", true); return false; }
  for (const b of arBrushTiles(t)) if (tile(b.x, b.y)) arPatch(b.x, b.y, id);
  return true;
}
// One click fills a room: connected tiles with the same ground, up to 4000.
function arFill(t) {
  const start = tile(t.x, t.y); if (!start) return;
  const ground = start[2], id = AR.mode === "erase" ? 0 : AR.sel;
  const seen = new Set([t.x + "," + t.y]), todo = [t];
  let n = 0;
  while (todo.length && n < 4000) {
    const c = todo.pop(); n++;
    arPatch(c.x, c.y, id);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy, k = x + "," + y, tl = tile(x, y);
      if (seen.has(k) || !tl || tl[2] !== ground) continue;
      seen.add(k); todo.push({ x, y });
    }
  }
  status(n >= 4000 ? "Fill stopped at 4000 tiles: the ground runs on. Use the brush for the rest." : `Filled ${n} tile(s).`, n >= 4000);
}
function arDown(e, t) {
  if (e.altKey) {
    const id = areaIdAt(t.x, t.y);
    if (id) { AR.sel = id; AR.mode = AR.mode === "erase" ? "paint" : AR.mode; status(`Picked ${AR.byId.get(id).Name}`); }
    else status("No area on that tile.");
    drawSide(); drawMap(); return;
  }
  if (AR.mode !== "erase" && !AR.sel) { status("Pick or create an area first.", true); return; }
  if (AR.mode === "fill") { arFill(t); arFlush(); drawMap(); return; }
  if (arPaintAt(t)) { M.drag = { area: true, last: t }; drawMap(); }
}
function arDrag(t) {
  for (const s of lineTiles(M.drag.last, t).slice(1)) arPaintAt(s);
  M.drag.last = t; drawMap();
}
async function arFlush() {
  if (!AR.pending.size) return;
  const list = [...AR.pending.values()]; AR.pending.clear();
  try { await api("areaTiles", list); status(`Saved ${list.length} area tile(s) in memory. Save .db or commit to keep them.`); }
  catch (e) { status(e.message, true); await loadAreas(); }
  recountAreas(); drawSide(); drawMap();
}

// ---- map layer
function drawAreasLayer(g, x0, x1, y0, y1, px, py, sc) {
  const on = M.tool === "areas" || AR.show;
  if (!on || !AR.at.size) return;
  const sel = M.tool === "areas" ? AR.sel : null;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const id = AR.at.get(x + "," + y); if (!id) continue;
    g.fillStyle = areaColour(id, sel && id !== sel ? .16 : .42);
    g.fillRect(px(x), py(y), sc + .5, sc + .5);
    if (sc >= 8) {
      // outline where the area ends, so two rooms side by side read apart
      g.strokeStyle = areaColour(id, .95); g.lineWidth = sc >= 20 ? 2 : 1; g.beginPath();
      if (areaIdAt(x, y - 1) !== id) { g.moveTo(px(x), py(y) + .5); g.lineTo(px(x) + sc, py(y) + .5); }
      if (areaIdAt(x, y + 1) !== id) { g.moveTo(px(x), py(y) + sc - .5); g.lineTo(px(x) + sc, py(y) + sc - .5); }
      if (areaIdAt(x - 1, y) !== id) { g.moveTo(px(x) + .5, py(y)); g.lineTo(px(x) + .5, py(y) + sc); }
      if (areaIdAt(x + 1, y) !== id) { g.moveTo(px(x) + sc - .5, py(y)); g.lineTo(px(x) + sc - .5, py(y) + sc); }
      g.stroke(); g.lineWidth = 1;
    }
  }
  // one label per area in view
  g.font = "12px sans-serif"; const shown = new Set(); const step = Math.max(2, Math.ceil(70 / sc));
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    const id = AR.at.get(x + "," + y); const a = id && AR.byId.get(id);
    if (!a || shown.has(id)) continue;
    shown.add(id);
    const w = g.measureText(a.Name).width;
    g.fillStyle = "rgba(10,12,16,.78)"; g.fillRect(px(x) - 3, py(y) - 13, w + 6, 17);
    g.fillStyle = areaColour(id); g.fillRect(px(x) - 3, py(y) - 13, 2, 17);
    g.fillStyle = "#eef"; g.fillText(a.Name, px(x) + 2, py(y));
  }
}
function drawAreasBrush(g, px, py, sc) {
  if (M.tool !== "areas" || !M.hover) return;
  const tiles = AR.mode === "fill" ? [M.hover] : arBrushTiles(M.hover);
  g.strokeStyle = AR.mode === "erase" ? "#f66" : AR.sel ? areaColour(AR.sel) : "#fff"; g.lineWidth = 2;
  for (const t of tiles) g.strokeRect(px(t.x) + 1, py(t.y) + 1, sc - 2, sc - 2);
  g.lineWidth = 1;
}
const areaNameAt = (x, y) => { const id = areaIdAt(x, y); return id && AR.byId.get(id) ? AR.byId.get(id).Name : ""; };

// ---- side panel
function areasSide(s) {
  if (AR.missing) {
    s.append(h("h3", {}, "Areas"),
      h("p", {}, "This database has no areas tables yet (content/migrations/2026-10-24-areas.sql)."),
      h("p", { class: "hint" }, "Create them here (empty) and paint areas by hand, or run scripts/seed-areas.py in the API to seed one area per zone and kind first."),
      h("button", { class: "primary", onclick: async () => { await api("areasCreate"); await loadAreas(); drawSide(); } }, "Create the tables"));
    return;
  }
  s.append(h("h3", {}, "Brush"),
    h("div", { class: "brush" },
      h("div", { class: "brow" }, h("span", { class: "bl" }, "Mode"), seg([["paint", "Paint"], ["erase", "Erase"], ["fill", "Room fill"]], AR.mode, v => { AR.mode = v; drawSide(); drawMap(); })),
      AR.mode === "fill" ? null : h("div", { class: "brow" }, h("span", { class: "bl" }, "Size"), seg([[1, "1"], [2, "2"], [3, "3"], [5, "5"]], AR.size, v => { AR.size = v; drawSide(); }))),
    h("p", { class: "hint" }, AR.mode === "fill" ? "Click a floor: every connected tile with the same ground gets the area."
      : AR.mode === "erase" ? "Drag to take tiles out of their area. Unpainted tiles use the old rule (cave, floor and wall grounds are inside)."
        : "Drag to paint the selected area. Alt-click a tile to pick its area."));

  // list
  s.append(h("h3", {}, `Areas (${AR.list.length})`));
  const q = h("input", { type: "search", placeholder: "Filter areas", value: AR.filter, oninput: () => { AR.filter = q.value; drawRows(); } });
  const rows = h("div", { class: "arealist" });
  const drawRows = () => {
    rows.textContent = "";
    const f = AR.filter.toLowerCase();
    for (const a of AR.list) {
      if (f && !a.Name.toLowerCase().includes(f)) continue;
      rows.append(h("div", { class: "arearow" + (a.id === AR.sel ? " sel" : ""), title: areaSummary(a), onclick: () => { AR.sel = a.id; if (AR.mode === "erase") AR.mode = "paint"; drawSide(); drawMap(); } },
        h("span", { class: "sw", style: `background:${areaColour(a.id)}` }), h("span", { class: "an" }, a.Name),
        h("span", { class: "ac" }, String(AR.counts.get(a.id) || 0))));
    }
    if (!rows.childNodes.length) rows.append(h("div", { class: "hint", style: "padding:6px" }, AR.list.length ? "No match." : "No areas yet."));
  };
  drawRows();
  requestAnimationFrame(() => { const r = rows.querySelector(".sel"); if (r) r.scrollIntoView({ block: "nearest" }); });
  const sel = AR.sel && AR.byId.get(AR.sel);
  s.append(h("div", { class: "bar", style: "margin:6px 0" },
    h("button", { onclick: () => newArea() }, "New"),
    h("button", { disabled: !sel, onclick: () => newArea(sel) }, "Duplicate"),
    h("button", { disabled: !sel, onclick: () => { const ok = $("#area-name"); if (ok) { ok.focus(); ok.select(); } } }, "Rename"),
    h("button", { class: "danger", disabled: !sel, onclick: () => deleteArea(sel) }, "Delete")), q, rows);
  if (sel) s.append(areaProps(sel));
}
async function newArea(from) {
  const base = from ? { ...from, id: 0, Name: from.Name + " copy" } : { Name: "New area", Interior: "roofed", Weather: 1, Reverb: "room", ReverbWet: 0.35, ReverbDry: 1, Ambient: "", AmbientVol: 0.5, Light: null, Priority: 0 };
  try { const r = await api("areaSave", base); await loadAreas(); AR.sel = r.id; AR.mode = "paint"; drawSide(); drawMap(); const n = $("#area-name"); if (n) { n.focus(); n.select(); } }
  catch (e) { status(e.message, true); }
}
async function deleteArea(a) {
  const n = AR.counts.get(a.id) || 0;
  if (!confirm(`Delete the area "${a.Name}"${n ? ` and unpaint its ${n} tile(s)` : ""}?`)) return;
  await api("areaDelete", a.id); AR.sel = null; await loadAreas(); drawSide(); drawMap(); status(`Deleted ${a.Name}`);
}
// Edits save on change (sliders and names after a short pause).
function areaSaveSoon(a, now) {
  clearTimeout(AR.saveTimer);
  const go = async () => {
    try { await api("areaSave", a); AR.byId.set(a.id, a); status(`Saved area ${a.Name} in memory.`); }
    catch (e) { status(e.message, true); await loadAreas(); drawSide(); }
    drawMap();
  };
  if (now) go(); else AR.saveTimer = setTimeout(go, 350);
}
function areaProps(a) {
  const box = h("div", { class: "areaprops" });
  const redraw = () => { const n = areaProps(a); box.replaceWith(n); };
  const name = h("input", { type: "text", id: "area-name", value: a.Name, oninput: () => { a.Name = name.value; areaSaveSoon(a); const r = $(".arearow.sel .an"); if (r) r.textContent = a.Name; } });
  const inside = a.Interior !== "none";
  const rain = h("input", { type: "checkbox", disabled: inside, onchange: () => { a.Weather = rain.checked ? 1 : 0; areaSaveSoon(a, true); } }); rain.checked = !!a.Weather && !inside;
  const slider = (key, label) => {
    const out = h("span", { class: "sv" }, (+a[key]).toFixed(2));
    const r = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: a[key], disabled: a.Reverb === "none" && key.startsWith("Reverb"),
      oninput: () => { a[key] = +r.value; out.textContent = (+r.value).toFixed(2); areaSaveSoon(a); } });
    return h("div", { class: "prow" }, h("span", { class: "pl" }, label), r, out);
  };
  const reverb = h("select", { onchange: () => { a.Reverb = reverb.value; areaSaveSoon(a, true); redraw(); } },
    AREA_REVERB.map(([v, l]) => { const o = h("option", { value: v }, l); if (v === a.Reverb) o.selected = true; return o; }));
  const ambientList = (typeof assetPaths === "function" ? assetPaths() : []).filter(p => /^assets\/sfx\/ambient\/.*\.(ogg|wav|mp3)$/i.test(p));
  let dl = $("#ambientSounds"); if (!dl) { dl = h("datalist", { id: "ambientSounds" }); document.body.append(dl); }
  dl.replaceChildren(...ambientList.map(p => h("option", { value: p })));
  const amb = h("input", { type: "text", list: "ambientSounds", value: a.Ambient || "", placeholder: "none", oninput: () => { a.Ambient = amb.value.trim(); areaSaveSoon(a); } });
  const lightOn = h("input", { type: "checkbox", onchange: () => { a.Light = lightOn.checked ? 1 : null; areaSaveSoon(a, true); redraw(); } }); lightOn.checked = a.Light != null;
  const light = h("input", { type: "number", class: "num", min: 0, max: 2, step: 0.05, value: a.Light ?? 1, disabled: a.Light == null,
    oninput: () => { a.Light = light.value === "" ? null : +light.value; areaSaveSoon(a); } });
  box.append(h("h3", {}, "Properties"),
    h("div", { class: "prow" }, h("span", { class: "pl" }, "Name"), name),
    h("div", { class: "prow" }, h("span", { class: "pl" }, "Interior"), seg(AREA_INTERIOR, a.Interior, v => { a.Interior = v; areaSaveSoon(a, true); redraw(); drawMap(); })),
    h("label", { class: "chk prow-chk" }, rain, inside ? " Rain can fall here (never inside)" : " Rain can fall here"),
    h("div", { class: "prow" }, h("span", { class: "pl" }, "Reverb"), reverb),
    slider("ReverbWet", "Wet"), slider("ReverbDry", "Dry"),
    h("div", { class: "sub" }, "Not used by the game yet"),
    h("div", { class: "prow" }, h("span", { class: "pl" }, "Ambient"), amb),
    slider("AmbientVol", "Volume"),
    h("div", { class: "prow" }, h("span", { class: "pl" }, "Light"), h("label", { class: "chk", style: "display:inline" }, lightOn, " set"), light,
      h("span", { class: "hint" }, "x zone light")),
    h("p", { class: "hint" }, `${AR.counts.get(a.id) || 0} tile(s). Wet is how much reverb, dry how much of the plain sound. Reverb only touches sound effects, never music.`));
  return box;
}
