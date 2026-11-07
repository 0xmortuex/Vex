// === Check my connection speed ============================================================================
//
// One explicit press downloads a fixed payload from one fixed host and says how fast it arrived. Nothing here runs by itself.
//
//   host      speed.cloudflare.com (Cloudflare's public speed-test endpoint), path /__down?bytes=N
//   payload   SIZE_BYTES (10,000,000) of generated filler, nothing about the person is sent: a plain GET with no cookies
//   ledger    the request goes through the app's egress-ledger fetch under the feature label "Speed test"
//
// The speed is the bytes after the first one, divided by the time from the first chunk to the last, so the wait for the first byte
// (the round trip) is not counted as slow transfer. A server that sends more than asked, answers from another host, or is
// still going after TIMEOUT_MS is stopped and the test fails out loud; there is no second host.
const HOST = 'speed.cloudflare.com';
const SIZE_BYTES = 10 * 1000 * 1000;
const TIMEOUT_MS = 20000;
const URL_OF = (bytes) => 'https://' + HOST + '/__down?bytes=' + bytes;

// Megabits per second from a byte count and a time. Pure.
function mbps(bytes, ms) {
  if (!(bytes > 0) || !(ms > 0)) throw new Error('There is nothing to measure');
  return (bytes * 8) / (ms / 1000) / 1e6;
}

// fetchImpl: the ledgered fetch. now: a clock (ms). → { ok:true, bytes, ms, mbps }.
async function runSpeedTest({ fetchImpl, now = Date.now, bytes = SIZE_BYTES, timeoutMs = TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch function is needed for the speed test');
  if (!Number.isInteger(bytes) || bytes < 100000 || bytes > 100 * 1000 * 1000) throw new Error('The test size is not allowed');
  const controller = new AbortController();
  const timer = setTimer(() => controller.abort(), timeoutMs);
  try {
    let res;
    try { res = await fetchImpl(URL_OF(bytes), { signal: controller.signal, redirect: 'error', headers: { 'Cache-Control': 'no-cache' } }); }
    catch (err) {
      if (controller.signal.aborted) throw new Error('The speed test took longer than ' + Math.round(timeoutMs / 1000) + ' seconds and was stopped', { cause: err });
      throw err;
    }
    if (!res || !res.ok) throw new Error('The speed test server answered ' + (res ? res.status : 'nothing'));
    if (res.url && new URL(res.url).hostname !== HOST) throw new Error('The speed test was sent to an unexpected host');
    if (!res.body || typeof res.body.getReader !== 'function') throw new Error('The speed test got no data');
    const reader = res.body.getReader();
    let received = 0, counted = 0, first = null, last = null;
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); }
      catch (err) {
        if (controller.signal.aborted) throw new Error('The speed test took longer than ' + Math.round(timeoutMs / 1000) + ' seconds and was stopped', { cause: err });
        throw err;
      }
      if (chunk.done) break;
      const t = now();
      received += chunk.value.length;
      if (received > bytes) { controller.abort(); throw new Error('The server sent more than the ' + bytes + ' bytes that were asked for. The test was stopped.'); }
      if (first === null) first = t; else counted += chunk.value.length;
      last = t;
    }
    if (received !== bytes) throw new Error('The speed test received ' + received + ' of ' + bytes + ' bytes');
    const ms = last - first;
    if (!(ms > 0) || !(counted > 0)) throw new Error('The transfer was too quick to measure; try again');
    return { ok: true, bytes: counted, ms, mbps: mbps(counted, ms) };
  } finally { clearTimer(timer); }
}

module.exports = { runSpeedTest, mbps, HOST, SIZE_BYTES, TIMEOUT_MS, URL_OF };
