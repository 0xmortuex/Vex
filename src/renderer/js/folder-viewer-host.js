// === Vex's own folder browser: the switch, the address, the theme and the messages =========
//
// A folder a tab opens (file:///C:/Users/me/) is shown by a page of Vex's own (src/renderer/folder-viewer, served by
// src/main/folder-viewer.js) instead of Chromium's plain "Index of" list: a sortable list with sizes and dates, pictures as
// thumbnails, a preview pane, rename, new folder and delete to the Recycle Bin. Main is what catches the folder (a main-frame
// file: navigation that is a folder, made by the person and not by a page); this file is the window's part:
//
//   * the on/off switch (told to main) and its Settings section and Ctrl+K command;
//   * the address: the viewer lives at vex-files://browse/?u=<the folder's file: address>, and the tab, its address bar, its
//     history, its bookmarks and its reload keep the folder's own file: address (original() below; js/webview.js maps with it);
//   * the theme, the look and the font, sent to the page as they change;
//   * what the page asks of the window through sendToHost: open a file in this tab or in a new one.
//
//   vex.folderBrowser.prefs = { enabled }       on unless it was switched off
const VexFolderViewer = {
  PREF: 'vex.folderBrowser.prefs',
  FEATURE: 'folder-browser',

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[FolderBrowser]', err.message); return true; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    this.apply();
    return !!on;
  },
  // Main is what catches a folder, so main is told.
  apply() {
    const on = this.enabled();
    if (window.vex && typeof window.vex.folderviewSetEnabled === 'function') {
      window.vex.folderviewSetEnabled(on).catch((err) => console.error('[FolderBrowser] main could not be told:', err && err.message));
    }
  },

  // The folder's own address for a viewer address, else null. The twin of parseViewerUrl in src/main/folder-viewer.js (a test holds them equal).
  original(url) {
    const s = String(url || '');
    if (!/^vex-files:\/\/browse\/(?:\?|$)/i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.pathname !== '/') return null;
    const original = u.searchParams.get('u');
    return original && /^file:/i.test(original) ? original : null;
  },

  // The colours and type of the interface as the page needs them: the values this window resolves for the theme, the browser look,
  // the custom theme and the chosen font, so the page matches every one of them without carrying a copy.
  THEME_VARS: ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input',
    '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--vex-border-accent', '--vex-accent', '--vex-accent-dim', '--vex-accent-glow',
    '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-success', '--vex-danger', '--vex-danger-hover', '--vex-warning',
    '--vex-hover-fill', '--vex-shadow-color', '--vex-radius-sm', '--vex-radius-md', '--vex-radius-lg', '--vex-font-base', '--vex-font-display', '--vex-font-heading',
    '--vex-font-mono', '--on-primary', '--b-font', '--b-btn-radius', '--b-ring-w', '--b-accent-ring',
    // The older names the calm panels (css/ai-panel.css) are written in.
    '--bg', '--bg-2', '--surface', '--border', '--text', '--text-muted', '--primary', '--primary-hover', '--danger', '--success', '--accent'],
  themePayload() {
    const cs = getComputedStyle(document.body);
    const vars = {};
    for (const name of this.THEME_VARS) { const v = cs.getPropertyValue(name).trim(); if (v) vars[name] = v; }
    const root = document.documentElement;
    return {
      vars, lang: root.lang || 'en',
      attrs: { 'data-theme': root.getAttribute('data-theme') || '', 'data-scheme': root.getAttribute('data-scheme') || '', 'data-gui-style': document.body.getAttribute('data-gui-style') || '', 'data-gui-family': document.body.getAttribute('data-gui-family') || '' },
    };
  },
  sendTheme(webview) {
    try { webview.send('folderview:theme', this.themePayload()); }
    catch (err) { if (!/dom-ready|attached/i.test(String(err && err.message))) console.warn('[Vex] the folder browser could not be given the theme:', err && err.message); }
  },
  sendThemeToAll(webviews) {
    for (const wv of webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }
      if (this.original(url)) this.sendTheme(wv);
    }
  },

  // A file name from the page: a leaf, never a path. (Main checks the same on every channel; this is the window's own gate.)
  leaf(name) {
    if (typeof name !== 'string' || !name || name.length > 255 || /[\\/:\u0000-\u001f]/.test(name) || name === '.' || name === '..') throw new Error('That is not a file name');
    return name;
  },
  // The file: address of an entry of the folder the tab shows.
  entryUrl(folderUrl, name) {
    const base = folderUrl.endsWith('/') ? folderUrl : folderUrl + '/';
    return base + encodeURIComponent(this.leaf(name));
  },

  // Called by js/webview.js for every message a tab's page sends. true = it was one of ours.
  handleMessage(webview, tab, e) {
    if (!e || typeof e.channel !== 'string' || !e.channel.startsWith('folderview:')) return false;
    if (e.channel === 'folderview:need-theme') { this.sendTheme(webview); return true; }
    if (e.channel === 'folderview:open') {
      try {
        const detail = (e.args && e.args[0]) || {};
        const mode = ['here', 'tab', 'background'].includes(detail.mode) ? detail.mode : 'here';
        const folderUrl = this.original(webview.getURL());
        if (!folderUrl) throw new Error('This tab is not showing a folder');
        const url = this.entryUrl(folderUrl, detail.name) + (detail.folder ? '/' : '');
        if (mode === 'here') { Promise.resolve(webview.loadURL(url)).catch((err) => { if (!/ERR_ABORTED|\(-3\)/.test(String(err && err.message))) window.showToast?.(String(err && err.message), 'error'); }); }
        else if (typeof TabManager !== 'undefined') TabManager.createTab(url, mode === 'tab', (tab && tab.groupId) || null, { partition: (tab && tab.partition) || undefined });
      } catch (err) { window.showToast?.(err.message, 'error'); }
      return true;
    }
    return true;
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Folders open in Vex\'s own folder browser: a sortable list with sizes and dates, pictures as thumbnails, a preview pane, and rename, new folder and delete to the Recycle Bin. It opens only for an address you type, a bookmark or a link in Vex itself, never for a link on a web page, and it is not used in private or Tor tabs. Nothing is sent anywhere.'));
    const row = document.createElement('label');
    row.className = 'vexsr-rule';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.enabled();
    box.addEventListener('change', () => {
      try { this.setEnabled(box.checked); window.showToast?.(box.checked ? 'Folders open in Vex\'s own folder browser' : 'Folders open in the browser\'s plain list again', 'info'); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
    });
    row.append(box, document.createTextNode(' Show folders in Vex\'s own folder browser'));
    el.appendChild(row);
    el.appendChild(G.note('Switched off, folders open in Chromium\'s plain "Index of" list as before. The folder browser\'s More menu also has "Open in the plain list" for a single folder.'));
    el.appendChild(G.button('Forget the recent folders', async () => {
      try {
        if (!window.vex || typeof window.vex.folderviewForgetRecent !== 'function') throw new Error('The folder browser could not be reached from this window');
        const r = await window.vex.folderviewForgetRecent();
        if (!r || !r.ok) throw new Error((r && r.error) || 'The recent folders could not be cleared');
        window.showToast?.('Vex forgot the recent folders', 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    el.appendChild(G.note('Vex remembers the folders you opened last on this computer only. Private and Tor tabs never keep them. They are not synced.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexFolderViewer = VexFolderViewer;
  VexFolderViewer.apply();
  // A folder browser that opened before this file loaded (a restored tab) is given the theme now.
  setTimeout(() => { try { if (window.WebviewManager && window.WebviewManager.webviews) VexFolderViewer.sendThemeToAll(window.WebviewManager.webviews); } catch (err) { console.warn('[Vex] the folder browsers could not be given the theme:', err && err.message); } }, 0);
  // An open folder browser follows the theme, the look and the font as they change here.
  const pushTheme = () => {
    try { if (window.WebviewManager && window.WebviewManager.webviews) VexFolderViewer.sendThemeToAll(window.WebviewManager.webviews); }
    catch (err) { console.warn('[Vex] the folder browsers could not be given the theme:', err && err.message); }
  };
  document.addEventListener('theme-changed', pushTheme);
  document.addEventListener('vex:font-changed', pushTheme);
  // A look is applied a moment after the event that names it.
  window.addEventListener('vex:gui-style', () => setTimeout(pushTheme, 150));
  window.addEventListener('vex:gui-colors', () => setTimeout(pushTheme, 150));
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'folder-browser', title: 'Folder browser', keywords: 'folder browser files explorer directory index list thumbnails recycle bin rename drives this pc', before: 'about', build: (el) => VexFolderViewer.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'folder-browser-settings', label: 'Folder browser', hint: 'Settings for the page that shows your folders', icon: 'folder',
      action: () => { if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('vex-sg-folder-browser'); },
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFolderViewer };
