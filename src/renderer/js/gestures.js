// === Vex Mouse Gestures ===
//
// Hold the RIGHT mouse button and drag inside any page, release to act:
//   ←  back        →  forward       ↑  scroll to top
//   ↓  reload      ↓→ close tab     ↓← reopen closed tab
// The guest-side tracker lives in preload-webview.js (it watches right-drag
// and sendToHost's 'vex-gesture'); a normal right-click still opens the
// context menu. Toggle in Settings → Browser; default ON.

const MouseGestures = {
  KEY: 'vex.gesturesEnabled',
  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch {} },

  attach(webview) {
    webview.addEventListener('ipc-message', (e) => {
      if (e.channel !== 'vex-gesture') return;
      if (!this.enabled()) return;
      const dir = (e.args && e.args[0]) || '';
      this.run(dir, webview);
    });
  },

  _adjacent(delta) {
    try {
      const tabs = TabManager.tabs; if (!tabs || !tabs.length) return null;
      let i = tabs.findIndex(x => x.id === TabManager.activeTabId);
      if (i < 0) i = 0;
      return tabs[(i + delta + tabs.length) % tabs.length].id;
    } catch { return null; }
  },

  run(dir, wv) {
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const act = {
      'L': () => { try { wv.canGoBack() && wv.goBack(); } catch {} return '← Back'; },
      'R': () => { try { wv.canGoForward() && wv.goForward(); } catch {} return '→ Forward'; },
      'U': () => { try { wv.executeJavaScript('window.scrollTo({top:0,behavior:"smooth"})'); } catch {} return '↑ Top'; },
      'D': () => { try { wv.reload(); } catch {} return '↓ Reload'; },
      'DR': () => { if (t) TabManager.closeTab(t.id); return '↓→ Close tab'; },
      'DL': () => { try { TabManager.reopenClosedTab?.(); } catch {} return '↓← Reopen tab'; },
      'UR': () => { try { TabManager.createTab(null, true); } catch {} return '↑→ New tab'; },
      'UL': () => { try { if (t) TabManager.createTab(t.url, true); } catch {} return '↑← Duplicate tab'; },
      'RD': () => { const id = this._adjacent(1); if (id) TabManager.switchTab(id); return '→↓ Next tab'; },
      'LD': () => { const id = this._adjacent(-1); if (id) TabManager.switchTab(id); return '←↓ Previous tab'; },
    }[dir];
    if (!act) return;
    const label = act();
    window.showToast?.('🖱 ' + label);
  },
};

if (typeof window !== 'undefined') window.MouseGestures = MouseGestures;
if (typeof module !== 'undefined' && module.exports) module.exports = { MouseGestures };
