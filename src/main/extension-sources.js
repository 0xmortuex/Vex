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

// Nothing here is pinned to a release the way a Web Store package is signed
// (security scan M6): what the publisher's latest release holds is what is
// installed. What Vex can check is that the file it downloaded is the one
// GitHub published: GitHub's API gives each release asset a "digest"
// ("sha256:<hex>"). A file that does not match is refused. An asset with no
// digest (uploaded before GitHub kept them) cannot be checked; the answer
// says so, and the manager shows it.
function assetDigest(asset) {
  const d = asset && typeof asset.digest === 'string' ? asset.digest.trim().toLowerCase() : '';
  const m = /^sha256:([0-9a-f]{64})$/.exec(d);
  return m ? m[1] : null;
}

// { checked: true, sha256 } when the bytes match GitHub's digest, or
// { checked: false } when GitHub published none; throws when they differ.
function checkAssetDigest(buffer, asset, crypto = require('crypto')) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('checkAssetDigest: expected a Buffer');
  const want = assetDigest(asset);
  const got = crypto.createHash('sha256').update(buffer).digest('hex');
  if (!want) return { checked: false, sha256: got };
  if (want !== got) throw new Error(`The downloaded file is not the one GitHub published (its SHA-256 does not match the release's digest). It may have been changed on the way. Nothing was installed.`);
  return { checked: true, sha256: got };
}

module.exports = { SOURCES, pickAsset, latestReleaseUrl, assetDigest, checkAssetDigest };
