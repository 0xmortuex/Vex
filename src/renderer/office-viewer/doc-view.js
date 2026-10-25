// The reading view for text documents (Word, OpenDocument text, RTF): the document as a flowing page or as a sheet of paper,
// a contents list, comments in the side panel, tracked changes shown / accepted / rejected, zoom, find.

import { el, icon, button, menuButton, toast, copyText } from './ui.js';
import { t } from './strings.js';
import { createTextFinder } from './find.js';
import { surfaceHex, onThemeChange } from './theme.js';

// shell: see app.js. source: { render(host, opts) -> Promise<{ root, outline, comments, unsupported }>, hasChanges, hasComments, page: {w,h,top,right,bottom,left} | null, macros }
export function createDocView(shell, source) {
  const prefs = shell.prefs;
  const state = {
    mode: prefs.get('doc.mode', 'flow'), changes: prefs.get('doc.changes', 'all'), comments: prefs.get('doc.comments', true), zoom: prefs.get('doc.zoom', 100),
    info: null, token: { cancelled: false }, rendering: null,
  };
  const paper = el('div', { class: 'od-paper', 'data-mode': state.mode });
  const scroller = el('div', { class: 'od-scroller', id: 'od-scroller', tabindex: '0', role: 'document', 'aria-label': t('Document') }, paper);
  const root = el('div', { class: 'od-docview' }, scroller);
  const finder = createTextFinder(() => paper, () => scroller);

  // ---- toolbar ----------------------------------------------------------------------------------------------------------
  const modeBtn = button({ icon: state.mode === 'page' ? 'od-page' : 'od-flow', title: t('Layout'), aria: t('Layout'), menu: true });
  menuButton(modeBtn, () => [
    { label: t('Flowing text'), role: 'menuitemradio', checked: state.mode === 'flow', run: () => setMode('flow') },
    { label: t('Sheet of paper'), role: 'menuitemradio', checked: state.mode === 'page', run: () => setMode('page') },
  ]);
  const changesBtn = button({ icon: 'edit', title: t('Tracked changes'), aria: t('Tracked changes'), menu: true });
  menuButton(changesBtn, () => [
    { label: t('Show changes'), role: 'menuitemradio', checked: state.changes === 'all', run: () => setChanges('all') },
    { label: t('Final text (changes accepted)'), role: 'menuitemradio', checked: state.changes === 'final', run: () => setChanges('final') },
    { label: t('Original text (changes rejected)'), role: 'menuitemradio', checked: state.changes === 'original', run: () => setChanges('original') },
  ]);
  const commentsBtn = button({ icon: 'od-comment', title: t('Comments'), aria: t('Comments'), pressed: state.comments, onclick: () => { setComments(!state.comments); } });
  const zoomOut = button({ icon: 'minus', title: t('Zoom out') + ' (Ctrl+-)', aria: t('Zoom out'), onclick: () => zoomBy(-10) });
  const zoomIn = button({ icon: 'plus', title: t('Zoom in') + ' (Ctrl+=)', aria: t('Zoom in'), onclick: () => zoomBy(10) });
  const zoomLabel = el('button', { type: 'button', class: 'od-zoomval', title: t('Reset the zoom') + ' (Ctrl+0)', 'aria-label': t('Reset the zoom'), onclick: () => setZoom(100) });
  const zoomBox = el('div', { class: 'od-zoom', role: 'group', 'aria-label': t('Zoom') }, zoomOut, zoomLabel, zoomIn);
  const tools = [modeBtn];
  if (source.hasChanges) tools.push(changesBtn);
  if (source.hasComments) tools.push(commentsBtn);
  tools.push(zoomBox);

  function setMode(m) { state.mode = m; prefs.set('doc.mode', m); modeBtn.innerHTML = ''; modeBtn.insertAdjacentHTML('afterbegin', icon(m === 'page' ? 'od-page' : 'od-flow', 18)); render(true); }
  function setChanges(c) { state.changes = c; prefs.set('doc.changes', c); render(true); }
  function setComments(on) { state.comments = on; prefs.set('doc.comments', on); commentsBtn.setAttribute('aria-pressed', String(on)); render(true); }
  function setZoom(z) { state.zoom = Math.max(50, Math.min(250, Math.round(z))); prefs.set('doc.zoom', state.zoom); applyZoom(); }
  const zoomBy = (d) => setZoom(state.zoom + d);
  function applyZoom() { paper.style.zoom = String(state.zoom / 100); zoomLabel.textContent = state.zoom + '%'; zoomOut.disabled = state.zoom <= 50; zoomIn.disabled = state.zoom >= 250; }

  // ---- rail ---------------------------------------------------------------------------------------------------------------------
  const contents = el('nav', { class: 'od-outline', 'aria-label': t('Contents') });
  const commentList = el('div', { class: 'od-commentlist', role: 'list', 'aria-label': t('Comments') });
  function drawOutline() {
    contents.replaceChildren();
    const out = state.info.outline;
    if (!out.length) { contents.append(el('p', { class: 'od-empty-note', text: t('This document has no headings.') })); return; }
    const min = Math.min(...out.map((o) => o.level));
    for (const o of out) {
      const b = el('button', { type: 'button', class: 'od-ol', style: { '--lvl': String(o.level - min) }, text: o.text, title: o.text });
      b.addEventListener('click', () => { const target = paper.querySelector('#' + o.id); if (target) { target.scrollIntoView({ block: 'start' }); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); flash(target); } });
      contents.append(b);
    }
  }
  function drawComments() {
    commentList.replaceChildren();
    const list = state.info.comments;
    if (!list.length) { commentList.append(el('p', { class: 'od-empty-note', text: state.comments ? t('This document has no comments.') : t('Comments are hidden.') })); return; }
    list.forEach((c, i) => {
      const text = c.text != null ? c.text : '';
      const item = el('button', { type: 'button', class: 'od-comment', role: 'listitem', 'data-cid': c.id },
        el('span', { class: 'od-cm-num', text: String(i + 1) }),
        el('span', { class: 'od-cm-body' }, el('span', { class: 'od-cm-who', text: (c.author || t('Someone')) + (c.date ? ' · ' + String(c.date).slice(0, 10) : '') }), el('span', { class: 'od-cm-text', text })));
      item.addEventListener('click', () => { const m = paper.querySelector('.od-cm[data-cid="' + c.id + '"]'); if (m) { m.scrollIntoView({ block: 'center' }); flash(m.closest('mark') || m); } });
      commentList.append(item);
    });
  }
  const flash = (node) => { node.classList.remove('od-flash'); void node.offsetWidth; node.classList.add('od-flash'); setTimeout(() => node.classList.remove('od-flash'), 1600); };

  // ---- rendering -------------------------------------------------------------------------------------------------------------------
  async function render(keepPlace) {
    state.token.cancelled = true;
    const token = { cancelled: false };
    state.token = token;
    const y = keepPlace ? scroller.scrollTop / Math.max(1, scroller.scrollHeight) : 0;
    paper.dataset.mode = state.mode;
    const page = source.page;
    if (state.mode === 'page' && page) {
      paper.style.setProperty('--od-page-w', Math.min(page.w, 1400) + 'px');
      paper.style.setProperty('--od-page-pad', `${Math.min(page.top, 200)}px ${Math.min(page.right, 200)}px ${Math.min(page.bottom, 200)}px ${Math.min(page.left, 200)}px`);
    } else { paper.style.removeProperty('--od-page-w'); paper.style.removeProperty('--od-page-pad'); }
    const surface = state.mode === 'page' ? '#ffffff' : surfaceHex();
    const host = document.createElement('div');
    paper.setAttribute('aria-busy', 'true');
    let info;
    try { info = await source.render(host, { changes: state.changes, comments: state.comments, surface, paper: state.mode === 'page', token }); }
    finally { if (state.token === token) paper.removeAttribute('aria-busy'); }
    if (!info || token.cancelled) return null;
    paper.replaceChildren(...host.childNodes);
    state.info = info;
    finder.clear();
    drawOutline();
    drawComments();
    shell.rail.count('comments', info.comments.length);
    applyZoom();
    if (keepPlace) scroller.scrollTop = y * scroller.scrollHeight;
    const u = info.unsupported || {};
    const parts = [];
    if (u.chart) parts.push(t('{n} chart(s)', { n: u.chart }));
    if (u.diagram) parts.push(t('{n} diagram(s)', { n: u.diagram }));
    if (u.picture) parts.push(t('{n} picture(s) that could not be shown', { n: u.picture }));
    if (u.shape) parts.push(t('{n} drawn shape(s)', { n: u.shape }));
    shell.banner(parts.length ? t('Not shown in this view: {list}. Download the original to see them.', { list: parts.join(', ') }) : null);
    return info;
  }

  // ---- events ------------------------------------------------------------------------------------------------------------------------
  paper.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        e.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        const target = paper.querySelector('[id="' + CSS.escape(id) + '"]');
        if (target) { target.scrollIntoView({ block: 'center' }); flash(target.closest('li, p') || target); }
      }
      return;
    }
    const m = e.target.closest('.od-cm');
    if (m) { shell.rail.open('comments'); const item = commentList.querySelector('[data-cid="' + m.dataset.cid + '"]'); if (item) { item.scrollIntoView({ block: 'nearest' }); item.focus(); flash(item); } }
  });
  scroller.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(10); }
    else if (ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomBy(-10); }
    else if (ctrl && e.key === '0') { e.preventDefault(); setZoom(100); }
    else if (e.key === 'Home' && !ctrl) { /* the browser's own */ }
  });
  const offTheme = onThemeChange(() => { if (state.mode === 'flow' && state.info) render(true); });

  const view = {
    root, scroller, tools,
    async start() { await render(false); scroller.focus({ preventScroll: true }); },
    rail: {
      tabs: [
        { id: 'contents', label: t('Contents'), icon: 'list', build: (pane) => pane.append(contents) },
        ...(source.hasComments ? [{ id: 'comments', label: t('Comments'), icon: 'od-comment', build: (pane) => pane.append(commentList), count: true }] : []),
      ],
    },
    text() { return paper.innerText; },
    async find(q, opts) { return finder.run(q, opts); },
    findStep(dir) { return finder.step(dir); },
    clearFind() { finder.clear(); },
    zoomKeys(e) { const ctrl = e.ctrlKey || e.metaKey; if (!ctrl) return false; if (e.key === '=' || e.key === '+') { zoomBy(10); return true; } if (e.key === '-' || e.key === '_') { zoomBy(-10); return true; } if (e.key === '0') { setZoom(100); return true; } return false; },
    printPrepare() { return Promise.resolve(); },
    printDone() {},
    focus() { scroller.focus({ preventScroll: true }); },
    about() {
      return [t('Shown: the text, headings, lists, tables, pictures, links, footnotes, comments and tracked changes.'), t('Not shown: page layout such as columns and exact page breaks, headers and footers, charts, SmartArt and drawn shapes.')];
    },
    destroy() { state.token.cancelled = true; offTheme(); finder.clear(); root.remove(); },
  };
  void toast; void copyText;
  return view;
}
