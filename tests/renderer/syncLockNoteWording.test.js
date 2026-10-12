// @vitest-environment jsdom
//
// Settings › Vex Sync and the "now locked" toast said a sign-in code alone
// "cannot change or erase" a locked account. It can still erase it: "I lost
// my recovery code: start over" needs only a fresh code (found 2026-10-11 in
// a probe of v19.1.7). They now say what a code alone can and cannot do.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const Records = require('../../src/renderer/js/sync-records.js');

function freshEngine() {
  vi.resetModules();
  localStorage.clear();
  const stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = { syncSaveKey: async () => {}, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32' };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}

beforeEach(() => { window.showToast = vi.fn(); });

describe('what the lock to the sync key is said to do', () => {
  it('says a code alone cannot change the data but can still erase it to start over', async () => {
    workerStandIn();
    const engine = freshEngine();
    await engine.verifyCode('note@sync.test', (await engine.requestCode('note@sync.test')).devCode, 'Desk');
    expect(engine.keyCheckState().state).toBe('on');
    const toast = window.showToast.mock.calls.map(c => String(c[0])).find(m => /locked to your sync key/.test(m));
    expect(toast).not.toMatch(/change or erase/);
    expect(toast).toMatch(/erase it to start over/);

    require('../../src/renderer/js/sync-settings.js');
    document.body.innerHTML = '<div id="sync-panel-content"></div>';
    await window.SyncSettings.renderSyncPanel(document.getElementById('sync-panel-content'));
    const note = document.getElementById('sync-key-lock').textContent;
    expect(note).toMatch(/cannot change your synced data/);
    expect(note).not.toMatch(/change or erase/);
    expect(note).toMatch(/erase all of it to start over/);
  });
});
