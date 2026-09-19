// === Vex Library: Read Later + auto-archived tabs + Clip to Notes ===
//
// ReadLater — a saved-articles queue ('vex.readLater'): save via Ctrl+K or the
// Library panel; opening an item marks it read. The Library sidebar panel also
// shows tabs auto-archived by TabArchiver.
// TabArchiver — tabs untouched for N days (Settings → Library, 0 = off) are
// closed into 'vex.archivedTabs' instead of rotting open forever.
// ClipToNotes — saves the page selection (or the page link) into a Notes note,
// with source URL + date, using NotesPanel's storage format.

const ReadLater = {
  KEY: 'vex.readLater',
  items: [],
  init() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); this.items = Array.isArray(a) ? a : []; } catch { this.items = []; }
    this._baseline = this.items.slice();
    this._badge();
  },
  // Delta-merged so a second window's saved articles survive (collection-store.js).
  save() {
    this.items = window.CollectionStore.save(this.KEY, this._baseline, this.items);
    this._baseline = this.items.slice();
    this._badge();
  },
  unread() { return this.items.filter(i => !i.read).length; },

  OLD_DAYS: 30,
  WORDS_PER_MINUTE: 220,

  add(url, title) {
    if (!url) return;
    if (this.items.some(i => i.url === url && !i.read)) { window.showToast?.('Already in Read Later'); return; }
    const item = { id: vexId('rl'), url, title: title || url, at: Date.now(), read: false };
    this.items.unshift(item);
    this.save();
    window.showToast?.('Saved for later (' + this.unread() + ' unread)');
    this.measure(item.id);                       // how long it is, in the background
  },

  // Read the page quietly and keep how long it takes to read, so the list can
  // say "6 min" — a queue you cannot judge is a queue you do not start.
  async measure(id) {
    const item = this.items.find(i => i.id === id);
    if (!item || item.minutes != null || typeof AgentTools === 'undefined') return null;
    try {
      const page = await AgentTools.readUrl(item.url);
      const words = String(page.text || '').split(/\s+/).filter(Boolean).length;
      if (!words) return null;
      const live = this.items.find(i => i.id === id);
      if (!live) return null;                    // removed while it was read
      live.minutes = Math.max(1, Math.round(words / this.WORDS_PER_MINUTE));
      if (!live.title || live.title === live.url) live.title = page.title || live.title;
      this.save();
      return live.minutes;
    } catch (err) {
      window.VexProblems?.note('Read later', 'Could not measure ' + item.url, err);
      return null;
    }
  },

  // Saved long enough ago to be worth a decision.
  old(now = Date.now()) { return this.items.filter(i => !i.read && now - i.at > this.OLD_DAYS * 24 * 3600 * 1000); },

  describeAge(at, now = Date.now()) {
    const days = Math.floor((now - at) / (24 * 3600 * 1000));
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    const months = Math.round(days / 30);
    return months === 1 ? 'a month ago' : months + ' months ago';
  },

  open(item) {
    item.read = true; this.save();
    SidebarManager.hideActivePanel?.();
    TabManager.createTab(item.url, true);
  },

  // One at a time: the oldest unread link replaces the page in the tab you are
  // on (a new tab if that tab has nothing to lose), so a pile of saved links
  // is read through rather than opened as a pile of tabs. → the item, or null.
  next() {
    const item = [...this.items].reverse().find(i => !i.read);
    if (!item) { window.showToast?.('Nothing left in Read Later'); return null; }
    item.read = true;
    this.save();
    const tab = TabManager.getActiveTab();
    if (tab && /^https?:/i.test(tab.url || '')) WebviewManager.navigate(item.url);
    else TabManager.createTab(item.url, true);
    const left = this.unread();
    window.showToast?.(left ? left + ' more to read — Ctrl+K › Next from Read Later' : 'That was the last one');
    return item;
  },

  _badge() {
    const btn = document.querySelector('.sidebar-icon[data-panel="library"]');
    if (!btn) return;
    let dot = btn.querySelector('.rl-dot');
    const n = this.unread();
    if (!n) { dot?.remove(); return; }
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'rl-dot';
      dot.style.cssText = 'position:absolute;top:4px;right:4px;min-width:14px;height:14px;border-radius:7px;background:var(--primary);color:#fff;font-size:9px;font-weight:700;display:grid;place-items:center;padding:0 3px';
      btn.style.position = 'relative';
      btn.appendChild(dot);
    }
    dot.textContent = n > 9 ? '9+' : String(n);
  },

  renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    container.innerHTML = `<div class="panel-header"><h2>Library</h2></div><div id="lib-body" style="padding:0 10px 20px;overflow-y:auto;max-height:calc(100vh - 110px)"></div>`;
    const body = container.querySelector('#lib-body');
    const section = (label) => { const h = document.createElement('div'); h.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:700;padding:12px 8px 4px'; h.textContent = label; body.appendChild(h); };
    const row = (it, opts) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;cursor:pointer' + (opts.dim ? ';opacity:0.55' : '');
      r.addEventListener('mouseenter', () => r.style.background = 'var(--surface)');
      r.addEventListener('mouseleave', () => r.style.background = '');
      let host = it.url; try { host = new URL(it.url).hostname.replace(/^www\./, ''); } catch {}
      r.innerHTML = `<img src="https://${encodeURIComponent(host)}/favicon.ico" style="width:16px;height:16px;border-radius:4px" data-image-fallback="hide">
        <div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</div><div style="font-size:10.5px;color:var(--text-muted)">${esc(host)} · saved ${esc(this.describeAge(it.at))}${it.minutes ? ' · ' + it.minutes + ' min read' : ''}</div></div>
        <button data-x style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;border-radius:5px;font-size:13px">✕</button>`;
      r.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) return; opts.open(it); });
      r.querySelector('[data-x]').addEventListener('click', (e) => { e.stopPropagation(); opts.remove(it); });
      body.appendChild(r);
    };

    const unread = this.items.filter(i => !i.read);
    const read = this.items.filter(i => i.read).slice(0, 20);
    section('Read later' + (unread.length ? ' (' + unread.length + ')' : ''));
    if (unread.length > 1) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn-secondary';
      nextBtn.style.cssText = 'margin:2px 8px 6px';
      nextBtn.textContent = 'Read them one at a time';
      nextBtn.title = 'Opens the oldest; Ctrl+K › Next from Read Later for the one after';
      nextBtn.addEventListener('click', () => { SidebarManager.hideActivePanel?.(); this.next(); });
      body.appendChild(nextBtn);
    }
    // A pile of things saved a month ago and never read is worth one decision,
    // not thirty.
    const stale = this.old();
    if (stale.length) {
      const nudge = document.createElement('div');
      nudge.style.cssText = 'margin:2px 8px 8px;padding:8px 10px;border-radius:8px;background:var(--surface);border:1px solid var(--border);font-size:11.5px;color:var(--text-muted)';
      nudge.innerHTML = `<div>${stale.length} saved over a month ago${stale.some(i => i.minutes) ? ' · ' + stale.reduce((n, i) => n + (i.minutes || 0), 0) + ' min of reading' : ''}.</div>`;
      const clear = document.createElement('button');
      clear.className = 'btn-secondary';
      clear.style.cssText = 'margin-top:6px';
      clear.textContent = 'Clear the old ones';
      clear.addEventListener('click', async () => {
        if (!(await vexConfirm({ title: 'Clear ' + stale.length + ' old link' + (stale.length === 1 ? '' : 's') + '?', message: 'Saved over a month ago and still unread. The pages themselves are untouched.', okLabel: 'Clear them', danger: true }))) return;
        const ids = new Set(stale.map(i => i.id));
        this.items = this.items.filter(i => !ids.has(i.id));
        this.save();
        this.renderPanel(container);
      });
      nudge.appendChild(clear);
      body.appendChild(nudge);
    }
    if (!unread.length) body.insertAdjacentHTML('beforeend', window.VexUI ? VexUI.emptyState('inbox', 'Nothing saved yet', 'Ctrl+K → "Read Later" on any page') : '<div style="font-size:12px;color:var(--text-muted);padding:4px 8px">Empty — Ctrl+K → "Read Later" on any page.</div>');
    unread.forEach(it => row(it, { open: (x) => { this.open(x); }, remove: (x) => { this.items = this.items.filter(i => i.id !== x.id); this.save(); this.renderPanel(container); } }));
    if (read.length) {
      section('Done');
      read.forEach(it => row(it, { dim: true, open: (x) => this.open(x), remove: (x) => { this.items = this.items.filter(i => i.id !== x.id); this.save(); this.renderPanel(container); } }));
    }

    const arch = TabArchiver.list();
    if (arch.length) {
      section('Auto-archived tabs');
      arch.slice(0, 40).forEach(it => row(it, {
        open: (x) => {
          // Silently doing nothing looked like a broken row; say why.
          if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(x)) { window.showToast?.('That tab was archived from a private session and cannot be restored here', 'error'); return; }
          SidebarManager.hideActivePanel?.(); TabManager.createTab(x.url, true, null, x); TabArchiver.remove(x);
        },
        remove: (x) => { TabArchiver.remove(x); this.renderPanel(container); }
      }));
    }
  },
};

const TabArchiver = {
  KEY: 'vex.archivedTabs',
  DAYS_KEY: 'vex.autoArchiveDays',
  days() { try { return parseInt(localStorage.getItem(this.DAYS_KEY), 10) || 0; } catch { return 0; } },
  setDays(n) { try { localStorage.setItem(this.DAYS_KEY, String(n)); } catch {} },
  list() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  // Delta-merged like the other collections. Without a baseline the merge is
  // add-only, which is the safe default for a caller that did not capture one.
  _save(next, baseline) { return window.CollectionStore.save(this.KEY, baseline || next, next, 200); },
  remove(it) {
    const current = this.list();
    this._save(current.filter(x => x.id !== it.id), current);
  },

  init() {
    // Stamp activity so we know what "untouched" means.
    if (window.VexTabPolicy?.isPrivateWindow) return;
    if (this._initialized) return;
    this._initialized = true;
    TabManager.tabs.forEach(t => { t._lastActive = t._lastActive || Date.now(); });
    this._interval = VexJobs.every('Read later sweep', 30 * 60 * 1000, () => this.sweep(), { when: 'background' });
    this._startup = setTimeout(() => this.sweep(), 60 * 1000);
  },

  dispose() { this._interval?.stop(); clearTimeout(this._startup); this._initialized = false; },

  sweep() {
    if (window.VexTabPolicy?.isPrivateWindow) return;
    const days = this.days();
    if (!days) return;
    const cutoff = Date.now() - days * 86400000;
    const stale = TabManager.tabs.filter(t =>
      (window.VexTabPolicy ? window.VexTabPolicy.canPersist(t) : (!t.partition || String(t.partition).startsWith('persist:'))) &&
      !t.pinned && t.url && !t.url.startsWith('file:') && !t.url.startsWith('vex:') &&
      t.id !== TabManager.activeTabId && (t._lastActive || Date.now()) < cutoff);
    if (!stale.length) return;
    const arch = this.list();
    const baseline = arch.slice();   // captured before the unshifts below mutate it
    stale.forEach(t => {
      const record = window.VexTabPolicy?.serialize(t) || { url: t.url, title: t.title || t.url, partition: t.partition || null };
      arch.unshift({ ...record, id: 'ar' + Date.now() + Math.random().toString(36).slice(2, 6), at: Date.now() });
      try { TabManager.closeTab(t.id); } catch {}
    });
    this._save(arch, baseline);
    window.showToast?.('Archived ' + stale.length + ' inactive tab' + (stale.length === 1 ? '' : 's') + ' (Library panel)');
  },

  renderSettings(container) {
    if (!container) return;
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Close tabs untouched for this many days into the Library's archive (0 = off). Pinned tabs are never archived.</p>
      <select id="arch-days" style="min-width:160px">
        ${[0, 3, 7, 14, 30].map(d => `<option value="${d}" ${this.days() === d ? 'selected' : ''}>${d === 0 ? 'Off' : 'After ' + d + ' days'}</option>`).join('')}
      </select>`;
    container.querySelector('#arch-days').addEventListener('change', (e) => { this.setDays(parseInt(e.target.value, 10) || 0); window.showToast?.('Auto-archive updated'); });
  },
};

const ClipToNotes = {
  async clip() {
    const wv = WebviewManager.getActiveWebview();
    const t = TabManager.getActiveTab();
    if (!wv || !t || !t.url) { window.showToast?.('Open a page first'); return; }
    let sel = '';
    try { sel = await wv.executeJavaScript('String(getSelection&&getSelection()||"").substring(0,6000)'); } catch {}
    const stamp = new Date().toLocaleString();
    const body = (sel ? '> ' + sel.trim().replace(/\n/g, '\n> ') : '') +
      `\n\n— [${(t.title || t.url).replace(/[\[\]]/g, '')}](${t.url}) · ${stamp}\n\n---\n\n`;
    try {
      const KEY = 'vex.notes';
      let notes = []; try { notes = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch {}
      let note = notes.find(n => n.title === 'Clippings');
      if (!note) {
        note = { id: vexId('note_'), title: 'Clippings', content: '', pinned: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        notes.unshift(note);
      }
      note.content = body + (note.content || '');
      note.updatedAt = new Date().toISOString();
      localStorage.setItem(KEY, JSON.stringify(notes));
      // Keep an already-initialized NotesPanel in sync.
      if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) {
        NotesPanel.notes = notes;
        try { NotesPanel.renderList?.(); } catch {}
      }
      window.showToast?.(sel ? 'Selection clipped to Notes' : 'Link clipped to Notes');
    } catch (e) { console.error('[ClipToNotes] clip failed:', e.message); window.showToast?.('Clip failed: ' + e.message, 'error'); }
  },
};

if (typeof window !== 'undefined') { window.ReadLater = ReadLater; window.TabArchiver = TabArchiver; window.ClipToNotes = ClipToNotes; }
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadLater, TabArchiver, ClipToNotes };
