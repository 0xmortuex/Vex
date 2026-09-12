// === Recall index — the full-text engine behind the Recall panel ===
//
// Pure JavaScript, no Electron: main.js owns loading/persisting the JSON log,
// this module owns tokenizing, ranking and snippeting. Keeping it separate is
// what makes the search behaviour unit-testable (tests/renderer/recallIndex.test.js).
//
// Storage shape (unchanged from the original flat log, so existing recall.json
// files load as-is):
//   [{ url, title, text, at, first?, visits? }, ...]   newest first
//
// In memory we additionally build an inverted index: stem -> packed postings.
// Each posting packs a record id and that record's term frequency into one
// number (id * 256 + min(tf, 255)), which gives df, tf and the candidate set
// without a second per-document map. Searching a selective term then touches a
// handful of records instead of scanning every page's text, which is what keeps
// the panel responsive once the index holds thousands of pages.

'use strict';

const DEFAULTS = {
  maxRecords: 3000,
  maxTextChars: 16000,
  // Hard ceiling on stored page text. The record count alone is not a bound:
  // 3000 long articles would be a 48 MB file to parse at every launch.
  maxBytes: 24 * 1024 * 1024,
};

const TF_BITS = 256;
const MAX_TF = TF_BITS - 1;
const SPLIT = /[^\p{L}\p{N}_]+/u;

/** Lowercase + strip diacritics so "resume" finds "résumé". */
function normalize(text) {
  return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const VOWELS = 'aeiouy';

/**
 * Deliberately conservative suffix stripping — enough that "browsers",
 * "throttling" and "indexed" collapse onto the same key as their base word,
 * without the over-stemming that makes a full Porter implementation return
 * surprising matches in a personal history search.
 */
function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.length > 4 && /(?:ch|sh|ss|x|z|o)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && /[^su]s$/.test(w)) w = w.slice(0, -1);
  // "-ing"/"-ed" only come off when what is left is still a pronounceable word,
  // so "string" and "thing" survive while "throttling" and "indexed" collapse.
  if (w.length > 5 && w.endsWith('ing')) {
    const base = w.slice(0, -3);
    if (base.length >= 3 && hasVowel(base)) w = dedupeTail(base);
  } else if (w.length > 4 && w.endsWith('ed')) {
    const base = w.slice(0, -2);
    if (base.length >= 3 && hasVowel(base)) w = dedupeTail(base);
  }
  // Final silent -e, so "throttle"/"throttles"/"throttling" all land on "throttl".
  if (w.length > 4 && w.endsWith('e') && !VOWELS.includes(w[w.length - 2])) w = w.slice(0, -1);
  return w;
}

function hasVowel(word) {
  for (const c of word) if (VOWELS.includes(c)) return true;
  return false;
}

/** "throttl" from "throttling" keeps its double l; "runn" should become "run". */
function dedupeTail(base) {
  const n = base.length;
  if (n > 3 && base[n - 1] === base[n - 2] && !'lsz'.includes(base[n - 1])) return base.slice(0, -1);
  return base;
}

/** Split text into stemmed tokens. */
function tokenize(text) {
  const out = [];
  if (!text) return out;
  for (const raw of normalize(text).split(SPLIT)) {
    if (!raw) continue;
    if (raw.length > 40) continue; // base64 blobs and hashes are noise, not words
    out.push(stem(raw));
  }
  return out;
}

/**
 * Parse a user query into structured pieces.
 *   deep packet        two required terms
 *   "deep packet"      required adjacent phrase
 *   -advert            must NOT appear
 *   site:mdn.io        restricted to a host (suffix match)
 *   before:/after:     ISO dates or "7d" / "24h" style offsets
 * The trailing bare word is marked `prefix` so typing "thrott" already matches
 * "throttling" — but only the last one, so "thr pac" doesn't explode.
 */
function parseQuery(query, { prefixLastTerm = true } = {}) {
  const text = String(query == null ? '' : query);
  const terms = [];
  const phrases = [];
  const excludes = [];
  let site = null, since = 0, until = 0;
  const re = /"([^"]*)"|(\S+)/g;
  const bare = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[1] != null) { const p = normalize(m[1]).trim(); if (p) phrases.push(p); continue; }
    const tok = m[2];
    const field = /^(site|before|after):(.*)$/i.exec(tok);
    if (field) {
      const value = field[2].trim();
      if (!value) continue;
      const key = field[1].toLowerCase();
      if (key === 'site') site = normalize(value).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      else {
        const at = parseWhen(value);
        if (at) { if (key === 'after') since = at; else until = at; }
      }
      continue;
    }
    if (tok.length > 1 && tok[0] === '-') { for (const s of tokenize(tok.slice(1))) excludes.push(s); continue; }
    bare.push(tok);
  }
  // Phrases still have to narrow the candidate set, so their words are terms too.
  for (const phrase of phrases) for (const s of tokenize(phrase)) terms.push({ stem: s, prefix: false, raw: phrase });
  bare.forEach((tok, i) => {
    const isLast = prefixLastTerm && i === bare.length - 1 && !/\s$/.test(text);
    const words = normalize(tok).split(SPLIT).filter(Boolean);
    words.forEach((w, j) => {
      terms.push({ stem: stem(w), prefix: isLast && j === words.length - 1 && w.length >= 2, raw: w });
    });
  });
  return { terms, phrases, excludes, site, since, until, raw: text.trim() };
}

function parseWhen(value) {
  const rel = /^(\d+)\s*([hdwmy])$/i.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const ms = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 }[rel[2].toLowerCase()];
    return Date.now() - n * ms;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** Longest common host suffix test: "site:wikipedia.org" matches en.wikipedia.org. */
function hostMatches(host, filter) {
  if (!filter) return true;
  return host === filter || host.endsWith('.' + filter);
}

class RecallIndex {
  constructor(records = [], options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.records = [];             // newest first
    this._byUrl = new Map();       // url -> record
    this._hostOf = new Map();      // record -> host
    this._idOf = new Map();        // record -> id (only once indexed)
    this._meta = new Map();        // id -> { rec, len, titleStems: Set, host, norm: string|null }
    this._post = new Map();        // stem -> number[] packed postings, ascending by id
    this._keys = null;             // cached stem list for prefix expansion
    this._nextId = 1;
    this._bytes = 0;
    // Tokenizing the whole corpus costs a few hundred milliseconds on a full
    // index. That must not land on the background "a page finished loading"
    // path, so postings are built on first *search* instead — by which point
    // the user has deliberately opened Recall.
    this._built = false;
    const clean = Array.isArray(records) ? records : [];
    for (const raw of clean) this._add(raw, false);
    this.prune();
  }

  get size() { return this.records.length; }

  /** Bytes of page text held (a close proxy for the on-disk JSON size). */
  get bytes() { return this._bytes; }

  _add(raw, toFront = true) {
    if (!raw || typeof raw.url !== 'string' || !raw.url) return null;
    const text = String(raw.text == null ? '' : raw.text).slice(0, this.options.maxTextChars);
    const title = String(raw.title == null ? '' : raw.title).slice(0, 300);
    const at = Number.isFinite(raw.at) ? raw.at : Date.now();
    const prior = this._byUrl.get(raw.url);
    const first = Number.isFinite(raw.first) ? raw.first : (prior ? prior.first : at);
    const visits = Number.isFinite(raw.visits) ? raw.visits : (prior ? (prior.visits || 1) + 1 : 1);
    if (prior) this._drop(prior);

    const rec = { url: raw.url, title, text, at, first, visits };
    this._byUrl.set(rec.url, rec);
    this._hostOf.set(rec, hostOf(rec.url));
    this._bytes += text.length + title.length;
    if (toFront) this.records.unshift(rec); else this.records.push(rec);
    if (this._built) this._index(rec);
    return rec;
  }

  _drop(rec) {
    const at = this.records.indexOf(rec);
    if (at >= 0) this.records.splice(at, 1);
    if (this._byUrl.get(rec.url) === rec) this._byUrl.delete(rec.url);
    this._bytes -= rec.text.length + rec.title.length;
    this._hostOf.delete(rec);
    const id = this._idOf.get(rec);
    if (id !== undefined) { this._unindex(id); this._idOf.delete(rec); }
    return true;
  }

  _index(rec) {
    const id = this._nextId++;
    const bodyTokens = tokenize(rec.text);
    const counts = new Map();
    for (const t of bodyTokens) counts.set(t, (counts.get(t) || 0) + 1);
    const host = this._hostOf.get(rec) || hostOf(rec.url);
    const titleStems = new Set(tokenize(rec.title + ' ' + host.replace(/[.]/g, ' ')));
    // Title/host words that never appear in the body still have to be findable.
    for (const t of titleStems) if (!counts.has(t)) counts.set(t, 0);
    for (const [t, n] of counts) {
      let list = this._post.get(t);
      if (!list) { list = []; this._post.set(t, list); this._keys = null; }
      list.push(id * TF_BITS + Math.min(n, MAX_TF));
    }
    this._meta.set(id, { rec, len: bodyTokens.length, titleStems, host, norm: null });
    this._idOf.set(rec, id);
    return id;
  }

  _unindex(id) {
    const meta = this._meta.get(id);
    if (!meta) return false;
    const stems = new Set(tokenize(meta.rec.text));
    for (const t of meta.titleStems) stems.add(t);
    for (const t of stems) {
      const list = this._post.get(t);
      if (!list) continue;
      const at = binarySearch(list, id);
      if (at >= 0) list.splice(at, 1);
      if (!list.length) { this._post.delete(t); this._keys = null; }
    }
    this._meta.delete(id);
    return true;
  }

  /** Build the inverted index if it has not been built yet. Idempotent. */
  _ensure() {
    if (this._built) return;
    this._built = true;
    // Oldest first, so posting ids rise with recency and stay sorted on append.
    for (let i = this.records.length - 1; i >= 0; i--) this._index(this.records[i]);
  }

  /** Add or refresh a page. Returns the stored record, or null if unusable. */
  put(entry) {
    const rec = this._add(entry, true);
    if (rec) this.prune();
    return rec;
  }

  /** Drop the oldest pages until both the count and byte budgets are met. */
  prune() {
    let dropped = 0;
    while (this.records.length > this.options.maxRecords ||
           (this._bytes > this.options.maxBytes && this.records.length > 1)) {
      this._drop(this.records[this.records.length - 1]);
      dropped++;
    }
    return dropped;
  }

  /** Forget by exact url or by host (host also matches its subdomains). */
  forget({ url, host } = {}) {
    const wanted = host ? normalize(host).replace(/^www\./, '') : null;
    const doomed = this.records.filter(rec =>
      (url && rec.url === url) || (wanted && hostMatches(this._hostOf.get(rec) || hostOf(rec.url), wanted)));
    for (const rec of doomed) this._drop(rec);
    return doomed.length;
  }

  clear() {
    this.records = [];
    this._byUrl.clear();
    this._hostOf.clear();
    this._idOf.clear();
    this._meta.clear();
    this._post.clear();
    this._keys = null;
    this._bytes = 0;
  }

  stats() {
    const hosts = new Map();
    let oldest = 0, newest = 0;
    for (const rec of this.records) {
      const host = this._hostOf.get(rec) || hostOf(rec.url);
      hosts.set(host, (hosts.get(host) || 0) + 1);
      if (!oldest || rec.at < oldest) oldest = rec.at;
      if (rec.at > newest) newest = rec.at;
    }
    return {
      pages: this.records.length,
      bytes: this._bytes,
      // null, not 0, until the inverted index has actually been built.
      terms: this._built ? this._post.size : null,
      oldest, newest,
      maxPages: this.options.maxRecords,
      maxBytes: this.options.maxBytes,
      hosts: [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([host, count]) => ({ host, count })),
    };
  }

  toJSON() { return this.records; }

  /** Every stem currently indexed — cached, invalidated whenever postings change. */
  _stems() {
    if (!this._keys) this._keys = [...this._post.keys()];
    return this._keys;
  }

  /** id -> tf for one query term, unioning prefix expansions. */
  _postingsFor(term) {
    const found = new Map();
    const take = (list) => {
      for (const packed of list) {
        const id = Math.floor(packed / TF_BITS);
        const tf = packed % TF_BITS;
        const cur = found.get(id);
        if (cur === undefined || tf > cur) found.set(id, tf);
      }
    };
    const exact = this._post.get(term.stem);
    if (exact) take(exact);
    // Only widen to prefixes when the exact stem is missing or barely used —
    // otherwise "search" would drag in every "searchable"/"searching" variant
    // and flatten the ranking of the word the user actually typed.
    if (term.prefix && (!exact || exact.length < 5)) {
      for (const key of this._stems()) {
        if (key.length > term.stem.length && key.startsWith(term.stem)) take(this._post.get(key));
      }
    }
    return found;
  }

  /**
   * Rank pages against a query.
   * opts: { limit, offset, sort: relevance|newest|oldest, since, until, site, snippet }
   * Returns { total, hits, terms, took }.
   */
  search(query, opts = {}) {
    const started = Date.now();
    const limit = Math.max(1, Math.min(200, opts.limit || 40));
    const offset = Math.max(0, opts.offset || 0);
    const parsed = typeof query === 'string' ? parseQuery(query, opts) : query;
    const empty = { total: 0, hits: [], terms: [], took: 0 };
    if (!parsed || (!parsed.terms.length && !parsed.site)) return empty;
    this._ensure();

    const site = opts.site ? normalize(opts.site).replace(/^www\./, '') : parsed.site;
    const since = Math.max(parsed.since || 0, opts.since || 0);
    const until = opts.until || parsed.until || 0;

    // Candidates: intersect the rarest term first so the working set collapses fast.
    let candidates = null;
    const perTerm = [];
    for (const term of parsed.terms) {
      const found = this._postingsFor(term);
      if (!found.size) return { ...empty, terms: parsed.terms.map(t => t.raw) };
      perTerm.push({ term, found });
    }
    perTerm.sort((a, b) => a.found.size - b.found.size);
    for (const { found } of perTerm) {
      if (candidates === null) { candidates = new Set(found.keys()); continue; }
      for (const id of candidates) if (!found.has(id)) candidates.delete(id);
      if (!candidates.size) break;
    }
    if (candidates === null) candidates = new Set(this._meta.keys()); // site:-only query
    if (!candidates.size) return { ...empty, terms: parsed.terms.map(t => t.raw) };

    for (const ex of parsed.excludes) {
      const list = this._post.get(ex);
      if (!list) continue;
      for (const packed of list) candidates.delete(Math.floor(packed / TF_BITS));
    }

    const total = this._meta.size || 1;
    const now = Date.now();
    const scored = [];
    for (const id of candidates) {
      const meta = this._meta.get(id);
      if (!meta) continue;
      if (site && !hostMatches(meta.host, site)) continue;
      if (since && meta.rec.at < since) continue;
      if (until && meta.rec.at > until) continue;
      if (parsed.phrases.length) {
        if (meta.norm === null) meta.norm = normalize(meta.rec.title + ' ' + meta.rec.text);
        if (!parsed.phrases.every(p => meta.norm.includes(p))) continue;
      }
      let score = 0;
      for (const { term, found } of perTerm) {
        const tf = found.get(id) || 0;
        const df = this._post.get(term.stem)?.length || found.size || 1;
        const idf = Math.log(1 + total / Math.max(1, df));
        // BM25-flavoured saturation: the tenth mention of a word says much less
        // than the second, and a 6000-word page should not beat a focused one.
        const norm = tf / (tf + 1.2 * (0.25 + 0.75 * (meta.len / 600)));
        score += idf * (norm + (meta.titleStems.has(term.stem) ? 1.4 : 0));
      }
      // A page you read last night is likelier to be the one you mean.
      const ageDays = Math.max(0, (now - meta.rec.at) / 86400e3);
      score *= 1 + 0.35 * Math.exp(-ageDays / 21);
      if (parsed.phrases.length) score *= 1.6;
      scored.push({ id, score });
    }
    if (!scored.length) return { ...empty, terms: parsed.terms.map(t => t.raw), took: Date.now() - started };

    // A bare "site:x" query has no terms to rank by, so every score is 0 —
    // newest-first is the only ordering that means anything there.
    const sort = (!perTerm.length && (!opts.sort || opts.sort === 'relevance')) ? 'newest' : (opts.sort || 'relevance');
    if (sort === 'newest') scored.sort((a, b) => this._meta.get(b.id).rec.at - this._meta.get(a.id).rec.at);
    else if (sort === 'oldest') scored.sort((a, b) => this._meta.get(a.id).rec.at - this._meta.get(b.id).rec.at);
    else scored.sort((a, b) => b.score - a.score || this._meta.get(b.id).rec.at - this._meta.get(a.id).rec.at);

    const rawTerms = [...new Set(parsed.terms.map(t => t.raw).concat(parsed.phrases))].filter(Boolean);
    const page = scored.slice(offset, offset + limit);
    const wantSnippet = opts.snippet !== false;
    const hits = page.map(({ id, score }) => {
      const meta = this._meta.get(id);
      return {
        url: meta.rec.url,
        title: meta.rec.title || meta.rec.url,
        host: meta.host,
        at: meta.rec.at,
        first: meta.rec.first,
        visits: meta.rec.visits,
        score: Math.round(score * 1000) / 1000,
        snippet: wantSnippet ? snippet(meta.rec.text, rawTerms) : [],
      };
    });
    return { total: scored.length, hits, terms: rawTerms, took: Date.now() - started };
  }
}

function binarySearch(list, id) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const got = Math.floor(list[mid] / TF_BITS);
    if (got === id) return mid;
    if (got < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

const SNIPPET_CHARS = 230;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Pick the densest window of the page around the query words and return it as
 * [text, isMatch] pairs. Pairs rather than markup so the renderer can escape
 * first and only then wrap matches — highlighting escaped HTML with a regex is
 * how a page containing "amp" ends up highlighting "&amp;".
 *
 * Matching here runs case-insensitively against the ORIGINAL text, not the
 * accent-folded copy: folding can change a string's length, and a snippet built
 * from shifted offsets slices words in half.
 */
function snippet(text, terms, width = SNIPPET_CHARS) {
  const body = String(text || '');
  if (!body) return [];
  const words = terms.map(t => normalize(t).split(SPLIT).filter(Boolean)).flat();
  const unique = [...new Set(words)].filter(w => w.length > 1);
  if (!unique.length) return [[body.slice(0, width).trim(), false]];
  const re = new RegExp('(?<![\\p{L}\\p{N}])(?:' + unique.map(escapeRe).join('|') + ')[\\p{L}\\p{N}]{0,12}', 'giu');
  const spans = [];
  let m;
  while ((m = re.exec(body)) && spans.length < 400) {
    const lower = m[0].toLowerCase();
    spans.push([m.index, m[0].length, unique.findIndex(w => lower.startsWith(w))]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (!spans.length) return [[body.slice(0, width).trim(), false]];

  // Slide over the hits and keep the window covering the most distinct words.
  let best = spans[0][0], bestScore = -1;
  for (let i = 0; i < spans.length; i++) {
    const start = spans[i][0];
    const seen = new Set();
    let count = 0;
    for (let j = i; j < spans.length && spans[j][0] < start + width; j++) { seen.add(spans[j][2]); count++; }
    const score = seen.size * 10 + Math.min(count, 5);
    if (score > bestScore) { bestScore = score; best = start; }
  }
  let from = Math.max(0, best - 45);
  if (from > 0) { const sp = body.indexOf(' ', from); if (sp > 0 && sp < from + 25) from = sp + 1; }
  let to = Math.min(body.length, from + width);
  if (to < body.length) { const sp = body.lastIndexOf(' ', to); if (sp > from + width * 0.6) to = sp; }

  const parts = [];
  let cursor = from;
  for (const [start, len] of spans) {
    if (start + len <= from) continue;
    if (start >= to) break;
    const s = Math.max(start, from), e = Math.min(start + len, to);
    if (s > cursor) parts.push([body.slice(cursor, s), false]);
    if (e > s) parts.push([body.slice(s, e), true]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < to) parts.push([body.slice(cursor, to), false]);
  if (from > 0 && parts.length) parts[0] = ['…' + parts[0][0], parts[0][1]];
  if (to < body.length && parts.length) {
    const last = parts[parts.length - 1];
    if (last[1]) parts.push(['…', false]); else last[0] += '…';
  }
  return parts.filter(p => p[0]);
}

module.exports = { RecallIndex, tokenize, stem, normalize, parseQuery, snippet, hostOf, hostMatches, DEFAULTS };
