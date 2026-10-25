// Vex's own viewer for text-like documents: JSON, JSON Lines, XML, CSV and TSV, Markdown, plain text, logs, source files, and
// view-source: pages. This is the page's brain: it reads the document through the tab's own session (main/text-viewer.js serves
// /doc), hands the bytes to the worker, decides what the document is, and puts the right view on screen with its own controls.

import { t, num, bytes as fmtBytes, applyStatic, setLang } from './strings.js';
import { applyThemePayload, refreshScheme } from './theme.js';
import { el, icon, button, select, toggle, toast, prefs, DocWorker, errText, setPressed, debounce } from './ui.js';
import { classify, charsetOf, nameOf, looksLikeHtml, LANGUAGES } from './kinds.js';
import { TreeView } from './tree-view.js';
import { TextView } from './text-view.js';
import { CsvView } from './csv-view.js';
import { MdView } from './md-view.js';

const params = new URLSearchParams(location.search);
const original = params.get('u') || '';
const sourceMode = params.get('m') === 'source';
const hash = location.hash.slice(1);
const host = window.vexDocHost || null;
const MD_MAX = 2 * 1024 * 1024;
const MAX_BYTES = 900 * 1024 * 1024;
const FOLLOW_MS = 1500;

const $ = (id) => document.getElementById(id);
const main = $('dv-main');

const S = {
  worker: null, view: null, mode: null, cls: null, info: null, kindInfo: null,
  encoding: 'auto', delimiter: 'auto', header: true, rawLength: 0, contentType: '',
  query: '', cs: false, follow: false, followTimer: 0, polling: false, forceText: false, parseError: null, loadSeq: 0,
};

// ------------------------------------------------------------------ small things
const STATUS = $('dv-status');
const setStatus = (text) => { STATUS.textContent = text || ''; };

function setBanner(message, kind, actions) {
  const b = $('dv-banner');
  b.replaceChildren();
  if (!message) { b.hidden = true; return; }
  b.dataset.kind = kind || 'info';
  b.append(icon(kind === 'error' ? 'warning' : 'info', 16), el('span', { class: 'dv-banner-text', text: message }));
  for (const a of actions || []) b.append(button({ label: a.label, text: a.label, onClick: a.run, cls: 'dv-banner-btn' }));
  b.hidden = false;
}

const COPIED = { path: 'Path copied', value: 'Value copied', all: 'Document copied', rows: 'Rows copied', cell: 'Cell copied', code: 'Code copied' };
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t(COPIED[what] || 'Copied'));
  } catch (err) { toast(t('Could not copy: {reason}', { reason: err.message }), 'error'); throw err; }
}

function hostCall(name) {
  if (!host || typeof host[name] !== 'function') throw new Error(t('This window cannot do that'));
  return host[name]();
}

// ------------------------------------------------------------------ the toolbar
const KIND_LABEL = { json: 'JSON', jsonl: 'JSON Lines', xml: 'XML', csv: 'CSV', tsv: 'TSV', md: 'Markdown', text: 'Text', source: 'Source', log: 'Log' };

function buildActions() {
  const box = $('dv-actions');
  box.replaceChildren(
    button({ icon: 'copy', label: 'Copy all', text: 'Copy all', onClick: () => copyAll() }),
    button({ icon: 'save', label: 'Save as…', text: 'Save as…', onClick: () => act('saveAs') }),
    button({ icon: 'download', label: 'Download', text: 'Download', onClick: () => act('download') }),
    button({ icon: 'external', label: 'Open raw in the browser’s own view', text: 'Open raw', onClick: () => act('openRaw') }),
    button({ icon: 'refresh', label: 'Reload', onClick: () => load() }),
  );
}

// What main refuses with, by code (main/text-viewer.js Refusal): the sentence is the viewer's own, so it can be translated.
const REFUSALS = {
  'not-viewer': 'Only the document viewer may ask for this',
  'http-status': 'The server answered {status} when Vex fetched the document again',
  scheme: 'Only web and file documents can be saved',
  'same-file': 'That is the file you are reading. Save the copy under another name',
  'file-only': 'Only a file can link to another file',
};
const refusalText = (r) => (r && r.code && REFUSALS[r.code] ? t(REFUSALS[r.code], r.args) : (r && r.error) || t('It did not work'));

async function act(name) {
  try {
    const r = await hostCall(name);
    if (!r || !r.ok) throw new Error(refusalText(r));
    if (name === 'saveAs' && !r.cancelled) toast(t('Saved as {name}', { name: r.name }), 'success');
    if (name === 'download' && !r.viaDownloads) toast(t('Saved as {name}', { name: r.name }), 'success');
    if (name === 'download' && r.viaDownloads) toast(t('Download started'));
  } catch (err) { toast(err.message, 'error'); }
}

async function copyAll() {
  if (!S.worker || !S.info) { toast(t('There is nothing to copy yet'), 'error'); return; }
  try {
    const r = await S.worker.call('textGet', {});
    await copy(r.text, 'all');
  } catch (err) { if (!/clipboard|copy/i.test(err.message)) toast(errText(err), 'error'); }
}

// the view buttons (Tree / Raw ...)
function buildViews(modes) {
  const box = $('dv-views');
  box.replaceChildren();
  if (modes.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  const defs = { tree: ['list', 'Tree'], raw: ['code', 'Raw'], table: ['grid', 'Table'], rendered: ['book-open', 'Rendered'] };
  for (const m of modes) {
    const [ic, label] = defs[m];
    const b = button({ icon: ic, label, text: label, pressed: S.mode === m, cls: 'dv-view-btn', onClick: () => setMode(m, true) });
    b.dataset.mode = m;
    box.append(b);
  }
}

// ------------------------------------------------------------------ search
const find = $('dv-find');
const input = $('dv-q');
const counter = $('dv-count');
const runSearch = debounce(async () => {
  S.query = input.value;
  await applySearch();
}, 220);

async function applySearch() {
  if (!S.view || typeof S.view.search !== 'function') return;
  try {
    const r = await S.view.search(S.query, S.cs);
    showCount(r);
  } catch (err) { counter.textContent = ''; toast(errText(err), 'error'); }
}

function showCount(r) {
  const nav = !(S.view && S.view.supportsNav === false);
  $('dv-prev').disabled = $('dv-next').disabled = !nav || !r || !r.count;
  if (!S.query) { counter.textContent = ''; return; }
  if (r && r.filter) { counter.textContent = t('{n} of {total} rows', { n: num(r.count), total: num(r.total) }); return; }
  if (!r || !r.count) { counter.textContent = t('No matches'); return; }
  const st = S.view.hitState();
  counter.textContent = (st.index + 1 > 0 ? num(st.index + 1) : '1') + ' / ' + num(r.count) + (r.capped ? '+' : '');
}

async function step(dir) {
  if (!S.view || !S.query) return;
  try {
    if (dir > 0) await S.view.next(); else await S.view.prev();
    const st = S.view.hitState();
    counter.textContent = num(st.index + 1) + ' / ' + num(st.count);
  } catch (err) { toast(errText(err), 'error'); }
}

find.addEventListener('submit', (e) => { e.preventDefault(); runSearch.cancel(); S.query = input.value; applySearch().then(() => { if (S.view && S.view.supportsNav !== false && S.query) step(1); }); });
input.addEventListener('input', () => runSearch());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runSearch.cancel(); if (S.query === input.value && S.view && S.view.hitState().count) step(e.shiftKey ? -1 : 1); else { S.query = input.value; applySearch(); } }
  if (e.key === 'Escape') { input.value = ''; S.query = ''; applySearch(); if (S.view) S.view.focus(); }
});
$('dv-prev').addEventListener('click', () => step(-1));
$('dv-next').addEventListener('click', () => step(1));
$('dv-case').addEventListener('click', () => { S.cs = !S.cs; setPressed($('dv-case'), S.cs); applySearch(); });

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); input.focus(); input.select(); return; }
  if (mod && e.key.toLowerCase() === 'g') { const go = document.getElementById('dv-goto'); if (go) { e.preventDefault(); go.focus(); go.select(); } return; }
  if (e.key === 'F3') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
  if (e.key === '/' && !mod && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) { e.preventDefault(); input.focus(); input.select(); }
});

// ------------------------------------------------------------------ loading
function showState(iconName, title, detail, actions, busy) {
  if (S.view) { S.view.destroy(); S.view = null; }
  const box = el('div', { class: 'dv-state', role: busy ? 'status' : 'alert' });
  box.append(icon(iconName, 28), el('h1', { class: 'dv-state-title', text: title }));
  if (detail) box.append(el('p', { class: 'dv-state-detail', text: detail }));
  if (busy !== undefined && busy !== true && busy !== false) box.append(busy);
  if (actions && actions.length) {
    const row = el('div', { class: 'dv-state-actions' });
    for (const a of actions) row.append(button({ icon: a.icon, label: a.label, text: a.label, onClick: a.run, cls: a.primary ? 'dv-primary' : '' }));
    box.append(row);
  }
  main.replaceChildren(box);
}

const FAIL_TEXT = { missing: 'That file is not there', fetch: 'The document could not be fetched', scheme: 'Only web and file documents can be opened here' };
function failure(title, detail) {
  $('dv-options').replaceChildren();
  $('dv-views').hidden = true;
  setBanner('');
  showState('warning', title, detail, [
    { icon: 'refresh', label: 'Retry', run: () => load(), primary: true },
    { icon: 'external', label: 'Open raw', run: () => act('openRaw') },
  ]);
  setStatus('');
}

async function load() {
  const seq = ++S.loadSeq;
  stopFollow(false);
  setBanner('');
  if (S.worker) { S.worker.stop(); S.worker = null; }
  const progress = el('div', { class: 'dv-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': t('Reading the document') }, el('div', { class: 'dv-progress-bar' }));
  const label = el('p', { class: 'dv-state-detail', text: '' });
  const box = el('div', {}, progress, label);
  showState('file', t('Reading the document…'), '', [], box);
  document.title = nameOf(original);
  let resp;
  try { resp = await fetch('/doc?u=' + encodeURIComponent(original), { cache: 'no-store' }); }
  catch (err) { if (seq === S.loadSeq) failure(t('The document could not be fetched'), err.message); return; }
  if (seq !== S.loadSeq) return;
  if (!resp.ok) {
    const kind = resp.headers.get('x-vex-error');
    let detail = '';
    try { detail = (await resp.text()).slice(0, 300); } catch { detail = ''; }
    failure(kind && FAIL_TEXT[kind] ? t(FAIL_TEXT[kind]) : t('The server answered {status}', { status: resp.status }), kind === 'fetch' ? detail : '');
    return;
  }
  const total = Number(resp.headers.get('content-length')) || Number(resp.headers.get('x-vex-size')) || 0;
  if (total > MAX_BYTES) { failure(t('This document is too large to show here'), t('{size} is more than the {max} the viewer can hold. Open it raw or save it instead.', { size: fmtBytes(total), max: fmtBytes(MAX_BYTES) })); return; }
  const reader = resp.body.getReader();
  const chunks = [];
  let got = 0, shown = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (got > MAX_BYTES) { await reader.cancel(); failure(t('This document is too large to show here'), t('Open it raw or save it instead.')); return; }
      if (performance.now() - shown > 120) {
        shown = performance.now();
        label.textContent = total ? t('{got} of {total}', { got: fmtBytes(got), total: fmtBytes(total) }) : fmtBytes(got);
        const pct = total ? Math.min(100, Math.round((got / total) * 100)) : 0;
        progress.firstChild.style.width = total ? pct + '%' : '30%';
        progress.setAttribute('aria-valuenow', String(pct));
      }
      if (seq !== S.loadSeq) { await reader.cancel(); return; }
    }
  } catch (err) { failure(t('The document could not be fetched'), err.message); return; }
  const buf = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.length; }
  chunks.length = 0;
  S.rawLength = got;
  S.contentType = resp.headers.get('content-type') || '';
  const head = new TextDecoder('utf-8').decode(buf.subarray(0, 4096));
  S.cls = classify({ url: original, contentType: S.contentType, head, source: sourceMode });
  if (S.cls.kind === 'text' && S.cls.lang === 'plain' && looksLikeHtml(head)) S.cls.lang = 'html';
  const charset = charsetOf(S.contentType);
  S.headerCharset = charset && charset !== 'utf-8' && charset !== 'utf8' ? charset : '';
  S.worker = new DocWorker('/app/doc-worker.js');
  try {
    S.info = await S.worker.call('init', { buffer: buf.buffer, encoding: S.encoding !== 'auto' ? S.encoding : (S.headerCharset || 'auto') }, [buf.buffer]);
  } catch (err) { failure(t('The document could not be read'), errText(err)); return; }
  if (seq !== S.loadSeq) return;
  if (S.info.encoding && S.encoding === 'auto') S.detectedEncoding = S.info.encoding;
  if (S.info.binary && !S.forceText) { showBinary(); return; }
  await openKind();
}

function showBinary() {
  $('dv-options').replaceChildren();
  buildViews([]);
  paintId();
  showState('file', t('This does not look like a text file'), t('It holds bytes that are not text ({size}). Showing it as text would only show garbage.', { size: fmtBytes(S.info.size) }), [
    { icon: 'download', label: 'Download', run: () => act('download'), primary: true },
    { icon: 'external', label: 'Open raw', run: () => act('openRaw') },
    { icon: 'code', label: 'Show as text anyway', run: () => { S.forceText = true; openKind(); } },
  ]);
  $('dv-info').textContent = fmtBytes(S.info.size);
}

// ------------------------------------------------------------------ what it is, and how to show it
function kindKey() { return S.cls.kind === 'text' && sourceMode ? 'source' : S.cls.kind; }

function paintId() {
  const name = nameOf(original);
  $('dv-name').textContent = sourceMode ? t('Source of {name}', { name }) : name;
  $('dv-sub').textContent = original.replace(/^file:\/\/\/?/, '').replace(/[?#].*$/, '') === name ? '' : original.replace(/#.*$/, '');
  const key = S.cls ? (sourceMode ? 'source' : S.cls.kind === 'csv' && S.cls.delimiter === 'tab' ? 'tsv' : S.cls.kind === 'text' && S.cls.lang === 'log' ? 'log' : S.cls.kind) : 'text';
  $('dv-kind').textContent = t(KIND_LABEL[key] || 'Text');
  document.title = $('dv-name').textContent;
}

async function openKind() {
  S.parseError = null;
  const cls = S.cls;
  paintId();
  buildActions();
  setBanner('');
  let kind = cls.kind;
  if (kind === 'md' && S.info.bytes > MD_MAX) {
    setBanner(t('This Markdown file is too large to render ({size}); its text is shown.', { size: fmtBytes(S.info.bytes) }), 'info');
    kind = 'text';
  }
  S.kindInfo = null;
  try {
    if (kind === 'json') S.kindInfo = await S.worker.call('openJson', {});
    else if (kind === 'jsonl') S.kindInfo = await S.worker.call('openJsonLines', {});
    else if (kind === 'xml') S.kindInfo = await S.worker.call('openXml', {});
    else if (kind === 'csv') S.kindInfo = await S.worker.call('openCsv', { delimiter: S.delimiter === 'auto' && cls.delimiter === 'tab' ? 'tab' : S.delimiter, header: S.header });
  } catch (err) {
    if (!err.parse) { failure(t('The document could not be read'), errText(err)); return; }
    S.parseError = err;
    kind = 'text';
    if (!cls.tentative) {
      setBanner(t('This is not valid {kind}: {why} (line {line}, column {col}). The text is shown.', { kind: t(KIND_LABEL[cls.kind] || 'Text'), why: errText(err), line: num(err.line), col: num(err.col) }), 'error');
    }
  }
  S.effKind = kind;
  const modes = kind === 'json' || kind === 'jsonl' || kind === 'xml' ? ['tree', 'raw'] : kind === 'csv' ? ['table', 'raw'] : kind === 'md' ? ['rendered', 'raw'] : ['raw'];
  const saved = prefs.get(kindKey(), 'mode', modes[0]);
  S.modes = modes;
  const mode = S.parseError ? 'raw' : (modes.includes(saved) ? saved : modes[0]);
  await setMode(mode, false);
  if (S.parseError && S.view && S.view.goToLine) S.view.goToLine(S.parseError.line - 1, true);
  $('dv-main').focus({ preventScroll: true });
  if (S.view && S.view.focus && !S.parseError) S.view.focus();
}

function langOf() {
  const k = S.effKind;
  const saved = prefs.get('lang:' + original.replace(/[?#].*$/, ''), 'lang', null);
  if (saved) return saved;
  if (k === 'json' || k === 'jsonl') return 'json';
  if (k === 'xml') return sourceMode ? 'html' : 'xml';
  if (k === 'csv') return 'plain';
  if (k === 'md') return 'md';
  return S.cls.lang;
}

async function setMode(mode, remember) {
  if (S.view) { S.view.destroy(); S.view = null; }
  if (remember) prefs.set(kindKey(), 'mode', mode);
  S.mode = mode;
  buildViews(S.modes);
  buildOptions();
  main.replaceChildren();
  const key = kindKey();
  try {
    if (mode === 'tree') {
      S.view = new TreeView({ worker: S.worker, host: main, kind: S.effKind, info: S.kindInfo, setStatus, copy, onRows: () => {} });
      setStatus(t('{n} nodes', { n: num(S.kindInfo.nodes) }));
    } else if (mode === 'table') {
      S.view = new CsvView({ worker: S.worker, host: main, info: S.kindInfo, frozen: prefs.get('csv', 'frozen', false), setStatus, copy, onCount: (n) => paintInfo(n) });
      await S.view.mount();
      S.view.setFilters(prefs.get('csv', 'colfilters', false));
    } else if (mode === 'rendered') {
      const r = await S.worker.call('textGet', {});
      S.view = new MdView({ host: main, text: r.text, docUrl: original, images: prefs.get('md', 'images', true), toc: prefs.get('md', 'toc', true), setStatus, copy, hash, navigate: (u) => hostNavigate(u) });
      await S.view.mount();
    } else {
      const li = await S.worker.call('linesInfo', {});
      S.lineInfo = li;
      const tailable = !sourceMode && S.effKind === 'text';
      S.view = new TextView({
        worker: S.worker, host: main, info: li, lang: langOf(),
        wrap: prefs.get(key, 'wrap', sourceMode || S.effKind === 'md'), lineNumbers: prefs.get(key, 'ln', true), setStatus,
      });
      await S.view.mount();
      if (tailable && prefs.get(key, 'follow', false)) { S.follow = true; startFollow(); S.view.scrollEnd(); setFollowUi(); }
    }
  } catch (err) { failure(t('The document could not be shown'), errText(err)); return; }
  paintInfo();
  S.view.focus && void 0;
  $('dv-q').placeholder = mode === 'table' ? t('Filter rows') : t('Search');
  $('dv-q').setAttribute('aria-label', mode === 'table' ? t('Filter rows') : t('Search'));
  const nav = !(S.view && S.view.supportsNav === false);
  $('dv-prev').hidden = $('dv-next').hidden = !nav;
  if (S.query) applySearch(); else showCount(null);
}

function hostNavigate(url) {
  if (!host || typeof host.navigate !== 'function') { toast(t('This window cannot do that'), 'error'); return; }
  host.navigate(url).then((r) => { if (!r || !r.ok) toast(refusalText(r), 'error'); });
}

function paintInfo(shownRows) {
  const i = S.info;
  if (!i) return;
  const parts = [];
  if (S.mode === 'table' && S.kindInfo) parts.push(t('{n} rows', { n: num(S.kindInfo.rows) }) + (shownRows !== undefined && shownRows !== S.kindInfo.rows ? ' (' + t('{n} shown', { n: num(shownRows) }) + ')' : ''), t('{n} columns', { n: num(S.kindInfo.cols) }));
  else if (S.mode === 'tree' && S.kindInfo) parts.push(t('{n} nodes', { n: num(S.kindInfo.nodes) }));
  else if (S.lineInfo && S.mode === 'raw') parts.push(t('{n} lines', { n: num(S.lineInfo.count) }));
  parts.push(i.encoding.toUpperCase());
  parts.push(fmtBytes(i.size));
  $('dv-info').textContent = parts.join('  ·  ');
}

// ------------------------------------------------------------------ the row of options
const ENCODINGS = [['auto', 'Auto'], ['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE'], ['windows-1254', 'Windows-1254'], ['iso-8859-9', 'ISO-8859-9'], ['windows-1252', 'Windows-1252'], ['iso-8859-1', 'ISO-8859-1'], ['windows-1250', 'Windows-1250'], ['windows-1251', 'Windows-1251']];
const DELIMS = [['auto', 'Auto'], [',', 'Comma (,)'], [';', 'Semicolon (;)'], ['tab', 'Tab'], ['|', 'Pipe (|)']];
const LANG_NAME = { plain: 'Plain text', log: 'Log', js: 'JavaScript', ts: 'TypeScript', json: 'JSON', css: 'CSS', html: 'HTML', xml: 'XML', md: 'Markdown', py: 'Python', sh: 'Shell', bat: 'Batch', ps: 'PowerShell', ini: 'INI', toml: 'TOML', yaml: 'YAML', sql: 'SQL', java: 'Java / C# / Kotlin', c: 'C / C++', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', lua: 'Lua', diff: 'Diff' };

function buildOptions() {
  const row = $('dv-options');
  row.replaceChildren();
  const key = kindKey();
  const add = (...nodes) => { for (const n of nodes) row.append(n); };
  const sep = () => el('span', { class: 'dv-sep', 'aria-hidden': 'true' });

  if (S.mode === 'tree') {
    add(button({ icon: 'plus', label: 'Expand all', text: 'Expand all', onClick: () => runView('setAll', true) }),
      button({ icon: 'minus', label: 'Collapse all', text: 'Collapse all', onClick: () => runView('setAll', false) }),
      el('span', { class: 'dv-hint', text: t('Arrow keys move, Right and Left open and close, P copies the path, V copies the value') }));
  } else if (S.mode === 'table') {
    add(select({ label: 'Delimiter', options: DELIMS, value: S.delimiter, onChange: (v) => { S.delimiter = v; reopenTable(); } }),
      toggle({ label: 'First row is the header', checked: S.header, onChange: (v) => { S.header = v; reopenTable(); } }),
      sep(),
      toggle({ label: 'Column filters', checked: prefs.get('csv', 'colfilters', false), onChange: (v) => { prefs.set('csv', 'colfilters', v); if (S.view && S.view.setFilters) S.view.setFilters(v); } }),
      toggle({ label: 'Keep the first column in view', checked: prefs.get('csv', 'frozen', false), onChange: (v) => { prefs.set('csv', 'frozen', v); if (S.view && S.view.setFrozen) S.view.setFrozen(v); } }),
      button({ icon: 'copy', label: 'Copy the rows shown', text: 'Copy rows', onClick: () => runView('copyRows') }));
  } else if (S.mode === 'rendered') {
    add(toggle({ label: 'Contents', checked: prefs.get('md', 'toc', true), onChange: (v) => { prefs.set('md', 'toc', v); if (S.view && S.view.setToc) S.view.setToc(v); } }),
      toggle({ label: 'Load pictures', checked: prefs.get('md', 'images', true), title: 'Pictures in the document are loaded through this tab, like a page would', onChange: (v) => { prefs.set('md', 'images', v); setMode('rendered', false); } }));
  } else {
    add(toggle({ label: 'Wrap lines', checked: prefs.get(key, 'wrap', sourceMode || S.effKind === 'md'), onChange: (v) => { prefs.set(key, 'wrap', v); if (S.view && S.view.setWrap) S.view.setWrap(v); } }),
      toggle({ label: 'Line numbers', checked: prefs.get(key, 'ln', true), onChange: (v) => { prefs.set(key, 'ln', v); if (S.view && S.view.setLineNumbers) S.view.setLineNumbers(v); } }),
      select({ label: 'Language', options: LANGUAGES.map((l) => [l, LANG_NAME[l]]), value: langOf(), onChange: (v) => { prefs.set('lang:' + original.replace(/[?#].*$/, ''), 'lang', v); if (S.view && S.view.setLang) S.view.setLang(v); } }));
    if (!sourceMode && S.effKind === 'text') {
      const f = toggle({ label: 'Follow the end', checked: S.follow, title: 'Keep checking the file for new lines and stay at the end, like tail -f', onChange: (v) => setFollow(v) });
      f.id = 'dv-follow';
      add(f);
    }
    const goto = el('label', { class: 'dv-goto' }, el('span', { class: 'dv-select-label', text: t('Go to line') }));
    const gi = el('input', { id: 'dv-goto', class: 'dv-goto-input', type: 'number', min: '1', inputmode: 'numeric', 'aria-label': t('Go to line') });
    gi.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const n = Number(gi.value);
      if (Number.isInteger(n) && n >= 1 && S.view && S.view.goToLine) S.view.goToLine(n - 1, true);
      else toast(t('Type a line number between 1 and {max}', { max: num(S.lineInfo ? S.lineInfo.count : 1) }), 'error');
    });
    goto.append(gi);
    add(goto);
  }
  add(sep(), select({
    label: 'Encoding', options: ENCODINGS, value: S.encoding,
    onChange: (v) => { S.encoding = v; reencode(); },
  }));
}

async function runView(method, ...args) {
  try { await S.view[method](...args); } catch (err) { toast(errText(err), 'error'); }
}

async function reopenTable() {
  try {
    S.kindInfo = await S.worker.call('openCsv', { delimiter: S.delimiter, header: S.header });
    await setMode('table', false);
  } catch (err) { toast(errText(err), 'error'); }
}

async function reencode() {
  try {
    S.info = await S.worker.call('init', { encoding: S.encoding === 'auto' ? (S.headerCharset || 'auto') : S.encoding }, []);
    await openKind();
  } catch (err) { toast(errText(err), 'error'); }
}

// ------------------------------------------------------------------ following a growing file
function setFollowUi() {
  const f = document.querySelector('#dv-follow input');
  if (f) f.checked = S.follow;
}

function setFollow(on) {
  S.follow = on;
  prefs.set(kindKey(), 'follow', on);
  if (on) { startFollow(); if (S.view && S.view.scrollEnd) S.view.scrollEnd(); } else stopFollow(false);
}
function startFollow() { stopFollow(false); S.follow = true; S.followTimer = setInterval(poll, FOLLOW_MS); }
function stopFollow(keepFlag) { clearInterval(S.followTimer); S.followTimer = 0; if (!keepFlag) { /* the preference stays; only the timer stops */ } }

async function poll() {
  if (S.polling || !S.worker || S.mode !== 'raw') return;
  S.polling = true;
  const seq = S.loadSeq;
  try {
    const r = await fetch('/doc?u=' + encodeURIComponent(original), { headers: { Range: 'bytes=' + S.rawLength + '-' }, cache: 'no-store' });
    if (seq !== S.loadSeq) return;
    if (r.status === 206) {
      const add = new Uint8Array(await r.arrayBuffer());
      if (!add.length) return;
      if (S.info.encoding !== 'utf-8') { await load(); return; }
      const a = await S.worker.call('append', { buffer: add.buffer }, [add.buffer]);
      S.rawLength += add.length;
      S.info.size = S.rawLength;
      await S.view.appended({ count: a.lines, bytes: a.bytes });
      S.lineInfo = { count: a.lines, bytes: a.bytes };
      paintInfo();
    } else if (r.status === 416) {
      const m = /\*\/(\d+)/.exec(r.headers.get('content-range') || '');
      if (m && Number(m[1]) < S.rawLength) { await load(); }       // the file became shorter: it was rotated or emptied
    } else if (r.status === 200) {
      const len = Number(r.headers.get('content-length') || 0);
      try { await r.body.cancel(); } catch { /* vex-allow-empty-catch: the body is not needed, the answer was read from its headers */ }
      if (len && len !== S.rawLength) await load();                 // a server that ignores ranges: read it all again
    } else throw new Error(t('The server answered {status}', { status: r.status }));
  } catch (err) {
    setBanner(t('Following stopped: {why}', { why: err.message }), 'error', [{ label: 'Retry', run: () => { setBanner(''); startFollow(); } }]);
    stopFollow(false);
  } finally { S.polling = false; }
}

// ------------------------------------------------------------------ start
if (host && typeof host.onTheme === 'function') host.onTheme((payload) => { applyThemePayload(payload); applyStatic(); });
refreshScheme();
applyStatic();
for (const b of document.querySelectorAll('[data-icon]')) b.prepend(icon(b.dataset.icon));
buildActions();
if (!original) failure(t('No document was named'), '');
else load().catch((err) => failure(t('The document could not be shown'), errText(err)));
