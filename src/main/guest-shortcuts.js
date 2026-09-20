// === The keys Vex answers while a page has the focus =======================
//
// Vex's own shortcuts are handled on the window's webContents, which only sees
// a key when Vex's own interface has the focus. The moment you click into a
// page — which is most of the time — that handler stops hearing anything, and
// the shortcut appeared to need "a click somewhere else first".
//
// The guest's own key handler is where this is fixed, and it has to be careful
// about two things:
//   * a page owns its keys. Ctrl+S, Ctrl+P, Ctrl+A, Ctrl+C and the rest are
//     not Vex's, and Ctrl+Shift+I/J/C belong to the developer tools.
//   * a key the user rebound is the renderer's business. Those are passed up
//     as the key itself ('guest-shortcut'), so the renderer's registry decides
//     what they do, rebinding and all.
//
// → { channel, args } for a key Vex answers, or null to let the page have it.

// Ctrl+<key> → what Vex does about it.
const PLAIN = {
  t: 'new-tab',
  w: 'close-tab',
  l: 'focus-address-bar',
  d: 'bookmark-current',
  b: 'toggle-tabs-sidebar',
  h: 'toggle-history',
  m: 'toggle-mute-tab',
  '=': 'zoom-in',
  '+': 'zoom-in',
  '-': 'zoom-out',
  0: 'zoom-reset',
};

// Ctrl+Shift+<key> → what Vex does about it.
const SHIFTED = {
  t: 'reopen-last-closed',
  o: 'toggle-sessions',
  s: 'toggle-split',
  z: 'sleep-current-tab',
  a: 'toggle-ai-panel',
  m: 'toggle-memory',
  l: 'toggle-schedules',
  h: 'toggle-history-ai',
};

// Keys the renderer's own registry owns (and the user may have rebound): the
// key travels, not a decision made here.
const PASS_UP = { shift: ['y', 'g'], plain: ['j'] };

function shortcutFor(input, { ownsFind = false } = {}) {
  if (!input || input.type !== 'keyDown') return null;
  const ctrl = input.control || input.meta;
  if (!ctrl || input.alt) return null;                  // Ctrl+Alt is handled on its own
  const key = String(input.key || '');
  const lk = key.toLowerCase();

  if (input.shift) {
    if (key === 'Tab') return { channel: 'prev-tab' };
    if (PASS_UP.shift.includes(lk)) return { channel: 'guest-shortcut', args: [{ key, ctrl: true, shift: true, alt: false }] };
    return SHIFTED[lk] ? { channel: SHIFTED[lk] } : null;
  }

  // Ctrl+F: a site with a find of its own (a code host, a spreadsheet) keeps
  // it — Vex's find bar cannot search what that page has not rendered.
  if (lk === 'f') return ownsFind ? null : { channel: 'find-in-page' };
  if (lk === 'tab') return { channel: 'next-tab' };
  if (PASS_UP.plain.includes(lk)) return { channel: 'guest-shortcut', args: [{ key: lk, ctrl: true, shift: false, alt: false }] };
  if (PLAIN[lk]) return { channel: PLAIN[lk] };
  if (lk >= '1' && lk <= '9') return { channel: 'jump-to-tab', args: [parseInt(lk, 10)] };
  return null;
}

module.exports = { shortcutFor, PLAIN, SHIFTED, PASS_UP };
