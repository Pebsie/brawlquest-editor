"use strict";

/**
 * Searchable item picker for ItemID fields.
 * Images use ImgPath relative to an asset root (bundled ./ by default; override in the header).
 */
const ItemPicker = (() => {
  const STORAGE_KEY = "bq-editor-asset-root";
  let modalEl = null;
  let onPick = null;
  let cache = null;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function getAssetRoot() {
    const raw = (localStorage.getItem(STORAGE_KEY) || "").trim();
    if (!raw) return "";
    return raw.endsWith("/") ? raw : raw + "/";
  }

  function setAssetRoot(v) {
    const t = String(v ?? "").trim();
    if (t) localStorage.setItem(STORAGE_KEY, t);
    else localStorage.removeItem(STORAGE_KEY);
    // refresh visible icons
    document.querySelectorAll("[data-item-pick]").forEach((el) => refreshButton(el));
  }

  function imgUrl(path) {
    if (!path) return "";
    const root = getAssetRoot();
    const cleaned = String(path).replace(/^\/+/, "");
    const encoded = cleaned.split("/").map(encodeURIComponent).join("/");
    return root + encoded;
  }

  function iconHtml(path, cls = "") {
    if (!path) {
      return `<span class="item-icon ph ${esc(cls)}" title="No image"></span>`;
    }
    const src = imgUrl(path);
    return `<img class="item-icon ${esc(cls)}" alt="" src="${esc(src)}" loading="lazy" decoding="async" onerror="this.classList.add('broken');this.replaceWith(Object.assign(document.createElement('span'),{className:'item-icon ph ${esc(cls)}',title:'Missing image'}))">`;
  }

  function allItems() {
    if (!BQDB.hasDb()) return [];
    // Fresh each open so edits to items appear; cheap for ~134 rows
    return BQDB.all("SELECT id, Name, Type, ImgPath, Worth FROM items ORDER BY Name COLLATE NOCASE");
  }

  function itemById(id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return null;
    return BQDB.one("SELECT id, Name, Type, ImgPath FROM items WHERE id=?", [n]);
  }

  function labelFor(id) {
    const it = itemById(id);
    if (!it) return { title: Number.isFinite(Number(id)) && id !== "" ? `Missing #${id}` : "Choose item…", meta: "", path: "" };
    return { title: it.Name, meta: it.Type || "", path: it.ImgPath || "" };
  }

  /** Compact control: icon + name + visible id, opens modal. */
  function controlHtml(value, opts = {}) {
    const name = opts.name || "ItemID";
    const dataK = opts.dataK != null ? opts.dataK : "ItemID";
    const id = value == null || value === "" ? "" : String(value);
    const lab = labelFor(id);
    const attrName = opts.name != null ? `name="${esc(name)}"` : "";
    const attrK = dataK != null && dataK !== false ? `data-k="${esc(dataK)}"` : "";
    return `<div class="item-pick" data-item-pick>
      <input type="hidden" ${attrName} ${attrK} value="${esc(id)}" data-item-id>
      <button type="button" class="item-pick-btn" data-item-open title="Pick item">
        ${iconHtml(lab.path)}
        <span class="item-pick-text">
          <strong class="item-pick-name">${esc(lab.title)}</strong>
          <span class="item-pick-meta">${esc(lab.meta)}</span>
        </span>
      </button>
      <input type="number" class="item-pick-idnum" value="${esc(id)}" title="Item id" aria-label="Item id">
    </div>`;
  }

  function refreshButton(wrap) {
    const hidden = wrap.querySelector("[data-item-id]");
    const id = hidden ? hidden.value : "";
    const lab = labelFor(id);
    const btn = wrap.querySelector("[data-item-open]");
    if (btn) {
      btn.innerHTML = `${iconHtml(lab.path)}<span class="item-pick-text"><strong class="item-pick-name">${esc(lab.title)}</strong><span class="item-pick-meta">${esc(lab.meta)}</span></span>`;
    }
    const idnum = wrap.querySelector(".item-pick-idnum");
    if (idnum && String(idnum.value) !== String(id)) idnum.value = id;
  }

  function setValue(wrap, id, silent) {
    const hidden = wrap.querySelector("[data-item-id]");
    if (hidden) {
      hidden.value = id == null || id === "" ? "" : String(id);
      if (!silent) hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const idnum = wrap.querySelector(".item-pick-idnum");
    if (idnum) idnum.value = id == null || id === "" ? "" : String(id);
    refreshButton(wrap);
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.id = "item-picker-modal";
    modalEl.className = "item-modal";
    modalEl.hidden = true;
    modalEl.innerHTML = `
      <div class="item-modal-backdrop" data-close></div>
      <div class="item-modal-panel" role="dialog" aria-modal="true" aria-label="Pick item">
        <div class="item-modal-head">
          <h2>Pick item</h2>
          <input type="search" class="search" id="item-picker-q" placeholder="Search by name or id…" autocomplete="off">
          <button type="button" class="btn small" data-close>Close</button>
        </div>
        <div class="item-modal-list" id="item-picker-list"></div>
      </div>`;
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) close();
      const row = e.target.closest("[data-pick-id]");
      if (row) {
        const id = Number(row.dataset.pickId);
        if (onPick) onPick(id);
        close();
      }
    });
    modalEl.querySelector("#item-picker-q").addEventListener("input", () => fillList());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalEl && !modalEl.hidden) close();
    });
    return modalEl;
  }

  function fillList() {
    const list = modalEl.querySelector("#item-picker-list");
    const q = (modalEl.querySelector("#item-picker-q").value || "").toLocaleLowerCase("en-GB").trim();
    const items = allItems().filter((it) => {
      if (!q) return true;
      return String(it.id) === q
        || String(it.Name || "").toLocaleLowerCase("en-GB").includes(q)
        || String(it.Type || "").toLocaleLowerCase("en-GB").includes(q);
    });
    list.innerHTML = items.slice(0, 300).map((it) => `
      <button type="button" class="item-modal-row" data-pick-id="${it.id}">
        ${iconHtml(it.ImgPath, "lg")}
        <span class="item-pick-text">
          <strong>${esc(it.Name)}</strong>
          <span class="item-pick-meta">#${it.id} · ${esc(it.Type || "—")} · worth ${esc(it.Worth)}</span>
        </span>
      </button>`).join("") || `<div class="empty">No items match</div>`;
  }

  function open(currentId, pickCb) {
    onPick = pickCb;
    const m = ensureModal();
    m.hidden = false;
    const q = m.querySelector("#item-picker-q");
    q.value = "";
    fillList();
    // highlight current
    requestAnimationFrame(() => {
      q.focus();
      if (currentId != null && currentId !== "") {
        const row = m.querySelector(`[data-pick-id="${CSS.escape(String(currentId))}"]`);
        if (row) row.classList.add("active");
      }
    });
  }

  function close() {
    if (modalEl) modalEl.hidden = true;
    onPick = null;
  }

  /** Delegate clicks/changes inside a root for all item-pick controls. */
  function wire(root) {
    if (!root || root._itemPickWired) return;
    root._itemPickWired = true;
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-item-open]");
      if (!btn || !root.contains(btn)) return;
      const wrap = btn.closest("[data-item-pick]");
      if (!wrap) return;
      e.preventDefault();
      const hidden = wrap.querySelector("[data-item-id]");
      const cur = hidden ? hidden.value : "";
      open(cur, (id) => setValue(wrap, id));
    });
    root.addEventListener("change", (e) => {
      const idnum = e.target.closest?.(".item-pick-idnum");
      if (!idnum || !root.contains(idnum)) return;
      const wrap = idnum.closest("[data-item-pick]");
      if (!wrap) return;
      const v = idnum.value === "" ? "" : Number(idnum.value);
      setValue(wrap, Number.isFinite(v) ? v : "", true);
      const hidden = wrap.querySelector("[data-item-id]");
      if (hidden) hidden.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function readId(wrapOrInput) {
    if (!wrapOrInput) return NaN;
    if (wrapOrInput.matches?.("[data-item-pick]")) {
      return Number(wrapOrInput.querySelector("[data-item-id]")?.value);
    }
    if (wrapOrInput.matches?.("[data-item-id],.item-pick-idnum")) {
      return Number(wrapOrInput.value);
    }
    const wrap = wrapOrInput.closest?.("[data-item-pick]");
    if (wrap) return Number(wrap.querySelector("[data-item-id]")?.value);
    return Number(wrapOrInput.value);
  }

  /** Header control for asset root override. */
  function mountAssetRootControl(host) {
    if (!host || host.querySelector("#asset-root-input")) return;
    const wrap = document.createElement("label");
    wrap.className = "asset-root";
    wrap.title = "Base URL for ImgPath (leave blank to use bundled assets/)";
    wrap.innerHTML = `Assets <input type="url" id="asset-root-input" placeholder="(bundled assets/)" value="${esc(localStorage.getItem(STORAGE_KEY) || "")}">`;
    host.appendChild(wrap);
    wrap.querySelector("input").addEventListener("change", (e) => {
      setAssetRoot(e.target.value);
      Editors?.toast?.("Asset root updated");
    });
  }

  return {
    controlHtml, wire, open, close, setValue, readId, refreshButton,
    imgUrl, iconHtml, getAssetRoot, setAssetRoot, mountAssetRootControl,
    itemById, labelFor,
  };
})();
