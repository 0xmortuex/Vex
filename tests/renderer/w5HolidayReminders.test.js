// @vitest-environment jsdom
// T3-084: reminders skip holidays (opt in). VexHolidays.reminderAt moves a timed reminder that lands on a
// whole-day holiday to the next workday; QuickReminder, the deadline extractor and follow-ups call it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let H;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  ({ VexHolidays: H } = fresh(JS + 'holidays.js'));
  globalThis.VexLedger = { note: vi.fn() };
});

describe('reminders skip holidays', () => {
  const cumhuriyet = new Date(2026, 9, 29, 9, 30).getTime(); // Thursday, a whole-day holiday
  it('is off until you switch it on: the time is returned unchanged', () => {
    expect(H.skipsReminders()).toBe(false);
    expect(H.reminderAt(cumhuriyet, 'x')).toBe(cumhuriyet);
    expect(globalThis.VexLedger.note).not.toHaveBeenCalled();
  });
  it('moves a holiday reminder to the same time on the next workday and records it', () => {
    H.setSkipsReminders(true);
    const at = H.reminderAt(cumhuriyet, 'Pay rent');
    const d = new Date(at);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 30, 9, 30]);
    expect(globalThis.VexLedger.note).toHaveBeenCalledTimes(1);
    expect(globalThis.VexLedger.note.mock.calls[0][0].what).toMatch(/Pay rent/);
  });
  it('skips the weekend after a holiday too, but leaves a plain weekend reminder alone', () => {
    H.setSkipsReminders(true);
    const fri = new Date(2026, 4, 1, 8, 0).getTime(); // 1 May 2026, Friday and a holiday -> Monday 4 May
    expect(new Date(H.reminderAt(fri)).getDate()).toBe(4);
    const sat = new Date(2026, 4, 2, 8, 0).getTime();
    expect(H.reminderAt(sat)).toBe(sat);
  });
  it('does nothing when the whole holiday feature is off or on a half day', () => {
    H.setSkipsReminders(true);
    const arife = new Date(2026, 9, 28, 15, 0).getTime();
    expect(H.reminderAt(arife)).toBe(arife);
    H.setEnabled(false);
    expect(H.reminderAt(cumhuriyet)).toBe(cumhuriyet);
  });
  it('is called where reminders are scheduled', () => {
    const q = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/quick-reminder.js'), 'utf8');
    const d = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/deadline-extractor.js'), 'utf8');
    const f = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/follow-ups.js'), 'utf8');
    for (const s of [q, d, f]) expect(s).toContain('VexHolidays.reminderAt');
  });
});
