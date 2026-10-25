// Vex's own viewer for office documents and e-books. This file is the shell: it fetches the file through the tab's own session,
// works out what it is, hands it to the reader for that format, and owns what every reader shares (toolbar, side panel, find,
// print, copy, download, open with Windows, errors, the theme). The readers are in the files beside it.
//
// The page has no network of its own: its policy (main/office-viewer.js) allows only its own origin, and the file comes from
// /doc, which main answers with the tab's own session. A macro in a document is never run and an address in a document is
// never fetched.

import { t, applyStatic, setLang } from './strings.js';
import { $, el, decorateIcons, icon, button, menuButton, openMenu, closeMenu, menuIsOpen, dialog, toast, copyText, formatBytes, debounce } from './ui.js';
import { applyThemePayload, refreshScheme } from './theme.js';
import { openPackage, createWorkerClient } from './package.js';
import { createDocView } from './doc-view.js';
import { createSlidesView } from './slides-view.js';
import { createBookView } from './book-view.js';
import { createSheetView, toCsv } from './sheet.js';
import { parseCsv } from './csv.js';

const Z = globalThis.OfficeZipInfo;
const host = globalThis.vexOfficeHost;
const params = new URLSearchParams(location.search);
const original = params.get('u') || '';
const forcedKind = params.get('kind') || '';

// ---- what a file is called, by its name and its type ----------------------------------------------------------------------------------
const KINDS = {
  docx: { label: 'Word document', family: 'doc' }, doc: { label: 'Word document (old format)', family: 'legacy', app: 'Word' },
  xlsx: { label: 'Excel workbook', family: 'sheet' }, xls: { label: 'Excel workbook (old format)', family: 'legacy', app: 'Excel' },
  pptx: { label: 'PowerPoint presentation', family: 'slides' }, ppt: { label: 'PowerPoint presentation (old format)', family: 'legacy', app: 'PowerPoint' },
  odt: { label: 'Text document (OpenDocument)', family: 'doc' }, ods: { label: 'Spreadsheet (OpenDocument)', family: 'sheet' }, odp: { label: 'Presentation (OpenDocument)', family: 'slides' },
  rtf: { label: 'Rich Text document', family: 'doc' }, epub: { label: 'E-book', family: 'book' }, csv: { label: 'Table (CSV)', family: 'sheet' },
};
const EXT = { docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx', doc: 'doc', dot: 'doc', xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx', xls: 'xls', xlt: 'xls', pptx: 'pptx', pptm: 'pptx', ppsx: 'pptx', ppsm: 'pptx', potx: 'pptx', ppt: 'ppt', pps: 'ppt', pot: 'ppt',
  odt: 'odt', ott: 'odt', ods: 'ods', ots: 'ods', odp: 'odp', otp: 'odp', rtf: 'rtf', epub: 'epub', csv: 'csv', tsv: 'csv' };
const MIMES = [
  [/wordprocessingml/i, 'docx'], [/spreadsheetml/i, 'xlsx'], [/presentationml/i, 'pptx'], [/msword/i, 'doc'], [/ms-excel/i, 'xls'], [/ms-powerpoint/i, 'ppt'],
  [/opendocument\.text/i, 'odt'], [/opendocument\.spreadsheet/i, 'ods'], [/opendocument\.presentation/i, 'odp'], [/epub/i, 'epub'], [/rtf/i, 'rtf'], [/text\/(?:csv|tab-separated)/i, 'csv'],
];
function nameOf(url, disposition) {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition || '');
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  try { const u = new URL(url); const last = u.pathname.split('/').filter(Boolean).pop() || ''; return decodeURIComponent(last); } catch { return decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop() || ''); }
}
function extOf(name) { const m = /\.([a-z0-9]{2,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function kindHint(name, type) {
  if (forcedKind && KINDS[forcedKind]) return forcedKind;
  const byExt = EXT[extOf(name)];
  if (byExt) return byExt;
  for (const [re, kind] of MIMES) if (re.test(type || '')) return kind;
  return '';
}

// ---- preferences: kept on this computer, never for a private or Tor tab -----------------------------------------------------------------
const persistent = (document.querySelector('meta[name="vex-persist"]') || {}).content === '1';
const memory = new Map();
let prefsWarned = false;
const prefs = {
  get(key, fallback) {
    try {
      const raw = persistent ? localStorage.getItem('vex.office.' + key) : memory.get(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (err) { console.error('[Document viewer] a saved choice could not be read:', err); return fallback; }
  },
  set(key, value) {
    try { const raw = JSON.stringify(value); if (persistent) localStorage.setItem('vex.office.' + key, raw); else memory.set(key, raw); }
    catch (err) { console.error('[Document viewer] a choice could not be saved:', err); if (!prefsWarned) { prefsWarned = true; toast(t('Vex could not save your choice on this computer: {why}', { why: err.message }), 'error'); } }
  },
};

// ---- the shell the readers use -------------------------------------------------------------------------------------------------------
let view = null;
let kind = '';
let meta = { name: '', size: 0, type: '', macros: false };
const railState = { tabs: [], current: '', counts: new Map() };

const shell = {
  prefs, original,
  rail: {
    count(id, n) { railState.counts.set(id, n); const badge = document.querySelector('#od-rail-tabs [data-pane="' + id + '"] .od-count'); if (badge) { badge.textContent = String(n); badge.hidden = !n; } },
    open(id) { openRail(true); selectRailTab(id); },
  },
  banner(text) { const b = $('#od-banner'); b.hidden = !text; b.textContent = text || ''; },
  status(text) { $('#od-live').textContent = text || ''; },
  error(err) { showError(err); },
  toast,
};

function setBusy(on) { $('#od-stage').setAttribute('aria-busy', String(!!on)); }

// ---- the states: loading, error ---------------------------------------------------------------------------------------------------------------
function showState(node) {
  const s = $('#od-state');
  s.replaceChildren(node);
  s.hidden = false;
  $('#od-stage').hidden = true;
  $('#od-rail').hidden = true;
  $('#od-find').hidden = true;
  for (const id of ['od-find-btn', 'od-print-btn', 'od-more-btn']) $('#' + id).disabled = true;
}
function hideState() { $('#od-state').hidden = true; $('#od-stage').hidden = false; }

function loadingState() {
  const bar = el('div', { class: 'od-loadbar', role: 'progressbar', 'aria-label': t('Opening the file'), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('div', { class: 'od-loadfill' }));
  const text = el('p', { class: 'od-state-text', text: t('Opening the file…') });
  showState(el('div', { class: 'od-card' }, el('div', { class: 'od-spinner', 'aria-hidden': 'true' }), el('h1', { class: 'od-state-title', text: t('Opening {name}', { name: meta.name || t('the document') }) }), text, bar,
    el('div', { class: 'od-state-actions' }, el('button', { type: 'button', class: 'od-dbtn', text: t('Download instead'), onclick: () => doDownload() }))));
  return {
    progress(done, total) { const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0; bar.firstChild.style.width = (total ? pct : 30) + '%'; bar.setAttribute('aria-valuenow', String(pct)); text.textContent = total ? t('Fetching… {done} of {total}', { done: formatBytes(done), total: formatBytes(total) }) : t('Fetching… {done}', { done: formatBytes(done) }); },
    text(msg) { text.textContent = msg; },
  };
}

// code -> { title, message }
function describeError(err) {
  const code = (err && err.code) || 'error';
  const detail = err && err.message ? err.message : String(err);
  switch (code) {
    case 'protected': return { title: t('This file is password protected'), message: t('Vex cannot open protected Office files, because the password would have to be typed into a page. Open it with Windows, which will ask for the password, or download it.') };
    case 'legacy': return { title: t('This is an older file format'), message: t('{app} saved this in its older binary format ({ext}). Vex shows the newer formats (.docx, .xlsx, .pptx). Open it with Windows, or download it and save it again in the newer format.', { app: (KINDS[kind] && KINDS[kind].app) || '', ext: '.' + extOf(meta.name) }) };
    case 'huge': return { title: t('This file is too big to open here'), message: t('Vex opens documents up to {limit} so the window stays quick. {detail}. Download the original instead.', { limit: formatBytes(Z.LIMITS.fileBytes), detail }) };
    case 'notzip': return { title: t('This does not look like the file it claims to be'), message: t('The file is not a {what}. It may be damaged, or the website may have sent something else (such as a sign-in page). Download it to check.', { what: t((KINDS[kind] || {}).label || 'document') }) };
    case 'corrupt': return { title: t('This file looks damaged'), message: t('Vex could not read it: {detail}. The download may have been cut short, or the file may be damaged. Try downloading it again.', { detail }) };
    case 'fetch': return { title: t('Vex could not fetch this file'), message: detail };
    case 'unsupported': return { title: t('Vex cannot show this kind of file'), message: detail };
    default: return { title: t('Vex could not open this file'), message: detail };
  }
}
function showError(err) {
  console.warn('[Document viewer]', err);
  const d = describeError(err);
  const actions = el('div', { class: 'od-state-actions' },
    el('button', { type: 'button', class: 'od-dbtn primary', text: t('Download instead'), onclick: () => doDownload() }),
    el('button', { type: 'button', class: 'od-dbtn', text: t('Open with Windows'), onclick: () => doOpenExternal() }),
    el('button', { type: 'button', class: 'od-dbtn', text: t('Try again'), onclick: () => location.reload() }));
  const card = el('div', { class: 'od-card od-card-error', role: 'alert' }, el('div', { class: 'od-state-icon', 'aria-hidden': 'true' }), el('h1', { class: 'od-state-title', text: d.title }), el('p', { class: 'od-state-text', text: d.message }), actions);
  card.querySelector('.od-state-icon').innerHTML = icon((err && (err.code === 'protected')) ? 'lock' : 'warning', 28);
  showState(card);
  $('#od-download-btn').disabled = false;
  actions.querySelector('.primary').focus();
}

// ---- fetching ----------------------------------------------------------------------------------------------------------------------------------------
class FetchError extends Error { constructor(message, code) { super(message); this.code = code; } }
async function fetchFile(onProgress) {
  let res;
  try { res = await fetch('/doc?u=' + encodeURIComponent(original), { cache: 'no-store' }); }
  catch (err) { throw new FetchError(t('The connection failed: {why}', { why: err.message }), 'fetch'); }
  if (!res.ok) {
    let why = '';
    try { why = (await res.text()).slice(0, 300); } catch { why = ''; }
    throw new FetchError(res.status === 404 ? t('The file is not there (error 404).') : t('The server answered {status}. {why}', { status: res.status, why }), 'fetch');
  }
  const type = res.headers.get('content-type') || '';
  meta.name = nameOf(original, res.headers.get('content-disposition'));
  meta.type = type;
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > Z.LIMITS.fileBytes) throw Object.assign(new Error(t('This one is {size}', { size: formatBytes(total) })), { code: 'huge' });
  const reader = res.body.getReader();
  const chunks = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks.push(value);
    done += value.length;
    if (done > Z.LIMITS.fileBytes) { reader.cancel(); throw Object.assign(new Error(t('It is more than {size}', { size: formatBytes(done) })), { code: 'huge' }); }
    onProgress(done, total);
  }
  const out = new Uint8Array(done);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  meta.size = done;
  return out.buffer;
}

// ---- working out the format and opening it -----------------------------------------------------------------------------------------------------------
function kindFromPackage(pkg, mimetype) {
  if (pkg.has('word/document.xml')) return 'docx';
  if (pkg.has('xl/workbook.xml')) return 'xlsx';
  if (pkg.has('ppt/presentation.xml')) return 'pptx';
  const m = String(mimetype || '').trim();
  if (/epub/.test(m) || pkg.has('META-INF/container.xml') && !pkg.has('content.xml')) return 'epub';
  if (/opendocument\.text/.test(m)) return 'odt';
  if (/opendocument\.spreadsheet/.test(m)) return 'ods';
  if (/opendocument\.presentation/.test(m)) return 'odp';
  if (pkg.has('content.xml')) return 'odt';
  return '';
}

async function openDocument(buffer, hint) {
  const u8 = new Uint8Array(buffer);
  const sniff = Z.sniff(u8);
  if (hint === 'csv' || (sniff === 'other' && hint === 'csv')) return openCsv(u8);
  if (sniff === 'rtf') return openRtf(u8);
  if (sniff === 'ole') {
    kind = hint;
    if (KINDS[hint] && KINDS[hint].family === 'legacy') throw Object.assign(new Error('legacy'), { code: 'legacy' });
    throw Object.assign(new Error('protected'), { code: 'protected' });
  }
  if (sniff !== 'zip') {
    if (hint === 'rtf') throw Object.assign(new Error(t('It does not start like an RTF file')), { code: 'notzip' });
    if (KINDS[hint] && KINDS[hint].family === 'legacy') throw Object.assign(new Error('legacy'), { code: 'legacy' });
    throw Object.assign(new Error('not a package'), { code: 'notzip' });
  }
  let dir;
  try { dir = Z.readDirectory(u8); } catch (err) { throw err; }
  if (dir.encrypted) throw Object.assign(new Error('encrypted'), { code: 'protected' });
  const pkg = await openPackage(buffer);
  let mimetype = '';
  if (pkg.has('mimetype')) mimetype = await pkg.text('mimetype');
  const real = kindFromPackage(pkg, mimetype) || hint;
  if (!real) throw Object.assign(new Error(t('The package holds none of the parts of a Word, Excel, PowerPoint, OpenDocument or EPUB file')), { code: 'corrupt' });
  kind = real;
  meta.macros = pkg.has('word/vbaProject.bin') || pkg.has('xl/vbaProject.bin') || pkg.has('ppt/vbaProject.bin') || /m$/i.test(extOf(meta.name)) && /^(docm|xlsm|pptm)$/i.test(extOf(meta.name));
  switch (real) {
    case 'docx': {
      const { loadDocx, renderDocx } = await import('./docx.js');
      const model = await loadDocx(pkg);
      meta.title = model.props.title;
      return createDocView(shell, { render: (hostEl, o) => renderDocx(model, hostEl, o), hasChanges: model.hasChanges, hasComments: model.hasComments, page: model.page });
    }
    case 'odt': case 'ods': case 'odp': {
      const odf = await import('./odf.js');
      const model = await odf.loadOdf(pkg);
      kind = model.kind;
      meta.title = model.props.title;
      if (model.kind === 'odt') return createDocView(shell, { render: (hostEl, o) => odf.renderOdt(model, hostEl, o), hasChanges: model.hasChanges, hasComments: model.hasComments, page: null });
      if (model.kind === 'ods') {
        const book = odf.odsWorkbook(model);
        return sheetView(book, async (i) => odf.loadOdsSheet(model, i));
      }
      const info = odf.odpModel(model);
      if (!info.count) throw Object.assign(new Error(t('This presentation has no slides')), { code: 'corrupt' });
      const titles = new Map();
      return createSlidesView(shell, {
        count: info.count, size: model.size,
        render: (i, hostEl) => odf.renderOdpSlide(model, i, hostEl),
        title: async (i) => { if (!titles.size) odf.odpTitles(model).forEach((x, k) => titles.set(k, x)); return titles.get(i) || ''; },
        text: async (i) => odf.odpText(model, i), notes: async (i) => odf.odpNotes(model, i),
      });
    }
    case 'xlsx': {
      const opened = await pkg.client.call({ op: 'xlsx-open' });
      const visible = opened.sheets.filter((s) => s.state === 'visible');
      if (!visible.length) throw Object.assign(new Error(t('This workbook has no visible sheets')), { code: 'corrupt' });
      return sheetView({ sheets: opened.sheets, styles: opened.styles, date1904: opened.date1904 }, async (i) => (await pkg.client.call({ op: 'xlsx-sheet', index: i })).sheet);
    }
    case 'pptx': {
      const { loadPptx, renderSlide, slideTitle, slideText, slideNotes, releasePptx } = await import('./pptx.js');
      const model = await loadPptx(pkg);
      meta.title = model.props.title;
      return createSlidesView(shell, {
        count: model.slides.length, size: model.size,
        render: (i, hostEl) => renderSlide(model, i, hostEl),
        title: (i) => slideTitle(model, i), text: (i) => slideText(model, i), notes: (i) => slideNotes(model, i),
        release: () => releasePptx(model),
      });
    }
    case 'epub': {
      const { loadEpub } = await import('./epub.js');
      const model = await loadEpub(pkg);
      meta.title = model.title;
      return createBookView(shell, model);
    }
    default: throw Object.assign(new Error(t('This kind of file cannot be shown')), { code: 'unsupported' });
  }
}

async function openRtf(u8) {
  kind = 'rtf';
  const { parseRtf, renderRtf } = await import('./rtf.js');
  let text = '';
  for (let i = 0; i < u8.length; i += 32768) text += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
  const parsed = parseRtf(text);
  return createDocView(shell, { render: async (hostEl) => renderRtf(parsed, hostEl), hasChanges: false, hasComments: false, page: null });
}

function openCsv(u8) {
  kind = 'csv';
  let text = new TextDecoder('utf-8').decode(u8);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const { sheet } = parseCsv(text);
  const book = { sheets: [{ name: meta.name.replace(/\.[a-z0-9]+$/i, '') || 'CSV', state: 'visible' }], styles: [{}], date1904: false };
  return sheetView(book, async () => sheet);
}

// ---- the spreadsheet view and its tools ------------------------------------------------------------------------------------------------------------
function sheetView(book, loadSheet) {
  const sv = createSheetView({ book, loadSheet, onChange: () => syncSheetTools() });
  const formulas = button({ icon: 'od-formula', title: t('Show formulas instead of results'), aria: t('Show formulas instead of results'), pressed: false, onclick: () => { sv.setShowFormulas(!sv.showFormulas); formulas.setAttribute('aria-pressed', String(sv.showFormulas)); } });
  const freeze = button({ icon: 'od-freeze', title: t('Keep the top row in view'), aria: t('Keep the top row in view'), pressed: false, onclick: () => { sv.setFreezeHeader(!sv.freezeHeader); syncSheetTools(); } });
  const filters = button({ icon: 'filter', title: t('Sort and filter'), aria: t('Sort and filter'), pressed: false, onclick: () => { sv.setFilters(!sv.filtersOn); syncSheetTools(); } });
  const exp = button({ icon: 'save', label: t('Save as CSV'), title: t('Save this sheet as a CSV file'), aria: t('Save this sheet as a CSV file'), onclick: () => exportCsv() });
  function syncSheetTools() {
    formulas.disabled = !sv.hasFormulas();
    if (formulas.disabled && sv.showFormulas) { sv.setShowFormulas(false); }
    formulas.setAttribute('aria-pressed', String(sv.showFormulas));
    freeze.setAttribute('aria-pressed', String(sv.freezeHeader));
    filters.setAttribute('aria-pressed', String(sv.filtersOn));
  }
  function exportCsv() {
    const csv = '﻿' + sv.csv();
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: ((meta.name || 'sheet').replace(/\.[a-z0-9]+$/i, '') + (book.sheets.length > 1 ? ' - ' + sv.sheetName() : '') + '.csv').replace(/[\\/:*?"<>|]/g, '_') });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(t('The sheet is being saved as a CSV file (shown as it is on screen).'), 'info');
  }
  return {
    root: sv.root, tools: [formulas, freeze, filters, exp],
    rail: null,
    async start() {
      const first = book.sheets.findIndex((s) => s.state === 'visible');
      await sv.open(first);
      syncSheetTools();
      sv.focus();
    },
    text: () => sv.text(),
    async find(q, o) { return sv.find(q, o); },
    findStep: (d) => sv.findStep(d),
    clearFind: () => sv.clearFind(),
    zoomKeys: () => false,
    async printPrepare(area) {
      const rows = sv.printRows(3000);
      const table = el('table', { class: 'od-printtable' });
      for (const r of rows) table.append(el('tr', {}, r.map((v) => el('td', { text: v }))));
      area.replaceChildren(el('h1', { class: 'od-print-title', text: meta.name + (book.sheets.length > 1 ? ' — ' + sv.sheetName() : '') }), table);
      if (sv.info.rowCount > 3000) area.append(el('p', { text: t('Only the first {n} rows are printed.', { n: 3000 }) }));
      return { landscape: true };
    },
    printDone(area) { area.replaceChildren(); },
    focus: () => sv.focus(),
    about() { return [t('Shown: the results saved in the file, formatted as the file formats them (numbers, dates, percentages, currency), column widths, merged cells, bold, colours, and the sheets.'), t('Not shown: charts, pictures, conditional formatting, data validation and comments. Formulas are not calculated: the result saved with the file is shown.')]; },
    destroy() { sv.destroy(); },
  };
}

// ---- the toolbar and the side panel ---------------------------------------------------------------------------------------------------------------------
function mountView(v) {
  view = v;
  const stage = $('#od-stage');
  stage.replaceChildren(v.root);
  document.body.dataset.kind = kind;
  const tools = $('#od-tools');
  tools.replaceChildren(...(v.tools || []));
  decorateIcons(document);
  buildRail(v.rail);
  for (const id of ['od-find-btn', 'od-print-btn', 'od-more-btn']) $('#' + id).disabled = false;
  $('#od-download-btn').disabled = false;
}

function buildRail(rail) {
  const toggle = $('#od-rail-toggle');
  const aside = $('#od-rail');
  const tabs = $('#od-rail-tabs'), panes = $('#od-rail-panes');
  tabs.replaceChildren(); panes.replaceChildren();
  railState.tabs = [];
  if (!rail || !rail.tabs || !rail.tabs.length) { toggle.hidden = true; aside.hidden = true; document.body.dataset.rail = 'none'; return; }
  toggle.hidden = false;
  rail.tabs.forEach((tab, idx) => {
    const btn = el('button', { type: 'button', class: 'od-rail-tab', role: 'tab', id: 'od-tab-' + tab.id, 'data-pane': tab.id, 'aria-selected': 'false', 'aria-controls': 'od-pane-' + tab.id, tabindex: '-1' }, el('span', { text: tab.label }), tab.count ? el('span', { class: 'od-count', hidden: true }) : null);
    btn.insertAdjacentHTML('afterbegin', icon(tab.icon, 16));
    btn.addEventListener('click', () => selectRailTab(tab.id));
    btn.addEventListener('keydown', (e) => {
      const ids = railState.tabs.map((x) => x.id);
      const i = ids.indexOf(tab.id);
      let to = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = ids[(i + 1) % ids.length];
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = ids[(i - 1 + ids.length) % ids.length];
      else if (e.key === 'Home') to = ids[0];
      else if (e.key === 'End') to = ids[ids.length - 1];
      if (to) { e.preventDefault(); selectRailTab(to); document.getElementById('od-tab-' + to).focus(); }
    });
    const pane = el('div', { class: 'od-pane', role: 'tabpanel', id: 'od-pane-' + tab.id, 'aria-labelledby': 'od-tab-' + tab.id, tabindex: '-1', hidden: idx === 0 ? null : true });
    tabs.append(btn); panes.append(pane);
    tab.build(pane);
    railState.tabs.push({ id: tab.id });
  });
  tabs.hidden = rail.tabs.length < 2;
  const savedOpen = prefs.get('rail.open.' + kind, null);
  const wantOpen = savedOpen != null ? savedOpen : (kind === 'pptx' || kind === 'odp' || kind === 'epub');
  selectRailTab(rail.open || rail.tabs[0].id);
  openRail(wantOpen, true);
  for (const [id, n] of railState.counts) shell.rail.count(id, n);
}
function selectRailTab(id) {
  railState.current = id;
  for (const tab of document.querySelectorAll('.od-rail-tab')) { const on = tab.dataset.pane === id; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; }
  for (const pane of document.querySelectorAll('.od-pane')) pane.hidden = pane.id !== 'od-pane-' + id;
}
function openRail(on, quiet) {
  const aside = $('#od-rail'), toggle = $('#od-rail-toggle');
  aside.hidden = !on;
  toggle.setAttribute('aria-pressed', String(on));
  document.body.dataset.rail = on ? 'open' : 'closed';
  if (!quiet) prefs.set('rail.open.' + kind, on);
}

// ---- find ---------------------------------------------------------------------------------------------------------------------------------------------------------
const find = { open: false, seq: 0 };
function openFind(select) {
  if (!view) return;
  find.open = true;
  $('#od-find').hidden = false;
  $('#od-find-btn').setAttribute('aria-pressed', 'true');
  const input = $('#od-find-input');
  // The words the person has selected become the query.
  const sel = String(getSelection() || '').trim();
  if (sel && sel.length < 120 && !/\n/.test(sel)) { input.value = sel; runFind(); }
  input.focus();
  if (select !== false) input.select();
}
function closeFind() {
  if (!find.open) return;
  find.open = false;
  $('#od-find').hidden = true;
  $('#od-find-btn').setAttribute('aria-pressed', 'false');
  $('#od-find-count').textContent = '';
  find.seq++;
  if (view) { view.clearFind(); view.focus(); }
}
const findOpts = () => ({ matchCase: $('#od-find-case').getAttribute('aria-pressed') === 'true', whole: $('#od-find-word').getAttribute('aria-pressed') === 'true' });
function showCount(r) {
  const out = $('#od-find-count');
  const q = $('#od-find-input').value;
  if (!q.trim()) out.textContent = '';
  else out.textContent = r && r.count ? t('{n} of {total}', { n: r.index + 1, total: r.count }) : t('No matches');
}
async function runFind() {
  if (!view) return;
  const q = $('#od-find-input').value;
  const seq = ++find.seq;
  if (!q.trim()) { view.clearFind(); showCount(null); return; }
  $('#od-find-count').textContent = t('Searching…');
  let r;
  try { r = await view.find(q, findOpts()); } catch (err) { console.error('[Document viewer] search failed:', err); toast(t('The search failed: {why}', { why: err.message }), 'error'); return; }
  if (seq !== find.seq) return;
  showCount(r);
}
async function stepFind(dir) {
  if (!view) return;
  if (!$('#od-find-input').value.trim()) return;
  const seq = ++find.seq;
  const r = await view.findStep(dir);
  if (seq === find.seq) showCount(r);
}

// ---- actions ---------------------------------------------------------------------------------------------------------------------------------------------------------
async function callHost(name, ...args) {
  if (!host || typeof host[name] !== 'function') { toast(t('This window cannot do that'), 'error'); return null; }
  try { return await host[name](...args); }
  catch (err) { toast(err.message, 'error'); return null; }
}
async function doDownload() {
  const r = await callHost('download');
  if (!r) return;
  if (!r.ok) toast(t('Vex could not start the download: {why}', { why: r.error }), 'error');
  else if (!r.cancelled) toast(r.viaDownloads ? t('Downloading the original file…') : t('Saved {name}', { name: r.name || '' }), 'info');
}
async function doOpenExternal() {
  if (meta.macros) {
    const choice = await dialog({ title: t('Open with Windows?'), body: el('p', { text: t('This file can contain macros. Vex never runs them, but the program Windows opens it with might, if you allow it there. Open it only if you trust where it came from.') }), buttons: [{ id: 'cancel', label: t('Cancel') }, { id: 'open', label: t('Open with Windows'), primary: true }] });
    if (choice !== 'open') return;
  }
  toast(t('Opening with Windows…'), 'info');
  const r = await callHost('openExternal');
  if (r && !r.ok) toast(t('Vex could not open it: {why}', { why: r.error }), 'error');
}
async function doCopyText() {
  if (!view) return;
  const text = await view.text();
  if (!text || !text.trim()) { toast(t('There is no text to copy.'), 'error'); return; }
  const ok = await copyText(text);
  toast(ok ? t('Copied the text of the document ({n} characters)', { n: text.length.toLocaleString() }) : t('Vex could not copy that'), ok ? 'info' : 'error');
}
let printing = false;
async function doPrint() {
  if (!view || printing) return;
  printing = true;
  const area = $('#od-print-area');
  try {
    const info = (await view.printPrepare(area)) || {};
    document.body.classList.add('printing');
    document.body.dataset.print = info.landscape ? 'landscape' : 'portrait';
    if (!area.childNodes.length) document.body.classList.add('print-doc');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = await callHost('print');
    if (r && !r.ok && r.error !== 'cancelled') toast(t('Vex could not print: {why}', { why: r.error }), 'error');
  } catch (err) { console.error('[Document viewer] printing failed:', err); toast(t('Vex could not print: {why}', { why: err.message }), 'error'); }
  finally {
    document.body.classList.remove('printing', 'print-doc');
    delete document.body.dataset.print;
    if (view) view.printDone(area);
    printing = false;
  }
}
function openAbout() {
  const lines = view && view.about ? view.about() : [];
  dialog({ title: t('About this view'), body: el('div', {}, lines.map((l) => el('p', { text: l })), el('p', { class: 'od-hint', text: t('Macros in a document are never run, and no address in a document is fetched. Everything stays on this computer. The tab\'s own session fetched the file.') })), buttons: [{ id: 'ok', label: t('Close'), primary: true }] });
}

function wireToolbar() {
  $('#od-rail-toggle').addEventListener('click', () => openRail($('#od-rail').hidden));
  $('#od-find-btn').addEventListener('click', () => { if (find.open) closeFind(); else openFind(); });
  $('#od-print-btn').addEventListener('click', () => doPrint());
  $('#od-download-btn').addEventListener('click', () => doDownload());
  const more = $('#od-more-btn');
  menuButton(more, () => [
    { label: t('Open with Windows'), icon: 'external', run: () => doOpenExternal() },
    { label: t('Copy the text'), icon: 'copy', run: () => doCopyText() },
    { label: t('Print'), icon: 'od-print', keys: 'Ctrl+P', run: () => doPrint() },
    { type: 'sep' },
    { label: t('About this view'), icon: 'info', run: () => openAbout() },
  ]);
  const input = $('#od-find-input');
  const rerun = debounce(runFind, 180);
  input.addEventListener('input', rerun);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  });
  $('#od-find-next').addEventListener('click', () => stepFind(1));
  $('#od-find-prev').addEventListener('click', () => stepFind(-1));
  $('#od-find-close').addEventListener('click', () => closeFind());
  for (const id of ['od-find-case', 'od-find-word']) $('#' + id).addEventListener('click', (e) => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); runFind(); });

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFind(); return; }
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); doPrint(); return; }
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); doDownload(); return; }
    if (e.key === 'F3') { e.preventDefault(); if (!find.open) openFind(); else stepFind(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') { if (menuIsOpen()) return; if (find.open) { e.preventDefault(); closeFind(); } return; }
    if (view && view.zoomKeys && view.zoomKeys(e)) e.preventDefault();
  });
}

// ---- boot -------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function boot() {
  applyStatic(document);
  decorateIcons(document);
  wireToolbar();
  if (host && typeof host.onTheme === 'function') host.onTheme((payload) => { applyThemePayload(payload); applyStatic(document); });
  refreshScheme();
  meta.name = nameOf(original, '');
  document.title = meta.name || t('Document');
  $('#od-title').textContent = meta.name || t('Document');
  if (!original) { showError(Object.assign(new Error(t('No file was named.')), { code: 'fetch' })); return; }
  const hint0 = kindHint(meta.name, '');
  kind = hint0;
  $('#od-sub').textContent = (KINDS[hint0] ? t(KINDS[hint0].label) : t('Document'));
  const loading = loadingState();
  $('#od-download-btn').disabled = false;
  let v;
  try {
    const buffer = await fetchFile((done, total) => loading.progress(done, total));
    document.title = meta.name || t('Document');
    $('#od-title').textContent = meta.name || t('Document');
    kind = kindHint(meta.name, meta.type) || kind;
    loading.text(t('Reading the file…'));
    v = await openDocument(buffer, kind);
  } catch (err) { showError(err); return; }
  hideState();
  const label = KINDS[kind] ? t(KINDS[kind].label) : t('Document');
  $('#od-sub').textContent = label + ' · ' + formatBytes(meta.size) + (meta.macros ? ' · ' + t('contains macros (never run)') : '');
  document.body.dataset.kind = kind;
  mountView(v);
  try { await v.start(); } catch (err) { showError(err); return; }
  if (meta.macros) shell.banner(t('This file contains macros. Vex never runs them.'));
  // Tells the window the title, for the tab.
  if (host && typeof host.tell === 'function') host.tell('title', { title: (meta.title || meta.name || '').slice(0, 200) });
}

boot().catch((err) => { console.error('[Document viewer] failed to start:', err); try { showError(err); } catch { document.body.textContent = String(err && err.message); } });
void createWorkerClient; void toCsv; void setLang; void closeMenu; void openMenu;
