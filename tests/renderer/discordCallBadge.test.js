// @vitest-environment jsdom
//
// The Discord icon says, without opening the panel, that Discord holds the microphone, the camera or the screen.
// It is what the browser itself knows. Discord is a plain page in Vex: its Mute, Deafen and Stop Streaming buttons
// are not read any more (the badge used to say muted, deafened or sharing from them), and no script runs in its page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/vex-utils.js');
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

describe('the badge', () => {
  it('says it in words and picks the icon', () => {
    expect(SidebarManager.discordBadgeFor(null)).toBeNull();
    expect(SidebarManager.discordBadgeFor({ inCall: false })).toBeNull();
    expect(SidebarManager.discordBadgeFor({ inCall: true })).toEqual({ icon: 'mic', tone: 'live', title: 'Discord is using the microphone, the camera or the screen' });
  });

  it('appears on the Discord icon while Discord holds the microphone, and goes when it lets go', async () => {
    document.body.innerHTML = '<div class="sidebar-icon" data-panel="discord"></div>';
    const wv = { executeJavaScript: vi.fn(async () => ({ inCall: true })), isCurrentlyAudible: () => false };
    SidebarManager.panelWebviews.discord = wv;
    SidebarManager.panelCapture.discord = { mic: true };
    await SidebarManager.updateDiscordBadge();
    const b = document.querySelector('.icon-badge.discord-call');
    expect(b.dataset.tone).toBe('live');
    expect(b.title).toBe('Discord is using the microphone, the camera or the screen');
    delete SidebarManager.panelCapture.discord;
    await SidebarManager.updateDiscordBadge();
    expect(document.querySelector('.icon-badge.discord-call')).toBeNull();
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    delete SidebarManager.panelWebviews.discord;
  });
});

describe('nothing is read from Discord\'s page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="sidebar-icon" data-panel="discord"></div>';
    SidebarManager.panelCapture = {};
    SidebarManager.activePanel = null;
    SidebarManager.sidePanel = null;
  });

  it('a Discord that only makes a sound has no badge, and its page is not looked into', async () => {
    const wv = { executeJavaScript: vi.fn(async () => ({ inCall: true })), isCurrentlyAudible: () => true };
    SidebarManager.panelWebviews.discord = wv;
    expect(await SidebarManager.updateDiscordBadge()).toBeNull();
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    delete SidebarManager.panelWebviews.discord;
  });

  it('the script that read Discord\'s buttons is gone', () => {
    expect(SidebarManager.DISCORD_STATE_SCRIPT).toBeUndefined();
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/sidebar.js'), 'utf8');
    expect(src).not.toMatch(/aria-label\^?="(Mute|Unmute|Deafen|Undeafen|Disconnect|Stop Streaming)/);
  });

  it('runs on the shared job timer, and not while the Discord panel is open', () => {
    const jobs = {};
    globalThis.VexJobs = { every: vi.fn((name, ms, fn, opts) => { jobs[name] = { ms, fn, opts }; return { stop: vi.fn() }; }) };
    const spy = vi.spyOn(SidebarManager, 'updateDiscordBadge').mockResolvedValue(null);
    SidebarManager.startDiscordRest();
    expect(jobs['Discord call badge'].ms).toBe(10000);
    expect(jobs['Discord rest'].opts).toEqual({ when: 'background' });
    SidebarManager.activePanel = 'discord';
    jobs['Discord call badge'].fn();
    expect(spy).not.toHaveBeenCalled();
    SidebarManager.activePanel = 'claude';
    jobs['Discord call badge'].fn();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
