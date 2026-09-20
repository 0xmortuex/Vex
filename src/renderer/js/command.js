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
    { id: 'mail', label: 'Mail', hint: 'Your newest mail, read-only: reading here never marks it read; reply in the webmail', icon: 'mail', isPrimary: true, action: async () => { try { await window.VexMail.open(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'dictate', label: 'Dictate', shortcut: 'Ctrl+Alt+D', hint: 'Speak, and it is typed where the cursor was — Whisper on this PC, nothing sent anywhere', icon: 'mic', action: () => Dictation.toggle().catch(e => window.showToast?.(e.message, 'error')) },
    { id: 'dictation-settings', label: 'Dictation Settings', hint: 'Speech model, the language you speak, remove the downloaded model', icon: 'mic', action: () => Dictation.openSettings() },
    { id: 'do-again', label: 'Do That Again', shortcut: 'Ctrl+Alt+A', icon: 'history', isPrimary: true,
      get hint() { const c = CommandBar.lastCommand(); return c ? 'Again: ' + c.label : 'Runs the last command you used here once more'; },
      action: () => CommandBar.doAgain() },
    { id: 'new', label: 'New Tab', hint: 'Open a new tab', shortcut: 'Ctrl+T', icon: 'plus', action: () => TabManager.createTab(START_URL, true) },
    { id: 'discover', label: 'Discover — everything Vex can do', hint: 'Every feature, by category, with "show me" on the real button', icon: 'compass', isPrimary: true, action: () => { if (typeof VexDiscover !== 'undefined') VexDiscover.open(); } },
    { id: 'tour', label: 'Guide / Tour', hint: 'The interactive walkthrough of the main controls', icon: 'compass', action: () => { if (typeof VexTour !== 'undefined') VexTour.start(); } },
    { id: 'setup', label: 'Run Setup Wizard', hint: 'Set up your tools again — theme, name, weather, GitHub, AI', icon: 'wand', action: () => { if (typeof Onboarding !== 'undefined') Onboarding.start(); } },
    { id: 'peek', label: 'Peek Current Page', hint: 'Preview the active page in a floating overlay (Shift+click links to peek them)', icon: 'eye', action: () => { const t = TabManager.getActiveTab(); if (t && t.url && typeof VexPeek !== 'undefined') VexPeek.open(t.url); } },
    { id: 'zap', label: 'Zap Element', hint: 'Click any element on this page to hide it forever on this site', icon: 'zap', action: () => { if (typeof VexBoosts !== 'undefined') VexBoosts.startZapper(); } },
    { id: 'boost', label: 'Boost This Site', hint: 'Custom CSS / JS for the current site', icon: 'palette', action: () => { if (typeof VexBoosts !== 'undefined') VexBoosts.openEditor(); } },
    { id: 'morning-brief', label: 'Write my morning brief', hint: "Today's reminders, tasks, changed pages and feeds in a paragraph, at the top of the new tab — the AI runs only now", icon: 'sparkles', action: async () => {
      window.showToast?.('Writing your morning brief…');
      try { await VexToday.writeBrief(); window.showToast?.('Your brief is on the new tab page'); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not write the brief', 'error'); }
    } },
    { id: 'note-moment', label: 'Note This Moment of the Video', hint: 'A note linking back to where the video is now', icon: 'note', action: async () => {
      try {
        const text = await vexPrompt({ title: 'Note this moment', message: 'What happens here? Leave it empty for just the link.', value: '', okLabel: 'Save' });
        if (text == null) return;
        const r = await VideoChat.noteMoment(text);
        window.showToast?.('Noted ' + r.stamp + ' — in your Notes');
      } catch (e) { window.showToast?.(e.message, 'error'); }
    } },
    { id: 'music-playpause', label: 'Play or Pause the Music', hint: 'The Spotify (or other music) panel, from anywhere', icon: 'music', action: async () => { try { await PanelMedia.playPause(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'music-next', label: 'Next Track', hint: 'Skip forward in the music panel', icon: 'skip', action: async () => { try { await PanelMedia.next(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'music-prev', label: 'Previous Track', hint: 'Back a track in the music panel', icon: 'skip', action: async () => { try { await PanelMedia.previous(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'music-volume', label: 'Music Volume…', hint: 'Set the music panel’s own volume, 0 to 100', icon: 'volume', action: async () => {
      const v = await vexPrompt({ title: 'Music volume', message: 'A number from 0 to 100.', value: '70', okLabel: 'Set' });
      if (v == null) return;
      try { await PanelMedia.volume(v); } catch (e) { window.showToast?.(e.message, 'error'); }
    } },
    { id: 'overlay', label: 'Open This Page as an Overlay', hint: 'A small window that floats over your game or other apps — Esc closes it, Ctrl+Up/Down changes how see-through it is', icon: 'window', action: async () => {
      const t = TabManager.getActiveTab();
      if (!t || !/^https?:/i.test(t.url || '')) { window.showToast?.('Open the page you want floating first', 'error'); return; }
      const o = Number(localStorage.getItem('vex.overlayOpacity')) || 0.92;
      await window.vex.overlayOpen(t.url, o);
      window.showToast?.('Floating over other windows — Esc closes it, Ctrl+Up/Down changes how see-through it is, Ctrl+P stops it floating', 'info', 8000);
    } },
    { id: 'lock-vex', label: 'Lock Vex', hint: 'A PIN screen over everything until you come back — Ctrl+Alt+L', icon: 'lock', action: () => VexLock.lock() },
    { id: 'cleanwindow', label: 'Share this page in a clean window', hint: 'A private window with only this page: no bookmarks, sidebar or other tabs, streamer mode on', icon: 'eye', action: async () => {
      const t = TabManager.getActiveTab();
      if (!t || !/^https?:/i.test(t.url || '')) { window.showToast?.('Open the page you want to share first', 'error'); return; }
      await window.vex.openCleanWindow(t.url, VexGuiStyle.get());
    } },
    { id: 'readlater-next', label: 'Next from Read Later', hint: 'The oldest link you saved, in this tab — read them one at a time', icon: 'book', action: () => ReadLater.next() },
    { id: 'readlater', label: 'Read Later', hint: 'Save this page to your Library queue', icon: 'book', action: () => { const t = TabManager.getActiveTab(); if (t && t.url) ReadLater.add(t.url, t.title); } },
    { id: 'library', label: 'Library', hint: 'Read-later queue + auto-archived tabs', icon: 'book', isPrimary: true, action: () => SidebarManager.openPanel('library') },
    { id: 'save-pdf', label: 'Save Page as PDF', hint: 'Straight to a PDF file — no print dialog, no preview', icon: 'file', action: async () => { try { await window.PageExport?.savePage('pdf'); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'save-md', label: 'Save Page as Markdown', hint: 'The article itself, not the menus around it, as a .md file', icon: 'note', action: async () => { try { await PageExport.saveMarkdown(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'save-epub', label: 'Save Page as an E-book', hint: 'The article as an .epub for an e-reader', icon: 'book', action: async () => { try { await PageExport.saveEpub(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'save-page', label: 'Save Page as One File', hint: 'The whole page — text, pictures, styles — in one .mhtml that opens offline', icon: 'save', action: async () => { try { await window.PageExport?.savePage('mhtml'); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'open-links', label: 'Open a List of Links', hint: 'Paste links in any form and each opens in its own tab', icon: 'link', action: async () => { try { await window.PageExport?.promptOpenMany(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'page-images', label: 'Images on This Page', hint: 'Every picture on the page, full size, to save one or all', icon: 'image', action: async () => { try { await window.PageExport?.openImages(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'recent-checks', label: 'Recent Page Checks', hint: 'Link, speed, accessibility and crawl checks you ran, to run again and see what changed', icon: 'history', action: () => { try { window.CheckHistory?.open(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'crawl-site', label: 'Crawl This Site', hint: 'Every page of the site you are on: broken links and where they are, missing or duplicate titles, pages hidden from search', icon: 'globe', action: async () => { try { await window.SiteCrawler?.run(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'check-links', label: "Check This Page's Links", hint: 'Which links are broken, which moved — asked from an empty session so no site learns who you are', icon: 'link', action: async () => { try { await window.LinkChecker?.run(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'check-speed', label: 'Why Is This Page Slow?', hint: 'Load timings graded against Core Web Vitals, the heaviest files, oversized pictures and blocking scripts', icon: 'activity', action: async () => { try { await window.PerfCheck?.run(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'check-a11y', label: 'Check Accessibility of This Page', hint: 'Pictures with no description, unlabelled boxes, nameless buttons, faint text — outlined on the page', icon: 'eye', action: async () => { try { await window.A11yCheck?.run(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'cite', label: 'Cite This Page', hint: 'APA, MLA, Harvard, Chicago or BibTeX, from what the page says about itself', icon: 'graduation', action: async () => { try { await window.PageExport?.openCitation(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'todo', label: 'To-do List', hint: 'Every open "- [ ]" task from every note, in one list — tick them here', icon: 'check', isPrimary: true, action: () => window.OpenTasks?.open() },
    { id: 'todo-board', label: 'Task Board', hint: 'Your note tasks in To do / Doing / Done columns — drag a card, and its note changes', icon: 'check', action: () => window.OpenTasks?.openBoard() },
    { id: 'price-history', label: 'Price History', hint: 'What this product cost each time you looked, and the lowest you have seen: noted on this computer from product pages you open', icon: 'coins', action: () => { try { window.PriceHistory?.open(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'calendar', label: 'Calendar', hint: 'Your reminders and dated to-dos in a month view; add a reminder on any day', icon: 'calendar', isPrimary: true, action: async () => { try { await window.Calendar?.open(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'parcels', label: 'Parcels', hint: 'Paste a tracking number: Vex says whose it is and opens the carrier tracking page; keep a list of what you are waiting for', icon: 'box', action: () => { try { window.Parcels?.open(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'expenses', label: 'Expenses', hint: 'Log what you spent; see this month by category and against last month; export CSV', icon: 'receipt', action: () => { try { window.Expenses?.open(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'habits', label: 'Habits', hint: 'Tick off what you did today, and keep the streak going', icon: 'flame', action: () => { try { window.Habits?.open(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'todo-add', label: 'Add a To-do', hint: 'A task into your "To-do" note — end it with @tomorrow to give it a date', icon: 'plus', action: async () => { try { await window.OpenTasks?.quickAdd(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'projects', label: 'Research Projects', hint: 'Pages, notes and AI conversations about one topic, kept together', icon: 'folder', isPrimary: true, action: () => window.ResearchProjects?.open() },
    { id: 'project-quote', label: 'Add the Selected Text to Project', hint: 'The passage you highlighted, with where it came from — exported with references', icon: 'marker', action: async () => { try { await window.ResearchProjects?.addSelection(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'project-add', label: 'Add This Page to Project', hint: 'Files the page you are on under the project you are working on', icon: 'folder-open', action: async () => { try { await window.ResearchProjects?.addCurrentPage(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'project-chat', label: 'Save This Chat to Project', hint: 'Keeps the AI conversation with the research it belongs to — tabs close, projects do not', icon: 'sparkles', action: async () => { try { await window.ResearchProjects?.addCurrentChat(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'show-thinking', label: 'Show AI Thinking (On / Off)', hint: 'Watch a reasoning model think as a live line under "Thinking…" — replies get several times slower while it is on', icon: 'brain', action: () => { if (typeof AIRouter === 'undefined' || !AIRouter.setShowThinking) return; const on = AIRouter.setShowThinking(!AIRouter.showThinking()); window.showToast?.(on ? 'Show thinking on — a reasoning model will think out loud, and take longer' : 'Show thinking off — back to quick replies'); } },
    { id: 'eyedropper', label: 'Pick a Colour From the Screen', hint: 'Sample any pixel — a page, a video, another window — and copy its hex', icon: 'palette', isPrimary: true, action: async () => { try { await window.ColorPicker?.pick(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'colors', label: 'Colours You Picked', hint: 'The last colours you sampled, in hex, rgb and hsl', icon: 'palette', action: () => window.ColorPicker?.openRecent() },
    { id: 'snippets', label: 'Snippets', hint: 'Short abbreviations that become text you keep retyping — type one anywhere, press Tab', icon: 'type', isPrimary: true, action: () => window.Snippets?.openManager() },
    { id: 'clipboard-history', label: 'Clipboard History', hint: 'What you copied before the thing you copied — click one to copy it again', icon: 'clipboard', isPrimary: true, action: () => window.ClipboardHistory?.openPicker() },
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
    { id: 'sitedata', label: "Cookies & Storage for This Site", hint: 'See every cookie and stored item this site keeps, change one, or remove one — instead of clearing the lot', icon: 'shield', action: () => { try { SiteData.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'pagediff', label: 'What’s New Since I Was Last Here', hint: 'Marks the paragraphs that were not on this page last time you read it — threads, changelogs, wiki pages', icon: 'eye', isPrimary: true, action: async () => { try { await WhatsNew.run(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'pagediff-stop', label: 'Stop Marking What’s New Here', hint: 'Forget this page, and clear the marks it left', icon: 'x', action: async () => { try { await WhatsNew.stop(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'translate-side', label: 'Translate Side by Side', hint: 'Keeps the page as it is and puts the translation under each paragraph — run again to take it off', icon: 'globe', isPrimary: true, action: async () => { try { await TranslateSide.toggle(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'tabtrail', label: 'How I Got Here', hint: 'The page this tab was opened from, and the one before that — jump back to any of them', icon: 'compass', isPrimary: true, action: () => { try { TabTrail.show(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'dictionary', label: 'Double-Click a Word for Its Meaning', hint: 'Turns the dictionary on or off — with it on, double-clicking a word on any page shows what it means', icon: 'book', isPrimary: true, action: () => Dictionary.toggle() },
    { id: 'switchtoopen', label: 'Switch to a Page I Already Have Open', hint: 'Turns on or off going to the tab you already have instead of opening the same page twice', icon: 'tabs', action: () => DuplicateTabs.toggle() },
    { id: 'latency', label: 'Is It Me or the Server?', hint: 'Times your own connection and the game and chat services, and says which one is the slow part', icon: 'activity', isPrimary: true, action: async () => { try { await LatencyCheck.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'siterules', label: 'What This Site Is Allowed', hint: 'Switch JavaScript, cookies or content from other sites off for this site alone', icon: 'sliders', isPrimary: true, action: () => { try { SiteRulesUI.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'meeting', label: 'Meeting Mode', hint: 'Holds your reminders, mutes other tabs and opens a note for this meeting — run again to end it', icon: 'users', isPrimary: true, action: () => { try { MeetingMode.toggle(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'meeting-note', label: 'Note a Line in the Meeting', hint: 'Writes what was just said into the meeting note, with the time', icon: 'note', action: async () => { try { const t = await window.vexPrompt({ title: 'Note a line', label: 'What was said', okLabel: 'Add' }); if (t) MeetingMode.jot(t); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'meeting-action', label: 'Add an Action Item', hint: 'Goes into the meeting note as a task, so it turns up with your other tasks', icon: 'check', action: async () => { try { const t = await window.vexPrompt({ title: 'Action item', label: 'What needs doing', okLabel: 'Add' }); if (t) MeetingMode.action(t); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'twomodels', label: 'Ask Two Models Side by Side', hint: 'The same question to the cloud model and the one on this machine, answers next to each other', icon: 'split', isPrimary: true, action: async () => { try { const q = await window.vexPrompt({ title: 'Ask both models', label: 'Your question', okLabel: 'Ask' }); if (q) await TwoModels.run(q); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'nightaudio', label: 'Even Out the Sound (Night Mode)', hint: 'Quiet dialogue up, loud parts held down, for this site — run again to turn it off', icon: 'moon', isPrimary: true, action: async () => { try { await NightAudio.toggle(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'videonote', label: 'Note This Moment', hint: 'Writes a note about the video at the second it is on now, as a link back to that second', icon: 'note', isPrimary: true, action: async () => { try { const t = await window.vexPrompt({ title: 'Note this moment', label: 'What is happening here', okLabel: 'Save' }); if (t) await VideoNotes.note(t); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'videonotes-open', label: 'Notes on This Video', hint: 'Opens the note holding every moment you marked in this video', icon: 'book', action: async () => { try { await VideoNotes.show(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'cards-make', label: 'Make Cards from What I Highlighted', hint: 'Turns this page’s highlights into cards that come back to you on a growing spacing', icon: 'book', isPrimary: true, action: () => { try { const t = TabManager.getActiveTab(); Flashcards.addPage((t && t.url) || '', (t && t.title) || ''); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'cards-review', label: 'Go Through My Cards', hint: 'The cards due now, one at a time — got it, or not yet', icon: 'brain', isPrimary: true, action: () => { try { Flashcards.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'teach', label: 'Teach Vex This Task', hint: 'Records the clicks you make once and saves them as a task Vex can repeat without the AI', icon: 'wand', isPrimary: true, action: async () => { try { const n = await window.vexPrompt({ title: 'Teach Vex a task', message: 'Do the task once and press Done. Passwords are never recorded.', label: 'What is it called', okLabel: 'Start recording' }); if (n !== null) TeachMode.start(n); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'freegames', label: 'Free Games This Week', hint: 'What Epic and Steam are giving away to keep right now, and what is coming next', icon: 'gamepad', isPrimary: true, action: async () => { try { await FreeGames.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'clips', label: 'My Clips', hint: 'Your recordings folder, newest first — watch one in a tab, copy its path, or show it in the folder', icon: 'video', isPrimary: true, action: async () => { try { await ClipsInbox.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'treetabs', label: 'Tree Tabs (nest tabs under the one they came from)', hint: 'In the side strip, a tab opened from another sits indented under it — run again to go back to a flat list', icon: 'list', isPrimary: true, action: () => TreeTabs.toggle() },
    { id: 'triage', label: 'What My Inbox Actually Wants', hint: 'Sorts your unread mail into what wants an answer, what is worth a look, and bulk grouped by sender', icon: 'mail', isPrimary: true, action: async () => { try { await InboxTriage.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'smallmodel', label: 'Small Model for Routine Jobs', hint: 'Pick a quick local model for tab grouping, indexing and sorting, while chat and the agent keep yours', icon: 'cpu', action: async () => { try { const models = await Ollama.listModels(); if (!models || !models.length) { window.showToast?.('No local models installed — Settings › AI has the model manager', 'error'); return; } const names = models.map(m => m.name || m.model).filter(Boolean); const now = AIRouter.getSmallModel(); const pick = await window.vexPrompt({ title: 'Small model for routine jobs', message: 'Installed: ' + names.join(', ') + '. Leave it empty to use one model for everything.', label: 'Model name', value: now, okLabel: 'Use it' }); if (pick === null) return; AIRouter.setSmallModel(pick); window.showToast?.(pick.trim() ? 'Routine jobs now go to ' + pick.trim() : 'One model for everything again'); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'forget-routing', label: 'Forget What Vex Learned About My Phrasing', hint: 'Empties the corrections Vex learned from your /chat and /agent overrides', icon: 'undo', action: async () => { const n = RouteLearn.size(); if (!n) { window.showToast?.('Nothing learned yet'); return; } if (await vexConfirm({ title: 'Forget the ' + n + ' words it learned?', message: 'Vex goes back to deciding chat or task from its own rules alone.', okLabel: 'Forget them', danger: true })) { RouteLearn.forget(); window.showToast?.('Forgotten'); } } },
    { id: 'memceiling', label: 'Set the Memory Ceiling from This Machine', hint: 'Works out a ceiling from what this machine actually has, instead of the same number for everyone', icon: 'cpu', isPrimary: true, action: async () => { try { const r = await window.vex.systemMemory(); if (!r || !r.ok) { window.showToast?.((r && r.error) || 'Could not read this machine’s memory', 'error'); return; } const ok = await vexConfirm({ title: 'Set the ceiling to ' + r.ceilingMB + ' MB?', message: 'Vex sleeps idle tabs once it goes over the ceiling. Suggested because ' + r.why + '.', okLabel: 'Set it' }); if (!ok) return; const st = (await VexStorage.loadSettings()) || {}; st.memCeilingMB = r.ceilingMB; await VexStorage.saveSettings(st); TabManager.startMemoryGuard(r.ceilingMB); const sel = document.getElementById('setting-mem-ceiling'); if (sel) sel.value = String(r.ceilingMB); window.showToast?.('Ceiling set to ' + r.ceilingMB + ' MB', 'success'); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    { id: 'live', label: 'Who Is Live', hint: 'The Twitch and YouTube channels you follow, and which are streaming now — no account needed', icon: 'tv', isPrimary: true, action: async () => { try { await LiveChannels.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
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
    { id: 'record-tab', label: 'Record This Tab', hint: 'Just the page in front, no picker — Stop from the red pill', icon: 'video', action: async () => { try { await AreaRecorder.record({ what: 'tab' }); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'record-area', label: 'Record an Area', hint: 'Drag a box over part of the window and record just that', icon: 'video', action: async () => { try { await AreaRecorder.record({ what: 'area' }); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'record-gif', label: 'Record a GIF', hint: 'Drag a box, record up to 30 seconds, saved as an animated GIF for a chat or an issue', icon: 'video', action: async () => { try { await AreaRecorder.record({ what: 'area', gif: true }); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'record-screen', label: 'Record the Screen (Start / Stop)', hint: 'A screen or a window, with sound if you want it, saved as a video you can send', icon: 'video', action: async () => { try { await window.ScreenRecorder?.toggle(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'whiteboard', label: 'Whiteboard', hint: 'A blank page to sketch on: pen, highlighter, boxes, arrows, text; save or copy it as a picture', icon: 'edit', action: () => { try { ScreenshotTool.whiteboard(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'markup', label: 'Mark Up This Page', hint: 'Draw, highlight, add text, or redact private details on a picture of the page, then save or copy it', icon: 'edit', action: async () => { try { await ScreenshotTool.markUp(); } catch (e) { window.showToast?.(e.message, 'error'); } } },
    { id: 'screenshot-full', label: 'Screenshot the Whole Page', hint: 'Top to bottom in one image, not just the part on screen', icon: 'camera', action: () => ScreenshotTool.captureFull() },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', hint: 'View all shortcuts', icon: 'keyboard', action: () => SidebarManager.openPanel('shortcuts') },
    { id: 'theme', label: 'Choose Theme', hint: 'Pick a theme (Ctrl+Shift+Y)', icon: 'palette', action: () => (typeof ThemePicker !== 'undefined' ? ThemePicker.open() : null) },
    { id: 'zoom-in', label: 'Zoom In', hint: 'Zoom in 10%', icon: 'search', action: () => WebviewManager.zoomIn() },
    { id: 'zoom-out', label: 'Zoom Out', hint: 'Zoom out 10%', icon: 'search', action: () => WebviewManager.zoomOut() },
    { id: 'zoom-reset', label: 'Reset Zoom', hint: 'Reset to 100%', icon: 'search', action: () => WebviewManager.zoomReset() },
    // Phase 6 commands
    { id: 'fullscreen', label: 'Toggle Fullscreen', hint: 'Enter/exit fullscreen', shortcut: 'F11', icon: 'maximize', action: () => window.vex.toggleFullscreen?.() },
    { id: 'private', label: 'Private Window', hint: 'Open incognito window', shortcut: 'Ctrl+Shift+N', icon: 'incognito', action: () => window.vex.openPrivateWindow?.(VexGuiStyle.get()) },
    { id: 'mute', label: 'Mute Tab', hint: 'Mute/unmute current tab', shortcut: 'Ctrl+M', icon: 'mute', action: () => TabManager.toggleMuteTab() },
    { id: 'mute-all', label: 'Mute All Others', hint: 'Mute all except active tab', icon: 'mute', action: () => TabManager.muteAllOtherTabs() },
    { id: 'pin', label: 'Pin/Unpin Tab', hint: 'Toggle pin on current tab', icon: 'pin', action: () => TabManager.togglePinTab() },
    { id: 'export-data', label: 'Export All Data', hint: 'Download all Vex data as JSON', icon: 'save', action: () => { document.getElementById('setting-export')?.click(); } },
    // Phase 7A: AI commands
    { id: 'tabs-toggle', label: 'Toggle Tabs Sidebar', hint: 'Show/hide tabs panel', shortcut: 'Ctrl+B', icon: 'sidebar', action: () => window.toggleTabsSidebar?.() },
    { id: 'dev-mode', label: 'Developer mode', hint: 'Show the developer dashboard and its shortcuts', icon: 'terminal', action: () => {
      if (typeof VexDevMode === 'undefined') { window.showToast?.('Developer mode is not available in this build', 'error'); return; }
      if (!VexDevMode.toggle()) { window.showToast?.('Could not save that preference', 'error'); return; }
      window.showToast?.(VexDevMode.isOn() ? 'Developer mode on' : 'Developer mode off');
    } },
    { id: 'dev-dashboard', label: 'Developer dashboard', hint: 'Diagnostics and the quick actions for working on Vex', icon: 'terminal', action: () => {
      if (typeof VexDevMode === 'undefined') { window.showToast?.('Developer mode is not available in this build', 'error'); return; }
      if (!VexDevMode.isOn()) VexDevMode.set(true);
      VexDevMode.openDashboard();
    } },
    { id: 'ai', label: 'Vex AI', hint: 'Open AI assistant panel', shortcut: 'Ctrl+Shift+A', icon: 'sparkles', isPrimary: true, action: () => AIPanel.toggle() },
    { id: 'summarize-ai', label: 'Summarize Page', hint: 'AI summary of current page', icon: 'sparkles', action: () => { AIPanel.open(); AIPanel.sendMessage('summarize'); } },
    { id: 'translate-ai', label: 'AI Translate', hint: 'Translate page content with AI', icon: 'sparkles', action: () => { AIPanel.open(); AIPanel.sendMessage('translate', { targetLanguage: 'English' }); } },
    { id: 'compare-tabs', label: 'Compare Tabs', hint: 'AI compares all open tabs', icon: 'scale', action: () => { if(typeof TabSelector!=='undefined')TabSelector.setMode('all'); AIPanel.open(); AIPanel._sendMultiTab('Compare these tabs side-by-side.',TabManager.tabs); } },
    { id: 'summarize-tabs', label: 'Summarize All Tabs', hint: 'AI summary of every open tab', icon: 'list', action: () => { if(typeof TabSelector!=='undefined')TabSelector.setMode('all'); AIPanel.open(); AIPanel._sendMultiTab('Summarize all tabs collectively.',TabManager.tabs); } },
    { id: 'schedules', label: 'Schedules', hint: 'View scheduled AI tasks', shortcut: 'Ctrl+Shift+L', icon: 'alarm', isPrimary: true, action: () => SidebarManager.openPanel('schedules') },
    { id: 'repeat', label: 'Repeat a task', hint: 'Run a saved agent task again — the same steps, no AI, no waiting', icon: 'refresh', isPrimary: true, action: async () => {
      if (typeof AgentLoop === 'undefined' || typeof AgentLoop.macros !== 'function') { window.showToast?.('Not available in this build', 'error'); return; }
      const list = AgentLoop.macros();
      if (!list.length) { window.showToast?.('No saved tasks yet — run something as an agent, then "Save as a task" in the AI history'); return; }
      const pick = await vexPrompt({
        title: 'Repeat a task',
        message: list.map((m, i) => (i + 1) + '. ' + m.name + ' (' + m.calls.length + ' steps' + (m.runs ? ', run ' + m.runs + ' times' : '') + ')').join('\n'),
        value: '1', okLabel: 'Run it',
      });
      const chosen = list[parseInt(pick, 10) - 1];
      if (!chosen) return;
      if (typeof AIPanel !== 'undefined' && !AIPanel.isOpen()) AIPanel.toggle();
      try { await AgentLoop.runMacro(chosen.id); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not run it', 'error'); }
    } },
    { id: 'watchpage', label: 'Tell me when this page changes', hint: 'Vex checks it quietly and says when it is different — a price, a date, a build', icon: 'alarm', isPrimary: true, action: async () => {
      if (typeof PageWatch === 'undefined') { window.showToast?.('Not available in this build', 'error'); return; }
      const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      if (!tab || !/^https?:/i.test(tab.url || '')) { window.showToast?.('Open a page first', 'error'); return; }
      const what = await vexPrompt({ title: 'What should Vex watch?', message: 'Leave empty for the whole page, or give a CSS selector for one part of it (e.g. .price).', value: '', okLabel: 'Next' });
      if (what == null) return;
      const asNumber = await vexConfirm({ title: 'Watch a number?', message: 'Is this a number — a price, a count, a score? Then Vex can tell you when it moves, rather than when any word on the page changes.', okLabel: 'It is a number', cancelLabel: 'Any change' });
      let direction = 'any', target = null;
      if (asNumber) {
        const rule = await vexPrompt({ title: 'When should Vex tell you?', message: 'up · down · any · below 300 · above 300', value: 'down', okLabel: 'Next' });
        if (rule == null) return;
        const m = String(rule).trim().toLowerCase().match(/^(up|down|any|below|above)\s*([\d.]+)?$/);
        if (!m) { window.showToast?.('Say up, down, any, "below 300" or "above 300"', 'error'); return; }
        direction = m[1];
        target = m[2] ? Number(m[2]) : null;
        if ((direction === 'below' || direction === 'above') && target == null) { window.showToast?.('Give the figure too, e.g. "below 300"', 'error'); return; }
      }
      const how = await vexPrompt({ title: 'How often?', message: PageWatch.EVERY.map((e, i) => (i + 1) + '. ' + e.label).join('\n'), value: '2', okLabel: 'Watch it' });
      if (how == null) return;
      const every = (PageWatch.EVERY[parseInt(how, 10) - 1] || PageWatch.EVERY[1]).ms;
      try {
        const w = PageWatch.add({ url: tab.url, title: tab.title || tab.url, selector: what.trim(), kind: asNumber ? 'number' : 'text', every, direction, target });
        window.showToast?.('Watching — Vex will say when it changes');
        PageWatch.checkOne(w.id);                 // the first look sets the baseline
      } catch (err) { window.showToast?.((err && err.message) || 'Could not watch it', 'error'); }
    } },
    { id: 'watchgithub', label: 'Tell me when this GitHub run finishes', hint: 'Or when this repository has a new release — asked of GitHub, told on your desktop', icon: 'alarm', isPrimary: true, action: async () => {
      const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      try {
        const w = GitHubWatch.add(tab && tab.url);
        window.showToast?.('Watching the ' + GitHubWatch.describe(w) + (w.kind === 'run' ? ' — Vex tells you when it finishes' : ' — Vex tells you when there is a new one'));
        await GitHubWatch.checkDue();             // a finished run says so now; a release sets its baseline
      } catch (err) { window.showToast?.((err && err.message) || 'Could not watch it', 'error'); }
    } },
    { id: 'watches', label: 'Watched pages', hint: 'What Vex is keeping an eye on, and what it last saw', icon: 'alarm', action: async () => {
      if (typeof PageWatch === 'undefined') { window.showToast?.('Not available in this build', 'error'); return; }
      // GitHub runs and releases are listed with the pages.
      const list = [...PageWatch.list(), ...GitHubWatch.list().map(w => ({ id: w.id, github: true, title: 'GitHub: ' + GitHubWatch.describe(w), lastCheckedAt: w.lastCheckedAt, lastValue: w.last, lastError: w.error }))];
      if (!list.length) { window.showToast?.('Nothing is being watched yet — Ctrl+K → Tell me when this page changes'); return; }
      const ago = (t) => (t ? Math.round((Date.now() - t) / 60000) + ' min ago' : 'not yet');
      const pick = await vexPrompt({
        title: 'Watched pages',
        message: list.map((w, i) => (i + 1) + '. ' + w.title + (w.selector ? ' [' + w.selector + ']' : '')
          + '\n   last looked ' + ago(w.lastCheckedAt)
          + (w.lastValue != null ? ' · now ' + String(w.lastValue).slice(0, 40) : '')
          + (w.lastError ? ' · ' + w.lastError : '')).join('\n'),
        value: '', placeholder: 'a number to stop watching it', okLabel: 'Stop watching',
      });
      const chosen = list[parseInt(pick, 10) - 1];
      if (!chosen) return;
      if (chosen.github) GitHubWatch.remove(chosen.id); else PageWatch.remove(chosen.id);
      window.showToast?.('No longer watching ' + chosen.title);
    } },
    { id: 'switchenv', label: 'Switch environment', hint: 'The same path on your local server, staging or live', icon: 'code', isPrimary: true, action: async () => {
      if (typeof DevSwitch === 'undefined') { window.showToast?.('Not available in this build', 'error'); return; }
      const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      if (!tab || !/^https?:/i.test(tab.url || '')) { window.showToast?.('Open a page first', 'error'); return; }
      const options = await DevSwitch.options(tab.url);
      if (!options.length) { window.showToast?.('Nowhere to switch to yet — no dev server is running, and this site has no staging or local address set (Ctrl+K → Set environments)'); return; }
      const pick = await vexPrompt({
        title: 'Switch environment',
        message: 'Same path, another host:\n\n' + options.map((o, i) => (i + 1) + '. ' + o.label + ' — ' + o.host).join('\n'),
        value: '1', okLabel: 'Go',
      });
      const n = parseInt(pick, 10);
      const chosen = options[n - 1];
      if (!chosen) return;
      TabManager.navigateTo ? TabManager.navigateTo(chosen.url) : TabManager.createTab(chosen.url, true);
    } },
    { id: 'setenv', label: 'Set environments', hint: 'Tell Vex this site\u2019s staging and local addresses', icon: 'code', action: async () => {
      if (typeof DevSwitch === 'undefined') { window.showToast?.('Not available in this build', 'error'); return; }
      const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      if (!tab || !/^https?:/i.test(tab.url || '')) { window.showToast?.('Open a page first', 'error'); return; }
      const now = DevSwitch.groupFor(tab.url) || {};
      const staging = await vexPrompt({ title: 'Staging address', message: 'The host only, e.g. staging.example.com. Leave empty for none.', value: now.staging || '', okLabel: 'Next' });
      if (staging == null) return;
      const local = await vexPrompt({ title: 'Local address', message: 'The host only, e.g. localhost:5173. Leave empty for none.', value: now.local || '', okLabel: 'Save' });
      if (local == null) return;
      try {
        DevSwitch.remember(tab.url, { live: now.key, staging, local });
        window.showToast?.('Saved — Ctrl+K → Switch environment moves between them');
      } catch (err) { window.showToast?.((err && err.message) || 'Could not save it', 'error'); }
    } },
    { id: 'devservers', label: 'Running dev servers', hint: 'What is listening on this machine right now', icon: 'code', isPrimary: true, action: async () => {
      if (!window.vex || typeof window.vex.devPorts !== 'function') { window.showToast?.('Not available in this build', 'error'); return; }
      let servers;
      try { servers = await window.vex.devPorts(); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not look', 'error'); return; }
      if (!servers.length) { window.showToast?.('Nothing is listening on the usual dev ports'); return; }
      const pick = await vexPrompt({
        title: 'Running dev servers',
        message: servers.map((s, i) => (i + 1) + '. localhost:' + s.port + (s.guess ? ' — ' + s.guess : '')).join('\n'),
        value: '1', okLabel: 'Open',
      });
      const chosen = servers[parseInt(pick, 10) - 1];
      if (chosen) TabManager.createTab(chosen.url, true);
    } },
    { id: 'capture', label: 'Quick capture', hint: 'A box over everything for a note, a reminder or a timer — give it a hotkey in Settings › Privacy', icon: 'clipboard', isPrimary: true, action: async () => {
      if (!window.vex || typeof window.vex.captureOpen !== 'function') { window.showToast?.('Quick capture is not available in this build', 'error'); return; }
      try { await window.vex.captureOpen(); } catch (err) { window.showToast?.((err && err.message) || 'Could not open it', 'error'); }
    } },
    { id: 'tables', label: 'Copy tables as CSV', hint: 'Every table on this page, as proper CSV for a spreadsheet', icon: 'clipboard', isPrimary: true, action: async () => {
      if (typeof PageTools === 'undefined') { window.showToast?.('Page tools are not available in this build', 'error'); return; }
      let tables;
      try { tables = await PageTools.tables(); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not read this page', 'error'); return; }
      if (!tables.length) { window.showToast?.('No data tables on this page'); return; }
      const csv = tables.map((t, i) => (tables.length > 1 ? '# ' + (t.caption || 'Table ' + (i + 1)) + '\r\n' : '') + PageTools.toCsv(t.rows)).join('\r\n\r\n');
      try { await navigator.clipboard.writeText(csv); window.showToast?.(tables.length + ' table' + (tables.length === 1 ? '' : 's') + ' copied as CSV — paste into a spreadsheet'); }
      catch (err) { window.showToast?.('Could not copy: ' + ((err && err.message) || ''), 'error'); }
    } },
    { id: 'tables-note', label: 'Save tables as a note', hint: 'Every table on this page, as Markdown in your Notes', icon: 'clipboard', action: async () => {
      if (typeof PageTools === 'undefined' || typeof AgentTools === 'undefined') { window.showToast?.('Not available in this build', 'error'); return; }
      let tables;
      try { tables = await PageTools.tables(); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not read this page', 'error'); return; }
      if (!tables.length) { window.showToast?.('No data tables on this page'); return; }
      const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      const body = tables.map((t, i) => '## ' + (t.caption || 'Table ' + (i + 1)) + '\n\n' + PageTools.toMarkdown(t.rows)).join('\n\n');
      try { AgentTools.saveNote('Tables from ' + ((tab && tab.title) || 'a page'), body, tab && tab.url); window.showToast?.('Saved to Notes'); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not save it', 'error'); }
    } },
    { id: 'speed', label: 'Video speed', hint: 'How fast videos play on this site, remembered', icon: 'video', isPrimary: true, action: async () => {
      if (typeof PageTools === 'undefined') { window.showToast?.('Page tools are not available in this build', 'error'); return; }
      const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
      if (!tab || !/^https?:/i.test(tab.url || '')) { window.showToast?.('Open a page first', 'error'); return; }
      const now = PageTools.speedFor(tab.url);
      const answer = await vexPrompt({ title: 'Video speed', message: 'How fast should videos play on ' + new URL(tab.url).host + '? (0.5 to 3; 1 is normal)', value: String(now), okLabel: 'Set' });
      if (answer == null) return;
      try {
        const rate = PageTools.setSpeedFor(tab.url, parseFloat(answer));
        const n = await PageTools.applySpeed(null, tab.url, rate);
        window.showToast?.(rate === 1 ? 'Back to normal speed' : rate + '× on this site' + (n ? '' : ' — it takes effect when a video appears'));
      } catch (err) { window.showToast?.((err && err.message) || 'Could not set it', 'error'); }
    } },
    { id: 'clock', label: 'Clock', hint: 'Alarms, timers, stopwatch and a world clock', icon: 'alarm', isPrimary: true, action: () => SidebarManager.openPanel('clock') },
    { id: 'weekly-review', label: 'Weekly review', hint: 'What fired, what you saved and never read, what changed', icon: 'clipboard', action: () => {
      if (typeof VexReview === 'undefined') { window.showToast?.('The weekly review is not available in this build', 'error'); return; }
      VexReview.open();
    } },
    { id: 'remind', label: 'Remind me', hint: 'Paste a task and be reminded later', icon: 'bell', isPrimary: true, action: () => {
      if (typeof VexQuickReminder === 'undefined') { window.showToast?.('Reminders are not available in this build', 'error'); return; }
      // Any text selected in the interface is almost certainly the task, so it
      // saves a paste. The page's own selection lives in a webview and is not
      // readable from here.
      let prefill = '';
      try { prefill = String(window.getSelection?.() || '').trim().slice(0, 2000); } catch { /* no selection */ }
      VexQuickReminder.open(prefill);
    } },
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
    // Tool results come from the Toolbox packs, which load on first use.
    if (window.Toolbox && typeof Toolbox.ensurePacks === 'function') Toolbox.ensurePacks().catch(() => {});

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

      // Plain sentences: "remind me to call Dana tomorrow 9am", "timer 25 min",
      // "alarm 7am weekdays", "what time is it in Tokyo" (js/quick-commands.js).
      if (typeof VexQuickCommands !== 'undefined') {
        try { this.results.push(...VexQuickCommands.results(query)); }
        catch (err) { console.error('[Command] quick commands failed:', err); }
      }

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
      this.results.push(...this._clipResults(q));
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
        label: t.name,
        hint: 'Toolbox · ' + Toolbox._familyLabel(t.family),
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
          label: t.title || host || t.url || 'Tab',
          hint: 'Switch to tab · ' + (host || t.url || ''),
          action: () => { try { TabManager.switchTab(t.id); } catch {} },
        } });
      }
      // Tabs whose PAGE contains the words, for the one called "Order
      // confirmation" when what you remember is "refund". Ranked below a title
      // match, and never listed twice.
      if (typeof TabContentIndex !== 'undefined') {
        const already = new Set(scored.map(e => e.r.id));
        for (const hit of TabContentIndex.search(q)) {
          const id = 'tab:' + hit.tabId;
          if (already.has(id)) continue;
          const t = (TabManager.tabs || []).find(x => x.id === hit.tabId);
          if (!t || t.id === TabManager.activeTabId) continue;
          let host = ''; try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch {}
          scored.push({ score: 40 + Math.min(hit.score, 9), r: {
            id,
            icon: t.favicon ? `<img src="${esc(t.favicon)}" style="width:16px;height:16px;border-radius:3px" alt="">` : this._icon('tabs'),
            label: t.title || host || t.url || 'Tab',
            hint: 'On this page · ' + (host || t.url || ''),
            action: () => { try { TabManager.switchTab(t.id); } catch {} },
          } });
        }
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, 6).map(e => e.r);
    } catch { return []; }
  },

  // Things you copied off a page, searchable by what is in them. The point of
  // a clipboard history is the copy you made BEFORE the one you have now, so
  // typing any word from it should be enough to get it back.
  _clipResults(q) {
    if (!q || !window.ClipboardHistory || !window.ClipboardHistory.enabled()) return [];
    try {
      const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
      const needle = q.toLowerCase();
      const out = [];
      for (const item of window.ClipboardHistory.list()) {
        const text = String(item.text || '');
        const at = text.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        out.push({ score: (at === 0 ? 60 : 45) + (item.pinned ? 5 : 0), r: {
          id: 'clip:' + item.id,
          icon: this._icon(item.pinned ? 'pin' : 'clipboard'),
          label: esc(window.ClipboardHistory.preview(item, 64)),
          hint: (item.pinned ? 'Kept · ' : 'Copied · ') + (item.host || 'a page') + ' · copies it again',
          action: () => { window.ClipboardHistory.use(item.id).catch(e => window.showToast?.(e.message, 'error')); },
        } });
      }
      return out.sort((a, b) => b.score - a.score).slice(0, 5).map(e => e.r);
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
    // Strictly after every earlier stamp, so "the last command" (Do That
    // Again) is exact even for two in the same millisecond.
    e.at = Math.max(Date.now(), ...Object.values(u).map(x => (x && x.at) || 0).map(t => t + 1));
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

  // ---- do that again
  // The last command run from here, read from the usage record (which already
  // stamps each command with when it was last used) — "Do That Again" and
  // Ctrl+Alt+A run it once more. It is never itself.
  lastCommand() {
    const u = this._usage();
    const id = Object.keys(u).filter(k => k !== 'do-again' && this.commands.some(c => c.id === k))
      .sort((a, b) => (u[b].at || 0) - (u[a].at || 0))[0];
    return id ? this.commands.find(c => c.id === id) : null;
  },

  doAgain() {
    const c = this.lastCommand();
    if (!c) { window.showToast?.('Nothing to do again yet — run something from Ctrl+K first'); return false; }
    this._execute(c);
    return true;
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
          <div class="command-result-title"></div>
          ${item.hint ? '<div class="command-result-hint"></div>' : ''}
        </div>
        ${item.shortcut ? '<div class="command-result-shortcut"></div>' : ''}
      `;
      el.querySelector('.command-result-title').textContent = item.label == null ? '' : String(item.label);
      if (item.hint) el.querySelector('.command-result-hint').textContent = String(item.hint);
      if (item.shortcut) el.querySelector('.command-result-shortcut').textContent = String(item.shortcut);

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
