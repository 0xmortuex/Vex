// === Start Page Interactions ===
// Communication from start page webview now uses console-message events
// intercepted by WebviewManager (VEX_CMD: prefix in console.log).
// This module is kept for any future start page coordination.

const StartPageManager = {
  init() {
    // VEX_CMD messages from start page webviews are handled
    // in webview.js via the 'console-message' event listener.
    // No window.addEventListener('message') needed — webviews
    // are separate processes, not iframes, so postMessage doesn't
    // cross the boundary.
  }
};
