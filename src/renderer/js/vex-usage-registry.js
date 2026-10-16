// === Feature usage: who is registered, and how each one is switched =========
//
// js/vex-usage.js (the usage record, the dashboard, Minimal Vex) only knows the
// features that tell it they exist. The modules added in 2026-10 each keep
// their own switch in their own place (a Brief Actions key, a Workflow
// preference, an enabled()/setEnabled() pair, a mode, a Play flag...). This file
// is the one place that says, for every one of them, how to read that switch
// and how to turn it off and on again, and registers it.
//
// Rules, so Minimal Vex can promise "restored exactly":
//   - isEnabled() reads the module's own truth, never a copy;
//   - disable()/enable() are idempotent and use only the module's own setter;
//   - a mode feature (ask/auto/off) remembers the mode it had in
//     vex.usage.prior.<id> and puts that same mode back;
//   - a module that is not in this build is simply not registered.
//
// Load order: after every feature module and after js/vex-usage.js.

const VexUsageRegistry = {
  PRIOR_PREFIX: 'vex.usage.prior.',

  // ---- adapters: each returns { on(), set(bool) } or null when absent ---------
  briefAction(key) {
    return () => {
      const G = typeof BriefActions !== 'undefined' ? BriefActions : null;
      if (!G || typeof G.isOn !== 'function') return null;
      return { on: () => G.isOn(key), set: (v) => { G.set(key, v); } };
    };
  },
  delight(key) {
    return () => {
      const G = typeof VexDelights !== 'undefined' ? VexDelights : null;
      if (!G || typeof G.isOn !== 'function') return null;
      return { on: () => G.isOn(key), set: (v) => { G.set(key, v); } };
    };
  },
  workflow(name, fallbackOn) {
    return () => {
      const G = typeof VexWorkflow !== 'undefined' ? VexWorkflow : null;
      if (!G || typeof G.pref !== 'function') return null;
      return { on: () => G.pref(name, fallbackOn) === true, set: (v) => { G.setPref(name, v); } };
    };
  },
  api(thunk, getter, setter) {
    return () => {
      const G = thunk();
      if (!G || typeof G[getter] !== 'function' || typeof G[setter] !== 'function') return null;
      return { on: () => !!G[getter](), set: (v) => { G[setter](v); } };
    };
  },
  progress(flag) {
    return () => {
      const G = typeof VexProgress !== 'undefined' ? VexProgress : null;
      if (!G || typeof G.enabled !== 'function') return null;
      return { on: () => G.enabled(flag), set: (v) => { G.setEnabled(flag, v); } };
    };
  },
  play(flag) {
    return () => {
      const G = typeof VexFun !== 'undefined' ? VexFun : null;
      if (!G || typeof G.flag !== 'function' || !G.KEYS || !G.KEYS[flag]) return null;
      return { on: () => G.flag(flag), set: (v) => { G.setFlag(flag, v); } };
    };
  },
  living(key) {
    return () => {
      const G = typeof VexLiving !== 'undefined' ? VexLiving : null;
      if (!G || typeof G.read !== 'function') return null;
      return { on: () => G.read()[key] === true, set: (v) => { G.write({ [key]: v }); } };
    };
  },
  // A field of a JSON preference object.
  field(key, field, def) {
    return () => ({
      on: () => {
        const raw = localStorage.getItem(key);
        if (raw === null) return !!def;
        const o = JSON.parse(raw);
        return o && typeof o[field] === 'boolean' ? o[field] : !!def;
      },
      set: (v) => {
        const raw = localStorage.getItem(key);
        const o = raw === null ? {} : JSON.parse(raw);
        o[field] = v;
        localStorage.setItem(key, JSON.stringify(o));
      },
    });
  },
  // A mode switch: offValue turns it off, the previous mode is put back.
  mode(thunk, getter, setter, offValue, defaultOn) {
    return (id) => {
      const G = thunk();
      if (!G || typeof G[getter] !== 'function' || typeof G[setter] !== 'function') return null;
      const k = this.PRIOR_PREFIX + id;
      return {
        on: () => G[getter]() !== offValue,
        set: (v) => {
          if (!v) {
            const cur = G[getter]();
            if (cur !== offValue) localStorage.setItem(k, String(cur));
            G[setter](offValue);
          } else {
            const prior = localStorage.getItem(k);
            G[setter](prior && prior !== offValue ? prior : defaultOn);
            localStorage.removeItem(k);
          }
        },
      };
    };
  },
  // A module that keeps a state() object with an enabled flag and save().
  stateFlag(thunk) {
    return () => {
      const G = thunk();
      if (!G || typeof G.state !== 'function' || typeof G.save !== 'function') return null;
      return { on: () => G.state().enabled === true, set: (v) => { G.state().enabled = v; if (!G.save()) throw new Error('The setting could not be saved'); } };
    };
  },
  // A preference object with an `enabled` field changed through a patch method.
  patched(thunk, getter, patchMethod) {
    return () => {
      const G = thunk();
      if (!G || typeof G[getter] !== 'function' || typeof G[patchMethod] !== 'function') return null;
      return { on: () => G[getter]().enabled === true, set: (v) => { G[patchMethod]({ enabled: v }); } };
    };
  },

  // ---- the table ----------------------------------------------------------------
  // [id, title, Settings heading it starts with (or ''), adapter]
  table() {
    const A = this;
    const G = {
      CitationTracker: () => (typeof CitationTracker !== 'undefined' ? CitationTracker : null),
      KnowledgeAsk: () => (typeof KnowledgeAsk !== 'undefined' ? KnowledgeAsk : null),
      LinkTriage: () => (typeof LinkTriage !== 'undefined' ? LinkTriage : null),
      ListenReader: () => (typeof ListenReader !== 'undefined' ? ListenReader : null),
      VexOneBox: () => (typeof VexOneBox !== 'undefined' ? VexOneBox : null),
      WorkspaceMetrics: () => (typeof WorkspaceMetrics !== 'undefined' ? WorkspaceMetrics : null),
      VexFortune: () => (typeof VexFortune !== 'undefined' ? VexFortune : null),
      PageActions: () => (typeof PageActions !== 'undefined' ? PageActions : null),
      VexSelfTest: () => (typeof VexSelfTest !== 'undefined' ? VexSelfTest : null),
      DistractionBudget: () => (typeof DistractionBudget !== 'undefined' ? DistractionBudget : null),
      SmartBookmarks: () => (typeof SmartBookmarks !== 'undefined' ? SmartBookmarks : null),
      VexSearchAgain: () => (typeof VexSearchAgain !== 'undefined' ? VexSearchAgain : null),
      VexAliases: () => (typeof VexAliases !== 'undefined' ? VexAliases : null),
      MeetingPrep: () => (typeof MeetingPrep !== 'undefined' ? MeetingPrep : null),
      RoutineDetect: () => (typeof RoutineDetect !== 'undefined' ? RoutineDetect : null),
      TabCleanup: () => (typeof TabCleanup !== 'undefined' ? TabCleanup : null),
    };
    return [
      // Brief actions group (js/brief-actions.js)
      ['brief-mail-triage', 'Mail triage in the brief', 'Brief actions', A.briefAction('mail')],
      ['brief-github-desk', 'GitHub desk', 'Brief actions', A.briefAction('github')],
      ['brief-snooze', 'Snooze anything', 'Brief actions', A.briefAction('snooze')],
      ['brief-finder', 'Find a lost page', 'Brief actions', A.briefAction('finder')],
      ['brief-interests', 'Learn my interests', 'Brief actions', A.briefAction('interests')],
      ['brief-day-layout', 'Order the brief by time of day', 'Brief actions', A.briefAction('dayLayout')],
      ['brief-next-action', 'Suggest what I usually do next', 'Brief actions', A.briefAction('nextAction')],
      // Little surprises (js/delights.js)
      ['delight-rabbit-hole', 'Take me somewhere interesting', 'Little surprises', A.delight('rabbit')],
      ['delight-time-capsule', 'Time capsules', 'Little surprises', A.delight('capsule')],
      ['delight-on-this-day', 'On this day', 'Little surprises', A.delight('onThisDay')],
      ['delight-old-bookmark', 'A forgotten bookmark', 'Little surprises', A.delight('oldBookmark')],
      ['delight-mood-themes', 'Mood themes', 'Little surprises', A.delight('mood')],
      ['delight-widgets', 'Start page widgets', 'Little surprises', A.delight('widgets')],
      // Workflow (js/resume-workday.js hub)
      ['workflow-ask-tabs', 'Ask across my tabs', 'Workflow', A.workflow('askTabs', false)],
      ['workflow-focus-auto', 'Switch focus profiles by itself', 'Workflow', A.workflow('focusAuto', false)],
      ['workflow-release-radar', 'Release radar', 'Workflow', A.workflow('releaseRadar', true)],
      ['workflow-weekly-note', 'Weekly note', 'Workflow', A.workflow('weeklyNote', true)],
      ['workflow-resume-workday', 'Resume my workday', 'Workflow', A.workflow('workday', true)],
      // enabled()/setEnabled() modules
      ['citations', 'Citations in Notes', 'Citations in Notes', A.api(G.CitationTracker, 'enabled', 'setEnabled')],
      ['knowledge-base', 'Knowledge base', 'Knowledge', A.api(G.KnowledgeAsk, 'enabled', 'setEnabled')],
      ['link-triage', 'Link triage', 'Link triage', A.api(G.LinkTriage, 'enabled', 'setEnabled')],
      ['listen-reader', 'Listen to articles', 'Listen to articles', A.api(G.ListenReader, 'enabled', 'setEnabled')],
      ['one-box', 'One box', 'One box', A.api(G.VexOneBox, 'enabled', 'setEnabled')],
      ['workspace-metrics', 'Workspace metrics', 'Workspace metrics', A.api(G.WorkspaceMetrics, 'enabled', 'setEnabled')],
      ['fortune', 'Fortune', 'Fun and expression', A.api(G.VexFortune, 'isEnabled', 'setEnabled')],
      // Page actions: turning them back on asks its own confirmation again.
      ['page-actions', 'Page actions', 'Page actions', A.api(G.PageActions, 'enabled', 'setEnabled')],
      // The check after an update (js/post-update-selftest.js)
      ['update-self-test', 'Check after an update', 'Update self-test', A.api(G.VexSelfTest, 'enabled', 'setEnabled')],
      // Fun and progress (js/fun/*) and Play (js/vex-fun.js)
      ['fun-pet', 'Vex Pet', 'Play: fun and progress', A.progress('pet')],
      ['fun-discovery', 'Discovery log', 'Play: fun and progress', A.progress('discovery')],
      ['fun-levels', 'Browser levels', 'Play: fun and progress', A.progress('levels')],
      ['fun-challenge', 'Daily challenge', 'Play: fun and progress', A.progress('challenge')],
      ['play-games', 'Offline mini games', 'Play', A.play('games')],
      ['play-tetris', 'Tab Tetris', 'Play', A.play('tetris')],
      ['play-word', 'Daily word', 'Play', A.play('word')],
      ['play-sounds', 'Sounds', 'Play', A.play('sounds')],
      // Living (js/living-core.js)
      ['living-tab-personality', 'Tab personality', 'Living', A.living('tabPersonality')],
      ['living-tab-glow', 'Tab daily glow', 'Living', A.living('tabDailyGlow')],
      ['living-weather', 'Weather layer', 'Living', A.living('weatherLayer')],
      ['living-stickers', 'Stickers', 'Living', A.living('stickers')],
      // Preference objects and modes
      ['distraction-budget', 'Distraction budget', 'Distraction budget', A.stateFlag(G.DistractionBudget)],
      ['smart-bookmarks', 'Smart bookmarks', 'Smart bookmarks', A.patched(G.SmartBookmarks, 'prefs', 'setPrefs')],
      ['search-again', 'Search again', 'Search again', A.patched(G.VexSearchAgain, 'prefs', 'savePrefs')],
      ['command-aliases', 'Command aliases', 'Command aliases', A.patched(G.VexAliases, 'prefs', 'savePrefs')],
      ['meeting-prep', 'Meeting prep', 'Meeting prep', A.mode(G.MeetingPrep, 'mode', 'setMode', 'off', 'ask')],
      ['routine-detect', 'Routine detection', 'Routine', A.mode(G.RoutineDetect, 'mode', 'setMode', 'off', 'on')],
      ['tab-cleanup', 'Evening tab cleanup', 'Tab cleanup', A.mode(G.TabCleanup, 'mode', 'setMode', 'off', 'ask')],
    ];
  },

  // Registers every feature whose module is present. Returns the ids registered.
  register(U) {
    const usage = U || (typeof VexUsage !== 'undefined' ? VexUsage : null);
    if (!usage || typeof usage.register !== 'function') throw new Error('The usage record is not loaded');
    const done = [];
    for (const [id, title, group, make] of this.table()) {
      let h;
      try { h = make.call(this, id); } catch (err) { console.error('[UsageRegistry] "' + id + '" could not be set up:', err); continue; }
      if (!h) continue;
      usage.register({
        id, title, group,
        isEnabled: () => !!h.on(),
        disable: () => { h.set(false); },
        enable: () => { h.set(true); },
      });
      done.push(id);
    }
    return done;
  },
};

if (typeof window !== 'undefined') window.VexUsageRegistry = VexUsageRegistry;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUsageRegistry };
