"use strict";

const DialogueEditor = (() => {
  const esc = Editors.esc;

  function treePrefix(ident) {
    const s = String(ident || "");
    const m = s.match(/^(.*?)(?:-\d+)?$/);
    // Group by stem before final -N if present, else whole string prefix up to last -
    const parts = s.split("-");
    if (parts.length <= 1) return s || "other";
    // npc-priest-1 → npc-priest; skeleton-guard-1 → skeleton-guard
    return parts.slice(0, -1).join("-") || s;
  }

  function render(ws, state) {
    const rows = BQDB.all("SELECT id, Identifier, Title, Options, ReputationChange, ItemsGiven, QuestStart FROM conversation ORDER BY Identifier");
    const groups = new Map();
    for (const r of rows) {
      const g = treePrefix(r.Identifier);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }

    ws.innerHTML = `<div class="dlg-layout">
      <div>
        <div class="side-head" style="padding:0 0 8px;border:0">
          <h2>Dialogue</h2>
          <input class="search" id="q" placeholder="Search identifiers…">
          <div class="side-actions">
            <button type="button" class="btn small" id="btn-new">New node</button>
          </div>
        </div>
        <div class="tree-list" id="tree-list"></div>
      </div>
      <div>
        <div class="graph" id="graph"><div class="graph-inner" id="graph-inner"></div></div>
        <div class="editor" id="node-editor" style="margin-top:12px">${Editors ? "" : ""}</div>
      </div>
    </div>`;

    const treeList = ws.querySelector("#tree-list");
    const graphInner = ws.querySelector("#graph-inner");
    const nodeEditor = ws.querySelector("#node-editor");
    const q = ws.querySelector("#q");

    if (!state.group) state.group = [...groups.keys()][0] || null;

    function fillTree() {
      const term = String(q.value || "").toLocaleLowerCase("en-GB");
      let html = "";
      for (const [g, nodes] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const filtered = nodes.filter((n) => !term || n.Identifier.toLocaleLowerCase("en-GB").includes(term) || String(n.Title || "").toLocaleLowerCase("en-GB").includes(term));
        if (!filtered.length) continue;
        html += `<details class="tree-group" ${state.group === g ? "open" : ""}><summary>${esc(g)} <span class="pill">${filtered.length}</span></summary><ul>`;
        for (const n of filtered) {
          html += `<li><button type="button" class="${state.sel === n.id ? "active" : ""}" data-id="${n.id}" data-group="${esc(g)}"><code>${esc(n.Identifier)}</code></button></li>`;
        }
        html += `</ul></details>`;
      }
      treeList.innerHTML = html || `<div class="empty">No conversations</div>`;
    }

    function layoutGraph(groupNodes) {
      // Simple layered layout by BFS from roots (idents not targeted by others in group, or matching NPC starts)
      const byIdent = new Map(groupNodes.map((n) => [n.Identifier, n]));
      const targets = new Set();
      for (const n of groupNodes) {
        for (const [, next] of BQOptions.parse(n.Options)) {
          if (next !== "1" && next !== "0") targets.add(next);
        }
      }
      const roots = groupNodes.filter((n) => !targets.has(n.Identifier));
      const start = roots.length ? roots : groupNodes.slice(0, 1);
      const depth = new Map();
      const queue = start.map((n) => { depth.set(n.Identifier, 0); return n.Identifier; });
      while (queue.length) {
        const id = queue.shift();
        const node = byIdent.get(id);
        if (!node) continue;
        const d = depth.get(id) || 0;
        for (const [, next] of BQOptions.parse(node.Options)) {
          if (next === "1" || next === "0" || !byIdent.has(next)) continue;
          if (!depth.has(next)) { depth.set(next, d + 1); queue.push(next); }
        }
      }
      for (const n of groupNodes) if (!depth.has(n.Identifier)) depth.set(n.Identifier, 0);
      const cols = new Map();
      for (const n of groupNodes) {
        const d = depth.get(n.Identifier) || 0;
        if (!cols.has(d)) cols.set(d, []);
        cols.get(d).push(n);
      }
      const positions = new Map();
      let maxX = 0, maxY = 0;
      for (const [d, list] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
        list.forEach((n, i) => {
          const x = 40 + d * 260;
          const y = 30 + i * 120;
          positions.set(n.Identifier, { x, y, n });
          maxX = Math.max(maxX, x + 240);
          maxY = Math.max(maxY, y + 110);
        });
      }
      return { positions, maxX, maxY };
    }

    function drawGraph() {
      const groupNodes = groups.get(state.group) || [];
      const { positions, maxX, maxY } = layoutGraph(groupNodes);
      graphInner.style.width = Math.max(900, maxX) + "px";
      graphInner.style.height = Math.max(500, maxY) + "px";
      let svg = `<svg class="edges" width="${Math.max(900, maxX)}" height="${Math.max(500, maxY)}">`;
      for (const n of groupNodes) {
        const from = positions.get(n.Identifier);
        if (!from) continue;
        for (const [label, next] of BQOptions.parse(n.Options)) {
          const to = positions.get(next);
          if (!to) continue;
          const x1 = from.x + 220, y1 = from.y + 40, x2 = to.x, y2 = to.y + 40;
          svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3d4f63" stroke-width="2" marker-end="url(#arrow)"/>`;
        }
      }
      svg += `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#3d4f63"/></marker></defs></svg>`;
      let cards = "";
      for (const n of groupNodes) {
        const p = positions.get(n.Identifier);
        if (!p) continue;
        const opts = BQOptions.parse(n.Options);
        cards += `<div class="node-card ${state.sel === n.id ? "active" : ""}" data-id="${n.id}" style="left:${p.x}px;top:${p.y}px">
          <div class="nid">${esc(n.Identifier)}</div>
          <div class="ntitle">${esc(n.Title || "")}</div>
          <div class="nopts">${opts.map(([t, nx]) => `${esc(t)} → <code>${esc(nx)}</code>`).join("<br>") || "—"}</div>
        </div>`;
      }
      graphInner.innerHTML = svg + cards;
    }

    function showNode() {
      const r = BQDB.one("SELECT * FROM conversation WHERE id=?", [state.sel]);
      if (!r) {
        nodeEditor.innerHTML = `<div class="empty">Select a dialogue node.</div>`;
        return;
      }
      const opts = BQOptions.parse(r.Options);
      const items = BQOptions.parseItemsGiven(r.ItemsGiven);
      const warns = BQOptions.validate(r.Options);
      const optRows = opts.map(([t, n], i) => `
        <div class="opt-row" data-i="${i}">
          <input data-k="label" value="${esc(t)}" placeholder="Label">
          <input data-k="next" value="${esc(n)}" placeholder="next Identifier or 1">
          <button type="button" class="btn small danger" data-rm-opt="${i}">×</button>
        </div>`).join("");
      nodeEditor.innerHTML = `<h2>${esc(r.Identifier)}</h2><p class="sub">conversation id ${r.id}</p>
        <form id="f" class="form-grid">
          ${Editors.field("Identifier", "Identifier", r.Identifier)}
          ${Editors.field("ReputationChange", "ReputationChange", r.ReputationChange ?? "0")}
          ${Editors.field("QuestStart", "QuestStart", r.QuestStart ?? "", { type: "number" })}
          ${Editors.field("ImgPath", "ImgPath", r.ImgPath)}
          ${Editors.field("Title", "Title", r.Title, { type: "textarea", full: true })}
        </form>
        <h3>Options</h3>
        <p class="note">Format emitted: <code>[['label','next'],...]</code>. Use <code>1</code> to end. Straight apostrophes/quotes in labels become curly on save.</p>
        <div id="opt-rows">${optRows}</div>
        <button type="button" class="btn small" id="add-opt">Add option</button>
        ${warns.map((w) => `<p class="note warn">${esc(w)}</p>`).join("")}
        <h3>ItemsGiven</h3>
        <div id="ig">${""}</div>
        <div class="row-actions">
          <button type="button" class="btn primary" id="btn-save-row">Apply</button>
          <button type="button" class="btn danger" id="btn-del">Delete</button>
        </div>`;
      // inject items given
      const igHost = nodeEditor.querySelector("#ig");
      igHost.innerHTML = `<div class="table-wrap"><table class="mini"><thead><tr><th>ItemID</th><th>Amount</th><th></th></tr></thead>
        <tbody id="items-given-body">${items.map((it) => `<tr><td><input class="num" data-k="ItemID" type="number" value="${esc(it.ItemID)}"></td>
          <td><input class="num" data-k="Amount" type="number" value="${esc(it.Amount)}"></td>
          <td><button type="button" class="btn small danger" data-rm>×</button></td></tr>`).join("")}</tbody></table></div>
        <button type="button" class="btn small" id="items-given-add">Add item</button>`;
      // wire opts
      nodeEditor.querySelector("#add-opt").onclick = () => {
        nodeEditor.querySelector("#opt-rows").insertAdjacentHTML("beforeend", `
          <div class="opt-row"><input data-k="label" value="Okay" placeholder="Label">
          <input data-k="next" value="1" placeholder="next"><button type="button" class="btn small danger" data-rm-opt>×</button></div>`);
      };
      nodeEditor.querySelector("#opt-rows").addEventListener("click", (e) => {
        const b = e.target.closest("[data-rm-opt]");
        if (b) b.closest(".opt-row").remove();
      });
      igHost.querySelector("#items-given-add").onclick = () => {
        igHost.querySelector("#items-given-body").insertAdjacentHTML("beforeend",
          `<tr><td><input class="num" data-k="ItemID" type="number" value=""></td><td><input class="num" data-k="Amount" type="number" value="1"></td><td><button type="button" class="btn small danger" data-rm>×</button></td></tr>`);
      };
      igHost.querySelector("#items-given-body").addEventListener("click", (e) => {
        const b = e.target.closest("[data-rm]"); if (b) b.closest("tr").remove();
      });

      nodeEditor.querySelector("#btn-save-row").onclick = () => {
        const d = Editors.getForm(nodeEditor.querySelector("#f"));
        const pairs = [...nodeEditor.querySelectorAll("#opt-rows .opt-row")].map((row) => [
          row.querySelector('[data-k="label"]').value,
          row.querySelector('[data-k="next"]').value || "1",
        ]);
        const options = BQOptions.serialize(pairs);
        const igList = [];
        igHost.querySelectorAll("#items-given-body tr").forEach((tr) => {
          const ItemID = Number(tr.querySelector('[data-k="ItemID"]').value);
          const Amount = Number(tr.querySelector('[data-k="Amount"]').value);
          if (Number.isFinite(ItemID)) igList.push({ ItemID, Amount: Number.isFinite(Amount) ? Amount : 0 });
        });
        const itemsGiven = BQOptions.serializeItemsGivenOrEmpty(igList, "");
        const oldIdent = r.Identifier;
        const newIdent = d.Identifier;
        if (newIdent !== oldIdent) {
          // refactor references
          const npcRefs = BQDB.all("SELECT COUNT(*) AS c FROM npc WHERE Conversation=?", [oldIdent])[0]?.c || 0;
          const questTrig = BQDB.all("SELECT COUNT(*) AS c FROM quest WHERE ConversationTrigger=? OR EndConversation=?", [oldIdent, oldIdent]);
          const qt = (questTrig[0]?.c) || 0;
          // option targets pointing here
          let optRefs = 0;
          for (const c of BQDB.all("SELECT id, Options FROM conversation WHERE id!=?", [r.id])) {
            for (const [, next] of BQOptions.parse(c.Options)) if (next === oldIdent) optRefs++;
          }
          if (npcRefs || qt || optRefs) {
            if (!confirm(`Rename Identifier "${oldIdent}" → "${newIdent}"?\nWill update ${npcRefs} NPC starts, ${qt} quest trigger/end fields, and rewrite option targets.`)) return;
          }
        }
        const qs = d.QuestStart === "" || d.QuestStart == null ? null : Number(d.QuestStart);
        BQDB.run(`UPDATE conversation SET Identifier=?, Title=?, ImgPath=?, Options=?, ReputationChange=?, ItemsGiven=?, QuestStart=? WHERE id=?`,
          [newIdent, d.Title ?? "", d.ImgPath ?? "", options, d.ReputationChange ?? "0", itemsGiven, qs, r.id]);
        if (newIdent !== oldIdent) {
          BQDB.run("UPDATE npc SET Conversation=? WHERE Conversation=?", [newIdent, oldIdent]);
          BQDB.run("UPDATE quest SET ConversationTrigger=? WHERE ConversationTrigger=?", [newIdent, oldIdent]);
          BQDB.run("UPDATE quest SET EndConversation=? WHERE EndConversation=?", [newIdent, oldIdent]);
          for (const c of BQDB.all("SELECT id, Options FROM conversation WHERE id!=?", [r.id])) {
            const pairs2 = BQOptions.parse(c.Options).map(([lab, next]) => [lab, next === oldIdent ? newIdent : next]);
            const ser = BQOptions.serialize(pairs2);
            if (ser !== c.Options) BQDB.run("UPDATE conversation SET Options=? WHERE id=?", [ser, c.id]);
          }
        }
        Editors.toast("Dialogue node saved");
        App.syncDirty();
        DialogueEditor.render(ws, state);
      };
      nodeEditor.querySelector("#btn-del").onclick = () => {
        if (!confirm(`Delete conversation ${r.Identifier}?`)) return;
        BQDB.run("DELETE FROM conversation WHERE id=?", [r.id]);
        state.sel = null;
        App.syncDirty();
        DialogueEditor.render(ws, state);
      };
    }

    fillTree();
    drawGraph();
    showNode();

    q.oninput = fillTree;
    treeList.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (!b) return;
      state.sel = Number(b.dataset.id);
      state.group = b.dataset.group;
      fillTree(); drawGraph(); showNode();
    });
    graphInner.addEventListener("click", (e) => {
      const card = e.target.closest("[data-id]");
      if (!card) return;
      state.sel = Number(card.dataset.id);
      fillTree(); drawGraph(); showNode();
    });
    ws.querySelector("#btn-new").onclick = () => {
      const id = BQDB.nextId("conversation");
      const base = state.group || "new-dialogue";
      let ident = `${base}-new`;
      let n = 1;
      while (BQDB.hasIdentifier(ident)) { ident = `${base}-new-${n++}`; }
      BQDB.run(`INSERT INTO conversation (id, Identifier, Title, ImgPath, Options, ReputationChange, ItemsGiven, QuestStart) VALUES (?,?,?,?,?,?,?,?)`,
        [id, ident, "New dialogue line", "", "[['Okay','1']]", "0", "", null]);
      state.sel = id;
      state.group = treePrefix(ident);
      Editors.toast(`Created ${ident}`);
      App.syncDirty();
      DialogueEditor.render(ws, state);
    };
  }

  return { render, treePrefix };
})();
