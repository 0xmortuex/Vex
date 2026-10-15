// @vitest-environment jsdom
//
// The update safety net (js/update-safety-net.js): after an update, the backup
// the cover made just before it installed can be put back in one click, with
// Undo. It only reads backups that exist; no updater, no installer, no network.
// The backup file itself, its secret filter and its naming are tested in
// updateBackups.test.js and backupSecretFilter.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let Net, VexBackup;
const backupText = (items, app = '2.35.0') => JSON.stringify({ v: 1, at: '2026-10-10T10:00:00.000Z', app, items, stores: {} });

function setup({ version = '2.35.1', items, listed } = {}) {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  const files = { 'before-2.35.1-2026-10-10-100000.json': backupText(items || { 'vex.theme': '"oxford"', 'vex.notes': '[1]' }) };
  const at = (d) => new Date(d).getTime();
  window.vex = {
    getAppVersion: async () => version,
    updates: {
      listBackups: vi.fn(async () => ({ ok: true, items: listed || [
        { name: 'before-2.35.1-2026-10-10-100000.json', kind: 'before', version: '2.35.1', at: Date.now() - 86400e3, bytes: 100 },
        { name: 'before-2.34.0-2026-09-01-100000.json', kind: 'before', version: '2.34.0', at: at('2026-09-01'), bytes: 100 },
      ] })),
      readBackup: vi.fn(async (name) => (name in files ? { ok: true, text: files[name] } : { ok: false, error: 'not found' })),
    },
  };
  window.showToast = vi.fn();
  globalThis.vexConfirm = vi.fn(async () => true);
  VexBackup = fresh('../../src/renderer/js/backup.js').VexBackup;
  globalThis.VexBackup = VexBackup;
  VexBackup._reloadLive = vi.fn();
  globalThis.VexStorage = { load: async () => null, save: async () => true };
  globalThis.VexSettingsGroups = fresh('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
  Net = fresh('../../src/renderer/js/update-safety-net.js').VexUpdateSafetyNet;
}

describe('update safety net', () => {
  beforeEach(() => setup());

  it('finds the backup made before the running version, not one for another version', async () => {
    const f = await Net.find();
    expect(f.version).toBe('2.35.1');
    expect(f.item.name).toBe('before-2.35.1-2026-10-10-100000.json');
    window.vex.getAppVersion = async () => '9.9.9';
    expect(await Net.find()).toBeNull();
  });

  it('ignores a backup older than two weeks', async () => {
    setup({ listed: [{ name: 'before-2.35.1-2026-01-01-100000.json', kind: 'before', version: '2.35.1', at: Date.now() - 60 * 86400e3, bytes: 1 }] });
    expect(await Net.find()).toBeNull();
  });

  it('is not offered in a private window', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await Net.find()).toBeNull();
    delete window.VexTabPolicy;
  });

  it('restores the settings after asking, and Undo puts back what was there', async () => {
    localStorage.setItem('vex.theme', '"dark"');
    localStorage.setItem('vex.extra', 'mine');
    const { item } = await Net.find();
    const r = await Net.restore(item);
    expect(globalThis.vexConfirm).toHaveBeenCalled();
    expect(r.written).toBe(2);
    expect(localStorage.getItem('vex.theme')).toBe('"oxford"');
    expect(localStorage.getItem('vex.extra')).toBe('mine');      // what the backup lacks is left alone
    await Net.undo();
    expect(localStorage.getItem('vex.theme')).toBe('"dark"');
    expect(localStorage.getItem('vex.notes')).toBeNull();
  });

  it('declining the question restores nothing', async () => {
    globalThis.vexConfirm.mockResolvedValue(false);
    localStorage.setItem('vex.theme', '"dark"');
    const { item } = await Net.find();
    expect(await Net.restore(item)).toBeNull();
    expect(localStorage.getItem('vex.theme')).toBe('"dark"');
  });

  it('secrets in a doctored backup are not written (the restore goes through VexBackup)', async () => {
    setup({ items: { 'vex.theme': '"oxford"', 'vex.lockPin': 'abc', 'vex.syncToken': 'zzz' } });
    const { item } = await Net.find();
    await Net.restore(item);
    expect(localStorage.getItem('vex.lockPin')).toBeNull();
    expect(localStorage.getItem('vex.syncToken')).toBeNull();
  });

  it('raises when the list cannot be read, instead of pretending there is no backup', async () => {
    window.vex.updates.listBackups = async () => ({ ok: false, error: 'EACCES' });
    await expect(Net.find()).rejects.toThrow(/could not be listed/);
  });

  it('says once per backup that the update was backed up', async () => {
    expect(await Net.announce()).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('2.35.1'), 'info', 9000, expect.objectContaining({ action: expect.any(Object) }));
    expect(await Net.announce()).toBe(false);
  });

  it('the screen offers the restore and shows the backup', async () => {
    Net.open();
    await vi.waitFor(() => expect(document.getElementById('vex-safety-net-dialog').textContent).toContain('Backup made before updating to 2.35.1'));
    const go = [...document.querySelectorAll('#vex-safety-net-dialog button')].find(b => b.textContent.startsWith('Restore'));
    go.click();
    await vi.waitFor(() => expect(localStorage.getItem('vex.theme')).toBe('"oxford"'));
  });
});
