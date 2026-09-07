// Owned cleanup for tab/panel resources; disposal is idempotent.
(function () {
  class Lifecycle {
    constructor() { this.cleanups = new Set(); this.disposed = false; }
    own(cleanup) { if (this.disposed) cleanup(); else this.cleanups.add(cleanup); return cleanup; }
    listen(target, event, callback, options) { target.addEventListener(event, callback, options); return this.own(() => target.removeEventListener(event, callback, options)); }
    timeout(callback, delay) {
      const id = setTimeout(() => { this.cleanups.delete(cleanup); if (!this.disposed) callback(); }, delay);
      const cleanup = () => clearTimeout(id); this.own(cleanup); return cleanup;
    }
    interval(callback, delay) { const id = setInterval(() => { if (!this.disposed) callback(); }, delay); return this.own(() => clearInterval(id)); }
    static run(operation, { signal, timeout = 30000 } = {}) {
      return new Promise((resolve, reject) => {
        const scope = new Lifecycle();
        const finish = (error, value) => { scope.dispose(); error ? reject(error) : resolve(value); };
        if (signal?.aborted) return finish(signal.reason || new Error('Cancelled'));
        if (signal) scope.listen(signal, 'abort', () => finish(signal.reason || new Error('Cancelled')), { once: true });
        scope.timeout(() => finish(new Error('Operation timed out')), timeout);
        Promise.resolve().then(operation).then(value => finish(null, value)).catch(error => finish(error));
      });
    }
    static ready(webview, signal, timeout = 30000) {
      return Lifecycle.run(() => new Promise((resolve, reject) => {
        const scope = new Lifecycle();
        const finish = error => { scope.dispose(); error ? reject(error) : resolve(); };
        if (signal?.aborted) return finish(signal.reason || new Error('Cancelled'));
        if (signal) scope.listen(signal, 'abort', () => finish(signal.reason || new Error('Cancelled')), { once: true });
        scope.listen(webview, 'dom-ready', () => finish());
        scope.listen(webview, 'did-fail-load', event => { if (event.isMainFrame !== false && event.errorCode !== -3) finish(new Error('Scheduled page failed to load')); });
        scope.listen(webview, 'vex-disposed', () => finish(new Error('Scheduled tab was closed')));
        scope.timeout(() => finish(new Error('Page readiness timed out')), timeout);
        try { if (webview.getURL?.() && webview.isLoading?.() === false) finish(); } catch { /* guest is still attaching */ }
      }), { signal, timeout: timeout + 100 });
    }
    dispose() { if (this.disposed) return; this.disposed = true; for (const cleanup of this.cleanups) { try { cleanup(); } catch {} } this.cleanups.clear(); }
  }
  window.VexLifecycle = Lifecycle;
})();
