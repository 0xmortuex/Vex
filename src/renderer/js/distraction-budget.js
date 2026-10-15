// === Distraction budget =====================================================
//
// A daily time limit per kind of site (social, video, news, shopping, games).
// Opt-in and local: the seconds are counted here, from the time the active
// tab of a focused Vex window actually spends on a site of that kind, and
// kept in this profile's localStorage for 30 days. Nothing leaves the machine.
//
// What happens at the limit is the user's choice per category:
//   nudge  a small card slides into the page at 80% and again at 100%, then
//          every 15 minutes of continued use. It never blocks anything.
//   block  at 100% a navigation to a site of that kind is bounced back, the
//          way a Focus session does it (FocusMode.guard asks shouldBlock).
//
// Related, not shared: FocusMode's blocklist is a timed session; this is a
// daily allowance. Both can be on at once.
const DistractionBudget = {
  KEY: 'vex.distractionBudget',
  TICK_MS: 5000,
  KEEP_DAYS: 30,
  REPEAT_MS: 15 * 60 * 1000,
  WARN_AT: 0.8,

  CATEGORIES: ['social', 'video', 'news', 'shopping', 'games'],
  LABELS: { social: 'Social', video: 'Video', news: 'News', shopping: 'Shopping', games: 'Games' },
  // Built-in hosts. A host matches itself and its subdomains. The user's own
  // additions (state.custom) win over these.
  HOSTS: {
    social: ['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'reddit.com', 'snapchat.com', 'linkedin.com', 'threads.net', 'pinterest.com', 'tumblr.com'],
    video: ['youtube.com', 'netflix.com', 'twitch.tv', 'primevideo.com', 'disneyplus.com', 'hulu.com', 'vimeo.com', 'dailymotion.com'],
    news: ['cnn.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'foxnews.com', 'reuters.com', 'news.ycombinator.com', 'washingtonpost.com', 'bloomberg.com'],
    shopping: ['amazon.com', 'ebay.com', 'aliexpress.com', 'etsy.com', 'walmart.com', 'temu.com', 'shein.com', 'target.com'],
    games: ['store.steampowered.com', 'epicgames.com', 'roblox.com', 'miniclip.com', 'poki.com', 'crazygames.com'],
  },

  _timer: null,
  _lastTick: 0,
  _nudged: {},        // 'YYYY-MM-DD|cat|level' -> time last nudged
  _state: null,

  // ---- pure helpers (no DOM, no storage) ---------------------------------
  dayKey(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  hostOf(url) {
    try {
      const u = new URL(String(url));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch { return ''; }
  },

  // The category of an address, or null. `custom` is { host: category }.
  categoryOf(url, custom = {}) {
    const host = this.hostOf(url);
    if (!host) return null;
    const hit = (list) => list.some(h => host === h || host.endsWith('.' + h));
    for (const h of Object.keys(custom || {})) {
      if ((host === h || host.endsWith('.' + h)) && this.CATEGORIES.includes(custom[h])) return custom[h];
    }
    for (const cat of this.CATEGORIES) if (hit(this.HOSTS[cat] || [])) return cat;
    return null;
  },

  // 'ok' | 'near' | 'over' for seconds spent against a limit in minutes
  // (0 or missing = no limit set).
  levelFor(seconds, limitMinutes) {
    const limit = Number(limitMinutes) * 60;
    if (!(limit > 0)) return 'ok';
    if (seconds >= limit) return 'over';
    if (seconds >= limit * this.WARN_AT) return 'near';
    return 'ok';
  },

  // Drop days older than KEEP_DAYS; returns a new days object.
  prune(days, now = new Date()) {
    const out = {};
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - this.KEEP_DAYS);
    const min = this.dayKey(cutoff);
    for (const k of Object.keys(days || {})) if (k >= min) out[k] = days[k];
    return out;
  },

  // ---- state -------------------------------------------------------------
  _defaults() { return { enabled: false, limits: {}, modes: {}, custom: {}, days: {} }; },

  state() {
    if (this._state) return this._state;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { s = null; }
    const d = this._defaults();
    if (s && typeof s === 'object') {
      d.enabled = s.enabled === true;
      for (const c of this.CATEGORIES) {
        const n = Number(s.limits && s.limits[c]);
        if (Number.isFinite(n) && n > 0) d.limits[c] = Math.min(Math.round(n), 1440);
        if (s.modes && s.modes[c] === 'block') d.modes[c] = 'block';
      }
      if (s.custom && typeof s.custom === 'object') {
        for (const h of Object.keys(s.custom)) if (this.CATEGORIES.includes(s.custom[h]) && typeof h === 'string') d.custom[h] = s.custom[h];
      }
      if (s.days && typeof s.days === 'object') d.days = this.prune(s.days);
    }
    this._state = d;
    return d;
  },

  // Returns false when storage refused the write; the caller must say so.
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.state())); return true; } catch { return false; }
  },

  secondsToday(cat, now = new Date()) {
    const day = this.state().days[this.dayKey(now)] || {};
    return Number(day[cat]) || 0;
  },

  add(cat, seconds, now = new Date()) {
    if (!this.CATEGORIES.includes(cat) || !(seconds > 0)) return;
    const s = this.state();
    const k = this.dayKey(now);
    if (!s.days[k]) { s.days = this.prune(s.days, now); s.days[k] = {}; }
    s.days[k][cat] = (Number(s.days[k][cat]) || 0) + seconds;
  },

  // ---- counting ----------------------------------------------------------
  // Called every TICK_MS. Counts only while Vex is the window you are in and
  // visible: a minimised or background Vex does not run the clock.
  tick(now = Date.now()) {
    const s = this.state();
    const elapsed = this._lastTick ? Math.min((now - this._lastTick) / 1000, this.TICK_MS / 1000 * 2) : 0;
    this._lastTick = now;
    if (!s.enabled || !elapsed) return;
    if (typeof document !== 'undefined' && (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()))) return;
    const tab = (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
    if (!tab || !tab.url) return;
    // A private, Tor or off-the-record tab is not recorded: it was opened to leave no trace.
    if (tab.private || tab.tor || tab.incognito) return;
    const cat = this.categoryOf(tab.url, s.custom);
    if (!cat) return;
    this.add(cat, elapsed, new Date(now));
    if (Math.floor(this.secondsToday(cat) / 30) !== Math.floor((this.secondsToday(cat) - elapsed) / 30)) this.save();
    this._maybeNudge(cat, now);
  },

  _maybeNudge(cat, now) {
    const s = this.state();
    const limit = s.limits[cat];
    if (!limit) return;
    const level = this.levelFor(this.secondsToday(cat), limit);
    if (level === 'ok') return;
    const key = this.dayKey(new Date(now)) + '|' + cat + '|' + level;
    const last = this._nudged[key] || 0;
    if (last && (level === 'near' || now - last < this.REPEAT_MS)) return;
    this._nudged[key] = now;
    this.nudge(cat, level);
  },

  _words(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
  },

  // The card, drawn inside the page so it is seen where the time is spent.
  // Plain text only; the page can restyle but not read anything from it.
  nudge(cat, level) {
    const s = this.state();
    const label = this.LABELS[cat];
    const spent = this._words(this.secondsToday(cat));
    const text = level === 'over'
      ? `${label} budget used up: ${spent} today, your limit is ${s.limits[cat]} min.`
      : `${label}: ${spent} of ${s.limits[cat]} min used today.`;
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview) ? WebviewManager.getActiveWebview() : null;
    if (!wv || typeof wv.executeJavaScript !== 'function') { window.showToast?.(text); return; }
    const icon = (window.VexIcons && VexIcons.svg) ? VexIcons.svg('timer', { size: 16 }) : '';
    const js = `(function(){try{
      var old=document.getElementById('__vex_budget_nudge');if(old)old.remove();
      var d=document.createElement('div');d.id='__vex_budget_nudge';d.setAttribute('role','status');
      d.style.cssText='all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:300px;padding:10px 14px;border-radius:12px;background:#1d1f24;color:#f2f3f5;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:8px;align-items:flex-start;opacity:0;transition:opacity .25s';
      var i=document.createElement('span');i.innerHTML=${JSON.stringify(icon)};i.style.cssText='flex:none;margin-top:1px;display:inline-flex';
      var t=document.createElement('span');t.textContent=${JSON.stringify(text)};
      var x=document.createElement('button');x.type='button';x.setAttribute('aria-label','Dismiss');x.textContent='\\u00d7';
      x.style.cssText='all:unset;cursor:pointer;margin-left:6px;padding:0 4px;font-size:16px;line-height:1;opacity:.7';
      x.onclick=function(){d.remove()};
      d.append(i,t,x);document.documentElement.appendChild(d);
      requestAnimationFrame(function(){d.style.opacity='1'});
      setTimeout(function(){d.style.opacity='0';setTimeout(function(){d.remove()},300)},9000);
    }catch(e){}})();`;
    try { wv.executeJavaScript(js).catch(() => {}); } catch { window.showToast?.(text); }
  },

  // ---- blocking (asked by FocusMode.guard on every navigation) -----------
  shouldBlock(url) {
    const s = this.state();
    if (!s.enabled) return null;
    const cat = this.categoryOf(url, s.custom);
    if (!cat || s.modes[cat] !== 'block' || !s.limits[cat]) return null;
    return this.levelFor(this.secondsToday(cat), s.limits[cat]) === 'over' ? cat : null;
  },

  start() {
    if (this._timer) return;
    this._lastTick = Date.now();
    this._timer = setInterval(() => {
      try { this.tick(); } catch (err) { console.error('[DistractionBudget] tick failed:', err && err.message); }
    }, this.TICK_MS);
  },
  stop() { clearInterval(this._timer); this._timer = null; this.save(); },

  init() {
    this.state();
    this.start();
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => this.save());
  },

  // ---- settings ----------------------------------------------------------
  renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    const s = this.state();
    const rows = this.CATEGORIES.map((c) => {
      const spent = this.secondsToday(c);
      const lim = s.limits[c] || '';
      const level = this.levelFor(spent, lim);
      const note = level === 'over' ? 'over the limit' : level === 'near' ? 'close to the limit' : '';
      return `<div class="setting-toggle-row" data-cat="${c}">
        <span>${esc(this.LABELS[c])}<br><span class="setting-info muted" style="font-size:11.5px">${esc(this._words(spent))} today${note ? ' (' + note + ')' : ''}</span></span>
        <span style="display:flex;gap:6px;align-items:center">
          <input type="number" min="0" max="1440" step="5" class="set-input db-limit" value="${esc(String(lim))}" placeholder="no limit" aria-label="${esc(this.LABELS[c])} daily limit in minutes" style="width:84px">
          <select class="db-mode" aria-label="${esc(this.LABELS[c])}: at the limit">
            <option value="nudge"${s.modes[c] === 'block' ? '' : ' selected'}>Nudge me</option>
            <option value="block"${s.modes[c] === 'block' ? ' selected' : ''}>Block</option>
          </select>
        </span></div>`;
    }).join('');
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">A daily limit per kind of site, in minutes, counted from the time the tab you are looking at spends there. Counted on this computer only, never sent anywhere. Private and Tor tabs are not counted.</p>
      <div class="setting-toggle-row"><span>Count my time and keep to these limits</span>
        <label class="toggle"><input type="checkbox" id="db-enabled" aria-label="Distraction budget on"${s.enabled ? ' checked' : ''}><span class="toggle-slider"></span></label></div>
      <div id="db-rows">${rows}</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button id="db-save" class="btn-primary">Save limits</button>
        <button id="db-add-site" class="btn-secondary">Add a site to a category</button>
        <button id="db-reset-today" class="btn-secondary">Reset today</button>
      </div>
      <div id="db-custom" class="setting-info muted" style="margin-top:8px"></div>`;
    const custom = container.querySelector('#db-custom');
    const paintCustom = () => {
      const keys = Object.keys(this.state().custom);
      custom.textContent = keys.length ? 'Your sites: ' + keys.map(h => h + ' (' + this.LABELS[this.state().custom[h]].toLowerCase() + ')').join(', ') : '';
    };
    paintCustom();

    container.querySelector('#db-enabled').addEventListener('change', (e) => {
      s.enabled = e.target.checked;
      if (!this.save()) { s.enabled = !s.enabled; e.target.checked = s.enabled; window.showToast?.('Could not save the setting', 'error'); return; }
      window.showToast?.(s.enabled ? 'Distraction budget on' : 'Distraction budget off');
    });
    container.querySelector('#db-save').addEventListener('click', () => {
      container.querySelectorAll('#db-rows [data-cat]').forEach((row) => {
        const c = row.dataset.cat;
        const n = parseInt(row.querySelector('.db-limit').value, 10);
        if (Number.isFinite(n) && n > 0) s.limits[c] = Math.min(n, 1440); else delete s.limits[c];
        if (row.querySelector('.db-mode').value === 'block') s.modes[c] = 'block'; else delete s.modes[c];
      });
      const saved = this.save();
      window.showToast?.(saved ? 'Limits saved' : 'Limits could not be saved', saved ? undefined : 'error');
    });
    container.querySelector('#db-reset-today').addEventListener('click', async () => {
      const ok = await vexConfirm({ title: 'Reset today?', message: 'Today’s counted time goes back to zero for every category.', okLabel: 'Reset', danger: true });
      if (!ok) return;
      delete s.days[this.dayKey()];
      this._nudged = {};
      this.save();
      this.renderPanel(container);
    });
    container.querySelector('#db-add-site').addEventListener('click', async () => {
      const site = await vexPrompt({ title: 'Add a site', label: 'Site, for example example.com', placeholder: 'example.com', okLabel: 'Next' });
      if (site == null) return;
      const host = this.hostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(site).trim()) ? String(site).trim() : 'https://' + String(site).trim());
      if (!host) { window.showToast?.('That is not a site', 'error'); return; }
      const cat = await vexPrompt({ title: 'Which category?', label: this.CATEGORIES.join(', '), value: 'social', okLabel: 'Add' });
      if (cat == null) return;
      const c = String(cat).trim().toLowerCase();
      if (!this.CATEGORIES.includes(c)) { window.showToast?.('Choose one of: ' + this.CATEGORIES.join(', '), 'error'); return; }
      s.custom[host] = c;
      if (!this.save()) { delete s.custom[host]; window.showToast?.('Could not save the site', 'error'); return; }
      paintCustom();
      window.showToast?.(host + ' now counts as ' + this.LABELS[c].toLowerCase());
    });
  },
};

if (typeof window !== 'undefined') window.DistractionBudget = DistractionBudget;
if (typeof module !== 'undefined' && module.exports) module.exports = { DistractionBudget };
