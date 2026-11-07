// Extra things remembered in Recall (Wave 5): the pure rules (src/renderer/js/evodata-extras-core.js), the small file
// (src/main/evodata-extras-store.js) on a real temp folder, and the IPC wiring (src/main/evodata-extras-ipc.js).
// The point of the separate file: recall.json (a bare ~4 MB array rewritten whole) is never read or written here.
// Deterministic: every time is passed in, no network, no Electron, nothing outside a fresh temp folder.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const X = require('../../src/renderer/js/evodata-extras-core.js');
const { createExtrasStore } = require('../../src/main/evodata-extras-store.js');
const { registerExtras } = require('../../src/main/evodata-extras-ipc.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const policy = require('../../src/main/ipc-policy.js');

const quiet = { error() {}, warn() {}, log() {} };
const item = (kind, text, extra = {}) => X.cleanExtra({ kind, text, ...extra }, { id: 'x' + text.length + kind, now: 1000 });

describe('one thing to remember', () => {
  it('is a clip, a file name, a reminder or a note, with text', () => {
    expect(item('clip', 'a selected sentence')).toMatchObject({ kind: 'clip', text: 'a selected sentence', url: '', title: '', at: 1000 });
    for (const kind of ['file', 'reminder', 'note']) expect(item(kind, 'x').kind).toBe(kind);
    expect(() => X.cleanExtra({ kind: 'page', text: 'x' })).toThrow(/clip, a downloaded file name, a reminder or a note/);
    expect(() => X.cleanExtra({ kind: 'clip', text: '   ' })).toThrow(/nothing to remember/);
    expect(() => X.cleanExtra(null)).toThrow(/nothing to remember/);
  });
  it('is cut at 2,000 characters, the title at 200, and keeps line breaks', () => {
    const t = X.cleanExtra({ kind: 'note', text: 'line one\r\nline two' + 'x'.repeat(3000), title: 'T'.repeat(500) }, { id: 'x1' });
    expect(t.text.length).toBe(2000);
    expect(t.text.startsWith('line one\nline two')).toBe(true);
    expect(t.title.length).toBe(200);
  });
  it('keeps the address of the page it came from without a sign-in part or #fragment, and only a web address', () => {
    expect(item('clip', 'x', { url: 'https://user:pw@example.com/a?q=1#frag' }).url).toBe('https://example.com/a?q=1');
    expect(item('clip', 'x', { url: 'file:///C:/secret.html' }).url).toBe('');
    expect(() => X.cleanExtra({ kind: 'clip', text: 'x', url: 'not a url' })).toThrow(/not valid/);
  });
});

describe('the list is capped, newest first, the oldest go', () => {
  it('puts the newest first', () => {
    let items = [];
    for (let i = 0; i < 3; i++) items = X.addExtra(items, X.cleanExtra({ kind: 'note', text: 'n' + i }, { id: 'x' + i, now: 100 + i })).items;
    expect(items.map(i => i.text)).toEqual(['n2', 'n1', 'n0']);
  });
  it('the same thing again only moves it to the top with a new time', () => {
    let items = [];
    items = X.addExtra(items, X.cleanExtra({ kind: 'note', text: 'same' }, { id: 'a', now: 1 })).items;
    items = X.addExtra(items, X.cleanExtra({ kind: 'note', text: 'other' }, { id: 'b', now: 2 })).items;
    const r = X.addExtra(items, X.cleanExtra({ kind: 'note', text: 'same' }, { id: 'c', now: 3 }));
    expect(r.items.map(i => [i.id, i.at])).toEqual([['a', 3], ['b', 2]]);
    // the same words as a different kind are a different thing
    expect(X.addExtra(r.items, X.cleanExtra({ kind: 'clip', text: 'same' }, { id: 'd', now: 4 })).items.length).toBe(3);
  });
  it('keeps 500 things and drops the oldest', () => {
    let items = [];
    for (let i = 0; i < 503; i++) items = X.addExtra(items, X.cleanExtra({ kind: 'note', text: 'note ' + i }, { id: 'x' + i, now: i })).items;
    expect(items.length).toBe(500);
    expect(items[0].text).toBe('note 502');
    expect(items[499].text).toBe('note 3');
  });
  it('keeps 400 KB of text in all and drops the oldest first', () => {
    let items = [], evicted = 0;
    for (let i = 0; i < 300; i++) {
      const r = X.addExtra(items, X.cleanExtra({ kind: 'note', text: String(i).padStart(4, '0') + 'y'.repeat(1990) }, { id: 'x' + i, now: i }));
      items = r.items; evicted += r.evicted;
    }
    const chars = items.reduce((s, x) => s + x.text.length + x.title.length, 0);
    expect(chars).toBeLessThanOrEqual(X.LIMITS.extrasChars);
    expect(evicted).toBeGreaterThan(0);
    expect(items[0].text.startsWith('0299')).toBe(true);
    expect(items.length).toBe(300 - evicted);
  });
});

describe('searching what was remembered', () => {
  const mk = (id, kind, text, at, title = '') => ({ id, kind, text, title, url: '', at });
  const items = [
    mk('a', 'clip', 'İstanbul ferry timetable for the summer', 30, 'Ferries'),
    mk('b', 'file', 'invoice-2026-03.pdf', 20),
    mk('c', 'reminder', 'call the dentist about the ferry ticket', 10),
    mk('d', 'note', 'nothing to do with it', 5),
  ];
  it('every word must be found, in any order, in the text or the title', () => {
    expect(X.searchExtras(items, 'ferry').map(h => h.extraId)).toEqual(['a', 'c']);
    expect(X.searchExtras(items, 'ticket ferry').map(h => h.extraId)).toEqual(['c']);
    expect(X.searchExtras(items, 'ferries').map(h => h.extraId)).toEqual(['a']);   // the title is searched too
    expect(X.searchExtras(items, 'ferrie').map(h => h.extraId)).toEqual(['a']);    // a word is found as part of a longer one
    expect(X.searchExtras(items, 'Ferries summer').map(h => h.extraId)).toEqual(['a']);
    expect(X.searchExtras(items, '   ')).toEqual([]);
  });
  it('finds Turkish letters whatever the case or the dots', () => {
    expect(X.searchExtras(items, 'istanbul').map(h => h.extraId)).toEqual(['a']);
    expect(X.searchExtras(items, 'İSTANBUL').map(h => h.extraId)).toEqual(['a']);
  });
  it('gives each hit its type label and the shape the Recall panel draws', () => {
    const hits = X.searchExtras(items, 'invoice');
    expect(hits).toEqual([{
      extraId: 'b', kind: 'file', label: 'Downloaded file', url: '', title: 'invoice-2026-03.pdf', at: 20, host: '', visits: 0,
      snippet: [['invoice-2026-03.pdf', false]], text: 'invoice-2026-03.pdf',
    }]);
    expect(X.searchExtras(items, 'ferry').map(h => h.label)).toEqual(['Clip', 'Reminder']);
  });
  it('can start from a time, is newest first, and has a limit', () => {
    expect(X.searchExtras(items, 'ferry', { since: 15 }).map(h => h.extraId)).toEqual(['a']);
    expect(X.searchExtras(items, 'ferry', { limit: 1 }).length).toBe(1);
  });
  it('a long text is shown around the first word found', () => {
    const long = [mk('l', 'clip', 'x '.repeat(100) + 'needle ' + 'y '.repeat(100), 1)];
    const hit = X.searchExtras(long, 'needle')[0];
    expect(hit.snippet[0][0].startsWith('\u2026')).toBe(true);
    expect(hit.snippet[0][0]).toContain('needle');
    expect(hit.snippet[0][0].length).toBeLessThan(200);
  });
});

describe('the file', () => {
  let dir, file, now;
  const open = (fsImpl) => createExtrasStore({ file, fsImpl: fsImpl || fs, now: () => now });
  beforeEach(() => { dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kx-')), 'kept-pages'); file = path.join(dir, 'recall-extras.json'); now = 1000; });
  afterEach(() => { fs.rmSync(path.resolve(dir, '..'), { recursive: true, force: true }); });

  it('is empty at first and writes nothing until something is added', () => {
    const s = open();
    expect(s.list()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
  });
  it('keeps what is added across a restart, newest first', () => {
    const s = open();
    s.add({ kind: 'note', text: 'first' });
    now = 2000;
    s.add({ kind: 'clip', text: 'second', title: 'Page', url: 'https://example.com/p#x' });
    const again = open().list();
    expect(again.map(i => i.text)).toEqual(['second', 'first']);
    expect(again[0]).toMatchObject({ kind: 'clip', title: 'Page', url: 'https://example.com/p', at: 2000 });
  });
  it('is not made from a bank, payment, sign-in, mail or health page', () => {
    const s = open();
    for (const url of ['https://www.paypal.com/x', 'https://example.com/login', 'https://mail.google.com/mail', 'https://example.com/a?token=abc']) {
      expect(() => s.add({ kind: 'clip', text: 'secret words', url }), url).toThrow();
    }
    expect(s.list()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
  });
  it('removes one thing, and "delete everything" removes the file and nothing else', () => {
    const s = open();
    const a = s.add({ kind: 'note', text: 'one' }).item.id;
    s.add({ kind: 'note', text: 'two' });
    const neighbour = path.join(dir, 'recall.json');
    fs.writeFileSync(neighbour, '[{"url":"https://example.com","text":"a page"}]');
    expect(s.remove(a)).toBe(true);
    expect(s.remove(a)).toBe(false);
    expect(s.list().length).toBe(1);
    expect(s.clearAll()).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(open().list()).toEqual([]);
    expect(fs.readFileSync(neighbour, 'utf8')).toBe('[{"url":"https://example.com","text":"a page"}]');
  });
  it('never reads or writes recall.json', () => {
    const recall = path.join(dir, 'recall.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(recall, '[]');
    const before = fs.statSync(recall).mtimeMs;
    const s = open();
    s.add({ kind: 'note', text: 'x' });
    s.remove(s.list()[0].id);
    s.clearAll();
    expect(fs.readFileSync(recall, 'utf8')).toBe('[]');
    expect(fs.statSync(recall).mtimeMs).toBe(before);
  });
  it('reports how many were evicted when the cap pushes the oldest out', () => {
    const s = open();
    let evicted = 0;
    for (let i = 0; i < 503; i++) evicted += s.add({ kind: 'note', text: 'note ' + i }).evicted;
    expect(evicted).toBe(3);
    expect(s.list().length).toBe(500);
  });
  it('a write that fails half way leaves the list as it was, and says so', () => {
    const s = open();
    s.add({ kind: 'note', text: 'safe' });
    const before = fs.readFileSync(file, 'utf8');
    const broken = { ...fs, renameSync() { throw new Error('the disk went away'); } };
    expect(() => open(broken).add({ kind: 'note', text: 'lost' })).toThrow(/disk went away/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(open().list().map(i => i.text)).toEqual(['safe']);
  });
  it('a file that is damaged is kept aside and reported, not rewritten', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '{"items":[');
    expect(() => open().list()).toThrow(/could not be read/);
    expect(fs.readdirSync(dir).some(n => n.includes('.corrupt-'))).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"items":[');
  });
  it('drops saved entries that are not well formed', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ v: 1, items: [{ id: 'x1', kind: 'note', text: 'good', at: 1 }, { id: 'x2', kind: 'bogus', text: 'bad', at: 2 }, { kind: 'note', text: 'no id' }, null] }));
    expect(open().list().map(i => i.text)).toEqual(['good']);
  });
});

describe('the IPC channels', () => {
  let root, handlers;
  const call = async (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kxi-'));
    handlers = new Map();
    registerExtras({ ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, baseDir: () => root, now: () => 5000, log: quiet });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('adds, lists, removes and clears', async () => {
    const added = await call('recall:extra-add', { kind: 'reminder', text: 'renew passport' });
    expect(added.ok).toBe(true);
    expect(added.item).toMatchObject({ kind: 'reminder', text: 'renew passport' });
    expect(added.evicted).toBe(0);
    const list = await call('recall:extra-list');
    expect(list.items.length).toBe(1);
    expect(list.limits.extras).toBe(500);
    expect((await call('recall:extra-remove', added.item.id)).removed).toBe(true);
    await call('recall:extra-add', { kind: 'note', text: 'again' });
    expect((await call('recall:extra-clear')).removed).toBe(1);
    expect((await call('recall:extra-list')).items).toEqual([]);
    expect(fs.existsSync(path.join(root, 'kept-pages', 'recall-extras.json'))).toBe(false);
  });
  it('answers { ok: false, error } for what is refused', async () => {
    expect((await call('recall:extra-add', { kind: 'clip', text: 'x', url: 'https://www.paypal.com/' })).ok).toBe(false);
    expect((await call('recall:extra-add', { kind: 'clip', text: '  ' })).ok).toBe(false);
  });
});

describe('the contracts', () => {
  const channels = ['recall:extra-add', 'recall:extra-list', 'recall:extra-remove', 'recall:extra-clear'];
  it('every channel is the window\'s own and closed in a private window', () => {
    const src = fs.readFileSync('src/main/ipc-policy.js', 'utf8');
    const re = eval(src.match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]);
    for (const c of channels) {
      expect(policy.UI_ONLY_CHANNELS.has(c), c).toBe(true);
      expect(re.test(c), c).toBe(true);
    }
  });
  it('payloads are checked: the kind, the sizes', () => {
    expect(() => validate('recall:extra-add', [{ kind: 'clip', text: 'x', title: 'T', url: 'https://example.com/' }])).not.toThrow();
    expect(() => validate('recall:extra-add', [{ kind: 'page', text: 'x' }])).toThrow();
    expect(() => validate('recall:extra-add', [{ kind: 'note', text: 'x'.repeat(4001) }])).toThrow();
    expect(() => validate('recall:extra-add', [{ kind: 'note' }])).toThrow();
    expect(() => validate('recall:extra-remove', ['x1'])).not.toThrow();
    expect(() => validate('recall:extra-list', ['extra'])).toThrow();
  });
  it('the existing Recall index file and its channels are as they were', () => {
    const main = fs.readFileSync('src/main.js', 'utf8');
    expect(main).toMatch(/recall\.json/);
    expect(fs.readFileSync('src/main/evodata-extras-store.js', 'utf8')).not.toMatch(/recall\.json'/);
  });
});
