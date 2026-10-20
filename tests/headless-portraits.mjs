// Headless check of dialogue portraits: a node's ImgPath is an override shown
// and edited as such; blank follows the NPC sprite; Save node no longer copies
// the NPC sprite in; changing the NPC sprite clears nodes that copied the old
// one. Uses Sergeant Crumb (npc 1300, greeting ql-npc-1300) of a db copy.
//   DB=/path/to/copy.db PW=... CHROME=... node tests/headless-portraits.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const node = () => p.evaluate(() => S.convBy["ql-npc-1300"].ImgPath);
const N = "#node-ql-npc-1300";
const npcRoute = async () => { await p.evaluate(() => { location.hash = "#npcs"; }); await wait(100); await p.evaluate(() => { location.hash = "#npc/1300"; }); await p.waitForSelector(N); await wait(200); };
const saveNode = async () => { await p.click(`${N} button:has-text('Save node')`); await wait(300); };
const setSprite = async v => { await p.fill(".form .grid input[type=text] >> nth=1", v); await p.click(".form button:has-text('Save NPC')"); await wait(400); await p.waitForSelector(N); };

await p.goto(URL);
await p.setInputFiles("#open", process.env.DB);
await p.waitForSelector("#tabs:not([hidden])"); await wait(500);
// simulate what the old editor did: the greeting saved with the NPC sprite of that moment
await p.evaluate(() => api("save", { table: "conversation", row: { ...S.convBy["ql-npc-1300"], ImgPath: "assets/npc/Knight.png" } }).then(loadAll));
await p.evaluate(() => api("save", { table: "npc", row: { ...S.c.npcs.find(n => n.id === 1300), ImgPath: "assets/npc/Guard.png" } }).then(loadAll));
await npcRoute();
ok(/1 node\(s\) override the portrait/.test(await p.textContent("#portrait-overrides")) && /ql-npc-1300 \(Knight\)/.test(await p.textContent("#portrait-overrides")), "NPC page lists the stale override");
ok(/override assets\/npc\/Knight\.png/.test(await p.textContent(`${N} .portrait`)), "node shows its override clearly");
await p.click(`${N} .portrait button.use-npc`);
ok(/NPC sprite \(Guard\)/.test(await p.textContent(`${N} .portrait`)) && /unsaved/.test(await p.textContent(`${N} .portrait`)), "Use NPC sprite: follows Guard (unsaved)");
await saveNode();
ok(await node() === "", "saved: node ImgPath blank (follows the NPC)");
await npcRoute();
ok(!(await p.$("#portrait-overrides")), "no overrides left");
// text edit + Save node does not copy the sprite in any more
await p.fill(`${N} textarea`, (await p.inputValue(`${N} textarea`)) + " ");
await saveNode();
ok(await node() === "", "Save node keeps a blank portrait blank");
// NPC sprite change: node follows
await npcRoute(); await setSprite("assets/npc/Knight.png"); await npcRoute();
ok(/NPC sprite \(Knight\)/.test(await p.textContent(`${N} .portrait`)), "after the NPC sprite change the node follows it");
// explicit override: a sign, kept across NPC sprite changes
await p.click(`${N} .portrait button:has-text('Override')`); await p.waitForSelector(".modal .picker");
await p.click(".modal .picker-chips button:has-text('Player')").catch(() => {});
await p.fill(".modal .picker-q", "Guard"); await wait(100);
await p.click(".modal .pcell[data-value='assets/npc/Guard.png']"); await wait(100);
await saveNode();
ok(await node() === "assets/npc/Guard.png", "override picked and saved");
await npcRoute(); await setSprite("assets/npc/Priest.png");
ok(await node() === "assets/npc/Guard.png", "override that is not a copy survives an NPC sprite change");
// override equal to the NPC sprite = a copy: cleared when the sprite changes
await npcRoute(); await setSprite("assets/npc/Guard.png"); await npcRoute();
ok(/same as the NPC sprite/.test(await p.textContent(`${N} .portrait`)), "override equal to the NPC sprite is flagged");
await setSprite("assets/npc/Merchant.png");
ok(await node() === "" && /now use the NPC sprite/.test(await p.textContent("#status")), "NPC sprite change clears the node that copied the old sprite");
// new nodes start blank
await npcRoute();
await p.click(".form button:has-text('+ New node')"); await wait(200);
const nn = await p.$$eval(".node", x => x.length);
ok(/NPC sprite \(Merchant\)/.test(await p.textContent(`.node >> nth=${nn - 1}`)), "new node follows the NPC sprite");
// Export SQL has the portrait updates
await p.click("#tabs button[data-tab=export]"); await p.waitForSelector("pre.sql"); await wait(200);
const sql = await p.textContent("pre.sql");
ok(/UPDATE conversation SET ImgPath = '' WHERE id IN \(\d+\) AND ImgPath = 'assets\/npc\/Guard\.png';/.test(sql), "Export SQL has the portrait update");
ok(errs.length === 0, "no page errors " + errs.join("; "));
await b.close();
