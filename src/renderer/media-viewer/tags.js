// A tiny tag reader: the title, artist, album, cover picture and chapters inside a media file. ID3v2 (mp3, and some wav/aac), MP4 / M4A
// (moov > udta > meta > ilst, and the chpl chapter list) and FLAC (Vorbis comment and PICTURE blocks) are read. It reads only the bytes it
// needs, by Range request through the player's own route (never the whole file), and a file with no tags gives an empty result.
//
// Result: { title, artist, album, cover: { type, bytes } | null, chapters: [{ start, title }] }   (start in seconds)

const EMPTY = () => ({ title: '', artist: '', album: '', cover: null, chapters: [], unsupportedAudio: [] });
const MAX_TAG_BYTES = 12 * 1024 * 1024;          // a bigger tag block is left unread
const MAX_MOOV_BYTES = 24 * 1024 * 1024;

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b, o) => ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;
const u24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const synchsafe = (b, o) => ((b[o] & 0x7F) << 21) | ((b[o + 1] & 0x7F) << 14) | ((b[o + 2] & 0x7F) << 7) | (b[o + 3] & 0x7F);
const ascii = (b, s, e) => { let out = ''; for (let i = s; i < e; i++) out += String.fromCharCode(b[i]); return out; };
const utf8 = (b, s, e) => new TextDecoder('utf-8').decode(b.subarray(s, e));

function decodeId3Text(bytes, enc) {
  let view = bytes;
  // The terminating zero(s), if any.
  if (enc === 1 || enc === 2) { while (view.length >= 2 && view[view.length - 1] === 0 && view[view.length - 2] === 0) view = view.subarray(0, view.length - 2); }
  else { while (view.length && view[view.length - 1] === 0) view = view.subarray(0, view.length - 1); }
  if (enc === 0) return Array.from(view, (c) => String.fromCharCode(c)).join('');
  if (enc === 1) {
    if (view[0] === 0xFE && view[1] === 0xFF) return new TextDecoder('utf-16be').decode(view.subarray(2));
    if (view[0] === 0xFF && view[1] === 0xFE) return new TextDecoder('utf-16le').decode(view.subarray(2));
    return new TextDecoder('utf-16le').decode(view);
  }
  if (enc === 2) return new TextDecoder('utf-16be').decode(view);
  return new TextDecoder('utf-8').decode(view);
}

// Where a text field ends: a zero byte (two for UTF-16).
function endOfText(bytes, start, enc) {
  if (enc === 1 || enc === 2) { for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i; return bytes.length; }
  for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
  return bytes.length;
}

const imageType = (mime, bytes) => {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/png' || m === 'png') return 'image/png';
  if (m === 'image/jpeg' || m === 'image/jpg' || m === 'jpg' || m === 'jpeg') return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return m.startsWith('image/') ? m : 'image/jpeg';
};

// ---- ID3v2 ------------------------------------------------------------------
// The size of the whole tag (header included) from its first ten bytes, or 0 when there is none.
export function id3Size(head) {
  if (!head || head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  return 10 + synchsafe(head, 6) + ((head[5] & 0x10) ? 10 : 0);
}

export function parseId3(bytes) {
  const out = EMPTY();
  if (!bytes || id3Size(bytes) === 0) return out;
  const version = bytes[3];
  if (version < 2 || version > 4) return out;
  let body = bytes.subarray(10, Math.min(bytes.length, id3Size(bytes)));
  if (bytes[5] & 0x80 && version < 4) {
    // Unsynchronisation: every FF 00 stands for FF.
    const kept = [];
    for (let i = 0; i < body.length; i++) { kept.push(body[i]); if (body[i] === 0xFF && body[i + 1] === 0) i++; }
    body = Uint8Array.from(kept);
  }
  if (bytes[5] & 0x40) {                                   // an extended header: skip it
    const ext = version === 4 ? synchsafe(body, 0) : u32(body, 0) + 4;
    body = body.subarray(Math.min(ext, body.length));
  }
  walkId3Frames(body, version, out, out.chapters, true);
  out.chapters = out.chapters.filter((c) => Number.isFinite(c.start)).sort((a, b) => a.start - b.start);
  return out;
}

function walkId3Frames(body, version, out, chapters, top) {
  const idLen = version === 2 ? 3 : 4, headLen = version === 2 ? 6 : 10;
  let pos = 0;
  while (pos + headLen <= body.length) {
    const id = ascii(body, pos, pos + idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;                // padding
    const size = version === 2 ? u24(body, pos + 3) : version === 4 ? synchsafe(body, pos + 4) : u32(body, pos + 4);
    const start = pos + headLen, end = start + size;
    if (size < 0 || end > body.length) break;
    const data = body.subarray(start, end);
    const text = () => decodeId3Text(data.subarray(1), data[0]);
    if (id === 'TIT2' || id === 'TT2') { if (top && !out.title) out.title = text(); else if (!top && !out._chapterTitle) out._chapterTitle = text(); }
    else if (top && (id === 'TPE1' || id === 'TP1')) { if (!out.artist) out.artist = text(); }
    else if (top && (id === 'TALB' || id === 'TAL')) { if (!out.album) out.album = text(); }
    else if (top && (id === 'APIC' || id === 'PIC')) readApic(data, version, out);
    else if (top && id === 'CHAP') {
      const nul = data.indexOf(0);
      if (nul >= 0 && data.length >= nul + 17) {
        const startMs = u32(data, nul + 1);
        const sub = { _chapterTitle: '' };
        walkId3Frames(data.subarray(nul + 17), version, sub, [], false);
        chapters.push({ start: startMs / 1000, title: sub._chapterTitle || '' });
      }
    }
    pos = end;
  }
  if (top) delete out._chapterTitle;
}

function readApic(data, version, out) {
  const enc = data[0];
  let mime, p;
  if (version === 2) { mime = ascii(data, 1, 4); p = 4; }
  else { const e = data.indexOf(0, 1); if (e < 0) return; mime = ascii(data, 1, e); p = e + 1; }
  const pictureType = data[p];
  p += 1;
  p = endOfText(data, p, enc) + ((enc === 1 || enc === 2) ? 2 : 1);   // the description
  if (p >= data.length) return;
  const bytes = data.subarray(p);
  // Prefer the front cover (type 3); keep the first picture otherwise.
  if (!out.cover || (pictureType === 3 && out.cover.pictureType !== 3)) out.cover = { type: imageType(mime, bytes), bytes, pictureType };
}

// ---- MP4 / M4A ----------------------------------------------------------------
// The boxes inside [start, end) of `b`: [{ type, start (of the payload), end }]
export function mp4Boxes(b, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = u32(b, pos);
    const type = ascii(b, pos + 4, pos + 8);
    let head = 8;
    if (size === 1) { if (pos + 16 > end) break; size = u32(b, pos + 8) * 4294967296 + u32(b, pos + 12); head = 16; }
    else if (size === 0) size = end - pos;
    if (size < head || pos + size > end) break;
    out.push({ type, start: pos + head, end: pos + size });
    pos += size;
  }
  return out;
}

const find = (boxes, type) => boxes.find((x) => x.type === type);

// `moov` is the bytes of the movie box including its own header or just its payload: pass the whole `b` and the payload range.
export function parseMoov(b, start, end) {
  const out = EMPTY();
  const udta = find(mp4Boxes(b, start, end), 'udta');
  if (!udta) return out;
  const inUdta = mp4Boxes(b, udta.start, udta.end);
  const meta = find(inUdta, 'meta');
  if (meta) {
    const ilst = find(mp4Boxes(b, meta.start + 4, meta.end), 'ilst');         // meta has four bytes of version and flags first
    if (ilst) {
      for (const item of mp4Boxes(b, ilst.start, ilst.end)) {
        const data = find(mp4Boxes(b, item.start, item.end), 'data');
        if (!data || data.end - data.start < 8) continue;
        const flags = u32(b, data.start) & 0xFFFFFF;
        const payload = b.subarray(data.start + 8, data.end);
        const key = item.type;
        if (key === '©nam' && !out.title) out.title = utf8(payload, 0, payload.length);
        else if ((key === '©ART' || key === 'aART') && !out.artist) out.artist = utf8(payload, 0, payload.length);
        else if (key === '©alb' && !out.album) out.album = utf8(payload, 0, payload.length);
        else if (key === 'covr' && !out.cover && payload.length) out.cover = { type: flags === 14 ? 'image/png' : flags === 13 ? 'image/jpeg' : imageType('', payload), bytes: payload };
      }
    }
  }
  const chpl = find(inUdta, 'chpl');
  if (chpl && chpl.end - chpl.start > 9) {
    // version(1) flags(3) reserved(4) count(1), then per chapter: start (8, in 100 ns) length(1) title
    let p = chpl.start + 8;
    const count = b[p];
    p += 1;
    for (let i = 0; i < count && p + 9 <= chpl.end; i++) {
      const hi = u32(b, p), lo = u32(b, p + 4);
      const len = b[p + 8];
      if (p + 9 + len > chpl.end) break;
      out.chapters.push({ start: (hi * 4294967296 + lo) / 1e7, title: utf8(b, p + 9, p + 9 + len) });
      p += 9 + len;
    }
  }
  return out;
}

// ---- FLAC ------------------------------------------------------------------------
// One metadata block's header at `b[o..o+4)`: { last, type, length }
export function flacBlockHeader(b, o) { return { last: !!(b[o] & 0x80), type: b[o] & 0x7F, length: u24(b, o + 1) }; }

export function parseFlacBlock(type, data, out) {
  if (type === 4) {                                       // Vorbis comment
    let p = 0;
    const vendor = u32le(data, p); p += 4 + vendor;
    const count = u32le(data, p); p += 4;
    for (let i = 0; i < count && p + 4 <= data.length; i++) {
      const len = u32le(data, p); p += 4;
      const line = utf8(data, p, p + len); p += len;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).toUpperCase(), value = line.slice(eq + 1);
      if (key === 'TITLE' && !out.title) out.title = value;
      else if (key === 'ARTIST' && !out.artist) out.artist = value;
      else if (key === 'ALBUM' && !out.album) out.album = value;
    }
  } else if (type === 6) {                                // PICTURE
    const pictureType = u32(data, 0);
    let p = 4;
    const mimeLen = u32(data, p); p += 4;
    const mime = ascii(data, p, p + mimeLen); p += mimeLen;
    const descLen = u32(data, p); p += 4 + descLen + 16;
    const dataLen = u32(data, p); p += 4;
    const bytes = data.subarray(p, p + dataLen);
    if (bytes.length && (!out.cover || (pictureType === 3 && out.cover.pictureType !== 3))) out.cover = { type: imageType(mime, bytes), bytes, pictureType };
  }
}

// ---- sound formats the browser's decoders do not have ---------------------------------
// MP4 / MOV name a track's codec by a four-letter code, Matroska by a text id; either appears in plain bytes of the header. Used to
// explain a video that plays without sound (AC3, DTS and TrueHD are not decoded here).
const UNSUPPORTED_AUDIO = [['ac-3', 'AC3'], ['ec-3', 'E-AC3'], ['dtsc', 'DTS'], ['dtsh', 'DTS'], ['dtsl', 'DTS'], ['dtse', 'DTS'], ['mlpa', 'TrueHD'],
  ['A_AC3', 'AC3'], ['A_EAC3', 'E-AC3'], ['A_DTS', 'DTS'], ['A_TRUEHD', 'TrueHD']];
export function unsupportedAudioIn(bytes) {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 4 * 1024 * 1024));
  const found = new Set();
  for (const [code, name] of UNSUPPORTED_AUDIO) if (text.includes(code)) found.add(name);
  return [...found];
}

// ---- fetching just enough ----------------------------------------------------------
// Bytes [start, start+length) of `url`. A server that ignores Range gives the whole file with a 200: only what was asked for is read
// from that stream and the rest is dropped; asking for anything but the start of it is refused.
export async function fetchBytes(url, start, length, doFetch = fetch) {
  const response = await doFetch(url, { headers: { Range: 'bytes=' + start + '-' + (start + length - 1) } });
  if (response.status === 416) return { bytes: new Uint8Array(0), total: null };
  if (response.status !== 206 && response.status !== 200) throw new Error('The player route answered ' + response.status);
  if (response.status === 200 && start > 0) { try { await response.body.cancel(); } catch { /* vex-allow-empty-catch: the stream is closed already */ } throw new Error('This source does not support reading by range'); }
  const rangeTotal = /\/(\d+)\s*$/.exec(response.headers.get('content-range') || '');
  const total = rangeTotal ? Number(rangeTotal[1]) : (response.status === 200 && response.headers.get('content-length') ? Number(response.headers.get('content-length')) : null);
  const reader = response.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < length) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
  }
  try { await reader.cancel(); } catch { /* vex-allow-empty-catch: finished */ }
  const bytes = new Uint8Array(Math.min(got, length));
  let o = 0;
  for (const c of chunks) { const take = c.subarray(0, Math.max(0, Math.min(c.length, bytes.length - o))); bytes.set(take, o); o += take.length; }
  return { bytes, total };
}

// The tags of the file at `url` (the player's /doc route). `ext` is the file's extension, `.mp3`, `.m4a`...
export async function readTags(url, ext, doFetch = fetch) {
  const head = await fetchBytes(url, 0, 16, doFetch);
  const b = head.bytes;
  if (b.length < 8) return EMPTY();
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = id3Size(b);
    if (size > MAX_TAG_BYTES) return EMPTY();
    const whole = await fetchBytes(url, 0, size, doFetch);
    return parseId3(whole.bytes);
  }
  if (ascii(b, 4, 8) === 'ftyp' || ['.m4a', '.mp4', '.m4v', '.mov'].includes(ext)) return readMp4(url, head.total, doFetch);
  if (ascii(b, 0, 4) === 'fLaC') return readFlac(url, doFetch);
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) {            // Matroska / WebM: the track list is near the start
    const out = EMPTY();
    out.unsupportedAudio = unsupportedAudioIn((await fetchBytes(url, 0, 256 * 1024, doFetch)).bytes);
    return out;
  }
  return EMPTY();
}

async function readMp4(url, total, doFetch) {
  let pos = 0;
  for (let hops = 0; hops < 64; hops++) {
    const { bytes } = await fetchBytes(url, pos, 16, doFetch);
    if (bytes.length < 8) return EMPTY();
    let size = u32(bytes, 0);
    const type = ascii(bytes, 4, 8);
    let head = 8;
    if (size === 1 && bytes.length >= 16) { size = u32(bytes, 8) * 4294967296 + u32(bytes, 12); head = 16; }
    else if (size === 0) size = total ? total - pos : 0;
    if (size < head) return EMPTY();
    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) return EMPTY();
      const moov = await fetchBytes(url, pos, size, doFetch);
      const parsed = parseMoov(moov.bytes, head, moov.bytes.length);
      parsed.unsupportedAudio = unsupportedAudioIn(moov.bytes);
      return parsed;
    }
    pos += size;
    if (total && pos >= total) return EMPTY();
  }
  return EMPTY();
}

async function readFlac(url, doFetch) {
  const out = EMPTY();
  let pos = 4;
  for (let blocks = 0; blocks < 64; blocks++) {
    const { bytes } = await fetchBytes(url, pos, 4, doFetch);
    if (bytes.length < 4) break;
    const header = flacBlockHeader(bytes, 0);
    if (header.length > MAX_TAG_BYTES) { pos += 4 + header.length; if (header.last) break; continue; }
    if (header.type === 4 || header.type === 6) {
      const body = await fetchBytes(url, pos + 4, header.length, doFetch);
      parseFlacBlock(header.type, body.bytes, out);
    }
    pos += 4 + header.length;
    if (header.last) break;
  }
  return out;
}

export const _internals = { MAX_TAG_BYTES, EMPTY };
