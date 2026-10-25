// The text view: numbered lines, wrap, search with hits, a jump to a line, colouring by language, and following a file as it grows.
// Lines live in chunks of a few dozen; only the chunks near the screen are filled, and their text comes from the worker. A small
// document (up to 4 MB) is read into the page once so the colouring can carry its state from line to line exactly.

import { el } from './ui.js';
import { t, num } from './strings.js';
import { highlightLines } from './highlight.js';

const LOCAL_MAX = 4 * 1024 * 1024;

export class TextView {
  // ctx: { worker, host, info: { count, bytes }, lang, wrap, lineNumbers, setStatus(text) }
  constructor(ctx) {
    this.ctx = ctx;
    this.worker = ctx.worker;
    this.lang = ctx.lang || 'plain';
    this.wrap = !!ctx.wrap;
    this.lineNumbers = ctx.lineNumbers !== false;
    this.count = ctx.info.count;
    this.bytes = ctx.info.bytes;
    this.local = null;          // all lines, for a small document
    this.query = ''; this.cs = false;
    this.hits = null; this.hitIdx = -1;
    this.hitsByLine = new Map();
    this.filled = new Map();    // chunk -> element holding lines
    this.heights = [];
    this.states = [''];
    this.token = 0;
  }

  async mount() {
    if (this.bytes <= LOCAL_MAX) await this.readLocal();
    this.build();
  }

  async readLocal() {
    const all = [];
    const more = [];
    for (let from = 0; from < this.count; from += 2000) {
      const r = await this.worker.call('linesGet', { from, count: 2000 });
      for (let i = 0; i < r.lines.length; i++) { all.push(r.lines[i]); more.push(r.more[i]); }
    }
    this.local = { lines: all, more };
  }

  build() {
    this.token++;
    const host = this.ctx.host;
    const scroller = el('div', { class: 'dv-text' + (this.wrap ? ' dv-wrap' : '') + (this.lineNumbers ? '' : ' dv-no-ln'), tabindex: '0', role: 'region', 'aria-label': t('Text of the document') });
    const body = el('div', { class: 'dv-chunks' });
    scroller.append(body);
    host.replaceChildren(scroller);
    this.scroller = scroller; this.body = body;
    this.lh = parseFloat(getComputedStyle(scroller).getPropertyValue('--dv-lh')) || 20;
    this.CH = this.count > 2000000 ? 256 : 64;
    this.nChunks = Math.max(1, Math.ceil(this.count / this.CH));
    this.digits = String(this.count).length;
    scroller.style.setProperty('--dv-digits', String(Math.max(3, this.digits)));
    const frag = document.createDocumentFragment();
    this.chunkEls = [];
    for (let c = 0; c < this.nChunks; c++) {
      const lines = Math.min(this.CH, this.count - c * this.CH);
      const node = el('div', { class: 'dv-chunk', 'data-c': c });
      node.style.height = (this.heights[c] || lines * this.lh) + 'px';
      this.chunkEls.push(node);
      frag.append(node);
    }
    body.append(frag);
    this.filled.clear();
    if (this.io) this.io.disconnect();
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const c = Number(e.target.dataset.c);
        if (e.isIntersecting) this.fill(c); else this.unfill(c);
      }
    }, { root: scroller, rootMargin: '900px 0px' });
    for (const n of this.chunkEls) this.io.observe(n);
    scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.states = [''];
  }

  destroy() { if (this.io) this.io.disconnect(); this.token++; }
  focus() { this.scroller.focus(); }

  // ---- drawing
  linesOf(c) {
    const a = c * this.CH, b = Math.min(this.count, a + this.CH);
    if (this.local) return Promise.resolve({ lines: this.local.lines.slice(a, b), more: this.local.more.slice(a, b) });
    return this.worker.call('linesGet', { from: a, count: b - a });
  }

  stateAt(c) {
    // the colouring state at the start of chunk c (small documents only: the lines are all here)
    if (!this.local) return '';
    while (this.states.length <= c) {
      const k = this.states.length - 1;
      const a = k * this.CH;
      this.states.push(highlightLines(this.lang, this.local.lines.slice(a, a + this.CH), this.states[k]).state);
    }
    return this.states[c];
  }

  async fill(c) {
    if (this.filled.has(c)) return;
    const token = this.token;
    this.filled.set(c, null);
    const data = await this.linesOf(c);
    if (token !== this.token || !this.filled.has(c)) return;
    const node = this.chunkEls[c];
    const a = c * this.CH;
    const html = this.lang === 'plain' ? null : highlightLines(this.lang, data.lines, this.stateAt(c)).html;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < data.lines.length; i++) {
      const line = el('div', { class: 'dv-line', 'data-l': a + i });
      line.append(el('span', { class: 'dv-ln', 'data-n': String(a + i + 1), 'aria-hidden': 'true' }));
      const code = el('span', { class: 'dv-code' });
      if (html) code.innerHTML = html[i] || '​'; else code.textContent = data.lines[i] || '​';
      if (data.more[i]) code.append(el('span', { class: 'dv-more', text: ' … ' + t('{n} more characters', { n: num(data.more[i]) }) }));
      line.append(code);
      frag.append(line);
    }
    node.replaceChildren(frag);
    node.style.height = '';
    if (!this.wrap) node.style.height = data.lines.length * this.lh + 'px';
    this.filled.set(c, node);
    this.applyHits(c);
    if (this.wrap) this.heights[c] = node.offsetHeight;
  }

  unfill(c) {
    const node = this.filled.get(c);
    this.filled.delete(c);
    if (!node) return;
    const h = node.offsetHeight;
    if (this.wrap) this.heights[c] = h;
    node.style.height = h + 'px';
    node.replaceChildren();
  }

  onScroll() {
    if (this.scrollTimer) return;
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = 0;
      this.ctx.setStatus(t('Line {n} of {total}', { n: num(this.topLine() + 1), total: num(this.count) }));
    }, 120);
  }

  topLine() {
    const y = this.scroller.scrollTop;
    // the chunk at this height: the chunks above are at their heights (fixed, or measured)
    if (!this.wrap) return Math.min(this.count - 1, Math.floor(y / this.lh));
    let acc = 0;
    for (let c = 0; c < this.nChunks; c++) {
      const h = this.chunkEls[c].offsetHeight;
      if (acc + h > y) { const lines = Math.min(this.CH, this.count - c * this.CH); return c * this.CH + Math.min(lines - 1, Math.floor(((y - acc) / Math.max(1, h)) * lines)); }
      acc += h;
    }
    return this.count - 1;
  }

  // ---- going to a line
  async goToLine(line, center = true) {
    line = Math.max(0, Math.min(this.count - 1, line));
    const c = Math.floor(line / this.CH);
    const chunk = this.chunkEls[c];
    if (!this.wrap) {
      const y = chunk.offsetTop + (line - c * this.CH) * this.lh;
      this.scroller.scrollTop = center ? Math.max(0, y - this.scroller.clientHeight / 2 + this.lh) : y;
    } else {
      this.scroller.scrollTop = chunk.offsetTop;
      await this.fill(c);
      const node = chunk.querySelector('[data-l="' + line + '"]');
      if (node) {
        const delta = node.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
        this.scroller.scrollTop += center ? delta - this.scroller.clientHeight / 2 + this.lh : delta;
      }
    }
    this.flash(line);
  }

  flash(line) {
    const mark = () => {
      const node = this.scroller.querySelector('[data-l="' + line + '"]');
      if (!node) return;
      node.classList.add('dv-flash');
      setTimeout(() => node.classList.remove('dv-flash'), 1400);
    };
    requestAnimationFrame(() => setTimeout(mark, 60));
  }

  scrollEnd() { this.scroller.scrollTop = this.scroller.scrollHeight; }
  atEnd() { return this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 4; }

  // ---- options
  async setWrap(on) { const top = this.topLine(); this.wrap = !!on; this.heights = []; this.build(); await this.goToLine(top, false); }
  setLineNumbers(on) { this.lineNumbers = !!on; this.scroller.classList.toggle('dv-no-ln', !on); }
  async setLang(lang) { const top = this.topLine(); this.lang = lang; this.states = ['']; this.build(); await this.goToLine(top, false); }

  // ---- search
  async search(query, cs) {
    this.query = query; this.cs = !!cs;
    this.hits = null; this.hitIdx = -1; this.hitsByLine = new Map();
    if (!query) { this.refreshHits(); return { count: 0, capped: false }; }
    const r = await this.worker.call('linesFind', { q: query, cs: !!cs });
    this.hits = { line: r.line, col: r.col, capped: r.capped };
    for (let i = 0; i < r.line.length; i++) {
      if (r.col[i] < 0) continue;
      const list = this.hitsByLine.get(r.line[i]);
      if (list) list.push(i); else this.hitsByLine.set(r.line[i], [i]);
    }
    this.refreshHits();
    if (r.line.length) await this.go(this.nearest());
    return { count: r.line.length, capped: r.capped };
  }

  // the first hit at or after the top of the screen
  nearest() {
    const top = this.topLine();
    const lines = this.hits.line;
    for (let i = 0; i < lines.length; i++) if (lines[i] >= top) return i;
    return 0;
  }

  refreshHits() { for (const c of this.filled.keys()) this.applyHits(c); }

  applyHits(c) {
    const node = this.filled.get(c);
    if (!node) return;
    for (const old of node.querySelectorAll('mark.dv-hit')) { const p = old.parentNode; p.replaceChild(document.createTextNode(old.textContent), old); p.normalize(); }
    if (!this.hits) return;
    for (const lineEl of node.children) {
      const idxs = this.hitsByLine.get(Number(lineEl.dataset.l));
      if (!idxs) continue;
      markRanges(lineEl.querySelector('.dv-code'), idxs.map((i) => [this.hits.col[i], this.hits.col[i] + this.query.length, i === this.hitIdx]));
    }
  }

  async go(index) {
    if (!this.hits || !this.hits.line.length) return;
    const n = this.hits.line.length;
    this.hitIdx = ((index % n) + n) % n;
    await this.goToLine(this.hits.line[this.hitIdx], true);
    this.refreshHits();
    return this.hitIdx;
  }
  next() { return this.go(this.hitIdx + 1); }
  prev() { return this.go(this.hitIdx - 1); }
  hitState() { return { index: this.hitIdx, count: this.hits ? this.hits.line.length : 0 }; }

  // ---- a growing document
  async appended(info) {
    const before = this.count;
    this.count = info.count; this.bytes = info.bytes;
    if (this.local) {
      if (this.bytes > LOCAL_MAX) { this.local = null; this.states = ['']; }
      else await this.readLocal();
    }
    const stick = this.atEnd();
    // Only what was added: the chunk the old end was in is drawn again, and new chunks follow it. Nothing above is touched.
    const lastOld = Math.max(0, Math.ceil(before / this.CH) - 1);
    const nChunks = Math.max(1, Math.ceil(this.count / this.CH));
    this.digits = String(this.count).length;
    this.scroller.style.setProperty('--dv-digits', String(Math.max(3, this.digits)));
    if (this.filled.has(lastOld)) { this.filled.delete(lastOld); this.chunkEls[lastOld].replaceChildren(); }
    this.chunkEls[lastOld].style.height = Math.min(this.CH, this.count - lastOld * this.CH) * this.lh + 'px';
    const frag = document.createDocumentFragment();
    for (let c = this.nChunks; c < nChunks; c++) {
      const node = el('div', { class: 'dv-chunk', 'data-c': c });
      node.style.height = Math.min(this.CH, this.count - c * this.CH) * this.lh + 'px';
      this.chunkEls.push(node);
      frag.append(node);
      this.io.observe(node);
    }
    this.body.append(frag);
    this.nChunks = nChunks;
    // the observer reports a chunk again when its contents change size; the old end chunk is asked for again here
    this.io.unobserve(this.chunkEls[lastOld]); this.io.observe(this.chunkEls[lastOld]);
    if (stick) requestAnimationFrame(() => this.scrollEnd());
  }
}

// Wraps the characters [from, to) of an element's text in <mark>, across its text nodes (the colouring spans split it).
function markRanges(root, ranges) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, start: pos }); pos += n.data.length; }
  // from the end, so earlier offsets stay true
  for (const [from, to, current] of [...ranges].sort((x, y) => y[0] - x[0])) {
    for (let k = nodes.length - 1; k >= 0; k--) {
      const { n, start } = nodes[k];
      const end = start + n.data.length;
      if (end <= from || start >= to) continue;
      const a = Math.max(from, start) - start, b = Math.min(to, end) - start;
      const range = document.createRange();
      range.setStart(n, a); range.setEnd(n, b);
      const mark = document.createElement('mark');
      mark.className = 'dv-hit' + (current ? ' dv-current' : '');
      range.surroundContents(mark);
    }
  }
}
