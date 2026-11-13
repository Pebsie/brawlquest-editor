"use strict";
// Season tab: the seasonal decoration (Christmas). One switch (season.Mode: on, off or auto between two
// dates) and the props (season_deco), listed per town. The API (season.go) serves them as GET /season and
// the client draws them as an overlay: the world rows are never changed, so switching it off or deleting
// a row leaves the map as it was. Tables are created on the first save; Export SQL carries the statements.

const SEASON_MODES = [["on", "On: always shown"], ["off", "Off: never shown"], ["auto", "Auto: shown between two dates"]];
// kind: [label, shape, what the variant means, colours]
//   shape: point (X,Y), line (X,Y to X2,Y2: anchors are lamps or walls), rect (X,Y to X2,Y2)
const SEASON_KINDS = {
  tree: ["Tree", "point", "1 fir, 2 grand tree, 3 snowy tree (solid on the client)", "palette of the lights"],
  present: ["Present", "point", "0 small, 1 medium, 2 large", "red green blue gold purple white"],
  wreath: ["Wreath on a door", "point", "0 wooden door, 1 arched shop door", ""],
  lights: ["String of lights", "line", "sag in pixels", "warm multi cool redgreen"],
  swag: ["Garland", "line", "sag in pixels", ""],
  lampbow: ["Bow on a lamp post", "point", "1 turns the post into a peppermint stick", ""],
  lantern: ["Festive lantern", "point", "", ""],
  candle: ["Candle", "point", "", ""],
  candycane: ["Candy cane", "point", "", ""],
  snowman: ["Snowman", "point", "0 or 1 (scarf colour); solid on the client", ""],
  holly: ["Holly", "point", "", ""],
  banner: ["Banner on a wall", "point", "", "red green"],
  snow: ["Snow area", "rect", "1 light, 2 normal, 3 heavy", ""],
  snowfall: ["Falling snow area", "rect", "1 light, 2 normal, 3 heavy", ""],
};
const SEASON_NEW = { id: 0, Season: "christmas", Town: "", Kind: "tree", X: 0, Y: 0, X2: "", Y2: "", Variant: 1, Colour: "", Note: "" };

// Is the season shown on a date? Same rule as the server: Mode on / off, or auto between AutoFrom and
// AutoTo (MM-DD; the window may wrap the new year).
function seasonActive(row, date) {
  if (!row) return false;
  if (row.Mode === "on") return true;
  if (row.Mode !== "auto") return false;
  const d = date || new Date();
  const md = String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const a = String(row.AutoFrom || ""), b = String(row.AutoTo || "");
  if (!/^\d\d-\d\d$/.test(a) || !/^\d\d-\d\d$/.test(b)) return false;
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}

// What would be ignored or surprise in the game. Returns [{ id, text }].
function seasonIssues(rows, seasons) {
  const out = [], names = new Set(seasons.map(s => s.Name)), seen = new Map();
  for (const r of rows) {
    const add = text => out.push({ id: +r.id, text: `${r.Kind} ${r.id} (${r.X},${r.Y}): ${text}` });
    const k = SEASON_KINDS[r.Kind];
    if (!k) { add("unknown kind, the game ignores it"); continue; }
    if (!names.has(r.Season)) add(`season "${r.Season}" has no switch row`);
    if (k[1] !== "point") {
      if (r.X2 === "" || r.X2 == null || r.Y2 === "" || r.Y2 == null) add("needs X2 and Y2");
      else if (k[1] === "rect" && (+r.X2 < +r.X || +r.Y2 < +r.Y)) add("X2, Y2 must be the far corner (not above or left of X, Y)");
      else if (k[1] === "line" && +r.X2 === +r.X && +r.Y2 === +r.Y) add("both ends are the same tile");
    }
    if (r.Kind === "tree" && !(+r.Variant >= 0 && +r.Variant <= 3)) add("Variant must be 0 to 3");
    if (r.Kind === "present" && !(+r.Variant >= 0 && +r.Variant <= 2)) add("Variant must be 0 to 2");
    if (r.Kind === "wreath" && !(+r.Variant === 0 || +r.Variant === 1)) add("Variant must be 0 or 1");
    if (k[1] === "point") {
      const key = r.Kind + ":" + r.X + "," + r.Y;
      if (seen.has(key)) add(`same spot as ${seen.get(key)}`); else seen.set(key, r.id);
    }
  }
  return out;
}

function seasonCounts(rows) {
  const by = new Map();
  for (const r of rows) { const t = r.Town || "(no town)"; if (!by.has(t)) by.set(t, {}); const o = by.get(t); o[r.Kind] = (o[r.Kind] || 0) + 1; }
  return by;
}

async function renderSeason(m) {
  const data = await api("loreTables");
  const seasons = data.season.rows, rows = data.season_deco.rows;
  if (!S.seasonName || !seasons.some(s => s.Name === S.seasonName)) S.seasonName = seasons[0] ? seasons[0].Name : "christmas";
  const cur = seasons.find(s => s.Name === S.seasonName) || null;
  const mine = rows.filter(r => r.Season === S.seasonName);
  const main = h("div", { class: "form", style: "max-width:1200px;margin:0 auto;padding:12px 16px" },
    h("h2", {}, "Season: seasonal decoration"),
    h("p", { class: "hint" }, "Decorations are drawn over the map by the game client; the map itself is never changed. The switch below turns the whole season on or off (players see a change when they next log in, after the server reloads its content). Props are placed by tile; lights and garlands run between two lamps or walls."));

  // ---- the switch
  const mode = h("select", { "data-key": "Mode" }, SEASON_MODES.map(([v, l]) => h("option", { value: v }, l)));
  mode.value = cur ? cur.Mode : "off";
  const from = txt(cur ? cur.AutoFrom : "12-19", "MM-DD"), to = txt(cur ? cur.AutoTo : "01-04", "MM-DD");
  from.dataset.key = "AutoFrom"; to.dataset.key = "AutoTo"; from.style.width = to.style.width = "70px";
  const snow = h("input", { type: "checkbox", "data-key": "Snowfall" }); snow.checked = !cur || +cur.Snowfall !== 0;
  const world = h("input", { type: "checkbox", "data-key": "WorldSnow" }); world.checked = !cur || +cur.WorldSnow !== 0;
  const live = h("b", { "data-active": "1" });
  const showLive = () => {
    const row = { Mode: mode.value, AutoFrom: from.value, AutoTo: to.value };
    live.textContent = seasonActive(row) ? "Shown today" : "Not shown today";
    live.style.color = seasonActive(row) ? "#8d8" : "#e88";
    from.disabled = to.disabled = mode.value !== "auto";
  };
  mode.onchange = from.oninput = to.oninput = showLive;
  main.append(h("h3", {}, "The switch"),
    h("div", { class: "bar" }, h("span", {}, "Season "), h("b", {}, S.seasonName), " ", mode, h("span", {}, " from "), from, h("span", {}, " to "), to, " ",
      h("label", { class: "chk" }, snow, " falling snow"), " ",
      h("label", { class: "chk" }, world, " overworld snow"), " ",
      h("button", { class: "primary", "data-act": "save-switch", onclick: async () => {
        if (mode.value === "auto" && !(/^\d\d-\d\d$/.test(from.value) && /^\d\d-\d\d$/.test(to.value))) { status("Dates are MM-DD, for example 12-19 and 01-04", true); return; }
        try {
          await api("loreSave", { table: "season", row: { id: cur ? +cur.id : 0, Name: S.seasonName, Mode: mode.value, AutoFrom: from.value, AutoTo: to.value, Snowfall: snow.checked ? 1 : 0, WorldSnow: world.checked ? 1 : 0 } });
          status("Saved the season switch. Use Save .db or Export SQL to keep it."); renderTab();
        } catch (e) { status(e.message, true); }
      } }, cur ? "Save switch" : "Create switch"), " ", live));
  showLive();
  if (!cur) main.append(h("p", { class: "hint", style: "color:#e88" }, "This database has no switch row for " + S.seasonName + ": the game shows nothing until one is saved."));

  // ---- per town
  const by = seasonCounts(mine);
  if (!S.seasonTown || (S.seasonTown !== "*" && !by.has(S.seasonTown))) S.seasonTown = "*";
  const towns = [...by.keys()].sort();
  const sum = h("table", { class: "grid-table", style: "border-collapse:collapse", "data-towns": "1" },
    h("tr", {}, h("th", { style: "text-align:left;padding:2px 6px" }, "Town"), h("th", { style: "text-align:left;padding:2px 6px" }, "Props"), h("th", { style: "text-align:left;padding:2px 6px" }, "")));
  for (const t of towns) {
    const o = by.get(t), total = Object.values(o).reduce((a, b) => a + b, 0);
    sum.append(h("tr", { "data-town": t }, h("td", { style: "padding:2px 6px" }, h("button", { class: t === S.seasonTown ? "primary" : "", onclick: () => { S.seasonTown = t; renderTab(); } }, t)),
      h("td", { style: "padding:2px 6px" }, String(total)), h("td", { class: "hint", style: "padding:2px 6px" }, Object.entries(o).sort().map(([k, n]) => `${n} ${k}`).join(", "))));
  }
  main.append(h("h3", {}, `Towns (${mine.length} props)`), sum,
    h("div", { class: "bar" }, h("button", { class: S.seasonTown === "*" ? "primary" : "", onclick: () => { S.seasonTown = "*"; renderTab(); } }, "All towns")));

  // ---- the props
  const shown = mine.filter(r => S.seasonTown === "*" || (r.Town || "(no town)") === S.seasonTown);
  const kinds = h("datalist", { id: "seasonKinds" }, Object.keys(SEASON_KINDS).map(k => h("option", { value: k })));
  const tbl = h("table", { class: "grid-table", style: "border-collapse:collapse", "data-props": "1" });
  const cols = ["Town", "Kind", "X", "Y", "X2", "Y2", "Variant", "Colour"];
  tbl.append(h("tr", {}, h("th", {}, "id"), ...cols.map(c => h("th", { style: "text-align:left;padding:2px 4px;font-weight:normal;opacity:.7" }, c)), h("th", {}, ""), h("th", {}, "")));
  const addRow = row => {
    const inp = {};
    const tr = h("tr", { "data-prop": row.id || "new" }, h("td", { class: "hint" }, row.id || "new"),
      ...cols.map(c => {
        const el = h("input", { type: /^(X|Y|X2|Y2|Variant)$/.test(c) ? "number" : "text", value: row[c] ?? "", "data-key": c, list: c === "Kind" ? "seasonKinds" : undefined, style: "width:" + (c === "Town" ? 120 : c === "Kind" || c === "Colour" ? 90 : 56) + "px" });
        inp[c] = el; return h("td", { style: "padding:1px 3px" }, el);
      }),
      h("td", { style: "padding:1px 3px" }, h("button", { class: "primary", "data-act": "save-prop", onclick: async () => {
        const out = { id: +row.id || 0, Season: S.seasonName, Note: row.Note || "" };
        for (const c of cols) out[c] = inp[c].value;
        for (const c of ["X", "Y", "Variant"]) out[c] = +out[c] || 0;
        for (const c of ["X2", "Y2"]) out[c] = out[c] === "" ? "" : +out[c];
        if (!SEASON_KINDS[out.Kind]) { status("Kind must be one of: " + Object.keys(SEASON_KINDS).join(", "), true); return; }
        try {
          if (out.X2 === "" || out.Y2 === "") { delete out.X2; delete out.Y2; }
          await api("loreSave", { table: "season_deco", row: out });
          status("Saved. Use Save .db or Export SQL to keep it."); renderTab();
        } catch (e) { status(e.message, true); }
      } }, "Save"), " ", h("button", { class: "danger", "data-act": "delete-prop", onclick: async () => {
        if (!row.id) { tr.remove(); return; }
        try { await api("loreDelete", { table: "season_deco", id: row.id }); status("Deleted prop " + row.id + ". Use Save .db or Export SQL to keep it."); renderTab(); } catch (e) { status(e.message, true); }
      } }, "Delete")),
      h("td", { class: "hint", style: "padding:1px 6px" }, (SEASON_KINDS[row.Kind] || [])[2] || ""));
    tbl.append(tr);
  };
  for (const r of shown) addRow(r);
  main.append(h("h3", {}, S.seasonTown === "*" ? "All props" : S.seasonTown), kinds, tbl,
    h("div", { class: "bar" }, h("button", { "data-act": "add-prop", onclick: () => addRow({ ...SEASON_NEW, Season: S.seasonName, Town: S.seasonTown === "*" ? "" : S.seasonTown }) }, "+ Add prop")),
    h("details", {}, h("summary", {}, "Kinds"), h("table", { class: "grid-table" }, ...Object.entries(SEASON_KINDS).map(([k, v]) =>
      h("tr", {}, h("td", { style: "padding:1px 8px" }, h("code", {}, k)), h("td", { style: "padding:1px 8px" }, v[0]), h("td", { class: "hint", style: "padding:1px 8px" }, `${v[1] === "point" ? "X,Y" : v[1] === "line" ? "X,Y to X2,Y2 (lamps or walls)" : "rectangle X,Y to X2,Y2"}${v[2] ? "; Variant: " + v[2] : ""}${v[3] ? "; Colour: " + v[3] : ""}`))))));

  // ---- checks
  const issues = seasonIssues(mine, seasons);
  main.append(h("h3", {}, "Checks ", h("span", { class: "hint" }, issues.length ? `${issues.length} to look at` : "all clear")),
    issues.length ? h("ul", { "data-issues": "1" }, ...issues.map(i => h("li", { class: "hint", style: "color:#e88" }, i.text))) : h("p", { class: "hint" }, "No problems found."),
    h("p", { class: "hint" }, "The checks cannot see the map. Placements for the shipped towns are checked against it (free ground, doors, lamps, walls, NPC spots) by tools/build_season.py in the content repo."));
  m.append(main);
}
