// === Vex Command Bar (Ctrl+K) ===
//
// Mixed-mode launcher: navigates URLs, runs Google searches, opens sidebar
// panels, runs built-in tools, and exposes most TabManager / WebviewManager
// actions as keyboardable commands.
// Public API: CommandBar (singleton — open/close/toggle, search, executeSelected).
// Depends on TabManager, WebviewManager, SidebarManager, AIPanel, etc.

const CommandBar = {
  isOpen: false,
  selectedIndex: 0,
  results: [],

  commands: [
    { id: 'new', label: 'New Tab', hint: 'Open a new tab', shortcut: 'Ctrl+T', icon: 'plus', action: () => TabManager.createTab(START_URL, true) },
    { id: 'tour', label: 'Guide / Tour', hint: 'Take the interactive walkthrough of Vex', icon: 'compass', action: () => { if (typeof VexTour !== 'undefined') VexTour.start(); } },
    { id: 'setup', label: 'Run Setup Wizard', hint: 'Set up your tools again — theme, name, weather, GitHub, AI', icon: 'wand', action: () => { if (typeof Onboarding !== 'undefined') Onboarding.start(); } },
    { id: 'peek', label: 'Peek Current Page', hint: 'Preview the active page in a floating overlay (Shift+click links to peek them)', icon: 'eye', action: () => { const t = TabManager.getActiveTab(); if (t && t.url && typeof VexPeek !== 'undefined') VexPeek.open(t.url); } },
    { id: 'zap', label: 'Zap Element', hint: 'Click any element on this page to hide it forever on this site', icon: 'zap', action: () => { if (typeof VexBoosts !== 'undefined') VexBoosts.startZapper(); } },
    { id: 'boost', label: 'Boost This Site', hint: 'Custom CSS / JS for the current site', icon: 'palette', action: () => { if (typeof VexBoosts !== 'undefined') VexBoosts.openEditor(); } },
    { id: 'readlater', label: 'Read Later', hint: 'Save this page to your Library queue', icon: 'book', action: () => { const t = TabManager.getActiveTab(); if (t && t.url) ReadLater.add(t.url, t.title); } },
    { id: 'library', label: 'Library', hint: 'Read-later queue + auto-archived tabs', icon: 'book', isPrimary: true, action: () => SidebarManager.openPanel('library') },
    { id: 'clip', label: 'Clip to Notes', hint: 'Save the selected text (or this link) into your Clippings note', icon: 'scissors', action: () => ClipToNotes.clip() },
    { id: 'highlight', label: 'Highlight Selection', hint: 'Highlight the selected text — it reappears every time you revisit the page', icon: 'marker', action: () => { if (typeof Annotations !== 'undefined') Annotations.highlight('yellow'); } },
    { id: 'highlight-green', label: 'Highlight Selection (Green)', hint: 'Highlight selection in green', icon: 'marker', action: () => { if (typeof Annotations !== 'undefined') Annotations.highlight('green'); } },
    { id: 'highlight-pink', label: 'Highlight Selection (Pink)', hint: 'Highlight selection in pink', icon: 'marker', action: () => { if (typeof Annotations !== 'undefined') Annotations.highlight('pink'); } },
    { id: 'annotations', label: 'Highlights', hint: 'All your saved highlights across every page', icon: 'marker', isPrimary: true, action: () => SidebarManager.openPanel('annotations') },
    { id: 'recall', label: 'Recall — Search What You\'ve Read', hint: 'Full-text search of every page you\'ve visited, by content', icon: 'search', isPrimary: true, action: () => SidebarManager.openPanel('recall') },
    { id: 'bionic', label: 'Bionic Reading', hint: 'Bold the start of every word to read faster (run again to undo)', icon: 'type', action: () => { if (typeof AccessibilityPack !== 'undefined') AccessibilityPack.bionic(); } },
    { id: 'speedread', label: 'Speed Read (RSVP)', hint: 'Flash this article one word at a time at your chosen WPM', icon: 'fast-forward', action: () => { if (typeof AccessibilityPack !== 'undefined') AccessibilityPack.rsvp(); } },
    { id: 'translate-selection', label: 'Translate Selection', hint: 'Translate the highlighted text into your language', icon: 'globe', action: () => { if (typeof AccessibilityPack !== 'undefined') AccessibilityPack.translateSelection(); } },
    { id: 'tabai', label: 'AI Tab Command', hint: 'Tell AI what to do with your tabs — "close all YouTube tabs", "group my shopping tabs"', icon: 'tabs', action: () => TabAI.open() },
    { id: 'wsnap', label: 'Workspace Time-Travel', hint: 'Restore a past set of open tabs for this workspace', icon: 'history', action: () => { if (typeof WorkspaceSnapshots !== 'undefined') WorkspaceSnapshots.open(); } },
    { id: 'catchup', label: 'Catch Me Up', hint: 'AI digest of your RSS feeds + unread Read Later', icon: 'coffee', action: () => { if (typeof CatchMeUp !== 'undefined') CatchMeUp.open(); } },
    { id: 'otr', label: 'New Off-the-Record Tab', hint: 'Ephemeral tab: no history, cookies vanish when closed', icon: 'incognito', action: () => TabManager.createTab(START_URL, true, null, { partition: 'otr-' + Date.now() }) },
    { id: 'tor', label: 'New Tor Tab', hint: 'Maximum-security private tab routed through Tor (needs Tor running)', icon: 'onion', action: () => { if (typeof TorSession !== 'undefined') TorSession.open(); } },
    { id: 'identity', label: 'New Identity Tab', hint: 'Fresh isolated session + a new browser fingerprint — no carry-over from your logins', icon: 'mask', action: async () => {
      try {
        const r = await window.vex?.createIdentity?.();
        if (r && r.ok && r.partition) {
          TabManager.createTab(START_URL, true, null, { partition: r.partition });
          window.showToast?.(`New identity · ${r.label || 'fresh session'}`);
        } else { window.showToast?.('Could not create identity', 'error'); }
      } catch { window.showToast?.('Could not create identity', 'error'); }
    } },
    { id: 'qr', label: 'QR Code for This Page', hint: 'Show a QR code to open this page on your phone', icon: 'phone', action: async () => {
      const t = TabManager.getActiveTab();
      if (!t || !t.url) { window.showToast?.('Open a page first'); return; }
      const dataUrl = await window.vex.qrMake(t.url);
      if (!dataUrl) { window.showToast?.('QR failed'); return; }
      document.getElementById('vex-qr')?.remove();
      const m = document.createElement('div');
      m.id = 'vex-qr';
      m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
      m.innerHTML = '<div style="background:#fff;border-radius:16px;padding:22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.5)"><img src="' + dataUrl + '" style="display:block"><div style="font:12px \'Outfit\',sans-serif;color:#333;margin-top:8px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + t.url.replace(/</g, '&lt;') + '</div></div>';
      m.addEventListener('click', () => m.remove());
      document.body.appendChild(m);
    } },
    { id: 'pinsite', label: 'Pin Site to Sidebar', hint: 'Keep the current site as a sidebar web panel (Vivaldi-style)', icon: 'pin', action: () => SidebarManager.pinCurrentSite() },
    { id: 'editlayout', label: 'Edit Layout', hint: 'Rearrange or hide the toolbar buttons and sidebar icons in place', icon: 'puzzle', action: () => { if (typeof LayoutEditor !== 'undefined') LayoutEditor.enter(); } },
    { id: 'resmon', label: 'Resource Monitor', hint: 'Live CPU / memory per browser process', icon: 'chart-bar', action: () => ResourceMonitor.open() },
    { id: 'tabhealth', label: 'Tab Health', hint: 'Every tab by state (awake / kept-awake / sleeping) + memory + controls', icon: 'stethoscope', action: () => { if (typeof TabHealth !== 'undefined') TabHealth.open(); } },
    { id: 'siteprofiles', label: 'Site Settings', hint: 'Per-site zoom, dark mode, reader, and tweaks — all in one place', icon: 'globe', action: () => { if (typeof SiteProfiles !== 'undefined') SiteProfiles.open(); } },
    { id: 'loginshub', label: 'Logins & Codes', hint: 'Saved passwords, 2FA authenticator codes, and email-code autofill in one hub', icon: 'lock', action: () => { if (typeof LoginsHub !== 'undefined') LoginsHub.open(); } },
    { id: 'fillemailcode', label: 'Fill code from email', hint: 'Read the newest verification code from your Gmail and fill it now', icon: 'mail', action: () => { try { const wv = WebviewManager.webviews.get(TabManager.activeTabId); if (wv && typeof EmailCodeAutofill !== 'undefined') { EmailCodeAutofill.tryFill(wv, wv.getURL()); window.showToast?.('Looking for your code…'); } } catch {} } },
    { id: 'bgcodereader', label: 'Background email-code reading (toggle)', hint: 'Read verification codes from a hidden Gmail — no tab open or awake needed', icon: 'mail', action: () => { try { const on = localStorage.getItem('vex.emailCodeHiddenReader') === '1'; localStorage.setItem('vex.emailCodeHiddenReader', on ? '0' : '1'); window.showToast?.('Background code reading ' + (on ? 'turned off' : 'turned on')); } catch {} } },
    { id: 'setupgallery', label: 'Setup Gallery', hint: 'Save, share, and switch whole Vex setups (panels, shortcuts, theme) via codes', icon: 'palette', action: () => { if (typeof SetupGallery !== 'undefined') SetupGallery.open(); } },
    { id: 'pwhealth', label: 'Password Health', hint: 'Find reused, weak, or 2FA-less saved passwords — analyzed locally', icon: 'shield', action: async () => { try { await VexLazy.ensure('js/password-health.js'); PasswordHealth.open(); } catch {} } },
    { id: 'askvex', label: 'Ask Vex to do something…', hint: 'Type a request in plain English — "close all YouTube tabs", "group my shopping tabs"', icon: 'sparkles', action: () => { if (typeof AgentCommand !== 'undefined') AgentCommand.open(); } },
    { id: 'routing', label: 'Route Through Tor / Proxy', hint: 'Send this container through Tor or a custom proxy, or open a fresh Tor container', icon: 'onion', action: () => { if (typeof ContainerRouting !== 'undefined') ContainerRouting.open(); } },
    { id: 'shortcutsguide', label: 'Shortcuts & Gestures', hint: 'Cheat-sheet of every keyboard shortcut, mouse gesture, and right-click action', icon: 'keyboard', action: async () => { try { await VexLazy.ensure('js/shortcuts-guide.js'); ShortcutsGuide.open(); } catch {} } },
    { id: 'whatsnew', label: "What's New", hint: "Reopen this version's release notes", icon: 'gift', action: () => { try { window.VexWhatsNew?.open(); } catch {} } },
    { id: 'sendphone', label: 'Send to Phone', hint: 'Show a QR code of this page to open it on your phone', icon: 'phone', action: () => { try { if (window.SendToPhone) SendToPhone.open(); } catch {} } },
    { id: 'pasteandgo', label: 'Paste & Go', hint: 'Open the URL (or search) currently on your clipboard in a new tab', icon: 'clipboard', action: async () => { try { const text = ((await navigator.clipboard.readText()) || '').trim(); if (!text) { window.showToast?.('Clipboard is empty'); return; } let url; if (/^https?:\/\//i.test(text)) url = text; else if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(text)) url = 'https://' + text; else url = 'https://www.google.com/search?q=' + encodeURIComponent(text); TabManager.createTab(url, true); } catch { window.showToast?.('Clipboard access blocked'); } } },
    { id: 'duplicatetab', label: 'Duplicate Tab', hint: 'Open a copy of the current tab', icon: 'copy', action: () => { try { const t = TabManager.getActiveTab(); if (t && t.url) TabManager.createTab(t.url, true); } catch {} } },
    { id: 'copyalltabs', label: 'Copy All Tab URLs', hint: 'Copy every open tab’s URL to the clipboard', icon: 'link', action: async () => { try { const urls = (TabManager.tabs || []).map(t => t.url).filter(u => /^https?:/i.test(u)); if (!urls.length) { window.showToast?.('No tabs to copy'); return; } await navigator.clipboard.writeText(urls.join('\n')); window.showToast?.(`Copied ${urls.length} tab URL${urls.length === 1 ? '' : 's'}`); } catch {} } },
    { id: 'autorefresh', label: 'Auto-refresh This Tab', hint: 'Reload this tab on an interval — dashboards, live scores, build logs', icon: 'refresh', action: () => { try { if (window.AutoReload) AutoReload.open(); } catch {} } },
    { id: 'openasapp', label: 'Open as App', hint: 'Open this site in its own clean, chromeless window — like a desktop app', icon: 'window', action: () => { try { const t = TabManager.getActiveTab(); if (t && /^https?:/i.test(t.url || '')) window.vex.openAsApp(t.url, t.title); else window.showToast?.('Open a web page first'); } catch {} } },
    { id: 'copymarkdown', label: 'Copy Page as Markdown', hint: 'Copy this page as a Markdown link [Title](url)', icon: 'note', action: async () => { try { const t = TabManager.getActiveTab(); if (!t || !/^https?:/i.test(t.url || '')) { window.showToast?.('Open a web page first'); return; } const md = `[${(t.title || t.url).replace(/[\[\]]/g, '')}](${t.url})`; await navigator.clipboard.writeText(md); window.showToast?.('Copied as Markdown'); } catch {} } },
    { id: 'closeduplicates', label: 'Close Duplicate Tabs', hint: 'Close tabs pointing to the same page, keeping one of each', icon: 'broom', action: () => { try { TabManager.closeDuplicateTabs(); } catch {} } },
    { id: 'toolbox', label: 'Toolbox', hint: 'Your built-in tools — regex, JSON, hashes, color, word count, and more', icon: 'toolbox', action: () => { try { if (window.Toolbox) Toolbox.open(); } catch {} } },
    { id: 'jobsetup', label: 'Personalize for Your Job', hint: 'Pick your profession — Vex applies a fitting theme + the tools you use daily', icon: 'briefcase', action: () => { try { if (window.JobSetup) JobSetup.open(); } catch {} } },
    { id: 'personaswitch', label: 'Switch AI Persona (this tab)', hint: 'Pick which AI persona this tab uses — each tab can differ', icon: 'mask', action: () => { if (typeof PersonaSwitch !== 'undefined') PersonaSwitch.open(); } },
    { id: 'stickynote', label: 'Sticky Note for This Page', hint: 'A freeform note pinned to this page (per-URL)', icon: 'note', action: () => { if (typeof StickyNotes !== 'undefined') StickyNotes.open(); } },
    { id: 'stickynotes', label: 'All Sticky Notes', hint: 'Every page you\'ve left a sticky note on', icon: 'note', action: () => { if (typeof StickyNotes !== 'undefined') StickyNotes.list(); } },
    { id: 'focusflows', label: 'Focus Flows', hint: 'One-click work modes — open a tab set, set a persona, dim the UI, block sites', icon: 'target', action: () => { if (typeof FocusFlows !== 'undefined') FocusFlows.open(); } },
    { id: 'queuepodcast', label: 'Play Read-Later as Podcast', hint: 'Hands-free: Vex reads your saved articles aloud, auto-advancing', icon: 'headphones', action: () => { if (typeof QueuePodcast !== 'undefined') QueuePodcast.start(); } },
    { id: 'trackerreceipts', label: 'Tracker Receipts', hint: 'Your weekly tracker-blocking report — trend, worst trackers, who followed you', icon: 'receipt', action: () => { if (typeof TrackerReceipts !== 'undefined') TrackerReceipts.open(); } },
    { id: 'airestyle', label: 'AI Restyle This Site', hint: 'AI writes CSS to restyle the current site to a look you describe (saved as a Boost)', icon: 'palette', action: () => { if (typeof AIRestyle !== 'undefined') AIRestyle.open(); } },
    { id: 'formfill', label: 'Fill This Form', hint: 'Fill a signup/checkout form from your saved profile (name, email, address)', icon: 'receipt', action: () => { if (typeof FormFill !== 'undefined') FormFill.fill(); } },
    { id: 'burner', label: 'Burner Identity', hint: 'Throwaway off-the-record session + disposable email (optionally over Tor)', icon: 'flame', action: () => { if (typeof BurnerIdentity !== 'undefined') BurnerIdentity.open(); } },
    { id: 'linkedscroll', label: 'Linked Scrolling (split screen)', hint: 'Scroll one split pane and the others follow', icon: 'link', action: () => { if (typeof LinkedScroll !== 'undefined') LinkedScroll.toggle(); } },
    { id: 'automations', label: 'Automations', hint: 'Run an action when a page opens or at a set time — if-this-then-that', icon: 'settings', action: () => { if (typeof Automations !== 'undefined') Automations.open(); } },
    { id: 'siteidentity', label: "Show This Site's Browser Identity", hint: 'What this page sees — user-agent, Chrome brand, window.chrome, webdriver, WebGL — with a PASS/FAIL compatibility verdict that diagnoses “unsupported browser” gates', icon: 'fingerprint', action: () => { try { if (typeof SiteIdentity !== 'undefined') SiteIdentity.open(); } catch {} } },
    { id: 'privacy', label: 'Privacy Report', hint: 'Trackers blocked + fingerprint/DNS protection status', icon: 'shield', action: () => { if (typeof PrivacyPack !== 'undefined') PrivacyPack.showReport(); } },
    { id: 'apiclient', label: 'API Client', hint: 'Send HTTP requests and browse JSON responses as a tree', icon: 'send', action: () => { if (typeof JsonApiViewer !== 'undefined') JsonApiViewer.open(); } },
    { id: 'formatjson', label: 'Format JSON (this tab)', hint: 'Pretty-print the current raw-JSON page as a collapsible tree', icon: 'braces', action: () => { if (typeof JsonApiViewer !== 'undefined') JsonApiViewer.formatCurrentPage(); } },
    { id: 'responsive', label: 'Responsive Preview', hint: 'See this page side-by-side at phone / tablet / desktop widths', icon: 'phone', action: () => { const t = TabManager.getActiveTab(); if (typeof ResponsivePreview !== 'undefined') ResponsivePreview.open(t && t.url); } },
    { id: 'screenshot-code', label: 'Screenshot → Code', hint: 'Capture this page and have AI rebuild it as HTML/Tailwind/React', icon: 'image', action: () => { if (typeof ScreenshotToCode !== 'undefined') ScreenshotToCode.start(); } },
    { id: 'watch', label: 'Watch This Page', hint: 'Get alerted when this page changes (restocks, docs, status pages)', icon: 'eye', action: () => { const t = TabManager.getActiveTab(); if (t && t.url && typeof PageMonitor !== 'undefined') PageMonitor.add(t.url, t.title); } },
    { id: 'watches', label: 'Watched Pages', hint: 'Manage the pages Vex is monitoring for changes', icon: 'eye', isPrimary: true, action: () => { if (typeof PageMonitor !== 'undefined') PageMonitor.showManager(); } },
    { id: 'wayback-save', label: 'Save to Wayback Machine', hint: 'Archive this page on web.archive.org', icon: 'box', action: () => { const t = TabManager.getActiveTab(); if (t && t.url && typeof LinkRot !== 'undefined') LinkRot.saveToWayback(t.url); } },
    { id: 'wayback-view', label: 'View Archived Version', hint: 'Open the latest Wayback snapshot of this page (recover dead links)', icon: 'history', action: () => { const t = TabManager.getActiveTab(); if (t && t.url && typeof LinkRot !== 'undefined') LinkRot.viewArchived(t.url); } },
    { id: 'readfree', label: 'Read Free (bypass paywall)', hint: 'Reset a metered paywall (clear this site’s data + reload) or open a free archived copy', icon: 'newspaper', action: () => { if (typeof ReadFree !== 'undefined') ReadFree.run(); } },
    { id: 'clearsite', label: "Clear This Site's Data & Reload", hint: 'Wipe this site’s cookies, storage & cached responses and hard-reload — fixes stale “unsupported browser”, login, or paywall glitches', icon: 'broom', action: async () => { try { const t = TabManager.getActiveTab(); const wv = WebviewManager.webviews.get(TabManager.activeTabId); if (!t || !wv || !/^https?:/i.test((wv.getURL && wv.getURL()) || t.url || '')) { window.showToast?.('Open a website first'); return; } const url = (wv.getURL && wv.getURL()) || t.url; const partition = t.partition || 'persist:main'; window.showToast?.('Clearing site data…'); try { if (window.vex && window.vex.clearSiteData) await window.vex.clearSiteData({ partition, url }); } catch {} try { if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache(); else wv.reload(); } catch {} window.showToast?.('Cleared — reloading', 'success'); } catch {} } },
    { id: 'media', label: 'Download Media on Page', hint: 'Find video/audio playing on this page and save it (progressive files; copy link for HLS)', icon: 'video', action: () => { if (typeof MediaGrabber !== 'undefined') MediaGrabber.run(); } },
    { id: 'focus', label: 'Focus 25', hint: 'Hide all chrome + block distracting sites for 25 minutes (run again to stop)', icon: 'target', action: () => FocusMode.toggle(25) },
    { id: 'focus50', label: 'Focus 50', hint: 'A 50-minute focus session', icon: 'target', action: () => FocusMode.toggle(50) },
    { id: 'compact', label: 'Compact Mode', hint: 'Collapse the sidebars for maximum page space', icon: 'compress', action: () => CompactMode.toggle() },
    { id: 'readaloud', label: 'Read Aloud', hint: 'Speak this article out loud (run again to stop)', icon: 'volume', action: () => ReadAloud.toggle() },
    { id: 'copyunlock', label: 'Unlock Copy & Right-Click', hint: 'Bypass sites that block selecting, copying, or right-click on this page', icon: 'unlock', action: () => { if (typeof CopyUnlock !== 'undefined') CopyUnlock.applyNow(); } },
    { id: 'doctext', label: 'Copy Text from Doc (Google Docs / OCR)', hint: 'Extract text from Google Docs or any copy-locked page — export when possible, OCR when not', icon: 'file', action: () => { if (typeof DocExtract !== 'undefined') DocExtract.run(); } },
    { id: 'compose', label: 'AI Compose', hint: 'Let AI write or rewrite text into the focused input on the page', icon: 'edit', action: () => AICompose.open() },
    { id: 'bookmark', label: 'Bookmark This Page', hint: 'Star/unstar the current page', icon: 'star', action: () => { const t = TabManager.getActiveTab(); if (t && t.url) Bookmarks.toggle(t.url, t.title); } },
    { id: 'bookmarks', label: 'Bookmarks', hint: 'Open the bookmarks panel', icon: 'bookmark', isPrimary: true, action: () => SidebarManager.openPanel ? SidebarManager.openPanel('bookmarks') : SidebarManager.showPanel('bookmarks') },
    { id: 'feeds', label: 'Feeds (RSS)', hint: 'Open your feed reader', icon: 'newspaper', isPrimary: true, action: () => SidebarManager.openPanel ? SidebarManager.openPanel('feeds') : SidebarManager.showPanel('feeds') },
    { id: 'container-work', label: 'New Work Container Tab', hint: 'Isolated cookies — log into a second account', icon: 'archive', action: () => TabManager.createTab(START_URL, true, null, { partition: 'persist:container-work' }) },
    { id: 'container-personal', label: 'New Personal Container Tab', hint: 'Isolated cookies — log into a second account', icon: 'archive', action: () => TabManager.createTab(START_URL, true, null, { partition: 'persist:container-personal' }) },
    { id: 'container-shopping', label: 'New Shopping Container Tab', hint: 'Isolated cookies — tracked separately from your main session', icon: 'cart', action: () => TabManager.createTab(START_URL, true, null, { partition: 'persist:container-shopping' }) },
    { id: 'sendphone', label: 'Send to Phone', hint: 'Hand this tab off to your other Vex devices (needs Vex Sync)', icon: 'phone', action: async () => {
      const t = TabManager.getActiveTab();
      if (!t || !t.url) { window.showToast?.('No active page to send'); return; }
      try { await SyncEngine.dropSend(t.url, t.title || ''); window.showToast?.('Sent — it will appear on your other devices'); }
      catch (err) { window.showToast?.(err.message || 'Send failed'); }
    } },
    { id: 'close', label: 'Close Tab', hint: 'Close the current tab', shortcut: 'Ctrl+W', icon: 'x', action: () => { const t = TabManager.getActiveTab(); if (t) TabManager.closeTab(t.id); } },
    { id: 'whatsapp', label: 'WhatsApp', hint: 'Open WhatsApp panel', icon: 'message', isPrimary: true, action: () => SidebarManager.openPanel('whatsapp') },
    { id: 'claude', label: 'Claude AI', hint: 'Open Claude panel', icon: 'sparkles', isPrimary: true, action: () => SidebarManager.openPanel('claude') },
    { id: 'spotify', label: 'Spotify', hint: 'Open Spotify panel', icon: 'music', isPrimary: true, action: () => SidebarManager.openPanel('spotify') },
    { id: 'roblox', label: 'Roblox Hub', hint: 'Open Roblox panel', icon: 'gamepad', isPrimary: true, action: () => SidebarManager.openPanel('roblox') },
    { id: 'github', label: 'GitHub', hint: 'Open GitHub panel', icon: 'git', isPrimary: true, action: () => SidebarManager.openPanel('github') },
    { id: 'reload', label: 'Reload', hint: 'Reload current tab', shortcut: 'Ctrl+R', icon: 'refresh', action: () => WebviewManager.reload() },
    { id: 'hard-reload', label: 'Hard Reload', hint: 'Clear cache then reload', shortcut: 'Ctrl+Shift+R', icon: 'refresh', action: () => WebviewManager.hardReload() },
    { id: 'history-overlay', label: 'History (quick view)', hint: 'View browsing history in an overlay', icon: 'clipboard', action: () => CommandBar.showHistory() },
    { id: 'settings', label: 'Settings', hint: 'Open settings', icon: 'settings', action: () => SidebarManager.openPanel('settings') },
    { id: 'tools', label: 'Tools', hint: 'Open your tools', icon: 'wrench', action: () => CommandBar.showTools() },
    { id: 'start', label: 'Start Page', hint: 'Go to start page', icon: 'home', action: () => TabManager.createTab(START_URL, true) },
    { id: 'youtube', label: 'YouTube', hint: 'Open YouTube', icon: 'play', action: () => TabManager.createTab('https://youtube.com', true) },
    { id: 'chatgpt', label: 'ChatGPT', hint: 'Open ChatGPT', icon: 'robot', action: () => TabManager.createTab('https://chat.openai.com', true) },
    { id: 'pip', label: 'Picture-in-Picture', hint: 'Pop video into floating window', shortcut: 'Ctrl+Shift+P', icon: 'tv', action: () => { if (typeof PiPManager !== 'undefined') PiPManager.toggle(); } },
    { id: 'split', label: 'Split Screen', hint: 'Toggle split-screen view', shortcut: 'Ctrl+Shift+S', icon: 'split', action: () => SplitScreen.toggle() },
    { id: 'split3', label: 'Split into 3 panes', hint: 'Three tabs side by side', icon: 'split', action: () => SplitScreen.setLayout(3) },
    { id: 'split4', label: 'Split into 4 panes', hint: 'Four tabs in a 2×2 grid', icon: 'grid', action: () => SplitScreen.setLayout(4) },
    // Tool commands
    { id: 'flashmind', label: 'FlashMind', hint: 'AI-powered flashcard study tool', icon: 'bulb', action: () => VexTools.openToolById('flashmind') },
    { id: 'loopholemap', label: 'LoopholeMap', hint: 'Legal loophole mapper', icon: 'map', action: () => VexTools.openToolById('loopholemap') },
    { id: 'aijudge', label: 'AIJudge', hint: 'AI-powered legal judgment tool', icon: 'scale', action: () => VexTools.openToolById('aijudge') },
    { id: 'netmap', label: 'NetMap', hint: 'Network topology mapper', icon: 'globe', action: () => VexTools.openToolById('netmap') },
    { id: 'billforge', label: 'BillForge', hint: 'Legislative bill drafting tool', icon: 'hammer', action: () => VexTools.openToolById('billforge') },
    // Phase 3 commands
    { id: 'notes', label: 'Notes', hint: 'Open notes panel', shortcut: 'Ctrl+Shift+N', icon: 'note', isPrimary: true, action: () => SidebarManager.openPanel('notes') },
    { id: 'downloads', label: 'Downloads', hint: 'Open downloads panel', icon: 'download', isPrimary: true, action: () => SidebarManager.openPanel('downloads') },
    { id: 'session-save', label: 'Save Session', hint: 'Save current tabs as a session', icon: 'save', action: () => SessionManager.showOverlay() },
    { id: 'session-load', label: 'Load Session', hint: 'Restore a saved session', shortcut: 'Ctrl+Shift+O', icon: 'folder-open', action: () => SessionManager.showOverlay() },
    { id: 'workspace', label: 'Switch Workspace', hint: 'Change workspace profile', icon: 'refresh', action: () => WorkspaceManager.toggleDropdown() },
    // Phase 4 commands
    { id: 'reopen', label: 'Reopen Closed Tab', hint: 'Restore last closed tab', shortcut: 'Ctrl+Shift+T', icon: 'undo', action: () => TabManager.reopenLastClosed() },
    { id: 'history', label: 'History', hint: 'Browsing history', shortcut: 'Ctrl+H', icon: 'clock', isPrimary: true, action: () => SidebarManager.openPanel('history') },
    { id: 'memory', label: 'Memory', hint: 'Memory usage per tab', shortcut: 'Ctrl+Shift+M', icon: 'cpu', isPrimary: true, action: () => SidebarManager.openPanel('memory') },
    { id: 'sleep', label: 'Sleep Tab', hint: 'Put current tab to sleep', shortcut: 'Ctrl+Shift+Z', icon: 'sleep', action: () => { const t = TabManager.getActiveTab(); if (t) TabManager.sleepTab(t.id); } },
    { id: 'sleep-all', label: 'Sleep All Inactive', hint: 'Sleep all non-active tabs', icon: 'sleep', action: () => { TabManager.sleepAllInactive(); window.showToast?.('All inactive tabs sleeping'); } },
    { id: 'wake-all', label: 'Wake All Tabs', hint: 'Wake all sleeping tabs', icon: 'sun', action: () => { TabManager.wakeAllTabs(); window.showToast?.('All tabs awake'); } },
    // Phase 5 commands
    { id: 'read', label: 'Reading Mode', hint: 'Strip clutter, focus on article', shortcut: 'Ctrl+Alt+R', icon: 'book-open', action: () => ReadingMode.activate() },
    { id: 'translate', label: 'Translate Page', hint: 'Translate via Google Translate', icon: 'globe', action: () => { document.getElementById('translate-bar')?.classList.add('visible'); } },
    { id: 'screenshot', label: 'Screenshot', hint: 'Capture current page', shortcut: 'Ctrl+Alt+S', icon: 'camera', action: () => ScreenshotTool.capture() },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', hint: 'View all shortcuts', icon: 'keyboard', action: () => SidebarManager.openPanel('shortcuts') },
    { id: 'theme', label: 'Choose Theme', hint: 'Pick a theme (Ctrl+Shift+Y)', icon: 'palette', action: () => (typeof ThemePicker !== 'undefined' ? ThemePicker.open() : null) },
    { id: 'zoom-in', label: 'Zoom In', hint: 'Zoom in 10%', icon: 'search', action: () => WebviewManager.zoomIn() },
    { id: 'zoom-out', label: 'Zoom Out', hint: 'Zoom out 10%', icon: 'search', action: () => WebviewManager.zoomOut() },
    { id: 'zoom-reset', label: 'Reset Zoom', hint: 'Reset to 100%', icon: 'search', action: () => WebviewManager.zoomReset() },
    // Phase 6 commands
    { id: 'fullscreen', label: 'Toggle Fullscreen', hint: 'Enter/exit fullscreen', shortcut: 'F11', icon: 'maximize', action: () => window.vex.toggleFullscreen?.() },
    { id: 'private', label: 'Private Window', hint: 'Open incognito window', shortcut: 'Ctrl+Shift+N', icon: 'incognito', action: () => window.vex.openPrivateWindow?.() },
    { id: 'mute', label: 'Mute Tab', hint: 'Mute/unmute current tab', shortcut: 'Ctrl+M', icon: 'mute', action: () => TabManager.toggleMuteTab() },
    { id: 'mute-all', label: 'Mute All Others', hint: 'Mute all except active tab', icon: 'mute', action: () => TabManager.muteAllOtherTabs() },
    { id: 'pin', label: 'Pin/Unpin Tab', hint: 'Toggle pin on current tab', icon: 'pin', action: () => TabManager.togglePinTab() },
    { id: 'export-data', label: 'Export All Data', hint: 'Download all Vex data as JSON', icon: 'save', action: () => { document.getElementById('setting-export')?.click(); } },
    // Phase 7A: AI commands
    { id: 'tabs-toggle', label: 'Toggle Tabs Sidebar', hint: 'Show/hide tabs panel', shortcut: 'Ctrl+B', icon: 'sidebar', action: () => window.toggleTabsSidebar?.() },
    { id: 'ai', label: 'Vex AI', hint: 'Open AI assistant panel', shortcut: 'Ctrl+Shift+A', icon: 'sparkles', isPrimary: true, action: () => AIPanel.toggle() },
    { id: 'summarize-ai', label: 'Summarize Page', hint: 'AI summary of current page', icon: 'sparkles', action: () => { AIPanel.open(); AIPanel.sendMessage('summarize'); } },
    { id: 'translate-ai', label: 'AI Translate', hint: 'Translate page content with AI', icon: 'sparkles', action: () => { AIPanel.open(); AIPanel.sendMessage('translate', { targetLanguage: 'English' }); } },
    { id: 'compare-tabs', label: 'Compare Tabs', hint: 'AI compares all open tabs', icon: 'scale', action: () => { if(typeof TabSelector!=='undefined')TabSelector.setMode('all'); AIPanel.open(); AIPanel._sendMultiTab('Compare these tabs side-by-side.',TabManager.tabs); } },
    { id: 'summarize-tabs', label: 'Summarize All Tabs', hint: 'AI summary of every open tab', icon: 'list', action: () => { if(typeof TabSelector!=='undefined')TabSelector.setMode('all'); AIPanel.open(); AIPanel._sendMultiTab('Summarize all tabs collectively.',TabManager.tabs); } },
    { id: 'schedules', label: 'Schedules', hint: 'View scheduled AI tasks', shortcut: 'Ctrl+Shift+L', icon: 'alarm', isPrimary: true, action: () => SidebarManager.openPanel('schedules') },
    { id: 'explain-ai', label: 'Explain Selection', hint: 'AI explains selected text', icon: 'sparkles', action: async () => { const wv = WebviewManager.getActiveWebview(); const sel = wv ? await PageContext.extractSelectedText(wv) : null; if (sel) { AIPanel.open(); AIPanel.sendMessage('explain', { selectedText: sel }); } else { window.showToast?.('Select some text first'); } } },
    // Phase 12: AI history search commands
    { id: 'remember', label: 'Remember... (AI History Search)', hint: 'Find a page by meaning: "that article about DPI"', shortcut: 'Ctrl+Shift+H', icon: 'brain', isPrimary: true, action: () => HistoryPanel.openInAIMode?.() },
    { id: 'reindex', label: 'Re-index Open Tabs', hint: 'Generate AI summaries for currently open tabs', icon: 'refresh', action: () => { const n = HistoryIndexer?.reindexOpenTabs?.() || 0; window.showToast?.(n > 0 ? `Re-indexing ${n} tabs…` : 'No unindexed open tabs'); } },
    // Phase 15: personas
    { id: 'personas', label: 'Manage AI Personas', hint: 'Create, edit, export AI personas', icon: 'mask', action: () => { if (window.SettingsUI?.openSection) SettingsUI.openSection('personas-panel-content'); else SidebarManager.openPanel('settings'); } },
    { id: 'persona-new', label: 'New Persona...', hint: 'Create a custom AI assistant', icon: 'plus', action: () => { if (typeof PersonasSettings !== 'undefined') PersonasSettings.showPersonaEditor(null); } },
    { id: 'remember-fact', label: 'AI: Remember a Fact', hint: 'Tell Vex AI something to keep in mind in every chat', icon: 'brain', action: () => { if (typeof AIMemory !== 'undefined') AIMemory.promptAdd(); } },
    { id: 'ai-memory', label: 'AI Memory', hint: 'Manage the facts Vex AI remembers about you', icon: 'brain', action: () => { if (window.SettingsUI?.openSection) SettingsUI.openSection('ai-memory-panel-content'); else SidebarManager.openPanel('settings'); } },
    { id: 'ondevice-ai', label: 'On-Device AI (WebGPU)', hint: 'Download a small model that runs fully locally — private & offline', icon: 'monitor', action: () => { if (window.SettingsUI?.openSection) SettingsUI.openSection('webllm-panel-content'); else SidebarManager.openPanel('settings'); } },
    { id: 'mcp', label: 'MCP Servers & Tools', hint: 'Connect to Model Context Protocol servers and run their tools', icon: 'plug', action: () => { if (window.SettingsUI?.openSection) SettingsUI.openSection('mcp-panel-content'); else SidebarManager.openPanel('settings'); } },
    // Phase 16: tab auto-grouping
    { id: 'group-tabs', label: 'Organize My Tabs', hint: 'AI clusters open tabs into groups', shortcut: 'Ctrl+Shift+G', icon: 'tabs', isPrimary: true, action: () => TabGrouper?.analyzeAndPropose() },
    { id: 'group-undo', label: 'Undo Last Grouping', hint: 'Revert the last AI group-apply', icon: 'undo', action: () => TabGrouper?.undoLastGrouping() },
  ],

  init() {
    const overlay = document.getElementById('command-overlay');
    const input = document.getElementById('command-input');
    const results = document.getElementById('command-results');

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Input handling
    input.addEventListener('input', () => {
      this.search(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectPrev();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.executeSelected();
      }
    });
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    const overlay = document.getElementById('command-overlay');
    const input = document.getElementById('command-input');

    overlay.style.display = 'flex';
    this.isOpen = true;
    input.value = '';
    input.focus();
    this.search('');
  },

  close() {
    document.getElementById('command-overlay').style.display = 'none';
    this.isOpen = false;
    this.selectedIndex = 0;
  },

  search(query) {
    const q = query.trim().toLowerCase();
    const resultsEl = document.getElementById('command-results');
    resultsEl.innerHTML = '';

    // Handle > commands
    if (q.startsWith('>')) {
      const cmd = q.slice(1).trim();
      this.results = cmd ? this._rankCommands(cmd) : this.commands.slice();
    } else if (q === '') {
      // Recently used commands first, then the defaults.
      this.results = this._defaultResults();
    } else {
      // Mix: search + URL + commands
      this.results = [];

      // Inline calculator / converter — "12*7", "20cm to in", "10 usd to eur".
      const calc = (typeof VexCalc !== 'undefined') ? VexCalc.evaluate(q) : null;
      if (calc) {
        this.results.push({
          id: 'calc', isPrimary: !calc.unavailable, icon: 'calculator',
          label: window.escapeHtml ? window.escapeHtml(calc.text) : calc.text,
          hint: calc.unavailable ? '' : 'Press Enter to copy the result',
          action: async () => { if (calc.unavailable) return; try { await navigator.clipboard.writeText(calc.value || calc.text); window.showToast?.('Copied ' + calc.text); } catch {} },
        });
      }

      // Check if it's a URL
      if (/^https?:\/\//i.test(q) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(q)) {
        const url = q.startsWith('http') ? q : 'https://' + q;
        this.results.push({
          id: 'url',
          label: `Go to ${q}`,
          hint: url,
          icon: 'arrow-right',
          isPrimary: true,
          action: () => {
            const tab = TabManager.getActiveTab();
            if (tab && isStartPage(tab.url)) {
              WebviewManager.navigate(url);
            } else {
              TabManager.createTab(url, true);
            }
          }
        });
      }

      // Jump to an already-open tab whose title/URL matches.
      this.results.push(...this._tabResults(q));
      this.results.push(...this._toolResults(q));

      // Search action
      this.results.push({
        id: 'search',
        label: `Search "${q}"`,
        hint: 'Google Search',
        icon: 'search',
        action: () => {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
          TabManager.createTab(searchUrl, true);
        }
      });

      // (AI fallback removed — use Ctrl+J for Ask Vex AI)

      // Matching commands — fuzzy-scored, best first.
      this.results.push(...this._rankCommands(q));
    }

    this.selectedIndex = 0;
    this.renderResults();
  },

  // ---- Fuzzy matching + usage-based ranking -------------------------------

  // Score how well command `c` matches query `q` (both lowercase).
  // Tiers: label prefix > word prefix > id prefix > token match (any order) >
  // substring > hint substring > in-order subsequence ("svs" → "Save Session").
  _scoreCommand(q, c) {
    if (!q) return 0;
    const label = c.label.toLowerCase();
    const id = c.id.toLowerCase();
    const hint = (c.hint || '').toLowerCase();

    let score = 0;
    if (label.startsWith(q)) score = 100;
    else if (label.split(/\s+/).some(w => w.startsWith(q))) score = 85;
    else if (id.startsWith(q)) score = 80;
    else if (q.includes(' ') && q.split(/\s+/).filter(Boolean).every(t => label.includes(t) || hint.includes(t))) score = 70;
    else if (label.includes(q) || id.includes(q)) score = 60;
    else if (hint.includes(q)) score = 45;
    else if (q.length >= 2) {
      let from = 0, ok = true;
      for (const ch of q) {
        const idx = label.indexOf(ch, from);
        if (idx === -1) { ok = false; break; }
        from = idx + 1;
      }
      if (ok) score = 30;
    }
    return score;
  },

  // Toolbox tools as results. The catalogue is hundreds of tools, so typing
  // "bmi" or "subnet" here opens the tool itself instead of hunting for it in
  // the Toolbox window.
  _toolResults(q) {
    if (!q || typeof Toolbox === 'undefined') return [];
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const scored = [];
    for (const t of Toolbox.all()) {
      const name = t.name.toLowerCase();
      let score = 0;
      if (name.startsWith(q)) score = 92;
      else if (name.split(/\s+/).some(w => w.startsWith(q))) score = 80;
      else if (Toolbox._matches(t, q)) score = 55;   // description, keywords, family
      if (!score) continue;
      scored.push({ score, r: {
        id: 'tool:' + t.id,
        icon: Toolbox.iconMarkup(t),
        label: esc(t.name),
        hint: 'Toolbox · ' + esc(Toolbox._familyLabel(t.family)),
        action: () => {
          try { Toolbox.openTool(t.id); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        },
      } });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 6).map(e => e.r);
  },

  // Open tabs matching the query, as "switch to tab" results. Titles/URLs are
  // user content so they're escaped (renderResults uses innerHTML). Skips the
  // active tab and start pages.
  _tabResults(q) {
    if (!q || typeof TabManager === 'undefined') return [];
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    try {
      const scored = [];
      for (const t of (TabManager.tabs || [])) {
        if (t.id === TabManager.activeTabId) continue;
        if (typeof isStartPage === 'function' && isStartPage(t.url)) continue;
        const title = (t.title || '').toLowerCase();
        const url = (t.url || '').toLowerCase();
        let score = 0;
        if (title.startsWith(q)) score = 95;
        else if (title.includes(q)) score = 75;
        else if (url.includes(q)) score = 65;
        if (!score) continue;
        let host = ''; try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch {}
        const icon = t.favicon ? `<img src="${esc(t.favicon)}" style="width:16px;height:16px;border-radius:3px" alt="">` : this._icon('tabs');
        scored.push({ score, r: {
          id: 'tab:' + t.id,
          icon,
          label: esc(t.title || host || t.url || 'Tab'),
          hint: 'Switch to tab · ' + esc(host || t.url || ''),
          action: () => { try { TabManager.switchTab(t.id); } catch {} },
        } });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, 6).map(e => e.r);
    } catch { return []; }
  },

  _rankCommands(q) {
    const usage = this._usage();
    const now = Date.now();
    return this.commands
      .map(c => {
        let score = this._scoreCommand(q, c);
        if (score > 0) {
          const u = usage[c.id];
          if (u) score += Math.min(12, (u.n || 0) * 3) + ((now - (u.at || 0)) < 864e5 ? 3 : 0);
        }
        return { c, score };
      })
      .filter(e => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(e => e.c);
  },

  // Empty-query view: most recently used commands first, defaults fill the rest.
  _defaultResults() {
    const usage = this._usage();
    const recent = Object.entries(usage)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, 5)
      .map(([id]) => this.commands.find(c => c.id === id))
      .filter(Boolean);
    const rest = this.commands.filter(c => !recent.includes(c));
    return [...recent, ...rest].slice(0, 8);
  },

  USAGE_KEY: 'vex.commandUsage',
  _usage() {
    try {
      const o = JSON.parse(localStorage.getItem(this.USAGE_KEY) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch { return {}; }
  },
  _recordUsage(item) {
    // Transient entries (Go to…, Search…) aren't reusable commands.
    if (!item?.id || item.id === 'url' || item.id === 'search') return;
    const u = this._usage();
    const e = u[item.id] || { n: 0, at: 0 };
    e.n = Math.min(999, (e.n || 0) + 1);
    e.at = Date.now();
    u[item.id] = e;
    const ids = Object.keys(u);
    if (ids.length > 60) {
      ids.sort((a, b) => (u[a].at || 0) - (u[b].at || 0));
      ids.slice(0, ids.length - 60).forEach(id => delete u[id]);
    }
    try { localStorage.setItem(this.USAGE_KEY, JSON.stringify(u)); } catch {}
  },

  _execute(item) {
    this._recordUsage(item);
    this.close();
    item.action();
  },

  // An icon name from vex-icons.js as <svg>. Kept tiny so call sites read well.
  _icon(name) {
    return (typeof VexIcons !== 'undefined') ? VexIcons.svg(name, { size: 16 }) : '';
  },

  // `item.icon` is injected as markup, so it may already BE markup: tab results
  // pass an <img> favicon and a few tools pass a typographic glyph like ".*".
  // A known VexIcons name becomes its <svg>; anything else goes through
  // untouched (callers escape their own user content before it gets here).
  _iconMarkup(icon) {
    if (typeof VexIcons !== 'undefined') {
      if (VexIcons.has(icon)) return VexIcons.svg(icon, { size: 16 });
    }
    return icon || '';
  },

  renderResults() {
    const resultsEl = document.getElementById('command-results');
    resultsEl.innerHTML = '';

    if (this.results.length === 0) {
      resultsEl.innerHTML = '<div class="command-empty">No results found</div>';
      return;
    }

    this.results.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = `command-result${i === this.selectedIndex ? ' selected' : ''}`;

      el.innerHTML = `
        <div class="command-result-icon${item.isPrimary ? ' primary' : ''}">${this._iconMarkup(item.icon)}</div>
        <div class="command-result-info">
          <div class="command-result-title">${item.label}</div>
          ${item.hint ? `<div class="command-result-hint">${item.hint}</div>` : ''}
        </div>
        ${item.shortcut ? `<div class="command-result-shortcut">${item.shortcut}</div>` : ''}
      `;

      el.addEventListener('click', () => {
        this._execute(item);
      });

      el.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.updateSelection();
      });

      resultsEl.appendChild(el);
    });
  },

  selectNext() {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
    this.updateSelection();
  },

  selectPrev() {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
    this.updateSelection();
  },

  updateSelection() {
    document.querySelectorAll('.command-result').forEach((el, i) => {
      el.classList.toggle('selected', i === this.selectedIndex);
    });

    // Scroll into view
    const selected = document.querySelector('.command-result.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  },

  executeSelected() {
    if (this.results.length === 0) return;
    const item = this.results[this.selectedIndex];
    if (item) this._execute(item);
  },

  async showHistory() {
    this.close();
    // One list. The History panel and the address-bar suggestions read
    // HistoryPanel's store; this used to read the separate file-backed copy,
    // which has a different shape and a smaller cap, so the two disagreed.
    const history = (typeof HistoryPanel !== 'undefined' && HistoryPanel.list().length)
      ? HistoryPanel.list()
      : await VexStorage.loadHistory();
    this.open();
    this.results = history.slice(0, 15).map(h => ({
      id: 'hist-' + (h.id || h.visitedAt || h.time),
      label: h.title || h.url,
      hint: h.url,
      icon: 'clock',
      action: () => TabManager.createTab(h.url, true)
    }));
    this.renderResults();
  },

  showTools() {
    this.close();
    this.open();
    const tools = typeof VexTools !== 'undefined' ? VexTools.tools : [];
    this.results = tools.map(t => ({
      id: 'tool-' + t.id,
      label: t.name,
      hint: t.desc,
      icon: t.icon,
      action: () => VexTools.openTool(t)
    }));
    this.renderResults();
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { CommandBar };
