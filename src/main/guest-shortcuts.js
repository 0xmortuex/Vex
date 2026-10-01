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

// Ctrl+<key> → what Vex does about it, before the page hears it.
const PLAIN = {
  t: 'new-tab',
  w: 'close-tab',
  l: 'focus-address-bar',
  // Reload: Electron has no menu to give a page Ctrl+R, so it did nothing
  // while a page had the focus (found 2026-09-29).
  r: 'reload-tab',
  '=': 'zoom-in',
  '+': 'zoom-in',
  '-': 'zoom-out',
  0: 'zoom-reset',
};

// Ctrl+Shift+<key> → what Vex does about it, before the page hears it.
const SHIFTED = {
  t: 'reopen-last-closed',
};

// Keys a web app may well use for itself: Ctrl+B is bold in an editor,
// Ctrl+Shift+Z is redo, Ctrl+Shift+M mutes you in Discord. Taking them
// before the page (2026-09-20 to 2026-09-29) turned bold into "hide the tab
// sidebar" and redo into "put this tab to sleep". As in Chrome, the page now
// has them first: preload-webview.js watches for these keys and reports
// only the ones the page left alone ('guest:page-shortcut'), and pageShortcut
// below turns that report into what Vex does.
const PAGE_FIRST = {
  plain: {
    b: 'toggle-tabs-sidebar',
    h: 'toggle-history',
    m: 'toggle-mute-tab',
    d: 'bookmark-current',
    p: 'print-page',
    u: 'view-source',
  },
  shifted: {
    o: 'toggle-sessions',
    s: 'toggle-split',
    z: 'sleep-current-tab',
    a: 'toggle-ai-panel',
    m: 'toggle-memory',
    l: 'toggle-schedules',
    h: 'toggle-history-ai',
  },
};

// A report from the page preload → { channel }, or null. The action comes
// from the table here, never from the page.
function pageShortcut(report) {
  if (!report || typeof report.key !== 'string' || report.key.length !== 1) return null;
  const table = report.shift === true ? PAGE_FIRST.shifted : PAGE_FIRST.plain;
  const lk = report.key.toLowerCase();
  return Object.prototype.hasOwnProperty.call(table, lk) ? { channel: table[lk] } : null;
}

// Keys the renderer's own registry owns (and the user may have rebound): the
// key travels, not a decision made here.
const PASS_UP = { shift: ['y', 'g'], plain: ['j'] };

// The combination as the renderer's registry writes it: "Ctrl+Alt+B", "Alt+Q".
// Only used to compare against the keys the renderer said it wants.
function comboOf(input) {
  const key = String(input.key || '');
  if (!key || ['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return '';
  const mods = [];
  if (input.control || input.meta) mods.push('Ctrl');
  if (input.alt) mods.push('Alt');
  if (input.shift) mods.push('Shift');
  let k = key;
  if (k === ' ') k = 'Space';
  else if (k.startsWith('Arrow')) k = k.slice(5);
  else if (k.length === 1) k = k.toUpperCase();
  mods.push(k);
  return mods.join('+');
}

function shortcutFor(input, { ownsFind = false, wanted = null } = {}) {
  if (!input || input.type !== 'keyDown') return null;
  const ctrl = input.control || input.meta;

  // Anything the renderer's registry has a binding for goes up as the key
  // itself, so a shortcut works while you are reading a page and keeps
  // working after you rebind it. `wanted` is the live set of combinations
  // the renderer asked for (main.js keeps it in step); without it, only the
  // fixed table below answers — which is what left every Ctrl+Alt shortcut
  // dead inside a page.
  //
  // A page's own keys are never taken: the checks below run first for the
  // ones a page owns, and a plain letter is never in `wanted` because the
  // registry refuses to bind one.
  if (wanted && wanted.size) {
    const combo = comboOf(input);
    // A combination with neither Ctrl nor Alt (a plain letter) is the page's,
    // whatever the registry sent (function keys aside).
    const modified = !!ctrl || !!input.alt || /^(Shift\+)?F\d{1,2}$/.test(combo);
    if (combo && modified && wanted.has(combo) && !/^(Ctrl\+[A-Z]|Ctrl\+Shift\+[A-Z])$/.test(combo)) {
      // Only a letter is lowercased: the registry keeps a named key as it is,
      // and 'tab' made Ctrl+Tab read "Ctrl+tab", which matches nothing, so
      // Ctrl+Tab did nothing inside a page (found 2026-09-29).
      const k = String(input.key || '');
      return { channel: 'guest-shortcut', args: [{ key: k.length === 1 ? k.toLowerCase() : k, ctrl: !!ctrl, shift: !!input.shift, alt: !!input.alt }] };
    }
  }

  // Alt+Left / Alt+Right: Back and Forward, as in every browser. The main
  // window answered them, a focused page did not (found 2026-09-29).
  if (input.alt && !ctrl && !input.shift) {
    if (input.key === 'ArrowLeft') return { channel: 'navigate-back' };
    if (input.key === 'ArrowRight') return { channel: 'navigate-forward' };
  }

  if (!ctrl || input.alt) return null;                  // Ctrl+Alt is handled above
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

module.exports = { shortcutFor, comboOf, pageShortcut, PLAIN, SHIFTED, PAGE_FIRST, PASS_UP };
