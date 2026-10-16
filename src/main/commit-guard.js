// === Commit-charge guard (T0-018) =============================================
//
// Windows refuses an allocation when the COMMIT charge (everything programs
// have promised to use, in RAM or in the page file) reaches the COMMIT LIMIT,
// even while Task Manager still shows free RAM. The owner's PC had a
// MEMORY_MANAGEMENT blue screen on 14 Oct while gaming, and on 15 Oct a build
// died of commit exhaustion with a game running (33 GB limit, 6.7 GB left).
// "Free memory" is the wrong number to watch; commit headroom is the right one.
//
// This reads it the cheap way, no PowerShell and no native module:
// process.getSystemMemoryInfo() on Windows reports swapTotal = the commit limit
// and swapFree = the commit still available (both in KB; verified on this
// machine against Win32_OperatingSystem TotalVirtualMemorySize and
// FreeVirtualMemory). A read is one system call.
//
// It only WATCHES and reports a level. What to do about it (sleep Vex's own
// tabs, hold Vex's own background work, unload Vex's own AI model) is decided in
// the interface, and it never touches another program: a process that is not
// Vex's is never closed, paused, lowered or asked anything by this.
'use strict';

const GB = 1024 * 1024;   // KB per GB

// How much commit headroom is "short". Absolute where the limit is big, a share
// of the limit where it is small (a 16 GB limit has no 8 GB to spare).
const HIGH_GB = 8, CRITICAL_GB = 4, HIGH_SHARE = 0.25, CRITICAL_SHARE = 0.12, RECOVER_GB = 1.5;

function readCommit(info) {
  if (!info || !Number.isFinite(info.swapTotal) || !Number.isFinite(info.swapFree) || info.swapTotal <= 0) {
    throw new Error('Windows did not report the commit limit');
  }
  const limitKB = info.swapTotal, availKB = Math.max(0, Math.min(info.swapFree, info.swapTotal));
  return {
    limitMB: Math.round(limitKB / 1024), availMB: Math.round(availKB / 1024), usedMB: Math.round((limitKB - availKB) / 1024),
    usedPct: Math.round(100 * (limitKB - availKB) / limitKB),
  };
}

function thresholds(limitMB) {
  const limitGB = limitMB / 1024;
  return { high: Math.min(HIGH_GB, limitGB * HIGH_SHARE), critical: Math.min(CRITICAL_GB, limitGB * CRITICAL_SHARE) };
}

// 'ok' | 'high' | 'critical', with hysteresis: a level is left only once the
// headroom is RECOVER_GB above the line that entered it, so a number hovering
// on a line does not flap.
function classify(snapshot, previous = 'ok') {
  const t = thresholds(snapshot.limitMB);
  const availGB = snapshot.availMB / 1024;
  const margin = previous === 'critical' ? RECOVER_GB : 0;
  if (availGB < t.critical + margin) return 'critical';
  const marginHigh = previous === 'high' || previous === 'critical' ? RECOVER_GB : 0;
  if (availGB < t.high + marginHigh) return 'high';
  return 'ok';
}

// info()      -> process.getSystemMemoryInfo()
// onLevel(l)  -> called with { level, previous, ...snapshot } when the level changes
function createCommitGuard({ info, onLevel, intervalMs = 15000, setTimer = setInterval, clearTimer = clearInterval, log = () => {} }) {
  if (typeof info !== 'function') throw new TypeError('createCommitGuard: info is required');
  let level = 'ok';
  let last = null;
  let timer = null;

  function poll() {
    let snap;
    try { snap = readCommit(info()); }
    catch (err) { log('[CommitGuard] ' + err.message); throw err; }
    last = snap;
    const next = classify(snap, level);
    if (next !== level) {
      const previous = level;
      level = next;
      if (typeof onLevel === 'function') {
        try { onLevel({ level, previous, ...snap }); } catch (err) { log('[CommitGuard] listener failed: ' + err.message); }
      }
    }
    return { level, ...snap };
  }

  return {
    poll,
    start() {
      if (timer) return;
      try { poll(); } catch { /* reported by poll(); the timer keeps trying */ }
      timer = setTimer(() => { try { poll(); } catch { /* reported by poll() */ } }, intervalMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    },
    stop() { if (timer) clearTimer(timer); timer = null; },
    state: () => ({ level, ...(last || {}) }),
  };
}

module.exports = { readCommit, classify, thresholds, createCommitGuard, HIGH_GB, CRITICAL_GB, RECOVER_GB, GB };
