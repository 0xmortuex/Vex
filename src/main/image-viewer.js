'use strict';
// === Vex's own image viewer: how a picture reaches it ===============================
//
// Chromium shows a picture opened on its own as a bare image on a dark page: no fit/actual-size switch worth the name, no
// rotate, no information, no way to see the next picture. Vex shows it with a page of its own instead (src/renderer/image-viewer).
//
// How a picture gets there (the catch itself is the shared registry, main/doc-viewers.js; this file is the image's entry in it):
//   * A web page whose RESPONSE says image/png, jpeg, gif, webp, avif, bmp, x-icon or svg+xml (by Content-Type, not the file
//     name) and which is the MAIN frame of a tab is turned into a redirect to  vex-image://view/?u=<the picture's address> .
//     An <img> inside a page, a sub-frame, a page that merely contains a picture, a download (attachment) and a POST are never
//     touched.
//   * A file: picture is sent there by the window itself before it loads (js/webview.js imageViewerAddress), and a link click
//     to one inside a page is turned around by will-navigate below.
//   * The viewer page is served by this module (protocol.handle on every session). The picture is fetched through
//     vex-image://view/doc?u=...  , which main answers with session.fetch of THE SAME SESSION the tab runs in: a picture behind
//     a login uses the tab's own cookies, and a private or Tor tab's picture goes through that tab's own session (and proxy).
//     Nothing is ever fetched through another session.
//   * The tab keeps showing the picture's own address: js/webview.js maps the viewer address back to  u  before the address bar,
//     history and bookmarks see it, so Back, Reload and bookmarks all keep the original.
//   * "Open in the browser's own view" marks one navigation as not to be caught (docViewers.allowOnce).
//
// The viewer page may use only what is served here (CSP: its own origin; no network of its own), and only a page on
// vex-image://view/ may call the imageview:* channels below. Nothing about a picture, its EXIF or its place leaves the computer.

const nodeFs = require('fs');
const nodePath = require('path');
const { Readable } = require('stream');
const { fileURLToPath, pathToFileURL } = require('url');

const SCHEME = 'vex-image';
const HOST = 'view';
const ID = 'image';

const IMAGE_TYPE = /^\s*image\/(?:png|apng|jpe?g|pjpeg|gif|webp|avif|bmp|x-ms-bmp|x-icon|x-ico|vnd\.microsoft\.icon|svg\+xml)\b/i;
const IMAGE_EXT = /\.(?:png|apng|jpe?g|jpe|jfif|gif|webp|avif|bmp|ico|svg)$/i;
const EXT_TYPE = Object.freeze({
  '.png': 'image/png', '.apng': 'image/apng', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.jfif': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
});
const SIBLING_LIMIT = 3000;
const SAVE_LIMIT = 64 * 1024 * 1024;     // the most one saved copy may hold (the IPC's own binary limit)

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff',
});

// The page's policy: scripts from itself only, pictures from itself and blobs, and it reaches nothing but itself.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "media-src 'none'",
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
  if (u.pathname !== '/') return null;           // the viewer page itself; /doc and the files it loads are not it
  const original = u.searchParams.get('u');
  if (!original) return null;
  return { original, hash: u.hash ? u.hash.slice(1) : '' };
}
const isImageFileUrl = (url) => /^file:\/\/[^?#]*\.(?:png|apng|jpe?g|jpe|jfif|gif|webp|avif|bmp|ico|svg)(?:[?#].*)?$/i.test(String(url || ''));
const isImageSource = (url) => /^https?:\/\//i.test(String(url || '')) || isImageFileUrl(url);
const isImageType = (type) => IMAGE_TYPE.test(String(type || ''));

function naturalCompare(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

// deps: { rendererDir, fs?, docViewers, isEnabled(), look() -> { theme, guiStyle, lang }, log? }
function createImageViewer(deps) {
  const fs = deps.fs || nodeFs;
  const rendererDir = deps.rendererDir;
  if (!rendererDir) throw new Error('createImageViewer needs rendererDir');
  if (!deps.docViewers) throw new Error('createImageViewer needs docViewers');
  const isEnabled = deps.isEnabled || (() => true);
  const roots = {
    app: nodePath.join(rendererDir, 'image-viewer'),
    css: nodePath.join(rendererDir, 'css'),
    fonts: nodePath.join(rendererDir, 'fonts'),
  };

  function secureHeaders(type, extra) {
    return { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache', ...(extra || {}) };
  }

  function servePage(persistent) {
    const file = nodePath.join(roots.app, 'viewer.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch (err) { return new Response('The image viewer page is missing: ' + err.message, { status: 500 }); }
    const look = deps.look ? deps.look() : { theme: 'oxford', guiStyle: 'classic', lang: 'en' };
    const safe = (v, re, d) => (typeof v === 'string' && re.test(v) ? v : d);
    const theme = safe(look.theme, /^[a-z]+(?:-[a-z]+)*$/, 'oxford'), gui = safe(look.guiStyle, /^[a-z0-9-]+$/, 'classic'), lang = safe(look.lang, /^[a-z]{2}$/, 'en');
    html = html.replace('<html lang="en">', '<html lang="' + lang + '" data-theme="' + theme + '" data-gui-style="' + gui + '">')
      .replace('<meta name="vex-persist" content="0">', '<meta name="vex-persist" content="' + (persistent ? '1' : '0') + '">');
    return new Response(html, { headers: secureHeaders(MIME['.html'], { 'cache-control': 'no-store' }) });
  }

  function serveStatic(pathname) {
    // The interface's own icon set, the one file of js/ the viewer shares (so its icons are drawn exactly as the window's are).
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

  function failure(status, message, kind) {
    return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-vex-error': kind, 'cache-control': 'no-store' } });
  }

  async function serveDocument(ses, original) {
    if (isImageFileUrl(original)) return serveFile(original);
    if (!/^https?:\/\//i.test(original)) return failure(400, 'Only web and file addresses can be opened here', 'address');
    let upstream;
    try {
      upstream = await ses.fetch(original, { headers: { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }, redirect: 'follow', credentials: 'include', cache: 'default' });
    } catch (err) {
      return failure(502, 'The picture could not be fetched: ' + err.message, 'fetch');
    }
    const out = { 'cache-control': 'private, max-age=0', 'x-vex-status': String(upstream.status) };
    for (const name of ['content-type', 'last-modified', 'etag']) {
      const v = upstream.headers.get(name);
      if (v) out[name] = v;
    }
    // A body the network stack already decompressed no longer has the length the server named.
    if (!upstream.headers.get('content-encoding')) { const len = upstream.headers.get('content-length'); if (len) out['content-length'] = len; }
    // The picture is only ever drawn by an <img> from a blob: even an SVG's scripts cannot run there, and this keeps it inert as a document too.
    out['content-security-policy'] = "default-src 'none'; sandbox";
    return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
  }

  function serveFile(original) {
    let file;
    try { file = fileURLToPath(original.replace(/[?#].*$/, '')); } catch { return failure(400, 'Bad file address', 'address'); }
    let stat;
    try { stat = fs.statSync(file); } catch { return failure(404, 'That file is not there', 'missing'); }
    if (!stat.isFile()) return failure(404, 'That is not a file', 'missing');
    const type = EXT_TYPE[nodePath.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type, 'content-length': String(stat.size), 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox", 'last-modified': stat.mtime.toUTCString(), 'x-vex-status': '200' };
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
  }

  function makeHandler(ses, partition) {
    const persistent = typeof partition === 'string' && partition.startsWith('persist:');
    return async (request) => {
      let url;
      try { url = new URL(request.url); } catch { return new Response('Bad address', { status: 400 }); }
      if (url.hostname !== HOST) return new Response('Not found', { status: 404 });
      if (url.pathname === '/' || url.pathname === '/index.html') return servePage(persistent);
      if (url.pathname === '/doc') {
        const original = url.searchParams.get('u');
        if (!original) return failure(400, 'No picture named', 'address');
        return serveDocument(ses, original);
      }
      return serveStatic(url.pathname);
    };
  }

  // The registry entry: what the shared catch asks this viewer.
  const entry = {
    id: ID,
    isEnabled,
    match: (_url, contentType) => isImageType(contentType),
    page: (original, fragment) => viewerUrl(original, fragment),
    wire(ses, partition) { if (ses && ses.protocol) ses.protocol.handle(SCHEME, makeHandler(ses, partition)); },
  };
  deps.docViewers.register(entry);

  // A link click inside a page to a file: picture is turned around to the viewer (Chromium would show its bare picture).
  // will-navigate fires for a navigation the PAGE starts, never for one the window starts, so nothing loops.
  function watch(contents) {
    let type;
    try { type = contents.getType(); } catch { return; }
    if (type !== 'webview') return;
    contents.on('will-navigate', (event, url) => {
      if (!isEnabled() || !isImageFileUrl(url) || !deps.docViewers.isGuest(contents)) return;
      if (deps.docViewers.consumeBypass(contents.id, url)) return;
      event.preventDefault();
      contents.loadURL(viewerUrl(url)).catch((err) => { if (deps.log) deps.log('[image viewer] could not open ' + url + ': ' + err.message); });
    });
  }

  return { SCHEME, HOST, entry, makeHandler, roots, watch, allowOnce: deps.docViewers.allowOnce };
}

// ---- what the viewer asks main to do (every channel checks that the asker is the viewer page) -----------------

function viewerSource(event) {
  const frame = event && event.senderFrame;
  const parsed = parseViewerUrl(frame && frame.url);
  if (!parsed || (frame.parent != null)) throw new Error('Only the image viewer may ask for this');
  return parsed;
}

const SAVE_TYPES = Object.freeze({ png: { ext: 'png', name: 'PNG' }, jpeg: { ext: 'jpg', name: 'JPEG' }, webp: { ext: 'webp', name: 'WebP' } });

function safeBase(name, original) {
  let n = String(name || '').trim();
  if (!n) { try { n = decodeURIComponent(nodePath.basename(new URL(original).pathname)); } catch { n = ''; } }
  n = n.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80).trim();
  return n || 'image';
}

// opts: { ipcMain, dialog, windowFor, viewer, docViewers, clipboard, nativeImage, shell, downloadsDir(), fsImpl? }
function registerImageViewerIpc(opts) {
  const { ipcMain, dialog, windowFor, viewer, docViewers } = opts;
  const fsImpl = opts.fsImpl || nodeFs;
  if (!ipcMain || !dialog || typeof windowFor !== 'function' || !viewer || !docViewers || !opts.clipboard || !opts.nativeImage) {
    throw new Error('registerImageViewerIpc needs ipcMain, dialog, windowFor, viewer, docViewers, clipboard and nativeImage');
  }

  const bytesOf = (value) => {
    const b = value instanceof ArrayBuffer ? Buffer.from(value) : (ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null);
    if (!b || !b.length) throw new Error('There is no picture to use');
    if (b.length > SAVE_LIMIT) throw new Error('That picture is larger than ' + Math.round(SAVE_LIMIT / 1048576) + ' MB');
    return b;
  };

  function uniqueIn(dir, base, ext) {
    let p = nodePath.join(dir, base + '.' + ext);
    for (let n = 2; fsImpl.existsSync(p); n++) p = nodePath.join(dir, base + ' (' + n + ').' + ext);
    return p;
  }
  async function writeAtomic(file, bytes) {
    const temp = file + '.vex-tmp';
    await fsImpl.promises.writeFile(temp, bytes);
    await fsImpl.promises.rename(temp, file);
  }
  const fileOf = (original) => (isImageFileUrl(original) ? fileURLToPath(original.replace(/[?#].*$/, '')) : null);

  // A copy of the picture as the viewer made it (turned, cropped, resized or without its EXIF): always a NEW file.
  ipcMain.handle('imageview:save-copy', async (event, req) => {
    try {
      const src = viewerSource(event);
      const r = req || {};
      const kind = SAVE_TYPES[r.type];
      if (!kind) throw new Error('Pick PNG, JPEG or WebP');
      const bytes = bytesOf(r.bytes);
      const file = fileOf(src.original);
      const base = safeBase(r.name, src.original) + (r.suffix ? '-' + String(r.suffix).replace(/[^a-z0-9-]/gi, '').slice(0, 20) : '-copy');
      const dir = file ? nodePath.dirname(file) : opts.downloadsDir();
      const dlg = { title: 'Save a copy of the picture', defaultPath: uniqueIn(dir, base, kind.ext), filters: [{ name: kind.name, extensions: [kind.ext] }] };
      const win = windowFor(event);
      const picked = win ? await dialog.showSaveDialog(win, dlg) : await dialog.showSaveDialog(dlg);
      if (picked.canceled || !picked.filePath) return { ok: true, cancelled: true };
      const target = nodePath.extname(picked.filePath) ? picked.filePath : picked.filePath + '.' + kind.ext;
      if (file && nodePath.resolve(file).toLowerCase() === nodePath.resolve(target).toLowerCase()) throw new Error('That would replace the picture you are looking at. Save the copy under another name');
      await writeAtomic(target, bytes);
      return { ok: true, cancelled: false, name: nodePath.basename(target), bytes: bytes.length };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // "Save image as": a web picture goes through the page's own download (the downloads panel, its scan and the tab's cookies apply
  // as for any download); a file picture is copied to where the person chooses.
  ipcMain.handle('imageview:download', async (event) => {
    try {
      const src = viewerSource(event);
      const file = fileOf(src.original);
      if (file) {
        const ext = nodePath.extname(file).replace(/^\./, '') || 'png';
        const dlg = { title: 'Save a copy of the picture', defaultPath: uniqueIn(opts.downloadsDir(), safeBase('', src.original), ext), filters: [{ name: 'Image', extensions: [ext] }] };
        const win = windowFor(event);
        const picked = win ? await dialog.showSaveDialog(win, dlg) : await dialog.showSaveDialog(dlg);
        if (picked.canceled || !picked.filePath) return { ok: true, cancelled: true };
        if (nodePath.resolve(file).toLowerCase() === nodePath.resolve(picked.filePath).toLowerCase()) throw new Error('That is the file you are looking at');
        await fsImpl.promises.copyFile(file, picked.filePath + '.vex-tmp');
        await fsImpl.promises.rename(picked.filePath + '.vex-tmp', picked.filePath);
        return { ok: true, cancelled: false, name: nodePath.basename(picked.filePath) };
      }
      docViewers.allowOnce(event.sender.id, src.original);
      event.sender.downloadURL(src.original);
      return { ok: true, cancelled: false, viaDownloads: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // "Open in the browser's own view": this one navigation is not caught.
  ipcMain.handle('imageview:open-native', async (event) => {
    try {
      const src = viewerSource(event);
      docViewers.allowOnce(event.sender.id, src.original);
      await event.sender.loadURL(src.original + (src.hash ? '#' + src.hash : ''));
      return { ok: true };
    } catch (err) {
      // Chromium reports an aborted load for a navigation that was simply replaced; that is not a failure.
      if (/ERR_ABORTED|\(-3\)/.test(String(err && err.message))) return { ok: true };
      return { ok: false, error: err.message };
    }
  });

  // The picture on the clipboard (decoded here, so any format the viewer drew can be sent as PNG).
  ipcMain.handle('imageview:copy-image', async (event, req) => {
    try {
      viewerSource(event);
      const image = opts.nativeImage.createFromBuffer(bytesOf(req && req.bytes));
      if (image.isEmpty()) throw new Error('That picture could not be put on the clipboard');
      opts.clipboard.writeImage(image);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // The address of the picture, as the tab knows it (not what the page sends).
  ipcMain.handle('imageview:copy-address', async (event) => {
    try {
      const src = viewerSource(event);
      opts.clipboard.writeText(src.original);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('imageview:reveal', async (event) => {
    try {
      const src = viewerSource(event);
      const file = fileOf(src.original);
      if (!file) throw new Error('Only a picture on this computer has a folder to show');
      if (!opts.shell) throw new Error('Showing a file is not available here');
      opts.shell.showItemInFolder(file);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // The pictures beside this one (a file: picture only; for a web picture the page it came from is gone, so there is no honest list).
  ipcMain.handle('imageview:siblings', async (event) => {
    try {
      const src = viewerSource(event);
      const file = fileOf(src.original);
      if (!file) return { ok: true, urls: [], index: -1 };
      const dir = nodePath.dirname(file);
      const names = (await fsImpl.promises.readdir(dir)).filter((n) => IMAGE_EXT.test(n)).sort(naturalCompare).slice(0, SIBLING_LIMIT);
      const urls = names.map((n) => pathToFileURL(nodePath.join(dir, n)).href);
      const here = nodePath.resolve(file).toLowerCase();
      const index = names.findIndex((n) => nodePath.resolve(dir, n).toLowerCase() === here);
      return { ok: true, urls: index < 0 ? [] : urls, index };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = { createImageViewer, registerImageViewerIpc, viewerUrl, parseViewerUrl, isImageFileUrl, isImageSource, isImageType, naturalCompare, SCHEME, HOST, CSP, MIME, IMAGE_TYPE, EXT_TYPE, SAVE_LIMIT };
