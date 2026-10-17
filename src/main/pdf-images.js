// === Shrink the pictures inside a PDF (T3-117: compress with image re-encoding) ===
//
// A scan or a slide deck is mostly pictures; repacking the PDF structure barely
// helps. This re-encodes the big pictures as lower-quality JPEG (and scales
// down the ones larger than the chosen size), then writes the file with
// compressed object streams. It runs in main, on a copy; the original is never
// touched.
//
// What is re-encoded: JPEG pictures (DCTDecode) and plain 8-bit RGB pictures
// stored with Flate and no predictor (what pdf-lib and most scanners write), in
// DeviceRGB. What is left alone, and counted in the result: pictures in other
// colour spaces (CMYK, gray, indexed), masks and colour-key transparency, pictures
// with a /Decode array, Flate pictures with a PNG predictor, and any picture where
// the new bytes would not be at least 10% smaller. A picture with a soft mask
// keeps it (the mask is its own picture).
//
// The picture codec is injected: in Vex it is Electron's nativeImage (see
// nativeImageEncoder), in tests a stand-in.

const zlib = require('zlib');

const LEVELS = Object.freeze({
  small: { quality: 50, maxDim: 1200 },
  balanced: { quality: 70, maxDim: 1600 },
  high: { quality: 85, maxDim: 2400 },
});
const MIN_GAIN = 0.9;           // keep a new picture only when it is at most 90% of the old one
const MIN_BYTES = 8 * 1024;     // pictures smaller than this are not worth touching
const MAX_PIXELS = 60 * 1000 * 1000;

function filterNames(lib, dict) {
  const { PDFName, PDFArray } = lib;
  const f = dict.get(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map(x => (x instanceof PDFName ? x.decodeText() : '?'));
  return ['?'];
}

// A codec over Electron's nativeImage. It decodes, scales down to maxDim on the long side, and encodes JPEG.
function nativeImageEncoder(nativeImage) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') throw new Error('nativeImageEncoder needs Electron nativeImage');
  const finish = (img, { quality, maxDim }) => {
    const size = img.getSize();
    const scale = Math.min(1, maxDim / Math.max(size.width, size.height));
    const out = scale < 1 ? img.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }) : img;
    const s = out.getSize();
    return { bytes: out.toJPEG(quality), width: s.width, height: s.height };
  };
  return {
    reencodeJpeg(bytes, opts) {
      const img = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (img.isEmpty()) return null;
      return finish(img, opts);
    },
    encodeRgb(rgb, width, height, opts) {
      const bgra = Buffer.alloc(width * height * 4);
      for (let i = 0, j = 0; i < width * height; i++, j += 3) {
        bgra[i * 4] = rgb[j + 2]; bgra[i * 4 + 1] = rgb[j + 1]; bgra[i * 4 + 2] = rgb[j]; bgra[i * 4 + 3] = 255;
      }
      const img = nativeImage.createFromBitmap(bgra, { width, height });
      if (img.isEmpty()) return null;
      return finish(img, opts);
    },
  };
}

// doc: a loaded pdf-lib PDFDocument. -> { changed, skipped, savedBytes } and the document edited in place.
function shrinkDocument(doc, codec, level = 'balanced') {
  const lib = require('pdf-lib');
  const { PDFName, PDFNumber, PDFRawStream, PDFBool, PDFArray } = lib;
  const preset = LEVELS[level];
  if (!preset) throw new Error('Pick small, balanced or high quality');
  if (!codec || typeof codec.reencodeJpeg !== 'function' || typeof codec.encodeRgb !== 'function') throw new Error('shrinkDocument needs a picture codec');
  const name = (s) => PDFName.of(s);
  let changed = 0, skipped = 0, savedBytes = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(name('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Image') continue;
    const before = obj.getContents().length;
    if (before < MIN_BYTES) continue;
    const cs = dict.get(name('ColorSpace'));
    const bpc = dict.get(name('BitsPerComponent'));
    const w = dict.get(name('Width')), h = dict.get(name('Height'));
    const isMask = dict.get(name('ImageMask'));
    const hasKeyMask = dict.get(name('Mask'));
    const hasDecode = dict.get(name('Decode'));
    const filters = filterNames(lib, dict);
    const rgb = cs instanceof PDFName && cs.decodeText() === 'DeviceRGB';
    const okShape = rgb && bpc instanceof PDFNumber && bpc.asNumber() === 8 && w instanceof PDFNumber && h instanceof PDFNumber
      && !(isMask instanceof PDFBool && isMask.asBoolean()) && !hasKeyMask && !hasDecode && !(hasKeyMask instanceof PDFArray);
    if (!okShape || filters.length !== 1 || (filters[0] !== 'DCTDecode' && filters[0] !== 'FlateDecode')) { skipped++; continue; }
    if (filters[0] === 'FlateDecode' && dict.get(name('DecodeParms'))) { skipped++; continue; }
    const width = w.asNumber(), height = h.asNumber();
    if (width * height > MAX_PIXELS) { skipped++; continue; }
    let result;
    if (filters[0] === 'DCTDecode') {
      result = codec.reencodeJpeg(obj.getContents(), preset);
    } else {
      const raw = zlib.inflateSync(Buffer.from(obj.getContents()));
      if (raw.length !== width * height * 3) { skipped++; continue; }
      result = codec.encodeRgb(raw, width, height, preset);
    }
    if (!result || !result.bytes || result.bytes.length > before * MIN_GAIN) { skipped++; continue; }
    const next = dict.clone ? dict.clone(doc.context) : dict;
    next.set(name('Filter'), name('DCTDecode'));
    next.delete(name('DecodeParms'));
    next.set(name('Width'), PDFNumber.of(result.width));
    next.set(name('Height'), PDFNumber.of(result.height));
    doc.context.assign(ref, PDFRawStream.of(next, new Uint8Array(result.bytes)));
    changed++;
    savedBytes += before - result.bytes.length;
  }
  return { changed, skipped, savedBytes };
}

module.exports = { shrinkDocument, nativeImageEncoder, LEVELS, MIN_GAIN, MIN_BYTES };
