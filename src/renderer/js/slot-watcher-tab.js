// === Appointment slot watcher: look at a tab you already have open (T3-092) ===========
//
// The slot watcher (js/slot-watcher.js) asks a PUBLIC booking page again and again, without
// signing in. Many booking pages show their slots only to a signed-in person, so the watcher can
// never see them. This adds the other half: you open the page yourself (signed in, as usual) and
// leave the tab open, and Vex reads the TEXT of that tab and judges it with the same words.
//
//   Ctrl+K "Slot watcher: look at this tab"        one look, on that press
//   Ctrl+K "Slot watcher: keep looking at this tab"  every 15 minutes while the tab stays open
//
// What it does: reads document.body.innerText of the tab, up to 200 KB. The first look is a
// baseline; after that a line that appears with an "open" word, or the "none" message that goes away,
// is told once (not again for 30 minutes), exactly like a watched page. What it never does:
// reload, click, scroll, type, sign in or book; read a private, Tor or routed tab; or look at a tab
// whose address is not one of your watched pages (same site and path). The looks are in memory only:
// nothing from the page is stored, and closing the tab ends it.
const VexSlotTab = {
  KEY: 'vex.slotTab',                  // { [watch id]: true } for the pages kept under watch
  EVERY_MS: 15 * 60000,
  MAX_TEXT: 200000,
  JOB: 'slot-watcher-tab',
  _lines: new Map(),                   // watch id -> lines of the last look (memory only)
  _job: null,

  keep() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The tabs kept under watch could not be read: ' + err.message); }
    if (!raw) return {};
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved list of tabs under watch is not readable: ' + err.message); }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  _saveKeep(map) { localStorage.setItem(this.KEY, JSON.stringify(map)); },

  _norm(url) { try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, ''); } catch { return ''; } },
  _split(text) { return String(text || '').split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean); },

  // The watched page whose address is the one open in a tab. -> { watch, entry } or null
  pageForUrl(url) {
    if (typeof VexSlotWatcher === 'undefined') throw new Error('The slot watcher is not loaded');
    const want = this._norm(url);
    if (!want) return null;
    return VexSlotWatcher.pages().find(p => this._norm(p.watch.url) === want) || null;
  },
  // The tab (and its page) open on this watched page.
  tabFor(watch) {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return null;
    const want = this._norm(watch.url);
    const tab = want ? TabManager.tabs.find(t => this._norm(t.url) === want) : null;
    const wv = tab ? WebviewManager.webviews.get(tab.id) : null;
    return wv ? { tab, wv } : null;
  },

  // One look at the tab open on this watched page. -> { state: 'no-tab' | 'baseline' | 'quiet' | 'open', why? }
  async look(watchId) {
    if (typeof VexSlotWatcher === 'undefined') throw new Error('The slot watcher is not loaded');
    if (!VexSlotWatcher.enabled()) throw new Error('The slot watcher is switched off in Settings');
    const page = VexSlotWatcher.pages().find(p => p.watch.id === watchId);
    if (!page) throw new Error('That page is not in the slot watcher');
    const found = this.tabFor(page.watch);
    if (!found) { this._lines.delete(watchId); return { state: 'no-tab' }; }
    if (typeof VexTabPolicy !== 'undefined' && !VexTabPolicy.canReadWebview(found.wv)) throw new Error('A private, Tor or routed tab is never read');
    const text = await found.wv.executeJavaScript('document.body ? document.body.innerText.slice(0, ' + this.MAX_TEXT + ') : ""');
    const lines = this._split(text);
    const prev = this._lines.get(watchId);
    this._lines.set(watchId, lines);
    if (!prev) return { state: 'baseline' };
    const before = new Set(prev), now = new Set(lines);
    const v = VexSlotWatcher.judge(page.entry, lines.filter(l => !before.has(l)), prev.filter(l => !now.has(l)));
    if (!v.open) return { state: 'quiet' };
    this._tell(page, v);
    return { state: 'open', why: v.why };
  },

  // Told once per TOLD_AGAIN_MS, the same way a watched page tells.
  _tell({ watch, entry }, v) {
    const st = VexSlotWatcher.state();
    const rec = st.pages[watch.id];
    if (!rec) return false;
    const now = Date.now();
    if (rec.toldAt && now - rec.toldAt < VexSlotWatcher.TOLD_AGAIN_MS) return false;
    rec.toldAt = now;
    VexSlotWatcher._save(st);
    const title = (entry.label || watch.title) + ': a slot may be open';
    const open = () => { TabManager.createTab(watch.url, true); };
    if (typeof VexAttention !== 'undefined') {
      VexAttention.request({ feature: VexSlotWatcher.FEATURE, urgency: 'asked', id: watch.id + ':tab:' + now });
      VexAttention.osNotify({ feature: VexSlotWatcher.FEATURE, urgency: 'asked', id: watch.id + ':tab:' + now, title: 'Vex: ' + title, body: v.why + (v.line ? ' - ' + String(v.line).slice(0, 120) : '') })
        .catch((err) => console.error('[SlotTab] the Windows notification failed:', err));
    }
    window.showToast?.(title + ' (' + v.why + ')', 'info', 30000, { action: { label: 'Show the tab', run: open } });
    return true;
  },

  // Every EVERY_MS, for the pages kept under watch. -> how many tabs were looked at
  async lookAll() {
    if (typeof VexSlotWatcher === 'undefined' || !VexSlotWatcher.enabled()) return 0;
    const keep = this.keep();
    let n = 0;
    for (const { watch, entry } of VexSlotWatcher.pages()) {
      if (!keep[watch.id] || watch.paused) continue;
      try { const r = await this.look(watch.id); if (r.state !== 'no-tab') n++; }
      catch (err) { console.error('[SlotTab] the open tab could not be read:', err); window.VexProblems?.note('Slot watcher', 'Could not read the open tab for ' + (entry.label || watch.title), err); }
    }
    return n;
  },
  setKeep(watchId, on) {
    const keep = this.keep();
    if (on) keep[watchId] = true; else { delete keep[watchId]; this._lines.delete(watchId); }
    this._saveKeep(keep);
    if (on) this.ensureJob();
    return !!on;
  },
  ensureJob() {
    if (this._job || typeof VexJobs === 'undefined') return false;
    this._job = VexJobs.every(this.JOB, this.EVERY_MS, () => this.lookAll(), { feature: 'slot-watcher' });
    return true;
  },

  // ---- Ctrl+K ----------------------------------------------------------------------------------------------
  _active() {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const tab = TabManager.getActiveTab();
    if (!tab) throw new Error('Open the booking page in a tab first');
    const page = this.pageForUrl(tab.url);
    if (!page) throw new Error('This tab is not one of the pages in your slot watcher. Add the page there first.');
    return page;
  },
  commands() {
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    return [
      { id: 'slottab:look', label: 'Slot watcher: look at this tab', icon: 'calendar', hint: 'Read the text of this open booking page now and say if a slot looks open', action: async () => {
        try {
          const r = await this.look(this._active().watch.id);
          window.showToast?.(r.state === 'baseline' ? 'Looked at the tab. You will be told if it changes to show an open slot.' : r.state === 'open' ? 'A slot may be open (' + r.why + ')' : r.state === 'quiet' ? 'Nothing new on the page in this tab.' : 'No tab is open on that page.');
        } catch (err) { fail(err); }
      } },
      { id: 'slottab:keep', label: 'Slot watcher: keep looking at this tab', icon: 'calendar', hint: 'Read this open booking page every 15 minutes while the tab stays open (switch again to stop)', action: () => {
        try {
          const page = this._active();
          const on = !this.keep()[page.watch.id];
          this.setKeep(page.watch.id, on);
          window.showToast?.(on ? 'Vex will read this tab every 15 minutes while it stays open. It never reloads or clicks.' : 'Stopped looking at this tab.');
        } catch (err) { fail(err); }
      } },
    ];
  },
  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('slottab:', this.commands());
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexSlotTab = VexSlotTab;
  VexSlotTab.registerCommands();
  document.addEventListener('DOMContentLoaded', () => {
    VexSlotTab.registerCommands();
    try { if (typeof VexSlotWatcher !== 'undefined' && VexSlotWatcher.enabled() && Object.keys(VexSlotTab.keep()).length) VexSlotTab.ensureJob(); }
    catch (err) { console.error('[SlotTab]', err); window.VexProblems?.note('Slot watcher', 'The tabs kept under watch could not be started', err); }
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSlotTab };
