// @vitest-environment jsdom
//
// Page Watch on the home network (owner, 2026-10-11). A watch on the router,
// a NAS, localhost or 192.168.x was refused at every check ("Pages on this
// machine or the local network are not read by the agent"), because watches
// were fetched through the agent's public-only reader. A watch the user adds
// on such an address is now checked from this computer, with a one-line note
// saying so; routed sites are still never checked from the real connection,
// and the AI agent still cannot watch a home-network address.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

window.VexPrivateAddress = require('../../src/renderer/js/private-address.js');
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { PageWatch } = require('../../src/renderer/js/page-watch.js');

// main's api:request, as far as this test needs it: publicOnly refuses a
// private address (main/public-fetch.js); without it the page is fetched.
const ROUTER = '<html><head><title>Router</title></head><body><main><p>Devices online: 7</p></main></body></html>';
beforeEach(() => {
  localStorage.clear();
  globalThis.AgentTools = AgentTools;
  globalThis.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  window.vex = {
    notify: vi.fn(),
    apiRequest: vi.fn(async ({ url, publicOnly }) => {
      if (publicOnly && window.VexPrivateAddress.isPrivateHost(new URL(url).hostname)) return { ok: false, error: 'Pages on this machine or the local network are not read by the agent' };
      return { ok: true, status: 200, headers: { 'content-type': 'text/html' }, body: ROUTER };
    }),
  };
  globalThis.TabManager = { mayAskSiteForIcon: () => true, tabs: [{ id: 't', url: 'http://192.168.1.1/', title: 'Router' }], activeTabId: 't' };
});
afterEach(() => { delete globalThis.TabManager; });

describe('a watch the user adds on a home-network address', () => {
  it('is checked from this computer, and its number is read', async () => {
    const w = await PageWatch.watchPage('http://192.168.1.1/', 'Router');
    expect(w.local).toBe(true);
    const saved = PageWatch.list()[0];
    expect(saved.lastError || null).toBeNull();
    expect(saved.lastValue).toMatch(/Devices online: 7/);
    expect(window.vex.apiRequest).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://192.168.1.1/' }));
    expect(window.vex.apiRequest.mock.calls.every(([o]) => !o.publicOnly)).toBe(true);
  });

  it('says in one line that Vex will check the device every N minutes from this computer', async () => {
    const w = await PageWatch.watchPage('http://nas.local:5000/status', 'NAS');
    expect(window.showToast).toHaveBeenCalledWith('Watching — Vex will say when it changes. Vex will check this device on your network every 15 minutes from this computer');
    PageWatch.showManager();
    const note = document.querySelector(`#vex-watches [data-id="${w.id}"] .pw-local-note`);
    expect(note.textContent).toBe('Vex will check this device on your network every 15 minutes from this computer');
    document.getElementById('vex-watches').remove();
  });

  it('a public site gets no note and still goes through the public-only reader', async () => {
    window.vex.apiRequest.mockImplementation(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/html' }, body: ROUTER }));
    const w = await PageWatch.watchPage('https://shop.example/', 'Shop');
    expect(w.local).toBeUndefined();
    expect(window.vex.apiRequest.mock.calls.every(([o]) => o.publicOnly === true)).toBe(true);
    PageWatch.showManager();
    expect(document.querySelector('#vex-watches .pw-local-note')).toBeNull();
    document.getElementById('vex-watches').remove();
  });

  it('Ctrl+K "tell me when this changes" is the user too: allowed, with the note', () => {
    const r = PageWatch.watchCurrent('changes', { byUser: true });
    expect(r.watch.local).toBe(true);
    expect(r.said).toMatch(/Vex will check this device on your network every 15 minutes from this computer/);
  });

  it('localhost, 10.x and a bare machine name count as home network', () => {
    for (const u of ['http://localhost:8080/', 'http://10.0.0.2/', 'http://router/', 'http://[::1]/', 'http://printer.lan/']) expect(PageWatch.isLocal(u)).toBe(true);
    expect(PageWatch.isLocal('https://example.com/')).toBe(false);
  });
});

describe('what stays refused', () => {
  it('the AI agent cannot watch a home-network address', () => {
    expect(() => PageWatch.watchCurrent('changes')).toThrow(/only when you add the watch yourself/);
    expect(PageWatch.list()).toEqual([]);
  });

  it('a routed site (Tor, proxy, container) is never checked from the real connection, home network or not', async () => {
    TabManager.mayAskSiteForIcon = () => false;
    await PageWatch.watchPage('http://192.168.1.1/', 'Router');
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
    expect(PageWatch.list()[0].lastError).toMatch(/Tor, a proxy or a container/);
  });

  it('a home-network watch not marked as the user’s (an old or hand-edited list) is refused, not fetched', async () => {
    localStorage.setItem(PageWatch.KEY, JSON.stringify([{ id: 'w1', url: 'http://192.168.1.1/', title: 'R', selector: '', kind: 'text', every: 900000 }]));
    const r = await PageWatch.checkOne('w1');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/only when you add the watch yourself/);
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
  });
});
