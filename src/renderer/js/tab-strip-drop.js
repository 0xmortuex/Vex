// === Drop a link or a file on the tab strip ================================
//
// Chrome and Firefox open a link dragged onto the tab strip as a new tab where
// it was dropped, and a file from Explorer the same way; in Vex the drop did
// nothing (audit, 2026-10-10). Both strips take it: the top one (by x) and the
// sidebar list (by y). A tab dragged within the strip is the strips' own
// business (tabs.js, horizontal-tabs.js) and is left alone: it carries only
// text/plain, never a link list or files.
//
// Links: http(s) only (a page's drag can carry javascript: or data:).
// Files: through file://, and only kinds a browser shows rather than runs —
// pages, PDFs, pictures, text and media. Anything else is named and refused;
// Vex does not run a program because it was dropped on a tab.
const TabStripDrop = {
  SAFE_FILE: /\.(?:html?|xhtml|pdf|txt|md|json|xml|csv|log|png|jpe?g|gif|webp|bmp|ico|avif|svg|mp4|webm|ogv|ogg|mp3|wav|m4a|flac|opus)$/i,

  // What the drag carries that the strip can open: 'files', 'link', or null.
  kindOf(dt) {
    const types = dt && dt.types ? [...dt.types] : [];
    if (types.includes('Files')) return 'files';
    if (types.includes('text/uri-list')) return 'link';
    return null;
  },

  fileUrl(p) {
    return encodeURI('file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  },

  // → { urls, refused } from a drop's dataTransfer.
  urlsFrom(dt) {
    const urls = [], refused = [];
    if (this.kindOf(dt) === 'files') {
      for (const file of [...(dt.files || [])]) {
        const name = file && file.name ? file.name : 'file';
        if (!this.SAFE_FILE.test(name)) { refused.push(name); continue; }
        const p = window.vex.pathForFile(file);
        if (!p) { refused.push(name); continue; }
        urls.push(this.fileUrl(p));
      }
      return { urls, refused };
    }
    const lines = String(dt.getData('text/uri-list') || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    for (const line of lines) {
      let u;
      try { u = new URL(line); } catch { refused.push(line); continue; }
      if (u.protocol === 'http:' || u.protocol === 'https:') urls.push(u.href); else refused.push(line);
    }
    return { urls, refused };
  },

  // The tab nearest the pointer along the strip, and whether the drop is past
  // its middle. null on an empty strip.
  targetAt(container, x, y) {
    const horizontal = container.id === 'top-tab-bar' || !!container.closest?.('#top-tab-bar');
    const sel = horizontal ? '.top-tab[data-tab-id]:not(.in-stack)' : '.tab-item[data-tab-id]';
    const scope = document.getElementById(horizontal ? 'top-tabs-list' : 'tabs-sidebar') || container;
    let best = null, bestDist = Infinity;
    for (const el of scope.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const center = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      const d = Math.abs((horizontal ? x : y) - center);
      if (d < bestDist) { bestDist = d; best = { el, after: (horizontal ? x : y) > center, horizontal }; }
    }
    return best;
  },

  _clear() {
    document.querySelectorAll('.top-tab.ext-drop-before, .top-tab.ext-drop-after, .tab-item.ext-drop')
      .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drag-over', 'ext-drop-before', 'ext-drop-after', 'ext-drop'));
  },

  _onDragOver(e, container) {
    if (!this.kindOf(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    this._clear();
    const t = this.targetAt(container, e.clientX, e.clientY);
    if (!t) return;
    if (t.horizontal) t.el.classList.add(t.after ? 'drop-after' : 'drop-before', t.after ? 'ext-drop-after' : 'ext-drop-before');
    else t.el.classList.add('drag-over', 'ext-drop');
  },

  _onDrop(e, container) {
    if (!this.kindOf(e.dataTransfer)) return null;
    e.preventDefault();
    e.stopPropagation();
    this._clear();
    const { urls, refused } = this.urlsFrom(e.dataTransfer);
    if (refused.length) {
      window.showToast?.('Not opened: ' + refused.slice(0, 3).join(', ') + (refused.length > 3 ? ' and ' + (refused.length - 3) + ' more' : '')
        + ' — Vex opens web links, pages, PDFs, pictures, text and media files dropped here', 'error');
    }
    if (!urls.length) return [];
    const t = this.targetAt(container, e.clientX, e.clientY);
    const tab = t ? TabManager.tabs.find(x => x.id === t.el.dataset.tabId) : null;
    let at = tab ? TabManager.tabs.indexOf(tab) + (t.after ? 1 : 0) : TabManager.tabs.length;
    const made = [];
    urls.forEach((url, i) => {
      made.push(TabManager.createTab(url, i === 0, (tab && tab.groupId) || null, { atIndex: at++, allowDuplicate: true }));
    });
    return made;
  },

  install() {
    if (this._installed) return;
    this._installed = true;
    // Capture phase: the strips' own handlers would take a dropped link's
    // text for a tab id (tabs.js) and do nothing with it.
    for (const id of ['top-tab-bar', 'tabs-list', 'tab-groups-container']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('dragover', (e) => this._onDragOver(e, el), true);
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) this._clear(); }, true);
      el.addEventListener('drop', (e) => this._onDrop(e, el), true);
    }
  },
};

if (typeof window !== 'undefined') window.TabStripDrop = TabStripDrop;
if (typeof module !== 'undefined' && module.exports) module.exports = { TabStripDrop };
