// === The bar over a tab an extension is controlling (2026-10-28) ===============
//
// An extension the person allowed to control other tabs (Settings > Extensions, "Allow it to control other tabs") drives a tab through the
// debugger (main/extension-debugger.js). Chrome says so with a bar, "<extension> started debugging this browser", and so does Vex: while
// the tab in front is held by an extension, a bar sits over its top edge with the extension's name and a Stop button. Stop lets go of
// the tab and the extension hears "canceled_by_user". The bar is Vex's own, drawn in the window, so a page cannot hide, fake or press it.
const VexExtDebugBar = {
  _rows: [],
  _bar: null,

  _t(key, fallback) { return (window.VexI18n && window.VexI18n.t(key, fallback)) || fallback; },

  // The rows (main sends [{ tabId (web contents id), extId, name }]) for one tab.
  forTab(rows, wcId) { return (Array.isArray(rows) ? rows : []).filter(r => r && r.tabId === wcId); },

  _activeWcId() {
    try {
      if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
      const wv = WebviewManager.webviews.get(TabManager.activeTabId);
      return wv ? wv.getWebContentsId() : null;
    } catch { return null; }   // vex-allow-empty-catch: a tab with no page yet is simply not one an extension holds
  },

  set(rows) {
    this._rows = Array.isArray(rows) ? rows : [];
    this.refresh();
  },

  refresh() {
    const held = this.forTab(this._rows, this._activeWcId());
    if (!held.length) { this._remove(); return; }
    this._draw(held);
  },

  _remove() {
    if (this._bar) { this._bar.remove(); this._bar = null; }
  },

  _draw(held) {
    const names = [...new Set(held.map(r => r.name))];
    const text = names.length === 1
      ? this._t('extDbgOne', '{name} is controlling this tab').split('{name}').join(names[0])
      : this._t('extDbgMany', '{names} are controlling this tab').split('{names}').join(names.join(', '));
    if (!this._bar) {
      const bar = document.createElement('div');
      bar.id = 'ext-debug-bar';
      bar.className = 'ext-debug-bar';
      bar.setAttribute('role', 'status');
      const label = document.createElement('span');
      label.className = 'ext-debug-bar-text';
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'ext-debug-bar-stop';
      stop.textContent = this._t('extDbgStop', 'Stop');
      stop.addEventListener('click', () => this._stop());
      bar.append(label, stop);
      document.body.appendChild(bar);
      if (typeof VexLayer !== 'undefined') VexLayer.track(bar, { tier: 'chrome', id: 'ext-debug-bar', keep: true });
      this._bar = bar;
    }
    this._bar.querySelector('.ext-debug-bar-text').textContent = text;
    this._place();
  },

  // Over the top edge of the page area, as wide as it.
  _place() {
    const area = document.getElementById('webviews-container');
    if (!area || !this._bar) return;
    const r = area.getBoundingClientRect();
    this._bar.style.top = Math.round(r.top) + 'px';
    this._bar.style.left = Math.round(r.left) + 'px';
    this._bar.style.width = Math.round(r.width) + 'px';
  },

  async _stop() {
    const wcId = this._activeWcId();
    for (const r of this.forTab(this._rows, wcId)) {
      try { await window.vex.extensionsDebugStop({ tabId: r.tabId, extId: r.extId }); }
      catch (err) { console.error('[Extensions] could not stop ' + r.name + ':', err); window.showToast?.(this._t('extDbgStopFail', 'Could not stop it: ') + ((err && err.message) || err), 'error'); }
    }
  },

  // An extension tried to drive a tab with the switch off: ask, in Vex's own box. Yes turns the switch on, as its card in Settings does.
  async ask(request) {
    if (!request || typeof request.folder !== 'string' || request.grant !== 'debugger') return;
    const name = String(request.name || request.folder);
    const yes = await window.vexConfirm({
      title: this._t('extGrantAskTitle', 'Let {name} control your tabs?').split('{name}').join(name),
      message: this._t('extGrantAskBody', '{name} wants to read and control the pages of your tabs, to do what you asked it. While it does, a bar on the tab says so, and Stop lets go. It never reaches private or Tor tabs. You can turn this off any time in Settings > Extensions.').split('{name}').join(name),
      okLabel: this._t('extGrantAskYes', 'Allow'),
    });
    if (!yes) return;
    try {
      const r = await window.vex.extensionsSetGrant({ folder: request.folder, grant: 'debugger', on: true });
      if (!r || !r.ok) throw new Error((r && r.error) || 'unknown');
      window.showToast?.(this._t('extGrantAskDone', '{name} can now control your tabs. Ask it again.').split('{name}').join(name), 'success');
    } catch (err) {
      console.error('[Extensions] could not allow ' + name + ':', err);
      window.showToast?.(this._t('extGrantAskFail', 'Could not allow it: ') + ((err && err.message) || err), 'error');
    }
  },

  async init() {
    if (!window.vex || typeof window.vex.onExtensionsDebugState !== 'function') return;
    if (typeof window.vex.onExtensionsGrantAsk === 'function') window.vex.onExtensionsGrantAsk((request) => this.ask(request));
    window.vex.onExtensionsDebugState((rows) => this.set(rows));
    window.addEventListener('vex:tab-activated', () => this.refresh());
    window.addEventListener('resize', () => this._place());
    try { this.set(await window.vex.extensionsDebugState()); }
    catch (err) { console.error('[Extensions] could not read which tabs an extension holds:', err); }
  },
};

if (typeof window !== 'undefined') {
  window.VexExtDebugBar = VexExtDebugBar;
  if (typeof document !== 'undefined' && window.vex) VexExtDebugBar.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtDebugBar };
