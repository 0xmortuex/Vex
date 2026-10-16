// === Status pages: is it them? (T3-016) ======================================
//
// "Is it me or the game?" has two halves. The first is a plain TCP timing to a
// few hosts (main/latency.js, already there). The second is what the services
// themselves say: most of them publish a public status page in the Atlassian
// "Statuspage" format (Discord, GitHub, Cloudflare, Roblox, Epic Games ...), a
// small JSON document anyone can read at <site>/api/v2/summary.json.
//
// This reads exactly that, for the pages the person listed, and nothing else:
//   - https only, a public host only (the fetch given in is the public-only one,
//     which re-checks every redirect; the address is also judged here so the
//     refusal says why), no user name or password in the address;
//   - only the summary document: the address is the site's own, plus the fixed
//     path /api/v2/summary.json; a full address is accepted only if it already
//     ends in /api/v2/summary.json or /api/v2/status.json;
//   - read-only GETs, bounded in size and time, sent without cookies, never to a
//     game server and never with anything of the person's in them.
//
// createStatusCheck({ publicFetch }) so a test can pass a local stand-in.

const { isPrivateHost } = require('../renderer/js/private-address');

const MAX_PAGES = 12;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;
const INDICATORS = ['none', 'minor', 'major', 'critical'];

// The document address for a status page the person listed. Throws why not.
function summaryUrl(input) {
  const text = String(input == null ? '' : input).trim();
  if (!text || text.length > 300) throw new Error('A status page address is up to 300 characters');
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text); } catch { throw new Error('"' + text.slice(0, 60) + '" is not a web address'); }
  if (u.protocol !== 'https:') throw new Error('Only https status pages are read');
  if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
  if (isPrivateHost(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Addresses on this machine or the local network are not read');
  u.search = ''; u.hash = '';
  const p = u.pathname.replace(/\/+$/, '');
  if (p === '') u.pathname = '/api/v2/summary.json';
  else if (!/\/api\/v2\/(summary|status)\.json$/.test(p)) throw new Error('Give the status site\'s address (like status.example.com), not a page inside it');
  return u.href;
}

// The reading of one Statuspage document. Throws for something that is not one.
function parse(json) {
  if (!json || typeof json !== 'object' || !json.status || typeof json.status !== 'object') throw new Error('That is not a status page document');
  const indicator = String(json.status.indicator || '');
  if (!INDICATORS.includes(indicator)) throw new Error('The status page gave an unknown state: ' + indicator.slice(0, 20));
  const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const incidents = (Array.isArray(json.incidents) ? json.incidents : []).slice(0, 5)
    .map(i => ({ name: clip(i && i.name, 120), impact: clip(i && i.impact, 20), status: clip(i && i.status, 30) }));
  return { name: clip(json.page && json.page.name, 60), indicator, description: clip(json.status.description, 120), incidents };
}

function createStatusCheck({ publicFetch, now = () => Date.now() } = {}) {
  if (typeof publicFetch !== 'function') throw new Error('createStatusCheck needs a public-only fetch');

  async function one(input) {
    const href = summaryUrl(input);   // a bad address is the caller's error, not "the page is down"
    const started = now();
    let res;
    try { res = await publicFetch(href, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, egress: { feature: 'Status check', kind: 'fetch' } }); }
    catch (err) { return { url: href, host: new URL(href).hostname, ok: false, error: 'Could not reach it: ' + err.message, ms: now() - started }; }
    const ms = now() - started;
    const host = new URL(href).hostname;
    if (!res.ok) return { url: href, host, ok: false, error: 'It answered ' + res.status, ms };
    let body;
    try { body = parse(await res.json()); }
    catch (err) { return { url: href, host, ok: false, error: err.message, ms }; }
    return { url: href, host, ok: true, ms, ...body };
  }

  async function check(list) {
    if (!Array.isArray(list) || !list.length) throw new Error('List at least one status page');
    if (list.length > MAX_PAGES) throw new Error('At most ' + MAX_PAGES + ' status pages at once');
    return Promise.all(list.map(one));
  }

  return { check, one };
}

module.exports = { createStatusCheck, summaryUrl, parse, MAX_PAGES, INDICATORS };
