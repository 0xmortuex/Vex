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
    { id: 'find-in-page', cat: 'reading', name: 'Find on this page', keys: 'Ctrl+F', manual: true,
      phrases: 'find search on the page look for a word ctrl f',
      what: 'Press Ctrl+F to find a word on the page you are reading, with every match counted.' },
    { id: 'search-engine', cat: 'look', name: 'Which search engine', setting: { id: 'setting-search-engine' },
      phrases: 'search engine google duckduckgo bing brave default search',
      what: 'Which search engine the address bar uses — Google, DuckDuckGo, Brave or Bing.' },
    { id: 'consent-banners', cat: 'privacy', name: 'Cookie banners, refused', setting: { id: 'setting-consent' },
      phrases: 'cookie banner consent popup accept cookies gdpr',
      what: 'The "we value your privacy" boxes are answered with the most private choice and taken off the page.' },
    { id: 'memory-saver', cat: 'tabs', name: 'Memory saver', setting: { id: 'setting-memory-saver' },
      phrases: 'less memory ram slow computer memory saver',
      what: 'Chromium\u2019s own memory saving, on Vex\u2019s terms: idle tabs give their memory back.' },
    // --- Tabs & windows -------------------------------------------------
    { id: 'vertical-tabs', phrases: 'tabs on the side vertical tabs too many tabs', cat: 'tabs', name: 'Vertical or horizontal tabs', sel: '#tabs-list', manual: true,
      what: 'Your tabs down the left side instead of squeezed along the top — so a title stays readable at thirty tabs. Switch layouts in Settings → Appearance.' },
    { id: 'tab-groups', phrases: 'group tabs organise tabs tidy tabs', cat: 'tabs', cmd: 'group-tabs', name: 'Tab groups, sorted by AI',
      what: 'Clusters your open tabs into named, coloured groups — and remembers the pattern, so tabs you open later join the right group on their own.' },
    { id: 'tab-sleep', phrases: 'less memory ram sleep idle tabs', cat: 'tabs', cmd: 'sleep', name: 'Sleeping tabs',
      what: 'An idle tab gives its memory back and parks itself; it returns exactly where you left it, scroll position included.' },
    { id: 'tab-health', cat: 'tabs', cmd: 'tabhealth',
      what: 'Every tab by state — active, kept awake, sleeping, never loaded — with what each one is really costing you in memory.' },
    { id: 'memory-panel', phrases: 'less memory ram slow heavy usage', cat: 'tabs', cmd: 'memory', panel: 'memory',
      what: 'Live memory per tab, measured rather than estimated, with sleep and wake on each row.' },
    { id: 'tasks', phrases: 'task manager end task what is using my memory processes kill', cat: 'tabs', cmd: 'tasks', name: 'Running tasks',
      what: 'Every process Vex is running, biggest first, named — and a button to end one, or keep it off for an hour, eight hours, or until you let it back. Right-click any tab or panel → “What is this using?”.' },
    { id: 'keep-awake', cat: 'tabs', name: 'Keep a tab awake', manual: true,
      what: 'Right-click a tab → keep awake, and it stays loaded no matter how long you ignore it. For a dashboard, a match, a long upload.' },
    { id: 'split', phrases: 'side by side two pages at once compare split screen two windows', cat: 'tabs', cmd: 'split',
      what: 'Two, three or four pages side by side in one window — four lands as a 2×2 grid.' },
    { id: 'pip', phrases: 'small window floating video corner picture in picture watch while working', cat: 'tabs', cmd: 'pip',
      what: 'Pops the video out into a small window that floats above everything else, so it keeps playing while you work.' },
    { id: 'peek', cat: 'tabs', cmd: 'peek',
      what: 'Shift-click any link to read it in a floating card without leaving the page you are on.' },
    { id: 'workspaces', phrases: 'work personal separate profiles switch context', cat: 'tabs', cmd: 'workspace', sel: '#workspace-switcher',
      what: 'Separate sets of tabs — Work, School, Personal — that you switch between. Closing one does not disturb the others.' },
    { id: 'wsnap', cat: 'tabs', cmd: 'wsnap',
      what: 'Go back to the tabs you had open in this workspace an hour, a day or a week ago.' },
    { id: 'sessions', cat: 'tabs', cmd: 'session-save',
      what: 'Save a named set of tabs and bring it back whenever you want. Auto-saved too, so a crash costs you nothing.' },
    { id: 'reopen', cat: 'tabs', cmd: 'reopen',
      what: 'Brings back the tab you just closed — and the one before that.' },
    { id: 'gestures', cat: 'tabs', name: 'Mouse gestures', manual: true,
      what: 'Hold the right button and flick: left goes back, right forward, down-then-right closes a tab. Ten gestures in all.' },
    { id: 'containers', phrases: 'two accounts multiple accounts separate logins work and personal', cat: 'tabs', cmd: 'container-work', name: 'Container tabs',
      steps: [
        { sel: '#btn-command', title: 'Open the command bar', html: 'Press <kbd>Ctrl</kbd>+<kbd>K</kbd> and type “container”.' },
        { sel: '#top-tab-bar', title: 'A tab with its own cookie jar', html: 'The new tab is in a container: its logins are separate, so you can be signed into two accounts on one site at once. The tab is marked with the container’s colour.' },
      ],
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
    { id: 'ai-panel', phrases: 'ask ai chat assistant summarise summarize', cat: 'ai', cmd: 'ai', sel: '#btn-toggle-ai',
      what: 'Chat about the page you are on, a bit of text you selected, or every tab at once.' },
    { id: 'ai-router', cat: 'ai', name: 'Choose where AI runs', setting: { section: 'personas-panel-content' },
      what: 'Each AI feature can go to the cloud (your own Claude worker), to Ollama on this machine, or to a small model running inside Vex itself. Nothing is sent anywhere you did not configure.' },
    { id: 'askvex', cat: 'ai', cmd: 'askvex',
      what: 'Say what you want in plain English — "close all youtube tabs", "group my github tabs" — and it happens. Most requests are understood offline, without any AI backend at all.' },
    { id: 'agent', phrases: 'do it for me automate click for me', cat: 'ai', name: 'The agent', cmd: 'ai',
      steps: [
        { sel: '#btn-toggle-ai', title: 'Open the AI panel', html: 'The agent lives here. Click to open it (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>).' },
        { sel: '#ai-input', title: 'Say what you want done', html: 'Write the job, not the clicks: “find the cheapest flight to Rome next month and save a note”. Vex works out the steps.' },
        { sel: '#ai-send', title: 'Send it', html: 'The agent shows each step as it goes. You can stop it at any point, and it asks before anything that spends money or sends a message.' },
      ],
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
    { id: 'ondevice', phrases: 'offline ai local ai no internet ai', cat: 'ai', cmd: 'ondevice-ai',
      what: 'Download a small model that runs fully inside Vex on your GPU. Private, offline, nothing installed.' },

    // --- Privacy & security ----------------------------------------------
    { id: 'adblock', phrases: 'ads adverts advertising popups pop-ups banners youtube ads block ads stop ads adblock ublock', cat: 'privacy', name: 'Ad & tracker blocking', setting: { id: 'setting-adblocker' },
      what: 'A real filter engine — EasyList, EasyPrivacy, uBlock lists — blocking the request and hiding what it left behind.' },
    { id: 'privacy-report', cat: 'privacy', cmd: 'privacy', panel: 'privacy',
      what: 'What was blocked, how much of it, and whether your fingerprint and DNS protection are actually on.' },
    { id: 'trackerreceipts', cat: 'privacy', cmd: 'trackerreceipts',
      what: 'A weekly report in words: who tried hardest to follow you, and which sites let them.' },
    { id: 'fingerprint', cat: 'privacy', name: 'Fingerprint protection', setting: { section: 'privacy-panel-content' },
      what: 'Randomises the canvas, WebGL and audio signals sites use to recognise your machine across visits.' },
    { id: 'doh', cat: 'privacy', name: 'DNS over HTTPS', setting: { section: 'privacy-panel-content' },
      what: 'Encrypts the part of browsing that says which sites you are visiting, so your network cannot read it.' },
    { id: 'https-only', phrases: 'https secure connection insecure http', cat: 'privacy', name: 'HTTPS-only mode', setting: { section: 'privacy-panel-content' },
      what: 'Refuses to load a page over a plain unencrypted connection.' },
    { id: 'tor', phrases: 'hide my ip anonymous onion vpn hide location', cat: 'privacy', cmd: 'tor',
      what: 'A tab routed through Tor — requests and DNS both. Vex downloads and runs Tor itself; you do not need Tor Browser.' },
    { id: 'routing', cat: 'privacy', cmd: 'routing',
      what: 'Send a whole container through Tor or your own proxy, and keep it that way.' },
    { id: 'dpi', cat: 'privacy', name: 'Censorship bypass', setting: { section: 'privacy-panel-content' },
      what: 'A local proxy that defeats DNS and SNI blocking without a VPN or admin rights, plus a stronger desync mode for stubborn blocks.' },
    { id: 'otr', cat: 'privacy', cmd: 'otr',
      what: 'A tab that keeps no history and throws its cookies away the moment you close it.' },
    { id: 'identity', cat: 'privacy', cmd: 'identity',
      what: 'A fresh session AND a fresh fingerprint — nothing carries over from anything you are signed into.' },
    { id: 'private-window', phrases: 'incognito private porn no history secret', cat: 'privacy', cmd: 'private',
      what: 'A separate window that remembers nothing at all when it closes.' },
    { id: 'permissions', phrases: 'camera microphone location permission allow block site', cat: 'privacy', name: 'Site permissions', setting: { section: 'privacy-panel-content' },
      what: 'Who got your location, mic, camera, notifications or USB — and taking it back.' },
    { id: 'clearsite', phrases: 'clear cookies clear cache site data', cat: 'privacy', cmd: 'clearsite',
      what: 'Wipes one site\'s cookies and storage and reloads — the cure for a stuck login or a stale "unsupported browser".' },
    { id: 'sitedata', phrases: 'cookie editor edit cookie remove one cookie local storage session storage what a site stores', cat: 'privacy', cmd: 'sitedata', name: 'Cookies and storage for this site',
      what: 'Every cookie and stored item one site keeps, listed one by one — change a value or remove a single one, instead of clearing everything.' },
    { id: 'pagediff', phrases: 'what changed since last visit new on this page new replies new since I read it', cat: 'reading', cmd: 'pagediff', name: 'What is new since your last visit',
      what: 'Marks the paragraphs that were not on this page the last time you read it — a thread, a changelog, a wiki page. Only for pages you ask about, and only hashes are kept, never the text.' },
    { id: 'translate-side', phrases: 'translate side by side both languages original and translation learn a language', cat: 'reading', cmd: 'translate-side', name: 'Translate side by side',
      what: 'Leaves the page where it is and puts the translation under each paragraph, so you can read both at once. Run it again to take the translation off.' },
    { id: 'tabtrail', phrases: 'where did this tab come from how did I get here which page opened this tab', cat: 'tabs', cmd: 'tabtrail', name: 'How I got here',
      what: 'The chain of pages that led to this tab — the page it was opened from, and the one before that. A hop still open switches to it; a closed one opens again.' },
    { id: 'dictionary', phrases: 'what does this word mean dictionary definition look up a word double click word', cat: 'reading', cmd: 'dictionary', name: 'Double-click a word for its meaning',
      what: 'With it on, double-clicking any word on a page shows what it means beside it. Off until you ask for it, and the word is looked up by Vex, not by the site.' },
    { id: 'switchtoopen', phrases: 'same page twice duplicate tabs already open switch to the tab', cat: 'tabs', cmd: 'switchtoopen', name: 'Switch to a page you already have open',
      what: 'Opening a page that is already open in this container goes to that tab instead of making a second copy. Duplicate Tab and reopening a closed tab still give you a copy.' },
    { id: 'latency', phrases: 'lag ping is my internet slow server down discord steam riot latency', cat: 'unique', cmd: 'latency', name: 'Is it me or the server',
      what: 'Times your own connection against Discord, Steam, Riot, Roblox, Epic and YouTube, and says in one sentence whether the slow part is your line or theirs.' },
    { id: 'siterules', phrases: 'turn off javascript for this site block cookies block third party content per site switches', cat: 'privacy', cmd: 'siterules', name: 'What this site is allowed',
      what: 'Three switches for one site: JavaScript, cookies, and content loaded from other hosts. Off means off for every page of that site, until you switch it back.' },
    { id: 'meeting', phrases: 'meeting call notes action items mute notifications during a call', cat: 'work', cmd: 'meeting', name: 'Meeting mode',
      what: 'Holds your reminders, mutes every other tab making a sound, and opens a note with the time on it. Lines you type go in with their time; action items become tasks.' },
    { id: 'tabmentions', phrases: 'ask about another tab mention a tab in the ai box at sign compare two tabs', cat: 'ai', name: 'Name a tab with @', sel: '#ai-input', manual: true,
      what: 'Type @ in the AI box and pick an open tab by name to include it in the question — the same list also holds your personas.' },
    { id: 'twomodels', phrases: 'compare models two models at once local versus cloud which model is better', cat: 'ai', cmd: 'twomodels', name: 'Ask two models side by side',
      what: 'The same question put to the cloud model and the one running on this machine at once, with both answers next to each other. Keep either one and the chat carries on from it.' },
    { id: 'chatfile', phrases: 'chat with a pdf ask about a file drop a file read my document local file', cat: 'ai', name: 'Ask about a file on your machine', sel: '#ai-panel', manual: true,
      what: 'Drop a PDF or a text file on the AI panel and ask about it. The words are read on this machine and go with your question; the file itself is not uploaded anywhere.' },
    { id: 'nightaudio', phrases: 'quiet dialogue loud explosions even out the volume night mode watching late', cat: 'media', cmd: 'nightaudio', name: 'Even out the sound',
      what: 'Brings quiet dialogue up and holds loud parts down on this site, so a film at night does not need a hand on the volume. Remembered per site.' },
    { id: 'videonote', phrases: 'note a moment in a video timestamp note lecture notes mark this second', cat: 'media', cmd: 'videonote', name: 'Note a moment in a video',
      what: 'Writes a note about the video at the second it is on now, as a link back to that second. One note per video, so a talk’s notes are one page.' },
    { id: 'cards', phrases: 'flashcards revision study spaced repetition remember what I read highlights into cards', cat: 'reading', cmd: 'cards-review', name: 'Cards from your highlights',
      what: 'Turns what you highlighted into cards and brings each one back on a spacing that grows while you keep getting it right. All on this machine.' },
    { id: 'agent-pause', phrases: 'pause the agent stop it for a second change my mind mid run correct the agent', cat: 'ai', sel: '#ai-pause-agent', manual: true, name: 'Pause the agent, or change your mind',
      what: 'Pause holds a run between steps — the page stays where it is — and anything you type while it is held becomes the next thing the agent is told, so a run going the wrong way is corrected rather than restarted.' },
    { id: 'agent-schedule', phrases: 'agent every morning run this daily set up a schedule from chat repeat this task', cat: 'ai', sel: '#ai-input', manual: true, name: 'Ask the agent to set something up for every day',
      what: 'Say “every weekday at 8:30, check the status page and note anything new” and the agent makes the scheduled task itself — it turns up in the Schedules panel like any other.' },
    { id: 'teach', phrases: 'teach vex record what I do macro repeat the same clicks do this every month', cat: 'ai', cmd: 'teach', name: 'Teach Vex a task',
      what: 'Do a task once while Vex records the clicks, and it becomes a saved task that repeats without the AI. A password step hands the page back to you instead of being recorded.' },
    { id: 'freegames', phrases: 'free games epic steam giveaway free to keep this week', cat: 'unique', cmd: 'freegames', name: 'Free games this week',
      what: 'What Epic and Steam are giving away to keep right now, and what is coming next — from the stores’ own lists, with no account. Vex can tell you when a new one starts.' },
    { id: 'clips', phrases: 'my clips obs recordings shadowplay last night clip share a clip', cat: 'media', cmd: 'clips', name: 'My clips',
      what: 'Your recordings folder, newest first, with when each clip was made and how big it is. Click one to watch it in a tab, copy its path for a chat, or show it in the folder.' },
    { id: 'treetabs', phrases: 'tree tabs nested tabs indent tabs under parent vertical tabs tree', cat: 'tabs', cmd: 'treetabs', name: 'Tree tabs',
      what: 'In the side strip, a tab opened from another sits indented under it, so a research detour looks like a detour instead of more noise.' },
    { id: 'triage', phrases: 'too much unread mail inbox zero what needs a reply sort my email unsubscribe bulk', cat: 'work', cmd: 'triage', name: 'What your inbox actually wants',
      what: 'Sorts unread mail into what wants an answer, what is worth a look, and bulk grouped by sender — with a line saying why each landed there. Opens the ones that matter where you can reply.' },
    { id: 'smallmodel', phrases: 'small model faster local model routine jobs two models local speed', cat: 'ai', cmd: 'smallmodel', name: 'A small model for routine jobs',
      what: 'Point the background work — naming tab groups, indexing pages, sorting a question — at a quick local model, while chat and the agent keep the one you chose.' },
    { id: 'routelearn', phrases: 'it keeps guessing wrong chat or task slash agent slash chat learns my wording', cat: 'ai', cmd: 'forget-routing', name: 'Vex learns which sentences are tasks',
      what: 'Correcting Vex with /agent or /chat teaches it your wording, so the same kind of sentence goes the right way next time. This command forgets what it learned.' },
    { id: 'memceiling', phrases: 'memory ceiling too much ram tabs sleeping too often memory limit for this pc', cat: 'tabs', cmd: 'memceiling', name: 'A memory ceiling that fits this machine',
      what: 'Works the ceiling out from what this machine actually has, and from what is free right now, instead of the same 1200 MB for everyone — and says why before changing it.' },
    { id: 'live', phrases: 'twitch live youtube live streamer went live follow a channel notify me when streaming', cat: 'media', cmd: 'live', name: 'Who is live',
      what: 'The Twitch and YouTube channels you follow, and which are streaming right now — read from their own public pages, with no account. Vex says something once when one goes live.' },
    { id: 'siteidentity', cat: 'privacy', cmd: 'siteidentity',
      what: 'Exactly what this page can see about your browser, with a verdict on why a site might be refusing to work.' },
    { id: 'pwhealth', cat: 'privacy', cmd: 'pwhealth',
      what: 'Finds the passwords you reused, the weak ones, and the accounts with no second factor — checked on your machine, never sent away.' },

    // --- Reading ----------------------------------------------------------
    { id: 'reading-mode', phrases: 'reader clean page declutter article', cat: 'reading', cmd: 'read',
      what: 'Strips the page down to the article — no sidebars, no popups, no newsletter box.' },
    { id: 'readaloud', phrases: 'read aloud speak text to speech listen', cat: 'reading', cmd: 'readaloud',
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
    { id: 'translate', phrases: 'translate language foreign', cat: 'reading', cmd: 'translate',
      what: 'The whole page in your language, or just the sentence you selected.' },
    { id: 'annotations', cat: 'reading', cmd: 'annotations', panel: 'annotations',
      what: 'Highlight a passage and it is still highlighted when you come back to that page months later.' },
    { id: 'accessibility', cat: 'reading', name: 'Accessibility pack', setting: { section: 'recall-panel-content' },
      what: 'A dyslexia-friendly font, colour-blind filters, and a reading ruler that follows your cursor.' },
    { id: 'zoom', phrases: 'bigger smaller text size zoom', cat: 'reading', cmd: 'zoom-in',
      what: 'Zoom that is remembered per site, so the one with tiny type is always readable.' },

    // --- Productivity -----------------------------------------------------
    { id: 'notes', phrases: 'write notes notepad jot', cat: 'work', cmd: 'notes', panel: 'notes',
      what: 'Markdown notes with tags, pinning and search, beside the page instead of in another app.' },
    { id: 'stickynote', cat: 'work', cmd: 'stickynote',
      what: 'A note pinned to one specific page, which reappears every time you return to it.' },
    { id: 'clip', cat: 'work', cmd: 'clip',
      what: 'Sends the selected text into your notes with a link back to where it came from.' },
    { id: 'gaming', phrases: 'gaming game fps performance while playing', cat: 'media', name: 'Gets out of a game’s way', sel: '#gaming-settings', manual: true,
      what: 'When a full-screen game starts, Vex frees the graphics card, sleeps background tabs and holds background AI — and tells you what it did when you come back. Settings › Gaming.' },
    { id: 'record-screen', phrases: 'record video capture screen recording film my screen', cat: 'media', cmd: 'record-screen',
      what: 'Record a screen or a window, with its sound, to a video file — no recorder to install. Written to disk as it goes, so a long recording never fills memory.' },
    { id: 'whiteboard', cat: 'media', cmd: 'whiteboard',
      what: 'A blank white page to sketch on with the same pen, highlighter, boxes, arrows and text as Mark Up. Save it as a picture or copy it; closing after drawing asks first.' },
    { id: 'markup', cat: 'media', cmd: 'markup',
      what: 'Draw on a picture of the page — pen, highlighter, boxes, arrows, text — and redact anything private before you share it. Redaction replaces the pixels; it cannot be peeled off.' },
    { id: 'screenshot-full', phrases: 'whole page screenshot long screenshot scrolling capture', cat: 'media', cmd: 'screenshot-full',
      what: 'The whole page, top to bottom, in one image — the long receipt, the thread, the article with its charts — instead of scroll, capture, stitch.' },
    { id: 'save-pdf', phrases: 'save as pdf print to pdf', cat: 'reading', cmd: 'save-pdf',
      what: 'The page straight to a PDF file. The usual way is the print dialog, a preview and a destination menu.' },
    { id: 'save-page', phrases: 'save page offline keep a copy', cat: 'reading', cmd: 'save-page',
      what: 'The whole page as one file that opens offline — for the article that will be paywalled or deleted next month.' },
    { id: 'open-links', cat: 'tabs', cmd: 'open-links',
      what: 'Paste a pile of links — a list, a comma mess, a chat message — and each opens in its own tab.' },
    { id: 'page-images', cat: 'media', cmd: 'page-images',
      what: 'Every picture on the page, at the largest size the page offers, to save one at a time or all at once.' },
    { id: 'crawl-site', cat: 'dev', cmd: 'crawl-site',
      what: 'Follows the links of the site you are on, page by page, and says what to fix: broken pages and the pages that link to them, server errors, missing or duplicate titles, missing descriptions, pages hidden from search. Obeys robots.txt.' },
    { id: 'recent-checks', cat: 'dev', cmd: 'recent-checks',
      what: 'The link, speed, accessibility and crawl checks you ran, newest first, to run again. Every check of a page you checked before opens with what changed since last time, such as Broken 3 to 1.' },
    { id: 'check-links', cat: 'dev', cmd: 'check-links',
      what: 'Every link on the page asked whether it still works — broken, moved, or behind a login — with the offending link outlined on the page. No cookies are sent.' },
    { id: 'check-speed', cat: 'dev', cmd: 'check-speed',
      what: 'How fast the page loaded, graded against Google’s Core Web Vitals, and what is slowing it: the heaviest files, pictures sent far bigger than shown, scripts that stop it drawing.' },
    { id: 'check-a11y', cat: 'dev', cmd: 'check-a11y',
      what: 'Checks the page for what stops people using it — pictures with no description, unlabelled boxes, nameless buttons, text too faint to read — in words, each outlined on the page.' },
    { id: 'cite', cat: 'reading', cmd: 'cite',
      what: 'A citation in APA, MLA, Harvard, Chicago or BibTeX, built from what the page publishes about itself.' },
    { id: 'todo', cat: 'work', cmd: 'todo',
      what: 'Every open checklist item from every note, in one list, sorted by due date. Tick it here and it is ticked in the note; add one and it goes in your To-do note.' },
    { id: 'todo-board', cat: 'work', cmd: 'todo-board',
      what: 'The same note tasks in three columns: To do, Doing, Done. Drag a card or use its arrows; the move is written into that task line in its note, so the board and the notes never disagree.' },
    { id: 'price-history', cat: 'work', cmd: 'price-history', phrases: 'price drop shopping cheaper',
      what: 'Notes the price on product pages you open (from the data shops publish for search engines) and shows what a product cost each time you looked, and the lowest you have seen. Kept on this computer; never in private tabs.' },
    { id: 'calendar', phrases: 'calendar what is on today appointments', cat: 'work', cmd: 'calendar',
      what: 'A month of your reminders (repeating ones on every day they repeat) and the to-dos in your notes that have a date. Tick to-dos there, and add a reminder on any day. Not linked to Google or Outlook.' },
    { id: 'parcels', cat: 'work', cmd: 'parcels',
      what: 'Paste a tracking number and Vex says whose it is (UPS, USPS, FedEx, DHL, Royal Mail, Amazon and more, check digits verified) and opens the tracking page of that carrier. Keeps a list of what you are waiting for.' },
    { id: 'expenses', cat: 'work', cmd: 'expenses',
      what: 'A log of what you spent, kept on this computer: this month by category, compared with last month, and exported as CSV for a spreadsheet.' },
    { id: 'habits', cat: 'work', cmd: 'habits',
      what: 'A tick for each day you did something, with the streak you are on and your best. The last seven days can be ticked, so a forgotten yesterday still counts.' },
    { id: 'projects', cat: 'work', cmd: 'projects',
      what: 'A folder for one topic: the pages, your notes, and the AI conversations about it — which every other browser loses, because a chat belongs to a tab and tabs close. Exports as Markdown.' },
    { id: 'show-thinking', cat: 'ai', cmd: 'show-thinking', sel: '#ai-think-toggle',
      what: 'Watch a reasoning model think: its latest thought as a live line under "Thinking…", the whole of it one click away. Off by default — thinking makes a local model several times slower.' },
    { id: 'eyedropper', cat: 'dev', cmd: 'eyedropper',
      what: 'Sample the colour of any pixel on the screen — a page, a video, another program — and get its hex. Nothing is injected into the page.' },
    { id: 'snippets', cat: 'work', cmd: 'snippets',
      what: 'An abbreviation that becomes the text you keep retyping. Type it in any box on any page and press Tab.' },
    { id: 'clipboard-history', cat: 'work', cmd: 'clipboard-history',
      what: 'The thing you copied before the thing you copied. Web pages only — never your other programs — and nothing is kept after you close Vex unless you pin it.' },
    { id: 'library', phrases: 'reading list save for later read later queue saved links', cat: 'work', cmd: 'library', panel: 'library',
      what: 'Read later — a queue of saved pages, with tabs you abandoned archived into it automatically.' },
    { id: 'bookmarks', phrases: 'bookmarks favourites favorites saved sites', cat: 'work', cmd: 'bookmarks', panel: 'bookmarks',
      what: 'Bookmarks in folders, with a star in the address bar.' },
    { id: 'feeds', phrases: 'rss feeds news', cat: 'work', cmd: 'feeds', panel: 'feeds',
      what: 'An RSS reader in the sidebar — follow sites that still publish a feed.' },
    { id: 'history', phrases: 'history search history what i visited pages i was on', cat: 'work', cmd: 'history', panel: 'history',
      what: 'Everywhere you have been, by day, searchable by keyword or by meaning, deletable by site or by day.' },
    { id: 'watch', phrases: 'tell me when it changes price drop watch page', cat: 'work', cmd: 'watch',
      what: 'Tells you when a page changes — a restock, a status page, a result you are waiting on.' },
    { id: 'wayback', cat: 'work', cmd: 'wayback-view',
      what: 'Opens the archived copy of a page that has gone dead, or archives one before it does.' },
    { id: 'focus', phrases: 'focus block distracting sites concentrate', cat: 'work', cmd: 'focus',
      what: 'Hides the browser chrome and blocks the sites you lose time to, for 25 or 50 minutes.' },
    { id: 'focusflows', cat: 'work', cmd: 'focusflows',
      what: 'A named work mode: one click opens a set of tabs, switches AI persona, dims the interface and blocks distractions.' },
    { id: 'remind', phrases: 'reminder remind alarm', cat: 'work', cmd: 'remind',
      what: 'Paste what you have to do, type "in 2 hours" or "tomorrow 9am", and a desktop notification arrives at the minute — even if Vex is closed, because Windows wakes it. It reads the time back to you before it saves anything.' },
    { id: 'remind-repeat', cat: 'work', name: 'Reminders that repeat', manual: true,
      what: 'Every day, weekdays or every week, at the same time — and each occurrence gets its own Windows wake-up, so "weekdays 9am" still arrives with Vex closed.' },
    { id: 'remind-page', cat: 'work', name: 'Remind me about this page', manual: true,
      what: 'A reminder can carry the page you were on. Its notification opens the reminder in Vex with an Open page button, so "come back to this" actually brings you back.' },
    { id: 'remind-site', cat: 'unique', name: 'Next time I open this site', manual: true,
      what: 'Type "when I open github.com" instead of a time, and the reminder fires the moment a tab lands on that site. Nobody else does this.' },
    { id: 'quick-capture', cat: 'work', name: 'Right-click any selection', manual: true,
      what: 'Select text on any page — a Discord message, a paragraph, a task — and right-click: Remind me about this, Save as a note for this page, or Ask Vex AI about this. Works inside the sidebar panels too.' },
    { id: 'today', cat: 'work', name: 'Today, on the new tab', manual: true,
      what: 'Reminders due today, scheduled tasks about to run, watched pages that changed and pages you saved recently — together, on the new tab page.' },
    { id: 'focus-reminders', cat: 'work', name: 'Focus holds your reminders', manual: true,
      what: 'During a focus session reminders wait and arrive as a batch when it ends — unless you marked one urgent.' },
    { id: 'remind-calendar', cat: 'work', name: 'Reminder to calendar', manual: true,
      what: 'Any timed reminder can be saved as a .ics entry for Outlook or Google Calendar, repeat rule included.' },
    { id: 'clock', phrases: 'timer stopwatch alarm world clock', cat: 'work', cmd: 'clock', panel: 'clock',
      what: 'Alarms that ring until dismissed — even if Vex was closed, Windows wakes it — with snooze; timers that keep counting through a reload and end with a notification; a stopwatch with laps; and a world clock for the cities you pick, with a slider for "what time is it there when it is 3pm here". Timers you ran come back as one-click Again chips, and alarms you set before can be set again.' },
    { id: 'mail', phrases: 'email inbox mail', cat: 'work', cmd: 'mail',
      what: 'Your newest mail from Gmail, Yahoo, iCloud or any IMAP account, read-only: reading here never marks it read, and pictures are not loaded so nothing reports that you opened it. Reply in the webmail. Signs in with an app password, kept encrypted.' },
    { id: 'dictate', phrases: 'voice typing speak dictation microphone', cat: 'work', cmd: 'dictate',
      what: 'Speak, and it is typed where the cursor was, in a web page or in Vex. Whisper runs on this PC: the model (73 MB, or 238 MB for better accuracy) downloads once after asking, then works offline. Ctrl+Alt+D to start and stop.' },
    { id: 'do-again', cat: 'work', cmd: 'do-again',
      what: 'Runs the last Ctrl+K command you used once more, and says which it is. Also Ctrl+Alt+A while the Vex window has focus, and it can be rebound.' },
    { id: 'quick-commands', cat: 'work', name: 'Plain sentences in Ctrl+K', manual: true,
      what: 'Type "remind me to call Dana tomorrow 9am", "timer 25 min", "alarm 7am weekdays" or "what time is it in Tokyo" straight into the command bar. Enter does it; no panel.' },
    { id: 'weekly-review', cat: 'work', cmd: 'weekly-review',
      what: 'Every Friday at five — a reminder that opens one honest card: what fired, what got snoozed, what you saved and never read, which watched pages changed, which tools you used.' },
    { id: 'toast-snooze', cat: 'work', name: 'Snooze from the notification', manual: true,
      what: 'A reminder\'s Windows notification has Snooze 9 min and Open buttons on it, so you deal with it without bringing Vex forward.' },
    { id: 'reminders-sync', cat: 'data', name: 'Reminders follow you', manual: true,
      what: 'With Vex Sync on, a reminder set on the laptop rings on the desktop too. Only the machine that set it wakes Windows for it, and one that fired anywhere never fires twice.' },
    { id: 'alarm-sound', cat: 'work', name: 'Alarm tone and volume', manual: true,
      what: 'Four tones, a volume, and insistent or gentle — once, then every thirty seconds — with a preview, in the Clock\'s Alarms tab.' },
    { id: 'today-work', cat: 'work', name: 'Work, apart from the rest', manual: true,
      what: 'Reminders and alarms carry the job they were set under. Today marks them, and the Work panel lists what is set for this job.' },
    { id: 'remind-zone', cat: 'work', name: 'Reminders in another city\'s time', manual: true,
      what: 'Type "9am New York time" or "tomorrow 17:00 in Tokyo" and the reminder lands at that moment, read back in both clocks before it saves.' },
    { id: 'tool-history', cat: 'work', name: 'Tool history', manual: true,
      what: 'Every tool keeps its last ten results and the Toolbox shows the tools you opened most recently, beside your favourites.' },
    { id: 'automations', cat: 'work', cmd: 'automations',
      what: 'When this, do that — when a page opens, or at a time each day, run a command or open something.' },
    { id: 'chains', cat: 'work', name: 'Command chains', setting: { section: 'chains-panel-content' }, keys: 'Ctrl+Alt+1 / 2 / 3',
      what: 'Bundle several commands into one — reading mode then read aloud — and put the first three on a shortcut.' },
    { id: 'toolbox', cat: 'work', cmd: 'toolbox',
      what: 'Over three hundred small tools that run locally: converters, regex, JSON, hashes, colour, loans, dates.' },
    { id: 'toolbox-reference', cat: 'work', name: 'The reference beside every tool', manual: true,
      what: 'Each tool opens with a written reference panel — the categories, the traps, the lookup table you would otherwise go and search for. Not just the answer, but what it means.' },
    { id: 'toolbox-full', cat: 'work', name: 'Tools at two sizes', manual: true,
      what: 'Every tool opens as a compact panel or, with one click, as a full-screen workspace with the reference open beside it. Vex remembers which you prefer.' },
    { id: 'toolbox-favourites', cat: 'work', name: 'Favourite tools', manual: true,
      what: 'Star the tools you keep coming back to and they sit at the top of the Toolbox, ahead of the other three hundred.' },
    { id: 'jobsetup', cat: 'work', cmd: 'jobsetup',
      what: 'Pick your profession and Vex sets a fitting theme and puts the tools that job actually uses within reach.' },
    { id: 'resmon', cat: 'work', cmd: 'resmon',
      what: 'Live CPU and memory for every process Vex is running, so you can see what is eating your machine.' },
    { id: 'downloads', phrases: 'downloads downloaded files', cat: 'work', cmd: 'downloads', panel: 'downloads',
      what: 'Downloads you can pause, resume, cancel and retry, with the real byte counts.' },
    { id: 'sendphone', phrases: 'send to phone my phone', cat: 'work', cmd: 'sendphone',
      what: 'Hands the page you are on to your phone — by QR code, or straight to your other Vex if you have sync on.' },
    { id: 'queue', cat: 'work', cmd: 'queuepodcast', panel: 'queue',
      what: 'Your read-later pile read aloud as an auto-advancing playlist, with spoken introductions.' },
    { id: 'autorefresh', cat: 'work', cmd: 'autorefresh',
      what: 'Reloads a tab on a timer — live scores, a build log, a status page.' },
    { id: 'pasteandgo', cat: 'work', cmd: 'pasteandgo',
      what: 'Opens whatever URL is on your clipboard, or searches it if it is not a URL.' },

    // --- Media ------------------------------------------------------------
    { id: 'drm', phrases: 'netflix spotify disney prime video not playing', cat: 'media', name: 'Netflix, Spotify, Prime and Disney+', manual: true,
      what: 'Protected video and audio play here. Most Electron-based browsers cannot do this at all.' },
    { id: 'screenshare', cat: 'media', name: 'Screen sharing with real controls', manual: true,
      what: 'When a site asks to share your screen, you choose the source, resolution up to 1440p, frame rate, whether system audio goes with it and whether the cursor shows.' },
    { id: 'media-grabber', cat: 'media', cmd: 'media',
      what: 'Finds the video or audio playing on a page and saves it.' },
    { id: 'volume', phrases: 'volume loud quiet sound', cat: 'media', name: 'Master volume', manual: true,
      what: 'One slider from 0 to 500% across every tab — including making a quiet video louder than it was mixed.' },
    { id: 'nowplaying', cat: 'media', name: 'Now Playing', manual: true,
      what: 'Whatever is making sound, in one place, with the controls for it.' },
    { id: 'mute', phrases: 'mute silence sound audio', cat: 'media', cmd: 'mute',
      what: 'Silence one tab, or every tab except this one.' },
    { id: 'screenshot', phrases: 'screen grab capture picture of the page snip', cat: 'media', cmd: 'screenshot',
      what: 'Capture the visible page, the whole scrolling page, or a region you drag — then annotate it.' },
    { id: 'qr', phrases: 'qr code phone send to phone', cat: 'media', cmd: 'qr',
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
    { id: 'passwords', phrases: 'passwords remember my passwords saved logins password manager sign in login', cat: 'logins', cmd: 'loginshub',
      what: 'A password vault encrypted by Windows itself, that offers to save a login and fills it when you come back.' },
    { id: 'totp', phrases: 'two factor 2fa authenticator one time code', cat: 'logins', name: '2FA codes, filled in', cmd: 'loginshub',
      what: 'Vex generates your six-digit code and types it into the 2FA screen for you.' },
    { id: 'emailcode', cat: 'logins', cmd: 'fillemailcode',
      what: 'Reads the verification code out of your Gmail and fills it — even with no Gmail tab open.' },
    { id: 'formfill', cat: 'logins', cmd: 'formfill',
      what: 'One saved profile fills any signup or checkout form. Card numbers are never stored.' },

    // --- Make it yours ----------------------------------------------------
    { id: 'skin', phrases: 'pattern texture skin shapes corners rounded flat glow decorate style', cat: 'look', cmd: 'skin', name: 'Skins — texture, shape and light',
      what: 'Nineteen textures for Vex’s own surfaces (dots, graph paper, honeycomb, circuitry, contours, grain…), five corner shapes and four kinds of shadow — on top of any theme.' },
    { id: 'font', phrases: 'font typeface times new roman serif letters text size reading', cat: 'look', cmd: 'font', name: 'The font Vex wears',
      what: 'The typeface of the browser itself \u2014 twenty-three of them, from Segoe UI to Times New Roman, plus the one used for code.' },
    { id: 'themes', phrases: 'dark dark mode light mode colour color appearance skin', cat: 'look', cmd: 'theme',
      what: 'Thirty-five themes, and the whole interface follows — including the new tab page.' },
    { id: 'guistyle', phrases: 'look like chrome firefox safari edge browser look', cat: 'look', name: 'Browser looks', setting: { section: 'boosts-panel-content' },
      what: 'Wear a different browser: Chrome, Firefox, Safari, Internet Explorer on XP, or Netscape on 98 — each with its own sidebar behaviour.' },
    { id: 'editlayout', cat: 'look', cmd: 'editlayout',
      what: 'Drag any toolbar button or sidebar icon somewhere else, or hide it. Presets for Default, Essentials and Minimal.' },
    { id: 'siteprofiles', cat: 'look', cmd: 'siteprofiles',
      what: 'Per-site zoom, forced dark mode and your own tweaks, remembered for that site only.' },
    { id: 'boost', phrases: 'custom css userscript tweak a site', cat: 'look', cmd: 'boost',
      what: 'Your own CSS or JavaScript on a site — permanently.' },
    { id: 'zap', phrases: 'hide element remove thing from page', cat: 'look', cmd: 'zap',
      what: 'Click anything you never want to see on that site again, and it is gone for good.' },
    { id: 'airestyle', cat: 'look', cmd: 'airestyle',
      what: 'Describe a look — "declutter", "match my dark theme" — and the AI writes the CSS, saved as a per-site Boost.' },
    { id: 'setupgallery', cat: 'look', cmd: 'setupgallery',
      what: 'Save your whole setup as a code you can paste on another machine, or hand to someone else.' },
    { id: 'startpage', phrases: 'new tab page home page start page', cat: 'look', cmd: 'start',
      what: 'A start page with your name, the weather, your GitHub activity, a daily verse or quote, and your own shortcuts.' },
    { id: 'shortcuts', phrases: 'keyboard shortcuts hotkeys keys', cat: 'look', cmd: 'shortcuts',
      what: 'Rebind any keyboard shortcut to whatever you actually press — and give a key to anything that has none, from the whole command list.' },
    { id: 'extensions', phrases: 'extensions add-ons plugins chrome store', cat: 'look', name: 'Chrome extensions', setting: { section: 'extensions-panel-content' },
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
    { id: 'devtools', phrases: 'inspect element console devtools debug', cat: 'dev', name: 'DevTools', keys: 'F12', manual: true,
      what: 'The full Chromium developer tools, on the page you are looking at.' },
    { id: 'dev-mode', cat: 'dev', cmd: 'dev-mode',
      what: 'Two ways to use any theme: user mode is the browser, developer mode adds a dashboard button beside the Toolbox and a panel in the sidebar.' },
    { id: 'dev-dashboard', cat: 'dev', cmd: 'dev-dashboard',
      what: 'Live counts of tabs, storage and what Vex has loaded, with the quick actions you want while working on it — reload the interface, open the profile folder, reset Vex.' },

    // --- Sync & data ------------------------------------------------------
    { id: 'sync', phrases: 'another computer other device phone backup my tabs everywhere', cat: 'data', name: 'Vex Sync', setting: { section: 'sync-panel-content' },
      steps: [
        { sel: '#icon-sidebar', title: 'Open Settings', html: 'The gear at the bottom of the sidebar, then <b>Sync</b>.' },
        { sel: '#btn-command', title: 'Or from the command bar', html: '<kbd>Ctrl</kbd>+<kbd>K</kbd> → “Sync”. Set a passphrase on this computer, then enter the same one on the other: everything is encrypted with it before it leaves, so only your devices can read it.' },
      ],
      what: 'Tabs, bookmarks, history and settings on every machine you use, encrypted on your device before it leaves. Your server, your key.' },
    { id: 'export', phrases: 'export my data backup everything', cat: 'data', cmd: 'export-data',
      what: 'Everything Vex has stored about you, as one JSON file you can read.' },
    { id: 'whatsnew', cat: 'data', cmd: 'whatsnew',
      what: 'What changed in this version, and every version before it.' },
    { id: 'updates', phrases: 'update new version upgrade', cat: 'data', name: 'Automatic updates', setting: { section: 'sync-panel-content' },
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

  // === Inside a category ====================================================
  //
  // Twelve categories was enough to file two hundred features, and not enough
  // to read them: "Productivity" alone is fifty-four things with nothing to
  // say which of them belong together. These are the shelves inside each one.
  //
  // Only a category that needs them has them. An id that is not listed here
  // still appears — it lands in "More" at the end of its category, so adding a
  // feature to the catalogue can never make it disappear from the Library.
  GROUPS: {
    tabs: [
      { name: 'The tab strip', ids: ['vertical-tabs', 'treetabs', 'tab-groups', 'reopen', 'closeduplicates', 'switchtoopen', 'open-links', 'gestures'] },
      { name: 'Memory, and sleeping', ids: ['tab-sleep', 'memory-saver', 'tab-health', 'memory-panel', 'tasks', 'keep-awake', 'memceiling'] },
      { name: 'More than one thing at once', ids: ['split', 'pip', 'peek', 'workspaces', 'containers', 'pinsite', 'openasapp'] },
      { name: 'Getting back to where you were', ids: ['sessions', 'wsnap', 'tabtrail', 'apps-not-links'] },
    ],
    ai: [
      { name: 'Asking it things', ids: ['ai-panel', 'askvex', 'summarize', 'selection-bar', 'compose', 'tabmentions', 'chatfile', 'show-thinking', 'twomodels'] },
      { name: 'Having it do the work', ids: ['agent', 'agent-pause', 'agent-schedule', 'teach', 'skills', 'schedules', 'tabai'] },
      { name: 'Which model, and what it knows about you', ids: ['ai-router', 'ondevice', 'smallmodel', 'personas', 'ai-memory', 'routelearn', 'mcp'] },
      { name: 'Finding what you have read', ids: ['recall', 'remember', 'catchup', 'screenshot-code'] },
    ],
    privacy: [
      { name: 'Blocking, and being followed', ids: ['adblock', 'consent-banners', 'privacy-report', 'trackerreceipts', 'fingerprint'] },
      { name: 'The connection itself', ids: ['doh', 'https-only', 'tor', 'routing', 'dpi'] },
      { name: 'Leaving no trace', ids: ['otr', 'identity', 'private-window'] },
      { name: 'One site at a time', ids: ['permissions', 'clearsite', 'sitedata', 'siterules', 'siteidentity'] },
      { name: 'Your passwords', ids: ['pwhealth'] },
    ],
    reading: [
      { name: 'Getting to the words', ids: ['reading-mode', 'readfree', 'copyunlock', 'doctext', 'find-in-page'] },
      { name: 'Getting through them', ids: ['readaloud', 'speedread', 'bionic', 'accessibility', 'zoom', 'dictionary'] },
      { name: 'In another language', ids: ['translate', 'translate-side'] },
      { name: 'Keeping what you read', ids: ['save-pdf', 'save-page', 'annotations', 'cards', 'cite', 'pagediff'] },
    ],
    work: [
      { name: 'Notes', ids: ['notes', 'stickynote', 'clip', 'quick-capture', 'clipboard-history', 'snippets'] },
      { name: 'What you have to do', ids: ['todo', 'todo-board', 'projects', 'habits', 'calendar', 'today', 'today-work', 'weekly-review'] },
      { name: 'Reminders and alarms', ids: ['remind', 'remind-repeat', 'remind-page', 'remind-zone', 'remind-calendar', 'focus-reminders', 'toast-snooze', 'clock', 'alarm-sound'] },
      { name: 'Keeping and finding pages', ids: ['library', 'bookmarks', 'history', 'feeds', 'watch', 'wayback', 'queue', 'sendphone', 'autorefresh', 'pasteandgo'] },
      { name: 'Settling into work', ids: ['focus', 'focusflows', 'meeting', 'jobsetup'] },
      { name: 'Tools, and doing things twice', ids: ['toolbox', 'toolbox-reference', 'toolbox-full', 'toolbox-favourites', 'tool-history', 'automations', 'chains', 'do-again', 'quick-commands', 'dictate'] },
      { name: 'Mail, parcels and money', ids: ['mail', 'triage', 'parcels', 'expenses', 'price-history'] },
      { name: 'This machine', ids: ['resmon', 'downloads'] },
    ],
    media: [
      { name: 'Watching and listening', ids: ['drm', 'live', 'nowplaying', 'volume', 'mute', 'nightaudio', 'media-grabber', 'videonote', 'codecfixes'] },
      { name: 'Capturing what is on screen', ids: ['screenshot', 'screenshot-full', 'record-screen', 'clips', 'markup', 'whiteboard', 'page-images', 'qr'] },
      { name: 'Games and calls', ids: ['gaming', 'screenshare'] },
    ],
    panels: [
      { name: 'The apps', ids: ['panel-whatsapp', 'panel-discord', 'panel-spotify', 'panel-netflix', 'panel-claude', 'panel-github', 'panel-roblox'] },
      { name: 'And your own', ids: ['panel-authenticator', 'pinsite2'] },
    ],
    look: [
      { name: 'The whole browser', ids: ['themes', 'skin', 'font', 'guistyle', 'startpage', 'editlayout', 'tools-bar', 'shortcuts'] },
      { name: 'One site at a time', ids: ['siteprofiles', 'boost', 'zap', 'airestyle'] },
      { name: 'The rest', ids: ['search-engine', 'extensions', 'setupgallery'] },
    ],
    dev: [
      { name: 'Checking a page', ids: ['check-links', 'check-speed', 'check-a11y', 'crawl-site', 'recent-checks'] },
      { name: 'While you are building', ids: ['devtools', 'apiclient', 'formatjson', 'responsive', 'eyedropper', 'dev-mode', 'dev-dashboard'] },
    ],
  },

  // A category's features, on their shelves. Anything not filed goes to the
  // end under "More", and a category with no shelves comes back as one
  // unnamed group so the caller can draw them all the same way.
  groupsFor(catId) {
    const items = this.byCat(catId);
    const shelves = this.GROUPS[catId];
    if (!shelves) return [{ name: '', items }];
    const seen = new Set();
    const out = [];
    for (const shelf of shelves) {
      const got = shelf.ids.map(id => items.find(f => f.id === id)).filter(Boolean);
      for (const f of got) seen.add(f.id);
      if (got.length) out.push({ name: shelf.name, items: got });
    }
    const rest = items.filter(f => !seen.has(f.id));
    if (rest.length) out.push({ name: 'More', items: rest });
    return out;
  },

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
