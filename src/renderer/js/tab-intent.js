// === Why is this tab open? (T2-022) ===============================================
//
// Twenty tabs in, "why did I open this one?" costs a click and a guess. A tab
// already remembered the page it came from (js/tab-trail.js, "How you got
// here"); this adds the two things that answer the question without opening
// anything, and shows them on the tab's hover card:
//
//   From      the title of the page that opened it
//   Searched  the words you searched for there, when that page was a search
//             (Google, Bing, DuckDuckGo, Brave, Ecosia, Startpage, Yahoo, YouTube,
//             Wikipedia, GitHub, Amazon...) or when this tab IS a search results page
//   Why       one line you wrote yourself (Ctrl+K › Say why this tab is open)
//   Last      when you last had the tab in front
//
// What is kept, and where:
//   from / search words   in memory for this run of Vex only, like the trail: they
//                         describe what you were doing just now, and writing every
//                         "opened from" to disk would be a browsing history by
//                         another name
//   your own why line     on this computer under the page's address (100 at most),
//                         because you wrote it to be read later; never for a
//                         private, Tor, proxy or container tab
//
// Nothing is sent anywhere. With the switch off the hover card is as it was.

const VexTabIntent = {
  PREF: 'vex.tabIntent.enabled',
  NOTES: 'vex.tabIntent.notes',     // { [url]: { text, at } }, newest 100
  MAX_NOTES: 100,
  MAX_KEPT: 400,
  _intent: new Map(),                // tab id -> { fromTitle, fromUrl, query, at }

  // Search pages and the parameter that holds the words.
  SEARCH: [
    { host: /(^|\.)google\./, param: 'q' }, { host: /(^|\.)bing\.com$/, param: 'q' }, { host: /(^|\.)duckduckgo\.com$/, param: 'q' },
    { host: /(^|\.)search\.brave\.com$/, param: 'q' }, { host: /(^|\.)ecosia\.org$/, param: 'q' }, { host: /(^|\.)startpage\.com$/, param: 'query' },
    { host: /(^|\.)search\.yahoo\.com$/, param: 'p' }, { host: /(^|\.)youtube\.com$/, param: 'search_query' }, { host: /(^|\.)wikipedia\.org$/, param: 'search' },
    { host: /(^|\.)github\.com$/, param: 'q' }, { host: /(^|\.)amazon\./, param: 'k' }, { host: /(^|\.)reddit\.com$/, param: 'q' },
    { host: /(^|\.)stackoverflow\.com$/, param: 'q' }, { host: /(^|\.)npmjs\.com$/, param: 'q' },
  ],

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) { return VexPlanKit.setFlag(this.PREF, on); },

  // ---- pure ---------------------------------------------------------------------------
  queryOf(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    const rule = this.SEARCH.find(r => r.host.test(u.hostname));
    if (!rule) return '';
    return String(u.searchParams.get(rule.param) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  },
  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  ago(ms, now = Date.now()) {
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 48) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  },

  // The lines for a tab: [{ label, text }].
  lines(tab, intent, why, now = Date.now()) {
    const out = [];
    if (intent && (intent.fromTitle || intent.fromUrl)) {
      const t = String(intent.fromTitle || '').trim();
      out.push({ label: 'From', text: (t && t !== 'Loading...' ? t : this.hostOf(intent.fromUrl) || intent.fromUrl) });
    }
    const q = (intent && intent.query) || this.queryOf(tab && tab.url);
    if (q) out.push({ label: 'Searched', text: '"' + q + '"' });
    if (why && why.text) out.push({ label: 'Why', text: why.text });
    const seen = tab && (tab.lastViewedAt || tab._lastActive);
    if (seen) out.push({ label: 'Last visit', text: this.ago(seen, now) });
    return out;
  },

  // ---- keeping it ------------------------------------------------------------------------
  _private(tab) {
    return !!(window.VexTabPolicy && typeof window.VexTabPolicy.canPersist === 'function' && !window.VexTabPolicy.canPersist(tab));
  },
  // Called as a tab is created (js/tabs.js), next to TabTrail.record.
  record(tab, opener) {
    if (!this.enabled() || !tab || !opener || tab.id === opener.id) return null;
    if (this._private(tab) || this._private(opener)) return null;
    if (!/^https?:/i.test(String(opener.url || ''))) return null;
    const rec = { fromTitle: String(opener.title || '').slice(0, 160), fromUrl: String(opener.url).slice(0, 2048), query: this.queryOf(opener.url), at: Date.now() };
    this._intent.set(tab.id, rec);
    while (this._intent.size > this.MAX_KEPT) this._intent.delete(this._intent.keys().next().value);
    return rec;
  },
  forget(tabId) { this._intent.delete(tabId); },
  intentOf(tabId) { return this._intent.get(tabId) || null; },

  whyNotes() {
    const o = VexPlanKit.readJson(this.NOTES, {});
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  whyOf(url) { return this.whyNotes()[String(url || '')] || null; },
  setWhy(tab, text) {
    if (!tab || !/^https?:/i.test(String(tab.url || ''))) throw new Error('Only a web page can have a reason written on it');
    if (this._private(tab)) throw new Error('A private tab keeps nothing, so a reason cannot be saved for it');
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const notes = this.whyNotes();
    if (!t) { delete notes[tab.url]; }
    else {
      if (t.length > 160) throw new Error('Keep it to one line: 160 characters at most');
      notes[tab.url] = { text: t, at: Date.now() };
    }
    const keys = Object.keys(notes).sort((a, b) => (notes[b].at || 0) - (notes[a].at || 0));
    const kept = {};
    for (const k of keys.slice(0, this.MAX_NOTES)) kept[k] = notes[k];
    VexPlanKit.writeJson(this.NOTES, kept);
    return t;
  },

  // ---- the hover card (js/tab-preview.js calls this) ------------------------------------------------
  decorate(previewEl, tab) {
    const info = previewEl && previewEl.querySelector('.preview-info');
    if (!info) return false;
    let box = info.querySelector('.preview-intent');
    if (!this.enabled() || !tab) { if (box) box.remove(); return false; }
    let lines;
    try { lines = this.lines(tab, this.intentOf(tab.id), this.whyOf(tab.url)); }
    catch (err) { window.VexProblems?.note('Tab intent', 'Could not read why this tab is open', err); lines = []; }
    if (!lines.length) { if (box) box.remove(); return false; }
    if (!box) { box = document.createElement('div'); box.className = 'preview-intent'; box.style.cssText = 'margin-top:6px;font-size:11px;color:var(--text-muted);line-height:1.4'; info.appendChild(box); }
    box.textContent = '';
    for (const l of lines) {
      const d = document.createElement('div');
      const b = document.createElement('span'); b.style.cssText = 'font-weight:650;color:var(--text)'; b.textContent = l.label + ': ';
      const t = document.createElement('span'); t.textContent = l.text;
      d.append(b, t); box.appendChild(d);
    }
    return true;
  },

  // ---- saying why -------------------------------------------------------------------------------------
  async askWhy() {
    if (!this.enabled()) { window.showToast?.('Tab reasons are switched off in Settings', 'info'); return; }
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const tab = TabManager.getActiveTab();
    if (!tab) { window.showToast?.('Open a page first', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('tab-intent');
    const cur = this.whyOf(tab.url);
    const text = await vexPrompt({ title: 'Why is this tab open?', message: 'One line, shown when you hover this tab. Leave it empty to clear it.', label: 'Reason', value: cur ? cur.text : '', okLabel: 'Save' });
    if (text == null) return;
    try { this.setWhy(tab, text); window.showToast?.(text.trim() ? 'Saved' : 'Cleared', 'info'); }
    catch (err) { window.showToast?.(err.message, 'error'); }
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    document.addEventListener('vex:tab-closed', (e) => { if (e && e.detail) this.forget(e.detail.tabId); });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('The hover card of a tab also says which page opened it, what you searched there, a reason you wrote, and when you last had it in front. Opener and search words are kept in memory for this run only; a reason you write is kept on this computer.'));
    el.appendChild(VexSettingsGroups.button('Say why the current tab is open', () => { this.askWhy().catch(err => window.showToast?.(err.message, 'error')); }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexTabIntent = VexTabIntent;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'tab-intent', title: 'Why is this tab open', keywords: 'tab hover card opener searched why reason last visited intent', before: 'about', build: (el) => VexTabIntent.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'tab-why', label: 'Say why this tab is open', hint: 'One line shown on the tab hover card', icon: 'note', action: () => { VexTabIntent.askWhy().catch(err => window.showToast?.(err.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabIntent };
