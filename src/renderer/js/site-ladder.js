// === "This site is broken": the compatibility ladder ========================
//
// A site that does not work in Vex is usually held back by one of Vex's own
// per-site settings. This walks them one at a time, the least risky first,
// reloads the page after each and asks "Did that fix it?". The step that
// worked is kept as a normal per-site rule — the same store the site panel's
// switches and Settings › Site settings show — with an undo.
//
// It does NOT keep a second copy of anything. What it reads and writes:
//   ads, js, cookies, thirdParty   vex.siteRules (js/site-rules-ui.js)
//   a site's Boost (CSS/JS)        vex.boosts, a `paused` flag on the entry
//   forced dark mode               vex.forceDarkHosts
// and the one thing it owns: vex.siteFixes, a short list of what it changed
// per host, so a fix can be undone or tightened again. Bounded at MAX_FIXES.
//
// The ladder, in order, each tried ALONE (a "No" puts that step back before
// the next one, so a site is never left weaker than the step that fixed it):
//   1 ads        the ad and tracker blocker leaves this site alone
//   2 modifiers  this site's Boost and forced dark mode are paused
//   3 restrict   JavaScript, cookies and content from other sites are allowed
//                again where the site's rules turned them off
//   4 useragent  a different browser identity for this site — only where Vex
//                has a per-site identity; it does not, so this step is skipped
//   5 all        everything that applied, together — only when 2+ steps applied
//
// Not on offer where nothing is kept (a private window, an off-the-record
// tab, Tor): those would either not stick or would weaken anonymity.
//
// What is NOT a per-site switch and so is not on the ladder: fingerprint
// protection and HTTPS-Only are global settings, and the built-in site tweaks
// (HEVC mask, Discord visibility) have no host toggle.

const SiteLadder = (() => {
  const MAX_FIXES = 50;
  const KEY = 'vex.siteFixes';
  const RULE_KEYS = ['js', 'cookies', 'thirdParty', 'ads'];

  const STEPS = {
    ads:        { id: 'ads', name: 'Allow ads and trackers on this site', done: 'Ads and trackers are now allowed for {host}' },
    modifiers:  { id: 'modifiers', name: 'Pause this site’s Boost and forced dark mode', done: 'The Boost and forced dark mode are paused for {host}' },
    restrict:   { id: 'restrict', name: 'Allow what its rules turned off', done: 'What its rules turned off is allowed again for {host}' },
    useragent:  { id: 'useragent', name: 'Reload with a different browser identity', done: 'A different browser identity is used for {host}' },
    all:        { id: 'all', name: 'All of the above together', done: 'Everything that applied is relaxed together for {host}' },
  };
  const ORDER = ['ads', 'modifiers', 'restrict', 'useragent'];
  const KEYS_OF = { ads: ['ads'], restrict: ['js', 'cookies', 'thirdParty'] };

  const copyState = (s) => ({ rule: { ...(s.rule || {}) }, boostPaused: !!s.boostPaused, dark: !!s.dark });

  // Why the ladder is not offered, or '' when it is.
  function blockedReason(env) {
    if (!env || !env.web) return 'Open a website first.';
    if (env.tor) return 'This is a Tor tab. Nothing is kept in it, and loosening Vex’s protections there would weaken your anonymity. Open the site in a normal tab to try the fixes.';
    if (env.privateWindow) return 'This is a private window: a per-site fix is kept for every window, so it is tried from a normal window.';
    if (!env.canSave) return 'This tab keeps nothing, so a fix could not be kept. Try it from an ordinary tab.';
    return '';
  }

  // Which steps apply to the site as it is now, in ladder order.
  function plan(env, state) {
    if (blockedReason(env)) return [];
    const s = copyState(state);
    const single = [];
    if (env.adsGlobalOn !== false && s.rule.ads !== 'off') single.push('ads');
    if ((env.hasBoost && !s.boostPaused) || (s.dark && !env.darkGlobal)) single.push('modifiers');
    if (['js', 'cookies', 'thirdParty'].some(k => s.rule[k] === 'off')) single.push('restrict');
    if (env.siteUserAgent) single.push('useragent');
    // Only a combination when it is a different thing from a single step.
    return single.length >= 2 ? [...single, 'all'] : single;
  }

  // The state after relaxing one step (or all). Pure.
  function apply(state, id, env = {}) {
    let s = copyState(state);
    if (id === 'all') {
      for (const one of plan(env, state)) if (one !== 'all') s = apply(s, one, env);
      return s;
    }
    if (id === 'ads') s.rule.ads = 'off';
    else if (id === 'modifiers') { s.boostPaused = true; s.dark = false; }
    else if (id === 'restrict') for (const k of KEYS_OF.restrict) delete s.rule[k];
    else if (id !== 'useragent') throw new Error('Unknown step: ' + id);
    return s;
  }

  // Put one step back to what `prev` had. Pure.
  function tighten(state, prev, id) {
    let s = copyState(state);
    const p = copyState(prev);
    if (id === 'all') { for (const one of ['ads', 'modifiers', 'restrict']) s = tighten(s, prev, one); return s; }
    if (id === 'modifiers') { s.boostPaused = p.boostPaused; s.dark = p.dark; return s; }
    for (const k of KEYS_OF[id] || []) { if (p.rule[k] === 'off') s.rule[k] = 'off'; else delete s.rule[k]; }
    return s;
  }

  // What a state differs by from the one before, in words, one per step. Used
  // for the card that lists every relaxation, so none is silent.
  function relaxations(prev, now, host) {
    const out = [];
    const p = copyState(prev), n = copyState(now);
    if (n.rule.ads === 'off' && p.rule.ads !== 'off') out.push({ step: 'ads', text: `Ads and trackers are not blocked for ${host}` });
    if ((n.boostPaused && !p.boostPaused) || (!n.dark && p.dark)) {
      const bits = [];
      if (n.boostPaused && !p.boostPaused) bits.push('Its Boost');
      if (!n.dark && p.dark) bits.push('Forced dark mode');
      out.push({ step: 'modifiers', text: `${bits.join(' and ').replace(' and F', ' and forced')} ${bits.length > 1 ? 'are' : 'is'} paused for ${host}` });
    }
    const allowed = [['js', 'JavaScript'], ['cookies', 'Cookies'], ['thirdParty', 'Content from other sites']]
      .filter(([k]) => p.rule[k] === 'off' && n.rule[k] !== 'off').map(([, name]) => name);
    if (allowed.length) {
      const list = allowed.map((n, i) => (i === 0 || n === 'JavaScript') ? n : n.toLowerCase()).join(', ');
      out.push({ step: 'restrict', text: `${list} allowed again for ${host}` });
    }
    return out;
  }

  // The governing key: the rule that applies to the host (its own, or a parent
  // domain's — the most specific wins, as in main/site-rules.js), or the host.
  function governingKey(rules, host) {
    let best = null;
    for (const key of Object.keys(rules || {})) {
      if (host === key || host.endsWith('.' + key)) if (best == null || key.length > best.length) best = key;
    }
    return best || host;
  }

  // ---- the kept list ---------------------------------------------------------
  function cleanState(s) {
    const rule = {};
    for (const k of RULE_KEYS) if (s && s.rule && s.rule[k] === 'off') rule[k] = 'off';
    return { rule, boostPaused: !!(s && s.boostPaused), dark: !!(s && s.dark) };
  }
  function cleanFixes(raw) {
    const out = {};
    const rows = Object.entries(raw && typeof raw === 'object' ? raw : {})
      .map(([host, r]) => ({ host: String(host).toLowerCase(), r }))
      .filter(({ host, r }) => /^[a-z0-9.-]{1,253}$/.test(host) && r && typeof r === 'object' && Array.isArray(r.steps) && r.steps.length)
      .map(({ host, r }) => ({
        host,
        key: /^[a-z0-9.-]{1,253}$/.test(String(r.key || '')) ? String(r.key) : host,
        at: Number.isFinite(r.at) ? r.at : 0,
        steps: [...new Set(r.steps.filter(x => x === 'ads' || x === 'modifiers' || x === 'restrict' || x === 'useragent'))],
        prev: cleanState(r.prev),
      }))
      .filter(r => r.steps.length)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_FIXES);
    for (const r of rows) out[r.host] = { key: r.key, at: r.at, steps: r.steps, prev: r.prev };
    return out;
  }
  // Add or replace the fix for a host; the oldest go when the list is full.
  function remember(fixes, host, entry) {
    const next = { ...cleanFixes(fixes) };
    next[host] = entry;
    return cleanFixes(next);
  }
  function forget(fixes, host) {
    const next = { ...cleanFixes(fixes) };
    delete next[host];
    return next;
  }
  // The steps a fix is made of, from the ids one step names ('all' = every
  // step that applied).
  function stepsOf(id, env, state) {
    return id === 'all' ? plan(env, state).filter(x => x !== 'all') : [id];
  }

  function reportText(host, steps) {
    const names = { ads: 'allowing ads and trackers on this site', modifiers: 'pausing this site’s Boost and forced dark mode',
      restrict: 'allowing what its rules had turned off', useragent: 'using a different browser identity' };
    return `${host} did not work properly in Vex. It works after ${steps.map(s => names[s] || s).join(' and ')}. `
      + 'Vex’s other settings for this site were not changed.';
  }

  return { MAX_FIXES, KEY, STEPS, ORDER, blockedReason, plan, apply, tighten, relaxations, governingKey, cleanFixes, remember, forget, stepsOf, reportText, copyState };
})();

// ============================================================================
// The window side: reading and writing the real stores, the reload, and the
// card that asks "Did that fix it?".
// ============================================================================
Object.assign(SiteLadder, {
  _flow: null,     // the ladder in progress: { ctx, key, host, prev, env, queue, index, applied, tabId }
  _el: null,

  // ---- the real stores ---------------------------------------------------------
  fixes() {
    try { return this.cleanFixes(JSON.parse(localStorage.getItem(this.KEY) || '{}')); } catch { return {}; }
  },
  _saveFixes(fixes) {
    try { localStorage.setItem(this.KEY, JSON.stringify(fixes)); } catch (err) { throw new Error('Could not keep what was fixed: ' + err.message); }
  },

  _env(c) {
    return { web: c.web, tor: c.tor || c.torRoute, privateWindow: c.privateWindow, canSave: c.canSave };
  },

  async _read(c, key) {
    if (typeof SiteRulesUI === 'undefined') throw new Error('The per-site switches are not loaded');
    const rules = SiteRulesUI.rules();
    const boost = typeof VexBoosts !== 'undefined' && VexBoosts.boosts ? VexBoosts.boosts[c.host] : null;
    const darkGlobal = (() => { try { return localStorage.getItem('vex.forceDarkSites') === 'true'; } catch { return false; } })();
    const dark = typeof WebviewManager !== 'undefined' && WebviewManager._forceDarkHosts ? WebviewManager._forceDarkHosts().has(c.host) : false;
    let adsGlobalOn = true;
    try { adsGlobalOn = (await window.vex.getAdBlockerState()) !== false; } catch (err) { throw new Error('Could not read whether the ad blocker is on: ' + err.message); }
    return {
      state: { rule: { ...(rules[key] || {}) }, boostPaused: !!(boost && boost.paused), dark },
      env: { ...this._env(c), adsGlobalOn, hasBoost: !!boost, darkGlobal, siteUserAgent: false },
    };
  },

  // Make the stores say `state`. Returns whether the tab has to be built
  // again (JavaScript went from off to on: that is decided when the page is made).
  async _write(c, key, state, before) {
    const rules = SiteRulesUI.rules();
    const rule = this.copyState(state).rule;
    const hadJsOff = !!(before.rule && before.rule.js === 'off');
    if (Object.keys(rule).length) rules[key] = rule; else delete rules[key];
    SiteRulesUI.save(rules);
    await SiteRulesUI.push();
    if (typeof VexBoosts !== 'undefined' && VexBoosts.boosts && Object.hasOwn(VexBoosts.boosts, c.host) && !!VexBoosts.boosts[c.host].paused !== state.boostPaused) {
      if (state.boostPaused) VexBoosts.boosts[c.host].paused = true; else delete VexBoosts.boosts[c.host].paused;
      if (!VexBoosts.save()) throw new Error('Could not save the Boost change');
      VexBoosts.refreshHost(c.host);
    }
    if (!!before.dark !== !!state.dark && typeof WebviewManager !== 'undefined') {
      const hosts = WebviewManager._forceDarkHosts();
      if (state.dark) hosts.add(c.host); else hosts.delete(c.host);
      try { localStorage.setItem('vex.forceDarkHosts', JSON.stringify([...hosts])); } catch (err) { throw new Error('Could not save dark mode: ' + err.message); }
    }
    return hadJsOff !== (rule.js === 'off');
  },

  _reload(c, rebuild) {
    const tabs = typeof TabManager !== 'undefined' ? TabManager : null;
    if (!tabs) throw new Error('Tabs are not loaded');
    if (rebuild) { tabs.rebuildTab(c.tab.id); return; }
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(c.tab.id) : null;
    if (!wv) throw new Error('The page is not loaded, so it could not be reloaded');
    wv.reload();
  },

  // ---- the flow ------------------------------------------------------------------
  async start(forTab = null) {
    if (typeof SitePanel === 'undefined') throw new Error('The site panel is not loaded');
    if (this._flow) { this._focusCard(); return; }
    const c = SitePanel.context(forTab);
    const why = this.blockedReason({ ...this._env(c), web: c.web });
    if (why) throw new Error(why);
    const key = this.governingKey(SiteRulesUI.rules(), c.host);
    const { state, env } = await this._read(c, key);
    const queue = this.plan(env, state);
    if (!queue.length) { this._card({ kind: 'none', host: c.host }); return; }
    this._flow = { c, key, host: c.host, prev: this.copyState(state), env, queue, index: 0, tabId: c.tab.id, current: this.copyState(state) };
    await this._try();
  },

  async _try() {
    const f = this._flow;
    const id = f.queue[f.index];
    const next = this.apply(f.prev, id, f.env);
    const rebuild = (await this._write(f.c, f.key, next, f.current)) || !!f.pendingRebuild;
    f.pendingRebuild = false;
    f.current = next;
    f.stepId = id;
    this._reload(f.c, rebuild);
    this._card({ kind: 'ask', host: f.host, key: f.key, step: f.index + 1, of: f.queue.length, id, last: f.index === f.queue.length - 1 });
  },

  // Put every relaxation made so far back.
  async _putBack() {
    const f = this._flow;
    if (!f) return;
    const rebuild = await this._write(f.c, f.key, f.prev, f.current);
    f.current = this.copyState(f.prev);
    this._reload(f.c, rebuild);
  },

  async answer(yes) {
    const f = this._flow;
    if (!f) return;
    if (yes) {
      const steps = this.stepsOf(f.stepId, f.env, f.prev);
      const next = this.remember(this.fixes(), f.host, { key: f.key, at: Date.now(), steps, prev: f.prev });
      this._saveFixes(next);
      const rows = this.relaxations(f.prev, f.current, f.host);
      this._flow = null;
      this._card({ kind: 'fixed', host: f.host, rows, steps });
      return;
    }
    // No: this step goes back before the next one is tried.
    const rebuild = await this._write(f.c, f.key, f.prev, f.current);
    f.current = this.copyState(f.prev);
    if (f.index + 1 < f.queue.length) {
      f.index += 1;
      f.pendingRebuild = rebuild;
      await this._try();
      return;
    }
    this._reload(f.c, rebuild);
    this._flow = null;
    this._card({ kind: 'nothing', host: f.host });
  },

  async stop() {
    const f = this._flow;
    if (!f) { this._close(); return; }
    await this._putBack();
    this._flow = null;
    this._close();
    window.showToast?.('Put back the way it was on ' + f.host);
  },

  // ---- a kept fix: tighten one step, or undo it all --------------------------------
  async _rebuildFromRecord(host, steps) {
    const rec = this.fixes()[host];
    if (!rec) throw new Error('There is no kept fix for ' + host);
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab) throw new Error('There is no tab open');
    const c = SitePanel.context(tab);
    const { state } = await this._read({ ...c, host }, rec.key);
    let next = state;
    for (const s of steps) next = this.tighten(next, rec.prev, s);
    const rebuild = await this._write({ ...c, host }, rec.key, next, state);
    const left = rec.steps.filter(s => !steps.includes(s));
    const fixes = this.fixes();
    if (left.length) fixes[host] = { ...rec, steps: left }; else delete fixes[host];
    this._saveFixes(fixes);
    if (c.web && (c.host === host)) { try { this._reload(c, rebuild); } catch (err) { window.showToast?.('Changed, but the page could not reload: ' + err.message, 'error'); } }
    if (next.rule.cookies === 'off' && state.rule.cookies !== 'off') await SiteRulesUI.sweep('https://' + host + '/', c.partition);
    return left;
  },

  async tightenStep(host, step) {
    const left = await this._rebuildFromRecord(host, [step]);
    window.showToast?.('Tightened again on ' + host);
    return left;
  },
  async undo(host) {
    const rec = this.fixes()[host];
    if (!rec) throw new Error('There is no kept fix for ' + host);
    await this._rebuildFromRecord(host, rec.steps);
    window.showToast?.('Put back the way it was on ' + host);
  },

  // ---- the card -------------------------------------------------------------------
  _close() {
    if (this._el) this._el.remove();
    this._el = null;
  },
  _focusCard() { const b = this._el && this._el.querySelector('button'); if (b) b.focus(); },
  _esc(s) { return window.escapeHtml(String(s == null ? '' : s)); },

  showKept(host) {
    const rec = this.fixes()[host];
    if (!rec) throw new Error('There is no kept fix for ' + host);
    this._card({ kind: 'kept', host, steps: rec.steps, rows: rec.steps.map(s => ({ step: s, text: this.STEPS[s].done.replace('{host}', host) })) });
  },

  _card(m) {
    this._close();
    const el = document.createElement('div');
    el.className = 'slad-card';
    el.id = 'slad-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'slad-title');
    let title = '', body = '', actions = '';
    const btn = (act, label, cls = '') => `<button type="button" class="slad-btn ${cls}" data-act="${act}">${this._esc(label)}</button>`;
    if (m.kind === 'ask') {
      title = 'This site is broken';
      const words = this.STEPS[m.id].done.replace('{host}', m.host);
      body = `<p class="slad-note"><span>Step</span> ${m.step} <span>of</span> ${m.of}</p>
        <p>${this._esc(words)}</p>
        <p class="slad-note">The page was reloaded. Only this site is changed. If this does not fix it, Vex puts it back before trying the next thing.</p>${m.key !== m.host ? `<p class="slad-note">${this._esc('Its rule is kept for ' + m.key)}</p>` : ''}
        <p class="slad-q">Did that fix it?</p>`;
      actions = btn('yes', 'Yes, it works now', 'slad-primary') + btn('no', m.last ? 'No, put it back' : 'No, try the next thing') + btn('stop', 'Stop and put it back', 'slad-link');
    } else if (m.kind === 'fixed') {
      title = 'Fixed — and kept for ' + m.host;
      body = this._rowsHtml(m.rows, true)
        + '<p class="slad-note">This is kept as an ordinary rule for this site only. It shows in the site panel and in Settings › Site settings.</p>';
      actions = btn('report', 'Report to myself') + btn('undo', 'Undo this fix') + btn('close', 'Done', 'slad-primary');
    } else if (m.kind === 'kept') {
      title = 'What was changed for ' + m.host;
      body = this._rowsHtml(m.rows, true);
      actions = btn('report', 'Report to myself') + btn('undo', 'Undo this fix') + btn('close', 'Close', 'slad-primary');
    } else if (m.kind === 'nothing') {
      title = 'None of those fixed it';
      body = `<p>Everything is back the way it was.</p>
        <p>The problem is probably not one of Vex’s per-site settings.</p>
        <p class="slad-note">“Show This Site’s Browser Identity” in Ctrl+K shows whether the site is refusing Vex itself.</p>`;
      actions = btn('identity', 'Check browser identity') + btn('close', 'Close', 'slad-primary');
    } else {
      title = 'Nothing of Vex’s is holding this site back';
      body = `<p>${this._esc('Vex has nothing to relax for ' + m.host)}</p>
        <p>Its ad blocker is off or not in use, and it has no rule, Boost or forced dark mode.</p>
        <p class="slad-note">“Show This Site’s Browser Identity” in Ctrl+K shows whether the site is refusing Vex itself.</p>`;
      actions = btn('identity', 'Check browser identity') + btn('close', 'Close', 'slad-primary');
    }
    el.innerHTML = `<div class="slad-head"><span id="slad-title" class="slad-title">${this._esc(title)}</span></div><div class="slad-body">${body}</div><div class="slad-actions">${actions}</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      this._onAct(b.dataset.act, m, b).catch(err => {
        console.error('[SiteLadder]', err);
        window.showToast?.(err.message || String(err), 'error');
      });
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this._onAct(this._flow ? 'stop' : 'close', m).catch(err => window.showToast?.(err.message || String(err), 'error'));
    });
    document.body.appendChild(el);
    this._el = el;
    const first = el.querySelector('.slad-primary') || el.querySelector('button');
    if (first) first.focus();
  },

  // Every relaxation, each with its own "Tighten again".
  _rowsHtml(rows, withTighten) {
    if (!rows.length) return '';
    return '<ul class="slad-rows">' + rows.map(r => `<li><span>${this._esc(r.text)}</span>${withTighten
      ? `<button type="button" class="slad-btn slad-link" data-act="tighten" data-step="${this._esc(r.step)}">Tighten again</button>` : ''}</li>`).join('') + '</ul>';
  },

  async _onAct(act, m, btnEl) {
    if (act === 'yes') return this.answer(true);
    if (act === 'no') return this.answer(false);
    if (act === 'stop') return this.stop();
    if (act === 'close') { this._close(); return; }
    if (act === 'undo') { await this.undo(m.host); this._close(); return; }
    if (act === 'tighten') {
      const step = btnEl && btnEl.dataset ? btnEl.dataset.step : '';
      if (!step) throw new Error('Which step to tighten is unknown');
      const left = await this.tightenStep(m.host, step);
      if (left.length) this.showKept(m.host); else this._close();
      return;
    }
    if (act === 'report') {
      const text = this.reportText(m.host, m.steps || []);
      await navigator.clipboard.writeText(text);
      window.showToast?.('Report copied: paste it where you keep notes');
      return;
    }
    if (act === 'identity') {
      this._close();
      if (typeof SiteIdentity === 'undefined') throw new Error('Site identity is not loaded');
      SiteIdentity.open();
      return;
    }
    throw new Error('Unknown action: ' + act);
  },

  init() {
    // Leaving the page (or closing the tab) in the middle puts it back: a
    // relaxation nobody answered for is never left in place.
    const away = () => {
      const f = this._flow;
      if (!f) return;
      const tab = typeof TabManager !== 'undefined' ? (TabManager.tabs || []).find(t => t.id === f.tabId) : null;
      let host = '';
      try { host = tab ? new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { host = ''; }
      const same = host && (host === f.host || host.endsWith('.' + f.host));
      if (tab && same && TabManager.activeTabId === f.tabId) return;
      this.stop().catch(err => window.VexProblems?.note('This site is broken', 'Could not put a site back after leaving it', err));
    };
    window.addEventListener('vex-tabs-changed', away);
    return this;
  },
});

if (typeof window !== 'undefined') window.SiteLadder = SiteLadder;
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteLadder };
