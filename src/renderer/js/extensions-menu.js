// === Quick Tools / Extensions menu — puzzle button in the top bar ===
// Opens a popover of handy per-page tools (Copy Unlock, Reading Mode, Dark mode,
// Translate, Zap, Boost, Screenshot, …) plus a link to manage real Chrome
// extensions. Each tool reuses an existing command-bar action so behavior lives
// in one place; a couple call WebviewManager / SidebarManager directly.
const ExtensionsMenu = {
  _menu: null,
  _onDoc: null,
  _onKey: null,

  ITEMS: [
    { icon: 'unlock', label: 'Unlock Copy & Right-Click', sub: 'Bypass sites that block copy/selection', cmd: 'copyunlock' },
    { icon: 'file', label: 'Copy Text from Doc', sub: 'Google Docs & copy-locked pages (export / OCR)', cmd: 'doctext' },
    { icon: 'book-open', label: 'Reading Mode', sub: 'Strip clutter, focus on the article', cmd: 'read' },
    { icon: 'newspaper', label: 'Read Free', sub: 'Get past metered & subscriber paywalls', cmd: 'readfree' },
    { icon: 'video', label: 'Download Media', sub: 'Save video/audio playing on this page', cmd: 'media' },
    { icon: 'moon', label: 'Dark mode for this site', sub: 'Force-darken just this site',
      fn: () => { const wv = (typeof WebviewManager !== 'undefined') && WebviewManager.getActiveWebview(); if (wv) WebviewManager.toggleForceDarkForSite(wv); else window.showToast?.('Open a page first'); } },
    { icon: 'globe', label: 'Translate Page', sub: 'Translate via Google Translate', cmd: 'translate' },
    { icon: 'volume', label: 'Read Aloud', sub: 'Speak the article (run again to stop)', cmd: 'readaloud' },
    { icon: 'sliders', label: 'Master Volume', sub: 'One slider for media volume across all tabs',
      fn: () => { if (typeof MasterVolume !== 'undefined') MasterVolume.show(); else window.showToast?.('Unavailable'); } },
    { icon: 'target', label: 'Zap Element', sub: 'Click to hide any element forever', cmd: 'zap' },
    { icon: 'palette', label: 'Boost This Site', sub: 'Custom CSS / JS for this site', cmd: 'boost' },
    { icon: 'camera', label: 'Screenshot', sub: 'Capture + annotate this page', cmd: 'screenshot' },
    { icon: 'phone', label: 'Responsive Preview', sub: 'Phone / tablet / desktop widths', cmd: 'responsive' },
    { icon: 'shield', label: 'Privacy Report', sub: 'Trackers blocked + protections', cmd: 'privacy' },
    { sep: true },
    { icon: 'puzzle', label: 'Manage Chrome extensions…', sub: 'Install .crx / .zip / unpacked',
      // Straight to the extensions list — opening Settings at the top left the
      // user to hunt for it (found 2026-09-29).
      fn: () => { SettingsUI.openSection('extensions-panel-content'); } },
  ],

  init() {
    const btn = document.getElementById('btn-extensions');
    if (!btn) return;
    this._injectStyles();
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(btn); });
    // A badge that changes while the menu is open changes on it too, and on
    // the pinned buttons; pins and loaded extensions changing redraw those.
    if (typeof VexExtUi !== 'undefined') {
      VexExtUi.onChange(() => {
        this._refreshBadges();
        const sig = JSON.stringify([VexExtUi.state.pins, VexExtUi.state.loaded]);
        if (sig !== this._pinSig) { this._pinSig = sig; this._renderPins(); }
      });
    }
    window.addEventListener('vex:tab-activated', () => this._refreshBadges());
  },

  // === Pinned extensions: their own buttons on the toolbar ===
  // Beside the extensions button, in pin order, as in Chrome. Each is a
  // button of #top-bar-right, so in a narrow window js/toolbar-overflow.js
  // moves it into "More tools" like any other, still clickable there (its
  // label carries the badge). Click: the popup under it, or the extension's
  // own click; right-click: its button menu; the badge and title for the tab
  // in front.
  _pinSig: null,
  _pinBusy: null,
  async _renderPins() {
    const right = document.getElementById('top-bar-right');
    const anchor = document.getElementById('btn-extensions');
    if (!right || !anchor || !window.vex || typeof window.vex.extensionsList !== 'function') return;
    const run = (async () => {
      let list;
      try { list = await window.vex.extensionsList(); }
      catch (err) { console.warn('[ExtensionsMenu] could not list extensions for the toolbar:', err && err.message); return; }
      const pins = (typeof VexExtUi !== 'undefined' ? VexExtUi.state.pins : null) || list.filter(e => e.pinned).map(e => e.folder);
      const show = pins.map(f => list.find(e => e.folder === f && e.pinned && e.enabled && e.loaded)).filter(Boolean);
      right.querySelectorAll('.ext-pin-btn').forEach(b => { if (!show.some(e => e.folder === b.dataset.extFolder)) b.remove(); });
      for (const ext of show) {
        let b = right.querySelector(`.ext-pin-btn[data-ext-folder="${CSS.escape(ext.folder)}"]`);
        if (!b) {
          b = document.createElement('button');
          b.type = 'button';
          b.className = 'nav-btn ext-pin-btn';
          b.dataset.extFolder = ext.folder;
          b.innerHTML = '<span class="ext-menu-ico ext-pin-ico"></span>';
          b.addEventListener('click', (ev) => { ev.stopPropagation(); this.close(); this._runExtension(b._vexExt, b); });
          b.addEventListener('contextmenu', (ev) => this._openActionMenu(ev, b._vexExt, b));
        }
        b._vexExt = ext;
        right.insertBefore(b, anchor);
        this._drawBadge(b, ext);
      }
    });
    // One at a time: a second change while listing waits for the first.
    this._pinBusy = (this._pinBusy || Promise.resolve()).then(run, run);
    return this._pinBusy;
  },

  async _setPinned(ext, pinned) {
    const r = await window.vex.extensionsSetPinned(ext.folder, pinned);
    if (!r || !r.ok) { window.showToast?.('Could not ' + (pinned ? 'pin' : 'unpin') + ' it: ' + ((r && r.error) || 'unknown'), 'error'); return false; }
    ext.pinned = pinned;
    window.showToast?.(pinned ? ext.name + ' is pinned to the toolbar' : ext.name + ' is no longer pinned');
    return true;
  },
  _hasPopup(ext) { return typeof VexExtUi !== 'undefined' ? VexExtUi.hasPopupFor(ext) : !!ext.hasPopup; },

  toggle(btn) {
    if (this._menu) { this.close(); return; }
    this.open(btn);
  },

  open(btn) {
    const menu = document.createElement('div');
    menu.className = 'ext-menu';
    this.ITEMS.forEach(it => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'ext-menu-sep'; menu.appendChild(s); return; }
      const row = document.createElement('button');
      row.className = 'ext-menu-item';
      row.innerHTML = '<span class="ext-menu-ico"></span><span class="ext-menu-text"><span class="ext-menu-label"></span><span class="ext-menu-sub"></span></span>';
      row.querySelector('.ext-menu-ico').innerHTML = VexIcons.svg(it.icon, { size: 16 });
      row.querySelector('.ext-menu-label').textContent = it.label;
      row.querySelector('.ext-menu-sub').textContent = it.sub || '';
      row.addEventListener('click', () => { this.close(); this._run(it); });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);

    // Position under the button, clamped to the viewport.
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth || 260;
    let left = Math.min(r.left, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = left + 'px';
    // With a dozen extensions above the built-in tools the list ran off the
    // bottom of the window with no way to reach the rest; it scrolls instead.
    menu.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 14) + 'px';
    this._menu = menu;
    btn.classList.add('active');

    // Real Chrome extensions go ABOVE the built-in tools, the way a browser
    // toolbar lists them. Fetched async so the menu still opens instantly.
    this._loadExtensionRows(menu, btn);

    // Dismiss on outside click / Esc (deferred so the opening click doesn't close it).
    // A click INSIDE the page's <webview> never reaches the host document, so
    // also close on window blur (focus moving into the guest fires it) — else
    // the menu stays stuck open when the user clicks the web page.
    this._onDoc = (ev) => { if (this._menu && !this._menu.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) this.close(); };
    this._onKey = (ev) => { if (ev.key === 'Escape') this.close(); };
    this._onBlur = () => this.close();
    setTimeout(() => {
      document.addEventListener('mousedown', this._onDoc, true);
      document.addEventListener('keydown', this._onKey, true);
      window.addEventListener('blur', this._onBlur);
    }, 0);
  },

  close() {
    if (this._menu) { this._menu.remove(); this._menu = null; }
    document.getElementById('btn-extensions')?.classList.remove('active');
    if (this._onDoc) document.removeEventListener('mousedown', this._onDoc, true);
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    if (this._onBlur) window.removeEventListener('blur', this._onBlur);
    this._onDoc = this._onKey = this._onBlur = null;
  },

  // Manifest icons are read straight off disk from the install folder.
  // encodeURI (not encodeURIComponent) keeps the drive letter and separators.
  _fileUrl(p) {
    if (typeof p !== 'string' || !p) return null;
    return encodeURI('file:///' + p.replace(/\\/g, '/').replace(/^\/+/, ''));
  },

  _rowSubtitle(ext) {
    if (this._hasPopup(ext)) return 'Open popup';
    if (ext.hasAction) return 'Run it on this page';
    if (ext.hasOptions) return 'Open options page';
    return 'No popup or options page';
  },

  // The extension's badge (chrome.action.setBadgeText) on its icon, for the
  // tab in front, and its button title as the row's tooltip (js/ext-ui.js).
  _drawBadge(row, ext) {
    const ico = row.querySelector('.ext-menu-ico');
    if (!ico) return;
    // Its picture: what action.setIcon set for this tab, else the manifest's.
    const src = typeof VexExtUi !== 'undefined' ? VexExtUi.iconFor(ext.id, ext.iconPath) : this._fileUrl(ext.iconPath);
    let img = ico.querySelector('img');
    if (src) {
      if (!img) { ico.querySelector('svg')?.remove(); img = document.createElement('img'); img.width = 16; img.height = 16; img.alt = ''; ico.prepend(img); }
      if (img.getAttribute('src') !== src) img.src = src;
    } else if (!ico.querySelector('svg')) { img?.remove(); ico.insertAdjacentHTML('afterbegin', VexIcons.svg('puzzle', { size: 16 })); }
    const isPin = row.classList.contains('ext-pin-btn');
    if (typeof VexExtUi === 'undefined' || !ext.id) { if (isPin) { row.setAttribute('aria-label', ext.name); row.title = ext.name; } return; }
    const b = VexExtUi.badgeFor(ext.id);
    let el = ico.querySelector('.ext-menu-badge');
    const text = b && b.text ? String(b.text).slice(0, 4) : '';
    if (!text) { if (el) el.remove(); }
    else {
      if (!el) { el = document.createElement('span'); el.className = 'ext-menu-badge'; ico.appendChild(el); }
      el.textContent = text;
      el.style.background = VexExtUi.rgba(b.bg);
      el.style.color = VexExtUi.rgba(b.color);
    }
    const title = b && b.title ? b.title : '';
    if (isPin) {
      // A toolbar button says what it is; its label is also its row in
      // "More tools" when the toolbar is too narrow, badge included.
      row.title = title || ext.name;
      row.setAttribute('aria-label', ext.name + (text ? ` (${text})` : ''));
    } else if (title) row.title = title;
    else row.removeAttribute('title');
  },
  _refreshBadges() {
    document.querySelectorAll('#top-bar-right .ext-pin-btn').forEach(b => { if (b._vexExt) this._drawBadge(b, b._vexExt); });
    if (!this._menu) return;
    this._menu.querySelectorAll('.ext-menu-item[data-ext-folder]').forEach(row => {
      const ext = row._vexExt;
      if (ext) this._drawBadge(row, ext);
    });
  },

  // Right-click on an extension's row: its own items for its button
  // (contexts "action"), then Vex's for it — as Chrome's toolbar button menu.
  _openActionMenu(ev, ext, btn) {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof WebviewManager === 'undefined' || typeof WebviewManager._renderMenu !== 'function') return;
    const items = typeof VexExtUi !== 'undefined' ? VexExtUi.actionMenuRows(ext.id) : [];
    if (items.length) items.push({ sep: true });
    if (this._hasPopup(ext)) items.push({ label: 'Open its popup', icon: 'window', action: () => { this.close(); this._runExtension(ext, btn); } });
    if (ext.optionsUrl) items.push({ label: 'Options', icon: 'settings', action: () => { this.close(); if (typeof TabManager !== 'undefined') TabManager.createTab(ext.optionsUrl, true); } });
    items.push(ext.pinned
      ? { label: 'Unpin from the toolbar', icon: 'pin', action: () => { this.close(); this._setPinned(ext, false); } }
      : { label: 'Pin to the toolbar', icon: 'pin', action: () => { this.close(); this._setPinned(ext, true); } });
    items.push({ label: 'Keyboard shortcuts and settings', icon: 'keyboard', action: () => { this.close(); SettingsUI.openSection('extensions-panel-content'); } });
    document.querySelectorAll('.tab-context-menu, .context-menu-overlay').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu ext-action-menu';
    menu.style.left = ev.clientX + 'px';
    menu.style.top = ev.clientY + 'px';
    WebviewManager._renderMenu(menu, items);
    document.body.appendChild(menu);
    if (typeof TabManager !== 'undefined') {
      TabManager._clampMenuToViewport?.(menu, ev.clientX, ev.clientY);
      TabManager._attachMenuDismissal?.(menu);
    }
  },

  // An extension's "_execute_action" shortcut (main.js): its popup under the
  // extensions button, or — with no popup — its button's click.
  async runAction(req) {
    let list = [];
    try { list = await window.vex.extensionsList(); }
    catch (err) { window.showToast?.('Could not run the extension: ' + err.message, 'error'); return; }
    const ext = list.find(e => e.folder === req.folder && e.loaded);
    if (!ext) { window.showToast?.('That extension is not running', 'error'); return; }
    if (this._hasPopup(ext)) {
      // Under its own pinned button when that is on show, else under the
      // extensions button, else under the top of the window.
      const shown = (b) => b && b.getClientRects().length > 0 && !b.classList.contains('tb-overflowed');
      const pinBtn = document.querySelector(`#top-bar-right .ext-pin-btn[data-ext-folder="${CSS.escape(ext.folder)}"]`);
      const btn = shown(pinBtn) ? pinBtn : document.getElementById('btn-extensions');
      this.close();
      await this._runExtension(ext, shown(btn) ? btn : null);
      return;
    }
    await this._actionClick(ext, req.partition, req.tab);
  },

  async _actionClick(ext, partition, tab) {
    try {
      await window.vex.extensionsActionClick({ partition, id: ext.id, tab: Number.isInteger(tab) && tab > 0 ? tab : null });
    } catch (err) {
      window.showToast?.(ext.name + ' did not get the click: ' + String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''), 'error');
    }
  },

  // Only extensions that are switched on AND actually loaded can do anything,
  // so a failed or disabled one is left out of the toolbar rather than offering
  // a click that can't work. The manager explains why it isn't here.
  async _loadExtensionRows(menu, btn) {
    let list = [];
    try { list = await window.vex.extensionsList(); }
    catch (err) { console.warn('[ExtensionsMenu] could not list extensions', err); return; }
    if (this._menu !== menu) return;                 // menu closed while loading
    const usable = list.filter(e => e.enabled && e.loaded);
    if (!usable.length) return;

    const frag = document.createDocumentFragment();
    usable.forEach(ext => {
      const row = document.createElement('button');
      row.className = 'ext-menu-item';
      row.innerHTML = '<span class="ext-menu-ico"></span><span class="ext-menu-text"><span class="ext-menu-label"></span><span class="ext-menu-sub"></span></span>';
      // Its icon and badge: _drawBadge.
      row.querySelector('.ext-menu-label').textContent = ext.name;
      row.querySelector('.ext-menu-sub').textContent = this._rowSubtitle(ext);
      row.dataset.extFolder = ext.folder;
      row._vexExt = ext;
      this._drawBadge(row, ext);
      row.addEventListener('click', () => { this.close(); this._runExtension(ext, btn); });
      row.addEventListener('contextmenu', (ev) => this._openActionMenu(ev, ext, btn));
      // Pin it to the toolbar, as Chrome's extensions menu does.
      const wrap = document.createElement('div');
      wrap.className = 'ext-menu-extrow';
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'ext-menu-pin' + (ext.pinned ? ' on' : '');
      pin.innerHTML = VexIcons.svg('pin', { size: 14 });
      const pinLabel = () => (ext.pinned ? 'Unpin ' : 'Pin ') + ext.name + (ext.pinned ? ' from the toolbar' : ' to the toolbar');
      pin.title = pinLabel();
      pin.setAttribute('aria-label', pinLabel());
      pin.setAttribute('aria-pressed', String(!!ext.pinned));
      pin.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!await this._setPinned(ext, !ext.pinned)) return;
        pin.classList.toggle('on', !!ext.pinned);
        pin.setAttribute('aria-pressed', String(!!ext.pinned));
        pin.title = pinLabel();
        pin.setAttribute('aria-label', pinLabel());
      });
      wrap.append(row, pin);
      frag.appendChild(wrap);
    });
    const sep = document.createElement('div');
    sep.className = 'ext-menu-sep';
    frag.appendChild(sep);
    menu.insertBefore(frag, menu.firstChild);
  },

  async _runExtension(ext, btn) {
    try {
      // The tab you are on, so the popup's "this site" is that page and not
      // the popup itself (main.js, extensions:popup-tab). A tab that has not
      // attached yet has no id to give.
      const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
      let tab = null;
      if (wv && typeof wv.getWebContentsId === 'function') { try { tab = wv.getWebContentsId(); } catch { /* not attached yet */ } }
      if (this._hasPopup(ext)) {
        // Under the extensions button; with no button on show (a shortcut,
        // a look that hides it), under the top of the window.
        const rect = btn ? btn.getBoundingClientRect() : { left: window.innerWidth / 2, bottom: 48 };
        const res = await window.vex.extensionsOpenPopup({
          folder: ext.folder,
          x: Math.max(0, Math.round(window.screenX + rect.left)),
          y: Math.max(0, Math.round(window.screenY + rect.bottom)),
          tab: Number.isInteger(tab) && tab > 0 ? tab : null
        });
        if (!res || !res.ok) window.showToast?.('Could not open popup: ' + ((res && res.error) || 'unknown'));
        return;
      }
      // A button with no popup is the extension's to answer (action.onClicked).
      if (ext.hasAction && ext.id) {
        const partition = wv && typeof VexExtUi !== 'undefined' ? VexExtUi.partitionOf(wv) : 'persist:main';
        await this._actionClick(ext, partition, tab);
        return;
      }
      if (ext.optionsUrl) {
        if (typeof TabManager !== 'undefined') TabManager.createTab(ext.optionsUrl, true);
        return;
      }
      window.showToast?.(ext.name + ' has no popup or options page');
    } catch (err) {
      window.showToast?.('Could not open extension: ' + err.message);
    }
  },

  _run(it) {
    try {
      if (typeof it.fn === 'function') { it.fn(); return; }
      if (it.cmd && typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
        const c = CommandBar.commands.find(x => x.id === it.cmd);
        if (c && typeof c.action === 'function') { c.action(); return; }
      }
      window.showToast?.('That tool is unavailable');
    } catch (e) { console.warn('[ExtensionsMenu] run failed', e); }
  },

  _injectStyles() {
    if (document.getElementById('ext-menu-styles')) return;
    const css = `
      #btn-extensions svg { display:block; }
      #btn-extensions.active { background: color-mix(in srgb, var(--primary,#6366f1) 18%, transparent); color: var(--text,#fff); }
      .ext-menu{position:fixed;z-index:100000;min-width:252px;max-width:300px;padding:6px;border-radius:12px;
        background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.10));
        box-shadow:0 14px 44px rgba(0,0,0,0.40);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        animation:extMenuIn .12s ease;overflow-y:auto;overscroll-behavior:contain;}
      @keyframes extMenuIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      .ext-menu-item{display:flex;align-items:center;gap:11px;width:100%;padding:8px 10px;border:none;border-radius:8px;
        background:transparent;color:var(--text,#e9e9ee);cursor:pointer;text-align:left;font-family:inherit;}
      .ext-menu-item:hover{background:color-mix(in srgb, var(--primary,#6366f1) 16%, transparent);}
      .ext-menu-ico{width:22px;flex-shrink:0;line-height:1;display:inline-flex;align-items:center;justify-content:center;position:relative;}
      .tab-context-menu.ext-action-menu{z-index:100001;}
      .ext-menu-extrow{position:relative;}
      .ext-menu-extrow > .ext-menu-item{padding-right:38px;}
      .ext-menu-pin{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;
        border:none;border-radius:6px;background:transparent;color:var(--text-muted,#9a9aa5);cursor:pointer;opacity:.75;}
      .ext-menu-pin:hover{background:color-mix(in srgb, var(--primary,#6366f1) 16%, transparent);opacity:1;}
      .ext-menu-pin.on{color:var(--primary,#6366f1);opacity:1;}
      .ext-pin-btn .ext-pin-ico{width:18px;}
      .ext-pin-btn .ext-pin-ico img{display:block;width:16px;height:16px;}
      .ext-menu-badge{position:absolute;right:-7px;bottom:-6px;min-width:14px;height:13px;padding:0 3px;box-sizing:border-box;border-radius:7px;
        font-size:9px;font-weight:700;line-height:13px;text-align:center;white-space:nowrap;pointer-events:none;
        box-shadow:0 0 0 1.5px var(--surface,#1b1b24);}
      .ext-menu-text{display:flex;flex-direction:column;line-height:1.25;min-width:0;}
      .ext-menu-label{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .ext-menu-sub{font-size:11px;color:var(--text-muted,#9a9aa5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .ext-menu-sep{height:1px;margin:5px 6px;background:var(--border,rgba(255,255,255,0.08));}
    `;
    const st = document.createElement('style');
    st.id = 'ext-menu-styles';
    st.textContent = css;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') {
  window.ExtensionsMenu = ExtensionsMenu;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ExtensionsMenu.init());
  } else {
    ExtensionsMenu.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ExtensionsMenu };
