// === Vex Webview Manager ===
//
// Creates and destroys <webview> elements per tab and wires their per-tab
// events: loading state, title, favicon, URL, navigation, audio, history
// capture, per-domain zoom, force-dark CSS injection, AI history indexing.
// Public API: WebviewManager (singleton). Depends on TabManager, VexStorage,
// HistoryPanel (optional), HistoryIndexer (optional), TabGrouper (optional).

// The privileged VEX_CMD console channel and the start-page pushes below are
// gated on _isTrustedStartPage (js/start-page-trust.js): Vex's own start.html
// by its whole path, not isStartPage() (js/tabs.js), which matches any file
// named renderer/start.html.

const WebviewManager = {
  webviews: new Map(),
  _historySeq: 0,

  // The tab's back list as main reads it off its page, kept with the tab and
  // saved with it (VexTabPolicy.serialize), so the page can be built again
  // with it (createWebview above). Asked after every navigation of the page.
  _noteHistory(tab, webview) {
    if (typeof window.vex?.tabHistory !== 'function') return;
    let pageId;
    try { pageId = webview.getWebContentsId(); } catch { return; }   // not attached yet: its first navigation asks again
    window.vex.tabHistory(pageId).then(list => {
      if (this.webviews.get(tab.id) !== webview) return;   // slept or closed meanwhile: keep what it had
      tab.history = list || null;
      TabManager.persistTabs();
    }).catch(err => console.warn('[Vex] could not read the tab\'s back list:', err && err.message));
  },

  // One of Vex's own pages (HTTPS-Only's "no secure connection", a
  // certificate error) is a data: page, which the tab otherwise leaves out of
  // its address; main says which address it stands for, and the bar shows
  // that, as Chrome does. It kept the page the person came from. Any other
  // data: page (reading mode's) stands for nothing and is left as it was.
  async _showVexPageAddress(tab, webview, dataUrl) {
    if (typeof window.vex?.vexPageAddress !== 'function') throw new Error('window.vex.vexPageAddress is missing');
    const address = await window.vex.vexPageAddress(webview.getWebContentsId());
    if (!address || webview.getURL() !== dataUrl) return;   // not one of Vex's, or the tab moved on
    TabManager.updateTab(tab.id, { url: address });
    window.dispatchEvent(new CustomEvent('vex:tab-url-changed', { detail: { tabId: tab.id, url: address } }));
  },

  // === Vex's own viewer for office documents and e-books (main/office-viewer.js, pages in src/renderer/office-viewer) ================
  //
  // A document is shown by a page of Vex's own at vex-office://view/?u=<the file's address>. The tab, its address bar, its history, its
  // bookmarks and its reload keep the file's own address: this maps the viewer's address back (the twin in main/office-viewer.js,
  // parseViewerUrl, does the same on the other side; a test holds them equal). Main is what sends a document there (a web answer, a
  // file: download or a click on a file: link), so nothing needs mapping in the other direction.
  officeOriginal(url) {
    const s = String(url || '');
    if (!/^vex-office:\/\/view\/(?:\?|#|$)/i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    const original = u.searchParams.get('u');
    return original ? original + (u.hash ? u.hash : '') : null;
  },

  // The colours and type of the interface as the viewer needs them: the values this window resolves for the theme, the browser look,
  // the custom theme and the chosen font, so the viewer matches every one of them without carrying a copy.
  OFFICE_THEME_VARS: ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input',
    '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--vex-border-accent', '--vex-accent', '--vex-accent-dim', '--vex-accent-glow',
    '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-success', '--vex-danger', '--vex-danger-hover', '--vex-warning',
    '--vex-hover-fill', '--vex-shadow-color', '--vex-radius-sm', '--vex-radius-md', '--vex-radius-lg', '--vex-font-base', '--vex-font-display', '--vex-font-heading',
    '--vex-font-mono', '--on-primary', '--b-font', '--b-btn-radius', '--b-ring-w', '--b-accent-ring',
    // The older names the calm panels (css/ai-panel.css) are written in.
    '--bg', '--bg-2', '--surface', '--border', '--text', '--text-muted', '--primary', '--primary-hover', '--danger', '--success', '--accent'],
  officeThemePayload() {
    const cs = getComputedStyle(document.body);
    const vars = {};
    for (const name of this.OFFICE_THEME_VARS) { const v = cs.getPropertyValue(name).trim(); if (v) vars[name] = v; }
    const root = document.documentElement;
    return {
      vars, lang: root.lang || 'en',
      attrs: { 'data-theme': root.getAttribute('data-theme') || '', 'data-scheme': root.getAttribute('data-scheme') || '', 'data-gui-style': document.body.getAttribute('data-gui-style') || '', 'data-gui-family': document.body.getAttribute('data-gui-family') || '' },
    };
  },
  sendOfficeTheme(webview) {
    try { webview.send('officeview:theme', this.officeThemePayload()); }
    catch (err) { if (!/dom-ready|attached/i.test(String(err && err.message))) console.warn('[Vex] the document viewer could not be given the theme:', err && err.message); }
  },
  sendOfficeThemeToAll() {
    for (const wv of this.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }
      if (this.officeOriginal(url)) this.sendOfficeTheme(wv);
    }
  },

  // === Vex's own video and sound player (main/media-viewer.js, pages in src/renderer/media-viewer) ===================
  //
  // A media file opened as a document is shown by a page of Vex's own at vex-media://view/?u=<the file's address>[#t=30]. The tab, its
  // address bar, its history, its bookmarks and its reload keep the media's own address: this maps the player's address back, and the
  // twin in main/media-viewer.js (parseViewerUrl) does the same on the other side (a test holds them equal). A file: media address is
  // sent to the player here, before anything loads; a web one is caught by main (a redirect, main/doc-viewers.js).
  // VexMediaViewerOff is set by js/media-viewer-host.js when it is switched off.
  mediaAddress(url) {
    const s = String(url || '');
    if ((typeof window !== 'undefined' && window.VexMediaViewerOff) || !/^file:\/\/[^?#]*\.(?:mp4|m4v|webm|mkv|mov|ogv|mp3|m4a|aac|flac|ogg|oga|opus|wav|weba)(?:[?#]|$)/i.test(s)) return s;
    const at = s.indexOf('#');
    return 'vex-media://view/?u=' + encodeURIComponent(at < 0 ? s : s.slice(0, at)) + (at < 0 ? '' : s.slice(at));
  },

  mediaOriginal(url) {
    const s = String(url || '');
    if (!/^vex-media:\/\/view\/(?:\?|#|$)/i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    const original = u.searchParams.get('u');
    return original ? original + (u.hash ? u.hash : '') : null;
  },

  // Whether this webview shows Vex's own video and sound player now.
  mediaPage(webview) {
    let url;
    try { url = webview.getURL(); } catch { return false; }   // not attached yet
    return !!this.mediaOriginal(url);
  },

  // === Vex's own image viewer (main/image-viewer.js, pages in src/renderer/image-viewer) ==============
  //
  // A picture is shown by a page of Vex's own at vex-image://view/?u=<the picture's address>. The tab, its address bar, its
  // history, its bookmarks and its reload keep the picture's own address: imageOriginal maps the viewer's address back, and the
  // twin in main/image-viewer.js (parseViewerUrl) does the same on the other side (a test holds them equal).
  // A file: picture is sent to the viewer here, before anything loads; a picture from the web is turned into a redirect to the
  // viewer in main (main/doc-viewers.js). VexImageViewerOff is set by js/image-viewer-host.js when the viewer is switched off.
  imageViewerAddress(url) {
    const s = String(url || '');
    if ((typeof window !== 'undefined' && window.VexImageViewerOff) || !/^file:\/\/[^?#]*\.(?:png|apng|jpe?g|jpe|jfif|gif|webp|avif|bmp|ico|svg)(?:[?#]|$)/i.test(s)) return s;
    const at = s.indexOf('#');
    return 'vex-image://view/?u=' + encodeURIComponent(at < 0 ? s : s.slice(0, at)) + (at < 0 ? '' : s.slice(at));
  },

  imageOriginal(url) {
    const s = String(url || '');
    if (!/^vex-image:\/\/view\/(?:\?|#|$)/i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    const original = u.searchParams.get('u');
    return original ? original + (u.hash ? u.hash : '') : null;
  },

  // The colours and type of the interface as a Vex document viewer needs them: the values this window resolves for the theme, the
  // browser look, the custom theme and the chosen font, so the viewer matches every one of them without carrying a copy.
  VIEWER_THEME_VARS: ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input',
    '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--vex-border-accent', '--vex-accent', '--vex-accent-dim', '--vex-accent-glow',
    '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-success', '--vex-danger', '--vex-danger-hover', '--vex-warning',
    '--vex-hover-fill', '--vex-shadow-color', '--vex-radius-sm', '--vex-radius-md', '--vex-radius-lg', '--vex-font-base', '--vex-font-display', '--vex-font-heading',
    '--vex-font-mono', '--on-primary', '--b-font', '--b-btn-radius', '--b-ring-w', '--b-accent-ring',
    // The older names the calm panels (css/ai-panel.css) are written in.
    '--bg', '--bg-2', '--surface', '--border', '--text', '--text-muted', '--primary', '--primary-hover', '--danger', '--success', '--accent'],
  viewerThemePayload() {
    const cs = getComputedStyle(document.body);
    const vars = {};
    for (const name of this.VIEWER_THEME_VARS) { const v = cs.getPropertyValue(name).trim(); if (v) vars[name] = v; }
    const root = document.documentElement;
    return {
      vars, lang: root.lang || 'en',
      attrs: { 'data-theme': root.getAttribute('data-theme') || '', 'data-scheme': root.getAttribute('data-scheme') || '', 'data-gui-style': document.body.getAttribute('data-gui-style') || '', 'data-gui-family': document.body.getAttribute('data-gui-family') || '' },
    };
  },
  sendImageTheme(webview) {
    try { webview.send('imageview:theme', this.viewerThemePayload()); }
    catch (err) { if (!/dom-ready|attached/i.test(String(err && err.message))) console.warn('[Vex] the image viewer could not be given the theme:', err && err.message); }
  },
  sendImageThemeToAll() {
    for (const wv of this.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }
      if (this.imageOriginal(url)) this.sendImageTheme(wv);
    }
  },

  // === Vex's own viewer for text-like documents (main/text-viewer.js, pages in src/renderer/doc-viewer) =============
  //
  // A JSON, XML, CSV, Markdown, log or source document, and a view-source: page, is shown by a page of Vex's own at
  // vex-doc://view/?u=<the document's address>[&m=source]. The tab, its address bar, its history, its bookmarks and its reload keep the
  // document's own address (view-source:<address> for a source view): this maps the viewer's address back, and the twin in
  // main/text-viewer.js (parseViewerUrl) does the same on the other side (a test holds them equal).
  // A file: address with a text-like extension and a view-source: address are sent to the viewer here, before anything loads, because no
  // response headers exist for them. A web document is caught from its response instead (main/doc-viewers.js).
  // VexDocViewerOff is set by js/doc-viewer-host.js when the viewer is switched off. DOC_FILE_EXTENSIONS is the twin of FILE_EXTENSIONS in
  // main/text-viewer.js.
  DOC_FILE_EXTENSIONS: ['json', 'jsonl', 'ndjson', 'geojson', 'json5', 'jsonc', 'xml', 'csv', 'tsv', 'md', 'markdown', 'mdx', 'txt', 'text', 'log', 'out',
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'py', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'ini', 'cfg', 'conf', 'toml', 'yaml', 'yml',
    'env', 'sql', 'java', 'kt', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'lua', 'swift', 'r', 'diff', 'patch', 'properties', 'gitignore'],
  docAddress(url) {
    const s = String(url || '');
    if (this._docViewerOff()) return s;
    const source = /^view-source:((?:https?|file):\/\/.+)$/i.exec(s);
    const target = source ? source[1] : s;
    if (!source) {
      if (!/^file:\/\//i.test(s)) return s;
      const path = s.replace(/[?#].*$/, '');
      const name = path.slice(path.lastIndexOf('/') + 1);
      const dot = name.lastIndexOf('.');
      if (dot < 0 || !this.DOC_FILE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())) return s;
    }
    const at = target.indexOf('#');
    return 'vex-doc://view/?u=' + encodeURIComponent(at < 0 ? target : target.slice(0, at)) + (source ? '&m=source' : '') + (at < 0 ? '' : target.slice(at));
  },

  // The switch (js/doc-viewer-host.js) is a late module: until it has run, the saved choice is read from where it is kept, so a tab restored at
  // start-up honours "off" too.
  _docViewerOff() {
    if (typeof window === 'undefined') return false;
    if (window.VexDocViewerOff !== undefined) return !!window.VexDocViewerOff;
    try { const raw = JSON.parse(localStorage.getItem('vex.docViewer.prefs') || 'null'); return !!raw && raw.enabled === false; }
    catch (err) { console.warn('[Vex] the document viewer switch could not be read:', err && err.message); return false; }
  },

  docOriginal(url) {
    const s = String(url || '');
    if (!/^vex-doc:\/\/view\/(?:\?|#|$)/i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    const original = u.searchParams.get('u');
    if (!original) return null;
    return (u.searchParams.get('m') === 'source' ? 'view-source:' : '') + original + (u.hash ? u.hash : '');
  },

  // The colours and type of the interface as the viewer needs them: the values this window resolves for the theme, the browser look, the
  // custom theme and the chosen font, so the viewer matches every one of them without carrying a copy.
  DOC_THEME_VARS: ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input',
    '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--vex-border-accent', '--vex-accent', '--vex-accent-dim', '--vex-accent-glow',
    '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-success', '--vex-danger', '--vex-danger-hover', '--vex-warning',
    '--vex-hover-fill', '--vex-shadow-color', '--vex-radius-sm', '--vex-radius-md', '--vex-radius-lg', '--vex-font-base', '--vex-font-display', '--vex-font-heading',
    '--vex-font-mono', '--on-primary', '--b-font', '--b-btn-radius', '--b-ring-w', '--b-accent-ring',
    // The older names the calm panels (css/ai-panel.css) are written in.
    '--bg', '--bg-2', '--surface', '--border', '--text', '--text-muted', '--primary', '--primary-hover', '--danger', '--success', '--accent'],
  docThemePayload() {
    const cs = getComputedStyle(document.body);
    const vars = {};
    for (const name of this.DOC_THEME_VARS) { const v = cs.getPropertyValue(name).trim(); if (v) vars[name] = v; }
    const root = document.documentElement;
    return {
      vars, lang: root.lang || 'en',
      attrs: { 'data-theme': root.getAttribute('data-theme') || '', 'data-scheme': root.getAttribute('data-scheme') || '', 'data-gui-style': document.body.getAttribute('data-gui-style') || '', 'data-gui-family': document.body.getAttribute('data-gui-family') || '' },
    };
  },
  // Whether this webview shows Vex's own document viewer now.
  docPage(webview) {
    let url;
    try { url = webview.getURL(); } catch (err) { return false; }   // not attached yet
    return !!this.docOriginal(url);
  },
  sendDocTheme(webview) {
    try { webview.send('docview:theme', this.docThemePayload()); }
    catch (err) { if (!/dom-ready|attached/i.test(String(err && err.message))) console.warn('[Vex] the document viewer could not be given the theme:', err && err.message); }
  },
  sendDocThemeToAll() {
    for (const wv of this.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }
      if (this.docOriginal(url)) this.sendDocTheme(wv);
    }
  },

  // === Vex's own PDF viewer (main/pdf-viewer.js, pages in src/renderer/pdf-viewer) ===================
  //
  // A PDF is shown by a page of Vex's own at vex-pdf://view/?u=<the PDF's address>[#page=3]. The tab, its address bar, its
  // history, its bookmarks and its reload keep the PDF's own address: this maps the viewer's address back, and the
  // twin in main/pdf-viewer.js (parseViewerUrl) does the same on the other side (a test holds them equal).
  // A .pdf file: address is sent to the viewer here, before anything loads. (Main cannot take such a navigation over once it has
  // started: Chromium's own PDF viewer starting and then being cancelled froze Vex's main process, measured 2026-10-25. A PDF from the
  // web is answered with a redirect instead, in main/pdf-viewer.js.) VexPdfViewerOff is set by js/pdf-viewer-host.js when it is switched off.
  pdfAddress(url) {
    const s = String(url || '');
    if ((typeof window !== 'undefined' && window.VexPdfViewerOff) || !/^file:\/\/[^?#]*\.pdf(?:[?#]|$)/i.test(s)) return s;
    const at = s.indexOf('#');
    return 'vex-pdf://view/?u=' + encodeURIComponent(at < 0 ? s : s.slice(0, at)) + (at < 0 ? '' : s.slice(at));
  },

  // Where a tab is really sent when it is asked to load `url`: a file: address (or view-source:) one of Vex's own viewers shows goes to that
  // viewer's page, anything else is returned as it came. Every load site calls this; a new viewer adds one mapper to the list.
  viewerAddress(url) {
    const s = String(url || '');
    for (const map of [this.pdfAddress, this.docAddress, this.imageViewerAddress, this.mediaAddress]) {
      const to = map.call(this, s);
      if (to !== s) return to;
    }
    return s;
  },

  // The address a Vex viewer page (the PDF viewer, the folder browser, ...) stands for, else null: one place that asks each viewer's
  // mapper, so the address bar, history and bookmarks keep the original and a new viewer adds a single term here.
  viewerOriginal(url) {
    return this.pdfOriginal(url) || this.docOriginal(url) || this.imageOriginal(url) || this.mediaOriginal(url) || this.officeOriginal(url) || this.folderOriginal(url) || null;
  },

  pdfOriginal(url) {
    const s = String(url || '');
    if (!/^vex-pdf:\/\/view\/(?:\?|#|$)/i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    const original = u.searchParams.get('u');
    return original ? original + (u.hash ? u.hash : '') : null;
  },

  // The colours and type of the interface as the viewer needs them: the values this window resolves for the theme, the
  // browser look, the custom theme and the chosen font, so the viewer matches every one of them without carrying a copy.
  PDF_THEME_VARS: ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input',
    '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--vex-border-accent', '--vex-accent', '--vex-accent-dim', '--vex-accent-glow',
    '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-success', '--vex-danger', '--vex-danger-hover', '--vex-warning',
    '--vex-hover-fill', '--vex-shadow-color', '--vex-radius-sm', '--vex-radius-md', '--vex-radius-lg', '--vex-font-base', '--vex-font-display', '--vex-font-heading',
    '--vex-font-mono', '--on-primary', '--b-font', '--b-btn-radius', '--b-ring-w', '--b-accent-ring',
    // The older names the calm panels (css/ai-panel.css) are written in.
    '--bg', '--bg-2', '--surface', '--border', '--text', '--text-muted', '--primary', '--primary-hover', '--danger', '--success', '--accent'],
  pdfThemePayload() {
    const cs = getComputedStyle(document.body);
    const vars = {};
    for (const name of this.PDF_THEME_VARS) { const v = cs.getPropertyValue(name).trim(); if (v) vars[name] = v; }
    const root = document.documentElement;
    return {
      vars, lang: root.lang || 'en',
      attrs: { 'data-theme': root.getAttribute('data-theme') || '', 'data-scheme': root.getAttribute('data-scheme') || '', 'data-gui-style': document.body.getAttribute('data-gui-style') || '', 'data-gui-family': document.body.getAttribute('data-gui-family') || '' },
    };
  },
  // Whether this webview shows Vex's own PDF viewer now.
  pdfPage(webview) {
    let url;
    try { url = webview.getURL(); } catch (err) { return false; }   // not attached yet
    return !!this.pdfOriginal(url);
  },
  sendPdfTheme(webview) {
    try { webview.send('pdfview:theme', this.pdfThemePayload()); }
    catch (err) { if (!/dom-ready|attached/i.test(String(err && err.message))) console.warn('[Vex] the PDF viewer could not be given the theme:', err && err.message); }
  },
  sendPdfThemeToAll() {
    for (const wv of this.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }
      if (this.pdfOriginal(url)) this.sendPdfTheme(wv);
    }
  },

  createWebview(tab) {
    if (window.VexTabPolicy) tab.partition = window.VexTabPolicy.partitionFor(tab.partition);
    // A container's own route is asked for now, before anything reads the
    // page (VexTabPolicy.isRouted counts it routed until main answers).
    if (window.VexTabPolicy) window.VexTabPolicy.isRouted(tab.partition);
    const container = document.getElementById('webviews-container');
    const webview = document.createElement('webview');
    const lifecycle = window.VexLifecycle ? new window.VexLifecycle() : null;
    webview._lifecycle = lifecycle;
    // Register every listener below through the lifecycle so destroyWebview can
    // take them off again. Left attached, each handler closure captures
    // `webview`, and those closures keep the element alive for the life of the
    // window: closing a tab freed nothing, so a long session accumulated one
    // detached webview and ~28 listeners per closed tab.
    const onWebview = lifecycle
      ? (event, handler, options) => lifecycle.listen(webview, event, handler, options)
      : (event, handler, options) => webview.addEventListener(event, handler, options);
    let crashCount = 0, lastCrash = 0, cancelRecovery = null;
    webview._navigationGeneration = 0;
    onWebview('did-attach', () => { webview._attached = true; });
    onWebview('did-start-navigation', event => {
      if (event.isMainFrame === false) return;
      webview._navigationGeneration++;
      // A new page starts with no userscripts running; its own preload reports
      // the ones it starts (js/userscripts.js).
      if (!event.isInPlace && typeof VexUserscripts !== 'undefined') VexUserscripts.noteActive(tab.id, null);
      // A site that gets dark mode shows dark, not white, behind it until it paints (js/dark-mode.js).
      if (!event.isInPlace && typeof VexDarkMode !== 'undefined') VexDarkMode.onNavigate(webview, event.url);
    });
    webview.setAttribute('src', this.viewerAddress(tab.url));
    // The New Tab page paints a moment after its tab appears (its process starts first), and the empty webview was white for that moment, in
    // a dark theme a flash of a white screen (measured: 150 ms and more). Its own page colour is the theme's base colour, so it stands in.
    if (typeof isStartPage === 'function' && isStartPage(tab.url)) webview.style.background = 'var(--vex-bg-base)';
    webview.setAttribute('partition', tab.partition || 'persist:main');
    webview.setAttribute('allowpopups', '');
    // Chromium's PDF viewer is the only plugin Electron has, and it runs only
    // where plugins are on: without this a PDF opened as a blank page
    // (found by a feature sweep, 2026-09-28).
    webview.setAttribute('plugins', '');
    // A kept-awake ("never sleep") tab opts out of background throttling so its
    // page keeps running full-speed while it's not the foreground tab — Gmail
    // keeps receiving mail in the background, so the email-code autofill reads a
    // current inbox instead of a frozen one.
    const keptAwake = !!(tab && tab.keepAwakeUntil && Date.now() < tab.keepAwakeUntil);
    // A site whose JavaScript is switched off (js/site-rules-ui.js): the tab
    // is built without it, because a page cannot be un-run once it has run.
    const noScripts = !!(window.SiteRulesUI && window.SiteRulesUI.scriptsOff(tab.url));
    webview._noScripts = noScripts;
    // A tab built again on leaving such a site names the guest it replaces,
    // and main gives the new one that guest's back list (session-security.js).
    const historyFrom = tab._historyFrom;
    delete tab._historyFrom;
    // Any other tab built again (woken, reopened, restored at start) hands
    // main the back list kept with it, and the new page starts with it
    // (session-security.js, carryHistory); it went with the old page before.
    let carried = null;
    if (!Number.isInteger(historyFrom) && tab.history && typeof window.vex?.carryTabHistory === 'function') {
      carried = 'c' + (++this._historySeq);
      window.vex.carryTabHistory(carried, tab.partition || 'persist:main', tab.history);
    }
    webview.setAttribute('webpreferences', 'contextIsolation=yes'
      + (keptAwake ? ',backgroundThrottling=no' : '')
      + (noScripts ? ',javascript=no' : '')
      + (Number.isInteger(historyFrom) ? ',vexHistoryFrom=' + historyFrom : '')
      + (carried ? ',vexHistoryFrom=' + carried : ''));
    webview.dataset.tabId = tab.id;
    // Browsing on to such a site from here is held to it by main, on the
    // page's own response (script-src 'none'). The other way round cannot be:
    // a tab built without JavaScript keeps it off for every site after, so
    // leaving for a site that has it is done in a tab built again for that
    // site, which keeps the back list (it lost it until 2026-09-30).
    if (noScripts) {
      const leave = (event) => {
        if (event.isMainFrame === false || event.isInPlace || !/^https?:/i.test(event.url || '')) return;
        if (window.SiteRulesUI.scriptsOff(event.url)) return;
        try { webview.stop(); } catch { /* going anyway */ }
        tab.url = event.url;
        tab._historyFrom = webview.getWebContentsId();
        TabManager.rebuildTab(tab.id);
      };
      onWebview('did-start-navigation', leave);
      onWebview('did-redirect-navigation', leave);
    }

    // Events
    // A load whose "stopped" event never came left the spinner over the page and the toolbar on Stop for good (seen on a page that kept a
    // request open after it had drawn): the page asks again whether it is still loading, and if it says no the state is cleared.
    let loadWatch = null;
    const clearLoading = () => {
      clearTimeout(loadWatch);
      loadWatch = null;
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');
    };
    onWebview('did-start-loading', () => {
      TabManager.updateTab(tab.id, { loading: true });
      container.classList.add('wv-loading');
      clearTimeout(loadWatch);
      const ask = (round) => {
        loadWatch = null;
        let still = true;
        try { still = typeof webview.isLoading === 'function' ? webview.isLoading() : true; } catch { still = false; }   // a guest that is gone is not loading
        if (!still) { clearLoading(); return; }
        if (round < 40) loadWatch = setTimeout(() => ask(round + 1), 5000);   // up to about 3 minutes; a page that really is loading keeps its spinner
      };
      loadWatch = setTimeout(() => ask(0), 8000);
    });

    // Whether the page in front is an error page, for the padlock
    // (js/site-panel.js): a new page clears it, a failed one sets it.
    onWebview('did-start-navigation', (e) => {
      if (e.isMainFrame === false || e.isSameDocument || e.isInPlace) return;
      tab._loadFailed = null;
      // Vex's own "did not load" page goes when the next page starts (js/load-failure.js);
      // Chromium's error page committing is the failure itself, not a next page.
      if (typeof VexLoadFailure !== 'undefined' && !/^chrome-error:/i.test(e.url || '')) VexLoadFailure.clear(tab.id);
    });
    onWebview('did-fail-load', (e) => {
      if (e.isMainFrame === false || e.errorCode === -3) return;
      tab._loadFailed = { code: e.errorCode, url: e.validatedURL };
      // Told to whoever offers something to do on a page that did not load
      // (js/vex-mini-games.js); nothing is required to be listening.
      document.dispatchEvent(new CustomEvent('vex:page-load-failed', { detail: { tabId: tab.id, code: e.errorCode, url: e.validatedURL } }));
      if (typeof SitePanel !== 'undefined' && TabManager.activeTabId === tab.id) SitePanel.refreshIcon();
      // Vex's own page for it, with Try again and the other ways (js/load-failure.js).
      if (typeof VexLoadFailure !== 'undefined') VexLoadFailure.note(tab.id, e);
      // A page you archived that will not load: offer your copy (and Wayback).
      if (typeof ArchiveLibrary !== 'undefined' && TabManager.activeTabId === tab.id) ArchiveLibrary.offerForDeadPage(e.validatedURL, { isMainFrame: true, errorCode: e.errorCode });
    });

    onWebview('did-stop-loading', () => { clearLoading(); });

    // The slim load bar goes most of the way once the page's DOM is ready (js/page-chrome.js).
    onWebview('dom-ready', () => { if (typeof VexLoadBar !== 'undefined') VexLoadBar.milestone(tab.id); });

    // The address of the link under the pointer, in the bar at the bottom-left of the page area (js/page-chrome.js). Only the tab in front
    // has a pointer over it; a new page starts with no link under it.
    onWebview('update-target-url', (e) => {
      if (typeof VexLinkBar === 'undefined' || tab.id !== TabManager.activeTabId) return;
      let page = '';
      try { page = webview.getURL(); } catch { /* vex-allow-empty-catch: not attached yet, so there is no page address to compare with */ }
      VexLinkBar.update(e.url, tab.id, page);
    });
    onWebview('did-start-navigation', (e) => {
      if (e.isMainFrame !== false && !e.isInPlace && typeof VexLinkBar !== 'undefined' && tab.id === TabManager.activeTabId) VexLinkBar.hide();
    });

    onWebview('did-finish-load', () => {
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');
      // The player needs none of what follows (a page's colour base, zoom per site, dark mode, notification shims).
      if (this.mediaPage(webview)) return;
      // The document viewer needs none of what follows (a page's colour base, zoom per site, dark mode, notification shims).
      if (this.docPage(webview)) return;
      // The viewer needs none of what follows (a page's colour base, zoom per site, dark mode, notification shims).
      if (this.pdfPage(webview)) return;

      // Leak Canary: warn if a saved email of yours is pre-filled on a site that
      // isn't where you saved it (a tracker leak). Best-effort, throttled inside.
      try { window.LeakCanary && window.LeakCanary.check(webview, webview.getURL && webview.getURL()); } catch {}

      // === "Notifications are blocked" ====================================
      //
      // Electron's permission CHECK handler is a boolean: allowed or not. It
      // has no way to say "nobody has asked yet", so every site that had not
      // been granted notifications read as DENIED — `Notification.permission`
      // returned 'denied' and navigator.permissions agreed.
      //
      // Most sites check that before asking. Finding 'denied' they never ask
      // at all; they just say "Notifications are blocked. Allow them in your
      // browser or system settings, then try again." So Vex's prompt was
      // never reached, and there was no setting anywhere that would have
      // helped — the advice in that sentence was impossible to follow.
      //
      // A site the user really blocked keeps reading 'denied': requesting is
      // refused from the saved decision, so nothing is lost by letting it ask.
      // Async: a page with JavaScript switched off rejects it, which went
      // uncaught into Problems on every load (found 2026-09-29).
      this._letSitesAsk(webview).catch(err => console.warn('[Vex] notification state:', err && err.message));

      // === A base for a page that paints none ==============================
      //
      // Chromium's own viewers paint no background: open a JSON API and the
      // viewer leaves the page transparent and colours its text for the
      // scheme the browser reports — white, in dark mode. With nothing
      // behind it that is white text on Vex's own light surface: the body is
      // there, perfectly selectable, and completely invisible. The same URL
      // in Chrome reads fine. It hits every page that paints nothing — a
      // JSON response, a plain .txt, a directory listing.
      //
      // Only such a page is given anything. A background on <html> stops the
      // body's background propagating to the canvas, so a site that styles
      // only its body would get our colour showing through its margins —
      // which is why this is decided per page rather than applied to all of
      // them, and why `:where()` (zero specificity) is used even then.
      //
      // A page with JavaScript switched off refuses the question, and said so
      // in the console on every load (found 2026-09-30).
      if (!this.scriptsOffIn(webview)) try {
        webview.executeJavaScript(`(() => {
          const solid = (c) => {
            const flat = String(c || '').split(' ').join('');
            return (flat && flat !== 'transparent' && flat !== 'rgba(0,0,0,0)') ? c : '';
          };
          // A page that has not built a body yet is exactly the kind this is
          // for: asking for its background threw, the whole thing was
          // swallowed by a silent catch, and nothing was painted.
          const el = document.body || document.documentElement;
          return {
            body: el ? solid(getComputedStyle(el).backgroundColor) : '',
            html: document.documentElement ? solid(getComputedStyle(document.documentElement).backgroundColor) : '',
            dark: matchMedia('(prefers-color-scheme: dark)').matches,
            // What the page's text is drawn in, and what scheme it declared.
            // A page that never opted into dark keeps black text in dark
            // mode, and must keep the white canvas Chrome gives it.
            ink: el ? getComputedStyle(el).color : '',
            scheme: [
              document.documentElement ? getComputedStyle(document.documentElement).colorScheme : '',
              (document.querySelector('meta[name="color-scheme"]') || {}).content || '',
            ].join(' '),
          };
        })()`)
          .then(seen => {
            const want = this.baseColourFor(seen);
            if (!want) return;
            // The element behind the page, so there is no flash of the wrong
            // colour while it loads.
            webview.style.background = want.element;
            if (!want.inject) return;
            webview.insertCSS(want.inject)
              .catch(err => console.warn('[Vex] could not give the page a base colour:', err && err.message));
          })
          .catch(err => console.warn('[Vex] could not read the page background:', err && err.message));
      } catch (err) { console.warn('[Vex] page background check failed:', err && err.message); }

      // Slim scrollbars on websites, when switched on (Settings > Appearance; js/page-chrome.js).
      if (typeof VexPageScrollbars !== 'undefined') {
        VexPageScrollbars.apply(webview)
          .catch(err => console.warn('[Vex] could not give the page slim scrollbars:', err && err.message));
      }

      // Apply saved zoom for this domain
      try {
        const url = webview.getURL();
        if (url && !url.startsWith('about:') && !url.startsWith('file:')) {
          const host = new URL(url).hostname;
          const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}');
          if (zooms[host]) { webview.setZoomFactor(zooms[host]); document.dispatchEvent(new CustomEvent('vex:zoom-changed')); }
          else {
            // No zoom of its own: the default one (Settings › Tabs and navigation).
            const dflt = typeof VexTabsNav !== 'undefined' ? VexTabsNav.defaultZoomFactor() : 1;
            if (dflt !== 1) { webview.setZoomFactor(dflt); document.dispatchEvent(new CustomEvent('vex:zoom-changed')); }
          }
        }
      } catch {}

      // Force dark mode — now per-site (the legacy 'vex.forceDarkSites'=true flag
      // still forces it everywhere for backward compat). Toggle per site from the
      // page right-click menu; the choice persists in 'vex.forceDarkHosts'.
      try {
        if (this._shouldForceDark(webview.getURL && webview.getURL())) this._applyForceDark(webview);
      } catch {}

      // Phase 12: Queue most-recent history entry for AI indexing
      // (wait 2s so dynamic content settles; the top entry in HistoryPanel.entries
      // is the most recent and typically corresponds to the page that just loaded)
      setTimeout(() => {
        try {
          if (!window.HistoryIndexer || !window.HistoryPanel) return;
          const url = webview.getURL && webview.getURL();
          if (!url) return;
          const entry = HistoryPanel.entries.find(e => e.url === url && !e.indexed);
          if (entry) HistoryIndexer.queueForIndexing(entry, webview);
        } catch (e) { /* best-effort */ }
      }, 2000);

      // Full-text recall: index the page's readable text locally so it can be
      // found later by content (waits for dynamic content to settle).
      setTimeout(() => {
        try {
          if (typeof Recall === 'undefined') return;
          const url = webview.getURL && webview.getURL();
          const t = TabManager.tabs.find(x => x.id === tab.id);
          if (!url) return;
          const title = t && t.title;
          // On battery the read waits for the mains (js/battery-mode.js); it
          // is skipped then if the tab has moved on, like any other late read.
          if (typeof BatteryMode !== 'undefined' && BatteryMode.defer('recall:' + tab.id, () => Recall.indexPage(webview, url, title))) return;
          Recall.indexPage(webview, url, title);
        } catch (e) { /* best-effort */ }
      }, 2500);
    });

    onWebview('page-title-updated', (e) => {
      TabManager.updateTab(tab.id, { title: e.title });
      // The visit is recorded the moment the page starts loading, when its
      // title is still "Loading…" or the bare URL. Without this every history
      // entry keeps that placeholder.
      // Never from a private or Tor tab (an in-memory session), whose visit is
      // not recorded either: its title renamed the normal entry for the same
      // address, and history syncs (found 2026-10-09).
      const current = TabManager.tabs.find(x => x.id === tab.id);
      const ephemeral = !!(tab.partition && !tab.partition.startsWith('persist:'));
      if (current && current.url && !ephemeral && typeof HistoryPanel !== 'undefined') HistoryPanel.updateTitle(current.url, e.title);
    });

    onWebview('dom-ready', () => {
      // Vex's own player is not a site: no site's boosts, autofill, highlights or page tools go into it; it is given the theme (by
      // js/media-viewer-host.js). The site's speakers and speed, and the accessibility pack, still apply, as does the volume (below).
      if (this.mediaPage(webview)) {
        const t = TabManager.tabs.find(x => x.id === tab.id);
        try {
          if (typeof AudioOutput !== 'undefined' && t && t.url) AudioOutput.apply(webview, t.url);
          if (typeof PageTools !== 'undefined' && t && t.url) PageTools.applySpeed(webview, t.url);
          if (typeof AccessibilityPack !== 'undefined') AccessibilityPack.applyTo(webview);
        } catch (err) { window.VexProblems?.note('Player', 'Could not set up the player page', err); }
        return;
      }
      // Vex's own document viewer is not a site: no site's boosts, autofill, highlights or page tools go into it; it is given the theme.
      if (this.docPage(webview)) { this.sendDocTheme(webview); return; }
      // Vex's own PDF viewer is not a site: no site's boosts, autofill, highlights or page tools go into it; it is given the theme.
      if (this.pdfPage(webview)) { this.sendPdfTheme(webview); return; }
      if (typeof SecretGuard !== 'undefined' && SecretGuard.enabled()) SecretGuard.push(webview);
      // Site notifications held for the hourly bundle (js/push-bundle.js): tell this page which
      // hosts are listed. A page that is not listed, a private tab and a private window get nothing.
      if (typeof VexPushBundle !== 'undefined') {
        try { VexPushBundle.pushRules(webview); } catch (err) { window.VexProblems?.note('Notifications', 'Could not tell the page about the notification bundle', err); }
      }
      // Per-site Boosts (zapped elements / custom CSS / custom JS)
      try {
        const t = TabManager.tabs.find(x => x.id === tab.id);
        if (typeof VexBoosts !== 'undefined' && t && t.url) VexBoosts.applyTo(webview, t.url);
        if (typeof PasswordVault !== 'undefined' && t && t.url) PasswordVault.autofill(webview, t.url);
        if (typeof TotpAutofill !== 'undefined' && t && t.url) TotpAutofill.autofill(webview, t.url);
        if (typeof EmailCodeAutofill !== 'undefined' && t && t.url) EmailCodeAutofill.tryFill(webview, t.url);
        if (typeof ConsentBlock !== 'undefined') ConsentBlock.applyTo(webview);
        // Which speakers this site plays through (js/audio-output.js).
        if (typeof AudioOutput !== 'undefined' && t && t.url) AudioOutput.apply(webview, t.url);
        // …and how fast its videos play (js/page-tools.js).
        if (typeof PageTools !== 'undefined' && t && t.url) PageTools.applySpeed(webview, t.url);
        // The page has settled: skim its words so Ctrl+K can find this tab by
        // what is ON it, not only by its title (js/tab-content-index.js).
        document.dispatchEvent(new CustomEvent('vex:tab-settled', { detail: { tabId: tab.id } }));
        // Copy & right-click unlock (only when the global toggle is on)
        if (typeof CopyUnlock !== 'undefined') CopyUnlock.applyTo(webview);
        // Reading & accessibility pack (dyslexia font / CVD filter / ruler)
        if (typeof AccessibilityPack !== 'undefined') AccessibilityPack.applyTo(webview);
        // Re-apply persistent highlights for this page
        if (typeof Annotations !== 'undefined' && t && t.url) Annotations.applyTo(webview, t.url);
        // Glossary hover cards for terms you confirmed (js/study-glossary.js).
        if (typeof VexStudyGlossary !== 'undefined' && t && t.url) VexStudyGlossary.applyTo(webview, t.url);
        // Discord as a tab in the Vex theme (js/discord-theme.js).
        if (window.DiscordTheme && t && t.partition === 'persist:discord') DiscordTheme.onPageReady(webview);
      } catch {}
    });

    // SPA route changes (History pushState) don't fire dom-ready — but a login
    // flow's "enter the code" screen often appears that way. Re-run the code
    // autofills on in-page navigation so they still trigger.
    onWebview('did-navigate-in-page', () => {
      try {
        const u = webview.getURL();
        if (typeof TotpAutofill !== 'undefined' && u) TotpAutofill.autofill(webview, u);
        if (typeof EmailCodeAutofill !== 'undefined' && u) EmailCodeAutofill.tryFill(webview, u);
      } catch {}
    });

    // Start page loads via file:// (bypassing main's HTML bake), so inject the
    // current GUI Style so the home page matches Classic/Glass.
    onWebview('dom-ready', () => {
      try {
        // Vex's own start page only: Today, the tabs from your devices and
        // the theme went to any file named renderer/start.html (audit SE6).
        if (_isTrustedStartPage(webview.getURL())) {
          const gs =(window.VexGuiStyle && VexGuiStyle.get()) || 'classic';
          webview.executeJavaScript(`document.documentElement.setAttribute('data-gui-style', ${JSON.stringify(gs)})`).catch(() => {});
          // The colour theme, in case it changed while this page was loading
          // (Light and dark switches by itself): a no-op when it already matches.
          if (typeof ThemeManager !== 'undefined' && !/^vex:/i.test(webview.getURL())) {
            webview.executeJavaScript(ThemeManager.startPageThemeJs(ThemeManager.getCurrentTheme()))
              .catch(err => console.error('[ThemeManager] New Tab theme at load failed:', err && err.message));
          }
          // The Today block on the new tab page (js/today.js): the start page
          // runs in its own session and cannot read this renderer's storage,
          // so the snapshot is handed to it here, the same way the theme is.
          try { if (window.VexToday) VexToday.push(webview); } catch (err) { console.error('[Today] push failed:', err); }
          // Tabs sent here from your other devices (js/handoff.js), the same way.
          try { if (window.Handoff) Handoff.push(webview); } catch (err) { console.error('[Handoff] push failed:', err); }
          // A browser look in its own colours hands the page its palette.
          window.VexGuiStyle?.paintStartPage(webview).catch(err => console.error('[gui-style] start page palette failed:', err));
          // And the font Vex is wearing (js/fonts.js), for the same reason.
          try { window.VexFonts?.paintStartPages(); } catch (err) { console.error('[fonts] start page failed:', err); }
          // And Settings › Appearance › Reduce motion (js/appearance-prefs.js).
          window.ReduceMotion?.paintStartPage(webview);
          // And the cursor and click effect (js/pointer-fx.js), which it draws itself.
          window.VexPointerFx?.paintStartPage(webview);
          // The search engine chosen now, a search engine of your own too
          // (js/search-engine-custom.js): the page's own copy can be stale.
          webview.executeJavaScript(VexTypedAddress.startPageEngineJs())
            .catch(err => console.error('[Search] New Tab search engine at load failed:', err && err.message));
        }
      } catch {}
    });

    // Keyboard link hints (press `f`): tell the guest whether the feature is on.
    // Default ON; toggle via the `vex.linkHints` setting. Injected each load so a
    // setting change applies on next navigation without restart.
    onWebview('dom-ready', () => {
      try {
        const on = localStorage.getItem('vex.linkHints') !== 'off';
        webview.executeJavaScript(`window.__vexLinkHintsEnabled = ${on};`).catch(() => {});
      } catch {}
    });

    // Media decode failures announced by preload-webview.js. Always logged
    // (with the page URL, so "video frozen on site X" reports are diagnosable
    // from the host console); the frozen-decode signature additionally gets
    // one toast per session — it's the actionable one (codec/GPU decode bug,
    // like TikTok's HEVC freeze) and a page can't spam it.
    onWebview('ipc-message', (e) => {
      if (e.channel === 'vex-ctx-image') { this.noteContextImage(webview, e.args && e.args[0]); return; }
      // The document viewer page is up and asks for the theme (preload-webview.js).
      if (e.channel === 'officeview:need-theme') { this.sendOfficeTheme(webview); return; }
      // The image viewer page is up and asks for the theme (preload-webview.js).
      if (e.channel === 'imageview:need-theme') { this.sendImageTheme(webview); return; }
      // The document viewer page is up and asks for the theme (preload-webview.js).
      if (e.channel === 'docview:need-theme') { this.sendDocTheme(webview); return; }
      // Vex's own folder browser page asking for the theme, or to open a file (js/folder-viewer-host.js).
      if (typeof VexFolderViewer !== 'undefined' && VexFolderViewer.handleMessage(webview, tab, e)) return;
      // The PDF viewer page is up and asks for the theme (preload-webview.js).
      if (e.channel === 'pdfview:need-theme') { this.sendPdfTheme(webview); return; }
      // A paste holding a secret, held back by the page-side hook (js/secret-guard.js).
      if (e.channel === 'vex-secret-paste') {
        if (typeof SecretGuard !== 'undefined' && SecretGuard.enabled()) SecretGuard.onPaste(webview, e.args && e.args[0]).catch(err => window.VexProblems?.note('Secret guard', 'A held paste could not be handled', err));
        return;
      }
      // The userscripts started on this page (userscripts-preload.js).
      if (e.channel === 'vex-userscripts') {
        if (typeof VexUserscripts !== 'undefined') VexUserscripts.noteActive(tab.id, (e.args && e.args[0]) || null);
        return;
      }
      // An Escape the page left alone (preload-webview.js) stops the page
      // while it loads, as in Chrome. It did nothing in a tab (found
      // 2026-10-10).
      if (e.channel === 'vex-escape') {
        const live = TabManager.tabs.find(t => t.id === tab.id);
        if (live && live.loading) this.stop(tab.id);
        return;
      }
      // PiP video-detection from the guest preload (sent via sendToHost because a
      // guest window.postMessage can't cross to the host). Re-emit as a host
      // window message so PiPManager (app.js) handles it unchanged. Gate on the
      // active tab so a background tab's video doesn't toggle the toolbar button.
      // PiP "Back to tab": the guest left native PiP. Switch Vex to the tab that
      // owns the video and bring the window forward, since Chromium's native
      // "back to tab" can't do that in a webview browser.
      if (e.channel === 'vex-pip-left') {
        try {
          const id = webview.dataset.tabId;
          if (id && typeof TabManager !== 'undefined' && TabManager.switchTab) TabManager.switchTab(id);
          try { window.vex && window.vex.focusWindow && window.vex.focusWindow(); } catch {}
        } catch {}
        return;
      }
      // A Discord or WhatsApp desktop notification from this tab was clicked
      // (preload-webview.js): Vex to the front, on this tab, as a panel does
      // (sidebar.js openFromNotification). With Discord set to open as a tab
      // the click used to do nothing at all.
      if (e.channel === 'vex-notification-click') {
        const id = webview.dataset.tabId;
        if (window.vex && typeof window.vex.focusWindow === 'function') {
          Promise.resolve(window.vex.focusWindow()).catch(err => window.VexProblems?.note('Tabs', 'Vex could not come to the front for a notification', err));
        }
        if (id && typeof TabManager !== 'undefined' && TabManager.activeTabId !== id) TabManager.switchTab(id);
        return;
      }
      // What a Discord or WhatsApp notification from this tab said, for the list
      // of Notifications from panels (js/panel-capture.js; a no-op unless opted in).
      if (e.channel === 'vex-notification-seen') {
        if (typeof PanelCapture !== 'undefined') PanelCapture.fromTab(webview, e.args && e.args[0]);
        return;
      }
      // A page wrote the clipboard with no click or key (preload-webview.js, the
      // paste-and-run tripwire). A no-op unless the person switched the tripwire on.
      if (e.channel === 'vex-clipboard-tripwire') {
        if (typeof VexClipboardTripwire !== 'undefined') VexClipboardTripwire.fromTab(webview, e.args && e.args[0]);
        return;
      }
      // A notification the page raised that Vex held for the hourly bundle (preload-webview.js).
      if (e.channel === 'vex-push-held') {
        if (typeof VexPushBundle !== 'undefined') VexPushBundle.fromTab(webview, e.args && e.args[0]);
        return;
      }
      // Microphone / camera in use (preload-webview.js getUserMedia wrapper).
      if (e.channel === 'vex-media-capture') {
        const d = (e.args && e.args[0]) || {};
        if (typeof TabManager !== 'undefined' && TabManager.setCapturing) TabManager.setCapturing(webview.dataset.tabId, d.kind, d.active);
        return;
      }
      // Where this page's video is and where the pointer is, for the
      // Picture-in-Picture button (preload-webview.js vexPipPlace).
      if (e.channel === 'vex-pip-geometry') {
        if (typeof PiPManager !== 'undefined') PiPManager.noteGeometry(webview, (e.args && e.args[0]) || null, null);
        return;
      }
      if (e.channel === 'vex-video-detected' || e.channel === 'vex-pip-fallback') {
        try {
          const payload = (e.args && e.args[0]) || null;
          if (e.channel === 'vex-pip-fallback') {
            // The payload here describes ONE video, so it travels whole rather
            // than being spread across the message.
            window.postMessage({ type: e.channel, media: payload }, '*');
            return;
          }
          if (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview && WebviewManager.getActiveWebview() !== webview) return;
          window.postMessage(Object.assign({ type: e.channel }, payload || {}), '*');
        } catch (err) { console.warn('[webview] could not relay ' + e.channel + ':', err && err.message); }
        return;
      }
      if (e.channel !== 'vex-media-error' && e.channel !== 'vex-media-frozen') return;
      const d = (e.args && e.args[0]) || {};
      console.warn(`[MediaHealth] ${e.channel} on ${webview.getURL()}`, d);
      if (e.channel === 'vex-media-frozen' && !window.__vexFrozenMediaToastShown) {
        window.__vexFrozenMediaToastShown = true;
        if (typeof window.showToast === 'function') {
          const frozen = 'A video on this page is frozen (decoder failure) — see console for details';
          if (typeof VexAttention !== 'undefined') VexAttention.toast({ feature: 'media-health', urgency: 'useful', id: 'frozen', title: frozen }, frozen, 'warning');
          else window.showToast(frozen, 'warning');
        }
      }
    });

    // Password capture (login-form submits announced by preload-webview.js)
    if (typeof PasswordVault !== 'undefined') PasswordVault.attach(webview);
    // Mouse gestures (right-drag strokes announced by preload-webview.js)
    if (typeof MouseGestures !== 'undefined') MouseGestures.attach(webview);
    // Alt+click on a link opens it in the other pane (js/split-keys.js), and link hints (js/link-hints.js)
    if (typeof VexSplitKeys !== 'undefined') VexSplitKeys.attach(webview);
    if (typeof VexLinkHints !== 'undefined') VexLinkHints.attach(webview);
    // Connect ahead to a link the pointer rests on (js/preconnect.js)
    if (typeof VexPreconnect !== 'undefined') VexPreconnect.attach(webview);
    // Floating Explain/Summarize/Translate bar on text selection
    if (typeof SelectionAIBar !== 'undefined') SelectionAIBar.attach(webview);
    // What you copied off this page (private and Tor tabs are refused inside)
    if (window.ClipboardHistory) window.ClipboardHistory.attach(webview);
    if (window.CitationTracker) window.CitationTracker.attach(webview);
    // The list under a field marked autocomplete="webauthn" (Vex passkeys)
    if (window.PasskeyUI) window.PasskeyUI.attach(webview);
    if (window.Dictionary) window.Dictionary.attach(webview);
    if (window.TeachMode) window.TeachMode.attach(webview);
    // Give this page the snippet list so Tab can expand an abbreviation in it
    if (window.Snippets) window.Snippets.attach(webview);
    // Note the price on product pages that publish one (private and Tor tabs are refused inside)
    if (window.PriceHistory) window.PriceHistory.attach(webview);
    // "You searched this on …": a results page you have searched before (private and Tor tabs are refused inside)
    if (window.VexSearchAgain) window.VexSearchAgain.attach(webview, tab.id);
    // Apply the saved master-volume level to this page's media (and keep it
    // enforced as media loads). Re-checked per navigation; no-op at 100%.
    onWebview('dom-ready', () => {
      if (typeof MasterVolume !== 'undefined' && MasterVolume.needsApply(webview)) MasterVolume.applyToWebview(webview);
    });
    // Text snippets (js/text-snippets.js): a fixed script, only into pages that may be read.
    onWebview('dom-ready', () => {
      if (typeof VexSnippets === 'undefined') return;
      let url = '';
      try { url = webview.getURL(); } catch (err) { return; }   // not attached: nothing to set up yet
      VexSnippets.applyTo(webview, url).catch(err => window.VexProblems?.note('Text snippets', 'Could not set up a page', err));
    });
    // Now Playing mini-bar (which tab is making noise)
    if (typeof NowPlaying !== 'undefined') NowPlaying.register(webview, tab);
    onWebview('did-navigate', (e) => {
      this._noteHistory(tab, webview);
      // A PDF shown in Vex's own viewer keeps the PDF's address (pdfOriginal above).
      // A document shown in one of Vex's own viewers keeps its own address (viewerOriginal below).
      const url = this.viewerOriginal(e.url) || e.url;
      // A 404, 410 or 5xx page you archived: offer your copy (js/archive-library.js).
      if (typeof ArchiveLibrary !== 'undefined' && e.httpResponseCode >= 400 && TabManager.activeTabId === tab.id) {
        ArchiveLibrary.offerForDeadPage(url, { isMainFrame: true, httpStatus: e.httpResponseCode });
      }
      // Arrived: the bar follows the page from here (navigate() above).
      const arriving = TabManager.tabs.find(t => t.id === tab.id);
      if (arriving) delete arriving._typedUrl;
      if (typeof VexBugBundle !== 'undefined') VexBugBundle.reset(tab.id);
      // A fresh page starts with a clean count.
      if (tab.consoleErrors) { tab.consoleErrors = 0; tab.lastConsoleError = ''; TabManager.renderTabUpdate(tab); }
      // An address pretending to be a familiar one (js/link-safety.js). Said
      // once per host per session: a warning that cries wolf is ignored.
      if (typeof LinkSafety !== 'undefined') {
        try {
          const warn = LinkSafety.lookalike(new URL(url).hostname);
          if (warn) LinkSafety.warnOnce(warn, webview);
        } catch { /* not an address that can be parsed */ }
      }
      // Focus-mode site blocker bounces distracting hosts back.
      if (typeof FocusMode !== 'undefined' && FocusMode.guard(webview, url)) return;
      // "What for?" before a site the person listed (js/intent-gate.js): soft, never blocks.
      if (typeof IntentGate !== 'undefined') { try { IntentGate.onNavigate(webview, url, tab); } catch (err) { window.VexProblems?.note('Intent gate', 'Could not check the page', err); } }
      // NEVER let a blank navigation erase the tab's real URL. Tab hibernation,
      // a renderer crash, or the OS suspending/killing the page on sleep can
      // navigate a webview to about:blank — if that overwrote tab.url there'd be
      // nothing to restore, and refresh would just reload about:blank (the exact
      // "tabs stuck on about:blank after wake, won't come back" bug). Keep the
      // last real URL in tab.url; reload()/render-process-gone recover from it.
      //
      // data: URLs get the same treatment. Reading mode loads the article as a
      // data:text/html snapshot; if that overwrote tab.url it'd be persisted and,
      // after a restart (when ReadingMode's in-memory original-URL map is gone),
      // the tab would be permanently stuck on the snapshot. It would also dump a
      // multi-KB data: URL into history. Reading mode is a transient view, not a
      // destination — leave tab.url on the real page and keep it out of history.
      // Vex's own error pages show the address they stand for (above).
      if (/^data:/i.test(url)) this._showVexPageAddress(tab, webview, url).catch(err => console.warn('[Vex] could not tell which address this page stands for:', err && err.message));
      if (/^about:blank\b/i.test(url) || /^data:/i.test(url)) return;
      // A view-source: tab reports the page's own address; kept as it was
      // opened, or the tab, its restore and its copies showed the page
      // instead of its source (found 2026-09-29).
      const shown = TabManager.tabs.find(t => t.id === tab.id);
      if (shown && /^view-source:/i.test(shown.url || '') && shown.url.slice(12) === url) return;
      TabManager.updateTab(tab.id, { url });
      window.dispatchEvent(new CustomEvent('vex:tab-url-changed', { detail: { tabId: tab.id, url } }));
      this._updateFavicon(tab.id, url);
      if (typeof VexBoosts !== 'undefined' && !this.viewerOriginal(e.url)) { try { VexBoosts.applyTo(webview, url); } catch {} }
      // A site rule's "always muted" and "never let it sleep" apply to where
      // the tab has ARRIVED, which a link followed inside an existing tab
      // makes different from where it was made (js/site-routes.js).
      if (typeof SiteRoutes !== 'undefined') {
        try { SiteRoutes.applyTo(tab); } catch (err) { console.warn('[Vex] site rule skipped:', err.message); }
      }

      // Add to history (the History panel's list, the only copy: the second
      // one in history.json is gone, main/history-fold.js) — but never for
      // Off-the-Record tabs (in-memory partition, no trace).
      // Only web pages: history takes http(s), and an extension's page or a
      // file:// one threw "Invalid payload for storage:history-add" on every
      // visit (found 2026-09-29).
      const t = TabManager.tabs.find(t => t.id === tab.id);
      // Without a title yet: the tab's is still the page it came from, and the
      // visit was saved under it (found 2026-10-10). page-title-updated names
      // it (HistoryPanel.updateTitle); a page seen before keeps its old name.
      const visit = this.historyVisit(url, null);
      if (visit && !isStartPage(url) && !(tab.partition && !tab.partition.startsWith('persist:'))) {
        if (typeof HistoryPanel !== 'undefined') {
          // A visit from a tab in its own session (a container, a Tor or proxy
          // route) is marked, so no history list asks its site for an icon
          // through Vex's direct window (found 2026-09-30).
          HistoryPanel.addEntry(visit.url, visit.title, t?.favicon, { ownSession: !TabManager.windowMayAsk(tab.partition) });
        }
        // Phase 16 auto-grouping: try to match against remembered patterns.
        // The call internally waits for the title to settle and uses purely
        // local pattern matching (domains + keywords) — no AI round-trip.
        if (typeof TabGrouper !== 'undefined') {
          TabGrouper.maybeAutoAssignToGroup?.(tab.id);
        }
      }
    });

    onWebview('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        this._noteHistory(tab, webview);
        const shown = this.viewerOriginal(e.url) || e.url;
        TabManager.updateTab(tab.id, { url: shown });
        window.dispatchEvent(new CustomEvent('vex:tab-url-changed', { detail: { tabId: tab.id, url: shown } }));
        document.dispatchEvent(new CustomEvent('vex:tab-navigated', { detail: { tabId: tab.id, url: shown } }));
      }
    });
    // A full load, once the page is there to be talked to (js/sponsor-skip.js).
    onWebview('did-finish-load', () => {
      try { document.dispatchEvent(new CustomEvent('vex:tab-navigated', { detail: { tabId: tab.id, url: webview.getURL(), failed: !!tab._loadFailed } })); }
      catch (err) { window.VexProblems?.note('Tabs', 'Could not announce a page load', err); }
    });

    // OS sleep/resume (or a plain crash) can kill a webview's renderer process,
    // leaving it blank. Self-heal: reload the tab's real URL so the page comes
    // back on its own — no manual refresh needed. tab.url is preserved above;
    // hibernated tabs also stash the URL in dataset.hibernatedUrl.
    onWebview('render-process-gone', () => {
      try {
        cancelRecovery?.();
        if (Date.now() - lastCrash > 120000) crashCount = 0;
        lastCrash = Date.now();
        if (++crashCount > 4) { window.showToast?.('This tab keeps crashing. Reload it manually to retry.'); return; }
        // The first crash was put right without a word (found 2026-09-29).
        if (crashCount === 1) window.showToast?.('This tab stopped working — Vex is reloading it', 'warn');
        const t = TabManager.tabs.find(t => t.id === tab.id);
        const real = webview.dataset.hibernatedUrl || (t && t.url);
        // Where the person was on the page that was killed: the last sample of
        // crash-proof tabs (js/tab-snapshots.js), else where a sleep left it.
        // Put back once, only on the same address and only if the reloaded page
        // is still at the top, so nothing the person already did is undone.
        const was = (t && t._lastScroll && t._lastScroll.y > 0 ? t._lastScroll : null) || (t && t.scrollPosition && t.scrollPosition.y > 0 ? { x: t.scrollPosition.x, y: t.scrollPosition.y, url: null } : null);
        if (real && !/^about:blank\b/i.test(real)) {
          const recover = () => {
            if (this.webviews.get(tab.id) !== webview || !webview.isConnected) return;
            delete webview.dataset.hibernated;
            if (was && (!was.url || (typeof TabSnapshots !== 'undefined' && TabSnapshots.key(real) === was.url))) {
              webview.addEventListener('did-finish-load', () => {
                try {
                  webview.executeJavaScript(`(function(){ if ((window.scrollY||0) < 20) { window.scrollTo(${Number(was.x) || 0}, ${Number(was.y) || 0}); return true; } return false; })()`)
                    .catch(err => window.VexProblems?.note('Tabs', 'Could not put a reloaded tab back where it was', err));
                } catch (err) { window.VexProblems?.note('Tabs', 'Could not put a reloaded tab back where it was', err); }
              }, { once: true });
            }
            try { Promise.resolve(webview.loadURL(this.viewerAddress(real))).catch(() => {}); } catch { webview.src = this.viewerAddress(real); }
          };
          if (lifecycle) cancelRecovery = lifecycle.timeout(recover, 400 * 2 ** (crashCount - 1));
          else { const timer = setTimeout(recover, 400 * 2 ** (crashCount - 1)); cancelRecovery = () => clearTimeout(timer); }
        }
      } catch {}
    });

    onWebview('new-window', (e) => {
      e.preventDefault();
      // A link to a site that has a panel opens in the panel (js/link-routing.js; off until turned on).
      if (typeof LinkRouting !== 'undefined' && LinkRouting.intercept(e.url, tab, { disposition: e.disposition })) return;
      TabManager.createTab(e.url, true, null, { partition: tab.partition });
    });

    // Audio indicator
    onWebview('media-started-playing', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = true; TabManager.renderTabUpdate(t); }
    });
    onWebview('media-paused', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = false; TabManager.renderTabUpdate(t); }
    });

    onWebview('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        this._setFavicon(tab.id, e.favicons[0]);
      }
    });

    // Listen for VEX_CMD messages from start page and other webview content
    onWebview('console-message', (e) => {
      // Errors on a page you are building (localhost, 127.0.0.1, *.local, a
      // file://) get a count on the tab — the console is not open while you
      // are looking at the page, so a thrown error was invisible until you
      // went looking. Only yours: a badge on every site would be noise.
      if (typeof VexBugBundle !== 'undefined') VexBugBundle.note(tab.id, e, webview);
      if (e.level >= 3 && TabManager.isLocalPage?.(tab.url)) {
        tab.consoleErrors = (tab.consoleErrors || 0) + 1;
        tab.lastConsoleError = String(e.message || '').slice(0, 300);
        TabManager.renderTabUpdate(tab);
      }
      if (e.message && e.message.startsWith('VEX_CMD:')) {
        // SECURITY: VEX_CMD is a privileged control channel (navigate the tab,
        // open chrome panels). console-message fires for EVERY guest page, so
        // without this gate any website could emit a `console.log("VEX_CMD:…")`
        // to force navigation (including file://) or open sidebar panels.
        // Only honour it from the trusted Vex start page.
        let emitterUrl = '';
        try { emitterUrl = webview.getURL(); } catch {}
        // Reading mode's own page (a data: page) may ask for three things only,
        // on a tab that is in it: to leave reading mode, to keep its text
        // settings, and to read itself aloud (ReadingMode.onReaderCommand).
        // Its "Exit Reading Mode" button did nothing (found 2026-09-29).
        if (/^data:text\/html/i.test(emitterUrl) && typeof ReadingMode !== 'undefined' && (ReadingMode._originalUrls.has(tab.id) || ReadingMode.sourceOf(emitterUrl))) {
          let asked = null;
          try { asked = JSON.parse(e.message.slice(8)); } catch (err) { console.error('VEX_CMD parse error:', err); return; }
          ReadingMode.onReaderCommand(tab.id, asked);
          return;
        }
        if (!_isTrustedStartPage(emitterUrl)) return;
        try {
          const cmd = JSON.parse(e.message.slice(8));
          if (cmd.type === 'pet-action') {
            if (cmd.action === 'refresh' && typeof VexToday !== 'undefined') VexToday.refresh().catch(err => console.error('[Pet] refresh failed:', err));
            else if (typeof VexPet !== 'undefined') VexPet.interact(cmd.action, cmd.prefs);
          } else if (cmd.type === 'navigate' && cmd.url) {
            // Navigate THIS webview (the start-page tab that emitted the command)
            // rather than spawning a new tab. Matches Chrome's new-tab page where
            // search submissions and shortcut clicks replace the current tab's
            // content. Callers can opt in to a new tab with { newTab: true }.
            if (cmd.newTab) {
              TabManager.createTab(cmd.url, true);
            } else {
              // A shortcut saved as "example.com" failed with an uncaught
              // ERR_INVALID_URL and the tile did nothing (found 2026-09-29).
              try {
                Promise.resolve(webview.loadURL(cmd.url)).catch(err => {
                  const m = String((err && err.message) || err);
                  if (!/ERR_ABORTED|\(-3\)/.test(m)) window.showToast?.('Could not open ' + cmd.url + ': ' + m, 'error');
                });
              } catch { webview.src = cmd.url; }
            }
          } else if (cmd.type === 'typed' && typeof cmd.query === 'string') {
            // What was typed in the New Tab box goes where the address bar
            // sends it: its own keyword and engine rules differed (found
            // 2026-10-10). Only from the tab in front, which is this one.
            if (TabManager.activeTabId !== tab.id) return;
            if (typeof window.VexSubmitTyped !== 'function') throw new Error('The address bar is not ready');
            window.VexSubmitTyped(cmd.query.slice(0, 4096), !!cmd.newTab);
          } else if (cmd.type === 'open-panel' && cmd.panel) {
            SidebarManager.openPanel(cmd.panel);
          } else if (cmd.type === 'open-theme-picker') {
            if (typeof ThemePicker !== 'undefined') ThemePicker.open();
          } else if (cmd.type === 'set-engine' && typeof cmd.id === 'string') {
            // The New Tab page's engine menu changed only its own storage, and
            // the address bar kept the old engine (found 2026-09-29).
            if (typeof VexTypedAddress !== 'undefined' && VexTypedAddress.engineOf(cmd.id) === cmd.id && typeof Onboarding !== 'undefined') Onboarding._setStart('vex.searchEngine', cmd.id);
          } else if (cmd.type === 'exit-reading') {
            if (typeof ReadingMode !== 'undefined') ReadingMode.exitReadingMode(tab.id);
          } else if (cmd.type === 'start-tiles') {
            this.saveStartTiles(cmd, webview);
          } else if (cmd.type === 'handoff-open' || cmd.type === 'handoff-dismiss') {
            // A card for a tab sent from another device (js/handoff.js).
            if (typeof Handoff !== 'undefined') Handoff.onStartCommand(cmd, webview);
          } else if (typeof cmd.type === 'string' && typeof VexBrief !== 'undefined' && VexBrief.isStartCommand(cmd.type)) {
            // A button in the Morning Brief on the New Tab page (js/brief.js
            // accepts only what its last snapshot offered). Its sections also draw "autopilot-open" and
            // "command" buttons, which this branch used to drop without a word.
            if (typeof VexBrief !== 'undefined') VexBrief.onStartCommand(cmd, webview);
          }
        } catch (err) {
          console.error('VEX_CMD parse error:', err);
        }
      }
    });

    // Context menu — the Electron 'context-menu' event delivers params.x/y
    // already in host-viewport CSS pixels in the current Electron version
    // (empirically verified: a host-document mousedown listener on the same
    // right-click reported clientX/clientY identical to params.x/y). So
    // showContextMenu consumes params.x/y directly — no coordinate
    // translation, no webviewRect offset.
    onWebview('context-menu', (e) => {
      this.showContextMenu(e, webview);
    });

    webview._lastActive = Date.now();
    container.appendChild(webview);
    this.webviews.set(tab.id, webview);
    this._ensureHibernateSweep();
  },

  showWebview(tabId) {
    this.webviews.forEach((wv, id) => {
      const active = id === tabId;
      wv.classList.toggle('active', active);
      if (active) {
        wv._lastActive = Date.now(); this._wake(wv);
        // Refresh the PiP toolbar button for the newly-active page. The guest
        // only auto-emits video state on a count change (not on tab switch), so
        // hide the button now and ask this guest to re-report.
        try { const b = document.getElementById('pip-btn'); if (b) b.style.display = 'none'; } catch {}
        try { if (typeof PiPManager !== 'undefined') PiPManager._showButton(); } catch (err) { console.warn('[webview] PiP button refresh failed:', err && err.message); }
        try { if (typeof wv.send === 'function') wv.send('vex-rescan-video'); } catch {}
      }
    });
    this._ensureHibernateSweep();
  },

  // === Tab hibernation (removed) ===
  // There used to be a sweep here that blanked every background tab not shown
  // for 30 minutes (vex.tabHibernateMinutes) to about:blank — with no setting,
  // and without asking js/sleep-consent.js, so tabs went blank under "never
  // do it". Idle tabs now have ONE timer, Settings › Performance › Auto-sleep
  // (TabManager.startAutoSleep), which goes through SleepConsent.gate. What
  // stays: waking a tab that was blanked (_wake), and the system-resume
  // recovery below, which reloads what the OS blanked while the PC slept.
  _ensureHibernateSweep() {
    this._startResumeWatch();
  },
  // System sleep/resume recovery (pure renderer — no IPC). A suspended machine
  // "skips" real time between our ticks; a big skip means the PC was asleep, so
  // on wake we reload any webview the OS blanked while suspended, from its real
  // URL. That's what makes tabs come back on their own after you wake the PC,
  // instead of sitting on about:blank.
  _startResumeWatch() {
    if (this._resumeTimer) return;
    let last = Date.now();
    const PERIOD = 30000;
    this._resumeTimer = setInterval(() => {
      const now = Date.now(), gap = now - last; last = now;
      if (gap > PERIOD + 90000) this._recoverBlankWebviews(); // >~2 min real-time skip ⇒ was asleep
    }, PERIOD);
  },
  _recoverBlankWebviews() {
    this.webviews.forEach((wv, id) => {
      try {
        if (wv.dataset && wv.dataset.hibernated === '1') return; // intentionally hibernated; wakes on focus
        let cur; try { cur = wv.getURL(); } catch { cur = ''; }
        if (cur && !/^about:blank\b/i.test(cur)) return; // still has real content
        const tab = TabManager.tabs.find(t => t.id === id);
        const real = (wv.dataset && wv.dataset.hibernatedUrl) || (tab && tab.url);
        if (real && !/^about:blank\b/i.test(real)) { try { delete wv.dataset.hibernated; this._loadUnwatched(wv, real, 'waking a blanked tab'); } catch { try { wv.src = real; } catch {} } }
      } catch {}
    });
  },
  _wake(wv) {
    try {
      if (wv.dataset.hibernated !== '1') return;
      const url = wv.dataset.hibernatedUrl;
      delete wv.dataset.hibernated;
      if (url) { try { this._loadUnwatched(wv, url, 'waking a sleeping tab'); } catch { wv.src = url; } }
    } catch {}
  },

  // === Per-site dark mode ===
  // The work is done by src/dark-mode-preload.js (the smart engine, or the old
  // invert filter as "Simple invert") before the page's first paint, on the
  // decision main takes from the saved settings. The rules and the Settings rows
  // are js/dark-mode.js (a late module). What stays here are the entry points
  // the page menu, the site panel and the site reset already call.
  _forceDarkHosts() {
    try { return new Set(JSON.parse(localStorage.getItem('vex.forceDarkHosts') || '[]')); } catch { return new Set(); }
  },
  _hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _shouldForceDark(url) {
    try {
      if (typeof VexDarkMode !== 'undefined') return VexDarkMode.isOnFor(url);
      if (localStorage.getItem('vex.forceDarkSites') === 'true') return true; // legacy global
      const host = this._hostOf(url);
      return !!host && this._forceDarkHosts().has(host);
    } catch { return false; }
  },
  // Tell the page what its decision is now; the saved lists and settings decide.
  _applyForceDark(wv) {
    if (typeof VexDarkMode === 'undefined') return;
    VexDarkMode.pushTo(wv).catch(err => console.error('[Webview] dark mode:', err && err.message));
  },
  _removeForceDark(wv) { this._applyForceDark(wv); },
  toggleForceDarkForSite(webview) {
    if (typeof VexDarkMode === 'undefined') { window.showToast?.('Dark mode is still starting — try again in a moment'); return; }
    try { VexDarkMode.toggleSite(webview); }
    catch (err) { console.error('[Webview] dark mode toggle:', err); window.showToast?.('Could not change dark mode: ' + err.message, 'error'); }
  },
  // A tab's page: the site panel's own Reset (js/site-panel.js) — every
  // setting of the site at once, with Undo. An app panel's page (no tab):
  // its zoom and dark mode, as before.
  resetSite(webview) {
    const tab = webview.dataset && webview.dataset.tabId != null
      ? (TabManager.tabs || []).find(t => String(t.id) === String(webview.dataset.tabId)) : null;
    if (tab && typeof SitePanel !== 'undefined') {
      SitePanel.resetSite(tab).catch(err => {
        console.error('[Webview] reset site:', err);
        window.showToast?.('Could not reset this site: ' + SitePanel._said(err), 'error');
      });
      return;
    }
    try {
      const host = this._hostOf(webview.getURL());
      if (!host) return;
      const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}'); delete zooms[host];
      localStorage.setItem('vex.zooms', JSON.stringify(zooms));
      try { webview.setZoomFactor(1); } catch {}
      const hosts = this._forceDarkHosts(); hosts.delete(host);
      localStorage.setItem('vex.forceDarkHosts', JSON.stringify([...hosts]));
      this._removeForceDark(webview);
      window.showToast?.(`Reset site settings — ${host}`);
    } catch {}
  },

  destroyWebview(tabId) {
    const wv = this.webviews.get(tabId);
    if (wv) {
      wv.dispatchEvent(new Event('vex-disposed'));
      wv._lifecycle?.dispose();
      wv.remove();
      this.webviews.delete(tabId);
    }
  },

  // Print and View Page Source: Vex had neither — no command, no menu row,
  // and Ctrl+P / Ctrl+U did nothing (found 2026-09-29).
  // Vex draws a print preview of its own (js/print-preview-ui.js, a late module); the plain Windows dialog is what
  // the switch in Settings > Print preview falls back to, and what the preview's own "Windows print dialog…" uses.
  printPage(wv = this.getActiveWebview()) {
    // A PDF shown in Vex's own viewer prints the document's pages with its marks (the viewer's own print), never the viewer's page with its toolbar.
    if (wv && this.pdfPage(wv)) { wv.send('pdfview:command', 'print'); return; }
    if (typeof VexPrintPreview === 'undefined' && typeof VexBoot !== 'undefined' && !VexBoot.marks.settled) {
      // The preview is still loading (right after start-up): wait for it, then try again.
      VexBoot.whenSettled().then(() => this.printPage(wv));
      return;
    }
    if (typeof VexPrintPreview !== 'undefined' && VexPrintPreview.enabled()) {
      VexPrintPreview.open(wv).catch(err => window.showToast?.('Could not print: ' + ((err && err.message) || err), 'error'));
      return;
    }
    this.systemPrint(wv);
  },

  systemPrint(wv = this.getActiveWebview()) {
    if (!wv || typeof wv.print !== 'function') { window.showToast?.('Open a page to print first'); return; }
    // The PDF viewer prints the document's pages (with the marks), not its own toolbar.
    if (this.pdfPage(wv)) { wv.send('pdfview:command', 'print'); return; }
    // A page named "site - title - date" when that extra is on (js/tabs-nav.js): the name Windows offers for the PDF.
    const named = typeof VexTabsNav !== 'undefined' ? VexTabsNav.namePrintJob(wv).catch(err => { window.VexProblems?.note('Print', 'Could not name the printout', err); return null; }) : Promise.resolve(null);
    named.then(restore => Promise.resolve(wv.print())
      .finally(() => { if (restore) restore().catch(err => window.VexProblems?.note('Print', 'Could not put the page title back', err)); }))
      .catch(err => window.showToast?.('Could not print: ' + ((err && err.message) || err), 'error'));
  },

  viewSource(wv = this.getActiveWebview()) {
    let url = '';
    try { url = wv ? wv.getURL() : ''; } catch (err) { console.error('[Vex] view source: no page address', err); }
    // On a document shown in Vex's own viewer, the source is the document's own (never the viewer's page).
    const own = this.docOriginal(url);
    if (own) url = own.replace(/^view-source:/i, '').replace(/#.*$/, '');
    if (!/^(https?|file):/i.test(url)) { window.showToast?.('Open a web page first'); return; }
    TabManager.createTab('view-source:' + url, true);
  },

  getActiveWebview() {
    return this.webviews.get(TabManager.activeTabId);
  },

  // A load nobody waits for (a tab woken, put to sleep, or reloaded from its
  // remembered address). Its promise went unhandled, so a navigation that
  // superseded it put an uncaught "GUEST_VIEW_MANAGER_CALL … ERR_ABORTED (-3)"
  // into Problems (found 2026-09-30). Superseded is expected; anything else is
  // logged. A webview not attached yet still throws, for the caller's own
  // fallback.
  _loadUnwatched(wv, url, why) {
    wv.loadURL(this.viewerAddress(url)).catch((err) => {
      const m = String((err && err.message) || err);
      if (/ERR_ABORTED|\(-3\)/.test(m)) return;
      console.warn(`[Vex] ${why}: could not load ${url} —`, m);
    });
  },

  // Chromium's error code, in words. The proxy itself not answering (its port
  // refuses: Tor is not running) is PROXY_CONNECTION_FAILED; a site that
  // fails through a working Tor (down, refusing, no such address, an onion
  // service that is offline) is SOCKS_CONNECTION_FAILED, which said Tor was
  // not answering (found 2026-09-30, both checked live). A Tor tab or a Tor
  // site rule is known by its partition; a container or burner may go
  // through Tor or another proxy.
  _whyLoadFailed(message, partition) {
    const m = String(message || '');
    const tor = /^(tor-|persist:route-tor$)/.test(String(partition || ''));
    if (/PROXY_CONNECTION_FAILED/.test(m)) return tor ? 'Tor is not running' : 'the proxy or Tor it goes through is not answering';
    if (/SOCKS_CONNECTION_FAILED|SOCKS_CONNECTION_HOST_UNREACHABLE|TUNNEL_CONNECTION_FAILED/.test(m)) return tor ? 'the site did not answer through Tor' : 'the site did not answer through the proxy or Tor it goes through';
    if (/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/.test(m)) return 'no site has that address';
    if (/CONNECTION_REFUSED/.test(m)) return 'nothing is answering at that address';
    if (/INTERNET_DISCONNECTED/.test(m)) return 'you are offline';
    if (/TIMED_OUT/.test(m)) return 'it took too long to answer';
    if (/CERT|SSL/.test(m)) return 'its security certificate is not valid';
    if (/INVALID_URL/.test(m)) return 'that is not a valid address';
    return m;
  },

  // A Tor page that could not load because Tor is not running was a blank
  // page (found 2026-09-30). Main says which page and why (tor:page-down);
  // the words go into the page's empty error document.
  TOR_DOWN_TEXT: {
    starting: ['Tor is not running — starting it…', 'This page loads as soon as Tor is connected.'],
    failed: ['Tor could not start', 'Reload the page to try again.'],
    stopped: ['Tor stopped — reopen to start it again', 'Open a new Tor tab from the onion button. This one stays cut off from the internet.'],
  },
  showTorDown(pageId, state, error) {
    const text = this.TOR_DOWN_TEXT[state];
    if (!text) throw new Error(`Unknown Tor page state "${state}"`);
    const wv = [...this.webviews.values()].find((w) => {
      try { return w.getWebContentsId() === pageId; } catch { return false; } // not attached: not that page
    });
    if (!wv) return false;   // a page that is not a tab here
    wv.executeJavaScript(this._torDownScript(text[0], error ? `${text[1]} (${error})` : text[1]))
      .catch(err => console.error('[tor] could not say why the page is blank:', err));
    return true;
  },
  _torDownScript(title, detail) {
    const icon = VexIcons.svg('onion', { size: 40 });
    return `(() => {
      const d = document;
      const style = d.createElement('style');
      style.textContent = 'html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,sans-serif;background:#f6f6f7;color:#222}@media (prefers-color-scheme:dark){body{background:#1b1b1f;color:#e8e8ea}}.vex-tor-down{max-width:460px;padding:24px;text-align:center}.vex-tor-down h1{font-size:20px;margin:12px 0 6px}.vex-tor-down p{margin:0;opacity:.75}';
      const box = d.createElement('div');
      box.className = 'vex-tor-down';
      box.innerHTML = ${JSON.stringify(icon)};
      const h = d.createElement('h1'); h.textContent = ${JSON.stringify(title)};
      const p = d.createElement('p'); p.textContent = ${JSON.stringify(detail)};
      box.append(h, p);
      d.head.replaceChildren(style);
      d.body.replaceChildren(box);
      return true;
    })()`;
  },

  // === The New Tab page's grid ============================================
  // The page keeps its tiles in its own storage, which this window cannot
  // read, so the grid synced nowhere (found 2026-09-30). The page hands its
  // list over on every change and when it opens (VEX_CMD start-tiles); the
  // window keeps it as vex.startTiles, which SyncEngine syncs item by item,
  // and hands the grid back to every open New Tab page after a sync.
  START_TILES: 'vex.startTiles',
  _startTilesValid(list) {
    return Array.isArray(list) && list.length <= 500
      && list.every(t => !!t && typeof t === 'object' && !Array.isArray(t) && typeof t.url === 'string' && typeof t.name === 'string');
  },
  startTiles() {
    const raw = localStorage.getItem(this.START_TILES);
    if (raw === null) return null;
    let list;
    try { list = JSON.parse(raw); } catch { list = null; }
    if (!this._startTilesValid(list)) throw new Error('The New Tab grid kept by Vex is unreadable');
    return list;
  },
  // A page's own tiles added to the window's, none lost: a tile is the same
  // tile by its address, and a second one with that address (Duplicate)
  // is a second tile, as sync counts them.
  _mergeStartTiles(have, own) {
    const count = new Map();
    for (const t of have) count.set(t.url, (count.get(t.url) || 0) + 1);
    const out = [...have];
    for (const t of own) {
      const n = count.get(t.url) || 0;
      if (n > 0) count.set(t.url, n - 1); else out.push(t);
    }
    return out;
  },
  saveStartTiles(cmd, from) {
    try {
      const tiles = cmd.tiles == null ? null : cmd.tiles;
      if (tiles !== null && !this._startTilesValid(tiles)) throw new Error('The New Tab page sent a grid Vex cannot read');
      const have = this.startTiles();
      let next;
      if (cmd.loading) {
        // A page opening shows the window's grid. The first time a page
        // opens, the grid it saved is added to the window's; a page that never
        // changed its built-in tiles takes the window's as they are.
        if (!have) { if (!tiles) return; next = tiles; }
        else next = !cmd.handed && tiles ? this._mergeStartTiles(have, tiles) : have;
      } else {
        if (!tiles) return;
        next = tiles;
      }
      if (!have || JSON.stringify(have) !== JSON.stringify(next)) localStorage.setItem(this.START_TILES, JSON.stringify(next));
      // The page itself too when opening, so it is marked handed over.
      this.pushStartTiles(cmd.loading ? null : from);
    } catch (err) {
      console.error('[New Tab] the grid could not be kept:', err);
      window.showToast?.('Your New Tab tiles could not be saved for sync — ' + err.message, 'error');
    }
  },
  // Every open New Tab page (but `except`) is handed the window's grid.
  pushStartTiles(except = null) {
    const list = this.startTiles();
    if (!list) return 0;
    let handed = 0;
    for (const wv of this.webviews.values()) {
      if (wv === except) continue;
      let url = '';
      try { url = wv.getURL(); } catch { continue; }   // not attached yet: it asks when it opens
      if (!_isTrustedStartPage(url)) continue;
      wv.executeJavaScript(`window.__vexSetStartTiles ? window.__vexSetStartTiles(${JSON.stringify(list)}) : false`)
        .catch(err => console.error('[New Tab] could not hand a New Tab page its tiles:', err));
      handed++;
    }
    return handed;
  },

  // The failures an https guess for a typed name falls back to http on: no
  // TLS there, nothing listening on 443, or a certificate a home device made
  // for itself.
  HTTP_FALLBACK_ERRORS: /ERR_SSL_PROTOCOL_ERROR|ERR_SSL_VERSION_OR_CIPHER_MISMATCH|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_TIMED_OUT|ERR_CERT_[A-Z_]+/,

  _httpsOnly() {
    return typeof PrivacyPack !== 'undefined' && !!(PrivacyPack.cfg && PrivacyPack.cfg.httpsOnly);
  },

  // opts.httpFallback: the address was typed without a scheme and https was
  // guessed (VexTypedAddress.resolve).
  navigate(url, opts = {}) {
    // A site rule cannot move a tab that already exists — a webview's session
    // is fixed the moment it is attached — so the tab opens beside this one,
    // in the routed session, and this one stays where it was.
    if (typeof SiteRoutes !== 'undefined') {
      try {
        const tab = TabManager.getActiveTab();
        const routed = SiteRoutes.reroute(url, tab && tab.partition);
        if (routed && routed !== (tab && tab.partition || 'persist:main')) {
          TabManager.createTab(url, true, tab && tab.groupId, { partition: routed });
          window.showToast?.(SiteRoutes.describe({ partition: routed }) || 'Opened through your site rule');
          return;
        }
      } catch (err) { console.warn('[Vex] site rule skipped:', err.message); }
    }
    // A paired dev port keeps its cookies in its own jar (js/dev-ports-pair.js): same idea, a tab beside this one.
    if (typeof DevPortsPair !== 'undefined' && DevPortsPair.isolating()) {
      try {
        const tab = TabManager.getActiveTab();
        const routed = DevPortsPair.reroute(url, tab && tab.partition);
        if (routed && routed !== (tab && tab.partition || 'persist:main')) {
          TabManager.createTab(url, true, tab && tab.groupId, { partition: routed });
          window.showToast?.('Opened in its own cookie jar (dev port ' + DevPortsPair.portOf(url) + ')');
          return;
        }
      } catch (err) { console.warn('[Vex] dev port isolation skipped:', err.message); }
    }
    const wv = this.getActiveWebview();
    if (wv) {
      // Electron webview DOM element uses .src or .loadURL()
      // .loadURL() is the correct webview API method, but .src works as fallback
      if (typeof wv.loadURL === 'function') {
        // A navigation superseded by another rejects with ERR_ABORTED (-3);
        // that's expected. A real failure used to be only a console line: the
        // page went blank while the address bar still showed the old site
        // (found 2026-09-29). Show the address asked for, and say why.
        const tabId = TabManager.activeTabId;
        // The address bar shows the address asked for while it loads, as in
        // Chrome: it went back to the old address as soon as the bar let go,
        // until the new page arrived (found 2026-10-10). did-navigate ends
        // it; a load that never arrives and never fails puts the bar back on
        // the page still there. Electron's loadURL says ERR_ABORTED (-3) for
        // one overtaken by another, and ERR_FAILED (-2) for one that stopped
        // without finishing or failing: stopped, turned into a download, or
        // handed to another program (mailto:). Those -2s were taken for
        // failures: the tab took the address and said "Could not open".
        const asked = TabManager.tabs.find(t => t.id === tabId);
        if (asked) asked._typedUrl = url;
        const settle = () => {
          const tab = TabManager.tabs.find(t => t.id === tabId);
          if (!tab || tab._typedUrl !== url) return null;
          delete tab._typedUrl;
          return tab;
        };
        const load = () => wv.loadURL(this.viewerAddress(url)).then(settle, err => {
          const m = String((err && err.message) || err);
          if (/ERR_ABORTED|\(-3\)|ERR_FAILED \(-2\)/.test(m)) {
            const tab = settle();
            if (tab && TabManager.activeTabId === tabId) TabManager.updateUrlBar(tab);
            return;
          }
          console.warn('[Vex] navigate failed:', m);
          settle();
          // A name typed without a scheme was tried over https, and a printer
          // or a dev server with only http failed there (printer.lan,
          // myapp.test:3000). As in Chrome, it is tried again over http,
          // unless HTTPS-Only is on (found 2026-10-10).
          if (opts.httpFallback && /^https:\/\//i.test(url) && TabManager.activeTabId === tabId &&
              WebviewManager.HTTP_FALLBACK_ERRORS.test(m) && !WebviewManager._httpsOnly()) {
            this.navigate('http://' + url.slice('https://'.length));
            return;
          }
          const tab = TabManager.tabs.find(t => t.id === tabId);
          if (tab) { tab.url = url; TabManager.renderTabUpdate?.(tab); }
          const input = document.getElementById('url-input');
          if (input && TabManager.activeTabId === tabId && document.activeElement !== input) input.value = url;
          window.showToast?.('Could not open ' + url + ' — ' + this._whyLoadFailed(m, tab && tab.partition), 'error');
        });
        // An address typed the moment a tab opens, before its page is
        // attached: loadURL threw "The WebView must be attached…" out of the
        // address bar and the address was dropped (found 2026-09-30). It is
        // loaded once the page is there; a changed src is not read then.
        if (!wv._attached) { wv.addEventListener('did-attach', load, { once: true }); return; }
        load();
      } else {
        wv.src = url;
      }
    }
  },

  // The folder a Vex folder browser address stands for (vex-files://browse/?u=file:///C:/...), else null. The tab, its address bar,
  // history and bookmarks keep the folder's own file: address. The twin of VexFolderViewer.original (js/folder-viewer-host.js, which
  // loads later) and of parseViewerUrl in main/folder-viewer.js; a test holds the three equal.
  folderOriginal(url) {
    const s = String(url || '');
    if (!/^vex-files:\/\/browse\/(?:\?|$)/i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.pathname !== '/') return null;
    const original = u.searchParams.get('u');
    return original && /^file:/i.test(original) ? original : null;
  },

  goBack() {
    const wv = this.getActiveWebview();
    if (wv && wv.canGoBack()) wv.goBack();
  },

  goForward() {
    const wv = this.getActiveWebview();
    if (wv && wv.canGoForward()) wv.goForward();
  },

  // If the active webview is blank (hibernated / crashed / OS-sleep-killed) but
  // its tab still knows the real URL, return that URL so callers reload the page
  // instead of about:blank. Returns null when a plain reload is correct.
  _blankRecoveryUrl(wv) {
    let cur; try { cur = wv.getURL(); } catch { cur = ''; }
    if (cur && !/^about:blank\b/i.test(cur)) return null;
    const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
    const real = (wv.dataset && wv.dataset.hibernatedUrl) || (tab && tab.url);
    return (real && !/^about:blank\b/i.test(real)) ? real : null;
  },
  reload() {
    const wv = this.getActiveWebview();
    if (!wv) return;
    // A plain wv.reload() on a blanked tab just reloads about:blank, so the page
    // never comes back. Restore the real URL instead — this is the fix for
    // "tabs stuck on about:blank after wake, won't come back even on refresh".
    const real = this._blankRecoveryUrl(wv);
    if (real) { try { if (wv.dataset) delete wv.dataset.hibernated; this._loadUnwatched(wv, real, 'reload'); } catch { try { wv.src = real; } catch {} } return; }
    wv.reload();
  },

  // Stop a tab's load (the Stop button, Esc in the address bar or the page).
  // An address typed and still loading gives way to the page still showing,
  // as in Chrome; navigate()'s own settle finds it already gone.
  stop(tabId = TabManager.activeTabId) {
    const wv = this.webviews.get(tabId);
    if (!wv) return false;
    wv.stop();
    const tab = TabManager.tabs.find(t => t.id === tabId);
    // Stop means stopped, as in every browser: Vex's own loading state ends now, whether or not the page sends its "stopped" event (it did
    // not on a page that kept a request open, and the X then did nothing at all).
    TabManager.updateTab(tabId, { loading: false });
    if (tabId === TabManager.activeTabId) { const box = document.getElementById('webviews-container'); if (box) box.classList.remove('wv-loading'); }
    if (tab) {
      delete tab._typedUrl;
      if (tabId === TabManager.activeTabId) TabManager.updateUrlBar(tab);
    }
    return true;
  },

  // Hard reload: clear the webview's HTTP cache in the main process, then
  // reloadIgnoringCache. Falls back to the renderer-side reloadIgnoringCache /
  // reload if the IPC bridge is unavailable (dev-reload edge cases).
  hardReload() {
    console.log('[Vex] hard reload triggered — renderer callback');
    const wv = this.getActiveWebview();
    if (!wv) return;
    // Blanked tab (hibernated/crashed/OS-sleep) → restore its real URL rather
    // than hard-reloading about:blank.
    const _real = this._blankRecoveryUrl(wv);
    if (_real) { try { if (wv.dataset) delete wv.dataset.hibernated; this._loadUnwatched(wv, _real, 'hard reload'); } catch { try { wv.src = _real; } catch {} } return; }
    try {
      const id = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
      if (id != null && window.vex?.hardReloadWebview) {
        window.vex.hardReloadWebview(id).then(res => {
          if (!res?.ok) {
            console.warn('[Vex] hard-reload IPC failed:', res?.error);
            if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
            else wv.reload();
          }
        }).catch(err => {
          console.error('[Vex] hard-reload failed:', err);
          if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
          else wv.reload();
        });
        window.showToast?.('Hard reload — clearing cache');
        return;
      }
    } catch (err) {
      console.error('[Vex] hard-reload error:', err);
    }
    if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
    else wv.reload();
  },

  // Ctrl+= / Ctrl+- / Ctrl+0 right after switching to a tab whose page is
  // only now being made reached a webview with no page attached yet, and its
  // zoom methods throw "The WebView must be attached to the DOM and the
  // dom-ready event emitted" (found 2026-10-10). The saved zoom for the site
  // is put on at dom-ready anyway.
  zoomIn() {
    const wv = this.getActiveWebview();
    if (wv && wv._attached) {
      const cur = wv.getZoomFactor ? wv.getZoomFactor() : 1;
      const next = Math.min(cur + 0.1, 5);
      wv.setZoomFactor(next);
      this._saveZoom(wv, next);
    }
  },

  zoomOut() {
    const wv = this.getActiveWebview();
    if (wv && wv._attached) {
      const cur = wv.getZoomFactor ? wv.getZoomFactor() : 1;
      const next = Math.max(cur - 0.1, 0.25);
      wv.setZoomFactor(next);
      this._saveZoom(wv, next);
    }
  },

  zoomReset() {
    const wv = this.getActiveWebview();
    if (wv && wv._attached) {
      // Ctrl+0 goes back to the default zoom (100% unless one is chosen in Settings).
      const dflt = typeof VexTabsNav !== 'undefined' ? VexTabsNav.defaultZoomFactor() : 1;
      wv.setZoomFactor(dflt);
      this._saveZoom(wv, dflt);
    }
  },

  _saveZoom(wv, zoom) {
    // The address bar's zoom pill (js/zoom-indicator.js) follows this.
    document.dispatchEvent(new CustomEvent('vex:zoom-changed'));
    // A private, off-the-record or Tor page's zoom is for that tab alone: it
    // was written into the profile's list of sites, naming the site visited.
    if (!this.keepsSiteData(wv)) return;
    try {
      const url = wv.getURL();
      if (!url || url.startsWith('about:') || url.startsWith('file:')) return;
      const host = new URL(url).hostname;
      const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}');
      const dflt = typeof VexTabsNav !== 'undefined' ? VexTabsNav.defaultZoomFactor() : 1;
      if (Math.abs(zoom - dflt) < 0.001) { delete zooms[host]; } else { zooms[host] = zoom; }
      localStorage.setItem('vex.zooms', JSON.stringify(zooms));
    } catch {}
  },

  // Whether what is done on this webview's page may be remembered for its
  // site: not in a private window, nor an off-the-record or Tor tab (a session
  // that is not persist:*).
  keepsSiteData(wv) {
    if (window.VexTabPolicy?.isPrivateWindow) return false;
    const partition = (wv && typeof wv.getAttribute === 'function' && wv.getAttribute('partition')) || 'persist:main';
    return partition.startsWith('persist:');
  },

  findInPage(text) {
    const wv = this.getActiveWebview();
    if (wv && text) {
      wv.findInPage(text);
    }
  },

  stopFindInPage() {
    const wv = this.getActiveWebview();
    if (!wv) return;
    wv.stopFindInPage('clearSelection');
    // The whole-word option draws its own highlights (js/whole-word-find.js); they go too.
    if (typeof VexWholeWordFind !== 'undefined' && wv._vexWwUsed) {
      VexWholeWordFind.clear(wv).catch((err) => VexProblems?.note('Find bar', 'Could not clear the whole-word highlights', (err && err.message) || String(err)));
    }
  },

  // Save a picture from a page. As = the system Save dialog (name, folder,
  // type), through main's download handler so it is still one download in
  // the Downloads panel (src/main/downloads.js, askWhere).
  async saveImage(webview, src, as) {
    try {
      if (as) {
        if (!window.vex || typeof window.vex.downloadsAskWhere !== 'function') throw new Error('Save As is not available in this window');
        await window.vex.downloadsAskWhere(src);
      } else {
        // You asked for it, so it is never taken for one the page started by
        // itself (src/main/downloads.js, automatic downloads).
        const r = await window.vex.downloadsMine(src);
        if (!r || !r.ok) throw new Error((r && r.error) || 'Vex did not answer');
      }
      webview.downloadURL(src);
    } catch (err) {
      window.VexProblems?.note('Images', 'Could not save the image', err);
      window.showToast?.('Could not save the image: ' + ((err && err.message) || ''), 'error');
    }
  },

  // Copy the picture itself. copyImageAt asks Chromium for the image at a
  // point, which is exactly what fails when the picture is under a link or
  // pointer-events:none, so a picture the page found is fetched by main in
  // this page's own session and put on the clipboard from there.
  async copyImage(webview, src, params) {
    const p = params || {};
    if (p.mediaType === 'image' && p.srcURL === src && typeof webview.copyImageAt === 'function') {
      try { webview.copyImageAt(p.x, p.y); window.showToast?.('Image copied'); return; } catch { /* fetch it instead */ }
    }
    try {
      if (!window.vex || typeof window.vex.copyImageFrom !== 'function') throw new Error('Copying images is not available in this window');
      const r = await window.vex.copyImageFrom(src, webview.getAttribute?.('partition') || '');
      if (!r || !r.ok) throw new Error((r && r.error) || 'the image could not be read');
      window.showToast?.('Image copied');
    } catch (err) {
      window.showToast?.('Could not copy the image: ' + ((err && err.message) || ''), 'error');
    }
  },

  // The picture the page itself found under the pointer (preload-webview.js,
  // "The picture under a right-click"). Kept for a moment only: it belongs
  // to one right-click.
  noteContextImage(webview, data) {
    if (!webview) return;
    const src = data && typeof data.src === 'string' ? data.src : '';
    webview._vexCtxImage = { src, at: Date.now() };
  },

  // Chromium's answer when it saw an image; otherwise the page's, if it
  // arrived for this right-click. Only addresses Vex can do something with.
  contextImage(params, webview) {
    const p = params || {};
    let src = (p.mediaType === 'image' && p.srcURL) ? p.srcURL : '';
    const found = webview && webview._vexCtxImage;
    if (webview) webview._vexCtxImage = null;
    if (!src && found && found.src && Date.now() - found.at < 2000) src = found.src;
    return /^(https?:|data:image\/|blob:)/i.test(src) ? src : '';
  },

  // The rows for what was clicked (a picture, a link, some text): the first
  // few stay in the menu, the rest open from "More for ...". No separator
  // leads a submenu, and a group with nothing extra gets no submenu.
  _pushGroup(items, group, isTop, moreLabel, icon) {
    const rows = group.filter(it => !it.sep);
    if (!rows.length) return;
    const top = rows.filter(isTop);
    const more = rows.filter(it => !top.includes(it));
    items.push({ sep: true }, ...top);
    if (more.length) items.push({ label: moreLabel, icon, sub: more });
  },

  // Draw the rows into the menu. A row with `sub` opens a submenu beside it on
  // hover (or at once on a click), removed with the menu; a row with
  // `buttons` is a row of icon buttons.
  // Every action closes the whole menu through the shared dismissal, which
  // also removes its click-catching overlay (a bare menu.remove() left that
  // overlay behind to eat the next click).
  _renderMenu(menu, items) {
    const closeAll = () => {
      closeSub();
      if (typeof TabManager !== 'undefined' && TabManager._dismissMenu) TabManager._dismissMenu(menu);
      else menu.remove();
    };
    const run = (fn) => { try { fn(); } finally { closeAll(); } };
    let openSub = null, openRow = null, timer = null;
    const closeSub = () => {
      if (openSub) openSub.remove();
      if (openRow) { openRow.classList.remove('open'); openRow.setAttribute('aria-expanded', 'false'); }
      openSub = openRow = null;
    };
    const showSub = (row, subItems) => {
      clearTimeout(timer);
      // The menu closed while the hover timer ran: a submenu made now was
      // left behind at the window's top-left corner (found 2026-10-08).
      if (!menu.isConnected) return;
      if (openRow === row) return;
      closeSub();
      const sub = document.createElement('div');
      sub.className = 'tab-context-menu ctx-submenu';
      sub.setAttribute('role', 'menu');
      subItems.forEach(it => sub.appendChild(draw(it, true)));
      // In the page, not in the menu: the menu scrolls when it is tall, and a
      // submenu inside it was clipped away, so every submenu of the page's
      // right-click menu (Page, This site, "More for this …") could not be
      // reached (found 2026-09-29). Removed with the menu (see `gone` below).
      // Beside the row; flipped to the left, or lifted, to stay on screen.
      // Placed before it is put in the page: put in first, it stood for a
      // moment at the stylesheet's left (the window's right edge), was
      // measured there as off screen and always opened to the left, over
      // the menu (found 2026-10-08).
      const rowBox = row.getBoundingClientRect(), menuBox = menu.getBoundingClientRect();
      let left = menuBox.right - 4, top = rowBox.top - 7;
      sub.style.position = 'fixed';
      sub.style.right = 'auto';
      sub.style.transition = 'none';
      sub.style.left = left + 'px'; sub.style.top = top + 'px';
      document.body.appendChild(sub);
      const r = sub.getBoundingClientRect();
      if (r.right > window.innerWidth - 4) left = Math.max(4, menuBox.left - r.width + 4);
      if (r.bottom > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 8);
      sub.style.left = left + 'px'; sub.style.top = top + 'px';
      sub.addEventListener('mouseenter', () => clearTimeout(timer));
      sub.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(closeSub, 350); });
      openSub = sub; openRow = row;
      row.classList.add('open');
      row.setAttribute('aria-expanded', 'true');
    };
    // The submenu lives beside the menu, so it goes when the menu goes, and
    // is put away if the menu is scrolled under it.
    const gone = new MutationObserver(() => { if (!menu.isConnected) { closeSub(); gone.disconnect(); } });
    gone.observe(document.body, { childList: true, subtree: true });
    menu.addEventListener('scroll', closeSub, { passive: true });
    const icon = (name) => (typeof VexIcons !== 'undefined' && name) ? VexIcons.svg(name, { size: 14, className: 'ctx-icon' }) : '';
    const draw = (item, inSub) => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-sep';
        sep.setAttribute('role', 'separator');
        return sep;
      }
      if (item.buttons) {
        const bar = document.createElement('div');
        bar.className = 'ctx-button-row';
        for (const b of item.buttons) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ctx-button';
          btn.title = b.label;
          btn.setAttribute('aria-label', b.label);
          btn.innerHTML = icon(b.icon);
          btn.disabled = !!b.disabled;
          btn.addEventListener('mousedown', (ev) => { if (ev.button !== 0 || b.disabled) return; ev.preventDefault(); run(b.action); });
          bar.appendChild(btn);
        }
        return bar;
      }
      const el = document.createElement('div');
      el.className = 'tab-context-item';
      el.setAttribute('role', 'menuitem');
      // An extension's own item carries its icon (img); a checkbox or radio
      // item a check mark when on, and room for one when off.
      const checkRoom = '<span class="ctx-icon" style="display:inline-block;width:14px;height:14px"></span>';
      if (item.kind === 'checkbox' || item.kind === 'radio') {
        el.setAttribute('role', item.kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox');
        el.setAttribute('aria-checked', String(!!item.checked));
        el.innerHTML = item.checked ? icon('check') : checkRoom;
      } else if (item.pad) el.innerHTML = checkRoom; // lined up with checkable rows beside it
      if (item.img) {
        const img = document.createElement('img');
        img.src = item.img; img.width = 14; img.height = 14; img.alt = ''; img.className = 'ctx-icon ctx-ext-icon';
        el.appendChild(img);
      } else if (item.icon && !item.kind) el.insertAdjacentHTML('beforeend', icon(item.icon));
      el.appendChild(document.createTextNode(item.label));
      if (item.disabled) {
        el.style.opacity = '0.4';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-disabled', 'true');
      }
      if (item.sub) {
        el.classList.add('has-sub');
        el.setAttribute('aria-haspopup', 'menu');
        el.setAttribute('aria-expanded', 'false');
        el.insertAdjacentHTML('beforeend', '<span class="ctx-sub-chevron">' + icon('chevron-right') + '</span>');
        el.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => showSub(el, item.sub), 120); });
        el.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(() => { if (!(openSub && openSub.matches(':hover'))) closeSub(); }, 350); });
        el.addEventListener('mousedown', (ev) => { if (ev.button !== 0) return; ev.preventDefault(); showSub(el, item.sub); });
        return el;
      }
      // Moving onto another row of the menu puts an open submenu away.
      if (!inSub) el.addEventListener('mouseenter', () => { if (openSub) { clearTimeout(timer); timer = setTimeout(closeSub, 250); } });
      // Activate on mousedown, not click: this menu is opened from a
      // <webview> guest right-click, so focus sits in the guest. The
      // guest-host focus churn fires a host-window 'blur' that runs the
      // dismissal close() and removes the menu BETWEEN a left-click's
      // mousedown and mouseup, so the 'click' never materialises. Acting
      // on mousedown wins that race. button 0 only: ignore right/middle so
      // a right-click on a menu item doesn't trigger its action.
      el.addEventListener('mousedown', (ev) => { if (ev.button !== 0) return; run(item.action); });
      return el;
    };
    menu.setAttribute('role', 'menu');
    items.forEach(it => menu.appendChild(draw(it, false)));
  },

  showContextMenu(e, webview) {
    // Clear any prior menu AND its dismissal overlay. Removing only the menu
    // (the old behaviour) leaked a stack of transparent .context-menu-overlay
    // divs across repeated right-clicks.
    document.querySelectorAll('.tab-context-menu, .context-menu-overlay').forEach(m => m.remove());

    const curUrl = (() => { try { return webview.getURL(); } catch { return ''; } })();
    const isTab = !!(webview.dataset && webview.dataset.tabId);
    const viewerOriginal = this.viewerOriginal(curUrl);   // set only on one of Vex's own viewer pages
    const pdfPageNow = !!this.pdfOriginal(curUrl);
    const imageSrc = this.contextImage(e.params, webview);

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    // params.x/y from the Electron 'context-menu' event are already in
    // host-viewport CSS pixels in the current Electron version — the menu is
    // position:fixed, so they are consumed directly. Adding webviewRect.left/
    // top here used to double-count the icon-rail width + top-bar height,
    // shifting the menu down-right of the cursor by a constant offset.
    const mx = e.params.x || 0;
    const my = e.params.y || 0;
    menu.style.left = mx + 'px';
    menu.style.top  = my + 'px';

    // Spellcheck — when the right-click landed on a misspelled word Chromium
    // populates e.params.misspelledWord and e.params.dictionarySuggestions.
    // Surface them at the TOP of the menu; clicking one swaps the word in
    // place via the <webview> tag's replaceMisspelling(). If the word was
    // flagged but Chromium offered nothing, show a disabled "No suggestions"
    // row so the user knows spellcheck DID see the word.
    const spellingItems = [];
    if (e.params.misspelledWord) {
      const suggestions = Array.isArray(e.params.dictionarySuggestions)
        ? e.params.dictionarySuggestions
        : [];
      if (suggestions.length > 0) {
        for (const suggestion of suggestions) {
          spellingItems.push({
            label: suggestion,
            action: () => {
              // Replace the misspelled word with the suggestion in two steps:
              // (1) select the word in the guest, then (2) TYPE the replacement
              // as trusted input via webview.sendInputEvent. execCommand and
              // webContents.replaceMisspelling both change the DOM but do NOT
              // update Slate.js's model (Discord), so the fix reverted on the
              // next keystroke — trusted input is the only thing that sticks.
              // See the inline notes on each step below (verified live 2026-08-27).
              if (typeof webview.executeJavaScript !== 'function') {
                console.warn('[Vex spell] webview.executeJavaScript unavailable');
                return;
              }
              try { if (typeof webview.focus === 'function') webview.focus(); } catch {}
              const word = e.params.misspelledWord || '';
              // Step 1 (in the GUEST): focus the editable and select the
              // misspelled word. Chromium selects it on right-click but drops
              // that selection when Vex's custom menu takes focus, so re-select.
              const selectJs = `(function(){try{
                var word=${JSON.stringify(word)};
                var sel=window.getSelection();
                var anchor=sel&&sel.anchorNode;
                var host=anchor?(anchor.nodeType===1?anchor:anchor.parentElement):null;
                while(host&&!(host.isContentEditable||host.tagName==='INPUT'||host.tagName==='TEXTAREA'))host=host.parentElement;
                if(!host)host=document.activeElement;
                if(host&&host.focus)host.focus();
                var curSel=window.getSelection();
                if(word&&(!curSel||curSel.toString()!==word)){
                  if(host&&(host.tagName==='INPUT'||host.tagName==='TEXTAREA')){
                    var v=host.value||'',p=host.selectionStart||0,i=v.lastIndexOf(word,p);if(i<0)i=v.indexOf(word);
                    if(i>=0)host.setSelectionRange(i,i+word.length);
                  } else if(host){
                    var wk=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),tn;
                    while((tn=wk.nextNode())){var k=tn.data.indexOf(word);if(k>=0){var rg=document.createRange();rg.setStart(tn,k);rg.setEnd(tn,k+word.length);curSel.removeAllRanges();curSel.addRange(rg);break;}}
                  }
                }
                // Report selection success. <input>/<textarea> selections are NOT
                // reflected by window.getSelection(), so check them via value+range.
                if(host&&(host.tagName==='INPUT'||host.tagName==='TEXTAREA')){
                  try{return host.value.substring(host.selectionStart,host.selectionEnd)===word;}catch(_){return true;}
                }
                var s2=window.getSelection();
                return !!(s2&&s2.toString()===word);
              }catch(e){return false;}})();`;
              const repl = String(suggestion);
              // Step 2: type the replacement as TRUSTED char input via
              // webview.sendInputEvent. This is the crux — verified live against
              // Discord's Slate.js composer (2026-08-27): execCommand('insertText')
              // and webContents.replaceMisspelling both change the DOM but never
              // update Slate's internal model, so the next keystroke reconciles
              // back to the misspelled word (or corrupts it). Only trusted input
              // goes through Slate's model and sticks. The first char replaces the
              // selected word; the rest insert after it. ~25 ms/char lets Slate
              // process each. Non-Slate editors work with this too; the
              // execCommand fallback is only for platforms without sendInputEvent.
              const typeTrusted = () => {
                if (typeof webview.sendInputEvent !== 'function') {
                  try { webview.executeJavaScript(`try{document.execCommand('insertText',false,${JSON.stringify(repl)})}catch(_){}`); } catch {}
                  return;
                }
                let i = 0;
                const sendNext = () => {
                  if (i >= repl.length) return;
                  try { webview.sendInputEvent({ type: 'char', keyCode: repl[i] }); }
                  catch (err) { console.warn('[Vex spell] sendInputEvent failed:', err); }
                  i++;
                  setTimeout(sendNext, 25);
                };
                sendNext();
              };
              try {
                const r = webview.executeJavaScript(selectJs);
                if (r && typeof r.then === 'function') {
                  r.then((ok) => {
                    if (!ok) return; // Never insert into an unrelated caret/selection.
                    setTimeout(typeTrusted, 180);
                  }).catch((err) => { console.warn('[Vex spell] select failed:', err); });
                } else {
                  setTimeout(typeTrusted, 180);
                }
              } catch (err) {
                console.error('[Vex spell] replace error:', err);
              }
            }
          });
        }
      } else {
        spellingItems.push({ label: 'No suggestions', disabled: true });
      }
      // "Add to the dictionary" (js/spell-lang.js).
      if (typeof VexSpellLang !== 'undefined') spellingItems.push(...VexSpellLang.menuRows(webview, e.params).word);
      spellingItems.push({ sep: true });
    }

    // Standard edit commands for editable contexts (message composers, inputs)
    // — what a normal browser menu offers there. Sites with fully custom menus
    // never reach here (they preventDefault), so this only shows where the
    // native menu would have. editFlags comes from Chromium and reflects the
    // current selection/clipboard state.
    const editItems = [];
    if (e.params.isEditable) {
      const f = e.params.editFlags || {};
      editItems.push({ label: 'Cut', action: () => webview.cut?.(), disabled: f.canCut === false });
      editItems.push({ label: 'Copy', action: () => webview.copy?.(), disabled: f.canCopy === false });
      editItems.push({ label: 'Paste', action: () => webview.paste?.(), disabled: f.canPaste === false });
      // Without the page's fonts, colours and links (js/paste-plain.js).
      if (typeof VexPastePlain !== 'undefined') editItems.push(...VexPastePlain.menuRows(webview, e.params));
      editItems.push({ label: 'Select All', action: () => webview.selectAll?.() });
      // English / Turkish / both / automatic (js/spell-lang.js).
      if (typeof VexSpellLang !== 'undefined') editItems.push(...VexSpellLang.menuRows(webview, e.params).lang);
      editItems.push({ sep: true });
    }

    // What is on this page, and what is about this site, each in a submenu:
    // twenty-odd rows in one column was more than anyone reads (2026-09-27).
    const pageItems = [
      { label: 'Copy Page URL', action: () => navigator.clipboard.writeText(webview.getURL()) },
      { label: 'Copy as Markdown link', action: () => { try { const u = webview.getURL(); const title = (webview.getTitle && webview.getTitle()) || u; navigator.clipboard.writeText(`[${String(title).replace(/[\[\]]/g, '')}](${u})`); window.showToast?.('Copied as Markdown'); } catch {} } },
      { label: 'Open in New Tab', action: () => TabManager.createTab(webview.getURL(), true, null, { partition: webview.getAttribute?.("partition") }) },
      // The partition goes too: main refuses a private, OTR or Tor tab rather
      // than reopen it in the main profile, and the refusal is said aloud.
      { label: 'Open as App', action: () => {
        window.vex.openAsApp(webview.getURL(), (webview.getTitle && webview.getTitle()) || '', webview.getAttribute?.('partition') || '')
          .then((r) => { if (!r || !r.ok) window.showToast?.((r && r.error) || 'Could not open it as an app', 'error'); },
            (err) => { console.error('[Webview] Open as App failed:', err); window.showToast?.('Could not open it as an app', 'error'); });
      } },
      // A tab's own rows. In a panel (Gemini, Claude, Discord...) "Duplicate
      // Tab" copied whatever TAB was active and Auto-refresh had no tab to
      // refresh, so a panel gets neither.
      ...(isTab ? [{ label: 'Duplicate Tab', action: () => { try { const t = TabManager.tabs.find(x => String(x.id) === String(webview.dataset.tabId)); if (t && t.url) TabManager.duplicateTab(t); } catch (err) { window.showToast?.('Could not duplicate the tab: ' + err.message, 'error'); } } }] : []),
      { label: 'Send to Phone', action: () => { try { if (window.SendToPhone) SendToPhone.open(webview.getURL()); } catch {} } },
      // The whole page, one part of it, or a number in it (js/page-watch-ui.js).
      // A tab's page only: a side panel is not a page to keep an eye on.
      ...(isTab && typeof PageWatchUI !== 'undefined' ? [{ label: 'Watch this page for changes…', action: () => PageWatchUI.openForWebview(webview) }] : []),
      // Kept on this PC, in the archive library; refused for private, Tor and routed tabs.
      ...(isTab && typeof ArchiveLibrary !== 'undefined' ? [{ label: 'Archive this page', action: () => ArchiveLibrary.archiveNow() }] : []),
      // FlashMind doors (js/study-entry.js): Quiz me from this page, Save the selected word with its sentence.
      ...(isTab && typeof VexStudyEntry !== 'undefined' ? VexStudyEntry.pageItems(e.params.selectionText) : []),
      { label: 'Print…', action: () => this.printPage(webview) },
      { label: 'View Page Source', action: () => this.viewSource(webview) },
      ...(isTab ? [{ label: (typeof AutoReload !== 'undefined' && AutoReload.isOn(webview.dataset.tabId)) ? 'Auto-refresh: on…' : 'Auto-refresh…', action: () => { try { if (window.AutoReload) AutoReload.open(webview.dataset.tabId); } catch {} } }] : []),
    ];
    // GitHub page helpers and the repo group (js/dev-helpers.js): only on a github.com page.
    if (isTab && typeof VexDevHelpers !== 'undefined') pageItems.push(...VexDevHelpers.pageItems(webview));
    // Developer bench tools (js/dev-bench.js): Copy bug report, Save code blocks...
    if (isTab && typeof VexBench !== 'undefined') pageItems.push(...VexBench.pageItems(webview));
    // Find terms on this page, Source check (js/study-extras.js).
    if (isTab && typeof VexStudyExtras !== 'undefined') pageItems.push(...VexStudyExtras.pageItems(webview));
    const siteItems = [
      // Per-site controls (dark mode + reset). Zoom already has keyboard shortcuts;
      // "Reset this site" clears this host's saved zoom and dark-mode override.
      { label: this._shouldForceDark(curUrl) ? 'Dark mode: on for this site' : 'Dark mode for this site',
        action: () => this.toggleForceDarkForSite(webview) },
      ...(typeof TableExtract !== 'undefined' && TableExtract.enabled() ? [{ label: 'Copy a table or list from this page…', action: () => TableExtract.pick(webview).catch(err => window.showToast?.(err.message, 'error')) }] : []),
      ...(typeof VideoTools !== 'undefined' && VideoTools.enabled() ? [{ label: 'Video transcript, chapters and loop…', action: () => VideoTools.open(webview).catch(err => window.showToast?.(err.message, 'error')) }] : []),
      { label: 'Zap element (hide it forever)', action: () => { try { if (typeof VexBoosts !== 'undefined') VexBoosts.startZapper(); } catch {} } },
      { label: 'Reset this site’s settings', action: () => this.resetSite(webview) }
    ];

    // Back / Forward / Reload as one row of buttons, like Edge and Chrome's
    // newer menus: first, after any spelling suggestions (those lead, as in
    // every browser, because they are about the word under the pointer).
    const items = [
      ...spellingItems,
      { buttons: [
        { label: 'Back', icon: 'arrow-left', action: () => webview.goBack(), disabled: !webview.canGoBack() },
        { label: 'Forward', icon: 'arrow-right', action: () => webview.goForward(), disabled: !webview.canGoForward() },
        { label: 'Reload', icon: 'refresh', action: () => webview.reload() },
      ] },
      ...editItems,
    ];

    // Right-clicking an input (e.g. the verification-code box): offer to fill the
    // code from the Authenticator, or from Gmail, on demand, in case the
    // automatic pass didn't catch it. The authenticator row shows on any input
    // when there is an account (or the list is not known yet), and on other
    // spots only when an account belongs to this site; never in a private or
    // Tor tab (js/totp-autofill.js).
    const offerTotp = typeof TotpAutofill !== 'undefined' && TotpAutofill.shouldOfferMenuRow(webview, !!e.params.isEditable);
    if (typeof TotpAutofill !== 'undefined') TotpAutofill.refreshAccounts();
    // A separator unless one is already last (the edit rows end with one).
    const sepOnce = () => { if (!items.length || !items[items.length - 1].sep) items.push({ sep: true }); };
    if (offerTotp) {
      sepOnce();
      items.push({
        label: (window.VexI18n && window.VexI18n.t('menuFillTotp', 'Fill code from authenticator')) || 'Fill code from authenticator',
        action: () => {
          let at = {};
          try { const r = webview.getBoundingClientRect(); at = { x: (e.params.x || 0) - r.left, y: (e.params.y || 0) - r.top }; } catch { at = {}; }
          TotpAutofill.fillFromAuthenticator(webview, at).catch((err) => { console.error('[TOTP] fill from authenticator failed:', err); window.showToast?.('Could not fill the code: ' + ((err && err.message) || err), 'error'); });
        }
      });
    }
    // Passwords, by hand: the automatic "Save password?" card needs the page to
    // submit a real form, and many sites sign in by script. On a password field:
    // generate a strong one into it; on any input of an https page: save one for
    // this site (js/password-manual.js says why when a private, Tor or routed
    // tab cannot). "This site" has the save row on every page.
    if (typeof VexPasswordManual !== 'undefined' && /^https?:/i.test(curUrl)) {
      const tp = (key, fallback) => (window.VexI18n && window.VexI18n.t(key, fallback)) || fallback;
      const at = () => { try { const r = webview.getBoundingClientRect(); return { x: (e.params.x || 0) - r.left, y: (e.params.y || 0) - r.top }; } catch { return {}; } };
      const failed = (what) => (err) => { console.error('[Vault] ' + what + ' failed:', err); window.showToast?.('Could not do that: ' + ((err && err.message) || err), 'error'); };
      const saveRow = { label: tp('menuSavePw', 'Save a password for this site…'), action: () => VexPasswordManual.saveForSite(webview).catch(failed('save a password')) };
      const genRow = { label: tp('menuGenPw', 'Generate a strong password'), action: () => VexPasswordManual.generateInField(webview, at()).catch(failed('generate a password')) };
      // Electron's webview event names the field kind formControlType
      // ('input-password'); inputFieldType is the same on newer ones.
      if (e.params.formControlType === 'input-password' || e.params.inputFieldType === 'password') { sepOnce(); items.push(genRow, saveRow); }
      else if (e.params.isEditable) { sepOnce(); items.push(saveRow); }
      siteItems.unshift(saveRow);
    }
    if (e.params.isEditable && typeof EmailCodeAutofill !== 'undefined') {
      sepOnce();
      items.push({
        label: 'Fill code from email',
        action: () => { try { EmailCodeAutofill.tryFill(webview, webview.getURL(), { manual: true }); window.showToast?.('Looking for your code…'); } catch {} }
      }, {
        label: 'Fill code from clipboard',
        action: () => { EmailCodeAutofill.fillFromClipboard(webview, webview.getURL()).catch(err => console.error('[email-code] clipboard fill failed:', err)); }
      });
    }

    // Pushed picture first, then link, then text: the thing under the pointer
    // leads (a picture inside a link is mostly about the picture).
    const groups = [];
    const textItems = [];
    if (e.params.selectionText) {
      textItems.push({ sep: true });
      textItems.push({
        label: `Search "${e.params.selectionText.substring(0, 20)}..."`,
        action: () => {
          // In the page's own session: from a Tor or burner tab this searched
          // from the real address (found 2026-09-29).
          TabManager.createTab(VexTypedAddress.searchUrl(e.params.selectionText), true, null, { partition: webview.getAttribute?.('partition') });
        }
      });
      // A file and line in a stack trace: open it in the editor (js/dev-desk.js; off by default).
      if (typeof DevDesk !== 'undefined') textItems.push(...DevDesk.selectionItems(e.params.selectionText));
      // A selected asset or place id on a Roblox or DevForum page (js/dev-shortcuts.js; public data, asked only on click).
      if (typeof RobloxResolver !== 'undefined') textItems.push(...RobloxResolver.selectionItems(e.params.selectionText, webview.getURL ? webview.getURL() : ''));
      // Editable contexts already got a Copy row in editItems above.
      if (!e.params.isEditable) {
        textItems.push({
          label: 'Copy',
          action: () => webview.copy()
        });
      }
      // A link that opens the page with these words highlighted (#:~:text=), js/tabs-nav.js.
      if (!e.params.isEditable && isTab && typeof VexTabsNav !== 'undefined' && VexTabsNav.on('textFragment')) {
        const pageUrl = (() => { try { return webview.getURL(); } catch { return ''; } })();
        const fragment = VexTabsNav.textFragmentUrl(pageUrl, e.params.selectionText);
        if (fragment) {
          textItems.push({
            label: 'Copy link to selected text',
            action: () => navigator.clipboard.writeText(fragment).then(() => window.showToast?.('Copied a link to the selected text'))
              .catch(err => window.showToast?.('Could not copy the link: ' + ((err && err.message) || err), 'error')),
          });
        }
      }
      if (typeof Annotations !== 'undefined' && !viewerOriginal) {
        textItems.push({
          label: 'Highlight',
          action: () => Annotations.highlight('yellow')
        });
      }
      // Quick capture: what you selected becomes a reminder, a note, or a
      // question — without leaving the page or opening a panel first.
      {
        const sel = e.params.selectionText;
        const pageUrl = viewerOriginal || (() => { try { return webview.getURL(); } catch { return ''; } })();
        const pageTitle = (() => { try { return webview.getTitle(); } catch { return ''; } })();
        textItems.push({ sep: true });
        if (typeof VexQuickReminder !== 'undefined') {
          textItems.push({
            label: 'Remind me about this',
            action: () => VexQuickReminder.open(sel, { url: pageUrl, title: pageTitle }),
          });
        }
        if (typeof StickyNotes !== 'undefined') {
          textItems.push({
            label: 'Save as a note for this page',
            action: () => {
              const key = StickyNotes._norm(pageUrl);
              const existing = (StickyNotes._load()[key] || {}).text || '';
              const ok = StickyNotes.setText(key, existing ? existing + '\n\n' + sel : sel, { url: pageUrl, title: pageTitle });
              window.showToast?.(ok ? 'Saved to this page’s note' : 'Could not save the note', ok ? undefined : 'error');
            },
          });
        }
        if (typeof AIPanel !== 'undefined') {
          textItems.push({
            label: 'Ask Vex AI about this',
            action: () => { AIPanel.open(); AIPanel.sendMessage('chat', { message: `About this text from ${pageTitle || pageUrl}:\n\n"""${sel}"""\n\nWhat should I know?` }); },
          });
        }
      }
      // AI options for selected text
      if (typeof AIPanel !== 'undefined') {
        const sel = e.params.selectionText;
        textItems.push({ sep: true });
        textItems.push({
          label: `Explain "${sel.substring(0, 25)}${sel.length > 25 ? '...' : ''}"`,
          action: () => { AIPanel.open(); AIPanel.sendMessage('explain', { selectedText: sel }); }
        });
        textItems.push({
          label: 'Summarize selection',
          // Route via chat (free-form reply) \u2014 the 'summarize' feature renders
          // only a structured {summary} card and comes back blank for a snippet.
          action: () => { AIPanel.open(); AIPanel.sendMessage('chat', { message: `Summarize the following text clearly and concisely:\n\n"""${sel}"""` }); }
        });
        textItems.push({
          label: 'Translate selection',
          action: () => { AIPanel.open(); AIPanel.sendMessage('translate', { selectedText: sel, targetLanguage: AIPanel.translateTarget() }); }
        });
      }
      // The selected words pick the part of the page to watch.
      if (isTab && !e.params.isEditable && typeof PageWatchUI !== 'undefined') {
        textItems.push({ label: 'Watch this part of the page…', action: () => PageWatchUI.openForWebview(webview, { selection: true }) });
      }
      textItems.push({
        label: 'Read aloud',
        // Through Read Aloud, so the selection gets the bar, the highlight and
        // a stop; a bare utterance had none of them.
        action: () => { if (typeof ReadAloud !== 'undefined') ReadAloud.start({ wv: webview, selection: true }); }
      });
      // Decode, translate a command, make a GitHub issue from the selected words (js/dev-helpers.js).
      if (typeof VexDevHelpers !== 'undefined') textItems.push(...VexDevHelpers.textItems(e.params.selectionText, webview, { editable: !!e.params.isEditable }));
      // A task from the selection, collect its links, convert a time (js/comms-tools-ui.js).
      if (typeof window.CommsTools !== 'undefined') textItems.push(...window.CommsTools.textItems(e.params.selectionText, webview, { editable: !!e.params.isEditable }));
      // Add to glossary, TDK'de ara, put Turkish letters back (js/study-extras.js).
      if (typeof VexStudyExtras !== 'undefined') textItems.push(...VexStudyExtras.textItems(e.params.selectionText, webview, { editable: !!e.params.isEditable }));
    }
    // Developer bench: send to my MCP tool, Solved, Save as code block (js/dev-bench.js).
    if (typeof VexBench !== 'undefined' && e.params.selectionText && !e.params.isEditable) textItems.push(...VexBench.textItems(e.params.selectionText, webview, {}));
    groups.push(() => this._pushGroup(items, textItems, (it) => it.label === 'Copy' || /^Search "/.test(it.label), 'More for this text', 'type'));

    const linkItems = [];
    if (e.params.linkURL) {
      linkItems.push({ sep: true });
      linkItems.push({
        label: 'Open Link in New Tab',
        // Next to this tab, in its group, as a clicked link opens (js/app.js);
        // from a side panel's page (Discord, a sidebar site), next to the tab in front.
        action: () => {
          const from = isTab ? TabManager.tabs.find(t => t.id === webview.dataset.tabId) : TabManager.getActiveTab();
          TabManager.createTab(e.params.linkURL, true, (from && from.groupId) || null, { partition: webview.getAttribute?.("partition"), openerTabId: from ? from.id : null });
        }
      });
      // A link out of Discord or Roblox: what it really is, in one disabled line
      // (js/chat-link-hygiene.js; off until the person switches it on).
      if (typeof ChatLinkHygiene !== 'undefined') {
        let openerUrl = '';
        try { openerUrl = (webview.getURL && webview.getURL()) || ''; } catch (err) { console.error('[ChatLinkHygiene] could not read the page address:', err); }
        linkItems.push(...ChatLinkHygiene.menuItems(e.params.linkURL, openerUrl));
      }
      linkItems.push({
        // Copy where it really GOES, without what identifies you: a wrapped
        // link otherwise copies the wrapper, and almost every site's links
        // carry campaign tags that follow whoever you send them to.
        label: 'Copy Link',
        action: () => {
          const out = (typeof LinkSafety !== 'undefined') ? LinkSafety.describe(e.params.linkURL) : { clean: e.params.linkURL, wrapped: false, tracked: false };
          navigator.clipboard.writeText(out.clean);
          // "Is this safe to send": a lookalike, a shortener, a secret in the address (js/chat-link-hygiene.js).
          const note = (typeof ChatLinkHygiene !== 'undefined') ? ChatLinkHygiene.copyNote(e.params.linkURL) : null;
          if (note) window.showToast?.(note.text, note.kind, 7000);
          else if (out.wrapped || out.tracked) {
            window.showToast?.('Copied' + (out.wrapped ? ' the real address' : '') + (out.wrapped && out.tracked ? ', ' : '') + (out.tracked ? ' without its tracking tags' : ''));
          }
        }
      });
      linkItems.push({
        label: 'Copy Link Exactly',
        action: () => navigator.clipboard.writeText(e.params.linkURL)
      });
      linkItems.push({
        // Shorteners and redirects, followed before you click — never from a
        // private or Tor tab, where asking would contact the site outside it.
        label: 'Where Does This Link Go?',
        action: async () => {
          if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) { window.showToast?.('Not in a private tab — following the link would contact the site from your real connection'); return; }
          try { await LinkSafety.whereItGoes(e.params.linkURL); }
          catch (err) { window.showToast?.((err && err.message) || 'Could not follow the link', 'error'); }
        }
      });
      linkItems.push({
        label: 'Send Link to Phone',
        action: () => { try { if (window.SendToPhone) SendToPhone.open(e.params.linkURL); } catch {} }
      });
      linkItems.push({
        label: 'Copy Link as Markdown',
        action: () => { try { const txt = (e.params.linkText || e.params.selectionText || e.params.linkURL || '').replace(/[\[\]]/g, '').trim() || e.params.linkURL; navigator.clipboard.writeText(`[${txt}](${e.params.linkURL})`); window.showToast?.('Copied as Markdown'); } catch {} }
      });
      if (typeof VexDevHelpers !== 'undefined') linkItems.push(...VexDevHelpers.linkItems(e.params.linkURL));
      if (typeof ReadLater !== 'undefined' && /^https?:/i.test(e.params.linkURL)) {
        linkItems.push({
          label: 'Read Later',
          action: () => ReadLater.add(e.params.linkURL, e.params.linkText || e.params.linkURL)
        });
      }
      if (typeof LinkRot !== 'undefined' && /^https?:/i.test(e.params.linkURL)) {
        linkItems.push({
          label: 'Open Archived Version',
          action: () => LinkRot.viewArchived(e.params.linkURL)
        });
      }
    }
    groups.push(() => this._pushGroup(items, linkItems, (it) => it.label === 'Open Link in New Tab' || it.label === 'Copy Link', 'More for this link', 'link'));

    const imageItems = [];
    // The picture under the pointer, whether Chromium saw it (an <img> on
    // top) or the page found it under a link, an overlay or a CSS background
    // (contextImage). Save goes straight to Downloads like every download;
    // Save As asks where and under what name.
    if (imageSrc) {
      const web = /^https?:/i.test(imageSrc);
      const partition = webview.getAttribute?.('partition');
      imageItems.push({ sep: true });
      imageItems.push({ label: 'Open Image in New Tab', action: () => TabManager.createTab(imageSrc, true, null, { partition }) });
      imageItems.push({ label: 'Save Image', action: () => this.saveImage(webview, imageSrc, false) });
      imageItems.push({ label: 'Save Image As…', action: () => this.saveImage(webview, imageSrc, true) });
      imageItems.push({ label: 'Copy Image', action: () => this.copyImage(webview, imageSrc, e.params) });
      imageItems.push({ label: 'Copy Image Address', action: () => { navigator.clipboard.writeText(imageSrc); window.showToast?.('Image address copied'); } });
      if (web) imageItems.push({ label: 'Search Image with Lens', action: () => TabManager.createTab('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(imageSrc), true, null, { partition }) });
      if (typeof ImageZoom !== 'undefined') imageItems.push({ label: 'Zoom Image', action: () => ImageZoom.open(imageSrc) });
      if (web && typeof AIPanel !== 'undefined' && AIPanel.askAboutImage) imageItems.push({ label: 'Ask Vex About This Image', action: () => AIPanel.askAboutImage(imageSrc) });
    }
    groups.push(() => this._pushGroup(items, imageItems, (it) => /^(Save Image|Save Image As…|Copy Image)$/.test(it.label), 'More for this image', 'image'));

    // A right-clicked video or sound offered nothing for it (found 2026-09-29).
    const media = (e.params.mediaType === 'video' || e.params.mediaType === 'audio') ? e.params : null;
    if (media) {
      const flags = media.mediaFlags || {};
      const noun = media.mediaType === 'video' ? 'video' : 'sound';
      // The element under the pointer, found again inside the page.
      // The element under the pointer, found again inside the page: through
      // shadow roots and same-origin frames, else by its address. A video in
      // a frame or shadow root was "not found", and a refused play() was not
      // reported (found 2026-09-29).
      // Electron gives the point in the window, not in the page: measured
      // at (612,183) for a click the page saw at (550,90). Into the page's
      // own coordinates, zoom included.
      const at = (() => {
        let box = { left: 0, top: 0 }, zoom = 1;
        try { box = webview.getBoundingClientRect(); } catch (err) { console.warn('[Vex] media menu: no webview box', err); }
        try { zoom = webview.getZoomFactor() || 1; } catch (err) { console.warn('[Vex] media menu: no zoom factor', err); }
        return { x: Math.round(((Number(media.x) || 0) - box.left) / zoom), y: Math.round(((Number(media.y) || 0) - box.top) / zoom) };
      })();
      const act = (js) => webview.executeJavaScript(
        `(async () => {
          const find = (doc, x, y) => {
            let hit = doc.elementFromPoint(x, y);
            while (hit && hit.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
            if (hit && hit.tagName === 'IFRAME') {
              let d = null; try { d = hit.contentDocument; } catch (e) { d = null; }
              if (!d) return 'frame';
              const b = hit.getBoundingClientRect();
              return find(d, x - b.left - hit.clientLeft, y - b.top - hit.clientTop);
            }
            return hit && ((hit.closest && hit.closest('video,audio')) || (hit.querySelector && hit.querySelector('video,audio')));
          };
          let el = find(document, ${at.x}, ${at.y});
          if (!el || el === 'frame') { const src = ${JSON.stringify(media.srcURL || '')}; const same = src && [...document.querySelectorAll('video,audio')].find(m => m.currentSrc === src || m.src === src); if (same) el = same; }
          if (el === 'frame') return 'frame';
          if (!el) return 'none';
          try { await (${js}); return 'ok'; } catch (e) { return 'error: ' + ((e && e.message) || e); }
        })()`, true
      ).then(res => {
        if (res === 'none') window.showToast?.(`Could not find that ${noun} on the page`, 'warn');
        else if (res === 'frame') window.showToast?.(`That ${noun} is inside another site's frame, which Vex cannot reach from here`, 'warn');
        else if (typeof res === 'string' && res.startsWith('error: ')) window.showToast?.('That did not work: ' + res.slice(7), 'error');
      }).catch(err => window.showToast?.('That did not work: ' + ((err && err.message) || err), 'error'));
      const src = /^https?:/i.test(media.srcURL || '') ? media.srcURL : '';
      const mediaItems = [
        { label: flags.isPaused ? 'Play' : 'Pause', action: () => act(flags.isPaused ? 'el.play()' : 'el.pause()') },
        { label: flags.isLooping ? 'Stop Looping' : 'Loop', action: () => act('el.loop = !el.loop') },
        ...(flags.canToggleControls ? [{ label: flags.isControlsVisible ? 'Hide Controls' : 'Show Controls', action: () => act('el.controls = !el.controls') }] : []),
        ...(media.mediaType === 'video' && typeof PiPManager !== 'undefined' ? [{ label: 'Picture-in-Picture', action: () => PiPManager.toggle() }] : []),
        ...(src ? [
          { label: `Open ${noun === 'video' ? 'Video' : 'Sound'} in New Tab`, action: () => TabManager.createTab(src, true, null, { partition: webview.getAttribute?.('partition') }) },
          { label: `Copy ${noun === 'video' ? 'Video' : 'Sound'} Address`, action: () => navigator.clipboard.writeText(src).then(() => window.showToast?.('Address copied'), err => window.showToast?.('Could not copy: ' + err.message, 'error')) },
        ] : []),
      ];
      groups.push(() => this._pushGroup(items, mediaItems, (it) => /^(Play|Pause)$/.test(it.label), 'More for this ' + noun, 'video'));
    }

    // Inspect Element — opens DevTools detached for the right-clicked tab's
    // webContents. Round 5 silently failed because <webview>.getWebContentsId()
    // returns -1 when the guestInstance isn't fully attached yet, and our
    // gate `if (id != null)` let -1 through (only filters null/undefined).
    // Main then called webContents.fromId(-1), got null, returned a resolved
    // failure that the renderer's .catch() never saw — silent dead end.
    //
    // Fix: pass webview.getURL() as the IPC's fallback argument so main can
    // walk getAllWebContents() and find the right guest by URL when the ID
    // lookup fails. Also log the awaited result so future silent failures
    // surface in the host renderer's DevTools console.
    groups.reverse().forEach(add => add());
    // Extensions' own items (chrome.contextMenus, js/ext-ui.js), after Vex's,
    // as in Chrome. None in a private or Tor tab: no extension runs there.
    if (typeof VexExtUi !== 'undefined') {
      const extRows = VexExtUi.pageMenuRows(webview, e.params, imageSrc);
      if (extRows.length) items.push({ sep: true }, ...extRows);
    }
    items.push({ sep: true });
    if (viewerOriginal) {
      // The viewer is Vex's own page: its address is the PDF's, and the page tools (source, dark mode, zapper, watch, archive)
      // do not apply to it.
      const shownAddress = viewerOriginal.replace(/#.*$/, '');
      items.push({ label: pdfPageNow ? 'PDF' : 'Document', icon: 'file', sub: [
        { label: 'Copy Page URL', action: () => navigator.clipboard.writeText(viewerOriginal) },
        { label: 'Open in New Tab', action: () => TabManager.createTab(viewerOriginal, true, null, { partition: webview.getAttribute?.('partition') }) },
        ...(pdfPageNow ? [{ label: 'Print…', action: () => this.printPage(webview) }]
          : /^https?:\/\//i.test(shownAddress) ? [{ label: 'View Page Source', action: () => TabManager.createTab('view-source:' + shownAddress, true, null, { partition: webview.getAttribute?.('partition') }) }] : []),
      ] });
    } else {
      items.push({ label: 'Page', icon: 'file', sub: pageItems });
      items.push({ label: 'This site', icon: 'globe', sub: siteItems });
    }
    items.push({ sep: true });
    items.push({
      label: 'Inspect Element',
      action: () => {
        const id  = (typeof webview.getWebContentsId === 'function') ? webview.getWebContentsId() : null;
        const url = (typeof webview.getURL === 'function') ? webview.getURL() : null;
        console.log('[Vex Inspect] click — id:', id, 'url:', url);
        if (!window.vexDevTools?.openForWebContents) {
          console.warn('[Vex Inspect] vexDevTools.openForWebContents not available');
          return;
        }
        window.vexDevTools.openForWebContents(id, url).then(result => {
          console.log('[Vex Inspect] IPC result:', result);
          if (!result?.ok) {
            console.warn('[Vex Inspect] DevTools did not open. Error:', result?.error);
          }
        }).catch(err => {
          console.error('[Vex Inspect] IPC threw:', err);
        });
      }
    });

    this._renderMenu(menu, items);

    document.body.appendChild(menu);
    // Use the shared dismissal/clamp helpers so this menu closes on
    // outside-click (capture phase, immune to stopPropagation), right-click
    // elsewhere, Escape, and window blur — same as the tab/group menus.
    if (typeof TabManager !== 'undefined') {
      const x = parseInt(menu.style.left, 10) || 0;
      const y = parseInt(menu.style.top,  10) || 0;
      TabManager._clampMenuToViewport?.(menu, x, y);
      TabManager._attachMenuDismissal?.(menu);
    }
  },

  // Let a page discover that it may ASK for notifications or a location.
  //
  // Electron's permission check is a plain yes/no, so anything nobody has
  // decided on reads as 'denied' to navigator.permissions.query. Sites check
  // that before asking, find "denied", and show their own "allow it in your
  // settings" message instead of asking: notifications (v2.32.85), and a
  // cinema site's "Konuma izin vermeniz gerekiyor" for location (2026-09-27).
  // So an undecided permission reads 'prompt', one allowed in Vex reads
  // 'granted', and one blocked still reads 'denied'. Injected into the page's
  // own world, where the site's own check will see it.
  // Whether this webview's page runs no scripts of its own: built without
  // JavaScript, or on a site whose JavaScript is switched off. Vex's own
  // reads of such a page (executeJavaScript) are refused there.
  scriptsOffIn(webview) {
    if (webview && webview._noScripts) return true;
    let url = '';
    try { url = webview.getURL() || ''; } catch { return false; }
    return !!(window.SiteRulesUI && typeof SiteRulesUI.scriptsOff === 'function' && SiteRulesUI.scriptsOff(url));
  },

  // mediaOnly: a sidebar panel (js/sidebar.js). Its page is only told it may
  // ask for the microphone and camera; notifications and location are left as
  // they were there. A call in WhatsApp's panel showed its own "Allow
  // microphone — click the icon next to the address bar" box because the
  // never-asked microphone read 'denied' (main/permissions.js check handler
  // answers yes only for a saved Allow).
  async _letSitesAsk(webview, { mediaOnly = false } = {}) {
    if (!window.vex || typeof window.vex.permissionsListForPage !== 'function') return false;
    let url = '';
    try { url = webview.getURL() || ''; } catch { return false; }
    if (!/^https?:/i.test(url)) return false;
    // Nothing can be asked of a page whose scripts are switched off.
    if (window.SiteRulesUI && typeof SiteRulesUI.scriptsOff === 'function' && SiteRulesUI.scriptsOff(url)) return false;
    let origin = '';
    try { origin = new URL(url).origin; } catch { return false; }
    let decisions = {};
    // The page's own session's decisions: a container keeps its own, and a
    // container tab was told what persist:main had decided (found 2026-09-30).
    try { decisions = (await window.vex.permissionsListForPage(webview.getWebContentsId())) || {}; } catch { return false; }
    const states = mediaOnly ? {} : {
      notifications: this.shouldOfferNotificationPrompt(decisions, origin) ? 'prompt' : null,
      geolocation: this.permissionStateFor(decisions, origin, 'geolocation'),
    };
    // Microphone and camera: Chromium already answers 'granted' where Vex
    // allows them for the session or for a Discord page, so these are used
    // only where Chromium says 'denied'.
    const media = {
      microphone: this.permissionStateFor(decisions, origin, 'microphone'),
      camera: this.permissionStateFor(decisions, origin, 'camera'),
    };
    await webview.executeJavaScript(`(() => {
      try {
        if (window.__vexPermAsk) return;
        window.__vexPermAsk = true;
        const S = ${JSON.stringify(states)};
        const M = ${JSON.stringify(media)};
        const N = window.Notification;
        // Chromium reports 'denied' where Vex means 'nobody has asked'.
        if (N && S.notifications === 'prompt') Object.defineProperty(N, 'permission', { configurable: true, get: () => 'default' });
        const query = navigator.permissions && navigator.permissions.query;
        if (query) {
          navigator.permissions.query = function (d) {
            const fake = (state) => ({ state, status: state, name: d.name, onchange: null,
              addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
            if (d && M[d.name]) {
              return query.call(this, d).then((r) => (r && r.state === 'denied' ? fake(M[d.name]) : r));
            }
            const state = d && S[d.name];
            if (state) {
              return Promise.resolve({ state, status: state, name: d.name, onchange: null,
                addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
            }
            return query.call(this, d);
          };
        }
      } catch (err) { console.warn('[Vex] could not correct the permission state:', err && err.message); }
    })()`);
    return true;
  },

  // What navigator.permissions.query should say about one permission, from
  // what the user decided in Vex.
  permissionStateFor(decisions, origin, name) {
    const d = decisions || {};
    // An answer saved before camera and microphone were told apart sits under
    // '::media' and counts for both (main/permissions.js savedDecision).
    const legacy = (name === 'camera' || name === 'microphone') ? d[origin + '::media'] : undefined;
    const saved = d[origin + '::' + name] || legacy;
    if (saved === 'allow') return 'granted';
    if (saved === 'deny') return 'denied';
    return 'prompt';
  },

  // Should this origin be told it may ask? Only when nobody has decided yet:
  // a site that was blocked keeps reading 'denied', and one already granted
  // needs nothing.
  shouldOfferNotificationPrompt(decisions, origin) {
    const saved = (decisions || {})[origin + '::notifications'];
    return saved !== 'deny' && saved !== 'allow';
  },

  // The history entry for a visit, or null when history cannot hold it.
  // History holds an http(s) address of at most 8192 characters and a title
  // of at most 4096 (js/data-contracts.js; it was storage:history-add's). A
  // sign-in redirect ran past the first; a page with no title yet sent its
  // address as the title, past the second. Both came back as "Invalid payload
  // for storage:history-add" (found 2026-10-10).
  historyVisit(url, title) {
    if (!window.VexDataContracts.url(url, true)) return null;
    return { url, title: String(title || url).slice(0, 4096) };
  },

  // What to paint behind a page, given what the page paints itself.
  //
  // Only a page that paints NOTHING is given anything: a background on <html>
  // stops the body's background propagating to the canvas, so a site that
  // styles only its body would get our colour showing through its margins.
  // And even then at zero specificity, so anything the page adds later wins.
  //
  // Dark only when the page itself is drawn for dark: its text is light (the
  // JSON and text viewers, a `light dark` page in dark mode, a `color-scheme:
  // dark` page in either mode). Reporting dark mode is not enough — an
  // ordinary page that never opted in keeps black text, and Chrome gives it a
  // white canvas; a dark base put that text on #202124 (found 2026-10-03).
  baseColourFor(seen) {
    if (!seen) return null;
    const painted = seen.html || seen.body;
    if (painted) return { element: painted, inject: null };
    const base = this.pageIsDrawnForDark(seen) ? '#202124' : '#ffffff';
    return { element: base, inject: ':where(html){background-color:' + base + '}' };
  },

  // Is a page that paints no background drawn for a dark canvas? Its text
  // colour answers that directly; the scheme it declared is the fallback for
  // a colour that cannot be read.
  pageIsDrawnForDark(seen) {
    const light = this.inkIsLight(seen.ink);
    if (light !== null) return light;
    const words = String(seen.scheme || '').toLowerCase().split(/\s+/);
    if (!words.includes('dark')) return false;
    return !words.includes('light') || !!seen.dark;
  },

  // true for light text, false for dark text, null when the colour is not
  // one this can read (or is fully transparent).
  inkIsLight(ink) {
    const m = /^(rgba?|color)\((.*)\)$/i.exec(String(ink || '').trim());
    if (!m) return null;
    const parts = m[2].replace(/[,/]/g, ' ').trim().split(/\s+/);
    let scale = 255;
    if (m[1].toLowerCase() === 'color') {
      if (parts.shift() !== 'srgb') return null;
      scale = 1;
    }
    const [r, g, b, a] = parts.map(Number);
    if (![r, g, b].every(Number.isFinite)) return null;
    if (a === 0) return null;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / scale;
    return luma > 0.5;
  },

  _updateFavicon(tabId, url) {
    try {
      const u = new URL(url);
      if (u.hostname && !isStartPage(url) && /^https?:$/.test(u.protocol)) {
        // Privacy: use the site's OWN first-party /favicon.ico rather than
        // Google's s2 favicon service (which would leak every domain you visit
        // to Google — at odds with Vex's tracker blocker + fingerprint farbling).
        // This is a provisional icon; the real one from the page's <link rel=icon>
        // arrives via the 'page-favicon-updated' event and overwrites it. The tab
        // UI's <img> onerror handles sites with no /favicon.ico.
        const guess = `${u.origin}/favicon.ico`;
        // A tab in a session of its own: the icon it wore belongs to the page
        // it left, so it goes now, and the new one comes through the tab's
        // own session (_setFavicon).
        const tab = TabManager.tabs.find(t => t.id === tabId);
        if (tab && !TabManager.windowMayAsk(tab.partition)) {
          if (!this._ownIcons.has(tab.partition + ' ' + guess)) TabManager.updateTab(tabId, { favicon: null });
          this._setFavicon(tabId, guess);
          return;
        }
        // One that has already failed this session is not worth asking for
        // again (js/tabs.js). The real icon still arrives from the page's own
        // <link rel=icon> through page-favicon-updated.
        if (TabManager.isDeadFavicon && TabManager.isDeadFavicon(guess)) return;
        TabManager.updateTab(tabId, { favicon: guess });
      }
    } catch {}
  },

  // Icons of tabs in a session of their own — a container, a Tor or proxy
  // route, a private or Tor tab. Vex's window draws every tab's icon through
  // its own session, which is direct, so a Tor tab's site was shown the real
  // address on every redraw (found 2026-09-30). These are fetched through the
  // tab's own session instead (src/main/favicon-fetch.js) and worn as a data:
  // URL. If that session refuses (Tor down), the tab has no icon. Kept for
  // the run, by session and address.
  _ownIcons: new Map(),
  _ownIconMisses: new Set(),
  _ownIconPending: new Map(),
  _ownIconAsked: new Map(),
  OWN_ICONS_KEPT: 300,

  _setFavicon(tabId, url) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (TabManager.windowMayAsk(tab.partition) || !/^https?:/i.test(String(url))) {
      TabManager.updateTab(tabId, { favicon: url });
      return;
    }
    const key = tab.partition + ' ' + url;
    this._ownIconAsked.set(tabId, url);
    const wear = (dataUrl) => {
      // Only the latest address asked for this tab: it may have moved on.
      if (this._ownIconAsked.get(tabId) !== url) return;
      TabManager.updateTab(tabId, { favicon: dataUrl });
    };
    if (this._ownIcons.has(key)) { wear(this._ownIcons.get(key)); return; }
    if (this._ownIconMisses.has(key)) return;
    let pending = this._ownIconPending.get(key);
    if (!pending) {
      const wv = this.webviews.get(tabId);
      let pageId = 0;
      try { pageId = wv ? wv.getWebContentsId() : 0; } catch (err) {
        console.warn('[Vex] the favicon of a tab in its own session waits for its page:', err.message);
        return;
      }
      if (!pageId) return;
      pending = Promise.resolve(window.vex.tabFavicon(pageId, url)).then((r) => {
        if (r && r.ok) {
          if (this._ownIcons.size >= this.OWN_ICONS_KEPT) this._ownIcons.delete(this._ownIcons.keys().next().value);
          this._ownIcons.set(key, r.dataUrl);
          return r.dataUrl;
        }
        // The site said there is none: not asked again this run. A request
        // that never got through (Tor starting or down) is asked again on
        // the next page.
        if (r && r.answered) this._ownIconMisses.add(key);
        console.warn('[Vex] no favicon for a tab in its own session (' + url.slice(0, 120) + '):', (r && r.error) || 'no answer');
        return null;
      }).finally(() => this._ownIconPending.delete(key));
      this._ownIconPending.set(key, pending);
    }
    pending.then((dataUrl) => { if (dataUrl) wear(dataUrl); })
      .catch(err => console.error('[Vex] the favicon of a tab in its own session could not be fetched:', err.message));
  }
};

// Publish on window too: the top-level `const` is visible to other classic
// scripts through the shared script scope, but it is NOT a window property —
// guards like `window.WebviewManager && ...` (gui-style.js, formerly
// sidebar.js) were always undefined and silently skipped their branch.
if (typeof window !== 'undefined') window.WebviewManager = WebviewManager;

// An open document viewer follows the theme, the look and the font as they change here.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const pushOfficeTheme = () => { try { WebviewManager.sendOfficeThemeToAll(); } catch (err) { console.warn('[Vex] the document viewers could not be given the theme:', err && err.message); } };
  document.addEventListener('theme-changed', pushOfficeTheme);
  document.addEventListener('vex:font-changed', pushOfficeTheme);
  // A look is applied a moment after the event that names it.
  window.addEventListener('vex:gui-style', () => setTimeout(pushOfficeTheme, 150));
  window.addEventListener('vex:gui-colors', () => setTimeout(pushOfficeTheme, 150));
}

// An open image viewer follows the theme, the look, the font and the language as they change here.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const pushImageTheme = () => { try { WebviewManager.sendImageThemeToAll(); } catch (err) { console.warn('[Vex] the image viewers could not be given the theme:', err && err.message); } };
  document.addEventListener('theme-changed', pushImageTheme);
  document.addEventListener('vex:font-changed', pushImageTheme);
  // A look is applied a moment after the event that names it.
  window.addEventListener('vex:gui-style', () => setTimeout(pushImageTheme, 150));
  window.addEventListener('vex:gui-colors', () => setTimeout(pushImageTheme, 150));
  if (typeof MutationObserver !== 'undefined') new MutationObserver(pushImageTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

// An open document viewer follows the theme, the look and the font as they change here.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const pushDocTheme = () => { try { WebviewManager.sendDocThemeToAll(); } catch (err) { console.warn('[Vex] the document viewers could not be given the theme:', err && err.message); } };
  document.addEventListener('theme-changed', pushDocTheme);
  document.addEventListener('vex:font-changed', pushDocTheme);
  // A look is applied a moment after the event that names it.
  window.addEventListener('vex:gui-style', () => setTimeout(pushDocTheme, 150));
  window.addEventListener('vex:gui-colors', () => setTimeout(pushDocTheme, 150));
  // The window's language (js/i18n-ui.js sets <html lang>) goes with it.
  if (typeof MutationObserver !== 'undefined') new MutationObserver(pushDocTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

// An open PDF viewer follows the theme, the look and the font as they change here.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const pushPdfTheme = () => { try { WebviewManager.sendPdfThemeToAll(); } catch (err) { console.warn('[Vex] the PDF viewers could not be given the theme:', err && err.message); } };
  document.addEventListener('theme-changed', pushPdfTheme);
  document.addEventListener('vex:font-changed', pushPdfTheme);
  // A look is applied a moment after the event that names it.
  window.addEventListener('vex:gui-style', () => setTimeout(pushPdfTheme, 150));
  window.addEventListener('vex:gui-colors', () => setTimeout(pushPdfTheme, 150));
  // The window's language (js/i18n-ui.js sets <html lang>) goes with it.
  if (typeof MutationObserver !== 'undefined') new MutationObserver(pushPdfTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

// Renderer-safe export — the renderer loads this file via <script> tag where
// `module` is undefined, so the guard keeps the global WebviewManager surface
// unchanged. Used by tests/renderer/webviewContextMenu.test.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebviewManager };
}
