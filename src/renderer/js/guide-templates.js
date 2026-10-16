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
        'To see what is actually costing it: right-click the tab or panel → “What is this using?”, or Ctrl+K → “Running Tasks”. Every process, biggest first, with End on each — once, or kept off for an hour.',
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
        'For a site you keep: right-click its tab → "Page volume…" remembers a level per site, and Ctrl+K → "Even Out the Sound" tames the loud parts.',
      ],
      feature: 'volume',
    },
    {
      id: 'ads',
      ask: ['block ads', 'stop ads', 'too many ads', 'adblock', 'remove adverts', 'cookie banners', 'stop popups'],
      headline: 'Ads and trackers are blocked by Vex itself — no extension — and consent banners can go too.',
      steps: [
        'The Privacy panel in the sidebar shows what is being blocked; Ctrl+K → "What This Site Is Allowed" switches things for one site.',
        'Cookie banners: Settings › Browsing extras → "Auto-hide cookie consent banners".',
        'For one stubborn site: Ctrl+K → "What This Site Is Allowed" → turn off content from other sites.',
      ],
      feature: 'adblock',
    },
    {
      id: 'find-a-tab',
      ask: ['too many tabs', 'find a tab', 'lost a tab', 'losing tabs', 'keep losing tabs', 'cant find the tab', 'which tab was it', 'tab i had open', 'lost in tabs'],
      headline: 'You do not have to look through them — ask for the tab by what was on it.',
      steps: [
        'Ctrl+K and start typing: open tabs are listed first, by title and address.',
        'Closed it already? Ctrl+Shift+T reopens the last one, and again for the one before.',
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
      // No bare "agent" or "automate": one word matched any sentence holding
      // it, so "/agent book a table" or "automate the export" got this card
      // instead of the agent (found 2026-09-29).
      ask: ['do it for me', 'automate things', 'automate my tasks', 'what is the agent', 'how does the agent work', 'what can the agent do', 'can vex do things for me', 'fill this form for me', 'do this task'],
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
        'Not being followed between sites: that is on by default — the Privacy panel in the sidebar shows what it stopped.',
        'Hiding where you are: Ctrl+K → "New Tor Tab" routes that tab through Tor. Slower, and worth it only when you need it.',
      ],
      feature: 'otr',
    },
    {
      id: 'passwords',
      ask: ['save my password', 'password manager', 'where are my passwords', 'autofill login', '2fa codes', 'authenticator'],
      headline: 'Vex keeps logins in an OS-encrypted vault, fills them for you, and holds your 2FA codes too.',
      steps: [
        'Sign in once and say yes when Vex offers to keep it; after that a click in the sign-in field fills it.',
        'Settings › Passwords lists them: search, add, edit, show or copy one (Vex asks for your PIN first), or export them all.',
        'Ctrl+K › Password Health finds reused and weak passwords, and breached ones once you turn that check on there.',
        'Two-factor codes: the Authenticator panel on the sidebar — scan a QR screenshot, import Google Authenticator\'s export, or Back up every account with a passphrase.',
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
        'Between your own machines: Vex Sync, end-to-end encrypted, on a server you deploy — its address goes in Settings › Cloud, and you sign in under Settings › Vex Sync.',
        'As a file: Settings › Data → "Export All Data" writes bookmarks, notes, sessions and settings out.',
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
        'Shape: Settings › GUI Style — Chrome, Firefox, Safari, IE·XP and Netscape·98, plus Fluent, Glossy, Neobrutal and Terminal.',
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
    {
      id: 'new-features-off',
      ask: ['where are the new features', 'new features not showing', 'turn on the new features', 'why is this feature off', 'feature is switched off', 'how do i turn on a feature'],
      headline: 'Features marked New start switched off on a profile that already existed, so nothing changes under you.',
      steps: [
        'Ctrl+K → "Discover" lists every feature and says where it is switched on; "Everything Vex Can Do" is the same list with what each one is for.',
        'Most have their own Settings section, named in that entry, for example Settings › Close the day.',
        'Minimal Vex mode switches the optional ones off in one step and restores them when you leave it.',
      ],
      feature: 'library',
    },
    {
      id: 'due-today',
      ask: ['what is due', 'what is due today', 'what did i forget', 'what am i forgetting', 'what do i need to do today'],
      headline: 'One list of what is due: reminders, dated tasks in your notes, calendar events and scheduled tasks, most urgent first.',
      steps: [
        'Ctrl+K → "What is due". If it is not there, switch it on in Settings › What is due.',
        'Tasks whose day passed come back with Today, Tomorrow or Drop: Ctrl+K → "Left-overs from earlier".',
      ],
      feature: 'dueness',
    },
    {
      id: 'missed-messages',
      ask: ['what did i miss on discord', 'missed discord messages', 'missed whatsapp messages', 'what is waiting on me', 'who messaged me'],
      headline: 'Vex can keep what Discord and WhatsApp notifications said, and rank what is waiting on you.',
      steps: [
        'Ctrl+K → "Needs me" ranks unread panels, kept notifications and your Inbox, with the reason for each.',
        'Ctrl+K → "Notifications from panels" shows what was said; it keeps the title and the first 300 characters for 7 days, and only for the sites you turn on in Settings › Panels and messages.',
      ],
      feature: 'needs-me',
    },
    {
      id: 'find-seen-page',
      ask: ['a page i saw last week', 'find something i saw', 'i saw it somewhere', 'where did i see this', 'find a page from last week'],
      headline: 'Find it by when you saw it and what it was about, across history, page text, notes, read later and clips.',
      steps: [
        'In Ctrl+K type h: then what you are after and when, for example h: cookies in the last 2 hours. Ctrl+K → "Find by time and topic" opens the same search.',
        'For pages you read and cannot name, Ctrl+K → "Recall" searches their text.',
      ],
      feature: 'refind',
    },
    {
      id: 'build-failed',
      ask: ['my build failed', 'ci failed', 'github actions failed', 'why did the build fail', 'the deploy failed'],
      headline: 'Failed GitHub Actions runs of your repositories are listed in one place, with the log readable.',
      steps: [
        'Give Vex a read-only GitHub token in Settings › GitHub access, and list your repositories in Settings › Developer loop.',
        'Ctrl+K → "CI failures" lists the failed runs; a log excerpt goes to your local model only when you ask for a suggested fix.',
        'Open a raw log with Ctrl+K → "Read this page as a log": sections fold and First error jumps to the line that matters.',
      ],
      feature: 'ci-fix-loop',
    },
    {
      id: 'exam-help',
      ask: ['exam countdown', 'when is my exam', 'plan my revision', 'make a study plan', 'study for my exam'],
      headline: 'Vex keeps exam dates with countdown reminders, a revision plan, and a strict study block for the day.',
      steps: [
        'Ctrl+K → "Exams" holds the dates and a revision plan placed in your free time; reminders are created only after you confirm.',
        'Ctrl+K → "Study Block" starts a session where only the sites on your allowlist open.',
        'The night before: Ctrl+K → "Exam-Day Pack and Exam Mode".',
      ],
      feature: 'exam-planner',
    },
  ],

  // Words that say nothing about WHICH question it is. Dropping every word of
  // two letters or fewer instead turned "do it for me" into just "for", so
  // "Give me three ideas for dinner" got the agent card, and "theme", "font",
  // "sync" or "netflix" alone matched any sentence holding them (found
  // 2026-09-29).
  STOP: new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'so', 'of', 'to', 'in', 'on', 'off', 'at', 'by', 'for', 'from',
    'with', 'into', 'onto', 'about', 'up', 'out', 'as', 'than', 'then', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'am', 'do', 'does', 'did', 'doing', 'done', 'have', 'has', 'had', 'i', 'im', 'ive', 'me', 'my',
    'mine', 'myself', 'you', 'your', 'youre', 'yours', 'it', 'its', 'itself', 'this', 'that', 'these', 'those',
    'there', 'here', 'we', 'us', 'our', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what',
    'whats', 'which', 'who', 'whom', 'whose', 'how', 'why', 'when', 'where', 'can', 'could', 'would', 'should',
    'will', 'shall', 'may', 'might', 'must', 'please', 'just', 'very', 'really', 'too', 'all', 'any', 'some',
    'not', 'even', 'also', 'exactly', 'actually', 'anyway', 's', 't', 'd', 'll', 're', 've', 'm',
  ]),

  // Asking-words around a one-word subject: "change the theme" is still just
  // "theme", "explain the theme" is not.
  FILLER: new Set(['change', 'set', 'turn', 'switch', 'open', 'use', 'want', 'need', 'get', 'like', 'try']),

  // Apostrophes go before splitting, so "can't" is "cant" as in the phrases.
  _words(text) {
    return String(text || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  },

  _keys(words) { return words.filter(w => !this.STOP.has(w)); },

  // Is `part` a contiguous run inside `whole`?
  _run(whole, part) {
    if (!part.length || part.length > whole.length) return false;
    for (let i = 0; i + part.length <= whole.length; i++) {
      if (part.every((w, j) => whole[i + j] === w)) return true;
    }
    return false;
  },

  // Loose where it is safe, strict where it is not. People type "its using
  // all my ram", so the stop words between the words that matter are ignored,
  // but those words must come together as the phrase does. A phrase that
  // comes down to one word ("theme", "sync") — or to none ("do it for me") —
  // only answers when that is the whole question, so it never fires because
  // a common word happened to be in an ordinary sentence.
  match(question) {
    const words = this._words(question);
    if (!words.length) return null;
    const keys = this._keys(words);
    const subject = keys.filter(w => !this.FILLER.has(w));
    let best = null;
    for (const item of this.ITEMS) {
      for (const phrase of item.ask) {
        const pWords = this._words(phrase);
        const pKeys = this._keys(pWords);
        let fits;
        if (pKeys.length >= 2) fits = this._run(keys, pKeys);
        else if (pKeys.length === 1) fits = subject.length === 1 && subject[0] === pKeys[0];
        else fits = !subject.length && this._run(words, pWords);
        if (!fits) continue;
        // The longest phrase that fits wins: "two accounts" beats "accounts".
        const score = pKeys.length * 100 + pWords.length;
        if (!best || score > best.score) best = { item, score };
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
