'use strict';
// === Vex's own viewer for office documents and e-books: how a file reaches it ===============================
//
// A Word, Excel or PowerPoint file, an OpenDocument file, an RTF or an EPUB used to be a download. Now a tab shows it in a page of
// Vex's own (src/renderer/office-viewer): theme-matched, read-only, offline, with find, print, copy and a button to download the
// original instead.
//
// How a file gets there:
//   * A web address whose answer is one of these types (and is not marked "attachment") is caught in the session's
//     onHeadersReceived by the viewer registry (main/doc-viewers.js take) and turned into a redirect to
//     vex-doc://view/?u=<the file's address> , so the tab makes one ordinary navigation.
//   * A file: address that Chromium turned into a download (it cannot show these) is caught in will-download and sent to the viewer;
//     a link click to one is caught in will-navigate. (registry.takeDownload / takeNavigation)
//   * The viewer page is served by this module (protocol.handle on every session). The file is fetched through
//     vex-doc://view/doc?u=... , which main answers with session.fetch of THE SAME SESSION the tab runs in: a file behind a login uses
//     the tab's own cookies; a private or Tor tab's file goes through that tab's own session and proxy; nothing is ever fetched
//     through another session.
//   * The tab keeps showing the file's own address: renderer/js/webview.js maps the viewer address back before the address bar,
//     history, bookmarks and reload see it.
//   * "Download instead" lets exactly one answer for that address through (registry.allowOnce).
//
// The page may use only what is served here (CSP: its own origin; no network of its own). Only a page on vex-doc://view/ may call
// the docview:* channels, and each call re-checks that. Nothing in a document is run or fetched; macros are never touched.

const nodeFs = require('fs');
const nodeOs = require('os');
const nodePath = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { fileURLToPath } = require('url');

const SCHEME = 'vex-doc';
const HOST = 'view';
const FILE_LIMIT = 80 * 1024 * 1024;    // the same ceiling the page applies (office-viewer/zipinfo.js LIMITS.fileBytes)

// What the viewer opens, by file name and by what the server says it is.
const EXTENSIONS = Object.freeze(['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'xlsx', 'xlsm', 'xltx', 'xltm', 'xls', 'xlt', 'pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'ppt', 'pps', 'pot', 'odt', 'ott', 'ods', 'ots', 'odp', 'otp', 'rtf', 'epub']);
const EXT_RE = new RegExp('\\.(?:' + EXTENSIONS.join('|') + ')$', 'i');
const MIME_RE = /^\s*(?:application\/(?:vnd\.openxmlformats-officedocument\.(?:wordprocessingml|spreadsheetml|presentationml)\.[a-z.]+|vnd\.ms-(?:word|excel|powerpoint)[a-z.\-]*|msword|vnd\.oasis\.opendocument\.(?:text|spreadsheet|presentation)(?:-template)?|epub\+zip|rtf|x-rtf)|text\/rtf)\b/i;
// A server that does not know the type says one of these; the file name then decides.
const GENERIC_MIME_RE = /^\s*(?:application\/(?:octet-stream|zip|x-zip-compressed|force-download|download|binary|x-download)|binary\/octet-stream)?\s*(?:;|$)/i;

function pathOf(url) {
  try { return decodeURIComponent(new URL(url).pathname); } catch { return String(url || '').split(/[?#]/)[0]; }
}
function isOfficeFileUrl(url) { return /^file:\/\//i.test(String(url || '')) && EXT_RE.test(pathOf(url)); }

// The registry's match(): web addresses.
function matchOffice(url, contentType) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  if (MIME_RE.test(contentType)) return true;
  return GENERIC_MIME_RE.test(contentType) && EXT_RE.test(pathOf(url));
}

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

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
});

// The viewer page's policy: its own scripts and worker, pictures only from itself or made in the page (a document's pictures are
// blobs), and no network of its own. A document can neither run anything nor reach out.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// deps: { rendererDir, registry (doc-viewers), fs?, isEnabled(), attachments(), look() -> { theme, guiStyle, lang }, owner(contents), maxBytes? }
function createOfficeViewer(deps) {
  const fs = deps.fs || nodeFs;
  const rendererDir = deps.rendererDir;
  if (!rendererDir) throw new Error('createOfficeViewer needs rendererDir');
  if (!deps.registry) throw new Error('createOfficeViewer needs the viewer registry');
  const roots = {
    app: nodePath.join(rendererDir, 'office-viewer'),
    lib: nodePath.join(rendererDir, 'vendor', 'runtime', 'office'),
    css: nodePath.join(rendererDir, 'css'),
  };
  const wired = new WeakSet();

  const entry = deps.registry.register({
    id: 'office',
    match: matchOffice,
    page: viewerUrl,
    enabled: () => (deps.isEnabled ? !!deps.isEnabled() : true),
    attachments: () => (deps.attachments ? !!deps.attachments() : false),
    fileTypes: EXT_RE,
  });

  function secureHeaders(type, extra) {
    return { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache', ...(extra || {}) };
  }

  function servePage(persistent) {
    const file = nodePath.join(roots.app, 'viewer.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch (err) { return new Response('The document viewer page is missing: ' + err.message, { status: 500 }); }
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
    // /app/x, /lib/x, /css/x : one folder each, nothing above it, and only the kinds of file the viewer uses.
    const m = /^\/(app|lib|css)\/(.+)$/.exec(pathname);
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

  async function serveDocument(ses, original) {
    const max = deps.maxBytes || FILE_LIMIT;
    if (/^file:\/\//i.test(original)) {
      if (!isOfficeFileUrl(original)) return new Response('Only office documents and books can be opened here', { status: 400 });
      let file;
      try { file = fileURLToPath(original.replace(/[?#].*$/, '')); } catch { return new Response('Bad file address', { status: 400 }); }
      let stat;
      try { stat = fs.statSync(file); } catch { return new Response('That file is not there', { status: 404 }); }
      if (!stat.isFile()) return new Response('That is not a file', { status: 404 });
      return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(stat.size), 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox" } });
    }
    if (!/^https?:\/\//i.test(original)) return new Response('Only web and file addresses can be opened here', { status: 400 });
    let upstream;
    try {
      upstream = await ses.fetch(original, { headers: { accept: '*/*' }, redirect: 'follow', credentials: 'include', cache: 'default' });
    } catch (err) {
      return new Response('The file could not be fetched: ' + err.message, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const out = { 'cache-control': 'private, max-age=0' };
    for (const name of ['content-type', 'content-disposition', 'etag', 'last-modified']) {
      const v = upstream.headers.get(name);
      if (v) out[name] = v;
    }
    // A body the network stack already decompressed no longer has the length the server named.
    if (!upstream.headers.get('content-encoding')) { const len = upstream.headers.get('content-length'); if (len) out['content-length'] = len; }
    out['content-security-policy'] = "default-src 'none'; sandbox";
    void max;
    return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
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
        if (!original) return new Response('No file named', { status: 400 });
        return serveDocument(ses, original);
      }
      return serveStatic(url.pathname);
    };
  }

  function wireSession(ses, partition) {
    if (!ses || !ses.protocol || wired.has(ses)) return;
    wired.add(ses);
    ses.protocol.handle(SCHEME, makeHandler(ses, partition));
    // First in line on this session's will-download: a file: document goes to the viewer instead of the Downloads panel.
    if (typeof ses.prependListener === 'function') ses.prependListener('will-download', (event, item, contents) => { deps.registry.takeDownload(event, item, contents); });
  }

  return { SCHEME, HOST, entry, wireSession, makeHandler, roots, servePage, serveStatic, serveDocument };
}

// ---- what the viewer asks main to do (every channel checks that the asker is the viewer page) -----------------
function viewerSource(event) {
  const frame = event && event.senderFrame;
  const parsed = parseViewerUrl(frame && frame.url);
  if (!parsed || (frame.parent != null)) throw new Error('Only the document viewer may ask for this');
  return parsed;
}

const SAFE_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;
function fileNameOf(original) {
  let n = '';
  try { n = decodeURIComponent(nodePath.basename(new URL(original).pathname)); } catch { n = nodePath.basename(String(original).split(/[?#]/)[0]); }
  n = n.replace(SAFE_NAME, '_').trim().slice(0, 120);
  return n || 'document';
}

// opts: { ipcMain, dialog, windowFor, viewer, registry, shell, downloadsDir(), tempDir?(), fsImpl? }
function registerOfficeViewerIpc(opts) {
  const { ipcMain, dialog, windowFor, registry } = opts;
  const fsImpl = opts.fsImpl || nodeFs;
  if (!ipcMain || !dialog || typeof windowFor !== 'function' || !registry) throw new Error('registerOfficeViewerIpc needs ipcMain, dialog, windowFor and registry');
  const tempRoot = () => (opts.tempDir ? opts.tempDir() : nodeOs.tmpdir());

  function uniqueIn(dir, name) {
    const ext = nodePath.extname(name), base = name.slice(0, name.length - ext.length);
    let p = nodePath.join(dir, name);
    for (let n = 2; fsImpl.existsSync(p); n++) p = nodePath.join(dir, base + ' (' + n + ')' + ext);
    return p;
  }

  ipcMain.handle('docview:download', async (event) => {
    try {
      const src = viewerSource(event);
      if (isOfficeFileUrl(src.original)) {
        const file = fileURLToPath(src.original.replace(/[?#].*$/, ''));
        const win = windowFor(event);
        const dlg = { title: 'Save a copy', defaultPath: uniqueIn(opts.downloadsDir(), fileNameOf(src.original)) };
        const picked = win ? await dialog.showSaveDialog(win, dlg) : await dialog.showSaveDialog(dlg);
        if (picked.canceled || !picked.filePath) return { ok: true, cancelled: true };
        if (nodePath.resolve(file).toLowerCase() === nodePath.resolve(picked.filePath).toLowerCase()) throw new Error('That is the file you are reading');
        await fsImpl.promises.copyFile(file, picked.filePath + '.vex-tmp');
        await fsImpl.promises.rename(picked.filePath + '.vex-tmp', picked.filePath);
        return { ok: true, cancelled: false, name: nodePath.basename(picked.filePath) };
      }
      if (!/^https?:\/\//i.test(src.original)) throw new Error('Only web and file addresses can be downloaded');
      // Through the page's own session, so the Downloads panel, its scan and the tab's cookies all apply as for any download.
      registry.allowOnce(event.sender.id, src.original);
      event.sender.downloadURL(src.original);
      return { ok: true, cancelled: false, viaDownloads: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('docview:open-external', async (event) => {
    try {
      const src = viewerSource(event);
      if (!opts.shell) throw new Error('Opening a file is not available here');
      let file;
      if (isOfficeFileUrl(src.original)) file = fileURLToPath(src.original.replace(/[?#].*$/, ''));
      else {
        if (!/^https?:\/\//i.test(src.original)) throw new Error('Only web and file addresses can be opened');
        // Fetched again through the tab's own session into a folder of its own, marked as coming from the internet (as Chromium does
        // for a download) so Windows and Office look at it before they run anything in it.
        const response = await event.sender.session.fetch(src.original, { redirect: 'follow', credentials: 'include' });
        if (!response.ok) throw new Error('The server answered ' + response.status);
        const len = Number(response.headers.get('content-length'));
        if (len > FILE_LIMIT) throw new Error('The file is larger than ' + Math.round(FILE_LIMIT / 1048576) + ' MB');
        const chunks = [];
        let total = 0;
        for await (const chunk of response.body) { total += chunk.length; if (total > FILE_LIMIT) throw new Error('The file is larger than ' + Math.round(FILE_LIMIT / 1048576) + ' MB'); chunks.push(Buffer.from(chunk)); }
        let name = fileNameOf(src.original);
        if (!EXT_RE.test(name)) throw new Error('This kind of file is not opened from here');
        const dir = nodePath.join(tempRoot(), 'vex-open-' + crypto.randomBytes(6).toString('hex'));
        await fsImpl.promises.mkdir(dir, { recursive: true });
        file = nodePath.join(dir, name);
        await fsImpl.promises.writeFile(file, Buffer.concat(chunks));
        try { await fsImpl.promises.writeFile(file + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=' + src.original.replace(/[\r\n]/g, '') + '\r\n'); }
        catch (err) {
          await fsImpl.promises.rm(dir, { recursive: true, force: true });
          throw new Error('Vex could not mark the copy as downloaded from the internet, so it was not opened (' + err.message + ')');
        }
      }
      const problem = await opts.shell.openPath(file);
      if (problem) throw new Error(problem);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('docview:print', async (event) => {
    try {
      viewerSource(event);
      return await new Promise((resolve) => {
        event.sender.print({ silent: false, printBackground: true }, (success, reason) => resolve(success ? { ok: true } : { ok: false, error: reason === 'cancelled' || reason === 'Print job canceled' ? 'cancelled' : (reason || 'The print did not start') }));
      });
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

// Old copies left by "Open with Windows" (opened files are left to the program that has them open).
function sweepOpenedCopies(root, olderThanMs, fsImpl) {
  const f = fsImpl || nodeFs;
  let removed = 0;
  let names;
  try { names = f.readdirSync(root); } catch { return 0; }
  for (const n of names) {
    if (!/^vex-open-[0-9a-f]{12}$/.test(n)) continue;
    const dir = nodePath.join(root, n);
    try {
      if (Date.now() - f.statSync(dir).mtimeMs < olderThanMs) continue;
      f.rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch (err) { console.warn('[Document viewer] could not remove ' + dir + ':', err.message); }
  }
  return removed;
}

module.exports = { createOfficeViewer, registerOfficeViewerIpc, sweepOpenedCopies, viewerUrl, parseViewerUrl, matchOffice, isOfficeFileUrl, fileNameOf, SCHEME, HOST, CSP, EXTENSIONS, EXT_RE, MIME_RE, FILE_LIMIT };
