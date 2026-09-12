// === Vex extension catalogue =============================================
// Extensions worth installing in Vex, and the honest reason for each.
//
// Vex runs on Electron, whose extension support is partial: there is no
// request blocking (neither declarativeNetRequest nor a blocking webRequest),
// no context menus, no keyboard commands, no badges, no chrome.storage.sync
// and no chrome.tabs.create, and extensions never load in Private or Tor tabs
// (Electron refuses temporary sessions). Every entry here was chosen against
// that list: `works` describes what actually happens, not what the extension
// claims. See src/main/extensions.js for the installer.
//
// `source` points at the publisher's own release page. Vex does not download
// from the Chrome Web Store: its packages are not offered for direct download
// and scraping them would be neither reliable nor permitted. Installing is
// therefore: open the source, download the .zip/.crx, then Settings →
// Extensions → Install. `limited` is true when Electron can only partly run
// it, so the manager can mark that line without parsing the prose.
const VexExtensionCatalog = {
  ENTRIES: [
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
      works: 'Scripts run. Most scripts that only touch the page work as written.',
      caveat: 'A script whose @grant asks for downloads, notifications or context menus fails, because Electron has none of those.',
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
    'Right-click menu items (contextMenus)',
    'Keyboard shortcuts (commands)',
    'Toolbar badge text',
    'Settings sync between machines (storage.sync)',
    'Opening tabs from an extension (tabs.create)',
    'Any extension in Private, Off-the-Record or Tor tabs',
  ],

  get(id) { return this.ENTRIES.find(e => e.id === id) || null; },
};

if (typeof window !== 'undefined') window.VexExtensionCatalog = VexExtensionCatalog;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtensionCatalog };
