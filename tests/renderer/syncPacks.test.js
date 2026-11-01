// @vitest-environment jsdom
//
// Theme packs and icon packs set the skin and fonts, which synced, but the
// pack's design, icons and its "Back to Vex's own design" record did not, so a
// second device wore the pack's skin without it. They travel with the look now
// and are put back on screen as they arrive.
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
  window.VexThemePacks = { apply: vi.fn() };
  window.VexIconPacks = { apply: vi.fn() };
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

const PACK = JSON.stringify({ v: 1, pack: null, design: 'slab', prev: { skin: { pattern: 'none' } } });

beforeEach(() => { localStorage.clear(); document.body.removeAttribute('data-gui-style'); delete globalThis.ThemeAuto; window.showToast = vi.fn(); });

describe('theme packs and icon packs travel with the look', () => {
  it('the pack and the icon pack are sent, with the record Back needs', async () => {
    const { system } = workerStandIn();
    lookModules();
    const engine = freshEngine();
    localStorage.setItem('vex.themePack', PACK);
    localStorage.setItem('vex.iconPack', 'pixel');
    await engine.verifyCode('packs@sync.test', (await engine.requestCode('packs@sync.test')).devCode);
    const r = await system.call('GET', '/sync/pull', undefined, engine.getState().sessionToken);
    const values = Records.unflatten(Records.values(await window.SyncCrypto.decrypt(r.body.encryptedBlob, await key())));
    expect(values['preference:vex.themePack']).toBe(PACK);
    expect(values['preference:vex.iconPack']).toBe('pixel');
  });

  it('a pack that arrives is stored and put back on screen', async () => {
    const { system } = workerStandIn();
    lookModules();
    const engine = freshEngine();
    await engine.verifyCode('arrive@sync.test', (await engine.requestCode('arrive@sync.test')).devCode);
    await otherDeviceSets(system, 'arrive@sync.test', v => { v['preference:vex.themePack'] = PACK; v['preference:vex.iconPack'] = 'pixel'; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(localStorage.getItem('vex.themePack')).toBe(PACK);
    expect(localStorage.getItem('vex.iconPack')).toBe('pixel');
    expect(window.VexThemePacks.apply).toHaveBeenCalled();
    expect(window.VexIconPacks.apply).toHaveBeenCalled();
  });

  it('a pull that changed nothing about the look re-applies no pack', async () => {
    const { system } = workerStandIn();
    lookModules();
    const engine = freshEngine();
    await engine.verifyCode('quiet@sync.test', (await engine.requestCode('quiet@sync.test')).devCode);
    await otherDeviceSets(system, 'quiet@sync.test', v => { v['preference:vex.bookmarks'] = []; });
    expect((await engine.pullNow()).ok).toBe(true);
    expect(window.VexThemePacks.apply).not.toHaveBeenCalled();
    expect(window.VexIconPacks.apply).not.toHaveBeenCalled();
  });
});
