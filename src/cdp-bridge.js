// === Vex CDP Bridge — trusted input + accessibility for the agent ===
//
// The agent used to drive pages with synthetic DOM events (el.click(),
// el.value = '...'). Those carry isTrusted:false, so React/Vue controlled
// inputs, canvas apps, and anything that gates on trusted events silently
// ignored them. This bridge routes those actions through the Chrome DevTools
// Protocol instead, via webContents.debugger — the same mechanism Claude for
// Chrome uses through chrome.debugger. Events dispatched through CDP's Input
// domain are indistinguishable from real user input.
//
// It also exposes the accessibility tree (a far better page model for an LLM
// than a list of CSS selectors) and full-page screenshots for vision.
//
// Attachment is lazy and reference-counted per webContents: the first agent
// action attaches, and everything detaches when the agent stops or the tab
// goes away. Only the app's own renderer can reach these handlers — webview
// guests use preload-webview.js, which has no CDP surface.

const { ipcMain, webContents } = require('electron');

// Methods the renderer is allowed to invoke. CDP is a very large API and most
// of it has no business being reachable from the UI layer; this keeps the
// exposed surface to what the agent actually needs.
const ALLOWED_METHODS = new Set([
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Input.dispatchWheelEvent',
  'Accessibility.enable',
  'Accessibility.disable',
  'Accessibility.getFullAXTree',
  'Page.captureScreenshot',
  'Page.getLayoutMetrics',
  'DOM.getDocument',
  'DOM.scrollIntoViewIfNeeded',
  'Runtime.evaluate',
]);

// webContents ids we attached to, so we can detach cleanly.
const _attached = new Set();

function _resolve(webContentsId) {
  if (typeof webContentsId !== 'number' || webContentsId <= 0) return null;
  try {
    const wc = webContents.fromId(webContentsId);
    return wc && !wc.isDestroyed() ? wc : null;
  } catch { return null; }
}

// Attach the debugger if it isn't already. Returns { ok } or { ok:false, error }.
// The common failure is DevTools being open on the same guest — Chromium only
// allows one debugger client per target, so we surface that as a readable
// message rather than a raw exception.
function attach(wc) {
  try {
    if (wc.debugger.isAttached()) { _attached.add(wc.id); return { ok: true }; }
  } catch { /* isAttached can throw on a torn-down guest */ }

  try {
    wc.debugger.attach('1.3');
    _attached.add(wc.id);
    // Detach bookkeeping: if the guest navigates away or dies, drop the id so
    // we don't try to detach a dead target later.
    wc.once('destroyed', () => _attached.delete(wc.id));
    try {
      wc.debugger.once('detach', () => _attached.delete(wc.id));
    } catch {}
    return { ok: true };
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/already attached/i.test(msg)) {
      return { ok: false, error: 'DevTools is open on this tab — close it to let the agent control the page.' };
    }
    return { ok: false, error: msg };
  }
}

function detach(wc) {
  try {
    if (wc.debugger.isAttached()) wc.debugger.detach();
  } catch { /* already gone */ }
  _attached.delete(wc.id);
}

function register() {
  // Attach on demand. The renderer calls this once when an agent run starts.
  ipcMain.handle('cdp:attach', (_e, webContentsId) => {
    const wc = _resolve(webContentsId);
    if (!wc) return { ok: false, error: 'webContents not found' };
    return attach(wc);
  });

  ipcMain.handle('cdp:detach', (_e, webContentsId) => {
    const wc = _resolve(webContentsId);
    if (!wc) return { ok: true }; // already gone — nothing to do
    detach(wc);
    return { ok: true };
  });

  ipcMain.handle('cdp:is-attached', (_e, webContentsId) => {
    const wc = _resolve(webContentsId);
    if (!wc) return false;
    try { return wc.debugger.isAttached(); } catch { return false; }
  });

  // Generic (allowlisted) command dispatch. Attaches lazily so a caller that
  // forgot cdp:attach still works.
  ipcMain.handle('cdp:send', async (_e, webContentsId, method, params) => {
    if (!ALLOWED_METHODS.has(method)) {
      return { ok: false, error: 'CDP method not permitted: ' + method };
    }
    const wc = _resolve(webContentsId);
    if (!wc) return { ok: false, error: 'webContents not found' };

    const att = attach(wc);
    if (!att.ok) return att;

    try {
      const result = await wc.debugger.sendCommand(method, params || {});
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // Detach everything — called when the agent stops, so DevTools/inspect work
  // normally again the moment the run ends.
  ipcMain.handle('cdp:detach-all', () => {
    for (const id of [..._attached]) {
      const wc = _resolve(id);
      if (wc) detach(wc);
      else _attached.delete(id);
    }
    return { ok: true };
  });
}

module.exports = { register, ALLOWED_METHODS };
