// @vitest-environment jsdom
//
// The window's half of the automatic backup (js/auto-backup.js): it asks main only after a delay, makes the snapshot only
// when main says one is due, and tells the Attention Inbox when it failed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/i18n-ui.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');
globalThis.VexBackup = window.VexBackup = VexBackup;

let api, added, jobs;
function load() {
  vi.resetModules();
  delete window.VexAutoBackup;
  window.vex = { backup: api };
  return require('../../src/renderer/js/auto-backup.js').VexAutoBackup;
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '';
  added = [];
  jobs = [];
  globalThis.VexJobs = { every: (name, ms, fn, opts) => { jobs.push({ name, ms, fn, opts }); return { stop() {} }; } };
  globalThis.AttentionInbox = { add: (r) => { added.push(r); return true; }, handle: vi.fn() };
  window.VexStorage = globalThis.VexStorage = { load: async () => ({}) };
  VexBackup.collectMain = async () => ({});
  api = {
    autoDue: vi.fn(async () => ({ ok: true, due: true })),
    autoSave: vi.fn(async () => ({ ok: true, name: 'auto-daily-x.json' })),
    autoState: vi.fn(async () => ({ ok: true, state: { on: true, folder2: null, lastOkAt: 0, lastError: '' } })),
    autoList: vi.fn(async () => ({ ok: true, items: [{ name: 'auto-daily-2026-11-01-143000.json', kind: 'daily', at: 1, bytes: 2048 }] })),
    autoSet: vi.fn(async (on) => ({ ok: true, state: { on, folder2: null, lastOkAt: 0, lastError: '' } })),
    autoRead: vi.fn(),
  };
});
afterEach(() => { vi.useRealTimers(); delete globalThis.AttentionInbox; delete globalThis.VexJobs; delete window.vex; });

describe('scheduling', () => {
  it('asks nothing at start-up: the first question comes three minutes later', async () => {
    load();
    expect(api.autoDue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(api.autoDue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(61 * 1000);
    expect(api.autoDue).toHaveBeenCalledTimes(1);
    // afterwards it is a shared job (held by a game, a hidden window, battery-aware mode), not a timer of its own
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: 'auto-backup', ms: 60 * 60 * 1000, opts: { when: 'background', deferOnBattery: true } });
    await jobs[0].fn();
    expect(api.autoDue).toHaveBeenCalledTimes(2);
  });
  it('does nothing in a window without the bridge, or a private window', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    load();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(api.autoDue).not.toHaveBeenCalled();
    delete window.VexTabPolicy;
  });
});

describe('check()', () => {
  it('makes no snapshot when main says nothing is due', async () => {
    api.autoDue = vi.fn(async () => ({ ok: true, due: false, why: 'game' }));
    const snap = vi.spyOn(VexBackup, 'snapshot');
    expect(await load().check()).toBe('not-due:game');
    expect(snap).not.toHaveBeenCalled();
    expect(api.autoSave).not.toHaveBeenCalled();
    snap.mockRestore();
  });
  it('saves a sealed snapshot with no inbox row when it works', async () => {
    expect(await load().check()).toBe('saved');
    const sent = JSON.parse(api.autoSave.mock.calls[0][0]);
    expect(sent.v).toBe(2);
    expect(VexBackup.verify(sent)).toBe('verified');
    expect(added).toEqual([]);
  });
  it('puts a failure in the Attention Inbox with a way to open the backups', async () => {
    api.autoSave = vi.fn(async () => ({ ok: false, error: 'Vex could not save the automatic backup (ENOSPC)' }));
    expect(await load().check()).toBe('failed');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ feature: 'auto-backup', id: 'failed', title: 'The automatic backup could not be saved', body: expect.stringContaining('ENOSPC'), action: { key: 'open' } });
  });
  it('a snapshot that cannot be made is a failure too, not silence', async () => {
    const snap = vi.spyOn(VexBackup, 'snapshot').mockRejectedValue(new Error('settings unreadable'));
    expect(await load().check()).toBe('failed');
    expect(added[0].body).toMatch(/settings unreadable/);
    snap.mockRestore();
  });
  it('a failed second copy is reported though the backup itself was saved', async () => {
    api.autoSave = vi.fn(async () => ({ ok: true, second: { ok: false, error: 'The second copy could not be written (ENOENT)' } }));
    expect(await load().check()).toBe('saved');
    expect(added[0]).toMatchObject({ id: 'second', title: 'The second copy of the automatic backup could not be written' });
  });
  it('a gate that closed between the question and the save is not an error', async () => {
    api.autoSave = vi.fn(async () => ({ ok: false, skipped: 'battery' }));
    expect(await load().check()).toBe('not-due:battery');
    expect(added).toEqual([]);
  });
});

describe('the section in Settings > Backup', () => {
  it('shows the switch, lists the copies and turns it on', async () => {
    vi.useRealTimers();
    const mod = load();
    const m = document.createElement('div');
    m.innerHTML = '<div id="bk-auto"><input type="checkbox" id="bk-auto-on"><button id="bk-auto-folder"></button><button id="bk-auto-clear" hidden></button><span id="bk-auto-where"></span><div id="bk-auto-status"></div><div id="bk-auto-list"></div></div>';
    const msgs = [];
    await mod.mount(m, (t) => msgs.push(t));
    expect(m.querySelector('#bk-auto-on').checked).toBe(true);
    expect(m.querySelectorAll('#bk-auto-list [data-backup]').length).toBe(1);
    const box = m.querySelector('#bk-auto-on');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));
    expect(api.autoSet).toHaveBeenCalledWith(false);
    expect(msgs.at(-1)).toMatch(/Automatic backup is off/);
  });
});
