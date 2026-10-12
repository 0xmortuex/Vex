// Audit B10 (2026-10-10): a burner identity ("Chrome 146") or a Tor tab
// ("Chrome 124") sent that version in its User-Agent and Sec-CH-UA headers,
// but navigator.userAgentData in the page said the real Chromium (148). The
// client-hints shim in preload-webview.js now takes the version from the
// page's own User-Agent whenever its major differs.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const BLOCK = SRC.slice(SRC.indexOf('// === Client-Hints consistency shim (main world) ==='), SRC.indexOf('// === Real-Chrome window.chrome shim (main world) ==='));

// A stand-in for Chromium 148's navigator.userAgentData, with a page whose
// User-Agent is `ua`. The shim is run the way the preload runs it.
function pageWith(ua) {
  class NavigatorUAData {}
  Object.defineProperty(NavigatorUAData.prototype, 'brands', {
    configurable: true, enumerable: true,
    get() { return [{ brand: 'Chromium', version: '148' }, { brand: 'Not/A)Brand', version: '24' }]; },
  });
  NavigatorUAData.prototype.getHighEntropyValues = function () {
    return Promise.resolve({
      brands: this.brands,
      fullVersionList: [{ brand: 'Chromium', version: '148.0.7778.97' }, { brand: 'Not/A)Brand', version: '24.0.0.0' }],
      uaFullVersion: '148.0.7778.97',
      platform: 'Windows',
    });
  };
  const uad = new NavigatorUAData();
  const navigator = { userAgent: ua, get userAgentData() { return uad; } };
  const runInMainWorld = (src) => new Function('navigator', src)(navigator);
  new Function('window', 'document', 'runInMainWorld', BLOCK)({ location: { protocol: 'https:' } }, { documentElement: {} }, runInMainWorld);
  return navigator;
}
const UA = (v) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;
const version = (list, brand) => (list.find(b => b.brand === brand) || {}).version;

describe('navigator.userAgentData agrees with the User-Agent', () => {
  it('a "Chrome 146" identity says 146 in JS too, Chromium and Google Chrome alike', async () => {
    const nav = pageWith(UA(146));
    expect(version(nav.userAgentData.brands, 'Chromium')).toBe('146');
    expect(version(nav.userAgentData.brands, 'Google Chrome')).toBe('146');
    const hev = await nav.userAgentData.getHighEntropyValues(['fullVersionList', 'uaFullVersion']);
    expect(version(hev.fullVersionList, 'Chromium')).toBe('146.0.0.0');
    expect(version(hev.fullVersionList, 'Google Chrome')).toBe('146.0.0.0');
    expect(hev.uaFullVersion).toBe('146.0.0.0');
    expect(version(hev.brands, 'Google Chrome')).toBe('146');
    // The other brand is left as it was.
    expect(version(hev.fullVersionList, 'Not/A)Brand')).toBe('24.0.0.0');
  });

  it('a Tor tab ("Chrome 124") the same', async () => {
    const nav = pageWith(UA(124));
    expect(version(nav.userAgentData.brands, 'Google Chrome')).toBe('124');
    expect((await nav.userAgentData.getHighEntropyValues(['uaFullVersion'])).uaFullVersion).toBe('124.0.0.0');
  });

  it('an ordinary tab keeps the real version, full version included', async () => {
    const nav = pageWith(UA(148));
    expect(version(nav.userAgentData.brands, 'Chromium')).toBe('148');
    expect(version(nav.userAgentData.brands, 'Google Chrome')).toBe('148');
    const hev = await nav.userAgentData.getHighEntropyValues(['fullVersionList', 'uaFullVersion']);
    expect(version(hev.fullVersionList, 'Google Chrome')).toBe('148.0.7778.97');
    expect(hev.uaFullVersion).toBe('148.0.7778.97');
  });

  it('matches what main sends in the headers for that identity', () => {
    const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    const build = MAIN.slice(MAIN.indexOf('function buildIdentity(v)'), MAIN.indexOf('function buildIdentity(v)') + 700);
    expect(build).toContain('Chrome/${v}.0.0.0 Safari/537.36');
    expect(build).toContain('"Google Chrome";v="${v}.0.0.0"');
    expect(build).toContain('fullVer: `"${v}.0.0.0"`');
  });
});
