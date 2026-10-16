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

  // Registered through the webview's lifecycle so destroyWebview can take it
  // off again. A handler left on the element captures `webview` in its closure,
  // and that keeps the whole element alive for the life of the window — one
  // leaked webview per closed tab.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-gesture') return;
      if (!this.enabled()) return;
      // Only from the page you are looking at: a background tab's gesture
      // acted on the tab in front, closing it (found 2026-09-29).
      if (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview && WebviewManager.getActiveWebview() !== webview) return;
      const dir = (e.args && e.args[0]) || '';
      this.run(dir, webview);
    });
  },

  run(dir, wv) {
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const act = {
      'L': () => { try { wv.canGoBack() && wv.goBack(); } catch {} return '← Back'; },
      'R': () => { try { wv.canGoForward() && wv.goForward(); } catch {} return '→ Forward'; },
      'U': () => { try { wv.executeJavaScript('window.scrollTo({top:0,behavior:"smooth"})'); } catch {} return '↑ Top'; },
      'D': () => { try { wv.reload(); } catch {} return '↓ Reload'; },
      'DR': () => { if (t) TabManager.requestClose(t.id); return '↓→ Close tab'; },
      // TabManager's method is reopenLastClosed; the old reopenClosedTab?.()
      // named nothing, so the gesture did nothing (found 2026-09-29).
      'DL': () => { try { TabManager.reopenLastClosed(); } catch {} return '↓← Reopen tab'; },
      'UR': () => { try { TabManager.createTab(null, true); } catch {} return '↑→ New tab'; },
      // A copy on purpose: without allowDuplicate createTab's already-open
      // guard just switched to this same tab (found 2026-09-29). Same options
      // as the tab menu's Duplicate.
      'UL': () => { try { if (t) TabManager.duplicateTab(t); } catch {} return '↑← Duplicate tab'; },
      // The tab beside it on the strip, as Ctrl+Tab goes: it walked the
      // internal list, not the order on screen, and stopped on tabs hidden in
      // a collapsed group (found 2026-10-10).
      'RD': () => { TabManager.cycleTab(1); return '→↓ Next tab'; },
      'LD': () => { TabManager.cycleTab(-1); return '←↓ Previous tab'; },
    }[dir];
    if (!act) return;
    const label = act();
    window.showToast?.(label);
  },
};

if (typeof window !== 'undefined') window.MouseGestures = MouseGestures;
if (typeof module !== 'undefined' && module.exports) module.exports = { MouseGestures };
