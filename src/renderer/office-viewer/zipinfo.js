// Reads the file list of a zip from its central directory without inflating anything. Used before a document is opened, to
// (a) tell a zip from a password-protected Office file (those are not zips at all: they are an OLE container) and an old
// binary format, (b) refuse a zip that would inflate to far more than Vex is willing to hold, and (c) notice a zip whose
// entries are encrypted. Plain script, not a module: the worker loads it with importScripts and the page with <script>/import.
(function (root) {
  'use strict';

  const LIMITS = Object.freeze({
    fileBytes: 80 * 1024 * 1024,        // the file as downloaded
    inflatedBytes: 400 * 1024 * 1024,   // all entries together once inflated
    entryBytes: 150 * 1024 * 1024,      // one entry once inflated
    entries: 20000,
  });

  const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isOle = (u8) => u8.length >= 8 && OLE.every((b, i) => u8[i] === b);
  const isZip = (u8) => u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 3 || u8[2] === 5 || u8[2] === 7);

  function decodeName(bytes, utf8) {
    if (utf8) return new TextDecoder('utf-8').decode(bytes);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // -> { entries: [{ name, flags, method, packed, size, encrypted }], total, encrypted }  or throws Error with .code 'notzip' | 'corrupt'
  function readDirectory(u8) {
    const err = (code, message) => Object.assign(new Error(message), { code });
    if (!isZip(u8)) throw err('notzip', 'This is not a zip package');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // The end-of-central-directory record is within the last 64 KB + 22 bytes.
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw err('corrupt', 'The end of the zip is missing');
    let count = dv.getUint16(eocd + 10, true);
    let dirSize = dv.getUint32(eocd + 12, true);
    let dirAt = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || dirAt === 0xffffffff || dirSize === 0xffffffff) {
      // zip64: the real values are in the zip64 end record, found through its locator just before the EOCD.
      const loc = eocd - 20;
      if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw err('corrupt', 'The zip64 locator is missing');
      const rec = Number(dv.getBigUint64(loc + 8, true));
      if (rec + 56 > u8.length || dv.getUint32(rec, true) !== 0x06064b50) throw err('corrupt', 'The zip64 record is missing');
      count = Number(dv.getBigUint64(rec + 32, true));
      dirSize = Number(dv.getBigUint64(rec + 40, true));
      dirAt = Number(dv.getBigUint64(rec + 48, true));
    }
    if (count > LIMITS.entries) throw err('huge', 'The package holds ' + count + ' parts');
    if (dirAt + dirSize > u8.length) throw err('corrupt', 'The zip directory points past the end of the file');
    const entries = [];
    let p = dirAt, total = 0, encrypted = false;
    for (let n = 0; n < count; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw err('corrupt', 'The zip directory is damaged');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      let packed = dv.getUint32(p + 20, true);
      let size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const name = decodeName(u8.subarray(p + 46, p + 46 + nameLen), !!(flags & 0x800));
      if (size === 0xffffffff || packed === 0xffffffff) {
        // sizes in the zip64 extra field
        let q = p + 46 + nameLen;
        const end = q + extraLen;
        while (q + 4 <= end) {
          const id = dv.getUint16(q, true), len = dv.getUint16(q + 2, true);
          if (id === 1) {
            let r = q + 4;
            if (size === 0xffffffff) { size = Number(dv.getBigUint64(r, true)); r += 8; }
            if (packed === 0xffffffff) { packed = Number(dv.getBigUint64(r, true)); }
            break;
          }
          q += 4 + len;
        }
      }
      const enc = !!(flags & 1);
      if (enc) encrypted = true;
      if (size > LIMITS.entryBytes) throw err('huge', '"' + name + '" is ' + Math.round(size / 1048576) + ' MB once opened');
      total += size;
      entries.push({ name, flags, method, packed, size, encrypted: enc });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (total > LIMITS.inflatedBytes) throw err('huge', 'The package is ' + Math.round(total / 1048576) + ' MB once opened');
    return { entries, total, encrypted };
  }

  // What a file is, from its first bytes alone: 'zip' | 'ole' | 'rtf' | 'text' | 'other'.
  function sniff(u8) {
    if (isZip(u8)) return 'zip';
    if (isOle(u8)) return 'ole';
    if (u8.length >= 5 && String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4]) === '{\\rtf') return 'rtf';
    return 'other';
  }

  const api = { LIMITS, readDirectory, sniff, isZip, isOle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OfficeZipInfo = api;
})(typeof self !== 'undefined' ? self : globalThis);
