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
// The tabs down the side (the vertical layout, js/tabs.js) get the same, with
// Up/Down for the arrows. They are drawn as up to three lists — pinned tabs,
// the groups, then the loose tabs — and the keys walk them as ONE list with ONE
// tab stop. Each list is a vertical tablist; a group is a labelled role=group
// holding its header (a button that says whether it is open) and its own
// tablist. A tab's name carries what the icons show: pinned, sleeping, playing
// or muted, private or Tor, and the group it is in.
//
// Both are rebuilt on every change, so the roles are put back by a
// MutationObserver after each rebuild rather than in the renderers, and focus
// that was on a tab follows the same tab (or group) into the new markup.
const VexA11yKeys = (() => {
  const STRIP = {
    rootId: 'top-tabs-list',
    stop: '.top-tab, .top-group-label',
    active: '.top-tab.active',
    next: 'ArrowRight', prev: 'ArrowLeft',
    root: null,
  };
  const SIDE = {
    rootId: 'tabs-sidebar',
    stop: '.pinned-tab, .tab-group-header, .tab-item',
    active: '.tab-item.active, .pinned-tab.active',
    next: 'ArrowDown', prev: 'ArrowUp',
    root: null,
  };
  let refocus = null;            // what to focus after the next rebuild
  let lastFocused = null;        // the stop that had focus, to follow through a rebuild

  function stops(L) {
    return L.root ? [...L.root.querySelectorAll(L.stop)].filter(el => el.getClientRects().length) : [];
  }

  // Which tab, group or stack a stop stands for, so the same one can be found
  // again in rebuilt markup.
  function keyOf(el) {
    if (el.dataset.tabId) return { tabId: el.dataset.tabId };
    const g = el.closest('[data-group-id]');
    if (g) return { groupId: g.dataset.groupId };
    if (el.dataset.stackId) return { stackId: el.dataset.stackId };
    return null;
  }
  function findKey(L, key) {
    if (!key) return null;
    return stops(L).find(s => {
      const k = keyOf(s);
      return k && ((key.tabId && k.tabId === key.tabId && !s.classList.contains('tab-group-header'))
        || (key.groupId && k.groupId === key.groupId && s.matches('.tab-group-header, .top-group-label'))
        || (key.stackId && k.stackId === key.stackId));
    }) || null;
  }

  function hideInner(el) {
    // The close cross is for the mouse; Delete closes from the keyboard. A
    // focusable button inside a tab is also a nested control to a reader.
    for (const b of el.querySelectorAll('button, [role=button]')) b.tabIndex = -1;
    for (const img of el.querySelectorAll('img:not([alt])')) img.alt = '';
  }

  // Roles, names and the single tab stop for the strip. Idempotent: the
  // observer only watches the list's children, so setting attributes here does
  // not re-fire it.
  function decorateStrip() {
    const listEl = STRIP.root;
    if (!listEl) return;
    const all = [...listEl.querySelectorAll(STRIP.stop)];
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
      hideInner(el);
    }
    settle(STRIP, current || all.find(el => el.getClientRects().length) || all[0]);
  }

  // What a side tab is, read from the tab itself when TabManager has it (a
  // pinned tab's icon shows none of it) and from what is drawn otherwise.
  function sideTabName(el) {
    const id = el.dataset.tabId;
    const tab = (id && typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)) ? TabManager.tabs.find(t => t.id === id) : null;
    const title = (tab && tab.title) || (el.querySelector('.tab-title') || {}).textContent || el.getAttribute('title') || 'New Tab';
    const states = [];
    const has = (cls) => el.classList.contains(cls);
    if (has('pinned-tab') || (tab && tab.pinned)) states.push('pinned');
    if ((tab && tab.sleeping) || has('sleeping')) states.push('sleeping');
    if (tab ? (tab.audible && !tab.muted) : el.querySelector('.tab-audio:not(.muted)')) states.push('playing audio');
    if (tab ? tab.muted : el.querySelector('.tab-audio.muted')) states.push('muted');
    for (const c of el.querySelectorAll('.tab-capture[aria-label]')) states.push(c.getAttribute('aria-label').toLowerCase());
    const part = tab ? String(tab.partition || '') : '';
    if (has('tor-tab') || part.startsWith('tor-')) states.push('Tor');
    else if (has('private-tab') || (part && !part.startsWith('persist:'))) states.push('private');
    if (el.querySelector('.tab-unread')) states.push('unread');
    const group = el.closest('.tab-group');
    const gname = group && group.querySelector('.tab-group-name');
    if (gname && gname.textContent) states.push('in group ' + gname.textContent);
    if (has('in-stack')) states.push('in a stack');
    return title + (states.length ? ' (' + states.join(', ') + ')' : '');
  }

  // A tablist with no tab in it is an error to a reader (and to axe): the loose
  // list is empty whenever every tab is pinned or in a group.
  function asTablist(el, label) {
    if (el.querySelector('.tab-item, .pinned-tab')) {
      el.setAttribute('role', 'tablist');
      el.setAttribute('aria-orientation', 'vertical');
      el.setAttribute('aria-label', label);
    } else {
      for (const a of ['role', 'aria-orientation', 'aria-label']) el.removeAttribute(a);
    }
  }

  function decorateSide() {
    const side = SIDE.root;
    if (!side) return;
    const list = document.getElementById('tabs-list');
    if (list) asTablist(list, 'Tabs');
    const pinned = side.querySelector('.pinned-tabs-container');
    if (pinned) asTablist(pinned, 'Pinned tabs');
    for (const g of side.querySelectorAll('.tab-group')) {
      const name = ((g.querySelector('.tab-group-name') || {}).textContent || 'Unnamed').trim();
      const count = ((g.querySelector('.tab-group-count') || {}).textContent || '').trim();
      const open = !g.classList.contains('collapsed');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', 'Group ' + name);
      const head = g.querySelector('.tab-group-header');
      if (head) {
        head.setAttribute('role', 'button');
        head.setAttribute('aria-expanded', String(open));
        // Open or folded is aria-expanded's to say ("collapsed" to a reader).
        head.setAttribute('aria-label', `Group ${name}, ${count || 0} tab${count === '1' ? '' : 's'}`);
        head.querySelector('.tab-group-dot')?.setAttribute('aria-hidden', 'true');
      }
      const body = g.querySelector('.tab-group-tabs');
      if (body) asTablist(body, name + ' tabs');
    }
    const all = [...side.querySelectorAll(SIDE.stop)];
    let current = null;
    for (const el of all) {
      el.tabIndex = -1;
      if (el.classList.contains('tab-group-header')) continue;
      el.setAttribute('role', 'tab');
      if (el.classList.contains('tab-stack')) {
        el.setAttribute('aria-selected', 'false');
        el.setAttribute('aria-expanded', String(el.classList.contains('expanded')));
        const n = el.querySelector('.tab-stack-count');
        const t = el.querySelector('.tab-title');
        el.setAttribute('aria-label', `Stack: ${(t && t.textContent) || ''}, ${(n && n.textContent) || ''} tabs`);
      } else {
        const on = el.classList.contains('active');
        el.setAttribute('aria-selected', String(on));
        if (on) current = el;
        el.setAttribute('aria-label', sideTabName(el));
        el.setAttribute('aria-keyshortcuts', 'Delete');
      }
      hideInner(el);
    }
    settle(SIDE, current || all.find(el => el.getClientRects().length) || all[0]);
  }

  // One tab stop, and focus put back where it belongs after a rebuild: on what
  // a key press asked for, or on the same tab the keyboard was on when its
  // element was thrown away and replaced.
  function settle(L, first) {
    if (first) first.tabIndex = 0;
    const lost = lastFocused && !lastFocused.isConnected && L.root && lastFocused.__vexA11yList === L
      && (!document.activeElement || document.activeElement === document.body);
    if (!refocus && !lost) return;
    const want = refocus || keyOf(lastFocused) || {};
    if (refocus && refocus.list && refocus.list !== L) return;
    refocus = null;
    const target = findKey(L, want)
      || (want.index != null && stops(L)[Math.min(want.index, stops(L).length - 1)])
      || L.root.querySelector(L.active) || first;
    if (target) {
      stops(L).forEach(s => { s.tabIndex = -1; });
      target.tabIndex = 0;
      target.focus();
    }
  }

  function move(from, to) {
    if (!to || to === from) return;
    from.tabIndex = -1;
    to.tabIndex = 0;
    to.focus();
    to.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function onKey(L, e) {
    const el = e.target.closest && e.target.closest(L.stop);
    if (!el || !L.root || !L.root.contains(el) || e.ctrlKey || e.altKey || e.metaKey) return;
    const list = stops(L);
    const i = list.indexOf(el);
    const tabId = el.dataset.tabId || null;
    switch (e.key) {
      case L.next: case L.prev: {
        e.preventDefault();
        const step = e.key === L.next ? 1 : -1;
        move(el, list[(i + step + list.length) % list.length]);
        return;
      }
      case 'Home': e.preventDefault(); move(el, list[0]); return;
      case 'End': e.preventDefault(); move(el, list[list.length - 1]); return;
      case 'Enter': case ' ': {
        e.preventDefault();
        // Whatever a click does (switch, fold a group, open a stack), with
        // focus put back on the same item after the list is rebuilt.
        refocus = { list: L, ...(keyOf(el) || {}), index: i };
        el.click();
        // A click that changed nothing does not rebuild the list.
        setTimeout(() => { if (refocus) { refocus = null; if (document.contains(el)) el.focus(); } }, 300);
        return;
      }
      case 'Delete': {
        if (!tabId || typeof TabManager === 'undefined') return;
        e.preventDefault();
        refocus = { list: L };
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

  // Remember the stop the keyboard is on. Leaving it on purpose (a click
  // elsewhere, Tab onwards) forgets it; losing it because the list was rebuilt
  // under it does not, so decorate can put focus back.
  function track(L) {
    L.root.addEventListener('focusin', (e) => {
      const el = e.target.closest && e.target.closest(L.stop);
      if (el) { el.__vexA11yList = L; lastFocused = el; }
    });
    L.root.addEventListener('focusout', (e) => {
      const el = e.target;
      setTimeout(() => { if (lastFocused === el && el.isConnected && document.activeElement !== el) lastFocused = null; }, 0);
    });
  }

  function initStrip() {
    const listEl = document.getElementById(STRIP.rootId);
    if (!listEl || listEl.dataset.a11yWired) return;
    STRIP.root = listEl;
    listEl.dataset.a11yWired = '1';
    listEl.setAttribute('role', 'tablist');
    listEl.setAttribute('aria-orientation', 'horizontal');
    if (!listEl.getAttribute('aria-label')) listEl.setAttribute('aria-label', 'Tabs');
    listEl.addEventListener('keydown', (e) => onKey(STRIP, e));
    track(STRIP);
    new MutationObserver(decorateStrip).observe(listEl, { childList: true });
    decorateStrip();
  }

  // The side list changes in place as well as by rebuild (a group folds by a
  // class, a tab falls asleep by a class and a badge), so the observer watches
  // the whole subtree and class changes, and runs once per burst. decorate
  // never changes a class or adds a node, so it does not wake itself.
  function initSide() {
    const side = document.getElementById(SIDE.rootId);
    if (!side || side.dataset.a11yWired) return;
    SIDE.root = side;
    side.dataset.a11yWired = '1';
    side.addEventListener('keydown', (e) => onKey(SIDE, e));
    track(SIDE);
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; decorateSide(); });
    }).observe(side, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    decorateSide();
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
    initSide();
    if (!document.__vexA11yEsc) {
      document.__vexA11yEsc = true;
      document.addEventListener('keydown', onDocKey);
    }
  }

  function decorate() { decorateStrip(); decorateSide(); }

  return {
    init, decorate,
    _onListKey: (e) => onKey(STRIP, e),
    _onSideKey: (e) => onKey(SIDE, e),
    _onDocKey: onDocKey,
  };
})();

if (typeof window !== 'undefined') {
  window.VexA11yKeys = VexA11yKeys;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexA11yKeys.init());
  else VexA11yKeys.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexA11yKeys };
