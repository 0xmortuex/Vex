// @vitest-environment jsdom
//
// "Rest Discord when hidden and not in a call" (js/sidebar.js checkDiscordThrottle): two minutes out of sight and not in
// a call, the Discord panel is throttled like any background page; shown again, or a call, and it is not.
//
// Discord is a plain page in Vex: nothing here runs a script in it. The old "rest mode" (the page was told it was hidden
// through window.__vexRest, the other half of the visibility spoof) is gone, and "in a call" is what the browser itself
// knows (the microphone or camera is held, or the page is audible), never a look at Discord's buttons.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
const { DiscordMemory } = require('../../src/renderer/js/discord-memory.js');
const { SITE_TWEAKS } = require('../../src/site-tweaks.js');

const NOW = 10_000_000;
let wv;
beforeEach(() => {
  document.body.innerHTML = '<div class="panel" id="panel-discord"></div>';
  localStorage.clear();
  globalThis.DiscordMemory = DiscordMemory;
  SidebarManager.activePanel = null; SidebarManager.sidePanel = null; SidebarManager.panelCapture = {};
  SidebarManager._discordThrottled = false;
  wv = document.createElement('webview');
  wv.getWebContentsId = () => 7;
  wv.isCurrentlyAudible = () => false;
  wv.send = vi.fn();
  wv.executeJavaScript = vi.fn(async () => true);
  wv.insertCSS = vi.fn(async () => 'key');
  document.getElementById('panel-discord').appendChild(wv);
  SidebarManager.panelWebviews = { discord: wv };
  window.vex = { setBackgroundThrottling: vi.fn(async () => ({ ok: true })) };
  localStorage.setItem('vex.panelUsage', JSON.stringify({ discord: NOW - 10 * 60000 }));
});

describe('resting a hidden Discord', () => {
  it('hidden for two minutes and not in a call: throttled, and no script or style goes into the page', async () => {
    const r = await SidebarManager.checkDiscordThrottle(NOW);
    expect(r).toEqual({ visible: false, inCall: false, throttled: true });
    expect(window.vex.setBackgroundThrottling).toHaveBeenCalledWith(7, true);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    expect(wv.insertCSS).not.toHaveBeenCalled();
  });
  it('a call is what the browser knows: the microphone or camera is held, or the page is audible', async () => {
    SidebarManager.panelCapture = { discord: { mic: true } };
    expect((await SidebarManager.checkDiscordThrottle(NOW)).throttled).toBe(false);
    SidebarManager.panelCapture = {};
    wv.isCurrentlyAudible = () => true;
    expect((await SidebarManager.checkDiscordThrottle(NOW)).throttled).toBe(false);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });
  it('shown, or switched off in Settings: not throttled', async () => {
    SidebarManager.activePanel = 'discord';
    expect(await SidebarManager.checkDiscordThrottle(NOW)).toEqual({ visible: true, inCall: null, throttled: false });
    SidebarManager.activePanel = null;
    localStorage.setItem('vex.discordRestHidden', '0');
    expect((await SidebarManager.checkDiscordThrottle(NOW)).throttled).toBe(false);
  });
  it('tells the page when it is hidden, and when it is shown (the video scan stops and starts)', async () => {
    await SidebarManager.checkDiscordThrottle(NOW);
    SidebarManager.activePanel = 'discord';
    await SidebarManager.checkDiscordThrottle(NOW);
    expect(wv.send.mock.calls).toEqual([['vex-hidden', true], ['vex-hidden', false]]);
  });
});

describe('rest mode and the visibility spoof are gone', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');
  it('no site tweak, and nothing in the sidebar or the memory module, knows window.__vexRest', () => {
    expect(SITE_TWEAKS.find(t => t.name === 'discord-always-visible')).toBeUndefined();
    for (const rel of ['site-tweaks.js', 'renderer/js/sidebar.js', 'renderer/js/discord-memory.js']) expect(read(rel)).not.toMatch(/__vexRest/);
    expect(DiscordMemory.restModeOn).toBeUndefined();
    expect(DiscordMemory.setRest).toBeUndefined();
    expect(SidebarManager._setDiscordResting).toBeUndefined();
  });
  it('the sidebar runs no script and puts no style in any panel page', () => {
    expect(read('renderer/js/sidebar.js')).not.toMatch(/executeJavaScript|insertCSS|vexGuestEval/);
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
