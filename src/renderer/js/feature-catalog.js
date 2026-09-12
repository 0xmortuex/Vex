// === Vex feature catalogue ================================================
// Every feature Vex has, in categories, so Discover can introduce them.
//
// Until now the only complete list of what this browser does lived in the
// GitHub README — which nobody reads from inside the browser. This is that
// list, in the app.
//
// An entry is deliberately THIN. Where a feature already has a Ctrl+K command,
// the entry names it (`cmd`) and Discover reads the label, shortcut and icon
// off the live command registry, so a renamed or removed command shows up here
// instead of quietly disagreeing (tests/renderer/featureCatalog.test.js fails
// on a `cmd` that no longer exists). The entry only adds what the registry
// can't know:
//
//   cat      which category it belongs to
//   name     a plainer name, when the command's label is written for a launcher
//   what     one sentence on what it is FOR — the part a new user needs
//   sel      the real control to spotlight, so "Show me" points at something
//   panel    the sidebar panel id, so a hidden panel can be switched back on
//   setting  { id } of the Settings checkbox that turns the feature on
//   keys     the shortcut, when it isn't on the command
//   manual   true when there is nothing to run — you do it with the mouse
//
// Adding a feature: add it to the README's "Every feature" list AND here.
const VexFeatures = {
  CATS: [
    { id: 'tabs',    name: 'Tabs & windows',   icon: 'tabs',      blurb: 'How Vex holds the pages you have open.' },
    { id: 'ai',      name: 'AI',               icon: 'sparkles',  blurb: 'An assistant and an agent, on your own backend — cloud, local, or on-device.' },
    { id: 'privacy', name: 'Privacy & security', icon: 'shield',  blurb: 'Blocking, isolation, Tor, and the things that follow you.' },
    { id: 'reading', name: 'Reading',          icon: 'book-open', blurb: 'Getting to the words, and getting through them.' },
    { id: 'work',    name: 'Productivity',     icon: 'clipboard', blurb: 'Notes, sessions, monitoring, automation.' },
    { id: 'media',   name: 'Media',            icon: 'video',     blurb: 'Video, audio, screen sharing, streaming services.' },
    { id: 'panels',  name: 'Sidebar panels',   icon: 'sidebar',   blurb: 'Apps and tools that live beside the page instead of in a tab.' },
    { id: 'logins',  name: 'Logins & autofill', icon: 'key',      blurb: 'Passwords, 2FA codes, and forms — filled for you.' },
    { id: 'look',    name: 'Make it yours',    icon: 'palette',   blurb: 'Themes, layout, per-site tweaks, extensions.' },
    { id: 'dev',     name: 'Developer tools',  icon: 'code',      blurb: 'For building things, not just browsing them.' },
    { id: 'data',    name: 'Sync & your data', icon: 'refresh',   blurb: 'Where your data lives and how it moves between machines.' },
    { id: 'unique',  name: 'Only in Vex',      icon: 'star',      blurb: 'Features no other browser has, built out of the parts above.' },
  ],

  ITEMS: [
    // --- Tabs & windows -------------------------------------------------
    { id: 'vertical-tabs', cat: 'tabs', name: 'Vertical or horizontal tabs', sel: '#tabs-list', manual: true,
      what: 'Your tabs down the left side instead of squeezed along the top — so a title stays readable at thirty tabs. Switch layouts in Settings → Appearance.' },
    { id: 'tab-groups', cat: 'tabs', cmd: 'group-tabs', name: 'Tab groups, sorted by AI',
      what: 'Clusters your open tabs into named, coloured groups — and remembers the pattern, so tabs you open later join the right group on their own.' },
    { id: 'tab-sleep', cat: 'tabs', cmd: 'sleep', name: 'Sleeping tabs',
      what: 'An idle tab gives its memory back and parks itself; it returns exactly where you left it, scroll position included.' },
    { id: 'tab-health', cat: 'tabs', cmd: 'tabhealth',
      what: 'Every tab by state — active, kept awake, sleeping, never loaded — with what each one is really costing you in memory.' },
    { id: 'memory-panel', cat: 'tabs', cmd: 'memory', panel: 'memory',
      what: 'Live memory per tab, measured rather than estimated, with sleep and wake on each row.' },
    { id: 'keep-awake', cat: 'tabs', name: 'Keep a tab awake', manual: true,
      what: 'Right-click a tab → keep awake, and it stays loaded no matter how long you ignore it. For a dashboard, a match, a long upload.' },
    { id: 'split', cat: 'tabs', cmd: 'split',
      what: 'Two, three or four pages side by side in one window — four lands as a 2×2 grid.' },
    { id: 'pip', cat: 'tabs', cmd: 'pip',
      what: 'Pops the video out into a small window that floats above everything else, so it keeps playing while you work.' },
    { id: 'peek', cat: 'tabs', cmd: 'peek',
      what: 'Shift-click any link to read it in a floating card without leaving the page you are on.' },
    { id: 'workspaces', cat: 'tabs', cmd: 'workspace', sel: '#workspace-switcher',
      what: 'Separate sets of tabs — Work, School, Personal — that you switch between. Closing one does not disturb the others.' },
    { id: 'wsnap', cat: 'tabs', cmd: 'wsnap',
      what: 'Go back to the tabs you had open in this workspace an hour, a day or a week ago.' },
    { id: 'sessions', cat: 'tabs', cmd: 'session-save',
      what: 'Save a named set of tabs and bring it back whenever you want. Auto-saved too, so a crash costs you nothing.' },
    { id: 'reopen', cat: 'tabs', cmd: 'reopen',
      what: 'Brings back the tab you just closed — and the one before that.' },
    { id: 'gestures', cat: 'tabs', name: 'Mouse gestures', manual: true,
      what: 'Hold the right button and flick: left goes back, right forward, down-then-right closes a tab. Ten gestures in all.' },
    { id: 'containers', cat: 'tabs', cmd: 'container-work', name: 'Container tabs',
      what: 'A tab with its own separate cookies, so you can be signed into two accounts on the same site at once. Work, Personal and Shopping are ready-made.' },
    { id: 'pinsite', cat: 'tabs', cmd: 'pinsite',
      what: 'Turns a site into a permanent sidebar panel — it stays loaded and signed in beside the page.' },
    { id: 'openasapp', cat: 'tabs', cmd: 'openasapp',
      what: 'Opens a site in a bare window with no tabs or address bar, like a desktop app.' },
    { id: 'closeduplicates', cat: 'tabs', cmd: 'closeduplicates',
      what: 'Closes the copies when you have opened the same page five times, keeping one.' },
    { id: 'apps-not-links', cat: 'tabs', name: 'Opens apps, not dead links', manual: true,
      what: 'A roblox://, spotify:, steam:, vscode: or zoommtg: link hands off to the app you already have installed instead of failing.' },

    // --- AI ---------------------------------------------------------------
    { id: 'ai-panel', cat: 'ai', cmd: 'ai', sel: '#btn-toggle-ai',
      what: 'Chat about the page you are on, a bit of text you selected, or every tab at once.' },
    { id: 'ai-router', cat: 'ai', name: 'Choose where AI runs', setting: { section: 'personas-panel-content' },
      what: 'Each AI feature can go to the cloud (your own Claude worker), to Ollama on this machine, or to a small model running inside Vex itself. Nothing is sent anywhere you did not configure.' },
    { id: 'askvex', cat: 'ai', cmd: 'askvex',
      what: 'Say what you want in plain English — "close all youtube tabs", "group my github tabs" — and it happens. Most requests are understood offline, without any AI backend at all.' },
    { id: 'agent', cat: 'ai', name: 'The agent', cmd: 'ai',
      what: 'Give it a task and it clicks and types through the page itself, showing you its plan first and asking before anything risky.' },
    { id: 'tabai', cat: 'ai', cmd: 'tabai',
      what: 'Tab management in plain English, with a list of exactly what it will close before it closes anything.' },
    { id: 'summarize', cat: 'ai', cmd: 'summarize-ai',
      what: 'The page, condensed — with Explain, Translate, and a side-by-side comparison of every tab as siblings.' },
    { id: 'selection-bar', cat: 'ai', name: 'Selection AI bar', manual: true,
      what: 'Highlight any text and a small bar appears: explain it, summarize it, translate it, or rewrite it in place.' },
    { id: 'compose', cat: 'ai', cmd: 'compose',
      what: 'Writes or rewrites straight into whatever box you are typing in — a reply, a form, a commit message.' },
    { id: 'personas', cat: 'ai', cmd: 'personaswitch',
      what: 'Different AI personalities — and a different one per tab, so research and code review do not share a voice. @mention one to switch mid-chat.' },
    { id: 'ai-memory', cat: 'ai', cmd: 'ai-memory',
      what: 'Facts you tell it once, remembered in every chat afterwards. Works on the local backend too.' },
    { id: 'skills', cat: 'ai', name: 'AI Skills', setting: { section: 'skills-panel-content' },
      what: 'Save a prompt you keep retyping; it becomes its own Ctrl+K command you can run on any page.' },
    { id: 'schedules', cat: 'ai', cmd: 'schedules', panel: 'schedules',
      what: 'Tasks that run on their own — every morning, every Monday, or on a cron expression. Including runs missed while Vex was closed.' },
    { id: 'recall', cat: 'ai', cmd: 'recall', panel: 'recall',
      what: 'Full-text search of every page you have actually read. For when you remember the sentence but not the site.' },
    { id: 'remember', cat: 'ai', cmd: 'remember',
      what: 'Finds a page by what it was about rather than what it was called — "that article about DPI".' },
    { id: 'catchup', cat: 'ai', cmd: 'catchup',
      what: 'One digest of everything new in your feeds and your read-later pile, so you can skim a morning in a minute.' },
    { id: 'screenshot-code', cat: 'ai', cmd: 'screenshot-code',
      what: 'Capture a page and get it back as HTML, Tailwind or React.' },
    { id: 'mcp', cat: 'ai', cmd: 'mcp',
      what: 'Connect Vex to Model Context Protocol servers and run their tools — the agent can use them too.' },
    { id: 'ondevice', cat: 'ai', cmd: 'ondevice-ai',
      what: 'Download a small model that runs fully inside Vex on your GPU. Private, offline, nothing installed.' },

    // --- Privacy & security ----------------------------------------------
    { id: 'adblock', cat: 'privacy', name: 'Ad & tracker blocking', setting: { id: 'setting-adblocker' },
      what: 'A real filter engine — EasyList, EasyPrivacy, uBlock lists — blocking the request and hiding what it left behind.' },
    { id: 'privacy-report', cat: 'privacy', cmd: 'privacy', panel: 'privacy',
      what: 'What was blocked, how much of it, and whether your fingerprint and DNS protection are actually on.' },
    { id: 'trackerreceipts', cat: 'privacy', cmd: 'trackerreceipts',
      what: 'A weekly report in words: who tried hardest to follow you, and which sites let them.' },
    { id: 'fingerprint', cat: 'privacy', name: 'Fingerprint protection', setting: { section: 'privacy-panel-content' },
      what: 'Randomises the canvas, WebGL and audio signals sites use to recognise your machine across visits.' },
    { id: 'doh', cat: 'privacy', name: 'DNS over HTTPS', setting: { section: 'privacy-panel-content' },
      what: 'Encrypts the part of browsing that says which sites you are visiting, so your network cannot read it.' },
    { id: 'https-only', cat: 'privacy', name: 'HTTPS-only mode', setting: { section: 'privacy-panel-content' },
      what: 'Refuses to load a page over a plain unencrypted connection.' },
    { id: 'tor', cat: 'privacy', cmd: 'tor',
      what: 'A tab routed through Tor — requests and DNS both. Vex downloads and runs Tor itself; you do not need Tor Browser.' },
    { id: 'routing', cat: 'privacy', cmd: 'routing',
      what: 'Send a whole container through Tor or your own proxy, and keep it that way.' },
    { id: 'dpi', cat: 'privacy', name: 'Censorship bypass', setting: { section: 'privacy-panel-content' },
      what: 'A local proxy that defeats DNS and SNI blocking without a VPN or admin rights, plus a stronger desync mode for stubborn blocks.' },
    { id: 'otr', cat: 'privacy', cmd: 'otr',
      what: 'A tab that keeps no history and throws its cookies away the moment you close it.' },
    { id: 'identity', cat: 'privacy', cmd: 'identity',
      what: 'A fresh session AND a fresh fingerprint — nothing carries over from anything you are signed into.' },
    { id: 'private-window', cat: 'privacy', cmd: 'private',
      what: 'A separate window that remembers nothing at all when it closes.' },
    { id: 'permissions', cat: 'privacy', name: 'Site permissions', setting: { section: 'privacy-panel-content' },
      what: 'Who got your location, mic, camera, notifications or USB — and taking it back.' },
    { id: 'clearsite', cat: 'privacy', cmd: 'clearsite',
      what: 'Wipes one site\'s cookies and storage and reloads — the cure for a stuck login or a stale "unsupported browser".' },
    { id: 'siteidentity', cat: 'privacy', cmd: 'siteidentity',
      what: 'Exactly what this page can see about your browser, with a verdict on why a site might be refusing to work.' },
    { id: 'pwhealth', cat: 'privacy', cmd: 'pwhealth',
      what: 'Finds the passwords you reused, the weak ones, and the accounts with no second factor — checked on your machine, never sent away.' },

    // --- Reading ----------------------------------------------------------
    { id: 'reading-mode', cat: 'reading', cmd: 'read',
      what: 'Strips the page down to the article — no sidebars, no popups, no newsletter box.' },
    { id: 'readaloud', cat: 'reading', cmd: 'readaloud',
      what: 'Reads the page out loud, so you can listen while doing something else.' },
    { id: 'bionic', cat: 'reading', cmd: 'bionic',
      what: 'Bolds the first part of every word, which many people find pulls their eye along faster.' },
    { id: 'speedread', cat: 'reading', cmd: 'speedread',
      what: 'Flashes the article one word at a time at a speed you choose — no eye movement at all.' },
    { id: 'readfree', cat: 'reading', cmd: 'readfree',
      what: 'Resets a metered "three free articles" paywall, or finds a free archived copy.' },
    { id: 'copyunlock', cat: 'reading', cmd: 'copyunlock',
      what: 'Re-enables selecting, copying and right-clicking on sites that switched them off.' },
    { id: 'doctext', cat: 'reading', cmd: 'doctext',
      what: 'Pulls the text out of a Google Doc or a copy-locked page — reading the characters off the screen if it has to.' },
    { id: 'translate', cat: 'reading', cmd: 'translate',
      what: 'The whole page in your language, or just the sentence you selected.' },
    { id: 'annotations', cat: 'reading', cmd: 'annotations', panel: 'annotations',
      what: 'Highlight a passage and it is still highlighted when you come back to that page months later.' },
    { id: 'accessibility', cat: 'reading', name: 'Accessibility pack', setting: { section: 'recall-panel-content' },
      what: 'A dyslexia-friendly font, colour-blind filters, and a reading ruler that follows your cursor.' },
    { id: 'zoom', cat: 'reading', cmd: 'zoom-in',
      what: 'Zoom that is remembered per site, so the one with tiny type is always readable.' },

    // --- Productivity -----------------------------------------------------
    { id: 'notes', cat: 'work', cmd: 'notes', panel: 'notes',
      what: 'Markdown notes with tags, pinning and search, beside the page instead of in another app.' },
    { id: 'stickynote', cat: 'work', cmd: 'stickynote',
      what: 'A note pinned to one specific page, which reappears every time you return to it.' },
    { id: 'clip', cat: 'work', cmd: 'clip',
      what: 'Sends the selected text into your notes with a link back to where it came from.' },
    { id: 'library', cat: 'work', cmd: 'library', panel: 'library',
      what: 'Read later — a queue of saved pages, with tabs you abandoned archived into it automatically.' },
    { id: 'bookmarks', cat: 'work', cmd: 'bookmarks', panel: 'bookmarks',
      what: 'Bookmarks in folders, with a star in the address bar.' },
    { id: 'feeds', cat: 'work', cmd: 'feeds', panel: 'feeds',
      what: 'An RSS reader in the sidebar — follow sites that still publish a feed.' },
    { id: 'history', cat: 'work', cmd: 'history', panel: 'history',
      what: 'Everywhere you have been, by day, searchable by keyword or by meaning, deletable by site or by day.' },
    { id: 'watch', cat: 'work', cmd: 'watch',
      what: 'Tells you when a page changes — a restock, a status page, a result you are waiting on.' },
    { id: 'wayback', cat: 'work', cmd: 'wayback-view',
      what: 'Opens the archived copy of a page that has gone dead, or archives one before it does.' },
    { id: 'focus', cat: 'work', cmd: 'focus',
      what: 'Hides the browser chrome and blocks the sites you lose time to, for 25 or 50 minutes.' },
    { id: 'focusflows', cat: 'work', cmd: 'focusflows',
      what: 'A named work mode: one click opens a set of tabs, switches AI persona, dims the interface and blocks distractions.' },
    { id: 'automations', cat: 'work', cmd: 'automations',
      what: 'When this, do that — when a page opens, or at a time each day, run a command or open something.' },
    { id: 'chains', cat: 'work', name: 'Command chains', setting: { section: 'chains-panel-content' }, keys: 'Ctrl+Alt+1 / 2 / 3',
      what: 'Bundle several commands into one — reading mode then read aloud — and put the first three on a shortcut.' },
    { id: 'toolbox', cat: 'work', cmd: 'toolbox',
      what: 'Over three hundred small tools that run locally: converters, regex, JSON, hashes, colour, loans, dates.' },
    { id: 'jobsetup', cat: 'work', cmd: 'jobsetup',
      what: 'Pick your profession and Vex sets a fitting theme and puts the tools that job actually uses within reach.' },
    { id: 'resmon', cat: 'work', cmd: 'resmon',
      what: 'Live CPU and memory for every process Vex is running, so you can see what is eating your machine.' },
    { id: 'downloads', cat: 'work', cmd: 'downloads', panel: 'downloads',
      what: 'Downloads you can pause, resume, cancel and retry, with the real byte counts.' },
    { id: 'sendphone', cat: 'work', cmd: 'sendphone',
      what: 'Hands the page you are on to your phone — by QR code, or straight to your other Vex if you have sync on.' },
    { id: 'queue', cat: 'work', cmd: 'queuepodcast', panel: 'queue',
      what: 'Your read-later pile read aloud as an auto-advancing playlist, with spoken introductions.' },
    { id: 'autorefresh', cat: 'work', cmd: 'autorefresh',
      what: 'Reloads a tab on a timer — live scores, a build log, a status page.' },
    { id: 'pasteandgo', cat: 'work', cmd: 'pasteandgo',
      what: 'Opens whatever URL is on your clipboard, or searches it if it is not a URL.' },

    // --- Media ------------------------------------------------------------
    { id: 'drm', cat: 'media', name: 'Netflix, Spotify, Prime and Disney+', manual: true,
      what: 'Protected video and audio play here. Most Electron-based browsers cannot do this at all.' },
    { id: 'screenshare', cat: 'media', name: 'Screen sharing with real controls', manual: true,
      what: 'When a site asks to share your screen, you choose the source, resolution up to 1440p, frame rate, whether system audio goes with it and whether the cursor shows.' },
    { id: 'media-grabber', cat: 'media', cmd: 'media',
      what: 'Finds the video or audio playing on a page and saves it.' },
    { id: 'volume', cat: 'media', name: 'Master volume', manual: true,
      what: 'One slider from 0 to 500% across every tab — including making a quiet video louder than it was mixed.' },
    { id: 'nowplaying', cat: 'media', name: 'Now Playing', manual: true,
      what: 'Whatever is making sound, in one place, with the controls for it.' },
    { id: 'mute', cat: 'media', cmd: 'mute',
      what: 'Silence one tab, or every tab except this one.' },
    { id: 'screenshot', cat: 'media', cmd: 'screenshot',
      what: 'Capture the visible page, the whole scrolling page, or a region you drag — then annotate it.' },
    { id: 'qr', cat: 'media', cmd: 'qr',
      what: 'A QR code of this page, to open it on your phone without typing anything.' },
    { id: 'codecfixes', cat: 'media', name: 'Site and codec fixes', manual: true,
      what: 'Quiet repairs that ship on by default: Spotify DRM, TikTok and Instagram video, Discord staying connected, Google sign-in not calling Vex insecure.' },

    // --- Sidebar panels ---------------------------------------------------
    { id: 'panel-whatsapp', cat: 'panels', cmd: 'whatsapp', panel: 'whatsapp',
      what: 'WhatsApp beside the page, staying signed in, with unread counts on its icon.' },
    { id: 'panel-claude', cat: 'panels', cmd: 'claude', panel: 'claude',
      what: 'Claude in the sidebar — right-click the icon to switch it to Gemini or ChatGPT instead.' },
    { id: 'panel-spotify', cat: 'panels', cmd: 'spotify', panel: 'spotify',
      what: 'Spotify in the sidebar, playing while you browse.' },
    { id: 'panel-discord', cat: 'panels', name: 'Discord panel', panel: 'discord',
      what: 'Discord beside the page, with a fix that keeps it connected and optional Vencord support.' },
    { id: 'panel-roblox', cat: 'panels', cmd: 'roblox', panel: 'roblox',
      what: 'Roblox in its own session, with the censorship bypass if your network blocks it.' },
    { id: 'panel-github', cat: 'panels', cmd: 'github', panel: 'github',
      what: 'Your GitHub, one click away.' },
    { id: 'panel-netflix', cat: 'panels', name: 'Netflix panel', panel: 'netflix',
      what: 'Netflix in the sidebar — right-click the icon to switch it to Prime Video or Disney+.' },
    { id: 'panel-authenticator', cat: 'panels', name: 'Authenticator', panel: 'authenticator',
      what: 'Your 2FA codes, generated here, with a ring showing how long each one has left.' },
    { id: 'pinsite2', cat: 'panels', cmd: 'pinsite', name: 'Pin any site as a panel',
      what: 'Any site at all can become one of these — it keeps its own session and its own unread badge.' },

    // --- Logins & autofill ------------------------------------------------
    { id: 'passwords', cat: 'logins', cmd: 'loginshub',
      what: 'A password vault encrypted by Windows itself, that offers to save a login and fills it when you come back.' },
    { id: 'totp', cat: 'logins', name: '2FA codes, filled in', cmd: 'loginshub',
      what: 'Vex generates your six-digit code and types it into the 2FA screen for you.' },
    { id: 'emailcode', cat: 'logins', cmd: 'fillemailcode',
      what: 'Reads the verification code out of your Gmail and fills it — even with no Gmail tab open.' },
    { id: 'formfill', cat: 'logins', cmd: 'formfill',
      what: 'One saved profile fills any signup or checkout form. Card numbers are never stored.' },

    // --- Make it yours ----------------------------------------------------
    { id: 'themes', cat: 'look', cmd: 'theme',
      what: 'Thirty-five themes, and the whole interface follows — including the new tab page.' },
    { id: 'guistyle', cat: 'look', name: 'Browser looks', setting: { section: 'boosts-panel-content' },
      what: 'Wear a different browser: Chrome, Firefox, Safari, Internet Explorer on XP, or Netscape on 98 — each with its own sidebar behaviour.' },
    { id: 'editlayout', cat: 'look', cmd: 'editlayout',
      what: 'Drag any toolbar button or sidebar icon somewhere else, or hide it. Presets for Default, Essentials and Minimal.' },
    { id: 'siteprofiles', cat: 'look', cmd: 'siteprofiles',
      what: 'Per-site zoom, forced dark mode and your own tweaks, remembered for that site only.' },
    { id: 'boost', cat: 'look', cmd: 'boost',
      what: 'Your own CSS or JavaScript on a site — permanently.' },
    { id: 'zap', cat: 'look', cmd: 'zap',
      what: 'Click anything you never want to see on that site again, and it is gone for good.' },
    { id: 'airestyle', cat: 'look', cmd: 'airestyle',
      what: 'Describe a look — "declutter", "match my dark theme" — and the AI writes the CSS, saved as a per-site Boost.' },
    { id: 'setupgallery', cat: 'look', cmd: 'setupgallery',
      what: 'Save your whole setup as a code you can paste on another machine, or hand to someone else.' },
    { id: 'startpage', cat: 'look', cmd: 'start',
      what: 'A start page with your name, the weather, your GitHub activity, a daily verse or quote, and your own shortcuts.' },
    { id: 'shortcuts', cat: 'look', cmd: 'shortcuts',
      what: 'Rebind any keyboard shortcut to whatever you actually press.' },
    { id: 'extensions', cat: 'look', name: 'Chrome extensions', setting: { section: 'extensions-panel-content' },
      what: 'Install extensions from a folder, a .zip or a .crx. The manager says honestly which parts of an extension Vex can run.' },
    { id: 'tools-bar', cat: 'look', cmd: 'tools', sel: '#tools-bar',
      what: 'Pin any web app to the sidebar as a one-click button of your own.' },

    // --- Developer --------------------------------------------------------
    { id: 'apiclient', cat: 'dev', cmd: 'apiclient',
      what: 'Send HTTP requests and read the JSON back as a tree, without leaving the browser.' },
    { id: 'formatjson', cat: 'dev', cmd: 'formatjson',
      what: 'Turns a wall of raw JSON into something you can fold and read.' },
    { id: 'responsive', cat: 'dev', cmd: 'responsive',
      what: 'The same page at phone, tablet and desktop width, side by side.' },
    { id: 'devtools', cat: 'dev', name: 'DevTools', keys: 'F12', manual: true,
      what: 'The full Chromium developer tools, on the page you are looking at.' },

    // --- Sync & data ------------------------------------------------------
    { id: 'sync', cat: 'data', name: 'Vex Sync', setting: { section: 'sync-panel-content' },
      what: 'Tabs, bookmarks, history and settings on every machine you use, encrypted on your device before it leaves. Your server, your key.' },
    { id: 'export', cat: 'data', cmd: 'export-data',
      what: 'Everything Vex has stored about you, as one JSON file you can read.' },
    { id: 'whatsnew', cat: 'data', cmd: 'whatsnew',
      what: 'What changed in this version, and every version before it.' },
    { id: 'updates', cat: 'data', name: 'Automatic updates', setting: { section: 'sync-panel-content' },
      what: 'Vex updates itself and tells you what it changed.' },

    // --- Only in Vex ------------------------------------------------------
    { id: 'burner', cat: 'unique', cmd: 'burner',
      what: 'One click for a throwaway identity: a session that forgets everything, opened on a disposable email site, optionally over Tor. Sign up for something without it coming back to you.' },
    { id: 'leakcanary', cat: 'unique', name: 'Leak Canary', setting: { section: 'privacy-panel-content' },
      what: 'Warns you when one of your own saved email addresses turns up pre-filled on a site you never gave it to — a tracker caught in the act.' },
    { id: 'receipts2', cat: 'unique', cmd: 'trackerreceipts', name: 'Tracker Receipts',
      what: 'Your week in tracking, written as a report rather than a number: who followed you, from where, and how the trend is moving.' },
    { id: 'flows2', cat: 'unique', cmd: 'focusflows', name: 'Focus Flows',
      what: 'Composable work modes — tabs, persona, interface and blocking, all switched by one click.' },
    { id: 'podcast2', cat: 'unique', cmd: 'queuepodcast', name: 'Read-later as a podcast',
      what: 'Your saved articles, read aloud as a playlist that advances itself. Hands free.' },
    { id: 'restyle2', cat: 'unique', cmd: 'airestyle', name: 'AI Restyle',
      what: 'Redesign any website by describing what you want.' },
    { id: 'linkedscroll', cat: 'unique', cmd: 'linkedscroll',
      what: 'In split screen, scroll one pane and the others keep pace — for comparing two versions of the same thing.' },
    { id: 'stickynotes2', cat: 'unique', cmd: 'stickynotes', name: 'Sticky notes per page',
      what: 'Notes that belong to a URL rather than to a notebook, and come back when you do.' },
    { id: 'automations2', cat: 'unique', cmd: 'automations', name: 'Browser automations',
      what: 'If-this-then-that for browsing, running entirely on your machine.' },
    { id: 'formfill2', cat: 'unique', cmd: 'formfill', name: 'Universal form fill',
      what: 'One profile that fills any form on any site — and never touches card numbers.' },
  ],

  // Everything in one category.
  byCat(catId) { return this.ITEMS.filter(f => f.cat === catId); },

  get(id) { return this.ITEMS.find(f => f.id === id) || null; },

  // The Ctrl+K command an entry points at, or null. Read live so a renamed
  // command shows up rather than being duplicated here.
  command(item) {
    if (!item || !item.cmd) return null;
    const list = (typeof CommandBar !== 'undefined' && CommandBar.commands) || [];
    return list.find(c => c.id === item.cmd) || null;
  },

  // The name to show: the entry's own, else the command's label.
  nameOf(item) {
    if (!item) return '';
    if (item.name) return item.name;
    const cmd = this.command(item);
    return (cmd && cmd.label) || item.id;
  },

  // The shortcut to show, if any.
  keysOf(item) {
    if (!item) return '';
    if (item.keys) return item.keys;
    const cmd = this.command(item);
    return (cmd && cmd.shortcut) || '';
  },

  iconOf(item) {
    const cmd = this.command(item);
    if (cmd && cmd.icon) return cmd.icon;
    const cat = this.CATS.find(c => c.id === item.cat);
    return (cat && cat.icon) || 'star';
  },

  // Is this feature switched off or hidden right now? Returns null when the
  // question doesn't apply, else { reason, enable } — `enable` turns it on.
  // A feature you cannot see is a feature you cannot discover, which is the
  // whole problem Discover exists to solve, so these stay listed and offer
  // to switch themselves on.
  offState(item) {
    if (!item) return null;
    if (item.panel) {
      let ov = {};
      try { ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}') || {}; } catch { ov = {}; }
      if (ov[item.panel] && ov[item.panel].hidden) {
        return {
          reason: 'This panel is hidden on your sidebar',
          enable: () => {
            if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
            SidebarManager.setPanelOverride(item.panel, { hidden: false });
          },
        };
      }
    }
    if (item.setting && item.setting.id) {
      const box = document.getElementById(item.setting.id);
      if (box && box.type === 'checkbox' && !box.checked) {
        return {
          reason: 'This is switched off in Settings',
          enable: () => { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); },
        };
      }
    }
    return null;
  },

  // Has this feature ever been used? Read from the two records the app
  // already keeps: the command bar's own usage counts and the sidebar's
  // per-panel timestamps.
  //
  // "Never" is a floor, not a certainty: the command bar keeps only the 60
  // most recent ids, so something used once a year ago may have been evicted.
  // Discover says "no record of you using these", not "you never have".
  used(item) {
    if (!item) return false;
    if (item.cmd) {
      try {
        const u = JSON.parse(localStorage.getItem('vex.commandUsage') || '{}') || {};
        if (u[item.cmd] && u[item.cmd].n > 0) return true;
      } catch { /* unreadable store: fall through to the panel record */ }
    }
    if (item.panel) {
      try {
        const p = JSON.parse(localStorage.getItem('vex.panelUsage') || '{}') || {};
        if (p[item.panel]) return true;
      } catch { /* unreadable store */ }
    }
    return false;
  },

  // Everything with no record of use, in catalogue order.
  unused() { return this.ITEMS.filter(f => !this.used(f)); },

  // Search across name, description, category and shortcut.
  search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return this.ITEMS.slice();
    const words = q.split(/\s+/).filter(Boolean);
    const hay = (f) => [this.nameOf(f), f.what, f.cat, this.keysOf(f),
      (this.command(f) || {}).label, (this.command(f) || {}).hint].join(' ').toLowerCase();
    return this.ITEMS.filter(f => { const h = hay(f); return words.every(w => h.includes(w)); });
  },
};

if (typeof window !== 'undefined') window.VexFeatures = VexFeatures;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFeatures };
