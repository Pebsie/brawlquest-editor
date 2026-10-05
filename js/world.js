"use strict";

const WorldEditor = (() => {
  const esc = (s) => Editors.esc(s);

  function hashColor(path) {
    const s = String(path || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    const sat = 35 + (h % 40);
    const lit = 28 + ((h >> 8) % 25);
    return `hsl(${hue} ${sat}% ${lit}%)`;
  }

  function render(ws, state) {
    if (!state.world) state.world = { mode: "select", paint: {}, zoom: 0.25, camX: 0, camY: 0, sel: null };
    const st = state.world;

    ws.innerHTML = `<div class="world-wrap">
      <div>
        <div class="world-tools">
          <button type="button" class="btn small ${st.mode==="select"?"active":""}" data-mode="select">Select</button>
          <button type="button" class="btn small ${st.mode==="paint"?"active":""}" data-mode="paint">Paint</button>
          <button type="button" class="btn small ${st.mode==="collision"?"active":""}" data-mode="collision">Toggle collision</button>
          <button type="button" class="btn small" id="zoom-out">Zoom −</button>
          <button type="button" class="btn small" id="zoom-in">Zoom +</button>
          <button type="button" class="btn small" id="zoom-fit">Fit</button>
          <button type="button" class="btn small" id="btn-add-tile">Add tile at…</button>
        </div>
        <div class="map-stage"><canvas id="world-canvas" aria-label="World map editor"></canvas></div>
        <p class="note">Drag to pan. Scroll to zoom. world.Enemy is enemy Name (empty string = none). Live mobs spawn from Enemy, not the unused mobs table.</p>
      </div>
      <aside class="world-side" id="world-side"><div class="empty">Select a tile</div></aside>
    </div>`;

    const canvas = ws.querySelector("#world-canvas");
    const side = ws.querySelector("#world-side");
    const ctx = canvas.getContext("2d");

    // Load world into map
    const cells = BQDB.all("SELECT id, GroundTile, ForegroundTile, Name, X, Y, Music, Collision, Enemy FROM world");
    const at = new Map();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const grounds = new Set();
    const fores = new Set();
    for (const c of cells) {
      at.set(c.X + "," + c.Y, c);
      if (c.X < minX) minX = c.X; if (c.X > maxX) maxX = c.X;
      if (c.Y < minY) minY = c.Y; if (c.Y > maxY) maxY = c.Y;
      if (c.GroundTile) grounds.add(c.GroundTile);
      if (c.ForegroundTile) fores.add(c.ForegroundTile);
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 10; minY = 0; maxY = 10; }

    if (!st.fitted) {
      st.camX = (minX + maxX) / 2;
      st.camY = (minY + maxY) / 2;
      st.fitted = true;
    }

    const groundList = [...grounds].sort();
    const foreList = [...fores].sort();
    const musicList = [...new Set(cells.map((c) => c.Music).filter(Boolean))].sort();
    const enemyNames = BQDB.all("SELECT Name FROM enemies ORDER BY Name").map((r) => r.Name);

    let cssW = 1, cssH = 1;
    const TILE = 16;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function screenToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: Math.floor(st.camX + (sx - cssW / 2) / (st.zoom * TILE)),
        y: Math.floor(st.camY + (sy - cssH / 2) / (st.zoom * TILE)),
      };
    }

    function draw() {
      resize();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cssW, cssH);
      const tilePx = TILE * st.zoom;
      const x0 = Math.floor(st.camX - cssW / 2 / tilePx) - 1;
      const y0 = Math.floor(st.camY - cssH / 2 / tilePx) - 1;
      const x1 = Math.floor(st.camX + cssW / 2 / tilePx) + 1;
      const y1 = Math.floor(st.camY + cssH / 2 / tilePx) + 1;
      const size = Math.max(1, Math.ceil(tilePx));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const cell = at.get(x + "," + y);
          if (!cell) continue;
          const sx = Math.round((x - st.camX) * tilePx + cssW / 2);
          const sy = Math.round((y - st.camY) * tilePx + cssH / 2);
          ctx.fillStyle = hashColor(cell.GroundTile);
          ctx.fillRect(sx, sy, size, size);
          if (cell.ForegroundTile) {
            ctx.globalAlpha = 0.55;
            ctx.fillStyle = hashColor(cell.ForegroundTile);
            ctx.fillRect(sx, sy, size, size);
            ctx.globalAlpha = 1;
          }
          if (cell.Collision) {
            ctx.strokeStyle = "rgba(231,111,81,0.7)";
            ctx.strokeRect(sx + 0.5, sy + 0.5, size - 1, size - 1);
          }
          if (cell.Enemy) {
            ctx.fillStyle = "#f4a261";
            ctx.fillRect(sx + size * 0.35, sy + size * 0.35, size * 0.3, size * 0.3);
          }
        }
      }
      if (st.sel) {
        const sx = Math.round((st.sel.X - st.camX) * tilePx + cssW / 2);
        const sy = Math.round((st.sel.Y - st.camY) * tilePx + cssH / 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, Math.max(1, size - 2), Math.max(1, size - 2));
      }
    }

    function showSide(cell) {
      if (!cell) { side.innerHTML = `<div class="empty">No tile</div>`; return; }
      st.sel = cell;
      side.innerHTML = `<h3>Tile ${cell.X}, ${cell.Y}</h3>
        <p class="note">db id ${cell.id}</p>
        <form id="tf" class="form-grid" style="grid-template-columns:1fr">
          ${Editors.field("Name", "Name", cell.Name)}
          ${Editors.field("GroundTile", "GroundTile", cell.GroundTile)}
          ${Editors.field("ForegroundTile", "ForegroundTile", cell.ForegroundTile)}
          ${Editors.field("Music", "Music", cell.Music)}
          ${Editors.field("Enemy", "Enemy", cell.Enemy || "")}
          ${Editors.field("Collision", "Collision", cell.Collision, { type: "checkbox" })}
        </form>
        <p class="note">Ground swatches</p>
        <div class="swatches" id="g-swatch">${groundList.slice(0, 80).map((g) =>
          `<button type="button" class="swatch ${g===cell.GroundTile?"active":""}" title="${esc(g)}" data-g="${esc(g)}" style="background:${hashColor(g)}"></button>`).join("")}</div>
        <p class="note">Enemy must match enemies.Name; empty = "".</p>
        <div class="row-actions">
          <button type="button" class="btn primary" id="save-tile">Apply</button>
          <button type="button" class="btn danger" id="del-tile">Delete tile</button>
        </div>`;
      side.querySelector("#g-swatch")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-g]");
        if (!b) return;
        st.paint.GroundTile = b.dataset.g;
        side.querySelector('[name="GroundTile"]').value = b.dataset.g;
      });
      side.querySelector("#save-tile").onclick = () => {
        const d = Editors.getForm(side.querySelector("#tf"));
        const enemy = d.Enemy ?? "";
        if (enemy && !enemyNames.includes(enemy) && !confirm(`Enemy "${enemy}" is not a known Name. Save anyway?`)) return;
        BQDB.run(`UPDATE world SET GroundTile=?, ForegroundTile=?, Name=?, Music=?, Collision=?, Enemy=? WHERE id=?`,
          [d.GroundTile ?? "", d.ForegroundTile ?? "", d.Name ?? "", d.Music ?? "*", d.Collision ? 1 : 0, enemy, cell.id]);
        Object.assign(cell, { GroundTile: d.GroundTile ?? "", ForegroundTile: d.ForegroundTile ?? "", Name: d.Name ?? "", Music: d.Music ?? "*", Collision: d.Collision ? 1 : 0, Enemy: enemy });
        Editors.toast("Tile saved");
        App.syncDirty();
        draw();
        showSide(cell);
      };
      side.querySelector("#del-tile").onclick = () => {
        if (!confirm(`Delete world tile at ${cell.X},${cell.Y}?`)) return;
        BQDB.run("DELETE FROM world WHERE id=?", [cell.id]);
        at.delete(cell.X + "," + cell.Y);
        st.sel = null;
        App.syncDirty();
        draw();
        side.innerHTML = `<div class="empty">Tile deleted</div>`;
      };
    }

    function applyPaint(x, y) {
      const key = x + "," + y;
      let cell = at.get(key);
      if (st.mode === "collision") {
        if (!cell) return;
        const next = cell.Collision ? 0 : 1;
        BQDB.run("UPDATE world SET Collision=? WHERE id=?", [next, cell.id]);
        cell.Collision = next;
        App.syncDirty();
        return;
      }
      if (st.mode === "paint") {
        const g = st.paint.GroundTile || groundList[0] || "assets/world/grounds/grass.png";
        const f = st.paint.ForegroundTile ?? "";
        if (!cell) {
          // XY unique check
          const id = BQDB.nextId("world");
          BQDB.run(`INSERT INTO world (id, GroundTile, ForegroundTile, Name, X, Y, Music, Collision, Enemy) VALUES (?,?,?,?,?,?,?,?,?)`,
            [id, g, f, st.paint.Name || "", x, y, st.paint.Music || "*", 0, ""]);
          cell = { id, GroundTile: g, ForegroundTile: f, Name: st.paint.Name || "", X: x, Y: y, Music: st.paint.Music || "*", Collision: 0, Enemy: "" };
          at.set(key, cell);
        } else {
          BQDB.run("UPDATE world SET GroundTile=?, ForegroundTile=? WHERE id=?", [g, f === undefined ? cell.ForegroundTile : f, cell.id]);
          cell.GroundTile = g;
          if (f !== undefined) cell.ForegroundTile = f;
        }
        App.syncDirty();
      }
    }

    ws.querySelectorAll("[data-mode]").forEach((b) => {
      b.onclick = () => { st.mode = b.dataset.mode; WorldEditor.render(ws, state); };
    });
    ws.querySelector("#zoom-in").onclick = () => { st.zoom = Math.min(4, st.zoom * 1.25); draw(); };
    ws.querySelector("#zoom-out").onclick = () => { st.zoom = Math.max(0.02, st.zoom / 1.25); draw(); };
    ws.querySelector("#zoom-fit").onclick = () => {
      const spanX = (maxX - minX + 1) * TILE;
      const spanY = (maxY - minY + 1) * TILE;
      st.zoom = Math.min(cssW / spanX, cssH / spanY) * 0.95;
      st.camX = (minX + maxX + 1) / 2;
      st.camY = (minY + maxY + 1) / 2;
      draw();
    };
    ws.querySelector("#btn-add-tile").onclick = () => {
      const xs = prompt("X coordinate", String(Math.round(st.camX)));
      const ys = prompt("Y coordinate", String(Math.round(st.camY)));
      if (xs == null || ys == null) return;
      const x = Number(xs), y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (at.has(x + "," + y)) { alert("A tile already exists at that X,Y"); return; }
      const id = BQDB.nextId("world");
      BQDB.run(`INSERT INTO world (id, GroundTile, ForegroundTile, Name, X, Y, Music, Collision, Enemy) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, groundList[0] || "assets/world/grounds/grass.png", "", "", x, y, "*", 0, ""]);
      const cell = { id, GroundTile: groundList[0] || "assets/world/grounds/grass.png", ForegroundTile: "", Name: "", X: x, Y: y, Music: "*", Collision: 0, Enemy: "" };
      at.set(x + "," + y, cell);
      st.sel = cell;
      App.syncDirty();
      draw();
      showSide(cell);
    };

    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.shiftKey || st.mode === "select" && e.altKey) {
        drag = { x: e.clientX, y: e.clientY, camX: st.camX, camY: st.camY, pan: true };
        canvas.classList.add("panning");
        return;
      }
      const w = screenToWorld(e.clientX, e.clientY);
      if (st.mode === "select") {
        const cell = at.get(w.x + "," + w.y) || null;
        showSide(cell);
        draw();
        drag = { pan: true, x: e.clientX, y: e.clientY, camX: st.camX, camY: st.camY, moved: false };
        return;
      }
      applyPaint(w.x, w.y);
      drag = { paint: true };
      draw();
      if (st.sel || at.get(w.x + "," + w.y)) showSide(at.get(w.x + "," + w.y));
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (drag.pan) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (dx * dx + dy * dy > 16) drag.moved = true;
        st.camX = drag.camX - dx / (st.zoom * TILE);
        st.camY = drag.camY - dy / (st.zoom * TILE);
        draw();
        return;
      }
      if (drag.paint) {
        const w = screenToWorld(e.clientX, e.clientY);
        applyPaint(w.x, w.y);
        draw();
      }
    });
    canvas.addEventListener("pointerup", () => { drag = null; canvas.classList.remove("panning"); });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      st.zoom = Math.min(4, Math.max(0.02, st.zoom * factor));
      draw();
    }, { passive: false });

    // initial paint brush defaults
    if (!st.paint.GroundTile && groundList[0]) st.paint.GroundTile = groundList[0];

    requestAnimationFrame(() => { draw(); if (st.sel) showSide(at.get(st.sel.X + "," + st.sel.Y) || st.sel); });
  }

  return { render };
})();
