'use strict';
// === Vex's own viewer for text-like documents: how a document reaches it ======
//
// Chromium shows a JSON, XML, CSV, Markdown, log or source file as one block of plain monospaced text. Vex shows it in a page of
// its own (src/renderer/doc-viewer): JSON and XML as a collapsible tree, CSV and TSV as a table, Markdown rendered, anything else
// as numbered, searchable, highlighted lines. A view-source: page gets the same highlighted view.
//
// How a document gets there:
//   * A web page whose RESPONSE says JSON, XML, CSV, Markdown, plain text, a source language ... (textTypeMatches below) is caught
//     in each session's onHeadersReceived by main/doc-viewers.js and turned into a redirect to  vex-doc://view/?u=<address>  .
//     Only the top-level navigation: a page's own fetch() of the same address still gets the server's raw bytes.
//   * A file: address with a text-like extension, and a view-source: address, are sent there by the window itself before they
//     load (js/webview.js docAddress), because no response headers exist for them.
//   * The viewer page is served by this module (protocol.handle on every session). The document is read through
//     vex-doc://view/doc?u=...  , which main answers with session.fetch of THE SAME SESSION the tab runs in: a document behind
//     a login uses the tab's cookies, and a private or Tor tab's document goes through that tab's own session and proxy.
//     Nothing is ever fetched through another session. Ranges are passed on (tail-follow of a growing log reads only the new bytes).
//   * The tab keeps showing the document's own address (view-source:<address> for a source view); the window maps the viewer's
//     address back before the address bar, history, bookmarks and reload see it.
//   * "Open raw" marks one navigation as not to be caught (registry.allowOnce).
//
// The viewer page may use only what is served here (CSP: its own origin, no network of its own). Pictures a Markdown file names
// come through  /res  , which fetches them in the tab's session and passes on only image answers.

const nodeFs = require('fs');
const nodePath = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { fileURLToPath } = require('url');

const SCHEME = 'vex-doc';
const HOST = 'view';
const ID = 'text';

// Extensions that a file: address is shown in the viewer for. (js/webview.js keeps a twin of this list; a test holds them equal.)
const FILE_EXTENSIONS = Object.freeze([
  'json', 'jsonl', 'ndjson', 'geojson', 'json5', 'jsonc', 'xml', 'csv', 'tsv', 'md', 'markdown', 'mdx', 'txt', 'text', 'log', 'out',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'py', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'ini', 'cfg', 'conf', 'toml', 'yaml', 'yml',
  'env', 'sql', 'java', 'kt', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'lua', 'swift', 'r', 'diff', 'patch', 'properties', 'gitignore',
]);

// Content-Type headers that mean "a document of text". text/plain is in: servers send it for everything, and the viewer reads the first
// bytes before it decides what the document is (and shows a notice instead of text when it is binary).
const TEXT_TYPES = [
  /^text\/(?:plain|csv|tab-separated-values|tsv|markdown|x-markdown|x-log|json|xml|css|javascript|x-javascript|ecmascript|yaml|x-yaml|toml|x-toml|x-python|x-script\.python|x-sh|x-shellscript|x-java-source|x-c|x-csrc|x-c\+\+|x-chdr|x-go|x-rust|x-sql|sql|x-diff|x-patch|x-ini|x-properties)$/,
  /^application\/(?:json|ld\+json|geo\+json|manifest\+json|x-ndjson|ndjson|jsonl|x-jsonlines|json-seq|xml|x-yaml|yaml|toml|javascript|x-javascript|ecmascript|sql|x-sh|x-csh|x-httpd-php|x-sql|schema\+json|problem\+json)$/,
  /^application\/[a-z0-9.+-]+\+(?:json|xml)$/,
];
const NOT_TEXT = /^application\/(?:xhtml\+xml|rss\+xml|atom\+xml|rdf\+xml|vnd\.mozilla\.xul\+xml|mathml\+xml|x-xpinstall)$/;

function textTypeMatches(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!type || NOT_TEXT.test(type) || type.startsWith('image/')) return false;
  return TEXT_TYPES.some((re) => re.test(type));
}

// The viewer's CSP: scripts and its worker from itself only, no network of its own, pictures only from itself (or inline).
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
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

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
});

// ---- addresses (js/webview.js keeps a twin of these two; a test holds them equal) ----
function viewerUrl(original, hash, source) {
  const o = String(original || '');
  const at = o.indexOf('#');
  const base = at < 0 ? o : o.slice(0, at);
  const frag = hash != null && hash !== '' ? String(hash).replace(/^#/, '') : (at < 0 ? '' : o.slice(at + 1));
  return SCHEME + '://' + HOST + '/?u=' + encodeURIComponent(base) + (source ? '&m=source' : '') + (frag ? '#' + frag : '');
}
// -> { original, hash, source } or null
function parseViewerUrl(url) {
  const s = String(url || '');
  if (!s.toLowerCase().startsWith(SCHEME + '://' + HOST + '/')) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.pathname !== '/') return null;
  const original = u.searchParams.get('u');
  if (!original) return null;
  return { original, hash: u.hash ? u.hash.slice(1) : '', source: u.searchParams.get('m') === 'source' };
}
// The extension of the file a file: address names, lower case ('' when it has none).
function fileExtension(url) {
  const path = String(url || '').replace(/[?#].*$/, '');
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}
const isTextFileUrl = (url) => /^file:\/\//i.test(String(url || '')) && FILE_EXTENSIONS.includes(fileExtension(url));

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return { invalid: true };
  return { start, end };
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
const NAVIGATION_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

// deps: { rendererDir, fs?, registry, isEnabled?() -> boolean, look() -> { theme, guiStyle, lang } }
function createTextViewer(deps) {
  const fs = deps.fs || nodeFs;
  const rendererDir = deps.rendererDir;
  if (!rendererDir) throw new Error('createTextViewer needs rendererDir');
  if (!deps.registry) throw new Error('createTextViewer needs the document viewer registry');
  const roots = { app: nodePath.join(rendererDir, 'doc-viewer'), css: nodePath.join(rendererDir, 'css'), fonts: nodePath.join(rendererDir, 'fonts') };
  const wired = new WeakSet();

  // What the registry asks of a kind.
  const entry = {
    id: ID,
    isEnabled: () => (typeof deps.isEnabled === 'function' ? !!deps.isEnabled() : true),
    match: (url, contentType) => textTypeMatches(contentType),
    page: (url, fragment) => viewerUrl(url, fragment, false),
  };
  deps.registry.register(entry);

  function securityHeaders(type, extra) {
    return { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache', ...(extra || {}) };
  }

  function servePage(persistent) {
    let html;
    try { html = fs.readFileSync(nodePath.join(roots.app, 'viewer.html'), 'utf8'); } catch (err) { return new Response('The document viewer page is missing: ' + err.message, { status: 500 }); }
    const look = deps.look ? deps.look() : { theme: 'oxford', guiStyle: 'classic', lang: 'en' };
    const safe = (v, re, d) => (typeof v === 'string' && re.test(v) ? v : d);
    const theme = safe(look.theme, /^[a-z]+(?:-[a-z]+)*$/, 'oxford'), gui = safe(look.guiStyle, /^[a-z0-9-]+$/, 'classic'), lang = safe(look.lang, /^[a-z]{2}$/, 'en');
    html = html.replace('<html lang="en">', '<html lang="' + lang + '" data-theme="' + theme + '" data-gui-style="' + gui + '">')
      .replace('<meta name="vex-persist" content="0">', '<meta name="vex-persist" content="' + (persistent ? '1' : '0') + '">');
    return new Response(html, { headers: securityHeaders(MIME['.html'], { 'cache-control': 'no-store' }) });
  }

  function serveStatic(pathname) {
    if (pathname === '/icons.js') {
      let data;
      try { data = fs.readFileSync(nodePath.join(rendererDir, 'js', 'vex-icons.js')); } catch { return new Response('Not found', { status: 404 }); }
      return new Response(data, { headers: securityHeaders(MIME['.js']) });
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
    return new Response(data, { headers: securityHeaders(type) });
  }

  function errorResponse(status, message, kind) {
    return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-vex-error': kind || 'fetch', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox" } });
  }

  async function serveDocument(ses, original, request) {
    if (/^file:\/\//i.test(original)) return serveFile(original, request);
    if (!/^https?:\/\//i.test(original)) return errorResponse(400, 'Only web and file addresses can be opened here', 'scheme');
    const headers = { accept: NAVIGATION_ACCEPT };
    const range = request.headers.get('range');
    if (range) headers.range = range;
    let upstream;
    try {
      upstream = await ses.fetch(original, { headers, redirect: 'follow', credentials: 'include', cache: range ? 'no-store' : 'default' });
    } catch (err) { return errorResponse(502, 'The document could not be fetched: ' + err.message, 'fetch'); }
    const out = { 'cache-control': 'private, max-age=0' };
    for (const name of ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-disposition']) {
      const v = upstream.headers.get(name);
      if (v) out[name] = v;
    }
    if (!upstream.headers.get('content-encoding')) { const len = upstream.headers.get('content-length'); if (len) out['content-length'] = len; }
    out['x-vex-status'] = String(upstream.status);
    out['content-security-policy'] = "default-src 'none'; sandbox";
    return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
  }

  function serveFile(original, request) {
    let file;
    try { file = fileURLToPath(original.replace(/[?#].*$/, '')); } catch { return errorResponse(400, 'Bad file address', 'scheme'); }
    let stat;
    try { stat = fs.statSync(file); } catch { return errorResponse(404, 'That file is not there', 'missing'); }
    if (!stat.isFile()) return errorResponse(404, 'That is not a file', 'missing');
    const range = parseRange(request.headers.get('range'), stat.size);
    const base = { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox", 'x-vex-size': String(stat.size), 'last-modified': stat.mtime.toUTCString() };
    if (range && range.invalid) return new Response(null, { status: 416, headers: { ...base, 'content-range': 'bytes */' + stat.size } });
    if (range) {
      const body = Readable.toWeb(fs.createReadStream(file, { start: range.start, end: range.end }));
      return new Response(body, { status: 206, headers: { ...base, 'content-length': String(range.end - range.start + 1), 'content-range': 'bytes ' + range.start + '-' + range.end + '/' + stat.size } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'content-length': String(stat.size) } });
  }

  // A picture a Markdown file names. A web document's pictures are fetched in the tab's own session; a file's pictures are read from
  // beside it. Only an image answer is passed on, and a file document may only name image files.
  async function serveResource(ses, docUrl, target, request) {
    const fromWeb = /^https?:\/\//i.test(docUrl);
    const fromFile = /^file:\/\//i.test(docUrl);
    if (fromFile) {
      if (!/^file:\/\//i.test(target) || !IMAGE_EXT.test(target.replace(/[?#].*$/, ''))) return errorResponse(403, 'Only pictures beside a file can be shown', 'blocked');
      const r = serveFile(target, request);
      if (r.status === 200 || r.status === 206) {
        const ext = nodePath.extname(target.replace(/[?#].*$/, '')).toLowerCase().slice(1);
        const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' }[ext];
        const headers = new Headers(r.headers);
        headers.set('content-type', type || 'application/octet-stream');
        return new Response(r.body, { status: r.status, headers });
      }
      return r;
    }
    if (!fromWeb || !/^https?:\/\//i.test(target)) return errorResponse(403, 'Only web pictures can be shown for a web document', 'blocked');
    let upstream;
    try { upstream = await ses.fetch(target, { headers: { accept: 'image/*,*/*;q=0.5', referer: docUrl.replace(/#.*$/, '') }, redirect: 'follow', credentials: 'include' }); }
    catch (err) { return errorResponse(502, 'The picture could not be fetched: ' + err.message, 'fetch'); }
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !/^image\//i.test(type)) return errorResponse(415, 'That is not a picture', 'blocked');
    return new Response(upstream.body, { status: 200, headers: { 'content-type': type, 'cache-control': 'private, max-age=3600', 'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' } });
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
        if (!original) return errorResponse(400, 'No document named', 'scheme');
        return serveDocument(ses, original, request);
      }
      if (url.pathname === '/res') {
        const docUrl = url.searchParams.get('d'), target = url.searchParams.get('u');
        if (!docUrl || !target) return errorResponse(400, 'No picture named', 'scheme');
        return serveResource(ses, docUrl, target, request);
      }
      return serveStatic(url.pathname);
    };
  }

  function wireSession(ses, partition) {
    if (!ses || !ses.protocol || wired.has(ses)) return;
    wired.add(ses);
    ses.protocol.handle(SCHEME, makeHandler(ses, partition));
  }

  return { SCHEME, HOST, wireSession, makeHandler, roots, entry };
}

// ---- what the viewer asks main to do (every channel checks that the asker is the viewer page) -----------------
// A refusal the page can show in the reader's own language: `code` names the sentence, `args` fill it (the page's strings-tr.js has them).
class Refusal extends Error {
  constructor(code, message, args) { super(message); this.code = code; this.args = args || null; }
}
const failed = (err) => ({ ok: false, error: err.message, code: err.code || null, args: err.args || null });

function viewerSource(event) {
  const frame = event && event.senderFrame;
  const parsed = parseViewerUrl(frame && frame.url);
  if (!parsed || (frame.parent != null)) throw new Refusal('not-viewer', 'Only the document viewer may ask for this');
  return parsed;
}

function suggestedName(original) {
  let n;
  try { n = decodeURIComponent(nodePath.basename(new URL(original).pathname)); } catch { n = ''; }
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120).trim();
  return n || 'document.txt';
}

function uniqueIn(dir, name, fsImpl) {
  const ext = nodePath.extname(name), base = name.slice(0, name.length - ext.length);
  let p = nodePath.join(dir, name);
  for (let n = 2; fsImpl.existsSync(p); n++) p = nodePath.join(dir, base + ' (' + n + ')' + ext);
  return p;
}

// opts: { ipcMain, dialog, windowFor, registry, downloadsDir(), fsImpl? }
function registerTextViewerIpc(opts) {
  const { ipcMain, dialog, windowFor, registry } = opts;
  const fsImpl = opts.fsImpl || nodeFs;
  if (!ipcMain || !dialog || typeof windowFor !== 'function' || !registry) throw new Error('registerTextViewerIpc needs ipcMain, dialog, windowFor and registry');

  // Copies the document, byte for byte, to `target`: a file is copied, a web document is read again in the page's own session.
  async function copyTo(event, original, target) {
    const temp = target + '.vex-tmp';
    try {
      if (/^file:\/\//i.test(original)) {
        await fsImpl.promises.copyFile(fileURLToPath(original.replace(/[?#].*$/, '')), temp);
      } else if (/^https?:\/\//i.test(original)) {
        // The page's own session: the same cookies, the same proxy, the same private or Tor route as the tab.
        const response = await event.sender.session.fetch(original, { headers: { accept: NAVIGATION_ACCEPT }, redirect: 'follow', credentials: 'include' });
        if (!response.ok) throw new Refusal('http-status', 'The server answered ' + response.status + ' when Vex fetched the document again', { status: response.status });
        await pipeline(Readable.fromWeb(response.body), fsImpl.createWriteStream(temp));
      } else throw new Refusal('scheme', 'Only web and file documents can be saved');
      await fsImpl.promises.rename(temp, target);
    } catch (err) {
      try { await fsImpl.promises.rm(temp, { force: true }); } catch { /* vex-allow-empty-catch: the temporary copy is already gone, and the real error is rethrown below */ }
      throw err;
    }
  }

  ipcMain.handle('docview:save-as', async (event, req) => {
    try {
      const src = viewerSource(event);
      const win = windowFor(event);
      const name = (req && typeof req.name === 'string' && req.name.trim()) ? req.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) : suggestedName(src.original);
      const dlg = { title: 'Save the document', defaultPath: uniqueIn(opts.downloadsDir(), name, fsImpl) };
      const picked = win ? await dialog.showSaveDialog(win, dlg) : await dialog.showSaveDialog(dlg);
      if (picked.canceled || !picked.filePath) return { ok: true, cancelled: true };
      if (/^file:\/\//i.test(src.original) && nodePath.resolve(fileURLToPath(src.original.replace(/[?#].*$/, ''))).toLowerCase() === nodePath.resolve(picked.filePath).toLowerCase()) {
        throw new Refusal('same-file', 'That is the file you are reading. Save the copy under another name');
      }
      await copyTo(event, src.original, picked.filePath);
      return { ok: true, cancelled: false, name: nodePath.basename(picked.filePath) };
    } catch (err) { return failed(err); }
  });

  ipcMain.handle('docview:download', async (event) => {
    try {
      const src = viewerSource(event);
      if (/^file:\/\//i.test(src.original)) {
        const target = uniqueIn(opts.downloadsDir(), suggestedName(src.original), fsImpl);
        await copyTo(event, src.original, target);
        return { ok: true, name: nodePath.basename(target), viaDownloads: false };
      }
      // Through the page's own session, so the downloads panel, its scan and the tab's cookies all apply as for any download.
      registry.allowOnce(event.sender.id, src.original);
      event.sender.downloadURL(src.original);
      return { ok: true, viaDownloads: true };
    } catch (err) { return failed(err); }
  });

  ipcMain.handle('docview:open-raw', async (event) => {
    try {
      const src = viewerSource(event);
      registry.allowOnce(event.sender.id, src.original);
      const target = src.source ? 'view-source:' + src.original : src.original + (src.hash ? '#' + src.hash : '');
      await event.sender.loadURL(target);
      return { ok: true };
    } catch (err) {
      if (/ERR_ABORTED|\(-3\)/.test(String(err && err.message))) return { ok: true };
      return failed(err);
    }
  });

  // A link in a Markdown file on disk to another file on disk. The viewer page cannot navigate to file: itself, so main does it,
  // and only from a file document to a file address (a web document gets no way to open local files).
  ipcMain.handle('docview:navigate', async (event, url) => {
    try {
      const src = viewerSource(event);
      if (!/^file:\/\//i.test(src.original) || !/^file:\/\//i.test(String(url))) throw new Refusal('file-only', 'Only a file can link to another file');
      await event.sender.loadURL(isTextFileUrl(url) ? viewerUrl(url) : String(url));
      return { ok: true };
    } catch (err) {
      if (/ERR_ABORTED|\(-3\)/.test(String(err && err.message))) return { ok: true };
      return failed(err);
    }
  });
}

module.exports = {
  createTextViewer, registerTextViewerIpc, viewerUrl, parseViewerUrl, textTypeMatches, isTextFileUrl, fileExtension, parseRange,
  suggestedName, SCHEME, HOST, ID, CSP, MIME, FILE_EXTENSIONS,
};
