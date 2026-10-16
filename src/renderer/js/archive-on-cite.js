// === Archive on cite: a local copy when you cite a page, and a flag if it changes ==
//
// T3-112. You copy a quote with its source, or cite a source, and the page you
// cited is the one thing that can still change underneath you. When that
// happens on the page in front, Vex offers ONCE to keep a copy in the archive
// library (the same store, the same refusals and the same size cap as "Archive
// this page": nothing from a private or Tor tab, nothing from a banking, mail,
// sign-in or health site), and remembers a short fingerprint of the page's text
// (a list of hashes of its longer lines, no text) so that, when you open that
// page again and a good part of it has gone, the cited page is flagged "changed
// since cited" and a line in the Attention Inbox says so.
//
// Never automatic: the copy is made only when you press "Keep a copy". Never
// uploaded: the copy and the fingerprints stay on this computer, are not synced
// and are not in a backup. Off switch: Settings › Archive on cite (or Minimal Vex).
//
//   VexArchiveOnCite.lineHashes(text)            pure: up to 300 hashes of the longer lines
//   VexArchiveOnCite.changed(oldHashes, newHashes)  pure: { kept, changed }

const VexArchiveOnCite = {
  PREF: 'vex.archiveOnCite.prefs',      // { enabled }
  KEY: 'vex.archiveOnCite.cited',       // { [urlKey]: { url, title, at, hashes, archiveId, changedAt } }
  FEATURE: 'archive-on-cite',
  MAX: 100,
  MAX_HASHES: 300,
  MIN_LINE: 40,                          // only lines of an article's body, not menus and dates
  CHANGED_BELOW: 0.8,                    // the page changed when fewer of the old lines are still there
  HASH_SCRIPT: '(document.body ? document.body.innerText : "").slice(0, 300000)',

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[ArchiveOnCite] the setting could not be read:', err.message); return false; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },

  // ---- pure ---------------------------------------------------------------------------
  _hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  },
  lineHashes(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
      const line = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      if (line.length < this.MIN_LINE) continue;
      const h = this._hash(line);
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
      if (out.length >= this.MAX_HASHES) break;
    }
    return out;
  },
  // How much of the page you cited is still there.
  changed(oldHashes, newHashes) {
    if (!Array.isArray(oldHashes) || oldHashes.length < 5) return { kept: 1, changed: false, known: false };
    const now = new Set(newHashes);
    const kept = oldHashes.filter(h => now.has(h)).length / oldHashes.length;
    return { kept, changed: kept < this.CHANGED_BELOW, known: true };
  },
  _key(url) {
    try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, '') + u.search; } catch { return String(url || ''); }
  },

  // ---- storage ------------------------------------------------------------------------
  cited() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return {};
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The cited pages could not be read: ' + err.message, { cause: err }); }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  _save(map) {
    const keys = Object.keys(map).sort((a, b) => (map[b].at || 0) - (map[a].at || 0));
    const kept = {};
    for (const k of keys.slice(0, this.MAX)) kept[k] = map[k];
    localStorage.setItem(this.KEY, JSON.stringify(kept));
    this._keys = new Set(Object.keys(kept));
    return kept;
  },
  _hasKey(key) {
    if (!this._keys) this._keys = new Set(Object.keys(this.cited()));
    return this._keys.has(key);
  },
  forget(key) { const m = this.cited(); const gone = m[key]; delete m[key]; this._save(m); return gone || null; },

  // ---- the page in front ----------------------------------------------------------------
  _front() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
    const wv = WebviewManager.getActiveWebview?.();
    const tab = TabManager.getActiveTab?.();
    if (!wv || !tab) return null;
    let url = '';
    try { url = wv.getURL(); } catch { return null; }
    return { wv, tab, url };
  },
  _refusal(front) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(front.wv)) return 'Private, Tor and routed tabs are never kept';
    if (!/^https?:\/\//i.test(front.url)) return 'Only a web page can be kept';
    return typeof VexPageSensitivity !== 'undefined' ? VexPageSensitivity.reason(front.url) : null;
  },

  async onCited(detail) {
    if (!this.enabled()) return false;
    const front = this._front();
    if (!front || !detail || this._key(front.url) !== this._key(detail.url)) return false;      // only the page that was cited, and only while it is in front
    if (this._refusal(front)) return false;
    const key = this._key(front.url);
    let hashes = [];
    try { hashes = this.lineHashes(await window.vexGuestEval(front.wv, this.HASH_SCRIPT, false, 3000)); }
    catch (err) { window.VexProblems?.note('Archive on cite', 'Could not read the page to fingerprint it; the change flag is off for this page', err); }
    const map = this.cited();
    const rec = { url: front.url, title: String(detail.title || front.tab.title || front.url).slice(0, 200), at: Date.now(), hashes, archiveId: (map[key] && map[key].archiveId) || '', changedAt: 0 };
    map[key] = rec;
    this._save(map);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    let archived = !!rec.archiveId;
    if (!archived) {
      const api = window.vex;
      if (api && typeof api.pageArchiveFind === 'function') {
        const found = await api.pageArchiveFind(front.url);
        if (found && found.ok && found.entry) { rec.archiveId = found.entry.id; map[key] = rec; this._save(map); archived = true; }
      }
    }
    if (!archived) this.offer(key, rec);
    return true;
  },

  offer(key, rec) {
    const show = () => window.showToast?.('Keep a copy of "' + rec.title.slice(0, 60) + '" on this computer? The page can change after you cite it.', 'info', 14000, {
      action: { label: 'Keep a copy', title: 'Archive this page in the library', run: () => { this.archive(key).catch(err => window.showToast?.(err.message, 'error', 6000)); } },
    });
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: this.FEATURE, label: 'Archive on cite', urgency: 'asked', id: key, title: 'Keep a copy of this page?' }, show);
    else show();
  },

  async archive(key) {
    if (typeof ArchiveLibrary === 'undefined') throw new Error('The archive library is not available here');
    const map = this.cited();
    const rec = map[key];
    if (!rec) throw new Error('That page is no longer in the cited list');
    const front = this._front();
    if (!front || this._key(front.url) !== key) throw new Error('Open the page again to keep a copy of it');
    const entry = await ArchiveLibrary.archiveActive();
    rec.archiveId = entry.id;
    map[key] = rec;
    this._save(map);
    window.showToast?.('Kept a copy of ' + rec.title.slice(0, 60), 'success');
    return entry;
  },

  // A tab finished loading: is it a page you cited, and has it changed?
  async check(tabId) {
    if (!this.enabled()) return null;
    const front = this._front();
    if (!front || front.tab.id !== tabId) return null;     // only the tab you are looking at; no background reads
    const map = this.cited();
    const key = this._key(front.url);
    const rec = map[key];
    if (!rec || rec.changedAt || this._refusal(front)) return null;
    const hashes = this.lineHashes(await window.vexGuestEval(front.wv, this.HASH_SCRIPT, false, 3000));
    const r = this.changed(rec.hashes, hashes);
    if (!r.known || !r.changed) return r;
    rec.changedAt = Date.now();
    map[key] = rec;
    this._save(map);
    const msg = 'A page you cited has changed since: ' + rec.title.slice(0, 80);
    if (typeof VexAttention !== 'undefined') {
      VexAttention.notify({ feature: this.FEATURE, label: 'Archive on cite', urgency: 'useful', id: 'changed:' + key, title: msg, action: { label: 'See cited pages', key: 'open' } },
        () => window.showToast?.(msg, 'warn', 9000, { action: { label: 'See cited pages', run: () => this.open() } }));
    }
    return r;
  },

  // ---- the list -----------------------------------------------------------------------------
  open() {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-cited-pages', title: 'Cited pages', sub: 'Pages you cited, with the copy you kept and whether they have changed since. Copies stay on this computer.' });
    const draw = () => {
      body.textContent = '';
      let map;
      try { map = this.cited(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      const keys = Object.keys(map).sort((a, b) => map[b].at - map[a].at);
      if (!keys.length) body.appendChild(VexSettingsGroups.note('Nothing yet. Copy a passage with its source (Ctrl+K › Copy selection as) and Vex offers to keep a copy of the page.'));
      for (const key of keys) {
        const rec = map[key];
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.style.flexWrap = 'wrap';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = rec.title + '  (cited ' + new Date(rec.at).toLocaleDateString() + (rec.changedAt ? ', changed since' : '') + (rec.archiveId ? ', copy kept' : '') + ')';
        row.appendChild(text);
        row.appendChild(VexSettingsGroups.button('Open', () => { if (typeof TabManager !== 'undefined') TabManager.createTab(rec.url, true); }, { label: 'Open ' + rec.title }));
        if (rec.archiveId && typeof ArchiveLibrary !== 'undefined') {
          row.appendChild(VexSettingsGroups.button('Open copy', async () => { try { await ArchiveLibrary.openCopy(rec.archiveId); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: 'Open the kept copy of ' + rec.title }));
        }
        row.appendChild(VexSettingsGroups.button('Forget', () => {
          const gone = this.forget(key);
          draw();
          if (gone) window.VexUndo.offer({ message: 'Forgot the cited page "' + gone.title.slice(0, 60) + '" (a kept copy stays in the library)', undo: () => { const m = this.cited(); m[key] = gone; this._save(m); if (body.isConnected) draw(); } });
        }, { danger: true, label: 'Forget ' + rec.title }));
        body.appendChild(row);
      }
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('When you copy a passage with its source or cite a page, Vex offers once to keep a copy in the archive library, and flags the page if it changes later. The copy is made only when you press Keep a copy, stays on this computer, is never uploaded, and is never made from a private or Tor tab or a banking, mail or sign-in site.'));
    el.appendChild(VexSettingsGroups.button('See cited pages', () => this.open(), { primary: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    document.addEventListener('vex:source-cited', (e) => {
      this.onCited(e.detail).catch(err => window.VexProblems?.note('Archive on cite', 'Could not offer a copy of the cited page', err));
    });
    // A page you cited, opened again: look once it has settled (docs render a moment after load).
    document.addEventListener('vex:tab-settled', (e) => {
      const tabId = e.detail && e.detail.tabId;
      if (!this.enabled()) return;
      // Cheap first: most pages were never cited, and nothing is read for them.
      const tab = typeof TabManager !== 'undefined' ? (TabManager.tabs || []).find(t => t.id === tabId) : null;
      if (!tab || !this._hasKey(this._key(tab.url))) return;
      setTimeout(() => { this.check(tabId).catch(err => window.VexProblems?.note('Archive on cite', 'Could not check a cited page for changes', err)); }, 2500);
    });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexArchiveOnCite = VexArchiveOnCite;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'archive-on-cite', title: 'Archive on cite', keywords: 'archive cite copy changed since cited source page snapshot', before: 'about', build: (el) => VexArchiveOnCite.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'cited-pages', label: 'Cited pages', hint: 'Pages you cited, their kept copy and whether they changed', icon: 'archive', action: () => VexArchiveOnCite.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexArchiveOnCite };
