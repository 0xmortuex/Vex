// @vitest-environment jsdom
//
// The theme and the tab layout synced, but the browser look, skin, fonts and
// reading aids stayed on each device, so a second computer wore the synced
// theme in another look (settings audit, 2026-10-10). They sync now and are
// put on screen as they arrive; the interface size and spacing stay per
// device, since they depend on the screen.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

require('../../src/renderer/js/vex-utils.js');
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
function lookModules() {
  window.VexGuiStyle = { get: () => localStorage.getItem('vex.guiStyle') || 'classic', set: vi.fn(async (s) => { document.body.dataset.guiStyle = s; }), getColors: () => localStorage.getItem('vex.guiColors') || 'look', setColors: vi.fn() };
  window.VexFonts = { apply: vi.fn() };
  window.VexSkins = { apply: vi.fn() };
  window.AccessibilityPack = { init: vi.fn(), reapplyAll: vi.fn() };
}
async function otherDeviceSets(system, email, change) {
  const other = await system.signIn(email, 'B');
  const r = await system.call('GET', '/sync/pull', undefined, other.sessionToken);
  const doc = await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key());
  const values = Records.unflatten(Records.values(doc));
  values['sync:device:' + other.deviceId] = { level: 2, revision: r.body.revision };
  change(values);
  await system.provenPush(other, keyHex, r.body.revision, await window.SyncCrypto.encrypt(Records.capture(doc, Records.flatten(values), other.deviceId), await key()));
}

beforeEach(() => { localStorage.clear(); document.body.removeAttribute('data-gui-style'); delete globalThis.ThemeAuto; window.showToast = vi.fn(); });

describe('the look travels, the interface size does not', () => {
  it('sends the look, skin, fonts and reading aids, and not the size or spacing', async () => {
    const { system } = workerStandIn();
    lookModules();
    const engine = freshEngine();
    for (const [k, v] of [['vex.guiStyle', 'firefox'], ['vex.skinShape', 'square'], ['vex.font', 'inter'], ['vex.a11y', '{"font":"lexend"}'], ['vex.uiScale', 'large'], ['vex.uiDensity', 'compact']]) localStorage.setItem(k, v);
    await engine.verifyCode('look@sync.test', (await engine.requestCode('look@sync.test')).devCode);
    const r = await system.call('GET', '/sync/pull', undefined, engine.getState().sessionToken);
    const values = Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
    expect(values['preference:vex.guiStyle']).toBe('firefox');
    expect(values['preference:vex.skinShape']).toBe('square');
    expect(values['preference:vex.font']).toBe('inter');
    expect(values['preference:vex.a11y']).toBe('{"font":"lexend"}');
    expect(values['preference:vex.uiScale']).toBeUndefined();
    expect(values['preference:vex.uiDensity']).toBeUndefined();
  });

  it('a look that arrives is worn at once; the size here is left alone', async () => {
    const { system } = workerStandIn();
    lookModules();
    const engine = freshEngine();
    localStorage.setItem('vex.uiScale', 'large');
    await engine.verifyCode('wear@sync.test', (await engine.requestCode('wear@sync.test')).devCode);
    await otherDeviceSets(system, 'wear@sync.test', v => { v['preference:vex.guiStyle'] = 'chrome'; v['preference:vex.font'] = 'inter'; v['preference:vex.uiScale'] = 'small'; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(VexGuiStyle.set).toHaveBeenCalledWith('chrome');
    expect(VexFonts.apply).toHaveBeenCalled();
    expect(VexSkins.apply).toHaveBeenCalled();
    expect(AccessibilityPack.reapplyAll).toHaveBeenCalled();
    expect(localStorage.getItem('vex.uiScale')).toBe('large');
  });

  it('with Light and dark on, another device\'s dark twin of the look is not worn here', async () => {
    const { system } = workerStandIn();
    lookModules();
    globalThis.ThemeAuto = { isOn: () => true, LOOK_PAIRS: { firefox: 'firefox-dark' }, evaluate: vi.fn() };
    const engine = freshEngine();
    localStorage.setItem('vex.guiStyle', 'firefox');
    document.body.dataset.guiStyle = 'firefox';
    await engine.verifyCode('twin@sync.test', (await engine.requestCode('twin@sync.test')).devCode);
    await otherDeviceSets(system, 'twin@sync.test', v => { v['preference:vex.guiStyle'] = 'firefox-dark'; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(VexGuiStyle.set).not.toHaveBeenCalled();
  });

  it('a pull that changed nothing about the look repaints nothing', async () => {
    const { system } = workerStandIn();
    lookModules();
    const engine = freshEngine();
    await engine.verifyCode('same@sync.test', (await engine.requestCode('same@sync.test')).devCode);
    await otherDeviceSets(system, 'same@sync.test', v => { v['preference:vex.bookmarks'] = []; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(VexFonts.apply).not.toHaveBeenCalled();
  });
});
