// @vitest-environment jsdom
//
// Found 2026-10-12 reading js/discord-theme.js: DiscordTheme.applyAll() queues
// each run behind the one before it. A run that threw (plan() says "No Vex
// theme to match" or cannot work a theme's colours out) left the queue itself
// rejected, so every later run was skipped and applyAll() answered with the old
// failure for the rest of the session: Discord stopped following the theme
// until Vex was restarted.
import { describe, it, expect, beforeEach } from 'vitest';

const { CustomThemes } = require('../../src/renderer/js/theme-custom.js');
globalThis.CustomThemes = CustomThemes;
const { DiscordTokens } = require('../../src/renderer/js/discord-tokens.js');
globalThis.DiscordTokens = DiscordTokens;
const { DiscordTheme } = require('../../src/renderer/js/discord-theme.js');

describe('DiscordTheme.applyAll after a run that failed', () => {
  beforeEach(() => { DiscordTheme._queued = false; DiscordTheme._chain = Promise.resolve(); });

  it('still runs the next one, and tells each caller its own outcome', async () => {
    const realPlan = DiscordTheme.plan;
    let calls = 0;
    DiscordTheme.plan = () => { calls++; if (calls === 1) throw new Error('No Vex theme to match'); return null; };
    try {
      await expect(DiscordTheme.applyAll()).rejects.toThrow('No Vex theme to match');
      const second = await DiscordTheme.applyAll();
      expect(second).toEqual([]);                       // no Discord page is open: nothing to do, but it ran
      expect(calls).toBe(2);
      expect(DiscordTheme._queued).toBe(false);
    } finally { DiscordTheme.plan = realPlan; }
  });
});
