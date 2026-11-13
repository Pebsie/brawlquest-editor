"use strict";
// Item editor Balance panel. Suggested level is a least-squares fit of
// required level (Worth) from Val and stat bonuses, using the items currently
// in the open database, per type (and falling back to the same slot family).
// Gear only: weapons and armour. Other types have no level curve like
// that, so the panel just compares them to others of the same type.
//
// For a type (or family) the fit is:
//   suggested level ≈ a + b × Val + c × (STR + INT + STA)
// b and c are dropped if they come out unusable (b must be > 0; c must not be
// negative). Power, for comparing peers, is Val + (c/b) × stat bonuses, i.e.
// Val plus how much Val one stat point is worth on this type.
const BQItemBal = (() => {
  const STATS = ["STR", "INT", "STA"];
  const MAX_LEVEL = 40;
  const TOOL = /Pickaxe|Fishing Rod|Trident/;
  const GEAR = new Set(["wep", "arm_head", "arm_chest", "arm_legs", "arm_leg"]);
  const FAMILY = {
    wep: ["wep"],
    arm_head: ["arm_head", "arm_chest", "arm_legs", "arm_leg"],
    arm_chest: ["arm_head", "arm_chest", "arm_legs", "arm_leg"],
    arm_legs: ["arm_head", "arm_chest", "arm_legs", "arm_leg"],
    arm_leg: ["arm_head", "arm_chest", "arm_legs", "arm_leg"]
  };
  const TYPE_WORDS = { wep: "weapons", arm_head: "head pieces", arm_chest: "chest pieces", arm_legs: "leg pieces", arm_leg: "leg pieces" };
  const famLabel = { wep: "weapons", arm_head: "armour", arm_chest: "armour", arm_legs: "armour", arm_leg: "armour" };

  const numVal = it => { const n = parseInt(it && it.Val, 10); return Number.isFinite(n) ? n : null; };
  const worth = it => Math.max(0, +((it && it.Worth) || 0));
  const isTool = it => TOOL.test((it && it.Name) || "");
  const isGear = it => GEAR.has((it && it.Type) || "");
  function attrs(it) {
    const out = { STR: 0, INT: 0, STA: 0 };
    const s = it && it.Attributes;
    if (!s || s === "None") return out;
    for (const p of String(s).split(";")) {
      const [k, v] = p.split(",");
      if (k && k in out) out[k] += parseInt(v, 10) || 0;
    }
    return out;
  }
  const attrSum = it => { const a = attrs(it); return a.STR + a.INT + a.STA; };

  function solve(A, b) {
    const n = A.length, M = A.map((row, i) => row.concat([b[i]]));
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      if (Math.abs(M[piv][i]) < 1e-12) return null;
      if (piv !== i) { const t = M[i]; M[i] = M[piv]; M[piv] = t; }
      const f = M[i][i];
      for (let c = i; c <= n; c++) M[i][c] /= f;
      for (let r = 0; r < n; r++) if (r !== i) {
        const k = M[r][i];
        for (let c = i; c <= n; c++) M[r][c] -= k * M[i][c];
      }
    }
    return M.map(row => row[n]);
  }

  function ols(rows, withAttr) {
    const p = withAttr ? 3 : 2, ridge = 1e-4;
    const XtX = Array.from({ length: p }, () => Array(p).fill(0));
    const Xty = Array(p).fill(0);
    for (const r of rows) {
      const x = withAttr ? [1, r.val, r.attr] : [1, r.val];
      for (let i = 0; i < p; i++) {
        Xty[i] += x[i] * r.worth;
        for (let j = 0; j < p; j++) XtX[i][j] += x[i] * x[j];
      }
    }
    for (let i = 1; i < p; i++) XtX[i][i] += ridge;
    const beta = solve(XtX, Xty);
    if (!beta || !(beta[1] > 0)) return null;
    if (withAttr && !(beta[2] >= -0.05)) return null;
    if (withAttr && beta[2] < 0) beta[2] = 0;
    if (withAttr && beta[2] > 8) return null;
    const pred = r => beta[0] + beta[1] * r.val + (withAttr ? beta[2] * r.attr : 0);
    const y = rows.map(r => r.worth), yh = rows.map(pred);
    const ym = y.reduce((a, b) => a + b, 0) / y.length;
    const ssRes = y.reduce((s, yi, i) => s + (yi - yh[i]) ** 2, 0);
    const ssTot = y.reduce((s, yi) => s + (yi - ym) ** 2, 0) || 1;
    const mae = y.reduce((s, yi, i) => s + Math.abs(yi - yh[i]), 0) / y.length;
    return { a: beta[0], bVal: beta[1], bAttr: withAttr ? beta[2] : 0, withAttr, n: rows.length, r2: 1 - ssRes / ssTot, mae };
  }

  function rowsOf(items, types, excludeId, skipTools) {
    const out = [];
    for (const it of items || []) {
      if (excludeId && +it.id === +excludeId) continue;
      if (!types.includes(it.Type)) continue;
      if (skipTools && isTool(it)) continue;
      const v = numVal(it);
      if (v == null) continue;
      out.push({ val: v, attr: attrSum(it), worth: worth(it), it });
    }
    return out;
  }

  function pickFit(items, type, excludeId) {
    if (!GEAR.has(type)) return null;
    const skipTools = type === "wep";
    const exact = rowsOf(items, [type], excludeId, skipTools);
    const famTypes = FAMILY[type] || [type];
    const fam = famTypes.length > 1 ? rowsOf(items, famTypes, excludeId, skipTools) : exact;
    const trySet = (rows, source) => {
      if (rows.length < 2) return null;
      const fit = set => {
        const hasAttr = set.filter(r => r.attr).length >= 1;
        return (hasAttr ? ols(set, true) : null) || ols(set, false);
      };
      let m = fit(rows);
      // One or two odd items (a high-level piece with low Val, say) can flatten
      // the Val-only line; drop the worst residual and try again.
      if (rows.length >= 4) {
        const use = m || fit(rows);
        if (use) {
          const pred = r => use.a + use.bVal * r.val + use.bAttr * r.attr;
          const trimmed = [...rows].sort((a, b) => Math.abs(b.worth - pred(b)) - Math.abs(a.worth - pred(a))).slice(1);
          const m2 = fit(trimmed);
          if (m2 && (!m || m2.r2 > m.r2 + 0.05)) m = m2;
        }
      }
      if (!m || m.bVal <= 0 || m.r2 < 0.05) return null;
      m.source = source;
      m.types = source === "type" ? [type] : famTypes;
      m.k = m.bVal ? m.bAttr / m.bVal : 0;
      return m;
    };
    return trySet(exact, "type") || trySet(fam, "family");
  }

  function powerOf(it, model) {
    const v = numVal(it);
    if (v == null) return null;
    return v + (model && model.k ? model.k * attrSum(it) : 0);
  }

  function suggest(it, model) {
    if (!model) return null;
    const v = numVal(it);
    if (v == null) return null;
    const raw = model.a + model.bVal * v + model.bAttr * attrSum(it);
    const n = Math.round(raw);
    return { raw, level: Math.max(1, Math.min(MAX_LEVEL, n)), clamped: n < 1 || n > MAX_LEVEL };
  }

  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor((s.length - 1) / 2); return s.length % 2 ? s[m] : (s[m] + s[m + 1]) / 2; };
  const minOf = a => a.length ? Math.min(...a) : null;
  const maxOf = a => a.length ? Math.max(...a) : null;

  function peersOf(it, items, level, window) {
    const type = it.Type, id = +it.id;
    const same = (items || []).filter(x => x.Type === type && +x.id !== id && numVal(x) != null);
    const sub = (it.Subtype || "").trim(), subOk = s => !sub || sub === "None" || sub === (s.Subtype || "").trim();
    const near = same.filter(x => Math.abs(worth(x) - level) <= window);
    const nearSub = near.filter(subOk);
    let list = nearSub.length >= 3 ? nearSub : (near.length ? near : same);
    const usedSub = list === nearSub && nearSub.length >= 3;
    return { list, allType: same, usedSub, window, near: near.length };
  }

  function percentile(value, values) {
    if (!values.length) return null;
    const n = values.filter(v => v <= value).length;
    return Math.round(100 * n / values.length);
  }

  function formulaWords(model, type) {
    if (!model) return "";
    const rnd = (n, d) => { const f = Math.pow(10, d); return (Math.round(n * f) / f).toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"); };
    const parts = [`${rnd(model.a, 1)}`, `${rnd(model.bVal, 2)} × Val`];
    if (model.withAttr && model.bAttr > 0.02) parts.push(`${rnd(model.bAttr, 2)} × stat bonuses (STR, INT and STA added together)`);
    const who = model.source === "type" ? (TYPE_WORDS[type] || type + " items") : ("the " + (famLabel[type] || "gear") + " pieces (not enough " + (TYPE_WORDS[type] || type) + " on their own)");
    return `Worked out from the other ${who} currently in the database: suggested level ≈ ${parts.join(" + ")}.`;
  }

  function analyse(it, items) {
    items = items || [];
    const type = (it && it.Type) || "";
    const setLevel = worth(it);
    const model = pickFit(items, type, it && it.id);
    const sug = suggest(it, model);
    const pow = powerOf(it, model);
    const flagAt = 5;
    const off = sug ? sug.level - setLevel : null;
    const far = sug ? Math.abs(off) >= flagAt : false;
    const around = sug ? sug.level : (setLevel || 1);
    // peers near the set level and the suggested one, so both sides of a mismatch show
    const win = 6;
    const a = peersOf(it, items, setLevel || around, win);
    const b = sug ? peersOf(it, items, sug.level, win) : a;
    const merged = [];
    const seen = new Set();
    for (const x of [...a.list, ...b.list]) { if (!seen.has(+x.id)) { seen.add(+x.id); merged.push(x); } }
    const peers = merged.length ? merged : a.allType;
    const peerPowers = peers.map(x => powerOf(x, model)).filter(v => v != null);
    const pct = pow != null && peerPowers.length ? percentile(pow, peerPowers) : null;

    const keys = ["Val", ...STATS];
    if (!isGear(it) && it && +it.Cooldown > 1) keys.push("Cooldown");
    const rows = keys.map(k => {
      const valOf = x => k === "Val" ? numVal(x) : k === "Cooldown" ? +(x.Cooldown || 0) : attrs(x)[k];
      const vs = peers.map(valOf).filter(v => v != null);
      const mine = valOf(it);
      if (mine == null && !vs.some(v => v)) return null;
      return { key: k, mine: mine || 0, min: minOf(vs), median: median(vs), max: maxOf(vs) };
    }).filter(Boolean);

    const myP = pow != null ? pow : (numVal(it) || 0);
    const nearest = [...peers].sort((x, y) => {
      const dx = Math.abs((powerOf(x, model) ?? numVal(x) ?? 0) - myP) + 0.4 * Math.abs(worth(x) - (setLevel || around));
      const dy = Math.abs((powerOf(y, model) ?? numVal(y) ?? 0) - myP) + 0.4 * Math.abs(worth(y) - (setLevel || around));
      return dx - dy;
    }).slice(0, 5);

    return { model, power: pow, suggested: sug, setLevel, off, far, flagAt, peers, percentile: pct, rows, nearest, formula: formulaWords(model, type), gear: isGear(it), tool: isTool(it) };
  }

  function flagWords(a) {
    if (!a.suggested) return "";
    const s = a.suggested.level, w = a.setLevel;
    if (Math.abs(s - w) <= 1) return "That's in line with the required level of " + w + ".";
    if (Math.abs(s - w) < a.flagAt) return "The required level is " + w + ", a little " + (w > s ? "higher" : "lower") + " than the stats suggest.";
    if (w > s) return "The required level is " + w + ", well above what these stats look like (around " + s + "). It is weaker than that level usually is.";
    return "The required level is " + w + ", well below what these stats look like (around " + s + "). It is stronger than other items at that level.";
  }

  function pctWords(pct, n, type) {
    if (pct == null || !n) return "";
    const who = TYPE_WORDS[type] || (type + " items");
    const where = pct >= 80 ? "on the strong side" : pct <= 20 ? "on the weak side" : "around the middle";
    return `Power sits at the ${pct}th percentile among ${n} other ${who} near this level — ${where}.`;
  }

  function fmt(n) {
    if (n == null || Number.isNaN(n)) return "—";
    if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
    return (Math.round(n * 10) / 10).toString();
  }

  // ---- UI (browser only) -------------------------------------------------
  function panel(it, items) {
    const a = analyse(it, items);
    const kids = [h("h3", {}, "Balance")];
    if (a.tool) kids.push(h("p", { class: "hint" }, "Tools like pickaxes, rods and the trident don't follow the same Val curve as weapons, so there is no suggested level from these stats."));
    if (a.suggested && !a.tool) {
      kids.push(h("p", { class: "ib-lead" },
        h("span", { class: "ib-sug", "data-ib": "suggested" }, "Suggested level: ~" + a.suggested.level),
        " ", h("span", { class: "ib-flag" + (a.far ? " off" : (Math.abs(a.off) <= 1 ? " ok" : " bit")), "data-ib": "flag" }, flagWords(a))));
      if (a.power != null) kids.push(h("p", { class: "hint ib-pow", "data-ib": "power" }, "Power " + fmt(a.power) + " (Val with stat bonuses counted in). ", pctWords(a.percentile, a.peers.length, it.Type)));
    } else if (!a.gear) {
      kids.push(h("p", { class: "hint", "data-ib": "nolevel" }, "This type isn't worn, so there isn't a required-level curve like there is for gear. Here's how it compares to other " + (it.Type || "items") + " of the same type."));
    } else if (!a.tool) {
      kids.push(h("p", { class: "hint", "data-ib": "nolevel" }, "Not enough other " + (TYPE_WORDS[it.Type] || it.Type) + " in the database yet to suggest a level."));
    }
    if (a.rows.length && a.peers.length) {
      const head = h("tr", {}, h("th", {}, ""), h("th", {}, "This"), h("th", {}, "Min"), h("th", {}, "Median"), h("th", {}, "Max"));
      const body = a.rows.map(r => h("tr", { "data-stat": r.key }, h("th", {}, r.key), h("td", {}, fmt(r.mine)), h("td", {}, fmt(r.min)), h("td", {}, fmt(r.median)), h("td", {}, fmt(r.max))));
      kids.push(h("table", { class: "ib-stats", "data-ib": "stats" }, h("thead", {}, head), h("tbody", {}, body)));
    }
    if (a.nearest.length) {
      kids.push(h("h4", {}, "Closest " + (TYPE_WORDS[it.Type] || "items")));
      kids.push(h("div", { class: "ib-peers", "data-ib": "peers" }, a.nearest.map(p => {
        const img = sprite(p.ImgPath); img.style.width = img.style.height = "32px";
        return h("button", { type: "button", class: "ib-peer", "data-id": p.id, onclick: () => go("#item/" + p.id) },
          img, h("span", { class: "ib-plab" }, h("b", {}, p.Name), h("small", {}, "L" + worth(p) + " · Val " + (numVal(p) ?? p.Val) + (attrSum(p) ? " · +" + attrSum(p) + " stats" : ""))));
      })));
    }
    if (a.formula) kids.push(h("p", { class: "hint ib-formula", "data-ib": "formula" }, a.formula));
    return h("div", { class: "ib", id: "item-bal" }, kids);
  }

  function mount(form, collect) {
    if (!form || typeof document === "undefined") return;
    let box = form.querySelector("#item-bal");
    if (!box) { box = h("div", { id: "item-bal-slot" }); form.append(box); }
    const draw = () => {
      const it = collect();
      const next = panel(it, (typeof S !== "undefined" && S.c && S.c.items) || []);
      const hold = form.scrollTop;
      box.replaceChildren(next);
      if (form.scrollTop !== hold) form.scrollTop = hold;
      if (typeof BQScroll !== "undefined" && BQScroll.note) BQScroll.note(form);
    };
    if (!form.dataset.ibBound) {
      form.dataset.ibBound = "1";
      const on = () => draw();
      form.addEventListener("input", on);
      form.addEventListener("change", on);
      form.addEventListener("click", e => {
        // "+ Stat bonus" / remove a bonus rebuilds the attribute rows
        if (e.target.closest && e.target.closest(".rw button, button")) setTimeout(on, 0);
      });
    }
    draw();
  }

  return { STATS, numVal, worth, attrs, attrSum, isGear, isTool, pickFit, powerOf, suggest, analyse, formulaWords, flagWords, mount, panel };
})();
if (typeof module !== "undefined" && module.exports) module.exports = BQItemBal;
