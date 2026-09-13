// @vitest-environment jsdom
//
// Plain sentences in the command bar. The parsers live elsewhere and have
// their own tests; this checks that the sentence shapes are recognised, the
// pieces land in the right places, and nonsense produces a readable result
// rather than nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');
const { VexClock } = require('../../src/renderer/js/clock-panel.js');
const { VexQuickCommands } = require('../../src/renderer/js/quick-commands.js');
globalThis.VexQuickReminder = VexQuickReminder; globalThis.VexClock = VexClock;

let bridge;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="timer-pill" hidden><span></span></button>';
  bridge = { create: vi.fn(async (message, at, extra) => ({ id: 'r1', message, at, ...(extra || {}), os: { scheduled: true, error: null } })), list: vi.fn(async () => []), delete: vi.fn(async () => ({ ok: true })), onFired: vi.fn(), onClicked: vi.fn() };
  global.window.vex = { reminders: bridge };
  global.window.showToast = vi.fn();
  VexClock._timers = [];
});

describe('remind me …', () => {
  it('splits the task from the time, whichever order', async () => {
    const [a] = VexQuickCommands.results('remind me to call Dana tomorrow 9am');
    expect(a.id).toBe('quick-remind');
    expect(a.label).toBe('Remind me: call Dana');
    expect(a.hint).toMatch(/^Tomorrow at 09:00/);
    const [b] = VexQuickCommands.results('remind me tomorrow 9am to call Dana');
    expect(b.label).toBe('Remind me: call Dana');
    await a.action();
    expect(bridge.create).toHaveBeenCalledWith('call Dana', expect.any(Number), {});
  });
  it('understands a site trigger', async () => {
    const [a] = VexQuickCommands.results('remind me to check the PR when I open github.com');
    expect(a.label).toBe('Remind me: check the PR');
    expect(a.hint).toBe('Next time you open github.com');
    await a.action();
    expect(bridge.create).toHaveBeenCalledWith('check the PR', null, { site: 'github.com' });
  });
  it('says what is missing instead of vanishing', () => {
    const [a] = VexQuickCommands.results('remind me to call Dana');
    expect(a.id).toBe('quick-error');
    expect(a.label).toMatch(/say when/i);
  });
});

describe('timer …', () => {
  it('reads the length and an optional label', async () => {
    const [a] = VexQuickCommands.results('timer 25 min tea');
    expect(a.label).toBe('Timer: 25:00 — tea');
    await a.action();
    expect(VexClock._timers).toHaveLength(1);
    expect(VexClock._timers[0].label).toBe('tea');
  });
  it('refuses a length it cannot read', () => {
    const [a] = VexQuickCommands.results('timer soon');
    expect(a.id).toBe('quick-error');
  });
});

describe('alarm …', () => {
  it('reads a time, days and a label', async () => {
    const [a] = VexQuickCommands.results('alarm 7:30 mon wed fri gym');
    expect(a.label).toBe('Alarm 07:30 Mon Wed Fri — gym');
    await a.action();
    expect(bridge.create).toHaveBeenCalledWith('gym', expect.any(Number), { kind: 'alarm', sound: true, urgent: true, repeat: [1, 3, 5] });
  });
  it('weekdays and every day', () => {
    expect(VexQuickCommands.results('alarm 7am weekdays')[0].label).toBe('Alarm 07:00 Mon Tue Wed Thu Fri');
    expect(VexQuickCommands.results('alarm 7am every day')[0].label).toBe('Alarm 07:00 every day');
    expect(VexQuickCommands.results('alarm 7am')[0].label).toBe('Alarm 07:00 once');
  });
});

describe('what time is it in …', () => {
  it('answers with the city time and offers the world clock', () => {
    const [a] = VexQuickCommands.results('what time is it in Tokyo');
    expect(a.id).toBe('quick-time');
    expect(a.label).toMatch(/^\d{2}:\d{2} in Tokyo$/);
    expect(a.hint).toContain('Asia/Tokyo');
    const [b] = VexQuickCommands.results('istanbul time');
    expect(b.label).toMatch(/in Istanbul$/);
  });
  it('ignores a city it does not know, and a reminder phrasing', () => {
    expect(VexQuickCommands.results('what time is it in Atlantis')).toEqual([]);
    expect(VexQuickCommands.results('9am New York time')).toEqual([]);
  });
});

describe('anything else', () => {
  it('returns nothing so the ordinary results stand', () => {
    expect(VexQuickCommands.results('github')).toEqual([]);
    expect(VexQuickCommands.results('')).toEqual([]);
    expect(VexQuickCommands.results('stopwatch')[0].id).toBe('quick-stopwatch');
  });
});
