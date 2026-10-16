// === Response overrides and header rules (developer tool) =====================
//
// While building a page it helps to answer one request with text you wrote (an
// API returning the error you need to test), or to add one request or response
// header on localhost. This is that, with every guard a tool like this needs:
//
//   * OFF by default. The rules are saved, but "active" lives in memory only and
//     is false whenever Vex starts, so a rule can never silently survive a restart.
//   * A PER-ORIGIN allowlist. A rule acts only on a page whose origin the person
//     listed (http://localhost:3000), never on "every site".
//   * Never on a bank, a payment page, a password manager or a sign-in page, in a
//     private window, a burner/New Identity session or a Tor tab, whatever the list says.
//   * The window shows a banner for as long as an override is live on the page
//     (js/response-overrides-ui.js), with a button that switches it off.
//   * A file is served only if the person chose it with the file picker; nothing
//     else on the disk can be named. Cookies and credentials cannot be edited.
//
// A body override answers the request with a data: address (the same single
// onBeforeRequest listener the blocker uses redirects there); request and response
// headers are changed from the single onBeforeSendHeaders / onHeadersReceived
// listeners each session has. It uses no second listener, so it cannot replace
// the blocker's, the Client Hints rewrite or an extension's rules.

const MAX_ORIGINS = 20;
const MAX_RULES = 50;
const MAX_INLINE = 256 * 1024;
const MAX_FILE = 1024 * 1024;
const FORBIDDEN_HEADERS = new Set(['cookie', 'set-cookie', 'set-cookie2', 'authorization', 'proxy-authorization', 'host', 'content-length', 'transfer-encoding']);
const SENSITIVE_HOST = /(^|[.-])(paypal|stripe|payoneer|wise|revolut|coinbase|binance|kraken|1password|bitwarden|lastpass|dashlane|keepass|okta|auth0)([.-]|$)|bank|banking|vault|passw|signin|sign-in|login\.|accounts?\.|secure\./i;

function originOf(url) {
  try {
    const u = new URL(String(url));
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch { return null; }
}
const isLocalOrigin = (origin) => /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);

// A host the tool refuses for ever. A local origin is always allowed.
function isSensitiveOrigin(origin) {
  if (isLocalOrigin(origin)) return false;
  let host;
  try { host = new URL(origin).hostname; } catch { return true; }
  return SENSITIVE_HOST.test(host);
}

// "https://api.example.com/v1/*" -> a RegExp. "*" matches anything, the rest is literal.
function globToRegex(glob) {
  const body = String(glob).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + '$', 'i');
}

function cleanRule(r, i, grantedFiles, savedFiles) {
  const where = 'Rule ' + (i + 1);
  if (!r || typeof r !== 'object') throw new Error(where + ' is not a rule');
  const kind = r.kind;
  if (!['body', 'reqHeader', 'resHeader'].includes(kind)) throw new Error(where + ': the kind must be body, reqHeader or resHeader');
  const origin = originOf(r.origin);
  if (!origin) throw new Error(where + ': the origin must be an http or https address like http://localhost:3000');
  if (isSensitiveOrigin(origin)) throw new Error(where + ': ' + origin + ' looks like a bank, payment, password or sign-in site, which this tool never touches');
  const pattern = String(r.pattern || '').trim();
  if (!/^https?:\/\//i.test(pattern)) throw new Error(where + ': the address pattern must start with http:// or https://');
  if (pattern.length > 500) throw new Error(where + ': the address pattern is too long');
  const out = { id: String(r.id || 'r' + (i + 1)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'r' + (i + 1), kind, origin, pattern, note: String(r.note || '').slice(0, 120) };
  if (kind === 'body') {
    out.contentType = String(r.contentType || 'application/json').replace(/[^A-Za-z0-9/+.;=\- ]/g, '').slice(0, 100) || 'application/json';
    if (r.file) {
      const file = String(r.file);
      if (!grantedFiles.has(file) && !savedFiles.has(file)) throw new Error(where + ': a file can only be one you chose with the file picker');
      out.file = file;
    } else {
      const inline = String(r.inline == null ? '' : r.inline);
      if (inline.length > MAX_INLINE) throw new Error(where + ': the text is larger than ' + (MAX_INLINE / 1024) + ' KB');
      out.inline = inline;
    }
  } else {
    const name = String(r.name || '').trim();
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/.test(name)) throw new Error(where + ': that is not a header name');
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new Error(where + ': ' + name + ' cannot be changed here (cookies, credentials and framing headers are off limits)');
    out.name = name;
    out.op = r.op === 'remove' ? 'remove' : 'set';
    if (out.op === 'set') {
      const value = String(r.value == null ? '' : r.value);
      if (/[\r\n]/.test(value) || value.length > 2000) throw new Error(where + ': the header value must be one line under 2000 characters');
      out.value = value;
    }
  }
  return out;
}

function createOverrides({ load, save, readFile, pageUrlOf = () => '' }) {
  let cfg = { origins: [], rules: [] };
  let active = false;                         // memory only: false at every start
  const grantedFiles = new Set();             // chosen with the picker since Vex started
  const fileCache = new Map();                // path -> { mtimeMs, b64 }
  const regexCache = new Map();

  try {
    const stored = load();
    if (stored && typeof stored === 'object') cfg = normalize(stored, new Set(), new Set((stored.rules || []).map(r => r && r.file).filter(Boolean)));
  } catch (err) {
    // A damaged file is reported, not replaced by an empty list that would later overwrite it.
    throw new Error('Response overrides: the saved rules could not be read: ' + err.message, { cause: err });
  }

  function normalize(input, granted, saved) {
    if (!input || typeof input !== 'object') throw new Error('The overrides are not readable');
    const originsIn = Array.isArray(input.origins) ? input.origins : [];
    const rulesIn = Array.isArray(input.rules) ? input.rules : [];
    if (originsIn.length > MAX_ORIGINS) throw new Error('At most ' + MAX_ORIGINS + ' origins');
    if (rulesIn.length > MAX_RULES) throw new Error('At most ' + MAX_RULES + ' rules');
    const origins = [];
    for (const o of originsIn) {
      const origin = originOf(o);
      if (!origin) throw new Error(String(o).slice(0, 80) + ' is not an http or https origin');
      if (isSensitiveOrigin(origin)) throw new Error(origin + ' looks like a bank, payment, password or sign-in site, which this tool never touches');
      if (!origins.includes(origin)) origins.push(origin);
    }
    const rules = rulesIn.map((r, i) => cleanRule(r, i, granted, saved));
    const seen = new Set();
    for (const r of rules) { if (seen.has(r.id)) throw new Error('Two rules share the id ' + r.id); seen.add(r.id); }
    return { origins, rules };
  }

  const get = () => ({ origins: cfg.origins.slice(), rules: cfg.rules.map(r => ({ ...r })), active });
  function set(input) {
    const saved = new Set(cfg.rules.map(r => r.file).filter(Boolean));
    const next = normalize(input, grantedFiles, saved);
    save(next);
    cfg = next;
    regexCache.clear();
    return get();
  }
  const setActive = (on) => { active = on === true; return active; };
  const grantFile = (p) => { grantedFiles.add(String(p)); };

  const rx = (pattern) => { let r = regexCache.get(pattern); if (!r) { r = globToRegex(pattern); regexCache.set(pattern, r); } return r; };

  // The page origin a request belongs to, when the tool may act on it at all.
  function eligibleOrigin(ses, details) {
    if (!active || !cfg.rules.length) return null;
    if (ses && (ses.__vexEphemeral || ses.__vexTor)) return null;
    const page = details.resourceType === 'mainFrame' ? details.url : (pageUrlOf(details.webContentsId) || details.referrer || '');
    const origin = originOf(page);
    if (!origin || !cfg.origins.includes(origin) || isSensitiveOrigin(origin)) return null;
    const target = originOf(details.url);
    if (!target || isSensitiveOrigin(target)) return null;
    return origin;
  }
  const matching = (origin, kind, url) => cfg.rules.filter(r => r.kind === kind && r.origin === origin && rx(r.pattern).test(url));

  function fileData(p) {
    const stat = readFile.stat(p);
    if (stat.size > MAX_FILE) throw new Error('The file is larger than ' + (MAX_FILE / 1024) + ' KB');
    const hit = fileCache.get(p);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.b64;
    const b64 = readFile.read(p).toString('base64');
    fileCache.set(p, { mtimeMs: stat.mtimeMs, b64 });
    return b64;
  }

  // onBeforeRequest: { redirectURL } for a request a body rule answers, else null.
  function answer(ses, details) {
    const origin = eligibleOrigin(ses, details);
    if (!origin) return null;
    const rule = matching(origin, 'body', details.url)[0];
    if (!rule) return null;
    const b64 = rule.file ? fileData(rule.file) : Buffer.from(rule.inline, 'utf8').toString('base64');
    return { redirectURL: 'data:' + rule.contentType + ';base64,' + b64, ruleId: rule.id };
  }

  function applyOps(headers, rules) {
    for (const r of rules) {
      const key = Object.keys(headers).find(k => k.toLowerCase() === r.name.toLowerCase());
      if (r.op === 'remove') { if (key) delete headers[key]; continue; }
      if (key && key !== r.name) delete headers[key];
      headers[r.name] = r.value;
    }
  }
  function requestHeaders(ses, details, headers) {
    const origin = eligibleOrigin(ses, details);
    if (!origin) return false;
    const rules = matching(origin, 'reqHeader', details.url);
    if (rules.length) applyOps(headers, rules);
    return rules.length > 0;
  }
  function responseHeaders(ses, details, headers) {
    const origin = eligibleOrigin(ses, details);
    if (!origin) return false;
    const rules = matching(origin, 'resHeader', details.url);
    if (rules.length) applyOps(headers, rules.map(r => (r.op === 'set' ? { ...r, value: [r.value] } : r)));
    return rules.length > 0;
  }

  // What the banner needs for the page in front.
  function state(pageUrl) {
    const origin = originOf(pageUrl);
    const here = origin ? cfg.rules.filter(r => r.origin === origin).length : 0;
    return { active, origin, listed: !!origin && cfg.origins.includes(origin), rules: here, total: cfg.rules.length };
  }

  return { get, set, setActive, grantFile, answer, requestHeaders, responseHeaders, state };
}

module.exports = { createOverrides, originOf, isSensitiveOrigin, globToRegex, FORBIDDEN_HEADERS };
