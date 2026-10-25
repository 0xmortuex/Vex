'use strict';
// === Quick look at a finished download ======================================
//
// The Downloads panel can show what is inside a file without opening any other
// program. Reading happens HERE, in the main process, and nothing is trusted
// from the page that asks:
//
//   - the page sends a path and nothing else; the path only counts if Vex
//     downloaded that file itself (isDownloadedFile, the same gate as Open,
//     Delete and Show in folder), so a page can never name an arbitrary file;
//   - it must be an absolute path to a regular file (not a link, not a folder);
//   - every kind has a size cap; a bigger file is not read at all, the card says
//     so; text is cut at 200 KB; an archive or Office file is read through the
//     same zip guards as Extract (archive-security) and never unpacked to disk;
//   - a program (.exe .msi .bat .cmd .ps1 .scr .lnk .jar and its kin) is never
//     read, opened or run here: only its name, size and date come back.
//
// peek(path) -> { ok, kind, name, ext, size, modified, ... } or { ok:false, error }.
// hash(path) -> { ok, sha256 }, streamed, on request only.

const TEXT_CAP = 200 * 1024;
const CAPS = { image: 20 * 1024 * 1024, pdf: 50 * 1024 * 1024, audio: 60 * 1024 * 1024, video: 100 * 1024 * 1024, zip: 100 * 1024 * 1024, office: 50 * 1024 * 1024 };
const OFFICE_PART_CAP = 8 * 1024 * 1024;     // one XML part, as declared in the zip

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'];
const AUDIO = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'opus', 'aac'];
const VIDEO = ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'];
const TEXT = ['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml', 'ini', 'toml', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'py', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'sh', 'sql', 'srt', 'vtt', 'conf', 'cfg', 'env', 'gitignore'];
const ARCHIVE = ['zip', '7z', 'rar'];
const OFFICE = ['docx', 'xlsx', 'pptx'];
// Never read, never run, never opened by a click on a preview.
const PROGRAM = ['exe', 'msi', 'bat', 'cmd', 'ps1', 'scr', 'lnk', 'jar', 'com', 'vbs', 'vbe', 'wsf', 'hta', 'reg', 'msp', 'msix', 'appx', 'dll', 'cpl'];

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', opus: 'audio/ogg', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/mp4', mkv: 'video/x-matroska', pdf: 'application/pdf' };

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}
function kindOf(name) {
  const ext = extOf(name);
  if (PROGRAM.includes(ext)) return 'program';
  if (IMAGE.includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (AUDIO.includes(ext)) return 'audio';
  if (VIDEO.includes(ext)) return 'video';
  if (ARCHIVE.includes(ext)) return 'archive';
  if (OFFICE.includes(ext)) return 'office';
  if (TEXT.includes(ext)) return 'text';
  return 'other';
}

// Text out of one Office XML part: paragraph ends become line breaks, every
// other tag goes, the few XML entities are decoded.
function xmlText(xml) {
  return String(xml)
    .replace(/<\/(?:w:p|a:p|row|si)>/g, '\n')
    .replace(/<\/(?:w:tc|c)>/g, '\t')
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function createDownloadPeek({ fs, path, crypto, isDownloadedFile, listArchive, openZip, validateZip }) {
  if (!fs || !path || !crypto || typeof isDownloadedFile !== 'function') throw new Error('download-peek needs fs, path, crypto and isDownloadedFile');

  // The one door every call goes through. Throws a sentence a person can read.
  function check(filePath) {
    if (typeof filePath !== 'string' || !filePath || filePath.length > 4096 || filePath.includes('\0')) throw new Error('That is not a file path');
    if (!path.isAbsolute(filePath)) throw new Error('That is not a full file path');
    if (!isDownloadedFile(filePath)) throw new Error('Quick look shows only files Vex downloaded itself');
    let st;
    try { st = fs.lstatSync(filePath); }
    catch (err) { throw new Error(err && err.code === 'ENOENT' ? 'The file is not there any more' : 'The file could not be read: ' + ((err && err.message) || err), { cause: err }); }
    if (st.isSymbolicLink()) throw new Error('Quick look does not follow links');
    if (!st.isFile()) throw new Error('That is not a file');
    return st;
  }

  function readHead(filePath, bytes) {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const n = fs.readSync(fd, buf, 0, bytes, 0);
      return buf.subarray(0, n);
    } finally { fs.closeSync(fd); }
  }

  function officeText(filePath, ext) {
    if (typeof openZip !== 'function') return { text: '', note: 'Not available' };
    const zip = openZip(filePath);
    if (typeof validateZip === 'function') validateZip(zip);
    const part = (name) => {
      const e = zip.getEntry(name);
      if (!e) return '';
      if (e.header.size > OFFICE_PART_CAP) return '';
      return xmlText(zip.readAsText(e));
    };
    let text = '';
    if (ext === 'docx') text = part('word/document.xml');
    else if (ext === 'xlsx') text = part('xl/sharedStrings.xml');
    else if (ext === 'pptx') {
      const slides = zip.getEntries().map(e => e.entryName).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10)).slice(0, 5);
      text = slides.map(part).filter(Boolean).join('\n\n');
    }
    return { text: text.slice(0, 4000), truncated: text.length > 4000 };
  }

  async function peek(filePath) {
    const st = check(filePath);
    const name = path.basename(filePath);
    const ext = extOf(name);
    const out = { ok: true, kind: kindOf(name), name, ext, size: st.size, modified: st.mtimeMs };
    // A program: its name, size and date. It is not read here.
    if (out.kind === 'program') return out;
    if (out.kind === 'image' || out.kind === 'pdf' || out.kind === 'audio' || out.kind === 'video') {
      if (st.size > CAPS[out.kind]) { out.tooBig = CAPS[out.kind]; return out; }
      out.mime = MIME[ext] || 'application/octet-stream';
      out.bytes = fs.readFileSync(filePath);
      return out;
    }
    if (out.kind === 'text') {
      const head = readHead(filePath, Math.min(st.size, TEXT_CAP));
      // A NUL byte early on means it is not text, whatever the name says.
      if (head.subarray(0, 8192).includes(0)) { out.kind = 'other'; out.note = 'binary'; return out; }
      let text = head.toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      out.text = text;
      out.truncated = st.size > TEXT_CAP;
      return out;
    }
    if (out.kind === 'archive') {
      const limit = ext === 'zip' ? CAPS.zip : Infinity;
      if (st.size > limit) { out.tooBig = limit; return out; }
      if (typeof listArchive !== 'function') { out.note = 'unavailable'; return out; }
      const r = await listArchive(filePath);
      if (!r || !r.ok) { out.listError = (r && r.error) || 'could not be read'; return out; }
      out.count = r.count; out.truncated = !!r.truncated || r.count > r.entries.length;
      out.entries = r.entries.slice(0, 200).map(e => ({ name: String(e.name || '').slice(0, 300), size: Number(e.size) || 0, dir: !!e.dir }));
      return out;
    }
    if (out.kind === 'office') {
      if (st.size > CAPS.office) { out.tooBig = CAPS.office; return out; }
      try { Object.assign(out, officeText(filePath, ext)); }
      catch (err) { out.listError = String((err && err.message) || err).replace(/^ADM-ZIP:?\s*/, '').slice(0, 200) || 'could not be read'; }
      return out;
    }
    return out;
  }

  async function hash(filePath) {
    const st = check(filePath);
    const h = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const s = fs.createReadStream(filePath);
      s.on('data', (c) => h.update(c));
      s.on('error', reject);
      s.on('end', resolve);
    });
    return { ok: true, sha256: h.digest('hex'), size: st.size };
  }

  return { peek, hash, check };
}

module.exports = { createDownloadPeek, kindOf, extOf, xmlText, CAPS, TEXT_CAP, PROGRAM };
