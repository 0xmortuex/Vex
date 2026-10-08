// === A Chrome theme, read as a theme and nothing else ========================
// A Chrome Web Store theme is a CRX package whose manifest has a "theme" key:
// colours ([r, g, b] or [r, g, b, alpha]), tints ([hue, saturation,
// lightness], -1 = leave alone), a few properties and pictures. Vex turns it
// into one of the user's own themes (src/renderer/js/chrome-theme.js does the
// colours, js/theme-custom.js the rest); it is never loaded as an extension.
//
// This file runs on the archive AFTER its signatures were checked
// (webstore.js verifyCrx3 / verifyLocalCrx). It reads:
//   * manifest.json (and the _locales messages for the name);
//   * the pictures the theme names for the New Tab, the frame and the toolbar,
//     each one sniffed (PNG, JPEG or WebP only), its size read from its own
//     header, and capped in bytes and in pixels.
// Nothing else in the package is opened. A package that also carries code
// (manifest keys a theme does not have, or script/page files) is refused as a
// theme; one whose manifest makes it an extension too can be installed as an
// extension through the normal path instead.
// Every value handed on is a number or one of a few fixed words: no string
// from the package ever reaches CSS.
const { WebStoreError, readPackage } = require('./webstore');

// Manifest keys a theme may have. Anything else makes it more than a theme.
const THEME_MANIFEST_KEYS = new Set([
  'manifest_version', 'name', 'short_name', 'version', 'version_name', 'description', 'theme', 'icons',
  'default_locale', 'key', 'update_url', 'minimum_chrome_version', 'author', 'homepage_url',
  'current_locale', 'differential_fingerprint',
]);
// Files that are code wherever they sit in a package.
const CODE_FILE_RE = /\.(?:js|mjs|cjs|html?|xhtml|wasm)$/i;

// The colours Vex reads. Others in the manifest are left unread.
const COLOR_KEYS = [
  'frame', 'toolbar', 'tab_text', 'tab_background_text', 'bookmark_text', 'toolbar_text', 'toolbar_button_icon',
  'ntp_background', 'ntp_text', 'ntp_link', 'ntp_header', 'button_background', 'omnibox_background', 'omnibox_text',
];
const TINT_KEYS = ['buttons', 'frame'];
// The pictures Vex uses: the New Tab one, and the frame and toolbar ones
// whose colour stands in for the frame and toolbar colours they cover.
const IMAGE_KEYS = ['theme_ntp_background', 'theme_frame', 'theme_toolbar'];

const IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const IMAGES_MAX_BYTES = 40 * 1024 * 1024;
const IMAGE_MAX_SIDE = 16000;
const IMAGE_MAX_PIXELS = 50 * 1000 * 1000;

const ALIGN_WORDS = new Set(['top', 'bottom', 'left', 'right', 'center']);
const REPEATS = new Set(['no-repeat', 'repeat', 'repeat-x', 'repeat-y']);

function isTheme(manifest) {
  return !!(manifest && manifest.theme && typeof manifest.theme === 'object' && !Array.isArray(manifest.theme));
}

// What makes this package more than a theme: { keys, files }.
function codeIn(manifest, entryNames) {
  const keys = Object.keys(manifest || {}).filter(k => !THEME_MANIFEST_KEYS.has(k));
  const files = (entryNames || []).filter(n => CODE_FILE_RE.test(n));
  return { keys, files };
}

// [r, g, b] or [r, g, b, a] -> [r, g, b, a] with r g b whole numbers 0..255 and
// a 0..1; null for anything else.
function cleanColor(v) {
  if (!Array.isArray(v) || (v.length !== 3 && v.length !== 4)) return null;
  if (!v.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  const rgb = v.slice(0, 3).map(n => Math.max(0, Math.min(255, Math.round(n))));
  const a = v.length === 4 ? Math.max(0, Math.min(1, v[3])) : 1;
  return [...rgb, a];
}

// [h, s, l] each -1 (leave alone) or 0..1 -> the same, else null.
function cleanTint(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  return v.map(n => (n < 0 ? -1 : Math.min(1, n)));
}

function cleanProperties(p) {
  const out = { alignment: 'center', repeat: 'no-repeat' };
  if (!p || typeof p !== 'object') return out;
  if (typeof p.ntp_background_alignment === 'string') {
    const words = p.ntp_background_alignment.toLowerCase().trim().split(/\s+/).filter(w => ALIGN_WORDS.has(w));
    if (words.length) out.alignment = [...new Set(words)].slice(0, 2).join(' ');
  }
  if (typeof p.ntp_background_repeat === 'string' && REPEATS.has(p.ntp_background_repeat.toLowerCase().trim())) {
    out.repeat = p.ntp_background_repeat.toLowerCase().trim();
  }
  return out;
}

// A picture's path in the manifest: a string, or { "100_percent": path,
// "200_percent": path } (the biggest is taken). -> a clean archive path, or
// throws when it tries to leave the package.
function imagePath(value) {
  let p = value;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const scales = Object.entries(p).filter(([k, v]) => /^\d{2,3}_percent$/.test(k) && typeof v === 'string')
      .sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10));
    p = scales.length ? scales[0][1] : null;
  }
  if (typeof p !== 'string' || !p) return null;
  const clean = p.replace(/^\.\//, '');
  if (clean.length > 260 || /(^|\/)\.\.(\/|$)|^\/|\\|:|[\u0000-\u001f]/.test(clean)) {
    throw new WebStoreError('theme-bad', 'The theme names a picture outside its own package. Nothing was added.');
  }
  return clean;
}

// The first bytes -> 'image/png' | 'image/jpeg' | 'image/webp' | null.
function sniffImage(b) {
  if (!b || b.length < 16) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// A picture's width and height from its own header, or null when the header
// cannot be read.
function imageSize(b, type) {
  try {
    if (type === 'image/png') {
      if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        if (m === 0xd9 || m === 0xda) return null;
        const len = b.readUInt16BE(i + 2);
        if (len < 2) return null;
        if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
          return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (type === 'image/webp') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L' && b.length >= 25) {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X' && b.length >= 30) return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
      return null;
    }
  } catch { return null; }
  return null;
}

// One picture's bytes -> { dataUrl, width, height }, or throws saying why.
function checkImage(buf, what) {
  if (buf.length > IMAGE_MAX_BYTES) throw new WebStoreError('theme-bad', `The theme's ${what} picture is too big (${Math.round(buf.length / 1048576)} MB; ${IMAGE_MAX_BYTES / 1048576} MB at most). Nothing was added.`);
  const type = sniffImage(buf);
  if (!type) throw new WebStoreError('theme-bad', `The theme's ${what} picture is not a PNG, JPEG or WebP picture. Nothing was added.`);
  const size = imageSize(buf, type);
  if (!size || !size.width || !size.height) throw new WebStoreError('theme-bad', `The theme's ${what} picture is damaged: its size cannot be read. Nothing was added.`);
  if (size.width > IMAGE_MAX_SIDE || size.height > IMAGE_MAX_SIDE || size.width * size.height > IMAGE_MAX_PIXELS) {
    throw new WebStoreError('theme-bad', `The theme's ${what} picture is too large (${size.width} × ${size.height}). Nothing was added.`);
  }
  return { dataUrl: `data:${type};base64,${buf.toString('base64')}`, width: size.width, height: size.height };
}

const IMAGE_WORDS = { theme_ntp_background: 'New Tab', theme_frame: 'frame', theme_toolbar: 'toolbar' };

// A verified archive -> what the window needs to make the theme:
// { name, version, description, colors, tints, properties, images }.
// Throws WebStoreError: 'not-theme', 'theme-code' (with .asExtension when its
// manifest makes it an extension too), 'theme-bad'.
function readTheme(archive, { AdmZip, validateZip }) {
  const pkg = readPackage(archive, { AdmZip, validateZip });
  const m = pkg.manifest;
  if (!isTheme(m)) throw new WebStoreError('not-theme', 'This package is not a Chrome theme.');
  const entries = validateZip(new AdmZip(archive));
  const names = entries.filter(e => !e.isDirectory).map(e => e.entryName);
  const code = codeIn(m, names);
  if (code.keys.length || code.files.length) {
    const what = code.keys.length ? code.keys.slice(0, 4).join(', ') : code.files.slice(0, 3).join(', ');
    const err = new WebStoreError('theme-code', `This theme also carries code (${what}). Vex adds a theme only as its colours and pictures, so it was not added as a theme.`);
    // Its manifest makes it an extension as well: that path can show what it does.
    err.asExtension = code.keys.length > 0;
    throw err;
  }
  const t = m.theme;
  const colors = {};
  if (t.colors && typeof t.colors === 'object') {
    for (const k of COLOR_KEYS) {
      const c = cleanColor(t.colors[k]);
      if (c) colors[k] = c;
    }
  }
  const tints = {};
  if (t.tints && typeof t.tints === 'object') {
    for (const k of TINT_KEYS) {
      const c = cleanTint(t.tints[k]);
      if (c) tints[k] = c;
    }
  }
  const images = {};
  let total = 0;
  if (t.images && typeof t.images === 'object') {
    for (const k of IMAGE_KEYS) {
      if (!(k in t.images)) continue;
      const p = imagePath(t.images[k]);
      if (!p) continue;
      const entry = entries.find(e => !e.isDirectory && e.entryName === p);
      if (!entry) throw new WebStoreError('theme-bad', `The theme's ${IMAGE_WORDS[k]} picture (${p.slice(0, 80)}) is missing from its package. Nothing was added.`);
      // The size the archive declares, before anything is unpacked.
      if (entry.header.size > IMAGE_MAX_BYTES) throw new WebStoreError('theme-bad', `The theme's ${IMAGE_WORDS[k]} picture is too big (${Math.round(entry.header.size / 1048576)} MB; ${IMAGE_MAX_BYTES / 1048576} MB at most). Nothing was added.`);
      total += entry.header.size;
      if (total > IMAGES_MAX_BYTES) throw new WebStoreError('theme-bad', `The theme's pictures are too big together (more than ${IMAGES_MAX_BYTES / 1048576} MB). Nothing was added.`);
      images[k.replace(/^theme_/, '')] = checkImage(entry.getData(), IMAGE_WORDS[k]);
    }
  }
  const localize = (v) => (typeof v === 'string' ? v.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (tok, key) => (Object.prototype.hasOwnProperty.call(pkg.messages, key) ? pkg.messages[key] : tok)) : '');
  const name = localize(m.name).replace(/[\u0000-\u001f\u007f]/g, '').replace(/__MSG_[A-Za-z0-9_@]+__/g, '').trim() || 'Chrome theme';
  return {
    name: name.slice(0, 200),
    version: typeof m.version === 'string' ? m.version.slice(0, 40) : '',
    description: localize(m.description).slice(0, 300),
    colors, tints, properties: cleanProperties(t.properties), images,
  };
}

// What a preview carries for a theme: { theme } when it can be added, or
// { themeRefused, asExtension } when it cannot. Other errors are thrown.
function themePreview(archive, deps) {
  try {
    return { theme: readTheme(archive, deps) };
  } catch (err) {
    if (err && (err.code === 'theme-code' || err.code === 'theme-bad')) return { themeRefused: err.message, asExtension: !!err.asExtension };
    throw err;
  }
}

module.exports = {
  THEME_MANIFEST_KEYS, COLOR_KEYS, TINT_KEYS, IMAGE_KEYS,
  IMAGE_MAX_BYTES, IMAGES_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_MAX_PIXELS,
  isTheme, codeIn, cleanColor, cleanTint, cleanProperties, imagePath, sniffImage, imageSize, checkImage,
  readTheme, themePreview,
};
