// @vitest-environment node
//
// Vex says it is Google Chrome in three places: the User-Agent, the Sec-CH-UA request headers
// (main.js) and navigator.userAgentData in the page (the client-hints shim in preload-webview.js).
// Found 2026-11-13: the header carried Chrome 124's filler brand ("Not-A.Brand") on every version
// while the page saw this Chromium's own ("Not/A)Brand" on 148), with "Google Chrome" last. A
// header and a page that disagree, and a list no Chrome 148 sends; Cloudflare's "Verify you are
// human" page on support.discord.com passed in Chrome and not in Vex.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { chromeBrands, secChUa, withNavigationHints, acceptLanguages } = require('../../src/main/ua-brands.js');

const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const BLOCK = PRELOAD.slice(PRELOAD.indexOf('// === Client-Hints consistency shim (main world) ==='), PRELOAD.indexOf('// === Real-Chrome window.chrome shim (main world) ==='));

describe('the brand list of a Chrome version', () => {
  // What those Chrome versions really send (their Sec-CH-UA header).
  it('is what Chrome 120, 124 and 131 send', () => {
    expect(secChUa('120')).toBe('"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"');
    expect(secChUa('124')).toBe('"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"');
    expect(secChUa('131')).toBe('"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"');
  });

  // The filler measured on this Chromium (a bare Electron 42.11.18 window, 2026-11-13): "Not/A)Brand", 99.
  it('is Chromium, Google Chrome, Not/A)Brand for 148', () => {
    expect(secChUa('148')).toBe('"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"');
    expect(secChUa('148.0.7778.280')).toBe('"Chromium";v="148.0.7778.280", "Google Chrome";v="148.0.7778.280", "Not/A)Brand";v="99.0.0.0"');
  });

  it('refuses something that is not a version', () => {
    expect(() => chromeBrands('')).toThrow(/Not a Chrome version/);
    expect(() => chromeBrands('abc')).toThrow(/Not a Chrome version/);
  });
});

describe('main.js makes its Sec-CH-UA headers from that rule', () => {
  it('for ordinary sessions and for a New Identity or Tor one', () => {
    expect(MAIN).toContain('const CH_UA = _secChUa(CHROME_MAJOR);');
    expect(MAIN).toContain('const CH_UA_FULL = _secChUa(CHROME_FULL_VERSION);');
    const build = MAIN.slice(MAIN.indexOf('function buildIdentity(v)'), MAIN.indexOf('function buildIdentity(v)') + 500);
    expect(build).toContain('ua: _secChUa(v),');
    expect(build).toContain('full: _secChUa(`${v}.0.0.0`),');
    expect(MAIN).not.toContain('Not-A.Brand');
  });
});

// Found 2026-11-14 with a local page opened in Vex and in Chrome 144 on the same PC: Chrome sends the three
// short hints with every page and frame load, Vex sent them with none.
describe('a page or frame load carries the brand hints, where Chrome puts them', () => {
  const BRANDS = secChUa('148');
  // The header names Vex sent for a page load, in order (measured).
  const nav = () => ({ 'Upgrade-Insecure-Requests': '1', 'User-Agent': 'UA', Accept: 'text/html', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-User': '?1', 'Sec-Fetch-Dest': 'document', 'Accept-Encoding': 'gzip', 'Accept-Language': 'en-US' });

  it('in front of Upgrade-Insecure-Requests, in the order Chrome 144 sent them', () => {
    const out = withNavigationHints(nav(), { resourceType: 'mainFrame', url: 'https://support.discord.com/hc/en-us/requests', brands: BRANDS });
    expect(Object.keys(out)).toEqual(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'Upgrade-Insecure-Requests', 'User-Agent', 'Accept', 'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-User', 'Sec-Fetch-Dest', 'Accept-Encoding', 'Accept-Language']);
    expect(out['sec-ch-ua']).toBe(BRANDS);
    expect(out['sec-ch-ua-mobile']).toBe('?0');
    expect(out['sec-ch-ua-platform']).toBe('"Windows"');
    expect(out['User-Agent']).toBe('UA');
  });

  it('for a frame as for a page, and for this computer over http', () => {
    for (const url of ['https://challenges.cloudflare.com/x', 'http://localhost:47831/', 'http://127.0.0.1:47831/frame', 'http://[::1]:8080/', 'http://app.localhost/']) {
      expect(withNavigationHints(nav(), { resourceType: 'subFrame', url, brands: BRANDS })['sec-ch-ua'], url).toBe(BRANDS);
    }
  });

  it('not over plain http to another computer, where Chrome sends none', () => {
    for (const url of ['http://example.com/', 'http://localhost.example.com/', 'http://127.0.0.1.example.com/', 'file:///C:/a.html', '']) {
      const h = nav();
      expect(withNavigationHints(h, { resourceType: 'mainFrame', url, brands: BRANDS }), url).toBe(h);
    }
  });

  it('a request that is not a page or frame load is left as it is', () => {
    for (const resourceType of ['xhr', 'script', 'image', 'other', undefined]) {
      const h = nav();
      expect(withNavigationHints(h, { resourceType, url: 'https://example.com/', brands: BRANDS })).toBe(h);
    }
  });

  it('a load that already carries the hints is left as it is', () => {
    const h = Object.assign({ 'Sec-CH-UA': 'x' }, nav());
    expect(withNavigationHints(h, { resourceType: 'mainFrame', url: 'https://example.com/', brands: BRANDS })).toBe(h);
  });

  it('with no Upgrade-Insecure-Requests they go in front of the User-Agent, and first when there is neither', () => {
    const a = withNavigationHints({ Accept: '*/*', 'user-agent': 'UA' }, { resourceType: 'subFrame', url: 'https://example.com/', brands: BRANDS });
    expect(Object.keys(a)).toEqual(['Accept', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'user-agent']);
    const b = withNavigationHints({ Accept: '*/*' }, { resourceType: 'subFrame', url: 'https://example.com/', brands: BRANDS });
    expect(Object.keys(b)).toEqual(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'Accept']);
  });

  it('main.js adds them in the one header listener, with the session\'s own brand list', () => {
    expect(MAIN).toContain("h = _withNavigationHints(h, { resourceType: details.resourceType, url: details.url, brands: (ch && ch.ua) || CH_UA });");
    // Before the site rules, which turn the mobile and platform hints for a site asked to be shown as a phone.
    expect(MAIN.indexOf('h = _withNavigationHints(')).toBeLessThan(MAIN.indexOf('_siteHeaders.applyHeaders(h, {'));
    expect(MAIN.indexOf('h = _withNavigationHints(')).toBeGreaterThan(MAIN.indexOf("case 'sec-ch-ua-platform': h[k] = '\"Windows\"'; break;"));
  });
});

// The same measurement: Accept-Language said "en-US" while the page read ["en-US", "tr"] in navigator.languages.
describe('the Accept-Language list for the languages a page sees', () => {
  it('is the list Chrome makes: each language, then its plain one unless the next is of the same family', () => {
    expect(acceptLanguages(['en-US', 'tr'])).toBe('en-US,en,tr');
    // The owner's Chrome 144: these four languages gave "en-US,en;q=0.9,tr-TR;q=0.8,tr;q=0.7".
    expect(acceptLanguages(['en-US', 'tr-TR', 'tr', 'en'])).toBe('en-US,en,tr-TR,tr');
    expect(acceptLanguages(['en-US', 'en-GB', 'fr'])).toBe('en-US,en-GB,en,fr');
    expect(acceptLanguages(['tr'])).toBe('tr');
    expect(acceptLanguages(['en-US'])).toBe('en-US,en');
  });

  it('names nothing twice and skips an empty entry', () => {
    expect(acceptLanguages(['en-US', 'en-US', 'tr'])).toBe('en-US,en,tr');
    expect(acceptLanguages(['en-US', '', 'en'])).toBe('en-US,en');
  });

  it('main.js gives it to every ordinary session, from the app\'s language and then Windows\' own list', () => {
    expect(MAIN).toContain('const _chromeAcceptLanguages = () => _acceptLanguages([app.getLocale(), ...app.getPreferredSystemLanguages()]);');
    expect(MAIN.split('.setUserAgent(CHROME_UA, _chromeAcceptLanguages())').length - 1).toBe(5);
    expect(MAIN).not.toContain('.setUserAgent(CHROME_UA)');
  });
});

// The same measurement: session.setUserAgent does not reach a frame that runs in its own process.
describe('a frame from another site is told the same browser name', () => {
  it('main.js sets the name every process starts with, before the app is ready', () => {
    // A statement of the file itself (no indent): it runs as main.js loads, which is before any window or process.
    expect(MAIN).toMatch(/^app\.userAgentFallback = CHROME_UA;\r?$/m);
  });
});

// This Chromium's own navigator.userAgentData (measured, see above), on a page whose User-Agent says Chrome `major`.
const NATIVE_FULL = '148.0.7778.280';
function pageWith(major) {
  class NavigatorUAData {}
  Object.defineProperty(NavigatorUAData.prototype, 'brands', {
    configurable: true, enumerable: true,
    get() { return [{ brand: 'Not/A)Brand', version: '99' }, { brand: 'Chromium', version: '148' }]; },
  });
  NavigatorUAData.prototype.getHighEntropyValues = function () {
    return Promise.resolve({
      brands: this.brands,
      fullVersionList: [{ brand: 'Not/A)Brand', version: '99.0.0.0' }, { brand: 'Chromium', version: NATIVE_FULL }],
      uaFullVersion: NATIVE_FULL,
    });
  };
  NavigatorUAData.prototype.toJSON = function () {
    return { brands: [{ brand: 'Not/A)Brand', version: '99' }, { brand: 'Chromium', version: '148' }], mobile: false, platform: 'Windows' };
  };
  const uad = new NavigatorUAData();
  const navigator = { userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`, get userAgentData() { return uad; } };
  const runInMainWorld = (src) => new Function('navigator', src)(navigator);
  new Function('window', 'document', 'runInMainWorld', BLOCK)({ location: { protocol: 'https:' } }, { documentElement: {} }, runInMainWorld);
  return navigator;
}

describe('the page sees the list the header carries', () => {
  it('an ordinary tab: same brands, same order, in brands and in the full-version list', async () => {
    const nav = pageWith(148);
    expect(nav.userAgentData.brands).toEqual(chromeBrands('148'));
    const hev = await nav.userAgentData.getHighEntropyValues(['fullVersionList']);
    expect(hev.brands).toEqual(chromeBrands('148'));
    expect(hev.fullVersionList).toEqual(chromeBrands(NATIVE_FULL));
  });

  // JSON.stringify(navigator.userAgentData) answered with this Chromium's own list beside a brands that said Chrome.
  it('JSON.stringify of userAgentData gives the same list', () => {
    const nav = pageWith(148);
    expect(JSON.parse(JSON.stringify(nav.userAgentData))).toEqual({ brands: chromeBrands('148'), mobile: false, platform: 'Windows' });
    expect(JSON.parse(JSON.stringify(pageWith(146).userAgentData)).brands).toEqual(chromeBrands('146'));
  });

  // A page can read a function's source: one of ours where the browser has a native one says "patched browser".
  it('what the shim puts in place reads as native, with no mark on it', () => {
    const proto = Object.getPrototypeOf(pageWith(148).userAgentData);
    const fns = [Object.getOwnPropertyDescriptor(proto, 'brands').get, proto.getHighEntropyValues, proto.toJSON];
    for (const fn of fns) {
      expect(Function.prototype.toString.call(fn)).toMatch(/^function [\w ]*\(\) \{ \[native code\] \}$/);
      expect(Object.keys(fn)).toEqual([]);
      expect(fn.__vexPatched).toBeUndefined();
    }
    expect(BLOCK).not.toContain('__vexPatched');
  });

  it('running the shim twice changes nothing', async () => {
    const nav = pageWith(148);
    const runInMainWorld = (src) => new Function('navigator', src)(nav);
    new Function('window', 'document', 'runInMainWorld', BLOCK)({ location: { protocol: 'https:' } }, { documentElement: {} }, runInMainWorld);
    expect(nav.userAgentData.brands).toEqual(chromeBrands('148'));
    expect((await nav.userAgentData.getHighEntropyValues(['fullVersionList'])).fullVersionList).toEqual(chromeBrands(NATIVE_FULL));
  });

  // A New Identity or Tor tab says another Chrome: its filler and order are that version's, as in its headers.
  it('every other major a tab may claim, 100 to 180', async () => {
    for (let major = 100; major <= 180; major++) {
      if (major === 148) continue;
      const nav = pageWith(major);
      expect(nav.userAgentData.brands, 'brands of ' + major).toEqual(chromeBrands(String(major)));
      const hev = await nav.userAgentData.getHighEntropyValues(['fullVersionList']);
      expect(hev.fullVersionList, 'full-version list of ' + major).toEqual(chromeBrands(major + '.0.0.0'));
    }
  });
});
