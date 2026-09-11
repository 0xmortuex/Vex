// Which sites own Ctrl+F themselves.
//
// Vex intercepts Ctrl+F in a focused guest and opens its own find bar. That is
// right almost everywhere, but wrong for apps that paint their document text
// into a <canvas> instead of the DOM: Chromium's findInPage walks the text tree,
// so canvas pixels are invisible to it. Measured on a page holding both forms,
// findInPage reported 1 match for DOM text and 0 for the identical text drawn
// into a canvas.
//
// Google Docs, Sheets and Slides render that way and ship their own find, so
// swallowing the key there replaced a working search with a find bar that could
// only ever report nothing. For these hosts the key is left alone and reaches
// the page.
//
// Matching is on the registrable host with an anchored suffix, so a look-alike
// like docs.google.com.evil.test does NOT qualify.
const OWNS_FIND = [
  /(^|\.)docs\.google\.com$/i,
];

function guestOwnsFind(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return false;
    return OWNS_FIND.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

// Ctrl+F reached Vex's chrome instead of the page - the case main.js cannot
// pass through, because the keystroke never went to the guest at all. It
// happens whenever Vex's own UI has focus, e.g. straight after clicking a tab:
// on a Google Sheet that opened Vex's find bar, which reported 0/0 for a name
// sitting in plain view on row 15. If the active page owns find, hand it the
// keystroke instead. Returns true when it did.
//
// Loaded by the renderer as a classic script as well as required by main, so it
// stays free of require() and guards its export.
function handFindToPage(webview) {
  if (!webview) return false;
  let url;
  try { url = (typeof webview.getURL === 'function' && webview.getURL()) || ''; } catch { url = ''; }
  if (!guestOwnsFind(url) || typeof webview.sendInputEvent !== 'function') return false;
  try {
    if (typeof webview.focus === 'function') webview.focus();
    webview.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] });
    webview.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] });
    return true;
  } catch {
    return false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { guestOwnsFind, handFindToPage, OWNS_FIND };
}
