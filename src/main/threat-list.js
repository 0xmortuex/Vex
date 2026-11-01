// === Known dangerous sites: a list kept on this computer, checked on this computer ===
//
// Like a browser's Safe Browsing, with one difference that matters: the page you are
// going to is NEVER sent anywhere. Vex downloads a public list of reported phishing and
// malware addresses (at most once a day, see threat-list-sources.js for which list and
// under which licence), keeps it as a compact set of hashes, and every web page address
// is looked up in that set in this process.
//
// The set is a sorted array of 53-bit hashes (8 bytes an address: about 3 MB for 400,000
// entries). 53 bits so a number holds a whole hash and a native typed-array sort works; a
// wrong match between two different names needs a hash collision, about 1 in 10^10 per
// name at this size. The file keeps no names: you cannot read the list back out of it.
//
// What is matched:
//   a domain      the host, or any parent of it ("a.b.example.com" matches "example.com")
//   an address    a list line with a path is an exact address (host + path + query)
//
// What is never matched:
//   this machine, the local network, IP addresses that are private, names with no dot
//   the sites that are in the "trusted" list the person made
//   the registered domains of the brands in web-safety-brands.js and the shared hosting
//   platforms below: a list line "sites.google.com" would otherwise block every Google
//   Site. (A line with a full address on such a host is still matched as that address.)
//
// createThreatList({ dir, fs, path, fetch, sources, now, log, hash })
//   dir    <userData>/threat-list
//   fetch  the public-only bounded fetch (https, no cookies, size and time caps, egress-ledger tag)

const crypto = require('crypto');
const { isPrivateHost, isIpLiteral } = require('../renderer/js/private-address');
const { registrable, BRANDS } = require('./web-safety');
const { SOURCES } = require('./threat-list-sources');

const MAGIC = 0x4c545856;              // "VXTL"
const HEADER = 16;
const DAY_MS = 24 * 3600 * 1000;
const RETRY_MS = 3600 * 1000;          // after a failed update, not again for an hour
const CONTINUE_LOG_MAX = 200;
const ALLOW_MAX = 500;
const TEST_HOST = 'vex-safety-test.invalid';

// Shared platforms where anyone makes a name (x.pages.dev). A list line that IS one of
// these would block every site on it. (The brands' own domains are handled by BRANDS.)
const SHARED_PARENTS = new Set([
  'pages.dev', 'workers.dev', 'github.io', 'githubusercontent.com', 'gitlab.io', 'vercel.app', 'netlify.app', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'appspot.com', 'weebly.com', 'weeblysite.com', 'wixsite.com', 'wix.com', 'blogspot.com', 'wordpress.com', 'webflow.io',
  'glitch.me', 'repl.co', 'replit.app', 'r2.dev', 'duckdns.org', 'ngrok.io', 'ngrok-free.app', 'azurewebsites.net', 'cloudfront.net',
  'amazonaws.com', 's3.amazonaws.com', 'storage.googleapis.com', 'googleusercontent.com', 'web.core.windows.net', 'blob.core.windows.net',
  '000webhostapp.com', 'sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.gle', 'notion.site', 'carrd.co', 'framer.app',
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rebrand.ly', 'linktr.ee', 'canva.com', 'typedream.app', 'surge.sh',
  'myshopify.com', 'square.site', 'godaddysites.com', 'jimdofree.com', 'yolasite.com', 'webnode.page', 'site123.me', 'strikingly.com',
]);
const BRAND_ROOTS = new Set(BRANDS);

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z][a-z0-9-]{1,62}$/;

// 53 bits of SHA-256 as one number. `ns` keeps a domain and an address apart.
function keyOf(ns, text) {
  const h = crypto.createHash('sha256').update(ns + ':' + text).digest();
  return (h.readUInt32BE(0) & 0x1fffff) * 4294967296 + h.readUInt32BE(4);
}
const urlKeyText = (u) => u.host + u.pathname + u.search;

// One line of a list -> { ns, text } or null (a comment, or something that is not an address).
function parseLine(raw) {
  const s = String(raw).trim().toLowerCase();
  if (!s || s[0] === '#' || /\s/.test(s)) return null;
  if (DOMAIN_RE.test(s)) return { ns: 'd', text: s };
  if (!s.includes('/') && !s.includes('?')) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : 'http://' + s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!DOMAIN_RE.test(u.hostname)) return null;
  if (u.pathname === '/' && !u.search) return { ns: 'd', text: u.hostname };
  return { ns: 'u', text: urlKeyText(u) };
}

// A domain line that must not become a block: a shared platform, or a brand's own domain.
function isProtectedDomain(host) {
  return SHARED_PARENTS.has(host) || BRAND_ROOTS.has(registrable(host));
}

function findKey(arr, k) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = arr[mid];
    if (v === k) return true;
    if (v < k) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// The names to look up for a host: itself, then each parent down to the registered domain.
function candidates(host) {
  const floor = registrable(host);
  const out = [host];
  let h = host;
  while (h !== floor && h.includes('.')) {
    h = h.slice(h.indexOf('.') + 1);
    out.push(h);
  }
  return out;
}

function createThreatList({ dir, fs, path, fetch, sources = SOURCES, now = () => Date.now(), log, hash = keyOf } = {}) {
  if (!dir || !fs || !path) throw new Error('createThreatList needs a folder, fs and path');
  const note = typeof log === 'function' ? log : () => {};
  const file = (n) => path.join(dir, n);
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };

  let keys = new Float64Array(0);
  let meta = null;                 // { fetchedAt, count, sources:[{id,count}] }
  let loaded = false;
  let loadError = '';
  let settings = { enabled: true, autoUpdate: true, allow: [] };
  let lastError = '';
  let lastAttempt = 0;
  let updating = null;
  const continues = [];            // newest last; private tabs' entries live here only

  // --- files ---------------------------------------------------------------------------

  function writeAtomic(name, data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file(name) + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file(name));
  }
  function readOptional(name, enc) {
    try { return fs.readFileSync(file(name), enc); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const s = readOptional('settings.json', 'utf8');
      if (s) {
        const d = JSON.parse(s);
        settings = { enabled: d.enabled !== false, autoUpdate: d.autoUpdate !== false, allow: Array.isArray(d.allow) ? d.allow.filter(h => typeof h === 'string').slice(0, ALLOW_MAX) : [] };
      }
      const c = readOptional('continues.json', 'utf8');
      if (c) { const d = JSON.parse(c); if (Array.isArray(d)) continues.push(...d.filter(e => e && typeof e.host === 'string' && Number.isFinite(e.t)).slice(-CONTINUE_LOG_MAX)); }
    } catch (err) {
      note('[ThreatList] the settings could not be read, defaults are used: ' + err.message);
      loadError = 'The settings file could not be read: ' + err.message;
    }
    try {
      const m = readOptional('list.json', 'utf8');
      const bin = m ? readOptional('list.bin') : null;
      if (m && bin) {
        const d = JSON.parse(m);
        need(bin.length >= HEADER && bin.readUInt32LE(0) === MAGIC, 'the list file is not a Vex safety list');
        const count = bin.readUInt32LE(8);
        need(bin.length === HEADER + count * 8, 'the list file has the wrong size');
        const arr = new Float64Array(count);
        Buffer.from(arr.buffer).set(bin.subarray(HEADER));
        keys = arr;
        meta = { fetchedAt: Number(d.fetchedAt) || 0, count, sources: Array.isArray(d.sources) ? d.sources : [] };
      }
    } catch (err) {
      note('[ThreatList] the saved list could not be read, it is empty until the next update: ' + err.message);
      loadError = 'The saved list could not be read: ' + err.message;
      keys = new Float64Array(0);
      meta = null;
    }
  }

  function saveSettings() {
    writeAtomic('settings.json', JSON.stringify({ v: 1, ...settings }));
  }

  // --- building a list -----------------------------------------------------------------

  // Text of one source -> { keys: number[], skipped }. Yields to the event loop so a 400,000 line
  // list does not freeze the window.
  async function ingest(text, out) {
    let skipped = 0;
    let from = 0;
    let n = 0;
    while (from <= text.length) {
      let to = text.indexOf('\n', from);
      if (to === -1) to = text.length;
      const line = text.slice(from, to).trim();
      from = to + 1;
      if (line && line[0] !== '#') {
        const entry = parseLine(line);
        if (!entry || (entry.ns === 'd' && isProtectedDomain(entry.text))) skipped++;
        else out.push(hash(entry.ns, entry.text));
      }
      if (++n % 20000 === 0) await new Promise(r => setImmediate(r));
    }
    return skipped;
  }

  async function runUpdate() {
    need(typeof fetch === 'function', 'This build cannot download the safety list');
    const merged = [];
    const parts = [];
    for (const src of sources) {
      const res = await fetch(src.url, { headers: { Accept: 'text/plain' }, credentials: 'omit', timeoutMs: 90000, maxBytes: src.maxBytes, egress: { feature: 'Safety list', kind: 'fetch' } });
      need(res.ok, src.name + ': the server answered ' + res.status);
      const text = await res.text();
      const before = merged.length;
      const skipped = await ingest(text, merged);
      const count = merged.length - before;
      need(count >= src.minEntries, src.name + ': the list has only ' + count + ' usable entries, so it was not used (the last good list is kept)');
      parts.push({ id: src.id, count, skipped });
    }
    // Sorted and without repeats. Float64Array.sort is numeric.
    const sorted = Float64Array.from(merged).sort();
    let n = 0;
    for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[n++] = sorted[i];
    const arr = sorted.slice(0, n);

    const bin = Buffer.alloc(HEADER + n * 8);
    bin.writeUInt32LE(MAGIC, 0); bin.writeUInt32LE(1, 4); bin.writeUInt32LE(n, 8);
    Buffer.from(arr.buffer, arr.byteOffset, n * 8).copy(bin, HEADER);
    // Both files are written before the new list is used: if the second write fails the old list stays in memory.
    writeAtomic('list.bin', bin);
    const fetchedAt = now();
    writeAtomic('list.json', JSON.stringify({ v: 1, fetchedAt, count: n, sources: parts }));
    keys = arr;
    meta = { fetchedAt, count: n, sources: parts };
    loadError = '';
    return status();
  }

  // Downloads the list now. One at a time. On any failure the last good list stays in use and the error is kept
  // for Settings and thrown to the caller.
  function update() {
    load();
    if (updating) return updating;
    lastAttempt = now();
    updating = runUpdate().then((s) => { lastError = ''; return s; }, (err) => { lastError = err.message; throw err; }).finally(() => { updating = null; });
    return updating;
  }

  // The background pass: at most once a day, never when the switch is off. Errors are logged, not thrown.
  async function maybeUpdate() {
    load();
    if (!settings.enabled || !settings.autoUpdate || updating) return false;
    const t = now();
    if (meta && t - meta.fetchedAt < DAY_MS) return false;
    if (lastAttempt && t - lastAttempt < RETRY_MS) return false;
    try { await update(); return true; }
    catch (err) { console.error('[ThreatList] the daily update failed, the last list is kept:', err.message); return false; }
  }

  // --- the check -------------------------------------------------------------------------

  function allowed(host) {
    return settings.allow.some(a => host === a || host.endsWith('.' + a));
  }

  // null, or { kind: 'domain' | 'address' | 'test', host, matched }
  function check(url) {
    load();
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/\.+$/, '');
    if (host === TEST_HOST) return { kind: 'test', host, matched: host };
    if (!settings.enabled || !keys.length) return null;
    if (isPrivateHost(host) || isIpLiteral(host.replace(/^\[|\]$/g, ''))) return null;
    if (allowed(host)) return null;
    if (findKey(keys, hash('u', urlKeyText(u)))) return { kind: 'address', host, matched: host + u.pathname };
    if (BRAND_ROOTS.has(registrable(host))) return null;
    for (const c of candidates(host)) {
      if (SHARED_PARENTS.has(c)) continue;
      if (findKey(keys, hash('d', c))) return { kind: 'domain', host, matched: c };
    }
    return null;
  }

  // --- the person's choices ----------------------------------------------------------------

  function cleanHost(h) {
    const s = String(h || '').trim().toLowerCase().replace(/\.+$/, '');
    need(DOMAIN_RE.test(s), 'That is not a site name');
    return s;
  }
  function setEnabled(on) { load(); settings.enabled = !!on; saveSettings(); return status(); }
  function setAutoUpdate(on) { load(); settings.autoUpdate = !!on; saveSettings(); return status(); }
  // A trusted site, kept on this computer. `persistent: false` (a private window) never writes it.
  function allowHost(host, { persistent = true } = {}) {
    load();
    const h = cleanHost(host);
    if (!persistent) return false;
    need(settings.allow.length < ALLOW_MAX || settings.allow.includes(h), 'The list of trusted sites is full');
    if (!settings.allow.includes(h)) { settings.allow.push(h); saveSettings(); }
    return true;
  }
  function forgetHost(host) {
    load();
    const h = cleanHost(host);
    settings.allow = settings.allow.filter(a => a !== h);
    saveSettings();
    return status();
  }

  // "Continue anyway" was chosen: the host and the time, nothing else (not the path, not which tab).
  // A private window's entry stays in memory and is gone at the next start.
  function logContinue(host, { persistent = true, kind = 'domain' } = {}) {
    load();
    const e = { t: now(), host: String(host).toLowerCase().slice(0, 253), kind, persistent: !!persistent };
    continues.push(e);
    while (continues.length > CONTINUE_LOG_MAX) continues.shift();
    console.log('[ThreatList] the person continued to ' + e.host + (persistent ? '' : ' (private window)'));
    if (persistent) writeAtomic('continues.json', JSON.stringify(continues.filter(c => c.persistent)));
    return e;
  }
  const continueLog = () => { load(); return continues.map(c => ({ ...c })); };

  function status() {
    load();
    return {
      enabled: settings.enabled,
      autoUpdate: settings.autoUpdate,
      count: meta ? meta.count : 0,
      bytes: keys.length * 8,
      fetchedAt: meta ? meta.fetchedAt : 0,
      sources: (meta ? meta.sources : []).map(p => {
        const s = sources.find(x => x.id === p.id);
        return { id: p.id, count: p.count, name: s ? s.name : p.id, licence: s ? s.licence : '', licenceUrl: s ? s.licenceUrl : '' };
      }),
      available: sources.map(s => ({ id: s.id, name: s.name, licence: s.licence, licenceUrl: s.licenceUrl })),
      updating: !!updating,
      lastError: lastError || loadError,
      allow: settings.allow.slice(),
      testHost: TEST_HOST,
    };
  }

  return { check, update, maybeUpdate, status, setEnabled, setAutoUpdate, allowHost, forgetHost, logContinue, continueLog, TEST_HOST };
}

module.exports = { createThreatList, parseLine, keyOf, TEST_HOST, SHARED_PARENTS };
