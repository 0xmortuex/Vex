// @vitest-environment jsdom
//
// T3-072, Wave 5: shifted reminders. A timed reminder can be moved to the same clock time in the trip's
// time zone, only the ones ticked, with a ledger line that puts them back.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexTravel: T } = require('../../src/renderer/js/travel-mode.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
let created, deleted, notes;

beforeEach(() => {
  localStorage.clear();
  created = []; deleted = []; notes = [];
  let n = 0;
  window.vex = { reminders: {
    create: vi.fn(async (message, at, extra) => { const id = 'new' + (++n); created.push({ id, message, at, extra }); return { id }; }),
    delete: vi.fn(async (id) => { deleted.push(id); return true; }),
    list: vi.fn(async () => []),
  } };
  globalThis.VexLedger = { note: (l) => { notes.push(l); }, registerUndo: vi.fn() };
  window.showToast = vi.fn();
});

describe('the same clock time in another zone', () => {
  it('moves 09:00 in Istanbul to 09:00 in Tokyo (six hours earlier in absolute time)', () => {
    const at = Date.UTC(2026, 9, 20, 6, 0, 0);               // 09:00 in Istanbul (UTC+3)
    const t = T.shiftTime(at, 'Europe/Istanbul', 'Asia/Tokyo');   // 09:00 in Tokyo (UTC+9) = 00:00 UTC
    expect(t).toBe(Date.UTC(2026, 9, 20, 0, 0, 0));
  });
  it('is the same moment for the same zone, and goes the other way', () => {
    const at = Date.UTC(2026, 9, 20, 6, 0, 0);
    expect(T.shiftTime(at, 'Europe/Istanbul', 'Europe/Istanbul')).toBe(at);
    const there = T.shiftTime(at, 'Europe/Istanbul', 'America/New_York');
    expect(T.shiftTime(there, 'America/New_York', 'Europe/Istanbul')).toBe(at);
  });
  it('follows summer time at the destination', () => {
    const at = Date.UTC(2026, 6, 1, 6, 0, 0);               // July, 09:00 in Istanbul
    const t = T.shiftTime(at, 'Europe/Istanbul', 'Europe/London');   // 09:00 in London is 08:00 UTC in July
    expect(t).toBe(Date.UTC(2026, 6, 1, 8, 0, 0));
  });
  it('reads zone offsets in minutes, half hours included', () => {
    expect(T.zoneOffsetMin('Asia/Kolkata', NOW)).toBe(330);
    expect(T.zoneOffsetMin('UTC', NOW)).toBe(0);
  });
});

describe('the plan', () => {
  const r = (id, over = {}) => ({ id, message: 'Call ' + id, at: NOW + 2 * DAY, ...over });
  it('lists timed reminders of the next 14 days, soonest first, with the new moment', () => {
    const plan = T.shiftPlan([r('b', { at: NOW + 3 * DAY }), r('a', { at: NOW + 2 * DAY })], 'Asia/Tokyo', NOW, 14, 'Europe/Istanbul');
    expect(plan.rows.map(x => x.id)).toEqual(['a', 'b']);
    expect(plan.rows[0].newAt).toBe(T.shiftTime(NOW + 2 * DAY, 'Europe/Istanbul', 'Asia/Tokyo'));
  });
  it('leaves out fired, past, far-off, repeating and site reminders and counts what it left alone', () => {
    const plan = T.shiftPlan([
      r('fired', { firedAt: NOW - 1 }), r('past', { at: NOW - DAY }), r('far', { at: NOW + 30 * DAY }),
      r('rep', { repeat: 'daily' }), r('site', { site: 'a.example' }), r('ok'),
    ], 'Asia/Tokyo', NOW, 14, 'Europe/Istanbul');
    expect(plan.rows.map(x => x.id)).toEqual(['ok']);
    expect(plan.skipped).toBe(2);
  });
  it('leaves out a reminder that would land in the past, and one the zone does not move', () => {
    const plan = T.shiftPlan([r('soon', { at: NOW + 3600000 })], 'Pacific/Auckland', NOW, 14, 'Asia/Tokyo');
    expect(plan.rows.every(x => x.newAt > NOW)).toBe(true);
    expect(T.shiftPlan([r('x')], 'Europe/Istanbul', NOW, 14, 'Europe/Istanbul').rows).toEqual([]);
  });
  it('refuses a zone that is not one', () => {
    expect(() => T.shiftPlan([], 'Mars/Olympus', NOW)).toThrow(/not a time zone/);
  });
});

describe('moving them', () => {
  const row = (id, extra = {}) => ({ id, message: 'Call ' + id, at: NOW + 2 * DAY, newAt: NOW + 2 * DAY - 6 * 3600000, url: '', urgent: false, kind: '', ...extra });
  it('creates the new reminder first, then removes the old one, keeping the link and urgency', async () => {
    const out = await T.applyShift([row('a', { url: 'https://x.example/', urgent: true })], 'Asia/Tokyo');
    expect(out).toEqual({ moved: 1, failed: [] });
    expect(created[0]).toMatchObject({ message: 'Call a', extra: { url: 'https://x.example/', urgent: true } });
    expect(deleted).toEqual(['a']);
    expect(notes[0].undo.kind).toBe('travel-shift-undo');
    expect(notes[0].undo.pairs[0]).toMatchObject({ n: 'new1', m: 'Call a' });
  });
  it('never leaves one twice: a reminder that cannot be removed takes its new twin with it', async () => {
    window.vex.reminders.delete = vi.fn(async (id) => { if (id === 'a') throw new Error('locked'); deleted.push(id); return true; });
    const out = await T.applyShift([row('a')], 'Asia/Tokyo');
    expect(out.moved).toBe(0);
    expect(out.failed[0]).toMatch(/could not be removed/);
    expect(deleted).toEqual(['new1']);
    expect(notes).toEqual([]);
  });
  it('reports a reminder that could not be created and carries on with the rest', async () => {
    let n = 0;
    window.vex.reminders.create = vi.fn(async (m, at) => { if (m === 'Call a') throw new Error('full'); return { id: 'ok' + (++n) }; });
    const out = await T.applyShift([row('a'), row('b')], 'Asia/Tokyo');
    expect(out.moved).toBe(1);
    expect(out.failed[0]).toMatch(/Call a: full/);
  });
  it('raises when reminders are not available', async () => {
    delete window.vex;
    await expect(T.applyShift([row('a')], 'Asia/Tokyo')).rejects.toThrow(/not available/);
  });
});

describe('the Undo', () => {
  it('removes the new reminders and puts the old ones back', async () => {
    const future = Date.now() + 5 * DAY;
    const back = await T.undoShift({ pairs: [{ n: 'new1', m: 'Call a', a: future, u: 'https://x.example/', g: 1 }] });
    expect(back).toBe(1);
    expect(deleted).toEqual(['new1']);
    expect(created[0]).toMatchObject({ message: 'Call a', at: future, extra: { url: 'https://x.example/', urgent: true } });
  });
  it('does not put back one whose old time has passed, and says so', async () => {
    const back = await T.undoShift({ pairs: [{ n: 'new1', m: 'Call a', a: Date.now() - DAY }] });
    expect(back).toBe(0);
    expect(created).toEqual([]);
    expect(window.showToast).toHaveBeenCalled();
  });
  it('is registered with the ledger by init', () => {
    T.init();
    expect(VexLedger.registerUndo.mock.calls.map(c => c[0])).toContain('travel-shift-undo');
  });
});
