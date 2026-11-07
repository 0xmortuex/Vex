// === Lyrics for the song that is playing (lrclib.net) ==============================
//
// OFF unless the person turned "Lyrics" on. Then, when they open the lyrics card for a song that is playing, Vex asks
// lrclib.net (a free, community lyrics database) for that one song:
//
//   GET https://lrclib.net/api/get?artist_name=...&track_name=...&album_name=...&duration=...
//
// WHAT IS SENT: the artist, the title (with video tags such as "(Official Video)" removed), the album and the length in
// seconds that the playing page itself published through the media session, plus the headers of any request: a User-Agent
// that names Vex and its version (lrclib asks every client to identify itself). WHO GETS IT: lrclib.net, and only it. No
// cookie, no account, no page address, no page content, no listening history: the request says nothing about which site
// or tab the song is in. It is made by the main process, shows in "What left this computer" as "Lyrics", is never made for
// a private, Tor or burner tab (the window refuses to ask), and follows no redirect.
//
// WHAT COMES BACK is kept on this computer only, in lyrics-cache.json in the profile folder: at most 500 songs, the least
// recently used one leaves first, a found song stays 30 days, "not found" stays 12 hours (lrclib adds songs over time).
// It is never sent anywhere else, and "Clear lyrics cache" empties it.
//
// lrclib's current API (read 2026-11-07, https://lrclib.net/docs.md; one live call confirmed it):
//   200 -> { id, name, trackName, artistName, albumName, duration, instrumental, hasWordSync, plainLyrics, syncedLyrics, lyricsfile }
//          syncedLyrics is LRC text, plainLyrics plain text, both null for an instrumental.
//   404 -> { message: "Failed to find specified track", name: "TrackNotFound", statusCode: 404 }
//   duration must be 1..3600 (it is left out when it is not) and must match lrclib's record within 2 seconds;
//   429 / 503 carry Retry-After, which is honoured; roughly 90 requests a minute are allowed for an identified client.
//   The documentation says nothing about terms of use or privacy, so none are claimed here.
//
// Requests are de-duplicated (the same song asked twice at once is one request), spaced at least MIN_GAP_MS apart (about
// 40 a minute, under lrclib's limit for an identified client), and stop for as long as lrclib's Retry-After says.

const { parseLrc, cleanPlain } = require('./lyrics-lrc');

const HOST = 'lrclib.net';
const URL_BASE = 'https://lrclib.net/api/get';
const MAX_ENTRIES = 500;
const TTL_FOUND_MS = 30 * 24 * 3600 * 1000;
const TTL_MISSING_MS = 12 * 3600 * 1000;
const MIN_GAP_MS = 1500;
const MAX_RETRY_AFTER_S = 300;

// "Song (Official Video)", "Song [Lyrics]", "Song - Topic" -> "Song". Only trailing tags that name a video or an audio
// upload are removed; "(feat. X)", "(Remastered 2011)" and the like stay, because they are part of the real title.
const TAIL_TAG = /\s*[([]\s*(?:official\s+(?:music\s+)?(?:video|audio|lyric\s+video|visuali[sz]er)|(?:lyric|lyrics|audio|music|hd|hq|4k|visuali[sz]er)(?:\s+video)?|video)\s*[)\]]\s*$/i;
function cleanTitle(title) {
  let t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) { const next = t.replace(TAIL_TAG, '').trim(); if (next === t) break; t = next; }
  return t;
}
function cleanArtist(artist) {
  return String(artist == null ? '' : artist).replace(/\s+/g, ' ').replace(/\s*-\s*topic$/i, '').trim();
}

// -> { artist, track, album, duration|null }; throws for a song that cannot be asked about.
function normalizeQuery(q) {
  if (!q || typeof q !== 'object') throw new Error('Lyrics need an artist and a title');
  const artist = cleanArtist(q.artist).slice(0, 200);
  const track = cleanTitle(q.track).slice(0, 200);
  if (!artist || !track) throw new Error('Lyrics need both an artist and a title, and this player published only one');
  const album = String(q.album == null ? '' : q.album).replace(/\s+/g, ' ').trim().slice(0, 200);
  const d = Number(q.duration);
  const duration = Number.isFinite(d) && Math.round(d) >= 1 && Math.round(d) <= 3600 ? Math.round(d) : null;
  return { artist, track, album, duration };
}

function keyOf(q) { return [q.artist, q.track, q.album, q.duration == null ? '' : q.duration].join('\u0001').toLowerCase(); }

function createLyricsService({ fetch, isOnline = () => true, fs = null, file = '', now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), version = '0', minGapMs = MIN_GAP_MS, schedule = (fn) => setTimeout(fn, 2000) } = {}) {
  if (typeof fetch !== 'function') throw new Error('createLyricsService needs a fetch');
  const cache = new Map();        // key -> { at, ttl, result }   (insertion order = least recently used first)
  const inflight = new Map();     // key -> Promise
  let lastRequestAt = 0;
  let blockedUntil = 0;
  let queue = Promise.resolve();
  let saveTimer = null;

  if (fs && file && fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.v === 1 && Array.isArray(raw.entries)) {
        for (const [k, e] of raw.entries.slice(-MAX_ENTRIES)) {
          if (typeof k === 'string' && e && Number.isFinite(e.at) && Number.isFinite(e.ttl) && e.result && typeof e.result.status === 'string') cache.set(k, e);
        }
      }
    } catch (err) { console.error('[Lyrics] the saved lyrics could not be read, so they are fetched again:', err.message); }
  }

  function save() {
    if (!fs || !file || saveTimer) return;
    saveTimer = schedule(() => {
      saveTimer = null;
      // vex-allow-plain-write: a lyrics cache, fetched again on a miss
      try { fs.writeFileSync(file, JSON.stringify({ v: 1, entries: [...cache.entries()] })); }
      catch (err) { console.error('[Lyrics] the lyrics cache could not be saved:', err.message); }
    });
  }

  function remember(key, result, ttl) {
    cache.delete(key);
    cache.set(key, { at: now(), ttl, result });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    save();
  }

  function fromCache(key) {
    const e = cache.get(key);
    if (!e) return null;
    if (now() - e.at > e.ttl) { cache.delete(key); return null; }
    cache.delete(key); cache.set(key, e);      // most recently used
    return { ...e.result, cached: true };
  }

  async function ask(q) {
    const params = new URLSearchParams({ artist_name: q.artist, track_name: q.track });
    if (q.album) params.set('album_name', q.album);
    if (q.duration != null) params.set('duration', String(q.duration));
    let res;
    try {
      res = await fetch(URL_BASE + '?' + params.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': 'Vex/' + version + ' (https://github.com/0xmortuex/Vex)' },
        redirect: 'error', credentials: 'omit', timeoutMs: 10000, maxBytes: 1024 * 1024,
        egress: { feature: 'Lyrics', kind: 'fetch' },
      });
    } catch (err) {
      if (!isOnline()) return { status: 'offline' };
      return { status: 'error', message: 'Could not reach ' + HOST + ': ' + (err && err.message ? err.message : err) };
    }
    if (res.status === 404) return { result: { status: 'not-found' }, ttl: TTL_MISSING_MS };
    if (res.status === 429 || res.status === 503) {
      const s = Math.min(MAX_RETRY_AFTER_S, Math.max(1, Number(res.headers && res.headers.get && res.headers.get('retry-after')) || 5));
      blockedUntil = now() + s * 1000;
      return { status: 'busy', retryAfterSec: s };
    }
    if (!res.ok) return { status: 'error', message: HOST + ' answered ' + res.status };
    let body;
    try { body = await res.json(); } catch (err) { return { status: 'error', message: HOST + ' sent an answer Vex could not read (' + err.message + ')' }; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 'error', message: HOST + ' sent an answer Vex could not read' };
    const track = { artist: String(body.artistName || q.artist).slice(0, 200), track: String(body.trackName || q.track).slice(0, 200), album: String(body.albumName || '').slice(0, 200) };
    if (body.instrumental === true) return { result: { status: 'instrumental', track }, ttl: TTL_FOUND_MS };
    const synced = typeof body.syncedLyrics === 'string' ? parseLrc(body.syncedLyrics).lines : [];
    const plain = synced.length ? '' : cleanPlain(body.plainLyrics);
    if (!synced.length && !plain) return { result: { status: 'not-found' }, ttl: TTL_MISSING_MS };
    return { result: { status: 'ok', synced: synced.length ? synced : null, plain: plain || null, track }, ttl: TTL_FOUND_MS };
  }

  // One request at a time, MIN_GAP_MS apart.
  function networkAsk(q) {
    const run = async () => {
      if (blockedUntil > now()) return { status: 'busy', retryAfterSec: Math.ceil((blockedUntil - now()) / 1000) };
      const wait = lastRequestAt + minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      return ask(q);
    };
    const p = queue.then(run, run);
    // The next request waits for this one to finish either way; whoever asked for this one gets its error through p.
    queue = p.then(() => undefined, () => undefined);
    return p;
  }

  // -> { status: 'ok'|'not-found'|'instrumental'|'offline'|'busy'|'error', synced?, plain?, track?, message?, cached? }
  async function get(query) {
    const q = normalizeQuery(query);
    const key = keyOf(q);
    const hit = fromCache(key);
    if (hit) return hit;
    if (inflight.has(key)) return inflight.get(key);
    if (!isOnline()) return { status: 'offline' };
    const p = (async () => {
      const out = await networkAsk(q);
      if (out.result) { remember(key, out.result, out.ttl); return { ...out.result }; }
      return out;
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }

  function clear() {
    cache.clear();
    if (fs && file) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); }
      catch (err) { throw new Error('Could not delete the saved lyrics: ' + err.message, { cause: err }); }
    }
    return true;
  }

  return { get, clear, size: () => cache.size };
}

module.exports = { createLyricsService, normalizeQuery, cleanTitle, cleanArtist, keyOf, MAX_ENTRIES, URL_BASE };
