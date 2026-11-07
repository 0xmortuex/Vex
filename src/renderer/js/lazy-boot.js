// === Start-up budget: boot marks and the modules that load after start-up (T3-066) ===
//
// index.html parses ~490 blocking scripts before the window is usable. Each new
// feature added another one. Two things keep that from growing without end:
//
//   1. BUDGET (scripts/startup-budget.js, run by `npm run check:source`): the
//      number and size of the blocking scripts may not grow more than 15
//      percent past scripts/startup-budget.json. A new feature that does not
//      need to be there at first paint goes in LATE_MODULES below instead.
//   2. LATE_MODULES: files that only register a Settings section, a Ctrl+K
//      command and their switch when they load, and that nothing reads while
//      the window is coming up, are loaded after the window's load event, at an
//      idle moment (VexLazy.afterIdle, js/lazy.js). Their index.html tag is
//      gone; the bundle step leaves them as separate files, as it does for
//      every lazily loaded file, so load order of the rest is untouched.
//      A module belongs here only if NO other file reads its global at load
//      time and its VexUsage switch (if any) is listed in `usage` so it joins
//      the registry when it arrives.
//
// Three boot marks (milliseconds since navigation start) are kept for the last
// ten starts on this computer, for the diagnostics and the budget check:
//   scripts   all blocking scripts have run (this file is the last of them)
//   ready     the window's load event
//   settled   every late module has loaded (or failed)
const VexBoot = {
  KEY: 'vex.boot.marks',
  KEEP: 10,
  LATE_MODULES: [
    { src: 'js/release-checklist.js', usage: ['release-check'] },
    // Automatic backup (opt-in): asks main a few minutes after start-up whether one is due; with the switch off, main says no at once.
    { src: 'js/auto-backup.js', usage: [] },
    // Encrypted secrets file (export / check / restore): opened from the backup dialog or Ctrl+K; main does the work.
    { src: 'js/secrets-lifeboat.js', usage: [] },
    // Web Serial / WebUSB chooser and the remembered-devices list: opened by app.js when a page asks (VexLazy.ensure), and for Ctrl+K.
    { src: 'js/device-picker.js', usage: [] },
    // "Many of your logins look gone": listens for main's one notice and files it in the Attention Inbox.
    { src: 'js/mass-signout.js', usage: [] },
    { src: 'js/voice-match.js', usage: [] },
    { src: 'js/voice-control.js', usage: ['voice-control'] },
    { src: 'js/sidebar-groups-ui.js', usage: [] },
    { src: 'js/toolbar-customize.js', usage: [] },
    { src: 'js/after-downloads-ui.js', usage: [] },
    // Clicking GitHub: the Control Center or github.com, asked or kept (js/sidebar.js loads it on demand if a click comes first).
    { src: 'js/github-open.js', usage: [] },
    // Wi-Fi sign-in check: only read when its button on the page that did not load, or its Ctrl+K command, is pressed.
    { src: 'js/captive-portal.js', usage: [] },
    // Skip intro / next episode switches for streaming sites: only read when its Ctrl+K command is used.
    { src: 'js/streaming-skip.js', usage: [] },
    // Caret browsing: only read when F7 or its Ctrl+K command is used (and at start-up when it was left on).
    { src: 'js/caret-browsing.js', usage: [] },
    // Lyrics card: only read when its Ctrl+K command or the Lyrics button on Now Playing is used.
    { src: 'js/lyrics-card.js', usage: [] },
    // What changed since the last launch: asks main once (after its own 20 s delay) and writes Attention Inbox rows only when something differs.
    { src: 'js/integrity-notes.js', usage: [] },
    // "Check my devices": only read when its Ctrl+K command or the offer in Meeting mode is used.
    { src: 'js/device-check.js', usage: [] },
    // Feature packs: the inbox row's button and the one-time offer; the screen itself is built when it is opened.
    { src: 'js/feature-packs.js', usage: [] },
    // Sign-out warning for sites that log you out: does nothing unless a site has a timeout saved (site panel).
    { src: 'js/session-timeout.js', usage: [] },
    // Lite mode (slow Wi-Fi): the toolbar badge, its Settings section and the switch. The tabs' autoplay policy is read from site-rules-ui.js.
    { src: 'js/lite-mode.js', usage: [] },
    // Skip tracking redirect links: the toast with Undo, the Settings row and the default for a new profile (the skipping itself is in main).
    { src: 'js/link-unwrap.js', usage: [] },
    // Forget a site when I close it: listens for a tab closing, and does nothing for a site without the rule.
    { src: 'js/forget-site.js', usage: [] },
    { src: 'js/reminders-tab.js', usage: [] },
    { src: 'js/theme-pack-ui.js', usage: [] },
    { src: 'js/this-site.js', usage: [] },
    // Open this page or link in another browser: the menu rows and Ctrl+K commands appear once it has loaded (js/webview.js asks with typeof).
    { src: 'js/open-in-browser.js', usage: [] },
    // More ways to open a link (split view, container, private window, background): the link menu asks with typeof.
    { src: 'js/link-open-extras.js', usage: [] },
    // Next / previous page key and its Ctrl+K commands (the key is in js/shortcuts-registry.js and runs the command by id).
    { src: 'js/page-nav.js', usage: [] },
    // Search This Site: the Ctrl+K command, its key and the "@site words" address-bar prefix (js/app.js asks with typeof).
    { src: 'js/site-search.js', usage: [] },
    // Copy Text from Image (English + Turkish): the image menu asks with typeof; the Tesseract engine loads only when a picture is read.
    { src: 'js/image-text.js', usage: [] },
    { src: 'js/share-look.js', usage: [] },
    { src: 'js/share-look-ui.js', usage: [] },
    { src: 'js/share-space.js', usage: ['share-space'] },
    { src: 'js/share-space-ui.js', usage: [] },
    { src: 'js/diagnostics-bundle.js', usage: [] },
    { src: 'js/your-data.js', usage: [] },
    { src: 'js/maker-repos.js', usage: [] },
    { src: 'js/faq-ui.js', usage: [] },
    { src: 'js/drm-help-tr.js', usage: [] },
    { src: 'js/settings-sweep2-tr.js', usage: [] },
    { src: 'js/ai-connect.js', usage: [] },
    { src: 'js/ai-bar.js', usage: [] },
    // Research mode: a sourced brief from some tabs. The core checks every quote against its page; the module is the window, the Settings group and the commands.
    { src: 'js/research-core.js', usage: [] },
    { src: 'js/research-mode.js', usage: ['research-mode'] },
    { src: 'js/dialogs-tr.js', usage: [] },
    { src: 'js/drm-help.js', usage: [] },
    { src: 'js/unblock-centre.js', usage: ['unblock-centre'] },
    { src: 'js/page-recorder.js', usage: [] },
    { src: 'js/agent-task-panel.js', usage: [] },
    { src: 'js/shopping-clip.js', usage: [] },
    { src: 'js/dev-loop-ui.js', usage: [] },
    { src: 'js/clipboard-pipeline.js', usage: [] },
    { src: 'js/vex-mini-games.js', usage: [] },
    { src: 'js/play-room.js', usage: [] },
    { src: 'js/vex-tab-tetris.js', usage: [] },
    { src: 'js/vex-medals-profile.js', usage: [] },
    { src: 'js/privacy-report-card.js', usage: [] },
    { src: 'js/security-helpers.js', usage: [] },
    { src: 'js/timeline-actions.js', usage: [] },
    { src: 'js/extension-audit-view.js', usage: [] },
    { src: 'js/vex-usage-ui.js', usage: [] },
    { src: 'js/feature-switches.js', usage: [] },
    { src: 'js/fun/fun-settings.js', usage: [] },
    { src: 'js/attention-settings.js', usage: [] },
    { src: 'js/inbox-hub.js', usage: [] },
    { src: 'js/quiet-hours-ui.js', usage: [] },
    { src: 'js/tabs-nav-settings.js', usage: [] },
    { src: 'js/capture-tools.js', usage: [] },
    // Wave 6: features that sit in the usage record and that nothing reads while the window comes up. Each registers its
    // switch when it arrives and the staging pass runs again (VexRegistry.restageLate), so a profile that already existed
    // still gets them switched off.
    { src: 'js/links-windows.js', usage: ['mini-window', 'window-set'] },
    { src: 'js/game-overlay.js', usage: ['game-overlay'] },
    { src: 'js/embedding-manager.js', usage: ['embedding-manager'] },
    { src: 'js/response-overrides-ui.js', usage: ['response-overrides'] },
    { src: 'js/selection-tools.js', usage: ['selection-tools'] },
    { src: 'js/log-tailer.js', usage: ['log-tailer'] },
    { src: 'js/docs-pin.js', usage: ['docs-pin'] },
    { src: 'js/pkg-card.js', usage: ['pkg-card'] },
    { src: 'js/code-library.js', usage: ['code-library'] },
    { src: 'js/paper-brief.js', usage: ['paper-brief'] },
    { src: 'js/mun-dossier.js', usage: ['mun-dossier'] },
    { src: 'js/clear-recent.js', usage: ['clear-recent'] },
    { src: 'js/capture-mute.js', usage: [] },
    { src: 'js/bookmark-dupes.js', usage: [] },
    { src: 'js/game-scenes.js', usage: ['game-scenes'] },
    { src: 'js/second-screen.js', usage: ['second-screen'] },
    { src: 'js/receipt-locker.js', usage: ['receipt-locker'] },
    { src: 'js/day-shape.js', usage: ['day-shape'] },
    { src: 'js/whats-new-me.js', usage: ['whats-new-me'] },
    { src: 'js/pointer-fx.js', usage: ['custom-cursor', 'click-effect'] },
    // The Wallpaper Store: pictures drawn by code (data, generators), the painter shared with the New Tab, the logic and API (window.VexWallpapers) and its screen.
    { src: 'js/wallpaper-generators.js', usage: [] },
    { src: 'js/wallpaper-data.js', usage: [] },
    // More pictures drawn by code (materials, tiles, botanical, sky, maps): about 150 KB of text that nothing reads until the Store or a New Tab paints one.
    { src: 'js/wallpaper-materials.js', usage: [] },
    { src: 'js/wallpaper-patterns.js', usage: [] },
    { src: 'js/wallpaper-nature.js', usage: [] },
    { src: 'js/wallpaper-materials-data.js', usage: [] },
    { src: 'js/wallpaper-paint.js', usage: [] },
    { src: 'js/wallpaper-store.js', usage: ['wallpaper-store'] },
    { src: 'js/wallpaper-sync.js', usage: [] },
    { src: 'js/wallpaper-store-ui.js', usage: [] },
    { src: 'js/update-tour.js', usage: ['whats-new-me'] },
    { src: 'js/media-control.js', usage: ['media-control'] },
    // Sleep timer for media: reads nothing and runs nothing until a press (Ctrl+K, or its row in Now Playing).
    { src: 'js/sleep-timer.js', usage: [] },
    // One sound at a time and quiet during calls: attaches its listeners only if one of the two rules was switched on.
    { src: 'js/sound-policy.js', usage: [] },
    // Copy video link at this time: reads the video's time only when the command, the key or the video's menu item is used.
    { src: 'js/video-link.js', usage: [] },
    // Bass, treble, mono and balance per site: read in when the volume box opens or a page with kept settings loads.
    { src: 'js/site-eq.js', usage: [] },
    { src: 'js/media-viewer-host.js', usage: ['media-viewer'] },
    { src: 'js/pdf-highlights.js', usage: ['pdf-highlights'] },
    { src: 'js/pdf-tools-ui.js', usage: ['pdf-tools'] },
    { src: 'js/office-viewer-host.js', usage: ['office-viewer'] },
    { src: 'js/image-viewer-host.js', usage: ['image-viewer'] },
    { src: 'js/doc-viewer-host.js', usage: ['doc-viewer'] },
    { src: 'js/folder-viewer-host.js', usage: ['folder-browser'] },
    { src: 'js/print-preview-ui.js', usage: ['print-preview'] },
    { src: 'js/pdf-viewer-host.js', usage: ['pdf-viewer'] },
    { src: 'js/reading-aids-lists.js', usage: [] },
    { src: 'js/turkish-lemma.js', usage: [] },
    // The search shared by Ctrl+K and Settings (both guard its global, so a search before it is here is the plain one).
    { src: 'js/smart-search.js', usage: [] },
    // Saved payment cards: the offer, the chooser, the manager and Settings > Payment cards (attaches itself to the tabs already open).
    { src: 'js/card-saver.js', usage: [] },
    // Dangerous-site warnings: the Settings section (switch, list date, Update now, test) and two Ctrl+K commands. The check itself is in main.
    { src: 'js/threat-list-ui.js', usage: [] },
    // Safe Download Assistant: the mark on a finished download, Open anyway..., Quarantine and Settings > Safe downloads. The check itself is in main.
    { src: 'js/safe-download-ui.js', usage: [] },
    // The bar over a tab an extension is controlling through the debugger (draws itself when main says a tab is held).
    { src: 'js/ext-debug-bar.js', usage: [] },
    // An extension's side panel, docked beside the page (chrome.sidePanel.open).
    { src: 'js/ext-sidepanel.js', usage: [] },
    { src: 'js/reading-aids.js', usage: ['reading-aids'] },
    { src: 'js/page-chrome.js', usage: ['link-bar', 'load-bar', 'page-scrollbars'] },
    // Quick look at a finished download (Space in the Downloads panel): drawn only when asked for; the panel guards its global.
    { src: 'js/download-quicklook.js', usage: [] },
    // Dark mode for websites: the Settings rows and the page-menu toggle. The pages themselves are handled by
    // src/dark-mode-preload.js and main, which read the saved settings, so a tab never waits for this file.
    { src: 'js/dark-mode.js', usage: [] },
    // Page automations: record a job on a site and replay it. The rules and the in-page code load the first time they are used (VexLazy.ensure).
    { src: 'js/page-automations.js', usage: ['page-automations'] },
  ],
  marks: {},
  failed: [],      // late modules that could not load (also in the Problems log)
  _settledWaiters: [],
  // Resolves once every late module has loaded (or failed): what builds a switch for a feature waits for this, so the feature exists.
  whenSettled() { return this.marks.settled ? Promise.resolve() : new Promise(resolve => { this._settledWaiters.push(resolve); }); },

  mark(name) {
    if (typeof performance === 'undefined') return null;
    const t = Math.round(performance.now());
    this.marks[name] = t;
    if (typeof window !== 'undefined' && window.VexStartup) window.VexStartup.marks = { ...this.marks };
    return t;
  },

  _history() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The boot marks could not be read: ' + err.message); }
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
    catch (err) { throw new Error('The boot marks are not readable: ' + err.message); }
  },

  // Keeps this start's marks (called once all three are in).
  record(at = Date.now()) {
    const list = this._history();
    list.push({ at, ...this.marks });
    while (list.length > this.KEEP) list.shift();
    localStorage.setItem(this.KEY, JSON.stringify(list));
    return list;
  },

  // Median of each mark over the kept starts, for the diagnostics.
  summary() {
    const list = this._history();
    const med = (name) => {
      const v = list.map(e => e[name]).filter(Number.isFinite).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };
    return { starts: list.length, scripts: med('scripts'), ready: med('ready'), settled: med('settled') };
  },

  start() {
    this.mark('scripts');
    const onLoad = () => this.mark('ready');
    if (document.readyState === 'complete') onLoad(); else window.addEventListener('load', onLoad, { once: true });
    const loads = this.LATE_MODULES.map(m => VexLazy.afterIdle(m.src, { usage: m.usage }).then(() => true, () => false));
    Promise.all(loads).then((results) => {
      this.failed = this.LATE_MODULES.filter((_, i) => !results[i]).map(m => m.src);
      this.mark('settled');
      this._settledWaiters.splice(0).forEach(resolve => resolve());
      try { this.record(); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Start-up', 'Could not keep the boot marks', err); else console.error('[Boot]', err); }
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexBoot = VexBoot;
  if (typeof VexLazy !== 'undefined') VexBoot.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBoot };
