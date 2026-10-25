// The side rail: page thumbnails, the document's outline (its bookmarks), and the list of the marks made here.

import { t } from './strings.js';
import { el, icon, $, $$ } from './ui.js';

const THUMB_W = 150;

export function createRail(ctx) {
  const { pdf, viewer, linkService, store, eventBus } = ctx;
  const rail = document.getElementById('pv-rail');
  const toggle = document.getElementById('pv-rail-toggle');
  const tabs = $$('.pv-rail-tab', rail);
  const panes = { pages: $('#pv-pane-pages'), outline: $('#pv-pane-outline'), marks: $('#pv-pane-marks') };
  const thumbsEl = $('#pv-thumbs');
  const outlineEl = $('#pv-outline');
  const marksEl = $('#pv-marks');
  const countEl = $('#pv-marks-count');
  let pane = 'pages';
  const thumbs = new Map();
  let io = null;
  let queue = [];
  let running = 0;
  let ratio = 0.7727;
  let built = false;

  // ---- opening, tabs, width ------------------------------------------------------
  function setOpen(open) {
    rail.hidden = !open;
    document.body.dataset.rail = open ? 'open' : 'closed';
    toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
    ctx.prefs.set({ railOpen: open });
    if (open) { build(); revealCurrent(); }
    ctx.refit();
  }
  toggle.addEventListener('click', () => setOpen(rail.hidden));

  function selectPane(name, focus) {
    pane = name;
    for (const tab of tabs) {
      const on = tab.dataset.pane === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    for (const [key, node] of Object.entries(panes)) node.hidden = key !== name;
    ctx.prefs.set({ railPane: name });
    if (name === 'pages') { build(); revealCurrent(); }
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectPane(tab.dataset.pane));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j >= 0) { e.preventDefault(); selectPane(tabs[j].dataset.pane, true); }
    });
  }

  const grip = $('#pv-rail-grip');
  const setWidth = (px, save) => {
    const w = Math.max(190, Math.min(460, Math.round(px)));
    document.documentElement.style.setProperty('--pv-rail-w', w + 'px');
    if (save) ctx.prefs.set({ railWidth: w });
    return w;
  };
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.classList.add('drag');
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => setWidth(ev.clientX - rail.getBoundingClientRect().left, false);
    const up = (ev) => { grip.classList.remove('drag'); setWidth(ev.clientX - rail.getBoundingClientRect().left, true); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); ctx.refit(); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('keydown', (e) => {
    const cur = rail.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(cur - 16, true); ctx.refit(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(cur + 16, true); ctx.refit(); }
  });

  // ---- thumbnails -----------------------------------------------------------------
  async function build() {
    if (built) return;
    built = true;
    const first = await pdf.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    ratio = vp.width / vp.height;
    thumbsEl.style.setProperty('--pv-thumb-ratio', String(ratio));
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= pdf.numPages; n++) {
      const box = el('span', { class: 'pv-thumb-box' });
      const b = el('button', { class: 'pv-thumb', type: 'button', role: 'listitem', 'data-page': String(n), 'aria-label': t('Go to page {n}', { n }) }, box, el('span', { class: 'pv-thumb-num', text: String(n) }));
      b.addEventListener('click', () => { linkService.goToPage(n); ctx.dom.scroller.focus({ preventScroll: true }); });
      thumbs.set(n, { button: b, box, state: 0 });
      frag.append(b);
    }
    thumbsEl.append(frag);
    io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const n = Number(entry.target.dataset.page);
        const th = thumbs.get(n);
        if (!th) continue;
        if (entry.isIntersecting) { if (th.state === 0) { th.state = 1; queue.push(n); } }
        else if (th.state === 1) { th.state = 0; queue = queue.filter((q) => q !== n); }
      }
      pump();
    }, { root: panes.pages, rootMargin: '200px 0px' });
    for (const th of thumbs.values()) io.observe(th.button);
    markCurrent(viewer.currentPageNumber);
  }

  function pump() {
    while (running < 2 && queue.length) {
      const n = queue.shift();
      const th = thumbs.get(n);
      if (!th || th.state !== 1) continue;
      running++;
      render(n, th).catch((err) => { console.warn('[PDF viewer] a thumbnail could not be drawn:', err && err.message); th.state = 3; }).finally(() => { running--; pump(); });
    }
  }
  async function render(n, th) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = (THUMB_W * (window.devicePixelRatio || 1)) / base.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    th.box.style.aspectRatio = base.width + ' / ' + base.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, annotationMode: 0 }).promise;
    th.box.replaceChildren(canvas);
    th.state = 2;
    page.cleanup();
  }

  function markCurrent(n) {
    for (const [k, th] of thumbs) { if (k === n) th.button.setAttribute('aria-current', 'page'); else th.button.removeAttribute('aria-current'); }
  }
  function revealCurrent() {
    const th = thumbs.get(viewer.currentPageNumber);
    if (th && !rail.hidden && pane === 'pages') th.button.scrollIntoView({ block: 'nearest' });
  }
  eventBus.on('pagechanging', (e) => { markCurrent(e.pageNumber); if (!rail.hidden && pane === 'pages') thumbs.get(e.pageNumber)?.button.scrollIntoView({ block: 'nearest' }); });

  // ---- outline ----------------------------------------------------------------------
  let outlineLoaded = false;
  async function loadOutline() {
    if (outlineLoaded) return;
    outlineLoaded = true;
    let items = null;
    try { items = await pdf.getOutline(); } catch (err) { console.warn('[PDF viewer] the outline could not be read:', err && err.message); }
    ctx.hasOutline = !!(items && items.length);
    tabs.find((x) => x.dataset.pane === 'outline').dataset.empty = ctx.hasOutline ? '' : '1';
    outlineEl.textContent = '';
    if (!ctx.hasOutline) { outlineEl.append(el('p', { class: 'pv-empty', text: t('This document has no outline.') })); return; }
    const build = (list, depth) => {
      const ul = el('ul', { role: depth ? 'group' : 'tree', 'aria-label': depth ? null : t('Outline') });
      for (const item of list) {
        const kids = item.items && item.items.length;
        const li = el('li', { role: 'treeitem', 'aria-expanded': kids ? String(!(item.count < 0) && depth < 1) : null });
        const row = el('div', { class: 'pv-ol-row' });
        let childList = null;
        if (kids) {
          const open = !(item.count < 0) && depth < 1;
          const tg = el('button', { class: 'pv-ol-toggle', type: 'button', 'aria-expanded': String(open), 'aria-label': t('Show or hide the sections below {title}', { title: item.title }) });
          tg.innerHTML = icon('chevron-right', 14);
          tg.addEventListener('click', () => { const now = tg.getAttribute('aria-expanded') !== 'true'; tg.setAttribute('aria-expanded', String(now)); li.setAttribute('aria-expanded', String(now)); childList.hidden = !now; });
          row.append(tg);
        } else row.append(el('span', { class: 'pv-ol-spacer', 'aria-hidden': 'true' }));
        const link = el('button', { class: 'pv-ol-link', type: 'button', text: item.title || t('Untitled section'), dir: 'auto' });
        if (item.bold) link.style.fontWeight = '700';
        if (item.italic) link.style.fontStyle = 'italic';
        link.addEventListener('click', () => {
          if (item.url) { ctx.openExternal(item.url); return; }
          if (item.dest) linkService.goToDestination(item.dest);
        });
        row.append(link);
        li.append(row);
        if (kids) {
          childList = build(item.items, depth + 1);
          childList.hidden = !(!(item.count < 0) && depth < 1);
          li.append(childList);
        }
        ul.append(li);
      }
      return ul;
    };
    outlineEl.append(build(items, 0));
  }

  // ---- the marks made here ---------------------------------------------------------------
  const KIND_NAMES = { highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', ink: 'Drawing', text: 'Text note', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', signature: 'Signature' };
  function describe(m) {
    if (m.kind === 'text') return m.text.replace(/\s+/g, ' ').slice(0, 80);
    return t(KIND_NAMES[m.kind] || m.kind);
  }
  function renderMarks() {
    const list = store.list().sort((a, b) => a.page - b.page);
    countEl.hidden = !list.length;
    countEl.textContent = String(list.length);
    marksEl.textContent = '';
    if (!list.length) { marksEl.append(el('p', { class: 'pv-empty', text: t('No marks yet. Select words and press Highlight, or choose a tool in the toolbar.') })); return; }
    let currentPage = 0;
    for (const m of list) {
      if (m.page !== currentPage) { currentPage = m.page; marksEl.append(el('div', { class: 'pv-mark-group', text: t('Page {n}', { n: m.page }) })); }
      const row = el('div', { class: 'pv-mark-row', 'aria-current': ctx.annot && ctx.annot.selectedId() === m.id ? 'true' : null });
      const go = el('button', { class: 'pv-mark-go', type: 'button' }, el('span', { class: 'pv-mark-chip', style: { '--mk': m.color } }), el('span', { class: 'pv-mark-text', text: describe(m), dir: 'auto' }), m.kind === 'text' ? el('span', { class: 'pv-mark-kind', text: t('Text note') }) : null);
      go.addEventListener('click', () => ctx.annot.focusMark(m.id));
      const del = el('button', { class: 'pv-btn', type: 'button', 'aria-label': t('Delete the mark'), title: t('Delete the mark') });
      del.innerHTML = icon('trash', 15);
      del.addEventListener('click', () => store.remove(m.id));
      row.append(go, del);
      marksEl.append(row);
    }
  }
  store.on(() => renderMarks());
  renderMarks();

  return {
    setOpen, selectPane, loadOutline, renderMarks, markCurrent,
    isOpen: () => !rail.hidden,
    pane: () => pane,
    setWidth,
  };
}
