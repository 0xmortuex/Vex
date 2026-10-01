// @vitest-environment jsdom
//
// A site rule removed or replaced only rewrote the list: its route stayed
// saved in main, so Tor never stopped and started again on every launch
// (found 2026-09-30). The route of a partition no rule uses is now forgotten,
// and at start main is told which partitions the rules use.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
const { SiteRoutes } = require('../../src/renderer/js/site-routes.js');

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  SiteRoutes._armed = new Set();
  delete window.VexTabPolicy;
  window.vex = {
    routingSet: vi.fn(async () => ({ ok: true })),
    routingForget: vi.fn(async () => ({ ok: true })),
    routingPrune: vi.fn(async () => ({ ok: true, forgot: [] })),
  };
});

describe('letting go of a route', () => {
  it('removing the only Tor rule forgets persist:route-tor and disarms it', async () => {
    SiteRoutes.add('example.com', 'tor');
    await flush();
    expect(SiteRoutes._armed.has('persist:route-tor')).toBe(true);
    SiteRoutes.remove('example.com');
    expect(window.vex.routingForget).toHaveBeenCalledWith('persist:route-tor');
    expect(SiteRoutes._armed.has('persist:route-tor')).toBe(false);
  });

  it('keeps the route while another rule still uses it', () => {
    SiteRoutes.add('a.com', 'tor');
    SiteRoutes.add('b.com', 'tor');
    SiteRoutes.remove('a.com');
    expect(window.vex.routingForget).not.toHaveBeenCalled();
  });

  it('replacing a Tor rule with a container forgets the Tor route', () => {
    SiteRoutes.add('example.com', 'tor');
    SiteRoutes.add('example.com', 'container', 'work');
    expect(window.vex.routingForget).toHaveBeenCalledWith('persist:route-tor');
  });

  it('replacing a proxy rule with another proxy forgets the old one, not the new one', () => {
    SiteRoutes.add('example.com', 'proxy', 'socks5://127.0.0.1:1080');
    const oldPart = SiteRoutes.partitionFor(SiteRoutes.rules()[0]);
    SiteRoutes.add('example.com', 'proxy', 'socks5://127.0.0.1:1081');
    const newPart = SiteRoutes.partitionFor(SiteRoutes.rules()[0]);
    expect(oldPart).not.toBe(newPart);
    expect(window.vex.routingForget).toHaveBeenCalledWith(oldPart);
    expect(window.vex.routingForget).not.toHaveBeenCalledWith(newPart);
  });

  it('changing only a switch on a Tor rule forgets nothing', () => {
    SiteRoutes.add('example.com', 'tor');
    SiteRoutes.add('example.com', 'tor', null, { muted: true });
    expect(window.vex.routingForget).not.toHaveBeenCalled();
  });

  it('a route main could not forget is said', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.vex.routingForget = vi.fn(async () => ({ ok: false, error: 'disk full' }));
    SiteRoutes.add('example.com', 'tor');
    SiteRoutes.remove('example.com');
    await flush();
    expect(err.mock.calls.some(c => /could not be forgotten/.test(c[0]) && c[1] === 'disk full')).toBe(true);
    err.mockRestore();
  });
});

describe('at start', () => {
  it('tells main which partitions the rules use, then arms each once', () => {
    localStorage.setItem(SiteRoutes.KEY, JSON.stringify([
      { host: 'a.com', mode: 'tor' }, { host: 'b.com', mode: 'tor' },
      { host: 'c.com', mode: 'proxy', custom: 'socks5://127.0.0.1:1080' },
      { host: 'd.com', mode: 'container', container: 'work' },
    ]));
    SiteRoutes.armAll();
    const used = window.vex.routingPrune.mock.calls[0][0];
    expect(used).toContain('persist:route-tor');
    expect(used.some(p => /^persist:route-proxy-/.test(p))).toBe(true);
    expect(used).toHaveLength(2);
    expect(window.vex.routingSet).toHaveBeenCalledTimes(2);
  });

  it('with no rules, every saved site route is stale', () => {
    SiteRoutes.armAll();
    expect(window.vex.routingPrune).toHaveBeenCalledWith([]);
  });

  it('a private window leaves it to the main one', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    SiteRoutes.armAll();
    expect(window.vex.routingPrune).not.toHaveBeenCalled();
  });
});
