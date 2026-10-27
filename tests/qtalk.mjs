// The quest conversation rules (qtalk.js): targets, replies, tree checks.
import { createRequire } from "module";
const T = createRequire(import.meta.url)("../qtalk.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " " + JSON.stringify(a));
// targets, as treeTargetKey
eq(["@accept", "@decline", "@menu", "@offer", "@more", "@close", "1", "", "q1-x", " @ACCEPT "].map(T.kindOf), ["accept", "menu", "menu", "offer", "more", "close", "close", "close", "node", "accept"], "kindOf");
// replies
eq(T.reply({ Replies: "{}" }, "Accept"), "I'll do it.", "default accept");
eq(T.reply({ Replies: '{"Accept":"Fine."}' }, "Accept"), "Fine.", "own accept");
eq(T.reply({ Replies: '{"Accept":"  "}' }, "Accept"), "I'll do it.", "blank = default");
eq(T.reply({ Replies: "nope" }, "OnIt"), "On it.", "bad json = default");
eq(T.withReply("{}", "Accept", "Fine."), '{"Accept":"Fine."}', "withReply sets");
eq(T.withReply('{"Accept":"Fine.","Back":"Ok."}', "Accept", ""), '{"Back":"Ok."}', "withReply clears");
eq(T.withReply('{"Accept":"Fine."}', "Accept", "I'll do it."), "{}", "the default text is not stored");
const nodes = defs => id => defs[id] ? { Title: defs[id][0], Options: defs[id][1] } : null;
const offer = T.stage("offer"), q = { id: 7, Replies: "{}" };
const A = (root, defs, st = offer) => T.analyse(root, nodes(defs), st, q);
eq(A("a", {}).map(x => x.sev), ["warn"], "a missing root falls back (warn)");
eq(A("a", { a: ["Hi", [["Why", "b"], ["Yes", "@accept"], ["No", "@decline"]]], b: ["Because", [["Ok", "@offer"]]] }), [], "a clean tree has nothing to say");
ok(A("a", { a: ["Hi", [["Why", "zz"], ["Yes", "@accept"], ["No", "@menu"]]] }).some(x => x.sev === "err" && /zz/.test(x.msg)), "an answer to a missing line is an error");
ok(A("a", { a: ["Hi", [["No", "@decline"]]] }).some(x => x.sev === "warn" && /No answer accepts/.test(x.msg)), "no accept anywhere warns, and says what the game adds");
ok(A("a", { a: ["Hi", [["Why", "b"], ["No", "@decline"]]], b: ["Because", [["Fine", "@accept"]]] }).some(x => x.sev === "info" && /only offered deeper/.test(x.msg)), "accept only deeper: info");
ok(A("a", { a: ["Hi", [["Yes", "@accept"]]] }).some(x => /No answer declines/.test(x.msg)), "no decline: info");
const loop = A("a", { a: ["Hi", [["Yes", "@accept"], ["Why", "b"]]], b: ["Because", [["And?", "c"]]], c: ["Because", [["And?", "b"]]] });
ok(loop.some(x => x.sev === "warn" && /round in circles/.test(x.msg) && x.nodes.length === 2), "a loop with no way out warns: " + JSON.stringify(loop.map(x => x.msg)));
ok(!A("a", { a: ["Hi", [["Yes", "@accept"], ["No", "@decline"], ["Why", "b"]]], b: ["Because", [["And?", "c"]]], c: ["Because", [["Back", "b"], ["Ok", "@offer"]]] }).some(x => /circles/.test(x.msg)), "a loop that can go back to the offer is fine");
ok(!A("a", { a: ["Hi", [["Yes", "@accept"], ["No", "@decline"], ["Why", "b"]]], b: ["Because", [["Hmm", "b"], ["Ok", "@menu"]]] }).some(x => /circles/.test(x.msg)), "a loop with an action exit is fine");
ok(A("a", { a: ["Hi", [["Yes", "@accept"], ["No", "@decline"], ["Why", "b"]]], b: ["Because", []] }).some(x => x.sev === "info" && /No answers/.test(x.msg)), "a line with no answers: info");
ok(A("a", { a: ["Hi", [1, 2, 3, 4, 5, 6, 7].map(i => ["Q" + i, "@accept"])] }).some(x => /about 6/.test(x.msg)), "more than 6 answers warns");
ok(A("a", { a: ["", [["Yes", "@accept"], ["No", "@decline"]]] }).some(x => /empty/.test(x.msg)), "an empty line warns");
// stages other than the offer don't ask for accept
eq(A("a", { a: ["Done", [["Anything else?", "@more"]]] }, T.stage("complete")), [], "a hand-in tree needs no accept");
// orphans and ids
const all = [{ Identifier: "q7-offer" }, { Identifier: "q7-lost" }, { Identifier: "q70-x" }, { Identifier: "npc-1" }];
eq(T.orphans({ id: 7, OfferTree: "q7-offer", Replies: "{}" }, all, nodes({ "q7-offer": ["Hi", []] })), ["q7-lost"], "orphans only count q<id>-");
eq(T.newIdent({ id: 7 }, "ask", x => x === "q7-ask"), "q7-ask2", "newIdent avoids taken");
console.log(`qtalk: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
