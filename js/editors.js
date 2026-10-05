"use strict";

const ITEM_TYPES = ["wep","arm_head","arm_chest","arm_legs","arm_leg","shield","mount","hp_potion","mana_potion","spell","reagent","buddy","currency","quest","furniture","floor","wall","ore"];
const ITEM_SUBTYPES = ["None","Light","Medium","Heavy","High Mastery"];
const QUEST_TYPES = ["kill","gather","go"];
const SPELL_NAMES = ["Spawn","Death","Spawn At Target","Spawn Nearby","Poison","Spawn on Death"];

const Editors = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const lower = (s) => String(s ?? "").toLocaleLowerCase("en-GB");

  function toast(msg, ms = 3200) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; el.classList.remove("show"); }, ms);
  }

  function field(label, name, value, opts = {}) {
    const type = opts.type || "text";
    const full = opts.full ? " full" : "";
    if (type === "textarea") {
      return `<label class="field${full}">${esc(label)}<textarea name="${esc(name)}" ${opts.rows ? `rows="${opts.rows}"` : ""}>${esc(value ?? "")}</textarea></label>`;
    }
    if (type === "select") {
      const optsHtml = (opts.options || []).map((o) => {
        const v = Array.isArray(o) ? o[0] : o;
        const t = Array.isArray(o) ? o[1] : o;
        return `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(t)}</option>`;
      }).join("");
      return `<label class="field${full}">${esc(label)}<select name="${esc(name)}">${optsHtml}</select></label>`;
    }
    if (type === "checkbox") {
      return `<label class="field${full}"><span>${esc(label)}</span><input type="checkbox" name="${esc(name)}" ${value ? "checked" : ""}></label>`;
    }
    return `<label class="field${full}">${esc(label)}<input type="${esc(type)}" name="${esc(name)}" value="${esc(value ?? "")}" ${opts.step != null ? `step="${opts.step}"` : ""} ${opts.min != null ? `min="${opts.min}"` : ""}></label>`;
  }

  function getForm(root) {
    const data = {};
    root.querySelectorAll("[name]").forEach((el) => {
      if (el.type === "checkbox") data[el.name] = el.checked ? 1 : 0;
      else data[el.name] = el.value;
    });
    return data;
  }

  function layout(title, listHtml, editorHtml) {
    return `<div class="split"><aside class="side"><div class="side-head"><h2>${esc(title)}</h2>${listHtml}</div><div class="list" id="entity-list"></div></aside><div class="editor" id="entity-editor">${editorHtml}</div></div>`;
  }

  function noneSelected(msg) {
    return `<div class="empty">${esc(msg || "Select a row, or create a new one.")}</div>`;
  }

  function itemsGivenEditor(list, emptyHint) {
    const rows = (list || []).map((it, i) => `
      <tr data-i="${i}">
        <td><input class="num" data-k="ItemID" type="number" value="${esc(it.ItemID)}"></td>
        <td><input class="num" data-k="Amount" type="number" value="${esc(it.Amount)}"></td>
        <td><button type="button" class="btn small danger" data-rm="${i}">×</button></td>
      </tr>`).join("");
    return `<div class="full" id="items-given-wrap">
      <div class="note">${esc(emptyHint || "JSON ItemsGiven: negative Amount is a cost.")}</div>
      <div class="table-wrap"><table class="mini"><thead><tr><th>ItemID</th><th>Amount</th><th></th></tr></thead>
      <tbody id="items-given-body">${rows || ""}</tbody></table></div>
      <button type="button" class="btn small" id="items-given-add">Add item</button>
    </div>`;
  }

  function readItemsGiven(root) {
    const out = [];
    root.querySelectorAll("#items-given-body tr").forEach((tr) => {
      const ItemID = Number(tr.querySelector('[data-k="ItemID"]').value);
      const Amount = Number(tr.querySelector('[data-k="Amount"]').value);
      if (Number.isFinite(ItemID)) out.push({ ItemID, Amount: Number.isFinite(Amount) ? Amount : 0 });
    });
    return out;
  }

  function wireItemsGiven(root, onChange) {
    const body = root.querySelector("#items-given-body");
    if (!body) return;
    root.querySelector("#items-given-add")?.addEventListener("click", () => {
      body.insertAdjacentHTML("beforeend", `<tr><td><input class="num" data-k="ItemID" type="number" value=""></td><td><input class="num" data-k="Amount" type="number" value="1"></td><td><button type="button" class="btn small danger" data-rm>×</button></td></tr>`);
      onChange?.();
    });
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rm]");
      if (btn) { btn.closest("tr").remove(); onChange?.(); }
    });
  }

  // ——— ITEMS ———
  function renderItems(ws, state) {
    const rows = BQDB.all("SELECT id, Name, Type, Worth FROM items ORDER BY id");
    ws.innerHTML = layout("Items", `
      <input class="search" id="q" placeholder="Search items…">
      <div class="side-actions"><button type="button" class="btn small" id="btn-new">New item</button></div>`, noneSelected());
    const list = ws.querySelector("#entity-list");
    const editor = ws.querySelector("#entity-editor");
    const q = ws.querySelector("#q");

    function fillList() {
      const term = lower(q.value);
      list.innerHTML = rows.filter((r) => !term || lower(r.Name).includes(term) || String(r.id) === term || lower(r.Type).includes(term))
        .map((r) => `<button type="button" class="list-item ${state.sel === r.id ? "active" : ""}" data-id="${r.id}"><span class="id">#${r.id}</span>${esc(r.Name)}<span class="meta">${esc(r.Type)} · worth ${esc(r.Worth)}</span></button>`).join("") || `<div class="empty">No matches</div>`;
    }
    fillList();
    q.addEventListener("input", fillList);
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (!b) return;
      state.sel = Number(b.dataset.id);
      show();
      fillList();
    });
    ws.querySelector("#btn-new").addEventListener("click", () => {
      const id = BQDB.nextId("items");
      BQDB.run(`INSERT INTO items (id, Name, Type, Val, ImgPath, Desc, Worth, Attributes, Subtype, Cooldown) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, "New Item", "wep", "1", "", "", 0, "None", "None", 1]);
      state.sel = id;
      toast(`Created item #${id}`);
      Editors.render("items", ws, state);
      App.syncDirty();
    });

    function show() {
      const r = BQDB.one("SELECT * FROM items WHERE id=?", [state.sel]);
      if (!r) { editor.innerHTML = noneSelected(); return; }
      editor.innerHTML = `<h2>${esc(r.Name)}</h2><p class="sub">id ${r.id} · append-only ids; renaming is a refactor</p>
        <form id="f" class="form-grid">
          ${field("Name", "Name", r.Name)}
          ${field("Type", "Type", r.Type, { type: "select", options: ITEM_TYPES })}
          ${field("Val", "Val", r.Val)}
          ${field("Worth", "Worth", r.Worth, { type: "number" })}
          ${field("Cooldown", "Cooldown", r.Cooldown ?? 1, { type: "number" })}
          ${field("Subtype", "Subtype", r.Subtype || "None", { type: "select", options: ITEM_SUBTYPES })}
          ${field("Attributes", "Attributes", r.Attributes || "None", { full: true })}
          ${field("ImgPath", "ImgPath", r.ImgPath, { full: true })}
          ${field("Desc", "Desc", r.Desc, { type: "textarea", full: true })}
        </form>
        <p class="note">Attributes: <code>None</code> or <code>STAT,N;STAT,N</code>. Hardcoded ids (1–3 starter, 23 fish, 53 crystal, …) — do not renumber.</p>
        <div class="row-actions">
          <button type="button" class="btn primary" id="btn-save-row">Apply</button>
          <button type="button" class="btn danger" id="btn-del">Delete</button>
        </div>`;
      editor.querySelector("#btn-save-row").onclick = () => {
        const d = getForm(editor.querySelector("#f"));
        const attrs = d.Attributes?.trim() || "None";
        const subtype = d.Subtype?.trim() || "None";
        BQDB.run(`UPDATE items SET Name=?, Type=?, Val=?, ImgPath=?, Desc=?, Worth=?, Attributes=?, Subtype=?, Cooldown=? WHERE id=?`,
          [d.Name, d.Type, d.Val, d.ImgPath ?? "", d.Desc ?? "", Number(d.Worth) || 0, attrs, subtype, Number(d.Cooldown) || 1, r.id]);
        toast("Item saved in memory");
        App.syncDirty();
        Editors.render("items", ws, state);
      };
      editor.querySelector("#btn-del").onclick = () => {
        if (!confirm(`Delete item #${r.id} ${r.Name}? References in loot/craft/quests may break.`)) return;
        BQDB.run("DELETE FROM items WHERE id=?", [r.id]);
        state.sel = null;
        toast("Item deleted");
        App.syncDirty();
        Editors.render("items", ws, state);
      };
    }
    if (state.sel != null) show();
  }

  // ——— ENEMIES (+ spells + loot) ———
  function renderEnemies(ws, state) {
    const rows = BQDB.all("SELECT id, Name, HP, ATK FROM enemies ORDER BY id");
    ws.innerHTML = layout("Enemies", `
      <input class="search" id="q" placeholder="Search enemies…">
      <div class="side-actions"><button type="button" class="btn small" id="btn-new">New enemy</button></div>`, noneSelected());
    const list = ws.querySelector("#entity-list");
    const editor = ws.querySelector("#entity-editor");
    const q = ws.querySelector("#q");
    function fillList() {
      const term = lower(q.value);
      list.innerHTML = rows.filter((r) => !term || lower(r.Name).includes(term) || String(r.id) === term)
        .map((r) => `<button type="button" class="list-item ${state.sel === r.id ? "active" : ""}" data-id="${r.id}"><span class="id">#${r.id}</span>${esc(r.Name)}<span class="meta">${esc(r.HP)} HP · ${esc(r.ATK)} ATK</span></button>`).join("") || `<div class="empty">No matches</div>`;
    }
    fillList();
    q.oninput = fillList;
    list.onclick = (e) => { const b = e.target.closest("[data-id]"); if (!b) return; state.sel = Number(b.dataset.id); show(); fillList(); };
    ws.querySelector("#btn-new").onclick = () => {
      const id = BQDB.nextId("enemies");
      BQDB.run(`INSERT INTO enemies (id, Name, ATK, Image, HP, Range, CanMove, XP, Width, Height, Attributes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, "New Enemy", 1, "", 10, 1, 1, 1, 1, 1, "None"]);
      state.sel = id; toast(`Created enemy #${id}`); App.syncDirty(); Editors.render("enemies", ws, state);
    };

    function show() {
      const r = BQDB.one("SELECT * FROM enemies WHERE id=?", [state.sel]);
      if (!r) { editor.innerHTML = noneSelected(); return; }
      const spells = BQDB.all("SELECT * FROM enemySpells WHERE EnemyID=? ORDER BY id", [r.id]);
      const loot = BQDB.all("SELECT * FROM loot WHERE EnemyID=? ORDER BY id", [r.id]);
      editor.innerHTML = `<h2>${esc(r.Name)}</h2><p class="sub">id ${r.id} · world.Enemy and quest kill Value use this Name</p>
        <form id="f" class="form-grid">
          ${field("Name", "Name", r.Name)}
          ${field("ATK", "ATK", r.ATK, { type: "number" })}
          ${field("HP", "HP", r.HP, { type: "number" })}
          ${field("XP", "XP", r.XP, { type: "number" })}
          ${field("Range", "Range", r.Range, { type: "number" })}
          ${field("CanMove", "CanMove", r.CanMove, { type: "checkbox" })}
          ${field("Width", "Width", r.Width ?? 1, { type: "number" })}
          ${field("Height", "Height", r.Height ?? 1, { type: "number" })}
          ${field("Attributes", "Attributes", r.Attributes || "None")}
          ${field("Image", "Image", r.Image, { full: true })}
        </form>
        <div class="row-actions">
          <button type="button" class="btn primary" id="btn-save-row">Apply</button>
          <button type="button" class="btn danger" id="btn-del">Delete</button>
        </div>
        <h3>Spells</h3>
        <div class="table-wrap"><table class="mini"><thead><tr><th>id</th><th>Name</th><th>Value</th><th>Frequency</th><th></th></tr></thead>
        <tbody id="spells-body">${spells.map((s) => `<tr data-id="${s.id}">
          <td>${s.id}</td>
          <td><select data-k="Name">${SPELL_NAMES.map((n) => `<option ${n===s.Name?"selected":""}>${esc(n)}</option>`).join("")}</select></td>
          <td><input data-k="Value" value="${esc(s.Value)}"></td>
          <td><input class="num" data-k="Frequency" type="number" value="${esc(s.Frequency)}"></td>
          <td><button type="button" class="btn small danger" data-del-spell="${s.id}">×</button></td>
        </tr>`).join("")}</tbody></table></div>
        <button type="button" class="btn small" id="add-spell">Add spell</button>
        <h3>Loot</h3>
        <div class="table-wrap"><table class="mini"><thead><tr><th>id</th><th>ItemID</th><th>Chance%</th><th>Amount</th><th>Variance</th><th></th></tr></thead>
        <tbody id="loot-body">${loot.map((l) => `<tr data-id="${l.id}">
          <td>${l.id}</td>
          <td><input class="num" data-k="ItemID" type="number" value="${esc(l.ItemID)}"></td>
          <td><input class="num" data-k="Chance" type="number" value="${esc(l.Chance)}"></td>
          <td><input class="num" data-k="Amount" type="number" value="${esc(l.Amount)}"></td>
          <td><input class="num" data-k="AmountVariance" type="number" value="${esc(l.AmountVariance)}"></td>
          <td><button type="button" class="btn small danger" data-del-loot="${l.id}">×</button></td>
        </tr>`).join("")}</tbody></table></div>
        <button type="button" class="btn small" id="add-loot">Add loot</button>
        <p class="note">Chance: drop if rand(100) &lt; Chance. AmountVariance 0 is treated as 1 by the server. Renaming this enemy requires updating world.Enemy and quest.Value.</p>
        <div class="row-actions"><button type="button" class="btn primary" id="btn-save-children">Apply spells &amp; loot</button></div>`;

      editor.querySelector("#btn-save-row").onclick = () => {
        const d = getForm(editor.querySelector("#f"));
        const oldName = r.Name;
        const newName = d.Name;
        if (newName !== oldName) {
          const refs = [];
          const w = BQDB.all("SELECT COUNT(*) AS c FROM world WHERE Enemy=?", [oldName])[0]?.c || 0;
          const qn = BQDB.all("SELECT COUNT(*) AS c FROM quest WHERE Type='kill' AND Value=?", [oldName])[0]?.c || 0;
          if (w || qn) {
            if (!confirm(`Rename "${oldName}" → "${newName}"?\nThis will update ${w} world tiles and ${qn} kill quests.`)) return;
          }
        }
        BQDB.run(`UPDATE enemies SET Name=?, ATK=?, Image=?, HP=?, Range=?, CanMove=?, XP=?, Width=?, Height=?, Attributes=? WHERE id=?`,
          [newName, Number(d.ATK)||0, d.Image??"", Number(d.HP)||0, Number(d.Range)||0, d.CanMove?1:0, Number(d.XP)||0, Number(d.Width)||1, Number(d.Height)||1, d.Attributes?.trim()||"None", r.id]);
        if (newName !== oldName) {
          BQDB.run("UPDATE world SET Enemy=? WHERE Enemy=?", [newName, oldName]);
          BQDB.run("UPDATE quest SET Value=? WHERE Type='kill' AND Value=?", [newName, oldName]);
        }
        toast("Enemy saved"); App.syncDirty(); Editors.render("enemies", ws, state);
      };
      editor.querySelector("#btn-del").onclick = () => {
        if (!confirm(`Delete enemy #${r.id}? Also deletes its spells and loot rows.`)) return;
        BQDB.run("DELETE FROM enemySpells WHERE EnemyID=?", [r.id]);
        BQDB.run("DELETE FROM loot WHERE EnemyID=?", [r.id]);
        BQDB.run("DELETE FROM enemies WHERE id=?", [r.id]);
        state.sel = null; toast("Enemy deleted"); App.syncDirty(); Editors.render("enemies", ws, state);
      };
      editor.querySelector("#add-spell").onclick = () => {
        const id = BQDB.nextId("enemySpells");
        BQDB.run("INSERT INTO enemySpells (id, EnemyID, Name, Value, Frequency) VALUES (?,?,?,?,?)", [id, r.id, "Spawn", "", 5]);
        App.syncDirty(); show();
      };
      editor.querySelector("#add-loot").onclick = () => {
        const id = BQDB.nextId("loot");
        BQDB.run("INSERT INTO loot (id, EnemyID, AmountVariance, Chance, ItemID, Amount) VALUES (?,?,?,?,?,?)", [id, r.id, 0, 100, 1, 1]);
        App.syncDirty(); show();
      };
      editor.querySelector("#spells-body")?.addEventListener("click", (e) => {
        const id = e.target.dataset.delSpell; if (!id) return;
        BQDB.run("DELETE FROM enemySpells WHERE id=?", [Number(id)]); App.syncDirty(); show();
      });
      editor.querySelector("#loot-body")?.addEventListener("click", (e) => {
        const id = e.target.dataset.delLoot; if (!id) return;
        BQDB.run("DELETE FROM loot WHERE id=?", [Number(id)]); App.syncDirty(); show();
      });
      editor.querySelector("#btn-save-children").onclick = () => {
        editor.querySelectorAll("#spells-body tr").forEach((tr) => {
          const id = Number(tr.dataset.id);
          BQDB.run("UPDATE enemySpells SET Name=?, Value=?, Frequency=? WHERE id=?", [
            tr.querySelector('[data-k="Name"]').value,
            tr.querySelector('[data-k="Value"]').value,
            Number(tr.querySelector('[data-k="Frequency"]').value) || 0,
            id,
          ]);
        });
        editor.querySelectorAll("#loot-body tr").forEach((tr) => {
          const id = Number(tr.dataset.id);
          BQDB.run("UPDATE loot SET ItemID=?, Chance=?, Amount=?, AmountVariance=? WHERE id=?", [
            Number(tr.querySelector('[data-k="ItemID"]').value) || 0,
            Number(tr.querySelector('[data-k="Chance"]').value) || 0,
            Number(tr.querySelector('[data-k="Amount"]').value) || 0,
            Number(tr.querySelector('[data-k="AmountVariance"]').value) || 0,
            id,
          ]);
        });
        toast("Spells & loot saved"); App.syncDirty();
      };
    }
    if (state.sel != null) show();
  }

  // ——— LOOT (global) ———
  function renderLoot(ws, state) {
    const rows = BQDB.all(`SELECT l.id, l.EnemyID, l.ItemID, l.Chance, l.Amount, l.AmountVariance, e.Name AS EnemyName, i.Name AS ItemName
      FROM loot l LEFT JOIN enemies e ON e.id=l.EnemyID LEFT JOIN items i ON i.id=l.ItemID ORDER BY l.id`);
    ws.innerHTML = layout("Loot", `
      <input class="search" id="q" placeholder="Search loot…">
      <div class="side-actions"><button type="button" class="btn small" id="btn-new">New drop</button></div>`, noneSelected());
    const list = ws.querySelector("#entity-list");
    const editor = ws.querySelector("#entity-editor");
    const q = ws.querySelector("#q");
    function fillList() {
      const term = lower(q.value);
      list.innerHTML = rows.filter((r) => !term || lower(r.EnemyName).includes(term) || lower(r.ItemName).includes(term) || String(r.id)===term)
        .map((r) => `<button type="button" class="list-item ${state.sel===r.id?"active":""}" data-id="${r.id}"><span class="id">#${r.id}</span>${esc(r.EnemyName||r.EnemyID)} → ${esc(r.ItemName||r.ItemID)}<span class="meta">${esc(r.Chance)}% × ${esc(r.Amount)}±${esc(r.AmountVariance)}</span></button>`).join("") || `<div class="empty">No matches</div>`;
    }
    fillList(); q.oninput = fillList;
    list.onclick = (e) => { const b=e.target.closest("[data-id]"); if(!b)return; state.sel=Number(b.dataset.id); show(); fillList(); };
    ws.querySelector("#btn-new").onclick = () => {
      const id = BQDB.nextId("loot");
      const eid = BQDB.one("SELECT id FROM enemies ORDER BY id LIMIT 1")?.id || 1;
      BQDB.run("INSERT INTO loot (id, EnemyID, AmountVariance, Chance, ItemID, Amount) VALUES (?,?,?,?,?,?)", [id, eid, 0, 50, 1, 1]);
      state.sel = id; App.syncDirty(); Editors.render("loot", ws, state);
    };
    function show() {
      const r = BQDB.one("SELECT * FROM loot WHERE id=?", [state.sel]);
      if (!r) { editor.innerHTML = noneSelected(); return; }
      const enemies = BQDB.all("SELECT id, Name FROM enemies ORDER BY Name");
      editor.innerHTML = `<h2>Loot #${r.id}</h2>
        <form id="f" class="form-grid">
          ${field("EnemyID", "EnemyID", r.EnemyID, { type: "select", options: enemies.map((e)=>[e.id, `${e.id} · ${e.Name}`]) })}
          ${field("ItemID", "ItemID", r.ItemID, { type: "number" })}
          ${field("Chance", "Chance", r.Chance, { type: "number" })}
          ${field("Amount", "Amount", r.Amount, { type: "number" })}
          ${field("AmountVariance", "AmountVariance", r.AmountVariance, { type: "number" })}
        </form>
        <p class="note">Item: ${esc(BQDB.itemName(r.ItemID) || "missing")}</p>
        <div class="row-actions"><button type="button" class="btn primary" id="btn-save-row">Apply</button>
        <button type="button" class="btn danger" id="btn-del">Delete</button></div>`;
      editor.querySelector("#btn-save-row").onclick = () => {
        const d = getForm(editor.querySelector("#f"));
        BQDB.run("UPDATE loot SET EnemyID=?, ItemID=?, Chance=?, Amount=?, AmountVariance=? WHERE id=?",
          [Number(d.EnemyID), Number(d.ItemID), Number(d.Chance)||0, Number(d.Amount)||0, Number(d.AmountVariance)||0, r.id]);
        toast("Loot saved"); App.syncDirty(); Editors.render("loot", ws, state);
      };
      editor.querySelector("#btn-del").onclick = () => {
        BQDB.run("DELETE FROM loot WHERE id=?", [r.id]); state.sel=null; App.syncDirty(); Editors.render("loot", ws, state);
      };
    }
    if (state.sel != null) show();
  }

  // ——— NPCS ———
  function renderNpcs(ws, state) {
    const rows = BQDB.all("SELECT id, Name, Faction, Conversation, SpawnX, SpawnY FROM npc ORDER BY id");
    ws.innerHTML = layout("NPCs", `
      <input class="search" id="q" placeholder="Search NPCs…">
      <div class="side-actions"><button type="button" class="btn small" id="btn-new">New NPC</button></div>`, noneSelected("NPC id 0 exists — append new ids."));
    const list = ws.querySelector("#entity-list");
    const editor = ws.querySelector("#entity-editor");
    const q = ws.querySelector("#q");
    function fillList() {
      const term = lower(q.value);
      list.innerHTML = rows.filter((r)=>!term||lower(r.Name).includes(term)||lower(r.Conversation).includes(term)||String(r.id)===term)
        .map((r)=>`<button type="button" class="list-item ${state.sel===r.id?"active":""}" data-id="${r.id}"><span class="id">#${r.id}</span>${esc(r.Name)}<span class="meta">${esc(r.Faction||"—")} · ${esc(r.Conversation||"no dialogue")} @ ${esc(r.SpawnX)},${esc(r.SpawnY)}</span></button>`).join("")||`<div class="empty">No matches</div>`;
    }
    fillList(); q.oninput=fillList;
    list.onclick=(e)=>{const b=e.target.closest("[data-id]");if(!b)return;state.sel=Number(b.dataset.id);show();fillList();};
    ws.querySelector("#btn-new").onclick=()=>{
      const id=BQDB.nextId("npc");
      BQDB.run("INSERT INTO npc (id, Name, ImgPath, Faction, Conversation, SpawnX, SpawnY) VALUES (?,?,?,?,?,?,?)",
        [id,"New NPC","","","","0","0"]);
      state.sel=id; toast(`Created NPC #${id}`); App.syncDirty(); Editors.render("npcs", ws, state);
    };
    function show(){
      const r=BQDB.one("SELECT * FROM npc WHERE id=?",[state.sel]);
      if(!r){editor.innerHTML=noneSelected();return;}
      const startOk = !r.Conversation || BQDB.hasIdentifier(r.Conversation);
      const routines = BQDB.all("SELECT * FROM routine WHERE NPC=? ORDER BY id",[r.id]);
      editor.innerHTML=`<h2>${esc(r.Name)}</h2><p class="sub">id ${r.id}</p>
        <form id="f" class="form-grid">
          ${field("Name","Name",r.Name)}
          ${field("Faction","Faction",r.Faction)}
          ${field("Conversation","Conversation",r.Conversation)}
          ${field("SpawnX","SpawnX",r.SpawnX,{type:"number"})}
          ${field("SpawnY","SpawnY",r.SpawnY,{type:"number"})}
          ${field("ImgPath","ImgPath",r.ImgPath,{full:true})}
        </form>
        <p class="note ${startOk?"":"err"}">Conversation must be a starting Identifier (e.g. npc-priest-1). ${startOk?"✓ resolves":"✗ missing Identifier"}</p>
        <div class="row-actions"><button type="button" class="btn primary" id="btn-save-row">Apply</button>
        <button type="button" class="btn danger" id="btn-del">Delete</button></div>
        <h3>Routines</h3>
        <div class="table-wrap"><table class="mini"><thead><tr><th>id</th><th>TriggerHour</th><th>Loop</th><th>Nodes</th><th></th></tr></thead>
        <tbody>${routines.map((rt)=>{
          const nodes=BQDB.all("SELECT * FROM routineNode WHERE Routine=? ORDER BY Position",[rt.id]);
          return `<tr><td>${rt.id}</td><td>${rt.TriggerHour}</td><td>${rt.Loop}</td><td>${nodes.map(n=>`${n.X},${n.Y}`).join(" → ")||"—"}</td>
            <td><button type="button" class="btn small" data-edit-rt="${rt.id}">Edit</button></td></tr>`;
        }).join("")}</tbody></table></div>
        <button type="button" class="btn small" id="add-rt">Add routine</button>
        <div id="rt-editor"></div>`;
      editor.querySelector("#btn-save-row").onclick=()=>{
        const d=getForm(editor.querySelector("#f"));
        const conv=d.Conversation??"";
        if(conv && !BQDB.hasIdentifier(conv) && !confirm(`Identifier "${conv}" not found. Save anyway?`)) return;
        BQDB.run("UPDATE npc SET Name=?, ImgPath=?, Faction=?, Conversation=?, SpawnX=?, SpawnY=? WHERE id=?",
          [d.Name,d.ImgPath??"",d.Faction??"",conv,Number(d.SpawnX)||0,Number(d.SpawnY)||0,r.id]);
        toast("NPC saved"); App.syncDirty(); Editors.render("npcs", ws, state);
      };
      editor.querySelector("#btn-del").onclick=()=>{
        if(!confirm(`Delete NPC #${r.id}?`))return;
        const rts=BQDB.all("SELECT id FROM routine WHERE NPC=?",[r.id]);
        for(const rt of rts){ BQDB.run("DELETE FROM routineNode WHERE Routine=?",[rt.id]); BQDB.run("DELETE FROM routine WHERE id=?",[rt.id]); }
        BQDB.run("DELETE FROM npc WHERE id=?",[r.id]); state.sel=null; App.syncDirty(); Editors.render("npcs", ws, state);
      };
      editor.querySelector("#add-rt").onclick=()=>{
        const id=BQDB.nextId("routine");
        BQDB.run("INSERT INTO routine (id, NPC, TriggerHour, Loop) VALUES (?,?,?,?)",[id,r.id,0,1]);
        App.syncDirty(); show();
      };
      editor.querySelectorAll("[data-edit-rt]").forEach((btn)=>{
        btn.onclick=()=>editRoutine(Number(btn.dataset.editRt));
      });
      function editRoutine(rtId){
        const rt=BQDB.one("SELECT * FROM routine WHERE id=?",[rtId]);
        const nodes=BQDB.all("SELECT * FROM routineNode WHERE Routine=? ORDER BY Position",[rtId]);
        const box=editor.querySelector("#rt-editor");
        box.innerHTML=`<h4>Routine #${rtId}</h4>
          <form id="rtf" class="form-grid">${field("TriggerHour","TriggerHour",rt.TriggerHour,{type:"number"})}${field("Loop","Loop",rt.Loop,{type:"number"})}</form>
          <div class="table-wrap"><table class="mini"><thead><tr><th>Pos</th><th>X</th><th>Y</th><th></th></tr></thead>
          <tbody id="rt-nodes">${nodes.map(n=>`<tr data-id="${n.id}"><td>${n.Position}</td>
            <td><input class="num" data-k="X" type="number" value="${n.X}"></td>
            <td><input class="num" data-k="Y" type="number" value="${n.Y}"></td>
            <td><button type="button" class="btn small danger" data-del-node="${n.id}">×</button></td></tr>`).join("")}</tbody></table></div>
          <button type="button" class="btn small" id="add-node">Add node</button>
          <button type="button" class="btn primary small" id="save-rt">Apply routine</button>
          <button type="button" class="btn danger small" id="del-rt">Delete routine</button>`;
        box.querySelector("#add-node").onclick=()=>{
          const id=BQDB.nextId("routineNode");
          const pos=(nodes[nodes.length-1]?.Position??-1)+1;
          BQDB.run("INSERT INTO routineNode (id, Routine, X, Y, Position) VALUES (?,?,?,?,?)",[id,rtId,0,0,pos]);
          App.syncDirty(); editRoutine(rtId);
        };
        box.querySelector("#save-rt").onclick=()=>{
          const d=getForm(box.querySelector("#rtf"));
          BQDB.run("UPDATE routine SET TriggerHour=?, Loop=? WHERE id=?",[Number(d.TriggerHour)||0,Number(d.Loop)||0,rtId]);
          box.querySelectorAll("#rt-nodes tr").forEach((tr)=>{
            BQDB.run("UPDATE routineNode SET X=?, Y=? WHERE id=?",[
              Number(tr.querySelector('[data-k="X"]').value)||0,
              Number(tr.querySelector('[data-k="Y"]').value)||0,
              Number(tr.dataset.id)]);
          });
          toast("Routine saved"); App.syncDirty(); show();
        };
        box.querySelector("#del-rt").onclick=()=>{
          BQDB.run("DELETE FROM routineNode WHERE Routine=?",[rtId]);
          BQDB.run("DELETE FROM routine WHERE id=?",[rtId]);
          App.syncDirty(); show();
        };
        box.querySelector("#rt-nodes")?.addEventListener("click",(e)=>{
          const id=e.target.dataset.delNode; if(!id)return;
          BQDB.run("DELETE FROM routineNode WHERE id=?",[Number(id)]); App.syncDirty(); editRoutine(rtId);
        });
      }
    }
    if(state.sel!=null) show();
  }

  // ——— QUESTS ———
  function renderQuests(ws, state) {
    const rows = BQDB.all("SELECT id, Title, Type, Value FROM quest ORDER BY id");
    ws.innerHTML = layout("Quests", `
      <input class="search" id="q" placeholder="Search quests…">
      <div class="side-actions"><button type="button" class="btn small" id="btn-new">New quest</button></div>`, noneSelected());
    const list=ws.querySelector("#entity-list"); const editor=ws.querySelector("#entity-editor"); const q=ws.querySelector("#q");
    function fillList(){const term=lower(q.value);list.innerHTML=rows.filter(r=>!term||lower(r.Title).includes(term)||String(r.id)===term)
      .map(r=>`<button type="button" class="list-item ${state.sel===r.id?"active":""}" data-id="${r.id}"><span class="id">#${r.id}</span>${esc(r.Title)}<span class="meta">${esc(r.Type)} · ${esc(r.Value)}</span></button>`).join("")||`<div class="empty">No matches</div>`;}
    fillList(); q.oninput=fillList;
    list.onclick=(e)=>{const b=e.target.closest("[data-id]");if(!b)return;state.sel=Number(b.dataset.id);show();fillList();};
    ws.querySelector("#btn-new").onclick=()=>{
      const id=BQDB.nextId("quest");
      BQDB.run(`INSERT INTO quest (id, Title, Desc, ImgPath, Type, Value, ValueRequired, XP, ItemsGiven, ConversationTrigger, ReturnNPCID, ReturnNPCName, EndConversation, RequireReturn, X, Y, GiverNPCID)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,"New Quest","","","kill","",1,0,"[]","","0","","",0,0,0,0]);
      state.sel=id; App.syncDirty(); Editors.render("quests", ws, state);
    };
    function show(){
      const r=BQDB.one("SELECT * FROM quest WHERE id=?",[state.sel]);
      if(!r){editor.innerHTML=noneSelected();return;}
      const items=BQOptions.parseItemsGiven(r.ItemsGiven);
      let valueWarn="";
      if(r.Type==="kill" && r.Value && !BQDB.enemyIdByName(r.Value)) valueWarn=`Unknown enemy Name "${r.Value}"`;
      if(r.Type==="gather" && r.Value && !BQDB.itemIdByName(r.Value)) valueWarn=`Unknown item Name "${r.Value}"`;
      editor.innerHTML=`<h2>${esc(r.Title)}</h2><p class="sub">id ${r.id}</p>
        <form id="f" class="form-grid">
          ${field("Title","Title",r.Title, {full:true})}
          ${field("Desc","Desc",r.Desc,{type:"textarea",full:true})}
          ${field("Type","Type",r.Type,{type:"select",options:QUEST_TYPES})}
          ${field("Value","Value",r.Value)}
          ${field("ValueRequired","ValueRequired",r.ValueRequired,{type:"number"})}
          ${field("XP","XP",r.XP,{type:"number"})}
          ${field("GiverNPCID","GiverNPCID",r.GiverNPCID??0,{type:"number"})}
          ${field("ReturnNPCID","ReturnNPCID",r.ReturnNPCID,{type:"number"})}
          ${field("ReturnNPCName","ReturnNPCName",r.ReturnNPCName)}
          ${field("RequireReturn","RequireReturn",r.RequireReturn,{type:"checkbox"})}
          ${field("ConversationTrigger","ConversationTrigger",r.ConversationTrigger)}
          ${field("EndConversation","EndConversation",r.EndConversation)}
          ${field("X","X",r.X,{type:"number"})}
          ${field("Y","Y",r.Y,{type:"number"})}
          ${field("ImgPath","ImgPath",r.ImgPath,{full:true})}
        </form>
        ${itemsGivenEditor(items, "Quest rewards ItemsGiven (JSON).")}
        <p class="note ${valueWarn?"err":""}">Type kill → Value = enemy Name; gather → item Name; go → within 4 tiles of X,Y. ${esc(valueWarn)}</p>
        <div class="row-actions"><button type="button" class="btn primary" id="btn-save-row">Apply</button>
        <button type="button" class="btn danger" id="btn-del">Delete</button></div>`;
      wireItemsGiven(editor);
      editor.querySelector("#btn-save-row").onclick=()=>{
        const d=getForm(editor.querySelector("#f"));
        const ig=BQOptions.serializeItemsGivenOrEmpty(readItemsGiven(editor),"[]");
        BQDB.run(`UPDATE quest SET Title=?, Desc=?, ImgPath=?, Type=?, Value=?, ValueRequired=?, XP=?, ItemsGiven=?, ConversationTrigger=?, ReturnNPCID=?, ReturnNPCName=?, EndConversation=?, RequireReturn=?, X=?, Y=?, GiverNPCID=? WHERE id=?`,
          [d.Title,d.Desc??"",d.ImgPath??"",d.Type,d.Value??"",Number(d.ValueRequired)||0,Number(d.XP)||0,ig,d.ConversationTrigger??"",Number(d.ReturnNPCID)||0,d.ReturnNPCName??"",d.EndConversation??"",d.RequireReturn?1:0,Number(d.X)||0,Number(d.Y)||0,Number(d.GiverNPCID)||0,r.id]);
        toast("Quest saved"); App.syncDirty(); Editors.render("quests", ws, state);
      };
      editor.querySelector("#btn-del").onclick=()=>{
        if(!confirm(`Delete quest #${r.id}?`))return;
        BQDB.run("DELETE FROM quest WHERE id=?",[r.id]); state.sel=null; App.syncDirty(); Editors.render("quests", ws, state);
      };
    }
    if(state.sel!=null) show();
  }

  // ——— CRAFT ———
  function renderCraft(ws, state) {
    const rows = BQDB.all("SELECT c.id, c.ItemID, c.Chance, c.Items, i.Name AS ItemName FROM craft c LEFT JOIN items i ON i.id=c.ItemID ORDER BY c.id");
    ws.innerHTML = layout("Craft", `
      <input class="search" id="q" placeholder="Search recipes…">
      <div class="side-actions"><button type="button" class="btn small" id="btn-new">New recipe</button></div>`, noneSelected());
    const list=ws.querySelector("#entity-list"); const editor=ws.querySelector("#entity-editor"); const q=ws.querySelector("#q");
    function fillList(){const term=lower(q.value);list.innerHTML=rows.filter(r=>!term||lower(r.ItemName).includes(term)||String(r.id)===term||String(r.ItemID)===term)
      .map(r=>`<button type="button" class="list-item ${state.sel===r.id?"active":""}" data-id="${r.id}"><span class="id">#${r.id}</span>${esc(r.ItemName||r.ItemID)}<span class="meta">${esc(r.Chance)}% chance</span></button>`).join("")||`<div class="empty">No matches</div>`;}
    fillList(); q.oninput=fillList;
    list.onclick=(e)=>{const b=e.target.closest("[data-id]");if(!b)return;state.sel=Number(b.dataset.id);show();fillList();};
    ws.querySelector("#btn-new").onclick=()=>{
      const id=BQDB.nextId("craft");
      BQDB.run("INSERT INTO craft (id, ItemID, Items, Chance) VALUES (?,?,?,?)",[id,1,"[]",100]);
      state.sel=id; App.syncDirty(); Editors.render("craft", ws, state);
    };
    function show(){
      const r=BQDB.one("SELECT * FROM craft WHERE id=?",[state.sel]);
      if(!r){editor.innerHTML=noneSelected();return;}
      let ingredients=[];
      try{ingredients=JSON.parse(r.Items||"[]");}catch{ingredients=[];}
      editor.innerHTML=`<h2>Recipe #${r.id}</h2><p class="sub">Result: ${esc(BQDB.itemName(r.ItemID)||r.ItemID)}</p>
        <form id="f" class="form-grid">
          ${field("Result ItemID","ItemID",r.ItemID,{type:"number"})}
          ${field("Chance","Chance",r.Chance,{type:"number"})}
        </form>
        ${itemsGivenEditor(ingredients.map(o=>({ItemID:o.ItemID,Amount:o.Amount})), "Ingredients JSON [{ItemID,Amount}].")}
        <div class="row-actions"><button type="button" class="btn primary" id="btn-save-row">Apply</button>
        <button type="button" class="btn danger" id="btn-del">Delete</button></div>`;
      wireItemsGiven(editor);
      editor.querySelector("#btn-save-row").onclick=()=>{
        const d=getForm(editor.querySelector("#f"));
        const items=JSON.stringify(readItemsGiven(editor).map(o=>({ItemID:o.ItemID,Amount:o.Amount})));
        BQDB.run("UPDATE craft SET ItemID=?, Items=?, Chance=? WHERE id=?",[Number(d.ItemID),items,Number(d.Chance)||0,r.id]);
        toast("Recipe saved"); App.syncDirty(); Editors.render("craft", ws, state);
      };
      editor.querySelector("#btn-del").onclick=()=>{BQDB.run("DELETE FROM craft WHERE id=?",[r.id]);state.sel=null;App.syncDirty();Editors.render("craft",ws,state);};
    }
    if(state.sel!=null) show();
  }

  // ——— FORGE ———
  function renderForge(ws, state) {
    const rows = BQDB.all("SELECT * FROM forge ORDER BY id");
    ws.innerHTML = layout("Forge", `
      <div class="side-actions"><button type="button" class="btn small" id="btn-new">New forge rule</button></div>`, noneSelected());
    const list=ws.querySelector("#entity-list"); const editor=ws.querySelector("#entity-editor");
    function fillList(){
      list.innerHTML=rows.map(r=>{
        const a=BQDB.itemName(r.EnterID)||r.EnterID; const b=BQDB.itemName(r.ResultID)||r.ResultID;
        return `<button type="button" class="list-item ${state.sel===r.id?"active":""}" data-id="${r.id}"><span class="id">#${r.id}</span>${esc(a)} → ${esc(b)}</button>`;
      }).join("")||`<div class="empty">No forge rules</div>`;
    }
    fillList();
    list.onclick=(e)=>{const b=e.target.closest("[data-id]");if(!b)return;state.sel=Number(b.dataset.id);show();fillList();};
    ws.querySelector("#btn-new").onclick=()=>{
      const id=BQDB.nextId("forge");
      BQDB.run("INSERT INTO forge (id, EnterID, ResultID) VALUES (?,?,?)",[id,1,1]);
      state.sel=id; App.syncDirty(); Editors.render("forge", ws, state);
    };
    function show(){
      const r=BQDB.one("SELECT * FROM forge WHERE id=?",[state.sel]);
      if(!r){editor.innerHTML=noneSelected();return;}
      editor.innerHTML=`<h2>Forge #${r.id}</h2>
        <form id="f" class="form-grid">
          ${field("EnterID","EnterID",r.EnterID,{type:"number"})}
          ${field("ResultID","ResultID",r.ResultID,{type:"number"})}
        </form>
        <p class="note">${esc(BQDB.itemName(r.EnterID)||"?")} → ${esc(BQDB.itemName(r.ResultID)||"?")}</p>
        <div class="row-actions"><button type="button" class="btn primary" id="btn-save-row">Apply</button>
        <button type="button" class="btn danger" id="btn-del">Delete</button></div>`;
      editor.querySelector("#btn-save-row").onclick=()=>{
        const d=getForm(editor.querySelector("#f"));
        BQDB.run("UPDATE forge SET EnterID=?, ResultID=? WHERE id=?",[Number(d.EnterID),Number(d.ResultID),r.id]);
        toast("Forge rule saved"); App.syncDirty(); Editors.render("forge", ws, state);
      };
      editor.querySelector("#btn-del").onclick=()=>{BQDB.run("DELETE FROM forge WHERE id=?",[r.id]);state.sel=null;App.syncDirty();Editors.render("forge",ws,state);};
    }
    if(state.sel!=null) show();
  }

  const map = {
    items: renderItems,
    enemies: renderEnemies,
    loot: renderLoot,
    npcs: renderNpcs,
    quests: renderQuests,
    craft: renderCraft,
    forge: renderForge,
  };

  function render(tab, ws, state) {
    const fn = map[tab];
    if (fn) fn(ws, state);
  }

  return { render, toast, esc, field, getForm, ITEM_TYPES, ITEM_SUBTYPES, QUEST_TYPES };
})();
