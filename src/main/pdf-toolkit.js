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
// What it does not do (listed in the Settings group too): fill forms, sign,
// compress, OCR, or open a password-protected PDF. A PDF with a password is
// refused with a plain sentence; Vex does not try to remove it.
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
        written.push({ path: target, name: nodePath.basename(target), pages: outputs[0].pages, bytes: outputs[0].bytes.length, before: outputs[0].before, changed: outputs[0].changed });
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

  ipcMain.handle('pdftool:forget', () => { picked.clear(); return { ok: true }; });
  return { tokens: () => picked.size };
}

module.exports = { registerPdfToolkit, parsePageSpec, merge, extract, split, rotate, shrink, pageCount, LIMITS };
