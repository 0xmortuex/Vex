// @vitest-environment jsdom
//
// T1-008: the brief is keyed off "first open after being away", not a morning
// hour (js/first-open.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let F;
const H = 3600 * 1000;
const NOW = new Date(2026, 9, 14, 18, 30).getTime();

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete globalThis.TabManager; delete globalThis.VexAttention; delete globalThis.VexLedger;
  ({ VexFirstOpen: F } = fresh(JS + 'first-open.js'));
  globalThis.window.showToast = vi.fn();
});

describe('decide()', () => {
  it('is not a first open without an earlier visit, or when away for less than the threshold', () => {
    expect(F.decide({ lastSeen: 0 }, NOW, 4).first).toBe(false);
    expect(F.decide({ lastSeen: NOW - 3 * H }, NOW, 4).first).toBe(false);
  });
  it('is a first open at or past the threshold, whatever the clock says', () => {
    const d = F.decide({ lastSeen: NOW - 4 * H }, NOW, 4);
    expect(d.first).toBe(true);
    expect(d.awayMs).toBe(4 * H);
    expect(F.decide({ lastSeen: NOW - 30 * H }, NOW, 4).first).toBe(true);
  });
});

describe('preferences', () => {
  it('default to offering after 4 hours', () => {
    expect(F.prefs()).toEqual({ mode: 'offer', awayHours: 4, digest: false });
    expect(F.enabled()).toBe(true);
  });
  it('are validated and never replaced by a default once saved', () => {
    F.setPrefs({ mode: 'open', awayHours: 6 });
    expect(F.prefs()).toEqual({ mode: 'open', awayHours: 6, digest: false });
    expect(() => F.setPrefs({ mode: 'sometimes' })).toThrow(/off, offer or open/);
    expect(() => F.setPrefs({ awayHours: 0 })).toThrow(/between 1 and 48/);
    expect(() => F.setPrefs({ awayHours: 100 })).toThrow(/between 1 and 48/);
    expect(F.prefs().awayHours).toBe(6);
  });
  it('switch off and back to the mode that was chosen', () => {
    F.setPrefs({ mode: 'open' });
    F.setEnabled(false);
    expect(F.prefs().mode).toBe('off');
    F.setEnabled(true);
    expect(F.prefs().mode).toBe('open');
  });
  it('clamp a hand-edited value into range when read', () => {
    localStorage.setItem(F.PREF, JSON.stringify({ mode: 'offer', awayHours: 999 }));
    expect(F.prefs().awayHours).toBe(48);
  });
});

describe('noteReturn()', () => {
  it('does nothing on the very first run, then remembers when you were last here', () => {
    expect(F.noteReturn(NOW)).toBe(false);
    expect(F._read().lastSeen).toBe(NOW);
  });

  it('offers the brief once after a long absence and counts the hour you came back', () => {
    const notify = vi.fn((opts, show) => { show(); return { route: 'toast' }; });
    globalThis.VexAttention = { notify };
    const heard = vi.fn();
    document.addEventListener('vex:first-open', heard);
    F.noteLeaving(NOW - 6 * H);
    expect(F.noteReturn(NOW)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'first-open', urgency: 'useful' });
    expect(window.showToast).toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0].detail.awayMs).toBe(6 * H);
    expect(F._read().hist[18]).toBe(1);
    // Coming back again a minute later is not another first open.
    expect(F.noteReturn(NOW + 60000)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('opens a New Tab by itself only in open mode, and writes it in the ledger with an undo', () => {
    F.setPrefs({ mode: 'open' });
    const createTab = vi.fn(() => 'tab_9');
    globalThis.TabManager = { createTab, tabs: [] };
    const note = vi.fn();
    globalThis.VexLedger = { note, registerUndo: vi.fn(), registerStop: vi.fn() };
    F.noteLeaving(NOW - 9 * H);
    F.noteReturn(NOW);
    expect(createTab).toHaveBeenCalledTimes(1);
    expect(note).toHaveBeenCalledTimes(1);
    expect(note.mock.calls[0][0]).toMatchObject({ feature: 'first-open', undo: { kind: 'first-open-close', tabId: 'tab_9' }, stop: { kind: 'first-open-off' } });
  });

  it('does nothing visible when off, but still learns the hour', () => {
    F.setPrefs({ mode: 'off' });
    globalThis.VexAttention = { notify: vi.fn() };
    globalThis.TabManager = { createTab: vi.fn() };
    F.noteLeaving(NOW - 9 * H);
    expect(F.noteReturn(NOW)).toBe(false);
    expect(globalThis.VexAttention.notify).not.toHaveBeenCalled();
    expect(globalThis.TabManager.createTab).not.toHaveBeenCalled();
    expect(F._read().hist[18]).toBe(1);
  });

  it('raises an error rather than staying quiet when the gate is missing', () => {
    F.noteLeaving(NOW - 9 * H);
    expect(() => F.noteReturn(NOW)).toThrow(/attention gate is not loaded/);
  });
});

describe('usualHour()', () => {
  it('says nothing until there are five comings-back, then the commonest hour', () => {
    const s = F._read();
    s.hist[18] = 3; s.hist[9] = 1;
    expect(F.usualHour()).toBe(null);
    s.hist[18] = 4;
    expect(F.usualHour()).toBe(18);
  });
});

describe('storage', () => {
  it('writes leaving to storage at most every five minutes unless forced', () => {
    F.noteLeaving(NOW);
    expect(JSON.parse(localStorage.getItem(F.KEY)).lastSeen).toBe(NOW);
    F.noteLeaving(NOW + 60000);
    expect(JSON.parse(localStorage.getItem(F.KEY)).lastSeen).toBe(NOW);
    F._save(true, NOW + 61000);
    expect(JSON.parse(localStorage.getItem(F.KEY)).lastSeen).toBe(NOW + 60000);
  });
  it('starts again from an unreadable record', () => {
    localStorage.setItem(F.KEY, '{nope');
    expect(F._read().lastSeen).toBe(0);
    expect(F._read().hist).toHaveLength(24);
  });
});
