// === Switches for one site =================================================
//
// The three switches a site can be held to: JavaScript, cookies, and content
// from other hosts. Each one is normally on; turning it off is a decision
// about that site and nothing else.
//
// The rules live in the main process, which is the only side that sees
// requests (src/main/site-rules.js); a copy is kept here so a tab can be built
// with JavaScript already off rather than having to reload for it.
const SiteRulesUI = {
  KEY: 'vex.siteRules',
  WHAT: [
    { id: 'js', name: 'JavaScript', note: 'Off makes a page plain text and pictures. The tab reopens with it off.' },
    { id: 'cookies', name: 'Cookies', note: 'Off means none are sent to this site and none it sends back are kept, and any it already had are removed — it will not remember you.' },
    { id: 'thirdParty', name: 'Content from other sites', note: 'Off refuses anything this page loads from another host: adverts, trackers, embeds, some fonts.' },
  ],

  rules() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } },
  save(rules) { try { localStorage.setItem(this.KEY, JSON.stringify(rules)); } catch {} },

  host(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },

  // The rule that applies to a page: the host's own, or a parent domain's.
  forUrl(url, rules = this.rules()) {
    const h = this.host(url);
    if (!h) return null;
    let best = null, bestLen = -1;
    for (const [key, rule] of Object.entries(rules)) {
      if (!(h === key || h.endsWith('.' + key))) continue;
      if (key.length > bestLen) { best = rule; bestLen = key.length; }
    }
    return best;
  },

  isOff(url, what) { const rule = this.forUrl(url); return !!(rule && rule[what] === 'off'); },
  scriptsOff(url) { return this.isOff(url, 'js'); },

  // Main is told on every change, and once at startup — it is the side that
  // actually refuses the requests.
  async push() {
    const res = await window.vex.siteRulesSet(this.rules());
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not save these switches');
    return res.rules;
  },

  async set(url, what, off) {
    const h = this.host(url);
    if (!h) throw new Error('That is not a web page');
    const rules = this.rules();
    const rule = { ...(rules[h] || {}) };
    if (off) rule[what] = 'off'; else delete rule[what];
    if (Object.keys(rule).length) rules[h] = rule; else delete rules[h];
    this.save(rules);
    await this.push();
    // Switching cookies off takes away the ones the site already has, which
    // is the part a person can actually see.
    if (off && what === 'cookies') {
      const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
      await this.sweep(url, tab && tab.partition);
    }
    return rule;
  },

  // A page can still set a cookie in its own script, which no header rule can
  // stop — so a site whose cookies are off has them taken away again on every
  // load. "Off" then means off, not "off except the ones it writes itself".
  async sweep(url, partition) {
    if (!this.isOff(url, 'cookies')) return 0;
    const res = await window.vex.cookiesList({ url, partition: partition || 'persist:main' });
    if (!res || !res.ok) return 0;
    let gone = 0;
    for (const c of res.cookies) {
      const out = await window.vex.cookiesRemove({ url, partition: partition || 'persist:main', name: c.name, domain: c.domain, path: c.path, secure: c.secure });
      if (out && out.ok) gone++;
    }
    return gone;
  },

  init() {
    // The stored rules are the truth; this only makes main agree with them.
    this.push().catch(err => window.VexProblems?.note('Site switches', 'Could not tell Vex about your per-site switches', err));
    document.addEventListener('vex:tab-navigated', (e) => {
      const { tabId, url } = e.detail || {};
      if (!this.isOff(url || '', 'cookies')) return;
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
      this.sweep(url, tab && tab.partition)
        .catch(err => window.VexProblems?.note('Site switches', 'Could not clear cookies for a site you switched them off for', err));
    });
    return this;
  },

  _tab() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    if (!/^https?:/i.test(url)) throw new Error('Open a website first');
    return { url, wv, tab };
  },

  open() {
    const t = this._tab();
    const host = this.host(t.url);
    document.querySelector('.vex-siterules-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-siterules-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:12vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Switches for this site"
           style="width:min(540px,92vw);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="font-size:13.5px;font-weight:650;color:var(--text)">What ${esc(host)} is allowed</div>
          <div style="font-size:10.5px;color:var(--text-muted)">Only this site, and every page of it</div>
        </div>
        <div data-list style="padding:6px"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          A change takes effect on the next load — the page reloads itself when you close this.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    let changed = false;
    const draw = () => {
      listEl.innerHTML = '';
      for (const what of this.WHAT) {
        const off = this.isOff(t.url, what.id);
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:9px;border-radius:8px;cursor:pointer';
        row.innerHTML = `
          <input type="checkbox" ${off ? '' : 'checked'} style="margin-top:2px">
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text)">${esc(what.name)}</div>
            <div style="font-size:10.5px;color:var(--text-muted)">${esc(what.note)}</div>
          </div>`;
        row.querySelector('input').addEventListener('change', async (e) => {
          try {
            await this.set(t.url, what.id, !e.target.checked);
            changed = true;
            draw();
          } catch (err) { window.showToast?.(err.message, 'error'); }
        });
        listEl.appendChild(row);
      }
    };

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      // JavaScript is decided when the tab is built, so the tab is built
      // again — the other two take effect on the next request either way.
      if (changed && t.tab) { try { TabManager.rebuildTab(t.tab.id); } catch { /* the tab went */ } }
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    draw();
    document.body.appendChild(overlay);
    return overlay;
  },
};

if (typeof window !== 'undefined') window.SiteRulesUI = SiteRulesUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteRulesUI };
