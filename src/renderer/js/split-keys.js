// === Split view from the keyboard, snaps and Alt+click (T3-054) ================
//
// What js/split.js had no keys for:
//   * Focus the next pane (Ctrl+Alt+O) and swap the pane in front with the next one
//     (Ctrl+Alt+Y); both are also in Ctrl+K and can be moved in Settings › Shortcuts.
//   * Snap the divider of a two-pane split to 25 / 50 / 75 percent: Ctrl+K, or by
//     dragging it, which clicks into place within 2.5 percent of a snap.
//   * Double-click the divider goes round three states: half and half, the pane in front at
//     80 percent (the most the divider allows), the pane in front taking the whole area (the
//     other pane is folded away, not closed), and back to half and half. Ctrl+K "Split view:
//     fill the area" does the last one directly. Only the way the area is laid out changes;
//     the saved split keeps its ratio.
//   * Alt+click a link: it opens in the other pane. With no split, the page is split and the
//     link opens beside it. The page (preload-webview.js) only says "this link was
//     Alt-clicked"; the address is checked here, and nothing happens unless this
//     switch is on, because Alt+click normally saves the link.
//
// Drag a tab onto the page to split (T3-054): while a tab is being dragged and the screen is not split,
// two drop targets cover the page, "Split: left" and "Split: right". Dropping the tab on one splits
// the page you are on with that tab, the dragged tab on that side. Nothing is covered when no tab is
// being dragged, and a tab dropped anywhere else is reordered as always. A drag that ends anywhere
// else removes the targets.
const VexSplitKeys = {
  KEY: 'vex.splitKeys',
  DEFAULTS: { on: true, altClick: true, dragSplit: true },
  SNAPS: [0.25, 0.5, 0.75],
  SNAP_RANGE: 0.025,
  FOCUSED_RATIO: 0.8,

  prefs() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return { ...this.DEFAULTS };
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[SplitKeys] the saved choices are damaged and start again:', err); return { ...this.DEFAULTS }; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...this.DEFAULTS };
    const out = { ...this.DEFAULTS };
    for (const k of Object.keys(this.DEFAULTS)) if (typeof v[k] === 'boolean') out[k] = v[k];
    return out;
  },
  save(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in this.DEFAULTS)) throw new Error('Unknown split choice: ' + k);
      if (typeof v !== 'boolean') throw new Error('Split choice "' + k + '" is on or off');
    }
    localStorage.setItem(this.KEY, JSON.stringify({ ...this.prefs(), ...patch }));
    this._armAll();
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { this.save({ on: !!on }); },
  _altClickOn() { const p = this.prefs(); return p.on && p.altClick; },

  // ---- panes from the keyboard ------------------------------------------------------
  _panes() {
    if (typeof SplitScreen === 'undefined' || !SplitScreen.active || SplitScreen.panes.length < 2) throw new Error('The screen is not split: use the Split button first');
    return SplitScreen.panes;
  },
  _need() { if (!this.enabled()) throw new Error('Split view keys are switched off in Settings'); },

  focusNext(dir = 1) {
    this._need();
    const panes = this._panes();
    const at = Math.max(0, panes.indexOf(TabManager.activeTabId));
    const id = panes[(at + dir + panes.length) % panes.length];
    SplitScreen.focusPane(id);
    // The page itself takes the focus, so typing goes where the pane is.
    const wv = WebviewManager.webviews.get(id);
    if (wv && typeof wv.focus === 'function') wv.focus();
    return id;
  },

  // The pane in front changes places with the next pane.
  swap() {
    this._need();
    const panes = this._panes();
    const at = Math.max(0, panes.indexOf(TabManager.activeTabId));
    const other = (at + 1) % panes.length;
    [panes[at], panes[other]] = [panes[other], panes[at]];
    SplitScreen.applySplit();
    return panes.slice();
  },

  // ---- the divider -----------------------------------------------------------------
  snapNear(ratio) {
    if (!this.enabled()) return ratio;
    for (const s of this.SNAPS) if (Math.abs(ratio - s) <= this.SNAP_RANGE) return s;
    return ratio;
  },
  setRatio(ratio) {
    this._need();
    const panes = this._panes();
    if (panes.length !== 2) throw new Error('Snaps are for a split of two panes');
    SplitScreen.splitRatio = Math.max(0.2, Math.min(0.8, ratio));
    const container = document.getElementById('webviews-container');
    container.style.gridTemplateColumns = SplitScreen.splitRatio + 'fr 4px ' + (1 - SplitScreen.splitRatio) + 'fr';
    SplitScreen.updateMiniUrlBars();
    SplitScreen._saveLayout();
  },
  // Is the area given to one pane right now? (Read from the layout itself, so a re-layout clears it.)
  isFilled() {
    const container = document.getElementById('webviews-container');
    return !!container && /(^|\s)0fr(\s|$)/.test(container.style.gridTemplateColumns || '');
  },
  // The pane in front takes the whole area, or the split goes back to the divider's place.
  toggleFill() {
    this._need();
    const panes = this._panes();
    if (panes.length !== 2) throw new Error('This is for a split of two panes');
    const container = document.getElementById('webviews-container');
    if (this.isFilled()) { this.setRatio(0.5); return false; }
    const first = panes[0] === TabManager.activeTabId;
    container.style.gridTemplateColumns = first ? '1fr 0px 0fr' : '0fr 0px 1fr';
    SplitScreen.updateMiniUrlBars();
    return true;
  },
  // Half and half, then the pane in front at 80 percent, then the pane in front filling the area, then half again.
  toggleFocused() {
    this._need();
    const panes = this._panes();
    if (panes.length !== 2) throw new Error('This is for a split of two panes');
    if (this.isFilled()) { this.setRatio(0.5); return; }
    const first = panes[0] === TabManager.activeTabId;
    const wide = first ? this.FOCUSED_RATIO : 1 - this.FOCUSED_RATIO;
    const now = SplitScreen.splitRatio;
    if (Math.abs(now - 0.5) < 0.01) { this.setRatio(wide); return; }
    if (Math.abs(now - wide) < 0.01) { this.toggleFill(); return; }
    this.setRatio(0.5);
  },

  // ---- drag a tab onto the page ---------------------------------------------------------------
  // The tab being dragged, by the id the strip puts in the drag: a real tab that is not the one in front.
  dragTabId(dt) {
    if (!dt || !dt.types || ![...dt.types].includes('text/plain')) return null;
    const id = String(dt.getData ? dt.getData('text/plain') : '');
    if (!id || typeof TabManager === 'undefined' || id === TabManager.activeTabId) return null;
    return TabManager.tabs.some(t => t.id === id) ? id : null;
  },
  _targets() {
    let box = document.getElementById('vex-split-drop');
    if (box) return box;
    const host = document.getElementById('webviews-container');
    if (!host) throw new Error('The page area is not there');
    box = document.createElement('div');
    box.id = 'vex-split-drop';
    box.hidden = true;
    for (const side of ['left', 'right']) {
      const z = document.createElement('div');
      z.className = 'vex-split-drop-zone';
      z.dataset.side = side;
      z.textContent = 'Split: ' + side;
      z.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', (e) => {
        e.preventDefault();
        z.classList.remove('over');
        try { this.dropOn(side, e.dataTransfer); } catch (err) { window.showToast?.(err.message, 'error'); }
        this._hideTargets();
      });
      box.appendChild(z);
    }
    host.appendChild(box);
    return box;
  },
  _hideTargets() { const b = document.getElementById('vex-split-drop'); if (b) { b.hidden = true; b.querySelectorAll('.over').forEach(z => z.classList.remove('over')); } },
  // Splits the page in front with the dragged tab, the dragged tab on `side`.
  dropOn(side, dt) {
    this._need();
    if (!this.prefs().dragSplit) throw new Error('Dragging a tab to split is switched off in Settings');
    if (typeof SplitScreen === 'undefined') throw new Error('Split view is not loaded');
    if (SplitScreen.active) throw new Error('The screen is already split');
    const id = this.dragTabId(dt);
    if (!id) throw new Error('Drag a different tab onto the page');
    const here = TabManager.activeTabId;
    if (!SplitScreen.restore(side === 'left' ? [id, here] : [here, id], 0.5)) throw new Error('The screen could not be split');
    return id;
  },
  wireDrag() {
    // Chromium hides the data of a drag until the drop, so the targets show for any tab drag and the drop checks.
    document.addEventListener('dragstart', (e) => {
      try {
        if (!this._dragOn() || (typeof SplitScreen !== 'undefined' && SplitScreen.active)) return;
        if (!e.target || !e.target.closest || !e.target.closest('.top-tab, .tab-item')) return;
        this._targets().hidden = false;
      } catch (err) { window.VexProblems?.note('Split view', 'Could not show the split targets', err); }
    }, true);
    document.addEventListener('dragend', () => this._hideTargets(), true);
    document.addEventListener('drop', () => this._hideTargets(), true);
  },
  _dragOn() { const p = this.prefs(); return p.on && p.dragSplit; },

  // ---- Alt+click on a link ---------------------------------------------------------
  // The preload only acts on Alt+click once it has been told it may.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('dom-ready', () => this._arm(webview));
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-alt-link') return;
      if (!this._altClickOn()) return;
      const href = e.args && e.args[0];
      this.openBeside(webview, href).catch(err => {
        if (typeof VexProblems !== 'undefined') VexProblems.note('Split view', 'Alt+click could not open the link', err);
        window.showToast?.('Alt+click did not work: ' + ((err && err.message) || err), 'error');
      });
    });
  },
  _arm(webview) {
    if (!webview || typeof webview.send !== 'function') return;
    webview.send('vex-altlink', this._altClickOn());
  },
  _armAll() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    for (const wv of WebviewManager.webviews.values()) {
      try { if (wv._attached) this._arm(wv); } catch (err) { console.warn('[SplitKeys] could not tell a page about the switch:', err.message); }
    }
  },

  // The address comes from a page: only a plain web address is taken, whatever else it says.
  cleanAddress(href) {
    if (typeof href !== 'string' || href.length > 4096) throw new Error('That link is not an address Vex can open');
    let u;
    try { u = new URL(href); } catch { throw new Error('That link is not an address Vex can open'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web links open beside the page');
    return u.href;
  },

  async openBeside(webview, href) {
    const url = this.cleanAddress(href);
    const from = [...WebviewManager.webviews.entries()].find(([, wv]) => wv === webview);
    if (!from) throw new Error('That page is not one of the open tabs');
    const fromId = from[0];
    // Only from a page you can see: the one in front, or a pane of the split.
    const visible = fromId === TabManager.activeTabId || (typeof SplitScreen !== 'undefined' && SplitScreen.active && SplitScreen.panes.includes(fromId));
    if (!visible) return;
    if (typeof SplitScreen !== 'undefined' && SplitScreen.active && SplitScreen.panes.length >= 2) {
      const panes = SplitScreen.panes;
      const otherId = panes[(panes.indexOf(fromId) + 1) % panes.length];
      const target = WebviewManager.webviews.get(otherId);
      if (!target) throw new Error('The other pane has no page yet');
      await target.loadURL(url).catch(err => { if (!/ERR_ABORTED|\(-3\)/.test(String((err && err.message) || err))) throw err; });
      return;
    }
    // No split: the link opens in a new tab of the same session, and the two go side by side.
    const here = TabManager.tabs.find(t => t.id === fromId);
    const made = TabManager.createTab(url, false, here && here.groupId, here && here.partition ? { partition: here.partition } : null);
    const newId = typeof made === 'string' ? made : made.id;
    if (!SplitScreen.restore([fromId, newId], 0.5)) throw new Error('The screen could not be split');
  },

  init() {
    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      const run = (fn) => () => { try { fn(); } catch (err) { window.showToast?.(err.message, 'error'); } };
      // Written out, so the command-grammar test (which reads registerCommand({ id, label }) from the source) sees every one.
      VexExtras.registerCommand({ id: 'split-focus-next', label: 'Split view: next pane', hint: 'Move to the next pane of the split (Ctrl+Alt+O)', icon: 'split', action: run(() => this.focusNext(1)) });
      VexExtras.registerCommand({ id: 'split-swap-panes', label: 'Split view: swap panes', hint: 'The pane in front changes places with the next one (Ctrl+Alt+Y)', icon: 'split', action: run(() => this.swap()) });
      VexExtras.registerCommand({ id: 'split-snap-25', label: 'Split view: 25 / 75', hint: 'Divider a quarter of the way across', icon: 'split', action: run(() => this.setRatio(0.25)) });
      VexExtras.registerCommand({ id: 'split-snap-50', label: 'Split view: 50 / 50', hint: 'Divider in the middle', icon: 'split', action: run(() => this.setRatio(0.5)) });
      VexExtras.registerCommand({ id: 'split-snap-75', label: 'Split view: 75 / 25', hint: 'Divider three quarters of the way across', icon: 'split', action: run(() => this.setRatio(0.75)) });
      VexExtras.registerCommand({ id: 'split-fill-area', label: 'Split view: fill the area', hint: 'The pane in front takes the whole area; again, and the divider is back (double-click the divider does the same, step by step)', icon: 'split', action: run(() => this.toggleFill()) });
    }
    this.wireDrag();
    const divider = document.getElementById('split-divider');
    if (divider) divider.addEventListener('dblclick', () => {
      try { this.toggleFocused(); } catch (err) { window.showToast?.(err.message, 'error'); }
    });
  },
};

if (typeof window !== 'undefined') window.VexSplitKeys = VexSplitKeys;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSplitKeys };
