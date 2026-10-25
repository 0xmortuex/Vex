// Dark mode for websites: the main-process side.
//
// A page asks, while it loads, whether it gets dark mode (the guest preload
// src/dark-mode-preload.js, 'darkmode:page'); the window asks main to hand a
// changed decision to an open tab ('darkmode:apply') and whether Dark Reader is
// installed ('darkmode:status'). The rules themselves are the renderer's
// (js/dark-mode.js, the same file the Settings rows are made from), so a page
// load and a click in Settings can never disagree.
const { VexDarkMode } = require('../renderer/js/dark-mode');
const palette = require('../dark-mode-preload');

// Dark Reader's id in the Chrome Web Store; a copy installed another way is
// found by its name.
const DARK_READER_ID = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';

function darkReaderIn(ses) {
  if (!ses || typeof ses.getAllExtensions !== 'function') return false;
  return ses.getAllExtensions().some(x => x.id === DARK_READER_ID || /^dark reader$/i.test(String(x.name || '')));
}

// The colour the page shows before its own first paint (the same one the page
// side puts on the root).
function baseColor(decision) {
  if (decision.engine === 'simple') return '#0a0c10';
  const c = palette.convertColor({ r: 255, g: 255, b: 255, a: 1 }, 'bg', decision.look);
  return palette.toCss(c);
}

// A value the window sends: only the known keys, each text or null.
function cleanRaw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The dark mode settings must be an object');
  const out = {};
  for (const key of VexDarkMode.rawKeys()) {
    const v = raw[key];
    if (v == null) out[key] = null;
    else if (typeof v === 'string' && v.length <= 40000) out[key] = v;
    else throw new Error('Not a dark mode setting value: ' + key);
  }
  return out;
}

/**
 * @param {{ ipcMain: any, webContents: any, persistLoad: () => Record<string, any>, sessionFor: (partition: string) => any }} deps
 */
function wireDarkMode({ ipcMain, webContents, persistLoad, sessionFor }) {
  if (!ipcMain || !webContents || typeof persistLoad !== 'function' || typeof sessionFor !== 'function') throw new Error('wireDarkMode needs ipcMain, webContents, persistLoad and sessionFor');

  const context = (contents) => ({
    tor: !!(contents.session && contents.session.__vexTor),
    darkReader: darkReaderIn(contents.session),
  });
  const decide = (raw, url, contents, force) => {
    const ctx = context(contents);
    if (typeof force === 'boolean') ctx.force = force;
    const d = VexDarkMode.decide(raw, url, ctx);
    d.base = d.on ? baseColor(d) : '';
    return d;
  };
  const storedRaw = () => {
    const all = persistLoad() || {};
    const out = {};
    for (const key of VexDarkMode.rawKeys()) out[key] = typeof all[key] === 'string' ? all[key] : null;
    return out;
  };

  // A page's own question while it loads. Answered from the saved settings and
  // the frame's real address; anything wrong answers "no dark mode", never a guess.
  ipcMain.on('darkmode:page', (event) => {
    const none = { on: false };
    try {
      const frame = event.senderFrame;
      if (!frame || frame.parent) { event.returnValue = none; return; }
      event.returnValue = decide(storedRaw(), frame.url, event.sender);
    } catch (err) {
      console.error('[Dark mode] could not answer a page:', err && err.message);
      event.returnValue = none;
    }
  });

  // The window changed something (or is previewing): give this tab the decision for the page it shows now.
  ipcMain.handle('darkmode:apply', (_event, id, raw, opts) => {
    const contents = webContents.fromId(id);
    if (!contents || contents.isDestroyed()) throw new Error('That tab is gone');
    const force = opts && typeof opts.force === 'boolean' ? opts.force : undefined;
    const d = decide(cleanRaw(raw), contents.getURL(), contents, force);
    contents.send('vex-darkmode:set', d);
    return d;
  });

  ipcMain.handle('darkmode:status', () => ({ darkReader: darkReaderIn(sessionFor('persist:main')) }));
}

module.exports = { wireDarkMode, darkReaderIn, baseColor, cleanRaw, DARK_READER_ID };
