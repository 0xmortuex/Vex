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

  /**
   * A long press, and only a long press.
   *
   * The browser synthesises a click on touchend whatever happened in between, so
   * every element that had both an onclick and a long-press ran both: holding a
   * tab card opened its menu AND switched to the tab, holding a history row
   * opened the link sheet AND navigated to it. Preventing the default on the
   * touchend that ended a long press is what stops that click — which is why the
   * listener cannot be passive, and why `fired` has to outlive the timer.
   */
  function longPress(element, handler, delay = 480) {
    let timer = null, startX = 0, startY = 0, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    element.addEventListener('touchstart', event => {
      // A second finger is a pinch or a fumble, not a longer press — and its
      // touchstart must not leave the first finger's timer running beside a
      // new one, or the handler runs twice.
      cancel();
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      startX = touch.clientX; startY = touch.clientY;
      fired = false;
      timer = setTimeout(() => { timer = null; fired = true; handler(); }, delay);
    }, { passive: true });
    element.addEventListener('touchmove', event => {
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12) cancel();
    }, { passive: true });
    element.addEventListener('touchend', event => {
      cancel();
      if (!fired) return;              // an ordinary tap: let the click through
      fired = false;
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    element.addEventListener('touchcancel', () => { cancel(); fired = false; }, { passive: true });
  }

  /**
   * Swipe something sideways to throw it away — a tab card, the way Samsung
   * Internet and Chrome close one. The element follows the finger and fades;
   * past a third of its width, or flicked, it goes, and `onDismiss` is told
   * which way. Anything less springs back.
   *
   * It only takes the gesture once the finger is plainly moving sideways, so
   * scrolling the grid up and down still scrolls it. A drag that moved the
   * card never becomes a tap on it either.
   */
  function dismiss(element, onDismiss) {
    let startX = 0, startY = 0, startAt = 0, dx = 0, state = 'idle';
    const reset = animate => {
      element.style.transition = animate ? 'transform 180ms ease, opacity 180ms ease' : '';
      element.style.transform = '';
      element.style.opacity = '';
    };
    element.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { state = 'idle'; return; }
      const touch = event.touches[0];
      startX = touch.clientX; startY = touch.clientY; startAt = Date.now(); dx = 0;
      state = 'pending';
      element.style.transition = '';
    }, { passive: true });
    element.addEventListener('touchmove', event => {
      if (state === 'idle' || state === 'scrolling') return;
      const touch = event.touches[0];
      const moveX = touch.clientX - startX, moveY = touch.clientY - startY;
      if (state === 'pending') {
        if (Math.abs(moveY) > 10 && Math.abs(moveY) > Math.abs(moveX)) { state = 'scrolling'; return; }
        if (Math.abs(moveX) < 12 || Math.abs(moveX) < Math.abs(moveY) * 1.5) return;
        state = 'dragging';
      }
      dx = moveX;
      if (event.cancelable) event.preventDefault();
      const width = element.offsetWidth || 1;
      element.style.transform = 'translateX(' + dx + 'px)';
      element.style.opacity = String(Math.max(0.15, 1 - Math.abs(dx) / width));
    }, { passive: false });
    element.addEventListener('touchend', event => {
      const was = state;
      state = 'idle';
      if (was !== 'dragging') return;
      if (event.cancelable) event.preventDefault();       // a drag is not a tap
      const width = element.offsetWidth || 1;
      const speed = Math.abs(dx) / Math.max(1, Date.now() - startAt);
      if (Math.abs(dx) > width / 3 || (speed > 0.6 && Math.abs(dx) > 40)) {
        element.style.transition = 'transform 160ms ease, opacity 160ms ease';
        element.style.transform = 'translateX(' + (dx < 0 ? -1 : 1) * width * 1.2 + 'px)';
        element.style.opacity = '0';
        setTimeout(() => onDismiss(dx < 0 ? 'left' : 'right'), 150);
      } else {
        reset(true);
      }
    }, { passive: false });
    element.addEventListener('touchcancel', () => { state = 'idle'; reset(true); }, { passive: true });
  }

  return { swipe, longPress, dismiss };
})();

if (typeof window !== 'undefined') window.VexGestures = VexGestures;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGestures };
