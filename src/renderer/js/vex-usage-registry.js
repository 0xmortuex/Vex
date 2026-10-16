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

  // A checkbox in the page that the app itself listens to: set through the box, so its own
  // change handler does the work and the box never disagrees with the setting.
  domToggle(elementId) {
    return () => {
      const el = typeof document !== 'undefined' ? document.getElementById(elementId) : null;
      if (!el || el.type !== 'checkbox') return null;
      return { on: () => !!el.checked, set: (v) => { el.checked = !!v; el.dispatchEvent(new Event('change', { bubbles: true })); } };
    };
  },
  // A JSON true/false preference that the module reads every time it acts; the Settings
  // box for it (if there is one) is updated to match.
  jsonFlag(key, def, elementId) {
    return () => ({
      on: () => { const raw = localStorage.getItem(key); return raw === null ? !!def : JSON.parse(raw) !== false; },
      set: (v) => {
        localStorage.setItem(key, JSON.stringify(!!v));
        const el = elementId && typeof document !== 'undefined' ? document.getElementById(elementId) : null;
        if (el && el.type === 'checkbox') el.checked = !!v;
      },
    });
  },
  // Light and dark by itself (js/theme-auto.js): off remembers the mode it had.
  themeAuto() {
    return (id) => {
      const G = typeof ThemeAuto !== 'undefined' ? ThemeAuto : null;
      if (!G || typeof G.isOn !== 'function' || typeof G.set !== 'function') return null;
      const k = this.PRIOR_PREFIX + id;
      return {
        on: () => G.isOn(),
        set: (v) => {
          if (!v) {
            const cur = G.state().mode;
            if (cur !== 'off') localStorage.setItem(k, cur);
            G.set({ mode: 'off' });
          } else {
            const prior = localStorage.getItem(k);
            G.set({ mode: prior && prior !== 'off' ? prior : 'system' });
            localStorage.removeItem(k);
          }
        },
      };
    };
  },

  // ---- the table ----------------------------------------------------------------
  // [id, adapter]. The title and the Settings heading come from the feature's manifest (js/feature-manifests.js).
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
      DistractionBudget: () => (typeof DistractionBudget !== 'undefined' ? DistractionBudget : null),
      SmartBookmarks: () => (typeof SmartBookmarks !== 'undefined' ? SmartBookmarks : null),
      VexSearchAgain: () => (typeof VexSearchAgain !== 'undefined' ? VexSearchAgain : null),
      VexAliases: () => (typeof VexAliases !== 'undefined' ? VexAliases : null),
      MeetingPrep: () => (typeof MeetingPrep !== 'undefined' ? MeetingPrep : null),
      RoutineDetect: () => (typeof RoutineDetect !== 'undefined' ? RoutineDetect : null),
      TabCleanup: () => (typeof TabCleanup !== 'undefined' ? TabCleanup : null),
      VexSelfTest: () => (typeof VexSelfTest !== 'undefined' ? VexSelfTest : null),
      VexSignoutWhy: () => (typeof VexSignoutWhy !== 'undefined' ? VexSignoutWhy : null),
      CommitGuard: () => (typeof CommitGuard !== 'undefined' ? CommitGuard : null),
      VexReleaseChecklist: () => (typeof VexReleaseChecklist !== 'undefined' ? VexReleaseChecklist : null),
      VexPlayfulness: () => (typeof VexPlayfulness !== 'undefined' ? VexPlayfulness : null),
      AttentionInbox: () => (typeof AttentionInbox !== 'undefined' ? AttentionInbox : null),
      GameFlush: () => (typeof GameFlush !== 'undefined' ? GameFlush : null),
      GameWarmdown: () => (typeof GameWarmdown !== 'undefined' ? GameWarmdown : null),
      GamePitstop: () => (typeof GamePitstop !== 'undefined' ? GamePitstop : null),
      GameChecklist: () => (typeof GameChecklist !== 'undefined' ? GameChecklist : null),
      GitHubVault: () => (typeof GitHubVault !== 'undefined' ? GitHubVault : null),
      CiFixLoop: () => (typeof CiFixLoop !== 'undefined' ? CiFixLoop : null),
      DevlogDrafter: () => (typeof DevlogDrafter !== 'undefined' ? DevlogDrafter : null),
      EndpointBoard: () => (typeof EndpointBoard !== 'undefined' ? EndpointBoard : null),
      DependencyRadar: () => (typeof DependencyRadar !== 'undefined' ? DependencyRadar : null),
      DeployDesk: () => (typeof DeployDesk !== 'undefined' ? DeployDesk : null),
    };
    return [
      // Brief actions group (js/brief-actions.js)
      ['brief-mail-triage', A.briefAction('mail')],
      ['brief-github-desk', A.briefAction('github')],
      ['brief-snooze', A.briefAction('snooze')],
      ['brief-finder', A.briefAction('finder')],
      ['brief-interests', A.briefAction('interests')],
      ['brief-day-layout', A.briefAction('dayLayout')],
      ['brief-next-action', A.briefAction('nextAction')],
      // Little surprises (js/delights.js)
      ['delight-rabbit-hole', A.delight('rabbit')],
      ['delight-time-capsule', A.delight('capsule')],
      ['delight-on-this-day', A.delight('onThisDay')],
      ['delight-old-bookmark', A.delight('oldBookmark')],
      ['delight-mood-themes', A.delight('mood')],
      ['delight-widgets', A.delight('widgets')],
      // Workflow (js/resume-workday.js hub)
      ['workflow-ask-tabs', A.workflow('askTabs', false)],
      ['workflow-focus-auto', A.workflow('focusAuto', false)],
      ['workflow-release-radar', A.workflow('releaseRadar', true)],
      ['workflow-weekly-note', A.workflow('weeklyNote', true)],
      ['workflow-resume-workday', A.workflow('workday', true)],
      // enabled()/setEnabled() modules
      ['citations', A.api(G.CitationTracker, 'enabled', 'setEnabled')],
      ['knowledge-base', A.api(G.KnowledgeAsk, 'enabled', 'setEnabled')],
      ['link-triage', A.api(G.LinkTriage, 'enabled', 'setEnabled')],
      ['listen-reader', A.api(G.ListenReader, 'enabled', 'setEnabled')],
      ['one-box', A.api(G.VexOneBox, 'enabled', 'setEnabled')],
      ['workspace-metrics', A.api(G.WorkspaceMetrics, 'enabled', 'setEnabled')],
      ['fortune', A.api(G.VexFortune, 'isEnabled', 'setEnabled')],
      // Page actions: turning them back on asks its own confirmation again.
      ['page-actions', A.api(G.PageActions, 'enabled', 'setEnabled')],
      // The check after an update (js/post-update-selftest.js)
      ['update-self-test', A.api(G.VexSelfTest, 'enabled', 'setEnabled')],
      // Says why a sign-in was lost after the next sign-in (js/signout-why-ui.js); the record itself stays.
      ['signout-why', A.api(G.VexSignoutWhy, 'enabled', 'setEnabled')],
      // Sheds Vex's own load when Windows is short of memory during Game mode (js/commit-guard.js).
      ['commit-guard', A.api(G.CommitGuard, 'enabled', 'setEnabled')],
      // Game mode helpers (js/game-helpers.js): save before a game, warm-down, the after-game card, the opt-in checklist.
      ['game-flush', A.api(G.GameFlush, 'enabled', 'setEnabled')],
      ['game-warmdown', A.api(G.GameWarmdown, 'enabled', 'setEnabled')],
      ['game-pitstop', A.api(G.GamePitstop, 'enabled', 'setEnabled')],
      ['game-checklist', A.api(G.GameChecklist, 'enabled', 'setEnabled')],
      // Release check (js/release-checklist.js): the CHANGELOG as a hand-check list.
      ['release-check', A.api(G.VexReleaseChecklist, 'enabled', 'setEnabled')],
      // Attention (js/vex-playfulness.js, js/attention-inbox.js). The New Tab layout (js/newtab-slots.js)
      // is deliberately NOT registered: Minimal Vex is the calm layout, so it must never switch it to Everything.
      ['playfulness', A.mode(G.VexPlayfulness, 'chosen', 'setLevel', 'off', 'calm')],
      ['attention-inbox', A.api(G.AttentionInbox, 'enabled', 'setEnabled')],
      // The developer loop (js/github-vault.js, js/dev-loop.js): read-only; off keeps the sealed token and the lists.
      ['github-vault', A.api(G.GitHubVault, 'enabled', 'setEnabled')],
      ['ci-fix-loop', A.api(G.CiFixLoop, 'enabled', 'setEnabled')],
      ['devlog-drafter', A.api(G.DevlogDrafter, 'enabled', 'setEnabled')],
      ['endpoint-board', A.api(G.EndpointBoard, 'enabled', 'setEnabled')],
      ['dependency-radar', A.api(G.DependencyRadar, 'enabled', 'setEnabled')],
      ['deploy-desk', A.api(G.DeployDesk, 'enabled', 'setEnabled')],
      // Fun and progress (js/fun/*) and Play (js/vex-fun.js)
      ['fun-pet', A.progress('pet')],
      ['fun-discovery', A.progress('discovery')],
      ['fun-levels', A.progress('levels')],
      ['fun-challenge', A.progress('challenge')],
      ['play-games', A.play('games')],
      ['play-tetris', A.play('tetris')],
      ['play-word', A.play('word')],
      ['play-sounds', A.play('sounds')],
      // Living (js/living-core.js)
      ['living-tab-personality', A.living('tabPersonality')],
      ['living-tab-glow', A.living('tabDailyGlow')],
      ['living-weather', A.living('weatherLayer')],
      ['living-stickers', A.living('stickers')],
      // Preference objects and modes
      ['distraction-budget', A.stateFlag(G.DistractionBudget)],
      ['smart-bookmarks', A.patched(G.SmartBookmarks, 'prefs', 'setPrefs')],
      ['search-again', A.patched(G.VexSearchAgain, 'prefs', 'savePrefs')],
      ['command-aliases', A.patched(G.VexAliases, 'prefs', 'savePrefs')],
      ['meeting-prep', A.mode(G.MeetingPrep, 'mode', 'setMode', 'off', 'ask')],
      ['routine-detect', A.mode(G.RoutineDetect, 'mode', 'setMode', 'off', 'on')],
      ['tab-cleanup', A.mode(G.TabCleanup, 'mode', 'setMode', 'off', 'ask')],
      // What Vex does on its own to tabs and the theme (listed in "Why did that happen?"). Their
      // manifests keep them on in Minimal Vex: it is the app's own housekeeping, not an extra.
      ['tab-auto-sleep', A.domToggle('setting-autosleep')],
      ['tab-auto-group', A.jsonFlag('vex.autoAddToGroups', true, 'setting-auto-add-to-groups')],
      ['theme-auto', A.themeAuto()],
    ];
  },

  // Registers every feature whose module is present. Returns the ids registered.
  register(U) {
    const usage = U || (typeof VexUsage !== 'undefined' ? VexUsage : null);
    if (!usage || typeof usage.register !== 'function') throw new Error('The usage record is not loaded');
    const done = [];
    const manifests = typeof VexRegistry !== 'undefined' ? VexRegistry : null;
    if (!manifests) throw new Error('The feature manifests are not loaded (js/feature-registry.js)');
    for (const [id, make] of this.table()) {
      const manifest = manifests.get(id);
      if (!manifest) throw new Error('Feature "' + id + '" has no manifest in js/feature-manifests.js');
      let h;
      try { h = make.call(this, id); } catch (err) { console.error('[UsageRegistry] "' + id + '" could not be set up:', err); continue; }
      if (!h) continue;
      usage.register({
        id, title: manifest.title, group: manifest.group,
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
