// === Import from another browser ===========================================
//
// Bookmarks (folders kept) and history come straight from Chrome, Edge, Brave
// or Firefox on this PC — main/browser-import.js reads a copy of the profile's
// files and hands over addresses, titles and folders. Passwords are never read
// out of another browser: the person exports a CSV from that browser's own
// password manager and Vex adds it to the vault, in the main process.
//
// Every import shows its counts first, skips what Vex already has (same
// address, or same site + username for a login), puts bookmarks under
// "Imported from <Browser>", and is remembered so it can be undone exactly:
// the ids of the bookmarks and visits it added, and the site + username of
// each login. Nothing that was already in Vex is changed.
const BrowserImport = {
  LAST_KEY: 'vex.lastBrowserImport',
  LAST_LOGINS_KEY: 'vex.lastPasswordImport',

  // How to get a CSV out of each browser. They change their menus now and
  // then; the address bar route is the one that has lasted.
  CSV_STEPS: {
    chrome: 'In Chrome, open chrome://password-manager/settings, choose "Export passwords", then "Download file". Chrome asks for your Windows password first.',
    edge: 'In Edge, open edge://wallet/passwords (older versions: edge://settings/passwords). Open Settings — or the "…" menu next to Saved passwords — and choose "Export passwords".',
    brave: 'In Brave, open brave://password-manager/settings, choose "Export passwords", then "Download file".',
    firefox: 'In Firefox, open about:logins, click the "…" menu at the top right, choose "Export passwords…" and confirm.',
  },

  _id(prefix) {
    return typeof window.vexId === 'function' ? window.vexId(prefix) : prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  // What an import would add, against what Vex holds now. Pure, so the counts
  // shown before importing are the counts the import then makes.
  plan(data, { bookmarks = [], history = [] } = {}) {
    const have = new Set(bookmarks.map(b => b && b.url));
    const newBookmarks = [];
    let bookmarkDupes = 0;
    for (const b of data.bookmarks || []) {
      if (have.has(b.url)) { bookmarkDupes++; continue; }
      have.add(b.url);
      newBookmarks.push(b);
    }
    const seen = new Set(history.map(h => h && h.url));
    const newHistory = [];
    let historyDupes = 0;
    for (const h of (data.history && data.history.items) || []) {
      if (seen.has(h.url)) { historyDupes++; continue; }
      seen.add(h.url);
      newHistory.push(h);
    }
    return { bookmarks: newBookmarks, bookmarkDupes, history: newHistory, historyDupes, historyTotal: (data.history && data.history.total) || 0 };
  },

  folderFor(browserName, trail) {
    return ['Imported from ' + browserName, ...(trail || [])].join(' / ');
  },

  // Add what plan() found. Returns exactly what was added.
  apply(data, { bookmarks: takeBookmarks = true, history: takeHistory = true } = {}) {
    if (typeof Bookmarks === 'undefined' || typeof HistoryPanel === 'undefined') throw new Error('Bookmarks and history are not ready yet — try again in a moment');
    HistoryPanel._hydrate();
    const p = this.plan(data, { bookmarks: Bookmarks.items, history: HistoryPanel.entries });
    const record = { at: Date.now(), browserName: data.browserName, profileName: data.profile && data.profile.name, bookmarkIds: [], historyIds: [], historyDropped: 0 };
    if (takeBookmarks && p.bookmarks.length) {
      const now = Date.now();
      const items = p.bookmarks.map(b => ({
        id: this._id('bm'), url: b.url, title: b.title || b.url,
        folder: this.folderFor(data.browserName, b.path),
        at: Date.parse(b.addedAt || '') || now,
      }));
      // After the person's own bookmarks, which stay at the top.
      Bookmarks.items = Bookmarks.items.concat(items);
      Bookmarks.save();
      record.bookmarkIds = items.map(b => b.id);
    }
    if (takeHistory && p.history.length) {
      const items = p.history.map(h => ({
        id: this._id('h'), url: h.url, title: h.title || h.url, favicon: '',
        visitedAt: h.visitedAt || new Date(0).toISOString(),
      }));
      const ids = new Set(items.map(h => h.id));
      HistoryPanel.entries = HistoryPanel.entries.concat(items).sort((a, b) => HistoryPanel._when(b) - HistoryPanel._when(a));
      HistoryPanel.save();   // keeps the newest MAX_ENTRIES
      record.historyIds = HistoryPanel.entries.filter(h => ids.has(h.id)).map(h => h.id);
      record.historyDropped = items.length - record.historyIds.length;
      HistoryPanel._refreshIfOpen?.();
    }
    if (record.bookmarkIds.length || record.historyIds.length) this._remember(this.LAST_KEY, record);
    return record;
  },

  _remember(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { console.error('[BrowserImport] could not remember the import for undo:', err.message); }
  },
  _recall(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; }
    catch { return null; }
  },

  // Take back exactly what the last import added — a bookmark or visit the
  // person deleted since is simply not there to remove.
  undo() {
    const r = this._recall(this.LAST_KEY);
    if (!r) return { bookmarks: 0, history: 0 };
    const bm = new Set(r.bookmarkIds || []), hi = new Set(r.historyIds || []);
    const before = { b: Bookmarks.items.length };
    Bookmarks.items = Bookmarks.items.filter(b => !bm.has(b.id));
    Bookmarks.save();
    HistoryPanel._hydrate();
    const hBefore = HistoryPanel.entries.length;
    HistoryPanel.entries = HistoryPanel.entries.filter(h => !hi.has(h.id));
    HistoryPanel.save();
    HistoryPanel._refreshIfOpen?.();
    localStorage.removeItem(this.LAST_KEY);
    return { bookmarks: before.b - Bookmarks.items.length, history: hBefore - HistoryPanel.entries.length };
  },

  async importPasswords() {
    const r = await window.vex.browserImportPasswordsCsv();
    if (!r || r.canceled) return null;
    if (r.added.length) this._remember(this.LAST_LOGINS_KEY, { at: Date.now(), file: r.file, logins: r.added });
    return r;
  },

  async undoPasswords() {
    const r = this._recall(this.LAST_LOGINS_KEY);
    if (!r) return { removed: 0, failed: 0 };
    let removed = 0, failed = 0;
    for (const l of r.logins || []) {
      const res = await window.vex.vaultDelete({ host: l.host, username: l.username });
      if (res && res.ok) removed++; else failed++;
    }
    if (!failed) localStorage.removeItem(this.LAST_LOGINS_KEY);
    return { removed, failed };
  },

  _n(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); },

  async open() {
    document.getElementById('vex-browser-import')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-browser-import';
    m.className = 'vexsr-ov';
    m.innerHTML = '<div class="vexsr-card" role="dialog" aria-modal="true" aria-labelledby="bi-title"><div class="vexsr-head">'
      + '<span class="vexsr-title" id="bi-title">Import from another browser</span>'
      + '<button class="vexsr-x" id="bi-close" aria-label="Close" title="Close">' + VexIcons.svg('x', { size: 13 }) + '</button></div>'
      + '<div class="vexsr-sub">Bookmarks with their folders, and your recent history, from Chrome, Edge, Brave or Firefox on this PC. The browser can stay open — Vex reads a copy.</div>'
      + '<div class="vexsr-row" style="margin-top:12px">'
      + '<select id="bi-browser" class="vexsr-input" aria-label="Browser"></select>'
      + '<select id="bi-profile" class="vexsr-input" aria-label="Profile"></select>'
      + '<button id="bi-look" class="vexsr-x">Check</button>'
      + '</div>'
      + '<div id="bi-plan" hidden style="margin-top:10px">'
      + '<label class="vexsr-check"><input type="checkbox" id="bi-take-bm" checked> <span id="bi-bm-count"></span></label>'
      + '<label class="vexsr-check" style="margin-top:6px"><input type="checkbox" id="bi-take-hist" checked> <span id="bi-hist-count"></span></label>'
      + '<div class="vexsr-row" style="margin-top:10px;justify-content:flex-end"><button id="bi-go" class="vexsr-go">Import</button></div>'
      + '</div>'
      + '<div id="bi-msg" class="vexsr-msg" role="status"></div>'
      + '<div id="bi-undo-row" class="vexsr-row" hidden style="align-items:center"><span id="bi-undo-what" class="vexsr-sub" style="flex:1"></span><button id="bi-undo" class="vexsr-x">' + VexIcons.svg('undo', { size: 12 }) + ' Undo</button></div>'
      + '<div class="vexsr-note"><div style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text);font-size:12.5px">' + VexIcons.svg('key', { size: 13 }) + 'Passwords</div>'
      + '<div style="margin-top:4px">Vex does not read another browser\'s saved passwords. Export them from that browser yourself, then choose the file here — Vex adds every login it does not already have.</div>'
      + '<div class="vexsr-row" style="margin-top:8px"><select id="bi-pw-browser" class="vexsr-input" aria-label="Export passwords from">'
      + '<option value="chrome">Chrome</option><option value="edge">Edge</option><option value="brave">Brave</option><option value="firefox">Firefox</option></select>'
      + '<button id="bi-pw-go" class="vexsr-go">Choose the exported file…</button></div>'
      + '<div id="bi-pw-steps" style="margin-top:8px"></div>'
      + '<div id="bi-pw-msg" class="vexsr-msg" role="status"></div>'
      + '<div id="bi-pw-undo-row" class="vexsr-row" hidden style="align-items:center"><span id="bi-pw-undo-what" class="vexsr-sub" style="flex:1"></span><button id="bi-pw-undo" class="vexsr-x">' + VexIcons.svg('undo', { size: 12 }) + ' Undo</button></div>'
      + '<div style="margin-top:6px">The exported file holds every password in plain text. Delete it once Vex has them, and empty the Recycle Bin.</div>'
      + '</div></div>';
    document.body.appendChild(m);

    const $ = (s) => m.querySelector(s);
    const say = (el, t, bad) => { el.textContent = t || ''; el.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const msg = (t, bad) => say($('#bi-msg'), t, bad);
    const pwMsg = (t, bad) => say($('#bi-pw-msg'), t, bad);

    // Escape closes it the way the X does; an Escape meant for a vexConfirm on
    // top is left to that dialog (same as the backup screen).
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    $('#bi-close').addEventListener('click', close);
    $('#bi-close').focus({ preventScroll: true });

    const showUndo = () => {
      const r = this._recall(this.LAST_KEY);
      $('#bi-undo-row').hidden = !r;
      if (r) $('#bi-undo-what').textContent = 'Last import from ' + r.browserName + ': ' + this._n((r.bookmarkIds || []).length, 'bookmark', 'bookmarks') + ', ' + this._n((r.historyIds || []).length, 'visit', 'visits') + '.';
      const p = this._recall(this.LAST_LOGINS_KEY);
      $('#bi-pw-undo-row').hidden = !p;
      if (p) $('#bi-pw-undo-what').textContent = 'Last passwords import (' + p.file + '): ' + this._n((p.logins || []).length, 'login', 'logins') + '.';
    };
    showUndo();

    const steps = () => { $('#bi-pw-steps').textContent = this.CSV_STEPS[$('#bi-pw-browser').value] || ''; };

    let sources = [];
    let data = null;
    const fillProfiles = () => {
      const src = sources.find(s => s.id === $('#bi-browser').value);
      const sel = $('#bi-profile');
      sel.textContent = '';
      for (const p of (src ? src.profiles : [])) sel.appendChild(new Option(p.name, p.id));
      sel.disabled = !src || src.profiles.length < 2;
      $('#bi-plan').hidden = true;
      data = null;
      if (src && this.CSV_STEPS[src.id]) { $('#bi-pw-browser').value = src.id; steps(); }
    };
    $('#bi-browser').addEventListener('change', fillProfiles);
    $('#bi-profile').addEventListener('change', () => { $('#bi-plan').hidden = true; data = null; });
    $('#bi-pw-browser').addEventListener('change', steps);
    steps();

    try { sources = await window.vex.browserImportSources(); }
    catch (err) { msg('Could not look for other browsers: ' + err.message, true); sources = []; }
    if (!m.isConnected) return;
    for (const s of sources) $('#bi-browser').appendChild(new Option(s.name, s.id));
    if (!sources.length) {
      $('#bi-browser').disabled = $('#bi-profile').disabled = $('#bi-look').disabled = true;
      if (!$('#bi-msg').textContent) msg('No Chrome, Edge, Brave or Firefox profile was found on this PC.');
    } else fillProfiles();

    $('#bi-look').addEventListener('click', async () => {
      const browser = $('#bi-browser').value, profile = $('#bi-profile').value;
      if (!browser || !profile) return;
      msg('Reading…');
      $('#bi-look').disabled = true;
      try { data = await window.vex.browserImportRead(browser, profile); }
      catch (err) { data = null; msg(err.message, true); return; }
      finally { $('#bi-look').disabled = false; }
      HistoryPanel._hydrate();
      const p = this.plan(data, { bookmarks: Bookmarks.items, history: HistoryPanel.entries });
      $('#bi-bm-count').textContent = this._n(p.bookmarks.length, 'bookmark', 'bookmarks') + ' to add'
        + (p.bookmarkDupes ? ' (' + this._n(p.bookmarkDupes, 'is', 'are') + ' already in Vex)' : '')
        + ', into "' + this.folderFor(data.browserName) + '"';
      const shownOf = p.historyTotal > (data.history.items || []).length ? ' — the latest ' + (data.history.items || []).length.toLocaleString() + ' of ' + p.historyTotal.toLocaleString() : '';
      $('#bi-hist-count').textContent = this._n(p.history.length, 'page', 'pages') + ' from history to add' + shownOf
        + (p.historyDupes ? ' (' + this._n(p.historyDupes, 'is', 'are') + ' already in Vex)' : '');
      $('#bi-take-bm').disabled = !p.bookmarks.length;
      $('#bi-take-hist').disabled = !p.history.length;
      $('#bi-go').disabled = !p.bookmarks.length && !p.history.length;
      $('#bi-plan').hidden = false;
      msg(p.bookmarks.length || p.history.length ? '' : 'Vex already has everything in this profile.');
    });

    $('#bi-go').addEventListener('click', () => {
      if (!data) return;
      try {
        const r = this.apply(data, { bookmarks: $('#bi-take-bm').checked, history: $('#bi-take-hist').checked });
        $('#bi-plan').hidden = true;
        data = null;
        msg('Added ' + this._n(r.bookmarkIds.length, 'bookmark', 'bookmarks') + ' and ' + this._n(r.historyIds.length, 'visit', 'visits') + ' from ' + r.browserName + '.'
          + (r.historyDropped ? ' ' + this._n(r.historyDropped, 'older visit was', 'older visits were') + ' left out — Vex keeps your latest ' + HistoryPanel.MAX_ENTRIES.toLocaleString() + '.' : ''));
        showUndo();
      } catch (err) { msg(err.message, true); }
    });

    $('#bi-undo').addEventListener('click', async () => {
      const r = this._recall(this.LAST_KEY);
      if (!r) return;
      const ok = await vexConfirm({ title: 'Undo the import?', message: 'This removes the ' + this._n((r.bookmarkIds || []).length, 'bookmark', 'bookmarks') + ' and ' + this._n((r.historyIds || []).length, 'visit', 'visits') + ' brought over from ' + r.browserName + '. Nothing else is touched.', okLabel: 'Undo import' });
      if (!ok) return;
      try {
        const done = this.undo();
        msg('Removed ' + this._n(done.bookmarks, 'bookmark', 'bookmarks') + ' and ' + this._n(done.history, 'visit', 'visits') + '.');
        showUndo();
      } catch (err) { msg(err.message, true); }
    });

    $('#bi-pw-go').addEventListener('click', async () => {
      pwMsg('');
      try {
        const r = await this.importPasswords();
        if (!r) return;
        const left = [];
        if (r.duplicates) left.push(this._n(r.duplicates, 'was', 'were') + ' already saved');
        if (r.noUsername) left.push(this._n(r.noUsername, 'had', 'had') + ' no username');
        if (r.notWeb) left.push(this._n(r.notWeb, 'was not for a website', 'were not for a website'));
        pwMsg('Added ' + this._n(r.added.length, 'login', 'logins') + ' from ' + r.file + '.' + (left.length ? ' Left out: ' + left.join(', ') + '.' : ''));
        showUndo();
      } catch (err) { pwMsg(err.message, true); }
    });

    $('#bi-pw-undo').addEventListener('click', async () => {
      const r = this._recall(this.LAST_LOGINS_KEY);
      if (!r) return;
      const ok = await vexConfirm({ title: 'Undo the passwords import?', message: 'This deletes the ' + this._n((r.logins || []).length, 'login', 'logins') + ' added from ' + r.file + ' — including any you have changed since. Logins that were already in Vex are not touched.', okLabel: 'Delete them' });
      if (!ok) return;
      try {
        const done = await this.undoPasswords();
        pwMsg('Removed ' + this._n(done.removed, 'login', 'logins') + '.' + (done.failed ? ' ' + this._n(done.failed, 'could not be removed', 'could not be removed') + ' — try Undo again.' : ''), !!done.failed);
        showUndo();
      } catch (err) { pwMsg(err.message, true); }
    });
  },
};

if (typeof window !== 'undefined') window.BrowserImport = BrowserImport;
if (typeof module !== 'undefined' && module.exports) module.exports = { BrowserImport };
