// === Extensions Vex installs in one click ===================================
//
// The catalogue (js/extension-catalog.js) used to say "open the source,
// download the .zip, then Settings → Extensions → Install": three steps and a
// file dialog for something Vex could do itself. These are the extensions it
// may now fetch on the user's behalf, and the only ones. The renderer names
// an id; the repository and the file to take are decided here, so a page can
// never make Vex download from an address of its choosing.
//
// Each comes from its publisher's own GitHub releases (the latest one), as the
// Chrome build. Never the Chrome Web Store: its packages are not offered for
// download and scraping them is neither reliable nor permitted.

const SOURCES = {
  // First-party.
  rosuite:                  { repo: '0xmortuex/RoSuite',              asset: /^RoSuite-.*\.zip$/i },
  'github-pulse':           { repo: '0xmortuex/GitHub-Pulse',         asset: /^GitHub-Pulse-.*\.zip$/i },
  'devforum-plus':          { repo: '0xmortuex/DevForum-Plus',        asset: /^DevForum-Plus-.*\.zip$/i },
  chatkeep:                 { repo: '0xmortuex/ChatKeep',             asset: /^ChatKeep-.*\.zip$/i },
  'cineverse-plus':         { repo: '0xmortuex/Cineverse-Plus',       asset: /^Cineverse-Plus-.*\.zip$/i },
  // The catalogue's recommendations.
  'dark-reader':            { repo: 'darkreader/darkreader',          asset: /^darkreader-chrome\.zip$/i },
  stylus:                   { repo: 'openstyles/stylus',              asset: /^stylus-chrome-mv3-.*\.zip$/i },
  violentmonkey:            { repo: 'violentmonkey/violentmonkey',    asset: /^Violentmonkey-mv3-.*\.zip$/i },
  'return-youtube-dislike': { repo: 'Anarios/return-youtube-dislike', asset: /^return-youtube-dislike-chrome-.*\.zip$/i },
  'ublock-origin':          { repo: 'gorhill/uBlock',                 asset: /^uBlock0_.*\.chromium\.zip$/i },
};

// The release file to take: the one the pattern names, downloaded from
// GitHub itself (a release asset's browser_download_url), nothing else.
function pickAsset(release, pattern) {
  const assets = (release && Array.isArray(release.assets)) ? release.assets : [];
  return assets.find(a => a && typeof a.name === 'string' && pattern.test(a.name)
    && /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(String(a.browser_download_url || ''))) || null;
}

function latestReleaseUrl(id) {
  const src = SOURCES[id];
  if (!src) throw new Error('Vex does not install "' + id + '" by itself');
  return 'https://api.github.com/repos/' + src.repo + '/releases/latest';
}

module.exports = { SOURCES, pickAsset, latestReleaseUrl };
