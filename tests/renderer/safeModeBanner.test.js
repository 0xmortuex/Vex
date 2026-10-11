// @vitest-environment jsdom
//
// Safe mode after an update that would not start: the banner offers the
// version before it, and going back pauses updates for a day so the old
// version does not offer the broken one straight back.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let created;
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  created = [];
  globalThis.TabManager = { createTab: (url) => created.push(url) };
  globalThis.UpdateNotifier = { SNOOZE_KEY: 'vex.updateSnoozeUntil', SNOOZE_MS: 24 * 3600 * 1000 };
  globalThis.vexConfirm = vi.fn(async () => true);
  window.vex = {};
});
const { SafeModeBanner } = require('../../src/renderer/js/safe-mode-banner.js');

describe('going back to the version before', () => {
  it('is offered only when the crashes began with an update', () => {
    SafeModeBanner.show({ safeMode: true, fails: 2, brokenSinceUpdateFrom: null });
    expect(document.querySelector('[data-act="rollback"]')).toBeNull();
    SafeModeBanner.show({ safeMode: true, fails: 2, brokenSinceUpdateFrom: '2.32.36' });
    expect(document.querySelector('[data-act="rollback"]').textContent).toBe('Go back to 2.32.36');
    expect(document.querySelector('.safe-mode-banner').textContent).toContain('This began with the update from 2.32.36.');
  });

  it('downloads that release\'s installer and pauses updates for a day', async () => {
    await SafeModeBanner.rollBack('2.32.36');
    expect(created).toEqual(['https://github.com/0xmortuex/Vex/releases/download/v2.32.36/Vex-Setup.exe']);
    const until = Number(localStorage.getItem('vex.updateSnoozeUntil'));
    expect(until - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
  });

  it('does nothing when refused, and refuses anything that is not a version', async () => {
    vexConfirm.mockResolvedValueOnce(false);
    await SafeModeBanner.rollBack('2.32.36');
    expect(created).toEqual([]);
    expect(localStorage.getItem('vex.updateSnoozeUntil')).toBeNull();
    await expect(SafeModeBanner.rollBack('../../evil')).rejects.toThrow('Not a Vex version');
  });
});

// Earlier settings are the backups Vex keeps around updates: one list, in
// Settings › Backup (js/backup.js). The banner opens it.
describe('one way back to earlier settings', () => {
  it('Restore earlier settings opens the backup screen, which lists the backups made around updates', async () => {
    globalThis.VexBackup = { open: vi.fn() };
    SafeModeBanner.show({ safeMode: true, fails: 2, brokenSinceUpdateFrom: null });
    document.querySelector('[data-act="restore"]').click();
    expect(VexBackup.open).toHaveBeenCalledTimes(1);
    delete globalThis.VexBackup;
  });

  it('a backup at this first start that failed is said, outside safe mode too', async () => {
    window.showToast = vi.fn();
    window.vex = { safeMode: async () => ({ safeMode: false, updateBackupFailed: { ok: false, version: '2.35.2', error: 'Vex could not save the backup in its backups folder (ENOSPC)' } }) };
    expect(await SafeModeBanner.init()).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Vex could not back up your settings when 2.35.2 first started: Vex could not save the backup in its backups folder (ENOSPC). Settings › Back up or restore… can save one now.', 'error', 12000);
    window.showToast.mockClear();
    window.vex = { safeMode: async () => ({ safeMode: false, updateBackupFailed: null }) };
    await SafeModeBanner.init();
    expect(window.showToast).not.toHaveBeenCalled();
  });
});
