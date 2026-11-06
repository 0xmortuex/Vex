// === Does this network want a sign-in? (captive portals) =======================
//
// Café, school and airport Wi-Fi answer every request with their own sign-in page until you sign in. In Vex that
// looks like "the page did not load": HTTPS-only upgrades the portal's plain-http page and the portal cannot
// answer it, and strict secure DNS never asks the portal's resolver at all. This file is the part that decides, from
// one plain-http request to a page whose answer is known, whether the network is open or is holding you at a
// sign-in, and where that sign-in is. It starts nothing: main.js asks it only when the person pressed
// "Is this a Wi-Fi sign-in?" (js/load-failure.js, Ctrl+K "Check If This Network Needs A Sign-In").
//
// The probe is Mozilla's detectportal.firefox.com/canonical.html: plain http (an https answer is exactly what a portal
// cannot give), the body is the word "success". The request carries no cookies and no account; it tells that one
// host that someone is on this network, nothing more.
'use strict';

const PROBE_URL = 'http://detectportal.firefox.com/canonical.html';
const EXPECTED_BODY = 'success';
const MAX_URL = 2048;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_HOSTS = 4;
const MAX_HOPS = 4;
const MIN_PAUSE = 1;
const MAX_PAUSE = 15;

// An http(s) address a sign-in page can be at: no credentials in it, not too long, not a script or a file.
function loginUrl(value, base) {
  try {
    const u = new URL(String(value), base);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.href.length > MAX_URL) return null;
    return u.href;
  } catch { return null; }
}

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

// A host name or an address literal, nothing else (these end up in HTTPS-only's "let this one through" list).
function validHost(h) {
  return typeof h === 'string' && h.length > 0 && h.length <= 253 && /^[a-z0-9]([a-z0-9.:-]*[a-z0-9])?$/i.test(h);
}

// res: { status, headers: { location }, body }. → { state: 'open' | 'portal' | 'unknown', loginUrl?, note }
function classify(res, probeUrl = PROBE_URL) {
  if (!res || typeof res.status !== 'number') return { state: 'unknown', note: 'The check got no answer it could read.' };
  const body = String(res.body == null ? '' : res.body).slice(0, 4096);
  const headers = res.headers || {};
  const location = headers.location || headers.Location || '';
  if (res.status === 200 && body.trim() === EXPECTED_BODY) {
    return { state: 'open', note: 'This network answered the check normally: it is not holding you at a sign-in.' };
  }
  if (REDIRECTS.has(res.status) || res.status === 511) {
    const to = location ? loginUrl(location, probeUrl) : null;
    // The probe's own host sending you elsewhere on itself (an upgrade to https) is not a portal.
    if (to && hostOf(to) !== hostOf(probeUrl)) {
      return { state: 'portal', loginUrl: to, note: 'This network sent the check to its own page, which is what a Wi-Fi sign-in does.' };
    }
    if (res.status === 511) return { state: 'portal', loginUrl: probeUrl, note: 'This network says it needs a login first (HTTP 511).' };
    return { state: 'unknown', note: 'The check was redirected, but not to another site, so it does not look like a sign-in.' };
  }
  if (res.status === 200 && body.trim()) {
    // A portal that answers in place instead of redirecting: any plain-http address shows its page.
    return { state: 'portal', loginUrl: probeUrl, note: 'This network answered the check with a page of its own instead of the real one.' };
  }
  return { state: 'unknown', note: 'The check answered ' + res.status + ', which says nothing about a sign-in.' };
}

// The request itself, over Electron's `net` (passed in, so a test can pass a stand-in). net.fetch cannot show where a
// redirect goes ("Redirect was cancelled"); net.request with redirect: 'manual' says so in its 'redirect' event, which is
// what a portal answers with (measured in Electron 42, 2026-11-06). No cookies, a few KB of body at most, a hard timeout.
// → (url) => Promise<{ status, headers: { location }, body }>
function createRequest(net, timeoutMs = 6000) {
  return (url) => new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'manual', useSessionCookies: false });
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { req.abort(); } catch { /* vex-allow-empty-catch: aborting a request that has already finished or failed is not an error */ } finish(reject, new Error('timed out')); }, timeoutMs);
    req.on('redirect', (status, _method, redirectUrl) => { try { req.abort(); } catch { /* vex-allow-empty-catch: aborting a request that has already finished or failed is not an error */ } finish(resolve, { status, headers: { location: redirectUrl }, body: '' }); });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => { if (body.length < 4096) body += chunk.toString('utf8'); });
      res.on('end', () => finish(resolve, { status: res.statusCode, headers: { location: [].concat(res.headers.location || [])[0] || '' }, body }));
      res.on('error', (err) => finish(reject, err));
    });
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

// Portals often hop through two or three hosts (the gateway, then the vendor's login server). HTTPS-only would upgrade
// every one of them and break the sign-in half-way, so the hosts of the whole chain are collected, up to MAX_HOPS
// requests, following only http(s) Location headers.
async function chainHosts(request, startUrl) {
  const hosts = [];
  let url = startUrl;
  for (let hop = 0; hop < MAX_HOPS && url; hop++) {
    const h = hostOf(url);
    if (h && !hosts.includes(h)) hosts.push(h);
    let res;
    try { res = await request(url); } catch { break; }
    const next = res && REDIRECTS.has(res.status) && res.headers && res.headers.location ? loginUrl(res.headers.location, url) : null;
    url = next;
  }
  return hosts;
}

// request(url) → { status, headers, body }, or rejects when nothing answered. Injected: main.js uses Electron's net.
// → { state, probe, status?, loginUrl?, hosts?, note }. `hosts` is what HTTPS-only should leave alone for the sign-in.
async function check(request, probeUrl = PROBE_URL) {
  let res;
  try { res = await request(probeUrl); }
  catch (err) {
    return { state: 'offline', probe: probeUrl, note: 'The check could not reach anything (' + String((err && err.message) || err).slice(0, 120) + ').' };
  }
  const result = { ...classify(res, probeUrl), probe: probeUrl, status: res && res.status };
  if (result.state === 'portal') {
    const hosts = new Set([hostOf(probeUrl)]);
    if (result.loginUrl && hostOf(result.loginUrl) !== hostOf(probeUrl)) for (const h of await chainHosts(request, result.loginUrl)) hosts.add(h);
    result.hosts = [...hosts].filter(validHost).slice(0, MAX_HOSTS);
  }
  return result;
}

// What the renderer sends back to allow: a short list of valid hosts. Throws on anything else.
function cleanHosts(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_HOSTS) throw new Error('captive: hosts must be a list of 1 to ' + MAX_HOSTS);
  const out = [];
  for (const h of value) {
    const bare = String(h).toLowerCase().replace(/^www\./, '');
    if (!validHost(bare)) throw new Error('captive: "' + String(h).slice(0, 40) + '" is not a host name');
    out.push(bare);
  }
  return [...new Set(out)];
}

function cleanPause(minutes) {
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n) || n < MIN_PAUSE || n > MAX_PAUSE) throw new Error('captive: pause is ' + MIN_PAUSE + ' to ' + MAX_PAUSE + ' minutes');
  return n;
}

module.exports = { PROBE_URL, loginUrl, validHost, classify, createRequest, check, cleanHosts, cleanPause, MIN_PAUSE, MAX_PAUSE, MAX_HOPS };
