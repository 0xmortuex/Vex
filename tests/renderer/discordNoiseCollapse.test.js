// @vitest-environment jsdom
//
// T3-013, the missing parts: the CSS collapse of bot and join/leave lines through the Discord
// theme path, and the list of servers never opened (by server number only).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

const G1 = '123456789012345678';
const G2 = '223456789012345678';
let DN, wv;

function fakeWebview(url = 'https://discord.com/channels/' + G1 + '/1') {
  let n = 0;
  const listeners = {};
  return {
    url,
    insertCSS: vi.fn(async () => 'key' + (++n)),
    removeInsertedCSS: vi.fn(async () => {}),
    getURL() { return this.url; },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    fire: (t, e) => (listeners[t] || []).forEach(f => f(e)),
  };
}

beforeEach(() => {
  localStorage.clear();
  delete window.vex; delete window.VexTabPolicy;
  globalThis.CommsStore = fresh('comms-store.js').CommsStore;
  globalThis.DiscordNoise = window.DiscordNoise = DN = fresh('discord-noise.js').DiscordNoise;
  wv = fakeWebview();
  globalThis.DiscordTheme = window.DiscordTheme = { pages: () => [wv] };
  window.VexProblems = { note: vi.fn() };
  globalThis.vexGuestUrl = (w) => w.url;
});

describe('collapse stylesheet', () => {
  it('is nothing until a choice is made, and only the chosen kinds after', () => {
    expect(DN.collapseCss()).toBe('');
    DN.setCollapse({ bots: true }).catch(() => {});
    const css = DN.collapseCss();
    expect(css).toContain('botTag');
    expect(css).not.toContain('systemMessage');
    expect(css).toContain(':not(:hover)');                      // it opens when the pointer is on it
    expect(css).not.toMatch(/display:\s*none|visibility/);      // a line is never removed, only shrunk
    DN.setCollapse({ system: true }).catch(() => {});
    expect(DN.collapseCss()).toContain('systemMessage');
  });

  it('puts the stylesheet into the Discord pages, swaps it when the choice changes and removes it when switched off', async () => {
    await DN.setCollapse({ bots: true });
    expect(wv.insertCSS).toHaveBeenCalledTimes(1);
    expect(wv.insertCSS.mock.calls[0][0]).toContain('botTag');
    await DN.setCollapse({ bots: false, system: true });
    expect(wv.removeInsertedCSS).toHaveBeenCalledWith('key1');
    expect(wv.insertCSS.mock.calls[1][0]).toContain('systemMessage');
    await DN.setCollapse({ system: false });
    expect(wv.removeInsertedCSS).toHaveBeenCalledWith('key2');
    expect(wv.insertCSS).toHaveBeenCalledTimes(2);
  });

  it('a page that finishes loading gets it through onPageReady (the theme path), and the master switch off removes it', async () => {
    DN.state(); localStorage.setItem('vex.discordNoise', JSON.stringify({ on: true, collapse: { bots: true } }));
    DN.onPageReady(wv);
    await wv._vexNoiseChain;
    expect(wv.insertCSS).toHaveBeenCalledTimes(1);
    DN.setEnabled(false);
    await DN.applyAll();
    expect(wv.removeInsertedCSS).toHaveBeenCalledWith('key1');
  });

  it('is called by the Discord theme for every Discord page', () => {
    const src = require('fs').readFileSync(path.join(JS, 'discord-theme.js'), 'utf8');
    expect(src).toMatch(/window\.DiscordNoise\.onPageReady\(wv\)/);
  });

  it('says so, not nothing, when the Discord pages are not reachable', async () => {
    delete globalThis.DiscordTheme; delete window.DiscordTheme;
    await expect(DN.setCollapse({ bots: true })).rejects.toThrow(/Discord pages are not available/);
  });
});

describe('servers never opened', () => {
  it('remembers only the server number, only while switched on, never in a private window', () => {
    expect(DN.recordUrl('https://discord.com/channels/' + G1 + '/55')).toBe(false);
    DN.setTracking(true);
    expect(DN.recordUrl('https://discord.com/channels/' + G1 + '/55')).toBe(true);
    expect(DN.recordUrl('https://discord.com/channels/@me/55')).toBe(false);
    expect(DN.recordUrl('https://example.com/channels/' + G2 + '/55')).toBe(false);
    const raw = localStorage.getItem('vex.discordNoise');
    expect(raw).toContain(G1);
    expect(raw).not.toContain('/55');
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(DN.recordUrl('https://discord.com/channels/' + G2 + '/1')).toBe(false);
  });

  it('follows in-page navigation of a page that finished loading', () => {
    DN.setTracking(true);
    DN.onPageReady(wv);
    wv.fire('did-navigate-in-page', { url: 'https://discord.com/channels/' + G2 + '/9' });
    expect(Object.keys(DN.state().opened).sort()).toEqual([G1, G2]);
  });

  it('lists the servers in the bar whose number was never opened', () => {
    const opened = { [G1]: { last: 1, n: 1 } };
    const out = DN.neverOpened([{ id: G1, name: 'A' }, { id: G2, name: 'B' }, { id: G2, name: 'dup' }, { id: 'home', name: 'x' }], opened);
    expect(out).toEqual([{ id: G2, name: 'B' }]);
  });

  it('reads the server bar once, on a click, and tells you to turn the memory on first', async () => {
    await expect(DN.findNeverOpened()).rejects.toThrow(/Remember which servers/);
    DN.setTracking(true);
    DN.recordUrl('https://discord.com/channels/' + G1 + '/1');
    const evalFn = vi.fn(async () => [{ id: G1, name: 'A' }, { id: G2, name: 'B' }]);
    window.vexGuestEval = evalFn;
    const r = await DN.findNeverOpened();
    expect(evalFn).toHaveBeenCalledTimes(1);
    expect(evalFn.mock.calls[0][1]).toBe(DN.RAIL_SCRIPT);
    expect(DN.RAIL_SCRIPT).not.toMatch(/message|textContent|innerText/i);   // names of servers, never messages
    expect(r).toMatchObject({ servers: 2, never: [{ id: G2, name: 'B' }] });
    evalFn.mockResolvedValue([]);
    await expect(DN.findNeverOpened()).rejects.toThrow(/No servers were found/);
    DN.forgetOpened();
    expect(DN.state().opened).toEqual({});
  });
});
