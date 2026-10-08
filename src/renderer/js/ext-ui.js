// === What extensions show in Vex: right-click menu items and toolbar badges ===
//
// Main keeps every extension's chrome.contextMenus items and chrome.action
// badge (src/main/extension-ui.js) and sends the whole picture here whenever
// it changes ('extensions:ui-state'). This draws them:
//   * pageMenuRows — the extension rows of the page's right-click menu
//     (WebviewManager.showContextMenu): one item shows on its own beside the
//     extension's icon, several go into a submenu named after the extension,
//     as in Chrome;
//   * actionMenuRows — an extension's items for its toolbar button
//     (contexts "action"), in the extensions menu's right-click menu;
//   * badgeFor — the badge for the tab in front.
// A click goes back to main, which tells the extension (onClicked).
// Which items show for a click is decided by js/ext-menu-model.js, the same
// rules main checks the click against.
const VexExtUi = {
  state: { menus: {}, action: {}, exts: {}, pins: [], loaded: [] },
  _listeners: new Set(),

  init() {
    if (!window.vex || typeof window.vex.extensionsUiState !== 'function') return;
    window.vex.onExtensionsUiState((s) => this._set(s));
    window.vex.extensionsUiState().then((s) => this._set(s), (err) => console.error('[Extensions] could not read what extensions show:', err && err.message));
    // An extension's "_execute_action" shortcut: its popup, or its button's click.
    window.vex.onExtensionsRunAction((req) => {
      if (typeof ExtensionsMenu !== 'undefined') ExtensionsMenu.runAction(req);
    });
  },

  _set(s) {
    this.state = s && typeof s === 'object'
      ? { menus: s.menus || {}, action: s.action || {}, exts: s.exts || {}, pins: Array.isArray(s.pins) ? s.pins : [], loaded: Array.isArray(s.loaded) ? s.loaded : [] }
      : { menus: {}, action: {}, exts: {}, pins: [], loaded: [] };
    this._listeners.forEach((fn) => { try { fn(); } catch (err) { console.error('[Extensions] a listener failed:', err); } });
  },
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },

  // A tab's partition, as main knows its session ('' is the default session).
  partitionOf(webview) {
    return (webview && typeof webview.getAttribute === 'function' && webview.getAttribute('partition')) || '';
  },
  pageIdOf(webview) {
    if (!webview || typeof webview.getWebContentsId !== 'function') return null;
    try { const id = webview.getWebContentsId(); return Number.isInteger(id) && id > 0 ? id : null; }
    catch { return null; } // not attached yet: no page to name
  },
  iconUrl(meta) {
    const p = meta && meta.iconPath;
    if (typeof p !== 'string' || !p) return '';
    return encodeURI('file:///' + p.replace(/\\/g, '/').replace(/^\/+/, ''));
  },

  // A tree from ext-menu-model.visibleTree → rows for WebviewManager._renderMenu.
  _rows(tree, click) {
    // Plain items line up with checkable ones in the same list, as in Chrome.
    const checkable = tree.some((n) => n.type === 'checkbox' || n.type === 'radio');
    return tree.map((node) => {
      if (node.type === 'separator') return { sep: true };
      const row = { label: node.title, disabled: !node.enabled, action: () => click(node) };
      if (node.type === 'checkbox' || node.type === 'radio') { row.kind = node.type; row.checked = node.checked; }
      else if (checkable) row.pad = true;
      if (node.children && node.children.length) { row.sub = this._rows(node.children, click); delete row.action; }
      return row;
    });
  },

  _click(partition, extId, itemId, ctx, tab) {
    window.vex.extensionsMenuClick({ partition, id: extId, item: itemId, tab, ctx })
      .catch((err) => window.showToast?.('The extension did not get that click: ' + String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''), 'error'));
  },

  pageMenuRows(webview, params, imageSrc) {
    if (typeof VexExtMenuModel === 'undefined' || !window.vex || typeof window.vex.extensionsMenuClick !== 'function') return [];
    const partition = this.partitionOf(webview);
    const byExt = (this.state.menus || {})[partition];
    if (!byExt) return [];
    let pageUrl = '';
    try { pageUrl = webview.getURL(); } catch { pageUrl = ''; }
    const ctx = VexExtMenuModel.pageContext(params, { imageSrc, pageUrl });
    const tab = this.pageIdOf(webview);
    const rows = [];
    for (const [extId, items] of Object.entries(byExt)) {
      const meta = this.state.exts[extId];
      if (!meta) continue;
      const tree = VexExtMenuModel.visibleTree(items, ctx);
      if (!tree.length) continue;
      const click = (node) => this._click(partition, extId, node.id, ctx, tab);
      const drawn = this._rows(tree, click);
      const img = this.iconUrl(meta);
      if (drawn.length === 1) rows.push({ ...drawn[0], img, icon: img ? undefined : 'puzzle' });
      else rows.push({ label: meta.name, img, icon: img ? undefined : 'puzzle', sub: drawn });
    }
    return rows;
  },

  // The tab in front: its partition and page id.
  _front() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    return { partition: wv ? this.partitionOf(wv) : 'persist:main', tab: this.pageIdOf(wv), wv };
  },

  actionMenuRows(extId) {
    if (typeof VexExtMenuModel === 'undefined' || !extId) return [];
    const { partition, tab, wv } = this._front();
    const items = ((this.state.menus || {})[partition] || {})[extId];
    if (!items) return [];
    let pageUrl = '';
    try { pageUrl = wv ? wv.getURL() : ''; } catch { pageUrl = ''; }
    const ctx = { kind: 'action', pageUrl };
    const tree = VexExtMenuModel.visibleTree(items, ctx);
    return this._rows(tree, (node) => this._click(partition, extId, node.id, ctx, tab));
  },

  // What the extension set for its button, for the tab in front: a tab's
  // own value, else the one for every tab; undefined where it set nothing.
  _actionValue(extId, key) {
    const { partition, tab } = this._front();
    const st = ((this.state.action || {})[partition] || {})[extId];
    if (!st) return undefined;
    const own = (tab != null && st.tabs && st.tabs[tab]) || {};
    if (Object.prototype.hasOwnProperty.call(own, key)) return own[key];
    return st.def && Object.prototype.hasOwnProperty.call(st.def, key) ? st.def[key] : undefined;
  },
  // { text, bg: [r,g,b,a], color: [r,g,b,a], title } for the tab in front.
  badgeFor(extId) {
    const { partition } = this._front();
    if (!((this.state.action || {})[partition] || {})[extId]) return null;
    const v = (k) => this._actionValue(extId, k);
    return { text: v('text') || '', bg: v('bg') || [217, 48, 37, 255], color: v('color') || [255, 255, 255, 255], title: v('title') || '' };
  },
  // The button's picture (action.setIcon) as an address, else the manifest's.
  iconFor(extId, manifestIconPath) {
    const set = extId ? this._actionValue(extId, 'icon') : undefined;
    if (typeof set === 'string' && set) return set.startsWith('data:') ? set : this.iconUrl({ iconPath: set });
    return this.iconUrl({ iconPath: manifestIconPath });
  },
  // Whether a click opens a popup: what action.setPopup said ('' is none),
  // else whether the manifest has one.
  hasPopupFor(ext) {
    const set = ext && ext.id ? this._actionValue(ext.id, 'popup') : undefined;
    return typeof set === 'string' ? !!set : !!(ext && ext.hasPopup);
  },
  rgba(c) { return Array.isArray(c) && c.length === 4 ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})` : ''; },
};

if (typeof window !== 'undefined') {
  window.VexExtUi = VexExtUi;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexExtUi.init());
  else VexExtUi.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtUi };
