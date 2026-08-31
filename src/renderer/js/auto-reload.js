// === Vex Auto-reload ===
// Refresh a tab on a fixed interval — handy for dashboards, live scores, build
// logs, auction/stock pages. Per-tab; opened from the page right-click menu.
// Self-healing: if the tab's webview is gone (slept/closed) the timer clears
// itself, so nothing keeps running in the background for a dead tab.
const AutoReload = {
  _timers: new Map(), // tabId -> { id, ms }
  CHOICES: [
    { ms: 0, label: 'Off' },
    { ms: 30000, label: '30 seconds' },
    { ms: 60000, label: '1 minute' },
    { ms: 300000, label: '5 minutes' },
    { ms: 900000, label: '15 minutes' },
  ],

  isOn(tabId) { return this._timers.has(tabId); },

  set(tabId, ms) {
    this.clear(tabId);
    if (!ms || ms < 1000) return;
    const id = setInterval(() => {
      const wv = (typeof WebviewManager !== 'undefined') && WebviewManager.webviews.get(tabId);
      if (!wv) { this.clear(tabId); return; } // tab slept or closed — stop
      try { wv.reload(); } catch {}
    }, ms);
    this._timers.set(tabId, { id, ms });
  },

  clear(tabId) {
    const t = this._timers.get(tabId);
    if (t) { clearInterval(t.id); this._timers.delete(tabId); }
  },

  // Chooser overlay for the current tab.
  open(tabId) {
    tabId = tabId || (TabManager.getActiveTab && TabManager.getActiveTab()?.id);
    if (!tabId) return;
    const cur = this._timers.get(tabId);
    document.getElementById('vex-autoreload')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-autoreload';
    m.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    const btn = (c) => {
      const active = (cur ? cur.ms : 0) === c.ms;
      return `<button data-ms="${c.ms}" style="display:block;width:100%;text-align:left;padding:10px 12px;margin:4px 0;background:${active ? 'var(--primary,var(--accent))' : 'var(--bg)'};color:${active ? '#fff' : 'var(--text)'};border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;font-family:'Outfit',sans-serif">${c.label}${active ? ' ·  current' : ''}</button>`;
    };
    m.innerHTML = `<div style="width:300px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);padding:18px">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:10px">⟳ Auto-refresh this tab</div>
      ${this.CHOICES.map(btn).join('')}
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelectorAll('button[data-ms]').forEach(b => b.addEventListener('click', () => {
      const ms = parseInt(b.dataset.ms, 10) || 0;
      this.set(tabId, ms);
      const c = this.CHOICES.find(x => x.ms === ms);
      window.showToast?.(ms ? `⟳ Auto-refresh every ${c.label.toLowerCase()}` : 'Auto-refresh off');
      m.remove();
    }));
  },
};

if (typeof window !== 'undefined') window.AutoReload = AutoReload;
if (typeof module !== 'undefined' && module.exports) module.exports = { AutoReload };
