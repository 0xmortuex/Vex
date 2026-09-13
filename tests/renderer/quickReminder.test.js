// @vitest-environment jsdom
//
// Quick reminder: paste the task, say when.
//
// The parser is the part that can silently ruin the feature — a reminder that
// lands at the wrong hour is worse than one that refuses to be set — so it is a
// pure function of (text, now) and every case below pins a fixed clock.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');
globalThis.VexQuickReminder = VexQuickReminder;

// Sunday 13 September 2026, 14:30 local.
const NOW = new Date(2026, 8, 13, 14, 30, 0, 0);
const at = (text, now = NOW) => VexQuickReminder.parseWhen(text, now);
const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('reading "in ..."', () => {
  it('handles minutes, hours, days and weeks', () => {
    expect(at('in 30 minutes').getTime()).toBe(new Date(2026, 8, 13, 15, 0).getTime());
    expect(at('in 2 hours').getTime()).toBe(new Date(2026, 8, 13, 16, 30).getTime());
    expect(at('in 3 days').getTime()).toBe(new Date(2026, 8, 16, 14, 30).getTime());
    expect(at('in 1 week').getTime()).toBe(new Date(2026, 8, 20, 14, 30).getTime());
  });

  it('accepts the short forms', () => {
    expect(at('in 45m').getTime()).toBe(new Date(2026, 8, 13, 15, 15).getTime());
    expect(at('in 2h').getTime()).toBe(at('in 2 hours').getTime());
    expect(at('in 1d').getTime()).toBe(at('in 1 day').getTime());
  });

  it('rejects a unit it does not know rather than guessing', () => {
    expect(() => at('in 5 fortnights')).toThrow(/not a length of time/i);
  });
});

describe('reading a day', () => {
  it('understands today and tomorrow', () => {
    expect(ymd(at('tomorrow'))).toBe('2026-09-14');
    expect(hhmm(at('tomorrow'))).toBe('09:00');          // the stated default
    expect(ymd(at('tomorrow 9am'))).toBe('2026-09-14');
    expect(hhmm(at('tomorrow 9am'))).toBe('09:00');
    expect(hhmm(at('today 6pm'))).toBe('18:00');
  });

  it('puts tonight at 8pm', () => {
    expect(hhmm(at('tonight'))).toBe('20:00');
    expect(ymd(at('tonight'))).toBe('2026-09-13');
  });

  it('reads a weekday as the next one still to come', () => {
    // NOW is a Sunday.
    expect(ymd(at('friday'))).toBe('2026-09-18');
    expect(ymd(at('monday'))).toBe('2026-09-14');
    expect(ymd(at('fri 17:00'))).toBe('2026-09-18');
    expect(hhmm(at('fri 17:00'))).toBe('17:00');
  });

  it('treats "next friday" and "friday" the same', () => {
    expect(at('next friday').getTime()).toBe(at('friday').getTime());
  });

  it('rolls to next week when today\'s slot has gone', () => {
    // NOW is Sunday 14:30, so Sunday 09:00 has been and gone: next Sunday.
    expect(ymd(at('sunday 9am'))).toBe('2026-09-20');
    // But an hour still ahead today stays today.
    expect(ymd(at('sunday 6pm'))).toBe('2026-09-13');
    // A different weekday just takes the next one.
    expect(ymd(at('wednesday 9am'))).toBe('2026-09-16');
  });

  it('takes an explicit date', () => {
    expect(ymd(at('2026-09-20 14:00'))).toBe('2026-09-20');
    expect(hhmm(at('2026-09-20 14:00'))).toBe('14:00');
    expect(hhmm(at('2026-09-20'))).toBe('09:00');
  });

  it('refuses a date that does not exist', () => {
    expect(() => at('2026-02-30')).toThrow(/not a real date/i);
  });
});

describe('reading a bare time', () => {
  it('means today when it is still ahead', () => {
    expect(ymd(at('6pm'))).toBe('2026-09-13');
    expect(hhmm(at('6pm'))).toBe('18:00');
  });

  it('means tomorrow when it has passed', () => {
    expect(ymd(at('9am'))).toBe('2026-09-14');
    expect(hhmm(at('9am'))).toBe('09:00');
  });

  it('handles both clocks and the named hours', () => {
    expect(hhmm(at('17:45'))).toBe('17:45');
    expect(hhmm(at('5:45pm'))).toBe('17:45');
    expect(hhmm(at('noon'))).toBe('12:00');
    expect(hhmm(at('midnight'))).toBe('00:00');
    expect(hhmm(at('12am'))).toBe('00:00');
    expect(hhmm(at('12pm'))).toBe('12:00');
  });

  it('ignores a leading "at" and a "remind me"', () => {
    expect(at('at 6pm').getTime()).toBe(at('6pm').getTime());
    expect(at('remind me tomorrow 9am').getTime()).toBe(at('tomorrow 9am').getTime());
  });

  it('refuses an impossible time', () => {
    expect(() => at('25:00')).toThrow(/no 25 o'clock/i);
    expect(() => at('10:75')).toThrow(/no minute 75/i);
    expect(() => at('13pm')).toThrow(/1 to 12/i);
  });
});

describe('refusing rather than guessing', () => {
  it('says so when it cannot read the text at all', () => {
    expect(() => at('sometime soonish')).toThrow(/could not read/i);
    expect(() => at('')).toThrow(/say when/i);
  });

  it('will not set a reminder in the past', () => {
    expect(() => at('2020-01-01')).toThrow(/already passed/i);
  });

  it('will not set one under a minute away, because it stores minutes', () => {
    expect(() => at('in 30 seconds')).toThrow(/not a length of time|at least a minute/i);
  });

  it('survives a DST boundary without drifting an hour', () => {
    // "tomorrow 9am" is 9am whatever the clocks do overnight. Built from
    // wall-clock fields, so this holds in any zone the test runs in.
    const eveBeforeChange = new Date(2026, 9, 24, 22, 0);
    const when = VexQuickReminder.parseWhen('tomorrow 9am', eveBeforeChange);
    expect(hhmm(when)).toBe('09:00');
    expect(ymd(when)).toBe('2026-10-25');
  });
});

describe('describing what it read back', () => {
  it('names the day in words a person would use', () => {
    expect(VexQuickReminder.describe(at('in 2 hours'), NOW)).toMatch(/^Today at 16:30/);
    expect(VexQuickReminder.describe(at('tomorrow 9am'), NOW)).toMatch(/^Tomorrow at 09:00/);
    expect(VexQuickReminder.describe(at('friday 17:00'), NOW)).toMatch(/^Friday at 17:00/);
    expect(VexQuickReminder.describe(at('in 3 weeks'), NOW)).toMatch(/^4 Oct at 14:30/);
  });

  it('says how far away it is', () => {
    expect(VexQuickReminder.describe(at('in 30 minutes'), NOW)).toContain('30 minutes from now');
    expect(VexQuickReminder.describe(at('in 2 hours'), NOW)).toContain('2 hours from now');
  });
});

// The main process owns reminders (src/main/reminders.js); the renderer hands
// them over through the preload bridge. These check the hand-over.
function fakeBridge({ os = { scheduled: true, error: null } } = {}) {
  const created = [];
  let items = [];
  const bridge = {
    create: vi.fn(async (message, atMs) => { const r = { id: 'r' + (created.length + 1), message, at: atMs, firedAt: null, os }; created.push(r); items.push(r); return { ...r }; }),
    list: vi.fn(async () => items.map(r => ({ ...r }))),
    delete: vi.fn(async (id) => { items = items.filter(r => r.id !== id); return { ok: true, osError: null }; }),
    onFired: vi.fn(),
    onClicked: vi.fn(),
  };
  return { bridge, created };
}

describe('creating a reminder', () => {
  let created, bridge;
  beforeEach(() => {
    ({ bridge, created } = fakeBridge());
    global.window.vex = { reminders: bridge };
    global.window.showToast = vi.fn();
  });

  it('hands the text and the moment, in epoch milliseconds, to the main process', async () => {
    const when = at('tomorrow 9am');
    const r = await VexQuickReminder.create('Email the landlord about the boiler', when);
    expect(bridge.create).toHaveBeenCalledWith('Email the landlord about the boiler', when.getTime());
    expect(r.os.scheduled).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('trims the message before sending it', async () => {
    await VexQuickReminder.create('  Call the dentist  ', at('tomorrow'));
    expect(created[0].message).toBe('Call the dentist');
  });

  it('refuses an empty message instead of setting a blank reminder', async () => {
    await expect(VexQuickReminder.create('   ', at('tomorrow'))).rejects.toThrow(/write what/i);
    expect(created).toHaveLength(0);
  });

  it('refuses a message too long for a toast', async () => {
    await expect(VexQuickReminder.create('x'.repeat(2001), at('tomorrow'))).rejects.toThrow(/longer than/i);
  });

  it('says so when the bridge is not there', async () => {
    delete global.window.vex;
    await expect(VexQuickReminder.create('x', at('tomorrow'))).rejects.toThrow(/not available/i);
  });
});

describe('mirroring a fired reminder in-app', () => {
  it('shows it, and says out loud when the desktop toast was refused', () => {
    const { bridge } = fakeBridge();
    global.window.vex = { reminders: bridge };
    global.window.showToast = vi.fn();
    expect(VexQuickReminder.init()).toBe(true);
    const handler = bridge.onFired.mock.calls[0][0];
    handler({ id: 'r1', message: 'Stand up', at: NOW.getTime(), late: false, delivered: 'toast', error: null });
    expect(window.showToast).toHaveBeenCalledWith('Reminder: Stand up');
    handler({ id: 'r2', message: 'Bins', at: NOW.getTime(), late: true, delivered: 'failed', error: 'toasts are off' });
    expect(window.showToast).toHaveBeenCalledWith('Reminder (was due 14:30): Bins');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/did not show.*toasts are off/), 'error');
  });

  it('reports rather than crashes when the bridge is missing', () => {
    delete global.window.vex;
    expect(VexQuickReminder.init()).toBe(false);
  });
});

describe('the dialog', () => {
  let bridge;
  const tick = () => new Promise(r => setTimeout(r, 0));
  beforeEach(() => {
    document.body.innerHTML = '';
    ({ bridge } = fakeBridge());
    global.window.vex = { reminders: bridge };
    global.window.showToast = vi.fn();
  });

  it('lists what is already set, and can take one back', async () => {
    await bridge.create('Pay the invoice', NOW.getTime() + 3600000);
    VexQuickReminder.open();
    await tick();
    const rows = document.querySelectorAll('.qr-up');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Pay the invoice');
    expect(document.getElementById('qr-upcoming').hidden).toBe(false);
    rows[0].querySelector('.qr-up-x').click();
    await tick(); await tick();
    expect(bridge.delete).toHaveBeenCalledWith('r1');
    expect(document.querySelectorAll('.qr-up')).toHaveLength(0);
    expect(document.getElementById('qr-upcoming').hidden).toBe(true);
  });

  it('warns when Windows will not wake Vex for it', async () => {
    ({ bridge } = fakeBridge({ os: { scheduled: false, error: 'Access is denied' } }));
    global.window.vex = { reminders: bridge };
    VexQuickReminder.open('Something');
    document.getElementById('qr-when').value = 'tomorrow 9am';
    document.getElementById('qr-save').click();
    await tick(); await tick();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/will not wake Vex.*Access is denied/), 'error');
    expect(document.getElementById('vex-quick-reminder')).toBe(null);
  });

  it('opens with both fields and the quick choices', () => {
    VexQuickReminder.open();
    expect(document.getElementById('qr-text')).toBeTruthy();
    expect(document.getElementById('qr-when')).toBeTruthy();
    expect(document.querySelectorAll('.qr-chip').length).toBeGreaterThan(2);
  });

  it('pre-fills the task when text was selected', () => {
    VexQuickReminder.open('Write the report');
    expect(document.getElementById('qr-text').value).toBe('Write the report');
  });

  it('shows what it understood as you type', () => {
    VexQuickReminder.open();
    const when = document.getElementById('qr-when');
    when.value = 'in 2 hours';
    when.dispatchEvent(new Event('input'));
    const preview = document.getElementById('qr-preview');
    expect(preview.textContent).toMatch(/at \d{2}:\d{2}/);
    expect(preview.className).toContain('qr-ok');
  });

  it('shows the reason when it cannot read the time', () => {
    VexQuickReminder.open();
    const when = document.getElementById('qr-when');
    when.value = 'whenever';
    when.dispatchEvent(new Event('input'));
    const preview = document.getElementById('qr-preview');
    expect(preview.textContent).toMatch(/could not read/i);
    expect(preview.className).toContain('qr-bad');
  });

  it('a chip fills the when box', () => {
    VexQuickReminder.open();
    document.querySelector('.qr-chip').click();
    expect(document.getElementById('qr-when').value).toBeTruthy();
  });

  it('saves through the bridge and closes', async () => {
    VexQuickReminder.open('Pay the invoice');
    document.getElementById('qr-when').value = 'tomorrow 9am';
    document.getElementById('qr-save').click();
    await tick(); await tick();
    expect(bridge.create).toHaveBeenCalledWith('Pay the invoice', expect.any(Number));
    expect(document.getElementById('vex-quick-reminder')).toBe(null);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Reminder set — Tomorrow at 09:00/));
  });

  it('will not save without a message, and stays open to say so', async () => {
    VexQuickReminder.open();
    document.getElementById('qr-when').value = 'tomorrow';
    document.getElementById('qr-save').click();
    await tick();
    expect(bridge.create).not.toHaveBeenCalled();
    expect(document.getElementById('vex-quick-reminder')).toBeTruthy();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/write what/i), 'error');
  });

  it('will not save an unreadable time, and stays open', async () => {
    VexQuickReminder.open('Something');
    document.getElementById('qr-when').value = 'later maybe';
    document.getElementById('qr-save').click();
    await tick();
    expect(bridge.create).not.toHaveBeenCalled();
    expect(document.getElementById('vex-quick-reminder')).toBeTruthy();
  });

  it('stays open and re-enables the button when the main process refuses', async () => {
    bridge.create.mockRejectedValueOnce(new Error('Reminders have not started yet'));
    VexQuickReminder.open('Something');
    document.getElementById('qr-when').value = 'tomorrow';
    document.getElementById('qr-save').click();
    await tick(); await tick();
    expect(document.getElementById('vex-quick-reminder')).toBeTruthy();
    expect(document.getElementById('qr-save').disabled).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Reminders have not started yet', 'error');
  });

  it('replaces an already-open dialog rather than stacking them', () => {
    VexQuickReminder.open();
    VexQuickReminder.open();
    expect(document.querySelectorAll('#vex-quick-reminder').length).toBe(1);
  });
});

// Clicking a reminder's desktop toast opens the reminder itself in Vex, with a
// way to push it back rather than lose it.
describe('the reminder card', () => {
  let bridge;
  const tick = () => new Promise(r => setTimeout(r, 0));
  beforeEach(async () => {
    document.body.innerHTML = '';
    ({ bridge } = fakeBridge());
    global.window.vex = { reminders: bridge };
    global.window.showToast = vi.fn();
    await bridge.create('Send the invoice to Dana', NOW.getTime() + 60000);
  });

  it('opens from a toast click with the full text and when it was due', async () => {
    expect(VexQuickReminder.init()).toBe(true);
    const onClicked = bridge.onClicked.mock.calls[0][0];
    onClicked({ id: 'r1' });
    await tick(); await tick();
    const card = document.getElementById('vex-reminder-card');
    expect(card).toBeTruthy();
    expect(card.querySelector('#qr-card-text').textContent).toBe('Send the invoice to Dana');
    // Still ahead, so "Due"; once fired it reads "Was due".
    expect(card.querySelector('#qr-card-when').textContent).toMatch(/^Due /);
  });

  it('snoozes by creating a new reminder for the same text', async () => {
    await VexQuickReminder.showCard('r1');
    document.querySelector('[data-snooze="600000"]').click();
    await tick(); await tick();
    expect(bridge.create).toHaveBeenLastCalledWith('Send the invoice to Dana', expect.any(Number));
    const [, atMs] = bridge.create.mock.calls.at(-1);
    expect(atMs - Date.now()).toBeGreaterThan(9 * 60000);
    expect(atMs - Date.now()).toBeLessThanOrEqual(10 * 60000);
    expect(document.getElementById('vex-reminder-card')).toBe(null);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Snoozed/));
  });

  it('Done closes it without creating anything', async () => {
    const before = bridge.create.mock.calls.length;
    await VexQuickReminder.showCard('r1');
    document.getElementById('qr-card-done').click();
    expect(document.getElementById('vex-reminder-card')).toBe(null);
    expect(bridge.create.mock.calls.length).toBe(before);
  });

  it('says so when the reminder is no longer stored', async () => {
    const r = await VexQuickReminder.showCard('missing');
    expect(r).toBe(null);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/no longer stored/i), 'error');
  });

  it('opens the card itself when the desktop toast was refused', async () => {
    VexQuickReminder.init();
    const onFired = bridge.onFired.mock.calls[0][0];
    onFired({ id: 'r1', message: 'Send the invoice to Dana', at: NOW.getTime(), late: false, delivered: 'failed', error: 'toasts are off' });
    await tick(); await tick();
    expect(document.getElementById('vex-reminder-card')).toBeTruthy();
  });
});
