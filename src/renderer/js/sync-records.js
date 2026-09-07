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
      records[key] = { clock, deleted, value, conflicts: previous?.conflicts || [] };
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
      const variants = [...(a.conflicts || []), ...(b.conflicts || []), { deleted: a.deleted, value: a.value }, { deleted: b.deleted, value: b.value }];
      const unique = [...new Map(variants.map(v => [JSON.stringify(v), v])).entries()].sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0);
      // Deletions win a concurrent delete/edit; the edit remains recoverable.
      const winner = unique.find(([,v]) => v.deleted)?.[1] || unique[unique.length - 1][1];
      records[key] = { ...winner, clock: join(a.clock, b.clock), conflicts: unique.map(([,v]) => v) };
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
    const sources = {}, rows = {};
    for (const [key, value] of Object.entries(flat)) {
      const parts = JSON.parse(key);
      if (!Array.isArray(parts) || typeof parts[0] !== 'string' || !safeKey(parts[0])) throw new Error('Unsafe sync source');
      const [source, kind] = parts;
      if (kind === 'type' && value === 'array') sources[source] = [];
      if (kind === 'value') sources[source] = value;
      if (kind === 'item') {
        if (!object(value) || !Number.isSafeInteger(value.index) || value.index < 0) throw new Error('Invalid sync array item');
        (rows[source] ||= []).push({ ...value, key });
      }
    }
    for (const [source, items] of Object.entries(rows)) sources[source] = items.sort((a,b) => a.index - b.index || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map(x => x.item);
    return sources;
  }
  const api = { empty, valid, capture, merge, values, flatten, unflatten };
  if (typeof window !== 'undefined') window.VexSyncRecords = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
