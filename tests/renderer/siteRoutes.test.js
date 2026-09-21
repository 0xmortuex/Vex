// @vitest-environment jsdom
//
// "Always open these sites through Tor." A rule names a host and the route it
// must be opened through; Vex puts the tab in a session that carries that
// route. The two things worth pinning: a rule never moves a tab out of a
// container someone deliberately chose, and a rule for a domain covers its
// subdomains.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { SiteRoutes } = require('../../src/renderer/js/site-routes.js');
globalThis.SiteRoutes = SiteRoutes;

beforeEach(() => {
  localStorage.clear();
  SiteRoutes._armed = new Set();
  document.body.innerHTML = '';
  window.vex = { routingSet: vi.fn(async () => ({ ok: true })) };
  window.showToast = vi.fn();
});

describe('a rule', () => {
  it('takes a host however it was typed', () => {
    expect(SiteRoutes.add('https://www.Example.com/some/path?q=1', 'tor').host).toBe('example.com');
    expect(SiteRoutes.normalizeHost('  news.bbc.co.uk  ')).toBe('news.bbc.co.uk');
    expect(SiteRoutes.normalizeHost('localhost')).toBe('');
    expect(() => SiteRoutes.add('not a site', 'tor')).toThrow(/not a web address/);
    expect(() => SiteRoutes.add('example.com', 'proxy', 'nonsense')).toThrow(/socks5/);
    expect(() => SiteRoutes.add('example.com', 'sideways')).toThrow(/Tor or through a proxy/);
  });

  it('covers subdomains, and only its own domain', () => {
    SiteRoutes.add('example.com', 'tor');
    expect(SiteRoutes.match('https://example.com/x').host).toBe('example.com');
    expect(SiteRoutes.match('https://mail.example.com/x').host).toBe('example.com');
    expect(SiteRoutes.match('https://notexample.com/x')).toBe(null);
    expect(SiteRoutes.match('https://example.com.evil.test/x')).toBe(null);
  });

  it('replaces an earlier rule for the same host rather than stacking', () => {
    SiteRoutes.add('example.com', 'tor');
    SiteRoutes.add('example.com', 'proxy', 'socks5://127.0.0.1:1080');
    expect(SiteRoutes.rules()).toHaveLength(1);
    expect(SiteRoutes.rules()[0].mode).toBe('proxy');
    SiteRoutes.remove('www.example.com/');
    expect(SiteRoutes.rules()).toEqual([]);
  });

  it('survives rubbish in storage', () => {
    localStorage.setItem('vex.siteRoutes', '{oh dear');
    expect(SiteRoutes.rules()).toEqual([]);
    localStorage.setItem('vex.siteRoutes', JSON.stringify([{ host: 'ok.test', mode: 'tor' }, { host: 5 }, { mode: 'tor' }, null]));
    expect(SiteRoutes.rules()).toEqual([{ host: 'ok.test', mode: 'tor', custom: null }]);
  });
});

describe('which session a tab goes in', () => {
  it('moves an ordinary tab into the routed session and arms it', async () => {
    SiteRoutes.add('example.com', 'tor');
    expect(window.vex.routingSet).toHaveBeenCalledWith('persist:route-tor', 'tor', undefined);
    expect(SiteRoutes.reroute('https://example.com/', 'persist:main')).toBe('persist:route-tor');
    expect(SiteRoutes.reroute('https://example.com/', null)).toBe('persist:route-tor');
  });

  // A container was a deliberate choice; a rule must not quietly overrule it.
  it('leaves a container and a private tab exactly where they are', () => {
    SiteRoutes.add('example.com', 'tor');
    expect(SiteRoutes.reroute('https://example.com/', 'persist:container-work')).toBe('persist:container-work');
    expect(SiteRoutes.reroute('https://example.com/', 'private-9')).toBe('private-9');
  });

  it('leaves everything else alone', () => {
    SiteRoutes.add('example.com', 'tor');
    expect(SiteRoutes.reroute('https://other.test/', 'persist:main')).toBe('persist:main');
    expect(SiteRoutes.reroute('vex://start', 'persist:main')).toBe('persist:main');
  });

  // One Tor session shared by every Tor rule, one per distinct proxy.
  it('gives every rule with the same route the same session', () => {
    const tor = { mode: 'tor' };
    expect(SiteRoutes.partitionFor(tor)).toBe('persist:route-tor');
    const a = { mode: 'proxy', custom: 'socks5://127.0.0.1:1080' };
    const b = { mode: 'proxy', custom: 'socks5://127.0.0.1:1080' };
    const c = { mode: 'proxy', custom: 'socks5://127.0.0.1:9050' };
    expect(SiteRoutes.partitionFor(a)).toBe(SiteRoutes.partitionFor(b));
    expect(SiteRoutes.partitionFor(a)).not.toBe(SiteRoutes.partitionFor(c));
  });

  it('arms each distinct route once at startup, not once per rule', () => {
    localStorage.setItem('vex.siteRoutes', JSON.stringify([
      { host: 'a.test', mode: 'tor' }, { host: 'b.test', mode: 'tor' },
      { host: 'c.test', mode: 'proxy', custom: 'socks5://127.0.0.1:1080' },
    ]));
    SiteRoutes.armAll();
    expect(window.vex.routingSet).toHaveBeenCalledTimes(2);
  });

  // A route that could not be applied must not be remembered as applied, or
  // the next tab would go through a session nobody ever routed.
  it('forgets a route that failed, so the next attempt tries again', async () => {
    window.vex.routingSet = vi.fn(async () => ({ ok: false, error: 'Tor unavailable' }));
    const rule = { host: 'a.test', mode: 'tor', custom: null };
    await SiteRoutes.arm(rule);
    expect(SiteRoutes._armed.has('persist:route-tor')).toBe(false);
    await SiteRoutes.arm(rule);
    expect(window.vex.routingSet).toHaveBeenCalledTimes(2);
  });
});

describe('the rules screen', () => {
  it('lists the rules, adds one and removes one', () => {
    SiteRoutes.add('example.com', 'tor');
    SiteRoutes.open();
    expect(document.querySelector('#sr-list').textContent).toMatch(/example\.com/);
    document.querySelector('#sr-host').value = 'second.test';
    document.querySelector('#sr-add').click();
    expect(SiteRoutes.rules().map(r => r.host).sort()).toEqual(['example.com', 'second.test']);
    document.querySelectorAll('.vexsr-rule .vexsr-x')[0].click();
    expect(SiteRoutes.rules()).toHaveLength(1);
  });

  it('says what is wrong instead of saving nonsense', () => {
    SiteRoutes.open();
    document.querySelector('#sr-host').value = 'not a site';
    document.querySelector('#sr-add').click();
    expect(document.querySelector('#sr-msg').textContent).toMatch(/not a web address/);
    expect(SiteRoutes.rules()).toEqual([]);
  });

  it('asks for the proxy only when a proxy is what was chosen', () => {
    SiteRoutes.open();
    expect(document.querySelector('#sr-proxy').hidden).toBe(true);
    const mode = document.querySelector('#sr-mode');
    mode.value = 'proxy';
    mode.dispatchEvent(new Event('change'));
    expect(document.querySelector('#sr-proxy').hidden).toBe(false);
  });
});
