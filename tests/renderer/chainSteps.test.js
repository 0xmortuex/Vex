// @vitest-environment jsdom
//
// Chain steps with arguments (js/chain-steps.js): "open the standup tabs, 15
// minute timer, mute Discord" written as lines, checked as a whole, and run by
// the existing CommandChains.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let S;
let CommandChains;
let timer;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.showToast = vi.fn();
  timer = vi.fn(async () => {});
  const setMuted = vi.fn();
  globalThis.VexClock = { addTimer: timer };
  globalThis.SessionManager = { sessions: [{ id: 's1', name: 'Standup' }], restoreSession: vi.fn(async () => {}) };
  globalThis.FocusFlows = { _load: () => [{ id: 'f1', name: 'Work' }], activate: vi.fn() };
  globalThis.TabManager = {
    tabs: [{ id: 1, url: 'https://discord.com/channels/1', title: 'Discord', muted: false }, { id: 2, url: 'https://a.test/', title: 'A' }],
    createTab: vi.fn(),
    renderTabUpdate: vi.fn(),
  };
  globalThis.WebviewManager = { webviews: new Map([[1, { setAudioMuted: setMuted }]]) };
  globalThis.CommandBar = { commands: [{ id: 'reading-mode', label: 'Reading mode', action: vi.fn() }] };
  await import('../../src/renderer/js/resume-workday.js');
  await import('../../src/renderer/js/compose-chains.js');
  await import('../../src/renderer/js/chain-steps.js');
  globalThis.VexPlan = { BULK_MIN: 3, confirmSteps: vi.fn(async () => true) };
  S = window.VexChainSteps;
  CommandChains = window.CommandChains;
});

afterEach(() => {
  for (const k of ['VexPlan', 'VexClock', 'SessionManager', 'FocusFlows', 'TabManager', 'WebviewManager', 'CommandBar']) delete globalThis[k];
  vi.restoreAllMocks();
});

describe('writing a chain as lines', () => {
  it('turns lines into steps', () => {
    const r = S.parseText('open example.com/board\nsession standup\ntimer 15 min\nmute discord\nwait 3\nReading mode\n# a comment');
    expect(r.errors).toEqual([]);
    expect(r.steps).toEqual(['open:https://example.com/board', 'session:Standup', 'timer:15 min', 'mute:discord', 'wait:3', 'reading-mode']);
  });

  it('names every line that means nothing, with its number', () => {
    const r = S.parseText('timer soon\nsession Nope\nfocus Gone\nmake coffee\nopen javascript:alert(1)');
    expect(r.errors.map(e => e.line)).toEqual([1, 2, 3, 4, 5]);
    expect(r.errors[4].message).toMatch(/http/);
  });

  it('writes steps back as the lines they came from', () => {
    expect(S.toText(['timer:15 min', 'reading-mode'])).toBe('timer 15 min\nReading mode');
  });
});

describe('the dry-run list before a chain runs (T3-051)', () => {
  it('lists the steps the first time, runs after the button, and stops asking until it is edited', async () => {
    const chain = { id: 'c', name: 'Standup', steps: ['open:https://example.com/', 'timer:15 min', 'mute:discord'] };
    CommandChains.chains = [chain];
    const r = await CommandChains.run(chain);
    expect(r.ok).toBe(true);
    expect(VexPlan.confirmSteps).toHaveBeenCalledTimes(1);
    expect(VexPlan.confirmSteps.mock.calls[0][0].steps.map(s => s.label)).toEqual(['1. Open https://example.com/', '2. Timer 15 min', '3. Mute discord']);
    await CommandChains.run(chain);
    expect(VexPlan.confirmSteps).toHaveBeenCalledTimes(1);
    chain.steps.push('wait:1');
    await CommandChains.run(chain);
    expect(VexPlan.confirmSteps).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the person says no', async () => {
    VexPlan.confirmSteps.mockResolvedValueOnce(false);
    const r = await CommandChains.run({ id: 'c', name: 'X', steps: ['open:https://example.com/', 'timer:1 min', 'wait:1'] });
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });

  it('a chain of fewer than three steps, and a scheduled run, never ask', async () => {
    await CommandChains.run({ id: 'c', name: 'Short', steps: ['mute:discord', 'unmute:discord'] });
    await CommandChains.run({ id: 'c', name: 'Long', steps: ['mute:discord', 'unmute:discord', 'wait:1'] }, { preview: false });
    expect(VexPlan.confirmSteps).not.toHaveBeenCalled();
  });
});

describe('running', () => {
  it('runs argument steps through the existing chain runner', async () => {
    const chain = { id: 'c', name: 'Standup', steps: ['open:https://example.com/', 'timer:15 min', 'mute:discord'] };
    const r = await CommandChains.run(chain);
    expect(r.ok).toBe(true);
    expect(TabManager.createTab).toHaveBeenCalledWith('https://example.com/', false);
    expect(timer).toHaveBeenCalledWith('15 min', '');
    expect(WebviewManager.webviews.get(1).setAudioMuted).toHaveBeenCalledWith(true);
  });

  it('names a mute that matched no tab instead of pretending', async () => {
    const r = await CommandChains.run({ id: 'c', name: 'X', steps: ['mute:spotify'] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/No open tab matches/);
  });

  it('a plain command id still runs as before', async () => {
    const r = await CommandChains.run({ id: 'c', name: 'X', steps: ['reading-mode'] });
    expect(r.ok).toBe(true);
    expect(CommandBar.commands[0].action).toHaveBeenCalled();
  });
});
