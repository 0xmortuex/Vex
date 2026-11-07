// === Upload watch: say in the log when a Discord upload request does not finish =============================
//
// A file dragged or attached into Discord shows a progress bar that never ends and then "Request timed out". Whether Vex's own request
// hook never answered, or the request was answered and then the network stalled, is not visible from outside. This watches ONLY the
// requests of an upload: a write (POST, PUT, PATCH) to Discord's own hosts and anything sent to Discord's attachment storage host. It keeps
// no body, header or cookie: the host, the path with its numbers hidden, the method, the tab's session and the time. It writes to the
// log only (nothing is sent anywhere, nothing is stored) and changes no request.
//
//   wrap(details, tag, callback) -> the callback to give the hook: it notes that the hook answered (and how long that took).
//   done(details, outcome)       -> the request finished or failed (onCompleted / onErrorOccurred).
// After waitMs without done(), one line says whether the hook had answered, so the next log tells "Vex never answered" from "the network
// stalled".

const WRITES = new Set(['POST', 'PUT', 'PATCH']);
const DISCORD_HOST = /(^|\.)(discord\.com|discordapp\.com|discordapp\.net)$/i;
const STORAGE_HOST = /^discord-attachments-uploads-[a-z0-9-]+\.storage\.googleapis\.com$/i;

function watched(details) {
  let u;
  try { u = new URL(details && details.url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const method = String((details && details.method) || 'GET').toUpperCase();
  if (STORAGE_HOST.test(u.hostname)) return u;
  if (DISCORD_HOST.test(u.hostname) && WRITES.has(method)) return u;
  return null;
}

// Numbers in a path are channel and message ids: hidden.
function label(u, method) {
  return method + ' ' + u.hostname + u.pathname.replace(/\d{5,}/g, '#').slice(0, 80);
}

function createUploadWatch({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = (line) => console.log(line), waitMs = 20000 } = {}) {
  const open = new Map();   // request id -> { text, tag, started, answered, timer }

  function start(details, tag) {
    const u = watched(details);
    if (!u || details.id == null) return null;
    const method = String(details.method || 'GET').toUpperCase();
    const entry = { text: label(u, method), tag, started: now(), answered: false, timer: null };
    entry.timer = setTimer(() => {
      log('[UploadWatch] still open after ' + Math.round((now() - entry.started) / 1000) + ' s: ' + entry.text + ' (' + entry.tag + ': Vex\'s request hook '
        + (entry.answered ? 'had answered, so the network is what is waiting' : 'has NOT answered') + ')');
    }, waitMs);
    if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
    open.set(details.id, entry);
    return entry;
  }

  function wrap(details, tag, callback) {
    const entry = start(details, tag);
    if (!entry) return callback;
    return function answered(...args) {
      entry.answered = true;
      return callback.apply(this, args);
    };
  }

  function done(details, outcome) {
    const entry = details && open.get(details.id);
    if (!entry) return false;
    open.delete(details.id);
    clearTimer(entry.timer);
    const ms = now() - entry.started;
    // A quick, ordinary finish says nothing; only one that was slow or that failed is a line.
    if (ms >= waitMs || /error|fail/i.test(String(outcome))) log('[UploadWatch] ' + entry.text + ' ended after ' + Math.round(ms / 1000) + ' s: ' + outcome);
    return true;
  }

  return { wrap, done, openCount: () => open.size };
}

module.exports = { createUploadWatch, watched, label };
