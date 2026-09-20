// === Questions people actually ask, answered before they finish typing =====
//
// The guide (js/vex-guide.js) answers "how do I…" by matching your words
// against the feature list, which is good at "translate this page" and bad at
// the things people really say: "it's using all my RAM", "make it stop", "I
// want two accounts at once", "what can you even do?".
//
// These are those questions, written down with the answer, so the common ones
// are never a guess. Each template says:
//   ask       the phrasings that mean it (matched loosely, any one is enough)
//   headline  the answer, in a sentence
//   steps     what to do, in order
//   feature   the catalogue entry to offer as "do it for me", when there is one
//
// A template beats the search when it matches: it is a person's answer rather
// than a feature description. Everything else still falls through to the
// feature list, so nothing is lost by them being here.
const GuideTemplates = {
  ITEMS: [
    {
      id: 'what-can-vex-do',
      ask: ['what can you do', 'what can vex do', 'what are your features', 'show me everything', 'what is vex', 'what can i do here', 'everything vex can do', 'list your features'],
      headline: 'More than fits in one answer — so here is the map, and the way to ask about any of it.',
      steps: [
        'Vex has its own AI (ask or set it working), tabs that group, sleep and come back, a sidebar of apps, reading and privacy tools, a password vault and 2FA codes, notes, sessions and schedules, and a pile of small things like a dictionary on double-click.',
        'To see them one at a time, with a button to try each: Ctrl+K → "Discover".',
        'To find one thing: press Ctrl+K and say what you want in your own words — "stop videos playing by themselves", "I want two accounts on one site".',
      ],
      feature: 'ai-panel',
    },
    {
      id: 'memory',
      ask: ['using all my ram', 'too much memory', 'vex is slow', 'browser is slow', 'slow down my pc', 'eating my ram', 'high memory', 'free up memory', 'laggy'],
      headline: 'Vex can hand memory back without closing anything you are reading.',
      steps: [
        'Ctrl+K → "Free memory now" puts idle tabs to sleep at once; they come back where you left them when you click them.',
        'Ctrl+Shift+M opens Memory, which shows what each tab is actually costing.',
        'Ctrl+K → "Set the Memory Ceiling from This Machine" so tabs start sleeping at a figure that suits your machine rather than a fixed one.',
      ],
      feature: 'memory-panel',
    },
    {
      id: 'two-accounts',
      ask: ['two accounts', 'second account', 'log into two', 'two logins', 'same site twice', 'work and personal account', 'multiple accounts'],
      headline: 'Container tabs: a tab with its own cookie jar, so two accounts on one site at the same time.',
      steps: [
        'Ctrl+K → "New Work Container Tab" (or Personal, or Shopping).',
        'Sign in there as the other account — your first account stays signed in everywhere else.',
        'The tab is marked with the container’s colour, and it stays in that container when you open links from it.',
      ],
      feature: 'containers',
    },
    {
      id: 'autoplay',
      ask: ['stop autoplay', 'videos play by themselves', 'stop videos playing', 'mute everything', 'sound starts on its own', 'stop sound'],
      headline: 'Sound is per-site in Vex, and a tab that starts talking can be silenced from the tab strip.',
      steps: [
        'Right-click the tab → Mute, or Ctrl+M for the one you are on.',
        'Ctrl+K → "What This Site Is Allowed" turns off a site’s JavaScript entirely, which stops the player as well.',
        'For a site you keep: Ctrl+K → "Site Volume" remembers a level per site, and "Even Out the Sound" tames the loud parts.',
      ],
      feature: 'volume',
    },
    {
      id: 'ads',
      ask: ['block ads', 'stop ads', 'too many ads', 'adblock', 'remove adverts', 'cookie banners', 'stop popups'],
      headline: 'Ads and trackers are blocked by Vex itself — no extension — and consent banners can go too.',
      steps: [
        'Settings › Privacy shows what is being blocked and lets you switch it off for one site.',
        'Cookie banners: Settings › Privacy → "Hide cookie banners".',
        'For one stubborn site: Ctrl+K → "What This Site Is Allowed" → turn off content from other sites.',
      ],
      feature: 'adblock',
    },
    {
      id: 'find-a-tab',
      ask: ['too many tabs', 'find a tab', 'lost a tab', 'cant find the tab', 'which tab was it', 'tab i had open'],
      headline: 'You do not have to look through them — ask for the tab by what was on it.',
      steps: [
        'Ctrl+K and start typing: open tabs are listed first, by title and address.',
        'Closed it already? Ctrl+Shift+T reopens the last one; Ctrl+K → "Recently closed" lists more.',
        'Read it before and cannot name it? Ctrl+K → "Recall" searches the text of pages you have read.',
      ],
      feature: 'recall',
    },
    {
      id: 'save-for-later',
      ask: ['save this page', 'read later', 'keep this page', 'save for later', 'bookmark this', 'offline copy'],
      headline: 'Three different "save", depending on what you want back.',
      steps: [
        'Coming back to it soon: Ctrl+D bookmarks it; Ctrl+K → "Read later" queues it with how long it takes to read.',
        'Keeping the page itself: Ctrl+K → "Save page" writes a PDF, a single file, or an EPUB you can read anywhere.',
        'Keeping a piece of it: select the text and use Ctrl+K → "Clip to notes", or highlight it and make cards from it later.',
      ],
      feature: 'library',
    },
    {
      id: 'ai-setup',
      ask: ['set up the ai', 'ai not working', 'make the ai work', 'connect ai', 'use ollama', 'local ai', 'ai backend'],
      headline: 'Vex talks to three kinds of AI, and you pick: a cloud model, Ollama on this machine, or a small one inside Vex.',
      steps: [
        'Settings › AI is where all three live, with a test button for each.',
        'Ollama is the private one: install it, and Vex finds it — Settings › AI shows which models you have.',
        'Give the routine work a small model (Ctrl+K → "Small Model for Routine Jobs") and keep the big one for chat and the agent.',
      ],
      feature: 'ai-router',
    },
    {
      id: 'agent',
      ask: ['do it for me', 'automate', 'agent', 'can vex do things for me', 'fill this form for me', 'do this task'],
      headline: 'The agent drives the page itself — it clicks, types and reads, asking before anything it cannot undo.',
      steps: [
        'Open the AI panel (Ctrl+Shift+A) and say the task the way you would to a person.',
        'Watch it work: Pause holds it between steps, and anything you type while it is held becomes its next instruction.',
        'Something you do often? Ctrl+K → "Teach Vex This Task" records it once and repeats it without the AI.',
      ],
      feature: 'agent',
    },
    {
      id: 'privacy',
      ask: ['am i being tracked', 'private browsing', 'hide my browsing', 'incognito', 'stop tracking', 'be anonymous'],
      headline: 'Three levels, depending on who you are hiding from.',
      steps: [
        'Leaving no trace on this machine: Ctrl+K → "New Off-the-Record Tab", or a private window.',
        'Not being followed between sites: that is on by default — Settings › Privacy shows what it stopped.',
        'Hiding where you are: Ctrl+K → "New Tor Tab" routes that tab through Tor. Slower, and worth it only when you need it.',
      ],
      feature: 'otr',
    },
    {
      id: 'passwords',
      ask: ['save my password', 'password manager', 'where are my passwords', 'autofill login', '2fa codes', 'authenticator'],
      headline: 'Vex keeps logins in an OS-encrypted vault, fills them for you, and holds your 2FA codes too.',
      steps: [
        'Sign in once and say yes when Vex offers to keep it; after that the form fills itself.',
        'Settings › Passwords lists them, checks them for reuse and breaches, and lets you edit one.',
        'Two-factor codes: the Authenticator panel on the sidebar — add an account by scanning its QR screenshot.',
      ],
      feature: 'passwords',
    },
    {
      id: 'shortcut-not-working',
      ask: ['shortcut not working', 'keyboard shortcut', 'ctrl k not working', 'keys dont work', 'change a shortcut'],
      headline: 'Every shortcut is listed, and every one of them can be changed.',
      steps: [
        'Ctrl+K → "Shortcuts" lists them by what they do, with the key beside each.',
        'Click a key to rebind it. A few are fixed because Windows or Chromium claims them first, and those say so.',
        'They all work while you are reading a page too — if one does not, tell Vex, because that is a bug and not how it is meant to be.',
      ],
      feature: 'shortcuts',
    },
    {
      id: 'backup',
      ask: ['back up my stuff', 'move to another computer', 'export my data', 'sync', 'another device', 'transfer my settings'],
      headline: 'Everything Vex keeps is yours and portable — by sync, or as a file.',
      steps: [
        'Between your own machines: Settings › Sync, end-to-end encrypted, on a server you point it at.',
        'As a file: Settings › Data → Export writes bookmarks, notes, sessions and settings out.',
        'Nothing here goes anywhere you did not set up: no account, no telemetry.',
      ],
      feature: 'sync',
    },
    {
      id: 'looks',
      ask: ['change how it looks', 'theme', 'dark mode', 'make it look like chrome', 'make it look like firefox', 'font'],
      headline: 'Two separate things: the colours (themes) and the shape of the browser (looks).',
      steps: [
        'Colours: Ctrl+K → "Theme" — dozens, including light ones, and they apply to the start page too.',
        'Shape: Settings › Boosts → Browser looks, which borrows the chrome of Chrome, Firefox, Safari, Edge, IE or Netscape.',
        'You can keep your theme colours on top of any look.',
      ],
      feature: 'guistyle',
    },
    {
      id: 'video',
      ask: ['watch video', 'picture in picture', 'video keeps stopping', 'download a video', 'netflix', 'prime video'],
      headline: 'Video in Vex: float it, keep it awake, or take it with you.',
      steps: [
        'Float it above everything: Ctrl+Shift+P, or the PiP button in the toolbar.',
        'Streaming services need their DRM: Settings › About shows whether it is working, and how to fix it if not.',
        'Saving one: Ctrl+K → "Download Media on Page" finds what is playing and offers it.',
      ],
      feature: 'pip',
    },
  ],

  // Loose matching on purpose: people type "its using all my ram", not the
  // phrasing in the list. Every word of the phrase has to be in the question
  // (in any order), which is strict enough to avoid a wrong answer and loose
  // enough to catch how people actually write.
  _words(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  },

  match(question) {
    const asked = new Set(this._words(question));
    if (!asked.size) return null;
    let best = null;
    for (const item of this.ITEMS) {
      for (const phrase of item.ask) {
        const words = this._words(phrase).filter(w => w.length > 2);
        if (!words.length || !words.every(w => asked.has(w))) continue;
        // The longest phrase that fits wins: "two accounts" beats "accounts".
        if (!best || words.length > best.score) best = { item, score: words.length };
      }
    }
    return best ? best.item : null;
  },

  // The same shape VexGuide.answer returns, so the panel renders it unchanged.
  answer(question) {
    const item = this.match(question);
    if (!item) return null;
    const entry = (typeof VexFeatures !== 'undefined' && item.feature)
      ? VexFeatures.ITEMS.find(f => f.id === item.feature) || null
      : null;
    return {
      found: true,
      template: item.id,
      entry,
      label: entry ? (entry.name || entry.id) : null,
      headline: item.headline,
      off: null,
      steps: item.steps.slice(),
      others: [],
    };
  },
};

if (typeof window !== 'undefined') window.GuideTemplates = GuideTemplates;
if (typeof module !== 'undefined' && module.exports) module.exports = { GuideTemplates };
