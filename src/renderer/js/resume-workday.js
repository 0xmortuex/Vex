// === Resume workday + the VexWorkflow hub ===================================
//
// "End of day" saves the working set as one named session (SessionManager,
// js/sessions.js — tabs, groups, stacks, each tab's scroll position) and keeps
// the AI panel thread of the tab in front beside it. "Resume yesterday" opens
// that set again beside whatever is open and puts the thread back.
//
// Nothing new is stored for the tabs themselves: the session is an ordinary
// entry of the Sessions list (named "Workday 2026-10-15"), so it can be opened,
// renamed or deleted there. Only a small index (vex.workday) says which session
// is which day's, plus the thread. Private and Tor tabs are never in it
// (VexTabPolicy.snapshot), and a private window refuses to save.
//
// VexWorkflow is the hub every workflow feature registers its settings block
// and its small data hook with. VexWorkflow.snapshot() returns what each one
// has, for anything that wants to show it (the start page, a brief). It only
// reads; nothing here is wired into another page.
const VexWorkflow = {
  PREFS_KEY: 'vex.workflow.prefs',
  _blocks: [],   // { id, title, render(container), snapshot() }

  register(block) {
    if (!block || !block.id) throw new Error('VexWorkflow.register needs an id');
    this._blocks = this._blocks.filter(b => b.id !== block.id);
    this._blocks.push(block);
  },

  // ---- one small preferences object --------------------------------------
  _prefs() {
    try { const o = JSON.parse(localStorage.getItem(this.PREFS_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch { return {}; }
  },
  pref(key, fallback) { const p = this._prefs(); return Object.prototype.hasOwnProperty.call(p, key) ? p[key] : fallback; },
  // false when the write failed, so a caller never says it saved.
  setPref(key, value) {
    const p = this._prefs(); p[key] = value;
    try { localStorage.setItem(this.PREFS_KEY, JSON.stringify(p)); return true; } catch { return false; }
  },

  // ---- data hooks ---------------------------------------------------------
  // { workday: {...}, focus: {...}, ... } — each block's own small summary.
  snapshot() {
    const out = {};
    for (const b of this._blocks) {
      if (typeof b.snapshot !== 'function') continue;
      try { out[b.id] = b.snapshot(); } catch (err) { out[b.id] = { error: (err && err.message) || String(err) }; }
    }
    return out;
  },

  // ---- Settings -----------------------------------------------------------
  // A toggle row in the markup the rest of Settings uses.
  toggleRow(label, hint, checked, onChange) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const span = document.createElement('span');
    span.textContent = label;
    if (hint) {
      const h = document.createElement('span');
      h.style.cssText = 'color:var(--text-muted);font-size:11px';
      h.textContent = ' · ' + hint;
      span.appendChild(h);
    }
    const lab = document.createElement('label');
    lab.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.setAttribute('aria-label', label);
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    lab.append(input, slider);
    row.append(span, lab);
    input.addEventListener('change', () => onChange(input.checked, input));
    return row;
  },

  renderSettings(container) {
    if (!container) return;
    container.textContent = '';
    for (const b of this._blocks) {
      if (typeof b.render !== 'function') continue;
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-bottom:12px';
      const h = document.createElement('div');
      h.style.cssText = 'font-size:12px;font-weight:600;color:var(--text);margin:6px 0 4px;display:flex;align-items:center;gap:6px';
      h.innerHTML = (b.icon && window.VexIcons && VexIcons.has(b.icon) ? VexIcons.svg(b.icon, { size: 13 }) : '') + '<span></span>';
      h.lastChild.textContent = b.title || b.id;
      sec.appendChild(h);
      const body = document.createElement('div');
      sec.appendChild(body);
      try { b.render(body); }
      catch (err) { body.textContent = 'Could not show these settings: ' + ((err && err.message) || err); }
      container.appendChild(sec);
    }
  },

  // A command in the command bar; replaced by id, so a second init is harmless.
  addCommand(cmd) {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    CommandBar.commands = CommandBar.commands.filter(c => c.id !== cmd.id);
    CommandBar.commands.push(cmd);
    return true;
  },
};

const VexWorkday = {
  KEY: 'vex.workday',
  MAX_DAYS: 14,
  MAX_THREAD: 24,
  _job: null,

  enabled() { return VexWorkflow.pref('workday', true) !== false; },
  autoOn() { return VexWorkflow.pref('workdayAuto', false) === true; },
  autoTime() { const t = String(VexWorkflow.pref('workdayAutoTime', '18:00')); return /^\d{2}:\d{2}$/.test(t) ? t : '18:00'; },

  _all() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a.filter(d => d && d.date && d.sessionId) : []; }
    catch { return []; }
  },
  _save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX_DAYS))); return true; } catch { return false; }
  },
  _dateOf(ms) {
    const d = new Date(ms == null ? Date.now() : ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  // The newest saved day that is not today's (what "yesterday" means after a
  // weekend or a day off), or null.
  previous(today = this._dateOf()) {
    return this._all().find(d => d.date < today && this._sessionOf(d)) || null;
  },
  latest() { return this._all().find(d => this._sessionOf(d)) || null; },
  _sessionOf(day) {
    return (typeof SessionManager !== 'undefined' && Array.isArray(SessionManager.sessions))
      ? SessionManager.sessions.find(s => s.id === day.sessionId) || null : null;
  },

  // The AI panel thread of the tab in front: text only, as it was said, and
  // never from a tab the policy keeps private.
  _threadOfActive() {
    try {
      if (typeof AIPanel === 'undefined' || typeof TabManager === 'undefined') return null;
      const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      if (!tab || !window.VexTabPolicy.canShareTab(tab)) return null;
      const conv = AIPanel._conversations && AIPanel._conversations[tab.id];
      if (!Array.isArray(conv) || !conv.length) return null;
      const msgs = conv.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
        .slice(-this.MAX_THREAD).map(m => ({ role: m.role, content: m.content.slice(0, 4000), at: m.at || 0 }));
      return msgs.length ? { url: tab.url, title: tab.title || tab.url, msgs } : null;
    } catch (err) { window.VexProblems?.note('Workday', 'Could not read the AI thread', err); return null; }
  },

  // Save the working set. Throws (and says nothing itself) when it cannot, so
  // the caller shows the reason. `silent` is the timed save.
  endOfDay({ silent = false } = {}) {
    if (typeof SessionManager === 'undefined') throw new Error('Sessions are not available');
    const date = this._dateOf();
    const name = 'Workday ' + date;
    // One session a day: saving again replaces it.
    const old = this._all().find(d => d.date === date);
    if (old) SessionManager.sessions = SessionManager.sessions.filter(s => s.id !== old.sessionId);
    const session = SessionManager.saveCurrentSession(name);
    if (!session.tabs.length) throw new Error('There is nothing to save — no tab can be kept');
    session.workday = date;
    SessionManager.save();
    const day = { date, sessionId: session.id, savedAt: Date.now(), tabs: session.tabs.length, thread: this._threadOfActive() };
    if (old && old.auto) day.auto = true;
    const list = this._all().filter(d => d.date !== date);
    list.unshift(day);
    if (!this._save(list)) throw new Error('The session was saved, but the workday index could not be written');
    if (silent) window.showToast?.('Workday saved · ' + day.tabs + ' tab' + VexPlural.s(day.tabs), 'info', 3000);
    return day;
  },

  // Open a saved day beside the tabs open now and put its thread back.
  async resume(day) {
    if (typeof SessionManager === 'undefined') throw new Error('Sessions are not available');
    const target = day || this.previous() || this.latest();
    if (!target) throw new Error('No workday has been saved yet. Use "End of day" at the end of one.');
    const session = this._sessionOf(target);
    if (!session) throw new Error('That day’s session was deleted from Sessions');
    await SessionManager.restoreSession(session.id, false);
    this._restoreThread(target);
    return target;
  },

  _restoreThread(day) {
    try {
      const th = day && day.thread;
      if (!th || !Array.isArray(th.msgs) || !th.msgs.length || typeof AIPanel === 'undefined' || typeof TabManager === 'undefined') return false;
      // The thread belongs to the tab at its address; failing that, the one in front.
      const tab = TabManager.tabs.find(t => t.url === th.url && t.id !== undefined) || TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      if (!tab) return false;
      const conv = AIPanel._getConv(tab.id);
      // Never over a conversation already started.
      if (conv.length) return false;
      for (const m of th.msgs) conv.push({ role: m.role, content: m.content, at: m.at || Date.now() });
      AIPanel._persistConversations();
      return true;
    } catch (err) { window.VexProblems?.note('Workday', 'Could not put the AI thread back', err); return false; }
  },

  async _confirmAndResume() {
    const day = this.previous() || this.latest();
    if (!day) { window.showToast?.('No workday saved yet — use "End of day" at the end of one', 'info'); return; }
    const when = new Date(day.savedAt).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    const ok = await window.vexConfirm({
      title: 'Resume ' + day.date + '?',
      message: day.tabs + ' tab' + VexPlural.s(day.tabs) + ' saved ' + when + (day.thread ? ' and your AI thread' : '') + ' will open beside the tabs you have now.',
      okLabel: 'Resume',
    });
    if (!ok) return;
    try { await this.resume(day); } catch (err) { window.showToast?.(err.message, 'error'); }
  },

  async _endOfDayCommand() {
    try {
      const day = this.endOfDay();
      window.showToast?.('Workday saved · ' + day.tabs + ' tab' + VexPlural.s(day.tabs) + (day.thread ? ' and the AI thread' : ''));
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },

  // The timed save: once a day, at or after the chosen time, only when asked for.
  _tick(now = new Date()) {
    if (!this.enabled() || !this.autoOn()) return false;
    const [h, m] = this.autoTime().split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
    // The day is today's by the clock: only the time of day comes from `now`.
    const date = this._dateOf();
    if (this._all().some(d => d.date === date && d.auto)) return false;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;
    try { const day = this.endOfDay({ silent: true }); day.auto = true; const l = this._all().filter(d => d.date !== date); l.unshift(day); this._save(l); return true; }
    catch (err) { window.VexProblems?.note('Workday', 'The timed end-of-day save failed', err); return false; }
  },

  snapshot() {
    const prev = this.previous();
    const last = this.latest();
    return {
      enabled: this.enabled(),
      days: this._all().map(d => ({ date: d.date, tabs: d.tabs, savedAt: d.savedAt, hasThread: !!d.thread })),
      previous: prev ? { date: prev.date, tabs: prev.tabs, savedAt: prev.savedAt, hasThread: !!prev.thread } : null,
      latest: last ? { date: last.date, tabs: last.tabs, savedAt: last.savedAt } : null,
    };
  },

  render(box) {
    box.appendChild(VexWorkflow.toggleRow('Resume workday and End of day', 'Ctrl+K → "Resume yesterday"', this.enabled(), (on) => {
      if (!VexWorkflow.setPref('workday', on)) window.showToast?.('The choice could not be saved', 'error');
      this.init();
    }));
    box.appendChild(VexWorkflow.toggleRow('Save the workday by itself', 'once a day, at the time below', this.autoOn(), (on) => {
      if (!VexWorkflow.setPref('workdayAuto', on)) window.showToast?.('The choice could not be saved', 'error');
    }));
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    row.innerHTML = '<span>Time of the timed save</span>';
    const t = document.createElement('input');
    t.type = 'time'; t.className = 'set-input'; t.value = this.autoTime(); t.setAttribute('aria-label', 'Time of the timed save');
    t.addEventListener('change', () => {
      if (!/^\d{2}:\d{2}$/.test(t.value)) { window.showToast?.('Pick a time', 'warn'); return; }
      if (!VexWorkflow.setPref('workdayAutoTime', t.value)) window.showToast?.('The time could not be saved', 'error');
    });
    row.appendChild(t);
    box.appendChild(row);
    const b = document.createElement('div');
    b.style.cssText = 'display:flex;gap:8px;margin-top:6px;flex-wrap:wrap';
    const mk = (label, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn-secondary'; x.textContent = label; x.addEventListener('click', fn); return x; };
    b.append(mk('End of day: save now', () => this._endOfDayCommand()), mk('Resume yesterday', () => this._confirmAndResume()));
    box.appendChild(b);
  },

  init() {
    if (!this.enabled()) {
      if (this._job) { this._job.stop(); this._job = null; }
      if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'workday-resume' && c.id !== 'workday-end');
      return false;
    }
    VexWorkflow.addCommand({ id: 'workday-resume', label: 'Resume yesterday’s workday', hint: 'Reopen the tabs, groups and AI thread you saved at the end of your last day', icon: 'history', action: () => this._confirmAndResume() });
    VexWorkflow.addCommand({ id: 'workday-end', label: 'End of day: save my workday', hint: 'Save the tabs, groups and AI thread as a named session to resume tomorrow', icon: 'moon', action: () => this._endOfDayCommand() });
    if (!this._job && typeof VexJobs !== 'undefined') this._job = VexJobs.every('Workday end-of-day save', 60000, () => this._tick(), { when: 'background' });
    return true;
  },
};

VexWorkflow.register({
  id: 'workday', title: 'Resume workday', icon: 'history',
  render: (box) => VexWorkday.render(box),
  snapshot: () => VexWorkday.snapshot(),
});

if (typeof window !== 'undefined') { window.VexWorkflow = VexWorkflow; window.VexWorkday = VexWorkday; }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWorkflow, VexWorkday };
