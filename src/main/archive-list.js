// === What is inside a .rar or a .7z, without unpacking it (T3-010) ============
//
// The file check used to know a RAR or a 7-Zip archive only by its first bytes. This reads their HEADERS (the list of
// names and sizes) in plain JavaScript, with no native program and no library: nothing is extracted, nothing is run,
// and no file content is read beyond the headers.
//
//   RAR 1.5-4.x and RAR 5   file headers are walked block by block (the data between them is skipped with a seek).
//                           Names and sizes are in clear text unless the archive encrypts its headers.
//   7z                      the "next header" at the end of the file. 7-Zip compresses it with LZMA by default, so a
//                           small LZMA decoder is included (lzmaDecode below, tested against archives made by 7-Zip).
//                           A header that is AES-encrypted, or packed with another method, is reported as such.
//
// An archive whose headers are encrypted (a password is needed even to see the names) is said to be, never guessed at.
// Every limit is explicit: at most MAX_ENTRIES names, at most MAX_HEADER bytes of header read or inflated.
//
//   listArchive(reader, kind) -> { ok: true, format, entries: [{ name, size, dir }], truncated, encrypted: false }
//                              | { ok: true, format, entries: [], encrypted: true, note }
//                              | { ok: false, error }
//   reader: { size, read(position, length) -> Buffer }   (bufferReader / fileReader below)

const MAX_ENTRIES = 5000;
const MAX_HEADER = 16 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, start = 0, end = buf.length) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function bufferReader(buf) {
  return { size: buf.length, read: (position, length) => buf.subarray(position, Math.min(buf.length, position + length)) };
}
function fileReader(fs, fd, size) {
  return {
    size,
    read(position, length) {
      const n = Math.max(0, Math.min(length, size - position));
      const out = Buffer.alloc(n);
      let done = 0;
      while (done < n) {
        const got = fs.readSync(fd, out, done, n - done, position + done);
        if (got <= 0) break;
        done += got;
      }
      return done === n ? out : out.subarray(0, done);
    },
  };
}

// ---- RAR ---------------------------------------------------------------------------------------------------------
const RAR4_SIG = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]);
const RAR5_SIG = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]);

// A RAR 5 "vint": 7 bits a byte, the high bit says another byte follows. -> { value, next } (value is a Number; sizes
// beyond 2^53 are refused rather than rounded).
function vint(buf, pos) {
  let value = 0, mul = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error('A RAR header ends in the middle of a number');
    const b = buf[pos++];
    value += (b & 0x7F) * mul;
    if (!(b & 0x80)) { if (!Number.isSafeInteger(value)) throw new Error('A RAR header holds a size that is too large'); return { value, next: pos }; }
    mul *= 128;
  }
  throw new Error('A RAR header holds a number that is too long');
}

function listRar5(reader) {
  const entries = [];
  let pos = RAR5_SIG.length, truncated = false;
  while (pos + 7 <= reader.size) {
    const head = reader.read(pos, 64);
    if (head.length < 7) break;
    const storedCrc = head.readUInt32LE(0);
    const sz = vint(head, 4);                       // size of the header after this field
    if (sz.value <= 0 || sz.value > 1024 * 1024) throw new Error('A RAR header has a size that cannot be right');
    const total = sz.next - 4 + sz.value;           // header size field + header
    const block = reader.read(pos + 4, total);
    if (block.length < total) throw new Error('The RAR file ends in the middle of a header');
    if (crc32(block, 0, total) !== storedCrc) throw new Error('A RAR header failed its checksum, so the file is damaged');
    let p = sz.next - 4;
    const type = vint(block, p); p = type.next;
    const flags = vint(block, p); p = flags.next;
    let extraSize = 0, dataSize = 0;
    if (flags.value & 0x1) { const e = vint(block, p); extraSize = e.value; p = e.next; }
    if (flags.value & 0x2) { const d = vint(block, p); dataSize = d.value; p = d.next; }
    if (type.value === 4) return { ok: true, format: 'rar5', entries: [], encrypted: true, truncated: false, note: 'Its headers are encrypted, so even the names need the password.' };
    if (type.value === 2 || type.value === 3) {
      if (type.value === 2) {
        const ff = vint(block, p); p = ff.next;
        const unp = vint(block, p); p = unp.next;
        const attr = vint(block, p); p = attr.next;
        if (ff.value & 0x2) p += 4;                  // modification time
        if (ff.value & 0x4) p += 4;                  // data checksum
        const comp = vint(block, p); p = comp.next;
        const host = vint(block, p); p = host.next;
        const nl = vint(block, p); p = nl.next;
        const name = block.subarray(p, p + nl.value).toString('utf8');
        if (entries.length < MAX_ENTRIES) entries.push({ name, size: unp.value, dir: !!(ff.value & 0x1) });
        else truncated = true;
        void attr; void comp; void host;
      }
    } else if (type.value === 5) break;              // end of archive
    pos += 4 + total + dataSize;
    void extraSize;
  }
  return { ok: true, format: 'rar5', entries, encrypted: false, truncated };
}

function listRar4(reader) {
  const entries = [];
  let pos = RAR4_SIG.length, truncated = false;
  while (pos + 7 <= reader.size) {
    const h = reader.read(pos, 32);
    if (h.length < 7) break;
    const type = h[2], flags = h.readUInt16LE(3), size = h.readUInt16LE(5);
    if (size < 7) throw new Error('A RAR header has a size that cannot be right');
    let addSize = 0;
    if (flags & 0x8000) { if (h.length < 11) break; addSize = h.readUInt32LE(7); }
    if (type === 0x73 && (flags & 0x0080)) return { ok: true, format: 'rar4', entries: [], encrypted: true, truncated: false, note: 'Its headers are encrypted, so even the names need the password.' };
    if (type === 0x74) {
      const full = reader.read(pos, size);
      if (full.length < size) throw new Error('The RAR file ends in the middle of a header');
      const packed = full.readUInt32LE(7), unpacked = full.readUInt32LE(11);
      const nameSize = full.readUInt16LE(26);
      let at = 32, hiUnp = 0;
      if (flags & 0x100) { hiUnp = full.readUInt32LE(32 + 4); at = 40; }
      let raw = full.subarray(at, at + nameSize);
      const nul = raw.indexOf(0);
      if (nul >= 0) raw = raw.subarray(0, nul);          // a Unicode name keeps the plain one first
      const name = raw.toString('utf8').replace(/\\/g, '/');
      const dir = (flags & 0xE0) === 0xE0;
      if (entries.length < MAX_ENTRIES) entries.push({ name, size: unpacked + hiUnp * 4294967296, dir });
      else truncated = true;
      pos += size + packed + (flags & 0x100 ? full.readUInt32LE(32) * 4294967296 : 0);
      continue;
    }
    if (type === 0x7B) break;                               // end of archive
    pos += size + (flags & 0x8000 ? addSize : 0);
  }
  return { ok: true, format: 'rar4', entries, encrypted: false, truncated };
}

function listRar(reader) {
  const head = reader.read(0, 8);
  if (head.subarray(0, 8).equals(RAR5_SIG)) return listRar5(reader);
  if (head.subarray(0, 7).equals(RAR4_SIG)) return listRar4(reader);
  return { ok: false, error: 'This does not start like a RAR archive' };
}

// ---- LZMA (for 7-Zip's compressed header) ----------------------------------------------------------------------
// A decoder for one LZMA stream whose unpacked size is known, written from the LZMA specification. The whole output
// is kept in memory (it is a header, never file content), so there is no dictionary window to manage.
function lzmaDecode(props, input, outSize) {
  if (!props || props.length < 5) throw new Error('The LZMA properties are too short');
  if (outSize > MAX_HEADER) throw new Error('The 7z header is larger than Vex reads');
  let d = props[0];
  if (d >= 9 * 5 * 5) throw new Error('The LZMA properties are not valid');
  const lc = d % 9; d = (d / 9) | 0;
  const lp = d % 5, pb = (d / 5) | 0;
  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
  const out = Buffer.alloc(outSize);
  let outPos = 0, inPos = 0;
  const next = () => { if (inPos >= input.length) throw new Error('The LZMA data ends early'); return input[inPos++]; };
  if (next() !== 0) throw new Error('The LZMA data is not valid');
  let code = 0;
  for (let i = 0; i < 4; i++) code = ((code * 256) + next()) >>> 0;
  let range = 0xFFFFFFFF;
  const norm = () => { if (range < 0x1000000) { range = (range * 256) >>> 0; code = ((code * 256) + next()) >>> 0; } };
  const probs = (n) => new Uint16Array(n).fill(1024);
  const bit = (p, i) => {
    const v = p[i];
    const bound = (range >>> 11) * v;
    let r;
    if (code < bound) { range = bound; p[i] = v + ((2048 - v) >>> 5); r = 0; }
    else { range -= bound; code -= bound; p[i] = v - (v >>> 5); r = 1; }
    norm();
    return r;
  };
  const direct = (n) => {
    let res = 0;
    while (n-- > 0) {
      range = range >>> 1;
      let b = 0;
      if (code >= range) { code -= range; b = 1; }
      norm();
      res = res * 2 + b;
    }
    return res;
  };
  const tree = (p, off, n) => { let m = 1; for (let i = 0; i < n; i++) m = (m << 1) + bit(p, off + m); return m - (1 << n); };
  const treeRev = (p, off, n) => { let m = 1, s = 0; for (let i = 0; i < n; i++) { const b = bit(p, off + m); m = (m << 1) + b; s |= b << i; } return s; };

  const isMatch = probs(12 << 4), isRep = probs(12), isRepG0 = probs(12), isRepG1 = probs(12), isRepG2 = probs(12), isRep0Long = probs(12 << 4);
  const posSlotP = probs(4 << 6), posP = probs(1 + 114), alignP = probs(16);
  const literal = probs(0x300 << (lc + lp));
  const lenDecoder = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) });
  const len = lenDecoder(), repLen = lenDecoder();
  const decodeLen = (dec, posState) => {
    if (bit(dec.choice, 0) === 0) return tree(dec.low, posState << 3, 3);
    if (bit(dec.choice, 1) === 0) return 8 + tree(dec.mid, posState << 3, 3);
    return 16 + tree(dec.high, 0, 8);
  };
  const distance = (l) => {
    const lenState = l > 3 ? 3 : l;
    const slot = tree(posSlotP, lenState << 6, 6);
    if (slot < 4) return slot;
    const n = (slot >> 1) - 1;
    let dist = (2 | (slot & 1)) * Math.pow(2, n);
    if (slot < 14) dist += treeRev(posP, dist - slot, n);
    else { dist += direct(n - 4) * 16; dist += treeRev(alignP, 0, 4); }
    return dist;
  };

  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
  while (outPos < outSize) {
    const posState = outPos & pbMask;
    if (bit(isMatch, (state << 4) + posState) === 0) {
      const prev = outPos > 0 ? out[outPos - 1] : 0;
      const base = 0x300 * (((outPos & lpMask) << lc) + (prev >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        if (outPos - rep0 - 1 < 0) throw new Error('The LZMA data is damaged');
        let matchByte = out[outPos - rep0 - 1];
        do {
          const matchBit = (matchByte >> 7) & 1;
          matchByte <<= 1;
          const b = bit(literal, base + ((1 + matchBit) << 8) + sym);
          sym = (sym << 1) | b;
          if (matchBit !== b) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | bit(literal, base + sym);
      out[outPos++] = sym & 0xFF;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let l;
    if (bit(isRep, state) !== 0) {
      if (outPos === 0) throw new Error('The LZMA data is damaged');
      if (bit(isRepG0, state) === 0) {
        if (bit(isRep0Long, (state << 4) + posState) === 0) {
          state = state < 7 ? 9 : 11;
          if (outPos - rep0 - 1 < 0) throw new Error('The LZMA data is damaged');
          out[outPos] = out[outPos - rep0 - 1]; outPos++;
          continue;
        }
      } else {
        let dist;
        if (bit(isRepG1, state) === 0) dist = rep1;
        else { if (bit(isRepG2, state) === 0) dist = rep2; else { dist = rep3; rep3 = rep2; } rep2 = rep1; }
        rep1 = rep0; rep0 = dist;
      }
      l = decodeLen(repLen, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2; rep2 = rep1; rep1 = rep0;
      l = decodeLen(len, posState);
      state = state < 7 ? 7 : 10;
      rep0 = distance(l);
      if (rep0 === 0xFFFFFFFF) break;                      // the end marker
    }
    l += 2;
    if (rep0 >= outPos) throw new Error('The LZMA data is damaged');
    for (let i = 0; i < l && outPos < outSize; i++) { out[outPos] = out[outPos - rep0 - 1]; outPos++; }
  }
  if (outPos !== outSize) throw new Error('The LZMA data ended before the header did');
  return out;
}

// ---- 7z ----------------------------------------------------------------------------------------------------------
const SEVENZ_SIG = Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]);

class Cursor {
  constructor(buf) { this.b = buf; this.p = 0; }
  byte() { if (this.p >= this.b.length) throw new Error('The 7z header ends early'); return this.b[this.p++]; }
  // 7z's variable-length number: the leading 1 bits of the first byte say how many bytes follow.
  num() {
    const first = this.byte();
    let mask = 0x80, value = 0, mul = 1;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) {
        const high = first & (mask - 1);
        return value + high * mul;
      }
      value += this.byte() * mul;
      mul *= 256;
      mask >>= 1;
    }
    if (!Number.isSafeInteger(value)) throw new Error('The 7z header holds a size that is too large');
    return value;
  }
  bytes(n) { if (n < 0 || this.p + n > this.b.length) throw new Error('The 7z header ends early'); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  bits(n) {
    const out = new Array(n);
    let cur = 0, mask = 0;
    for (let i = 0; i < n; i++) { if (mask === 0) { cur = this.byte(); mask = 0x80; } out[i] = (cur & mask) !== 0; mask >>= 1; }
    return out;
  }
  defined(n) { const all = this.byte(); return all ? new Array(n).fill(true) : this.bits(n); }
}

function readStreamsInfo(c) {
  const info = { packPos: 0, packSizes: [], folders: [], unpackSizes: [], substreams: null };
  for (;;) {
    const id = c.byte();
    if (id === 0x00) break;
    if (id === 0x06) {
      info.packPos = c.num();
      const n = c.num();
      for (;;) {
        const t = c.byte();
        if (t === 0x00) break;
        if (t === 0x09) for (let i = 0; i < n; i++) info.packSizes.push(c.num());
        else if (t === 0x0A) { const def = c.defined(n); for (const d of def) if (d) c.bytes(4); }
        else throw new Error('The 7z pack information has a part Vex does not know');
      }
    } else if (id === 0x07) {
      if (c.byte() !== 0x0B) throw new Error('The 7z folder list is not where it should be');
      const nf = c.num();
      if (c.byte() !== 0) throw new Error('The 7z header keeps its folders somewhere else, which Vex does not read');
      for (let f = 0; f < nf; f++) {
        const nc = c.num();
        const coders = [];
        let totalIn = 0, totalOut = 0;
        for (let i = 0; i < nc; i++) {
          const flag = c.byte();
          const idSize = flag & 0x0F;
          const coder = { id: c.bytes(idSize).toString('hex'), numIn: 1, numOut: 1, props: Buffer.alloc(0) };
          if (flag & 0x10) { coder.numIn = c.num(); coder.numOut = c.num(); }
          if (flag & 0x20) coder.props = Buffer.from(c.bytes(c.num()));
          totalIn += coder.numIn; totalOut += coder.numOut;
          coders.push(coder);
        }
        const bind = totalOut - 1;
        for (let i = 0; i < bind; i++) { c.num(); c.num(); }
        const packed = totalIn - bind;
        if (packed > 1) for (let i = 0; i < packed; i++) c.num();
        info.folders.push({ coders, totalOut });
      }
      if (c.byte() !== 0x0C) throw new Error('The 7z unpack sizes are not where they should be');
      for (const f of info.folders) { f.unpackSizes = []; for (let i = 0; i < f.totalOut; i++) f.unpackSizes.push(c.num()); f.unpackSize = f.unpackSizes[f.unpackSizes.length - 1]; }
      for (;;) {
        const t = c.byte();
        if (t === 0x00) break;
        if (t === 0x0A) { const def = c.defined(nf); def.forEach((d, i) => { if (d) { c.bytes(4); info.folders[i].crc = true; } }); }
        else throw new Error('The 7z unpack information has a part Vex does not know');
      }
    } else if (id === 0x08) {
      const counts = info.folders.map(() => 1);
      let t = c.byte();
      if (t === 0x0D) { for (let i = 0; i < counts.length; i++) counts[i] = c.num(); t = c.byte(); }
      const sizes = [];
      if (t === 0x09) {
        info.folders.forEach((f, i) => {
          let sum = 0;
          for (let k = 0; k < counts[i] - 1; k++) { const s = c.num(); sizes.push(s); sum += s; }
          if (counts[i] > 0) sizes.push(f.unpackSize - sum);
        });
        t = c.byte();
      } else info.folders.forEach((f, i) => { if (counts[i] === 1) sizes.push(f.unpackSize); });
      while (t !== 0x00) {
        if (t === 0x0A) {
          let need = 0;
          info.folders.forEach((f, i) => { need += (counts[i] === 1 && f.crc) ? 0 : counts[i]; });
          const def = c.defined(need); for (const d of def) if (d) c.bytes(4);
        } else throw new Error('The 7z substream information has a part Vex does not know');
        t = c.byte();
      }
      info.substreams = { counts, sizes };
    } else throw new Error('The 7z streams information has a part Vex does not know');
  }
  return info;
}

const COPY = '00', LZMA = '030101', AES = '06f10701';

function decodeFolder(reader, info, folderIndex) {
  const f = info.folders[folderIndex];
  if (f.coders.some(x => x.id === AES)) return { encrypted: true };
  if (f.coders.length !== 1) throw new Error('The 7z header is packed with a chain of methods Vex does not unpack');
  const coder = f.coders[0];
  let offset = 32 + info.packPos;
  for (let i = 0; i < folderIndex; i++) offset += info.packSizes[i] || 0;
  const packSize = info.packSizes[folderIndex];
  if (!Number.isFinite(packSize) || packSize > MAX_HEADER) throw new Error('The 7z header is larger than Vex reads');
  const packed = reader.read(offset, packSize);
  if (packed.length < packSize) throw new Error('The 7z file ends in the middle of its header');
  if (coder.id === COPY) return { data: packed };
  if (coder.id === LZMA) return { data: lzmaDecode(coder.props, packed, f.unpackSize) };
  throw new Error('The 7z header is packed with a method Vex does not unpack (' + coder.id + ')');
}

function readFiles(c, info) {
  const n = c.num();
  let emptyStream = new Array(n).fill(false), emptyFile = null, names = null;
  for (;;) {
    const type = c.byte();
    if (type === 0x00) break;
    const size = c.num();
    const end = c.p + size;
    if (end > c.b.length) throw new Error('The 7z header ends early');
    if (type === 0x0E) emptyStream = c.bits(n);
    else if (type === 0x0F) emptyFile = c.bits(emptyStream.filter(Boolean).length);
    else if (type === 0x11) {
      if (c.byte() !== 0) throw new Error('The 7z header keeps its names somewhere else, which Vex does not read');
      names = [];
      let s = c.p;
      const data = c.b.subarray(s, end);
      let from = 0;
      for (let i = 0; i + 1 < data.length && names.length < n; i += 2) {
        if (data[i] === 0 && data[i + 1] === 0) { names.push(data.subarray(from, i).toString('utf16le')); from = i + 2; }
      }
    }
    c.p = end;
  }
  if (!names || names.length !== n) throw new Error('The 7z header does not list every name');
  const entries = [];
  let stream = 0, empty = 0, sizeIndex = 0;
  const sizes = info && info.substreams ? info.substreams.sizes : [];
  for (let i = 0; i < n; i++) {
    if (entries.length >= MAX_ENTRIES) return { entries, truncated: true };
    if (emptyStream[i]) {
      const isFile = emptyFile ? emptyFile[empty] : false;
      empty++;
      entries.push({ name: names[i].replace(/\\/g, '/'), size: 0, dir: !isFile });
    } else {
      entries.push({ name: names[i].replace(/\\/g, '/'), size: sizes[sizeIndex++] || 0, dir: false });
      stream++;
    }
  }
  void stream;
  return { entries, truncated: false };
}

function parseHeader(buf, reader) {
  const c = new Cursor(buf);
  let id = c.byte();
  let info = null;
  if (id === 0x01) {
    for (;;) {
      id = c.byte();
      if (id === 0x00) break;
      if (id === 0x02) { for (;;) { const t = c.byte(); if (t === 0x00) break; c.bytes(c.num()); } }
      else if (id === 0x03) readStreamsInfo(c);
      else if (id === 0x04) info = readStreamsInfo(c);
      else if (id === 0x05) return readFiles(c, info);
      else throw new Error('The 7z header has a part Vex does not know');
    }
    return { entries: [], truncated: false };
  }
  void reader;
  throw new Error('The 7z header does not start like one');
}

function list7z(reader) {
  const sig = reader.read(0, 32);
  if (sig.length < 32 || !sig.subarray(0, 6).equals(SEVENZ_SIG)) return { ok: false, error: 'This does not start like a 7z archive' };
  if (crc32(sig, 12, 32) !== sig.readUInt32LE(8)) return { ok: false, error: 'The 7z start header failed its checksum, so the file is damaged' };
  const offset = Number(sig.readBigUInt64LE(12)), size = Number(sig.readBigUInt64LE(20));
  if (size === 0) return { ok: true, format: '7z', entries: [], encrypted: false, truncated: false };
  if (size > MAX_HEADER) return { ok: false, error: 'The 7z header is larger than Vex reads' };
  let header = reader.read(32 + offset, size);
  if (header.length < size) return { ok: false, error: 'The 7z file ends in the middle of its header (an incomplete download?)' };
  if (crc32(header) !== sig.readUInt32LE(28)) return { ok: false, error: 'The 7z header failed its checksum, so the file is damaged' };
  for (let layer = 0; layer < 4; layer++) {
    if (header[0] === 0x17) {
      const c = new Cursor(header); c.byte();
      const info = readStreamsInfo(c);
      if (!info.folders.length) throw new Error('The 7z header points at no data');
      const r = decodeFolder(reader, info, 0);
      if (r.encrypted) return { ok: true, format: '7z', entries: [], encrypted: true, truncated: false, note: 'Its headers are encrypted, so even the names need the password.' };
      header = r.data;
      continue;
    }
    const { entries, truncated } = parseHeader(header, reader);
    return { ok: true, format: '7z', entries, encrypted: false, truncated };
  }
  return { ok: false, error: 'The 7z header is wrapped too many times' };
}

function listArchive(reader, kind) {
  try {
    if (kind === 'rar') return listRar(reader);
    if (kind === '7z') return list7z(reader);
    return { ok: false, error: 'Vex lists .rar and .7z archives here' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { listArchive, listRar, list7z, lzmaDecode, bufferReader, fileReader, crc32, MAX_ENTRIES };
