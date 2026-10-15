// === Daily tools: Settings block and wiring ================================
//
// The daily tools (js/meeting-prep.js, js/tab-cleanup.js, js/routine-detect.js,
// js/universal-search.js) keep their choices in their own small stores and had
// no Settings of their own. This is one block in Settings > Workflow and chains
// (the VexWorkflow hub, js/resume-workday.js):
//
//   Meeting prep      mode (ask / automatic / off) and lead time in minutes
//   Tab cleanup       mode, the evening hour, how many idle days
//   Routine detection on / off, and forgetting the log
//   Mail subjects     the local memo of mail HEADERS the search reads: off
//                     until chosen, with a button that clears it
//
// It also joins routine detection to the chain editor: "Save as a command
// chain" on the offer opens js/chain-steps.js with the suggested steps filled
// in, so the person names it and presses Save.
const DailyToolsSettings = {
  _row(label, hint) {
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
    row.appendChild(span);
    return row;
  },

  _fail(err) { window.showToast?.((err && err.message) || String(err), 'error'); },

  // A <select> row. `apply(value)` may throw: the control goes back and says why.
  _select(label, hint, options, current, apply) {
    const row = this._row(label, hint);
    const sel = document.createElement('select');
    sel.className = 'set-input';
    sel.setAttribute('aria-label', label);
    for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    sel.value = current;
    sel.addEventListener('change', () => {
      try { apply(sel.value); } catch (err) { sel.value = current; this._fail(err); }
    });
    row.appendChild(sel);
    return row;
  },

  // A whole-number row with a range the module also enforces.
  _number(label, hint, min, max, current, apply) {
    const row = this._row(label, hint);
    const input = document.createElement('input');
    input.type = 'number'; input.className = 'set-input';
    input.min = String(min); input.max = String(max); input.value = String(current);
    input.style.width = '80px';
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      try { apply(input.value); } catch (err) { input.value = String(current); this._fail(err); }
    });
    row.appendChild(input);
    return row;
  },

  _toggle(label, hint, checked, apply) {
    if (typeof VexWorkflow !== 'undefined' && typeof VexWorkflow.toggleRow === 'function') {
      return VexWorkflow.toggleRow(label, hint, checked, (on, input) => {
        try { apply(on); } catch (err) { input.checked = !on; this._fail(err); }
      });
    }
    throw new Error('The workflow settings hub is not loaded');
  },

  _button(label, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.textContent = label;
    b.style.marginTop = '6px';
    b.addEventListener('click', () => { try { fn(); } catch (err) { this._fail(err); } });
    return b;
  },

  render(box) {
    const note = (text) => { const p = document.createElement('p'); p.className = 'setting-info muted'; p.style.cssText = 'font-size:11.5px;margin:2px 0 8px'; p.textContent = text; return p; };
    const redraw = () => { box.textContent = ''; this.render(box); };

    if (typeof MeetingPrep !== 'undefined') {
      box.appendChild(this._select('Meeting prep', 'a card before a calendar event', [['ask', 'Ask me'], ['auto', 'Show it by itself'], ['off', 'Off']], MeetingPrep.mode(), (v) => MeetingPrep.setMode(v)));
      box.appendChild(this._number('Meeting prep lead time (minutes)', '1 to 120', 1, 120, MeetingPrep.leadMinutes(), (v) => MeetingPrep.setLeadMinutes(v)));
    }
    if (typeof TabCleanup !== 'undefined') {
      box.appendChild(this._select('Evening tab cleanup', 'offers to archive idle tabs, with Undo', [['ask', 'Ask me'], ['off', 'Off']], TabCleanup.mode(), (v) => TabCleanup.setMode(v)));
      box.appendChild(this._number('Tab cleanup hour (0 to 23)', 'the offer comes after this hour', 0, 23, TabCleanup.hour(), (v) => TabCleanup.setHour(v)));
      box.appendChild(this._number('Tab cleanup: idle for days', '1 to 60', 1, 60, TabCleanup.days(), (v) => TabCleanup.setDays(v)));
    }
    if (typeof RoutineDetect !== 'undefined') {
      box.appendChild(this._toggle('Notice a morning routine', 'the sites you open in the same order, kept on this PC', RoutineDetect.mode() === 'on', (on) => { RoutineDetect.setMode(on ? 'on' : 'off'); }));
      box.appendChild(this._button('Forget the routine log', () => { RoutineDetect.forget(); window.showToast?.('The routine log is cleared'); }));
    }
    if (typeof UniversalSearch !== 'undefined') {
      box.appendChild(this._toggle('Search mail subjects', 'keeps sender, subject and date of recent mail on this PC. Off until you turn it on', UniversalSearch.mailEnabled(), (on) => { UniversalSearch.setMailEnabled(on); redraw(); }));
      box.appendChild(this._button('Clear the mail subject memo', () => { UniversalSearch.forgetMail(); window.showToast?.('The mail subject memo is cleared'); }));
      box.appendChild(note('Turning the switch off also clears what was kept.'));
    }
  },

  // "Save as a command chain": the chain editor, filled with the routine.
  keeper(suggestion) {
    if (typeof VexChainSteps === 'undefined') throw new Error('The chain editor is not loaded');
    VexChainSteps.open(null, { name: suggestion.name, steps: suggestion.steps }).catch(err => window.showToast?.((err && err.message) || String(err), 'error'));
    return true;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexWorkflow !== 'undefined') {
      VexWorkflow.register({ id: 'daily-tools', title: 'Daily tools', icon: 'sparkles', render: (box) => this.render(box) });
    }
    if (typeof RoutineDetect !== 'undefined') RoutineDetect.setKeeper((s) => this.keeper(s));
    return true;
  },
};

if (typeof window !== 'undefined') window.DailyToolsSettings = DailyToolsSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { DailyToolsSettings };
