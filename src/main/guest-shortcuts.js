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
    // Notes and picture-in-picture are answered in main.js for Vex's own
    // interface only, so from a page they did nothing (found 2026-10-10).
    n: 'toggle-notes',
    p: 'toggle-pip',
  },
};

// A report from the page preload → { channel, args? }, or null. The action
// comes from the table here, or is the registry's key (`wanted`, the keys the
// window asked for), never from the page. Any other Ctrl or Ctrl+Shift letter
// the registry answers, the shortcut sheet's Ctrl+Shift+K, AI full screen's
// Ctrl+Shift+F or one you bound yourself, did nothing from a page
// (found 2026-10-10); the page still has it first.
function pageShortcut(report, { wanted = null } = {}) {
  if (!report || typeof report.key !== 'string' || report.key.length !== 1) return null;
  const shift = report.shift === true;
  const table = shift ? PAGE_FIRST.shifted : PAGE_FIRST.plain;
  const lk = report.key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(table, lk)) return { channel: table[lk] };
  if (!/^[a-z0-9]$/.test(lk) || !wanted || !wanted.has('Ctrl+' + (shift ? 'Shift+' : '') + lk.toUpperCase())) return null;
  return { channel: 'guest-shortcut', args: [{ key: lk, ctrl: true, shift, alt: false }] };
}

// Browser keys main answers before the page, which the user may move. Until
// the window has said which keys it answers they do what they always did;
// after that one goes up as the key while the registry wants it (whatever it
// is now bound to) and is the page's once nothing is bound to it. They kept
// focusing the bar, hard reloading and locking Vex inside pages after being
// moved to another key (found 2026-10-10).
const BROWSER_KEYS = {
  'Ctrl+L': 'focus-address-bar',
  'Ctrl+Shift+R': 'hard-reload-tab',
  'Ctrl+Alt+L': 'lock-vex',
};

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

function shortcutFor(input, { ownsFind = false, ownsZoom = false, wanted = null } = {}) {
  if (!input || input.type !== 'keyDown') return null;
  const ctrl = input.control || input.meta;
  // Vex's own PDF and image viewers zoom the document themselves: the zoom keys are theirs while they have the focus.
  if (ownsZoom && ctrl && !input.alt && ['=', '+', '-', '_', '0'].includes(String(input.key || ''))) return null;

  const browserCombo = comboOf(input);
  if (Object.prototype.hasOwnProperty.call(BROWSER_KEYS, browserCombo)) {
    if (!wanted || !wanted.size) return { channel: BROWSER_KEYS[browserCombo] };
    if (!wanted.has(browserCombo)) return null;
    const k = String(input.key || '').toLowerCase();
    return { channel: 'guest-shortcut', args: [{ key: k, ctrl: true, shift: !!input.shift, alt: !!input.alt }] };
  }

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

// Back, Forward and Reload from a page name the page (its webContents id),
// and so does a key passed up to the registry (F5, Ctrl+F5, Shift+F5): the
// window refuses them when that page is a side panel's, so a key pressed in
// Discord's panel no longer moves the website beside or behind it
// (js/nav-lock.js, found 2026-10-12).
const FROM_PAGE = new Set(['navigate-back', 'navigate-forward', 'reload-tab', 'hard-reload-tab']);
function withSource(hit, pageId) {
  if (!hit) return hit;
  if (!Number.isInteger(pageId)) throw new Error('withSource needs the page\'s webContents id');
  if (FROM_PAGE.has(hit.channel)) return { channel: hit.channel, args: [pageId] };
  if (hit.channel === 'guest-shortcut') return { channel: hit.channel, args: [{ ...hit.args[0], from: pageId }] };
  return hit;
}

module.exports = { shortcutFor, comboOf, pageShortcut, withSource, PLAIN, SHIFTED, PAGE_FIRST, PASS_UP, BROWSER_KEYS };
