"use strict";
// Balance guide maths for the Mobs tab. Everything that is the game's own rule
// is mirrored from the API (BrawlQuest-API, branch new-ui) and pinned by its
// testdata/balance_cases.json; tests/balance.test.mjs checks this file against
// the editor's copy (tests/balance-cases.json). The rest (how fast people
// swing, what gear they have, what "fair" means) is a stated assumption: see
// docs/BALANCE.md.
const BQBal = (() => {
  // ---- the server's own numbers -------------------------------------------
  const C = {
    combatTicksPerSecond: 20,      // enemies.go combatTicksPerSecond
    xpPerLevel: 400,               // players.go xpPerLevel (flat curve)
    maxLevel: 40,                  // players.go maxLevel
    walkTilesPerSecond: 2.5,       // movement.go walkTilesPerSecond
    sprintMultiplier: 1.4,         // movement.go sprintMultiplier
    mobDefaultSpeed: 1,            // movement.go moveTilesPerSecond
    minMobSpeed: 0.25, maxMobSpeed: 6, // movement.go clampMobSpeed
    passiveCalmSeconds: 8,         // enemies.go passiveCalmTicks
    staminaMax: 100, staminaRegenStill: 20, staminaSprintDrain: 15, // players.go
    critChance: 0.2,               // enemies.go rand.Intn(5) == 1 doubles a swing
    exoticChance: 0.1,             // enemies.go rand.Intn(10) == 1: DoublePower
    oldWorldCrystal: 53,           // enemyIsBoss: loot item 53 makes a boss
  };
  // players.go cpGains: character points gained on reaching each level.
  const CP_GAINS = [0, 0, 5, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 20, 13, 13, 14, 14, 20, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
  const ORDER_MULT = { "Warrior Order": 1.25, "Stoic Order": 0.6, "Mage Order": 0.8 }; // party.go orderDamageMult

  // enemies.go meleeHitDamage: one landed swing before the crit roll.
  // Go's math.Round rounds half away from zero; Math.round agrees for >= 0.
  function meleeHitDamage(weapon, str, order) {
    let scaled = weapon * (1 + str / (str + 40)) + str / 10;
    scaled *= ORDER_MULT[order] || 1;
    return Math.max(1, Math.round(scaled));
  }
  // players.go armorK: 12 + 4 per point of attacker power; exotic x1.5, boss x2.
  function armorK(power, boss, exotic) {
    if (power < 1) power = 1;
    let k = 12 + power * 4;
    if (exotic) k *= 1.5;
    if (boss) k *= 2;
    return k;
  }
  // players.go mitigateArmor: taken = raw * K / (armour + K), at least 1.
  function mitigateArmor(raw, armour, k) {
    if (raw <= 0 || armour <= 0) return raw;
    if (k < 1) k = 1;
    const taken = raw * k / (armour + k);
    return taken < 1 ? 1 : Math.round(taken);
  }
  // players.go getMaxHP, with playerSTA / playerSTR: a Stoic adds their level
  // to STA, a Warrior to STR (gear attributes are already in sta and str).
  function maxHP(sta, str, order, lvl = 1) {
    if (order === "Stoic Order") sta += lvl;
    if (order === "Warrior Order") str += lvl;
    if (order === "Mage Order") return 100 + sta * 5;
    if (order === "Warrior Order") return 100 + sta * 15 + str * 5;
    if (order === "Stoic Order") return 100 + sta * 20 + str * 5;
    return 100 + sta * 10 + str * 5;
  }
  // players.go givePlayerXP: XP / level (integer), nothing when that is 1 or less.
  const killXP = (xp, lvl) => { lvl = Math.max(1, lvl); const x = Math.trunc(xp / lvl); return x > 1 ? x : 0; };
  // players.go getPlayerCharacterPoints for a fresh 1/1/1 character.
  const charPoints = lvl => { let r = 0; for (let i = lvl; i > 1; i--) r += CP_GAINS[i] || 0; return r; };
  // enemies.go enemyConeStrike: ticks between strikes (ranged mobs half as often).
  const strikeTicks = (attackSpeed, range) => Math.max(1, Math.trunc((range > 1 ? C.combatTicksPerSecond * 2 : C.combatTicksPerSecond) / Math.max(1, attackSpeed | 0)));
  // movement.go clampMobSpeed.
  const mobSpeed = s => (!(s > 0) ? C.mobDefaultSpeed : Math.max(C.minMobSpeed, Math.min(C.maxMobSpeed, +s)));
  // items.go isAttribute: "STR,10;STA,25".
  const attr = (it, stat) => { if (!it || !it.Attributes || it.Attributes === "None") return 0; for (const a of String(it.Attributes).split(";")) { const [k, v] = a.split(","); if (k === stat) return parseInt(v, 10) || 0; } return 0; };
  const val = it => parseInt(it && it.Val, 10) || 0;
  const isBoss = (e, loot) => (loot || []).some(l => l.EnemyID === e.id && +l.ItemID === C.oldWorldCrystal);

  // ---- assumptions (docs/BALANCE.md) ---------------------------------------
  // Swings a second: a swing costs 10 stamina on the client and standing still
  // refills 20 a second, so 2 a second is what can be kept up (bots use 2 too).
  const SWINGS_PER_SEC = C.staminaRegenStill / (C.staminaMax * 0.1);
  const CRIT_AVG = 1 + C.critChance;          // 20% of swings double
  const STRIKES_LAND = 0.75;                   // botai FightCost: knockback, stepping and wind-ups
  const SLOTS = [["wep", ["wep"]], ["head", ["arm_head"]], ["chest", ["arm_chest"]], ["legs", ["arm_leg", "arm_legs"]]];
  const meleeWeapon = it => !/Staff|Pickaxe|Fishing|Trident/.test(it.Name || "");

  // Where each item can come from: drops, crafting, quest rewards, the start kit.
  function sources(c) {
    const by = {};
    const add = (id, s) => { (by[id] = by[id] || []).push(s); };
    const en = Object.fromEntries((c.enemies || []).map(e => [e.id, e]));
    for (const l of c.loot || []) if (en[l.EnemyID]) add(+l.ItemID, "drops from " + en[l.EnemyID].Name);
    for (const r of c.crafts || []) add(+r.ItemID, "crafted");
    for (const q of c.quests || []) { let rw = []; try { rw = JSON.parse(q.Rewards || "[]"); } catch {} for (const r of rw) add(+r.ItemID, "quest: " + q.Title); }
    for (const id of [1, 2, 3]) add(id, "starting kit"); // players.go: Long Stick, Brown Trousers, Green Shirt
    return by;
  }
  // The best piece per slot a player of this level can wear and get hold of.
  // behind: what they had some levels ago (catching up on gear).
  function gearAt(c, lvl, behind = 0) {
    const src = c._src || (c._src = sources(c));
    const cap = Math.max(1, lvl - behind), out = {};
    for (const [slot, types] of SLOTS) {
      let best = null;
      for (const it of c.items || []) {
        if (!types.includes(it.Type) || !src[it.id] || (+it.Worth || 0) > cap) continue;
        if (slot === "wep" && !meleeWeapon(it)) continue;
        const s = val(it) + attr(it, "STR") * 0.5 + attr(it, "STA") * 0.5;
        if (!best || s > best.s) best = { s, it };
      }
      out[slot] = best ? best.it : null;
    }
    return out;
  }
  // A player at this level: points split between STR and STA (a melee build).
  function player(c, lvl, o = {}) {
    lvl = Math.max(1, Math.min(C.maxLevel, Math.round(lvl)));
    const gear = gearAt(c, lvl, o.behind || 0), cp = charPoints(lvl);
    const pieces = Object.values(gear).filter(Boolean);
    const str = 1 + Math.floor(cp / 2) + pieces.reduce((a, it) => a + attr(it, "STR"), 0);
    const sta = 1 + Math.ceil(cp / 2) + pieces.reduce((a, it) => a + attr(it, "STA"), 0);
    const armour = ["head", "chest", "legs"].reduce((a, k) => a + val(gear[k]), 0);
    const hit = meleeHitDamage(val(gear.wep), str, "");
    return { lvl, gear, str, sta, hp: maxHP(sta, str, ""), armour, hit, crit: hit * 2, swings: SWINGS_PER_SEC, dps: hit * CRIT_AVG * SWINGS_PER_SEC };
  }
  // One fight, or a pack of n fought one after another while all of them hit.
  function fight(p, e, o = {}) {
    const n = Math.max(1, o.pack || 1), boss = !!o.boss;
    const moving = !!+e.CanMove;
    const perSwing = moving ? p.hit * CRIT_AVG : 1;              // enemies.go: things that cannot move lose 1 a hit
    const swings = Math.ceil(Math.max(1, +e.HP || 1) / perSwing);
    const ttk = swings / p.swings;                                 // seconds for one
    const strike = (+e.ATK || 0) > 0 ? mitigateArmor(+e.ATK, p.armour, armorK(+e.ATK, boss, false)) : 0;
    const rate = C.combatTicksPerSecond / strikeTicks(+e.AttackSpeed || 1, +e.Range || 1);
    const dps = moving || (+e.ATK || 0) > 0 ? strike * rate * STRIKES_LAND : 0;
    const taken = dps * ttk * n * (n + 1) / 2;                     // the pack thins as you go
    const xp = killXP(+e.XP || 0, p.lvl);
    const speed = mobSpeed(e.Speed);
    return {
      swings, ttk, ttkPack: ttk * n, strike, rate, dps, taken, share: taken / p.hp,
      hitsToKill: strike > 0 ? Math.ceil(p.hp / strike) : Infinity, secsToKill: dps > 0 ? p.hp / dps : Infinity,
      xp, killsPerLevel: xp > 0 ? Math.ceil(C.xpPerLevel / xp) : Infinity, xpPerSec: xp / Math.max(0.5, ttk),
      speed, walk: C.walkTilesPerSecond, sprint: C.walkTilesPerSecond * C.sprintMultiplier,
    };
  }
  // Bands: how long one takes to kill and how much of your health it costs.
  // secs: seconds to kill one; hits: how many of its hits would kill you.
  // share (of your health one fight costs) is shown, not used to judge.
  const BANDS = [
    { id: "easy", label: "Easy", secs: [1, 3], share: [0, 0.1], hits: [40, Infinity], note: "fodder: a few swings, barely scratches you" },
    { id: "fair", label: "Fair", secs: [3, 7], share: [0.1, 0.3], hits: [15, 40], note: "a proper fight you win at full health" },
    { id: "tough", label: "Tough", secs: [7, 15], share: [0.3, 0.6], hits: [7, 15], note: "one at a time, then rest or eat" },
    { id: "elite", label: "Elite", secs: [15, 40], share: [0.6, 0.95], hits: [3, 7], note: "needs food, skill or a friend" },
    { id: "boss", label: "Boss", secs: [60, 240], share: [1.5, 6], hits: [2, 5], note: "a group of about 4 over a few minutes" },
  ];
  // The harder of fight length and how hard it hits decides; past Elite is "over".
  const bandOf = (f, boss) => {
    if (boss) return { ...BANDS[4], over: false };
    const t = BANDS.slice(0, 4).findIndex(b => f.ttk <= b.secs[1]);
    const h = BANDS.slice(0, 4).findIndex(b => f.hitsToKill >= b.hits[0]);
    const i = Math.max(t < 0 ? 4 : t, h < 0 ? 4 : h);
    return { ...BANDS[Math.min(i, 3)], over: i > 3 };
  };
  // HP and ATK for each band: HP from how long one should take (a boss for a
  // group of 4), ATK from how many of its hits should kill you through your
  // armour (bosses' hits go through twice as much).
  function bandRanges(p, e) {
    const atkFor = (hits, boss) => { // smallest ATK whose hit is at least HP / hits
      if (!isFinite(hits)) return 1;
      const need = p.hp / hits; let lo = 0, hi = 20000;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (mitigateArmor(m, p.armour, armorK(m, boss, false)) >= need) hi = m; else lo = m; }
      return hi;
    };
    return BANDS.map(b => {
      const boss = b.id === "boss", party = boss ? 4 : 1;
      const perSec = (+e.CanMove ? p.hit * CRIT_AVG : 1) * p.swings * party;
      return { ...b, hp: [Math.round(b.secs[0] * perSec), Math.round(b.secs[1] * perSec)], atk: [atkFor(b.hits[1], boss), atkFor(b.hits[0], boss)] };
    });
  }
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  // Quest kill steps naming an enemy: Target, or the extra Targets ("+ also counts").
  function killQuests(c) {
    const by = {};
    for (const q of c.quests || []) {
      let steps = []; try { steps = JSON.parse(q.Steps || "[]"); } catch {}
      for (const s of steps) if (s && (s.Type === "kill" || s.Type === "boss")) for (const t of [s.Target, ...(Array.isArray(s.Targets) ? s.Targets : [])]) if (t) (by[t] = by[t] || []).push(q);
    }
    return by;
  }
  // Which level a mob is pitched at, and why. world: { name -> [zone names] } or null.
  function stageOf(c, e, spawnZones) {
    c._kq = c._kq || killQuests(c);
    const out = [];
    const qs = c._kq[e.Name] || [];
    if (qs.length) out.push({ from: "quests", level: Math.min(...qs.map(q => +q.Level || 1)), why: `first hunted at level ${Math.min(...qs.map(q => +q.Level || 1))}: ${qs.length} kill quest${qs.length > 1 ? "s" : ""} (${[...new Set(qs.map(q => q.Title))].slice(0, 2).join(", ")})` });
    const zones = spawnZones ? [...new Set(spawnZones[e.Name] || [])].filter(Boolean) : [];
    const zl = zones.map(z => ({ z, l: median((c.quests || []).filter(q => q.Zone === z).map(q => +q.Level || 1)) })).filter(x => x.l != null);
    if (zl.length) out.push({ from: "map", level: median(zl.map(x => x.l)), why: "placed in " + zl.map(x => `${x.z} (quests ~${x.l})`).slice(0, 3).join(", ") });
    const st = statLevel(c, e);
    if (st) out.push({ from: "stats", level: st, why: "its numbers make a fair fight here" });
    return out;
  }
  // The first level at which this mob is a fair fight or easier (like the bots' EnemyLevel).
  function statLevel(c, e) {
    if (!+e.CanMove || !(+e.ATK > 0)) return null;
    for (let l = 1; l <= C.maxLevel; l++) { const f = fight(player(c, l), e); if (f.ttk <= 7 && f.hitsToKill >= 15) return l; }
    return C.maxLevel;
  }
  // Zone names each enemy is placed in, from the editor's world tiles.
  function spawnZones(world) {
    if (!world) return null;
    const by = {};
    for (const t of world.tiles.values()) { const n = world.strings[t[6]]; if (n) (by[n] = by[n] || []).push(world.strings[t[4]]); }
    return by;
  }
  function speedWords(s) {
    const walk = C.walkTilesPerSecond, sprint = walk * C.sprintMultiplier;
    if (s < 0.75) return "slow shambler";
    if (s < 1.5) return "ambles (the usual mob pace)";
    if (s < walk) return "brisk, slower than a walk";
    if (s < sprint) return "keeps up with a walk, a sprint gets away";
    if (s < 4.5) return "faster than a sprinting player";
    return "a blur";
  }
  return { C, CP_GAINS, meleeHitDamage, armorK, mitigateArmor, maxHP, killXP, charPoints, strikeTicks, mobSpeed, attr, isBoss,
    SWINGS_PER_SEC, CRIT_AVG, STRIKES_LAND, BANDS, sources, gearAt, player, fight, bandRanges, bandOf, stageOf, statLevel, spawnZones, killQuests, median, speedWords };
})();
if (typeof module !== "undefined") module.exports = BQBal;
