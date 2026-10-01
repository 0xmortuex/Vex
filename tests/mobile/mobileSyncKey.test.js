// @vitest-environment jsdom
//
// A phone whose key cannot open what is on the server must not write over it.
// Signing in before typing the recovery code used to make a fresh key; the pull
// failed to decrypt but kept the server's revision anyway, so the next
// scheduled push was accepted and the other devices' data was replaced by this
// phone's, under a key they do not have.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = { 'vex.syncWorkerUrl': 'https://sync.example' };
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexHistory = { recent: () => [], addRaw: async entry => entry };
window.VexCollections = {
  bookmarks: { all: () => [] }, sessions: { all: () => [] },
  reading: { all: () => [] }, quick: { all: () => [] }
};
window.VexTabStore = { normal: () => [] };
window.VexBridge = { vaultGet: async () => '', vaultSet: async () => {} };
window.SyncCrypto = {
  decrypt: vi.fn(),
  encrypt: vi.fn(async () => 'sealed')
};
window.VexSyncRecords = {
  empty: () => ({}),
  flatten: value => value,
  capture: doc => doc,
  merge: doc => doc,
  values: doc => doc,
  unflatten: doc => doc
};

const { VexSync } = require('../../mobile/www/js/sync.js');

let pushes = [];
function serve(revision) {
  pushes = [];
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    if (url.endsWith('/sync/pull')) {
      return { ok: true, status: 200, json: async () => ({ revision, encryptedBlob: 'theirs' }) };
    }
    if (url.endsWith('/sync/push')) {
      const body = JSON.parse(options.body);
      pushes.push(body);
      if (body.baseRevision !== revision) {
        return { ok: false, status: 409, json: async () => ({ error: 'Sync conflict: pull and merge before pushing', revision }) };
      }
      return { ok: true, status: 200, json: async () => ({ revision: revision + 1 }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

beforeEach(async () => {
  await VexSync.signOut();
  Object.assign(VexSync.state, { enabled: true, token: 't', key: 'wrong', email: 'me@example.com', revision: 0 });
  window.SyncCrypto.decrypt.mockReset();
});

describe('a key that does not open the blob', () => {
  it('does not take the server’s revision', async () => {
    serve(7);
    window.SyncCrypto.decrypt.mockRejectedValue(new Error('OperationError'));
    const result = await VexSync.pull();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/recovery code/);
    expect(VexSync.state.revision).toBe(0);
  });

  it('pushes nothing afterwards', async () => {
    serve(7);
    window.SyncCrypto.decrypt.mockRejectedValue(new Error('OperationError'));
    await VexSync.pull();
    const result = await VexSync.push();
    expect(result.ok).toBe(false);
    expect(pushes).toHaveLength(0);
  });

  it('pushes again once the right key reads it', async () => {
    serve(7);
    window.SyncCrypto.decrypt.mockRejectedValue(new Error('OperationError'));
    await VexSync.pull();
    window.SyncCrypto.decrypt.mockResolvedValue({});
    const result = await VexSync.syncNow();
    expect(result.ok).toBe(true);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].baseRevision).toBe(7);
  });
});
