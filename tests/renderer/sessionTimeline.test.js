// @vitest-environment jsdom
//
// Session timeline: what is shown, what is never shown, how it is grouped and
// what a click on a moment reopens.
import { describe, it, expect, beforeEach } from 'vitest';
const { VexTimeline: T } = require('../../src/renderer/js/session-timeline.js');

const NOW = new Date(2026, 9, 16, 15, 0, 0).getTime();   // Fri 16 Oct 2026 15:00 local
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m, 0).getTime();

beforeEach(() => {
  localStorage.clear();
  delete globalThis.GameMode; delete globalThis.GameSession; delete globalThis.TabManager;
  window.VexTabPolicy = { isPrivateWindow: false, snapshot: (tabs) => tabs.filter(t => !t.partition || t.partition.startsWith('persist:')) };
});

describe('what the timeline shows', () => {
  const data = {
    history: [
      { url: 'https://a.test/x', title: 'A page', visitedAt: new Date(at(16, 9)).toISOString() },
      { url: 'https://secret.onion/', title: 'Hidden', visitedAt: new Date(at(16, 10)).toISOString() },
      { url: 'https://p.test/', title: 'Private', visitedAt: new Date(at(16, 11)).toISOString(), partition: 'incognito-1' },
      { url: 'https://c.test/', title: 'Container', time: at(16, 12), partition: 'persist:work' },
    ],
    notes: [{ id: 'n1', title: 'Trip ideas', updatedAt: new Date(at(15, 20)).toISOString() }],
    readLater: [{ id: 'r1', url: 'https://r.test/', title: 'Long read', at: at(14, 8), finishedAt: at(16, 13) }, { id: 'r2', url: 'https://tor.test/', at: at(16, 8), ownSession: true }],
    bookmarks: [{ id: 'b1', url: 'https://b.test/', title: 'Docs', at: at(16, 7) }],
    sessions: [{ id: 's1', name: 'Work', createdAt: new Date(at(16, 6)).toISOString(), tabs: [{}, {}] }, { id: 's2', name: 'auto', auto: true, createdAt: new Date(at(16, 5)).toISOString() }],
    clips: [{ name: 'ace.mp4', path: 'C:\\clips\\ace.mp4', at: at(15, 23) }],
    log: [{ kind: 'game', t: at(15, 22), title: 'Game ended after 90 min' }, { kind: 'tabs', t: at(16, 9, 5), tabs: [{ url: 'https://a.test/x', title: 'A page' }] }, { kind: 'bogus', t: at(16, 1), title: 'x' }],
  };

  it('collects every source, newest first', () => {
    const ev = T.collect(data);
    const titles = ev.map(e => e.title);
    expect(titles[0]).toBe('Finished: Long read');
    expect(ev.map(e => e.t)).toEqual([...ev.map(e => e.t)].sort((a, b) => b - a));
    expect(titles).toContain('Trip ideas');
    expect(titles).toContain('Recording: ace.mp4');
    expect(titles).toContain('Game ended after 90 min');
    expect(titles).toContain('Session saved: Work');
  });

  it('never shows private, Tor, routed or onion entries, nor automatic sessions', () => {
    const titles = T.collect(data).map(e => e.title);
    expect(titles).not.toContain('Hidden');
    expect(titles).not.toContain('Private');
    expect(titles.some(t => /tor\.test/.test(t))).toBe(false);
    expect(titles).not.toContain('Session saved: auto');
    expect(titles).toContain('Container');       // a persistent container is the person's own
  });

  it('filters by time window and by kind', () => {
    const only = T.collect(data, { from: at(16, 0), kinds: ['note', 'bookmark'] });
    expect(only.map(e => e.kind)).toEqual(['bookmark']);
  });
});

describe('grouping', () => {
  const events = [{ t: at(16, 9), kind: 'page', title: 'a' }, { t: at(15, 9), kind: 'note', title: 'b' }, { t: at(9, 9), kind: 'page', title: 'c' }, { t: at(15, 10), kind: 'page', title: 'd' }];
  it('by day, with words for today and yesterday', () => {
    const g = T.group([...events].sort((a, b) => b.t - a.t), 'day', NOW);
    expect(g.map(x => x.label.split(',')[0])).toEqual(['Today', 'Yesterday', expect.any(String)]);
    expect(g[1].counts).toEqual({ page: 1, note: 1 });
  });
  it('by week, starting on Monday', () => {
    const g = T.group([...events].sort((a, b) => b.t - a.t), 'week', NOW);
    expect(g[0].label).toBe('This week');
    expect(new Date(g[0].start).getDay()).toBe(1);
    expect(g[0].events).toHaveLength(3);          // 16th, 15th, 15th are Fri/Thu/Thu of one week
    expect(g[1].label).toBe('Last week');
  });
});

describe('what a click reopens', () => {
  const log = [{ kind: 'tabs', t: at(16, 9, 5), tabs: [{ url: 'https://a.test/x', title: 'A' }, { url: 'https://b.test/', title: 'B' }] }];
  it('a saved session restores that session', () => {
    expect(T.reopenPlan({ kind: 'session', sessionId: 's1', t: 1 }, [])).toEqual({ kind: 'session', id: 's1' });
  });
  it('a page visit reopens the tabs that were open around then, when known', () => {
    const plan = T.reopenPlan({ kind: 'page', t: at(16, 9), url: 'https://a.test/x' }, log);
    expect(plan.kind).toBe('tabs');
    expect(plan.tabs).toHaveLength(2);
    expect(plan.exact).toBe(false);
  });
  it('a page visit with no snapshot nearby reopens the page itself', () => {
    expect(T.reopenPlan({ kind: 'page', t: at(10, 9), url: 'https://a.test/x' }, log)).toEqual({ kind: 'url', url: 'https://a.test/x' });
  });
  it('a note has nothing to reopen', () => {
    expect(T.reopenPlan({ kind: 'note', t: at(16, 9), title: 'n' }, log)).toBeNull();
  });
  it('a tab snapshot reopens exactly itself', () => {
    expect(T.reopenPlan({ kind: 'tabs', t: 1, tabs: [{ url: 'https://x.test/' }] }, [])).toMatchObject({ kind: 'tabs', exact: true });
  });
});

describe('the log it keeps', () => {
  it('records nothing from a private window', () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect(T.record({ kind: 'game', title: 'x' })).toBe(false);
    expect(T.readLog()).toEqual([]);
  });

  it('respects each switch, with mail off by default', () => {
    expect(T.prefs()).toEqual({ tabs: true, games: true, github: true, mail: false });
    expect(T.record({ kind: 'mail', title: 'hello', mailKey: 'a:1' })).toBe(false);
    T.setPref('games', false);
    expect(T.record({ kind: 'game', title: 'g' })).toBe(false);
    expect(() => T.setPref('nope', true)).toThrow(/No such timeline setting/);
  });

  it('keeps mail subjects only when switched on, once each', () => {
    T.setPref('mail', true);
    const msgs = [{ uid: 1, subject: 'Invoice', date: at(16, 8), from: { address: 'a@b.c' } }, { uid: 2, subject: '', date: 1 }];
    expect(T.noteMail(msgs, 'acc')).toBe(1);
    expect(T.noteMail(msgs, 'acc')).toBe(0);
    const entry = T.readLog()[0];
    expect(entry).toMatchObject({ kind: 'mail', title: 'Invoice' });
    expect(JSON.stringify(entry)).not.toContain('a@b.c');
  });

  it('trims by age and count', () => {
    const old = { kind: 'game', t: NOW - 70 * 86400000, title: 'old' };
    const fresh = { kind: 'game', t: NOW - 1000, title: 'new' };
    expect(T._trim([old, fresh], NOW)).toEqual([fresh]);
  });

  it('notes game start and end with the length', () => {
    T.noteGame({ active: true, app: 'Valorant' });
    T.noteGame({ active: false, app: 'Valorant' });
    const titles = T.readLog().map(l => l.title);
    expect(titles[0]).toBe('Valorant started');
    expect(titles[1]).toMatch(/^Valorant ended/);
  });

  it('keeps a GitHub result and only an https link with it', () => {
    T.noteGitHub({ text: 'CI passed', url: 'http://evil.test/' });
    expect(T.readLog()[0].url).toBeUndefined();
  });

  it('snapshots the open tabs only when they changed, never a private tab, never while gaming', () => {
    globalThis.TabManager = { tabs: [{ url: 'https://a.test/', title: 'A' }, { url: 'https://t.test/', title: 'T', partition: 'tor-1' }, { url: 'file:///x', title: 'F' }] };
    expect(T.snapshotTabs()).toBe(true);
    const snap = T.readLog()[0];
    expect(snap.tabs).toEqual([{ url: 'https://a.test/', title: 'A' }]);
    expect(T.snapshotTabs()).toBe(false);                    // unchanged
    globalThis.TabManager.tabs.push({ url: 'https://b.test/', title: 'B' });
    globalThis.GameMode = { gaming: true };
    expect(T.snapshotTabs()).toBe(false);                    // a game is running
    globalThis.GameMode = { gaming: false };
    expect(T.snapshotTabs()).toBe(true);
  });
});
