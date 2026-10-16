// T1-038: while a full-screen game is in front, Vex does not raise, focus or flash
// its window on its own, and a toast makes no sound; a dot goes on the taskbar
// button instead. What the person just did inside Vex is never held.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const { createRaiseGuard, dotPng } = require('../../src/main/raise-guard.js');
const { createNotifier } = require('../../src/main/notify.js');

function fakeWindow(over = {}) {
  return {
    destroyed: false, minimized: false,
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    restore: vi.fn(function () { this.minimized = false; }), show: vi.fn(), showInactive: vi.fn(), focus: vi.fn(), flashFrame: vi.fn(), setOverlayIcon: vi.fn(),
    ...over,
  };
}
function guard(game) {
  const state = { game };
  const g = createRaiseGuard({ fullscreenGame: () => state.game, makeBadge: () => 'dot', now: () => 5 });
  return { g, state };
}

describe('raise', () => {
  it('raises as before when no full-screen game is in front, restoring a minimised window', () => {
    const { g } = guard(false);
    const w = fakeWindow({ minimized: true });
    expect(g.raise(w, 'a link opened from another program')).toEqual({ raised: true, held: false });
    expect(w.restore).toHaveBeenCalled(); expect(w.show).toHaveBeenCalled(); expect(w.focus).toHaveBeenCalled();
    expect(w.setOverlayIcon).not.toHaveBeenCalled();
  });
  it('does not raise over a full-screen game: it puts a dot on the taskbar button and remembers why', () => {
    const { g } = guard(true);
    const w = fakeWindow({ minimized: true });
    expect(g.raise(w, 'a reminder woke Vex')).toEqual({ raised: false, held: true });
    expect(w.restore).not.toHaveBeenCalled(); expect(w.show).not.toHaveBeenCalled(); expect(w.focus).not.toHaveBeenCalled();
    expect(w.setOverlayIcon).toHaveBeenCalledWith('dot', 'Vex has something for you');
    expect(g.held()).toEqual([{ at: 5, why: 'a reminder woke Vex' }]);
    expect(g.badged()).toBe(true);
  });
  it('what the person just did in Vex is always raised', () => {
    const { g } = guard(true);
    const w = fakeWindow();
    expect(g.raise(w, 'the profile menu', { user: true })).toEqual({ raised: true, held: false });
    expect(w.focus).toHaveBeenCalled();
  });
  it('a destroyed window is left alone', () => {
    const { g } = guard(false);
    const w = fakeWindow({ destroyed: true });
    expect(g.raise(w, 'x')).toEqual({ raised: false, held: false });
    expect(w.show).not.toHaveBeenCalled();
  });
  it('the dot clears when Vex is looked at or the game ends', () => {
    const { g } = guard(true);
    const w = fakeWindow();
    g.raise(w, 'x');
    g.release();
    expect(w.setOverlayIcon).toHaveBeenLastCalledWith(null, '');
    expect(g.held()).toEqual([]); expect(g.badged()).toBe(false);
  });
  it('keeps only the newest reasons', () => {
    const { g } = guard(true);
    const w = fakeWindow();
    for (let i = 0; i < 30; i++) g.raise(w, 'n' + i);
    expect(g.held().length).toBe(20);
    expect(g.held().at(-1).why).toBe('n29');
  });
});

describe('reveal and flash', () => {
  it('the first window at start-up opens behind a full-screen game, in front otherwise', () => {
    let { g } = guard(true);
    let w = fakeWindow();
    expect(g.reveal(w, 'Vex started')).toEqual({ raised: false, held: true });
    expect(w.showInactive).toHaveBeenCalled(); expect(w.focus).not.toHaveBeenCalled();
    ({ g } = guard(false));
    w = fakeWindow();
    expect(g.reveal(w, 'Vex started')).toEqual({ raised: true, held: false });
    expect(w.show).toHaveBeenCalled(); expect(w.focus).toHaveBeenCalled();
  });
  it('a taskbar flash becomes the dot over a game, and flashes otherwise', () => {
    let { g } = guard(true);
    let w = fakeWindow();
    expect(g.flash(w, 'an extension asked for attention')).toEqual({ flashed: false, held: true });
    expect(w.flashFrame).not.toHaveBeenCalled(); expect(w.setOverlayIcon).toHaveBeenCalled();
    ({ g } = guard(false));
    w = fakeWindow();
    expect(g.flash(w)).toEqual({ flashed: true, held: false });
    expect(w.flashFrame).toHaveBeenCalledWith(true);
  });
});

describe('the dot', () => {
  it('is a valid 16x16 PNG', () => {
    const png = dotPng();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(16); expect(png.readUInt32BE(20)).toBe(16);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });
});

describe('a toast over a full-screen game makes no sound', () => {
  function notifier(quiet) {
    const made = [];
    function N(opts) { made.push(opts); this.on = (ev, fn) => { if (ev === 'show') setTimeout(fn, 0); }; this.show = () => {}; }
    N.isSupported = () => true;
    return { made, n: createNotifier({ Notification: N, quiet, showTimeoutMs: 500 }) };
  }
  it('silent while a game is in front, unchanged otherwise', async () => {
    let { made, n } = notifier(() => true);
    await n.show({ title: 'Reminder', body: 'b', tag: 't1' });
    expect(made[0].silent).toBe(true);
    ({ made, n } = notifier(() => false));
    await n.show({ title: 'Reminder', body: 'b', tag: 't1' });
    expect(made[0].silent).toBe(false);
  });
  it('the buttoned toast carries the silent audio element, only when quiet', () => {
    const { n } = notifier(() => false);
    expect(n.toastXml({ title: 'a', body: 'b', tag: 't1', silent: true })).toContain('<audio silent="true"/>');
    expect(n.toastXml({ title: 'a', body: 'b', tag: 't1' })).not.toContain('audio');
  });
});

describe('every unsolicited raise in main goes through the guard', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
  it('focusMainWindow, a handed-over link, an extension, and the first show use it', () => {
    const body = src.slice(src.indexOf('function focusMainWindow'));
    expect(body.slice(0, 600)).toMatch(/_raiseGuard\(\)\.raise\(mainWindow, why, opts\)/);
    expect(src).toMatch(/_raiseGuard\(\)\.raise\(mainWindow, 'a link opened from another program'\)/);
    expect(src).toMatch(/_raiseGuard\(\)\.raise\(win, 'an extension asked for focus'\)/);
    expect(src).toMatch(/_raiseGuard\(\)\.flash\(win, 'an extension asked for attention'\)/);
    expect(src).toMatch(/_raiseGuard\(\)\.reveal\(mainWindow, 'Vex started'\)/);
  });
  it('no other mainWindow.focus() or flashFrame remains outside the guard and the user-driven handlers', () => {
    // The user-driven ones: PiP "back to tab" and app:focus (a click in Vex itself).
    const lines = src.split(/\r?\n/);
    const hits = lines.map((l, i) => [i + 1, l.trim()]).filter(([, l]) => /\bmainWindow\.(focus|flashFrame)\(/.test(l) || /\.flashFrame\(/.test(l));
    const allowed = hits.filter(([n]) => {
      const around = lines.slice(Math.max(0, n - 8), n).join('\n');
      return /pip:back-to-tab|app:focus/.test(around);
    });
    expect(hits.length - allowed.length).toBe(0);
  });
});
