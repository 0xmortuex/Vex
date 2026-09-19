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
    SidebarManager.panelWebviews.discord = { executeJavaScript: vi.fn(async () => state) };
    await SidebarManager.updateDiscordBadge();
    const b = document.querySelector('.icon-badge.discord-call');
    expect(b.dataset.tone).toBe('off');
    expect(b.title).toBe('In a Discord call: muted');
    state = { inCall: false };
    await SidebarManager.updateDiscordBadge();
    expect(document.querySelector('.icon-badge.discord-call')).toBeNull();
    delete SidebarManager.panelWebviews.discord;
  });
});
