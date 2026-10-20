"use strict";
// Effects tab: status effects (buffs/debuffs) in the `effects` table. The API's
// effects.go codes what each modifier type does; everything here is content.

const EFFECT_NEW = { id: 0, Name: "New effect", Description: "", Icon: "assets/world/objects/Web.png", Visual: "", Duration: 3, Stacking: "refresh", MaxStacks: 1, Modifiers: '[{"type":"move_speed","mult":0.5}]' };
const STACK_HELP = {
  refresh: "hit again: the timer starts over (one stack)",
  stack: "hit again: one more stack (up to Max stacks) and the timer starts over; modifiers apply per stack",
  extend: "hit again: add Duration to what is left (up to Duration x Max stacks)",
  ignore: "hit again while active: nothing happens",
};
const MOD_HELP = {
  move_speed: "multiply move speed: 0.5 = half speed, 1.2 = 20% faster (0 to 3)",
  stun: "cannot move while active",
  dot: "damage every N seconds (ignores armour)",
};

function renderEffects(m) {
  const form = h("div", { class: "form" });
  const list = () => S.c.effects || [];
  const pick = e => { S.effect = e; m.replaceChildren(listPanel(list, x => `${x.Name} (${x.id})`, () => S.effect && S.effect.id, x => go("#effect/" + x.id), () => pick({ ...EFFECT_NEW })), form); effectForm(form, e); };
  pick(S.effect ? (S.effect.id ? list().find(x => x.id === S.effect.id) || list()[0] : S.effect) : list()[0]);
}

function effectForm(form, e) {
  form.textContent = "";
  if (!e) {
    form.append(h("h2", {}, "Effects"), h("p", { class: "hint" }, "No status effects yet. + New makes the first one (the effects table is created for you)."));
    return;
  }
  if (e.id) syncHash("#effect/" + e.id);
  const f = { Name: txt(e.Name), Description: area(e.Description), Duration: h("input", { type: "number", class: "num", step: "0.1", value: e.Duration ?? 3 }),
    MaxStacks: num(e.MaxStacks || 1), Visual: h("input", { type: "text", list: "effectVisuals", placeholder: "tag, e.g. web", value: BQFX.parse(e.Visual) ? "" : e.Visual || "" }) };
  // Visual: a tag the client codes (web, poison) or an effect sprite, stored
  // in the same column as JSON (or a bare .png path).
  let visual = e.Visual || "";
  const visSprite = spriteEditor(() => (BQFX.parse(visual) ? visual : null), v => { visual = v ? (Object.keys(v).length === 1 && v.img ? v.img : JSON.stringify(v)) : ""; if (v) f.Visual.value = ""; },
    { title: `Overlay sprite for ${e.Name || "this effect"}` });
  visSprite.dataset.key = "VisualSprite";
  f.Visual.addEventListener("input", () => { visual = f.Visual.value.trim(); });
  const stacking = h("select", {}, Object.keys(STACK_HELP).map(k => h("option", { value: k }, k)));
  stacking.value = e.Stacking || "refresh";
  const stackHint = h("span", { class: "hint" }, " " + STACK_HELP[stacking.value]);
  stacking.addEventListener("change", () => { stackHint.textContent = " " + STACK_HELP[stacking.value]; });
  let icon = e.Icon || "";
  const img = sprite(icon);
  const iconIn = assetInput(icon, v => { icon = v; img.src = assetURL(v); });
  const pickIcon = () => openPicker({ title: `Icon for ${f.Name.value || "this effect"}`, groups: effectIconGroups, recentKey: "effect", value: icon,
    onPick: v => { if (v) { icon = v; iconIn.value = v; img.src = assetURL(v); } } });
  img.addEventListener("click", pickIcon); img.style.cursor = "pointer";
  let mods = parseJSON(e.Modifiers, []);
  if (!Array.isArray(mods)) mods = [];
  const modBox = h("div", { class: "rewards" });
  const drawMods = () => modBox.replaceChildren(...mods.map((md, i) => {
    const type = h("select", { onchange: () => { mods[i] = type.value === "move_speed" ? { type: "move_speed", mult: 0.5 } : type.value === "dot" ? { type: "dot", damage: 5, every: 1 } : { type: "stun" }; drawMods(); } },
      Object.keys(MOD_HELP).map(k => h("option", { value: k }, k)));
    type.value = md.type;
    const field = (k, step) => { const el = h("input", { type: "number", class: "num", step, value: md[k] ?? "", "data-key": k }); el.addEventListener("input", () => { md[k] = +el.value; }); return el; };
    return h("div", { class: "rw" }, type,
      md.type === "move_speed" ? ["mult", field("mult", "0.05")] : null,
      md.type === "dot" ? ["damage", field("damage", "1"), "every (s)", field("every", "0.25")] : null,
      h("span", { class: "hint" }, MOD_HELP[md.type] || "unknown type: ignored by the server"),
      h("button", { class: "danger", onclick: () => { mods.splice(i, 1); drawMods(); } }, "×"));
  }));
  drawMods();
  const collect = () => ({ id: e.id || 0, Name: f.Name.value, Description: f.Description.value, Icon: icon, Visual: visual.trim(),
    Duration: +f.Duration.value, Stacking: stacking.value, MaxStacks: +f.MaxStacks.value, Modifiers: JSON.stringify(mods) });
  const users = e.id ? BQ.effectUsers(e.id) : [];
  form.append(h("h2", {}, e.id ? `${e.Name} (effect ${e.id})` : "New effect"),
    h("datalist", { id: "effectVisuals" }, ...["web", "poison", "sleep", "none"].map(v => h("option", { value: v }))),
    h("div", { class: "grid" },
      ...field("Name", f.Name),
      ...field("Description", h("div", {}, f.Description, h("span", { class: "hint" }, "shown in the in-game tooltip"))),
      h("label", {}, "Icon"), h("div", {}, h("div", { class: "bar", style: "margin:0;align-items:center" }, img, h("button", { onclick: pickIcon }, "Pick icon…")), iconIn),
      ...field("Duration (s)", f.Duration),
      ...field("Stacking", h("div", {}, stacking, stackHint)),
      ...field("Max stacks", h("div", {}, f.MaxStacks, h("span", { class: "hint" }, " for stack / extend"))),
      ...field("Visual", h("div", {}, f.Visual, h("span", { class: "hint" }, " tag the client draws on the affected body: web, poison, sleep (lies down with Zs over the head). Blank = none, except a stun effect lies down (sleep) unless set to none. Or pick a sprite:"), visSprite,
        h("div", { class: "hint" }, "A sprite is drawn over the body at native size × scale (fit is ignored); it replaces the tag."))),
      h("label", {}, "Modifiers"), h("div", {}, modBox,
        h("button", { onclick: () => { mods.push({ type: "move_speed", mult: 0.5 }); drawMods(); } }, "+ Modifier"))),
    h("div", { class: "bar" },
      h("button", { class: "primary", onclick: async () => { try { const id = await save("effects", collect()); S.effect = { id }; renderTab(); } catch { /* shown in the status bar */ } } }, e.id ? "Save effect" : "Create effect"),
      e.id ? h("button", { onclick: () => { const c = collect(); c.id = 0; c.Name += " (copy)"; S.effect = c; effectForm(form, c); } }, "Duplicate") : null,
      e.id ? h("button", { class: "danger", onclick: async () => { if (await del("effects", e.id)) { S.effect = null; renderTab(); } } }, "Delete") : null),
    h("h3", {}, "Applied by"),
    users.length ? h("div", {}, users.map(n => { const en = S.c.enemies.find(x => x.Name === n); return h("div", {}, en ? link("#mob/" + en.id, n) : n); }))
      : h("p", { class: "hint" }, e.id ? "No mob applies this yet. Add a projectile primitive with this effect in the Mobs tab." : ""),
    h("p", { class: "hint" }, "Modifier types are coded in the API (effects.go): move_speed, stun, dot. The server caps player movement by the combined move speed, and the client walks at the same speed."));
}

const effectIconGroups = () => [{ id: "fx", label: "Effect icons", entries: BQFX.manifest.sprites.filter(s => s.frames <= 1).map(s => ({ value: s.path, label: s.name, note: s.cats.join(", ") })) }, { id: "objects", label: "World objects", entries: folderEntries("assets/world/objects/") },
  { id: "items", label: "Items", entries: folderEntries("assets/items/") }, { id: "monsters", label: "Monsters", entries: folderEntries("assets/monsters/") }];
