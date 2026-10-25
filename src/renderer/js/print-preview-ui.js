// === Vex's own print preview (the window) =====================================
//
// Ctrl+P and Print… used to open the plain Windows dialog with no picture of the page. This draws a preview of
// our own: the pages as they will print on a neutral desk, the options in a column beside it.
//
//   * The page is turned into a PDF in the main process (webContents.printToPDF, src/main/print-preview.js) with
//     the paper, margins, scale, background and header the options say, and this window shows that file with
//     pdf.js, so what you see is the file that is saved. A change of option is applied after a short pause, and
//     pages are drawn as they scroll into view, so a very long page does not freeze the window.
//   * Print sends the same choices to webContents.print; Save as PDF… writes the rendered file where the person
//     picks in a Save dialog. This window never names a path.
//   * Simplify page uses the reading-mode extraction (js/reading-mode.js): the article is rebuilt as plain
//     markup and main prints that instead of the page. Nothing leaves the computer.
//   * A page that is itself a PDF is not rendered here (Chromium's viewer prints it): the window says so and
//     offers the viewer's own print. A private or Tor tab works the same and remembers nothing.
//
// The last-used paper, margins, scale and so on are kept in vex.printPreview.prefs, except from a private or Tor tab.
// This file is loaded after start-up (js/lazy-boot.js), not as a blocking script.

const VexPrintPreview = {
  PREF: 'vex.printPreview.prefs',      // { enabled, options }
  FEATURE: 'print-preview',
  PDF: '@pdf',
  SYSTEM: '@system',
  ZOOMS: [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2],
  PER_SHEET: [1, 2, 4, 6, 9, 16],
  PAPERS: ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'],
  DELAY: 350,
  s: null,                              // the open preview

  DEFAULTS: Object.freeze({
    dest: '', copies: 1, pagesMode: 'all', pagesText: '', current: 1, perSheet: 1, landscape: false, paper: 'A4',
    scaleMode: 'fit', percent: 100, marginMode: 'default', margins: { top: 10, right: 10, bottom: 10, left: 10 },
    background: false, gray: false, simplify: false, hf: { title: false, url: false, date: false, pages: false },
  }),

  // ---- the switch and the remembered options --------------------------------------------------------
  _read() {
    let raw;
    try { raw = localStorage.getItem(this.PREF); } catch (err) { throw new Error('The print preview settings could not be read: ' + err.message, { cause: err }); }
    if (!raw) return {};
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; }
    catch (err) { throw new Error('The print preview settings are not readable: ' + err.message, { cause: err }); }
  },
  enabled() { return this._read().enabled !== false; },
  setEnabled(on) {
    const cur = this._read();
    try { localStorage.setItem(this.PREF, JSON.stringify({ ...cur, enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },
  // Only what is about the paper, not about this page: the range, the copies and the simplified page start fresh.
  remembered() {
    const o = this._read().options;
    return o && typeof o === 'object' ? o : {};
  },
  remember(options) {
    const keep = { dest: options.dest, perSheet: options.perSheet, landscape: options.landscape, paper: options.paper, scaleMode: options.scaleMode, percent: options.percent,
      marginMode: options.marginMode, margins: options.margins, background: options.background, gray: options.gray, hf: options.hf };
    try { localStorage.setItem(this.PREF, JSON.stringify({ ...this._read(), options: keep })); }
    catch (err) { throw new Error('Could not remember the print options: ' + err.message, { cause: err }); }
  },

  // ---- pure: options ---------------------------------------------------------------------------------
  mergeOptions(saved, printers) {
    const d = this.DEFAULTS, s = saved && typeof saved === 'object' ? saved : {};
    const num = (v, lo, hi, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback; };
    const m = s.margins && typeof s.margins === 'object' ? s.margins : {};
    const hf = s.hf && typeof s.hf === 'object' ? s.hf : {};
    const names = (printers || []).map(p => p.name);
    let dest = typeof s.dest === 'string' ? s.dest : '';
    if (dest !== this.PDF && dest !== this.SYSTEM && !names.includes(dest)) dest = '';
    if (!dest) { const def = (printers || []).find(p => p.isDefault); dest = def ? def.name : this.PDF; }
    return {
      dest, copies: 1, pagesMode: 'all', pagesText: '', current: 1,
      perSheet: this.PER_SHEET.includes(Number(s.perSheet)) ? Number(s.perSheet) : d.perSheet,
      landscape: s.landscape === true,
      paper: this.PAPERS.includes(s.paper) ? s.paper : d.paper,
      scaleMode: s.scaleMode === 'percent' ? 'percent' : 'fit',
      percent: num(s.percent, 10, 200, d.percent),
      marginMode: ['default', 'none', 'custom'].includes(s.marginMode) ? s.marginMode : 'default',
      margins: { top: num(m.top, 0, 50, 10), right: num(m.right, 0, 50, 10), bottom: num(m.bottom, 0, 50, 10), left: num(m.left, 0, 50, 10) },
      background: s.background === true, gray: s.gray === true, simplify: false,
      hf: { title: hf.title === true, url: hf.url === true, date: hf.date === true, pages: hf.pages === true },
    };
  },

  // The first thing wrong with the options, as { field, message }, or null. Same wording main would use.
  problem(o) {
    const whole = (v) => Number.isInteger(Number(v)) && String(v).trim() !== '';
    if (!whole(o.copies) || o.copies < 1 || o.copies > 999) return { field: 'copies', message: 'Copies is a whole number from 1 to 999' };
    if (o.pagesMode === 'custom' && !String(o.pagesText || '').trim()) return { field: 'pages', message: 'Write the pages, for example 1-3, 5' };
    if (o.pagesMode === 'custom' && !/^[\d\s,\-]+$/.test(o.pagesText)) return { field: 'pages', message: 'Write the pages, for example 1-3, 5' };
    if (o.scaleMode === 'percent' && !(Number(o.percent) >= 10 && Number(o.percent) <= 200)) return { field: 'percent', message: 'Scale is a percentage from 10 to 200' };
    if (o.marginMode === 'custom') for (const side of ['top', 'right', 'bottom', 'left']) {
      const v = Number(o.margins[side]);
      if (!(Number.isFinite(v) && v >= 0 && v <= 50)) return { field: 'margin-' + side, message: 'A margin is from 0 to 50 mm' };
    }
    return null;
  },

  // The options main wants.
  toMain(o) {
    return {
      dest: o.dest, copies: Math.round(Number(o.copies) || 1),
      pages: { mode: o.pagesMode, text: String(o.pagesText || ''), current: Math.max(1, Math.round(Number(o.current) || 1)) },
      perSheet: o.perSheet, landscape: !!o.landscape, paper: o.paper,
      scale: { mode: o.scaleMode, percent: Number(o.percent) || 100 },
      margins: { mode: o.marginMode, top: Number(o.margins.top), right: Number(o.margins.right), bottom: Number(o.margins.bottom), left: Number(o.margins.left) },
      background: !!o.background, gray: !!o.gray,
      headerFooter: { title: !!o.hf.title, url: !!o.hf.url, date: !!o.hf.date, pages: !!o.hf.pages },
    };
  },

  // The simplified page: the reading-mode article as plain markup with its own quiet style. `article` is the plain data
  // reading mode extracts; ReadingMode._render escapes everything, so no script or handler of the page comes along.
  buildSimplified(article, url) {
    if (typeof ReadingMode === 'undefined') throw new Error('Reading mode is not available, so the page cannot be simplified');
    const title = String((article && article.title) || '');
    const blocks = ReadingMode._dropTitleHeading(article && article.blocks, title);
    const body = ReadingMode._render(blocks);
    if (!body.trim()) throw new Error('Nothing readable was found on this page');
    const esc = (s) => ReadingMode._esc(s);
    const meta = [article.siteName, article.byline].filter(Boolean).map(s => esc(String(s).slice(0, 200)));
    const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(article.lang || '')) ? article.lang : '';
    const css = 'html{font-size:12pt}body{margin:0;font-family:Georgia,"Times New Roman",serif;line-height:1.55;color:#111;background:#fff}'
      + 'h1{font-size:22pt;line-height:1.2;margin:0 0 6pt}h2{font-size:16pt;margin:18pt 0 6pt}h3{font-size:13.5pt;margin:14pt 0 4pt}h4{font-size:12pt;margin:12pt 0 4pt}'
      + 'p,ul,ol,dl,pre,figure,table,blockquote{margin:0 0 9pt}.meta{font:10pt "Segoe UI",Arial,sans-serif;color:#444;margin:0 0 14pt}'
      + 'img{max-width:100%;height:auto;break-inside:avoid}figure{break-inside:avoid}figcaption{font-size:10pt;color:#444}'
      + 'a{color:#111;text-decoration:underline}blockquote{border-left:3pt solid #999;padding-left:10pt;color:#222}'
      + 'pre{white-space:pre-wrap;word-break:break-word;font:10pt Consolas,monospace;background:#f3f3f3;padding:6pt}code{font:10pt Consolas,monospace}'
      + 'table{border-collapse:collapse;width:100%}th,td{border:0.5pt solid #888;padding:3pt 5pt;text-align:left;vertical-align:top}'
      + 'h1,h2,h3,h4{break-after:avoid}tr{break-inside:avoid}';
    return '<!DOCTYPE html><html' + (lang ? ' lang="' + lang + '"' : '') + (article.dir === 'rtl' ? ' dir="rtl"' : '') + '><head><meta charset="UTF-8">'
      + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: http: data:; style-src \'unsafe-inline\'">'
      + '<title>' + esc(title) + '</title><style>' + css + '</style></head><body>'
      + (title ? '<h1>' + esc(title) + '</h1>' : '') + '<p class="meta">' + meta.concat([esc(String(url || '').slice(0, 300))]).filter(Boolean).join(' &middot; ') + '</p>' + body + '</body></html>';
  },

  // ---- opening ----------------------------------------------------------------------------------------
  async open(wv = (typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null)) {
    if (this.s) { this.s.root.querySelector('#vpp-dest, .vpp-x')?.focus(); return; }
    if (!wv || typeof wv.getWebContentsId !== 'function') { window.showToast?.('Open a page to print first'); return; }
    if (!window.vex || typeof window.vex.printPreviewOpen !== 'function') throw new Error('The print preview is not available here');
    let wcId;
    try { wcId = wv.getWebContentsId(); }
    catch (err) { window.showToast?.('Could not print: ' + (err.message || err), 'error'); return; }
    const r = await window.vex.printPreviewOpen(wcId);
    if (!r || !r.ok) { window.showToast?.('Could not print: ' + ((r && r.error) || 'no answer'), 'error'); return; }
    const opener = document.activeElement;
    if (r.pdf) { this._buildPdf(wv, r, opener); return; }
    this._build(wv, r, opener);
    this._schedule(0);
  },

  _el(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  },
  _icon(name, size = 16) { return typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : ''; },
  _iconBtn(cls, icon, label, text) {
    const b = this._el('button', { type: 'button', class: cls, 'aria-label': label, title: label });
    b.innerHTML = this._icon(icon, 16) + (text ? '<span></span>' : '');
    if (text) b.lastChild.textContent = text;
    return b;
  },

  _mount(root, opener) {
    document.body.appendChild(root);
    this._place();
    this._onResize = () => { this._place(); this._relayout(); };
    window.addEventListener('resize', this._onResize);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); this.close(); } });
    this.s.opener = opener;
  },
  _place() {
    const main = document.getElementById('main-layout');
    if (main) document.documentElement.style.setProperty('--ai-top', Math.max(0, Math.round(main.getBoundingClientRect().top)) + 'px');
  },

  // A page that is itself a PDF.
  _buildPdf(wv, info, opener) {
    const close = this._iconBtn('vpp-icon-btn vpp-x', 'x', 'Close (Esc)');
    const head = this._el('header', { class: 'vpp-head' }, this._el('span', { class: 'vpp-mark', 'aria-hidden': 'true' }), this._el('h2', { class: 'vpp-title', id: 'vpp-title', text: 'Print' }), this._el('span', { class: 'vpp-spacer' }), close);
    head.querySelector('.vpp-mark').innerHTML = this._icon('printer', 18);
    const ico = this._el('span', { class: 'vpp-pdf-ico', 'aria-hidden': 'true' });
    ico.innerHTML = this._icon('file', 24);
    const viewerBtn = this._el('button', { type: 'button', class: 'vpp-btn is-primary', text: 'Print with the PDF viewer' });
    const closeBtn = this._el('button', { type: 'button', class: 'vpp-btn', text: 'Close' });
    const body = this._el('div', { class: 'vpp-pdf' }, ico,
      this._el('strong', { text: 'This page is a PDF' }),
      this._el('p', { class: 'vpp-fine', text: 'The PDF viewer prints it with its own options (pages, copies, paper size), so the page cannot be previewed here.' }),
      this._el('div', { class: 'vpp-actions-row' }, viewerBtn, closeBtn));
    const root = this._el('div', { class: 'vpp-overlay', id: 'vpp-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vpp-title' }, head, this._el('div', { class: 'vpp-scroll' }, body));
    this.s = { root, wv, id: null, pdf: true };
    this._mount(root, opener);
    close.addEventListener('click', () => this.close());
    closeBtn.addEventListener('click', () => this.close());
    viewerBtn.addEventListener('click', () => { this.close(); this._systemPrint(wv); });
    viewerBtn.focus();
  },

  _systemPrint(wv) {
    if (typeof WebviewManager === 'undefined' || typeof WebviewManager.systemPrint !== 'function') throw new Error('The Windows print dialog is not available here');
    WebviewManager.systemPrint(wv);
  },

  // ---- the window ---------------------------------------------------------------------------------------
  _build(wv, info, opener) {
    const o = this.mergeOptions(info.privacy ? {} : this.remembered(), info.printers);
    const E = (tag, attrs, ...kids) => this._el(tag, attrs, ...kids);
    const close = this._iconBtn('vpp-icon-btn vpp-x', 'x', 'Close (Esc)');
    const mark = E('span', { class: 'vpp-mark', 'aria-hidden': 'true' });
    mark.innerHTML = this._icon('printer', 18);
    const priv = E('span', { class: 'vpp-private', hidden: info.privacy ? null : true });
    priv.innerHTML = this._icon('lock', 13) + '<span></span>';
    priv.lastChild.textContent = info.privacy === 'tor' ? 'Tor tab: nothing about this print is kept' : 'Private tab: nothing about this print is kept';
    const head = E('header', { class: 'vpp-head' }, mark, E('h2', { class: 'vpp-title', id: 'vpp-title', text: 'Print' }),
      E('span', { class: 'vpp-doc', id: 'vpp-doc', title: info.title || info.url }), E('span', { class: 'vpp-count', id: 'vpp-count', role: 'status' }), E('span', { class: 'vpp-count', id: 'vpp-sheets', role: 'status' }), E('span', { class: 'vpp-spacer' }), priv, close);
    head.querySelector('#vpp-doc').textContent = info.title || info.url || '';

    // The desk.
    const pageno = E('span', { class: 'vpp-pageno', id: 'vpp-pageno', 'aria-live': 'polite' });
    const zout = this._iconBtn('vpp-icon-btn', 'minus', 'Zoom out');
    const zval = E('span', { class: 'vpp-zoomval', id: 'vpp-zoomval' });
    const zin = this._iconBtn('vpp-icon-btn', 'plus', 'Zoom in');
    const zfit = this._iconBtn('vpp-icon-btn is-text', 'maximize', 'Fit the page to the width', 'Fit');
    const refresh = this._iconBtn('vpp-icon-btn', 'refresh', 'Refresh the preview');
    const deskbar = E('div', { class: 'vpp-deskbar' }, pageno, zout, zval, zin, zfit, refresh);
    const scroll = E('div', { class: 'vpp-scroll', id: 'vpp-scroll', tabindex: '0', role: 'region', 'aria-label': 'Pages as they will print' });
    const state = E('div', { class: 'vpp-state', id: 'vpp-state', hidden: true });
    const desk = E('section', { class: 'vpp-desk', 'aria-label': 'Preview' }, deskbar, scroll, state);

    // The options.
    const optionEl = (value, label, selected) => E('option', { value, text: label, selected: selected ? true : null });
    const select = (id, items, value) => { const s = E('select', { id }); for (const [v, l] of items) s.append(optionEl(v, l, String(v) === String(value))); return s; };
    const row = (label, control, id, extra) => E('div', { class: 'vpp-row', id: id ? id + '-row' : null }, E('label', { for: control.id, text: label }), control, extra || null);
    const err = (id) => E('p', { class: 'vpp-error', id, role: 'alert', hidden: true });
    const check = (id, label, checked) => {
      const i = E('input', { type: 'checkbox', id }); i.checked = !!checked;
      return E('label', { class: 'vpp-check', for: id }, i, E('span', { text: label }));
    };
    const num = (id, value, min, max, label) => { const i = E('input', { type: 'number', id, min, max, step: '1', 'aria-label': label }); i.value = String(value); return i; };

    const destSel = E('select', { id: 'vpp-dest' });
    destSel.append(optionEl(this.PDF, 'Save as PDF', o.dest === this.PDF));
    for (const p of info.printers) destSel.append(E('option', { value: p.name, text: p.displayName || p.name, selected: o.dest === p.name ? true : null }));
    destSel.append(optionEl(this.SYSTEM, 'Windows print dialog…', o.dest === this.SYSTEM));

    const pagesSel = select('vpp-pages', [['all', 'All pages'], ['current', 'Current page'], ['custom', 'Pages…']], o.pagesMode);
    const pagesText = E('input', { type: 'text', id: 'vpp-pages-text', placeholder: 'e.g. 1-3, 5', 'aria-label': 'Pages to print', autocomplete: 'off', spellcheck: 'false' });
    const sheetSel = select('vpp-persheet', this.PER_SHEET.map(n => [n, n === 1 ? '1 page' : n + ' pages']), o.perSheet);
    const orient = select('vpp-orient', [['portrait', 'Portrait'], ['landscape', 'Landscape']], o.landscape ? 'landscape' : 'portrait');
    const paper = select('vpp-paper', this.PAPERS.map(p => [p, p]), o.paper);
    const scaleSel = select('vpp-scale', [['fit', 'Fit to width'], ['percent', 'Custom']], o.scaleMode);
    const pct = num('vpp-percent', o.percent, 10, 200, 'Scale in percent');
    const marginSel = select('vpp-margins', [['default', 'Default'], ['none', 'None'], ['custom', 'Custom']], o.marginMode);
    const mg = (side, label) => E('label', { for: 'vpp-m-' + side }, E('span', { text: label }), num('vpp-m-' + side, o.margins[side], 0, 50, label + ' margin in millimetres'));
    const marginGrid = E('div', { class: 'vpp-margins', id: 'vpp-margin-grid', role: 'group', 'aria-label': 'Margins in millimetres' }, mg('top', 'Top'), mg('right', 'Right'), mg('bottom', 'Bottom'), mg('left', 'Left'));
    const colour = select('vpp-colour', [['color', 'Colour'], ['gray', 'Black and white']], o.gray ? 'gray' : 'color');
    const copies = num('vpp-copies', o.copies, 1, 999, 'Copies');

    const hfBox = E('div', { class: 'vpp-checks-nest', id: 'vpp-hf', role: 'group', 'aria-label': 'Headers and footers' },
      check('vpp-hf-title', 'Page title', o.hf.title), check('vpp-hf-url', 'Address', o.hf.url), check('vpp-hf-date', 'Date', o.hf.date), check('vpp-hf-pages', 'Page numbers', o.hf.pages));

    const canSimplify = typeof ReadingMode !== 'undefined' && !ReadingMode.isReader(wv);
    const simplify = check('vpp-simplify', 'Simplify page', false);
    if (!canSimplify) { simplify.querySelector('input').disabled = true; simplify.classList.add('is-off'); }

    const form = E('div', { class: 'vpp-form', id: 'vpp-form' },
      E('div', { class: 'vpp-group', role: 'group', 'aria-labelledby': 'vpp-g1' }, E('h3', { class: 'vpp-group-title', id: 'vpp-g1', text: 'Destination' }),
        row('Printer', destSel, 'vpp-dest'), row('Copies', copies, 'vpp-copies'), err('vpp-copies-err')),
      E('div', { class: 'vpp-group', role: 'group', 'aria-labelledby': 'vpp-g2' }, E('h3', { class: 'vpp-group-title', id: 'vpp-g2', text: 'Pages' }),
        row('Pages', pagesSel, 'vpp-pages'), E('div', { class: 'vpp-sub', id: 'vpp-pages-text-row' }, pagesText), err('vpp-pages-err'), row('Pages per sheet', sheetSel, 'vpp-persheet')),
      E('div', { class: 'vpp-group', role: 'group', 'aria-labelledby': 'vpp-g3' }, E('h3', { class: 'vpp-group-title', id: 'vpp-g3', text: 'Layout' }),
        row('Orientation', orient, 'vpp-orient'), row('Paper size', paper, 'vpp-paper'), row('Scale', scaleSel, 'vpp-scale'),
        E('div', { class: 'vpp-sub', id: 'vpp-percent-row' }, pct), err('vpp-percent-err'), E('p', { class: 'vpp-fine', id: 'vpp-fit-note', role: 'status' }),
        row('Margins', marginSel, 'vpp-margins'), E('div', { class: 'vpp-sub', id: 'vpp-margin-row' }, marginGrid), err('vpp-margin-err')),
      E('div', { class: 'vpp-group', role: 'group', 'aria-labelledby': 'vpp-g4' }, E('h3', { class: 'vpp-group-title', id: 'vpp-g4', text: 'Options' }),
        check('vpp-bg', 'Background graphics', o.background), row('Colour', colour, 'vpp-colour'),
        E('span', { class: 'vpp-lbl', id: 'vpp-hf-label', text: 'Headers and footers' }), hfBox, E('p', { class: 'vpp-fine', id: 'vpp-hf-note', hidden: true, text: 'Headers and footers need a margin.' }),
        simplify, E('p', { class: 'vpp-fine', id: 'vpp-simplify-note', text: canSimplify ? 'Keeps the article and drops menus, ads and other clutter.' : 'This page is already in reading mode, or reading mode is not available.' })));

    const primary = E('button', { type: 'button', class: 'vpp-btn is-primary', id: 'vpp-primary' });
    const saveBtn = E('button', { type: 'button', class: 'vpp-btn', id: 'vpp-save', text: 'Save as PDF…' });
    const cancel = E('button', { type: 'button', class: 'vpp-btn', id: 'vpp-cancel', text: 'Cancel' });
    const status = E('p', { class: 'vpp-status', id: 'vpp-status', role: 'status' });
    const actions = E('div', { class: 'vpp-actions' }, status, E('div', { class: 'vpp-actions-row' }, primary, saveBtn, cancel));
    const options = E('aside', { class: 'vpp-options', 'aria-label': 'Print options' }, form, actions);

    const root = E('div', { class: 'vpp-overlay', id: 'vpp-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vpp-title' }, head, E('div', { class: 'vpp-body' }, desk, options));
    this.s = { root, wv, id: info.id, privacy: info.privacy, info, o, seq: 0, zoom: 1, total: 0, sheets: 0, pageMap: [], doc: null, busy: false, timer: null, shown: 0, rendered: new Set(), wanted: new Set(), saveTimer: null };
    this._mount(root, opener);
    this._sync();

    close.addEventListener('click', () => this.close());
    cancel.addEventListener('click', () => this.close());
    zout.addEventListener('click', () => this._zoom(-1));
    zin.addEventListener('click', () => this._zoom(1));
    zfit.addEventListener('click', () => { this.s.zoom = 1; this._relayout(); });
    refresh.addEventListener('click', () => this._schedule(0, true));
    primary.addEventListener('click', () => this._act(this.s.o.dest === this.PDF ? 'save' : 'print'));
    saveBtn.addEventListener('click', () => this._act('save'));
    form.addEventListener('input', (e) => this._changed(e));
    form.addEventListener('change', (e) => this._changed(e));
    scroll.addEventListener('scroll', () => this._tracking());
    (root.querySelector('#vpp-dest') || primary).focus();
  },

  $(sel) { return this.s ? this.s.root.querySelector(sel) : null; },

  // The options as the controls show them.
  _readControls() {
    const v = (id) => this.$('#' + id);
    const o = this.s.o;
    o.dest = v('vpp-dest').value;
    o.copies = v('vpp-copies').value;
    o.pagesMode = v('vpp-pages').value;
    o.pagesText = v('vpp-pages-text').value;
    o.perSheet = Number(v('vpp-persheet').value);
    o.landscape = v('vpp-orient').value === 'landscape';
    o.paper = v('vpp-paper').value;
    o.scaleMode = v('vpp-scale').value;
    o.percent = v('vpp-percent').value;
    o.marginMode = v('vpp-margins').value;
    for (const side of ['top', 'right', 'bottom', 'left']) o.margins[side] = v('vpp-m-' + side).value;
    o.gray = v('vpp-colour').value === 'gray';
    o.background = v('vpp-bg').checked;
    o.simplify = v('vpp-simplify').checked;
    for (const k of ['title', 'url', 'date', 'pages']) o.hf[k] = v('vpp-hf-' + k).checked;
  },

  // Which rows show, which are off, what the buttons say.
  _sync() {
    const o = this.s.o, show = (id, on) => { const el = this.$('#' + id); if (el) el.hidden = !on; };
    const real = o.dest !== this.PDF && o.dest !== this.SYSTEM;
    show('vpp-copies-row', real);
    show('vpp-pages-text-row', o.pagesMode === 'custom');
    show('vpp-percent-row', o.scaleMode === 'percent');
    show('vpp-margin-row', o.marginMode === 'custom');
    const none = o.marginMode === 'none';
    this.$('#vpp-hf').querySelectorAll('input').forEach(i => { i.disabled = none; i.closest('.vpp-check').classList.toggle('is-off', none); });
    show('vpp-hf-note', none);
    const primary = this.$('#vpp-primary');
    primary.textContent = o.dest === this.PDF ? 'Save as PDF…' : (o.dest === this.SYSTEM ? 'Continue in the Windows dialog' : 'Print');
    this.$('#vpp-save').hidden = o.dest === this.PDF;
  },

  _fieldError(field, message) {
    const map = { copies: 'vpp-copies-err', pages: 'vpp-pages-err', percent: 'vpp-percent-err' };
    for (const id of ['vpp-copies-err', 'vpp-pages-err', 'vpp-percent-err', 'vpp-margin-err']) { const el = this.$('#' + id); if (el) { el.hidden = true; el.textContent = ''; } }
    for (const inp of this.s.root.querySelectorAll('[aria-invalid]')) inp.removeAttribute('aria-invalid');
    if (!field) return;
    const errId = map[field] || (field.startsWith('margin-') ? 'vpp-margin-err' : null);
    const el = errId ? this.$('#' + errId) : null;
    if (el) { el.textContent = message; el.hidden = false; }
    const input = field === 'pages' ? this.$('#vpp-pages-text') : this.$('#vpp-' + (field.startsWith('margin-') ? 'm-' + field.slice(7) : field));
    if (input) input.setAttribute('aria-invalid', 'true');
  },

  async _changed(e) {
    if (!this.s || this.s.pdf) return;
    const target = e.target;
    this._readControls();
    const o = this.s.o;
    if (target.id === 'vpp-pages' && o.pagesMode === 'current') o.current = this._visibleSource();
    this._sync();
    const bad = this.problem(o);
    // Choosing "Pages…" with nothing typed yet is not an error to shout about; it just waits for the pages.
    const quiet = bad && bad.field === 'pages' && !String(o.pagesText).trim();
    this._fieldError(bad && !quiet ? bad.field : null, bad && bad.message);
    if (target.id === 'vpp-simplify') { await this._simplify(o.simplify); return; }
    if (!this.s.privacy) this.remember(o);
    // Choosing a printer or a number of copies changes nothing in the picture.
    if (target.id === 'vpp-dest' || target.id === 'vpp-copies') return;
    if (bad) return;
    if (e.type === 'input' && target.type !== 'text' && target.type !== 'number') return;
    this._schedule(e.type === 'change' ? 60 : this.DELAY);
  },

  async _simplify(on) {
    const s = this.s;
    const box = this.$('#vpp-simplify');
    try {
      let html = null;
      if (on) {
        this._setStatus('Reading the page…');
        const article = await s.wv.executeJavaScript(ReadingMode._extractScript());
        html = this.buildSimplified(article, s.info.url);
      }
      const r = await window.vex.printPreviewSimplify(s.id, html);
      if (!r || !r.ok) throw new Error((r && r.error) || 'no answer');
      this._setStatus('');
      this._schedule(0);
    } catch (err) {
      box.checked = false; s.o.simplify = false;
      this._setStatus(err.message || String(err), true);
    }
  },

  _setStatus(text, isError) {
    const el = this.$('#vpp-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
    if (isError) el.setAttribute('role', 'alert'); else el.setAttribute('role', 'status');
  },

  // ---- rendering ----------------------------------------------------------------------------------------
  _schedule(delay = this.DELAY, fresh = false) {
    const s = this.s;
    if (!s || s.pdf) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => this._render(fresh).catch(err => this._fail(err)), delay);
  },

  _busy(on, first) {
    const s = this.s;
    s.busy = on;
    const scroll = this.$('#vpp-scroll'), st = this.$('#vpp-state');
    scroll.setAttribute('aria-busy', on ? 'true' : 'false');
    scroll.classList.toggle('is-busy', on);
    if (on) {
      st.hidden = false; st.className = 'vpp-state' + (first ? '' : ' is-bar'); st.setAttribute('role', 'status');
      st.textContent = '';
      st.append(this._el('span', { class: 'vpp-spin', 'aria-hidden': 'true' }), this._el('span', { text: first ? 'Preparing the preview…' : 'Updating…' }));
    } else st.hidden = true;
  },

  _fail(err) {
    const s = this.s;
    if (!s) return;
    this._busy(false);
    const st = this.$('#vpp-state');
    st.hidden = false; st.className = 'vpp-state'; st.setAttribute('role', 'alert');
    st.textContent = '';
    const again = this._el('button', { type: 'button', class: 'vpp-btn', text: 'Try again' });
    const sys = this._el('button', { type: 'button', class: 'vpp-btn', text: 'Windows print dialog…' });
    again.addEventListener('click', () => this._schedule(0, true));
    sys.addEventListener('click', () => { const wv = s.wv; this.close(); this._systemPrint(wv); });
    st.append(this._el('strong', { text: 'The preview could not be made' }), this._el('span', { text: (err && err.message) || String(err) }), this._el('div', { class: 'vpp-state-actions' }, again, sys));
    again.focus();
  },

  async _pdfjs() {
    if (!this._lib) {
      this._lib = import(new URL('vendor/runtime/pdf.mjs', window.location.href).href).then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = new URL('vendor/runtime/pdf.worker.mjs', window.location.href).href;
        return lib;
      });
      this._lib.catch(() => { this._lib = null; });
    }
    return this._lib;
  },

  async _render(fresh) {
    const s = this.s;
    if (!s) return;
    const o = s.o;
    const bad = this.problem(o);
    if (bad) { this._fieldError(bad.field, bad.message); return; }
    const mine = ++s.seq;
    this._busy(true, !s.doc);
    const r = await window.vex.printPreviewRender(s.id, this.toMain(o), fresh === true);
    if (!this.s || mine !== s.seq) return;                 // closed, or a newer render took over
    if (r && r.stale) return;
    if (!r || !r.ok) {
      this._busy(false);
      if (r && r.field) { this._fieldError(r.field, r.error); return; }
      throw new Error((r && r.error) || 'no answer');
    }
    this._fieldError(null);
    const lib = await this._pdfjs();
    const doc = await lib.getDocument({ data: r.bytes, isEvalSupported: false }).promise;
    if (!this.s || mine !== s.seq) { doc.destroy(); return; }
    const old = s.doc;
    s.doc = doc; s.total = r.total; s.sheets = r.sheets; s.pageMap = r.pageMap;
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    s.base = { w: vp.width, h: vp.height };
    first.cleanup();
    this._layout(true);
    if (old) old.destroy();
    this._busy(false);
    this._count(r);
  },

  _count(r) {
    const s = this.s;
    this.$('#vpp-count').textContent = r.total === 1 ? '1 page' : r.total + ' pages';
    this.$('#vpp-sheets').textContent = (s.o.pagesMode !== 'all' || s.o.perSheet !== 1) ? (r.sheets === 1 ? '1 sheet' : r.sheets + ' sheets') : '';
    const note = this.$('#vpp-fit-note');
    note.textContent = '';
    if (s.o.scaleMode === 'fit') note.textContent = r.fitted ? 'Shrunk to ' + Math.round(r.scale * 100) + '% so nothing is cut off.' : 'Nothing is wider than the paper, so it stays at 100%.';
    this._tracking();
  },

  // ---- the sheets ---------------------------------------------------------------------------------------
  _cssWidth() {
    const scroll = this.$('#vpp-scroll');
    const room = Math.max(160, scroll.clientWidth - 40);
    return Math.min(room, 860) * this.s.zoom;
  },

  _layout(keepScroll) {
    const s = this.s, scroll = this.$('#vpp-scroll');
    const top = keepScroll ? scroll.scrollTop : 0;
    s.observer?.disconnect();
    s.rendered.clear(); s.wanted.clear();
    scroll.textContent = '';
    const w = this._cssWidth(), h = w * (s.base.h / s.base.w);
    s.cssW = w; s.cssH = h;
    s.observer = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const i = Number(en.target.dataset.i);
        if (en.isIntersecting) s.wanted.add(i);
        else { s.wanted.delete(i); this._free(en.target, i); }
      }
      this._pump();
    }, { root: scroll, rootMargin: '700px 0px' });
    const frag = document.createDocumentFragment();
    for (let i = 0; i < s.doc.numPages; i++) {
      const sheet = this._el('div', { class: 'vpp-sheet', 'data-i': String(i), role: 'img', 'aria-label': 'Page ' + (i + 1) + ' of ' + s.doc.numPages });
      sheet.style.width = Math.round(w) + 'px'; sheet.style.height = Math.round(h) + 'px';
      sheet.append(this._el('span', { class: 'vpp-sheet-no', 'aria-hidden': 'true', text: String(i + 1) }));
      frag.append(sheet);
      s.observer.observe(sheet);
    }
    scroll.append(frag);
    scroll.scrollTop = top;
    this.$('#vpp-zoomval').textContent = Math.round(s.zoom * 100) + '%';
  },

  _relayout() {
    if (!this.s || !this.s.doc) return;
    this._layout(true);
  },

  _zoom(dir) {
    const s = this.s;
    let at = this.ZOOMS.findIndex(z => Math.abs(z - s.zoom) < 0.01);
    if (at < 0) at = 3;
    at = Math.min(this.ZOOMS.length - 1, Math.max(0, at + dir));
    s.zoom = this.ZOOMS[at];
    this._relayout();
  },

  _free(sheet, i) {
    const s = this.s;
    if (!s) return;
    const c = sheet.querySelector('canvas');
    if (c) { c.width = 0; c.height = 0; c.remove(); }
    s.rendered.delete(i);
  },

  // Draw the sheet nearest the middle of the view that is wanted and not drawn yet; one at a time.
  async _pump() {
    const s = this.s;
    if (!s || s.pumping) return;
    s.pumping = true;
    try {
      for (;;) {
        if (!this.s || this.s !== s || !s.doc) return;
        const scroll = this.$('#vpp-scroll');
        const mid = scroll.scrollTop + scroll.clientHeight / 2;
        let best = -1, bestD = Infinity;
        for (const i of s.wanted) {
          if (s.rendered.has(i)) continue;
          const el = scroll.children[i];
          if (!el) continue;
          const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best < 0) return;
        s.rendered.add(best);
        const doc = s.doc;
        try { await this._draw(doc, best); }
        catch (err) {
          // A drawing that was cut short because a newer render replaced the file is not a failure.
          if (this.s !== s || s.doc !== doc) return;
          throw err;
        }
      }
    } catch (err) {
      if (this.s === s) this._fail(err);
    } finally { s.pumping = false; }
  },

  async _draw(doc, i) {
    const s = this.s, scroll = this.$('#vpp-scroll');
    const sheet = scroll && scroll.children[i];
    if (!sheet) return;
    const page = await doc.getPage(i + 1);
    if (this.s !== s || s.doc !== doc) { page.cleanup(); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const natural = page.getViewport({ scale: 1 });
    const scale = (s.cssW / natural.width) * dpr;
    const vp = page.getViewport({ scale });
    sheet.style.height = Math.round(s.cssW * (natural.height / natural.width)) + 'px';
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' });
    await task.promise;
    page.cleanup();
    if (this.s !== s || s.doc !== doc || !s.wanted.has(i)) { canvas.width = 0; s.rendered.delete(i); return; }
    sheet.prepend(canvas);
  },

  // The page indicator follows the scroll.
  _tracking() {
    const s = this.s;
    if (!s || !s.doc || s.tracking) return;
    s.tracking = true;
    requestAnimationFrame(() => {
      s.tracking = false;
      if (this.s !== s) return;
      const scroll = this.$('#vpp-scroll');
      if (!scroll) return;
      const line = scroll.scrollTop + scroll.clientHeight / 3;
      let at = 0;
      for (let i = 0; i < scroll.children.length; i++) { const el = scroll.children[i]; if (el.offsetTop + el.offsetHeight > line) { at = i; break; } at = i; }
      s.shown = at;
      const n = s.doc.numPages, sheets = s.o.perSheet > 1;
      this.$('#vpp-pageno').textContent = (sheets ? 'Sheet ' : 'Page ') + (at + 1) + ' of ' + n;
    });
  },

  // The first source page on the sheet being looked at (for "Current page").
  _visibleSource() {
    const s = this.s;
    const group = s.pageMap && s.pageMap[s.shown || 0];
    return group && group.length ? group[0] : 1;
  },

  // ---- print and save -----------------------------------------------------------------------------------
  async _act(kind) {
    const s = this.s;
    if (!s || s.acting) return;
    this._readControls();
    const bad = this.problem(s.o);
    if (bad) { this._fieldError(bad.field, bad.message); this._setStatus(bad.message, true); return; }
    s.acting = true;
    const btn = this.$(kind === 'save' && s.o.dest !== this.PDF ? '#vpp-save' : '#vpp-primary');
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    this._setStatus(kind === 'save' ? 'Saving…' : 'Sending to the printer…');
    try {
      const r = kind === 'save' ? await window.vex.printPreviewSavePdf(s.id, this.toMain(s.o)) : await window.vex.printPreviewPrint(s.id, this.toMain(s.o));
      if (r && r.cancelled) { this._setStatus(''); return; }
      if (!r || !r.ok) {
        if (r && r.field) this._fieldError(r.field, r.error);
        throw new Error((r && r.error) || 'no answer');
      }
      window.showToast?.(kind === 'save' ? 'PDF saved' : (s.o.dest === this.SYSTEM ? 'Sent to the Windows print dialog' : 'Sent to the printer'));
      this.close();
    } catch (err) {
      this._setStatus(err.message || String(err), true);
    } finally {
      s.acting = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
    }
  },

  close() {
    const s = this.s;
    if (!s) return;
    this.s = null;
    clearTimeout(s.timer);
    window.removeEventListener('resize', this._onResize);
    s.observer?.disconnect();
    if (s.doc) s.doc.destroy();
    s.root.remove();
    if (s.id) {
      window.vex.printPreviewClose(s.id).catch(err => console.error('[PrintPreview] could not close the preview in main:', err.message));
    }
    const back = s.opener;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  },

  // ---- Settings -----------------------------------------------------------------------------------------
  buildSettings(body) {
    const G = window.VexSettingsGroup;
    body.append(
      G.toggle('Use Vex\'s print preview', this.enabled(), (on) => this.setEnabled(on), 'Ctrl+P'),
      G.note('Ctrl+P and Print… show the page as it will print, with the options beside it. Switch it off to get the plain Windows print dialog instead.'),
    );
  },
};

if (typeof window !== 'undefined') {
  window.VexPrintPreview = VexPrintPreview;
  if (window.VexSettingsGroup) {
    window.VexSettingsGroup.add({ id: 'settings-print-preview', title: 'Print preview', info: 'Preview the pages before they print, and choose the printer, paper, margins and more.', build: (body) => VexPrintPreview.buildSettings(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPrintPreview };
