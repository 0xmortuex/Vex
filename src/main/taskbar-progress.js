// === Download progress on the Windows taskbar button (T2-083) ================
//
// While files download, the taskbar button of Vex fills like Chrome's does; when
// the last one finishes the button flashes once, unless Vex is already in front.
//
// Pure of Electron: the window is injected, so it is testable. The flash is the
// one thing that can pull attention onto a full-screen game, so it asks
// canFlash() first (no full-screen game in front, Vex not full screen itself);
// a refused flash does nothing at all (no fallback), the progress bar is the
// quiet signal and still shows.
//
// getWindow()   -> the main BrowserWindow or null
// canFlash()    -> boolean (false while a game owns the screen)
// ownedBy(id)   -> optional: false for a download that must not show here
function createTaskbarProgress({ getWindow, canFlash, log = () => {} }) {
  if (typeof getWindow !== 'function') throw new TypeError('createTaskbarProgress: getWindow is required');
  if (typeof canFlash !== 'function') throw new TypeError('createTaskbarProgress: canFlash is required');
  const live = new Map();     // id -> { received, total, paused }
  let finishedOk = 0;         // completed since the bar last emptied

  const win = () => {
    const w = getWindow();
    return w && !(typeof w.isDestroyed === 'function' && w.isDestroyed()) ? w : null;
  };

  // What the bar should show for the downloads running now.
  // -> { mode, value }  value is 0..1 for normal/paused, ignored otherwise.
  function summary() {
    if (!live.size) return { mode: 'none', value: -1 };
    let received = 0, total = 0, unknown = false, running = 0;
    for (const d of live.values()) {
      if (!d.paused) running++;
      if (d.total > 0) { received += Math.min(d.received, d.total); total += d.total; } else unknown = true;
    }
    if (unknown && total === 0) return { mode: running ? 'indeterminate' : 'paused', value: 2 };
    const value = Math.max(0, Math.min(1, received / total));
    return { mode: running ? 'normal' : 'paused', value };
  }

  function paint() {
    const w = win();
    if (!w) return;
    const s = summary();
    try {
      if (s.mode === 'none') w.setProgressBar(-1);
      else if (s.mode === 'indeterminate') w.setProgressBar(2, { mode: 'indeterminate' });
      else w.setProgressBar(s.value, { mode: s.mode });
    } catch (err) { log('[TaskbarProgress] could not set the taskbar progress: ' + err.message); }
  }

  function progress(d) {
    if (!d || typeof d.id !== 'string') return;
    if (d.state && d.state !== 'progressing') return;
    live.set(d.id, { received: Number(d.receivedBytes) || 0, total: Number(d.totalBytes) || 0, paused: d.paused === true });
    paint();
  }

  function complete(d) {
    if (!d || typeof d.id !== 'string') return;
    live.delete(d.id);
    if (d.state === 'completed') finishedOk++;
    paint();
    if (live.size) return;
    const done = finishedOk;
    finishedOk = 0;
    if (!done) return;
    const w = win();
    if (!w) return;
    if (typeof w.isFocused === 'function' && w.isFocused()) return;
    if (!canFlash()) { log('[TaskbarProgress] not flashing: a full-screen window has the screen'); return; }
    try { w.flashFrame(true); } catch (err) { log('[TaskbarProgress] could not flash the taskbar button: ' + err.message); }
  }

  // The window was looked at: stop a flash that is still going.
  function seen() {
    const w = win();
    if (w) { try { w.flashFrame(false); } catch (err) { log('[TaskbarProgress] could not stop the flash: ' + err.message); } }
  }

  return { progress, complete, seen, summary, active: () => live.size };
}

module.exports = { createTaskbarProgress };
