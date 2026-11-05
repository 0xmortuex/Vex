// @vitest-environment jsdom
//
// The online part of the Wallpaper Store (js/wallpaper-store.js, js/wallpaper-store-ui.js): the built-in
// catalogue merged with a hosted list, the source filter, the switch (OFF means no request to any host),
// lazy previews fetched a few at a time, and the Turkish for everything new.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const JS = '../../src/renderer/js/';
require(JS + 'wallpaper-generators.js');
require(JS + 'wallpaper-data.js');
require(JS + 'wallpaper-paint.js');
const { VexWallpapers: V, logic } = require(JS + 'wallpaper-store.js');
const { LICENCES } = require('../../src/main/wallpaper-catalogue.js');
const { loadBuiltin } = require('../../src/main/wallpaper-builtin.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'wallpaper-builtin');
const data = loadBuiltin({ fs, path, dir: FIX });

let vex, cached;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  localStorage.clear();
  V._reset();
  cached = new Map();
  const px = new Uint8ClampedArray(1280 * 720 * 4).fill(20);
  px.set([250, 250, 250, 255], 40);
  window.Image = class { set src(v) { this._s = v; } get src() { return this._s; } decode() { return Promise.resolve(); } };
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: px }) });
  window.WebviewManager = globalThis.WebviewManager = { webviews: new Map() };
  window._isTrustedStartPage = () => false;
  window.createImageBitmap = vi.fn(async () => ({ width: 10, height: 10, close() {} }));
  window.OffscreenCanvas = class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob([new Uint8Array(100)], { type: 'image/jpeg' }); } };
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  window.vex = vex = {
    wallpaperRead: vi.fn(async (id, kind) => cached.get(id + ':' + kind) || null),
    wallpaperSave: vi.fn(async (id, kind) => { cached.set(id + ':' + kind, { dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 3 }); return { ok: true }; }),
    wallpaperRemove: vi.fn(async () => ({ ok: true })),
    wallpaperDownload: vi.fn(async () => ({ bytes: new ArrayBuffer(8), mime: 'image/jpeg' })),
    wallpaperCatalogue: vi.fn(),
    wallpaperBuiltin: vi.fn(async () => data),
    wallpaperStats: vi.fn(async () => ({ cachedIds: [...cached.keys()].filter(k => k.endsWith(':full')).map(k => k.replace(/:full$/, '')) })),
    wallpaperClearCache: vi.fn(async () => ({ ok: true })),
    wallpaperCancel: vi.fn(async () => ({ ok: true })),
    onWallpaperProgress: vi.fn(() => () => {}),
  };
});

const requests = () => vex.wallpaperDownload.mock.calls.length + vex.wallpaperCatalogue.mock.calls.length;

describe('the built-in catalogue joins the list', () => {
  it('is read without a request to any host, and its entries become "photo-" wallpapers with their credit', async () => {
    const r = await V.loadCatalogue();
    expect(r).toMatchObject({ entries: 2, configured: false, builtin: 2, hosted: 0 });
    expect(V.get('photo-art-wave')).toMatchObject({ source: 'catalogue', origin: 'builtin', group: 'art', author: 'An Artist', licence: 'PDM-1.0', dominant: '#1d4e6b' });
    expect(V.get('photo-mist-valley')).toMatchObject({ group: 'photo', title: 'Mist in the valley' });
    expect(requests()).toBe(0);
  });

  it('the online categories come from the categories file, only the ones that have a wallpaper', async () => {
    await V.loadCatalogue();
    expect(V.onlineCategories().map(c => c.id)).toEqual(['art-seascapes', 'nature']);
    expect(V.onlineCategories()[0].title).toBe('Seascapes in art');
  });

  it('a hosted entry that repeats a built-in id is dropped and said; the others join', async () => {
    V.setCatalogueUrl('https://example.com/l.json');
    const e = (id) => ({ id, title: 'T ' + id, category: 'nature', author: 'A', licence: 'CC0-1.0', sourceUrl: 'https://e.example/s', thumbUrl: 'https://e.example/t', fullUrl: 'https://e.example/f', tags: [], dominant: '#112233' });
    vex.wallpaperCatalogue.mockResolvedValue({ name: 'Mine', updated: '', fetchedAt: 5, entries: [e('mist-valley'), e('pond')], problems: [] });
    const r = await V.loadCatalogue();
    expect(r.entries).toBe(3);
    expect(V.list().filter(d => d.id === 'photo-mist-valley')).toHaveLength(1);
    expect(V.get('photo-mist-valley').origin).toBe('builtin');
    expect(V.get('photo-pond').origin).toBe('hosted');
    expect(r.problems.some(p => /repeats the id of a built-in wallpaper/.test(p))).toBe(true);
    expect(r.hosted).toBe(1);
  });

  it('a hosted list that cannot be read leaves the built-in entries in place, and the error is raised', async () => {
    V.setCatalogueUrl('https://example.com/l.json');
    vex.wallpaperCatalogue.mockRejectedValue(new Error('The wallpaper list server answered 500'));
    await expect(V.loadCatalogue()).rejects.toThrow(/500/);
    expect(V.get('photo-art-wave')).toBeTruthy();
  });

  it('merging keeps the built-in first and never two cards with one id', () => {
    const a = [{ id: 'photo-a', entryId: 'a' }, { id: 'photo-b', entryId: 'b' }], b = [{ id: 'photo-b', entryId: 'b' }, { id: 'photo-c', entryId: 'c' }];
    const m = logic.mergeRemote(a, b);
    expect(m.entries.map(x => x.id)).toEqual(['photo-a', 'photo-b', 'photo-c']);
    expect(m.clashes).toHaveLength(1);
  });
});

describe('source filter and search', () => {
  it('splits Drawn by Vex / Art and designs / Photos / Mine', async () => {
    await V.loadCatalogue();
    const ids = (source) => V.search({ source }).map(d => d.id);
    expect(ids('art')).toEqual(['photo-art-wave']);
    expect(ids('photo')).toEqual(['photo-mist-valley']);
    expect(ids('generated').length).toBeGreaterThan(20);
    expect(ids('generated')).not.toContain('photo-art-wave');
    expect(ids('mine')).toEqual([]);
    expect(V.search({ source: 'all' }).length).toBe(V.list().length);
  });
  it('searches the title, the author and the tags', async () => {
    await V.loadCatalogue();
    expect(V.search({ query: 'great wave' }).map(d => d.id)).toEqual(['photo-art-wave']);
    expect(V.search({ query: 'jane' }).map(d => d.id)).toEqual(['photo-mist-valley']);
    expect(V.search({ query: 'mist green' }).map(d => d.id)).toEqual(['photo-mist-valley']);
    expect(V.search({ query: 'mist', source: 'art' })).toEqual([]);
  });
  it('a category chip narrows within the source', async () => {
    await V.loadCatalogue();
    expect(V.search({ category: 'nature', source: 'photo' }).map(d => d.id)).toEqual(['photo-mist-valley']);
    expect(V.search({ category: 'art-seascapes' }).map(d => d.id)).toEqual(['photo-art-wave']);
  });
});

describe('"Show online wallpapers" OFF: no request to any host, ever', () => {
  it('is on by default', () => { expect(V.online()).toBe(true); });

  it('loads nothing, hides the catalogue, and reads no file', async () => {
    V.setOnline(false);
    V.setCatalogueUrl('https://example.com/l.json');
    const r = await V.loadCatalogue({ force: true });
    expect(r).toMatchObject({ entries: 0, off: true });
    expect(V.list().some(d => d.source === 'catalogue')).toBe(false);
    expect(V.onlineCategories()).toEqual([]);
    expect(vex.wallpaperBuiltin).not.toHaveBeenCalled();
    expect(requests()).toBe(0);
  });

  it('a preview and a download are refused before any request, with a tag the store can say in words', async () => {
    await V.loadCatalogue();
    const d = V.get('photo-art-wave');
    V.setOnline(false);
    await expect(V.thumbOf(d)).rejects.toThrow(/\[wp:off\]/);
    await expect(V.sourceOf(d)).rejects.toThrow(/\[wp:off\]/);
    await expect(V.apply('photo-art-wave')).rejects.toThrow();      // the list is hidden, so the picture is unknown
    expect(requests()).toBe(0);
  });

  it('a picture that is already on this computer still shows with the switch off', async () => {
    await V.loadCatalogue();
    cached.set('photo-art-wave:full', { dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 3 });
    cached.set('photo-art-wave:thumb', { dataUrl: 'data:image/jpeg;base64,BBBB', bytes: 3 });
    const d = V.get('photo-art-wave');
    V.setOnline(false);
    expect(await V.thumbOf(d)).toBe('data:image/jpeg;base64,BBBB');
    expect(requests()).toBe(0);
  });

  it('offline: an honest tagged error and no request', async () => {
    await V.loadCatalogue();
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    await expect(V.thumbOf(V.get('photo-art-wave'))).rejects.toThrow(/\[wp:offline\]/);
    expect(requests()).toBe(0);
  });
});

describe('previews are fetched lazily and a few at a time', () => {
  it('never more than the limit at once, and a card that left the view is skipped', async () => {
    await V.loadCatalogue();
    const many = Array.from({ length: 10 }, (_, i) => ({ ...V.get('photo-mist-valley'), id: 'photo-card-' + i }));
    let running = 0, peak = 0;
    const releases = [];
    vex.wallpaperDownload.mockImplementation(() => new Promise((resolve) => {
      running++; peak = Math.max(peak, running);
      releases.push(() => { running--; resolve({ bytes: new ArrayBuffer(8), mime: 'image/jpeg' }); });
    }));
    const gone = new Set(['photo-card-8', 'photo-card-9']);
    const jobs = many.map(d => V.thumbOf(d, { stale: () => gone.has(d.id) }).then(() => 'ok', (e) => e.message));
    await flush();
    expect(peak).toBe(V.THUMB_CONCURRENCY);
    expect(releases.length).toBe(V.THUMB_CONCURRENCY);
    while (releases.length) { releases.shift()(); await flush(); }
    const out = await Promise.all(jobs);
    expect(out.slice(0, 8)).toEqual(Array(8).fill('ok'));
    expect(out[8]).toMatch(/\[wp:skipped\]/);
    expect(out[9]).toMatch(/\[wp:skipped\]/);
    expect(vex.wallpaperDownload).toHaveBeenCalledTimes(8);        // nothing was asked for the two that left
    expect(peak).toBe(V.THUMB_CONCURRENCY);
  });

  it('a preview already on this computer costs no request', async () => {
    await V.loadCatalogue();
    cached.set('photo-art-wave:thumb', { dataUrl: 'data:image/jpeg;base64,BBBB', bytes: 3 });
    await V.thumbOf(V.get('photo-art-wave'));
    expect(requests()).toBe(0);
  });

  it('saving a picture tells main which ones must not be evicted (the wallpaper on and the favourites)', async () => {
    await V.loadCatalogue();
    V.toggleFavourite('photo-mist-valley');
    await V.apply('grad-ocean');
    await V.thumbOf(V.get('photo-art-wave'));
    const saveCall = vex.wallpaperSave.mock.calls.find(c => c[0] === 'photo-art-wave' && c[1] === 'thumb');
    expect(saveCall[3]).toEqual(expect.arrayContaining(['grad-ocean', 'photo-mist-valley']));
  });
});

describe('a download reports progress and can be cancelled', () => {
  it('hands the same ticket to the download and to the progress listener, and lets go of the listener', async () => {
    await V.loadCatalogue();
    const off = vi.fn();
    let listener;
    vex.onWallpaperProgress.mockImplementation((cb) => { listener = cb; return off; });
    vex.wallpaperDownload.mockImplementation(async (url, kind, ticket) => { listener({ ticket, got: 3 * 1048576, total: 8 * 1048576 }); listener({ ticket: 'someone-else', got: 1, total: 2 }); return { bytes: new ArrayBuffer(8), mime: 'image/jpeg' }; });
    const seen = [];
    const ticket = V.newTicket();
    await V.sourceOf(V.get('photo-art-wave'), { ticket, onProgress: (p) => seen.push(p) });
    expect(vex.wallpaperDownload).toHaveBeenCalledWith('https://images.example.org/f/wave.jpg', 'full', ticket);
    expect(seen).toEqual([{ ticket, got: 3 * 1048576, total: 8 * 1048576 }]);
    expect(off).toHaveBeenCalled();
  });
  it('cancel goes to main by ticket', async () => {
    await V.cancelDownload('dl-abc-1');
    expect(vex.wallpaperCancel).toHaveBeenCalledWith('dl-abc-1');
  });
  it('a failed download leaves the old wallpaper on and raises the reason', async () => {
    await V.loadCatalogue();
    await V.apply('grad-ocean');
    vex.wallpaperDownload.mockRejectedValue(new Error("Error invoking remote method 'wallpaper:download': Error: [wp:too-large] The picture is 14.0 MB; 12 MB at most"));
    await expect(V.apply('photo-art-wave')).rejects.toThrow(/\[wp:too-large\]/);
    expect(V.current().id).toBe('grad-ocean');
    expect(vex.wallpaperSave).not.toHaveBeenCalledWith('photo-art-wave', 'full', expect.anything(), expect.anything());
  });
});

describe('credit data', () => {
  it('every licence code Vex accepts has a name the credit line can show', () => {
    expect(Object.keys(V.LICENCE_NAMES).sort()).toEqual(Object.keys(LICENCES).sort());
    expect(V.licenceName('CC0-1.0')).toMatch(/Zero/);
  });
});

describe('Turkish', () => {
  it('shows the Turkish title for the known category ids and the English one for any other', () => {
    window.VexI18nUI = { locale: () => 'tr' };
    try {
      for (const id of ['art-landscapes', 'art-japan', 'art-seascapes', 'art-patterns', 'art-classic', 'space', 'nature', 'mountains', 'sea-and-sky', 'cities', 'architecture']) {
        expect(V.CATEGORY_TR[id], id).toBeTruthy();
        expect(V.categoryTitle(id, 'English title')).toBe(V.CATEGORY_TR[id]);
      }
      expect(V.categoryTitle('something-new', 'English title')).toBe('English title');
      window.VexI18nUI = { locale: () => 'en' };
      expect(V.categoryTitle('space', 'Space')).toBe('Space');
    } finally { delete window.VexI18nUI; }
  });

  it('every string the store shows has a Turkish entry in the table', () => {
    const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'wallpaper-store-ui.js'), 'utf8');
    const tr = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'i18n-ui.js'), 'utf8');
    const found = new Set();
    for (const m of ui.matchAll(/\bL\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) found.add(m[1].replace(/\\'/g, "'"));
    for (const m of ui.matchAll(/^\s+(?:'[a-z-]+'|[a-z]+): '((?:[^'\\]|\\.)*)',?\r?$/gm)) found.add(m[1].replace(/\\'/g, "'"));
    const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    expect([...found].filter(s => !tr.includes(q(s) + ':'))).toEqual([]);
    expect(found.size).toBeGreaterThan(100);
  });
});
