// @vitest-environment node
//
// The rules of the Unblock centre (src/main/unblock.js), with fakes: when a failed load is worth offering help for,
// the order the ways are tried in, what is remembered per site, and that a way that needs administrator rights is
// only ever listed.

import { describe, it, expect, vi } from 'vitest';
const U = require('../../src/main/unblock.js');

function method(id, over = {}) {
  return {
    id, label: id, note: id,
    available: vi.fn(async () => ({ ok: true })),
    find: vi.fn(async (host, test) => {
      const route = { kind: 'http', port: 4000 + id.length };
      return (await test(route)).ok ? { route } : null;
    }),
    restore: vi.fn(async () => ({ kind: 'http', port: 5000 })),
    releaseIfUnused: vi.fn(async () => {}),
    ...over,
  };
}

function build(over = {}) {
  const methods = over.methods || [method('doh'), method('light'), method('byedpi'), method('admin', { adminOnly: true, find: vi.fn(async () => { throw new Error('must never run'); }) })];
  const clock = { t: 1_000_000 };
  const applied = [];
  const deps = {
    methods,
    request: vi.fn(async (host, route) => (over.request ? over.request(host, route) : { ok: !!route && route.port !== 0 })),
    control: vi.fn(async () => over.control || { ok: true }),
    resolveHost: vi.fn(async () => (over.resolve === undefined ? '1.2.3.4' : over.resolve)),
    applyRoutes: vi.fn((r) => applied.push(r)),
    isRouted: over.isRouted,
    now: () => clock.t,
  };
  const u = U.createUnblock(deps);
  return { u, deps, methods, clock, applied };
}

describe('what looks like a block', () => {
  it('is a reset, a closed or timed-out connection, a cut handshake, an empty answer or an unresolved name', () => {
    for (const c of [-100, -101, -105, -107, -118, -324]) expect(U.looksBlocked(c), String(c)).toBe(true);
  });
  it('is not a cancelled load, a certificate error, a refused connection or an http error', () => {
    for (const c of [-3, -102, -200, -201, -202, -300, 0, 404, NaN]) expect(U.looksBlocked(c), String(c)).toBe(false);
  });
});

describe('site names', () => {
  it('www. and the dot at the end are dropped, case is folded', () => {
    expect(U.normalizeHost('WWW.Example.COM.')).toBe('example.com');
    expect(U.normalizeHost('https://www.news.example.org/a?b')).toBe('news.example.org');
  });
  it('refuses a computer on this network, an address and anything that could break a PAC script', () => {
    for (const bad of ['', 'localhost', '10.0.0.1', "a'b.com", 'a.com/../x', 'printer.local', 'nodots', 'a b.com']) expect(() => U.normalizeHost(bad), bad).toThrow();
  });
});

describe('assess: is it worth offering', () => {
  const failed = { url: 'https://blocked.example.com/page', code: -101, partition: 'persist:main', isPrivate: false };

  it('offers for a reset on an ordinary tab when the network is up and the site exists', async () => {
    const { u, deps } = build();
    expect(await u.assess(failed)).toEqual({ suggest: true, host: 'blocked.example.com', dns: false });
    expect(deps.control).toHaveBeenCalledTimes(1);
    expect(deps.resolveHost).toHaveBeenCalledWith('blocked.example.com');
  });
  it('says a name that did not resolve is a DNS case', async () => {
    const { u } = build();
    expect((await u.assess({ ...failed, code: -105 })).dns).toBe(true);
  });
  it('never in a private window, and the network is not even asked', async () => {
    const { u, deps } = build();
    expect(await u.assess({ ...failed, isPrivate: true })).toEqual({ suggest: false, reason: 'private' });
    expect(deps.control).not.toHaveBeenCalled();
    expect(deps.resolveHost).not.toHaveBeenCalled();
  });
  it('never in a Tor tab, a burner tab, a site route or another panel', async () => {
    const { u, deps } = build();
    for (const partition of ['tor-123', 'private-9', 'persist:route-tor', 'persist:route-proxy-abc', 'persist:discord', 'persist:roblox', 'persist:container-x']) {
      expect((await u.assess({ ...failed, partition })).reason, partition).toBe('session');
    }
    expect(deps.control).not.toHaveBeenCalled();
  });
  it('never in a session that already goes through Tor or a proxy of the person', async () => {
    const { u, deps } = build({ isRouted: () => true });
    expect((await u.assess(failed)).reason).toBe('session-routed');
    expect(deps.control).not.toHaveBeenCalled();
  });
  it('allows the ordinary containers', async () => {
    const { u } = build();
    const partitions = ['persist:main', 'persist:container-work', 'persist:container-personal', 'persist:container-shopping', null];
    for (let i = 0; i < partitions.length; i++) {
      expect((await u.assess({ ...failed, url: 'https://x' + i + '.example.com/', partition: partitions[i] })).suggest, String(partitions[i])).toBe(true);
    }
  });
  it('only for blocking-looking errors, only https, only real sites', async () => {
    const { u, deps } = build();
    expect((await u.assess({ ...failed, code: -200 })).reason).toBe('error');
    expect((await u.assess({ ...failed, url: 'http://blocked.example.com/' })).reason).toBe('address');
    expect((await u.assess({ ...failed, url: 'https://192.168.1.1/' })).reason).toBe('address');
    expect((await u.assess({ ...failed, url: 'https://intranet.local/' })).reason).toBe('address');
    expect(deps.control).not.toHaveBeenCalled();
  });
  it('not while the network itself is down (that is being offline, not a block)', async () => {
    const { u, deps } = build({ control: { ok: false } });
    expect((await u.assess(failed)).reason).toBe('offline');
    expect(deps.resolveHost).not.toHaveBeenCalled();
  });
  it('not for a name that does not exist (a typo is not a block)', async () => {
    const { u } = build({ resolve: null });
    expect((await u.assess({ ...failed, code: -105 })).reason).toBe('unknown-site');
  });
  it('once per site per hour, then again', async () => {
    const { u, clock, deps } = build();
    expect((await u.assess(failed)).suggest).toBe(true);
    expect((await u.assess(failed)).reason).toBe('recently');
    clock.t += 59 * 60 * 1000;
    expect((await u.assess(failed)).reason).toBe('recently');
    clock.t += 2 * 60 * 1000;
    expect((await u.assess(failed)).suggest).toBe(true);
    expect(deps.control).toHaveBeenCalledTimes(2);
    // a different site is its own count
    expect((await u.assess({ ...failed, url: 'https://other.example.com/' })).suggest).toBe(true);
  });
  it('the hour counts from the offer even when a later check says no, so a flapping network is not polled', async () => {
    const { u, deps } = build({ control: { ok: false } });
    await u.assess(failed);
    await u.assess(failed);
    expect(deps.control).toHaveBeenCalledTimes(1);
  });
  it('not for a site marked Never, and not for one that is already on', async () => {
    const { u } = build();
    await u.sync({ enabled: true, sites: [{ host: 'blocked.example.com', mode: 'never' }] });
    expect((await u.assess(failed)).reason).toBe('never');
    const b = build();
    await b.u.try('blocked.example.com');
    expect((await b.u.assess(failed)).reason).toBe('routed');
  });
  it('not at all while the feature is off', async () => {
    const { u, deps } = build();
    await u.sync({ enabled: false, sites: [] });
    expect((await u.assess(failed)).reason).toBe('off');
    expect(deps.control).not.toHaveBeenCalled();
  });
});

describe('try: the ways, in order', () => {
  it('opens directly first: if the site answers now, no way is started', async () => {
    const { u, methods } = build({ request: () => ({ ok: true }) });
    expect(await u.try('example.com')).toMatchObject({ ok: true, direct: true });
    for (const m of methods) expect(m.find).not.toHaveBeenCalled();
  });

  it('tries doh, then light, then byedpi, and stops at the first that opens the site', async () => {
    const methods = [method('doh', { find: vi.fn(async () => null) }), method('light', { find: vi.fn(async () => null) }), method('byedpi'), method('admin', { adminOnly: true })];
    const { u, applied } = build({ methods });
    const r = await u.try('example.com');
    expect(r).toMatchObject({ ok: true, method: 'byedpi' });
    expect(r.steps.map(s => [s.id, s.ok === true ? 'ok' : s.ok === false ? 'no' : s.skipped])).toEqual([['doh', 'no'], ['light', 'no'], ['byedpi', 'ok']]);
    expect(applied.at(-1)).toEqual([{ host: 'example.com', route: { kind: 'http', port: 4000 + 'byedpi'.length } }]);
  });

  it('the first way that works is the one used, and the later ones are never started', async () => {
    const { u, methods } = build();
    const r = await u.try('example.com');
    expect(r.method).toBe('doh');
    expect(methods[1].find).not.toHaveBeenCalled();
    expect(methods[2].find).not.toHaveBeenCalled();
  });

  it('a way that needs administrator rights is listed and never run, even when nothing else works', async () => {
    const methods = [method('doh', { find: vi.fn(async () => null) }), method('admin', { adminOnly: true, find: vi.fn(async () => { throw new Error('must never run'); }), available: vi.fn(), restore: vi.fn() })];
    const { u } = build({ methods });
    const r = await u.try('example.com');
    expect(r.ok).toBe(false);
    expect(r.steps.at(-1)).toMatchObject({ id: 'admin', skipped: 'admin' });
    expect(methods[1].find).not.toHaveBeenCalled();
    expect(methods[1].available).not.toHaveBeenCalled();
  });

  it('a way that throws is reported with its message, and the next one is tried', async () => {
    const methods = [method('doh', { find: vi.fn(async () => { throw new Error('the port was taken'); }) }), method('light')];
    const { u } = build({ methods });
    const r = await u.try('example.com');
    expect(r.steps[0]).toEqual({ id: 'doh', label: 'doh', ok: false, error: 'the port was taken' });
    expect(r.method).toBe('light');
  });

  it('a way that is not available is skipped with its reason; one that needs a download says so', async () => {
    const methods = [
      method('doh', { available: vi.fn(async () => ({ ok: false, reason: 'no port' })) }),
      method('byedpi', { available: vi.fn(async () => ({ ok: false, needsDownload: true, reason: 'not on this computer' })) }),
    ];
    const { u } = build({ methods, request: () => ({ ok: false }) });
    const r = await u.try('example.com');
    expect(r.ok).toBe(false);
    expect(r.needsDownload).toBe(true);
    expect(r.steps).toEqual([
      { id: 'doh', label: 'doh', skipped: 'unavailable', error: 'no port' },
      { id: 'byedpi', label: 'byedpi', skipped: 'download', error: 'not on this computer' },
    ]);
    expect(methods[1].find).not.toHaveBeenCalled();
  });

  it('the download is only allowed when the person said yes', async () => {
    const m = method('byedpi', { available: vi.fn(async ({ allowDownload }) => (allowDownload ? { ok: true } : { ok: false, needsDownload: true })) });
    const { u } = build({ methods: [m] });
    expect((await u.try('example.com')).needsDownload).toBe(true);
    expect((await u.try('example.com', { allowDownload: true })).ok).toBe(true);
  });

  it('the recorded way goes first when asked', async () => {
    const { u, methods } = build();
    const r = await u.try('example.com', { prefer: 'light' });
    expect(r.method).toBe('light');
    expect(methods[0].find).not.toHaveBeenCalled();
  });

  it('keep:false only reports: nothing is switched on', async () => {
    const { u, applied } = build();
    expect((await u.try('example.com', { keep: false })).ok).toBe(true);
    expect(applied).toEqual([]);
    expect(u.isActive('example.com')).toBe(false);
  });

  it('what no way opened leaves nothing on, and helpers nobody uses are released', async () => {
    const { u, methods } = build({ request: (h, route) => ({ ok: false }) });
    const r = await u.try('example.com');
    expect(r.ok).toBe(false);
    expect(u.routes()).toEqual([]);
    for (const m of methods.filter(x => !x.adminOnly)) expect(m.releaseIfUnused).toHaveBeenCalledWith(0);
  });

  it('the test request goes to the site through the candidate route only', async () => {
    const { u, deps } = build();
    await u.try('www.example.com');
    expect(deps.request.mock.calls[0]).toEqual(['example.com', null]);
    expect(deps.request.mock.calls[1][0]).toBe('example.com');
    expect(deps.request.mock.calls[1][1]).toMatchObject({ kind: 'http' });
  });
});

describe('per-site memory and the list', () => {
  const site = (host, mode, method = 'doh', preset = null) => ({ host, mode, method, preset });

  it('"always" with a way is switched on again at start, through that way\'s own restore', async () => {
    const { u, methods, applied } = build();
    const st = await u.sync({ enabled: true, sites: [site('a.example.com', 'always', 'light')] });
    expect(methods[1].restore).toHaveBeenCalledWith({ host: 'a.example.com', preset: null });
    expect(st.active).toEqual([{ host: 'a.example.com', method: 'light', preset: null }]);
    expect(applied.at(-1)).toHaveLength(1);
  });
  it('a preset is handed back to the way that needs it', async () => {
    const { u, methods } = build();
    await u.sync({ enabled: true, sites: [site('a.example.com', 'always', 'byedpi', 3)] });
    expect(methods[2].restore).toHaveBeenCalledWith({ host: 'a.example.com', preset: 3 });
  });
  it('"ask" (switched off), "never" and "once" that nothing opened this run are not started', async () => {
    const { u, methods } = build();
    const st = await u.sync({ enabled: true, sites: [site('a.example.com', 'ask'), site('b.example.com', 'never', null), site('c.example.com', 'once')] });
    expect(st.active).toEqual([]);
    for (const m of methods) expect(m.restore).not.toHaveBeenCalled();
  });
  it('a site a Try opened stays on for this run as "once" and is gone when switched to "ask"', async () => {
    const { u } = build();
    await u.try('a.example.com');
    expect((await u.sync({ enabled: true, sites: [site('a.example.com', 'once')] })).active.map(a => a.host)).toEqual(['a.example.com']);
    expect((await u.sync({ enabled: true, sites: [site('a.example.com', 'ask')] })).active).toEqual([]);
    expect(u.routes()).toEqual([]);
  });
  it('forgetting a site (it is not in the list any more) switches it off', async () => {
    const { u } = build();
    await u.sync({ enabled: true, sites: [site('a.example.com', 'always')] });
    expect((await u.sync({ enabled: true, sites: [] })).active).toEqual([]);
  });
  it('the global switch off switches every site off and keeps nothing running', async () => {
    const { u, methods } = build();
    await u.sync({ enabled: true, sites: [site('a.example.com', 'always'), site('b.example.com', 'always')] });
    const st = await u.sync({ enabled: false, sites: [site('a.example.com', 'always'), site('b.example.com', 'always')] });
    expect(st.active).toEqual([]);
    expect(st.enabled).toBe(false);
    expect(methods[0].releaseIfUnused).toHaveBeenLastCalledWith(0);
  });
  it('a site that cannot be switched on is reported with the reason, not hidden, and the rest still start', async () => {
    const methods = [method('doh', { restore: vi.fn(async () => { throw new Error('The ByeDPI helper is not on this computer'); }) }), method('light')];
    const { u } = build({ methods });
    const st = await u.sync({ enabled: true, sites: [site('a.example.com', 'always', 'doh'), site('b.example.com', 'always', 'light')] });
    expect(st.errors).toEqual({ 'a.example.com': 'The ByeDPI helper is not on this computer' });
    expect(st.active.map(a => a.host)).toEqual(['b.example.com']);
  });
  it('a recorded way that is not there (or needs admin) is an error for that site', async () => {
    const { u } = build();
    const st = await u.sync({ enabled: true, sites: [site('a.example.com', 'always', 'admin')] });
    expect(Object.keys(st.errors)).toEqual(['a.example.com']);
    expect(st.active).toEqual([]);
  });
  it('refuses a list it cannot read', async () => {
    const { u } = build();
    await expect(u.sync(null)).rejects.toThrow(/sync needs/);
    await expect(u.sync({ enabled: true, sites: [{ host: 'a.example.com', mode: 'sometimes' }] })).rejects.toThrow(/Unknown mode/);
    await expect(u.sync({ enabled: true, sites: [{ host: "a'b", mode: 'ask' }] })).rejects.toThrow();
  });
  it('stopAll switches every site off and lets the helpers go', async () => {
    const { u, methods, applied } = build();
    await u.sync({ enabled: true, sites: [site('a.example.com', 'always')] });
    await u.stopAll();
    expect(u.routes()).toEqual([]);
    expect(applied.at(-1)).toEqual([]);
    expect(methods[0].releaseIfUnused).toHaveBeenLastCalledWith(0);
  });
  it('a helper that moved takes its sites to the new port, and one that is gone sends them back to direct with a reason', async () => {
    const { u, applied } = build();
    await u.sync({ enabled: true, sites: [site('a.example.com', 'always', 'byedpi')] });
    u.methodPortChanged('byedpi', 7777);
    expect(applied.at(-1)[0].route.port).toBe(7777);
    u.methodPortChanged('byedpi', 0);
    expect(applied.at(-1)).toEqual([]);
    expect(u.status().errors['a.example.com']).toMatch(/helper stopped/);
  });
  it('jobs run one at a time (a helper process is shared)', async () => {
    let running = 0, max = 0;
    const slow = method('doh', { find: vi.fn(async () => { running++; max = Math.max(max, running); await new Promise(r => setTimeout(r, 15)); running--; return null; }) });
    const { u } = build({ methods: [slow], request: () => ({ ok: false }) });
    await Promise.all([u.try('a.example.com'), u.try('b.example.com'), u.try('c.example.com')]);
    expect(max).toBe(1);
  });
});

describe('the PAC script', () => {
  it('without sites and without Discord it sends everything direct', () => {
    expect(U.buildPac(0, [])).toBe("function FindProxyForURL(u,h){return 'DIRECT';}");
  });
  it('keeps the Discord rules when the bypass has a port', () => {
    expect(U.buildPac(1234, [])).toContain("return 'SOCKS5 127.0.0.1:1234';");
  });
  it('sends a site and its subdomains through their route, and falls back to direct if the helper is gone', () => {
    const pac = U.buildPac(0, [{ host: 'example.com', route: { kind: 'http', port: 4321 } }, { host: 'blocked.org', route: { kind: 'socks5', port: 99 } }]);
    expect(pac).toContain("h==='example.com'||dnsDomainIs(h,'.example.com'))return 'PROXY 127.0.0.1:4321; DIRECT';");
    expect(pac).toContain("return 'SOCKS5 127.0.0.1:99; DIRECT';");
    expect(() => new Function(pac + '; return FindProxyForURL;')).not.toThrow();
  });
  it('is real PAC: the right host gets the proxy and others do not', () => {
    const pac = U.buildPac(0, [{ host: 'example.com', route: { kind: 'http', port: 4321 } }]);
    const dnsDomainIs = (h, d) => h.endsWith(d);
    const find = new Function('dnsDomainIs', 'shExpMatch', pac + '; return FindProxyForURL;')(dnsDomainIs, () => false);
    expect(find('https://example.com/', 'example.com')).toBe('PROXY 127.0.0.1:4321; DIRECT');
    expect(find('https://a.example.com/', 'a.example.com')).toBe('PROXY 127.0.0.1:4321; DIRECT');
    expect(find('https://notexample.com/', 'notexample.com')).toBe('DIRECT');
  });
  it('refuses a host or a port that could break the script', () => {
    expect(() => U.buildPac(0, [{ host: "x');evil();('", route: { kind: 'http', port: 1 } }])).toThrow();
    expect(() => U.buildPac(0, [{ host: 'a.com', route: { kind: 'http', port: 0 } }])).toThrow();
    expect(() => U.buildPac(0, [{ host: 'a.com', route: { kind: 'ftp', port: 5 } }])).toThrow();
  });
});
