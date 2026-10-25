// Small helpers over the browser's XML parser, used by every format reader. Names are matched by their LOCAL name, because
// the prefix a file picked (w:, a:, text:) is the file's own choice.

export const NS = Object.freeze({
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  dc: 'http://purl.org/dc/elements/1.1/',
});

// text -> Document. Throws an Error with code 'corrupt' when the XML does not parse.
export function parseXml(text, what) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const bad = doc.getElementsByTagName('parsererror')[0];
  if (bad || !doc.documentElement) throw Object.assign(new Error((what || 'A part of this file') + ' is damaged and could not be read'), { code: 'corrupt' });
  return doc;
}

export const local = (node) => (node && node.localName) || '';
export const isEl = (node) => !!node && node.nodeType === 1;

// The element children with this local name (or all, with no name).
export function kids(el, name) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (!name || n.localName === name) out.push(n);
  return out;
}
export function kid(el, name) {
  if (!el) return null;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (!name || n.localName === name) return n;
  return null;
}
// All descendants with this local name.
export function all(el, name) {
  return el ? Array.from(el.getElementsByTagNameNS('*', name)) : [];
}
// An attribute by its local name, whatever the prefix.
export function attr(el, name) {
  if (!el) return null;
  const direct = el.getAttribute(name);
  if (direct != null) return direct;
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}

// Relationship part -> { id: { type, target, external } } , targets resolved against the part's folder.
export function parseRels(text, baseDir) {
  const out = {};
  if (!text) return out;
  const doc = parseXml(text, 'A relationships part');
  for (const r of all(doc, 'Relationship')) {
    const id = r.getAttribute('Id');
    const target = r.getAttribute('Target') || '';
    const external = r.getAttribute('TargetMode') === 'External';
    out[id] = { id, type: (r.getAttribute('Type') || '').split('/').pop(), target: external ? target : resolvePath(baseDir, target), external, raw: target };
  }
  return out;
}

// "word/" + "../media/a.png" -> "media/a.png" ; "/x/y" -> "x/y"
export function resolvePath(baseDir, target) {
  let t = String(target || '');
  if (t.startsWith('/')) t = t.slice(1);
  else t = (baseDir || '') + t;
  const parts = [];
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
export const dirOf = (path) => { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); };

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' };
export function imageMime(path) { return MIME[String(path).split('.').pop().toLowerCase()] || null; }
// Formats a page cannot draw (and the viewer says so instead of showing a broken picture).
export const isUndrawable = (path) => /\.(emf|wmf|emz|wmz|pict|wdp|jxr)$/i.test(path);

// Only addresses that are safe to follow are kept as links.
export function safeHref(href) {
  const h = String(href || '').trim();
  if (/^(https?:\/\/|mailto:)/i.test(h)) return h;
  return null;
}

export const EMU_PER_PX = 9525;
export const twipsToPx = (n) => (Number(n) || 0) / 15;
export const luminanceOf = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
export const readableOn = (hex) => (luminanceOf(hex) > 0.4 ? '#111318' : '#ffffff');
