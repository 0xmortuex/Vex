// The e-book reader (EPUB): chapters one at a time in a reading column, a contents list, text size / font / line spacing / column
// width, three tones (the theme's own, sepia, and the book's own paper), where you stopped (kept per book on this computer), search
// across the whole book, and highlights kept on this computer. Nothing is sent anywhere; a private or Tor tab keeps nothing.

import { el, icon, button, menuButton, openMenu, closeMenu, toast, copyText, debounce } from './ui.js';
import { t } from './strings.js';
import { renderChapter, chapterText } from './epub.js';
import { findOffsets, findRanges, paintFind, clearFind, revealRange, fold } from './find.js';

const COLORS = ['yellow', 'green', 'blue', 'pink'];
const FONTS = { theme: 'var(--od-font)', serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif', sans: '"Segoe UI", system-ui, -apple-system, sans-serif' };
const WIDTHS = { narrow: 560, medium: 720, wide: 940 };

function bookKey(model) {
  const s = (model.id || '') + '|' + model.title + '|' + model.chapters.length + '|' + model.author;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function createBookView(shell, model) {
  const prefs = shell.prefs;
  const key = bookKey(model);
  const state = {
    chapter: 0, token: 0, tone: prefs.get('book.tone', 'theme'), size: prefs.get('book.size', 19), lh: prefs.get('book.lh', 1.7), width: prefs.get('book.width', 'medium'), font: prefs.get('book.font', 'theme'),
    highlights: prefs.get('book.hl.' + key, []), find: null, wrap: null, selection: null,
  };
  const saved = prefs.get('book.pos.' + key, null);

  const page = el('div', { class: 'od-bookpage' });
  const prevCh = button({ icon: 'arrow-left', label: t('Previous chapter'), title: t('Previous chapter') + ' ([)', onclick: () => open(state.chapter - 1) });
  const nextCh = button({ icon: 'arrow-right', label: t('Next chapter'), title: t('Next chapter') + ' (])', onclick: () => open(state.chapter + 1) });
  const nav = el('div', { class: 'od-booknav' }, prevCh, nextCh);
  const scroller = el('div', { class: 'od-scroller od-bookscroll', id: 'od-scroller', tabindex: '0', role: 'article', 'aria-label': t('Chapter') }, page, nav);
  const bar = el('div', { class: 'od-bookprogress' });
  const barFill = el('div', { class: 'od-progress-fill' });
  const progressText = el('span', { class: 'od-progress-text', 'aria-live': 'off' });
  bar.append(el('div', { class: 'od-progress', role: 'progressbar', 'aria-label': t('Reading progress'), 'aria-valuemin': '0', 'aria-valuemax': '100' }, barFill), progressText);
  const selbar = el('div', { class: 'od-selbar', role: 'toolbar', 'aria-label': t('Selected text'), hidden: true });
  const root = el('div', { class: 'od-bookview' }, scroller, bar, selbar);
  const progressBarEl = bar.querySelector('.od-progress');

  // ---- look -----------------------------------------------------------------------------------------------------------------------
  function applyLook() {
    root.dataset.tone = state.tone;
    root.style.setProperty('--bk-size', state.size + 'px');
    root.style.setProperty('--bk-lh', String(state.lh));
    root.style.setProperty('--bk-width', WIDTHS[state.width] + 'px');
    root.style.setProperty('--bk-font', FONTS[state.font]);
  }
  const save = (k, v) => { state[k] = v; prefs.set('book.' + k, v); applyLook(); };
  let displayBtn;
  function displayPanel() {
    const mk = (label, items, current, setter, radio) => {
      return el('div', { class: 'od-popgroup', role: 'radiogroup', 'aria-label': label }, el('span', { class: 'od-poplabel', text: label }),
        el('div', { class: 'od-popchoices' }, items.map(([id, text]) => el('button', { type: 'button', class: 'od-chip', role: 'radio', 'aria-checked': String(current === id), 'data-id': id, text, onclick: () => { setter(id); closePanel(); displayBtn.click(); } }))));
    };
    const step = (label, value, down, up, fmt) => el('div', { class: 'od-popgroup' }, el('span', { class: 'od-poplabel', text: label }),
      el('div', { class: 'od-stepper' }, el('button', { type: 'button', class: 'od-btn', 'aria-label': label + ' −', title: label + ' −', onclick: () => { down(); refresh(); }, text: '−' }), el('output', { class: 'od-stepval', text: fmt(value) }), el('button', { type: 'button', class: 'od-btn', 'aria-label': label + ' +', title: label + ' +', onclick: () => { up(); refresh(); }, text: '+' })));
    const box = el('div', { class: 'od-popover', role: 'dialog', 'aria-label': t('Reading settings') });
    const refresh = () => { const nb = displayPanel(); box.replaceWith(nb); panel = nb; nb.querySelector('.od-btn')?.focus(); };
    box.append(
      step(t('Text size'), state.size, () => save('size', Math.max(13, state.size - 1)), () => save('size', Math.min(34, state.size + 1)), (v) => v + ' px'),
      step(t('Line spacing'), state.lh, () => save('lh', Math.max(1.2, +(state.lh - 0.1).toFixed(1))), () => save('lh', Math.min(2.4, +(state.lh + 0.1).toFixed(1))), (v) => v.toFixed(1)),
      mk(t('Column width'), [['narrow', t('Narrow')], ['medium', t('Medium')], ['wide', t('Wide')]], state.width, (v) => save('width', v)),
      mk(t('Font'), [['theme', t('Vex font')], ['serif', t('Serif')], ['sans', t('Sans-serif')]], state.font, (v) => save('font', v)),
      mk(t('Page tone'), [['theme', t('Match the theme')], ['sepia', t('Sepia')], ['original', t('Original')]], state.tone, (v) => { save('tone', v); renderCurrent(); }),
      el('p', { class: 'od-pophint', text: t('Original shows the book on white paper with its own styling.') }),
    );
    return box;
  }
  let panel = null;
  function closePanel() { if (panel) { panel.remove(); panel = null; } if (displayBtn) displayBtn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); }
  const outside = (e) => { if (panel && !panel.contains(e.target) && !displayBtn.contains(e.target)) closePanel(); };
  displayBtn = button({ icon: 'od-font', title: t('Reading settings'), aria: t('Reading settings'), menu: true });
  displayBtn.addEventListener('click', () => {
    if (panel) { closePanel(); return; }
    panel = displayPanel();
    document.body.append(panel);
    const r = displayBtn.getBoundingClientRect();
    panel.style.top = r.bottom + 6 + 'px';
    panel.style.left = Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, r.right - panel.offsetWidth)) + 'px';
    displayBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); displayBtn.focus(); } });
    (panel.querySelector('[aria-checked="true"], .od-btn') || panel).focus();
  });

  // ---- rail ---------------------------------------------------------------------------------------------------------------------------
  const tocEl = el('nav', { class: 'od-outline', 'aria-label': t('Contents') });
  const resultsEl = el('div', { class: 'od-results', role: 'list', 'aria-label': t('Search results') });
  const hlEl = el('div', { class: 'od-hllist' });
  function drawToc() {
    tocEl.replaceChildren();
    model.toc.forEach((e, i) => {
      const b = el('button', { type: 'button', class: 'od-ol', style: { '--lvl': String(Math.min(e.level, 4)) }, 'data-toc': String(i), text: e.title, title: e.title, onclick: () => { open(e.chapter, { anchor: e.anchor }); scroller.focus({ preventScroll: true }); } });
      tocEl.append(b);
    });
    markToc();
  }
  function markToc() {
    // the entry the reader is in: the last one at or before this chapter
    let current = -1;
    model.toc.forEach((e, i) => { if (e.chapter <= state.chapter) current = i; });
    tocEl.querySelectorAll('.od-ol').forEach((b, i) => { if (i === current) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  }
  function drawHighlights() {
    hlEl.replaceChildren();
    const list = state.highlights.slice().sort((a, b) => a.chapter - b.chapter || a.start - b.start);
    if (!list.length) hlEl.append(el('p', { class: 'od-empty-note', text: t('Select some text in the book and choose a colour to highlight it. Highlights stay on this computer.') }));
    else {
      hlEl.append(el('button', { type: 'button', class: 'od-dbtn', text: t('Copy all highlights'), onclick: async () => { const ok = await copyText(list.map((h) => '“' + h.text + '” — ' + model.chapters[h.chapter].title).join('\n\n')); toast(ok ? t('Copied {n} highlights', { n: list.length }) : t('Vex could not copy that'), ok ? 'info' : 'error'); } }));
      for (const h of list) {
        const item = el('div', { class: 'od-hlitem', role: 'group' },
          el('button', { type: 'button', class: 'od-hljump', onclick: () => { open(h.chapter, { highlight: h.id }); } }, el('span', { class: 'od-hldot od-hl-' + h.color, 'aria-hidden': 'true' }), el('span', { class: 'od-hlbody' }, el('span', { class: 'od-hlwhere', text: model.chapters[h.chapter].title }), el('span', { class: 'od-hltext', text: h.text.length > 200 ? h.text.slice(0, 200) + '…' : h.text }))),
          el('button', { type: 'button', class: 'od-btn', title: t('Remove this highlight'), 'aria-label': t('Remove this highlight'), onclick: () => removeHighlight(h.id) }));
        item.lastChild.insertAdjacentHTML('afterbegin', icon('x', 16));
        hlEl.append(item);
      }
    }
    shell.rail.count('highlights', state.highlights.length);
  }

  // ---- chapters -----------------------------------------------------------------------------------------------------------------------
  const rememberPlace = debounce(() => {
    const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    prefs.set('book.pos.' + key, { chapter: state.chapter, fraction: Math.min(1, scroller.scrollTop / max), at: Date.now() });
  }, 400);
  function paintProgress() {
    const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const f = Math.min(1, scroller.scrollTop / max);
    const total = (state.chapter + f) / model.chapters.length;
    const pct = Math.round(total * 100);
    barFill.style.width = pct + '%';
    progressBarEl.setAttribute('aria-valuenow', String(pct));
    progressText.textContent = t('Chapter {n} of {total}', { n: state.chapter + 1, total: model.chapters.length }) + ' · ' + pct + '%';
  }
  scroller.addEventListener('scroll', () => { paintProgress(); rememberPlace(); hideSelbar(); }, { passive: true });

  async function open(i, o = {}) {
    if (i < 0 || i >= model.chapters.length) return;
    const token = ++state.token;
    state.chapter = i;
    prevCh.disabled = i === 0;
    nextCh.disabled = i === model.chapters.length - 1;
    scroller.setAttribute('aria-label', model.chapters[i].title);
    page.setAttribute('aria-busy', 'true');
    let rendered;
    try { rendered = await renderChapter(model, i, page, { tone: state.tone }); }
    catch (err) { if (token === state.token) { page.removeAttribute('aria-busy'); shell.error(err); } return; }
    if (token !== state.token) return;
    page.removeAttribute('aria-busy');
    state.wrap = rendered.root;
    applyHighlights();
    markToc();
    scroller.scrollTop = 0;
    if (o.anchor) { const target = page.querySelector('[id="ep-' + CSS.escape(o.anchor) + '"]'); if (target) target.scrollIntoView({ block: 'start' }); }
    else if (o.fraction != null) scroller.scrollTop = o.fraction * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    else if (o.bottom) scroller.scrollTop = scroller.scrollHeight;
    if (o.highlight) { const m = page.querySelector('mark[data-hid="' + o.highlight + '"]'); if (m) { m.scrollIntoView({ block: 'center' }); m.classList.add('od-flash'); setTimeout(() => m.classList.remove('od-flash'), 1600); } }
    paintProgress();
    rememberPlace();
    if (state.find && !o.noFind) paintCurrentFind();
    shell.status(t('Chapter {n} of {total}', { n: i + 1, total: model.chapters.length }) + ': ' + model.chapters[i].title);
    if (o.focus !== false) scroller.focus({ preventScroll: true });
  }
  const renderCurrent = () => { const f = Math.min(1, scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight)); return open(state.chapter, { fraction: f, noFind: true, focus: false }); };

  page.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.dataset.chapter != null) { e.preventDefault(); open(+a.dataset.chapter, { anchor: a.dataset.anchor || '' }); return; }
    const m = e.target.closest('mark.od-hl');
    if (m && window.getSelection().isCollapsed) showSelbar(m.getBoundingClientRect(), { highlight: m.dataset.hid });
  });

  // ---- highlights -----------------------------------------------------------------------------------------------------------------------------------
  function textNodes(rootEl) {
    const list = [];
    let pos = 0;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { list.push({ node: n, start: pos }); pos += n.nodeValue.length; }
    return { list, length: pos };
  }
  function offsetOf(rootEl, container, offset) {
    const { list } = textNodes(rootEl);
    for (const s of list) if (s.node === container) return s.start + offset;
    // an element container: count the text before the child at `offset`
    const probe = document.createRange();
    probe.setStart(rootEl, 0);
    probe.setEnd(container, offset);
    return probe.toString().length;
  }
  function wrapOffsets(rootEl, start, end, h) {
    const { list } = textNodes(rootEl);
    for (const s of list) {
      const len = s.node.nodeValue.length;
      const a = Math.max(start, s.start), b = Math.min(end, s.start + len);
      if (a >= b) continue;
      const r = document.createRange();
      r.setStart(s.node, a - s.start);
      r.setEnd(s.node, b - s.start);
      const mark = document.createElement('mark');
      mark.className = 'od-hl od-hl-' + h.color;
      mark.dataset.hid = h.id;
      r.surroundContents(mark);        // the range is inside one text node, so it always wraps
    }
  }
  function applyHighlights() {
    if (!state.wrap) return;
    for (const h of state.highlights) if (h.chapter === state.chapter) wrapOffsets(state.wrap, h.start, h.end, h);
  }
  function addHighlight(color) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !state.wrap || !state.wrap.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const start = offsetOf(state.wrap, range.startContainer, range.startOffset), end = offsetOf(state.wrap, range.endContainer, range.endOffset);
    if (end <= start) return;
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const h = { id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), chapter: state.chapter, start, end, text: text.slice(0, 2000), color, at: Date.now() };
    state.highlights.push(h);
    prefs.set('book.hl.' + key, state.highlights);
    sel.removeAllRanges();
    wrapOffsets(state.wrap, start, end, h);
    hideSelbar();
    drawHighlights();
    shell.status(t('Highlight saved'));
  }
  function recolor(id, color) {
    const h = state.highlights.find((x) => x.id === id);
    if (!h) return;
    h.color = color;
    prefs.set('book.hl.' + key, state.highlights);
    for (const m of page.querySelectorAll('mark[data-hid="' + id + '"]')) m.className = 'od-hl od-hl-' + color;
    hideSelbar();
    drawHighlights();
  }
  function removeHighlight(id) {
    state.highlights = state.highlights.filter((x) => x.id !== id);
    prefs.set('book.hl.' + key, state.highlights);
    for (const m of page.querySelectorAll('mark[data-hid="' + id + '"]')) m.replaceWith(...m.childNodes);
    page.normalize();
    hideSelbar();
    drawHighlights();
  }
  function showSelbar(rect, opts = {}) {
    selbar.replaceChildren();
    for (const c of COLORS) {
      const b = el('button', { type: 'button', class: 'od-swatch od-hl-' + c, title: opts.highlight ? t('Change the colour') + ': ' + t(c) : t('Highlight') + ': ' + t(c), 'aria-label': (opts.highlight ? t('Change the colour') + ': ' : t('Highlight') + ': ') + t(c) });
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => (opts.highlight ? recolor(opts.highlight, c) : addHighlight(c)));
      selbar.append(b);
    }
    const copy = button({ icon: 'copy', title: t('Copy'), aria: t('Copy'), onclick: async () => { const text = opts.highlight ? (state.highlights.find((x) => x.id === opts.highlight) || {}).text : window.getSelection().toString(); if (text) { await copyText(text); toast(t('Copied'), 'info'); } hideSelbar(); } });
    copy.addEventListener('pointerdown', (e) => e.preventDefault());
    selbar.append(copy);
    if (opts.highlight) { const rm = button({ icon: 'trash', title: t('Remove this highlight'), aria: t('Remove this highlight'), onclick: () => removeHighlight(opts.highlight) }); selbar.append(rm); }
    selbar.hidden = false;
    const host = root.getBoundingClientRect();
    const w = selbar.offsetWidth;
    selbar.style.left = Math.max(8, Math.min(host.width - w - 8, rect.left - host.left + rect.width / 2 - w / 2)) + 'px';
    selbar.style.top = Math.max(8, rect.top - host.top - selbar.offsetHeight - 8) + 'px';
  }
  function hideSelbar() { selbar.hidden = true; }
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !state.wrap || !state.wrap.contains(sel.anchorNode)) { if (!selbar.matches(':hover') && !selbar.contains(document.activeElement)) hideSelbar(); return; }
  });
  scroller.addEventListener('pointerup', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !state.wrap || !state.wrap.contains(sel.anchorNode)) return;
      showSelbar(sel.getRangeAt(0).getBoundingClientRect(), {});
    }, 0);
  });
  scroller.addEventListener('keyup', (e) => {
    if (!e.shiftKey) return;
    const sel = window.getSelection();
    if (sel.rangeCount && !sel.isCollapsed && state.wrap && state.wrap.contains(sel.anchorNode)) showSelbar(sel.getRangeAt(0).getBoundingClientRect(), {});
  });

  // ---- search ---------------------------------------------------------------------------------------------------------------------------------------
  async function find(query, opts) {
    const hits = [];
    resultsEl.replaceChildren();
    const q = String(query || '');
    for (let i = 0; i < model.chapters.length; i++) {
      const text = await chapterText(model, i);
      const at = findOffsets(text, q, opts, 300);
      at.forEach((offset, k) => {
        hits.push({ chapter: i, offset, nth: k });
      });
      if (hits.length > 3000) break;
    }
    state.find = { query: q, opts, hits, pos: hits.length ? 0 : -1 };
    if (!hits.length) { clearFind(); resultsEl.append(el('p', { class: 'od-empty-note', text: t('No matches in the book.') })); return { count: 0, index: -1 }; }
    // the list: a snippet for each match (the first 400)
    let k = 0;
    for (const hit of hits.slice(0, 400)) {
      const text = await chapterText(model, hit.chapter);
      const from = Math.max(0, hit.offset - 40), to = Math.min(text.length, hit.offset + q.length + 60);
      const snippet = (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
      const idx = k++;
      resultsEl.append(el('button', { type: 'button', class: 'od-result', role: 'listitem', onclick: () => { jump(idx); } }, el('span', { class: 'od-hlwhere', text: model.chapters[hit.chapter].title }), el('span', { class: 'od-hltext', text: snippet })));
    }
    await jump(0);
    return { count: hits.length, index: 0 };
  }
  async function jump(pos) {
    const f = state.find;
    if (!f || !f.hits.length) return;
    f.pos = pos;
    const hit = f.hits[pos];
    if (hit.chapter !== state.chapter) await open(hit.chapter, { noFind: true, focus: false });
    paintCurrentFind();
    resultsEl.querySelectorAll('.od-result').forEach((b, i) => b.classList.toggle('current', i === pos));
    const cur = resultsEl.querySelectorAll('.od-result')[pos];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function paintCurrentFind() {
    const f = state.find;
    if (!f || f.pos < 0 || !state.wrap) return;
    const hit = f.hits[f.pos];
    const ranges = findRanges(state.wrap, f.query, f.opts);
    const same = f.hits.filter((x) => x.chapter === hit.chapter);
    const current = ranges[Math.min(hit.nth, ranges.length - 1)];
    paintFind(ranges, current);
    if (current) revealRange(current, scroller);
    void same;
  }
  async function findStep(dir) {
    const f = state.find;
    if (!f || !f.hits.length) return { count: 0, index: -1 };
    await jump((f.pos + dir + f.hits.length) % f.hits.length);
    return { count: f.hits.length, index: f.pos };
  }

  // ---- keys --------------------------------------------------------------------------------------------------------------------------------------------
  scroller.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2, atTop = scroller.scrollTop <= 0;
    if (e.key === 'ArrowRight' || e.key === ']') { e.preventDefault(); open(state.chapter + 1); }
    else if (e.key === 'ArrowLeft' || e.key === '[') { e.preventDefault(); open(state.chapter - 1); }
    else if ((e.key === ' ' && !e.shiftKey) || e.key === 'PageDown') { if (atBottom && state.chapter < model.chapters.length - 1) { e.preventDefault(); open(state.chapter + 1); } }
    else if ((e.key === ' ' && e.shiftKey) || e.key === 'PageUp') { if (atTop && state.chapter > 0) { e.preventDefault(); open(state.chapter - 1, { bottom: true }); } }
  });

  applyLook();
  return {
    root, tools: [displayBtn],
    rail: {
      tabs: [
        { id: 'contents', label: t('Contents'), icon: 'list', build: (pane) => { drawToc(); pane.append(tocEl); } },
        { id: 'search', label: t('Search'), icon: 'search', build: (pane) => pane.append(resultsEl) },
        { id: 'highlights', label: t('Highlights'), icon: 'marker', build: (pane) => { drawHighlights(); pane.append(hlEl); }, count: true },
      ],
      open: 'contents',
    },
    start() {
      const resume = saved && saved.chapter >= 0 && saved.chapter < model.chapters.length ? saved : null;
      return open(resume ? resume.chapter : 0, { fraction: resume ? resume.fraction : null }).then(() => {
        if (resume && (resume.chapter > 0 || resume.fraction > 0.01)) shell.status(t('Back where you stopped: chapter {n}', { n: resume.chapter + 1 }));
      });
    },
    text() { return state.wrap ? state.wrap.innerText : ''; },
    find, findStep, clearFind() { state.find = null; clearFind(); },
    zoomKeys(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return false;
      if (e.key === '=' || e.key === '+') { save('size', Math.min(34, state.size + 1)); return true; }
      if (e.key === '-' || e.key === '_') { save('size', Math.max(13, state.size - 1)); return true; }
      if (e.key === '0') { save('size', 19); return true; }
      return false;
    },
    printPrepare(area) { area.replaceChildren(state.wrap ? state.wrap.cloneNode(true) : document.createTextNode('')); return Promise.resolve({}); },
    printDone(area) { area.replaceChildren(); },
    focus() { scroller.focus({ preventScroll: true }); },
    about() { return [t('Shown: the text, headings, lists, tables, pictures and links of each chapter.'), t('Not shown: the book\'s fonts, scripts, audio, video and page-turning layout. Its own styling is used only in the Original tone.')]; },
    destroy() { closePanel(); clearFind(); root.remove(); },
  };
}
