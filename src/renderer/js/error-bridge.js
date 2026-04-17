// Phase 17A debug: surface ALL uncaught renderer errors so they flow through
// the console-message bridge into the main terminal.

(function () {
  window.addEventListener('error', (e) => {
    const stack = (e.error && e.error.stack) || '';
    console.error(`[UNCAUGHT] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno} ${stack ? '\n' + stack : ''}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = (r && r.message) || String(r);
    const stack = (r && r.stack) || '';
    console.error(`[UNHANDLED-PROMISE] ${msg} ${stack ? '\n' + stack : ''}`);
  });

  console.log('[ErrorBridge] Ready — uncaught errors and promise rejections will surface.');
})();
