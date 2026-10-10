// === A process that ended because Vex or Windows was closing is no crash ===
//
// crash-log.json, Memory › Health and Report a problem listed every helper or
// page process that did not exit cleanly. Windows logging off ended 24 "Video
// Capture" helpers in one second with 0xC000026B, a shutdown ended 8 pages
// with 0xC000013A, and quitting Vex or installing an update ended every
// process at once as "killed (exit 1)": all of it shown as crashes (audit B9,
// 2026-10-10). Those are told apart here; anything else is still a crash.

// Windows status codes a process gets when Windows ends it, not when it fails.
const SHUTDOWN_CODES = new Map([
  [0xC000026B, 'Windows was logging off'],      // STATUS_DLL_INIT_FAILED_LOGOFF
  [0xC000013A, 'Windows was ending processes'], // STATUS_CONTROL_C_EXIT (shutdown, console closed)
]);
// How a process Vex itself ended while closing is reported.
const ENDED_BY_CLOSING = new Set(['killed', 'abnormal-exit']);

function createExitWatch({ now = () => Date.now() } = {}) {
  let ending = null;   // { why, at }

  // Vex is closing for good: quitting, its window closing, an update, Windows
  // ending the session. The first reason is kept.
  function mark(why) { if (!ending) ending = { why: String(why), at: now() }; }

  // details: { reason, exitCode } from render-process-gone / child-process-gone.
  // closing: the page's own window is closing.
  // -> why it is not a crash, or null for a crash.
  function notACrash(details, { closing = false } = {}) {
    const reason = details && details.reason;
    if (reason === 'clean-exit') return 'it exited cleanly';
    const code = Number.isInteger(details && details.exitCode) ? (details.exitCode >>> 0) : null;
    if (code != null && SHUTDOWN_CODES.has(code)) return SHUTDOWN_CODES.get(code);
    if (ENDED_BY_CLOSING.has(reason)) {
      if (ending) return 'Vex was ' + ending.why;
      if (closing) return 'its window was closing';
    }
    return null;
  }

  return { mark, notACrash, ending: () => ending };
}

module.exports = { createExitWatch, SHUTDOWN_CODES, ENDED_BY_CLOSING };
