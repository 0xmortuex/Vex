// === Session-timeout warning: a site that logs you out, and Vex saying so first ====
//
// e-Devlet, school and exam portals, banks and long forms sign you out after a few idle minutes, and the first sign is the
// form you were halfway through being gone. The person tells Vex the site's idle timeout (site panel › "When this site signs
// you out"); Vex then
//
//   - counts the idle time of every tab on that site, from the last REAL click, key press or touch in it (the main process
//     reports those for pages it was asked about, throttled; nothing is polled in the page) or the last page load;
//   - shows a toast and a small countdown badge a couple of minutes before, and a note when the time has passed.
//
// That is all it does by default. A second, separate opt-in per site, "Stay signed in while this tab is open", also sends ONE
// small request from the page every few minutes:
//
//     fetch(location.href without its #fragment,
//           { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', redirect: 'manual' })
//
// i.e. the page asks its own server for the headers of the address it is already showing, with the cookies it already has,
// and ignores the answer apart from its status. No body is sent, no other host is asked, and it goes out as that page. It
// stops by itself when the tab has seen no real activity for 30 minutes, when the site answers it with a redirect (the site
// has signed you out; Vex says so once), and it never runs in a private window, a Tor tab or a tab that keeps nothing. Banks
// time out on purpose; this is for the page you are reading or filling in, and it is off until you switch it on for a site.
//
// The timing is a small pure state machine (createTimer) with an injected clock, tested with fake timers.
const VexSessionTimeout = {
  WARN_MS: 2 * 60 * 1000,          // how long before the timeout the warning comes
  IDLE_STOP_MS: 30 * 60 * 1000,    // keep-alive stops after this long without real activity in the tab
  KEEP_MAX_MS: 10 * 60 * 1000,     // keep-alive is asked for at least this often
  MIN_KEEP_MS: 15 * 1000,

  // The warning comes WARN_MS before, or half-way for a very short timeout.
  warnMsFor(timeoutMs) { return Math.min(this.WARN_MS, Math.floor(timeoutMs / 2)); },
  // Well inside the time before the warning, so a working keep-alive never lets the warning come.
  keepEveryFor(timeoutMs) { return Math.max(this.MIN_KEEP_MS, Math.min(this.KEEP_MAX_MS, Math.floor((timeoutMs - this.warnMsFor(timeoutMs)) / 2))); },

  // May Vex send a keep-alive from this tab at all? Not from a private window, a Tor tab, or a tab that keeps nothing
  // (burner / off-the-record / New Identity: their partitions are not 'persist:'), nor the Tor container route.
  keepAliveAllowed({ partition, privateWindow }) {
    if (privateWindow) return false;
    const p = String(partition || 'persist:main');
    if (!p.startsWith('persist:')) return false;
    if (p === 'persist:route-tor' || /^tor-/.test(p)) return false;
    return true;
  },

  // The one request, as the page's own script. Resolves to the status number, or 'redirect' when the site answered with a
  // redirect (it wants you to sign in again).
  keepAliveScript() {
    return "(async () => { const r = await fetch(location.href.split('#')[0], { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', redirect: 'manual' }); return r.type === 'opaqueredirect' ? 'redirect' : r.status; })()";
  },

  // -> a timer for one tab.
  //   timeoutMs   the site's idle timeout
  //   keepAlive   whether keep-alive is on for the site
  //   onWarn({ leftMs })  once, WARN_MS before the timeout
  //   onExpire()          once, at the timeout
  //   onKeepAlive()       due: send the request; resolve true when the site took it, false when it did not
  //   onKeepAliveStopped(reason)  'idle' (30 minutes without activity) or 'refused' (onKeepAlive resolved false)
  //   now / setTimer / clearTimer  injected, so a test owns the clock
  createTimer(opts) {
    const self = this;
    const now = opts.now || Date.now;
    const setT = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearT = opts.clearTimer || ((h) => clearTimeout(h));
    const timeoutMs = opts.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error('A session timeout needs at least a second');
    const warnMs = opts.warnMs == null ? self.warnMsFor(timeoutMs) : opts.warnMs;
    const keepEvery = opts.keepEveryMs == null ? self.keepEveryFor(timeoutMs) : opts.keepEveryMs;
    const idleStop = opts.idleStopMs == null ? self.IDLE_STOP_MS : opts.idleStopMs;
    let keepAlive = !!opts.keepAlive;
    let touchedAt = now();        // the site last heard from this tab (a click, a page load, a successful keep-alive)
    let activityAt = touchedAt;   // the person last did something in this tab
    let lastKeepTry = -Infinity;
    let phase = 'ok';             // ok -> warned -> expired
    let keepStopped = false;
    let handle = null;
    let stopped = false;
    let sending = false;

    const keepDueAt = () => (keepAlive && !keepStopped && !sending ? Math.max(touchedAt, lastKeepTry) + keepEvery : Infinity);
    const warnDueAt = () => (phase === 'ok' ? touchedAt + timeoutMs - warnMs : Infinity);
    const expireDueAt = () => (phase !== 'expired' ? touchedAt + timeoutMs : Infinity);

    function schedule() {
      if (handle !== null) { clearT(handle); handle = null; }
      if (stopped) return;
      const at = Math.min(keepDueAt(), warnDueAt(), expireDueAt());
      if (at === Infinity) return;
      handle = setT(fire, Math.max(0, at - now()));
    }

    function fire() {
      handle = null;
      if (stopped) return;
      const t = now();
      if (keepDueAt() <= t) {
        if (t - activityAt >= idleStop) {
          keepStopped = true;
          if (opts.onKeepAliveStopped) opts.onKeepAliveStopped('idle');
        } else {
          lastKeepTry = t;
          sending = true;
          Promise.resolve().then(() => opts.onKeepAlive()).then((ok) => {
            sending = false;
            if (stopped) return;
            if (ok) {
              touchedAt = now();
              if (phase !== 'ok') { phase = 'ok'; if (opts.onRecover) opts.onRecover(); }
            } else {
              keepStopped = true;
              if (opts.onKeepAliveStopped) opts.onKeepAliveStopped('refused');
            }
            schedule();
          }, (err) => {
            sending = false;
            if (stopped) return;
            keepStopped = true;
            if (opts.onKeepAliveStopped) opts.onKeepAliveStopped('refused', err);
            schedule();
          });
        }
      }
      if (warnDueAt() <= t) {
        phase = 'warned';
        opts.onWarn({ leftMs: Math.max(0, touchedAt + timeoutMs - t) });
      }
      if (expireDueAt() <= t) {
        phase = 'expired';
        opts.onExpire();
      }
      schedule();
    }

    const reset = () => {
      const was = phase;
      phase = 'ok';
      if (was !== 'ok' && opts.onRecover) opts.onRecover();
    };

    schedule();
    return {
      // A real click, key press or touch in the tab.
      activity() {
        if (stopped) return;
        activityAt = touchedAt = now();
        keepStopped = false;
        reset();
        schedule();
      },
      // The tab loaded a page from the site: the site heard from it.
      contact() {
        if (stopped) return;
        touchedAt = now();
        reset();
        schedule();
      },
      setKeepAlive(on) {
        keepAlive = !!on;
        if (!keepAlive) keepStopped = false;
        schedule();
      },
      // Whether keep-alive is running (on, and not stopped by idleness or the site).
      keepingAlive() { return keepAlive && !keepStopped; },
      leftMs() { return Math.max(0, touchedAt + timeoutMs - now()); },
      phase() { return phase; },
      stop() { stopped = true; if (handle !== null) { clearT(handle); handle = null; } },
    };
  },

  // ---- the window's side ---------------------------------------------------------------------
  _tabs: new Map(),     // tab id -> { timer, host, minutes, keepAlive, url }
  _tick: null,
  _bound: false,

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },
  _note(msg, err) { if (typeof window !== 'undefined' && window.VexProblems) window.VexProblems.note('Session timeout', msg, err); else console.error('[SessionTimeout] ' + msg, err); },

  // The idle-timeout rule for a page, from the per-site rules mirrored in this window.
  ruleFor(url) {
    if (typeof SiteRulesUI === 'undefined') return null;
    const rule = SiteRulesUI.forUrl(url);
    if (!rule || !Number.isInteger(rule.sessionMin) || rule.sessionMin < 1) return null;
    return { minutes: rule.sessionMin, keepAlive: rule.keepAlive === true };
  },

  _webview(tabId) { return typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tabId) : null; },
  _urlOf(tab) {
    const wv = this._webview(tab.id);
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || tab.url || ''; } catch { url = tab.url || ''; }
    return /^https?:/i.test(url) ? url : '';
  },
  _hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },

  // Make the running timers match the open tabs and the saved rules. Cheap, so it runs on every change that could matter.
  sync() {
    const tabs = typeof TabManager !== 'undefined' ? TabManager.tabs : [];
    const seen = new Set();
    const privateWindow = !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow);
    for (const tab of tabs) {
      const url = this._urlOf(tab);
      const rule = url ? this.ruleFor(url) : null;
      if (!rule) continue;
      seen.add(tab.id);
      const host = this._hostOf(url);
      const keepOk = this.keepAliveAllowed({ partition: tab.partition, privateWindow });
      const want = rule.keepAlive && keepOk;
      const cur = this._tabs.get(tab.id);
      if (cur && cur.host === host && cur.minutes === rule.minutes) {
        cur.url = url;
        cur.timer.setKeepAlive(want);
        continue;
      }
      if (cur) cur.timer.stop();
      const entry = { host, minutes: rule.minutes, url, tabId: tab.id, timer: null };
      entry.timer = this.createTimer({
        timeoutMs: rule.minutes * 60 * 1000,
        keepAlive: want,
        onWarn: ({ leftMs }) => this._warn(entry, leftMs),
        onExpire: () => this._expire(entry),
        onRecover: () => { this._paintBadge(); },
        onKeepAlive: () => this._keepAlive(entry),
        onKeepAliveStopped: (why) => this._keepStopped(entry, why),
      });
      this._tabs.set(tab.id, entry);
    }
    for (const [id, e] of this._tabs) if (!seen.has(id)) { e.timer.stop(); this._tabs.delete(id); }
    this._paintBadge();
  },

  _tabIdOfPage(pageId) {
    const tabs = typeof TabManager !== 'undefined' ? TabManager.tabs : [];
    for (const tab of tabs) {
      const wv = this._webview(tab.id);
      let id = null;
      try { id = wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null; } catch { id = null; }
      if (id === pageId) return tab.id;
    }
    return null;
  },

  activity(tabId) { const e = this._tabs.get(tabId); if (e) { e.timer.activity(); this._paintBadge(); } },
  contact(tabId) { const e = this._tabs.get(tabId); if (e) { e.timer.contact(); this._paintBadge(); } },

  _minutesText(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    return m === 1 ? this._t('1 minute') : this._t('{1} minutes').replace('{1}', String(m));
  },

  _warn(entry, leftMs) {
    const msg = this._t('{1} may sign you out in about {2}.').replace('{1}', entry.host).replace('{2}', this._minutesText(leftMs));
    const actions = [];
    if (this.keepAliveAllowed({ partition: this._partitionOf(entry.tabId), privateWindow: !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) })) {
      actions.push({ label: this._t('I am still here'), run: () => { this._stillHere(entry).catch(err => this._note('The request that keeps the page signed in did not work', err)); } });
    }
    if (typeof TabManager !== 'undefined' && TabManager.activeTabId !== entry.tabId) {
      actions.push({ label: this._t('Show the tab'), run: () => { TabManager.switchTab(entry.tabId); } });
    }
    window.showToast?.(msg, 'info', 15000, actions.length ? { actions } : undefined);
    this._startTick();
    this._paintBadge();
  },

  _expire(entry) {
    window.showToast?.(this._t('{1} has probably signed you out: {2} without any activity.').replace('{1}', entry.host).replace('{2}', this._minutesText(entry.minutes * 60000)), 'info', 12000);
    this._paintBadge();
  },

  _keepStopped(entry, why) {
    if (why === 'refused') {
      window.showToast?.(this._t('{1} answered with a redirect: it has probably signed you out. Vex stopped keeping it signed in.').replace('{1}', entry.host), 'info', 12000);
    }
    this._paintBadge();
  },

  _partitionOf(tabId) {
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
    return tab ? tab.partition : null;
  },

  // The request itself: runs in the page, as the page. -> true when the site took it.
  async _keepAlive(entry) {
    const wv = this._webview(entry.tabId);
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('The tab is not there to ask from');
    const url = this._urlOf({ id: entry.tabId, url: entry.url });
    if (!url || this._hostOf(url) !== entry.host) throw new Error('The tab is no longer on ' + entry.host);
    const answer = await wv.executeJavaScript(this.keepAliveScript());
    if (answer === 'redirect') return false;
    return typeof answer === 'number' && answer > 0 && answer < 400;
  },

  // "I am still here": the same request, once, on a press.
  async _stillHere(entry) {
    const ok = await this._keepAlive(entry);
    if (!ok) throw new Error(entry.host + ' did not accept it: it has probably signed you out already');
    entry.timer.contact();
    window.showToast?.(this._t('Asked {1} to keep the page signed in.').replace('{1}', entry.host), 'success');
    this._paintBadge();
  },

  // ---- the badge ------------------------------------------------------------------------------
  _startTick() {
    if (this._tick) return;
    if (typeof VexJobs === 'undefined') throw new Error('The countdown needs js/jobs.js');
    this._tick = VexJobs.every('session-timeout-badge', 1000, () => {
      const any = [...this._tabs.values()].some(e => e.timer.phase() !== 'ok');
      if (!any) { this._tick.stop(); this._tick = null; }
      this._paintBadge();
    }, { when: 'ui' });
  },

  _paintBadge() {
    if (typeof document === 'undefined') return;
    const active = typeof TabManager !== 'undefined' ? this._tabs.get(TabManager.activeTabId) : null;
    let el = document.getElementById('vex-session-badge');
    const phase = active ? active.timer.phase() : 'ok';
    if (!active || phase === 'ok') { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'vex-session-badge';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9000;padding:5px 10px;border-radius:999px;font-size:12px;background:var(--surface);color:var(--text);border:1px solid var(--border);box-shadow:0 4px 14px rgba(0,0,0,0.25);opacity:0.92;pointer-events:none';
      document.body.appendChild(el);
      // Known to the layer manager (js/vex-layer.js); it lives as long as the warning does, and takes no clicks.
      if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'chrome', id: 'session-timeout-badge', keep: true });
    }
    const left = active.timer.leftMs();
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = phase === 'expired'
      ? this._t('{1}: probably signed out').replace('{1}', active.host)
      : this._t('{1}: signs out in {2}').replace('{1}', active.host).replace('{2}', m + ':' + String(s).padStart(2, '0'));
  },

  // ---- wiring --------------------------------------------------------------------------------
  init() {
    if (this._bound) return this;
    this._bound = true;
    document.addEventListener('vex:tab-navigated', (e) => {
      this.sync();
      const id = e.detail && e.detail.tabId;
      if (id != null) this.contact(id);
    });
    window.addEventListener('vex-tabs-changed', () => this.sync());
    document.addEventListener('vex:site-rules-changed', () => this.sync());
    if (window.vex && typeof window.vex.onTabActivity === 'function') {
      window.vex.onTabActivity((msg) => {
        const tabId = msg && Number.isInteger(msg.pageId) ? this._tabIdOfPage(msg.pageId) : null;
        if (tabId != null) this.activity(tabId);
      });
    }
    this.sync();
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexSessionTimeout = VexSessionTimeout;
  // Read after start-up (lazy-boot): it only does anything for a site that has a timeout saved.
  if (typeof document !== 'undefined' && window.vex) {
    try { VexSessionTimeout.init(); } catch (err) { VexSessionTimeout._note('The session-timeout warning could not start', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSessionTimeout };
