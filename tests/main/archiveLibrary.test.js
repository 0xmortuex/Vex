// src/main/archive-library.js — the managed folder of pages you chose to keep:
// its size bounds, what it refuses, searching, and never deleting by itself.

import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createArchiveLibrary, sensitiveReason, tabRefusal, ArchiveRefused } = require('../../src/main/archive-library.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-archive-')); });

const KB = 1024;
const bytesWriter = (n, text = 'MIME-Version: 1.0') => async (file) => { fs.writeFileSync(file, Buffer.concat([Buffer.from(text), Buffer.alloc(Math.max(0, n - text.length), 97)])); };
function lib(limits, t0 = 1000) {
  let t = t0;
  return createArchiveLibrary({ dir, limits, now: () => t++ });
}
const page = (n, extra = {}) => ({ url: 'https://example.com/a' + n, title: 'Page ' + n, text: 'text of page ' + n, write: bytesWriter(KB), ...extra });

describe('saving a copy', () => {
  it('keeps the file, the text and a list entry under the managed folder', async () => {
    const a = lib();
    const e = await a.save(page(1, { text: 'A guide to throttling and DPI' }));
    expect(e).toMatchObject({ url: 'https://example.com/a1', title: 'Page 1', host: 'example.com' });
    expect(e.bytes).toBeGreaterThan(KB);
    expect(fs.existsSync(path.join(dir, e.id + '.mhtml'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, e.id + '.txt'), 'utf8')).toBe('A guide to throttling and DPI');
    expect((await a.list()).map(x => x.id)).toEqual([e.id]);
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.part'))).toEqual([]);
  });

  it('survives a restart: a new library reads the same list', async () => {
    const e = await lib().save(page(1));
    const again = await lib().list();
    expect(again.map(x => x.id)).toEqual([e.id]);
  });

  it('archiving the same address again replaces its copy and removes the old files', async () => {
    const a = lib();
    const first = await a.save(page(1));
    const second = await a.save(page(1, { title: 'Page 1, newer' }));
    const list = await a.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(second.id);
    expect(fs.existsSync(path.join(dir, first.id + '.mhtml'))).toBe(false);
    expect(fs.existsSync(path.join(dir, first.id + '.txt'))).toBe(false);
  });

  it('a failed write leaves nothing behind and raises the error', async () => {
    const a = lib();
    await expect(a.save(page(1, { write: async (f) => { fs.writeFileSync(f, 'x'); throw new Error('disk gone'); } }))).rejects.toThrow('disk gone');
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('the bounds', () => {
  it('refuses one page over the per-page cap, says so, and keeps no file', async () => {
    const a = lib({ perPageBytes: 10 * KB });
    const err = await a.save(page(1, { write: bytesWriter(11 * KB) })).catch(e => e);
    expect(err).toBeInstanceOf(ArchiveRefused);
    expect(err.code).toBe('too-big');
    expect(err.message).toMatch(/one copy can be at most/);
    expect(fs.readdirSync(dir).filter(f => /\.(mhtml|part|txt)$/.test(f))).toEqual([]);
    expect(await a.list()).toEqual([]);
  });

  it('a full library refuses the next copy, suggests the oldest, and deletes nothing', async () => {
    const a = lib({ perPageBytes: 10 * KB, totalBytes: 25 * KB });
    const one = await a.save(page(1, { write: bytesWriter(10 * KB) }));
    const two = await a.save(page(2, { write: bytesWriter(10 * KB) }));
    const err = await a.save(page(3, { write: bytesWriter(10 * KB) })).catch(e => e);
    expect(err.code).toBe('library-full');
    expect(err.message).toMatch(/Nothing is removed unless you choose to/);
    expect(err.suggest.map(s => s.id)).toEqual([one.id]);   // the oldest first, enough to make room
    const ids = (await a.list()).map(x => x.id);
    expect(ids.sort()).toEqual([one.id, two.id].sort());
    expect(fs.existsSync(path.join(dir, one.id + '.mhtml'))).toBe(true);
    // The person removes the suggested one; the copy then fits.
    await a.remove(one.id);
    await expect(a.save(page(3, { write: bytesWriter(10 * KB) }))).resolves.toBeTruthy();
  });

  it('replacing a copy does not count the old copy against the cap', async () => {
    const a = lib({ perPageBytes: 10 * KB, totalBytes: 12 * KB });
    await a.save(page(1, { write: bytesWriter(10 * KB) }));
    await expect(a.save(page(1, { write: bytesWriter(10 * KB) }))).resolves.toBeTruthy();
  });

  it('reports usage against the caps', async () => {
    const a = lib({ perPageBytes: 10 * KB, totalBytes: 100 * KB });
    await a.save(page(1));
    const s = await a.stats();
    expect(s).toMatchObject({ count: 1, maxBytes: 100 * KB, maxPageBytes: 10 * KB });
    expect(s.bytes).toBeGreaterThan(KB);
  });
});

describe('what is never archived', () => {
  it('refuses sign-in, bank, payment, mail and health pages and addresses carrying secrets', () => {
    for (const u of [
      'https://www.paypal.com/myaccount/summary', 'https://mail.google.com/mail/u/0/', 'https://online.examplebank.com/home',
      'https://example.com/login', 'https://example.com/account/settings', 'https://example.com/checkout',
      'https://example.com/read?token=abc123', 'https://user:pw@example.com/x', 'https://mychart.example.org/', 'ftp://example.com/file',
    ]) expect(sensitiveReason(u), u).toBeTruthy();
  });

  it('allows an ordinary article, even one about banks', () => {
    for (const u of ['https://en.wikipedia.org/wiki/Bank', 'https://example.com/blog/2026/patch-notes', 'http://127.0.0.1:8123/article.html'])
      expect(sensitiveReason(u), u).toBeNull();
  });

  it('the library itself refuses a sensitive address before writing anything', async () => {
    const a = lib();
    let wrote = false;
    const err = await a.save({ url: 'https://example.com/login', title: 'Sign in', text: '', write: async () => { wrote = true; } }).catch(e => e);
    expect(err.code).toBe('sensitive');
    expect(wrote).toBe(false);
  });

  it('only the main browsing session is archived: private, Tor, routed and container tabs are refused', () => {
    expect(tabRefusal('persist:main')).toBeNull();
    for (const p of ['', 'private-window-1', 'persist:route-tor', 'persist:container-tor-1', 'persist:container-work']) expect(tabRefusal(p), p).toMatch(/never archived/);
  });
});

describe('searching and managing', () => {
  it('finds a copy by words in its saved text, not only its title', async () => {
    const a = lib();
    await a.save(page(1, { title: 'Release notes', text: 'The throttling of Discord traffic by providers is explained here.' }));
    await a.save(page(2, { title: 'Cooking', text: 'How to bake bread at home.' }));
    const byBody = await a.search('throttling discord');
    expect(byBody.hits.map(h => h.title)).toEqual(['Release notes']);
    expect(byBody.hits[0].snippet.some(([, hit]) => hit)).toBe(true);
    const byTitle = await a.search('cooking');
    expect(byTitle.hits.map(h => h.title)).toEqual(['Cooking']);
    expect((await a.search('nothing matches this')).hits).toEqual([]);
  });

  it('an empty search lists everything, newest first; a deleted copy is no longer found', async () => {
    const a = lib();
    const x = await a.save(page(1, { text: 'alpha bravo charlie' }));
    const y = await a.save(page(2, { text: 'delta echo foxtrot' }));
    expect((await a.search('')).hits.map(h => h.id)).toEqual([y.id, x.id]);
    expect((await a.search('alpha')).hits).toHaveLength(1);
    await a.remove(x.id);
    expect((await a.search('alpha')).hits).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, x.id + '.mhtml'))).toBe(false);
  });

  it('finds the copy for an address, and exports one to a chosen path', async () => {
    const a = lib();
    const e = await a.save(page(1));
    expect((await a.find('https://example.com/a1')).id).toBe(e.id);
    expect(await a.find('https://example.com/other')).toBeNull();
    const out = path.join(dir, 'exported.mhtml');
    await a.exportTo(e.id, out);
    expect(fs.readFileSync(out, 'utf8').startsWith('MIME-Version')).toBe(true);
  });

  it('only an id of a listed copy gives a file path', async () => {
    const a = lib();
    await a.save(page(1));
    await expect(a.copyPath('../../etc/passwd')).rejects.toThrow('not a saved copy');
    await expect(a.copyPath('0123456789abcdef')).rejects.toThrow('not in the library');
  });

  it('a damaged list is an error, and is left as it is', async () => {
    fs.writeFileSync(path.join(dir, 'index.json'), '{not json');
    await expect(lib().list()).rejects.toThrow(/damaged/);
    expect(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).toBe('{not json');
  });
});
