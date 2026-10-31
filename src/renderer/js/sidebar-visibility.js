// === Sidebar on or off =======================================================
// "The sidebar" is the strip that opens Vex's own panels (Discord, Spotify, Notes, Downloads...):
//   * the icon rail (#icon-sidebar) with its panel buttons, the Start and Settings buttons and the pinned web apps,
//   * the toolbar button that opens a side panel (#btn-look-sidebar, Chrome / Safari / IE and friends),
//   * and the side panel docked beside the page.
// It is NOT the tab list (#tabs-sidebar, Classic's vertical tabs): that is where the tabs are, and Settings › Tab Layout owns it.
//
//   vex.sidebar   'off' hides all of that, in every look. Missing or 'on' = shown. A profile that never answered keeps
//                 the sidebar it has always had (a new default never reaches a saved profile), so nothing here is migrated.
//
// With the sidebar off (body[data-sidebar="off"], css/sidebar-visibility.css):
//   * every panel still opens from Ctrl+K or a shortcut, over the whole page area (in the docked looks as the maximized panel);
//   * Settings, which lived on the rail, gets a gear button in the toolbar so it is never out of reach;
//   * Classic, whose panels have no header of their own, gets a close button on the panel.
// The setup wizard asks the question (js/onboarding.js, step 'sidebar') and Settings › Sidebar switches it back on.
(function () {
  const KEY = 'vex.sidebar';
  const OFF = 'off';
  const EVENT = 'vex:sidebar-visibility';

  function read() {
    try { return localStorage.getItem(KEY); }
    catch (err) { throw new Error('Could not read the sidebar setting: ' + err.message, { cause: err }); }
  }
  // Shown unless the person said no.
  function enabled() { return read() !== OFF; }
  // Has the question been answered (the wizard step, or the Settings switch)?
  function chosen() { const v = read(); return v === OFF || v === 'on'; }

  function apply() {
    if (enabled()) document.body.removeAttribute('data-sidebar');
    else document.body.dataset.sidebar = OFF;
    const box = document.getElementById('setting-sidebar');
    if (box) box.checked = enabled();
  }

  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? 'on' : OFF); }
    catch (err) { throw new Error('Could not save the sidebar setting: ' + err.message, { cause: err }); }
    apply();
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { enabled: !!on } }));
    return !!on;
  }

  // The gear that takes the place of the rail's Settings button, and the close button for a panel in Classic.
  function buildButtons() {
    const gear = document.getElementById('btn-settings-top');
    if (gear) {
      gear.innerHTML = VexIcons.svg('settings', { size: 16 });
      gear.addEventListener('click', () => {
        if (typeof SidebarManager === 'undefined') throw new Error('Settings cannot open: the panels are not loaded');
        SidebarManager.openPanel('settings');
      });
      if (typeof VexI18nUI !== 'undefined') VexI18nUI.translateEl(gear);
    }
    const area = document.getElementById('content-area');
    if (area && !document.getElementById('sb-off-close')) {
      const x = document.createElement('button');
      x.id = 'sb-off-close';
      x.type = 'button';
      x.title = 'Close this panel';
      x.setAttribute('aria-label', 'Close this panel');
      x.innerHTML = VexIcons.svg('x', { size: 14 });
      x.addEventListener('click', () => {
        if (typeof SidebarManager === 'undefined') throw new Error('The panels are not loaded');
        SidebarManager.hideActivePanel();
      });
      area.appendChild(x);
      if (typeof VexI18nUI !== 'undefined') VexI18nUI.translateEl(x);
    }
  }

  function init() {
    buildButtons();
    apply();
    const box = document.getElementById('setting-sidebar');
    if (box) {
      box.addEventListener('change', () => {
        try { setEnabled(box.checked); }
        catch (err) { box.checked = enabled(); window.showToast?.(err.message, 'error'); }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VexSidebarVisibility = { KEY, enabled, chosen, setEnabled, apply };
})();
