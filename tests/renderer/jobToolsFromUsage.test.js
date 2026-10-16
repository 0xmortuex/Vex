// @vitest-environment jsdom
//
// JobProfiles ranks the Toolbox tools from what the Toolbox already records, instead of a role label,
// and only ever OFFERS to switch a saved list (never rewrites it).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let J;
const NOW = 1.8e12;
const DAY = 86400000;
const hist = (n, ageDays = 1) => Array.from({ length: n }, () => ({ at: NOW - ageDays * DAY }));

beforeEach(() => {
  localStorage.clear();
  for (const n of ['VexAttention', 'VexLedger', 'Toolbox', 'ThemeManager']) delete globalThis[n];
  J = fresh('job-profiles.js').JobProfiles;
  J.renderButtons = vi.fn();
});

describe('rankTools (pure)', () => {
  it('ranks by results kept, recency of opening and stars, and leaves unused tools out', () => {
    const r = J.rankTools({ history: { 'fin-savings-goal': hist(5), 'fin-markup-margin': hist(2), 'random-number': hist(1), json: [] }, recent: ['random-number', 'fin-savings-goal'], favourites: ['fin-markup-margin'], now: NOW });
    expect(r.map(x => x.id)).toEqual(['fin-savings-goal', 'random-number', 'fin-markup-margin']);
    expect(r.find(x => x.id === 'json')).toBeUndefined();
  });
  it('ignores results older than the window', () => {
    expect(J.rankTools({ history: { a: hist(3, 90) }, now: NOW })).toEqual([]);
  });
});

describe('suggestTools', () => {
  it('uses what is used once at least three tools have been', () => {
    const usage = { history: { 'fin-savings-goal': hist(3), 'fin-markup-margin': hist(2), 'random-number': hist(1) }, recent: [], favourites: [] };
    const s = J.suggestTools('software-dev', { usage, now: NOW });
    expect(s.source).toBe('usage');
    expect(s.tools).toEqual(['fin-savings-goal', 'fin-markup-margin', 'random-number']);
    expect(s.tools).not.toContain('regex');
  });
  it('falls back to the role preset when too little is used', () => {
    const s = J.suggestTools('software-dev', { usage: { history: { x: hist(1) }, recent: [], favourites: [] }, now: NOW });
    expect(s.source).toBe('role');
    expect(s.tools).toEqual(J.get('software-dev').tools);
  });
  it('drops tools the Toolbox no longer has', () => {
    const usage = { history: { a: hist(3), b: hist(2), c: hist(2), gone: hist(9) }, recent: [], favourites: [] };
    expect(J.suggestTools('software-dev', { usage, knownIds: ['a', 'b', 'c'], now: NOW }).tools).toEqual(['a', 'b', 'c']);
  });
  it('reads the real Toolbox records and says so when one is corrupt', () => {
    localStorage.setItem('vex.tool.history.fin-roi', JSON.stringify(hist(2)));
    localStorage.setItem('vex.tool.recent', JSON.stringify(['fin-roi']));
    expect(J.readUsage().history['fin-roi']).toHaveLength(2);
    localStorage.setItem('vex.tool.recent', '{broken');
    expect(() => J.readUsage()).toThrow(/vex.tool.recent/);
  });
});

describe('the offer never rewrites a saved list by itself', () => {
  const setup = () => {
    localStorage.setItem('vex.job', 'software-dev');
    localStorage.setItem('vex.jobTools', JSON.stringify(['regex', 'json', 'base64']));
    for (const [id, n] of [['fin-savings-goal', 3], ['fin-markup-margin', 2], ['random-number', 2], ['fin-roi', 1]]) localStorage.setItem('vex.tool.history.' + id, JSON.stringify(hist(n)));
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
  };

  it('suggests once a month and leaves the list as it is', () => {
    setup();
    const r = J.offerRepick(NOW);
    expect(r.missing).toEqual(expect.arrayContaining(['fin-savings-goal', 'fin-markup-margin', 'random-number']));
    expect(VexAttention.suggest.mock.calls[0][0]).toMatchObject({ feature: 'job-tools-offer', action: { key: 'repick' } });
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toEqual(['regex', 'json', 'base64']);
    expect(J.offerRepick(NOW + 5 * DAY)).toBeNull();
    expect(J.offerRepick(NOW + 31 * DAY)).not.toBeNull();
  });

  it('says nothing for a profile with no job, or when the list already matches', () => {
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    expect(J.offerRepick(NOW)).toBeNull();
    setup();
    localStorage.setItem('vex.jobTools', JSON.stringify(['fin-savings-goal', 'fin-markup-margin', 'random-number']));
    expect(J.offerRepick(NOW)).toBeNull();
  });

  it('accepting changes only the tool list, records an undo, and the undo puts the old list back', () => {
    setup();
    const notes = [];
    globalThis.VexLedger = { note: (l) => notes.push(l) };
    const theme = vi.fn();
    globalThis.ThemeManager = { applyTheme: theme, availableThemes: ['matrix'] };
    J.acceptRepick(NOW);
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))[0]).toBe('fin-savings-goal');
    expect(theme).not.toHaveBeenCalled();
    expect(notes[0].undo).toMatchObject({ kind: 'job-tools-restore', tools: ['regex', 'json', 'base64'] });
    J.setTools(notes[0].undo.tools);
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toEqual(['regex', 'json', 'base64']);
  });
});
