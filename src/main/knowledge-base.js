'use strict';
// === Personal knowledge base: everything you KEEP, searchable by meaning ===
//
// Pure Node, no Electron (tests/main/knowledgeBase.test.js). knowledge-ipc.js
// owns the files and the IPC; this module owns the rules.
//
// What goes in: what the person chose to keep (bookmarks, notes, page notes,
// read-later items, highlights, archived pages). Not what they merely visited:
// that is Recall's job, and Recall stays separate.
//
// Two ways to find things, both local:
//  * Keywords: BM25 over stemmed words (recall-index.js's tokenizer), OR across
//    the question's words with a bonus for covering more of them, so a plain
//    sentence works. Always on, no model needed.
//  * Meaning: embeddings from the user's own Ollama on this PC (the same
//    loopback-only embedder Recall uses), fused with the keyword ranking by
//    reciprocal rank. Optional; when the model is missing the keyword answer
//    comes back and says why meaning was not used.
//
// Rules, enforced in accept() and nowhere else:
//  * never a private, Tor, routed or container-routed tab, or a private window
//  * never an address Recall is told to stay out of, or a sign-in / bank /
//    payment / mail / health page (archive-library.js's rule)
//  * never anything the person marked "keep out" (survives Rebuild)
//  * bounded: maxItems, maxTextChars per item, maxBytes of text; the oldest
//    items fall out first and the status says how many did
//  * incremental: an item is re-indexed only when its hash changed

const { tokenize, stem, normalize } = require('./recall-index');
const { sensitiveReason } = require('./archive-library');
const { pageInput, fnv, hostOf, hostIn, prefixed, checkModel, loopbackBase } = require('./recall-vectors');

const VERSION = 1;
const KINDS = Object.freeze(['bookmark', 'note', 'sticky', 'readlater', 'highlight', 'archive']);
const LIMITS = Object.freeze({
  maxItems: 8000,
  maxTextChars: 6000,
  maxTitleChars: 300,
  maxBytes: 24 * 1024 * 1024,
  maxPrivateIds: 5000,
  passageChars: 420,
});
const DAY = 86400000;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const SPLIT = /[^\p{L}\p{N}_]+/u;

// Words that carry a question but not a topic. Removed from the QUESTION only;
// documents keep every word (idf already discounts the common ones).
const STOP = new Set(('a an the and or but if of to in on at by for with from as is are was were be been being am do does did done have has had having ' +
  'i me my mine we our you your it its this that these those there here what which who whom whose when where why how ' +
  'about across over under into onto than then so such not no yes can could should would will shall may might must ' +
  'read reading reads saved save kept keep show find tell give list all any some each every more most other another ' +
  'last past recent recently ago year years month months week weeks day days today yesterday ever lately').split(' '));

function toStems(text) {
  const out = [];
  for (const raw of normalize(text).split(SPLIT)) {
    if (!raw || raw.length > 40 || raw.length < 2 || STOP.has(raw) || /^\d+$/.test(raw) && raw.length < 3) continue;
    out.push(stem(raw));
  }
  return out;
}

/** "last year", "past 3 months", "in 2024", "yesterday" -> a time window, or null. */
function parseWhen(question, now = Date.now()) {
  const q = ' ' + String(question || '').toLowerCase() + ' ';
  let m;
  if ((m = q.match(/\b(?:in|during|from)\s+(20\d\d|19\d\d)\b/))) {
    const y = Number(m[1]);
    return { since: Date.UTC(y, 0, 1), until: Date.UTC(y + 1, 0, 1) - 1, label: String(y) };
  }
  if ((m = q.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month|year)s?\b/))) {
    const n = Number(m[1]);
    const days = { day: 1, week: 7, month: 30, year: 365 }[m[2]];
    return { since: now - n * days * DAY, until: 0, label: 'the last ' + n + ' ' + m[2] + (n === 1 ? '' : 's') };
  }
  if ((m = q.match(/\b(?:last|past|previous)\s+(week|month|year)\b/)) || (m = q.match(/\b(?:in|over|during)\s+the\s+(?:last|past)\s+(week|month|year)\b/))) {
    const days = { week: 7, month: 30, year: 365 }[m[1]];
    return { since: now - days * DAY, until: 0, label: 'the last ' + m[1] };
  }
  if (/\byesterday\b/.test(q)) return { since: now - 2 * DAY, until: 0, label: 'yesterday' };
  if (/\btoday\b/.test(q)) return { since: now - DAY, until: 0, label: 'today' };
  if (/\bthis\s+year\b/.test(q)) {
    const y = new Date(now).getUTCFullYear();
    return { since: Date.UTC(y, 0, 1), until: 0, label: 'this year' };
  }
  return null;
}

function normalizeHost(h) { return String(h || '').toLowerCase().replace(/^www\./, '').trim(); }

const ROUTED_PARTITION = /^persist:(?:route-|container-tor-)/;

class KnowledgeBase {
  constructor(options = {}) {
    this.options = { ...LIMITS, ...options };
    this._items = new Map();      // id -> item
    this._no = new Map();         // id -> doc number
    this._byNo = new Map();       // doc number -> item
    this._post = new Map();       // stem -> Map(docNo -> weighted tf)
    this._len = new Map();        // docNo -> token count
    this._totalLen = 0;
    this._nextNo = 1;
    this._bytes = 0;
    this._private = new Set();    // ids kept out by the person
    this.evicted = 0;             // items that fell off the end since the last Forget
    this.refusedCount = 0;
  }

  get size() { return this._items.size; }
  get bytes() { return this._bytes; }
  has(id, hash) { const it = this._items.get(id); return !!it && (hash === undefined || it.h === hash); }
  get(id) { return this._items.get(id) || null; }
  items() { return [...this._items.values()]; }
  isPrivate(id) { return this._private.has(id); }

  // --- what is allowed in ----------------------------------------------------

  /** A plain sentence for why this must not be indexed, or '' when it may be. */
  refusal(raw, { excludedHosts = [] } = {}) {
    if (!raw || typeof raw !== 'object') return 'Not an item.';
    if (!KINDS.includes(raw.kind)) return 'Unknown kind of item.';
    if (typeof raw.id !== 'string' || !raw.id) return 'The item has no id.';
    if (raw.private === true) return 'It came from a private window or tab.';
    if (this._private.has(raw.id)) return 'You marked it as kept out of the knowledge base.';
    const part = raw.partition == null ? '' : String(raw.partition);
    if (part && !part.startsWith('persist:')) return 'It came from a private or Tor tab.';
    if (part && ROUTED_PARTITION.test(part)) return 'It came from a tab routed through Tor or a proxy.';
    if (part.startsWith('persist:container-') && raw.routed !== false) return 'It came from a container whose route is not known to be direct.';
    if (raw.url) {
      const reason = sensitiveReason(raw.url);
      if (reason) return reason.replace(/archived/g, 'indexed');
      const host = normalizeHost(hostOf(raw.url));
      const ex = (Array.isArray(excludedHosts) ? excludedHosts : []).map(normalizeHost).filter(Boolean);
      if (host && ex.length && hostIn(host, ex)) return 'This site is on your list of sites Vex does not remember.';
    }
    const body = String(raw.text == null ? '' : raw.text).trim();
    const title = String(raw.title == null ? '' : raw.title).trim();
    if (!body && !title && !raw.url) return 'It is empty.';
    return '';
  }

  /** Index (or refresh) one item. Returns { ok, reason?, id }. Never throws for a refused item. */
  put(raw, opts = {}) {
    const reason = this.refusal(raw, opts);
    if (reason) {
      this.refusedCount++;
      // A refused item must not linger from before it became refused.
      if (raw && typeof raw.id === 'string') this.remove(raw.id);
      return { ok: false, reason, id: raw && raw.id };
    }
    const text = String(raw.text == null ? '' : raw.text).replace(/\s+/g, ' ').trim().slice(0, this.options.maxTextChars);
    const title = String(raw.title == null ? '' : raw.title).replace(/\s+/g, ' ').trim().slice(0, this.options.maxTitleChars);
    const url = raw.url ? String(raw.url).slice(0, 2048) : '';
    const at = Number.isFinite(raw.at) ? raw.at : Date.now();
    const h = typeof raw.h === 'string' && raw.h ? raw.h.slice(0, 40) : fnv(title + '\n' + url + '\n' + text);
    const prior = this._items.get(raw.id);
    if (prior) this._unindex(prior);
    const item = { id: raw.id, kind: raw.kind, title, url, text, at, h };
    this._items.set(item.id, item);
    this._bytes += title.length + text.length + url.length;
    this._index(item);
    this._enforce();
    return { ok: true, id: item.id };
  }

  _index(item) {
    const no = this._nextNo++;
    this._no.set(item.id, no);
    this._byNo.set(no, item);
    const body = tokenize(item.text);
    const counts = new Map();
    for (const t of body) counts.set(t, (counts.get(t) || 0) + 1);
    // A word in the title or address says more than one in the body.
    for (const t of tokenize(item.title)) counts.set(t, (counts.get(t) || 0) + 3);
    if (item.url) for (const t of tokenize(hostOf(item.url) + ' ' + item.url.replace(/^https?:\/\/[^/]+/i, ''))) counts.set(t, (counts.get(t) || 0) + 1);
    const len = body.length + 1;
    for (const [t, n] of counts) {
      let docs = this._post.get(t);
      if (!docs) { docs = new Map(); this._post.set(t, docs); }
      docs.set(no, n);
    }
    this._len.set(no, len);
    this._totalLen += len;
  }

  _unindex(item) {
    const no = this._no.get(item.id);
    if (no === undefined) return;
    const stems = new Set(tokenize(item.text));
    for (const t of tokenize(item.title)) stems.add(t);
    if (item.url) for (const t of tokenize(hostOf(item.url) + ' ' + item.url.replace(/^https?:\/\/[^/]+/i, ''))) stems.add(t);
    for (const t of stems) {
      const docs = this._post.get(t);
      if (!docs) continue;
      docs.delete(no);
      if (!docs.size) this._post.delete(t);
    }
    this._totalLen -= this._len.get(no) || 0;
    this._len.delete(no);
    this._no.delete(item.id);
    this._byNo.delete(no);
    this._bytes -= item.title.length + item.text.length + item.url.length;
    this._items.delete(item.id);
  }

  remove(id) {
    const it = this._items.get(id);
    if (!it) return false;
    this._unindex(it);
    return true;
  }

  _enforce() {
    let dropped = 0;
    while (this._items.size > this.options.maxItems || (this._bytes > this.options.maxBytes && this._items.size > 1)) {
      let oldest = null;
      for (const it of this._items.values()) if (!oldest || it.at < oldest.at) oldest = it;
      if (!oldest) break;
      this._unindex(oldest);
      dropped++;
    }
    this.evicted += dropped;
    return dropped;
  }

  /**
   * What the renderer should send. entries: [{id, kind, h}] of everything it
   * has now, for the kinds listed in covers. need: ids new or changed.
   * gone: ids of those kinds that no longer exist there.
   */
  plan(entries, covers) {
    const kinds = new Set((Array.isArray(covers) && covers.length ? covers : KINDS).filter(k => KINDS.includes(k)));
    const present = new Set();
    const need = [];
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || typeof e.id !== 'string' || !kinds.has(e.kind)) continue;
      present.add(e.id);
      if (this._private.has(e.id)) continue;
      if (!this.has(e.id, e.h)) need.push(e.id);
    }
    const gone = [];
    for (const it of this._items.values()) if (kinds.has(it.kind) && !present.has(it.id)) gone.push(it.id);
    return { need, gone };
  }

  markPrivate(id, on = true) {
    if (typeof id !== 'string' || !id) throw new Error('Name the item to keep out.');
    if (on) {
      if (this._private.size >= this.options.maxPrivateIds && !this._private.has(id)) throw new Error('Too many items are kept out already.');
      this._private.add(id);
      return this.remove(id);
    }
    return this._private.delete(id);
  }

  /** Forget everything indexed. Marked-private ids stay: they are a preference. */
  clear() {
    this._items.clear(); this._no.clear(); this._byNo.clear(); this._post.clear(); this._len.clear();
    this._totalLen = 0; this._bytes = 0; this.evicted = 0; this.refusedCount = 0;
  }

  /** Drop every indexed item whose address is on the excluded list. */
  dropHosts(hosts) {
    const ex = (Array.isArray(hosts) ? hosts : []).map(normalizeHost).filter(Boolean);
    if (!ex.length) return 0;
    let n = 0;
    for (const it of this.items()) if (it.url && hostIn(normalizeHost(hostOf(it.url)), ex)) { this.remove(it.id); n++; }
    return n;
  }

  // --- searching -------------------------------------------------------------

  /**
   * Rank by keywords. The question is a sentence: stop words and time phrases
   * come out, the rest is OR'd with BM25 and a bonus for covering more words.
   * Returns { hits: [{id, score}], terms, when }.
   */
  searchKeywords(question, { limit = 20, since = 0, until = 0, kinds = null, now = Date.now() } = {}) {
    const when = parseWhen(question, now);
    const lo = since || (when ? when.since : 0);
    const hi = until || (when ? when.until : 0);
    const terms = [...new Set(toStems(question))];
    if (!terms.length || !this._items.size) return { hits: [], terms, when };
    const N = this._items.size;
    const avg = this._totalLen / N || 1;
    const scores = new Map();
    const covered = new Map();
    for (const t of terms) {
      const docs = this._post.get(t);
      if (!docs) continue;
      const idf = Math.log(1 + (N - docs.size + 0.5) / (docs.size + 0.5));
      for (const [no, tf] of docs) {
        const dl = this._len.get(no) || 1;
        const s = idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / avg));
        scores.set(no, (scores.get(no) || 0) + s);
        covered.set(no, (covered.get(no) || 0) + 1);
      }
    }
    const kindSet = kinds && kinds.length ? new Set(kinds) : null;
    const hits = [];
    for (const [no, s] of scores) {
      const it = this._byNo.get(no);
      if (!it) continue;
      if (lo && it.at < lo) continue;
      if (hi && it.at > hi) continue;
      if (kindSet && !kindSet.has(it.kind)) continue;
      const cover = covered.get(no) / terms.length;
      hits.push({ id: it.id, score: s * (0.5 + cover) });
    }
    hits.sort((a, b) => b.score - a.score || this._items.get(b.id).at - this._items.get(a.id).at);
    return { hits: hits.slice(0, Math.max(1, Math.min(200, limit))), terms, when, total: hits.length };
  }

  /** The best passages of an item for these stems, most relevant first. */
  passages(id, terms, n = 2) {
    const it = this._items.get(id);
    if (!it) return [];
    const want = new Set(terms);
    const parts = splitPassages(it.text, this.options.passageChars);
    if (!parts.length) return it.title ? [{ text: it.title, score: 0 }] : [];
    const scored = parts.map((text, i) => {
      const seen = new Set();
      for (const t of tokenize(text)) if (want.has(t)) seen.add(t);
      return { text, score: seen.size, i };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.slice(0, n).map(p => ({ text: p.text, score: p.score }));
  }

  /** Items like this one by words alone (when there are no vectors for it). */
  relatedByWords(id, { limit = 5 } = {}) {
    const it = this._items.get(id);
    if (!it) return [];
    return this._relatedFromText(it.title + ' ' + it.text, { limit, exclude: id });
  }

  /** Items like some text that is not (yet) in the base: the page being read. */
  relatedToText(text, { limit = 5, excludeUrl = '' } = {}) {
    return this._relatedFromText(text, { limit, excludeUrl });
  }

  _relatedFromText(text, { limit, exclude = '', excludeUrl = '' }) {
    const counts = new Map();
    for (const t of toStems(text)) counts.set(t, (counts.get(t) || 0) + 1);
    const N = this._items.size || 1;
    const ranked = [...counts].map(([t, n]) => {
      const df = (this._post.get(t) || { size: 0 }).size;
      return { t, w: n * Math.log(1 + N / (1 + df)), df };
    }).filter(x => x.df > 0 && x.df <= Math.max(1, N * 0.5)).sort((a, b) => b.w - a.w).slice(0, 10);
    if (!ranked.length) return [];
    const scores = new Map();
    for (const { t, w } of ranked) {
      for (const no of this._post.get(t).keys()) scores.set(no, (scores.get(no) || 0) + w);
    }
    const out = [];
    for (const [no, s] of scores) {
      const it = this._byNo.get(no);
      if (!it || it.id === exclude || (excludeUrl && it.url === excludeUrl)) continue;
      out.push({ id: it.id, score: s });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  stats() {
    const byKind = {};
    for (const k of KINDS) byKind[k] = 0;
    let oldest = 0, newest = 0;
    for (const it of this._items.values()) {
      byKind[it.kind]++;
      if (!oldest || it.at < oldest) oldest = it.at;
      if (it.at > newest) newest = it.at;
    }
    return {
      items: this._items.size, byKind, bytes: this._bytes, terms: this._post.size,
      maxItems: this.options.maxItems, maxBytes: this.options.maxBytes,
      oldest, newest, evicted: this.evicted, keptOut: this._private.size, refused: this.refusedCount,
    };
  }

  toJSON() {
    return {
      version: VERSION,
      privateIds: [...this._private],
      evicted: this.evicted,
      items: this.items().map(i => ({ id: i.id, kind: i.kind, title: i.title, url: i.url, text: i.text, at: i.at, h: i.h })),
    };
  }

  /** Throws a sentence for a file that cannot be trusted; the caller starts empty and says so. */
  static fromJSON(data, options) {
    if (!data || typeof data !== 'object' || data.version !== VERSION) throw new Error('unknown version');
    if (!Array.isArray(data.items)) throw new Error('missing items');
    const kb = new KnowledgeBase(options);
    for (const id of Array.isArray(data.privateIds) ? data.privateIds : []) if (typeof id === 'string') kb._private.add(id);
    for (const it of data.items) {
      if (!it || typeof it.id !== 'string' || !KINDS.includes(it.kind)) throw new Error('bad item');
      // Re-checked on load: a rule added since the file was written still applies.
      kb.put({ id: it.id, kind: it.kind, title: it.title, url: it.url, text: it.text, at: it.at, h: it.h });
    }
    kb.evicted = Number.isFinite(data.evicted) ? data.evicted : 0;
    kb.refusedCount = 0;
    return kb;
  }
}

function splitPassages(text, width) {
  const body = String(text || '').trim();
  if (!body) return [];
  const sentences = body.split(/(?<=[.!?])\s+|\s+[-*]\s+|\n+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > width) { out.push(cur); cur = ''; }
    cur = cur ? cur + ' ' + s : s;
    while (cur.length > width * 1.6) { out.push(cur.slice(0, width)); cur = cur.slice(width); }
  }
  if (cur) out.push(cur);
  return out;
}

/** Reciprocal-rank fusion of several [{id}] lists. */
function fuse(lists, { k = 60, weights = [] } = {}) {
  const score = new Map();
  const from = new Map();
  lists.forEach((list, li) => {
    const w = weights[li] == null ? 1 : weights[li];
    list.forEach((h, i) => {
      score.set(h.id, (score.get(h.id) || 0) + w / (k + i + 1));
      const f = from.get(h.id) || new Set(); f.add(li); from.set(h.id, f);
    });
  });
  return [...score].map(([id, s]) => ({ id, score: s, lists: [...from.get(id)] })).sort((a, b) => b.score - a.score);
}

// --- the service: base + vectors + local embedder -----------------------------

/**
 * kb: KnowledgeBase. store: VectorStore (its own file, its own model).
 * embedder: createOllamaEmbedder(). isHeld(): '' to run, or a reason
 * ('a game is running', 'saving battery') to wait. onChange(): the caller
 * writes files.
 */
function createKnowledgeService({ kb, store, embedder, now = Date.now, onChange = () => {}, isHeld = () => '', minGapMs = 8000, batchMax = 8 }) {
  if (!kb || !store || !embedder) throw new Error('createKnowledgeService needs kb, store and embedder');
  let lastStepAt = -Infinity;
  let lastError = '';
  let busy = false;

  function modelState(model) {
    if (!model) return null;
    const m = checkModel(model);
    if (store.useModel(m)) onChange();
    return m;
  }

  function inputOf(it) { return pageInput({ title: it.title, text: it.text || it.url }); }

  function counts() {
    let embeddable = 0, understood = 0;
    for (const it of kb.items()) {
      if (inputOf(it).length < 12) continue;
      embeddable++;
      if (store.has(it.id, fnv(inputOf(it)))) understood++;
    }
    return { embeddable, understood, pending: Math.max(0, embeddable - understood), vectors: store.size };
  }

  function dropStaleVectors() {
    const n = store.retain(id => kb.has(id));
    if (n) onChange();
    return n;
  }

  /** Embed a few items. Says why when held or when Ollama is down; never throws for that. */
  async function step({ model, baseUrl, batch = 5, manual = false } = {}) {
    if (!model) return { ok: true, skipped: true, state: 'off', ...counts() };
    const m = modelState(model);
    const base = loopbackBase(baseUrl);
    dropStaleVectors();
    const held = manual ? '' : isHeld();
    if (held) return { ok: true, skipped: true, state: 'held', message: 'Waiting: ' + held + '.', ...counts() };
    const t = now();
    if (busy || t - lastStepAt < minGapMs) return { ok: true, skipped: true, ...counts() };
    lastStepAt = t;
    busy = true;
    let embedded = 0;
    try {
      const names = await embedder.installed(base);
      if (!names.some(n => n === m || n === m + ':latest' || n + ':latest' === m)) {
        lastError = `Model not installed. Run: ollama pull ${m}`;
        return { ok: false, state: 'model-missing', message: lastError, ...counts() };
      }
      const todo = [];
      for (const it of kb.items()) {
        const input = inputOf(it);
        if (input.length < 12) continue;
        const hash = fnv(input);
        if (!store.has(it.id, hash)) todo.push({ it, input, hash });
        if (todo.length >= Math.max(1, Math.min(batchMax, batch))) break;
      }
      for (const { it, input, hash } of todo) {
        if (!kb.has(it.id)) continue;
        const v = await embedder.embed(base, m, prefixed(m, 'document', input));
        if (!kb.has(it.id)) continue;
        store.put(it.id, hash, v);
        embedded++;
      }
      if (embedded) onChange();
      lastError = '';
      return { ok: true, embedded, ...counts() };
    } catch (err) {
      if (embedded) onChange();
      lastError = err.message;
      const down = /not running|did not answer/i.test(err.message);
      return { ok: false, state: down ? 'ollama-down' : 'error', message: err.message, embedded, ...counts() };
    } finally { busy = false; }
  }

  /** The honest line for the panel. */
  async function status({ model, baseUrl } = {}) {
    const base = { ...kb.stats(), storeBytes: store.bytes, dim: store.dim, ...counts() };
    const sizeBytes = base.bytes + base.storeBytes;
    if (!model) return { ...base, sizeBytes, mode: 'keywords', state: 'keywords', message: 'Keyword search with stemming. Pick an embedding model in Settings › Recall to add search by meaning.' };
    let m;
    try { m = modelState(model); } catch (err) { return { ...base, sizeBytes, mode: 'keywords', state: 'error', message: err.message }; }
    try {
      const names = await embedder.installed(baseUrl);
      if (!names.some(n => n === m || n === m + ':latest' || n + ':latest' === m)) return { ...base, sizeBytes, mode: 'keywords', state: 'model-missing', message: `Model not installed. Run: ollama pull ${m}` };
    } catch (err) {
      return { ...base, sizeBytes, mode: 'keywords', state: 'ollama-down', message: err.message };
    }
    const c = counts();
    const state = lastError ? 'error' : (c.pending ? 'building' : 'ok');
    const message = lastError || (c.pending ? 'Building meaning search in the background while Vex is idle.' : 'Up to date.');
    return { ...base, ...c, sizeBytes, mode: store.size ? 'meaning' : 'keywords', state, message };
  }

  function shape(id, terms, extra = {}) {
    const it = kb.get(id);
    if (!it) return null;
    return { id: it.id, kind: it.kind, title: it.title || it.url, url: it.url, at: it.at, passages: kb.passages(id, terms, 2).map(p => p.text), ...extra };
  }

  /** Keywords fused with meaning when it is available. semanticError says why not. */
  async function search(question, { model, baseUrl, limit = 20, since = 0, until = 0, kinds = null } = {}) {
    const q = String(question == null ? '' : question).trim().slice(0, 512);
    if (!q) return { hits: [], terms: [], mode: 'keywords' };
    const kw = kb.searchKeywords(q, { limit: Math.max(limit * 3, 30), since, until, kinds, now: now() });
    let semantic = [];
    let semanticError = '';
    let mode = 'keywords';
    // A wrong address is an error even before there is anything to embed.
    const base = model ? loopbackBase(baseUrl) : null;
    if (model && store.size) {
      try {
        const m = modelState(model);
        const v = await embedder.embed(base, m, prefixed(m, 'query', q));
        const lo = since || (kw.when ? kw.when.since : 0);
        const hi = until || (kw.when ? kw.when.until : 0);
        const kindSet = kinds && kinds.length ? new Set(kinds) : null;
        semantic = store.search(v, { limit: limit * 3 }).filter(r => {
          const it = kb.get(r.id || r.url);
          if (!it) return false;
          if (lo && it.at < lo) return false;
          if (hi && it.at > hi) return false;
          return !kindSet || kindSet.has(it.kind);
        }).map(r => ({ id: r.url, score: r.score }));
        mode = 'meaning';
      } catch (err) { semanticError = err.message; }
    } else if (model && !store.size) {
      semanticError = 'Meaning search has not indexed anything yet; showing keyword matches.';
    }
    const fused = mode === 'meaning' ? fuse([kw.hits, semantic]) : kw.hits.map(h => ({ ...h, lists: [0] }));
    const hits = fused.slice(0, Math.max(1, Math.min(100, limit))).map(h => shape(h.id, kw.terms, { score: Math.round(h.score * 1000) / 1000, byMeaning: h.lists.includes(1) })).filter(Boolean);
    return { hits, terms: kw.terms, mode, semanticError, when: kw.when ? kw.when.label : '', total: fused.length };
  }

  /** Items related to one in the base: by meaning when it has a vector, else by words. */
  function related(id, { limit = 5 } = {}) {
    const it = kb.get(id);
    if (!it) return { hits: [], how: 'none' };
    const e = store._entries.get(id);
    if (e) {
      const hits = store.search(Array.from(e.q), { limit: limit + 1, min: 0.35 }).filter(r => r.url !== id && kb.has(r.url)).slice(0, limit);
      if (hits.length) return { hits: hits.map(r => shape(r.url, [], { score: Math.round(r.score * 1000) / 1000 })), how: 'meaning' };
    }
    return { hits: kb.relatedByWords(id, { limit }).map(r => shape(r.id, [], { score: Math.round(r.score * 100) / 100 })), how: 'words' };
  }

  /**
   * "Related to what you are reading": words from the page against the base,
   * leaving out the page itself. Brief-ready: a plain list, no model call.
   */
  function relatedToPage(page, { limit = 5 } = {}) {
    const text = String((page && page.title) || '') + ' ' + String((page && page.text) || '').slice(0, 4000);
    const url = page && page.url ? String(page.url) : '';
    return { hits: kb.relatedToText(text, { limit, excludeUrl: url }).map(r => shape(r.id, [], { score: Math.round(r.score * 100) / 100 })).filter(Boolean), how: 'words' };
  }

  /** Numbered passages for the model, each with the source it came from. */
  async function context(question, opts = {}) {
    const res = await search(question, { ...opts, limit: opts.limit || 6 });
    const sources = [];
    for (const h of res.hits) {
      const text = (h.passages && h.passages.length ? h.passages.join(' … ') : h.title).slice(0, 700);
      sources.push({ n: sources.length + 1, id: h.id, kind: h.kind, title: h.title, url: h.url, at: h.at, text });
    }
    return { sources, mode: res.mode, semanticError: res.semanticError, when: res.when };
  }

  function forgetVectors() {
    const n = store.size;
    store.clear();
    store.model = '';
    lastError = '';
    onChange();
    return n;
  }

  return { step, status, search, related, relatedToPage, context, counts, forgetVectors, dropStaleVectors };
}

module.exports = {
  KnowledgeBase, createKnowledgeService, fuse, parseWhen, toStems, splitPassages,
  KINDS, LIMITS, VERSION, STOP,
};
