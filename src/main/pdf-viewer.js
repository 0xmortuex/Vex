'use strict';
// === Vex's own PDF viewer: how a PDF reaches it ===============================
//
// Chromium's PDF viewer is a sealed extension: it cannot be themed, cannot be given
// tools, and on some profiles it fails (a blank gray pane after a reload). Vex shows a
// PDF with its own viewer instead, built on pdf.js (src/renderer/pdf-viewer).
//
// How a PDF gets there:
//   * A web page whose RESPONSE says application/pdf (and is not an attachment) is caught
//     in the session's onHeadersReceived (one line in each of main.js's handlers: take()).
//     The answer is turned into a redirect to  vex-pdf://view/?u=<the PDF's address>  , so
//     the tab makes one ordinary navigation. A .pdf file: address is sent there by the
//     window itself before it loads (js/webview.js viewerAddress): main cannot take over a
//     navigation to a PDF once it has started, because Chromium's own viewer starting and
//     being cancelled froze Vex's main process (measured 2026-10-25).
//   * The viewer page is served by this module (protocol.handle on every session). Its
//     document is fetched through  vex-pdf://view/doc?u=...  , which main answers with
//     session.fetch of THE SAME SESSION the tab runs in: a PDF behind a login uses the
//     tab's own cookies, a private or Tor tab's PDF goes through that tab's own session
//     (and its proxy), and nothing is ever fetched through another session. Ranges are
//     passed on, so a big PDF is read page by page rather than whole.
//   * The tab keeps showing the PDF's own address: renderer/js/webview.js maps the viewer
//     address back to  u  before the address bar, history and bookmarks see it.
//   * "Open in the browser's viewer" marks one navigation as not to be caught (bypass).
//
// The viewer page may use only what is served here (CSP: its own origin; no network of its
// own), and only a page on  vex-pdf://view/  may call the pdfview:* channels below.

const nodeFs = require('fs');
const nodePath = require('path');
const { Readable } = require('stream');
const { fileURLToPath } = require('url');

const SCHEME = 'vex-pdf';
const HOST = 'view';
const BYPASS_MS = 20000;
const COPY_LIMIT = 60 * 1024 * 1024;     // what the toolkit reads for a saved copy (pdf-toolkit LIMITS.fileBytes)

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.json': 'application/json',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ttc': 'font/collection', '.icc': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
});

// The viewer page's policy. It runs scripts from itself only (plus wasm, which pdf.js's image decoders are), its worker
// from itself or a blob, and reaches nothing but itself: a PDF cannot make the viewer call out.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
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
const isPdfFileUrl = (url) => /^file:\/\/[^?#]*\.pdf(?:[?#].*)?$/i.test(String(url || ''));
const isWebPdfSource = (url) => /^https?:\/\//i.test(String(url || '')) || isPdfFileUrl(url);

function headerValue(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === want) return [].concat(headers[key])[0] || '';
  return '';
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

// deps: { rendererDir, fs?, isEnabled(), look() -> { theme, guiStyle, lang }, owner(contents) -> truthy for a Vex window's page,
//         log?(msg) }
function createPdfViewer(deps) {
  const fs = deps.fs || nodeFs;
  const rendererDir = deps.rendererDir;
  if (!rendererDir) throw new Error('createPdfViewer needs rendererDir');
  const isEnabled = deps.isEnabled || (() => true);
  const roots = {
    app: nodePath.join(rendererDir, 'pdf-viewer'),
    lib: nodePath.join(rendererDir, 'vendor', 'runtime', 'pdfjs'),
    css: nodePath.join(rendererDir, 'css'),
    fonts: nodePath.join(rendererDir, 'fonts'),
  };
  const bypass = new Map();      // `${webContentsId} ${address}` -> expiry
  const wired = new WeakSet();

  const bypassKey = (id, url) => id + ' ' + String(url).replace(/#.*$/, '');
  function allowOnce(webContentsId, url) { bypass.set(bypassKey(webContentsId, url), Date.now() + BYPASS_MS); }
  function consumeBypass(webContentsId, url) {
    const key = bypassKey(webContentsId, url);
    const until = bypass.get(key);
    if (until == null) return false;
    bypass.delete(key);
    return until > Date.now();
  }

  function isGuest(wc) {
    try { return !!wc && !wc.isDestroyed() && wc.getType() === 'webview' && !!deps.owner(wc); } catch { return false; }
  }

  // ---- the catch ------------------------------------------------------------
  // Called with the details and the callback of onHeadersReceived. true = the navigation was taken over and the callback has been answered.
  function take(details, callback) {
    if (!details || details.resourceType !== 'mainFrame' || !isEnabled()) return false;
    if (!(details.statusCode >= 200 && details.statusCode < 300)) return false;
    if (!/^https?:\/\//i.test(String(details.url || ''))) return false;
    const type = headerValue(details.responseHeaders, 'content-type');
    if (!/^\s*application\/(?:x-)?pdf\b/i.test(type)) return false;
    if (/^\s*attachment/i.test(headerValue(details.responseHeaders, 'content-disposition'))) return false;
    const wc = details.webContents;
    if (!isGuest(wc)) return false;
    if (consumeBypass(wc.id, details.url)) return false;
    // The #page= and #zoom= the person typed or followed are not part of the request; the tab's own pending address has them.
    let pending;
    try { pending = wc.getURL() || ''; } catch { pending = ''; }
    const frag = pending.replace(/#.*$/, '') === details.url.replace(/#.*$/, '') && pending.includes('#') ? pending.slice(pending.indexOf('#') + 1) : '';
    // The server's answer is turned into a redirect to the viewer. (Cancelling the request and loading the viewer from here instead
    // froze Vex's main process, measured 2026-10-25; a redirect leaves the navigation one single, ordinary one.)
    callback({ statusLine: 'HTTP/1.1 302 Found', responseHeaders: { location: [viewerUrl(details.url, frag)], 'content-length': ['0'], 'cache-control': ['no-store'] } });
    return true;
  }

  // ---- the protocol ---------------------------------------------------------
  function secureHeaders(type, extra) {
    return { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache', ...(extra || {}) };
  }

  function servePage(persistent) {
    const file = nodePath.join(roots.app, 'viewer.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch (err) { return new Response('The PDF viewer page is missing: ' + err.message, { status: 500 }); }
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
    // /app/x, /lib/x, /css/x, /fonts/x : one folder each, nothing above it, and only the kinds of file the viewer uses.
    const m = /^\/(app|lib|css|fonts)\/(.+)$/.exec(pathname);
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
    if (isPdfFileUrl(original)) return serveFile(original, request);
    if (!/^https?:\/\//i.test(original)) return new Response('Only web and file addresses can be opened here', { status: 400 });
    const headers = { accept: 'application/pdf,*/*;q=0.8' };
    const range = request.headers.get('range');
    if (range) headers.range = range;
    let upstream;
    try {
      upstream = await ses.fetch(original, { headers, redirect: 'follow', credentials: 'include', cache: 'default' });
    } catch (err) {
      return new Response('The PDF could not be fetched: ' + err.message, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-vex-error': 'fetch' } });
    }
    const out = { 'cache-control': 'private, max-age=0' };
    for (const name of ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-disposition']) {
      const v = upstream.headers.get(name);
      if (v) out[name] = v;
    }
    // A body the network stack already decompressed no longer has the length the server named.
    if (!upstream.headers.get('content-encoding')) { const len = upstream.headers.get('content-length'); if (len) out['content-length'] = len; }
    out['content-security-policy'] = "default-src 'none'; sandbox";
    return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
  }

  function serveFile(original, request) {
    let file;
    try { file = fileURLToPath(original.replace(/[?#].*$/, '')); } catch { return new Response('Bad file address', { status: 400 }); }
    let stat;
    try { stat = fs.statSync(file); } catch { return new Response('That file is not there', { status: 404 }); }
    if (!stat.isFile()) return new Response('That is not a file', { status: 404 });
    const range = parseRange(request.headers.get('range'), stat.size);
    const base = { 'content-type': 'application/pdf', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox" };
    if (range && range.invalid) return new Response(null, { status: 416, headers: { ...base, 'content-range': 'bytes */' + stat.size } });
    if (range) {
      const body = Readable.toWeb(fs.createReadStream(file, { start: range.start, end: range.end }));
      return new Response(body, { status: 206, headers: { ...base, 'content-length': String(range.end - range.start + 1), 'content-range': 'bytes ' + range.start + '-' + range.end + '/' + stat.size } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'content-length': String(stat.size) } });
  }

  // The handler for one session. `partition` says whether the tab's storage outlives it (persist:...).
  function makeHandler(ses, partition) {
    const persistent = typeof partition === 'string' && partition.startsWith('persist:');
    return async (request) => {
      let url;
      try { url = new URL(request.url); } catch { return new Response('Bad address', { status: 400 }); }
      if (url.hostname !== HOST) return new Response('Not found', { status: 404 });
      if (url.pathname === '/' || url.pathname === '/index.html') return servePage(persistent);
      if (url.pathname === '/doc') {
        const original = url.searchParams.get('u');
        if (!original) return new Response('No PDF named', { status: 400 });
        return serveDocument(ses, original, request);
      }
      return serveStatic(url.pathname);
    };
  }

  function wireSession(ses, partition) {
    if (!ses || !ses.protocol || wired.has(ses)) return;
    wired.add(ses);
    ses.protocol.handle(SCHEME, makeHandler(ses, partition));
  }

  return { SCHEME, HOST, take, wireSession, allowOnce, consumeBypass, makeHandler, roots, isGuest };
}

// ---- what the viewer asks main to do (every channel checks that the asker is the viewer page) -----------------
const SAVE_LIMITS = Object.freeze({ marks: 400, values: 300 });

// How far the pages were turned in the viewer, clockwise: 0, 90, 180 or 270.
function turnOf(value) {
  const n = ((Math.round(Number(value) / 90) * 90 % 360) + 360) % 360;
  return Number.isFinite(n) && [90, 180, 270].includes(n) ? n : 0;
}

function viewerSource(event) {
  const frame = event && event.senderFrame;
  const parsed = parseViewerUrl(frame && frame.url);
  if (!parsed || (frame.parent != null)) throw new Error('Only the PDF viewer may ask for this');
  return parsed;
}

// opts: { ipcMain, dialog, windowFor, viewer, toolkit, fsImpl?, downloadsDir(), shell?, notePath? }
function registerPdfViewerIpc(opts) {
  const { ipcMain, dialog, windowFor, viewer, toolkit } = opts;
  const fsImpl = opts.fsImpl || nodeFs;
  if (!ipcMain || !dialog || typeof windowFor !== 'function' || !viewer || !toolkit) throw new Error('registerPdfViewerIpc needs ipcMain, dialog, windowFor, viewer and toolkit');
  const lastSaved = new Map();     // webContents id -> the last copy written for that page (to show in its folder)

  async function sourceBytes(event, original) {
    if (isPdfFileUrl(original)) {
      const file = fileURLToPath(original.replace(/[?#].*$/, ''));
      const st = await fsImpl.promises.stat(file);
      if (st.size > COPY_LIMIT) throw new Error('This PDF is larger than ' + Math.round(COPY_LIMIT / 1048576) + ' MB, which is the most Vex can mark up and save');
      return { bytes: await fsImpl.promises.readFile(file), file };
    }
    if (!/^https?:\/\//i.test(original)) throw new Error('Only web and file PDFs can be saved as a copy');
    // The page's own session: the same cookies, the same proxy, the same private or Tor route as the tab.
    const response = await event.sender.session.fetch(original, { redirect: 'follow', credentials: 'include' });
    if (!response.ok) throw new Error('The server answered ' + response.status + ' when Vex fetched the PDF again');
    const len = Number(response.headers.get('content-length'));
    if (len > COPY_LIMIT) throw new Error('This PDF is larger than ' + Math.round(COPY_LIMIT / 1048576) + ' MB, which is the most Vex can mark up and save');
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > COPY_LIMIT) throw new Error('This PDF is larger than ' + Math.round(COPY_LIMIT / 1048576) + ' MB, which is the most Vex can mark up and save');
      chunks.push(Buffer.from(chunk));
    }
    return { bytes: Buffer.concat(chunks), file: null };
  }

  function baseName(name, original) {
    let n = String(name || '').trim();
    if (!n) { try { n = decodeURIComponent(nodePath.basename(new URL(original).pathname)); } catch { n = ''; } }
    n = n.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80).trim();
    return n || 'document';
  }

  function uniqueIn(dir, base) {
    let p = nodePath.join(dir, base + '.pdf');
    for (let n = 2; fsImpl.existsSync(p); n++) p = nodePath.join(dir, base + ' (' + n + ').pdf');
    return p;
  }

  async function writeAtomic(file, bytes) {
    const temp = file + '.vex-tmp';
    await fsImpl.promises.writeFile(temp, bytes);
    await fsImpl.promises.rename(temp, file);
  }

  // The bytes of the copy: the form answers first, then the marks, then the turn of the pages.
  async function makeCopy(bytes, name, req) {
    let out = bytes;
    let marks = 0;
    const values = req.values && typeof req.values === 'object' ? req.values : {};
    if (Object.keys(values).length) out = (await toolkit.fillForm(out, { values, flatten: !!req.flatten, ascii: !!req.ascii }, name)).bytes;
    if (Array.isArray(req.marks) && req.marks.length) {
      const signature = req.signature ? Uint8Array.from(Buffer.from(String(req.signature), 'base64')) : undefined;
      const r = await toolkit.placeMarks(out, { marks: req.marks, signature, ascii: !!req.ascii }, name);
      out = r.bytes; marks = r.marks;
    }
    const turn = turnOf(req.rotate);
    if (turn) out = (await toolkit.rotate(out, { spec: 'all', degrees: turn }, name)).bytes;
    return { bytes: out, marks };
  }

  ipcMain.handle('pdfview:save-copy', async (event, req) => {
    try {
      const src = viewerSource(event);
      const r = req || {};
      if (Array.isArray(r.marks) && r.marks.length > SAVE_LIMITS.marks) throw new Error('That is more than ' + SAVE_LIMITS.marks + ' marks');
      if (r.values && Object.keys(r.values).length > SAVE_LIMITS.values) throw new Error('That is more than ' + SAVE_LIMITS.values + ' form fields');
      const have = (Array.isArray(r.marks) && r.marks.length) || (r.values && Object.keys(r.values).length) || turnOf(r.rotate);
      if (!have) throw new Error('There is nothing to save yet: add a mark, fill a field or turn the pages first');
      const { bytes, file } = await sourceBytes(event, src.original);
      const name = baseName(r.name, src.original);
      const made = await makeCopy(bytes, name + '.pdf', r);
      const win = windowFor(event);
      const dir = file ? nodePath.dirname(file) : opts.downloadsDir();
      let target;
      if (r.toDownloads) target = uniqueIn(opts.downloadsDir(), name + (made.marks ? '-annotated' : '-copy'));
      else {
        const dlg = { title: 'Save a copy of the PDF', defaultPath: uniqueIn(dir, name + '-annotated'), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
        const picked = win ? await dialog.showSaveDialog(win, dlg) : await dialog.showSaveDialog(dlg);
        if (picked.canceled || !picked.filePath) return { ok: true, cancelled: true };
        target = /\.pdf$/i.test(picked.filePath) ? picked.filePath : picked.filePath + '.pdf';
      }
      if (file && nodePath.resolve(file).toLowerCase() === nodePath.resolve(target).toLowerCase()) throw new Error('That would replace the PDF you are reading. Save the copy under another name');
      await writeAtomic(target, made.bytes);
      lastSaved.set(event.sender.id, target);
      return { ok: true, cancelled: false, name: nodePath.basename(target), bytes: made.bytes.length, marks: made.marks };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('pdfview:download', async (event) => {
    try {
      const src = viewerSource(event);
      if (isPdfFileUrl(src.original)) {
        const file = fileURLToPath(src.original.replace(/[?#].*$/, ''));
        const win = windowFor(event);
        const dlg = { title: 'Save a copy of the PDF', defaultPath: uniqueIn(opts.downloadsDir(), baseName('', src.original)), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
        const picked = win ? await dialog.showSaveDialog(win, dlg) : await dialog.showSaveDialog(dlg);
        if (picked.canceled || !picked.filePath) return { ok: true, cancelled: true };
        const target = /\.pdf$/i.test(picked.filePath) ? picked.filePath : picked.filePath + '.pdf';
        if (nodePath.resolve(file).toLowerCase() === nodePath.resolve(target).toLowerCase()) throw new Error('That is the file you are reading');
        await fsImpl.promises.copyFile(file, target + '.vex-tmp');
        await fsImpl.promises.rename(target + '.vex-tmp', target);
        lastSaved.set(event.sender.id, target);
        return { ok: true, cancelled: false, name: nodePath.basename(target) };
      }
      // Through the page's own session, so the downloads panel, its scan and the tab's cookies all apply as for any download.
      viewer.allowOnce(event.sender.id, src.original);
      event.sender.downloadURL(src.original);
      return { ok: true, cancelled: false, viaDownloads: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('pdfview:open-native', async (event) => {
    try {
      const src = viewerSource(event);
      viewer.allowOnce(event.sender.id, src.original);
      await event.sender.loadURL(src.original + (src.hash ? '#' + src.hash : ''));
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('pdfview:print', async (event) => {
    try {
      viewerSource(event);
      return await new Promise((resolve) => {
        event.sender.print({ silent: false, printBackground: true }, (success, reason) => resolve(success ? { ok: true } : { ok: false, error: reason === 'cancelled' || reason === 'Print job canceled' ? 'cancelled' : (reason || 'The print did not start') }));
      });
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('pdfview:reveal', async (event) => {
    try {
      viewerSource(event);
      const file = lastSaved.get(event.sender.id);
      if (!file) throw new Error('There is no saved copy to show');
      if (!opts.shell) throw new Error('Showing a file is not available here');
      opts.shell.showItemInFolder(file);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  return { lastSaved };
}

module.exports = { createPdfViewer, registerPdfViewerIpc, viewerUrl, parseViewerUrl, isPdfFileUrl, isWebPdfSource, parseRange, headerValue, SCHEME, HOST, CSP, MIME, SAVE_LIMITS };
