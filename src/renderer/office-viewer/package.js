// A document package (a zip) as the format readers see it:  { names, has(name), text(name), bytes(names), texts(names), close() }.
// In the page the zip is opened and inflated in the worker (worker.js) so a big file never freezes the window; the tests use
// localPackage, which does the same with fflate directly.

const utf8 = new TextDecoder('utf-8');

// read(names, as) -> Promise<{ name: string | ArrayBuffer }>
function makePackage(names, read, close) {
  const set = new Set(names);
  const cache = new Map();
  return {
    names: [...set],
    has: (name) => set.has(name),
    async text(name) {
      if (!set.has(name)) return '';
      if (cache.has(name)) return cache.get(name);
      const parts = await read([name], 'text');
      const value = parts[name] || '';
      cache.set(name, value);
      return value;
    },
    async texts(list) {
      const need = list.filter((n) => set.has(n) && !cache.has(n));
      if (need.length) { const parts = await read(need, 'text'); for (const n of need) cache.set(n, parts[n] || ''); }
      const out = {};
      for (const n of list) if (set.has(n)) out[n] = cache.get(n);
      return out;
    },
    // name or [names] -> { name: ArrayBuffer }
    async bytes(list) {
      const arr = Array.isArray(list) ? list : [list];
      return read(arr.filter((n) => set.has(n)), 'bytes');
    },
    close: close || (() => {}),
  };
}

export function localPackage(fflate, u8, zipinfo) {
  const dir = zipinfo.readDirectory(u8);
  const read = async (names, as) => {
    const want = new Set(names);
    const got = want.size ? fflate.unzipSync(u8, { filter: (f) => want.has(f.name) }) : {};
    const out = {};
    for (const n of want) if (got[n]) out[n] = as === 'text' ? utf8.decode(got[n]).replace(/^﻿/, '') : got[n].slice().buffer;
    return out;
  };
  const pkg = makePackage(dir.entries.map((e) => e.name), read);
  pkg.directory = dir;
  return pkg;
}

// The worker talks in requests with ids.
export function createWorkerClient(url) {
  const worker = new Worker(url || '/app/worker.js');
  let next = 1;
  const waiting = new Map();
  worker.onmessage = (e) => {
    const m = e.data;
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m);
    else w.reject(Object.assign(new Error(m.error), { code: m.code }));
  };
  worker.onerror = (e) => {
    const err = new Error('The reading worker stopped: ' + (e.message || 'unknown error'));
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
  };
  const call = (message, transfer) => new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer || []);
  });
  return { call, terminate: () => worker.terminate() };
}

// buffer: ArrayBuffer (handed over to the worker). -> package with .encrypted, .total, and .client for workbook requests
export async function openPackage(buffer) {
  const client = createWorkerClient();
  try {
    const opened = await client.call({ op: 'open', buffer }, [buffer]);
    const pkg = makePackage(opened.names, async (names, as) => (await client.call({ op: 'read', names, as })).parts, () => client.terminate());
    pkg.encrypted = opened.encrypted;
    pkg.total = opened.total;
    pkg.client = client;
    return pkg;
  } catch (err) { client.terminate(); throw err; }
}
