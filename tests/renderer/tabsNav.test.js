import { describe, it, expect, beforeEach } from 'vitest';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const N = require('../../src/renderer/js/tabs-nav.js');
const { _inlineCompletion } = require('../../src/renderer/js/smart-searchbar.js');

beforeEach(() => store.clear());

describe('switches', () => {
  it('are on by default except Keep on top and match case', () => {
    const p = N.prefs();
    expect(p.enabled && p.findOptions && p.cleanCopy && p.activityDot).toBe(true);
    expect(p.keepOnTop).toBe(false);
    expect(p.findMatchCase).toBe(false);
  });
  it('the master switch turns every extra off', () => {
    N.setEnabled(false);
    expect(N.on('findOptions')).toBe(false);
    expect(N.defaultZoomFactor()).toBe(1);
  });
  it('refuses an unknown setting', () => {
    expect(() => N.setPref('nope', true)).toThrow();
  });
});

describe('find history and selection', () => {
  it('keeps newest first without repeats, capped at 20', () => {
    for (let i = 0; i < 25; i++) N.findHistory.add('w' + i);
    N.findHistory.add('w10');
    const l = N.findHistory.list();
    expect(l[0]).toBe('w10');
    expect(l.length).toBe(20);
    expect(new Set(l).size).toBe(20);
  });
  it('steps older and back to what was typed', () => {
    const l = ['c', 'b', 'a'];
    expect(N.findHistory.step(-1, 1, l)).toBe(0);
    expect(N.findHistory.step(2, 1, l)).toBe(2);
    expect(N.findHistory.step(0, -1, l)).toBe(-1);
    expect(N.findHistory.step(-1, -1, l)).toBe(-1);
  });
  it('seeds only a short single line', () => {
    expect(N.cleanSelection('  hello   world ')).toBe('hello world');
    expect(N.cleanSelection('a\nb')).toBe('');
    expect(N.cleanSelection('x'.repeat(200))).toBe('');
    expect(N.cleanSelection('')).toBe('');
  });
});

describe('clean link copy', () => {
  it('strips tracking tags and names secrets', () => {
    const c = N.cleanLink('https://example.com/a?utm_source=x&id=3&token=abc');
    expect(c.text).toBe('https://example.com/a?id=3&token=abc');
    expect(c.changed).toBe(true);
    expect(c.sensitive).toEqual(['token']);
  });
  it('leaves a clean link alone', () => {
    const c = N.cleanLink('https://example.com/a?id=3');
    expect(c.changed).toBe(false);
    expect(c.sensitive).toEqual([]);
  });
  it('writes a Markdown link with safe brackets and parentheses', () => {
    expect(N.markdownLink('A [b] c', 'https://x.com/a_(b)')).toBe('[A b c](https://x.com/a_%28b%29)');
    expect(N.markdownLink('', 'https://x.com/')).toBe('[https://x.com/](https://x.com/)');
  });
});

describe('text fragment', () => {
  it('quotes a short selection and encodes the reserved characters', () => {
    expect(N.textFragmentUrl('https://a.com/p?q=1#old', 'well-known, fact & more')).toBe('https://a.com/p?q=1#:~:text=well%2Dknown%2C%20fact%20%26%20more');
  });
  it('names a long selection by its first and last words', () => {
    const words = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
    const u = N.textFragmentUrl('https://a.com/', words);
    expect(u).toBe('https://a.com/#:~:text=word0%20word1%20word2%20word3,word56%20word57%20word58%20word59');
  });
  it('gives nothing for a non-web page or an empty selection', () => {
    expect(N.textFragmentUrl('file:///x', 'hello there')).toBeNull();
    expect(N.textFragmentUrl('https://a.com/', ' ')).toBeNull();
  });
});

describe('typed counts and inline completion', () => {
  beforeEach(() => N.setPref('typedRanking', true));    // off by default since Wave 4: it changes what Enter picks
  const ranked = [
    { url: 'https://github.com/', kind: 'history' },
    { url: 'https://gitlab.com/', kind: 'history' },
  ];
  it('counts web addresses by host and forgets', () => {
    N.typed.record('https://www.gitlab.com/x');
    N.typed.record('https://gitlab.com/');
    N.typed.record('about:blank');
    expect(N.typed.count('gitlab.com')).toBe(2);
    expect(Object.keys(N.typed.all())).toEqual(['gitlab.com']);
    N.typed.clear();
    expect(N.typed.count('gitlab.com')).toBe(0);
  });
  it('without options the first ranked site completes, as before', () => {
    expect(_inlineCompletion('git', ranked).text).toBe('github.com');
  });
  it('the most typed site wins, ties keep the ranked order', () => {
    N.typed.record('https://gitlab.com/');
    expect(_inlineCompletion('git', ranked, N.completionOptions()).text).toBe('gitlab.com');
    N.typed.clear();
    expect(_inlineCompletion('git', ranked, N.completionOptions()).text).toBe('github.com');
  });
  it('never completes to a lookalike of a guarded site', () => {
    const r = [{ url: 'https://paypa1.com/', kind: 'history' }];
    N.typed.record('https://paypa1.com/'); N.typed.record('https://paypa1.com/');
    expect(_inlineCompletion('pay', r, N.completionOptions())).toBeNull();
  });
  it('is plain ranking when switched off', () => {
    N.setPref('typedRanking', false);
    expect(N.completionOptions()).toBeNull();
  });
});

describe('already open', () => {
  const tabs = [
    { id: 1, url: 'https://www.example.com/a/?x=1#top', partition: 'persist:main' },
    { id: 2, url: 'https://other.com/', partition: 'persist:main' },
    { id: 3, url: 'https://example.com/a?x=1', partition: 'tor-1' },
  ];
  it('matches without www, trailing slash or fragment, in the same kind of session', () => {
    expect(N.findOpenTab('https://example.com/a?x=1', tabs, 2).id).toBe(1);
    expect(N.findOpenTab('https://example.com/a?x=2', tabs, 2)).toBeNull();
  });
  it('never reaches a private tab from a normal one', () => {
    expect(N.findOpenTab('https://example.com/a?x=1', [tabs[2], tabs[1]], 2)).toBeNull();
  });
  it('is not the tab you are in', () => {
    expect(N.findOpenTab('https://other.com', tabs, 2)).toBeNull();
  });
});

describe('address bar extras', () => {
  it('goes up one level at a time', () => {
    expect(N.parentUrl('https://a.com/x/y/z')).toBe('https://a.com/x/y');
    expect(N.parentUrl('https://a.com/x?q=1#h')).toBe('https://a.com/x');
    expect(N.parentUrl('https://a.com/?q=1')).toBe('https://a.com/');
    expect(N.parentUrl('https://a.com/')).toBeNull();
    expect(N.parentUrl('about:blank')).toBeNull();
  });
});

describe('activity on background tabs', () => {
  it('reads a count from the title', () => {
    expect(N.titleCount('(3) Inbox')).toBe(3);
    expect(N.titleCount('[12] Chat')).toBe(12);
    expect(N.titleCount('Inbox (3)')).toBe(0);
  });
  it('marks a rise in the background, clears when looked at or read', () => {
    const tab = { title: '(1) Inbox' };
    expect(N.noteTitle(tab, false)).toBe(false);
    tab.title = '(3) Inbox';
    expect(N.noteTitle(tab, false)).toBe(true);
    expect(N.activityOf(tab)).toBe(2);
    tab.title = '(2) Inbox';
    N.noteTitle(tab, false);
    expect(N.activityOf(tab)).toBe(1);
    N.clearActivity(tab);
    expect(N.activityOf(tab)).toBe(0);
  });
  it('the tab in front never shows a dot, and the switch turns it off', () => {
    const tab = { title: '(1) a' };
    N.noteTitle(tab, false);
    tab.title = '(4) a';
    N.noteTitle(tab, true);
    expect(N.activityOf(tab)).toBe(0);
    tab.title = '(9) a'; N.noteTitle(tab, false);
    N.setPref('activityDot', false);
    expect(N.activityOf(tab)).toBe(0);
  });
});

describe('default zoom and downloads', () => {
  it('keeps a valid percent and refuses nonsense', () => {
    expect(N.defaultZoomFactor()).toBe(1);
    N.setDefaultZoomPercent(125);
    expect(N.defaultZoomFactor()).toBe(1.25);
    expect(() => N.setDefaultZoomPercent(5)).toThrow();
  });
  it('smooths a speed and says the time left', () => {
    let r = N.rateStep(null, 0, 1000);
    r = N.rateStep(r, 1024 * 1024, 2000);
    expect(Math.round(r.bps)).toBe(1024 * 1024);
    expect(N.formatRate(r.bps)).toBe('1.0 MB/s');
    expect(N.etaText(r.bps, 1024 * 1024, 11 * 1024 * 1024)).toBe('10 s left');
    expect(N.etaText(0, 1, 10)).toBe('');
  });
});

describe('what is on for a new profile (Wave 4)', () => {
  it('only the passive extras: the ones that change Enter or the address bar are a choice', () => {
    const p = N.prefs();
    expect([p.findOptions, p.cleanCopy, p.textFragment, p.activityDot]).toEqual([true, true, true, true]);
    expect([p.typedRanking, p.switchToTab, p.addressExtras, p.keepOnTop]).toEqual([false, false, false, false]);
  });
});
