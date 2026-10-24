// @vitest-environment jsdom
//
// "All of Vex through one route" — what people mean by a VPN, and the check
// that says whether it is really working. Verified live against a local proxy
// (the proxy saw the traffic) and against Tor (the internet saw an exit node);
// these are the parts worth pinning down without a network.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Close buttons and ticks are VexIcons SVGs (sweep 2026-09-29).
require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
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

describe('asking before everything goes through Tor or a proxy', () => {
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const wait = () => new Promise((r) => setTimeout(r, 20));

  it('a click on the Tor card changes nothing until it is confirmed', async () => {
    window.vexConfirm = vi.fn(async () => false);
    const el = await PrivateRouting.open();
    click(el.querySelector('.vexroute-opt[data-mode="tor"]'));
    await wait();
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vexConfirm.mock.calls[0][0].title).toBe('Send everything through Tor?');
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/stays on after you close Tor or restart Vex/);
    expect(calls).toEqual([]);
    expect(el.querySelector('#vexroute-result').textContent).toBe('Nothing was changed.');
    expect(document.getElementById('btn-routing').hidden).toBe(true);
  });
  it('goes through Tor once it is confirmed', async () => {
    window.vexConfirm = vi.fn(async () => true);
    const el = await PrivateRouting.open();
    click(el.querySelector('.vexroute-opt[data-mode="tor"]'));
    await wait();
    expect(calls).toEqual([['tor', null]]);
  });
  it('asks about a proxy in its own words, and does nothing when declined', async () => {
    window.vexConfirm = vi.fn(async () => false);
    const el = await PrivateRouting.open();
    el.querySelector('#vexroute-proxy').value = 'socks5://127.0.0.1:1080';
    click(el.querySelector('button[data-mode="proxy"]'));
    await wait();
    expect(window.vexConfirm.mock.calls[0][0].title).toBe('Send everything through your proxy?');
    expect(window.vexConfirm.mock.calls[0][0].okLabel).toBe('Use the proxy');
    expect(calls).toEqual([]);
  });
  it('going back to direct needs no question', async () => {
    window.vexConfirm = vi.fn(async () => false);
    window.vex.routingGetAll = async () => ({ mode: 'tor' });
    const el = await PrivateRouting.open();
    click(el.querySelector('.vexroute-opt[data-mode="direct"]'));
    await wait();
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(calls).toEqual([['direct', null]]);
  });
  it('says so when the confirmation box is missing, and does not switch', async () => {
    delete window.vexConfirm;
    const el = await PrivateRouting.open();
    click(el.querySelector('.vexroute-opt[data-mode="tor"]'));
    await wait();
    expect(calls).toEqual([]);
    expect(el.querySelector('#vexroute-result').textContent).toMatch(/confirmation box is not available/);
  });
});

describe('a saved route is announced at every start', () => {
  beforeEach(() => { window.showToast = vi.fn(); localStorage.clear(); delete globalThis.VexI18nUI; });
  it('says everything is going through Tor, since when, and offers the way back', async () => {
    window.vex.routingGetAll = async () => ({ mode: 'tor', at: new Date(2026, 9, 12).getTime() });
    await PrivateRouting.init();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    const [text, kind, ms, opts] = window.showToast.mock.calls[0];
    expect(text).toMatch(/^Everything in Vex is going through Tor, as you set it on .*12/);
    expect(kind).toBe('info');
    expect(ms).toBeGreaterThanOrEqual(10000);
    expect(opts.action.label).toBe('Go direct');
    opts.action.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([['direct', null]]);
  });
  it('names a proxy as a proxy', async () => {
    window.vex.routingGetAll = async () => ({ mode: 'proxy', custom: 'socks5://127.0.0.1:1080' });
    await PrivateRouting.init();
    expect(window.showToast.mock.calls[0][0]).toBe('Everything in Vex is going through your proxy, as you set it.');
  });
  it('says nothing when nothing is routed', async () => {
    await PrivateRouting.init();
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('speaks Turkish when Vex is set to Turkish', async () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    globalThis.VexI18nUI = require('../../src/renderer/js/i18n-ui.js').VexI18nUI;
    window.vex.routingGetAll = async () => ({ mode: 'tor' });
    await PrivateRouting.init();
    const [text, , , opts] = window.showToast.mock.calls[0];
    expect(text).toBe('Vex’teki her şey, sizin ayarladığınız gibi Tor üzerinden gidiyor.');
    expect(opts.action.label).toBe('Doğrudan bağlan');
  });
});
