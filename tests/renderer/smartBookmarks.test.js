// @vitest-environment jsdom
//
// Living bookmarks: still the same / changed / dead, kept snapshots, and the
// limits on when it may look.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { SmartBookmarks: S } = require('../../src/renderer/js/smart-bookmarks.js');
const { PageWatchDiff: D } = require('../../src/renderer/js/page-watch-diff.js');

const NOW = Date.UTC(2026, 9, 16, 12);
const lines = (...l) => l;

beforeEach(() => {
  localStorage.clear();
  delete globalThis.GameMode; delete globalThis.GameSession;
  globalThis.Bookmarks = { items: [{ id: 'b1', url: 'https://a.test/page', title: 'A' }, { id: 'b2', url: 'https://a.test/other', title: 'A2' }, { id: 'b3', url: 'https://c.test/', title: 'C' }] };
  globalThis.AgentTools = { readUrl: vi.fn(), isPrivateHost: (h) => /^(localhost|127\.)/.test(h) };
  window.showToast = vi.fn();
});

describe('what an error means', () => {
  it('404 and 410 are gone; a refusal is blocked, not dead; the rest is unreachable', () => {
    expect(S.classifyError(new Error('HTTP 404 from a.test'))).toBe('gone');
    expect(S.classifyError(new Error('HTTP 410 from a.test'))).toBe('gone');
    expect(S.classifyError(new Error('HTTP 403 from a.test'))).toBe('blocked');
    expect(S.classifyError(new Error('HTTP 429 from a.test'))).toBe('blocked');
    expect(S.classifyError(new Error('The request failed'))).toBe('unreachable');
    expect(S.classifyError(new Error('HTTP 503 from a.test'))).toBe('unreachable');
  });
});

describe('the decision', () => {
  it('the first look sets the baseline as "still the same"', () => {
    const { state, snapshot } = S.decide(null, { lines: lines('one', 'two') }, { now: NOW });
    expect(state.status).toBe('same');
    expect(snapshot.text).toBe('one\ntwo');
  });

  it('the same lines stay the same and store nothing', () => {
    const first = S.decide(null, { lines: lines('one', 'two') }, { now: NOW });
    const again = S.decide(first.state, { lines: lines('one', 'two') }, { now: NOW + 1 });
    expect(again.state.status).toBe('same');
    expect(again.snapshot).toBeNull();
  });

  it('a changed line is "changed", says what, and keeps the new text', () => {
    const first = S.decide(null, { lines: lines('price 10', 'stock yes') }, { now: NOW });
    const next = S.decide(first.state, { lines: lines('price 12', 'stock yes'), before: lines('price 10', 'stock yes') }, { now: NOW + 5 });
    expect(next.state.status).toBe('changed');
    expect(next.state.changeSummary).toContain('price 12');
    expect(next.snapshot.text).toContain('price 12');
  });

  it('clock times do not make a page "changed" (the page watcher rules)', () => {
    const a = D.normalizeText('Updated 10:15\nHello world');
    const b = D.normalizeText('Updated 11:42\nHello world');
    const first = S.decide(null, { lines: a }, { now: NOW });
    const next = S.decide(first.state, { lines: b, before: a }, { now: NOW + 1 });
    expect(next.state.status).toBe('same');
  });

  it('404 is dead at once; a flaky network is dead only after three misses; a refusal never is', () => {
    const base = S.decide(null, { lines: lines('x') }, { now: NOW }).state;
    expect(S.decide(base, { error: new Error('HTTP 404 from a.test') }, { now: NOW + 1 }).state.status).toBe('dead');
    let s = base;
    for (let i = 0; i < 2; i++) { s = S.decide(s, { error: new Error('The request failed') }, { now: NOW + i }).state; expect(s.status).toBe('same'); }
    s = S.decide(s, { error: new Error('The request failed') }, { now: NOW + 9 }).state;
    expect(s.status).toBe('dead');
    expect(S.decide(base, { error: new Error('HTTP 403 from a.test') }, { now: NOW }).state.status).toBe('same');
  });

  it('a dead page that answers again is lifted', () => {
    const base = S.decide(null, { lines: lines('x') }, { now: NOW }).state;
    const dead = S.decide(base, { error: new Error('HTTP 404 from a.test') }, { now: NOW + 1 }).state;
    const back = S.decide(dead, { lines: lines('x') }, { now: NOW + 2 }).state;
    expect(back.status).toBe('same');
    expect(back.deadSince).toBeUndefined();
  });
});

describe('when it may look', () => {
  const states = { b1: { on: true, lastCheckedAt: 0 }, b2: { on: true, lastCheckedAt: 0 }, b3: { on: true, lastCheckedAt: NOW - 2 * 3600000 } };
  const marks = () => globalThis.Bookmarks.items;

  it('only what is due, one page per site per round', () => {
    const due = S.due(states, marks(), { now: NOW, hours: 6 });
    expect(due.map(b => b.id)).toEqual(['b1']);              // b2 is the same site; b3 looked 2 h ago (< 6 h)
  });

  it('never more than three a round, oldest look first', () => {
    const many = [];
    const st = {};
    for (let i = 0; i < 6; i++) { many.push({ id: 'm' + i, url: 'https://s' + i + '.test/' }); st['m' + i] = { on: true, lastCheckedAt: i * 1000 }; }
    const due = S.due(st, many, { now: NOW, hours: 24 });
    expect(due.map(b => b.id)).toEqual(['m0', 'm1', 'm2']);
  });

  it('nothing while a game runs', () => {
    expect(S.due(states, marks(), { now: NOW, hours: 6, gaming: true })).toEqual([]);
  });

  it('is off until switched on, and the interval is one of three', () => {
    expect(S.prefs()).toEqual({ enabled: false, hours: 24 });
    expect(() => S.setPrefs({ hours: 1 })).toThrow(/6 hours, a day or a week/);
    S.setPrefs({ enabled: true, hours: 6 });
    expect(S.prefs()).toEqual({ enabled: true, hours: 6 });
  });

  it('does not look at bookmarks from private or routed sessions, or on this network', () => {
    expect(S.eligible({ url: 'https://a.test/', ownSession: true }).ok).toBe(false);
    expect(S.eligible({ url: 'https://abc.onion/' }).ok).toBe(false);
    expect(S.eligible({ url: 'http://localhost:3000/' }).ok).toBe(false);
    expect(S.eligible({ url: 'ftp://a.test/' }).ok).toBe(false);
    expect(S.eligible({ url: 'https://a.test/' }).ok).toBe(true);
  });
});

describe('on the real store', () => {
  it('keeps a page alive, reports a change, and keeps the snapshot when it dies', async () => {
    AgentTools.readUrl.mockResolvedValueOnce({ text: 'Release 1.0\nFast and small' });
    const s1 = await S.keepAlive('b1');
    expect(s1.status).toBe('same');
    expect(S.snapshotsOf('b1')).toHaveLength(1);

    AgentTools.readUrl.mockResolvedValueOnce({ text: 'Release 2.0\nFast and small' });
    const s2 = await S.checkOne('b1', { force: true });
    expect(s2.status).toBe('changed');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Changed: A'), 'info', 8000);

    AgentTools.readUrl.mockRejectedValueOnce(new Error('HTTP 404 from a.test'));
    const s3 = await S.checkOne('b1', { force: true });
    expect(s3.status).toBe('dead');
    expect(S.snapshotsOf('b1').pop().text).toContain('Release 2.0');   // still viewable
    expect(S.statusWords(s3)).toBe('Dead');
  });

  it('refuses a check during a game unless the person asked for it right now', async () => {
    AgentTools.readUrl.mockResolvedValue({ text: 'hello there friend' });
    await S.keepAlive('b1');
    globalThis.GameMode = { gaming: true };
    await expect(S.checkOne('b1')).rejects.toThrow(/game is running/);
    await expect(S.checkOne('b1', { force: true })).resolves.toBeTruthy();
    S.setPrefs({ enabled: true });
    AgentTools.readUrl.mockClear();
    expect(await S.sweep(NOW + 100 * 3600000)).toEqual([]);
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
  });

  it('a sweep with the switch off does nothing', async () => {
    AgentTools.readUrl.mockResolvedValue({ text: 'hello there friend' });
    await S.keepAlive('b1');
    AgentTools.readUrl.mockClear();
    expect(await S.sweep(NOW + 100 * 3600000)).toEqual([]);
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
  });

  it('"seen it" clears changed and stopping can forget the text', async () => {
    AgentTools.readUrl.mockResolvedValueOnce({ text: 'one two three' });
    await S.keepAlive('b1');
    AgentTools.readUrl.mockResolvedValueOnce({ text: 'one two four' });
    await S.checkOne('b1', { force: true });
    S.markSeen('b1');
    expect(S.stateOf('b1').status).toBe('same');
    S.stopKeeping('b1', { forget: true });
    expect(S.stateOf('b1')).toBeNull();
    expect(S.snapshotsOf('b1')).toEqual([]);
  });

  it('a bookmark that is not in the list cannot be kept alive', async () => {
    await expect(S.keepAlive('nope')).rejects.toThrow(/not in your list/);
  });
});
