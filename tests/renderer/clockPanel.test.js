// @vitest-environment jsdom
//
// The Clock: durations and zones are the parts that can be quietly wrong, so
// they are pinned here; the timer and ringing paths are checked against a
// fake bridge.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexClock } = require('../../src/renderer/js/clock-panel.js');

describe('reading a duration', () => {
  it('understands the ways people write one', () => {
    expect(VexClock.parseDuration('25 min')).toBe(25 * 60000);
    expect(VexClock.parseDuration('1h 30')).toBe(90 * 60000);
    expect(VexClock.parseDuration('1h30m')).toBe(90 * 60000);
    expect(VexClock.parseDuration('90s')).toBe(90000);
    expect(VexClock.parseDuration('10:00')).toBe(10 * 60000);
    expect(VexClock.parseDuration('1:02:03')).toBe((3600 + 120 + 3) * 1000);
    expect(VexClock.parseDuration('7')).toBe(7 * 60000);        // a bare number is minutes
  });
  it('refuses nonsense, nothing, and absurd lengths', () => {
    expect(() => VexClock.parseDuration('soon')).toThrow(/could not read/i);
    expect(() => VexClock.parseDuration('')).toThrow(/how long/i);
    expect(() => VexClock.parseDuration('0.5s')).toThrow(/at least a second/i);
    expect(() => VexClock.parseDuration('30 hours')).toThrow(/at most 24 hours/i);
  });
  it('formats what is left', () => {
    expect(VexClock.fmtLeft(90 * 1000)).toBe('1:30');
    expect(VexClock.fmtLeft(3661 * 1000)).toBe('1:01:01');
    expect(VexClock.fmtLeft(-5)).toBe('0:00');
    expect(VexClock.fmtStopwatch(61234)).toBe('01:01.23');
    expect(VexClock.fmtStopwatch(3600000)).toBe('1:00:00.00');
  });
});

describe('time zones', () => {
  it('maps cities and accepts IANA names, and rejects the rest', () => {
    expect(VexClock.zoneFor('new york')).toEqual({ name: 'New York', zone: 'America/New_York' });
    expect(VexClock.zoneFor('Istanbul').zone).toBe('Europe/Istanbul');
    expect(VexClock.zoneFor('Asia/Tokyo')).toEqual({ name: 'Tokyo', zone: 'Asia/Tokyo' });
    expect(VexClock.zoneFor('Atlantis')).toBe(null);
  });
  it('reads a moment in a zone, with its offset', () => {
    const ms = Date.UTC(2026, 0, 15, 12, 0);              // January: no DST anywhere relevant
    expect(VexClock.partsIn('America/New_York', ms)).toMatchObject({ hour: 7, minute: 0, day: 15 });
    expect(VexClock.partsIn('Asia/Tokyo', ms)).toMatchObject({ hour: 21, day: 15 });
    expect(VexClock.offsetMinutes('America/New_York', ms)).toBe(-300);
    expect(VexClock.offsetMinutes('Asia/Kolkata', ms)).toBe(330);
    expect(VexClock.offsetMinutes('UTC', ms)).toBe(0);
  });
  it('finds the instant of a wall-clock time in a zone, across a clock change', () => {
    // 09:00 in New York on 15 July is 13:00 UTC (EDT); on 15 January it is 14:00 UTC (EST).
    expect(VexClock.instantIn('America/New_York', { year: 2026, month: 7, day: 15, hour: 9, minute: 0 })).toBe(Date.UTC(2026, 6, 15, 13, 0));
    expect(VexClock.instantIn('America/New_York', { year: 2026, month: 1, day: 15, hour: 9, minute: 0 })).toBe(Date.UTC(2026, 0, 15, 14, 0));
    expect(VexClock.instantIn('Asia/Kolkata', { year: 2026, month: 1, day: 15, hour: 9, minute: 30 })).toBe(Date.UTC(2026, 0, 15, 4, 0));
  });
});

describe('timers and ringing', () => {
  let bridge;
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<button id="timer-pill" hidden><span></span></button>';
    bridge = {
      create: vi.fn(async (message, at, extra) => ({ id: 'r' + Math.random().toString(36).slice(2, 6), message, at, ...extra, os: { scheduled: true, error: null } })),
      delete: vi.fn(async () => ({ ok: true })), list: vi.fn(async () => []), ack: vi.fn(async () => ({ ok: true })), onFired: vi.fn(), onClicked: vi.fn(),
    };
    global.window.vex = { reminders: bridge, focusWindow: vi.fn() };
    global.window.showToast = vi.fn();
    VexClock._timers = [];
    VexClock.stopSound();
  });

  it('a timer of a minute or more also lives in the main process; a shorter one does not', async () => {
    const long = await VexClock.addTimer('5 min', 'Tea');
    expect(long.reminderId).toBeTruthy();
    expect(bridge.create).toHaveBeenCalledWith('Tea', long.endAt, { kind: 'timer', sound: true, urgent: true });
    const short = await VexClock.addTimer('30s');
    expect(short.reminderId).toBe(null);
    expect(bridge.create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('vex.clock.timers'))).toHaveLength(2);
    expect(document.getElementById('timer-pill').hidden).toBe(false);
  });

  it('stopping a timer removes its main-process reminder too', async () => {
    const t = await VexClock.addTimer('5 min');
    await VexClock.removeTimer(t.id);
    expect(bridge.delete).toHaveBeenCalledWith(t.reminderId);
    expect(VexClock._timers).toEqual([]);
    expect(document.getElementById('timer-pill').hidden).toBe(true);
  });

  it('rings until dismissed, then records the dismissal', async () => {
    const wrap = VexClock.ring({ id: 'r1', title: 'Alarm', message: 'Wake up', kind: 'alarm', snoozable: true });
    expect(document.getElementById('vex-ringing')).toBeTruthy();
    expect(wrap.querySelector('.ck-ring-text').textContent).toMatch(/^Wake up/);
    expect(wrap.querySelector('#ck-snooze')).toBeTruthy();
    wrap.querySelector('#ck-dismiss').click();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('vex-ringing')).toBe(null);
    expect(bridge.ack).toHaveBeenCalledWith('r1');
    expect(bridge.create).not.toHaveBeenCalled();
  });

  it('snooze sets a new alarm nine minutes out', async () => {
    const wrap = VexClock.ring({ id: 'r1', title: 'Alarm', message: 'Wake up', kind: 'alarm', snoozable: true });
    wrap.querySelector('#ck-snooze').click();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(bridge.create).toHaveBeenCalledWith('Wake up', expect.any(Number), { kind: 'alarm', sound: true, urgent: true });
    const at = bridge.create.mock.calls[0][1];
    expect(at - Date.now()).toBeGreaterThan(8 * 60000);
  });

  it('a timer never offers snooze', () => {
    const wrap = VexClock.ring({ id: null, title: 'Timer', message: 'Tea', kind: 'timer', snoozable: false });
    expect(wrap.querySelector('#ck-snooze')).toBe(null);
    wrap.querySelector('#ck-dismiss').click();
  });

  it('on start, rings an alarm that fired recently and was never dismissed', async () => {
    bridge.list = vi.fn(async () => [
      { id: 'old', kind: 'alarm', sound: true, message: 'Old', firedAt: Date.now() - 60 * 60000, ackedAt: null },
      { id: 'fresh', kind: 'alarm', sound: true, message: 'Fresh', firedAt: Date.now() - 2 * 60000, ackedAt: null },
      { id: 'done', kind: 'alarm', sound: true, message: 'Done', firedAt: Date.now() - 60000, ackedAt: Date.now() - 30000 },
    ]);
    VexClock.init();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    const ring = document.getElementById('vex-ringing');
    expect(ring).toBeTruthy();
    expect(ring.querySelector('.ck-ring-text').textContent).toMatch(/^Fresh/);
    ring.querySelector('#ck-dismiss').click();
  });
});
