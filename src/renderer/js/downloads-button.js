// === The downloads button in the toolbar ===================================
//
// Downloads lived in a sidebar panel, which is two clicks and a hunt when
// what you want is "where did that file go". This is the button browsers put
// next to the extensions one: it shows what is running, drops down the last
// few, opens one on a click, and opens the full Downloads panel for the rest.
//
// It reads DownloadsPanel's list — one history, one set of rules about what
// is safe to open (DownloadsPanel._okToOpen asks before an installer runs).
//
// A download that has started opens it by itself and shows a bar: how much of
// how much, how fast, and how long is left — the thing every other browser
// does and Vex only did once the file had already finished.
const DownloadsButton = {
  RECENT: 6,

  // Speed is not reported, so it is measured here: bytes since the last
  // sample, smoothed, because a raw sample jumps around too much to read.
  _rate: new Map(),

  button() { return document.getElementById('btn-downloads-top'); },

  // A dot while something is downloading, and a bar across the button showing
  // how far along the busiest one is, so the button is worth glancing at.
  refresh() {
    const b = this.button();
    if (!b) return;
    const live = (DownloadsPanel.downloads || []).filter(d => d.state === 'progressing');
    this._sample(live);
    b.classList.toggle('has-active', live.length > 0);
    const pct = this._overall(live);
    b.style.setProperty('--dl-progress', pct == null ? '0' : String(pct));
    b.classList.toggle('has-progress', pct != null);
    b.title = live.length
      ? live.length + ' download' + (live.length === 1 ? '' : 's') + ' in progress' + (pct != null ? ' — ' + pct + '%' : '')
      : 'Downloads';
    if (this._open) this._fill();
  },

  // How far along everything running is, together, or null when nothing says.
  _overall(live) {
    const known = live.filter(d => d.totalBytes > 0);
    if (!known.length) return null;
    const got = known.reduce((s, d) => s + (d.receivedBytes || 0), 0);
    const all = known.reduce((s, d) => s + d.totalBytes, 0);
    return all > 0 ? Math.min(99, Math.round(got / all * 100)) : null;
  },

  // Bytes per second for each running download, and what it means for how
  // long is left.
  _sample(live) {
    const now = Date.now();
    const seen = new Set();
    for (const d of live) {
      seen.add(d.id);
      const prev = this._rate.get(d.id);
      if (!prev) { this._rate.set(d.id, { bytes: d.receivedBytes || 0, at: now, bps: 0 }); continue; }
      const dt = (now - prev.at) / 1000;
      if (dt < 0.4) continue;                                   // too soon to mean anything
      const bps = Math.max(0, ((d.receivedBytes || 0) - prev.bytes) / dt);
      // Smoothed: one slow sample on a fast line should not read as a stall.
      this._rate.set(d.id, { bytes: d.receivedBytes || 0, at: now, bps: prev.bps ? prev.bps * 0.6 + bps * 0.4 : bps });
    }
    for (const id of [...this._rate.keys()]) if (!seen.has(id)) this._rate.delete(id);
  },

  toggle() { return this._open ? this.close() : this.open(); },

  close() {
    // Closing it while something is still running means "not now": the next
    // file in a batch must not make it jump open again.
    this._dismissed = (DownloadsPanel.downloads || []).some(d => d.state === 'progressing');
    this._open?.remove();
    this._open = null;
    this._shield?.remove();
    this._shield = null;
    this._auto = false;
    document.removeEventListener('mousedown', this._away, true);
  },

  open(opts) {
    const b = this.button();
    if (!b) return null;
    if (this._open) return this._open;
    // A click on the PAGE is a click inside a <webview>, and none of those
    // ever reach this document — which is why the drop used to sit there
    // until you clicked the button again. This transparent layer sits just
    // under the drop and catches them, the same trick the tab menus use.
    const shield = document.createElement('div');
    shield.className = 'downloads-drop-shield';
    document.body.appendChild(shield);
    shield.addEventListener('mousedown', () => this.close());
    this._shield = shield;

    const menu = document.createElement('div');
    menu.className = 'downloads-drop';
    menu.setAttribute('role', 'menu');
    const r = b.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    document.body.appendChild(menu);
    this._open = menu;
    this._auto = !!(opts && opts.auto);
    this._fill();
    this._away = (e) => { if (!menu.contains(e.target) && !b.contains(e.target)) this.close(); };
    document.addEventListener('mousedown', this._away, true);
    return menu;
  },

  // A download just started: show it, the way every other browser does.
  // Only when it opened itself — if you have it open already nothing jumps,
  // and if you closed it during this download it stays closed.
  started() {
    if (this._open || this._dismissed) { this.refresh(); return; }
    this.open({ auto: true });
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
      if (dl.state === 'progressing') { menu.appendChild(this._liveRow(dl)); continue; }
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

  // One running download: a bar, and underneath it the three numbers that
  // answer "is this going to take all night" — how much of how much, how
  // fast, and how long is left. Pause and Cancel sit on the row itself,
  // because going to the panel to stop a download is a click too many.
  _liveRow(dl) {
    const row = document.createElement('div');
    row.className = 'downloads-drop-live' + (dl.paused ? ' paused' : '');
    const pct = dl.totalBytes > 0 ? Math.min(100, Math.round(dl.receivedBytes / dl.totalBytes * 100)) : null;
    row.innerHTML = `
      <div class="ddl-top"><span class="ddl-name"></span><span class="ddl-pct"></span></div>
      <div class="ddl-bar${pct == null ? ' unknown' : ''}"><i style="width:${pct == null ? 100 : pct}%"></i></div>
      <div class="ddl-meta"><span class="ddl-detail"></span>
        <span class="ddl-acts">
          <button type="button" data-do="${dl.paused ? 'resume' : 'pause'}">${dl.paused ? 'Resume' : 'Pause'}</button>
          <button type="button" data-do="cancel">Cancel</button>
        </span></div>`;
    row.querySelector('.ddl-name').textContent = dl.filename || 'download';
    row.querySelector('.ddl-name').title = dl.filename || 'download';
    row.querySelector('.ddl-pct').textContent = pct == null ? '' : pct + '%';
    row.querySelector('.ddl-detail').textContent = this.detail(dl, (this._rate.get(dl.id) || {}).bps || 0);
    row.querySelectorAll('[data-do]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = b.dataset.do;
      if (!window.vex || typeof window.vex.downloadsControl !== 'function') { window.showToast?.('Vex cannot reach that download', 'error'); return; }
      try { await window.vex.downloadsControl(dl.id, action); }
      catch (err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); }
      this.refresh();
    }));
    return row;
  },

  _size(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return (n || 0) + ' B';
  },

  // "24.1 MB of 240 MB · 3.1 MB/s · about 1 min left". Every part is left out
  // when it is not known, rather than guessed at.
  detail(dl, bps) {
    const parts = [];
    parts.push(dl.totalBytes > 0
      ? this._size(dl.receivedBytes || 0) + ' of ' + this._size(dl.totalBytes)
      : this._size(dl.receivedBytes || 0) + ' so far');
    if (dl.paused) { parts.push('paused'); return parts.join(' · '); }
    if (bps > 1024) parts.push(this._size(bps) + '/s');
    if (bps > 1024 && dl.totalBytes > 0) {
      const left = Math.max(0, dl.totalBytes - (dl.receivedBytes || 0)) / bps;
      const plural = (n, word) => 'about ' + n + ' ' + word + (n === 1 ? '' : 's') + ' left';
      parts.push(left < 10 ? 'nearly done'
        : left < 90 ? plural(Math.round(left), 'second')
          : left < 5400 ? plural(Math.round(left / 60), 'minute')
            : 'about ' + (left / 3600).toFixed(1) + ' hours left');
    }
    return parts.join(' · ');
  },

  _say(dl) {
    if (dl.state === 'progressing') {
      const pct = dl.totalBytes ? Math.round(dl.receivedBytes / dl.totalBytes * 100) + '%' : this._size(dl.receivedBytes);
      return dl.paused ? 'paused · ' + pct : pct;
    }
    if (dl.state === 'completed') return this._size(dl.totalBytes || dl.receivedBytes);
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
