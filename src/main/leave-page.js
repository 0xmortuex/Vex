// === "Leave site?" for a page you typed into ===============================
//
// Every page's beforeunload was answered "leave" (will-prevent-unload always
// cancelled), so text typed into a page that asks before it is left was lost
// on a reload or a link without a word (audit B3, 2026-10-10). Chrome asks.
//
// Chromium only raises will-prevent-unload for a page the user has clicked or
// typed in since it loaded (measured 2026-10-10: a page with a beforeunload
// guard and no gesture was left without the event; after a click and typing
// it fired). Closing a tab or the window never raises it (measured too), so
// neither can get stuck on a page's question.
//
// Electron needs the answer on the spot, and Vex's question is a dialog in the
// window, so the page stays where it is and the question is asked. "Leave"
// then does again what was held up: a navigation Vex started (the address bar,
// Back, Reload…) is called again; one the page started (a link, a form) is
// done again by the page's preload, which noted what was clicked
// (preload-webview.js). That second try is let through. If nothing can be
// done again, the next try within half a minute leaves without asking.

const INTENT_MS = 3000;    // a navigation Vex started this recently is the one held up
const ALLOW_MS = 30000;    // after "Leave", how long the next try passes unasked
const CHECK_MS = 1500;     // how long a replay has to start a navigation
const CALLS = ['loadURL', 'reload', 'reloadIgnoringCache'];
const HISTORY_CALLS = ['goBack', 'goForward', 'goToIndex', 'goToOffset'];

// ask(contents) -> Promise<boolean> (true: leave)
// isClosing(contents) -> true while the page's window or Vex is closing
// tellAgain(contents) -> nothing could be done again: say "do that again"
function createLeaveGuard({ ask, isClosing, tellAgain, log, now = () => Date.now(), setTimer = setTimeout }) {
  if (typeof ask !== 'function') throw new Error('createLeaveGuard: no way to ask');
  const note = typeof log === 'function' ? log : () => {};
  const pages = new Map();   // contents id -> { intent, allowUntil, asking }

  function stateOf(id) {
    let st = pages.get(id);
    if (!st) { st = { intent: null, allowUntil: 0, asking: false }; pages.set(id, st); }
    return st;
  }

  // Note each navigation Vex starts on this page (a <webview>'s loadURL,
  // reload, goBack… arrive here as these calls), so it can be done again.
  function watch(contents) {
    const st = stateOf(contents.id);
    const wrap = (target, name) => {
      const original = target && target[name];
      if (typeof original !== 'function') return;
      target[name] = function (...args) {
        st.intent = { at: now(), what: name, replay: () => original.apply(target, args) };
        return original.apply(target, args);
      };
    };
    for (const name of CALLS) wrap(contents, name);
    for (const name of HISTORY_CALLS) wrap(contents.navigationHistory, name);
    // A navigation that started was not held up: it is no longer the one to
    // do again. (One the page holds up never gets this far.)
    contents.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
      const main = details && typeof details.isMainFrame === 'boolean' ? details.isMainFrame : isMainFrame;
      if (main) st.intent = null;
    });
    contents.once('destroyed', () => pages.delete(contents.id));
  }

  function replay(contents, intent) {
    let started = false;
    const onStart = (details, _url, isInPlace, isMainFrame) => {
      const main = details && typeof details.isMainFrame === 'boolean' ? details.isMainFrame : isMainFrame;
      if (main) started = true;
    };
    contents.on('did-start-navigation', onStart);
    setTimer(() => {
      if (contents.isDestroyed()) return;
      contents.removeListener('did-start-navigation', onStart);
      if (!started && typeof tellAgain === 'function') tellAgain(contents);
    }, CHECK_MS);
    if (intent) {
      try { Promise.resolve(intent.replay()).catch(err => note('[LeavePage] ' + intent.what + ' again failed: ' + err.message)); }
      catch (err) { note('[LeavePage] ' + intent.what + ' again failed: ' + err.message); }
    } else {
      contents.send('vex:leave-replay');
    }
  }

  // will-prevent-unload on a page. Returns what was done: 'allow', 'ask', 'stay'.
  function onWillPreventUnload(event, contents) {
    if (contents.isDestroyed() || (typeof isClosing === 'function' && isClosing(contents))) {
      event.preventDefault();
      return 'allow';
    }
    const st = stateOf(contents.id);
    if (st.allowUntil > now()) {
      st.allowUntil = 0;
      event.preventDefault();
      return 'allow';
    }
    // One question at a time; a second try while it is up stays.
    if (st.asking) return 'stay';
    const intent = st.intent && now() - st.intent.at <= INTENT_MS ? st.intent : null;
    st.intent = null;
    st.asking = true;
    Promise.resolve()
      .then(() => ask(contents))
      .then((leave) => {
        st.asking = false;
        if (leave !== true || contents.isDestroyed()) return;
        st.allowUntil = now() + ALLOW_MS;
        replay(contents, intent);
      })
      .catch((err) => { st.asking = false; note('[LeavePage] could not ask about leaving the page: ' + err.message); });
    return 'ask';
  }

  return { watch, onWillPreventUnload, pages };
}

// The window's side: one question per page at a time, answered by the window
// that owns the page.
//   send(host, payload) shows it; the answer comes to answer().
function createLeaveQuestions({ owner, newId }) {
  const pending = new Map();   // id -> { resolve, host, guestId }

  function settle(id, leave) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    p.done();
    p.resolve(leave === true);
    return true;
  }

  function ask(contents, { origin }) {
    const host = owner(contents);
    if (!host || !host.win || host.win.isDestroyed()) return Promise.resolve(false);
    const id = newId();
    return new Promise((resolve) => {
      // The page went away: the question is moot.
      const moot = () => settle(id, false);
      contents.once('destroyed', moot);
      const done = () => { if (!contents.isDestroyed()) contents.removeListener('destroyed', moot); };
      pending.set(id, { resolve, host, guestId: contents.id, done });
      host.win.webContents.send('page:leave-ask', { id, guestId: contents.id, origin });
    });
  }

  function answer(event, res) {
    const p = pending.get(res && res.id);
    if (!p) return false;
    if (owner(event.sender) !== p.host) throw new Error('That question belongs to another window');
    return settle(res.id, res.leave === true);
  }

  return { ask, answer, pending };
}

module.exports = { createLeaveGuard, createLeaveQuestions, INTENT_MS, ALLOW_MS, CHECK_MS };
