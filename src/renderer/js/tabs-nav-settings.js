// === Settings › Tabs and navigation ============================================
//
// The switches of js/tabs-nav.js, one line each, and the two things it remembers
// (the words searched with the find bar, how often each site was typed) with a
// button to forget each. Also the Ctrl+K command that turns "Keep Vex on top" on or off.
const TabsNavSettings = {
  ID: 'tabs-nav',

  ROWS: [
    ['findOptions', 'Find bar: match case, start from the selection, Up and Down for earlier searches'],
    ['cleanCopy', 'Copy clean link and Copy as Markdown link (address bar and tab menu)'],
    ['textFragment', 'Copy link to selected text (right-click a selection)'],
    ['typedRanking', 'Finish addresses with the sites you type most, never a lookalike'],
    ['switchToTab', 'Enter on an address that is already open goes to that tab'],
    ['addressExtras', 'Address bar extras: Alt+Up one level, Alt+Shift+Up a menu of levels, Shift+Enter a new window, Ctrl+Alt+Shift+S searches the selection, drag the padlock as a link, answers to sums'],
    ['smartPrint', 'Name a printed page or PDF "site - title - date"'],
    ['autoHideChrome', 'In full screen, bring the toolbar and tabs back when the pointer touches the top edge'],
    ['downloadTypes', 'A finished PDF opens in a tab'],
    ['downloadEnter', 'Enter opens the file of the newest finished-download card'],
    ['activityDot', 'A dot on a background tab whose title count goes up, like (3) Inbox'],
  ],

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const redraw = () => this.render(body);
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const N = VexTabsNav;

    const toggle = (label, isOn, apply, disabled) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = isOn; input.disabled = !!disabled; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => {
        Promise.resolve().then(() => apply(input.checked)).then(redraw).catch((err) => { input.checked = !input.checked; fail(err); });
      });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', label), lab);
      body.appendChild(row);
    };

    body.appendChild(el('p', 'setting-info', 'Small helpers for the address bar, the find bar, the tab strip and the window. Nothing here sends anything anywhere.'));
    toggle('Tabs and navigation extras', N.enabled(), (v) => N.setEnabled(v));
    for (const [key, label] of this.ROWS) toggle(label, N.prefs()[key], (v) => N.setPref(key, v), !N.enabled());

    // Installers ask where to save (a main-process choice: downloads:set-ask-types).
    const askRow = el('div', 'setting-toggle-row');
    const askLab = el('label', 'toggle');
    const askIn = document.createElement('input');
    askIn.type = 'checkbox'; askIn.disabled = true; askIn.setAttribute('aria-label', 'Installers and scripts always ask where to save');
    askLab.append(askIn, el('span', 'toggle-slider'));
    askRow.append(el('span', 'setting-label-text', 'Installers and scripts (' + N.INSTALLER_KINDS.join(', ') + ') always ask where to save'), askLab);
    body.appendChild(askRow);
    if (window.vex && typeof window.vex.downloadsPrefs === 'function') {
      window.vex.downloadsPrefs().then((p) => {
        askIn.checked = Array.isArray(p.askTypes) && N.INSTALLER_KINDS.every(k => p.askTypes.includes(k));
        askIn.disabled = false;
        askIn.addEventListener('change', () => {
          const keep = (p.askTypes || []).filter(k => !N.INSTALLER_KINDS.includes(k));
          window.vex.downloadsSetAskTypes(askIn.checked ? [...keep, ...N.INSTALLER_KINDS] : keep)
            .then((r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'Vex did not answer'); p.askTypes = r.askTypes; })
            .catch((err) => { askIn.checked = !askIn.checked; fail(err); });
        });
      }).catch(fail);
    }

    // Smooth scrolling is a launch setting for the page engine: it takes a restart.
    toggle('Smooth scrolling (restart Vex to apply)', localStorage.getItem('vex.smoothScroll') !== 'off', (v) => {
      localStorage.setItem('vex.smoothScroll', v ? 'on' : 'off');
      if (typeof window.vexRestartNeeded === 'function') window.vexRestartNeeded();
    }, !N.enabled());

    const priv = typeof VexTabPolicy !== 'undefined' && VexTabPolicy.isPrivateWindow;
    toggle('Keep Vex on top of other windows', N.prefs().keepOnTop, (v) => N.setKeepOnTop(v), !N.enabled() || priv);
    body.appendChild(el('p', 'setting-info', priv
      ? 'Change this in a normal window.'
      : 'Only Vex\'s own window. It lets go while a full-screen game has the screen and comes back when the game is over.'));

    // The zoom of a page that has none of its own.
    const zoomRow = el('div', 'setting-row');
    const zoomSel = document.createElement('select');
    zoomSel.setAttribute('aria-label', 'Default page zoom');
    zoomSel.disabled = !N.enabled();
    for (const pct of [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300]) {
      const o = document.createElement('option'); o.value = String(pct); o.textContent = pct + '%'; zoomSel.appendChild(o);
    }
    zoomSel.value = String(N.defaultZoomPercent());
    if (zoomSel.value !== String(N.defaultZoomPercent())) { const o = document.createElement('option'); o.value = String(N.defaultZoomPercent()); o.textContent = N.defaultZoomPercent() + '%'; zoomSel.appendChild(o); zoomSel.value = o.value; }
    zoomSel.addEventListener('change', () => { try { N.setDefaultZoomPercent(Number(zoomSel.value)); } catch (err) { fail(err); } });
    zoomRow.append(el('span', 'setting-label-text', 'Default page zoom (a page you zoomed yourself keeps its own)'), zoomSel);
    body.appendChild(zoomRow);

    const forget = (label, run) => {
      const b = el('button', 'btn-secondary', label); b.type = 'button';
      b.addEventListener('click', () => { try { run(); window.showToast?.('Forgotten'); } catch (err) { fail(err); } });
      const r = el('div', 'setting-row'); r.appendChild(b); body.appendChild(r);
    };
    forget('Forget earlier find-bar searches', () => N.findHistory.clear());
    forget('Forget which sites I type most', () => N.typed.clear());
  },
};

if (typeof window !== 'undefined') {
  window.TabsNavSettings = TabsNavSettings;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: TabsNavSettings.ID, title: 'Tabs and navigation', keywords: 'find match case clean link markdown text fragment autocomplete switch to tab alt up keep on top always on top activity dot print pdf file name full screen toolbar smooth scrolling download pdf installer ask enter open search selection new window path', render: (body) => TabsNavSettings.render(body) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'search-selection', label: 'Search the web for the selection', hint: 'Opens the words selected on this page in a new tab, with your search engine (Ctrl+Alt+Shift+S)', icon: 'search',
      action: () => { VexTabsNav.searchSelection().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } });
    VexExtras.registerCommand({ id: 'address-levels', label: 'Go to a higher level of this address', hint: 'A menu of every level of the address in front: the site, then each folder (Alt+Shift+Up in the address bar)', icon: 'link',
      action: () => {
        try {
          const tab = TabManager.getActiveTab();
          const bar = document.getElementById('url-input');
          VexTabsNav.showSegments(bar, tab ? tab.url : '', (u) => { if (typeof window.VexSubmitTyped === 'function') window.VexSubmitTyped(u, false); else TabManager.createTab(u, true); });
        } catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
      } });
  }
  if (typeof VexModuleCommands !== 'undefined') {
    VexModuleCommands.set('tabsnav:', [{
      id: 'tabsnav:keep-on-top',
      label: 'Keep Vex on top (toggle)',
      hint: 'Vex\'s own window stays above other windows; it lets go for a full-screen game',
      icon: 'pin',
      action: () => {
        const on = !VexTabsNav.prefs().keepOnTop;
        VexTabsNav.setKeepOnTop(on).catch((err) => window.showToast?.((err && err.message) || String(err), 'error'));
      },
    }]);
  }
}
