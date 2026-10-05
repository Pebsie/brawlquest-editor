"use strict";

const App = (() => {
  const state = {
    tab: "items",
    items: { sel: null },
    enemies: { sel: null },
    loot: { sel: null },
    npcs: { sel: null },
    quests: { sel: null },
    dialogue: { sel: null, group: null },
    world: {},
    craft: { sel: null },
    forge: { sel: null },
  };

  const statusEl = () => document.getElementById("status");
  const nav = () => document.getElementById("nav");
  const welcome = () => document.getElementById("welcome");
  const workspace = () => document.getElementById("workspace");
  const btnSave = () => document.getElementById("btn-save");

  function syncDirty() {
    const el = statusEl();
    if (!BQDB.hasDb()) {
      el.textContent = "No database loaded";
      el.classList.remove("dirty");
      btnSave().disabled = true;
      return;
    }
    const name = BQDB.getName();
    const dirty = BQDB.isDirty();
    el.textContent = dirty ? `${name} · unsaved edits in memory` : `${name} · in memory`;
    el.classList.toggle("dirty", dirty);
    btnSave().disabled = false;
  }

  function showWorkspace() {
    welcome().hidden = true;
    workspace().hidden = false;
    nav().hidden = false;
    renderTab();
    syncDirty();
  }

  function renderTab() {
    const ws = workspace();
    const tab = state.tab;
    nav().querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    if (tab === "dialogue") DialogueEditor.render(ws, state.dialogue);
    else if (tab === "world") WorldEditor.render(ws, state);
    else Editors.render(tab, ws, state[tab] || (state[tab] = { sel: null }));
  }

  async function loadSample() {
    Editors.toast("Loading sample catalogue…");
    await BQDB.openUrl("sample/sample-content.db", "sample-content.db");
    Editors.toast("Sample loaded (content only — not users.db)");
    showWorkspace();
  }

  async function loadFile(file) {
    const name = file.name || "content.db";
    if (/users/i.test(name) || /bq-users/i.test(name)) {
      alert("Refusing to load a users database. Use bq-content.db only.");
      return;
    }
    const buf = await file.arrayBuffer();
    await BQDB.openArrayBuffer(buf, name);
    Editors.toast(`Loaded ${name}`);
    showWorkspace();
  }

  function download() {
    if (!BQDB.hasDb()) return;
    const issues = BQDB.validateContent();
    if (issues.length) {
      const preview = issues.slice(0, 25).join("\n");
      const more = issues.length > 25 ? `\n…and ${issues.length - 25} more` : "";
      const ok = confirm(`Validation found ${issues.length} issue(s):\n\n${preview}${more}\n\nDownload anyway?`);
      if (!ok) return;
    }
    BQDB.download();
    syncDirty();
    Editors.toast("Downloaded. Apply on the server then restart or GET /refresh.");
  }

  function init() {
    document.getElementById("btn-load-sample").addEventListener("click", () => {
      loadSample().catch((e) => { console.error(e); alert(e.message || String(e)); });
    });
    document.getElementById("file-input").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFile(f).catch((err) => { console.error(err); alert(err.message || String(err)); });
      e.target.value = "";
    });
    btnSave().addEventListener("click", download);
    nav().addEventListener("click", (e) => {
      const t = e.target.closest(".tab");
      if (!t || !BQDB.hasDb()) return;
      state.tab = t.dataset.tab;
      renderTab();
    });
    window.addEventListener("beforeunload", (e) => {
      if (BQDB.isDirty()) { e.preventDefault(); e.returnValue = ""; }
    });
    BQDB.init().catch((e) => console.warn("sql.js init", e));
  }

  return { init, syncDirty, state, renderTab };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
