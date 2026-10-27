// Quest conversations: the rules of the API's questtree.go as pure functions
// (no DOM), so Quest Studio and its tests can share them.
//
// A quest can have a conversation tree for each stage (OfferTree, AcceptTree,
// ProgressTree, CompleteTree: the Identifier of a root node in the
// `conversation` table) and its own wording for the fixed player lines
// (Replies JSON: Accept, Decline, OnIt, Back, AnythingElse). A node's options
// are [['Player line','target']]; target = another node's Identifier or one
// of the @actions. A talk objective has the NPC's Line and the player's Reply
// (default "Right."), or Tree: a root node like the stages', whose answers can
// also @next (carry on: the next business at that NPC, else the greeting).
const BQTalk = (() => {
  const DEFAULTS = { Accept: "I'll do it.", Decline: "Not right now.", OnIt: "On it.", Back: "Back.", AnythingElse: "Anything else?" };
  const REPLY_KINDS = Object.keys(DEFAULTS);
  // What a target does (treeTargetKey). "node" = a conversation node.
  const ACTION = { "@accept": "accept", "@decline": "menu", "@menu": "menu", "@offer": "offer", "@more": "more", "@close": "close", "1": "close", "": "close", "@next": "next" };
  const norm = t => String(t == null ? "" : t).trim();
  const kindOf = t => { const k = norm(t).toLowerCase(); return k in ACTION ? ACTION[k] : "node"; };
  // The stages, in the order a player meets them.
  const STAGES = [
    { k: "offer", tree: "OfferTree", text: "Offer", who: "Giver", reply: "Accept", label: "Offer", short: "the quest offer",
      def: [{ reply: "Accept", to: "@accept" }, { reply: "Decline", to: "@decline" }], back: "@offer", backText: "Back to the offer." },
    { k: "accept", tree: "AcceptTree", text: "Accept", who: "Giver", label: "After accepting", short: "after they say yes",
      def: [{ reply: "OnIt", to: "@close" }], back: "@close", backText: "On it." },
    { k: "progress", tree: "ProgressTree", text: "Progress", who: "TurnIn", label: "In progress", short: "when you come back too early",
      def: [{ reply: "Back", to: "@menu" }], back: "@menu", backText: "Back." },
    { k: "complete", tree: "CompleteTree", text: "Complete", who: "TurnIn", label: "Hand-in", short: "when you hand it in",
      def: [{ reply: "AnythingElse", to: "@more" }], back: "@more", backText: "Anything else?" },
  ];
  const stage = k => STAGES.find(s => s.k === k);
  function parseReplies(raw) {
    let o = {};
    try { o = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {}; } catch { o = {}; }
    const out = {};
    if (o && typeof o === "object") for (const k of REPLY_KINDS) if (typeof o[k] === "string" && o[k].trim()) out[k] = o[k];
    return out;
  }
  // The quest's player line of this kind, or the default.
  const reply = (q, kind) => parseReplies(q.Replies)[kind] || DEFAULTS[kind];
  function withReply(raw, kind, text) {
    const o = parseReplies(raw);
    if (String(text || "").trim() && text !== DEFAULTS[kind]) o[kind] = text; else delete o[kind];
    return Object.keys(o).length ? JSON.stringify(o) : "{}";
  }
  // The nodes of a tree reachable from root, in reading order (depth first).
  // get(ident) -> { Title, Options: [[label, target]] } | undefined
  function walk(root, get, qid) {
    const order = [], seen = new Set(), missing = new Set(), edges = [];
    const visit = id => {
      if (seen.has(id)) return; seen.add(id);
      const c = get(id);
      if (!c) { missing.add(id); return; }
      order.push(id);
      for (const [label, to] of c.Options) {
        const k = kindOf(to);
        if (k === "node") { edges.push([id, norm(to)]); visit(norm(to)); }
        else if (k === "offer" && root) edges.push([id, root]);
      }
    };
    if (norm(root)) visit(norm(root));
    return { order, missing: [...missing], edges, seen };
  }
  // Problems in one stage's tree. opts: { replies, accept (the quest's Accept
  // line), get, stage }. Severity: err = the player gets something broken,
  // warn = worth fixing, info = good to know.
  function analyse(root, get, st, q) {
    const out = [], r = norm(root);
    if (!r) return out;
    const label = st.label.toLowerCase();
    const w = walk(r, get);
    if (!get(r)) { out.push({ sev: "warn", node: r, msg: `The ${label} conversation "${r}" doesn't exist: the game shows the single text box instead` }); return out; }
    for (const m of w.missing) out.push({ sev: "err", node: m, msg: `An answer leads to "${m}", which doesn't exist: a dead end` });
    let hasAccept = false, hasDecline = false, rootAccept = false;
    const hasExit = new Map();
    for (const id of w.order) {
      const c = get(id), opts = c.Options;
      if (opts.length > 6) out.push({ sev: "warn", node: id, msg: `${opts.length} answers on one line: the window fits about 6` });
      if (!norm(c.Title)) out.push({ sev: "warn", node: id, msg: "This line is empty: they say nothing" });
      if (!opts.length) out.push({ sev: "info", node: id, msg: "No answers: the player only gets Goodbye. here. Add a way back or an accept" });
      let exit = !opts.length;
      for (const [lab, to] of opts) {
        const k = kindOf(to);
        if (!norm(lab)) out.push({ sev: "warn", node: id, msg: "An answer has no words" });
        if (k === "accept") { hasAccept = true; if (id === r) rootAccept = true; }
        if (k === "menu") { hasDecline = true; }
        if (k !== "node" && k !== "offer") exit = true;
      }
      hasExit.set(id, exit);
    }
    // loops with no way out: strongly connected groups whose answers only go round
    const adj = new Map(w.order.map(id => [id, []]));
    for (const [a, b] of w.edges) if (adj.has(a) && adj.has(b)) adj.get(a).push(b);
    let idx = 0; const ix = new Map(), low = new Map(), on = new Set(), stack = [], sccs = [];
    const strong = v => {
      ix.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
      for (const u of adj.get(v)) { if (!ix.has(u)) { strong(u); low.set(v, Math.min(low.get(v), low.get(u))); } else if (on.has(u)) low.set(v, Math.min(low.get(v), ix.get(u))); }
      if (low.get(v) === ix.get(v)) { const c = []; let u; do { u = stack.pop(); on.delete(u); c.push(u); } while (u !== v); sccs.push(c); }
    };
    for (const id of w.order) if (!ix.has(id)) strong(id);
    for (const c of sccs) {
      const cyc = c.length > 1 || adj.get(c[0]).includes(c[0]);
      if (!cyc) continue;
      const set = new Set(c);
      const leaves = c.some(id => hasExit.get(id) || adj.get(id).some(u => !set.has(u)));
      if (!leaves) out.push({ sev: "warn", node: c[0], nodes: c, msg: `These lines only lead round in circles (${c.length}): add an answer that accepts, goes back to the menu or ends the chat. The game's automatic Goodbye. is the only way out` });
    }
    if (st.k === "offer") {
      if (!hasAccept) out.push({ sev: "warn", node: r, msg: `No answer accepts the quest: the game adds "${reply(q, "Accept")}" to the first line. Write your own accept answer` });
      else if (!rootAccept) out.push({ sev: "info", node: r, msg: `Accept is only offered deeper in: the game also adds "${reply(q, "Accept")}" to the first line` });
      if (!hasDecline) out.push({ sev: "info", node: r, msg: `No answer declines: the game adds "${reply(q, "Decline")}" to the first line` });
    }
    return out;
  }
  // Nodes of this quest that no stage's tree reaches (named q<id>-...).
  // Every tree root of quest q: the four stages, then its talk steps' Tree
  // (Steps[i].Tree: the conversation at the NPC of a talk objective).
  function talkRoots(q) {
    let st = [];
    try { st = typeof q.Steps === "string" ? JSON.parse(q.Steps || "[]") : q.Steps || []; } catch { st = []; }
    return (Array.isArray(st) ? st : []).map((s, i) => (s && s.Type === "talk" && norm(s.Tree) ? { i, root: norm(s.Tree), npc: s.NPC } : null)).filter(Boolean);
  }
  const roots = q => [...STAGES.map(s => norm(q[s.tree])), ...talkRoots(q).map(t => t.root)].filter(Boolean);
  function orphans(q, all, get) {
    const reach = new Set();
    for (const r of roots(q)) for (const id of walk(r, get).order) reach.add(id);
    return all.filter(c => c.Identifier.startsWith("q" + q.id + "-") && !reach.has(c.Identifier)).map(c => c.Identifier);
  }
  // A free identifier for a new node of quest q.
  function newIdent(q, base, taken) {
    const b = "q" + q.id + "-" + (base || "ask").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!taken(b)) return b;
    let i = 2; while (taken(b + i)) i++;
    return b + i;
  }
  return { DEFAULTS, REPLY_KINDS, STAGES, stage, kindOf, norm, parseReplies, reply, withReply, walk, analyse, orphans, newIdent, talkRoots, roots, TALK_REPLY: "Right." };
})();
if (typeof module !== "undefined") module.exports = BQTalk;
