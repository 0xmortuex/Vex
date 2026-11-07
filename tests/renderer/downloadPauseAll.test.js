// @vitest-environment jsdom
// The window side of Pause all / Resume all downloads (js/download-pause-all.js).
import { describe, it, expect, vi, afterEach } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexDownloadPause: T } = require('../../src/renderer/js/download-pause-all.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

afterEach(() => { vi.restoreAllMocks(); delete window.vex; delete window.showToast; });

describe('say', () => {
  it('says there is nothing to do when nothing changed', () => {
    expect(T.say(true, { changed: 0, failed: 0 })).toBe('No download is running');
    expect(T.say(false, { changed: 0, failed: 0 })).toBe('No download is paused');
  });
  it('gives the count, and the failures when there were any', () => {
    expect(T.say(true, { changed: 3, failed: 0 })).toBe('Downloads paused: 3');
    expect(T.say(false, { changed: 2, failed: 1 })).toBe('Downloads resumed: 2. Could not change: 1');
    expect(T.say(true, { changed: 0, failed: 2 })).toBe('Downloads paused: 0. Could not change: 2');
    expect(T.say(true, null)).toBe('No download is running');
  });
});

describe('set', () => {
  it('asks main to pause or resume and shows the sentence', async () => {
    const toasts = [];
    window.showToast = (m, kind) => toasts.push([m, kind]);
    window.vex = { downloadsSetAllPaused: vi.fn(async () => ({ ok: true, changed: 2, failed: 0 })) };
    await T.set(true);
    expect(window.vex.downloadsSetAllPaused).toHaveBeenCalledWith(true);
    expect(toasts).toEqual([['Downloads paused: 2', 'info']]);
    await T.set(false);
    expect(window.vex.downloadsSetAllPaused).toHaveBeenLastCalledWith(false);
  });
  it('warns when some could not be changed', async () => {
    const toasts = [];
    window.showToast = (m, kind) => toasts.push([m, kind]);
    window.vex = { downloadsSetAllPaused: async () => ({ ok: true, changed: 1, failed: 1 }) };
    await T.set(false);
    expect(toasts[0][1]).toBe('warn');
  });
  it('throws the reason from main, and plainly in a window without the bridge', async () => {
    window.vex = { downloadsSetAllPaused: async () => ({ ok: false, error: 'nope' }) };
    await expect(T.set(true)).rejects.toThrow('nope');
    delete window.vex;
    await expect(T.set(true)).rejects.toThrow(/cannot be paused in this window/);
  });
});

describe('wiring', () => {
  it('is a lazy module with two one-line commands and no index.html tag', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/download-pause-all.js'");
    expect(read('src/renderer/index.html')).not.toContain('download-pause-all.js');
    const src = read('src/renderer/js/download-pause-all.js');
    expect(src).toMatch(/registerCommand\(\{ id: 'downloads-pause-all', label: 'Pause All Downloads'/);
    expect(src).toMatch(/registerCommand\(\{ id: 'downloads-resume-all', label: 'Resume All Downloads'/);
  });
  it('says in the code and in the details why there is no speed limit', () => {
    expect(read('src/renderer/js/download-pause-all.js')).toMatch(/enableNetworkEmulation/);
    expect(read('src/renderer/js/feature-details.js')).toMatch(/'downloads-pause-all': .*speed control Chromium offers slows the whole session/);
  });
});
