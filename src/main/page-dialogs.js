// === A page's alert / confirm / prompt stays in its own tab =================
//
// Electron answers a page's alert() or confirm() with a native message box
// owned by the Vex window. A native box disables the window it belongs to, so
// one alert from a page in a tab or a sidebar panel disabled ALL of Vex: every
// click was ignored, Windows did not say "Not responding", and the box could
// sit hidden behind a panel or off-screen. The owner had to end Vex from Task
// Manager (reported 2026-10-05, Prime Video playing in a panel). Chrome blocks
// only the tab that asked.
//
// Now the guest preload (preload-webview.js) replaces the page's alert,
// confirm and prompt with a synchronous message here ('page-dialog'). That
// blocks the page's own renderer until it is answered, which is exactly what a
// page's dialog does in Chrome. Main asks the window the page belongs to, which
// shows the question over that tab or panel only (renderer/js/page-dialogs.js),
// and the answer goes back as the message's return value. The webview's native
// dialogs are switched off as well (disableDialogs, session-security.js), so a
// frame the preload never reached cannot bring the window-wide box back.
//
// A page that closes, crashes or leaves gets the cancel answer at once, so it
// is never left waiting on a question nobody can see any more. From its second
// dialog on, a page may be stopped from showing any more until it navigates.

const TYPES = ['alert', 'confirm', 'prompt'];
const MAX_TEXT = 10000;

// What the page gets when nobody answers: alert nothing, confirm false, prompt null.
function cancelAnswer() { return null; }
function answerFor(type, ok, value) {
  if (type === 'confirm') return ok === true;
  if (type === 'prompt') return ok === true ? String(value ?? '').slice(0, MAX_TEXT) : null;
  return null;
}
// "example.com says" — only for a web page; a file or blank page is "This page".
function originOf(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.host;
  } catch { /* not a URL */ }
  return '';
}

function createPageDialogs({ owner, nativeAsk, newId, log }) {
  if (typeof owner !== 'function') throw new Error('createPageDialogs: no owner lookup');
  if (typeof nativeAsk !== 'function') throw new Error('createPageDialogs: no native fallback');
  if (typeof newId !== 'function') throw new Error('createPageDialogs: no id maker');
  const note = typeof log === 'function' ? log : () => {};
  const pending = new Map();   // id -> { event, type, guestId, host }
  const pages = new Map();     // guest id -> { shown, stopped }

  function reply(event, value) {
    try { event.returnValue = value; }
    catch (err) { note('[PageDialog] could not answer the page: ' + err.message); }
  }

  // Answer one question and take it off the screen. `tellHost` when the answer
  // did not come from the window (the page closed or left).
  function settle(id, value, tellHost) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    reply(p.event, value);
    if (tellHost && p.host && p.host.win && !p.host.win.isDestroyed()) {
      try { p.host.win.webContents.send('page-dialog:close', { id }); }
      catch (err) { note('[PageDialog] could not take the question away: ' + err.message); }
    }
    return true;
  }
  function settleGuest(guestId) {
    for (const [id, p] of [...pending]) if (p.guestId === guestId) settle(id, cancelAnswer(), true);
  }

  function watch(guest) {
    if (pages.has(guest.id)) return pages.get(guest.id);
    const page = { shown: 0, stopped: false };
    pages.set(guest.id, page);
    const id = guest.id;
    // Leaving the page answers what it asked and forgets "no more dialogs".
    // Electron 42 puts both on the event; the old positional ones stay as a backup.
    guest.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
      const main = details && typeof details.isMainFrame === 'boolean' ? details.isMainFrame : isMainFrame;
      const same = details && typeof details.isSameDocument === 'boolean' ? details.isSameDocument : isInPlace;
      if (!main || same) return;
      settleGuest(id);
      page.shown = 0;
      page.stopped = false;
    });
    guest.on('render-process-gone', () => settleGuest(id));
    guest.once('destroyed', () => { settleGuest(id); pages.delete(id); });
    return page;
  }

  // 'page-dialog' (sendSync) from a page.
  function request(event, req) {
    const type = req && TYPES.includes(req.type) ? req.type : null;
    if (!type) { reply(event, cancelAnswer()); throw new Error('Unknown page dialog type'); }
    const guest = event.sender;
    const message = String(req.message ?? '').slice(0, MAX_TEXT);
    const value = String(req.value ?? '').slice(0, MAX_TEXT);
    let url = '';
    try { url = guest.getURL(); } catch { /* gone */ }
    // A page in its own window (a sign-in popup, a pop-out) is not in a tab:
    // its native box belongs to that window alone, as in Chrome.
    if (guest.getType() !== 'webview') {
      Promise.resolve(nativeAsk(guest, { type, message, origin: originOf(url) }))
        .then(r => reply(event, answerFor(type, r && r.ok, r && r.value)))
        .catch(err => { note('[PageDialog] the window\'s own box failed: ' + err.message); reply(event, cancelAnswer()); });
      return;
    }
    const host = owner(guest);
    if (!host || !host.win || host.win.isDestroyed()) { reply(event, cancelAnswer()); return; }
    const page = watch(guest);
    if (page.stopped) { reply(event, cancelAnswer()); return; }
    page.shown += 1;
    const id = newId();
    pending.set(id, { event, type, guestId: guest.id, host });
    host.win.webContents.send('page-dialog:show', {
      id, guestId: guest.id, type, message, value,
      origin: originOf(url),
      offerStop: page.shown >= 2,
    });
  }

  // 'page-dialog:answer' from the window that showed it.
  function answer(event, res) {
    const p = pending.get(res && res.id);
    if (!p) return false;   // already answered: the page closed or left first
    if (owner(event.sender) !== p.host) throw new Error('That question belongs to another window');
    if (res.stop === true) { const page = pages.get(p.guestId); if (page) page.stopped = true; }
    return settle(res.id, answerFor(p.type, res.ok, res.value), false);
  }

  return { request, answer, settleGuest, pending, pages };
}

module.exports = { createPageDialogs, answerFor, originOf, TYPES, MAX_TEXT };
