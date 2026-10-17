// === "What for?" before a site you chose =====================================
//
// T2-007. For the few sites you named as the ones that swallow an evening, the
// first visit asks one gentle question before you settle in: what for? Five
// minutes, check one thing, or leave. The answer is a short pass for that site;
// when it runs out Vex says so once and does nothing else.
//
// Soft on purpose: "Skip" and Escape both just let you in (a longer pass), it
// never blocks, never closes a tab, never nags a second time inside a pass. The
// list is yours and starts empty. It asks only about the tab in front.
// Tightening in exam weeks needs the exam planner (T2-013) and is not built.
const IntentGate = {
  KEY: 'vex.intentGate',
  ON_KEY: 'vex.intentGate.enabled',
  PASS_MS: { five: 5 * 60000, one: 2 * 60000, skip: 15 * 60000 },
  MAX_HOSTS: 30,
  _asking: new Set(),

  enabled() { return VexLifeKit.flag(this.ON_KEY, false); },
  setEnabled(on) { VexLifeKit.setFlag(this.ON_KEY, !!on); },
  data() {
    const d = VexLifeKit.read(this.KEY, null);
    return d && Array.isArray(d.hosts) ? d : { v: 1, hosts: [], passes: {}, days: {} };
  },
  save(d) { VexLifeKit.write(this.KEY, d); },
  hosts() { return this.data().hosts.slice(); },
  cleanHost(text) {
    const h = String(text || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, '');
    if (!h) return '';
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) throw new Error(h + ' is not a site address');
    return h;
  },
  setHosts(list) {
    const hosts = [...new Set(list.map(s => this.cleanHost(s)).filter(Boolean))];
    if (hosts.length > this.MAX_HOSTS) throw new Error('Up to ' + this.MAX_HOSTS + ' sites');
    const d = this.data();
    d.hosts = hosts;
    this.save(d);
    return hosts;
  },
  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  // The listed site this address belongs to, or ''.
  listed(url) {
    const host = this.hostOf(url);
    if (!host || !/^https?:/i.test(String(url))) return '';
    return this.hosts().find(h => host === h || host.endsWith('.' + h)) || '';
  },
  passActive(site, now = Date.now()) { const p = this.data().passes[site]; return !!p && p.until > now; },

  // ---- the answer ------------------------------------------------------------------
  record(site, answer, now = Date.now()) {
    if (!['five', 'one', 'leave', 'skip'].includes(answer)) throw new Error('Unknown answer ' + answer);
    const d = this.data();
    const day = VexLifeKit.dayString(now);
    const s = d.days[day] || (d.days[day] = { asked: 0, five: 0, one: 0, leave: 0, skip: 0 });
    s.asked++; s[answer]++;
    for (const k of Object.keys(d.days).sort().slice(0, -14)) delete d.days[k];     // two weeks kept
    if (answer !== 'leave') d.passes[site] = { until: now + this.PASS_MS[answer], answer, told: false };
    this.save(d);
    return d.passes[site] || null;
  },
  stats(now = Date.now()) { return this.data().days[VexLifeKit.dayString(now)] || { asked: 0, five: 0, one: 0, leave: 0, skip: 0 }; },

  // ---- the question -----------------------------------------------------------------
  onNavigate(webview, url, tab) {
    if (!this.enabled() || !tab) return;
    if (typeof TabManager !== 'undefined' && TabManager.activeTabId !== tab.id) return;   // asked when the tab is brought forward
    this.check(webview, url, tab);
  },
  check(webview, url, tab) {
    const site = this.listed(url);
    if (!site || this.passActive(site) || this._asking.has(site)) return false;
    this._asking.add(site);
    this.ask(site).then((answer) => {
      this._asking.delete(site);
      if (answer === 'leave') this.leave(webview);
    }).catch((err) => { this._asking.delete(site); window.VexProblems?.note('Intent gate', 'Could not ask', err); });
    return true;
  },
  leave(webview) {
    try { if (webview.canGoBack()) webview.goBack(); else webview.loadURL(typeof START_URL !== 'undefined' ? START_URL : 'about:blank'); }
    catch (err) { window.VexProblems?.note('Intent gate', 'Could not leave the page', err); }
  },
  ask(site) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'vex-intent-gate';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.45);display:grid;place-items:center';
      const card = document.createElement('div');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'What for?');
      card.style.cssText = 'width:min(380px,92vw);background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45))';
      const h = document.createElement('div');
      h.style.cssText = 'font-size:14px;font-weight:650';
      h.textContent = 'What for? ' + site;
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:12px;color:var(--text-muted);margin:6px 0 12px';
      sub.textContent = 'You listed this site. Pick how long you mean to stay.';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        try { this.record(site, answer); } catch (err) { window.VexProblems?.note('Intent gate', 'Could not save the answer', err); }
        resolve(answer);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish('skip'); } };
      const mk = (text, answer, primary) => VexSettingsGroups.button(text, () => finish(answer), { primary });
      row.append(mk('5 minutes', 'five', true), mk('Check one thing', 'one'), mk('Leave', 'leave'), mk('Skip', 'skip'));
      card.append(h, sub, row);
      overlay.appendChild(card);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      if (typeof VexLayer !== 'undefined') VexLayer.track(overlay, { tier: 'dialog', id: 'intent-gate' });
      row.firstChild.focus();
    });
  },

  // ---- a pass running out: said once ----------------------------------------------
  sweep(now = Date.now()) {
    const d = this.data();
    let changed = false;
    for (const [site, p] of Object.entries(d.passes)) {
      if (p.until > now) continue;
      if (!p.told && p.answer !== 'skip') {
        p.told = true;
        changed = true;
        if (typeof VexAttention !== 'undefined') {
          VexAttention.notify({ feature: 'intent-gate', urgency: 'ambient', id: site + p.until, title: 'Your time on ' + site + ' is up' },
            () => window.showToast?.('Your ' + (p.answer === 'five' ? '5 minutes' : 'quick look') + ' on ' + site + ' is up'));
        }
      }
      if (now - p.until > 3600000) { delete d.passes[site]; changed = true; }
    }
    if (changed) this.save(d);
  },
  start() {
    if (this._wired) return;
    this._wired = true;
    window.addEventListener('vex:tab-activated', (e) => {
      if (!this.enabled() || typeof WebviewManager === 'undefined') return;
      const url = e.detail && e.detail.url;
      const wv = WebviewManager.webviews.get(e.detail.tabId);
      if (url && wv) this.check(wv, url, { id: e.detail.tabId });
    });
    if (typeof VexJobs !== 'undefined') VexJobs.every('Intent gate', 15000, () => { if (this.enabled()) this.sweep(); }, { when: 'ui', feature: 'intent-gate' });
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Asks "what for?" once before a site you list. Soft: Skip and Escape just let you in, nothing is blocked or closed. The list is yours and starts empty.'));
    el.appendChild(VexSettingsGroups.button(this.enabled() ? 'Turn it off' : 'Turn it on', () => { this.setEnabled(!this.enabled()); VexSettingsGroups.inject(); }, { primary: !this.enabled() }));
    const ta = document.createElement('textarea');
    ta.rows = 4; ta.spellcheck = false; ta.value = this.hosts().join('\n');
    ta.setAttribute('aria-label', 'Sites to ask about, one per line');
    ta.style.cssText = 'width:100%;box-sizing:border-box;margin-top:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12.5px';
    el.append(ta, VexSettingsGroups.button('Save the list', () => {
      try { const l = this.setHosts(ta.value.split(/\r?\n/)); window.showToast?.(l.length + ' site' + (l.length === 1 ? '' : 's') + ' saved'); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    const s = this.stats();
    el.appendChild(VexSettingsGroups.note('Today: asked ' + s.asked + ', left ' + s.leave + ', skipped ' + s.skip + '.'));
  },
};

if (typeof window !== 'undefined') {
  window.IntentGate = IntentGate;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'intent-gate', title: 'Ask before distracting sites', keywords: 'intent gate what for distraction pause site list focus', before: 'about', build: (el) => IntentGate.group(el) });
  }
  if (typeof VexLifeKit !== 'undefined' && typeof document !== 'undefined') IntentGate.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { IntentGate };
