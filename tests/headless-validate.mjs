// Headless check of the checks run before Save .db and Commit (validate.js):
// a clean db passes, then each kind of breakage the API has tripped on is
// reported, errors block Save .db, new warnings can be overridden, and
// warnings already in the opened db don't get in the way.
//   python3 -m http.server 8765 &   (in this folder)
//   DB=/path/to/bq-content.db PW=/path/to/playwright-core/index.mjs CHROME=/usr/bin/google-chrome node tests/headless-validate.mjs
const { chromium } = await import(process.env.PW || "playwright-core");
const URL = process.env.URL || "http://localhost:8765/index.html";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e)));
p.on("dialog", d => d.accept());
const ok = (c, m) => { if (!c) { console.log("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); };
const wait = ms => p.waitForTimeout(ms);
const run = () => p.evaluate(() => BQCheck.run(BQ.query).all.map(x => `${x.level} ${x.where}: ${x.msg}`));
const sql = s => p.evaluate(s => BQ.query(s), s);
const open = async () => { await p.setInputFiles("#open", process.env.DB); await p.waitForSelector("#tabs:not([hidden])"); await p.waitForFunction(() => BQSync.state.lastId > 0); };

await p.goto(URL);
await open();
const base = await run();
ok(!base.some(x => x.startsWith("error")), "the db as shipped has no errors (" + base.length + " warning(s))");

// warning already there when opened: Save .db goes straight through
const [d0] = await Promise.all([p.waitForEvent("download", { timeout: 5000 }).catch(() => null), p.click("#btn-save")]);
ok(!!d0 && !(await p.$(".sync-modal")), "Save .db with no new problems: no questions");

// a new warning: asked, can override
await sql("UPDATE npc SET Conversation = 'no-such-node' WHERE id = (SELECT MIN(id) FROM npc)");
await p.click("#btn-save"); await p.waitForSelector(".sync-modal");
ok(/new warning/.test(await p.textContent(".sync-modal")) && /no-such-node/.test(await p.textContent(".sync-modal")), "new warning listed");
const [d1] = await Promise.all([p.waitForEvent("download"), p.click(".sync-modal button:has-text('Save .db anyway')")]);
ok(!!d1, "Save .db anyway downloads");

// each breakage
const cases = [
  ["quest step NPC", "UPDATE quest_def SET Steps = '[{\"Type\":\"talk\",\"NPC\":999999,\"Count\":1,\"Text\":\"x\"}]' WHERE id = (SELECT MIN(id) FROM quest_def)", /error quest .*step 1 \(talk\): NPC 999999 doesn't exist/],
  ["quest kill target", "UPDATE quest_def SET Steps = '[{\"Type\":\"kill\",\"Target\":\"Nobody At All\",\"Count\":1,\"Text\":\"x\"}]' WHERE id = (SELECT MAX(id) FROM quest_def)", /error quest .*no enemy named "Nobody At All"/],
  ["quest reward item", "UPDATE quest_def SET Rewards = '[{\"ItemID\":999999,\"Amount\":1}]' WHERE id = (SELECT MAX(id) FROM quest_def)", /error quest .*reward 1 points at item 999999/],
  ["quest step type in JSON", "UPDATE quest_def SET Steps = '[{\"Type\":\"collect\",\"Target\":\"x\",\"Count\":\"3\",\"Text\":\"x\"}]' WHERE id = (SELECT MIN(id) FROM quest_def WHERE id > (SELECT MIN(id) FROM quest_def))", /error quest .*Steps\[0\]\.Count is "3", the API needs a whole number/],
  ["quest column type", "UPDATE quest_def SET XP = 'lots' WHERE id = (SELECT MAX(id) FROM quest_def)", /error quest_def\.XP: 1 row\(s\) where XP is not a whole number .*stops loading quests/],
  ["dialogue next node", "UPDATE conversation SET Options = '[[''Go on'',''missing-node'']]' WHERE id = (SELECT MIN(id) FROM conversation)", /error dialogue .*leads to node "missing-node"/],
  ["loot item", "UPDATE loot SET ItemID = 999999 WHERE id = (SELECT MIN(id) FROM loot)", /error loot \d+: drop of enemy \d+ points at item 999999/],
  ["pattern JSON", "UPDATE boss_patterns SET Pattern = '[{\"do\":\"zone\"' WHERE id = (SELECT MIN(id) FROM boss_patterns)", /error boss_patterns .*Pattern is not valid JSON/],
  ["pattern int field", "UPDATE boss_patterns SET Pattern = '[{\"do\":\"zone\",\"every\":2.5,\"damage\":10}]' WHERE id = (SELECT MAX(id) FROM boss_patterns)", /error boss_patterns .*Pattern\[0\]\.every is 2\.5, the API needs a whole number .*drops every primitive/],
  ["effect modifiers", "CREATE TABLE IF NOT EXISTS effects (id INTEGER PRIMARY KEY, Name TEXT NOT NULL, Description TEXT NOT NULL DEFAULT '', Icon TEXT NOT NULL DEFAULT '', Visual TEXT NOT NULL DEFAULT '', Duration REAL NOT NULL DEFAULT 3, Stacking TEXT NOT NULL DEFAULT 'refresh', MaxStacks INTEGER NOT NULL DEFAULT 1, Modifiers TEXT NOT NULL DEFAULT '[]'); INSERT INTO effects (id, Name, Modifiers) VALUES (900, 'Broken', '[{type:stun}]')", /error effect 900 Broken: Modifiers is not valid JSON/],
  ["craft items", "UPDATE craft SET Items = 'oops' WHERE id = (SELECT MIN(id) FROM craft)", /error craft \d+: Items is not valid JSON .*initCraftItems panics/],
  ["item NULL", "UPDATE items SET Name = NULL WHERE id = (SELECT MIN(id) FROM items)", /error items\.Name: 1 row\(s\) where Name is not text/],
  ["map spawn", "UPDATE world SET Enemy = 'Ghost Of Nothing' WHERE id = (SELECT MIN(id) FROM world)", /error map: 1 tile\(s\) spawn "Ghost Of Nothing"/],
  ["forge table gone", "DROP TABLE forge", /error forge: table forge is missing: initForging panics/],
  ["enemySpells column gone", "ALTER TABLE enemySpells RENAME COLUMN Frequency TO Freq", /error enemySpells: enemySpells has no column Frequency/],
  ["items column count", "ALTER TABLE items ADD COLUMN Extra TEXT", /error items: items has 11 columns; the API reads SELECT \* into exactly 10/],
];
for (const [name, s, re] of cases) {
  for (const one of s.split(/;\s*(?=INSERT)/)) await sql(one);
  const r = await run();
  const hit = r.find(x => re.test(x));
  ok(!!hit, name + ": " + (hit || "not reported; got " + r.filter(x => !base.includes(x)).slice(0, 3).join(" | ")));
}
// errors block Save .db: no override
await p.click("#btn-save"); await p.waitForSelector(".sync-modal");
const t = await p.textContent(".sync-modal");
ok(/Fix these before Save \.db/.test(t) && !(await p.$(".sync-modal button:has-text('anyway')")), "errors block Save .db with no override");
ok((await p.$$(".sync-modal ul.issues.err li")).length >= 8, "errors listed one per line");
const link = await p.$(".sync-modal ul.issues a[href^='#quest/']");
ok(!!link, "an error links to the quest it is in");
await link.click(); await wait(400);
ok(!(await p.$(".sync-modal")) && /#quest\/\d+/.test(await p.evaluate(() => location.hash)), "the link opens the quest");
// integrity_check runs (a healthy file says ok)
ok(await p.evaluate(() => BQ.query("PRAGMA integrity_check")[0].integrity_check) === "ok", "integrity_check is part of the run");
ok(errs.length === 0, "no page errors " + errs.join("; "));
await b.close();
