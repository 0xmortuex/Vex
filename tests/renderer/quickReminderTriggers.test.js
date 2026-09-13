// @vitest-environment jsdom
//
// "When?" can be a place, a reminder can be about a page, repeat, or be
// urgent, and a timed one can leave as a calendar entry.
import { describe, it, expect, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexQuickReminder } = require('../../src/renderer/js/quick-reminder.js');

const NOW = new Date(2026, 8, 13, 14, 30, 0, 0);   // Sunday
const at = (text) => VexQuickReminder.parseWhen(text, NOW);

function fakeBridge() {
  const bridge = {
    create: vi.fn(async (message, atMs, extra) => ({ id: 'r1', message, at: atMs, ...(extra || {}), os: { scheduled: true, error: null } })),
    list: vi.fn(async () => []), delete: vi.fn(async () => ({ ok: true })), onFired: vi.fn(), onClicked: vi.fn(),
  };
  global.window.vex = { reminders: bridge };
  global.window.showToast = vi.fn();
  return bridge;
}

describe('a site as the trigger', () => {
  it('reads the phrasings people use', () => {
    expect(VexQuickReminder.parseTrigger('when I open github.com', NOW)).toEqual({ site: 'github.com' });
    expect(VexQuickReminder.parseTrigger('next time I open https://www.reddit.com/r/x', NOW)).toEqual({ site: 'reddit.com' });
    expect(VexQuickReminder.parseTrigger('on discord.com', NOW)).toEqual({ site: 'discord.com' });
  });
  it('still reads a time', () => {
    expect(VexQuickReminder.parseTrigger('tomorrow 9am', NOW).at.getTime()).toBe(at('tomorrow 9am').getTime());
  });
  it('refuses something that is not a site', () => {
    expect(() => VexQuickReminder.parseTrigger('when I open the fridge', NOW)).toThrow(/does not look like a site/);
  });
  it('describes it in words', () => {
    expect(VexQuickReminder.describeTrigger({ site: 'github.com' })).toBe('Next time you open github.com');
  });
  it('hands a site reminder to the main process without a time', async () => {
    const bridge = fakeBridge();
    await VexQuickReminder.create('Check the PR', { site: 'github.com' }, { url: 'https://github.com/x', urgent: true });
    expect(bridge.create).toHaveBeenCalledWith('Check the PR', null, { url: 'https://github.com/x', urgent: true, site: 'github.com' });
  });
  it('passes repeat and page through for a timed one', async () => {
    const bridge = fakeBridge();
    const when = at('tomorrow 9am');
    await VexQuickReminder.create('Stand up', when, { repeat: 'weekdays', url: 'https://example.com/' });
    expect(bridge.create).toHaveBeenCalledWith('Stand up', when.getTime(), { url: 'https://example.com/', repeat: 'weekdays' });
  });
});

describe('the dialog with a page in hand', () => {
  it('offers "when I open this site" and "About this page", and sends the link', async () => {
    const bridge = fakeBridge();
    document.body.innerHTML = '';
    VexQuickReminder.open('Reply to Dana', { url: 'https://discord.com/channels/1/2/3', title: 'Discord | #general' });
    const chips = [...document.querySelectorAll('.qr-chip')].map(c => c.dataset.when);
    expect(chips).toContain('when I open discord.com');
    expect(document.getElementById('qr-page').checked).toBe(true);
    document.getElementById('qr-when').value = 'tomorrow 9am';
    document.getElementById('qr-repeat').value = 'weekdays';
    document.getElementById('qr-urgent').checked = true;
    document.getElementById('qr-save').click();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(bridge.create).toHaveBeenCalledWith('Reply to Dana', expect.any(Number), { repeat: 'weekdays', urgent: true, url: 'https://discord.com/channels/1/2/3' });
  });

  it('disables repeat for a site trigger', () => {
    fakeBridge();
    document.body.innerHTML = '';
    VexQuickReminder.open('x');
    const when = document.getElementById('qr-when');
    when.value = 'when I open github.com'; when.dispatchEvent(new Event('input'));
    expect(document.getElementById('qr-repeat').disabled).toBe(true);
    expect(document.getElementById('qr-preview').textContent).toBe('Next time you open github.com');
    when.value = 'tomorrow 9am'; when.dispatchEvent(new Event('input'));
    expect(document.getElementById('qr-repeat').disabled).toBe(false);
  });
});

describe('a time in another city', () => {
  const { VexClock } = require('../../src/renderer/js/clock-panel.js');
  globalThis.VexClock = VexClock;
  const jan = new Date(2026, 0, 15, 8, 0);   // local January morning; no DST anywhere relevant

  it('reads "9am New York time" as that city\'s wall clock', () => {
    const t = VexQuickReminder.parseTrigger('tomorrow 9am New York time', jan);
    expect(t.zone).toEqual({ name: 'New York', zone: 'America/New_York' });
    expect(t.at.getTime()).toBe(Date.UTC(2026, 0, 16, 14, 0));
    expect(VexQuickReminder.describeTrigger(t, jan)).toMatch(/\(09:00 in New York\)$/);
  });
  it('accepts "in Tokyo" and an IANA zone', () => {
    expect(VexQuickReminder.parseTrigger('tomorrow 17:00 in Tokyo', jan).at.getTime()).toBe(Date.UTC(2026, 0, 16, 8, 0));
    expect(VexQuickReminder.parseTrigger('tomorrow noon Asia/Kolkata', jan).at.getTime()).toBe(Date.UTC(2026, 0, 16, 6, 30));
  });
  it('does not mistake a weekday or a unit for a city', () => {
    expect(VexQuickReminder.parseTrigger('friday 17:00', jan).zone).toBeUndefined();
    expect(VexQuickReminder.parseTrigger('in 2 hours', jan).zone).toBeUndefined();
    expect(VexQuickReminder.parseTrigger('tomorrow 9am', jan).zone).toBeUndefined();
  });
  it('still refuses a moment already past in that city', () => {
    // 08:00 local; asking for 00:30 "today" in a zone far ahead can already be gone.
    expect(() => VexQuickReminder.parseTrigger('today 00:30 in Tokyo', jan)).toThrow(/already passed|at least a minute/);
  });
});

describe('a calendar entry', () => {
  const r = { id: 'r1', message: 'Dentist, ask about the referral', at: Date.UTC(2026, 8, 20, 9, 0), url: 'https://example.com/booking', repeat: 'weekly' };
  it('is a valid single-event iCalendar file', () => {
    const ics = VexQuickReminder.ics(r);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:r1@vex');
    expect(ics).toContain('DTSTART:20260920T090000Z');
    expect(ics).toContain('SUMMARY:Dentist\\, ask about the referral');
    expect(ics).toContain('URL:https://example.com/booking');
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every(l => l.length <= 75)).toBe(true);
  });
  it('refuses a site reminder, which has no time', () => {
    expect(() => VexQuickReminder.ics({ id: 'r2', message: 'x', at: null, site: 'github.com' })).toThrow(/timed reminder/);
  });
  it('saves through the main process and reports the path', async () => {
    fakeBridge();
    global.window.vex.saveTextFile = vi.fn(async (name, text, kind) => ({ ok: true, path: 'C:\\Users\\u\\Downloads\\' + name }));
    const p = await VexQuickReminder.saveToCalendar(r);
    expect(global.window.vex.saveTextFile).toHaveBeenCalledWith('reminder-dentist-ask-about-the-referral.ics', expect.stringContaining('BEGIN:VCALENDAR'), 'ics');
    expect(p).toMatch(/\.ics$/);
  });
  it('returns null when the person cancelled the save', async () => {
    fakeBridge();
    global.window.vex.saveTextFile = vi.fn(async () => ({ ok: false, cancelled: true }));
    expect(await VexQuickReminder.saveToCalendar(r)).toBe(null);
  });
});
