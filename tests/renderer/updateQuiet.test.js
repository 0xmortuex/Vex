// @vitest-environment jsdom
//
// When the update cover comes up by itself. Later means "ask me at the next
// start" (nothing is remembered); Skip means "not until something newer than
// this one"; Stable waits until a release has stood two days; and the
// safe-mode roll-back's one-day pause is still honoured.

import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { UpdateNotifier } = require('../../src/renderer/js/update-notifier.js');

const update = (latest = '2.31.99') => ({ ok: true, hasUpdate: true, latest, current: '2.31.98' });

beforeEach(() => {
  UpdateNotifier.close();
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
  window.vex = { checkForUpdates: vi.fn(async () => update()), updates: { upcomingNotes: vi.fn(async () => ({ ok: true, entries: [] })) } };
});

describe('when the cover comes up by itself', () => {
  it('a real update is announced; nothing else is', () => {
    expect(UpdateNotifier.shouldAnnounce(update())).toBe(true);
    expect(UpdateNotifier.shouldAnnounce({ ok: true, hasUpdate: false })).toBe(false);
    expect(UpdateNotifier.shouldAnnounce({ ok: false })).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(null)).toBe(false);
  });

  it('a skipped version stays quiet, and so does anything older; a newer one does not', () => {
    localStorage.setItem(UpdateNotifier.SKIP_KEY, '2.31.99');
    expect(UpdateNotifier.shouldAnnounce(update('2.31.99'))).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(update('2.31.50'))).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(update('2.31.100'))).toBe(true);
    expect(UpdateNotifier.shouldAnnounce(update('2.32.0'))).toBe(true);
  });

  it('the roll-back pause (safe mode) still holds it back for a day', () => {
    const now = Date.now();
    localStorage.setItem(UpdateNotifier.SNOOZE_KEY, String(now + UpdateNotifier.SNOOZE_MS));
    expect(UpdateNotifier.shouldAnnounce(update(), now + 3600 * 1000)).toBe(false);
    expect(UpdateNotifier.shouldAnnounce(update(), now + 25 * 3600 * 1000)).toBe(true);
  });

  it('the startup check respects Skip, and shows the cover otherwise', async () => {
    localStorage.setItem(UpdateNotifier.SKIP_KEY, '2.31.99');
    await UpdateNotifier.checkOnStartup();
    expect(document.getElementById('update-cover')).toBe(null);
    localStorage.clear();
    await UpdateNotifier.checkOnStartup();
    expect(document.getElementById('update-cover')).not.toBe(null);
  });

  it('a startup check that throws is noted, not shown and not swallowed', async () => {
    window.vex.checkForUpdates = vi.fn(async () => { throw new Error('boom'); });
    await UpdateNotifier.checkOnStartup();
    expect(document.getElementById('update-cover')).toBe(null);
    expect(VexProblems.note).toHaveBeenCalledWith('Updates', 'Could not check for updates', expect.any(Error));
  });
});

describe('Later and Skip', () => {
  it('Later closes and remembers nothing, so the next start asks again', async () => {
    UpdateNotifier.showCover(update());
    document.querySelector('#update-cover [data-act="later"]').click();
    await Promise.resolve();
    expect(document.getElementById('update-cover')).toBe(null);
    expect(localStorage.length).toBe(0);
    expect(UpdateNotifier.shouldAnnounce(update())).toBe(true);
  });

  it('Skip this version remembers the version', async () => {
    UpdateNotifier.showCover(update());
    document.querySelector('#update-cover [data-act="skip"]').click();
    await Promise.resolve();
    expect(document.getElementById('update-cover')).toBe(null);
    expect(localStorage.getItem(UpdateNotifier.SKIP_KEY)).toBe('2.31.99');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Vex 2.31.99 will not be offered again'), 'info', 6000);
  });

  it('a store that cannot be written is recorded rather than silently forgotten', async () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('full'); };
    try {
      UpdateNotifier.showCover(update());
      document.querySelector('#update-cover [data-act="skip"]').click();
      await Promise.resolve();
      expect(VexProblems.note).toHaveBeenCalledWith('Updates', 'Could not remember the update choice', expect.any(Error));
    } finally { Storage.prototype.setItem = real; }
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
