// Vex's PDF viewer: starts pdf.js on the PDF named in the address, builds the toolbar, and joins the pieces.
// The address is  vex-pdf://view/?u=<the PDF's address>#page=3&zoom=150  ; the tab itself shows the PDF's own address (js/webview.js).

import { t, applyStatic, getLang } from './strings.js';
import { applyThemePayload, onThemeChange, refreshScheme, SWATCHES, swatchHex } from './theme.js';
import { $, $$, el, icon, decorateIcons, openMenu, closeMenu, menuIsOpen, openDialog, toast } from './ui.js';
import { createMarkStore } from './marks.js';
import { createAnnotator } from './annotate.js';
import { createRail } from './rail.js';
import { createFind } from './find.js';
import * as actions from './actions.js';

const dom = {
  scroller: $('#pv-scroller'), viewer: $('#viewer'), main: $('#pv-main'), bar: $('#pv-bar'),
  state: $('#pv-state'), banner: $('#pv-banner'),
};

// ---- small stores -----------------------------------------------------------------------------------------
const persist = (document.querySelector('meta[name="vex-persist"]') || {}).content === '1';
const memory = { prefs: {}, positions: {} };
function readJson(key, fallback) {
  if (!persist) return null;
  try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (err) { console.warn('[PDF viewer] ' + key + ' could not be read:', err.message); return fallback; }
}
const prefs = {
  get() { return persist ? { ...(readJson('vexpdf:prefs', {})) } : { ...memory.prefs }; },
  set(patch) {
    const next = { ...this.get(), ...patch };
    if (persist) { try { localStorage.setItem('vexpdf:prefs', JSON.stringify(next)); } catch (err) { console.warn('[PDF viewer] preferences could not be kept:', err.message); } } else memory.prefs = next;
  },
};
const positions = {
  get(key) { const all = persist ? readJson('vexpdf:positions', {}) : memory.positions; return all[key] || null; },
  set(key, value) {
    const all = persist ? readJson('vexpdf:positions', {}) : memory.positions;
    delete all[key];
    all[key] = { ...value, at: Date.now() };
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete all[old];
    if (persist) { try { localStorage.setItem('vexpdf:positions', JSON.stringify(all)); } catch (err) { console.warn('[PDF viewer] the place in the file could not be kept:', err.message); } }
  },
};

// ---- the card shown instead of the document: loading, an error, a password ---------------------------------------------
let stateHandle = null;
function showState({ kind, title, text, actions: list, progress, indeterminate }) {
  dom.state.hidden = false;
  dom.state.textContent = '';
  const card = el('div', { class: 'pv-state-card', role: kind === 'error' ? 'alert' : 'status' });
  const ico = el('span', { class: 'pv-state-ico' });
  ico.innerHTML = icon(kind === 'error' ? 'warning' : kind === 'password' ? 'lock' : 'file', 34);
  const h = el('h1', { text: title });
  const p = el('p', { text: text || '' });
  card.append(ico, h, p);
  let bar = null;
  if (kind === 'busy') {
    bar = el('div', { class: 'pv-progress', 'data-indeterminate': indeterminate ? 'true' : 'false', role: 'progressbar', 'aria-label': title }, el('i'));
    if (progress != null) bar.style.setProperty('--p', Math.max(4, Math.round(progress * 100)) + '%');
    card.append(bar);
  }
  const row = el('div', { class: 'pv-dialog-actions' });
  for (const a of list || []) {
    const b = el('button', { class: 'pv-action' + (a.primary ? ' primary' : ''), type: 'button', text: a.label });
    b.addEventListener('click', a.run);
    row.append(b);
  }
  if (list && list.length) card.append(row);
  dom.state.append(card);
  const first = row.querySelector('button');
  if (first && kind !== 'busy') first.focus();
  const handle = {
    update(next) {
      if (next.text != null) p.textContent = next.text;
      if (next.title != null) h.textContent = next.title;
      if (bar && next.progress != null) { bar.dataset.indeterminate = 'false'; bar.style.setProperty('--p', Math.max(4, Math.round(next.progress * 100)) + '%'); }
    },
    close() { if (stateHandle === handle) { dom.state.hidden = true; dom.state.textContent = ''; stateHandle = null; } },
  };
  stateHandle = handle;
  return handle;
}

// ---- the address -----------------------------------------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const original = params.get('u') || '';
const isFile = /^file:/i.test(original);
function fileNameOf(address) {
  try {
    const u = new URL(address);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch { return address; }
}
const source = { original, name: fileNameOf(original), isFile };

function parseHash(raw) {
  const out = {};
  for (const part of String(raw || '').replace(/^#/, '').split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).toLowerCase()] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}
const hashParams = parseHash(location.hash);

// ---- start ---------------------------------------------------------------------------------------------------------------------
const host = window.vexPdfHost;
applyStatic(document);
decorateIcons(document);
refreshScheme();

function fatal(title, text, extra) {
  showState({ kind: 'error', title, text, actions: [{ label: t('Try again'), primary: true, run: () => location.reload() }, ...(extra || [])] });
}

let retitle = () => {};
if (host) {
  host.onTheme((payload) => { applyThemePayload(payload); applyStatic(document); retitle(); });
} else {
  fatal(t('The viewer could not start'), t('Vex\'s window did not give this page its connection. Close the tab and open the PDF again.'));
}

main().catch((err) => {
  console.error('[PDF viewer]', err);
  fatal(t('The viewer could not start'), err && err.message ? err.message : String(err));
});

async function main() {
  if (!host) return;
  if (!/^(https?|file):/i.test(original)) throw new Error(t('This address is not a PDF Vex can open: {address}', { address: original || t('(none)') }));
  const loading = showState({ kind: 'busy', title: t('Opening {name}', { name: source.name }), text: t('Getting the document...'), indeterminate: true });

  await import('/lib/pdf.mjs');
  const pdfjsLib = globalThis.pdfjsLib;
  if (!pdfjsLib) throw new Error('pdf.js did not load');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('/lib/pdf.worker.mjs', location.href).href;
  const pv = await import('/lib/pdf_viewer.mjs');

  // pdf.js asks for its words by id; the few it uses on the page get the viewer's own language.
  const l10n = {
    getLanguage: () => getLang(), getDirection: () => 'ltr',
    async get(id, args) { return id === 'pdfjs-page-landmark' ? t('Page {page}', { page: args && args.page }) : ''; },
    async translate(root) { for (const n of root.querySelectorAll ? root.querySelectorAll('[data-l10n-id="pdfjs-page-landmark"]') : []) { try { const a = JSON.parse(n.dataset.l10nArgs || '{}'); n.setAttribute('aria-label', t('Page {page}', { page: a.page })); } catch (err) { console.warn('[PDF viewer] a page label could not be set:', err && err.message); } } },
    async translateOnce() {}, async destroy() {}, pause() {}, resume() {},
  };

  const eventBus = new pv.EventBus();
  const linkService = new pv.PDFLinkService({ eventBus, externalLinkTarget: pv.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
  const findController = new pv.PDFFindController({ linkService, eventBus, updateMatchesCountOnProgress: true });
  const viewer = new pv.PDFViewer({
    container: dom.scroller, viewer: dom.viewer, eventBus, linkService, findController, l10n,
    textLayerMode: 1, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS, annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
    removePageBorders: true, enableScripting: false, maxCanvasPixels: 2 ** 25,
  });
  linkService.setViewer(viewer);

  const base = (p) => new URL(p, location.href).href;
  function open(password) {
    const task = pdfjsLib.getDocument({
      url: base('/doc?u=' + encodeURIComponent(original)),
      cMapUrl: base('/lib/cmaps/'), cMapPacked: true, standardFontDataUrl: base('/lib/standard_fonts/'), wasmUrl: base('/lib/wasm/'), iccUrl: base('/lib/iccs/'),
      isEvalSupported: false, enableXfa: false, disableAutoFetch: true, password: password || undefined,
    });
    task.onProgress = ({ loaded, total }) => { if (total) loading.update({ progress: loaded / total, text: t('Getting the document... {percent}%', { percent: Math.round(100 * loaded / total) }) }); };
    return task;
  }

  let pdf = null;
  let password = '';
  for (let attempt = 0; !pdf; attempt++) {
    const task = open(password);
    try { pdf = await task.promise; }
    catch (err) {
      if (err && err.name === 'PasswordException') {
        password = await askPassword(err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD, attempt);
        if (password == null) { loading.close(); return passwordGate(); }
        continue;
      }
      loading.close();
      return failed(err);
    }
  }
  loading.close();
  await run({ pdfjsLib, pv, eventBus, linkService, findController, viewer, pdf, password });

  function failed(err) {
    const status = err && err.status;
    let title = t('This PDF could not be opened'), text = err && err.message ? err.message : String(err);
    if (err && err.name === 'MissingPDFException') { title = t('This PDF is not there'); text = t('The address answered that there is no such file.'); }
    else if (err && err.name === 'InvalidPDFException') { title = t('This file is not a PDF Vex can read'); text = t('It is not a valid PDF, or it is damaged.'); }
    else if (err && err.name === 'UnexpectedResponseException') {
      title = t('The site did not give this PDF');
      text = status === 401 || status === 403 ? t('It answered {status}. If it needs you to sign in, sign in in this tab and try again.', { status }) : t('It answered {status}.', { status });
    } else if (status === 502) { title = t('The site could not be reached'); text = t('Vex could not fetch the PDF. Check the connection and try again.'); }
    showState({
      kind: 'error', title, text,
      actions: [
        { label: t('Try again'), primary: true, run: () => location.reload() },
        { label: t('Open in the browser\'s viewer'), run: () => actions.openInBrowserViewer({ host }) },
        { label: t('Download the file'), run: () => actions.downloadOriginal({ host }) },
      ],
    });
  }
  function passwordGate() {
    showState({
      kind: 'password', title: t('This PDF needs a password'), text: t('Nothing is shown until you enter it.'),
      actions: [{ label: t('Enter the password'), primary: true, run: () => location.reload() }, { label: t('Open in the browser\'s viewer'), run: () => actions.openInBrowserViewer({ host }) }],
    });
  }
  function askPassword(wrong, attempt) {
    return new Promise((resolve) => {
      const input = el('input', { type: 'password', autocomplete: 'off', 'aria-label': t('Password'), 'data-autofocus': '' });
      const err = el('p', { class: 'pv-err', role: 'alert', text: wrong || attempt > 0 ? t('That password is not right. Try again.') : '' });
      const body = el('label', { class: 'pv-field' }, el('span', { text: t('Password') }), input, err);
      let settled = false;
      const done = (v, close) => { if (settled) return; settled = true; close && close(); resolve(v); };
      const dlg = openDialog({
        title: t('This PDF needs a password'), lead: t('{name} is protected. Enter its password to read it. The password stays in this window and is not saved.', { name: source.name }), body,
        onCancel: () => { settled = true; resolve(null); }, backdropCancels: false,
        actions: [{ label: t('Cancel'), run: (close) => done(null, close) }, { label: t('Open'), primary: true, run: (close) => { if (!input.value) { input.focus(); return; } done(input.value, close); } }],
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!input.value) return; done(input.value, dlg.close); } });
    });
  }
}

// ---- the viewer ---------------------------------------------------------------------------------------------------------------------
async function run({ pdfjsLib, pv, eventBus, linkService, findController, viewer, pdf, password }) {
  dom.bar.inert = false;           // the tools are for a document that is open
  const saved = prefs.get();
  const store = createMarkStore();
  const state = {
    tool: 'select', width: saved.width || 2.5, textSize: saved.textSize || 14, shape: saved.shape || 'rect',
    colorIds: { highlight: 'yellow', underline: 'danger', strike: 'danger', ink: 'accent', text: 'ink', shape: 'danger', ...(saved.colorIds || {}) },
    markColor: {}, drawColor: '#000000',
    signaturePng: null, signatureB64: '', signatureUrl: '', signatureRatio: 0.3,
    tone: saved.tone || 'theme', fitMode: 'auto', present: false,
  };
  const ctx = {
    pdfjsLib, pv, eventBus, linkService, findController, viewer, pdf, store, host, source, prefs, state, dom, password,
    annot: null, hasOutline: false,
    showState,
    refit() { requestAnimationFrame(() => fit()); },
    revealPage(n) { if (viewer.currentPageNumber !== n && !pageVisible(n)) linkService.goToPage(n); },
    emitState,
    askSignature() { actions.askSignature(ctx, () => { annot.setTool('signature'); toast(t('Click on the page where the signature goes.'), { ms: 5000 }); }); },
    openColorMenu: (anchor, markId) => openColorMenu(anchor, markId),
    openExternal(url) { window.open(url, '_blank', 'noopener,noreferrer'); },
  };
  const toolGroup = (tool) => (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' ? 'shape' : tool);

  const pageVisible = (n) => { const v = viewer.getPageView(n - 1); if (!v || !v.div) return false; const r = v.div.getBoundingClientRect(), c = dom.scroller.getBoundingClientRect(); return r.bottom > c.top + 30 && r.top < c.bottom - 30; };

  // colours of the marks, from the theme, fixed when a mark is made
  function refreshColors() {
    for (const kind of ['highlight', 'underline', 'strike']) state.markColor[kind] = swatchHex(state.colorIds[kind]);
    state.drawColor = swatchHex(state.colorIds[toolGroup(state.tool)] || state.colorIds.ink);
    const dotGroup = ['highlight', 'underline', 'strike', 'ink', 'text'].includes(state.tool) ? state.tool : ['rect', 'ellipse', 'line', 'arrow'].includes(state.tool) ? 'shape' : 'highlight';
    document.getElementById('pv-color-dot').style.setProperty('--pv-mark-color', swatchHex(state.colorIds[dotGroup]));
  }
  onThemeChange(() => { refreshColors(); applyTone(); });

  // ---- the document's name and the text for Vex's other features -------------------------------------------------------
  let meta = {};
  try { meta = await pdf.getMetadata(); } catch (err) { console.warn('[PDF viewer] the document\'s details could not be read:', err && err.message); }
  const docTitle = ((meta.info && meta.info.Title) || '').trim();
  const shownTitle = docTitle && docTitle.length < 200 ? docTitle : source.name;
  const titleEl = $('#pv-doc-title'), subEl = $('#pv-doc-sub');
  retitle = () => {
    titleEl.textContent = shownTitle;
    subEl.textContent = (pdf.numPages === 1 ? t('1 page') : t('{n} pages', { n: pdf.numPages })) + (source.isFile ? ' · ' + t('On this computer') : ' · ' + hostOf(source.original));
    document.title = shownTitle;
  };
  retitle();
  function hostOf(address) { try { return new URL(address).hostname; } catch { return ''; } }

  // ---- the parts ---------------------------------------------------------------------------------------------------------------------
  ctx.rail = createRail(ctx);
  ctx.find = createFind(ctx);
  const annot = createAnnotator(ctx);
  ctx.annot = annot;
  ctx.rail.renderMarks();

  // ---- zoom, pages, view ---------------------------------------------------------------------------------------------------------
  const zoomText = $('#pv-zoom-text');
  const pageInput = $('#pv-page-input'), pageTotal = $('#pv-page-total');
  pageTotal.textContent = t('of {total}', { total: pdf.numPages });
  const FITS = new Set(['auto', 'page-fit', 'page-width', 'page-actual']);
  function setZoom(value) {
    state.fitMode = FITS.has(value) ? value : 'custom';
    viewer.currentScaleValue = String(value);
    updateZoomText();
  }
  function fit() { if (FITS.has(state.fitMode)) viewer.currentScaleValue = state.fitMode; }
  function updateZoomText() { zoomText.textContent = Math.round(viewer.currentScale * 100) + '%'; }
  const zoomBy = (factor, origin) => { state.fitMode = 'custom'; viewer.updateScale({ scaleFactor: factor, origin }); updateZoomText(); };
  eventBus.on('scalechanging', () => { updateZoomText(); remember(); });
  $('#pv-zoom-in').addEventListener('click', () => zoomBy(1.2));
  $('#pv-zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
  new ResizeObserver(() => fit()).observe(dom.scroller);

  // pinch (the engine reports a pinch as Ctrl + wheel) and Ctrl + wheel
  dom.scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0042)), [e.clientX, e.clientY]);
  }, { passive: false });

  // the page field
  function goto(n) { const target = Math.min(Math.max(1, Math.round(n)), pdf.numPages); linkService.goToPage(target); }
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const n = parseInt(pageInput.value, 10); if (Number.isFinite(n)) goto(n); pageInput.value = String(viewer.currentPageNumber); dom.scroller.focus({ preventScroll: true }); }
    else if (e.key === 'Escape') { e.preventDefault(); pageInput.value = String(viewer.currentPageNumber); dom.scroller.focus({ preventScroll: true }); }
    e.stopPropagation();
  });
  pageInput.addEventListener('focus', () => pageInput.select());
  pageInput.addEventListener('blur', () => { pageInput.value = String(viewer.currentPageNumber); });
  $('#pv-first').addEventListener('click', () => goto(1));
  $('#pv-last').addEventListener('click', () => goto(pdf.numPages));
  $('#pv-prev').addEventListener('click', () => viewer.previousPage());
  $('#pv-next').addEventListener('click', () => viewer.nextPage());
  eventBus.on('pagechanging', (e) => {
    pageInput.value = String(e.pageNumber);
    pageInput.setAttribute('aria-valuenow', String(e.pageNumber));
    document.documentElement.dataset.vexPdfPage = String(e.pageNumber);
    remember();
  });

  // scroll mode, spreads, rotation, tone
  const SCROLL = { vertical: pv.ScrollMode.VERTICAL, page: pv.ScrollMode.PAGE, wrapped: pv.ScrollMode.WRAPPED, horizontal: pv.ScrollMode.HORIZONTAL };
  const SPREAD = { none: pv.SpreadMode.NONE, odd: pv.SpreadMode.ODD, even: pv.SpreadMode.EVEN };
  function setScroll(name) { viewer.scrollMode = SCROLL[name]; dom.scroller.dataset.mode = name; prefs.set({ scroll: name }); updateViewIcon(); fitSoon(); }
  function setSpread(name) { viewer.spreadMode = SPREAD[name]; prefs.set({ spread: name }); updateViewIcon(); fitSoon(); }
  function fitSoon() { setTimeout(() => { fit(); updateZoomText(); }, 30); }
  function updateViewIcon() {
    const b = $('#pv-view-btn');
    const name = viewer.spreadMode !== pv.SpreadMode.NONE ? 'page-spread' : viewer.scrollMode === pv.ScrollMode.PAGE ? 'page-single' : 'page-scroll';
    b.dataset.iconDone = ''; b.innerHTML = icon(name, 18);
  }
  function rotate(by) { viewer.pagesRotation = ((viewer.pagesRotation + by) % 360 + 360) % 360; emitState(); toast(viewer.pagesRotation ? t('Turned. Save a copy to keep the turn.') : t('Back to the way the PDF was made.'), { ms: 2400 }); }
  function applyTone() {
    document.body.dataset.tone = state.tone;
    document.dispatchEvent(new CustomEvent('pv-tone'));
  }
  function setTone(name) { state.tone = name; prefs.set({ tone: name }); applyTone(); }

  // ---- toolbar state ---------------------------------------------------------------------------------------------------------------------
  const saveBtn = $('#pv-save'), undoBtn = $('#pv-undo'), redoBtn = $('#pv-redo');
  let formDirty = false;
  function emitState() {
    refreshColors();
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    const dirty = store.isDirty() || formDirty;
    const rotated = viewer.pagesRotation % 360 !== 0;
    saveBtn.disabled = !(store.count() || formDirty || rotated);
    saveBtn.dataset.dirty = dirty || rotated ? 'true' : 'false';
    const canSave = !!(store.count() || formDirty || rotated);
    saveBtn.title = canSave ? t('Save a copy with your changes (Ctrl+S)') : t('Nothing to save yet');
    window.__vexPdfDirty = dirty || rotated;
  }
  store.on(emitState);
  pdf.annotationStorage.onSetModified = () => { formDirty = true; emitState(); };
  pdf.annotationStorage.onResetModified = () => { formDirty = false; emitState(); };
  window.addEventListener('beforeunload', (e) => { if (window.__vexPdfDirty) { e.preventDefault(); e.returnValue = ''; } });

  // tools
  for (const b of $$('.pv-tools [data-tool]')) {
    if (b.id === 'pv-shape-btn') continue;
    b.addEventListener('click', () => {
      const tool = b.dataset.tool;
      if (tool === 'signature') { if (!state.signaturePng) { actions.askSignature(ctx, () => { annot.setTool('signature'); toast(t('Click on the page where the signature goes.'), { ms: 5000 }); }); return; } }
      annot.setTool(state.tool === tool && tool !== 'select' ? 'select' : tool);
    });
  }
  const SHAPES = [['rect', 'Rectangle', 'square'], ['ellipse', 'Ellipse', 'ellipse'], ['line', 'Line', 'line'], ['arrow', 'Arrow', 'arrow-up-right']];
  $('#pv-shape-btn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    openMenu({ anchor: btn, label: t('Shapes'), items: SHAPES.map(([id, label, ic]) => ({ id, label: t(label), icon: ic, role: 'menuitemradio', checked: state.shape === id, run: () => { state.shape = id; prefs.set({ shape: id }); setShapeIcon(); annot.setTool(id); } })) });
  });
  function setShapeIcon() {
    const found = SHAPES.find((x) => x[0] === state.shape) || SHAPES[0];
    const b = $('#pv-shape-btn');
    b.dataset.tool = state.shape;
    b.innerHTML = icon(found[2], 18);
  }
  setShapeIcon();
  undoBtn.addEventListener('click', () => store.undo());
  redoBtn.addEventListener('click', () => store.redo());
  saveBtn.addEventListener('click', () => actions.saveCopy(ctx));

  // colour, thickness, text size
  function openColorMenu(anchor, markId) {
    const group = markId ? (() => { const m = store.get(markId); return m ? (['rect', 'ellipse', 'line'].includes(m.kind) ? 'shape' : m.kind) : toolGroup(state.tool); })() : (['highlight', 'underline', 'strike', 'ink', 'text'].includes(state.tool) ? state.tool : ['rect', 'ellipse', 'line', 'arrow'].includes(state.tool) ? 'shape' : 'highlight');
    const swatches = el('div', { class: 'pv-swatches', role: 'presentation' });
    const current = markId ? null : state.colorIds[group];
    for (const sw of SWATCHES) {
      const b = el('button', { class: 'pv-swatch', type: 'button', role: 'menuitemradio', 'aria-checked': String(current === sw.id), 'aria-label': t(sw.name), title: t(sw.name), style: { '--sw': swatchHex(sw.id) }, tabindex: '-1' });
      b.addEventListener('click', () => {
        closeMenu(false);
        if (markId) { annot.recolor(markId, swatchHex(sw.id)); return; }
        state.colorIds[group] = sw.id;
        prefs.set({ colorIds: state.colorIds });
        refreshColors();
        const sel = annot.selectedId();
        if (sel) annot.recolor(sel, swatchHex(sw.id));
      });
      swatches.append(b);
    }
    const items = [{ type: 'label', text: t('Colour') }, { type: 'node', node: swatches }];
    if (!markId && ['ink', 'shape'].includes(group)) {
      const out = el('output', { text: String(state.width) });
      const range = el('input', { type: 'range', min: '1', max: '12', step: '0.5', value: String(state.width), 'aria-label': t('Line thickness') });
      range.addEventListener('input', () => { state.width = Number(range.value); out.textContent = range.value; prefs.set({ width: state.width }); });
      items.push({ type: 'label', text: t('Thickness') }, { type: 'node', node: el('div', { class: 'pv-range' }, range, out) });
    }
    if (!markId && group === 'text') {
      for (const size of [10, 12, 14, 18, 24, 32]) items.push({ id: 's' + size, label: t('{n} pt', { n: size }), role: 'menuitemradio', checked: state.textSize === size, run: () => { state.textSize = size; prefs.set({ textSize: size }); } });
      items.splice(2, 0, { type: 'label', text: t('Size') });
    }
    openMenu({ anchor, items, label: t('Mark colour and thickness') });
  }
  $('#pv-color-btn').addEventListener('click', (e) => openColorMenu(e.currentTarget, null));

  // ---- menus ---------------------------------------------------------------------------------------------------------------------------------
  function zoomMenu(anchor) {
    const input = el('input', { type: 'text', inputmode: 'numeric', class: 'pv-input', value: String(Math.round(viewer.currentScale * 100)), 'aria-label': t('Zoom in percent'), style: { width: '5.5em' } });
    const apply = () => { const n = parseFloat(input.value); if (Number.isFinite(n) && n >= 10 && n <= 1000) { closeMenu(false); setZoom(n / 100); } else toast(t('Zoom is between 10 and 1000 percent'), { kind: 'error' }); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } e.stopPropagation(); });
    const field = el('div', { class: 'pv-range' }, el('span', { text: t('Zoom to') }), input, el('span', { text: '%' }));
    const presets = [50, 75, 100, 125, 150, 200, 300, 400].map((n) => ({ id: 'z' + n, label: n + '%', role: 'menuitemradio', checked: state.fitMode === 'custom' && Math.round(viewer.currentScale * 100) === n, run: () => setZoom(n / 100) }));
    openMenu({
      anchor, label: t('Zoom'), items: [
        { type: 'node', node: field }, { type: 'sep' },
        { id: 'fw', label: t('Fit width'), icon: 'fit-width', keys: 'Ctrl+1', run: () => setZoom('page-width') },
        { id: 'fp', label: t('Fit page'), icon: 'fit-page', keys: 'Ctrl+2', run: () => setZoom('page-fit') },
        { id: 'as', label: t('Actual size'), icon: 'actual-size', keys: 'Ctrl+0', run: () => setZoom(1) },
        { id: 'au', label: t('Automatic'), icon: 'sparkles', run: () => setZoom('auto') },
        { type: 'sep' }, ...presets,
      ],
    });
    input.select();
  }
  $('#pv-zoom-btn').addEventListener('click', (e) => zoomMenu(e.currentTarget));

  function viewMenu(anchor) {
    const scrollName = Object.keys(SCROLL).find((k) => SCROLL[k] === viewer.scrollMode);
    const spreadName = Object.keys(SPREAD).find((k) => SPREAD[k] === viewer.spreadMode);
    openMenu({
      anchor, label: t('View'), items: [
        { type: 'label', text: t('Pages') },
        { id: 'sv', label: t('Continuous scroll'), icon: 'page-scroll', role: 'menuitemradio', checked: scrollName === 'vertical', run: () => setScroll('vertical') },
        { id: 'sp', label: t('One page at a time'), icon: 'page-single', role: 'menuitemradio', checked: scrollName === 'page', run: () => setScroll('page') },
        { id: 'sw', label: t('Wrapped'), icon: 'grid', role: 'menuitemradio', checked: scrollName === 'wrapped', run: () => setScroll('wrapped') },
        { type: 'sep' },
        { id: 'p1', label: t('Single pages'), role: 'menuitemradio', checked: spreadName === 'none', run: () => setSpread('none') },
        { id: 'p2', label: t('Two pages'), icon: 'page-spread', role: 'menuitemradio', checked: spreadName === 'odd', run: () => setSpread('odd') },
        { id: 'p3', label: t('Two pages with a cover'), role: 'menuitemradio', checked: spreadName === 'even', run: () => setSpread('even') },
        { type: 'sep' }, { type: 'label', text: t('Turn') },
        { id: 'rr', label: t('Turn right'), icon: 'rotate-cw', keys: 'R', run: () => rotate(90) },
        { id: 'rl', label: t('Turn left'), icon: 'rotate-ccw', keys: 'Shift+R', run: () => rotate(-90) },
        { type: 'sep' }, { type: 'label', text: t('Page tone') },
        { id: 't1', label: t('Match the theme'), role: 'menuitemradio', checked: state.tone === 'theme', run: () => setTone('theme') },
        { id: 't2', label: t('Original'), role: 'menuitemradio', checked: state.tone === 'original', run: () => setTone('original') },
        { id: 't3', label: t('Sepia'), role: 'menuitemradio', checked: state.tone === 'sepia', run: () => setTone('sepia') },
        { id: 't4', label: t('Night'), role: 'menuitemradio', checked: state.tone === 'night', run: () => setTone('night') },
      ],
    });
  }
  $('#pv-view-btn').addEventListener('click', (e) => viewMenu(e.currentTarget));

  function moreMenu(anchor) {
    openMenu({
      anchor, label: t('More'), items: [
        { id: 'pr', label: t('Print...'), icon: 'print', keys: 'Ctrl+P', run: () => actions.printDocument(ctx) },
        { id: 'pm', label: t('Presentation'), icon: 'present', keys: 'F', run: () => present(true) },
        { type: 'sep' },
        { id: 'sc', label: t('Save a copy...'), icon: 'save', keys: 'Ctrl+S', disabled: saveBtn.disabled, run: () => actions.saveCopy(ctx) },
        { id: 'sd', label: t('Save a copy in Downloads'), icon: 'download', disabled: saveBtn.disabled, run: () => actions.saveCopy(ctx, { toDownloads: true }) },
        { id: 'do', label: t('Download the original'), icon: 'download', run: () => actions.downloadOriginal(ctx) },
        { type: 'sep' },
        { id: 'ct', label: t('Copy the text of this page'), icon: 'copy', run: () => copyPageText() },
        { id: 'sg', label: t('Make a new signature...'), icon: 'signature', run: () => { state.signaturePng = null; actions.askSignature(ctx, () => toast(t('Signature ready. Choose the signature tool, then click on the page.'), { ms: 4500 })); } },
        { id: 'pp', label: t('Document properties'), icon: 'info', run: () => actions.showProperties(ctx) },
        { id: 'ks', label: t('Keyboard shortcuts'), icon: 'keyboard', keys: '?', run: () => actions.showShortcuts() },
        { type: 'sep' },
        { id: 'nv', label: t('Open in the browser\'s viewer'), icon: 'external', run: () => actions.openInBrowserViewer(ctx) },
      ],
    });
  }
  $('#pv-more-btn').addEventListener('click', (e) => moreMenu(e.currentTarget));

  async function pageText(n) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let out = '';
    for (const item of content.items) { out += item.str; out += item.hasEOL ? '\n' : (item.str && !/\s$/.test(item.str) ? ' ' : ''); }
    page.cleanup();
    return out.replace(/[ \t]+\n/g, '\n').trim();
  }
  async function copyPageText() {
    try {
      const text = await pageText(viewer.currentPageNumber);
      if (!text) { toast(t('This page has no text to copy. It may be a picture of a page.')); return; }
      await navigator.clipboard.writeText(text);
      toast(t('Copied the text of page {n}', { n: viewer.currentPageNumber }), { ms: 2400 });
    } catch (err) { toast(t('The text could not be copied: {why}', { why: err.message }), { kind: 'error' }); }
  }

  // ---- presentation --------------------------------------------------------------------------------------------------------------------------------
  let beforePresent = null;
  async function present(on) {
    if (on === state.present) return;
    if (on) {
      beforePresent = { scroll: viewer.scrollMode, spread: viewer.spreadMode, fit: state.fitMode, scale: viewer.currentScale, rail: ctx.rail.isOpen(), page: viewer.currentPageNumber };
      annot.setTool('select');
      state.present = true;
      document.body.dataset.present = 'true';
      let real = true;
      try { await document.documentElement.requestFullscreen(); } catch (err) { real = false; console.warn('[PDF viewer] full screen was not given:', err && err.message); }
      viewer.spreadMode = SPREAD.none;
      viewer.scrollMode = SCROLL.page;
      setZoom('page-fit');
      linkService.goToPage(beforePresent.page);
      dom.scroller.focus({ preventScroll: true });
      if (!real) toast(t('Press Esc to leave the presentation.'), { ms: 3500 });
      wakePager();
    } else {
      state.present = false;
      document.body.dataset.present = 'false';
      if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (err) { console.warn('[PDF viewer] full screen was not left cleanly:', err && err.message); } }
      if (beforePresent) {
        viewer.scrollMode = beforePresent.scroll; viewer.spreadMode = beforePresent.spread;
        if (beforePresent.fit === 'custom') setZoom(beforePresent.scale); else setZoom(beforePresent.fit);
        linkService.goToPage(viewer.currentPageNumber);
      }
      dom.scroller.dataset.mode = Object.keys(SCROLL).find((k) => SCROLL[k] === viewer.scrollMode);
      updateViewIcon();
      beforePresent = null;
    }
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && state.present) present(false); });
  let wake = 0;
  function wakePager() { document.body.classList.add('pv-awake'); clearTimeout(wake); wake = setTimeout(() => document.body.classList.remove('pv-awake'), 2200); }
  document.addEventListener('mousemove', () => { if (state.present) wakePager(); });
  dom.scroller.addEventListener('click', (e) => {
    if (!state.present || e.target.closest('a, button, input')) return;
    const r = dom.scroller.getBoundingClientRect();
    if (e.clientX < r.left + r.width * 0.3) viewer.previousPage(); else viewer.nextPage();
  });

  // ---- keys -------------------------------------------------------------------------------------------------------------------------------------------------
  const dialogOpen = () => !!document.querySelector('.pv-dialog-back');
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || dialogOpen() || menuIsOpen()) return;
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'f') { e.preventDefault(); ctx.find.open(); return; }
      if (key === 's') { e.preventDefault(); if (!saveBtn.disabled) actions.saveCopy(ctx); else actions.downloadOriginal(ctx); return; }
      if (key === 'p') { e.preventDefault(); actions.printDocument(ctx); return; }
      if (key === 'g') { e.preventDefault(); pageInput.focus(); return; }
      if (key === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if (key === 'y' && !typing) { e.preventDefault(); store.redo(); return; }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(1.2); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.2); return; }
      if (e.key === '0') { e.preventDefault(); setZoom(1); return; }
      if (e.key === '1') { e.preventDefault(); setZoom('page-width'); return; }
      if (e.key === '2') { e.preventDefault(); setZoom('page-fit'); return; }
      return;
    }
    if (e.key === 'F3') { e.preventDefault(); if (!ctx.find.isOpen()) ctx.find.open(); else ctx.find.again(e.shiftKey); return; }
    if (typing) return;
    if (annot.onKey(e)) return;
    if (state.present) {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'n'].includes(e.key) && !e.shiftKey) { e.preventDefault(); viewer.nextPage(); wakePager(); return; }
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'p'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); viewer.previousPage(); wakePager(); return; }
      if (e.key === 'Escape') { e.preventDefault(); present(false); return; }
    }
    if (e.key === 'Escape') { if (ctx.find.isOpen()) { e.preventDefault(); ctx.find.close(); return; } if (state.tool !== 'select') { e.preventDefault(); annot.setTool('select'); return; } }
    if (e.altKey) return;
    switch (e.key) {
      case 'v': annot.setTool('select'); break;
      case 'h': annot.setTool('hand'); break;
      case '1': annot.setTool('highlight'); break;
      case '2': annot.setTool('underline'); break;
      case '3': annot.setTool('strike'); break;
      case 'd': annot.setTool('ink'); break;
      case 't': annot.setTool('text'); break;
      case 's': annot.setTool(state.shape); break;
      case 'g': $('.pv-tools [data-tool="signature"]').click(); break;
      case 'R': rotate(-90); break;
      case 'r': rotate(90); break;
      case 'f': present(true); break;
      case 'b': ctx.rail.setOpen(!ctx.rail.isOpen()); break;
      case 'n': viewer.nextPage(); break;
      case 'p': viewer.previousPage(); break;
      case 'Home': if (!e.shiftKey) { e.preventDefault(); goto(1); } break;
      case 'End': if (!e.shiftKey) { e.preventDefault(); goto(pdf.numPages); } break;
      case '?': actions.showShortcuts(); break;
      case 'ArrowRight': if (viewer.scrollMode === pv.ScrollMode.PAGE) { e.preventDefault(); viewer.nextPage(); } break;
      case 'ArrowLeft': if (viewer.scrollMode === pv.ScrollMode.PAGE) { e.preventDefault(); viewer.previousPage(); } break;
      default: return;
    }
  });
  // The hand: drag the page.
  let pan = null;
  dom.scroller.addEventListener('pointerdown', (e) => {
    if (state.tool !== 'hand' || e.button !== 0) return;
    pan = { x: e.clientX, y: e.clientY, left: dom.scroller.scrollLeft, top: dom.scroller.scrollTop };
    dom.scroller.classList.add('drag');
    dom.scroller.setPointerCapture(e.pointerId);
  });
  dom.scroller.addEventListener('pointermove', (e) => { if (!pan) return; dom.scroller.scrollLeft = pan.left - (e.clientX - pan.x); dom.scroller.scrollTop = pan.top - (e.clientY - pan.y); });
  for (const ev of ['pointerup', 'pointercancel']) dom.scroller.addEventListener(ev, () => { pan = null; dom.scroller.classList.remove('drag'); });

  // ---- where you were -----------------------------------------------------------------------------------------------------------------------------------------
  const key = original.replace(/#.*$/, '');
  let rememberTimer = 0;
  function remember() {
    if (!persist || !ready) return;
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(() => positions.set(key, { page: viewer.currentPageNumber, scale: state.fitMode === 'custom' ? viewer.currentScale : state.fitMode }), 600);
  }
  let ready = false;

  eventBus.on('pagesinit', () => {
    // A #page= or #zoom= in the address wins; then the place left last time; then the default.
    const place = positions.get(key);
    let scale = hashParams.zoom ? hashParams.zoom.split(',')[0] : null;
    if (scale && /^\d+(\.\d+)?$/.test(scale)) scale = Number(scale) / 100;
    else if (scale && !FITS.has(scale) && scale !== 'fit' && scale !== 'FitH') scale = null;
    if (scale === 'fit' || scale === 'FitH') scale = scale === 'fit' ? 'page-fit' : 'page-width';
    if (!scale && place && !hashParams.page) scale = place.scale;
    setZoom(scale || (saved.zoomDefault || 'auto'));
    const page = Math.min(hashParams.page ? parseInt(hashParams.page, 10) : (place ? place.page : 1), pdf.numPages);
    if (page > 1) {
      // The engine settles its own first view after this event, so the page is asked for again once the first page is drawn.
      linkService.goToPage(page);
      const again = () => { eventBus.off('pagerendered', again); if (viewer.currentPageNumber !== page && dom.scroller.scrollTop < 40) linkService.goToPage(page); };
      eventBus.on('pagerendered', again);
    }
    if (hashParams.nameddest) linkService.goToDestination(hashParams.nameddest);
    if (hashParams.search) { ctx.find.open(false); $('#pv-find-input').value = hashParams.search; $('#pv-find-input').dispatchEvent(new Event('input')); }
    const sp = saved.scroll || 'vertical';
    if (sp !== 'vertical') setScroll(sp);
    if (saved.spread && saved.spread !== 'none') setSpread(saved.spread);
    pageInput.value = String(viewer.currentPageNumber);
    updateViewIcon();
    updateZoomText();
    applyTone();
    ready = true;
    dom.scroller.focus({ preventScroll: true });
  });

  // the rail as it was left, or open for a document with an outline
  const wantRail = hashParams.pagemode ? /^(thumbs|bookmarks|outline)$/.test(hashParams.pagemode) : saved.railOpen;
  if (saved.railWidth) ctx.rail.setWidth(saved.railWidth, false);
  if (wantRail) ctx.rail.setOpen(true);
  ctx.rail.selectPane(hashParams.pagemode === 'bookmarks' || hashParams.pagemode === 'outline' ? 'outline' : (saved.railPane || 'pages'));
  ctx.rail.loadOutline().then(() => {
    // A document with an outline and no memory of the rail: show the outline, which is how one is meant to be read.
    if (ctx.hasOutline && saved.railOpen == null && !hashParams.pagemode) { ctx.rail.setOpen(true); ctx.rail.selectPane('outline'); }
  });

  // ---- a form ---------------------------------------------------------------------------------------------------------------------------------------------------------
  pdf.getFieldObjects().then((fields) => {
    if (!fields || !(fields instanceof Map ? fields.size : Object.keys(fields).length)) return;
    dom.banner.hidden = false;
    dom.banner.textContent = '';
    const close = el('button', { class: 'pv-btn', type: 'button', 'aria-label': t('Close'), title: t('Close') });
    close.innerHTML = icon('x', 16);
    close.addEventListener('click', () => { dom.banner.hidden = true; });
    dom.banner.append(el('span', { text: t('This PDF is a form. Fill it in on the page, then use Save a copy to keep your answers.') }), close);
    setTimeout(() => { dom.banner.hidden = true; }, 14000);
  }).catch((err) => console.warn('[PDF viewer] the form fields could not be listed:', err && err.message));

  // ---- the words of the document, for Vex's other features ---------------------------------------------------------------------------------------------------------
  // Ask Vex, summaries and the page-text readers read a page with document.body.innerText; the pages here are pictures, so the words
  // are also kept (out of sight) in an <article>, filled in the background up to a size. window.vexPdfDoc answers for any one page.
  const mirror = el('article', { id: 'vex-pdf-text', class: 'pv-sr', 'aria-hidden': 'true' });
  document.body.append(mirror);
  window.vexPdfDoc = { title: shownTitle, pages: pdf.numPages, address: original, currentPage: () => viewer.currentPageNumber, pageText };
  window.__pdf = pdf;
  (async () => {
    let total = 0;
    const heading = el('h1', { text: shownTitle });
    mirror.append(heading);
    for (let n = 1; n <= pdf.numPages && total < 60000; n++) {
      let text = '';
      try { text = await pageText(n); } catch (err) { console.warn('[PDF viewer] page ' + n + ' has no readable text:', err && err.message); continue; }
      if (!text) continue;
      const section = el('section', { 'data-page': String(n) }, el('h2', { text: t('Page {n}', { n }) }), el('p', { text }));
      mirror.append(section);
      total += text.length;
      if (n % 4 === 0) await new Promise((r) => setTimeout(r, 30));
    }
  })().catch((err) => console.warn('[PDF viewer] the document\'s words could not be gathered:', err && err.message));

  // the first look. The document is handed to the viewer last, so every event it raises finds its listener.
  refreshColors();
  applyTone();
  emitState();
  linkService.setDocument(pdf, null);
  viewer.setDocument(pdf);
  host.tell('ready', { pages: pdf.numPages });
}
