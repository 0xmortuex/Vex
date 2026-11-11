// === Is this computer's clock right? (for the Authenticator) ==================
//
// A 2FA code is made from the time (RFC 6238, 30-second steps). A PC clock that is 19 seconds fast shows the NEXT
// step's code early and the site answers "Invalid two-factor code" (found 2026-11-10: Discord refused every code; the
// PC drifts about 12 seconds a day and Windows had last set it a day and a half before). Nothing in Vex was wrong and
// nothing said why.
//
// This file measures how far the PC clock is from a web server's clock: one HEAD request, whose `Date` header is the
// server's time in whole seconds. It carries no cookies and no account; it tells that one host that someone asked for
// its page, nothing more. main.js asks when the Authenticator shows or fills a code.
//
// What is done with the answer:
//   - a clock within WARN_SECONDS of the server's is RIGHT and is left alone: the codes come from the PC clock and
//     nothing depends on the server. That answer is kept for ten minutes.
//   - a clock further off is WRONG: the panel says so, and (unless the person turned it off) the codes are made from
//     the measured time instead. That answer is kept for a minute only.
//   - elapsed time is followed on a clock that only counts (`mono`), so the moment the PC clock is set, by the person
//     or by Windows, the old answer no longer adds up and is thrown away; the corrected time never jumps with it.
//   - no answer (offline, a slow or unreadable reply): the PC clock is used, and nothing is asked again for a minute.
//
// A wrong answer here would be worse than none: it would "correct" a clock that is right and make every code
// wrong. The probe sits behind a cache (Varnish, s-maxage=3600), and a cache may hand out a stored answer with
// the `Date` it had when it was stored. So: the request asks not to be answered from a cache and is not kept in
// Vex's own; an answer that says it came from one (an `Age` above zero) is not used; and a clock is only called
// wrong when a SECOND request agrees with the first to within two seconds.
'use strict';

const PROBE_URL = 'https://detectportal.firefox.com/canonical.html';
const WARN_SECONDS = 5;
const CACHE_MS = 10 * 60 * 1000;
const WRONG_CACHE_MS = 60 * 1000;
const FAIL_RETRY_MS = 60 * 1000;
// The PC clock and the counting clock disagreeing by more than this since the measurement: the PC clock was set.
const JUMP_MS = 2000;
// A slow answer cannot be placed in time well enough to judge a clock by.
const MAX_ROUND_TRIP_MS = 4000;
// How long a code waits for a first measurement before it is made from the PC clock.
const CODE_WAIT_MS = 1500;
// A clock is called wrong only when two requests say so and differ by no more than this.
const AGREE_MS = 2000;

// PC clock minus server clock, in ms (positive: the PC is ahead). The server stamped its answer somewhere between the
// request leaving and the answer arriving, and a `Date` header drops the fraction of the second (half a second on average).
function offsetMs(dateHeader, sentAt, receivedAt) {
  const server = Date.parse(String(dateHeader || ''));
  if (!Number.isFinite(server)) throw new Error('clock check: the answer had no readable Date header');
  if (!Number.isFinite(sentAt) || !Number.isFinite(receivedAt) || receivedAt < sentAt) throw new Error('clock check: the request times are not valid');
  if (receivedAt - sentAt > MAX_ROUND_TRIP_MS) throw new Error('clock check: the answer was too slow to measure the clock by');
  return Math.round((sentAt + receivedAt) / 2 - (server + 500));
}

// The request itself, over Electron's `net` (passed in, so a test can pass a stand-in).
// → (url) => Promise<{ status, date, sentAt, receivedAt }>
function createRequest(net, { timeoutMs = 6000, now = () => Date.now() } = {}) {
  return (url) => new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'HEAD', credentials: 'omit', useSessionCookies: false, cache: 'no-store' });
    req.setHeader('Cache-Control', 'no-cache');
    req.setHeader('Pragma', 'no-cache');
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { req.abort(); } catch { /* vex-allow-empty-catch: aborting a request that has already finished or failed is not an error */ } finish(reject, new Error('clock check: timed out')); }, timeoutMs);
    let sentAt = 0;
    req.on('response', (res) => {
      const receivedAt = now();
      const date = [].concat(res.headers.date || [])[0] || '';
      // Seconds the answer sat in a cache, when a cache says so.
      const age = Number([].concat(res.headers.age || [])[0] || 0) || 0;
      res.on('data', () => {});
      res.on('error', () => {});
      finish(resolve, { status: res.statusCode, date, age, sentAt, receivedAt });
    });
    req.on('error', (err) => finish(reject, err));
    sentAt = now();
    req.end();
  });
}

// TEST ONLY: VEX_CLOCK_PROBE=http://127.0.0.1:<port>/ replaces the probe with a local stand-in, so a wrong clock can
// be shown in the real app without setting the PC's. Anything but a local http address is refused.
function probeUrlFrom(env) {
  const raw = env && env.VEX_CLOCK_PROBE;
  if (!raw) return PROBE_URL;
  let u;
  try { u = new URL(String(raw)); } catch (err) { throw new Error('VEX_CLOCK_PROBE is not an address', { cause: err }); }
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.username || u.password) {
    throw new Error('VEX_CLOCK_PROBE must be a local address such as http://127.0.0.1:17200/');
  }
  return u.href;
}

// request(url) → { date, sentAt, receivedAt }. `now` is the PC clock, `mono` a clock that only counts (ms).
//   check()  → { offsetSeconds, wrong, ahead, checkedAt }; rejects when the clock could not be measured.
//   time()   → { now, known, wrong, offsetSeconds }: `now` is the measured time when the clock is known, the PC clock
//              when it is not. Never rejects, and waits at most `waitMs` for a first measurement.
function createClockCheck({ request, now = () => Date.now(), mono = () => performance.now(), cacheMs = CACHE_MS, probeUrl = PROBE_URL }) {
  if (typeof request !== 'function') throw new Error('createClockCheck: request is missing');
  let last = null;        // { offsetMs, wallAt, monoAt }
  let failedAt = null;    // mono time of the last failed measurement
  let running = null;

  const wrongBy = (ms) => Math.abs(Math.round(ms / 1000)) >= WARN_SECONDS;
  // Did the PC clock move by something other than time passing since the measurement?
  const jumped = () => Math.abs((now() - last.wallAt) - (mono() - last.monoAt)) > JUMP_MS;
  function fresh() {
    if (!last) return false;
    if (jumped()) { last = null; return false; }
    return mono() - last.monoAt < (wrongBy(last.offsetMs) ? Math.min(WRONG_CACHE_MS, cacheMs) : cacheMs);
  }
  const view = () => {
    const offsetSeconds = Math.round(last.offsetMs / 1000);
    return { offsetSeconds, wrong: wrongBy(last.offsetMs), ahead: offsetSeconds > 0, checkedAt: last.wallAt };
  };
  // The measured time now: where the server's clock was when it answered, plus the time counted since.
  const measuredNow = () => Math.round(last.wallAt - last.offsetMs + (mono() - last.monoAt));

  // One request -> PC clock minus server clock, in ms. An answer out of a cache is not a measurement.
  async function once() {
    const r = await request(probeUrl);
    if (r && r.age > 0) throw new Error('clock check: the answer came from a cache (' + r.age + ' s old), so it does not say what time it is');
    return offsetMs(r && r.date, r && r.sentAt, r && r.receivedAt);
  }

  function measure() {
    if (!running) {
      running = (async () => {
        try {
          let ms = await once();
          if (wrongBy(ms)) {
            // Being wrong about this breaks every code, so it is asked twice (see the top).
            const again = await once();
            if (Math.abs(again - ms) > AGREE_MS) throw new Error('clock check: two answers disagreed (' + Math.round(ms / 1000) + ' s and ' + Math.round(again / 1000) + ' s), so neither is used');
            ms = again;
          }
          last = { offsetMs: ms, wallAt: now(), monoAt: mono() };
          failedAt = null;
        } catch (err) {
          failedAt = mono();
          throw err;
        } finally { running = null; }
      })();
    }
    return running;
  }

  async function check() {
    if (!fresh()) await measure();
    return view();
  }

  async function time({ waitMs = CODE_WAIT_MS } = {}) {
    const pc = () => ({ now: now(), known: false, wrong: false, offsetSeconds: 0 });
    if (!fresh()) {
      if (failedAt !== null && mono() - failedAt < FAIL_RETRY_MS) return pc();
      let timer;
      const waited = await Promise.race([
        measure().then(() => true, () => false),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), waitMs); }),
      ]);
      clearTimeout(timer);
      if (!waited || !last) return pc();
    }
    const v = view();
    return { now: measuredNow(), known: true, wrong: v.wrong, offsetSeconds: v.offsetSeconds };
  }

  return { check, time };
}

module.exports = { PROBE_URL, WARN_SECONDS, CACHE_MS, WRONG_CACHE_MS, FAIL_RETRY_MS, JUMP_MS, MAX_ROUND_TRIP_MS, CODE_WAIT_MS, AGREE_MS, offsetMs, probeUrlFrom, createRequest, createClockCheck };
