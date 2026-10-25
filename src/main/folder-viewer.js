'use strict';
// === Vex's own folder browser: how a folder gets to it, and what its page may ask ===========
//
// Chromium shows a folder (file:///C:/Users/me/) as a plain "Index of" list: no sizes you can sort, no pictures, no
// way to rename or move to the Recycle Bin. Vex shows it with a page of its own instead (src/renderer/folder-viewer).
//
// HOW A FOLDER GETS THERE
//   * A main-frame navigation to a file: address is looked at in the session's onBeforeRequest (one line in
//     main.js's wireAdblockerOnSession: take()). When the path is a folder, the answer is a redirect to
//         vex-files://browse/?u=<the folder's file: address>
//     so the tab makes one ordinary navigation. The tab keeps the folder's own file: address: renderer/js/
//     folder-viewer-host.js maps the viewer's address back before the address bar, history, bookmarks and reload see it.
//   * It happens only for a navigation the PERSON made: typing in the address bar, a bookmark, a Vex page, Back and
//     Forward, or the folder page's own links. A navigation the PAGE made itself (a link or a script in a file: page; will-navigate)
//     is left to Chromium, and a web page cannot reach a file: address at all (Chromium refuses it, and a window.open to
//     one is refused in main.js). A page cannot send a tab to the viewer either: will-navigate, will-redirect and
//     will-frame-navigate refuse a vex-files: address unless the tab is already showing the viewer (guard()).
//   * Only persistent sessions serve the vex-files: scheme. A private window, a private tab, a burner and a Tor tab
//     never get the viewer; they keep Chromium's list, and the channels below refuse them again.
//
// WHAT THE PAGE MAY ASK (every folderview:* channel)
//   * The asker must be the viewer page itself: the TOP frame of a Vex tab, whose address is vex-files://browse/. An
//     iframe, a web page, an extension page or another window is refused.
//   * No channel takes a path. The folder is the one the page's own address names (read from the frame's address, which
//     the browser process vouches for); everything else is a leaf NAME inside that folder (no separator, no colon, no
//     "..": a name cannot reach another folder). The person goes to another folder by navigating, which is a new page.
//   * Nothing is ever deleted for good: "delete" is shell.trashItem, which fails on a drive with no Recycle Bin and
//     then does nothing. Nothing is ever run: a program, script or shortcut is opened only by an explicit second click
//     on the "Open with Windows" warning, and never from a keyboard Enter.
//   * A picture, a sound or a video for the preview is served from vex-files://browse/m/<token>: a token main made for
//     one file, kept only for that tab and dropped when it leaves the page. No path can be named to that address.

const nodeFs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');
const nodeOs = require('os');
const { Readable } = require('stream');
const { execFile: nodeExecFile } = require('child_process');

const SCHEME = 'vex-files';
const HOST = 'browse';
const win = nodePath.win32;

const LIST_TIMEOUT_MS = 20000;
const STAT_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 1500;
const MAX_ENTRIES = 400000;
const STAT_BATCH = 1500;
const THUMB_TIMEOUT_MS = 9000;
const THUMB_CACHE_BYTES = 28 * 1024 * 1024;
const THUMB_MAX_FILE = 60 * 1024 * 1024;
const TEXT_PREVIEW_BYTES = 64 * 1024;
const MEDIA_TOKENS_PER_TAB = 80;
const MEDIA_TOKEN_MS = 30 * 60 * 1000;
const BYPASS_MS = 20000;
const PAGE_NAV_MS = 6000;
// How long after take() answered a navigation with a redirect to the viewer the tab's will-redirect for it is let through (it is take()'s own).
const OWN_REDIRECT_MS = 8000;

// ---- the addresses (the window keeps a twin of the two, js/folder-viewer-host.js; a test holds them equal) -------
function viewerUrl(fileUrl) {
  return SCHEME + '://' + HOST + '/?u=' + encodeURIComponent(String(fileUrl || ''));
}
// -> { fileUrl } or null. Only the viewer page itself (the path is "/"), never /m/<token> or a file of the page.
function parseViewerUrl(url) {
  const s = String(url || '');
  if (!s.toLowerCase().startsWith(SCHEME + '://' + HOST + '/')) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.pathname !== '/') return null;
  const original = u.searchParams.get('u');
  if (!original || !/^file:/i.test(original)) return null;
  return { fileUrl: original };
}
const isViewerAddress = (url) => /^vex-files:\/\/browse\//i.test(String(url || ''));
// Which pages may open a file: address in a new tab: a local file and Vex's own pages, never a page from the web.
const mayOpenFileFrom = (openerUrl) => /^(?:file|vex|vex-files):/i.test(String(openerUrl || ''));

// file: address -> { kind: 'thisPc' } | { kind: 'path', path } | null (not one the browser can show)
function targetOfFileUrl(fileUrl) {
  let u;
  try { u = new URL(String(fileUrl)); } catch { return null; }
  if (u.protocol !== 'file:') return null;
  const host = u.hostname.toLowerCase();
  let pathname = u.pathname;
  // An escaped slash or backslash would make a separator inside a name: no Windows name has one, so no address may either.
  if (/%2f|%5c/i.test(pathname)) return null;
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };   // a lone % (typed as such) stays a %
  pathname = decode(pathname);
  if (/[\u0000-\u001f]/.test(pathname)) return null;
  // One form for a folder's path: no closing backslash, except on a drive or a share root.
  const canon = (p) => {
    const n = win.normalize(p);
    return /^[A-Za-z]:\\$/.test(n) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(n) ? n : n.replace(/\\+$/, '');
  };
  if (!host || host === 'localhost') {
    if (pathname === '/' || pathname === '') return { kind: 'thisPc' };
    const m = /^\/([A-Za-z]:)(\/.*)?$/.exec(pathname);
    if (!m) return null;
    return { kind: 'path', path: canon(m[1].toUpperCase() + (m[2] || '/').replace(/\//g, '\\')) };
  }
  // file://server/share/dir -> \\server\share\dir (a share root needs at least the share)
  const rest = pathname.replace(/\//g, '\\');
  if (!/^\\[^\\]+/.test(rest)) return null;
  if (/^[?.]$/.test(host)) return null;
  return { kind: 'path', path: canon('\\\\' + u.hostname + rest) };
}

function fileUrlOfPath(winPath) {
  const p = String(winPath);
  const enc = (seg) => encodeURIComponent(seg).replace(/%3A/gi, ':');
  const unc = /^\\\\([^\\]+)\\?(.*)$/.exec(p);
  if (unc) return 'file://' + unc[1] + '/' + unc[2].split('\\').filter((s, i, a) => s !== '' || i === a.length - 1).map(enc).join('/');
  const drive = /^([A-Za-z]:)\\?(.*)$/.exec(p);
  if (!drive) throw new Error('Not a Windows path: ' + p);
  return 'file:///' + drive[1] + '/' + drive[2].split('\\').filter(Boolean).map(enc).join('/');
}
// A folder's address as the tab shows it: always with a closing slash.
const folderAddress = (winPath) => { const u = fileUrlOfPath(winPath); return u.endsWith('/') ? u : u + '/'; };

// ---- names ---------------------------------------------------------------------------------
const RESERVED = /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;
// An entry that is already in the folder: a leaf, nothing that could name another place.
const nameError = (message, code) => Object.assign(new Error(message), { code });
function existingName(name) {
  if (typeof name !== 'string' || !name || name.length > 255) throw nameError('That is not a file name', 'VEX_NOTNAME');
  if (/[\\/:\u0000-\u001f]/.test(name) || name === '.' || name === '..') throw nameError('That is not a file name', 'VEX_NOTNAME');
  return name;
}
// A name the person typed for something new or renamed: what Windows itself accepts. The codes are worded by the page (in Turkish too).
function newName(name) {
  if (typeof name !== 'string') throw nameError('Type a name', 'VEX_NAME_EMPTY');
  const n = name.trim();
  if (!n) throw nameError('Type a name', 'VEX_NAME_EMPTY');
  if (n.length > 255) throw nameError('That name is too long', 'VEX_NAME_LONG');
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n)) throw nameError('A name cannot contain any of these: \\ / : * ? " < > |', 'VEX_NAME_CHARS');
  if (n === '.' || n === '..' || /[. ]$/.test(n)) throw nameError('A name cannot end with a dot or a space', 'VEX_NAME_DOT');
  if (RESERVED.test(n)) throw nameError('Windows keeps that name for itself', 'VEX_NAME_RESERVED');
  return n;
}
function inside(dir, name) {
  const full = win.join(dir, existingName(name));
  if (win.dirname(full).replace(/\\$/, '').toLowerCase() !== win.normalize(dir).replace(/\\$/, '').toLowerCase()) throw nameError('That is not a file name', 'VEX_NOTNAME');
  return full;
}

// ---- errors, in codes the page puts in words ---------------------------------------------------
function codeOf(err) {
  const c = err && err.code;
  if (c === 'EACCES' || c === 'EPERM') return 'denied';
  if (c === 'ENOENT') return 'missing';
  if (c === 'ENOTDIR') return 'notdir';
  if (c === 'EEXIST') return 'exists';
  if (c === 'EBUSY' || c === 'ETXTBSY') return 'busy';
  if (c === 'ENAMETOOLONG') return 'toolong';
  if (c === 'ETIMEDOUT' || c === 'VEX_TIMEOUT') return 'timeout';
  if (c === 'ENOTEMPTY') return 'notempty';
  if (c === 'EROFS') return 'readonly';
  if (c === 'ENODEV' || c === 'ENXIO' || c === 'EIO' || c === 'UNKNOWN' || c === 'ENETUNREACH' || c === 'ENOTCONN' || c === 'ECONNRESET' || c === 'EHOSTUNREACH' || c === 'ENETDOWN') return 'gone';
  if (c === 'EMFILE' || c === 'ENFILE') return 'toomany';
  if (c === 'VEX_NOTNAME') return 'notname';
  if (typeof c === 'string' && c.startsWith('VEX_NAME_')) return 'name-' + c.slice(9).toLowerCase();
  return 'other';
}
function withTimeout(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => { const e = new Error((what || 'The drive') + ' did not answer'); e.code = 'VEX_TIMEOUT'; reject(e); }, ms);
    timer.unref?.();
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// ---- what a name looks like (kept in step with renderer/folder-viewer/kinds.js by a test) -------
const THUMB_EXT = new Set(['jpg', 'jpeg', 'jfif', 'png', 'gif', 'bmp', 'webp', 'avif', 'ico', 'tif', 'tiff', 'heic', 'heif',
  'mp4', 'm4v', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'mpg', 'mpeg', 'pdf']);
const DECODE_EXT = new Set(['jpg', 'jpeg', 'jfif', 'png', 'gif', 'bmp', 'webp', 'ico']);       // nativeImage can read these itself
const MEDIA_MIME = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
});
const TEXT_EXT = new Set(['txt', 'log', 'md', 'markdown', 'json', 'jsonc', 'xml', 'html', 'htm', 'xhtml', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'csv', 'tsv', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'py', 'rb', 'php', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'swift',
  'sh', 'bat', 'cmd', 'ps1', 'sql', 'vue', 'svelte', 'gitignore', 'gitattributes', 'editorconfig', 'lock', 'srt', 'vtt', 'tex', 'bib', 'rst', 'svg', 'reg', 'inf', 'url']);
const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i + 1).toLowerCase() : ''; };

// ---- the folder core: everything that touches the disk ---------------------------------------------
// deps: { fs, platform, execFile, clipboard?, shell?, nativeImage?, getFileIcon?, now? }
function createFolderCore(deps = {}) {
  const fs = deps.fs || nodeFs;
  const platform = deps.platform || process.platform;
  const execFile = deps.execFile || nodeExecFile;
  const now = deps.now || Date.now;

  // A path longer than the classic limit is given to Windows in its long form.
  function fsPath(p) {
    if (platform !== 'win32' || p.length < 240 || p.startsWith('\\\\?\\')) return p;
    if (p.startsWith('\\\\')) return '\\\\?\\UNC\\' + p.slice(2);
    return '\\\\?\\' + p;
  }

  function hiddenNames(dir) {
    if (platform !== 'win32') return Promise.resolve({ names: new Set(), known: true });
    // %, and the characters cmd reads even in quotes, would make the command mean something else: those folders are listed
    // without the hidden marks, and the page says so.
    if (/[%^!"]/.test(dir)) return Promise.resolve({ names: new Set(), known: false });
    return new Promise((resolve) => {
      const target = dir.endsWith('\\') ? dir : dir + '\\';
      // /U makes the output of dir UTF-16, so a Turkish (or any) file name comes back whole whatever the console's code page is.
      execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/u', '/s', '/c', '"dir /a:h /b "' + target + '""'],
        { windowsVerbatimArguments: true, windowsHide: true, timeout: 12000, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
          if (err && !(stdout && stdout.length) && err.code !== 1) { resolve({ names: new Set(), known: false }); return; }   // exit code 1 = "File Not Found" = nothing hidden
          const set = new Set();
          for (const line of Buffer.from(stdout || '').toString('utf16le').split(/\r?\n/)) if (line) set.add(line.toLowerCase());
          resolve({ names: set, known: true });
        });
    });
  }

  async function listDrives() {
    const letters = [];
    for (let c = 65; c <= 90; c++) letters.push(String.fromCharCode(c));
    const probes = letters.map(async (l) => {
      const root = l + ':\\';
      try {
        await withTimeout(fs.promises.stat(root), PROBE_TIMEOUT_MS, 'Drive ' + l + ':');
      } catch { return null; }
      let total = 0, free = 0;
      try { const s = await withTimeout(fs.promises.statfs(root), PROBE_TIMEOUT_MS); total = s.blocks * s.bsize; free = s.bavail * s.bsize; } catch { /* vex-allow-empty-catch: a drive that answers but has no size to give is shown without one */ }
      return { letter: l, path: root, url: folderAddress(root), total, free };
    });
    return (await Promise.all(probes)).filter(Boolean);
  }

  // The entries of a folder, quickly: names and kinds only. Sizes and dates come from stat() in batches.
  async function listFolder(dir) {
    const [dirents, hidden] = await Promise.all([
      withTimeout(fs.promises.readdir(fsPath(dir), { withFileTypes: true }), LIST_TIMEOUT_MS, 'The folder'),
      hiddenNames(dir),
    ]);
    const truncated = dirents.length > MAX_ENTRIES;
    const out = new Array(Math.min(dirents.length, MAX_ENTRIES));
    const links = [];
    for (let i = 0; i < out.length; i++) {
      const d = dirents[i];
      const isLink = d.isSymbolicLink();
      const e = { n: d.name, d: d.isDirectory() ? 1 : 0, h: (hidden.names.has(d.name.toLowerCase()) || d.name.startsWith('.')) ? 1 : 0 };
      if (isLink) { e.l = 1; links.push(i); }
      out[i] = e;
    }
    // A link or junction is a folder when what it points to is one.
    for (const i of links.slice(0, 3000)) {
      try { if ((await withTimeout(fs.promises.stat(fsPath(win.join(dir, out[i].n))), PROBE_TIMEOUT_MS)).isDirectory()) out[i].d = 1; } catch { out[i].b = 1; }
    }
    return { entries: out, total: dirents.length, truncated, hiddenKnown: hidden.known };
  }

  // [[size, mtimeMs, flags]] aligned with names; flags: 1 read-only, 2 could not be read.
  async function statNames(dir, names) {
    if (!Array.isArray(names) || names.length > STAT_BATCH) throw new Error('Too many names at once');
    const out = new Array(names.length);
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= names.length) return;
        const full = inside(dir, names[i]);
        try {
          let st;
          try { st = await withTimeout(fs.promises.stat(fsPath(full)), STAT_TIMEOUT_MS); } catch { st = await withTimeout(fs.promises.lstat(fsPath(full)), STAT_TIMEOUT_MS); }
          out[i] = [st.isDirectory() ? -1 : st.size, Math.round(st.mtimeMs), (st.mode & 0o200) === 0 ? 1 : 0];
        } catch { out[i] = [-1, 0, 2]; }
      }
    }
    await Promise.all(Array.from({ length: 24 }, worker));
    return out;
  }

  // ---- folder size, on demand: a task the page polls ----
  const sizeTasks = new Map();
  function sizeStart(owner, dir, name) {
    const root = inside(dir, name);
    const id = crypto.randomBytes(8).toString('hex');
    const task = { id, owner, files: 0, dirs: 0, bytes: 0, errors: 0, done: false, cancelled: false, partial: false, started: now() };
    sizeTasks.set(id, task);
    (async () => {
      const stack = [root];
      let seen = 0;
      try {
        while (stack.length && !task.cancelled) {
          if (now() - task.started > 10 * 60 * 1000 || seen > 20000000) { task.partial = true; break; }
          const here = stack.pop();
          let dirents;
          try { dirents = await withTimeout(fs.promises.readdir(fsPath(here), { withFileTypes: true }), LIST_TIMEOUT_MS); }
          catch { task.errors++; continue; }
          const files = [];
          for (const d of dirents) {
            seen++;
            if (d.isSymbolicLink()) { task.files++; continue; }   // a link is counted, never followed
            if (d.isDirectory()) { task.dirs++; stack.push(win.join(here, d.name)); } else files.push(d.name);
          }
          let at = 0;
          const pool = Array.from({ length: Math.min(16, files.length) }, async () => {
            for (;;) {
              const i = at++;
              if (i >= files.length || task.cancelled) return;
              try { task.bytes += (await fs.promises.lstat(fsPath(win.join(here, files[i])))).size; task.files++; }
              catch { task.errors++; }
            }
          });
          await Promise.all(pool);
        }
      } catch (err) { task.error = err.message; }
      task.done = true;
      setTimeout(() => sizeTasks.delete(id), 5 * 60 * 1000).unref?.();
    })();
    return id;
  }
  function sizePoll(owner, id) {
    const t = sizeTasks.get(id);
    if (!t || t.owner !== owner) throw new Error('That count is not running');
    return { files: t.files, dirs: t.dirs, bytes: t.bytes, errors: t.errors, done: t.done, cancelled: t.cancelled, partial: t.partial, error: t.error || null };
  }
  function sizeCancel(owner, id) {
    const t = sizeTasks.get(id);
    if (t && t.owner === owner) t.cancelled = true;
    return true;
  }
  function sizeCancelAll(owner) { for (const t of sizeTasks.values()) if (t.owner === owner) t.cancelled = true; }

  // ---- previews ----
  async function readHead(file, bytes) {
    const handle = await fs.promises.open(fsPath(file), 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }
  function decodeText(buf) {
    let enc = 'utf-8', body = buf;
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) body = buf.subarray(3);
    else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) { enc = 'utf-16le'; body = buf.subarray(2); }
    else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { enc = 'utf-16le'; body = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))).swap16(); }
    else if (buf.subarray(0, 8192).includes(0)) return null;
    const text = new TextDecoder(enc, { fatal: false }).decode(body);
    const bad = (text.match(/\ufffd/g) || []).length;
    if (text.length && bad / text.length > 0.02) return null;
    return { text, encoding: enc === 'utf-8' ? 'UTF-8' : 'UTF-16' };
  }
  async function previewOf(dir, name, st) {
    const ext = extOf(name);
    if (st.isDirectory()) return { kind: 'folder' };
    const full = inside(dir, name);
    if (MEDIA_MIME[ext] && !(ext === 'svg' && st.size > 5 * 1024 * 1024)) {
      const family = MEDIA_MIME[ext].split('/')[0];
      return { kind: family, mime: MEDIA_MIME[ext], size: st.size };
    }
    if (ext === 'pdf' || THUMB_EXT.has(ext)) return { kind: 'thumb', size: st.size };
    if (TEXT_EXT.has(ext) || (!ext && st.size < 2 * 1024 * 1024)) {
      if (st.size === 0) return { kind: 'text', text: '', truncated: false, encoding: 'UTF-8', size: 0 };
      const head = await withTimeout(readHead(full, TEXT_PREVIEW_BYTES), STAT_TIMEOUT_MS, 'The file');
      const decoded = decodeText(head);
      if (!decoded) return { kind: 'none', size: st.size };
      return { kind: (ext === 'md' || ext === 'markdown') ? 'markdown' : 'text', text: decoded.text, encoding: decoded.encoding, truncated: st.size > head.length, size: st.size };
    }
    return { kind: 'none', size: st.size };
  }

  return { fsPath, hiddenNames, listDrives, listFolder, statNames, sizeStart, sizePoll, sizeCancel, sizeCancelAll, previewOf, readHead, decodeText };
}

// ---- thumbnails: made when asked, kept in memory only --------------------------------------------
function createThumbnails({ fs = nodeFs, nativeImage, platform = process.platform, fsPath = (p) => p }) {
  const cache = new Map();   // key -> { url, bytes }
  let cached = 0;
  let running = 0;
  const waiting = [];
  const MAX_PARALLEL = 3;
  function acquire() {
    return new Promise((resolve) => { if (running < MAX_PARALLEL) { running++; resolve(); } else waiting.push(resolve); });
  }
  function release() { const next = waiting.shift(); if (next) next(); else running--; }

  function remember(key, url) {
    const bytes = url.length;
    cache.set(key, { url, bytes });
    cached += bytes;
    while (cached > THUMB_CACHE_BYTES && cache.size) {
      const oldest = cache.keys().next().value;
      cached -= cache.get(oldest).bytes;
      cache.delete(oldest);
    }
  }

  async function make(file, size, st) {
    const ext = extOf(file);
    if (!THUMB_EXT.has(ext)) throw Object.assign(new Error('No picture for this kind of file'), { code: 'VEX_NOTHUMB' });
    if (st.size > THUMB_MAX_FILE && !(ext === 'pdf' || /^(mp4|m4v|mkv|avi|mov|webm|wmv|mpg|mpeg)$/.test(ext))) throw Object.assign(new Error('That file is too large to draw here'), { code: 'VEX_NOTHUMB' });
    let image = null;
    if (typeof nativeImage.createThumbnailFromPath === 'function' && platform === 'win32') {
      try { image = await withTimeout(nativeImage.createThumbnailFromPath(fsPath(file), { width: size, height: size }), THUMB_TIMEOUT_MS, 'The picture'); }
      catch (err) { if (!DECODE_EXT.has(ext)) throw err; }
    }
    if ((!image || image.isEmpty()) && DECODE_EXT.has(ext) && st.size <= 30 * 1024 * 1024) {
      const whole = nativeImage.createFromBuffer(await fs.promises.readFile(fsPath(file)));
      if (!whole.isEmpty()) {
        const { width, height } = whole.getSize();
        const scale = Math.min(1, size / Math.max(width, height));
        image = scale < 1 ? whole.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : whole;
      }
    }
    if (!image || image.isEmpty()) throw Object.assign(new Error('No picture could be made'), { code: 'VEX_NOTHUMB' });
    return size >= 256 ? 'data:image/jpeg;base64,' + image.toJPEG(82).toString('base64') : image.toDataURL();
  }

  async function get(file, size) {
    const wanted = Math.max(64, Math.min(512, Math.round(Number(size) / 32) * 32 || 128));
    const st = await withTimeout(fs.promises.stat(fsPath(file)), STAT_TIMEOUT_MS);
    if (st.isDirectory()) throw Object.assign(new Error('A folder has no picture'), { code: 'VEX_NOTHUMB' });
    const key = file.toLowerCase() + '|' + st.mtimeMs + '|' + st.size + '|' + wanted;
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit.url; }
    await acquire();
    try {
      const url = await make(file, wanted, st);
      remember(key, url);
      return url;
    } finally { release(); }
  }
  return { get, cache, stats: () => ({ entries: cache.size, bytes: cached }), clear: () => { cache.clear(); cached = 0; } };
}

// ---- the viewer: the catch, the page, the guards ------------------------------------------------------
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
});
// The page runs scripts from itself only and reaches nothing but itself: a file name cannot make it call out.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return { invalid: true };
  return { start, end };
}

// deps: { rendererDir, fs?, core?, isEnabled(), look() -> { theme, guiStyle, lang }, owner(contents), partitionOf(contents), now? }
function createFolderViewer(deps) {
  const fs = deps.fs || nodeFs;
  const rendererDir = deps.rendererDir;
  if (!rendererDir) throw new Error('createFolderViewer needs rendererDir');
  const now = deps.now || Date.now;
  const isEnabled = deps.isEnabled || (() => true);
  const core = deps.core || createFolderCore({ fs });
  const roots = {
    app: nodePath.join(rendererDir, 'folder-viewer'),
    css: nodePath.join(rendererDir, 'css'),
    fonts: nodePath.join(rendererDir, 'fonts'),
  };
  const bypass = new Map();      // `${webContentsId} ${path}` -> expiry
  const pageNav = new Map();     // webContentsId -> { key, at }: a navigation the PAGE started
  const ownRedirect = new Map(); // webContentsId -> when take() sent that tab to the viewer: the guard lets that one redirect through
  const guarded = new WeakSet();
  const wired = new WeakSet();
  const tokens = new Map();      // token -> { file, mime, owner, until }

  const key = (id, p) => id + ' ' + String(p).toLowerCase().replace(/[\\/]+$/, '');

  function allowOnce(webContentsId, fileUrl) {
    const t = targetOfFileUrl(fileUrl);
    if (t && t.path) bypass.set(key(webContentsId, t.path), now() + BYPASS_MS);
  }

  function isGuest(wc) {
    try {
      if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || !deps.owner(wc)) return false;
      const part = String(deps.partitionOf(wc) || '');
      if (!part.startsWith('persist:') || part === 'persist:route-tor') return false;
      if (wc.session && wc.session.__vexTor) return false;
      return true;
    } catch { return false; }
  }

  // ---- the catch: called with the details and the callback of onBeforeRequest. true = answered (now or soon) ----
  function take(details, callback) {
    if (!details || details.resourceType !== 'mainFrame' || !/^file:/i.test(String(details.url || '')) || !isEnabled()) return false;
    const wc = details.webContents;
    if (!isGuest(wc)) return false;
    if (deps.isOwnFile && deps.isOwnFile(details.url)) return false;
    const target = targetOfFileUrl(details.url);
    if (!target) return false;
    const id = wc.id;
    const mark = pageNav.get(id);
    if (target.kind === 'path') {
      if (mark && now() - mark.at < PAGE_NAV_MS && mark.key === key(id, target.path)) return false;   // the page's own link: Chromium's list
      const until = bypass.get(key(id, target.path));
      if (until != null) { bypass.delete(key(id, target.path)); if (until > now()) return false; }
    } else if (mark && now() - mark.at < PAGE_NAV_MS && mark.key === key(id, '/')) return false;
    if (target.kind === 'thisPc') { ownRedirect.set(id, now()); callback({ redirectURL: viewerUrl('file:///') }); return true; }
    // A path that is a folder goes to the viewer. A file (the common case) is let through untouched. A share that does not answer
    // is sent to the viewer too, which says so and offers to try again, rather than leaving the tab waiting.
    const shown = details.url;
    const toViewer = { redirectURL: viewerUrl(folderAddress(target.path)) };
    withTimeout(fs.promises.stat(core.fsPath(target.path)), PROBE_TIMEOUT_MS, 'The location').then(
      (st) => (st.isDirectory() ? toViewer : { cancel: false }),
      (err) => (err && err.code === 'VEX_TIMEOUT' && /\/$/.test(shown) ? toViewer : { cancel: false }),
    ).then((answer) => { if (answer && answer.redirectURL) ownRedirect.set(id, now()); return answer; }).then(callback).catch((err) => { console.error('[Folder browser] could not look at', details.url, '-', err.message); callback({ cancel: false }); });
    return true;
  }

  // ---- guards on a tab: a page cannot send itself or anyone to the viewer ----
  function guard(contents) {
    if (!contents || guarded.has(contents)) return;
    guarded.add(contents);
    const id = contents.id;
    const showingViewer = () => { try { return !!parseViewerUrl(contents.getURL()); } catch { return false; } };
    // A page of Vex's own (the New Tab page, the folder page itself) is the person's: a link in it to a folder opens the folder browser.
    const onVexPage = () => { try { const u = contents.getURL(); return /^(?:vex|vex-files):/i.test(u) || !!(deps.isOwnFile && deps.isOwnFile(u)); } catch { return false; } };
    contents.on('will-navigate', (event, url) => {
      const to = (event && event.url) || url;
      if (isViewerAddress(to)) { if (!showingViewer() && !onVexPage()) event.preventDefault(); return; }
      const t = /^file:/i.test(String(to || '')) ? targetOfFileUrl(to) : null;
      if (t && !onVexPage()) pageNav.set(id, { key: key(id, t.kind === 'path' ? t.path : '/'), at: now() });
    });
    // A redirect to the viewer is refused unless it is the one take() just sent this tab on (the person's own navigation to a folder):
    // a web page or a server cannot redirect a tab there.
    contents.on('will-redirect', (event, url) => {
      if (!isViewerAddress((event && event.url) || url)) return;
      const at = ownRedirect.get(id);
      if (at != null && now() - at < OWN_REDIRECT_MS) { ownRedirect.delete(id); return; }
      event.preventDefault();
    });
    contents.on('will-frame-navigate', (details) => {
      if (!details || !isViewerAddress(details.url)) return;
      if (!details.isMainFrame || !showingViewer()) details.preventDefault();
    });
    contents.on('did-start-navigation', (details) => {
      const d = details && typeof details === 'object' && 'isMainFrame' in details ? details : null;
      if (d && d.isMainFrame && !d.isSameDocument) dropTokensOf(id);
    });
    contents.once('destroyed', () => { dropTokensOf(id); pageNav.delete(id); ownRedirect.delete(id); core.sizeCancelAll(id); });
  }

  // ---- media tokens ----
  function mintToken(owner, file, mime) {
    for (const [t, v] of tokens) if (v.until < now()) tokens.delete(t);
    const mine = [...tokens.entries()].filter(([, v]) => v.owner === owner);
    while (mine.length >= MEDIA_TOKENS_PER_TAB) tokens.delete(mine.shift()[0]);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, { file, mime, owner, until: now() + MEDIA_TOKEN_MS });
    return SCHEME + '://' + HOST + '/m/' + token;
  }
  function dropTokensOf(owner) { for (const [t, v] of tokens) if (v.owner === owner) tokens.delete(t); }

  // ---- the protocol ----
  function secureHeaders(type, extra) {
    return { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache', 'cross-origin-resource-policy': 'same-origin', ...(extra || {}) };
  }
  function servePage() {
    const file = nodePath.join(roots.app, 'viewer.html');
    let html;
    try { html = fs.readFileSync(file, 'utf8'); } catch (err) { return new Response('The folder browser page is missing: ' + err.message, { status: 500 }); }
    const look = deps.look ? deps.look() : { theme: 'oxford', guiStyle: 'classic', lang: 'en' };
    const safe = (v, re, d) => (typeof v === 'string' && re.test(v) ? v : d);
    const theme = safe(look.theme, /^[a-z]+(?:-[a-z]+)*$/, 'oxford'), gui = safe(look.guiStyle, /^[a-z0-9-]+$/, 'classic'), lang = safe(look.lang, /^[a-z]{2}$/, 'en');
    html = html.replace('<html lang="en">', '<html lang="' + lang + '" data-theme="' + theme + '" data-gui-style="' + gui + '">');
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
  async function serveMedia(token, request) {
    const t = tokens.get(token);
    if (!t || t.until < now()) return new Response('Not found', { status: 404 });
    let st;
    try { st = await fs.promises.stat(core.fsPath(t.file)); } catch { return new Response('That file is not there', { status: 404 }); }
    if (!st.isFile()) return new Response('That is not a file', { status: 404 });
    const range = parseRange(request.headers.get('range'), st.size);
    const base = { 'content-type': t.mime, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin' };
    if (st.size === 0) return new Response(null, { status: 200, headers: { ...base, 'content-length': '0' } });
    if (range && range.invalid) return new Response(null, { status: 416, headers: { ...base, 'content-range': 'bytes */' + st.size } });
    if (range) {
      const body = Readable.toWeb(fs.createReadStream(core.fsPath(t.file), { start: range.start, end: range.end }));
      return new Response(body, { status: 206, headers: { ...base, 'content-length': String(range.end - range.start + 1), 'content-range': 'bytes ' + range.start + '-' + range.end + '/' + st.size } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(core.fsPath(t.file))), { status: 200, headers: { ...base, 'content-length': String(st.size) } });
  }
  function makeHandler() {
    return async (request) => {
      let url;
      try { url = new URL(request.url); } catch { return new Response('Bad address', { status: 400 }); }
      if (url.hostname !== HOST) return new Response('Not found', { status: 404 });
      if (url.pathname === '/' || url.pathname === '/index.html') return servePage();
      const media = /^\/m\/([0-9a-f]{48})$/.exec(url.pathname);
      if (media) return serveMedia(media[1], request);
      return serveStatic(url.pathname);
    };
  }
  // Persistent sessions only: a private, burner or Tor session does not know the scheme at all.
  function wireSession(ses, partition) {
    if (!ses || !ses.protocol || wired.has(ses)) return false;
    const part = String(partition || '');
    if (!part.startsWith('persist:') || part === 'persist:route-tor' || ses.__vexTor) return false;
    wired.add(ses);
    ses.protocol.handle(SCHEME, makeHandler());
    return true;
  }

  return { SCHEME, HOST, take, guard, wireSession, allowOnce, isGuest, makeHandler, mintToken, dropTokensOf, core, roots, tokens, enabled: isEnabled,
    // The small shape the document viewers share (a registry entry): what it is called, its scheme, and how a navigation is caught.
    entry: { id: 'folders', scheme: SCHEME, take, wireSession, guard, viewerUrl, parseViewerUrl } };
}

// ---- what the page asks (every channel checks that the asker is the viewer page) ---------------------
// opts: { ipcMain, shell, clipboard, nativeImage, getFileIcon, viewer, fsImpl?, execFile?, platform?, homedir?, getPath?(name) }
function registerFolderViewerIpc(opts) {
  const { ipcMain, shell, clipboard, viewer } = opts;
  if (!ipcMain || !shell || !clipboard || !viewer) throw new Error('registerFolderViewerIpc needs ipcMain, shell, clipboard and viewer');
  const fs = opts.fsImpl || nodeFs;
  const platform = opts.platform || process.platform;
  const core = viewer.core;
  const thumbs = createThumbnails({ fs, nativeImage: opts.nativeImage, platform, fsPath: core.fsPath });
  const { RUNNABLE } = opts.runnable ? { RUNNABLE: opts.runnable } : require('./file-check');

  // -> { kind: 'thisPc' } | { kind: 'folder', dir, fileUrl }
  function sourceOf(event) {
    const frame = event && event.senderFrame;
    if (!frame || frame.parent != null) throw new Error('Only the folder browser may ask for this');
    const parsed = parseViewerUrl(frame.url);
    if (!parsed) throw new Error('Only the folder browser may ask for this');
    if (!viewer.enabled()) throw new Error('The folder browser is switched off');
    if (!viewer.isGuest(event.sender)) throw new Error('The folder browser is not available in this tab');
    const target = targetOfFileUrl(parsed.fileUrl);
    if (!target) throw new Error('That is not a folder address');
    if (target.kind === 'thisPc') return { kind: 'thisPc', fileUrl: 'file:///' };
    return { kind: 'folder', dir: target.path, fileUrl: folderAddress(target.path) };
  }
  function folderOf(event) {
    const s = sourceOf(event);
    if (s.kind !== 'folder') throw new Error('This is the list of drives, open a drive first');
    return s;
  }
  const reply = (fn) => async (event, ...args) => {
    try { return { ok: true, ...(await fn(event, ...args)) }; }
    catch (err) { return { ok: false, code: codeOf(err), error: (err && err.message) || String(err) }; }
  };
  const ownerId = (event) => event.sender.id;

  ipcMain.handle('folderview:list', reply(async (event) => {
    const s = sourceOf(event);
    if (s.kind === 'thisPc') return { kind: 'thisPc', drives: await core.listDrives() };
    const parent = win.dirname(s.dir);
    const isRoot = parent === s.dir;
    // A file where a folder was expected: the page offers to open it as a file.
    const st = await withTimeout(fs.promises.stat(core.fsPath(s.dir)), STAT_TIMEOUT_MS, 'The location');
    if (!st.isDirectory()) return { kind: 'file', path: s.dir, name: win.basename(s.dir), size: st.size, fileUrl: s.fileUrl };
    const listed = await core.listFolder(s.dir);
    return {
      kind: 'folder', path: s.dir, name: win.basename(s.dir) || s.dir, fileUrl: s.fileUrl, root: isRoot, mtimeMs: Math.round(st.mtimeMs),
      parentUrl: isRoot ? (s.dir.startsWith('\\\\') ? null : 'file:///') : folderAddress(parent),
      entries: listed.entries, total: listed.total, truncated: listed.truncated, hiddenKnown: listed.hiddenKnown,
    };
  }));

  ipcMain.handle('folderview:stat', reply(async (event, req) => {
    const s = folderOf(event);
    return { stats: await core.statNames(s.dir, req.names) };
  }));

  ipcMain.handle('folderview:ping', reply(async (event) => {
    const s = sourceOf(event);
    if (s.kind === 'thisPc') return { exists: true, mtimeMs: 0 };
    try { const st = await withTimeout(fs.promises.stat(core.fsPath(s.dir)), PROBE_TIMEOUT_MS * 2, 'The folder'); return { exists: st.isDirectory(), mtimeMs: Math.round(st.mtimeMs) }; }
    catch (err) { return { exists: false, code: codeOf(err), mtimeMs: 0 }; }
  }));

  ipcMain.handle('folderview:places', reply(async (event) => {
    sourceOf(event);
    const names = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'];
    const out = [];
    const home = opts.homedir ? opts.homedir() : nodeOs.homedir();
    if (home) out.push({ id: 'home', url: folderAddress(home) });
    for (const n of names) {
      let p;
      try { p = opts.getPath ? opts.getPath(n) : null; } catch { p = null; }
      if (!p) continue;
      try { if ((await fs.promises.stat(core.fsPath(p))).isDirectory()) out.push({ id: n, url: folderAddress(p) }); } catch { /* vex-allow-empty-catch: a known folder that is not there is simply not listed */ }
    }
    return { places: out };
  }));

  ipcMain.handle('folderview:thumb', reply(async (event, req) => {
    const s = folderOf(event);
    const url = await thumbs.get(inside(s.dir, req.name), req.size);
    return { url };
  }));

  ipcMain.handle('folderview:preview', reply(async (event, req) => {
    const s = folderOf(event);
    const full = inside(s.dir, req.name);
    const st = await withTimeout(fs.promises.stat(core.fsPath(full)), STAT_TIMEOUT_MS, 'The file');
    const p = await core.previewOf(s.dir, req.name, st);
    if (p.mime) p.url = viewer.mintToken(ownerId(event), full, p.mime);
    if (p.kind === 'thumb') { try { p.thumb = await thumbs.get(full, 512); } catch (err) { if (err.code !== 'VEX_NOTHUMB') p.thumbError = err.message; } }
    return { preview: p };
  }));

  ipcMain.handle('folderview:size-start', reply(async (event, req) => {
    const s = folderOf(event);
    const full = inside(s.dir, req.name);
    const st = await withTimeout(fs.promises.stat(core.fsPath(full)), STAT_TIMEOUT_MS, 'The folder');
    if (!st.isDirectory()) throw new Error('That is a file, its size is already shown');
    return { id: core.sizeStart(ownerId(event), s.dir, req.name) };
  }));
  ipcMain.handle('folderview:size-poll', reply(async (event, req) => { sourceOf(event); return { progress: core.sizePoll(ownerId(event), req.id) }; }));
  ipcMain.handle('folderview:size-cancel', reply(async (event, req) => { sourceOf(event); core.sizeCancel(ownerId(event), req.id); return {}; }));

  // Open with the program Windows picks. A program, script or shortcut needs `confirmed`, which the page sends only after its
  // own warning has been accepted with a click.
  ipcMain.handle('folderview:external', reply(async (event, req) => {
    const s = folderOf(event);
    const full = inside(s.dir, req.name);
    const st = await withTimeout(fs.promises.stat(core.fsPath(full)), STAT_TIMEOUT_MS, 'The file');
    if (st.isDirectory()) { const r = await shell.openPath(full); if (r) throw new Error(r); return {}; }
    if (RUNNABLE.test(req.name) && req.confirmed !== true) return { needsConfirm: true };
    const r = await shell.openPath(full);
    if (r) throw new Error(r);
    return {};
  }));

  ipcMain.handle('folderview:reveal', reply(async (event, req) => {
    const s = folderOf(event);
    if (req && req.name) {
      const full = inside(s.dir, req.name);
      await withTimeout(fs.promises.stat(core.fsPath(full)), STAT_TIMEOUT_MS, 'The file');
      shell.showItemInFolder(full);
    } else {
      const r = await shell.openPath(s.dir);
      if (r) throw new Error(r);
    }
    return {};
  }));

  ipcMain.handle('folderview:mkdir', reply(async (event, req) => {
    const s = folderOf(event);
    const name = newName(req.name);
    await fs.promises.mkdir(core.fsPath(inside(s.dir, name)));
    return { name };
  }));

  ipcMain.handle('folderview:rename', reply(async (event, req) => {
    const s = folderOf(event);
    const from = inside(s.dir, req.name);
    const name = newName(req.to);
    const to = inside(s.dir, name);
    const sameAsFrom = from.toLowerCase() === to.toLowerCase();
    if (!sameAsFrom) {
      let taken = true;
      try { await fs.promises.lstat(core.fsPath(to)); } catch (err) { if (err.code === 'ENOENT') taken = false; else throw err; }
      if (taken) { const e = new Error('Something with that name is already here'); e.code = 'EEXIST'; throw e; }
    }
    await fs.promises.rename(core.fsPath(from), core.fsPath(to));
    return { name };
  }));

  // To the Recycle Bin and nowhere else. A drive without one (a network share, some USB drives) refuses, and nothing is deleted.
  ipcMain.handle('folderview:trash', reply(async (event, req) => {
    const s = folderOf(event);
    if (req.confirmed !== true) throw new Error('Deleting needs the person\'s yes');
    const results = [];
    for (const name of req.names) {
      try { await shell.trashItem(inside(s.dir, name)); results.push({ name, ok: true }); }
      catch (err) { results.push({ name, ok: false, code: codeOf(err), error: (err && err.message) || String(err) }); }
    }
    return { results };
  }));

  ipcMain.handle('folderview:copy', reply(async (event, req) => {
    const s = sourceOf(event);
    let text;
    if (s.kind === 'thisPc') text = 'file:///';
    else if (!req.names || !req.names.length) text = req.as === 'url' ? s.fileUrl : s.dir;
    else {
      text = req.names.map((n) => {
        const full = inside(s.dir, n);
        return req.as === 'url' ? folderAddress(full).replace(/\/$/, '') : req.as === 'name' ? n : full;
      }).join('\r\n');
    }
    clipboard.writeText(text);
    return { count: req.names ? req.names.length : 0 };
  }));

  ipcMain.handle('folderview:drag', reply(async (event, req) => {
    const s = folderOf(event);
    const files = req.names.map((n) => inside(s.dir, n));
    for (const f of files) await withTimeout(fs.promises.stat(core.fsPath(f)), STAT_TIMEOUT_MS, 'The file');
    const icon = await opts.getFileIcon(files[0], { size: 'normal' });
    if (event.sender.isDestroyed()) throw new Error('The window is gone');
    event.sender.startDrag(files.length > 1 ? { file: files[0], files, icon } : { file: files[0], icon });
    return {};
  }));

  // Open in Chromium's plain list for this folder, once.
  ipcMain.handle('folderview:plain-list', reply(async (event) => {
    const s = folderOf(event);
    viewer.allowOnce(event.sender.id, s.fileUrl);
    await event.sender.loadURL(s.fileUrl);
    return {};
  }));

  // A file where a folder was expected: loaded as a file, once.
  ipcMain.handle('folderview:open-as-file', reply(async (event) => {
    const s = folderOf(event);
    viewer.allowOnce(event.sender.id, s.fileUrl);
    await event.sender.loadURL(s.fileUrl.replace(/\/$/, ''));
    return {};
  }));

  return { thumbs };
}

module.exports = {
  createFolderViewer, createFolderCore, createThumbnails, registerFolderViewerIpc,
  viewerUrl, parseViewerUrl, isViewerAddress, mayOpenFileFrom, targetOfFileUrl, fileUrlOfPath, folderAddress, existingName, newName, inside, codeOf, withTimeout, parseRange, extOf,
  SCHEME, HOST, CSP, MIME, MEDIA_MIME, TEXT_EXT, THUMB_EXT, STAT_BATCH,
};
