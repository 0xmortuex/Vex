// @vitest-environment jsdom
//
// "Match Discord to my Vex theme" (js/discord-theme.js): every one of the 28
// themes named after a BetterDiscord theme loads that real theme by its
// published link, or is coloured by Vex for a stated reason (a licence that
// does not allow it, or a theme that would do nothing in Discord's usual mode).

import { describe, expect, it } from 'vitest';
const { CustomThemes } = require('../../src/renderer/js/theme-custom.js');
globalThis.CustomThemes = CustomThemes;
const { DiscordTheme } = require('../../src/renderer/js/discord-theme.js');
const { IDS } = require('./themeTokens.js');

const BD_THEMES = ['clearvision', 'darkmatter', 'duskplus', 'darkplus', 'terminal', 'amoled', 'recordgreen', 'darkneon',
  'deepmidnight', 'softx', 'neutron', 'nocturnal', 'tokyonight', 'material', 'androidbeige', 'kaleidoscope', 'codedark',
  'synthesis', 'virtualred', 'paperred', 'noctisviola', 'wildberry', 'gxred', 'gruvbox', 'rosynight', 'azurite', 'neptune', 'ezlight'];

describe('the themes named after BetterDiscord themes', () => {
  it('every one of the 28 has its real theme or is knowingly generated', () => {
    expect(BD_THEMES).toHaveLength(28);
    for (const id of BD_THEMES) {
      expect(IDS, id).toContain(id);
      const real = DiscordTheme.realFor(id);
      if (real) {
        expect(real.url, id).toMatch(/^https:\/\//);
        expect(real.url, id + ' must not be raw.githubusercontent (served as text/plain)').not.toMatch(/raw\.githubusercontent\.com/);
        expect(real.name && real.license && real.repo, id).toBeTruthy();
        expect(DiscordTheme.GENERATED_INSTEAD[id], id + ' is both linked and generated').toBeUndefined();
      } else {
        expect(DiscordTheme.GENERATED_INSTEAD[id], id + ' has no real link and no reason why').toBeTruthy();
      }
    }
  });
  it('maps only theme ids that exist', () => {
    for (const id of Object.keys(DiscordTheme.REAL)) expect(BD_THEMES).toContain(id);
    for (const id of Object.keys(DiscordTheme.GENERATED_INSTEAD)) expect(BD_THEMES).toContain(id);
  });
  it('the licence-blocked ones are not linked', () => {
    for (const id of ['darkplus', 'rosynight', 'azurite', 'neptune', 'neutron', 'nocturnal']) expect(DiscordTheme.realFor(id)).toBe(null);
  });
});

describe('a real theme in Discord', () => {
  it('is added as its link with Vex\'s mark, and named in Settings', () => {
    localStorage.setItem(DiscordTheme.KEY, 'on');
    try {
      expect(DiscordTheme.plan('clearvision')).toEqual({ link: 'https://clearvision.github.io/ClearVision-v7/main.css#vex-theme-match', theme: 'clearvision' });
      expect(DiscordTheme.describe('clearvision')).toBe('the real ClearVision theme, loaded from clearvision.github.io');
    } finally { localStorage.clear(); }
  });
});
