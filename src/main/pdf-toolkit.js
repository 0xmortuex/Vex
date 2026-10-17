// === Built-in PDF toolkit: merge, split, extract, rotate, reorder ==============
//
// Everything runs on this computer, in the main process, with pdf-lib (a pure
// JavaScript library; no network, no native code, no shell). The window never
// names a file path: it asks main to open a file picker, gets back an opaque
// token for each PDF the person chose, and later says "merge these tokens".
// The result is written where the person picks in a Save dialog (or into a
// folder they pick, for a split). An input file is never overwritten or
// changed: a Save that points at one of the inputs is refused.
//
// Also here (T3-117): annotate (text, highlight, box), fill form fields, place a SIGNATURE IMAGE, and a light
// compress. "Sign" means putting the picture of a drawn or typed signature on a page, like a stamp; it is NOT a
// cryptographic digital signature and proves nothing about who placed it. "Compress" repacks the file's structure
// (object streams, unused objects dropped, metadata cleared); pictures inside are NOT re-encoded, so a scan
// stays about as large. The standard PDF font cannot draw every letter (Turkish s-cedilla, g-breve and dotless i
// are missing from it); text with such letters is refused unless the person asked for them to be replaced.
//
// What it does not do (listed in the Settings group too): OCR, or open a password-protected PDF. A PDF with a
// password is refused with a plain sentence; Vex does not try to remove it.
//
// The page-range language is the one people already use for printing:
//   1-3, 5, 8-      pages 1 to 3, page 5, page 8 to the end
//   -4              pages 1 to 4
//   all  odd  even  reverse
// A range written backwards (5-3) keeps the pages in that order.
//
// The operations are pure over bytes (merge, extract, split, rotate) so they are
// tested with real PDFs made in the test; registerPdfToolkit is the thin
// Electron layer (dialogs and files).

const nodeFs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');

// totalBytes: all the files of one run together. pdf-lib parses on the main event loop, so 20 files of 60 MB would freeze Vex.
const LIMITS = Object.freeze({ fileBytes: 60 * 1024 * 1024, totalBytes: 200 * 1024 * 1024, files: 20, pages: 4000, tokens: 100 });

function lib() { return require('pdf-lib'); }

// "1-3, 5, 8-" -> zero-based page indices (in the order written). Throws a plain sentence.
function parsePageSpec(spec, total, { repeat = true } = {}) {
  const text = String(spec == null ? '' : spec).trim().toLowerCase();
  if (!Number.isInteger(total) || total < 1) throw new Error('That PDF has no pages');
  if (!text) throw new Error('Say which pages: for example 1-3, 5, 8-');
  const all = Array.from({ length: total }, (_, i) => i);
  if (text === 'all') return all;
  if (text === 'odd') return all.filter(i => i % 2 === 0);
  if (text === 'even') return all.filter(i => i % 2 === 1);
  if (text === 'reverse') return all.slice().reverse();
  const out = [];
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) throw new Error('There is an empty piece in the page list "' + spec + '"');
    const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) throw new Error('"' + part + '" is not a page or a page range');
    let from, to;
    if (!m[2]) { from = to = Number(m[1]); }
    else { from = m[1] ? Number(m[1]) : 1; to = m[3] ? Number(m[3]) : total; }
    if (from < 1 || to < 1 || from > total || to > total) throw new Error('Page "' + part + '" is outside this PDF, which has ' + total + ' page' + (total === 1 ? '' : 's'));
    if (from <= to) for (let p = from; p <= to; p++) out.push(p - 1);
    else for (let p = from; p >= to; p--) out.push(p - 1);
  }
  if (!repeat && new Set(out).size !== out.length) throw new Error('A page is listed twice');
  return out;
}

async function load(bytes, name) {
  const { PDFDocument } = lib();
  if (!bytes || !bytes.length) throw new Error((name || 'That file') + ' is empty');
  if (bytes.length > LIMITS.fileBytes) throw new Error((name || 'That file') + ' is larger than ' + Math.round(LIMITS.fileBytes / 1048576) + ' MB');
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (head.indexOf('%PDF-') < 0) throw new Error((name || 'That file') + ' is not a PDF');
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err && /encrypted/i.test(String(err.message))) throw new Error((name || 'That PDF') + ' is protected by a password. Remove the password in the program that made it, then try again', { cause: err });
    throw new Error((name || 'That PDF') + ' could not be read: ' + (err && err.message ? err.message : err), { cause: err });
  }
}

async function save(doc) {
  doc.setProducer('Vex PDF toolkit');
  doc.setCreator('Vex');
  return Buffer.from(await doc.save());
}

async function pageCount(bytes, name) { return (await load(bytes, name)).getPageCount(); }

// inputs: [{ bytes, name, spec? }]  (spec picks pages of that input; default all)
async function merge(inputs) {
  const { PDFDocument } = lib();
  if (!Array.isArray(inputs) || inputs.length < 2) throw new Error('Choose at least two PDFs to merge');
  if (inputs.length > LIMITS.files) throw new Error('At most ' + LIMITS.files + ' PDFs can be merged at once');
  const out = await PDFDocument.create();
  let pages = 0;
  for (const input of inputs) {
    const doc = await load(input.bytes, input.name);
    const idx = input.spec ? parsePageSpec(input.spec, doc.getPageCount()) : doc.getPageIndices();
    pages += idx.length;
    if (pages > LIMITS.pages) throw new Error('That is more than ' + LIMITS.pages + ' pages in one PDF');
    for (const p of await out.copyPages(doc, idx)) out.addPage(p);
  }
  return { bytes: await save(out), pages };
}

// Keep these pages, in this order (also deletes the rest, and reorders).
async function extract(bytes, spec, name) {
  const { PDFDocument } = lib();
  const doc = await load(bytes, name);
  const idx = parsePageSpec(spec, doc.getPageCount());
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(doc, idx)) out.addPage(p);
  return { bytes: await save(out), pages: idx.length };
}

// mode: 'each' | 'every' (n) | 'ranges' (spec "1-3;4-6;7-") -> [{ bytes, pages, label }]
async function split(bytes, { mode, n, spec } = {}, name) {
  const { PDFDocument } = lib();
  const doc = await load(bytes, name);
  const total = doc.getPageCount();
  let groups;
  if (mode === 'each') groups = Array.from({ length: total }, (_, i) => [i]);
  else if (mode === 'every') {
    const size = Number(n);
    if (!Number.isInteger(size) || size < 1) throw new Error('Say how many pages go in each part (1 or more)');
    groups = [];
    for (let i = 0; i < total; i += size) groups.push(Array.from({ length: Math.min(size, total - i) }, (_, k) => i + k));
  } else if (mode === 'ranges') {
    const parts = String(spec == null ? '' : spec).split(';').map(s => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Write the parts separated by semicolons, for example 1-3; 4-6; 7-');
    groups = parts.map(p => parsePageSpec(p, total));
  } else throw new Error('Split by each page, every N pages or page ranges');
  if (groups.length > 200) throw new Error('That would make ' + groups.length + ' files; split in fewer parts');
  if (groups.length < 2) throw new Error('That would make one file with the same pages; pick a smaller part size');
  const out = [];
  for (const g of groups) {
    const part = await PDFDocument.create();
    for (const p of await part.copyPages(doc, g)) part.addPage(p);
    out.push({ bytes: await save(part), pages: g.length, label: g.length === 1 ? 'p' + (g[0] + 1) : 'p' + (g[0] + 1) + '-' + (g[g.length - 1] + 1) });
  }
  return out;
}

// Turn the chosen pages clockwise by 90, 180 or 270 degrees, added to what they already have.
async function rotate(bytes, { spec, degrees } = {}, name) {
  const { degrees: deg } = lib();
  if (![90, 180, 270].includes(degrees)) throw new Error('Rotate by 90, 180 or 270 degrees');
  const doc = await load(bytes, name);
  const idx = parsePageSpec(spec || 'all', doc.getPageCount(), { repeat: false });
  const pages = doc.getPages();
  for (const i of idx) pages[i].setRotation(deg((((pages[i].getRotation().angle + degrees) % 360) + 360) % 360));
  return { bytes: await save(doc), pages: idx.length };
}

// ---- inspect, annotate, fill, sign, compress (T3-117) -----------------------------------------------
const MARK = Object.freeze({ items: 100, text: 500, signatureBytes: 400 * 1024, fields: 300, fieldValue: 2000 });
const COLORS = Object.freeze({ black: [0, 0, 0], red: [0.8, 0.1, 0.1], blue: [0.1, 0.2, 0.8], green: [0.1, 0.5, 0.2], yellow: [1, 0.92, 0.2], orange: [1, 0.6, 0.1] });
const TURKISH_ASCII = Object.freeze({ '\u015F': 's', '\u015E': 'S', '\u011F': 'g', '\u011E': 'G', '\u0131': 'i', '\u0130': 'I' });

// Letters the standard PDF font (WinAnsi) cannot draw. -> the offending characters, once each.
function unsupportedChars(text) {
  const bad = new Set();
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    const ok = c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || [0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178].includes(c);
    if (!ok) bad.add(ch);
  }
  return [...bad];
}
// Replaces the Turkish letters the font lacks with their plain Latin ones; anything else it cannot draw still throws.
function drawable(text, ascii, what) {
  let t = String(text);
  if (ascii) t = t.replace(/[\u015F\u015E\u011F\u011E\u0131\u0130]/g, (c) => TURKISH_ASCII[c]);
  const bad = unsupportedChars(t);
  if (bad.length) throw new Error((what || 'The text') + ' has letters the PDF font cannot draw (' + bad.slice(0, 8).join(' ') + '). Change them' + (bad.every(c => TURKISH_ASCII[c]) ? ', or tick "Replace letters the PDF font cannot draw".' : '.'));
  return t;
}

const FIELD_TYPES = { PDFTextField: 'text', PDFCheckBox: 'checkbox', PDFDropdown: 'dropdown', PDFRadioGroup: 'radio', PDFOptionList: 'list', PDFButton: 'button', PDFSignature: 'signature' };

// Page sizes (points) and the form fields of one PDF. -> { pages: [{ w, h }], fields: [{ name, type, value, options }] }
async function inspect(bytes, name) {
  const doc = await load(bytes, name);
  const pages = doc.getPages().slice(0, 500).map(p => { const s = p.getSize(); return { w: Math.round(s.width * 10) / 10, h: Math.round(s.height * 10) / 10, rotation: p.getRotation().angle }; });
  const fields = [];
  for (const f of doc.getForm().getFields().slice(0, MARK.fields)) {
    const type = FIELD_TYPES[f.constructor.name] || 'other';
    const row = { name: f.getName(), type, value: null, options: undefined };
    try {
      if (type === 'text') row.value = f.getText() || '';
      else if (type === 'checkbox') row.value = f.isChecked();
      else if (type === 'dropdown' || type === 'list') { row.value = f.getSelected().join(', '); row.options = f.getOptions().slice(0, 100); }
      else if (type === 'radio') { row.value = f.getSelected() || ''; row.options = f.getOptions().slice(0, 100); }
    } catch (err) { throw new Error('The form field "' + row.name + '" could not be read: ' + err.message, { cause: err }); }
    fields.push(row);
  }
  return { pages, fields };
}

// values: { fieldName: string | boolean }. flatten: bake the answers in so they can no longer be edited.
async function fillForm(bytes, { values, flatten, ascii } = {}, name) {
  const { StandardFonts } = lib();
  const doc = await load(bytes, name);
  const form = doc.getForm();
  const names = Object.keys(values || {});
  if (!names.length) throw new Error('Type an answer into at least one field');
  if (names.length > MARK.fields) throw new Error('That is more than ' + MARK.fields + ' fields');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const key of names) {
    let field;
    try { field = form.getField(key); } catch { throw new Error('This PDF has no form field called "' + key + '"'); }
    const type = FIELD_TYPES[field.constructor.name] || 'other';
    const v = values[key];
    if (type === 'text') field.setText(drawable(String(v), ascii, 'The answer for "' + key + '"').slice(0, MARK.fieldValue));
    else if (type === 'checkbox') { if (v) field.check(); else field.uncheck(); }
    else if (type === 'dropdown' || type === 'radio' || type === 'list') field.select(String(v));
    else throw new Error('"' + key + '" is a ' + type + ' field; it cannot be filled here');
  }
  form.updateFieldAppearances(font);
  if (flatten) form.flatten();
  return { bytes: await save(doc), fields: names.length };
}

function checkItem(it, pageCount, i) {
  const n = i + 1;
  if (!it || typeof it !== 'object') throw new Error('Mark ' + n + ' is not valid');
  if (!['text', 'highlight', 'rect', 'signature'].includes(it.kind)) throw new Error('Mark ' + n + ' must be text, a highlight, a box or a signature');
  if (!Number.isInteger(it.page) || it.page < 1 || it.page > pageCount) throw new Error('Mark ' + n + ' is on page ' + it.page + ', but this PDF has ' + pageCount + ' page' + (pageCount === 1 ? '' : 's'));
  for (const k of ['x', 'y']) if (!(Number.isFinite(it[k]) && it[k] >= 0 && it[k] <= 1)) throw new Error('Mark ' + n + ' is placed outside the page');
  const needSize = it.kind !== 'text' || it.w != null;
  if (needSize && !(Number.isFinite(it.w) && it.w > 0 && it.w <= 1 && it.x + it.w <= 1.001)) throw new Error('Mark ' + n + ' is too wide for the page');
  if ((it.kind === 'highlight' || it.kind === 'rect') && !(Number.isFinite(it.h) && it.h > 0 && it.h <= 1 && it.y + it.h <= 1.001)) throw new Error('Mark ' + n + ' is too tall for the page');
  if (it.kind === 'text') {
    if (typeof it.text !== 'string' || !it.text.trim()) throw new Error('Mark ' + n + ' has no text');
    if (it.text.length > MARK.text) throw new Error('Mark ' + n + ' has more than ' + MARK.text + ' letters');
    if (it.size != null && !(Number.isFinite(it.size) && it.size >= 6 && it.size <= 72)) throw new Error('Mark ' + n + ': the text size is 6 to 72');
  }
  if (it.color != null && !COLORS[it.color]) throw new Error('Mark ' + n + ': pick one of ' + Object.keys(COLORS).join(', '));
}

// items: [{ kind: 'text'|'highlight'|'rect'|'signature', page (1-based), x, y, w, h (fractions of the page, from its top left), text, size, color }]
// signature: the PNG bytes of a drawn or typed signature, placed by a 'signature' item. NOT a digital signature.
async function annotate(bytes, { items, signature, ascii } = {}, name) {
  const { StandardFonts, rgb } = lib();
  const doc = await load(bytes, name);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new Error('Add at least one mark first');
  if (list.length > MARK.items) throw new Error('That is more than ' + MARK.items + ' marks');
  const pages = doc.getPages();
  list.forEach((it, i) => checkItem(it, pages.length, i));
  let image = null;
  if (list.some(it => it.kind === 'signature')) {
    if (!(signature instanceof Uint8Array) || !signature.length) throw new Error('Draw or type a signature first');
    if (signature.length > MARK.signatureBytes) throw new Error('The signature picture is larger than ' + Math.round(MARK.signatureBytes / 1024) + ' KB');
    if (!(signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4E && signature[3] === 0x47)) throw new Error('The signature has to be a PNG picture');
    image = await doc.embedPng(signature);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let signed = 0;
  list.forEach((it, i) => {
    const page = pages[it.page - 1];
    if (page.getRotation().angle % 360 !== 0) throw new Error('Page ' + it.page + ' is turned; turn it back to upright first (Rotate), then mark it');
    const box = page.getMediaBox();
    const px = box.x + it.x * box.width;
    const top = box.y + box.height - it.y * box.height;
    const color = rgb(...(COLORS[it.color || (it.kind === 'highlight' ? 'yellow' : 'black')]));
    if (it.kind === 'text') {
      const size = it.size || 12;
      const text = drawable(it.text, ascii, 'Mark ' + (i + 1));
      page.drawText(text, { x: px, y: top - size, size, font, color, lineHeight: size * 1.25, ...(it.w ? { maxWidth: it.w * box.width } : {}) });
    } else if (it.kind === 'highlight') {
      page.drawRectangle({ x: px, y: top - it.h * box.height, width: it.w * box.width, height: it.h * box.height, color, opacity: 0.35 });
    } else if (it.kind === 'rect') {
      page.drawRectangle({ x: px, y: top - it.h * box.height, width: it.w * box.width, height: it.h * box.height, borderColor: color, borderWidth: 1.5 });
    } else {
      const w = it.w * box.width;
      const h = w * (image.height / image.width);
      page.drawImage(image, { x: px, y: top - h, width: w, height: h });
      signed++;
    }
  });
  return { bytes: await save(doc), marks: list.length, signed };
}

// Repacks the structure. Pictures are not re-encoded. Refuses when nothing was gained.
async function compress(bytes, name) {
  const { PDFDocument } = lib();
  const doc = await load(bytes, name);
  const before = bytes.length;
  let out;
  if (doc.getForm().getFields().length) {
    // A form keeps working only in the original document, so repack that one in place.
    doc.setProducer('Vex PDF toolkit');
    out = Buffer.from(await doc.save({ useObjectStreams: true }));
  } else {
    const fresh = await PDFDocument.create();
    for (const p of await fresh.copyPages(doc, doc.getPageIndices())) fresh.addPage(p);
    fresh.setProducer('Vex PDF toolkit');
    fresh.setCreator('Vex');
    out = Buffer.from(await fresh.save({ useObjectStreams: true }));
  }
  if (out.length >= before) throw new Error('This PDF is already as compact as Vex can make it (' + before + ' bytes). Its size is mostly pictures, which are not re-encoded here');
  return { bytes: out, pages: doc.getPageCount(), before, after: out.length };
}

// Re-encodes the big pictures at a lower quality (and scales the oversized ones down), then repacks the file.
// codec: the picture codec (Electron nativeImage in Vex, see main/pdf-images.js). Refuses when nothing was gained.
async function shrink(bytes, { level, codec } = {}, name) {
  const { shrinkDocument } = require('./pdf-images');
  const doc = await load(bytes, name);
  const r = shrinkDocument(doc, codec, level || 'balanced');
  doc.setProducer('Vex PDF toolkit');
  const out = Buffer.from(await doc.save({ useObjectStreams: true }));
  if (out.length >= bytes.length) throw new Error('Vex could not make this PDF smaller (' + bytes.length + ' bytes; ' + r.changed + ' pictures re-encoded, ' + r.skipped + ' left as they are)');
  return { bytes: out, pages: doc.getPageCount(), before: bytes.length, after: out.length, changed: r.changed, skipped: r.skipped };
}

// ---- the Electron layer ---------------------------------------------------------
function safeBase(file) {
  const clean = Array.from(nodePath.basename(file, nodePath.extname(file))).filter(c => c.charCodeAt(0) >= 32).join('');
  return clean.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'document';
}
function samePath(a, b) { return nodePath.resolve(a).toLowerCase() === nodePath.resolve(b).toLowerCase(); }

function uniquePath(dir, base, ext, fsImpl) {
  let p = nodePath.join(dir, base + ext);
  for (let n = 2; fsImpl.existsSync(p); n++) p = nodePath.join(dir, base + ' (' + n + ')' + ext);
  return p;
}

async function writeAtomic(file, bytes, fsImpl) {
  const temp = file + '.vex-tmp';
  await fsImpl.promises.writeFile(temp, bytes);
  await fsImpl.promises.rename(temp, file);
}

function registerPdfToolkit({ ipcMain, dialog, windowFor, fsImpl = nodeFs, nativeImage } = {}) {
  if (!ipcMain || !dialog || typeof windowFor !== 'function') throw new Error('registerPdfToolkit needs ipcMain, dialog and windowFor');
  const picked = new Map();     // token -> { file, name, bytes, pages }

  const fileOf = (token) => {
    const f = picked.get(token);
    if (!f) throw new Error('That PDF is no longer in the list. Choose it again');
    return f;
  };

  ipcMain.handle('pdftool:pick-files', async (e) => {
    try {
      const win = windowFor(e);
      const opts = { title: 'Choose PDF files', buttonLabel: 'Use these', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: true, cancelled: true, files: [] };
      if (r.filePaths.length > LIMITS.files) return { ok: false, error: 'Choose at most ' + LIMITS.files + ' PDFs at a time' };
      const files = [];
      const problems = [];
      for (const file of r.filePaths) {
        const name = nodePath.basename(file);
        try {
          const st = await fsImpl.promises.stat(file);
          if (!st.isFile()) throw new Error(name + ' is not a file');
          if (st.size > LIMITS.fileBytes) throw new Error(name + ' is larger than ' + Math.round(LIMITS.fileBytes / 1048576) + ' MB');
          const pages = await pageCount(await fsImpl.promises.readFile(file), name);
          const token = crypto.randomBytes(16).toString('hex');
          picked.set(token, { file, name, bytes: st.size, pages });
          while (picked.size > LIMITS.tokens) picked.delete(picked.keys().next().value);
          files.push({ token, name, bytes: st.size, pages });
        } catch (err) { problems.push(err.message); }
      }
      return { ok: true, cancelled: false, files, problems };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('pdftool:run', async (e, req) => {
    try {
      const win = windowFor(e);
      const tokens = req.tokens;
      if (!Array.isArray(tokens) || !tokens.length) throw new Error('Choose a PDF first');
      const tooBig = () => new Error('These PDFs add up to more than ' + Math.round(LIMITS.totalBytes / 1048576) + ' MB. Choose fewer or smaller ones');
      // The sizes seen when they were chosen, checked before any file is read.
      if (tokens.reduce((sum, t) => sum + fileOf(t).bytes, 0) > LIMITS.totalBytes) throw tooBig();
      const inputs = [];
      let read = 0;
      for (const t of tokens) {
        const f = fileOf(t);
        const bytes = await fsImpl.promises.readFile(f.file);
        // A file that grew since it was chosen.
        if ((read += bytes.length) > LIMITS.totalBytes) throw tooBig();
        inputs.push({ file: f.file, name: f.name, bytes });
      }
      const first = inputs[0];
      const dir = nodePath.dirname(first.file);
      let outputs;      // [{ name, bytes, pages }]
      if (req.op === 'merge') {
        const r = await merge(inputs.map(i => ({ bytes: i.bytes, name: i.name })));
        outputs = [{ name: safeBase(first.file) + '-merged.pdf', bytes: r.bytes, pages: r.pages }];
      } else if (inputs.length !== 1) {
        throw new Error('This works on one PDF at a time');
      } else if (req.op === 'extract') {
        const r = await extract(first.bytes, req.spec, first.name);
        outputs = [{ name: safeBase(first.file) + '-pages.pdf', bytes: r.bytes, pages: r.pages }];
      } else if (req.op === 'rotate') {
        const r = await rotate(first.bytes, { spec: req.spec, degrees: req.degrees }, first.name);
        outputs = [{ name: safeBase(first.file) + '-rotated.pdf', bytes: r.bytes, pages: r.pages }];
      } else if (req.op === 'annotate') {
        const r = await annotate(first.bytes, { items: req.items, signature: req.signature, ascii: req.ascii }, first.name);
        outputs = [{ name: safeBase(first.file) + (r.signed && r.signed === r.marks ? '-signed.pdf' : '-annotated.pdf'), bytes: r.bytes, pages: r.marks }];
      } else if (req.op === 'fill') {
        const r = await fillForm(first.bytes, { values: req.values, flatten: req.flatten, ascii: req.ascii }, first.name);
        outputs = [{ name: safeBase(first.file) + '-filled.pdf', bytes: r.bytes, pages: r.fields }];
      } else if (req.op === 'compress') {
        const r = await compress(first.bytes, first.name);
        outputs = [{ name: safeBase(first.file) + '-compressed.pdf', bytes: r.bytes, pages: r.pages, before: r.before }];
      } else if (req.op === 'shrink') {
        if (!nativeImage) throw new Error('Shrinking pictures needs Electron, which is not available here');
        const r = await shrink(first.bytes, { level: req.level, codec: require('./pdf-images').nativeImageEncoder(nativeImage) }, first.name);
        outputs = [{ name: safeBase(first.file) + '-smaller.pdf', bytes: r.bytes, pages: r.pages, before: r.before, changed: r.changed }];
      } else if (req.op === 'split') {
        const parts = await split(first.bytes, { mode: req.mode, n: req.n, spec: req.spec }, first.name);
        outputs = parts.map((p, i) => ({ name: safeBase(first.file) + '-part-' + String(i + 1).padStart(2, '0') + ' (' + p.label + ').pdf', bytes: p.bytes, pages: p.pages }));
      } else throw new Error('Unknown PDF tool ' + req.op);

      const written = [];
      if (outputs.length === 1) {
        const opts = { title: 'Save the new PDF', defaultPath: nodePath.join(dir, outputs[0].name), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
        const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
        if (r.canceled || !r.filePath) return { ok: true, cancelled: true, files: [] };
        let target = r.filePath;
        if (!/\.pdf$/i.test(target)) target += '.pdf';
        if (inputs.some(i => samePath(i.file, target))) throw new Error('That would replace one of the PDFs you started from. Save the new one under another name');
        await writeAtomic(target, outputs[0].bytes, fsImpl);
        written.push({ path: target, name: nodePath.basename(target), pages: outputs[0].pages, bytes: outputs[0].bytes.length, ...(outputs[0].before ? { before: outputs[0].before } : {}), ...(outputs[0].changed != null ? { changed: outputs[0].changed } : {}) });
      } else {
        const opts = { title: 'Choose a folder for the ' + outputs.length + ' new PDFs', buttonLabel: 'Save here', defaultPath: dir, properties: ['openDirectory', 'createDirectory'] };
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: true, cancelled: true, files: [] };
        for (const o of outputs) {
          const base = o.name.replace(/\.pdf$/i, '');
          const target = uniquePath(r.filePaths[0], base, '.pdf', fsImpl);
          await writeAtomic(target, o.bytes, fsImpl);
          written.push({ path: target, name: nodePath.basename(target), pages: o.pages, bytes: o.bytes.length });
        }
      }
      return { ok: true, cancelled: false, files: written };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('pdftool:inspect', async (_e, token) => {
    try {
      const f = fileOf(token);
      const info = await inspect(await fsImpl.promises.readFile(f.file), f.name);
      return { ok: true, name: f.name, ...info };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('pdftool:forget', () => { picked.clear(); return { ok: true }; });
  return { tokens: () => picked.size };
}

module.exports = { registerPdfToolkit, parsePageSpec, merge, extract, split, rotate, pageCount, inspect, fillForm, annotate, compress, shrink, unsupportedChars, LIMITS, MARK, COLORS };
