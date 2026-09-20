// === The downloads button in the toolbar ===================================
//
// Downloads lived in a sidebar panel, which is two clicks and a hunt when
// what you want is "where did that file go". This is the button browsers put
// next to the extensions one: it shows what is running, drops down the last
// few, opens one on a click, and opens the full Downloads panel for the rest.
//
// It reads DownloadsPanel's list — one history, one set of rules about what
// is safe to open (DownloadsPanel._okToOpen asks before an installer runs).
const DownloadsButton = {
  RECENT: 6,

  button() { return document.getElementById('btn-downloads-top'); },

  // A dot while something is downloading, so the button is worth glancing at.
  refresh() {
    const b = this.button();
    if (!b) return;
    const busy = (DownloadsPanel.downloads || []).filter(d => d.state === 'progressing').length;
    b.classList.toggle('has-active', busy > 0);
    b.title = busy ? busy + ' download' + (busy === 1 ? '' : 's') + ' in progress' : 'Downloads';
    if (this._open) this._fill();
  },

  toggle() { return this._open ? this.close() : this.open(); },

  close() {
    this._open?.remove();
    this._open = null;
    document.removeEventListener('mousedown', this._away, true);
  },

  open() {
    const b = this.button();
    if (!b) return null;
    const menu = document.createElement('div');
    menu.className = 'downloads-drop';
    menu.setAttribute('role', 'menu');
    const r = b.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    document.body.appendChild(menu);
    this._open = menu;
    this._fill();
    this._away = (e) => { if (!menu.contains(e.target) && !b.contains(e.target)) this.close(); };
    document.addEventListener('mousedown', this._away, true);
    return menu;
  },

  _fill() {
    const menu = this._open;
    if (!menu) return;
    const list = (DownloadsPanel.downloads || []).slice(0, this.RECENT);
    menu.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'downloads-drop-empty';
      empty.textContent = 'Nothing downloaded yet.';
      menu.appendChild(empty);
    }
    for (const dl of list) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'downloads-drop-row' + (dl.state === 'completed' ? '' : ' dim');
      row.setAttribute('role', 'menuitem');
      row.innerHTML = '<span class="ddr-name"></span><span class="ddr-meta"></span>';
      row.querySelector('.ddr-name').textContent = dl.filename || 'download';
      row.querySelector('.ddr-meta').textContent = this._say(dl);
      row.title = dl.state === 'completed' ? 'Open ' + (dl.filename || '') : this._say(dl);
      row.addEventListener('click', async () => {
        this.close();
        if (dl.state !== 'completed' || !dl.path) { SidebarManager.openPanel('downloads'); return; }
        if (!(await DownloadsPanel._okToOpen(dl.path, dl.url || ''))) return;
        const result = await window.vex.downloadsOpenFile?.(dl.path);
        if (result && !result.ok) window.showToast?.(result.error || 'Could not open that file', 'error');
      });
      menu.appendChild(row);
    }
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'downloads-drop-all';
    all.textContent = 'Open downloads';
    all.addEventListener('click', () => { this.close(); SidebarManager.openPanel('downloads'); });
    menu.appendChild(all);
  },

  _say(dl) {
    const size = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B';
    if (dl.state === 'progressing') {
      const pct = dl.totalBytes ? Math.round(dl.receivedBytes / dl.totalBytes * 100) + '%' : size(dl.receivedBytes);
      return dl.paused ? 'paused · ' + pct : pct;
    }
    if (dl.state === 'completed') return size(dl.totalBytes || dl.receivedBytes);
    return dl.state === 'cancelled' ? 'cancelled' : 'did not finish';
  },

  init() {
    const b = this.button();
    if (!b || b.dataset.wired) return false;
    b.dataset.wired = '1';
    b.addEventListener('click', () => this.toggle());
    this.refresh();
    return true;
  },
};

if (typeof window !== 'undefined') window.DownloadsButton = DownloadsButton;
if (typeof module !== 'undefined' && module.exports) module.exports = { DownloadsButton };
