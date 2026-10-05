"use strict";

const WorldEditor = (() => {
  const TILE = 16;
  const SPRITE_ZOOM = 0.55; // when tile on screen >= ~9px, draw sprites

  function esc(s) {
    return Editors.esc(s);
  }

  function hashColor(path) {
    const s = String(path || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    // Comma-form HSL — canvas fillStyle often rejects CSS Color 4 space-separated hsl()
    return `hsl(${h % 360}, ${35 + (h % 40)}%, ${35 + ((h >> 8) % 25)}%)`;
  }

  function assetUrl(path) {
    if (!path) return "";
    if (typeof ItemPicker !== "undefined" && ItemPicker.imgUrl) return ItemPicker.imgUrl(path);
    return String(path).split("/").map(encodeURIComponent).join("/");
  }

  function basename(path) {
    const s = String(path || "");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function render(ws, state) {
    if (!state.world) {
      state.world = {
        mode: "select",
        paintLayer: "ground", // ground | fore | clearFore
        paint: { GroundTile: "", ForegroundTile: "" },
        zoom: 0.2,
        camX: 0,
        camY: 0,
        sel: null,
        fitted: false,
        assetFilter: "",
      };
    }
    const st = state.world;

    ws.innerHTML = `<div class="world-wrap">
      <div>
        <div class="world-tools">
          <button type="button" class="btn small ${st.mode === "select" ? "active" : ""}" data-mode="select">Select</button>
          <button type="button" class="btn small ${st.mode === "paint" ? "active" : ""}" data-mode="paint">Paint</button>
          <button type="button" class="btn small ${st.mode === "collision" ? "active" : ""}" data-mode="collision">Toggle collision</button>
          <button type="button" class="btn small" id="zoom-out" title="Zoom out">Zoom −</button>
          <button type="button" class="btn small" id="zoom-in" title="Zoom in">Zoom +</button>
          <button type="button" class="btn small" id="zoom-fit">Fit</button>
          <button type="button" class="btn small" id="btn-add-tile">Add tile at…</button>
          <span class="pill" id="zoom-label"></span>
        </div>
        <div class="map-stage"><canvas id="world-canvas" aria-label="World map editor"></canvas></div>
        <p class="note">Drag to pan · scroll / pinch to zoom · close zoom shows real tiles. Paint picks ground/foreground assets. <code>world.Enemy</code> is enemy Name (<code>""</code> = none).</p>
      </div>
      <aside class="world-side" id="world-side"></aside>
    </div>`;

    const canvas = ws.querySelector("#world-canvas");
    const side = ws.querySelector("#world-side");
    const zoomLabel = ws.querySelector("#zoom-label");
    const ctx = canvas.getContext("2d");
    // Force layout now that map-stage is in the DOM (visible workspace)
    void canvas.parentElement.offsetHeight;

    const cells = BQDB.all("SELECT id, GroundTile, ForegroundTile, Name, X, Y, Music, Collision, Enemy FROM world");
    const at = new Map();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const groundSet = new Set();
    const foreSet = new Set();
    for (const c of cells) {
      at.set(c.X + "," + c.Y, c);
      if (c.X < minX) minX = c.X;
      if (c.X > maxX) maxX = c.X;
      if (c.Y < minY) minY = c.Y;
      if (c.Y > maxY) maxY = c.Y;
      if (c.GroundTile) groundSet.add(c.GroundTile);
      if (c.ForegroundTile) foreSet.add(c.ForegroundTile);
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 10; minY = 0; maxY = 10; }

    const groundList = [...groundSet].sort((a, b) => a.localeCompare(b, "en-GB"));
    const foreList = [...foreSet].sort((a, b) => a.localeCompare(b, "en-GB"));
    const musicList = [...new Set(cells.map((c) => c.Music).filter(Boolean))].sort();
    const enemyNames = BQDB.all("SELECT Name FROM enemies ORDER BY Name").map((r) => r.Name);

    if (!st.paint.GroundTile && groundList[0]) st.paint.GroundTile = groundList[0];
    if (!st.fitted) {
      st.camX = (minX + maxX) / 2;
      st.camY = (minY + maxY) / 2;
      st.fitted = true;
    }

    const images = new Map(); // path -> HTMLImageElement | null (failed)
    let cssW = 1, cssH = 1;
    let raf = 0;

    function scheduleDraw() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; draw(); });
    }

    function sprite(path) {
      if (!path) return null;
      if (images.has(path)) {
        const img = images.get(path);
        return img && img.complete && img.naturalWidth ? img : null;
      }
      const img = new Image();
      images.set(path, img);
      img.onload = () => scheduleDraw();
      img.onerror = () => { images.set(path, null); };
      img.src = assetUrl(path);
      return null;
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const stage = canvas.parentElement;
      const rect = canvas.getBoundingClientRect();
      const stageW = stage ? stage.clientWidth : 0;
      const stageH = stage ? stage.clientHeight : 0;
      cssW = Math.max(0, stageW || rect.width || canvas.clientWidth || 0);
      cssH = Math.max(0, stageH || rect.height || canvas.clientHeight || 0);
      if (cssW < 32 || cssH < 32) return false;
      const bw = Math.max(1, Math.round(cssW * dpr));
      const bh = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }

    function clampZoom(z) {
      return Math.min(6, Math.max(0.02, z));
    }

    function screenToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const tilePx = TILE * st.zoom;
      return {
        wx: st.camX + (sx - cssW / 2) / tilePx,
        wy: st.camY + (sy - cssH / 2) / tilePx,
        tx: Math.floor(st.camX + (sx - cssW / 2) / tilePx),
        ty: Math.floor(st.camY + (sy - cssH / 2) / tilePx),
        sx, sy,
      };
    }

    function zoomAt(clientX, clientY, nextZoom) {
      const before = screenToWorld(clientX, clientY);
      st.zoom = clampZoom(nextZoom);
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const tilePx = TILE * st.zoom;
      st.camX = before.wx - (sx - cssW / 2) / tilePx;
      st.camY = before.wy - (sy - cssH / 2) / tilePx;
      scheduleDraw();
    }

    function fit() {
      if (!resize()) return false;
      const spanX = (maxX - minX + 1) * TILE;
      const spanY = (maxY - minY + 1) * TILE;
      st.zoom = clampZoom(Math.min(cssW / spanX, cssH / spanY) * 0.95);
      st.camX = (minX + maxX + 1) / 2;
      st.camY = (minY + maxY + 1) / 2;
      scheduleDraw();
      return true;
    }

    function draw() {
      if (!resize()) return;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cssW, cssH);
      const tilePx = TILE * st.zoom;
      zoomLabel.textContent = `${Math.round(st.zoom * 100)}% · ${tilePx >= TILE * SPRITE_ZOOM ? "sprites" : "overview"}`;

      const x0 = Math.floor(st.camX - cssW / 2 / tilePx) - 1;
      const y0 = Math.floor(st.camY - cssH / 2 / tilePx) - 1;
      const x1 = Math.floor(st.camX + cssW / 2 / tilePx) + 1;
      const y1 = Math.floor(st.camY + cssH / 2 / tilePx) + 1;
      const useSprites = tilePx >= TILE * SPRITE_ZOOM;
      const size = Math.max(1, Math.ceil(tilePx));
      let drawn = 0;

      // Iterate existing tiles only (50k), cull to viewport — avoids empty-space scan
      for (const cell of at.values()) {
        if (cell.X < x0 || cell.X > x1 || cell.Y < y0 || cell.Y > y1) continue;
        const sx = Math.round((cell.X - st.camX) * tilePx + cssW / 2);
        const sy = Math.round((cell.Y - st.camY) * tilePx + cssH / 2);
        if (sx + size < 0 || sy + size < 0 || sx > cssW || sy > cssH) continue;

        // Always paint ground colour first so the map is visible even if images fail
        ctx.fillStyle = hashColor(cell.GroundTile);
        ctx.fillRect(sx, sy, size, size);

        if (useSprites) {
          const g = sprite(cell.GroundTile);
          if (g) ctx.drawImage(g, sx, sy, size, size);
          if (cell.ForegroundTile) {
            const f = sprite(cell.ForegroundTile);
            if (f) ctx.drawImage(f, sx, sy, size, size);
            else {
              ctx.globalAlpha = 0.55;
              ctx.fillStyle = hashColor(cell.ForegroundTile);
              ctx.fillRect(sx, sy, size, size);
              ctx.globalAlpha = 1;
            }
          }
        } else if (cell.ForegroundTile) {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = hashColor(cell.ForegroundTile);
          ctx.fillRect(sx, sy, size, size);
          ctx.globalAlpha = 1;
        }

        if (cell.Collision && tilePx >= 4) {
          ctx.strokeStyle = "rgba(231,111,81,0.75)";
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy + 0.5, Math.max(0, size - 1), Math.max(0, size - 1));
        }
        if (cell.Enemy && tilePx >= 6) {
          ctx.fillStyle = "#f4a261";
          const d = Math.max(2, size * 0.28);
          ctx.fillRect(sx + (size - d) / 2, sy + (size - d) / 2, d, d);
        }
        drawn++;
      }
      if (zoomLabel && drawn === 0 && at.size) {
        zoomLabel.textContent += " · no tiles in view — Fit";
      } else if (zoomLabel) {
        zoomLabel.dataset.drawn = String(drawn);
      }

      if (st.sel) {
        const sx = Math.round((st.sel.X - st.camX) * tilePx + cssW / 2);
        const sy = Math.round((st.sel.Y - st.camY) * tilePx + cssH / 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, Math.max(1, size - 2), Math.max(1, size - 2));
      }
    }

    function tilePreview(path, active) {
      if (!path) {
        return `<button type="button" class="tile-asset ${active ? "active" : ""}" data-path="" title="(empty)">
          <span class="tile-thumb ph"></span><span class="tile-asset-name">(none)</span></button>`;
      }
      return `<button type="button" class="tile-asset ${active ? "active" : ""}" data-path="${esc(path)}" title="${esc(path)}">
        <img class="tile-thumb" alt="" src="${esc(assetUrl(path))}" loading="lazy" decoding="async"
          onerror="this.classList.add('broken')">
        <span class="tile-asset-name">${esc(basename(path))}</span></button>`;
    }

    function paintBrushPanel() {
      const filter = (st.assetFilter || "").toLocaleLowerCase("en-GB");
      const list = st.paintLayer === "fore" ? foreList : groundList;
      const filtered = list.filter((p) => !filter || p.toLocaleLowerCase("en-GB").includes(filter));
      const current = st.paintLayer === "fore" ? (st.paint.ForegroundTile || "") : (st.paint.GroundTile || "");
      return `
        <h3>Paint brush</h3>
        <div class="world-tools" style="margin-bottom:8px">
          <button type="button" class="btn small ${st.paintLayer === "ground" ? "active" : ""}" data-layer="ground">Ground</button>
          <button type="button" class="btn small ${st.paintLayer === "fore" ? "active" : ""}" data-layer="fore">Foreground</button>
          <button type="button" class="btn small ${st.paintLayer === "clearFore" ? "active" : ""}" data-layer="clearFore">Clear fore</button>
        </div>
        <p class="note">Ground: <code>${esc(basename(st.paint.GroundTile) || "—")}</code><br>
           Fore: <code>${esc(basename(st.paint.ForegroundTile) || "(none)")}</code></p>
        ${st.paintLayer === "clearFore" ? `<p class="note">Click tiles to clear ForegroundTile.</p>` : `
        <input class="search" id="asset-q" placeholder="Search tile assets…" value="${esc(st.assetFilter || "")}">
        <div class="tile-asset-list" id="asset-list">
          ${st.paintLayer === "fore" ? tilePreview("", current === "") : ""}
          ${filtered.slice(0, 120).map((p) => tilePreview(p, p === current)).join("") || `<div class="empty">No assets match</div>`}
        </div>`}`;
    }

    function showSide(cell) {
      let html = "";
      if (st.mode === "paint") html += paintBrushPanel();

      if (cell) {
        st.sel = cell;
        const enemyOk = !cell.Enemy || enemyNames.includes(cell.Enemy);
        html += `<h3>Tile ${cell.X}, ${cell.Y}</h3>
          <p class="note">db id ${cell.id}</p>
          <div class="tile-preview-row">
            ${cell.GroundTile ? `<img class="tile-thumb lg" alt="" src="${esc(assetUrl(cell.GroundTile))}">` : `<span class="tile-thumb ph lg"></span>`}
            ${cell.ForegroundTile ? `<img class="tile-thumb lg" alt="" src="${esc(assetUrl(cell.ForegroundTile))}">` : ""}
          </div>
          <form id="tf" class="form-grid" style="grid-template-columns:1fr">
            ${Editors.field("Name", "Name", cell.Name)}
            ${Editors.field("GroundTile", "GroundTile", cell.GroundTile)}
            ${Editors.field("ForegroundTile", "ForegroundTile", cell.ForegroundTile)}
            ${Editors.field("Music", "Music", cell.Music || "*", { type: "select", options: ["*", ...musicList.filter((m) => m !== "*"), ...(cell.Music && cell.Music !== "*" && !musicList.includes(cell.Music) ? [cell.Music] : [])] })}
            ${Editors.field("Enemy", "Enemy", cell.Enemy || "")}
            ${Editors.field("Collision", "Collision", cell.Collision, { type: "checkbox" })}
          </form>
          <p class="note ${enemyOk ? "" : "err"}">Enemy must match an enemies.Name; empty = "". ${enemyOk ? "" : "Unknown name."}</p>
          <div class="row-actions">
            <button type="button" class="btn primary" id="save-tile">Apply</button>
            <button type="button" class="btn danger" id="del-tile">Delete tile</button>
          </div>`;
      } else if (st.mode !== "paint") {
        html += `<div class="empty">Select a tile · drag to pan · scroll to zoom</div>`;
      }

      side.innerHTML = html || `<div class="empty">—</div>`;

      side.querySelectorAll("[data-layer]").forEach((b) => {
        b.onclick = () => { st.paintLayer = b.dataset.layer; showSide(st.sel); };
      });
      const aq = side.querySelector("#asset-q");
      if (aq) {
        aq.oninput = () => { st.assetFilter = aq.value; showSide(st.sel); };
      }
      side.querySelector("#asset-list")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-path]");
        if (!b) return;
        const path = b.getAttribute("data-path");
        if (st.paintLayer === "fore") st.paint.ForegroundTile = path;
        else st.paint.GroundTile = path || st.paint.GroundTile;
        showSide(st.sel);
      });

      side.querySelector("#save-tile")?.addEventListener("click", () => {
        if (!st.sel) return;
        const d = Editors.getForm(side.querySelector("#tf"));
        const enemy = d.Enemy ?? "";
        if (enemy && !enemyNames.includes(enemy) && !confirm(`Enemy "${enemy}" is not a known Name. Save anyway?`)) return;
        BQDB.run(`UPDATE world SET GroundTile=?, ForegroundTile=?, Name=?, Music=?, Collision=?, Enemy=? WHERE id=?`,
          [d.GroundTile ?? "", d.ForegroundTile ?? "", d.Name ?? "", d.Music ?? "*", d.Collision ? 1 : 0, enemy, st.sel.id]);
        Object.assign(st.sel, {
          GroundTile: d.GroundTile ?? "",
          ForegroundTile: d.ForegroundTile ?? "",
          Name: d.Name ?? "",
          Music: d.Music ?? "*",
          Collision: d.Collision ? 1 : 0,
          Enemy: enemy,
        });
        if (d.GroundTile) groundSet.add(d.GroundTile);
        if (d.ForegroundTile) foreSet.add(d.ForegroundTile);
        Editors.toast("Tile saved");
        App.syncDirty();
        scheduleDraw();
        showSide(st.sel);
      });

      side.querySelector("#del-tile")?.addEventListener("click", () => {
        if (!st.sel || !confirm(`Delete world tile at ${st.sel.X},${st.sel.Y}?`)) return;
        BQDB.run("DELETE FROM world WHERE id=?", [st.sel.id]);
        at.delete(st.sel.X + "," + st.sel.Y);
        st.sel = null;
        App.syncDirty();
        scheduleDraw();
        showSide(null);
      });
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
      if (st.mode !== "paint") return;

      if (st.paintLayer === "clearFore") {
        if (!cell) return;
        BQDB.run("UPDATE world SET ForegroundTile=? WHERE id=?", ["", cell.id]);
        cell.ForegroundTile = "";
        App.syncDirty();
        return;
      }

      const g = st.paint.GroundTile || groundList[0] || "assets/world/grounds/grass.png";
      const f = st.paint.ForegroundTile || "";

      if (!cell) {
        const id = BQDB.nextId("world");
        const fore = st.paintLayer === "fore" ? f : "";
        const ground = st.paintLayer === "ground" ? g : g;
        BQDB.run(`INSERT INTO world (id, GroundTile, ForegroundTile, Name, X, Y, Music, Collision, Enemy) VALUES (?,?,?,?,?,?,?,?,?)`,
          [id, ground, fore, "", x, y, "*", 0, ""]);
        cell = { id, GroundTile: ground, ForegroundTile: fore, Name: "", X: x, Y: y, Music: "*", Collision: 0, Enemy: "" };
        at.set(key, cell);
      } else if (st.paintLayer === "ground") {
        BQDB.run("UPDATE world SET GroundTile=? WHERE id=?", [g, cell.id]);
        cell.GroundTile = g;
      } else if (st.paintLayer === "fore") {
        BQDB.run("UPDATE world SET ForegroundTile=? WHERE id=?", [f, cell.id]);
        cell.ForegroundTile = f;
      }
      App.syncDirty();
      st.sel = cell;
    }

    ws.querySelectorAll("[data-mode]").forEach((b) => {
      b.onclick = () => {
        st.mode = b.dataset.mode;
        ws.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x.dataset.mode === st.mode));
        showSide(st.sel);
      };
    });
    ws.querySelector("#zoom-in").onclick = () => {
      const rect = canvas.getBoundingClientRect();
      zoomAt(rect.left + cssW / 2, rect.top + cssH / 2, st.zoom * 1.25);
    };
    ws.querySelector("#zoom-out").onclick = () => {
      const rect = canvas.getBoundingClientRect();
      zoomAt(rect.left + cssW / 2, rect.top + cssH / 2, st.zoom / 1.25);
    };
    ws.querySelector("#zoom-fit").onclick = () => fit();
    ws.querySelector("#btn-add-tile").onclick = () => {
      const xs = prompt("X coordinate", String(Math.round(st.camX)));
      const ys = prompt("Y coordinate", String(Math.round(st.camY)));
      if (xs == null || ys == null) return;
      const x = Number(xs), y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (at.has(x + "," + y)) { alert("A tile already exists at that X,Y"); return; }
      const g = st.paint.GroundTile || groundList[0] || "assets/world/grounds/grass.png";
      const id = BQDB.nextId("world");
      BQDB.run(`INSERT INTO world (id, GroundTile, ForegroundTile, Name, X, Y, Music, Collision, Enemy) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, g, "", "", x, y, "*", 0, ""]);
      const cell = { id, GroundTile: g, ForegroundTile: "", Name: "", X: x, Y: y, Music: "*", Collision: 0, Enemy: "" };
      at.set(x + "," + y, cell);
      st.sel = cell;
      App.syncDirty();
      scheduleDraw();
      showSide(cell);
    };

    // ——— Pointer: pan / paint / pinch ———
    let spaceDown = false;
    const onKey = (e) => {
      if (e.code === "Space") {
        spaceDown = e.type === "keydown";
        if (e.type === "keydown") e.preventDefault();
      }
    };
    if (WorldEditor._keyDown) {
      window.removeEventListener("keydown", WorldEditor._keyDown);
      window.removeEventListener("keyup", WorldEditor._keyUp);
    }
    WorldEditor._keyDown = onKey;
    WorldEditor._keyUp = onKey;
    window.addEventListener("keydown", WorldEditor._keyDown);
    window.addEventListener("keyup", WorldEditor._keyUp);

    const pointers = new Map();
    let drag = null;
    let pinch = null;

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        drag = null;
        pinch = null;
        canvas.classList.add("panning");
        return;
      }

      const panGesture = e.button === 1 || e.button === 2 || e.shiftKey || e.altKey || spaceDown;
      if (panGesture || st.mode === "select") {
        drag = { x: e.clientX, y: e.clientY, camX: st.camX, camY: st.camY, moved: false, pan: true, paint: false };
        canvas.classList.add("panning");
        return;
      }
      // paint / collision
      const w = screenToWorld(e.clientX, e.clientY);
      applyPaint(w.tx, w.ty);
      drag = { paint: true, pan: false };
      scheduleDraw();
      showSide(at.get(w.tx + "," + w.ty) || st.sel);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId) && !drag) return;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        if (!pinch) {
          const w = screenToWorld(midX, midY);
          pinch = { dist, zoom: st.zoom, wx: w.wx, wy: w.wy };
        }
        st.zoom = clampZoom(pinch.zoom * (dist / pinch.dist));
        const rect = canvas.getBoundingClientRect();
        const tilePx = TILE * st.zoom;
        st.camX = pinch.wx - (midX - rect.left - cssW / 2) / tilePx;
        st.camY = pinch.wy - (midY - rect.top - cssH / 2) / tilePx;
        scheduleDraw();
        return;
      }

      if (!drag) return;
      if (drag.pan) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (dx * dx + dy * dy > 16) drag.moved = true;
        const tilePx = TILE * st.zoom;
        st.camX = drag.camX - dx / tilePx;
        st.camY = drag.camY - dy / tilePx;
        scheduleDraw();
        return;
      }
      if (drag.paint) {
        const w = screenToWorld(e.clientX, e.clientY);
        applyPaint(w.tx, w.ty);
        scheduleDraw();
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        if (drag && drag.pan && !drag.moved && st.mode === "select") {
          const w = screenToWorld(e.clientX, e.clientY);
          const cell = at.get(w.tx + "," + w.ty) || null;
          showSide(cell);
          scheduleDraw();
        }
        drag = null;
        canvas.classList.remove("panning");
      }
    }
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomAt(e.clientX, e.clientY, st.zoom * factor);
    }, { passive: false });

    showSide(st.sel);

    let hadSize = false;
    let roQuiet = false;
    let lastRoW = -1, lastRoH = -1;
    function ensureSizedDraw(forceFit) {
      if (roQuiet) return;
      const ok = resize();
      if (!ok) {
        hadSize = false;
        if (zoomLabel) zoomLabel.textContent = "Waiting for layout…";
        return;
      }
      const needFit = forceFit || !st._didAutoFit || !hadSize;
      hadSize = true;
      roQuiet = true;
      try {
        if (needFit) {
          st._didAutoFit = true;
          fit();
        } else {
          scheduleDraw();
        }
      } finally {
        // Release after paint so ResizeObserver from canvas buffer resize is ignored
        requestAnimationFrame(() => { roQuiet = false; });
      }
    }

    if (WorldEditor._ro) {
      try { WorldEditor._ro.disconnect(); } catch (_) {}
      WorldEditor._ro = null;
    }
    let roTimer = 0;
    WorldEditor._ro = new ResizeObserver(() => {
      if (roQuiet) return;
      const stage = canvas.parentElement;
      if (!stage) return;
      const w = stage.clientWidth, h = stage.clientHeight;
      if (w === lastRoW && h === lastRoH) return;
      lastRoW = w;
      lastRoH = h;
      clearTimeout(roTimer);
      roTimer = setTimeout(() => ensureSizedDraw(false), 50);
    });
    if (canvas.parentElement) WorldEditor._ro.observe(canvas.parentElement);

    let tries = 0;
    function bootLoop() {
      tries += 1;
      ensureSizedDraw(true);
      if (!hadSize && tries < 90) requestAnimationFrame(bootLoop);
    }
    requestAnimationFrame(bootLoop);
    setTimeout(() => ensureSizedDraw(true), 100);
    setTimeout(() => ensureSizedDraw(true), 400);
  }

  return { render };
})();
