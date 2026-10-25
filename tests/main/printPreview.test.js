// Vex's own print preview, main side (src/main/print-preview.js): the options, the page ranges, putting several
// pages on a sheet, and the IPC layer driven with fakes (no printer, no Electron).
import { describe, it, expect } from 'vitest';
const { PDFDocument } = require('pdf-lib');
const pp = require('../../src/main/print-preview.js');

async function makePdf(pages, size = [595, 842]) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage(size).drawText('page ' + (i + 1), { x: 50, y: 700 });
  return Buffer.from(await d.save());
}
const base = (over = {}) => pp.cleanOptions({ dest: '@pdf', pages: { mode: 'all' }, ...over });

describe('cleanOptions', () => {
  it('fills the defaults and keeps what was chosen', () => {
    const o = base();
    expect(o).toMatchObject({ dest: '@pdf', copies: 1, perSheet: 1, landscape: false, paper: 'A4', background: false, gray: false });
    expect(o.scale).toEqual({ mode: 'fit', percent: 100 });
    expect(o.margins.mode).toBe('default');
    const p = base({ paper: 'Letter', landscape: true, copies: 3, perSheet: 4, background: true, gray: true, scale: { mode: 'percent', percent: 80 } });
    expect(p).toMatchObject({ paper: 'Letter', landscape: true, copies: 3, perSheet: 4, background: true, gray: true });
    expect(p.scale.percent).toBe(80);
  });
  it('refuses nonsense with a plain sentence', () => {
    expect(() => base({ paper: 'B7' })).toThrow('Pick a paper size');
    expect(() => base({ perSheet: 3 })).toThrow('pages per sheet');
    expect(() => base({ copies: 0 })).toThrow('Copies is a whole number from 1 to 999');
    expect(() => base({ copies: 1000 })).toThrow('Copies');
    expect(() => base({ scale: { mode: 'percent', percent: 5 } })).toThrow('Scale is a percentage');
    expect(() => base({ margins: { mode: 'custom', top: 80 } })).toThrow('A margin is from 0 to 50 mm');
    expect(() => pp.cleanOptions(null)).toThrow('missing');
  });
});

describe('page ranges', () => {
  it('reads 1-3, 5 and open ends, ascending and without repeats', () => {
    expect(pp.parseRange('1-3, 5', 9)).toEqual([0, 1, 2, 4]);
    expect(pp.parseRange('7-', 9)).toEqual([6, 7, 8]);
    expect(pp.parseRange('-2', 9)).toEqual([0, 1]);
    expect(pp.parseRange('5, 3-4, 4', 9)).toEqual([2, 3, 4]);
    expect(pp.parseRange('4-2', 9)).toEqual([1, 2, 3]);
  });
  it('says which part is wrong, and marks it as the pages field', () => {
    for (const bad of ['', '2,,3', 'a', '0', '1-x']) {
      try { pp.parseRange(bad, 9); throw new Error('did not throw for ' + bad); } catch (e) { expect(e.field, bad).toBe('pages'); }
    }
    expect(() => pp.parseRange('10', 9)).toThrow('Page 10 is past the last page (9)');
    expect(() => pp.parseRange('3-12', 9)).toThrow('Page 12 is past the last page (9)');
  });
  it('picks the source pages for all, current and a list', () => {
    expect(pp.selectPages({ mode: 'all' }, 3)).toEqual([0, 1, 2]);
    expect(pp.selectPages({ mode: 'current', current: 2 }, 3)).toEqual([1]);
    expect(pp.selectPages({ mode: 'current', current: 99 }, 3)).toEqual([2]);
    expect(pp.selectPages({ mode: 'custom', text: '2-3' }, 3)).toEqual([1, 2]);
    expect(() => pp.selectPages({ mode: 'all' }, 0)).toThrow();
  });
  it('turns pages into the ranges webContents.print wants', () => {
    expect(pp.toRanges([0, 1, 2, 5, 6, 9])).toEqual([{ from: 0, to: 2 }, { from: 5, to: 6 }, { from: 9, to: 9 }]);
  });
});

describe('what goes to printToPDF', () => {
  it('uses the paper, inches for margins, the scale and the background', () => {
    const o = base({ paper: 'A3', landscape: true, background: true, margins: { mode: 'custom', top: 25.4, right: 0, bottom: 12.7, left: 5 } });
    const r = pp.pdfOptions(o, 0.8);
    expect(r).toMatchObject({ landscape: true, printBackground: true, scale: 0.8, pageSize: 'A3', preferCSSPageSize: false });
    expect(r.margins).toEqual({ top: 1, bottom: 0.5, left: 0.197, right: 0 });
  });
  it('default margins are 10 mm and none is zero', () => {
    expect(pp.pdfOptions(base(), 1).margins.top).toBeCloseTo(0.394, 3);
    expect(pp.pdfOptions(base({ margins: { mode: 'none' } }), 1).margins).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
  it('draws a header only when something in it is asked for', () => {
    const off = pp.headerFooterTemplates({});
    expect(off.displayHeaderFooter).toBe(false);
    const on = pp.headerFooterTemplates({ title: true, url: true, date: true, pages: true });
    expect(on.displayHeaderFooter).toBe(true);
    expect(on.headerTemplate).toContain('class="title"');
    expect(on.headerTemplate).toContain('class="date"');
    expect(on.footerTemplate).toContain('class="url"');
    expect(on.footerTemplate).toContain('class="pageNumber"');
    const some = pp.headerFooterTemplates({ pages: true });
    expect(some.headerTemplate).not.toContain('class="title"');
    expect(some.footerTemplate).toContain('totalPages');
  });
});

describe('fit to width', () => {
  const noMargin = { top: 0, right: 0, bottom: 0, left: 0 };
  it('leaves a page that fits at 100 percent', () => {
    expect(pp.fitScale({ widest: 600 }, 'A4', false, { top: 10, right: 10, bottom: 10, left: 10 })).toMatchObject({ scale: 1, fitted: false });
    expect(pp.fitScale(null, 'A4', false, noMargin).scale).toBe(1);
  });
  it('shrinks to the paper width, never below a quarter', () => {
    // A4 is 8.268 in = 793.7 px wide at 96 dpi.
    const r = pp.fitScale({ widest: 1587 }, 'A4', false, noMargin);
    expect(r.fitted).toBe(true);
    expect(r.scale).toBeCloseTo(0.5, 1);
    expect(pp.fitScale({ widest: 100000 }, 'A4', false, noMargin).scale).toBe(0.25);
    // Landscape paper is wider, so it needs less shrinking.
    expect(pp.fitScale({ widest: 1200 }, 'A4', true, noMargin).scale).toBeGreaterThan(pp.fitScale({ widest: 1200 }, 'A4', false, noMargin).scale);
  });
});

describe('what goes to webContents.print', () => {
  const ctx = (extra) => ({ scale: 0.75, title: 'My page', url: 'https://example.com/a', ranges: null, deviceName: 'Stub Printer A', silent: true, ...extra });
  it('carries paper, copies, colour, scale, sheets and the printer', () => {
    const o = base({ dest: 'Stub Printer A', paper: 'Legal', landscape: true, copies: 4, perSheet: 2, gray: true, background: true });
    const r = pp.printOptions(o, ctx());
    expect(r).toMatchObject({ silent: true, deviceName: 'Stub Printer A', pageSize: 'Legal', landscape: true, copies: 4, pagesPerSheet: 2, color: false, printBackground: true, scaleFactor: 75, collate: true });
    expect(r.pageRanges).toBeUndefined();
  });
  it('margins are points, none is its own type, ranges are passed through', () => {
    const r = pp.printOptions(base({ margins: { mode: 'custom', top: 25.4, right: 10, bottom: 10, left: 10 } }), ctx({ ranges: [{ from: 0, to: 1 }] }));
    expect(r.margins).toEqual({ marginType: 'custom', top: 72, bottom: 28, left: 28, right: 28 });
    expect(r.pageRanges).toEqual([{ from: 0, to: 1 }]);
    expect(pp.printOptions(base({ margins: { mode: 'none' } }), ctx()).margins).toEqual({ marginType: 'none' });
  });
  it('header and footer come as a pair: the title and address are set, a space hides one', () => {
    const none = pp.printOptions(base(), ctx());
    expect([none.header, none.footer]).toEqual(['', '']);
    const t = pp.printOptions(base({ headerFooter: { title: true } }), ctx());
    expect([t.header, t.footer]).toEqual(['My page', ' ']);
    const u = pp.printOptions(base({ headerFooter: { url: true, pages: true } }), ctx());
    expect([u.header, u.footer]).toEqual([' ', 'https://example.com/a']);
  });
  it('the Windows dialog is not silent and names no printer', () => {
    const r = pp.printOptions(base({ dest: '@system' }), ctx({ silent: false, deviceName: '' }));
    expect(r.silent).toBe(false);
    expect(r.deviceName).toBeUndefined();
  });
});

describe('several pages on a sheet', () => {
  it('cuts the sheet up, turning it for 2 and 6', () => {
    expect(pp.gridFor(4, false)).toEqual({ cols: 2, rows: 2, turn: false });
    expect(pp.gridFor(2, false)).toEqual({ cols: 2, rows: 1, turn: true });
    expect(pp.gridFor(2, true)).toEqual({ cols: 1, rows: 2, turn: true });
    expect(pp.gridFor(16, false)).toEqual({ cols: 4, rows: 4, turn: false });
  });
  it('keeps just the chosen pages', async () => {
    const doc = await PDFDocument.load(await makePdf(6));
    const r = await pp.compose(doc, [1, 3, 4], 1);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getPageCount()).toBe(3);
    expect(r.pageMap).toEqual([[2], [4], [5]]);
  });
  it('puts four pages on a sheet and tells which pages are where', async () => {
    const doc = await PDFDocument.load(await makePdf(9));
    const r = await pp.compose(doc, [0, 1, 2, 3, 4, 5, 6, 7, 8], 4);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getPageCount()).toBe(3);
    expect(r.pageMap).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
    expect(out.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  });
  it('turns the sheet on its side for two to a sheet', async () => {
    const doc = await PDFDocument.load(await makePdf(3));
    const r = await pp.compose(doc, [0, 1, 2], 2);
    const out = await PDFDocument.load(r.bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
  });
});

describe('small judgements', () => {
  it('knows a PDF page from its type or its address', () => {
    expect(pp.isPdfPage('https://x.test/a', 'application/pdf')).toBe(true);
    expect(pp.isPdfPage('https://x.test/files/report.PDF?dl=1', 'text/html')).toBe(true);
    expect(pp.isPdfPage('https://x.test/page.html', 'text/html')).toBe(false);
    expect(pp.isPdfPage('not a url', '')).toBe(false);
  });
  it('says which tabs must leave nothing behind', () => {
    expect(pp.privacyOf('persist:main')).toBe('');
    expect(pp.privacyOf('tor-abc')).toBe('tor');
    expect(pp.privacyOf('persist:route-tor')).toBe('tor');
    expect(pp.privacyOf('private-xyz')).toBe('private');
    expect(pp.privacyOf('persist:container-work')).toBe('');
  });
});

// ---- the IPC layer with fakes -------------------------------------------------------------------------------
async function harness({ pages = 5, partition = 'persist:main', url = 'https://example.com/post', contentType = 'text/html', fs, cancelSave = false } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const css = [];
  const calls = { pdf: [], print: [], js: [], dialog: [] };
  const pdf = await makePdf(pages);
  const wc = {
    id: 7, isDestroyed: () => false, getURL: () => url, getTitle: () => 'My page: a title', session: { name: 's' },
    once: () => {}, getPrintersAsync: async () => [{ name: 'P1', displayName: 'Printer one', isDefault: true }, { name: 'P2', displayName: 'Printer two' }],
    executeJavaScript: async (code) => { calls.js.push(code); return code.includes('contentType') ? contentType : { widest: 0, viewport: 1000 }; },
    insertCSS: async (c) => { css.push(['in', c]); return 'k1'; }, removeInsertedCSS: async (k) => { css.push(['out', k]); },
    printToPDF: async (o) => { calls.pdf.push(o); return pdf; },
    print: (o, cb) => { calls.print.push(o); cb(true, ''); },
  };
  const written = [];
  const memfs = fs || { promises: { writeFile: async (p, b) => { written.push([p, b.length]); } } };
  const dialog = { showSaveDialog: async (w, o) => { calls.dialog.push(o); return cancelSave ? { canceled: true } : { canceled: false, filePath: 'C:\\out\\x.pdf' }; } };
  const reg = pp.registerPrintPreview({
    ipcMain, dialog, app: { getPath: () => 'C:\\dl' }, BrowserWindow: function () { throw new Error('no windows in this test'); },
    webContents: { fromId: (id) => (id === 7 ? wc : null) }, windowFor: () => null, partitionOf: () => partition,
    safeFileName: (t, ext) => String(t).replace(/[^\w]+/g, '-') + '.' + ext, fsImpl: memfs,
  });
  const sender = { id: 1, once: () => {} };
  const call = (name, ...args) => handlers.get(name)({ sender }, ...args);
  return { call, wc, calls, css, written, reg, handlers, sender, handlerFor: (name) => handlers.get(name) };
}

describe('the preview, end to end with fakes', () => {
  it('opens, lists printers, renders with the options and counts the pages', async () => {
    const h = await harness({ pages: 5 });
    const open = await h.call('printpreview:open', 7);
    expect(open).toMatchObject({ ok: true, pdf: false, privacy: '', title: 'My page: a title' });
    expect(open.printers.map(p => p.name)).toEqual(['P1', 'P2']);
    expect(open.id).toMatch(/^[0-9a-f]{32}$/);
    const r = await h.call('printpreview:render', open.id, { dest: '@pdf', paper: 'Letter', landscape: true, background: true, pages: { mode: 'all' }, headerFooter: { title: true, pages: true } });
    expect(r).toMatchObject({ ok: true, total: 5, sheets: 5, scale: 1, fitted: false });
    expect(h.calls.pdf).toHaveLength(1);
    expect(h.calls.pdf[0]).toMatchObject({ pageSize: 'Letter', landscape: true, printBackground: true, displayHeaderFooter: true });
    // A second render with only the range changed does not render the page again.
    const r2 = await h.call('printpreview:render', open.id, { dest: '@pdf', paper: 'Letter', landscape: true, background: true, pages: { mode: 'custom', text: '2-3' }, headerFooter: { title: true, pages: true } });
    expect(r2).toMatchObject({ ok: true, total: 5, sheets: 2, pageMap: [[2], [3]] });
    expect(h.calls.pdf).toHaveLength(1);
    // But a new paper size does.
    await h.call('printpreview:render', open.id, { dest: '@pdf', paper: 'A5', pages: { mode: 'all' } });
    expect(h.calls.pdf).toHaveLength(2);
  });

  it('reports a bad page list against the pages field, with the real page count in the sentence', async () => {
    const h = await harness({ pages: 4 });
    const { id } = await h.call('printpreview:open', 7);
    const r = await h.call('printpreview:render', id, { dest: '@pdf', pages: { mode: 'custom', text: '9' } });
    expect(r).toMatchObject({ ok: false, field: 'pages', error: 'Page 9 is past the last page (4)' });
  });

  it('draws grayscale by a rule it puts on the page and takes off again, even when rendering fails', async () => {
    const h = await harness({ pages: 2 });
    const { id } = await h.call('printpreview:open', 7);
    await h.call('printpreview:render', id, { dest: '@pdf', gray: true, pages: { mode: 'all' } });
    expect(h.css.map(c => c[0])).toEqual(['in', 'out']);
    expect(h.css[0][1]).toContain('grayscale');
    h.wc.printToPDF = async () => { throw new Error('boom'); };
    const bad = await h.call('printpreview:render', id, { dest: '@pdf', gray: true, paper: 'A3', pages: { mode: 'all' } });
    expect(bad).toMatchObject({ ok: false, error: 'boom' });
    expect(h.css.map(c => c[0])).toEqual(['in', 'out', 'in', 'out']);
  });

  it('prints with the chosen options to the chosen printer, silently', async () => {
    const h = await harness({ pages: 6 });
    const { id } = await h.call('printpreview:open', 7);
    const opts = { dest: 'P2', copies: 2, paper: 'Legal', perSheet: 2, gray: true, pages: { mode: 'custom', text: '1-2, 5' }, headerFooter: { title: true }, margins: { mode: 'none' } };
    await h.call('printpreview:render', id, opts);
    const r = await h.call('printpreview:print', id, opts);
    expect(r).toMatchObject({ ok: true, pages: 3 });
    expect(h.calls.print).toHaveLength(1);
    expect(h.calls.print[0]).toMatchObject({ silent: true, deviceName: 'P2', copies: 2, pageSize: 'Legal', pagesPerSheet: 2, color: false, header: 'My page: a title' });
    expect(h.calls.print[0].pageRanges).toEqual([{ from: 0, to: 1 }, { from: 4, to: 4 }]);
    expect(h.calls.print[0].margins).toEqual({ marginType: 'none' });
  });

  it('refuses to print to a printer that is not in the list, and to "Save as PDF" as a printer', async () => {
    const h = await harness();
    const { id } = await h.call('printpreview:open', 7);
    expect(await h.call('printpreview:print', id, { dest: 'Ghost', pages: { mode: 'all' } })).toMatchObject({ ok: false, error: 'That printer is no longer available' });
    expect(await h.call('printpreview:print', id, { dest: '@pdf', pages: { mode: 'all' } })).toMatchObject({ ok: false });
    expect(h.calls.print).toHaveLength(0);
  });

  it('the Windows dialog is the same print without a printer name', async () => {
    const h = await harness();
    const { id } = await h.call('printpreview:open', 7);
    const r = await h.call('printpreview:print', id, { dest: '@system', pages: { mode: 'all' } });
    expect(r.ok).toBe(true);
    expect(h.calls.print[0].silent).toBe(false);
    expect(h.calls.print[0].deviceName).toBeUndefined();
  });

  it('saves the rendered file where the dialog says, and never takes a path from the window', async () => {
    const h = await harness({ pages: 3 });
    const { id } = await h.call('printpreview:open', 7);
    const r = await h.call('printpreview:save-pdf', id, { dest: '@pdf', pages: { mode: 'custom', text: '2' }, path: 'C:\\evil.pdf' });
    expect(r).toMatchObject({ ok: true, name: 'x.pdf', sheets: 1 });
    expect(h.written).toHaveLength(1);
    expect(h.written[0][0]).toBe('C:\\out\\x.pdf');
    expect(h.calls.dialog[0].defaultPath).toBe('C:\\dl\\My-page-a-title.pdf');
    expect(h.calls.dialog[0].filters[0].extensions).toEqual(['pdf']);
  });

  it('a cancelled Save dialog writes nothing', async () => {
    const h = await harness({ cancelSave: true });
    const { id } = await h.call('printpreview:open', 7);
    const r = await h.call('printpreview:save-pdf', id, { dest: '@pdf', pages: { mode: 'all' } });
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(h.written).toHaveLength(0);
  });

  it('a page that is itself a PDF is not rendered, it is explained', async () => {
    const h = await harness({ url: 'https://x.test/report.pdf', contentType: 'application/pdf' });
    const r = await h.call('printpreview:open', 7);
    expect(r).toMatchObject({ ok: true, pdf: true });
    expect(r.id).toBeUndefined();
    expect(h.calls.pdf).toHaveLength(0);
  });

  it('a private or Tor tab is told as such', async () => {
    expect((await (await harness({ partition: 'private-1' })).call('printpreview:open', 7)).privacy).toBe('private');
    expect((await (await harness({ partition: 'tor-1' })).call('printpreview:open', 7)).privacy).toBe('tor');
  });

  it('another window cannot use a preview it does not own, and a closed preview is gone', async () => {
    const h = await harness();
    const { id } = await h.call('printpreview:open', 7);
    const other = await h.handlerFor('printpreview:render')({ sender: { id: 99, once: () => {} } }, id, { dest: '@pdf', pages: { mode: 'all' } });
    expect(other).toMatchObject({ ok: false, error: 'The print preview was closed' });
    expect(await h.call('printpreview:close', id)).toEqual({ ok: true });
    expect(await h.call('printpreview:render', id, { dest: '@pdf', pages: { mode: 'all' } })).toMatchObject({ ok: false });
  });

  it('opening again closes the earlier preview of that window', async () => {
    const h = await harness();
    const a = await h.call('printpreview:open', 7);
    const b = await h.call('printpreview:open', 7);
    expect(h.reg.sessions.has(a.id)).toBe(false);
    expect(h.reg.sessions.has(b.id)).toBe(true);
  });

  it('a request overtaken by a newer one is answered as stale without rendering', async () => {
    const h = await harness();
    const { id } = await h.call('printpreview:open', 7);
    const first = h.call('printpreview:render', id, { dest: '@pdf', paper: 'A3', pages: { mode: 'all' } });
    const second = h.call('printpreview:render', id, { dest: '@pdf', paper: 'A5', pages: { mode: 'all' } });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ ok: true, stale: true });
    expect(b).toMatchObject({ ok: true, total: 5 });
    expect(h.calls.pdf.map(o => o.pageSize)).toEqual(['A5']);
  });
});
