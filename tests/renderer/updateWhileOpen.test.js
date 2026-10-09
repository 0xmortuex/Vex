// @vitest-environment jsdom
//
// The update check while Vex stays open (js/update-notifier.js). Vex is often
// left open for days, and the only automatic check used to run at start, so a
// copy sat on 2.36.4 through three releases (found 2026-10-09). It now asks
// again every six hours on the shared job timer (js/jobs.js), under the same
// switch and the same rules as the check at start, and never over a cover
// that is already up.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { VexJobs } = require('../../src/renderer/js/jobs.js');
const { UpdateNotifier } = require('../../src/renderer/js/update-notifier.js');

const SIX_HOURS = 6 * 3600 * 1000;
const info = { ok: true, hasUpdate: true, latest: '2.38.2', current: '2.36.4' };
const cover = () => document.getElementById('update-cover');
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  UpdateNotifier.close();
  VexJobs.stop(UpdateNotifier.JOB_NAME);
  document.body.innerHTML = '';
  localStorage.clear();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
  delete window.VexTabPolicy;
  window.vex = {
    checkForUpdates: vi.fn(async () => info),
    updates: { upcomingNotes: vi.fn(async () => ({ ok: true, entries: [] })), onProgress() {}, onInstallFailed() {} },
  };
});
afterEach(() => {
  UpdateNotifier.close();
  VexJobs.stop(UpdateNotifier.JOB_NAME);
  vi.useRealTimers();
});

// Past the check at start (4 s), with its cover dismissed.
async function pastStart() {
  UpdateNotifier.init();
  await vi.advanceTimersByTimeAsync(5000);
  UpdateNotifier.close();
  window.vex.checkForUpdates.mockClear();
}

describe('the check while Vex stays open', () => {
  it('asks again six hours on and brings the cover up for a new release', async () => {
    await pastStart();
    await vi.advanceTimersByTimeAsync(SIX_HOURS - 10000);
    expect(window.vex.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(window.vex.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(cover()).not.toBe(null);
    expect(cover().querySelector('#update-cover-title').textContent).toBe('Vex 2.38.2 is available');
    // And again six hours after that (Later remembers nothing).
    UpdateNotifier.close();
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(window.vex.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(cover()).not.toBe(null);
  });

  it('runs on the shared job timer, not a timer of its own', () => {
    UpdateNotifier.init();
    const job = VexJobs._jobs.get(UpdateNotifier.JOB_NAME);
    expect(job).toBeTruthy();
    expect(job.ms).toBe(SIX_HOURS);
    expect(job.when).toBe('ui');
  });

  it('with the switch off, nothing is asked; turned back on, the next run asks', async () => {
    UpdateNotifier.setChecksOnStart(false);
    UpdateNotifier.init();
    await vi.advanceTimersByTimeAsync(SIX_HOURS * 2);
    expect(window.vex.checkForUpdates).not.toHaveBeenCalled();
    UpdateNotifier.setChecksOnStart(true);
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(window.vex.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('a private window never checks', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    UpdateNotifier.init();
    await vi.advanceTimersByTimeAsync(SIX_HOURS * 2);
    expect(window.vex.checkForUpdates).not.toHaveBeenCalled();
    expect(await UpdateNotifier.checkWhileOpen()).toBe(undefined);
    expect(window.vex.checkForUpdates).not.toHaveBeenCalled();
  });

  it('keeps the same rules as the check at start: a skipped version stays quiet', async () => {
    localStorage.setItem(UpdateNotifier.SKIP_KEY, '2.38.2');
    await pastStart();
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(window.vex.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(cover()).toBe(null);
  });

  it('Stable waits two days before a fresh release comes up by itself', async () => {
    UpdateNotifier.setChannel('stable');
    window.vex.checkForUpdates = vi.fn(async () => ({ ...info, releasedAt: Date.now() }));
    UpdateNotifier.init();
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(window.vex.checkForUpdates).toHaveBeenCalled();
    expect(cover()).toBe(null);
  });

  it('leaves a cover that is already up alone: no second check, no second cover', async () => {
    await pastStart();
    UpdateNotifier.showCover({ ...info, latest: '2.38.1' });
    UpdateNotifier._setPhase('downloading', 'Downloading Vex 2.38.1…');
    const before = cover();
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(window.vex.checkForUpdates).not.toHaveBeenCalled();
    expect(cover()).toBe(before);
    expect(cover().dataset.phase).toBe('downloading');
    expect(document.querySelectorAll('#update-cover').length).toBe(1);
  });

  it('a cover opened while the check was out wins', async () => {
    let answer;
    window.vex.checkForUpdates = vi.fn(() => new Promise(r => { answer = r; }));
    const run = UpdateNotifier.checkWhileOpen();
    UpdateNotifier.showCover({ ...info, latest: '2.38.1' });
    UpdateNotifier._setPhase('downloading', '');
    answer(info);
    await run;
    expect(cover().dataset.phase).toBe('downloading');
    expect(cover().querySelector('#update-cover-title').textContent).toBe('Vex 2.38.1 is available');
  });

  it('is held while Vex is hidden, then runs once when it is back on screen', async () => {
    await pastStart();
    hidden = true;
    await vi.advanceTimersByTimeAsync(SIX_HOURS * 3);
    expect(window.vex.checkForUpdates).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(window.vex.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(cover()).not.toBe(null);
  });

  it('a check that throws is noted, not shown', async () => {
    await pastStart();
    window.vex.checkForUpdates = vi.fn(async () => { throw new Error('offline'); });
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(cover()).toBe(null);
    expect(VexProblems.note).toHaveBeenCalledWith('Updates', 'Could not check for updates', expect.any(Error));
  });
});
