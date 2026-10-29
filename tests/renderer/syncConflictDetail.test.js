// @vitest-environment jsdom
//
// The side-by-side view of a Sync conflict (js/sync-conflict-detail.js): the
// whole of each version, differing fields marked, one button per version.
// Run against the same local Vex Sync stand-in as syncConflicts.test.js; the
// wire format and the merge are not changed, and no live endpoint is called.
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
const note = (id, title, at, extra = {}) => ({ id, title, content: title, updatedAt: new Date(at).toISOString(), ...extra });

async function conflictSetUp(email) {
  const { system } = workerStandIn();
  const engine = freshEngine();
  localStorage.setItem('vex.notes', JSON.stringify([note('n1', 'Shopping', 1)]));
  await engine.verifyCode(email, (await engine.requestCode(email)).devCode);
  const other = await system.signIn(email, 'B');
  const r = await system.call('GET', '/sync/pull', undefined, other.sessionToken);
  const doc = await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
  const values = Records.unflatten(Records.values(doc));
  values['preference:vex.notes'] = [note('n1', 'Shopping: milk, eggs', 2, { color: 'blue' })];
  values['sync:device:' + other.deviceId] = { level: 2, revision: r.body.revision };
  await system.provenPush(other, keyHex, r.body.revision, await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), other.deviceId), await key()));
  await new Promise(res => setTimeout(res, 5));
  localStorage.setItem('vex.notes', JSON.stringify([note('n1', 'Shopping: bread', 3)]));
  expect((await engine.pullNow()).ok).toBe(true);
  return { engine };
}

function loadView() {
  window.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons || window.VexIcons;
  globalThis.VexSettingsGroups = require('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
  globalThis.SyncEngine = window.SyncEngine;
  globalThis.vexConfirm = vi.fn(async () => true);
  return require('../../src/renderer/js/sync-conflict-detail.js').VexSyncConflictDetail;
}

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; window.showToast = vi.fn(); });

describe('conflict detail', () => {
  it('gives the whole of each version, marks the one in use, and never a sealed value', async () => {
    const { engine } = await conflictSetUp('detail@sync.test');
    const [c] = engine.conflicts();
    const d = engine.conflictDetail(c.key);
    expect(d.what).toBe('Notes › Shopping: bread');
    expect(d.versions).toHaveLength(2);
    const inUse = d.versions.find(v => v.current);
    expect(inUse.value.title).toBe('Shopping: bread');
    expect(d.versions.find(v => !v.current).value).toMatchObject({ title: 'Shopping: milk, eggs', color: 'blue' });
    expect(d.versions.every(v => v.sealed === false)).toBe(true);
    expect(engine.conflictDetail('["nope","item","x"]')).toBeNull();
  });

  it('shows both versions field by field with the differing fields marked', async () => {
    const { engine } = await conflictSetUp('side@sync.test');
    const View = loadView();
    const [c] = engine.conflicts();
    View.open(c.key);
    const dlg = document.getElementById('vex-sync-conflict-dialog');
    const rows = [...dlg.querySelectorAll('tr.vex-sync-differs')].map(r => r.querySelector('th').textContent);
    expect(rows.some(t => t.startsWith('title'))).toBe(true);
    expect(rows.some(t => t.startsWith('color'))).toBe(true);
    expect(dlg.textContent).toContain('Shopping: milk, eggs');
    expect(dlg.textContent).toContain('(not set)');           // color exists on one side only
    expect(dlg.textContent).toContain('(in use)');
  });

  it('choosing a version asks first, puts it back, and ends the conflict', async () => {
    const { engine } = await conflictSetUp('choose@sync.test');
    const View = loadView();
    const [c] = engine.conflicts();
    const older = c.versions.findIndex(v => !v.current);
    const done = vi.fn();
    View.open(c.key, { done });
    const buttons = [...document.querySelectorAll('#vex-sync-conflict-dialog .vexsr-row button')];
    buttons[older].click();
    await vi.waitFor(() => expect(engine.conflicts()).toEqual([]));
    expect(globalThis.vexConfirm).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('vex.notes')).map(n => n.title)).toEqual(['Shopping: milk, eggs']);
    // done runs a moment after the conflict list is empty: wait for it (this was a race that failed in CI, 2026-10-29)
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(document.getElementById('vex-sync-conflict-dialog')).toBeNull();
  });

  it('declining the confirmation changes nothing', async () => {
    const { engine } = await conflictSetUp('decline@sync.test');
    const View = loadView();
    globalThis.vexConfirm.mockResolvedValue(false);
    const [c] = engine.conflicts();
    View.open(c.key);
    document.querySelector('#vex-sync-conflict-dialog .vexsr-row button').click();
    await new Promise(r => setTimeout(r, 20));
    expect(engine.conflicts()).toHaveLength(1);
  });

  it('a conflict that is gone raises instead of drawing an empty screen', async () => {
    await conflictSetUp('gone@sync.test');
    const View = loadView();
    expect(() => View.open('["x","item","y"]')).toThrow(/no longer there/);
  });

  it('the Sync conflicts dialog offers Compare both', async () => {
    await conflictSetUp('compare@sync.test');
    loadView();
    window.VexSyncConflictDetail = require('../../src/renderer/js/sync-conflict-detail.js').VexSyncConflictDetail;
    globalThis.VexSyncConflictDetail = window.VexSyncConflictDetail;
    require('../../src/renderer/js/sync-settings.js');
    document.body.innerHTML = '<div id="sync-panel-content"></div>';
    await window.SyncSettings.renderSyncPanel(document.getElementById('sync-panel-content'));
    document.getElementById('btn-sync-conflicts').click();
    const compare = document.querySelector('.sync-modal-overlay [data-compare]');
    expect(compare).toBeTruthy();
    compare.click();
    expect(document.getElementById('vex-sync-conflict-dialog')).toBeTruthy();
  });
});
