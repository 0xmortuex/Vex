// === The long version of every feature ====================================
//
// The catalogue (js/feature-catalog.js) is deliberately thin: one sentence
// saying what a feature is FOR, because that is all Discover and the command
// bar need. The Library (js/feature-library.js) is a reference you sit down
// with, and a reference needs the next paragraph — when it is worth reaching
// for, and the part that is not obvious until it bites you.
//
// That paragraph lives here rather than in the catalogue so the catalogue
// stays a list of facts, and so this file can be read (and corrected) as
// prose. Keyed by the catalogue's own id; a missing one simply shows the
// catalogue sentence, so nothing breaks when a feature is added.
//
// Rules for anything written here: say when to use it and what surprises
// people. Never repeat the one-line description, never promise what the code
// does not do, and keep it to two or three sentences — this is the paragraph
// after the headline, not a manual.
const FeatureDetails = {
  // ---- Tabs & windows ------------------------------------------------------
  'find-in-page': 'Vex counts the matches and keeps its own bar, so a site that has hijacked Ctrl+F for its own search still gives you the browser one. Enter jumps to the next match, Shift+Enter to the previous.',
  'memory-saver': 'This is the blunt instrument: it lets Chromium discard idle tabs on its own terms. If you want to decide what sleeps and when, use Sleeping tabs and the memory ceiling instead — they keep the scroll position and can be told what to leave alone.',
  'vertical-tabs': 'Thirty tabs across the top gives each one about twelve pixels of title; down the side each keeps its full name. The strip can be collapsed to icons with Ctrl+B when you want the width back.',
  'tab-groups': 'Ask for it once on a messy window and Vex works out the clusters itself — it does not need you to name them first. What it learns is the pattern, so a tab you open tomorrow joins the group it belongs to without being asked.',
  'tab-sleep': 'A sleeping tab costs no memory at all: its process really is gone, not paused. It comes back on the scroll position and form text you left, so the safe habit is to sleep aggressively rather than close.',
  'tab-health': 'The screen to open when the machine is struggling and you want to know which tab is to blame. Kept-awake tabs are listed separately, because they are the ones that will never give their memory back on their own.',
  'memory-panel': 'The numbers are measured from the operating system, not estimated from the page, so they match Task Manager. Sleep, wake, reload and close sit on each row, which is quicker than hunting the tab itself.',
  'keys-sheet': 'Vex answers to more than sixty keys and gained eleven of them in one release. They were all listed in Settings \u2014 a page you have to decide to go and read, and nobody decides to read a list of keys, so the keys existed and went unused, which is the same as not having them. Ctrl+Shift+K puts them over whatever you are doing instead, grouped, with the categories that matter where you are marked and placed first: the AI keys when the AI panel is open, the tab and navigation keys when you are on a page. A key with nothing behind it is left out rather than listed and quietly broken, and one you set yourself is marked as yours. Nothing on the sheet can be changed \u2014 a reference you can break is one you open carefully \u2014 but there is a way through to the screen that does change them.',
  backup: 'A setup code carries the panels, the shortcuts, the theme, the skin and the typeface: the decoration. It does not carry your notes, your sessions, your keybindings, your site rules or any of the forty other things Vex remembers, so \u201cI can move my setup\u201d really meant \u201cI can move how it looks\u201d. This is the rest, in one file you save and restore yourself. It deliberately leaves out two things: anything that looks like a secret \u2014 saved logins and authenticator codes live encrypted in Vex itself and cannot be read from here at all, and a backup containing them would be a password file sitting in a downloads folder \u2014 and anything true of this machine rather than of you, like when Vex was installed or which panel was open a minute ago. Your AI conversations go in only if you tick the box: they are the most personal thing Vex holds. A restore says what the file contains before it changes anything, skips an entry it cannot read rather than giving up on the rest, and can be undone until you close Vex \u2014 because the commonest way to lose everything is to restore the wrong file.',
  'why-slow': 'The answer was already in Vex, in four places nobody thinks to visit at the moment it matters: the process list knows which renderer is burning the processor, the tab list knows which page that is, the routing screen knows whether every request is going the long way round through Tor, and the graphics probe knows a game has the card. Each on its own is a number; together they are a sentence. This puts them in one place, heaviest first, with the button that fixes each one \u2014 go to that tab, let that panel sleep, open the routing settings. It measures nothing new and it never guesses: if nothing is wrong it says so, with the figures it checked.',
  tasks: 'Two questions, two answers: right-click a tab or a panel for what is inside THAT app — how much JavaScript it holds, how far the page has grown, what it has stored on your disk — or open it plain for every process Vex runs. Ending a page only sleeps it, so nothing you had open is lost.',
  'keep-awake': 'For the tab that must not stop: a dashboard, a match, a long upload, a chat you are waiting on. It is also the reason a panel never gives memory back, so use it deliberately and check it when something is heavy.',
  split: 'Panes are real tabs, so each one keeps its own history and can be dragged out again. With Linked scroll on, the panes move together — the usual reason to want two of the same page.',
  pip: 'The floating window stays above other programs, not just above Vex, so it survives switching to a game or an editor. Its own bar has Back to tab, which returns you to the page the video came from.',
  peek: 'For a link you are not sure you want. It loads in a card over the page and throws it away when you dismiss it, so your tab strip never grows and your place is never lost.',
  workspaces: 'Each workspace has its own tabs, and closing tabs in one leaves the others untouched — the honest version of "I will just open a new window". Switching is instant because the other workspace’s tabs are not loaded until you go back.',
  wsnap: 'A snapshot is taken quietly as you work, so this answers "what did I have open before I cleaned up?" days later. Restoring opens them asleep, which costs nothing until you click one.',
  sessions: 'A named set of tabs you can bring back on purpose — the research for one job, the tabs for a lesson. The automatic save is separate and is what protects you from a crash.',
  reopen: 'Ctrl+Shift+T walks backwards through the tabs you closed this session, one press at a time. The list goes further back than the keyboard does: Ctrl+K, "Recently closed".',
  gestures: 'Ten gestures on the right button, which suits a mouse in one hand and nothing else. They can be switched off entirely in Settings if they fire when you meant to right-click.',
  containers: 'The only clean way to hold two accounts on one site at the same time: each container has its own cookie jar, so signing into one does not sign the other out. Links opened from a container tab stay in that container.',
  pinsite: 'A pinned site stays loaded and signed in beside the page, which is what makes it different from a bookmark. It has its own session, so a work account in a panel and a personal one in a tab do not collide.',
  openasapp: 'No tabs, no address bar — for the thing you want to alt-tab to rather than browse. It keeps its own window position, so it lands where you left it.',
  closeduplicates: 'The five copies of the same page you opened over a morning, closed in one go with one kept. It matches on the address, so two different sections of the same site are safe.',
  'apps-not-links': 'A roblox:// or spotify: link hands off to the program you already have rather than showing an error. Vex asks the first time for a given scheme, and remembers the answer.',
  treetabs: 'A tab opened from another sits indented under it, so a research detour reads as a branch instead of ten unrelated strangers. Collapsing the parent hides the whole branch.',
  tabtrail: 'For the tab you cannot place: it shows the chain of pages that led here, not just the one before. Every hop is clickable.',
  switchtoopen: 'Opening something you already have open goes to that tab instead of making a second copy — which is what you meant, nine times in ten. Hold Ctrl when you really do want a duplicate.',
  memceiling: 'Reads what this machine has and what is free right now, rather than guessing at a figure that suits a 32 GB desktop and strangles an 8 GB laptop. Worth re-running after you add memory.',

  // ---- AI ------------------------------------------------------------------
  'ai-panel': 'It already knows what you are looking at, so "what is this arguing?" works without pasting anything. It can take the whole page, just the text you selected, or every open tab at once.',
  'ai-router': 'The choice is per feature, not per app: the big cloud model for chat, Ollama for anything private, the small on-device one for background work. Nothing leaves the machine on the local backends, including the page text a feature sends with your question.',
  askvex: 'Plain sentences in Ctrl+K — "close all youtube tabs", "group my github tabs". Anything that would close or change something lists exactly what it will do first.',
  agent: 'It drives the page itself: clicks, types, reads what came back, and shows its plan before it starts. It asks before anything it cannot undo, and Pause stops it between steps rather than mid-action.',
  tabai: 'Tab management in words, with the list of what it is about to close in front of you. Use it when the window has got away from you and naming the pattern is quicker than clicking thirty times.',
  summarize: 'Good for the long thread and the long article, and it will compare the open tabs as siblings when you ask — which is the honest way to use five reviews of the same thing.',
  'selection-bar': 'Highlight, and the choice appears where you are looking instead of in a panel: explain, shorten, translate, or rewrite it in place. The rewrite goes back into the box you took it from when the site allows it.',
  compose: 'Writes straight into whatever box has the cursor — a reply, a form, a commit message — so nothing is copied and pasted. It reads what is already there, so "make this shorter" works on your own draft.',
  personas: 'A persona is a saved voice and set of instructions, and each tab can use a different one — research in one, code review in another. @mention one mid-chat to borrow it for a single answer.',
  'ai-memory': 'Facts you should only have to say once: what you work on, which framework, how you like answers. It works on the local backend too, because it is stored here and sent with the question.',
  skills: 'The prompt you keep retyping, saved as its own Ctrl+K command that runs on whatever page you are on. This is the cheap way to automate something before reaching for the agent.',
  schedules: 'Tasks that run without you — every morning, every Monday, or on a cron line. A run missed while the machine was off is caught up rather than silently skipped.',
  recall: 'Searches the text of pages you actually read, not just their titles, which is what you need when you remember the sentence and nothing else. The index is on this machine and can be emptied at any time.',
  remember: 'For when you cannot name it: "that article about DPI" finds it by what it was about. It searches the same local index as Recall.',
  catchup: 'Your saved pile, read for you: each article in two or three sentences and why it may matter, grouped by topic when there are many. Made on this machine unless you allow the cloud, and a summary is kept until the article changes. Turn on the morning run in the Library\'s Digest tab.',
  'screenshot-code': 'Capture a page or a region and get the markup back — HTML, Tailwind or React. Treat it as a starting point rather than a copy: it reproduces what it can see, not the site’s own code.',
  mcp: 'Connects Vex to Model Context Protocol servers, so your own tools become things the assistant and the agent can use. Each server is added deliberately and can be switched off on its own.',
  ondevice: 'A small model that runs inside Vex on your GPU — nothing to install, nothing sent anywhere. It is not as sharp as a cloud model, which is why it suits routine work rather than hard questions.',
  tabmentions: 'Type @ in the AI box to name an open tab and include it in the question, without switching to it. The same list holds your saved notes.',
  twomodels: 'The same question to the cloud model and the local one at once, side by side. The honest use is deciding whether the local one is good enough for a kind of work — after which you can stop paying for it.',
  chatfile: 'Drop a PDF or a text file on the AI panel and ask about it. The words are read on this machine, so with a local backend the file never leaves it.',
  'agent-pause': 'Pause holds a run between steps and leaves the page exactly where it is. Anything you type while it is held becomes the agent’s next instruction, which is how you correct it without starting again.',
  'agent-schedule': 'The agent can set up its own repeat: say "every weekday at 8:30, check the status page and note anything new" and the scheduled task is created for you. It shows what it made, so you can change it.',
  teach: 'Do the task once while Vex records the clicks, and it replays without the AI — faster, free, and identical every time. A password field is never recorded.',
  smallmodel: 'Point the background work at a quick local model and keep the good one for chat and the agent. Naming a tab group does not need a frontier model.',
  routelearn: 'Correcting Vex with /agent or /chat teaches it your wording, so the next sentence like it goes the right way on its own. Only corrections teach it, and one word repeated all week cannot outvote everything else.',
  'show-thinking': 'For a reasoning model: the latest thought as a live line, the whole of it one click away. Useful when an answer is going wrong and you want to see where it turned.',

  // ---- Privacy & security --------------------------------------------------
  adblock: 'A real filter engine with the lists an extension would use, running before the request leaves — so no extension to install, and it works in Tor tabs where extensions cannot go. One site can be exempted without switching the rest off.',
  'consent-banners': 'The "we value your privacy" box is answered with the most private option available and taken off the page. Where a site only offers "accept", it is dismissed rather than agreed to.',
  'privacy-report': 'What was actually blocked, and whether fingerprint and DNS protection are really on — rather than the reassuring number most browsers show. Worth checking after changing anything.',
  trackerreceipts: 'A week of tracking written as a report: who tried hardest to follow you, and which sites let them in. It names sites you trust, which is the point.',
  fingerprint: 'Randomises the canvas, WebGL and audio signals that identify your exact machine between visits. A handful of sites notice and complain; Site identity tells you when that is what is happening.',
  doh: 'Encrypts the lookup that says which sites you are visiting, so the network you are on cannot read or redirect it. It does not hide the traffic itself — that is what Tor and a proxy are for.',
  'https-only': 'Refuses plain unencrypted pages instead of quietly loading them. On the rare site that has no HTTPS at all, you are asked rather than blocked.',
  tor: 'A tab routed through Tor, DNS included, with Vex downloading and running Tor itself — no Tor Browser needed. It is slow by nature, so use it for the page that needs it rather than for everything.',
  'routing-all': 'Routing already worked per container, which is the right shape for “this account goes through Tor” and the wrong shape for what people mean by a VPN. This applies one route — Tor, or a proxy you already have — to every tab and every container in a single pass, and puts it back after a restart. It can also be checked: Vex asks what address the internet sees through the route, asks the same question again through a session with no route at all, and shows you both, because a claim that traffic is routed is worth nothing and two addresses side by side are worth something. Vex is not a VPN service and does not run one; anything outside Vex goes the way it always did.',
  'site-routes': 'A rule is a host and a route: name example.com and every tab that goes there opens in a session that is routed through Tor or through your proxy, while the rest of your browsing stays ordinary. A rule for a domain covers its subdomains. The routed session is armed when Vex starts and is held closed until the route is really up — if Tor has not started, the site does not load, rather than quietly loading direct. It is a separate cookie jar, so a site opened by a rule is signed out of, and a tab you deliberately opened in a container is left exactly where it is.',
  routing: 'Sends a whole container through Tor or your own proxy and keeps it that way, so every tab opened from it inherits the route. The setting lives with the container, not with the tab.',
  dpi: 'Defeats DNS and SNI blocking with a local proxy — no VPN, no admin rights. Light mode is enough for most networks; the stronger desync mode exists for the ones that fight back.',
  otr: 'A tab that keeps no history and throws its cookies away the moment it closes. Everything else in the window carries on as normal, which is the difference from a private window.',
  identity: 'A fresh session and a fresh fingerprint at once: nothing carries over from anything you are signed into. For the account that must not be linked to the others.',
  'private-window': 'A whole window that remembers nothing when it closes. Downloads still land on disk, and the network still sees the traffic — it is amnesia, not invisibility.',
  permissions: 'Who got your location, microphone, camera, notifications or USB, and taking it back in one click. Vex asks per site and never grants by default.',
  clearsite: 'Wipes one site’s cookies and storage and reloads it. The cure for a stuck login, a stale "your browser is unsupported", or a cart that will not empty.',
  sitedata: 'Every cookie and stored item for one site, listed one by one, with the value editable. For the times when clearing everything would sign you out of the thing you are trying to fix.',
  siterules: 'Three switches per site: JavaScript, cookies, and content loaded from other hosts. The third one is the trap — YouTube serves its video from another host, so switching it off gives a black player; the toolbar now marks a site that is being held back.',
  siteidentity: 'Exactly what this page can see about your browser, with a verdict on why a site might be refusing to work. Start here when a site behaves oddly only in Vex.',
  pwhealth: 'Finds reused passwords, weak ones (short, common, repeating, or built from your username or the site name), passwords not changed in a year, and accounts with no second factor — checked on this machine against local data, never by uploading your vault.',

  // ---- Reading -------------------------------------------------------------
  pagediff: 'Marks the paragraphs that were not here last time you read the page: a changelog, a wiki page, a thread you are following. It compares against your own last visit, so it is private by construction.',
  'translate-side': 'Leaves the original in place and puts the translation under each paragraph, so you can check it as you read. The usual whole-page translate replaces the text instead.',
  dictionary: 'Double-click a word and its meaning appears beside it. Off until you turn it on, because double-click means something else on plenty of sites.',
  'reading-mode': 'Strips the page to the article: no sidebars, no popups, no newsletter box. It also makes Read aloud and Speed read behave, since both work from the same cleaned text.',
  readaloud: 'Reads the page out loud so you can listen while doing something else. It reads the cleaned article when reading mode can find one, which avoids hearing the navigation menu.',
  bionic: 'Bolds the first part of every word, which many people find pulls the eye along faster. Worth ten seconds of trying before deciding.',
  speedread: 'Flashes one word at a time at a speed you set, so your eyes never move. Good for a long article you want the shape of, poor for anything you need to weigh.',
  readfree: 'Resets a metered "three free articles this month" counter, or finds a free archived copy. It does not break a paid subscription wall, and it will say so.',
  copyunlock: 'Re-enables selecting, copying and right-clicking on sites that switched them off. For documentation and recipes that decided you should not have the text.',
  doctext: 'Pulls the text out of a Google Doc or a copy-locked page, reading the characters off the screen when that is the only way. Slower than copying, and it works where copying does not.',
  translate: 'The whole page in your language, or just the sentence you selected. For reading alongside the original, use Translate side by side.',
  annotations: 'A highlight that is still there months later when you come back to the page. They are stored here, not with the site, so nobody else sees them.',
  accessibility: 'A dyslexia-friendly font, colour-blind filters, and a reading ruler that follows the cursor. Each is independent — the ruler is useful on a wall of text whatever your eyesight.',
  zoom: 'Zoom remembered per site, so the one with tiny type is always readable without touching the others. Ctrl+0 resets the site you are on.',
  cite: 'A citation in APA, MLA, Harvard, Chicago or BibTeX, built from what the page publishes about itself. Check the author field on sites that publish nothing — it can only use what is there.',
  'save-pdf': 'The page straight to a PDF file, with no print dialog and no destination menu in the way.',
  'save-page': 'The whole page as one file that opens offline, for the article that will be paywalled or deleted next month. Pictures and styling come with it.',
  cards: 'Turns your highlights into cards and brings each one back on a spacing that grows while you keep getting it right. For learning something rather than merely reading it.',

  // ---- Media ---------------------------------------------------------------
  drm: 'Netflix, Spotify, Prime Video and Disney+ play here, which most Electron-based browsers cannot do at all. If playback fails, it is nearly always the signature on the build rather than the site — Settings › About says which.',
  screenshare: 'When a site asks for your screen you choose the source, the resolution up to 1440p, the frame rate, and whether sound goes with it. Vex’s own picker, not the site’s.',
  'media-grabber': 'Finds what is playing on the page and offers to save it. It works on ordinary media files, not on protected streams.',
  volume: 'One slider from 0 to 500% across every tab, including louder than the video was mixed. For the interview recorded three rooms away.',
  nowplaying: 'Everything making sound, in one place, with the controls for it. The fastest way to find which of forty tabs started talking.',
  mute: 'Silence one tab, or everything except this one. Ctrl+M on the tab you are on; right-click for the rest.',
  nightaudio: 'Brings quiet dialogue up and holds explosions down on this site, so a film at night does not need a hand on the volume. Remembered per site.',
  videonote: 'Writes a note about the video at the second it is on now, as a link back to that second. One note per video, so it builds into a set of timestamps.',
  screenshot: 'The visible page, the whole scrolling page, or a region you drag — then annotate it before saving.',
  'screenshot-full': 'The whole page top to bottom in one image: the long receipt, the thread, the article with its chart at the end.',
  markup: 'Draw on a picture of the page — pen, highlighter, boxes, arrows, text — and black out anything private before sending it.',
  whiteboard: 'A blank page to sketch on with the same tools as Mark Up. It saves as a file, so it is a scratchpad you can keep.',
  'record-screen': 'Records a screen or a window with its sound to a video file, with no recorder to install. It writes to disk as it goes, so a long recording will not vanish.',
  clips: 'Your recordings folder, newest first, with when each was made and how big it is. Click one to watch it without leaving Vex.',
  'page-images': 'Every picture on the page at the largest size the page offers, to save one at a time or all at once. Useful when the page hides the original behind a thumbnail.',
  qr: 'Point a phone camera at the screen and the page opens there — no typing an address, no signing into anything to send it. For the long link and the thing you want to carry with you.',
  gaming: 'When a full-screen game starts, Vex frees the graphics card, sleeps background tabs and holds notifications. It undoes all of it when you come back.',
  'game-control-center': 'Vex looks for the app in this order: the location you chose in Settings, the Start menu shortcut called Game Control Center, the installed-programs list, and C:\\Program Files\\Game Control Center. It only ever starts a file named exactly Game Control Center.exe, and it runs on its own, so it stays open if you close Vex. If it cannot be found, Vex lists where it looked and offers Choose location\u2026.',
  live: 'The Twitch and YouTube channels you follow, and which are on right now, read from their own public pages — no account and no API key. It says something once when a channel goes live, not again until it goes off and comes back.',
  codecfixes: 'Quiet repairs that ship switched on: Spotify DRM, TikTok and Instagram video, Discord staying connected. Listed so that you know they are there when something behaves differently from another browser.',
  freegames: 'What Epic and Steam are giving away this week, and what is next, from the stores’ own lists. Claiming still happens in the store.',

  // ---- Productivity --------------------------------------------------------
  meeting: 'One switch for a call: reminders wait, every other tab making a sound is muted, and a note opens with the time on it. Lines you type are timestamped, so the note is usable afterwards.',
  notes: 'Markdown notes with tags, pinning and search, beside the page instead of in another program. Checklist items in them feed the To-do list, so a note is also a place to put work.',
  stickynote: 'A note pinned to one page, which reappears every time you return to it. For the form you always fill in wrong and the docs page with the detail you keep forgetting.',
  clip: 'Sends the selected text into your notes with a link back to where it came from, so a quote keeps its source.',
  todo: 'Every open checklist item from every note, in one list, sorted by due date. Ticking it here ticks it in the note — there is one copy, not two.',
  'todo-board': 'The same note tasks as three columns: To do, Doing, Done. The move is written back into the note, so the board and the notes can never disagree.',
  'price-history': 'Notes the price on product pages you open, from the data shops publish for search engines, and shows you what it has been. It only knows the pages you visited — it is a memory, not a price tracker.',
  calendar: 'A month of your reminders, repeats included, plus the dated to-dos from your notes. Click a day to see what is on it.',
  parcels: 'Paste a tracking number and Vex works out whose it is and opens the right tracking page. It recognises UPS, USPS, FedEx, DHL, Royal Mail, Amazon and more.',
  expenses: 'What you spent, kept on this computer: this month by category, against last month, and out as CSV when you want a spreadsheet. Nothing is uploaded anywhere.',
  habits: 'A tick for each day you did something, with the streak and your best. The last seven days are on the start page, which is the part that makes it work.',
  projects: 'A folder for one topic: the pages, your notes, and the AI conversations about it. Most browsers make you keep those three in three different places.',
  snippets: 'An abbreviation that becomes the text you keep retyping — type it in any box on any page and press Tab. For addresses, signatures, and the paragraph you send every week.',
  'clipboard-history': 'The thing you copied before the thing you copied. Web pages only, never your other programs, and never saved to disk.',
  library: 'Two things in one place: what you saved to read later, and the full reference to everything Vex can do. Tabs you abandoned are archived into the saved side automatically rather than rotting open.',
  bookmarks: 'Bookmarks in folders with a star in the address bar. The folder bar can be shown or hidden per look.',
  feeds: 'An RSS reader in the sidebar, for the sites that still publish a feed. The reading digest lists what is new in them under your saved articles.',
  history: 'Everywhere you have been, by day, searchable by keyword or by meaning, deletable by site or by day. The meaning search is the one to use when you cannot remember the words.',
  watch: 'Tells you when a page changes — a restock, a status page, a result you are waiting on. It checks in the background and says what changed, not just that something did.',
  wayback: 'Opens the archived copy of a page that has gone dead, or archives one before it does. Worth doing to a source you are citing.',
  focus: 'Hides the browser chrome and blocks the sites you lose time to, for 25 or 50 minutes. Reminders wait until it ends unless you marked one urgent.',
  focusflows: 'A named work mode: one click opens a set of tabs, switches the AI persona, dims the interface and turns blocking on. For the shape of an afternoon rather than a single session.',
  remind: 'Paste what you have to do, type "in 2 hours" or "tomorrow 9am", and a desktop notification arrives. Windows is told to wake for it, so a reminder set for the morning survives the machine sleeping.',
  'remind-repeat': 'Every day, weekdays or weekly at the same time, with each occurrence given its own wake-up rather than one that drifts.',
  'remind-page': 'A reminder can carry the page you were on, and its notification opens it. For "come back to this when you have time".',
  'remind-site': 'Instead of a time, say "when I open github.com" — the reminder fires the moment a tab lands there. The right answer for "remember to do this next time I am in there".',
  'remind-zone': 'Type "9am New York time" and the reminder lands at that moment, read back to you in both zones so you can see what you agreed to.',
  'remind-calendar': 'Any timed reminder can be saved as a .ics file for Outlook or Google Calendar, repeat rule included.',
  'reminders-sync': 'With Sync on, a reminder set on the laptop rings on the desktop too. Only the machine that set it schedules the wake-up, so it does not ring twice.',
  'quick-capture': 'Select anything on any page and right-click: remind me about this, save it as a note for this page, or ask Vex about it. It works inside the sidebar panels too, which is where most of what you want to keep actually is.',
  today: 'The one screen for "what is happening today": reminders due, scheduled tasks about to run, watched pages that changed, and what you saved recently. It sits on the new tab page, so you see it without going anywhere.',
  'focus-reminders': 'During a focus session reminders wait and arrive together at the end, unless you marked one urgent when you set it.',
  'today-work': 'Reminders and alarms remember which job they were set under, so the work ones can be kept apart from the rest and looked at together.',
  'toast-snooze': 'The Windows notification itself has Snooze 9 min and Open on it, so a reminder can be dealt with without coming back to the browser.',
  clock: 'Alarms that ring until dismissed — Windows is woken for them even if Vex was closed — plus timers and a stopwatch. The tone and volume are yours to set.',
  'alarm-sound': 'Four tones, a volume, and insistent or gentle: once, or every thirty seconds until you deal with it. Preview each before choosing.',
  mail: 'Your newest mail from Gmail, Yahoo, iCloud or any IMAP account, read-only — reading here never marks anything read on the server. For glancing, not for replying.',
  dictate: 'Speak and it is typed where the cursor was, in a page or in Vex. Whisper runs on this machine, so nothing is sent anywhere; the model downloads once, after asking.',
  'do-again': 'Runs the last Ctrl+K command again and says which one it was. Ctrl+Alt+A does it from anywhere in Vex.',
  'quick-commands': 'Ctrl+K understands plain sentences: "remind me to call Dana tomorrow 9am", "timer 25 min", "alarm 7am weekdays", "what time is it in Tokyo". No syntax to learn and nothing to open first.',
  'weekly-review': 'Every Friday at five, one honest card: what fired, what you snoozed, and what you never did. It is the part that keeps a reminder system from quietly becoming a graveyard.',
  'tool-history': 'Every tool keeps its last ten results, and the Toolbox lists what you opened recently. For the conversion you did yesterday and now need again.',
  automations: 'When this, do that: when a page opens, or at a time each day, run a command or open something. It all runs on this machine.',
  chains: 'Bundle several commands into one — reading mode, then read aloud — and put the first three on a shortcut. The cheapest automation in Vex.',
  toolbox: 'Over three hundred small tools that run locally: converters, regex, JSON, hashes, colour, loans, dates. Nothing is uploaded, which matters for the ones you would otherwise paste into a website.',
  'toolbox-reference': 'Each tool opens with the written reference beside it — the categories, the traps, the lookup table you would otherwise go and find. The reference is the reason to use the tool here rather than a search result.',
  'toolbox-full': 'Every tool is a compact panel or, with one click, a full-screen workspace with the reference open. Use the big one when the tool is the job rather than a detour.',
  'toolbox-favourites': 'Star the tools you keep coming back to and they sit at the top, ahead of the other three hundred.',
  jobsetup: 'Pick your profession and Vex sets a fitting theme and puts the tools that job actually uses within reach. It changes what is on the toolbar, which is why it is worth re-running if your work changes.',
  resmon: 'Live CPU and memory for every process Vex runs. Running tasks is the newer screen and can also end one.',
  downloads: 'Downloads you can pause, resume, cancel and retry, with the real byte counts. The toolbar button shows the bar while one is running, with how much of how much, how fast, and how long is left. Any running download can be told to open the moment it finishes \u2014 asked once, at the start, which is when you know you are waiting for it, rather than caught in a toast that has already gone. It is not a way round the safety check: an installer opened that way is asked about exactly as one opened by hand \u2014 who signed it and where it came from \u2014 because waiting for a file is not consent to run an unsigned program.',
  sendphone: 'Hands the page to your phone by QR code, or straight to your other machine if Sync is on.',
  queue: 'Your saved articles read aloud as a playlist that advances itself, with a spoken line between them. Hands free, which is the point.',
  autorefresh: 'Reloads a tab on a timer — live scores, a build log, a status page. The interval is per tab.',
  pasteandgo: 'Opens whatever address is on the clipboard, or searches it if it is not an address. One step instead of three.',
  'open-links': 'Paste a pile of links — a list, a comma mess, a chat message — and each opens in its own tab. It finds the addresses in the mess rather than asking you to tidy it first.',
  triage: 'Sorts unread mail into what wants an answer, what is worth a look, and bulk grouped by sender. It reads, it never sends, and nothing is marked read on the server.',
  latency: 'Times your own connection against Discord, Steam, Riot, Roblox, Epic and YouTube and says in one sentence whether it is you or them. For the argument you have with yourself every time a game lags.',

  // ---- Sidebar panels ------------------------------------------------------
  'panel-whatsapp': 'WhatsApp beside the page, staying signed in, with unread counts on its icon. It sleeps when hidden unless you keep it awake.',
  'panel-claude': 'Claude in the sidebar; right-click the icon to switch it to Gemini or ChatGPT. This is the web app, separate from Vex own AI panel.',
  'panel-spotify': 'Spotify in the sidebar, playing while you browse. Protected audio works here, which is not true of most Electron browsers.',
  'panel-discord': 'Discord beside the page, with the fix that keeps it connected and optional Vencord support. It is the heaviest panel by far — if memory matters, let it sleep when hidden rather than keeping it awake.',
  'panel-roblox': 'Roblox in its own session, with the censorship bypass for networks that block it.',
  'panel-github': 'Your GitHub one click away, signed in separately from anything else.',
  'panel-netflix': 'Netflix in the sidebar; right-click the icon to switch it to Prime Video or Disney+. They share one session, so switching does not sign you out of the others.',
  'panel-authenticator': 'Your 2FA codes generated here, with a ring showing how long each one has left. Add an account by scanning a screenshot of its QR code. Rename an account with its pencil (imports often arrive as just “Account”), and search the list once you have six or more.',
  pinsite2: 'Any site at all can become a panel, with its own session and its own unread badge. This is how a web app you use all day stops being a lost tab.',

  // ---- Logins & autofill ---------------------------------------------------
  passwords: 'A vault encrypted by Windows itself, that offers to save a login and fills it in when you click the sign-in field. Nothing is stored in a file you could read, and nothing leaves the machine unless you turn on Passwords in Vex Sync, which carries them end-to-end encrypted to your other devices.',
  totp: 'Vex generates your six-digit code and types it into the 2FA screen. The secret lives in the same encrypted vault as the password.',
  passkeys: 'Vex is a passkey provider: when a site offers to create a passkey, Vex asks you first and keeps the key encrypted on this computer, and when a site asks you to sign in with one, Vex shows your passkeys for that site and signs. The private key never leaves Vex and cannot be exported.',
  emailcode: 'Reads the verification code out of your Gmail and fills it, with no Gmail tab open. It reads only the message that has just arrived and only the code in it.',
  formfill: 'One saved profile fills any signup or checkout form. Card numbers are never stored, by design.',
  filltotp: 'For the page where the automatic fill did not happen: a code box that opened late, or one Vex did not recognise. Click into the box first and the code goes there; with several accounts it asks which one, and remembers the choice for that site. Never in a private or Tor tab, and only on https pages.',
  savepassword: 'For a site that signs you in with a script, so the automatic Save password card never appears. You type (or generate) the login yourself and it goes into the same encrypted vault as any other. Not from private or Tor tabs, and only on https pages.',
  genpassword: 'Click into the password field first, or right-click it, and Vex fills it and its confirm box with a new random password made on your computer. It copies nothing, so it offers to save the password at once; if you dismiss that, the only copy is the one in the page.',
  'panel-page-tab': 'A panel shows a page with no address bar, so a Roblox game ID or a Discord invite link was hard to get at. This opens exactly the page the panel is showing as a normal tab, in the same session, so you stay signed in. In a private window the tab stays inside that window.',
  leakcanary: 'Warns you when one of your own saved email addresses turns up pre-filled on a site you never gave it to — a sign it was passed on or leaked.',
  burner: 'One click for a throwaway identity: a session that forgets everything, opened on a disposable email address. For the download that wants your address first.',

  // ---- Make it yours -------------------------------------------------------
  'search-engine': 'Which engine the address bar uses — Google, DuckDuckGo, Brave or Bing. Per-site search shortcuts are separate and live in Settings.',
  skin: 'A theme says what colour Vex is; a skin says what it is made of. The texture is drawn in the theme’s own ink at a strength you choose, so it follows every theme rather than fighting it, and it is only ever on Vex’s own surfaces — a web page is never touched. Shape and light are separate choices, so sharp corners with a barely-there texture is a perfectly good answer.',
  font: 'Every panel, menu and button in Vex, in the face you pick \u2014 and the code font separately, so numbers and shortcuts still line up whatever you choose. Pages are never touched: a site keeps its own typography. Everything offered is already on the machine, so nothing is downloaded and it works offline.',
  uisize: 'Page zoom makes a web page bigger and does nothing at all for Vex\u2019s own tab strip, sidebar, menus and settings \u2014 which is exactly what someone who cannot read twelve-pixel type needs bigger. Five sizes, from ten per cent smaller to half again larger, and they take the icons, the paddings and the borders with them rather than leaving full-size icons around shrunken text. Density is the other direction: four settings for how tightly the repeating rows are packed, so a large screen can show far more of a list. A panel holding a web page keeps its natural size, because a page has its own zoom and scaling it here would fight that. Both live on the font screen.',
  // Counted, not written down: the number drifted every time a theme was added.
  get themes() { return 'Vex has ' + ThemeManager.THEMES.length + ' themes, and the whole interface follows, including the new tab page. Firefox Light and Firefox Dark are there if you want the colours to match the Firefox look.'; },
  'theme-editor': 'Settings › Appearance › Your themes › Make your own, or Customise this theme on any card in the theme picker. Nine colours make the whole theme; Vex works out the rest. Cancel puts back exactly what was there, and a theme of yours syncs to your other devices (its New Tab picture stays on this one).',
  'theme-from-picture': 'Settings › Appearance › Your themes › From a picture, or drop a PNG, JPEG or WebP picture on Settings. The picture is read on this computer and sent nowhere. The other side (a dark version of a light picture, say) is one click away in the editor.',
  'theme-auto': 'Settings › Appearance › Light and dark. Pick the light theme and the dark one, then whether Windows, a schedule or the sun decides. Your own themes, Chrome themes included, sit in the light or dark list by their background.',
  'chrome-themes': 'A Chrome theme is colours and pictures, so Vex takes exactly those: the frame becomes the background, the toolbar the surface, and the theme’s link or button colour the accent. Text that would be hard to read is made lighter or darker, and Vex says so. A package that also carries code is not added as a theme. It is deleted like any theme of yours.',
  guistyle: 'Wear a different browser: Chrome, Firefox, Safari, Internet Explorer on XP, or Netscape on 98. It changes the shape of the browser, not the colours — pick a theme for those.',
  'simple-mode': 'New profiles start here unless setup says otherwise; a profile from before it stays as it was. It is a view laid over your own setup, not a change to it: the sidebar buttons you hid or moved, your toolbar layout and your shortcuts are kept, and come back exactly as they were when you press All features. The settings search finds every setting either way.',
  editlayout:'Drag any toolbar button or sidebar icon somewhere else, or hide it, with presets for Default, Essentials and Minimal. Everything hidden is still reachable from Ctrl+K.',
  siteprofiles: 'Per-site zoom, forced dark mode and your own tweaks, remembered for that site alone.',
  boost: 'Your own CSS or JavaScript on a site, permanently. The honest version of a userscript manager, with nothing to install.',
  zap: 'Click the thing you never want to see on that site again and it is gone for good. For the cookie strip the blocker missed and the banner that comes back every visit.',
  airestyle: 'Describe a look — "declutter", "match my dark theme" — and the AI writes the CSS, saved as a per-site boost you can edit afterwards.',
  setupgallery: 'Your whole setup as a code you can paste on another machine or hand to someone else. Themes, layout, panels and settings travel; your data does not.',
  startpage: 'A start page with your name, the weather, your GitHub activity, a daily verse or quote and your own shortcuts. Every part of it can be switched off.',
  shortcuts: 'Two things in one screen: rebind what already has a key, and give a key to anything that has none — every command in Ctrl+K can have one, which is over two hundred of them. A few are fixed because Windows or Chromium claims them first, and those say so instead of pretending.',
  extensions: 'Install Chrome extensions from a folder, a .zip or a .crx. The manager says honestly which parts of an extension Electron cannot support — request blocking, for one — rather than letting it fail quietly.',
  'tools-bar': 'Pin any web app to the sidebar as a button of your own, with your choice of icon.',

  // ---- Developer tools -----------------------------------------------------
  devtools: 'The full Chromium developer tools on the page you are looking at, including the pages inside panels.',
  'dev-mode': 'Two ways to use any theme: user mode is the browser, developer mode adds a dashboard and the tools beside it. It changes what is on screen, not what is available.',
  'dev-dashboard': 'Live counts of tabs, storage and what Vex has loaded, with the actions you want while working on something.',
  apiclient: 'Send HTTP requests and read the JSON back as a tree, without leaving the browser or installing anything.',
  formatjson: 'A wall of raw JSON turned into something you can fold and read. It works on what is on the page as well as what you paste.',
  responsive: 'The same page at phone, tablet and desktop width, side by side, so you see all three at once rather than resizing.',
  'crawl-site': 'Follows the site links page by page and says what to fix: broken pages, and the ones missing what search engines read. For a site you own.',
  'check-links': 'Every link on the page asked whether it still works — broken, moved, or behind a login — with the offer to fix what it can.',
  'check-speed': 'How fast the page loaded, graded against Core Web Vitals, and what is slowing it down: the heaviest requests, named.',
  'check-a11y': 'Checks the page for what stops people using it: pictures with no description, unlabelled boxes, contrast that fails. It explains each one rather than listing rule numbers.',
  'recent-checks': 'The link, speed, accessibility and crawl checks you ran, newest first, to run again and compare. Every check of a page keeps its numbers so you can see whether it got better.',
  eyedropper: 'Sample the colour of any pixel on screen — a page, a video, another program — and get its hex. It is not limited to Vex own window.',

  // ---- Sync & your data ----------------------------------------------------
  sync: 'Tabs, bookmarks, history and settings on every machine you use, encrypted on your device before it leaves. You point it at a server you control; there is no Vex account.',
  export: 'Everything Vex has stored about you as one JSON file you can read. The file is yours, and importing it elsewhere puts it back.',
  whatsnew: 'What changed in this version and every version before it, in the app rather than on a website.',
  updates: 'Vex updates itself and tells you what it changed. A new version keeps a copy of your settings as they were, in case something goes wrong.',

  // ---- Only in Vex ---------------------------------------------------------
  receipts2: 'Your week in tracking as a report rather than a number: who followed you, from where, and how often. It names the sites you trust, which is the uncomfortable and useful part.',
  flows2: 'Work modes you can compose: tabs, persona, interface and blocking, all switched by one click and switched back afterwards.',
  podcast2: 'The articles you saved, read aloud as a playlist that advances itself. It turns a backlog into a commute.',
  restyle2: 'Redesign any website by describing what you want. The CSS it writes is saved as a boost, so you can keep it, edit it, or throw it away.',
  linkedscroll: 'In split screen, scroll one pane and the others keep pace. For two versions of the same document, or a translation beside its original.',
  stickynotes2: 'The difference from an ordinary note is where it lives: it is attached to the address, so it finds you rather than the other way round. For the page you always get wrong and the form with the field nobody can explain.',
  automations2: 'If-this-then-that for browsing, running entirely on your machine — no service, no account, nothing uploaded.',
  formfill2: 'One profile that fills any form on any site, and never touches card numbers.',
};

// === How it works ==========================================================
//
// For the entries you do with a key, a click on the page, or that simply
// happen. The Library draws one of these under "How it works" for every
// entry that is `manual` in the catalogue; an entry that cannot be opened at
// all (no command, panel, setting or control to point at) shows ONLY this and
// no button, so there is never a button that does nothing.
//
// Each one says what it does, when it happens, how to see or start it, and how
// to turn it off — or says plainly that there is no switch. Written from the
// code (the file is named in the comment), not from the marketing sentence:
// when the code changes, change the words here. tests/renderer/
// libraryOpenButtons.test.js fails for a manual entry that has none.
const FeatureHow = {
  // app.js: showFindBar / findOnActive
  'find-in-page': 'Press Ctrl+F with a page in front and a find bar opens over it. Type a word and the matches are highlighted and counted (for example 2/5); Enter goes to the next one, Shift+Enter to the previous one, Escape closes the bar. Each tab has its own find bar, and on Google Docs, which paints its text on a canvas, Ctrl+F is handed to the page’s own find. It is a key, so there is no button to press and nothing to switch off.',
  // tabs.js: _showKeepAwakeChooser, sidebar.js: keep awake for panels
  'keep-awake': 'Right-click a tab and choose “Prevent from sleeping…”, then pick how long: 1, 5, 12 or 24 hours, a custom time, or never (until you revert it). A tab kept awake is marked on the strip and is not put to sleep automatically; right-click it again, choose “Keep awake — change…” and press “Allow sleeping again” to undo it. A tab on a call or playing sound is never slept anyway. Panels have the same choice when you right-click their sidebar icon.',
  // mouse-gestures: the toggle in Settings
  gestures: 'Hold the right mouse button on a page and flick the mouse: left goes back, right goes forward and down-then-right closes the tab, among ten gestures in all. It is on by default. If it fires when you only meant to right-click, switch it off with “Mouse gestures” in Settings.',
  // panel-to-tab.js: the button on a web panel's bar, the sidebar icon's menu, Ctrl+K
  'panel-page-tab': 'Open a web panel (Roblox Hub, Discord, WhatsApp, a pinned site). On its bar, beside back, forward and reload, press the button that opens the page in a tab; or right-click its sidebar icon and choose Open in a tab (or Copy page link); or press Ctrl+K and type “page in a tab”. The tab opens next to the one you are on and the panel closes.',
  // main/passkeys.js, preload-passkeys.js, js/passkeys.js
  passkeys: 'When a site offers “Create a passkey”, a box from Vex asks whether to save one for that account; choose Save passkey, Not now, or Never for this site. When a site asks you to sign in with a passkey, a box lists your passkeys for that site and you pick one with Use passkey; with a field marked for passkeys, a short list appears under the field instead. If you set a Vex PIN (Settings › Privacy & Security), the PIN is what Vex asks for when the site insists on verifying you. Settings › Passkeys lists every passkey by site with Rename, Details and Delete (with Undo); the private key cannot be shown or exported. Sync is off by default: turn on Passkeys under Vex Sync › Choose what to sync to carry the passkeys you make from then on to your other devices. Not offered in private, Tor or burner tabs or while Vex is locked, and not in sign-in pop-up windows. Sites that insist on a passkey from one particular security-key model will not accept Vex; for a hardware key or your phone choose “Use a security key or phone”. To stop a site being offered passkeys, add it under Settings › Privacy & Security › “Don’t offer Vex passkeys on these sites”.',
  // main.js: handleExternalProtocol
  'apps-not-links': 'When a page links to roblox://, spotify:, steam:, vscode: or zoommtg:, Vex hands the link to the program you already have instead of showing an error. It only does so shortly after you clicked or pressed a key on that page, so an ad cannot launch anything on its own, and never from a private, off-the-record or Tor tab. The first time for a site and kind of link Vex asks, and remembers your answer; Site permissions lists those answers and lets you take one back.',
  // selection-ai-bar.js
  'selection-bar': 'Select some text on any page and a small bar appears just above it with Explain, Debug, Summarize and Translate; in a box you can type in it also offers Rewrite, Fix and Shorten, which write the result back into the box. Clicking one opens the AI panel and runs it on the selection. Press Escape or click elsewhere and the bar goes away. There is no switch for it: it only shows when you select text.',
  // quick-reminder.js
  'remind-repeat': 'In the Remind me box (Ctrl+K, then “Remind me”) the Repeat list offers Once, Every day, Weekdays or Every week at the time you typed. Each occurrence is given its own Windows wake-up, so a weekday 9am reminder still arrives with Vex closed. A reminder set for a site cannot repeat, and the list is greyed out for it.',
  // quick-reminder.js
  'remind-page': 'The Remind me box has an “About this page” box for the page in front. Tick it and the reminder keeps that page’s address, and its notification opens the reminder in Vex with an Open page button; leave it unticked and the reminder is just text. Start from Ctrl+K, then “Remind me”.',
  // quick-reminder.js
  'remind-site': 'Instead of a time, type “when I open github.com” (or press the “when I open this site” chip) in the Remind me box. The reminder waits and fires the moment a tab lands on that site, instead of at a clock time. It cannot also repeat. Start from Ctrl+K, then “Remind me”.',
  // webview.js: page context menu
  'quick-capture': 'Select text on a page — or in a sidebar panel such as Discord — and right-click. The menu offers “Remind me about this”, “Save as a note for this page” and “Ask Vex AI about this”, each using the selected words. It is a menu item, so there is nothing to open here and nothing to switch off.',
  // today.js, start.html
  today: 'The new tab page shows a Today section: reminders due today, scheduled tasks about to run, watched pages that changed and pages you saved recently. Vex refreshes what it shows every minute while the window is open. Open a new tab to see it, or use the button to go straight to the start page.',
  // focus mode + reminders
  'focus-reminders': 'While a focus session is running, reminders do not interrupt: they wait and arrive together when it ends. A reminder you marked “Urgent — even during focus” in the Remind me box is the exception and rings at once. Starting and ending a focus session is the Focus command; there is no separate switch for this part.',
  // quick-reminder.js: ics
  'remind-calendar': 'A timed reminder’s card has a Calendar button. Pressing it saves a .ics file for that reminder, with its repeat rule and an alarm, that Outlook and Google Calendar can import. Only reminders with a time have the button, not “when I open a site” ones. Make one from Ctrl+K, then “Remind me”.',
  // quick-commands.js
  'quick-commands': 'Open the command bar with Ctrl+K and type a plain sentence instead of a command name: “remind me to call Dana tomorrow 9am”, “timer 25 min”, “alarm 7am weekdays” or “what time is it in Tokyo”. Vex works the sentence out on this machine and Enter does it. A sentence it cannot read says so rather than guessing. There is no switch for it.',
  // main/reminders.js: toast actions
  'toast-snooze': 'When a reminder or alarm fires, the Windows notification carries two buttons, Snooze 9 min and Open. Snooze sets it again for nine minutes later without bringing Vex forward; Open brings the reminder up in Vex. Timers and the weekly review have no Snooze. It happens on the notification itself, so there is nothing to open in Vex.',
  // sync-engine.js
  'reminders-sync': 'With Vex Sync on and “Reminders and scheduled tasks” ticked under Choose what to sync, a reminder set on one machine appears on the others. Only the machine that set it asks Windows to wake for it, so it does not ring twice. Without Sync nothing leaves this computer. Settings has the Sync section.',
  // clock-panel.js
  'alarm-sound': 'In the Clock panel, on the Alarms tab, you pick the tone, the volume, and whether an alarm rings once or insistently, again every thirty seconds until you dismiss it. Each tone has a preview so you can hear it before choosing.',
  // job-work-panel.js
  'today-work': 'A reminder or alarm remembers the job it was set under. Today marks the ones that belong to your work, and the Work panel lists what is set for the job you are in. Open the Work panel to see them.',
  // quick-reminder.js: VexClock zones
  'remind-zone': 'In the Remind me box, add a place to the time: “9am New York time” or “tomorrow 17:00 in Tokyo”. Vex works out the moment in your own clock and reads it back in both before it saves, so you can see what you agreed to. Start from Ctrl+K, then “Remind me”.',
  // toolbox
  'tool-history': 'Each Toolbox tool keeps the last ten results you got from it, and the Toolbox lists the tools you opened most recently beside your favourites. It is all kept on this computer. Open the Toolbox and look at the tool’s own history or the recent list.',
  'toolbox-reference': 'Open any tool in the Toolbox and its written reference sits beside it: the categories, the traps and the lookup table. It is part of the tool, so it is always there and there is no setting for it.',
  'toolbox-full': 'Every Toolbox tool opens as a compact panel, or as a full-screen workspace with the reference open beside it when you press the button to expand it. Vex remembers which of the two you chose last. Open the Toolbox and pick a tool to try both.',
  'toolbox-favourites': 'Press the star on a tool in the Toolbox and it moves to the top of the list, ahead of the rest.',
  // main.js: DRM, castLabs build
  drm: 'Netflix, Spotify, Prime Video and Disney+ play because Vex is built on a version of Electron that carries the Widevine protected-media module, and the build is signed so the services accept it. It is automatic: open the site and press play. If playback says “DRM failed”, the signature on this build is the usual cause rather than the site; Settings › About shows what the build reports. There is no switch.',
  // main.js: display-media handler
  screenshare: 'This happens when a website asks to share your screen. Vex shows its own picker instead of the site’s: you choose the screen or window, the resolution up to 1440p, the frame rate, whether the sound goes with it and whether the cursor shows. Nothing is shared until you confirm there.',
  // master-volume.js
  volume: 'Master Volume is a popup with one slider from 0 to 500% that sets the sound of every tab and sidebar panel at once, with a button that mutes and unmutes. Opening it only shows the level; nothing changes until you move the slider. Above 100% it boosts louder than the source, which does not work on DRM streams such as Netflix. The level is remembered. It is also in the Quick Tools menu on the toolbar.',
  // tab-ai-media.js: NowPlaying
  nowplaying: 'When a tab starts playing sound, a small card appears at the bottom left of the window with its title, a play/pause button and a mute button. Click the card itself to go to that tab. It goes away when playback pauses or the tab closes, and several tabs stack up. It is automatic and has no switch.',
  // codec fixes
  codecfixes: 'These are repairs that ship switched on: Spotify protected audio, TikTok and Instagram video, Discord staying connected, and Google sign-in not calling Vex an insecure browser. They apply by themselves when you use those sites, so there is nothing to open. They are listed so you know about them if a site behaves differently here than in another browser.',
  // preload / devtools key
  devtools: 'Press F12 to open the Chromium developer tools on the page in front of you, including the pages inside sidebar panels. It is a key, so there is no button here to press and nothing to switch off.',
  // tabs: Settings > Tab Layout
  'vertical-tabs': 'Settings has a “Where tabs appear” choice: Horizontal (top bar) or Vertical (left sidebar). Down the side every tab keeps its full title, so thirty tabs stay readable. The choice applies to the Classic look; other looks arrange their own tab strip. Press Show me to see where the tab strip is.',
  // ai-panel.js: mentions
  tabmentions: 'In the AI panel’s message box, type @ and a list opens with your open tabs, your personas and your saved notes. Pick a tab and its text goes with the question without you switching to it. It is part of the message box, so there is nothing to turn on or off.',
  // chat-file.js
  chatfile: 'Drop a file on the AI panel: a PDF, or a text, Markdown, log, CSV, JSON, XML, HTML or subtitle file, up to 32 MB. It is read on this machine and the first 60,000 characters go with your next question; the file itself is not uploaded. Each tab keeps its own dropped file. A file of any other kind is refused with a message.',
  // agent-loop.js
  'agent-pause': 'The Pause button appears in the AI panel only while the agent is running. Pressing it holds the run between steps and leaves the page where it is; what you type while it is held becomes the agent’s next instruction, and it carries on from there. It is not there when the agent is idle, which is why there is nothing to open.',
  // agent: schedule tool
  'agent-schedule': 'Tell the agent in the AI panel what to repeat and when — “every weekday at 8:30, check the status page and note anything new” — and it creates the scheduled task itself. The task is listed in the Schedules panel like any other. Press Show me to find the box to type in.',
  // game-mode.js
  gaming: 'When a full-screen game starts, Vex frees the graphics card, sleeps background tabs and panels, stops its own animations and holds scheduled AI tasks. When the game ends it wakes the tabs one at a time and tells you what it did. Anything playing sound, on a call or kept awake is left alone. Each of the five behaviours has its own switch in Settings.',
};

if (typeof window !== 'undefined') { window.FeatureDetails = FeatureDetails; window.FeatureHow = FeatureHow; }
if (typeof module !== 'undefined' && module.exports) module.exports = { FeatureDetails, FeatureHow };
