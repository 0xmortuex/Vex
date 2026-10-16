// Vex version-review relay - Cloudflare Worker SOURCE (Workers KV).
//
// What it is: a tiny drop box for the optional "send my version review"
// feature. A Vex install that has the person's consent POSTs one review per
// version. The ONLY things it ever receives or stores are
//   - a random anonymous install id (made on the person's computer, resettable),
//   - the Vex version reviewed,
//   - 1 to 5 ratings for up to 7 categories,
//   - up to 6 tags from a fixed list,
//   - an optional comment of at most 500 characters,
//   - the DAY it arrived (no time of day).
// No history, no URLs, no accounts, no hardware ids. The address of the sender
// is used for rate limiting only, as a salted hash that changes every hour,
// and is never stored in clear. The code writes no logs.
//
// It is NOT deployed by Vex and Vex ships no address for it. The owner deploys
// it (see README.md) and each person who wants to send pastes the relay URL
// into Settings > Version review.
//
// Endpoints (JSON, under /v1):
//   POST /v1/review     the review body (2 KB at most)       -> stores it, by version
//   GET  /v1/summary    per-version averages per category and counts. NO comments.
//                       Public only when PUBLIC_SUMMARY = "true"; otherwise needs the admin token.
//   GET  /v1/reviews    ?version=X  the reviews WITH comments (never the install id).
//                       Admin bearer token only (the ADMIN_TOKEN secret you set in Cloudflare).

export const CATEGORIES = Object.freeze(['speed', 'stability', 'design', 'features', 'ai', 'privacy', 'games']);
export const CHIPS = Object.freeze(['bug', 'slow', 'crash', 'loved', 'missing', 'smooth']);

export const LIMITS = Object.freeze({
  BODY_MAX: 2048,
  COMMENT_MAX: 500,
  COMMENT_MIN_FOR_EMPTY_RATINGS: 10,
  POST_PER_HOUR: 10,          // per hashed sender address
  REQ_PER_MINUTE: 60,         // per hashed sender address, every endpoint
  REVIEW_TTL_DAYS: 365,
  LIST_MAX: 1000,             // reviews returned by /v1/reviews
  VERSIONS_MAX: 200,
});

const ID_RE = /^[0-9a-f]{32}$/;
const VERSION_RE = /^\d{1,4}(?:\.\d{1,5}){1,3}(?:[-+][0-9A-Za-z.-]{1,20})?$/;
const ALLOWED_KEYS = ['installId', 'version', 'ratings', 'chips', 'comment'];

// ---- validation (exported for the tests) ---------------------------------------

// Removes control and bidi characters and collapses runs of blank lines. Returns
// the cleaned comment (maybe empty).
export function cleanComment(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .trim();
}

// -> { ok: true, value } or { ok: false, error }. Strict: unknown keys, wrong
// types, unknown categories or tags, bad ranges and empty reviews are refused.
export function validateReview(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A review is a JSON object' };
  const extra = Object.keys(body).filter(k => !ALLOWED_KEYS.includes(k));
  if (extra.length) return { ok: false, error: 'Unknown fields: ' + extra.slice(0, 5).join(', ') };
  if (typeof body.installId !== 'string' || !ID_RE.test(body.installId)) return { ok: false, error: 'installId must be 32 hex characters' };
  if (typeof body.version !== 'string' || !VERSION_RE.test(body.version)) return { ok: false, error: 'version is not a Vex version' };
  const r = body.ratings;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: 'ratings must be an object' };
  const ratings = {};
  for (const [k, v] of Object.entries(r)) {
    if (!CATEGORIES.includes(k)) return { ok: false, error: 'Unknown category: ' + k.slice(0, 20) };
    if (!Number.isInteger(v) || v < 1 || v > 5) return { ok: false, error: 'A rating is a whole number from 1 to 5' };
    ratings[k] = v;
  }
  const c = body.chips;
  if (!Array.isArray(c) || c.length > CHIPS.length) return { ok: false, error: 'chips must be a short list' };
  for (const x of c) if (!CHIPS.includes(x)) return { ok: false, error: 'Unknown tag' };
  if (new Set(c).size !== c.length) return { ok: false, error: 'Tags must not repeat' };
  if (typeof body.comment !== 'string') return { ok: false, error: 'comment must be text' };
  if (Array.from(body.comment).length > LIMITS.COMMENT_MAX) return { ok: false, error: 'The comment is longer than ' + LIMITS.COMMENT_MAX + ' characters' };
  const comment = cleanComment(body.comment);
  if (!Object.keys(ratings).length && comment.length < LIMITS.COMMENT_MIN_FOR_EMPTY_RATINGS) return { ok: false, error: 'An empty review is not stored' };
  return { ok: true, value: { installId: body.installId, version: body.version, ratings, chips: c.slice(), comment } };
}

// ---- helpers --------------------------------------------------------------------

function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export async function sha256hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)))));
}

// Compares two secrets without leaking where they differ: both are hashed, then
// the hashes are compared over their whole length.
export async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256hex(a), sha256hex(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || '').split(',').map(s => s.trim()).filter(Boolean);
}
function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '600',
    'vary': 'Origin',
  };
}
function out(status, body, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status, headers });
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(type)) throw httpError(415, 'JSON body required');
  const declared = Number(request.headers.get('content-length'));
  if (declared > LIMITS.BODY_MAX) throw httpError(413, 'Request too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > LIMITS.BODY_MAX) throw httpError(413, 'Request too large');
  try { return JSON.parse(text); } catch { throw httpError(400, 'Invalid JSON'); }
}

// Counts requests per hashed sender per window in KV. The hash includes the
// window, so a sender cannot be followed from one hour to the next, and the raw
// address is never written anywhere.
async function limited(env, ip, kind, max, windowMs, now) {
  const bucket = Math.floor(now / windowMs);
  const h = (await sha256hex('feedback-gate:' + (env.IP_SALT || '') + ':' + kind + ':' + bucket + ':' + ip)).slice(0, 32);
  const key = 'rl:' + kind + ':' + h;
  const n = Number(await env.REVIEWS.get(key)) || 0;
  if (n >= max) return true;
  await env.REVIEWS.put(key, String(n + 1), { expirationTtl: Math.ceil(windowMs / 1000) + 120 });
  return false;
}

const day = (now) => new Date(now).toISOString().slice(0, 10);

// ---- aggregates (per version) -----------------------------------------------------
// { n, cats: { speed: { sum, n } ... } }. Updated on every write; a repeated
// review from the same install id for the same version REPLACES its earlier
// one, so one install counts once per version.

function blankAgg() { return { n: 0, cats: {} }; }
function addTo(agg, review, sign) {
  agg.n += sign;
  for (const [k, v] of Object.entries(review.ratings)) {
    const c = agg.cats[k] || (agg.cats[k] = { sum: 0, n: 0 });
    c.sum += sign * v;
    c.n += sign;
  }
}
export function summaryOf(version, agg) {
  const averages = {};
  for (const k of CATEGORIES) {
    const c = agg.cats[k];
    if (c && c.n > 0) averages[k] = { average: Math.round((c.sum / c.n) * 100) / 100, count: c.n };
  }
  return { version, count: agg.n, averages };
}

export async function storeReview(env, review, now) {
  const rkey = 'r:' + review.version + ':' + review.installId;
  const prevRaw = await env.REVIEWS.get(rkey);
  const akey = 's:' + review.version;
  const aggRaw = await env.REVIEWS.get(akey);
  const agg = aggRaw ? JSON.parse(aggRaw) : blankAgg();
  let replaced = false;
  if (prevRaw) { addTo(agg, JSON.parse(prevRaw), -1); replaced = true; }
  else if (!aggRaw) {
    // A new version: bounded, so the index cannot be grown without limit.
    const known = await env.REVIEWS.list({ prefix: 's:', limit: LIMITS.VERSIONS_MAX + 1 });
    if (known.keys.length > LIMITS.VERSIONS_MAX) throw httpError(409, 'Too many versions are stored');
  }
  addTo(agg, review, 1);
  const stored = { ratings: review.ratings, chips: review.chips, comment: review.comment, day: day(now) };
  await env.REVIEWS.put(rkey, JSON.stringify(stored), { expirationTtl: LIMITS.REVIEW_TTL_DAYS * 86400 });
  await env.REVIEWS.put(akey, JSON.stringify(agg));
  return { replaced };
}

export async function readSummary(env) {
  const list = await env.REVIEWS.list({ prefix: 's:', limit: LIMITS.VERSIONS_MAX });
  const versions = [];
  for (const k of list.keys) {
    const raw = await env.REVIEWS.get(k.name);
    if (raw) versions.push(summaryOf(k.name.slice(2), JSON.parse(raw)));
  }
  return versions;
}

export async function readReviews(env, version) {
  const list = await env.REVIEWS.list({ prefix: 'r:' + version + ':', limit: LIMITS.LIST_MAX });
  const rows = [];
  for (const k of list.keys) {
    const raw = await env.REVIEWS.get(k.name);
    if (!raw) continue;
    const r = JSON.parse(raw);
    // The install id is part of the key, never part of the answer.
    rows.push({ version, day: r.day, ratings: r.ratings, chips: r.chips, comment: r.comment });
  }
  return rows;
}

// ---- the public worker ------------------------------------------------------------

async function isAdmin(request, env) {
  const m = /^Bearer (.{16,200})$/.exec(request.headers.get('Authorization') || '');
  if (!m || !env.ADMIN_TOKEN) return false;
  return sameSecret(m[1], env.ADMIN_TOKEN);
}

export async function handle(request, env, now = Date.now()) {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins(env).includes(origin)) return new Response(null, { status: 403 });
  const o = origin || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: o ? corsHeaders(o) : {} });

  if (!env || !env.REVIEWS) return out(503, { ok: false, error: 'The relay is not set up (KV binding REVIEWS missing)' }, o);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (!['/v1/review', '/v1/summary', '/v1/reviews'].includes(path)) return out(404, { ok: false, error: 'Not found' }, o);

  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await limited(env, ip, 'req', LIMITS.REQ_PER_MINUTE, 60 * 1000, now)) return out(429, { ok: false, error: 'Too many requests, slow down' }, o);

    if (path === '/v1/review') {
      if (request.method !== 'POST') return out(405, { ok: false, error: 'Method not allowed' }, o);
      if (await limited(env, ip, 'post', LIMITS.POST_PER_HOUR, 3600 * 1000, now)) return out(429, { ok: false, error: 'Too many reviews from here, try later' }, o);
      const v = validateReview(await readBody(request));
      if (!v.ok) return out(400, { ok: false, error: v.error }, o);
      const r = await storeReview(env, v.value, now);
      return out(200, { ok: true, replaced: r.replaced }, o);
    }

    if (request.method !== 'GET') return out(405, { ok: false, error: 'Method not allowed' }, o);

    if (path === '/v1/summary') {
      if (String(env.PUBLIC_SUMMARY) !== 'true' && !(await isAdmin(request, env))) return out(401, { ok: false, error: 'Not allowed' }, o);
      return out(200, { ok: true, versions: await readSummary(env) }, o);
    }

    // /v1/reviews: the comments. Admin only; with no token configured it is closed for everyone.
    if (!(await isAdmin(request, env))) return out(401, { ok: false, error: 'Not allowed' }, o);
    const version = url.searchParams.get('version') || '';
    if (!VERSION_RE.test(version)) return out(400, { ok: false, error: 'version=<Vex version> is required' }, o);
    return out(200, { ok: true, reviews: await readReviews(env, version) }, o);
  } catch (err) {
    // Validation texts carry a status; anything else is a generic error with no detail.
    const status = err && err.status ? err.status : 500;
    return out(status, { ok: false, error: err && err.status ? err.message : 'Relay error' }, o);
  }
}

export default { fetch: (request, env) => handle(request, env) };
