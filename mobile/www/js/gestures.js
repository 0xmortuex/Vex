// === Vex Mobile — gestures ===
//
// Touch shortcuts on the bottom toolbar, the way phone browsers do them:
//   swipe left / right on the URL pill → previous / next tab
//   swipe up on the URL pill           → tab switcher
//   swipe down on the URL pill         → reload
//   long-press the tab button          → new tab
// Page-edge swipes (back / forward from the left or right screen edge) cannot
// be seen from here: the page is a native WebView on top of this layer, so its
// touches never reach the chrome. Those are detected in TabWebView and arrive
// as the bridge's 'edgeSwipe' event.

const VexGestures = (() => {
  const THRESHOLD = 46;      // px before a drag counts as a swipe
  const SLOP = 30;           // px of cross-axis movement still allowed
  const TIME = 600;          // ms — slower than this is a press, not a swipe

  function swipe(element, handlers) {
    let startX = 0, startY = 0, startAt = 0, tracking = false;
    element.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { tracking = false; return; }
      const touch = event.touches[0];
      startX = touch.clientX; startY = touch.clientY; startAt = Date.now(); tracking = true;
    }, { passive: true });
    element.addEventListener('touchend', event => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX, dy = touch.clientY - startY;
      if (Date.now() - startAt > TIME) return;
      if (Math.abs(dx) > THRESHOLD && Math.abs(dy) < SLOP) {
        const horizontal = dx < 0 ? handlers.left : handlers.right;
        if (horizontal) horizontal();
      } else if (Math.abs(dy) > THRESHOLD && Math.abs(dx) < SLOP) {
        const vertical = dy < 0 ? handlers.up : handlers.down;
        if (vertical) vertical();
      }
    }, { passive: true });
  }

  function longPress(element, handler, delay = 480) {
    let timer = null, startX = 0, startY = 0;
    const cancel = () => { clearTimeout(timer); timer = null; };
    element.addEventListener('touchstart', event => {
      const touch = event.touches[0];
      startX = touch.clientX; startY = touch.clientY;
      timer = setTimeout(() => { timer = null; handler(); }, delay);
    }, { passive: true });
    element.addEventListener('touchmove', event => {
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12) cancel();
    }, { passive: true });
    element.addEventListener('touchend', cancel, { passive: true });
    element.addEventListener('touchcancel', cancel, { passive: true });
  }

  return { swipe, longPress };
})();

if (typeof window !== 'undefined') window.VexGestures = VexGestures;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGestures };
