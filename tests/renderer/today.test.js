// @vitest-environment jsdom
//
// Today: one snapshot of what will happen and what happened, written to
// localStorage for the new tab page to read. Each source is isolated — one
// failing is reported in the snapshot, not allowed to blank the others.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { VexToday } = require('../../src/renderer/js/today.js');

const NOW = new Date(2026, 8, 13, 14, 30).getTime();
const later = (min) => NOW + min * 60000;

describe('the Today snapshot', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    global.window.vex = { reminders: { list: vi.fn(async () => [
      { id: 'a', message: 'Call Dana', at: later(30), firedAt: null, url: 'https://x.com/1' },
      { id: 'b', message: 'Late one', at: later(-30), firedAt: null },
      { id: 'c', message: 'Tomorrow', at: later(24 * 60 + 60), firedAt: null },
      { id: 'd', message: 'Done', at: later(-60), firedAt: later(-60) },
      { id: 'e', message: 'When on GitHub', at: null, site: 'github.com', firedAt: null },
    ]), onFired: vi.fn() } };
    globalThis.Scheduler = { getAllTasks: () => [{ id: 't1', name: 'Nightly sweep', enabled: true }, { id: 't2', name: 'Paused', enabled: false }],
      nextOccurrence: (t) => (t.id === 't1' ? later(90) : null), describeAction: () => 'Open pages' };
    globalThis.WebMonitor = { watches: [{ id: 'w1', url: 'https://news.example/', title: 'News', changed: true, changedAt: later(-10) }, { id: 'w2', url: 'https://quiet.example/', changed: false }] };
    globalThis.ReadLater = { items: [{ id: 'r1', url: 'https://read.example/', title: 'Long read', at: later(-120), read: false }, { id: 'r2', url: 'https://old.example/', title: 'Old', at: later(-5 * 24 * 60), read: false }] };
  });

  it('collects today\'s reminders, tasks, changes and saves, and writes them', async () => {
    const snap = await VexToday.refresh();
    expect(snap.reminders.map(r => r.id)).toEqual(['b', 'a', 'e']);   // overdue first, tomorrow and fired excluded, site last
    expect(snap.reminders[0].overdue).toBe(true);
    expect(snap.reminders[1].url).toBe('https://x.com/1');
    expect(snap.reminders[2].site).toBe('github.com');
    expect(snap.tasks).toEqual([{ id: 't1', text: 'Nightly sweep', at: later(90), action: 'Open pages' }]);
    expect(snap.changed.map(c => c.id)).toEqual(['w1']);
    expect(snap.saved.map(s => s.id)).toEqual(['r1']);
    expect(snap.errors).toEqual([]);
    expect(JSON.parse(localStorage.getItem('vex.today')).reminders).toHaveLength(3);
  });

  it('reports a source that failed instead of hiding it, and keeps the rest', async () => {
    global.window.vex.reminders.list = vi.fn(async () => { throw new Error('bridge down'); });
    const snap = await VexToday.refresh();
    expect(snap.reminders).toEqual([]);
    expect(snap.errors).toEqual(['reminders: bridge down']);
    expect(snap.tasks).toHaveLength(1);
  });

  it('copes with a Vex that has none of the sources', async () => {
    delete global.window.vex; delete globalThis.Scheduler; delete globalThis.WebMonitor; delete globalThis.ReadLater;
    const snap = await VexToday.refresh();
    expect(snap).toMatchObject({ reminders: [], tasks: [], changed: [], saved: [], errors: [] });
  });

  // The start page runs in its own session partition and cannot see this
  // storage, so the snapshot is handed to it directly.
  it('hands the snapshot to every open start page, and only to start pages', async () => {
    const injected = [];
    const wv = (url) => ({ getURL: () => url, executeJavaScript: vi.fn(async (code) => { injected.push({ url, code }); return true; }) });
    const start = wv('file:///C:/x/src/renderer/start.html?theme=oxford');
    const site = wv('https://example.com/');
    globalThis.WebviewManager = { webviews: new Map([['t1', start], ['t2', site]]) };
    global.window.WebviewManager = globalThis.WebviewManager;
    await VexToday.refresh();
    expect(injected.map(i => i.url)).toEqual([start.getURL()]);
    expect(injected[0].code).toContain('window.__vexToday = ');
    expect(injected[0].code).toContain("dispatchEvent(new Event('vex-today'))");
    expect(VexToday.push(site)).toBe(false);
    expect(VexToday.isStartPage('file:///C:/x/src/renderer/start.html')).toBe(true);
    expect(VexToday.isStartPage('https://example.com/renderer/start.html.evil')).toBe(false);
  });
});
