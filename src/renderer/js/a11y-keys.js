// === Keyboard and screen-reader wiring for the main window =================
//
// Found by walking the window with Tab alone (2026-10-02):
//   - the tabs on the strip could not be reached at all: Tab went from the
//     toolbar straight to each tab's close button, so a keyboard user could
//     close a tab but never switch to one;
//   - Escape did not close the panel you were in;
//   - nothing told a screen reader which tab was selected.
//
// The strip is therefore a tablist with one tab stop: Tab lands on the
// selected tab, Left/Right (and Home/End) move between tabs, Enter or Space
// switches to the one with focus, Delete closes it, and Shift+F10 or the menu
// key opens its right-click menu. A group label or stack chip is a stop on the
// same strip; Enter opens or folds it. The close crosses stay for the mouse and
// leave the Tab order (Delete does their job).
//
// horizontal-tabs.js rebuilds the strip on every change, so the roles are put
// back by a MutationObserver after each rebuild rather than in the renderer.
const VexA11yKeys = (() => {
  const STOP = '.top-tab, .top-group-label';
  let listEl = null;
  let refocus = null;            // what to focus after the next rebuild

  function stops() {
    return listEl ? [...listEl.querySelectorAll(STOP)].filter(el => el.getClientRects().length) : [];
  }

  // Roles, names and the single tab stop. Idempotent: the observer below only
  // watches the list's children, so setting attributes here does not re-fire it.
  function decorate() {
    if (!listEl) return;
    const all = [...listEl.querySelectorAll(STOP)];
    let current = null;
    for (const el of all) {
      el.setAttribute('role', 'tab');
      el.tabIndex = -1;
      if (el.classList.contains('top-group-label')) {
        // A group label folds its tabs away; it is never "the selected tab".
        el.setAttribute('aria-selected', 'false');
        const next = el.nextElementSibling;
        el.setAttribute('aria-expanded', String(!!(next && next.classList.contains('in-group'))));
      } else if (el.classList.contains('top-stack')) {
        el.setAttribute('aria-selected', 'false');
        el.setAttribute('aria-expanded', String(el.classList.contains('expanded')));
        const n = el.querySelector('.top-stack-count');
        const t = el.querySelector('.tab-title');
        el.setAttribute('aria-label', `Stack: ${(t && t.textContent) || ''}, ${(n && n.textContent) || ''} tabs`);
      } else {
        const on = el.classList.contains('active');
        el.setAttribute('aria-selected', String(on));
        if (on) current = el;
        const title = el.querySelector('.tab-title');
        const states = [];
        if (el.classList.contains('pinned')) states.push('pinned');
        if (el.classList.contains('sleeping')) states.push('sleeping');
        if (el.querySelector('.audio-indicator:not(.muted)')) states.push('playing audio');
        if (el.querySelector('.audio-indicator.muted')) states.push('muted');
        if (el.classList.contains('tor-tab')) states.push('Tor');
        else if (el.classList.contains('private-tab')) states.push('private');
        el.setAttribute('aria-label', ((title && title.textContent) || 'New Tab') + (states.length ? ' (' + states.join(', ') + ')' : ''));
        el.setAttribute('aria-keyshortcuts', 'Delete');
      }
      // The close cross is for the mouse; Delete closes from the keyboard. A
      // focusable button inside a tab is also a nested control to a reader.
      for (const b of el.querySelectorAll('button, [role=button]')) b.tabIndex = -1;
      for (const img of el.querySelectorAll('img:not([alt])')) img.alt = '';
    }
    const first = current || all.find(el => el.getClientRects().length) || all[0];
    if (first) first.tabIndex = 0;
    if (refocus) {
      const want = refocus;
      refocus = null;
      const target = (want.tabId && listEl.querySelector(`.top-tab[data-tab-id="${CSS.escape(want.tabId)}"]`))
        || (want.index != null && stops()[want.index])
        || listEl.querySelector('.top-tab.active') || first;
      if (target) { stops().forEach(s => { s.tabIndex = -1; }); target.tabIndex = 0; target.focus(); }
    }
  }

  function move(from, to) {
    if (!to || to === from) return;
    from.tabIndex = -1;
    to.tabIndex = 0;
    to.focus();
    to.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function onListKey(e) {
    const el = e.target.closest && e.target.closest(STOP);
    if (!el || !listEl.contains(el) || e.ctrlKey || e.altKey || e.metaKey) return;
    const list = stops();
    const i = list.indexOf(el);
    const tabId = el.dataset.tabId || null;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowLeft': {
        e.preventDefault();
        const step = e.key === 'ArrowRight' ? 1 : -1;
        move(el, list[(i + step + list.length) % list.length]);
        return;
      }
      case 'Home': e.preventDefault(); move(el, list[0]); return;
      case 'End': e.preventDefault(); move(el, list[list.length - 1]); return;
      case 'Enter': case ' ': {
        e.preventDefault();
        // Whatever a click does (switch, fold a group, open a stack), with
        // focus put back on the same item after the strip is rebuilt.
        refocus = tabId ? { tabId } : { index: i };
        el.click();
        // A click that changed nothing does not rebuild the strip.
        setTimeout(() => { if (refocus) { refocus = null; if (document.contains(el)) el.focus(); } }, 300);
        return;
      }
      case 'Delete': {
        if (!tabId || typeof TabManager === 'undefined') return;
        e.preventDefault();
        refocus = { tabId: null };
        TabManager.closeTab(tabId);
        return;
      }
      case 'ContextMenu': case 'F10': {
        if (e.key === 'F10' && !e.shiftKey) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 12), clientY: Math.round(r.bottom - 4), button: 2 }));
        return;
      }
      default:
    }
  }

  function initStrip() {
    listEl = document.getElementById('top-tabs-list');
    if (!listEl || listEl.dataset.a11yWired) return;
    listEl.dataset.a11yWired = '1';
    listEl.setAttribute('role', 'tablist');
    listEl.setAttribute('aria-orientation', 'horizontal');
    if (!listEl.getAttribute('aria-label')) listEl.setAttribute('aria-label', 'Tabs');
    listEl.addEventListener('keydown', onListKey);
    new MutationObserver(decorate).observe(listEl, { childList: true });
    decorate();
  }

  // Escape closes the panel you are in (Settings, Notes, History…) and puts
  // you back on what opened it. Only when focus is IN the panel, and only if
  // nothing inside it used the key first (a search box clearing itself, a
  // dialog, a menu).
  function onDocKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('.vex-dialog-overlay')) return;
    if (typeof SidebarManager === 'undefined' || !SidebarManager.activePanel) return;
    const host = document.getElementById('panels-container');
    const head = document.getElementById('look-sb-head');
    const a = document.activeElement;
    if (!a || !((host && host.contains(a)) || (head && head.contains(a)))) return;
    if (a.matches('input, textarea, select, [contenteditable="true"]') && a.value) return;   // let a filled box keep its Escape
    const name = SidebarManager.activePanel;
    e.preventDefault();
    SidebarManager.hideActivePanel();
    const back = document.querySelector(`.sidebar-icon[data-panel="${CSS.escape(name)}"]`);
    const target = [back, document.getElementById('btn-look-sidebar'), document.getElementById('url-input')]
      .find(el => el && el.getClientRects().length);
    if (target) target.focus();
  }

  function init() {
    initStrip();
    if (!document.__vexA11yEsc) {
      document.__vexA11yEsc = true;
      document.addEventListener('keydown', onDocKey);
    }
  }

  return { init, decorate, _onListKey: onListKey, _onDocKey: onDocKey };
})();

if (typeof window !== 'undefined') {
  window.VexA11yKeys = VexA11yKeys;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexA11yKeys.init());
  else VexA11yKeys.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexA11yKeys };
