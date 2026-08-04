// === Vex extension host — diagnostics ===
//
// When something inside the extension fails, there is nowhere obvious to look:
// the service worker's console isn't the app's console, extension pages render
// in their own webContents, and a chrome.* call that rejects becomes
// runtime.lastError, which extensions routinely ignore. The result is a
// failure with no visible symptom — a message that just never gets answered.
//
// This funnels all three into one file in userData so a failure can be read
// after the fact instead of reproduced under a debugger.

const fs = require('fs');
const path = require('path');

let _file = null;
let _enabled = false;
const MAX_BYTES = 2 * 1024 * 1024;

function init(app, { enabled = true } = {}) {
  _enabled = enabled;
  if (!enabled) return null;
  try {
    _file = path.join(app.getPath('userData'), 'vex-ext-diagnostics.log');
    // Start clean each launch; a stale log is worse than none when you're
    // trying to work out what just happened.
    fs.writeFileSync(_file, `=== Vex extension host diagnostics — ${new Date().toISOString()} ===\n`, 'utf8');
  } catch { _file = null; }
  return _file;
}

function write(tag, message) {
  if (!_enabled || !_file) return;
  try {
    if (fs.existsSync(_file) && fs.statSync(_file).size > MAX_BYTES) {
      fs.writeFileSync(_file, `=== truncated ${new Date().toISOString()} ===\n`, 'utf8');
    }
    const ts = new Date().toISOString().slice(11, 23);
    fs.appendFileSync(_file, `[${ts}] ${tag} ${String(message).slice(0, 4000)}\n`, 'utf8');
  } catch { /* diagnostics must never break the app */ }
}

// Attach to everything that can carry an error out of the extension.
function attach(app, sessions, extensionId) {
  if (!_enabled) return;

  for (const ses of sessions) {
    try {
      ses.serviceWorkers.on('console-message', (_e, m) => {
        const lvl = (m && m.level != null) ? m.level : '';
        write('SW  ', `[${lvl}] ${m && m.message}`);
      });
    } catch {}
    try {
      ses.serviceWorkers.on('registration-completed', (_e, d) => write('SW  ', 'registration-completed ' + JSON.stringify(d)));
    } catch {}
  }

  // Extension pages (side panel, options, offscreen) each get their own
  // webContents; this is usually where a UI-side failure actually surfaces.
  app.on('web-contents-created', (_e, wc) => {
    let url = '';
    try { url = wc.getURL(); } catch {}
    const isExt = (u) => typeof u === 'string' && extensionId && u.startsWith('chrome-extension://' + extensionId);
    const hook = () => {
      try {
        wc.on('console-message', (ev) => {
          const lvl = ev && ev.level;
          if (lvl === 'error' || lvl === 'warning' || lvl === 2 || lvl === 3) {
            write('PAGE', `[${lvl}] ${ev.message} @ ${String(ev.sourceId || '').split('/').pop()}:${ev.lineNumber || 0}`);
          }
        });
        wc.on('render-process-gone', (_ev, details) => write('PAGE', 'render-process-gone ' + JSON.stringify(details)));
        wc.on('preload-error', (_ev, p, err) => write('PAGE', 'preload-error ' + p + ' ' + (err && err.message)));
      } catch {}
    };
    if (isExt(url)) hook();
    else wc.once('did-navigate', (_ev, u) => { if (isExt(u)) hook(); });
  });
}

module.exports = { init, write, attach, file: () => _file };
