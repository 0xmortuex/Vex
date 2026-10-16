// === Error-message memory ======================================================
//
// You search an error message, open an answer, and it fixes it. Three weeks later
// the same message appears and you search all over again. This remembers which
// page it was.
//
//   * A search whose words look like an error message is noted for that tab. If you
//     then stay on a result page in the same tab for a minute, "that error -> that
//     page" is saved (address and title; no page text, nothing copied).
//   * Selected text > "Solved: remember this error" saves the selection with the
//     last three pages you looked at in this tab, for when the fix was somewhere
//     the search did not show.
//   * The next time you search the same error (numbers, paths and ids ignored),
//     a small card in the results says "Last time: this answer" with the link.
//
// All of it stays on this computer in one list (200 errors at most). Private, Tor
// and routed tabs are never read. "Forget all" is in Settings.
const VexErrorMemory = {
  KEY: 'vex.errorMemory',
  ENABLED_KEY: 'vex.errorMemory.enabled',
  MAX: 200,
  DWELL_MS: 60 * 1000,
  _pending: new Map(),       // tab id -> { error, url, title, since }
  _recent: new Map(),        // tab id -> last three { url, title }
  _job: null,

  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  setEnabled(on) {
    VexBench.setFlag(this.ENABLED_KEY, on);
    if (!on) { this._pending.clear(); this._recent.clear(); this._stopJob(); }
    this.registerCommands();
  },

  // ---- pure helpers (tested) ------------------------------------------------------
  // The words of a search, from the usual engines; '' when the address is not a search.
  searchQuery(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    const host = u.hostname.replace(/^www\./, '');
    const engine = /(^|\.)(google|bing|duckduckgo|brave|startpage|ecosia|yahoo)\./.test(host + '.') || /^search\.brave\.com$/.test(host);
    if (!engine) return '';
    return (u.searchParams.get('q') || u.searchParams.get('p') || '').trim();
  },
  looksLikeError(q) {
    const s = String(q || '').trim();
    if (s.length < 14 || s.split(/\s+/).length < 3) return false;
    return /(error|exception|failed|failure|cannot|can't|could not|unable to|undefined|not found|traceback|panic|fatal|denied|refused|timed out|segfault|errno|ERR_[A-Z_]+|\bE[A-Z]{3,}\b|\bTS\d{4}\b|\bCS\d{4}\b|0x[0-9a-f]{4,})/i.test(s);
  },
  // The same error written with different numbers, paths or ids gives the same key.
  normalise(text) {
    return String(text || '').toLowerCase()
      .replace(/[a-z]:\\[^\s"']+/g, '<path>').replace(/(?:^|\s)(?:\/[\w.@-]+){2,}/g, ' <path>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
      .replace(/0x[0-9a-f]+/g, '<hex>').replace(/\b\d+(?:\.\d+)*\b/g, '<n>')
      .replace(/["'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  },

  // ---- the list ---------------------------------------------------------------------
  _strict() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('The remembered errors are not readable, so they were not changed');
    return list;
  },
  list() {
    try { return this._strict(); }
    catch (err) { console.error('[ErrorMemory] the list could not be read:', err.message); return []; }
  },
  remember(error, pages, now = Date.now()) {
    const key = this.normalise(error);
    if (!key) throw new Error('There is no error text to remember');
    const clean = (pages || []).filter(p => p && /^https?:\/\//i.test(p.url)).slice(0, 3).map(p => ({ url: String(p.url).slice(0, 600), title: String(p.title || '').slice(0, 160) }));
    if (!clean.length) throw new Error('There is no page to remember it with');
    let list = this._strict();
    const at = list.findIndex(e => e.key === key);
    const entry = { key, error: String(error).slice(0, 200), pages: clean, at: now, hits: at >= 0 ? (list[at].hits || 0) : 0 };
    if (at >= 0) list.splice(at, 1);
    list.unshift(entry);
    if (list.length > this.MAX) list = list.slice(0, this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(list));
    return entry;
  },
  find(error) {
    const key = this.normalise(error);
    return key ? this.list().find(e => e.key === key) || null : null;
  },
  clear() { localStorage.removeItem(this.KEY); },

  // ---- watching ----------------------------------------------------------------------
  async onSettled(tab, wv) {
    if (!VexBench.canRead(wv)) return;
    const url = String(tab.url || '');
    if (!/^https?:\/\//i.test(url)) return;
    const q = this.searchQuery(url);
    if (q) {
      if (!this.looksLikeError(q)) { this._pending.delete(tab.id); return; }
      this._pending.set(tab.id, { error: q, url: '', title: '', since: 0, search: url });
      const hit = this.find(q);
      if (hit) {
        hit.hits = (hit.hits || 0) + 1;
        await VexBench.inPage(wv, {
          id: 'vex-error-memory', mode: 'card', tone: 'info', title: 'Last time: this answer',
          lines: ['You settled this error before (' + new Date(hit.at).toLocaleDateString() + ').'],
          actions: hit.pages.map((p, i) => ({ label: (p.title || p.url).slice(0, 44) || 'Open ' + (i + 1), href: p.url })),
        });
      }
      return;
    }
    // A page after the search: remember the last three for "Solved", and start timing the stay.
    const recent = this._recent.get(tab.id) || [];
    if (!recent.length || recent[recent.length - 1].url !== url) recent.push({ url, title: tab.title || '' });
    this._recent.set(tab.id, recent.slice(-3));
    const p = this._pending.get(tab.id);
    if (p && p.error) {
      p.url = url; p.title = String(tab.title || ''); p.since = Date.now();
      this._startJob();
    }
  },

  _startJob() {
    if (this._job || typeof VexJobs === 'undefined') return;
    this._job = VexJobs.every('Error memory', 15000, () => this._check(), { feature: 'error-memory' });
  },
  _stopJob() { if (this._job) { this._job.stop(); this._job = null; } },
  _check(now = Date.now()) {
    let waiting = 0;
    for (const [tabId, p] of [...this._pending]) {
      if (!p.url) continue;
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
      if (!tab || String(tab.url) !== p.url) { p.url = ''; continue; }      // moved on or closed: not the answer
      if (now - p.since >= this.DWELL_MS) {
        try { this.remember(p.error, [{ url: p.url, title: p.title }], now); }
        catch (err) { VexProblems?.note('Error memory', 'could not remember an answer', err); }
        this._pending.delete(tabId);
      } else waiting++;
    }
    if (!waiting) this._stopJob();
  },

  // ---- Solved ------------------------------------------------------------------------
  textItems(selection, webview) {
    if (!VexBench.canRead(webview) || !this.looksLikeError(selection)) return [];
    return [{ label: 'Solved: remember this error', action: VexBench.safe(() => this.solved(selection, webview)) }];
  },
  solved(selection, webview) {
    const tabId = webview.dataset && webview.dataset.tabId;
    const pages = (this._recent.get(tabId) || []).slice().reverse();
    const here = VexBench.pageUrl(webview);
    if (here && !pages.some(p => p.url === here)) pages.unshift({ url: here, title: '' });
    const entry = this.remember(selection, pages);
    VexBench.toast('Remembered with ' + entry.pages.length + ' page' + (entry.pages.length === 1 ? '' : 's'));
    return entry;
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('errormem:', this.enabled() ? [{
      id: 'errormem:forget', label: 'Forget remembered error answers', icon: 'trash', hint: 'Clears the list kept on this computer',
      action: VexBench.safe(async () => { if (await vexConfirm({ title: 'Forget all remembered errors?', okLabel: 'Forget', danger: true })) this.clear(); }),
    }] : []);
    return true;
  },
  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note('Remembers which page fixed an error you searched, on this computer only. Select an error > right-click > "Solved: remember this error" to save one by hand. ' + this.list().length + ' remembered.'));
    box.appendChild(VexSettingsGroup.button('Forget all', async () => {
      if (await vexConfirm({ title: 'Forget all remembered errors?', okLabel: 'Forget', danger: true })) { this.clear(); VexSettingsGroups.inject(); }
    }, 'danger'));
  },
};

if (typeof window !== 'undefined') {
  window.VexErrorMemory = VexErrorMemory;
  VexBench.register({
    id: 'error-memory', title: 'Error-message memory', hint: 'which page fixed it', enabled: () => VexErrorMemory.enabled(), setEnabled: (on) => VexErrorMemory.setEnabled(on),
    settingsRows: (box) => VexErrorMemory.settingsRows(box), textItems: (s, wv) => VexErrorMemory.textItems(s, wv), onSettled: (t, wv) => VexErrorMemory.onSettled(t, wv),
  });
  VexErrorMemory.registerCommands();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexErrorMemory };
