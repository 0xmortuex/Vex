// === Evening tab cleanup ====================================================
//
// By evening there are tabs you opened on Monday and have not looked at since.
// The Library's auto-archive (TabArchiver, readlater.js) already does this
// silently after N days if you switch it on; most people never do, and a
// tab that vanishes without a word is a tab you go looking for.
//
// This asks instead. Once an evening it lists the tabs that have sat unused
// for days — and the ones that are a second copy of another open tab — and
// offers one button: archive them. They go into the same Library archive, so
// nothing is lost, and an Undo puts every one of them back.
//
// What it will never propose: the tab you are on, pinned tabs, one playing
// sound, one you kept awake, a tab in a group, private and Tor tabs, and
// Vex's own pages. Off until you leave it on "Ask me".
//
// `propose` is pure (tabs in, list out) so it is tested without a window;
// `snapshot()` is the data hook for other surfaces.
const TabCleanup = {
  MODE_KEY: 'vex.tabCleanup.mode',            // 'ask' (default) | 'off'
  HOUR_KEY: 'vex.tabCleanup.hour',            // 0-23, default 18
  DAYS_KEY: 'vex.tabCleanup.days',            // idle this long, default 3
  LAST_KEY: 'vex.tabCleanup.lastDay',
  DEFAULT_HOUR: 18,
  DEFAULT_DAYS: 3,
  MAX: 25,
  EVERY_MS: 10 * 60 * 1000,

  // tabs: TabManager.tabs. ctx: { now, days, activeId, isAwake(tab), canPersist(tab) }.
  // → [{ id, url, title, host, why: 'idle'|'duplicate', idleDays }], longest idle first.
  propose(tabs, { now = Date.now(), days = this.DEFAULT_DAYS, activeId = null, isAwake = () => false, canPersist = () => true, max = this.MAX } = {}) {
    const cutoff = now - days * 86400000;
    const seen = new Map();          // url -> the tab we keep
    const out = [];
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const eligible = (t) => t && t.url && !t.pinned && t.id !== activeId && !t.groupId && !t.audible
      && !/^(file|vex|about|chrome|devtools):/i.test(t.url) && canPersist(t) && !isAwake(t);
    // The most recently used copy is the one kept.
    const byRecent = [...tabs].sort((a, b) => (b._lastActive || 0) - (a._lastActive || 0));
    for (const t of byRecent) {
      if (!t || !t.url) continue;
      const key = String(t.url).replace(/#.*$/, '');
      if (!seen.has(key)) { seen.set(key, t); continue; }
      if (eligible(t)) out.push({ id: t.id, url: t.url, title: t.title || t.url, host: host(t.url), why: 'duplicate', idleDays: Math.floor((now - (t._lastActive || now)) / 86400000) });
    }
    const dupIds = new Set(out.map(o => o.id));
    for (const t of tabs) {
      if (dupIds.has(t.id) || !eligible(t)) continue;
      const last = t._lastActive;
      if (!Number.isFinite(last) || last >= cutoff) continue;       // unknown activity is never "stale"
      out.push({ id: t.id, url: t.url, title: t.title || t.url, host: host(t.url), why: 'idle', idleDays: Math.floor((now - last) / 86400000) });
    }
    out.sort((a, b) => b.idleDays - a.idleDays);
    return out.slice(0, max);
  },

  // --- settings ----------------------------------------------------------------
  mode() { try { return localStorage.getItem(this.MODE_KEY) === 'off' ? 'off' : 'ask'; } catch { return 'ask'; } },
  setMode(v) {
    if (v !== 'ask' && v !== 'off') throw new Error('Unknown tab cleanup mode: ' + v);
    localStorage.setItem(this.MODE_KEY, v);
  },
  hour() { try { const n = parseInt(localStorage.getItem(this.HOUR_KEY), 10); return n >= 0 && n <= 23 ? n : this.DEFAULT_HOUR; } catch { return this.DEFAULT_HOUR; } },
  setHour(n) {
    const v = Math.round(Number(n));
    if (!(v >= 0 && v <= 23)) throw new Error('The hour is 0 to 23');
    localStorage.setItem(this.HOUR_KEY, String(v));
  },
  days() { try { const n = parseInt(localStorage.getItem(this.DAYS_KEY), 10); return n >= 1 && n <= 60 ? n : this.DEFAULT_DAYS; } catch { return this.DEFAULT_DAYS; } },
  setDays(n) {
    const v = Math.round(Number(n));
    if (!(v >= 1 && v <= 60)) throw new Error('Choose 1 to 60 days');
    localStorage.setItem(this.DAYS_KEY, String(v));
  },

  _ctx(now) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    return {
      now, days: this.days(), activeId: TabManager.activeTabId,
      isAwake: (t) => (typeof TabManager._isKeptAwake === 'function' ? TabManager._isKeptAwake(t) : false),
      canPersist: (t) => (window.VexTabPolicy ? window.VexTabPolicy.canPersist(t) : true),
    };
  },

  // Data hook: what would be proposed right now. Draws and changes nothing.
  snapshot(now = Date.now()) {
    const items = this.propose(TabManager.tabs, this._ctx(now));
    return { count: items.length, days: this.days(), items };
  },

  // --- accepting, and undoing -----------------------------------------------------
  // Into the Library archive, then closed. → the archive records made, so the
  // Undo can take exactly those back out.
  accept(items) {
    if (typeof TabArchiver === 'undefined') throw new Error('The Library archive is not available');
    const wanted = new Set(items.map(i => i.id));
    const tabs = TabManager.tabs.filter(t => wanted.has(t.id));
    if (!tabs.length) throw new Error('Those tabs are already gone');
    const archive = TabArchiver.list();
    const baseline = archive.slice();
    const made = [];
    const at = Date.now();
    for (const t of tabs) {
      const record = window.VexTabPolicy.serialize(t);
      const rec = { ...record, id: 'ar' + at + Math.random().toString(36).slice(2, 6), at };
      archive.unshift(rec);
      made.push(rec);
    }
    TabArchiver._save(archive, baseline);
    for (const t of tabs) TabManager.closeTab(t.id);
    return made;
  },

  undo(made) {
    for (const rec of made) {
      TabManager.createTab(rec.url, false);
      TabArchiver.remove(rec);
    }
  },

  // One click: archive what was proposed, and say so with an Undo.
  acceptWithUndo(items) {
    const made = this.accept(items);
    window.VexUndo.offer({
      message: 'Archived ' + made.length + ' tab' + (made.length === 1 ? '' : 's') + ' (Library panel)',
      undo: () => this.undo(made),
      ms: 20000,
    });
    return made.length;
  },

  // --- the evening card ----------------------------------------------------------
  showCard(items) {
    document.querySelector('.vex-tabcleanup')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const idle = items.filter(i => i.why === 'idle').length, dup = items.length - idle;
    const lines = [];
    if (idle) lines.push(idle + ' not looked at for ' + this.days() + ' days or more');
    if (dup) lines.push(dup + ' ' + (dup === 1 ? 'is a second copy' : 'are second copies') + ' of a tab you have open');
    const card = document.createElement('div');
    card.className = 'vex-tabcleanup';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Tidy your tabs');
    card.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9000;width:min(380px,92vw);background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 40px var(--vex-shadow-color,rgba(0,0,0,0.4));padding:12px 14px';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="display:inline-flex;color:var(--primary)">${window.VexIcons.svg('broom', { size: 16 })}</span>
        <div style="flex:1;font-size:13px;font-weight:650">Tidy ${items.length} tab${items.length === 1 ? '' : 's'}?</div>
        <button data-dismiss type="button" aria-label="Not now" style="display:inline-flex;background:none;border:none;color:var(--text-muted);cursor:pointer">${window.VexIcons.svg('x', { size: 14 })}</button>
      </div>
      <div style="margin-top:6px;font-size:11.5px;color:var(--text-muted)">${lines.map(esc).join(' · ')}. They go to the Library archive, and Undo brings them back.</div>
      <div data-list style="margin-top:8px;max-height:140px;overflow-y:auto">
        ${items.map(i => `<div style="font-size:11.5px;display:flex;gap:6px;padding:2px 0"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.title)}</span><span style="color:var(--text-muted);white-space:nowrap">${esc(i.why === 'duplicate' ? 'copy' : i.idleDays + ' d')}</span></div>`).join('')}
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button data-accept type="button" class="btn-primary" style="font-size:11.5px;padding:4px 11px;border-radius:6px;cursor:pointer">Archive them</button>
        <button data-later type="button" style="${btn}">Not tonight</button>
      </div>`;
    const close = () => { card.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && card.isConnected && !document.querySelector('.vex-dialog-overlay')) close(); };
    card.querySelector('[data-dismiss]').addEventListener('click', close);
    card.querySelector('[data-later]').addEventListener('click', close);
    card.querySelector('[data-accept]').addEventListener('click', () => {
      try { this.acceptWithUndo(items); close(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(card);
    return card;
  },

  // The job: once a day, at or after the hour, when there is something to say.
  // Today is marked only when the card was shown, so a quiet evening asks again
  // later in the same evening if tabs have gone stale since.
  tick(now = Date.now()) {
    if (this.mode() === 'off') return null;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
    const d = new Date(now);
    if (d.getHours() < this.hour()) return null;
    const day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    let last = '';
    try { last = localStorage.getItem(this.LAST_KEY) || ''; } catch { /* a convenience */ }
    if (last === day) return null;
    const items = this.propose(TabManager.tabs, this._ctx(now));
    if (!items.length) return null;
    try { localStorage.setItem(this.LAST_KEY, day); } catch (err) { console.warn('[TabCleanup] could not remember today:', err.message); }
    // Tidying is a suggestion, not an interruption: it waits in the Attention
    // Inbox, and the card opens when the person asks for it.
    if (typeof VexAttention !== 'undefined') {
      VexAttention.suggest({ feature: 'tab-cleanup', label: 'Tab cleanup', id: day, title: 'Tidy ' + items.length + ' tab' + (items.length === 1 ? '' : 's') + '?', body: 'Tabs you have not used for days, or second copies. They go to the Library archive and Undo brings them back.', action: { label: 'Review', key: 'review' } });
      return items;
    }
    this.showCard(items);
    return items;
  },

  start() {
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('tab-cleanup', (key) => {
        if (key !== 'review') throw new Error('Unknown tab cleanup action ' + key);
        const now = this.propose(TabManager.tabs, this._ctx(Date.now()));
        if (!now.length) { window.showToast?.('Nothing to tidy right now'); return null; }
        return this.showCard(now);
      });
    }
    if (this._job) return;
    if (typeof VexJobs === 'undefined') throw new Error('TabCleanup needs VexJobs');
    this._job = VexJobs.every('Tab cleanup', this.EVERY_MS, () => this.tick(), { when: 'ui', deferOnBattery: true });
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } },
};

if (typeof window !== 'undefined') window.TabCleanup = TabCleanup;
if (typeof module !== 'undefined' && module.exports) module.exports = { TabCleanup };
