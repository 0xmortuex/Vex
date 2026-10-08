// A Chrome Web Store theme, read as a theme and nothing else
// (src/main/chrome-theme.js), through the same signature checks as an
// extension (src/main/webstore.js). Packages are built and signed here the way
// Google builds them; the pictures are real PNGs made byte by byte.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const ws = require('../../src/main/webstore.js');
const ctm = require('../../src/main/chrome-theme.js');
const AdmZip = require('adm-zip');
const { validateZip } = require('../../src/main/archive-security.js');

// ---- building a CRX3 (as tests/main/webstore.test.js) -----------------------
const varint = (n) => { const out = []; while (n > 127) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
const field = (num, bytes) => Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);
const spki = (key) => key.export({ type: 'spki', format: 'der' });
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const idOf = (der) => [...sha(der).subarray(0, 16).toString('hex')].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const developer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const store = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const DEV_ID = idOf(spki(developer.publicKey));
const STORE_HASH = sha(spki(store.publicKey)).toString('hex');
function makeZip(files) {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(files)) zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  return zip.toBuffer();
}
function makeCrx(archive, signers = [developer, store]) {
  const signedHeaderData = field(1, sha(spki(developer.publicKey)).subarray(0, 16));
  const message = ws.signedMessage(signedHeaderData, archive);
  const proofs = signers.map(pair => field(pair === store ? 3 : 2,
    Buffer.concat([field(1, spki(pair.publicKey)), field(2, crypto.sign('sha256', message, pair.privateKey))])));
  const header = Buffer.concat([...proofs, field(10000, signedHeaderData)]);
  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'latin1');
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, archive]);
}

// ---- pictures ------------------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
// A real w x h PNG of one colour.
function png(w, h, [r, g, b] = [200, 80, 40]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(new Array(w).fill([r, g, b]).flat())]);
  const raw = Buffer.concat(new Array(h).fill(row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Only a PNG's header, claiming any size.
function pngHeader(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
}

const THEME = {
  manifest_version: 2, name: '__MSG_name__', version: '3', default_locale: 'en', description: 'Blue hour',
  update_url: 'https://clients2.google.com/service/update2/crx', icons: { 128: 'icon.png' },
  theme: {
    colors: {
      frame: [20, 40, 90], toolbar: [30, 55, 110, 1], tab_text: [255, 255, 255], ntp_link: [120, 200, 255],
      button_background: [0, 0, 0, 0], ntp_text: 'white', bookmark_text: [300, -5, 10.6], made_up_key: [1, 2, 3],
    },
    tints: { buttons: [0.6, 0.5, -1], frame: ['x', 1, 1], frame_inactive: [-1, -1, -1] },
    properties: { ntp_background_alignment: 'bottom right', ntp_background_repeat: 'no-repeat' },
    images: {
      theme_ntp_background: 'images/ntp.png',
      theme_frame: { '100_percent': 'images/frame.png', '200_percent': 'images/frame@2x.png' },
      theme_tab_background: '../../../etc/never-read.png',
    },
  },
};
const themeZip = (manifest = THEME, extra = {}) => makeZip({
  'manifest.json': JSON.stringify(manifest),
  '_locales/en/messages.json': JSON.stringify({ name: { message: 'Blue Hour' } }),
  'images/ntp.png': png(40, 24, [10, 30, 70]),
  'images/frame.png': png(4, 4),
  'images/frame@2x.png': png(8, 8),
  'icon.png': png(2, 2),
  'Cached Theme.pak': Buffer.from([1, 2, 3]),
  ...extra,
});
const read = (zip) => ctm.readTheme(zip, { AdmZip, validateZip });
const codeOf = (fn) => { try { fn(); } catch (err) { return err.code || err.message; } return 'no error'; };

describe('reading a Chrome theme', () => {
  it('takes its name, colours, tints, placement and pictures, and nothing else', () => {
    const t = read(themeZip());
    expect(t.name).toBe('Blue Hour');
    expect(t.version).toBe('3');
    expect(t.colors.frame).toEqual([20, 40, 90, 1]);
    expect(t.colors.toolbar).toEqual([30, 55, 110, 1]);
    expect(t.colors.button_background).toEqual([0, 0, 0, 0]);
    // Out of range is clamped and rounded; a word is not a colour; a key Vex does not read is not kept.
    expect(t.colors.bookmark_text).toEqual([255, 0, 11, 1]);
    expect(t.colors).not.toHaveProperty('ntp_text');
    expect(t.colors).not.toHaveProperty('made_up_key');
    expect(t.tints).toEqual({ buttons: [0.6, 0.5, -1] });
    expect(t.properties).toEqual({ alignment: 'bottom right', repeat: 'no-repeat' });
    expect(Object.keys(t.images).sort()).toEqual(['frame', 'ntp_background']);
    expect(t.images.ntp_background).toMatchObject({ width: 40, height: 24 });
    expect(t.images.ntp_background.dataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    // The biggest scale of the frame picture.
    expect(t.images.frame).toMatchObject({ width: 8, height: 8 });
  });
  it('never hands on a string from the package that could be CSS', () => {
    const hostile = JSON.parse(JSON.stringify(THEME));
    hostile.theme.properties = { ntp_background_alignment: 'top;background:url(javascript:alert(1))', ntp_background_repeat: 'repeat; color: red' };
    hostile.theme.colors.frame = ['red', 0, 0];
    const t = read(themeZip(hostile));
    // Not even the "top" glued to the rest is taken: the whole value is dropped.
    expect(t.properties).toEqual({ alignment: 'center', repeat: 'no-repeat' });
    expect(t.colors).not.toHaveProperty('frame');
    const strings = [];
    const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk({ colors: t.colors, tints: t.tints, properties: t.properties });
    expect(strings.every(s => /^(top|bottom|left|right|center)( (top|bottom|left|right|center))?$|^(no-repeat|repeat|repeat-x|repeat-y)$/.test(s))).toBe(true);
  });
  it('a name in __MSG__ with no message is not shown as a token', () => {
    const m = { ...THEME, name: '__MSG_missing__' };
    expect(read(themeZip(m)).name).toBe('Chrome theme');
  });
});

describe('a theme package that is more than a theme is refused', () => {
  it('a background script in the manifest: refused as a theme, offered as an extension', () => {
    const m = { ...THEME, background: { scripts: ['bg.js'] } };
    let err;
    try { read(themeZip(m, { 'bg.js': 'fetch("https://evil.example")' })); } catch (e) { err = e; }
    expect(err.code).toBe('theme-code');
    expect(err.asExtension).toBe(true);
    expect(err.message).toMatch(/also carries code \(background\)/);
    // So the extension path does not refuse it.
    expect(ws.refusal(m)).toBeNull();
  });
  it('content scripts, permissions or a page override are code too', () => {
    for (const extra of [{ content_scripts: [{ matches: ['<all_urls>'], js: ['a.js'] }] }, { permissions: ['tabs'] }, { chrome_url_overrides: { newtab: 'n.html' } }]) {
      expect(codeOf(() => read(themeZip({ ...THEME, ...extra })))).toBe('theme-code');
    }
  });
  it('a script file hidden in a theme with a clean manifest: refused, and not an extension either', () => {
    let err;
    try { read(themeZip(THEME, { 'images/x.js': 'alert(1)' })); } catch (e) { err = e; }
    expect(err.code).toBe('theme-code');
    expect(err.asExtension).toBe(false);
    expect(ws.refusal(THEME)).toMatch(/Chrome theme, not an extension/);
  });
  it('themePreview says why instead of throwing', () => {
    const p = ctm.themePreview(themeZip({ ...THEME, background: { service_worker: 'sw.js' } }), { AdmZip, validateZip });
    expect(p).toEqual({ themeRefused: expect.stringMatching(/code/), asExtension: true });
  });
});

describe('a theme\'s pictures are checked', () => {
  const withNtp = (data, name = 'images/ntp.png') => themeZip(THEME, { [name]: data });
  it('a picture that is not a PNG, JPEG or WebP is refused (SVG, GIF, text)', () => {
    expect(codeOf(() => read(withNtp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))))).toBe('theme-bad');
    expect(codeOf(() => read(withNtp(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]))))).toBe('theme-bad');
    expect(() => read(withNtp(Buffer.from('just text, not a picture')))).toThrow(/not a PNG, JPEG or WebP/);
  });
  it('a PNG whose header is cut short is refused', () => {
    expect(() => read(withNtp(png(4, 4).subarray(0, 18)))).toThrow(/damaged/);
  });
  it('a picture claiming to be enormous is refused before it is drawn', () => {
    expect(() => read(withNtp(pngHeader(20000, 10)))).toThrow(/too large \(20000 × 10\)/);
    expect(() => read(withNtp(pngHeader(9000, 9000)))).toThrow(/too large/);
  });
  it('a picture over the byte limit is refused from the size the archive declares', () => {
    const big = Buffer.concat([png(2, 2), crypto.randomBytes(ctm.IMAGE_MAX_BYTES + 10)]);
    expect(() => read(withNtp(big))).toThrow(/too big \(16 MB/);
  });
  it('a picture that is a zip bomb is refused by the archive check before anything is unpacked', () => {
    const bomb = Buffer.concat([png(2, 2), Buffer.alloc(20 * 1024 * 1024)]);
    expect(() => read(withNtp(bomb))).toThrow(/Archive expansion limit exceeded/);
  });
  it('a picture outside the package, or missing from it, is refused', () => {
    const out = JSON.parse(JSON.stringify(THEME));
    out.theme.images.theme_ntp_background = '../ntp.png';
    expect(() => read(themeZip(out))).toThrow(/outside its own package/);
    out.theme.images.theme_ntp_background = 'C:/Windows/win.ini';
    expect(codeOf(() => read(themeZip(out)))).toBe('theme-bad');
    out.theme.images.theme_ntp_background = 'images/nope.png';
    expect(() => read(themeZip(out))).toThrow(/missing from its package/);
  });
  it('reads the size of JPEG and WebP pictures from their headers', () => {
    // JPEG: SOI, an APP0 segment, then SOF0 with height 300 and width 500.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ctm.sniffImage(jpeg)).toBe('image/jpeg');
    expect(ctm.imageSize(jpeg, 'image/jpeg')).toEqual({ width: 500, height: 300 });
    const vp8x = Buffer.alloc(30);
    vp8x.write('RIFF', 0, 'latin1'); vp8x.write('WEBPVP8X', 8, 'latin1');
    vp8x.writeUIntLE(1919, 24, 3); vp8x.writeUIntLE(1079, 27, 3);
    expect(ctm.sniffImage(vp8x)).toBe('image/webp');
    expect(ctm.imageSize(vp8x, 'image/webp')).toEqual({ width: 1920, height: 1080 });
    const vp8l = Buffer.alloc(30);
    vp8l.write('RIFF', 0, 'latin1'); vp8l.write('WEBPVP8L', 8, 'latin1');
    vp8l.writeUInt32LE((99 & 0x3fff) | ((49 & 0x3fff) << 14), 21);
    expect(ctm.imageSize(vp8l, 'image/webp')).toEqual({ width: 100, height: 50 });
  });
});

describe('from the Web Store: the same signatures, then read as a theme', () => {
  const make = (body) => {
    const fetch = async () => ({ ok: true, status: 200, url: 'https://clients2.googleusercontent.com/crx/x.crx', arrayBuffer: async () => body });
    return ws.createWebStoreInstaller({ fetch, chromeVersion: '148.0', AdmZip, validateZip, publisherKeySha256: STORE_HASH });
  };
  it('a store theme is previewed as a theme, read from the verified package, and never installed as an extension', async () => {
    const installer = make(makeCrx(themeZip()));
    const p = await installer.preview(DEV_ID);
    expect(p).toMatchObject({ id: DEV_ID, isTheme: true, name: 'Blue Hour', refuse: expect.stringMatching(/theme/) });
    const t = await installer.theme(DEV_ID);
    expect(t.theme.name).toBe('Blue Hour');
    await expect(installer.take(DEV_ID)).rejects.toMatchObject({ code: 'incompatible' });
  });
  it('a theme without the store\'s signature is refused before anything is read', async () => {
    const installer = make(makeCrx(themeZip(), [developer]));
    await expect(installer.preview(DEV_ID)).rejects.toThrow(/not signed by the Chrome Web Store/);
    await expect(installer.theme(DEV_ID)).rejects.toMatchObject({ code: 'bad-signature' });
  });
  it('a changed byte in a theme package is refused', async () => {
    const crx = makeCrx(themeZip());
    crx[crx.length - 30] ^= 0xff;
    await expect(make(crx).theme(DEV_ID)).rejects.toMatchObject({ code: 'bad-signature' });
  });
  it('an extension is not a theme', async () => {
    const installer = make(makeCrx(makeZip({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1' }) })));
    expect((await installer.preview(DEV_ID)).isTheme).toBe(false);
    await expect(installer.theme(DEV_ID)).rejects.toMatchObject({ code: 'not-theme' });
  });
  it('a theme .crx picked from disk goes through the developer and store checks too', () => {
    const crx = ws.inspectLocalCrx(makeCrx(themeZip()), { AdmZip, validateZip, publisherKeySha256: STORE_HASH });
    expect(crx).toMatchObject({ fromWebStore: true, info: { isTheme: true } });
    // Claims the store (update_url) but the store did not sign it.
    expect(() => ws.inspectLocalCrx(makeCrx(themeZip(), [developer]), { AdmZip, validateZip, publisherKeySha256: STORE_HASH })).toThrow(/Chrome Web Store did not sign it/);
  });
});
