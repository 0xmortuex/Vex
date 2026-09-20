// Typing @ in the AI box. The risks: a stray @ in a sentence opening a list,
// an email address being read as a mention, and a chosen tab not actually
// reaching the AI.
import { describe, it, expect, beforeEach } from 'vitest';
const { TabMentions: M } = require('../../src/renderer/js/tab-mentions.js');

const tabs = [
  { id: 1, title: 'Pull requests · vex', url: 'https://github.com/0xmortuex/Vex/pulls' },
  { id: 2, title: 'Inbox (12)', url: 'https://mail.google.com/' },
  { id: 3, title: '', url: 'https://news.ycombinator.com/' },
];
const personas = [{ id: 'p1', name: 'Code Reviewer' }, { id: 'p2', name: 'Translator' }];

describe('spotting the @ being typed', () => {
  it('finds it, and what has been typed after it', () => {
    expect(M.queryAt('compare @git', 12)).toEqual({ start: 8, query: 'git' });
    expect(M.queryAt('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('an email address is not a mention', () => {
    expect(M.queryAt('write to me@example.com', 23)).toBe(null);
  });

  it('a mention on an earlier line is not the one at the caret', () => {
    expect(M.queryAt('@one\nplain text', 15)).toBe(null);
  });

  it('gives up on something far too long to be a name', () => {
    expect(M.queryAt('@' + 'x'.repeat(80), 81)).toBe(null);
  });
});

describe('what the list offers', () => {
  it('with nothing typed yet, the tabs come first — that is what @ is for here', () => {
    const out = M.candidates(tabs, personas, '');
    expect(out[0]).toMatchObject({ kind: 'tab', id: 1 });
    expect(out.filter(o => o.kind === 'tab')).toHaveLength(3);
    expect(out.filter(o => o.kind === 'persona')).toHaveLength(2);
  });

  it('a persona whose name starts with what you typed goes above the tabs', () => {
    const out = M.candidates(tabs, personas, 'code');
    expect(out[0]).toMatchObject({ kind: 'persona', label: 'CodeReviewer' });
  });

  it('matches a tab on its title or its site', () => {
    expect(M.candidates(tabs, personas, 'pull').map(o => o.id)).toEqual([1]);
    expect(M.candidates(tabs, personas, 'github').map(o => o.id)).toEqual([1]);
    expect(M.candidates(tabs, personas, 'mail').map(o => o.id)).toEqual([2]);
  });

  it('a tab with no title is named by its site', () => {
    expect(M.candidates(tabs, [], 'ycombinator')[0].label).toBe('news.ycombinator.com');
  });

  it('a persona’s name goes in without its spaces, which is what @ matches on', () => {
    expect(M.candidates([], personas, 'reviewer')[0].label).toBe('CodeReviewer');
  });

  it('nothing matching is an empty list, not everything', () => {
    expect(M.candidates(tabs, personas, 'zzzz')).toEqual([]);
  });

  it('never offers more than a list someone can look at', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: i, title: 'Tab ' + i, url: 'https://e.com/' + i }));
    expect(M.candidates(many, [], '').length).toBeLessThanOrEqual(M.MAX);
  });
});

describe('putting it in', () => {
  it('replaces what was typed and leaves the caret after it', () => {
    const out = M.apply('compare @git', 12, 8, { kind: 'tab', id: 1, label: 'Pull requests · vex' });
    expect(out.text).toBe('compare @Pull requests · vex ');
    expect(out.caret).toBe(out.text.length);
  });

  it('keeps what came after the caret', () => {
    const out = M.apply('ask @m about this', 6, 4, { kind: 'tab', id: 2, label: 'Inbox (12)' });
    expect(out.text).toBe('ask @Inbox (12) about this');
  });
});

describe('what a chosen tab does', () => {
  beforeEach(() => {
    globalThis.TabSelector = { _customIds: new Set(), _mode: 'current', setMode(m) { this._mode = m; } };
  });

  it('a tab is added to what the AI is given', () => {
    expect(M.choose({ kind: 'tab', id: 7 })).toBe(true);
    expect([...TabSelector._customIds]).toEqual([7]);
    expect(TabSelector._mode).toBe('custom');
  });

  it('a persona changes nothing about which tabs are sent', () => {
    expect(M.choose({ kind: 'persona', id: 'p1' })).toBe(false);
    expect(TabSelector._customIds.size).toBe(0);
    expect(TabSelector._mode).toBe('current');
  });
});
