// === When the Vex window stops answering ====================================
//
// A hung interface used to leave a dead window: nothing on it responded, Windows
// did not always say "Not responding" (the window still paints its last frame),
// and the only way out was Task Manager — which also killed every page, and
// recorded nothing about why (reported 2026-10-05).
//
// Chromium notices when the window's renderer stops taking input and says so
// ('unresponsive' on the window). Then:
//   * the crash log gets a line with what was open, so the next launch's
//     Health section and a problem report show it happened;
//   * a question offers to reload the window. Tabs and settings are saved as
//     they change, so a reload comes back with them; Wait leaves it alone.
// If the window recovers by itself first, the question goes away unanswered.
function createWindowHangGuard({ win, dialog, crashLog, openPages, log, now = () => Date.now() }) {
  if (!win || typeof win.on !== 'function') throw new Error('createWindowHangGuard: no window');
  if (!dialog || typeof dialog.showMessageBox !== 'function') throw new Error('createWindowHangGuard: no dialog');
  if (!crashLog || typeof crashLog.add !== 'function') throw new Error('createWindowHangGuard: no crash log');
  const note = typeof log === 'function' ? log : () => {};
  let asking = null;          // AbortController of the open question
  let hungAt = 0;

  function pagesText() {
    let pages = [];
    try { pages = (typeof openPages === 'function' ? openPages() : []) || []; }
    catch (err) { note('[Hang] could not list the open pages: ' + err.message); }
    return pages.length ? pages.join(' | ') : 'no pages open';
  }

  async function onUnresponsive() {
    if (asking || win.isDestroyed()) return;
    hungAt = now();
    crashLog.add('Vex window stopped responding', pagesText());
    note('[Hang] the Vex window stopped responding');
    const ctrl = new AbortController();
    asking = ctrl;
    let answer;
    try {
      answer = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Vex',
        message: 'Vex stopped responding',
        detail: 'The window is not answering. Reload it to get going again — your tabs and settings come back with it. Or wait, if something is still finishing.',
        buttons: ['Reload window', 'Wait'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        signal: ctrl.signal,
      });
    } catch (err) {
      note('[Hang] the question could not be shown: ' + err.message);
      answer = null;
    } finally {
      if (asking === ctrl) asking = null;
    }
    if (ctrl.signal.aborted || !answer || answer.response !== 0 || win.isDestroyed()) return;
    note('[Hang] reloading the Vex window');
    const wc = win.webContents;
    // A renderer stuck in a loop never gets to run a reload: it is ended
    // first, and the reload starts a fresh one.
    if (typeof wc.forcefullyCrashRenderer === 'function') wc.forcefullyCrashRenderer();
    wc.reload();
  }

  function onResponsive() {
    if (hungAt) note('[Hang] the Vex window is answering again after ' + Math.round((now() - hungAt) / 1000) + ' s');
    hungAt = 0;
    if (asking) { asking.abort(); asking = null; }
  }

  win.on('unresponsive', () => { onUnresponsive().catch(err => note('[Hang] ' + err.message)); });
  win.on('responsive', onResponsive);
  return { onUnresponsive, onResponsive, asking: () => !!asking };
}

module.exports = { createWindowHangGuard };
