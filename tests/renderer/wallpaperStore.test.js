// @vitest-environment jsdom
//
// The Wallpaper Store's logic and its public API (js/wallpaper-store.js):
// favourites, recent, search, what apply / current / list / onChange do, and what the
// New Tab is handed.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
require(JS + 'wallpaper-generators.js');
require(JS + 'wallpaper-data.js');
require(JS + 'wallpaper-paint.js');
const { VexWallpapers: V, logic } = require(JS + 'wallpaper-store.js');

let vex, pushed;
function fakeStartPage(url = 'file:///C:/vex/src/renderer/start.html') {
  return { getURL: () => url, executeJavaScript: vi.fn(async (js) => { pushed.push(js); return { ok: true }; }) };
}

beforeEach(() => {
  localStorage.clear();
  V._reset();
  pushed = [];
  // A 96x54 picture: dark with one bright pixel, so lightest/darkest are known.
  const px = new Uint8ClampedArray(96 * 54 * 4).fill(20);
  px.set([250, 250, 250, 255], 40);
  px.set([5, 5, 5, 255], 44);
  window.Image = class { set src(v) { this._s = v; } get src() { return this._s; } decode() { return Promise.resolve(); } };
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: px }) });
  const kept = new Map();
  window.vex = vex = {
    wallpaperRead: vi.fn(async (id, kind) => kept.get(id + ':' + kind) || null),
    wallpaperSave: vi.fn(async (id, kind) => { kept.set(id + ':' + kind, { dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 3 }); return { ok: true }; }),
    wallpaperRemove: vi.fn(async () => ({ ok: true })),
    wallpaperDownload: vi.fn(async () => ({ bytes: new ArrayBuffer(8), mime: 'image/jpeg' })),
    wallpaperCatalogue: vi.fn(),
    wallpaperStats: vi.fn(async () => ({})),
    wallpaperClearCache: vi.fn(async () => ({ ok: true })),
  };
  window.WebviewManager = globalThis.WebviewManager = { webviews: new Map() };
  window._isTrustedStartPage = (u) => /start\.html$/.test(u);
});

describe('the saved record', () => {
  it('keeps what is good and drops what is not', () => {
    const s = logic.normalize({
      current: { id: 'aurora-borealis', dim: 5, blur: -3, auto: 'x' },
      fav: ['a-1', 'a-1', 'BAD ID', 7, 'b-2'], recent: 'nope',
      mine: [{ id: 'my-0123456789ab', title: '  ', dominant: 'red', light: 1 }, { id: 'my-zz' }],
    });
    expect(s.current).toEqual({ id: 'aurora-borealis', dim: 0.9, blur: 0, auto: true });
    expect(s.fav).toEqual(['a-1', 'b-2']);
    expect(s.recent).toEqual([]);
    expect(s.mine).toEqual([{ id: 'my-0123456789ab', title: 'My picture', dominant: '#808080', light: false }]);
  });
  it('anything at all becomes an empty state', () => {
    for (const bad of [null, 'x', 5, [], undefined]) expect(logic.normalize(bad)).toEqual({ current: null, fav: [], recent: [], mine: [] });
  });
});

describe('favourites and recent', () => {
  const empty = logic.normalize(null);
  it('toggle a favourite on and off, newest first', () => {
    let r = logic.toggleFav(empty, 'a-1'); expect(r.on).toBe(true);
    r = logic.toggleFav(r.state, 'b-2'); expect(r.state.fav).toEqual(['b-2', 'a-1']);
    r = logic.toggleFav(r.state, 'a-1'); expect(r).toMatchObject({ on: false, state: { fav: ['b-2'] } });
    expect(empty.fav).toEqual([]);                   // the old state is not changed
  });
  it('recent puts the newest first, never twice, and keeps 12', () => {
    let s = empty;
    for (let i = 0; i < 15; i++) s = logic.pushRecent(s, 'w-' + String(i).padStart(2, '0'));
    expect(s.recent).toHaveLength(12);
    expect(s.recent[0]).toBe('w-14');
    s = logic.pushRecent(s, 'w-10');
    expect(s.recent.slice(0, 3)).toEqual(['w-10', 'w-14', 'w-13']);
    expect(new Set(s.recent).size).toBe(12);
  });
});

describe('search', () => {
  const items = [
    { id: 'a-1', title: 'Deep swell', category: 'waves', source: 'generated', tags: ['ocean'] },
    { id: 'a-2', title: 'Pine ridge', category: 'mountains', source: 'generated', tags: ['forest'] },
    { id: 'photo-x', title: 'Misty hills', category: 'nature', source: 'catalogue', author: 'Jane Doe', tags: ['mist'] },
    { id: 'my-0123456789ab', title: 'Holiday', category: 'mine', source: 'mine', tags: ['mine'] },
  ];
  const state = { ...logic.normalize(null), fav: ['a-2'], recent: ['photo-x', 'a-1', 'gone-1'] };
  const ids = (o) => logic.search(items, state, o).map(i => i.id);
  it('every word has to match the title, group, author or a tag', () => {
    expect(ids({ query: 'ocean' })).toEqual(['a-1']);
    expect(ids({ query: 'jane mist' })).toEqual(['photo-x']);
    expect(ids({ query: 'mountains pine' })).toEqual(['a-2']);
    expect(ids({ query: 'zzz' })).toEqual([]);
  });
  it('groups: all, favourites, recent (in recent order), mine, photos, or a category', () => {
    expect(ids({})).toHaveLength(4);
    expect(ids({ category: 'fav' })).toEqual(['a-2']);
    expect(ids({ category: 'recent' })).toEqual(['photo-x', 'a-1']);
    expect(ids({ category: 'mine' })).toEqual(['my-0123456789ab']);
    expect(ids({ category: 'photos' })).toEqual(['photo-x']);
    expect(ids({ category: 'waves' })).toEqual(['a-1']);
    expect(ids({ category: 'waves', query: 'pine' })).toEqual([]);
  });
});

describe('the public API', () => {
  it('lists the built-in wallpapers, at least 60', () => {
    const l = V.list();
    expect(l.length).toBeGreaterThanOrEqual(60);
    expect(l.every(w => w.id && w.title && w.category && w.source)).toBe(true);
    expect(V.get('aurora-borealis').title).toBe('Borealis');
    expect(V.get('nope')).toBeNull();
  });
  it('has no current wallpaper to begin with', () => {
    expect(V.current()).toBeNull();
  });
  it('apply(id) chooses it, keeps it in localStorage (not the picture), and makes current() answer', async () => {
    const r = await V.apply('aurora-borealis');
    expect(r).toEqual({ id: 'aurora-borealis', dim: 0, blur: 0, auto: true });
    expect(V.current()).toEqual({ id: 'aurora-borealis', title: 'Borealis', dim: 0, blur: 0, auto: true });
    const saved = localStorage.getItem('vex.wallpaper');
    expect(JSON.parse(saved).current.id).toBe('aurora-borealis');
    expect(saved.length).toBeLessThan(400);          // a record, never the picture
    expect(JSON.parse(saved).recent).toEqual(['aurora-borealis']);
  });
  it('apply keeps the sliders of the same wallpaper and clamps what is out of range', async () => {
    await V.apply('aurora-borealis', { dim: 0.3, blur: 8, auto: false });
    expect(V.current()).toMatchObject({ dim: 0.3, blur: 8, auto: false });
    await V.apply('aurora-borealis');
    expect(V.current()).toMatchObject({ dim: 0.3, blur: 8, auto: false });
    await V.apply('aurora-borealis', { dim: 5, blur: 500 });
    expect(V.current()).toMatchObject({ dim: 0.9, blur: 40 });
    await V.apply('aurora-polar');
    expect(V.current()).toMatchObject({ dim: 0, blur: 0, auto: true });      // another wallpaper starts fresh
  });
  it('apply(null) and apply("") remove it', async () => {
    await V.apply('aurora-borealis');
    expect(await V.apply(null)).toBeNull();
    expect(V.current()).toBeNull();
    await V.apply('aurora-borealis');
    await V.apply('');
    expect(V.current()).toBeNull();
  });
  it('apply refuses an id that is not one, or that does not exist, and changes nothing', async () => {
    await V.apply('aurora-borealis');
    await expect(V.apply('Not An Id')).rejects.toThrow(/not a wallpaper id/);
    await expect(V.apply('no-such-one')).rejects.toThrow(/no wallpaper called/);
    expect(V.current().id).toBe('aurora-borealis');
  });
  it('setOptions needs a wallpaper on', async () => {
    await expect(V.setOptions({ dim: 0.2 })).rejects.toThrow(/No wallpaper is on/);
    await V.apply('grad-ocean');
    await V.setOptions({ blur: 5 });
    expect(V.current().blur).toBe(5);
  });
  it('onChange hears apply, the sliders and remove, and can be stopped', async () => {
    const seen = [];
    const stop = V.onChange((e) => seen.push(e.current && e.current.id));
    await V.apply('grad-ocean');
    await V.setOptions({ dim: 0.1 });
    await V.remove();
    expect(seen).toEqual(['grad-ocean', 'grad-ocean', null]);
    stop();
    await V.apply('grad-ocean');
    expect(seen).toHaveLength(3);
  });
  it('a listener that throws does not stop the others or the apply', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen = [];
    V.onChange(() => { throw new Error('boom'); });
    V.onChange((e) => seen.push(e.current.id));
    await V.apply('grad-ocean');
    expect(seen).toEqual(['grad-ocean']);
    expect(err).toHaveBeenCalled();
  });
  it('onChange needs a function', () => expect(() => V.onChange(5)).toThrow(/function/));
  it('favourites and recent follow what was chosen', async () => {
    await V.apply('grad-ocean'); await V.apply('grad-rose');
    expect(V.recent()).toEqual(['grad-rose', 'grad-ocean']);
    expect(V.toggleFavourite('grad-rose')).toBe(true);
    expect(V.isFavourite('grad-rose')).toBe(true);
    expect(V.search({ category: 'fav' }).map(w => w.id)).toEqual(['grad-rose']);
    expect(() => V.toggleFavourite('no-such-one')).toThrow(/no wallpaper called/);
  });
  it('comes back from a saved record after a restart', async () => {
    await V.apply('grad-ocean', { dim: 0.25 });
    V._reset();
    expect(V.current()).toMatchObject({ id: 'grad-ocean', dim: 0.25 });
  });
  it('a damaged record is ignored with a message and the store starts empty', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('vex.wallpaper', '{not json');
    V._reset();
    expect(V.current()).toBeNull();
    expect(err).toHaveBeenCalled();
  });
});

describe('the New Tab is handed the wallpaper', () => {
  it('every open New Tab gets the picture and the measured extremes; a page that is not the New Tab gets nothing', async () => {
    const a = fakeStartPage(), b = fakeStartPage(), other = fakeStartPage('https://example.com/start.html');
    window._isTrustedStartPage = (u) => u.startsWith('file:///C:/vex/');
    WebviewManager.webviews.set(1, a); WebviewManager.webviews.set(2, b); WebviewManager.webviews.set(3, other);
    await V.apply('mtn-midnight', { dim: 0.2, blur: 4 });
    expect(a.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(b.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(other.executeJavaScript).not.toHaveBeenCalled();
    const js = pushed[0];
    expect(js).toContain('WallpaperPaint.paint(');
    const spec = JSON.parse(js.slice(js.indexOf('paint(') + 6, js.lastIndexOf(')); } catch')));
    expect(spec).toMatchObject({ id: 'mtn-midnight', dim: 0.2, blur: 4, auto: true, lightest: '#fafafa', darkest: '#050505' });
    expect(spec.src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  });
  it('removing it clears every open New Tab', async () => {
    const a = fakeStartPage();
    WebviewManager.webviews.set(1, a);
    await V.apply('grad-ocean');
    pushed.length = 0;
    await V.remove();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain('WallpaperPaint.clear()');
  });
  it('a New Tab that loads with no wallpaper chosen is left alone; with one, it is handed it', async () => {
    const fresh = fakeStartPage();
    expect(await V.paintStartPage(fresh)).toBeNull();
    expect(fresh.executeJavaScript).not.toHaveBeenCalled();
    await V.apply('grad-ocean');
    await V.paintStartPage(fresh);
    expect(fresh.executeJavaScript).toHaveBeenCalledTimes(1);
  });
  it('the switch off stops painting but keeps the choice; on paints again', async () => {
    await V.apply('grad-ocean');
    V.setEnabled(false);
    expect(V.enabled()).toBe(false);
    expect(V.current().id).toBe('grad-ocean');
    expect(await V.buildSpec()).toBeNull();
    V.setEnabled(true);
    expect((await V.buildSpec()).id).toBe('grad-ocean');
  });
  it('a failure on the New Tab is reported, not hidden', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = { getURL: () => 'file:///C:/vex/src/renderer/start.html', executeJavaScript: vi.fn(async () => { throw new Error('page gone'); }) };
    await V.apply('grad-ocean');
    const r = await V.paintStartPage(bad);
    expect(r).toMatchObject({ ok: false, error: 'page gone' });
    expect(err).toHaveBeenCalled();
  });
  it('apply raises when an open New Tab refuses the picture, instead of reporting success', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = { getURL: () => 'file:///C:/vex/src/renderer/start.html', executeJavaScript: vi.fn(async () => { throw new Error('page gone'); }) };
    window._isTrustedStartPage = (u) => u.startsWith('file:///C:/vex/');
    WebviewManager.webviews.set(1, bad);
    await expect(V.apply('grad-ocean')).rejects.toThrow(/could not show the wallpaper: page gone/);
    expect(V.current().id).toBe('grad-ocean');          // the choice is kept; the person is told it did not show
    expect(err).toHaveBeenCalled();
  });
  it('a painted New Tab whose text is hard to read (paint says ok:false, no error) is not a refusal', async () => {
    const page = { getURL: () => 'file:///C:/vex/src/renderer/start.html', executeJavaScript: vi.fn(async () => ({ ok: false, alpha: 0.4, required: 0.9, readable: true })) };
    window._isTrustedStartPage = (u) => u.startsWith('file:///C:/vex/');
    WebviewManager.webviews.set(1, page);
    await expect(V.apply('grad-ocean')).resolves.toMatchObject({ id: 'grad-ocean' });
    expect(await V.shade()).toMatchObject({ alpha: 0.4, shows: 0.6, textOk: false, fromPage: true });
  });
});

describe('how much of the picture shows (shade)', () => {
  it('is null with nothing chosen and while the switch is off', async () => {
    expect(await V.shade()).toBeNull();
    await V.apply('grad-ocean');
    V.setEnabled(false);
    expect(await V.shade()).toBeNull();
  });
  it('is what the New Tab itself measured when it has just painted', async () => {
    const page = { getURL: () => 'file:///C:/vex/src/renderer/start.html', executeJavaScript: vi.fn(async () => ({ ok: true, alpha: 0.98, required: 0.98, readable: true })) };
    window._isTrustedStartPage = (u) => u.startsWith('file:///C:/vex/');
    WebviewManager.webviews.set(1, page);
    await V.apply('aurora-polar');
    const s = await V.shade();
    expect(s.alpha).toBe(0.98);
    expect(s.shows).toBeCloseTo(0.02, 5);
    expect(s.fromPage).toBe(true);
  });
  it('is worked out here when no New Tab is open, with dark text over a dark and bright picture needing a heavy shade', async () => {
    const P = window.WallpaperPaint, real = P.pageColours;
    P.pageColours = () => ({ scrim: [245, 241, 232], inks: [[26, 26, 26], [74, 74, 74], [106, 106, 106], [30, 58, 95]] });
    try {
      await V.apply('aurora-polar');          // the fake picture: lightest 250, darkest 5
      const s = await V.shade();
      expect(s.fromPage).toBe(false);
      expect(s.alpha).toBeGreaterThan(0.6);
      expect(s.shows).toBeLessThan(0.4);
    } finally { P.pageColours = real; }
  });
  it('apply forgets an older measurement so a stale one is never reported', async () => {
    const page = { getURL: () => 'file:///C:/vex/src/renderer/start.html', executeJavaScript: vi.fn(async () => ({ ok: true, alpha: 0.5, required: 0.5, readable: true })) };
    window._isTrustedStartPage = (u) => u.startsWith('file:///C:/vex/');
    WebviewManager.webviews.set(1, page);
    await V.apply('grad-ocean');
    expect((await V.shade()).alpha).toBe(0.5);
    WebviewManager.webviews.clear();
    const P = window.WallpaperPaint, real = P.pageColours;
    P.pageColours = () => ({ scrim: [245, 241, 232], inks: [[26, 26, 26]] });
    try {
      await V.apply('grad-rose');
      expect((await V.shade()).fromPage).toBe(false);
    } finally { P.pageColours = real; }
  });
});

describe('the photo list address', () => {
  it('is empty by default, and nothing is asked for', async () => {
    expect(V.catalogueUrl()).toBe('');
    expect(await V.loadCatalogue()).toEqual({ entries: 0, configured: false });
    expect(vex.wallpaperCatalogue).not.toHaveBeenCalled();
  });
  it('takes only an https address (or empty to clear it)', () => {
    expect(() => V.setCatalogueUrl('http://example.com/l.json')).toThrow(/https/);
    expect(() => V.setCatalogueUrl('not an address')).toThrow(/not an address/);
    V.setCatalogueUrl(' https://example.com/l.json ');
    expect(V.catalogueUrl()).toBe('https://example.com/l.json');
    V.setCatalogueUrl('');
    expect(V.catalogueUrl()).toBe('');
  });
  it('listed photos join the list as "photo-" wallpapers with their credit', async () => {
    V.setCatalogueUrl('https://example.com/l.json');
    vex.wallpaperCatalogue.mockResolvedValue({ name: 'L', updated: '', fetchedAt: 1, entries: [{ id: 'mist', title: 'Mist', category: 'nature', author: 'Jane', licence: 'CC0-1.0', sourceUrl: 'https://e.example/s', thumbUrl: 'https://e.example/t', fullUrl: 'https://e.example/f', tags: ['fog'], dominant: '#112233' }], problems: [] });
    const r = await V.loadCatalogue();
    expect(r).toMatchObject({ entries: 1, configured: true });
    const w = V.get('photo-mist');
    expect(w).toMatchObject({ source: 'catalogue', author: 'Jane', licence: 'CC0-1.0', title: 'Mist' });
    expect(V.search({ category: 'photos' }).map(x => x.id)).toEqual(['photo-mist']);
  });
  it('applying a photo downloads it once, shrinks it, keeps it, and uses the kept copy afterwards', async () => {
    V.setCatalogueUrl('https://example.com/l.json');
    vex.wallpaperCatalogue.mockResolvedValue({ name: '', updated: '', fetchedAt: 1, entries: [{ id: 'mist', title: 'Mist', category: 'nature', author: 'Jane', licence: 'CC0-1.0', sourceUrl: 'https://e.example/s', thumbUrl: 'https://e.example/t', fullUrl: 'https://e.example/f', tags: [], dominant: '#112233' }], problems: [] });
    await V.loadCatalogue();
    window.createImageBitmap = vi.fn(async () => ({ width: 10, height: 10, close() {} }));
    window.OffscreenCanvas = class { getContext() { return { drawImage() {} }; } async convertToBlob() { return new Blob([new Uint8Array(100)], { type: 'image/jpeg' }); } };
    await V.apply('photo-mist');
    expect(vex.wallpaperDownload).toHaveBeenCalledWith('https://e.example/f', 'full');
    expect(vex.wallpaperSave).toHaveBeenCalledWith('photo-mist', 'full', expect.any(ArrayBuffer));
    await V.apply('photo-mist', { dim: 0.1 });
    expect(vex.wallpaperDownload).toHaveBeenCalledTimes(1);
  });
  it('a photo that cannot be fetched leaves the old wallpaper on', async () => {
    V.setCatalogueUrl('https://example.com/l.json');
    vex.wallpaperCatalogue.mockResolvedValue({ name: '', updated: '', fetchedAt: 1, entries: [{ id: 'mist', title: 'Mist', category: 'nature', author: 'J', licence: 'CC0-1.0', sourceUrl: 'https://e.example/s', thumbUrl: 'https://e.example/t', fullUrl: 'https://e.example/f', tags: [], dominant: '#112233' }], problems: [] });
    await V.loadCatalogue();
    await V.apply('grad-ocean');
    vex.wallpaperDownload.mockRejectedValue(new Error('offline'));
    await expect(V.apply('photo-mist')).rejects.toThrow('offline');
    expect(V.current().id).toBe('grad-ocean');
  });
});
