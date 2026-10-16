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

    // ---- Wave 0: safety, attention and release features ---------------------------
    // All default ON in this build, so they are stable (a "new" feature would be staged OFF
    // on an existing profile). Minimal Vex switches each of them off and puts it back.
    { id: 'update-self-test', title: 'Check after an update', group: 'Update self-test', storageKeys: ['vex.selfTest.enabled', 'vex.selfTest.last', 'vex.selfTest.version'],
      permissions: { reads: ['the problems and the crash log of this version'], writes: ['the result of the last check'], sends: [] } },
    { id: 'signout-why', title: 'Say why a sign-in was lost', group: 'Sign-in', storageKeys: ['vex.signoutWhy', 'vex.signoutWhy.said'], commands: ['whysignedout'],
      permissions: { reads: ['which sites you were signed in to'], writes: ['what it already told you'], sends: [] } },
    { id: 'commit-guard', title: 'Protect Windows from running out of memory', group: 'Game mode', storageKeys: ['vex.game.commitGuard'],
      permissions: { reads: ['the memory Windows has left'], writes: ['puts Vex background work on hold while you play'], sends: [] } },
    { id: 'release-check', title: 'Release check', group: 'Release check', storageKeys: ['vex.releaseCheck', 'vex.releaseCheck.enabled'], commands: ['release-check'],
      permissions: { reads: ['the change list of this version'], writes: ['which items you ticked'], sends: [] } },
    { id: 'playfulness', title: 'Playfulness', group: 'Playfulness', storageKeys: ['vex.playfulness.prior'], usesKeys: ['vex.fun.quiet'],
      permissions: { reads: ['your Playfulness level, Game mode and the quiet switch'], writes: ['the level you chose'], sends: [] } },
    { id: 'attention-inbox', title: 'Attention Inbox', group: 'Attention', storageKeys: ['vex.attention.inbox', 'vex.attention.inboxOn'],
      permissions: { reads: ['the notices that did not fit the cap'], writes: ['the notices that did not fit the cap'], sends: [] } },
    // The calm New Tab layout is a layout choice, not an extra: Minimal Vex keeps it (killSwitch 'none', not in the usage table).
    { id: 'newtab-slots', title: 'New Tab layout', group: 'New Tab layout', killSwitch: 'none', maturity: 'stable', storageKeys: ['vex.newtab.layout'],
      permissions: { reads: ['which cards are available'], writes: ['the layout you chose'], sends: [] } },

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

    // ---- core entries: data no switchable feature owns -----------------------------
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
