// @vitest-environment jsdom
//
// Reading with listening: chapters from headings, the speech plan, "what is new
// since I last read this page" from a stored snapshot (the page watcher's
// diff), and the rules of the player: it never starts by itself, it is silent
// while a game runs, and it never reads a private tab.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { ListenReader: L } = require('../../src/renderer/js/listen-reader.js');
const { PageWatchDiff } = require('../../src/renderer/js/page-watch-diff.js');

const t = (s) => [{ t: s }];
const P = (s) => ({ tag: 'P', runs: t(s) });
const H = (n, s) => ({ tag: 'H' + n, runs: t(s) });

const ARTICLE = [
  P('Intro paragraph one. It has two sentences.'),
  H(2, 'Why it matters'),
  P('Matters because of reasons. Second reason follows. Third sentence.'),
  { tag: 'UL', items: [[P('First bullet point here.')], [P('Second bullet point here.')]] },
  { tag: 'PRE', text: 'const x = 1;' },
  H(3, 'How it works'),
  { tag: 'BLOCKQUOTE', children: [P('A quoted line.')] },
  { tag: 'TABLE', rows: [] },
  H(2, 'Empty chapter'),
  H(2, 'The end'),
  { tag: 'P', runs: [{ t: 'Read the ' }, { a: 'https://x.example/', c: t('linked') }, { t: ' and ' }, { b: t('bold') }, { t: ' text.' }] },
];

describe('blocksToSections', () => {
  it('splits at headings, names the opening for the article, and skips code and tables', () => {
    const { sections, skipped } = L.blocksToSections(ARTICLE, 'My article');
    expect(sections.map(s => s.title)).toEqual(['My article', 'Why it matters', 'How it works', 'The end']);
    expect(sections[1].paras).toEqual(['Matters because of reasons. Second reason follows. Third sentence.', 'First bullet point here.', 'Second bullet point here.']);
    expect(sections[2].paras).toEqual(['A quoted line.']);
    expect(sections[3].paras).toEqual(['Read the linked and bold text.']);
    expect(skipped).toBe(2);
  });

  it('drops a heading with nothing under it', () => {
    const { sections } = L.blocksToSections([H(2, 'Lonely'), H(2, 'Real'), P('Body text.')], 'T');
    expect(sections.map(s => s.title)).toEqual(['Real']);
  });
});

describe('chapters and the plan', () => {
  const { sections } = L.blocksToSections(ARTICLE, 'My article');

  it('counts words and estimates the time at the chosen speed', () => {
    const slow = L.chapters(sections, 1);
    const fast = L.chapters(sections, 2);
    expect(slow[1].words).toBe(L.wordCount(sections[1].paras.join(' ')));
    expect(fast[1].seconds).toBeLessThanOrEqual(Math.ceil(slow[1].seconds / 2));
    expect(L.duration(45)).toBe('45 s');
    expect(L.duration(240)).toBe('4 min');
  });

  it('announces each chapter, and a brief keeps only the lead sentences', () => {
    const full = L.speechPlan(sections, 'full');
    const brief = L.speechPlan(sections, 'brief');
    expect(full[1].chunks[0]).toBe('Why it matters.');
    expect(full[1].chunks.length).toBeGreaterThan(brief[1].chunks.length);
    expect(brief[1].chunks.slice(1).join(' ')).toBe('Matters because of reasons. Second reason follows.');
  });

  it('cuts long text into pieces a voice can take', () => {
    const long = ('word, ' .repeat(120)).trim() + '.';
    const pieces = L.chunks(long, 100);
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.every(p => p.length <= 100)).toBe(true);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toContain('word, word');
  });
});

describe('what is new since you last read it', () => {
  const lines = (...x) => PageWatchDiff.normalizeText(x.join('\n'));

  it('treats the first reading as a first reading', () => {
    expect(L.whatsNew(null, lines('a', 'b')).first).toBe(true);
  });

  it('finds the added and removed lines, not the clock', () => {
    const before = { at: 1000, text: lines('Headline', 'Updated 5 minutes ago', 'Old paragraph', 'Time 14:05').join('\n') };
    const after = lines('Headline', 'Updated 9 minutes ago', 'Old paragraph', 'Time 15:10', 'Brand new paragraph');
    const r = L.whatsNew(before, after);
    expect(r.first).toBe(false);
    expect(r.changed).toBe(true);
    expect(r.added).toEqual(['Brand new paragraph']);
    expect(r.removed).toEqual([]);
    expect(r.since).toBe(1000);
    expect(r.summary).toMatch(/1 line added/);
  });

  it('reports a page that did not change as unchanged', () => {
    const same = lines('One', 'Two', 'Three');
    const r = L.whatsNew({ at: 5, text: same.join('\n') }, same);
    expect(r.changed).toBe(false);
    expect(r.added).toEqual([]);
  });

  it('reads the article as lines: its title and each paragraph', () => {
    const { sections } = L.blocksToSections(ARTICLE, 'My article');
    const ls = L.linesOf('My article', sections);
    expect(ls[0]).toBe('My article');
    expect(ls).toContain('Why it matters');
    expect(ls).toContain('A quoted line.');
  });
});

describe('snapshots', () => {
  it('keys a page without its fragment or tracking parameters', () => {
    expect(L.snapshotKey('https://www.Example.com/a/b/?utm_source=x&id=3#top')).toBe('example.com/a/b?id=3');
    expect(L.snapshotKey('https://example.com/a?b=1&a=2')).toBe(L.snapshotKey('https://example.com/a?a=2&b=1'));
    expect(L.snapshotKey('chrome://settings')).toBe('');
    expect(L.snapshotKey('not a url')).toBe('');
  });

  it('keeps two per page, moves the time of one that did not change, and stays under the cap', () => {
    const store = {};
    L.remember(store, 'p', ['one'], 100);
    L.remember(store, 'p', ['one'], 200);
    expect(store.p).toHaveLength(1);
    expect(store.p[0].at).toBe(200);
    L.remember(store, 'p', ['one', 'two'], 300);
    L.remember(store, 'p', ['one', 'two', 'three'], 400);
    expect(store.p).toHaveLength(2);
    expect(store.p[1].at).toBe(400);
    const big = 'x'.repeat(30000);
    for (let i = 0; i < 40; i++) L.remember(store, 'page' + i, [big + i], 500 + i);
    expect(PageWatchDiff.sizeOf(store)).toBeLessThanOrEqual(L.SNAP_LIMITS.totalChars);
    expect(store.page39).toBeDefined();   // the page just read is never the one dropped
    expect(store.p).toBeUndefined();      // the one read longest ago went first
    const many = {};
    for (let i = 0; i < L.MAX_PAGES + 20; i++) L.remember(many, 'k' + i, ['line ' + i], i);
    expect(Object.keys(many)).toHaveLength(L.MAX_PAGES);
  });

  it('remembers nothing for an address that is not a page', () => {
    const store = {};
    L.remember(store, '', ['x'], 1);
    expect(store).toEqual({});
  });
});

describe('the player', () => {
  let spoken, utterances, game;

  beforeEach(() => {
    spoken = [];
    utterances = [];
    game = { gaming: false };
    globalThis.GameMode = game;
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; utterances.push(this); } };
    globalThis.speechSynthesis = { speak: (u) => spoken.push(u), cancel: vi.fn(), getVoices: () => [] };
    window.escapeHtml = (s) => String(s);
    window.showToast = vi.fn();
    const tab = { id: 't1', url: 'https://news.example/story', title: 'A story' };
    const wv = { executeJavaScript: vi.fn(async () => ({ title: 'A story', lang: 'en', blocks: ARTICLE })) };
    globalThis.TabManager = { getActiveTab: () => tab };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.ReadingMode = { _extractScript: () => 'extract()' };
    localStorage.clear();
    L.setEnabled(true);
    L._s = null;
  });
  afterEach(() => {
    L.stop();
    for (const k of ['GameMode', 'SpeechSynthesisUtterance', 'speechSynthesis', 'TabManager', 'WebviewManager', 'ReadingMode']) delete globalThis[k];
    delete window.VexTabPolicy;
  });

  it('opens silent: nothing is spoken until play is pressed', async () => {
    await L.open();
    expect(spoken).toHaveLength(0);
    expect(L._s.paused).toBe(true);
    expect(document.querySelector('.vex-listen-panel')).not.toBeNull();
    L.play();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('A story.');
  });

  it('is silent while a game is running, and stops when one starts', async () => {
    game.gaming = true;
    await L.open();
    expect(L.play()).toBe(false);
    expect(spoken).toHaveLength(0);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/game is running/));
    game.gaming = false;
    await L.open();
    L.play();
    expect(spoken).toHaveLength(1);
    game.gaming = true;
    spoken[0].onend();
    expect(spoken).toHaveLength(1);
    expect(L._s).toBeNull();
  });

  it('moves between chapters and speaks the announcement first', async () => {
    await L.open();
    L.play();
    L.nextChapter();
    expect(utterances.at(-1).text).toBe('Why it matters.');
    L.nextChapter();
    expect(utterances.at(-1).text).toBe('How it works.');
    L.prevChapter();
    expect(utterances.at(-1).text).toBe('Why it matters.');
  });

  it('pauses by cancelling, and resumes from the same sentence', async () => {
    await L.open();
    L.play();
    L.pause();
    expect(speechSynthesis.cancel).toHaveBeenCalled();
    const before = spoken.length;
    L.play();
    expect(spoken.length).toBe(before + 1);
    expect(spoken.at(-1).text).toBe(spoken[0].text);
  });

  it('never reads or remembers a private tab', async () => {
    window.VexTabPolicy = { canReadWebview: () => false, canPersist: () => false };
    await expect(L.open()).rejects.toThrow(/never read/);
    expect(localStorage.getItem(L.SNAP_KEY)).toBeNull();
  });

  it('remembers the page it read only while Listen is on, and tells what is new next time', async () => {
    await L.open();
    expect(L.remembered()).toBe(1);
    expect(L._s.news.first).toBe(true);
    L.stop();
    const wv = globalThis.WebviewManager.getActiveWebview();
    wv.executeJavaScript = vi.fn(async () => ({ title: 'A story', lang: 'en', blocks: ARTICLE.concat([H(2, 'Update'), P('A development since you last looked.')]) }));
    await L.open();
    expect(L._s.news.first).toBe(false);
    expect(L._s.news.added).toContain('A development since you last looked.');
    L.setMode('new');
    expect(L._s.plan[0].chunks[0]).toBe('New since you last read this page.');
    expect(L._s.plan[0].chunks.join(' ')).toMatch(/A development since you last looked/);
    L.forget();
    expect(L.remembered()).toBe(0);
  });

  it('holds the media keys while it plays and lets them go when it stops', async () => {
    const handlers = {};
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: { setActionHandler: (n, f) => { handlers[n] = f; }, metadata: null } });
    globalThis.MediaMetadata = class { constructor(o) { Object.assign(this, o); } };
    globalThis.Audio = class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} };
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => {};
    await L.open();
    expect(handlers.play).toBeUndefined();
    L.play();
    expect(typeof handlers.play).toBe('function');
    expect(typeof handlers.nexttrack).toBe('function');
    handlers.nexttrack();
    expect(utterances.at(-1).text).toBe('Why it matters.');
    L.stop();
    expect(handlers.play).toBeNull();
    delete navigator.mediaSession;
    delete globalThis.MediaMetadata;
    delete globalThis.Audio;
  });
});
