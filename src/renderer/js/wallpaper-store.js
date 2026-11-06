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
  // "Show online wallpapers" (default ON): off means no request to any host, ever, and the online part of the store is hidden.
  const ONLINE_KEY = 'vex.wallpaper.online';
  const THUMB_CONCURRENCY = 4;
  // Licence codes (main/wallpaper-catalogue.js LICENCES) -> the name shown in a credit line. A test keeps the two in step.
  const LICENCE_NAMES = Object.freeze({
    'CC0-1.0': 'Creative Commons Zero (public domain)', 'PDM-1.0': 'Public Domain Mark', 'Pexels': 'Pexels License',
    'Unsplash': 'Unsplash License', 'Own': 'Made by the owner of the list',
  });
  // The titles of the built-in categories in Turkish, by id. Any other id shows the title the data file gives.
  const CATEGORY_TR = Object.freeze({
    'art-landscapes': 'Sanat: manzaralar', 'art-japan': 'Sanat: Japonya', 'art-seascapes': 'Sanat: deniz manzaraları',
    'art-patterns': 'Sanat: desenler', 'art-classic': 'Sanat: klasikler', space: 'Uzay', nature: 'Doğa', mountains: 'Dağlar',
    'sea-and-sky': 'Deniz ve gökyüzü', cities: 'Şehirler', architecture: 'Mimari',
  });

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
  // Which part of the store a wallpaper belongs to: drawn by Vex, art and designs (category ids "art-..."), photos, or the person's own.
  function groupOf(i) {
    if (i.group) return i.group;
    if (i.source === 'generated') return 'generated';
    if (i.source === 'mine') return 'mine';
    return /^art-/.test(i.category || '') ? 'art' : 'photo';
  }
  // items: descriptors. filter: { query, category: 'all' | 'fav' | 'recent' | 'mine' | 'photos' | a category id, source: 'all' | 'generated' | 'art' | 'photo' | 'mine' }
  function search(items, state, { query = '', category = 'all', source = 'all' } = {}) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    let out = source === 'all' ? items : items.filter(i => groupOf(i) === source);
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

  let remote = [];          // descriptors of the built-in catalogue and the hosted list, from the last read this session
  let remoteInfo = null;    // { name, updated, fetchedAt, stale, error, problems, builtin, hosted }
  let remoteCats = [];      // [{ id, title, blurb }] from the built-in categories file

  function fromEntry(e, origin) {
    return Object.freeze({
      id: 'photo-' + e.id, title: e.title, category: e.category, source: 'catalogue', kind: 'photo', origin: origin || 'hosted',
      group: /^art-/.test(e.category) ? 'art' : 'photo', author: e.author, licence: e.licence,
      sourceUrl: e.sourceUrl, thumbUrl: e.thumbUrl, fullUrl: e.fullUrl, tags: e.tags, dominant: e.dominant, light: undefined,
      entryId: e.id, width: e.width, height: e.height,
    });
  }
  // The built-in entries first; a hosted entry whose id is already taken is dropped and said (never two cards with one id).
  function mergeRemote(builtinList, hostedList) {
    const seen = new Set(builtinList.map(d => d.id)), out = builtinList.slice(), clashes = [];
    for (const d of hostedList) {
      if (seen.has(d.id)) { clashes.push('hosted entry "' + d.entryId + '" repeats the id of a built-in wallpaper and was skipped'); continue; }
      seen.add(d.id);
      out.push(d);
    }
    return { entries: out, clashes };
  }
  const mineItems = () => st().mine.map(m => Object.freeze({
    id: m.id, title: m.title, category: 'mine', source: 'mine', group: 'mine', kind: 'picture', author: 'You', licence: 'Your own picture', tags: ['mine'], dominant: m.dominant, light: m.light,
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

  // The lightest and darkest colours of a picture, its average colour and brightness, from a 1280 x 720 copy.
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
    // The extremes (single pixels and blur-sized cells), the average colour and brightness: the same maths the tests run.
    const s = P.summarisePixels(d, w, h);
    if (summaries.size > 120) summaries.delete(summaries.keys().next().value);
    summaries.set(key, s);
    return s;
  }

  // --- the online part: the switch, the guard in front of every request, tickets for progress and cancel

  const online = () => { try { return ls().getItem(ONLINE_KEY) !== 'false'; } catch (err) { throw new Error('Could not read the online wallpapers switch: ' + err.message); } };
  // Called before ANY request to a host. Throws (tagged, so the store can say it in the person's language) when there must be none.
  function guardNetwork() {
    if (!online()) throw new Error('[wp:off] Online wallpapers are switched off (Settings > Wallpapers), so nothing is loaded from the internet');
    if (root.navigator && root.navigator.onLine === false) throw new Error('[wp:offline] This computer is offline');
  }
  let ticketCount = 0;
  const newTicket = () => 'dl-' + Date.now().toString(36) + '-' + (++ticketCount);
  // Ids the cache must not evict: the wallpaper on now and the favourites.
  const protectIds = () => { const s = st(); return [...new Set([...(s.current ? [s.current.id] : []), ...s.fav])].slice(0, 600); };
  // Starts a download in main and reports bytes as they arrive: opts = { ticket, onProgress({ got, total }) }.
  async function download(url, kind, opts = {}) {
    const v = vexApi();
    guardNetwork();
    const ticket = opts.ticket || newTicket();
    const off = opts.onProgress && typeof v.onWallpaperProgress === 'function' ? v.onWallpaperProgress((p) => { if (p && p.ticket === ticket) opts.onProgress(p); }) : null;
    try { return await v.wallpaperDownload(url, kind, ticket); }
    finally { if (off) off(); }
  }

  // A listed photo's file, downloaded and shrunk once, then kept by the main process.
  async function ensureFull(d, opts = {}) {
    const v = vexApi();
    if (await v.wallpaperRead(d.id, 'full')) return;
    if (!d.fullUrl) throw new Error('This photo is not saved on this computer and its list is not loaded; open the Wallpaper Store online once to fetch it again');
    const got = await download(d.fullUrl, 'full', opts);
    const bytes = await shrink(new root.Blob([got.bytes], { type: got.mime }), { maxW: 2560 });
    await v.wallpaperSave(d.id, 'full', bytes, protectIds());
  }
  // Is this listed photo already on this computer? (A look at the folder, no picture is read.)
  async function isCached(id) {
    const s = await vexApi().wallpaperStats();
    return Array.isArray(s.cachedIds) && s.cachedIds.includes(id);
  }

  // -> { src, summary } where src is a data: URL the New Tab can paint. opts: { ticket, onProgress } for a photo not yet downloaded.
  async function sourceOf(d, opts) {
    if (d.source === 'generated') {
      const G = root.WallpaperGenerators;
      if (!G) throw new Error('js/wallpaper-generators.js is not loaded');
      const src = G.dataUrl(G.svg(d));
      return { src, summary: await summarise(src, d.id) };
    }
    if (d.source === 'catalogue') await ensureFull(d, opts);
    const r = await vexApi().wallpaperRead(d.id, d.source === 'mine' ? 'mine' : 'full');
    if (!r) throw new Error('"' + d.title + '" is not saved on this computer any more' + (d.source === 'mine' ? '' : '; open it in the Wallpaper Store to fetch it again'));
    return { src: r.dataUrl, summary: await summarise(r.dataUrl, d.id) };
  }

  // Previews are fetched a few at a time (a grid scrolled fast must not open hundreds of connections).
  let thumbRunning = 0;
  const thumbWaiting = [];
  function throttled(job) {
    return new Promise((resolve, reject) => {
      const run = () => {
        thumbRunning++;
        job().then(resolve, reject).finally(() => { thumbRunning--; const next = thumbWaiting.shift(); if (next) next(); });
      };
      if (thumbRunning < THUMB_CONCURRENCY) run(); else thumbWaiting.push(run);
    });
  }

  // A small picture for the grid. opts.stale(): true when the card has scrolled away while the preview waited its turn (then nothing is fetched).
  async function thumbOf(d, opts = {}) {
    if (d.source === 'generated') { const G = root.WallpaperGenerators; return G.dataUrl(G.svg(d)); }
    const v = vexApi();
    let r = await v.wallpaperRead(d.id, 'thumb');
    if (!r && d.source === 'catalogue' && d.thumbUrl) {
      guardNetwork();
      await throttled(async () => {
        if (typeof opts.stale === 'function' && opts.stale()) throw new Error('[wp:skipped] The card is no longer in view');
        guardNetwork();
        const got = await download(d.thumbUrl, 'thumb');
        await v.wallpaperSave(d.id, 'thumb', await shrink(new root.Blob([got.bytes], { type: got.mime }), { maxW: 480, cap: 280 * 1024 }), protectIds());
      });
      r = await v.wallpaperRead(d.id, 'thumb');
    }
    if (!r) throw new Error('No preview for ' + d.title);
    return r.dataUrl;
  }

  // A category's title: Turkish when Vex is in Turkish and the id is one we know, else the title the data file gives (English).
  function categoryTitle(id, fallback = id) {
    const lang = root.VexI18nUI && typeof root.VexI18nUI.locale === 'function' ? root.VexI18nUI.locale() : 'en';
    return lang === 'tr' && Object.prototype.hasOwnProperty.call(CATEGORY_TR, id) ? CATEGORY_TR[id] : fallback;
  }

  // --- the New Tab ----------------------------------------------------------------------------

  const enabled = () => { try { return ls().getItem(ON_KEY) !== 'false'; } catch (err) { throw new Error('Could not read the wallpaper switch: ' + err.message); } };

  async function buildSpec() {
    const cur = st().current;
    if (!cur || !enabled()) return null;
    const d = describe(cur.id);
    if (!d) throw new Error('The chosen wallpaper "' + cur.id + '" no longer exists');
    const { src, summary } = await sourceOf(d);
    return { id: d.id, src, lightest: summary.lightest, darkest: summary.darkest, plateLightest: summary.plateLightest, plateDarkest: summary.plateDarkest, mean: summary.mean, meanY: summary.meanY, dim: cur.dim, blur: cur.blur, auto: cur.auto };
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
    if (done) lastPaint = { alpha: done.alpha, required: done.required, readable: done.readable !== false, textOk: done.ok !== false, scheme: done.scheme, plate: done.plate };
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
    const p = P.plan({ summary, accent: P.pageColours().accent, dim: cur.dim, auto: cur.auto });
    return { alpha: p.shade, required: p.required, readable: p.ok, textOk: p.ok, shows: 1 - p.shade, scheme: p.scheme, plate: p.plateAlpha, fromPage: false };
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
    async apply(id, patch, opts) {
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
      await sourceOf(d, opts);
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
      remote = []; remoteInfo = null; remoteCats = [];
      emit();
    },
    // --- the online part (built-in catalogue + the hosted list)
    online,
    setOnline(on) {
      try { ls().setItem(ONLINE_KEY, on ? 'true' : 'false'); } catch (err) { throw new Error('Could not save the online wallpapers switch: ' + err.message); }
      if (!on) { remote = []; remoteInfo = null; remoteCats = []; }
      emit();
      return !!on;
    },
    // Reads the lists only when asked (the store calls it when it opens). The built-in list is a file inside Vex (no request);
    // the hosted list is one GET, only when an address is set. With the switch off nothing is read and nothing is requested.
    // Offline, the last good copy of the hosted list answers and says it is old. A failure of the hosted list is raised
    // AFTER the built-in entries are in place, so they stay usable.
    async loadCatalogue({ force = false } = {}) {
      const url = api.catalogueUrl();
      if (!online()) { remote = []; remoteInfo = null; remoteCats = []; return { entries: 0, configured: !!url, off: true }; }
      const v = vexApi();
      if (typeof v.wallpaperBuiltin !== 'function') throw new Error('The built-in wallpaper list is not available here');
      const b = await v.wallpaperBuiltin();
      const builtinList = b.entries.map(e => fromEntry(e, 'builtin'));
      remoteCats = Array.isArray(b.categories) ? b.categories : [];
      const problems = [...(b.problems || [])];
      remote = builtinList;
      remoteInfo = { name: b.name || '', updated: b.updated || '', fetchedAt: 0, stale: false, error: '', problems, builtin: builtinList.length, hosted: 0, hosts: b.hosts || [] };
      if (!url) return { entries: remote.length, configured: false, ...remoteInfo };
      const r = await v.wallpaperCatalogue(url, force);
      const merged = mergeRemote(builtinList, r.entries.map(e => fromEntry(e, 'hosted')));
      remote = merged.entries;
      remoteInfo = { ...remoteInfo, name: r.name || remoteInfo.name, updated: r.updated || remoteInfo.updated, fetchedAt: r.fetchedAt, stale: !!r.stale, error: r.error || '', problems: [...problems, ...(r.problems || []), ...merged.clashes], hosted: merged.entries.length - builtinList.length };
      return { entries: remote.length, configured: true, ...remoteInfo };
    },
    catalogueInfo: () => remoteInfo,
    // The online categories (from the built-in categories file) that have at least one wallpaper, with a title in the person's language.
    onlineCategories() {
      const have = new Set(remote.map(d => d.category));
      const known = remoteCats.filter(c => have.has(c.id)).map(c => ({ id: c.id, title: categoryTitle(c.id, c.title), blurb: c.blurb || '' }));
      const ids = new Set(known.map(c => c.id));
      const extra = [...have].filter(id => !ids.has(id) && !/^(mine|photos)$/.test(id) && !(root.WallpaperData && root.WallpaperData.CATEGORIES.some(c => c.id === id)))
        .map(id => ({ id, title: categoryTitle(id, id.replace(/-/g, ' ').replace(/^./, ch => ch.toUpperCase())), blurb: '' }));
      return [...known, ...extra];
    },
    categoryTitle,
    licenceName: (code) => LICENCE_NAMES[code] || code,
    isCached,
    newTicket,
    cancelDownload: (ticket) => vexApi().wallpaperCancel(ticket),
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
    ONLINE_KEY, LICENCE_NAMES, CATEGORY_TR, THUMB_CONCURRENCY,
    _logic: { normalize, toggleFav, pushRecent, search, groupOf, mergeRemote },
    _reset() { state = null; remote = []; remoteInfo = null; remoteCats = []; listeners.clear(); summaries.clear(); token = 0; thumbWaiting.length = 0; thumbRunning = 0; },
  };

  if (typeof window !== 'undefined') window.VexWallpapers = api; else root.VexWallpapers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexWallpapers: api, logic: { normalize, toggleFav, pushRecent, search, groupOf, mergeRemote } };
  if (root.document && typeof root.document.dispatchEvent === 'function') root.document.dispatchEvent(new root.Event('vex-wallpapers-ready'));
  // This file loads after start-up (js/lazy-boot.js): a New Tab that was already open (the first tab of a start) loaded before
  // there was anything to hand it, so it is handed the saved wallpaper now.
  if ((typeof WebviewManager !== 'undefined' || typeof root.WebviewManager !== 'undefined') && root.localStorage && root.localStorage.getItem(KEY)) {
    api.paintStartPages().catch(err => root.console.error('[wallpapers] the open New Tab could not be painted at start-up:', err && err.message));
  }
})(typeof window !== 'undefined' ? window : globalThis);
