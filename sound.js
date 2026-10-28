"use strict";
// Sound workshop: record (or upload) a sound, trim it, change its pitch and
// length, and give it to a mob or NPC. The game's sounds are recordings
// pitched and stretched, so that is what the controls do:
//   - "Pitch and length": pitch in semitones and length as a factor, each on
//     its own (a WSOLA time-stretch in JS, then a resample in Web Audio). The
//     existing sounds were made like this (Cave Spider: high voice, long).
//   - "Tape speed": the two linked, like a tape or sampler played fast/slow.
// Preview plays the same Web Audio graph live that the save renders with an
// OfflineAudioContext, at 32 kHz mono, written as a 16-bit WAV. The raw
// recording is kept beside it (sfx.Raw) with the settings (sfx.Recipe), so a
// sound can be reopened and redone. Tables: the API's
// content/migrations/2026-10-28-sound-slots.sql and docs/SOUNDS.md.

const SFX_RATE = 32000, SFX_MAX_REC = 15;
const SFX_SLOT_HELP = {
  enemy: {
    aggro: ["Aggro", "when it spots you", "its folder sound (assets/sfx/monsters/<name>/aggro), else the skeleton's"],
    attack: ["Attack", "when it hits you", "nothing"],
    hurt: ["Hurt", "when you hit it, on top of the hit thud", "only the hit thud"],
    death: ["Death", "when it dies", "its folder sound, else the skeleton's"],
    idle: ["Idle", "now and then while you are near (every 8-20 s)", "nothing"],
  },
  npc: {
    greet: ["Greet", "when you start talking to them", "the sound for their sprite, else person.ogg"],
    talk: ["Talk", "on each new page of the conversation after the first", "nothing"],
  },
};
const SFX_RECIPE = { trim: [0, 0], mode: "separate", semitones: 0, stretch: 1, speed: 1, gain: 0, normalise: true, fadeIn: 0.005, fadeOut: 0.03 };
const SFX_SHAPE = ["mode", "semitones", "stretch", "speed", "gain", "normalise", "fadeIn", "fadeOut"];
const SFX_BUILTIN = [
  ["As recorded", {}],
  ["Small critter", { semitones: 9, stretch: 0.7 }],
  ["Spider (high, long)", { semitones: 14, stretch: 1.25 }],
  ["Big beast", { semitones: -8, stretch: 1.3 }],
  ["Ghostly", { semitones: 4, stretch: 1.8, fadeIn: 0.12, fadeOut: 0.4 }],
  ["Villager", { semitones: 2, stretch: 0.85 }],
  ["Chipmunk (tape)", { mode: "tape", speed: 1.7 }],
  ["Giant (tape)", { mode: "tape", speed: 0.6 }],
].map(([Name, r]) => ({ id: 0, Name, recipe: { ...SFX_RECIPE, ...r } }));

// ---- audio plumbing
let SFXctx = null;
function sfxCtx() {
  if (!SFXctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) throw new Error("This browser has no Web Audio"); SFXctx = new C(); }
  if (SFXctx.state === "suspended") SFXctx.resume();
  return SFXctx;
}
function sfxOffline(len, rate) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new C(1, Math.max(1, Math.ceil(len)), rate || SFX_RATE);
}
const sfxRun = oc => new Promise((res, rej) => { oc.oncomplete = e => res(e.renderedBuffer); const p = oc.startRendering(); if (p && p.then) p.then(res, rej); });
function sfxBuffer(ctx, f32, rate) {
  const b = ctx.createBuffer(1, Math.max(1, f32.length), rate || SFX_RATE);
  b.getChannelData(0).set(f32); return b;
}
// Any decoded buffer to mono at 32 kHz.
async function sfxTo32k(buf) {
  if (buf.sampleRate === SFX_RATE && buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const oc = sfxOffline(buf.duration * SFX_RATE);
  const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start(0);
  return (await sfxRun(oc)).getChannelData(0).slice();
}
const sfxDecode = u8 => new Promise((res, rej) => {
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const p = sfxCtx().decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej);
});

// ---- WAV
function sfxWav(f32, rate) {
  const n = f32.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true); }
  return new Uint8Array(b);
}
// 16-bit PCM WAV (ours) to samples, without a decoder; null for anything else.
function sfxWavRead(u8) {
  if (!u8 || u8.length < 44) return null;
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), tag = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let o = 12, fmt = null;
  while (o + 8 <= u8.length) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === "fmt ") fmt = { pcm: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === "data" && fmt) {
      if (fmt.pcm !== 1 || fmt.bits !== 16) return null;
      const n = Math.floor(Math.min(len, u8.length - o - 8) / 2 / fmt.ch), out = new Float32Array(n);
      for (let i = 0; i < n; i++) { let a = 0; for (let c = 0; c < fmt.ch; c++) a += v.getInt16(o + 8 + (i * fmt.ch + c) * 2, true); out[i] = a / fmt.ch / 32768; }
      return { rate: fmt.rate, data: out };
    }
    o += 8 + len + (len & 1);
  }
  return null;
}
async function sfxSamples(u8) {
  const w = sfxWavRead(u8);
  if (w && w.rate === SFX_RATE) return w.data;
  return sfxTo32k(w ? sfxBuffer(sfxCtx(), w.data, w.rate) : await sfxDecode(u8));
}
async function sfxSha1(u8) {
  if (window.crypto && crypto.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-1", u8));
    return [...d].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  // plain http (not the live site): a small SHA-1
  const l = u8.length, n = ((l + 8 >> 6) + 1) * 16, w = new Int32Array(n);
  for (let i = 0; i < l; i++) w[i >> 2] |= u8[i] << (24 - (i & 3) * 8);
  w[l >> 2] |= 0x80 << (24 - (l & 3) * 8); w[n - 1] = l * 8;
  let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const x = new Int32Array(80), r = (v, s) => (v << s) | (v >>> (32 - s));
  for (let i = 0; i < n; i += 16) {
    let [A, B, C, D, E] = [a, b, c, d, e];
    for (let j = 0; j < 80; j++) {
      x[j] = j < 16 ? w[i + j] : r(x[j - 3] ^ x[j - 8] ^ x[j - 14] ^ x[j - 16], 1);
      const f = j < 20 ? (B & C) | (~B & D) : j < 40 ? B ^ C ^ D : j < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
      const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (r(A, 5) + f + E + k + x[j]) | 0; E = D; D = C; C = r(B, 30); B = A; A = t;
    }
    a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0; e = (e + E) | 0;
  }
  return [a, b, c, d, e].map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

// ---- DSP
// WSOLA time-stretch: output is r times as long, same pitch. 30 ms Hann
// frames at 50% overlap, each placed where it best continues the last one.
function sfxWsola(x, sr, r) {
  const N = Math.round(sr * 0.03) & ~1, Hs = N / 2, Ha = Hs / r, tol = Math.round(sr * 0.008);
  const outLen = Math.max(1, Math.round(x.length * r));
  const y = new Float32Array(outLen + N + Hs), wsum = new Float32Array(outLen + N + Hs), win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const xs = new Float32Array(x.length + N * 2); xs.set(x, N); // padded: frames can overhang
  let prev = -1;
  // frame k lands at output k*Hs - Hs (so sample 0 is past the first fade-in)
  // and reads input from (k-1)*Ha; xs is x with N zeros either side.
  for (let k = 0; k * Hs < outLen + Hs; k++) {
    const nominal = Math.round(N + (k - 1) * Ha);
    let best = Math.min(Math.max(nominal, 0), xs.length - N);
    if (prev >= 0) {
      const ref = prev + Hs; let bc = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const c = nominal + d; if (c < 0 || c + N > xs.length || ref + N > xs.length) continue;
        let s = 0; for (let i = 0; i < N; i += 4) s += xs[ref + i] * xs[c + i];
        if (s > bc) { bc = s; best = c; }
      }
    }
    const o = k * Hs;
    for (let i = 0; i < N; i++) { y[o + i] += xs[best + i] * win[i]; wsum[o + i] += win[i]; }
    prev = best;
  }
  const sh = Hs, out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const w = wsum[i + sh]; out[i] = w > 1e-3 ? y[i + sh] / w : 0; }
  return out;
}
const sfxPeak = a => { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; };
// Length of the result in seconds, without rendering it.
const sfxDur = (raw, r) => { const [a, b] = sfxTrimIdx(raw, r); return (b - a) / SFX_RATE * (r.mode === "tape" ? 1 / r.speed : r.stretch); };
const sfxTrimIdx = (raw, r) => {
  const a = Math.min(raw.length - 1, Math.max(0, Math.floor((r.trim[0] || 0) * SFX_RATE)));
  const b = r.trim[1] > 0 ? Math.min(raw.length, Math.floor(r.trim[1] * SFX_RATE)) : raw.length;
  return [a, Math.max(a + 1, b)];
};
// What to play: the (stretched) samples, the playback rate, the level.
const SFXplan = { key: "", seg: null };
function sfxPlan(raw, r) {
  const [a, b] = sfxTrimIdx(raw, r), cut = raw.subarray(a, b);
  const pitch = r.mode === "tape" ? r.speed : 2 ** (r.semitones / 12);
  const st = r.mode === "tape" ? 1 : r.stretch * pitch;
  if ((b - a) * st > 30 * SFX_RATE) throw new Error("That would stretch past 30 s: trim it or make it shorter");
  const key = [a, b, st.toFixed(4), raw.length].join();
  if (SFXplan.raw !== raw || SFXplan.key !== key) Object.assign(SFXplan, { raw, key, seg: Math.abs(st - 1) < 0.002 ? cut : sfxWsola(cut, SFX_RATE, st) });
  const pk = sfxPeak(cut) || 1;
  const level = (r.normalise ? 0.89 / pk : 1) * 10 ** (r.gain / 20);
  return { seg: SFXplan.seg, rate: pitch, level, dur: SFXplan.seg.length / SFX_RATE / pitch, from: a / SFX_RATE, to: b / SFX_RATE };
}
// The same graph for preview (live) and save (offline).
function sfxGraph(ctx, p, r, t0) {
  const src = ctx.createBufferSource(); src.buffer = sfxBuffer(ctx, p.seg); src.playbackRate.value = p.rate;
  const g = ctx.createGain(), fi = Math.min(r.fadeIn, p.dur / 2), fo = Math.min(r.fadeOut, p.dur / 2);
  g.gain.setValueAtTime(fi > 0 ? 0 : p.level, t0);
  if (fi > 0) g.gain.linearRampToValueAtTime(p.level, t0 + fi);
  if (fo > 0) { g.gain.setValueAtTime(p.level, t0 + p.dur - fo); g.gain.linearRampToValueAtTime(0, t0 + p.dur); }
  src.connect(g);
  return { src, out: g };
}
async function sfxRender(raw, r) {
  const p = sfxPlan(raw, r), oc = sfxOffline(p.dur * SFX_RATE);
  const g = sfxGraph(oc, p, r, 0); g.out.connect(oc.destination); g.src.start(0);
  return (await sfxRun(oc)).getChannelData(0).slice();
}
// Where the sound starts and ends (2% of the peak, with a little air).
function sfxAutoTrim(raw) {
  const th = sfxPeak(raw) * 0.04, pad = Math.round(SFX_RATE * 0.02);
  let a = 0, b = raw.length - 1;
  while (a < b && Math.abs(raw[a]) < th) a++;
  while (b > a && Math.abs(raw[b]) < th) b--;
  return [Math.max(0, a - pad) / SFX_RATE, Math.min(raw.length, b + pad * 3) / SFX_RATE];
}

// ---- playing stored sounds
const SFXbufs = new Map(); let SFXnow = null;
function sfxStop() { if (SFXnow) { try { SFXnow.stop(); } catch { /* done */ } SFXnow = null; } }
async function sfxPlayId(id) {
  const ctx = sfxCtx(); // in the tap, for iOS
  const row = (S.c.sfx || []).find(x => x.id === id); if (!row) return;
  let buf = SFXbufs.get(row.Hash);
  if (!buf) { const d = await api("sfxGet", id); if (!d || !d.Data) return; buf = sfxBuffer(ctx, await sfxSamples(d.Data)); SFXbufs.set(row.Hash, buf); }
  sfxStop();
  const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(); SFXnow = s;
}
const sfxLen = row => row.Size > 44 ? ((row.Size - 44) / 2 / SFX_RATE).toFixed(2) + " s" : "empty";
const sfxUses = id => (S.c.soundSlots || []).filter(r => r.Sfx === id);
const sfxOwner = r => r.Kind === "npc" ? (S.npcBy[r.RefID] || {}).Name || "NPC " + r.RefID : (S.enemyBy[r.RefID] || {}).Name || "mob " + r.RefID;
const sfxRecipe = row => { try { return { ...SFX_RECIPE, ...JSON.parse(row.Recipe || "{}") }; } catch { return { ...SFX_RECIPE }; } };

// ---- waveform (drawn on a canvas; trim handles drag with mouse or finger)
function sfxWave(o) {
  const cv = h("canvas", { class: "sfx-wave" + (o.small ? " small" : "") });
  const W = { data: null, trim: null, head: null, live: null };
  const px = () => cv.clientWidth || 300;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1, w = Math.round(px() * dpr), hh = Math.round((o.small ? 56 : 120) * dpr);
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    const g = cv.getContext("2d"); g.fillStyle = "#0f1216"; g.fillRect(0, 0, w, hh);
    const mid = hh / 2; g.fillStyle = "#2a2f38"; g.fillRect(0, mid, w, Math.max(1, dpr));
    if (W.live) { // recording: peaks so far, scrolling into a 15 s frame
      g.fillStyle = "#e05050"; const n = W.live.length, per = w / Math.max(n, SFX_MAX_REC * 20);
      for (let i = 0; i < n; i++) { const a = Math.min(1, W.live[i] * 1.2) * mid; g.fillRect(i * per, mid - a, Math.max(1, per - dpr * 0.5), a * 2 || 1); }
      return;
    }
    const d = W.data; if (!d || !d.length) { g.fillStyle = "#667"; g.font = `${12 * dpr}px system-ui,sans-serif`; g.textBaseline = "middle"; g.fillText(o.empty || "No sound yet", 10 * dpr, mid / 2); return; }
    const dur = d.length / SFX_RATE;
    // seconds ruler
    g.fillStyle = "#556"; g.font = `${10 * dpr}px system-ui,sans-serif`;
    const step = dur > 8 ? 2 : dur > 3 ? 1 : dur > 1 ? 0.5 : 0.1;
    for (let t = step; t < dur; t += step) { const x = t / dur * w; g.fillRect(x, hh - 6 * dpr, dpr, 6 * dpr); if (!o.small) g.fillText(+t.toFixed(1) + "s", x + 3 * dpr, hh - 3 * dpr); }
    g.fillStyle = o.small ? "#9bd" : "#7af";
    const spp = d.length / w;
    for (let x = 0; x < w; x++) {
      let lo = 0, hi = 0; const a = Math.floor(x * spp), b = Math.min(d.length, Math.max(a + 1, Math.floor((x + 1) * spp)));
      for (let i = a; i < b; i++) { const v = d[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      g.fillRect(x, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95));
    }
    if (W.trim) {
      const [ta, tb] = W.trim, xa = ta / dur * w, xb = (tb || dur) / dur * w;
      g.fillStyle = "rgba(10,12,16,.72)"; g.fillRect(0, 0, xa, hh); g.fillRect(xb, 0, w - xb, hh);
      g.fillStyle = "#e0b030";
      for (const [x, side] of [[xa, 1], [xb, -1]]) { g.fillRect(x - dpr, 0, 2 * dpr, hh); g.fillRect(side > 0 ? x : x - 9 * dpr, 0, 9 * dpr, 18 * dpr); g.fillRect(side > 0 ? x : x - 9 * dpr, hh - 18 * dpr, 9 * dpr, 18 * dpr); }
    }
    if (W.head != null) { g.fillStyle = "#fff"; g.fillRect(W.head * w, 0, Math.max(1, dpr), hh); }
  };
  if (o.onTrim) {
    let drag = -1;
    const at = e => { const r = cv.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    cv.addEventListener("pointerdown", e => {
      if (!W.data || !W.trim) return;
      const dur = W.data.length / SFX_RATE, f = at(e), xa = W.trim[0] / dur, xb = (W.trim[1] || dur) / dur, near = 48 / px();
      const da = Math.abs(f - xa), db = Math.abs(f - xb);
      if (Math.min(da, db) > near && !(f > xa && f < xb)) return;
      drag = da < db ? 0 : 1; cv.setPointerCapture(e.pointerId); e.preventDefault();
    });
    cv.addEventListener("pointermove", e => {
      if (drag < 0) return;
      const dur = W.data.length / SFX_RATE, t = at(e) * dur, gap = 0.03;
      if (drag === 0) W.trim[0] = Math.min(t, (W.trim[1] || dur) - gap); else W.trim[1] = Math.max(t, W.trim[0] + gap);
      W.trim = [Math.max(0, W.trim[0]), Math.min(dur, W.trim[1] || dur)];
      draw(); o.onTrim(W.trim, false);
    });
    const up = () => { if (drag >= 0) { drag = -1; o.onTrim(W.trim, true); } };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  }
  if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(cv);
  return { el: cv, draw, set(d, trim) { W.live = null; W.data = d; W.trim = trim ? [...trim] : null; draw(); }, head(f) { W.head = f; draw(); }, live(p) { W.live = p; draw(); } };
}

// A slider row: label, range, the value as words.
function sfxRow(label, o) {
  const r = h("input", { type: "range", min: o.min, max: o.max, step: o.step, value: o.to(o.value) });
  const out = h("span", { class: "sfx-val" });
  const show = () => (out.textContent = o.text(o.from(+r.value)));
  r.addEventListener("input", () => { show(); o.input && o.input(o.from(+r.value)); });
  r.addEventListener("change", () => o.change(o.from(+r.value)));
  const reset = h("button", { type: "button", class: "sfx-reset", title: "Back to " + o.text(o.home), onclick: () => { r.value = o.to(o.home); show(); o.change(o.home); } }, "reset");
  show();
  const row = h("div", { class: "sfx-row" }, h("label", {}, label), r, out, reset);
  row.set = v => { r.value = o.to(v); show(); };
  return row;
}

// ---- the workshop. o: { id (0 = new), name, onSaved(id) }
function sfxWorkshop(box, o = {}) {
  box.textContent = "";
  const row0 = o.id ? (S.c.sfx || []).find(x => x.id === o.id) : null;
  const W = { id: row0 ? row0.id : 0, raw: null, rawNew: false, recipe: row0 ? sfxRecipe(row0) : { ...SFX_RECIPE }, out: null, rec: null, playing: null };
  const name = h("input", { type: "text", value: row0 ? row0.Name : o.name || "", placeholder: "Name, e.g. Wolf growl" });
  const info = h("span", { class: "hint" });
  const recBtn = h("button", { type: "button", class: "sfx-rec" }, h("i"), h("span", {}, "Record"));
  const meter = h("div", { class: "sfx-meter" }, h("i"));
  const file = h("input", { type: "file", accept: "audio/*,.wav,.ogg,.mp3,.m4a", hidden: true });
  const upBtn = h("button", { type: "button", onclick: () => file.click() }, "Upload a file…");
  const wave = sfxWave({ empty: "Record or upload a sound", onTrim: (t, done) => { W.recipe.trim = t; trimInfo(); if (done) changed(); } });
  const after = sfxWave({ small: true, empty: "" });
  const trimText = h("span", { class: "hint" });
  const auto = h("label", { class: "sfx-chk" }, h("input", { type: "checkbox", checked: localStorage.getItem("sfx-autoplay") !== "0", onchange: e => localStorage.setItem("sfx-autoplay", e.target.checked ? "1" : "0") }), " play on change");
  const R = W.recipe;
  const lg = { to: v => Math.log2(v), from: v => +(2 ** v).toFixed(3) };
  const outLen = () => W.raw ? sfxDur(W.raw, R).toFixed(2) + " s" : "";
  const rows = {
    semitones: sfxRow("Pitch", { min: -24, max: 24, step: 0.5, value: R.semitones, home: 0, to: v => v, from: v => v, text: v => (v > 0 ? "+" : "") + v + " semitones", change: v => { R.semitones = v; changed(); } }),
    stretch: sfxRow("Length", { min: -2, max: 2, step: 0.005, value: R.stretch, home: 1, ...lg, text: v => `${v.toFixed(2)}x` + (W.raw ? ` (${sfxDur(W.raw, { ...R, stretch: v }).toFixed(2)} s)` : ""), change: v => { R.stretch = v; changed(); } }),
    speed: sfxRow("Speed", { min: -2, max: 2, step: 0.005, value: R.speed, home: 1, ...lg, text: v => `${v.toFixed(2)}x = ${(12 * Math.log2(v) > 0 ? "+" : "") + (12 * Math.log2(v)).toFixed(1)} semitones, ${(1 / v).toFixed(2)}x length`, change: v => { R.speed = v; changed(); } }),
    gain: sfxRow("Volume", { min: -24, max: 12, step: 1, value: R.gain, home: 0, to: v => v, from: v => v, text: v => (v > 0 ? "+" : "") + v + " dB", change: v => { R.gain = v; changed(); } }),
    fadeIn: sfxRow("Fade in", { min: 0, max: 500, step: 5, value: R.fadeIn, home: 0.005, to: v => Math.round(v * 1000), from: v => v / 1000, text: v => Math.round(v * 1000) + " ms", change: v => { R.fadeIn = v; changed(); } }),
    fadeOut: sfxRow("Fade out", { min: 0, max: 1000, step: 10, value: R.fadeOut, home: 0.03, to: v => Math.round(v * 1000), from: v => v / 1000, text: v => Math.round(v * 1000) + " ms", change: v => { R.fadeOut = v; changed(); } }),
  };
  const norm = h("label", { class: "sfx-chk" }, h("input", { type: "checkbox", checked: R.normalise, onchange: e => { R.normalise = e.target.checked; changed(); } }), " normalise (loudest point at -1 dB)");
  const modeBtns = h("div", { class: "sfx-seg" },
    h("button", { type: "button", "data-mode": "separate", onclick: () => setMode("separate") }, "Pitch and length"),
    h("button", { type: "button", "data-mode": "tape", onclick: () => setMode("tape") }, "Tape speed (linked)"));
  const modeHint = h("p", { class: "hint" });
  const setMode = m => { R.mode = m; showMode(); changed(); };
  const showMode = () => {
    modeBtns.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.mode === R.mode));
    rows.semitones.hidden = rows.stretch.hidden = R.mode === "tape"; rows.speed.hidden = R.mode !== "tape";
    modeHint.textContent = R.mode === "tape" ? "Faster is higher and shorter, slower is lower and longer, like a tape. Warmer, no artefacts." : "Pitch and length move on their own (how most of the game's sounds were made: a spider is high but still long).";
  };
  const playBtn = h("button", { type: "button", class: "primary sfx-play", onclick: () => preview() }, "▶ Play");
  const origBtn = h("button", { type: "button", onclick: () => preview(true) }, "Play original");
  // presets
  const presetSel = h("select", { class: "sfx-presets" });
  const drawPresets = () => {
    const mine = (S.c.sfxPresets || []).map(p => ({ id: p.id, Name: p.Name, recipe: { ...SFX_RECIPE, ...JSON.parse(p.Recipe || "{}") } }));
    presetSel.replaceChildren(h("option", { value: "" }, "Presets…"), h("optgroup", { label: "Starters" }, SFX_BUILTIN.map((p, i) => h("option", { value: "b" + i }, p.Name))),
      mine.length ? h("optgroup", { label: "Yours" }, mine.map(p => h("option", { value: "p" + p.id }, p.Name))) : null);
    presetSel.mine = mine;
  };
  const presetOf = v => v[0] === "b" ? SFX_BUILTIN[+v.slice(1)] : (presetSel.mine || []).find(p => "p" + p.id === v);
  presetSel.onchange = () => {
    const p = presetOf(presetSel.value); if (!p) return;
    for (const k of SFX_SHAPE) R[k] = p.recipe[k];
    for (const k of Object.keys(rows)) rows[k].set(R[k]);
    norm.querySelector("input").checked = R.normalise; showMode(); changed(); delPreset.hidden = presetSel.value[0] !== "p";
  };
  const savePreset = h("button", { type: "button", onclick: async () => {
    const n = prompt("Name these settings (pitch, length, volume and fades; not the trim):", ""); if (!n) return;
    const shape = Object.fromEntries(SFX_SHAPE.map(k => [k, R[k]]));
    try { const r = await api("presetSave", { Name: n, Recipe: shape }); await loadAll(); drawPresets(); presetSel.value = "p" + r.id; delPreset.hidden = false; status(`Saved preset ${n}`); } catch (e) { status(e.message, true); }
  } }, "Save as preset");
  const delPreset = h("button", { type: "button", class: "danger", hidden: true, onclick: async () => {
    const p = presetOf(presetSel.value); if (!p || !p.id || !confirm(`Delete preset ${p.Name}?`)) return;
    await api("presetDelete", p.id); await loadAll(); drawPresets(); delPreset.hidden = true;
  } }, "Delete preset");
  drawPresets();

  const trimInfo = () => {
    if (!W.raw) { trimText.textContent = ""; return; }
    const [a, b] = sfxTrimIdx(W.raw, R);
    trimText.textContent = `Keeping ${(a / SFX_RATE).toFixed(2)}-${(b / SFX_RATE).toFixed(2)} s of ${(W.raw.length / SFX_RATE).toFixed(2)} s: drag the yellow handles`;
  };
  let tmr = 0;
  const changed = () => {
    if (!W.raw) return;
    rows.stretch.set(R.stretch); // its words include the length
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      try { W.out = await sfxRender(W.raw, R); } catch (e) { status(e.message, true); return; }
      after.set(W.out);
      info.textContent = `Result ${outLen()} at 32 kHz, ${Math.round(W.out.length * 2 / 1024)} KB`;
      saveBtn.disabled = saveNewBtn.disabled = dlBtn.disabled = false;
    }, 60);
    if (auto.querySelector("input").checked) preview();
  };
  const setRaw = (raw, fresh) => {
    W.raw = raw; W.rawNew = fresh; SFXplan.raw = null;
    if (fresh) R.trim = sfxAutoTrim(raw);
    wave.set(raw, R.trim); trimInfo(); changed();
  };
  // preview: the save's graph, live; a white line follows it on both waves
  function preview(original) {
    if (!W.raw) return;
    const ctx = sfxCtx(); sfxStop();
    const r = original ? { ...SFX_RECIPE, trim: R.trim, normalise: false } : R;
    let p; try { p = sfxPlan(W.raw, r); } catch (e) { status(e.message, true); return; }
    const t0 = ctx.currentTime + 0.03, g = sfxGraph(ctx, p, r, t0);
    g.out.connect(ctx.destination); g.src.start(t0); SFXnow = g.src;
    const total = W.raw.length / SFX_RATE, tick = () => {
      if (SFXnow !== g.src) { wave.head(null); after.head(null); return; }
      const f = (ctx.currentTime - t0) / p.dur;
      if (f > 1) { wave.head(null); after.head(null); return; }
      wave.head(Math.max(0, p.from + f * (p.to - p.from)) / total); after.head(original ? null : Math.max(0, f));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // recording: PCM straight from the mic (a ScriptProcessor), which iOS
  // Safari and Android Chrome both do; then down to 32 kHz mono.
  recBtn.onclick = async () => {
    if (W.rec) { W.rec.stop(); return; }
    let ctx;
    try { ctx = sfxCtx(); } catch (e) { status(e.message, true); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status("The mic needs the editor on https (tomlock.me/bq-editor is) in a browser that allows it", true); return; }
    let stream;
    recBtn.disabled = true;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) { recBtn.disabled = false; status(e.name === "NotAllowedError" ? "The mic is blocked: allow it for this site (on iPhone: Settings > Safari > Microphone, or the aA menu > Website Settings)" : "No mic: " + e.message, true); return; }
    recBtn.disabled = false;
    if (ctx.state === "suspended") await ctx.resume();
    sfxStop();
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain();
    mute.gain.value = 0;
    const chunks = [], peaks = [], rate = ctx.sampleRate, max = SFX_MAX_REC * rate, per = Math.round(rate / 20);
    let n = 0, acc = 0, cnt = 0, lvl = 0, t0 = Date.now();
    proc.onaudioprocess = e => {
      if (!W.rec) return;
      const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); n += d.length;
      let p = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > p) p = v; if (v > acc) acc = v; if (++cnt >= per) { peaks.push(acc); acc = 0; cnt = 0; } }
      lvl = Math.max(p, lvl * 0.8);
      if (n >= max) W.rec.stop();
    };
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    let raf = 0;
    const ui = () => {
      meter.firstChild.style.width = Math.min(100, Math.round(Math.sqrt(lvl) * 100)) + "%";
      recBtn.lastChild.textContent = `Stop  ${((Date.now() - t0) / 1000).toFixed(1)} s`;
      wave.live(peaks); raf = requestAnimationFrame(ui);
    };
    W.rec = {
      async stop() {
        if (!W.rec) return; W.rec = null;
        cancelAnimationFrame(raf);
        proc.onaudioprocess = null; try { src.disconnect(); proc.disconnect(); mute.disconnect(); } catch { /* gone */ }
        stream.getTracks().forEach(t => t.stop());
        box.classList.remove("recording"); recBtn.lastChild.textContent = "Record again"; meter.firstChild.style.width = "0";
        const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
        if (n < rate * 0.05) { status("That was too short: hold Record, speak, then tap Stop", true); wave.set(W.raw, W.raw ? R.trim : null); return; }
        setRaw(await sfxTo32k(sfxBuffer(ctx, all, rate)), true);
        status(`Recorded ${(n / rate).toFixed(1)} s`);
      },
    };
    box.classList.add("recording"); ui();
  };
  file.onchange = async () => {
    const f = file.files[0]; file.value = ""; if (!f) return;
    try {
      sfxCtx();
      let raw = await sfxSamples(new Uint8Array(await f.arrayBuffer()));
      if (raw.length > SFX_MAX_REC * SFX_RATE) { raw = raw.slice(0, SFX_MAX_REC * SFX_RATE); status(`Kept the first ${SFX_MAX_REC} s of ${f.name}`); }
      if (!name.value) name.value = f.name.replace(/\.[^.]+$/, "");
      setRaw(raw, true);
    } catch (e) { status(`Couldn't read ${f.name}: ${e.message || "not audio this browser can open"}`, true); }
  };

  const save = async asNew => {
    if (!W.raw) return;
    saveBtn.disabled = saveNewBtn.disabled = true;
    try {
      const out = await sfxRender(W.raw, R), data = sfxWav(out, SFX_RATE), hash = await sfxSha1(data);
      const nm = name.value.trim() || "sound";
      const id = asNew ? 0 : W.id;
      const r = await api("sfxSave", { id, Name: nm, Hash: hash, Data: data, Raw: W.rawNew || !id ? sfxWav(W.raw, SFX_RATE) : null, Recipe: R });
      W.id = r.id; W.rawNew = false;
      await loadAll();
      status(`Saved sound ${r.id} ${nm} (${(out.length / SFX_RATE).toFixed(2)} s). Save .db or commit to keep it.`);
      if (o.onSaved) o.onSaved(r.id);
    } catch (e) { status(e.message, true); }
    finally { saveBtn.disabled = saveNewBtn.disabled = false; }
  };
  const saveBtn = h("button", { type: "button", class: "primary", disabled: true, onclick: () => save(false) }, o.saveLabel || (W.id ? "Save sound" : "Save new sound"));
  const saveNewBtn = h("button", { type: "button", disabled: true, hidden: !W.id, onclick: () => save(true) }, "Save as a new sound");
  const dlBtn = h("button", { type: "button", disabled: true, onclick: async () => {
    const out = W.out || await sfxRender(W.raw, R), a = h("a", { href: URL.createObjectURL(new Blob([sfxWav(out, SFX_RATE)], { type: "audio/wav" })), download: (name.value.trim() || "sound").replace(/[^\w -]+/g, "") + ".wav" });
    document.body.append(a); a.click(); a.remove();
  } }, "Download .wav");

  box.append(
    h("div", { class: "sfx-name" }, h("label", {}, "Name"), name, W.id ? h("span", { class: "hint" }, ` sound ${W.id}`) : null),
    h("div", { class: "panel sfx-src" }, h("h3", {}, "1. Record"),
      h("div", { class: "sfx-recbar" }, recBtn, meter, upBtn, file),
      h("p", { class: "hint" }, `Tap Record, make the noise, tap Stop (up to ${SFX_MAX_REC} s). The first time the browser asks for the mic. Or upload a WAV, OGG, MP3 or M4A.`)),
    h("div", { class: "panel" }, h("h3", {}, "2. Trim"), wave.el,
      h("div", { class: "bar sfx-tight" }, trimText, h("button", { type: "button", onclick: () => { if (W.raw) { R.trim = sfxAutoTrim(W.raw); wave.set(W.raw, R.trim); trimInfo(); changed(); } } }, "Trim silence"),
        h("button", { type: "button", onclick: () => { if (W.raw) { R.trim = [0, W.raw.length / SFX_RATE]; wave.set(W.raw, R.trim); trimInfo(); changed(); } } }, "Keep it all"))),
    h("div", { class: "panel" }, h("h3", {}, "3. Shape"), modeBtns, modeHint,
      rows.semitones, rows.stretch, rows.speed, rows.gain, norm, rows.fadeIn, rows.fadeOut,
      h("div", { class: "bar sfx-tight" }, presetSel, savePreset, delPreset)),
    h("div", { class: "panel" }, h("h3", {}, "4. Listen and save"), after.el,
      h("div", { class: "bar sfx-tight" }, playBtn, origBtn, auto, info),
      h("div", { class: "bar" }, saveBtn, saveNewBtn, dlBtn, o.extra || null),
      h("p", { class: "hint" }, "The game plays it a little higher or lower each time (about 4%) so repeats don't sound the same. The original recording is kept with these settings, so you can come back and change them.")));
  showMode();
  if (row0) {
    info.textContent = "Loading…";
    api("sfxGet", row0.id).then(async d => {
      if (!d) return;
      if (d.Raw) setRaw(await sfxSamples(d.Raw), false);
      else { R.trim = [0, 0]; setRaw(await sfxSamples(d.Data), false); for (const k of SFX_SHAPE) R[k] = SFX_RECIPE[k]; R.normalise = false; info.textContent = "No original kept for this one: editing the finished sound"; }
      wave.set(W.raw, R.trim);
    }).catch(e => status(e.message, true));
  }
  return W;
}

// ---- Sounds tab: the library and the workshop
function renderSounds(m) {
  const form = h("div", { class: "form sfx-form" });
  const label = s => `${s.Name} (${s.id})` + (sfxUses(s.id).length ? ` · ${sfxUses(s.id).length} slot(s)` : "");
  const pick = s => {
    S.sfxSel = s;
    m.replaceChildren(listPanel(() => S.c.sfx || [], label, () => S.sfxSel && S.sfxSel.id, it => go("#sounds/" + it.id), () => pick({ id: 0 })), form);
    soundForm(form, s);
  };
  const list = S.c.sfx || [];
  pick(S.sfxSel && S.sfxSel.id ? list.find(x => x.id === S.sfxSel.id) || { id: 0 } : S.sfxSel || list[0] || { id: 0 });
}
function soundForm(form, s) {
  form.textContent = "";
  if (s.id) syncHash("#sounds/" + s.id);
  const uses = s.id ? sfxUses(s.id) : [];
  form.append(h("h2", {}, s.id ? `${s.Name} (${s.id})` : "New sound"));
  if (s.id) form.append(h("div", { class: "bar sfx-tight" },
    h("button", { type: "button", onclick: () => sfxPlayId(s.id) }, "▶ Play saved"),
    h("span", { class: "hint" }, `${sfxLen(s)} · ` + (uses.length ? "used by " : "not used yet: give it to a mob (Mobs tab) or NPC")),
    uses.map(u => link(u.Kind === "npc" ? "#npc/" + u.RefID : "#mob/" + u.RefID, `${sfxOwner(u)} ${u.Slot}`, "btnlink")),
    h("button", { type: "button", class: "danger", onclick: async () => {
      if (!confirm(`Delete sound ${s.Name}?` + (uses.length ? ` It is in ${uses.length} slot(s); those go back to what played before.` : ""))) return;
      await api("sfxDelete", s.id); await loadAll(); S.sfxSel = null; renderTab();
    } }, "Delete")));
  const ws = h("div");
  form.append(ws);
  sfxWorkshop(ws, { id: s.id, onSaved: id => { S.sfxSel = { id }; renderTab(); } });
}

// ---- slots in the mob / NPC forms. look: "" (editor) or "qs" (Quest Studio)
function sfxSlotsPanel(kind, refId, look) {
  const qs = look === "qs", el = h("div", { class: (qs ? "qs-sfx" : "panel sfx-slots"), id: "sfx-slots" });
  const draw = () => {
    el.textContent = "";
    const help = SFX_SLOT_HELP[kind];
    if (!qs) el.append(h("h3", {}, "Sounds"), h("p", { class: "hint" }, "Make sounds in the Sounds tab or straight from here. Two or more in a slot: the game picks one at random each time."));
    for (const slot of Object.keys(help)) {
      const ids = (S.c.soundSlots || []).filter(r => r.Kind === kind && r.RefID === refId && r.Slot === slot).map(r => r.Sfx);
      const set = async list => { try { await api("slotSet", { Kind: kind, RefID: refId, Slot: slot, sfx: list }); await loadAll(); status(`${help[slot][0]} sound updated. Save .db or commit to keep it.`); draw(); } catch (e) { status(e.message, true); } };
      const chips = ids.map((id, i) => {
        const s = (S.c.sfx || []).find(x => x.id === id) || { id, Name: "missing " + id };
        return h("span", { class: "sfx-chip" },
          h("button", { type: "button", title: "Play", onclick: () => sfxPlayId(id) }, "▶ " + s.Name),
          h("button", { type: "button", title: "Edit this sound", onclick: () => sfxModal({ id, title: `Edit ${s.Name}`, onSaved: () => draw() }) }, "edit"),
          h("button", { type: "button", class: "sfx-x", title: "Take it out of this slot", onclick: () => set(ids.filter((_, j) => j !== i)) }, qs ? "x" : "×"));
      });
      el.append(h("div", { class: "sfx-slot" },
        h("div", { class: "sfx-slothead" }, h("b", {}, help[slot][0]), h("span", { class: "hint" }, " plays " + help[slot][1])),
        h("div", { class: "sfx-chips" }, chips,
          h("button", { type: "button", class: "sfx-add", onclick: () => sfxChooser(kind, refId, slot, ids, set) }, ids.length ? "+ variant" : "+ add"),
          ids.length ? null : h("span", { class: "hint" }, "empty: " + help[slot][2]))));
    }
  };
  draw();
  return el;
}
function sfxModal(o) {
  const close = () => { sfxStop(); ov.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const body = h("div", { class: "modal-body sfx-modal" });
  const ov = h("div", { class: "modal sfx-ov", onclick: e => { if (e.target === ov) close(); } },
    h("div", { class: "modal-box" }, h("div", { class: "modal-head" }, h("b", {}, o.title), h("button", { type: "button", onclick: close }, "Close")), body));
  document.body.append(ov); document.addEventListener("keydown", esc, true);
  if (o.fill) o.fill(body, close);
  else sfxWorkshop(body, { id: o.id, name: o.name, saveLabel: o.saveLabel, onSaved: id => { close(); o.onSaved && o.onSaved(id); } });
  return close;
}
// Pick from the library, or record a new one, for a slot.
function sfxChooser(kind, refId, slot, ids, set) {
  const who = kind === "npc" ? (S.npcBy[refId] || {}).Name : (S.enemyBy[refId] || {}).Name;
  const label = SFX_SLOT_HELP[kind][slot][0];
  const fresh = () => sfxModal({ title: `New ${label.toLowerCase()} sound for ${who}`, name: `${who} ${slot}`, saveLabel: `Save and use for ${label.toLowerCase()}`, onSaved: id => set([...ids, id]) });
  sfxModal({ title: `${label} sound for ${who}`, fill: (body, close) => {
    const q = h("input", { type: "search", placeholder: "Filter sounds…" });
    const list = h("div", { class: "sfx-lib" });
    const draw = () => {
      const f = q.value.toLowerCase();
      list.replaceChildren(...(S.c.sfx || []).filter(s => !f || s.Name.toLowerCase().includes(f)).map(s => h("div", { class: "sfx-librow" },
        h("button", { type: "button", onclick: () => sfxPlayId(s.id) }, "▶"),
        h("span", {}, h("b", {}, s.Name), h("small", { class: "hint" }, ` ${sfxLen(s)}` + (sfxUses(s.id).length ? ` · ${sfxUses(s.id).map(u => sfxOwner(u) + " " + u.Slot).join(", ")}` : ""))),
        h("button", { type: "button", class: "primary", disabled: ids.includes(s.id), onclick: () => { close(); set([...ids, s.id]); } }, ids.includes(s.id) ? "in" : "Use"))));
      if (!list.children.length) list.append(h("p", { class: "hint" }, (S.c.sfx || []).length ? "Nothing matches." : "No sounds yet: record the first one."));
    };
    q.oninput = draw; draw();
    body.append(h("div", { class: "bar" }, h("button", { type: "button", class: "primary sfx-new", onclick: () => { close(); fresh(); } }, "● Record a new one"), q), list);
  } });
}
