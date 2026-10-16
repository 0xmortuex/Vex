// === What left this computer ================================================
//
// One bounded list of every request Vex ITSELF made to the internet: cloud AI,
// Vex Sync, the update feed, the news and rate fetches, the breach check,
// extension updates. Each line says WHEN, WHICH FEATURE, WHICH HOST, WHAT KIND
// and HOW MANY BYTES went out and came back. It never holds a path, a query
// string, a header or any part of a body: a line is enough to prove that
// something was sent, and not enough to learn what.
//
// Pages you browse are not in it. That traffic is yours, not Vex's.
//
// The ledger is itself sensitive (it says which hosts you used which feature
// with), so it is bounded two ways (MAX entries and MAX_AGE), kept in one file
// next to the other private files, and `clear()` forgets all of it.
//
// createEgressLedger({ file, fs, now, max, maxAgeMs, log }) is pure over fs and
// the clock so it can be tested without Electron.

const KINDS = ['ai', 'sync', 'update', 'news', 'breach', 'extension', 'fetch', 'other'];
const MAX = 2000;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const SAVE_DELAY_MS = 3000;

// The host of a URL and nothing else. Throws for something that is not a URL
// so a bad caller is seen, not recorded as "unknown".
function hostOf(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('Not a URL: ' + String(url).slice(0, 60)); }
  if (!/^(https?|wss?):$/.test(u.protocol)) throw new Error('Only network requests are recorded: ' + u.protocol);
  return u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

// What the request was for, when the call site did not say. Looks at the whole
// URL, then forgets everything but the host.
function classify(url) {
  let u;
  try { u = new URL(String(url)); } catch { return { feature: 'Vex', kind: 'other' }; }
  const host = u.hostname.toLowerCase();
  const p = u.pathname;
  if (host === 'api.pwnedpasswords.com') return { feature: 'Password breach check', kind: 'breach' };
  if (host.endsWith('.workers.dev') && /^\/sync(\/|$)/.test(p)) return { feature: 'Vex Sync', kind: 'sync' };
  if (host.endsWith('.workers.dev')) return { feature: 'Cloud AI', kind: 'ai' };
  if (host === 'open.er-api.com') return { feature: 'Currency rates', kind: 'fetch' };
  if (host === 'clients2.google.com' || host.endsWith('chromewebstore.google.com')) return { feature: 'Extension updates', kind: 'extension' };
  if (host === 'github.com' || host === 'api.github.com' || host.endsWith('.githubusercontent.com')) return { feature: 'GitHub download', kind: 'update' };
  return { feature: 'Vex', kind: 'fetch' };
}

// A request to this machine or the local network (Ollama, a dev server) did not
// leave the computer, so it is not on the list.
function isThisMachine(host) {
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function bodyBytes(body) {
  if (body == null) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (typeof body.byteLength === 'number') return body.byteLength;
  if (typeof body.size === 'number') return body.size;
  return 0;   // a stream: not known up front, and not guessed
}

function createEgressLedger({ file, fs, now = () => Date.now(), max = MAX, maxAgeMs = MAX_AGE_MS, log } = {}) {
  if (!file || !fs) throw new Error('createEgressLedger needs a file and fs');
  const note = typeof log === 'function' ? log : () => {};
  let entries = null;      // newest last
  let timer = null;

  function load() {
    if (entries) return entries;
    entries = [];
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { if (err && err.code !== 'ENOENT') note('[Egress] the ledger could not be read and is started again: ' + err.message); }
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && data.v === 1 && Array.isArray(data.entries)) entries = data.entries.filter(valid);
        else note('[Egress] the ledger file has an unknown shape and is started again');
      } catch (err) { note('[Egress] the ledger file is not readable and is started again: ' + err.message); }
    }
    prune();
    return entries;
  }

  function valid(e) {
    return e && Number.isFinite(e.t) && typeof e.host === 'string' && typeof e.feature === 'string' && KINDS.includes(e.kind);
  }

  function prune() {
    const cutoff = now() - maxAgeMs;
    if (entries.length && entries[0].t < cutoff) entries = entries.filter(e => e.t >= cutoff);
    if (entries.length > max) entries = entries.slice(entries.length - max);
  }

  function save() {
    clearTimeout(timer);
    timer = null;
    if (!entries) return false;
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, entries }));
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      note('[Egress] the ledger could not be saved: ' + err.message);
      return false;
    }
  }
  function saveSoon() {
    if (timer) return;
    timer = setTimeout(save, SAVE_DELAY_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  // One request. Everything is checked: a wrong kind is a bug at the call site.
  function record({ feature, url, kind, bytesOut = 0, bytesIn = 0, ok = true, status = 0 }) {
    const cls = classify(url);
    const k = kind || cls.kind;
    if (!KINDS.includes(k)) throw new Error('Unknown kind of outbound request: ' + k);
    const f = String(feature || cls.feature).slice(0, 60);
    const entry = {
      t: now(), feature: f, host: hostOf(url), kind: k,
      out: Math.max(0, Math.round(Number(bytesOut) || 0)),
      in: Math.max(0, Math.round(Number(bytesIn) || 0)),
      ok: !!ok, status: Number(status) || 0,
    };
    load();
    entries.push(entry);
    prune();
    saveSoon();
    return entry;
  }

  // A fetch implementation that records what it does. `init.egress` ({ feature,
  // kind }) names the caller and is removed before the request goes out.
  function wrap(fetchImpl, defaults = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('wrap needs a fetch function');
    return async function egressFetch(url, init) {
      const hint = init && init.egress ? init.egress : null;
      let clean = init;
      if (hint) { clean = { ...init }; delete clean.egress; }
      const meta = { feature: (hint && hint.feature) || defaults.feature, kind: (hint && hint.kind) || defaults.kind, bytesOut: bodyBytes(clean && clean.body) };
      const target = typeof url === 'string' ? url : (url && url.href) || String(url);
      let outbound;
      try { outbound = !isThisMachine(hostOf(target)); } catch { outbound = false; }   // file:, data: — not outbound
      if (!outbound) return fetchImpl(url, clean);
      let res;
      try { res = await fetchImpl(url, clean); }
      catch (err) {
        record({ ...meta, url: target, ok: false });
        throw err;
      }
      let inBytes;
      try { inBytes = Number(res.headers && res.headers.get('content-length')) || 0; } catch { inBytes = 0; }
      record({ ...meta, url: target, bytesIn: inBytes, ok: res.ok !== false, status: res.status });
      return res;
    };
  }

  function list({ sinceMs = 0, feature = '', host = '', kind = '', limit = 500 } = {}) {
    load();
    const from = sinceMs > 0 ? now() - sinceMs : 0;
    const out = [];
    for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = entries[i];
      if (e.t < from) break;
      if (feature && e.feature !== feature) continue;
      if (host && !e.host.includes(host)) continue;
      if (kind && e.kind !== kind) continue;
      out.push(e);
    }
    return out;
  }

  // The numbers the dashboard shows, and the proof line: nothing left in the
  // window when `count` is 0 (only true while the ledger has been running that
  // long, which `since` says).
  function summary({ sinceMs = DAY_MS } = {}) {
    load();
    const rows = list({ sinceMs, limit: max });
    const by = (key) => {
      const m = new Map();
      for (const e of rows) {
        const r = m.get(e[key]) || { name: e[key], count: 0, out: 0, in: 0 };
        r.count++; r.out += e.out; r.in += e.in;
        m.set(e[key], r);
      }
      return [...m.values()].sort((a, b) => b.count - a.count);
    };
    return {
      sinceMs, count: rows.length,
      bytesOut: rows.reduce((n, e) => n + e.out, 0), bytesIn: rows.reduce((n, e) => n + e.in, 0),
      lastAt: rows.length ? rows[0].t : 0,
      byFeature: by('feature'), byHost: by('host'), byKind: by('kind'),
      nothingLeft: rows.length === 0,
      keptSince: entries.length ? entries[0].t : now(),
    };
  }

  function clear() {
    entries = [];
    return save();
  }

  return { record, wrap, list, summary, clear, flush: save, size: () => load().length, file };
}

// The one ledger main creates once it knows where to keep it, for modules that
// make their own requests (vault.js's breach check) and cannot be handed it.
let shared = null;
function setShared(ledger) { shared = ledger; }
function getShared() { return shared; }

module.exports = { createEgressLedger, classify, hostOf, isThisMachine, setShared, getShared, KINDS, MAX, MAX_AGE_MS };
