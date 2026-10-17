// @vitest-environment jsdom
//
// T3-025 watch suggestions from revisit counts (js/revisit-watch.js) and
// T3-096 archive idle workspaces and prune snapshots (js/workspace-archive.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 9, 16, 12, 0).getTime();

describe('VexRevisit', () => {
  let R, suggest;
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    globalThis.PageWatch = { list: () => [], isLocal: () => false, refusalFor: () => '', _steady: (t) => String(t).replace(/s+/g, ' ').trim() };
    globalThis.WebviewManager = { webviews: new Map([['t', {}], ['p', {}]]) };
    // The page says something different on every visit unless a test says otherwise.
    let visit = 0;
    window.vexGuestEval = vi.fn(async () => 'The words of this page, as they stood on visit ' + (visit++) + ', long enough to count.');
    ({ VexRevisit: R } = fresh(JS + 'revisit-watch.js'));
    R.SETTLE_MS = 0;
  });

  it('keys a page by host and path and ignores fronts, searches and other schemes', () => {
    expect(R.keyOf('https://www.Example.com/a/b/?x=1#y')).toBe('example.com/a/b');
    expect(R.keyOf('https://example.com/')).toBe('');
    expect(R.keyOf('https://example.com/search?q=1')).toBe('');
    expect(R.keyOf('file:///c:/a.html')).toBe('');
  });

  it('counts an open once per 20 minutes and suggests at the fifth', () => {
    const u = 'https://shop.example/item/9';
    let r;
    for (let i = 0; i < 4; i++) r = R.note(u, 'Item', NOW + i * 3 * 3600 * 1000);
    expect(r.count).toBe(4);
    expect(r.suggest).toBe(false);
    R.note(u, 'Item', NOW + 4 * 3 * 3600 * 1000 + 60000);
    r = R.note(u, 'Item', NOW + 4 * 3 * 3600 * 1000 + 120000);   // a reload a minute later
    expect(r.count).toBe(5);
    expect(r.suggest).toBe(true);
  });

  it('forgets opens older than a week and does not re-suggest within 14 days', () => {
    const u = 'https://shop.example/item/9';
    for (let i = 0; i < 5; i++) R.note(u, 'Item', NOW + i * 3600 * 1000);
    expect(R.note(u, 'Item', NOW + 9 * DAY).count).toBe(1);
    const map = JSON.parse(localStorage.getItem('vex.revisit'));
    map['shop.example/item/9'].suggestedAt = NOW;
    localStorage.setItem('vex.revisit', JSON.stringify(map));
    for (let i = 0; i < 5; i++) R.note(u, 'Item', NOW + 2 * DAY + i * 3600 * 1000);
    expect(R.note(u, 'Item', NOW + 2 * DAY + 6 * 3600 * 1000).suggest).toBe(false);
  });

  it('adds one inbox row on the fifth open and none for a private tab, a watched page or a local page', async () => {
    globalThis.TabManager = { tabs: [{ id: 't', title: 'Item', partition: null }, { id: 'p', title: 'Item', partition: 'tor-1' }] };
    window.VexTabPolicy = { canRestore: (t) => !t.partition };
    const settled = [];
    const nav = (tabId, url) => { TabManager.tabs.find(t => t.id === tabId).url = url; const r = R.onNavigated({ tabId, url }); if (r && r.settled) settled.push(r.settled); return r; };
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let i = 0; i < 5; i++) { vi.setSystemTime(NOW + i * 3600 * 1000); nav('p', 'https://a.example/x'); }
    expect(R.keyOf('https://a.example/x') in JSON.parse(localStorage.getItem('vex.revisit') || '{}')).toBe(false);
    for (let i = 0; i < 5; i++) { vi.setSystemTime(NOW + i * 3600 * 1000); nav('t', 'https://a.example/x'); await settled[settled.length - 1]; }
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'revisit-watch', action: { key: 'watch:a.example/x' } });
    globalThis.PageWatch.list = () => [{ url: 'https://a.example/y' }];
    for (let i = 0; i < 5; i++) { vi.setSystemTime(NOW + i * 3600 * 1000); nav('t', 'https://a.example/y'); await settled[settled.length - 1]; }
    expect(suggest).toHaveBeenCalledTimes(1);
    globalThis.PageWatch.isLocal = () => true;
    for (let i = 0; i < 5; i++) { vi.setSystemTime(NOW + i * 3600 * 1000); nav('t', 'https://a.example/z'); await Promise.all(settled); }
    expect(suggest).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does nothing while switched off', () => {
    R.setEnabled(false);
    expect(R.onNavigated({ tabId: 't', url: 'https://a.example/x' })).toBeNull();
  });
});

describe('VexWorkspaceArchive', () => {
  let A, wm, snaps, ledgerUndo;
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    window.showToast = vi.fn();
    wm = {
      activeId: 'ws_a',
      workspaces: [{ id: 'ws_a', name: 'A', tabs: [] }, { id: 'ws_b', name: 'B', tabs: [{ url: 'https://x.test' }] }, { id: 'ws_c', name: 'C', tabs: [] }],
      save: vi.fn(), render: vi.fn(),
    };
    globalThis.WorkspaceManager = wm;
    snaps = { ws_b: [{ ts: NOW - 1 * DAY, tabs: [] }, { ts: NOW - 20 * DAY, tabs: [] }, { ts: NOW - 30 * DAY, tabs: [] }], ws_c: [{ ts: NOW - 40 * DAY, tabs: [] }], ws_a: [{ ts: NOW - 2 * DAY, tabs: [] }] };
    globalThis.WorkspaceSnapshots = { MAX: 25, _all: () => JSON.parse(JSON.stringify(snaps)), _save: (o) => { snaps = o; } };
    ledgerUndo = new Map();
    globalThis.VexLedger = { note: vi.fn(), registerUndo: (k, f) => ledgerUndo.set(k, f) };
    ({ VexWorkspaceArchive: A } = fresh(JS + 'workspace-archive.js'));
  });

  it('counts a workspace first seen today as active today', () => {
    A.seed(NOW);
    expect(A.idle(NOW + 29 * DAY)).toEqual([]);
    expect(A.idle(NOW + 31 * DAY).map(i => i.id)).toEqual(['ws_b', 'ws_c']);
  });

  it('never lists the workspace in front, and nothing when only one is left', () => {
    A.seed(NOW);
    expect(A.idle(NOW + 99 * DAY).some(i => i.id === 'ws_a')).toBe(false);
    wm.workspaces = [wm.workspaces[0]];
    expect(A.idle(NOW + 99 * DAY)).toEqual([]);
  });

  it('archives into a card with its snapshots and restores all of it, in place', () => {
    const card = A.archive('ws_b', NOW);
    expect(wm.workspaces.map(w => w.id)).toEqual(['ws_a', 'ws_c']);
    expect(snaps.ws_b).toBeUndefined();
    expect(A.cards()).toHaveLength(1);
    expect(VexLedger.note.mock.calls[0][0].undo).toEqual({ kind: 'workspace-unarchive', id: card.id });
    A.restore(card.id);
    expect(wm.workspaces.map(w => w.id)).toEqual(['ws_a', 'ws_b', 'ws_c']);
    expect(snaps.ws_b).toHaveLength(3);
    expect(wm.workspaces[1].tabs).toHaveLength(1);
    expect(A.cards()).toEqual([]);
  });

  it('refuses the workspace in front and the last one', () => {
    expect(() => A.archive('ws_a')).toThrow(/in front/);
    wm.workspaces = [wm.workspaces[1]];
    expect(() => A.archive('ws_b')).toThrow(/last workspace/);
  });

  it('prunes snapshots older than 7 days but keeps the newest of each, and undo brings them back', () => {
    const c = A.pruneCandidates(NOW);
    expect(c.count).toBe(2);              // ws_b: 20 and 30 days. ws_c has one (kept), ws_a is recent.
    expect(A.prune(NOW)).toEqual({ removed: 2 });
    expect(snaps.ws_b.map(s => s.ts)).toEqual([NOW - 1 * DAY]);
    expect(snaps.ws_c).toHaveLength(1);
    A.unprune(NOW);
    expect(snaps.ws_b).toHaveLength(3);
    expect(() => A.unprune(NOW)).toThrow(/no longer kept/);
  });

  it('keeps nothing removed when the undo copy would be too large', () => {
    snaps.ws_b = [{ ts: NOW }, ...Array.from({ length: 24 }, (_, i) => ({ ts: NOW - (10 + i) * DAY, tabs: [{ url: 'x'.repeat(30000) }] }))];
    expect(() => A.prune(NOW)).toThrow(/Nothing was removed/);
    expect(snaps.ws_b).toHaveLength(25);
  });
});
