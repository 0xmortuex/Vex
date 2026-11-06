// === The Wallpaper Store's files and its one optional network call =============
//
// Wallpapers that Vex draws itself need nothing from here. What lives here:
//
//   <userData>/wallpapers/thumb/<id>.<ext>   small previews of listed photos   (cache, may be evicted)
//   <userData>/wallpapers/full/<id>.<ext>    the listed photos, already shrunk  (cache, may be evicted)
//   <userData>/wallpapers/mine/<id>.<ext>    pictures the person chose himself  (kept until he removes them)
//   <userData>/wallpapers/catalogue.json     the last good copy of the hosted list
//
// The window shrinks every picture before it is saved (at most 2560 px wide, JPEG),
// so a file is a few hundred KB and nothing big is ever decoded and kept.
// Caps: a preview 300 KB, a full picture 3 MB, the cache 80 MB in all (oldest used
// first out), 24 pictures of his own. Going over the last one is an error he sees.
//
// The network: ONLY the hosted list (one GET of at most 1 MB) and the pictures that
// list names, and only when the person has opened the store and chosen to look. The
// address is set in Settings; empty means nothing is ever fetched. Requests go through
// the public-only fetch (https, no cookies, every redirect checked, no private
// addresses). A picture is only downloaded if its address is in the list that was
// fetched, so the window cannot use this as a general downloader.

const { validateCatalogue, httpsUrl } = require('./wallpaper-catalogue');
const { loadBuiltin, hostAllowed } = require('./wallpaper-builtin');

const KINDS = ['thumb', 'full', 'mine'];
const CAPS = { thumb: 300 * 1024, full: 3 * 1024 * 1024, mine: 3 * 1024 * 1024 };
const DOWNLOAD_CAPS = { thumb: 2 * 1024 * 1024, full: 12 * 1024 * 1024 };
const CACHE_MAX_BYTES = 80 * 1024 * 1024;
const MINE_MAX_FILES = 24;
const CATALOGUE_MAX_BYTES = 1024 * 1024;
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

// The first bytes -> { mime, ext } or null.
function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return null;
}
const MIME_OF = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

// A failure the window shows in the person's language: "[wp:<code>] English text". Only the message crosses the IPC boundary.
const STREAM_IDLE_MS = 20000, STREAM_TOTAL_MS = 240000, PROGRESS_EVERY_MS = 120;
const tagged = (code, text) => new Error('[wp:' + code + '] ' + text);

// builtin:     () => the loaded built-in catalogue (main/wallpaper-builtin.js), or absent
// streamFetch: the public-only fetch WITHOUT size limits (a stream); a picture from the built-in catalogue is read through it
function createWallpaperStore({ dir, fs, path, fetch, streamFetch, builtin, now = Date.now, cacheMax = CACHE_MAX_BYTES }) {
  if (!dir || !fs || !path) throw new Error('createWallpaperStore needs a folder, fs and path');
  const running = new Map();     // ticket -> AbortController of a download the window may cancel
  const kindDir = (kind) => path.join(dir, kind);
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const checkId = (id) => need(typeof id === 'string' && ID_RE.test(id), 'That is not a wallpaper id');
  const checkKind = (kind) => need(KINDS.includes(kind), 'Unknown wallpaper file kind: ' + kind);

  function filesOf(kind) {
    let names;
    try { names = fs.readdirSync(kindDir(kind)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return names.filter(n => /\.(png|jpg|webp)$/.test(n)).map((n) => {
      const st = fs.statSync(path.join(kindDir(kind), n));
      return { kind, id: n.replace(/\.[a-z]+$/, ''), name: n, file: path.join(kindDir(kind), n), bytes: st.size, mtime: st.mtimeMs };
    });
  }
  const dropFiles = (kind, id) => { for (const f of filesOf(kind)) if (f.id === id) fs.unlinkSync(f.file); };

  // Least recently used out first (a read touches the file). Never the file just written, and never a
  // picture whose id is in `protect` (the wallpaper on now and the favourites, which the window names).
  // "mine" is another folder and is never part of the cache.
  function evict(keepFile, protect) {
    const all = [...filesOf('thumb'), ...filesOf('full')].sort((a, b) => a.mtime - b.mtime);
    let total = all.reduce((s, f) => s + f.bytes, 0);
    for (const f of all) {
      if (total <= cacheMax) break;
      if (f.file === keepFile || (protect && protect.has(f.id))) continue;
      fs.unlinkSync(f.file);
      total -= f.bytes;
    }
  }

  function save(id, kind, bytes, protectIds) {
    checkId(id); checkKind(kind);
    need(protectIds == null || (Array.isArray(protectIds) && protectIds.every(x => typeof x === 'string')), 'The list of pictures to keep must be a list of ids');
    need(bytes && typeof bytes.byteLength === 'number', 'No picture data was given');
    const buf = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    need(buf.length <= CAPS[kind], 'That picture is too big to keep (' + Math.ceil(buf.length / 1024) + ' KB; ' + Math.round(CAPS[kind] / 1024) + ' KB at most)');
    const type = sniff(buf);
    need(type, 'Wallpapers can be PNG, JPEG or WebP pictures');
    if (kind === 'mine') {
      const mine = filesOf('mine');
      need(mine.some(f => f.id === id) || mine.length < MINE_MAX_FILES, 'You can keep ' + MINE_MAX_FILES + ' pictures of your own; remove one first');
    }
    fs.mkdirSync(kindDir(kind), { recursive: true });
    dropFiles(kind, id);
    const file = path.join(kindDir(kind), id + '.' + type.ext);
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
    } catch (err) {
      // No half file is left behind: the temporary one goes, then the real reason is raised.
      try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      throw err;
    }
    if (kind !== 'mine') evict(file, new Set(protectIds || []));
    return { ok: true, bytes: buf.length };
  }

  function read(id, kind) {
    checkId(id); checkKind(kind);
    const f = filesOf(kind).find(x => x.id === id);
    if (!f) return null;
    const buf = fs.readFileSync(f.file);
    const t = new Date();
    fs.utimesSync(f.file, t, t);          // used now: last to be evicted
    return { dataUrl: 'data:' + MIME_OF[f.name.split('.').pop()] + ';base64,' + buf.toString('base64'), bytes: buf.length };
  }

  function remove(id, kind) {
    checkId(id);
    const kinds = kind ? (checkKind(kind), [kind]) : KINDS;
    for (const k of kinds) dropFiles(k, id);
    return { ok: true };
  }

  function stats() {
    const cache = [...filesOf('thumb'), ...filesOf('full')], mine = filesOf('mine');
    const c = readCatalogueFile();
    return {
      cacheFiles: cache.length, cacheBytes: cache.reduce((s, f) => s + f.bytes, 0), cacheMax,
      mineFiles: mine.length, mineBytes: mine.reduce((s, f) => s + f.bytes, 0), mineMax: MINE_MAX_FILES,
      mineIds: mine.map(f => f.id), cachedIds: [...new Set(filesOf('full').map(f => f.id))],
      catalogue: c ? { url: c.url, fetchedAt: c.fetchedAt, count: c.doc.entries.length } : null,
    };
  }

  function clearCache() {
    let freed = 0;
    for (const f of [...filesOf('thumb'), ...filesOf('full')]) { fs.unlinkSync(f.file); freed += f.bytes; }
    try { fs.unlinkSync(path.join(dir, 'catalogue.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { ok: true, freed };
  }

  // --- the hosted list -----------------------------------------------------------

  function readCatalogueFile() {
    let text;
    try { text = fs.readFileSync(path.join(dir, 'catalogue.json'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const c = JSON.parse(text);
    // Checked again on the way out: a file in the folder is not trusted either.
    return { url: c.url, fetchedAt: c.fetchedAt, doc: { ...validateCatalogue({ schema: 1, name: c.doc.name, entries: c.doc.entries }), updated: c.doc.updated || '' } };
  }

  const shape = (c, extra) => ({ name: c.doc.name, updated: c.doc.updated, entries: c.doc.entries, problems: c.doc.problems, fetchedAt: c.fetchedAt, ...extra });

  async function catalogue(url, force) {
    need(httpsUrl(url), 'The wallpaper list address must be an https address (set it in Settings > Wallpapers)');
    need(typeof fetch === 'function', 'This build cannot fetch a wallpaper list');
    const cached = readCatalogueFile();
    const same = cached && cached.url === url;
    if (same && !force && now() - cached.fetchedAt < CATALOGUE_TTL_MS) return shape(cached, { cached: true });
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit', timeoutMs: 15000, maxBytes: CATALOGUE_MAX_BYTES, egress: { feature: 'Wallpaper store', kind: 'fetch' } });
      need(res.ok, 'The wallpaper list server answered ' + res.status);
      let doc;
      try { doc = JSON.parse(await res.text()); } catch (e) { throw new Error('The wallpaper list is not valid JSON: ' + e.message, { cause: e }); }
      const v = validateCatalogue(doc);
      fs.mkdirSync(dir, { recursive: true });
      const out = { url, fetchedAt: now(), doc: v };
      const tmp = path.join(dir, 'catalogue.json.tmp');
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, path.join(dir, 'catalogue.json'));
      return shape(out, { cached: false });
    } catch (err) {
      // Offline, or the host is down: the last good copy of THIS list still works, and the window is told it is old.
      if (same) return shape(cached, { cached: true, stale: true, error: err.message });
      throw err;
    }
  }

  // --- the built-in catalogue ------------------------------------------------------------

  const builtinData = () => (typeof builtin === 'function' ? builtin() : null);

  // A picture of the built-in catalogue, read as a stream: only from a listed host (every redirect checked too),
  // at most DOWNLOAD_CAPS[kind] bytes (counted while it arrives; the transfer is stopped the moment it is over),
  // only an image. Nothing is written here: the window shrinks it and saves it (save() is atomic), so a failed
  // or cancelled download leaves no file at all.
  async function downloadListed(url, kind, hosts, { ticket, onProgress } = {}) {
    const cap = DOWNLOAD_CAPS[kind];
    need(typeof streamFetch === 'function', 'This build cannot download wallpapers');
    const hostOk = (u) => { if (!hostAllowed(u.href, hosts)) throw tagged('host', 'Vex only loads wallpapers from the hosts on its own list; ' + u.hostname + ' is not one of them'); };
    hostOk(new URL(url));
    const ctrl = new AbortController();
    let why = null;                          // why we stopped it ourselves: 'cancel' | 'big' | 'idle' | 'slow'
    const stop = (reason) => { if (!why) { why = reason; ctrl.abort(); } };
    if (ticket) running.set(ticket, { cancel: () => stop('cancel') });
    let idle = setTimeout(() => stop('idle'), STREAM_IDLE_MS);
    const total = setTimeout(() => stop('slow'), STREAM_TOTAL_MS);
    const host = new URL(url).hostname;
    try {
      let res;
      try {
        res = await streamFetch(url, { headers: { Accept: 'image/*' }, credentials: 'omit', signal: ctrl.signal, checkUrl: hostOk, egress: { feature: 'Wallpaper store', kind: 'fetch' } });
      } catch (err) {
        if (why === 'cancel') throw tagged('cancelled', 'Download cancelled');
        if (why) throw tagged('unreachable', host + ' did not answer in time');
        if (/^\[wp:/.test(err.message)) throw err;
        throw tagged('unreachable', host + ' could not be reached (' + err.message + ')');
      }
      if (!res.ok) { try { await res.body?.cancel(); } catch (e) { console.error('[wallpaper-store] closing a refused download failed:', e.message); } throw tagged('http', host + ' answered ' + res.status); }
      const type = res.headers.get('content-type') || '';
      if (!/^image\//i.test(type)) { try { await res.body?.cancel(); } catch (e) { console.error('[wallpaper-store] closing a wrong-type download failed:', e.message); } throw tagged('not-image', 'The address did not give a picture (' + (type || 'no content type') + ')'); }
      const length = Number(res.headers.get('content-length')) || 0;
      if (length > cap) { stop('big'); try { await res.body?.cancel(); } catch (e) { console.error('[wallpaper-store] closing an oversize download failed:', e.message); } throw tagged('too-large', 'The picture is ' + (length / 1048576).toFixed(1) + ' MB; ' + Math.round(cap / 1048576) + ' MB at most'); }
      if (!res.body) throw tagged('not-image', 'The address gave an empty answer');
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0, lastTell = 0;
      const tell = (force) => { const t = now(); if (onProgress && (force || t - lastTell >= PROGRESS_EVERY_MS)) { lastTell = t; onProgress({ got, total: length }); } };
      for (;;) {
        let part;
        try { part = await reader.read(); }
        catch (err) {
          if (why === 'cancel') throw tagged('cancelled', 'Download cancelled');
          if (why) throw tagged('unreachable', host + ' stopped answering');
          throw tagged('unreachable', host + ' dropped the connection (' + err.message + ')');
        }
        // Stopped (cancelled, or no data for too long) while a piece was on its way: that piece is not used.
        if (why === 'cancel') { try { await reader.cancel(); } catch (e) { console.error('[wallpaper-store] closing a cancelled download failed:', e.message); } throw tagged('cancelled', 'Download cancelled'); }
        if (why) throw tagged('unreachable', host + ' stopped answering');
        if (part.done) break;
        got += part.value.byteLength;
        if (got > cap) {
          stop('big');
          try { await reader.cancel(); } catch (e) { console.error('[wallpaper-store] closing an oversize download failed:', e.message); }
          throw tagged('too-large', 'The picture is more than ' + Math.round(cap / 1048576) + ' MB');
        }
        chunks.push(part.value);
        clearTimeout(idle); idle = setTimeout(() => stop('idle'), STREAM_IDLE_MS);
        tell(false);
      }
      tell(true);
      const buf = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
      const sniffed = sniff(buf);
      if (!sniffed) throw tagged('not-image', 'That address did not give a PNG, JPEG or WebP picture');
      return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), mime: sniffed.mime };
    } finally {
      clearTimeout(idle); clearTimeout(total);
      if (ticket) running.delete(ticket);
    }
  }

  function cancel(ticket) {
    need(typeof ticket === 'string' && ticket, 'No download was named');
    const r = running.get(ticket);
    if (r) r.cancel();
    return { ok: true, running: !!r };
  }

  // What the store shows without any network: the built-in entries, their categories and the host list.
  function builtinList() {
    const b = builtinData();
    if (!b) return { name: '', updated: '', entries: [], categories: [], hosts: [], problems: [], present: { catalogue: false, categories: false, hosts: false } };
    return b;
  }

  async function download(url, kind, opts = {}) {
    need(kind === 'thumb' || kind === 'full', 'Only previews and full pictures are downloaded');
    need(httpsUrl(url), 'A picture must come from an https address');
    const b = builtinData();
    if (b && b.entries.some(e => e.thumbUrl === url || e.fullUrl === url)) return downloadListed(url, kind, b.hosts, opts);
    const c = readCatalogueFile();
    need(c && c.doc.entries.some(e => e.thumbUrl === url || e.fullUrl === url), 'That address is not in the wallpaper list');
    const res = await fetch(url, { headers: { Accept: 'image/*' }, credentials: 'omit', timeoutMs: 30000, maxBytes: DOWNLOAD_CAPS[kind], egress: { feature: 'Wallpaper store', kind: 'fetch' } });
    need(res.ok, 'The picture server answered ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = sniff(buf);
    need(type, 'That address did not give a PNG, JPEG or WebP picture');
    return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), mime: type.mime };
  }

  return { save, read, remove, stats, clearCache, catalogue, download, cancel, builtinList, sniff };
}

// The IPC side. `dir` is <userData>/wallpapers.
function registerWallpaperStore({ ipcMain, dir, fs, path, fetch, streamFetch, dataDir }) {
  let loaded = null;
  // Read once, on first use. A damaged file throws every time it is asked for (and is shown), never a half list.
  const builtin = () => (dataDir ? (loaded || (loaded = loadBuiltin({ fs, path, dir: dataDir }))) : null);
  const store = createWallpaperStore({ dir, fs, path, fetch, streamFetch, builtin });
  ipcMain.handle('wallpaper:catalogue', (_e, url, force) => store.catalogue(url, !!force));
  ipcMain.handle('wallpaper:builtin', () => store.builtinList());
  // A ticket (made by the window) lets it show progress and cancel: the bytes counted so far are sent back as they arrive.
  ipcMain.handle('wallpaper:download', (e, url, kind, ticket) => store.download(url, kind, {
    ticket,
    onProgress: ticket ? (p) => { if (!e.sender.isDestroyed()) e.sender.send('wallpaper:progress', { ticket, ...p }); } : undefined,
  }));
  ipcMain.handle('wallpaper:cancel', (_e, ticket) => store.cancel(ticket));
  ipcMain.handle('wallpaper:save', (_e, id, kind, bytes, protect) => store.save(id, kind, bytes, protect));
  ipcMain.handle('wallpaper:read', (_e, id, kind) => store.read(id, kind));
  ipcMain.handle('wallpaper:remove', (_e, id, kind) => store.remove(id, kind));
  ipcMain.handle('wallpaper:stats', () => store.stats());
  ipcMain.handle('wallpaper:clear-cache', () => store.clearCache());
  return store;
}

module.exports = { createWallpaperStore, registerWallpaperStore, sniff, CAPS, CACHE_MAX_BYTES, MINE_MAX_FILES };
