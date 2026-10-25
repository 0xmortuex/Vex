// What a picture says about itself, read from its own bytes, on this computer only (nothing is sent anywhere):
// the colour profile and, in a JPEG, a PNG or a WebP, the camera's EXIF. Pure functions over an ArrayBuffer so they can be tested.

const td = (bytes, start, end) => { let s = ''; for (let i = start; i < end && i < bytes.length && bytes[i] !== 0; i++) s += String.fromCharCode(bytes[i]); return s; };
const ascii = (bytes, at, len) => td(bytes, at, at + len);

export function sniff(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes.length >= 6 && /^GIF8[79]a/.test(ascii(bytes, 0, 6))) return 'gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && /^(avif|avis)/.test(ascii(bytes, 8, 4))) return 'avif';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'ico';
  return null;
}

// ---- ICC profile -> a name -------------------------------------------------------------------------
function iccName(p) {
  if (!p || p.length < 132) return null;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const space = ascii(p, 16, 4).trim();
  const count = dv.getUint32(128);
  for (let i = 0; i < count && 132 + i * 12 + 12 <= p.length; i++) {
    const at = 132 + i * 12;
    if (ascii(p, at, 4) !== 'desc') continue;
    const off = dv.getUint32(at + 4), size = dv.getUint32(at + 8);
    if (off + size > p.length || size < 12) continue;
    const kind = ascii(p, off, 4);
    if (kind === 'desc') {                                   // v2: ASCII
      const n = dv.getUint32(off + 8);
      return { name: ascii(p, off + 12, Math.max(0, n - 1)), space };
    }
    if (kind === 'mluc' && dv.getUint32(off + 8) > 0) {      // v4: UTF-16BE
      const len = dv.getUint32(off + 20), from = off + dv.getUint32(off + 24);
      let s = '';
      for (let j = 0; j + 1 < len && from + j + 1 < p.length; j += 2) s += String.fromCharCode(dv.getUint16(from + j));
      return { name: s, space };
    }
  }
  return { name: '', space };
}

// ---- EXIF (a TIFF structure) -----------------------------------------------------------------------
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readTiff(bytes, base, end) {
  if (end - base < 12) return null;
  const le = ascii(bytes, base, 2) === 'II';
  if (!le && ascii(bytes, base, 2) !== 'MM') return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  if (u16(base + 2) !== 42) return null;
  function ifd(offset, depth = 0) {
    const out = new Map();
    let at = base + offset;
    if (at + 2 > end || depth > 4) return out;
    const n = Math.min(u16(at), 400);
    at += 2;
    for (let i = 0; i < n && at + 12 <= end; i++, at += 12) {
      const tag = u16(at), type = u16(at + 2), count = u32(at + 4);
      const size = (TYPE_SIZE[type] || 1) * count;
      const data = size <= 4 ? at + 8 : base + u32(at + 8);
      if (size > 4096 || data < base || data + size > end) continue;
      let value;
      if (type === 2) value = td(bytes, data, data + count).trim();
      else if (type === 3) value = Array.from({ length: Math.min(count, 8) }, (_, k) => u16(data + k * 2));
      else if (type === 4) value = Array.from({ length: Math.min(count, 8) }, (_, k) => u32(data + k * 4));
      else if (type === 5) value = Array.from({ length: Math.min(count, 8) }, (_, k) => { const d = u32(data + k * 8 + 4); return d ? u32(data + k * 8) / d : 0; });
      else continue;
      out.set(tag, value);
    }
    out.next = (at + 4 <= end) ? u32(at) : 0;
    return out;
  }
  return { ifd, u32, base };
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
function dms(v, ref) {
  if (!Array.isArray(v) || v.length < 3) return null;
  let d = v[0] + v[1] / 60 + v[2] / 3600;
  if (ref === 'S' || ref === 'W') d = -d;
  return Number.isFinite(d) ? d : null;
}
const fixed = (n, digits) => Number(n).toFixed(digits);

// -> { make, model, lens, software, taken, exposure, aperture, iso, focal, orientation, gps: { lat, lon, alt } } with only what is present
export function parseExif(bytes, base, end) {
  const tiff = readTiff(bytes, base, end);
  if (!tiff) return null;
  const r = {};
  const root = tiff.ifd(tiff.u32(base + 4));
  const text = (tag) => (typeof root.get(tag) === 'string' && root.get(tag) ? root.get(tag) : null);
  if (text(0x010f)) r.make = text(0x010f);
  if (text(0x0110)) r.model = text(0x0110);
  if (text(0x0131)) r.software = text(0x0131);
  if (first(root.get(0x0112)) > 1) r.orientation = first(root.get(0x0112));
  if (text(0x0132)) r.taken = text(0x0132);
  const exifAt = first(root.get(0x8769));
  if (exifAt) {
    const e = tiff.ifd(exifAt);
    const s = (t) => (typeof e.get(t) === 'string' && e.get(t) ? e.get(t) : null);
    if (s(0x9003)) r.taken = s(0x9003);
    if (s(0xa434)) r.lens = s(0xa434);
    const ex = first(e.get(0x829a)); if (ex > 0) r.exposure = ex >= 1 ? fixed(ex, ex % 1 ? 1 : 0) + ' s' : '1/' + Math.round(1 / ex) + ' s';
    const fn = first(e.get(0x829d)); if (fn > 0) r.aperture = 'f/' + fixed(fn, 1).replace(/\.0$/, '');
    const iso = first(e.get(0x8827)); if (iso > 0) r.iso = 'ISO ' + iso;
    const fl = first(e.get(0x920a)); if (fl > 0) r.focal = fixed(fl, 1).replace(/\.0$/, '') + ' mm';
  }
  const gpsAt = first(root.get(0x8825));
  if (gpsAt) {
    const g = tiff.ifd(gpsAt);
    const lat = dms(g.get(2), g.get(1)), lon = dms(g.get(4), g.get(3));
    if (lat != null && lon != null) {
      r.gps = { lat, lon };
      const alt = first(g.get(6)); if (Number.isFinite(alt)) r.gps.alt = first(g.get(5)) === 1 || (Array.isArray(g.get(5)) && g.get(5)[0] === 1) ? -alt : alt;
    }
  }
  return r;
}

// ---- containers -------------------------------------------------------------------------------------
function jpeg(bytes) {
  const out = { exif: null, icc: null };
  const iccParts = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;            // image data begins
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const at = i + 4, stop = Math.min(bytes.length, i + 2 + len);
    if (marker === 0xe1 && ascii(bytes, at, 4) === 'Exif' && !out.exif) out.exif = parseExif(bytes, at + 6, stop);
    if (marker === 0xe2 && ascii(bytes, at, 11) === 'ICC_PROFILE') iccParts.push({ seq: bytes[at + 12], data: bytes.subarray(at + 14, stop) });
    i += 2 + len;
  }
  if (iccParts.length) {
    iccParts.sort((a, b) => a.seq - b.seq);
    const whole = new Uint8Array(iccParts.reduce((n, p) => n + p.data.length, 0));
    let o = 0;
    for (const p of iccParts) { whole.set(p.data, o); o += p.data.length; }
    out.icc = iccName(whole);
  }
  return out;
}

function png(bytes) {
  const out = { exif: null, icc: null };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i), type = ascii(bytes, i + 4, 4), at = i + 8;
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'sRGB') out.icc = { name: 'sRGB', space: 'RGB' };
    else if (type === 'iCCP' && !out.icc) out.icc = { name: ascii(bytes, at, 80), space: 'RGB' };    // the profile's name; its body is compressed
    else if (type === 'eXIf' && at + len <= bytes.length) out.exif = parseExif(bytes, at, at + len);
    i += 12 + len;
  }
  return out;
}

function webp(bytes) {
  const out = { exif: null, icc: null };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 12;
  while (i + 8 <= bytes.length) {
    const type = ascii(bytes, i, 4), len = dv.getUint32(i + 4, true), at = i + 8;
    if (at + len > bytes.length) break;
    if (type === 'EXIF') out.exif = parseExif(bytes, ascii(bytes, at, 4) === 'Exif' ? at + 6 : at, at + len);
    if (type === 'ICCP') out.icc = iccName(bytes.subarray(at, at + len));
    i += 8 + len + (len & 1);
  }
  return out;
}

// -> { kind, exif, icc } ; kind is null when the bytes are none of the known containers.
export function readMeta(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const kind = sniff(bytes);
  try {
    if (kind === 'jpeg') return { kind, ...jpeg(bytes) };
    if (kind === 'png') return { kind, ...png(bytes) };
    if (kind === 'webp') return { kind, ...webp(bytes) };
  } catch (err) {
    // A damaged block hides only the details, never the picture.
    return { kind, exif: null, icc: null, error: err.message };
  }
  return { kind, exif: null, icc: null };
}

// Decimal degrees as the person reads them: 41.00820 N, 28.97840 E
export function formatPlace(gps) {
  const f = (n, pos, neg) => Math.abs(n).toFixed(5) + ' ' + (n >= 0 ? pos : neg);
  return f(gps.lat, 'N', 'S') + ', ' + f(gps.lon, 'E', 'W');
}
