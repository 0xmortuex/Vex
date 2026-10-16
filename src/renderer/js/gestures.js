// === Vex Mouse Gestures ===
//
// Hold the RIGHT mouse button and drag inside any page, release to act:
//   ←  back        →  forward       ↑  scroll to top
//   ↓  reload      ↓→ close tab     ↓← reopen closed tab
// The guest-side tracker lives in preload-webview.js (it watches right-drag
// and sendToHost's 'vex-gesture'); a normal right-click still opens the
// context menu. Toggle in Settings → Browser; default ON.
//
// What each stroke does can be changed (T3-068, js/gesture-editor.js): a stroke
// is bound to one of the actions below, or to any Ctrl+K command (a command
// chain too) as 'cmd:<command id>'. Nothing bound by you means the built-in
// map, which is what every stroke did before the editor existed.

const MouseGestures = {
  KEY: 'vex.gesturesEnabled',
  BINDINGS_KEY: 'vex.gestureBindings',
  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch {} },

  // The strokes the page can report: one of four directions, or two different
  // ones in a row (the tracker in preload-webview.js stops at two strokes and
  // never repeats a direction).
  DIRS: (() => {
    const one = ['L', 'R', 'U', 'D'];
    const two = [];
    for (const a of one) for (const b of one) if (a !== b) two.push(a + b);
    return one.concat(two);
  })(),
  ARROW: { L: '←', R: '→', U: '↑', D: '↓' },
  arrows(dir) { return String(dir).split('').map(c => this.ARROW[c] || c).join(''); },

  // The built-in stroke map: what a stroke does until you change it.
  DEFAULT_MAP: {
    L: 'back', R: 'forward', U: 'top', D: 'reload', DR: 'close-tab', DL: 'reopen-tab',
    UR: 'new-tab', UL: 'duplicate-tab', RD: 'next-tab', LD: 'prev-tab',
  },

  // Every action a stroke can do. `label` is what the toast says and what the
  // editor lists. run(wv, tab) throws when it cannot; the caller reports it.
  ACTIONS: {
    'back':          { label: 'Back',                 run: (wv) => { if (wv.canGoBack()) wv.goBack(); } },
    'forward':       { label: 'Forward',              run: (wv) => { if (wv.canGoForward()) wv.goForward(); } },
    'top':           { label: 'Scroll to top',        run: (wv) => { wv.executeJavaScript('window.scrollTo({top:0,behavior:"smooth"})'); } },
    'bottom':        { label: 'Scroll to bottom',     run: (wv) => { wv.executeJavaScript('window.scrollTo({top:document.documentElement.scrollHeight,behavior:"smooth"})'); } },
    'reload':        { label: 'Reload',               run: (wv) => { wv.reload(); } },
    'close-tab':     { label: 'Close tab',            run: (wv, t) => { if (t) TabManager.requestClose(t.id); } },
    // TabManager's method is reopenLastClosed; the old reopenClosedTab?.()
    // named nothing, so the gesture did nothing (found 2026-09-29).
    'reopen-tab':    { label: 'Reopen closed tab',    run: () => { TabManager.reopenLastClosed(); } },
    'new-tab':       { label: 'New tab',              run: () => { TabManager.createTab(null, true); } },
    // A copy on purpose: without allowDuplicate createTab's already-open
    // guard just switched to this same tab (found 2026-09-29). Same options
    // as the tab menu's Duplicate.
    'duplicate-tab': { label: 'Duplicate tab',        run: (wv, t) => { if (t) TabManager.duplicateTab(t); } },
    // The tab beside it on the strip, as Ctrl+Tab goes: it walked the
    // internal list, not the order on screen, and stopped on tabs hidden in
    // a collapsed group (found 2026-10-10).
    'next-tab':      { label: 'Next tab',             run: () => { TabManager.cycleTab(1); } },
    'prev-tab':      { label: 'Previous tab',         run: () => { TabManager.cycleTab(-1); } },
    'mute-tab':      { label: 'Mute or unmute tab',   run: (wv, t) => { if (t) TabManager.toggleMuteTab(t.id); } },
    'pin-tab':       { label: 'Pin or unpin tab',     run: (wv, t) => { if (t) TabManager.togglePinTab(t.id); } },
  },
  CMD_PREFIX: 'cmd:',

  // ---- the bindings you made ----------------------------------------------------
  // → { dir: actionId } for the strokes you changed. '' means "do nothing".
  // A damaged record is said on the console and ignored, never half-used.
  bindings() {
    let raw = null;
    try { raw = localStorage.getItem(this.BINDINGS_KEY); } catch (err) { console.error('[Gestures] the saved strokes could not be read:', err); return {}; }
    if (raw === null) return {};
    let v;
    try { v = JSON.parse(raw); } catch (err) { console.error('[Gestures] the saved strokes are damaged and the built-in ones are used:', err); return {}; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const dir of this.DIRS) if (typeof v[dir] === 'string') out[dir] = v[dir];
    return out;
  },
  // The action a stroke has now: yours, else the built-in, else '' (nothing).
  actionFor(dir) {
    const mine = this.bindings();
    if (Object.prototype.hasOwnProperty.call(mine, dir)) return mine[dir];
    return this.DEFAULT_MAP[dir] || '';
  },
  isKnownAction(id) {
    return id === '' || Object.prototype.hasOwnProperty.call(this.ACTIONS, id) || (typeof id === 'string' && id.startsWith(this.CMD_PREFIX) && id.length > this.CMD_PREFIX.length);
  },
  setBinding(dir, actionId) {
    if (!this.DIRS.includes(dir)) throw new Error('Not a stroke Vex can read: ' + dir);
    if (!this.isKnownAction(actionId)) throw new Error('Not something a stroke can do: ' + actionId);
    const mine = this.bindings();
    // Back to the built-in one takes the record away rather than keeping a copy of it.
    if (actionId === (this.DEFAULT_MAP[dir] || '')) delete mine[dir]; else mine[dir] = actionId;
    this._saveBindings(mine);
  },
  resetBindings() { this._saveBindings({}); },
  _saveBindings(map) {
    if (Object.keys(map).length) localStorage.setItem(this.BINDINGS_KEY, JSON.stringify(map));
    else localStorage.removeItem(this.BINDINGS_KEY);
  },
  // Name an action for the toast and the editor.
  describe(actionId) {
    if (!actionId) return 'Nothing';
    if (this.ACTIONS[actionId]) return this.ACTIONS[actionId].label;
    if (actionId.startsWith(this.CMD_PREFIX)) {
      const id = actionId.slice(this.CMD_PREFIX.length);
      const cmd = this._command(id);
      return cmd ? (cmd.label || id) : id + ' (gone)';
    }
    return actionId;
  },
  _command(id) {
    const list = (typeof CommandBar !== 'undefined' && CommandBar.commands) || [];
    return list.find(c => c && c.id === id) || null;
  },

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
    if (!this.DIRS.includes(dir)) return;
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    // The editor is a Minimal Vex feature: off, the built-in map answers.
    const custom = typeof VexGestureEditor === 'undefined' || VexGestureEditor.enabled();
    const id = custom ? this.actionFor(dir) : (this.DEFAULT_MAP[dir] || '');
    if (!id) return;
    const arrows = this.arrows(dir);
    try {
      if (id.startsWith(this.CMD_PREFIX)) {
        const cmd = this._command(id.slice(this.CMD_PREFIX.length));
        if (!cmd || typeof cmd.action !== 'function') throw new Error('The command bound to ' + arrows + ' is gone — choose another in Settings › Mouse gestures');
        const result = cmd.action();
        if (result && typeof result.catch === 'function') result.catch(err => window.showToast?.(arrows + ' did not work: ' + ((err && err.message) || err), 'error'));
      } else {
        this.ACTIONS[id].run(wv, t);
      }
    } catch (err) {
      window.showToast?.(arrows + ' did not work: ' + ((err && err.message) || err), 'error');
      return;
    }
    window.showToast?.(arrows + ' ' + this.describe(id));
  },
};

if (typeof window !== 'undefined') window.MouseGestures = MouseGestures;
if (typeof module !== 'undefined' && module.exports) module.exports = { MouseGestures };
