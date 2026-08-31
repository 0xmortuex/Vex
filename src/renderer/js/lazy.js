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
};

if (typeof window !== 'undefined') window.VexLazy = VexLazy;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLazy };
