// @vitest-environment node
//
// chrome.declarativeNetRequest, evaluated by main (src/main/extension-dnr.js).
// Electron accepted the API and enforced nothing. The semantics below are the
// ones Chrome's documentation gives for urlFilter, priority, limits and
// modifyHeaders.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const dnr = req('../../src/main/extension-dnr.js');
const { createExtensionDnr, compileRule, checkRegex, normalizeRequest, applyHeaderOps, LIMITS } = dnr;
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

const P = 'persist:main';
const EXT = 'a'.repeat(32);
function setup(manifestExtra = {}, files = {}, opts = {}) {
  const store = createExtensionDnr({
    load: () => opts.saved || {}, save: opts.save || (() => {}),
    readFile: (p) => { const k = path.basename(p); if (!(k in files)) throw new Error('ENOENT ' + k); return JSON.stringify(files[k]); },
  });
  const manifest = { permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback'], ...manifestExtra };
  store.register(P, { id: EXT, path: path.resolve('/ext'), manifest, name: 'Test', hostAllowed: opts.hostAllowed || (() => true) });
  return store;
}
const q = (url, o = {}) => normalizeRequest({ url, resourceType: o.type || 'script', method: o.method || 'GET', referrer: o.referrer || '', webContentsId: o.tab ?? 1 }, o.page || 'https://page.test/');
const rule = (id, condition, action = { type: 'block' }, extra = {}) => ({ id, priority: 1, condition, action, ...extra });
function verdict(store, url, o) { return store.evaluate(P, q(url, o)); }
function withDynamic(rules, o) {
  const s = setup({}, {}, o);
  s.api(P, EXT, 'updateDynamicRules', { addRules: rules });
  return s;
}

describe('urlFilter semantics (Chrome documentation table)', () => {
  const cases = [
    // [filter, url, matches]
    ['abc', 'http://a.test/abcd', true],
    ['abc', 'http://a.test/ab', false],
    ['abc*d', 'http://a.test/abcxyzd', true],
    ['abc*d', 'http://a.test/abc', false],
    ['abc^', 'http://a.test/abc?x=1', true],
    ['abc^', 'http://a.test/abc/', true],
    ['abc^', 'http://a.test/abc', true],           // ^ also matches the end of the address
    ['abc^', 'http://a.test/abcd', false],
    ['abc^', 'http://a.test/abc-x', false],         // - is not a separator
    ['abc^', 'http://a.test/abc_x', false],         // _ is not a separator
    ['abc^', 'http://a.test/abc.x', false],         // . is not a separator
    ['abc^', 'http://a.test/abc%20x', false],       // % is not a separator
    ['|http://a.test', 'http://a.test/x', true],
    ['|http://a.test', 'https://a.test/x', false],
    ['|a.test', 'http://a.test/x', false],           // anchored at the very start
    ['x.html|', 'http://a.test/x.html', true],
    ['x.html|', 'http://a.test/x.html?q', false],
    ['|http://a.test/x|', 'http://a.test/x', true],
    ['|http://a.test/x|', 'http://a.test/xy', false],
    ['||example.com', 'http://example.com/', true],
    ['||example.com', 'https://sub.example.com/', true],
    ['||example.com', 'https://a.b.example.com/p', true],
    ['||example.com', 'https://notexample.com/', false],
    ['||example.com', 'https://example.com.evil.test/', true],      // only the start is anchored
    ['||example.com^', 'https://example.com.evil.test/', false],
    ['||example.com^', 'https://example.com:8080/x', true],
    ['||example.com/path', 'https://x.example.com/path/a', true],
    ['||example.com', 'https://evil.test/?u=http://example.com/', false],
    ['||example.com', 'https://user@example.com/', true],
    ['*', 'http://a.test/', true],
    ['/ads/*/banner', 'http://a.test/ads/2024/banner.png', true],
    ['/ads/*/banner', 'http://a.test/ads/banner.png', false],
  ];
  for (const [filter, url, expected] of cases) {
    it(`${filter} ${expected ? 'matches' : 'does not match'} ${url}`, () => {
      const s = withDynamic([rule(1, { urlFilter: filter })]);
      expect(verdict(s, url).action === 'block').toBe(expected);
    });
  }
  it('is case-insensitive unless isUrlFilterCaseSensitive is true', () => {
    const a = withDynamic([rule(1, { urlFilter: 'ABC' })]);
    expect(verdict(a, 'http://a.test/xabcx').action).toBe('block');
    const b = withDynamic([rule(1, { urlFilter: 'ABC', isUrlFilterCaseSensitive: true })]);
    expect(verdict(b, 'http://a.test/xabcx').action).toBe(null);
    expect(verdict(b, 'http://a.test/xABCx').action).toBe('block');
  });
  it('refuses a urlFilter that is empty, starts ||*, or is not ASCII', () => {
    for (const f of ['', '||*x', 'ünï']) expect(() => compileRule(rule(1, { urlFilter: f }))).toThrow();
  });
  it('refuses both urlFilter and regexFilter', () => {
    expect(() => compileRule(rule(1, { urlFilter: 'a', regexFilter: 'a' }))).toThrow(/both urlFilter and regexFilter/);
  });
});

describe('request conditions', () => {
  it('resourceTypes: with none given, main_frame is not matched; excludedResourceTypes narrows', () => {
    const s = withDynamic([rule(1, { urlFilter: '||a.test' })]);
    expect(verdict(s, 'https://a.test/', { type: 'mainFrame' }).action).toBe(null);
    expect(verdict(s, 'https://a.test/x.js', { type: 'script' }).action).toBe('block');
    const t = withDynamic([rule(1, { urlFilter: '||a.test', resourceTypes: ['main_frame'] })]);
    expect(verdict(t, 'https://a.test/', { type: 'mainFrame' }).action).toBe('block');
    const u = withDynamic([rule(1, { urlFilter: '||a.test', excludedResourceTypes: ['image'] })]);
    expect(verdict(u, 'https://a.test/i.png', { type: 'image' }).action).toBe(null);
    expect(verdict(u, 'https://a.test/i.js', { type: 'script' }).action).toBe('block');
  });
  it('requestMethods and excludedRequestMethods', () => {
    const s = withDynamic([rule(1, { urlFilter: '||a.test', requestMethods: ['post'] })]);
    expect(verdict(s, 'https://a.test/', { method: 'POST' }).action).toBe('block');
    expect(verdict(s, 'https://a.test/', { method: 'GET' }).action).toBe(null);
    const t = withDynamic([rule(1, { urlFilter: '||a.test', excludedRequestMethods: ['get'] })]);
    expect(verdict(t, 'https://a.test/', { method: 'GET' }).action).toBe(null);
    expect(verdict(t, 'https://a.test/', { method: 'PUT' }).action).toBe('block');
  });
  it('initiatorDomains, excludedInitiatorDomains and domains/excludedDomains', () => {
    const s = withDynamic([rule(1, { urlFilter: '||cdn.test', initiatorDomains: ['site.test'] })]);
    expect(verdict(s, 'https://cdn.test/x', { page: 'https://www.site.test/p' }).action).toBe('block');
    expect(verdict(s, 'https://cdn.test/x', { page: 'https://other.test/p' }).action).toBe(null);
    expect(verdict(s, 'https://cdn.test/x', { type: 'mainFrame' }).action).toBe(null);   // no initiator
    const t = withDynamic([rule(1, { urlFilter: '||cdn.test', excludedInitiatorDomains: ['site.test'] })]);
    expect(verdict(t, 'https://cdn.test/x', { page: 'https://site.test/' }).action).toBe(null);
    expect(verdict(t, 'https://cdn.test/x', { page: 'https://other.test/' }).action).toBe('block');
    const u = withDynamic([rule(1, { urlFilter: '||cdn.test', domains: ['site.test'] })]);
    expect(verdict(u, 'https://cdn.test/x', { page: 'https://site.test/' }).action).toBe('block');
    const referred = verdict(s, 'https://cdn.test/x', { referrer: 'https://site.test/a?b', page: 'https://elsewhere.test/' });
    expect(referred.action).toBe('block');
  });
  it('requestDomains matches the host and its subdomains', () => {
    const s = withDynamic([rule(1, { requestDomains: ['example.com'] })]);
    expect(verdict(s, 'https://example.com/a').action).toBe('block');
    expect(verdict(s, 'https://x.example.com/a').action).toBe('block');
    expect(verdict(s, 'https://notexample.com/a').action).toBe(null);
    expect(verdict(s, 'https://a.test/?h=example.com').action).toBe(null);
    const t = withDynamic([rule(1, { urlFilter: 'banner', excludedRequestDomains: ['ok.test'] })]);
    expect(verdict(t, 'https://ok.test/banner').action).toBe(null);
    expect(verdict(t, 'https://bad.test/banner').action).toBe('block');
  });
  it('domainType thirdParty / firstParty', () => {
    const s = withDynamic([rule(1, { urlFilter: '||cdn.site.test', domainType: 'thirdParty' }), rule(2, { urlFilter: '||cdn.site.test', domainType: 'firstParty' }, { type: 'allow' }, { priority: 2 })]);
    expect(verdict(s, 'https://cdn.site.test/a', { page: 'https://www.site.test/' }).action).toBe('allow');
    expect(verdict(s, 'https://cdn.site.test/a', { page: 'https://other.test/' }).action).toBe('block');
  });
  it('regexFilter matches the whole address, case-insensitively by default', () => {
    const s = withDynamic([rule(1, { regexFilter: '^https://[a-z]+\\.ads\\.test/v[0-9]+/' })]);
    expect(verdict(s, 'https://CDN.ads.test/v2/x').action).toBe('block');
    expect(verdict(s, 'https://cdn.ads.test/x/v2/').action).toBe(null);
    const t = withDynamic([rule(1, { regexFilter: 'ADS', isUrlFilterCaseSensitive: true })]);
    expect(verdict(t, 'https://a.test/ads').action).toBe(null);
  });
  it('only web addresses are judged, never the extension\'s own pages or data', () => {
    const s = withDynamic([rule(1, { urlFilter: '*' })]);
    expect(verdict(s, 'chrome-extension://abc/page.html').action).toBe(null);
    expect(verdict(s, 'data:text/plain,hi').action).toBe(null);
    expect(verdict(s, 'wss://a.test/socket', { type: 'webSocket' }).action).toBe('block');
  });
});

describe('priority and action precedence', () => {
  it('the higher priority wins', () => {
    const s = withDynamic([rule(1, { urlFilter: 'x' }, { type: 'block' }, { priority: 1 }), rule(2, { urlFilter: 'x' }, { type: 'allow' }, { priority: 2 })]);
    expect(verdict(s, 'https://a.test/x').action).toBe('allow');
    const t = withDynamic([rule(1, { urlFilter: 'x' }, { type: 'block' }, { priority: 3 }), rule(2, { urlFilter: 'x' }, { type: 'allow' }, { priority: 2 })]);
    expect(verdict(t, 'https://a.test/x').action).toBe('block');
  });
  it('at one priority: allow, then block, then upgradeScheme, then redirect', () => {
    const rs = (types) => types.map((type, i) => rule(i + 1, { urlFilter: '||a.test' }, type === 'redirect' ? { type, redirect: { url: 'https://b.test/' } } : { type }));
    expect(verdict(withDynamic(rs(['redirect', 'upgradeScheme', 'block', 'allow'])), 'http://a.test/').action).toBe('allow');
    expect(verdict(withDynamic(rs(['redirect', 'upgradeScheme', 'block'])), 'http://a.test/').action).toBe('block');
    const up = verdict(withDynamic(rs(['redirect', 'upgradeScheme'])), 'http://a.test/');
    expect(up.action).toBe('upgradeScheme');
    expect(up.redirectUrl).toBe('https://a.test/');
  });
  it('a block in any extension wins over another extension\'s allow', () => {
    const store = createExtensionDnr({ load: () => ({}), save() {}, readFile: () => '[]' });
    const man = { permissions: ['declarativeNetRequest'] };
    store.register(P, { id: 'a'.repeat(32), path: path.resolve('/a'), manifest: man, hostAllowed: () => true });
    store.register(P, { id: 'b'.repeat(32), path: path.resolve('/b'), manifest: man, hostAllowed: () => true });
    store.api(P, 'a'.repeat(32), 'updateDynamicRules', { addRules: [rule(1, { urlFilter: 'x' }, { type: 'allow' }, { priority: 9 })] });
    store.api(P, 'b'.repeat(32), 'updateDynamicRules', { addRules: [rule(1, { urlFilter: 'x' }, { type: 'block' })] });
    expect(store.evaluate(P, q('https://a.test/x')).action).toBe('block');
  });
  it('allowAllRequests on a page allows its requests of lower or equal priority only', () => {
    const s = withDynamic([
      rule(1, { urlFilter: '||page.test', resourceTypes: ['main_frame'] }, { type: 'allowAllRequests' }, { priority: 5 }),
      rule(2, { urlFilter: 'ad' }, { type: 'block' }, { priority: 3 }),
      rule(3, { urlFilter: 'evil' }, { type: 'block' }, { priority: 8 }),
    ]);
    expect(verdict(s, 'https://page.test/', { type: 'mainFrame', tab: 7 }).action).toBe('allow');
    expect(verdict(s, 'https://x.test/ad.js', { tab: 7 }).action).toBe('allow');
    expect(verdict(s, 'https://x.test/evil.js', { tab: 7 }).action).toBe('block');
    expect(verdict(s, 'https://x.test/ad.js', { tab: 8 }).action).toBe('block');   // another tab
    verdict(s, 'https://other.test/', { type: 'mainFrame', tab: 7 });                // navigates away
    expect(verdict(s, 'https://x.test/ad.js', { tab: 7 }).action).toBe('block');
  });
});

describe('redirect and upgradeScheme', () => {
  const R = (redirect, cond = { urlFilter: '||a.test' }) => withDynamic([rule(1, cond, { type: 'redirect', redirect })]);
  it('url, extensionPath', () => {
    expect(verdict(R({ url: 'https://b.test/x' }), 'https://a.test/').redirectUrl).toBe('https://b.test/x');
    expect(verdict(R({ extensionPath: '/blocked.html' }), 'https://a.test/').redirectUrl).toBe(`chrome-extension://${EXT}/blocked.html`);
  });
  it('transform: scheme, host, port, path, query, queryTransform, fragment', () => {
    const r = verdict(R({ transform: { scheme: 'https', host: 'b.test', port: '8443', path: '/new', queryTransform: { removeParams: ['utm'], addOrReplaceParams: [{ key: 'a', value: '1' }, { key: 'zz', value: '2', replaceOnly: true }] }, fragment: '#f' } }),
      'http://a.test/old?utm=1&k=2');
    expect(r.redirectUrl).toBe('https://b.test:8443/new?k=2&a=1#f');
    expect(verdict(R({ transform: { query: '?only=1' } }), 'https://a.test/p?x=1').redirectUrl).toBe('https://a.test/p?only=1');
  });
  it('regexSubstitution fills \\1 from the match', () => {
    const s = withDynamic([rule(1, { regexFilter: '^https://old\\.test/(.*)$' }, { type: 'redirect', redirect: { regexSubstitution: 'https://new.test/\\1' } })]);
    expect(verdict(s, 'https://old.test/a/b?c=d').redirectUrl).toBe('https://new.test/a/b?c=d');
  });
  it('a redirect to the address itself is not made', () => {
    expect(verdict(R({ url: 'https://a.test/' }), 'https://a.test/').action).toBe(null);
  });
  it('refuses redirects to javascript: and ones with two targets', () => {
    expect(() => compileRule(rule(1, { urlFilter: 'x' }, { type: 'redirect', redirect: { url: 'javascript:alert(1)' } }))).toThrow(/cannot redirect/);
    expect(() => compileRule(rule(1, { urlFilter: 'x' }, { type: 'redirect', redirect: { url: 'https://a.test/', extensionPath: '/x' } }))).toThrow(/exactly one/);
  });
  it('upgradeScheme turns http into https and ws into wss, and leaves https alone', () => {
    const s = withDynamic([rule(1, { urlFilter: '||a.test' }, { type: 'upgradeScheme' })]);
    expect(verdict(s, 'http://a.test:8080/p?q=1').redirectUrl).toBe('https://a.test:8080/p?q=1');
    expect(verdict(s, 'ws://a.test/s', { type: 'webSocket' }).redirectUrl).toBe('wss://a.test/s');
    expect(verdict(s, 'https://a.test/').action).toBe(null);
  });
});

describe('host permissions', () => {
  it('redirect and modifyHeaders need a host permission; block does not', () => {
    const allowed = (url) => /^https:\/\/(?:ok|page)\.test/.test(url);
    const s = setup({}, {}, { hostAllowed: allowed });
    s.api(P, EXT, 'updateDynamicRules', { addRules: [
      rule(1, { urlFilter: '||ok.test' }, { type: 'redirect', redirect: { url: 'https://z.test/' } }),
      rule(2, { urlFilter: '||no.test' }, { type: 'redirect', redirect: { url: 'https://z.test/' } }),
      rule(3, { urlFilter: '||no.test/blocked' }, { type: 'block' }, { priority: 2 }),
    ] });
    expect(verdict(s, 'https://ok.test/').action).toBe('redirect');
    expect(verdict(s, 'https://no.test/').action).toBe(null);
    expect(verdict(s, 'https://no.test/blocked').action).toBe('block');
  });
  it('with only declarativeNetRequestWithHostAccess even a block needs the host', () => {
    const s = setup({ permissions: ['declarativeNetRequestWithHostAccess'] }, {}, { hostAllowed: (u) => /(?:ok|page)\.test/.test(u) });
    s.api(P, EXT, 'updateDynamicRules', { addRules: [rule(1, { urlFilter: 'x' })] });
    expect(verdict(s, 'https://ok.test/x').action).toBe('block');
    expect(verdict(s, 'https://no.test/x').action).toBe(null);
  });
});

describe('modifyHeaders', () => {
  const mh = (id, priority, requestHeaders, responseHeaders, cond = { urlFilter: '||a.test' }) =>
    rule(id, cond, { type: 'modifyHeaders', ...(requestHeaders ? { requestHeaders } : {}), ...(responseHeaders ? { responseHeaders } : {}) }, { priority });
  it('set, append and remove on a request', () => {
    const s = withDynamic([mh(1, 1, [{ header: 'X-A', operation: 'set', value: '1' }, { header: 'Referer', operation: 'remove' }, { header: 'Accept', operation: 'append', value: 'x/y' }])]);
    const r = verdict(s, 'https://a.test/');
    const headers = { referer: 'https://p.test/', Accept: 'text/html' };
    applyHeaderOps(headers, r.requestOps, false);
    expect(headers).toEqual({ Accept: 'text/html, x/y', 'X-A': '1' });
  });
  it('on a response header values are lists; set replaces and append adds', () => {
    const s = withDynamic([mh(1, 1, null, [{ header: 'Content-Security-Policy', operation: 'remove' }, { header: 'X-Frame-Options', operation: 'set', value: 'ALLOWALL' }, { header: 'Link', operation: 'append', value: '<b>' }])]);
    const r = verdict(s, 'https://a.test/');
    const headers = { 'content-security-policy': ["default-src 'self'"], 'x-frame-options': ['DENY'], link: ['<a>'] };
    applyHeaderOps(headers, r.responseOps, true);
    expect(headers).toEqual({ 'x-frame-options': ['ALLOWALL'], link: ['<a>', '<b>'] });
  });
  it('a higher-priority set or remove keeps lower-priority rules off that header; appends may follow an append', () => {
    const s = withDynamic([
      mh(1, 5, [{ header: 'X-A', operation: 'set', value: 'high' }, { header: 'X-B', operation: 'append', value: 'h' }]),
      mh(2, 1, [{ header: 'X-A', operation: 'set', value: 'low' }, { header: 'X-B', operation: 'append', value: 'l' }, { header: 'X-B', operation: 'set', value: 'no' }]),
    ]);
    const headers = {};
    applyHeaderOps(headers, verdict(s, 'https://a.test/').requestOps, false);
    expect(headers).toEqual({ 'X-A': 'high', 'X-B': 'h, l' });
  });
  it('an allow rule of the same or higher priority switches modifyHeaders off; a block or redirect drops them', () => {
    const s = withDynamic([mh(1, 2, [{ header: 'X-A', operation: 'set', value: '1' }]), rule(2, { urlFilter: '||a.test/allowed' }, { type: 'allow' }, { priority: 2 }), rule(3, { urlFilter: '||a.test/blocked' }, { type: 'block' }, { priority: 1 })]);
    expect(verdict(s, 'https://a.test/x').requestOps.length).toBe(1);
    expect(verdict(s, 'https://a.test/allowed').requestOps.length).toBe(0);
    const b = verdict(s, 'https://a.test/blocked');
    expect(b.action).toBe('block');
    expect(b.requestOps.length).toBe(0);
  });
  it('refuses a modifyHeaders rule with no headers, a set with no value, a remove with one', () => {
    expect(() => compileRule(rule(1, { urlFilter: 'x' }, { type: 'modifyHeaders' }))).toThrow(/no requestHeaders or responseHeaders/);
    expect(() => compileRule(mh(1, 1, [{ header: 'A', operation: 'set' }]))).toThrow(/needs a value/);
    expect(() => compileRule(mh(1, 1, [{ header: 'A', operation: 'remove', value: 'x' }]))).toThrow(/takes no value/);
  });
});

describe('limits, ids and errors', () => {
  it('updateDynamicRules is all or nothing and refuses duplicate ids', () => {
    const s = setup();
    s.api(P, EXT, 'updateDynamicRules', { addRules: [rule(1, { urlFilter: 'a' })] });
    expect(() => s.api(P, EXT, 'updateDynamicRules', { addRules: [rule(2, { urlFilter: 'b' }), rule(1, { urlFilter: 'c' })] })).toThrow(/unique ID/);
    expect(s.api(P, EXT, 'getDynamicRules', {}).map(r => r.id)).toEqual([1]);
    s.api(P, EXT, 'updateDynamicRules', { removeRuleIds: [1], addRules: [rule(1, { urlFilter: 'c' })] });   // removal first, then the same id again
    expect(s.api(P, EXT, 'getDynamicRules', {})[0].condition.urlFilter).toBe('c');
  });
  it('refuses more than the guaranteed dynamic rule count, with an error', () => {
    const s = setup();
    const many = Array.from({ length: LIMITS.MAX_NUMBER_OF_DYNAMIC_RULES + 1 }, (_, i) => rule(i + 1, { urlFilter: 'p' + i }));
    expect(() => s.api(P, EXT, 'updateDynamicRules', { addRules: many })).toThrow(/Rule count exceeded/);
    expect(s.api(P, EXT, 'getDynamicRules', {}).length).toBe(0);
  });
  it('refuses more unsafe (redirect/modifyHeaders) rules than allowed, and more session rules than allowed', () => {
    const s = setup();
    const red = Array.from({ length: LIMITS.MAX_NUMBER_OF_UNSAFE_SESSION_RULES + 1 }, (_, i) => rule(i + 1, { urlFilter: 'u' + i }, { type: 'redirect', redirect: { url: 'https://b.test/' } }));
    expect(() => s.api(P, EXT, 'updateSessionRules', { addRules: red })).toThrow(/Unsafe rule count exceeded|Rule count exceeded/);
    const blocks = Array.from({ length: LIMITS.MAX_NUMBER_OF_SESSION_RULES + 1 }, (_, i) => rule(i + 1, { urlFilter: 'u' + i }));
    expect(() => s.api(P, EXT, 'updateSessionRules', { addRules: blocks })).toThrow(/Rule count exceeded/);
  });
  it('refuses more than 1000 regex rules', () => {
    const s = setup();
    const re = Array.from({ length: LIMITS.MAX_NUMBER_OF_REGEX_RULES + 1 }, (_, i) => rule(i + 1, { regexFilter: 'x' + i }));
    expect(() => s.api(P, EXT, 'updateDynamicRules', { addRules: re })).toThrow(/Regex rule count exceeded/);
  });
  it('rejects bad ids, priorities, actions and unknown keys by name', () => {
    expect(() => compileRule({ id: 0, condition: {}, action: { type: 'block' } })).toThrow(/id/);
    expect(() => compileRule({ id: 1, priority: 0, condition: {}, action: { type: 'block' } })).toThrow(/priority/);
    expect(() => compileRule({ id: 1, condition: {}, action: { type: 'explode' } })).toThrow(/action type/);
    expect(() => compileRule({ id: 1, condition: { nope: 1 }, action: { type: 'block' } })).toThrow(/unknown condition/);
    expect(() => compileRule({ id: 1, condition: { responseHeaders: [] }, action: { type: 'block' } })).toThrow(/does not support/);
    expect(() => compileRule(rule(1, { tabIds: [1] }), {})).toThrow(/only allowed in session rules/);
    expect(() => compileRule(rule(1, { resourceTypes: ['image'] }, { type: 'allowAllRequests' }))).toThrow(/main_frame and sub_frame/);
  });
  it('session rules take tabIds and are not saved; dynamic rules are', () => {
    const saved = [];
    const s = setup({}, {}, { save: (d) => saved.push(JSON.parse(JSON.stringify(d))) });
    s.api(P, EXT, 'updateSessionRules', { addRules: [rule(1, { urlFilter: 'x', tabIds: [4] })] });
    expect(saved.length).toBe(0);
    expect(verdict(s, 'https://a.test/x', { tab: 4 }).action).toBe('block');
    expect(verdict(s, 'https://a.test/x', { tab: 5 }).action).toBe(null);
    s.api(P, EXT, 'updateDynamicRules', { addRules: [rule(2, { urlFilter: 'y' })] });
    expect(saved.at(-1)[`${P}|${EXT}`].dynamic[0].id).toBe(2);
  });
  it('saved dynamic rules come back when the extension is registered again', () => {
    const key = `${P}|${EXT}`;
    const s = setup({}, {}, { saved: { [key]: { dynamic: [rule(7, { urlFilter: 'saved' })] } } });
    expect(verdict(s, 'https://a.test/saved').action).toBe('block');
  });
});

describe('static rulesets from the manifest', () => {
  const manifest = { declarative_net_request: { rule_resources: [
    { id: 'ads', enabled: true, path: 'ads.json' },
    { id: 'extra', enabled: false, path: 'extra.json' },
    { id: 'escape', enabled: true, path: '../outside.json' },
  ] } };
  const files = { 'ads.json': [rule(1, { urlFilter: '||ads.test^' }), { id: 2, bogus: true }], 'extra.json': [rule(1, { urlFilter: '||extra.test^' })] };
  it('loads enabled rulesets, skips a bad rule with a warning, refuses a path out of the folder', () => {
    const s = setup(manifest, files);
    expect(verdict(s, 'https://ads.test/x').action).toBe('block');
    expect(verdict(s, 'https://extra.test/x').action).toBe(null);
    const st = s.status(P, EXT);
    expect(st.warnings.join(' ')).toMatch(/a rule was ignored/);
    expect(st.rulesets.find(r => r.id === 'escape').error).toMatch(/leaves the extension/);
  });
  it('updateEnabledRulesets turns rulesets on and off and is remembered', () => {
    const saved = [];
    const s = setup(manifest, files, { save: (d) => saved.push(JSON.parse(JSON.stringify(d))) });
    expect(s.api(P, EXT, 'getEnabledRulesets')).toEqual(['ads']);
    s.api(P, EXT, 'updateEnabledRulesets', { enableRulesetIds: ['extra'], disableRulesetIds: ['ads'] });
    expect(verdict(s, 'https://ads.test/x').action).toBe(null);
    expect(verdict(s, 'https://extra.test/x').action).toBe('block');
    expect(saved.at(-1)[`${P}|${EXT}`].enabled).toEqual(['extra']);
    expect(() => s.api(P, EXT, 'updateEnabledRulesets', { enableRulesetIds: ['nope'] })).toThrow(/does not exist/);
    expect(s.api(P, EXT, 'getAvailableStaticRuleCount')).toBe(LIMITS.GUARANTEED_MINIMUM_STATIC_RULES - 1);
  });
  it('refuses to turn on a ruleset that takes the total over the guaranteed count', () => {
    const big = Array.from({ length: LIMITS.GUARANTEED_MINIMUM_STATIC_RULES }, (_, i) => rule(i + 1, { urlFilter: 'q' + i }));
    const s = setup({ declarative_net_request: { rule_resources: [{ id: 'big', enabled: false, path: 'big.json' }, { id: 'one', enabled: true, path: 'one.json' }] } },
      { 'big.json': big, 'one.json': [rule(1, { urlFilter: 'one' })] });
    expect(() => s.api(P, EXT, 'updateEnabledRulesets', { enableRulesetIds: ['big'] })).toThrow(/Rule count exceeded/);
  });
  it('a static rule can be turned off by id', () => {
    const s = setup(manifest, files);
    s.api(P, EXT, 'updateStaticRules', { rulesetId: 'ads', disableRuleIds: [1] });
    expect(verdict(s, 'https://ads.test/x').action).toBe(null);
    expect(s.api(P, EXT, 'getDisabledRuleIds', { rulesetId: 'ads' })).toEqual([1]);
  });
});

describe('regexFilter safety', () => {
  const refused = ['(a+)+$', '(a*)*b', '(.*)*x', '(a|aa)+c', '(x+x+)+y', '(?=a)b', '(?<=a)b', '(a)\\1', 'a'.repeat(600), '[a-', '(unclosed', 'a*a*a*a*a*a*a*a*'];
  for (const re of refused) it(`refuses ${re.length > 30 ? re.slice(0, 12) + '...' : re}`, () => expect(checkRegex(re).ok).toBe(false));
  const fine = ['^https://[a-z]+\\.example\\.com/', 'ads?/[0-9]{1,3}\\.js$', '(foo|bar)\\.test', '(?:a|b)?c', '^https?://(www\\.)?site\\.test/.*\\.gif'];
  for (const re of fine) it(`accepts ${re}`, () => expect(checkRegex(re).ok).toBe(true));
  it('isRegexSupported answers like Chrome: isSupported and a reason', () => {
    const s = setup();
    expect(s.api(P, EXT, 'isRegexSupported', { regex: 'a+' })).toEqual({ isSupported: true });
    expect(s.api(P, EXT, 'isRegexSupported', { regex: '(a+)+' })).toEqual({ isSupported: false, reason: 'memoryLimitExceeded' });
    expect(s.api(P, EXT, 'isRegexSupported', { regex: '(?=a)' })).toEqual({ isSupported: false, reason: 'syntaxError' });
  });
  it('a rule with a refused regexFilter is rejected when added', () => {
    const s = setup();
    expect(() => s.api(P, EXT, 'updateDynamicRules', { addRules: [rule(1, { regexFilter: '(a+)+$' })] })).toThrow(/will not run/);
  });
  it('a hostile address does not hang a pattern that was let in', () => {
    const s = withDynamic([rule(1, { regexFilter: '^https://[a-z]+\\.x\\.test/.*\\.js$' }), rule(2, { urlFilter: 'a*a*a*a*a*b' })]);
    const t0 = Date.now();
    verdict(s, 'https://' + 'a'.repeat(1900) + '.x.test/');
    verdict(s, 'https://a.test/' + 'a'.repeat(1900));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('testMatchOutcome, getMatchedRules, feedback', () => {
  it('testMatchOutcome says which rules a hypothetical request would hit', () => {
    const s = withDynamic([rule(4, { urlFilter: '||a.test' })]);
    expect(s.api(P, EXT, 'testMatchOutcome', { request: { url: 'https://a.test/x', type: 'script' } }).matchedRules).toEqual([{ ruleId: 4, rulesetId: '_dynamic' }]);
    expect(s.api(P, EXT, 'testMatchOutcome', { request: { url: 'https://b.test/x', type: 'script' } }).matchedRules).toEqual([]);
  });
  it('getMatchedRules works only with declarativeNetRequestFeedback', () => {
    const on = withDynamic([rule(4, { urlFilter: '||a.test' })]);
    verdict(on, 'https://a.test/x', { tab: 3 });
    const rows = on.api(P, EXT, 'getMatchedRules', { filter: { tabId: 3 } }).rulesMatchedInfo;
    expect(rows.length).toBe(1);
    expect(rows[0].rule).toEqual({ ruleId: 4, rulesetId: '_dynamic' });
    const off = setup({ permissions: ['declarativeNetRequest'] });
    expect(() => off.api(P, EXT, 'getMatchedRules', {})).toThrow(/declarativeNetRequestFeedback/);
  });
  it('an extension without the permission has no engine', () => {
    const store = createExtensionDnr({ load: () => ({}), save() {}, readFile: () => '[]' });
    expect(store.register(P, { id: EXT, path: '/x', manifest: { permissions: ['storage'] } })).toBe(null);
    expect(() => store.api(P, EXT, 'getDynamicRules')).toThrow();
  });
});

describe('speed', () => {
  it('30000 static rules: a request is checked in well under a millisecond on average', () => {
    const rules = [];
    for (let i = 0; i < 20000; i++) rules.push(rule(i + 1, { urlFilter: `||tracker${i}.example.test^` }));
    for (let i = 0; i < 6000; i++) rules.push(rule(20001 + i, { urlFilter: `/path${i}/pixel.gif` }));
    for (let i = 0; i < 4000; i++) rules.push(rule(26001 + i, { urlFilter: `adsrv${i}*banner` }));
    const s = setup({ declarative_net_request: { rule_resources: [{ id: 'big', enabled: true, path: 'big.json' }] } }, { 'big.json': rules });
    const urls = ['https://www.news.test/article/1?x=2', 'https://cdn.news.test/static/app.js', 'https://tracker777.example.test/p', 'https://a.test/path42/pixel.gif'];
    expect(verdict(s, urls[2]).action).toBe('block');
    expect(verdict(s, urls[3]).action).toBe('block');
    const t0 = process.hrtime.bigint();
    const N = 4000;
    for (let i = 0; i < N; i++) verdict(s, urls[i % 4]);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // Alone this is ~0.01 ms a request; the bound is loose so a loaded CI box passes.
    expect(ms / N).toBeLessThan(3);
    expect(s.status(P, EXT).avgMs).toBeLessThan(3);
  });
  it('a slow ruleset is flagged with a warning for the extension card', () => {
    let t = 0;
    const store = createExtensionDnr({ load: () => ({}), save() {}, readFile: () => '[]', clock: () => { t += 3; return t; } });
    store.register(P, { id: EXT, path: path.resolve('/x'), manifest: { permissions: ['declarativeNetRequest'] }, hostAllowed: () => true });
    store.api(P, EXT, 'updateDynamicRules', { addRules: [rule(1, { urlFilter: 'x' })] });
    for (let i = 0; i < 150; i++) store.evaluate(P, q('https://a.test/' + i));
    const st = store.status(P, EXT);
    expect(st.slow).toBe(true);
    expect(st.warnings.join(' ')).toMatch(/rules are slow/);
  });
});

describe('wiring in main.js', () => {
  it('uses the existing per-event listeners and registers no second one', () => {
    expect(MAIN).toMatch(/require\('\.\/main\/extension-dnr'\)/);
    expect(MAIN).toMatch(/_dnrRequest\(ses, details\)/);
    expect(MAIN).toMatch(/_dnrRequestHeaders\(ses, details/);
    expect(MAIN).toMatch(/_dnrResponseHeaders\(ses, details/);
  });
  it('the manager no longer says blocking rules block nothing', () => {
    const ws = fs.readFileSync(path.join(__dirname, '../../src/main/webstore.js'), 'utf8');
    expect(ws).not.toMatch(/accepted but block nothing/);
  });
});
