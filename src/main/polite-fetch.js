// === One polite fetch for every watcher (T3-030) =================================
//
// The price watcher, page watcher, GitHub and package feeds, news and release
// radar each ask the same internet for small things on a timer. Asked one by
// one, they can hammer a host, ignore a "slow down", re-download what has not
// changed and spend a metered connection. This wraps ONE fetch implementation
// (the bounded one, which already limits size and time and feeds the egress
// ledger) and makes every caller behave the same:
//
//   - a per-host token bucket: a burst of `burst` requests, then `perMinute`
//     a minute; a caller that would have to wait longer than `maxWaitMs`
//     gets an error saying so instead of a hidden queue;
//   - a 429 or 503 is retried after the server's Retry-After (capped at
//     `maxBackoffMs`) up to `retries` times; the host is then left alone until
//     that time (a cooldown, shared by every caller);
//   - GET answers that carry an ETag or Last-Modified are kept in a small
//     memory cache (LRU, `maxEntries` entries, `maxCacheBytes` in all) and
//     asked again with If-None-Match / If-Modified-Since; a 304 is answered
//     from the cache. Nothing is written to disk;
//   - a User-Agent that says who is asking, unless the caller set one;
//   - jitter, for a public page polled by a timer, so many installs do not
//     all arrive on the hour;
//   - metered connections: a request marked `polite.background` is refused
//     while Windows says the connection costs money.
//
// How a caller uses it (the egress hint is the bounded fetch's own):
//   fetch(url, { egress: { feature, kind }, polite: { background: true, jitterMs: 30000, ttlMs: 60000 } })
//
// createPoliteFetch({ fetch, userAgent, metered, now, sleep, random, log, ... }) so
// tests pass stand-ins; no timer or network is touched here that the caller did
// not hand in.

const DEFAULTS = {
  burst: 4,
  perMinute: 20,
  maxWaitMs: 15000,
  retries: 2,
  maxBackoffMs: 60000,
  defaultBackoffMs: 5000,
  maxEntries: 64,
  maxCacheBytes: 2 * 1024 * 1024,
  maxEntryBytes: 256 * 1024,
  meteredCacheMs: 10 * 60 * 1000,
};

function retryAfterMs(res, now) {
  const raw = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
  if (raw == null || raw === '') return null;
  if (/^\d+$/.test(String(raw).trim())) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function createPoliteFetch(opts = {}) {
  const { fetch, userAgent, metered, log = () => {} } = opts;
  if (typeof fetch !== 'function') throw new Error('createPoliteFetch needs a fetch');
  if (typeof userAgent !== 'string' || !userAgent.trim()) throw new Error('createPoliteFetch needs a User-Agent that says who is asking');
  const cfg = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (opts[k] !== undefined) cfg[k] = opts[k];
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const random = opts.random || Math.random;

  const buckets = new Map();     // host -> { tokens, at }
  const cooldown = new Map();    // host -> ms until which it is left alone
  const cache = new Map();       // key -> { etag, lastModified, status, statusText, headers, body, at, size }  (Map order = LRU)
  let cacheBytes = 0;
  let meteredAt = 0, meteredValue = false, meteredWarned = false;
  const stats = { requests: 0, cacheHits: 0, revalidated: 0, backoffs: 0, waited: 0, refused: 0 };

  const hostOf = (url) => { try { return new URL(String(url)).host.toLowerCase(); } catch { throw new Error('Not a valid URL: ' + String(url).slice(0, 200)); } };

  // Wait for one token of this host, or say how long it would take.
  async function acquire(host) {
    const t0 = now();
    const until = cooldown.get(host) || 0;
    if (until > t0) {
      const wait = until - t0;
      if (wait > cfg.maxWaitMs) { stats.refused++; throw new Error(host + ' asked to be left alone for ' + Math.ceil(wait / 1000) + ' s; not asking again until then'); }
      stats.waited++;
      await sleep(wait);
    }
    for (;;) {
      const t = now();
      const b = buckets.get(host) || { tokens: cfg.burst, at: t };
      b.tokens = Math.min(cfg.burst, b.tokens + ((t - b.at) / 60000) * cfg.perMinute);
      b.at = t;
      if (b.tokens >= 1) { b.tokens -= 1; buckets.set(host, b); return; }
      const wait = Math.ceil(((1 - b.tokens) / cfg.perMinute) * 60000);
      buckets.set(host, b);
      if (wait > cfg.maxWaitMs) { stats.refused++; throw new Error('Too many requests to ' + host + ' just now; it would take ' + Math.ceil(wait / 1000) + ' s to be polite. Try again later'); }
      stats.waited++;
      await sleep(wait);
    }
  }

  async function isMetered() {
    if (typeof metered !== 'function') return false;
    const t = now();
    if (t - meteredAt < cfg.meteredCacheMs) return meteredValue;
    try { meteredValue = !!(await metered()); }
    catch (err) {
      // Windows could not say. That is not "metered": say so once and carry on as unmetered.
      meteredValue = false;
      if (!meteredWarned) { meteredWarned = true; log('[PoliteFetch] could not tell whether the connection is metered: ' + err.message); }
    }
    meteredAt = t;
    return meteredValue;
  }

  function remember(key, res, body) {
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    if (!etag && !lastModified && !(res.__ttl > 0)) return;
    if (body.byteLength > cfg.maxEntryBytes) return;
    const old = cache.get(key);
    if (old) { cacheBytes -= old.size; cache.delete(key); }
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    cache.set(key, { etag, lastModified, status: res.status, statusText: res.statusText, headers, body, at: now(), size: body.byteLength });
    cacheBytes += body.byteLength;
    while (cache.size > cfg.maxEntries || cacheBytes > cfg.maxCacheBytes) {
      const [oldest, val] = cache.entries().next().value;
      cache.delete(oldest);
      cacheBytes -= val.size;
    }
  }

  function fromCache(entry, how, url) {
    cache.delete(entry.key); cache.set(entry.key, entry);   // most recently used
    const headers = new Headers(entry.headers);
    headers.set('x-vex-cache', how);
    headers.delete('content-encoding'); headers.delete('content-length');
    const res = new Response(entry.body, { status: entry.status, statusText: entry.statusText, headers });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }

  async function politeFetch(url, init = {}) {
    const href = String(url);
    const host = hostOf(href);
    const polite = init.polite && typeof init.polite === 'object' ? init.polite : {};
    const rest = { ...init };
    delete rest.polite;
    const method = String(rest.method || 'GET').toUpperCase();

    if (polite.background && await isMetered()) { stats.refused++; throw new Error('Skipped: the connection is metered, so background checks wait'); }
    if (polite.jitterMs > 0) await sleep(Math.floor(random() * polite.jitterMs));

    const headers = new Headers(rest.headers || {});
    if (!headers.has('user-agent')) headers.set('User-Agent', userAgent);

    const key = method === 'GET' ? href : null;
    let entry = key ? cache.get(key) : null;
    if (entry) entry.key = key;
    if (entry && polite.ttlMs > 0 && now() - entry.at < polite.ttlMs) { stats.cacheHits++; return fromCache(entry, 'fresh', href); }
    if (entry) {
      if (entry.etag && !headers.has('if-none-match')) headers.set('If-None-Match', entry.etag);
      if (entry.lastModified && !headers.has('if-modified-since')) headers.set('If-Modified-Since', entry.lastModified);
    }

    let res;
    for (let attempt = 0; ; attempt++) {
      await acquire(host);
      stats.requests++;
      res = await fetch(href, { ...rest, headers });
      if (res.status !== 429 && res.status !== 503) break;
      const t = now();
      const asked = retryAfterMs(res, t);
      const wait = Math.min(asked == null ? cfg.defaultBackoffMs * (attempt + 1) : asked, cfg.maxBackoffMs);
      cooldown.set(host, t + wait);
      stats.backoffs++;
      if (attempt >= cfg.retries) return res;      // the caller sees the 429/503; the host is on cooldown
      if (wait > cfg.maxWaitMs) return res;        // too long to hold this caller: they see the answer, the cooldown stays
      await sleep(wait);
    }

    if (res.status === 304 && entry) { stats.revalidated++; entry.at = now(); return fromCache(entry, 'revalidated', href); }
    if (key && res.status === 200 && (polite.ttlMs > 0 || res.headers.get('etag') || res.headers.get('last-modified'))) {
      const body = new Uint8Array(await res.clone().arrayBuffer());
      res.__ttl = polite.ttlMs;
      remember(key, res, body);
    }
    return res;
  }

  politeFetch.stats = () => ({ ...stats, cacheEntries: cache.size, cacheBytes, hostsOnCooldown: [...cooldown].filter(([, t]) => t > now()).map(([h]) => h) });
  politeFetch.clear = () => { cache.clear(); cacheBytes = 0; buckets.clear(); cooldown.clear(); };
  return politeFetch;
}

module.exports = { createPoliteFetch, DEFAULTS, retryAfterMs };
