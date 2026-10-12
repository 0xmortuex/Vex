// === A keyboard focus ring that can always be seen ===========================
//
// css/a11y.css draws the ring in the theme's accent. On the Firefox look's grey
// toolbar, on XP's blue caption, on an active tab that IS the accent, that ring
// is 1.1:1 to 2.9:1 against what it sits on (WCAG 1.4.11 asks 3:1), so a
// keyboard user could not see where they were. check:ui measured 335 of them.
//
// The ring cannot be one colour for every surface, and the surface behind a
// control is only known once it is painted. So when a control takes keyboard
// focus, the colour behind its ring is worked out the way check:ui works it
// out (the nearest painted background, a gradient's --b-frame-solid) and, if
// the accent is under 3:1 there, the accent is lightened or darkened — as far
// as it takes, towards white or black — until it clears. The accent stays the
// accent wherever it already reads. Pure, so it is tested without a window.
const VexFocusRing = (() => {
  const MIN = 3.3;            // WCAG asks 3; the margin covers blending rounding
  const VAR = '--vex-focus-ring';
  let canvas = null;

  function clamp(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  // rgb()/rgba() fast; anything else (oklch, color-mix output, named) through a
  // 1x1 canvas, which always yields sRGB. null when it cannot be read.
  function parse(str) {
    str = String(str || '').trim();
    if (!str || str === 'none') return null;
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3 && p.every(x => !isNaN(x))) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    if (typeof document === 'undefined') return null;
    if (!canvas) { canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    const before = ctx.fillStyle;
    ctx.fillStyle = str;
    if (ctx.fillStyle === before && !/^#0{3,8}$|^black$/i.test(str)) return null;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: clamp(d[0] / a), g: clamp(d[1] / a), b: clamp(d[2] / a), a };
  }

  function over(top, under) {
    return {
      r: clamp(top.r * top.a + under.r * (1 - top.a)),
      g: clamp(top.g * top.a + under.g * (1 - top.a)),
      b: clamp(top.b * top.a + under.b * (1 - top.a)),
      a: 1,
    };
  }

  function luminance(c) {
    const ch = [c.r, c.g, c.b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(a, b) {
    const x = luminance(a) + 0.05, y = luminance(b) + 0.05;
    return x > y ? x / y : y / x;
  }

  function mix(from, to, t) {
    return { r: from.r + (to.r - from.r) * t, g: from.g + (to.g - from.g) * t, b: from.b + (to.b - from.b) * t, a: 1 };
  }

  const css = (c) => 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';

  // The colour for the ring, or null when the accent already reads. `accent`
  // and `bg` are {r,g,b,a} with bg opaque.
  function pick(accent, bg) {
    const base = over(accent, bg);   // an accent with alpha is what is seen
    if (contrast(base, bg) >= MIN) return null;
    const white = { r: 255, g: 255, b: 255, a: 1 }, black = { r: 0, g: 0, b: 0, a: 1 };
    // Toward whichever pole this surface is further from.
    const poles = contrast(white, bg) >= contrast(black, bg) ? [white, black] : [black, white];
    for (const pole of poles) {
      for (const t of [0.3, 0.5, 0.7, 0.85]) {
        const c = mix(base, pole, t);
        if (contrast(c, bg) >= MIN) return css(c);
      }
    }
    return css(poles[0]);
  }

  // What is painted behind `el`: the nearest opaque background, the layers over
  // it composited; a gradient is read from the look's --b-frame-solid. White
  // when nothing is painted at all.
  function backgroundBehind(el) {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && bi.indexOf('gradient') !== -1) {
        const solid = parse(cs.getPropertyValue('--b-frame-solid'));
        if (solid && solid.a > 0) { layers.push({ r: solid.r, g: solid.g, b: solid.b, a: 1 }); break; }
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.999) break;
      }
    }
    if (!layers.length) return { r: 255, g: 255, b: 255, a: 1 };
    let out = layers[layers.length - 1];
    if (out.a < 0.999) out = over(out, { r: 255, g: 255, b: 255, a: 1 });
    for (let i = layers.length - 2; i >= 0; i--) out = over(layers[i], out);
    return out;
  }

  // The element that wears the ring, and the one the custom property goes on.
  // A switch hides its checkbox; the ring is on the track beside it.
  function hostFor(el) {
    if (el.matches('.toggle input') && el.nextElementSibling) return { ring: el.nextElementSibling, set: el.parentElement };
    return { ring: el, set: el };
  }

  let current = null;
  function clear() {
    if (current) { current.style.removeProperty(VAR); current = null; }
  }

  function onFocusIn(e) {
    clear();
    const el = e.target;
    if (!el || el.nodeType !== 1 || el.tagName === 'WEBVIEW' || !el.matches(':focus-visible')) return;
    const { ring, set } = hostFor(el);
    set.style.removeProperty(VAR);
    const cs = getComputedStyle(ring);
    if (cs.outlineStyle === 'none') return;     // the ring is drawn some other way (the address bar's)
    const accent = parse(cs.outlineColor);
    if (!accent) throw new Error('focus ring colour ' + JSON.stringify(cs.outlineColor) + ' could not be read');
    const offset = parseFloat(cs.outlineOffset) || 0;
    const behind = backgroundBehind(offset >= 0 && ring.parentElement ? ring.parentElement : ring);
    const c = pick(accent, behind);
    if (!c) return;
    set.style.setProperty(VAR, c);
    current = set;
  }

  // Was the last thing the person did a key press? Menus opened by the menu key
  // or Shift+F10 are worked from the keyboard (js/tabs.js _attachMenuDismissal);
  // a right-click is not. Leaving the window for a page (blur) forgets it.
  const modality = { keyboard: false };
  const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'];

  function init() {
    if (document.__vexFocusRing) return;
    document.__vexFocusRing = true;
    window.VexInputModality = modality;
    document.addEventListener('keydown', (e) => { if (!MODIFIERS.includes(e.key)) modality.keyboard = true; }, true);
    document.addEventListener('pointerdown', () => { modality.keyboard = false; }, true);
    window.addEventListener('blur', () => { modality.keyboard = false; });
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', clear, true);
  }

  return { init, pick, parse, contrast, backgroundBehind, MIN };
})();

if (typeof window !== 'undefined') {
  window.VexFocusRing = VexFocusRing;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexFocusRing.init());
  else VexFocusRing.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFocusRing };
