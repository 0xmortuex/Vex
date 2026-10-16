// === Sending a version review to the owner's relay (optional, off by default) =
//
// A person who turned on "Send my reviews" and pasted the address of a relay
// they (or the owner) deployed from workers/feedback/ can have each finished
// review sent. This module is the ONLY place that builds and sends it, so the
// list of what leaves the computer is one list, here:
//
//   installId  a random id made on this computer (resettable), not tied to
//              any account, device, name or address
//   version    the Vex version that was reviewed
//   ratings    1 to 5 for each category the person rated
//   chips      the "what you experienced" tags the person picked
//   comment    the optional text, at most 500 characters
//
// Never sent: history, pages, URLs, accounts, hardware ids, anything derived
// from the address, other settings, the date (the relay stamps its own).
//
// The request goes through the bounded fetch with an egress hint, so it shows
// in "what left this computer" (Settings, ledger) under "Version review".
//
// createFeedbackRelay({ fetch }) so tests can pass a local stand-in.

const { isPrivateHost } = require('../renderer/js/private-address');

const CATEGORIES = ['speed', 'stability', 'design', 'features', 'ai', 'privacy', 'games'];
const CHIPS = ['bug', 'slow', 'crash', 'loved', 'missing', 'smooth'];
const ALLOWED_KEYS = ['installId', 'version', 'ratings', 'chips', 'comment'];
const MAX_COMMENT = 500;
const MAX_BYTES = 2048;
const ID_RE = /^[0-9a-f]{32}$/;
const VERSION_RE = /^\d{1,4}(?:\.\d{1,5}){1,3}(?:[-+][0-9A-Za-z.-]{1,20})?$/;
const TIMEOUT_MS = 10000;
const SECRET_QUERY = /(?:^|[_-])(token|key|secret|password|passwd|pwd|auth|sig|signature|apikey|api_key|access_token|bearer)$/i;

// Judges the relay address. Returns the base URL without a trailing slash, or
// throws why not. Empty is not allowed here: the caller treats "empty" as
// "local only" before it ever gets this far.
function checkRelayUrl(href) {
  const raw = String(href == null ? '' : href).trim();
  if (!raw) throw new Error('No relay address is set');
  if (raw.length > 300) throw new Error('That address is too long');
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a web address'); }
  if (u.protocol !== 'https:') throw new Error('Only https addresses are used');
  if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
  if (u.search || u.hash) throw new Error('The address must not have a query or a fragment');
  for (const k of u.searchParams.keys()) if (SECRET_QUERY.test(k)) throw new Error('Do not put a key or token in the address');
  if (isPrivateHost(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Addresses on this machine or the local network are not used');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

// Builds the payload from a stored review and the install id. Pure. It copies
// ONLY the allowed fields, so a review that grows other fields later (a date,
// a note about sending) can never leak them.
function buildPayload(review, installId) {
  if (!review || typeof review !== 'object') throw new Error('There is no review to send');
  const ratings = {};
  for (const c of CATEGORIES) {
    const n = review.ratings && review.ratings[c];
    if (n === undefined) continue;
    ratings[c] = n;
  }
  const payload = {
    installId,
    version: review.version,
    ratings,
    chips: Array.isArray(review.chips) ? review.chips.slice() : [],
    comment: typeof review.comment === 'string' ? review.comment : '',
  };
  validatePayload(payload);
  return payload;
}

// Throws why a payload may not be sent. Strict: unknown keys, wrong types,
// unknown categories or chips, and anything over 2 KB are refused.
function validatePayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('The review is not in a form that can be sent');
  const extra = Object.keys(p).filter(k => !ALLOWED_KEYS.includes(k));
  if (extra.length) throw new Error('The review has fields that are never sent: ' + extra.join(', '));
  if (typeof p.installId !== 'string' || !ID_RE.test(p.installId)) throw new Error('The anonymous id is not valid');
  if (typeof p.version !== 'string' || !VERSION_RE.test(p.version)) throw new Error('The version is not valid');
  if (!p.ratings || typeof p.ratings !== 'object' || Array.isArray(p.ratings)) throw new Error('The ratings are not valid');
  for (const [k, v] of Object.entries(p.ratings)) {
    if (!CATEGORIES.includes(k)) throw new Error('Unknown rating category: ' + k);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error('A rating is a whole number from 1 to 5');
  }
  if (!Array.isArray(p.chips) || p.chips.length > CHIPS.length || new Set(p.chips).size !== p.chips.length) throw new Error('The tags are not valid');
  for (const c of p.chips) if (!CHIPS.includes(c)) throw new Error('Unknown tag: ' + String(c).slice(0, 20));
  if (typeof p.comment !== 'string' || Array.from(p.comment).length > MAX_COMMENT) throw new Error('The comment is longer than ' + MAX_COMMENT + ' characters');
  if (!Object.keys(p.ratings).length && p.comment.trim().length < 10) throw new Error('An empty review is not sent');
  if (Buffer.byteLength(JSON.stringify(p), 'utf8') > MAX_BYTES) throw new Error('The review is larger than ' + MAX_BYTES + ' bytes');
  return true;
}

function createFeedbackRelay({ fetch } = {}) {
  if (typeof fetch !== 'function') throw new Error('createFeedbackRelay needs a fetch');

  // url: the relay's base address. payload: validated again here, because a
  // window is not trusted to have built it.
  async function send(url, payload) {
    const base = checkRelayUrl(url);
    validatePayload(payload);
    let res;
    try {
      res = await fetch(base + '/v1/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        credentials: 'omit',
        timeoutMs: TIMEOUT_MS,
        maxBytes: 4096,
        egress: { feature: 'Version review', kind: 'fetch' },
      });
    } catch (err) {
      throw new Error('Could not reach the relay: ' + (err && err.message ? err.message : String(err)), { cause: err });
    }
    let data;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || ('The relay answered ' + res.status));
    return { ok: true };
  }

  return { send };
}

module.exports = { createFeedbackRelay, checkRelayUrl, buildPayload, validatePayload, CATEGORIES, CHIPS, ALLOWED_KEYS, MAX_COMMENT, MAX_BYTES };
