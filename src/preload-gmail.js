// === Gmail webview preload ===
// Runs inside the persist:gmail webview BEFORE any page script. Monkey-patches
// navigator.userAgentData so client-side Client Hints fingerprinting sees
// Chrome 131 instead of Electron. Paired with the request-header override and
// setUserAgent() in src/main.js to make the whole UA story consistent.

const brands = [
  { brand: 'Chromium', version: '131' },
  { brand: 'Google Chrome', version: '131' },
  { brand: 'Not(A:Brand', version: '24' },
];

const fullBrands = [
  { brand: 'Chromium', version: '131.0.6778.86' },
  { brand: 'Google Chrome', version: '131.0.6778.86' },
  { brand: 'Not(A:Brand', version: '24.0.0.0' },
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
    if (hints.includes('uaFullVersion')) result.uaFullVersion = '131.0.6778.86';
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
