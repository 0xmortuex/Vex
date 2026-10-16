// @vitest-environment jsdom
//
// T2-055: adaptive focus block length from uninterrupted spans (js/focus-calibration.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const MIN = 60000;

let F;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  ({ VexFocusCal: F } = fresh(JS + 'focus-calibration.js'));
  globalThis.WorkspaceManager = { activeId: 'ws_school', workspaces: [{ id: 'ws_school', name: 'School' }] };
  globalThis.TabManager = { getActiveTab: () => ({ id: 't', url: 'https://en.wikipedia.org/wiki/X' }) };
  delete globalThis.GameMode; delete globalThis.GameSession; delete globalThis.FocusOS; delete window.VexTabPolicy;
});

// Activity every minute for `len` minutes starting at `t0`.
const work = (t0, len) => { for (let i = 0; i <= len; i++) F.noteActivity(t0 + i * MIN); return t0 + len * MIN; };

describe('spans', () => {
  it('records the length of a run of activity once a 5 minute gap closes it', () => {
    const end = work(1000000, 25);
    expect(F.data().spans.ws_school).toBeUndefined();         // still open
    F.noteActivity(end + 6 * MIN);                            // the gap
    const s = F.data().spans.ws_school;
    expect(s).toHaveLength(1);
    expect(s[0].min).toBe(25);
    expect(s[0].kind).toBe('reading');
  });
  it('drops runs under three minutes and notes at most every five seconds', () => {
    F.noteActivity(1000000); F.noteActivity(1000000 + 1000);   // second one ignored: too soon
    F.noteActivity(1000000 + 2 * MIN);
    F.noteActivity(1000000 + 10 * MIN);
    expect(F.data().spans.ws_school).toBeUndefined();
  });
  it('splits a span when the workspace changes', () => {
    const end = work(1000000, 10);
    WorkspaceManager.activeId = 'ws_work';
    F.noteActivity(end + 30000);
    expect(F.data().spans.ws_school).toHaveLength(1);
  });
  it('records nothing in a game, when hidden or in a private tab', () => {
    globalThis.GameMode = { gaming: true };
    expect(F.noteActivity(1000000)).toBe(false);
    delete globalThis.GameMode;
    window.VexTabPolicy = { canPersist: () => false };
    expect(F.noteActivity(2000000)).toBe(false);
    delete window.VexTabPolicy;
    F.setEnabled(false);
    expect(F.noteActivity(3000000)).toBe(false);
  });
  it('keeps 60 per workspace', () => {
    for (let i = 0; i < 65; i++) F._add('ws_school', 10 + i, 'other', i);
    expect(F.data().spans.ws_school).toHaveLength(60);
  });
});

describe('suggest()', () => {
  const spans = (mins) => mins.map(min => ({ min }));
  it('needs eight spans before it says anything', () => {
    expect(F.suggest(spans([30, 30, 30, 30, 30, 30, 30]))).toBe(0);
  });
  it('is the median, rounded to five minutes and held to Focus OS limits', () => {
    expect(F.suggest(spans([22, 24, 26, 28, 31, 33, 40, 90]))).toBe(30);      // median 29.5 -> 30
    expect(F.suggest(spans([4, 4, 4, 4, 4, 4, 4, 4]))).toBe(10);
    expect(F.suggest(spans([400, 400, 400, 400, 400, 400, 400, 400]))).toBe(180);
  });
  it('kind of page', () => {
    expect(F.kindOf('https://github.com/a/b')).toBe('making');
    expect(F.kindOf('https://example.com/paper.pdf')).toBe('reading');
    expect(F.kindOf('https://shop.test/')).toBe('other');
    expect(F.kindOf('nonsense')).toBe('other');
  });
});

describe('report() and apply()', () => {
  it('gives the median and suggestion per workspace, by name', () => {
    for (const m of [20, 25, 30, 35, 40, 45, 50, 55]) F._add('ws_school', m, 'reading', 1);
    const [r] = F.report();
    expect(r).toMatchObject({ ws: 'ws_school', name: 'School', count: 8, median: 38, suggestion: 40 });
    expect(r.byKind.reading).toBe(38);
  });
  it('sets the Focus OS block length only when asked, and validates it', () => {
    const setSettings = vi.fn();
    globalThis.FocusOS = { setSettings };
    expect(F.apply(40)).toBe(40);
    expect(setSettings).toHaveBeenCalledWith({ blockMin: 40 });
    expect(() => F.apply(5)).toThrow(/10 to 180/);
    expect(() => F.apply(40.5)).toThrow(/10 to 180/);
  });
  it('adds the length of blocks you really finished', () => {
    globalThis.FocusOS = { state: () => ({ blocks: [{ state: 'done', startedAt: 0, endedAt: 45 * MIN }, { state: 'skipped', startedAt: 0, endedAt: 9 * MIN }] }) };
    expect(F.finishedBlocks()).toEqual([45]);
  });
  it('raises on an unreadable record', () => {
    localStorage.setItem('vex.focusCal', '{nope');
    expect(() => F.data()).toThrow(/could not be read/);
  });
});
