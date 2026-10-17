// === What a downloaded file IS, from its first bytes and (for a zip) its file list (T3-010) ===
//
// download-guard.js judges a download by its NAME and address. This looks at the file once it is saved,
// because the commonest trick needs no clever name at all: a program called invoice.pdf, a picture that is
// really a program, or a zip with a password in the web page that holds a single .exe.
//
//   - It reads the first 64 KB of the file, and for a .zip the list of file names in its central directory
//     (at most 1 MB of directory, 2,000 entries). It never decompresses, opens, runs or uploads anything and
//     asks no one; the answer is a few lines of text on the download.
//   - "Warn only when sure": a finding is HIGH only for things honest files essentially never do (a document or
//     picture whose bytes are a Windows program, a password-protected archive that holds a program, a program
//     hidden behind a document ending inside an archive, a path that climbs out of the folder). MEDIUM is a shape
//     that is often bad and sometimes fine (a shortcut or script inside an archive, a huge expansion ratio).
//   - A file that cannot be read is reported as not checked, with the reason; it is never reported as clean.
//
// inspectFile({ fs, file, name, maxHead }) -> { checked, detected, findings: [{ level, kind, text }] }

const HEAD = 64 * 1024;
const MAX_DIR = 1024 * 1024;
const MAX_ENTRIES = 2000;

// What the first bytes say. Order matters (longer signatures first).
const SIGNATURES = [
  { kind: 'program', label: 'a Windows program', test: (b) => b[0] === 0x4d && b[1] === 0x5a },
  { kind: 'program', label: 'a Linux program', test: (b) => b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 },
  { kind: 'program', label: 'a macOS program', test: (b) => (b[0] === 0xcf || b[0] === 0xce) && b[1] === 0xfa && b[2] === 0xed && b[3] === 0xfe },
  { kind: 'zip', label: 'a zip archive', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) },
  { kind: 'rar', label: 'a RAR archive', test: (b) => b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 },
  { kind: '7z', label: 'a 7-Zip archive', test: (b) => b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf },
  { kind: 'gzip', label: 'a gzip archive', test: (b) => b[0] === 0x1f && b[1] === 0x8b },
  { kind: 'ole', label: 'an old Office document or an installer package', test: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
  { kind: 'pdf', label: 'a PDF', test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { kind: 'png', label: 'a PNG picture', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { kind: 'jpeg', label: 'a JPEG picture', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'gif', label: 'a GIF picture', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { kind: 'riff', label: 'a RIFF media file', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 },
  { kind: 'mp4', label: 'a video or audio file', test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  { kind: 'script', label: 'a script', test: (b) => b[0] === 0x23 && b[1] === 0x21 },
];

const DOCUMENTISH = new Set(['pdf', 'txt', 'rtf', 'csv', 'md', 'log', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'ico', 'svg', 'mp3', 'mp4', 'm4a', 'wav', 'ogg', 'flac', 'mkv', 'avi', 'webm', 'mov', 'ttf', 'otf', 'woff', 'woff2', 'epub']);
const PROGRAM_EXT = new Set(['exe', 'dll', 'scr', 'com', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'hta', 'lnk', 'js', 'jse', 'wsf', 'jar', 'cpl', 'pif', 'msix', 'appx']);
// What opens a program from an archive in one double-click.
const RISKY_IN_ARCHIVE = new Set(['exe', 'scr', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'hta', 'lnk', 'js', 'jse', 'wsf', 'cpl', 'pif', 'msi']);
// A shortcut or a Windows-only script in a small archive. (A .js or .ps1 among many files is just source code.)
const SHORTCUT_OR_SCRIPT = new Set(['lnk', 'hta', 'vbs', 'wsf', 'cpl', 'jse']);
const DOC_ENDING = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|jpe?g|png|gif|mp[34]|mkv|avi|zip|rar)\s*\.(exe|scr|com|bat|cmd|ps1|vbs|hta|lnk|js|jse|wsf|cpl|pif)$/i;

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,12})\s*$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function detect(buf) {
  if (!buf || buf.length < 4) return null;
  for (const s of SIGNATURES) if (s.test(buf)) return s;
  return null;
}

// Reads the central directory of a zip. -> { entries: [{ name, flags, method, packed, size }], note }
function zipEntries(fs, fd, size) {
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
  if (eocd < 0) return { entries: [], note: 'The end of the zip is missing or damaged, so its file list could not be read.' };
  const count = tail.readUInt16LE(eocd + 10);
  const dirSize = tail.readUInt32LE(eocd + 12);
  const dirOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) return { entries: [], note: 'This zip is in the large (zip64) form, so its file list was not read.' };
  if (dirSize > MAX_DIR || dirOffset + dirSize > size) return { entries: [], note: 'The zip\'s file list is too large or outside the file, so it was not read.' };
  const dir = Buffer.alloc(dirSize);
  fs.readSync(fd, dir, 0, dirSize, dirOffset);
  const entries = [];
  let p = 0;
  while (p + 46 <= dir.length && entries.length < MAX_ENTRIES && dir.readUInt32LE(p) === 0x02014b50) {
    const flags = dir.readUInt16LE(p + 8), method = dir.readUInt16LE(p + 10);
    const packed = dir.readUInt32LE(p + 20), unpacked = dir.readUInt32LE(p + 24);
    const nl = dir.readUInt16LE(p + 28), el = dir.readUInt16LE(p + 30), cl = dir.readUInt16LE(p + 32);
    if (p + 46 + nl > dir.length) break;
    const utf8 = (flags & 0x800) !== 0;
    const name = dir.toString(utf8 ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
    entries.push({ name, flags, method, packed, size: unpacked });
    p += 46 + nl + el + cl;
  }
  return { entries, note: count > MAX_ENTRIES ? 'Only the first ' + MAX_ENTRIES + ' files of the zip were read.' : '' };
}

function judgeZip(entries, findings) {
  const files = entries.filter(e => !/\/$/.test(e.name));
  const risky = files.filter(e => RISKY_IN_ARCHIVE.has(extOf(e.name)));
  const encrypted = files.filter(e => (e.flags & 1) !== 0);
  const encryptedRisky = encrypted.filter(e => RISKY_IN_ARCHIVE.has(extOf(e.name)));
  if (encryptedRisky.length) {
    findings.push({ level: 'high', kind: 'locked-program', text: 'This zip is locked with a password and holds a program (' + encryptedRisky[0].name + '). Password-locked archives are used to hide malware from scanners, and the password is usually on the page that gave you the file.' });
  }
  const decoy = files.find(e => DOC_ENDING.test(e.name.replace(/^.*[\\/]/, '')));
  if (decoy) findings.push({ level: 'high', kind: 'double-extension', text: 'Inside the zip, "' + decoy.name.replace(/^.*[\\/]/, '') + '" is a program with a document or picture ending in front of its real one, so it looks like a file it is not.' });
  const climb = files.find(e => /(^|[\\/])\.\.([\\/]|$)/.test(e.name) || /^[A-Za-z]:|^[\\/]/.test(e.name));
  if (climb) findings.push({ level: 'high', kind: 'path-escape', text: 'A file inside the zip ("' + climb.name.slice(0, 80) + '") has a path that climbs out of the folder it is unpacked into.' });
  if (!findings.length && files.length === 1 && risky.length === 1) {
    findings.push({ level: 'medium', kind: 'single-program', text: 'The zip holds just one thing, a program (' + files[0].name.slice(0, 80) + '). That is how a lot of malware is handed out; real software usually comes with other files or from its own site.' });
  } else if (!findings.length && files.length <= 5 && risky.some(e => SHORTCUT_OR_SCRIPT.has(extOf(e.name)))) {
    const e = risky.find(x => SHORTCUT_OR_SCRIPT.has(extOf(x.name)));
    findings.push({ level: 'medium', kind: 'shortcut-or-script', text: 'The zip holds a shortcut or a script (' + e.name.slice(0, 80) + '). These run commands when opened and are a common way to start malware.' });
  }
  const packed = files.reduce((n, e) => n + e.packed, 0), size = files.reduce((n, e) => n + e.size, 0);
  if (size > 2 * 1024 * 1024 * 1024 && packed > 0 && size / packed > 200) {
    findings.push({ level: 'medium', kind: 'expansion', text: 'The zip is small but unpacks to about ' + Math.round(size / 1024 / 1024 / 1024) + ' GB (' + Math.round(size / packed) + ' times its size). Unpacking it could fill the disk.' });
  }
}

function inspectFile({ fs, file, name, maxHead = HEAD } = {}) {
  if (!fs) throw new Error('inspectFile needs fs');
  if (typeof file !== 'string' || !file) throw new Error('inspectFile needs a file');
  const ext = extOf(name || file);
  const out = { checked: false, detected: '', findings: [], note: '' };
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('not a regular file');
    const head = Buffer.alloc(Math.min(maxHead, st.size));
    fs.readSync(fd, head, 0, head.length, 0);
    const sig = detect(head);
    out.checked = true;
    out.detected = sig ? sig.kind : '';

    if (sig && DOCUMENTISH.has(ext)) {
      const claimed = ext.toUpperCase();
      if (sig.kind === 'program') out.findings.push({ level: 'high', kind: 'disguised-program', text: 'The name says ."' + ext + '" but the file is ' + sig.label + '. A real ' + claimed + ' is never a program; this is a program with the wrong ending.' });
      else if (sig.kind === 'script') out.findings.push({ level: 'high', kind: 'disguised-script', text: 'The name says ."' + ext + '" but the file is a script that starts with #!.' });
      else if (['zip', 'rar', '7z', 'gzip'].includes(sig.kind) && !['docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub', 'svg'].includes(ext) && !(sig.kind === 'gzip' && ext === 'svg')) {
        out.findings.push({ level: 'medium', kind: 'disguised-archive', text: 'The name says ."' + ext + '" but the file is ' + sig.label + '.' });
      }
    }
    if (sig && PROGRAM_EXT.has(ext) && ['exe', 'dll', 'scr', 'com', 'cpl'].includes(ext) && sig.kind !== 'program') {
      out.findings.push({ level: 'medium', kind: 'not-a-program', text: 'The name ends ."' + ext + '" but the file is ' + sig.label + ', not a Windows program.' });
    }
    if (sig && sig.kind === 'zip' && st.size >= 22 && !['docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub', 'jar', 'apk', 'xpi', 'crx', 'vsix', 'nupkg', 'msix', 'appx'].includes(ext)) {
      const z = zipEntries(fs, fd, st.size);
      out.note = z.note;
      judgeZip(z.entries, out.findings);
    }
    // RAR and 7z (Wave 6): their headers are read in plain JavaScript (main/archive-list.js) and judged the same way.
    if (sig && (sig.kind === 'rar' || sig.kind === '7z')) {
      const { listArchive, fileReader } = require('./archive-list');
      const listed = listArchive(fileReader(fs, fd, st.size), sig.kind);
      if (!listed.ok) out.note = 'The file list of this ' + sig.kind.toUpperCase() + ' archive could not be read: ' + listed.error;
      else if (listed.encrypted) {
        out.note = 'This ' + sig.kind.toUpperCase() + ' archive hides its file names behind a password.';
        out.findings.push({ level: 'medium', kind: 'locked-names', text: 'This archive is locked with a password, even for the names of what is inside. Password-locked archives are used to hide malware from scanners, so open it only if the person who sent it gave you the password and you expected it.' });
      } else {
        const entries = listed.entries.map(e => ({ name: e.dir ? e.name.replace(/\/?$/, '/') : e.name, flags: 0, method: 0, packed: 0, size: e.size }));
        const found = [];
        judgeZip(entries, found);
        for (const f of found) out.findings.push({ ...f, text: f.text.replace(/\b(The|This|the|this) zip\b/g, '$1 archive') });
        if (listed.truncated) out.note = 'Only the first ' + listed.entries.length + ' files of the archive were read.';
      }
    }
  } catch (err) {
    out.checked = false;
    out.note = 'The file could not be checked: ' + err.message;
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (err) { out.note += ' (and it could not be closed: ' + err.message + ')'; } }
  }
  out.worst = out.findings.some(f => f.level === 'high') ? 'high' : out.findings.length ? 'medium' : '';
  return out;
}

module.exports = { inspectFile, detect, zipEntries, judgeZip, DOC_ENDING };
