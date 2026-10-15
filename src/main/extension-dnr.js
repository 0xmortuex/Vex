// === chrome.declarativeNetRequest for extensions, evaluated by main ===
// Electron 42 gives an extension a declarativeNetRequest namespace and then
// enforces nothing: a rule that said "block this address" blocked nothing
// (found 2026-10-12). Main keeps each extension's rules here and answers for
// them from the ONE webRequest listener per event that each session has
// (main.js: wireAdblockerOnSession for onBeforeRequest, wireClientHintsOnSession
// for onBeforeSendHeaders, and the onHeadersReceived of each kind of session).
// A second listener on the same event would replace Vex's own.
//
// What is covered: the manifest's static rulesets (declarative_net_request
// .rule_resources), dynamic rules (kept across restarts) and session rules
// (kept until Vex closes); the actions block, allow, allowAllRequests,
// upgradeScheme, redirect (url, extensionPath, transform, regexSubstitution) and
// modifyHeaders (request and response set/append/remove); and the conditions
// urlFilter (| || ^ * as Chrome reads them), regexFilter (a safe subset, see
// checkRegex), domains / initiatorDomains / requestDomains and their
// excluded forms, domainType, resourceTypes, requestMethods, tabIds,
// isUrlFilterCaseSensitive and priority.
//
// Not covered, and said so: responseHeaders conditions (refused), the
// per-tab action count on the toolbar button, and an allowAllRequests rule on
// a sub_frame only allows that one request (a main_frame one allows the tab's
// page until it navigates).
//
// Speed: rules are indexed once, so a request does not walk the rules. A rule
// whose urlFilter is anchored on a host (||example.com^) or that names
// requestDomains goes in a host bucket (found by walking the request host's
// suffixes); one with a whole word in its filter goes in a word bucket (found
// by the words of the address); the rest are checked in a short residual list
// after a cheap "does the address contain this text" test. Each request's
// cost is measured per extension and a ruleset that is slow is said so on the
// extension's card.

const { RESOURCE_TYPES } = require('./extension-events');

// Chrome's documented numbers (chrome.declarativeNetRequest constants).
const LIMITS = Object.freeze({
  GUARANTEED_MINIMUM_STATIC_RULES: 30000,
  MAX_NUMBER_OF_STATIC_RULESETS: 100,
  MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
  MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
  MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
  MAX_NUMBER_OF_SESSION_RULES: 5000,
  MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
  MAX_NUMBER_OF_REGEX_RULES: 1000,
  MAX_NUMBER_OF_DISABLED_STATIC_RULES: 5000,
});
const MAX_REGEX_LENGTH = 512;        // RE2's own cap is a memory size; this is the plain-length stand-in
const MAX_URL_FILTER_LENGTH = 1024;
const MAX_STAR_COUNT = 8;            // each * is a backtracking point
const MAX_URL_LENGTH = 2048;         // longer addresses are not matched (Chrome's cap)
const MAX_MATCHED_KEPT = 200;
const SLOW_AVG_MS = 0.5;
const SLOW_REQUEST_MS = 5;
const MIN_SAMPLES = 100;

const TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping',
  'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
const TYPE_BIT = Object.fromEntries(TYPES.map((t, i) => [t, 1 << i]));
const ALL_BUT_MAIN = TYPES.reduce((m, t) => (t === 'main_frame' ? m : m | TYPE_BIT[t]), 0);
const ACTIONS = ['block', 'redirect', 'allow', 'upgradeScheme', 'modifyHeaders', 'allowAllRequests'];
// Which wins when two rules of one priority match: allow first, redirect last.
const ACTION_RANK = { allow: 0, allowAllRequests: 0, block: 1, upgradeScheme: 2, redirect: 3, modifyHeaders: 4 };
const SOURCE_RANK = { session: 0, dynamic: 1, static: 2 };
const METHODS = ['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other'];
const CONDITION_KEYS = new Set(['urlFilter', 'regexFilter', 'isUrlFilterCaseSensitive', 'initiatorDomains', 'excludedInitiatorDomains',
  'requestDomains', 'excludedRequestDomains', 'domains', 'excludedDomains', 'resourceTypes', 'excludedResourceTypes',
  'requestMethods', 'excludedRequestMethods', 'domainType', 'tabIds', 'excludedTabIds']);
const RULE_KEYS = new Set(['id', 'priority', 'condition', 'action']);
const REDIRECT_SCHEMES = new Set(['http', 'https', 'ftp', 'data', 'chrome-extension']);


// === regexFilter: what is let in ===
// Chrome runs RE2, which has no backtracking and so no catastrophic cases;
// this runs JavaScript's engine, which does. So only a subset that cannot go
// exponential is accepted: no lookaround or back-references (RE2 has none
// either), a length cap, and no quantified group that itself holds a
// quantifier or an alternation ((a+)+, (a|aa)*, (.*)* ...), and at most a few
// unbounded repeats. Returns { ok: true } or { ok: false, reason }, reason
// being Chrome's own 'syntaxError' | 'memoryLimitExceeded'.
function checkRegex(src, opts = {}) {
  if (typeof src !== 'string' || !src) return { ok: false, reason: 'syntaxError', detail: 'the pattern is empty' };
  if (src.length > MAX_REGEX_LENGTH) return { ok: false, reason: 'memoryLimitExceeded', detail: `the pattern is longer than ${MAX_REGEX_LENGTH} characters` };
  if (/[^\x20-\x7e]/.test(src)) return { ok: false, reason: 'syntaxError', detail: 'the pattern has characters that are not plain ASCII' };
  if (/\(\?(?:=|!|<=|<!)/.test(src)) return { ok: false, reason: 'syntaxError', detail: 'lookahead and lookbehind are not supported' };
  if (/\\[1-9]/.test(src.replace(/\\\\/g, ''))) return { ok: false, reason: 'syntaxError', detail: 'back-references are not supported' };
  if (/\(\?P?<[A-Za-z_]/.test(src) || /\(\?[imsU-]/.test(src)) return { ok: false, reason: 'syntaxError', detail: 'named groups and inline flags are not supported' };
  if (opts.requireCapturing && !/\((?!\?)/.test(src.replace(/\\./g, ''))) return { ok: false, reason: 'syntaxError', detail: 'the pattern has no capture group' };
  // Walk it: groups that are quantified must be simple.
  const stack = [];                  // { hasQuant, hasAlt }
  let unbounded = 0;
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === '(') { stack.push({ hasQuant: false, hasAlt: false }); continue; }
    if (ch === '|' && stack.length) { stack[stack.length - 1].hasAlt = true; continue; }
    const rest = src.slice(i);
    const braces = /^\{(\d*)(,?)(\d*)\}/.exec(rest);
    const isQuant = ch === '*' || ch === '+' || ch === '?' || (ch === '{' && braces);
    if (ch === ')') {
      const g = stack.pop();
      const next = src[i + 1];
      const nb = /^\{(\d*)(,?)(\d*)\}/.exec(src.slice(i + 1));
      const quantified = next === '*' || next === '+' || (nb && (nb[2] === ',' || Number(nb[1] || 0) > 1));
      if (g && quantified && (g.hasQuant || g.hasAlt)) return { ok: false, reason: 'memoryLimitExceeded', detail: 'a repeated group that holds a repeat or an alternative can take far too long to match' };
      if (g && stack.length && (g.hasQuant || quantified)) stack[stack.length - 1].hasQuant = true;
      if (g && stack.length && g.hasAlt && quantified) stack[stack.length - 1].hasAlt = true;
      continue;
    }
    if (isQuant) {
      const open = ch === '{' ? braces[0].length - 1 : 0;
      const isMany = ch === '*' || ch === '+' || (ch === '{' && (braces[2] === ',' || Number(braces[1] || 0) > 1));
      if (isMany) { unbounded++; if (stack.length) stack[stack.length - 1].hasQuant = true; }
      if (ch === '{') i += open;
    }
  }
  if (inClass || stack.length) return { ok: false, reason: 'syntaxError', detail: 'the pattern is not closed' };
  if (unbounded > 6) return { ok: false, reason: 'memoryLimitExceeded', detail: 'the pattern repeats too many times' };
  try { new RegExp(src, opts.caseSensitive === false ? 'i' : ''); }
  catch (err) { return { ok: false, reason: 'syntaxError', detail: err.message }; }
  return { ok: true };
}

// === urlFilter ===
function parseUrlFilter(f) {
  let body = f, domainAnchor = false, startAnchor = false, endAnchor = false;
  if (body.startsWith('||')) { domainAnchor = true; body = body.slice(2); }
  else if (body.startsWith('|')) { startAnchor = true; body = body.slice(1); }
  if (body.endsWith('|')) { endAnchor = true; body = body.slice(0, -1); }
  return { body, domainAnchor, startAnchor, endAnchor };
}
// A urlFilter is matched without a regular expression: its text between the *
// wildcards is found left to right, each as early as it can be, which is
// enough for a wildcard pattern and never backtracks (a regex of
// a*a*a*a*b on a long address of a's took minutes).
const isSeparator = (c) => !/[A-Za-z0-9_.%-]/.test(c);
// Whether `seg` (a piece of the filter, may hold ^) matches `s` at `i`; the
// position after it, or -1.
function segmentAt(s, seg, i) {
  let j = i;
  for (let k = 0; k < seg.length; k++) {
    const c = seg[k];
    if (c === '^') {
      if (j === s.length) continue;                 // ^ also stands for the end of the address
      if (!isSeparator(s[j])) return -1;
      j++;
    } else {
      if (s[j] !== c) return -1;
      j++;
    }
  }
  return j;
}
function findSegment(s, seg, from) {
  if (seg.indexOf('^') === -1) { const at = s.indexOf(seg, from); return at === -1 ? null : [at, at + seg.length]; }
  for (let i = from; i <= s.length; i++) { const e = segmentAt(s, seg, i); if (e !== -1) return [i, e]; }
  return null;
}
function buildGlob(p, caseSensitive) {
  const segs = p.body.split('*').map(x => (caseSensitive ? x : x.toLowerCase()));
  const N = segs.length - 1;
  const first = segs[0];
  const endAnchor = p.endAnchor;
  // The segments after the first, each as early as it fits; the last one
  // must end the address when the filter ends in |.
  const placeRest = (s, e) => {
    let pos = e;
    for (let n = 1; n <= N; n++) {
      const seg = segs[n];
      if (n === N && endAnchor) {
        if (seg === '') return true;
        for (let i = Math.max(pos, s.length - seg.length); i <= s.length; i++) if (segmentAt(s, seg, i) === s.length) return true;
        return false;
      }
      if (seg === '') continue;
      const hit = findSegment(s, seg, pos);
      if (!hit) return false;
      pos = hit[1];
    }
    return true;
  };
  const accept = (s, e) => (N > 0 ? placeRest(s, e) : (!endAnchor || e === s.length));
  return (s) => {
    if (p.startAnchor) {
      const e = segmentAt(s, first, 0);
      return e !== -1 && accept(s, e);
    }
    if (p.domainAnchor) {
      const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(s);
      if (!m) return false;
      const at = m[0].indexOf('://') + 3;
      // The text may begin at the host's start or after any . or @ in it.
      for (let i = at; i <= m[0].length; i++) {
        if (i !== at && m[0][i - 1] !== '.' && m[0][i - 1] !== '@') continue;
        const e = segmentAt(s, first, i);
        if (e !== -1 && accept(s, e)) return true;
      }
      return false;
    }
    if (N === 0 && endAnchor) {
      for (let i = Math.max(0, s.length - first.length); i <= s.length; i++) if (segmentAt(s, first, i) === s.length) return true;
      return false;
    }
    const hit = findSegment(s, first, 0);   // the earliest place leaves the most room
    return !!hit && accept(s, hit[1]);
  };
}
// Regular expressions run under a time limit (a JavaScript engine can still
// go slow on a pattern that looks harmless); one that runs over is switched
// off after three overruns and said so.
const vm = require('vm');
const REGEX_LIMIT_MS = 20;
const regexCtx = vm.createContext({ re: null, u: '' });
const regexScript = new vm.Script('re.test(u)');
function regexTest(rule, url) {
  if (rule.timedOut >= 3) return false;
  regexCtx.re = rule.re; regexCtx.u = url;
  try { return regexScript.runInContext(regexCtx, { timeout: REGEX_LIMIT_MS }) === true; }
  catch { rule.timedOut = (rule.timedOut || 0) + 1; return false; }
}
// The longest text the address must contain.
function needleOf(body, caseSensitive) {
  let best = '';
  for (const part of body.split(/[*^]/)) if (part.length > best.length) best = part;
  return caseSensitive ? best : best.toLowerCase();
}
// A whole word of the filter that the address must hold as a whole word too:
// bounded in the filter by a non-letter, a ^ or an anchor, never by a * or
// the loose end of an unanchored filter.
function wordOf(p) {
  const b = p.body;
  let best = '';
  const re = /[A-Za-z0-9]+/g;
  let m;
  while ((m = re.exec(b))) {
    const s = m.index, e = s + m[0].length;
    const okStart = s === 0 ? (p.startAnchor || p.domainAnchor) : b[s - 1] !== '*';
    const okEnd = e === b.length ? p.endAnchor : b[e] !== '*';
    if (okStart && okEnd && m[0].length > best.length) best = m[0];
  }
  return best.length >= 2 ? best.toLowerCase() : '';
}
// ||host^ , ||host/ , ||host: , ||host? : the host the address must be on.
function hostOf(p) {
  if (!p.domainAnchor) return '';
  const m = /^([a-z0-9][a-z0-9.-]*)[\^/:?]/i.exec(p.body);
  return m ? m[1].toLowerCase().replace(/\.$/, '') : '';
}

// === Domains ===
const ASCII_DOMAIN = /^[a-z0-9._*:[\]-]+$/;
function domainList(id, name, v) {
  if (v === undefined) return null;
  if (!Array.isArray(v)) throw new Error(`Rule with id ${id} has a ${name} that is not a list`);
  const out = new Set();
  for (const d of v) {
    if (typeof d !== 'string' || !d) throw new Error(`Rule with id ${id} has an empty entry in ${name}`);
    const l = d.toLowerCase();
    if (!ASCII_DOMAIN.test(l)) throw new Error(`Rule with id ${id} has "${d}" in ${name}: a domain must be ASCII (use its punycode form)`);
    out.add(l.replace(/^\.+/, ''));
  }
  return out;
}
function hostMatches(host, set) {
  if (!host || !set) return false;
  let h = host;
  for (;;) {
    if (set.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot === -1) return false;
    h = h.slice(dot + 1);
  }
}
// The part of a host that makes it "a site" (no public-suffix list here: a
// second-level label of two letters under a two-letter country code is kept).
function siteOf(host) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1], sld = labels[labels.length - 2];
  const take = tld.length === 2 && (sld.length <= 3 || ['com', 'co', 'org', 'net', 'gov', 'edu', 'ac'].includes(sld)) ? 3 : 2;
  return labels.slice(-take).join('.');
}
function typeMask(id, name, v) {
  if (!Array.isArray(v) || !v.length) throw new Error(`Rule with id ${id} has an empty ${name}`);
  let m = 0;
  for (const t of v) {
    if (!(t in TYPE_BIT)) throw new Error(`Rule with id ${id} has an unknown resource type "${t}" in ${name}`);
    m |= TYPE_BIT[t];
  }
  return m;
}
function methodSet(id, name, v) {
  if (v === undefined) return null;
  if (!Array.isArray(v) || !v.length) throw new Error(`Rule with id ${id} has an empty ${name}`);
  const s = new Set();
  for (const x of v) {
    const l = String(x).toLowerCase();
    if (!METHODS.includes(l)) throw new Error(`Rule with id ${id} has an unknown request method "${x}" in ${name}`);
    s.add(l);
  }
  return s;
}

// === One rule, checked and compiled ===
// Throws an Error that names the rule. `ctx.session` allows tabIds.
function compileRule(raw, ctx = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A rule must be an object');
  const id = raw.id;
  if (!Number.isInteger(id) || id < 1) throw new Error(`Rule with id ${String(id)} needs an id that is a whole number of 1 or more`);
  for (const k of Object.keys(raw)) if (!RULE_KEYS.has(k)) throw new Error(`Rule with id ${id} has an unknown key "${k}"`);
  const priority = raw.priority === undefined ? 1 : raw.priority;
  if (!Number.isInteger(priority) || priority < 1) throw new Error(`Rule with id ${id} needs a priority that is a whole number of 1 or more`);
  const action = raw.action;
  if (!action || typeof action !== 'object' || !ACTIONS.includes(action.type)) throw new Error(`Rule with id ${id} has an unknown action type`);
  const c = raw.condition;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`Rule with id ${id} has no condition`);
  for (const k of Object.keys(c)) {
    if (k === 'responseHeaders' || k === 'excludedResponseHeaders') throw new Error(`Rule with id ${id} uses ${k}, which Vex does not support`);
    if (!CONDITION_KEYS.has(k)) throw new Error(`Rule with id ${id} has an unknown condition "${k}"`);
  }
  if (c.urlFilter !== undefined && c.regexFilter !== undefined) throw new Error(`Rule with id ${id} has both urlFilter and regexFilter`);
  if ((c.tabIds !== undefined || c.excludedTabIds !== undefined) && !ctx.session) throw new Error(`Rule with id ${id}: tabIds are only allowed in session rules`);
  if (c.domains !== undefined && c.initiatorDomains !== undefined) throw new Error(`Rule with id ${id} has both domains and initiatorDomains`);
  if (c.excludedDomains !== undefined && c.excludedInitiatorDomains !== undefined) throw new Error(`Rule with id ${id} has both excludedDomains and excludedInitiatorDomains`);

  const rule = { id, priority, source: ctx.source || 'static', rulesetId: ctx.rulesetId || null, type: action.type,
    unsafe: action.type === 'redirect' || action.type === 'modifyHeaders', regex: false };

  // -- the action's own parts
  if (action.type === 'redirect') {
    const r = action.redirect;
    if (!r || typeof r !== 'object') throw new Error(`Rule with id ${id} is a redirect with no redirect`);
    const kinds = ['url', 'extensionPath', 'transform', 'regexSubstitution'].filter(k => r[k] !== undefined);
    if (kinds.length !== 1) throw new Error(`Rule with id ${id} must give exactly one of redirect.url, extensionPath, transform or regexSubstitution`);
    rule.redirect = { kind: kinds[0], value: r[kinds[0]] };
    if (kinds[0] === 'url') {
      let u; try { u = new URL(r.url); } catch { throw new Error(`Rule with id ${id} has a redirect url that is not an address`); }
      if (!REDIRECT_SCHEMES.has(u.protocol.slice(0, -1))) throw new Error(`Rule with id ${id} cannot redirect to ${u.protocol} addresses`);
    } else if (kinds[0] === 'extensionPath') {
      if (typeof r.extensionPath !== 'string' || !r.extensionPath.startsWith('/')) throw new Error(`Rule with id ${id} needs an extensionPath that starts with /`);
    } else if (kinds[0] === 'transform') {
      const t = r.transform;
      if (!t || typeof t !== 'object') throw new Error(`Rule with id ${id} has a transform that is not an object`);
      if (t.scheme !== undefined && !['http', 'https', 'ftp', 'chrome-extension'].includes(t.scheme)) throw new Error(`Rule with id ${id} has a transform scheme Vex does not allow`);
      if (t.port !== undefined && !/^\d{0,5}$/.test(String(t.port))) throw new Error(`Rule with id ${id} has a transform port that is not a number`);
      if (t.path !== undefined && t.path !== '' && !String(t.path).startsWith('/')) throw new Error(`Rule with id ${id} has a transform path that does not start with /`);
      if (t.query !== undefined && t.query !== '' && !String(t.query).startsWith('?')) throw new Error(`Rule with id ${id} has a transform query that does not start with ?`);
      if (t.fragment !== undefined && t.fragment !== '' && !String(t.fragment).startsWith('#')) throw new Error(`Rule with id ${id} has a transform fragment that does not start with #`);
      if (t.query !== undefined && t.queryTransform !== undefined) throw new Error(`Rule with id ${id} has both query and queryTransform`);
    } else if (typeof r.regexSubstitution !== 'string' || c.regexFilter === undefined) {
      throw new Error(`Rule with id ${id}: regexSubstitution needs a regexFilter`);
    }
  } else if (action.type === 'modifyHeaders') {
    const lists = { request: action.requestHeaders, response: action.responseHeaders };
    if (!lists.request && !lists.response) throw new Error(`Rule with id ${id} is a modifyHeaders rule with no requestHeaders or responseHeaders`);
    rule.headers = { request: [], response: [] };
    for (const side of ['request', 'response']) {
      const list = lists[side];
      if (list === undefined) continue;
      if (!Array.isArray(list) || !list.length) throw new Error(`Rule with id ${id} has an empty ${side}Headers`);
      for (const h of list) {
        if (!h || typeof h.header !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(h.header)) throw new Error(`Rule with id ${id} has a header name that is not valid`);
        if (!['set', 'append', 'remove'].includes(h.operation)) throw new Error(`Rule with id ${id} has an unknown header operation`);
        if (h.operation === 'remove' ? h.value !== undefined : typeof h.value !== 'string') throw new Error(`Rule with id ${id}: ${h.operation} ${h.operation === 'remove' ? 'takes no value' : 'needs a value'}`);
        rule.headers[side].push({ header: h.header, lc: h.header.toLowerCase(), operation: h.operation, value: h.value });
      }
    }
  }

  // -- resource types
  if (c.resourceTypes !== undefined && c.excludedResourceTypes !== undefined && (c.resourceTypes || []).some(t => (c.excludedResourceTypes || []).includes(t))) {
    throw new Error(`Rule with id ${id} lists a resource type as both included and excluded`);
  }
  let mask = c.resourceTypes !== undefined ? typeMask(id, 'resourceTypes', c.resourceTypes) : ALL_BUT_MAIN;
  if (c.excludedResourceTypes !== undefined) mask &= ~typeMask(id, 'excludedResourceTypes', c.excludedResourceTypes);
  if (action.type === 'allowAllRequests') {
    if (c.resourceTypes === undefined) throw new Error(`Rule with id ${id} is an allowAllRequests rule and needs resourceTypes`);
    if (mask & ~(TYPE_BIT.main_frame | TYPE_BIT.sub_frame)) throw new Error(`Rule with id ${id}: an allowAllRequests rule may only list main_frame and sub_frame`);
  }
  rule.typeMask = mask;

  // -- methods
  rule.methods = methodSet(id, 'requestMethods', c.requestMethods);
  rule.excludedMethods = methodSet(id, 'excludedRequestMethods', c.excludedRequestMethods);
  if (rule.methods && rule.excludedMethods) throw new Error(`Rule with id ${id} has both requestMethods and excludedRequestMethods`);

  // -- domains
  rule.initiators = domainList(id, 'initiatorDomains', c.initiatorDomains !== undefined ? c.initiatorDomains : c.domains);
  rule.excludedInitiators = domainList(id, 'excludedInitiatorDomains', c.excludedInitiatorDomains !== undefined ? c.excludedInitiatorDomains : c.excludedDomains);
  rule.requestDomains = domainList(id, 'requestDomains', c.requestDomains);
  rule.excludedRequestDomains = domainList(id, 'excludedRequestDomains', c.excludedRequestDomains);
  if (c.domainType !== undefined && c.domainType !== 'firstParty' && c.domainType !== 'thirdParty') throw new Error(`Rule with id ${id} has an unknown domainType`);
  rule.domainType = c.domainType || null;
  const tabs = (name, v) => {
    if (v === undefined) return null;
    if (!Array.isArray(v) || v.some(x => !Number.isInteger(x))) throw new Error(`Rule with id ${id} has ${name} that is not a list of whole numbers`);
    return new Set(v);
  };
  rule.tabIds = tabs('tabIds', c.tabIds);
  rule.excludedTabIds = tabs('excludedTabIds', c.excludedTabIds);

  // -- the address
  const cs = c.isUrlFilterCaseSensitive === true;
  rule.caseSensitive = cs;
  rule.needle = '';
  rule.word = '';
  rule.host = '';
  rule.re = null;
  rule.reSource = null;
  if (c.urlFilter !== undefined) {
    const f = c.urlFilter;
    if (typeof f !== 'string' || !f) throw new Error(`Rule with id ${id} has an empty urlFilter`);
    if (f.length > MAX_URL_FILTER_LENGTH) throw new Error(`Rule with id ${id} has a urlFilter longer than ${MAX_URL_FILTER_LENGTH} characters`);
    if (/[^\x21-\x7e]/.test(f)) throw new Error(`Rule with id ${id} has a urlFilter that is not plain ASCII without spaces`);
    if (f.startsWith('||*') || /^\|\|?$/.test(f)) throw new Error(`Rule with id ${id} has a urlFilter that does not say what to match`);
    if ((f.match(/\*/g) || []).length > MAX_STAR_COUNT) throw new Error(`Rule with id ${id} has a urlFilter with more than ${MAX_STAR_COUNT} wildcards`);
    const p = parseUrlFilter(f);
    if (!p.body && !p.endAnchor && !p.startAnchor) throw new Error(`Rule with id ${id} has a urlFilter that does not say what to match`);
    rule.parts = p;
    rule.needle = needleOf(p.body, cs);
    rule.word = wordOf(p);
    rule.host = hostOf(p);
    rule.test = buildGlob(p, cs);
  } else if (c.regexFilter !== undefined) {
    const chk = checkRegex(c.regexFilter, { caseSensitive: cs });
    if (!chk.ok) throw new Error(`Rule with id ${id} has a regexFilter Vex will not run: ${chk.detail}`);
    rule.regex = true;
    rule.reSource = c.regexFilter;
    rule.re = new RegExp(c.regexFilter, cs ? '' : 'i');
    rule.timedOut = 0;
  }
  return rule;
}

// === One extension's rules, indexed ===
function buildIndex(rules) {
  const hosts = new Map();   // host -> [rule]
  const words = new Map();   // word -> [rule]
  const residual = [];
  let unindexed = 0;
  const put = (m, k, r) => { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
  for (const r of rules) {
    if (r.requestDomains && r.requestDomains.size) { for (const d of r.requestDomains) put(hosts, d, r); continue; }
    if (r.host) { put(hosts, r.host, r); continue; }
    if (r.word) { put(words, r.word, r); continue; }
    residual.push(r);
    if (!r.needle) unindexed++;
  }
  return { hosts, words, residual, unindexed, size: rules.length };
}

function sortKey(a, b) {
  return (b.priority - a.priority) || (ACTION_RANK[a.type] - ACTION_RANK[b.type]) || (SOURCE_RANK[a.source] - SOURCE_RANK[b.source]) || (a.id - b.id);
}

// One request, as the matcher reads it. `details` is Electron's; `pageUrl` the
// address of the page in the tab (initiator when there is no referrer).
function normalizeRequest(details, pageUrl) {
  let url = String(details.url || '');
  if (url.length > MAX_URL_LENGTH) url = url.slice(0, MAX_URL_LENGTH);
  let host = '', scheme = '';
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)/i.exec(url);
  if (m) { scheme = m[1].toLowerCase(); host = m[2].toLowerCase(); }
  const type = RESOURCE_TYPES[details.resourceType] || 'other';
  let initiator = null, initiatorHost = '';
  if (type !== 'main_frame') {
    const src = details.referrer || pageUrl || '';
    try { const u = new URL(src); if (/^https?:$/.test(u.protocol)) { initiator = u.origin; initiatorHost = u.hostname.toLowerCase(); } } catch { /* none */ }
  }
  return { url, lowerUrl: url.toLowerCase(), scheme, host, type, typeBit: TYPE_BIT[type] || TYPE_BIT.other,
    method: String(details.method || 'GET').toLowerCase(), initiator, initiatorHost, tabId: details.webContentsId == null ? -1 : details.webContentsId };
}

function ruleMatches(r, q) {
  if (!(r.typeMask & q.typeBit)) return false;
  if (r.methods && !r.methods.has(METHODS.includes(q.method) ? q.method : 'other')) return false;
  if (r.excludedMethods && r.excludedMethods.has(METHODS.includes(q.method) ? q.method : 'other')) return false;
  if (r.tabIds && !r.tabIds.has(q.tabId)) return false;
  if (r.excludedTabIds && r.excludedTabIds.has(q.tabId)) return false;
  if (r.requestDomains && !hostMatches(q.host, r.requestDomains)) return false;
  if (r.excludedRequestDomains && hostMatches(q.host, r.excludedRequestDomains)) return false;
  if (r.initiators && !(q.initiatorHost && hostMatches(q.initiatorHost, r.initiators))) return false;
  if (r.excludedInitiators && q.initiatorHost && hostMatches(q.initiatorHost, r.excludedInitiators)) return false;
  if (r.domainType) {
    const third = !!q.initiatorHost && siteOf(q.initiatorHost) !== siteOf(q.host);
    if ((r.domainType === 'thirdParty') !== third) return false;
  }
  if (r.needle && !(r.caseSensitive ? q.url : q.lowerUrl).includes(r.needle)) return false;
  if (r.test) { if (!r.test(r.caseSensitive ? q.url : q.lowerUrl)) return false; }
  else if (r.re && !regexTest(r, q.url)) return false;
  return true;
}

// -> { terminal: rule|null, modify: [rule] } for the rules in `index`.
// `permitted(rule)` says whether the extension may use the rule on this request.
function matchIndex(index, q, permitted) {
  let best = null;
  const modify = [];
  const seen = new Set();
  const consider = (r) => {
    if (seen.has(r)) return;
    seen.add(r);
    if (!ruleMatches(r, q)) return;
    if (!permitted(r)) return;
    if (r.type === 'modifyHeaders') { modify.push(r); return; }
    if (!best || sortKey(r, best) < 0) best = r;
  };
  if (index.hosts.size && q.host) {
    let h = q.host;
    for (;;) {
      const l = index.hosts.get(h);
      if (l) for (const r of l) consider(r);
      const dot = h.indexOf('.');
      if (dot === -1) break;
      h = h.slice(dot + 1);
    }
  }
  if (index.words.size) {
    const toks = q.lowerUrl.match(/[a-z0-9]+/g) || [];
    const done = new Set();
    for (let i = 0; i < toks.length && done.size < 256; i++) {
      const t = toks[i];
      if (done.has(t)) continue;
      done.add(t);
      const l = index.words.get(t);
      if (l) for (const r of l) consider(r);
    }
  }
  for (const r of index.residual) consider(r);
  return { terminal: best, modify };
}

// === The redirect a rule makes ===
function redirectTarget(rule, url, extId) {
  const r = rule.redirect;
  if (r.kind === 'url') return r.value;
  if (r.kind === 'extensionPath') return `chrome-extension://${extId}${r.value}`;
  if (r.kind === 'regexSubstitution') {
    const m = rule.re && regexTest(rule, url) ? rule.re.exec(url) : null;   // under the time limit first
    if (!m) return null;
    return r.value.replace(/\\([0-9\\])/g, (_x, d) => (d === '\\' ? '\\' : (m[Number(d)] === undefined ? '' : m[Number(d)])));
  }
  let u;
  try { u = new URL(url); } catch { return null; }
  const t = r.value;
  if (t.scheme !== undefined) u.protocol = t.scheme;
  if (t.username !== undefined) u.username = t.username;
  if (t.password !== undefined) u.password = t.password;
  if (t.host !== undefined) u.hostname = t.host;
  if (t.port !== undefined) u.port = String(t.port);
  if (t.path !== undefined) u.pathname = t.path || '/';
  if (t.query !== undefined) u.search = t.query;
  if (t.fragment !== undefined) u.hash = t.fragment;
  const qt = t.queryTransform;
  if (qt && typeof qt === 'object') {
    for (const k of qt.removeParams || []) u.searchParams.delete(k);
    for (const p of qt.addOrReplaceParams || []) {
      if (!p || typeof p.key !== 'string') continue;
      if (p.replaceOnly && !u.searchParams.has(p.key)) continue;
      u.searchParams.set(p.key, String(p.value == null ? '' : p.value));
    }
  }
  return u.href;
}

// Applies header operations in order; the first to set or remove a header
// keeps every later (lower priority) change off it, and an append lets only
// appends follow it. Returns whether anything changed.
function applyHeaderOps(headers, ops, response) {
  const state = new Map();
  let changed = false;
  const find = (lc) => Object.keys(headers).find(k => k.toLowerCase() === lc);
  for (const o of ops) {
    const s = state.get(o.lc);
    if (s === 'locked' || (s === 'append' && o.operation !== 'append')) continue;
    const key = find(o.lc);
    if (o.operation === 'remove') {
      if (key !== undefined) { delete headers[key]; changed = true; }
      state.set(o.lc, 'locked');
    } else if (o.operation === 'set') {
      if (key !== undefined && key !== o.header) delete headers[key];
      headers[key !== undefined ? key : o.header] = response ? [o.value] : o.value;
      state.set(o.lc, 'locked');
      changed = true;
    } else {
      const k = key !== undefined ? key : o.header;
      if (response) headers[k] = (Array.isArray(headers[k]) ? headers[k] : (headers[k] === undefined ? [] : [String(headers[k])])).concat(o.value);
      else headers[k] = headers[k] === undefined ? o.value : `${headers[k]}${o.lc === 'cookie' ? '; ' : ', '}${o.value}`;
      state.set(o.lc, 'append');
      changed = true;
    }
  }
  return changed;
}

// === The store ===
// deps: load() -> saved state, save(state), readFile(absPath) -> text,
// now(), clock() -> milliseconds as a float.
function createExtensionDnr(deps = {}) {
  const now = deps.now || Date.now;
  const clock = deps.clock || (() => Number(process.hrtime.bigint()) / 1e6);
  const fsPath = deps.path || require('path');
  const readFile = deps.readFile || ((p) => require('fs').readFileSync(p, 'utf-8'));
  const engines = new Map();        // key ('<partition>|<id>') -> engine
  const byPartition = new Map();    // partition -> Map(extId -> engine)
  const allowAll = new Map();       // `${partition}|${tabId}` -> [{ extId, priority }]
  let saved = null;                 // key -> { enabled?, dynamic?, disabled? }

  function persisted() {
    if (saved) return saved;
    let d;
    try { d = deps.load ? deps.load() : {}; } catch (err) { console.error('[Extensions] the saved request rules could not be read:', err.message); d = {}; }
    saved = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    return saved;
  }
  function persist() { if (deps.save) deps.save(persisted()); }

  function rebuild(e) {
    const rules = [];
    let regex = 0;
    for (const rs of e.rulesets.values()) {
      if (!rs.enabled || rs.error) continue;
      const off = e.disabled[rs.id] || null;
      for (const r of rs.rules) if (!(off && off.has(r.id))) { rules.push(r); if (r.regex) regex++; }
    }
    for (const r of e.dynamic.values()) { rules.push(r); if (r.regex) regex++; }
    for (const r of e.session.values()) { rules.push(r); if (r.regex) regex++; }
    e.index = buildIndex(rules);
    e.regexCount = regex;
    e.active = rules.length > 0;
  }
  const staticCount = (e) => { let n = 0; for (const rs of e.rulesets.values()) if (rs.enabled && !rs.error) n += rs.rules.length; return n; };

  function readStatic(e, rs) {
    const root = fsPath.resolve(e.path);
    const file = fsPath.resolve(root, String(rs.path));
    if (!file.startsWith(root + fsPath.sep)) throw new Error(`its path ${rs.path} leaves the extension's folder`);
    let list;
    try { list = JSON.parse(String(readFile(file)).replace(/^\uFEFF/, '')); }
    catch (err) { throw new Error(`${rs.path} could not be read: ${err.message}`, { cause: err }); }
    if (!Array.isArray(list)) throw new Error(`${rs.path} is not a list of rules`);
    return list;
  }

  // Makes the engine for an extension that is loaded in a session.
  function register(partition, ext) {
    const key = `${partition}|${ext.id}`;
    const manifest = ext.manifest || {};
    const perms = [].concat(manifest.permissions || [], manifest.optional_permissions || []);
    if (!perms.includes('declarativeNetRequest') && !perms.includes('declarativeNetRequestWithHostAccess')) { unregister(partition, ext.id); return null; }
    const keep = persisted()[key] || {};
    const e = { key, partition, id: ext.id, path: ext.path, name: ext.name || ext.id, manifest,
      feedback: perms.includes('declarativeNetRequestFeedback'),
      hostOnly: !perms.includes('declarativeNetRequest'),
      hostAllowed: ext.hostAllowed || (() => true),
      rulesets: new Map(), dynamic: new Map(), session: new Map(), disabled: {}, warnings: [],
      index: buildIndex([]), regexCount: 0, active: false,
      perf: { requests: 0, avgMs: 0, maxMs: 0, over: 0, totalMs: 0 }, matched: [] };
    const res = (manifest.declarative_net_request && manifest.declarative_net_request.rule_resources) || [];
    const wantOn = Array.isArray(keep.enabled) ? new Set(keep.enabled.map(String)) : null;
    let enabledRulesets = 0, total = 0;
    if (res.length > LIMITS.MAX_NUMBER_OF_STATIC_RULESETS) e.warnings.push(`It lists ${res.length} rulesets; Vex reads the first ${LIMITS.MAX_NUMBER_OF_STATIC_RULESETS}.`);
    for (const rs of res.slice(0, LIMITS.MAX_NUMBER_OF_STATIC_RULESETS)) {
      if (!rs || typeof rs.id !== 'string' || typeof rs.path !== 'string') { e.warnings.push('A ruleset in its manifest has no id or path.'); continue; }
      const set = { id: rs.id, path: rs.path, enabled: wantOn ? wantOn.has(rs.id) : rs.enabled === true, rules: [], error: null, skipped: 0 };
      try {
        const seen = new Set();
        for (const raw of readStatic(e, rs)) {
          try {
            const r = compileRule(raw, { source: 'static', rulesetId: rs.id });
            if (seen.has(r.id)) throw new Error(`Rule with id ${r.id} is listed twice`);
            seen.add(r.id);
            set.rules.push(r);
          } catch (err) { set.skipped++; if (set.skipped === 1) e.warnings.push(`${rs.id}: a rule was ignored: ${err.message}`); }
        }
        if (set.skipped > 1) e.warnings.push(`${rs.id}: ${set.skipped} rules were ignored in all.`);
        if (set.enabled) {
          if (enabledRulesets >= LIMITS.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS) { set.error = `more than ${LIMITS.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS} rulesets are on`; }
          else if (total + set.rules.length > LIMITS.GUARANTEED_MINIMUM_STATIC_RULES) { set.error = `its ${set.rules.length} rules would take the total over ${LIMITS.GUARANTEED_MINIMUM_STATIC_RULES}`; }
          else if (set.rules.filter(r => r.regex).length > LIMITS.MAX_NUMBER_OF_REGEX_RULES) { set.error = `it has more than ${LIMITS.MAX_NUMBER_OF_REGEX_RULES} regular-expression rules`; }
          else { enabledRulesets++; total += set.rules.length; }
        }
      } catch (err) { set.error = err.message; }
      if (set.error) e.warnings.push(`Ruleset ${rs.id} is off: ${set.error}.`);
      e.rulesets.set(rs.id, set);
    }
    for (const [id, ids] of Object.entries(keep.disabled || {})) if (Array.isArray(ids)) e.disabled[id] = new Set(ids.filter(Number.isInteger));
    for (const raw of Array.isArray(keep.dynamic) ? keep.dynamic : []) {
      try { const r = compileRule(raw, { source: 'dynamic' }); e.dynamic.set(r.id, { ...r, raw }); }
      catch (err) { e.warnings.push(`A saved dynamic rule was dropped: ${err.message}`); }
    }
    rebuild(e);
    if (e.index.unindexed > 2000) e.warnings.push(`${e.index.unindexed} of its rules have no part of the address Vex can look up first, so every request is checked against all of them.`);
    if (e.regexCount > 500) e.warnings.push(`${e.regexCount} of its rules are regular expressions, which are the slowest kind.`);
    engines.set(key, e);
    let part = byPartition.get(partition);
    if (!part) { part = new Map(); byPartition.set(partition, part); }
    part.set(ext.id, e);
    return e;
  }
  function unregister(partition, extId) {
    engines.delete(`${partition}|${extId}`);
    const part = byPartition.get(partition);
    if (part) { part.delete(extId); if (!part.size) byPartition.delete(partition); }
  }
  const get = (partition, extId) => {
    const e = engines.get(`${partition}|${extId}`);
    if (!e) throw new Error('This extension has no request rules loaded here');
    return e;
  };
  const hasRules = (partition) => byPartition.has(partition);

  // === Asking: which rule takes this request ===
  function permits(e, q) {
    // Redirect and header changes need a host permission for the address and
    // for the page that asked; so does every action without the plain
    // declarativeNetRequest permission.
    let memo = null;
    const ok = () => {
      if (memo === null) memo = !!e.hostAllowed(q.url) && (!q.initiator || !!e.hostAllowed(q.initiator + '/'));
      return memo;
    };
    return (r) => ((r.unsafe || e.hostOnly) ? ok() : true);
  }
  function engineOutcome(e, q) {
    const out = matchIndex(e.index, q, permits(e, q));
    let { terminal } = out;
    let floor = terminal && (terminal.type === 'allow' || terminal.type === 'allowAllRequests') ? terminal.priority : -1;
    const held = allowAll.get(`${e.partition}|${q.tabId}`);
    if (held && q.type !== 'main_frame') {
      for (const h of held) {
        if (h.extId !== e.id) continue;
        if (!terminal || terminal.priority <= h.priority) { terminal = { type: 'allow', priority: h.priority, id: h.ruleId, rulesetId: h.rulesetId, held: true }; }
        floor = Math.max(floor, h.priority);
      }
    }
    const modify = out.modify.filter(r => r.priority > floor).sort(sortKey);
    return { terminal, modify };
  }

  // -> { action, redirectUrl, requestOps, responseOps, matched } for a request in a partition.
  // quiet: a later stage of a request already counted (headers): no match is
  // recorded again and nothing is remembered.
  function evaluate(partition, q, quiet = false) {
    const part = byPartition.get(partition);
    const res = { action: null, redirectUrl: null, requestOps: [], responseOps: [], matched: [] };
    if (!part) return res;
    if (q.type === 'main_frame' && !quiet) allowAll.delete(`${partition}|${q.tabId}`);
    if (!/^(?:https?|wss?|ftp):$/.test(q.scheme + ':')) return res;
    let blocked = null, upgrade = null, redirect = null, allowed = null;
    for (const e of part.values()) {
      if (!e.active) continue;
      const t0 = clock();
      let o;
      try { o = engineOutcome(e, q); }
      catch (err) { console.error(`[Extensions] request rules of ${e.name}:`, err.message); continue; }
      const dt = clock() - t0;
      const p = e.perf;
      p.requests++; p.totalMs += dt; p.avgMs += (dt - p.avgMs) * (p.requests < 50 ? 1 / p.requests : 0.02);
      if (dt > p.maxMs) p.maxMs = dt;
      if (dt > SLOW_REQUEST_MS) p.over++;
      const t = o.terminal;
      if (t && t.held) allowed = allowed || { e, t };
      if (t && !t.held) {
        const note = { extId: e.id, ruleId: t.id, rulesetId: t.rulesetId || '_dynamic' };
        res.matched.push(note);
        if (e.feedback && !quiet) noteMatch(e, t, q);
        if (t.type === 'allowAllRequests' && q.type === 'main_frame' && !quiet) {
          const k = `${partition}|${q.tabId}`;
          const l = allowAll.get(k) || [];
          l.push({ extId: e.id, priority: t.priority, ruleId: t.id, rulesetId: t.rulesetId });
          allowAll.set(k, l);
          if (allowAll.size > 500) allowAll.delete(allowAll.keys().next().value);
        }
        if (t.type === 'block' && !blocked) blocked = { e, t };
        else if (t.type === 'upgradeScheme' && !upgrade) upgrade = { e, t };
        else if (t.type === 'redirect' && !redirect) redirect = { e, t };
        else if (t.type === 'allow' || t.type === 'allowAllRequests') allowed = allowed || { e, t };
      }
      for (const r of o.modify) {
        if (e.feedback && !quiet) noteMatch(e, r, q);
        res.matched.push({ extId: e.id, ruleId: r.id, rulesetId: r.rulesetId || '_dynamic' });
        for (const h of r.headers.request) res.requestOps.push(h);
        for (const h of r.headers.response) res.responseOps.push(h);
      }
    }
    // A block from any extension wins; then an upgrade, then a redirect.
    if (blocked) { res.action = 'block'; res.requestOps = []; res.responseOps = []; return res; }
    if (upgrade && /^(?:http|ws):$/.test(q.scheme + ':')) {
      try {
        const u = new URL(q.url);
        u.protocol = q.scheme === 'ws' ? 'wss:' : 'https:';
        if (u.port === '80') u.port = '';
        res.action = 'upgradeScheme'; res.redirectUrl = u.href; res.requestOps = []; res.responseOps = [];
        return res;
      } catch (err) { console.error(`[Extensions] an upgrade rule of ${upgrade.e.name} could not be applied:`, err.message); }
    }
    if (redirect) {
      let target;
      try { target = redirectTarget(redirect.t, q.url, redirect.e.id); }
      catch (err) { console.error(`[Extensions] a redirect rule of ${redirect.e.name} could not be applied:`, err.message); }
      if (target && target !== q.url) {
        res.action = 'redirect'; res.redirectUrl = target; res.requestOps = []; res.responseOps = [];
        return res;
      }
    }
    if (allowed) res.action = 'allow';
    return res;
  }
  function noteMatch(e, rule, q) {
    e.matched.push({ rule: { ruleId: rule.id, rulesetId: rule.rulesetId || '_dynamic' }, tabId: q.tabId, timeStamp: now() });
    if (e.matched.length > MAX_MATCHED_KEPT) e.matched.shift();
  }

  // === The chrome.declarativeNetRequest calls ===
  function checkAdd(list, current, source, max, maxUnsafe) {
    const next = new Map(current);
    const out = [];
    for (const raw of list || []) {
      const r = compileRule(raw, { source, session: source === 'session' });
      if (next.has(r.id)) throw new Error(`Rule with id ${r.id} does not have a unique ID`);
      next.set(r.id, { ...r, raw });
      out.push(r);
    }
    if (next.size > max) throw new Error(`Rule count exceeded: at most ${max} ${source} rules can be added`);
    let unsafe = 0, regex = 0;
    for (const r of next.values()) { if (r.unsafe) unsafe++; if (r.regex) regex++; }
    if (unsafe > maxUnsafe) throw new Error(`Unsafe rule count exceeded: at most ${maxUnsafe} ${source} rules that redirect or modify headers can be added`);
    if (regex > LIMITS.MAX_NUMBER_OF_REGEX_RULES) throw new Error(`Regex rule count exceeded: at most ${LIMITS.MAX_NUMBER_OF_REGEX_RULES} regular-expression rules can be added`);
    return next;
  }
  function updateRules(e, source, o) {
    const opts = o && typeof o === 'object' ? o : {};
    const map = source === 'dynamic' ? e.dynamic : e.session;
    const kept = new Map(map);
    for (const id of opts.removeRuleIds || []) { if (!Number.isInteger(id)) throw new Error('removeRuleIds must be whole numbers'); kept.delete(id); }
    const next = source === 'dynamic'
      ? checkAdd(opts.addRules, kept, 'dynamic', LIMITS.MAX_NUMBER_OF_DYNAMIC_RULES, LIMITS.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES)
      : checkAdd(opts.addRules, kept, 'session', LIMITS.MAX_NUMBER_OF_SESSION_RULES, LIMITS.MAX_NUMBER_OF_UNSAFE_SESSION_RULES);
    map.clear();
    for (const [k, v] of next) map.set(k, v);
    rebuild(e);
    if (source === 'dynamic') {
      const s = persisted();
      const mine = s[e.key] || (s[e.key] = {});
      mine.dynamic = [...e.dynamic.values()].map(r => r.raw);
      persist();
    }
  }
  const rulesOf = (map, ids) => [...map.values()].filter(r => !Array.isArray(ids) || ids.includes(r.id)).map(r => JSON.parse(JSON.stringify(r.raw)));

  function api(partition, extId, op, args) {
    const e = get(partition, extId);
    const a = args && typeof args === 'object' ? args : {};
    switch (op) {
      case 'updateDynamicRules': updateRules(e, 'dynamic', a); return undefined;
      case 'updateSessionRules': updateRules(e, 'session', a); return undefined;
      case 'getDynamicRules': return rulesOf(e.dynamic, a.ruleIds);
      case 'getSessionRules': return rulesOf(e.session, a.ruleIds);
      case 'getEnabledRulesets': return [...e.rulesets.values()].filter(r => r.enabled && !r.error).map(r => r.id);
      case 'updateEnabledRulesets': {
        const on = new Set(a.enableRulesetIds || []), off = new Set(a.disableRulesetIds || []);
        for (const id of [...on, ...off]) if (!e.rulesets.has(id)) throw new Error(`The ruleset "${id}" does not exist`);
        const want = new Map([...e.rulesets.values()].map(r => [r.id, r.enabled && !r.error]));
        for (const id of off) want.set(id, false);
        for (const id of on) want.set(id, true);
        const enabled = [...want].filter(([, v]) => v).map(([k]) => k);
        if (enabled.length > LIMITS.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS) throw new Error(`At most ${LIMITS.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS} rulesets can be enabled`);
        let total = 0;
        for (const id of enabled) {
          const rs = e.rulesets.get(id);
          if (rs.rules.filter(r => r.regex).length > LIMITS.MAX_NUMBER_OF_REGEX_RULES) throw new Error(`The ruleset "${id}" has more than ${LIMITS.MAX_NUMBER_OF_REGEX_RULES} regular-expression rules`);
          total += rs.rules.length;
        }
        if (total > LIMITS.GUARANTEED_MINIMUM_STATIC_RULES) throw new Error(`Rule count exceeded: the enabled rulesets would hold ${total} rules, at most ${LIMITS.GUARANTEED_MINIMUM_STATIC_RULES} are allowed`);
        for (const [id, v] of want) { const rs = e.rulesets.get(id); rs.enabled = v; if (v && rs.error && /^more than|^its .* would take/.test(rs.error)) rs.error = null; }
        rebuild(e);
        const s = persisted();
        (s[e.key] || (s[e.key] = {})).enabled = enabled;
        persist();
        return undefined;
      }
      case 'getAvailableStaticRuleCount': return Math.max(0, LIMITS.GUARANTEED_MINIMUM_STATIC_RULES - staticCount(e));
      case 'getDisabledRuleIds': {
        if (!e.rulesets.has(a.rulesetId)) throw new Error(`The ruleset "${a.rulesetId}" does not exist`);
        return [...(e.disabled[a.rulesetId] || [])];
      }
      case 'updateStaticRules': {
        const rs = e.rulesets.get(a.rulesetId);
        if (!rs) throw new Error(`The ruleset "${a.rulesetId}" does not exist`);
        const set = new Set(e.disabled[a.rulesetId] || []);
        const known = new Set(rs.rules.map(r => r.id));
        for (const id of a.disableRuleIds || []) { if (!known.has(id)) throw new Error(`Rule with id ${id} is not in the ruleset`); set.add(id); }
        for (const id of a.enableRuleIds || []) set.delete(id);
        if (set.size > LIMITS.MAX_NUMBER_OF_DISABLED_STATIC_RULES) throw new Error(`At most ${LIMITS.MAX_NUMBER_OF_DISABLED_STATIC_RULES} rules can be turned off`);
        e.disabled[a.rulesetId] = set;
        rebuild(e);
        const s = persisted();
        (s[e.key] || (s[e.key] = {})).disabled = Object.fromEntries(Object.entries(e.disabled).map(([k, v]) => [k, [...v]]));
        persist();
        return undefined;
      }
      case 'isRegexSupported': {
        const r = checkRegex(a.regex, { requireCapturing: a.requireCapturing === true });
        return r.ok ? { isSupported: true } : { isSupported: false, reason: r.reason };
      }
      case 'testMatchOutcome': {
        const req = a.request || a;
        let u; try { u = new URL(String(req.url || '')); } catch { throw new Error('url is not a valid address'); }
        const q = normalizeRequest({ url: u.href, resourceType: Object.keys(RESOURCE_TYPES).find(k => RESOURCE_TYPES[k] === req.type) || 'other',
          method: req.method || 'get', referrer: req.initiator || '', webContentsId: Number.isInteger(req.tabId) ? req.tabId : -1 }, '');
        const o = engineOutcome(e, q);
        const rules = [];
        if (o.terminal && !o.terminal.held) rules.push({ ruleId: o.terminal.id, rulesetId: o.terminal.rulesetId || '_dynamic' });
        for (const r of o.modify) rules.push({ ruleId: r.id, rulesetId: r.rulesetId || '_dynamic' });
        return { matchedRules: rules };
      }
      case 'getMatchedRules': {
        if (!e.feedback) throw new Error('The "declarativeNetRequestFeedback" permission is required');
        const f = a.filter || {};
        const rows = e.matched.filter(m => (!Number.isInteger(f.tabId) || m.tabId === f.tabId) && (!Number.isFinite(f.minTimeStamp) || m.timeStamp >= f.minTimeStamp));
        return { rulesMatchedInfo: rows.map(m => ({ rule: { ...m.rule }, tabId: m.tabId, timeStamp: m.timeStamp })) };
      }
      default: throw new Error('Vex does not know declarativeNetRequest.' + String(op));
    }
  }

  // What the extension's card says.
  function status(partition, extId) {
    const e = engines.get(`${partition}|${extId}`);
    if (!e) return null;
    const p = e.perf;
    const warnings = e.warnings.slice();
    const slow = p.requests >= MIN_SAMPLES && (p.avgMs > SLOW_AVG_MS || p.over >= 10);
    if (slow) warnings.push(`Its blocking rules are slow: a request takes about ${p.avgMs.toFixed(2)} ms to check here (the longest was ${p.maxMs.toFixed(1)} ms). Pages load slower while it runs.`);
    return {
      rulesets: [...e.rulesets.values()].map(r => ({ id: r.id, enabled: r.enabled && !r.error, rules: r.rules.length, error: r.error })),
      dynamicRules: e.dynamic.size, sessionRules: e.session.size, regexRules: e.regexCount,
      requests: p.requests, avgMs: Number(p.avgMs.toFixed(4)), maxMs: Number(p.maxMs.toFixed(3)), slow, warnings,
    };
  }
  // The most any engine on this partition reported as slow: for a quick check.
  function resetStats(partition, extId) { const e = engines.get(`${partition}|${extId}`); if (e) e.perf = { requests: 0, avgMs: 0, maxMs: 0, over: 0, totalMs: 0 }; }
  function forgetTab(partition, tabId) { allowAll.delete(`${partition}|${tabId}`); }

  return { register, unregister, hasRules, evaluate, api, status, resetStats, forgetTab, applyHeaderOps };
}

module.exports = { createExtensionDnr, compileRule, checkRegex, normalizeRequest, applyHeaderOps, buildIndex, matchIndex, redirectTarget,
  parseUrlFilter, buildGlob, LIMITS, TYPES };
