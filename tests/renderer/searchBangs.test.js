// @vitest-environment jsdom
//
// Search bangs (js/search-bangs.js): a local table resolves !npm zod, a bang that is not in it
// is left for DuckDuckGo, and js/search-shortcuts.js asks the table first.
import { describe, it, expect, beforeEach } from 'vitest';
const { VexBangs: B } = require('../../src/renderer/js/search-bangs.js');
const SS = require('../../src/renderer/js/search-shortcuts.js');

beforeEach(() => { localStorage.clear(); delete window.VexBangs; });

describe('resolve', () => {
  it('a leading bang goes to the site, with the words encoded', () => {
    expect(B.resolve('!npm zod')).toMatchObject({ url: 'https://www.npmjs.com/search?q=zod', name: 'npm', query: 'zod', bang: 'npm' });
    expect(B.resolve('!mdn fetch api').url).toBe('https://developer.mozilla.org/en-US/search?q=fetch%20api');
  });
  it('a trailing bang works too', () => {
    expect(B.resolve('serde !crates').url).toBe('https://crates.io/search?q=serde');
  });
  it('!gh with owner/repo opens the repository, anything else searches', () => {
    expect(B.resolve('!gh 0xmortuex/vex').url).toBe('https://github.com/0xmortuex/vex');
    expect(B.resolve('!gh electron browser').url).toBe('https://github.com/search?q=electron%20browser&type=repositories');
  });
  it('the game and docs bangs exist', () => {
    for (const b of ['pypi', 'crates', 'docsrs', 'wiki', 'modrinth', 'steam', 'osdev', 'mcwiki', 'rbx']) expect(B.resolve('!' + b + ' x'), b).not.toBeNull();
  });
  it('a bang that is not in the table, or has no words, is left alone (null)', () => {
    expect(B.resolve('!yt cats')).toBeNull();
    expect(B.resolve('!npm')).toBeNull();
    expect(B.resolve('hello! world')).toBeNull();
  });
  it('is off when switched off', () => {
    B.setEnabled(false);
    expect(B.resolve('!npm zod')).toBeNull();
    expect(B.enabled()).toBe(false);
  });
});

describe('your own bangs', () => {
  it('can be added, change a built-in one, and be removed', () => {
    B.set('jira', 'https://jira.example/search?q=%s');
    expect(B.resolve('!jira ABC-1').url).toBe('https://jira.example/search?q=ABC-1');
    B.set('npm', 'https://registry.example/?q=%s');
    expect(B.resolve('!npm zod').url).toBe('https://registry.example/?q=zod');
    expect(B.table().find(r => r.bang === 'npm').changed).toBe(true);
    B.remove('npm');
    expect(B.resolve('!npm zod').url).toBe('https://www.npmjs.com/search?q=zod');
    B.remove('jira');
    expect(B.resolve('!jira x')).toBeNull();
  });
  it('are checked: one short word, https, %s exactly once', () => {
    expect(() => B.set('two words', 'https://a/%s')).toThrow(/one short word/);
    expect(() => B.set('x', 'ftp://a/%s')).toThrow(/https/);
    expect(() => B.set('x', 'https://a/')).toThrow(/%s/);
    expect(() => B.set('x', 'https://a/%s/%s')).toThrow(/once/);
  });
  it('stop a change over a list that cannot be read, rather than overwrite it', () => {
    localStorage.setItem('vex.searchBangs', '[1,2]');
    expect(() => B.set('x', 'https://a/%s')).toThrow(/not readable/);
    expect(localStorage.getItem('vex.searchBangs')).toBe('[1,2]');
  });
});

describe('pack data', () => {
  it('has the shape of an aliases item: words that run bang:<word>', () => {
    const p = B.packAliases();
    expect(p.type).toBe('aliases');
    expect(p.entries.length).toBeGreaterThanOrEqual(12);
    for (const e of p.entries) { expect(e.word).toMatch(/^[a-z0-9][a-z0-9._-]{0,15}$/); expect(e.command).toBe('bang:' + e.word); }
  });
});

describe('the address bar', () => {
  it('uses the table first and DuckDuckGo for other bangs', () => {
    window.VexBangs = B;
    expect(SS.resolveSearchShortcut('!npm zod')).toBe('https://www.npmjs.com/search?q=zod');
    expect(SS.resolveSearchShortcut('!yt cats')).toBe('https://duckduckgo.com/?q=!yt%20cats');
  });
  it('keeps the old behaviour when the helper is not loaded', () => {
    expect(SS.resolveSearchShortcut('!npm zod')).toBe('https://duckduckgo.com/?q=!npm%20zod');
  });
});

describe('the short word offer (T1-005)', () => {
  const T0 = 1_800_000_000_000;
  const DAY = 24 * 3600 * 1000;
  let seen;
  beforeEach(() => { seen = []; globalThis.VexAttention = { suggest: (o) => { seen.push(o); return true; } }; });

  it('offers a short word on the third use in a week, once', () => {
    expect(B.noteUse('!npm zod', T0)).toBeNull();
    expect(B.noteUse('react !npm', T0 + DAY)).toBeNull();
    expect(B.noteUse('!npm vite', T0 + 2 * DAY)).toBe('n');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ feature: 'search-bangs', action: { key: 'alias:npm:n' } });
    expect(B.noteUse('!npm again', T0 + 3 * DAY)).toBeNull();
    expect(seen).toHaveLength(1);
  });
  it('does not count uses more than a week apart', () => {
    B.noteUse('!npm a', T0); B.noteUse('!npm b', T0 + 2 * DAY);
    expect(B.noteUse('!npm c', T0 + 9 * DAY)).toBeNull();
    expect(seen).toHaveLength(0);
  });
  it('ignores a bang that is not in the table and a switched-off table', () => {
    for (let i = 0; i < 4; i++) B.noteUse('!yt cats', T0 + i);
    B.setEnabled(false);
    for (let i = 0; i < 4; i++) B.noteUse('!npm zod', T0 + i);
    expect(seen).toHaveLength(0);
  });
  it('picks a free word and the button adds it to the table', () => {
    B.set('n', 'https://example.com/?q=%s');
    expect(B.suggestAlias('npm')).toBe('np');
    expect(B.takeAlias('alias:npm:np')).toBe('np');
    expect(B.resolve('!np zod').url).toBe('https://www.npmjs.com/search?q=zod');
    expect(() => B.takeAlias('nonsense')).toThrow(/not a short word/);
  });
  it('refuses to count when the attention gate is missing', () => {
    delete globalThis.VexAttention;
    B.noteUse('!npm a', T0); B.noteUse('!npm b', T0 + 1);
    expect(() => B.noteUse('!npm c', T0 + 2)).toThrow(/VexAttention/);
  });
});
