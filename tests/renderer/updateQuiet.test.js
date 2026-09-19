// @vitest-environment jsdom
//
// "Later" meant "ask me again next launch", and Vex ships several times a day —
// so the popup was relentless, and a relentless popup is one that gets clicked
// away without being read. (The Discord memory notice had exactly this problem
// and was fixed the same way in v2.31.82.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');       // window.escapeHtml, which the popup uses
const { UpdateNotifier } = require('../../src/renderer/js/update-notifier.js');

const update = (latest = '2.31.99') => ({ ok: true, hasUpdate: true, latest, current: '2.31.98', downloadUrl: 'https://example.com/Vex-Setup.exe' });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
});

describe('when an update is announced', () => {
  it('a real update is announced', () => {
    expect(UpdateNotifier.shouldAnnounce(update())).toBe(true);
  });

  it('nothing is announced when there is nothing to announce', () => {
    expect(UpdateNotifier.shouldAnnounce({ ok: true, hasUpdate: false })).toBe(false);
    expect(UpdateNotifier.shouldAnnounce({ ok: false })).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(null)).toBe(false);
  });

  it('"Later" buys a day, not until the next launch', () => {
    const now = Date.now();
    localStorage.setItem(UpdateNotifier.SNOOZE_KEY, String(now + UpdateNotifier.SNOOZE_MS));
    expect(UpdateNotifier.shouldAnnounce(update(), now + 3600 * 1000)).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(update(), now + 25 * 3600 * 1000)).toBe(true);
  });

  it('a skipped version is never mentioned again — but the next one is', () => {
    localStorage.setItem(UpdateNotifier.SKIP_KEY, '2.31.99');
    expect(UpdateNotifier.shouldAnnounce(update('2.31.99'))).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(update('2.32.0'))).toBe(true);
  });
});

describe('the popup', () => {
  it('offers Download, Later and Skip this one, and each does what it says', () => {
    UpdateNotifier._showDownloadPrompt(update());
    expect(document.getElementById('update-get-btn')).not.toBe(null);

    document.getElementById('update-skip-btn').click();
    expect(Number(localStorage.getItem(UpdateNotifier.SNOOZE_KEY))).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Not again until tomorrow'));

    UpdateNotifier._showDownloadPrompt(update());
    document.getElementById('update-never-btn').click();
    expect(localStorage.getItem(UpdateNotifier.SKIP_KEY)).toBe('2.31.99');
    expect(window.showToast).toHaveBeenLastCalledWith('Vex 2.31.99 will not be mentioned again');
  });

  it('a store that cannot be written is recorded rather than silently forgotten', () => {
    // Assigning setItem on the INSTANCE stores a key called 'setItem'; the
    // method lives on the prototype (the same trap js/storage.js documents).
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('full'); };
    try {
      UpdateNotifier._showDownloadPrompt(update());
      document.getElementById('update-skip-btn').click();
      expect(VexProblems.note).toHaveBeenCalledWith('Updates', 'Could not remember the update choice', expect.any(Error));
    } finally { Storage.prototype.setItem = real; }
  });

  it('the startup check respects both, so a quiet Vex stays quiet', async () => {
    window.vex = { checkForUpdates: vi.fn(async () => update()) };
    localStorage.setItem(UpdateNotifier.SKIP_KEY, '2.31.99');
    await UpdateNotifier.checkOnStartup();
    expect(document.getElementById('update-notification')).toBe(null);

    localStorage.clear();
    await UpdateNotifier.checkOnStartup();
    expect(document.getElementById('update-notification')).not.toBe(null);
  });
});

describe('update channels', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const fresh = { ...update(), releasedAt: now - 3 * 3600 * 1000 };
  const settled = { ...update(), releasedAt: now - 3 * 24 * 3600 * 1000 };
  it('Latest (the default) announces a release as soon as it is out', () => {
    expect(UpdateNotifier.channel()).toBe('latest');
    expect(UpdateNotifier.shouldAnnounce(fresh, now)).toBe(true);
  });
  it('Stable waits until the newest release has stood for two days', () => {
    UpdateNotifier.setChannel('stable');
    expect(UpdateNotifier.shouldAnnounce(fresh, now)).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(settled, now)).toBe(true);
  });
});
