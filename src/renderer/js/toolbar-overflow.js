// === Toolbar overflow — buttons that do not fit go into a "more" menu ===
// In a narrow or scaled window the Classic toolbar squeezed the address field
// down to 60px, then slid its right-hand buttons under the window controls and,
// at 1000px / 150%, pushed Close off the window (walkthrough H1, 2026-10-07).
// Now, whenever the toolbar does not fit:
//   1. it goes compact (the logo's "Vex" text and the workspace name hide),
//   2. then the least-used buttons move, one at a time, into a menu behind a
//      chevron button, until the address field has room again.
// Window controls are never moved. Works the same in every look; a look whose
// toolbar fits (the browser looks keep their controls in the tab row) never
// shows the chevron.
(function () {
  'use strict';

  // The address field keeps at least this much room (CSS px of #url-input).
  const MIN_URL_INPUT = 160;
  // First to go first. Window controls and Back/Forward/Reload never go.
  const ORDER = [
    'btn-restart-app', 'btn-onboarding', 'btn-tor', 'btn-notes-top', 'btn-dev-dash',
    'btn-split', 'btn-downloads-top', 'btn-profile', 'btn-look-sidebar',
    'btn-extensions', 'btn-toggle-ai', 'btn-command',
  ];
  // Status pills, not buttons: they hide themselves and are never moved.
  // Simple mode's All features is the way back to everything: it never hides.
  const NEVER = new Set(['tor-running', 'timer-pill', 'btn-routing', 'btn-site-rules', 'window-controls', 'btn-toolbar-overflow', 'btn-all-features']);

  let bar = null, more = null, menu = null;
  let moved = [];          // elements currently in the menu, in ORDER order
  let proxied = null;      // the element standing in under the chevron after a menu click
  let scheduled = false;

  const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';

  // Everything that may move, first-to-go first: the known ids, then any other
  // button another module put in the right-hand cluster (the Toolbox button).
  function candidates() {
    const out = [];
    for (const id of ORDER) {
      const el = document.getElementById(id);
      if (el && bar.contains(el) && !el.closest('#url-bar') && visible(el)) out.push(el);
    }
    const right = document.getElementById('top-bar-right');
    if (right) {
      const extra = [...right.children].filter(el => el.tagName === 'BUTTON' && !NEVER.has(el.id) && !ORDER.includes(el.id) && visible(el));
      out.splice(Math.min(2, out.length), 0, ...extra);
    }
    return out;
  }

  // The toolbar fits when nothing is clipped or pushed off the bar and the
  // address field has its room.
  function fits() {
    const barRect = bar.getBoundingClientRect();
    if (!barRect.width) return true;               // hidden (full screen) — nothing to do
    const input = document.getElementById('url-input');
    if (visible(input) && bar.contains(input) && input.getBoundingClientRect().width < MIN_URL_INPUT) return false;
    const right = document.getElementById('top-bar-right');
    if (right && visible(right) && right.scrollWidth > right.clientWidth + 1) return false;
    if (bar.scrollWidth > bar.clientWidth + 1) return false;
    const wc = document.getElementById('window-controls');
    if (visible(wc) && bar.contains(wc) && wc.getBoundingClientRect().right > barRect.right + 1) return false;
    return true;
  }

  function clearProxy() {
    if (!proxied) return;
    proxied.classList.remove('tb-overflow-proxy');
    proxied.style.removeProperty('--tb-proxy-left');
    proxied.style.removeProperty('--tb-proxy-top');
    proxied = null;
  }

  function relayout() {
    scheduled = false;
    if (!bar || !more) return;
    clearProxy();
    for (const el of moved) el.classList.remove('tb-overflowed');
    moved = [];
    bar.classList.remove('tb-compact');
    more.hidden = true;
    if (fits()) { closeMenu(); return; }
    bar.classList.add('tb-compact');
    if (fits()) { closeMenu(); return; }
    more.hidden = false;
    for (const el of candidates()) {
      el.classList.add('tb-overflowed');
      moved.push(el);
      if (fits()) break;
    }
    if (!moved.length) more.hidden = true;
    if (menu) renderMenu();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(relayout);
  }

  function labelOf(el) {
    const t = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.id;
    return String(t).replace(/\s+/g, ' ').trim();
  }

  function renderMenu() {
    menu.textContent = '';
    for (const el of moved) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tb-overflow-item';
      row.setAttribute('role', 'menuitem');
      const ico = document.createElement('span');
      ico.className = 'tb-overflow-ico';
      const svg = el.querySelector('svg');
      if (svg) ico.appendChild(svg.cloneNode(true));
      const label = document.createElement('span');
      label.className = 'tb-overflow-label';
      label.textContent = labelOf(el);
      row.append(ico, label);
      row.addEventListener('click', () => invoke(el));
      menu.appendChild(row);
    }
    if (!moved.length) closeMenu();
  }

  // The real button runs, standing in (invisibly) where the chevron is, so a
  // menu it opens under itself (Downloads, Extensions, Profiles) opens there.
  function invoke(el) {
    closeMenu();
    clearProxy();
    const r = more.getBoundingClientRect();
    el.style.setProperty('--tb-proxy-left', r.left + 'px');
    el.style.setProperty('--tb-proxy-top', r.top + 'px');
    el.classList.add('tb-overflow-proxy');
    proxied = el;
    el.click();
  }

  function onDocDown(e) { if (menu && !menu.contains(e.target) && !more.contains(e.target)) closeMenu(); }
  function onKey(e) {
    if (!menu) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); more.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('.tb-overflow-item')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items[next].focus();
    }
  }

  function openMenu() {
    if (menu) { closeMenu(); return; }
    clearProxy();
    menu = document.createElement('div');
    menu.id = 'toolbar-overflow-menu';
    menu.className = 'tb-overflow-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'More tools');
    renderMenu();
    if (!menu) return;
    document.body.appendChild(menu);
    const r = more.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    menu.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 14) + 'px';
    more.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    const first = menu.querySelector('.tb-overflow-item');
    if (first) first.focus();
  }

  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', closeMenu);
  }

  function init() {
    bar = document.getElementById('top-bar');
    const right = document.getElementById('top-bar-right');
    if (!bar || !right) throw new Error('[ToolbarOverflow] #top-bar / #top-bar-right missing');
    more = document.createElement('button');
    more.id = 'btn-toolbar-overflow';
    more.type = 'button';
    more.className = 'nav-btn';
    more.title = 'More tools';
    more.setAttribute('aria-label', 'More tools');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.hidden = true;
    more.innerHTML = VexIcons.svg('chevron-down', { size: 16 });
    more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
    right.appendChild(more);

    new ResizeObserver(schedule).observe(bar);
    window.addEventListener('resize', schedule);
    // A button shown or hidden, added by another module, or moved by the
    // layout editor; a look or UI size switched.
    new MutationObserver((records) => {
      if (records.some(r => r.target !== more && !(menu && menu.contains(r.target)))) schedule();
    }).observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['data-gui-style', 'data-ui-size', 'data-tab-layout', 'data-ui-mode', 'class'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    schedule();
  }

  const api = { init, relayout, fits, candidates: () => candidates(), moved: () => moved.slice(), MIN_URL_INPUT, ORDER };
  if (typeof window !== 'undefined') window.ToolbarOverflow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof VexIcons !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})();
