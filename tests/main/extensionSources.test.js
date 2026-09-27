import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SOURCES, pickAsset, latestReleaseUrl } = require('../../src/main/extension-sources.js');
const { VexExtensionCatalog } = require('../../src/renderer/js/extension-catalog.js');

// One-click install (2026-09-27): Vex fetches the latest GitHub release of an
// extension it knows. The asset names below are the real ones from those
// releases on the day this was written.
const asset = (name, repo) => ({ name, browser_download_url: `https://github.com/${repo}/releases/download/v1/${name}` });
const REAL = {
  'dark-reader': ['darkreader/darkreader', ['CHANGELOG.md', 'darkreader-chrome-mv3.zip', 'darkreader-chrome.zip', 'darkreader-firefox.xpi'], 'darkreader-chrome.zip'],
  stylus: ['openstyles/stylus', ['stylus-chrome-mv3-v2.4.14-id.zip', 'stylus-firefox-v2.4.14.zip', 'stylus-mv2-v2.4.14-id.zip'], 'stylus-chrome-mv3-v2.4.14-id.zip'],
  violentmonkey: ['violentmonkey/violentmonkey', ['Violentmonkey-mv2-v2.49.0.crx', 'Violentmonkey-mv3-v2.49.0.zip', 'Violentmonkey-webext-v2.49.0.zip'], 'Violentmonkey-mv3-v2.49.0.zip'],
  'return-youtube-dislike': ['Anarios/return-youtube-dislike', ['GITHUB_SHA256SUMS.txt', 'return-youtube-dislike-chrome-4.0.6.zip', 'return-youtube-dislike-firefox-4.0.6.zip', 'return-youtube-dislike-source-4.0.6.zip'], 'return-youtube-dislike-chrome-4.0.6.zip'],
  'ublock-origin': ['gorhill/uBlock', ['uBlock0_1.75.0.chromium.crx', 'uBlock0_1.75.0.chromium.zip', 'uBlock0_1.75.0.firefox.signed.xpi'], 'uBlock0_1.75.0.chromium.zip'],
  rosuite: ['0xmortuex/RoSuite', ['RoSuite-1.1.0.zip'], 'RoSuite-1.1.0.zip'],
};

describe('the extensions Vex installs in one click', () => {
  it('takes the Chrome build from each real release', () => {
    for (const [id, [repo, names, want]] of Object.entries(REAL)) {
      const got = pickAsset({ assets: names.map(n => asset(n, repo)) }, SOURCES[id].asset);
      expect(got && got.name, id).toBe(want);
    }
  });

  it('only from GitHub release downloads, never another address', () => {
    const evil = { assets: [{ name: 'darkreader-chrome.zip', browser_download_url: 'https://evil.example/darkreader-chrome.zip' }] };
    expect(pickAsset(evil, SOURCES['dark-reader'].asset)).toBeNull();
  });

  it('refuses an extension it does not know', () => {
    expect(() => latestReleaseUrl('something-else')).toThrow(/does not install/);
    expect(latestReleaseUrl('rosuite')).toBe('https://api.github.com/repos/0xmortuex/RoSuite/releases/latest');
  });

  it('every catalogue entry can be installed in one click', () => {
    for (const e of VexExtensionCatalog.ENTRIES) expect(SOURCES[e.id], e.id).toBeTruthy();
  });
});
