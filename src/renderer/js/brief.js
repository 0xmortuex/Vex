// === Morning Brief: the day, in sections ====================================
//
// The briefing on the New Tab page. today.js builds the snapshot the start
// page reads; this is the section registry that snapshot carries a "morning"
// part from. Every section is its own small module (js/brief-sections.js):
//
//   VexBrief.register({ id, title, icon, order, defaultOn, ttlMs, build(ctx) })
//
// build() answers a plain display payload, never HTML:
//   { summary?, stats?: [{label, value}], items?: [{text, sub?, url?, when?,
//     badge?, cmd?}], note?, action?: {label, cmd} }
// or null / an empty payload for "nothing here today".
//
// Rules this file keeps:
//   * One section failing (a throw, or no answer within TIMEOUT_MS) is written
//     into THAT section as an error and never blanks the others.
//   * Display data only. The start page has no bridge: what a click does is a
//     small command the browser handles (onStartCommand), and only commands
//     this file lists are accepted.
//   * A section that touches an account (mail) is off until the person turns
//     it on, and says so. Nothing it reads is sent anywhere new.
//   * Slow sections (mail, network) keep their last answer for ttlMs, so the
//     once-a-minute Today refresh does not call the mail server every minute.
//     The Refresh button on the page passes force.
const VexBrief = {
  PREFS_KEY: 'vex.brief.prefs',
  TIMEOUT_MS: 8000,
  _defs: new Map(),
  _cache: new Map(),
  _last: null,

  // ---- registry -----------------------------------------------------------
  register(def) {
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error('A brief section needs an id');
    if (typeof def.build !== 'function') throw new Error('Brief section "' + def.id + '" needs a build() function');
    this._defs.set(def.id, {
      title: def.id, icon: 'sparkles', order: 100, defaultOn: true, optIn: false, ttlMs: 0, ...def,
    });
    return def.id;
  },
  unregister(id) { this._defs.delete(id); this._cache.delete(id); },
  defs() { return [...this._defs.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); },
  get(id) { return this._defs.get(id) || null; },

  // ---- preferences --------------------------------------------------------
  // { v, enabled, order: [id], sections: { id: boolean }, mailAccounts: [id], mailAi }
  // A section with no saved choice follows its default, so a section added in
  // a later Vex appears for everyone whose choice was never recorded.
  defaults() { return { v: 1, enabled: true, order: [], sections: {}, mailAccounts: [], mailAi: false }; },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREFS_KEY) || 'null'); } catch { raw = null; }
    const d = this.defaults();
    if (!raw || typeof raw !== 'object') return d;
    const ids = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 200) : []);
    const sections = {};
    if (raw.sections && typeof raw.sections === 'object') for (const [k, v] of Object.entries(raw.sections)) if (typeof v === 'boolean') sections[k] = v;
    return { v: 1, enabled: raw.enabled !== false, order: ids(raw.order), sections, mailAccounts: ids(raw.mailAccounts), mailAi: raw.mailAi === true };
  },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(next));
    this._cache.clear();
    this._changed();
    return next;
  },
  isEnabled(id, prefs = this.prefs()) {
    const def = this._defs.get(id);
    if (!def) return false;
    if (Object.prototype.hasOwnProperty.call(prefs.sections, id)) return prefs.sections[id];
    return def.defaultOn !== false && !def.optIn;
  },
  setEnabled(id, on) {
    if (!this._defs.has(id)) throw new Error('No such brief section: ' + id);
    const p = this.prefs();
    return this.setPrefs({ sections: { ...p.sections, [id]: !!on } });
  },
  // The saved order first, then every other section by its own order.
  orderedIds(prefs = this.prefs()) {
    const known = new Set(this._defs.keys());
    const out = prefs.order.filter((id, i) => known.has(id) && prefs.order.indexOf(id) === i);
    for (const d of this.defs()) if (!out.includes(d.id)) out.push(d.id);
    return out;
  },
  move(id, delta) {
    const ids = this.orderedIds();
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return ids;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.setPrefs({ order: ids });
    return ids;
  },
  reset() { try { localStorage.removeItem(this.PREFS_KEY); } catch { /* storage unavailable */ } this._cache.clear(); this._changed(); },
  _changed() { try { document.dispatchEvent(new CustomEvent('vex:brief-changed')); } catch { /* no document: a test */ } },

  // ---- the greeting -------------------------------------------------------
  greeting(now = Date.now()) {
    const d = new Date(now);
    const h = d.getHours();
    const word = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    let date = '';
    try { date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }); } catch { date = d.toDateString(); }
    return { text: word, date };
  },

  // ---- building -----------------------------------------------------------
  async _runOne(def, ctx) {
    const cached = this._cache.get(def.id);
    if (!ctx.force && def.ttlMs > 0 && cached && ctx.now - cached.at < def.ttlMs) return cached.value;
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('did not answer in time')), this.TIMEOUT_MS); });
    try {
      const out = await Promise.race([Promise.resolve().then(() => def.build(ctx)), timeout]);
      const value = this.normalise(def, out);
      if (def.ttlMs > 0) this._cache.set(def.id, { at: ctx.now, value });
      return value;
    } finally { clearTimeout(timer); }
  },

  // A payload is made safe to JSON and bounded: the page renders whatever it
  // is given, so what is given is cut to a size first.
  normalise(def, out) {
    const base = { id: def.id, title: def.title, icon: def.icon, status: 'ok' };
    if (!out || typeof out !== 'object') return { ...base, status: 'empty' };
    const str = (v, n) => (v == null ? '' : String(v).slice(0, n));
    const items = (Array.isArray(out.items) ? out.items : []).slice(0, def.maxItems || 6).map(it => ({
      text: str(it.text, 200), sub: str(it.sub, 200), url: /^https?:\/\//i.test(String(it.url || '')) ? str(it.url, 2048) : '',
      when: str(it.when, 40), badge: str(it.badge, 24), cmd: it.cmd && typeof it.cmd.type === 'string' ? it.cmd : null,
      // A drawn line for the page: up to 20 finite numbers, nothing else (the page builds the SVG itself).
      spark: Array.isArray(it.spark) ? it.spark.slice(-20).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 600000) : [],
      // Small buttons under a row: [{label, cmd}]. Each one is a command the browser answers.
      actions: (Array.isArray(it.actions) ? it.actions : []).filter(a => a && a.cmd && typeof a.cmd.type === 'string').slice(0, 4).map(a => ({ label: str(a.label, 30), cmd: a.cmd })),
    }));
    const stats = (Array.isArray(out.stats) ? out.stats : []).slice(0, 6).map(s => ({ label: str(s.label, 40), value: str(s.value, 24) }));
    const res = {
      ...base, summary: str(out.summary, 600), stats, items, note: str(out.note, 300),
      action: out.action && out.action.cmd && typeof out.action.cmd.type === 'string' ? { label: str(out.action.label, 30), cmd: out.action.cmd } : null,
    };
    if (out.hint) { res.status = 'hint'; res.hint = str(out.hint, 300); }
    else if (!res.summary && !items.length && !stats.length && !res.note) res.status = 'empty';
    return res;
  },

  // `snap` is today.js's snapshot (reminders, tasks, calendar, changed pages),
  // so the sections that only re-arrange it do not read it a second time.
  async build({ now = Date.now(), force = false, snap = null } = {}) {
    // Sections that other modules keep (brief extras, memory tools) join here.
    if (typeof BriefIntegration !== 'undefined') BriefIntegration.sync(this);
    const prefs = this.prefs();
    const out = { at: now, enabled: prefs.enabled, greeting: this.greeting(now), sections: [] };
    if (!prefs.enabled) return out;
    const ctx = { now, force, prefs, snap };
    const jobs = [];
    for (const id of this.orderedIds(prefs)) {
      if (!this.isEnabled(id, prefs)) continue;
      const def = this._defs.get(id);
      jobs.push(this._runOne(def, ctx).catch(err => ({ id: def.id, title: def.title, icon: def.icon, status: 'error', error: (err && err.message) || 'unavailable', items: [], stats: [] })));
    }
    out.sections = await Promise.all(jobs);
    this._last = out;
    return out;
  },

  // ---- Settings › Morning Brief -------------------------------------------
  renderSettings(container) {
    if (!container) return;
    if (typeof BriefIntegration !== 'undefined') BriefIntegration.sync(this);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const redraw = () => this.renderSettings(container);
    const toggle = (label, checked, onChange) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!checked; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { try { onChange(input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.((err && err.message) || String(err), 'error'); } });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', '', label), lab);
      return row;
    };
    const btn = (label, aria, fn, disabled) => {
      const b = el('button', 'btn-secondary', label); b.type = 'button'; b.disabled = !!disabled;
      b.setAttribute('aria-label', aria); b.style.cssText = 'min-width:32px;padding:2px 8px';
      b.addEventListener('click', fn);
      return b;
    };
    container.textContent = '';
    const p = this.prefs();
    container.appendChild(el('p', 'setting-info', 'The briefing at the top of the New Tab page. Each section reads only what Vex already holds. Choose what appears and in which order. Mail stays off until you pick an account.'));
    container.appendChild(toggle('Show the Morning Brief on the New Tab page', p.enabled, (on) => { this.setPrefs({ enabled: on }); this.refresh(true); }));
    const ids = this.orderedIds(p);
    ids.forEach((id, i) => {
      const def = this._defs.get(id);
      const row = el('div', 'setting-toggle-row');
      row.style.cssText = 'gap:6px';
      const name = el('span', '', def.title + (def.optIn ? ' (needs your permission)' : ''));
      name.style.flex = '1';
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = this.isEnabled(id, p); input.setAttribute('aria-label', def.title);
      input.addEventListener('change', () => { this.setEnabled(id, input.checked); this.refresh(true); redraw(); });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(name, btn('Up', 'Move ' + def.title + ' up', () => { this.move(id, -1); this.refresh(); redraw(); }, i === 0),
        btn('Down', 'Move ' + def.title + ' down', () => { this.move(id, 1); this.refresh(); redraw(); }, i === ids.length - 1), lab);
      container.appendChild(row);
    });

    // Mail: which accounts, and whether the local model may summarise them.
    if (this._defs.has('mail') && window.vex && window.vex.mail) {
      const box = el('div', 'setting-info');
      box.appendChild(el('div', '', 'Mail accounts in the brief'));
      container.appendChild(box);
      Promise.resolve(window.vex.mail.accounts()).then((r) => {
        if (!r || !r.ok) throw new Error((r && r.error) || 'Mail did not answer');
        if (!r.value.length) { box.appendChild(el('div', 'ain-muted', 'No mail account is connected. Add one in the Mail sheet.')); return; }
        for (const a of r.value) {
          box.appendChild(toggle(a.email || a.name, p.mailAccounts.includes(a.id), (on) => {
            const cur = this.prefs().mailAccounts.filter(x => x !== a.id);
            if (on) cur.push(a.id);
            this.setPrefs({ mailAccounts: cur });
            this.refresh(true);
          }));
        }
        box.appendChild(toggle('Summarise it with my local AI (Ollama or on-device). Subjects and sender names only, never sent to the cloud', p.mailAi, (on) => { this.setPrefs({ mailAi: on }); this.refresh(true); }));
      }).catch((err) => { box.appendChild(el('div', 'ain-muted', 'Could not list mail accounts: ' + ((err && err.message) || 'unavailable'))); });
    }

    const tools = el('div', 'setting-toggle-row');
    tools.append(btn('Refresh now', 'Refresh the Morning Brief', () => { this.refresh(true); window.showToast?.('Morning Brief refreshed'); }),
      btn('Reset order and choices', 'Reset the Morning Brief to its defaults', () => { this.reset(); this.refresh(true); redraw(); }));
    container.appendChild(tools);
  },

  // ---- commands from the start page ---------------------------------------
  // The page can only ask for these. Anything it names that was not in the
  // last snapshot it was given is refused.
  async onStartCommand(cmd, webview) {
    if (!cmd || typeof cmd.type !== 'string') return;
    try {
      if (cmd.type === 'brief-refresh') { await this.refresh(true); return; }
      if (cmd.type === 'brief-settings') {
        if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('settings-brief');
        return;
      }
      if (cmd.type === 'brief-resume') {
        if (!this._offered('session', cmd.id)) throw new Error('That session is no longer on offer');
        if (typeof SessionManager === 'undefined') throw new Error('Sessions are not loaded');
        await SessionManager.restoreSession(cmd.id, false);
        return;
      }
      if (cmd.type === 'brief-open-file') {
        if (!this._offered('file', cmd.path)) throw new Error('That file is no longer on offer');
        if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
        const url = encodeURI('file:///' + String(cmd.path).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
        TabManager.createTab(url, true);
        return;
      }
      if (cmd.type === 'brief-action') {
        // A button a section drew (snooze, dismiss, play...). Only keys the last build handed out run.
        if (!this._offered('action', cmd.key)) throw new Error('That action is no longer on offer. Refresh the brief.');
        if (typeof BriefIntegration === 'undefined') throw new Error('Brief actions are not loaded');
        await BriefIntegration.runAction(cmd.key);
        return;
      }
      if (cmd.type === 'brief-open-url') {
        if (!this._offered('url', cmd.url)) throw new Error('That address is not on offer');
        if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
        TabManager.createTab(cmd.url, true);
        return;
      }
      if (cmd.type === 'autopilot-open') {
        // The Autopilot card's button (js/autopilot.js). Only offered when the last build listed it.
        if (!this._offered('autopilot', 'autopilot-open')) throw new Error('Autopilot is not on offer');
        if (typeof VexAutopilot === 'undefined') throw new Error('Autopilot is not loaded');
        // Autopilot listens for this and opens its own panel (js/autopilot.js).
        document.dispatchEvent(new CustomEvent('vex:autopilot-open'));
        return;
      }
      if (cmd.type === 'brief-open-panel' && typeof cmd.panel === 'string') {
        if (!this._offered('panel', cmd.panel)) throw new Error('That panel is not on offer');
        if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel(cmd.panel);
      }
    } catch (err) {
      window.showToast?.((err && err.message) || String(err), 'error');
    }
  },
  // Whether a command target appears in the snapshot last built.
  _offered(kind, value) {
    const secs = (this._last && this._last.sections) || [];
    const hit = (c) => c && c.type && (
      (kind === 'session' && c.type === 'brief-resume' && c.id === value) ||
      (kind === 'file' && c.type === 'brief-open-file' && c.path === value) ||
      (kind === 'action' && c.type === 'brief-action' && c.key === value) ||
      (kind === 'autopilot' && c.type === 'autopilot-open') ||
      (kind === 'url' && c.type === 'brief-open-url' && c.url === value && /^https?:\/\//i.test(String(value))) ||
      (kind === 'panel' && c.type === 'brief-open-panel' && c.panel === value));
    return secs.some(s => (s.items || []).some(i => hit(i.cmd) || (i.actions || []).some(a => hit(a.cmd))) || hit(s.action && s.action.cmd));
  },

  // Rebuild and hand to the open start pages (through VexToday, which owns the push).
  async refresh(force = false) {
    if (typeof VexToday !== 'undefined' && typeof VexToday.refresh === 'function') {
      this._force = !!force;
      try { return await VexToday.refresh(); } finally { this._force = false; }
    }
    return this.build({ force });
  },
};

if (typeof window !== 'undefined') window.VexBrief = VexBrief;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBrief };
