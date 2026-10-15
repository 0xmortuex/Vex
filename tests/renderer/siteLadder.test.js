// @vitest-environment jsdom
//
// "This site is broken" (js/site-ladder.js): the order of the steps, that a
// fix is scoped to one site, that undo and "tighten again" put back exactly
// what was there, that Tor and private tabs are refused, and the bound on the
// kept list.
import { describe, it, expect } from 'vitest';
const { SiteLadder: L } = require('../../src/renderer/js/site-ladder.js');

const env = (over = {}) => ({ web: true, canSave: true, adsGlobalOn: true, hasBoost: false, darkGlobal: false, siteUserAgent: false, ...over });
const st = (over = {}) => ({ rule: {}, boostPaused: false, dark: false, ...over });

describe('the order of the steps', () => {
  it('goes ads, then modifiers, then restrictions, then all together', () => {
    const plan = L.plan(env({ hasBoost: true }), st({ rule: { js: 'off' } }));
    expect(plan).toEqual(['ads', 'modifiers', 'restrict', 'all']);
  });

  it('leaves out a step that does not apply', () => {
    expect(L.plan(env(), st({ rule: { ads: 'off', cookies: 'off' } }))).toEqual(['restrict']);
    expect(L.plan(env({ adsGlobalOn: false }), st())).toEqual([]);
    expect(L.plan(env({ hasBoost: true }), st({ boostPaused: true }))).toEqual(['ads']);
  });

  it('offers a combination only when two or more steps apply', () => {
    expect(L.plan(env(), st())).toEqual(['ads']);
    expect(L.plan(env({ hasBoost: true }), st())).toEqual(['ads', 'modifiers', 'all']);
  });

  it('skips the browser identity step while there is no per-site identity', () => {
    expect(L.plan(env({ hasBoost: true }), st())).not.toContain('useragent');
    expect(L.plan(env({ siteUserAgent: true }), st())).toContain('useragent');
  });

  it('forced dark mode counts as a modifier, the older global setting does not', () => {
    expect(L.plan(env({ adsGlobalOn: false }), st({ dark: true }))).toEqual(['modifiers']);
    expect(L.plan(env({ adsGlobalOn: false, darkGlobal: true }), st({ dark: true }))).toEqual([]);
  });
});

describe('Tor and private tabs', () => {
  it('offer no step at all and say why', () => {
    expect(L.plan(env({ tor: true }), st())).toEqual([]);
    expect(L.blockedReason(env({ tor: true }))).toMatch(/anonymity/);
    expect(L.plan(env({ privateWindow: true }), st())).toEqual([]);
    expect(L.plan(env({ canSave: false }), st())).toEqual([]);
    expect(L.blockedReason(env())).toBe('');
  });
});

describe('applying, scoping and putting back', () => {
  const before = st({ rule: { js: 'off', thirdParty: 'off' }, dark: true });

  it('each step changes only its own part and never mutates the input', () => {
    const snapshot = JSON.stringify(before);
    const ads = L.apply(before, 'ads', env());
    expect(ads.rule).toEqual({ js: 'off', thirdParty: 'off', ads: 'off' });
    const mods = L.apply(before, 'modifiers', env());
    expect(mods.dark).toBe(false);
    expect(mods.boostPaused).toBe(true);
    expect(mods.rule).toEqual(before.rule);
    const restrict = L.apply(before, 'restrict', env());
    expect(restrict.rule).toEqual({});
    expect(restrict.dark).toBe(true);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('refuses a step it does not know', () => {
    expect(() => L.apply(before, 'nonsense', env())).toThrow(/Unknown step/);
  });

  it('"all" relaxes every step that applied and tightening it puts all of it back', () => {
    const e = env({ hasBoost: true });
    const all = L.apply(before, 'all', e);
    expect(all).toEqual({ rule: { ads: 'off' }, boostPaused: true, dark: false });
    expect(L.tighten(all, before, 'all')).toEqual(st({ rule: { js: 'off', thirdParty: 'off' }, dark: true }));
  });

  it('tightening one step leaves the others relaxed', () => {
    const e = env({ hasBoost: true });
    const all = L.apply(before, 'all', e);
    const t = L.tighten(all, before, 'restrict');
    expect(t.rule).toEqual({ ads: 'off', js: 'off', thirdParty: 'off' });
    expect(t.boostPaused).toBe(true);
  });

  it('lists every relaxation in words, naming the one site', () => {
    const e = env({ hasBoost: true });
    const rows = L.relaxations(before, L.apply(before, 'all', e), 'example.com');
    expect(rows.map(r => r.step)).toEqual(['ads', 'modifiers', 'restrict']);
    expect(rows.every(r => r.text.includes('example.com'))).toBe(true);
    expect(L.relaxations(before, before, 'example.com')).toEqual([]);
    const three = st({ rule: { js: 'off', cookies: 'off', thirdParty: 'off' } });
    expect(L.relaxations(three, st(), 'example.com')[0].text)
      .toBe('JavaScript, cookies, content from other sites allowed again for example.com');
  });
});

describe('which rule it changes', () => {
  it('uses the host\'s own rule, or the parent domain\'s that governs it, else the host', () => {
    expect(L.governingKey({ 'example.com': { js: 'off' } }, 'shop.example.com')).toBe('example.com');
    expect(L.governingKey({ 'example.com': {}, 'shop.example.com': {} }, 'shop.example.com')).toBe('shop.example.com');
    expect(L.governingKey({ 'other.com': {} }, 'example.com')).toBe('example.com');
    expect(L.governingKey({ 'ample.com': {} }, 'example.com')).toBe('example.com');
  });
});

describe('the kept list', () => {
  const entry = (n, at) => ({ key: 'h' + n + '.com', at, steps: ['ads'], prev: st() });

  it('is bounded: the oldest fixes go when it is full', () => {
    let fixes = {};
    for (let i = 0; i < L.MAX_FIXES + 10; i++) fixes = L.remember(fixes, 'h' + i + '.com', entry(i, 1000 + i));
    const hosts = Object.keys(fixes);
    expect(hosts.length).toBe(L.MAX_FIXES);
    expect(hosts).not.toContain('h0.com');
    expect(hosts).toContain('h' + (L.MAX_FIXES + 9) + '.com');
  });

  it('keeps one entry per host and forgets one', () => {
    let fixes = L.remember({}, 'a.com', entry(1, 1));
    fixes = L.remember(fixes, 'a.com', { ...entry(1, 2), steps: ['restrict'] });
    expect(Object.keys(fixes)).toEqual(['a.com']);
    expect(fixes['a.com'].steps).toEqual(['restrict']);
    expect(L.forget(fixes, 'a.com')).toEqual({});
  });

  it('drops malformed rows and values it does not know', () => {
    const clean = L.cleanFixes({
      'bad host!': entry(1, 1),
      'ok.com': { key: 'ok.com', at: 5, steps: ['ads', 'bogus'], prev: { rule: { js: 'off', evil: 'off', ads: 'on' }, boostPaused: 1, dark: 0 } },
      'empty.com': { key: 'empty.com', at: 5, steps: [], prev: st() },
      'junk.com': 'x',
    });
    expect(Object.keys(clean)).toEqual(['ok.com']);
    expect(clean['ok.com'].steps).toEqual(['ads']);
    expect(clean['ok.com'].prev).toEqual({ rule: { js: 'off' }, boostPaused: true, dark: false });
    expect(L.cleanFixes(null)).toEqual({});
  });

  it('turns "all" into the steps that applied', () => {
    expect(L.stepsOf('all', env({ hasBoost: true }), st())).toEqual(['ads', 'modifiers']);
    expect(L.stepsOf('ads', env(), st())).toEqual(['ads']);
  });
});

describe('the report to myself', () => {
  it('says which site and what fixed it, and nothing else', () => {
    const t = L.reportText('example.com', ['ads', 'restrict']);
    expect(t).toMatch(/^example\.com did not work properly in Vex/);
    expect(t).toMatch(/allowing ads and trackers on this site and allowing what its rules had turned off/);
  });
});
