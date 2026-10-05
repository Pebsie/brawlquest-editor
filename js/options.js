"use strict";

/**
 * Conversation.Options — NOT strict JSON.
 * Emit: [['label','next-identifier'],['Bye','1']]
 * Client swaps every ' to " then JSON-decodes. Apostrophes/double-quotes in labels break it.
 * next "1" ends dialogue.
 */
const BQOptions = (() => {
  function sanitizeLabel(text) {
    // Convert straight apostrophe/quotes to curly so client '→" swap stays safe
    return String(text ?? "")
      .replace(/'/g, "\u2019")
      .replace(/"/g, "\u201D");
  }

  function parse(raw) {
    if (raw == null || raw === "") return [];
    let s = String(raw).trim();
    if (!s) return [];
    s = s.replace(/'s/g, "s").replace(/'t/g, "t").replace(/'ll/g, "ll").replace(/'ve/g, "ve");
    s = s.replace(/'/g, '"');
    try {
      const arr = JSON.parse(s);
      if (!Array.isArray(arr)) return [];
      return arr.map((pair) => {
        if (Array.isArray(pair)) return [String(pair[0] ?? ""), String(pair[1] ?? "1")];
        return [String(pair ?? ""), "1"];
      });
    } catch (_) {
      const out = [];
      const re = /\[[\s]*'((?:\\'|[^'])*)'[\s]*,[\s]*'((?:\\'|[^'])*)'[\s]*\]/g;
      let m;
      const src = String(raw);
      while ((m = re.exec(src))) out.push([m[1], m[2]]);
      return out;
    }
  }

  function serialize(pairs) {
    const list = (pairs || []).map(([text, next]) => {
      const t = sanitizeLabel(text);
      const n = String(next ?? "1").replace(/'/g, "").replace(/"/g, "");
      return `['${t}','${n}']`;
    });
    return `[${list.join(",")}]`;
  }

  function validate(raw) {
    const warnings = [];
    if (raw == null) return warnings;
    const s = String(raw);
    if (/['"]/.test(s.replace(/\[[^\]]*\]/g, (chunk) => {
      // rough: still flag raw apostrophes inside
      return chunk;
    }))) {
      // Check original labels for straight quotes
    }
    const pairs = parse(s);
    if (!pairs.length && s.trim() && s.trim() !== "[]") {
      warnings.push("Could not parse Options; expected [['text','next'],...].");
    }
    for (const [text, next] of pairs) {
      if (!next) warnings.push(`Empty next target for option “${text}”.`);
      if (/['"]/.test(String(text))) {
        warnings.push(`Label “${text}” has straight quotes; will convert to curly on save.`);
      }
    }
    return warnings;
  }

  function parseItemsGiven(raw) {
    if (!raw || String(raw).trim() === "") return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((o) => ({ ItemID: Number(o.ItemID), Amount: Number(o.Amount) }))
        .filter((o) => Number.isFinite(o.ItemID));
    } catch {
      return [];
    }
  }

  function serializeItemsGivenOrEmpty(list, emptyAs) {
    const arr = (list || []).filter((o) => o && Number.isFinite(Number(o.ItemID)));
    if (!arr.length) return emptyAs === "[]" ? "[]" : "";
    return JSON.stringify(arr.map((o) => ({ Amount: Number(o.Amount) || 0, ItemID: Number(o.ItemID) })));
  }

  return { parse, serialize, validate, parseItemsGiven, serializeItemsGivenOrEmpty, sanitizeLabel };
})();
