// @vitest-environment jsdom
//
// T2-085: the dated OSYM entries that ship with the exam calendar. Each has a source link, the day it was read
// and a "verify" flag; nothing is added without a confirmation; nothing is fetched.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let EC, DATA;

beforeEach(() => {
  localStorage.clear();
  globalThis.VexLifeKit = fresh(JS + 'life-kit.js').VexLifeKit;
  globalThis.reminders = [];
  window.vex = { reminders: { create: vi.fn(async (message, at) => { const id = 'r' + (globalThis.reminders.length + 1); globalThis.reminders.push({ id, message, at }); return { id }; }), delete: vi.fn(async () => true) } };
  window.vexConfirm = vi.fn(async () => true);
  window.VexProblems = { note: vi.fn() };
  DATA = fresh(JS + 'exam-calendar-data.js').ExamCalendarData;
  EC = globalThis.ExamCalendar = fresh(JS + 'exam-calendar.js').ExamCalendar;
});

describe('the shipped OSYM rows', () => {
  it('all come from osym.gov.tr, are real dates, are in order of kind, and none is a 2027 exam', () => {
    expect(DATA.SOURCE).toMatch(/^https:\/\/www\.osym\.gov\.tr\//);
    expect(DATA.READ_ON).toBe('2026-10-17');
    const uids = new Set();
    for (const r of DATA.ROWS) {
      expect(uids.has(r.uid)).toBe(false); uids.add(r.uid);
      expect(() => EC.clean({ ...r, body: 'osym' })).not.toThrow();
      expect(EC.KINDS.some(k => k[0] === r.kind)).toBe(true);
      expect(r.day >= DATA.READ_ON.slice(0, 4) + '-01-01').toBe(true);
      expect(r.day.startsWith('2026-')).toBe(true);
    }
    expect(DATA.PENDING.join(' ')).toMatch(/YKS 2027/);
    expect(DATA.PENDING.join(' ')).toMatch(/LGS 2027/);
  });
  it('keeps the exam days the page lists for the end of 2026', () => {
    const exam = (uid) => DATA.ROWS.find(r => r.uid === uid).day;
    expect(exam('osym-2026-ales3')).toBe('2026-11-29');
    expect(exam('osym-2026-yds2')).toBe('2026-11-22');
    expect(exam('osym-2026-kpss-dhbt')).toBe('2026-11-01');
    expect(exam('osym-2026-eyds12')).toBe('2026-12-19');
  });
});

describe('adding them', () => {
  const NOW = new Date(2026, 9, 17, 10).getTime();
  it('asks first, names the source and what is missing, adds only what is still ahead, with the verify flag', async () => {
    const r = await EC.importOfficial(DATA, NOW);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    const msg = window.vexConfirm.mock.calls[0][0].message;
    expect(msg).toContain(DATA.SOURCE);
    expect(msg).toMatch(/verify on the official site/);
    expect(msg).toMatch(/YKS 2027/);
    expect(r.added).toBe(DATA.ROWS.length);
    expect(r.failed).toEqual([]);
    const items = EC.all();
    expect(items.every(i => i.verify === true && i.source === DATA.SOURCE && i.asOf === '2026-10-17' && i.body === 'osym')).toBe(true);
    expect(globalThis.reminders.length).toBeGreaterThan(0);
  });
  it('does nothing when declined, and nothing twice', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect((await EC.importOfficial(DATA, NOW)).added).toBe(0);
    expect(EC.all()).toHaveLength(0);
    window.vexConfirm = vi.fn(async () => true);
    await EC.importOfficial(DATA, NOW);
    const again = await EC.importOfficial(DATA, NOW);
    expect(again.added).toBe(0);
    expect(EC.all()).toHaveLength(DATA.ROWS.length);
  });
  it('skips rows already past on the day it is run', async () => {
    const later = new Date(2026, 10, 30, 10).getTime();
    const r = await EC.importOfficial(DATA, later);
    expect(r.added).toBe(DATA.ROWS.filter(x => (x.endDay || x.day) >= '2026-11-30').length);
  });
  it('drops a verify flag that has no https source or date (typed items stay plain)', () => {
    const c = EC.clean({ title: 'x', day: '2027-02-10', verify: true, source: 'javascript:1', asOf: '2026-10-17' });
    expect(c.verify).toBeUndefined();
    expect(EC.clean({ title: 'x', day: '2027-02-10' }).source).toBeUndefined();
  });
  it('is wired: a data script before the calendar, and no fetch in either file', () => {
    const root = path.resolve(__dirname, '../..');
    const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
    expect(html.indexOf('js/exam-calendar-data.js')).toBeGreaterThan(-1);
    expect(html.indexOf('js/exam-calendar-data.js')).toBeLessThan(html.indexOf('js/exam-calendar.js'));
    for (const f of ['exam-calendar.js', 'exam-calendar-data.js']) expect(/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(fs.readFileSync(path.join(root, 'src/renderer/js', f), 'utf8'))).toBe(false);
  });
});
