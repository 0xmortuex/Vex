// @vitest-environment jsdom
//
// Vex's office-document viewer, the Word reader (src/renderer/office-viewer/docx.js): what a .docx turns into.
// How it looks in the real window is checked by driving a real Vex (scripts are in the report).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fflate = require('fflate');
const zipinfo = require('../../src/renderer/office-viewer/zipinfo.js');
const fx = require('../helpers/officeFixtures.js');

let docx, pkgmod;
beforeAll(async () => {
  URL.createObjectURL = (blob) => 'blob:test/' + blob.size;
  URL.revokeObjectURL = () => {};
  docx = await import('../../src/renderer/office-viewer/docx.js');
  pkgmod = await import('../../src/renderer/office-viewer/package.js');
});

async function render(buf, opts) {
  const pkg = pkgmod.localPackage(fflate, new Uint8Array(buf), zipinfo);
  const model = await docx.loadDocx(pkg);
  const host = document.createElement('div');
  const info = await docx.renderDocx(model, host, opts);
  return { host, info, model };
}

describe('a Word document', () => {
  it('keeps headings, formatting, links, lists and the outline', async () => {
    const { host, info } = await render(fx.docx());
    expect(host.querySelector('h1.od-title').textContent).toBe('Field notes on tides');
    expect(info.outline.map((o) => o.text)).toEqual(['Field notes on tides', '1. Why the sea moves', 'Things to bring', 'Measurements', 'Summary']);
    expect(host.querySelector('.od-r.b').textContent).toBe('rise and fall');
    expect(host.querySelector('.od-r.i').textContent).toBe('Moon');
    const links = [...host.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    expect(links).toContain('https://example.org/tides');
    expect(links).toContain('#bm-summary');
    expect(host.querySelector('#bm-summary')).toBeTruthy();
    const ext = host.querySelector('a[href="https://example.org/tides"]');
    expect(ext.rel).toContain('noopener');
    // bullets: two items, the second has a nested list; the numbered list is separate
    const ul = host.querySelector('ul');
    expect(ul.children.length).toBe(2);
    expect(ul.querySelector('li > ul > li').textContent).toBe('A sharper pencil');
    expect(host.querySelector('ol').children.length).toBe(2);
  });

  it('draws tables with merged cells and cell colours that stay readable', async () => {
    const { host } = await render(fx.docx());
    const table = host.querySelector('table.od-table');
    expect(table.querySelector('thead th').textContent).toBe('Place');
    expect(table.querySelector('thead th:nth-child(2)').colSpan).toBe(2);
    const harbour = [...table.querySelectorAll('td')].find((td) => td.textContent === 'Harbour');
    expect(harbour.rowSpan).toBe(2);
    const shaded = [...table.querySelectorAll('td')].find((td) => td.textContent === 'High');
    expect(shaded.style.background).not.toBe('');
    expect(shaded.style.color).not.toBe('');
  });

  it('shows pictures from the file only, never from the web, and says what it did not load', async () => {
    const { host, info } = await render(fx.docx());
    const imgs = [...host.querySelectorAll('img')];
    expect(imgs.length).toBe(1);
    expect(imgs[0].src.startsWith('blob:')).toBe(true);
    expect(imgs[0].alt).toBe('A tiny test picture');
    expect(host.textContent).toContain('Picture on the web (not loaded)');
    expect(info.unsupported.picture).toBe(1);
    expect(host.innerHTML).not.toContain('tracker.example');
  });

  it('puts footnotes at the end with a way back, and numbers comments', async () => {
    const { host, info } = await render(fx.docx());
    const ref = host.querySelector('a.od-noteref');
    expect(ref.getAttribute('href')).toBe('#fn-2');
    expect(host.querySelector('section.od-notes li#fn-2').textContent).toContain('Spring tides are the strongest.');
    expect(host.querySelector('#fn-2 a.od-noteback').getAttribute('href')).toBe('#fnref-2');
    expect(info.comments.length).toBe(1);
    expect(info.comments[0]).toMatchObject({ author: 'Ada', text: 'Check this against the almanac.' });
    expect(host.querySelector('button.od-cm').textContent).toBe('1');
    expect(host.querySelector('mark.od-cmr').textContent).toContain('A remark lives on this sentence.');
  });

  it('shows, accepts or rejects tracked changes', async () => {
    const all = (await render(fx.docx(), { changes: 'all' })).host;
    expect(all.querySelector('ins.od-ins').textContent).toBe('this was added');
    expect(all.querySelector('del.od-del').textContent).toBe('this was removed');
    const fin = (await render(fx.docx(), { changes: 'final' })).host;
    expect(fin.textContent).toContain('this was added');
    expect(fin.textContent).not.toContain('this was removed');
    expect(fin.querySelector('ins,del')).toBeNull();
    const orig = (await render(fx.docx(), { changes: 'original' })).host;
    expect(orig.textContent).not.toContain('this was added');
    expect(orig.textContent).toContain('this was removed');
  });

  it('can leave the comment marks out', async () => {
    const { host } = await render(fx.docx(), { comments: false });
    expect(host.querySelector('button.od-cm')).toBeNull();
    expect(host.querySelector('mark.od-cmr')).toBeNull();
  });

  it('drops a text colour that would vanish on the surface it sits on', async () => {
    const dark = (await render(fx.docx(), { surface: '#101010' })).host;
    const black = [...dark.querySelectorAll('span')].find((s) => s.textContent === ' and black-on-dark risk');
    expect(black.style.color).toBe('');
    const light = (await render(fx.docx(), { surface: '#ffffff' })).host;
    const red = [...light.querySelectorAll('span')].find((s) => s.textContent === 'Coloured text');
    expect(red.style.color).not.toBe('');
  });

  it('reads equations as text and reports a macro-enabled file', async () => {
    const { host, model } = await render(fx.docx({ macros: true }));
    expect(host.querySelector('.od-math').textContent).toBe('E=mc2');
    expect(model.macros).toBe(true);
    expect(model.props.title).toBe('Field notes on tides');
  });

  it('raises a calm error for a package with no body', async () => {
    const pkg = pkgmod.localPackage(fflate, new Uint8Array(fx.zip({ 'readme.txt': 'hi' })), zipinfo);
    await expect(docx.loadDocx(pkg)).rejects.toMatchObject({ code: 'corrupt' });
  });
});
