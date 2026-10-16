'use strict';
// === "Is the site down, or is it my bypass?" (T2-076) =========================
//
// Compares two ways of reaching one address: straight from this computer, and
// through the bypass the person already set up for the Discord or Roblox panel
// (the proxy rules Vex is using right now). It is read-only:
//
//   - it only SENDS ONE REQUEST per route to the address asked about;
//   - it never starts, stops, restarts or changes a bypass, a proxy of the
//     panels, ByeDPI, Zapret or winws. Starting or stopping winws during a game
//     that Game Control Center protects is exactly what must never happen, and
//     this does neither: it reads the rules and uses them on a session of its own;
//   - the two probe sessions are Vex's own throw-away ones, in memory, with no
//     cookies and no cache.
//
// The verdict says which side is broken, in words.

const MAX_URL = 2048;

function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').slice(0, MAX_URL)); } catch { throw new Error('That is not a web address'); }
  if (u.protocol !== 'https:') throw new Error('Only https addresses can be checked');
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan|home)$/.test(h)) {
    throw new Error('Only sites on the internet can be checked, not this computer or your home network');
  }
  u.username = ''; u.password = ''; u.hash = '';
  return u.href;
}

// direct / bypassed: { ok, ms, error? } or null when there is no bypass to try.
function classify({ direct, bypassed }) {
  if (!direct) throw new Error('classify needs the direct result');
  if (!bypassed) {
    return direct.ok
      ? { verdict: 'up', text: 'The site answers directly. No bypass is on, so it is not in the way.' }
      : { verdict: 'down-no-bypass', text: 'The site does not answer directly and no bypass is on. Either the site is down or your network blocks it. If it is a blocked site, a bypass may help; if other sites fail too, it is your connection.' };
  }
  if (direct.ok && bypassed.ok) return { verdict: 'up', text: 'The site answers both directly and through your bypass. It is up and your bypass is working.' };
  if (!direct.ok && bypassed.ok) return { verdict: 'bypass-carries', text: 'Blocked directly, reachable through your bypass. The site is up and your bypass is doing its job.' };
  if (direct.ok && !bypassed.ok) return { verdict: 'bypass-broken', text: 'Reachable directly but not through your bypass. The site is up; your bypass is the broken side.' };
  return { verdict: 'down', text: 'Neither route reaches it. The site (or your connection) is down; your bypass is not the cause.' };
}

// request(url, route, timeoutMs) -> Promise<{ ok, ms, status?, error? }>
//   route: { kind: 'direct' } | { kind: 'bypass', rules }
// rules(host) -> the proxy rules the person's bypass uses for that host now, or null when none is on.
function createBypassProbe({ request, rules, timeoutMs = 6000 }) {
  if (typeof request !== 'function' || typeof rules !== 'function') throw new Error('createBypassProbe needs request and rules');
  return {
    checkUrl,
    async probe(raw) {
      const url = checkUrl(raw);
      const host = new URL(url).hostname;
      const r = rules(host);
      const direct = await request(url, { kind: 'direct' }, timeoutMs);
      const bypassed = r ? await request(url, { kind: 'bypass', rules: r }, timeoutMs) : null;
      return { url, host, direct, bypassed, bypassLabel: r ? labelOf(r) : null, ...classify({ direct, bypassed }) };
    },
  };
}

// A label for the rules without the address details.
function labelOf(rules) {
  const s = String(rules);
  if (/^socks/i.test(s)) return 'ByeDPI (strong)';
  if (/^https?=/i.test(s) || /http=/.test(s)) return 'the built-in light bypass';
  return 'your proxy';
}

module.exports = { createBypassProbe, classify, checkUrl, labelOf };
