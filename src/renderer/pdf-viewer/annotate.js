// Marks on the pages: highlight, underline, strikethrough, free-hand drawing, text notes, shapes and a placed signature.
//
// The marks themselves live in the store (marks.js, in PDF units). This file draws them over each page that is on screen,
// turns the tools into new marks, and lets a mark be selected, moved, resized, recoloured and deleted. Nothing here is written
// into the PDF: a copy is made on request (actions.js), by main/pdf-toolkit.js.
//
// Layers on a page: .pv-marks (under the text layer, so text stays selectable) holds what is drawn; .pv-top (above everything,
// reached only while a drawing tool is on) catches the pointer, shows the box and handles of the selected mark, and holds a
// note being typed.

import { t } from './strings.js';
import { el, toast } from './ui.js';
import { boundsOf, hits, mergeLineRects } from './marks.js';
import { swatchHex, onPaper } from './theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PX = 96 / 72;                        // CSS pixels in one PDF unit at 100%
const BASELINE = 0.97;                     // where a note's first baseline sits in its line box, in em
const TOOLS_DRAW = new Set(['ink', 'text', 'rect', 'ellipse', 'line', 'arrow', 'signature']);
const MARKUP = new Set(['highlight', 'underline', 'strike']);

export function createAnnotator(ctx) {
  const { store, eventBus, viewer } = ctx;
  const s = ctx.state;
  const pages = new Map();                 // page number -> { view, marksEl, topEl }
  let selectedId = null;
  let editing = null;                      // the note being typed: { textarea, commit, cancel }
  let drag = null;

  const viewOf = (n) => viewer.getPageView(n - 1);
  const pageNumberOf = (node) => { const p = node && node.closest && node.closest('.page'); return p ? Number(p.dataset.pageNumber) : 0; };
  const toView = (view, x, y) => view.viewport.convertToViewportPoint(x, y);
  const toPdf = (view, x, y) => view.viewport.convertToPdfPoint(x, y);
  const scaleOf = (view) => view.viewport.scale;       // CSS pixels per PDF unit
  const rotationOf = (view) => view.viewport.rotation;

  // ---- layers ----------------------------------------------------------------
  function ensureLayers(view) {
    const n = view.id;
    const page = view.div;
    let entry = pages.get(n);
    if (entry && entry.marksEl.isConnected && entry.topEl.isConnected && entry.view === view) return entry;
    const marksEl = el('div', { class: 'pv-marks', 'aria-hidden': 'true' });
    const topEl = el('div', { class: 'pv-top' });
    const wrapper = page.querySelector('.canvasWrapper');
    if (wrapper && wrapper.nextSibling) page.insertBefore(marksEl, wrapper.nextSibling); else page.append(marksEl);
    page.append(topEl);
    entry = { view, marksEl, topEl };
    pages.set(n, entry);
    return entry;
  }

  function colorOf(m) { return /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#14161a'; }

  function svgFor(m, view) {
    const k = scaleOf(view);
    const c = colorOf(m);
    const w = (m.width || 1.5) * k;
    const pt = (x, y) => toView(view, x, y);
    const box = (x, y, bw, bh) => { const a = pt(x, y), b = pt(x + bw, y + bh); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; };
    const f = (n) => Math.round(n * 100) / 100;
    switch (m.kind) {
      case 'highlight': return m.rects.map((r) => { const b = box(r.x, r.y, r.w, r.h); return `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="1.5" fill="${c}" fill-opacity="0.42"/>`; }).join('');
      case 'underline': case 'strike': return m.lines.map((l) => { const a = pt(l.x1, l.y1), b = pt(l.x2, l.y2); return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${c}" stroke-width="${f(Math.max(1, (m.width || 1) * k))}" stroke-linecap="round"/>`; }).join('');
      case 'ink': return `<path d="${m.points.map((p, i) => { const a = pt(p[0], p[1]); return (i ? 'L' : 'M') + f(a[0]) + ' ' + f(a[1]); }).join('')}" fill="none" stroke="${c}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      case 'rect': { const b = box(m.x, m.y, m.w, m.h); return `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="none" stroke="${c}" stroke-width="${f(w)}" stroke-linejoin="round"/>`; }
      case 'ellipse': { const b = box(m.x, m.y, m.w, m.h); return `<ellipse cx="${f(b.x + b.w / 2)}" cy="${f(b.y + b.h / 2)}" rx="${f(b.w / 2)}" ry="${f(b.h / 2)}" fill="none" stroke="${c}" stroke-width="${f(w)}"/>`; }
      case 'line': {
        const a = pt(m.x1, m.y1), b = pt(m.x2, m.y2);
        let head = '';
        if (m.arrow) {
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.max(8, w * 4.2);
          const p1 = [b[0] + Math.cos(ang + Math.PI - 0.45) * len, b[1] + Math.sin(ang + Math.PI - 0.45) * len], p2 = [b[0] + Math.cos(ang + Math.PI + 0.45) * len, b[1] + Math.sin(ang + Math.PI + 0.45) * len];
          head = `<path d="M${f(p1[0])} ${f(p1[1])}L${f(b[0])} ${f(b[1])}L${f(p2[0])} ${f(p2[1])}" fill="none" stroke="${c}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${c}" stroke-width="${f(w)}" stroke-linecap="round"/>${head}`;
      }
      default: return '';
    }
  }

  // The notes and signatures are boxes of the page's own, drawn with the page's scale variable so they follow a zoom before the page is drawn again.
  function htmlFor(m, view) {
    const vw = view.viewport.width, vh = view.viewport.height;
    const delta = ((rotationOf(view) - (m.angle || 0)) % 360 + 360) % 360;
    const place = (x, y) => { const p = toView(view, x, y); return `left:${(p[0] / vw) * 100}%;top:${(p[1] / vh) * 100}%;`; };
    const unit = (n) => `calc(var(--total-scale-factor, 1) * ${(n * PX).toFixed(3)}px)`;
    if (m.kind === 'text') {
      const node = el('div', { class: 'pv-textmark', 'data-mid': m.id });
      node.textContent = m.text;
      node.style.cssText = `${place(m.x, m.y)}--mk-color:${colorOf(m)};font-size:${unit(m.size)};${m.w ? 'width:' + unit(m.w) + ';' : 'white-space:pre;'}padding:0;transform-origin:0 0;transform:rotate(${delta}deg) translateY(-${BASELINE}em);`;
      return node;
    }
    if (m.kind === 'signature') {
      const node = el('div', { class: 'pv-signmark', 'data-mid': m.id });
      const img = el('img', { alt: '', src: s.signatureUrl || '' });
      node.append(img);
      node.style.cssText = `${place(m.x, m.y)}width:${unit(m.w)};height:${unit(m.h)};transform-origin:0 0;transform:rotate(${delta}deg) translateY(-100%);`;
      return node;
    }
    return null;
  }

  function renderPage(n) {
    const view = viewOf(n);
    if (!view || !view.div || !view.viewport) return;
    const entry = ensureLayers(view);
    const list = store.byPage(n);
    entry.marksEl.textContent = '';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${view.viewport.width} ${view.viewport.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const parts = [];
    for (const m of list) {
      const inner = svgFor(m, view);
      if (inner) parts.push(`<g data-mid="${m.id}">${inner}</g>`);
    }
    svg.innerHTML = parts.join('');
    entry.marksEl.append(svg);
    for (const m of list) { const node = htmlFor(m, view); if (node) entry.marksEl.append(node); }
    if (selectedId && store.get(selectedId) && store.get(selectedId).page === n) showSelection();
  }
  function renderAll() { for (const n of pages.keys()) renderPage(n); }

  eventBus.on('pagerendered', (e) => renderPage(e.pageNumber));
  store.on((why) => {
    const touched = new Set();
    if (why && why.id) { const m = store.get(why.id); if (m) touched.add(m.page); }
    if (!why || why.type === 'undo' || why.type === 'redo' || why.type === 'clear' || why.type === 'remove' || !touched.size) renderAll();
    else for (const n of touched) renderPage(n);
    if (selectedId && !store.get(selectedId)) deselect();
    else if (selectedId) showSelection();
  });
  // A rotation turns the pages; the notes follow it with the page's next draw.
  eventBus.on('rotationchanging', () => renderAll());
  eventBus.on('scalechanging', () => hideSelectionBar());

  // ---- tools -------------------------------------------------------------------
  function setTool(tool) {
    if (editing) editing.commit();
    s.tool = tool;
    const group = tool === 'arrow' ? 'rect' : tool;
    document.body.dataset.tool = tool;
    ctx.dom.scroller.dataset.tool = tool;
    for (const b of document.querySelectorAll('.pv-tools [data-tool]')) {
      const on = b.dataset.tool === tool || (b.id === 'pv-shape-btn' && ['rect', 'ellipse', 'line', 'arrow'].includes(tool));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    void group;
    if (!TOOLS_DRAW.has(tool) && tool !== 'select') deselect();
    if (TOOLS_DRAW.has(tool)) deselect();
    if (MARKUP.has(tool)) applyMarkupFromSelection();
    ctx.emitState();
  }

  // Highlight, underline and strikethrough: the words selected become the mark. With the tool already on, a selection becomes the mark at once.
  function selectionRects() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    const groups = new Map();
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 3) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      let n = pageNumberOf(hit);
      if (!n) { for (const [k, e] of pages) { const pr = e.view.div.getBoundingClientRect(); if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) { n = k; break; } } }
      if (!n) continue;
      const view = viewOf(n);
      const pr = view.div.getBoundingClientRect();
      if (r.height > pr.height * 0.25) continue;       // a whole block, not a line of text
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push({ x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height });
    }
    return [...groups].map(([n, list]) => ({ page: n, rects: mergeLineRects(list) })).filter((g) => g.rects.length);
  }

  function makeMarkup(kind) {
    const groups = selectionRects();
    if (!groups.length) return false;
    const color = s.markColor[kind] || swatchHex('yellow');
    const created = [];
    for (const g of groups) {
      const view = viewOf(g.page);
      const pdfRects = g.rects.map((r) => {
        const a = toPdf(view, r.x, r.y + r.h), b = toPdf(view, r.x + r.w, r.y);       // two opposite corners
        return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
      });
      if (kind === 'highlight') created.push({ kind, page: g.page, color, rects: pdfRects });
      else {
        // A line under (or through) each line of the words, along the page's own bottom edge for that line: in the view's frame, then back to PDF units.
        const lines = g.rects.map((r) => {
          const yy = kind === 'underline' ? r.y + r.h * 0.92 : r.y + r.h * 0.56;
          const a = toPdf(view, r.x, yy), b = toPdf(view, r.x + r.w, yy);
          return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
        });
        created.push({ kind, page: g.page, color: onPaper(color), lines, width: Math.max(0.8, Math.min(2.2, g.rects[0].h / scaleOf(view) * 0.07)) });
      }
    }
    try { store.addMany(created); } catch (err) { toast(err.message, { kind: 'error' }); return false; }
    window.getSelection().removeAllRanges();
    hideSelectionPopup();
    return true;
  }
  function applyMarkupFromSelection() { if (MARKUP.has(s.tool)) makeMarkup(s.tool); }

  // While a markup tool is on, letting go of the mouse after selecting makes the mark.
  ctx.dom.scroller.addEventListener('pointerup', () => { if (MARKUP.has(s.tool)) setTimeout(applyMarkupFromSelection, 0); });
  ctx.dom.scroller.addEventListener('keyup', (e) => { if (MARKUP.has(s.tool) && e.shiftKey) applyMarkupFromSelection(); });

  // A small bar by the selected words, with the tool on or not.
  const selbar = document.getElementById('pv-selbar');
  function hideSelectionPopup() { selbar.hidden = true; }
  function showSelectionPopup() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || MARKUP.has(s.tool) || s.tool !== 'select') { hideSelectionPopup(); return; }
    const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (!anchor || !anchor.closest('.textLayer')) { hideSelectionPopup(); return; }
    const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1 && r.height > 3);
    if (!rects.length) { hideSelectionPopup(); return; }
    const last = rects[rects.length - 1];
    const host = ctx.dom.main.getBoundingClientRect();
    selbar.hidden = false;
    const w = selbar.offsetWidth;
    selbar.style.left = Math.max(8, Math.min(host.width - w - 8, last.right - host.left - w / 2)) + 'px';
    selbar.style.top = Math.min(host.height - 48, last.bottom - host.top + 8) + 'px';
  }
  document.addEventListener('selectionchange', () => { clearTimeout(showSelectionPopup.t); showSelectionPopup.t = setTimeout(showSelectionPopup, 120); });
  selbar.addEventListener('pointerdown', (e) => e.preventDefault());       // keep the selection while a button is pressed
  selbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    if (b.dataset.sel === 'copy') { document.execCommand('copy'); toast(t('Copied'), { ms: 1600 }); hideSelectionPopup(); return; }
    makeMarkup(b.dataset.sel);
  });

  // ---- drawing -------------------------------------------------------------------
  function pageAt(event) {
    const top = event.target.closest && event.target.closest('.pv-top');
    const page = top ? top.closest('.page') : null;
    if (!page) return null;
    const n = Number(page.dataset.pageNumber);
    const view = viewOf(n);
    const r = page.getBoundingClientRect();
    return { n, view, rect: r, x: event.clientX - r.left, y: event.clientY - r.top, top };
  }

  function previewSvg(top) {
    let svg = top.querySelector('svg.pv-preview');
    if (!svg) { svg = document.createElementNS(SVG_NS, 'svg'); svg.classList.add('pv-preview'); svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none'; top.append(svg); }
    return svg;
  }

  ctx.dom.scroller.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (TOOLS_DRAW.has(s.tool)) {
      const where = pageAt(event);
      if (!where) return;
      if (event.target.closest('.pv-textedit, .pv-handle')) return;
      event.preventDefault();
      if (editing) { editing.commit(); }
      if (s.tool === 'text') { startNote(where.n, where.x, where.y); return; }
      if (s.tool === 'signature') { placeSignature(where); return; }
      where.top.setPointerCapture?.(event.pointerId);
      drag = { type: 'draw', tool: s.tool, where, points: [[where.x, where.y]], start: [where.x, where.y], pointer: event.pointerId };
      return;
    }
    if (s.tool === 'select') selectByPointer(event);
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (drag.type === 'draw') {
      const r = drag.where.rect;
      const x = Math.min(Math.max(event.clientX - r.left, 0), r.width), y = Math.min(Math.max(event.clientY - r.top, 0), r.height);
      const svg = previewSvg(drag.where.top);
      const color = s.drawColor, k = scaleOf(drag.where.view), w = s.width * k;
      if (drag.tool === 'ink') {
        drag.points.push([x, y]);
        svg.innerHTML = `<path d="${drag.points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else {
        drag.end = [x, y];
        const [x0, y0] = drag.start;
        if (drag.tool === 'rect') svg.innerHTML = `<rect x="${Math.min(x0, x)}" y="${Math.min(y0, y)}" width="${Math.abs(x - x0)}" height="${Math.abs(y - y0)}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
        else if (drag.tool === 'ellipse') svg.innerHTML = `<ellipse cx="${(x0 + x) / 2}" cy="${(y0 + y) / 2}" rx="${Math.abs(x - x0) / 2}" ry="${Math.abs(y - y0) / 2}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
        else svg.innerHTML = `<line x1="${x0}" y1="${y0}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
      }
      return;
    }
    if (drag.type === 'move') moveDrag(event);
    else if (drag.type === 'resize') resizeDrag(event);
    else if (drag.type === 'endpoint') endpointDrag(event);
  });

  window.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.type === 'draw') { finishDraw(d); return; }
    if (d.type === 'move' || d.type === 'resize' || d.type === 'endpoint') {
      const m = store.get(d.id);
      if (m && d.moved) {
        const after = {};
        for (const key of Object.keys(d.before)) after[key] = m[key];
        Object.assign(m, d.before);                    // back to where it began, then one step to where it is
        store.update(d.id, after);
      }
      return;
    }
    if (d.type === 'click') {
      if (Math.hypot(event.clientX - d.x, event.clientY - d.y) < 5) selectMark(d.id);
    }
  });
  window.addEventListener('pointercancel', () => { drag = null; });

  function simplify(points, tol) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const p = out[out.length - 1];
      if (Math.hypot(points[i][0] - p[0], points[i][1] - p[1]) >= tol) out.push(points[i]);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function finishDraw(d) {
    const { where } = d;
    const view = where.view;
    where.top.querySelector('svg.pv-preview')?.replaceChildren();
    const color = onPaper(s.drawColor);
    try {
      if (d.tool === 'ink') {
        const pts = simplify(d.points, 1.2);
        if (pts.length < 2) { if (pts.length === 1) pts.push([pts[0][0] + 0.1, pts[0][1]]); else return; }
        store.add({ kind: 'ink', page: where.n, color, width: s.width, points: pts.map((p) => toPdf(view, p[0], p[1])) });
        return;
      }
      const end = d.end;
      if (!end || Math.hypot(end[0] - d.start[0], end[1] - d.start[1]) < 4) return;
      const a = toPdf(view, d.start[0], d.start[1]), b = toPdf(view, end[0], end[1]);
      if (d.tool === 'line' || d.tool === 'arrow') store.add({ kind: 'line', page: where.n, color, width: s.width, x1: a[0], y1: a[1], x2: b[0], y2: b[1], arrow: d.tool === 'arrow' });
      else store.add({ kind: d.tool, page: where.n, color, width: s.width, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
    } catch (err) { toast(err.message, { kind: 'error' }); }
  }

  // ---- notes -------------------------------------------------------------------------
  function startNote(n, vx, vy, existing) {
    const view = viewOf(n);
    const entry = ensureLayers(view);
    const size = existing ? existing.size : s.textSize;
    const sizePx = size * scaleOf(view);
    const color = existing ? existing.color : onPaper(s.drawColor);
    const area = el('textarea', { class: 'pv-textedit', rows: '1', 'aria-label': t('Text note'), spellcheck: 'false' });
    area.style.cssText = `left:${vx}px;top:${vy}px;font-size:${sizePx}px;--mk-color:${color};width:${existing && existing.w ? existing.w * scaleOf(view) + 'px' : Math.max(160, sizePx * 10) + 'px'};padding:0 2px;`;
    if (existing) area.value = existing.text;
    entry.topEl.append(area);
    const grow = () => { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; };
    area.addEventListener('input', grow);
    grow();
    area.focus();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      editing = null;
      const text = area.value.replace(/\s+$/g, '');
      const widthPx = area.offsetWidth;
      area.remove();
      if (!save) { renderPage(n); return; }
      try {
        if (existing) {
          if (!text) store.remove(existing.id);
          else store.update(existing.id, { text, w: widthPx / scaleOf(view) });
        } else if (text) {
          const base = toPdf(view, vx + 2, vy + sizePx * BASELINE);
          store.add({ kind: 'text', page: n, color, size, text, x: base[0], y: base[1], angle: rotationOf(view), w: widthPx / scaleOf(view) });
          setTool('select');
        }
      } catch (err) { toast(err.message, { kind: 'error' }); }
    };
    editing = { commit: () => finish(true), cancel: () => finish(false) };
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
      e.stopPropagation();
    });
    area.addEventListener('blur', () => setTimeout(() => finish(true), 0));
    if (existing) renderPage(n);
  }

  function editNote(id) {
    const m = store.get(id);
    if (!m || m.kind !== 'text') return;
    const view = viewOf(m.page);
    if (!view) return;
    // Open it where it is: top-left of the note in the view, before any turn of the page since it was made.
    const p = toView(view, m.x, m.y);
    const sizePx = m.size * scaleOf(view);
    const mark = document.querySelector(`[data-mid="${m.id}"]`);
    if (mark) mark.style.visibility = 'hidden';
    deselect();
    startNote(m.page, p[0] - 2, p[1] - sizePx * BASELINE, m);
  }

  // ---- signature -----------------------------------------------------------------------
  function placeSignature(where) {
    if (!s.signaturePng) { ctx.askSignature(); return; }
    const view = where.view;
    const wPdf = (view.viewport.width / scaleOf(view)) * 0.26;
    const hPdf = wPdf * s.signatureRatio;
    // Centered on the click, in the view's frame.
    const wPx = wPdf * scaleOf(view), hPx = hPdf * scaleOf(view);
    const corner = toPdf(view, where.x - wPx / 2, where.y + hPx / 2);        // bottom left of the picture as it reads
    try {
      const mark = store.add({ kind: 'signature', page: where.n, color: '#000000', x: corner[0], y: corner[1], w: wPdf, h: hPdf, angle: rotationOf(view) });
      setTool('select');
      selectMark(mark.id);
    } catch (err) { toast(err.message, { kind: 'error' }); }
  }

  // ---- selecting and changing a mark ------------------------------------------------------
  function selectByPointer(event) {
    if (event.target.closest('a, input, textarea, select, button, .pv-handle, .pv-mk-box')) return;
    const page = event.target.closest('.page');
    if (!page) { if (!event.target.closest('#pv-markbar, #pv-selbar')) deselect(); return; }
    const n = Number(page.dataset.pageNumber), view = viewOf(n);
    const r = page.getBoundingClientRect();
    const p = toPdf(view, event.clientX - r.left, event.clientY - r.top);
    const tol = 4 / scaleOf(view);
    const list = store.byPage(n).slice().reverse();
    const found = list.find((m) => hits(m, p[0], p[1], tol));
    if (!found) { deselect(); return; }
    drag = { type: 'click', id: found.id, x: event.clientX, y: event.clientY };
  }

  function selectMark(id) {
    selectedId = id;
    const m = store.get(id);
    if (m) ctx.revealPage(m.page);
    showSelection();
    ctx.emitState();
  }
  function deselect() {
    if (selectedId == null) { hideSelectionBar(); return; }
    selectedId = null;
    for (const e of pages.values()) e.topEl.querySelectorAll('.pv-mk-box, .pv-handle').forEach((n) => n.remove());
    hideSelectionBar();
    ctx.emitState();
  }
  function hideSelectionBar() { document.getElementById('pv-markbar').hidden = true; }

  function displayBox(m, entry) {
    const pr = entry.view.div.getBoundingClientRect();
    const nodes = [...entry.marksEl.querySelectorAll(`[data-mid="${m.id}"]`)];
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const node of nodes) {
      const parts = node.tagName.toLowerCase() === 'g' ? [...node.children] : [node];
      for (const part of parts) { const r = part.getBoundingClientRect(); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); }
    }
    if (!isFinite(x1)) return null;
    return { x: x1 - pr.left, y: y1 - pr.top, w: x2 - x1, h: y2 - y1 };
  }

  function showSelection() {
    const m = selectedId && store.get(selectedId);
    for (const e of pages.values()) e.topEl.querySelectorAll('.pv-mk-box, .pv-handle').forEach((n) => n.remove());
    if (!m) { hideSelectionBar(); return; }
    const entry = pages.get(m.page);
    if (!entry || !entry.marksEl.isConnected) { hideSelectionBar(); return; }
    const box = displayBox(m, entry);
    if (!box) { hideSelectionBar(); return; }
    const pad = 3;
    const outline = el('div', { class: 'pv-mk-box', style: { left: box.x - pad + 'px', top: box.y - pad + 'px', width: box.w + pad * 2 + 'px', height: box.h + pad * 2 + 'px' } });
    entry.topEl.append(outline);
    const handle = (cls, x, y, kind, cursor) => {
      const h = el('div', { class: 'pv-handle ' + cls, 'data-handle': kind, role: 'presentation', style: { left: x + 'px', top: y + 'px', cursor: cursor || 'nwse-resize' } });
      h.addEventListener('pointerdown', (e) => beginHandle(e, m, kind, entry));
      entry.topEl.append(h);
    };
    if (m.kind === 'rect' || m.kind === 'ellipse' || m.kind === 'signature') handle('se', box.x + box.w + pad, box.y + box.h + pad, 'se');
    else if (m.kind === 'text') handle('e', box.x + box.w + pad, box.y + box.h / 2, 'e', 'ew-resize');
    else if (m.kind === 'line') {
      const a = toView(entry.view, m.x1, m.y1), b = toView(entry.view, m.x2, m.y2);
      handle('p1', a[0], a[1], 'p1', 'move'); handle('p2', b[0], b[1], 'p2', 'move');
    }
    // Moving: a press on the outline, which is above the mark.
    outline.style.pointerEvents = 'auto';
    outline.style.cursor = 'move';
    outline.addEventListener('pointerdown', (e) => beginMove(e, m, entry));
    outline.addEventListener('dblclick', () => { if (m.kind === 'text') editNote(m.id); });
    // The bar over it.
    const bar = document.getElementById('pv-markbar');
    const host = ctx.dom.main.getBoundingClientRect(), pr = entry.view.div.getBoundingClientRect();
    bar.hidden = false;
    bar.querySelector('[data-markact="color"]').hidden = m.kind === 'signature';
    const bw = bar.offsetWidth;
    const left = pr.left - host.left + box.x + box.w / 2 - bw / 2;
    const top = pr.top - host.top + box.y - 46;
    bar.style.left = Math.max(8, Math.min(host.width - bw - 8, left)) + 'px';
    bar.style.top = Math.max(8, top < 8 ? pr.top - host.top + box.y + box.h + 10 : top) + 'px';
  }

  function beginMove(e, m, entry) {
    e.preventDefault(); e.stopPropagation();
    const k = scaleOf(entry.view);
    const before = {};
    const keys = m.kind === 'highlight' ? ['rects'] : m.kind === 'underline' || m.kind === 'strike' ? ['lines'] : m.kind === 'ink' ? ['points'] : m.kind === 'line' ? ['x1', 'y1', 'x2', 'y2'] : ['x', 'y'];
    for (const key of keys) before[key] = structuredClone(m[key]);
    drag = { type: 'move', id: m.id, before, sx: e.clientX, sy: e.clientY, k, view: entry.view, moved: false };
  }
  function moveDrag(e) {
    const d = drag, m = store.get(d.id);
    if (!m) return;
    const dxv = e.clientX - d.sx, dyv = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dxv, dyv) < 3) return;
    d.moved = true;
    // View movement -> PDF movement, through two points so a turned page is handled.
    const o = toPdf(d.view, 0, 0), p = toPdf(d.view, dxv, dyv);
    const dx = p[0] - o[0], dy = p[1] - o[1];
    const b = d.before;
    const patch = {};
    if (b.rects) patch.rects = b.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
    if (b.lines) patch.lines = b.lines.map((l) => ({ x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy }));
    if (b.points) patch.points = b.points.map((q) => [q[0] + dx, q[1] + dy]);
    if ('x1' in b) Object.assign(patch, { x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy });
    if ('x' in b) Object.assign(patch, { x: b.x + dx, y: b.y + dy });
    store.preview(d.id, patch);
    renderPage(m.page);
  }
  function beginHandle(e, m, kind, entry) {
    e.preventDefault(); e.stopPropagation();
    const before = {};
    for (const key of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2']) if (key in m) before[key] = m[key];
    if (kind === 'p1' || kind === 'p2') { drag = { type: 'endpoint', id: m.id, which: kind, before, view: entry.view, rect: entry.view.div.getBoundingClientRect(), moved: false }; return; }
    drag = { type: 'resize', id: m.id, kind, before, view: entry.view, rect: entry.view.div.getBoundingClientRect(), moved: false };
  }
  function resizeDrag(e) {
    const d = drag, m = store.get(d.id);
    if (!m) return;
    d.moved = true;
    const view = d.view;
    const p = toPdf(view, e.clientX - d.rect.left, e.clientY - d.rect.top);
    const b = d.before;
    const patch = {};
    if (m.kind === 'text') {
      // The right edge in the note's own frame: its width is how far along the baseline direction the pointer is.
      const angle = (m.angle || 0) * Math.PI / 180;
      patch.w = Math.max(20, (p[0] - b.x) * Math.cos(angle) + (p[1] - b.y) * Math.sin(angle));
    } else if (m.kind === 'signature') {
      const angle = (m.angle || 0) * Math.PI / 180;
      const along = (p[0] - b.x) * Math.cos(angle) + (p[1] - b.y) * Math.sin(angle);
      patch.w = Math.max(12, along);
      patch.h = patch.w * (b.h / b.w);
    } else {
      // The corner opposite the anchor stays; the dragged one follows the pointer.
      const x0 = b.x, y0 = b.y + b.h;      // top left in PDF terms
      patch.w = Math.max(3, p[0] - x0);
      patch.h = Math.max(3, y0 - p[1]);
      patch.x = x0; patch.y = y0 - patch.h;
    }
    store.preview(d.id, patch);
    renderPage(m.page);
  }
  function endpointDrag(e) {
    const d = drag, m = store.get(d.id);
    if (!m) return;
    d.moved = true;
    const p = toPdf(d.view, e.clientX - d.rect.left, e.clientY - d.rect.top);
    store.preview(d.id, d.which === 'p1' ? { x1: p[0], y1: p[1] } : { x2: p[0], y2: p[1] });
    renderPage(m.page);
  }

  document.getElementById('pv-markbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-markact]');
    if (!b || !selectedId) return;
    if (b.dataset.markact === 'delete') deleteSelected();
    else if (b.dataset.markact === 'color') ctx.openColorMenu(b, selectedId);
  });
  function deleteSelected() { if (selectedId) { const id = selectedId; deselect(); store.remove(id); } }
  function recolor(id, hex) {
    const m = store.get(id);
    if (!m) return;
    store.update(id, { color: m.kind === 'highlight' ? hex : onPaper(hex) });
  }

  // Keys that belong to the marks.
  function onKey(event) {
    if (editing) return false;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); deleteSelected(); return true; }
    if (event.key === 'Enter' && selectedId && store.get(selectedId)?.kind === 'text') { event.preventDefault(); editNote(selectedId); return true; }
    if (event.key === 'Escape' && (selectedId || TOOLS_DRAW.has(s.tool) || MARKUP.has(s.tool))) { event.preventDefault(); deselect(); if (s.tool !== 'select') setTool('select'); return true; }
    return false;
  }

  // Double-click a note to change its words.
  ctx.dom.scroller.addEventListener('dblclick', (event) => {
    if (s.tool !== 'select') return;
    const page = event.target.closest('.page');
    if (!page) return;
    const n = Number(page.dataset.pageNumber), view = viewOf(n), r = page.getBoundingClientRect();
    const p = toPdf(view, event.clientX - r.left, event.clientY - r.top);
    const found = store.byPage(n).slice().reverse().find((m) => m.kind === 'text' && hits(m, p[0], p[1], 4 / scaleOf(view)));
    if (found) { event.preventDefault(); editNote(found.id); }
  });

  return {
    setTool, onKey, deselect, selectMark, recolor, deleteSelected, renderAll, renderPage, selectedId: () => selectedId, makeMarkup, boundsOf,
    focusMark(id) { const m = store.get(id); if (m) { ctx.revealPage(m.page); setTimeout(() => selectMark(id), 80); } },
    isEditing: () => !!editing,
  };
}
