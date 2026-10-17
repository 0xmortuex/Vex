// === Fake "your browser is out of date" overlays: a passive warning (T3-010) ============
//
// "Your Chrome is out of date. Download the update" over a page, with a button that downloads a program, is one of
// the commonest ways malware reaches people (SocGholish and its copies). Vex's download check judges the file
// afterwards; this looks at the page itself, once, a few seconds after it loads, and says so if it has the shape of
// that scam. It only WARNS:
//
//   - it never changes, hides or clicks anything on the page, and it opens no link;
//   - what it reads is the page's own text and the addresses of its buttons, by one read-only script
//     (executeJavaScript) that returns a few short strings, and only from a page Vex may read (not a private, Tor
//     or routed tab). Nothing is kept except the host it warned about, in memory, for six hours;
//   - "warn only when sure": a large overlay (it covers a good part of the window, fixed or absolute), the lure
//     text (your browser is out of date / needs an update / a browser update is required), AND a way to get a
//     program (a download link to a program or archive, or a button that says download or update). A page on the
//     browser maker's own site is left alone, and so is a site you said "do not warn again" for;
//   - it follows Web safety: with "How often Vex warns" set to Off it does not look at all.
//
// The judgement (judge) is pure and tested; the read is one function string (PROBE).
const VexFakeUpdate = {
  KEY: 'vex.fakeUpdateGuard',
  FEATURE: 'fake-update-guard',
  DELAY_MS: 2500,
  TELL_EVERY_MS: 6 * 3600 * 1000,
  MIN_COVER: 0.25,
  // The maker's own sites: a real "update your browser" notice can only be there.
  VENDORS: { chrome: ['google.com'], chromium: ['google.com', 'chromium.org'], firefox: ['mozilla.org', 'mozilla.com'], edge: ['microsoft.com'], opera: ['opera.com'], brave: ['brave.com'], safari: ['apple.com'] },
  LURE: [
    /\b(?:your|the|this)\s+(?:web\s*)?(?:browser|google chrome|chrome|firefox|mozilla firefox|microsoft edge|edge|opera|brave|safari)\b[^.]{0,60}\b(?:out[\s-]?of[\s-]?date|outdated|needs?\s+(?:an?\s+)?(?:urgent\s+)?update|must be updated|has expired|is not up to date)/i,
    /\b(?:chrome|firefox|edge|opera|brave|safari|browser)\s+(?:security\s+)?update\s+(?:is\s+)?(?:required|available|needed|ready)\b/i,
    /\b(?:update|upgrade)\s+(?:your\s+)?(?:web\s*)?(?:browser|chrome|firefox|edge|opera|brave|safari)\s+(?:now|to continue|to view|to see)\b/i,
    /\bflash\s*player\b[^.]{0,40}\b(?:update|install|missing|out[\s-]?of[\s-]?date)/i,
  ],
  PROGRAM_LINK: /\.(?:exe|msi|msix|scr|bat|cmd|ps1|vbs|hta|js|jse|lnk|zip|rar|7z|iso|img|dmg|pkg|apk|jar)(?:[?#]|$)/i,
  ACTION_WORDS: /\b(?:download|update now|update chrome|update browser|install|get the update|continue)\b/i,

  // Runs inside the page: read-only. Returns a small object (strings are cut short).
  PROBE: `(() => {
    const vw = Math.max(1, innerWidth), vh = Math.max(1, innerHeight);
    const out = { cover: 0, text: '', links: [], buttons: [] };
    const nodes = document.querySelectorAll('div,section,aside,dialog,form,main');
    let best = null, bestArea = 0, seen = 0;
    for (const el of nodes) {
      if (++seen > 3000) break;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.position !== 'fixed' && cs.position !== 'absolute')) continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0), h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      const area = (w * h) / (vw * vh);
      if (area > bestArea && (el.innerText || '').trim().length > 20) { best = el; bestArea = area; }
    }
    if (!best) return out;
    out.cover = Math.round(bestArea * 100) / 100;
    out.text = (best.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
    for (const a of best.querySelectorAll('a[href],a[download]')) {
      if (out.links.length >= 6) break;
      let h = '';
      try { h = new URL(a.getAttribute('href') || '', location.href).href; } catch (e) { h = ''; }
      out.links.push({ href: h.slice(0, 300), download: a.hasAttribute('download'), text: (a.innerText || '').trim().slice(0, 40) });
    }
    for (const b of best.querySelectorAll('button,[role=button],input[type=button],input[type=submit]')) {
      if (out.buttons.length >= 6) break;
      out.buttons.push(((b.innerText || b.value || '')).trim().slice(0, 40));
    }
    return out;
  })()`,

  // report: what PROBE returned. host: the page's host. allow: hosts the person said not to warn about.
  // -> { warn, browser, reasons[] }
  judge(report, host, allow = []) {
    const none = { warn: false, browser: '', reasons: [] };
    if (!report || typeof report !== 'object') return none;
    const bare = String(host || '').toLowerCase().replace(/^www\./, '');
    const ends = (h, d) => h === d || h.endsWith('.' + d);
    if ((allow || []).some(a => ends(bare, String(a).toLowerCase()))) return none;
    const text = String(report.text || '');
    const lure = this.LURE.find(re => re.test(text));
    if (!lure) return none;
    if (!(Number(report.cover) >= this.MIN_COVER)) return none;
    const named = Object.keys(this.VENDORS).find(b => new RegExp('\\b' + b + '\\b', 'i').test(text)) || '';
    if (named && this.VENDORS[named].some(d => ends(bare, d))) return none;
    const links = Array.isArray(report.links) ? report.links : [];
    const programLink = links.find(l => l && (l.download === true || this.PROGRAM_LINK.test(String(l.href || ''))));
    const actionButton = (Array.isArray(report.buttons) ? report.buttons : []).find(b => this.ACTION_WORDS.test(String(b)));
    const actionLink = links.find(l => l && this.ACTION_WORDS.test(String(l.text || '')));
    if (!programLink && !actionButton && !actionLink) return none;
    const reasons = ['A large notice covering the page says your browser is out of date.'];
    if (programLink) reasons.push('Its button leads to a program or archive to download.');
    else reasons.push('It asks you to download or install an "update".');
    reasons.push(named ? this.VENDORS[named][0] + ' is where a real ' + named + ' update comes from; this page is ' + (bare || 'another site') + '.' : 'Browsers update themselves; a web page cannot update one.');
    return { warn: true, browser: named, reasons };
  },

  // ---- switch ------------------------------------------------------------------------------------
  enabled() {
    try { return localStorage.getItem(this.KEY) !== 'off'; }
    catch (err) { console.error('[FakeUpdate] the switch could not be read:', err.message); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); },

  _told: new Map(),
  _tellOnce(host, now = Date.now()) {
    const at = this._told.get(host);
    if (at && now - at < this.TELL_EVERY_MS) return false;
    this._told.set(host, now);
    if (this._told.size > 100) this._told.delete(this._told.keys().next().value);
    return true;
  },

  async _safety() {
    const api = typeof window !== 'undefined' && window.vex ? window.vex.webSafety : null;
    if (!api || typeof api.get !== 'function') throw new Error('Web safety is not available in this window');
    return api.get();
  },

  // One look at the page in `webview` (a normal, readable tab). -> the judgement, or null when not looked at.
  async scan(tab, webview) {
    if (!this.enabled() || !tab || !webview || typeof webview.executeJavaScript !== 'function') return null;
    let host = '';
    try { const u = new URL(tab.url); if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; host = u.hostname; } catch { return null; }   // vex-allow-empty-catch: not a web address means nothing to look at
    const pol = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    if (pol && typeof pol.canReadWebview === 'function' && !pol.canReadWebview(webview)) return null;
    const safety = await this._safety();
    if (safety.sensitivity === 'off') return null;
    const report = await webview.executeJavaScript(this.PROBE);
    const verdict = this.judge(report, host, safety.allow);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    if (verdict.warn && this._tellOnce(host.toLowerCase())) this.tell(host, verdict);
    return verdict;
  },

  tell(host, verdict) {
    const text = host + ' is showing a fake browser update. ' + verdict.reasons[1] + ' Do not download or run it. Close the tab; your browser updates by itself.';
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: this.FEATURE, urgency: 'critical', id: host, title: 'This page looks like a fake browser update', body: text, label: 'Fake update guard' }, () => window.showToast?.(text, 'error', 14000));
    else window.showToast?.(text, 'error', 14000);
    if (typeof VexLedger !== 'undefined' && typeof VexLedger.note === 'function') VexLedger.note({ feature: this.FEATURE, what: 'Warned that ' + host + ' shows a fake browser update', why: verdict.reasons.join(' ') });
  },

  // After a load: look once, a little later (overlays appear after the page's scripts run).
  start() {
    if (this._started || typeof document === 'undefined') return;
    this._started = true;
    document.addEventListener('vex:tab-navigated', (e) => {
      const d = e && e.detail;
      if (!d || d.failed || !this.enabled()) return;
      setTimeout(() => {
        try {
          const tab = typeof TabManager !== 'undefined' && TabManager.tabs ? TabManager.tabs.find(t => t.id === d.tabId) : null;
          const wv = typeof WebviewManager !== 'undefined' && WebviewManager.webviews ? WebviewManager.webviews.get(d.tabId) : null;
          if (!tab || !wv || !wv.isConnected) return;
          this.scan({ ...tab, url: d.url || tab.url }, wv)
            .catch((err) => window.VexProblems?.note('Fake update guard', 'Could not look at the page', err));
        } catch (err) { window.VexProblems?.note('Fake update guard', 'Could not look at the page', err); }
      }, this.DELAY_MS);
    });
  },

  settingsRows(body) {
    const S = typeof VexSettingsGroup !== 'undefined' ? VexSettingsGroup : null;
    if (!S) return;
    body.appendChild(S.note('Fake update guard: a few seconds after a page loads, Vex looks for a large "your browser is out of date, download the update" notice that leads to a program, and warns you. It only warns: it never changes or clicks anything on the page, and it does not look at private, Tor or routed tabs.'));
    body.appendChild(S.toggle('Warn about fake browser updates', this.enabled(), (on) => this.setEnabled(on)));
  },
};

if (typeof window !== 'undefined') {
  window.VexFakeUpdate = VexFakeUpdate;
  VexFakeUpdate.start();
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'fake-update-guard', title: 'Fake update guard',
      keywords: 'fake browser update overlay scam malware chrome out of date download warn web safety',
      before: 'about',
      render: (body) => VexFakeUpdate.settingsRows(body),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFakeUpdate };
