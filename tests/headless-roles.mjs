// Headless check of NPC roles (Junk buyer / vendor, Plot seller, Skill trainer) on a blank slate:
// a db with no NPCs and no quests; add NPCs from the NPCs tab, the map's NPC tool and Quest Studio, tick roles,
// and check the rows the API reads (npc_vendor, skill_trainer, Faction 'Land Agent'); plots can be sold by the seller.
//   python3 -m http.server 8771 &   (in this folder)
//   DB=/path/to/blank-copy.db OUT=/tmp/dir SHOTS=/dir PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-roles.mjs
// Writes roles-test.db (the edited db, for the in-game check) to OUT.
import fs from "fs";
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8771/index.html";
const OUT = process.env.OUT || "/tmp", SHOTS = process.env.SHOTS || "";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const shot = n => SHOTS ? p.screenshot({ path: `${SHOTS}/${n}.png` }) : null;
const roles = id => p.evaluate(id => BQ.api.npcRoles({ id }), id);
const rows = sql => p.evaluate(sql => BQ.api.loreTables(), sql);

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(800);
ok(await p.evaluate(() => S.c.npcs.length === 0 && S.c.quests.length === 0), "blank slate: 0 NPCs, 0 quests");
ok(await p.evaluate(() => S.c.plots.length > 0), "plots stay (" + await p.evaluate(() => S.c.plots.length) + ")");

// a walkable row of 18 tiles nearest the start, for the in-game check (NPCs stand at +1, +8 and +15)
const row = await p.evaluate(async () => {
  if (!S.world) await loadWorld();
  const free = k => { const u = S.world.tiles.get(k); return u && !u[5] && !S.world.strings[u[3]] && !S.world.strings[u[6]] && !/water|lava|deep|rock|wall/i.test(S.world.strings[u[2]]); };
  const cand = [...S.world.tiles.values()].map(t => [t[0], t[1], Math.hypot(t[0] + 3, t[1])]).sort((a, b) => a[2] - b[2]);
  for (const [x, y] of cand) { let all = true; for (let i = 0; i < 18; i++) if (!free((x + i) + "," + y)) { all = false; break; } if (all) return [x, y]; }
  return null;
});
ok(!!row, "found a walkable row near the start: " + row);

// ---------- NPCs tab: a junk buyer
await p.click("#tabs button[data-tab=npcs]"); await wait(300);
await p.click(".list button:has-text('+ New')"); await wait(200);
ok(await p.$(".roles [data-role=vendor] input") !== null && await p.$(".roles [data-role=plot] input") !== null && await p.$(".roles [data-role=trainer] input") !== null, "NPC form shows the three role ticks");
await p.fill(".form .grid input[type=text] >> nth=0", "Test Junk Buyer");
await p.fill(".form .grid input.num >> nth=0", String(row[0] + 1)); await p.fill(".form .grid input.num >> nth=1", String(row[1]));
await p.check(".roles [data-role=vendor] input"); await wait(100);
ok(await p.$(".roles [data-sub=vendor]") !== null, "ticking Junk buyer shows what they buy");
ok(await p.isChecked("[data-buys=junk]") && await p.isChecked("[data-buys=misc]") && !(await p.isChecked("[data-buys=gear]")), "default: junk and other items, not gear");
await shot("blank-editor-roles-form");
await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(400);
const junkId = await p.evaluate(() => S.c.npcs.find(n => n.Name === "Test Junk Buyer").id);
let r = await roles(junkId);
ok(r.vendor && r.vendor.Buys === "junk,misc" && r.vendor.BuyPct === 100 && /junk and other items/.test(r.vendor.Greeting) && !r.plot && !r.trainer, "junk buyer saved to npc_vendor: " + JSON.stringify(r.vendor));
ok(junkId >= 1700, "new NPC id " + junkId);
// untick/tick categories live in the vendor row
await p.check("[data-buys=gear]"); await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(300);
r = await roles(junkId);
ok(r.vendor.Buys === "junk,misc,gear", "buys list follows the ticks: " + r.vendor.Buys);
await p.uncheck("[data-buys=gear]"); await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(300);

// ---------- NPCs tab: plot seller + trainer in one
await p.click(".list button:has-text('+ New')"); await wait(200);
await p.fill(".form .grid input[type=text] >> nth=0", "Test Plot Seller");
await p.fill(".form .grid input.num >> nth=0", String(row[0] + 8)); await p.fill(".form .grid input.num >> nth=1", String(row[1]));
await p.check(".roles [data-role=plot] input"); await wait(100);
ok(await p.evaluate(() => [...document.querySelectorAll(".form .grid input[type=text]")].some(i => i.value === "Land Agent")), "ticking Plot seller sets the faction to Land Agent");
await shot("blank-editor-roles-plot-trainer");
await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(400);
const sellerId = await p.evaluate(() => S.c.npcs.find(n => n.Name === "Test Plot Seller").id);
r = await roles(sellerId);
ok(r.plot && !r.trainer && !r.vendor, "plot seller saved: " + JSON.stringify(r));
ok(await p.evaluate(id => S.npcBy[id].Faction, sellerId) === "Land Agent", "plot seller is Faction 'Land Agent'");

// untick Plot seller clears it
await p.click(".list .row:has-text('Test Plot Seller')"); await wait(200);
await p.uncheck(".roles [data-role=plot] input"); await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(300);
ok(!(await roles(sellerId)).plot && await p.evaluate(id => S.npcBy[id].Faction, sellerId) === "", "unticking Plot seller clears the faction");
await p.click(".list .row:has-text('Test Plot Seller')"); await wait(200);
await p.check(".roles [data-role=plot] input"); await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(300);
ok((await roles(sellerId)).plot, "ticked again");

// ---------- NPCs tab: a skill trainer
await p.click(".list button:has-text('+ New')"); await wait(200);
await p.fill(".form .grid input[type=text] >> nth=0", "Test Trainer");
await p.fill(".form .grid input.num >> nth=0", String(row[0] + 15)); await p.fill(".form .grid input.num >> nth=1", String(row[1]));
await p.check(".roles [data-role=trainer] input");
await p.click(".form .bar button.primary:has-text('Save NPC')"); await wait(400);
const trainerId = await p.evaluate(() => S.c.npcs.find(n => n.Name === "Test Trainer").id);
r = await roles(trainerId);
ok(r.trainer && !r.plot && !r.vendor, "skill trainer saved to skill_trainer: " + JSON.stringify(r));
ok(await p.evaluate(id => { const sp = S.spawnBy[id]; return sp && sp.length === 1; }, trainerId), "NPC form position made a placement");
await shot("blank-editor-roles-trainer");

// ---------- the map's NPC tool: new NPC with roles, placed by a tap
await p.click("#tabs button[data-tab=map]"); await wait(800);
await p.click(".tools button:has-text('NPCs')"); await wait(200);
await p.click(".side .seg button:has-text('A new NPC')"); await wait(200);
await p.fill(".side .npcnew input[type=text] >> nth=0", "Map Trainer");
await p.check(".side .roles [data-role=trainer] input"); await p.check(".side .roles [data-role=vendor] input"); await wait(100);
await shot("blank-editor-roles-map-tool");
const spot = await p.evaluate(() => { for (const t of S.world.tiles.values()) { const u = S.world.tiles.get(t[0] + "," + t[1]); if (u && !u[5] && /beach|sand|grass/i.test(S.world.strings[u[2]]) && /Squall/i.test(S.world.strings[u[4]] || "")) return [t[0], t[1]]; } return [-3, 0]; });
await p.evaluate(([x, y]) => { M.cx = x; M.cy = y; M.scale = 24; drawMapNow(); }, spot); await wait(600);
const [sx, sy] = await p.evaluate(([x, y]) => { const r = M.cv.getBoundingClientRect(); return [r.left + (x + .5 - M.cx) * M.scale + M.cv.width / 2, r.top + (y + .5 - M.cy) * M.scale + M.cv.height / 2]; }, spot);
await p.mouse.click(sx, sy); await wait(500);
const mapId = await p.evaluate(() => (S.c.npcs.find(n => n.Name === "Map Trainer") || {}).id);
ok(!!mapId, "map tool made the NPC");
r = await roles(mapId);
ok(r.trainer && r.vendor, "map-tool NPC saved with roles: " + JSON.stringify(r));
ok(await p.evaluate(id => (S.spawnBy[id] || []).length === 1, mapId), "and placed in the world");
// the picked NPC's roles are live ticks
await p.click(".side .seg button:has-text('Someone you have')"); await wait(200);
await p.click(".side .npcrow:has-text('Map Trainer')"); await wait(200);
await p.uncheck(".side .roles [data-role=vendor] input"); await wait(400);
ok(!(await roles(mapId)).vendor, "unticking in the map side panel saves at once");
await shot("blank-editor-roles-map-live");

// ---------- Quest Studio: new NPC with a role
await p.evaluate(() => { location.hash = "#studio/cast"; }); await wait(800);
const newBtn = await p.$("button:has-text('New NPC'), button:has-text('+ NPC'), button:has-text('New character')");
if (newBtn) {
  await newBtn.click(); await wait(300);
  await p.fill(".qs-newwin input.qs-in >> nth=0", "Studio Seller");
  await p.check(".qs-newwin .roles [data-role=plot] input");
  await shot("blank-editor-roles-studio");
  await p.click(".qs-newwin button:has-text('Bring them to life')"); await wait(600);
  const stId = await p.evaluate(() => (S.c.npcs.find(n => n.Name === "Studio Seller") || {}).id);
  ok(stId && (await roles(stId)).plot, "Quest Studio new NPC saved as a plot seller");
  await p.evaluate(id => BQ.api.delete({ table: "npc", id }), stId); await p.evaluate(() => loadAll());
} else console.log("note: no new-NPC button found in Quest Studio cast view");

// ---------- plots: place one entirely from the editor, sold by the seller
const plotId = await p.evaluate(([sid, spot]) => {
  for (let dy = 3; dy < 40; dy += 3) for (const dx of [0, 6, -6, 12]) {
    try { return BQ.api.save({ table: "plot", row: { id: 0, Name: "Test Plot", X: spot[0] + dx, Y: spot[1] + dy, W: 5, H: 5, Rent: 10, MinLevel: 1, Agent: sid } }).id; } catch (e) { /* overlaps or not buildable: next spot */ }
  }
  return 0;
}, [sellerId, row]);
ok(plotId > 0, "plot saved with the new plot seller as its agent");
await p.evaluate(async id => { await loadAll(); location.hash = "#plot/" + id; }, plotId); await wait(1500);
ok(await p.evaluate(id => M.tool === "plot" && M.plotSel && M.plotSel.id === id, plotId), "the plot opens on the Plots tool");
ok(await p.$eval("#plot-agent", e => [...e.options].some(o => /Test Plot Seller/.test(o.textContent))), "the plot's seller list offers the new plot seller");
await shot("blank-editor-plots-seller");
let refused = ""; try { await p.evaluate(([mid, spot]) => BQ.api.save({ table: "plot", row: { id: 0, Name: "Bad", X: spot[0] + 60, Y: spot[1] + 60, W: 4, H: 4, Rent: 1, MinLevel: 1, Agent: mid } }), [mapId, spot]); } catch (e) { refused = e.message; }
ok(/Land Agent|plot seller/.test(refused), "a plot cannot name an NPC who is not a plot seller: " + refused);

// delete takes roles with it
await p.evaluate(id => BQ.api.delete({ table: "npc", id }), mapId); await p.evaluate(() => loadAll());
ok(await p.evaluate(id => { const t = BQ.api.loreTables(); return !t.skill_trainer.rows.some(x => x.NPC === id) && !t.npc_vendor.rows.some(x => x.NPC === id); }, mapId), "deleting an NPC removes their roles");

// export keeps the role rows
const sql = await p.evaluate(() => BQ.api.export().sql || JSON.stringify(BQ.api.export()));
ok(/npc_vendor/.test(sql) && /skill_trainer/.test(sql), "Export SQL carries the role tables");
// edited db for the in-game check
const b64 = await p.evaluate(() => { const u = BQ.bytes(); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
fs.writeFileSync(OUT + "/roles-test.db", Buffer.from(b64, "base64"));
fs.writeFileSync(OUT + "/roles-test.json", JSON.stringify({ junkId, sellerId, trainerId, plotId, spot, row }));
ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
