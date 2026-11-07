// Text versions of kept pages (Wave 5): the pure rules (src/renderer/js/evodata-versions-core.js: the word diff, the caps),
// the files (src/main/evodata-versions-store.js) on a real temp folder, and the IPC wiring (src/main/evodata-versions-ipc.js).
// Deterministic: every time is passed in, no network, no Electron, nothing outside a fresh temp folder.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const V = require('../../src/renderer/js/evodata-versions-core.js');
const { createVersionStore } = require('../../src/main/evodata-versions-store.js');
const { registerVersions } = require('../../src/main/evodata-versions-ipc.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const policy = require('../../src/main/ipc-policy.js');

const quiet = { error() {}, warn() {}, log() {} };
const texts = (ops, t) => ops.filter(o => o.t === t).map(o => V.joinWords(o.words));

describe('the word diff', () => {
  it('finds a replaced word', () => {
    const d = V.wordDiff('the price is 10 dollars today', 'the price is 12 dollars today');
    expect(texts(d.ops, 'del')).toEqual(['10']);
    expect(texts(d.ops, 'add')).toEqual(['12']);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.coarse).toBe(false);
  });
  it('finds added and removed stretches', () => {
    const d = V.wordDiff('one two three four five', 'one two NEW WORDS three five');
    expect(texts(d.ops, 'add')).toEqual(['NEW WORDS']);
    expect(texts(d.ops, 'del')).toEqual(['four']);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
  });
  it('the same text has no change', () => {
    const d = V.wordDiff('a b c', 'a b c');
    expect(d.ops).toEqual([{ t: 'eq', words: ['a', 'b', 'c'] }]);
    expect(d.added + d.removed).toBe(0);
  });
  it('two empty texts, and one empty text', () => {
    expect(V.wordDiff('', '').ops).toEqual([]);
    const d = V.wordDiff('', 'new text');
    expect(d.ops).toEqual([{ t: 'add', words: ['new', 'text'] }]);
    expect(d.added).toBe(2);
    expect(V.wordDiff('gone now', '').removed).toBe(2);
  });
  it('keeps line breaks as part of the text and does not count them as words', () => {
    const d = V.wordDiff('first line\nsecond line', 'first line\nsecond changed line');
    expect(texts(d.ops, 'add')).toEqual(['changed']);
    expect(d.added).toBe(1);
    const joined = d.ops.map(o => V.joinWords(o.words)).join(' ');
    expect(joined).toContain('\n');
    expect(V.joinWords(['a', 'b', '\n', 'c'])).toBe('a b\nc');
  });
  it('ignores how much white space separates the words', () => {
    expect(V.wordDiff('a   b\t c', 'a b c').added).toBe(0);
  });
  it('a small edit in a big page is exact and fast (the unchanged start and end are trimmed first)', () => {
    const words = Array.from({ length: 15000 }, (_, i) => 'w' + i);
    const changed = words.slice(); changed[7000] = 'CHANGED';
    const d = V.wordDiff(words.join(' '), changed.join(' '));
    expect(d.coarse).toBe(false);
    expect(d.cut).toBe(false);
    expect(texts(d.ops, 'del')).toEqual(['w7000']);
    expect(texts(d.ops, 'add')).toEqual(['CHANGED']);
  });
  it('a change too big for the comparison table is shown as one removed and one added block, not computed', () => {
    const a = Array.from({ length: 3000 }, (_, i) => 'a' + i).join(' ');
    const b = Array.from({ length: 3000 }, (_, i) => 'b' + i).join(' ');
    const d = V.wordDiff(a, b);
    expect(d.coarse).toBe(true);
    expect(d.ops.map(o => o.t)).toEqual(['del', 'add']);
    expect(d.removed).toBe(3000);
    expect(d.added).toBe(3000);
  });
  it('more than 20,000 words a side is cut off and says so', () => {
    const big = Array.from({ length: 20050 }, (_, i) => 'w' + i).join(' ');
    const d = V.wordDiff(big, big + ' extra');
    expect(d.cut).toBe(true);
    expect(d.added).toBe(0);
  });
  it('long unchanged stretches are folded to the words around a change', () => {
    const w = (n, p) => Array.from({ length: n }, (_, i) => p + i).join(' ');
    const d = V.wordDiff(w(30, 'a') + ' OLD ' + w(30, 'b'), w(30, 'a') + ' NEW ' + w(30, 'b'));
    const folded = V.foldContext(d.ops, 3);
    expect(folded.map(o => o.t)).toEqual(['gap', 'eq', 'del', 'add', 'eq', 'gap']);
    expect(V.joinWords(folded[1].words)).toBe('a27 a28 a29');
    expect(V.joinWords(folded[4].words)).toBe('b0 b1 b2');
    // short equal runs are left alone
    expect(V.foldContext(V.wordDiff('a b OLD c d', 'a b NEW c d').ops, 3).some(o => o.t === 'gap')).toBe(false);
  });
});

describe('a page is named by its address', () => {
  it('drops the #fragment and the sign-in part, keeps the query', () => {
    expect(V.pageKey('https://user:pw@Example.com/a/b?x=1#top')).toBe('https://example.com/a/b?x=1');
    expect(V.pageId('https://example.com/a#one')).toBe(V.pageId('https://example.com/a#two'));
    expect(V.pageId('https://example.com/a?x=1')).not.toBe(V.pageId('https://example.com/a?x=2'));
  });
  it('is a file name made of one letter and hex digits, whatever the address holds', () => {
    expect(V.pageId('https://example.com/../../etc/passwd?x=../')).toMatch(/^p[0-9a-f]{16}$/);
  });
  it('only a web page', () => {
    for (const u of ['file:///C:/x.html', 'javascript:alert(1)', 'vex://settings', 'not a url', '']) expect(() => V.pageKey(u), u).toThrow();
  });
});

describe('a text version', () => {
  const page = () => V.newPage('https://example.com/terms', 'Terms', 100);
  it('is cleaned: line ends, trailing spaces, control characters, runs of blank lines', () => {
    expect(V.cleanVersionText('a  \r\nb\u0000\n\n\n\nc \n')).toBe('a\nb\n\nc');
  });
  it('the first version has no earlier one to compare with', () => {
    const r = V.addVersion(page(), 'hello world', { now: 200 });
    expect(r).toMatchObject({ saved: true, change: null, truncated: false });
    expect(r.page.versions).toEqual([{ at: 200, text: 'hello world', truncated: false, change: null, via: 'page' }]);
  });
  it('the same text again adds nothing', () => {
    const one = V.addVersion(page(), 'hello world', { now: 200 }).page;
    const r = V.addVersion(one, 'hello world\n', { now: 300 });
    expect(r.saved).toBe(false);
    expect(r.page).toBe(one);
    expect(r.change).toEqual({ added: 0, removed: 0 });
  });
  it('a changed text is kept with what changed since the version before', () => {
    const one = V.addVersion(page(), 'one two three', { now: 200 }).page;
    const r = V.addVersion(one, 'one two four five', { now: 300, via: 'watch' });
    expect(r.change).toEqual({ added: 2, removed: 1 });
    expect(r.page.versions.map(v => v.at)).toEqual([200, 300]);
    expect(r.page.versions[1]).toMatchObject({ change: { added: 2, removed: 1 }, via: 'watch' });
  });
  it('every version has its own time, even when the clock does not move', () => {
    let p = page();
    for (const t of ['a', 'b', 'c']) p = V.addVersion(p, t, { now: 500 }).page;
    expect(p.versions.map(v => v.at)).toEqual([500, 501, 502]);
  });
  it('keeps 20 versions and lets the oldest go', () => {
    let p = page();
    for (let i = 0; i < 25; i++) p = V.addVersion(p, 'version number ' + i, { now: 1000 + i }).page;
    expect(p.versions.length).toBe(20);
    expect(p.versions[0].text).toBe('version number 5');
    expect(p.versions[19].text).toBe('version number 24');
  });
  it('cuts a text at 200 KB and says it was cut', () => {
    const r = V.addVersion(page(), 'x'.repeat(250 * 1024), { now: 1 });
    expect(r.truncated).toBe(true);
    expect(r.page.versions[0].text.length).toBe(200 * 1024);
    expect(r.page.versions[0].truncated).toBe(true);
  });
  it('a page with no readable text is refused', () => {
    expect(() => V.addVersion(page(), '  \n\n ', { now: 1 })).toThrow(/no readable text/);
  });
  it('does not change the page it was given', () => {
    const p = page();
    V.addVersion(p, 'text', { now: 1 });
    expect(p.versions).toEqual([]);
  });
});

describe('the files', () => {
  let dir, now;
  const open = (fsImpl) => createVersionStore({ dir, fsImpl: fsImpl || fs, now: () => now, log: quiet });
  const URL1 = 'https://example.com/terms';
  beforeEach(() => { dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kv-')), 'kept-pages', 'versions'); now = 1000; });
  afterEach(() => { fs.rmSync(path.resolve(dir, '..', '..'), { recursive: true, force: true }); });

  it('keeps nothing until a page is marked', () => {
    const s = open();
    expect(s.isKept(URL1)).toBe(false);
    expect(() => s.save(URL1, 'Terms', 'some text')).toThrow(/Keep versions of this page first/);
    expect(s.saveIfKept(URL1, 'Terms', 'some text')).toBeNull();
    expect(s.list()).toEqual([]);
  });
  it('marks a page, saves versions, and remembers them across a restart', () => {
    const s = open();
    s.keep(URL1, 'Terms');
    expect(s.save(URL1, 'Terms', 'We keep your data for 30 days.')).toMatchObject({ saved: true, change: null, count: 1 });
    now = 2000;
    expect(s.save(URL1, 'Terms', 'We keep your data for 90 days.')).toMatchObject({ saved: true, change: { added: 1, removed: 1 }, count: 2 });
    now = 3000;
    expect(s.save(URL1, 'Terms', 'We keep your data for 90 days.')).toMatchObject({ saved: false, count: 2 });
    const again = open();
    const meta = again.list()[0];
    expect(meta).toMatchObject({ url: URL1, title: 'Terms', count: 2, lastAt: 2000, lastChange: { added: 1, removed: 1 } });
    const vs = again.versions(meta.id);
    expect(vs.map(v => v.at)).toEqual([1000, 2000]);
    expect(again.text(meta.id, 1000)).toBe('We keep your data for 30 days.');
    const d = again.diff(meta.id, 1000, 2000);
    expect(texts(d.ops, 'del')).toEqual(['30']);
    expect(texts(d.ops, 'add')).toEqual(['90']);
  });
  it('a page watch saves only for a page that was marked, and says it read the page its own way', () => {
    const s = open();
    s.keep(URL1, 'Terms');
    now = 2000;
    expect(s.saveIfKept(URL1 + '#section', 'Terms', 'text from the watch')).toMatchObject({ saved: true });
    expect(s.versions(s.list()[0].id)[0].via).toBe('watch');
    expect(s.saveIfKept('https://other.example/page', 'Other', 'text')).toBeNull();
  });
  it('refuses the 101st page and keeps the 100 it has', () => {
    const s = open();
    for (let i = 0; i < 100; i++) s.keep('https://example.com/page' + i, 'P' + i);
    expect(() => s.keep('https://example.com/one-more', 'x')).toThrow(/100 pages/);
    expect(s.list().length).toBe(100);
    expect(s.keep('https://example.com/page5', 'P5').id).toBe(V.pageId('https://example.com/page5'));
    s.forget(V.pageId('https://example.com/page5'));
    expect(() => s.keep('https://example.com/one-more', 'x')).not.toThrow();
  });
  it('keeps 20 versions on disk, the newest', () => {
    const s = open();
    s.keep(URL1, 'Terms');
    for (let i = 0; i < 23; i++) { now = 1000 + i; s.save(URL1, 'Terms', 'version ' + i); }
    const id = s.list()[0].id;
    expect(s.versions(id).length).toBe(20);
    expect(s.text(id, s.versions(id)[0].at)).toBe('version 3');
  });
  it('is not kept from a bank, payment, sign-in, mail or health page', () => {
    const s = open();
    for (const url of ['https://www.paypal.com/x', 'https://example.com/login', 'https://mail.google.com/mail', 'https://example.com/a?token=abc', 'https://mychart.example.org/']) {
      expect(() => s.keep(url, 'x'), url).toThrow();
      expect(() => s.save(url, 'x', 'text'), url).toThrow();
      expect(s.saveIfKept(url, 'x', 'text'), url).toBeNull();
    }
    expect(s.list()).toEqual([]);
  });
  it('a page that was kept and later turns out to be a sign-in page is not saved to', () => {
    const s = open();
    s.keep('https://example.com/news', 'News');
    expect(s.saveIfKept('https://example.com/news', 'News', 'text')).toMatchObject({ saved: true });
    expect(() => s.keep('https://example.com/account', 'x')).toThrow();
  });
  it('forgets one page, and "delete everything" removes every file it kept and nothing else', () => {
    const s = open();
    const a = s.keep(URL1, 'Terms').id;
    s.keep('https://example.com/other', 'Other');
    s.save(URL1, 'Terms', 'text');
    const neighbour = path.join(dir, '..', 'recall-extras.json');
    fs.writeFileSync(neighbour, '{"v":1,"items":[]}');
    expect(s.forget(a)).toBe(true);
    expect(s.forget(a)).toBe(false);
    expect(s.list().length).toBe(1);
    expect(s.clearAll()).toBeGreaterThan(0);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(neighbour)).toBe(true);
    expect(open().list()).toEqual([]);
  });
  it('a write that fails half way leaves the kept versions as they were', () => {
    const s = open();
    s.keep(URL1, 'Terms');
    s.save(URL1, 'Terms', 'first text');
    const id = s.list()[0].id;
    const before = fs.readFileSync(path.join(dir, id + '.json'), 'utf8');
    const broken = { ...fs, renameSync() { throw new Error('the disk went away'); } };
    now = 2000;
    expect(() => open(broken).save(URL1, 'Terms', 'second text')).toThrow(/disk went away/);
    expect(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')).toBe(before);
    expect(open().versions(id).length).toBe(1);
  });
  it('a version that is not there is said so', () => {
    const s = open();
    const id = s.keep(URL1, 'Terms').id;
    s.save(URL1, 'Terms', 'text');
    expect(() => s.text(id, 99)).toThrow(/gone/);
    expect(() => s.diff(id, 1000, 99)).toThrow(/gone/);
    expect(() => s.versions('pnotthere')).toThrow(/not being kept/);
  });
});

describe('the IPC channels', () => {
  let root, handlers;
  const call = async (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kvi-'));
    handlers = new Map();
    let t = 1000;
    registerVersions({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, baseDir: () => root, now: () => (t += 10), log: quiet });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('marks, saves, lists and compares', async () => {
    expect((await call('recall:versions-kept', 'https://example.com/a')).kept).toBe(false);
    const kept = await call('recall:versions-keep', 'https://example.com/a', 'A');
    expect(kept.ok).toBe(true);
    expect((await call('recall:versions-kept', 'https://example.com/a')).kept).toBe(true);
    const one = await call('recall:versions-save', 'https://example.com/a', 'A', 'alpha beta');
    const two = await call('recall:versions-save', 'https://example.com/a', 'A', 'alpha gamma');
    expect(one).toMatchObject({ ok: true, saved: true, count: 1 });
    expect(two).toMatchObject({ ok: true, saved: true, count: 2, change: { added: 1, removed: 1 } });
    const list = await call('recall:versions-list');
    expect(list.items.length).toBe(1);
    expect(list.limits.versionsPerPage).toBe(20);
    const vs = (await call('recall:versions-of', kept.meta.id)).versions;
    const diff = (await call('recall:versions-diff', kept.meta.id, vs[0].at, vs[1].at)).diff;
    expect([diff.added, diff.removed]).toEqual([1, 1]);
    expect((await call('recall:versions-text', kept.meta.id, vs[0].at)).text).toBe('alpha beta');
  });
  it('answers { ok: false, error } for what is refused, and the watch route for what is not kept', async () => {
    const bad = await call('recall:versions-keep', 'https://www.paypal.com/x', 'x');
    expect(bad.ok).toBe(false);
    expect((await call('recall:versions-save', 'https://example.com/never', 'x', 'text')).ok).toBe(false);
    expect(await call('recall:versions-save-kept', 'https://example.com/never', 'x', 'text')).toEqual({ ok: true, kept: false });
  });
  it('"delete everything" empties the folder', async () => {
    await call('recall:versions-keep', 'https://example.com/a', 'A');
    expect((await call('recall:versions-clear')).ok).toBe(true);
    expect((await call('recall:versions-list')).items).toEqual([]);
    expect(fs.existsSync(path.join(root, 'kept-pages', 'versions'))).toBe(false);
  });
});

describe('the contracts', () => {
  const channels = ['recall:versions-list', 'recall:versions-keep', 'recall:versions-kept', 'recall:versions-save', 'recall:versions-save-kept',
    'recall:versions-of', 'recall:versions-text', 'recall:versions-diff', 'recall:versions-forget', 'recall:versions-clear'];
  it('every channel is the window\'s own and closed in a private window', () => {
    const src = fs.readFileSync('src/main/ipc-policy.js', 'utf8');
    const re = eval(src.match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]);
    for (const c of channels) {
      expect(policy.UI_ONLY_CHANNELS.has(c), c).toBe(true);
      expect(re.test(c), c).toBe(true);
    }
  });
  it('payloads are checked', () => {
    expect(() => validate('recall:versions-keep', ['https://example.com/a', 'Title'])).not.toThrow();
    expect(() => validate('recall:versions-keep', ['javascript:alert(1)'])).toThrow();
    expect(() => validate('recall:versions-save', ['https://example.com/a', 'T', 'x'.repeat(300000)])).not.toThrow();
    expect(() => validate('recall:versions-save', ['https://example.com/a', 'T', 'x'.repeat(300001)])).toThrow();
    expect(() => validate('recall:versions-diff', ['pabc', 1, 2])).not.toThrow();
    expect(() => validate('recall:versions-diff', ['pabc', '1', 2])).toThrow();
    expect(() => validate('recall:versions-of', [])).toThrow();
  });
});
