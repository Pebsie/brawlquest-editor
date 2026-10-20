"use strict";
// Effect sprites: a port of the client's scripts/effects/fx-sprites.lua so the
// editor draws a primitive's `sprite` (and an effect's Visual) the way the game
// does. Definition keys: img | style (ringpulse, runes, shockwave, swirl,
// embers), frames, fw, fh, cols, fps (10), loop (true), fit (radius | tile |
// scale), scale, tint "#rrggbb", alpha, rot (deg), spin (deg/s), blend "add",
// face, over. The art list comes from assets/fx/index.json.
const BQFX = (() => {
  const STYLES = ["ringpulse", "runes", "shockwave", "swirl", "embers"];
  const STYLE_TINT = { ringpulse: "#ff7340", runes: "#8cbfff", shockwave: "#ffffff", swirl: "#b373ff", embers: "#ff9933" };
  const STYLE_NOTE = { ringpulse: "rings pulsing outward", runes: "spinning rune circle with a star", shockwave: "one expanding shock ring", swirl: "four spinning spiral arms", embers: "rising ember sparks" };
  const KEYS = ["img", "style", "frames", "fw", "fh", "cols", "fps", "loop", "fit", "scale", "tint", "alpha", "rot", "spin", "blend", "face", "over"];
  const MAX_JSON = 600; // the API's fx_sprites.go cap
  const manifest = { sprites: [], byPath: {}, ready: false };
  const imgs = {}, tinted = {};
  let onReady = [];
  const load = () => fetch("assets/fx/index.json").then(r => r.json()).then(j => {
    manifest.sprites = j.sprites || []; manifest.byPath = Object.fromEntries(manifest.sprites.map(s => [s.path, s])); manifest.ready = true;
    onReady.forEach(f => f()); onReady = [];
  }).catch(() => { manifest.ready = true; });
  if (typeof fetch !== "undefined" && typeof document !== "undefined") load();
  const whenReady = f => { if (manifest.ready) f(); else onReady.push(f); };

  // Parse a stored value: an object, a JSON string or a bare .png path.
  function parse(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (s[0] === "{") { try { return parse(JSON.parse(s)); } catch { return null; } }
      return /\.png$/i.test(s) ? { img: s } : null;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw.img || raw.style ? raw : null;
  }
  // Clean for storage: known keys only, defaults dropped.
  function clean(raw) {
    const s = parse(raw); if (!s) return null;
    const o = {};
    if (s.style && STYLES.includes(s.style)) o.style = s.style; else if (s.img) o.img = String(s.img); else return null;
    for (const k of ["frames", "fw", "fh", "cols", "fps", "scale", "alpha", "rot", "spin"]) if (s[k] !== undefined && s[k] !== "" && Number.isFinite(+s[k])) o[k] = +s[k];
    if (o.frames <= 1) delete o.frames;
    if (o.fps === 10) delete o.fps;
    if (o.scale === 1) delete o.scale;
    if (o.alpha >= 1) delete o.alpha;
    if (!o.rot) delete o.rot; if (!o.spin) delete o.spin;
    if (s.loop === false) o.loop = false;
    if (["radius", "tile", "scale"].includes(s.fit)) o.fit = s.fit;
    if (/^#?[0-9a-f]{6}$/i.test(s.tint || "")) o.tint = s.tint[0] === "#" ? s.tint.toLowerCase() : "#" + s.tint.toLowerCase();
    if (s.blend === "add") o.blend = "add";
    if (s.face === false) o.face = false; else if (s.face) o.face = true;
    if (s.over) o.over = true;
    return o;
  }
  function validate(s, what) {
    if (s === undefined) return;
    const c = clean(s);
    if (!c) throw new Error(`${what}: needs img or style (${STYLES.join(", ")})`);
    if (JSON.stringify(c).length > MAX_JSON) throw new Error(`${what}: definition is over ${MAX_JSON} characters`);
  }
  function norm(raw) {
    const s = parse(raw); if (!s) return null;
    return {
      img: s.style ? null : s.img, style: STYLES.includes(s.style) ? s.style : null,
      frames: Math.max(1, Math.trunc(+s.frames || 1)), fw: +s.fw || 0, fh: +s.fh || 0, cols: +s.cols || 0,
      fps: +s.fps || 10, loop: s.loop !== false, fit: s.fit, scale: +s.scale || 1,
      alpha: Math.max(0, Math.min(1, s.alpha === undefined || s.alpha === "" ? 1 : +s.alpha)),
      rot: (+s.rot || 0) * Math.PI / 180, spin: (+s.spin || 0) * Math.PI / 180, add: s.blend === "add", face: s.face, over: !!s.over,
      tint: /^#?[0-9a-f]{6}$/i.test(s.tint || "") ? s.tint.replace(/^#?/, "#") : (s.style ? STYLE_TINT[s.style] : null),
    };
  }
  const urlOf = p => (typeof assetURL === "function" ? assetURL(p) : p);
  function image(p) {
    let i = imgs[p];
    if (!i) { i = imgs[p] = new Image(); if (typeof ASSETS !== "undefined" && ASSETS.mode === "url") i.crossOrigin = "anonymous"; i.src = urlOf(p); }
    return i.complete && i.naturalWidth ? i : null;
  }
  const frameAt = (d, t) => d.frames <= 1 ? 0 : d.loop ? Math.floor(Math.max(0, t) * d.fps) % d.frames : Math.min(Math.floor(Math.max(0, t) * d.fps), d.frames - 1);
  function frameRect(d, im, f) {
    const cols = d.cols || d.frames, rows = Math.ceil(d.frames / cols);
    const fw = d.fw || Math.floor(im.naturalWidth / cols), fh = d.fh || Math.floor(im.naturalHeight / rows);
    return [(f % cols) * fw, Math.floor(f / cols) * fh, fw, fh];
  }
  // Tinted copy of the sheet (multiply, alpha kept), cached per image+tint.
  function source(d, im) {
    if (!d.tint || d.tint.toLowerCase() === "#ffffff") return im;
    const k = d.img + d.tint;
    if (tinted[k]) return tinted[k];
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0); g.globalCompositeOperation = "multiply"; g.fillStyle = d.tint; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "destination-in"; g.drawImage(im, 0, 0);
    return (tinted[k] = c);
  }
  const RUNE = [[0, 0, 0, 1, 0, .5, 1, .5], [0, 0, 1, 1, 0, 1, 1, 0], [.5, 0, .5, 1, 0, .3, 1, .3], [0, 1, .5, 0, .5, 0, 1, 1], [0, 0, 1, 0, .5, 0, .5, 1], [0, .5, .5, 0, .5, 0, 1, .5]];
  function style(g, d, x, y, r, t, a) {
    g.strokeStyle = g.fillStyle = d.tint; g.lineWidth = 2;
    const ring = (rad, al) => { g.globalAlpha = Math.max(0, al); g.beginPath(); g.arc(x, y, Math.max(.1, rad), 0, Math.PI * 2); g.stroke(); };
    if (d.style === "ringpulse") for (let i = 0; i < 3; i++) { const ph = (t * .8 + i / 3) % 1; ring(r * ph, a * (1 - ph)); }
    else if (d.style === "shockwave") { const ph = (t * 1.25) % 1; g.lineWidth = 1 + 5 * (1 - ph); ring(r * ph, a * (1 - ph) * .9); g.lineWidth = 1; ring(r * ph * .8, a * (1 - ph) * .4); }
    else if (d.style === "runes") {
      const sp = (d.spin || .6) * t + d.rot;
      ring(r, a * .8); g.lineWidth = 1; ring(r * .72, a * .8);
      const gs = Math.max(3, r * .16);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const an = sp + i * Math.PI / 4, cx = x + Math.cos(an) * r * .86, cy = y + Math.sin(an) * r * .86, gl = RUNE[i % RUNE.length];
        for (let k = 0; k < gl.length; k += 4) { g.moveTo(cx + (gl[k] - .5) * gs, cy + (gl[k + 1] - .5) * gs); g.lineTo(cx + (gl[k + 2] - .5) * gs, cy + (gl[k + 3] - .5) * gs); }
      }
      g.stroke();
      g.globalAlpha = a * .5; g.beginPath();
      for (let i = 0; i <= 5; i++) { const an = -sp * .5 + i * 4 * Math.PI / 5 - Math.PI / 2; const px = x + Math.cos(an) * r * .62, py = y + Math.sin(an) * r * .62; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    } else if (d.style === "swirl") {
      const sp = (d.spin || 2.5) * t + d.rot;
      g.globalAlpha = a * .75;
      for (let arm = 0; arm < 4; arm++) { g.beginPath(); for (let s = 0; s <= 16; s++) { const k = s / 16, an = sp + arm * Math.PI / 2 + k * 3; const px = x + Math.cos(an) * r * k, py = y + Math.sin(an) * r * k; s ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); }
    } else if (d.style === "embers") {
      for (let i = 1; i <= 14; i++) {
        const ph = (t * .6 + i * .137) % 1, an = i * 2.399, rr = r * (.2 + .75 * ((i * .618) % 1));
        g.globalAlpha = a * (1 - ph); g.fillRect(x + Math.cos(an) * rr - 1.5, y + Math.sin(an) * rr * .6 - ph * r * .6 - 1.5, 3, 3);
      }
    }
  }
  // Draw sprite raw centred on x, y (canvas px). r = radius in px; t = seconds;
  // o: { alpha, fit (default when the sprite has none), angle (travel),
  // zoom (canvas px per game px for native-size fits: tile and scale) }.
  function draw(g, raw, x, y, r, t, o = {}) {
    const d = raw && raw.frames !== undefined && "add" in raw ? raw : norm(raw);
    if (!d) return false;
    const a = d.alpha * (o.alpha === undefined ? 1 : o.alpha);
    if (a <= .001) return true;
    g.save();
    if (d.add) g.globalCompositeOperation = "lighter";
    g.imageSmoothingEnabled = false;
    if (d.style) style(g, d, x, y, r * d.scale, t, a);
    else {
      const im = image(d.img);
      if (im) {
        const src = source(d, im), f = frameAt(d, t), [sx, sy, fw, fh] = frameRect(d, im, f);
        const fit = d.fit || o.fit || "radius";
        let ang = d.rot + d.spin * t;
        if (o.angle !== undefined && d.face !== false) ang += o.angle;
        g.globalAlpha = a;
        const z = o.zoom || 1;
        if (fit === "tile") {
          const tw = fw * d.scale * z, th = fh * d.scale * z, n = Math.ceil(r / tw) + 1, m = Math.ceil(r / th) + 1;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
          for (let i = -n; i < n; i++) for (let j = -m; j < m; j++) {
            const ff = d.frames > 1 ? (((f + i * 3 + j * 5) % d.frames) + d.frames) % d.frames : f, rc = frameRect(d, im, ff);
            g.drawImage(src, rc[0], rc[1], fw, fh, x + i * tw, y + j * th, tw, th);
          }
        } else {
          const w = fit === "scale" ? fw * d.scale * z : 2 * r * d.scale, hh = fit === "scale" ? fh * d.scale * z : 2 * r * d.scale;
          g.translate(x, y); g.rotate(ang); g.drawImage(src, sx, sy, fw, fh, -w / 2, -hh / 2, w, hh);
        }
      }
    }
    g.restore();
    return true;
  }
  // Fill a manifest entry's animation settings into a definition.
  function fromManifest(path) {
    const m = manifest.byPath[path], o = { img: path };
    if (!m) return o;
    if (m.frames > 1) { o.frames = m.frames; if (m.fps && m.fps !== 10) o.fps = m.fps; if (m.loop === false) o.loop = false; }
    if (m.fit) o.fit = m.fit;
    if (m.face) o.face = true;
    return o;
  }
  // Picker groups: all effect art, one group per category, procedural styles.
  function groups() {
    const ent = s => ({ value: s.path, label: s.name, note: (s.frames > 1 ? s.frames + " frames" : "still") + " · " + s.cats.join(", "), anim: s.frames > 1 ? s.frames : 0 });
    const cats = [...new Set(manifest.sprites.flatMap(s => s.cats))].sort();
    return [{ id: "fx", label: "All effects", entries: manifest.sprites.map(ent) },
      ...cats.map(c => ({ id: "fx-" + c, label: c, entries: manifest.sprites.filter(s => s.cats.includes(c)).map(ent) })),
      { id: "fx-style", label: "procedural", entries: STYLES.map(s => ({ value: "style:" + s, img: styleThumb(s), raw: true, label: s, note: STYLE_NOTE[s] })) }];
  }
  const thumbs = {};
  function styleThumb(s) {
    if (thumbs[s]) return thumbs[s];
    const c = document.createElement("canvas"); c.width = c.height = 48;
    const g = c.getContext("2d"); g.fillStyle = "#555"; g.fillRect(0, 0, 48, 48);
    draw(g, { style: s }, 24, 24, 20, .35);
    return (thumbs[s] = c.toDataURL());
  }
  // Small animated preview canvas for a definition getter.
  function previewCanvas(get, size = 64) {
    const c = document.createElement("canvas"); c.width = c.height = size; c.className = "fxprev";
    const t0 = performance.now();
    const tick = now => {
      if (!c.isConnected && performance.now() - t0 > 2000) return;
      const g = c.getContext("2d"); g.clearRect(0, 0, size, size);
      g.fillStyle = "#e9ecef"; g.fillRect(0, 0, size, size);
      const s = get();
      if (s) { draw(g, s, size / 2, size / 2, size / 2 - 6, (now - t0) / 1000, { fit: "radius" }); g.strokeStyle = "rgba(200,40,20,.9)"; g.lineWidth = 1; g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2); g.stroke(); }
      else { g.fillStyle = "#888"; g.font = "10px system-ui"; g.textAlign = "center"; g.fillText("default", size / 2, size / 2 + 3); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return c;
  }
  return { STYLES, KEYS, MAX_JSON, manifest, whenReady, parse, clean, validate, norm, draw, frameAt, fromManifest, groups, previewCanvas, load };
})();
if (typeof module !== "undefined") module.exports = BQFX;
