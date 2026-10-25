// A virtual list: only the rows (or tiles) that can be seen exist as elements, so a folder of 100,000 entries costs about as much as one of 50.
// The list is `count` items in rows of one (a column of rows) or in a grid of tiles. createNode(i) makes an element, bindNode(node, i) fills it.
// The active item's element is always kept (even scrolled out of sight) so keyboard focus is never lost to a recycled row.

const OVERSCAN_ROWS = 4;

export class VirtualList {
  constructor({ scroller, content, createNode, bindNode, onRange }) {
    this.scroller = scroller;
    this.content = content;
    this.createNode = createNode;
    this.bindNode = bindNode;
    this.onRange = onRange || null;
    this.nodes = new Map();
    this.count = 0;
    this.rowH = 32;
    this.tileW = 0;
    this.perRow = 1;
    this.grid = false;
    this.pinned = -1;
    this.range = [0, -1];
    this._raf = 0;
    scroller.addEventListener('scroll', () => this._soon(), { passive: true });
    this._resize = new ResizeObserver(() => { this.layout(); this.update(); });
    this._resize.observe(scroller);
  }

  // rows: { grid: false, rowHeight } ; tiles: { grid: true, tileW, tileH }
  configure({ count, grid, rowHeight, tileW, tileH }) {
    this.count = count;
    this.grid = !!grid;
    this.rowH = grid ? tileH : rowHeight;
    this.tileW = grid ? tileW : 0;
    this.clear();
    this.layout();
    this.update();
  }
  setCount(count) {
    this.count = count;
    this.layout();
    for (const [i, node] of [...this.nodes]) if (i >= count) { node.remove(); this.nodes.delete(i); }
    this.update();
  }
  layout() {
    const width = this.scroller.clientWidth;
    this.perRow = this.grid ? Math.max(1, Math.floor(width / this.tileW)) : 1;
    this.cellW = this.grid ? Math.floor(width / this.perRow) : width;
    const rows = Math.ceil(this.count / this.perRow);
    this.content.style.height = rows * this.rowH + 'px';
    for (const [i, node] of this.nodes) this._place(node, i);
  }
  _place(node, i) {
    const row = Math.floor(i / this.perRow), col = i % this.perRow;
    node.style.top = row * this.rowH + 'px';
    node.style.height = this.rowH + 'px';
    if (this.grid) { node.style.left = col * this.cellW + 'px'; node.style.width = this.cellW + 'px'; }
    else { node.style.left = '0'; node.style.width = '100%'; }
  }
  clear() {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
  }
  _soon() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.update(); });
  }
  update() {
    const top = this.scroller.scrollTop, height = this.scroller.clientHeight;
    const rows = Math.ceil(this.count / this.perRow);
    const firstRow = Math.max(0, Math.floor(top / this.rowH) - OVERSCAN_ROWS);
    const lastRow = Math.min(rows - 1, Math.ceil((top + height) / this.rowH) + OVERSCAN_ROWS);
    const first = firstRow * this.perRow, last = Math.min(this.count - 1, (lastRow + 1) * this.perRow - 1);
    for (const [i, node] of [...this.nodes]) {
      if ((i < first || i > last) && i !== this.pinned) { node.remove(); this.nodes.delete(i); }
    }
    for (let i = first; i <= last; i++) if (!this.nodes.has(i)) this._make(i);
    if (this.pinned >= 0 && this.pinned < this.count && !this.nodes.has(this.pinned)) this._make(this.pinned);
    const changed = this.range[0] !== first || this.range[1] !== last;
    this.range = [first, last];
    if (changed && this.onRange) this.onRange(first, last);
  }
  _make(i) {
    const node = this.createNode(i);
    this._place(node, i);
    this.bindNode(node, i);
    this.content.append(node);
    this.nodes.set(i, node);
    return node;
  }
  // Fills every element that exists again (a selection or a name changed).
  refresh() { for (const [i, node] of this.nodes) this.bindNode(node, i); }
  refreshOne(i) { const node = this.nodes.get(i); if (node) this.bindNode(node, i); }
  nodeAt(i) { return this.nodes.get(i) || null; }
  setPinned(i) { this.pinned = i; }

  scrollToIndex(i) {
    if (i < 0 || i >= this.count) return;
    const row = Math.floor(i / this.perRow);
    const top = row * this.rowH, bottom = top + this.rowH;
    const st = this.scroller.scrollTop, h = this.scroller.clientHeight;
    if (top < st) this.scroller.scrollTop = top;
    else if (bottom > st + h) this.scroller.scrollTop = bottom - h;
    this.update();
  }
  get rowsPerPage() { return Math.max(1, Math.floor(this.scroller.clientHeight / this.rowH)); }
  destroy() { this._resize.disconnect(); this.clear(); }
}
