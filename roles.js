"use strict";
// NPC roles: tick what an NPC does for players. Used by the NPCs tab form, the
// map's NPC tool and Quest Studio. Saves go through db.js (npcRolesSave), into
// the tables the API already reads, so a role works in game with no code change:
//   Junk buyer / vendor  npc_vendor row   "I have things to sell" in their dialogue (sell junk and spare items)
//   Plot seller          Faction "Land Agent"   the plot map; which plots: Plots tool > Land Agent per plot
//   Skill trainer        skill_trainer row      Retrain next to them (the skill tree window)
// rolesBox(state, opts) draws the ticks for a state { vendor, plot, trainer };
// opts.live = npc id saves on every change; opts.onChange runs after a change.

const ROLE_BUYS = [["junk", "Junk"], ["misc", "Other items"], ["reagent", "Materials"], ["consumable", "Potions and scrolls"], ["gear", "Gear"]];
const ROLE_PLOT = "Land Agent";

function rolesBlank() { return { vendor: null, plot: false, trainer: false }; }
function rolesOfNpc(id) {
  const r = id && S.c && S.c.npcRoles && S.c.npcRoles[id];
  return r ? { vendor: r.vendor ? { ...r.vendor } : null, plot: !!r.plot, trainer: !!r.trainer } : rolesBlank();
}
function rolesVendorDefault() { return { BuyPct: 100, Buys: "junk,misc", Greeting: "" }; }
function rolesGreeting(buys) {
  const set = String(buys || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!set.length || set.length >= ROLE_BUYS.length) return "I buy most things. Show me what you have.";
  const names = { junk: "junk", misc: "other items", reagent: "materials", consumable: "potions and scrolls", gear: "gear" };
  const w = set.map(x => names[x] || x);
  return "I buy " + (w.length > 1 ? w.slice(0, -1).join(", ") + " and " + w[w.length - 1] : w[0]) + ". Show me what you have.";
}
function rolesSummary(r) {
  const out = [];
  if (r && r.vendor) out.push("junk buyer / vendor");
  if (r && r.plot) out.push("plot seller");
  if (r && r.trainer) out.push("skill trainer");
  return out.join(", ");
}

// Saves the roles of a stored NPC and reloads. Returns the saved roles.
async function rolesSave(id, st) {
  const roles = { vendor: st.vendor && { ...st.vendor, Greeting: st.vendor.Greeting && st.vendor.Greeting.trim() ? st.vendor.Greeting.trim() : rolesGreeting(st.vendor.Buys) }, plot: !!st.plot, trainer: !!st.trainer };
  const out = await api("npcRolesSave", { id, roles });
  await loadAll();
  return out;
}

function rolesBox(st, o = {}) {
  const box = h("div", { class: "roles", "data-roles": "1" });
  let busy = Promise.resolve();
  const changed = () => {
    draw();
    if (o.onChange) o.onChange(st);
    if (o.live) busy = busy.then(async () => {
      try { await rolesSave(o.live, st); status(`Saved roles${rolesSummary(st) ? ": " + rolesSummary(st) : " (none)"}. Use Save .db or Export SQL to keep it.`); if (o.after) o.after(); }
      catch (e) { status(e.message, true); }
    });
  };
  const tick = (key, title, help, checked, on) => h("label", { class: "role", "data-role": key },
    h("input", { type: "checkbox", checked, onchange: e => on(e.target.checked) }), h("span", {}, h("b", {}, title), h("small", {}, help)));
  function draw() {
    const v = st.vendor;
    const buys = v ? String(v.Buys || "").split(",").map(x => x.trim()).filter(Boolean) : [];
    const all = v && !buys.length; // empty = anything sellable
    const kids = [
      tick("vendor", "Junk buyer / vendor", "Buys junk and items players don't need, through the Sell button in their dialogue.", !!v, on => { st.vendor = on ? rolesVendorDefault() : null; changed(); }),
    ];
    if (v) {
      const setBuys = list => { st.vendor.Buys = list.length >= ROLE_BUYS.length ? "" : list.join(","); changed(); };
      kids.push(h("div", { class: "role-sub", "data-sub": "vendor" },
        h("div", { class: "role-buys" }, h("small", {}, "Buys: "), ROLE_BUYS.map(([k, label]) => h("label", { class: "role-buy" },
          h("input", { type: "checkbox", "data-buys": k, checked: all || buys.includes(k), onchange: e => { const cur = all ? ROLE_BUYS.map(x => x[0]) : buys.slice(); setBuys(e.target.checked ? [...new Set([...cur, k])] : cur.filter(x => x !== k)); } }), label))),
        h("div", { class: "role-pay" }, h("small", {}, "Pays "), h("input", { type: "number", class: "num", min: 10, max: 300, "data-pay": "1", value: v.BuyPct, onchange: e => { st.vendor.BuyPct = Math.max(10, Math.min(300, Math.round(+e.target.value) || 100)); changed(); } }), h("small", {}, "% of an item's sell price")),
        h("div", { class: "role-greet" }, h("small", {}, "They say: "), h("input", { type: "text", "data-greet": "1", value: v.Greeting || "", placeholder: rolesGreeting(v.Buys), onchange: e => { st.vendor.Greeting = e.target.value; changed(); } }))));
    }
    kids.push(
      tick("plot", "Plot seller", "Rents out building plots (the plot map). Pick which plots they sell on the Plots tool; a plot with no seller is sold by any plot seller.", !!st.plot, on => { st.plot = on; changed(); }),
      tick("trainer", "Skill trainer", "Players can retrain (respec) their skills while standing next to them.", !!st.trainer, on => { st.trainer = on; changed(); }));
    box.replaceChildren(h("h4", {}, "Roles"), ...kids);
  }
  draw();
  box.setPlot = on => { if (st.plot !== !!on) { st.plot = !!on; draw(); } };
  box.redraw = draw;
  return box;
}
