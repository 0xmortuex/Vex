// === Vex Mobile — the shield ===
//
// The desktop build's fingerprint protection runs in a preload, before the
// page's own scripts. On Android the equivalent is a document-start script
// (WebViewCompat.addDocumentStartJavaScript), which VexTabs installs on every
// tab — so this module's job is only to decide what that script says.
//
// Three levels, because fingerprint defences trade away compatibility:
//   off      — nothing is injected
//   standard — canvas/audio/WebGL readouts get a stable per-session jitter,
//              and Global Privacy Control is announced. Sites keep working.
//   strict   — also flattens the obvious hardware tells (cores, memory,
//              plugins) and refuses the battery API. Some sites notice.
//
// The jitter is per session and per origin, not per call: a value that changes
// on every read is itself a signal, and it breaks canvas-based rendering.

const VexShield = (() => {
  const LEVELS = {
    off: { label: 'Off', note: 'Sites see your device as it is.' },
    standard: { label: 'Standard', note: 'Canvas, audio and WebGL readouts are nudged. Nothing breaks.' },
    strict: { label: 'Strict', note: 'Also hides core count, memory and plugins. A few sites notice.' }
  };

  // Only added at the strict level.
  const STRICT = `
  function fixed(object, name, value) {
    try { Object.defineProperty(object, name, { get: function () { return value; }, configurable: true }); } catch (e) {}
  }
  fixed(navigator, 'hardwareConcurrency', 4);
  fixed(navigator, 'deviceMemory', 4);
  fixed(navigator, 'plugins', []);
  fixed(navigator, 'mimeTypes', []);
  try { navigator.getBattery = function () { return Promise.reject(new Error('Not available')); }; } catch (e) {}
  try { fixed(screen, 'colorDepth', 24); } catch (e) {}`;

  function level() {
    const value = VexStore.get('vex.shield', 'standard');
    return LEVELS[value] ? value : 'standard';
  }

  // Built as a string because it has to survive being handed to Android and
  // evaluated in a page that has not run a line of its own yet.
  function script(forLevel) {
    const chosen = forLevel || level();
    if (chosen === 'off') return '';
    // The strict section is concatenated rather than guarded by an `if`: a
    // page should not be handed code that will never run, and a shim that is
    // present but inert is the kind of thing that reads as protection in a
    // review and is not.
    const strict = chosen === 'strict' ? STRICT : '';
    return `(function(){
  if (window.__vexShield) return;
  window.__vexShield = ${JSON.stringify(chosen)};

  // One seed per origin per session: stable enough for the page to render the
  // same thing twice, different enough that the readout is not a fingerprint.
  var seed = 0, key = location.origin + '|' + (window.__vexSession || '');
  for (var i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
  function jitter(n) { seed = (seed * 1103515245 + 12345) >>> 0; return (seed % (2 * n + 1)) - n; }

  try {
    var toDataURL = HTMLCanvasElement.prototype.toDataURL;
    var getImageData = CanvasRenderingContext2D.prototype.getImageData;
    function smudge(context, width, height) {
      try {
        var data = getImageData.call(context, 0, 0, Math.min(width, 16), 1);
        for (var i = 0; i < data.data.length; i += 4) {
          data.data[i] = Math.max(0, Math.min(255, data.data[i] + jitter(1)));
        }
        context.putImageData(data, 0, 0);
      } catch (e) {}
    }
    HTMLCanvasElement.prototype.toDataURL = function () {
      var context = this.getContext('2d');
      if (context && this.width && this.height) smudge(context, this.width, this.height);
      return toDataURL.apply(this, arguments);
    };
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
      var data = getImageData.apply(this, arguments);
      if (w * h > 1) {
        for (var i = 0; i < data.data.length; i += 997 * 4) {
          data.data[i] = Math.max(0, Math.min(255, data.data[i] + jitter(1)));
        }
      }
      return data;
    };
  } catch (e) {}

  try {
    var getChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function () {
      var out = getChannelData.apply(this, arguments);
      for (var i = 0; i < out.length; i += 1013) out[i] = out[i] + jitter(1) * 1e-7;
      return out;
    };
  } catch (e) {}

  try {
    var getParameter = WebGLRenderingContext.prototype.getParameter;
    function masked(parameter) {
      // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
      if (parameter === 37445) return 'Vex';
      if (parameter === 37446) return 'Vex Renderer';
      return null;
    }
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      var value = masked(parameter);
      return value === null ? getParameter.apply(this, arguments) : value;
    };
    if (window.WebGL2RenderingContext) {
      var getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (parameter) {
        var value = masked(parameter);
        return value === null ? getParameter2.apply(this, arguments) : value;
      };
    }
  } catch (e) {}

  try {
    Object.defineProperty(navigator, 'globalPrivacyControl', { get: function () { return true; }, configurable: true });
  } catch (e) {}

${strict}
})();`;
  }

  return {
    LEVELS,
    level,
    script,

    async setLevel(value) {
      await VexStore.set('vex.shield', LEVELS[value] ? value : 'standard');
      return this.install();
    },

    // Hand the current script to native. The result says whether it will
    // really run at document start, which the settings screen repeats back —
    // on an old WebView it runs a moment later and a fast tracker can beat it.
    async install() {
      const source = script();
      const result = await VexBridge.setDocumentStartScript(source);
      const early = !!(result && result.atDocumentStart);
      await VexStore.set('vex.shieldEarly', early);
      return { level: level(), early, empty: !source };
    }
  };
})();

if (typeof window !== 'undefined') window.VexShield = VexShield;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexShield };
