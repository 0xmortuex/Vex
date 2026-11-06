// @vitest-environment jsdom
//
// js/lyrics-card.js: off by default, nothing is looked up before the person turns it on and opens the card, a private/Tor/routed
// tab is never read, synced lines follow the song's position, a changed song is looked up again, closing stops everything.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const { VexLyrics } = require('../../src/renderer/js/lyrics-card.js');

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const LINES = [[5, 'first'], [10, 'second'], [15, ''], [20, 'third']];

let now; let calls; let reads; let lyricsReply;
function install({ canRead = () => true, tabs = [] } = {}) {
  now = { title: 'Get Lucky', artist: 'Daft Punk', album: 'RAM', duration: 369, position: 0, paused: false };
  calls = []; reads = 0;
  lyricsReply = { status: 'ok', synced: LINES, plain: null };
  const wv = { id: 'panel-wv' };
  globalThis.PanelMedia = { PANELS: ['spotify'], webview: (n) => (n === 'spotify' ? wv : null) };
  globalThis.TabManager = { tabs, activeTabId: null };
  globalThis.WebviewManager = { webviews: new Map(tabs.map((t) => [t.id, { id: 'tab-' + t.id }])) };
  window.VexTabPolicy = { canReadWebview: (w) => canRead(w) };
  window.vexGuestEval = vi.fn(async (w, script) => { reads++; if (typeof now === 'function') return now(w); return now; });
  window.vex = { lyricsGet: vi.fn(async (song) => { calls.push(song); return lyricsReply; }), lyricsClear: vi.fn(async () => true) };
  window.showToast = vi.fn();
  // The shared job runner (js/jobs.js) ticks once a second; this stand-in keeps the same cadence on the fake clock.
  window.VexJobs = { every: (name, ms, fn) => { const id = setInterval(fn, Math.max(ms, 1000)); return { stop: () => clearInterval(id) }; } };
  Element.prototype.scrollIntoView = vi.fn();
}
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; vi.useFakeTimers(); install(); });
afterEach(() => { VexLyrics.close(); vi.useRealTimers(); });

const tickMs = async (ms) => { await vi.advanceTimersByTimeAsync(ms); await flush(); };

describe('the setting', () => {
  it('is off by default and can be turned on and off', () => {
    expect(VexLyrics.enabled()).toBe(false);
    VexLyrics.setEnabled(true);
    expect(VexLyrics.enabled()).toBe(true);
    VexLyrics.setEnabled(false);
    expect(VexLyrics.enabled()).toBe(false);
  });
  it('a damaged setting means off', () => {
    localStorage.setItem(VexLyrics.PREF, '{nope');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(VexLyrics.enabled()).toBe(false);
    expect(err).toHaveBeenCalled(); err.mockRestore();
  });
  it('anything but enabled:true is off', () => {
    for (const v of ['{}', '{"enabled":"yes"}', 'null', '[]']) { localStorage.setItem(VexLyrics.PREF, v); expect(VexLyrics.enabled()).toBe(false); }
  });
});

describe('indexAt', () => {
  it('finds the line being sung', () => {
    expect(VexLyrics.indexAt(LINES, 0)).toBe(-1);
    expect(VexLyrics.indexAt(LINES, 4.99)).toBe(-1);
    expect(VexLyrics.indexAt(LINES, 5)).toBe(0);
    expect(VexLyrics.indexAt(LINES, 9.99)).toBe(0);
    expect(VexLyrics.indexAt(LINES, 10)).toBe(1);
    expect(VexLyrics.indexAt(LINES, 17)).toBe(2);
    expect(VexLyrics.indexAt(LINES, 20)).toBe(3);
    expect(VexLyrics.indexAt(LINES, 9999)).toBe(3);
  });
  it('agrees with a linear search on many positions', () => {
    const lines = Array.from({ length: 300 }, (_, i) => [i * 1.7 + (i % 3) * 0.01, 'l' + i]);
    for (let t = -1; t < 520; t += 0.37) {
      let want = -1; for (let i = 0; i < lines.length; i++) if (lines[i][0] <= t) want = i;
      expect(VexLyrics.indexAt(lines, t)).toBe(want);
    }
  });
  it('is -1 for no lines or a position that is not a number', () => {
    expect(VexLyrics.indexAt([], 5)).toBe(-1);
    expect(VexLyrics.indexAt(null, 5)).toBe(-1);
    expect(VexLyrics.indexAt(LINES, NaN)).toBe(-1);
    expect(VexLyrics.indexAt(LINES, undefined)).toBe(-1);
  });
  it('with equal times picks the last of them', () => {
    expect(VexLyrics.indexAt([[1, 'a'], [1, 'b'], [2, 'c']], 1)).toBe(1);
  });
});

describe('what the card says', () => {
  it('has a plain sentence for every answer', () => {
    expect(VexLyrics.viewFor({ status: 'ok', synced: LINES })).toEqual({ kind: 'lines', lines: LINES });
    expect(VexLyrics.viewFor({ status: 'ok', synced: null, plain: 'words' })).toEqual({ kind: 'plain', text: 'words' });
    expect(VexLyrics.viewFor({ status: 'instrumental' }).text).toMatch(/instrumental/);
    expect(VexLyrics.viewFor({ status: 'not-found' }).text).toMatch(/no lyrics for this song/);
    expect(VexLyrics.viewFor({ status: 'offline' }).text).toMatch(/offline/);
    expect(VexLyrics.viewFor({ status: 'busy', retryAfterSec: 12 }).text).toMatch(/12 seconds/);
    expect(VexLyrics.viewFor({ status: 'error', message: 'boom' }).text).toMatch(/boom/);
    expect(VexLyrics.viewFor(undefined).text).toMatch(/did not answer/);
  });
  it('asks again later only for answers that were not answers', () => {
    expect(VexLyrics.retryDelay({ status: 'ok' })).toBe(0);
    expect(VexLyrics.retryDelay({ status: 'not-found' })).toBe(0);
    expect(VexLyrics.retryDelay({ status: 'instrumental' })).toBe(0);
    expect(VexLyrics.retryDelay({ status: 'busy', retryAfterSec: 20 })).toBe(20000);
    expect(VexLyrics.retryDelay({ status: 'offline' })).toBeGreaterThan(0);
    expect(VexLyrics.retryDelay({ status: 'error' })).toBeGreaterThan(0);
    expect(VexLyrics.retryDelay(undefined)).toBeGreaterThan(0);
  });
  it('a song is the same song whatever its capitals', () => {
    expect(VexLyrics.songKey({ title: 'A', artist: 'B', album: 'C' })).toBe(VexLyrics.songKey({ title: 'a', artist: 'b', album: 'c' }));
    expect(VexLyrics.songKey({ title: '', artist: 'B' })).toBe('');
  });
});

describe('the card', () => {
  it('asks for opt-in first and looks nothing up while lyrics are off', async () => {
    await VexLyrics.open();
    await tickMs(3000);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/lrclib\.net/);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/Off until you turn it on/);
    expect(calls).toEqual([]);
    expect(reads).toBe(0);
    expect(window.vex.lyricsGet).not.toHaveBeenCalled();
  });
  it('"Turn on lyrics" turns them on and then looks the song up with artist, title, album and length only', async () => {
    await VexLyrics.open();
    [...document.querySelectorAll('#vex-lyrics-card button')].find((b) => b.textContent === 'Turn on lyrics').click();
    await tickMs(600);
    expect(VexLyrics.enabled()).toBe(true);
    expect(calls).toEqual([{ artist: 'Daft Punk', track: 'Get Lucky', album: 'RAM', duration: 369 }]);
  });
  it('shows the lines and moves the highlight with the position', async () => {
    VexLyrics.setEnabled(true);
    await VexLyrics.open();
    await tickMs(600);
    const rows = () => [...document.querySelectorAll('#vex-lyrics-card [aria-current="true"]')].map((r) => r.textContent);
    expect(document.querySelector('#vex-lyrics-card').textContent).toMatch(/first/);
    expect(rows()).toEqual([]);
    now.position = 11; await tickMs(1000);
    expect(rows()).toEqual(['second']);
    now.position = 16; await tickMs(1000);
    expect(rows().length).toBe(1);               // the empty line between verses is the current one
    now.position = 25; await tickMs(1000);
    expect(rows()).toEqual(['third']);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(calls).toHaveLength(1);               // the same song is not looked up again
  });
  it('moves to the next line on time between two reads of the page', async () => {
    VexLyrics.setEnabled(true);
    now.position = 4.3;                         // 0.7 s before the first line (minus the 0.25 s lead)
    await VexLyrics.open(); await tickMs(10);
    const current = () => [...document.querySelectorAll('#vex-lyrics-card [aria-current="true"]')].map((r) => r.textContent);
    expect(current()).toEqual([]);
    const reads0 = reads;
    await tickMs(300);
    expect(current()).toEqual([]);
    await tickMs(300);
    expect(current()).toEqual(['first']);       // 0.6 s later, before the page was read again
    expect(reads).toBe(reads0);
  });
  it('a paused song keeps its line and moves nothing', async () => {
    VexLyrics.setEnabled(true);
    now.position = 11; now.paused = true;
    await VexLyrics.open(); await tickMs(10);
    const current = () => [...document.querySelectorAll('#vex-lyrics-card [aria-current="true"]')].map((r) => r.textContent);
    expect(current()).toEqual(['second']);
    await tickMs(900);
    expect(current()).toEqual(['second']);
  });
  it('shows plain lyrics without highlighting', async () => {
    lyricsReply = { status: 'ok', synced: null, plain: 'a\nb' };
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/a\nb/);
    expect(document.querySelectorAll('[aria-current]').length).toBe(0);
  });
  it('looks the next song up when the song changes', async () => {
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    now = { ...now, title: 'Instant Crush', position: 1 };
    await tickMs(1100);
    expect(calls.map((c) => c.track)).toEqual(['Get Lucky', 'Instant Crush']);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/Instant Crush/);
  });
  it('says so when nothing is playing, and looks nothing up', async () => {
    now = { title: '', artist: '', album: '', duration: 0, position: 0, paused: true };
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(1200);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/Nothing with a song title is playing/);
    expect(calls).toEqual([]);
  });
  it('says plainly when the song is not found / instrumental / offline', async () => {
    VexLyrics.setEnabled(true);
    lyricsReply = { status: 'not-found' };
    await VexLyrics.open(); await tickMs(600);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/no lyrics for this song/);
    VexLyrics.close();
    lyricsReply = { status: 'instrumental' };
    await VexLyrics.open(); await tickMs(600);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/instrumental/);
  });
  it('tries again after an error, but not after a "not found"', async () => {
    VexLyrics.setEnabled(true);
    lyricsReply = { status: 'error', message: 'down' };
    await VexLyrics.open(); await tickMs(600);
    expect(calls).toHaveLength(1);
    lyricsReply = { status: 'ok', synced: LINES };
    await tickMs(31000);
    expect(calls).toHaveLength(2);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/first/);
    await tickMs(60000);
    expect(calls).toHaveLength(2);
  });
  it('an error thrown by the lookup is shown, not swallowed', async () => {
    window.vex.lyricsGet = vi.fn(async () => { throw new Error('IPC refused'); });
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/IPC refused/);
  });
  it('closing stops the polling: nothing is read or looked up afterwards', async () => {
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    const r = reads; const c = calls.length;
    VexLyrics.close();
    now = { ...now, title: 'Other' };
    await tickMs(10000);
    expect(reads).toBe(r);
    expect(calls.length).toBe(c);
    expect(document.getElementById('vex-lyrics-card')).toBeNull();
  });
  it('a lookup that finishes after the card was closed does nothing', async () => {
    let release;
    window.vex.lyricsGet = vi.fn(() => new Promise((r) => { release = r; }));
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    VexLyrics.close();
    release({ status: 'ok', synced: LINES });
    await flush();
    expect(document.getElementById('vex-lyrics-card')).toBeNull();
  });
  it('"Turn off" switches lyrics off and closes the card', async () => {
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    [...document.querySelectorAll('#vex-lyrics-card button')].find((b) => b.textContent === 'Turn off').click();
    expect(VexLyrics.enabled()).toBe(false);
    expect(document.getElementById('vex-lyrics-card')).toBeNull();
  });
  it('"Clear saved lyrics" asks main to forget them', async () => {
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    [...document.querySelectorAll('#vex-lyrics-card button')].find((b) => b.textContent === 'Clear saved lyrics').click();
    await flush();
    expect(window.vex.lyricsClear).toHaveBeenCalled();
  });
});

describe('private, Tor and routed tabs', () => {
  it('a source the tab policy refuses is never read and never looked up', async () => {
    install({ canRead: () => false });
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(2000);
    expect(reads).toBe(0);
    expect(calls).toEqual([]);
    expect(document.getElementById('vex-lyrics-card').textContent).toMatch(/Nothing with a song title/);
  });
  it('an audible private tab is skipped while a normal one is used', async () => {
    const wvOf = new Map();
    install({ canRead: (w) => w.id !== 'tab-private', tabs: [{ id: 'private', audible: true }, { id: 'normal', audible: true }] });
    globalThis.PanelMedia = { PANELS: [], webview: () => null };
    window.vexGuestEval = vi.fn(async (w) => { wvOf.set(w.id, true); return { ...now, title: w.id === 'tab-normal' ? 'Normal Song' : 'Secret Song' }; });
    VexLyrics.setEnabled(true);
    await VexLyrics.open(); await tickMs(600);
    expect([...wvOf.keys()]).toEqual(['tab-normal']);
    expect(calls.map((c) => c.track)).toEqual(['Normal Song']);
  });
  it('the source list is built through VexTabPolicy.canReadWebview', () => {
    install({ canRead: () => false });
    expect(VexLyrics.sources()).toEqual([]);
  });
});

describe('the wiring', () => {
  const read = (f) => fs.readFileSync(f, 'utf8');
  it('lyrics lookups go through main, the ledger name is Lyrics, and a private window is refused', () => {
    expect(read('src/main.js')).toMatch(/createLyricsService\(\{ fetch: boundedNetFetch/);
    expect(read('src/main/lyrics.js')).toMatch(/feature: 'Lyrics'/);
    expect(read('src/main/ipc-policy.js')).toMatch(/\|lyrics:\|/);
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('lyrics:get'/);
    expect(read('src/preload.js')).toMatch(/lyricsGet: \(song\) => ipcRenderer\.invoke\('lyrics:get', song\)/);
  });
  it('the Now Playing bar shows a Lyrics button only when lyrics are on', () => {
    const src = read('src/renderer/js/tab-ai-media.js');
    expect(src).toMatch(/lyricsOn \? '<button data-lyrics/);
  });
  it('the module is loaded on demand, not at start-up', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/js\/lyrics-card\.js/);
    expect(read('src/renderer/index.html')).not.toMatch(/lyrics-card\.js/);
  });
});
