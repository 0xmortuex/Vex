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
      ChatLinkHygiene: () => (typeof ChatLinkHygiene !== 'undefined' ? ChatLinkHygiene : null),
      SafeWebExtras: () => (typeof SafeWebExtras !== 'undefined' ? SafeWebExtras : null),
      VexSnippets: () => (typeof VexSnippets !== 'undefined' ? VexSnippets : null),
      TableExtract: () => (typeof TableExtract !== 'undefined' ? TableExtract : null),
      VideoTools: () => (typeof VideoTools !== 'undefined' ? VideoTools : null),
      NewsletterLane: () => (typeof NewsletterLane !== 'undefined' ? NewsletterLane : null),
      HighlightResurface: () => (typeof HighlightResurface !== 'undefined' ? HighlightResurface : null),
      FormRescue: () => (typeof FormRescue !== 'undefined' ? FormRescue : null),
      VexPictureRedact: () => (typeof VexPictureRedact !== 'undefined' ? VexPictureRedact : null),
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
      VexDisclosure: () => (typeof VexDisclosure !== 'undefined' ? VexDisclosure : null),
      VexIntent: () => (typeof VexIntent !== 'undefined' ? VexIntent : null),
      VexUsageCounters: () => (typeof VexUsageCounters !== 'undefined' ? VexUsageCounters : null),
      VexFeatureSheet: () => (typeof VexFeatureSheet !== 'undefined' ? VexFeatureSheet : null),
      VexPlayfulness: () => (typeof VexPlayfulness !== 'undefined' ? VexPlayfulness : null),
      AttentionInbox: () => (typeof AttentionInbox !== 'undefined' ? AttentionInbox : null),
      GameFlush: () => (typeof GameFlush !== 'undefined' ? GameFlush : null),
      GameWarmdown: () => (typeof GameWarmdown !== 'undefined' ? GameWarmdown : null),
      GamePitstop: () => (typeof GamePitstop !== 'undefined' ? GamePitstop : null),
      VexScrollMemory: () => (typeof VexScrollMemory !== 'undefined' ? VexScrollMemory : null),
      VexEssentials: () => (typeof VexEssentials !== 'undefined' ? VexEssentials : null),
      VexSpellLang: () => (typeof VexSpellLang !== 'undefined' ? VexSpellLang : null),
      VexAutoscroll: () => (typeof VexAutoscroll !== 'undefined' ? VexAutoscroll : null),
      VexPinnedHome: () => (typeof VexPinnedHome !== 'undefined' ? VexPinnedHome : null),
      VexLoadFailure: () => (typeof VexLoadFailure !== 'undefined' ? VexLoadFailure : null),
      VexPastePlain: () => (typeof VexPastePlain !== 'undefined' ? VexPastePlain : null),
      VexTabTextFind: () => (typeof VexTabTextFind !== 'undefined' ? VexTabTextFind : null),
      GameChecklist: () => (typeof GameChecklist !== 'undefined' ? GameChecklist : null),
      GitHubVault: () => (typeof GitHubVault !== 'undefined' ? GitHubVault : null),
      CiFixLoop: () => (typeof CiFixLoop !== 'undefined' ? CiFixLoop : null),
      DevlogDrafter: () => (typeof DevlogDrafter !== 'undefined' ? DevlogDrafter : null),
      EndpointBoard: () => (typeof EndpointBoard !== 'undefined' ? EndpointBoard : null),
      DependencyRadar: () => (typeof DependencyRadar !== 'undefined' ? DependencyRadar : null),
      DeployDesk: () => (typeof DeployDesk !== 'undefined' ? DeployDesk : null),
      VexRepos: () => (typeof VexRepos !== 'undefined' ? VexRepos : null),
      VexBangs: () => (typeof VexBangs !== 'undefined' ? VexBangs : null),
      VexCopyAs: () => (typeof VexCopyAs !== 'undefined' ? VexCopyAs : null),
      VexGithubHelpers: () => (typeof VexGithubHelpers !== 'undefined' ? VexGithubHelpers : null),
      VexShellTranslate: () => (typeof VexShellTranslate !== 'undefined' ? VexShellTranslate : null),
      VexDecode: () => (typeof VexDecode !== 'undefined' ? VexDecode : null),
      VexFakeUpdate: () => (typeof VexFakeUpdate !== 'undefined' ? VexFakeUpdate : null),
      VexReferenceSets: () => (typeof VexReferenceSets !== 'undefined' ? VexReferenceSets : null),
      CloudflareShortcuts: () => (typeof CloudflareShortcuts !== 'undefined' ? CloudflareShortcuts : null),
      RobloxResolver: () => (typeof RobloxResolver !== 'undefined' ? RobloxResolver : null),
      RepoSkim: () => (typeof RepoSkim !== 'undefined' ? RepoSkim : null),
      LocalServices: () => (typeof LocalServices !== 'undefined' ? LocalServices : null),
      WebhookInspector: () => (typeof WebhookInspector !== 'undefined' ? WebhookInspector : null),
      ReadingTriage: () => (typeof ReadingTriage !== 'undefined' ? ReadingTriage : null),
      SeenBefore: () => (typeof SeenBefore !== 'undefined' ? SeenBefore : null),
      AiRecipes: () => (typeof AiRecipes !== 'undefined' ? AiRecipes : null),
      WatchJudgement: () => (typeof WatchJudgement !== 'undefined' ? WatchJudgement : null),
      VexDueness: () => (typeof VexDueness !== 'undefined' ? VexDueness : null),
      VexFirstOpen: () => (typeof VexFirstOpen !== 'undefined' ? VexFirstOpen : null),
      VexInbox: () => (typeof VexInbox !== 'undefined' ? VexInbox : null),
      VexNextStep: () => (typeof VexNextStep !== 'undefined' ? VexNextStep : null),
      VexPark: () => (typeof VexPark !== 'undefined' ? VexPark : null),
      VexCopySource: () => (typeof VexCopySource !== 'undefined' ? VexCopySource : null),
      VexDeadlines: () => (typeof VexDeadlines !== 'undefined' ? VexDeadlines : null),
      VexGuest: () => (typeof VexGuest !== 'undefined' ? VexGuest : null),
      VexExtDiff: () => (typeof VexExtDiff !== 'undefined' ? VexExtDiff : null),
      VexClipboardTripwire: () => (typeof VexClipboardTripwire !== 'undefined' ? VexClipboardTripwire : null),
      VexStartupCheck: () => (typeof VexStartupCheck !== 'undefined' ? VexStartupCheck : null),
      WarmModel: () => (typeof WarmModel !== 'undefined' ? WarmModel : null),
      VexSecureLock: () => (typeof VexSecureLock !== 'undefined' ? VexSecureLock : null),
      VexSlotWatcher: () => (typeof VexSlotWatcher !== 'undefined' ? VexSlotWatcher : null),
      VexPhotoPrep: () => (typeof VexPhotoPrep !== 'undefined' ? VexPhotoPrep : null),
      VexFormAssist: () => (typeof VexFormAssist !== 'undefined' ? VexFormAssist : null),
      // Wave 3, capture and study
      VexSources: () => (typeof VexSources !== 'undefined' ? VexSources : null),
      VexArchiveOnCite: () => (typeof VexArchiveOnCite !== 'undefined' ? VexArchiveOnCite : null),
      VexMediaControl: () => (typeof VexMediaControl !== 'undefined' ? VexMediaControl : null),
      VexPhoneShare: () => (typeof VexPhoneShare !== 'undefined' ? VexPhoneShare : null),
      VexStudyNotes: () => (typeof VexStudyNotes !== 'undefined' ? VexStudyNotes : null),
      VexPdfHighlights: () => (typeof VexPdfHighlights !== 'undefined' ? VexPdfHighlights : null),
      VexPdfTools: () => (typeof VexPdfTools !== 'undefined' ? VexPdfTools : null),
      VexRituals: () => (typeof VexRituals !== 'undefined' ? VexRituals : null),
      VexFollowUps: () => (typeof VexFollowUps !== 'undefined' ? VexFollowUps : null),
      VexTwoMinute: () => (typeof VexTwoMinute !== 'undefined' ? VexTwoMinute : null),
      VexWeekdaySet: () => (typeof VexWeekdaySet !== 'undefined' ? VexWeekdaySet : null),
      VexDeadlineLedger: () => (typeof VexDeadlineLedger !== 'undefined' ? VexDeadlineLedger : null),
      VexTravel: () => (typeof VexTravel !== 'undefined' ? VexTravel : null),
      VexContainerMemory: () => (typeof VexContainerMemory !== 'undefined' ? VexContainerMemory : null),
      VexExpenseCapture: () => (typeof VexExpenseCapture !== 'undefined' ? VexExpenseCapture : null),
      VexPageReminders: () => (typeof VexPageReminders !== 'undefined' ? VexPageReminders : null),
      VexHolidays: () => (typeof VexHolidays !== 'undefined' ? VexHolidays : null),
      VexTl: () => (typeof VexTl !== 'undefined' ? VexTl : null),
      PanelCapture: () => (typeof PanelCapture !== 'undefined' ? PanelCapture : null),
      VipRules: () => (typeof VipRules !== 'undefined' ? VipRules : null),
      NeedsMe: () => (typeof NeedsMe !== 'undefined' ? NeedsMe : null),
      PanelState: () => (typeof PanelState !== 'undefined' ? PanelState : null),
      AwayMode: () => (typeof AwayMode !== 'undefined' ? AwayMode : null),
      AttentionDigest: () => (typeof AttentionDigest !== 'undefined' ? AttentionDigest : null),
      CloseProtect: () => (typeof CloseProtect !== 'undefined' ? CloseProtect : null),
      VexTabMru: () => (typeof VexTabMru !== 'undefined' ? VexTabMru : null),
      VexTabSearch: () => (typeof VexTabSearch !== 'undefined' ? VexTabSearch : null),
      VexNavHistoryMenu: () => (typeof VexNavHistoryMenu !== 'undefined' ? VexNavHistoryMenu : null),
      VexStripActions: () => (typeof VexStripActions !== 'undefined' ? VexStripActions : null),
      NightCoach: () => (typeof NightCoach !== 'undefined' ? NightCoach : null),
      VexGestureEditor: () => (typeof VexGestureEditor !== 'undefined' ? VexGestureEditor : null),
      VexTabSelect: () => (typeof VexTabSelect !== 'undefined' ? VexTabSelect : null),
      VexTabHold: () => (typeof VexTabHold !== 'undefined' ? VexTabHold : null),
      VexTabNames: () => (typeof VexTabNames !== 'undefined' ? VexTabNames : null),
      VexTabThumbs: () => (typeof VexTabThumbs !== 'undefined' ? VexTabThumbs : null),
      VexLinkHints: () => (typeof VexLinkHints !== 'undefined' ? VexLinkHints : null),
      VexSplitKeys: () => (typeof VexSplitKeys !== 'undefined' ? VexSplitKeys : null),
      VexPreconnect: () => (typeof VexPreconnect !== 'undefined' ? VexPreconnect : null),
      VexMiniWindow: () => (typeof VexMiniWindow !== 'undefined' ? VexMiniWindow : null),
      VexJumpActions: () => (typeof VexJumpActions !== 'undefined' ? VexJumpActions : null),
      VexWindowSet: () => (typeof VexWindowSet !== 'undefined' ? VexWindowSet : null),
      AnnounceDesk: () => (typeof AnnounceDesk !== 'undefined' ? AnnounceDesk : null),
      VexCapabilityDial: () => (typeof VexCapabilityDial !== 'undefined' ? VexCapabilityDial : null),
      VexLongDoc: () => (typeof VexLongDoc !== 'undefined' ? VexLongDoc : null),
      VexThreadDigest: () => (typeof VexThreadDigest !== 'undefined' ? VexThreadDigest : null),
      VexDraftField: () => (typeof VexDraftField !== 'undefined' ? VexDraftField : null),
      VexEmbedManager: () => (typeof VexEmbedManager !== 'undefined' ? VexEmbedManager : null),
      VexAnswerCitations: () => (typeof VexAnswerCitations !== 'undefined' ? VexAnswerCitations : null),
      VexSkills: () => (typeof VexSkills !== 'undefined' ? VexSkills : null),
      GameLibrary: () => (typeof GameLibrary !== 'undefined' ? GameLibrary : null),
      MasterVolume: () => (typeof MasterVolume !== 'undefined' ? MasterVolume : null),
      LinkRouting: () => (typeof LinkRouting !== 'undefined' ? LinkRouting : null),
      RefreshOnDeploy: () => (typeof RefreshOnDeploy !== 'undefined' ? RefreshOnDeploy : null),
      BypassDoctor: () => (typeof BypassDoctor !== 'undefined' ? BypassDoctor : null),
      WatchAlerts: () => (typeof WatchAlerts !== 'undefined' ? WatchAlerts : null),
      VexTabsNav: () => (typeof VexTabsNav !== 'undefined' ? VexTabsNav : null),
      DevDesk: () => (typeof DevDesk !== 'undefined' ? DevDesk : null),
      DevPortsPair: () => (typeof DevPortsPair !== 'undefined' ? DevPortsPair : null),
      ActionsBoard: () => (typeof ActionsBoard !== 'undefined' ? ActionsBoard : null),
      LogReader: () => (typeof LogReader !== 'undefined' ? LogReader : null),
      PluginDev: () => (typeof PluginDev !== 'undefined' ? PluginDev : null),
      ElectronTicker: () => (typeof ElectronTicker !== 'undefined' ? ElectronTicker : null),
      SecretGuard: () => (typeof SecretGuard !== 'undefined' ? SecretGuard : null),
      VexBugBundle: () => (typeof VexBugBundle !== 'undefined' ? VexBugBundle : null),
      VexOverrides: () => (typeof VexOverrides !== 'undefined' ? VexOverrides : null),
      VexSelectionTools: () => (typeof VexSelectionTools !== 'undefined' ? VexSelectionTools : null),
      VexLogTailer: () => (typeof VexLogTailer !== 'undefined' ? VexLogTailer : null),
      VexErrorMemory: () => (typeof VexErrorMemory !== 'undefined' ? VexErrorMemory : null),
      VexDocsPin: () => (typeof VexDocsPin !== 'undefined' ? VexDocsPin : null),
      VexPkgCard: () => (typeof VexPkgCard !== 'undefined' ? VexPkgCard : null),
      VexCodeLibrary: () => (typeof VexCodeLibrary !== 'undefined' ? VexCodeLibrary : null),
      VexTrParse: () => (typeof VexTrParse !== 'undefined' ? VexTrParse : null),
      VexLocaleTranslate: () => (typeof VexLocaleTranslate !== 'undefined' ? VexLocaleTranslate : null),
      VexStudyBlock: () => (typeof VexStudyBlock !== 'undefined' ? VexStudyBlock : null),
      VexExamPlanner: () => (typeof VexExamPlanner !== 'undefined' ? VexExamPlanner : null),
      VexExamSafeMode: () => (typeof VexExamSafeMode !== 'undefined' ? VexExamSafeMode : null),
      VexPaperSession: () => (typeof VexPaperSession !== 'undefined' ? VexPaperSession : null),
      VexCourseSpaces: () => (typeof VexCourseSpaces !== 'undefined' ? VexCourseSpaces : null),
      VexPaperBrief: () => (typeof VexPaperBrief !== 'undefined' ? VexPaperBrief : null),
      VexMunDossier: () => (typeof VexMunDossier !== 'undefined' ? VexMunDossier : null),
      VexStudyEntry: () => (typeof VexStudyEntry !== 'undefined' ? VexStudyEntry : null),
      VexLibraryLinks: () => (typeof VexLibraryLinks !== 'undefined' ? VexLibraryLinks : null),
      VexAgentPins: () => (typeof VexAgentPins !== 'undefined' ? VexAgentPins : null),
      VexSecondScreen: () => (typeof VexSecondScreen !== 'undefined' ? VexSecondScreen : null),
      GameScenes: () => (typeof GameScenes !== 'undefined' ? GameScenes : null),
      VexGccBridge: () => (typeof VexGccBridge !== 'undefined' ? VexGccBridge : null),
      GameLoadouts: () => (typeof GameLoadouts !== 'undefined' ? GameLoadouts : null),
      IntentGate: () => (typeof IntentGate !== 'undefined' ? IntentGate : null),
      BreakPrompts: () => (typeof BreakPrompts !== 'undefined' ? BreakPrompts : null),
      OrdersHub: () => (typeof OrdersHub !== 'undefined' ? OrdersHub : null),
      ExamCalendar: () => (typeof ExamCalendar !== 'undefined' ? ExamCalendar : null),
      ReceiptLocker: () => (typeof ReceiptLocker !== 'undefined' ? ReceiptLocker : null),
      VexCarry: () => (typeof VexCarry !== 'undefined' ? VexCarry : null),
      VexWhen: () => (typeof VexWhen !== 'undefined' ? VexWhen : null),
      VexCloseDay: () => (typeof VexCloseDay !== 'undefined' ? VexCloseDay : null),
      VexDayShape: () => (typeof VexDayShape !== 'undefined' ? VexDayShape : null),
      VexRefind: () => (typeof VexRefind !== 'undefined' ? VexRefind : null),
      VexTabIntent: () => (typeof VexTabIntent !== 'undefined' ? VexTabIntent : null),
      VexChanged: () => (typeof VexChanged !== 'undefined' ? VexChanged : null),
      VexFocusCal: () => (typeof VexFocusCal !== 'undefined' ? VexFocusCal : null),
      VexChores: () => (typeof VexChores !== 'undefined' ? VexChores : null),
      VexWeekSkeleton: () => (typeof VexWeekSkeleton !== 'undefined' ? VexWeekSkeleton : null),
      VexTriage: () => (typeof VexTriage !== 'undefined' ? VexTriage : null),
      VexSummaryCache: () => (typeof VexSummaryCache !== 'undefined' ? VexSummaryCache : null),
      VexTos: () => (typeof VexTos !== 'undefined' ? VexTos : null),
      VexChanges: () => (typeof VexChanges !== 'undefined' ? VexChanges : null),
      VexWhatsNewMe: () => (typeof VexWhatsNewMe !== 'undefined' ? VexWhatsNewMe : null),
      VexRevisit: () => (typeof VexRevisit !== 'undefined' ? VexRevisit : null),
      VexWorkspaceArchive: () => (typeof VexWorkspaceArchive !== 'undefined' ? VexWorkspaceArchive : null),
      VexDownloadDesk: () => (typeof VexDownloadDesk !== 'undefined' ? VexDownloadDesk : null),
      ConsentBlock: () => (typeof ConsentBlock !== 'undefined' ? ConsentBlock : null),
      VexMarketplaceSigns: () => (typeof VexMarketplaceSigns !== 'undefined' ? VexMarketplaceSigns : null),
      VexChatFlag: () => (typeof VexChatFlag !== 'undefined' ? VexChatFlag : null),
      VexChatThrowaway: () => (typeof VexChatThrowaway !== 'undefined' ? VexChatThrowaway : null),
      VexQrVerdict: () => (typeof VexQrVerdict !== 'undefined' ? VexQrVerdict : null),
      VexDefenderShortcut: () => (typeof VexDefenderShortcut !== 'undefined' ? VexDefenderShortcut : null),
      VexMotwCheck: () => (typeof VexMotwCheck !== 'undefined' ? VexMotwCheck : null),
      VexScreenShareSafe: () => (typeof VexScreenShareSafe !== 'undefined' ? VexScreenShareSafe : null),
      VexVaultHygiene: () => (typeof VexVaultHygiene !== 'undefined' ? VexVaultHygiene : null),
      VexPatchDigest: () => (typeof VexPatchDigest !== 'undefined' ? VexPatchDigest : null),
      VexServiceCheck: () => (typeof VexServiceCheck !== 'undefined' ? VexServiceCheck : null),
      VexPanelGuard: () => (typeof VexPanelGuard !== 'undefined' ? VexPanelGuard : null),
      VexNetCourtesy: () => (typeof VexNetCourtesy !== 'undefined' ? VexNetCourtesy : null),
      VideoLater: () => (typeof VideoLater !== 'undefined' ? VideoLater : null),
      VexGameTimers: () => (typeof VexGameTimers !== 'undefined' ? VexGameTimers : null),
      VexContentBoard: () => (typeof VexContentBoard !== 'undefined' ? VexContentBoard : null),
      VexDropsDesk: () => (typeof VexDropsDesk !== 'undefined' ? VexDropsDesk : null),
      VexWritingDesk: () => (typeof VexWritingDesk !== 'undefined' ? VexWritingDesk : null),
      VexPushBundle: () => (typeof VexPushBundle !== 'undefined' ? VexPushBundle : null),
      VexStudyGlossary: () => (typeof VexStudyGlossary !== 'undefined' ? VexStudyGlossary : null),
      VexStudyLedger: () => (typeof VexStudyLedger !== 'undefined' ? VexStudyLedger : null),
      VexCheatSheet: () => (typeof VexCheatSheet !== 'undefined' ? VexCheatSheet : null),
      VexDraftCheck: () => (typeof VexDraftCheck !== 'undefined' ? VexDraftCheck : null),
      VexSyllabusCheck: () => (typeof VexSyllabusCheck !== 'undefined' ? VexSyllabusCheck : null),
      VexSourceBadge: () => (typeof VexSourceBadge !== 'undefined' ? VexSourceBadge : null),
      VexMunToolkit: () => (typeof VexMunToolkit !== 'undefined' ? VexMunToolkit : null),
      VexSpeechTimer: () => (typeof VexSpeechTimer !== 'undefined' ? VexSpeechTimer : null),
      VexTurkishHelpers: () => (typeof VexTurkishHelpers !== 'undefined' ? VexTurkishHelpers : null),
      VexPackContent: () => (typeof VexPackContent !== 'undefined' ? VexPackContent : null),
      PageWatchTemplates: () => (typeof PageWatchTemplates !== 'undefined' ? PageWatchTemplates : null),
      StorageCeilings: () => (typeof StorageCeilings !== 'undefined' ? StorageCeilings : null),
      GameHolds: () => (typeof GameHolds !== 'undefined' ? GameHolds : null),
      VexBriefCards: () => (typeof VexBriefCards !== 'undefined' ? VexBriefCards : null),
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
      // Wave 2 capture tools
      ['text-snippets', A.api(G.VexSnippets, 'enabled', 'setEnabled')],
      ['table-extract', A.api(G.TableExtract, 'enabled', 'setEnabled')],
      ['video-tools', A.api(G.VideoTools, 'enabled', 'setEnabled')],
      ['newsletter-lane', A.api(G.NewsletterLane, 'enabled', 'setEnabled')],
      ['resurface', A.api(G.HighlightResurface, 'enabled', 'setEnabled')],
      ['form-rescue', A.api(G.FormRescue, 'enabled', 'setEnabled')],
      ['redact-tool', A.api(G.VexPictureRedact, 'enabled', 'setEnabled')],
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
      // Tab comforts (Wave 3). Off, each leaves what it kept where it is.
      ['scroll-memory', A.api(G.VexScrollMemory, 'enabled', 'setEnabled')],
      ['essentials', A.api(G.VexEssentials, 'enabled', 'setEnabled')],
      ['spell-lang', A.api(G.VexSpellLang, 'enabled', 'setEnabled')],
      ['autoscroll', A.api(G.VexAutoscroll, 'enabled', 'setEnabled')],
      ['pinned-home', A.api(G.VexPinnedHome, 'enabled', 'setEnabled')],
      ['load-failure', A.api(G.VexLoadFailure, 'enabled', 'setEnabled')],
      ['paste-plain', A.api(G.VexPastePlain, 'enabled', 'setEnabled')],
      ['tab-text-find', A.api(G.VexTabTextFind, 'enabled', 'setEnabled')],
      ['game-checklist', A.api(G.GameChecklist, 'enabled', 'setEnabled')],
      // Release check (js/release-checklist.js): the CHANGELOG as a hand-check list.
      ['release-check', A.api(G.VexReleaseChecklist, 'enabled', 'setEnabled')],
      // Wave 2: permission hygiene, the signed-in list and kill switch, the incident checklists, the password-page check.
      ['perm-hygiene', A.api(G.VexPermHygiene, 'enabled', 'setEnabled')],
      ['signed-in', A.api(G.VexSignedIn, 'enabled', 'setEnabled')],
      ['incident-playbooks', A.api(G.VexIncident, 'enabled', 'setEnabled')],
      // Wave 4 fold-ins: holidays and phrases from packs, watch templates, the held-while-playing list, four brief cards.
      ['pack-content', A.api(G.VexPackContent, 'enabled', 'setEnabled')],
      ['page-watch-templates', A.api(G.PageWatchTemplates, 'enabled', 'setEnabled')],
      ['storage-retention', A.api(G.StorageCeilings, 'retentionEnabled', 'setRetentionEnabled')],
      ['game-holds', A.api(G.GameHolds, 'enabled', 'setEnabled')],
      ['brief-cards', A.api(G.VexBriefCards, 'enabled', 'setEnabled')],
      ['credential-interlock', A.api(G.CredentialInterlock, 'enabled', 'setEnabled')],
      // Wave 3: they act by themselves, so each can be switched off (and starts off on an existing profile).
      ['progressive-disclosure', A.api(G.VexDisclosure, 'enabled', 'setEnabled')],
      ['intent-search', A.api(G.VexIntent, 'enabled', 'setEnabled')],
      ['usage-counters', A.api(G.VexUsageCounters, 'enabled', 'setEnabled')],
      ['capability-dial', A.api(G.VexCapabilityDial, 'enabled', 'setPref')],
      ['first-use-sheet', A.api(G.VexFeatureSheet, 'enabled', 'setEnabled')],
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
      // Developer helpers (js/dev-helpers.js and the seven files it gathers)
      ['repo-registry', A.api(G.VexRepos, 'enabled', 'setEnabled')],
      ['search-bangs', A.api(G.VexBangs, 'enabled', 'setEnabled')],
      ['copy-as-request', A.api(G.VexCopyAs, 'enabled', 'setEnabled')],
      ['github-helpers', A.api(G.VexGithubHelpers, 'enabled', 'setEnabled')],
      ['snippet-translator', A.api(G.VexShellTranslate, 'enabled', 'setEnabled')],
      ['selection-decoder', A.api(G.VexDecode, 'enabled', 'setEnabled')],
      // Warns about a fake "update your browser" notice on a page (js/fake-update-guard.js); passive, follows Web safety.
      ['fake-update-guard', A.api(G.VexFakeUpdate, 'enabled', 'setEnabled')],
      ['reference-sets', A.api(G.VexReferenceSets, 'enabled', 'setEnabled')],
      // Wave 3: shortcuts and tools that run only when asked (js/dev-shortcuts.js, js/local-tools-ui.js, js/ai-judgement.js).
      // Local services and the webhook inspector are off by default; switching them off also takes back what main holds.
      ['cloudflare-shortcuts', A.api(G.CloudflareShortcuts, 'enabled', 'setEnabled')],
      ['roblox-resolver', A.api(G.RobloxResolver, 'enabled', 'setEnabled')],
      ['repo-skim', A.api(G.RepoSkim, 'enabled', 'setEnabled')],
      ['local-services', A.api(G.LocalServices, 'enabled', 'setEnabled')],
      ['webhook-inspector', A.api(G.WebhookInspector, 'enabled', 'setEnabled')],
      ['reading-triage', A.api(G.ReadingTriage, 'enabled', 'setEnabled')],
      ['seen-before', A.api(G.SeenBefore, 'enabled', 'setEnabled')],
      ['ai-recipes', A.api(G.AiRecipes, 'enabled', 'setEnabled')],
      ['watch-judgement', A.api(G.WatchJudgement, 'enabled', 'setEnabled')],
      // Wave 1, the daily flow: new features, staged off on a profile that already existed.
      ['dueness', A.api(G.VexDueness, 'enabled', 'setEnabled')],
      ['first-open', A.api(G.VexFirstOpen, 'enabled', 'setEnabled')],
      ['inbox-unified', A.api(G.VexInbox, 'enabled', 'setEnabled')],
      ['next-step', A.api(G.VexNextStep, 'enabled', 'setEnabled')],
      ['park-resume', A.api(G.VexPark, 'enabled', 'setEnabled')],
      ['copy-source', A.api(G.VexCopySource, 'enabled', 'setEnabled')],
      ['deadline-extractor', A.api(G.VexDeadlines, 'enabled', 'setEnabled')],
      // Wave 3: trust and housekeeping. The AI spend cap is deliberately NOT here: it is a safety net, and
      // Minimal Vex must not lift it.
      ['summary-cache', A.api(G.VexSummaryCache, 'enabled', 'setEnabled')],
      ['tos-highlighter', A.api(G.VexTos, 'enabled', 'setEnabled')],
      ['what-i-changed', A.api(G.VexChanges, 'enabled', 'setEnabled')],
      ['whats-new-me', A.api(G.VexWhatsNewMe, 'enabled', 'setEnabled')],
      ['revisit-watch', A.api(G.VexRevisit, 'enabled', 'setEnabled')],
      ['workspace-archive', A.api(G.VexWorkspaceArchive, 'enabled', 'setEnabled')],
      ['download-desk', A.api(G.VexDownloadDesk, 'enabled', 'setEnabled')],
      // Wave 3, capture and study: new features, staged off on a profile that already existed.
      ['sources', A.api(G.VexSources, 'enabled', 'setEnabled')],
      ['archive-on-cite', A.api(G.VexArchiveOnCite, 'enabled', 'setEnabled')],
      ['media-control', A.api(G.VexMediaControl, 'enabled', 'setEnabled')],
      ['phone-share', A.api(G.VexPhoneShare, 'enabled', 'setEnabled')],
      ['study-notes', A.api(G.VexStudyNotes, 'enabled', 'setEnabled')],
      ['pdf-highlights', A.api(G.VexPdfHighlights, 'enabled', 'setEnabled')],
      ['pdf-tools', A.api(G.VexPdfTools, 'enabled', 'setEnabled')],
      // Wave 3, daily life: new features, staged off on a profile that already existed.
      ['rituals', A.api(G.VexRituals, 'enabled', 'setEnabled')],
      ['follow-ups', A.api(G.VexFollowUps, 'enabled', 'setEnabled')],
      ['two-minute', A.api(G.VexTwoMinute, 'enabled', 'setEnabled')],
      ['weekday-set', A.api(G.VexWeekdaySet, 'enabled', 'setEnabled')],
      ['deadline-ledger', A.api(G.VexDeadlineLedger, 'enabled', 'setEnabled')],
      ['travel-mode', A.api(G.VexTravel, 'enabled', 'setEnabled')],
      ['container-memory', A.api(G.VexContainerMemory, 'enabled', 'setEnabled')],
      ['expense-capture', A.api(G.VexExpenseCapture, 'enabled', 'setEnabled')],
      ['page-reminders', A.api(G.VexPageReminders, 'enabled', 'setEnabled')],
      ['holiday-planner', A.api(G.VexHolidays, 'enabled', 'setEnabled')],
      ['tl-equivalent', A.api(G.VexTl, 'enabled', 'setEnabled')],
      // Panels and messages (js/panels-comms-ui.js draws them). Turning notifications from panels back on
      // needs the consent the person gave, so it never comes back by itself without it.
      ['panel-capture', A.api(G.PanelCapture, 'enabled', 'setEnabled')],
      ['vip-rules', A.api(G.VipRules, 'enabled', 'setEnabled')],
      ['needs-me', A.api(G.NeedsMe, 'enabled', 'setEnabled')],
      ['panel-state', A.api(G.PanelState, 'enabled', 'setEnabled')],
      ['away-mode', A.api(G.AwayMode, 'enabled', 'setEnabled')],
      ['attention-digest', A.api(G.AttentionDigest, 'enabled', 'setEnabled')],
      ['close-protect', A.api(G.CloseProtect, 'enabled', 'setEnabled')],
      // Tab tools, the night coach and the announcement desk (Wave 1). Off, each leaves what it kept where it is.
      ['tab-mru', A.api(G.VexTabMru, 'enabled', 'setEnabled')],
      ['tab-search', A.api(G.VexTabSearch, 'enabled', 'setEnabled')],
      ['nav-history-menu', A.api(G.VexNavHistoryMenu, 'enabled', 'setEnabled')],
      ['strip-actions', A.api(G.VexStripActions, 'enabled', 'setEnabled')],
      ['night-coach', A.api(G.NightCoach, 'enabled', 'setEnabled')],
      // Wave 3 (tab tools, links and windows, taskbar actions, gesture editor).
      ['gesture-editor', A.api(G.VexGestureEditor, 'enabled', 'setEnabled')],
      ['tab-select', A.api(G.VexTabSelect, 'enabled', 'setEnabled')],
      ['tab-hold', A.api(G.VexTabHold, 'enabled', 'setEnabled')],
      ['tab-names', A.api(G.VexTabNames, 'enabled', 'setEnabled')],
      ['tab-thumbs', A.api(G.VexTabThumbs, 'enabled', 'setEnabled')],
      ['link-hints', A.api(G.VexLinkHints, 'enabled', 'setEnabled')],
      ['split-keys', A.api(G.VexSplitKeys, 'enabled', 'setEnabled')],
      ['preconnect', A.api(G.VexPreconnect, 'enabled', 'setEnabled')],
      ['mini-window', A.api(G.VexMiniWindow, 'enabled', 'setEnabled')],
      ['jump-list', A.api(G.VexJumpActions, 'enabled', 'setEnabled')],
      ['window-set', A.api(G.VexWindowSet, 'enabled', 'setEnabled')],
      ['announce-desk', A.api(G.AnnounceDesk, 'enabled', 'setEnabled')],
      // Wave 4: safer web fold-ins (both are off until switched on).
      ['chat-link-hygiene', A.api(G.ChatLinkHygiene, 'enabled', 'setEnabled')],
      ['breach-recheck', A.api(G.SafeWebExtras, 'enabled', 'setEnabled')],
      // Wave 2 AI features: each has its own on/off key and only works on this PC's local model.
      ['longdoc-engine', A.api(G.VexLongDoc, 'enabled', 'setEnabled')],
      ['thread-digest', A.api(G.VexThreadDigest, 'enabled', 'setEnabled')],
      ['draft-in-field', A.api(G.VexDraftField, 'enabled', 'setEnabled')],
      ['embedding-manager', A.api(G.VexEmbedManager, 'enabled', 'setEnabled')],
      ['answer-citations', A.api(G.VexAnswerCitations, 'enabled', 'setEnabled')],
      ['site-instructions', A.api(G.VexSkills, 'siteEnabled', 'setSiteEnabled')],
      // Wave 2 (fixes and foundations)
      ['game-library', A.api(G.GameLibrary, 'enabled', 'setEnabled')],
      ['site-audio-memory', A.api(G.MasterVolume, 'siteMemoryEnabled', 'setSiteMemoryEnabled')],
      ['link-routing', A.api(G.LinkRouting, 'enabled', 'setEnabled')],
      ['refresh-on-deploy', A.api(G.RefreshOnDeploy, 'enabled', 'setEnabled')],
      ['bypass-doctor', A.api(G.BypassDoctor, 'enabled', 'setEnabled')],
      ['watch-alerts', A.api(G.WatchAlerts, 'enabled', 'setEnabled')],
      // Tabs and navigation extras (js/tabs-nav.js): find options, clean copy, typed-count completion, Keep on top, activity dots.
      ['tabs-nav', A.api(G.VexTabsNav, 'enabled', 'setEnabled')],
      // The developer desk (js/dev-desk.js and friends): each off until switched on; off keeps the lists.
      ['dev-desk', A.api(G.DevDesk, 'enabled', 'setEnabled')],
      ['dev-ports-pair', A.api(G.DevPortsPair, 'enabled', 'setEnabled')],
      ['actions-board', A.api(G.ActionsBoard, 'enabled', 'setEnabled')],
      ['log-reader', A.api(G.LogReader, 'enabled', 'setEnabled')],
      ['plugin-dev', A.api(G.PluginDev, 'enabled', 'setEnabled')],
      ['electron-ticker', A.api(G.ElectronTicker, 'enabled', 'setEnabled')],
      ['secret-guard', A.api(G.SecretGuard, 'enabled', 'setEnabled')],
      // Developer bench (js/dev-bench.js and the eight tools it gathers)
      ['bug-bundle', A.api(G.VexBugBundle, 'enabled', 'setEnabled')],
      ['response-overrides', A.api(G.VexOverrides, 'enabled', 'setEnabled')],
      ['selection-tools', A.api(G.VexSelectionTools, 'enabled', 'setEnabled')],
      ['log-tailer', A.api(G.VexLogTailer, 'enabled', 'setEnabled')],
      ['error-memory', A.api(G.VexErrorMemory, 'enabled', 'setEnabled')],
      ['docs-pin', A.api(G.VexDocsPin, 'enabled', 'setEnabled')],
      ['pkg-card', A.api(G.VexPkgCard, 'enabled', 'setEnabled')],
      ['code-library', A.api(G.VexCodeLibrary, 'enabled', 'setEnabled')],
      // Study and Turkish (Wave 2)
      ['turkish-parse', A.api(G.VexTrParse, 'enabled', 'setEnabled')],
      ['locale-translate', A.api(G.VexLocaleTranslate, 'enabled', 'setEnabled')],
      ['study-block', A.api(G.VexStudyBlock, 'enabled', 'setEnabled')],
      ['exam-planner', A.api(G.VexExamPlanner, 'enabled', 'setEnabled')],
      ['exam-safe-mode', A.api(G.VexExamSafeMode, 'enabled', 'setEnabled')],
      ['paper-session', A.api(G.VexPaperSession, 'enabled', 'setEnabled')],
      ['course-spaces', A.api(G.VexCourseSpaces, 'enabled', 'setEnabled')],
      ['paper-brief', A.api(G.VexPaperBrief, 'enabled', 'setEnabled')],
      ['mun-dossier', A.api(G.VexMunDossier, 'enabled', 'setEnabled')],
      // Wave 4 fold-ins
      ['study-entry', A.api(G.VexStudyEntry, 'enabled', 'setEnabled')],
      ['library-links', A.api(G.VexLibraryLinks, 'enabled', 'setEnabled')],
      ['agent-pins', A.api(G.VexAgentPins, 'enabled', 'setEnabled')],
      // Wave 2: games and daily life (each module keeps its own on/off flag)
      ['second-screen', A.api(G.VexSecondScreen, 'enabled', 'setEnabled')],
      ['game-scenes', A.api(G.GameScenes, 'enabled', 'setEnabled')],
      ['gcc-bridge', A.api(G.VexGccBridge, 'enabled', 'setEnabled')],
      ['game-loadouts', A.api(G.GameLoadouts, 'enabled', 'setEnabled')],
      ['intent-gate', A.api(G.IntentGate, 'enabled', 'setEnabled')],
      ['break-prompts', A.api(G.BreakPrompts, 'enabled', 'setEnabled')],
      ['orders-hub', A.api(G.OrdersHub, 'enabled', 'setEnabled')],
      ['exam-calendar', A.api(G.ExamCalendar, 'enabled', 'setEnabled')],
      ['receipt-locker', A.api(G.ReceiptLocker, 'enabled', 'setEnabled')],
      // Wave 2, daily planning: new features, staged off on a profile that already existed.
      ['carry-forward', A.api(G.VexCarry, 'enabled', 'setEnabled')],
      ['snooze-syntax', A.api(G.VexWhen, 'enabled', 'setEnabled')],
      ['close-day', A.api(G.VexCloseDay, 'enabled', 'setEnabled')],
      ['day-shape', A.api(G.VexDayShape, 'enabled', 'setEnabled')],
      ['refind', A.api(G.VexRefind, 'enabled', 'setEnabled')],
      ['tab-intent', A.api(G.VexTabIntent, 'enabled', 'setEnabled')],
      ['workspace-changes', A.api(G.VexChanged, 'enabled', 'setEnabled')],
      ['focus-calibration', A.api(G.VexFocusCal, 'enabled', 'setEnabled')],
      ['chores', A.api(G.VexChores, 'enabled', 'setEnabled')],
      ['week-skeleton', A.api(G.VexWeekSkeleton, 'enabled', 'setEnabled')],
      ['weekly-triage', A.api(G.VexTriage, 'enabled', 'setEnabled')],
      // Wave 3, safer browsing (js/security-helpers.js). Off, each leaves what it kept where it is.
      ['cookie-reject', A.api(G.ConsentBlock, 'enabled', 'setEnabled')],
      ['marketplace-signs', A.api(G.VexMarketplaceSigns, 'enabled', 'setEnabled')],
      ['chat-new-domain', A.api(G.VexChatFlag, 'enabled', 'setEnabled')],
      ['chat-throwaway', A.api(G.VexChatThrowaway, 'enabled', 'setEnabled')],
      ['qr-verdict', A.api(G.VexQrVerdict, 'enabled', 'setEnabled')],
      ['defender-shortcut', A.api(G.VexDefenderShortcut, 'enabled', 'setEnabled')],
      ['motw-check', A.api(G.VexMotwCheck, 'enabled', 'setEnabled')],
      ['screen-share-safe', A.api(G.VexScreenShareSafe, 'enabled', 'setEnabled')],
      ['vault-hygiene', A.api(G.VexVaultHygiene, 'enabled', 'setEnabled')],
      // Wave 3 security helpers: opt-in. Off, each keeps what it stored; the lock record itself is never touched.
      ['guest-session', A.api(G.VexGuest, 'enabled', 'setEnabled')],
      ['extension-diff', A.api(G.VexExtDiff, 'enabled', 'setEnabled')],
      ['clipboard-tripwire', A.api(G.VexClipboardTripwire, 'enabled', 'setEnabled')],
      ['startup-check', A.api(G.VexStartupCheck, 'enabled', 'setEnabled')],
      ['local-model-tools', A.api(G.WarmModel, 'enabled', 'setEnabled')],
      ['secure-lock', A.api(G.VexSecureLock, 'enabled', 'setEnabled')],
      ['slot-watcher', A.api(G.VexSlotWatcher, 'enabled', 'setEnabled')],
      ['photo-prep', A.api(G.VexPhotoPrep, 'enabled', 'setEnabled')],
      ['form-assist', A.api(G.VexFormAssist, 'enabled', 'setEnabled')],
      // Community and chat tools (Wave 3). Off, each leaves what it kept where it is and does nothing.
      ['tz-helper', A.api(G.VexTimezone, 'enabled', 'setEnabled')],
      ['unread-task', A.api(G.UnreadTask, 'enabled', 'setEnabled')],
      ['meeting-links', A.api(G.MeetingLinks, 'enabled', 'setEnabled')],
      ['discord-noise', A.api(G.DiscordNoise, 'enabled', 'setEnabled')],
      ['announce-composer', A.api(G.AnnounceComposer, 'enabled', 'setEnabled')],
      ['community-metrics', A.api(G.CommunityMetrics, 'enabled', 'setEnabled')],
      ['link-harvester', A.api(G.LinkHarvester, 'enabled', 'setEnabled')],
      ['discord-status', A.api(G.DiscordStatus, 'enabled', 'setEnabled')],
      ['mod-kit', A.api(G.ModKit, 'enabled', 'setEnabled')],
      ['vencord-bridge', A.api(G.VencordBridge, 'enabled', 'setEnabled')],
      // Wave 3, games and media: new features, staged off on a profile that already existed. Off, each keeps what it saved.
      ['patch-digest', A.api(G.VexPatchDigest, 'enabled', 'setEnabled')],
      ['service-check', A.api(G.VexServiceCheck, 'enabled', 'setEnabled')],
      ['panel-guard', A.api(G.VexPanelGuard, 'enabled', 'setEnabled')],
      ['net-courtesy', A.api(G.VexNetCourtesy, 'enabled', 'setEnabled')],
      ['video-later', A.api(G.VideoLater, 'enabled', 'setEnabled')],
      ['game-timers', A.api(G.VexGameTimers, 'enabled', 'setEnabled')],
      ['content-board', A.api(G.VexContentBoard, 'enabled', 'setEnabled')],
      ['drops-desk', A.api(G.VexDropsDesk, 'enabled', 'setEnabled')],
      ['writing-desk', A.api(G.VexWritingDesk, 'enabled', 'setEnabled')],
      ['push-bundle', A.api(G.VexPushBundle, 'enabled', 'setEnabled')],
      // Study helpers (Wave 3, js/study-extras.js)
      ['study-glossary', A.api(G.VexStudyGlossary, 'enabled', 'setEnabled')],
      ['study-ledger', A.api(G.VexStudyLedger, 'enabled', 'setEnabled')],
      ['cheat-sheet', A.api(G.VexCheatSheet, 'enabled', 'setEnabled')],
      ['draft-check', A.api(G.VexDraftCheck, 'enabled', 'setEnabled')],
      ['syllabus-check', A.api(G.VexSyllabusCheck, 'enabled', 'setEnabled')],
      ['source-badge', A.api(G.VexSourceBadge, 'enabled', 'setEnabled')],
      ['mun-toolkit', A.api(G.VexMunToolkit, 'enabled', 'setEnabled')],
      ['speech-timer', A.api(G.VexSpeechTimer, 'enabled', 'setEnabled')],
      ['turkish-helpers', A.api(G.VexTurkishHelpers, 'enabled', 'setEnabled')],
      ['version-review', A.api(G.VersionReview, 'enabled', 'setEnabled')],
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
  // `only` (a list of ids) registers just those: a module loaded after start-up (VexLazy.afterIdle) joins late.
  register(U, only) {
    const usage = U || (typeof VexUsage !== 'undefined' ? VexUsage : null);
    if (!usage || typeof usage.register !== 'function') throw new Error('The usage record is not loaded');
    const done = [];
    const manifests = typeof VexRegistry !== 'undefined' ? VexRegistry : null;
    if (!manifests) throw new Error('The feature manifests are not loaded (js/feature-registry.js)');
    for (const [id, make] of this.table()) {
      if (only && !only.includes(id)) continue;
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
