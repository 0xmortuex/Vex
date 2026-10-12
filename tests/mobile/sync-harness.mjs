// A whole Vex Sync account in one process, for the phone's sync tests:
//
//   standIn()   the real worker (workers/vex-sync-worker/worker.js syncHandler)
//               over in-memory storage, one request at a time as its Durable
//               Object runs them, in development mode so a sign-in code comes
//               back in the response instead of by email
//   desktop()   the real desktop engine (src/renderer/js/sync-engine.js) and
//               its crypto, records and contracts, in a sandbox of its own
//   phone()     the phone's sync (mobile/www/js/sync.js) with its shared files
//               and the real bookmark store, in another sandbox
//
// Nothing here reimplements either client: both run their shipping code, so
// "the desktop accepts what the phone wrote" is the desktop saying so.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as worker from '../../workers/vex-sync-worker/worker.js';
import { memoryStorage } from '../workers/syncHarness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

export const BASE = 'http://127.0.0.1:8787';

export function standIn() {
  // The worker as it runs on Cloudflare: one Durable Object with the sign-in
  // state, one per account (SYNC_PROTOCOL.md §1.2), each running one request
  // at a time, over in-memory storage the test can read.
  const objectState = storage => {
    let queue = Promise.resolve();
    return { storage, blockConcurrencyWhile(fn) { const run = queue.then(fn); queue = run.catch(() => {}); return run; } };
  };
  const env = {
    EMAIL_HASH_SECRET: 'stand-in-secret-for-tests-0123456789abcdef',
    DEVELOPMENT_MODE: 'true'
  };
  const global = new Map();
  const accounts = new Map();
  const globalObject = new worker.VexSyncState(objectState(memoryStorage(global)), env);
  const accountObjects = new Map();
  env.VEX_STATE = { idFromName: name => ({ name }), get: () => ({ fetch: request => globalObject.fetch(request) }) };
  env.VEX_ACCOUNTS = {
    idFromName: name => ({ name }),
    get: ({ name }) => ({
      fetch: request => {
        if (!accountObjects.has(name)) {
          if (!accounts.has(name)) accounts.set(name, new Map());
          accountObjects.set(name, new worker.VexSyncAccount(objectState(memoryStorage(accounts.get(name))), env));
        }
        return accountObjects.get(name).fetch(request);
      }
    })
  };
  const log = [];
  let chain = Promise.resolve();
  const hooks = { beforePush: null };
  async function handle(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const request = new Request(url, init);
    const pathName = new URL(url).pathname;
    const response = await worker.default.fetch(request, env);
    log.push({ method: init.method || 'GET', path: pathName, status: response.status });
    return response;
  }
  // One request at a time, as the account's object takes them.
  async function fetchImpl(input, init = {}) {
    // Another device's round, run just before this push reaches the worker.
    const url = typeof input === 'string' ? input : input.url;
    if (hooks.beforePush && new URL(url).pathname === '/sync/push') {
      const hook = hooks.beforePush;
      hooks.beforePush = null;
      await hook();
    }
    const run = chain.then(() => handle(input, init));
    chain = run.catch(() => {});
    return run;
  }
  // The account's stored blob: { revision, encryptedBlob, pushedBy, … }.
  const blobRow = () => {
    for (const records of accounts.values()) {
      for (const [key, row] of records) {
        if (key.startsWith('sync:blob:') && row && !row.deleted && typeof row.value === 'string') return { records, key, row, data: JSON.parse(row.value) };
      }
    }
    return null;
  };
  return {
    base: BASE, env, log, hooks, accounts,
    fetch: fetchImpl,
    blob: () => (blobRow() || {}).data || null,
    /** Lose the blob while the sessions stay, as a server that lost it would. */
    dropBlob() { const row = blobRow(); if (row) row.records.delete(row.key); },
    /** Everything the server keeps, as text: what it could ever show anyone. */
    rawText: () => JSON.stringify([...global.values(), ...[...accounts.values()].flatMap(records => [...records.values()])]),
    /** Replace the stored document, as another device's push would (revision + 1). */
    async putDocument(doc, keyHex) {
      const row = blobRow();
      const encryptedBlob = await encryptWith(doc, keyHex);
      const data = { ...row.data, revision: row.data.revision + 1, encryptedBlob };
      row.records.set(row.key, { ...row.row, value: JSON.stringify(data) });
    }
  };
}

function sandbox(stand, extra) {
  const context = {
    console, crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, btoa, URL,
    AbortController, structuredClone,
    fetch: stand.fetch,
    clearTimeout, clearInterval,
    // Background timers would race the test's own calls; short ones (a
    // marker push queued for "right after this pull") still run.
    setTimeout: (fn, ms) => (ms >= 1000 ? 0 : setTimeout(fn, ms)),
    setInterval: () => 0,
    ...extra
  };
  context.window = context;
  vm.createContext(context);
  return context;
}

export function desktop(stand, { name = 'desktop' } = {}) {
  const local = new Map();
  const storage = new Map();
  const disk = { meta: null, key: null };
  const toasts = [];
  const context = sandbox(stand, {
    localStorage: {
      getItem: key => (local.has(key) ? local.get(key) : null),
      setItem: (key, value) => local.set(key, String(value)),
      removeItem: key => local.delete(key),
      key: index => [...local.keys()][index] ?? null,
      get length() { return local.size; }
    },
    VexConfig: { syncWorkerUrl: () => stand.base },
    VexStorage: {
      load: async key => (storage.has(key) ? structuredClone(storage.get(key)) : null),
      save: async (key, value) => { if (value == null) storage.delete(key); else storage.set(key, structuredClone(value)); }
    },
    VexTabPolicy: { snapshot: value => value },
    vex: {
      platform: 'win32',
      syncSaveKey: async key => { disk.key = key; },
      syncSaveMeta: async meta => { disk.meta = meta; },
      syncLoadMeta: async () => disk.meta,
      syncLoadKey: async () => disk.key,
      syncClearState: async () => { disk.meta = null; disk.key = null; }
    },
    showToast: message => toasts.push(message),
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options && options.detail; } }
  });
  for (const file of ['src/renderer/js/sync-crypto.js', 'src/renderer/js/sync-records.js',
    'src/renderer/js/data-contracts.js', 'src/renderer/js/sync-engine.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return { name, context, local, storage, disk, toasts, engine: context.SyncEngine, records: context.VexSyncRecords, crypto: context.SyncCrypto };
}

export function phone(stand) {
  // The phone's open tabs, as VexTabStore holds them: the test sets them.
  const tabs = [];
  const store = new Map();
  const vault = new Map();
  const blobs = new Map();
  const toasts = [];
  const context = sandbox(stand, {
    VexStore: {
      get: (key, fallback) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
      set: async (key, value) => { store.set(key, structuredClone(value)); return value; },
      prime: async () => {},
      push: async () => {}
    },
    VexBridge: {
      vaultGet: async key => (vault.has(key) && vault.get(key) !== '' ? vault.get(key) : null),
      vaultSet: async (key, value) => { vault.set(key, value); }
    },
    VexDB: {
      get: async (name, key) => (name === 'blobs' && blobs.has(key) ? structuredClone(blobs.get(key)) : undefined),
      put: async (name, row) => { if (name === 'blobs') blobs.set(row.name, structuredClone(row)); },
      delete: async (name, key) => { if (name === 'blobs') blobs.delete(key); }
    },
    VexUI: { toast: message => toasts.push(message) },
    VexTabStore: { all: () => tabs, normal: () => tabs.filter(tab => !tab.incognito) }
  });
  for (const file of ['mobile/www/js/shared/sync-crypto.js', 'mobile/www/js/shared/sync-records.js',
    'mobile/www/js/shared/data-contracts.js', 'mobile/www/js/collections.js', 'mobile/www/js/sync.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return {
    context, store, vault, blobs, toasts, tabs,
    sync: context.VexSync,
    bookmarks: context.VexCollections.bookmarks,
    notes: () => store.get('vex.syncNotes') || [],
    setNotes: list => store.set('vex.syncNotes', structuredClone(list))
  };
}

/** Sign a device in through the stand-in: ask for a code, read it from the dev response. */
export async function codeFor(client, email) {
  const answer = client.sync ? await client.sync.requestCode(email) : await client.engine.requestCode(email);
  if (!answer.devCode) throw new Error('The stand-in did not return a code');
  return answer.devCode;
}

/** Decrypt the account's current document with a recovery code. */
export async function accountDocument(stand, recoveryCode) {
  const blob = stand.blob();
  if (!blob) return null;
  const hex = recoveryCode.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const key = await globalThis.crypto.subtle.importKey('raw', Buffer.from(hex, 'hex'), { name: 'AES-GCM' }, false, ['decrypt', 'encrypt']);
  const bytes = Buffer.from(blob.encryptedBlob, 'base64');
  const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return { text: Buffer.from(plain).toString('utf8'), doc: JSON.parse(Buffer.from(plain).toString('utf8')), revision: blob.revision };
}

export async function encryptWith(doc, keyHex) {
  const hex = keyHex.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const key = await globalThis.crypto.subtle.importKey('raw', Buffer.from(hex, 'hex'), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(doc))));
  return Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]).toString('base64');
}
