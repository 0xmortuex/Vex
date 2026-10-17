// === A Unicode font for the PDF toolkit (T3-117: Turkish letters) =============
//
// The standard PDF fonts (Helvetica ...) are WinAnsi: they cannot draw the
// Turkish s-cedilla, g-breve, dotless i and capital I with a dot. pdf-lib can
// embed a real TrueType font through @pdf-lib/fontkit (a declared dependency),
// so text typed into a form field or onto a page keeps its letters.
//
// The font is a SYSTEM font read here in main from a fixed list of file names in
// the operating system's font folder: no path ever comes from a window, nothing
// is bundled (so there is no font licence to ship) and nothing is downloaded.
// The font is embedded as a SUBSET, so only the letters that were used travel in
// the new file. If no font from the list exists, drawing such text throws a plain
// sentence; it never falls back to dropping or replacing letters silently.

const nodeFs = require('fs');
const nodePath = require('path');

const WINDOWS_FILES = Object.freeze(['segoeui.ttf', 'arial.ttf', 'calibri.ttf', 'tahoma.ttf', 'verdana.ttf']);
const MAC_FILES = Object.freeze(['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf']);
const LINUX_FILES = Object.freeze(['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf']);
const MAX_FONT_BYTES = 40 * 1024 * 1024;

// The WinAnsi (Windows-1252) letters the standard fonts can draw.
const WINANSI_EXTRA = Object.freeze([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178]);

function winAnsiCan(codePoint) {
  return codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint >= 32 && codePoint <= 126) || (codePoint >= 160 && codePoint <= 255) || WINANSI_EXTRA.includes(codePoint);
}

// Letters the standard PDF font cannot draw, each once.
function standardMissing(text) {
  const bad = new Set();
  for (const ch of String(text)) if (!winAnsiCan(ch.codePointAt(0))) bad.add(ch);
  return [...bad];
}

function candidatePaths({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const dir = nodePath.join(env.WINDIR || env.SystemRoot || 'C:\\Windows', 'Fonts');
    return WINDOWS_FILES.map(f => nodePath.join(dir, f));
  }
  if (platform === 'darwin') return MAC_FILES.slice();
  return LINUX_FILES.slice();
}

// -> { path, bytes } of the first system font that exists. Throws a plain sentence when none does.
function readSystemFont({ fsImpl = nodeFs, platform, env } = {}) {
  const paths = candidatePaths({ platform, env });
  for (const p of paths) {
    if (!fsImpl.existsSync(p)) continue;
    const bytes = fsImpl.readFileSync(p);
    if (!bytes.length || bytes.length > MAX_FONT_BYTES) throw new Error('The system font ' + nodePath.basename(p) + ' has an unusable size');
    return { path: p, bytes };
  }
  throw new Error('No system font that can draw these letters was found (looked for ' + paths.map(p => nodePath.basename(p)).join(', ') + ')');
}

// Embeds the font as a subset. doc: a pdf-lib PDFDocument. -> the PDFFont.
async function embedUnicode(doc, fontBytes) {
  if (!doc || typeof doc.registerFontkit !== 'function' || typeof doc.embedFont !== 'function') throw new Error('embedUnicode needs a pdf-lib document');
  if (!fontBytes || !fontBytes.length) throw new Error('embedUnicode needs the bytes of a font');
  doc.registerFontkit(require('@pdf-lib/fontkit'));
  return doc.embedFont(fontBytes, { subset: true });
}

// Letters a PDFFont (any kind) cannot draw, each once.
function fontMissing(font, text) {
  const set = new Set(font.getCharacterSet());
  const bad = new Set();
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13 || c === 9) continue;
    if (!set.has(c)) bad.add(ch);
  }
  return [...bad];
}

// The font to draw these texts with: the standard Helvetica when every letter is WinAnsi (nothing is embedded, the
// file stays small), else the embedded system font. Throws when the embedded font lacks a letter too.
async function fontFor(doc, texts, { fsImpl, platform, env, what } = {}) {
  const { StandardFonts } = require('pdf-lib');
  const all = (Array.isArray(texts) ? texts : [texts]).map(String).join('\n');
  if (!standardMissing(all).length) return { font: await doc.embedFont(StandardFonts.Helvetica), unicode: false };
  const sys = readSystemFont({ fsImpl, platform, env });
  const font = await embedUnicode(doc, sys.bytes);
  const bad = fontMissing(font, all);
  if (bad.length) throw new Error((what || 'The text') + ' has letters the font ' + nodePath.basename(sys.path) + ' cannot draw (' + bad.slice(0, 8).join(' ') + ')');
  return { font, unicode: true, fontFile: nodePath.basename(sys.path) };
}

module.exports = { fontFor, embedUnicode, readSystemFont, candidatePaths, standardMissing, fontMissing, winAnsiCan, MAX_FONT_BYTES };
