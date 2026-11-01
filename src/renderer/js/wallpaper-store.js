// === Wallpapers: what is chosen, where it comes from, and showing it on the New Tab ===
//
// The Wallpaper Store (js/wallpaper-store-ui.js) is the place to look at them; this
// file is the logic and the small public API other parts of Vex can call:
//
//   VexWallpapers.apply(id)      -> Promise<{ id, dim, blur, auto }>   show this wallpaper (null/'' removes it)
//   VexWallpapers.current()      -> { id, title, dim, blur, auto } | null
//   VexWallpapers.list()         -> [{ id, title, category, source, light, dominant, tags, author, licence, ... }]
//   VexWallpapers.onChange(cb)   -> unsubscribe()    cb({ current }) after apply / remove / a slider
//
// It loads a moment after start-up (js/lazy-boot.js): a caller at start-up waits for the
// document event "vex-wallpapers-ready", or checks `window.VexWallpapers`.
//
// Where a wallpaper can come from (none of them needs a licence check from the person):
//   generated   drawn by code (js/wallpaper-generators.js, js/wallpaper-data.js): ids like "aurora-borealis"
//   photo       a free photo from a hosted list (main/wallpaper-catalogue.js): "photo-<id>", only if an address is set
//   mine        a picture the person picked: "my-<12 hex>"
// Pictures are kept by the main process (main/wallpaper-store.js), already shrunk; this file
// keeps only small records in localStorage (what is chosen, favourites, recent, names of his own).
// The New Tab page is a document of its own: it is handed the wallpaper (js/webview.js, at load,
// and whenever it changes) and paints it with js/wallpaper-paint.js.

(function (root) {
  'use strict';

  const KEY = 'vex.wallpaper';
  const URL_KEY = 'vex.wallpaper.catalogueUrl';
  const ON_KEY = 'vex.wallpaper.enabled';
  const FEATURE = 'wallpaper-store';
  const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
  const RECENT_MAX = 12, FAV_MAX = 500, MINE_MAX = 24;
  const DEFAULTS = Object.freeze({ dim: 0, blur: 0, auto: true });

  // --- pure logic (tested on its own) -----------------------------------------------

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // Whatever was saved -> a state that is safe to use. A part that is wrong is dropped, the rest kept.
  function normalize(raw) {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const ids = (list, max) => (Array.isArray(list) ? [...new Set(list.filter(x => typeof x === 'string' && ID_RE.test(x)))].slice(0, max) : []);
    let current = null;
    const c = o.current;
    if (c && typeof c === 'object' && typeof c.id === 'string' && ID_RE.test(c.id)) {
      current = { id: c.id, dim: isNum(c.dim) ? clamp(c.dim, 0, 0.9) : DEFAULTS.dim, blur: isNum(c.blur) ? clamp(c.blur, 0, 40) : DEFAULTS.blur, auto: c.auto !== false };
    }
    const mine = (Array.isArray(o.mine) ? o.mine : []).filter(m => m && typeof m.id === 'string' && /^my-[0-9a-f]{12}$/.test(m.id)).slice(0, MINE_MAX).map(m => ({
      id: m.id, title: typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 60) : 'My picture',
      dominant: /^#[0-9a-f]{6}$/i.test(String(m.dominant)) ? m.dominant : '#808080', light: m.light === true,
    }));
    return { current, fav: ids(o.fav, FAV_MAX), recent: ids(o.recent, RECENT_MAX), mine };
  }
  function toggleFav(state, id) {
    const has = state.fav.includes(id);
    return { state: { ...state, fav: has ? state.fav.filter(x => x !== id) : [id, ...state.fav].slice(0, FAV_MAX) }, on: !has };
  }
  function pushRecent(state, id) {
    return { ...state, recent: [id, ...state.recent.filter(x => x !== id)].slice(0, RECENT_MAX) };
  }
  // items: descriptors. filter: { query, category: 'all' | 'fav' | 'recent' | 'mine' | 'photos' | a category id }
  function search(items, state, { query = '', category = 'all' } = {}) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    let out = items;
    if (category === 'fav') out = out.filter(i => state.fav.includes(i.id));
    else if (category === 'recent') out = state.recent.map(id => out.find(i => i.id === id)).filter(Boolean);
    else if (category === 'mine') out = out.filter(i => i.source === 'mine');
    else if (category === 'photos') out = out.filter(i => i.source === 'catalogue');
    else if (category !== 'all') out = out.filter(i => i.category === category);
    if (!words.length) return out;
    return out.filter((i) => {
      const hay = [i.title, i.category, i.author || '', ...(i.tags || [])].join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }

  // --- state ----------------------------------------------------------------------------

  const ls = () => root.localStorage;
  function readState() {
    let text;
    try { text = ls().getItem(KEY); } catch (err) { throw new Error('The saved wallpaper choice could not be read: ' + err.message); }
    if (!text) return normalize(null);
    try { return normalize(JSON.parse(text)); }
    catch (err) {
      // A damaged record: said, then started afresh (the pictures themselves are untouched).
      if (typeof root.VexProblems !== 'undefined') root.VexProblems.note('Wallpapers', 'the saved choice could not be read and is ignored', err);
      else root.console.error('[wallpapers] the saved choice could not be read and is ignored:', err.message);
      return normalize(null);
    }
  }
  let state = null;
  const st = () => (state || (state = readState()));
  function persist(next) {
    try { ls().setItem(KEY, JSON.stringify(next)); } catch (err) { throw new Error('Could not save the wallpaper choice: ' + err.message); }
    state = next;
  }

  const listeners = new Set();
  function emit() {
    const payload = { current: api.current() };
    for (const cb of [...listeners]) {
      try { cb(payload); } catch (err) { root.console.error('[wallpapers] a listener failed:', err && err.message); }
    }
    if (root.document) root.document.dispatchEvent(new root.CustomEvent('vex-wallpaper-changed', { detail: payload }));
  }

  // --- the catalogue of what can be chosen ------------------------------------------------

  let remote = [];          // descriptors of listed photos, from the last list read this session
  let remoteInfo = null;    // { name, updated, fetchedAt, stale, error, problems }

  function fromEntry(e) {
    return Object.freeze({
      id: 'photo-' + e.id, title: e.title, category: e.category, source: 'catalogue', kind: 'photo', author: e.author, licence: e.licence,
      sourceUrl: e.sourceUrl, thumbUrl: e.thumbUrl, fullUrl: e.fullUrl, tags: e.tags, dominant: e.dominant, light: undefined,
      entryId: e.id, width: e.width, height: e.height,
    });
  }
  const mineItems = () => st().mine.map(m => Object.freeze({
    id: m.id, title: m.title, category: 'mine', source: 'mine', kind: 'picture', author: 'You', licence: 'Your own picture', tags: ['mine'], dominant: m.dominant, light: m.light,
  }));
  function generated() {
    if (!root.WallpaperData) throw new Error('The wallpaper list (js/wallpaper-data.js) is not loaded');
    return root.WallpaperData.generated();
  }
  function all() { return [...generated(), ...remote, ...mineItems()]; }
  function describe(id) {
    const d = all().find(x => x.id === id);
    if (d) return d;
    // A listed photo or a picture of his own whose record is not in hand (the list is not loaded): enough to show it from its saved file.
    if (/^photo-/.test(id)) return { id, title: id.replace(/^photo-/, '').replace(/-/g, ' '), category: 'photos', source: 'catalogue', kind: 'photo', tags: [], stub: true };
    return null;
  }

  // --- pictures -------------------------------------------------------------------------------

  const vexApi = () => {
    if (!root.vex || typeof root.vex.wallpaperRead !== 'function') throw new Error('Wallpaper files are not available here');
    return root.vex;
  };
  const BYTES = (dataUrl) => {
    const b = root.atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  };

  // A picture (Blob) -> a JPEG ArrayBuffer no wider than maxW and no bigger than cap, trying smaller until it fits.
  async function shrink(blob, { maxW = 2560, cap = 3 * 1024 * 1024 } = {}) {
    for (const [w, q] of [[maxW, 0.85], [maxW, 0.72], [Math.min(maxW, 1920), 0.7], [Math.min(maxW, 1280), 0.62]]) {
      let bmp;
      try { bmp = await root.createImageBitmap(blob, { resizeWidth: w, resizeQuality: 'high' }); }
      catch (err) { throw new Error('That picture could not be read: it may be damaged', { cause: err }); }
      try {
        const cv = new root.OffscreenCanvas(bmp.width, bmp.height);
        cv.getContext('2d').drawImage(bmp, 0, 0);
        const out = await cv.convertToBlob({ type: 'image/jpeg', quality: q });
        if (out.size <= cap) return out.arrayBuffer();
      } finally { bmp.close(); }
    }
    throw new Error('That picture is too big to keep, even shrunk');
  }

  // The lightest and darkest colours of a picture and its mean brightness, from a 96 px copy.
  const summaries = new Map();
  async function summarise(src, key) {
    if (summaries.has(key)) return summaries.get(key);
    const img = new root.Image();
    img.src = src;
    try { await img.decode(); } catch (err) { throw new Error('That wallpaper could not be drawn', { cause: err }); }
    // 1280 x 720: fine specks (the stars of a night sky) must still count as the lightest pixel.
    const w = 1280, h = 720;
    const cv = root.document.createElement('canvas');
    cv.width = w; cv.height = h;
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    img.src = '';
    const d = x.getImageData(0, 0, w, h).data, P = root.WallpaperPaint;
    if (!P) throw new Error('js/wallpaper-paint.js is not loaded');
    let lo = Infinity, hi = -1, loC = null, hiC = null, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const c = [d[i], d[i + 1], d[i + 2]], y = P.luminance(c);
      sum += y;
      if (y < lo) { lo = y; loC = c; }
      if (y > hi) { hi = y; hiC = c; }
    }
    const hex = (c) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    const s = { lightest: hex(hiC), darkest: hex(loC), meanY: sum / (d.length / 4) };
    if (summaries.size > 120) summaries.delete(summaries.keys().next().value);
    summaries.set(key, s);
    return s;
  }

  // A listed photo's file, downloaded and shrunk once, then kept by the main process.
  async function ensureFull(d) {
    const v = vexApi();
    if (await v.wallpaperRead(d.id, 'full')) return;
    if (!d.fullUrl) throw new Error('This photo is not saved on this computer and its list is not loaded; open the Wallpaper Store online once to fetch it again');
    const got = await v.wallpaperDownload(d.fullUrl, 'full');
    const bytes = await shrink(new root.Blob([got.bytes], { type: got.mime }), { maxW: 2560 });
    await v.wallpaperSave(d.id, 'full', bytes);
  }

  // -> { src, summary } where src is a data: URL the New Tab can paint.
  async function sourceOf(d) {
    if (d.source === 'generated') {
      const G = root.WallpaperGenerators;
      if (!G) throw new Error('js/wallpaper-generators.js is not loaded');
      const src = G.dataUrl(G.svg(d));
      return { src, summary: await summarise(src, d.id) };
    }
    if (d.source === 'catalogue') await ensureFull(d);
    const r = await vexApi().wallpaperRead(d.id, d.source === 'mine' ? 'mine' : 'full');
    if (!r) throw new Error('"' + d.title + '" is not saved on this computer any more' + (d.source === 'mine' ? '' : '; open it in the Wallpaper Store to fetch it again'));
    return { src: r.dataUrl, summary: await summarise(r.dataUrl, d.id) };
  }

  // A small picture for the grid.
  async function thumbOf(d) {
    if (d.source === 'generated') { const G = root.WallpaperGenerators; return G.dataUrl(G.svg(d)); }
    const v = vexApi();
    let r = await v.wallpaperRead(d.id, 'thumb');
    if (!r && d.source === 'catalogue' && d.thumbUrl) {
      const got = await v.wallpaperDownload(d.thumbUrl, 'thumb');
      await v.wallpaperSave(d.id, 'thumb', await shrink(new root.Blob([got.bytes], { type: got.mime }), { maxW: 480, cap: 280 * 1024 }));
      r = await v.wallpaperRead(d.id, 'thumb');
    }
    if (!r) throw new Error('No preview for ' + d.title);
    return r.dataUrl;
  }

  // --- the New Tab ----------------------------------------------------------------------------

  const enabled = () => { try { return ls().getItem(ON_KEY) !== 'false'; } catch (err) { throw new Error('Could not read the wallpaper switch: ' + err.message); } };

  async function buildSpec() {
    const cur = st().current;
    if (!cur || !enabled()) return null;
    const d = describe(cur.id);
    if (!d) throw new Error('The chosen wallpaper "' + cur.id + '" no longer exists');
    const { src, summary } = await sourceOf(d);
    return { id: d.id, src, lightest: summary.lightest, darkest: summary.darkest, dim: cur.dim, blur: cur.blur, auto: cur.auto };
  }
  function startPageJs(spec) {
    if (!spec) return '(() => { if (window.WallpaperPaint) WallpaperPaint.clear(); return { ok: true, cleared: true }; })()';
    return '(() => { try { if (!window.WallpaperPaint) throw new Error("the New Tab has no wallpaper painter"); return Object.assign({ ok: true }, WallpaperPaint.paint(' + JSON.stringify(spec) + ')); } catch (e) { console.error("[wallpaper]", e); return { ok: false, error: String(e && e.message || e) }; } })()';
  }
  async function paintStartPage(webview, spec) {
    const s = spec === undefined ? await buildSpec() : spec;
    if (!s && spec === undefined) return null;          // nothing chosen: a New Tab that just loaded has nothing to clear
    return webview.executeJavaScript(startPageJs(s)).catch((err) => { root.console.error('[wallpapers] could not reach a New Tab page:', err && err.message); return { ok: false, error: err && err.message }; });
  }
  async function paintStartPages() {
    // WebviewManager is a top-level const of the window, not a property of window.
    const WM = typeof WebviewManager !== 'undefined' ? WebviewManager : root.WebviewManager;
    if (!WM || !WM.webviews || typeof root._isTrustedStartPage !== 'function') return [];
    const pages = [];
    for (const wv of WM.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch (err) { /* vex-allow-empty-catch: a webview that has not finished attaching has no address yet; it is handed the wallpaper when it loads (js/webview.js, dom-ready) */ }
      if (url && root._isTrustedStartPage(url)) pages.push(wv);
    }
    if (!pages.length) return [];
    const spec = await buildSpec();       // built once, handed to every open New Tab
    const results = await Promise.all(pages.map(wv => paintStartPage(wv, spec)));
    const done = results.find(r => r && !r.error && typeof r.alpha === 'number');
    if (done) lastPaint = { alpha: done.alpha, required: done.required, readable: done.readable !== false, textOk: done.ok !== false };
    return results;
  }
  let lastPaint = null;       // what the New Tab said when it last painted: { alpha, required, readable }
  // How much of the chosen picture shows through the shade that keeps the text readable (0..1), from the
  // New Tab itself when one has just painted, else worked out here with this window's text colours.
  async function shade() {
    const cur = st().current;
    if (!cur || !enabled()) return null;
    if (lastPaint) return { ...lastPaint, shows: 1 - lastPaint.alpha, fromPage: true };
    const P = root.WallpaperPaint;
    if (!P) throw new Error('js/wallpaper-paint.js is not loaded');
    const { summary } = await sourceOf(describe(cur.id));
    const { scrim, inks } = P.pageColours();
    const need = P.neededScrim({ inks, extremes: [P.hexRgb(summary.lightest), P.hexRgb(summary.darkest)], scrim });
    const alpha = cur.auto ? Math.max(cur.dim, need.alpha) : cur.dim;
    return { alpha, required: need.alpha, readable: need.ok, shows: 1 - alpha, fromPage: false };
  }

  // --- the API ----------------------------------------------------------------------------------

  let token = 0;
  const api = {
    KEY, URL_KEY, ON_KEY, FEATURE, DEFAULTS,

    enabled,
    setEnabled(on) {
      try { ls().setItem(ON_KEY, on ? 'true' : 'false'); } catch (err) { throw new Error('Could not save the wallpaper switch: ' + err.message); }
      paintStartPages().catch(err => root.console.error('[wallpapers] repainting failed:', err && err.message));
      emit();
      return !!on;
    },

    list: () => all(),
    get: (id) => describe(id),
    categories: () => root.WallpaperData.CATEGORIES.slice(),
    current() {
      const c = st().current;
      if (!c) return null;
      const d = describe(c.id);
      return { id: c.id, title: d ? d.title : c.id, dim: c.dim, blur: c.blur, auto: c.auto };
    },
    onChange(cb) {
      if (typeof cb !== 'function') throw new Error('onChange needs a function');
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    // Show a wallpaper on the New Tab. patch: { dim, blur, auto } (the sliders), kept from last time for the same wallpaper.
    async apply(id, patch) {
      if (id == null || id === '') return api.remove();
      if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('That is not a wallpaper id: ' + id);
      const d = describe(id);
      if (!d) throw new Error('There is no wallpaper called "' + id + '"');
      const mine = ++token;
      const prev = st().current && st().current.id === id ? st().current : null;
      const p = patch || {};
      const next = {
        id,
        dim: isNum(p.dim) ? clamp(p.dim, 0, 0.9) : (prev ? prev.dim : DEFAULTS.dim),
        blur: isNum(p.blur) ? clamp(p.blur, 0, 40) : (prev ? prev.blur : DEFAULTS.blur),
        auto: typeof p.auto === 'boolean' ? p.auto : (prev ? prev.auto : DEFAULTS.auto),
      };
      // The wallpaper is fetched (a photo) and drawn BEFORE it is chosen: a failure leaves the old wallpaper in place.
      await sourceOf(d);
      if (mine !== token) return api.current();         // a later choice won
      persist(pushRecent({ ...st(), current: next }, id));
      lastPaint = null;
      const painted = await paintStartPages();
      emit();
      // A New Tab that refused the picture is an error, never a quiet "applied".
      // (paint's own "ok" says whether the text reads well, so a refusal is told apart by its error text.)
      const bad = painted.find(r => r && r.ok === false && r.error);
      if (bad) throw new Error('The New Tab page could not show the wallpaper: ' + bad.error);
      return next;
    },

    // Sliders: change the options of the wallpaper that is on.
    async setOptions(patch) {
      const c = st().current;
      if (!c) throw new Error('No wallpaper is on');
      return api.apply(c.id, patch);
    },

    async remove() {
      ++token;
      persist({ ...st(), current: null });
      lastPaint = null;
      await paintStartPages();
      emit();
      return null;
    },

    favourites: () => st().fav.slice(),
    recent: () => st().recent.slice(),
    isFavourite: (id) => st().fav.includes(id),
    toggleFavourite(id) {
      if (!describe(id)) throw new Error('There is no wallpaper called "' + id + '"');
      const r = toggleFav(st(), id);
      persist(r.state);
      emit();
      return r.on;
    },
    search: (opts) => search(all(), st(), opts),

    // --- his own pictures
    async addPicture(file) {
      if (!file || typeof file.slice !== 'function') throw new Error('No picture was given');
      const T = root.ThemeFromImage;
      if (!T) throw new Error('js/theme-from-image.js is not loaded');
      const blob = await T.checkFile(file);
      if (st().mine.length >= MINE_MAX) throw new Error('You can keep ' + MINE_MAX + ' pictures of your own; remove one first');
      const idBytes = root.crypto.getRandomValues(new Uint8Array(6));
      const id = 'my-' + Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('');
      const v = vexApi();
      await v.wallpaperSave(id, 'mine', await shrink(blob));
      try {
        await v.wallpaperSave(id, 'thumb', await shrink(blob, { maxW: 480, cap: 280 * 1024 }));
        const r = await v.wallpaperRead(id, 'mine');
        const s = await summarise(r.dataUrl, id);
        const P = root.WallpaperPaint;
        const mid = P.mixRgb(P.hexRgb(s.lightest), P.hexRgb(s.darkest), 0.5).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
        const title = T.nameFor(file.name || 'My picture');
        persist({ ...st(), mine: [...st().mine, { id, title, dominant: '#' + mid, light: s.meanY > 0.4 }] });
      } catch (err) {
        await v.wallpaperRemove(id);                    // nothing half-saved is left behind
        throw err;
      }
      emit();
      return describe(id);
    },
    async removeMine(id) {
      if (!st().mine.some(m => m.id === id)) throw new Error('That is not one of your own pictures');
      await vexApi().wallpaperRemove(id);
      const wasOn = st().current && st().current.id === id;
      persist({ ...st(), mine: st().mine.filter(m => m.id !== id), fav: st().fav.filter(x => x !== id), recent: st().recent.filter(x => x !== id), current: wasOn ? null : st().current });
      summaries.delete(id);
      if (wasOn) await paintStartPages();
      emit();
    },

    // --- the hosted list (Settings > Wallpapers)
    catalogueUrl() { try { return ls().getItem(URL_KEY) || ''; } catch (err) { throw new Error('Could not read the wallpaper list address: ' + err.message); } },
    setCatalogueUrl(url) {
      const u = String(url || '').trim();
      if (u) {
        let p;
        try { p = new URL(u); } catch { throw new Error('That is not an address'); }
        if (p.protocol !== 'https:') throw new Error('The wallpaper list address must start with https://');
        if (u.length > 2048) throw new Error('That address is too long');
      }
      try { if (u) ls().setItem(URL_KEY, u); else ls().removeItem(URL_KEY); } catch (err) { throw new Error('Could not save the address: ' + err.message); }
      remote = []; remoteInfo = null;
      emit();
    },
    // Reads the list only when asked (the store calls it when it opens). Offline, the last good copy answers and says it is old.
    async loadCatalogue({ force = false } = {}) {
      const url = api.catalogueUrl();
      if (!url) { remote = []; remoteInfo = null; return { entries: 0, configured: false }; }
      const r = await vexApi().wallpaperCatalogue(url, force);
      remote = r.entries.map(fromEntry);
      remoteInfo = { name: r.name, updated: r.updated, fetchedAt: r.fetchedAt, stale: !!r.stale, error: r.error || '', problems: r.problems || [] };
      return { entries: remote.length, configured: true, ...remoteInfo };
    },
    catalogueInfo: () => remoteInfo,
    stats: () => vexApi().wallpaperStats(),
    async clearCache() { const r = await vexApi().wallpaperClearCache(); summaries.clear(); return r; },

    // --- helpers for the store's screen
    sourceOf, thumbOf, summarise, buildSpec,
    startPageJs, paintStartPage, paintStartPages, shade,

    // A picture of the wallpaper for "Use colours from this wallpaper" (js/theme-from-image.js reads it).
    async rasterFile(id) {
      const d = describe(id);
      if (!d) throw new Error('There is no wallpaper called "' + id + '"');
      const { src } = await sourceOf(d);
      const img = new root.Image();
      img.src = src;
      await img.decode();
      const cv = new root.OffscreenCanvas(640, 360);
      cv.getContext('2d').drawImage(img, 0, 0, 640, 360);
      img.src = '';
      const blob = await cv.convertToBlob({ type: 'image/png' });
      return new root.File([blob], d.title + '.png', { type: 'image/png' });
    },
    shrink, bytesOf: BYTES,
    _logic: { normalize, toggleFav, pushRecent, search },
    _reset() { state = null; remote = []; remoteInfo = null; listeners.clear(); summaries.clear(); token = 0; },
  };

  if (typeof window !== 'undefined') window.VexWallpapers = api; else root.VexWallpapers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexWallpapers: api, logic: { normalize, toggleFav, pushRecent, search } };
  if (root.document && typeof root.document.dispatchEvent === 'function') root.document.dispatchEvent(new root.Event('vex-wallpapers-ready'));
  // This file loads after start-up (js/lazy-boot.js): a New Tab that was already open (the first tab of a start) loaded before
  // there was anything to hand it, so it is handed the saved wallpaper now.
  if ((typeof WebviewManager !== 'undefined' || typeof root.WebviewManager !== 'undefined') && root.localStorage && root.localStorage.getItem(KEY)) {
    api.paintStartPages().catch(err => root.console.error('[wallpapers] the open New Tab could not be painted at start-up:', err && err.message));
  }
})(typeof window !== 'undefined' ? window : globalThis);
