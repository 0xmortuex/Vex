// @vitest-environment jsdom
//
// T3-017, Wave 5: reading triage weighs the focus block running now and how often you finish what you
// save from a site, on top of the goals you typed.
import { describe, it, expect, beforeEach } from 'vitest';

const { ReadingTriage: RT, AiWords } = require('../../src/renderer/js/ai-judgement.js');

const now = Date.parse('2026-10-16');
const DAY = 86400000;
const item = (title, url, over = {}) => ({ title, url, at: now - 2 * DAY, read: false, ...over });

beforeEach(() => {
  localStorage.clear();
  delete globalThis.FocusOS;
  delete globalThis.ReadLater;
});

describe('the focus block', () => {
  it('is the goal of the block running now, and null when none runs or Focus OS is absent', () => {
    expect(RT.focus()).toBeNull();
    globalThis.FocusOS = { active: () => null, goal: () => null };
    expect(RT.focus()).toBeNull();
    globalThis.FocusOS = { active: () => ({ goalId: 'g' }), goal: () => ({ title: 'Finish the Electron security review' }) };
    expect(RT.focus().title).toBe('Finish the Electron security review');
    expect(RT.focus().words.length).toBeGreaterThan(1);
  });
  it('lifts an item that fits the block into read now, even with no goals typed', () => {
    const ctx = { focus: { title: 'Electron security review', words: AiWords.tokens('Electron security review') } };
    const fit = RT.score(item('Electron security checklist', 'https://e.example/sec'), [], now, ctx);
    expect(fit.verdict).toBe('read now');
    expect(fit.reason).toMatch(/block you are in/);
    const other = RT.score(item('Cat pictures', 'https://x.example/cats'), [], now, ctx);
    expect(other.verdict).toBe('skim');
    expect(other.reason).toMatch(/No goals/);
  });
  it('adds the block to the reason of a goal match, and out-ranks an item that fits only the goal', () => {
    const goals = ['security'];
    const ctx = { focus: { title: 'Electron security review', words: AiWords.tokens('Electron security review') } };
    const rows = RT.rank([item('Security basics', 'https://a.example/s'), item('Electron security review notes', 'https://b.example/e')], goals, now, ctx);
    expect(rows[0].item.url).toBe('https://b.example/e');
    expect(rows[0].reason).toMatch(/fits the block you are in/);
  });
});

describe('the finish rate', () => {
  const saved = (host, n, readN) => Array.from({ length: n }, (_, i) => ({ url: 'https://' + host + '/p' + i, title: 't' + i, at: now - 10 * DAY, read: i < readN }));
  it('counts what you read out of what you saved, leaving out the last three days', () => {
    const items = [...saved('a.example', 5, 4), ...saved('b.example', 5, 0), { url: 'https://c.example/new', title: 'new', at: now - DAY, read: false }];
    const r = RT.finishRates(items, now);
    expect(r['a.example']).toMatchObject({ saved: 5, read: 4 });
    expect(r['a.example'].rate).toBeCloseTo(0.8);
    expect(r['b.example'].rate).toBe(0);
    expect(r['c.example']).toBeUndefined();
  });
  it('nudges the score and says why, only with four or more saved', () => {
    const rates = RT.finishRates([...saved('a.example', 5, 4), ...saved('b.example', 5, 0), ...saved('d.example', 3, 3)], now);
    const base = RT.score(item('Something', 'https://z.example/x'), ['unrelated'], now, {});
    const up = RT.score(item('Something', 'https://a.example/x'), ['unrelated'], now, { rates });
    const down = RT.score(item('Something', 'https://b.example/x'), ['unrelated'], now, { rates });
    const few = RT.score(item('Something', 'https://d.example/x'), ['unrelated'], now, { rates });
    expect(up.score).toBe(base.score + 1);
    expect(up.reason).toMatch(/you usually finish what you save from a\.example/);
    expect(down.score).toBe(base.score - 1);
    expect(down.reason).toMatch(/rarely finish/);
    expect(few.score).toBe(base.score);
  });
  it('all() reads the saved list including what is read, and never changes it', () => {
    globalThis.ReadLater = { items: [{ url: 'https://a.example/1', read: true }, { url: 'https://a.example/2', read: false }, { title: 'no url' }] };
    const before = JSON.stringify(globalThis.ReadLater.items);
    expect(RT.all()).toHaveLength(2);
    expect(JSON.stringify(globalThis.ReadLater.items)).toBe(before);
  });
});

describe('without the new context the old behaviour is unchanged', () => {
  it('scores exactly as before', () => {
    const r = RT.score(item('Cloudflare Workers KV', 'https://blog.cloudflare.com/kv', { minutes: 5, at: now - DAY }), ['Cloudflare Workers'], now);
    expect(r.verdict).toBe('read now');
    expect(r.reason).toBe('Matches your goal "Cloudflare Workers", 5 min');
  });
});
