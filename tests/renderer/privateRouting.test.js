// @vitest-environment jsdom
//
// "All of Vex through one route" — what people mean by a VPN, and the check
// that says whether it is really working. Verified live against a local proxy
// (the proxy saw the traffic) and against Tor (the internet saw an exit node);
// these are the parts worth pinning down without a network.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { PrivateRouting } = require('../../src/renderer/js/private-routing.js');

let calls;

beforeEach(() => {
  document.body.innerHTML = '<button id="btn-routing" hidden></button>';
  calls = [];
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  window.vex = {
    routingGetAll: async () => ({ mode: 'direct' }),
    routingSetAll: async (mode, custom) => { calls.push([mode, custom]); return { ok: true, mode, custom }; },
    routingCheck: async () => ({ ok: true, ip: '185.220.101.1', directIp: '88.226.1.1', changed: true, ms: 658 }),
  };
  PrivateRouting.close();
});

describe('turning it on', () => {
  it('sends every session one way, in one call', async () => {
    await PrivateRouting.set('tor');
    expect(calls).toEqual([['tor', null]]);
  });

  it('refuses a proxy address that is not one, before anything is applied', async () => {
    await expect(PrivateRouting.set('proxy', 'my vpn')).rejects.toThrow(/looks like socks5/);
    await expect(PrivateRouting.set('proxy', '')).rejects.toThrow(/looks like socks5/);
    expect(calls).toEqual([]);
    await PrivateRouting.set('proxy', '  socks5://127.0.0.1:1080  ');
    expect(calls).toEqual([['proxy', 'socks5://127.0.0.1:1080']]);   // trimmed
  });

  it('passes main’s refusal straight through rather than claiming success', async () => {
    window.vex.routingSetAll = async () => ({ ok: false, error: 'Tor unavailable' });
    await expect(PrivateRouting.set('tor')).rejects.toThrow(/Tor unavailable/);
  });

  it('the toolbar says so while it is on, and stops when it is off', async () => {
    const btn = document.getElementById('btn-routing');
    await PrivateRouting.set('tor');
    expect(btn.hidden).toBe(false);
    expect(btn.title).toMatch(/through Tor/);
    await PrivateRouting.set('direct');
    expect(btn.hidden).toBe(true);
  });
});

describe('the check, in words', () => {
  const R = { ok: true, ip: '1.2.3.4', directIp: '9.9.9.9', changed: true, ms: 658 };

  it('a different address is the answer it is looking for', () => {
    expect(PrivateRouting.say(R, 'tor')).toMatch(/^Working: through the route the internet sees 1\.2\.3\.4, and without it 9\.9\.9\.9/);
  });

  it('nothing routed is not a failure, and is not called one', () => {
    const said = PrivateRouting.say({ ...R, directIp: '1.2.3.4', changed: false }, 'direct');
    expect(said).toMatch(/Nothing is routed/);
    expect(said).not.toMatch(/working/i);
  });

  it('the same address through a proxy is explained, not condemned', () => {
    // A proxy on your own machine is MEANT to come out at your own address.
    const said = PrivateRouting.say({ ...R, directIp: '1.2.3.4', changed: false }, 'proxy');
    expect(said).toMatch(/Traffic is going through it/);
    expect(said).toMatch(/your own machine or network/);
  });

  it('a refused connection says what it probably is', () => {
    expect(PrivateRouting.say({ ok: false, error: 'net::ERR_PROXY_CONNECTION_FAILED' }, 'proxy'))
      .toMatch(/refused the connection, or Tor has not finished starting/);
  });

  it('no comparison to make is said plainly', () => {
    expect(PrivateRouting.say({ ok: true, ip: '1.2.3.4', directIp: null, ms: 100 }, 'tor'))
      .toMatch(/nothing to compare it with/);
  });

  it('seconds rather than milliseconds once it is slow', () => {
    expect(PrivateRouting.say({ ...R, ms: 4200 }, 'tor')).toContain('(4.2 s)');
  });
});

describe('the screen', () => {
  it('offers the three routes and says what Vex is not', async () => {
    await PrivateRouting.open();
    const names = [...document.querySelectorAll('.vexroute-name')].map(e => e.textContent);
    expect(names).toEqual(['Direct', 'Through Tor', 'Through a proxy you name']);
    expect(document.querySelector('.vexroute-head p').textContent).toMatch(/not a VPN service/);
  });

  it('the check writes its answer into the screen', async () => {
    await PrivateRouting.open();
    window.vex.routingGetAll = async () => ({ mode: 'tor' });
    await PrivateRouting.check();
    expect(document.querySelector('#vexroute-result').textContent).toMatch(/^Working:/);
  });

  it('a check that throws says so instead of leaving "Asking…" on screen', async () => {
    await PrivateRouting.open();
    window.vex.routingCheck = async () => { throw new Error('no network'); };
    await PrivateRouting.check();
    expect(document.querySelector('#vexroute-result').textContent).toBe('no network');
  });
});
