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
    { icon: '🔓', label: 'Unlock Copy & Right-Click', sub: 'Bypass sites that block copy/selection', cmd: 'copyunlock' },
    { icon: '📄', label: 'Copy Text from Doc', sub: 'Google Docs & copy-locked pages (export / OCR)', cmd: 'doctext' },
    { icon: '📖', label: 'Reading Mode', sub: 'Strip clutter, focus on the article', cmd: 'read' },
    { icon: '📰', label: 'Read Free', sub: 'Get past metered & subscriber paywalls', cmd: 'readfree' },
    { icon: '🎬', label: 'Download Media', sub: 'Save video/audio playing on this page', cmd: 'media' },
    { icon: '🌙', label: 'Dark mode for this site', sub: 'Force-darken just this site',
      fn: () => { const wv = (typeof WebviewManager !== 'undefined') && WebviewManager.getActiveWebview(); if (wv) WebviewManager.toggleForceDarkForSite(wv); else window.showToast?.('Open a page first'); } },
    { icon: '🌐', label: 'Translate Page', sub: 'Translate via Google Translate', cmd: 'translate' },
    { icon: '🔊', label: 'Read Aloud', sub: 'Speak the article (run again to stop)', cmd: 'readaloud' },
    { icon: '🎯', label: 'Zap Element', sub: 'Click to hide any element forever', cmd: 'zap' },
    { icon: '🎨', label: 'Boost This Site', sub: 'Custom CSS / JS for this site', cmd: 'boost' },
    { icon: '📷', label: 'Screenshot', sub: 'Capture + annotate this page', cmd: 'screenshot' },
    { icon: '📱', label: 'Responsive Preview', sub: 'Phone / tablet / desktop widths', cmd: 'responsive' },
    { icon: '🛡️', label: 'Privacy Report', sub: 'Trackers blocked + protections', cmd: 'privacy' },
    { sep: true },
    { icon: '🧩', label: 'Manage Chrome extensions…', sub: 'Install .crx / .zip / unpacked',
      fn: () => { try { (SidebarManager.openPanel || SidebarManager.showPanel).call(SidebarManager, 'settings'); } catch (_) {} } },
  ],

  init() {
    const btn = document.getElementById('btn-extensions');
    if (!btn) return;
    this._injectStyles();
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(btn); });
  },

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
      row.querySelector('.ext-menu-ico').textContent = it.icon;
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
    this._menu = menu;
    btn.classList.add('active');

    // Dismiss on outside click / Esc (deferred so the opening click doesn't close it).
    this._onDoc = (ev) => { if (this._menu && !this._menu.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) this.close(); };
    this._onKey = (ev) => { if (ev.key === 'Escape') this.close(); };
    setTimeout(() => {
      document.addEventListener('mousedown', this._onDoc, true);
      document.addEventListener('keydown', this._onKey, true);
    }, 0);
  },

  close() {
    if (this._menu) { this._menu.remove(); this._menu = null; }
    document.getElementById('btn-extensions')?.classList.remove('active');
    if (this._onDoc) document.removeEventListener('mousedown', this._onDoc, true);
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    this._onDoc = this._onKey = null;
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
        animation:extMenuIn .12s ease;}
      @keyframes extMenuIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      .ext-menu-item{display:flex;align-items:center;gap:11px;width:100%;padding:8px 10px;border:none;border-radius:8px;
        background:transparent;color:var(--text,#e9e9ee);cursor:pointer;text-align:left;font-family:inherit;}
      .ext-menu-item:hover{background:color-mix(in srgb, var(--primary,#6366f1) 16%, transparent);}
      .ext-menu-ico{font-size:16px;width:22px;text-align:center;flex-shrink:0;line-height:1;}
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
