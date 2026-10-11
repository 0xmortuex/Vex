// @vitest-environment jsdom
//
// The Discord icon says, without opening the panel: in a call, muted or live,
// deafened, sharing the screen.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/vex-utils.js');
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

// Discord's own buttons, as it draws them.
function discord({ muteLabel = 'Mute', muteChecked, deafLabel = 'Deafen', deafChecked, call = true, sharing = false } = {}) {
  document.body.innerHTML = `
    <button aria-label="${muteLabel}" ${muteChecked != null ? `aria-checked="${muteChecked}"` : ''}></button>
    <button aria-label="${deafLabel}" ${deafChecked != null ? `aria-checked="${deafChecked}"` : ''}></button>
    ${call ? '<button aria-label="Disconnect"></button>' : ''}
    ${sharing ? '<button aria-label="Stop Streaming"></button>' : ''}`;
  return (0, eval)(SidebarManager.DISCORD_STATE_SCRIPT);
}

describe('reading the call from Discord\'s buttons', () => {
  it('live, muted the old way ("Unmute") and the new way (Mute pressed)', () => {
    expect(discord()).toEqual({ inCall: true, muted: false, deafened: false, sharing: false });
    expect(discord({ muteLabel: 'Unmute' }).muted).toBe(true);
    expect(discord({ muteChecked: 'true' }).muted).toBe(true);
    expect(discord({ muteChecked: 'false' }).muted).toBe(false);
  });

  it('deafened, sharing, and not in a call', () => {
    expect(discord({ deafChecked: 'true' }).deafened).toBe(true);
    expect(discord({ deafLabel: 'Undeafen' }).deafened).toBe(true);
    expect(discord({ sharing: true }).sharing).toBe(true);
    expect(discord({ call: false }).inCall).toBe(false);
  });
});

describe('the badge', () => {
  it('says it in words and picks the icon', () => {
    expect(SidebarManager.discordBadgeFor({ inCall: false })).toBeNull();
    expect(SidebarManager.discordBadgeFor({ inCall: true, muted: false })).toEqual({ icon: 'mic', tone: 'live', title: 'In a Discord call: microphone live' });
    expect(SidebarManager.discordBadgeFor({ inCall: true, muted: true, sharing: true })).toEqual({ icon: 'monitor', tone: 'off', title: 'In a Discord call: muted, sharing your screen' });
    expect(SidebarManager.discordBadgeFor({ inCall: true, deafened: true })).toMatchObject({ icon: 'headphones', tone: 'off' });
  });

  it('appears on the Discord icon, and goes when the call ends', async () => {
    document.body.innerHTML = '<div class="sidebar-icon" data-panel="discord"></div>';
    let state = { inCall: true, muted: true, deafened: false, sharing: false };
    // In a call: Discord holds the microphone, so its page is looked into.
    SidebarManager.panelWebviews.discord = { executeJavaScript: vi.fn(async () => state), isCurrentlyAudible: () => false };
    SidebarManager.panelCapture.discord = { mic: true };
    await SidebarManager.updateDiscordBadge();
    const b = document.querySelector('.icon-badge.discord-call');
    expect(b.dataset.tone).toBe('off');
    expect(b.title).toBe('In a Discord call: muted');
    state = { inCall: false };
    await SidebarManager.updateDiscordBadge();
    expect(document.querySelector('.icon-badge.discord-call')).toBeNull();
    delete SidebarManager.panelWebviews.discord;
    delete SidebarManager.panelCapture.discord;
  });
});

// It ran a script in Discord's hidden page every 10 s all day, on its own
// timer that ignored games and a minimised Vex.
describe('looking into Discord only when a call may be on', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="sidebar-icon" data-panel="discord"></div>';
    SidebarManager.panelCapture = {};
    SidebarManager.activePanel = null;
    SidebarManager.sidePanel = null;
  });

  it('does not run its script in a silent Discord with no microphone', async () => {
    const wv = { executeJavaScript: vi.fn(async () => ({ inCall: true })), isCurrentlyAudible: () => false };
    SidebarManager.panelWebviews.discord = wv;
    expect(await SidebarManager.updateDiscordBadge()).toBeNull();
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    delete SidebarManager.panelWebviews.discord;
  });

  it('looks when Discord is making a sound', async () => {
    const wv = { executeJavaScript: vi.fn(async () => ({ inCall: true })), isCurrentlyAudible: () => true };
    SidebarManager.panelWebviews.discord = wv;
    expect(await SidebarManager.updateDiscordBadge()).toMatchObject({ tone: 'live' });
    delete SidebarManager.panelWebviews.discord;
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
