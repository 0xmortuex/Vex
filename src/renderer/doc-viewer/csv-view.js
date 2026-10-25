// The table for CSV and TSV: a sticky header with the type of each column, sort by a column, a filter for all of it and one for each
// column, the first column kept in view when you scroll sideways, and only the visible rows built. The rows are read, sorted and
// filtered in the worker.

import { el, icon, marked, debounce, toast, scaler, errText } from './ui.js';
import { t, num } from './strings.js';

const ROWH = 28;
const PAGE = 64;
const OVERSCAN = 6;
const RN_W = 64;           // the row-number column

const TYPE_LABEL = { integer: '123', number: '1.5', date: 'date', boolean: 'bool', text: 'abc' };

export class CsvView {
  // ctx: { worker, host, info: { rows, shown, cols, head, types }, frozen, setStatus(text), copy(text, what), onCount() }
  constructor(ctx) {
    this.ctx = ctx;
    this.worker = ctx.worker;
    this.info = ctx.info;
    this.cols = ctx.info.cols;
    this.total = ctx.info.shown;
    this.frozen = !!ctx.frozen;
    this.sort = null;
    this.filterQ = '';
    this.colFilters = {};
    this.showFilters = false;
    this.pages = new Map(); this.inflight = new Map();
    this.els = new Map();
    this.gen = 0;
    this.sel = null;
    this.supportsNav = false;
    this.widths = new Array(this.cols).fill(140);
  }

  async mount() {
    // column widths from the first rows
    const first = await this.worker.call('csvRows', { from: 0, count: 60 });
    for (let c = 0; c < this.cols; c++) {
      let longest = String(this.info.head[c] || '').length + 6;
      for (const row of first.rows) longest = Math.max(longest, Math.min(48, (row[c] || '').length));
      this.widths[c] = Math.max(84, Math.min(380, Math.round(longest * 8 + 28)));
    }
    this.pages.set(0, first.rows.slice(0, PAGE));
    this.build();
  }

  build() {
    const grid = el('div', { class: 'dv-grid' + (this.frozen ? ' dv-frozen' : ''), role: 'grid', tabindex: '0', 'aria-label': t('Table'), 'aria-colcount': this.cols + 1, 'aria-rowcount': this.total + 1 });
    const head = el('div', { class: 'dv-ghead', role: 'row', 'aria-rowindex': '1' });
    const filters = el('div', { class: 'dv-gfilters', role: 'row', hidden: !this.showFilters });
    const bodyWrap = el('div', { class: 'dv-gbody-wrap' });
    const body = el('div', { class: 'dv-gbody' });
    bodyWrap.append(body);
    grid.append(head, filters, bodyWrap);
    this.grid = grid; this.head = head; this.filtersRow = filters; this.body = body;
    this.ctx.host.replaceChildren(grid);
    this.applyWidths();
    this.buildHead();
    this.viewH = grid.clientHeight || 600;
    this.fit();
    this.ro = new ResizeObserver(() => { this.viewH = grid.clientHeight; this.fit(); this.schedule(); });
    this.ro.observe(grid);
    grid.addEventListener('scroll', () => this.schedule(), { passive: true });
    grid.addEventListener('keydown', (e) => this.onKey(e));
    body.addEventListener('click', (e) => this.onCell(e));
    this.render();
  }

  applyWidths() {
    const cols = [RN_W + 'px', ...this.widths.map((w) => w + 'px')].join(' ');
    this.grid.style.setProperty('--dv-cols', cols);
    this.grid.style.setProperty('--dv-rn', RN_W + 'px');
    const total = RN_W + this.widths.reduce((a, b) => a + b, 0);
    this.grid.style.setProperty('--dv-grid-w', total + 'px');
  }

  buildHead() {
    this.head.replaceChildren();
    this.filtersRow.replaceChildren();
    const rn = el('div', { class: 'dv-gh dv-rn', role: 'columnheader', 'aria-colindex': '1' }, el('span', { class: 'dv-gh-name', text: '#' }));
    this.head.append(rn);
    this.filtersRow.append(el('div', { class: 'dv-gf dv-rn' }));
    for (let c = 0; c < this.cols; c++) {
      const type = this.info.types[c];
      const sorted = this.sort && this.sort.col === c ? this.sort.dir : null;
      const cell = el('div', { class: 'dv-gh dv-t-' + type + (c === 0 ? ' dv-first' : ''), role: 'columnheader', 'aria-colindex': String(c + 2), 'aria-sort': sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : 'none' });
      const b = el('button', { type: 'button', class: 'dv-gh-btn', title: t('Sort by this column'), 'aria-label': t('Sort by {name}', { name: this.info.head[c] || t('Column {n}', { n: c + 1 }) }) });
      b.append(el('span', { class: 'dv-gh-name', text: this.info.head[c] || t('Column {n}', { n: c + 1 }) }));
      b.append(el('span', { class: 'dv-type', text: TYPE_LABEL[type] === 'date' ? t('date') : TYPE_LABEL[type] === 'bool' ? t('bool') : TYPE_LABEL[type], title: t('Type: {type}', { type: t(type) }) }));
      if (sorted) b.append(icon(sorted === 'asc' ? 'chevron-up' : 'chevron-down', 14));
      b.addEventListener('click', () => this.cycleSort(c));
      cell.append(b);
      const grip = el('span', { class: 'dv-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': t('Resize column') });
      grip.addEventListener('pointerdown', (e) => this.startResize(e, c));
      cell.append(grip);
      this.head.append(cell);
      const f = el('div', { class: 'dv-gf' + (c === 0 ? ' dv-first' : '') });
      const input = el('input', { type: 'search', class: 'dv-gf-input', 'aria-label': t('Filter {name}', { name: this.info.head[c] || t('Column {n}', { n: c + 1 }) }), placeholder: t('Filter') });
      input.value = this.colFilters[c] || '';
      input.addEventListener('input', debounce(() => { if (input.value) this.colFilters[c] = input.value; else delete this.colFilters[c]; this.applyFilter(); }, 250));
      f.append(input);
      this.filtersRow.append(f);
    }
  }

  startResize(e, c) {
    e.preventDefault();
    const startX = e.clientX, start = this.widths[c];
    const move = (ev) => { this.widths[c] = Math.max(60, Math.min(900, start + ev.clientX - startX)); this.applyWidths(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  destroy() { this.ro.disconnect(); this.gen++; }
  // the height of the list (past what a page can hold, at a smaller scale: see scaler in ui.js)
  fit() { this.sc = scaler(this.total, ROWH, this.viewH); this.body.style.height = this.sc.height + 'px'; }
  focus() { this.grid.focus(); }
  schedule() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); }

  // ---- data
  pageOf(i) { return Math.floor(i / PAGE); }
  rowData(i) { const p = this.pages.get(this.pageOf(i)); return p ? p[i - this.pageOf(i) * PAGE] : undefined; }
  numOf(i) { const p = this.nums && this.nums.get(this.pageOf(i)); return p ? p[i - this.pageOf(i) * PAGE] : i + 1; }

  async load(p) {
    if (this.pages.has(p) && this.nums && this.nums.has(p)) return;
    if (this.inflight.has(p)) return this.inflight.get(p);
    const gen = this.gen;
    const q = this.worker.call('csvRows', { from: p * PAGE, count: PAGE }).then((r) => {
      if (gen !== this.gen) return;
      this.pages.set(p, r.rows);
      (this.nums = this.nums || new Map()).set(p, r.nums);
      if (this.pages.size > 80) { const old = this.pages.keys().next().value; this.pages.delete(old); this.nums.delete(old); }
    }).finally(() => this.inflight.delete(p));
    this.inflight.set(p, q);
    return q;
  }

  reset(total) {
    this.gen++;
    this.pages.clear(); this.inflight.clear(); if (this.nums) this.nums.clear();
    for (const e of this.els.values()) e.remove();
    this.els.clear();
    this.total = total;
    this.fit();
    this.grid.setAttribute('aria-rowcount', String(total + 1));
    this.ctx.onCount && this.ctx.onCount(total);
  }

  // ---- drawing
  async render() {
    const top = this.grid.scrollTop;
    const scrollTop = top;
    const v = this.sc.virtualTop(top);
    const first = Math.max(0, Math.floor(v / ROWH) - OVERSCAN);
    const last = Math.min(this.total - 1, Math.ceil((v + this.viewH) / ROWH) + OVERSCAN);
    const gen = this.gen;
    const need = [];
    for (let p = this.pageOf(first); p <= this.pageOf(Math.max(first, last)); p++) if (!this.pages.has(p) || !(this.nums && this.nums.has(p))) need.push(this.load(p));
    if (need.length) { await Promise.all(need); if (gen !== this.gen) return; }
    for (const [i, node] of this.els) if (i < first || i > last) { node.remove(); this.els.delete(i); }
    if (this.sc.scale !== 1) for (const [i, node] of this.els) node.style.top = this.sc.topFor(i, scrollTop) + 'px';
    const frag = document.createDocumentFragment();
    for (let i = first; i <= last; i++) {
      if (this.els.has(i)) continue;
      const data = this.rowData(i);
      if (!data) continue;
      const row = this.makeRow(data, i);
      this.els.set(i, row);
      frag.append(row);
    }
    this.body.append(frag);
  }

  makeRow(cells, i) {
    const row = el('div', { class: 'dv-grow' + (i % 2 ? ' dv-odd' : ''), role: 'row', 'aria-rowindex': String(i + 2), 'data-i': i });
    row.style.top = this.sc.topFor(i, this.grid.scrollTop) + 'px';
    row.append(el('div', { class: 'dv-gc dv-rn', role: 'rowheader', text: num(this.numOf(i)) }));
    const q = this.filterQ;
    for (let c = 0; c < this.cols; c++) {
      const v = cells[c] === undefined ? '' : cells[c];
      const cell = el('div', { class: 'dv-gc dv-t-' + this.info.types[c] + (c === 0 ? ' dv-first' : ''), role: 'gridcell', 'aria-colindex': String(c + 2), 'data-c': c });
      if (this.sel && this.sel.row === i && this.sel.col === c) { cell.classList.add('dv-sel'); cell.setAttribute('aria-selected', 'true'); }
      cell.append(marked(v.indexOf('\n') === -1 ? v : v.replace(/\r?\n/g, ' ↵ '), q, false));
      row.append(cell);
    }
    return row;
  }

  // ---- sort and filter
  async cycleSort(c) {
    let next;
    if (!this.sort || this.sort.col !== c) next = { col: c, dir: 'asc' };
    else if (this.sort.dir === 'asc') next = { col: c, dir: 'desc' };
    else next = null;
    this.sort = next;
    this.ctx.setStatus(t('Sorting…'));
    try {
      const r = await this.worker.call('csvSet', { sort: next });
      this.reset(r.shown);
      this.buildHead();
      this.grid.scrollTop = 0;
      await this.render();
      this.ctx.setStatus('');
    } catch (err) { toast(errText(err), 'error'); }
  }

  async applyFilter() {
    const filter = { q: this.filterQ, cols: this.colFilters };
    this.ctx.setStatus(t('Filtering…'));
    try {
      const r = await this.worker.call('csvSet', { filter });
      this.reset(r.shown);
      this.grid.scrollTop = 0;
      await this.render();
      this.ctx.setStatus('');
    } catch (err) { toast(errText(err), 'error'); }
  }

  async search(query) {
    this.filterQ = query;
    await this.applyFilter();
    return { count: this.total, filter: true, total: this.info.rows };
  }

  setFilters(on) { this.showFilters = !!on; this.filtersRow.hidden = !on; }
  setFrozen(on) { this.frozen = !!on; this.grid.classList.toggle('dv-frozen', !!on); }
  hitState() { return { index: -1, count: this.total, filter: true }; }
  next() {}
  prev() {}

  // ---- cells
  onCell(e) {
    const cell = e.target.closest('.dv-gc');
    const row = e.target.closest('.dv-grow');
    if (!cell || !row || cell.classList.contains('dv-rn')) return;
    this.select(Number(row.dataset.i), Number(cell.dataset.c));
  }

  select(i, c) {
    const prev = this.sel && this.els.get(this.sel.row);
    if (prev) { const old = prev.querySelector('.dv-sel'); if (old) { old.classList.remove('dv-sel'); old.removeAttribute('aria-selected'); } }
    this.sel = { row: i, col: c };
    const rowEl = this.els.get(i);
    const cell = rowEl && rowEl.querySelector('[data-c="' + c + '"]');
    if (cell) { cell.classList.add('dv-sel'); cell.setAttribute('aria-selected', 'true'); }
    const data = this.rowData(i);
    const text = data ? (data[c] === undefined ? '' : data[c]) : '';
    this.ctx.setStatus(t('Row {r}, {name}', { r: num(this.numOf(i)), name: this.info.head[c] || t('Column {n}', { n: c + 1 }) }) + ': ' + (text.length > 160 ? text.slice(0, 160) + '…' : text));
  }

  cellText() {
    if (!this.sel) return null;
    const data = this.rowData(this.sel.row);
    return data ? (data[this.sel.col] === undefined ? '' : data[this.sel.col]) : null;
  }

  async copyRows() {
    const r = await this.worker.call('csvText', { max: 200000 });
    await this.ctx.copy(r.text, 'rows');
    return r.rows;
  }

  onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && this.sel && !window.getSelection().toString()) {
      const text = this.cellText();
      if (text !== null) { e.preventDefault(); this.ctx.copy(text, 'cell'); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.sel) {
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key) && this.total) { e.preventDefault(); this.moveTo(Math.floor(this.sc.virtualTop(this.grid.scrollTop) / ROWH), 0); }
      return;
    }
    const { row, col } = this.sel;
    const page = Math.max(1, Math.floor(this.viewH / ROWH) - 2);
    const map = { ArrowDown: [row + 1, col], ArrowUp: [row - 1, col], ArrowRight: [row, col + 1], ArrowLeft: [row, col - 1], PageDown: [row + page, col], PageUp: [row - page, col], Home: [row, 0], End: [row, this.cols - 1] };
    if (map[e.key]) { e.preventDefault(); this.moveTo(...map[e.key]); }
  }

  async moveTo(i, c) {
    i = Math.max(0, Math.min(this.total - 1, i)); c = Math.max(0, Math.min(this.cols - 1, c));
    const top = this.grid.scrollTop;
    const headH = this.head.offsetHeight + (this.showFilters ? this.filtersRow.offsetHeight : 0);
    const v = this.sc.virtualTop(top);
    if (i * ROWH < v) this.grid.scrollTop = this.sc.scrollFor(i);
    else if ((i + 1) * ROWH + headH > v + this.viewH) this.grid.scrollTop = this.sc.scrollFor(i + 1 + (headH - this.viewH) / ROWH);
    await this.render();
    this.select(i, c);
    // keep the cell in view sideways
    const cell = this.els.get(i) && this.els.get(i).querySelector('[data-c="' + c + '"]');
    if (cell) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
