// === Toolbar overflow — buttons that do not fit go into a "more" menu ===
// In a narrow or scaled window the Classic toolbar squeezed the address field
// down to 60px, then slid its right-hand buttons under the window controls and,
// at 1000px / 150%, pushed Close off the window (walkthrough H1, 2026-10-07).
// Now, whenever the toolbar does not fit:
//   1. it goes compact (the logo's "Vex" text and the workspace name hide),
//   2. then the least-used buttons move, one at a time, into a menu behind a
//      chevron button, until the address field has room again. That includes
//      the buttons inside the address bar (Copy URL, Summarize, the bookmark
//      star) and the sidebar toggle on the left: at 1000px / 150% the Classic
//      address field was still 60px wide with every right-hand button moved,
//      and Glass's was 155px at 1280px (2026-10-08),
//   3. and when nothing is left to move, the logo goes too.
// Window controls, Back/Forward/Reload and the page-zoom pill are never moved.
// Works the same in every look; a look whose toolbar fits never shows the
// chevron.
(function () {
  'use strict';

  // The address field keeps at least this much room (CSS px of #url-input)
  // whenever the window allows it: enough to read a whole domain and a path.
  const MIN_URL_INPUT = 280;
  // First to go first. Window controls and Back/Forward/Reload never go.
  const ORDER = [
    'btn-restart-app', 'btn-onboarding', 'btn-tor', 'btn-notes-top', 'btn-dev-dash',
    'btn-copy-url', 'btn-ai-summarize',
    'btn-split', 'btn-downloads-top', 'btn-profile', 'btn-look-sidebar',
    'btn-extensions', 'btn-toggle-ai', 'btn-bookmark', 'btn-command', 'btn-toggle-tabs-left',
  ];
  // Status pills, not buttons: they hide themselves and are never moved.
  // Simple mode's All features is the way back to everything: it never hides.
  // The site icon (js/site-panel.js) is the address field's own: it says
  // whether the connection is secure, so it stays beside the address.
  const NEVER = new Set(['tor-running', 'game-mode-chip', 'battery-saving', 'timer-pill', 'btn-routing', 'btn-incognito', 'btn-site-rules', 'btn-page-watch', 'btn-ai-news', 'btn-userscripts', 'window-controls', 'btn-toolbar-overflow', 'btn-all-features', 'url-zoom', 'url-site-btn']);

  let bar = null, more = null, menu = null;
  let moved = [];          // elements currently in the menu: the folded ones (js/toolbar-limit.js), then those squeezed out
  let proxied = null;      // the element standing in under the chevron after a menu click
  let scheduled = false;

  const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';

  // Everything that may move, first-to-go first: the known ids, then any other
  // button another module put in the right-hand cluster (the Toolbox button).
  function candidates() {
    const out = [];
    for (const id of ORDER) {
      const el = document.getElementById(id);
      if (el && bar.contains(el) && visible(el)) out.push(el);
    }
    // Buttons another module added to the right-hand cluster or the address
    // bar that are not in ORDER (the Toolbox button, the Web Store install).
    const extra = (id) => {
      const box = document.getElementById(id);
      return box ? [...box.children].filter(el => el.tagName === 'BUTTON' && !NEVER.has(el.id) && !ORDER.includes(el.id) && visible(el)) : [];
    };
    out.splice(Math.min(2, out.length), 0, ...extra('top-bar-right'));
    out.push(...extra('url-bar'));
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

  // The buttons the four-icon limit folds away (js/toolbar-limit.js): always in the menu, whatever the width.
  function folded() {
    if (typeof ToolbarLimit === 'undefined') return [];
    return ToolbarLimit.foldedIds().map(id => document.getElementById(id)).filter(el => el && bar.contains(el) && visible(el));
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
    bar.classList.remove('tb-compact', 'tb-tight');
    for (const el of folded()) { el.classList.add('tb-overflowed'); moved.push(el); }
    more.hidden = !moved.length;
    if (fits()) { if (menu) renderMenu(); return; }
    bar.classList.add('tb-compact');
    if (fits()) { if (menu) renderMenu(); return; }
    more.hidden = false;
    for (const el of candidates()) {
      el.classList.add('tb-overflowed');
      moved.push(el);
      if (fits()) break;
    }
    if (!moved.length) more.hidden = true;
    if (!fits()) bar.classList.add('tb-tight');
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
      ico.setAttribute('aria-hidden', 'true');
      const svg = el.querySelector('svg');
      if (svg) ico.appendChild(svg.cloneNode(true));
      const label = document.createElement('span');
      label.className = 'tb-overflow-label';
      label.textContent = labelOf(el);
      row.append(ico, label);
      row.addEventListener('click', () => invoke(el));
      menu.appendChild(row);
    }
    if (!moved.length) { closeMenu(); return; }
    // The way to put a button back in the toolbar.
    const cust = document.createElement('button');
    cust.type = 'button';
    cust.className = 'tb-overflow-item tb-overflow-customize';
    cust.setAttribute('role', 'menuitem');
    const cico = document.createElement('span');
    cico.className = 'tb-overflow-ico';
    cico.setAttribute('aria-hidden', 'true');
    cico.innerHTML = VexIcons.svg('sliders', { size: 16 });
    const clabel = document.createElement('span');
    clabel.className = 'tb-overflow-label';
    clabel.textContent = 'Customize toolbar…';
    cust.append(cico, clabel);
    cust.addEventListener('click', () => {
      closeMenu();
      more.focus({ preventScroll: true });
      if (typeof SettingsUI !== 'undefined') SettingsUI.openSection('setcat-layout');
    });
    menu.appendChild(cust);
  }

  // The real button runs, standing in (invisibly) where the chevron is, so a
  // menu it opens under itself (Downloads, Extensions, Profiles) opens there.
  function invoke(el) {
    closeMenu();
    // Focus goes back to the button first: what the item opens (a menu, a dialog) then returns to it, not to nothing.
    more.focus({ preventScroll: true });
    clearProxy();
    const r = more.getBoundingClientRect();
    el.style.setProperty('--tb-proxy-left', r.left + 'px');
    el.style.setProperty('--tb-proxy-top', r.top + 'px');
    el.classList.add('tb-overflow-proxy');
    // A blurred ancestor (#top-bar, #url-bar) is the containing block of a
    // fixed element, so correct by where it really landed.
    const at = el.getBoundingClientRect();
    if (at.width) {
      el.style.setProperty('--tb-proxy-left', (2 * r.left - at.left) + 'px');
      el.style.setProperty('--tb-proxy-top', (2 * r.top - at.top) + 'px');
    }
    proxied = el;
    el.click();
  }

  function onDocDown(e) { if (menu && !menu.contains(e.target) && !more.contains(e.target)) closeMenu(); }
  function onKey(e) {
    if (!menu) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); more.focus(); return; }
    // Tab leaves the menu: it closes and the focus is on its button, so Tab goes on from there.
    if (e.key === 'Tab') { closeMenu(); more.focus({ preventScroll: true }); return; }
    if (e.key === 'Home' || e.key === 'End') {
      const all = [...menu.querySelectorAll('.tb-overflow-item')];
      if (!all.length) return;
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1].focus();
      return;
    }
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
    menu.setAttribute('data-avoid-toasts', '');   // toasts keep clear of it (app.js placeToasts)
    renderMenu();
    if (!menu) return;
    document.body.appendChild(menu);
    if (typeof VexLayer !== 'undefined') VexLayer.popover(menu, 'toolbar-overflow-menu');
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
    more.innerHTML = VexIcons.svg('more', { size: 16 });
    more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
    // A button that opens a menu opens it with the arrow key too.
    more.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && !menu) { e.preventDefault(); openMenu(); } });
    right.appendChild(more);

    const ro = new ResizeObserver(schedule);
    ro.observe(bar);
    // The address field itself: a button that grows a label, a style that
    // changes a width or a late font squeezes it without resizing the bar
    // (Classic at 1280px kept a 229px field, 2026-10-08).
    const input = document.getElementById('url-input');
    if (input) ro.observe(input);
    window.addEventListener('resize', schedule);
    // A button shown in the toolbar or folded away in Settings > Layout.
    window.addEventListener('vex:toolbar-shown', schedule);
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
