// === Weekday first-open tab set ===============================================
//
// Most people open the same few pages first thing on the same weekday: the
// timetable on Monday, the course portal on Tuesday. Vex notes which pages you
// open in the first 5 minutes after it starts, by weekday, and when three of
// the last four of that weekday started with the same pages it offers "Open
// your Monday set".
//
//   - Only pages you opened yourself after Vex was up count: tabs that came back
//     from your last session are ignored, and so are private, Tor and container
//     tabs, the New Tab page and anything that is not http(s).
//   - Only the address up to the "?" is kept, never a query or a #fragment.
//   - One record per calendar day (the day's first start), kept for 8 weeks, on
//     this computer only. Settings can clear it.
//   - The offer is a notice; the tabs open only when you press its button, in the
//     background, with an Undo in "Why did that happen?". Pages already open are
//     not opened twice.
//
//   VexWeekdaySet.normalize(url)                 pure: address without query or fragment, or ''
//   VexWeekdaySet.common(days, wd, todayKey)     pure: the addresses that were in 3 of the last 4 starts that weekday

const VexWeekdaySet = {
  KEY: 'vex.weekdaySet',
  PREF: 'vex.weekdaySet.enabled',   // 'off': nothing is noted and nothing offered
  WINDOW_MS: 5 * 60 * 1000,
  MAX_URLS: 12,
  KEEP_DAYS: 56,
  NEED: 3,
  LAST: 4,
  OFFER_DELAY_MS: 10000,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- pure --------------------------------------------------------------------------
  normalize(url) {
    let u;
    try { u = new URL(String(url == null ? '' : url)); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
    let path = u.pathname.replace(/\/+$/, '');
    return u.protocol + '//' + u.host.toLowerCase() + path;
  },
  dayKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  // days: { 'YYYY-MM-DD': { wd, urls } }. -> the addresses present in at least NEED of the last LAST earlier starts that weekday.
  common(days, wd, todayKey) {
    const recs = Object.keys(days || {}).filter(k => k < todayKey && days[k] && days[k].wd === wd && Array.isArray(days[k].urls)).sort().reverse().slice(0, this.LAST);
    if (recs.length < this.NEED) return [];
    const count = new Map();
    for (const k of recs) for (const u of new Set(days[k].urls)) count.set(u, (count.get(u) || 0) + 1);
    const out = [];
    for (const u of days[recs[0]].urls) if (count.get(u) >= this.NEED && !out.includes(u)) out.push(u);
    return out;
  },
  weekdayName(wd) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]; },

  // ---- storage -----------------------------------------------------------------------
  load() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return { v: 1, days: {}, offered: '' };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your weekday sets could not be read: ' + err.message); }
    if (!v || v.v !== 1 || typeof v.days !== 'object') throw new Error('Your weekday sets are in a shape this version does not know');
    return { v: 1, days: v.days, offered: typeof v.offered === 'string' ? v.offered : '' };
  },
  _save(st) {
    const cutoff = this.dayKey(Date.now() - this.KEEP_DAYS * 86400000);
    const days = {};
    for (const k of Object.keys(st.days)) if (k >= cutoff) days[k] = st.days[k];
    try { localStorage.setItem(this.KEY, JSON.stringify({ v: 1, days, offered: st.offered })); }
    catch (err) { throw new Error('Your weekday sets could not be saved: ' + err.message); }
  },
  clear() {
    localStorage.removeItem(this.KEY);
    this._session = [];
  },
  recordsFor(wd) { const d = this.load().days; return Object.keys(d).filter(k => d[k].wd === wd); },

  // ---- noting ------------------------------------------------------------------------
  _session: [],
  _start: 0,
  _preexisting: new Set(),
  _recording: false,

  note(url, tab, now = Date.now()) {
    if (!this._recording || !this.enabled() || now - this._start > this.WINDOW_MS) return false;
    if (tab && this._preexisting.has(tab.id)) return false;
    const policy = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    if (tab && policy && typeof policy.canRestore === 'function' && !policy.canRestore(tab)) return false;
    if (tab && tab.partition && tab.partition !== 'persist:main') return false;
    const n = this.normalize(url);
    if (!n || this._session.includes(n) || this._session.length >= this.MAX_URLS) return false;
    this._session.push(n);
    const st = this.load();
    const k = this.dayKey(this._start);
    st.days[k] = { wd: new Date(this._start).getDay(), urls: this._session.slice() };
    this._save(st);
    return true;
  },

  // ---- offering ------------------------------------------------------------------------
  // -> { wd, urls } of the set to offer today, or null with the reason in `why`.
  candidate(now = Date.now(), { openUrls = [] } = {}) {
    const st = this.load();
    const today = this.dayKey(now);
    const wd = new Date(now).getDay();
    const common = this.common(st.days, wd, today);
    if (!common.length) {
      const have = Object.keys(st.days).filter(k => k < today && st.days[k].wd === wd).length;
      return { wd, urls: [], why: have < this.NEED ? 'Vex has seen ' + have + ' ' + this.weekdayName(wd) + ' start' + (have === 1 ? '' : 's') + ' so far; it needs ' + this.NEED + ' to find a set.' : 'No pages were in ' + this.NEED + ' of your last ' + this.LAST + ' ' + this.weekdayName(wd) + ' starts.' };
    }
    const open = new Set(openUrls.map(u => this.normalize(u)));
    const urls = common.filter(u => !open.has(u));
    return { wd, urls, why: urls.length ? '' : 'Every page of your ' + this.weekdayName(wd) + ' set is already open.' };
  },

  _openUrls() { return typeof TabManager !== 'undefined' ? TabManager.tabs.map(t => t.url) : []; },

  openSet(urls) {
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not loaded');
    if (!urls.length) throw new Error('There is nothing to open');
    const ids = [];
    for (const u of urls) {
      if (!this.normalize(u)) throw new Error('Not a web address: ' + u);
      const id = TabManager.createTab(u, false, null, { allowDuplicate: false });
      if (id) ids.push(id);
    }
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: 'weekday-set', what: 'Opened your ' + this.weekdayName(new Date().getDay()) + ' set (' + ids.length + ' tabs)', why: 'You pressed Open on the notice', undo: { kind: 'weekday-set-close', tabIds: ids } });
    }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('weekday-set');
    return ids;
  },

  offer(now = Date.now(), { force = false } = {}) {
    if (!this.enabled()) return null;
    const st = this.load();
    const today = this.dayKey(now);
    if (!force && st.offered === today) return null;
    const c = this.candidate(now, { openUrls: this._openUrls() });
    if (!c.urls.length) {
      if (force) window.showToast?.(c.why, 'info', 6000);
      return null;
    }
    const day = this.weekdayName(c.wd);
    const title = 'Open your ' + day + ' set?';
    const body = c.urls.length + ' page' + (c.urls.length === 1 ? '' : 's') + ' you usually open first: ' + c.urls.slice(0, 3).map(u => new URL(u).host).join(', ') + (c.urls.length > 3 ? '…' : '');
    const run = () => { try { this.openSet(c.urls); } catch (err) { window.showToast?.(err.message, 'error'); } };
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    st.offered = today;
    this._save(st);
    VexAttention.notify({ feature: 'weekday-set', label: 'Weekday set', urgency: 'useful', id: today, title, body, action: { label: 'Open the set', key: 'open' } },
      () => window.showToast?.(title + ' ' + body, 'info', 15000, { action: { label: 'Open ' + c.urls.length + ' tab' + (c.urls.length === 1 ? '' : 's'), run } }));
    this._lastOffer = c;
    return c;
  },

  // ---- the screen -------------------------------------------------------------------------
  group(el) {
    el.appendChild(VexSettingsGroups.note('Vex notes which pages you open in the first 5 minutes of a start, by weekday (the address without any ? or #). When three of your last four Mondays began the same way, it offers to open that set.'));
    el.appendChild(VexSettingsGroups.button('Open my set for today', () => { try { this.offer(Date.now(), { force: true }); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
    el.appendChild(VexSettingsGroups.button('Forget what it has noted', async () => {
      const ok = await window.vexConfirm({ title: 'Forget weekday sets', message: 'This removes every start Vex has noted. It will begin again from the next start.', okLabel: 'Forget', danger: true });
      if (ok) { try { this.clear(); window.showToast?.('Forgotten', 'info'); } catch (err) { window.showToast?.(err.message, 'error'); } }
    }, { danger: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    this._start = Date.now();
    this._session = [];
    this._preexisting = new Set(typeof TabManager !== 'undefined' ? TabManager.tabs.map(t => t.id) : []);
    // One record per day: the day's first start is the one noted.
    this._recording = this.enabled() && !this.load().days[this.dayKey(this._start)];
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('weekday-set-close', async (token) => {
        for (const id of token.tabIds || []) if (typeof TabManager !== 'undefined' && TabManager.tabs.some(t => t.id === id)) TabManager.closeTab(id);
      });
    }
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('weekday-set', (key) => {
        if (key !== 'open') throw new Error('Unknown action ' + key);
        const c = this.candidate(Date.now(), { openUrls: this._openUrls() });
        this.openSet(c.urls);
      });
    }
    document.addEventListener('vex:tab-navigated', (e) => {
      const d = e.detail || {};
      if (d.failed || !this._recording) return;
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === d.tabId) : null;
      try { this.note(d.url, tab); }
      catch (err) { window.VexProblems?.note('Weekday set', 'Could not note a start page', err); }
    });
    setTimeout(() => {
      try { this.offer(); } catch (err) { window.VexProblems?.note('Weekday set', 'Could not offer the set', err); }
    }, this.OFFER_DELAY_MS);
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexWeekdaySet = VexWeekdaySet;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'weekday-set', title: 'Weekday first-open tabs', keywords: 'weekday monday first open tabs set start routine offer', before: 'about', build: (el) => VexWeekdaySet.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'weekday-set', label: 'Open my set for today', hint: 'The pages you usually open first on this weekday', icon: 'tabs', action: () => VexWeekdaySet.offer(Date.now(), { force: true }) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWeekdaySet };
