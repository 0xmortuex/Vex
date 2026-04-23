// === Gmail webview preload ===
// Runs inside the persist:gmail webview BEFORE any page script. Monkey-patches
// navigator.userAgentData so client-side Client Hints fingerprinting sees
// Chrome 124 instead of Electron. Paired with the request-header override and
// setUserAgent() in src/main.js to make the whole UA story consistent.
//
// Chrome 124 matches Electron 30's actual Chromium version — Google's bot
// detection flags version mismatches between UA string and rendering engine.

const brands = [
  { brand: 'Google Chrome', version: '124' },
  { brand: 'Chromium', version: '124' },
  { brand: 'Not_A Brand', version: '24' },
];

const fullBrands = [
  { brand: 'Google Chrome', version: '124.0.6367.207' },
  { brand: 'Chromium', version: '124.0.6367.207' },
  { brand: 'Not_A Brand', version: '24.0.0.0' },
];

const fakeUAData = {
  brands,
  mobile: false,
  platform: 'Windows',
  toJSON() {
    return { brands: this.brands, mobile: this.mobile, platform: this.platform };
  },
  getHighEntropyValues(hints) {
    const result = {
      brands,
      mobile: false,
      platform: 'Windows',
    };
    if (hints.includes('architecture')) result.architecture = 'x86';
    if (hints.includes('bitness')) result.bitness = '64';
    if (hints.includes('model')) result.model = '';
    if (hints.includes('platformVersion')) result.platformVersion = '15.0.0';
    if (hints.includes('uaFullVersion')) result.uaFullVersion = '124.0.6367.207';
    if (hints.includes('fullVersionList')) result.fullVersionList = fullBrands;
    if (hints.includes('wow64')) result.wow64 = false;
    return Promise.resolve(result);
  },
};

try {
  Object.defineProperty(navigator, 'userAgentData', {
    value: fakeUAData,
    writable: false,
    configurable: false,
  });
} catch (err) {
  try { navigator.userAgentData = fakeUAData; } catch {}
}
