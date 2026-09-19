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

describe('Settings › Data: the copies kept before each update', () => {
  it('lists each with a Restore button, outside safe mode too', async () => {
    document.body.innerHTML = '<div id="settings-backups"></div>';
    window.vex = {
      safeMode: async () => ({ safeMode: false, snapshots: [{ name: 'vex-persist-2.32.36.json', label: '2.32.36', at: Date.now() }, { name: 'vex-persist-first-run.json', label: 'first-run', at: Date.now() - 1e9 }] }),
      restoreSettings: vi.fn(async () => ({ ok: true })),
      restartApp: vi.fn(),
    };
    expect(await SafeModeBanner.init()).toBe(false);                   // no banner
    const rows = [...document.querySelectorAll('#settings-backups .setting-toggle-row')];
    expect(rows.map(r => r.querySelector('span').textContent.split(' — ')[0])).toEqual(['As they were in 2.32.36', 'From the first start']);
    rows[0].querySelector('button').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vex.restoreSettings).toHaveBeenCalledWith('vex-persist-2.32.36.json');
    expect(window.vex.restartApp).toHaveBeenCalled();
  });
});
