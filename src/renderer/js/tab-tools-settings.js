// === Settings › Tab tools =======================================================
//
// The switches for Ctrl+Tab by recency (js/tab-mru.js), Search open tabs
// (js/tab-search.js), the Back/Forward list (js/nav-history-menu.js) and the quick
// actions on the tab strip (js/strip-actions.js). Each is also a Minimal Vex
// feature, so these are the same switches that screen uses.
const VexTabToolsSettings = {
  ID: 'tab-tools',

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    body.appendChild(el('p', 'setting-info', 'Small helpers for moving between tabs. Each can be switched off on its own.'));
    const toggle = (label, hint, on, set) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!on; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { try { set(input.checked); } catch (err) { input.checked = !input.checked; fail(err); } });
      lab.append(input, el('span', 'toggle-slider'));
      const text = el('span', 'setting-label-text', label);
      row.append(text, lab);
      body.appendChild(row);
      if (hint) body.appendChild(el('p', 'setting-info', hint));
    };
    toggle('Ctrl+Tab by recency', 'While Ctrl is held, a list shows the tabs in the order you used them. Ctrl+Shift+Tab goes back up, letting go of Ctrl switches, Esc stays.', VexTabMru.enabled(), (on) => VexTabMru.setEnabled(on));
    toggle('Search open tabs', 'Ctrl+Alt+Z (or Ctrl+K, "Search open tabs"): a list of every open tab, narrowed as you type.', VexTabSearch.enabled(), (on) => VexTabSearch.setEnabled(on));
    toggle('Back and Forward list', 'Right-click or press and hold the Back or Forward button to see the pages behind and ahead.', VexNavHistoryMenu.enabled(), (on) => VexNavHistoryMenu.setEnabled(on));
    toggle('Quick actions on the tab strip', 'Master switch for the options below.', VexStripActions.enabled(), (on) => { VexStripActions.setEnabled(on); this.render(body); });
    if (VexStripActions.enabled()) {
      const p = VexStripActions.prefs();
      toggle('Buttons when you rest on a tab (mute, pin, duplicate, close others)', '', p.hover, (on) => VexStripActions.save({ hover: on }));
      toggle('Double-click the empty strip for a new tab', '', p.dblNew, (on) => VexStripActions.save({ dblNew: on }));
      toggle('Middle-click the empty strip to reopen the last closed tab', '', p.midReopen, (on) => VexStripActions.save({ midReopen: on }));
      toggle('Wheel over the strip changes tab', '', p.wheel, (on) => VexStripActions.save({ wheel: on }));
      toggle('Closing a tab goes back to the tab that opened it', '', p.returnToOpener, (on) => VexStripActions.save({ returnToOpener: on }));
    }
  },

  init() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({ id: this.ID, title: 'Tab tools', keywords: 'ctrl tab recent switcher search tabs back forward history strip mute pin duplicate', render: (body) => this.render(body) });
  },
};

if (typeof window !== 'undefined') window.VexTabToolsSettings = VexTabToolsSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabToolsSettings };
