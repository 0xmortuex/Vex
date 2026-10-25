// The slide view (PowerPoint and OpenDocument presentations): a thumbnail strip, one slide at a time scaled to fit, speaker notes,
// a full-screen presentation, find across all slides. The slides are drawn by pptx.js / odf.js as simple HTML; the view says
// plainly that animations, transitions, charts and the like are not drawn.

import { el, icon, button, toast } from './ui.js';
import { t } from './strings.js';
import { findOffsets, findRanges, paintFind, clearFind, revealRange } from './find.js';

// engine: { count, size: {w,h}, render(i, host) -> Promise<{ text, notes, unsupported, flags }>, title(i), text(i), notes(i) }
export function createSlidesView(shell, engine) {
  const prefs = shell.prefs;
  const state = { index: 0, notes: prefs.get('slides.notes', false), token: 0, find: null, presenting: false, lastInfo: null };

  const stageHost = el('div', { class: 'od-slidehost' });
  const scaleBox = el('div', { class: 'od-slidescale' }, stageHost);
  const box = el('div', { class: 'od-stagebox', tabindex: '0', role: 'group', 'aria-roledescription': t('slide'), 'aria-label': t('Slide') }, scaleBox);
  const notesText = el('div', { class: 'od-notes-text' });
  const notesPanel = el('section', { class: 'od-notes-panel', 'aria-label': t('Speaker notes'), hidden: state.notes ? null : true }, el('h2', { class: 'od-notes-title', text: t('Speaker notes') }), notesText);
  const pagerLabel = el('span', { class: 'od-pager-label', 'aria-live': 'polite' });
  const prev = button({ icon: 'chevron-up', title: t('Previous slide') + ' (←)', aria: t('Previous slide'), onclick: () => go(state.index - 1) });
  const next = button({ icon: 'chevron-down', title: t('Next slide') + ' (→)', aria: t('Next slide'), onclick: () => go(state.index + 1) });
  const first = button({ icon: 'arrow-left', title: t('First slide') + ' (Home)', aria: t('First slide'), onclick: () => go(0) });
  const last = button({ icon: 'arrow-right', title: t('Last slide') + ' (End)', aria: t('Last slide'), onclick: () => go(engine.count - 1) });
  const pager = el('div', { class: 'od-pager', role: 'group', 'aria-label': t('Slide navigation') }, first, prev, pagerLabel, next, last);
  const hint = el('div', { class: 'od-slidehint' }, t('Simplified view: text, pictures, tables and basic shapes are drawn. Animations, transitions, charts, SmartArt, videos and effects are not.'));
  const root = el('div', { class: 'od-slidesview' }, box, pager, notesPanel, hint);

  // ---- fitting --------------------------------------------------------------------------------------------------------------------------
  function fit() {
    const w = box.clientWidth - 32, h = box.clientHeight - 32;
    if (w <= 0 || h <= 0) return;
    const s = Math.min(w / engine.size.w, h / engine.size.h);
    stageHost.style.transform = `scale(${s})`;
    scaleBox.style.width = engine.size.w * s + 'px';
    scaleBox.style.height = engine.size.h * s + 'px';
  }
  new ResizeObserver(() => fit()).observe(box);

  // ---- slides --------------------------------------------------------------------------------------------------------------------------------
  async function show(i, into, scaleTo) {
    return engine.render(i, into || stageHost);
  }
  async function go(i, opts = {}) {
    i = Math.max(0, Math.min(engine.count - 1, i));
    const token = ++state.token;
    state.index = i;
    pagerLabel.textContent = t('Slide {n} of {total}', { n: i + 1, total: engine.count });
    prev.disabled = first.disabled = i === 0;
    next.disabled = last.disabled = i === engine.count - 1;
    box.setAttribute('aria-label', t('Slide {n} of {total}', { n: i + 1, total: engine.count }));
    markThumb(i);
    let info;
    try { info = await show(i); }
    catch (err) { if (token === state.token) { stageHost.textContent = ''; shell.error(err); } return; }
    if (token !== state.token) return;
    state.lastInfo = info;
    fit();
    notesText.textContent = info.notes || t('No notes on this slide.');
    notesText.classList.toggle('empty', !info.notes);
    const u = info.unsupported || {};
    const missing = [];
    if (u.chart) missing.push(t('{n} chart(s)', { n: u.chart }));
    if (u.diagram) missing.push(t('{n} diagram(s)', { n: u.diagram }));
    if (u.media) missing.push(t('{n} video or audio clip(s)', { n: u.media }));
    if (u.object) missing.push(t('{n} embedded object(s)', { n: u.object }));
    if (u.shape) missing.push(t('{n} shape(s) drawn as a box', { n: u.shape }));
    if (u.picture) missing.push(t('{n} picture(s) that could not be shown', { n: u.picture }));
    if (info.flags && info.flags.animations) missing.push(t('animations'));
    if (info.flags && info.flags.transition) missing.push(t('a transition'));
    shell.banner(missing.length ? t('This slide has {list}, which Vex does not draw.', { list: missing.join(', ') }) : null);
    if (state.presenting) fitPresent();
    if (state.find && !opts.noFind) highlightFind();
    if (!opts.noFocus) shell.status(t('Slide {n} of {total}', { n: i + 1, total: engine.count }));
  }

  // ---- thumbnails -------------------------------------------------------------------------------------------------------------------------------
  const thumbs = el('div', { class: 'od-thumbs', role: 'list', 'aria-label': t('Slides') });
  const thumbEls = [];
  let observer = null;
  function buildThumbs(pane) {
    pane.append(thumbs);
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); renderThumb(+e.target.dataset.i); }
    }, { root: pane, rootMargin: '300px' });
    for (let i = 0; i < engine.count; i++) {
      const face = el('div', { class: 'od-thumbface', style: { aspectRatio: engine.size.w + ' / ' + engine.size.h } });
      const label = el('span', { class: 'od-thumblabel' }, el('span', { class: 'od-thumbn', text: String(i + 1) }), el('span', { class: 'od-thumbt', text: '' }));
      const b = el('button', { type: 'button', class: 'od-thumb', role: 'listitem', 'data-i': String(i), 'aria-current': i === state.index ? 'true' : 'false', 'aria-label': t('Slide {n}', { n: i + 1 }), onclick: () => { go(i); box.focus({ preventScroll: true }); } }, face, label);
      thumbs.append(b);
      thumbEls.push({ b, face, label });
      observer.observe(b);
    }
  }
  async function renderThumb(i) {
    const t0 = thumbEls[i];
    if (!t0 || t0.done) return;
    t0.done = true;
    const host = el('div', { class: 'od-thumbhost' });
    t0.face.append(host);
    try {
      const inner = el('div', {});
      host.append(inner);
      await engine.render(i, inner);
      const s = (t0.face.clientWidth || 200) / engine.size.w;
      inner.style.transformOrigin = '0 0';
      inner.style.transform = `scale(${s})`;
      inner.style.width = engine.size.w + 'px';
      inner.style.height = engine.size.h + 'px';
      const title = await engine.title(i);
      t0.label.querySelector('.od-thumbt').textContent = title;
      t0.b.title = title ? t('Slide {n}', { n: i + 1 }) + ': ' + title : t('Slide {n}', { n: i + 1 });
      t0.b.setAttribute('aria-label', t0.b.title);
    } catch (err) { console.warn('[Document viewer] a thumbnail could not be drawn:', err); host.remove(); t0.done = false; }
  }
  function markThumb(i) {
    thumbEls.forEach((x, k) => x.b.setAttribute('aria-current', k === i ? 'true' : 'false'));
    const cur = thumbEls[i];
    if (cur) cur.b.scrollIntoView({ block: 'nearest' });
  }

  // ---- presentation ----------------------------------------------------------------------------------------------------------------------------------
  let presentEl = null, presentHost = null, presentScale = null, presentCount = null;
  function fitPresent() {
    if (!presentEl) return;
    const s = Math.min(presentEl.clientWidth / engine.size.w, presentEl.clientHeight / engine.size.h);
    presentHost.style.transform = `scale(${s})`;
    presentScale.style.width = engine.size.w * s + 'px';
    presentScale.style.height = engine.size.h * s + 'px';
  }
  async function present() {
    if (state.presenting) return;
    state.presenting = true;
    presentHost = el('div', { class: 'od-slidehost' });
    presentScale = el('div', { class: 'od-slidescale' }, presentHost);
    presentCount = el('div', { class: 'od-present-count', 'aria-live': 'polite' });
    const close = button({ icon: 'x', title: t('Leave the presentation') + ' (Esc)', aria: t('Leave the presentation'), cls: 'od-present-close', onclick: () => endPresent() });
    presentEl = el('div', { class: 'od-present', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Presentation'), tabindex: '-1' }, presentScale, presentCount, close);
    document.body.append(presentEl);
    const resize = new ResizeObserver(() => fitPresent());
    resize.observe(presentEl);
    presentEl._resize = resize;
    presentEl.addEventListener('click', (e) => { if (e.target.closest('.od-present-close')) return; if (e.clientX < innerWidth / 3) go(state.index - 1, { noFocus: true }); else go(state.index + 1, { noFocus: true }); });
    presentEl.addEventListener('keydown', onPresentKey);
    presentEl.focus();
    // Full screen where the window allows it; otherwise the presentation fills the viewer's window.
    try { await presentEl.requestFullscreen(); }
    catch (err) { console.info('[Document viewer] full screen was not allowed, presenting in the window instead:', err && err.message); }
    document.addEventListener('fullscreenchange', onFs);
    await go(state.index, { noFind: true, noFocus: true });
    drawPresent();
  }
  const onFs = () => { if (state.presenting && !document.fullscreenElement) endPresent(); };
  function drawPresent() {
    if (!presentEl) return;
    presentHost.textContent = '';
    engine.render(state.index, presentHost).then(() => { fitPresent(); presentCount.textContent = (state.index + 1) + ' / ' + engine.count; });
  }
  function onPresentKey(e) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); endPresent(); return; }
    let to = null;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'n' || k === 'N') to = state.index + 1;
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p' || k === 'P') to = state.index - 1;
    else if (k === 'Home') to = 0;
    else if (k === 'End') to = engine.count - 1;
    if (to == null) return;
    e.preventDefault();
    to = Math.max(0, Math.min(engine.count - 1, to));
    if (to === state.index) return;
    state.index = to;
    pagerLabel.textContent = t('Slide {n} of {total}', { n: to + 1, total: engine.count });
    markThumb(to);
    drawPresent();
  }
  function endPresent() {
    if (!state.presenting) return;
    state.presenting = false;
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch((err) => console.warn('[Document viewer] could not leave full screen:', err && err.message));
    if (presentEl) { presentEl._resize.disconnect(); presentEl.remove(); }
    presentEl = null;
    go(state.index, { noFind: true });
    box.focus({ preventScroll: true });
  }

  // ---- find ------------------------------------------------------------------------------------------------------------------------------------------------------
  async function find(query, opts) {
    const hits = [];
    const cap = Math.min(engine.count, 600);
    for (let i = 0; i < cap; i++) {
      const text = await engine.text(i);
      const at = findOffsets(text, query, opts, 200);
      at.forEach((_, k) => hits.push({ slide: i, nth: k }));
      if (hits.length > 5000) break;
    }
    state.find = { query, opts, hits, pos: hits.length ? 0 : -1 };
    if (hits.length) await jumpTo(0);
    else clearFind();
    return { count: hits.length, index: state.find.pos };
  }
  async function jumpTo(pos) {
    const f = state.find;
    f.pos = pos;
    const hit = f.hits[pos];
    if (hit.slide !== state.index) await go(hit.slide, { noFind: true });
    highlightFind();
  }
  function highlightFind() {
    const f = state.find;
    if (!f || f.pos < 0) { clearFind(); return; }
    const ranges = findRanges(stageHost, f.query, f.opts);
    const hit = f.hits[f.pos];
    // the nth match on this slide (slide text and slide drawing list matches in the same order, give or take shapes)
    const current = ranges[Math.min(hit.nth, ranges.length - 1)];
    paintFind(ranges, current);
  }
  async function findStep(dir) {
    const f = state.find;
    if (!f || !f.hits.length) return { count: 0, index: -1 };
    await jumpTo((f.pos + dir + f.hits.length) % f.hits.length);
    return { count: f.hits.length, index: f.pos };
  }

  // ---- keys ----------------------------------------------------------------------------------------------------------------------------------------------------------
  box.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); go(state.index + 1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); go(state.index - 1); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(engine.count - 1); }
    else if (k === 'F5' || (k === 'Enter' && e.ctrlKey)) { e.preventDefault(); present(); }
    else if (k === 'n' || k === 'N') { toggleNotes(); }
  });

  function toggleNotes() {
    state.notes = !state.notes;
    prefs.set('slides.notes', state.notes);
    notesPanel.hidden = !state.notes;
    notesBtn.setAttribute('aria-pressed', String(state.notes));
    requestAnimationFrame(fit);
  }
  const notesBtn = button({ icon: 'od-notes', title: t('Speaker notes') + ' (N)', aria: t('Speaker notes'), pressed: state.notes, onclick: toggleNotes });
  const presentBtn = button({ icon: 'od-present', label: t('Present'), title: t('Present full screen') + ' (F5)', aria: t('Present full screen'), onclick: present });

  return {
    root, tools: [notesBtn, presentBtn],
    rail: { tabs: [{ id: 'slides', label: t('Slides'), icon: 'grid', build: buildThumbs }] },
    start() { return go(0, { noFocus: true }).then(() => box.focus({ preventScroll: true })); },
    text() { return Promise.all(Array.from({ length: engine.count }, async (_, i) => t('Slide {n}', { n: i + 1 }) + '\n' + (await engine.text(i)) + ((await engine.notes(i)) ? '\n' + t('Notes') + ': ' + (await engine.notes(i)) : ''))).then((a) => a.join('\n\n')); },
    find, findStep, clearFind() { state.find = null; clearFind(); },
    zoomKeys() { return false; },
    async printPrepare(area) {
      area.replaceChildren();
      const cap = Math.min(engine.count, 300);
      for (let i = 0; i < cap; i++) {
        const page = el('div', { class: 'od-printslide' });
        const inner = el('div', {});
        page.append(inner);
        area.append(page);
        await engine.render(i, inner);
        inner.style.zoom = String(960 / engine.size.w);
      }
      return { landscape: true };
    },
    printDone(area) { area.replaceChildren(); },
    focus() { box.focus({ preventScroll: true }); },
    present,
    about() { return [t('Shown: text, pictures, tables, groups, lines and the common shapes, with the colours and sizes of the file, and the speaker notes.'), t('Not shown: animations, transitions, charts, SmartArt, video and audio, 3-D, shadows and glows, picture crops and effects. A shape Vex does not know is drawn as a box.')]; },
    destroy() { endPresent(); if (observer) observer.disconnect(); clearFind(); root.remove(); },
  };
}
