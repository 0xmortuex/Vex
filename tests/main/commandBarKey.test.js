// Ctrl+K opens the command bar from inside a page too — except on the sites
// whose own Ctrl+K is their main shortcut.
import { describe, expect, it } from 'vitest';
const { isCommandBarKey, siteOwnsCtrlK } = require('../../src/main/command-bar-key.js');

const k = (o) => ({ type: 'keyDown', control: true, alt: false, shift: false, key: 'k', ...o });

describe('Ctrl+K from inside a page', () => {
  it('opens the command bar from the New Tab page and ordinary sites', () => {
    expect(isCommandBarKey(k(), 'vex://start')).toBe(true);
    expect(isCommandBarKey(k(), 'https://www.youtube.com/watch?v=1')).toBe(true);
    expect(isCommandBarKey(k({ key: 'K' }), 'https://example.com/')).toBe(true);
  });

  it('stays with Discord and Slack, whose own Ctrl+K is their switcher', () => {
    expect(isCommandBarKey(k(), 'https://discord.com/channels/1/2')).toBe(false);
    expect(isCommandBarKey(k(), 'https://app.slack.com/client/T1')).toBe(false);
    expect(siteOwnsCtrlK('https://notdiscord.com/')).toBe(false);
  });

  it('only exactly Ctrl+K, on key down', () => {
    expect(isCommandBarKey(k({ shift: true }), 'https://example.com/')).toBe(false);
    expect(isCommandBarKey(k({ alt: true }), 'https://example.com/')).toBe(false);
    expect(isCommandBarKey(k({ control: false }), 'https://example.com/')).toBe(false);
    expect(isCommandBarKey(k({ type: 'keyUp' }), 'https://example.com/')).toBe(false);
    expect(isCommandBarKey(k({ key: 'j' }), 'https://example.com/')).toBe(false);
  });
});
