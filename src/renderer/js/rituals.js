// === Rituals: a named, checkable list of steps ================================
//
// "Sunday plan", "Close the day", "Exam week", "Release day": the same few
// things in the same order. A ritual is a name and an ordered list of steps.
// A step is one of
//
//   a command    anything in Ctrl+K (what is due, close the day, plan the week, a
//                chain you made: "chain:..."), or a chain step ("open:https://...",
//                "timer:15 min", "session:Study")
//   a check      a line with no command, which you simply tick ("Water the plants")
//
// Ctrl+K › "Rituals" lists them; each ritual also has its own entry,
// "Ritual: Sunday plan", which opens its steps. A step with a command has a Run
// button, and "Run the automatic steps" goes through them in order, naming any
// that failed rather than skipping them silently. A ritual is complete when every
// step is ticked or run; the days it is complete in a row (on the weekdays it is
// meant for) are its streak.
//
// Nothing runs by itself, ever: a ritual starts when you open it. Written as
// lines in the editor:   Plan the week => week-skeleton     (a command)
//                        Water the plants                   (a check)
//
//   VexRituals.parseLines(text)           pure: the steps, or throws naming the bad line
//   VexRituals.streak(ritual, log, now)   pure: days in a row
//   VexRituals.isComplete(ritual, done)   pure

const VexRituals = {
  KEY: 'vex.rituals',
  PREF: 'vex.rituals.enabled',   // 'off' hides the commands
  MAX_RITUALS: 30,
  MAX_STEPS: 20,
  LOG_DAYS: 400,
  DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  STARTERS: [
    { name: 'Close the day', days: [], steps: [{ label: 'Close the day', step: 'close-day' }, { label: 'See what is due tomorrow', step: 'due-now' }] },
    { name: 'Sunday plan', days: [0], steps: [{ label: 'Plan the week', step: 'week-skeleton' }, { label: 'See what is due', step: 'due-now' }, { label: 'Weekly triage', step: 'weekly-triage' }] },
    { name: 'First open', days: [], steps: [{ label: 'See what is due', step: 'due-now' }, { label: 'Open the inbox', step: 'inbox-open' }] },
  ],

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    if (!on) this._unregister();
    else this._register();
    return !!on;
  },

  // ---- pure ------------------------------------------------------------------------------
  dayKey(d) {
    const x = typeof d === 'number' ? new Date(d) : d;
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  },
  parseLines(text) {
    const steps = [];
    const lines = String(text == null ? '' : text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      const at = line.indexOf('=>');
      const label = (at < 0 ? line : line.slice(0, at)).trim();
      const step = at < 0 ? '' : line.slice(at + 2).trim();
      if (!label) throw new Error('Line ' + (i + 1) + ' has no name before =>');
      if (label.length > 80) throw new Error('Line ' + (i + 1) + ' is over 80 characters');
      if (at >= 0 && !step) throw new Error('Line ' + (i + 1) + ' has nothing after =>');
      if (step.length > 200) throw new Error('Line ' + (i + 1) + ': the command is too long');
      steps.push(step ? { label, step } : { label });
    });
    if (!steps.length) throw new Error('Write at least one step');
    if (steps.length > this.MAX_STEPS) throw new Error('A ritual has at most ' + this.MAX_STEPS + ' steps');
    return steps;
  },
  toLines(ritual) { return ritual.steps.map(s => s.step ? s.label + ' => ' + s.step : s.label).join('\n'); },
  make({ name, days, steps, id, now = Date.now() } = {}) {
    const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!n) throw new Error('Give the ritual a name');
    if (n.length > 60) throw new Error('Keep the name to 60 characters');
    const ds = Array.isArray(days) ? [...new Set(days.map(Number))] : [];
    if (ds.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Days are 0 (Sunday) to 6 (Saturday)');
    if (!Array.isArray(steps) || !steps.length) throw new Error('Write at least one step');
    if (steps.length > this.MAX_STEPS) throw new Error('A ritual has at most ' + this.MAX_STEPS + ' steps');
    return { id: id || 'rt_' + now.toString(36) + Math.random().toString(36).slice(2, 6), name: n, days: ds.sort(), steps: steps.map(s => (s.step ? { label: String(s.label), step: String(s.step) } : { label: String(s.label) })) };
  },
  scheduled(ritual, date) { return !ritual.days.length || ritual.days.includes((typeof date === 'number' ? new Date(date) : date).getDay()); },
  isComplete(ritual, done) {
    const set = new Set(Array.isArray(done) ? done : []);
    return ritual.steps.length > 0 && ritual.steps.every((_, i) => set.has(i));
  },
  streak(ritual, log, now = Date.now()) {
    const days = (log && log[ritual.id]) || {};
    let n = 0;
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    for (let i = 0; i < this.LOG_DAYS; i++, d.setDate(d.getDate() - 1)) {
      if (!this.scheduled(ritual, d)) continue;
      if (this.isComplete(ritual, days[this.dayKey(d)])) n++;
      else if (i === 0) continue;   // today is not finished yet: that does not break the run
      else break;
    }
    return n;
  },

  // ---- storage ----------------------------------------------------------------------------
  _load() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return { v: 1, list: [], log: {} };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your rituals could not be read: ' + err.message); }
    if (!v || v.v !== 1 || !Array.isArray(v.list)) throw new Error('Your rituals are in a shape this version does not know');
    return { v: 1, list: v.list.filter(r => r && r.id && typeof r.name === 'string' && Array.isArray(r.steps) && Array.isArray(r.days)), log: v.log && typeof v.log === 'object' ? v.log : {} };
  },
  _save(state) {
    // The log keeps LOG_DAYS days per ritual and only for rituals that still exist.
    const cutoff = this.dayKey(Date.now() - this.LOG_DAYS * 86400000);
    const log = {};
    for (const r of state.list) {
      const days = state.log[r.id] || {};
      const kept = Object.keys(days).filter(k => k >= cutoff);
      if (kept.length) log[r.id] = Object.fromEntries(kept.map(k => [k, days[k]]));
    }
    try { localStorage.setItem(this.KEY, JSON.stringify({ v: 1, list: state.list, log })); }
    catch (err) { throw new Error('Your rituals could not be saved: ' + err.message); }
    this._register();
  },
  list() { return this._load().list; },
  get(id) { return this._load().list.find(r => r.id === id) || null; },
  save(ritual, { strict = true } = {}) {
    const state = this._load();
    const i = state.list.findIndex(r => r.id === ritual.id);
    if (i < 0 && state.list.length >= this.MAX_RITUALS) throw new Error('That is ' + this.MAX_RITUALS + ' rituals; remove one first');
    if (strict) for (const s of ritual.steps) if (s.step) this._resolve(s.step);
    if (i >= 0) state.list[i] = ritual; else state.list.push(ritual);
    this._save(state);
    return ritual;
  },
  remove(id) {
    const state = this._load();
    if (!state.list.some(r => r.id === id)) throw new Error('That ritual is gone');
    state.list = state.list.filter(r => r.id !== id);
    delete state.log[id];
    this._save(state);
  },
  addStarters() {
    const have = new Set(this.list().map(r => r.name.toLowerCase()));
    let n = 0;
    for (const s of this.STARTERS) {
      if (have.has(s.name.toLowerCase())) continue;
      this.save(this.make(s), { strict: false });
      n++;
    }
    return n;
  },
  doneToday(id, now = Date.now()) { return (this._load().log[id] || {})[this.dayKey(now)] || []; },
  mark(id, idx, on, now = Date.now()) {
    const state = this._load();
    const r = state.list.find(x => x.id === id);
    if (!r) throw new Error('That ritual is gone');
    if (!Number.isInteger(idx) || idx < 0 || idx >= r.steps.length) throw new Error('That step is not in the ritual');
    const k = this.dayKey(now);
    const days = (state.log[id] = state.log[id] || {});
    const set = new Set(days[k] || []);
    if (on) set.add(idx); else set.delete(idx);
    days[k] = [...set].sort((a, b) => a - b);
    this._save(state);
    return this.isComplete(r, days[k]);
  },

  // ---- running ----------------------------------------------------------------------------
  _resolve(step) {
    const cmds = typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands) ? CommandBar.commands : [];
    const c = cmds.find(x => x.id === step);
    if (c) return { label: c.label || step, run: () => c.action() };
    if (typeof VexChainSteps !== 'undefined') {
      const s = VexChainSteps.resolve(step);
      if (s) return { label: s.label, run: s.run };
    }
    throw new Error('"' + step + '" is not a command in this version of Vex');
  },
  async runStep(ritual, idx, now = Date.now()) {
    const s = ritual.steps[idx];
    if (!s) throw new Error('That step is not in the ritual');
    if (!s.step) throw new Error('"' + s.label + '" has no command; tick it when you have done it');
    await this._resolve(s.step).run();
    this.mark(ritual.id, idx, true, now);
  },
  // Runs every step that has a command, in order. A step that fails is named and left unticked; the rest still run.
  async runAll(ritual, now = Date.now()) {
    const problems = [];
    for (let i = 0; i < ritual.steps.length; i++) {
      if (!ritual.steps[i].step) continue;
      try { await this.runStep(ritual, i, now); }
      catch (err) { problems.push(ritual.steps[i].label + ' (' + ((err && err.message) || 'failed') + ')'); }
      await new Promise(r => setTimeout(r, 350));
    }
    return problems;
  },

  // ---- commands ---------------------------------------------------------------------------
  _unregister() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('ritual:'));
  },
  _register() {
    this._unregister();
    if (!this.enabled() || typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    let list = [];
    try { list = this.list(); } catch (err) { console.error('[Rituals] the rituals could not be listed for the command bar:', err); return; }
    for (const r of list) CommandBar.commands.push({ id: 'ritual:' + r.id, label: 'Ritual: ' + r.name, hint: r.steps.length + ' steps', icon: 'check', action: () => this.openRun(r.id) });
  },

  // ---- the screens ----------------------------------------------------------------------------
  openRun(id) {
    if (!this.enabled()) { window.showToast?.('Rituals are switched off in Settings', 'info'); return; }
    const r = this.get(id);
    if (!r) { window.showToast?.('That ritual is gone', 'error'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('rituals');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-ritual-run', title: r.name, sub: r.days.length ? 'On ' + r.days.map(d => this.DAY_NAMES[d]).join(', ') : 'Every day' });
    const failed = new Map();
    const draw = () => {
      body.textContent = '';
      const cur = this.get(id);
      if (!cur) { body.appendChild(VexSettingsGroups.note('That ritual is gone.')); return; }
      const done = new Set(this.doneToday(id));
      const st = this.streak(cur, this._load().log);
      body.appendChild(VexSettingsGroups.note((this.isComplete(cur, [...done]) ? 'Done for today. ' : done.size + ' of ' + cur.steps.length + ' done. ') + 'Streak: ' + st + (st === 1 ? ' day' : ' days') + '.'));
      cur.steps.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.style.flexWrap = 'wrap';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = done.has(i); cb.setAttribute('aria-label', s.label);
        cb.addEventListener('change', () => { try { this.mark(id, i, cb.checked); draw(); } catch (err) { cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); } });
        const text = document.createElement('span');
        text.className = 'vexsr-host'; text.style.wordBreak = 'normal';
        text.textContent = s.label + (failed.has(i) ? '  - failed: ' + failed.get(i) : '');
        row.append(cb, text);
        if (s.step) {
          row.appendChild(VexSettingsGroups.button('Run', async () => {
            try { await this.runStep(cur, i); failed.delete(i); } catch (err) { failed.set(i, err.message); }
            draw();
          }, { label: 'Run: ' + s.label }));
        }
        body.appendChild(row);
      });
      if (cur.steps.some(s => s.step)) {
        body.appendChild(VexSettingsGroups.button('Run the automatic steps', async () => {
          failed.clear();
          const problems = await this.runAll(cur);
          if (problems.length) window.showToast?.('Ritual "' + cur.name + '" finished with ' + problems.length + ' problem' + VexPlural.s(problems.length) + ': ' + problems.join(', '), 'error', 8000);
          draw();
        }, { primary: true }));
      }
    };
    draw();
  },

  openEditor(id) {
    const cur = id ? this.get(id) : null;
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-ritual-edit', title: cur ? 'Edit ' + cur.name : 'New ritual', sub: 'One step per line. Write "Name => command" for a step that runs a command, or just the name for a step you tick.' });
    const name = Object.assign(document.createElement('input'), { type: 'text', maxLength: 60, placeholder: 'Sunday plan', value: cur ? cur.name : '' });
    name.setAttribute('aria-label', 'Name');
    const days = document.createElement('div');
    days.className = 'vexsr-rule';
    const boxes = this.DAY_NAMES.map((n, d) => {
      const l = document.createElement('label');
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!cur && cur.days.includes(d) });
      l.append(cb, document.createTextNode(' ' + n + ' '));
      days.appendChild(l);
      return cb;
    });
    const lines = Object.assign(document.createElement('textarea'), { rows: 7, placeholder: 'Plan the week => week-skeleton\nWater the plants', value: cur ? this.toLines(cur) : '' });
    lines.setAttribute('aria-label', 'Steps');
    lines.style.width = '100%';
    body.append(name, VexSettingsGroups.note('Days (none ticked means every day):'), days, lines);
    body.appendChild(VexSettingsGroups.button('Save', () => {
      try {
        const r = this.make({ id: cur && cur.id, name: name.value, days: boxes.map((b, d) => (b.checked ? d : -1)).filter(d => d >= 0), steps: this.parseLines(lines.value) });
        this.save(r);
        close();
        this.open();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true }));
  },

  open() {
    if (!this.enabled()) { window.showToast?.('Rituals are switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('rituals');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-rituals', title: 'Rituals', sub: 'Named lists of steps you do in the same order. Nothing runs until you open one.' });
    const draw = () => {
      body.textContent = '';
      let list, log;
      try { const s = this._load(); list = s.list; log = s.log; } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      body.appendChild(VexSettingsGroups.button('New ritual', () => this.openEditor(), { primary: true }));
      body.appendChild(VexSettingsGroups.button('Add the starter rituals', () => { try { const n = this.addStarters(); window.showToast?.(n ? n + ' added' : 'You have them already', 'info'); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      if (!list.length) body.appendChild(VexSettingsGroups.note('No rituals yet.'));
      for (const r of list) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const st = this.streak(r, log);
        const text = document.createElement('span');
        text.className = 'vexsr-host'; text.style.wordBreak = 'normal';
        text.textContent = r.name + '  (' + r.steps.length + ' steps, ' + (r.days.length ? r.days.map(d => this.DAY_NAMES[d]).join('/') : 'daily') + ', streak ' + st + ')';
        row.append(text,
          VexSettingsGroups.button('Open', () => this.openRun(r.id), { primary: true, label: 'Open ' + r.name }),
          VexSettingsGroups.button('Edit', () => this.openEditor(r.id), { label: 'Edit ' + r.name }),
          VexSettingsGroups.button('Remove', () => { try { this.remove(r.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove ' + r.name }));
        body.appendChild(row);
      }
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Name a list of steps (commands or things you tick) and open it when the time comes: Sunday plan, Close the day, Exam week. A streak counts the days you finished it. Nothing runs by itself.'));
    el.appendChild(VexSettingsGroups.button('Open rituals', () => this.open(), { primary: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    this._register();
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexRituals = VexRituals;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'rituals', title: 'Rituals', keywords: 'ritual routine checklist sunday plan close the day streak steps chain', before: 'about', build: (el) => VexRituals.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'rituals', label: 'Rituals', hint: 'Named, checkable lists of steps with a streak: Sunday plan, Close the day', icon: 'check', action: () => VexRituals.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRituals };
