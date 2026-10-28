"use strict";
// Mobs tab: the Speed and Flip controls and the balance guide under the mob
// form. The maths is balance.js (mirrored from the API); this is only the UI.

// Flip sits beside the sprite: the preview mirrors live, and the arrow is the
// way every mob should face in the game.
function mobFlipToggle(f, e, img, cols) {
  if (!cols.includes("Flip")) return null;
  const cb = f.Flip = h("input", { type: "checkbox", name: "Flip" });
  cb.checked = !!+(e.Flip ?? 0);
  const apply = () => { img.style.transform = cb.checked ? "scaleX(-1)" : ""; };
  cb.addEventListener("change", apply); apply();
  return h("label", { class: "mg-flip", title: "Tick when the art faces left on its sheet; the game draws every mob facing right and turns it when it walks left" },
    cb, " Flip sprite ", h("span", { class: "mg-face" }, "should face \u2192"));
}

// Speed: a slider and a number, in tiles a second, with the player's walk and
// sprint marked on the track.
function mobSpeedInput(v) {
  const B = BQBal, C = B.C, max = C.maxMobSpeed;
  const n = h("input", { type: "number", class: "num", min: C.minMobSpeed, max, step: 0.05, value: B.mobSpeed(v) });
  const r = h("input", { type: "range", min: C.minMobSpeed, max, step: 0.05, value: B.mobSpeed(v), class: "mg-speed" });
  const words = h("span", { class: "hint" });
  const walk = C.walkTilesPerSecond, sprint = walk * C.sprintMultiplier, pct = x => ((x - C.minMobSpeed) / (max - C.minMobSpeed) * 100).toFixed(1) + "%";
  const marks = h("div", { class: "mg-marks" },
    h("span", { style: `left:${pct(1)}` }, "usual"), h("span", { style: `left:${pct(walk)}` }, "walk " + walk), h("span", { style: `left:${pct(sprint)}` }, "sprint " + sprint));
  const show = () => { words.textContent = " tiles/s: " + B.speedWords(+n.value); };
  r.addEventListener("input", () => { n.value = r.value; show(); n.dispatchEvent(new Event("input", { bubbles: true })); });
  n.addEventListener("input", () => { r.value = n.value; show(); });
  show();
  n.box = h("div", { class: "mg-speedbox" }, h("div", { class: "mg-track" }, r, marks), h("div", {}, n, words));
  return n;
}

// The balance guide. read() is the form's current values.
function mobGuide(form, e, read, grid) {
  const B = BQBal;
  if (!S.c.enemyCols || !S.c.items) return;
  const box = h("div", { class: "panel mg" });
  form.append(box);
  const st = S.mobGuide = S.mobGuide || { behind: 5, pack: 1, level: null, forId: null };
  if (st.forId !== (e.id || 0)) { st.forId = e.id || 0; st.level = null; }
  let zones = S.world ? B.spawnZones(S.world) : null;
  const draw = () => {
    const m = read();
    const boss = B.isBoss({ id: e.id }, S.c.loot);
    const stages = B.stageOf(S.c, { ...m, Name: e.Name || m.Name }, zones);
    const lv = st.level ?? (stages[0] ? stages[0].level : 5);
    const p = B.player(S.c, lv, { behind: st.behind });
    const f = B.fight(p, m, { pack: st.pack, boss });
    const band = B.bandOf(f, boss);
    const ranges = B.bandRanges(p, m);
    box.textContent = "";
    // ---- stage
    const lvIn = h("input", { type: "range", min: 1, max: B.C.maxLevel, value: lv, class: "mg-level" });
    const lvNum = h("b", { class: "mg-lv" }, String(lv));
    lvIn.addEventListener("input", () => { lvNum.textContent = lvIn.value; });
    lvIn.addEventListener("change", () => { st.level = +lvIn.value; draw(); });
    box.append(h("h3", {}, "Balance guide"),
      h("div", { class: "mg-row" }, h("span", {}, "Pitch it at level "), lvNum, lvIn),
      h("div", { class: "mg-why" }, stages.length ? stages.map(s => h("button", { type: "button", class: "mg-chip" + (s.level === lv ? " on" : ""), title: s.why, onclick: () => { st.level = s.level; draw(); } },
        `${{ quests: "From quests", map: "Where it's placed", stats: "Its numbers" }[s.from]}: ${s.level}`)) : null,
        !zones ? h("button", { type: "button", class: "mg-chip", onclick: async () => { try { await loadWorld(); zones = B.spawnZones(S.world); draw(); } catch (err) { status(err.message, true); } } }, "Check the map too") : null,
        h("span", { class: "hint" }, " " + ((stages.find(s => s.level === lv) || {}).why || ""))));
    // ---- the player
    const g = p.gear, name = it => it ? `${it.Name} (${it.Val})` : "nothing";
    box.append(h("div", { class: "mg-who" },
      h("p", {}, `A level ${lv} player has about `, h("b", {}, `${p.hp} HP`), `, swings ${name(g.wep)} for `, h("b", {}, `${p.hit}`), ` (${p.crit} on a crit) about twice a second, and wears ${name(g.head)}, ${name(g.chest)} and ${name(g.legs)}: `, h("b", {}, `${p.armour} armour`), "."),
      h("div", { class: "mg-row" }, h("span", { class: "hint" }, "Their gear "), seg([[5, "a few levels behind"], [0, "the best they can get"]], st.behind, v => { st.behind = v; draw(); }),
        h("span", { class: "hint" }, " Fighting "), seg([[1, "one"], [2, "2"], [3, "3"], [5, "5"]], st.pack, v => { st.pack = v; draw(); }))));
    // ---- what happens with the current numbers
    const s1 = x => x < 10 ? x.toFixed(1).replace(/\.0$/, "") : Math.round(x);
    const lines = [];
    const many = st.pack > 1 ? ` (${st.pack} of them: about ${s1(f.ttkPack)} s)` : "";
    lines.push(+m.CanMove ? `You kill it in about ${f.swings} swing${f.swings > 1 ? "s" : ""} (${s1(f.ttk)} s)${many}.` : `It cannot move, so every swing takes 1: ${f.swings} swings (${s1(f.ttk)} s).`);
    if (f.strike > 0) lines.push(`Each hit takes ${f.strike} of your ${p.hp} HP: it would need ${f.hitsToKill} hits (${s1(f.secsToKill)} s) to kill you. A fight costs you about ${Math.round(f.share * 100)}% of your health.`);
    else lines.push("It never hits back.");
    lines.push(f.xp > 0 ? `${f.xp} XP a kill at level ${lv} (${m.XP} / ${lv}): about ${f.killsPerLevel} kills a level.` : `No XP at level ${lv}: XP ${m.XP} / level ${lv} is 1 or less.`);
    if (+m.CanMove) lines.push(f.speed < f.walk ? `At ${f.speed} tiles/s you can walk away from it (you walk ${f.walk}).` : f.speed < f.sprint ? `At ${f.speed} tiles/s it keeps up with a walk; only a sprint (${s1(f.sprint)}) gets away while stamina lasts.` : `At ${f.speed} tiles/s it outruns even a sprint (${s1(f.sprint)}): no escape on foot.`);
    if (+m.Passive) lines.push("Passive: it never starts a fight, so players choose it. It can sit a band tougher than the mobs around it.");
    if (+m.SleepsAtNight && +m.CanMove) lines.push(+m.SpawnsDay ? "Sleeps at night: walk past (don't sprint) and it stays down, so at night it is an optional fight." : "Sleeps at night, and that is the only time it is out: players can walk past it, so it is an optional fight.");
    if (boss) lines.push("Boss (drops an Old World Crystal): its hits go through twice as much armour.");
    lines.push(`1 in 10 spawn exotic: 3x the HP (${(+m.HP || 0) * 3}) and double XP.`);
    box.append(h("div", { class: "mg-now" }, h("span", { class: "mg-band mg-" + band.id }, band.over ? "Beyond elite" : band.label),
      h("span", { class: "hint" }, " " + (band.over ? "longer or more painful than an elite: is that meant?" : band.note)), h("ul", {}, lines.map(l => h("li", {}, l)))));
    // ---- bands
    const tbl = h("div", { class: "mg-bands" });
    for (const b of ranges) {
      tbl.append(h("button", { type: "button", class: "mg-bandrow" + (b.id === band.id ? " on" : ""), title: "Use the middle of this band", onclick: () => setStats(Math.round((b.hp[0] + b.hp[1]) / 2), Math.round((b.atk[0] + b.atk[1]) / 2)) },
        h("span", { class: "mg-band mg-" + b.id }, b.label), h("span", {}, `HP ${b.hp[0]}\u2013${b.hp[1]}`), h("span", {}, `ATK ${b.atk[0]}\u2013${b.atk[1]}`), h("span", { class: "hint" }, b.note)));
    }
    box.append(h("div", { class: "hint" }, `Suggested for level ${lv} with this attack speed and range (tap a row to use its middle):`), tbl);
    // ---- the chart
    box.append(mobGuideChart(p, m, e, zones, st));
  };
  const setStats = (hp, atk) => {
    for (const [lbl, v] of [["HP", hp], ["ATK", atk]]) {
      const l = [...grid.querySelectorAll(":scope > label")].find(x => x.textContent === lbl);
      const inp = l && l.nextElementSibling.querySelector("input");
      if (inp) { inp.value = v; }
    }
    draw();
  };
  let t = 0;
  grid.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 120); });
  grid.addEventListener("change", () => { clearTimeout(t); t = setTimeout(draw, 50); });
  draw();
}

// Every mob that fights back, at its own stage: how long it takes to kill and
// what share of your health it costs, on the band stripes. This mob is the
// ring; tap a dot to see which mob it is.
function mobGuideChart(p0, m, e, zones, st) {
  const B = BQBal, wrap = h("div", { class: "mg-chart" }), cv = h("canvas", {}), tip = h("div", { class: "hint mg-tip" }, "Tap a dot to see the mob.");
  const pts = [];
  for (const o of S.c.enemies) {
    if (!+o.CanMove || !(+o.ATK > 0) || o.id === e.id) continue;
    const stg = B.stageOf(S.c, o, zones), s = stg.find(x => x.from !== "stats") || stg[0];
    if (!s) continue;
    const boss = B.isBoss(o, S.c.loot), f = B.fight(B.player(S.c, s.level, { behind: st.behind }), o, { boss });
    pts.push({ o, lv: s.level, f, boss, band: B.bandOf(f, boss) });
  }
  const me = { o: { Name: m.Name || "this mob" }, lv: p0.lvl, f: B.fight(p0, m, { boss: B.isBoss({ id: e.id }, S.c.loot) }), me: true };
  // out of line: beyond elite for a normal mob, gone in one swing, or XP that
  // rounds to nothing (or a grind of 150+ kills a level) at its own level
  const oddWhy = q => q.f.xp === 0 ? "no XP at level " + q.lv : q.f.killsPerLevel > 150 ? `${q.f.killsPerLevel} kills a level at ${q.lv}` : q.boss ? "" : q.band.over ? "beyond elite at " + q.lv : q.f.ttk < 1 && q.f.share < 0.02 ? "a one-swing pushover at " + q.lv : "";
  const odd = pts.filter(q => oddWhy(q));
  const draw = () => {
    const w = Math.max(280, wrap.clientWidth || 600), hh = 220, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = hh * dpr; cv.style.width = w + "px"; cv.style.height = hh + "px";
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = 34, R = 8, T = 8, Bm = 24, X = lv => L + (lv - 1) / (B.C.maxLevel - 1) * (w - L - R);
    const ymin = Math.log(0.4), ymax = Math.log(300), Y = s => T + (1 - (Math.log(Math.max(0.4, Math.min(300, s))) - ymin) / (ymax - ymin)) * (hh - T - Bm);
    g.fillStyle = "#11141a"; g.fillRect(0, 0, w, hh);
    const tint = { easy: "#1d2a22", fair: "#1d2633", tough: "#2c2a1c", elite: "#33201f", boss: "#2a1f33" };
    for (const b of B.BANDS) { g.fillStyle = tint[b.id]; const y1 = Y(b.secs[1]), y0 = Y(b.secs[0]); g.fillRect(L, y1, w - L - R, y0 - y1); g.fillStyle = "#778"; g.font = "10px system-ui"; g.fillText(b.label, w - R - 36, y1 + 11); }
    g.strokeStyle = "#2c313b"; g.fillStyle = "#889"; g.font = "10px system-ui";
    for (const lv of [1, 10, 20, 30, 40]) { g.beginPath(); g.moveTo(X(lv), T); g.lineTo(X(lv), hh - Bm); g.stroke(); g.fillText(String(lv), X(lv) - 4, hh - 10); }
    for (const s of [1, 3, 10, 30, 100]) g.fillText(s + "s", 2, Y(s) + 3);
    g.fillText("level", w / 2 - 10, hh - 1);
    for (const q of pts) { g.fillStyle = odd.includes(q) ? "#e07a5f" : q.boss ? "#a58bd6" : "#8fb3c9"; g.beginPath(); g.arc(X(q.lv), Y(q.f.ttk), 3.5, 0, Math.PI * 2); g.fill(); q.x = X(q.lv); q.y = Y(q.f.ttk); }
    g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(X(me.lv), Y(me.f.ttk), 6, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
  };
  const pick = ev => {
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = 18 * 18;
    for (const q of pts) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best = q; } }
    tip.textContent = "";
    if (best) tip.append(link("#mob/" + best.o.id, best.o.Name), ` \u00b7 level ${best.lv} \u00b7 HP ${best.o.HP} ATK ${best.o.ATK} XP ${best.o.XP} \u00b7 ${best.f.ttk.toFixed(1)} s, ${Math.round(best.f.share * 100)}% of your health \u00b7 ${best.boss ? "boss" : best.band.over ? "beyond elite" : best.band.label.toLowerCase()}`);
    else tip.textContent = "Tap a dot to see the mob.";
  };
  cv.addEventListener("pointerdown", pick);
  wrap.append(h("div", { class: "hint" }, "Every mob that fights back, at its own level: seconds to kill one (log scale). White ring: this mob. Purple: bosses. Orange: out of line."), cv, tip);
  if (odd.length) wrap.append(h("div", { class: "mg-odd" }, h("b", {}, "Out of line: "),
    odd.slice(0, 16).map((q, i) => [i ? ", " : "", link("#mob/" + q.o.id, q.o.Name), h("span", { class: "hint" }, ` (${oddWhy(q)})`)])));
  requestAnimationFrame(draw);
  if (window.ResizeObserver) new ResizeObserver(() => draw()).observe(wrap);
  return wrap;
}
