// @vitest-environment jsdom
//
// T2-076: the Discord look at start, the inbox button, and that nothing is
// started during a game.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { BypassDoctor } = require('../../src/renderer/js/bypass-doctor.js');

const RESULT = (ok) => ({ host: 'discord.com', direct: { ok, ms: 30, error: ok ? undefined : 'ERR_CONNECTION_RESET' }, bypassed: null, verdict: ok ? 'up' : 'down-no-bypass', text: 'x' });
let suggest;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vex.bypassDoctor.startupProbe', 'on');     // the start-up look is opt-in
  suggest = vi.fn();
  globalThis.VexAttention = { suggest };
  globalThis.DiscordBypass = { choice: () => ({ mode: 'off' }), save: vi.fn(), apply: vi.fn(async () => ({ ok: true })), looksBlocked: (c) => c === -101 };
  delete globalThis.GameMode; delete globalThis.GameSession;
  window.vexConfirm = vi.fn(async () => true);
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  window.vex = { probeBypass: vi.fn(async () => RESULT(false)) };
});

describe('preflight', () => {
  it('offers ByeDPI once when Discord is off and unreachable', async () => {
    await BypassDoctor.preflight(1e12);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'bypass-doctor', id: 'discord', action: { key: 'byedpi' } });
    expect(suggest.mock.calls[0][0].body).toMatch(/Zapret does not seem to be running/);
    await BypassDoctor.preflight(1e12 + 3600000);
    expect(window.vex.probeBypass).toHaveBeenCalledTimes(1);
  });
  it('says nothing when Discord answers, when a bypass is on, or when switched off', async () => {
    window.vex.probeBypass = vi.fn(async () => RESULT(true));
    await BypassDoctor.preflight(1e12);
    expect(suggest).not.toHaveBeenCalled();
    DiscordBypass.choice = () => ({ mode: 'strong' });
    expect(await BypassDoctor.preflight(2e12)).toBe(null);
    BypassDoctor.setEnabled(false);
    DiscordBypass.choice = () => ({ mode: 'off' });
    expect(await BypassDoctor.preflight(3e12)).toBe(null);
  });
  it('does not even look while a game runs', async () => {
    globalThis.GameSession = { active: true };
    expect(await BypassDoctor.preflight(1e12)).toBe(null);
    expect(window.vex.probeBypass).not.toHaveBeenCalled();
  });
});

describe('the ByeDPI button', () => {
  it('asks first and then turns it on', async () => {
    expect(await BypassDoctor.useByeDpi()).toBe(true);
    expect(DiscordBypass.apply).toHaveBeenCalledWith({ mode: 'strong' });
  });
  it('does nothing when the person says no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await BypassDoctor.useByeDpi()).toBe(false);
    expect(DiscordBypass.apply).not.toHaveBeenCalled();
  });
  it('refuses to start a bypass during a game', async () => {
    globalThis.GameMode = { gaming: true };
    await expect(BypassDoctor.useByeDpi()).rejects.toThrow(/game is running/);
    expect(DiscordBypass.apply).not.toHaveBeenCalled();
  });
  it('raises when ByeDPI could not start', async () => {
    DiscordBypass.apply = vi.fn(async () => ({ ok: false, error: 'no preset got through' }));
    await expect(BypassDoctor.useByeDpi()).rejects.toThrow(/no preset/);
  });
});

describe('check and describe', () => {
  it('raises when the window cannot check', async () => {
    window.vex = {};
    await expect(BypassDoctor.check('https://a.com/')).rejects.toThrow(/not available/);
  });
  it('describes both sides in words', () => {
    const t = BypassDoctor.describe({ ...RESULT(true), bypassed: { ok: false, ms: 6000, error: 'no answer' }, bypassLabel: 'ByeDPI (strong)' });
    expect(t).toContain('Straight from this computer: answers (30 ms)');
    expect(t).toContain('Through ByeDPI (strong): no answer (no answer)');
  });
});

describe('the start-up look is opt-in for everyone', () => {
  it('sends nothing to discord.com unless the person turned it on', async () => {
    localStorage.removeItem('vex.bypassDoctor.startupProbe');
    expect(BypassDoctor.startupProbe()).toBe(false);
    expect(await BypassDoctor.preflight(1e12)).toBe(null);
    expect(window.vex.probeBypass).not.toHaveBeenCalled();
    BypassDoctor.setStartupProbe(true);
    await BypassDoctor.preflight(1e12);
    expect(window.vex.probeBypass).toHaveBeenCalledTimes(1);
  });
});
