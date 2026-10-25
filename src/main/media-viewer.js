'use strict';
// === Vex's own video and sound player: how a media file reaches it ================
//
// Chromium shows a video or a sound opened as a document in a bare player with stock controls that cannot be themed or given tools.
// Vex shows it with a page of its own instead (src/renderer/media-viewer).
//
// How a media document gets there:
//   * A web page whose RESPONSE says audio/* or video/* (a playable type, not an attachment) is caught in the session's
//     onHeadersReceived by the small registry in main/doc-viewers.js, and answered with a redirect to
//     vex-media://view/?u=<the file's address> . Only a MAIN frame of a tab or panel: a <video> inside a page is never touched,
//     and neither is a DRM or streaming site (those are never top-level media documents).
//   * A file: address is sent there by the window itself before it loads (js/webview.js viewerAddress); a file dragged onto a page
//     or a link to one is caught here at will-navigate (before the request starts, so nothing has to be cancelled).
//   * The page is served by this module (protocol.handle on every session the tabs use). The media itself is read through
//     vex-media://view/doc?u=... , which main answers with session.fetch of THE SAME SESSION the tab runs in: a file behind a login
//     uses the tab's own cookies, a private or Tor tab's media goes through that tab's own session and proxy, and nothing is ever
//     fetched through another session. Range requests are passed on, so seeking reads only the part asked for (never the whole
//     file into memory). A file: media is streamed from disk by range.
//   * The tab keeps the media's own address (js/webview.js maps the viewer address back before the address bar, history and
//     bookmarks see it). "Open in the browser's player" is not offered: the player is the whole point, and the Download and Open
//     with Windows buttons are on its error screen.
//
// The viewer page may use only what is served here (CSP: its own origin; no network of its own), and only a page on
// vex-media://view/ may call the mediaview:* channels below.

const nodeFs = require('fs');
const nodeOs = require('os');
const nodePath = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { fileURLToPath, pathToFileURL } = require('url');

const SCHEME = 'vex-media';
const HOST = 'view';
const ID = 'media';

// Media a Chromium <video>/<audio> can be asked to play, by extension (a file: address has no Content-Type).
const MEDIA_TYPES = Object.freeze({
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.wav': 'audio/wav', '.weba': 'audio/webm',
});
const SUBTITLE_TYPES = Object.freeze({ '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.ass': 'text/plain; charset=utf-8', '.ssa': 'text/plain; charset=utf-8' });
const OTHER_TYPES = Object.freeze({ '.m3u': 'text/plain; charset=utf-8' });
const SERVED_TYPES = Object.freeze({ ...MEDIA_TYPES, ...SUBTITLE_TYPES, ...OTHER_TYPES });
const MAX_SIBLINGS = 500;

// The Content-Types the player takes over. A list, not "anything audio/ or video/": a type Chromium cannot play at all is left to
// Chromium (it downloads it), and a streaming playlist (mpegurl, mp2t) is not a media file.
const PLAYABLE_TYPE = /^\s*(?:video\/(?:mp4|webm|ogg|x-matroska|quicktime|x-m4v|3gpp|3gpp2)|audio\/(?:mpeg|mp3|mp4|x-m4a|m4a|aac|aacp|flac|x-flac|ogg|opus|vorbis|wav|x-wav|wave|vnd\.wave|webm|x-matroska)|application\/ogg)\s*(?:;|$)/i;

const FILE_MEDIA_RE = /^file:\/\/[^?#]*\.(?:mp4|m4v|webm|mkv|mov|ogv|mp3|m4a|aac|flac|ogg|oga|opus|wav|weba)(?:[?#].*)?$/i;
const isMediaFileUrl = (url) => FILE_MEDIA_RE.test(String(url || ''));
const isPlayableType = (type) => PLAYABLE_TYPE.test(String(type || ''));

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
});

// The player page's policy: scripts from itself only, the media from itself (the doc route) or a blob (the cover), no network of its own.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// ---- addresses (the renderer keeps a twin of these two, js/webview.js; a test holds them equal) ----
function viewerUrl(original, hash) {
  const o = String(original || '');
  const at = o.indexOf('#');
  const base = at < 0 ? o : o.slice(0, at);
  const frag = hash != null && hash !== '' ? String(hash).replace(/^#/, '') : (at < 0 ? '' : o.slice(at + 1));
  return SCHEME + '://' + HOST + '/?u=' + encodeURIComponent(base) + (frag ? '#' + frag : '');
}
// -> { original, hash } or null
function parseViewerUrl(url) {
  const s = String(url || '');
  if (!s.toLowerCase().startsWith(SCHEME + '://' + HOST + '/')) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.pathname !== '/') return null;           // the player page itself; /doc and the files it loads are not it
  const original = u.searchParams.get('u');
  if (!original) return null;
  return { original, hash: u.hash ? u.hash.slice(1) : '' };
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return { invalid: true };
  return { start, end };
}

const extOf = (name) => nodePath.extname(String(name || '')).toLowerCase();
const stemOf = (name) => nodePath.basename(String(name || ''), nodePath.extname(String(name || '')));
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// deps: { rendererDir, docViewers, isEnabled(), look() -> { theme, guiStyle, lang }, owner(contents) -> truthy for a Vex window's page, fs? }
function createMediaViewer(deps) {
  const fs = deps.fs || nodeFs;
  const rendererDir = deps.rendererDir;
  if (!rendererDir) throw new Error('createMediaViewer needs rendererDir');
  if (!deps.docViewers) throw new Error('createMediaViewer needs docViewers');
  const isEnabled = deps.isEnabled || (() => true);
  const roots = {
    app: nodePath.join(rendererDir, 'media-viewer'),
    css: nodePath.join(rendererDir, 'css'),
    fonts: nodePath.join(rendererDir, 'fonts'),
  };
  const wired = new WeakSet();
  const docViewers = deps.docViewers;

  function isGuest(wc) {
    try { return !!wc && !wc.isDestroyed() && wc.getType() === 'webview' && !!deps.owner(wc); } catch { return false; }
  }

  docViewers.register({
    id: ID,
    enabled: isEnabled,
    match: (url, type) => isPlayableType(type),
    // The #t=30 the person typed or followed is not part of the request: the registry finds it in the tab's own pending address.
    page: (url, fragment) => viewerUrl(url, fragment),
  });

  // A file: media address navigating inside a Vex tab (a file dropped on the page, a link to one): sent to the player before the
  // request starts. true = the navigation was taken over.
  function takeFile(contents, url) {
    if (!isEnabled() || !isMediaFileUrl(url) || !isGuest(contents)) return false;
    if (docViewers.consumeBypass(ID, contents.id, url)) return false;
    Promise.resolve(contents.loadURL(viewerUrl(url))).catch((err) => {
      if (!/ERR_ABORTED|\(-3\)/.test(String(err && err.message))) console.warn('[Media viewer] the player could not be opened for', url, '-', err && err.message);
    });
    return true;
  }

  // ---- the protocol ---------------------------------------------------------
  function secureHeaders(type, extra) {
    return { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache', ...(extra || {}) };
  }

  function servePage(persistent) {
    const file = nodePath.join(roots.app, 'viewer.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch (err) { return new Response('The player page is missing: ' + err.message, { status: 500 }); }
    const look = deps.look ? deps.look() : { theme: 'oxford', guiStyle: 'classic', lang: 'en' };
    const safe = (v, re, d) => (typeof v === 'string' && re.test(v) ? v : d);
    const theme = safe(look.theme, /^[a-z]+(?:-[a-z]+)*$/, 'oxford'), gui = safe(look.guiStyle, /^[a-z0-9-]+$/, 'classic'), lang = safe(look.lang, /^[a-z]{2}$/, 'en');
    html = html.replace('<html lang="en">', '<html lang="' + lang + '" data-theme="' + theme + '" data-gui-style="' + gui + '">')
      .replace('<meta name="vex-persist" content="0">', '<meta name="vex-persist" content="' + (persistent ? '1' : '0') + '">');
    return new Response(html, { headers: secureHeaders(MIME['.html'], { 'cache-control': 'no-store' }) });
  }

  function serveStatic(pathname) {
    if (pathname === '/icons.js') {
      let data;
      try { data = fs.readFileSync(nodePath.join(rendererDir, 'js', 'vex-icons.js')); } catch { return new Response('Not found', { status: 404 }); }
      return new Response(data, { headers: secureHeaders(MIME['.js']) });
    }
    const m = /^\/(app|css|fonts)\/(.+)$/.exec(pathname);
    if (!m) return new Response('Not found', { status: 404 });
    let rel;
    try { rel = decodeURIComponent(m[2]); } catch { return new Response('Bad address', { status: 400 }); }
    const root = roots[m[1]];
    const full = nodePath.resolve(root, rel);
    if (full !== root && !full.startsWith(root + nodePath.sep)) return new Response('Not found', { status: 404 });
    const type = MIME[nodePath.extname(full).toLowerCase()];
    if (!type) return new Response('Not found', { status: 404 });
    let data;
    try { data = fs.readFileSync(full); } catch { return new Response('Not found', { status: 404 }); }
    return new Response(data, { headers: secureHeaders(type) });
  }

  async function serveDocument(ses, original, request) {
    if (/^file:/i.test(original)) return serveFile(original, request);
    if (!/^https?:\/\//i.test(original)) return new Response('Only web and file addresses can be played here', { status: 400 });
    const headers = { accept: 'audio/*,video/*;q=0.9,*/*;q=0.5' };
    const range = request.headers.get('range');
    if (range) headers.range = range;
    let upstream;
    try {
      upstream = await ses.fetch(original, { headers, redirect: 'follow', credentials: 'include', cache: 'default' });
    } catch (err) {
      return new Response('The media could not be fetched: ' + err.message, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-vex-error': 'fetch' } });
    }
    const out = { 'cache-control': 'private, max-age=0' };
    for (const name of ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = upstream.headers.get(name);
      if (v) out[name] = v;
    }
    // A body the network stack already decompressed no longer has the length the server named.
    if (!upstream.headers.get('content-encoding')) { const len = upstream.headers.get('content-length'); if (len) out['content-length'] = len; }
    out['x-vex-upstream-status'] = String(upstream.status);
    return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
  }

  function serveFile(original, request) {
    let file;
    try { file = fileURLToPath(original.replace(/[?#].*$/, '')); } catch { return new Response('Bad file address', { status: 400 }); }
    const type = SERVED_TYPES[extOf(file)];
    if (!type) return new Response('That kind of file is not played here', { status: 415 });
    let stat;
    try { stat = fs.statSync(file); } catch { return new Response('That file is not there', { status: 404, headers: { 'x-vex-error': 'missing' } }); }
    if (!stat.isFile()) return new Response('That is not a file', { status: 404 });
    const range = parseRange(request.headers.get('range'), stat.size);
    const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'last-modified': new Date(stat.mtimeMs).toUTCString() };
    if (range && range.invalid) return new Response(null, { status: 416, headers: { ...base, 'content-range': 'bytes */' + stat.size } });
    if (stat.size === 0) return new Response(null, { status: 200, headers: { ...base, 'content-length': '0' } });
    if (range) {
      const body = Readable.toWeb(fs.createReadStream(file, { start: range.start, end: range.end }));
      return new Response(body, { status: 206, headers: { ...base, 'content-length': String(range.end - range.start + 1), 'content-range': 'bytes ' + range.start + '-' + range.end + '/' + stat.size } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'content-length': String(stat.size) } });
  }

  // The handler for one session. `persistent` says whether the tab's storage outlives it (what the player may remember).
  function makeHandler(ses, persistent) {
    return async (request) => {
      let url;
      try { url = new URL(request.url); } catch { return new Response('Bad address', { status: 400 }); }
      if (url.hostname !== HOST) return new Response('Not found', { status: 404 });
      if (url.pathname === '/' || url.pathname === '/index.html') return servePage(persistent);
      if (url.pathname === '/doc') {
        const original = url.searchParams.get('u');
        if (!original) return new Response('No media named', { status: 400 });
        return serveDocument(ses, original, request);
      }
      return serveStatic(url.pathname);
    };
  }

  // partition: the tab's partition string. A private page (no persist: prefix), a Tor session and the Tor route never keep anything.
  function wireSession(ses, partition) {
    if (!ses || !ses.protocol || wired.has(ses)) return;
    wired.add(ses);
    const persistent = typeof partition === 'string' && partition.startsWith('persist:') && partition !== 'persist:route-tor' && !ses.__vexTor;
    ses.protocol.handle(SCHEME, makeHandler(ses, persistent));
  }

  return { SCHEME, HOST, ID, wireSession, takeFile, makeHandler, roots, isGuest, allowOnce: (wcId, url) => docViewers.allowOnce(ID, wcId, url) };
}

// ---- what the player asks main to do (every channel checks that the asker is the player page) -----------------
function viewerSource(event) {
  const frame = event && event.senderFrame;
  const parsed = parseViewerUrl(frame && frame.url);
  if (!parsed || (frame.parent != null)) throw new Error('Only the player may ask for this');
  return parsed;
}

function safeName(name, fallback) {
  const n = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120);
  return n || fallback;
}

// opts: { ipcMain, viewer, shell, fsImpl?, tempDir?() }
function registerMediaViewerIpc(opts) {
  const { ipcMain, viewer, shell } = opts;
  const fsImpl = opts.fsImpl || nodeFs;
  if (!ipcMain || !viewer || !shell) throw new Error('registerMediaViewerIpc needs ipcMain, viewer and shell');
  const tempDir = opts.tempDir || (() => nodePath.join(nodeOs.tmpdir(), 'vex-media'));

  const isFile = (original) => /^file:/i.test(original);
  const filePathOf = (original) => fileURLToPath(original.replace(/[?#].*$/, ''));

  // The other media in the folder of a file (the queue), and subtitle files that share its name.
  ipcMain.handle('mediaview:siblings', async (event) => {
    try {
      const src = viewerSource(event);
      if (!isFile(src.original)) return { ok: true, items: [], subs: [] };
      const file = filePathOf(src.original);
      const dir = nodePath.dirname(file);
      const names = await fsImpl.promises.readdir(dir);
      const stem = stemOf(file).toLowerCase();
      const items = [], subs = [];
      for (const name of names) {
        const ext = extOf(name);
        if (MEDIA_TYPES[ext]) items.push({ name, ext });
        else if (SUBTITLE_TYPES[ext] && stemOf(name).toLowerCase().startsWith(stem)) subs.push({ name, ext });
      }
      items.sort((a, b) => collator.compare(a.name, b.name));
      subs.sort((a, b) => collator.compare(a.name, b.name));
      const url = (n) => pathToFileURL(nodePath.join(dir, n)).href;
      return {
        ok: true, truncated: items.length > MAX_SIBLINGS,
        items: items.slice(0, MAX_SIBLINGS).map((i) => ({ name: i.name, url: url(i.name), ext: i.ext })),
        subs: subs.slice(0, 20).map((s) => ({ name: s.name, url: url(s.name), ext: s.ext })),
      };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // A web file goes through the tab's own session (so the downloads panel, its scan and the tab's cookies all apply as for any
  // download); a file on this computer is shown in its folder instead.
  ipcMain.handle('mediaview:download', async (event) => {
    try {
      const src = viewerSource(event);
      if (isFile(src.original)) { shell.showItemInFolder(filePathOf(src.original)); return { ok: true, revealed: true }; }
      viewer.allowOnce(event.sender.id, src.original);
      event.sender.downloadURL(src.original);
      return { ok: true, viaDownloads: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // "Open with Windows": the program Windows has for this kind of file. A web file is first written to a temp folder, read through
  // the tab's own session.
  ipcMain.handle('mediaview:open-external', async (event) => {
    try {
      const src = viewerSource(event);
      let target;
      if (isFile(src.original)) target = filePathOf(src.original);
      else {
        if (!/^https?:\/\//i.test(src.original)) throw new Error('Only web and file addresses can be opened');
        const response = await event.sender.session.fetch(src.original, { redirect: 'follow', credentials: 'include' });
        if (!response.ok) throw new Error('The server answered ' + response.status + ' when Vex fetched the file again');
        let base = '';
        try { base = decodeURIComponent(nodePath.basename(new URL(src.original).pathname)); } catch { base = ''; }
        base = safeName(base, 'media');
        if (!extOf(base)) {
          const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          const ext = Object.keys(MEDIA_TYPES).find((e) => MEDIA_TYPES[e] === type);
          base += ext || '';
        }
        const dir = tempDir();
        await fsImpl.promises.mkdir(dir, { recursive: true });
        target = nodePath.join(dir, base);
        await pipeline(Readable.fromWeb(response.body), fsImpl.createWriteStream(target));
      }
      const failed = await shell.openPath(target);
      if (failed) throw new Error(failed);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('mediaview:reveal', async (event) => {
    try {
      const src = viewerSource(event);
      if (!isFile(src.original)) throw new Error('Only a file on this computer can be shown in its folder');
      shell.showItemInFolder(filePathOf(src.original));
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = {
  createMediaViewer, registerMediaViewerIpc, viewerUrl, parseViewerUrl, isMediaFileUrl, isPlayableType, parseRange,
  SCHEME, HOST, ID, CSP, MIME, MEDIA_TYPES, SUBTITLE_TYPES, SERVED_TYPES, MAX_SIBLINGS,
};
