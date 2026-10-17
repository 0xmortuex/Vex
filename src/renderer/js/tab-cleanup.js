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
// Each tab on the card carries ONE line on why you might keep it (you highlighted text on it, it is
// bookmarked, saved for later, or nothing says you need it), a tick to archive it, and a "Keep" button
// that asks for a few words and leaves the tab alone for KEEP_DAYS. "Archive This Tab and Close It" in
// Ctrl+K does the same archive-instead-of-close for the tab in front.
//
// `propose` is pure (tabs in, list out) so it is tested without a window;
// `snapshot()` is the data hook for other surfaces.
const TabCleanup = {
  MODE_KEY: 'vex.tabCleanup.mode',            // 'ask' (default) | 'off'
  HOUR_KEY: 'vex.tabCleanup.hour',            // 0-23, default 18
  DAYS_KEY: 'vex.tabCleanup.days',            // idle this long, default 3
  LAST_KEY: 'vex.tabCleanup.lastDay',
  KEEP_KEY: 'vex.tabCleanup.keep',            // { "<url without #>": { why, at } }: tabs you said to keep, and why
  KEEP_DAYS: 30,
  MAX_KEEP: 100,
  DEFAULT_HOUR: 18,
  DEFAULT_DAYS: 3,
  MAX: 25,
  EVERY_MS: 10 * 60 * 1000,

  // tabs: TabManager.tabs. ctx: { now, days, activeId, isAwake(tab), canPersist(tab), kept(url) }.
  // → [{ id, url, title, host, why: 'idle'|'duplicate', idleDays }], longest idle first.
  propose(tabs, { now = Date.now(), days = this.DEFAULT_DAYS, activeId = null, isAwake = () => false, canPersist = () => true, kept = () => false, max = this.MAX } = {}) {
    const cutoff = now - days * 86400000;
    const seen = new Map();          // url -> the tab we keep
    const out = [];
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const eligible = (t) => t && t.url && !t.pinned && t.id !== activeId && !t.groupId && !t.audible
      && !/^(file|vex|about|chrome|devtools):/i.test(t.url) && canPersist(t) && !isAwake(t) && !kept(t.url);
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
      kept: (u) => !!this.keeps(now)[this.keyOf(u)],
    };
  },

  // --- tabs you said to keep ------------------------------------------------------
  keyOf(url) { return String(url).replace(/#.*$/, ''); },
  // The live ones ({ key: { why, at } }); an old entry is dropped when read.
  keeps(now = Date.now()) {
    const raw = localStorage.getItem(this.KEEP_KEY);
    if (raw === null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The tabs you chose to keep are not readable', { cause: err }); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const [k, v] of Object.entries(o)) if (v && typeof v.why === 'string' && now - Number(v.at) < this.KEEP_DAYS * 86400000) out[k] = { why: v.why, at: Number(v.at) };
    return out;
  },
  keep(url, why, now = Date.now()) {
    const text = String(why == null ? '' : why).replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Say in a few words why you keep it');
    if (text.length > 120) throw new Error('Keep it to 120 characters');
    const all = this.keeps(now);
    all[this.keyOf(url)] = { why: text, at: now };
    const keys = Object.keys(all);
    if (keys.length > this.MAX_KEEP) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - this.MAX_KEEP)) delete all[k];
    localStorage.setItem(this.KEEP_KEY, JSON.stringify(all));
    return all[this.keyOf(url)];
  },
  unkeep(url) {
    const all = this.keeps();
    if (!all[this.keyOf(url)]) return false;
    delete all[this.keyOf(url)];
    localStorage.setItem(this.KEEP_KEY, JSON.stringify(all));
    return true;
  },

  // --- one line on why you might keep a tab ------------------------------------------
  // Pure. facts: { annotated, bookmarked, readLater }. -> { line, strong }. `strong` means you put
  // work into the page, so the card does not tick it for you.
  keepLine(item, facts = {}) {
    if (facts.annotated) return { strong: true, line: 'Why keep it: you highlighted text on this page. Archiving keeps the page and your highlights in the Library.' };
    if (facts.readLater) return { strong: false, line: 'Why keep it: it is on your read-later list, so closing the tab loses nothing.' };
    if (facts.bookmarked) return { strong: false, line: 'Why keep it: it is bookmarked, so closing the tab loses nothing.' };
    if (item.why === 'duplicate') return { strong: false, line: 'Why keep it: no reason; it is a second copy of a tab you have open.' };
    return { strong: false, line: 'Why keep it: nothing says you need it open. Archiving saves a copy in the Library.' };
  },
  factsFor(url) {
    const key = this.keyOf(url);
    const marks = typeof Annotations !== 'undefined' && Annotations.store ? Annotations.store[url] || Annotations.store[key] : null;
    return {
      annotated: Array.isArray(marks) && marks.length > 0,
      bookmarked: typeof Bookmarks !== 'undefined' && typeof Bookmarks.has === 'function' && (Bookmarks.has(url) || Bookmarks.has(key)),
      readLater: typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items) && ReadLater.items.some(r => r && (r.url === url || r.url === key)),
    };
  },
  // The proposed items, each with its `keep` line.
  describe(items) { return items.map(i => ({ ...i, keep: this.keepLine(i, this.factsFor(i.url)) })); },

  // Archive the tab in front instead of closing it (Ctrl+K). Undo brings it back.
  archiveActive() {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    const t = TabManager.getActiveTab();
    if (!t || !t.url) throw new Error('There is no tab to archive');
    if (/^(file|vex|about|chrome|devtools):/i.test(t.url)) throw new Error('Vex\'s own pages are not archived');
    if (window.VexTabPolicy && !window.VexTabPolicy.canPersist(t)) throw new Error('A private or Tor tab is not archived: it would be remembered after it closes');
    return this.acceptWithUndo([{ id: t.id, url: t.url, title: t.title || t.url }]);
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
      message: 'Archived ' + made.length + ' tab' + VexPlural.s(made.length) + ' (Library panel)',
      undo: () => this.undo(made),
      ms: 20000,
    });
    return made.length;
  },

  // --- the evening card ----------------------------------------------------------
  // One row per tab: a tick (archived when ticked), the tab, how long idle, ONE line saying why you
  // might keep it, and "Keep" to say so in a few words (it is then left alone for KEEP_DAYS). A tab
  // you highlighted text on starts unticked: it is worth more than an idle page.
  showCard(items) {
    document.querySelector('.vex-tabcleanup')?.remove();
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const described = this.describe(items);
    const idle = items.filter(i => i.why === 'idle').length, dup = items.length - idle;
    const lines = [];
    if (idle) lines.push(idle + ' not looked at for ' + this.days() + ' days or more');
    if (dup) lines.push(dup + ' ' + (dup === 1 ? 'is a second copy' : 'are second copies') + ' of a tab you have open');
    const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
    const card = document.createElement('div');
    card.className = 'vex-tabcleanup';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Tidy your tabs');
    card.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9000;width:min(420px,92vw);background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 40px var(--vex-shadow-color,rgba(0,0,0,0.4));padding:12px 14px';
    const head = el('div', 'display:flex;align-items:center;gap:8px');
    const ic = el('span', 'display:inline-flex;color:var(--primary)'); ic.innerHTML = window.VexIcons.svg('broom', { size: 16 });
    const title = el('div', 'flex:1;font-size:13px;font-weight:650');
    const dismiss = el('button', 'display:inline-flex;background:none;border:none;color:var(--text-muted);cursor:pointer'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', 'Not now'); dismiss.innerHTML = window.VexIcons.svg('x', { size: 14 });
    head.append(ic, title, dismiss);
    const sub = el('div', 'margin-top:6px;font-size:11.5px;color:var(--text-muted)', lines.join(' · ') + '. Ticked tabs go to the Library archive, and Undo brings them back.');
    const list = el('div', 'margin-top:8px;max-height:220px;overflow-y:auto');
    const boxes = new Map();
    const accept = el('button', 'font-size:11.5px;padding:4px 11px;border-radius:6px;cursor:pointer'); accept.type = 'button'; accept.className = 'btn-primary';
    const later = el('button', btn, 'Not tonight'); later.type = 'button';
    const refresh = () => {
      const n = [...boxes.values()].filter(b => b.checked).length;
      title.textContent = 'Tidy ' + n + ' of ' + described.length + ' tab' + VexPlural.s(described.length) + '?';
      accept.textContent = n ? 'Archive ' + n + (n === 1 ? ' tab' : ' tabs') : 'Nothing ticked';
      accept.disabled = !n;
    };
    for (const i of described) {
      const row = el('div', 'padding:4px 0;border-top:1px solid var(--border)');
      const top = el('div', 'display:flex;gap:6px;align-items:center;font-size:11.5px');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !i.keep.strong;
      cb.setAttribute('aria-label', 'Archive: ' + i.title);
      cb.addEventListener('change', refresh);
      boxes.set(i.id, cb);
      const name = el('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', i.title);
      const age = el('span', 'color:var(--text-muted);white-space:nowrap', i.why === 'duplicate' ? 'copy' : i.idleDays + ' d');
      const keepBtn = el('button', btn.replace('padding:3px 9px', 'padding:1px 7px'), 'Keep'); keepBtn.type = 'button';
      keepBtn.setAttribute('aria-label', 'Keep this tab and say why: ' + i.title);
      keepBtn.addEventListener('click', async () => {
        try {
          const why = await vexPrompt({ title: 'Why keep this tab?', label: 'A few words, so you remember (it is left alone for ' + this.KEEP_DAYS + ' days)', value: '', okLabel: 'Keep it' });
          if (why == null) return;
          this.keep(i.url, why);
          row.remove(); boxes.delete(i.id); refresh();
          if (!boxes.size) close();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      top.append(cb, name, age, keepBtn);
      row.appendChild(top);
      row.appendChild(el('div', 'margin:1px 0 0 22px;font-size:11px;color:var(--text-muted)', i.keep.line));
      list.appendChild(row);
    }
    const actions = el('div', 'display:flex;gap:6px;margin-top:10px');
    actions.append(accept, later);
    card.append(head, sub, list, actions);
    refresh();
    const close = () => { card.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && card.isConnected && !document.querySelector('.vex-dialog-overlay')) close(); };
    dismiss.addEventListener('click', close);
    later.addEventListener('click', close);
    accept.addEventListener('click', () => {
      try { this.acceptWithUndo(items.filter(i => boxes.get(i.id) && boxes.get(i.id).checked)); close(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(card);
    if (typeof VexLayer !== 'undefined') VexLayer.track(card, { tier: 'panel', id: 'tab-cleanup', keep: true });
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
      VexAttention.suggest({ feature: 'tab-cleanup', label: 'Tab cleanup', id: day, title: 'Tidy ' + items.length + ' tab' + VexPlural.s(items.length) + '?', body: 'Tabs you have not used for days, or second copies. They go to the Library archive and Undo brings them back.', action: { label: 'Review', key: 'review' } });
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
