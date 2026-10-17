// @vitest-environment jsdom
//
// Discord rest mode (Wave 6): hidden and not in a call, the page is told the truth about being hidden (the visibility
// spoof of site-tweaks.js is switched off); a call, opening Discord or a notification puts it back. Off by default.
// Also the page-side half (site-tweaks.js __vexRest) and the trimmed video scan of preload-webview.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');
const { SITE_TWEAKS } = require('../../src/site-tweaks.js');

const NOW = 10_000_000;
let wv, js;
beforeEach(() => {
  document.body.innerHTML = '<div class="panel" id="panel-discord"></div>';
  localStorage.clear();
  globalThis.DiscordMemory = DiscordMemory;
  SidebarManager.activePanel = null; SidebarManager.sidePanel = null; SidebarManager.panelCapture = {};
  SidebarManager._discordThrottled = false; SidebarManager._discordResting = false; SidebarManager._discordWakeUntil = 0;
  js = [];
  wv = document.createElement('webview');
  wv.getWebContentsId = () => 7;
  wv.isCurrentlyAudible = () => false;
  wv.send = vi.fn();
  wv.executeJavaScript = vi.fn(async (code) => { js.push(code); return /Disconnect/.test(code) ? (wv._call || false) : true; });
  document.getElementById('panel-discord').appendChild(wv);
  SidebarManager.panelWebviews = { discord: wv };
  window.vex = { setBackgroundThrottling: vi.fn(async () => ({ ok: true })) };
  localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: NOW - 10 * 60000 }));
});
const rests = () => js.filter(c => c.includes('__vexRest')).map(c => /f\((true|false)\)/.exec(c)[1]);

describe('rest mode in the sidebar', () => {
  it('is off by default: the page is never told to rest', async () => {
    expect(await SidebarManager.checkDiscordThrottle(NOW)).toEqual({ visible: false, inCall: false, throttled: true });
    expect(rests()).toEqual([]);
  });
  it('on: hidden and not in a call, the page is told to rest, again on every look (a reload starts spoofed)', async () => {
    DiscordMemory.setRest(true);
    js.length = 0;
    expect(await SidebarManager.checkDiscordThrottle(NOW)).toEqual({ visible: false, inCall: false, throttled: true, resting: true });
    await SidebarManager.checkDiscordThrottle(NOW);
    expect(rests()).toEqual(['true', 'true']);
  });
  it('a call keeps the spoof: no rest, and an earlier rest is undone', async () => {
    DiscordMemory.setRest(true);
    await SidebarManager.checkDiscordThrottle(NOW);
    wv._call = true;
    js.length = 0;
    const r = await SidebarManager.checkDiscordThrottle(NOW);
    expect(r.inCall).toBe(true);
    expect(rests()).toEqual(['false']);
  });
  it('opening Discord puts the spoof back at once', async () => {
    DiscordMemory.setRest(true);
    await SidebarManager.checkDiscordThrottle(NOW);
    js.length = 0;
    SidebarManager.activePanel = 'discord';
    await SidebarManager.checkDiscordThrottle(NOW);
    expect(rests()).toEqual(['false']);
    expect(SidebarManager._discordResting).toBe(false);
  });
  it('a notification wakes it for five minutes', async () => {
    DiscordMemory.setRest(true);
    await SidebarManager.checkDiscordThrottle(NOW);
    js.length = 0;
    SidebarManager._wakeDiscordFor(5 * 60000);
    await vi.waitFor(() => expect(rests()).toEqual(['false']));
    expect((await SidebarManager.checkDiscordThrottle(Date.now())).resting).toBeUndefined();
    expect((await SidebarManager.checkDiscordThrottle(Date.now() + 6 * 60000)).resting).toBe(true);
  });
  it('the care switch off means no rest, and rest mode needs "Rest Discord when hidden" too', async () => {
    DiscordMemory.setRest(true);
    DiscordMemory.setEnabled(false);
    expect((await SidebarManager.checkDiscordThrottle(NOW)).resting).toBeUndefined();
    DiscordMemory.setEnabled(true);
    localStorage.setItem('vex.discordRestHidden', '0');
    expect((await SidebarManager.checkDiscordThrottle(NOW)).resting).toBeUndefined();
  });
  it('tells the page when it is hidden, and when it is shown (the video scan stops and starts)', async () => {
    await SidebarManager.checkDiscordThrottle(NOW);
    SidebarManager.activePanel = 'discord';
    await SidebarManager.checkDiscordThrottle(NOW);
    expect(wv.send.mock.calls).toEqual([['vex-hidden', true], ['vex-hidden', false]]);
  });
});

describe('the page-side switch (site-tweaks.js)', () => {
  const entry = SITE_TWEAKS.find(t => t.name === 'discord-always-visible');
  function page(realHidden = true) {
    const listeners = [];
    const doc = { addEventListener: (...a) => listeners.push(a), dispatchEvent: (e) => { for (const [n, fn] of listeners) if (n === e.type) fn(e); return true; } };
    const win = { addEventListener: (...a) => listeners.push(a) };
    class Doc {}
    Object.defineProperty(Doc.prototype, 'visibilityState', { get: () => (realHidden ? 'hidden' : 'visible'), configurable: true });
    Object.defineProperty(Doc.prototype, 'hidden', { get: () => realHidden, configurable: true });
    Doc.prototype.hasFocus = () => false;
    const ctx = { document: doc, window: win, Object, Document: Doc, Event: class { constructor(t) { this.type = t; } } };
    vm.createContext(ctx);
    new vm.Script(entry.code.replace(/\bdocument\b/g, 'document')).runInContext(ctx);
    return { doc, win, ctx, listeners };
  }
  it('spoofs visible by default, as before', () => {
    const { doc } = page();
    expect(doc.visibilityState).toBe('visible');
    expect(doc.hidden).toBe(false);
  });
  it('__vexRest(true) tells the truth, lets visibilitychange through, and (false) puts the disguise back', () => {
    const { doc, win } = page(true);
    const seen = [];
    // Discord's own listener sits after the blocking capture listeners.
    doc.addEventListener('visibilitychange', () => seen.push(doc.visibilityState));
    const stop = vi.fn();
    expect(typeof win.__vexRest).toBe('function');
    win.__vexRest(true);
    expect(doc.visibilityState).toBe('hidden');
    expect(doc.hidden).toBe(true);
    win.__vexRest(false);
    expect(doc.visibilityState).toBe('visible');
    expect(doc.hidden).toBe(false);
    expect(seen).toEqual(['hidden', 'visible']);
    expect(stop).not.toHaveBeenCalled();
  });
  it('an event the browser sends while not resting is still blocked', () => {
    const { listeners } = page();
    const block = listeners.find(([n]) => n === 'visibilitychange')[1];
    const e = { stopImmediatePropagation: vi.fn() };
    block(e);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
  });
});

describe('the video scan of preload-webview.js stops while the page is hidden', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
  it('is told by vex-hidden, disconnects its observer, and scans once when shown', () => {
    expect(src).toMatch(/ipcRenderer\.on\('vex-hidden'/);
    expect(src).toMatch(/if \(pipScanTimer \|\| pipHidden\) return;/);
    expect(src).toMatch(/setInterval\(\(\) => \{ if \(!pipHidden\) setupVideoPipButtons\(\); \}, 5000\)/);
    expect(src).toMatch(/if \(pipHidden\) \{ obs\.disconnect\(\)/);
  });
});
