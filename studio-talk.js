// Quest Studio: what the player sees when they talk to an NPC, and the quest
// conversation editor. Rules: the API's questtree.go (BQTalk, qtalk.js).
//
// Talking to an NPC opens on quest business, not the greeting: a hand-in here,
// then a talk objective aimed here, then a quest on offer. The greeting is
// only for when there is none (and it is the menu's top line after "Not right
// now."). A quest's offer / accept / in-progress / hand-in lines are each a
// single text box or a small conversation tree (quest_def.OfferTree ...); the
// player's own lines are authored (Replies, or the options of tree nodes).
const QS_ACT = { accept: "Accepts the quest", menu: "Back to the menu", offer: "Back to the offer", more: "Anything else? (next quest, else menu)", close: "Ends the chat", node: "" };
const QS_ACT_SHORT = { accept: "accepts", menu: "menu", offer: "back to offer", more: "anything else", close: "ends chat" };
const qsTarget = t => { const k = BQTalk.kindOf(t); return k === "node" ? BQTalk.norm(t) : ({ accept: "@accept", menu: BQTalk.norm(t).toLowerCase() === "@decline" ? "@decline" : "@menu", offer: "@offer", more: "@more", close: "@close" })[k]; };
const qsActLabel = t => { const k = BQTalk.kindOf(t); if (k === "node") return "-> " + qsShort(qsNodeTitle(t), 36); const a = BQTalk.norm(t).toLowerCase(); return a === "@decline" ? "Declines: back to the menu" : QS_ACT[k]; };
const qsShort = (t, n = 44) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "..." : t || "(empty)"; };
const qsNodeTitle = id => { const c = S.convBy[BQTalk.norm(id)]; return c ? c.Title : "(missing " + id + ")"; };
const qsNodeGet = id => { const c = S.convBy[id]; return c ? { Title: c.Title, Options: parseOptions(c.Options) } : null; };
const qsNodeRow = (c, patch) => ({ id: c.id, Identifier: c.Identifier, Title: c.Title, ImgPath: c.ImgPath || "", Options: c.Options, ReputationChange: c.ReputationChange || "", ItemsGiven: c.ItemsGiven || "", QuestStart: c.QuestStart || 0, ...patch });
const qsNewNodeRow = (ident, title, opts) => ({ id: 0, Identifier: ident, Title: title, ImgPath: "", Options: formatOptions(opts), ReputationChange: "", ItemsGiven: "", QuestStart: 0 });
const qsNodeSave = (c, patch, label) => qsCommit("conversation", qsNodeRow(c, patch), label).then(qsRerender);
const qsDlgEnabled = () => !!(S.c && S.c.hasDialogue);
async function qsDlgEnable() {
  try {
    await api("dialogueEnable"); await loadAll(); QS._an = null;
    qsToast("Quest conversations are on in this db (the API's 2026-10-26-quest-dialogue.sql). Nothing changed for existing quests.");
    status("Added quest_def.OfferTree, AcceptTree, ProgressTree, CompleteTree and Replies (content/migrations/2026-10-26-quest-dialogue.sql, after the daily quests one). Save .db or Export SQL to keep it.");
  } catch (e) { qsToast(e.message); status(e.message, true); }
  qsRerender();
}
const qsEnableBanner = () => h("div", { class: "qs-enable" }, h("b", {}, "Branching conversations and your own wording"),
  h("p", { class: "hint" }, "Writing your own \"I'll do it.\" / \"On it.\" / \"Not right now.\" and turning an offer into a conversation need the quest dialogue columns (the API's 2026-10-26-quest-dialogue.sql, which builds on the daily quests one). Nothing changes for existing quests. Safe to run twice."),
  h("button", { class: "qs-btn hot big", id: "qs-dlg-enable", onclick: qsDlgEnable }, "Enable quest conversations in this db"));

// ---- one screen of the game's conversation window, editable
// spec: { npc, tag, say: {value, ph, onSave, chips}, auto, rows: [row], adds, issues, node, onPlay, shared, cls }
// row:  { value, ph, onSave, chips, kind, act (element), onRemove, auto, note, node }
function qsScreen(spec) {
  const n = spec.npc;
  const bar = h("div", { class: "qs-sc-bar" }, h("span", { class: "qs-sc-who" }, n ? n.Name.toUpperCase() : "NOBODY"),
    h("span", { class: "qs-sc-tag", title: "The field this line is saved in" }, spec.tag),
    spec.shared ? h("span", { class: "qs-shared", title: spec.shared }, "shared") : null, h("span", { class: "qs-sp" }),
    spec.onPlay ? h("button", { class: "qs-mini qs-play-from", title: "Play from here in the game window", onclick: spec.onPlay }, "play") : null);
  const say = h("div", { class: "qs-sc-say", "data-line": spec.line || "" },
    qsInline(spec.say.value, spec.say.onSave, { multi: true, cls: "rh", ph: spec.say.ph, chips: spec.say.chips, title: "Click to write what they say" }),
    spec.auto ? h("div", { class: "qs-auto" }, spec.auto) : null);
  const rows = (spec.rows || []).map((r, i) => h("div", { class: "qs-op" + (r.auto ? " auto" : "") + " k-" + r.kind, "data-kind": r.kind, "data-opt": r.node ? r.node + ":" + i : "" },
    h("b", { class: "qs-op-n" }, i + 1 + "."),
    h("div", { class: "qs-op-t" }, r.onSave ? qsInline(r.value, r.onSave, { cls: "rh", ph: r.ph, chips: r.chips, title: r.auto ? "The game adds this line. Write your own words here" : "Click to write what the player says" }) : h("span", { class: "rh dflt" }, r.ph)),
    r.act, r.onRemove ? h("button", { class: "qs-mini qs-op-x", title: "Remove this answer", onclick: r.onRemove }, "x") : null,
    r.note ? h("div", { class: "qs-op-note" }, r.note) : null));
  return h("div", { class: "qs-sc" + (spec.cls ? " " + spec.cls : "") + ((spec.issues || []).some(x => x.sev !== "info") ? " warn" : ""), "data-node": spec.node || "" },
    bar,
    h("div", { class: "qs-sc-body" }, pix(n ? n.ImgPath : "", "bp"), say),
    rows.length ? h("div", { class: "qs-sc-opts" }, rows) : null,
    spec.adds && spec.adds.length ? h("div", { class: "qs-sc-add" }, spec.adds) : null,
    (spec.issues || []).length ? h("div", { class: "qs-sc-iss" }, spec.issues.map(x => h("div", { class: "qs-prob " + x.sev }, h("i", { class: "lg " + x.sev }), x.msg))) : null);
}
// A fixed tag for an answer whose action can't change (the single-box ones).
const qsActTag = (kind, text) => h("span", { class: "qs-act fixed act-" + kind, title: "What this answer does (fixed in the single text box: turn the line into a conversation to choose)" }, text || QS_ACT[kind]);

// ---- the sequence for one quest: what the player sees, in order
function qsFlow(q, o = {}) {
  const g = S.npcBy[q.Giver], t = S.npcBy[q.TurnIn], daily = qsIsDaily(q);
  const on = qsDlgEnabled();
  const patch = (p, label) => qsPatchQuest(q.id, p, label);
  const chips = () => qsChipKeys(q);
  const steps = qSteps(q);
  const sum = qSteps(daily ? qsDayDef(q) : q).map(s => "- " + (s.Text || stepLabel(s))).join("\n");
  const wrap = h("div", { class: "qs-flow", id: o.id || null });
  const replyEdit = kind => on ? v => patch({ Replies: BQTalk.withReply(q.Replies, kind, v) }, `${q.Title}: "${v || BQTalk.DEFAULTS[kind]}"`) : null;
  const replyVal = kind => BQTalk.parseReplies(q.Replies)[kind] || "";
  const dflt = kind => BQTalk.DEFAULTS[kind];
  const stageHead = (n, st, who) => h("div", { class: "qs-stage-h" }, h("b", { class: "qs-stage-n" }, n), h("div", {}, h("b", {}, st.label), h("small", {}, ` ${st.short}${who ? ", " + who.Name : ""}`)));
  const issuesFor = st => { const root = BQTalk.norm(q[st.tree]); return root ? BQTalk.analyse(root, qsNodeGet, st, q) : []; };
  if (!on) wrap.append(qsEnableBanner());
  // opening
  const linked = g && qsConvoLinks(g.id).has(q.id);
  if (!o.inConvo) wrap.append(h("div", { class: "qs-opening" }, h("b", {}, "How it opens: "), linked ? `${g.Name}'s chat brings it up when the player asks (see their conversation).` : `when a player talks to ${g ? g.Name : "the giver"} and this quest is available, the window opens straight on the offer (not the greeting). The greeting only shows when they have nothing to hand in, say or offer.`));
  // the four stages
  for (const [i, st] of BQTalk.STAGES.entries()) {
    const npc = S.npcBy[q[st.who]], root = on ? BQTalk.norm(q[st.tree]) : "", rootNode = root && S.convBy[root];
    const block = h("div", { class: "qs-stage", "data-stage": st.k }, stageHead(i + 1 + (i > 1 ? 1 : 0), st, npc));
    const iss = issuesFor(st);
    const play = () => qsPreviewQuest(q, st.k);
    if (rootNode) block.append(qsTreeStage(q, st, iss, chips, play));
    else {
      // the single text box
      const rows = st.def.map(d => ({ value: replyVal(d.reply), ph: dflt(d.reply), onSave: replyEdit(d.reply), chips, auto: true, kind: BQTalk.kindOf(d.to), act: qsActTag(BQTalk.kindOf(d.to), d.to === "@decline" ? "Declines: back to the menu" : null) }));
      if (st.k === "offer") rows.push({ value: "", ph: "Goodbye.", kind: "close", auto: true, act: qsActTag("close", "Ends the chat (automatic)") });
      block.append(qsScreen({ npc, tag: "quest_def." + st.text, line: st.text, say: { value: q[st.text], ph: `Write what ${npc ? npc.Name : "they"} say${daily ? " (use {mob}, {count}... for what changes)" : ""}`, onSave: v => patch({ [st.text]: v }, `${st.label} line`), chips }, auto: st.k === "offer" ? sum : st.k === "complete" ? qsRewardLine(q) : "", rows, onPlay: play,
        adds: on ? [h("button", { class: "qs-btn qs-conv", "data-stage": st.k, title: "Replace the single text box by a small conversation: questions the player can ask, then the answer", onclick: () => qsTreeConvert(q, st) }, "Turn into a conversation")] : [] }));
    }
    if (iss.length && !rootNode) block.append(h("div", { class: "qs-iss" }, iss.map(x => h("div", { class: "qs-prob " + x.sev }, h("i", { class: "lg " + x.sev }), x.msg))));
    wrap.append(block);
    // talk objectives sit between accepting and coming back
    if (st.k === "accept") {
      const talks = steps.map((s, k) => [s, k]).filter(([s]) => s.Type === "talk");
      for (const [s, k] of talks) wrap.append(h("div", { class: "qs-stage", "data-stage": "talk" }, h("div", { class: "qs-stage-h" }, h("b", { class: "qs-stage-n" }, 3), h("div", {}, h("b", {}, `Objective ${k + 1}: talk`), h("small", {}, ` the first thing they hear when you get there, ${npcName(s.NPC)}`))),
        qsScreen({ npc: S.npcBy[s.NPC], tag: `Steps[${k + 1}].Line`, line: "step:" + k, say: { value: s.Line, ph: "What they say when you get there", onSave: v => { const a = qSteps(q); a[k].Line = v; return patch({ Steps: JSON.stringify(a) }, `${npcName(s.NPC)}'s line`); }, chips },
          rows: [{ value: "", ph: "Right.", kind: "node", auto: true, act: qsActTag("node", "Continues: next business here, else the menu") }] })));
    }
  }
  // the end: shared lines
  const gn = o.npc || t || g;
  wrap.append(h("div", { class: "qs-stage end" }, h("div", { class: "qs-stage-h" }, h("b", { class: "qs-stage-n" }, "..."), h("div", {}, h("b", {}, "Then"), h("small", {}, " \"" + (BQTalk.reply(q, "AnythingElse")) + "\" opens their next quest on offer, which starts on its own offer; with none left, their menu and greeting"))),
    gn && !o.noGreeting ? qsGreetingBox(gn, { compact: true }) : null));
  return wrap;
}
const qsRewardLine = q => { const r = [+q.XP ? `${q.XP} XP` : "", +q.Gold ? `${q.Gold} Gold` : "", ...qRw(q).map(x => (S.itemBy[x.ItemID] ? `${x.Amount}x ${S.itemBy[x.ItemID].Name}` : ""))].filter(Boolean); return r.length ? "Reward: " + r.join(", ") : "No reward"; };

// ---- a stage as a conversation tree
function qsActSelect(q, st, curTarget, onChange) {
  const base = { offer: ["@accept", "@decline", "@offer", "@close"], accept: ["@close", "@menu", "@more"], progress: ["@menu", "@close", "@more"], complete: ["@more", "@menu", "@close"] }[st.k];
  const root = BQTalk.norm(q[st.tree]), nodes = BQTalk.walk(root, qsNodeGet).order;
  const cur = qsTarget(curTarget);
  const sel = h("select", { class: "qs-act act-" + BQTalk.kindOf(curTarget), title: "Where this answer goes" },
    h("optgroup", { label: "Does" }, [...new Set([...base, ...(BQTalk.kindOf(cur) !== "node" ? [cur] : [])])].map(a => h("option", { value: a }, qsActLabel(a)))),
    h("optgroup", { label: "Goes to another line" }, nodes.map(id => h("option", { value: id }, "-> " + (qsShort(S.convBy[id].Title || "", 40) || "a new line (not written yet)"))),
      BQTalk.kindOf(cur) === "node" && !nodes.includes(cur) ? [h("option", { value: cur }, "-> " + cur + " (missing)")] : [], h("option", { value: "+new" }, "+ a new line..."))
  );
  sel.value = cur;
  sel.onchange = () => onChange(sel.value);
  return sel;
}
function qsTreeStage(q, st, issues, chips, play) {
  const root = BQTalk.norm(q[st.tree]), npc = S.npcBy[q[st.who]];
  const shown = new Set();
  const patch = (p, label) => qsPatchQuest(q.id, p, label);
  const bad = new Map(); for (const x of issues) { (bad.get(x.node) || bad.set(x.node, []).get(x.node)).push(x); }
  const cur = id => S.convBy[id];
  const setOpts = (c, o, label, more) => qsCommitMany([{ table: "conversation", row: qsNodeRow(c, { Options: formatOptions(o) }) }, ...(more || [])], label).then(qsRerender).catch(() => {});
  const nodeEl = (ident, depth) => {
    const c = cur(ident);
    if (!c) return h("div", { class: "qs-bub bad" }, `Missing line "${ident}": this answer is a dead end. `, h("button", { class: "qs-mini", onclick: () => qsCommit("conversation", qsNewNodeRow(ident, "", [[st.backText, st.back]]), `Created ${ident}`).then(qsRerender) }, "create it"));
    if (shown.has(ident)) return h("a", { class: "qs-back", href: "#", onclick: e => { e.preventDefault(); const t = document.querySelector(`.qs-stage[data-stage="${st.k}"] .qs-sc[data-node="${CSS.escape(ident)}"]`); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); } } }, "<- back to \"", qsShort(c.Title, 36), "\" (above)");
    shown.add(ident);
    const isRoot = ident === root, opts = parseOptions(c.Options);
    const rows = opts.map(([label, to], i) => ({
      value: label, ph: "What the player says", chips, kind: BQTalk.kindOf(to), node: ident,
      onSave: v => { const o = parseOptions(cur(ident).Options); o[i][0] = v || label; return qsNodeSave(cur(ident), { Options: formatOptions(o) }, "Answer edited"); },
      act: qsActSelect(q, st, to, async val => {
        const o = parseOptions(cur(ident).Options);
        if (val === "+new") {
          const ni = BQTalk.newIdent(q, "line", x => !!S.convBy[x]);
          o[i][1] = ni;
          await setOpts(cur(ident), o, "Answer goes to a new line", [{ table: "conversation", row: qsNewNodeRow(ni, "", [[st.backText, st.back]]) }]);
          setTimeout(() => { const e = document.querySelector(`.qs-sc[data-node="${CSS.escape(ni)}"] .qs-sc-say .qs-ed`); if (e && e.open) e.open(); }, 80);
        } else { o[i][1] = val; setOpts(cur(ident), o, "Answer re-routed"); }
      }),
      onRemove: () => qsRemoveOption(q, st, ident, i),
    }));
    // what the game adds to the first line when the author left them out
    if (isRoot && st.k === "offer") {
      const kinds = opts.map(([, t]) => BQTalk.kindOf(t));
      if (!kinds.includes("accept")) rows.push({ value: BQTalk.parseReplies(q.Replies).Accept || "", ph: BQTalk.DEFAULTS.Accept, chips, auto: true, kind: "accept", onSave: v => patch({ Replies: BQTalk.withReply(q.Replies, "Accept", v) }, "Accept line"), act: qsActTag("accept", "Accepts (added by the game: write your own answer above)"), node: ident });
      if (!kinds.includes("menu")) rows.push({ value: BQTalk.parseReplies(q.Replies).Decline || "", ph: BQTalk.DEFAULTS.Decline, chips, auto: true, kind: "menu", onSave: v => patch({ Replies: BQTalk.withReply(q.Replies, "Decline", v) }, "Decline line"), act: qsActTag("menu", "Declines (added by the game)"), node: ident });
    }
    if (!opts.some(([, t]) => BQTalk.kindOf(t) === "close") && !rows.some(r => r.kind === "close")) rows.push({ value: "", ph: "Goodbye.", kind: "close", auto: true, act: qsActTag("close", "Ends the chat (automatic)") });
    const adds = [h("button", { class: "qs-btn qs-addq", title: "Add something the player can ask, and what they say back", onclick: () => qsAddQuestion(q, st, ident) }, "+ question"),
      ...(st.k === "offer" ? [h("button", { class: "qs-btn qs-adda", "data-do": "@accept", onclick: () => qsAddAnswer(q, st, ident, "@accept", "Fine, I'll do it.") }, "+ accept answer"), h("button", { class: "qs-btn qs-adda", "data-do": "@decline", onclick: () => qsAddAnswer(q, st, ident, "@decline", "Maybe later.") }, "+ decline answer")]
        : [h("button", { class: "qs-btn qs-adda", "data-do": st.back, onclick: () => qsAddAnswer(q, st, ident, st.back, st.backText) }, "+ answer")])];
    const el = qsScreen({ npc, tag: (isRoot ? "first line " : "line ") + ident, node: ident, line: isRoot ? st.text : "", cls: isRoot ? "root" : "sub",
      say: { value: c.Title, ph: "What they say", chips, onSave: v => qsNodeSave(cur(ident), { Title: v }, `${npc ? npc.Name : "NPC"}: line edited`) },
      auto: isRoot && st.k === "offer" ? qsSum(q) : isRoot && st.k === "complete" ? qsRewardLine(q) : "", rows, adds, issues: bad.get(ident), onPlay: isRoot ? play : () => qsPreviewQuest(q, ident) });
    // the lines the answers lead to, nested under their answer
    const kids = h("div", { class: "qs-branches" });
    opts.forEach(([, to], i) => { if (BQTalk.kindOf(to) === "node") kids.append(h("div", { class: "qs-branch" }, h("small", { class: "qs-branch-l" }, `${i + 1}. leads to:`), nodeEl(BQTalk.norm(to), depth + 1))); });
    return kids.childNodes.length ? h("div", { class: "qs-nodewrap" }, el, kids) : el;
  };
  const tree = nodeEl(root, 0);
  const walked = BQTalk.walk(root, qsNodeGet);
  const orph = BQTalk.orphans(q, S.c.conversations, qsNodeGet);
  const out = h("div", { class: "qs-tree" },
    h("div", { class: "qs-tree-h" }, h("b", {}, `A conversation (${walked.order.length} line${walked.order.length === 1 ? "" : "s"})`), h("span", { class: "qs-sp" }),
      h("button", { class: "qs-mini", title: "Go back to one text box (the lines stay in the db)", onclick: () => patch({ [st.tree]: "" }, `${st.label}: single text box again`) }, "one box again")),
    walked.order.length > 1 ? qsOutline(q, st, root) : null,
    tree);
  const loose = orph.filter(id => { const k = BQTalk.STAGES.find(s => BQTalk.walk(BQTalk.norm(q[s.tree]), qsNodeGet).seen.has(id)); return !k; });
  if (loose.length && st.k === "offer") out.append(h("div", { class: "qs-rule" }, "Lines nobody reaches: ", loose.map(id => h("span", { class: "qs-chip" }, id))));
  const inTree = new Set(walked.order), top = issues.filter(x => !inTree.has(x.node) || x.nodes);
  if (top.length) out.prepend(h("div", { class: "qs-iss" }, top.map(x => h("div", { class: "qs-prob " + x.sev }, h("i", { class: "lg " + x.sev }), x.msg))));
  return out;
}
const qsSum = q => qSteps(qsIsDaily(q) ? qsDayDef(q) : q).map(s => "- " + (s.Text || stepLabel(s))).join("\n");
// The whole tree at a glance: every line with its answers as coloured tags.
function qsOutline(q, st, root) {
  const seen = new Set();
  const go = (id, depth) => {
    const c = S.convBy[id];
    if (!c) return h("li", { class: "qs-ol bad" }, `${id} (missing)`);
    if (seen.has(id)) return h("li", { class: "qs-ol back" }, "<- " + qsShort(c.Title, 30));
    seen.add(id);
    const opts = parseOptions(c.Options);
    const li = h("li", { class: "qs-ol" }, h("button", { class: "qs-ol-n", title: "Jump to this line", onclick: () => { const t = document.querySelector(`.qs-stage[data-stage="${st.k}"] .qs-sc[data-node="${CSS.escape(id)}"]`); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); } } }, qsShort(c.Title, 46)),
      h("ul", {}, opts.map(([l, to]) => { const k = BQTalk.kindOf(to); return k === "node" ? h("li", { class: "qs-ol-o" }, h("span", { class: "qs-tag act-node" }, qsShort(l, 30)), go(BQTalk.norm(to), depth + 1)) : h("li", { class: "qs-ol-o" }, h("span", { class: "qs-tag act-" + k }, qsShort(l, 30), h("i", {}, " " + QS_ACT_SHORT[k]))); })));
    return li;
  };
  return h("details", { class: "qs-outline", open: true }, h("summary", {}, "The whole conversation at a glance"), h("ul", { class: "qs-ol-root" }, go(root, 0)));
}
// ---- tree edits (each one undo step)
async function qsAddQuestion(q, st, nodeId) {
  const c = S.convBy[nodeId], o = parseOptions(c.Options);
  const ni = BQTalk.newIdent(q, "ask", x => !!S.convBy[x]);
  const at = o.findIndex(([, t]) => ["accept", "menu"].includes(BQTalk.kindOf(t)));
  o.splice(at < 0 ? o.length : at, 0, ["Tell me more.", ni]);
  await qsCommitMany([{ table: "conversation", row: qsNodeRow(c, { Options: formatOptions(o) }) }, { table: "conversation", row: qsNewNodeRow(ni, "", [[st.backText, st.back]]) }], "+ question").catch(() => {});
  qsRerender();
  setTimeout(() => { const e = document.querySelector(`.qs-op[data-opt="${CSS.escape(nodeId)}:${at < 0 ? o.length - 1 : at}"] .qs-ed`); if (e && e.open) e.open(); }, 120);
}
async function qsAddAnswer(q, st, nodeId, target, text) {
  const c = S.convBy[nodeId], o = parseOptions(c.Options);
  o.push([text, target]);
  await qsCommitMany([{ table: "conversation", row: qsNodeRow(c, { Options: formatOptions(o) }) }], "+ answer").catch(() => {});
  qsRerender();
  setTimeout(() => { const e = document.querySelector(`.qs-op[data-opt="${CSS.escape(nodeId)}:${o.length - 1}"] .qs-ed`); if (e && e.open) e.open(); }, 120);
}
// Removing an answer also removes the line it led to when nothing else uses it.
async function qsRemoveOption(q, st, nodeId, i) {
  const c = S.convBy[nodeId], o = parseOptions(c.Options), [, to] = o[i];
  o.splice(i, 1);
  const list = [{ table: "conversation", row: qsNodeRow(c, { Options: formatOptions(o) }) }];
  // lines only reachable through the removed answer
  const roots = BQTalk.STAGES.map(s => BQTalk.norm(q[s.tree])).filter(Boolean);
  const after = id => (id === nodeId ? { Title: c.Title, Options: o } : qsNodeGet(id));
  const keep = new Set(); for (const r of roots) for (const id of BQTalk.walk(r, after).order) keep.add(id);
  const before = new Set(); for (const r of roots) for (const id of BQTalk.walk(r, qsNodeGet).order) before.add(id);
  for (const id of before) if (!keep.has(id) && S.convBy[id] && id.startsWith("q" + q.id + "-") && !BQTalk.STAGES.some(s => BQTalk.norm(q[s.tree]) === id)) list.push({ table: "conversation", id: S.convBy[id].id, delete: true });
  await qsCommitMany(list, list.length > 1 ? "Removed an answer and its lines" : "Removed an answer").catch(() => {});
  qsRerender();
}
// Single text box -> a conversation whose first line is that text.
async function qsTreeConvert(q, st) {
  const ident = BQTalk.newIdent(q, st.k === "offer" ? "offer" : st.k, x => !!S.convBy[x]);
  const rp = BQTalk.parseReplies(q.Replies);
  const opts = st.def.map(d => [rp[d.reply] || BQTalk.DEFAULTS[d.reply], d.to]);
  await qsCommitMany([{ table: "conversation", row: qsNewNodeRow(ident, q[st.text] || "", opts) }, { table: "quest_def", row: { ...q, [st.tree]: ident } }], `${st.label}: now a conversation`).catch(() => {});
  qsRerender();
  setTimeout(() => { const b = document.querySelector(`.qs-stage[data-stage="${st.k}"] .qs-addq`); if (b) b.scrollIntoView({ block: "center" }); }, 150);
}

// ---- the NPC's greeting: shared by all their quests
function qsGreetingBox(n, o = {}) {
  const c = n.Conversation && S.convBy[n.Conversation];
  const r = qsRoles(n), n1 = r.gives.length + r.takes.length;
  const shared = `Shared: ${n.Name}'s greeting is the same for all ${r.all.length || "their"} quests. It shows when they have nothing to hand in, say or offer, and under "Not right now.". Edit it on ${n.Name}'s sheet.`;
  if (!c) return h("div", { class: "qs-greet none" }, h("div", { class: "qs-sc-bar" }, h("span", { class: "qs-sc-who" }, n.Name.toUpperCase()), h("span", { class: "qs-sc-tag" }, "greeting"), h("span", { class: "qs-shared", title: shared }, "shared")),
    h("p", { class: "hint" }, n.Conversation ? `Their greeting node "${n.Conversation}" doesn't exist.` : `${n.Name} has no greeting yet.`),
    h("button", { class: "qs-btn hot", id: "qs-greet-new", onclick: () => qsGreetingCreate(n) }, `Give ${n.Name} a greeting`));
  const opts = parseOptions(c.Options);
  const rows = opts.map(([l, to], i) => ({ value: l, ph: "What the player says", kind: to === "1" || to === "" ? "close" : "node", node: c.Identifier,
    onSave: v => { const x = parseOptions(S.convBy[c.Identifier].Options); x[i][0] = v || l; return qsNodeSave(S.convBy[c.Identifier], { Options: formatOptions(x) }, "Greeting answer edited"); },
    act: h("span", { class: "qs-act fixed act-" + (to === "1" || to === "" ? "close" : "node") }, to === "1" || to === "" ? "Ends the chat" : "-> " + qsShort(qsNodeTitle(to), 30)) }));
  const el = qsScreen({ npc: n, tag: "greeting " + c.Identifier + " (npc.Conversation)", node: c.Identifier, line: "Greeting", shared, cls: "greeting",
    say: { value: c.Title, ph: "What they say when they have nothing for you", onSave: v => qsNodeSave(S.convBy[c.Identifier], { Title: v }, `${n.Name}'s greeting edited`) },
    auto: (o.compact ? "" : "Above these, the game lists their quest rows ([Quest] / [Daily] / [In progress] ...) and any plot rows."), rows, onPlay: () => qsPreviewGreeting(n) });
  return h("div", { class: "qs-greet" }, el, h("small", { class: "hint" }, `Shared by all of ${n.Name}'s quests. `, o.compact ? h("a", { href: "#studio/npc/" + n.id }, "Edit it on their sheet") : "The rest of their chat is further down."));
}
async function qsGreetingCreate(n) {
  const prefix = "npc-" + n.Name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let i = 1; while (S.convBy[`${prefix}-${i}`]) i++;
  const ident = `${prefix}-${i}`;
  await qsCommitMany([{ table: "conversation", row: qsNewNodeRow(ident, "Hello there.", [["Goodbye.", "1"]]) }, { table: "npc", row: { ...S.npcBy[n.id], Conversation: ident } }], `Greeting for ${n.Name}`).catch(() => {});
  qsRerender();
}
// Play the greeting alone: a player with nothing to do here.
function qsPreviewGreeting(n) {
  const P = { level: 1, done: new Set(), state: {}, follow: false, talked: {} };
  const close = () => { ov.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const panel = qsGamePanel(n, { P, start: "menu" });
  const ov = h("div", { class: "qs-modal", onclick: e => { if (e.target === ov) close(); } }, h("div", { class: "qs-gwrap" }, panel,
    h("div", { class: "qs-row" }, h("span", { class: "hint" }, "As a level 1 player with nothing to do here: the greeting."), h("button", { class: "qs-btn", onclick: close }, "Close"))));
  document.body.append(ov); document.addEventListener("keydown", esc, true);
}

// ---- conversation first: an NPC's whole conversation as one tree
// The greeting (npc.Conversation) and the chat lines it leads to, with the
// quests that grow out of it as branches: an answer whose target is
// "@quest:<id>" brings that quest up (its offer, then accept / decline, after
// accepting, in progress, the hand-in), all editable in place. Quests nobody
// links still open straight away when available (quest-first); the server's
// rules are npc.go convoQuestLinks / questLinkKey.
const qsLinkOf = to => { const m = /^@quest:(\d+)$/i.exec(String(to == null ? "" : to).trim()); return m ? +m[1] : 0; };
const qsIsChatTarget = to => { const t = String(to == null ? "" : to).trim(); return !!t && t !== "1" && !t.startsWith("@"); };
// [[nodeId, answerIndex], ...] from the greeting to the answer that brings up
// quest qid, or null.
function qsConvoPath(n, qid) {
  if (!n || !n.Conversation || !S.convBy[n.Conversation]) return null;
  const prev = new Map([[n.Conversation, null]]), todo = [n.Conversation];
  while (todo.length) {
    const id = todo.shift(), c = S.convBy[id]; if (!c) continue;
    const opts = parseOptions(c.Options);
    for (let i = 0; i < opts.length; i++) {
      const to = String(opts[i][1]).trim();
      if (qsLinkOf(to) === qid) { const path = [[id, i]]; for (let p = prev.get(id); p; p = prev.get(p[0])) path.unshift(p); return path; }
      if (qsIsChatTarget(to) && !prev.has(to)) { prev.set(to, [id, i]); todo.push(to); }
    }
  }
  return null;
}
const qsChatPrefix = n => (n.Conversation || "npc-" + n.Name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-1").replace(/-\d+$/, "");
const qsChatIdent = n => { const p = qsChatPrefix(n); let i = 1; while (S.convBy[`${p}-${i}`]) i++; return `${p}-${i}`; };
const qsChatNodes = n => { const out = [], seen = new Set(); const go = id => { const c = S.convBy[id]; if (!c || seen.has(id)) return; seen.add(id); out.push(id); for (const [, to] of parseOptions(c.Options)) if (qsIsChatTarget(to)) go(String(to).trim()); }; if (n.Conversation) go(n.Conversation); return out; };
const qsNpcQuests = n => qsOrder().filter(q => q.Giver === n.id);
// Make quest q come up from line nodeId (default: the greeting).
async function qsLinkQuest(n, q, nodeId, label) {
  const c = S.convBy[nodeId || n.Conversation];
  if (!c) { qsToast(`${n.Name} needs a greeting first`); return; }
  const o = parseOptions(c.Options);
  const at = o.findIndex(([, t]) => String(t).trim() === "1" || t === "");
  o.splice(at < 0 ? o.length : at, 0, [label || "Got any work for me?", "@quest:" + q.id]);
  await qsCommitMany([{ table: "conversation", row: qsNodeRow(c, { Options: formatOptions(o) }) }], `${q.Title} now comes up in ${n.Name}'s chat`).catch(() => {});
  qsRerender();
}
// A brand new quest from a line: the quick quest maker, then the answer.
function qsQuestFromLine(n, nodeId) {
  qsNewQuest(0, n.id, { onMade: async id => { const q = qById(id); if (q) { QS.convoOpen = id; await qsLinkQuest(n, q, nodeId, "Got any work for me?"); } } });
}
// Where an answer on a chat line goes.
function qsChatDest(n, curTo, onChange) {
  const nodes = qsChatNodes(n), cur = String(curTo == null ? "" : curTo).trim() || "1";
  const qs = qsNpcQuests(n), lq = qsLinkOf(cur);
  const sel = h("select", { class: "qs-act act-" + (lq ? "quest" : cur === "1" ? "close" : "node"), title: "Where this answer goes" },
    h("option", { value: "1" }, "Ends the chat"),
    h("optgroup", { label: "Goes to a line" }, nodes.map(id => h("option", { value: id }, "-> " + (qsShort(S.convBy[id].Title || "", 40) || "a new line (not written yet)"))),
      qsIsChatTarget(cur) && !nodes.includes(cur) ? h("option", { value: cur }, "-> " + cur + " (missing)") : null, h("option", { value: "+new" }, "+ a new line...")),
    h("optgroup", { label: "Brings up a quest" }, qs.map(q => h("option", { value: "@quest:" + q.id }, "Quest: " + qsShort(q.Title, 36))),
      lq && !qs.some(q => q.id === lq) ? h("option", { value: cur }, `Quest ${lq} (not ${n.Name}'s)`) : null, h("option", { value: "+quest" }, "+ a new quest...")));
  sel.value = lq ? "@quest:" + lq : cur;
  sel.onchange = () => onChange(sel.value);
  return sel;
}
// One chat line (a conversation node) as the game window, editable; its
// answers lead on to lines or quests, drawn under it. o.path: only the line
// (no branches), with answer o.pathAt marked as the way on.
function qsChatLine(n, ident, ctx, o = {}) {
  const c = S.convBy[ident];
  if (!c) return h("div", { class: "qs-bub bad" }, `Missing line "${ident}": this answer is a dead end. `,
    h("button", { class: "qs-mini", onclick: () => qsCommit("conversation", qsNewNodeRow(ident, "", [["Goodbye.", "1"]]), `Created ${ident}`).then(qsRerender) }, "create it"));
  if (ctx.shown.has(ident) && !o.path) return h("a", { class: "qs-back", href: "#", onclick: e => { e.preventDefault(); const t = ctx.root.querySelector(`.qs-sc[data-node="${CSS.escape(ident)}"]`); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash"); } } }, "<- back to \"", qsShort(c.Title, 36), "\" (above)");
  ctx.shown.add(ident);
  const isRoot = ident === n.Conversation, opts = parseOptions(c.Options);
  const cur = () => S.convBy[ident];
  const setOpts = (op, label, more) => qsCommitMany([{ table: "conversation", row: qsNodeRow(cur(), { Options: formatOptions(op) }) }, ...(more || [])], label).then(qsRerender).catch(() => {});
  const rows = opts.map(([label, to], i) => {
    const lq = qsLinkOf(to), q = lq && qById(lq);
    return {
      value: label, ph: "What the player says", kind: lq ? "quest" : qsIsChatTarget(to) ? "node" : "close", node: ident,
      onSave: v => { const op = parseOptions(cur().Options); op[i][0] = v || label; return qsNodeSave(cur(), { Options: formatOptions(op) }, "Answer edited"); },
      act: qsChatDest(n, to, async val => {
        const op = parseOptions(cur().Options);
        if (val === "+new") {
          const ni = qsChatIdent(n); op[i][1] = ni;
          await setOpts(op, "Answer goes to a new line", [{ table: "conversation", row: qsNewNodeRow(ni, "", [["Goodbye.", "1"]]) }]);
          setTimeout(() => { const e = document.querySelector(`.qs-sc[data-node="${CSS.escape(ni)}"] .qs-sc-say .qs-ed`); if (e && e.open) e.open(); }, 80);
        } else if (val === "+quest") {
          qsNewQuest(0, n.id, { onMade: async id => { const p = parseOptions(cur().Options); p[i][1] = "@quest:" + id; QS.convoOpen = id; await setOpts(p, "Answer brings up the new quest"); } });
        } else { op[i][1] = val; if (qsLinkOf(val)) QS.convoOpen = qsLinkOf(val); setOpts(op, "Answer re-routed"); }
      }),
      onRemove: () => { const op = parseOptions(cur().Options); op.splice(i, 1); setOpts(op, "Answer removed"); },
      note: q && !o.path && q.Giver !== n.id ? h("span", { class: "qs-prob warn" }, `${q.Title} is given by ${npcName(q.Giver)}: the game hides this answer here`) : null,
    };
  });
  if (!opts.some(([, t]) => !qsIsChatTarget(t) && !qsLinkOf(t))) rows.push({ value: "", ph: "Goodbye.", kind: "close", auto: true, act: qsActTag("close", "Ends the chat (automatic)") });
  const adds = o.path ? [] : [
    h("button", { class: "qs-btn qs-addq", title: "Something the player can ask, and what they say back", onclick: async () => {
      const ni = qsChatIdent(n), op = parseOptions(cur().Options);
      const at = op.findIndex(([, t]) => !qsIsChatTarget(t) && !qsLinkOf(t));
      op.splice(at < 0 ? op.length : at, 0, ["Tell me more.", ni]);
      await setOpts(op, "+ question", [{ table: "conversation", row: qsNewNodeRow(ni, "", [["Back.", ident], ["Goodbye.", "1"]]) }]);
      setTimeout(() => { const e = document.querySelector(`.qs-op[data-opt="${CSS.escape(ident)}:${at < 0 ? op.length - 1 : at}"] .qs-ed`); if (e && e.open) e.open(); }, 120);
    } }, "+ question"),
    h("button", { class: "qs-btn hot qs-addquest", title: `A new quest that ${n.Name} brings up when the player picks this answer`, onclick: () => qsQuestFromLine(n, ident) }, "+ quest from here"),
    ...(qsNpcQuests(n).length ? [(() => {
      const s = h("select", { class: "qs-sel qs-linkq", title: "Bring up one of their quests from this line" }, h("option", { value: "" }, "+ link a quest..."), qsNpcQuests(n).map(q => h("option", { value: q.id }, q.Title)));
      s.onchange = () => { const q = qById(+s.value); if (q) { QS.convoOpen = q.id; qsLinkQuest(n, q, ident, "About " + q.Title.replace(/\{[a-z]+\}/g, "this") + "..."); } };
      return s;
    })()] : [])];
  const el = qsScreen({ npc: n, tag: (isRoot ? "greeting " : "line ") + ident, node: ident, line: isRoot ? "Greeting" : "", cls: (isRoot ? "greeting root" : "sub") + (o.path ? " path" : ""),
    say: { value: c.Title, ph: isRoot ? "What they say when you talk to them" : "What they say", onSave: v => qsNodeSave(cur(), { Title: v }, `${n.Name}: line edited`) },
    rows, adds, onPlay: () => (isRoot ? qsPreviewGreeting(n) : null) });
  if (o.path) { const r = el.querySelectorAll(".qs-op")[o.pathAt]; if (r) r.classList.add("way"); return el; }
  const kids = h("div", { class: "qs-branches" });
  opts.forEach(([label, to], i) => {
    const lq = qsLinkOf(to);
    if (lq) { const q = qById(lq); kids.append(h("div", { class: "qs-branch" }, h("small", { class: "qs-branch-l" }, `${i + 1}. "${qsShort(label, 30)}" brings up:`), q ? qsQuestBranch(q, n, ctx) : h("div", { class: "qs-bub bad" }, `Quest ${lq} doesn't exist: the game hides this answer`))); }
    else if (qsIsChatTarget(to)) kids.append(h("div", { class: "qs-branch" }, h("small", { class: "qs-branch-l" }, `${i + 1}. leads to:`), qsChatLine(n, String(to).trim(), ctx)));
  });
  return kids.childNodes.length ? h("div", { class: "qs-nodewrap" }, el, kids) : el;
}
// A quest inside the conversation: its whole flow, folded unless it's the
// one being worked on.
function qsQuestBranch(q, n, ctx, why) {
  const open = QS.convoOpen === q.id || ctx.open === q.id || ctx.openAll;
  const d = h("details", { class: "qs-qbranch" + (qsIsDaily(q) ? " daily" : ""), "data-quest": q.id, open },
    h("summary", {}, h("span", { class: "qs-qtag" }, "QUEST"), h("span", { class: "qc-lv" }, q.Level), " ", qsIsDaily(q) ? [qsDailyBadge(), " ", qsPh(q.Title)] : h("b", {}, q.Title),
      h("small", {}, " " + (why || qSteps(q).map(s => s.Text || stepLabel(s)).join(", ")))),
    h("div", { class: "qs-qbody" }, h("div", { class: "qs-row wrap" }, h("a", { class: "qs-link", href: "#studio/journey/" + q.id }, "objectives, rewards and story"),
      h("button", { class: "qs-mini", onclick: () => qsPreviewQuest(q) }, "play it"))));
  const fill = () => { const b = d.querySelector(".qs-qbody"); if (b.childNodes.length === 1) b.append(qsFlow(q, { npc: n, noGreeting: true, inConvo: true })); };
  if (open) fill();
  d.addEventListener("toggle", () => { if (d.open) { QS.convoOpen = q.id; fill(); } });
  return d;
}
// The whole conversation of NPC n. o.open: a quest id to unfold.
function qsConvo(n, o = {}) {
  const box = h("div", { class: "qs-convo" });
  const ctx = { shown: new Set(), root: box, open: o.open };
  const r = qsRoles(n), links = qsConvoLinks(n.id);
  box.append(h("div", { class: "qs-rule" }, "Talking to ", h("b", {}, n.Name), " opens on a hand-in or a talk objective first. Otherwise they greet you, and the chat can bring up their quests: pick \"+ quest from here\" on any line, or route an answer to a quest. A quest nobody brings up opens straight away when it's available."));
  if (!n.Conversation || !S.convBy[n.Conversation]) {
    box.append(h("div", { class: "qs-greet none" }, h("p", { class: "hint" }, n.Conversation ? `Their greeting "${n.Conversation}" doesn't exist.` : `${n.Name} has nothing to say yet.`),
      h("button", { class: "qs-btn hot", id: "qs-greet-new", onclick: () => qsGreetingCreate(n) }, `Give ${n.Name} a greeting`)));
  } else box.append(qsChatLine(n, n.Conversation, ctx));
  const own = qsNpcQuests(n).filter(q => !links.has(q.id));
  if (own.length) box.append(h("div", { class: "qs-own" }, h("h4", {}, "Opens straight away ", h("span", { class: "hint" }, "not brought up in the chat: when it's available, talking opens on its offer")),
    own.map(q => h("div", { class: "qs-branch" }, qsQuestBranch(q, n, ctx), n.Conversation && S.convBy[n.Conversation] ? h("button", { class: "qs-mini qs-tochat", onclick: () => { QS.convoOpen = q.id; qsLinkQuest(n, q, n.Conversation, "Got any work for me?"); } }, "bring it up from the greeting instead") : null))));
  const takes = r.takes.filter(q => q.Giver !== n.id);
  if (takes.length) box.append(h("div", { class: "qs-own" }, h("h4", {}, "Hand-ins here ", h("span", { class: "hint" }, "other NPCs' quests that end with " + n.Name)), takes.map(q => qsQuestBranch(q, n, ctx, "from " + npcName(q.Giver)))));
  return box;
}
// A quest sheet's conversation: where it comes from in the giver's chat
// (greeting -> the lines on the way -> the answer that brings it up), then
// its own lines, all editable here.
function qsQuestInConvo(q) {
  const g = S.npcBy[q.Giver];
  const wrap = h("div", { class: "qs-qconvo" });
  if (g) {
    const path = qsConvoPath(g, q.id), ctx = { shown: new Set(), root: wrap };
    if (path) {
      const lead = h("div", { class: "qs-path" });
      path.forEach(([id, i], k) => { lead.append(qsChatLine(g, id, ctx, { path: true, pathAt: i })); if (k < path.length - 1) lead.append(h("div", { class: "qs-pathstep" }, "then")); });
      wrap.append(h("div", { class: "qs-stage", "data-stage": "lead" }, h("div", { class: "qs-stage-h" }, h("b", { class: "qs-stage-n" }, "0"), h("div", {}, h("b", {}, "In the chat"), h("small", {}, ` how ${g.Name} brings it up (`, h("a", { href: "#studio/npc/" + g.id }, "their whole conversation"), ")"))), lead));
    } else {
      wrap.append(h("div", { class: "qs-stage", "data-stage": "lead" }, h("div", { class: "qs-stage-h" }, h("b", { class: "qs-stage-n" }, "0"), h("div", {}, h("b", {}, "In the chat"), h("small", {}, " not brought up yet: it opens straight away when it's available"))),
        g.Conversation && S.convBy[g.Conversation] ? qsChatLine(g, g.Conversation, ctx, { path: true, pathAt: -1 }) : null,
        h("div", { class: "qs-row wrap" }, g.Conversation && S.convBy[g.Conversation] ? h("button", { class: "qs-btn hot", id: "qs-bring-up", onclick: () => qsLinkQuest(g, q, g.Conversation, "Got any work for me?") }, `Bring it up in ${g.Name}'s chat`) : h("button", { class: "qs-btn", onclick: () => qsGreetingCreate(g) }, `Give ${g.Name} a greeting`))));
    }
  }
  wrap.append(qsFlow(q, { noGreeting: false, inConvo: true }));
  return wrap;
}
