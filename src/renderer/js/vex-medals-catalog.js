// The medal catalogue and the signals that earn them (js/vex-medals.js is the
// engine). Every medal here is earned by something the person really did: a
// feature tried, something saved, a setting chosen. Never by time on screen.
// Wording is always "you did this", never "you will lose this".
//
// Signals read what the app already keeps: localStorage lists, the command
// bar's usage record and VexFeatures.used(), plus a few counters this file
// bumps from events the app already fires (a page opened, a tab closed, a game
// ended). Medals whose id starts the "signal-only" block are earned by other
// features dispatching `vex:medal-signal` {id}.
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const V = root.VexMedals;
  if (!V) return;

  // --- readers (all tolerate a missing or damaged store) -----------------------
  function rd(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function str(key) {
    try { return root.localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function cnt(key) {
    const v = rd(key);
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'string') return v.trim() ? 1 : 0;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return str(key).trim() ? 1 : 0;
  }
  function cmdTotal() {
    const u = rd('vex.commandUsage');
    if (!u || typeof u !== 'object') return 0;
    return Object.values(u).reduce((s, x) => s + ((x && Number(x.n)) || 0), 0);
  }
  function featItem(id) {
    const F = root.VexFeatures;
    return F && Array.isArray(F.ITEMS) ? F.ITEMS.find(i => i.id === id) : null;
  }
  const feat = (id) => () => { const F = root.VexFeatures; const it = featItem(id); return !!(F && it && F.used(it)); };
  function featuresTried() {
    const F = root.VexFeatures;
    if (!F || !Array.isArray(F.ITEMS)) return 0;
    return F.ITEMS.filter(i => (i.cmd || i.panel) && F.used(i)).length;
  }
  const atLeast = (get, of) => () => { const n = get(); return n >= of ? true : { n, of }; };
  const flag = (key) => () => !!str(key);
  const ctr = (name) => () => V.counter(name);

  // --- definitions --------------------------------------------------------------
  const RIBBON_OF = { start: 'blue', focus: 'teal', organize: 'amber', explore: 'violet', privacy: 'green', mastery: 'red' };
  const SHAPE_OF = { bronze: 'circle', silver: 'hex', gold: 'shield', platinum: 'star', special: 'star' };

  function M(id, cat, tier, title, desc, hint, glyph, check, extra) {
    const x = extra || {};
    V.define({
      id, cat, tier, title, desc, hint,
      hidden: !!x.hidden,
      signal: !!x.signal,
      art: { glyph, shape: x.shape || SHAPE_OF[tier], ribbon: x.ribbon === false ? undefined : (tier === 'bronze' || tier === 'silver' ? undefined : RIBBON_OF[cat]) },
      check: check || undefined,
    });
  }
  const earnedAll = () => V.list().filter(m => V.has(m.id)).length;

  // Getting started
  M('first-launch', 'start', 'bronze', 'Hello, Vex', 'You finished setting Vex up.', 'Finish the first-run setup.', 'rocket', () => !!str('vex.onboardingDone') || !!str('vex.hasRunBefore'));
  M('name-yourself', 'start', 'bronze', 'Your name here', 'You gave your profile a name.', 'Type a name on your profile.', 'user', () => !!V.profile().name || !!str('vex.userName'));
  M('meet-your-profile', 'start', 'bronze', 'Meet your profile', 'You opened your profile and looked around.', 'Open your profile from Settings or the command bar.', 'sparkles', null, { signal: true });
  M('first-bookmark', 'start', 'bronze', 'First bookmark', 'You saved a page you want to come back to.', 'Bookmark a page.', 'bookmark', () => cnt('vex.bookmarks') >= 1);
  M('first-note', 'start', 'bronze', 'First note', 'You wrote something down.', 'Write a note.', 'note', () => cnt('vex.notes') >= 1);
  M('choose-a-look', 'start', 'bronze', 'Your own look', 'You chose how Vex looks.', 'Pick a look in Settings.', 'palette', flag('vex.guiStyleChosen'));
  M('pick-search', 'start', 'bronze', 'Search your way', 'You picked your search engine.', 'Choose a search engine in Settings.', 'search', flag('vex.searchEngine'));
  M('first-command', 'start', 'bronze', 'Command bar', 'You ran something from the command bar.', 'Press Ctrl+K and run a command.', 'keyboard', () => cmdTotal() >= 1);
  M('commands-25', 'start', 'silver', 'At home in the bar', 'You have run 25 commands.', 'Keep using the command bar.', 'zap', atLeast(cmdTotal, 25));
  M('take-the-tour', 'start', 'bronze', 'Took the tour', 'You went through the tour.', 'Take the tour from the Help menu.', 'compass', flag('vex.tourSeen'));
  M('first-group', 'start', 'silver', 'Tidy tabs', 'You grouped your tabs.', 'Make a tab group.', 'tabs', feat('tab-groups'));

  // Focus and calm
  M('focus-first', 'focus', 'bronze', 'Focus time', 'You started focus mode.', 'Turn on focus mode.', 'target', feat('focus'));
  M('focus-flow', 'focus', 'silver', 'In the flow', 'You set up a focus flow.', 'Create a focus flow.', 'timer', feat('focusflows'));
  M('game-clear', 'focus', 'bronze', 'Out of the way', 'Vex stayed quiet while you played a game.', 'Turn on Game mode and play.', 'gamepad', () => V.counter('games') >= 1);
  M('game-clear-5', 'focus', 'silver', 'Player friendly', 'Five games played with Vex staying out of the way.', 'Keep Game mode on.', 'gamepad', atLeast(ctr('games'), 5));
  M('quiet-reader', 'focus', 'bronze', 'Quiet reader', 'You tried reading mode.', 'Open a page in reading mode.', 'book-open', feat('reading-mode'));
  M('read-aloud', 'focus', 'silver', 'Eyes closed', 'You had a page read aloud.', 'Use read aloud on an article.', 'headphones', feat('readaloud'));
  M('night-audio', 'focus', 'silver', 'Soft evenings', 'You tried night audio.', 'Turn on night audio.', 'moon', feat('nightaudio'));
  M('battery-care', 'focus', 'bronze', 'Easy on the battery', 'Vex went easy on your battery.', 'Let battery mode kick in.', 'battery', () => V.counter('battery') >= 1);
  M('tab-sleep', 'focus', 'bronze', 'Let it rest', 'You put a tab to sleep.', 'Sleep a tab you are not using.', 'sleep', feat('tab-sleep'));
  M('quick-summary', 'focus', 'bronze', 'The short version', 'You had a page summarized.', 'Summarize a page.', 'bell', feat('summarize'));
  M('weekly-review', 'focus', 'silver', 'Looking back', 'You did a weekly review.', 'Run the weekly review.', 'history', feat('weekly-review'));
  M('calm-collector', 'focus', 'platinum', 'Calm collector', 'You earned six of the focus and calm medals.', 'Earn six medals in this group.', 'leaf', null);

  // Organize
  M('bookmarks-10', 'organize', 'silver', 'Collector', 'Ten bookmarks saved.', 'Save ten bookmarks.', 'bookmark', atLeast(() => cnt('vex.bookmarks'), 10));
  M('bookmarks-50', 'organize', 'gold', 'Librarian', 'Fifty bookmarks saved.', 'Save fifty bookmarks.', 'book', atLeast(() => cnt('vex.bookmarks'), 50));
  M('notes-5', 'organize', 'silver', 'Note taker', 'Five notes written.', 'Write five notes.', 'edit', atLeast(() => cnt('vex.notes'), 5));
  M('notes-25', 'organize', 'gold', 'Chronicler', 'Twenty-five notes written.', 'Write twenty-five notes.', 'clipboard', atLeast(() => cnt('vex.notes'), 25));
  M('session-saved', 'organize', 'bronze', 'Saved for later', 'You saved a session.', 'Save the tabs you have open as a session.', 'archive', () => cnt('vex.sessions') >= 1);
  M('sessions-5', 'organize', 'silver', 'Keeper of sessions', 'Five sessions saved.', 'Save five sessions.', 'folder-open', atLeast(() => cnt('vex.sessions'), 5));
  M('workspace', 'organize', 'bronze', 'Own space', 'You used workspaces.', 'Open a workspace.', 'briefcase', feat('workspaces'));
  M('read-later', 'organize', 'bronze', 'Read it later', 'You set a page aside to read later.', 'Add a page to read later.', 'clock', () => cnt('vex.readLater') >= 1);
  M('first-habit', 'organize', 'bronze', 'One good habit', 'You started tracking a habit.', 'Add a habit.', 'check', () => cnt('vex.habits') >= 1);
  M('first-reminder', 'organize', 'bronze', 'Remembered', 'You set a reminder.', 'Set a reminder.', 'alarm', () => cnt('vex.reminders') >= 1);
  M('reminders-10', 'organize', 'silver', 'On the ball', 'Ten reminders set.', 'Set ten reminders.', 'bell', atLeast(() => cnt('vex.reminders'), 10));
  M('first-snippet', 'organize', 'bronze', 'Handy snippet', 'You saved a snippet.', 'Save a snippet.', 'braces', () => cnt('vex.snippets') >= 1);
  M('tidy-up', 'organize', 'silver', 'Tidy desk', 'Fifty tabs closed.', 'Close tabs you are done with.', 'broom', atLeast(ctr('tabsClosed'), 50));
  M('first-feed', 'organize', 'bronze', 'Following along', 'You added a feed.', 'Add an RSS feed.', 'newspaper', () => cnt('vex.feeds') >= 1);
  M('first-highlight', 'organize', 'bronze', 'Highlighter', 'You annotated a page.', 'Highlight or annotate a page.', 'marker', () => cnt('vex.annotations') >= 1);
  M('own-theme', 'organize', 'gold', 'Made it mine', 'You made your own colour theme.', 'Create a theme in the theme studio.', 'palette', () => cnt('vex.customThemes') >= 1);

  // Explore and discovery
  M('features-5', 'explore', 'bronze', 'Curious', 'Five Vex features tried.', 'Try a few features from the library.', 'compass', atLeast(featuresTried, 5));
  M('features-15', 'explore', 'silver', 'Explorer', 'Fifteen features tried.', 'Keep trying features.', 'map', atLeast(featuresTried, 15));
  M('features-40', 'explore', 'gold', 'Pathfinder', 'Forty features tried.', 'Keep trying features.', 'flag', atLeast(featuresTried, 40));
  M('features-80', 'explore', 'platinum', 'Cartographer', 'Eighty features tried.', 'Keep trying features.', 'globe', atLeast(featuresTried, 80));
  M('try-ai', 'explore', 'bronze', 'Ask Vex', 'You opened the AI panel.', 'Open the AI panel.', 'sparkles', feat('ai-panel'));
  M('try-agent', 'explore', 'silver', 'Hands free', 'You let the agent do a job.', 'Give the agent a task.', 'robot', feat('agent'));
  M('try-translate', 'explore', 'bronze', 'Every language', 'You translated a page.', 'Translate a page.', 'globe', feat('translate'));
  M('panel-explorer', 'explore', 'bronze', 'Side by side', 'You used three sidebar panels.', 'Open a few sidebar panels.', 'sidebar', atLeast(() => cnt('vex.panelUsage'), 3));
  M('panel-regular', 'explore', 'silver', 'Panel regular', 'You used eight sidebar panels.', 'Open more sidebar panels.', 'grid', atLeast(() => cnt('vex.panelUsage'), 8));
  M('try-toolbox', 'explore', 'bronze', 'Tinkerer', 'You opened the toolbox.', 'Open the toolbox.', 'toolbox', feat('toolbox'));
  M('try-devtools', 'explore', 'bronze', 'Under the hood', 'You checked a page for accessibility.', 'Run the accessibility check.', 'code', feat('check-a11y'));
  M('pages-100', 'explore', 'bronze', 'Wanderer', 'A hundred pages opened.', 'Browse.', 'compass', atLeast(ctr('pages'), 100));
  M('pages-1000', 'explore', 'silver', 'Voyager', 'A thousand pages opened.', 'Browse.', 'rocket', atLeast(ctr('pages'), 1000));
  M('pages-10000', 'explore', 'gold', 'Long way round', 'Ten thousand pages opened.', 'Browse.', 'globe', atLeast(ctr('pages'), 10000));
  M('try-screenshot', 'explore', 'bronze', 'Say cheese', 'You took a screenshot.', 'Take a screenshot.', 'camera', feat('screenshot'));

  // Privacy and care
  M('privacy-choice', 'privacy', 'bronze', 'Your privacy, your call', 'You chose your privacy settings.', 'Choose your privacy level.', 'shield', flag('vex.privacyChosen'));
  M('try-adblock', 'privacy', 'bronze', 'Clean pages', 'You looked at your tracker receipts.', 'Open tracker receipts.', 'shield', feat('trackerreceipts'));
  M('privacy-report', 'privacy', 'silver', 'Know what follows you', 'You read your privacy report.', 'Open the privacy report.', 'chart-bar', feat('privacy-report'));
  M('try-tor', 'privacy', 'gold', 'Through the onion', 'You browsed through Tor.', 'Open a Tor tab.', 'onion', feat('tor'));
  M('private-window', 'privacy', 'bronze', 'No traces', 'You opened a private window.', 'Open a private window.', 'incognito', feat('private-window'));
  M('site-data', 'privacy', 'bronze', 'Know your cookies', 'You looked at a site\'s cookies and storage.', 'Open cookies and storage for a site.', 'lock', feat('sitedata'));
  M('try-passwords', 'privacy', 'bronze', 'Key keeper', 'You used the password manager.', 'Open the password manager.', 'key', feat('passwords'));
  M('try-totp', 'privacy', 'silver', 'Two steps ahead', 'You used a 2FA code.', 'Use the built-in authenticator.', 'shield', feat('totp'));
  M('site-rules', 'privacy', 'silver', 'Who may ask', 'You reviewed what a site may ask for.', 'Open site permissions.', 'fingerprint', feat('siterules'));
  M('clear-site', 'privacy', 'bronze', 'Clean slate', 'You cleared a site\'s data.', 'Clear one site\'s data.', 'broom', feat('clearsite'));
  M('burner', 'privacy', 'silver', 'Throwaway', 'You used a burner identity.', 'Make a burner identity.', 'mask', feat('burner'));
  M('backup-made', 'privacy', 'silver', 'Safety net', 'You made a backup.', 'Back up your Vex data.', 'save', feat('backup'));
  M('sync-on', 'privacy', 'silver', 'Everywhere at once', 'You set up Vex Sync.', 'Turn on Vex Sync.', 'refresh', flag('vex.syncWorkerUrl'));
  M('privacy-guardian', 'privacy', 'platinum', 'Guardian', 'You earned eight privacy and care medals.', 'Earn eight medals in this group.', 'shield', null);

  // Streaks and mastery
  M('days-3', 'mastery', 'bronze', 'Three days running', 'Used Vex on three days in a row.', 'Use Vex a few days in a row.', 'flame', () => V.bestStreak() >= 3 || { n: V.streak(), of: 3 });
  M('days-7', 'mastery', 'silver', 'A week of it', 'Used Vex on seven days in a row.', 'Use Vex a few days in a row.', 'flame', () => V.bestStreak() >= 7 || { n: V.streak(), of: 7 });
  M('days-14', 'mastery', 'gold', 'Fortnight', 'Used Vex on fourteen days in a row.', 'Use Vex a few days in a row.', 'flame', () => V.bestStreak() >= 14 || { n: V.streak(), of: 14 });
  M('days-30', 'mastery', 'platinum', 'A whole month', 'Used Vex on thirty days in a row.', 'Use Vex a few days in a row.', 'flame', () => V.bestStreak() >= 30 || { n: V.streak(), of: 30 });
  M('active-10', 'mastery', 'bronze', 'Regular', 'Used Vex on ten different days.', 'Come back as you like.', 'calendar', atLeast(() => V.activeDays(), 10));
  M('active-30', 'mastery', 'silver', 'Dependable', 'Used Vex on thirty different days.', 'Come back as you like.', 'calendar', atLeast(() => V.activeDays(), 30));
  M('active-100', 'mastery', 'gold', 'Part of the furniture', 'Used Vex on a hundred different days.', 'Come back as you like.', 'calendar', atLeast(() => V.activeDays(), 100));
  M('medals-10', 'mastery', 'bronze', 'Ten medals', 'Ten medals earned.', 'Keep going.', 'star', atLeast(earnedAll, 10));
  M('medals-25', 'mastery', 'silver', 'Twenty-five medals', 'Twenty-five medals earned.', 'Keep going.', 'star', atLeast(earnedAll, 25));
  M('medals-50', 'mastery', 'gold', 'Fifty medals', 'Fifty medals earned.', 'Keep going.', 'star', atLeast(earnedAll, 50));
  M('power-user', 'mastery', 'gold', 'Power user', 'Two hundred commands run.', 'Keep using the command bar.', 'zap', atLeast(cmdTotal, 200));
  M('command-master', 'mastery', 'platinum', 'Command master', 'A thousand commands run.', 'Keep using the command bar.', 'terminal', atLeast(cmdTotal, 1000));
  M('completionist', 'mastery', 'special', 'Completionist', 'Every other medal earned.', 'Earn every other medal.', 'sparkles', () => { const all = V.list().filter(m => m.id !== 'completionist'); const n = all.filter(m => V.has(m.id)).length; return n >= all.length ? true : { n, of: all.length }; }, { hidden: true });

  // Signal-only: earned by features built elsewhere, which dispatch
  // `vex:medal-signal` {id} (or call VexMedals.award). See docs/medals.md.
  M('brief-first', 'focus', 'bronze', 'Good morning', 'You opened your morning brief.', 'Open the morning brief.', 'sun', null, { signal: true });
  M('brief-action', 'organize', 'silver', 'Straight from the brief', 'You acted on something right from the brief.', 'Use an action in the brief.', 'check', null, { signal: true });
  M('wind-down-first', 'focus', 'bronze', 'Winding down', 'You used wind-down.', 'Run wind-down at the end of the day.', 'moon', null, { signal: true });
  M('daily-tools-first', 'organize', 'bronze', 'Daily driver', 'You used a daily tool.', 'Open a daily tool.', 'toolbox', null, { signal: true });
  M('workflow-first', 'mastery', 'silver', 'First workflow', 'You ran a workflow.', 'Run a workflow.', 'wand', null, { signal: true });
  M('workflow-10', 'mastery', 'gold', 'Workflow regular', 'Ten workflow runs.', 'Run workflows.', 'wand', null, { signal: true });
  M('protect-first-scan', 'privacy', 'silver', 'Looked after', 'You ran a protection scan.', 'Run a protection scan.', 'stethoscope', null, { signal: true });
  M('ai-badge-first', 'explore', 'bronze', 'Brief badge', 'An AI badge was awarded to you.', 'Use the AI features.', 'brain', null, { signal: true });

  // --- wiring ----------------------------------------------------------------
  const doc = root.document;
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 1500);
  }
  function run() {
    try {
      V.evaluate();
      // Group medals count their own category, evaluated after the rest.
      const grp = [['calm-collector', 'focus', 6], ['privacy-guardian', 'privacy', 8]];
      for (const [id, cat, of] of grp) if (!V.has(id)) { const n = V.list().filter(m => m.cat === cat && m.id !== id && V.has(m.id)).length; V.progress(id, n, of); }
      V.save();
    } catch (err) {
      try { root.VexProblems && root.VexProblems.note('Medals', 'Could not check medals', err); } catch { /* */ }
    }
  }
  if (doc && typeof doc.addEventListener === 'function') {
    const day = () => { if (V.markActiveDay()) V.save(); };
    doc.addEventListener('vex:tab-navigated', () => { V.bump('pages'); day(); schedule(); });
    doc.addEventListener('vex:tab-closed', () => { V.bump('tabsClosed'); day(); schedule(); });
    doc.addEventListener('vex:battery-mode', () => { V.bump('battery'); schedule(); });
    doc.addEventListener('vex:game-mode', (e) => { if (e && e.detail && e.detail.active === false) { V.bump('games'); day(); schedule(); } });
    for (const ev of ['vex:tasks-changed', 'vex:habits-changed', 'vex-sticky-notes-changed', 'vex-schedules-changed', 'theme-changed', 'vex:gui-style', 'vex:panel-changed', 'vex-extensions-changed', 'vex-search-engine-changed', 'vex-sync-state']) {
      doc.addEventListener(ev, () => { day(); schedule(); });
    }
    root.addEventListener && root.addEventListener('theme-changed', () => schedule());
    setTimeout(run, 5000);
    // The command bar's usage record changes without an event; a slow look
    // every two minutes picks it up (and does nothing while a game runs).
    setInterval(() => { if (!V.gaming()) run(); }, 120000);
  }
  V.runChecks = run;
})();
