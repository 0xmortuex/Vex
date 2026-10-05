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
// the bookmarks and visits it added as they were added, and the site,
// username and saved time of each login. Nothing that was already in Vex is
// changed, and undo leaves anything changed since where it is.
//
// Every import has its own undo, not just the latest: importing Chrome and
// then Firefox left the Chrome one impossible to take back (found
// 2026-10-03). The last KEEP of each kind are remembered.
const BrowserImport = {
  IMPORTS_KEY: 'vex.browserImports',
  LOGIN_IMPORTS_KEY: 'vex.passwordImports',
  KEEP: 10,
  // Before 2026-10-03 only the latest import of each kind was remembered;
  // such a record is moved into the list the first time the list is read.
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
    const record = { id: this._id('imp'), at: Date.now(), browserName: data.browserName, profileName: data.profile && data.profile.name, bookmarkIds: [], historyIds: [], historyDropped: 0 };
    // What undo checks each item against: as added, so a bookmark renamed or
    // moved since, or a page visited again since, is the person's now.
    let bookmarkRefs = [], historyRefs = [];
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
      bookmarkRefs = items.map(b => ({ id: b.id, url: b.url, title: b.title, folder: b.folder }));
    }
    if (takeHistory && p.history.length) {
      const items = p.history.map(h => ({
        id: this._id('h'), url: h.url, title: h.title || h.url, favicon: '',
        visitedAt: h.visitedAt || new Date(0).toISOString(),
      }));
      const ids = new Set(items.map(h => h.id));
      HistoryPanel.entries = HistoryPanel.entries.concat(items).sort((a, b) => HistoryPanel._when(b) - HistoryPanel._when(a));
      HistoryPanel.save();   // keeps the newest MAX_ENTRIES
      const kept = HistoryPanel.entries.filter(h => ids.has(h.id));
      record.historyIds = kept.map(h => h.id);
      record.historyDropped = items.length - record.historyIds.length;
      historyRefs = kept.map(h => ({ id: h.id, at: h.visitedAt }));
      HistoryPanel._refreshIfOpen?.();
    }
    if (record.bookmarkIds.length || record.historyIds.length) {
      this._addImport({
        id: record.id, at: record.at, browserName: record.browserName, profileName: record.profileName,
        added: { bookmarks: bookmarkRefs.length, history: historyRefs.length },
        bookmarks: bookmarkRefs, history: historyRefs,
      });
    }
    return record;
  },

  // --- The remembered imports ------------------------------------------------

  _read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (err) { throw new Error('The list of past imports could not be read: ' + err.message, { cause: err }); }
  },
  _write(key, list) {
    localStorage.setItem(key, JSON.stringify(list));
  },

  // The bookmarks-and-history imports, newest first.
  imports() {
    const saved = this._read(this.IMPORTS_KEY);
    const list = Array.isArray(saved) ? saved : [];
    const legacy = this._read(this.LAST_KEY);
    if (legacy && typeof legacy === 'object') {
      // An old record has ids only: undo matches those by id, as it always did.
      const bookmarks = (legacy.bookmarkIds || []).map(id => ({ id }));
      const history = (legacy.historyIds || []).map(id => ({ id }));
      list.unshift({
        id: 'imp_legacy_' + (legacy.at || 0), at: legacy.at || 0, browserName: legacy.browserName || 'another browser', profileName: legacy.profileName,
        added: { bookmarks: bookmarks.length, history: history.length }, bookmarks, history,
      });
      list.sort((a, b) => (b.at || 0) - (a.at || 0));
      this._write(this.IMPORTS_KEY, list.slice(0, this.KEEP));
      localStorage.removeItem(this.LAST_KEY);
    }
    return list.slice(0, this.KEEP);
  },

  _addImport(entry) {
    // Items deleted since can never be undone; dropping them keeps the list
    // small (a history import alone can be 5,000 visits).
    const haveB = new Set(Bookmarks.items.map(b => b.id));
    const haveH = new Set(HistoryPanel.entries.map(h => h.id));
    const older = this.imports().map(r => ({
      ...r,
      bookmarks: (r.bookmarks || []).filter(b => haveB.has(b.id)),
      history: (r.history || []).filter(h => haveH.has(h.id)),
    })).filter(r => r.bookmarks.length || r.history.length);
    try { this._write(this.IMPORTS_KEY, [entry, ...older].slice(0, this.KEEP)); }
    catch (err) { throw new Error('The import was added, but Vex could not remember it for undo: ' + err.message, { cause: err }); }
  },

  // Take back exactly what one import added and is still as it was added —
  // a bookmark or visit deleted since is not there to remove, and one
  // changed since is kept.
  undo(id) {
    const list = this.imports();
    const r = list.find(x => x.id === id);
    if (!r) throw new Error('That import is no longer in the list');
    const same = (ref, item) => ref.url === undefined || (item.url === ref.url && item.title === ref.title && item.folder === ref.folder);
    const bm = new Map((r.bookmarks || []).map(b => [b.id, b]));
    let kept = 0;
    const bBefore = Bookmarks.items.length;
    Bookmarks.items = Bookmarks.items.filter(b => {
      const ref = bm.get(b.id);
      if (!ref) return true;
      if (same(ref, b)) return false;
      kept++;
      return true;
    });
    const bookmarks = bBefore - Bookmarks.items.length;
    if (bookmarks) Bookmarks.save();
    HistoryPanel._hydrate();
    const hi = new Map((r.history || []).map(h => [h.id, h]));
    const hBefore = HistoryPanel.entries.length;
    HistoryPanel.entries = HistoryPanel.entries.filter(h => {
      const ref = hi.get(h.id);
      if (!ref) return true;
      if (ref.at === undefined || h.visitedAt === ref.at) return false;
      kept++;
      return true;
    });
    const history = hBefore - HistoryPanel.entries.length;
    if (history) { HistoryPanel.save(); HistoryPanel._refreshIfOpen?.(); }
    this._write(this.IMPORTS_KEY, list.filter(x => x.id !== id));
    return { bookmarks, history, kept };
  },

  // The passwords imports, newest first.
  loginImports() {
    const saved = this._read(this.LOGIN_IMPORTS_KEY);
    const list = Array.isArray(saved) ? saved : [];
    const legacy = this._read(this.LAST_LOGINS_KEY);
    if (legacy && typeof legacy === 'object') {
      list.unshift({ id: 'pw_legacy_' + (legacy.at || 0), at: legacy.at || 0, file: legacy.file || 'a file', logins: legacy.logins || [] });
      list.sort((a, b) => (b.at || 0) - (a.at || 0));
      this._write(this.LOGIN_IMPORTS_KEY, list.slice(0, this.KEEP));
      localStorage.removeItem(this.LAST_LOGINS_KEY);
    }
    return list.slice(0, this.KEEP);
  },

  async importPasswords({ browserName } = {}) {
    const r = await window.vex.browserImportPasswordsCsv();
    if (!r || r.canceled) return null;
    if (r.added.length) {
      // Hosts, usernames and saved times only — never a password.
      const entry = { id: this._id('pw'), at: Date.now(), browserName, file: r.file, logins: r.added.map(l => ({ host: l.host, username: l.username, updatedAt: l.updatedAt })) };
      try { this._write(this.LOGIN_IMPORTS_KEY, [entry, ...this.loginImports()].slice(0, this.KEEP)); }
      catch (err) { throw new Error('The logins were added, but Vex could not remember them for undo: ' + err.message, { cause: err }); }
    }
    return r;
  },

  // Deletes the logins one import added that are still as imported. A login
  // changed since (its saved time moved on) is kept. One that could not be
  // deleted stays in the record, so Undo can be pressed again.
  async undoPasswords(id) {
    const list = this.loginImports();
    const r = list.find(x => x.id === id);
    if (!r) throw new Error('That import is no longer in the list');
    const now = new Map((await window.vex.vaultList()).map(e => [e.host + '\n' + e.username, e.updatedAt]));
    let removed = 0, kept = 0;
    const failed = [];
    for (const l of r.logins || []) {
      const k = l.host + '\n' + l.username;
      if (!now.has(k)) continue;   // deleted since
      // A record from before saved times were kept matches on site + username.
      if (l.updatedAt !== undefined && now.get(k) !== l.updatedAt) { kept++; continue; }
      const res = await window.vex.vaultDelete({ host: l.host, username: l.username });
      if (res && res.ok) removed++; else failed.push(l);
    }
    this._write(this.LOGIN_IMPORTS_KEY, failed.length
      ? list.map(x => (x.id === id ? { ...x, logins: failed } : x))
      : list.filter(x => x.id !== id));
    return { removed, failed: failed.length, kept };
  },

  _n(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); },

  _when(at) {
    return at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'an earlier version of Vex';
  },

  // One line per import: where from, what, when, how much.
  describeImport(r) {
    const a = r.added || { bookmarks: (r.bookmarks || []).length, history: (r.history || []).length };
    const kind = a.bookmarks && a.history ? 'Bookmarks and history' : a.bookmarks ? 'Bookmarks' : 'History';
    const counts = [a.bookmarks ? this._n(a.bookmarks, 'bookmark', 'bookmarks') : '', a.history ? this._n(a.history, 'visit', 'visits') : ''].filter(Boolean).join(', ');
    return kind + ' from ' + r.browserName + (r.profileName ? ' (' + r.profileName + ')' : '') + ' · ' + this._when(r.at) + ' · ' + counts;
  },

  describeLoginImport(r) {
    return 'Passwords' + (r.browserName ? ' from ' + r.browserName : '') + ' (' + r.file + ') · ' + this._when(r.at) + ' · ' + this._n((r.logins || []).length, 'login', 'logins');
  },

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
      + '<div id="bi-imports" hidden style="margin-top:10px"><div class="vexsr-sub" style="font-weight:600">Your imports — the last ' + this.KEEP + ' can be undone</div><div id="bi-imports-rows"></div></div>'
      + '<div class="vexsr-note"><div style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text);font-size:12.5px">' + VexIcons.svg('key', { size: 13 }) + 'Passwords</div>'
      + '<div style="margin-top:4px">Vex does not read another browser\'s saved passwords. Export them from that browser yourself, then choose the file here — Vex adds every login it does not already have.</div>'
      + '<div class="vexsr-row" style="margin-top:8px"><select id="bi-pw-browser" class="vexsr-input" aria-label="Export passwords from">'
      + '<option value="chrome">Chrome</option><option value="edge">Edge</option><option value="brave">Brave</option><option value="firefox">Firefox</option></select>'
      + '<button id="bi-pw-go" class="vexsr-go">Choose the exported file…</button></div>'
      + '<div id="bi-pw-steps" style="margin-top:8px"></div>'
      + '<div id="bi-pw-msg" class="vexsr-msg" role="status"></div>'
      + '<div id="bi-pw-imports" hidden style="margin-top:8px"><div id="bi-pw-imports-rows"></div></div>'
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

    // One row per remembered import, each with its own Undo.
    const rowsInto = (wrap, rows, list, describe, onUndo) => {
      rows.textContent = '';
      wrap.hidden = !list.length;
      for (const r of list) {
        const row = document.createElement('div');
        row.className = 'vexsr-row bi-import';
        row.style.alignItems = 'center';
        row.dataset.importId = r.id;
        const what = document.createElement('span');
        what.className = 'vexsr-sub';
        what.style.flex = '1';
        what.textContent = describe(r);
        const btn = document.createElement('button');
        btn.className = 'vexsr-x';
        btn.innerHTML = VexIcons.svg('undo', { size: 12 }) + ' Undo';
        btn.setAttribute('aria-label', 'Undo: ' + what.textContent);
        btn.addEventListener('click', () => onUndo(r));
        row.append(what, btn);
        rows.appendChild(row);
      }
    };
    const showUndo = () => {
      try { rowsInto($('#bi-imports'), $('#bi-imports-rows'), this.imports(), r => this.describeImport(r), undoImport); }
      catch (err) { msg(err.message, true); }
      try { rowsInto($('#bi-pw-imports'), $('#bi-pw-imports-rows'), this.loginImports(), r => this.describeLoginImport(r), undoLogins); }
      catch (err) { pwMsg(err.message, true); }
    };

    const undoImport = async (r) => {
      const a = r.added || {};
      const ok = await vexConfirm({ title: 'Undo this import?', message: 'This removes the ' + this._n(a.bookmarks || 0, 'bookmark', 'bookmarks') + ' and ' + this._n(a.history || 0, 'visit', 'visits') + ' brought over from ' + r.browserName + ' on ' + this._when(r.at) + '. Any you have changed since stay, and nothing else is touched.', okLabel: 'Undo import' });
      if (!ok) return;
      try {
        const done = this.undo(r.id);
        msg('Removed ' + this._n(done.bookmarks, 'bookmark', 'bookmarks') + ' and ' + this._n(done.history, 'visit', 'visits') + '.'
          + (done.kept ? ' Kept ' + this._n(done.kept, 'item', 'items') + ' you changed since.' : ''));
      } catch (err) { msg(err.message, true); }
      showUndo();
    };

    const undoLogins = async (r) => {
      const exact = (r.logins || []).every(l => l.updatedAt !== undefined);
      const ok = await vexConfirm({ title: 'Undo this passwords import?', message: 'This deletes the ' + this._n((r.logins || []).length, 'login', 'logins') + ' added from ' + r.file + ' on ' + this._when(r.at)
        + (exact ? '. Logins you have changed since, and those that were already in Vex, are kept.' : ' — including any you have changed since. Logins that were already in Vex are not touched.'), okLabel: 'Delete them' });
      if (!ok) return;
      try {
        const done = await this.undoPasswords(r.id);
        pwMsg('Removed ' + this._n(done.removed, 'login', 'logins') + '.'
          + (done.kept ? ' Kept ' + this._n(done.kept, 'login', 'logins') + ' you changed since.' : '')
          + (done.failed ? ' ' + this._n(done.failed, 'could not be removed', 'could not be removed') + ' — try Undo again.' : ''), !!done.failed);
      } catch (err) { pwMsg(err.message, true); }
      showUndo();
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

    $('#bi-pw-go').addEventListener('click', async () => {
      pwMsg('');
      try {
        const sel = $('#bi-pw-browser');
        const r = await this.importPasswords({ browserName: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '' });
        if (!r) return;
        const left = [];
        if (r.duplicates) left.push(this._n(r.duplicates, 'was', 'were') + ' already saved');
        if (r.noUsername) left.push(this._n(r.noUsername, 'had', 'had') + ' no username');
        if (r.notWeb) left.push(this._n(r.notWeb, 'was not for a website', 'were not for a website'));
        pwMsg('Added ' + this._n(r.added.length, 'login', 'logins') + ' from ' + r.file + '.' + (left.length ? ' Left out: ' + left.join(', ') + '.' : ''));
        showUndo();
      } catch (err) { pwMsg(err.message, true); }
    });

  },
};

if (typeof window !== 'undefined') window.BrowserImport = BrowserImport;
if (typeof module !== 'undefined' && module.exports) module.exports = { BrowserImport };
