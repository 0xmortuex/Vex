// @vitest-environment jsdom
//
// The AI worker's address in the Sync field (found 2026-10-09, on the owner's
// phone): all Vex said was "Authentication required". The two workers are
// told apart by what each already answers, with no token, to GET /sync/pull —
// here the real worker code answers (workers/), behind window.VexNet.fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import aiWorker, { VexAIState } from '../../workers/vex-ai-worker/worker.js';
import syncWorker from '../../workers/vex-sync-worker/worker.js';
import { syncSystem } from '../workers/syncHarness.js';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

const AI_URL = 'https://vex-ai.owner.workers.dev';
const SYNC_URL = 'https://vex-sync.owner.workers.dev';
const OTHER_URL = 'https://example.test';
const SAID_SYNC = 'This is your Vex AI worker’s address, not your Sync worker’s. Your Sync worker’s address usually has “sync” in it.';
const SAID_AI = 'This is your Vex Sync worker’s address, not your AI worker’s. Your AI worker’s address usually has “ai” in it.';

function aiSystem() {
  const records = new Map(); let queue = Promise.resolve();
  const object = new VexAIState({
    storage: { get: async k => records.get(k), put: async (k, v) => { records.set(k, v); }, delete: async k => records.delete(k), list: async () => new Map(), getAlarm: async () => 1, setAlarm: async () => {} },
    blockConcurrencyWhile(fn) { const r = queue.then(fn); queue = r.catch(() => {}); return r; },
  }, { VEX_CLIENT_TOKENS: JSON.stringify({ alice: 'secret-test-client-token-0123456789' }), OPENROUTER_API_KEY: 'test' });
  const env = { VEX_STATE: { idFromName: name => ({ name }), get: () => ({ fetch: req => object.fetch(req) }) } };
  return (request) => aiWorker.fetch(request, env);
}

// Every request the app makes, by address; each goes to the worker at it.
let asked;
function network() {
  asked = [];
  const ai = aiSystem();
  const sync = syncSystem();
  const at = {
    [AI_URL]: ai,
    [SYNC_URL]: (request) => syncWorker.fetch(request, sync.env),
    [OTHER_URL]: async () => new Response('<h1>Not here</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
  };
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      asked.push((opts.method || 'GET') + ' ' + u.origin + u.pathname);
      const handler = at[u.origin];
      if (!handler) throw new TypeError('Failed to fetch');
      const { timeoutMs, maxBytes, ...init } = opts;
      return handler(new Request(url, init));
    },
  };
}

const config = () => { window.VexConfig = fresh('../../src/renderer/js/vex-config.js').VexConfig; return window.VexConfig; };

beforeEach(() => { localStorage.clear(); network(); window.showToast = vi.fn(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.VexStorage; });

describe('which worker is at an address', () => {
  it('the AI worker, the sync worker and anything else are told apart, asking only that address', async () => {
    const C = config();
    expect(await C.workerKind(AI_URL)).toBe('ai');
    expect(await C.workerKind(SYNC_URL + '/')).toBe('sync');
    expect(await C.workerKind(OTHER_URL)).toBe('unknown');
    expect(await C.workerKind('')).toBe('unknown');
    expect(asked).toEqual(['GET ' + AI_URL + '/sync/pull', 'GET ' + SYNC_URL + '/sync/pull', 'GET ' + OTHER_URL + '/sync/pull']);
  });

  it('an address that cannot be reached is an error, not a guess', async () => {
    await expect(config().workerKind('https://nowhere.test')).rejects.toThrow('Failed to fetch');
  });
});

describe('signing in with the AI worker in the Sync field', () => {
  function engine(meta = null, key = null) {
    config();
    localStorage.setItem('vex.syncWorkerUrl', AI_URL);
    window.VexTabPolicy = { isPrivateWindow: false, snapshot: (v) => v };
    window.VexSyncRecords = Records;
    window.vex = {
      syncSaveKey: async () => {}, syncSaveMeta: async () => {}, syncClearState: vi.fn(async () => true),
      syncLoadKey: async () => key, syncLoadMeta: async () => meta, platform: 'win32',
    };
    for (const f of ['sync-crypto.js', 'sync-engine.js']) delete require.cache[require.resolve('../../src/renderer/js/' + f)];
    require('../../src/renderer/js/sync-crypto.js');
    require('../../src/renderer/js/sync-engine.js');
    return window.SyncEngine;
  }

  it('says it is the AI worker instead of "Authentication required"', async () => {
    const E = engine();
    await expect(E.requestCode('a@b.test')).rejects.toThrow(SAID_SYNC);
    expect(asked).toEqual(['POST ' + AI_URL + '/auth/request-code', 'GET ' + AI_URL + '/sync/pull']);
  });

  it('the code step says the same', async () => {
    const E = engine();
    await expect(E.verifyCode('a@b.test', '123456')).rejects.toThrow(SAID_SYNC);
  });

  it('a signed-in device whose Sync field now holds the AI worker keeps its sign-in and is told why', async () => {
    vi.useFakeTimers();
    const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
    const E = engine({ email: 'a@b.test', sessionToken: 'tok', deviceId: 'dev1', revision: 0 }, KEY);
    expect(await E.initFromDisk()).toBe(true);
    const r = await E.pullNow();
    expect(r).toEqual({ ok: false, reason: SAID_SYNC });
    expect(E.isEnabled()).toBe(true);
    expect(window.vex.syncClearState).not.toHaveBeenCalled();
    expect(E.getState().lastError).toBe(SAID_SYNC);
    expect(window.showToast.mock.calls.filter(c => c[1] === 'error')).toEqual([]);
  });

  it('a push to it (a POST, answered 401) no longer signs the device out', async () => {
    vi.useFakeTimers();
    const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
    const E = engine({ email: 'a@b.test', sessionToken: 'tok', deviceId: 'dev1', revision: 0 }, KEY);
    const stores = new Map();
    globalThis.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
    // Signed in and pulled from the right server first; then the field changes.
    localStorage.setItem('vex.syncWorkerUrl', OTHER_URL + '/good');
    const realFetch = window.VexNet.fetch;
    window.VexNet.fetch = async (url, opts) => (url.startsWith(OTHER_URL + '/good/')
      ? new Response(JSON.stringify({ ok: true, blob: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : realFetch(url, opts));
    expect(await E.initFromDisk()).toBe(true);
    expect((await E.pullNow()).ok).toBe(true);
    localStorage.setItem('vex.syncWorkerUrl', AI_URL);
    expect(await E.pushNow()).toEqual({ ok: false, reason: SAID_SYNC });
    expect(asked).toContain('POST ' + AI_URL + '/sync/push');
    expect(E.isEnabled()).toBe(true);
    expect(window.vex.syncClearState).not.toHaveBeenCalled();
    expect(window.showToast.mock.calls.filter(c => c[1] === 'error')).toEqual([]);
  });
});

describe('Settings › Cloud', () => {
  function field(expected) {
    document.body.innerHTML = '<input id="f"><div id="m" hidden></div>';
    const input = document.getElementById('f'), out = document.getElementById('m');
    config().watchWorkerField(input, expected, out);
    const enter = async (v) => { input.value = v; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0)); await new Promise(r => setTimeout(r, 0)); };
    return { input, out, enter };
  }

  it('the AI worker in the Sync field is said under it', async () => {
    const { out, enter } = field('sync');
    await enter(AI_URL);
    await vi.waitFor(() => expect(out.hidden).toBe(false));
    expect(out.textContent).toBe(SAID_SYNC);
  });

  it('the sync worker in the Sync field says nothing', async () => {
    const { out, enter } = field('sync');
    await enter(SYNC_URL);
    expect(asked).toEqual(['GET ' + SYNC_URL + '/sync/pull']);
    expect(out.hidden).toBe(true);
  });

  it('the sync worker in the AI field is said under it, and typing again clears it', async () => {
    const { input, out, enter } = field('ai');
    await enter(SYNC_URL);
    await vi.waitFor(() => expect(out.hidden).toBe(false));
    expect(out.textContent).toBe(SAID_AI);
    input.dispatchEvent(new Event('input'));
    expect(out.hidden).toBe(true);
  });
});
