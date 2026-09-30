// Version vectors distinguish causal updates from concurrent edits. Concurrent
// variants are retained in the encrypted document instead of silently discarded.
(function () {
  const safeKey = key => !['__proto__', 'constructor', 'prototype'].includes(key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const dominates = (a, b) => Object.keys(b).every(k => (a[k] || 0) >= b[k]);
  const join = (a, b) => { const out = { ...a }; for (const k of Object.keys(b)) out[k] = Math.max(out[k] || 0, b[k]); return out; };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function empty() { return { schema: 2, records: {} }; }
  function valid(doc) {
    if (!doc || doc.schema !== 2 || !object(doc.records) || Object.keys(doc.records).length > 30000) throw new Error('Unsupported sync schema');
    for (const [key, r] of Object.entries(doc.records)) {
      if (!safeKey(key) || key.length > 4096 || !object(r) || !object(r.clock) || Object.keys(r.clock).length > 100 || typeof r.deleted !== 'boolean') throw new Error('Invalid sync record');
      if (r.at !== undefined && (!Number.isSafeInteger(r.at) || r.at < 0)) throw new Error('Invalid sync record time');
      if (r.conflicts !== undefined && (!Array.isArray(r.conflicts) || r.conflicts.length > 100 || r.conflicts.some(v => !object(v) || typeof v.deleted !== 'boolean'))) throw new Error('Invalid sync conflicts');
      for (const [device, n] of Object.entries(r.clock)) if (!safeKey(device) || !/^[a-zA-Z0-9_-]{1,80}$/.test(device) || !Number.isSafeInteger(n) || n < 0) throw new Error('Invalid record revision');
    }
    return doc;
  }
  function capture(doc, values, device) {
    valid(doc);
    if (!safeKey(device) || !/^[a-zA-Z0-9_-]{1,80}$/.test(device)) throw new Error('Invalid sync device');
    const records = { ...doc.records };
    for (const key of new Set([...Object.keys(records), ...Object.keys(values)])) {
      if (!safeKey(key)) throw new Error('Unsafe sync record key');
      const previous = records[key], deleted = !Object.hasOwn(values, key), value = deleted ? null : values[key];
      if (previous && previous.deleted === deleted && equal(previous.value, value)) continue;
      const clock = { ...(previous?.clock || {}) }; clock[device] = (clock[device] || 0) + 1;
      // A new local edit settles any conflict the record carried. Keeping the
      // old variants made every later sync toast "N sync conflicts retained"
      // forever (found 2026-09-29). `at` is when this device made the edit, so
      // a later concurrent conflict can prefer the newer edit.
      records[key] = { clock, deleted, value, at: Date.now(), conflicts: [] };
    }
    return { schema: 2, records };
  }
  function merge(left, right) {
    valid(left); valid(right); const records = { ...left.records };
    for (const [key, b] of Object.entries(right.records)) {
      const a = records[key];
      if (!a) { records[key] = b; continue; }
      const aDominates = dominates(a.clock, b.clock), bDominates = dominates(b.clock, a.clock);
      if (aDominates && bDominates && equal(a, b)) continue;
      if (aDominates && !bDominates) continue;
      if (bDominates && !aDominates) { records[key] = b; continue; }
      const variants = [...(a.conflicts || []), ...(b.conflicts || []), { deleted: a.deleted, value: a.value, at: a.at }, { deleted: b.deleted, value: b.value, at: b.at }];
      // Same content from two devices is one variant; keep its latest edit time.
      const byContent = new Map();
      for (const v of variants) {
        const id = JSON.stringify({ deleted: v.deleted, value: v.value }), seen = byContent.get(id);
        if (!seen || (v.at || 0) > (seen.at || 0)) byContent.set(id, v);
      }
      const unique = [...byContent.entries()].sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0).map(([, v]) => v);
      // Deletions win a concurrent delete/edit; the edit remains recoverable.
      // Between two edits the newer one wins. It used to be whichever sorted
      // last as JSON text, so an older edit could beat a newer one (found
      // 2026-09-29). Records from before edit times existed tie at 0 and fall
      // back to that fixed order, which still converges on every device.
      const winner = unique.find(v => v.deleted) || unique.reduce((best, v) => (v.at || 0) > (best.at || 0) ? v : best, unique[unique.length - 1]);
      records[key] = { ...winner, clock: join(a.clock, b.clock), conflicts: unique };
    }
    return { schema: 2, records };
  }
  function values(doc) { valid(doc); return Object.fromEntries(Object.entries(doc.records).filter(([,r]) => !r.deleted).map(([k,r]) => [k,r.value])); }
  function flatten(sources) {
    const flat = {};
    for (const [source, value] of Object.entries(sources)) {
      flat[JSON.stringify([source, 'type'])] = Array.isArray(value) ? 'array' : 'scalar';
      if (!Array.isArray(value)) { flat[JSON.stringify([source, 'value'])] = value; continue; }
      value.forEach((item, index) => {
        const id = String(item?.id ?? (item?.url ? item.url + ':' + (item.time || '') : JSON.stringify(item)));
        flat[JSON.stringify([source, 'item', id])] = { index, item };
      });
    }
    return flat;
  }
  function unflatten(flat) {
    // A source an older Vex still sends as one value (a list it does not yet
    // sync item by item) can meet item rows a newer device added at the same
    // time. The rows used to replace the value, so the older device's whole
    // list shrank to the newer device's additions (found 2026-09-30). The
    // whole value wins instead, as it does when joining (sync-engine.js).
    const sources = {}, rows = {}, whole = new Set();
    for (const [key, value] of Object.entries(flat)) {
      const parts = JSON.parse(key);
      if (!Array.isArray(parts) || typeof parts[0] !== 'string' || !safeKey(parts[0])) throw new Error('Unsafe sync source');
      const [source, kind] = parts;
      if (kind === 'type' && value === 'array') sources[source] = [];
      if (kind === 'type' && value !== 'array') whole.add(source);
      if (kind === 'value') sources[source] = value;
      if (kind === 'item') {
        if (!object(value) || !Number.isSafeInteger(value.index) || value.index < 0) throw new Error('Invalid sync array item');
        (rows[source] ||= []).push({ ...value, key });
      }
    }
    for (const [source, items] of Object.entries(rows)) if (!(whole.has(source) && Object.hasOwn(sources, source))) sources[source] = items.sort((a,b) => a.index - b.index || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(x => x.item);
    return sources;
  }
  const api = { empty, valid, capture, merge, values, flatten, unflatten };
  if (typeof window !== 'undefined') window.VexSyncRecords = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
