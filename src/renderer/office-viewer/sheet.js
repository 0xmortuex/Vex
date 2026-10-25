// The spreadsheet grid. Only the cells in view exist as elements (a sheet of a million cells costs a few hundred nodes), the
// header row can stay in place while the rest scrolls, columns have the file's widths, numbers and dates are shown the way the
// file formats them, formulas show their saved result (or their text, on request), and the person can sort, filter, search,
// select a range and copy it, or save the sheet as CSV. Nothing here changes the file or calculates anything.

import { el, icon, openMenu, dialog, toast, copyText, debounce } from './ui.js';
import { t, getLang } from './strings.js';
import { formatCell } from './numfmt.js';
import { fold } from './find.js';
import { readableOn, luminanceOf } from './xml.js';
import { surfaceHex } from './theme.js';

const ROW_HEAD_W = 52;
const COL_HEAD_H = 26;
const DEFAULT_ROW_H = 24;
const DEFAULT_COL_W = 72;

export const colName = (c) => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

// ---- CSV ------------------------------------------------------------------------------------------------
export function toCsv(rows, delimiter) {
  const d = delimiter || ',';
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) || s.includes(d) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return rows.map((r) => r.map(q).join(d)).join('\r\n') + '\r\n';
}
export function toTsv(rows) {
  return rows.map((r) => r.map((v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

// opts: { book: { sheets, styles, date1904 }, loadSheet(i) -> Promise<sheet model>, onChange?() }
export function createSheetView(opts) {
  const { book, loadSheet } = opts;
  const state = {
    index: -1, sheet: null, showFormulas: false, headerRows: 0, freezeRows: 0, freezeCols: 0, filtersOn: false,
    sort: null,                // { col (source), dir: 1 | -1 }
    filters: new Map(),        // source col -> { values: Set<string> | null, text: string }
    order: [],                 // source rows below the header, in display order
    cols: [],                  // source columns shown, in order
    colX: [], rowY: null, rowCount: 0, uniformH: DEFAULT_ROW_H, totalW: 0, totalH: 0,
    sel: { r1: 0, c1: 0, r2: 0, c2: 0 }, active: { i: 0, j: 0 },
    cellEls: new Map(), finds: [], findPos: -1, findQuery: '', findOpts: {},
    mergeRows: new Map(), mergesOn: true, rendered: null,
  };
  const locale = () => (getLang() === 'tr' ? 'tr' : 'en');

  // ---- DOM ------------------------------------------------------------------------------------------------
  const refEl = el('span', { class: 'od-fb-ref', 'aria-live': 'off' }, 'A1');
  const valEl = el('div', { class: 'od-fb-val', role: 'textbox', 'aria-readonly': 'true', 'aria-label': t('Cell contents'), tabindex: '-1' });
  const fbar = el('div', { class: 'od-fbar' }, refEl, el('span', { class: 'od-fb-fx', 'aria-hidden': 'true', html: null }), valEl);
  fbar.querySelector('.od-fb-fx').innerHTML = icon('od-formula', 16);
  const layerBody = el('div', { class: 'od-g-body' });
  const layerTop = el('div', { class: 'od-g-top' });
  const layerLeft = el('div', { class: 'od-g-left' });
  const layerCorner = el('div', { class: 'od-g-corner' });
  const sizer = el('div', { class: 'od-g-sizer' }, layerBody, layerTop, layerLeft, layerCorner);
  const scroll = el('div', { class: 'od-g-scroll', tabindex: '0', role: 'grid', 'aria-label': t('Spreadsheet'), 'aria-readonly': 'true' }, sizer);
  const tabs = el('div', { class: 'od-tabs', role: 'tablist', 'aria-label': t('Sheets') });
  const status = el('div', { class: 'od-gstatus', 'aria-live': 'polite' });
  const root = el('div', { class: 'od-sheetview' }, fbar, el('div', { class: 'od-gwrap' }, scroll), el('div', { class: 'od-gfoot' }, tabs, status));

  // ---- model -> layout ---------------------------------------------------------------------------------------------
  const sheetRow = (r) => (state.sheet.rows[r] || null);
  const cellAt = (r, c) => { const row = state.sheet.rows[r]; return row ? row[c] || null : null; };
  const styleOf = (cell) => (cell ? book.styles[cell[2]] || null : null);

  function textOf(cell) {
    if (!cell) return '';
    if (state.showFormulas && cell[3]) return '=' + cell[3];
    if (cell[5] !== undefined && !state.showFormulas) return cell[5];
    const s = book.styles[cell[2]];
    let text;
    if (cell[0] === null) text = '';
    else text = formatCell(cell[0], cell[1], s && s.nf, { date1904: book.date1904, locale: locale() });
    cell[5] = text;
    return text;
  }
  const rawOf = (cell) => (!cell ? '' : cell[3] ? '=' + cell[3] : cell[0] === null ? '' : String(cell[0]));

  function sourceRowOf(i) { return i < state.headerRows ? i : state.order[i - state.headerRows]; }
  function rowTop(i) { return state.rowY ? state.rowY[i] : i * state.uniformH; }
  function rowHeight(i) { return state.rowY ? state.rowY[i + 1] - state.rowY[i] : state.uniformH; }
  function rowAtY(y) {
    if (!state.rowY) return Math.max(0, Math.min(state.rowCount - 1, Math.floor(y / state.uniformH)));
    let lo = 0, hi = state.rowCount - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (state.rowY[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function colAtX(x) {
    let lo = 0, hi = state.cols.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (state.colX[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }
  const colWidth = (j) => state.colX[j + 1] - state.colX[j];

  function computeRows() {
    const s = state.sheet;
    const hidden = new Set(s.hiddenRows);
    const first = state.headerRows;
    let order = [];
    for (let r = first; r < s.maxRow; r++) if (!hidden.has(r)) order.push(r);
    // filters
    for (const [col, f] of state.filters) {
      if (!f || (!f.values && !f.text)) continue;
      const q = f.text ? fold(f.text, false) : '';
      order = order.filter((r) => {
        const txt = textOf(cellAt(r, col));
        if (f.values && !f.values.has(txt)) return false;
        if (q && !fold(txt, false).includes(q)) return false;
        return true;
      });
    }
    if (state.sort) {
      const { col, dir } = state.sort;
      const coll = new Intl.Collator(locale() === 'tr' ? 'tr' : undefined, { numeric: true, sensitivity: 'base' });
      const keyed = order.map((r) => { const c = cellAt(r, col); return { r, v: c ? c[0] : null, t: c ? c[1] : 'n', text: textOf(c) }; });
      const rank = (k) => (k.v === null || k.v === '' ? 3 : k.t === 'n' ? 0 : k.t === 'b' ? 1 : 2);
      keyed.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;                      // blanks always last
        if (ra === 3) return a.r - b.r;
        let d;
        if (ra === 0) d = a.v - b.v; else if (ra === 1) d = (a.v ? 1 : 0) - (b.v ? 1 : 0); else d = coll.compare(a.text, b.text);
        return d ? d * dir : a.r - b.r;
      });
      order = keyed.map((k) => k.r);
    }
    state.order = order;
    state.rowCount = first + order.length;
    // heights
    const custom = s.rowHeights;
    const hasCustom = Object.keys(custom).length > 0;
    state.uniformH = s.defaultRow && s.defaultRow >= 18 && s.defaultRow <= 40 ? s.defaultRow : DEFAULT_ROW_H;
    if (hasCustom) {
      const y = new Float64Array(state.rowCount + 1);
      for (let i = 0; i < state.rowCount; i++) { const r = sourceRowOf(i); y[i + 1] = y[i] + (custom[r] ? Math.max(14, Math.min(300, custom[r])) : state.uniformH); }
      state.rowY = y;
    } else state.rowY = null;
    state.totalH = rowTop(state.rowCount);
    // merges only while the rows are in file order
    state.mergesOn = !state.sort && ![...state.filters.values()].some((f) => f && (f.values || f.text));
    state.mergeRows = new Map();
    if (state.mergesOn) {
      let budget = 200000;
      for (const m of s.merges) {
        for (let r = m.r1; r <= m.r2 && budget-- > 0; r++) {
          const list = state.mergeRows.get(r) || [];
          list.push(m);
          state.mergeRows.set(r, list);
        }
      }
    }
  }

  function computeCols() {
    const s = state.sheet;
    const hidden = new Set(s.hiddenCols);
    state.cols = [];
    const maxCol = Math.max(1, s.maxCol);
    for (let c = 0; c < maxCol; c++) if (!hidden.has(c)) state.cols.push(c);
    state.colX = [0];
    for (const c of state.cols) {
      let w = s.colWidths[c];
      if (!w) {
        // no width in the file: fit the first rows' text
        let longest = 0;
        for (let r = 0; r < Math.min(s.maxRow, 120); r++) { const cell = cellAt(r, c); if (cell && cell[0] !== null) longest = Math.max(longest, Math.min(textOf(cell).length, 40)); }
        w = s.defaultCol && !longest ? s.defaultCol : Math.max(DEFAULT_COL_W, Math.min(280, Math.round(longest * 7.4 + 18)));
      }
      state.colX.push(state.colX[state.colX.length - 1] + Math.max(24, Math.min(600, w)));
    }
    state.totalW = state.colX[state.colX.length - 1];
  }

  function layout() {
    sizer.style.width = ROW_HEAD_W + state.totalW + 'px';
    sizer.style.height = COL_HEAD_H + state.totalH + 'px';
    scroll.setAttribute('aria-rowcount', String(state.rowCount + 1));
    scroll.setAttribute('aria-colcount', String(state.cols.length));
  }

  // ---- drawing the cells in view -------------------------------------------------------------------------------------------
  function visibleRange() {
    const top = Math.max(0, scroll.scrollTop - COL_HEAD_H), bottom = scroll.scrollTop + scroll.clientHeight - COL_HEAD_H;
    const left = Math.max(0, scroll.scrollLeft - ROW_HEAD_W), right = scroll.scrollLeft + scroll.clientWidth - ROW_HEAD_W;
    const i1 = state.rowCount ? Math.max(0, rowAtY(top) - 2) : 0, i2 = state.rowCount ? Math.min(state.rowCount - 1, rowAtY(bottom) + 2) : -1;
    const j1 = Math.max(0, colAtX(left) - 1), j2 = Math.min(state.cols.length - 1, colAtX(right) + 1);
    return { i1, i2, j1, j2 };
  }

  function mergeAt(sourceRow, sourceCol) {
    const list = state.mergeRows.get(sourceRow);
    if (!list) return null;
    for (const m of list) if (sourceCol >= m.c1 && sourceCol <= m.c2) return m;
    return null;
  }

  const surface = () => surfaceHex();
  let surfaceNow = '#ffffff';

  function styleCell(node, cell, s) {
    const cls = ['od-c'];
    if (cell) {
      if (cell[1] === 'n' && cell[0] !== null && !(s && s.al)) cls.push('num');
      else if ((cell[1] === 'b' || cell[1] === 'e') && !(s && s.al)) cls.push('ctr');
      if (cell[1] === 'e') cls.push('err');
      if (cell[3] && state.showFormulas) cls.push('fx');
    }
    if (s) {
      if (s.b) cls.push('b');
      if (s.i) cls.push('i');
      if (s.u) cls.push('u');
      if (s.al === 'center') cls.push('ctr'); else if (s.al === 'right') cls.push('num'); else if (s.al === 'left') cls.push('left');
      if (s.wrap) cls.push('wrap');
      if (s.fill) { node.style.background = '#' + s.fill; node.style.color = readableOn('#' + s.fill); }
      else if (s.color) {
        const a = luminanceOf('#' + s.color), b = luminanceOf(surfaceNow);
        if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3) node.style.color = '#' + s.color;
      }
    }
    node.className = cls.join(' ');
  }

  // The display row of a source row (they are the same unless rows are hidden).
  let rowIndexBySource = null;
  function displayIndexOf(r) {
    if (!state.sheet.hiddenRows.length) return r;
    if (!rowIndexBySource) { rowIndexBySource = new Map(); for (let i = 0; i < state.rowCount; i++) rowIndexBySource.set(sourceRowOf(i), i); }
    return rowIndexBySource.has(r) ? rowIndexBySource.get(r) : -1;
  }

  function makeCell(i, j, merge) {
    const c = state.cols[j];
    const r = sourceRowOf(i);
    const cell = cellAt(r, c);
    let w = colWidth(j), h = rowHeight(i);
    const node = el('div', { role: 'gridcell', 'aria-colindex': String(j + 1), 'aria-rowindex': String(i + 2), id: 'od-cell-' + i + '-' + j });
    if (merge) {
      const last = Math.min(state.cols.length - 1, state.cols.findLastIndex ? state.cols.findLastIndex((x) => x <= merge.c2) : state.cols.length - 1);
      w = state.colX[Math.max(j, last) + 1] - state.colX[j];
      h = 0;
      for (let k = i, n = 0; k < state.rowCount && sourceRowOf(k) <= merge.r2 && n < 400; k++, n++) h += rowHeight(k);
      h = h || rowHeight(i);
    }
    node.style.left = ROW_HEAD_W + state.colX[j] + 'px';
    node.style.top = COL_HEAD_H + rowTop(i) + 'px';
    node.style.width = w + 'px';
    node.style.height = h + 'px';
    styleCell(node, cell, styleOf(cell));
    if (merge) node.classList.add('merged');
    if (state.freezeRows && i === state.freezeRows - 1) node.classList.add('edge-b');
    if (state.freezeCols && j === state.freezeCols - 1) node.classList.add('edge-r');
    node.textContent = textOf(cell);
    return node;
  }

  function renderCells() {
    if (!state.sheet) return;
    surfaceNow = surface();
    const { i1, i2, j1, j2 } = visibleRange();
    const F = state.freezeRows, K = state.freezeCols;
    const key = [i1, i2, j1, j2, state.showFormulas, state.rev].join(',');
    if (state.rendered === key) { paintSelection(); return; }
    state.rendered = key;
    const frag = { body: document.createDocumentFragment(), top: document.createDocumentFragment(), left: document.createDocumentFragment(), corner: document.createDocumentFragment() };
    state.cellEls = new Map();
    const drawnMerges = new Set();
    const place = (i, j) => {
      const r = sourceRowOf(i), c = state.cols[j];
      let merge = null;
      if (state.mergesOn) {
        merge = mergeAt(r, c);
        if (merge && (merge.r1 !== r || merge.c1 !== c)) {
          // covered: the merge is drawn from its own top-left cell, wherever that is (even off screen)
          if (drawnMerges.has(merge)) return;
          const ti = displayIndexOf(merge.r1), tj = state.cols.indexOf(merge.c1);
          if (ti < 0 || tj < 0) return;
          if (state.cellEls.has(ti + ':' + tj)) return;
          drawnMerges.add(merge);
          const node = makeCell(ti, tj, merge);
          const inTop = ti < F, inLeft = tj < K;
          (inTop && inLeft ? frag.corner : inTop ? frag.top : inLeft ? frag.left : frag.body).append(node);
          state.cellEls.set(ti + ':' + tj, node);
          return;
        }
        if (merge) drawnMerges.add(merge);
      }
      const node = makeCell(i, j, merge);
      const inTop = i < F, inLeft = j < K;
      (inTop && inLeft ? frag.corner : inTop ? frag.top : inLeft ? frag.left : frag.body).append(node);
      state.cellEls.set(i + ':' + j, node);
    };
    // the frozen rows and columns are always drawn, whatever is scrolled into view
    for (let i = 0; i < Math.min(F, state.rowCount); i++) for (let j = j1; j <= j2; j++) if (!state.cellEls.has(i + ':' + j)) place(i, j);
    for (let j = 0; j < Math.min(K, state.cols.length); j++) for (let i = Math.max(i1, F); i <= i2; i++) if (!state.cellEls.has(i + ':' + j)) place(i, j);
    for (let j = 0; j < Math.min(K, state.cols.length); j++) for (let i = 0; i < Math.min(F, state.rowCount); i++) if (!state.cellEls.has(i + ':' + j)) place(i, j);
    for (let i = Math.max(i1, F); i <= i2; i++) for (let j = Math.max(j1, K); j <= j2; j++) if (!state.cellEls.has(i + ':' + j)) place(i, j);
    // headers
    const tops = document.createDocumentFragment(), lefts = document.createDocumentFragment();
    for (let j = j1; j <= j2; j++) {
      const sc = state.cols[j];
      const h = el('div', { class: 'od-h od-ch', role: 'columnheader', 'aria-colindex': String(j + 1), 'data-j': String(j), style: { left: ROW_HEAD_W + state.colX[j] + 'px', width: colWidth(j) + 'px', height: COL_HEAD_H + 'px' } }, colName(sc));
      if (j < K) frag.corner.append(h); else tops.append(h);
      if (state.filtersOn && state.headerRows > 0 && state.headerRows - 1 < state.rowCount) {
        // the sort / filter button sits on the last header row's cell for this column
        const cellNode = state.cellEls.get((state.headerRows - 1) + ':' + j);
        if (cellNode) {
          const active = (state.sort && state.sort.col === sc) || (state.filters.get(sc) && (state.filters.get(sc).values || state.filters.get(sc).text));
          const b = el('button', { type: 'button', class: 'od-fbtn' + (active ? ' on' : ''), 'data-col': String(sc), 'aria-label': t('Sort and filter column {name}', { name: colName(sc) }), 'aria-haspopup': 'menu', tabindex: '-1' });
          b.innerHTML = icon(active ? 'od-sort' : 'chevron-down', 14);
          cellNode.classList.add('hasfbtn');
          cellNode.append(b);
        }
      }
    }
    for (let i = i1; i <= i2; i++) {
      const r = el('div', { class: 'od-h od-rh', role: 'rowheader', 'data-i': String(i), style: { top: COL_HEAD_H + rowTop(i) + 'px', height: rowHeight(i) + 'px', width: ROW_HEAD_W + 'px' } }, String(sourceRowOf(i) + 1));
      if (i < F) frag.corner.append(r); else lefts.append(r);
    }
    for (let i = 0; i < Math.min(F, state.rowCount); i++) if (i < i1) frag.corner.append(el('div', { class: 'od-h od-rh', role: 'rowheader', style: { top: COL_HEAD_H + rowTop(i) + 'px', height: rowHeight(i) + 'px', width: ROW_HEAD_W + 'px' } }, String(sourceRowOf(i) + 1)));
    frag.top.append(tops);
    frag.left.append(lefts);
    frag.corner.append(el('div', { class: 'od-h od-corner', style: { left: '0px', top: '0px', width: ROW_HEAD_W + 'px', height: COL_HEAD_H + 'px' } }));
    layerBody.replaceChildren(frag.body);
    layerTop.replaceChildren(frag.top);
    layerLeft.replaceChildren(frag.left);
    layerCorner.replaceChildren(frag.corner);
    paintSelection();
  }

  // ---- selection ---------------------------------------------------------------------------------------------------------------------------
  const norm = () => ({ r1: Math.min(state.sel.r1, state.sel.r2), r2: Math.max(state.sel.r1, state.sel.r2), c1: Math.min(state.sel.c1, state.sel.c2), c2: Math.max(state.sel.c1, state.sel.c2) });
  function paintSelection() {
    const n = norm();
    for (const [k, node] of state.cellEls) {
      const [i, j] = k.split(':').map(Number);
      const inSel = i >= n.r1 && i <= n.r2 && j >= n.c1 && j <= n.c2;
      node.classList.toggle('sel', inSel && !(n.r1 === n.r2 && n.c1 === n.c2));
      const isActive = i === state.active.i && j === state.active.j;
      node.classList.toggle('active', isActive);
      node.setAttribute('aria-selected', inSel ? 'true' : 'false');
      if (state.finds.length) {
        const f = state.finds[state.findPos];
        node.classList.toggle('find-cur', !!f && f.i === i && f.j === j);
      }
    }
    for (const node of layerLeft.querySelectorAll('.od-rh')) node.classList.toggle('on', +node.dataset.i >= n.r1 && +node.dataset.i <= n.r2);
    for (const node of layerCorner.querySelectorAll('.od-rh')) node.classList.toggle('on', false);
    for (const node of layerTop.querySelectorAll('.od-ch')) node.classList.toggle('on', +node.dataset.j >= n.c1 && +node.dataset.j <= n.c2);
    const act = state.cellEls.get(state.active.i + ':' + state.active.j);
    if (act) scroll.setAttribute('aria-activedescendant', act.id); else scroll.removeAttribute('aria-activedescendant');
    updateFormulaBar();
  }

  function updateFormulaBar() {
    if (!state.sheet || !state.rowCount) { refEl.textContent = ''; valEl.textContent = ''; return; }
    const r = sourceRowOf(state.active.i), c = state.cols[state.active.j];
    const n = norm();
    const multi = n.r1 !== n.r2 || n.c1 !== n.c2;
    refEl.textContent = multi ? colName(state.cols[n.c1]) + (sourceRowOf(n.r1) + 1) + ':' + colName(state.cols[n.c2]) + (sourceRowOf(n.r2) + 1) : colName(c) + (r + 1);
    const cell = cellAt(r, c);
    valEl.textContent = rawOf(cell);
    valEl.title = valEl.textContent;
  }

  function scrollToCell(i, j) {
    const top = COL_HEAD_H + rowTop(i), bottom = top + rowHeight(i);
    const left = ROW_HEAD_W + state.colX[j], right = left + colWidth(j);
    const fh = COL_HEAD_H + (state.freezeRows ? rowTop(Math.min(state.freezeRows, state.rowCount)) : 0);
    const fw = ROW_HEAD_W + (state.freezeCols ? state.colX[Math.min(state.freezeCols, state.cols.length)] : 0);
    if (i >= state.freezeRows) {
      if (top < scroll.scrollTop + fh) scroll.scrollTop = top - fh;
      else if (bottom > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = bottom - scroll.clientHeight;
    }
    if (j >= state.freezeCols) {
      if (left < scroll.scrollLeft + fw) scroll.scrollLeft = left - fw;
      else if (right > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = right - scroll.clientWidth;
    }
  }

  function select(i, j, extend) {
    i = Math.max(0, Math.min(state.rowCount - 1, i));
    j = Math.max(0, Math.min(state.cols.length - 1, j));
    if (extend) { state.sel.r2 = i; state.sel.c2 = j; }      // the active cell stays where the range began
    else { state.sel = { r1: i, c1: j, r2: i, c2: j }; state.active = { i, j }; }
    scrollToCell(i, j);
    renderCells();
  }

  // ---- the text of a range -----------------------------------------------------------------------------------------------------------------
  function rangeRows(n) {
    const out = [];
    for (let i = n.r1; i <= n.r2; i++) {
      const row = [];
      const r = sourceRowOf(i);
      for (let j = n.c1; j <= n.c2; j++) row.push(textOf(cellAt(r, state.cols[j])));
      out.push(row);
    }
    return out;
  }
  function allRows(limit) {
    const out = [];
    const total = Math.min(state.rowCount, limit || Infinity);
    for (let i = 0; i < total; i++) {
      const row = [];
      const r = sourceRowOf(i);
      for (let j = 0; j < state.cols.length; j++) row.push(textOf(cellAt(r, state.cols[j])));
      out.push(row);
    }
    return out;
  }

  // ---- events ----------------------------------------------------------------------------------------------------------------------------------
  let dragging = false;
  function cellFromEvent(e) {
    const node = e.target.closest('.od-c');
    if (node) { const [i, j] = node.dataset.pos ? node.dataset.pos.split(':').map(Number) : posOf(node); return { i, j }; }
    const rh = e.target.closest('.od-rh');
    if (rh && rh.dataset.i != null) return { i: +rh.dataset.i, j: -1 };
    const ch = e.target.closest('.od-ch');
    if (ch) return { i: -1, j: +ch.dataset.j };
    return null;
  }
  function posOf(node) {
    const m = /^od-cell-(\d+)-(\d+)$/.exec(node.id);
    return [+m[1], +m[2]];
  }
  scroll.addEventListener('pointerdown', (e) => {
    const fb = e.target.closest('.od-fbtn');
    if (fb) { e.preventDefault(); openColumnMenu(fb, +fb.dataset.col); return; }
    if (e.button !== 0) return;
    const pos = cellFromEvent(e);
    if (!pos) return;
    scroll.focus({ preventScroll: true });
    if (pos.i === -1) { // a whole column
      state.sel = { r1: 0, r2: state.rowCount - 1, c1: pos.j, c2: e.shiftKey ? state.sel.c2 : pos.j };
      if (!e.shiftKey) state.active = { i: 0, j: pos.j };
      paintSelection(); return;
    }
    if (pos.j === -1) { // a whole row
      state.sel = { r1: pos.i, r2: e.shiftKey ? state.sel.r2 : pos.i, c1: 0, c2: state.cols.length - 1 };
      if (!e.shiftKey) state.active = { i: pos.i, j: 0 };
      paintSelection(); return;
    }
    dragging = true;
    scroll.setPointerCapture(e.pointerId);
    select(pos.i, pos.j, e.shiftKey);
  });
  scroll.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = scroll.getBoundingClientRect();
    const x = e.clientX - rect.left + scroll.scrollLeft - ROW_HEAD_W, y = e.clientY - rect.top + scroll.scrollTop - COL_HEAD_H;
    const j = colAtX(Math.max(0, x)), i = rowAtY(Math.max(0, y));
    if (state.sel.r2 !== i || state.sel.c2 !== j) { state.sel.r2 = i; state.sel.c2 = j; paintSelection(); }
  });
  scroll.addEventListener('pointerup', (e) => { dragging = false; if (scroll.hasPointerCapture(e.pointerId)) scroll.releasePointerCapture(e.pointerId); });
  scroll.addEventListener('contextmenu', (e) => {
    const pos = cellFromEvent(e);
    if (!pos || pos.i < 0 || pos.j < 0) return;
    e.preventDefault();
    const n = norm();
    if (!(pos.i >= n.r1 && pos.i <= n.r2 && pos.j >= n.c1 && pos.j <= n.c2)) select(pos.i, pos.j, false);
    openMenu({ at: { x: e.clientX, y: e.clientY }, label: t('Cell'), items: [{ label: t('Copy'), keys: 'Ctrl+C', icon: 'copy', run: () => copySelection() }, { label: t('Copy the whole sheet'), run: () => copyAll() }] });
  });
  scroll.addEventListener('dblclick', (e) => { const fb = e.target.closest('.od-fbtn'); if (fb) return; });

  scroll.addEventListener('scroll', () => requestAnimationFrame(renderCells), { passive: true });
  new ResizeObserver(() => { state.rendered = null; requestAnimationFrame(renderCells); }).observe(scroll);

  scroll.addEventListener('keydown', (e) => {
    if (!state.rowCount) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const a = state.active;
    const ext = e.shiftKey;
    const cur = ext ? { i: state.sel.r2, j: state.sel.c2 } : a;
    let handled = true;
    const jump = (i, j, di, dj) => {
      // Ctrl+arrow: to the edge of the block of filled cells
      const filled = (ii, jj) => { const c = cellAt(sourceRowOf(ii), state.cols[jj]); return c && c[0] !== null && c[0] !== ''; };
      let ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= state.rowCount || nj >= state.cols.length) return [i, j];
      const startFilled = filled(ni, nj);
      while (true) {
        const pi = ni + di, pj = nj + dj;
        if (pi < 0 || pj < 0 || pi >= state.rowCount || pj >= state.cols.length) break;
        if (filled(pi, pj) !== startFilled) { if (!startFilled) { ni = pi; nj = pj; } break; }
        ni = pi; nj = pj;
      }
      return [ni, nj];
    };
    const page = Math.max(1, Math.floor((scroll.clientHeight - COL_HEAD_H) / state.uniformH) - 1);
    switch (e.key) {
      case 'ArrowDown': { const [i, j] = ctrl ? jump(cur.i, cur.j, 1, 0) : [cur.i + 1, cur.j]; select(i, j, ext); break; }
      case 'ArrowUp': { const [i, j] = ctrl ? jump(cur.i, cur.j, -1, 0) : [cur.i - 1, cur.j]; select(i, j, ext); break; }
      case 'ArrowRight': { const [i, j] = ctrl ? jump(cur.i, cur.j, 0, 1) : [cur.i, cur.j + 1]; select(i, j, ext); break; }
      case 'ArrowLeft': { const [i, j] = ctrl ? jump(cur.i, cur.j, 0, -1) : [cur.i, cur.j - 1]; select(i, j, ext); break; }
      case 'PageDown': select(cur.i + page, cur.j, ext); break;
      case 'PageUp': select(cur.i - page, cur.j, ext); break;
      case 'Home': select(ctrl ? 0 : cur.i, 0, ext); break;
      case 'End': select(ctrl ? state.rowCount - 1 : cur.i, ctrl ? state.cols.length - 1 : state.cols.length - 1, ext); break;
      case 'Enter': select(cur.i + (e.shiftKey ? -1 : 1), cur.j, false); break;
      case 'Tab': select(cur.i, cur.j + (e.shiftKey ? -1 : 1), false); break;
      case 'a': case 'A': if (ctrl) { state.sel = { r1: 0, r2: state.rowCount - 1, c1: 0, c2: state.cols.length - 1 }; paintSelection(); } else handled = false; break;
      case 'c': case 'C': if (ctrl) copySelection(); else handled = false; break;
      case 'ContextMenu': { e.preventDefault(); const node = state.cellEls.get(a.i + ':' + a.j); const r = node ? node.getBoundingClientRect() : scroll.getBoundingClientRect(); openMenu({ at: { x: r.left, y: r.bottom }, label: t('Cell'), items: [{ label: t('Copy'), keys: 'Ctrl+C', icon: 'copy', run: () => copySelection() }] }); break; }
      case 'F10': if (e.shiftKey) { e.preventDefault(); } else handled = false; break;
      default: handled = false;
    }
    if (!handled && state.filtersOn && e.altKey && e.key === 'ArrowDown') {
      const sc = state.cols[a.j];
      const b = layerTop.querySelector('.od-fbtn[data-col="' + sc + '"]') || layerCorner.querySelector('.od-fbtn[data-col="' + sc + '"]') || layerBody.querySelector('.od-fbtn[data-col="' + sc + '"]');
      if (b) { openColumnMenu(b, sc); handled = true; }
    }
    if (handled) e.preventDefault();
  });

  async function copySelection() {
    const rows = rangeRows(norm());
    const ok = await copyText(toTsv(rows));
    toast(ok ? t('Copied {n} cells', { n: rows.length * (rows[0] ? rows[0].length : 0) }) : t('Vex could not copy that'), ok ? 'info' : 'error');
  }
  async function copyAll() {
    const rows = allRows(100000);
    const ok = await copyText(toTsv(rows));
    toast(ok ? t('Copied the sheet') : t('Vex could not copy that'), ok ? 'info' : 'error');
  }

  // ---- column menu: sort and filter ---------------------------------------------------------------------------------------------------------------
  function openColumnMenu(anchor, sourceCol) {
    const name = colName(sourceCol);
    const sorted = state.sort && state.sort.col === sourceCol ? state.sort.dir : 0;
    const filter = state.filters.get(sourceCol);
    openMenu({
      anchor, label: t('Sort and filter column {name}', { name }), items: [
        { label: t('Sort A to Z (smallest first)'), role: 'menuitemradio', checked: sorted === 1, run: () => setSort(sourceCol, 1) },
        { label: t('Sort Z to A (largest first)'), role: 'menuitemradio', checked: sorted === -1, run: () => setSort(sourceCol, -1) },
        { label: t('Clear the sort'), disabled: !state.sort, run: () => setSort(null) },
        { type: 'sep' },
        { label: t('Filter by value…'), icon: 'filter', run: () => filterDialog(sourceCol) },
        { label: t('Clear this filter'), disabled: !(filter && (filter.values || filter.text)), run: () => { state.filters.delete(sourceCol); rebuild(); } },
        { label: t('Clear all filters'), disabled: ![...state.filters.values()].some((f) => f && (f.values || f.text)), run: () => { state.filters.clear(); rebuild(); } },
      ],
    });
  }
  function setSort(col, dir) {
    state.sort = col == null ? null : { col, dir };
    rebuild();
    announce(col == null ? t('Sort cleared') : t('Sorted column {name}', { name: colName(col) }));
  }
  async function filterDialog(col) {
    const counts = new Map();
    const hiddenSet = new Set(state.sheet.hiddenRows);
    for (let r = state.headerRows; r < state.sheet.maxRow; r++) {
      if (hiddenSet.has(r)) continue;
      const txt = textOf(cellAt(r, col));
      counts.set(txt, (counts.get(txt) || 0) + 1);
    }
    const values = [...counts.keys()].sort((a, b) => a.localeCompare(b, locale() === 'tr' ? 'tr' : undefined, { numeric: true }));
    const current = state.filters.get(col);
    const chosen = new Set(current && current.values ? current.values : values);
    const search = el('input', { type: 'search', class: 'od-input', placeholder: t('Search values'), 'aria-label': t('Search values') });
    const list = el('div', { class: 'od-checklist', role: 'group', 'aria-label': t('Values') });
    const shownCap = 400;
    const draw = () => {
      list.replaceChildren();
      const q = fold(search.value, false);
      let shown = 0;
      for (const v of values) {
        if (q && !fold(v, false).includes(q)) continue;
        if (shown++ >= shownCap) { list.append(el('div', { class: 'od-hint', text: t('Search to see the other values') })); break; }
        const id = 'od-fv-' + shown;
        const cb = el('input', { type: 'checkbox', id });
        cb.checked = chosen.has(v);
        cb.addEventListener('change', () => { if (cb.checked) chosen.add(v); else chosen.delete(v); });
        list.append(el('label', { class: 'od-check', for: id }, cb, el('span', { text: v === '' ? t('(blank)') : v }), el('span', { class: 'od-count', text: String(counts.get(v)) })));
      }
    };
    search.addEventListener('input', draw);
    draw();
    const all = el('button', { type: 'button', class: 'od-dbtn', text: t('Select all'), onclick: () => { for (const v of values) chosen.add(v); draw(); } });
    const none = el('button', { type: 'button', class: 'od-dbtn', text: t('Select none'), onclick: () => { chosen.clear(); draw(); } });
    const choice = await dialog({ title: t('Filter column {name}', { name: colName(col) }), body: el('div', {}, search, el('div', { class: 'od-row' }, all, none), list), buttons: [{ id: 'cancel', label: t('Cancel') }, { id: 'ok', label: t('Apply'), primary: true }] });
    if (choice !== 'ok') return;
    if (chosen.size === values.length) state.filters.delete(col); else state.filters.set(col, { values: new Set(chosen), text: '' });
    rebuild();
  }

  function announce(message) { status.textContent = message; }

  // ---- building a sheet ---------------------------------------------------------------------------------------------------------------------------------------
  function rebuild(keepScroll) {
    const sy = scroll.scrollTop, sx = scroll.scrollLeft;
    state.rev = (state.rev || 0) + 1;
    rowIndexBySource = null;
    computeRows();
    computeCols();
    layout();
    state.rendered = null;
    state.sel = { r1: 0, c1: 0, r2: 0, c2: 0 };
    state.active = { i: 0, j: 0 };
    if (!keepScroll) { scroll.scrollTop = 0; scroll.scrollLeft = 0; } else { scroll.scrollTop = sy; scroll.scrollLeft = sx; }
    renderCells();
    runFind();
    describe();
    opts.onChange && opts.onChange();
  }

  function describe() {
    const s = state.sheet;
    const shown = state.rowCount - state.headerRows;
    const total = Math.max(0, s.maxRow - state.headerRows);
    const parts = [];
    parts.push(t('{rows} rows, {cols} columns', { rows: s.maxRow.toLocaleString(locale() === 'tr' ? 'tr-TR' : 'en-US'), cols: s.maxCol.toLocaleString(locale() === 'tr' ? 'tr-TR' : 'en-US') }));
    if (shown !== total) parts.push(t('{n} shown by the filter', { n: shown.toLocaleString(locale() === 'tr' ? 'tr-TR' : 'en-US') }));
    if (s.truncated) parts.push(t('Only the first {n} cells are shown', { n: s.cells.toLocaleString(locale() === 'tr' ? 'tr-TR' : 'en-US') }));
    if (!state.mergesOn && s.merges.length) parts.push(t('Merged cells are shown unmerged while sorted or filtered'));
    status.textContent = parts.join(' · ');
  }

  function drawTabs() {
    tabs.replaceChildren();
    book.sheets.forEach((s, i) => {
      if (s.state !== 'visible') return;
      const b = el('button', { type: 'button', role: 'tab', class: 'od-tab', id: 'od-sheet-tab-' + i, 'aria-selected': String(i === state.index), tabindex: i === state.index ? '0' : '-1', text: s.name, title: s.name, onclick: () => openSheet(i) });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
        const vis = book.sheets.map((x, k) => (x.state === 'visible' ? k : -1)).filter((k) => k >= 0);
        const pos = vis.indexOf(i);
        const next = e.key === 'Home' ? vis[0] : e.key === 'End' ? vis[vis.length - 1] : vis[(pos + (e.key === 'ArrowRight' ? 1 : -1) + vis.length) % vis.length];
        e.preventDefault();
        openSheet(next).then(() => document.getElementById('od-sheet-tab-' + next)?.focus());
      });
      tabs.append(b);
    });
  }

  async function openSheet(i) {
    if (i === state.index) return;
    status.textContent = t('Opening the sheet…');
    const sheet = await loadSheet(i);
    state.index = i;
    state.sheet = sheet;
    state.sort = null;
    state.filters = new Map();
    state.freezeRows = Math.min(sheet.freeze.rows, 20);
    state.freezeCols = Math.min(sheet.freeze.cols, 10);
    state.headerRows = Math.max(state.freezeRows, sheet.filter ? 1 : 0);
    state.hasHeader = state.headerRows > 0;
    drawTabs();
    rebuild();
    announce(t('Sheet {name}', { name: book.sheets[i].name }));
    runFind();
  }

  // ---- find ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function runFind() {
    state.finds = [];
    state.findPos = -1;
    if (!state.findQuery || !state.sheet) { paintFinds(); return; }
    const q = fold(state.findQuery, state.findOpts.matchCase);
    for (let i = 0; i < state.rowCount; i++) {
      const r = sourceRowOf(i);
      const row = sheetRow(r);
      if (!row) continue;
      for (let j = 0; j < state.cols.length; j++) {
        const cell = row[state.cols[j]];
        if (!cell || cell[0] === null) continue;
        let txt = fold(textOf(cell), state.findOpts.matchCase);
        if (state.findOpts.whole) { if (txt !== q.trim()) continue; } else if (!txt.includes(q)) continue;
        state.finds.push({ i, j });
        if (state.finds.length >= 20000) { i = state.rowCount; break; }
      }
    }
    state.findPos = state.finds.length ? 0 : -1;
    paintFinds();
  }
  function paintFinds() {
    const set = new Set(state.finds.map((f) => f.i + ':' + f.j));
    for (const [k, node] of state.cellEls) node.classList.toggle('find', set.has(k));
    paintSelection();
  }
  function goFind() {
    const f = state.finds[state.findPos];
    if (!f) return;
    state.sel = { r1: f.i, c1: f.j, r2: f.i, c2: f.j };
    state.active = { i: f.i, j: f.j };
    scrollToCell(f.i, f.j);
    state.rendered = null;
    renderCells();
    paintFinds();
  }

  // ---- the public face ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  return {
    root, scroll,
    open: openSheet,
    get sheetIndex() { return state.index; },
    get info() { return state; },
    setShowFormulas(on) { state.showFormulas = !!on; for (const row of state.sheet ? state.sheet.rows : []) if (row) for (const c of row) if (c) c[5] = undefined; state.rendered = null; renderCells(); updateFormulaBar(); },
    get showFormulas() { return state.showFormulas; },
    hasFormulas() { return !!state.sheet && state.sheet.rows.some((row) => row && row.some((c) => c && c[3])); },
    setFreezeHeader(on) { state.freezeRows = on ? Math.max(1, state.sheet.freeze.rows) : 0; state.headerRows = Math.max(state.headerRows, state.freezeRows, on ? 1 : (state.sheet.filter ? 1 : 0)); if (!on && !state.sheet.filter && !state.sort && !state.filters.size) state.headerRows = 0; rebuild(true); },
    get freezeHeader() { return state.freezeRows > 0; },
    setFilters(on) {
      state.filtersOn = !!on;
      if (on && state.headerRows === 0) state.headerRows = 1;
      if (!on) { state.sort = null; state.filters = new Map(); if (!state.freezeRows && !(state.sheet && state.sheet.filter)) state.headerRows = 0; }
      rebuild(true);
    },
    get filtersOn() { return state.filtersOn; },
    find(query, o) { state.findQuery = query; state.findOpts = o || {}; runFind(); if (state.finds.length) goFind(); return { count: state.finds.length, index: state.findPos }; },
    findStep(dir) { if (!state.finds.length) return { count: 0, index: -1 }; state.findPos = (state.findPos + dir + state.finds.length) % state.finds.length; goFind(); return { count: state.finds.length, index: state.findPos }; },
    clearFind() { state.findQuery = ''; state.finds = []; state.findPos = -1; paintFinds(); },
    text() { return toTsv(allRows(200000)); },
    csv() { return toCsv(allRows(), locale() === 'tr' ? ';' : ','); },
    copySelection, copyAll,
    printRows(limit) { return allRows(limit); },
    sheetName() { return state.index >= 0 ? book.sheets[state.index].name : ''; },
    refresh() { state.rendered = null; renderCells(); },
    focus() { scroll.focus({ preventScroll: true }); },
    destroy() { root.remove(); },
  };
}
