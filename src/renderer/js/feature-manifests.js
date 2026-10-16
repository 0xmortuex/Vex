// === The manifests of the features that register with VexUsage ================
//
// One entry per feature that js/vex-usage-registry.js switches (the ~44 added
// in 2026-10), plus a few "core" entries for data that no switchable feature
// owns (the library, the registry's own records). Each says what the feature
// is called, what it owns in storage, which timers/commands it runs and what
// it may touch or send. Its title and Settings group are what VexUsage shows.
//
// "sends" was filled by reading each module for fetch / VexNet / AIRouter
// calls: [] means the module makes none of its own. A module that sends
// nothing itself can still be asked to send by another one (an AI answer goes
// to whatever backend you chose); that is the AI backend's line in the
// "what left this computer" ledger, not this feature's.
//
// Load order: after js/feature-registry.js, before js/vex-usage-registry.js.
(function () {
  const AI_ASK = 'Your question and the passages used, to your AI backend, only when that backend is the cloud one';

  // Features that share one preference record: the first owns the key, the rest use it.
  const brief = { group: 'Brief actions', usesKeys: ['vex.briefActions.prefs'] };
  const delight = { group: 'Little surprises', usesKeys: ['vex.delights.prefs'] };
  const workflow = { group: 'Workflow', usesKeys: ['vex.workflow.prefs'] };
  const playFlag = { group: 'Play', usesKeys: ['vex.fun.quiet'] };
  const living = { group: 'Living', usesKeys: ['vex.living', 'vex.fun.quiet'] };
  const fun = { group: 'Play: fun and progress', usesKeys: ['vex.fun'] };

  const quiet = (extra) => ({ reads: ['its own switch'], writes: ['its own switch'], sends: [], ...extra });

  const MANIFESTS = [
    // ---- Brief actions (js/brief-actions.js) ---------------------------------
    { id: 'brief-mail-triage', title: 'Mail triage in the brief', ...brief, usesKeys: [], storageKeys: ['vex.briefActions.prefs'],
      commands: [], permissions: { reads: ['mail headers from your read-only inbox'], writes: ['its own switch'], sends: ['The text of a message to your AI backend, only when you ask for a drafted reply'] } },
    { id: 'brief-github-desk', title: 'GitHub desk', ...brief, permissions: { reads: ['your GitHub username'], writes: ['its own switch'], sends: ['Requests to api.github.com with your username'] } },
    { id: 'brief-snooze', title: 'Snooze anything', ...brief, permissions: quiet({ reads: ['snoozed items'], writes: ['snoozed items'] }) },
    { id: 'brief-finder', title: 'Find a lost page', ...brief, permissions: quiet({ reads: ['your history'] }) },
    { id: 'brief-interests', title: 'Learn my interests', ...brief, permissions: quiet({ reads: ['your history'], writes: ['a list of interest words'] }) },
    { id: 'brief-day-layout', title: 'Order the brief by time of day', ...brief, permissions: quiet() },
    { id: 'brief-next-action', title: 'Suggest what I usually do next', ...brief, permissions: quiet({ reads: ['your command history'] }) },

    // ---- Little surprises (js/delights.js) -----------------------------------
    { id: 'delight-rabbit-hole', title: 'Take me somewhere interesting', ...delight, usesKeys: [], storageKeys: ['vex.delights.prefs'], permissions: quiet({ reads: ['your history'] }) },
    { id: 'delight-time-capsule', title: 'Time capsules', ...delight, permissions: quiet({ writes: ['capsule notes'] }) },
    { id: 'delight-on-this-day', title: 'On this day', ...delight, permissions: quiet({ reads: ['your history'] }) },
    { id: 'delight-old-bookmark', title: 'A forgotten bookmark', ...delight, permissions: quiet({ reads: ['your bookmarks'] }) },
    { id: 'delight-mood-themes', title: 'Mood themes', ...delight, permissions: quiet({ writes: ['the current look'] }) },
    { id: 'delight-widgets', title: 'Start page widgets', ...delight, permissions: quiet() },

    // ---- Workflow (js/resume-workday.js hub) ---------------------------------
    { id: 'workflow-ask-tabs', title: 'Ask across my tabs', ...workflow, usesKeys: [], storageKeys: ['vex.workflow.prefs'],
      permissions: { reads: ['the text of your open tabs'], writes: ['its own switch'], sends: [AI_ASK] } },
    { id: 'workflow-focus-auto', title: 'Switch focus profiles by itself', ...workflow, permissions: quiet({ writes: ['the active focus profile'] }) },
    { id: 'workflow-release-radar', title: 'Release radar', ...workflow, permissions: quiet({ reads: ['the projects you follow'] }) },
    { id: 'workflow-weekly-note', title: 'Weekly note', ...workflow, permissions: quiet({ reads: ['your week'], writes: ['one note per week'] }) },
    { id: 'workflow-resume-workday', title: 'Resume my workday', ...workflow, storageKeys: ['vex.workday'],
      jobs: ['Workday end-of-day save'], commands: ['workday-resume', 'workday-end'], permissions: quiet({ reads: ['your open tabs'], writes: ['one saved workday'] }) },

    // ---- enabled()/setEnabled() modules --------------------------------------
    { id: 'citations', title: 'Citations in Notes', group: 'Citations in Notes', storageKeys: ['vex.citations.enabled'], usesKeys: ['vex.notes'], permissions: quiet({ reads: ['pages you cite'], writes: ['citations inside notes'] }) },
    { id: 'knowledge-base', title: 'Knowledge base', group: 'Knowledge', storageKeys: ['vex.kb.enabled'],
      usesKeys: ['vex.annotations', 'vex.bookmarks', 'vex.notes', 'vex.readLater', 'vex.stickyNotes'],
      commands: ['kb-search', 'kb-ask-library', 'kb-ask-page', 'kb-ask-tabs', 'kb-related'],
      panels: ['library'],
      budget: { jobMsPerMin: 400 },
      permissions: { reads: ['your notes, bookmarks, read-later and the pages you read'], writes: ['a search index on this computer'], sends: [AI_ASK] } },
    { id: 'link-triage', title: 'Link triage', group: 'Link triage', storageKeys: ['vex.linkTriage.enabled'], permissions: quiet({ reads: ['links you paste or copy'] }) },
    { id: 'listen-reader', title: 'Listen to articles', group: 'Listen to articles', storageKeys: ['vex.listen.enabled', 'vex.listen.rate', 'vex.listenSnapshots'],
      commands: ['listen-open', 'listen-brief', 'listen-stop'], permissions: quiet({ reads: ['the article you are on'], writes: ['saved listening positions'] }) },
    { id: 'one-box', title: 'One box', group: 'One box', storageKeys: ['vex.oneBox.enabled', 'vex.githubUsername'], usesKeys: ['vex.notes'], permissions: quiet({ reads: ['your notes'] }) },
    { id: 'workspace-metrics', title: 'Workspace metrics', group: 'Workspace metrics', storageKeys: ['vex.workspaceMetrics', 'vex.workspaceMetricsOff'], usesKeys: ['vex.notes'], permissions: quiet({ reads: ['counts of your tabs, notes and sessions'], writes: ['daily counts'] }) },
    { id: 'fortune', title: 'Fortune', group: 'Fun and expression', storageKeys: ['vex.fortune'], tiers: { minimal: false, standard: true }, permissions: quiet() },
    { id: 'page-actions', title: 'Page actions', group: 'Page actions', storageKeys: ['vex.pageActions'],
      permissions: { reads: ['the page you are on'], writes: ['what you ran, so it can be undone'], sends: [] } },

    // ---- Fun and progress (js/fun/*) and Play (js/vex-fun.js) ------------------
    { id: 'fun-pet', title: 'Vex Pet', ...fun, usesKeys: [], storageKeys: ['vex.fun', 'vex.fun.medals', 'vex.fun.quiet'], permissions: quiet({ writes: ['pet and medal records'] }) },
    { id: 'fun-discovery', title: 'Discovery log', ...fun, permissions: quiet({ writes: ['what you discovered'] }) },
    { id: 'fun-levels', title: 'Browser levels', ...fun, permissions: quiet({ writes: ['your level'] }) },
    { id: 'fun-challenge', title: 'Daily challenge', ...fun, permissions: quiet({ writes: ['today’s challenge'] }) },
    { id: 'play-games', title: 'Offline mini games', ...playFlag, storageKeys: ['vex.fun.games'], permissions: quiet({ writes: ['scores'] }) },
    { id: 'play-tetris', title: 'Tab Tetris', ...playFlag, storageKeys: ['vex.fun.tetris'], permissions: quiet({ reads: ['your tab titles'], writes: ['scores'] }) },
    { id: 'play-word', title: 'Daily word', ...playFlag, storageKeys: ['vex.fun.word'], permissions: quiet({ writes: ['today’s word and streak'] }) },
    { id: 'play-sounds', title: 'Sounds', ...playFlag, storageKeys: ['vex.fun.sounds'], permissions: quiet() },

    // ---- Living (js/living-core.js) ------------------------------------------
    { id: 'living-tab-personality', title: 'Tab personality', ...living, usesKeys: ['vex.fun.quiet'], storageKeys: ['vex.living'], permissions: quiet({ reads: ['tab hosts'] }) },
    { id: 'living-tab-glow', title: 'Tab daily glow', ...living, permissions: quiet({ reads: ['tab hosts'] }) },
    { id: 'living-weather', title: 'Weather layer', ...living, permissions: quiet() },
    { id: 'living-stickers', title: 'Stickers', ...living, permissions: quiet({ writes: ['placed stickers'] }) },

    // ---- Preference objects and modes -----------------------------------------
    { id: 'distraction-budget', title: 'Distraction budget', group: 'Distraction budget', storageKeys: ['vex.distractionBudget'], permissions: quiet({ reads: ['the sites you visit, by category'], writes: ['minutes per category'] }) },
    { id: 'smart-bookmarks', title: 'Smart bookmarks', group: 'Smart bookmarks', storageKeys: ['vex.smartBookmarks', 'vex.smartBookmarks.prefs', 'vex.smartBookmarks.snaps'], usesKeys: ['vex.bookmarks'],
      jobs: ['Living bookmarks'], budget: { fetchesPerHour: 120 }, permissions: { reads: ['your bookmarks'], writes: ['page snapshots of bookmarks'], sends: ['A request to each bookmarked page, to see whether it changed'] } },
    { id: 'search-again', title: 'Search again', group: 'Search again', storageKeys: ['vex.searchAgain'], commands: ['search-again'], permissions: quiet({ reads: ['your recent searches'] }) },
    { id: 'command-aliases', title: 'Command aliases', group: 'Command aliases', storageKeys: ['vex.commandAliases', 'vex.commandAliases.prefs'], commands: ['alias-add', 'aliases'], permissions: quiet({ writes: ['your aliases'] }) },
    { id: 'meeting-prep', title: 'Meeting prep', group: 'Meeting prep', storageKeys: ['vex.meetingPrep.leadMinutes', 'vex.meetingPrep.mode', 'vex.meetingPrep.shown'], usesKeys: ['vex.notes'],
      jobs: ['Meeting prep'], permissions: quiet({ reads: ['your calendar and notes'] }) },
    { id: 'routine-detect', title: 'Routine detection', group: 'Routine', storageKeys: ['vex.routine.dismissed', 'vex.routine.log', 'vex.routine.mode'],
      jobs: ['Routine check'], permissions: quiet({ reads: ['which sites you open and when'], writes: ['a short log of routines'] }) },
    { id: 'tab-cleanup', title: 'Evening tab cleanup', group: 'Tab cleanup', storageKeys: ['vex.tabCleanup.days', 'vex.tabCleanup.hour', 'vex.tabCleanup.lastDay', 'vex.tabCleanup.mode'],
      jobs: ['Tab cleanup'], permissions: quiet({ reads: ['when each tab was last used'], writes: ['closes tabs you approve'] }) },

    // ---- what Vex does on its own to tabs and the theme -----------------------------
    // Kept on in Minimal Vex: they are the app's housekeeping (js/vex-minimal-mode.js reads tiers.minimal).
    { id: 'tab-auto-sleep', title: 'Sleep idle tabs by itself', tiers: { minimal: true, standard: true }, storageKeys: ['vex.autoSleepPrefs'], settingsKeys: ['setting-autosleep', 'setting-autosleep-minutes', 'setting-autosleep-exclude-pinned'],
      permissions: { reads: ['when each tab was last used'], writes: ['puts idle tabs to sleep, after asking'], sends: [] } },
    { id: 'tab-auto-group', title: 'Add new tabs to the group they match', tiers: { minimal: true, standard: true }, storageKeys: ['vex.autoAddToGroups', 'vex.groupPatterns'], settingsKeys: ['setting-auto-add-to-groups'],
      permissions: { reads: ['the address and title of a new tab'], writes: ['moves the tab into a group'], sends: [] } },
    { id: 'theme-auto', title: 'Light and dark by itself', tiers: { minimal: true, standard: true }, storageKeys: ['vex.themeAuto'], jobs: ['Light and dark'],
      permissions: { reads: ['the clock, Windows light/dark mode, a saved location'], writes: ['the current theme'], sends: [] } },

    // ---- Wave 2: capture tools --------------------------------------------------------
    { id: 'text-snippets', title: 'Text snippets', group: 'Text snippets', maturity: 'new', storageKeys: ['vex.textSnippets', 'vex.textSnippets.prefs'],
      permissions: { reads: ['the text box you press Tab or Space in, never a password, card or payment field'], writes: ['your snippet list and the sites it is off on'], sends: [] } },
    { id: 'table-extract', title: 'Copy tables and lists', group: 'Capture tools', maturity: 'new', storageKeys: ['vex.tableExtract.enabled'], commands: ['table-extract'],
      permissions: { reads: ['the table or list you click on a page'], writes: ['the clipboard or a note, when you ask'], sends: [] } },
    { id: 'video-tools', title: 'Video transcript, chapters and loop', group: 'Capture tools', maturity: 'new', storageKeys: ['vex.videoTools.enabled'], commands: ['video-tools'],
      permissions: { reads: ['the captions, chapters and position of the video on the page'], writes: ['a note, when you ask'], sends: [] } },
    { id: 'newsletter-lane', title: 'Newsletter lane', group: 'Capture tools', maturity: 'new', storageKeys: ['vex.newsletters', 'vex.newsletters.prefs'], jobs: ['Newsletter lane'], commands: ['newsletter-lane'],
      permissions: { reads: ['the senders and subjects of your newest mail, read-only, while the lane is open or weekly if you chose it'], writes: ['which senders you marked, Read Later and a digest note'], sends: [] } },
    { id: 'resurface', title: 'Bring back old highlights and notes', group: 'Capture tools', maturity: 'new', storageKeys: ['vex.resurface', 'vex.resurface.prefs'], usesKeys: ['vex.annotations', 'vex.notes'], jobs: ['Resurface highlights'], commands: ['resurface'],
      permissions: { reads: ['your highlights and notes'], writes: ['which ones it already brought back'], sends: [] } },
    { id: 'form-rescue', title: 'Unfinished forms', group: 'Unfinished forms', maturity: 'new', storageKeys: ['vex.formRescue.enabled', 'vex.formRescue.nudged'], commands: ['form-rescue'],
      permissions: { reads: ['text typed in plain boxes of a page you closed (never password, card or one-time-code fields)'], writes: ['that text, encrypted, for 7 days'], sends: [] } },
    { id: 'redact-tool', title: 'Redact pictures', group: 'Capture tools', maturity: 'new', storageKeys: ['vex.redact.enabled'], jobs: [],
      permissions: { reads: ['the screenshot or picture you open, read by on-device OCR'], writes: ['a redacted copy without metadata, when you save it'], sends: [] } },

    // ---- Wave 0: safety, attention and release features ---------------------------
    // All default ON in this build, so they are stable (a "new" feature would be staged OFF
    // on an existing profile). Minimal Vex switches each of them off and puts it back.
    { id: 'update-self-test', title: 'Check after an update', group: 'Update self-test', storageKeys: ['vex.selfTest.enabled', 'vex.selfTest.last', 'vex.selfTest.version'],
      permissions: { reads: ['the problems and the crash log of this version'], writes: ['the result of the last check'], sends: [] } },
    { id: 'signout-why', title: 'Say why a sign-in was lost', group: 'Sign-in', storageKeys: ['vex.signoutWhy', 'vex.signoutWhy.said'], commands: ['whysignedout'],
      permissions: { reads: ['which sites you were signed in to'], writes: ['what it already told you'], sends: [] } },
    { id: 'commit-guard', title: 'Protect Windows from running out of memory', group: 'Game mode', storageKeys: ['vex.game.commitGuard'],
      permissions: { reads: ['the memory Windows has left'], writes: ['puts Vex background work on hold while you play'], sends: [] } },
    { id: 'release-check', title: 'Release check', group: 'Release check', storageKeys: ['vex.releaseCheck', 'vex.releaseCheck.enabled', 'vex.releaseCheck.auto'], commands: ['release-check'],
      permissions: { reads: ['the change list of this version', 'which Ctrl+K commands you run'], writes: ['which items you ticked', 'which items Vex saw opened'], sends: [] } },

    // ---- Wave 2: gates and security ---------------------------------------------------------------
    // All new, so an existing profile has them off until it tries them (staged enablement).
    { id: 'perm-hygiene', title: 'Permission hygiene', group: 'Permission hygiene', maturity: 'new', storageKeys: ['vex.permHygiene.enabled', 'vex.permHygiene.config', 'vex.permHygiene.weekly'], jobs: ['Permission summary'], commands: ['perm-hygiene'],
      permissions: { reads: ['which sites you allowed to use the camera, microphone, location, screen, clipboard or notifications', 'which tab was just given them'], writes: ['the end date of a kept permission', 'a pin that keeps one'], sends: [] } },
    { id: 'signed-in', title: 'What am I signed in to', group: 'What am I signed in to', maturity: 'new', storageKeys: ['vex.signedIn.enabled'], commands: ['signed-in', 'session-leaked'],
      permissions: { reads: ['cookie names and dates (never values) and which sites have a saved login'], writes: ['clears the cookies and stored data of one site in every container, only when you confirm'], sends: [] } },
    { id: 'incident-playbooks', title: 'If something went wrong', group: 'If something went wrong', maturity: 'new', storageKeys: ['vex.incident.enabled', 'vex.incident.ticks'], commands: ['incident-playbooks'],
      permissions: { reads: ['the names, sizes and dates of files in your downloads folder (no file is opened)', 'your extension list'], writes: ['which steps you ticked'], sends: [] } },
    { id: 'credential-interlock', title: 'Password page check', group: 'Password page check', maturity: 'new', storageKeys: ['vex.credGuard.enabled'],
      permissions: { reads: ['the address of a page whose password field you focused, against the sites you have logins for'], writes: [], sends: [] } },
    { id: 'playfulness', title: 'Playfulness', group: 'Playfulness', storageKeys: ['vex.playfulness.prior'], usesKeys: ['vex.fun.quiet'],
      permissions: { reads: ['your Playfulness level, Game mode and the quiet switch'], writes: ['the level you chose'], sends: [] } },
    { id: 'attention-inbox', title: 'Attention Inbox', group: 'Attention', storageKeys: ['vex.attention.inbox', 'vex.attention.inboxOn'],
      permissions: { reads: ['the notices that did not fit the cap'], writes: ['the notices that did not fit the cap'], sends: [] } },
    // The calm New Tab layout is a layout choice, not an extra: Minimal Vex keeps it (killSwitch 'none', not in the usage table).
    { id: 'newtab-slots', title: 'New Tab layout', group: 'New Tab layout', killSwitch: 'none', maturity: 'stable', storageKeys: ['vex.newtab.layout'],
      permissions: { reads: ['which cards are available'], writes: ['the layout you chose'], sends: [] } },

    // ---- Wave 1: game helpers and the AI gate -----------------------------------------
    // New: they arrive OFF on a profile that already existed (staged enablement) and are offered. The
    // pre-game checklist is also off on a new profile until chosen (tiers.standard false).
    { id: 'game-flush', title: 'Save my work when a game starts', group: 'Game mode', maturity: 'new', storageKeys: ['vex.game.flush', 'vex.game.flush.last'],
      permissions: { reads: ['the open tabs, the note being typed and text in page boxes'], writes: ['an Auto-saved session and the settings still waiting to be written'], sends: [] } },
    { id: 'game-warmdown', title: 'Warm down when a game launcher opens', group: 'Game mode', maturity: 'new', storageKeys: ['vex.game.warmdown', 'vex.game.launchers'],
      permissions: { reads: ['the names of the launchers on your list'], writes: ['holds background work, and sleeps background tabs when Game mode is on'], sends: [] } },
    { id: 'game-pitstop', title: 'After-game pit-stop card', group: 'Game mode', maturity: 'new', storageKeys: ['vex.game.pitstop', 'vex.game.pitstop.last'], commands: ['gamepitstop:last'],
      permissions: { reads: ['what Vex held back during the game: notices, jobs, sync, slept tabs'], writes: ['the last card'], sends: [] } },
    { id: 'game-checklist', title: 'Pre-game checklist', group: 'Game mode', maturity: 'new', storageKeys: ['vex.game.checklist', 'vex.game.checklist.items'], tiers: { minimal: false, standard: false },
      permissions: { reads: ['your checklist, an unsaved note and the running downloads'], writes: ['your checklist'], sends: [] } },
    { id: 'ai-sensitivity', title: 'Sensitivity gate before cloud AI', group: 'AI', killSwitch: 'none', maturity: 'stable', storageKeys: [],
      permissions: { reads: ['the text of a request to the cloud AI, before it is sent'], writes: ['a ledger line for each request it holds back or lets through after you said yes'], sends: [] } },
    // ---- Wave 1: the developer loop (js/github-vault.js, js/dev-loop.js, js/dev-loop-ui.js) -------
    // All read-only. 'new': off for an existing profile until it is tried.
    { id: 'github-vault', title: 'GitHub access', group: 'GitHub access', maturity: 'new', storageKeys: ['vex.githubVault.enabled'], settingsKeys: [],
      permissions: { reads: ['GitHub data through a read-only token kept sealed in the main process'], writes: ['nothing on GitHub; its own switch'], sends: ['The token to api.github.com only, with read requests (never stored in the window, in backups or in sync)'] } },
    { id: 'ci-fix-loop', title: 'CI failure loop', group: 'Developer loop', maturity: 'new', storageKeys: ['vex.ciLoop'], usesKeys: ['vex.devLoop.repos'],
      jobs: ['CI failure check'], commands: ['ci-failures'], budget: { fetchesPerHour: 80 },
      permissions: { reads: ['failed GitHub Actions runs and job logs of your listed repositories'], writes: ['the cards of failed runs'], sends: ['Read requests to api.github.com; a log excerpt only to your local model, only when you ask'] } },
    { id: 'devlog-drafter', title: 'Devlog drafter', group: 'Developer loop', maturity: 'new', storageKeys: ['vex.devlog'], usesKeys: ['vex.devLoop.repos', 'vex.githubUsername', 'vex.notes'],
      commands: ['devlog-draft'],
      permissions: { reads: ['today\'s commits of your listed repositories'], writes: ['a note, when you save one'], sends: ['Read requests to api.github.com; the commit list only to your local model, only when you ask'] } },
    { id: 'endpoint-board', title: 'Endpoint health board', group: 'Developer loop', maturity: 'new', storageKeys: ['vex.endpoints'],
      jobs: ['Endpoint health'], commands: ['endpoint-board'], budget: { fetchesPerHour: 240 },
      permissions: { reads: ['the answer of each endpoint you listed'], writes: ['the board and its latencies'], sends: ['One GET (no credentials) to each https endpoint you listed'] } },
    { id: 'dependency-radar', title: 'Dependency radar', group: 'Developer loop', maturity: 'new', storageKeys: ['vex.depRadar'], usesKeys: ['vex.devLoop.repos'],
      jobs: ['Dependency radar'], commands: ['dependency-radar'], budget: { fetchesPerHour: 120 },
      permissions: { reads: ['package.json or pyproject.toml of your listed repositories'], writes: ['the radar results'], sends: ['Read requests to api.github.com, registry.npmjs.org, pypi.org and api.osv.dev (package names and versions only)'] } },
    { id: 'deploy-desk', title: 'Deploy desk', group: 'Developer loop', maturity: 'new', storageKeys: ['vex.deployDesk'], usesKeys: ['vex.history'],
      commands: ['deploy-desk'], permissions: { reads: ['how often your history visited the deploy hosts'], writes: ['the pages you pinned'], sends: [] } },
    { id: 'dev-loop-repos', title: 'Developer loop repositories', killSwitch: 'none', maturity: 'stable', storageKeys: ['vex.devLoop.repos'], commands: ['dev-loop'],
      permissions: { reads: ['the list of repositories you gave'], writes: ['the list of repositories you gave'], sends: [] } },
    // ---- Developer helpers (js/dev-helpers.js, Settings > Developer helpers) -------------------
    // New: each arrives OFF on a profile that already existed and is offered ("try it").
    { id: 'repo-registry', title: 'Repository registry and groups', group: 'Developer helpers', maturity: 'new', storageKeys: ['vex.repos', 'vex.repos.enabled'], commands: ['repos:manage'],
      permissions: { reads: ['the address of the tab in front'], writes: ['your repository list and the folder paths you chose; a tab group you accept'], sends: [] } },
    { id: 'search-bangs', title: 'Search bangs for docs, packages and games', group: 'Developer helpers', maturity: 'new', storageKeys: ['vex.searchBangs', 'vex.searchBangs.enabled'],
      permissions: { reads: ['what you type in the address bar'], writes: ['your bang table'], sends: ['The words you type, to the site whose bang you used'] } },
    { id: 'copy-as-request', title: 'Copy as cURL, fetch or PowerShell', group: 'Developer helpers', maturity: 'new', storageKeys: ['vex.copyAs.enabled'], commands: ['copy-as-request'],
      permissions: { reads: ['a link you right-click'], writes: ['the clipboard, when you press Copy'], sends: [] } },
    { id: 'github-helpers', title: 'GitHub page helpers', group: 'Developer helpers', maturity: 'new', storageKeys: ['vex.githubHelpers.enabled'],
      permissions: { reads: ['the commit SHA and line range on a github.com page you right-click'], writes: ['the clipboard, when you choose a row'], sends: [] } },
    { id: 'snippet-translator', title: 'Translate install and shell commands', group: 'Developer helpers', maturity: 'new', storageKeys: ['vex.snippetTranslator.enabled'],
      permissions: { reads: ['the text you select'], writes: ['the clipboard, when you press Copy'], sends: [] } },
    { id: 'selection-decoder', title: 'Decode selection', group: 'Developer helpers', maturity: 'new', storageKeys: ['vex.selectionDecoder.enabled'],
      permissions: { reads: ['the text you select'], writes: ['the clipboard, when you press Copy'], sends: [] } },
    { id: 'reference-sets', title: 'Reference sets', group: 'Developer helpers', maturity: 'new', storageKeys: ['vex.referenceSets', 'vex.referenceSets.enabled'], commands: ['refsets:manage', 'refsets:add', 'refsets:open'],
      permissions: { reads: ['the page in front, when you pin it'], writes: ['your sets of pages and snippets; tabs and a group when you open one'], sends: [] } },
    // ---- Wave 1: the daily flow (new: staged off on a profile that already exists) ----------
    { id: 'dueness', title: 'What is due', group: 'What is due', maturity: 'new', storageKeys: ['vex.dueness.enabled'], commands: ['due-now'],
      permissions: quiet({ reads: ['your reminders, @dated tasks in notes, calendar events and scheduled tasks'], writes: ['its own switch'] }) },
    { id: 'first-open', title: 'First open of the day', group: 'First open of the day', maturity: 'new', storageKeys: ['vex.firstOpen', 'vex.firstOpen.prefs'],
      permissions: quiet({ reads: ['when this window was last in front'], writes: ['when you were last here and which hours you come back at (24 counts)', 'opens a New Tab, when you chose that, with an Undo in the ledger'] }) },
    { id: 'inbox-unified', title: 'One inbox', group: 'Inbox', maturity: 'new', storageKeys: ['vex.inbox.enabled', 'vex.inbox.seen'], usesKeys: ['vex.notes', 'vex.readLater', 'vex.annotations', 'vex.stickyNotes'], commands: ['inbox-open'],
      permissions: quiet({ reads: ['your notes, saved pages, highlights, sticky notes and quick captures'], writes: ['when you last opened the inbox'] }) },
    { id: 'next-step', title: 'Next step per workspace', group: 'Next step', maturity: 'new', storageKeys: ['vex.nextStep', 'vex.nextStep.enabled'], commands: ['next-step-set', 'next-step-clear'],
      permissions: quiet({ reads: ['what is due and any running focus block'], writes: ['one line per workspace'] }) },
    { id: 'park-resume', title: 'Park and resume', group: 'Park and resume', maturity: 'new', storageKeys: ['vex.park', 'vex.park.enabled'], commands: ['park-here', 'park-list'],
      permissions: quiet({ reads: ['your open tabs and the scroll position of the front one'], writes: ['parked cards', 'reopens the tabs of a card when you press Resume, with an Undo in the ledger'] }) },
    { id: 'copy-source', title: 'Copy with source', group: 'Copy with source', maturity: 'new', storageKeys: ['vex.copySource.prefs'], commands: ['copy-selection-as'],
      permissions: quiet({ reads: ['the text you selected on the page in front, when you ask'], writes: ['the clipboard, when you pick a format'] }) },
    { id: 'deadline-extractor', title: 'Find deadlines', group: 'Find deadlines', maturity: 'new', storageKeys: ['vex.deadlines.enabled'], commands: ['find-deadlines'],
      permissions: quiet({ reads: ['the page in front, your recent notes or your mail subjects, when you ask'], writes: ['a reminder, only after you press Add on it'] }) },
    // ---- Wave 1: panels and messages (js/panels-comms-ui.js draws them all) ------------
    // All 'new': an existing profile gets them OFF and is offered them; none sends anything off this computer.
    { id: 'panel-capture', title: 'Notifications from panels', group: 'Panels and messages', maturity: 'new',
      storageKeys: ['vex.panelCapture.on', 'vex.panelCapture.sites', 'vex.panelCapture.items', 'vex.panelCapture.mutes'], usesKeys: ['vex.consents'],
      events: ['vex:panel-notification'], commands: ['panel-notifications'], panels: ['discord', 'whatsapp'],
      permissions: { reads: ['the title and the first 300 characters of a Discord or WhatsApp notification, for the sites you turn on'], writes: ['a list of them on this computer for 7 days, up to 200'], sends: [] } },
    { id: 'vip-rules', title: 'VIP people and words', group: 'Panels and messages', maturity: 'new',
      storageKeys: ['vex.vip'], events: ['vex:vip-changed'],
      permissions: { reads: ['the title and text of notifications and Inbox rows Vex already holds'], writes: ['your list of people, words and panels'], sends: [] } },
    { id: 'needs-me', title: 'Needs me', group: 'Panels and messages', maturity: 'new',
      storageKeys: ['vex.needsMe.on', 'vex.needsMe.weights', 'vex.needsMe.snoozed', 'vex.needsMe.dismissed', 'vex.needsMe.ranked'], commands: ['needs-me'],
      permissions: { reads: ['panel unread counts, kept notifications, the Inbox and Autopilot'], writes: ['what you snoozed, dismissed and usually open'], sends: [] } },
    { id: 'panel-state', title: 'Panel state and unread ledger', group: 'Panels and messages', maturity: 'new',
      storageKeys: ['vex.panelState.on', 'vex.panelState.strip', 'vex.panelState.ledger', 'vex.panelState.looked'], commands: ['panel-ledger'],
      permissions: { reads: ['the unread number in each panel title, and the song and artist a playing panel publishes'], writes: ['numbers and times of unread changes'], sends: [] } },
    { id: 'away-mode', title: 'Away mode', group: 'Panels and messages', maturity: 'new',
      storageKeys: ['vex.away.on', 'vex.away.state', 'vex.away.autoLock'], events: ['vex:away-summary'], commands: ['away-toggle'],
      permissions: { reads: ['kept notifications, the unread ledger and the Inbox, to count what happened'], writes: ['when you went away'], sends: [] } },
    { id: 'attention-digest', title: 'Delivery windows', group: 'Panels and messages', maturity: 'new',
      storageKeys: ['vex.digest.on', 'vex.digest.times', 'vex.digest.last', 'vex.digest.half', 'vex.digest.focusEnd'], jobs: ['Digest windows'],
      permissions: { reads: ['the Inbox and kept notifications'], writes: ['when the last digest was shown'], sends: [] } },
    { id: 'close-protect', title: 'Close-protect', group: 'Panels and messages', maturity: 'new',
      storageKeys: ['vex.closeProtect.on'],
      permissions: { reads: ['whether a tab plays sound, is in a call, or has a text box with something in it (yes or no, never the text)'], writes: ['its own switch'], sends: [] } },
    // ---- Wave 1: tab tools, the night coach and the announcement desk (all new: off on a profile that already existed, offered to try) ----
    { id: 'tab-mru', title: 'Ctrl+Tab by recency', group: 'Tab tools', maturity: 'new', storageKeys: ['vex.tabMru'], settingsKeys: [],
      permissions: { reads: ['which tabs you used last'], writes: ['nothing but its own switch'], sends: [] } },
    { id: 'tab-search', title: 'Search open tabs', group: 'Tab tools', maturity: 'new', storageKeys: ['vex.tabSearch'], commands: ['tab-search'],
      permissions: { reads: ['the titles and addresses of your open tabs'], writes: ['closes a tab only when you press Delete on it'], sends: [] } },
    { id: 'nav-history-menu', title: 'Back and Forward list', group: 'Tab tools', maturity: 'new', storageKeys: ['vex.navHistoryMenu'],
      permissions: { reads: ['the pages behind and ahead of the one you are on'], writes: ['nothing but its own switch'], sends: [] } },
    { id: 'strip-actions', title: 'Quick actions on the tab strip', group: 'Tab tools', maturity: 'new', storageKeys: ['vex.stripActions'],
      permissions: { reads: ['your open tabs and the clipboard when you right-click +'], writes: ['mutes, pins, duplicates or closes tabs when you press its buttons'], sends: [] } },
    { id: 'night-coach', title: 'Night usage coach', group: 'Night usage coach', maturity: 'new', storageKeys: ['vex.nightCoach', 'vex.nightCoach.log'],
      jobs: ['Night coach'], commands: ['nightcoach-quiet', 'nightcoach-week'], budget: { jobMsPerMin: 20 },
      permissions: { reads: ['whether the window is visible and the computer idle; your tabs when you accept to send some to later'], writes: ['minutes of use after bedtime, per night, for two weeks'], sends: [] } },
    { id: 'announce-desk', title: 'Announcement desk', group: 'Announcement desk', maturity: 'new', storageKeys: ['vex.announceDesk'],
      jobs: ['Announcement desk'], commands: ['announce-desk'], budget: { fetchesPerHour: 30 },
      permissions: { reads: ['the public pages you add, without signing in'], writes: ['page watches for those pages'], sends: ['A request for each page you add, once an hour (every 15 minutes on a result day)'] } },
    // ---- Wave 4: safer web fold-ins (js/chat-link-hygiene.js, js/safe-web-extras.js) -----
    { id: 'chat-link-hygiene', title: 'Chat link hygiene', group: 'Safer web', maturity: 'new', storageKeys: ['vex.safeWeb.linkHygiene'],
      permissions: { reads: ['the address of a link you right-click or copy, and of the page it is on'], writes: ['nothing but its own switch'], sends: [] } },
    { id: 'breach-recheck', title: 'Weekly breach re-check', group: 'Safer web', maturity: 'new', storageKeys: ['vex.safeWeb.breachRecheck', 'vex.safeWeb.breachSeen', 'vex.safeWeb.breachLast'],
      jobs: ['Breach re-check'], commands: ['backup-secrets-check'], budget: { fetchesPerHour: 1 },
      permissions: { reads: ['your saved passwords, in the main process, to hash them'], writes: ['short tags of which saved logins were already breached, and when it last ran'], sends: ['The first 5 characters of each password’s SHA-1 hash to Have I Been Pwned, once a week, only when you switch this on'] } },
    // ---- Wave 2: AI features (all local-model only; none has a cloud path of its own) -----
    { id: 'longdoc-engine', title: 'Long-document engine', group: 'Long documents', maturity: 'new', storageKeys: ['vex.longdoc.enabled'], jobs: [],
      budget: { jobMsPerMin: 0 }, permissions: { reads: ['text another feature hands it'], writes: ['its own switch'], sends: [] } },
    { id: 'thread-digest', title: 'Thread digest', group: 'Thread digest', maturity: 'new', storageKeys: ['vex.threadDigest', 'vex.threadDigest.enabled'], commands: ['thread-digest'],
      permissions: { reads: ['text you select, or the page in front after you say yes'], writes: ['short fingerprints of what you have read, per address'], sends: [] } },
    { id: 'draft-in-field', title: 'Draft into the field', group: 'Draft into the field', maturity: 'new', storageKeys: ['vex.draftField.enabled'], commands: ['draft-in-field'],
      permissions: { reads: ['the text of the box you are typing in, when you run the command'], writes: ['the box, only when you press the button'], sends: [] } },
    { id: 'embedding-manager', title: 'Embedding model manager', group: 'Search by meaning (embedding model)', maturity: 'new', storageKeys: ['vex.embedManager.enabled'], usesKeys: ['vex.recall.meaningModel'],
      permissions: { reads: ['which models your Ollama has'], writes: ['the embedding model Recall uses'], sends: ['A download request to your own Ollama, after you confirm'] } },
    { id: 'answer-citations', title: 'Show-me-where citations', group: 'Knowledge', maturity: 'new', storageKeys: ['vex.answerCitations.enabled'],
      permissions: { reads: ['the answer and the passages it was built from'], writes: ['nothing (the browser find mark clears itself)'], sends: [] } },
    { id: 'site-instructions', title: 'Site instructions and typed skills', group: 'Site instructions', maturity: 'new', storageKeys: ['vex.siteInstructions', 'vex.siteInstructions.enabled'], usesKeys: ['vex.skills'],
      commands: ['site-instruction-edit', 'skills-for-site'],
      permissions: { reads: ['the address of the page in front'], writes: ['your instructions'], sends: ['An instruction goes to your AI backend with each chat on that site; a cloud backend only if AI memory includes the cloud'] } },
    // ---- Wave 2: fixes and foundations (new, so staged OFF on a profile that already exists) ----
    { id: 'game-library', title: 'Installed games', group: 'Game mode', maturity: 'new', storageKeys: ['vex.gameLibrary.enabled', 'vex.gameLibrary.lastScan', 'vex.gameLibrary.skipped'],
      jobs: ['Game library check'], commands: ['game-library-find'],
      permissions: { reads: ['the Steam, Epic and Roblox install lists (file names only; nothing is opened or started)'], writes: ['a game on your Game mode list, only after you confirm it'], sends: [] } },
    { id: 'site-audio-memory', title: 'Volume kept per site', group: 'Volume', maturity: 'new', usesKeys: ['vex.masterVolume'], storageKeys: ['vex.masterVolume.sites', 'vex.masterVolume.siteMemory', 'vex.masterVolume.warned'],
      jobs: ['Loud volume reminder'], permissions: quiet({ reads: ['the site of each tab, to give it its kept level'], writes: ['a volume level per site'] }) },
    { id: 'link-routing', title: 'Links open in the matching panel', group: 'Links and panels', maturity: 'new', storageKeys: ['vex.linkRouting.enabled', 'vex.linkRouting.rules', 'vex.linkRouting.told'], commands: ['link-routing'],
      permissions: { reads: ['the address of a link that would open as a new tab'], writes: ['loads that link in the panel for the site; your rules'], sends: [] } },
    { id: 'refresh-on-deploy', title: 'Refresh after a successful build', group: 'Refresh after a build', maturity: 'new', storageKeys: ['vex.refreshOnDeploy.enabled', 'vex.refreshOnDeploy.sites'],
      permissions: { reads: ['which GitHub run succeeded and which tabs are open'], writes: ['reloads a tab, only when you press Refresh'], sends: [] } },
    { id: 'bypass-doctor', title: 'Site down or my bypass?', group: 'Bypass check', maturity: 'new', storageKeys: ['vex.bypassDoctor.enabled', 'vex.bypassDoctor.lastPreflight'], commands: ['site-or-bypass'],
      permissions: { reads: ['whether a site answers directly and through the bypass you already run'], writes: ['nothing: it never starts, stops or changes a bypass'], sends: ['One request to the address you ask about, and one to discord.com shortly after start'] } },
    { id: 'watch-alerts', title: 'One alert per change, digest first', group: 'Watcher alerts', maturity: 'new', storageKeys: ['vex.watchAlerts.enabled', 'vex.watchAlerts.instant'],
      permissions: { reads: ['alerts from the page watch, patch radar and GitHub watch'], writes: ['one line in the Attention Inbox per change'], sends: [] } },
    // ---- Wave 2: tabs and navigation (js/tabs-nav.js) ------------------------------------
    // Stable: passive ergonomics that never speak up on their own, on for everyone (Settings › Tabs and
    // navigation has a switch for each). Minimal Vex switches the whole module off and puts it back.
    { id: 'tabs-nav', title: 'Tabs and navigation extras', group: 'Tabs and navigation',
      storageKeys: ['vex.tabsNav.prefs', 'vex.tabsNav.findHistory', 'vex.tabsNav.typed', 'vex.tabsNav.defaultZoom'], commands: ['tabsnav:keep-on-top'],
      permissions: { reads: ['the selected words on the page, the address of your tabs, the titles of background tabs'], writes: ['your switches, the last 20 find-bar searches, how often you typed each site; keeps the Vex window on top when you ask'], sends: [] } },
    // ---- Wave 2: the developer desk (js/dev-desk.js and the files it draws Settings for) -----------
    // All 'new': off for an existing profile until tried. The editor/terminal switch itself lives in the main process.
    { id: 'dev-desk', title: 'Open in editor and terminal', group: 'Developer desk', maturity: 'new', storageKeys: [],
      permissions: { reads: ['the folders you granted (only .git/HEAD of a repository, for its branch name)'], writes: ['nothing'], sends: ['Starts your chosen editor or Windows Terminal with a fixed argument list, never through a shell, only inside folders you granted'] } },
    { id: 'dev-ports-pair', title: 'Dev ports', group: 'Developer desk', maturity: 'new', storageKeys: ['vex.devPorts', 'vex.devPorts.enabled'],
      jobs: ['Dev ports'], budget: { jobMsPerMin: 60, fetchesPerHour: 0 },
      permissions: { reads: ['whether the localhost ports you paired answer (a local connect only)'], writes: ['your pairs; reloads a tab when its port comes back'], sends: [] } },
    { id: 'actions-board', title: 'Actions board', group: 'Developer desk', maturity: 'new', storageKeys: ['vex.actionsBoard', 'vex.actionsBoard.enabled'],
      jobs: ['Actions board'], commands: ['actionsboard:open'], budget: { fetchesPerHour: 40 },
      permissions: { reads: ['the newest GitHub Actions run of each listed repository'], writes: ['the board and which failures you saw'], sends: ['Read requests to api.github.com through the GitHub vault'] } },
    { id: 'log-reader', title: 'Log reader', group: 'Developer desk', maturity: 'new', storageKeys: ['vex.logReader.enabled'],
      commands: ['logreader:tab', 'logreader:file'], permissions: { reads: ['a log file you pick, or the page in front (never a private or routed tab)'], writes: ['nothing'], sends: [] } },
    { id: 'plugin-dev', title: 'Plugin dev loop', group: 'Developer desk', maturity: 'new', storageKeys: ['vex.pluginDev.enabled'],
      commands: ['plugindev:open'], permissions: { reads: ['the source of the extension folder you picked; the installed Vencord builds (read-only)'], writes: ['loads that extension into the profile until you stop it'], sends: [] } },
    { id: 'electron-ticker', title: 'Electron ticker', group: 'Developer desk', maturity: 'new', storageKeys: ['vex.electronTicker', 'vex.electronTicker.enabled'],
      jobs: ['Electron ticker'], commands: ['electronticker:check'], budget: { fetchesPerHour: 2 },
      permissions: { reads: ['the public castLabs release list'], writes: ['which behind-number it already told you'], sends: ['One GET to api.github.com (no account, no data from you)'] } },
    { id: 'secret-guard', title: 'Secret paste guard', group: 'Developer desk', maturity: 'new', storageKeys: ['vex.secretGuard', 'vex.secretGuard.enabled'],
      commands: ['secretguard:clipboard'], permissions: { reads: ['text you paste into a web box or a Vex AI prompt (kept in memory, never stored or logged)'], writes: ['your allowed-sites list'], sends: [] } },

    // ---- Developer bench (js/dev-bench.js, Settings > Developer bench) ---------------------------
    // New: each arrives OFF everywhere and is switched on by hand.
    { id: 'bug-bundle', title: 'Copy bug report', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.bugBundle.enabled'], commands: ['bugbundle:copy'],
      permissions: { reads: ['console errors of the page in front and the addresses of its failed requests'], writes: ['the clipboard, when you copy'], sends: [] } },
    { id: 'response-overrides', title: 'Response overrides and header rules', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.overrides.enabled'], jobs: ['Overrides banner'], commands: ['overrides:open', 'overrides:off'],
      permissions: { reads: ['requests to the origins you listed'], writes: ['your rules, in the profile folder'], sends: [] } },
    { id: 'selection-tools', title: 'Selection to my own MCP tools', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.selectionTools', 'vex.selectionTools.enabled'],
      permissions: { reads: ['the text you select'], writes: ['your pinned tools'], sends: ['The selected words, to the MCP server you pinned, after you confirm the exact request'] } },
    { id: 'log-tailer', title: 'Serial / QEMU log tailer', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.logTailer.enabled'], jobs: ['Log tailer'], commands: ['logtail:file', 'logtail:socket'],
      permissions: { reads: ['the one file or local websocket you granted'], writes: [], sends: [] } },
    { id: 'error-memory', title: 'Error-message memory', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.errorMemory', 'vex.errorMemory.enabled'], jobs: ['Error memory'], commands: ['errormem:forget'],
      permissions: { reads: ['the words of a search that look like an error, and the address of the page you stay on'], writes: ['the error and the page that fixed it, on this computer'], sends: [] } },
    { id: 'docs-pin', title: 'Docs version pinning and answer age', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.docsPins', 'vex.docsPins.enabled'],
      permissions: { reads: ['the address of docs pages and the dates on a Stack Overflow question'], writes: ['the versions you pinned'], sends: [] } },
    { id: 'pkg-card', title: 'Package page intelligence', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.pkgCard.enabled'],
      permissions: { reads: ['the package name on an npm, PyPI or crates.io page'], writes: [], sends: ['The package name, to that registry\'s public API'] } },
    { id: 'code-library', title: 'Code-block library', group: 'Developer bench', maturity: 'new', storageKeys: ['vex.codeLibrary', 'vex.codeLibrary.enabled'], commands: ['codelib:open'],
      permissions: { reads: ['the code you select or choose on a page, with its address and title'], writes: ['your saved code blocks'], sends: [] } },
    // ---- Wave 2: study and Turkish ---------------------------------------------------
    // All local; none sends anything by itself. New: staged OFF on an existing profile.
    { id: 'turkish-parse', title: 'Turkish dates and amounts', group: 'Turkish and English', maturity: 'new', storageKeys: ['vex.tr.enabled'],
      permissions: quiet({ reads: ['the text of a reminder or quick capture you typed'], writes: ['nothing: it only reads the words'] }) },
    { id: 'locale-translate', title: 'Turkish and English translation helpers', group: 'Turkish and English', maturity: 'new',
      storageKeys: ['vex.localeTranslate', 'vex.localeTranslate.enabled'], usesKeys: ['vex.translateGlossary', 'vex.translateAlwaysHosts'], commands: ['compose-bilingual'],
      permissions: { reads: ['paragraphs of the page you translate, to tell their language'], writes: ['your language profile and the sites never translated'], sends: ['The text of the two-language box, to the page translator, only when you press Translate'] } },
    { id: 'study-block', title: 'Strict study block', group: 'Study block', maturity: 'new', storageKeys: ['vex.studyBlock', 'vex.studyBlock.enabled'], commands: ['study-block'],
      permissions: quiet({ reads: ['the address of each page you open during a block'], writes: ['the block, its saved lists and a log of why you left'] }) },
    { id: 'exam-planner', title: 'Exam countdown planner', group: 'Exams', maturity: 'new', storageKeys: ['vex.exams', 'vex.exams.enabled'], usesKeys: ['vex.focusOS', 'vex.reminders.recent'],
      jobs: ['Exam planner'], commands: ['exams'],
      permissions: quiet({ reads: ['your calendar, reminders and Focus OS blocks to find free time'], writes: ['exams; reminders and a Focus OS goal, only after you confirm'] }) },
    { id: 'exam-safe-mode', title: 'Exam-day pack and exam mode', group: 'Exam-day pack', maturity: 'new', storageKeys: ['vex.examMode', 'vex.examMode.enabled'], commands: ['exam-pack'],
      permissions: quiet({ reads: ['the pages you list'], writes: ['packs; while on, holds update checks and sync, keeps tabs awake and Vex quiet'] }) },
    { id: 'paper-session', title: 'Past-paper session recorder', group: 'Past papers', maturity: 'new', storageKeys: ['vex.paperSessions', 'vex.paperSessions.enabled'], commands: ['paper-session'],
      permissions: quiet({ reads: ['text you selected on a page, when you log a question'], writes: ['papers, questions and scores'] }) },
    { id: 'course-spaces', title: 'Course spaces', group: 'Courses', maturity: 'new', storageKeys: ['vex.courses', 'vex.courses.enabled'], usesKeys: ['vex.projectSpaces', 'vex.projectSpaces.active', 'vex.notes'], commands: ['courses'],
      permissions: quiet({ reads: ['your project spaces, exams and notes'], writes: ['courses; switches space only when you ask'] }) },
    { id: 'paper-brief', title: 'Paper brief', group: 'Paper brief', maturity: 'new', storageKeys: ['vex.paperBrief.enabled'], commands: ['paper-brief'], budget: { jobMsPerMin: 4000 },
      permissions: { reads: ['a PDF you choose'], writes: ['a note, only when you save it'], sends: [] } },
    { id: 'mun-dossier', title: 'Model UN dossier', group: 'Model UN dossier', maturity: 'new', storageKeys: ['vex.mun', 'vex.mun.enabled'], usesKeys: ['vex.researchBoard', 'vex.notes'], commands: ['mun-dossier'],
      permissions: quiet({ reads: ['the research board and the page you ask to add from'], writes: ['dossiers and notes with their sources'] }) },
    // ---- Wave 2: games and daily life ---------------------------------------------------
    // All new: staged OFF on an existing profile until tried (maturity 'new').
    { id: 'second-screen', title: 'Guide on a second screen', group: 'Guide on a second screen', maturity: 'new', storageKeys: ['vex.secondScreen.enabled'], commands: ['second-screen', 'second-screen-close'],
      permissions: { reads: ['a game’s guide pages and loadout links'], writes: ['where the window was, in a file of Vex’s own'], sends: ['Requests for the guide pages you chose, from the second-screen window'] } },
    { id: 'game-scenes', title: 'Game audio scenes', group: 'Game audio scenes', maturity: 'new', storageKeys: ['vex.gameScenes', 'vex.gameScenes.enabled', 'vex.gameScenes.prior'],
      permissions: { reads: ['which game is running, by program name'], writes: ['Vex’s own volume while a game runs, put back after'], sends: [] } },
    { id: 'gcc-bridge', title: 'Game Control Center link', group: 'Game Control Center link', maturity: 'new', storageKeys: ['vex.gccBridge.enabled', 'vex.gccBridge.prior'],
      permissions: { reads: ['the one small file Game Control Center writes for Vex'], writes: ['starts Game mode and Streamer mode while it says so, then puts them back'], sends: [] } },
    { id: 'game-loadouts', title: 'Loadout cards', group: 'Loadout cards', maturity: 'new', storageKeys: ['vex.loadouts', 'vex.loadouts.enabled', 'vex.loadouts.seen'], commands: ['game-loadouts'],
      permissions: { reads: ['when Patch radar last saw a patch'], writes: ['your cards'], sends: [] } },
    { id: 'intent-gate', title: 'Ask before distracting sites', group: 'Ask before distracting sites', maturity: 'new', storageKeys: ['vex.intentGate', 'vex.intentGate.enabled'], jobs: ['Intent gate'],
      permissions: { reads: ['the address of the tab in front'], writes: ['your answers, for two weeks'], sends: [] } },
    { id: 'break-prompts', title: 'Breaks', group: 'Breaks', maturity: 'new', storageKeys: ['vex.breaks', 'vex.breaks.enabled', 'vex.breaks.prefs'], jobs: ['Break prompts'],
      permissions: { reads: ['whether you are using Vex (not what you type)'], writes: ['how many breaks you took each day'], sends: [] } },
    { id: 'orders-hub', title: 'Orders', group: 'Orders', maturity: 'new', storageKeys: ['vex.orders', 'vex.orders.enabled'], commands: ['orders-hub'],
      permissions: { reads: ['your parcels'], writes: ['your parcels and reminders you asked for'], sends: ['Nothing itself: Track opens the carrier’s page in a tab'] } },
    { id: 'exam-calendar', title: 'Exam and registration dates', group: 'Exam and registration dates', maturity: 'new', storageKeys: ['vex.examDates', 'vex.examDates.enabled', 'vex.examDates.prefs'], commands: ['exam-calendar'],
      permissions: { reads: ['the dates you typed or imported from a file you chose'], writes: ['those dates and reminders you asked for'], sends: [] } },
    { id: 'receipt-locker', title: 'Receipts and warranties', group: 'Receipts and warranties', maturity: 'new', storageKeys: ['vex.receipts', 'vex.receipts.enabled'], commands: ['receipt-locker'],
      permissions: { reads: ['the facts you entered; the receipt files are not read'], writes: ['those facts and reminders you asked for'], sends: [] } },
    // ---- Wave 2: daily planning (new: staged off on a profile that already exists) --------------
    { id: 'carry-forward', title: 'Left-overs from earlier', group: 'Left-overs from earlier', maturity: 'new', storageKeys: ['vex.carry.enabled', 'vex.carry.offered'], commands: ['carry-forward'],
      permissions: quiet({ reads: ['your open tasks in notes'], writes: ['the @date of a task, only when you press Today, Tomorrow or Drop (Undo in the ledger)', 'the day it last offered'] }) },
    { id: 'snooze-syntax', title: 'Put things off (when box)', group: 'Put things off (when box)', maturity: 'new', storageKeys: ['vex.when.enabled', 'vex.when.pending'], commands: ['when-snooze'],
      permissions: quiet({ reads: ['the tab in front or the object you point it at'], writes: ['a snooze, a task date or a reminder, only when you press Put off', 'things waiting for the game to end'] }) },
    { id: 'close-day', title: 'Close the day', group: 'Close the day', maturity: 'new', storageKeys: ['vex.closeDay.enabled', 'vex.closeDay.prefs', 'vex.closeDay.nudged'], commands: ['close-day'], jobs: ['Close the day: evening notice'],
      permissions: quiet({ reads: ['your open tasks, parked contexts and whether a note is unsaved'], writes: ['task dates and new tasks, only when you press the buttons', 'the hour you chose for the evening notice'] }) },
    { id: 'day-shape', title: 'Shape of the day', group: 'Shape of the day', maturity: 'new', storageKeys: ['vex.dayShape.enabled'], commands: ['day-shape'],
      permissions: quiet({ reads: ['calendar events, timed reminders, Focus OS blocks and dated tasks'] }) },
    { id: 'refind', title: 'Find by time and topic', group: 'Find by time and topic', maturity: 'new', storageKeys: ['vex.refind.enabled'], usesKeys: ['vex.notes', 'vex.readLater', 'vex.annotations'], commands: ['refind'],
      permissions: quiet({ reads: ['history, the text of pages you read, notes, read-later, highlights and clips, when you search'] }) },
    { id: 'tab-intent', title: 'Why is this tab open', group: 'Why is this tab open', maturity: 'new', storageKeys: ['vex.tabIntent.enabled', 'vex.tabIntent.notes'], commands: ['tab-why'],
      permissions: quiet({ reads: ['which page opened a tab and the words searched there (memory only)'], writes: ['the one-line reason you write for a page'] }) },
    { id: 'workspace-changes', title: 'What changed since you looked', group: 'What changed since you looked', maturity: 'new', storageKeys: ['vex.changed.enabled', 'vex.changed.seen'], commands: ['workspace-changes'],
      permissions: quiet({ reads: ['your page watches and the tabs of each workspace'], writes: ['when you last had each workspace in front'] }) },
    { id: 'focus-calibration', title: 'Focus block length', group: 'Focus block length', maturity: 'new', storageKeys: ['vex.focusCal.enabled', 'vex.focusCal'], commands: ['focus-calibration'],
      permissions: quiet({ reads: ['that you are active in Vex (not what you type) and the kind of page in front'], writes: ['span lengths per workspace', 'the Focus OS block length, only when you press Use'] }) },
    { id: 'chores', title: 'Chores and bills', group: 'Chores and bills', maturity: 'new', storageKeys: ['vex.chores.enabled', 'vex.chores'], commands: ['chores'], jobs: ['Chores: reminders'],
      permissions: quiet({ reads: ['your chore list'], writes: ['the chore list', 'a reminder a few days before each is due (Undo in the ledger)', 'opens the page you gave when you press Open page; pays nothing'] }) },
    { id: 'week-skeleton', title: 'Plan the week', group: 'Plan the week', maturity: 'new', storageKeys: ['vex.weekSkeleton.enabled'], commands: ['week-skeleton'],
      permissions: quiet({ reads: ['last week reminders and Focus OS blocks'], writes: ['reminders, only after you press Create (Undo in the ledger)'] }) },
    { id: 'weekly-triage', title: 'Weekly triage', group: 'Weekly triage', maturity: 'new', storageKeys: ['vex.triage.enabled', 'vex.triage.done', 'vex.triage.log'], commands: ['weekly-triage'],
      permissions: quiet({ reads: ['read-later, clips, downloads and how long tabs have been open'], writes: ['a note you ask for', 'removes a read-later item or clip, or moves a download to the Recycle Bin, only when you press 3'] }) },

    // ---- core entries: data no switchable feature owns -----------------------------
    { id: 'storage-ceilings', title: 'Storage and Recall limits', killSwitch: 'none', maturity: 'stable', storageKeys: ['vex.storage.recallLimits'],
      permissions: { reads: ['how much each feature keeps; the Recall index size'], writes: ['the caps and retention of the Recall index; the oldest pages go first'], sends: [] } },
    { id: 'ai-route-control', title: 'Where AI runs', killSwitch: 'none', maturity: 'stable', storageKeys: [], commands: ['ai-answered-by'],
      permissions: { reads: ['your AI mode and which backend answered'], writes: ['the same AI mode switches Settings already has'], sends: [] } },
    { id: 'email-code-autofill', title: 'Email code autofill', killSwitch: 'none', maturity: 'stable',
      storageKeys: ['vex.emailCodeAutoSubmit', 'vex.emailCodeAutofill', 'vex.emailCodeHiddenReader', 'vex.emailCodeTrust'],
      permissions: { reads: ['a sign-in code in your mail, when you ask or allow it'], writes: ['the sites you trusted to receive a code'], sends: [] } },
    { id: 'attention-budget', title: 'Attention Budget', killSwitch: 'none', maturity: 'stable',
      storageKeys: ['vex.attention.log', 'vex.attention.denied', 'vex.attention.muted', 'vex.attention.less'],
      permissions: { reads: ['which feature wants to speak'], writes: ['what was shown, held back or muted'], sends: [] } },
    { id: 'defaults-consents', title: 'Defaults, consents and one-time migrations', killSwitch: 'none', maturity: 'stable',
      storageKeys: ['vex.defaults', 'vex.consents', 'vex.migrations.ran'],
      permissions: { reads: ['which choices you made yourself'], writes: ['versioned defaults and the consents you gave'], sends: [] } },
    { id: 'preference-store', title: 'Preference store', killSwitch: 'none', maturity: 'stable',
      storageKeys: ['vex.volatileSplit'],
      permissions: { reads: ['the preference file and its checksum'], writes: ['the preference file and its checksum'], sends: [] } },
    { id: 'library-data', title: 'Notes, bookmarks and read later', killSwitch: 'none', maturity: 'stable',
      storageKeys: ['vex.notes', 'vex.bookmarks', 'vex.readLater', 'vex.annotations', 'vex.stickyNotes'],
      permissions: { reads: ['what you saved'], writes: ['what you saved'], sends: [] } },
    { id: 'feature-registry', title: 'Feature records', killSwitch: 'none', maturity: 'stable',
      storageKeys: ['vex.featureUsage', 'vex.usage.prior.', 'vex.minimalMode', 'vex.registry'],
      permissions: { reads: ['which features exist'], writes: ['which features you use, and which are staged'], sends: [] } },
    { id: 'why-did-that', title: 'Why did that happen? (the ledger)', killSwitch: 'none', maturity: 'stable',
      storageKeys: ['vex.ledger'], commands: ['why-did-that'],
      permissions: { reads: ['the things Vex did by itself'], writes: ['the last 200, with how to undo each'], sends: [] } },
  ];

  if (typeof VexRegistry === 'undefined') throw new Error('feature-manifests.js needs feature-registry.js loaded first');
  VexRegistry.defineAll(MANIFESTS);
})();
