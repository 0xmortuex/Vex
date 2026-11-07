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
// Size: a request is counted as it streams. `out` is the request line (method +
// address) plus the headers the caller set plus the body; `in` is the bytes of
// the body as they arrive (or the content-length when the answer was compressed,
// which is what crossed the wire). Headers a platform adds itself (cookies, the
// user agent) and the answer's headers are not counted.
//
// Size of the list: MAX lines or MAX_AGE, whichever comes first. A chatty source
// (a poll, search suggestions) would fill it in about two weeks and push out the
// rare lines that matter (an update, Sync, a breach check), so:
//   * repeated requests of a chatty kind (news, fetch, other) to the same place
//     for the same feature share ONE line per clock hour, with a count `n`;
//   * the important kinds (ai, sync, update, breach, extension) are never merged:
//     every one keeps its own line;
//   * when the list is full the feature with the most lines gives up its oldest
//     line, so one feature can never evict the others (a fair share for each).
// The file stays version 1: `n`, `bad` and `t2` are optional fields on a line, a
// file written before them loads unchanged, and an older Vex ignores them.
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
const HOUR_MS = 3600 * 1000;
const ROLLED_KINDS = ['news', 'fetch', 'other'];
const SAVE_DELAY_MS = 3000;
// The honest label for a request whose caller did not name its feature and whose host the classifier does not know.
const OTHER_FEATURE = 'Other Vex request';

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
  try { u = new URL(String(url)); } catch { return { feature: OTHER_FEATURE, kind: 'other' }; }
  const host = u.hostname.toLowerCase();
  const p = u.pathname;
  if (host === 'api.pwnedpasswords.com') return { feature: 'Password breach check', kind: 'breach' };
  if (host.endsWith('.workers.dev') && /^\/sync(\/|$)/.test(p)) return { feature: 'Vex Sync', kind: 'sync' };
  if (host.endsWith('.workers.dev')) return { feature: 'Cloud AI', kind: 'ai' };
  if (host === 'open.er-api.com') return { feature: 'Currency rates', kind: 'fetch' };
  if (host === 'clients2.google.com' || host.endsWith('chromewebstore.google.com')) return { feature: 'Extension updates', kind: 'extension' };
  if (host === 'github.com' || host === 'api.github.com' || host.endsWith('.githubusercontent.com')) return { feature: 'GitHub download', kind: 'update' };
  return { feature: OTHER_FEATURE, kind: 'fetch' };
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

// Size of the request line and the headers the caller set, as written on the wire.
function requestHeadBytes(method, url, headers) {
  let n = Buffer.byteLength(String(method || 'GET').toUpperCase() + ' ' + String(url) + ' HTTP/1.1\r\n', 'utf8');
  const add = (k, v) => { n += Buffer.byteLength(String(k) + ': ' + String(v) + '\r\n', 'utf8'); };
  if (Array.isArray(headers)) { for (const h of headers) { if (Array.isArray(h) && h.length >= 2) add(h[0], h[1]); } }
  else if (headers && typeof headers.forEach === 'function') headers.forEach((v, k) => add(k, v));
  else if (headers && typeof headers === 'object') { for (const k of Object.keys(headers)) add(k, headers[k]); }
  return n;
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
        if (data && data.v === 1 && Array.isArray(data.entries)) entries = data.entries.filter(valid).sort((a, b) => a.t - b.t);
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
    if (entries.length <= max) return;
    // Full: the feature with the most lines gives up its oldest, one line at a time, so a chatty
    // feature loses its own history before any other feature loses a line.
    const byFeature = new Map();
    entries.forEach((e, i) => { const l = byFeature.get(e.feature); if (l) l.push(i); else byFeature.set(e.feature, [i]); });
    const heads = new Map([...byFeature.keys()].map(f => [f, 0]));
    const drop = new Set();
    let over = entries.length - max;
    while (over-- > 0) {
      let pick = null, pickLeft = -1;
      for (const [f, list] of byFeature) {
        const left = list.length - heads.get(f);
        // the larger share loses; on a tie the one whose oldest line is older
        if (left > pickLeft || (left === pickLeft && list[heads.get(f)] < byFeature.get(pick)[heads.get(pick)])) { pick = f; pickLeft = left; }
      }
      drop.add(byFeature.get(pick)[heads.get(pick)]);
      heads.set(pick, heads.get(pick) + 1);
    }
    entries = entries.filter((_, i) => !drop.has(i));
  }

  function save() {
    clearTimeout(timer);
    timer = null;
    if (!entries) return false;
    try {
      const tmp = file + '.tmp';
      // vex-allow-plain-write: written to a temp file and renamed over the original, which is never truncated
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
    let line = entry;
    if (ROLLED_KINDS.includes(k)) {
      // one line per feature + host + kind per clock hour, with a count and the summed sizes
      const bucket = Math.floor(entry.t / HOUR_MS);
      for (let i = entries.length - 1; i >= 0 && Math.floor(entries[i].t / HOUR_MS) >= bucket; i--) {
        const e = entries[i];
        if (Math.floor(e.t / HOUR_MS) !== bucket || e.feature !== f || e.host !== entry.host || e.kind !== k) continue;
        e.n = (e.n || 1) + 1;
        e.out += entry.out; e.in += entry.in;
        if (!entry.ok) { e.bad = (e.bad || 0) + 1; e.ok = false; }
        e.t2 = entry.t; e.status = entry.status;
        line = e;
        break;
      }
    }
    if (line === entry) entries.push(entry);
    prune();
    saveSoon();
    return line;
  }

  // Bytes that arrive after the line was written (a body that streams in).
  function addBytes(line, field, n) {
    if (!line || (field !== 'in' && field !== 'out') || !(n !== 0) || !Number.isFinite(n)) return;
    line[field] = Math.max(0, line[field] + Math.round(n));
    saveSoon();
  }
  function markFailed(line) {
    if (!line) return;
    if ((line.n || 1) > 1) line.bad = (line.bad || 0) + 1;
    line.ok = false;
    saveSoon();
  }

  // A fetch implementation that records what it does. `init.egress` ({ feature,
  // kind }) names the caller and is removed before the request goes out.
  function wrap(fetchImpl, defaults = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('wrap needs a fetch function');
    return async function egressFetch(url, init) {
      const hint = init && init.egress ? init.egress : null;
      let clean = init;
      if (hint) { clean = { ...init }; delete clean.egress; }
      const target = typeof url === 'string' ? url : (url && url.href) || String(url);
      const meta = { feature: (hint && hint.feature) || defaults.feature, kind: (hint && hint.kind) || defaults.kind, bytesOut: requestHeadBytes(clean && clean.method, target, clean && clean.headers) + bodyBytes(clean && clean.body) };
      let outbound;
      try { outbound = !isThisMachine(hostOf(target)); } catch { outbound = false; }   // file:, data: — not outbound
      if (!outbound) return fetchImpl(url, clean);
      let res;
      try { res = await fetchImpl(url, clean); }
      catch (err) {
        record({ ...meta, url: target, ok: false });
        throw err;
      }
      let declared = 0, encoded = false;
      try {
        declared = Number(res.headers && res.headers.get('content-length')) || 0;
        const enc = String((res.headers && res.headers.get('content-encoding')) || '').toLowerCase();
        encoded = !!enc && enc !== 'identity';
      } catch (err) { note('[Egress] the answer headers could not be read: ' + err.message); }
      const line = record({ ...meta, url: target, bytesIn: 0, ok: res.ok !== false, status: res.status });
      // No body to stream (a stand-in without one, or a 204/304): the declared length is all there is.
      if (!res.body || typeof res.body.getReader !== 'function' || typeof Response === 'undefined') {
        addBytes(line, 'in', declared);
        return res;
      }
      // Count the body as it streams: a pull-driven pass-through, so the consumer's pace is the
      // pace (nothing is buffered here) and a cancel reaches the real source.
      const reader = res.body.getReader();
      let counted = 0, done = false;
      const finish = (complete) => {
        if (done) return;
        done = true;
        // A compressed answer is counted as the caller sees it (decoded); the wire size is what left
        // the other side, so when it is known and the answer was read to the end it is the truer number.
        if (complete && encoded && declared > 0) addBytes(line, 'in', declared - counted);
        else if (!complete) markFailed(line);
        saveSoon();
      };
      const body = new ReadableStream({
        async pull(ctrl) {
          let part;
          try { part = await reader.read(); }
          catch (err) { finish(false); ctrl.error(err); return; }
          if (part.done) { finish(true); ctrl.close(); return; }
          const n = part.value && part.value.byteLength ? part.value.byteLength : 0;
          counted += n;
          addBytes(line, 'in', n);
          ctrl.enqueue(part.value);
        },
        cancel(reason) { finish(false); return reader.cancel(reason); },
      });
      let out;
      try { out = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }); }
      catch (err) {
        // A status a Response cannot carry (an opaque redirect): hand the original back untouched.
        note('[Egress] the body of ' + hostOf(target) + ' could not be counted: ' + err.message);
        reader.releaseLock();
        addBytes(line, 'in', declared);
        return res;
      }
      for (const name of ['url', 'redirected', 'type']) Object.defineProperty(out, name, { value: res[name] });
      return out;
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
        r.count += e.n || 1; r.out += e.out; r.in += e.in;
        m.set(e[key], r);
      }
      return [...m.values()].sort((a, b) => b.count - a.count);
    };
    return {
      sinceMs, count: rows.reduce((n, e) => n + (e.n || 1), 0),
      bytesOut: rows.reduce((n, e) => n + e.out, 0), bytesIn: rows.reduce((n, e) => n + e.in, 0),
      lastAt: rows.length ? (rows[0].t2 || rows[0].t) : 0,
      limits: { max, maxAgeDays: Math.round(maxAgeMs / DAY_MS) },
      byFeature: by('feature'), byHost: by('host'), byKind: by('kind'),
      nothingLeft: rows.length === 0,
      lines: entries.length,
      keptSince: entries.length ? entries[0].t : now(),
    };
  }

  function clear() {
    entries = [];
    return save();
  }

  return { record, addBytes, markFailed, wrap, list, summary, clear, flush: save, size: () => load().length, file };
}

// The one ledger main creates once it knows where to keep it, for modules that
// make their own requests (vault.js's breach check) and cannot be handed it.
let shared = null;
function setShared(ledger) { shared = ledger; }
function getShared() { return shared; }

module.exports = { createEgressLedger, classify, hostOf, isThisMachine, setShared, getShared, KINDS, MAX, MAX_AGE_MS, OTHER_FEATURE, ROLLED_KINDS, requestHeadBytes };
