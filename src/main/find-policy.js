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

module.exports = { guestOwnsFind, OWNS_FIND };
