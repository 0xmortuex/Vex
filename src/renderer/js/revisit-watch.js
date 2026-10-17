// === Watch suggestions from revisit counts (T3-025) ============================
//
// A page you open again and again, to see whether something changed, is a page you should not have to
// open. This counts opens of the same page (address without query or fragment) and, when you have
// opened one 5 or more times in 7 days and are not already watching it, adds ONE row to the Attention
// Inbox: "Watch this page?" with a button that sets up a page watch (js/page-watch.js) for it.
//
//   - an open counts once per 20 minutes (a reload or an in-page click is not a revisit)
//   - never a private or Tor tab, a page on this computer or your home network, a site's front page
//     ("/"), or a page already watched
//   - a page is suggested at most once every 14 days; "Never for this" in the inbox mutes the feature
//   - what is kept: the address (host + path), the title and up to 12 open times for at most 200
//     pages, on this computer (vex.revisit); not synced, not sent anywhere
//
// It also checks that there is anything to watch for (Wave 5): at each counted open, a few seconds after the
// page settles, the page's own words are read in the tab (nothing is fetched), made steady the way Page watch
// does ("5 minutes ago" and clock times do not count) and reduced to a fingerprint; only the fingerprint is
// kept, 6 at most per page. A page is suggested only when at least two of the fingerprints differ, that is, when
// it looked different on two of your visits. A page that looked the same every time is not suggested, and its
// suggestion stays open for the next visit; a page that cannot be read at all is not suggested either.

const VexRevisit = {
  KEY: 'vex.revisit',
  PREF: 'vex.revisit.enabled',
  FEATURE: 'revisit-watch',
  MIN_HITS: 5,
  WINDOW_MS: 7 * 24 * 3600 * 1000,
  GAP_MS: 20 * 60 * 1000,
  RESUGGEST_MS: 14 * 24 * 3600 * 1000,
  MAX_KEYS: 200,
  MAX_HITS: 12,
  MAX_SIGS: 6,
  SETTLE_MS: 2500,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  _now() { return Date.now(); },

  // host + path of a web address, or '' when it is not a page worth counting. Pure.
  keyOf(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    if (!host || !path) return '';                       // a front page is the site, not a page
    if (/^\/(search|login|signin|logout|auth|oauth)\b/.test(path)) return '';
    return host + path;
  },
  cleanUrl(url) { const u = new URL(String(url)); return u.origin + u.pathname.replace(/\/+$/, ''); },

  _read() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return {};
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The revisit counts are not readable: ' + err.message); }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  _write(map) {
    const keys = Object.keys(map);
    if (keys.length > this.MAX_KEYS) {
      const last = (k) => (map[k].hits && map[k].hits.length ? map[k].hits[map[k].hits.length - 1] : 0);
      keys.sort((a, b) => last(a) - last(b)).slice(0, keys.length - this.MAX_KEYS).forEach(k => delete map[k]);
    }
    try { localStorage.setItem(this.KEY, JSON.stringify(map)); }
    catch (err) { throw new Error('Could not save the revisit counts: ' + err.message); }
  },

  // Pure: the opens of one record that fall inside the window.
  recent(rec, now) { return (rec && Array.isArray(rec.hits) ? rec.hits : []).filter(t => now - t <= this.WINDOW_MS); },

  // Record one open. -> { key, count, suggest } where suggest says whether a row should be added.
  note(url, title, now = this._now()) {
    const key = this.keyOf(url);
    if (!key) return null;
    const map = this._read();
    const rec = map[key] || (map[key] = { url: this.cleanUrl(url), title: '', hits: [], suggestedAt: 0 });
    const last = rec.hits.length ? rec.hits[rec.hits.length - 1] : 0;
    if (title) rec.title = String(title).slice(0, 140);
    if (!last || now - last >= this.GAP_MS) rec.hits.push(now);
    rec.hits = this.recent(rec, now).slice(-this.MAX_HITS);
    const count = rec.hits.length;
    const suggest = count >= this.MIN_HITS && now - (rec.suggestedAt || 0) >= this.RESUGGEST_MS;
    const counted = !last || now - last >= this.GAP_MS;
    this._write(map);
    return { key, count, suggest, counted, rec };
  },

  // ---- is there anything to watch for? --------------------------------------------------------------------
  // A fingerprint of a page's steady words (the same steadying as Page watch).
  fingerprint(text) {
    if (typeof PageWatch === 'undefined' || typeof PageWatch._steady !== 'function') throw new Error('Page watch is not loaded');
    const s = PageWatch._steady(text);
    if (s.length < 40) return '';                                   // too little to say anything
    let h = 0x811c9dc5, g = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = Math.imul(h ^ c, 0x01000193); g = Math.imul(g ^ c, 0x5bd1e995); }
    return (h >>> 0).toString(16) + (g >>> 0).toString(16) + '-' + s.length;
  },
  addSig(key, sig, now = this._now()) {
    if (!sig) return false;
    const map = this._read();
    const rec = map[key];
    if (!rec) return false;
    rec.sigs = [...(Array.isArray(rec.sigs) ? rec.sigs : []), { t: now, h: sig }].slice(-this.MAX_SIGS);
    this._write(map);
    return true;
  },
  // How many of the kept fingerprints differ, within the week.
  differing(rec, now = this._now()) {
    const seen = new Set((rec && Array.isArray(rec.sigs) ? rec.sigs : []).filter(s => now - s.t <= this.WINDOW_MS).map(s => s.h));
    return seen.size;
  },
  async readSig(tabId) {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tabId) : null;
    if (!wv || typeof window.vexGuestEval !== 'function') throw new Error('The page cannot be read from here');
    if (window.VexTabPolicy && window.VexTabPolicy.canReadWebview && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This tab is not read');
    const text = await window.vexGuestEval(wv, '(document.body ? document.body.innerText : "").slice(0, 60000)', false, 4000);
    return this.fingerprint(String(text || ''));
  },
  // After the page settles: keep its fingerprint, and suggest only when it has looked different.
  async afterSettle(tabId, url, r) {
    await new Promise(res => setTimeout(res, this.SETTLE_MS));
    const tab = this._tab(tabId);
    if (!tab || this.keyOf(tab.url) !== r.key) return false;           // the tab moved on
    try { this.addSig(r.key, await this.readSig(tabId)); }
    catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Watch suggestions', 'Could not read a page to see whether it changes', err); return false; }
    if (!r.suggest) return false;
    if (this._watched(url)) return false;
    const rec = this._read()[r.key];
    if (!rec || this.differing(rec) < 2) return false;                  // it looked the same every time: nothing to watch for
    return this.suggest(r.key, rec, r.count);
  },

  _watched(url) {
    if (typeof PageWatch === 'undefined') throw new Error('Page watch is not loaded');
    const k = this.keyOf(url);
    return PageWatch.list().some(w => this.keyOf(w.url) === k);
  },

  _tab(tabId) { return typeof TabManager !== 'undefined' ? (TabManager.tabs || []).find(t => t.id === tabId) : null; },

  onNavigated(detail) {
    if (!this.enabled() || !detail || detail.failed) return null;
    const tab = this._tab(detail.tabId);
    if (!tab) return null;
    // Private and Tor tabs are never counted (the same rule as saving a workspace).
    if (window.VexTabPolicy && (window.VexTabPolicy.isPrivateWindow || !window.VexTabPolicy.canRestore(tab))) return null;
    if (typeof PageWatch !== 'undefined' && PageWatch.isLocal(detail.url)) return null;
    const r = this.note(detail.url, tab.title);
    if (!r || !r.counted) return r;
    if (r.suggest && typeof PageWatch !== 'undefined' && PageWatch.refusalFor({ url: r.rec.url, partition: tab.partition || null })) r.suggest = false;
    r.settled = this.afterSettle(detail.tabId, detail.url, r).catch(err => { if (typeof VexProblems !== 'undefined') VexProblems.note('Watch suggestions', 'Could not look at a page that is opened often', err); return false; });
    return r;
  },

  suggest(key, rec, count) {
    if (typeof VexAttention === 'undefined') throw new Error('The attention budget is not loaded');
    const ok = VexAttention.suggest({
      feature: this.FEATURE, id: key, label: 'Watch suggestions',
      title: 'Watch ' + (rec.title || key) + '?',
      body: 'You opened it ' + count + ' times this week and it looked different on ' + this.differing(rec) + ' of those visits. Vex can check it and tell you when it changes.',
      action: { label: 'Watch this', key: 'watch:' + key },
    });
    if (ok) {
      const map = this._read();
      if (map[key]) { map[key].suggestedAt = this._now(); this._write(map); }
      if (typeof VexUsage !== 'undefined') VexUsage.touch('revisit-watch');
    }
    return ok;
  },

  async watch(key) {
    const rec = this._read()[key];
    if (!rec) throw new Error('That page is no longer in the list of pages you revisit');
    if (typeof PageWatch === 'undefined') throw new Error('Page watch is not loaded');
    return PageWatch.watchPage(rec.url, rec.title || rec.url);
  },

  clear() {
    try { localStorage.removeItem(this.KEY); }
    catch (err) { throw new Error('Could not clear the revisit counts: ' + err.message); }
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.FEATURE, (actionKey) => {
        if (!String(actionKey).startsWith('watch:')) return;
        this.watch(String(actionKey).slice(6)).catch(err => window.showToast?.(err.message, 'error'));
      });
    }
    document.addEventListener('vex:tab-navigated', (e) => {
      try { this.onNavigated(e.detail); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Watch suggestions', 'Could not count a page open', err); else throw err; }
    });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('When you open the same page 5 or more times in a week and are not watching it, one row appears in the Attention Inbox with a button to watch it. Private tabs, front pages and pages on this computer are never counted. Only the address, the title, the times and a short fingerprint of what the page said are kept, here.'));
    el.appendChild(VexSettingsGroups.button('Forget the counted pages', async () => {
      const ok = await window.vexConfirm({ title: 'Forget the counted pages?', message: 'The list of pages you revisit is cleared. Watches you already set up stay.', okLabel: 'Forget' });
      if (!ok) return;
      try { this.clear(); window.showToast?.('Forgotten'); } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { danger: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexRevisit = VexRevisit;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'revisit-watch', title: 'Watch suggestions', keywords: 'revisit watch page changes suggest open often', before: 'about', build: (el) => VexRevisit.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRevisit };
