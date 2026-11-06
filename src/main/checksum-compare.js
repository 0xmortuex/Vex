// === Compare a download with the checksum the publisher printed ==============
//
// Download pages print a checksum next to the file: a bare hash, a line made by
// `sha256sum` (`<hash> *file.exe`), BSD's `SHA256 (file.exe) = <hash>`, or the
// block PowerShell's Get-FileHash prints (Algorithm / Hash / Path). This reads
// what the person pasted, works out WHICH algorithm it is from its length, and
// compares it with what the file really hashes to.
//
//   32 hex digits  MD5      40  SHA-1      64  SHA-256      128  SHA-512
//
// Pure functions, no I/O: parseExpected(text, { fileName }) and sameChecksum(a, b).
// The hashing itself is streamed by download-peek.js (never the whole file in memory).
'use strict';

const BY_LENGTH = Object.freeze({ 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' });
const LABEL = Object.freeze({ md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' });
const MAX_PASTE = 20000;

// "SHA256", "SHA-256", "sha_256" -> 'sha256' ; null when it is none of the four
function algorithmName(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.prototype.hasOwnProperty.call(LABEL, w) ? w : null;
}

const HEX = /^[0-9a-f]+$/i;

// One run of hex made of groups, e.g. "A1B2 C3D4 ..." or "a1:b2:c3" (some pages group the digits).
function ungroup(s) {
  const t = s.trim();
  if (!t) return null;
  if (/^[0-9a-f]+([ :-][0-9a-f]+)+$/i.test(t) && !/^[0-9a-f]+$/i.test(t)) {
    const joined = t.replace(/[ :-]/g, '');
    if (BY_LENGTH[joined.length]) return joined;
  }
  return null;
}

// The checksums in one line of text, with the file name when the line has one.
function fromLine(line) {
  const out = [];
  let s = line.trim();
  if (!s) return out;
  // sha256sum escapes a name with odd characters by starting the line with a backslash.
  s = s.replace(/^\\(?=[0-9a-fA-F])/, '');
  // BSD: SHA256 (file.exe) = <hash>
  let m = /^(md5|sha-?1|sha-?256|sha-?512)\s*\((.+)\)\s*=\s*([0-9a-f\s:-]+)$/i.exec(s);
  if (m) {
    const hex = ungroup(m[3]) || m[3].trim();
    if (HEX.test(hex)) out.push({ hex, name: m[2], declared: algorithmName(m[1]) });
    return out;
  }
  // docker/npm style: sha256:<hash>
  m = /^(md5|sha-?1|sha-?256|sha-?512)\s*[:=]\s*([0-9a-f]+)\s*$/i.exec(s);
  if (m) { out.push({ hex: m[2], name: null, declared: algorithmName(m[1]) }); return out; }
  // the hash alone, possibly in groups ("a1b2 c3d4 ...") - before the sha256sum rule, which would read a 32-digit first group as an MD5
  const g = ungroup(s);
  if (g) { out.push({ hex: g, name: null, declared: null }); return out; }
  // sha256sum: <hash><space><space or *><name>
  m = /^([0-9a-f]{32,128})\s+[* ]?(.+)$/i.exec(s);
  if (m && BY_LENGTH[m[1].length]) { out.push({ hex: m[1], name: m[2].trim(), declared: null }); return out; }
  if (HEX.test(s)) { out.push({ hex: s, name: null, declared: null }); return out; }
  return out;
}

// Get-FileHash:  Algorithm       Hash                      Path
//                ---------       ----                      ----
//                SHA256          ABC...                    C:\x\file.exe
// (or the list form: "Algorithm : SHA256" / "Hash : ABC..." / "Path : ...").
function fromGetFileHash(text) {
  const out = [];
  const list = /^\s*Algorithm\s*:\s*(\S+)\s*$[\s\S]*?^\s*Hash\s*:\s*([0-9a-f]+)\s*$(?:[\s\S]*?^\s*Path\s*:\s*(.+?)\s*$)?/gim;
  let m;
  while ((m = list.exec(text))) out.push({ hex: m[2], name: m[3] ? m[3].replace(/^.*[\\/]/, '') : null, declared: algorithmName(m[1]) });
  if (out.length) return out;
  const table = /^\s*(md5|sha1|sha256|sha384|sha512|mactripledes|ripemd160)\s+([0-9a-f]{32,128})(?:\s+(\S.*?))?\s*$/gim;
  while ((m = table.exec(text))) out.push({ hex: m[2], name: m[3] ? m[3].replace(/^.*[\\/]/, '') : null, declared: algorithmName(m[1]) });
  return out;
}

// A refusal as a template with {1}, {2} places (the window translates the template and fills it) and the same sentence filled in.
function fail(template, ...args) {
  return { ok: false, template, args, error: template.replace(/\{(\d)\}/g, (_m, i) => String(args[Number(i) - 1])) };
}

// -> { ok:true, algorithm, expected, name } | { ok:false, error, template, args }
// `fileName` (optional) chooses between several lines of a checksum list.
function parseExpected(text, { fileName = '' } = {}) {
  if (typeof text !== 'string') return fail('Paste the checksum from the download page.');
  if (text.length > MAX_PASTE) return fail('That is too long to be a checksum. Paste just the checksum, or the one line for your file.');
  // Control characters are not a checksum (and dropping a NUL could join two halves into a value that was never there).
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return fail('That does not look like a checksum. A checksum is 32, 40, 64 or 128 letters and digits (0-9, a-f), like the one on the download page.');
  // Invisible characters a web page leaves behind when copied are harmless: dropped.
  const clean = text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
  if (!clean.trim()) return fail('Paste the checksum from the download page.');

  let found = fromGetFileHash(clean);
  if (!found.length) {
    for (const line of clean.split(/\r?\n/)) found.push(...fromLine(line));
  }
  if (!found.length) {
    // A sentence from the page ("SHA-256 checksum for the installer: ..."): one standalone run of 32/40/64/128 digits in it is the checksum.
    const runs = [...new Set((clean.match(/(?<![0-9a-zA-Z])[0-9a-fA-F]{32,128}(?![0-9a-zA-Z])/g) || []).filter(r => BY_LENGTH[r.length]).map(r => r.toLowerCase()))];
    if (runs.length === 1) found = [{ hex: runs[0], name: null, declared: null }];
  }
  if (!found.length) return fail('That does not look like a checksum. A checksum is 32, 40, 64 or 128 letters and digits (0-9, a-f), like the one on the download page.');

  // Drop repeats of the same checksum.
  const unique = [];
  for (const f of found) if (!unique.some(u => u.hex.toLowerCase() === f.hex.toLowerCase() && (u.name || '') === (f.name || ''))) unique.push(f);
  let pick = unique;
  if (unique.length > 1) {
    const want = String(fileName || '').toLowerCase();
    const named = want ? unique.filter(u => u.name && u.name.replace(/^.*[\\/]/, '').toLowerCase() === want) : [];
    if (named.length === 1) pick = named;
    else if (new Set(unique.map(u => u.hex.toLowerCase())).size === 1) pick = [unique[0]];
    else return fail('There is more than one checksum in what you pasted, and none of the names is this file ({1}). Paste just the one for this file.', fileName || '?');
  }
  const f = pick[0];
  const hex = f.hex;
  if (!HEX.test(hex)) return fail('A checksum has only the digits 0-9 and the letters a-f.');
  const algorithm = BY_LENGTH[hex.length];
  if (!algorithm) {
    const known = { 56: 'SHA-224', 96: 'SHA-384' }[hex.length];
    return known
      ? fail('That looks like a {1} checksum, which Vex does not compare. Vex compares MD5 (32 digits), SHA-1 (40), SHA-256 (64) and SHA-512 (128).', known)
      : fail('That is {1} digits long. Vex compares MD5 (32 digits), SHA-1 (40), SHA-256 (64) and SHA-512 (128).', hex.length);
  }
  if (f.declared && f.declared !== algorithm) {
    return fail('It says {1} but the value is {2} digits long, which is {3}. Check that you copied the whole value.', LABEL[f.declared], hex.length, LABEL[algorithm]);
  }
  return { ok: true, algorithm, expected: hex.toLowerCase(), name: f.name || null };
}

// Case-insensitive, whitespace-tolerant. Both must already be the same length of hex.
function sameChecksum(a, b) {
  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
  const x = norm(a), y = norm(b);
  return x.length > 0 && x === y;
}

module.exports = { parseExpected, sameChecksum, algorithmName, BY_LENGTH, LABEL, MAX_PASTE };
