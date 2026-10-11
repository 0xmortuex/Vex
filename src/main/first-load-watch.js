// === A tab's first page that never starts, in a session with extensions ===
// The first tab of a container stayed blank (12-18 s and more, "loading"
// with no address) whenever an extension that watches or rules requests
// (webRequest, declarativeNetRequest) was installed: the extension was
// still being loaded into the container's session as the page started
// (main.js _coverNewSession), and the page's request never left Vex. The
// same address asked for again loads at once (found 2026-10-10, EX3;
// measured on Electron 42).
// So a tab's first page that has not committed is asked for once more: as
// soon as its session's extensions are in (`covered`), or after a few
// seconds whatever happens. Only in a session with such an extension, and
// never more than once.

const FIRST_LOAD_GRACE_MS = 4000;
const INTERCEPTING = /^(webRequest|webRequestBlocking|declarativeNetRequest)/;

// Whether any extension in the session watches or rules its requests.
function interceptsRequests(extensions) {
  return (extensions || []).some(ext => {
    const m = (ext && ext.manifest) || {};
    return [].concat(m.permissions || []).some(p => INTERCEPTING.test(String(p)));
  });
}

// contents: the tab's page. sessionExtensions(): the extensions loaded in its
// session now. covered: a promise settled once the session's extensions are
// loaded. log(message).
function watchFirstLoad(contents, { sessionExtensions, covered, log, setTimer = setTimeout, clearTimer = clearTimeout, graceMs = FIRST_LOAD_GRACE_MS }) {
  let timer = null;
  let pending = null;     // the first page's address, while it has not committed
  let finished = false;
  const done = () => {
    finished = true;
    pending = null;
    if (timer) clearTimer(timer);
    timer = null;
    contents.removeListener('did-start-navigation', started);
    contents.removeListener('did-navigate', done);
    contents.removeListener('did-fail-load', done);
  };
  const askAgain = (why) => {
    const url = pending;
    if (finished || !url) return;
    if (contents.isDestroyed() || contents.getURL() !== '' || !contents.isLoading()) return;
    if (!interceptsRequests(sessionExtensions())) return;
    done();
    log(`[Extensions] a tab's first page had not started ${why}; asking for it again`);
    contents.loadURL(url).catch(err => {
      if (err && (err.errno === -3 || /ERR_ABORTED/.test(err.message))) return;
      log('[Extensions] asking again for a tab\'s first page failed: ' + (err && err.message));
    });
  };
  function started(_e, url, isInPlace, isMainFrame) {
    if (!isMainFrame || isInPlace) return;
    if (!/^https?:/i.test(String(url))) { done(); return; }
    contents.removeListener('did-start-navigation', started);
    pending = url;
    timer = setTimer(() => { timer = null; askAgain(`after ${graceMs / 1000} s`); if (!finished) done(); }, graceMs);
  }
  contents.on('did-start-navigation', started);
  contents.on('did-navigate', done);
  contents.on('did-fail-load', done);
  contents.once('destroyed', done);
  if (covered && typeof covered.then === 'function') {
    // A failed coverage is logged where it is made (main.js); the timer
    // still asks again then.
    covered.then(() => askAgain('when the extensions came in')).catch(() => {});
  }
}

module.exports = { watchFirstLoad, interceptsRequests, FIRST_LOAD_GRACE_MS };
