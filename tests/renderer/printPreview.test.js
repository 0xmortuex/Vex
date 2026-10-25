// @vitest-environment jsdom
// Vex's own print preview, the window (js/print-preview-ui.js): the options, what is sent to main, the controls that
// show and hide, a private tab, a page that is a PDF, and a simplified copy. The drawing of pages is real pdf.js and is
// checked in the running app (scripts in the lead's notes); here the render step is replaced.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';

let P;
const printers = [{ name: 'P1', displayName: 'Printer one', isDefault: true }, { name: 'P2', displayName: 'Printer two', isDefault: false }];
const info = (over = {}) => ({ ok: true, id: 'a'.repeat(32), pdf: false, title: 'A page', url: 'https://example.com/a', privacy: '', printers, ...over });

function setup(over = {}) {
  localStorage.clear();
  document.body.innerHTML = '<div id="main-layout"></div>';
  globalThis.VexIcons = fresh(JS + 'vex-icons.js').VexIcons;
  globalThis.ReadingMode = fresh(JS + 'reading-mode.js').ReadingMode;
  globalThis.VexSettingsGroup = undefined;
  window.showToast = vi.fn();
  window.vex = {
    printPreviewOpen: vi.fn(async () => info(over)),
    printPreviewRender: vi.fn(async () => ({ ok: false, error: 'not in this test' })),
    printPreviewSimplify: vi.fn(async () => ({ ok: true })),
    printPreviewPrint: vi.fn(async () => ({ ok: true, pages: 1 })),
    printPreviewSavePdf: vi.fn(async () => ({ ok: true, name: 'a.pdf' })),
    printPreviewClose: vi.fn(async () => ({ ok: true })),
  };
  P = fresh(JS + 'print-preview-ui.js').VexPrintPreview;
  P._schedule = vi.fn();
  return P;
}
const wv = (over = {}) => ({ getWebContentsId: () => 7, getURL: () => 'https://example.com/a', executeJavaScript: vi.fn(), ...over });
const $ = (sel) => document.querySelector(sel);
const set = (sel, value) => { const el = $(sel); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
const tick = (sel) => { const el = $(sel); el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); };

afterEach(() => { P?.close?.(); document.body.innerHTML = ''; });

describe('the options', () => {
  beforeEach(() => setup());
  it('starts from the defaults, with the default printer as the destination', () => {
    const o = P.mergeOptions({}, printers);
    expect(o).toMatchObject({ dest: 'P1', paper: 'A4', landscape: false, perSheet: 1, scaleMode: 'fit', marginMode: 'default', background: false, gray: false, simplify: false });
    expect(P.mergeOptions({}, []).dest).toBe('@pdf');
  });
  it('remembers paper and margins but starts the range, the copies and the simplified page fresh', () => {
    const o = P.mergeOptions({ dest: 'P2', paper: 'Legal', landscape: true, perSheet: 4, marginMode: 'custom', margins: { top: 5, right: 6, bottom: 7, left: 8 }, background: true, gray: true, copies: 9, pagesMode: 'custom', simplify: true }, printers);
    expect(o).toMatchObject({ dest: 'P2', paper: 'Legal', landscape: true, perSheet: 4, marginMode: 'custom', background: true, gray: true, copies: 1, pagesMode: 'all', simplify: false });
    expect(o.margins).toEqual({ top: 5, right: 6, bottom: 7, left: 8 });
  });
  it('drops a remembered printer that is gone and refuses nonsense', () => {
    expect(P.mergeOptions({ dest: 'Gone' }, printers).dest).toBe('P1');
    const o = P.mergeOptions({ paper: 'B9', perSheet: 3, percent: 999, margins: { top: -4 } }, printers);
    expect(o).toMatchObject({ paper: 'A4', perSheet: 1, percent: 100 });
    expect(o.margins.top).toBe(10);
  });
  it('names the first thing wrong', () => {
    const o = P.mergeOptions({}, printers);
    expect(P.problem(o)).toBeNull();
    expect(P.problem({ ...o, copies: '0' })).toMatchObject({ field: 'copies' });
    expect(P.problem({ ...o, copies: '' })).toMatchObject({ field: 'copies' });
    expect(P.problem({ ...o, pagesMode: 'custom', pagesText: ' ' })).toMatchObject({ field: 'pages' });
    expect(P.problem({ ...o, pagesMode: 'custom', pagesText: '1-3, x' })).toMatchObject({ field: 'pages' });
    expect(P.problem({ ...o, pagesMode: 'custom', pagesText: '1-3, 5' })).toBeNull();
    expect(P.problem({ ...o, scaleMode: 'percent', percent: '5' })).toMatchObject({ field: 'percent' });
    expect(P.problem({ ...o, marginMode: 'custom', margins: { ...o.margins, left: '90' } })).toMatchObject({ field: 'margin-left' });
  });
  it('what it sends is what main accepts', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    const o = P.mergeOptions({ marginMode: 'custom' }, printers);
    expect(() => validate('printpreview:render', ['a'.repeat(32), P.toMain(o), false])).not.toThrow();
    expect(() => validate('printpreview:print', ['a'.repeat(32), P.toMain({ ...o, pagesMode: 'custom', pagesText: '1-2' })])).not.toThrow();
    expect(() => validate('printpreview:save-pdf', ['a'.repeat(32), P.toMain(o)])).not.toThrow();
    expect(() => validate('printpreview:open', [7])).not.toThrow();
    expect(() => validate('printpreview:open', ['7'])).toThrow();
    expect(() => validate('printpreview:render', ['nope', P.toMain(o)])).toThrow();
    expect(() => validate('printpreview:simplify', ['a'.repeat(32), null])).not.toThrow();
  });
});

describe('the window', () => {
  it('opens for the page in front, names it, and lists the printers after Save as PDF', async () => {
    setup();
    await P.open(wv());
    expect(window.vex.printPreviewOpen).toHaveBeenCalledWith(7);
    const root = $('#vpp-overlay');
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect($('#vpp-doc').textContent).toBe('A page');
    const opts = [...$('#vpp-dest').options].map(o => o.value);
    expect(opts).toEqual(['@pdf', 'P1', 'P2', '@system']);
    expect($('#vpp-dest').value).toBe('P1');
    expect($('#vpp-primary').textContent).toBe('Print');
    expect($('#vpp-save').hidden).toBe(false);
    expect($('.vpp-private').hidden).toBe(true);
    expect(P._schedule).toHaveBeenCalled();
  });

  it('every control has a name for a screen reader', async () => {
    setup();
    await P.open(wv());
    for (const el of document.querySelectorAll('#vpp-overlay :is(select, input, button)')) {
      const named = el.getAttribute('aria-label') || el.getAttribute('title') || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label') || el.textContent.trim();
      expect(named, el.outerHTML.slice(0, 90)).toBeTruthy();
    }
  });

  it('Save as PDF makes the big button say so and hides the copies and the second button', async () => {
    setup();
    await P.open(wv());
    set('#vpp-dest', '@pdf');
    expect($('#vpp-primary').textContent).toBe('Save as PDF…');
    expect($('#vpp-save').hidden).toBe(true);
    expect($('#vpp-copies-row').hidden).toBe(true);
    set('#vpp-dest', '@system');
    expect($('#vpp-primary').textContent).toBe('Continue in the Windows dialog');
    set('#vpp-dest', 'P2');
    expect($('#vpp-copies-row').hidden).toBe(false);
  });

  it('shows the custom pages, scale and margin controls only when asked, and turns the header off with no margin', async () => {
    setup();
    await P.open(wv());
    expect($('#vpp-pages-text-row').hidden).toBe(true);
    set('#vpp-pages', 'custom');
    expect($('#vpp-pages-text-row').hidden).toBe(false);
    expect($('#vpp-percent-row').hidden).toBe(true);
    set('#vpp-scale', 'percent');
    expect($('#vpp-percent-row').hidden).toBe(false);
    expect($('#vpp-margin-row').hidden).toBe(true);
    set('#vpp-margins', 'custom');
    expect($('#vpp-margin-row').hidden).toBe(false);
    set('#vpp-margins', 'none');
    expect([...document.querySelectorAll('#vpp-hf input')].every(i => i.disabled)).toBe(true);
    expect($('#vpp-hf-note').hidden).toBe(false);
    set('#vpp-margins', 'default');
    expect([...document.querySelectorAll('#vpp-hf input')].some(i => i.disabled)).toBe(false);
  });

  it('a change of option asks for a new picture after a pause, but a change of printer or copies does not', async () => {
    setup();
    await P.open(wv());
    P._schedule.mockClear();
    set('#vpp-paper', 'Letter');
    expect(P._schedule).toHaveBeenCalledTimes(1);
    P._schedule.mockClear();
    set('#vpp-dest', 'P2');
    set('#vpp-copies', '3');
    expect(P._schedule).not.toHaveBeenCalled();
    expect(P.s.o.copies).toBe('3');
  });

  it('a bad number is shown beside its field and nothing is rendered for it', async () => {
    setup();
    await P.open(wv());
    P._schedule.mockClear();
    set('#vpp-pages', 'custom');
    P._schedule.mockClear();
    const t = $('#vpp-pages-text');
    t.value = '1-3, x';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    expect($('#vpp-pages-err').hidden).toBe(false);
    expect($('#vpp-pages-err').textContent).toBe('Write the pages, for example 1-3, 5');
    expect(t.getAttribute('aria-invalid')).toBe('true');
    expect(P._schedule).not.toHaveBeenCalled();
  });

  it('Print sends the chosen options to main for the chosen printer, then closes', async () => {
    setup();
    await P.open(wv());
    set('#vpp-dest', 'P2'); set('#vpp-copies', '2'); set('#vpp-paper', 'Legal'); set('#vpp-orient', 'landscape'); set('#vpp-persheet', '4');
    set('#vpp-colour', 'gray'); tick('#vpp-bg'); tick('#vpp-hf-title');
    $('#vpp-primary').click();
    await vi.waitFor(() => expect(window.vex.printPreviewPrint).toHaveBeenCalled());
    const [id, sent] = window.vex.printPreviewPrint.mock.calls[0];
    expect(id).toBe('a'.repeat(32));
    expect(sent).toMatchObject({ dest: 'P2', copies: 2, paper: 'Legal', landscape: true, perSheet: 4, gray: true, background: true });
    expect(sent.headerFooter).toEqual({ title: true, url: false, date: false, pages: false });
    await vi.waitFor(() => expect($('#vpp-overlay')).toBeNull());
    expect(window.vex.printPreviewClose).toHaveBeenCalledWith('a'.repeat(32));
    expect(window.showToast).toHaveBeenCalledWith('Sent to the printer');
  });

  it('Save as PDF… asks main to save, and a cancelled dialog keeps the window open', async () => {
    setup();
    await P.open(wv());
    window.vex.printPreviewSavePdf.mockResolvedValueOnce({ ok: false, cancelled: true });
    $('#vpp-save').click();
    await vi.waitFor(() => expect(window.vex.printPreviewSavePdf).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect($('#vpp-save').disabled).toBe(false));
    expect($('#vpp-overlay')).not.toBeNull();
    $('#vpp-save').click();
    await vi.waitFor(() => expect($('#vpp-overlay')).toBeNull());
    expect(window.showToast).toHaveBeenCalledWith('PDF saved');
  });

  it('an error from main is said in the window and the window stays', async () => {
    setup();
    await P.open(wv());
    window.vex.printPreviewPrint.mockResolvedValueOnce({ ok: false, error: 'That printer is no longer available' });
    $('#vpp-primary').click();
    await vi.waitFor(() => expect($('#vpp-status').textContent).toBe('That printer is no longer available'));
    expect($('#vpp-status').classList.contains('is-error')).toBe(true);
    expect($('#vpp-overlay')).not.toBeNull();
  });

  it('Escape and the close button close it and give the focus back', async () => {
    setup();
    const opener = document.createElement('button');
    document.body.append(opener); opener.focus();
    await P.open(wv());
    $('#vpp-overlay').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect($('#vpp-overlay')).toBeNull();
    expect(document.activeElement).toBe(opener);
    await P.open(wv());
    $('.vpp-x').click();
    expect($('#vpp-overlay')).toBeNull();
  });

  it('pressing Print again while it is open does not open a second one', async () => {
    setup();
    await P.open(wv());
    await P.open(wv());
    expect(document.querySelectorAll('#vpp-overlay').length).toBe(1);
    expect(window.vex.printPreviewOpen).toHaveBeenCalledTimes(1);
  });

  it('says so when there is no page, or main refuses', async () => {
    setup();
    await P.open(null);
    expect(window.showToast).toHaveBeenCalledWith('Open a page to print first');
    window.vex.printPreviewOpen.mockResolvedValueOnce({ ok: false, error: 'That tab has closed' });
    await P.open(wv());
    expect(window.showToast).toHaveBeenCalledWith('Could not print: That tab has closed', 'error');
    expect($('#vpp-overlay')).toBeNull();
  });
});

describe('a private or Tor tab', () => {
  it('says nothing about it is kept, and remembers no option', async () => {
    setup({ privacy: 'tor' });
    localStorage.setItem(P.PREF, JSON.stringify({ options: { paper: 'Legal' } }));
    await P.open(wv());
    expect($('.vpp-private').hidden).toBe(false);
    expect($('.vpp-private').textContent).toBe('Tor tab: nothing about this print is kept');
    expect($('#vpp-paper').value).toBe('A4');                 // the saved Legal is not even read
    set('#vpp-paper', 'A3');
    expect(JSON.parse(localStorage.getItem(P.PREF)).options.paper).toBe('Legal');
  });
  it('an ordinary tab remembers the paper for next time', async () => {
    setup();
    await P.open(wv());
    set('#vpp-paper', 'A3'); tick('#vpp-bg');
    expect(JSON.parse(localStorage.getItem(P.PREF)).options).toMatchObject({ paper: 'A3', background: true });
    P.close();
    await P.open(wv());
    expect($('#vpp-paper').value).toBe('A3');
    expect($('#vpp-bg').checked).toBe(true);
  });
});

describe('a page that is a PDF', () => {
  it('explains, and offers the viewer\'s own print', async () => {
    setup({ pdf: true, id: undefined });
    window.WebviewManager = { systemPrint: vi.fn() };
    const w = wv();
    await P.open(w);
    expect($('.vpp-pdf').textContent).toContain('This page is a PDF');
    expect($('#vpp-form')).toBeNull();
    [...document.querySelectorAll('.vpp-pdf button')].find(b => b.textContent === 'Print with the PDF viewer').click();
    expect(window.WebviewManager.systemPrint).toHaveBeenCalledWith(w);
    expect($('#vpp-overlay')).toBeNull();
    delete window.WebviewManager;
  });
});

describe('Simplify page', () => {
  const article = { title: 'Harbour', byline: 'A. Writer', siteName: 'Example News', lang: 'en',
    blocks: [{ tag: 'H1', runs: [{ t: 'Harbour' }] }, { tag: 'P', runs: [{ t: 'First <b>paragraph</b> & more.' }, { a: 'https://example.com/x', c: [{ t: 'a link' }] }] }, { tag: 'IMG', src: 'javascript:alert(1)' }] };
  it('builds a plain page from the extracted article, escaped, without the title twice', () => {
    setup();
    const html = P.buildSimplified(article, 'https://example.com/a');
    expect(html).toContain('<h1>Harbour</h1>');
    expect(html.match(/<h[12]>Harbour<\/h[12]>/g)).toHaveLength(1);
    expect(html).toContain('First &lt;b&gt;paragraph&lt;/b&gt; &amp; more.');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('Example News');
    expect(html).not.toMatch(/<script/i);
  });
  it('refuses a page with nothing to read', () => {
    setup();
    expect(() => P.buildSimplified({ title: 'x', blocks: [] }, 'https://x.test')).toThrow('Nothing readable was found on this page');
  });
  it('turning it on reads the page, sends the markup to main and renders again', async () => {
    setup();
    const w = wv({ executeJavaScript: vi.fn(async () => article) });
    await P.open(w);
    P._schedule.mockClear();
    tick('#vpp-simplify');
    await vi.waitFor(() => expect(window.vex.printPreviewSimplify).toHaveBeenCalled());
    expect(window.vex.printPreviewSimplify.mock.calls[0][1]).toContain('<h1>Harbour</h1>');
    await vi.waitFor(() => expect(P._schedule).toHaveBeenCalled());
    tick('#vpp-simplify');
    await vi.waitFor(() => expect(window.vex.printPreviewSimplify).toHaveBeenLastCalledWith('a'.repeat(32), null));
  });
  it('a page with nothing to read leaves the box unticked and says why', async () => {
    setup();
    const w = wv({ executeJavaScript: vi.fn(async () => ({ title: 'x', blocks: [] })) });
    await P.open(w);
    tick('#vpp-simplify');
    await vi.waitFor(() => expect($('#vpp-status').textContent).toBe('Nothing readable was found on this page'));
    expect($('#vpp-simplify').checked).toBe(false);
    expect(window.vex.printPreviewSimplify).not.toHaveBeenCalled();
  });
});

describe('Ctrl+P', () => {
  it('opens the preview through the web view, and the Windows dialog when it is switched off', () => {
    setup();
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
    expect(src).toMatch(/printPage\(wv = this\.getActiveWebview\(\)\)[\s\S]*VexPrintPreview\.open\(wv\)[\s\S]*this\.systemPrint\(wv\)/);
    expect(P.enabled()).toBe(true);
    P.setEnabled(false);
    expect(P.enabled()).toBe(false);
    P.setEnabled(true);
    expect(P.enabled()).toBe(true);
  });
});
