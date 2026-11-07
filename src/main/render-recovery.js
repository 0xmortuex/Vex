// === When the Vex window's own renderer dies ================================
//
// window-hang.js covers a window that is stuck. A window whose renderer
// PROCESS died is different: it paints nothing, answers nothing, no
// 'unresponsive' ever comes, and the only way out was Task Manager (audit A1).
// Electron says so with 'render-process-gone' on the window's webContents.
//
// What is done, decided by decideRecovery() (a pure function, tested alone):
//   * a clean exit, Windows ending the session, Vex quitting: ignored
//     (exit-kinds.js notACrash decides, the same test the crash log uses);
//   * the first crash in five minutes: the window is reloaded. Tabs, settings
//     and the saved page snapshots are restored by the interface exactly as
//     after any restart;
//   * a reload that cannot even be started: the window is made again;
//   * the second crash within five minutes: NOTHING is retried by itself. A
//     question offers a restart in safe mode, a fresh window, or leaving it.
//     This is the crash-loop guard: recovery can never loop.
// A reload Vex asked for itself (window-hang.js ends a stuck renderer first) is
// announced with expectCrash() and is not counted.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_IN_WINDOW = 2;

// details: { reason, exitCode } from render-process-gone.
// history: epoch ms of earlier crashes of this window (any older than the
//   window are ignored).
// notCrash: what exit-kinds.notACrash said (a string) or null.
// alive: the window still exists.
// -> { action: 'ignore' | 'reload' | 'recreate' | 'offer-safe-mode', recent, why }
function decideRecovery({ details, history = [], now, notCrash = null, alive = true, windowMs = WINDOW_MS, max = MAX_IN_WINDOW } = {}) {
  if (!Number.isFinite(now)) throw new Error('decideRecovery: no time given');
  if (notCrash) return { action: 'ignore', recent: 0, why: String(notCrash) };
  if (!details || typeof details.reason !== 'string') return { action: 'ignore', recent: 0, why: 'no reason was given' };
  const earlier = (Array.isArray(history) ? history : []).filter(t => Number.isFinite(t) && now - t < windowMs && now - t >= 0);
  const recent = earlier.length + 1;                 // this crash counts
  if (recent >= max) return { action: 'offer-safe-mode', recent, why: recent + ' crashes within ' + Math.round(windowMs / 60000) + ' minutes' };
  if (!alive) return { action: 'recreate', recent, why: 'the window is gone' };
  return { action: 'reload', recent, why: 'first crash in ' + Math.round(windowMs / 60000) + ' minutes' };
}

// win: the BrowserWindow. history: an array SHARED by every window made in
// this run, so a window made again keeps the count (the loop guard).
// recreate(): makes the window again (the caller destroys the dead one).
// restartSafe(): relaunches Vex with --safe-mode.
function createRenderRecovery({ win, history, exitWatch, dialog, crashLog, recreate, restartSafe, closing = () => false, log, now = () => Date.now() }) {
  if (!win || !win.webContents) throw new Error('createRenderRecovery: no window');
  if (!Array.isArray(history)) throw new Error('createRenderRecovery: no shared history');
  if (!exitWatch || typeof exitWatch.notACrash !== 'function') throw new Error('createRenderRecovery: no exit watch');
  if (!dialog || typeof dialog.showMessageBox !== 'function') throw new Error('createRenderRecovery: no dialog');
  if (!crashLog || typeof crashLog.add !== 'function') throw new Error('createRenderRecovery: no crash log');
  if (typeof recreate !== 'function' || typeof restartSafe !== 'function') throw new Error('createRenderRecovery: recreate and restartSafe are needed');
  const note = typeof log === 'function' ? log : () => {};
  let expected = 0;          // crashes Vex caused itself, not yet seen
  let asking = false;

  function expectCrash() { expected++; }

  async function offer(info) {
    if (asking) return;
    asking = true;
    let answer = null;
    try {
      answer = await dialog.showMessageBox({
        type: 'error',
        title: 'Vex',
        message: 'The Vex window crashed again',
        detail: 'It stopped ' + info.recent + ' times within a few minutes, so Vex is not reloading it by itself again. Safe mode starts without extensions; your tabs and settings come back either way.',
        buttons: ['Restart in safe mode', 'Open a fresh window', 'Do nothing'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
    } catch (err) {
      note('[Recovery] the question could not be shown: ' + err.message);
    } finally { asking = false; }
    if (!answer) return;
    if (answer.response === 0) { note('[Recovery] restarting in safe mode'); restartSafe(); }
    else if (answer.response === 1) { note('[Recovery] opening a fresh window'); recreate(win); }
  }

  // -> the decision (also returned so tests and the probe can read it).
  function onGone(details) {
    if (expected > 0) { expected--; note('[Recovery] the window renderer ended on purpose; not counted'); return { action: 'ignore', recent: 0, why: 'ended by Vex' }; }
    const t = now();
    // A window that is already destroyed was closed on purpose: nothing to recover.
    if (win.isDestroyed()) return { action: 'ignore', recent: 0, why: 'the window was closed' };
    const notCrash = exitWatch.notACrash(details, { closing: closing() });
    const d = decideRecovery({ details, history, now: t, notCrash, alive: true });
    if (d.action === 'ignore') return d;
    history.push(t);
    while (history.length > 20) history.shift();
    const what = (details && details.reason) + ' (exit ' + (details && details.exitCode) + ')';
    crashLog.add('Vex window recovered', d.action + ' after ' + what);
    note('[Recovery] the Vex window renderer is gone: ' + what + ' -> ' + d.action + ' (' + d.why + ')');
    if (d.action === 'reload') {
      // reload() starts a fresh renderer for a crashed one. A failure here is
      // not swallowed: it falls through to making the window again.
      try { win.webContents.reload(); }
      catch (err) {
        note('[Recovery] reload failed (' + err.message + '); making the window again');
        recreate(win);
      }
    } else if (d.action === 'recreate') recreate(win);
    else offer(d).catch(err => note('[Recovery] ' + err.message));
    return d;
  }

  win.webContents.on('render-process-gone', (_e, details) => {
    try { onGone(details); }
    catch (err) { note('[Recovery] ' + err.message); }
  });
  return { onGone, expectCrash, offer };
}

module.exports = { decideRecovery, createRenderRecovery, WINDOW_MS, MAX_IN_WINDOW };
