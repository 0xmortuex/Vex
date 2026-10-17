// === Two-minute drawer ========================================================
//
// Tiny chores ("reply to Ayşe", "pay the water bill", "rename that file") pile
// up because none of them is worth opening a note for. Tag one #2min, in the
// capture box or on any task line in a note, and it goes in this drawer:
//
//   Capture:  "call the bank #2min"   becomes  "- [ ] call the bank #2min"  in your To-do note
//   Drawer:   Ctrl+K › Two-minute drawer  shows three of them, with a 2:00 timer
//
// There is no second to-do list: the drawer reads the same checklist lines the
// rest of Vex reads (js/open-tasks.js) and ticks them where they live. The
// Morning Brief shows a "Two minutes" line when there are any. The timer is only
// a countdown you start; when it ends you get one notice you asked for.
//
//   VexTwoMinute.isTagged(text)     pure
//   VexTwoMinute.strip(text)        pure: the task without its tag
//   VexTwoMinute.pick(tasks, n)     pure: the first n tagged, open tasks

const VexTwoMinute = {
  PREF: 'vex.twoMinute.enabled',   // 'off' hides the command and the Brief line and leaves the capture tag alone
  TAG: /(^|\s)#(?:2min|2m|2-min|twominute)\b/i,
  SHOW: 3,
  SECONDS: 120,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- pure --------------------------------------------------------------------------
  isTagged(text) { return this.TAG.test(String(text == null ? '' : text)); },
  strip(text) { return String(text == null ? '' : text).replace(new RegExp(this.TAG.source, 'gi'), '$1').replace(/\s+/g, ' ').trim(); },
  pick(tasks, n = this.SHOW) {
    return (Array.isArray(tasks) ? tasks : []).filter(t => t && !t.done && this.isTagged(t.text)).slice(0, n);
  },

  // ---- tasks -------------------------------------------------------------------------
  all() {
    if (typeof OpenTasks === 'undefined') throw new Error('Tasks are not loaded');
    return OpenTasks.collect(OpenTasks.notes()).filter(t => this.isTagged(t.text));
  },
  // The capture box: "text #2min" goes to the To-do note as a checklist line.
  addFromCapture(text) {
    if (typeof OpenTasks === 'undefined') throw new Error('Tasks are not loaded');
    const clean = this.strip(text);
    if (!clean) throw new Error('Write the chore before the tag');
    OpenTasks.add(clean + ' #2min');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('two-minute');
    return 'Saved to your two-minute list';
  },

  // ---- Morning Brief -----------------------------------------------------------------
  section() {
    return {
      id: 'two-minute', title: 'Two minutes', icon: 'check', order: 4, defaultOn: true, maxItems: 3, ttlMs: 30000,
      build: async () => {
        if (!this.enabled()) return null;
        const tasks = this.pick(this.all());
        if (!tasks.length) return null;
        return { summary: tasks.length + ' quick one' + VexPlural.s(tasks.length) + ' to knock out', items: tasks.map(t => ({ text: this.strip(this._plain(t)), sub: t.noteTitle })) };
      },
    };
  },
  _plain(t) { return typeof OpenTasks !== 'undefined' ? OpenTasks._plain(t) : t.text; },

  // ---- the drawer ----------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('The two-minute drawer is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('two-minute');
    const { overlay, body } = VexSettingsGroups.dialog({ id: 'vex-two-minute', title: 'Two-minute drawer', sub: 'Chores you tagged #2min. Knock out three, then stop.' });
    let endsAt = 0;
    const timer = document.createElement('div');
    timer.setAttribute('role', 'timer');
    timer.style.cssText = 'font-size:22px;font-weight:700;margin:6px 0';
    const showTimer = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      timer.textContent = endsAt ? Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : '2:00';
    };
    const tick = () => {
      if (!overlay.isConnected) { endsAt = 0; return; }
      showTimer();
      if (endsAt && Date.now() >= endsAt) {
        endsAt = 0;
        showTimer();
        if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: 'two-minute', urgency: 'asked', id: String(Date.now()), title: 'Two minutes are up' }, () => window.showToast?.('Two minutes are up', 'info', 6000));
        else window.showToast?.('Two minutes are up', 'info', 6000);
        return;
      }
      if (endsAt) setTimeout(tick, 500);
    };
    const draw = () => {
      body.textContent = '';
      body.appendChild(timer);
      body.appendChild(VexSettingsGroups.button('Start 2:00', () => { endsAt = Date.now() + this.SECONDS * 1000; tick(); }, { primary: true }));
      let tasks;
      try { tasks = this.all(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      const shown = this.pick(tasks);
      if (!shown.length) body.appendChild(VexSettingsGroups.note('Nothing tagged #2min. Add "#2min" to a chore in the capture box or to a checklist line in a note.'));
      for (const t of shown) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const text = document.createElement('span');
        text.className = 'vexsr-host'; text.style.wordBreak = 'normal';
        text.textContent = this.strip(this._plain(t)) + '  (' + t.noteTitle + ')';
        row.append(text, VexSettingsGroups.button('Done', () => { try { OpenTasks.toggle(t.noteId, t.index); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true, label: 'Mark done: ' + this.strip(t.text) }));
        body.appendChild(row);
      }
      const more = tasks.length - shown.length;
      if (more > 0) body.appendChild(VexSettingsGroups.note(more + ' more waiting. Three at a time keeps it small.'));
      showTimer();
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Tag a chore #2min in the capture box or on a note checklist line. Ctrl+K › Two-minute drawer shows three of them with a 2:00 timer, and the Morning Brief mentions them.'));
    el.appendChild(VexSettingsGroups.button('Open the drawer', () => this.open(), { primary: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexBrief !== 'undefined' && typeof VexBrief.register === 'function') VexBrief.register(this.section());
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexTwoMinute = VexTwoMinute;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'two-minute', title: 'Two-minute drawer', keywords: 'two minute 2min quick chores tiny tasks drawer timer', before: 'about', build: (el) => VexTwoMinute.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'two-minute', label: 'Two-minute drawer', hint: 'Three chores tagged #2min with a 2:00 timer', icon: 'check', action: () => VexTwoMinute.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTwoMinute };
