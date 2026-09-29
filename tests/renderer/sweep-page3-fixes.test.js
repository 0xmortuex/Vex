// @vitest-environment jsdom
//
// The third "page" pass of the 2026-09-29 sweep: Master Volume against the
// per-site volume, Night mode with another site's audio on the page, media in
// iframes, reading mode after Back, BibTeX authors, saving a source view or a
// reader page, and very long full-page captures.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { SiteVolume, vexGuestEvalFrames } = require('../../src/renderer/js/site-volume.js');
const { MasterVolume } = require('../../src/renderer/js/master-volume.js');
const { NightAudio } = require('../../src/renderer/js/night-audio.js');
const { ReadingMode } = require('../../src/renderer/js/reading-mode.js');
const { PageExport, vexReadablePage } = require('../../src/renderer/js/page-export.js');

const runInPage = (js) => (0, eval)(js);

// A Web Audio stand-in, enough for a tap: one source per element, gains that hold a value.
function fakeAudio() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } });
  const param = () => ({ value: 0 });
  class Ctx {
    constructor() { this.state = 'running'; this.destination = {}; }
    addEventListener() {}
    resume() { return Promise.resolve(); }
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
  }
  window.AudioContext = Ctx;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.showToast = vi.fn();
  for (const k of ['__vexMV', '__vexAudio', '__vexNight', '__vexVolume', '__vexVolumeWired', 'AudioContext', 'vex']) delete window[k];
});
afterEach(() => { vi.restoreAllMocks(); delete globalThis.TabManager; delete globalThis.WebviewManager; });

describe('Master Volume never undoes the per-site volume', () => {
  // A page has one Master Volume instance; the tests share one document, so
  // each gets a fresh <html> to leave the last one's MutationObserver behind.
  beforeEach(() => { document.replaceChild(document.createElement('html'), document.documentElement); document.documentElement.append(document.createElement('head'), document.createElement('body')); });
  const video = (vol) => { document.body.innerHTML = '<video></video>'; const v = document.querySelector('video'); v.volume = vol; return v; };

  it('a boost and back to 100% leaves a site kept at 40% at 40%', () => {
    fakeAudio();
    const v = video(1);
    runInPage(SiteVolume.script(40));
    expect(v.volume).toBe(0.4);
    runInPage(MasterVolume._script(2));
    const out = window.__vexAudio.nodes.get(v).out;
    expect(out.gain.value).toBe(2);           // the boost is the gain alone
    expect(v.volume).toBe(0.4);               // it used to be forced to 1 here
    window.__vexMV.set(1);
    expect(out.gain.value).toBe(1);
    expect(v.volume).toBe(0.4);
  });

  it('at 50% a site kept at 40% plays at 20%, and stays there when the page changes', async () => {
    const v = video(1);
    runInPage(SiteVolume.script(40));
    runInPage(MasterVolume._script(0.5));
    expect(v.volume).toBeCloseTo(0.2);
    document.body.appendChild(document.createElement('p'));      // the MutationObserver re-runs
    await new Promise(r => setTimeout(r, 0));
    expect(v.volume).toBeCloseTo(0.2);
  });

  it('with no per-site figure, the site\'s own level is what is scaled', async () => {
    const v = video(0.3);
    runInPage(MasterVolume._script(0.5));
    expect(v.volume).toBeCloseTo(0.15);
    document.body.appendChild(document.createElement('p'));
    await new Promise(r => setTimeout(r, 0));
    expect(v.volume).toBeCloseTo(0.15);       // not halved again
    window.__vexMV.set(1);
    expect(v.volume).toBeCloseTo(0.3);
  });

  it('the per-site script, run after Master Volume, keeps the master share', () => {
    const v = video(1);
    runInPage(MasterVolume._script(0.5));
    runInPage(SiteVolume.script(40));
    expect(v.volume).toBeCloseTo(0.2);
  });
});

describe('Night mode with another site\'s audio on the page', () => {
  it('turns on for what it can reach and counts what it skipped', () => {
    fakeAudio();
    document.body.innerHTML = '<video></video><audio src="https://elsewhere.example/a.mp3"></audio>';
    expect(runInPage(NightAudio.script(true))).toMatchObject({ ok: true, touched: 1, skipped: 1 });
  });

  it('turns off again — switching off no longer tries to attach the other site\'s audio', () => {
    fakeAudio();
    document.body.innerHTML = '<video></video><audio src="https://elsewhere.example/a.mp3"></audio>';
    runInPage(NightAudio.script(true));
    expect(runInPage(NightAudio.script(false))).toMatchObject({ ok: true, touched: 1 });
  });

  it('fails only when nothing could be attached, and says how many were skipped', async () => {
    fakeAudio();
    document.body.innerHTML = '<audio src="https://elsewhere.example/a.mp3"></audio>';
    const res = runInPage(NightAudio.script(true));
    expect(res).toMatchObject({ ok: false, skipped: 1, name: 'CrossOrigin' });
    window.vexGuestEval = async () => res;
    await expect(NightAudio.apply({}, true)).rejects.toThrow(/another site that does not allow it \(1 player from another site skipped\)/);
  });

  it('the toast names what was left as it was', async () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/film' }), activeTabId: 1 };
    globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'https://example.com/film' }]]) };
    window.vexGuestEval = async () => ({ ok: true, touched: 1, skipped: 2, frames: 0 });
    await NightAudio.toggle();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('2 players from another site left as they were'));
  });
});

describe('media inside iframes', () => {
  it('runs in every frame when the main process offers it', async () => {
    window.vex = { evalAllFrames: vi.fn(async () => ({ ok: true, results: [{ ok: true, value: 1 }, { ok: true, value: 2 }] })) };
    const r = await vexGuestEvalFrames({ getWebContentsId: () => 7 }, 'code', true);
    expect(window.vex.evalAllFrames).toHaveBeenCalledWith(7, 'code', true);
    expect(r).toEqual({ all: true, results: [{ ok: true, value: 1 }, { ok: true, value: 2 }] });
  });

  it('a refusal from the main process is raised, not swallowed', async () => {
    window.vex = { evalAllFrames: async () => ({ ok: false, error: 'That tab has closed' }) };
    await expect(vexGuestEvalFrames({ getWebContentsId: () => 7 }, 'x')).rejects.toThrow('That tab has closed');
  });

  it('Night mode adds up every frame, so a player in an iframe counts', async () => {
    window.vex = { evalAllFrames: async () => ({ ok: true, results: [{ ok: true, value: { ok: true, touched: 0, skipped: 0, frames: 1 } }, { ok: true, value: { ok: true, touched: 1, skipped: 0, frames: 0 } }] }) };
    expect(await NightAudio.apply({ getWebContentsId: () => 7 }, true)).toEqual({ touched: 1, skipped: 0, unreached: 0 });
  });

  it('top frame only: Night mode does not claim the frames it could not reach', async () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/embed' }), activeTabId: 1 };
    globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'https://example.com/embed' }]]) };
    window.vexGuestEval = async () => ({ ok: true, touched: 0, skipped: 0, frames: 2 });
    await NightAudio.toggle();
    const [msg, kind] = window.showToast.mock.calls[0];
    expect(msg).toContain('not inside the 2 embedded frames');
    expect(msg).not.toContain('when something plays');
    expect(kind).toBe('warn');
  });

  it('the per-site volume reports frames it could not reach', async () => {
    window.vexGuestEval = async () => ({ media: 0, frames: 1 });
    expect(await SiteVolume.applyTo({}, 40)).toEqual({ media: 0, unreachedFrames: 1 });
  });

  it('Master Volume goes through the all-frames call too', async () => {
    window.vex = { evalAllFrames: vi.fn(async () => ({ ok: true, results: [] })) };
    globalThis.WebviewManager = { webviews: new Map([[1, { getWebContentsId: () => 4 }]]) };
    MasterVolume.apply(0.5);
    expect(window.vex.evalAllFrames).toHaveBeenCalledWith(4, expect.stringContaining('__vexMV'), false);
  });
});

describe('reading mode after Back', () => {
  const reader = (source) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="vex-reading-source" content="${source}"><title>t</title></head><body></body></html>`);

  it('the reader page names its source, and only http(s) comes back out', () => {
    expect(ReadingMode.sourceOf(reader('https://a.test/x?a=1&amp;b=2'))).toBe('https://a.test/x?a=1&b=2');
    expect(ReadingMode.sourceOf(reader('file:///C:/secret.txt'))).toBe('');
    expect(ReadingMode.sourceOf('https://a.test/')).toBe('');
  });

  it('the reader page Vex builds carries the meta', async () => {
    const wv = { loaded: [], getURL() { return this.loaded[this.loaded.length - 1] || 'https://origin.test/a?b=1&c=2'; }, loadURL(u) { this.loaded.push(u); }, executeJavaScript: async () => ({ title: 'T', blocks: [{ tag: 'P', text: 'words' }], wordCount: 1 }) };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    globalThis.WebviewManager = { getActiveWebview: () => wv, webviews: new Map([['t1', wv]]) };
    ReadingMode._originalUrls.clear();
    await ReadingMode.activate();
    expect(ReadingMode.sourceOf(wv.loaded[0])).toBe('https://origin.test/a?b=1&c=2');
  });

  it('pressing it on a reader page with nothing remembered goes to the source, not a reader of the reader', async () => {
    const wv = { loaded: [], getURL: () => reader('https://origin.test/article'), loadURL(u) { this.loaded.push(u); }, executeJavaScript: vi.fn() };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    globalThis.WebviewManager = { getActiveWebview: () => wv, webviews: new Map([['t1', wv]]) };
    ReadingMode._originalUrls.clear();
    await ReadingMode.activate();
    expect(wv.loaded).toEqual(['https://origin.test/article']);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('exitReadingMode (the page\'s Exit button) falls back to the source too', () => {
    const wv = { loaded: [], getURL: () => reader('https://origin.test/article'), loadURL(u) { this.loaded.push(u); } };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1' }] };
    globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
    ReadingMode._originalUrls.clear();
    expect(ReadingMode.exitReadingMode('t1')).toBe(true);
    expect(wv.loaded).toEqual(['https://origin.test/article']);
  });
});

describe('page export', () => {
  it('BibTeX keeps an organisation in one pair of braces, escaped inside', () => {
    const b = PageExport.cite({ title: 'Moon', authors: [{ org: 'Contributors to Wikimedia projects' }, { org: 'R&D Team' }], url: 'https://x.test' }, 'bibtex', new Date(2026, 8, 29));
    expect(b).toContain('author = {{Contributors to Wikimedia projects} and {R\\&D Team}},');
  });

  it('a source view is refused up front instead of waiting 8 s', async () => {
    window.vexGuestEval = vi.fn();
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'view-source:https://example.com/' }) };
    await expect(PageExport.saveMarkdown()).rejects.toThrow(/source code/);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });

  it('a reader page is saved with the article it came from, not its data: address', () => {
    document.head.innerHTML = '<meta name="vex-reading-source" content="https://en.wikipedia.org/wiki/Moon">';
    document.body.innerHTML = '<article><p>The Moon.</p></article>';
    const r = vexReadablePage();
    expect(r.url).toBe('https://en.wikipedia.org/wiki/Moon');
    expect(r.markdown).toBe('The Moon.');
    document.head.innerHTML = '';
  });
});
