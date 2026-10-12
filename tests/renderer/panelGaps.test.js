// @vitest-environment jsdom
//
// Three things the Discord and app panels were missing (audit 2026-10-10):
//  - "Discord looks blocked" came up whenever a load failed, offline included,
//    offering a bypass that cannot help without a connection;
//  - clicking a Discord or WhatsApp desktop notification did nothing you could
//    see: the click went to the page, which cannot open the panel it is in;
//  - a screen share from a panel had no badge (only microphone and camera).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { DiscordBypass } = require('../../src/renderer/js/discord-bypass.js');
window.DiscordBypass = DiscordBypass;
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

beforeEach(() => {
  document.body.innerHTML = `
    <button class="sidebar-icon" data-panel="discord" title="Discord"></button>
    <button class="sidebar-icon" data-panel="whatsapp" title="WhatsApp"></button>`;
  SidebarManager.panelCapture = {};
  SidebarManager.activePanel = null;
  SidebarManager.sidePanel = null;
  window.showToast = vi.fn();
});

describe('"Discord looks blocked"', () => {
  it('is for failures blocking produces', () => {
    for (const code of [-105, -137, -101, -100, -7, -118, -107, -324]) expect(DiscordBypass.looksBlocked(code)).toBe(true);
  });

  it('is not for being offline, a changed network, or a load the page stopped', () => {
    for (const code of [-106, -21, -3, -2, 0]) expect(DiscordBypass.looksBlocked(code)).toBe(false);
  });

  it('the Discord panel asks DiscordBypass before showing the card', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sidebar.js'), 'utf8');
    expect(src).toMatch(/!DiscordBypass\.looksBlocked\(e\.errorCode\)\) return;\s*\r?\n\s*this\._showDiscordBlockedPrompt\(wv, panelEl\);/);
  });
});

describe('a desktop notification from a panel, clicked', () => {
  it('brings Vex to the front with that panel open', async () => {
    window.vex = { focusWindow: vi.fn(async () => ({ ok: true })) };
    const show = vi.spyOn(SidebarManager, 'showPanel').mockImplementation(() => {});
    SidebarManager.openFromNotification('whatsapp');
    expect(window.vex.focusWindow).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith('whatsapp');
    show.mockRestore();
  });

  it('leaves a panel that is already open as it is', () => {
    window.vex = { focusWindow: vi.fn(async () => ({ ok: true })) };
    const show = vi.spyOn(SidebarManager, 'showPanel').mockImplementation(() => {});
    SidebarManager.activePanel = 'discord';
    SidebarManager.openFromNotification('discord');
    expect(show).not.toHaveBeenCalled();
    expect(window.vex.focusWindow).toHaveBeenCalled();
    show.mockRestore();
  });

  it("the guest's Notification is wrapped so a click reaches the host, still a real Notification", () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
    const start = src.indexOf('function wrapNotification(clicked) {');
    const end = src.indexOf('\n  function inject()', start);
    const wrap = new Function('return ' + src.slice(start, end).trim())();
    class FakeNotification extends EventTarget {
      constructor(title, opts) { super(); this.title = title; this.opts = opts; }
      static get permission() { return 'granted'; }
      static requestPermission() { return Promise.resolve('granted'); }
    }
    window.Notification = FakeNotification;
    const clicked = vi.fn();
    wrap(clicked);
    expect(window.Notification).not.toBe(FakeNotification);
    expect(window.Notification.permission).toBe('granted');
    const n = new window.Notification('New message', { body: 'hi' });
    expect(n).toBeInstanceOf(FakeNotification);
    expect(n.title).toBe('New message');
    n.dispatchEvent(new Event('click'));
    expect(clicked).toHaveBeenCalledTimes(1);
    const again = window.Notification;
    wrap(clicked);                         // a second injection does not wrap twice
    expect(window.Notification).toBe(again);
  });

  it('only on Discord and WhatsApp', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
    const m = /if \(!(\/\^\(\?:[^\n]+\/i)\.test\(host\)\) return;/.exec(src);
    expect(m).toBeTruthy();
    const re = new Function('return ' + m[1])();
    expect(re.test('discord.com')).toBe(true);
    expect(re.test('canary.discord.com')).toBe(true);
    expect(re.test('web.whatsapp.com')).toBe(true);
    expect(re.test('discord.com.evil.example')).toBe(false);
    expect(re.test('example.com')).toBe(false);
  });
});

describe('a screen share in a panel', () => {
  it('has a badge of its own, and loses it when it ends', () => {
    SidebarManager.setPanelCapturing('whatsapp', 'screen', true);
    const b = document.querySelector('.sidebar-icon[data-panel="whatsapp"] .icon-badge.capture');
    expect(b).not.toBe(null);
    expect(b.title).toBe('Sharing your screen');
    SidebarManager.setPanelCapturing('whatsapp', 'mic', true);
    expect(b.title).toBe('Sharing your screen, and using the microphone');
    SidebarManager.setPanelCapturing('whatsapp', 'screen', false);
    expect(b.title).toBe('Using the microphone');
    SidebarManager.setPanelCapturing('whatsapp', 'mic', false);
    expect(document.querySelector('.sidebar-icon[data-panel="whatsapp"] .icon-badge.capture')).toBe(null);
  });
});
