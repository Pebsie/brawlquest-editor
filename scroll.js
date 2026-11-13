"use strict";
// Keep scroll position and input focus when a panel is rebuilt with h() /
// replaceChildren / textContent = "". Without this, clearing a large inner box
// shrinks the scroller and the browser clamps scrollTop to 0 before the new
// rows are added, so the list or form jumps back to the top.
const BQScroll = (() => {
  const SCOPE = "#main, .modal, .qs-drawer, .qs-body, .qs-cast, .qs-sheetpage, .qs-play";
  const CLASSES = [
    "list", "form", "side", "modal-body", "picker-grid", "ip-list", "arealist", "npclist",
    "sfx-lib", "qs-body", "qs-drawer", "qs-cast", "qs-sheetpage", "qs-play",
    "qs-problems", "qs-speech", "qs-log", "qs-wbody", "qs-pgrid", "steps", "opts"
  ];
  let hold = 0;
  let pending = 0;
  let generation = 0;
  let applying = false;
  const userScroll = new WeakMap();

  function tab() { return (typeof S !== "undefined" && S && S.tab) || ""; }

  function isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    const oy = el.scrollHeight - el.clientHeight, ox = el.scrollWidth - el.clientWidth;
    if (oy <= 1 && ox <= 1 && !el.scrollTop && !el.scrollLeft) {
      if (el.dataset && el.dataset.scroll) return true;
      return CLASSES.some(c => el.classList.contains(c));
    }
    try {
      const cs = getComputedStyle(el);
      return /auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflowX) || !!(el.dataset && el.dataset.scroll);
    } catch { return true; }
  }

  function key(el) {
    if (el.dataset && el.dataset.scroll) return el.dataset.scroll;
    if (el.id) return "#" + el.id;
    const parts = [];
    let n = el, i = 0;
    while (n && n.nodeType === 1 && n !== document.documentElement && i++ < 10) {
      if (n.dataset && n.dataset.scroll) { parts.unshift(n.dataset.scroll); break; }
      if (n.id) { parts.unshift("#" + n.id); break; }
      const c = CLASSES.find(x => n.classList.contains(x));
      const name = c || n.tagName.toLowerCase();
      const parent = n.parentElement;
      let idx = 0;
      if (parent) {
        const same = [...parent.children].filter(x => (c ? x.classList.contains(c) : x.tagName === n.tagName));
        idx = same.indexOf(n);
      }
      parts.unshift(name + (idx > 0 ? "[" + idx + "]" : ""));
      if (c === "list" || c === "form" || c === "side") {
        parts.unshift(tab());
        break;
      }
      n = n.parentElement;
    }
    return parts.join(">");
  }

  function walk(root, out) {
    if (!root) return out;
    if (root.nodeType === 9) return walk(root.documentElement, out);
    if (root.nodeType === 11) { for (const c of root.childNodes) walk(c, out); return out; }
    if (root.nodeType !== 1) return out;
    if (isScrollable(root)) out.push(root);
    for (const c of root.children) walk(c, out);
    return out;
  }

  function focusKey(el) {
    return {
      id: el.id || "",
      dataKey: (el.dataset && el.dataset.key) || "",
      dataAct: (el.dataset && el.dataset.act) || "",
      dataRole: (el.dataset && (el.dataset.role || el.dataset.buys)) || "",
      name: el.name || "",
      type: el.type || "",
      placeholder: el.placeholder || "",
      tag: el.tagName,
      path: key(el)
    };
  }

  function findFocus(root, f) {
    if (!f) return null;
    if (f.id) {
      const el = document.getElementById(f.id);
      if (el) return el;
    }
    const scope = root && root.querySelectorAll ? root : document;
    const q = [];
    if (f.dataKey) q.push("[data-key=\"" + CSS.escape(f.dataKey) + "\"]");
    if (f.dataAct) q.push("[data-act=\"" + CSS.escape(f.dataAct) + "\"]");
    if (f.dataRole) q.push("[data-role=\"" + CSS.escape(f.dataRole) + "\"], [data-buys=\"" + CSS.escape(f.dataRole) + "\"]");
    for (const sel of q) {
      const els = [...(scope.querySelectorAll ? scope.querySelectorAll(sel) : [])];
      const hit = els.find(e => e.tagName === f.tag && (!f.type || e.type === f.type)) || els[0];
      if (hit) return hit;
    }
    if (f.placeholder) {
      const els = [...(scope.querySelectorAll ? scope.querySelectorAll(f.tag + "[placeholder]") : [])];
      const hit = els.find(e => e.placeholder === f.placeholder && (!f.type || e.type === f.type));
      if (hit) return hit;
    }
    return null;
  }

  function capture(root) {
    root = root || document;
    const snaps = {};
    for (const el of walk(root, [])) snaps[key(el)] = { top: el.scrollTop, left: el.scrollLeft };
    const ae = document.activeElement;
    let focus = null;
    if (ae && (root === document || (root.contains && root.contains(ae))) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
      focus = focusKey(ae);
      try { focus.start = ae.selectionStart; focus.end = ae.selectionEnd; } catch {}
    }
    return { snaps, focus, tab: tab(), gen: generation };
  }

  function apply(root, snap) {
    if (!snap) return;
    if (snap.gen != null && snap.gen !== generation) return;
    if (snap.tab && snap.tab !== tab()) return;
    const els = walk(root || document, []);
    const byKey = {};
    for (const el of els) byKey[key(el)] = el;
    applying = true;
    try {
    for (const [k, pos] of Object.entries(snap.snaps)) {
      const el = byKey[k];
      if (!el) continue;
      const u = userScroll.get(el);
      // A later user scroll (or test scroll) must not be overwritten by a
      // delayed restore from an earlier snapshot.
      if (u && (u.top !== pos.top || u.left !== pos.left)) continue;
      if (el.scrollTop !== pos.top) el.scrollTop = pos.top;
      if (el.scrollLeft !== pos.left) el.scrollLeft = pos.left;
    }
    } finally { applying = false; }
    if (snap.focus) {
      const el = findFocus(root || document, snap.focus);
      if (el && el.focus && document.activeElement !== el) {
        try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      }
      if (el && snap.focus.start != null && el.setSelectionRange) {
        try { el.setSelectionRange(snap.focus.start, snap.focus.end); } catch {}
      }
    }
  }

  function restore(root, snap) {
    apply(root, snap);
    const id = ++pending;
    // A second frame and a timeout beat the browser scrolling a rebuilt
    // button or focused field into view after the click handler returns.
    requestAnimationFrame(() => {
      if (id !== pending) return;
      apply(root, snap);
      requestAnimationFrame(() => { if (id === pending) apply(root, snap); });
    });
    for (const ms of [0, 50, 100, 200]) {
      setTimeout(() => { if (id === pending) apply(root, snap); }, ms);
    }
  }

  function inScope(el) {
    return !!(el && el.closest && el.closest(SCOPE));
  }

  function run(fn, root) {
    generation++;
    const snap = capture(root || document);
    hold++;
    const finish = () => { hold--; restore(root || document, snap); };
    try {
      const result = fn();
      if (result && typeof result.then === "function") return result.then(v => { finish(); return v; }, e => { finish(); throw e; });
      finish();
      return result;
    } catch (e) { finish(); throw e; }
  }

  function install() {
    if (Element.prototype._bqScrollPatched) return;
    const origRC = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...nodes) {
      if (hold || !inScope(this)) return origRC.apply(this, nodes);
      const scope = this.closest(SCOPE) || this;
      const snap = capture(scope);
      const out = origRC.apply(this, nodes);
      restore(scope, snap);
      return out;
    };
    const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
    Object.defineProperty(Element.prototype, "textContent", {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) {
        if (hold || v !== "" || !inScope(this) || !this.childNodes.length) {
          desc.set.call(this, v);
          return;
        }
        const scope = this.closest(SCOPE) || this;
        const snap = capture(scope);
        desc.set.call(this, v);
        restore(scope, snap);
      }
    });
    const afterEvent = ev => {
      if (hold) return;
      const t = ev.target;
      if (!t || !t.closest) return;
      if (!inScope(t) && !(t.closest && t.closest(".side, .list, .form, .modal"))) return;
      const scope = (t.closest && t.closest(SCOPE)) || document.body;
      const snap = capture(scope);
      queueMicrotask(() => restore(scope, snap));
    };
    document.addEventListener("click", afterEvent, true);
    document.addEventListener("change", afterEvent, true);
    const noteFrom = ev => {
      if (applying) return;
      let el = ev.target;
      if (el && el.nodeType !== 1) el = el.parentElement;
      while (el && el.nodeType === 1) {
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 || el.scrollTop || el.scrollLeft) {
          userScroll.set(el, { top: el.scrollTop, left: el.scrollLeft });
        }
        el = el.parentElement;
      }
    };
    document.addEventListener("wheel", noteFrom, true);
    document.addEventListener("touchmove", noteFrom, true);
    document.addEventListener("keydown", ev => {
      if (/^(Arrow|Page|Home|End| )/.test(ev.key) || ev.key === " ") noteFrom(ev);
    }, true);
    Element.prototype._bqScrollPatched = true;
  }

  function note(el) {
    if (!el || el.nodeType !== 1) return;
    userScroll.set(el, { top: el.scrollTop, left: el.scrollLeft });
  }

  return { capture, restore, run, install, key, note };
})();
BQScroll.install();
window.BQScroll = BQScroll;
