// @vitest-environment jsdom
//
// T3-035 (Wave 6): the background video quality cap of Network courtesy mode. A fake player stands in for YouTube's
// movie_player; the scripts Vex sends to the page are evaluated in jsdom against it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexNetCourtesy: N } = require('../../src/renderer/js/net-courtesy.js');

let player, tabs, active, wvs, ledger, undo, problems;

function makePlayer() {
  const p = { state: 1, quality: 'hd1080', range: null, calls: [] };
  p.getPlayerState = () => p.state;
  p.getPlaybackQuality = () => p.quality;
  p.setPlaybackQualityRange = (a, b) => { p.calls.push([a, b]); p.range = [a, b]; };
  return p;
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  N.capped = new Map(); N._capTimers = new Map(); N.run = null;
  N.setEnabled(true); N.setCapEnabled(true);
  tabs = []; active = 1; wvs = new Map(); ledger = []; undo = {}; problems = [];
  globalThis.TabManager = { tabs, get activeTabId() { return active; } };
  globalThis.WebviewManager = { webviews: wvs };
  globalThis.VexLedger = { note: (l) => ledger.push(l), registerUndo: (k, f) => { undo[k] = f; } };
  VexMediaKit.problem = (...a) => problems.push(a);
  player = makePlayer();
});
afterEach(() => { vi.useRealTimers(); delete globalThis.TabManager; delete globalThis.WebviewManager; delete globalThis.VexLedger; });

// A page per tab that keeps the window between the cap and the restore script.
function pageTab(id, url, pl) {
  tabs.push({ id, url });
  const win = {}; const doc = { getElementById: (n) => (n === 'movie_player' ? pl : null) };
  wvs.set(id, { isConnected: true, executeJavaScript: vi.fn(async (script) => new Function('window', 'document', 'return ' + script)(win, doc)), win });
  return win;
}

describe('which pages are handled', () => {
  it('only YouTube watch, shorts and live pages over https', () => {
    for (const u of ['https://www.youtube.com/watch?v=abc', 'https://m.youtube.com/watch?v=abc', 'https://youtube.com/shorts/xyz', 'https://www.youtube.com/live/abc']) expect(N.siteFor(u), u).not.toBeNull();
    for (const u of ['https://www.youtube.com/', 'https://www.youtube.com/feed/subscriptions', 'http://www.youtube.com/watch?v=a', 'https://www.youtube.com.evil.test/watch?v=a', 'https://notyoutube.com/watch', 'about:blank', '', 'not a url']) expect(N.siteFor(u), u).toBeNull();
    expect(N.VIDEO_SITES.map(s => s.name)).toEqual(['YouTube']);
  });
});

describe('capping and restoring', () => {
  it('is off by default and needs Network courtesy mode', async () => {
    localStorage.clear();
    expect(N.capEnabled()).toBe(false);
    N.setEnabled(true);
    expect(N.capEnabled()).toBe(false);
    N.setCapEnabled(true);
    expect(N.capEnabled()).toBe(true);
    N.setEnabled(false);
    expect(N.capEnabled()).toBe(false);
  });

  it('lowers a playing background video, notes a ledger line, and puts automatic quality back', async () => {
    pageTab(1, 'https://example.com/', null);
    const win = pageTab(2, 'https://www.youtube.com/watch?v=a', player);
    expect(await N.capTab(2)).toBe(true);
    expect(player.range).toEqual(['tiny', 'small']);
    expect(win.__vexVideoCap).toEqual({ prior: 'hd1080' });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ feature: 'net-courtesy', undo: { kind: 'video-cap-restore', tabIds: [2] } });
    expect(await N.capTab(2)).toBe(false);                       // already capped: nothing more is sent
    expect(await N.restoreTab(2)).toBe(true);
    expect(player.range).toEqual(['tiny', 'highres']);
    expect(win.__vexVideoCap).toBeUndefined();
    expect(N.capped.size).toBe(0);
  });

  it('leaves a paused video, a missing player, an unhandled site and a switch that is off alone', async () => {
    pageTab(2, 'https://www.youtube.com/watch?v=a', player);
    player.state = 2;
    expect(await N.capTab(2)).toBe(false);
    expect(player.calls).toEqual([]);
    pageTab(3, 'https://www.youtube.com/watch?v=b', null);
    expect(await N.capTab(3)).toBe(false);
    pageTab(4, 'https://vimeo.com/123', player);
    expect(await N.capTab(4)).toBe(false);
    player.state = 1;
    N.setCapEnabled(false);
    pageTab(5, 'https://www.youtube.com/watch?v=c', player);
    expect(await N.capTab(5)).toBe(false);
    expect(player.calls).toEqual([]);
    expect(ledger).toHaveLength(0);
  });

  it('caps a tab 30 seconds after it left the front, and restores it the moment it is in front again', async () => {
    pageTab(1, 'https://example.com/', null);
    pageTab(2, 'https://www.youtube.com/watch?v=a', player);
    N._onActivated(1);                                           // the person is on tab 1
    await vi.advanceTimersByTimeAsync(29000);
    expect(player.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.range).toEqual(['tiny', 'small']);
    active = 2;
    N._onActivated(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(player.range).toEqual(['tiny', 'highres']);
    expect(N.capped.size).toBe(0);
  });

  it('does not cap a tab that came back to the front before the delay', async () => {
    pageTab(1, 'https://example.com/', null);
    pageTab(2, 'https://www.youtube.com/watch?v=a', player);
    N._onActivated(1);
    await vi.advanceTimersByTimeAsync(10000);
    active = 2; N._onActivated(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(player.calls).toEqual([]);
  });

  it('a game lowers every handled tab at once, the front one too, and the end puts them all back', async () => {
    const p2 = makePlayer(), p3 = makePlayer();
    pageTab(1, 'https://www.youtube.com/watch?v=front', player);
    pageTab(2, 'https://www.youtube.com/watch?v=b', p2);
    pageTab(3, 'https://www.youtube.com/watch?v=c', p3);
    window.vex = { egressSummary: async () => ({ bytesOut: 0, bytesIn: 0 }), downloadsControl: async () => ({ ok: true }) };
    await N.begin('Game.exe');
    await vi.advanceTimersByTimeAsync(0);
    expect([player.range, p2.range, p3.range]).toEqual([['tiny', 'small'], ['tiny', 'small'], ['tiny', 'small']]);
    expect(N.capped.size).toBe(3);
    await N.end().catch(() => {});                               // the summary needs the ledger of the real app; the restore is what is checked
    expect([player.range, p2.range, p3.range]).toEqual([['tiny', 'highres'], ['tiny', 'highres'], ['tiny', 'highres']]);
    delete window.vex;
  });

  it('switching the courtesy mode or the cap off puts everything back; so does the ledger Undo', async () => {
    pageTab(2, 'https://www.youtube.com/watch?v=a', player);
    await N.capTab(2);
    N.init(); // registers the undo kinds
    N.setCapEnabled(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(player.range).toEqual(['tiny', 'highres']);
    N.setCapEnabled(true);
    await N.capTab(2);
    await undo['video-cap-restore']({ tabIds: [2] });
    expect(player.range).toEqual(['tiny', 'highres']);
    expect(N.capped.size).toBe(0);
    expect(problems).toEqual([]);
  });

  it('a closed tab is forgotten and a tab that went to sleep is not scripted', async () => {
    pageTab(2, 'https://www.youtube.com/watch?v=a', player);
    await N.capTab(2);
    wvs.delete(2);
    expect(await N.restoreTab(2)).toBe(false);
    expect(N.capped.size).toBe(0);
  });

  it('scripts only the handled player: the scripts hold no network call and no data from the page', () => {
    for (const s of N.VIDEO_SITES) for (const code of [s.cap, s.restore]) expect(code).not.toMatch(/fetch|XMLHttpRequest|cookie|localStorage|sendBeacon|innerHTML|eval\(/);
  });
});
