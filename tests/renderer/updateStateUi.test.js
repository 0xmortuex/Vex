// @vitest-environment jsdom
//
// What the update cover says when "Update now" cannot work or has not finished
// (owner report 2026-11-01: the update was recognised, then nothing happened):
// a copy that is not installed, a download waiting for a restart, the notices
// after an install that did not install or a rollback, and the update log.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { UpdateNotifier } = require('../../src/renderer/js/update-notifier.js');

const REASON = 'This copy of Vex 2.34.5 is running from source code, so it cannot update itself. Install Vex with Vex-Setup.exe to get automatic updates.';
const folderInfo = { ok: true, hasUpdate: true, latest: '2.35.0', current: '2.34.5', size: 250 * 1024 * 1024, canSelfUpdate: false, cannotUpdateReason: REASON,
  downloadUrl: 'https://github.com/0xmortuex/Vex/releases/download/v2.35.0/Vex-Setup.exe', releaseUrl: 'https://github.com/0xmortuex/Vex/releases/tag/v2.35.0' };
const cover = () => document.getElementById('update-cover');
const button = act => cover().querySelector(`[data-act="${act}"]`);
const labels = () => [...cover().querySelectorAll('.update-cover-actions button')].map(b => b.textContent);
const flush = () => new Promise(r => setTimeout(r, 0));
let status;

beforeEach(() => {
  UpdateNotifier.close();
  document.body.innerHTML = '';
  localStorage.clear();
  globalThis.VexProblems = { note: vi.fn() };
  delete window.VexTabPolicy;
  status = { ok: true, current: '2.34.5', copy: { kind: 'installed' }, staged: null, notice: null, blocked: null, log: [] };
  window.vexConfirm = vi.fn(async () => false);
  window.vex = {
    openExternal: vi.fn(),
    updates: {
      upcomingNotes: vi.fn(async () => ({ ok: true, source: 'changelog', entries: [] })),
      download: vi.fn(async () => ({ ok: true })),
      install: vi.fn(async () => ({ ok: true })),
      saveBackup: vi.fn(async () => ({ ok: true, name: 'b.json', bytes: 1 })),
      status: vi.fn(async () => status),
      log: vi.fn(async () => ({ ok: true, lines: ['2026-11-01T10:00:00.000Z  checked: running 2.34.5, newest 2.35.0'] })),
      acknowledge: vi.fn(async () => ({ ok: true })),
      onProgress: () => {}, onInstallFailed: () => {},
    },
  };
  window.VexBackup = { snapshot: vi.fn(async () => ({ v: 1, items: {}, stores: {} })) };
});
afterEach(() => { UpdateNotifier.close(); });

describe('a folder copy (dist\\win-unpacked) is updated in place', () => {
  const inPlace = { ...folderInfo, canSelfUpdate: true, cannotUpdateReason: null, inPlaceFolder: 'C:\\Claude code free\\vex\\dist\\win-unpacked' };
  it('keeps Update now and says once where the update goes', async () => {
    UpdateNotifier.showCover(inPlace);
    await flush();
    expect(labels()).toEqual(['Update now', 'Later', 'Skip this version']);
    expect(cover().querySelector('.update-cover-status-text').textContent).toBe('This copy will be updated in place in C:\\Claude code free\\vex\\dist\\win-unpacked');
  });
  it('an installed copy has no such line', async () => {
    UpdateNotifier.showCover({ ...inPlace, inPlaceFolder: null });
    await flush();
    expect(cover().querySelector('.update-cover-status-text').textContent).toBe('');
  });
  it('a waiting download in a folder copy says it too', async () => {
    status.copy = { kind: 'folder', folder: 'C:\\vex\\dist\\win-unpacked' };
    status.staged = { version: '2.35.0', size: 1000 };
    await UpdateNotifier.checkState();
    expect(cover().querySelector('.update-cover-status-text').textContent).toBe('This copy will be updated in place in C:\\vex\\dist\\win-unpacked');
  });
});

describe('source run (npm start): not updatable', () => {
  it('has no "Update now": it says why and offers the installer', async () => {
    UpdateNotifier.showCover(folderInfo);
    await flush();
    expect(labels()).toEqual(['Download Vex-Setup.exe', 'Later', 'Skip this version']);
    expect(cover().querySelector('.update-cover-status-text').textContent).toBe(REASON);
    expect(button('update')).toBe(null);
  });
  it('the download button opens the installer address, and Enter does the same, never an install', async () => {
    UpdateNotifier.showCover(folderInfo);
    await flush();
    button('manual').click();
    expect(window.vex.openExternal).toHaveBeenCalledWith(folderInfo.downloadUrl);
    UpdateNotifier.showCover(folderInfo);
    await flush();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    cover().querySelector('.update-cover-notes-body').dispatchEvent(enter);
    expect(window.vex.openExternal).toHaveBeenCalledTimes(2);
    expect(window.vex.updates.download).not.toHaveBeenCalled();
    expect(window.vex.updates.install).not.toHaveBeenCalled();
  });
});

describe('a downloaded update that is still waiting', () => {
  it('comes up at start as "Restart now to install", with the backup, then installs without downloading again', async () => {
    status.staged = { version: '2.35.0', size: 1000 };
    await UpdateNotifier.checkState();
    expect(cover().querySelector('#update-cover-title').textContent).toBe('Vex 2.35.0 is downloaded and ready to install');
    expect(labels()).toEqual(['Restart now to install', 'Later']);
    button('install-staged').click();
    await flush(); await flush(); await flush();
    expect(window.vex.updates.saveBackup).toHaveBeenCalledWith('2.35.0', expect.any(String));
    expect(window.vex.updates.install).toHaveBeenCalledWith('2.35.0');
    expect(window.vex.updates.download).not.toHaveBeenCalled();
  });
  it('an install that fails shows the reason, and Try again installs again', async () => {
    status.staged = { version: '2.35.0', size: 1000 };
    window.vex.updates.install = vi.fn(async () => ({ ok: false, error: 'The downloaded update changed on disk after it was checked, so Vex deleted it. Download it again.' }));
    await UpdateNotifier.checkState();
    button('install-staged').click();
    await flush(); await flush(); await flush();
    expect(cover().dataset.phase).toBe('error');
    expect(cover().querySelector('.update-cover-status-text').textContent).toMatch(/changed on disk/);
    expect(labels()).toEqual(['Try again', 'Download it yourself', 'Later']);
  });
  it('is not shown while a notice about the last install is', async () => {
    status.staged = { version: '2.35.0', size: 1000 };
    status.notice = { kind: 'not-installed', from: '2.34.5', to: '2.35.0' };
    await UpdateNotifier.checkState();
    expect(cover()).toBe(null);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('what happened to the last install', () => {
  it('an installer that did not install is told in plain words with the log offered; it is marked read', async () => {
    status.notice = { kind: 'not-installed', from: '2.34.5', to: '2.35.0' };
    window.vexConfirm = vi.fn(async () => true);
    await UpdateNotifier.checkState();
    const arg = window.vexConfirm.mock.calls[0][0];
    expect(arg.title).toBe('Vex 2.35.0 was not installed');
    expect(arg.message).toMatch(/2\.34\.5 is still the version that started/);
    expect(arg.okLabel).toBe('Show the update log');
    expect(window.vex.updates.acknowledge).toHaveBeenCalled();
    // The second dialog is the log itself.
    expect(window.vexConfirm).toHaveBeenCalledTimes(2);
    expect(window.vexConfirm.mock.calls[1][0].html).toMatch(/checked: running 2\.34\.5/);
  });
  it('a rollback is told, and the version it left is not offered again', async () => {
    status.notice = { kind: 'rolled-back', from: '2.34.5', to: '2.35.0' };
    status.blocked = '2.35.0';
    await UpdateNotifier.checkState();
    expect(window.vexConfirm.mock.calls[0][0].title).toBe('Vex went back to 2.34.5');
    expect(UpdateNotifier.skippedVersion()).toBe('2.35.0');
    expect(UpdateNotifier.shouldAnnounce({ ok: true, hasUpdate: true, latest: '2.35.0', current: '2.34.5' })).toBe(false);
    expect(UpdateNotifier.shouldAnnounce({ ok: true, hasUpdate: true, latest: '2.35.1', current: '2.34.5' })).toBe(true);
  });
  it('a failed rollback and a missing old installer both say what to do', async () => {
    status.notice = { kind: 'rollback-failed', from: '2.34.5', to: '2.35.0', error: 'The kept installer changed on disk.' };
    await UpdateNotifier.checkState();
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/Install 2\.34\.5 yourself/);
    window.vexConfirm.mockClear();
    status.notice = { kind: 'broken-no-backup', from: '2.34.5', to: '2.35.0' };
    await UpdateNotifier.checkState();
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/no installer of 2\.34\.5 was kept/);
  });
  it('a state that cannot be read is a problem entry, not nothing', async () => {
    window.vex.updates.status = vi.fn(async () => ({ ok: false, error: 'boom' }));
    expect(await UpdateNotifier.checkState()).toBe(null);
    expect(VexProblems.note).toHaveBeenCalled();
  });
  it('never in a private window', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await UpdateNotifier.checkState()).toBe(null);
    expect(window.vex.updates.status).not.toHaveBeenCalled();
  });
});

describe('the update log', () => {
  it('the cover has an Update log link that shows the lines as text', async () => {
    UpdateNotifier.showCover({ ...folderInfo, canSelfUpdate: true });
    await flush();
    button('log').click();
    await flush(); await flush();
    const html = window.vexConfirm.mock.calls[0][0].html;
    expect(html).toContain('update-log-pre');
    expect(html).toContain('checked: running 2.34.5, newest 2.35.0');
  });
  it('log text is escaped, and an unreadable log says so', async () => {
    window.vex.updates.log = vi.fn(async () => ({ ok: true, lines: ['<img src=x onerror=alert(1)>'] }));
    await UpdateNotifier.showLog();
    expect(window.vexConfirm.mock.calls[0][0].html).not.toContain('<img');
    window.vex.updates.log = vi.fn(async () => ({ ok: false, error: 'EACCES' }));
    await UpdateNotifier.showLog();
    expect(window.vexConfirm.mock.calls[1][0].html).toContain('could not be read: EACCES');
  });
});
