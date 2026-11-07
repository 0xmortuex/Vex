// === When the main process itself stalls =====================================
//
// window-hang.js hears about a stuck WINDOW. Nothing watched the main process:
// a synchronous read, a long loop or a wedged native call there freezes every
// window at once, and afterwards there was no trace of what Vex was doing
// (audit A9). This watches the event loop with perf_hooks.monitorEventLoopDelay
// and, when it was blocked for over two seconds, writes one line in the crash
// log: how long, the last IPC channel that was handled and how long before, and
// the feature that channel belongs to ("settings:..." -> settings).
//
// Cost: the histogram is sampled every 100 ms inside Node (a few microseconds a
// second), and a check once every 2 s that reads one number; both timers are
// unref'd so they never hold Vex open. The log is rate-limited: at most one line
// a minute and ten a session, so a storm of stalls cannot fill it; the lines
// that were held back are counted in the next one. A stall that ends within
// 30 s of Windows resuming from sleep is the machine sleeping, not Vex, and is
// not written.
//
// The IPC tracker (noteIpc) is two assignments per message. It records a
// channel name, never a payload.
const STALL_MS = 2000;
const CHECK_EVERY_MS = 2000;
const RESOLUTION_MS = 100;
const MIN_GAP_MS = 60 * 1000;
const MAX_PER_SESSION = 10;
const RESUME_GRACE_MS = 30 * 1000;

const last = { channel: '', at: 0 };
function noteIpc(channel, at = Date.now()) { last.channel = channel; last.at = at; }
function lastIpc() { return { channel: last.channel, at: last.at }; }
function featureOf(channel) {
  const m = /^([a-z0-9@-]+)[:/]/i.exec(String(channel || ''));
  return m ? m[1] : (channel ? String(channel) : '');
}

// perf: require('perf_hooks'). crashLog: has add(kind, detail).
// activeFeature(): optional, the feature Vex knows is running, or null.
function createStallWatch({ perf, crashLog, activeFeature = null, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, log, thresholdMs = STALL_MS }) {
  if (!perf || typeof perf.monitorEventLoopDelay !== 'function') throw new Error('createStallWatch: no perf_hooks');
  if (!crashLog || typeof crashLog.add !== 'function') throw new Error('createStallWatch: no crash log');
  const note = typeof log === 'function' ? log : () => {};
  let hist = null, timer = null, resumedAt = 0, lastWrote = 0, wrote = 0, held = 0;

  function describe(ms) {
    const ipc = lastIpc();
    const parts = ['blocked for about ' + (Math.round(ms / 100) / 10) + ' s'];
    if (ipc.channel) parts.push('last IPC "' + ipc.channel + '" ' + Math.max(0, Math.round((now() - ipc.at) / 1000)) + ' s ago');
    const feature = (typeof activeFeature === 'function' ? activeFeature() : null) || featureOf(ipc.channel);
    if (feature) parts.push('feature ' + feature);
    if (held) parts.push(held + ' more stall' + (held === 1 ? '' : 's') + ' not written');
    return parts.join('; ');
  }

  // One look at the histogram. -> true when a line was written.
  function check() {
    if (!hist) return false;
    const ms = hist.max / 1e6;
    hist.reset();
    if (!(ms >= thresholdMs)) return false;
    const t = now();
    if (resumedAt && t - resumedAt < RESUME_GRACE_MS) { note('[Stall] ' + Math.round(ms) + ' ms right after resuming from sleep; not written'); return false; }
    if (wrote >= MAX_PER_SESSION || (lastWrote && t - lastWrote < MIN_GAP_MS)) { held++; return false; }
    const detail = describe(ms);
    held = 0; lastWrote = t; wrote++;
    note('[Stall] main process ' + detail);
    return crashLog.add('Main process stalled', detail) !== false;
  }

  function start() {
    if (timer) return;
    hist = perf.monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    hist.enable();
    timer = setTimer(check, CHECK_EVERY_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function stop() {
    if (timer) { clearTimer(timer); timer = null; }
    if (hist) { hist.disable(); hist = null; }
  }
  function markResumed() { resumedAt = now(); }
  return { start, stop, check, markResumed, running: () => !!timer };
}

module.exports = { createStallWatch, noteIpc, lastIpc, featureOf, STALL_MS, MIN_GAP_MS, MAX_PER_SESSION };
