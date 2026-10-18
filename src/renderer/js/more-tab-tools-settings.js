// === Settings › More tab tools ==================================================
//
// The switches for picking several tabs (js/tab-select.js), holding tab widths while
// closing (js/tab-hold.js), tab names of your own (js/tab-names.js), the picture
// shown while a sleeping tab wakes (js/tab-thumbs.js), keyboard hints
// (js/link-hints.js) and split view keys (js/split-keys.js).
const VexMoreTabToolsSettings = {
  ID: 'more-tab-tools',

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const toggle = (label, hint, on, set) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!on; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { try { set(input.checked); } catch (err) { input.checked = !input.checked; fail(err); } });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', label), lab);
      body.appendChild(row);
      if (hint) body.appendChild(el('p', 'setting-info', hint));
    };
    toggle('Pick several tabs', 'Ctrl-click or Shift-click tabs, then group, mute, pin, bookmark, show side by side or close them together.', VexTabSelect.enabled(), (on) => VexTabSelect.setEnabled(on));
    toggle('Keep tab widths while closing tabs', 'After closing a tab with its X, the tabs stay as wide as they were until the pointer leaves the tab bar, so the next X is under the pointer.', VexTabHold.enabled(), (on) => VexTabHold.setEnabled(on));
    toggle('Tab names of my own', '"Rename tab" in a tab\'s menu names a page just for you. The name follows the address.', VexTabNames.enabled(), (on) => VexTabNames.setEnabled(on));
    toggle('Show the last picture while a sleeping tab wakes', 'Pictures of the last 12 tabs you left are kept in memory only, never for private or Tor tabs.', VexTabThumbs.enabled(), (on) => VexTabThumbs.setEnabled(on));
    toggle('Keyboard hints', 'Ctrl+Alt+I labels the links and buttons in view; Ctrl+Alt+Q labels the tabs. Type a label to use it.', VexLinkHints.enabled(), (on) => VexLinkHints.setEnabled(on));
    toggle('Split view keys', 'Ctrl+Alt+O next pane, Ctrl+Alt+Y swap panes, 25/50/75 snaps and double-click the divider.', VexSplitKeys.prefs().on, (on) => { VexSplitKeys.setEnabled(on); this.render(body); });
    if (VexSplitKeys.prefs().on) toggle('Drag a tab onto the page to split', 'While you drag a tab, two targets (left and right) cover the page; drop it on one to split with that tab. Not shown when the screen is already split.', VexSplitKeys.prefs().dragSplit, (on) => VexSplitKeys.save({ dragSplit: on }));
    if (VexSplitKeys.prefs().on) toggle('Alt+click opens a link in the other pane', 'Alt+click normally saves the link. With this on it opens beside the page instead.', VexSplitKeys.prefs().altClick, (on) => VexSplitKeys.save({ altClick: on }));
  },

  init() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({ id: this.ID, title: 'More tab tools', keywords: 'select tabs bulk hold width close rename name thumbnail wake hints split keys', render: (body) => this.render(body) });
    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      VexExtras.registerCommand({ id: 'rename-tab', label: 'Rename this tab', hint: 'A name of your own for this page, shown on the strip', icon: 'edit', action: () => VexTabNames.rename().catch(err => window.showToast?.(err.message, 'error')) });
      VexExtras.registerCommand({ id: 'move-tab-to-window', label: 'Move this tab to a new window', hint: 'Opens this page in a window of its own and closes the tab, with an Undo; a private or Tor tab stays where it is', icon: 'window', action: () => { if (!VexTabNames.enabled()) { window.showToast?.('Tab names are switched off. Turn them on in Settings > More tab tools to move a tab to a window.', 'error'); return; } const t = TabManager.getActiveTab(); VexTabWindow.move(t).catch(err => window.showToast?.((err && err.message) || String(err), 'error')); } });
    }
  },
};

if (typeof window !== 'undefined') window.VexMoreTabToolsSettings = VexMoreTabToolsSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMoreTabToolsSettings };
