// === What do you want to do? — the catalogue filed by intent ================================
//
// The Library's areas (Tabs & windows, Productivity, Only in Vex ...) are how Vex is BUILT; a person looking for
// "something to keep me safe" or "help me study" does not think in them. This file files every catalogue entry
// under exactly ONE of twelve intents, in the words of someone who wants a thing done. It moves no code path:
// ids, commands, panels and saved keys are untouched, and an entry is still in its area too.
//
// How an entry gets its intent (intentOf), first match wins:
//   1. OVERRIDE  - the entry's id is listed under an intent below
//   2. PREFIX    - its id starts with one of these (game-*, study-*)
//   3. CAT_DEFAULT - its area's default
// so a feature added to the catalogue later always lands somewhere (its area's default; list it under OVERRIDE
// when that is not the right home). tests/renderer/featureIntents.test.js checks every entry has one known intent.
//
// Loaded the first time the Library opens (FeatureLibrary._intentData), with js/feature-intents-tr.js (the
// Turkish names), never from index.html.
const FeatureIntents = {
  // In the order the tiles are drawn. `icon` is a VexIcons name.
  INTENTS: [
    { id: 'safe',  name: 'Browse safely',            icon: 'shield',     blurb: 'Blocking, Tor, passwords, and what each site may know about you.' },
    { id: 'tabs',  name: 'Tabs and speed',           icon: 'tabs',       blurb: 'Tabs, windows, sessions, and finding what makes Vex slow.' },
    { id: 'look',  name: 'Look, feel and fun',       icon: 'palette',    blurb: 'Themes, layout, the start page, and the playful bits.' },
    { id: 'done',  name: 'Get things done',          icon: 'clipboard',  blurb: 'Notes, to-dos, reminders, the calendar, mail and automations.' },
    { id: 'read',  name: 'Read and research',        icon: 'book-open',  blurb: 'Reading mode, translation, saving pages, sources and bookmarks.' },
    { id: 'study', name: 'Study',                    icon: 'graduation', blurb: 'Study blocks, exams, course notes and cheat sheets.' },
    { id: 'watch', name: 'Watch, listen and capture', icon: 'video',     blurb: 'Video, sound, screenshots, recording and screen sharing.' },
    { id: 'game',  name: 'Game',                     icon: 'gamepad',    blurb: 'Game mode, guides, patch news, and keeping Vex out of the way.' },
    { id: 'ai',    name: 'Ask AI',                   icon: 'sparkles',   blurb: 'The assistant, the agent, and which model answers.' },
    { id: 'chat',  name: 'Chat and apps',            icon: 'message',    blurb: 'Discord, WhatsApp, Spotify and other sidebar apps, and their notifications.' },
    { id: 'build', name: 'Build and tools',          icon: 'toolbox',    blurb: 'Developer tools, the Toolbox of small tools, and checks for a page you build.' },
    { id: 'data',  name: 'My data, sync and help',   icon: 'database',   blurb: 'Sync, backup, export, updates, and help with Vex itself.' },
  ],

  // Simple mode (and a new profile) opens on these six; "More areas" shows the rest. The ids must be in INTENTS.
  SIMPLE: ['safe', 'tabs', 'look', 'done', 'read', 'ai'],

  // An area's default intent (VexFeatures.CATS ids).
  CAT_DEFAULT: {
    tabs: 'tabs', ai: 'ai', privacy: 'safe', reading: 'read', work: 'done', media: 'watch',
    panels: 'chat', logins: 'safe', look: 'look', dev: 'build', data: 'data', unique: 'look',
  },

  PREFIX: [['game-', 'game'], ['study-', 'study'], ['panel-', 'chat']],

  // intent -> the ids that do NOT follow their area's default. One id appears under one intent only.
  OVERRIDE: {
    safe: ['burner', 'leakcanary', 'panel-authenticator'],
    tabs: ['resmon', 'preconnect', 'linkedscroll', 'plan-preview', 'close-protect'],
    done: ['remind-site', 'attention-inbox', 'attention-budget', 'turkish-parse', 'tz-helper', 'brief-cards', 'needs-me'],
    read: ['library', 'bookmarks', 'history', 'feeds', 'ai-news', 'smart-bookmarks', 'wayback', 'queue', 'sources', 'citations',
      'archive-on-cite', 'refind', 'search-again', 'locale-translate'],
    study: ['cards', 'exam-planner', 'exam-safe-mode', 'exam-calendar', 'paper-session', 'course-spaces', 'mun-dossier', 'mun-toolkit',
      'speech-timer', 'turkish-helpers', 'cheat-sheet', 'syllabus-check', 'draft-check', 'announce-desk'],
    game: ['latency', 'freegames', 'commit-guard', 'second-screen', 'gcc-bridge', 'gaming', 'patch-digest', 'service-check', 'panel-guard',
      'net-courtesy', 'drops-desk'],
    chat: ['mod-kit', 'community-metrics'],
    build: ['toolbox', 'toolbox-reference', 'toolbox-full', 'toolbox-favourites', 'tool-history', 'job-tools-offer', 'jobsetup'],
    data: ['backup', 'downloads', 'download-quicklook', 'folder-browser', 'sendphone', 'feature-registry', 'feature-sheet',
      'progressive-disclosure', 'intent-search', 'usage-counters', 'capability-dial', 'first-use-sheet', 'whats-new-me', 'setup-again'],
  },

  _index: null,

  _build() {
    const idx = new Map();
    for (const [intent, ids] of Object.entries(this.OVERRIDE)) {
      for (const id of ids) {
        if (idx.has(id)) throw new Error('[FeatureIntents] ' + id + ' is filed under two intents');
        idx.set(id, intent);
      }
    }
    return idx;
  },

  // The one intent of a catalogue entry (or of an old/alias id). Throws on something that is not in the catalogue.
  intentOf(itemOrId) {
    const item = (typeof itemOrId === 'string') ? VexFeatures.get(itemOrId) : itemOrId;
    if (!item) throw new Error('[FeatureIntents] no such feature: ' + itemOrId);
    if (!this._index) this._index = this._build();
    const direct = this._index.get(item.id);
    if (direct) return direct;
    const pre = this.PREFIX.find(p => item.id.startsWith(p[0]));
    if (pre) return pre[1];
    const def = this.CAT_DEFAULT[item.cat];
    if (!def) throw new Error('[FeatureIntents] area "' + item.cat + '" has no default intent (feature ' + item.id + ')');
    return def;
  },

  get(id) { return this.INTENTS.find(i => i.id === id) || null; },

  // The catalogue entries of one intent, in catalogue order.
  byIntent(id) { return VexFeatures.ITEMS.filter(f => this.intentOf(f) === id); },

  // The intents to draw as tiles: six in Simple mode (all twelve with `all`), else twelve. Each carries its count and a
  // few names to show what is inside.
  tiles({ simple = false, all = false } = {}) {
    const wanted = (simple && !all) ? this.INTENTS.filter(i => this.SIMPLE.includes(i.id)) : this.INTENTS;
    return wanted.map((i) => {
      const items = this.byIntent(i.id);
      return {
        ...i,
        count: items.length,
        sample: items.filter(f => !f.newer).slice(0, 3).map(f => VexFeatures.nameOf(f)),
      };
    });
  },
};

if (typeof window !== 'undefined') window.FeatureIntents = FeatureIntents;
if (typeof module !== 'undefined' && module.exports) module.exports = { FeatureIntents };
