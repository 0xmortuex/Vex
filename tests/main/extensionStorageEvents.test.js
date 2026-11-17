// chrome.storage.onChanged in an extension's service worker (2026-11-16). Electron tells an extension's pages when its storage changes and never
// its service worker (measured in Electron 42 with no Vex code: a page heard all four changes, the worker none). The Claude extension's worker
// learns that the person signed in from this event alone, so claude.ai said "Claude in Chrome isn't connected" with the extension signed in.
// The stand-ins tell the worker: its own writes directly, a page's write through main.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8').replace(/\r\n/g, '\n');
const SW_SRC = read('preload-extension-sw.js');
const MAIN = read('main.js');
const ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
const MV3 = { manifest_version: 3, permissions: ['storage'], background: { service_worker: 'sw.js' } };
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// A storage area as Electron gives it: it stores, and its events never fire.
function area(runtime) {
  const data = new Map();
  const pick = (keys) => {
    const out = {};
    const names = keys == null ? [...data.keys()] : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    for (const k of names) if (data.has(k)) out[k] = JSON.parse(data.get(k));
    return out;
  };
  const answer = (value, cb, fail) => {
    if (typeof cb !== 'function') return fail ? Promise.reject(new Error(fail)) : Promise.resolve(value);
    if (fail) runtime.lastError = { message: fail };
    cb(value);
    delete runtime.lastError;
    return undefined;
  };
  const a = {
    failNext: null,
    get: (keys, cb) => answer(pick(typeof keys === 'function' ? null : keys), typeof keys === 'function' ? keys : cb),
    set: (items, cb) => {
      const fail = a.failNext; a.failNext = null;
      if (!fail) for (const [k, v] of Object.entries(items)) data.set(k, JSON.stringify(v));
      return answer(undefined, cb, fail);
    },
    remove: (keys, cb) => { for (const k of [].concat(keys)) data.delete(k); return answer(undefined, cb); },
    clear: (cb) => { data.clear(); return answer(undefined, cb); },
    onChanged: { addListener: () => { throw new Error('the area\'s own event must not be used in a worker: it never fires'); }, removeListener: () => {}, hasListener: () => false },
  };
  return a;
}

function context({ manifest = MV3, inWorker = true } = {}) {
  const calls = [];
  const fromMain = [];
  const runtime = { id: ID, getManifest: () => manifest, getURL: (p) => 'chrome-extension://' + ID + '/' + p };
  const nativeListeners = [];
  const chrome = {
    runtime, tabs: { query: () => Promise.resolve([]) },
    storage: { local: area(runtime), session: area(runtime), onChanged: { addListener: (fn) => nativeListeners.push(fn), removeListener: () => {}, hasListener: () => false } },
  };
  const ipcRenderer = {
    invoke: (ch, ...args) => { calls.push([ch, ...args]); return Promise.resolve(ch === 'extensions:active-tabs' ? { ids: [], current: null } : null); },
    on: (ch, fn) => { if (ch === 'extensions:event') fromMain.push(fn); },
  };
  const ctx = vm.createContext({ chrome, setTimeout, Promise, JSON, Object, Array, String, Number, URL, console,
    require: (m) => {
      if (m !== 'electron') throw new Error('only electron');
      return { ipcRenderer, contextBridge: { executeInMainWorld: ({ func, args = [] }) => { ctx.__args = args; return vm.runInContext('(' + func.toString() + ').apply(null, __args)', ctx); } } };
    } });
  if (inWorker) ctx.ServiceWorkerGlobalScope = function ServiceWorkerGlobalScope() {};
  vm.runInContext(SW_SRC, ctx);
  const api = (op) => calls.filter(x => x[0] === 'extensions:api' && x[1].op === op).map(x => x[1].args);
  return { c: chrome, api, nativeListeners, deliver: (type, args) => fromMain.forEach(fn => fn({}, { type, args })) };
}

describe('in the service worker: its own writes', () => {
  it('a set is told to chrome.storage.onChanged and to the area\'s own event, with the old and the new value', async () => {
    const w = context();
    const all = [], local = [], session = [];
    w.c.storage.onChanged.addListener((ch, a) => all.push([a, ch]));
    w.c.storage.local.onChanged.addListener((ch) => local.push(ch));
    w.c.storage.session.onChanged.addListener((ch) => session.push(ch));
    await w.c.storage.local.set({ a: 1 });
    await w.c.storage.local.set({ a: 2, b: { x: [1] } });
    await w.c.storage.session.set({ accessToken: 't' });
    expect(all).toEqual([
      ['local', { a: { newValue: 1 } }],
      ['local', { a: { oldValue: 1, newValue: 2 }, b: { newValue: { x: [1] } } }],
      ['session', { accessToken: { newValue: 't' } }],
    ]);
    expect(local).toEqual([{ a: { newValue: 1 } }, { a: { oldValue: 1, newValue: 2 }, b: { newValue: { x: [1] } } }]);
    expect(session).toEqual([{ accessToken: { newValue: 't' } }]);
    expect(await w.c.storage.local.get(null)).toEqual({ a: 2, b: { x: [1] } });
  });
  it('a value written again unchanged is no event, as in Chrome', async () => {
    const w = context();
    const all = [];
    w.c.storage.onChanged.addListener((ch, a) => all.push([a, ch]));
    await w.c.storage.local.set({ a: { k: 1 }, b: 1 });
    await w.c.storage.local.set({ a: { k: 1 }, b: 2 });
    expect(all).toEqual([['local', { a: { newValue: { k: 1 } }, b: { newValue: 1 } }], ['local', { b: { oldValue: 1, newValue: 2 } }]]);
  });
  it('remove tells the keys that were there, clear tells every key', async () => {
    const w = context();
    const all = [];
    await w.c.storage.session.set({ a: 1, b: 2, c: 3 });
    w.c.storage.onChanged.addListener((ch, a) => all.push([a, ch]));
    await w.c.storage.session.remove(['a', 'missing']);
    await w.c.storage.session.remove('missing');
    await w.c.storage.session.clear();
    expect(all).toEqual([['session', { a: { oldValue: 1 } }], ['session', { b: { oldValue: 2 }, c: { oldValue: 3 } }]]);
  });
  it('with a callback: the callback runs, lastError is still readable in it, and a write that failed is no event', async () => {
    const w = context();
    const all = [];
    w.c.storage.onChanged.addListener((ch, a) => all.push([a, ch]));
    const first = await new Promise(resolve => w.c.storage.local.set({ a: 1 }, () => resolve(w.c.runtime.lastError)));
    expect(first).toBeUndefined();
    w.c.storage.local.failNext = 'QUOTA_BYTES quota exceeded';
    const second = await new Promise(resolve => w.c.storage.local.set({ a: 2 }, () => resolve(w.c.runtime.lastError && w.c.runtime.lastError.message)));
    expect(second).toBe('QUOTA_BYTES quota exceeded');
    expect(all).toEqual([['local', { a: { newValue: 1 } }]]);
  });
  it('a write that fails still fails for the one who asked', async () => {
    const w = context();
    w.c.storage.local.failNext = 'nope';
    await expect(w.c.storage.local.set({ a: 1 })).rejects.toThrow('nope');
  });
  it('removeListener and hasListener work on the listeners Vex keeps; Electron\'s own event is not used', async () => {
    const w = context();
    const heard = [];
    const fn = (ch) => heard.push(ch);
    w.c.storage.onChanged.addListener(fn);
    expect(w.c.storage.onChanged.hasListener(fn)).toBe(true);
    w.c.storage.onChanged.removeListener(fn);
    expect(w.c.storage.onChanged.hasListener(fn)).toBe(false);
    await w.c.storage.local.set({ a: 1 });
    expect(heard).toEqual([]);
    expect(w.nativeListeners).toEqual([]);
  });
  it('a listener that throws does not stop the write or the other listeners', async () => {
    const w = context();
    const heard = [];
    const errors = [];
    const onError = (e) => errors.push(e.message);
    process.on('uncaughtException', onError);
    try {
      w.c.storage.onChanged.addListener(() => { throw new Error('listener broke'); });
      w.c.storage.onChanged.addListener((ch) => heard.push(ch));
      await w.c.storage.local.set({ a: 1 });
      await tick(5);
    } finally { process.off('uncaughtException', onError); }
    expect(heard).toEqual([{ a: { newValue: 1 } }]);
    expect(errors).toEqual(['listener broke']);
  });
  it('chrome.storage.sync (Vex keeps it in storage.local) reaches a worker\'s listener as a sync change', async () => {
    const w = context();
    const all = [];
    w.c.storage.onChanged.addListener((ch, a) => all.push([a, ch]));
    await w.c.storage.sync.set({ theme: 'dark' });
    expect(all).toEqual([['sync', { theme: { newValue: 'dark' } }]]);
  });
});

describe('in the service worker: a write made in one of the extension\'s pages', () => {
  // The chrome.storage.sync stand-in listens from the start (a sync change is a change to one storage.local entry), so main is told then.
  it('main is told once that the worker listens, however many listeners there are', () => {
    const w = context();
    w.c.storage.onChanged.addListener(() => {});
    w.c.storage.session.onChanged.addListener(() => {});
    expect(w.api('events.listen')).toEqual([{ type: 'storage.onChanged', filter: undefined }]);
  });
  it('what main passes on reaches the listeners, and the worker does not send it back', () => {
    const w = context();
    const all = [], session = [];
    w.c.storage.onChanged.addListener((ch, a) => all.push([a, ch]));
    w.c.storage.session.onChanged.addListener((ch) => session.push(ch));
    w.deliver('storage.onChanged', [{ accessToken: { newValue: 't' } }, 'session']);
    w.deliver('storage.onChanged', [{ x: { newValue: 1 } }, 'managed']);
    expect(all).toEqual([['session', { accessToken: { newValue: 't' } }]]);
    expect(session).toEqual([{ accessToken: { newValue: 't' } }]);
    expect(w.api('storage.changed')).toEqual([]);
  });
});

describe('in a page of the extension', () => {
  it('a write is told to main for the worker, and the page\'s own events are left to Electron', async () => {
    const p = context({ inWorker: false });
    const before = p.nativeListeners.length;
    p.c.storage.onChanged.addListener(() => {});
    expect(p.nativeListeners.length).toBe(before + 1);
    expect(p.api('events.listen')).toEqual([]);
    await p.c.storage.local.set({ a: 1 });
    await p.c.storage.session.set({ s: 1 });
    await p.c.storage.local.remove('a');
    await tick();
    expect(p.api('storage.changed')).toEqual([
      { area: 'local', changes: { a: { newValue: 1 } } },
      { area: 'session', changes: { s: { newValue: 1 } } },
      { area: 'local', changes: { a: { oldValue: 1 } } },
    ]);
  });
  it('an extension with no service worker is left alone: its background page hears Electron\'s own event', async () => {
    const p = context({ inWorker: false, manifest: { manifest_version: 2, permissions: ['storage'], background: { scripts: ['bg.js'] } } });
    await p.c.storage.local.set({ a: 1 });
    await tick();
    expect(p.api('storage.changed')).toEqual([]);
  });
});

describe('main', () => {
  it('passes a page\'s write on to that extension\'s worker only, and only to a worker that listens', () => {
    expect(MAIN).toMatch(/case 'storage\.changed': \{\s+needPerm\('storage'\);[\s\S]*?if \(!manifest\.background \|\| !manifest\.background\.service_worker\) return undefined;\s+if \(!_extEvents\.listeners\(partition, 'storage\.onChanged'\)\.some\(l => l\.extId === extId\)\) return undefined;\s+await _extWorkerSend\(ses, ext, 'storage\.onChanged', \[args\.changes, args\.area\]\);/);
    expect(MAIN).toMatch(/if \(args\.area !== 'local' && args\.area !== 'session'\) throw new Error/);
    expect(MAIN).toContain("if (/^storage\\./.test(type)) needPerm('storage');");
  });
  it('storage.onChanged is an event an extension may ask to be told about', () => {
    const { createExtensionEvents } = createRequire(import.meta.url)('../../src/main/extension-events.js');
    const events = createExtensionEvents();
    events.listen('persist:main|' + ID, 'storage.onChanged');
    expect(events.listeners('persist:main', 'storage.onChanged').map(l => l.extId)).toEqual([ID]);
    expect(events.listeners('persist:claude', 'storage.onChanged')).toEqual([]);
  });
});
