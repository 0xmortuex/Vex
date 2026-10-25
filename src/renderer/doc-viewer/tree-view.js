// The tree for JSON, JSON Lines and XML. Only the rows on screen exist as elements; their data comes from the worker in pages, and the
// worker holds the whole document. A branch opens in the worker (which rebuilds the list of visible rows), so a tree of millions of
// nodes scrolls as lightly as one of ten.

import { el, icon, button, marked, debounce, toast } from './ui.js';
import { t, num } from './strings.js';

const ROW = 26;           // px
const PAGE = 64;          // rows fetched at a time
const OVERSCAN = 8;

export class TreeView {
  // ctx: { worker, host, kind: 'json' | 'jsonl' | 'xml', info: { nodes, rows }, setStatus(text), copy(text, what) }
  constructor(ctx) {
    this.ctx = ctx;
    this.worker = ctx.worker;
    this.total = ctx.info.rows;
    this.gen = 0;
    this.pages = new Map();
    this.inflight = new Map();
    this.els = new Map();
    this.focusIdx = 0;
    this.query = '';
    this.cs = false;
    this.hits = null;
    this.hitIdx = -1;
    this.hitNode = -1;
    this.selected = -1;
    this.xml = ctx.kind === 'xml';
    this.build();
  }

  build() {
    const scroller = el('div', { class: 'dv-tree', role: 'tree', tabindex: '-1', 'aria-label': t(this.xml ? 'XML tree' : 'JSON tree'), 'aria-multiselectable': 'false' });
    const pad = el('div', { class: 'dv-tree-pad' });
    const layer = el('div', { class: 'dv-tree-layer' });
    pad.append(layer);
    scroller.append(pad);
    this.scroller = scroller; this.pad = pad; this.layer = layer;
    this.ctx.host.replaceChildren(scroller);
    pad.style.height = this.total * ROW + 'px';
    this.viewH = scroller.clientHeight || 600;
    this.ro = new ResizeObserver(() => { this.viewH = scroller.clientHeight; this.schedule(); });
    this.ro.observe(scroller);
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    scroller.addEventListener('keydown', (e) => this.onKey(e));
    layer.addEventListener('click', (e) => this.onClick(e));
    layer.addEventListener('dblclick', (e) => { const row = e.target.closest('.dv-row'); if (row && !e.target.closest('button')) this.toggle(Number(row.dataset.i)); });
    this.updateStatus = debounce(() => this.showPath(), 120);
    this.render();
  }

  destroy() { this.ro.disconnect(); this.gen++; }
  schedule() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); }
  focus() { this.focusRow(this.focusIdx, true); }

  // ---- data
  pageOf(i) { return Math.floor(i / PAGE); }
  rowData(i) { const p = this.pages.get(this.pageOf(i)); return p ? p[i - this.pageOf(i) * PAGE] : undefined; }

  async load(pageIdx) {
    if (this.pages.has(pageIdx)) return;
    if (this.inflight.has(pageIdx)) return this.inflight.get(pageIdx);
    const gen = this.gen;
    const p = this.worker.call('treeRows', { from: pageIdx * PAGE, count: PAGE }).then((r) => {
      if (gen !== this.gen) return;
      this.pages.set(pageIdx, r.rows);
      if (this.pages.size > 60) { const oldest = this.pages.keys().next().value; this.pages.delete(oldest); }
    }).finally(() => { this.inflight.delete(pageIdx); });
    this.inflight.set(pageIdx, p);
    return p;
  }

  invalidate(total) {
    this.gen++;
    this.pages.clear(); this.inflight.clear();
    for (const e of this.els.values()) e.remove();
    this.els.clear();
    this.total = total;
    this.pad.style.height = total * ROW + 'px';
    if (this.focusIdx >= total) this.focusIdx = Math.max(0, total - 1);
  }

  // ---- drawing
  async render() {
    const top = this.scroller.scrollTop;
    const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
    const last = Math.min(this.total - 1, Math.ceil((top + this.viewH) / ROW) + OVERSCAN);
    const gen = this.gen;
    const need = [];
    for (let p = this.pageOf(first); p <= this.pageOf(Math.max(first, last)); p++) if (!this.pages.has(p)) need.push(this.load(p));
    if (need.length) {
      await Promise.all(need);
      if (gen !== this.gen) return;
    }
    for (const [i, node] of this.els) if (i < first || i > last) { node.remove(); this.els.delete(i); }
    const frag = document.createDocumentFragment();
    for (let i = first; i <= last; i++) {
      if (this.els.has(i)) continue;
      const data = this.rowData(i);
      if (!data) continue;
      const node = this.makeRow(data, i);
      this.els.set(i, node);
      frag.append(node);
    }
    this.layer.append(frag);
    // the focused row is the one tab stop of the tree
    const f = this.els.get(this.focusIdx);
    for (const [i, node] of this.els) node.tabIndex = i === this.focusIdx ? 0 : -1;
    if (!f && this.els.size) { const any = this.els.values().next().value; any.tabIndex = 0; }
    if (this.wantFocus && f) { this.wantFocus = false; f.focus({ preventScroll: true }); }
  }

  makeRow(r, i) {
    const row = el('div', { class: 'dv-row', role: 'treeitem', 'data-i': i, 'data-n': r.n, 'aria-level': r.d + 1, tabindex: '-1' });
    row.style.top = i * ROW + 'px';
    row.style.setProperty('--d', r.d);
    if (r.e) row.setAttribute('aria-expanded', r.x ? 'true' : 'false');
    if (i === this.selected) row.setAttribute('aria-selected', 'true');
    if (r.n === this.hitNode) row.classList.add('dv-current');
    const tw = el('span', { class: 'dv-twisty' + (r.e ? '' : ' dv-twisty-none'), 'data-act': 'toggle' });
    if (r.e) { tw.append(icon('chevron-right', 14)); if (r.x) tw.classList.add('dv-open'); }
    row.append(tw);
    const q = this.query;
    const label = el('span', { class: 'dv-key' });
    if (this.xml) {
      if (r.t === 'E') {
        label.className = 'dv-tag';
        label.append('<', marked(r.k, q, this.cs));
        row.append(label);
        if (r.a) row.append(this.attrs(r.a, q));
        row.append(el('span', { class: 'dv-tag', text: r.v !== undefined || r.c === 0 ? (r.c === 0 && r.v === undefined ? ' />' : '>') : '>' }));
        if (r.v !== undefined) row.append(el('span', { class: 'dv-val dv-t-s' }, marked(r.v, q, this.cs)), el('span', { class: 'dv-tag', text: '</' + r.k + '>' }));
        else if (r.e) row.append(el('span', { class: 'dv-meta', text: num(r.c) }));
      } else {
        const kind = { T: 'text', C: 'comment', D: 'cdata', P: 'pi', Q: 'doctype' }[r.t] || 'text';
        row.append(el('span', { class: 'dv-xk dv-x-' + kind, text: { text: '', comment: '<!--', cdata: 'CDATA', pi: '', doctype: '' }[kind] }));
        const v = el('span', { class: 'dv-val dv-x-v-' + kind });
        v.append(marked(r.v || '', q, this.cs));
        row.append(v);
      }
    } else {
      if (r.k !== undefined) label.append(marked(r.k, q, this.cs));
      else if (r.i !== undefined) { label.className = 'dv-key dv-idx'; label.textContent = this.ctx.kind === 'jsonl' ? '#' + r.i : String(r.i); }
      else { label.className = 'dv-key dv-root'; label.textContent = '$'; }
      row.append(label, el('span', { class: 'dv-colon', text: ':' }));
      if (r.t === 'o' || r.t === 'a') {
        row.append(el('span', { class: 'dv-brace', text: r.t === 'o' ? '{' : '[' }));
        row.append(el('span', { class: 'dv-meta', text: num(r.c) + ' ' + t(r.t === 'o' ? (r.c === 1 ? 'key' : 'keys') : (r.c === 1 ? 'item' : 'items')) }));
        if (r.p && !r.x) row.append(el('span', { class: 'dv-preview', text: r.p }));
        if (r.c === 0) row.append(el('span', { class: 'dv-brace', text: r.t === 'o' ? '}' : ']' }));
      } else if (r.t === 'e') {
        row.classList.add('dv-bad');
        row.append(el('span', { class: 'dv-val dv-t-e', text: r.v }), el('span', { class: 'dv-err', text: t(r.err.m, r.err.a) + ' (' + t('column {n}', { n: r.err.col }) + ')' }));
      } else {
        const v = el('span', { class: 'dv-val dv-t-' + r.t });
        if (r.t === 's') v.append('"', marked(r.v, q, this.cs), r.m ? '…' : '', '"');
        else v.append(marked(r.v, q, this.cs));
        row.append(v);
      }
    }
    const actions = el('span', { class: 'dv-row-actions' });
    actions.append(
      button({ icon: 'link', label: 'Copy path', onClick: (e) => { e.stopPropagation(); this.copyNode(r.n, 'path'); }, cls: 'dv-mini' }),
      button({ icon: 'copy', label: 'Copy value', onClick: (e) => { e.stopPropagation(); this.copyNode(r.n, 'value'); }, cls: 'dv-mini' }),
    );
    for (const b of actions.querySelectorAll('button')) b.tabIndex = -1;
    row.append(actions);
    return row;
  }

  attrs(raw, q) {
    const holder = el('span', { class: 'dv-attrs' });
    const re = /([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g;
    let m;
    while ((m = re.exec(raw))) {
      const ns = /^xmlns(?::|$)/.test(m[1]);
      holder.append(' ', el('span', { class: 'dv-attr' + (ns ? ' dv-attr-ns' : '') }, el('span', { class: 'dv-an' }, marked(m[1], q, this.cs)), '=', el('span', { class: 'dv-av' }, marked(m[2], q, this.cs))));
    }
    return holder;
  }

  // ---- acting on rows
  async copyNode(node, what) {
    try {
      const r = await this.worker.call('treeValue', { node, what: what === 'path' ? 'path' : 'full' });
      await this.ctx.copy(what === 'path' ? r.path : r.text, what === 'path' ? 'path' : 'value');
    } catch (err) { toast(err.message, 'error'); }
  }

  async showPath() {
    const data = this.rowData(this.selected >= 0 ? this.selected : this.focusIdx);
    if (!data) return;
    try {
      const r = await this.worker.call('treeValue', { node: data.n, what: 'path' });
      this.ctx.setStatus(r.path);
    } catch (err) { this.ctx.setStatus(err.message); }
  }

  async toggle(i, open) {
    const data = this.rowData(i);
    if (!data || !data.e) return;
    const r = await this.worker.call('treeToggle', { node: data.n, open, deep: false });
    this.invalidate(r.total);
    this.focusIdx = i;
    await this.render();
    this.ctx.onRows && this.ctx.onRows(this.total);
  }

  async setAll(open) {
    const r = await this.worker.call('treeAll', { open });
    this.invalidate(r.total);
    this.scroller.scrollTop = 0;
    this.focusIdx = 0;
    await this.render();
    this.ctx.onRows && this.ctx.onRows(this.total);
  }

  async openBranch(i) {
    const data = this.rowData(i);
    if (!data || !data.e) return;
    const r = await this.worker.call('treeToggle', { node: data.n, open: true, deep: true });
    this.invalidate(r.total);
    await this.render();
  }

  onClick(e) {
    const row = e.target.closest('.dv-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (e.target.closest('button')) return;
    this.select(i);
    if (e.target.closest('.dv-twisty')) this.toggle(i);
  }

  select(i) {
    this.selected = i; this.focusIdx = i;
    for (const [idx, node] of this.els) {
      if (idx === i) node.setAttribute('aria-selected', 'true'); else node.removeAttribute('aria-selected');
      node.tabIndex = idx === i ? 0 : -1;
    }
    this.updateStatus();
  }

  focusRow(i, keepScroll) {
    i = Math.max(0, Math.min(this.total - 1, i));
    this.focusIdx = i;
    const top = this.scroller.scrollTop;
    if (!keepScroll || i * ROW < top || (i + 1) * ROW > top + this.viewH) {
      if (i * ROW < top) this.scroller.scrollTop = i * ROW;
      else if ((i + 1) * ROW > top + this.viewH) this.scroller.scrollTop = (i + 1) * ROW - this.viewH;
    }
    this.wantFocus = true;
    this.select(i);
    this.render();
  }

  async onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = this.focusIdx;
    const data = this.rowData(i);
    const page = Math.max(1, Math.floor(this.viewH / ROW) - 1);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.focusRow(i + 1); break;
      case 'ArrowUp': e.preventDefault(); this.focusRow(i - 1); break;
      case 'PageDown': e.preventDefault(); this.focusRow(i + page); break;
      case 'PageUp': e.preventDefault(); this.focusRow(i - page); break;
      case 'Home': e.preventDefault(); this.focusRow(0); break;
      case 'End': e.preventDefault(); this.focusRow(this.total - 1); break;
      case 'ArrowRight':
        e.preventDefault();
        if (data && data.e && !data.x) { await this.toggle(i, true); this.focusRow(i, true); }
        else if (data && data.e) this.focusRow(i + 1);
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (data && data.e && data.x) { await this.toggle(i, false); this.focusRow(i, true); }
        else if (data) {
          const r = await this.worker.call('treeParentRow', { node: data.n });
          if (r.row >= 0) this.focusRow(r.row);
        }
        break;
      }
      case 'Enter': case ' ': e.preventDefault(); if (data && data.e) { await this.toggle(i); this.focusRow(i, true); } break;
      case '*': e.preventDefault(); await this.openBranch(i); this.focusRow(i, true); break;
      case 'p': if (data) { e.preventDefault(); this.copyNode(data.n, 'path'); } break;
      case 'v': if (data) { e.preventDefault(); this.copyNode(data.n, 'value'); } break;
      default: break;
    }
  }

  // ---- search
  async search(query, cs) {
    this.query = query; this.cs = !!cs;
    this.hits = null; this.hitIdx = -1; this.hitNode = -1;
    if (!query) { this.restyle(); return { count: 0, capped: false }; }
    const r = await this.worker.call('treeFind', { q: query, cs: !!cs });
    this.hits = r.nodes;
    this.capped = r.capped;
    this.restyle();
    if (this.hits.length) await this.go(0);
    return { count: this.hits.length, capped: r.capped };
  }

  restyle() {
    for (const e of this.els.values()) e.remove();
    this.els.clear();
    this.render();
  }

  async go(index) {
    if (!this.hits || !this.hits.length) return;
    const n = this.hits.length;
    this.hitIdx = ((index % n) + n) % n;
    const node = this.hits[this.hitIdx];
    this.hitNode = node;
    const r = await this.worker.call('treeReveal', { node });
    this.invalidate(r.total);
    this.focusIdx = r.row;
    this.selected = r.row;
    this.scroller.scrollTop = Math.max(0, r.row * ROW - this.viewH / 2 + ROW);
    await this.render();
    this.showPath();
    this.ctx.onRows && this.ctx.onRows(this.total);
    return this.hitIdx;
  }

  next() { return this.go(this.hitIdx + 1); }
  prev() { return this.go(this.hitIdx - 1); }
  hitState() { return { index: this.hitIdx, count: this.hits ? this.hits.length : 0 }; }
}
