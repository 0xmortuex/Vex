// === Vex extension catalogue =============================================
// Extensions worth installing in Vex, and the honest reason for each.
//
// Vex runs on Electron, whose extension support is partial: there is no
// request blocking (neither declarativeNetRequest nor a blocking webRequest),
// no context menus, no keyboard commands and no badges, and extensions never
// load in Private or Tor tabs (Electron refuses temporary sessions).
// chrome.storage.sync, tabs.create/remove and chrome.permissions work through
// Vex's stand-ins (src/preload-webview.js, src/preload-extension-sw.js). Every
// entry here was chosen against that list: `works` describes what actually
// happens, not what the extension claims. See src/main/extensions.js for the
// installer.
//
// `source` points at the publisher's own release page; Install fetches that
// release (src/main/extension-sources.js). Any other extension can be
// installed from the Chrome Web Store: Vex downloads its package from Google's
// own update server, as Chrome, Brave and Vivaldi do, and installs it only when
// its CRX3 signatures check out (src/main/webstore.js, js/web-store.js).
// `limited` is true when Electron can only partly run it, so the manager can
// mark that line without parsing the prose.
const VexExtensionCatalog = {
  ENTRIES: [
    {
      id: 'rosuite',
      limited: false,
      name: 'RoSuite',
      what: 'Roblox, improved: a server browser (busiest or emptiest first, filters, join a server), live game stats, profile value and activity, and a trade calculator.',
      works: 'Fully. Content scripts and Roblox’s public APIs, with your existing Roblox sign-in. Runs in tabs and in the Roblox panel.',
      caveat: 'Trades and friends-in-server need you signed in to Roblox. Made for Vex, open source.',
      source: 'https://github.com/0xmortuex/RoSuite',
    },
    {
      id: 'github-pulse',
      limited: false,
      name: 'GitHub Pulse',
      what: 'A bar at the top of every GitHub repository: its latest workflow runs, deployment and release, and when its Cloudflare Worker was last deployed.',
      works: 'Fully. A content script and GitHub’s public API.',
      caveat: 'The Cloudflare part is optional and needs a read-only API token in its options. Made for Vex, open source.',
      source: 'https://github.com/0xmortuex/GitHub-Pulse',
    },
    {
      id: 'devforum-plus',
      limited: false,
      name: 'DevForum+',
      what: 'The Roblox Developer Forum for developers: API names in code link to their docs, a docs search on Alt+D, and a Copy button on code.',
      works: 'Fully. A content script and a weekly list of API names.',
      caveat: 'Made for Vex, open source.',
      source: 'https://github.com/0xmortuex/DevForum-Plus',
    },
    {
      id: 'chatkeep',
      limited: false,
      name: 'ChatKeep',
      what: 'Export a ChatGPT, Claude or Gemini conversation as Markdown, and keep one prompt library for all three.',
      works: 'Fully, in tabs. A content script; it sends nothing anywhere.',
      caveat: 'The chat sites change their pages often, so an export can come out empty until ChatKeep is updated. Made for Vex, open source.',
      source: 'https://github.com/0xmortuex/ChatKeep',
    },
    {
      id: 'cineverse-plus',
      limited: false,
      name: 'Cineverse+',
      what: 'Paribu Cineverse with IMDb ratings on every film, and the soonest showings at the cinemas nearest you.',
      works: 'Fully. Your location comes from Settings › Location.',
      caveat: 'IMDb ratings need a free OMDb key, pasted once in its options. Made for Vex, open source.',
      source: 'https://github.com/0xmortuex/Cineverse-Plus',
    },
    {
      id: 'dark-reader',
      limited: false,
      name: 'Dark Reader',
      what: 'Dark mode for every site, with per-site settings.',
      works: 'Fully. It is a content script with local storage, which is the part Electron supports best.',
      caveat: 'Its settings stay on this machine — extension sync is not available here.',
      source: 'https://github.com/darkreader/darkreader/releases',
    },
    {
      id: 'stylus',
      limited: false,
      name: 'Stylus',
      what: 'Your own CSS on any site, or styles from userstyles.world.',
      works: 'Fully — styles are injected as content scripts.',
      caveat: 'Cloud sync of your styles will not work; export a backup instead.',
      source: 'https://github.com/openstyles/stylus/releases',
    },
    {
      id: 'violentmonkey',
      limited: true,
      name: 'Violentmonkey',
      what: 'Userscripts — small scripts that change how a site behaves.',
      // Its service worker stops at chrome.windows while starting, and it runs
      // scripts through chrome.userScripts; Electron has neither, so no script
      // runs (found 2026-09-29, when "Scripts run" was shown here).
      works: 'Does not work in Vex yet: it installs, but no script runs.',
      caveat: 'It needs Chrome’s userScripts and windows extension APIs, which Electron does not have.',
      source: 'https://github.com/violentmonkey/violentmonkey/releases',
    },
    {
      id: 'return-youtube-dislike',
      limited: false,
      name: 'Return YouTube Dislike',
      what: 'Puts the dislike count back on YouTube.',
      works: 'Fully — a content script plus a network fetch, both supported.',
      caveat: null,
      source: 'https://github.com/Anarios/return-youtube-dislike/releases',
    },
    {
      id: 'ublock-origin',
      limited: true,
      name: 'uBlock Origin',
      what: 'The best-known content blocker.',
      works: 'It installs and its background page runs, but it CANNOT block requests here: Electron gives extensions no blocking API. At best it hides some page elements.',
      caveat: 'Use Vex\u2019s own blocker for actual blocking — it works at the network layer and is on by default.',
      source: 'https://github.com/gorhill/uBlock/releases',
    },
  ],

  // What Electron simply does not give an extension, so the manager can say so
  // rather than leaving someone guessing why their extension is quiet.
  UNSUPPORTED: [
    'Blocking requests (declarativeNetRequest, blocking webRequest) — ad blockers cannot block',
    'Changing the toolbar icon or popup from code (action.setIcon, setPopup) and global shortcuts that work outside Vex',
    'Syncing settings between machines (storage.sync works, but stays on this machine)',
    'Reading or changing cookies (cookies)',
    'Navigation events (webNavigation)',
    'User scripts (userScripts) and side panels (sidePanel)',
    'Any extension in Private, Off-the-Record or Tor tabs',
  ],

  get(id) { return this.ENTRIES.find(e => e.id === id) || null; },
};

if (typeof window !== 'undefined') window.VexExtensionCatalog = VexExtensionCatalog;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtensionCatalog };
