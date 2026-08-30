// === Vex sidebar panel badges (unified notifications) ===
// Turns the sidebar into a real dashboard: reads the unread count each app panel
// (Discord, WhatsApp, …) puts in its page title — "(5) Discord" — and shows it as
// a badge on that sidebar icon, so you see what needs attention without opening
// each one. Works for any panel you've opened at least once (its webview stays
// alive in the background). Poll-based; no per-site hacks.
const PanelBadges = {
  _timer: null,
  _total: 0,

  _unreadFromTitle(title) {
    if (!title) return 0;
    const m = /(^|[^\d])\((\d+)\)/.exec(title)        // "(5) Discord", "WhatsApp (3)"
           || /(\d+)\s+(?:new|unread)/i.exec(title)   // "3 new messages"
           || /•\s*(\d+)/.exec(title);                // "• 3"
    if (!m) return 0;
    const n = parseInt(m[m.length - 1], 10);
    return Number.isFinite(n) && n > 0 && n < 100000 ? n : 0;
  },

  _injectStyle() {
    if (document.getElementById('panel-badge-styles')) return;
    const st = document.createElement('style');
    st.id = 'panel-badge-styles';
    st.textContent = `
      .sidebar-icon { position: relative; }
      .panel-badge { position:absolute; top:2px; right:2px; min-width:15px; height:15px; padding:0 3px; border-radius:8px;
        background:#e5484d; color:#fff; font-size:9px; line-height:15px; text-align:center; font-weight:700;
        box-shadow:0 1px 3px rgba(0,0,0,.4); pointer-events:none; z-index:3; box-sizing:border-box; }
    `;
    document.head.appendChild(st);
  },

  _setBadge(panel, count) {
    const icon = document.querySelector('.sidebar-icon[data-panel="' + (window.CSS && CSS.escape ? CSS.escape(panel) : panel) + '"]');
    if (!icon) return;
    let b = icon.querySelector(':scope > .panel-badge');
    if (count > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'panel-badge'; icon.appendChild(b); }
      b.textContent = count > 99 ? '99+' : String(count);
    } else if (b) { b.remove(); }
  },

  sweep() {
    try {
      if (typeof SidebarManager === 'undefined' || !SidebarManager.panelWebviews) return;
      let total = 0;
      Object.keys(SidebarManager.panelWebviews).forEach(panel => {
        const wv = SidebarManager.panelWebviews[panel];
        let title = '';
        try { title = (wv && typeof wv.getTitle === 'function') ? wv.getTitle() : ''; } catch {}
        const n = this._unreadFromTitle(title);
        this._setBadge(panel, n);
        total += n;
      });
      this._total = total;
      window.dispatchEvent(new CustomEvent('vex:panel-unread', { detail: { total } }));
    } catch {}
  },

  start() {
    this._injectStyle();
    if (this._timer) return;
    this.sweep();
    this._timer = setInterval(() => this.sweep(), 5000);
  },
};

if (typeof window !== 'undefined') {
  window.PanelBadges = PanelBadges;
  const boot = () => { try { PanelBadges.start(); } catch {} };
  if (document.readyState !== 'loading') setTimeout(boot, 1500);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1500));
}
