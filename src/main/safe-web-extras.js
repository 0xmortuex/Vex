// === Safe-by-default web, the small extras (Wave 4 fold-ins) ================
//
// Three read-only helpers for the web-safety layer (web-safety.js). Nothing
// here looks anything up and nothing is sent anywhere: an address, a file name,
// the file itself on this computer, and the cookie jar's own list are enough.
//
//   describeDownload   a download that explains itself: where it came from,
//                      what kind of file it really is, how big, and what to
//                      open it with (and whether to).
//   hashFile           the SHA-256 of a finished download, for comparing with
//                      the publisher's page. Streamed, size-capped.
//   thirdPartyCounts   how many other sites a page talked to and how many of
//                      them keep cookies here. A count of domains and cookies;
//                      never a name or a value of a cookie.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { registrable, bareHost, KIND_BY_EXT } = require('./web-safety');

// --- downloads -------------------------------------------------------------

const MAX_HASH_BYTES = 2 * 1024 * 1024 * 1024;

function humanSize(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
  if (b < 1024 ** 3) return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  return (b / 1024 ** 3).toFixed(1) + ' GB';
}

// ext -> { kind, word, openWith, care }. `care` is the one sentence worth
// saying before opening; empty for plain documents and media.
const TYPES = {};
const add = (exts, entry) => { for (const e of exts.split(' ')) TYPES[e] = entry; };
add('pdf', { kind: 'document', word: 'a PDF document', openWith: 'Vex or your PDF reader.', care: '' });
add('doc docx rtf odt', { kind: 'document', word: 'a Word-style document', openWith: 'Word or LibreOffice.', care: '' });
add('xls xlsx ods csv', { kind: 'document', word: 'a spreadsheet', openWith: 'Excel or LibreOffice.', care: '' });
add('ppt pptx odp', { kind: 'document', word: 'a presentation', openWith: 'PowerPoint or LibreOffice.', care: '' });
add('docm xlsm pptm dotm xlam', { kind: 'macro', word: 'an Office file that can carry macros', openWith: 'Word, Excel or PowerPoint, in Protected View.', care: 'If it asks you to enable editing or macros, do not unless you were expecting exactly this file.' });
add('txt md log json xml', { kind: 'text', word: 'a plain text file', openWith: 'Notepad or any text editor.', care: '' });
add('jpg jpeg png gif webp bmp svg heic avif', { kind: 'image', word: 'a picture', openWith: 'Photos or Vex.', care: '' });
add('mp3 wav flac m4a ogg opus', { kind: 'audio', word: 'a sound file', openWith: 'Media Player or VLC.', care: '' });
add('mp4 mkv avi mov webm wmv', { kind: 'video', word: 'a video', openWith: 'Media Player or VLC.', care: '' });
add('zip rar 7z tar gz tgz', { kind: 'archive', word: 'a compressed folder', openWith: 'File Explorer (zip) or 7-Zip.', care: 'Look inside before you run anything it holds.' });
add('iso img vhd vhdx dmg', { kind: 'installer', word: 'a disk image', openWith: 'File Explorer mounts it as a drive.', care: 'Open it only if it came from the publisher you meant to get it from.' });
add('exe msi msix msixbundle appx appxbundle appinstaller scr com pif cpl msp jar', { kind: 'program', word: 'a program', openWith: 'Nothing, until you are sure: it runs as soon as it is opened.', care: 'Run it only if you chose to install this software and got it from its publisher.' });
add('bat cmd ps1 psm1 vbs vbe js jse wsf wsh hta reg lnk sh command py url scf', { kind: 'script', word: 'a script', openWith: 'A text editor (right-click, Edit), not a double-click.', care: 'A script can change anything you can. Open it in an editor and read it first.' });
add('torrent', { kind: 'other', word: 'a torrent file', openWith: 'A torrent app.', care: '' });
add('apk', { kind: 'installer', word: 'an Android app', openWith: 'An Android phone, not this computer.', care: 'Install apps from the store, not from a file.' });

// Which content types are plausible for an extension. A download whose
// declared type contradicts its ending (a "picture" served as an executable)
// is worth one plain sentence; an ordinary generic type is not.
const GENERIC_MIME = /^(application\/octet-stream|binary\/octet-stream|application\/force-download|application\/download|application\/x-download|)$/;
const MIME_FOR_KIND = {
  document: /^(application\/(pdf|msword|rtf|vnd\.|x-)|text\/)/,
  macro: /^application\/(vnd\.|x-|msword|octet)/,
  text: /^(text\/|application\/(json|xml))/,
  image: /^image\//,
  audio: /^(audio\/|application\/ogg)/,
  video: /^(video\/|application\/(mp4|ogg))/,
  archive: /^application\/(zip|x-|gzip|vnd\.rar|octet)/,
};
const RUNNABLE_MIME = /^application\/(x-msdownload|x-msdos-program|x-msi|vnd\.microsoft\.portable-executable|x-dosexec|x-sh|x-bat|java-archive|x-executable)/;

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,12})\s*$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

// -> { host, fromPage, type, kind, size, mime, openWith, care, mismatch, lines[] }
function describeDownload({ url = '', pageUrl = '', fileName = '', mime = '', totalBytes = 0, receivedBytes = 0 } = {}) {
  let host = '';
  try { const u = new URL(String(url)); if (/^https?:$/.test(u.protocol)) host = bareHost(u.hostname); } catch { /* vex-allow-empty-catch: a blob: or data: address has no host to name */ }
  let fromPage = '';
  try { const u = new URL(String(pageUrl)); if (/^https?:$/.test(u.protocol)) fromPage = bareHost(u.hostname); } catch { /* vex-allow-empty-catch: no page address is not an error */ }
  const ext = extOf(fileName);
  const t = TYPES[ext] || null;
  const declared = String(mime || '').split(';')[0].trim().toLowerCase();
  const kind = t ? t.kind : (KIND_BY_EXT[ext] || 'other');
  const size = humanSize(receivedBytes || totalBytes);
  const out = {
    host, fromPage, ext, kind, mime: declared, size,
    type: t ? t.word : (ext ? `a .${ext} file` : 'a file with no ending'),
    openWith: t ? t.openWith : 'Check what it is before you open it.',
    care: t ? t.care : (ext ? '' : 'A file with no ending cannot be told apart from a program by its name.'),
    mismatch: '', lines: [],
  };
  // Contradiction between what the server says and what the name says.
  if (declared && !GENERIC_MIME.test(declared)) {
    if (RUNNABLE_MIME.test(declared) && !['program', 'script', 'installer'].includes(kind)) {
      out.mismatch = `The site says this is a program, but the name says ${out.type}.`;
    } else if (MIME_FOR_KIND[kind] && !MIME_FOR_KIND[kind].test(declared) && !RUNNABLE_MIME.test(declared) && ['image', 'audio', 'video', 'document', 'text'].includes(kind)) {
      out.mismatch = `The site describes it as ${declared}, which does not fit ${out.type}.`;
    }
  }
  out.lines.push(`${fileName || 'This file'} is ${out.type}${size ? `, ${size}` : ''}${host ? `, from ${host}` : ''}.`);
  if (fromPage && host && registrable(fromPage) !== registrable(host)) out.lines.push(`You were on ${fromPage}, but the file came from ${host}.`);
  if (out.mismatch) out.lines.push(out.mismatch);
  out.lines.push(`Open with: ${out.openWith}`);
  if (out.care) out.lines.push(out.care);
  return out;
}

// SHA-256 of a file on this computer, streamed so a big file is not read into
// memory. Past the cap it says so rather than tying up the disk.
// -> { sha256, bytes } | { skipped, bytes }
async function hashFile(file, { maxBytes = MAX_HASH_BYTES } = {}) {
  const p = path.resolve(String(file || ''));
  const st = await fs.promises.stat(p);
  if (!st.isFile()) throw new Error('That is not a file');
  if (st.size > maxBytes) return { skipped: `Larger than ${humanSize(maxBytes)}, so Vex did not read it to make a hash.`, bytes: st.size };
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(p);
    s.on('data', (chunk) => hash.update(chunk));
    s.on('error', reject);
    s.on('end', resolve);
  });
  return { sha256: hash.digest('hex'), bytes: st.size };
}

// --- third parties on a page ---------------------------------------------------

// cookies: Electron cookie objects (only `domain` is read). contacted: the
// hosts the page loaded things from. site: the page's own host.
// -> { contacted, withCookies, cookies, domains: [{ domain, cookies }] }
function thirdPartyCounts({ cookies = [], contacted = [], site = '' } = {}) {
  const first = registrable(site);
  const third = new Set();
  for (const h of contacted) {
    const r = registrable(h);
    if (r && r !== first && r.includes('.')) third.add(r);
  }
  const per = new Map();
  for (const c of cookies) {
    const r = registrable(String((c && c.domain) || '').replace(/^\./, ''));
    if (r && third.has(r)) per.set(r, (per.get(r) || 0) + 1);
  }
  const domains = [...per].map(([domain, n]) => ({ domain, cookies: n })).sort((a, b) => b.cookies - a.cookies || a.domain.localeCompare(b.domain));
  return { contacted: third.size, withCookies: domains.length, cookies: domains.reduce((n, d) => n + d.cookies, 0), domains: domains.slice(0, 8) };
}

module.exports = { describeDownload, hashFile, thirdPartyCounts, humanSize, MAX_HASH_BYTES, TYPES };
