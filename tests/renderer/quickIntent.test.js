// @vitest-environment jsdom
//
// Asked "make an timer for 10 minutes", Vex replied with three paragraphs
// about how a countdown works, steps for a button that does not exist, and an
// offer to explain alarms next. It had the clock, the duration parser and the
// Windows wake-up all along — nothing connected them to the assistant.
//
// The fix is deliberately not a cleverer model: it is recognising the
// sentence before any model is consulted. So what is pinned here is the
// recognising.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexQuickCommands } = require('../../src/renderer/js/quick-commands.js');
globalThis.VexQuickCommands = VexQuickCommands;

beforeEach(() => {
  globalThis.VexClock = {
    parseDuration: (t) => {
      const m = String(t).match(/^(\d+)\s*(m|min|mins|minute|minutes)$/i);
      if (m) return Number(m[1]) * 60000;
      const s = String(t).match(/^(\d+)\s*(s|sec|secs|second|seconds)$/i);
      if (s) return Number(s[1]) * 1000;
      throw new Error('not a duration');
    },
    fmtLeft: (ms) => Math.round(ms / 60000) + ':00',
    addTimer: vi.fn(async () => ({ id: 't1', label: 'Timer', total: 600000 })),
  };
});

describe('saying it the way people say it', () => {
  const plain = (q) => VexQuickCommands.plainly(q);

  it('strips the politeness and the filler', () => {
    expect(plain('make an timer for 10 minutes')).toBe('timer 10 minutes');
    expect(plain('Can you please set a timer for 25 min?')).toBe('timer 25 min');
    expect(plain('hey vex start a stopwatch')).toBe('stopwatch');
    expect(plain('make a countdown of 1h 30')).toBe('timer 1h 30');
    expect(plain('set an alarm for 7am weekdays')).toBe('alarm 7am weekdays');
  });

  // The start word only comes off in front of a thing Vex owns, or "make a
  // note of this" would become "note of this" and "start a video" nonsense.
  it('leaves sentences that are not about a timer alone', () => {
    expect(plain('make a note of this')).toBe('make a note of this');
    expect(plain('start a video call')).toBe('start a video call');
    expect(plain('what is the capital of France')).toBe('what is the capital of France');
  });

  it('leaves the shapes that already parsed exactly as they were', () => {
    expect(plain('timer 25 min')).toBe('timer 25 min');
    expect(plain('remind me to call Dana tomorrow 9am')).toBe('remind me to call Dana tomorrow 9am');
  });
});

describe('what Vex can do without a model', () => {
  it('recognises an order it can carry out', () => {
    const hit = VexQuickCommands.intent('make an timer for 10 minutes');
    expect(hit).toBeTruthy();
    expect(hit.id).toBe('quick-timer');
    expect(hit.label).toMatch(/Timer/);
  });

  it('returns nothing for a question, so it goes to the model as before', () => {
    expect(VexQuickCommands.intent('what is the capital of France')).toBe(null);
    expect(VexQuickCommands.intent('explain this page to me')).toBe(null);
    expect(VexQuickCommands.intent('')).toBe(null);
  });

  // A duration it cannot read must NOT be acted on silently — the model is a
  // better answer than a wrong timer.
  it('returns nothing when the duration makes no sense', () => {
    expect(VexQuickCommands.intent('make a timer for a little while')).toBe(null);
  });

  it('actually starts the timer when it is run', async () => {
    const hit = VexQuickCommands.intent('set a timer for 10 minutes');
    await hit.action();
    expect(VexClock.addTimer).toHaveBeenCalled();
  });
});
