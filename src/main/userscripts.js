// === Userscripts: a small, safe ==UserScript== manager =====================
//
// Violentmonkey cannot run as an extension here (it needs chrome.userScripts),
// so Vex has its own, deliberately small one. This file is the part with no
// Electron in it, so every rule can be tested:
//
//   - the metadata-block parser (@name @match @include @exclude @grant
//     @connect @run-at ...),
//   - the match engine (@match patterns, @include/@exclude globs and /regex/),
//   - the places a script may NEVER run (not http(s), the sensitive-site list,
//     Tor / private / burner / routed / app-panel sessions),
//   - the stored scripts and their per-script values, all bounded,
//   - the permission checks behind the GM_* bridge (which grant an operation
//     needs, which hosts GM_xmlhttpRequest may reach).
//
// Nothing here reaches the network or the page. main.js wires the transport
// (a cookie-less session), the clipboard and notifications in; the page-side
// half is src/userscripts-preload.js.
'use strict';

const LIMITS = Object.freeze({
  maxScripts: 100,
  maxSourceBytes: 400 * 1024,
  maxValueKeys: 200,
  maxKeyLength: 128,
  maxValueBytes: 32 * 1024,
  maxTotalValueBytes: 256 * 1024,
  maxHeaderValue: 500,
  maxMulti: 100,
  maxUserHosts: 30,
  maxXhrBody: 5 * 1024 * 1024,
  maxXhrResponse: 20 * 1024 * 1024,
  xhrTimeoutMs: 30000,
  maxXhrTimeoutMs: 60000,
  maxClipboard: 100 * 1024,
  maxNotificationText: 400,
  notificationsPerMinute: 5,
  openTabsPerMinute: 3,
});

// The GM API subset, and the grant each operation needs. Anything else a
// script asks for is listed as unsupported in the install preview.
const OP_GRANT = Object.freeze({
  getValue: 'GM_getValue',
  setValue: 'GM_setValue',
  deleteValue: 'GM_deleteValue',
  listValues: 'GM_listValues',
  addStyle: 'GM_addStyle',
  xhr: 'GM_xmlhttpRequest',
  clipboard: 'GM_setClipboard',
  notification: 'GM_notification',
  openTab: 'GM_openInTab',
  info: 'GM_info',
  log: 'GM_log',
});
const SUPPORTED_GRANTS = new Set([...Object.values(OP_GRANT), 'unsafeWindow']);

const RUN_AT = Object.freeze({
  'document-start': 'start',
  'document-body': 'end',
  'document-end': 'end',
  'document-idle': 'idle',
});

// Sites a script is never injected into unless the person adds that host to
// that script by name: money, mail and identity. A userscript with a broad
// @match must not be able to read a bank page just because the pattern said *.
const SENSITIVE_SUFFIXES = [
  // payments and banks
  'paypal.com', 'paypal.me', 'stripe.com', 'wise.com', 'venmo.com', 'cash.app', 'revolut.com', 'klarna.com',
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'capitalone.com',
  'americanexpress.com', 'hsbc.com', 'barclays.co.uk', 'lloydsbank.com', 'natwest.com', 'santander.com',
  'ing.com', 'ing.nl', 'ing.de', 'sparkasse.de', 'commerzbank.de', 'bnpparibas.com', 'creditagricole.fr',
  'garantibbva.com.tr', 'isbank.com.tr', 'akbank.com', 'ziraatbank.com.tr', 'yapikredi.com.tr', 'qnbfinansbank.com',
  'wellsfargo.com', 'usbank.com', 'schwab.com', 'fidelity.com', 'vanguard.com', 'etrade.com', 'robinhood.com',
  'interactivebrokers.com', 'coinbase.com', 'binance.com', 'kraken.com', 'bitfinex.com', 'okx.com', 'bybit.com',
  'metamask.io', 'blockchain.com', 'ledger.com', 'trezor.io',
  // mail and identity
  'accounts.google.com', 'mail.google.com', 'myaccount.google.com', 'login.live.com', 'outlook.com',
  'outlook.office.com', 'outlook.office365.com', 'account.microsoft.com', 'login.microsoftonline.com',
  'appleid.apple.com', 'icloud.com', 'proton.me', 'protonmail.com', 'login.yahoo.com', 'mail.yahoo.com',
  'fastmail.com', 'tutanota.com', 'tuta.com', 'accounts.firefox.com', 'id.atlassian.com', 'okta.com', 'auth0.com',
  // password managers
  '1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'keepersecurity.com', 'nordpass.com',
  // government and health
  'gov', 'gov.uk', 'gov.tr', 'gov.au', 'gov.ca', 'gc.ca', 'europa.eu', 'mil', 'irs.gov', 'e-devlet.gov.tr',
];
// A sign-in, payment or account label on any host is the same kind of page.
const SENSITIVE_LABELS = new Set(['login', 'signin', 'sign-in', 'accounts', 'secure', 'sso', 'auth', 'checkout', 'pay', 'payments', 'banking', 'netbank', 'ebanking', 'onlinebanking', 'bank']);

const HOST_RE = /^(?:\*|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/;

function isIpLiteral(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || (host.includes(':') && /^[0-9a-f:.]+$/i.test(host));
}
function isLocalOrPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/i.test(h) || /^fe[89ab]/i.test(h) || /^::ffff:/i.test(h);
  return false;
}

function isSensitiveHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  for (const s of SENSITIVE_SUFFIXES) if (h === s || h.endsWith('.' + s)) return true;
  const labels = h.split('.');
  // The registrable part is never judged by its label ("pay.example" is a
  // payment page, "login" alone is not a host), so look at the subdomains.
  for (let i = 0; i < labels.length - 1; i++) if (SENSITIVE_LABELS.has(labels[i])) return true;
  return false;
}

// --- the metadata block ----------------------------------------------------
function parseMetadata(source) {
  const errors = [];
  const warnings = [];
  if (typeof source !== 'string' || !source.trim()) return { ok: false, errors: ['The script is empty'], warnings, meta: null };
  if (Buffer.byteLength(source, 'utf8') > LIMITS.maxSourceBytes) {
    return { ok: false, errors: ['The script is larger than ' + Math.round(LIMITS.maxSourceBytes / 1024) + ' KB'], warnings, meta: null };
  }
  const block = source.match(/(?:^|\n)[ \t]*\/\/[ \t]*==UserScript==[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\/\/[ \t]*==\/UserScript==/);
  if (!block) return { ok: false, errors: ['No // ==UserScript== header found'], warnings, meta: null };
  const meta = {
    name: '', namespace: '', version: '', description: '', author: '',
    matches: [], includes: [], excludes: [], excludeMatches: [], grants: [], connects: [],
    runAt: 'document-idle', noframes: false, updateURL: '', downloadURL: '', requires: [], resources: [],
    unsupportedGrants: [], unsupportedKeys: [],
  };
  const multi = (arr, value, key) => {
    if (arr.length >= LIMITS.maxMulti) { warnings.push('More than ' + LIMITS.maxMulti + ' @' + key + ' lines; the rest are ignored'); return; }
    arr.push(value);
  };
  for (const raw of block[1].split(/\r?\n/)) {
    const line = raw.match(/^[ \t]*\/\/[ \t]*@([A-Za-z][\w:-]*)(?:[ \t]+(.*?))?[ \t]*$/);
    if (!line) continue;
    const key = line[1];
    const value = (line[2] || '').trim();
    if (value.length > LIMITS.maxHeaderValue) { errors.push('@' + key + ' is longer than ' + LIMITS.maxHeaderValue + ' characters'); continue; }
    switch (key) {
      case 'name': meta.name = value; break;
      case 'namespace': meta.namespace = value; break;
      case 'version': meta.version = value; break;
      case 'description': meta.description = value; break;
      case 'author': meta.author = value; break;
      case 'match': multi(meta.matches, value, key); break;
      case 'include': multi(meta.includes, value, key); break;
      case 'exclude': multi(meta.excludes, value, key); break;
      case 'exclude-match': multi(meta.excludeMatches, value, key); break;
      case 'grant': multi(meta.grants, value, key); break;
      case 'connect': multi(meta.connects, value.toLowerCase(), key); break;
      case 'run-at': meta.runAt = value; break;
      case 'noframes': meta.noframes = true; break;
      case 'updateURL': meta.updateURL = value; break;
      case 'downloadURL': meta.downloadURL = value; break;
      case 'require': multi(meta.requires, value, key); break;
      case 'resource': multi(meta.resources, value, key); break;
      case 'icon': case 'icon64': case 'iconURL': case 'homepage': case 'homepageURL': case 'website': case 'source':
      case 'supportURL': case 'copyright': case 'license': case 'antifeature': case 'unwrap': case 'sandbox': case 'inject-into':
        break;
      default:
        // @name:tr and friends are translations, not unknown keys.
        if (!/^(?:name|description):[\w-]+$/.test(key) && !meta.unsupportedKeys.includes(key)) meta.unsupportedKeys.push(key);
    }
  }
  if (!meta.name) errors.push('The script has no @name');
  if (meta.name.length > 120) errors.push('@name is longer than 120 characters');
  if (meta.version.length > 40) errors.push('@version is longer than 40 characters');
  if (!Object.hasOwn(RUN_AT, meta.runAt)) errors.push('@run-at ' + meta.runAt + ' is not supported (use document-start, document-end or document-idle)');
  for (const p of meta.matches.concat(meta.excludeMatches)) if (!parseMatchPattern(p)) errors.push('@match pattern is not valid: ' + p.slice(0, 120));
  for (const p of meta.includes.concat(meta.excludes)) if (!compileGlobOrRegex(p)) errors.push('@include/@exclude pattern is not valid: ' + p.slice(0, 120));
  for (const c of meta.connects) {
    if (c === '*' || c === 'self' || c === 'localhost' || isIpLiteral(c) || HOST_RE.test(c)) continue;
    errors.push('@connect ' + c.slice(0, 80) + ' is not a host name');
  }
  // GM.getValue style grants are the same operations.
  const grants = [];
  for (const g of meta.grants) {
    const name = g.startsWith('GM.') ? 'GM_' + g.slice(3) : g;
    if (name === 'none') continue;
    const canonical = name === 'GM_xmlHttpRequest' ? 'GM_xmlhttpRequest' : name;
    if (SUPPORTED_GRANTS.has(canonical)) { if (!grants.includes(canonical)) grants.push(canonical); }
    else if (!meta.unsupportedGrants.includes(g)) meta.unsupportedGrants.push(g);
  }
  meta.grants = grants;
  if (meta.requires.length) warnings.push('@require files are not downloaded; the script may not work');
  if (meta.resources.length) warnings.push('@resource files are not supported');
  if (meta.unsupportedGrants.length) warnings.push('Not supported here, and left out: ' + meta.unsupportedGrants.join(', '));
  if (grants.includes('GM_xmlhttpRequest') && !meta.connects.length) warnings.push('It asks for GM_xmlhttpRequest but declares no @connect, so it cannot contact any site');
  return { ok: errors.length === 0, errors, warnings, meta };
}

// --- match engine ----------------------------------------------------------
function escapeRegex(text) { return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }

// A Chrome-style match pattern -> {scheme, host, path} or null.
function parseMatchPattern(pattern) {
  const p = String(pattern || '').trim();
  if (p === '<all_urls>') return { scheme: 'http*', host: '*', path: /^\/.*$/ };
  const m = p.match(/^(\*|https?|http\*):\/\/([^/]*)(\/.*)$/);
  if (!m) return null;
  const [, scheme, host, path] = m;
  if (!HOST_RE.test(host.replace(/^\*\./, '')) && host !== '*') return null;
  if (host.includes('*') && host !== '*' && !/^\*\.[^*]+$/.test(host)) return null;
  const pathRe = new RegExp('^' + path.split('*').map(escapeRegex).join('.*') + '$');
  return { scheme, host: host.toLowerCase(), path: pathRe };
}

function matchesPattern(parsed, url) {
  if (!parsed) return false;
  const proto = url.protocol.replace(':', '');
  if (proto !== 'http' && proto !== 'https') return false;
  if (!(parsed.scheme === '*' || parsed.scheme === 'http*' || parsed.scheme === proto)) return false;
  const host = url.hostname.toLowerCase();
  if (parsed.host !== '*') {
    if (parsed.host.startsWith('*.')) {
      const base = parsed.host.slice(2);
      if (host !== base && !host.endsWith('.' + base)) return false;
    } else if (host !== parsed.host) return false;
  }
  return parsed.path.test(url.pathname + url.search);
}

// @include / @exclude: a glob ("*" is any run) or /regex/flags. Returns a
// RegExp or null. Globs are case-insensitive, as in Tampermonkey.
function compileGlobOrRegex(pattern) {
  const p = String(pattern || '').trim();
  if (!p) return null;
  const rx = p.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (rx) return new RegExp(rx[1], rx[2].replace(/g|y/g, ''));
    return new RegExp('^' + p.split('*').map(escapeRegex).join('.*') + '$', 'i');
  } catch { return null; }
}

function parseUrl(url) {
  try { return new URL(String(url)); } catch { return null; }
}
function isWebUrl(url) {
  const u = typeof url === 'string' ? parseUrl(url) : url;
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
}

// A host the person added to a script by name: exact or a parent domain.
function userHostCovers(userHosts, host) {
  const h = String(host).toLowerCase();
  return (userHosts || []).some(u => h === u || h.endsWith('.' + u));
}

// Would this script run on this page? `script` is a stored entry.
function scriptMatches(script, urlString) {
  const url = parseUrl(urlString);
  if (!isWebUrl(url)) return false;
  const meta = script.meta;
  const host = url.hostname.toLowerCase();
  const userHost = userHostCovers(script.userHosts, host);
  if (isSensitiveHost(host) && !userHost) return false;
  const href = url.href.split('#')[0];
  for (const p of meta.excludeMatches) if (matchesPattern(parseMatchPattern(p), url)) return false;
  for (const p of meta.excludes) { const re = compileGlobOrRegex(p); if (re && re.test(href)) return false; }
  if (userHost) return true;
  for (const p of meta.matches) if (matchesPattern(parseMatchPattern(p), url)) return true;
  for (const p of meta.includes) { const re = compileGlobOrRegex(p); if (re && re.test(href)) return true; }
  return false;
}

// --- which tabs may ever run a script --------------------------------------
// `partition` is the tab's session partition. Only the main browsing session
// and the named containers qualify: never a private window, an off-the-record
// or burner tab, a Tor tab, a site-routed session, or an app panel (Discord,
// Spotify ...). A container whose own route is Tor or a proxy is refused too.
function tabAllowed({ partition, tor = false, routed = false } = {}) {
  if (tor || routed) return false;
  const p = String(partition || '');
  if (p === 'persist:main') return true;
  return /^persist:container-[\w-]+$/.test(p);
}

// --- GM_xmlhttpRequest's allow-list -----------------------------------------
function connectAllowed(script, targetUrl, pageUrl) {
  const url = parseUrl(targetUrl);
  if (!isWebUrl(url)) return { ok: false, reason: 'Only http and https addresses can be requested' };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const entries = script.meta.connects;
  const page = parseUrl(pageUrl);
  const pageHost = page ? page.hostname.toLowerCase() : '';
  for (const e of entries) {
    if (e === '*') continue;
    if (e === 'self') { if (pageHost && (host === pageHost || host.endsWith('.' + pageHost))) return { ok: true }; continue; }
    if (isIpLiteral(e) || e === 'localhost') { if (host === e) return { ok: true }; continue; }
    if (host === e || host.endsWith('.' + e)) return { ok: true };
  }
  if (entries.includes('*') && script.anyHost === true) {
    if (isLocalOrPrivateHost(host)) return { ok: false, reason: host + ' is on this computer or its network; a script has to name such a host in @connect' };
    return { ok: true };
  }
  return { ok: false, reason: host + ' is not in this script\'s @connect list' };
}

// --- versions ---------------------------------------------------------------
function compareVersions(a, b) {
  const parts = (v) => String(v || '').split(/[.\-+_ ]+/).filter(Boolean).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] === undefined ? 0 : pa[i], y = pb[i] === undefined ? 0 : pb[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

// --- what each permission lets a script do, in plain words (Wave 5, T3-120) -----
// -> [{ id, says, risk: 'low' | 'medium' | 'high' }]. "High" is a power that can move what the page shows
// or what you copy somewhere else, or reach into the page's own scripts. A script with a high power that is
// installed without the person having been shown this list (reviewed !== true) is installed switched OFF,
// and the Turn on button shows the list first, so the first run is always after a look.
const GRANT_WORDS = Object.freeze({
  GM_getValue: ['low', 'keeps small notes for itself, on this computer'],
  GM_setValue: ['low', 'keeps small notes for itself, on this computer'],
  GM_deleteValue: ['low', 'deletes its own saved notes'],
  GM_listValues: ['low', 'lists its own saved notes'],
  GM_addStyle: ['low', 'changes how the page looks'],
  GM_info: ['low', 'reads its own name and version'],
  GM_log: ['low', 'writes to the developer console'],
  GM_notification: ['medium', 'shows desktop notifications (at most 5 a minute)'],
  GM_openInTab: ['medium', 'opens new tabs (at most 3 a minute)'],
  GM_setClipboard: ['high', 'replaces what is on your clipboard'],
  GM_xmlhttpRequest: ['high', 'sends requests from your computer'],
  unsafeWindow: ['high', "reads and changes the page's own JavaScript, so it sees everything the page sees"],
});
function grantReview(meta) {
  const out = [];
  for (const g of meta.grants) {
    const w = GRANT_WORDS[g];
    if (!w) continue;
    let says = w[1];
    if (g === 'GM_xmlhttpRequest') {
      says = meta.connects.length
        ? (meta.connects.includes('*') ? 'sends requests to ANY site you could name, so what the page shows can be sent anywhere' : 'sends requests, but only to: ' + meta.connects.join(', '))
        : 'asks to send requests but names no site, so it cannot reach any';
    }
    out.push({ id: g, says, risk: g === 'GM_xmlhttpRequest' && !meta.connects.length ? 'low' : w[0] });
  }
  if (meta.requires && meta.requires.length) out.push({ id: '@require', says: 'wants ' + meta.requires.length + ' outside file' + (meta.requires.length === 1 ? '' : 's') + ' (@require) that Vex does not download, so it may not work', risk: 'medium' });
  return out;
}
const hasHighPower = (meta) => grantReview(meta).some(r => r.risk === 'high');
// A power the old copy did not have.
const gainsHighPower = (meta, previousMeta) => {
  const had = new Set(previousMeta ? grantReview(previousMeta).filter(r => r.risk === 'high').map(r => r.id) : []);
  return grantReview(meta).some(r => r.risk === 'high' && !had.has(r.id));
};

// --- the preview an install or an update shows ------------------------------
function describe(parsed, { previous = null } = {}) {
  const m = parsed.meta;
  const lines = [];
  lines.push((m.name || '(no name)') + (m.version ? '  v' + m.version : '') + (m.author ? '  by ' + m.author : ''));
  if (m.description) lines.push(m.description);
  const sites = m.matches.concat(m.includes);
  lines.push('Runs on: ' + (sites.length ? sites.slice(0, 8).join(', ') + (sites.length > 8 ? ' and ' + (sites.length - 8) + ' more' : '') : 'no site until you add one'));
  if (m.excludes.length || m.excludeMatches.length) lines.push('Never on: ' + m.excludes.concat(m.excludeMatches).slice(0, 6).join(', '));
  lines.push('Runs: ' + m.runAt);
  lines.push('Permissions: ' + (m.grants.length ? m.grants.join(', ') : 'none (it runs inside the page and gets no GM_ functions)'));
  if (m.connects.length) lines.push('Can contact: ' + m.connects.join(', '));
  else if (m.grants.includes('GM_xmlhttpRequest')) lines.push('Can contact: no site');
  if (m.connects.includes('*')) lines.push('WARNING: it asks to contact ANY site.');
  const review = grantReview(m);
  if (review.length) {
    lines.push('What each permission lets it do:');
    for (const r of review) lines.push('  ' + (r.risk === 'high' ? '[high] ' : r.risk === 'medium' ? '[medium] ' : '') + r.id + ': ' + r.says);
  }
  if (previous) {
    const added = (a, b) => a.filter(x => !b.includes(x));
    const pm = previous.meta;
    const more = [];
    for (const g of added(m.grants, pm.grants)) more.push('new permission ' + g);
    for (const c of added(m.connects, pm.connects)) more.push('new site ' + c);
    for (const s of added(m.matches.concat(m.includes), pm.matches.concat(pm.includes))) more.push('new page pattern ' + s);
    if (more.length) lines.push('CHANGED since your copy: ' + more.join('; '));
  }
  for (const w of parsed.warnings) lines.push('Note: ' + w);
  return lines;
}

// --- the service ------------------------------------------------------------
function randomId(crypto) { return 'us-' + crypto.randomBytes(8).toString('hex'); }

function createUserscripts({ store, key = 'userscripts', log = console, crypto = require('crypto'), now = () => Date.now(), flushDelayMs = 400 } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') throw new Error('createUserscripts needs a store');
  let state = { v: 1, enabled: true, scripts: [] };
  let timer = null;
  let flushing = Promise.resolve();
  const notices = new Map(); // `${id}:${kind}` -> [timestamps], for rate limits

  // A stored entry is trusted for what the person chose, never for what a file
  // says about the script: the header is parsed again from the source each time.
  function revive(entry) {
    if (!entry || typeof entry !== 'object' || typeof entry.source !== 'string') return null;
    const parsed = parseMetadata(entry.source);
    if (!parsed.ok) { log.warn && log.warn('[Userscripts] dropped a stored script that no longer parses:', parsed.errors[0]); return null; }
    const userHosts = Array.isArray(entry.userHosts)
      ? entry.userHosts.filter(h => typeof h === 'string' && HOST_RE.test(h) && h !== '*').map(h => h.toLowerCase()).slice(0, LIMITS.maxUserHosts)
      : [];
    const values = {};
    let total = 0;
    if (entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values)) {
      for (const [k, v] of Object.entries(entry.values)) {
        if (typeof k !== 'string' || k.length > LIMITS.maxKeyLength || Object.keys(values).length >= LIMITS.maxValueKeys) continue;
        const size = k.length + JSON.stringify(v === undefined ? null : v).length;
        if (size > LIMITS.maxValueBytes || total + size > LIMITS.maxTotalValueBytes) continue;
        values[k] = v;
        total += size;
      }
    }
    return {
      id: typeof entry.id === 'string' && /^us-[0-9a-f]{16}$/.test(entry.id) ? entry.id : randomId(crypto),
      source: entry.source,
      meta: parsed.meta,
      enabled: entry.enabled !== false,
      anyHost: entry.anyHost === true && parsed.meta.connects.includes('*'),
      userHosts,
      sourceUrl: typeof entry.sourceUrl === 'string' && isWebUrl(entry.sourceUrl) ? entry.sourceUrl.slice(0, 2000) : '',
      slot: Number.isInteger(entry.slot) && entry.slot > 0 && entry.slot < 900 ? entry.slot : 0,
      installedAt: Number(entry.installedAt) || now(),
      updatedAt: Number(entry.updatedAt) || now(),
      values,
    };
  }
  function assignSlots() {
    const used = new Set();
    for (const s of state.scripts) { if (s.slot && !used.has(s.slot)) used.add(s.slot); else s.slot = 0; }
    for (const s of state.scripts) {
      if (s.slot) continue;
      let n = 1; while (used.has(n)) n++;
      s.slot = n; used.add(n);
    }
  }
  function adopt(raw) {
    const next = { v: 1, enabled: true, scripts: [] };
    if (raw && typeof raw === 'object') {
      next.enabled = raw.enabled !== false;
      if (Array.isArray(raw.scripts)) {
        const seen = new Set();
        for (const entry of raw.scripts.slice(0, LIMITS.maxScripts)) {
          const s = revive(entry);
          if (s && !seen.has(s.id)) { seen.add(s.id); next.scripts.push(s); }
        }
      }
    }
    state = next;
    assignSlots();
  }
  function serialise() {
    return {
      v: 1, enabled: state.enabled,
      scripts: state.scripts.map(s => ({ id: s.id, source: s.source, enabled: s.enabled, anyHost: s.anyHost, userHosts: s.userHosts, sourceUrl: s.sourceUrl, slot: s.slot, installedAt: s.installedAt, updatedAt: s.updatedAt, values: s.values })),
    };
  }
  function flushNow() {
    if (timer) { clearTimeout(timer); timer = null; }
    const data = serialise();
    flushing = flushing.catch(() => {}).then(() => store.write(key, data));
    return flushing;
  }
  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushNow().catch(err => log.error && log.error('[Userscripts] could not save the values:', err && err.message));
    }, flushDelayMs);
    if (timer.unref) timer.unref();
  }
  const byId = (id) => {
    const s = state.scripts.find(x => x.id === id);
    if (!s) throw new Error('That userscript is not installed');
    return s;
  };
  const valueBytes = (s) => Object.entries(s.values).reduce((n, [k, v]) => n + k.length + JSON.stringify(v === undefined ? null : v).length, 0);

  const api = {
    LIMITS,
    async load() { adopt(await store.read(key)); return api.list(); },
    // After a backup restore wrote the file behind our back.
    // trusted:false is a file that came from somewhere else (a restored backup):
    // a script that is not exactly as it was in memory comes back switched off,
    // so nothing starts running on a site without the person turning it on.
    async reload({ trusted = true } = {}) {
      await flushing.catch(() => {});
      const before = new Map(state.scripts.map(s => [s.id, s]));
      const list = await api.load();
      if (!trusted) {
        let changed = 0;
        for (const s of state.scripts) {
          const was = before.get(s.id);
          if (s.enabled && !(was && was.source === s.source && was.enabled)) { s.enabled = false; changed++; }
        }
        if (changed) await flushNow();
        return api.list();
      }
      return list;
    },
    flush: flushNow,
    get globalEnabled() { return state.enabled; },

    // What Settings shows. No source, no values.
    list() {
      return {
        enabled: state.enabled,
        limits: { maxScripts: LIMITS.maxScripts },
        scripts: state.scripts.map(s => ({
          id: s.id, name: s.meta.name, version: s.meta.version, description: s.meta.description, author: s.meta.author,
          enabled: s.enabled, runAt: s.meta.runAt, matches: s.meta.matches.concat(s.meta.includes), excludes: s.meta.excludes.concat(s.meta.excludeMatches),
          grants: s.meta.grants, connects: s.meta.connects, anyHost: s.anyHost, userHosts: s.userHosts, sourceUrl: s.sourceUrl,
          review: grantReview(s.meta),
          updateUrl: s.meta.updateURL || s.meta.downloadURL || s.sourceUrl || '',
          valueCount: Object.keys(s.values).length, valueBytes: valueBytes(s), installedAt: s.installedAt, updatedAt: s.updatedAt,
          sourceBytes: Buffer.byteLength(s.source, 'utf8'),
        })),
      };
    },

    preview(source, { replaceId = '' } = {}) {
      const parsed = parseMetadata(source);
      if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
      const m = parsed.meta;
      const existing = replaceId ? state.scripts.find(s => s.id === replaceId)
        : state.scripts.find(s => s.meta.name === m.name && s.meta.namespace === m.namespace);
      return {
        ok: true, errors: [], warnings: parsed.warnings,
        meta: m, lines: describe(parsed, { previous: existing || null }),
        wantsAnyHost: m.connects.includes('*') && m.grants.includes('GM_xmlhttpRequest'),
        review: grantReview(m), highPower: hasHighPower(m),
        replaces: existing ? { id: existing.id, version: existing.meta.version, name: existing.meta.name } : null,
        older: !!(existing && existing.meta.version && m.version && compareVersions(m.version, existing.meta.version) < 0),
        sameVersion: !!(existing && existing.source === source),
      };
    },

    async install({ source, anyHost = false, sourceUrl = '', replaceId = '', reviewed = false } = {}) {
      const parsed = parseMetadata(source);
      if (!parsed.ok) throw new Error('Not installed: ' + parsed.errors[0]);
      const m = parsed.meta;
      let existing = replaceId ? state.scripts.find(s => s.id === replaceId) : state.scripts.find(s => s.meta.name === m.name && s.meta.namespace === m.namespace);
      if (replaceId && !existing) throw new Error('The script to update is no longer installed');
      if (!existing && state.scripts.length >= LIMITS.maxScripts) throw new Error('You already have ' + LIMITS.maxScripts + ' userscripts; delete one first');
      const wantsAny = m.connects.includes('*') && m.grants.includes('GM_xmlhttpRequest');
      const entry = revive({
        id: existing ? existing.id : '', source, enabled: true, anyHost: anyHost === true && wantsAny,
        userHosts: existing ? existing.userHosts : [], sourceUrl: sourceUrl || (existing ? existing.sourceUrl : ''),
        slot: existing ? existing.slot : 0, installedAt: existing ? existing.installedAt : now(), updatedAt: now(),
        values: existing ? existing.values : {},
      });
      if (!entry) throw new Error('Not installed: the script could not be read');
      // An update never keeps a "contact any site" approval the person did not give again.
      if (existing) { if (!(anyHost === true && wantsAny)) entry.anyHost = false; entry.enabled = existing.enabled; }
      // First run only after a look: a script (or an update) that brings a high power in without the person
      // having been shown the permission list is installed switched off. The Turn on button shows the list.
      let held = false;
      if (reviewed !== true && gainsHighPower(m, existing ? existing.meta : null)) { entry.enabled = false; held = true; }
      if (existing) state.scripts[state.scripts.indexOf(existing)] = entry; else state.scripts.push(entry);
      assignSlots();
      await flushNow();
      return { id: entry.id, name: m.name, replaced: !!existing, held };
    },

    async setEnabled(id, on) { byId(id).enabled = !!on; await flushNow(); return true; },
    async setGlobalEnabled(on) { state.enabled = !!on; await flushNow(); return true; },
    async remove(id) {
      const s = byId(id);
      state.scripts.splice(state.scripts.indexOf(s), 1);
      await flushNow();
      return true;
    },
    async setUserHosts(id, hosts) {
      const s = byId(id);
      if (!Array.isArray(hosts) || hosts.length > LIMITS.maxUserHosts) throw new Error('At most ' + LIMITS.maxUserHosts + ' sites per script');
      const clean = [];
      for (const raw of hosts) {
        const h = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        if (!h || !HOST_RE.test(h) || h === '*' || !h.includes('.')) throw new Error('"' + String(raw).slice(0, 60) + '" is not a site name such as example.com');
        if (!clean.includes(h)) clean.push(h);
      }
      s.userHosts = clean;
      await flushNow();
      return clean;
    },
    async clearValues(id) { byId(id).values = {}; await flushNow(); return true; },

    // The scripts to inject into this page, in install order. `eligible` is
    // main's verdict on the tab itself (tabAllowed).
    matching(url, { eligible = false, topFrame = true } = {}) {
      if (!state.enabled || !eligible || !topFrame || !isWebUrl(url)) return [];
      return state.scripts.filter(s => s.enabled && scriptMatches(s, url));
    },
    get(id) { return byId(id); },

    // What the preload is given for one script.
    payload(s, pageUrl) {
      const m = s.meta;
      return {
        id: s.id, slot: s.slot, name: m.name, runAt: RUN_AT[m.runAt], mode: m.grants.length ? 'gm' : 'page',
        grants: m.grants, source: s.source, values: s.values,
        info: { script: { name: m.name, namespace: m.namespace, version: m.version, description: m.description, author: m.author, grant: m.grants.slice(), matches: m.matches.slice(), includes: m.includes.slice(), excludes: m.excludes.slice(), 'run-at': m.runAt, connect: m.connects.slice() }, scriptHandler: 'Vex', version: '1', pageUrl },
      };
    },

    // --- the GM bridge's permission checks --------------------------------
    requireGrant(s, op) {
      const needed = OP_GRANT[op];
      if (!needed) throw new Error('Unknown userscript operation');
      if (needed === 'GM_info' || needed === 'GM_log') return;
      if (!s.meta.grants.includes(needed)) throw new Error('This script did not ask for ' + needed + ' in @grant');
    },
    checkConnect(s, targetUrl, pageUrl) { return connectAllowed(s, targetUrl, pageUrl); },
    rate(s, kind, perMinute) {
      const k = s.id + ':' + kind;
      const t = now();
      const list = (notices.get(k) || []).filter(x => t - x < 60000);
      if (list.length >= perMinute) { notices.set(k, list); return false; }
      list.push(t);
      notices.set(k, list);
      return true;
    },
    async setValue(id, name, value) {
      const s = byId(id);
      api.requireGrant(s, 'setValue');
      if (typeof name !== 'string' || !name || name.length > LIMITS.maxKeyLength) throw new Error('A value name must be 1-' + LIMITS.maxKeyLength + ' characters');
      if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('That value name is not allowed');
      let encoded;
      try { encoded = JSON.stringify(value === undefined ? null : value); } catch { throw new Error('That value cannot be saved (it is not plain data)'); }
      if (encoded === undefined) throw new Error('That value cannot be saved');
      if (name.length + encoded.length > LIMITS.maxValueBytes) throw new Error('A saved value can be at most ' + Math.round(LIMITS.maxValueBytes / 1024) + ' KB');
      const had = Object.hasOwn(s.values, name);
      if (!had && Object.keys(s.values).length >= LIMITS.maxValueKeys) throw new Error('A script can keep at most ' + LIMITS.maxValueKeys + ' values');
      const before = had ? name.length + JSON.stringify(s.values[name]).length : 0;
      if (valueBytes(s) - before + name.length + encoded.length > LIMITS.maxTotalValueBytes) throw new Error('This script has used its ' + Math.round(LIMITS.maxTotalValueBytes / 1024) + ' KB of saved values');
      s.values[name] = JSON.parse(encoded);
      scheduleFlush();
      return true;
    },
    async deleteValue(id, name) {
      const s = byId(id);
      api.requireGrant(s, 'deleteValue');
      if (typeof name !== 'string') throw new Error('A value name must be text');
      delete s.values[name];
      scheduleFlush();
      return true;
    },
  };
  return api;
}

module.exports = {
  LIMITS, OP_GRANT, SUPPORTED_GRANTS, RUN_AT,
  parseMetadata, parseMatchPattern, matchesPattern, compileGlobOrRegex, scriptMatches,
  isSensitiveHost, isLocalOrPrivateHost, isIpLiteral, isWebUrl, tabAllowed, connectAllowed,
  compareVersions, describe, createUserscripts, grantReview, hasHighPower, gainsHighPower,
};
