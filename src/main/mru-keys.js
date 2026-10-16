// === Ctrl+Tab, most recently used first (T1-014) =============================
//
// Vex tried this once from the renderer and took it out: the key-up that ends
// the cycle ("Ctrl released: go") never reaches the renderer while a PAGE has
// the focus. Main sees both halves, because before-input-event fires on the
// page's own webContents, so the cycle is driven from here:
//
//   Ctrl+Tab / Ctrl+Shift+Tab   a step forward / back through the tabs in the
//                               order they were last used
//   Ctrl released               go to the tab that is selected
//   Escape                      stay where you are
//   the window loses focus      go to the tab that is selected (the key-up
//                               would go to another program)
//
// THE TRAP (measured 2026-10-16 with webContents.sendInputEvent in this Electron):
// when before-input-event calls event.preventDefault() on a key-DOWN, Chromium drops
// every later key event, key-ups included, until the next key-down. Taking the
// Ctrl+Tab key-down that way means the release of Ctrl is never heard, and the
// cycle never ends. So the Ctrl+Tab key-down is NOT swallowed: it is answered with a
// step and passed on (a page sees a Ctrl+Tab key-down, which no page does anything
// with, and Blink's Tab handling ignores a Tab with Ctrl held), and the other Ctrl+Tab
// handlers stand aside through owns(). Escape and Enter, which end the cycle, are
// swallowed; there is nothing left to hear after them.
//
// What the steps do on screen is the renderer's business (js/tab-mru.js): main
// only says { kind: 'step', dir: 1 | -1 }, { kind: 'commit' } or { kind: 'cancel' }
// over 'tabs:mru-key'. Off (the default until the window says otherwise), this
// owns no key and Ctrl+Tab does what it always did.
//
// handle(input, win) → true when the caller must keep the key from the page
// (Escape or Enter ending a cycle); false for everything else, Ctrl+Tab included.
const CHANNEL = 'tabs:mru-key';

function isCtrlTab(input) {
  return !!input && input.type === 'keyDown' && input.key === 'Tab' && !!(input.control || input.meta) && !input.alt;
}

function createMruKeys({ isOn, send }) {
  if (typeof isOn !== 'function' || typeof send !== 'function') throw new Error('createMruKeys needs isOn() and send(win, message)');
  let active = null;   // { win, onBlur } while a cycle is running

  function end(kind) {
    if (!active) return false;
    const { win, onBlur } = active;
    active = null;
    if (win && typeof win.removeListener === 'function') win.removeListener('blur', onBlur);
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
    send(win, { kind });
    return true;
  }

  return {
    CHANNEL,
    // Whether this key is this feature's (without acting on it): the other
    // Ctrl+Tab handlers stand aside for it.
    owns(input) { return isOn() && isCtrlTab(input); },
    get running() { return !!active; },
    handle(input, win) {
      if (!input || !win) return false;
      if (!isOn()) {
        // Switched off in the middle of a cycle: finish it where it stands.
        if (active) end('commit');
        return false;
      }
      if (isCtrlTab(input)) {
        if (active && active.win !== win) end('commit');
        if (!active) {
          const onBlur = () => { end('commit'); };
          active = { win, onBlur };
          if (typeof win.once === 'function') win.once('blur', onBlur);
        }
        send(win, { kind: 'step', dir: input.shift ? -1 : 1 });
        return false;   // not swallowed: see THE TRAP above
      }
      if (!active) return false;
      if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) { end('commit'); return false; }
      if (input.type === 'keyDown' && input.key === 'Escape') { end('cancel'); return true; }
      if (input.type === 'keyDown' && input.key === 'Enter') { end('commit'); return true; }
      return false;
    },
    // The window went away or the setting changed.
    stop() { return end('cancel'); },
  };
}

module.exports = { createMruKeys, isCtrlTab, CHANNEL };
