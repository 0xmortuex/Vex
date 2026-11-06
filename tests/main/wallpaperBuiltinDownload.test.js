// Downloading a picture of the built-in catalogue (src/main/wallpaper-store.js, downloadListed):
// only from a listed host, redirects included; at most 12 MB, counted while the bytes arrive;
// only an image; progress; cancel; the reason in a tag the window can say in the person's language;
// and the cache: least recently used out first, never the wallpaper on, a favourite or a picture of his own.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWallpaperStore } = require('../../src/main/wallpaper-store.js');
const { loadBuiltin } = require('../../src/main/wallpaper-builtin.js');
const { createPublicFetch } = require('../../src/main/public-fetch.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'wallpaper-builtin');
const MB = 1024 * 1024;
const JPEG = (n = 2000, fill = 1) => { const b = Buffer.alloc(n, fill); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const FULL = 'https://images.example.org/f/wave.jpg';
const THUMB = 'https://cdn.example.net/t/mist.jpg';

// A Response whose body arrives in pieces: chunks = [Buffer...]; `pulled` counts how many pieces were read.
function streamed(chunks, { status = 200, type = 'image/jpeg', length } = {}) {
  const state = { pulled: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream({
    pull(ctrl) { if (i >= chunks.length) { ctrl.close(); return; } state.pulled++; ctrl.enqueue(new Uint8Array(chunks[i++])); },
    cancel() { state.cancelled = true; },
  });
  const headers = new Headers();
  if (type) headers.set('content-type', type);
  if (length != null) headers.set('content-length', String(length));
  return { res: new Response(body, { status, headers }), state };
}

let dir, calls;
const make = (streamFetch, extra = {}) => {
  const data = loadBuiltin({ fs, path, dir: FIX });
  return createWallpaperStore({ dir, fs, path, streamFetch, builtin: () => data, ...extra });
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-wbd-')); calls = []; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('a built-in picture', () => {
  it('comes back as bytes with its type, and the request carries no cookies and names the feature', async () => {
    const pic = JPEG(3000);
    const store = make(async (url, init) => { calls.push({ url, init }); return streamed([pic.subarray(0, 1000), pic.subarray(1000)], { length: 3000 }).res; });
    const got = await store.download(FULL, 'full');
    expect(got.mime).toBe('image/jpeg');
    expect(Buffer.from(got.bytes).equals(pic)).toBe(true);
    expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.egress).toEqual({ feature: 'Wallpaper store', kind: 'fetch' });
    expect(typeof calls[0].init.checkUrl).toBe('function');
  });

  it('reports bytes so far and the total as it arrives', async () => {
    const pic = JPEG(3000);
    let t = 0;
    const store = make(async () => streamed([pic.subarray(0, 1000), pic.subarray(1000, 2000), pic.subarray(2000)], { length: 3000 }).res, { now: () => (t += 500) });
    const seen = [];
    await store.download(FULL, 'full', { ticket: 'dl-1', onProgress: (p) => seen.push(p) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toEqual({ got: 3000, total: 3000 });
    expect(seen.every(p => p.total === 3000)).toBe(true);
  });

  it('is refused before any request when its address is not on the host list', async () => {
    const fetchSpy = vi.fn();
    const store = make(fetchSpy);
    // Not an entry of the catalogue at all: it falls through to the person-set list, which is not set here.
    await expect(store.download('https://evil.example.com/f.jpg', 'full')).rejects.toThrow(/not in the wallpaper list/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is refused when the host check (run for the first address and every redirect) says no', async () => {
    const store = make(async (url, init) => { init.checkUrl(new URL('https://evil.example.com/loot.jpg')); return streamed([JPEG()]).res; });
    await expect(store.download(FULL, 'full')).rejects.toThrow(/\[wp:host\].*evil\.example\.com/);
  });

  it('a redirect to another host stops the real public fetch before the second request', async () => {
    const requested = [];
    const request = (o) => {
      const { EventEmitter } = require('node:events');
      const req = new EventEmitter();
      req.setHeader = () => {}; req.abort = () => {}; req.write = () => {};
      req.end = () => {
        requested.push(o.url);
        setTimeout(() => req.emit('redirect', 302, 'GET', 'https://evil.example.com/steal.jpg', {}), 0);
      };
      return req;
    };
    const resolveHost = async () => ({ endpoints: [{ address: '93.184.216.34' }] });
    const store = make(createPublicFetch({ request, resolveHost }));
    await expect(store.download(FULL, 'full')).rejects.toThrow(/\[wp:host\]/);
    expect(requested).toEqual([FULL]);      // the redirect target was never requested
  });

  it('a picture the header says is over 12 MB is not read at all', async () => {
    const { res, state } = streamed([JPEG()], { length: 13 * MB });
    const store = make(async () => res);
    await expect(store.download(FULL, 'full')).rejects.toThrow(/\[wp:too-large\]/);
    expect(state.cancelled).toBe(true);        // the transfer was closed without using a byte
  });

  it('a picture over the cap with no length header is stopped while streaming, not after', async () => {
    const piece = JPEG(MB);
    const many = Array.from({ length: 40 }, () => piece);
    const { res, state } = streamed(many, { length: null });
    const store = make(async () => res);
    await expect(store.download(FULL, 'full')).rejects.toThrow(/\[wp:too-large\]/);
    expect(state.pulled).toBeLessThan(15);
    expect(state.cancelled).toBe(true);
    expect(fs.existsSync(path.join(dir, 'full'))).toBe(false);          // nothing was written
  });

  it('a preview has its own, smaller cap', async () => {
    const { res } = streamed([JPEG(3 * MB)], { length: 3 * MB });
    const store = make(async () => res);
    await expect(store.download(THUMB, 'thumb')).rejects.toThrow(/\[wp:too-large\]/);
  });

  it('refuses an answer that says it is not an image, and one that says image but is not', async () => {
    let r = streamed([Buffer.from('<html>no</html>')], { type: 'text/html' });
    await expect(make(async () => r.res).download(FULL, 'full')).rejects.toThrow(/\[wp:not-image\]/);
    r = streamed([Buffer.from('<html>this is not a picture, honest</html>')], { type: 'image/jpeg' });
    await expect(make(async () => r.res).download(FULL, 'full')).rejects.toThrow(/\[wp:not-image\]/);
  });

  it('says a refusing host and an unreachable host apart', async () => {
    await expect(make(async () => streamed([JPEG()], { status: 404 }).res).download(FULL, 'full')).rejects.toThrow(/\[wp:http\].*404/);
    await expect(make(async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); }).download(FULL, 'full')).rejects.toThrow(/\[wp:unreachable\].*images\.example\.org.*ERR_NAME_NOT_RESOLVED/);
  });

  it('a connection that drops half way is an error and leaves no file', async () => {
    const body = new ReadableStream({
      start(ctrl) { ctrl.enqueue(new Uint8Array(JPEG(500))); },
      pull(ctrl) { ctrl.error(new Error('socket hang up')); },
    });
    const store = make(async () => new Response(body, { headers: { 'content-type': 'image/jpeg' } }));
    await expect(store.download(FULL, 'full')).rejects.toThrow(/\[wp:unreachable\].*socket hang up/);
    expect(fs.existsSync(path.join(dir, 'full'))).toBe(false);
  });

  it('can be cancelled by its ticket', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const body = new ReadableStream({ async pull(ctrl) { await gate; ctrl.enqueue(new Uint8Array(JPEG(100))); } });
    const store = make(async (url, init) => {
      init.signal.addEventListener('abort', () => release());
      return new Response(body, { headers: { 'content-type': 'image/jpeg' } });
    });
    const job = store.download(FULL, 'full', { ticket: 'dl-cancel' });
    await new Promise(r => setTimeout(r, 20));
    expect(store.cancel('dl-cancel')).toEqual({ ok: true, running: true });
    await expect(job).rejects.toThrow(/\[wp:cancelled\]/);
    expect(store.cancel('dl-cancel')).toEqual({ ok: true, running: false });
  });

  it('with no built-in data the list is empty and nothing is downloadable', async () => {
    const store = createWallpaperStore({ dir, fs, path, streamFetch: vi.fn(), builtin: () => loadBuiltin({ fs, path, dir: path.join(dir, 'nothing') }) });
    expect(store.builtinList().entries).toEqual([]);
    await expect(store.download(FULL, 'full')).rejects.toThrow(/not in the wallpaper list/);
  });
});

describe('the cache', () => {
  it('lets go of the least recently used picture first', () => {
    const store = make(null, { cacheMax: 9000 });
    store.save('photo-aaa1', 'full', ab(JPEG(4000)));
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, 'full', 'photo-aaa1.jpg'), old, old);
    store.save('photo-bbb2', 'full', ab(JPEG(4000)));
    store.save('photo-ccc3', 'full', ab(JPEG(4000)));       // 12000 > 9000: the oldest goes
    expect(fs.readdirSync(path.join(dir, 'full')).sort()).toEqual(['photo-bbb2.jpg', 'photo-ccc3.jpg']);
  });

  it('never lets go of the wallpaper on or a favourite, nor of what was just saved; "mine" is not in the cache', () => {
    const store = make(null, { cacheMax: 9000 });
    store.save('my-0123456789ab', 'mine', ab(JPEG(5000)));
    store.save('photo-now1', 'full', ab(JPEG(4000)));
    store.save('photo-fav1', 'full', ab(JPEG(4000)));
    for (const n of ['photo-now1', 'photo-fav1']) { const old = new Date(Date.now() - 90000); fs.utimesSync(path.join(dir, 'full', n + '.jpg'), old, old); }
    store.save('photo-new1', 'full', ab(JPEG(4000)), ['photo-now1', 'photo-fav1']);       // over the cap, but the two oldest are kept
    expect(fs.readdirSync(path.join(dir, 'full')).sort()).toEqual(['photo-fav1.jpg', 'photo-new1.jpg', 'photo-now1.jpg']);
    expect(fs.existsSync(path.join(dir, 'mine', 'my-0123456789ab.jpg'))).toBe(true);
    // The next unprotected one is what goes.
    store.save('photo-new2', 'full', ab(JPEG(4000)), ['photo-now1', 'photo-fav1']);
    expect(fs.existsSync(path.join(dir, 'full', 'photo-new1.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'full', 'photo-now1.jpg'))).toBe(true);
  });

  it('a write that fails leaves no half file', () => {
    const store = make(null);
    const real = fs.renameSync;
    const fsBroken = { ...fs, renameSync: () => { throw new Error('disk full'); } };
    const broken = createWallpaperStore({ dir, fs: fsBroken, path });
    expect(() => broken.save('photo-half1', 'full', ab(JPEG()))).toThrow(/disk full/);
    expect(fs.readdirSync(path.join(dir, 'full'))).toEqual([]);
    expect(real).toBe(fs.renameSync);
    expect(store.read('photo-half1', 'full')).toBeNull();
  });
});
