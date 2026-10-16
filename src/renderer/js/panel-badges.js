// === Vex sidebar panel badges (unified notifications) ===
// Turns the sidebar into a real dashboard: reads the unread count each app panel
// (Discord, WhatsApp, …) puts in its page title — "(5) Discord" — and shows it as
// a badge on that sidebar icon, so you see what needs attention without opening
// each one. Works for any panel you've opened at least once (its webview stays
// alive in the background). Poll-based; no per-site hacks.
const PanelBadges = {
  _timer: null,
  _total: 0,

  // Panels whose title is never a message count: Spotify's is "Song • Artist"
  // while it plays.
  NO_COUNT: ['spotify'],

  // Only the forms a message count takes: a LEADING "(5)" — "(5) Discord" —
  // or "3 new" / "3 unread". A number in brackets anywhere ("Thriller (1982)")
  // or after a bullet ("In Da Club • 50 Cent", Spotify) is part of a name.
  // Gmail alone puts the count after a (localised) folder word with thousands
  // separators — "Inbox (6,693) - me@gmail.com - Gmail", "Gelen Kutusu (12) …"
  // (one to three words) — so that form is read
  // only when the panel's page is on mail.google.com.
  _unreadFromTitle(title, panel, url) {
    if (!title || (panel && this.NO_COUNT.includes(panel))) return 0;
    const gmail = /^https?:\/\/mail\.google\.com(?:[/:?#]|$)/i.test(url || '');
    const m = /^\s*\((\d+)\)/.exec(title)
           || /(?:^|[^\w])(\d+)\s+(?:new|unread)\b/i.exec(title)
           || (gmail && /^\s*(?:[^\s(]+\s+){1,3}\((\d[\d.,]*)\)/.exec(title));
    if (!m) return 0;
    const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
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
        let url = '';
        try { url = (wv && typeof wv.getURL === 'function') ? wv.getURL() : ''; } catch {}
        const n = this._unreadFromTitle(title, panel, url);
        this._setBadge(panel, n);
        total += n;
      });
      // A slept (or closed) panel has no page to count from: its last count
      // stayed on the icon for good.
      document.querySelectorAll('.sidebar-icon[data-panel] > .panel-badge').forEach(b => {
        if (!SidebarManager.panelWebviews[b.parentElement.dataset.panel]) b.remove();
      });
      this._total = total;
      window.dispatchEvent(new CustomEvent('vex:panel-unread', { detail: { total } }));
    } catch {}
  },

  start() {
    this._injectStyle();
    if (this._timer) return;
    this.sweep();
    document.addEventListener('vex:panel-slept', () => this.sweep());
    this._timer = VexJobs.every('Panel badges', 5000, () => this.sweep());
  },
};

if (typeof window !== 'undefined') {
  window.PanelBadges = PanelBadges;
  const boot = () => { try { PanelBadges.start(); } catch {} };
  if (document.readyState !== 'loading') setTimeout(boot, 1500);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1500));
}
