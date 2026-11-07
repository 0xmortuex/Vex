// @vitest-environment jsdom
//
// The renderer half of theme pinning (js/discord-theme.js checkPin / acceptPin): what the plan becomes for each answer main gives.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { CustomThemes } = require('../../src/renderer/js/theme-custom.js');
globalThis.CustomThemes = CustomThemes;
const { DiscordTokens } = require('../../src/renderer/js/discord-tokens.js');
globalThis.DiscordTokens = DiscordTokens;
const { DiscordTheme } = require('../../src/renderer/js/discord-theme.js');

const LINK_PLAN = () => ({ link: DiscordTheme.REAL.deepmidnight.url + DiscordTheme.LINK_MARK, theme: 'deepmidnight' });
let added, check, accept;
beforeEach(() => {
  added = [];
  check = vi.fn(); accept = vi.fn();
  window.vex = { themePin: { check, accept } };
  window.AttentionInbox = { add: (row) => { added.push(row); return true; } };
  window.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
});

describe('DiscordTheme.checkPin', () => {
  it('with no bridge it leaves the plan alone', async () => {
    delete window.vex;
    const plan = LINK_PLAN();
    expect(await DiscordTheme.checkPin(plan)).toBe(plan);
  });

  it('a pinned or unchanged file keeps the link', async () => {
    const plan = LINK_PLAN();
    check.mockResolvedValue({ ok: true, status: 'same' });
    expect(await DiscordTheme.checkPin(plan)).toBe(plan);
    expect(check).toHaveBeenCalledWith('deepmidnight', DiscordTheme.REAL.deepmidnight.url);
    expect(added).toEqual([]);
  });

  it('a changed file is not applied: the kept copy is, and the inbox is told once', async () => {
    check.mockResolvedValue({ ok: true, status: 'changed', css: 'old{}', announce: true });
    const r = await DiscordTheme.checkPin(LINK_PLAN());
    expect(r).toEqual({ css: 'old{}', theme: 'deepmidnight', pinned: true });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ feature: 'theme-pin', id: 'deepmidnight', action: { label: 'Use the new version', key: 'accept:deepmidnight' } });
    expect(added[0].title).toContain('midnight');
    expect(added[0].body.length).toBeLessThanOrEqual(300);
    check.mockResolvedValue({ ok: true, status: 'changed', css: 'old{}', announce: false });
    await DiscordTheme.checkPin(LINK_PLAN());
    expect(added).toHaveLength(1);
  });

  it('a failed check reports the problem; the kept copy is used when there is one', async () => {
    check.mockResolvedValue({ ok: false, error: 'offline', css: 'old{}' });
    expect(await DiscordTheme.checkPin(LINK_PLAN())).toEqual({ css: 'old{}', theme: 'deepmidnight', pinned: true });
    expect(window.VexProblems.note).toHaveBeenCalledTimes(1);
    const plan = LINK_PLAN();
    check.mockResolvedValue({ ok: false, error: 'offline' });
    expect(await DiscordTheme.checkPin(plan)).toBe(plan);
  });

  it('a plan that is already css is never checked', async () => {
    const plan = { css: 'a{}', theme: 'x' };
    expect(await DiscordTheme.checkPin(plan)).toBe(plan);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('DiscordTheme.acceptPin', () => {
  it('pins the new file through main for the right theme', async () => {
    accept.mockResolvedValue({ ok: true, status: 'pinned' });
    await DiscordTheme.acceptPin('accept:deepmidnight');
    expect(accept).toHaveBeenCalledWith('deepmidnight', DiscordTheme.REAL.deepmidnight.url);
  });
  it('refuses an unknown theme and reports a failed pin', async () => {
    await expect(DiscordTheme.acceptPin('accept:nope')).rejects.toThrow();
    accept.mockResolvedValue({ ok: false, error: 'offline' });
    await expect(DiscordTheme.acceptPin('accept:deepmidnight')).rejects.toThrow('offline');
  });
});
