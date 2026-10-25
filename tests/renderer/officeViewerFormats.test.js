// @vitest-environment jsdom
//
// Vex's office-document viewer, the other readers: slides (pptx.js), books (epub.js), OpenDocument (odf.js) and RTF (rtf.js).
// How they look in the real window is checked by driving a real Vex.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fflate = require('fflate');
const zipinfo = require('../../src/renderer/office-viewer/zipinfo.js');
const fx = require('../helpers/officeFixtures.js');

let pptx, epub, odf, rtf, pkgmod;
const open = (buf) => pkgmod.localPackage(fflate, new Uint8Array(buf), zipinfo);
beforeAll(async () => {
  URL.createObjectURL = (blob) => 'blob:test/' + blob.size;
  URL.revokeObjectURL = () => {};
  pptx = await import('../../src/renderer/office-viewer/pptx.js');
  epub = await import('../../src/renderer/office-viewer/epub.js');
  odf = await import('../../src/renderer/office-viewer/odf.js');
  rtf = await import('../../src/renderer/office-viewer/rtf.js');
  pkgmod = await import('../../src/renderer/office-viewer/package.js');
});

describe('a presentation', () => {
  it('lists its 30 slides at the size the file names', async () => {
    const m = await pptx.loadPptx(open(fx.pptx({ slides: 30 })));
    expect(m.slides.length).toBe(30);
    expect(m.size).toEqual({ w: 1280, h: 720 });
    expect(await pptx.slideTitle(m, 0)).toBe('Slide 1: The sea and its tides');
    expect(await pptx.slideTitle(m, 9)).toBe('Slide 10: Point number 10');
  });

  it('draws text where the layout puts it, with bold, colour and bullets', async () => {
    const m = await pptx.loadPptx(open(fx.pptx({ slides: 3 })));
    const host = document.createElement('div');
    const r = await pptx.renderSlide(m, 1, host);
    const shapes = [...host.querySelectorAll('.od-player .od-pshape')];
    expect(shapes.length).toBeGreaterThanOrEqual(3);
    const title = shapes[0];
    expect(title.style.left).toBe('64px');                          // 609600 EMU from the master's title placeholder
    expect(title.textContent).toContain('Point number 2');
    const body = shapes[1];
    expect(body.querySelector('.od-bu')).toBeTruthy();
    expect(body.querySelector('span[style*="font-weight"]').textContent).toBe('Bold start ');
    expect(body.textContent).toContain('A red sub point');
    expect([...body.querySelectorAll('span')].some((s) => /rgb\(192, 0, 0\)|#c00000/i.test(s.style.color))).toBe(true);
    // the title uses the master's title size: 4000 = 40pt = 53.33px
    expect(title.querySelector('span').style.fontSize).toBe('53.33px');
    expect(r.notes).toBe('Speaker note for slide 2');
    const box = shapes[2];
    expect(box.style.background).toMatch(/rgb\(31, 78, 120\)|#1f4e78/i);
    expect(box.style.borderRadius).not.toBe('');
  });

  it('draws pictures and tables, and says what it cannot draw', async () => {
    const m = await pptx.loadPptx(open(fx.pptx({ slides: 10 })));
    let host = document.createElement('div');
    let r = await pptx.renderSlide(m, 4, host);       // slide 5 has a picture
    expect(host.querySelector('.od-ppic img').src.startsWith('blob:')).toBe(true);
    host = document.createElement('div');
    r = await pptx.renderSlide(m, 6, host);           // slide 7 has a table
    expect(host.querySelector('.od-ptable td').textContent).toContain('Cell A');
    host = document.createElement('div');
    r = await pptx.renderSlide(m, 8, host);           // slide 9 has a chart
    expect(host.textContent).toContain('Chart (not shown)');
    expect(r.unsupported.chart).toBe(1);
  });
});

describe('a book', () => {
  it('reads the package, the contents and the chapters in order', async () => {
    const m = await epub.loadEpub(open(fx.epub({ chapters: 4 })));
    expect(m.title).toBe('The Grey Shore');
    expect(m.author).toBe('I. Tester');
    expect(m.chapters.length).toBe(4);
    expect(m.toc.map((e) => [e.title, e.level, e.chapter])).toEqual([['Chapter 1: The shore', 0, 0], ['Chapter 2: Stage 2', 0, 1], ['Part of two', 1, 1], ['Chapter 3: Stage 3', 0, 2], ['Chapter 4: Stage 4', 0, 3]]);
  });

  it('shows a chapter as safe reading text: no script, pictures from the book, links kept only when safe', async () => {
    const m = await epub.loadEpub(open(fx.epub({ chapters: 3 })));
    const host = document.createElement('div');
    const r = await epub.renderChapter(m, 1, host);
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('h1').textContent).toBe('Chapter 2');
    expect(host.querySelector('img').src.startsWith('blob:')).toBe(true);
    const links = [...host.querySelectorAll('a')];
    const next = links.find((a) => a.textContent === 'next chapter');
    expect(next.dataset.chapter).toBe('2');
    expect(links.find((a) => a.textContent === 'outside').href).toBe('https://example.org/x');
    expect(links.find((a) => a.textContent === 'outside').rel).toContain('noopener');
    const bad = links.find((a) => a.textContent === 'bad');
    expect(bad.getAttribute('href')).toBeNull();
    expect(host.querySelector('#ep-part')).toBeTruthy();
    expect(r.text).toContain('In chapter 2, paragraph 3');
    expect(await epub.chapterText(m, 2)).toContain('In chapter 3');
  });

  it('applies the book\'s own style only on request, and only the safe part of it', async () => {
    const m = await epub.loadEpub(open(fx.epub({ chapters: 2 })));
    let host = document.createElement('div');
    await epub.renderChapter(m, 0, host, { tone: 'theme' });
    expect(host.querySelector('style')).toBeNull();
    host = document.createElement('div');
    await epub.renderChapter(m, 0, host, { tone: 'original' });
    expect(host.querySelector('style')).toBeTruthy();
    const scoped = epub.scopeCss('body { color: red; background: url(http://x/y.png); } @import url(http://evil/x.css); p { text-indent: 1em; behavior: url(x) }');
    expect(scoped).not.toMatch(/http|url\(|behavior/);
    expect(scoped).toContain('.od-epub p');
  });

  it('refuses a package that is not a book', async () => {
    await expect(epub.loadEpub(open(fx.zip({ 'a.txt': 'x' })))).rejects.toMatchObject({ code: 'corrupt' });
  });
});

describe('OpenDocument', () => {
  it('shows a text document', async () => {
    const m = await odf.loadOdf(open(fx.odt()));
    expect(m.kind).toBe('odt');
    const host = document.createElement('div');
    const r = await odf.renderOdt(m, host, {});
    expect(host.querySelector('h1').textContent).toBe('Open document heading');
    expect(host.querySelector('.od-r.b').textContent).toBe('bold');
    expect(host.querySelector('.od-r.i').textContent).toBe('italic');
    expect(host.querySelector('a[href="https://example.org/"]').rel).toContain('noopener');
    expect(host.querySelectorAll('ul li').length).toBe(2);
    expect(host.querySelector('td[colspan="2"]')).toBeTruthy();
    expect(host.querySelector('section.od-notes').textContent).toContain('An ODF footnote.');
    expect(r.comments[0]).toMatchObject({ author: 'Ada', text: 'An ODF comment' });
    expect(host.querySelector('img').src.startsWith('blob:')).toBe(true);
  });

  it('reads a spreadsheet with dates, formulas and repeated rows', async () => {
    const m = await odf.loadOdf(open(fx.ods()));
    expect(m.kind).toBe('ods');
    const wb = odf.odsWorkbook(m);
    expect(wb.sheets).toEqual([{ name: 'Grades', state: 'visible' }]);
    const s = odf.loadOdsSheet(m, 0);
    expect(s.maxRow).toBe(3);
    expect(s.rows[0].map((c) => c[0])).toEqual(['Name', 'Score', 'Date']);
    expect(s.rows[1][1][0]).toBe(93.5);
    expect(s.rows[2][1][0]).toBe(93.5);                       // the repeated row
    expect(s.rows[1][1][3]).toBe('SUM(B1,10)');
    const nf = await import('../../src/renderer/office-viewer/numfmt.js');
    expect(nf.formatCell(s.rows[1][2][0], 'n', wb.styles[s.rows[1][2][2]].nf)).toBe('3/4/2026');
  });

  it('reads a presentation', async () => {
    const m = await odf.loadOdf(open(fx.odp()));
    expect(m.kind).toBe('odp');
    const info = odf.odpModel(m);
    expect(info.count).toBe(2);
    expect(odf.odpTitles(m)).toEqual(['ODP slide one title', 'Second slide']);
    const host = document.createElement('div');
    const r = await odf.renderOdpSlide(m, 0, host);
    expect(r.notes).toBe('ODP note');
    expect(host.querySelector('.od-ppic img')).toBeTruthy();
    expect(host.textContent).toContain('ODP slide one title');
  });
});

describe('Rich Text Format', () => {
  it('reads formatting, code pages, unicode escapes and tables', () => {
    const parsed = rtf.parseRtf(fx.rtf().toString('latin1'));
    const host = document.createElement('div');
    rtf.renderRtf(parsed, host);
    const ps = [...host.querySelectorAll('p')];
    expect(ps[0].textContent).toBe('Title line');
    expect(ps[0].querySelector('.b')).toBeTruthy();
    expect(ps[1].querySelector('.i').textContent).toBe('italic');
    expect(ps[1].querySelector('.u').textContent).toBe('underlined');
    expect(ps[1].textContent).toContain('ığş şğ');        // \'fd \'f0 \'fe in code page 1254, then \u351 \u287
    expect(host.querySelectorAll('td').length).toBe(2);
    expect(host.querySelector('td').textContent).toBe('Cell one');
    expect(host.textContent).toContain('After the table.');
    expect(host.textContent).not.toContain('Arial');
  });
  it('refuses a file that is not RTF', () => {
    expect(() => rtf.parseRtf('plain text')).toThrow(/not a Rich Text/);
  });
});

describe('what a file really is', () => {
  it('tells a package, a protected Office file and plain bytes apart', () => {
    expect(zipinfo.sniff(new Uint8Array(fx.docx()))).toBe('zip');
    expect(zipinfo.sniff(new Uint8Array(fx.encrypted()))).toBe('ole');
    expect(zipinfo.sniff(new Uint8Array(fx.rtf()))).toBe('rtf');
    expect(zipinfo.sniff(new Uint8Array(fx.notAZip()))).toBe('other');
  });
  it('reads the directory and refuses a damaged or a huge package', () => {
    const d = zipinfo.readDirectory(new Uint8Array(fx.docx()));
    expect(d.entries.map((e) => e.name)).toContain('word/document.xml');
    expect(d.encrypted).toBe(false);
    expect(() => zipinfo.readDirectory(new Uint8Array(fx.corrupt()))).toThrow();
    try { zipinfo.readDirectory(new Uint8Array(fx.corrupt())); } catch (e) { expect(e.code).toBe('corrupt'); }
    const big = fx.zip({ 'a.bin': new Uint8Array(1024) });
    // lie about the size in the central directory: 200 MB entry
    const u8 = new Uint8Array(big);
    const dv = new DataView(u8.buffer, u8.byteOffset);
    for (let i = u8.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { const dir = dv.getUint32(i + 16, true); dv.setUint32(dir + 24, 200 * 1048576, true); break; }
    try { zipinfo.readDirectory(u8); throw new Error('should have refused'); } catch (e) { expect(e.code).toBe('huge'); }
  });
});
