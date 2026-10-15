// === Little surprises: settings, brief sections and wiring ====================
//
// Owns the Settings group for six small, optional features and attaches each
// of them from outside, once, after all scripts have loaded. It edits neither
// today.js nor the start page:
//   * brief sections   -> VexBrief.register(...) (js/brief.js), each gated by
//                         its switch here
//   * commands         -> pushed into CommandBar.commands at start, the way
//                         skills.js does
//   * Settings         -> a group added to the Settings panel at runtime
//   * start widgets    -> VexWidgets.mount(el, widget, ctx) for the integrator
//
// Principles, because this is where they are enforced:
//   * every feature is OFF until chosen; nothing here switches itself on;
//   * nothing nags: no badges, no counters, no streak pressure, no reminders
//     that were not asked for (the one reminder, a time capsule, is the thing
//     the person scheduled);
//   * nothing is silent-surprising during Game mode: the mood theme waits, and
//     no bar or card is opened by these modules by themselves;
//   * everything is local: no request is made to choose or to build anything.
const VexDelights = {
  PREFS_KEY: 'vex.delights.prefs',
  FEATURES: [
    { key: 'rabbit', label: 'Take me somewhere interesting', info: 'A command that opens a page from your own history, bookmarks or Read Later, chosen on this PC. Good or Skip teaches it which sites you like; there is no outside recommender.', def: false },
    { key: 'capsule', label: 'Time capsules', info: 'Seal a page or a note to be handed back on a date you choose. One reminder on that morning, and it shows in the brief.', def: false },
    { key: 'onThisDay', label: 'On this day', info: 'What you read, saved and wrote on this date in earlier years, from your own history, notes and saves. Built on demand, never stored.', def: false },
    { key: 'oldBookmark', label: 'A forgotten bookmark', info: 'One old bookmark a day with three answers: still good, archive, or open. No counts, no streak, skipping a day costs nothing.', def: false },
    { key: 'mood', label: 'Mood themes', info: 'A theme for the morning, the day, the evening and the night, and a seasonal look you can wear for a week. Uses the same switching as Light and dark and recolours the New Tab page.', def: false },
    { key: 'widgets', label: 'Start page widgets', info: 'A quote of the day, a countdown, a photo from your PC and a habit tracker, kept on this PC. The shelf is empty until you add one.', def: false },
  ],

  prefs() {
    const out = {};
    let raw = null;
    const stored = localStorage.getItem(this.PREFS_KEY);
    if (stored != null) {
      try { raw = JSON.parse(stored); } catch (err) { throw new Error('The Little surprises settings could not be read', { cause: err }); }
    }
    for (const f of this.FEATURES) out[f.key] = raw && typeof raw[f.key] === 'boolean' ? raw[f.key] : f.def;
    return out;
  },
  isOn(key) {
    try { return !!this.prefs()[key]; } catch (err) { console.error('[Delights]', err.message); return false; }
  },
  set(key, on) {
    if (!this.FEATURES.some(f => f.key === key)) throw new Error('No such feature: ' + key);
    const next = { ...this.prefs(), [key]: !!on };
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(next));
    this._applyOne(key, !!on);
    try { document.dispatchEvent(new CustomEvent('vex:brief-changed')); } catch { /* no document */ }
    return next;
  },

  // A switch turning on or off does what it has to for its feature.
  _applyOne(key, on) {
    if (key === 'mood' && typeof VexMoodTheme !== 'undefined') {
      if (on) VexMoodTheme.start();
      else {
        // Off puts everything back: the seasonal week ends and the theme with it.
        VexMoodTheme.endSeason({ restore: true });
        VexMoodTheme.set({ mode: 'off' });
        VexMoodTheme.stop();
      }
    }
    if (key === 'rabbit' && !on && typeof VexRabbitHole !== 'undefined') VexRabbitHole.hideBar();
  },

  modules() {
    const out = [];
    const sec = (obj, flag) => { if (obj && obj.section) out.push({ flag, section: obj.section }); };
    if (typeof VexTimeCapsule !== 'undefined') sec(VexTimeCapsule, 'capsule');
    if (typeof VexOnThisDay !== 'undefined') sec(VexOnThisDay, 'onThisDay');
    if (typeof VexOldBookmark !== 'undefined') sec(VexOldBookmark, 'oldBookmark');
    return out;
  },

  // Sections as the brief registry wants them. A section's own isEnabled()
  // gates build, so the switch here really turns it off.
  sections() {
    return this.modules().map(({ section }) => ({ defaultOn: false, order: 100, icon: 'sparkles', ...section }));
  },
  registerAll(brief) {
    if (!brief || typeof brief.register !== 'function') return 0;
    let n = 0;
    for (const s of this.sections()) {
      brief.register({
        ...s,
        build: async (ctx) => {
          if (typeof s.isEnabled === 'function' && !s.isEnabled()) return null;
          if (typeof GameSession !== 'undefined' && GameSession.active) return null;
          return s.build(ctx);
        },
      });
      n++;
    }
    return n;
  },

  commands() {
    const list = [];
    if (typeof VexRabbitHole !== 'undefined') list.push(VexRabbitHole.command);
    if (typeof VexTimeCapsule !== 'undefined') list.push(VexTimeCapsule.command, VexTimeCapsule.openCommand);
    if (typeof VexOnThisDay !== 'undefined') list.push(VexOnThisDay.command);
    if (typeof VexOldBookmark !== 'undefined') list.push(VexOldBookmark.command);
    return list.filter(Boolean);
  },
  registerCommands(bar) {
    if (!bar || !Array.isArray(bar.commands)) return 0;
    let n = 0;
    for (const c of this.commands()) {
      if (bar.commands.some(x => x.id === c.id)) continue;
      bar.commands.push({ ...c });
      n++;
    }
    return n;
  },

  // ---- Settings -----------------------------------------------------------
  // Its own group, added to the Settings panel from here: the markup of
  // index.html is not touched. It redraws whenever it scrolls into view.
  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    container.textContent = '';
    container.appendChild(el('p', 'setting-info', 'Small things that are nice to have and never ask for attention. Each one is off until you turn it on, works on this PC only, and stays quiet while a game is running.'));
    let p;
    try { p = this.prefs(); } catch (err) { container.appendChild(el('p', 'setting-info', err.message)); return; }
    for (const f of this.FEATURES) {
      const row = el('div', 'setting-toggle-row');
      const name = el('span', '', f.label);
      name.style.flex = '1';
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!p[f.key]; input.setAttribute('aria-label', f.label);
      input.addEventListener('change', () => {
        try { this.set(f.key, input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.(err.message, 'error'); }
        this.renderSettings(container);
      });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(name, lab);
      container.appendChild(row);
      container.appendChild(el('div', 'setting-info', f.info));
      if (p[f.key]) this._renderDetail(f.key, container);
    }
  },

  _renderDetail(key, container) {
    const slot = document.createElement('div');
    slot.className = 'vex-delight-detail';
    container.appendChild(slot);
    const note = (text) => { const d = document.createElement('div'); d.className = 'setting-info'; d.textContent = text; slot.appendChild(d); };
    try {
      if (key === 'mood' && typeof VexMoodTheme !== 'undefined') VexMoodTheme.renderSettings(slot);
      else if (key === 'widgets' && typeof VexWidgets !== 'undefined') VexWidgets.renderSettings(slot);
      else if (key === 'rabbit' && typeof VexRabbitHole !== 'undefined') {
        const s = VexRabbitHole.summary();
        note('Good: ' + s.good + ', skipped: ' + s.skip + ' across ' + s.hosts + ' sites. Run it from the command bar.');
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn-secondary'; b.textContent = 'Forget what I marked';
        b.addEventListener('click', async () => {
          const ok = await window.vexConfirm({ title: 'Forget your Good and Skip marks?', message: 'Pages and sites it avoided or liked are forgotten.', okLabel: 'Forget', danger: true });
          if (!ok) return;
          try { VexRabbitHole.reset(); } catch (err) { window.showToast?.(err.message, 'error'); return; }
          this.renderSettings(container);
        });
        slot.appendChild(b);
      } else if (key === 'capsule' && typeof VexTimeCapsule !== 'undefined') {
        note(VexTimeCapsule.upcoming().length + ' sealed, ' + VexTimeCapsule.due().length + ' ready. Seal one from the command bar.');
      }
    } catch (err) { note(err.message); }
  },

  mountSettings() {
    const panel = document.getElementById('panel-settings');
    if (!panel || document.getElementById('settings-delights')) return false;
    const group = document.createElement('div');
    group.className = 'setting-group';
    group.id = 'settings-delights';
    const label = document.createElement('label');
    label.className = 'setting-label';
    label.textContent = 'Little surprises';
    const body = document.createElement('div');
    body.id = 'delights-content';
    group.append(label, body);
    const anchor = document.getElementById('settings-brief-actions') || document.getElementById('settings-brief');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(group, anchor.nextSibling);
    else (panel.querySelector('.settings-content') || panel).appendChild(group);
    this.renderSettings(body);
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) this.renderSettings(body); }).observe(group);
    }
    return true;
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    if (typeof VexBrief !== 'undefined') this.registerAll(VexBrief);
    if (typeof CommandBar !== 'undefined') this.registerCommands(CommandBar);
    try { this.mountSettings(); } catch (err) { window.VexProblems?.note('Little surprises', 'Settings block could not be added', err); }
    if (this.isOn('mood') && typeof VexMoodTheme !== 'undefined') VexMoodTheme.start();
  },
};

if (typeof window !== 'undefined') {
  window.VexDelights = VexDelights;
  if (typeof document !== 'undefined') {
    const go = () => { try { VexDelights.init(); } catch (err) { console.error('[Delights]', err); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDelights };
