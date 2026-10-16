// === Vex lazy module loader ===
// Loads a renderer module's <script> on first use instead of at boot, so
// rarely-opened, self-contained features (a modal reached only from a command)
// don't cost startup parse time or resident memory until you actually open them.
// Idempotent: the same src is fetched once; concurrent callers share the promise.
// Only safe for modules with NO boot side-effects (they just define window.X and
// wait to be called) — anything that wires listeners or runs work at load must
// stay eagerly loaded.
const VexLazy = {
  _loaded: new Map(), // src -> Promise<boolean>
  ensure(src) {
    if (this._loaded.has(src)) return this._loaded.get(src);
    const p = new Promise((resolve, reject) => {
      try {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve(true);
        s.onerror = () => { this._loaded.delete(src); reject(new Error('lazy load failed: ' + src)); };
        document.head.appendChild(s);
      } catch (e) { this._loaded.delete(src); reject(e); }
    });
    this._loaded.set(src, p);
    return p;
  },

  // Load a module a little AFTER start-up instead of in the blocking script list
  // (T3-066). For a feature that only registers a Settings section, a Ctrl+K
  // command and its VexUsage switch at load, and that nothing else touches while
  // the window is coming up: it costs no parse time before first paint. Waits for
  // the window's load event, then `delayMs`, then an idle moment (or `timeoutMs`).
  //   usage: ids in VexUsageRegistry to register once the file is in, since the registry's
  //          pass at the end of index.html ran without it.
  // Resolves true when loaded. A failure is reported to VexProblems and rejects.
  _idle: new Map(),
  afterIdle(src, { delayMs = 2500, timeoutMs = 8000, usage = [] } = {}) {
    if (this._idle.has(src)) return this._idle.get(src);
    const p = new Promise((resolve, reject) => {
      const run = () => {
        this.ensure(src).then(() => {
          if (usage.length) {
            if (typeof VexUsageRegistry === 'undefined') throw new Error('The usage registry is not loaded, so ' + src + ' could not register its switch');
            VexUsageRegistry.register(undefined, usage);
          }
          resolve(true);
        }).catch(reject);
      };
      const idle = () => {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: timeoutMs });
        else run();
      };
      const schedule = () => setTimeout(idle, delayMs);
      if (document.readyState === 'complete') schedule();
      else window.addEventListener('load', schedule, { once: true });
    });
    this._idle.set(src, p);
    p.catch(err => { if (typeof VexProblems !== 'undefined') VexProblems.note('Start-up', 'A feature that loads after start-up could not load: ' + src, err); else console.error('[Lazy]', src, err); });
    return p;
  },

  // For the diagnostics: what was loaded on demand or after idle, and what is waiting.
  report() {
    return { loaded: [...this._loaded.keys()], afterIdle: [...this._idle.keys()] };
  },
};

if (typeof window !== 'undefined') window.VexLazy = VexLazy;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLazy };
