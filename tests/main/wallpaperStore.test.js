// The Wallpaper Store's files and its one optional fetch (src/main/wallpaper-store.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWallpaperStore, registerWallpaperStore, CAPS, MINE_MAX_FILES } = require('../../src/main/wallpaper-store.js');

const JPEG = (n = 2000, fill = 1) => { const b = Buffer.alloc(n, fill); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

let dir, store, fetchCalls, answers, clock;
const entry = (id) => ({ id: 'pic-' + id, title: 'T ' + id, author: 'A', licence: 'CC0-1.0', sourceUrl: 'https://h.example/s/' + id, thumbUrl: 'https://h.example/t/' + id + '.jpg', fullUrl: 'https://h.example/f/' + id + '.jpg', tags: [], category: 'nature', dominant: '#102030' });
const listDoc = (ids) => JSON.stringify({ schema: 1, name: 'L', entries: ids.map(entry) });
const reply = (body, ok = true, status = 200) => ({ ok, status, text: async () => body, arrayBuffer: async () => (Buffer.isBuffer(body) ? ab(body) : ab(Buffer.from(body))) });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-wall-'));
  fetchCalls = []; answers = []; clock = 1_000_000;
  const fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url, init });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    if (!a) throw new Error('unexpected fetch ' + url);
    return a;
  });
  store = createWallpaperStore({ dir, fs, path, fetch, now: () => clock });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('saving and reading pictures', () => {
  it('keeps a JPEG and gives it back as a data: URL', () => {
    store.save('my-aabbccddeeff', 'mine', ab(JPEG()));
    const r = store.read('my-aabbccddeeff', 'mine');
    expect(r.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(r.bytes).toBe(2000);
    expect(fs.existsSync(path.join(dir, 'mine', 'my-aabbccddeeff.jpg'))).toBe(true);
  });
  it('reads nothing as null (a picture that was never kept)', () => {
    expect(store.read('photo-none', 'full')).toBeNull();
  });
  it('saves again over the same id without leaving the old file (even of another type)', () => {
    store.save('photo-a1', 'full', ab(JPEG()));
    store.save('photo-a1', 'full', ab(PNG()));
    expect(fs.readdirSync(path.join(dir, 'full'))).toEqual(['photo-a1.png']);
  });
  it('refuses anything that is not PNG, JPEG or WebP', () => {
    expect(() => store.save('photo-a1', 'full', ab(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))).toThrow(/PNG, JPEG or WebP/);
    expect(() => store.save('photo-a1', 'full', ab(Buffer.from('MZ' + 'x'.repeat(50))))).toThrow(/PNG, JPEG or WebP/);
  });
  it('refuses a picture over its cap, and says the size', () => {
    expect(() => store.save('photo-a1', 'thumb', ab(JPEG(CAPS.thumb + 1)))).toThrow(/too big to keep/);
    expect(() => store.save('photo-a1', 'full', ab(JPEG(CAPS.full + 1)))).toThrow(/too big to keep/);
    expect(store.stats().cacheFiles).toBe(0);
  });
  it.each(['../evil', 'a/b', 'A-B', '', 'x', 'a.b'])('refuses the id %j (no path can be built from it)', (id) => {
    expect(() => store.save(id, 'full', ab(JPEG()))).toThrow(/wallpaper id/);
    expect(() => store.read(id, 'full')).toThrow(/wallpaper id/);
    expect(() => store.remove(id)).toThrow(/wallpaper id/);
  });
  it('refuses an unknown kind', () => {
    expect(() => store.save('photo-a1', 'huge', ab(JPEG()))).toThrow(/Unknown wallpaper file kind/);
  });
  it('removes all kinds of one picture, or one kind', () => {
    store.save('photo-a1', 'full', ab(JPEG())); store.save('photo-a1', 'thumb', ab(JPEG()));
    store.remove('photo-a1', 'thumb');
    expect(store.read('photo-a1', 'thumb')).toBeNull();
    expect(store.read('photo-a1', 'full')).not.toBeNull();
    store.remove('photo-a1');
    expect(store.read('photo-a1', 'full')).toBeNull();
  });
});

describe('the limits', () => {
  it('lets him keep 24 pictures of his own and refuses the 25th out loud', () => {
    for (let i = 0; i < MINE_MAX_FILES; i++) store.save('my-' + String(i).padStart(12, '0'), 'mine', ab(JPEG(100)));
    expect(() => store.save('my-ffffffffffff', 'mine', ab(JPEG(100)))).toThrow(/24 pictures of your own/);
    store.save('my-000000000003', 'mine', ab(JPEG(150)));       // replacing one of the 24 is fine
    expect(store.stats().mineFiles).toBe(24);
  });
  it('lets go of the least recently used downloaded pictures when the cache is over 80 MB, never his own', () => {
    store.save('my-aaaaaaaaaaaa', 'mine', ab(JPEG(100)));
    // 30 files of 3 MB = 90 MB: the oldest go.
    for (let i = 0; i < 30; i++) {
      store.save('photo-p' + String(i).padStart(2, '0'), 'full', ab(JPEG(3 * 1024 * 1024)));
      const old = new Date(2020, 0, 1, 0, 0, i);
      fs.utimesSync(path.join(dir, 'full', 'photo-p' + String(i).padStart(2, '0') + '.jpg'), old, old);
    }
    const s = store.stats();
    expect(s.cacheBytes).toBeLessThanOrEqual(s.cacheMax);
    expect(s.cachedIds).toContain('photo-p29');
    expect(s.cachedIds).not.toContain('photo-p00');
    expect(s.mineIds).toEqual(['my-aaaaaaaaaaaa']);
  }, 30000);
  it('clears the downloaded pictures and the saved list, not his own', async () => {
    store.save('my-aaaaaaaaaaaa', 'mine', ab(JPEG(100)));
    store.save('photo-a1', 'full', ab(JPEG(100)));
    answers.push(reply(listDoc(['a1'])));
    await store.catalogue('https://h.example/list.json', false);
    const r = store.clearCache();
    expect(r.freed).toBe(100);
    expect(store.stats()).toMatchObject({ cacheFiles: 0, mineFiles: 1, catalogue: null });
  });
});

describe('the hosted list', () => {
  const URL_ = 'https://h.example/list.json';

  it('needs an https address and fetches nothing without one', async () => {
    await expect(store.catalogue('', false)).rejects.toThrow(/https address/);
    await expect(store.catalogue('http://h.example/list.json', false)).rejects.toThrow(/https address/);
    expect(fetchCalls).toHaveLength(0);
  });
  it('fetches it once, with no cookies and a size cap, validates it and keeps the last good copy', async () => {
    answers.push(reply(listDoc(['a1', 'b2'])));
    const r = await store.catalogue(URL_, false);
    expect(r.entries.map(e => e.id)).toEqual(['pic-a1', 'pic-b2']);
    expect(r.cached).toBe(false);
    expect(fetchCalls[0].init).toMatchObject({ credentials: 'omit', maxBytes: 1024 * 1024, egress: { feature: 'Wallpaper store' } });
    expect(store.stats().catalogue).toMatchObject({ url: URL_, count: 2 });
  });
  it('answers from the saved copy inside a day (no second request), and fetches again when forced or old', async () => {
    answers.push(reply(listDoc(['a1'])));
    await store.catalogue(URL_, false);
    clock += 3600_000;
    expect((await store.catalogue(URL_, false)).cached).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    answers.push(reply(listDoc(['a1', 'c3'])));
    expect((await store.catalogue(URL_, true)).entries).toHaveLength(2);
    clock += 25 * 3600_000;
    answers.push(reply(listDoc(['a1'])));
    expect((await store.catalogue(URL_, false)).entries).toHaveLength(1);
    expect(fetchCalls).toHaveLength(3);
  });
  it('works offline: the saved copy of the same list answers and says it is old', async () => {
    answers.push(reply(listDoc(['a1'])));
    await store.catalogue(URL_, false);
    clock += 30 * 3600_000;
    answers.push(new Error('getaddrinfo ENOTFOUND h.example'));
    const r = await store.catalogue(URL_, false);
    expect(r).toMatchObject({ stale: true, cached: true });
    expect(r.error).toMatch(/ENOTFOUND/);
    expect(r.entries).toHaveLength(1);
  });
  it('offline with no saved copy, or another address, is an error (nothing is made up)', async () => {
    answers.push(new Error('offline'));
    await expect(store.catalogue(URL_, false)).rejects.toThrow('offline');
    answers.push(reply(listDoc(['a1'])));
    await store.catalogue(URL_, false);
    answers.push(new Error('offline'));
    await expect(store.catalogue('https://other.example/l.json', false)).rejects.toThrow('offline');
  });
  it('a server error, bad JSON or a wrong schema is an error, and a good saved copy stays', async () => {
    answers.push(reply(listDoc(['a1'])));
    await store.catalogue(URL_, false);
    answers.push(reply('nope', false, 503));
    expect((await store.catalogue(URL_, true)).error).toMatch(/503/);
    answers.push(reply('{not json'));
    expect((await store.catalogue(URL_, true)).error).toMatch(/not valid JSON/);
    answers.push(reply(JSON.stringify({ schema: 9, entries: [] })));
    expect((await store.catalogue(URL_, true)).error).toMatch(/schema 1/);
    expect(store.stats().catalogue.count).toBe(1);
  });
  it('passes on what was dropped from the list', async () => {
    answers.push(reply(JSON.stringify({ schema: 1, entries: [entry('a1'), { ...entry('b2'), licence: 'nope' }] })));
    const r = await store.catalogue(URL_, false);
    expect(r.entries).toHaveLength(1);
    expect(r.problems[0]).toMatch(/pic-b2.*licence/);
  });
});

describe('downloading a listed picture', () => {
  const URL_ = 'https://h.example/list.json';
  beforeEach(async () => { answers.push(reply(listDoc(['a1']))); await store.catalogue(URL_, false); fetchCalls.length = 0; });

  it('gets only an address that is in the list, as PNG/JPEG/WebP bytes', async () => {
    answers.push(reply(JPEG(500)));
    const r = await store.download('https://h.example/f/a1.jpg', 'full');
    expect(r.mime).toBe('image/jpeg');
    expect(r.bytes.byteLength).toBe(500);
    expect(fetchCalls[0].init).toMatchObject({ credentials: 'omit', maxBytes: 12 * 1024 * 1024 });
  });
  it('refuses any address that the list does not name (the window cannot use it as a downloader)', async () => {
    await expect(store.download('https://evil.example/x.jpg', 'full')).rejects.toThrow(/not in the wallpaper list/);
    await expect(store.download('http://h.example/f/a1.jpg', 'full')).rejects.toThrow(/https/);
    expect(fetchCalls).toHaveLength(0);
  });
  it('refuses an answer that is not a picture (a web page, a script)', async () => {
    answers.push(reply('<html>hi</html>'));
    await expect(store.download('https://h.example/t/a1.jpg', 'thumb')).rejects.toThrow(/PNG, JPEG or WebP/);
  });
  it('says so when the server answers with an error', async () => {
    answers.push(reply('', false, 404));
    await expect(store.download('https://h.example/f/a1.jpg', 'full')).rejects.toThrow(/404/);
  });
});

describe('the IPC side', () => {
  it('registers exactly the seven channels', () => {
    const names = [];
    registerWallpaperStore({ ipcMain: { handle: (n) => names.push(n) }, dir, fs, path, fetch: async () => { throw new Error('no'); } });
    expect(names.sort()).toEqual(['wallpaper:catalogue', 'wallpaper:clear-cache', 'wallpaper:download', 'wallpaper:read', 'wallpaper:remove', 'wallpaper:save', 'wallpaper:stats']);
  });
});
