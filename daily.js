"use strict";
// Daily quests, as the API's dailyquests.go and dropreset.go run them
// (docs/DAILY_QUESTS.md). A quest_def row with Daily = 1 is a template: its
// {mob} {item} {count} {place} (and {mob2}, {count3} ...) are filled from one
// pick per (Kind, Slot) of its quest_daily_pool rows, rolled once per loot
// day. The roll here is the server's own: the same splitmix64 stream, seed,
// weights and order, so the preview shows what players will get.
// tests/daily-roll.mjs checks it against output of the API's rollDaily.
const BQDaily = (() => {
  const KINDS = ["mob", "item", "count", "place"];
  const M64 = (1n << 64n) - 1n;
  const RESET_HOUR = 21;
  const u64 = n => BigInt.asUintN(64, BigInt(n));
  // splitmix64 (dailyRNG): state is a BigInt in a one-element box.
  function next(r) {
    r.s = (r.s + 0x9E3779B97F4A7C15n) & M64;
    let z = r.s;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & M64;
    return z ^ (z >> 31n);
  }
  const intn = (r, n) => (n <= 1 ? 0 : Number(next(r) % BigInt(n)));
  function seed(day, qid, key) {
    let h = 1469598103934665603n; // FNV-1a over the key's bytes
    for (const b of new TextEncoder().encode(key)) { h ^= BigInt(b); h = (h * 1099511628211n) & M64; }
    const r = { s: ((u64(day) * 0x100000001B3n) & M64) ^ ((u64(qid) * 0x9E3779B97F4A7C15n) & M64) ^ h };
    next(r);
    return r;
  }
  const key = (kind, slot) => (slot <= 1 ? kind : kind + slot);
  const rollRange = (r, lo, hi) => { if (hi < lo) hi = lo; return lo + intn(r, hi - lo + 1); };
  const weight = row => (row.Weight < 1 ? 1 : row.Weight);
  // A pool row as loadDailyPools reads it: Kind lower case and trimmed,
  // numbers as ints. Rows of an unknown kind are dropped (the server logs them).
  function clean(row) {
    const n = (v, d = 0) => { v = Math.trunc(+v); return Number.isFinite(v) ? v : d; };
    return { id: n(row.id), QuestID: n(row.QuestID), Kind: String(row.Kind ?? "").trim().toLowerCase(), Slot: n(row.Slot, 1), RefID: n(row.RefID),
      Name: String(row.Name ?? ""), Label: String(row.Label ?? ""), Min: n(row.Min), Max: n(row.Max), X: n(row.X), Y: n(row.Y), Radius: +row.Radius || 0, Weight: n(row.Weight, 1) };
  }
  // Go's sort.Strings order (byte order; keys are ASCII).
  const byteSort = a => a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  // rollDaily: the variant of quest qid on loot day `day`. refName(kind, id)
  // names a RefID row (enemies.id or items.id).
  function roll(qid, pool, day, refName) {
    const groups = new Map();
    for (const raw of pool) {
      const row = clean(raw);
      if (!KINDS.includes(row.Kind)) continue;
      const k = key(row.Kind, row.Slot);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    }
    const out = { Day: day, Vals: {} }, extra = new Map();
    for (const k of byteSort([...groups.keys()])) {
      const rows = groups.get(k).sort((a, b) => a.id - b.id);
      const r = seed(day, qid, k);
      const total = rows.reduce((t, row) => t + weight(row), 0);
      let pick = rows[0], at = intn(r, total);
      for (const row of rows) { if (at < weight(row)) { pick = row; break; } at -= weight(row); }
      const v = { Text: "" };
      if (pick.Kind === "count") { v.Count = rollRange(r, pick.Min, pick.Max); v.Text = String(v.Count); }
      else if (pick.Kind === "place") {
        Object.assign(v, { X: pick.X, Y: pick.Y, Radius: pick.Radius });
        v.Text = pick.Label || pick.Name || `${pick.X}, ${pick.Y}`;
      } else {
        let name = pick.Name.trim();
        if (!name && pick.RefID) name = (refName && refName(pick.Kind, pick.RefID)) || "";
        v.Names = name.split("|").map(s => s.trim()).filter(Boolean);
        v.Text = pick.Label || v.Names.join(" or ");
        if (pick.Min > 0 || pick.Max > 0) { const ck = key("count", pick.Slot); if (!extra.has(ck)) extra.set(ck, rollRange(r, pick.Min, pick.Max)); }
      }
      v.row = pick.id;
      out.Vals[k] = v;
    }
    for (const [k, n] of extra) if (!(k in out.Vals)) out.Vals[k] = { Text: String(n), Count: n, fromRow: true };
    return out;
  }
  // fill: every {key} of the roll written into s; unknown ones stay.
  function fill(r, s) {
    s = String(s ?? "");
    if (!s.includes("{")) return s;
    for (const k of byteSort(Object.keys(r.Vals))) s = s.split("{" + k + "}").join(r.Vals[k].Text);
    return s;
  }
  // placeholder: "{mob}" -> "mob", else "".
  function placeholder(s) {
    s = String(s ?? "").trim();
    return s.length > 2 && s[0] === "{" && s[s.length - 1] === "}" ? s.slice(1, -1) : "";
  }
  // A step's Count as questStep.UnmarshalJSON reads it: { n, v } (number, or
  // the placeholder it takes).
  function stepCount(c) {
    if (c === undefined || c === null) return { n: 0, v: "" };
    if (typeof c === "number") return { n: Math.trunc(c), v: "" };
    const t = String(c).trim();
    if (/^[+-]?\d+$/.test(t)) return { n: parseInt(t, 10), v: "" };
    return { n: 0, v: placeholder(t) ? t : "" };
  }
  const list = v => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter(x => typeof x === "string");
  // resolve: the quest with the roll written in (questDef.resolve).
  function resolve(q, r) {
    const steps = (typeof q.Steps === "string" ? (() => { try { return JSON.parse(q.Steps) || []; } catch { return []; } })() : q.Steps || []);
    const out = { ...q };
    for (const k of ["Title", "Summary", "Offer", "Accept", "Progress", "Complete"]) out[k] = fill(r, q[k]);
    out.Steps = steps.map(s0 => {
      const s = { ...s0 }, names = [];
      const add = n => { const k = placeholder(n); if (k && r.Vals[k] && (r.Vals[k].Names || []).length) { names.push(...r.Vals[k].Names); return; } names.push(fill(r, n)); };
      add(s.Target ?? "");
      for (const n of list(s.Targets)) add(n);
      delete s.Target; delete s.Targets;
      if (names.length) { s.Target = names[0]; if (names.length > 1) s.Targets = names.slice(1); }
      const c = stepCount(s0.Count);
      s.Count = c.n;
      if (c.v) { const v = r.Vals[placeholder(c.v)]; if (v && v.Count > 0) s.Count = v.Count; }
      const at = placeholder(s.At);
      if (at && r.Vals[at]) { const v = r.Vals[at]; s.X = v.X || 0; s.Y = v.Y || 0; if (v.Radius > 0) s.Radius = v.Radius; }
      if (s.Count < 1) s.Count = 1;
      for (const k of ["Text", "Hint", "Line"]) if (k in s) s[k] = fill(r, s[k]);
      return s;
    });
    return out;
  }

  // ---- the clock (dropreset.go), in the server's zone
  const parts = (ms, tz) => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
  };
  // dropResetDay: 21 hours back, then the calendar date there, as days since 1970-01-01.
  function day(ms, tz) { const p = parts(ms - RESET_HOUR * 3600e3, tz); return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400e3); }
  // wall time in tz -> instant (Go's time.Date normalises the same way for
  // ordinary hours; the DST gap hour moves forward).
  function wall(y, m, d, h, tz) {
    let t = Date.UTC(y, m - 1, d, h);
    for (let i = 0; i < 3; i++) { const p = parts(t, tz); const off = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t; t = Date.UTC(y, m - 1, d, h) - off; }
    return t;
  }
  // The loot day's span: [start, end) instants. Day n started on the date n.
  function span(n, tz) {
    const s = new Date(n * 86400e3), e = new Date((n + 1) * 86400e3);
    return [wall(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate(), RESET_HOUR, tz), wall(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), RESET_HOUR, tz)];
  }

  // ---- what a daily uses and what its pool gives
  const TOKEN = /\{((?:mob|item|count|place)\d*)\}/g;
  function uses(q) {
    const steps = typeof q.Steps === "string" ? (() => { try { return JSON.parse(q.Steps) || []; } catch { return []; } })() : q.Steps || [];
    const out = new Set();
    const scan = s => { for (const m of String(s ?? "").matchAll(TOKEN)) out.add(m[1]); };
    for (const k of ["Title", "Summary", "Offer", "Accept", "Progress", "Complete"]) scan(q[k]);
    for (const s of steps) { for (const k of ["Text", "Hint", "Line", "Target", "At"]) scan(s[k]); list(s.Targets).forEach(scan); if (typeof s.Count === "string") scan(s.Count); }
    return out;
  }
  // Which keys a pool can fill: each (Kind, Slot), plus {countN} from a mob
  // or item row with a range.
  function gives(pool) {
    const out = new Set();
    for (const raw of pool) {
      const r = clean(raw); if (!KINDS.includes(r.Kind)) continue;
      out.add(key(r.Kind, r.Slot));
      if ((r.Kind === "mob" || r.Kind === "item") && (r.Min > 0 || r.Max > 0)) out.add(key("count", r.Slot));
    }
    return out;
  }
  // Problems with a daily (docs/DAILY_QUESTS.md "Validate in the UI").
  // names: { enemy: Set(lower), item: Set(lower), enemyId: Map, itemId: Map }.
  function check(q, pool, names) {
    const P = [], add = (sev, msg, key) => P.push({ sev, msg, key });
    const used = uses(q), have = gives(pool);
    for (const k of used) {
      if (have.has(k)) continue;
      const kind = k.replace(/\d+$/, "");
      if (/^(mob|item|count|place)1$/.test(k)) add("err", `{${k}} is never filled: slot 1 is written {${kind}}`, k);
      else if (kind === "count") add("err", `{${k}} needs a count range: add a count to this slot, or a min-max on its mob or item`, k);
      else add("err", `{${k}} has nothing to pick from: add a ${kind} to its list`, k);
    }
    for (const raw of pool) {
      const r = clean(raw);
      if (!KINDS.includes(r.Kind)) { add("warn", `pool row ${r.id}: kind "${raw.Kind}" is not mob, item, count or place, so the server ignores it`); continue; }
      const k = key(r.Kind, r.Slot);
      if (!used.has(k) && !(r.Kind === "count" && used.has(k))) add("info", `{${k}} is rolled but nothing in the text or objectives uses it`, k);
      if (r.Kind === "mob" || r.Kind === "item") {
        let nm = r.Name.trim();
        if (!nm && r.RefID) nm = (r.Kind === "mob" ? names.enemyId : names.itemId).get(r.RefID) || "";
        const set = r.Kind === "mob" ? names.enemy : names.item;
        const ns = nm.split("|").map(s => s.trim()).filter(Boolean);
        if (!ns.length) add("err", `{${k}}: a row with no ${r.Kind === "mob" ? "enemy" : "item"}`, k);
        ns.filter(n => !set.has(n.toLowerCase())).forEach(n => add("err", `{${k}}: no ${r.Kind === "mob" ? "enemy" : "item"} called ${n}`, k));
      }
      if (r.Kind === "count" && r.Max < r.Min) add("warn", `{${k}}: max ${r.Max} is below min ${r.Min}, so it is always ${r.Min}`, k);
      if (r.Kind === "count" && Math.max(r.Min, r.Max) < 1) add("warn", `{${k}}: a count of 0 (the objective then needs 1)`, k);
    }
    return [...new Map(P.map(p => [p.sev + p.msg, p])).values()];
  }
  return { KINDS, RESET_HOUR, key, seed, next, intn, clean, roll, fill, placeholder, stepCount, resolve, day, span, wall, uses, gives, check, TOKEN };
})();
if (typeof module !== "undefined") module.exports = BQDaily;
