// @vitest-environment jsdom
//
// Reading queue: "I have N minutes" and what finished means.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { ReadingQueue: Q } = require('../../src/renderer/js/reading-queue.js');

const item = (id, minutes, extra = {}) => ({ id, url: 'https://' + id + '.test/', title: id, at: Number(id.replace(/\D/g, '')) || 1, read: false, minutes, ...extra });

describe('reading the length asked for', () => {
  it('understands the ways people say it', () => {
    expect(Q.parseMinutes('I have 20 minutes')).toBe(20);
    expect(Q.parseMinutes("I've got 15 min")).toBe(15);
    expect(Q.parseMinutes('half an hour')).toBe(30);
    expect(Q.parseMinutes('I have an hour')).toBe(60);
    expect(Q.parseMinutes('1h 30')).toBe(90);
    expect(Q.parseMinutes('1.5 hours')).toBe(90);
    expect(Q.parseMinutes('whenever')).toBe(0);
  });

  it('estimates reading time from words', () => {
    expect(Q.estimateMinutes('')).toBe(0);
    expect(Q.estimateMinutes('word '.repeat(10))).toBe(1);
    expect(Q.estimateMinutes('word '.repeat(2200))).toBe(10);
  });
});

describe('what fits', () => {
  it('fills the time as fully as it can, not just greedily', () => {
    // 8 + 7 = 15 beats the greedy 9 + 5 = 14.
    const r = Q.fit([item('a1', 9), item('a2', 8), item('a3', 7), item('a4', 5)], 15);
    expect(r.total).toBe(15);
    expect(r.picks.map(i => i.minutes).sort()).toEqual([7, 8]);
    expect(r.left).toBe(0);
  });

  it('prefers older links when two sets fill the time equally', () => {
    const r = Q.fit([item('a1', 5), item('a2', 5), item('a3', 5)], 10);
    expect(r.picks.map(i => i.id)).toEqual(['a1', 'a2']);
  });

  it('skips read, finished and unmeasured links, and says how many it could not place', () => {
    const r = Q.fit([item('a1', 5, { read: true }), item('a2', 5, { finishedAt: 1 }), item('a3', undefined), item('a4', 30), item('a5', 4)], 10);
    expect(r.picks.map(i => i.id)).toEqual(['a5']);
    expect(r.unmeasured).toBe(1);
    expect(r.tooLong).toBe(1);
    expect(r.left).toBe(6);
  });

  it('nothing fits in no time, and the budget is capped', () => {
    expect(Q.fit([item('a1', 1)], 0).picks).toEqual([]);
    expect(Q.fit([item('a1', 1)], 99999).picks).toHaveLength(1);
  });
});

describe('finished is its own mark', () => {
  let list;
  beforeEach(() => {
    list = [item('a1', 6), item('a2', 12, { read: true })];
    globalThis.ReadLater = { items: list, save: vi.fn() };
  });

  it('finishing marks the link read and keeps when', () => {
    const it = Q.finish('a1', 5000);
    expect(it).toMatchObject({ read: true, finishedAt: 5000 });
    expect(ReadLater.save).toHaveBeenCalled();
  });

  it('opened is not finished: the tally counts only finished', () => {
    Q.finish('a1', Date.now());
    const st = Q.stats(list);
    expect(st.finishedWeek).toBe(1);
    expect(st.finishedMinutesWeek).toBe(6);
    expect(st.unread).toBe(0);
  });

  it('finishing can be taken back', () => {
    Q.finish('a1');
    const it = Q.unfinish('a1');
    expect(it.read).toBe(false);
    expect(it.finishedAt).toBeUndefined();
  });

  it('a link that is gone says so', () => {
    expect(() => Q.finish('zzz')).toThrow(/no longer in Read Later/);
  });

  it('the page in front is matched by its address', () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://a1.test/' }) };
    expect(Q.finishActive().id).toBe('a1');
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://other.test/' }) };
    expect(() => Q.finishActive()).toThrow(/not in your Read Later/);
  });

  it('measuring is refused while a game runs', async () => {
    globalThis.GameMode = { gaming: true };
    await expect(Q.measureMissing()).rejects.toThrow(/game is running/);
    delete globalThis.GameMode;
  });
});

describe('words', () => {
  it('formats minutes', () => {
    expect(Q.fmt(7)).toBe('7 min');
    expect(Q.fmt(60)).toBe('1 h');
    expect(Q.fmt(95)).toBe('1 h 35 min');
  });
});
