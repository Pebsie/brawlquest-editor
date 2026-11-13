"use strict";
// Sets and vendors tab: the item extra tables as plain editable rows.
// item_ext (sell price, junk, set, rarity per item), item_set and its tier
// bonuses, and vendors (which NPC buys what). The API (lore_items.go) reads
// them; a db without them works exactly as before. Tables are created on the
// first save, and Export SQL carries the same statements.

const LORE_SECTIONS = [
  { t: "item_set", title: "Gear sets", help: "A set groups items by SetID (item_ext). Name and a short description." },
  { t: "item_set_bonus", title: "Set bonuses", help: "Pieces worn needed, and the bonus as stat,amount;stat,amount (STR, STA, DEF, HP, MOVE ...). Each tier adds to the one before." },
  { t: "item_ext", title: "Item extras", help: "ItemID, Sell (gold; 0 = worked out from level and rarity), Junk 1 = grey vendor trash, SetID, Rarity 0 junk, 1 common, 2 uncommon, 3 rare, 4 epic, 5 legendary." },
  { t: "npc_vendor", title: "Vendors", help: "An NPC who buys things. BuyPct of the usual price; Buys lists what they take (empty = anything sellable: gear, junk, reagent, food)." },
];

async function renderLore(m) {
  const data = await api("loreTables");
  const main = h("div", { class: "form", style: "max-width:1100px;margin:0 auto;padding:12px 16px" },
    h("h2", {}, "Gear sets, junk and vendors"),
    h("p", { class: "hint" }, "These are separate tables, so they can be removed by dropping them (content/migrations/2026-11-10-item-ext.rollback.sql lists the DROPs). Edit a row, then Save row."));
  for (const sec of LORE_SECTIONS) main.append(loreSection(sec, data[sec.t]));
  m.append(main);
}

function loreSection(sec, d) {
  const box = h("div", { style: "margin:18px 0" }, h("h3", {}, `${sec.title} `, h("span", { class: "hint" }, d.exists ? `${d.rows.length} row(s)` : "not in this db yet")), h("p", { class: "hint" }, sec.help));
  const cols = d.exists ? d.cols : ({ item_set: ["id", "Name", "Desc"], item_set_bonus: ["id", "SetID", "Pieces", "Attributes", "Desc"], item_ext: ["ItemID", "Sell", "Junk", "SetID", "Rarity"],
    npc_vendor: ["NPC", "BuyPct", "Greeting", "Buys"], })[sec.t];
  const names = row => {
    if (sec.t === "item_ext") { const it = S.itemBy[row.ItemID]; return it ? it.Name : ""; }
    if (sec.t === "npc_vendor") return npcName(row.NPC);
    return "";
  };
  const wrap = h("div", { style: "overflow-x:auto" });
  const tbl = h("table", { class: "grid-table", style: "border-collapse:collapse;width:100%" });
  tbl.append(h("tr", {}, ...cols.map(c => h("th", { style: "text-align:left;padding:2px 4px;font-weight:normal;opacity:.7" }, c)), h("th", {}, ""), h("th", {}, "")));
  const addRow = row => {
    const inputs = {};
    const tr = h("tr", {}, ...cols.map(c => {
      const long = /Desc|Greeting|Attributes|Buys/.test(c);
      let el;
      if (c === "ItemID") el = itemSelect(row[c], { title: "Item" });
      else el = h("input", { type: "text", value: row[c] ?? "", style: `width:${long ? 260 : /Name/.test(c) ? 150 : 64}px`, "data-key": c });
      if (c !== "ItemID") el.setAttribute("data-key", c);
      else el.dataset.key = "ItemID";
      inputs[c] = el;
      return h("td", { style: "padding:1px 3px" }, el);
    }), h("td", { style: "padding:1px 3px;white-space:nowrap" }, h("button", { class: "primary", onclick: async () => {
      const out = {};
      for (const c of cols) out[c] = inputs[c].value;
      try { await api("loreSave", { table: sec.t, row: out }); status(`Saved ${sec.t}. Use Save .db or Export SQL to keep it.`); renderTab(); } catch (e) { status(e.message, true); }
    } }, "Save row"), " ", h("button", { class: "danger", onclick: async () => {
      const id = row[d.key];
      if (!id && id !== 0) { tr.remove(); return; }
      if (!confirm(`Delete ${sec.t} ${id}?`)) return;
      try { await api("loreDelete", { table: sec.t, id }); renderTab(); } catch (e) { status(e.message, true); }
    } }, "Delete")), h("td", { class: "hint", style: "padding:1px 6px" }, names(row)));
    tbl.append(tr);
  };
  for (const r of d.rows) addRow(r);
  wrap.append(tbl);
  box.append(wrap, h("div", { class: "bar" }, h("button", { onclick: () => addRow(Object.fromEntries(cols.map(c => [c, c === d.key && d.key === "id" ? "" : c === "Pieces" || c === "Count" || c === "Amount" ? 1 : c === "Chance" || c === "BuyPct" ? 100 : ""]))) }, "+ Add row")));
  return box;
}
