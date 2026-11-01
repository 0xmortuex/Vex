// === "This site" — one door to everything Vex can do for the site in front ===
//
// About a dozen commands each did one thing for the current site and each had
// its own Ctrl+K phrase: what the site is allowed, its cookies, clearing its
// data, "this site is broken", pinning it, a reminder, a page watch, zoom,
// blocking, translating, a Boost, saving it. This is a short menu of them.
//
// It is a front door only. A row never does the work itself: it runs the
// Ctrl+K command that already does it (CommandBar.commands, by id) or opens
// the site panel at the matching section (SitePanel.open({ section })). Every
// old command id, phrase and shortcut keeps working; nothing was removed.
//
// Opens from Ctrl+K "This site", from a right-click (or the Menu key /
// Shift+F10) on the site icon at the left of the address field, and from the
// "More for this site" link at the bottom of the site panel. A plain click on
// the site icon still opens the site panel, as it always did.
//
// Rows appear only when they apply: on Vex's own pages and local files there
// is no site, so the menu says so and shows nothing to run.
const VexThisSite = {
  ID: 'vex-this-site',

  // cmd: a Ctrl+K command id. panel: a site-panel section. One of the two each.
  // when(c): c is SitePanel.context(); a row is shown only if it returns true.
  ROWS: [
    { group: 'Settings for this site' },
    { cmd: 'siteprofiles', label: 'Site settings', icon: 'globe' },
    { cmd: 'siterules', label: 'What this site is allowed', icon: 'sliders' },
    { panel: 'permissions', label: 'Site permissions', icon: 'shield' },
    { panel: 'blocking', label: 'Ad and tracker blocking here', icon: 'shield' },
    { panel: 'zoom', label: 'Zoom for this site', icon: 'search' },
    { cmd: 'site-routes', label: 'Always open through a route', icon: 'globe', when: (c) => !c.tor && !c.ephemeral },
    { group: 'Fix and clean' },
    { cmd: 'sitebroken', label: 'This site is broken', icon: 'warning' },
    { cmd: 'sitedata', label: 'Cookies and storage', icon: 'shield' },
    { cmd: 'clearsite', label: 'Clear this site’s data and reload', icon: 'broom' },
    { group: 'Look and language' },
    { cmd: 'boost', label: 'Boost this site (own CSS or script)', icon: 'palette' },
    { cmd: 'userscripts', label: 'Userscripts', icon: 'code' },
    { cmd: 'translate-side', label: 'Translate this page side by side', icon: 'globe' },
    { panel: 'behaviour', label: 'Always translate, dark mode, never sleep', icon: 'sliders' },
    { group: 'Keep and remember' },
    { cmd: 'pinsite', label: 'Pin to the sidebar', icon: 'pin' },
    { cmd: 'remind', label: 'Remind me about this site', icon: 'bell' },
    { cmd: 'watch', label: 'Watch this page for changes', icon: 'eye' },
    { cmd: 'readlater', label: 'Read later', icon: 'book' },
    { cmd: 'archive-page', label: 'Archive this page', icon: 'archive' },
    { cmd: 'save-page', label: 'Save the page as one file', icon: 'save' },
  ],

  _el: null,
  _returnFocus: null,
  _cleanup: null,

  _context() {
    if (typeof SitePanel === 'undefined') throw new Error('The site panel is not loaded');
    return SitePanel.context();
  },

  // The rows that apply to this page, with the group headings that still have
  // a row under them. Pure: the tests read it.
  rowsFor(c) {
    if (!c || !c.web) return [];
    const out = [];
    for (const r of this.ROWS) {
      if (r.group) { out.push(r); continue; }
      if (r.when && !r.when(c)) continue;
      out.push(r);
    }
    return out.filter((r, i) => !r.group || (out[i + 1] && !out[i + 1].group));
  },

  // Run one row: the existing command, or the site panel at its section.
  run(row) {
    if (row.cmd) {
      if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) throw new Error('The command list is not loaded');
      const cmd = CommandBar.commands.find(x => x.id === row.cmd);
      if (!cmd) throw new Error('The command "' + row.cmd + '" is not in this build');
      return cmd.action();
    }
    if (row.panel) {
      if (typeof SitePanel === 'undefined') throw new Error('The site panel is not loaded');
      return SitePanel.open({ section: row.panel });
    }
    throw new Error('A row of "This site" has no command and no panel');
  },

  open({ restoreTo = null } = {}) {
    this.close({ keepFocus: true });
    const c = this._context();
    const btn = document.getElementById('url-site-btn');
    this._returnFocus = restoreTo || btn || document.activeElement;
    const rows = this.rowsFor(c);
    const menu = document.createElement('div');
    menu.id = this.ID;
    menu.className = 'this-site-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'This site');
    const ico = (n) => VexIcons.svg(n, { size: 14 });
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let html = `<div class="ts-head"><span class="ts-title">${esc('This site')}</span><span class="ts-host">${esc(c.web ? c.host : '')}</span></div>`;
    if (!rows.length) {
      html += `<p class="ts-empty">${esc('Open a website to see what Vex can do for it.')}</p>`;
    } else {
      rows.forEach((r, i) => {
        if (r.group) html += `<div class="ts-group" role="presentation">${esc(r.group)}</div>`;
        else html += `<button type="button" class="ts-row" role="menuitem" tabindex="-1" data-i="${i}">${ico(r.icon)}<span>${esc(r.label)}</span></button>`;
      });
    }
    menu.innerHTML = html;
    document.body.appendChild(menu);
    const bar = document.getElementById('url-bar');
    const anchor = (btn && btn.getClientRects().length) ? btn.getBoundingClientRect() : { left: 8, bottom: 48 };
    const under = (bar && bar.getClientRects().length) ? bar.getBoundingClientRect().bottom : anchor.bottom;
    const width = Math.min(300, window.innerWidth - 16);
    menu.style.width = width + 'px';
    menu.style.left = Math.max(8, Math.min(anchor.left - 10, window.innerWidth - width - 8)) + 'px';
    menu.style.top = (under + 6) + 'px';
    menu.style.maxHeight = Math.max(200, window.innerHeight - under - 18) + 'px';
    if (typeof VexLayer !== 'undefined') VexLayer.popover(menu, this.ID);
    this._el = menu;
    if (btn) btn.setAttribute('aria-expanded', 'true');

    const items = () => Array.from(menu.querySelectorAll('.ts-row'));
    const onClick = (e) => {
      const b = e.target.closest && e.target.closest('.ts-row');
      if (!b) return;
      const row = rows[Number(b.dataset.i)];
      this.close({ keepFocus: true });
      try { this.run(row); } catch (err) { window.showToast?.(err.message, 'error'); }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      const list = items();
      if (!list.length) return;
      const at = list.indexOf(document.activeElement);
      let next = -1;
      if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % list.length;
      else if (e.key === 'ArrowUp') next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      else if (e.key === 'Tab') { e.preventDefault(); this.close(); return; }
      if (next >= 0) { e.preventDefault(); list[next].focus(); }
    };
    const onAway = (e) => { if (!menu.contains(e.target) && !(btn && btn.contains(e.target))) this.close({ keepFocus: true }); };
    menu.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onAway, true);
    this._cleanup = () => {
      menu.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onAway, true);
    };
    const first = items()[0];
    if (first) first.focus(); else { menu.tabIndex = -1; menu.focus(); }
    return menu;
  },

  close({ keepFocus = false } = {}) {
    const el = this._el;
    if (!el) return;
    this._el = null;
    if (this._cleanup) { this._cleanup(); this._cleanup = null; }
    el.remove();
    const btn = document.getElementById('url-site-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (!keepFocus && this._returnFocus && this._returnFocus.isConnected) this._returnFocus.focus();
    this._returnFocus = null;
  },

  // Called once: the command and the right-click on the site icon. Safe to call
  // again (app.js may call init() on a file that already started itself).
  init() {
    if (this._started) return this;
    this._started = true;
    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      VexExtras.registerCommand({
        id: 'this-site', label: 'This site', icon: 'globe', isPrimary: true,
        hint: 'Everything Vex can do for the site in front in one menu: what it is allowed, cookies, clear its data, fix it, pin it, remind me, watch it, zoom, translate, Boost, save',
        keywords: 'site settings site rules site permissions what this site is allowed cookies and storage clear site data this site is broken pin site to sidebar remind me watch page changes zoom for this site ad blocker shields per site translate boost userscripts read later archive save page',
        action: () => {
          try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); }
        },
      });
    }
    const btn = document.getElementById('url-site-btn');
    if (btn) {
      // Right-click, the Menu key and Shift+F10 all arrive as a contextmenu event.
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); }
      });
    }
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexThisSite = VexThisSite;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexThisSite.init(), { once: true });
    else VexThisSite.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexThisSite };
