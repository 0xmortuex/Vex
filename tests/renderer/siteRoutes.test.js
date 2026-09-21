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
    expect(() => SiteRoutes.add('example.com', 'sideways')).toThrow(/through Tor, through a proxy, or in a container/);
  });

  it('covers subdomains, and only its own domain', () => {
    SiteRoutes.add('example.com', 'tor');
    expect(SiteRoutes.match('https://example.com/x').host).toBe('example.com');
    expect(SiteRoutes.match('https://mail.example.com/x').host).toBe('example.com');
    expect(SiteRoutes.match('https://notexample.com/x')).toBe(null);
    expect(SiteRoutes.match('https://example.com.evil.test/x')).toBe(null);
  });

  // The rule people actually want most is not about an IP address at all:
  // this site always opens in my work container, two accounts, no signing out.
  it('can open a site in a container, which is a cookie jar and not a route', () => {
    const r = SiteRoutes.add('mail.google.com', 'container', 'Work Email');
    expect(r.container).toBe('work-email');
    expect(SiteRoutes.partitionFor(r)).toBe('persist:container-work-email');
    // The same partition a "new work-email container tab" would use — one
    // container, not two lookalikes.
    expect(SiteRoutes.reroute('https://mail.google.com/', 'persist:main')).toBe('persist:container-work-email');
    // There is no route to arm on a cookie jar.
    expect(window.vex.routingSet).not.toHaveBeenCalled();
    expect(() => SiteRoutes.add('x.test', 'container', '   ')).toThrow(/Give the container a name/);
  });

  it('carries the two switches, and they can be flipped afterwards', () => {
    const r = SiteRoutes.add('news.test', 'container', 'reading', { muted: true });
    expect(r).toMatchObject({ muted: true, awake: false });
    SiteRoutes.setFlag('news.test', 'awake', true);
    expect(SiteRoutes.rules()[0]).toMatchObject({ muted: true, awake: true });
    SiteRoutes.setFlag('news.test', 'muted', false);
    expect(SiteRoutes.rules()[0].muted).toBe(false);
    expect(() => SiteRoutes.setFlag('news.test', 'colour', true)).toThrow(/muted or kept awake/);
    expect(() => SiteRoutes.setFlag('nothing.test', 'muted', true)).toThrow(/no rule for/);
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
    localStorage.setItem('vex.siteRoutes', JSON.stringify([{ host: 'ok.test', mode: 'tor' }, { host: 5 }, { mode: 'tor' }, { host: 'x.test', mode: 'sideways' }, null]));
    expect(SiteRoutes.rules()).toEqual([{ host: 'ok.test', mode: 'tor', custom: null, container: null, muted: false, awake: false }]);
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
    document.querySelector('#sr-where').value = 'work';
    document.querySelector('#sr-add').click();
    expect(SiteRoutes.rules().map(r => r.host).sort()).toEqual(['example.com', 'second.test']);
    [...document.querySelectorAll('.vexsr-rule .vexsr-x')].find(b => b.textContent === 'Remove').click();
    expect(SiteRoutes.rules()).toHaveLength(1);
  });

  it('says what is wrong instead of saving nonsense', () => {
    SiteRoutes.open();
    document.querySelector('#sr-host').value = 'not a site';
    document.querySelector('#sr-add').click();
    expect(document.querySelector('#sr-msg').textContent).toMatch(/not a web address/);
    expect(SiteRoutes.rules()).toEqual([]);
  });

  // One box for "where", because each mode needs exactly one name and three
  // separate boxes would be two empty ones.
  it('asks where, except for Tor, which has nowhere to ask about', () => {
    SiteRoutes.open();
    const where = document.querySelector('#sr-where');
    const mode = document.querySelector('#sr-mode');
    expect(where.hidden).toBe(false);
    expect(where.placeholder).toBe('work');          // container is the default
    mode.value = 'proxy'; mode.dispatchEvent(new Event('change'));
    expect(where.placeholder).toMatch(/socks5/);
    mode.value = 'tor'; mode.dispatchEvent(new Event('change'));
    expect(where.hidden).toBe(true);
  });

  it('the switches are on each row and say when they are on', () => {
    SiteRoutes.add('news.test', 'tor');
    SiteRoutes.open();
    const mute = document.querySelector('.vexsr-rule [data-flag="muted"]');
    expect(mute.classList.contains('on')).toBe(false);
    mute.click();
    expect(SiteRoutes.rules()[0].muted).toBe(true);
    expect(document.querySelector('.vexsr-rule [data-flag="muted"]').classList.contains('on')).toBe(true);
    expect(document.querySelector('#sr-list').textContent).toMatch(/muted/);
  });
});

// A container tab and an ordinary one looked identical, which is how a
// password goes into the wrong one: the isolation is the whole feature and it
// was invisible. The words and the marker come from one place so they cannot
// describe a tab as two different things.
describe('saying which session a tab is in', () => {
  const cases = [
    ['persist:main', '', ''],
    [null, '', ''],
    ['persist:route-tor', 'routed-tor', /through Tor/],
    ['persist:route-proxy-a1', 'routed-proxy', /through your proxy/],
    ['persist:container-work', 'container-tab', /“work” container/],
    ['tor-9', 'routed-tor', /through Tor/],
    ['private-4', '', /forgets everything/],
  ];
  it('names the session and marks it, for every kind of tab', () => {
    for (const [partition, marker, words] of cases) {
      expect(SiteRoutes.markerFor({ partition })).toBe(marker);
      if (words) expect(SiteRoutes.describe({ partition })).toMatch(words);
      else expect(SiteRoutes.describe({ partition })).toBe('');
    }
  });
});

describe('how a ruled tab behaves once it is open', () => {
  const tab = (o) => ({ id: 't1', url: 'https://news.test/', muted: false, keepAwakeUntil: 0, ...o });

  beforeEach(() => {
    globalThis.WebviewManager = { webviews: new Map() };
    globalThis.TabManager = { renderTabUpdate: vi.fn() };
  });

  it('mutes it and keeps it awake when the rule says so', () => {
    SiteRoutes.add('news.test', 'tor', null, { muted: true, awake: true });
    const setAudioMuted = vi.fn();
    const t = tab();
    WebviewManager.webviews.set('t1', { setAudioMuted });
    expect(SiteRoutes.applyTo(t)).toEqual(['muted', 'kept awake']);
    expect(setAudioMuted).toHaveBeenCalledWith(true);
    expect(t.muted).toBe(true);
    expect(t.keepAwakeUntil).toBe(Number.MAX_SAFE_INTEGER);
    expect(TabManager.renderTabUpdate).toHaveBeenCalled();
  });

  it('does nothing for a site with no rule, or a rule with neither switch', () => {
    expect(SiteRoutes.applyTo(tab())).toBe(null);
    SiteRoutes.add('news.test', 'tor');
    expect(SiteRoutes.applyTo(tab())).toBe(null);
  });

  // Unmuting a tab by hand must stick: the rule is not allowed to fight you
  // every time the page navigates within itself.
  it('does not re-mute a tab that is already muted', () => {
    SiteRoutes.add('news.test', 'tor', null, { muted: true });
    const setAudioMuted = vi.fn();
    WebviewManager.webviews.set('t1', { setAudioMuted });
    expect(SiteRoutes.applyTo(tab({ muted: true }))).toBe(null);
    expect(setAudioMuted).not.toHaveBeenCalled();
  });
});
