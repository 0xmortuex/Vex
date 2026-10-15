'use strict';
// === Recall by meaning: a local vector index beside the full-text one ===
//
// Pure Node, no Electron (tests/main/recallVectors.test.js). main.js owns the
// file and the IPC; this module owns the rules:
//
//  * It never keeps page text. A vector is built from the title plus the first
//    TEXT_CHARS characters of the text Recall.json ALREADY holds, so there is
//    no second copy of what you read. Only numbers are stored here.
//  * Embeddings come from the user's own Ollama and from nowhere else. The
//    address is checked to be this PC (127.0.0.1, localhost or ::1) before a
//    single byte of page text is sent, and a model name that is not installed
//    is said, not guessed.
//  * It is bounded: at most maxVectors pages (oldest embedded go first) and
//    maxBytes of numbers. Each vector is stored as 8-bit integers with its
//    length, which keeps 5,000 pages near 4 MB and ranks the same as floats
//    for this purpose.
//  * A vector belongs to a model. Another model (or another vector length)
//    makes every stored vector meaningless, so changing the model empties it.
//  * Pages the user excluded, forgot or cleared lose their vector at the next
//    step; forget/clear in main.js remove them at once.

const VERSION = 1;
const TEXT_CHARS = 2000;
const TITLE_CHARS = 300;
const LIMITS = {
  maxVectors: 5000,
  maxBytes: 8 * 1024 * 1024,
  maxDim: 4096,
  perVectorOverhead: 48,
};
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const REQUEST_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 3000;
const MIN_SCORE = 0.3;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

/** The address Ollama is asked at, or a thrown sentence. Only this PC is allowed. */
function loopbackBase(url) {
  const raw = String(url == null || url === '' ? DEFAULT_BASE_URL : url).trim();
  let u;
  try { u = new URL(raw); } catch { throw new Error('The Ollama address is not a web address.'); }
  if (u.protocol !== 'http:') throw new Error('Recall by meaning only talks to Ollama on this PC over http.');
  if (u.username || u.password) throw new Error('The Ollama address must not contain a login.');
  const host = u.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
    throw new Error('Recall by meaning only talks to Ollama on this PC (127.0.0.1). It will not send page text to ' + host + '.');
  }
  if (u.pathname !== '/' && u.pathname !== '') throw new Error('The Ollama address must not have a path.');
  const port = u.port ? Number(u.port) : 11434;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The Ollama port is not valid.');
  // "localhost" can resolve to anything a hosts file says: ask by number.
  return 'http://' + (host === '[::1]' ? '[::1]' : '127.0.0.1') + ':' + port;
}

function checkModel(model) {
  const m = String(model == null ? '' : model).trim();
  if (!MODEL_RE.test(m)) throw new Error('Pick an embedding model, for example nomic-embed-text.');
  return m;
}

function sameModel(name, model) { return name === model || name === model + ':latest' || name + ':latest' === model; }

function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** What is embedded for a page: its title and the first stretch of its text. */
function pageInput(rec) {
  const title = String(rec.title || '').slice(0, TITLE_CHARS).trim();
  const body = String(rec.text || '').slice(0, TEXT_CHARS).trim();
  return (title ? title + '\n' : '') + body;
}

function prefixed(model, kind, text) {
  // nomic-embed-text was trained with these task prefixes; leaving them off
  // measurably lowers retrieval quality.
  if (/nomic-embed/i.test(model)) return (kind === 'query' ? 'search_query: ' : 'search_document: ') + text;
  return text;
}

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function hostIn(host, list) { return list.some(h => host === h || host.endsWith('.' + h)); }

// --- storage of one vector ----------------------------------------------------

function quantize(floats) {
  let max = 0;
  for (const x of floats) { if (!Number.isFinite(x)) throw new Error('The embedding contained a value that is not a number.'); const a = Math.abs(x); if (a > max) max = a; }
  if (!max) throw new Error('The embedding was all zeros.');
  const q = new Int8Array(floats.length);
  let norm = 0;
  for (let i = 0; i < floats.length; i++) { const v = Math.round(floats[i] / max * 127); q[i] = v; norm += v * v; }
  return { q, norm: Math.sqrt(norm) };
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

class VectorStore {
  constructor(options = {}) {
    this.options = { ...LIMITS, ...options };
    this.model = '';
    this.dim = 0;
    this._entries = new Map(); // url -> { url, hash, norm, q }   oldest embedded first
  }

  get size() { return this._entries.size; }
  get bytes() { return this._entries.size * (this.dim + this.options.perVectorOverhead); }

  /** Use this model. A different one empties the store. True when it did. */
  useModel(model) {
    if (this.model === model) return false;
    const had = this._entries.size > 0;
    this._entries.clear();
    this.model = model;
    this.dim = 0;
    return had;
  }

  has(url, hash) {
    const e = this._entries.get(url);
    return !!e && (hash === undefined || e.hash === hash);
  }

  put(url, hash, floats) {
    if (!this.model) throw new Error('No embedding model is set.');
    if (!Array.isArray(floats) && !ArrayBuffer.isView(floats)) throw new Error('The embedding was not a list of numbers.');
    if (!floats.length || floats.length > this.options.maxDim) throw new Error('The embedding has an unusable length (' + floats.length + ').');
    if (this.dim && floats.length !== this.dim) throw new Error('The model returned ' + floats.length + ' numbers where it returned ' + this.dim + ' before.');
    const { q, norm } = quantize(floats);
    this.dim = floats.length;
    this._entries.delete(url);
    this._entries.set(url, { url, hash, norm, q });
    this._enforce();
    return true;
  }

  _enforce() {
    const per = this.dim + this.options.perVectorOverhead;
    const byBytes = Math.max(1, Math.floor(this.options.maxBytes / per));
    const cap = Math.min(this.options.maxVectors, byBytes);
    while (this._entries.size > cap) this._entries.delete(this._entries.keys().next().value);
  }

  remove(url) { return this._entries.delete(url); }

  removeHost(host) {
    let n = 0;
    for (const url of [...this._entries.keys()]) {
      const h = hostOf(url);
      if (h === host || h.endsWith('.' + host)) { this._entries.delete(url); n++; }
    }
    return n;
  }

  /** Keep only urls for which keep(url) is true. Returns how many went. */
  retain(keep) {
    let n = 0;
    for (const url of [...this._entries.keys()]) if (!keep(url)) { this._entries.delete(url); n++; }
    return n;
  }

  clear() { this._entries.clear(); this.dim = 0; }

  /** Cosine ranking, brute force. query is a plain array of numbers. */
  search(query, { limit = 20, min = MIN_SCORE } = {}) {
    if (!this._entries.size) return [];
    if (query.length !== this.dim) throw new Error('The question was embedded with ' + query.length + ' numbers but the index holds ' + this.dim + '. The model changed; wait for the index to rebuild.');
    const { q, norm } = quantize(query);
    const out = [];
    for (const e of this._entries.values()) {
      const score = dot(q, e.q) / (norm * e.norm || 1);
      if (score >= min) out.push({ url: e.url, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, Math.max(1, Math.min(200, limit)));
  }

  toJSON() {
    return {
      version: VERSION, model: this.model, dim: this.dim,
      entries: [...this._entries.values()].map(e => ({ u: e.url, h: e.hash, n: Math.round(e.norm * 1000) / 1000, v: Buffer.from(e.q.buffer, e.q.byteOffset, e.q.byteLength).toString('base64') })),
    };
  }

  /** Throws a sentence for a file that cannot be trusted; the caller says so and starts empty. */
  static fromJSON(data, options) {
    const store = new VectorStore(options);
    if (!data || typeof data !== 'object' || data.version !== VERSION) throw new Error('unknown version');
    if (typeof data.model !== 'string' || !Array.isArray(data.entries)) throw new Error('missing model or entries');
    if (!Number.isInteger(data.dim) || data.dim < 0 || data.dim > store.options.maxDim) throw new Error('bad vector length');
    store.model = data.model;
    store.dim = data.dim;
    for (const e of data.entries) {
      if (!e || typeof e.u !== 'string' || typeof e.h !== 'string' || typeof e.v !== 'string') throw new Error('bad entry');
      const buf = Buffer.from(e.v, 'base64');
      if (buf.length !== data.dim) throw new Error('entry length does not match');
      const q = new Int8Array(data.dim);
      q.set(new Int8Array(buf.buffer, buf.byteOffset, buf.length));
      let norm = 0;
      for (let i = 0; i < q.length; i++) norm += q[i] * q[i];
      store._entries.set(e.u, { url: e.u, hash: e.h, norm: Math.sqrt(norm), q });
    }
    store._enforce();
    return store;
  }
}

// --- Ollama, on this PC only -------------------------------------------------

function createOllamaEmbedder({ fetchImpl = (typeof fetch === 'function' ? fetch : null), now = Date.now } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('createOllamaEmbedder needs a fetch function');
  let tagsCache = null; // { key, at, names }

  async function call(base, path, init, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetchImpl(base + path, { ...init, signal: ctl.signal });
    } catch (err) {
      if (ctl.signal.aborted) throw new Error('Ollama did not answer in ' + Math.round(timeoutMs / 1000) + ' seconds.', { cause: err });
      throw new Error('Ollama is not running. Start Ollama to build the meaning index.', { cause: err });
    } finally { clearTimeout(timer); }
  }

  async function installed(baseUrl, { fresh = false } = {}) {
    const base = loopbackBase(baseUrl);
    if (!fresh && tagsCache && tagsCache.key === base && now() - tagsCache.at < 15000) return tagsCache.names;
    const r = await call(base, '/api/tags', { method: 'GET' }, PROBE_TIMEOUT_MS);
    if (!r.ok) throw new Error('Ollama answered with an error (' + r.status + ').');
    const data = await r.json();
    const names = (Array.isArray(data && data.models) ? data.models : []).map(m => m.name || m.model).filter(Boolean);
    tagsCache = { key: base, at: now(), names };
    return names;
  }

  async function embed(baseUrl, model, text) {
    const base = loopbackBase(baseUrl);
    const m = checkModel(model);
    let r = await call(base, '/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, input: text }) }, REQUEST_TIMEOUT_MS);
    if (r.status === 404) {
      // Ollama before 0.3.0 has only the older route; a 404 with a "model not
      // found" body is the model, not the route.
      const body = await r.text().catch(() => '');
      if (/not found/i.test(body) && /model/i.test(body)) throw new Error(`The model "${m}" is not installed in Ollama. Run: ollama pull ${m}`);
      r = await call(base, '/api/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, prompt: text }) }, REQUEST_TIMEOUT_MS);
      if (r.status === 404) throw new Error(`The model "${m}" is not installed in Ollama. Run: ollama pull ${m}`);
    }
    if (!r.ok) throw new Error('Ollama could not embed the text (' + r.status + ').');
    const data = await r.json();
    const v = data && (Array.isArray(data.embeddings) ? data.embeddings[0] : data.embedding);
    if (!Array.isArray(v) || !v.length) throw new Error(`"${m}" returned no embedding. It may not be an embedding model; try nomic-embed-text.`);
    return v;
  }

  return { installed, embed, forgetCache() { tagsCache = null; } };
}

// --- the meaning index: store + records + embedder ----------------------------

/**
 * records(): the Recall records, newest first ({url,title,text}).
 * get(url): one record or null.
 */
function createMeaningIndex({ store, records, get, embedder, now = Date.now, onChange = () => {}, batchMax = 8, minGapMs = 20000 }) {
  if (!store || typeof records !== 'function' || typeof get !== 'function' || !embedder) throw new Error('createMeaningIndex needs store, records, get and embedder');
  let lastStepAt = -Infinity;
  let lastError = '';
  let busy = false;

  function prepare(model, excluded) {
    const m = checkModel(model);
    if (store.useModel(m)) onChange();
    const ex = (Array.isArray(excluded) ? excluded : []).map(h => String(h).toLowerCase().replace(/^www\./, '')).filter(Boolean);
    return { m, ex };
  }

  function wanted(ex) {
    // Records that should have a vector and do not (or whose text moved on).
    const out = [];
    for (const rec of records()) {
      if (ex.length && hostIn(hostOf(rec.url), ex)) continue;
      const input = pageInput(rec);
      if (input.length < 40) continue;
      const hash = fnv(input);
      if (!store.has(rec.url, hash)) out.push({ rec, input, hash });
    }
    return out;
  }

  function dropStale(ex) {
    const n = store.retain(url => !!get(url) && !(ex.length && hostIn(hostOf(url), ex)));
    if (n) onChange();
    return n;
  }

  /** Embed a few pages. Never throws for "Ollama is down": it says so in the result. */
  async function step({ model, baseUrl, excluded, batch = 5 } = {}) {
    const { m, ex } = prepare(model, excluded);
    const base = loopbackBase(baseUrl);
    dropStale(ex);
    const t = now();
    if (busy || t - lastStepAt < minGapMs) return { ok: true, skipped: true, ...counts(ex) };
    lastStepAt = t;
    busy = true;
    let embedded = 0;
    try {
      const names = await embedder.installed(base);
      if (!names.some(n => sameModel(n, m))) {
        lastError = `Model not installed. Run: ollama pull ${m}`;
        return { ok: false, state: 'model-missing', message: lastError, ...counts(ex) };
      }
      const todo = wanted(ex).slice(0, Math.max(1, Math.min(batchMax, batch)));
      for (const item of todo) {
        // The page may have been forgotten while an earlier one was embedding.
        if (!get(item.rec.url)) continue;
        const v = await embedder.embed(base, m, prefixed(m, 'document', item.input));
        if (!get(item.rec.url)) continue;
        store.put(item.rec.url, item.hash, v);
        embedded++;
      }
      if (embedded) onChange();
      lastError = '';
      return { ok: true, embedded, ...counts(ex) };
    } catch (err) {
      if (embedded) onChange();
      lastError = err.message;
      const down = /not running|did not answer/i.test(err.message);
      return { ok: false, state: down ? 'ollama-down' : 'error', message: err.message, embedded, ...counts(ex) };
    } finally { busy = false; }
  }

  function counts(ex = []) {
    let pages = 0, understood = 0;
    for (const rec of records()) {
      if (ex.length && hostIn(hostOf(rec.url), ex)) continue;
      if (pageInput(rec).length < 40) continue;
      pages++;
      if (store.has(rec.url)) understood++;
    }
    return { pages, understood, pending: Math.max(0, pages - understood), vectors: store.size };
  }

  /** Honest status for the panel. Probes Ollama (cached for a few seconds). */
  async function status({ model, baseUrl, excluded } = {}) {
    if (!model) return { configured: false, state: 'off', message: 'Off. Pick an embedding model in Settings › Recall.', ...counts(), dim: store.dim, maxVectors: store.options.maxVectors, bytes: store.bytes };
    const { m, ex } = prepare(model, excluded);
    const out = { configured: true, model: m, dim: store.dim, maxVectors: store.options.maxVectors, bytes: store.bytes, ...counts(ex) };
    try {
      const names = await embedder.installed(baseUrl);
      if (!names.some(n => sameModel(n, m))) return { ...out, state: 'model-missing', message: `Model not installed. Run: ollama pull ${m}` };
    } catch (err) {
      return { ...out, state: 'ollama-down', message: err.message };
    }
    if (lastError) return { ...out, state: 'error', message: lastError };
    return { ...out, state: out.pending ? 'building' : 'ok', message: out.pending ? 'Building in the background while Vex is idle.' : 'Up to date.' };
  }

  /** Pages ranked by meaning. Throws a sentence the panel shows. */
  async function search(query, { model, baseUrl, excluded, limit = 20 } = {}) {
    const q = String(query == null ? '' : query).trim().slice(0, 512);
    if (!q) return { hits: [] };
    const { m, ex } = prepare(model, excluded);
    const base = loopbackBase(baseUrl);
    if (!store.size) return { hits: [], understood: 0 };
    const v = await embedder.embed(base, m, prefixed(m, 'query', q));
    const hits = [];
    for (const r of store.search(v, { limit: Math.min(200, limit * 2) })) {
      const rec = get(r.url);
      if (!rec) continue;
      if (ex.length && hostIn(hostOf(rec.url), ex)) continue;
      hits.push({ url: rec.url, title: rec.title || rec.url, at: rec.at, first: rec.first, visits: rec.visits, score: Math.round(r.score * 1000) / 1000, text: rec.text });
      if (hits.length >= limit) break;
    }
    return { hits, understood: store.size };
  }

  function forget() {
    const n = store.size;
    store.clear();
    store.model = '';
    lastError = '';
    onChange();
    return n;
  }

  return { step, status, search, forget, counts };
}

module.exports = {
  VectorStore, createOllamaEmbedder, createMeaningIndex,
  loopbackBase, checkModel, pageInput, fnv, sameModel,
  LIMITS, TEXT_CHARS, MIN_SCORE, DEFAULT_BASE_URL, VERSION,
};
