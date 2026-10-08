// In-memory stand-in for the Cloudflare pieces the sync worker uses: Durable
// Object storage (values are structured-cloned, as on Cloudflare), one queue
// per object for blockConcurrencyWhile, and namespaces whose idFromName(name)
// always reaches the same object. A cycle of objects waiting on each other
// under their locks hangs here exactly as it would on Cloudflare.
import * as current from '../../workers/vex-sync-worker/worker.js';
import * as previous from './fixtures/vex-sync-worker-global.js';

export const SECRET = 'test-email-hash-secret-0123456789abcdef';

export function memoryStorage(records = new Map(), hooks = {}) {
  const clone = v => (v === undefined ? undefined : structuredClone(v));
  const one = (k, v) => { if (hooks.beforePut) hooks.beforePut(k, v); records.set(k, clone(v)); };
  return {
    records,
    async get(k) { return clone(records.get(k)); },
    async put(k, v) {
      if (typeof k === 'object') { for (const [key, value] of Object.entries(k)) one(key, value); return; }
      one(k, v);
    },
    async delete(k) { return records.delete(k); },
    async list({ prefix = '', limit = Infinity, startAfter } = {}) {
      const keys = [...records.keys()].filter(k => k.startsWith(prefix) && (startAfter === undefined || k > startAfter)).sort().slice(0, limit);
      return new Map(keys.map(k => [k, clone(records.get(k))]));
    },
    getAlarm: async () => 1,
    setAlarm: async () => {},
  };
}

function objectState(storage) {
  let queue = Promise.resolve();
  return {
    storage,
    blockConcurrencyWhile(fn) { const r = queue.then(fn); queue = r.catch(() => {}); return r; },
  };
}

// A Workers KV namespace (the layout before the Durable Object, 2026-09-07).
export function memoryKV(entries = {}) {
  const raw = new Map(Object.entries(entries));
  return { raw, get: async k => raw.get(k) ?? null, put: async (k, v) => { raw.set(k, String(v)); }, delete: async k => { raw.delete(k); } };
}

// The whole worker. `global` and each account's records are plain Maps the
// test can read and seed. `hooks.account(name)` may return storage hooks.
export function syncSystem({ module = current, global = new Map(), accounts = new Map(), env = {}, hooks = {} } = {}) {
  const fullEnv = { DEVELOPMENT_MODE: 'true', EMAIL_HASH_SECRET: SECRET, ...env };
  const calls = [];
  const globalObject = new module.VexSyncState(objectState(memoryStorage(global, hooks.global)), fullEnv);
  const accountObjects = new Map();
  fullEnv.VEX_STATE = {
    idFromName: name => ({ name }),
    get: () => ({ fetch: request => { calls.push(['global', new URL(request.url).pathname]); return globalObject.fetch(request); } }),
  };
  if (module.VexSyncAccount) {
    fullEnv.VEX_ACCOUNTS = {
      idFromName: name => ({ name }),
      get: ({ name }) => ({
        fetch: request => {
          calls.push([name, new URL(request.url).pathname]);
          if (!accountObjects.has(name)) {
            if (!accounts.has(name)) accounts.set(name, new Map());
            accountObjects.set(name, new module.VexSyncAccount(objectState(memoryStorage(accounts.get(name), hooks.account?.(name))), fullEnv));
          }
          return accountObjects.get(name).fetch(request);
        },
      }),
    };
  }
  const call = async (method, path, body, token, headers = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (token) h.Authorization = 'Bearer ' + token;
    const r = await module.default.fetch(new Request('http://localhost' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), fullEnv);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const signIn = async (email, deviceName = 'Laptop') => {
    const req = await call('POST', '/auth/request-code', { email });
    if (req.status !== 200) throw new Error('request-code ' + req.status);
    const res = await call('POST', '/auth/verify-code', { email, code: req.body.devCode, deviceName });
    if (res.status !== 200) throw new Error('verify-code ' + res.status + ' ' + JSON.stringify(res.body));
    return res.body;
  };
  const push = (token, baseRevision, blob = 'BLOB' + baseRevision) => call('POST', '/sync/push', { encryptedBlob: blob, baseRevision }, token);
  return { env: fullEnv, global, accounts, calls, call, signIn, push };
}

export const previousWorker = previous;

export function isLive(records, key) {
  const r = records?.get(key);
  return !!r && !r.deleted && (!r.expires || r.expires > Date.now());
}
export function liveValue(records, key) {
  return isLive(records, key) ? JSON.parse(records.get(key).value) : null;
}
