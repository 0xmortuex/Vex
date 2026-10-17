// === Focus profiles: Work, Study, Gaming — switched by the clock or a game ====
//
// Built on Focus Flows (js/focus-flows.js), which already is the profile: its
// tabs, AI persona, dimmed UI and blocked sites. This adds the two things it
// lacked:
//
//   WHEN   a rule per flow — weekdays, a time window, and/or "while a game from
//          your Game mode list runs". Checked once a minute; switched on only
//          when Settings › Workflow › "Switch focus profiles by itself" is on.
//   MORE   what a flow also sets: a theme (for as long as it is active, never
//          saved over your own), a tab group for the tabs already open on its
//          sites, and the side panels it brings forward.
//
// Rules and extras live apart from the flows (vex.focusProfiles) so a flow
// saved before this existed is untouched. An automatic switch never opens
// tabs by itself — only what is already open is grouped — and never replaces a
// flow you started yourself. Ending one you did not start is respected: it is
// not switched on again until its rule has stopped matching.
const FocusProfiles = {
  KEY: 'vex.focusProfiles',
  _app: '',            // the Game mode app running now, or ''
  _game: false,
  _auto: null,         // { flowId } while the active flow was switched on here
  _held: new Set(),    // flows ended by hand while their rule still matched
  _undo: null,         // what the extras changed: { theme, groupId }
  _job: null,

  PRESETS: [
    { id: 'work', name: 'Work', rule: { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }, group: 'Work', dim: false, block: true },
    { id: 'study', name: 'Study', rule: { days: [1, 2, 3, 4], from: '18:00', to: '21:00' }, group: 'Study', dim: true, block: true },
    { id: 'gaming', name: 'Gaming', rule: { anyGame: true }, theme: 'cyberpunk', dim: false, block: false },
  ],

  enabled() { return window.VexWorkflow.pref('focusAuto', false) === true; },

  _all() {
    try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch { return {}; }
  },
  _saveAll(o) { try { localStorage.setItem(this.KEY, JSON.stringify(o)); return true; } catch { return false; } },
  ruleOf(flowId) { return this._all()[flowId] || null; },
  setRule(flowId, cfg) {
    const all = this._all();
    if (cfg) all[flowId] = cfg; else delete all[flowId];
    return this._saveAll(all);
  },

  _minutes(hhmm) { const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; },

  // Does a rule hold at this moment? Every part the rule names must hold. A
  // window that crosses midnight (22:00 - 02:00) belongs to the day it began.
  matches(rule, now = new Date(), state = { game: this._game, app: this._app }) {
    if (!rule || typeof rule !== 'object') return false;
    const hasTime = rule.from && rule.to;
    const hasDays = Array.isArray(rule.days) && rule.days.length;
    const apps = Array.isArray(rule.apps) ? rule.apps.map(s => String(s).trim().toLowerCase()).filter(Boolean) : [];
    if (!hasTime && !hasDays && !apps.length && !rule.anyGame) return false;
    if (rule.anyGame && !state.game) return false;
    if (apps.length && !apps.includes(String(state.app || '').toLowerCase())) return false;
    const mins = now.getHours() * 60 + now.getMinutes();
    let day = now.getDay();
    if (hasTime) {
      const f = this._minutes(rule.from), t = this._minutes(rule.to);
      if (f == null || t == null) return false;
      if (f <= t) { if (mins < f || mins >= t) return false; }
      else if (mins >= f) { /* evening part: today's day */ }
      else if (mins < t) { day = (day + 6) % 7; }
      else return false;
    }
    if (hasDays && !rule.days.includes(day)) return false;
    return true;
  },

  // The first flow whose rule holds now, or null.
  current(now = new Date()) {
    if (typeof FocusFlows === 'undefined') return null;
    const rules = this._all();
    return FocusFlows._load().find(f => rules[f.id] && this.matches(rules[f.id], now)) || null;
  },

  // ---- what a flow also sets ------------------------------------------------
  applyExtras(flow, source) {
    try {
      source = source || flow;
      const cfg = this.ruleOf(flow && flow.id);
      if (!cfg) return;
      this.revertExtras();
      const undo = {};
      if (cfg.theme && typeof ThemeManager !== 'undefined') {
        undo.theme = ThemeManager.getCurrentTheme();
        // persist:false — the look comes back with the profile, never saved over yours.
        ThemeManager.applyTheme(cfg.theme, { persist: false });
      }
      if (cfg.group && typeof TabManager !== 'undefined' && typeof AgentTools !== 'undefined' && typeof AgentTools.groupTabs === 'function') {
        const hosts = (source.openTabs || []).map(u => FocusFlows._host(u)).filter(Boolean);
        const ids = TabManager.tabs.filter(t => {
          if (!window.VexTabPolicy.canShareTab(t)) return false;
          const h = FocusFlows._host(t.url);
          return h && hosts.some(x => h === x || h.endsWith('.' + x));
        }).map(t => t.id);
        if (ids.length) { try { AgentTools.groupTabs(cfg.group, ids); undo.group = cfg.group; } catch (err) { window.VexProblems?.note('Focus profile', 'Could not group the tabs', err); } }
      }
      if (Array.isArray(cfg.panels) && cfg.panels.length && typeof SidebarManager !== 'undefined') {
        try {
          SidebarManager.showPanel(cfg.panels[0]);
          if (cfg.panels[1] && typeof SidebarManager.openBeside === 'function') SidebarManager.openBeside(cfg.panels[1]);
        } catch (err) { window.VexProblems?.note('Focus profile', 'Could not open the panels', err); }
      }
      this._undo = undo;
    } catch (err) { window.VexProblems?.note('Focus profile', 'Could not apply the profile', err); }
  },

  revertExtras() {
    const u = this._undo; this._undo = null;
    if (!u) return;
    try { if (u.theme && typeof ThemeManager !== 'undefined') ThemeManager.applyTheme(u.theme, { persist: false }); }
    catch (err) { window.VexProblems?.note('Focus profile', 'Could not put the theme back', err); }
  },

  // Called by FocusFlows.end() for any end, so a flow ended by hand while its
  // rule still matches is held off.
  onEnded(flowId) {
    const byRule = this._endingByRule;
    this.revertExtras();
    if (!byRule && flowId && this._auto && this._auto.flowId === flowId) this._held.add(flowId);
    this._auto = null;
  },

  // ---- the minute check -------------------------------------------------------
  evaluate(now = new Date()) {
    if (!this.enabled() || typeof FocusFlows === 'undefined') return null;
    const rules = this._all();
    // A held flow whose rule has stopped matching is free again.
    for (const id of [...this._held]) { if (!rules[id] || !this.matches(rules[id], now)) this._held.delete(id); }
    const want = this.current(now);
    const active = FocusFlows._active && FocusFlows._active.flow;
    if (this._auto && active && this._auto.flowId === active.id) {
      if (!want || want.id !== active.id) {
        this._endingByRule = true;
        try { FocusFlows.end(); } finally { this._endingByRule = false; }   // onEnded(…) runs from the hook
      }
      return null;
    }
    if (active) return null;                       // yours, or another: left alone
    if (!want || this._held.has(want.id)) return null;
    this._auto = { flowId: want.id };
    // No tabs are opened by a switch nobody asked for.
    FocusFlows.activate({ ...want, openTabs: [] }, { source: want });
    return want;
  },

  // A game that Game Control Center reported (js/gcc-bridge.js) and the process
  // watcher did not: the rules see it like any other game.
  setExternalGame(on, app) {
    this._game = !!on;
    this._app = on ? String(app || '') : '';
    return this.evaluate();
  },

  _wire() {
    if (this._wired) return;
    this._wired = true;
    const b = window.vex;
    if (b && typeof b.onGameState === 'function') {
      b.onGameState((s) => { this._game = !!(s && s.game); this._app = s && s.game ? String(s.app || '') : ''; this.evaluate(); });
    }
    if (b && typeof b.gameState === 'function') {
      Promise.resolve(b.gameState()).then((s) => { if (s && s.game) { this._game = true; this._app = String(s.app || ''); } }).catch(() => {});
    }
  },

  init() {
    this._wire();
    if (!this._job && typeof VexJobs !== 'undefined') this._job = VexJobs.every('Focus profiles', 60000, () => this.evaluate(), { when: 'background' });
    return true;
  },

  snapshot() {
    const flows = typeof FocusFlows !== 'undefined' ? FocusFlows._load() : [];
    const rules = this._all();
    const active = typeof FocusFlows !== 'undefined' && FocusFlows._active ? FocusFlows._active.flow : null;
    const want = this.current();
    return {
      autoSwitch: this.enabled(),
      active: active ? { id: active.id, name: active.name, byRule: !!(this._auto && this._auto.flowId === active.id) } : null,
      matchingNow: want ? { id: want.id, name: want.name } : null,
      profiles: flows.filter(f => rules[f.id]).map(f => ({ id: f.id, name: f.name, rule: rules[f.id] })),
    };
  },

  // ---- Settings -------------------------------------------------------------------
  describeRule(r) {
    if (!r) return 'No rule';
    const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const bits = [];
    if (Array.isArray(r.days) && r.days.length) bits.push(r.days.slice().sort().map(d => D[d]).join(' '));
    if (r.from && r.to) bits.push(r.from + '–' + r.to);
    if (r.anyGame) bits.push('while a game runs');
    if (Array.isArray(r.apps) && r.apps.length) bits.push('while ' + r.apps.join(', ') + ' runs');
    return bits.join(' · ') || 'No rule';
  },

  render(box) {
    box.appendChild(window.VexWorkflow.toggleRow('Switch focus profiles by itself', 'by weekday, time, or a running game', this.enabled(), (on) => {
      if (!window.VexWorkflow.setPref('focusAuto', on)) window.showToast?.('The choice could not be saved', 'error');
      if (on) this.init();
    }));
    const note = document.createElement('div');
    note.className = 'setting-info muted';
    note.style.cssText = 'font-size:11.5px;margin:2px 0 6px';
    note.textContent = 'A profile is a Focus Flow with a rule. A switch never opens tabs, and never replaces a flow you started. "Running game" means the games on your Game mode list.';
    box.appendChild(note);
    const flows = typeof FocusFlows !== 'undefined' ? FocusFlows._load() : [];
    const rules = this._all();
    for (const f of flows) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const sp = document.createElement('span');
      sp.textContent = f.name + ' · ' + this.describeRule(rules[f.id]);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn-secondary'; btn.textContent = rules[f.id] ? 'Edit rule' : 'Add rule';
      btn.addEventListener('click', () => this.editRule(f, () => this.renderAgain(box)));
      row.append(sp, btn);
      box.appendChild(row);
    }
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn-secondary'; add.style.marginTop = '6px';
    add.textContent = 'Add Work, Study and Gaming profiles';
    add.addEventListener('click', () => this.addPresets().then(() => this.renderAgain(box)).catch(err => window.showToast?.(err.message, 'error')));
    box.appendChild(add);
  },
  renderAgain(box) { box.textContent = ''; this.render(box); },

  async addPresets() {
    if (typeof FocusFlows === 'undefined') throw new Error('Focus Flows are not available');
    const flows = FocusFlows._load();
    const fresh = this.PRESETS.filter(p => !flows.some(f => f.name.toLowerCase() === p.name.toLowerCase()));
    if (!fresh.length) { window.showToast?.('Work, Study and Gaming are already there', 'info'); return; }
    const ok = await window.vexConfirm({
      title: 'Add ' + fresh.map(p => p.name).join(', ') + '?',
      message: 'They are added to Focus Flows with a rule each. Nothing switches until "Switch focus profiles by itself" is on. Edit or delete them any time.',
      okLabel: 'Add',
    });
    if (!ok) return;
    const block = (typeof FocusMode !== 'undefined' ? FocusMode.blocklist() : []).slice();
    const rules = this._all();
    for (const p of fresh) {
      const id = 'flow-' + p.id + '-' + Date.now().toString(36);
      flows.unshift({ id, name: p.name, emoji: '', openTabs: [], persona: null, dimUI: !!p.dim, blockSites: p.block ? block : [] });
      rules[id] = { ...p.rule, ...(p.theme ? { theme: p.theme } : {}), ...(p.group ? { group: p.group } : {}) };
    }
    FocusFlows._save(flows);
    if (!this._saveAll(rules)) throw new Error('The rules could not be saved');
    window.showToast?.('Added ' + fresh.map(p => p.name).join(', '));
  },

  editRule(flow, done) {
    document.getElementById('vex-fp-edit')?.remove();
    const cur = this.ruleOf(flow.id) || {};
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const themes = (typeof ThemeManager !== 'undefined' && Array.isArray(ThemeManager.availableThemes)) ? ThemeManager.availableThemes : [];
    const m = document.createElement('div');
    m.id = 'vex-fp-edit';
    m.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Rule for ${esc(flow.name)}" style="width:440px;max-width:94vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,.5));color:var(--text);font-size:12.5px">
      <div style="font-size:15px;font-weight:700;margin-bottom:10px">Rule for ${esc(flow.name)}</div>
      <div style="margin-bottom:8px">Days <span style="color:var(--text-muted)">(none picked = every day)</span><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${D.map((d, i) => `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-day="${i}"${(cur.days || []).includes(i) ? ' checked' : ''}>${d}</label>`).join('')}</div></div>
      <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center">From <input class="set-input" type="time" id="fp-from" value="${esc(cur.from || '')}"> to <input class="set-input" type="time" id="fp-to" value="${esc(cur.to || '')}"></div>
      <label style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><input type="checkbox" id="fp-any"${cur.anyGame ? ' checked' : ''}> While any game on my Game mode list runs</label>
      <div style="margin-bottom:8px">Only while these games run <span style="color:var(--text-muted)">(names from the Game mode list, comma separated)</span><input class="set-input" id="fp-apps" style="width:100%;box-sizing:border-box;margin-top:4px" value="${esc((cur.apps || []).join(', '))}"></div>
      <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center">Theme <select class="set-input" id="fp-theme"><option value="">Keep mine</option>${themes.map(t => `<option value="${esc(t)}"${cur.theme === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div style="margin-bottom:8px">Group the tabs open on its sites as<input class="set-input" id="fp-group" style="width:100%;box-sizing:border-box;margin-top:4px" value="${esc(cur.group || '')}" placeholder="e.g. Work"></div>
      <div style="margin-bottom:12px">Panels to bring forward <span style="color:var(--text-muted)">(up to two, comma separated, e.g. notes, todo)</span><input class="set-input" id="fp-panels" style="width:100%;box-sizing:border-box;margin-top:4px" value="${esc((cur.panels || []).join(', '))}"></div>
      <div id="fp-err" style="color:var(--danger,#e5484d);min-height:16px;margin-bottom:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        ${this.ruleOf(flow.id) ? '<button type="button" class="btn-danger" id="fp-del">Remove rule</button>' : ''}
        <button type="button" class="btn-secondary" id="fp-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="fp-save">Save</button>
      </div></div>`;
    document.body.appendChild(m);
    if (typeof VexLayer !== 'undefined') VexLayer.track(m, { tier: 'dialog', id: 'focus-profiles' });
    const close = () => m.remove();
    const err = (s) => { m.querySelector('#fp-err').textContent = s; };
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    m.querySelector('#fp-cancel').addEventListener('click', close);
    m.querySelector('#fp-del')?.addEventListener('click', () => {
      if (!this.setRule(flow.id, null)) { err('Could not save'); return; }
      close(); if (done) done();
    });
    m.querySelector('#fp-save').addEventListener('click', () => {
      const list = (s) => String(s).split(',').map(x => x.trim()).filter(Boolean);
      const rule = {};
      const days = [...m.querySelectorAll('[data-day]')].filter(c => c.checked).map(c => +c.dataset.day);
      if (days.length) rule.days = days;
      const from = m.querySelector('#fp-from').value, to = m.querySelector('#fp-to').value;
      if (!!from !== !!to) { err('Give both a start and an end time, or neither'); return; }
      if (from && to) { if (from === to) { err('The start and end time are the same'); return; } rule.from = from; rule.to = to; }
      if (m.querySelector('#fp-any').checked) rule.anyGame = true;
      const apps = list(m.querySelector('#fp-apps').value);
      if (apps.length) rule.apps = apps;
      if (!rule.days && !rule.from && !rule.anyGame && !rule.apps) { err('Pick a day, a time or a game — a rule with none never matches'); return; }
      const theme = m.querySelector('#fp-theme').value;
      if (theme) rule.theme = theme;
      const group = m.querySelector('#fp-group').value.trim();
      if (group) rule.group = group.slice(0, 60);
      const panels = list(m.querySelector('#fp-panels').value).slice(0, 2);
      if (panels.length) rule.panels = panels;
      if (!this.setRule(flow.id, rule)) { err('Could not save the rule'); return; }
      close(); if (done) done();
    });
    m.querySelector('#fp-save').focus({ preventScroll: true });
  },
};

window.VexWorkflow.register({
  id: 'focus', title: 'Focus profiles', icon: 'target',
  render: (box) => FocusProfiles.render(box),
  snapshot: () => FocusProfiles.snapshot(),
});

if (typeof window !== 'undefined') window.FocusProfiles = FocusProfiles;
if (typeof module !== 'undefined' && module.exports) module.exports = { FocusProfiles };
