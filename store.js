"use strict";
// Local snapshot history in IndexedDB (works offline, nothing leaves the
// browser). Two object stores so listing never loads the dbs:
//   meta: { id, time, name, size, stored, summary, unsaved, label, base, hash }
//   data: { id, bytes (ArrayBuffer, gzip when gz), gz, changes, flags }
// plus kv for small things (the GitHub version a db was opened from).
const BQStore = (() => {
  const NAME = "bq-editor-history", MAX = 50, MAX_AGE = 30 * 86400e3, KEEP_MIN = 10;
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("this browser has no IndexedDB (private window?)"));
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("meta", { keyPath: "id", autoIncrement: true });
        d.createObjectStore("data", { keyPath: "id" });
        d.createObjectStore("kv", { keyPath: "k" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("IndexedDB would not open"));
      r.onblocked = () => rej(new Error("IndexedDB is blocked by another tab of the editor"));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  // fn(t) may return an IDBRequest; its result is what tx resolves to.
  async function tx(stores, mode, fn) {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      const r = fn(t);
      if (r && typeof r.onsuccess !== "undefined") r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("IndexedDB write aborted"));
    });
  }

  const canGzip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  const gzip = b => pipe(b, new CompressionStream("gzip"));
  const gunzip = b => pipe(b, new DecompressionStream("gzip"));

  // How much the history may use: half of what the browser offers this site,
  // at most 1 GB (Safari and Firefox give far less to some sites).
  async function budget() {
    try {
      const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      if (e && e.quota) return Math.min(1024 * 1024 * 1024, e.quota * 0.5);
    } catch { /* fall through */ }
    return 300 * 1024 * 1024;
  }
  async function persist() {
    try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
  }

  // Add a snapshot. fast: skip gzip (tab is being hidden or closed).
  async function add(rec, fast) {
    let bytes = rec.bytes, gz = false;
    if (canGzip && !fast) { try { bytes = await gzip(rec.bytes); gz = true; } catch { bytes = rec.bytes; } }
    const meta = { time: Date.now(), name: rec.name, size: rec.bytes.length, stored: bytes.length, summary: rec.summary || "",
      unsaved: !!rec.unsaved, label: rec.label || "", base: rec.base || null, hash: rec.hash || 0 };
    const data = { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), gz, changes: rec.changes || [], flags: rec.flags || {} };
    // Callbacks, not await, inside the transaction: older Safari ends a
    // transaction across a promise tick.
    const write = () => { let id; return tx(["meta", "data"], "readwrite", t => {
      const r = t.objectStore("meta").add(meta);
      r.onsuccess = () => { id = r.result; t.objectStore("data").put({ id, ...data }); };
    }).then(() => id); };
    let id;
    try { id = await write(); }
    catch (e) {
      if (!/quota/i.test(e && (e.name + e.message))) throw e;
      await prune({ hard: true });
      id = await write();
    }
    await prune();
    return id;
  }
  async function list() {
    const all = await tx(["meta"], "readonly", t => t.objectStore("meta").getAll());
    return all.sort((a, b) => b.time - a.time || b.id - a.id);
  }
  async function latest() { return (await list())[0] || null; }
  async function get(id) {
    const d = await tx(["data"], "readonly", t => t.objectStore("data").get(id));
    if (!d) throw new Error("snapshot " + id + " is gone");
    const raw = new Uint8Array(d.bytes);
    return { bytes: d.gz ? await gunzip(raw) : raw, changes: d.changes || [], flags: d.flags || {} };
  }
  async function update(id, patch) {
    return tx(["meta"], "readwrite", t => {
      const s = t.objectStore("meta"); const r = s.get(id);
      r.onsuccess = () => { if (r.result) s.put({ ...r.result, ...patch }); };
    });
  }
  async function remove(ids) {
    if (!ids.length) return;
    return tx(["meta", "data"], "readwrite", t => { for (const id of ids) { t.objectStore("meta").delete(id); t.objectStore("data").delete(id); } });
  }
  // Keep the newest MAX, drop any older than MAX_AGE beyond the newest
  // KEEP_MIN, and stay under the byte budget (hard: half of it).
  async function prune(o = {}) {
    const all = await list();
    let room = (await budget()) * (o.hard ? 0.5 : 1);
    const drop = [];
    all.forEach((m, i) => {
      const old = i >= KEEP_MIN && Date.now() - m.time > MAX_AGE;
      if (i > 0 && (i >= MAX || old || m.stored > room)) drop.push(m.id);
      else room -= m.stored;
    });
    if (o.hard && !drop.length && all.length > 1) drop.push(...all.slice(Math.ceil(all.length / 2)).map(m => m.id));
    await remove(drop);
    return drop.length;
  }
  async function usage() {
    const all = await list();
    let quota = 0, used = 0;
    try { const e = await navigator.storage.estimate(); quota = e.quota || 0; used = e.usage || 0; } catch { /* unknown */ }
    return { count: all.length, stored: all.reduce((n, m) => n + m.stored, 0), quota, used, budget: await budget() };
  }
  const kvGet = k => tx(["kv"], "readonly", t => t.objectStore("kv").get(k)).then(r => (r ? r.v : undefined));
  const kvSet = (k, v) => tx(["kv"], "readwrite", t => { t.objectStore("kv").put({ k, v }); });
  const kvDel = k => tx(["kv"], "readwrite", t => { t.objectStore("kv").delete(k); });
  return { add, list, latest, get, update, remove, prune, usage, persist, kvGet, kvSet, kvDel, available: () => idb().then(() => true, () => false), MAX, canGzip };
})();
