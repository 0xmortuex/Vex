// T3-117 (Wave 6): the PDF toolkit shrinks pictures, and text with Turkish letters can be drawn with a Unicode font.
// Real pdf-lib and real @pdf-lib/fontkit. In a worktree without node_modules run with NODE_PATH pointing at one.
import { describe, it, expect } from 'vitest';

const zlib = require('zlib');
const lib = require('pdf-lib');
const images = require('../../src/main/pdf-images.js');
const fonts = require('../../src/main/pdf-fonts.js');
const T = require('../../src/main/pdf-toolkit.js');

// A JPEG header pdf-lib accepts (SOI, SOF0 with size/depth/3 channels, EOI) followed by filler: the codec is a stand-in.
function fakeJpeg(width, height, filler) {
  const head = Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([head, Buffer.alloc(filler, 7), Buffer.from([0xFF, 0xD9])]);
}

const stubCodec = (log = []) => ({
  reencodeJpeg: (bytes, opts) => { log.push(['jpeg', bytes.length, opts]); return { bytes: Buffer.alloc(Math.floor(bytes.length / 10), 1), width: 100, height: 50 }; },
  encodeRgb: (rgb, w, h, opts) => { log.push(['rgb', rgb.length, opts]); return { bytes: Buffer.alloc(2000, 2), width: w, height: h }; },
});

async function pdfWithPictures() {
  const doc = await lib.PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const jpg = await doc.embedJpg(fakeJpeg(400, 200, 60000));
  page.drawImage(jpg, { x: 0, y: 0, width: 100, height: 50 });
  // A plain RGB picture, Flate, no predictor: 60x60 of noise.
  const raw = Buffer.alloc(120 * 120 * 3);
  let seed = 12345;
  for (let i = 0; i < raw.length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; raw[i] = seed >>> 16; }
  const flate = doc.context.stream(zlib.deflateSync(raw), { Type: 'XObject', Subtype: 'Image', Width: 120, Height: 120, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' });
  doc.context.register(flate);
  // A gray picture, which is left alone.
  const gray = doc.context.stream(Buffer.alloc(30000, 5), { Type: 'XObject', Subtype: 'Image', Width: 150, Height: 200, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
  doc.context.register(gray);
  return Buffer.from(await doc.save());
}

describe('shrinkDocument', () => {
  it('re-encodes JPEG and plain RGB pictures, leaves gray ones, and keeps the file valid', async () => {
    const bytes = await pdfWithPictures();
    const doc = await lib.PDFDocument.load(bytes);
    const log = [];
    const r = images.shrinkDocument(doc, stubCodec(log), 'small');
    expect(r.changed).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.savedBytes).toBeGreaterThan(50000);
    expect(log.map(l => l[0]).sort()).toEqual(['jpeg', 'rgb']);
    expect(log[0][2]).toEqual({ quality: 50, maxDim: 1200 });
    const out = await doc.save();
    const again = await lib.PDFDocument.load(out);
    const widths = [];
    for (const [, o] of again.context.enumerateIndirectObjects()) {
      if (o instanceof lib.PDFRawStream && o.dict.get(lib.PDFName.of('Subtype')) && o.dict.get(lib.PDFName.of('Subtype')).decodeText() === 'Image') widths.push(o.dict.get(lib.PDFName.of('Filter')) ? o.dict.get(lib.PDFName.of('Filter')).decodeText() : 'none');
    }
    expect(widths.sort()).toEqual(['DCTDecode', 'DCTDecode', 'none']);
  });

  it('leaves a picture alone when the new bytes are not at least 10% smaller', async () => {
    const doc = await lib.PDFDocument.load(await pdfWithPictures());
    const r = images.shrinkDocument(doc, { reencodeJpeg: (b) => ({ bytes: Buffer.alloc(b.length - 10), width: 1, height: 1 }), encodeRgb: () => null }, 'balanced');
    expect(r.changed).toBe(0);
    expect(r.skipped).toBe(3);
  });

  it('refuses an unknown level and a missing codec', async () => {
    const doc = await lib.PDFDocument.load(await pdfWithPictures());
    expect(() => images.shrinkDocument(doc, stubCodec(), 'tiny')).toThrow(/small, balanced or high/);
    expect(() => images.shrinkDocument(doc, null, 'small')).toThrow(/codec/);
  });

  it('toolkit.shrink returns a smaller file, and throws a plain sentence when nothing was gained', async () => {
    const bytes = await pdfWithPictures();
    const r = await T.shrink(bytes, { level: 'balanced', codec: stubCodec() }, 'scan.pdf');
    expect(r.after).toBeLessThan(r.before);
    expect(r.changed).toBe(2);
    const plain = Buffer.from(await (async () => { const d = await lib.PDFDocument.create(); d.addPage(); return d.save(); })());
    await expect(T.shrink(plain, { codec: stubCodec() }, 'plain.pdf')).rejects.toThrow(/could not make this PDF smaller/);
  });

  it('the Electron codec scales to the long side and asks nativeImage for JPEG', () => {
    const calls = [];
    const img = (w, h) => ({ isEmpty: () => false, getSize: () => ({ width: w, height: h }), resize: (o) => { calls.push(['resize', o.width, o.height]); return img(o.width, o.height); }, toJPEG: (q) => { calls.push(['jpeg', q]); return Buffer.from([1, 2, 3]); } });
    const ni = { createFromBuffer: () => img(4000, 2000), createFromBitmap: (buf, s) => { calls.push(['bitmap', buf.length, s.width]); return img(s.width, s.height); } };
    const enc = images.nativeImageEncoder(ni);
    const out = enc.reencodeJpeg(Buffer.from([1]), { quality: 70, maxDim: 1600 });
    expect(out).toEqual({ bytes: Buffer.from([1, 2, 3]), width: 1600, height: 800 });
    expect(calls).toContainEqual(['resize', 1600, 800]);
    expect(calls).toContainEqual(['jpeg', 70]);
    const rgb = enc.encodeRgb(Buffer.alloc(2 * 2 * 3), 2, 2, { quality: 50, maxDim: 1200 });
    expect(rgb.width).toBe(2);
    expect(calls).toContainEqual(['bitmap', 16, 2]);
  });
});

describe('Unicode font for Turkish letters', () => {
  const turkish = 'Şğıİ çöü ŞĞ';
  it('knows which letters the standard font cannot draw', () => {
    expect(fonts.standardMissing('Merhaba çöü')).toEqual([]);
    expect(fonts.standardMissing(turkish).sort()).toEqual(['Ğ', 'Ş', 'ğ', 'ı', 'İ'].sort());
  });

  it('looks for fixed system font names only and throws when none exists', () => {
    const win = fonts.candidatePaths({ platform: 'win32', env: { WINDIR: 'D:\\Win' } });
    expect(win[0].toLowerCase()).toContain('d:\\win\\fonts');
    expect(win.every(p => /\.ttf$/.test(p))).toBe(true);
    expect(() => fonts.readSystemFont({ fsImpl: { existsSync: () => false }, platform: 'linux' })).toThrow(/No system font/);
    const fsImpl = { existsSync: (p) => /DejaVuSans/.test(p), readFileSync: () => Buffer.from([1, 2, 3]) };
    expect(fonts.readSystemFont({ fsImpl, platform: 'linux' }).bytes.length).toBe(3);
  });

  it('plain Latin text keeps the standard font and embeds nothing', async () => {
    const doc = await lib.PDFDocument.create();
    const r = await fonts.fontFor(doc, ['Hello', 'caf\u00E9'], { fsImpl: { existsSync: () => { throw new Error('must not look for a font'); } } });
    expect(r.unicode).toBe(false);
  });

  let sys = null;
  try { sys = fonts.readSystemFont(); } catch { sys = null; }
  it.skipIf(!sys)('Turkish text is drawn with an embedded subset of the system font', async () => {
    const doc = await lib.PDFDocument.create();
    const page = doc.addPage([300, 100]);
    const r = await fonts.fontFor(doc, turkish);
    expect(r.unicode).toBe(true);
    expect(fonts.fontMissing(r.font, turkish)).toEqual([]);
    page.drawText(turkish, { x: 10, y: 50, size: 14, font: r.font });
    const out = await doc.save();
    expect(out.length).toBeGreaterThan(1000);
    expect((await lib.PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('a font that lacks a letter is a plain error, not a dropped letter', async () => {
    const doc = await lib.PDFDocument.create();
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    expect(fonts.fontMissing(font, 'a\u015F')).toEqual(['\u015F']);
  });
});
