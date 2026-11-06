// The lyrics client (src/main/lyrics.js) against a LOCAL fake lrclib server: real HTTP, no live network. The fake answers the
// shapes lrclib documents (200 record, 404 TrackNotFound, 429 with Retry-After, instrumental) and some it should not (a redirect,
// garbage, a server error).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';

const { createLyricsService, normalizeQuery, cleanTitle, cleanArtist, MAX_ENTRIES } = require('../../src/main/lyrics.js');

let server; let base; let seen; let handler;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });
    handler(url, req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { seen = []; handler = (url, req, res) => json(res, 200, RECORD()); });

const json = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const RECORD = (over = {}) => ({ id: 1, name: 'Get Lucky', trackName: 'Get Lucky', artistName: 'Daft Punk', albumName: 'Random Access Memories', duration: 367, instrumental: false, hasWordSync: false,
  plainLyrics: 'Like the legend\nAll ends', syncedLyrics: '[00:31.48] Like the legend\n[00:35.40] All ends', lyricsfile: 'version: 1', ...over });

// The service's fetch: the real one, with the lrclib address pointed at the fake server. It records the options the service passed.
let options;
const realFetch = (url, init) => { options.push(init); return fetch(String(url).replace('https://lrclib.net', base), init); };
function make(extra = {}) {
  options = [];
  let t = 1_000_000;
  const sleeps = [];
  const svc = createLyricsService({ fetch: realFetch, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, version: '9.9', minGapMs: 1500, ...extra });
  return { svc, sleeps, advance: (ms) => { t += ms; } };
}
const SONG = { artist: 'Daft Punk', track: 'Get Lucky', album: 'Random Access Memories', duration: 369 };

describe('what is asked, and what is sent', () => {
  it('sends the artist, title, album and duration to lrclib /api/get, and nothing else', async () => {
    const { svc } = make();
    await svc.get(SONG);
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe('/api/get');
    expect(seen[0].query).toEqual({ artist_name: 'Daft Punk', track_name: 'Get Lucky', album_name: 'Random Access Memories', duration: '369' });
  });
  it('identifies Vex, sends no cookie or credentials, follows no redirect, and lands in the ledger as "Lyrics"', async () => {
    const { svc } = make();
    await svc.get(SONG);
    expect(seen[0].headers['user-agent']).toBe('Vex/9.9 (https://github.com/0xmortuex/Vex)');
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(options[0]).toMatchObject({ credentials: 'omit', redirect: 'error', egress: { feature: 'Lyrics', kind: 'fetch' } });
    expect(options[0].timeoutMs).toBeLessThanOrEqual(15000);
    expect(options[0].maxBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
  it('leaves out the album and a duration lrclib would refuse (it accepts 1..3600)', async () => {
    const { svc } = make();
    await svc.get({ artist: 'A', track: 'B', album: '', duration: 7200 });
    expect(seen[0].query).toEqual({ artist_name: 'A', track_name: 'B' });
    await svc.get({ artist: 'A', track: 'C', duration: 0 });
    expect(seen[1].query).toEqual({ artist_name: 'A', track_name: 'C' });
    await svc.get({ artist: 'A', track: 'D', duration: 200.6 });
    expect(seen[2].query.duration).toBe('201');
  });
  it('removes video tags and "- Topic" before asking, and keeps real title parts', async () => {
    expect(cleanTitle('Get Lucky (Official Video)')).toBe('Get Lucky');
    expect(cleanTitle('Get Lucky [Official Music Video]')).toBe('Get Lucky');
    expect(cleanTitle('Get Lucky (Lyrics) (HD)')).toBe('Get Lucky');
    expect(cleanTitle('Song (feat. Pharrell Williams)')).toBe('Song (feat. Pharrell Williams)');
    expect(cleanTitle('Song (Remastered 2011)')).toBe('Song (Remastered 2011)');
    expect(cleanTitle('(Official) Song')).toBe('(Official) Song');
    expect(cleanArtist('Daft Punk - Topic')).toBe('Daft Punk');
    const { svc } = make();
    await svc.get({ artist: 'Daft Punk - Topic', track: 'Get Lucky (Official Audio)' });
    expect(seen[0].query.artist_name).toBe('Daft Punk');
    expect(seen[0].query.track_name).toBe('Get Lucky');
  });
  it('refuses a song with no artist or no title without asking', async () => {
    const { svc } = make();
    await expect(svc.get({ artist: '', track: 'x' })).rejects.toThrow(/artist and a title/);
    await expect(svc.get({ artist: 'x', track: '  ' })).rejects.toThrow(/artist and a title/);
    await expect(svc.get(null)).rejects.toThrow();
    expect(seen).toEqual([]);
  });
  it('caps what it sends', () => {
    const q = normalizeQuery({ artist: 'a'.repeat(900), track: 't'.repeat(900), album: 'b'.repeat(900), duration: 100 });
    expect(q.artist.length).toBe(200); expect(q.track.length).toBe(200); expect(q.album.length).toBe(200);
  });
});

describe('what comes back', () => {
  it('synced lyrics are parsed into [seconds, text] lines', async () => {
    const { svc } = make();
    const r = await svc.get(SONG);
    expect(r.status).toBe('ok');
    expect(r.synced).toEqual([[31.48, 'Like the legend'], [35.4, 'All ends']]);
    expect(r.plain).toBeNull();
    expect(r.track).toEqual({ artist: 'Daft Punk', track: 'Get Lucky', album: 'Random Access Memories' });
  });
  it('plain lyrics when there are no synced ones', async () => {
    handler = (u, q, res) => json(res, 200, RECORD({ syncedLyrics: null }));
    const r = await make().svc.get(SONG);
    expect(r).toMatchObject({ status: 'ok', synced: null, plain: 'Like the legend\nAll ends' });
  });
  it('plain lyrics when the synced text has no usable stamps', async () => {
    handler = (u, q, res) => json(res, 200, RECORD({ syncedLyrics: 'no stamps' }));
    expect((await make().svc.get(SONG))).toMatchObject({ status: 'ok', synced: null, plain: 'Like the legend\nAll ends' });
  });
  it('instrumental', async () => {
    handler = (u, q, res) => json(res, 200, RECORD({ instrumental: true, plainLyrics: null, syncedLyrics: null }));
    const r = await make().svc.get(SONG);
    expect(r.status).toBe('instrumental');
    expect(r.synced).toBeUndefined();
  });
  it('not found (404 TrackNotFound)', async () => {
    handler = (u, q, res) => json(res, 404, { message: 'Failed to find specified track', name: 'TrackNotFound', statusCode: 404 });
    expect((await make().svc.get(SONG)).status).toBe('not-found');
  });
  it('a record with neither kind of lyrics is "not found", not an empty card', async () => {
    handler = (u, q, res) => json(res, 200, RECORD({ syncedLyrics: null, plainLyrics: '   ' }));
    expect((await make().svc.get(SONG)).status).toBe('not-found');
  });
  it('a server error is an error with the status, and is not remembered', async () => {
    handler = (u, q, res) => json(res, 500, { name: 'UnknownError' });
    const { svc } = make();
    const r = await svc.get(SONG);
    expect(r).toMatchObject({ status: 'error' });
    expect(r.message).toMatch(/500/);
    handler = (u, q, res) => json(res, 200, RECORD());
    expect((await svc.get(SONG)).status).toBe('ok');
  });
  it('garbage is an error, not a crash', async () => {
    handler = (u, q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('<html>not json'); };
    const r = await make().svc.get(SONG);
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/could not read/);
    handler = (u, q, res) => json(res, 200, [1, 2]);
    expect((await make().svc.get({ ...SONG, track: 'other' })).status).toBe('error');
  });
  it('a redirect is refused, not followed', async () => {
    handler = (u, q, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }); res.end(); };
    const r = await make().svc.get(SONG);
    expect(r.status).toBe('error');
    expect(seen).toHaveLength(1);
  });
  it('an unreachable server is an error that names the host; when the computer is offline it says offline', async () => {
    const dead = (url, init) => fetch('http://127.0.0.1:1/api/get', init);
    let online = true;
    const svc = createLyricsService({ fetch: dead, isOnline: () => online, sleep: async () => {} });
    const r = await svc.get(SONG);
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/lrclib\.net/);
    online = false;
    expect(await svc.get({ ...SONG, track: 'again' })).toEqual({ status: 'offline' });
  });
  it('offline asks nothing at all', async () => {
    const { svc } = make({ isOnline: () => false });
    expect(await svc.get(SONG)).toEqual({ status: 'offline' });
    expect(seen).toEqual([]);
  });
});

describe('cache, de-duplication and rate limit', () => {
  it('asks once for the same song, then answers from the cache', async () => {
    const { svc } = make();
    const a = await svc.get(SONG);
    const b = await svc.get({ ...SONG, artist: 'DAFT PUNK' });
    expect(seen).toHaveLength(1);
    expect(a.cached).toBeUndefined();
    expect(b.cached).toBe(true);
    expect(b.synced).toEqual(a.synced);
  });
  it('two askers at once share one request', async () => {
    handler = (u, q, res) => setTimeout(() => json(res, 200, RECORD()), 50);
    const { svc } = make();
    const [a, b, c] = await Promise.all([svc.get(SONG), svc.get(SONG), svc.get(SONG)]);
    expect(seen).toHaveLength(1);
    expect([a.status, b.status, c.status]).toEqual(['ok', 'ok', 'ok']);
  });
  it('remembers "not found" for 12 hours, then asks again', async () => {
    handler = (u, q, res) => json(res, 404, { name: 'TrackNotFound' });
    const { svc, advance } = make();
    await svc.get(SONG); await svc.get(SONG);
    expect(seen).toHaveLength(1);
    advance(13 * 3600 * 1000);
    await svc.get(SONG);
    expect(seen).toHaveLength(2);
  });
  it('remembers a found song for 30 days', async () => {
    const { svc, advance } = make();
    await svc.get(SONG);
    advance(29 * 24 * 3600 * 1000); await svc.get(SONG);
    expect(seen).toHaveLength(1);
    advance(2 * 24 * 3600 * 1000); await svc.get(SONG);
    expect(seen).toHaveLength(2);
  });
  it('keeps at most 500 songs, the least recently used leaving first', async () => {
    const { svc } = make({ minGapMs: 0 });
    expect(MAX_ENTRIES).toBe(500);
    for (let i = 0; i < 503; i++) await svc.get({ artist: 'A', track: 'T' + i, duration: 100 });
    expect(svc.size()).toBe(500);
    seen.length = 0;
    await svc.get({ artist: 'A', track: 'T502', duration: 100 });
    expect(seen).toHaveLength(0);          // the newest is still there
    await svc.get({ artist: 'A', track: 'T0', duration: 100 });
    expect(seen).toHaveLength(1);          // the oldest left
  }, 30000);
  it('a song looked at again counts as recently used', async () => {
    const { svc } = make({ minGapMs: 0 });
    for (let i = 0; i < 500; i++) await svc.get({ artist: 'A', track: 'T' + i, duration: 100 });
    await svc.get({ artist: 'A', track: 'T0', duration: 100 });     // refreshed
    await svc.get({ artist: 'A', track: 'NEW', duration: 100 });     // pushes the least recent out: T1, not T0
    seen.length = 0;
    await svc.get({ artist: 'A', track: 'T0', duration: 100 });
    expect(seen).toHaveLength(0);
    await svc.get({ artist: 'A', track: 'T1', duration: 100 });
    expect(seen).toHaveLength(1);
  }, 30000);
  it('spaces requests at least 1.5 seconds apart', async () => {
    const { svc, sleeps } = make();
    await svc.get({ artist: 'A', track: 'one' });
    await svc.get({ artist: 'A', track: 'two' });
    await svc.get({ artist: 'A', track: 'three' });
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((ms) => ms > 0 && ms <= 1500)).toBe(true);
  });
  it('stops for as long as lrclib says (429 Retry-After), and says so', async () => {
    handler = (u, q, res) => json(res, 429, { name: 'RateLimitExceeded' }, { 'retry-after': '30' });
    const { svc, advance } = make();
    const a = await svc.get(SONG);
    expect(a).toEqual({ status: 'busy', retryAfterSec: 30 });
    const b = await svc.get({ ...SONG, track: 'other' });
    expect(b.status).toBe('busy');
    expect(b.retryAfterSec).toBeLessThanOrEqual(30);
    expect(seen).toHaveLength(1);               // the second one was not even sent
    advance(31_000);
    handler = (u, q, res) => json(res, 200, RECORD());
    expect((await svc.get({ ...SONG, track: 'other' })).status).toBe('ok');
  });
  it('treats 503 like 429, and caps an absurd Retry-After', async () => {
    handler = (u, q, res) => json(res, 503, { name: 'ServerOverloaded' }, { 'retry-after': '999999' });
    const r = await make().svc.get(SONG);
    expect(r.status).toBe('busy');
    expect(r.retryAfterSec).toBe(300);
  });
  it('a busy answer is not cached', async () => {
    handler = (u, q, res) => json(res, 429, {}, { 'retry-after': '1' });
    const { svc, advance } = make();
    await svc.get(SONG);
    advance(5000);
    handler = (u, q, res) => json(res, 200, RECORD());
    expect((await svc.get(SONG)).status).toBe('ok');
  });
});

describe('the cache file', () => {
  const memFs = () => { const files = new Map(); return { files, existsSync: (f) => files.has(f), readFileSync: (f) => files.get(f), writeFileSync: (f, d) => files.set(f, d), unlinkSync: (f) => files.delete(f) }; };
  it('is written after a found song and read back by the next run, which then asks nothing', async () => {
    const fsx = memFs();
    const a = make({ fs: fsx, file: 'l.json', schedule: (fn) => { fn(); } });
    await a.svc.get(SONG);
    expect(fsx.files.has('l.json')).toBe(true);
    seen.length = 0;
    const b = make({ fs: fsx, file: 'l.json', schedule: (fn) => { fn(); } });
    const r = await b.svc.get(SONG);
    expect(r.cached).toBe(true);
    expect(r.synced).toHaveLength(2);
    expect(seen).toHaveLength(0);
  });
  it('holds nothing but lyrics: no page address, tab or account', async () => {
    const fsx = memFs();
    const a = make({ fs: fsx, file: 'l.json', schedule: (fn) => { fn(); } });
    await a.svc.get(SONG);
    const text = fsx.files.get('l.json');
    expect(text).not.toMatch(/http|cookie|tab|account/i);
  });
  it('a damaged file is reported and ignored', async () => {
    const fsx = memFs(); fsx.files.set('l.json', '{broken');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { svc } = make({ fs: fsx, file: 'l.json' });
    expect(svc.size()).toBe(0);
    expect(err).toHaveBeenCalled(); err.mockRestore();
  });
  it('a failed save is reported, and the song is still answered', async () => {
    const fsx = memFs(); fsx.writeFileSync = () => { throw new Error('disk full'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { svc } = make({ fs: fsx, file: 'l.json', schedule: (fn) => { fn(); } });
    expect((await svc.get(SONG)).status).toBe('ok');
    expect(err).toHaveBeenCalled(); err.mockRestore();
  });
  it('clear() forgets everything and deletes the file', async () => {
    const fsx = memFs();
    const { svc } = make({ fs: fsx, file: 'l.json', schedule: (fn) => { fn(); } });
    await svc.get(SONG);
    svc.clear();
    expect(svc.size()).toBe(0);
    expect(fsx.files.has('l.json')).toBe(false);
  });
});
