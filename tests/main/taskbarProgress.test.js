import { describe, it, expect } from 'vitest';
const { createTaskbarProgress } = require('../../src/main/taskbar-progress.js');

function setup({ canFlash = true, focused = false } = {}) {
  const calls = [];
  const win = {
    isDestroyed: () => false, isFocused: () => focused,
    setProgressBar: (...a) => calls.push(['bar', ...a]),
    flashFrame: (v) => calls.push(['flash', v]),
  };
  return { calls, t: createTaskbarProgress({ getWindow: () => win, canFlash: () => canFlash }) };
}

describe('taskbar progress', () => {
  it('fills with the total of the downloads running', () => {
    const { calls, t } = setup();
    t.progress({ id: 'a', receivedBytes: 50, totalBytes: 100, state: 'progressing' });
    t.progress({ id: 'b', receivedBytes: 150, totalBytes: 300, state: 'progressing' });
    expect(calls.at(-1)).toEqual(['bar', 0.5, { mode: 'normal' }]);
  });
  it('is indeterminate with no size and paused when all are paused', () => {
    const { calls, t } = setup();
    t.progress({ id: 'a', receivedBytes: 5, totalBytes: 0, state: 'progressing' });
    expect(calls.at(-1)).toEqual(['bar', 2, { mode: 'indeterminate' }]);
    t.progress({ id: 'a', receivedBytes: 5, totalBytes: 100, paused: true, state: 'progressing' });
    expect(calls.at(-1)).toEqual(['bar', 0.05, { mode: 'paused' }]);
  });
  it('clears and flashes once when the last one finishes', () => {
    const { calls, t } = setup();
    t.progress({ id: 'a', receivedBytes: 1, totalBytes: 2, state: 'progressing' });
    t.complete({ id: 'a', state: 'completed' });
    expect(calls.at(-2)).toEqual(['bar', -1]);
    expect(calls.at(-1)).toEqual(['flash', true]);
  });
  it('does not flash for a failed download, a focused window or a full-screen game', () => {
    let s = setup(); s.t.progress({ id: 'a', receivedBytes: 1, totalBytes: 2 }); s.t.complete({ id: 'a', state: 'interrupted' });
    expect(s.calls.some(c => c[0] === 'flash')).toBe(false);
    s = setup({ focused: true }); s.t.complete({ id: 'a', state: 'completed' });
    expect(s.calls.some(c => c[0] === 'flash')).toBe(false);
    s = setup({ canFlash: false }); s.t.complete({ id: 'a', state: 'completed' });
    expect(s.calls.some(c => c[0] === 'flash')).toBe(false);
  });
  it('waits for the last of several', () => {
    const { calls, t } = setup();
    t.progress({ id: 'a', receivedBytes: 1, totalBytes: 2 }); t.progress({ id: 'b', receivedBytes: 1, totalBytes: 2 });
    t.complete({ id: 'a', state: 'completed' });
    expect(calls.some(c => c[0] === 'flash')).toBe(false);
    t.complete({ id: 'b', state: 'completed' });
    expect(calls.at(-1)).toEqual(['flash', true]);
  });
});

describe('the flash goes through the raise guard when main passes it', () => {
  it('asks the injected flash (so a game in front gets the dot) instead of flashing the window', () => {
    const { createRaiseGuard } = require('../../src/main/raise-guard.js');
    const out = [];
    const win = { isDestroyed: () => false, isFocused: () => false, setProgressBar() {}, flashFrame: (v) => out.push(['direct', v]), show() {}, showInactive() {}, focus() {}, setOverlayIcon: (...a) => out.push(['badge', a.length]) };
    let game = true;
    const guard = createRaiseGuard({ fullscreenGame: () => game, makeBadge: () => ({}), log: () => {} });
    const t = createTaskbarProgress({ getWindow: () => win, canFlash: () => true, flash: (w, why) => guard.flash(w, why) });
    t.progress({ id: 'a', receivedBytes: 1, totalBytes: 2 });
    t.complete({ id: 'a', state: 'completed' });
    expect(out.some(c => c[0] === 'direct')).toBe(false);
    game = false;
    t.progress({ id: 'b', receivedBytes: 1, totalBytes: 2 });
    t.complete({ id: 'b', state: 'completed' });
    expect(out.at(-1)).toEqual(['direct', true]);
  });
});
