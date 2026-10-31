// === Painting a wallpaper behind text, and keeping the text readable ===========
//
// Loaded by BOTH the browser window (to preview a wallpaper and to work out how
// much of it can show) and the New Tab page (start.html), which paints it.
//
// The picture sits in a fixed layer behind the page; over it lies a "scrim" of
// the page's own background colour. How strong the scrim has to be is measured,
// not guessed: the New Tab's real text colours (--vex-text-primary, -secondary,
// -muted, --vex-accent, read as the browser computes them in the look and
// theme that is on) are checked against the wallpaper's lightest and darkest
// pixels, and the scrim is raised until every one of them reads at 4.5:1 (4.7
// is aimed for, for the rounding of compositing). The sliders (dim, blur) can
// only add to that, never go below it while "Keep text readable" is on.
//
//   WallpaperPaint.contrast(rgbA, rgbB)
//   WallpaperPaint.neededScrim({ inks, extremes, scrim })  -> { alpha, ok, worst }
//   WallpaperPaint.paint({ id, src, lightest, darkest, dim, blur, auto }) -> { alpha, required, worst, ok }
//   WallpaperPaint.clear()

(function (root) {
  'use strict';

  const AIM = 4.7;           // a little over 4.5:1
  const AA = 4.5;
  const SRC_RE = /^data:image\/(?:svg\+xml|png|jpeg|webp)[;,]/;

  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luminance = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function hexRgb(h) {
    if (typeof h !== 'string' || !/^#[0-9a-f]{6}$/i.test(h)) throw new Error('Expected #rrggbb, got ' + h);
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  // The lowest contrast of any ink over the picture's two extremes, with `alpha` of the scrim over them.
  function worstContrast(inks, extremes, scrim, alpha) {
    let worst = Infinity;
    for (const p of extremes) {
      const under = mixRgb(p, scrim, alpha);
      for (const ink of inks) worst = Math.min(worst, contrast(ink, under));
    }
    return worst;
  }

  // What a text colour can be asked to reach over the picture: the aim (4.7), but never more than it reaches on the
  // page's own background (a muted text that is 4.6:1 on the plain page cannot be asked for 4.7 over a picture; the
  // wallpaper is held to "no worse than the page", which a full scrim always gives).
  const targetFor = (ink, scrim, min) => Math.min(min, contrast(ink, scrim) - 0.03);

  // The weakest scrim (0..1, steps of 0.01) under which every ink reads as well as it is asked to (targetFor).
  // ok: every ink is at 4.5:1, or as close to it as the page's own colours allow (within 0.05).
  function neededScrim({ inks, extremes, scrim, min = AIM }) {
    if (!Array.isArray(inks) || !inks.length) throw new Error('neededScrim needs the text colours');
    if (!Array.isArray(extremes) || !extremes.length) throw new Error('neededScrim needs the picture\'s lightest and darkest colours');
    const targets = inks.map(ink => targetFor(ink, scrim, min));
    const reads = (a) => extremes.every(p => { const under = mixRgb(p, scrim, a); return inks.every((ink, i) => contrast(ink, under) >= targets[i]); });
    let alpha = 1;
    for (let i = 0; i <= 100; i++) { if (reads(i / 100)) { alpha = i / 100; break; } }
    return { alpha, ok: judge(inks, extremes, scrim, alpha).ok, worst: worstContrast(inks, extremes, scrim, alpha) };
  }
  // Does every ink read at this scrim: 4.5:1, or what the page's own colours give if that is less?
  function judge(inks, extremes, scrim, alpha) {
    const ok = extremes.every(p => { const under = mixRgb(p, scrim, alpha); return inks.every(ink => contrast(ink, under) >= Math.min(AA, contrast(ink, scrim)) - 0.05); });
    return { ok, worst: worstContrast(inks, extremes, scrim, alpha) };
  }

  // --- the page ---------------------------------------------------------------

  // vex-layer-exempt: two pictures drawn behind the New Tab page's own content, pointer-events:none, not a window overlay
  const CSS = `
html[data-wallpaper][data-wallpaper][data-wallpaper], html[data-wallpaper][data-wallpaper][data-wallpaper] body { background: transparent !important; }
#vex-wallpaper, #vex-wallpaper-scrim { position: fixed; inset: 0; pointer-events: none; zoom: 1 !important; margin: 0; }
#vex-wallpaper { z-index: -2; background-size: cover; background-position: center; background-repeat: no-repeat; }
#vex-wallpaper-scrim { z-index: -1; }
@media (prefers-reduced-motion: no-preference) { #vex-wallpaper-scrim { transition: background-color 0.25s ease; } }
`;

  let last = null, observer = null, timer = null, cv = null;

  // The colour a page token (--vex-text-primary ...) has now -> [r, g, b, a]. The token's value is read from the root
  // (custom properties arrive with their var() references already filled in) and the canvas, which understands
  // hex, rgb(), color-mix() and the like, turns it into numbers.
  function resolveToken(name) {
    const raw = root.getComputedStyle(root.document.documentElement).getPropertyValue(name).trim();
    if (!raw) throw new Error('The page has no ' + name + ' colour');
    if (!cv) { cv = root.document.createElement('canvas'); cv.width = cv.height = 1; }
    const x = cv.getContext('2d', { willReadFrequently: true });
    for (const sentinel of ['#010203', '#040506']) {
      x.clearRect(0, 0, 1, 1);
      x.fillStyle = sentinel;
      x.fillStyle = raw;
      x.fillRect(0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      const same = d[0] === parseInt(sentinel.slice(1, 3), 16) && d[1] === parseInt(sentinel.slice(3, 5), 16) && d[2] === parseInt(sentinel.slice(5, 7), 16);
      if (!same) return [d[0], d[1], d[2], d[3] / 255];
    }
    throw new Error(name + ' is not a colour the page can read: ' + raw);
  }

  function pageColours() {
    const scrimRaw = resolveToken('--vex-bg-base');
    const scrim = [scrimRaw[0], scrimRaw[1], scrimRaw[2]];
    const inks = ['--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-accent'].map((name) => {
      const c = resolveToken(name);
      // A translucent ink is seen over the page's background.
      return c[3] < 1 ? mixRgb(scrim, [c[0], c[1], c[2]], c[3]) : [c[0], c[1], c[2]];
    });
    return { scrim, inks };
  }

  function layers() {
    const doc = root.document;
    if (!doc.getElementById('vex-wallpaper-style')) {
      const st = doc.createElement('style');
      st.id = 'vex-wallpaper-style';
      st.textContent = CSS;
      doc.head.appendChild(st);
    }
    let pic = doc.getElementById('vex-wallpaper'), scrim = doc.getElementById('vex-wallpaper-scrim');
    if (!pic) { pic = doc.createElement('div'); pic.id = 'vex-wallpaper'; pic.setAttribute('aria-hidden', 'true'); doc.body.insertBefore(pic, doc.body.firstChild); }
    if (!scrim) { scrim = doc.createElement('div'); scrim.id = 'vex-wallpaper-scrim'; scrim.setAttribute('aria-hidden', 'true'); pic.after(scrim); }
    return { pic, scrim };
  }

  function number(v, lo, hi, what) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error('The wallpaper ' + what + ' must be a number from ' + lo + ' to ' + hi);
    return v;
  }

  function paint(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('paint needs a wallpaper');
    if (typeof spec.src !== 'string' || !SRC_RE.test(spec.src)) throw new Error('Only a checked picture (SVG, PNG, JPEG or WebP data) can be a wallpaper');
    const dim = number(spec.dim == null ? 0 : spec.dim, 0, 0.9, 'dim');
    const blur = number(spec.blur == null ? 0 : spec.blur, 0, 40, 'blur');
    const auto = spec.auto !== false;
    const { pic, scrim } = layers();
    const html = root.document.documentElement;
    last = { id: spec.id || '', src: spec.src, lightest: spec.lightest, darkest: spec.darkest, dim, blur, auto };
    html.setAttribute('data-wallpaper', String(spec.id || 'custom'));
    pic.style.backgroundImage = 'url("' + spec.src + '")';
    pic.style.filter = blur ? 'blur(' + blur + 'px)' : '';
    pic.style.inset = blur ? '-' + (blur * 2) + 'px' : '0';
    return measure(scrim);
  }

  // Works out the scrim for the colours the page wears now and lays it.
  function measure(scrimEl) {
    if (!last) return null;
    const scrim = scrimEl || root.document.getElementById('vex-wallpaper-scrim');
    if (!scrim) return null;
    const { scrim: bg, inks } = pageColours();
    const extremes = [hexRgb(last.lightest), hexRgb(last.darkest)];
    const need = neededScrim({ inks, extremes, scrim: bg });
    const alpha = last.auto ? Math.max(last.dim, need.alpha) : last.dim;
    scrim.style.backgroundColor = 'rgb(' + bg.map(Math.round).join(' ') + ' / ' + alpha.toFixed(2) + ')';
    const j = judge(inks, extremes, bg, alpha);
    return { alpha, required: need.alpha, worst: j.worst, ok: j.ok, readable: need.ok };
  }

  // The colours of the page change (theme, look, light and dark): the scrim follows.
  function watch() {
    if (observer || typeof root.MutationObserver !== 'function') return;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { try { measure(); } catch (err) { root.console.error('[wallpaper] re-measuring failed:', err && err.message); } }, 80);
    };
    observer = new root.MutationObserver(again);
    observer.observe(root.document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-scheme', 'data-gui-style', 'data-look', 'data-look-palette', 'data-user-theme', 'class'] });
    observer.observe(root.document.head, { childList: true, subtree: true, characterData: true });
  }

  function clear() {
    last = null;
    const doc = root.document;
    doc.getElementById('vex-wallpaper')?.remove();
    doc.getElementById('vex-wallpaper-scrim')?.remove();
    doc.documentElement.removeAttribute('data-wallpaper');
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(timer);
  }

  const api = {
    AIM, AA, contrast, luminance, mixRgb, hexRgb, neededScrim, worstContrast, judge,
    paint(spec) { const out = paint(spec); watch(); return out; },
    measure: () => measure(), pageColours, clear, current: () => (last ? { ...last } : null),
  };
  if (typeof window !== 'undefined') window.WallpaperPaint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { WallpaperPaint: api };
})(typeof window !== 'undefined' ? window : globalThis);
