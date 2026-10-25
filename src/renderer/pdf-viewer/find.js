// Find in the document: pdf.js's find controller does the searching and marks the hits in the text layer; this is the bar.

import { t } from './strings.js';
import { $ } from './ui.js';

export function createFind(ctx) {
  const { eventBus, findController } = ctx;
  const bar = $('#pv-find');
  const input = $('#pv-find-input');
  const count = $('#pv-find-count');
  const caseBtn = $('#pv-find-case');
  const wordBtn = $('#pv-find-word');
  const openBtn = $('#pv-find-btn');
  let last = '';

  function dispatch(type, previous) {
    eventBus.dispatch('find', {
      source: input, type: type || '', query: input.value, caseSensitive: caseBtn.getAttribute('aria-pressed') === 'true',
      entireWord: wordBtn.getAttribute('aria-pressed') === 'true', highlightAll: true, findPrevious: !!previous, matchDiacritics: false,
    });
  }

  function open(selectAll = true) {
    bar.hidden = false;
    openBtn.setAttribute('aria-pressed', 'true');
    // Words selected in the document go into the box, as a browser's find does.
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? String(sel).trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    if (text) input.value = text;
    input.focus();
    if (selectAll) input.select();
    if (input.value) dispatch('');
  }
  function close() {
    if (bar.hidden) return;
    bar.hidden = true;
    openBtn.setAttribute('aria-pressed', 'false');
    eventBus.dispatch('findbarclose', { source: input });
    count.textContent = '';
    ctx.dom.scroller.focus({ preventScroll: true });
  }
  function again(previous) {
    if (!input.value) { input.focus(); return; }
    dispatch('again', previous);
  }

  openBtn.addEventListener('click', () => (bar.hidden ? open() : close()));
  $('#pv-find-close').addEventListener('click', close);
  $('#pv-find-next').addEventListener('click', () => again(false));
  $('#pv-find-prev').addEventListener('click', () => again(true));
  input.addEventListener('input', () => { if (input.value !== last) { last = input.value; dispatch(''); } if (!input.value) count.textContent = ''; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); again(e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  for (const b of [caseBtn, wordBtn]) b.addEventListener('click', () => { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); if (input.value) dispatch(''); });

  const show = (matches, state) => {
    if (!input.value) { count.textContent = ''; return; }
    const total = matches ? matches.total : 0;
    count.dataset.none = total === 0 && state !== 3 ? 'true' : 'false';
    // state 3 = pending: the document is still being searched.
    if (state === 3 && !total) count.textContent = t('Searching...');
    else if (!total) count.textContent = t('Not found');
    else count.textContent = t('{current} of {total}', { current: matches.current, total });
  };
  eventBus.on('updatefindmatchescount', (e) => show(e.matchesCount, 0));
  eventBus.on('updatefindcontrolstate', (e) => show(e.matchesCount, e.state));

  return { open, close, again, isOpen: () => !bar.hidden, findController };
}
