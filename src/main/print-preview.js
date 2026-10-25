// === Vex's own print preview ================================================
//
// Electron has no rich print preview (see the note at the top of src/main.js), so Ctrl+P used to open the plain
// Windows dialog with no picture of the page. This is the main-process half of the preview Vex draws itself
// (js/print-preview-ui.js is the window the person sees).
//
//   open      the page in front is named by its webContents id (the policy checks the window owns it). Main hands
//             back an opaque preview id, the printers Windows knows and what kind of page it is.
//   render    the page is turned into a PDF by webContents.printToPDF with the chosen paper, margins, scale,
//             background, header and footer, then the chosen pages are kept and, if asked, put several to a
//             sheet (pdf-lib). The window shows that PDF with pdf.js, so the picture IS the file that is saved.
//   print     the same choices go to webContents.print (a silent job to the chosen printer, or the Windows dialog).
//   save      "Save as PDF" writes the rendered file where the person picks in a Save dialog. The window never
//             names a path (the pattern of src/main/pdf-toolkit.js).
//   simplify  the window sends the article reading mode extracted (already escaped markup); it is loaded in a
//             hidden window that has no script and uses the TAB'S OWN session (so a Tor or private tab stays in
//             its session) and that window is printed in place of the page.
//
// Nothing here writes a file except Save as PDF at the place the person picked. A private or Tor page works the
// same way and leaves nothing behind: the simplified page is a data: address, never a temp file.
//
// Limits worth knowing (they are said in the window too):
//   * Colour or black and white for a PDF is a CSS grayscale filter on the page while it is rendered, which
//     makes Chromium draw the page as a picture (the file is larger and its text cannot be selected).
//   * A real print job goes through Chromium's own print settings. It honours paper, orientation, margins, scale,
//     copies, pages, pages per sheet, background and colour. Its header and footer are Chromium's pair
//     (title and address you can set; the date and the page numbers come with them).
//   * "Fit to width" shrinks the page only when something on it (a table, code, a box that scrolls sideways)
//     is wider than the paper; a page that simply reflows is left at 100 percent.

const nodePath = require('path');
const crypto = require('crypto');

// Paper in inches (printToPDF takes inches; print() takes the names).
const PAPERS = Object.freeze({
  A3: [11.693, 16.535], A4: [8.268, 11.693], A5: [5.827, 8.268],
  Letter: [8.5, 11], Legal: [8.5, 14], Tabloid: [11, 17],
});
const PER_SHEET = Object.freeze([1, 2, 4, 6, 9, 16]);
const SYSTEM_DIALOG = '@system';
const SAVE_AS_PDF = '@pdf';
const LIMITS = Object.freeze({ pdfBytes: 120 * 1024 * 1024, simplifiedChars: 1400000, printers: 100, copies: 999, rangeChars: 200 });
const DEFAULT_MARGIN_MM = 10;

const fail = (message, field) => { const err = new Error(message); if (field) err.field = field; throw err; };

function whole(value, lo, hi, message) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < lo || n > hi) fail(message);
  return n;
}

// The options the window sent, checked and filled in. Throws a plain sentence (that the window translates).
function cleanOptions(raw) {
  const r = raw && typeof raw === 'object' ? raw : fail('The print options are missing');
  const paper = String(r.paper || 'A4');
  if (!PAPERS[paper]) fail('Pick a paper size from the list');
  const perSheet = Number(r.perSheet || 1);
  if (!PER_SHEET.includes(perSheet)) fail('Pick 1, 2, 4, 6, 9 or 16 pages per sheet');
  const pages = r.pages && typeof r.pages === 'object' ? r.pages : { mode: 'all' };
  const mode = String(pages.mode || 'all');
  if (!['all', 'current', 'custom'].includes(mode)) fail('Pick all pages, the current page or a list of pages');
  const text = String(pages.text == null ? '' : pages.text).slice(0, 1000);
  if (text.length > LIMITS.rangeChars) fail('Keep the page list short, for example 1-3, 5');
  const scale = r.scale && typeof r.scale === 'object' ? r.scale : { mode: 'fit' };
  if (!['fit', 'percent'].includes(String(scale.mode || 'fit'))) fail('Pick fit to width or a percentage');
  const percent = Number(scale.percent == null ? 100 : scale.percent);
  if (!Number.isFinite(percent) || percent < 10 || percent > 200) fail('Scale is a percentage from 10 to 200');
  const m = r.margins && typeof r.margins === 'object' ? r.margins : { mode: 'default' };
  const mmode = String(m.mode || 'default');
  if (!['default', 'none', 'custom'].includes(mmode)) fail('Pick default, none or custom margins');
  const mm = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const v = Number(m[side] == null ? DEFAULT_MARGIN_MM : m[side]);
    if (!Number.isFinite(v) || v < 0 || v > 50) fail('A margin is from 0 to 50 mm');
    mm[side] = v;
  }
  const hf = r.headerFooter && typeof r.headerFooter === 'object' ? r.headerFooter : {};
  return {
    dest: String(r.dest == null ? SAVE_AS_PDF : r.dest).slice(0, 256),
    copies: whole(r.copies == null ? 1 : r.copies, 1, LIMITS.copies, 'Copies is a whole number from 1 to 999'),
    pages: { mode, text, current: whole(pages.current == null ? 1 : pages.current, 1, 100000, 'The current page is not valid') },
    perSheet,
    landscape: r.landscape === true,
    paper,
    scale: { mode: String(scale.mode || 'fit'), percent },
    margins: { mode: mmode, ...mm },
    background: r.background === true,
    headerFooter: { title: hf.title === true, url: hf.url === true, date: hf.date === true, pages: hf.pages === true },
    gray: r.gray === true,
  };
}

// The margins in millimetres the render really uses.
function marginsMm(o) {
  if (o.margins.mode === 'none') return { top: 0, right: 0, bottom: 0, left: 0 };
  if (o.margins.mode === 'custom') return { top: o.margins.top, right: o.margins.right, bottom: o.margins.bottom, left: o.margins.left };
  return { top: DEFAULT_MARGIN_MM, right: DEFAULT_MARGIN_MM, bottom: DEFAULT_MARGIN_MM, left: DEFAULT_MARGIN_MM };
}
const mmToInch = (mm) => Math.round((mm / 25.4) * 1000) / 1000;
const mmToPoint = (mm) => Math.round((mm / 25.4) * 72);

// "1-3, 5, 8-" -> ascending, unique, zero-based page numbers. Throws sentences with the changing part in
// {n} form words the window can translate ("Page 9 is past the last page (4)").
function parseRange(spec, total) {
  const text = String(spec == null ? '' : spec).trim();
  if (!text) fail('Write the pages, for example 1-3, 5', 'pages');
  const out = new Set();
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) fail('There is an empty piece in the page list', 'pages');
    const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) fail('"' + part.slice(0, 20) + '" is not a page or a range of pages', 'pages');
    let from, to;
    if (!m[2]) { from = to = Number(m[1]); }
    else { from = m[1] ? Number(m[1]) : 1; to = m[3] ? Number(m[3]) : total; }
    if (from < 1 || to < 1) fail('Pages start at 1', 'pages');
    if (from > total) fail('Page ' + from + ' is past the last page (' + total + ')', 'pages');
    if (to > total) fail('Page ' + to + ' is past the last page (' + total + ')', 'pages');
    const lo = Math.min(from, to), hi = Math.max(from, to);
    for (let p = lo; p <= hi; p++) out.add(p - 1);
  }
  return [...out].sort((a, b) => a - b);
}

// Which source pages are printed.
function selectPages(pages, total) {
  if (!Number.isInteger(total) || total < 1) fail('The page has no pages to print');
  if (pages.mode === 'all') return Array.from({ length: total }, (_, i) => i);
  if (pages.mode === 'current') return [Math.min(Math.max(1, pages.current), total) - 1];
  return parseRange(pages.text, total);
}

// [0,1,2,5,6] -> [{from:0,to:2},{from:5,to:6}] (webContents.print wants these, zero-based).
function toRanges(indices) {
  const out = [];
  for (const i of indices) {
    const last = out[out.length - 1];
    if (last && i === last.to + 1) last.to = i; else out.push({ from: i, to: i });
  }
  return out;
}

// Title and date on top, address and page numbers at the bottom, small and grey. Chromium fills the classes in.
function headerFooterTemplates(hf) {
  const base = 'font-size:8px;line-height:1;font-family:Segoe UI,Arial,sans-serif;color:#444;width:100%;box-sizing:border-box;padding:0 12mm;display:flex;justify-content:space-between;gap:8mm;';
  const head = [hf.title ? '<span class="title" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:70%"></span>' : '<span></span>', hf.date ? '<span class="date"></span>' : '<span></span>'];
  const foot = [hf.url ? '<span class="url" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:70%"></span>' : '<span></span>', hf.pages ? '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' : '<span></span>'];
  const any = hf.title || hf.url || hf.date || hf.pages;
  return {
    displayHeaderFooter: !!any,
    headerTemplate: '<div style="' + base + '">' + (hf.title || hf.date ? head.join('') : '') + '</div>',
    footerTemplate: '<div style="' + base + '">' + (hf.url || hf.pages ? foot.join('') : '') + '</div>',
  };
}

// The script run in the page that finds how wide its widest unbreakable thing is, in CSS pixels from the page's left.
function measureScript() {
  return `(function () {
    var d = document, de = d.documentElement, b = d.body, sx = window.scrollX || 0;
    var cw = de.clientWidth, widest = 0;
    if (de.scrollWidth > cw + 1) widest = de.scrollWidth;
    var els = d.querySelectorAll('table, pre, div, section, article, main, figure');
    var n = Math.min(els.length, 3000);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      var sideways = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && /^(auto|scroll)$/.test(getComputedStyle(el).overflowX);
      if (sideways) {
        var r = el.getBoundingClientRect();
        var w = r.left + sx + el.scrollWidth;
        if (w > widest) widest = w;
      } else if ((el.tagName === 'TABLE' || el.tagName === 'PRE')) {
        var q = el.getBoundingClientRect(), p = el.parentElement;
        if (p && q.width > 0 && q.width < p.clientWidth - 1) { var e2 = q.right + sx; if (e2 > widest) widest = e2; }
      }
    }
    return { widest: Math.ceil(widest), viewport: cw };
  })()`;
}

function fitScale(measure, paper, landscape, margins) {
  const [w, h] = PAPERS[paper];
  const widthIn = (landscape ? h : w) - mmToInch(margins.left) - mmToInch(margins.right);
  const avail = widthIn * 96;
  const widest = measure && Number.isFinite(measure.widest) ? measure.widest : 0;
  if (!(widest > avail) || !(avail > 0)) return { scale: 1, fitted: false, widest };
  return { scale: Math.max(0.25, Math.round((avail / widest) * 100) / 100), fitted: true, widest };
}

// The options for printToPDF.
function pdfOptions(o, scale) {
  const mg = marginsMm(o);
  return {
    landscape: o.landscape,
    printBackground: o.background,
    scale,
    pageSize: o.paper,
    margins: { top: mmToInch(mg.top), bottom: mmToInch(mg.bottom), left: mmToInch(mg.left), right: mmToInch(mg.right) },
    preferCSSPageSize: false,
    generateTaggedPDF: false,
    ...headerFooterTemplates(o.headerFooter),
  };
}

// The options for webContents.print.
function printOptions(o, { scale, title, url, ranges, deviceName, silent }) {
  const mg = marginsMm(o);
  const hf = o.headerFooter;
  const any = hf.title || hf.url || hf.date || hf.pages;
  const opts = {
    silent: !!silent,
    printBackground: o.background,
    color: !o.gray,
    landscape: o.landscape,
    pageSize: o.paper,
    scaleFactor: Math.round(scale * 100),
    copies: o.copies,
    collate: true,
    pagesPerSheet: o.perSheet,
    margins: o.margins.mode === 'none'
      ? { marginType: 'none' }
      : { marginType: 'custom', top: mmToPoint(mg.top), bottom: mmToPoint(mg.bottom), left: mmToPoint(mg.left), right: mmToPoint(mg.right) },
    // Chromium's own header and footer come as a pair: the title and the address are ours to set (a space hides one).
    header: any ? (hf.title ? String(title || '').slice(0, 300) || ' ' : ' ') : '',
    footer: any ? (hf.url ? String(url || '').slice(0, 500) || ' ' : ' ') : '',
  };
  if (deviceName) opts.deviceName = deviceName;
  if (ranges && ranges.length) opts.pageRanges = ranges;
  return opts;
}

// pages per sheet -> how the sheet is cut up. Two and six to a sheet turn the sheet on its side.
function gridFor(perSheet, sourceLandscape) {
  const table = { 2: [2, 1, true], 4: [2, 2, false], 6: [3, 2, true], 9: [3, 3, false], 16: [4, 4, false] };
  const [cols, rows, turn] = table[perSheet];
  // The grid is written for a portrait page: on a landscape page the turned sheets are portrait and rows/cols swap.
  if (turn) return sourceLandscape ? { cols: rows, rows: cols, turn } : { cols, rows, turn };
  return { cols, rows, turn };
}

// Keep these source pages (zero-based) and put `perSheet` of them on each sheet.
// -> { bytes, pageMap: [[1,2],[3,4]...] (one list of one-based source pages for every sheet) }
async function compose(srcDoc, indices, perSheet, meta = {}) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const out = await PDFDocument.create();
  out.setProducer('Vex print preview');
  out.setCreator('Vex');
  if (meta.title) out.setTitle(String(meta.title).slice(0, 300));
  const pageMap = [];
  if (perSheet === 1) {
    for (const p of await out.copyPages(srcDoc, indices)) out.addPage(p);
    for (const i of indices) pageMap.push([i + 1]);
    return { bytes: Buffer.from(await out.save()), pageMap };
  }
  const all = srcDoc.getPages();
  const embedded = await out.embedPages(indices.map(i => all[i]));
  const first = all[indices[0]].getSize();
  const sourceLandscape = first.width > first.height;
  const { cols, rows, turn } = gridFor(perSheet, sourceLandscape);
  const sheetW = turn ? first.height : first.width;
  const sheetH = turn ? first.width : first.height;
  const gap = 8, cellW = (sheetW - gap * (cols + 1)) / cols, cellH = (sheetH - gap * (rows + 1)) / rows;
  for (let at = 0; at < indices.length; at += perSheet) {
    const sheet = out.addPage([sheetW, sheetH]);
    const group = [];
    for (let k = 0; k < perSheet && at + k < indices.length; k++) {
      const e = embedded[at + k];
      const fit = Math.min(cellW / e.width, cellH / e.height);
      const w = e.width * fit, h = e.height * fit;
      const col = k % cols, row = Math.floor(k / cols);
      const x = gap + col * (cellW + gap) + (cellW - w) / 2;
      const y = sheetH - gap - (row + 1) * cellH - row * gap + (cellH - h) / 2;
      sheet.drawPage(e, { x, y, width: w, height: h });
      sheet.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.72, 0.72, 0.72), borderWidth: 0.5 });
      group.push(indices[at + k] + 1);
    }
    pageMap.push(group);
  }
  return { bytes: Buffer.from(await out.save()), pageMap };
}

// A page that is itself a PDF cannot be printed through this: Chromium's viewer prints it.
function isPdfPage(url, contentType) {
  if (/^application\/pdf\b/i.test(String(contentType || ''))) return true;
  try { return /\.pdf$/i.test(new URL(String(url)).pathname); } catch { return false; }
}

// 'tor' / 'private' for the tabs that must leave nothing behind, or '' for an ordinary one.
function privacyOf(partition) {
  const p = String(partition || '');
  if (p === 'persist:main' || p === '') return '';
  if (/^tor-|^persist:route-tor/.test(p)) return 'tor';
  if (!p.startsWith('persist:')) return 'private';
  return '';
}

// ---------------------------------------------------------------------------------------------------------------
// The Electron layer. Everything it touches is injected, so tests drive it with fakes.
function registerPrintPreview({ ipcMain, dialog, webContents, BrowserWindow, app, windowFor, partitionOf, downloadFolder = () => null, fsImpl = require('fs'), safeFileName }) {
  for (const [k, v] of Object.entries({ ipcMain, dialog, webContents, BrowserWindow, app })) if (!v) throw new Error('registerPrintPreview needs ' + k);
  if (typeof windowFor !== 'function' || typeof partitionOf !== 'function' || typeof safeFileName !== 'function') throw new Error('registerPrintPreview needs windowFor, partitionOf and safeFileName');

  const sessions = new Map();           // preview id -> session
  const bySender = new Map();           // sender webContents id -> preview id

  function closeSession(id) {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    if (bySender.get(s.senderId) === id) bySender.delete(s.senderId);
    s.cache = null;
    destroySimplified(s);
  }
  function destroySimplified(s) {
    const win = s.simplified;
    s.simplified = null;
    s.simpVersion = (s.simpVersion || 0) + 1;
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (err) { console.error('[PrintPreview] could not close the simplified page:', err && err.message); }
  }
  function sessionFor(e, id) {
    const s = typeof id === 'string' ? sessions.get(id) : null;
    if (!s || s.senderId !== e.sender.id) throw new Error('The print preview was closed');
    if (!s.wc || s.wc.isDestroyed()) { closeSession(id); throw new Error('That tab has closed'); }
    return s;
  }
  const targetOf = (s) => (s.simplified && !s.simplified.isDestroyed() ? s.simplified.webContents : s.wc);

  async function resolveScale(s, o) {
    const mg = marginsMm(o);
    if (o.scale.mode === 'percent') return { scale: Math.min(2, Math.max(0.1, o.scale.percent / 100)), fitted: false, widest: 0 };
    if (s.simplified) return { scale: 1, fitted: false, widest: 0 };
    const measure = await targetOf(s).executeJavaScript(measureScript(), false);
    return fitScale(measure, o.paper, o.landscape, mg);
  }

  async function stage1(s, o, fresh) {
    const key = JSON.stringify({ p: o.paper, l: o.landscape, sc: o.scale, mg: o.margins, bg: o.background, hf: o.headerFooter, g: o.gray, v: s.simpVersion || 0 });
    if (!fresh && s.cache && s.cache.key === key) return s.cache;
    const target = targetOf(s);
    let cssKey = null;
    try {
      if (o.gray) cssKey = await target.insertCSS('html{filter:grayscale(1)!important}');
      const fit = await resolveScale(s, o);
      const raw = await target.printToPDF(pdfOptions(o, fit.scale));
      if (raw.length > LIMITS.pdfBytes) throw new Error('This page prints to more than ' + Math.round(LIMITS.pdfBytes / 1048576) + ' MB, which is too large to preview');
      const { PDFDocument } = require('pdf-lib');
      const doc = await PDFDocument.load(raw, { updateMetadata: false });
      s.cache = { key, bytes: Buffer.from(raw), doc, total: doc.getPageCount(), scale: fit.scale, fitted: fit.fitted, widest: fit.widest, stage2: null };
      return s.cache;
    } finally {
      if (cssKey) {
        try { await target.removeInsertedCSS(cssKey); } catch (err) { console.error('[PrintPreview] could not remove the grayscale rule from the page:', err && err.message); }
      }
    }
  }

  async function finalPdf(s, o, fresh) {
    const base = await stage1(s, o, fresh);
    const indices = selectPages(o.pages, base.total);
    const key = JSON.stringify([indices, o.perSheet]);
    if (base.stage2 && base.stage2.key === key) return { base, indices, ...base.stage2 };
    let made;
    if (indices.length === base.total && o.perSheet === 1) made = { bytes: base.bytes, pageMap: indices.map(i => [i + 1]) };
    else made = await compose(base.doc, indices, o.perSheet, { title: s.title });
    base.stage2 = { key, bytes: made.bytes, pageMap: made.pageMap };
    return { base, indices, ...base.stage2 };
  }

  // One render at a time per preview; a request that was overtaken by a newer one answers { stale: true } without work.
  function enqueue(s, work) {
    const mine = (s.latest = (s.latest || 0) + 1);
    const run = (s.chain || Promise.resolve()).then(() => (mine !== s.latest ? { ok: true, stale: true } : work()));
    s.chain = run.catch(() => { /* vex-allow-empty-catch: the caller of this render gets the error from `run`; the chain only has to keep going */ });
    return run;
  }

  const reply = async (fn) => {
    try { return await fn(); }
    catch (err) { return { ok: false, error: (err && err.message) || 'The print preview could not do that', field: (err && err.field) || undefined }; }
  };

  ipcMain.handle('printpreview:open', (e, wcId) => reply(async () => {
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed()) throw new Error('That tab has closed');
    const previous = bySender.get(e.sender.id);
    if (previous) closeSession(previous);
    const url = wc.getURL();
    let contentType = '';
    try { contentType = String(await wc.executeJavaScript('document.contentType', false) || ''); }
    catch (err) { console.warn('[PrintPreview] could not read the page type:', err && err.message); }
    const title = wc.getTitle();
    const privacy = privacyOf(partitionOf(wc));
    if (isPdfPage(url, contentType)) return { ok: true, pdf: true, title, url, privacy };
    const list = await wc.getPrintersAsync();
    const printers = list.slice(0, LIMITS.printers).map(p => ({ name: String(p.name || ''), displayName: String(p.displayName || p.name || ''), isDefault: p.isDefault === true }));
    const id = crypto.randomBytes(16).toString('hex');
    const s = { id, senderId: e.sender.id, wc, title, url, printers, cache: null, simplified: null, simpVersion: 0, latest: 0, chain: null };
    sessions.set(id, s);
    bySender.set(e.sender.id, id);
    wc.once('destroyed', () => closeSession(id));
    e.sender.once('destroyed', () => closeSession(id));
    return { ok: true, id, pdf: false, title, url, privacy, printers, papers: Object.keys(PAPERS) };
  }));

  ipcMain.handle('printpreview:render', (e, id, raw, fresh) => reply(() => {
    const s = sessionFor(e, id);
    const o = cleanOptions(raw);
    return enqueue(s, async () => {
      const r = await finalPdf(s, o, fresh === true);
      return { ok: true, total: r.base.total, sheets: r.pageMap.length, pageMap: r.pageMap, scale: r.base.scale, fitted: r.base.fitted, bytes: r.bytes };
    });
  }));

  ipcMain.handle('printpreview:simplify', (e, id, html) => reply(async () => {
    const s = sessionFor(e, id);
    destroySimplified(s);
    s.cache = null;
    if (html == null) return { ok: true, simplified: false };
    const markup = String(html);
    if (markup.length > LIMITS.simplifiedChars) throw new Error('This page is too long to simplify');
    const win = new BrowserWindow({
      show: false, width: 1000, height: 1400, skipTaskbar: true, focusable: false,
      webPreferences: { session: s.wc.session, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, spellcheck: false, backgroundThrottling: false },
    });
    s.simplified = win;
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (ev) => ev.preventDefault());
    await wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(markup));
    return { ok: true, simplified: true };
  }));

  ipcMain.handle('printpreview:print', (e, id, raw) => reply(async () => {
    const s = sessionFor(e, id);
    const o = cleanOptions(raw);
    const silent = o.dest !== SYSTEM_DIALOG;
    if (o.dest === SAVE_AS_PDF) throw new Error('Pick a printer, or use Save as PDF');
    if (silent && !s.printers.some(p => p.name === o.dest)) throw new Error('That printer is no longer available');
    const base = await stage1(s, o, false);
    const indices = selectPages(o.pages, base.total);
    const ranges = indices.length === base.total ? null : toRanges(indices);
    const target = targetOf(s);
    const opts = printOptions(o, { scale: base.scale, title: s.title, url: s.url, ranges, deviceName: silent ? o.dest : '', silent });
    const result = await new Promise((resolve) => {
      target.print(opts, (success, failureReason) => resolve({ success, failureReason }));
    });
    if (!result.success) throw new Error('Could not print: ' + (result.failureReason || 'the print job failed'));
    return { ok: true, pages: indices.length };
  }));

  ipcMain.handle('printpreview:save-pdf', (e, id, raw) => reply(async () => {
    const s = sessionFor(e, id);
    const o = cleanOptions(raw);
    const r = await finalPdf(s, o, false);
    const win = windowFor(e);
    const res = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {
      title: 'Save as PDF',
      defaultPath: nodePath.join(downloadFolder() || app.getPath('downloads'), safeFileName(s.title, 'pdf')),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    await fsImpl.promises.writeFile(res.filePath, r.bytes);
    return { ok: true, name: nodePath.basename(res.filePath), sheets: r.pageMap.length, bytes: r.bytes.length };
  }));

  ipcMain.handle('printpreview:close', (e, id) => reply(async () => {
    const s = typeof id === 'string' ? sessions.get(id) : null;
    if (s && s.senderId === e.sender.id) closeSession(id);
    return { ok: true };
  }));

  return { sessions, closeSession };
}

module.exports = {
  registerPrintPreview, cleanOptions, parseRange, selectPages, toRanges, headerFooterTemplates, pdfOptions, printOptions,
  fitScale, measureScript, compose, gridFor, isPdfPage, privacyOf, marginsMm, PAPERS, PER_SHEET, SYSTEM_DIALOG, SAVE_AS_PDF, LIMITS,
};
