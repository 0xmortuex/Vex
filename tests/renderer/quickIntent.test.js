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

  // The first version of this matched sentence TEMPLATES, and templates break
  // on the next sentence: it read "make a timer for 10 minutes" and not "make
  // ME a timer for 10 minutes" — the same request with one word in it, which
  // is exactly what was typed next.
  it('finds the request however the sentence is arranged around it', () => {
    expect(plain('make me an timer for 10 minutes')).toBe('timer 10 minutes');
    expect(plain('make me a timer for 10 min')).toBe('timer 10 min');
    expect(plain('set me a timer for 5 minutes')).toBe('timer 5 minutes');
    expect(plain('give me a timer for 1 hour 30 minutes')).toBe('timer 1 hour 30 minutes');
    expect(plain('start a 20 minute timer')).toBe('timer 20 minute');
    expect(plain('set a 5 min countdown')).toBe('timer 5 min');
  });

  // A remark is not an instruction, and a question is not an order however
  // many verbs it has in it.
  it('leaves a question, a remark and an unrelated sentence alone', () => {
    expect(plain('how do I make a timer')).toBe('how do I make a timer');
    expect(plain('what is a timer')).toBe('what is a timer');
    expect(plain('the timer is wrong')).toBe('the timer is wrong');
    expect(plain('make a note of this')).toBe('make a note of this');
    expect(plain('start a video call')).toBe('start a video call');
  });

  // A length it was not given is not one to invent.
  it('hands a timer with no length to the model, which can ask', () => {
    expect(plain('make a timer')).toBe('make a timer');
    expect(VexQuickCommands.intent('make a timer')).toBe(null);
  });

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

// A guide is an explanation, not an action. Treating "how do I split the
// screen" as something Vex had just done meant the question never reached the
// guide card — so the "Do it" button on that card, and "you do it" after it,
// had nothing to act on.
describe('the line between doing and explaining', () => {
  it('a "how do I" question is not something Vex has done', () => {
    expect(VexQuickCommands.intent('how do I make a timer')).toBe(null);
    expect(VexQuickCommands.intent('how do I split the screen')).toBe(null);
  });

  it('but the same subject as an order still is', () => {
    expect(VexQuickCommands.intent('set a timer for 10 minutes').id).toBe('quick-timer');
  });
});
