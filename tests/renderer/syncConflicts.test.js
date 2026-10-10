// @vitest-environment jsdom
//
// When two devices changed the same thing before syncing, the version that
// lost was kept in the account and only counted in a toast ("1 sync conflict
// retained in recovery data"); nothing showed it or brought it back (found
// 2026-10-10). Settings › Vex Sync › Sync conflicts lists both versions and
// puts the chosen one back on every device.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const Records = require('../../src/renderer/js/sync-records.js');

let stores, keyHex;
function freshEngine() {
  vi.resetModules();
  stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = { syncSaveKey: async (hex) => { keyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32' };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const key = () => window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(keyHex));
const note = (id, title, at) => ({ id, title, content: title, updatedAt: new Date(at).toISOString() });

async function conflictSetUp(email) {
  const { system } = workerStandIn();
  const engine = freshEngine();
  localStorage.setItem('vex.notes', JSON.stringify([note('n1', 'Shopping', 1)]));
  await engine.verifyCode(email, (await engine.requestCode(email)).devCode);
  const other = await system.signIn(email, 'B');
  // Both devices edit the note before syncing: B first (older), then here.
  const r = await system.call('GET', '/sync/pull', undefined, other.sessionToken);
  const doc = await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
  const values = Records.unflatten(Records.values(doc));
  values['preference:vex.notes'] = [note('n1', 'Shopping: milk, eggs', 2)];
  values['sync:device:' + other.deviceId] = { level: 2, revision: r.body.revision };
  await system.push(other.sessionToken, r.body.revision, await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), other.deviceId), await key()));
  await new Promise(res => setTimeout(res, 5));
  localStorage.setItem('vex.notes', JSON.stringify([note('n1', 'Shopping: bread', 3)]));
  expect((await engine.pullNow()).ok).toBe(true);
  return { system, engine, other };
}

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); });

describe('sync conflicts can be seen and put back', () => {
  it('lists both versions, says which is in use, and points to where they are', async () => {
    const { engine } = await conflictSetUp('see@sync.test');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Settings › Vex Sync › Sync conflicts'));
    const list = engine.conflicts();
    expect(list).toHaveLength(1);
    expect(list[0].what).toBe('Notes › Shopping: bread');
    expect(list[0].versions.map(v => [v.text, v.current]).sort()).toEqual([['Shopping: bread', true], ['Shopping: milk, eggs', false]]);
  });

  it('the version you pick is put back here and on the other device, and the conflict is gone', async () => {
    const { system, engine, other } = await conflictSetUp('pick@sync.test');
    const [c] = engine.conflicts();
    const older = c.versions.findIndex(v => !v.current);
    expect((await engine.resolveConflict(c.key, older)).ok).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.notes')).map(n => n.title)).toEqual(['Shopping: milk, eggs']);
    expect(engine.conflicts()).toEqual([]);
    const r = await system.call('GET', '/sync/pull', undefined, other.sessionToken);
    const values = Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
    expect(values['preference:vex.notes'].map(n => n.title)).toEqual(['Shopping: milk, eggs']);
  });

  it('the Sync panel shows the conflicts and a Review button that opens them', async () => {
    const { engine } = await conflictSetUp('panel@sync.test');
    require('../../src/renderer/js/sync-settings.js');
    document.body.innerHTML = '<div id="sync-panel-content"></div>';
    await window.SyncSettings.renderSyncPanel(document.getElementById('sync-panel-content'));
    expect(document.querySelector('#sync-conflicts h3').textContent).toBe('Sync conflicts (1)');
    document.getElementById('btn-sync-conflicts').click();
    const dialog = document.querySelector('.sync-modal-overlay[role="dialog"]');
    expect(dialog.textContent).toContain('Shopping: milk, eggs');
    const use = [...dialog.querySelectorAll('[data-conflict]')].find(b => b.textContent === 'Use this one');
    use.click();
    await vi.waitFor(() => expect(engine.conflicts()).toEqual([]));
    await vi.waitFor(() => expect(document.querySelector('.sync-modal-overlay').textContent).toContain('No conflicts left.'));
  });
});
