// === Open GitHub: the Control Center or github.com directly (js/github-open.js) ===
// "Control Center" is Vex's own GitHub panel (js/github-panel.js: profile, repositories, pull requests, Actions). "Directly" is
// github.com in a tab (github.com/<username> when a username is set in Settings, else github.com).
//
//   vex.githubOpenMode   'ask' (default; unset means ask) | 'control-center' | 'direct'. Anything else is an Error that is shown,
//                        never quietly treated as 'ask'.
//
// Every way of opening the GitHub panel ends in SidebarManager.showPanel('github') (the rail button, its folder, Ctrl+K, the feature
// list, links, the docked sidebar's button), and showPanel hands that one call to open() below, so there is a single place that
// decides. The panel itself is opened with showPanel('github', { chosen: true }), which skips the hand-over.
// The rail button's right-click menu gets menuItems() (js/sidebar.js showContextMenu). Loaded late (js/lazy-boot.js LATE_MODULES);
// js/sidebar.js loads it on demand if a click comes before that.
(function () {
  const KEY = 'vex.githubOpenMode';
  const NAME_KEY = 'vex.githubUsername';
  const MODES = ['ask', 'control-center', 'direct'];
  const EVENT = 'vex:github-open-mode';
  const NEEDS_NAME = 'Set your GitHub username in Settings to use the Control Center';
  const NO_PANEL = 'The Control Center (the GitHub panel) is not available in this window';

  const tr = (s) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup ? (VexI18nUI.lookup(s) || s) : s);

  function report(err) {
    window.VexProblems?.note('GitHub', err.message, err);
    window.showToast?.(err.message, 'error', 9000);
  }

  // ---- The saved choice ---------------------------------------------------------------------------------------------
  function mode() {
    let raw;
    try { raw = localStorage.getItem(KEY); }
    catch (err) { throw new Error('Could not read how GitHub opens: ' + err.message, { cause: err }); }
    if (raw == null) return 'ask';
    if (!MODES.includes(raw)) {
      throw new Error('The saved choice for how GitHub opens ("' + raw + '") is not one of ask, control-center or direct. Pick one again in Settings (When I click GitHub) or in the right-click menu of the GitHub button.');
    }
    return raw;
  }

  function setMode(next) {
    if (!MODES.includes(next)) throw new Error('GitHub can open as ask, control-center or direct, not "' + next + '"');
    try { localStorage.setItem(KEY, next); }
    catch (err) { throw new Error('Could not save how GitHub opens: ' + err.message, { cause: err }); }
    window.dispatchEvent(new CustomEvent('vex:github-open-mode', { detail: { mode: next } }));
    return next;
  }

  const username = () => {
    try { return (localStorage.getItem(NAME_KEY) || '').trim(); }
    catch (err) { throw new Error('Could not read the GitHub username: ' + err.message, { cause: err }); }
  };

  // Why the Control Center cannot open right now, in a sentence a person can act on; null when it can.
  function controlCenterProblem() {
    if (typeof SidebarManager === 'undefined' || typeof GitHubPanel === 'undefined' || !document.getElementById('panel-github')) return NO_PANEL;
    if (!username()) return NEEDS_NAME;
    return null;
  }

  const directUrl = () => { const n = username(); return n ? 'https://github.com/' + encodeURIComponent(n) : 'https://github.com'; };

  // ---- The two ways ---------------------------------------------------------------------------------------------------
  function openDirect() {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not ready yet, so GitHub could not open in a tab');
    if (typeof SidebarManager !== 'undefined' && SidebarManager.activePanel) SidebarManager.hideActivePanel();
    TabManager.createTab(directUrl(), true);
    return 'direct';
  }

  // Opens the panel, or, when it cannot work, says why and offers the other way.
  function openControlCenter(opts) {
    if (controlCenterProblem()) { showChooser(opts); return 'unusable'; }
    SidebarManager.showPanel('github', { chosen: true });
    return 'control-center';
  }

  // The one entry point: what a click on GitHub does, by the saved choice.
  function open(opts) {
    try {
      const m = mode();
      if (m === 'control-center') return openControlCenter(opts);
      if (m === 'direct') return openDirect();
      showChooser(opts);
      return 'asked';
    } catch (err) {
      report(err);
      return 'error';
    }
  }

  // ---- The chooser ------------------------------------------------------------------------------------------------------
  let current = null;
  function close() {
    if (current && current.isConnected && typeof TabManager !== 'undefined') TabManager._dismissMenu(current);
    current = null;
  }

  // The GitHub button of the rail when it is on show (a closed folder hides it); null otherwise.
  function railButton() {
    const b = document.querySelector('#icon-sidebar .sidebar-icon[data-panel="github"]');
    if (!b || b.closest('[inert]') || b.closest('[hidden]')) return null;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? b : null;
  }

  function row(menu, { icon, title, sub, disabled, onPick }) {
    const el = document.createElement('div');
    el.className = 'tab-context-item';
    el.setAttribute('role', 'menuitem');
    el.tabIndex = -1;
    if (disabled) el.setAttribute('aria-disabled', 'true');
    el.style.alignItems = 'flex-start';
    const text = document.createElement('div');
    const t = document.createElement('div');
    t.textContent = tr(title);
    if (disabled) t.style.color = 'var(--vex-text-secondary)';
    text.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.textContent = tr(sub);
      s.style.cssText = 'font-size:11px;margin-top:2px;max-width:230px;white-space:normal;color:var(--vex-text-secondary)';
      text.appendChild(s);
    }
    if (icon && typeof VexIcons !== 'undefined') el.insertAdjacentHTML('afterbegin', VexIcons.svg(icon, { size: 14, className: 'ctx-icon' }));
    el.appendChild(text);
    el.addEventListener('click', () => {
      if (disabled) return;   // it says why it is off; it does not close the menu on a click that does nothing
      close();
      try { onPick(); } catch (err) { report(err); }
    });
    menu.appendChild(el);
    return el;
  }

  function showChooser(opts) {
    if (typeof TabManager === 'undefined' || typeof TabManager._attachMenuDismissal !== 'function') throw new Error('The menu is not ready yet, so GitHub could not ask how to open');
    close();
    const anchor = (opts && opts.anchor) || railButton();
    const problem = controlCenterProblem();
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu vex-github-open';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', tr('Open GitHub'));
    menu.style.minWidth = '250px';
    const head = document.createElement('div');
    head.setAttribute('role', 'presentation');
    head.textContent = tr('Control Center or GitHub directly?');
    head.style.cssText = 'padding:6px 12px 8px;font-size:12px;font-weight:600;color:var(--vex-text-primary)';
    menu.appendChild(head);
    row(menu, { icon: 'git', title: 'Control Center', sub: problem || "Vex's GitHub panel", disabled: !!problem, onPick: () => openControlCenter({ anchor }) });
    row(menu, { icon: 'globe', title: 'GitHub directly', sub: 'Opens github.com in a tab', onPick: () => openDirect() });
    if (problem === NEEDS_NAME) {
      const sep = document.createElement('div');
      sep.className = 'tab-context-sep';
      menu.appendChild(sep);
      row(menu, { icon: 'settings', title: 'Open Settings', onPick: () => SettingsUI.openSection('setting-github-username') });
    }
    // Next to the button when it is on show; otherwise (Ctrl+K, a closed folder) in the middle of the window.
    let x, y;
    if (anchor) { const r = anchor.getBoundingClientRect(); x = r.right + 6; y = r.top; }
    else { x = Math.max(8, Math.round(window.innerWidth / 2 - 135)); y = Math.max(8, Math.round(window.innerHeight / 3)); }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
    TabManager._clampMenuToViewport(menu, x, y);
    TabManager._attachMenuDismissal(menu, { keys: true });
    // Focus goes to the first row that works, so the arrows and Enter act at once.
    const first = [...menu.children].find(el => el.classList.contains('tab-context-item') && !el.hasAttribute('aria-disabled'));
    if (first) first.focus();
    current = menu;
    return menu;
  }

  // ---- The right-click menu of the GitHub button ----------------------------------------------------------------------
  const SAID = {
    ask: 'GitHub will ask each time',
    'control-center': 'GitHub now always opens the Control Center',
    direct: 'GitHub now always opens github.com in a tab',
  };
  function keep(next) {
    setMode(next);
    window.showToast?.(tr(SAID[next]));
    if (next === 'control-center' && controlCenterProblem()) window.showToast?.(tr(controlCenterProblem()), 'error', 7000);
  }

  // Items in the shape js/sidebar.js showContextMenu draws: { label, action, checked } and { separator }.
  function menuItems() {
    let saved = null;
    try { saved = mode(); } catch (err) { report(err); }   // shown; the menu still opens so the choice can be set again
    const anchor = railButton();
    const guard = (fn) => () => { try { fn(); } catch (err) { report(err); } };
    return [
      { label: 'Open Control Center now', action: guard(() => openControlCenter({ anchor })) },
      { label: 'Open GitHub now', action: guard(() => openDirect()) },
      { separator: true },
      { label: 'Keep on Control Center', checked: saved === 'control-center', action: guard(() => keep('control-center')) },
      { label: 'Keep on Direct', checked: saved === 'direct', action: guard(() => keep('direct')) },
      { label: 'Ask every time', checked: saved === 'ask', action: guard(() => keep('ask')) },
      { separator: true },
    ];
  }

  // ---- Settings ------------------------------------------------------------------------------------------------------------
  function wireSetting() {
    const sel = document.getElementById('setting-github-open-mode');
    if (!sel || sel.dataset.ghOpenWired) return;
    sel.dataset.ghOpenWired = '1';
    const note = document.getElementById('setting-github-open-mode-note');
    const paint = () => {
      try { sel.value = mode(); if (note) note.textContent = ''; }
      catch (err) { sel.selectedIndex = -1; if (note) note.textContent = err.message; }
    };
    paint();
    sel.addEventListener('change', () => {
      try { setMode(sel.value); }
      catch (err) { report(err); }
      paint();
    });
    window.addEventListener('vex:github-open-mode', paint);
    document.addEventListener('vex:panel-changed', (e) => { if (e.detail && e.detail.panel === 'settings') paint(); });
  }

  window.VexGithubOpen = { KEY, MODES, EVENT, NEEDS_NAME, NO_PANEL, mode, setMode, controlCenterProblem, directUrl, open, openControlCenter, openDirect, showChooser, close, menuItems, wireSetting };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSetting, { once: true });
  else wireSetting();
})();
