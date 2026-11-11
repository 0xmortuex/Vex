// === A page the person opened themselves may hand off to another program =======
//
// A link to another program (roblox-player:, mailto:, zoommtg: ...) is only followed shortly after a click or a key
// press ON THE PAGE (main.js, handleExternalProtocol): a page or an ad frame doing it by itself is refused without a
// word. But a page the person has just opened is their doing too, and some pages exist only to hand off: a Roblox
// invite link (www.roblox.com/share?code=...) loads, asks Roblox where the invite goes, moves to a second page and
// starts the Roblox app, with no click anywhere. Pasted into the address bar it did nothing at all in Vex and worked
// in Chrome (found 2026-11-11); so did the same link arriving from Discord or another program.
//
// This file keeps who was opened by the person, for how long:
//   started(id)      a page the person has just sent somewhere (typed or pasted an address, picked a suggestion,
//                    pressed Reload): from now until `windowMs` later, or until `afterLoadMs` after the page has
//                    finished loading if that is later, that page may ask to open another program as if it had
//                    been clicked. A page that never finishes loading stops counting after `maxLoadMs`.
//   expect(url)      a tab is about to be made for this address by the person (a link from another program, a link
//                    they clicked in another tab, a bookmark): the page that starts loading exactly that address
//                    within `claimMs` gets the same, once.
//   claim(id, url)   main calls this for every page that starts loading; true when it took an expected address.
//   loaded(id)       the page finished loading.
//   allows(id)       may this page hand off now, with no click on it?
//
// It grants nothing by itself: the question "<site> wants to open Roblox" is still asked (or its remembered answer
// used), and a private, off-the-record or Tor page is refused before any of this is looked at. A page that reloads
// or redirects itself later, a restored session and a background tab nobody opened get nothing.
'use strict';

const WINDOW_MS = 30 * 1000;
const AFTER_LOAD_MS = 10 * 1000;
const MAX_LOAD_MS = 2 * 60 * 1000;
const CLAIM_MS = 15 * 1000;
const MAX_EXPECTED = 20;

function sameAddress(a, b) {
  try { return new URL(String(a)).href === new URL(String(b)).href; } catch { return false; }
}

function createPersonNav({ now = () => Date.now(), windowMs = WINDOW_MS, afterLoadMs = AFTER_LOAD_MS, maxLoadMs = MAX_LOAD_MS, claimMs = CLAIM_MS } = {}) {
  const grants = new Map();   // page id -> { at, until, loading }
  let expected = [];          // [{ url, at }]

  function started(id) {
    if (!Number.isSafeInteger(id)) throw new Error('person-nav: a page id is needed');
    const t = now();
    grants.set(id, { at: t, until: t + windowMs, loading: true });
  }
  function loaded(id) {
    const g = grants.get(id);
    if (!g || !g.loading) return;
    g.loading = false;
    g.until = Math.max(g.until, now() + afterLoadMs);
  }
  function allows(id) {
    const g = grants.get(id);
    if (!g) return false;
    const t = now();
    if (g.loading ? t - g.at <= maxLoadMs : t <= g.until) return true;
    grants.delete(id);
    return false;
  }
  function expect(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 8192) return false;
    const t = now();
    expected = expected.filter(e => t - e.at <= claimMs).slice(-(MAX_EXPECTED - 1));
    expected.push({ url, at: t });
    return true;
  }
  function claim(id, url) {
    if (!expected.length) return false;
    const t = now();
    expected = expected.filter(e => t - e.at <= claimMs);
    const i = expected.findIndex(e => sameAddress(e.url, url));
    if (i === -1) return false;
    expected.splice(i, 1);
    started(id);
    return true;
  }
  function forget(id) { grants.delete(id); }

  return { started, loaded, allows, expect, claim, forget, _size: () => ({ grants: grants.size, expected: expected.length }) };
}

module.exports = { createPersonNav, sameAddress, WINDOW_MS, AFTER_LOAD_MS, MAX_LOAD_MS, CLAIM_MS, MAX_EXPECTED };
