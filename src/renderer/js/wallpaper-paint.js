// === Painting a wallpaper behind text, and keeping the text readable ===========
//
// Loaded by BOTH the browser window (to preview a wallpaper and to work out how
// much of it can show) and the New Tab page (start.html), which paints it.
//
// The picture sits in a fixed layer behind the page. The text does NOT get a shade over the whole picture:
// every block of it sits on a "plate" (soft translucent glass in the page's own dark or light, see "plates"
// below), and the contrast of each ink is worked out for the plate laid over the picture's worst places.
// A shade over the picture is the last resort, never more than 35%.
//
//   WallpaperPaint.contrast(rgbA, rgbB)
//   WallpaperPaint.neededScrim({ inks, extremes, scrim })  -> { alpha, ok, worst }
//   WallpaperPaint.plan({ summary, accent, dim, auto, scheme? }) -> { scheme, plate, plateAlpha, shade, worst, ok, ... }  (pure)
//   WallpaperPaint.summarisePixels(rgba, w, h)  -> { lightest, darkest, plateLightest, plateDarkest, mean, meanY }
//   WallpaperPaint.paint({ id, src, lightest, darkest, plateLightest, plateDarkest, mean, meanY, dim, blur, auto }) -> { alpha (the shade), worst, ok, scheme, plate }
//   WallpaperPaint.clear()

(function (root) {
  'use strict';

  const AIM = 4.7;           // a little over 4.5:1
  const AA = 4.5;
  const PLATE_STYLE_ID = 'vex-wallpaper-plates';
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

  // --- plates: the text sits on its own soft glass, not on a shaded picture ------------------
  //
  // The old way shaded the WHOLE picture until the page's ink read over its lightest and its darkest pixel:
  // for any picture with a dark and a bright part that is almost total shade, and the wallpaper vanishes.
  // Now every block of text (clock and greeting, search box, Quick Access, the cards) sits on a "plate": the
  // page's own surface colour (dark glass or light glass, see SCHEMES) at 55-92% over a blurred copy of the
  // picture. The contrast is worked out per element, for the ink that is drawn on the plate, against the
  // plate laid over the picture's worst places. A shade over the whole picture is the last resort, never
  // more than SHADE_MAX, and only once the plate is as strong as it may be.
  //
  // The scheme (light ink on dark glass, or dark ink on light glass) is picked from the picture itself: the
  // one that needs the lighter plate wins, and the picture's brightness decides a tie. The rest of Vex keeps
  // its theme; only the New Tab's text and plates take the scheme.

  const PLATE_MIN = 0.55, PLATE_MAX = 0.92, SHADE_MAX = 0.35;
  const TINT = 0.1;          // how much of the picture's average colour the plate wears
  const TILE = 0.08;         // tiles on a plate (Quick Access cards ...) are the ink at this strength over the plate
  const CELL = 36;           // px of a 1280 x 720 copy: about the reach of the plate's blur (the colours it can pass on)
  const BLUR = 16;           // px, the plate's backdrop blur
  const SCHEMES = {
    dark: { plate: [13, 17, 27], primary: [247, 249, 253], secondary: [224, 229, 239], muted: [200, 208, 222] },
    light: { plate: [255, 255, 255], primary: [17, 20, 27], secondary: [48, 55, 69], muted: [66, 74, 89] },
  };
  const hexOf = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

  // RGBA pixels of a w x h picture -> its extremes. lightest/darkest are single pixels; plateLightest/plateDarkest
  // are the lightest and darkest CELL-wide averages, which is what a blurred plate can really show under a word.
  function summarisePixels(d, w, h) {
    if (!d || !d.length || d.length !== w * h * 4) throw new Error('summarisePixels needs w x h RGBA pixels');
    let lo = Infinity, hi = -1, loC = null, hiC = null, sum = 0, r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = luminance([d[i], d[i + 1], d[i + 2]]);
      sum += y; r += d[i]; g += d[i + 1]; b += d[i + 2];
      if (y < lo) { lo = y; loC = [d[i], d[i + 1], d[i + 2]]; }
      if (y > hi) { hi = y; hiC = [d[i], d[i + 1], d[i + 2]]; }
    }
    let cLo = Infinity, cHi = -1, cLoC = null, cHiC = null;
    for (let cy = 0; cy < h; cy += CELL) {
      for (let cx = 0; cx < w; cx += CELL) {
        let cr = 0, cg = 0, cb = 0, n = 0;
        for (let y = cy; y < Math.min(h, cy + CELL); y++) {
          for (let x = cx; x < Math.min(w, cx + CELL); x++) { const i = (y * w + x) * 4; cr += d[i]; cg += d[i + 1]; cb += d[i + 2]; n++; }
        }
        const c = [cr / n, cg / n, cb / n], y = luminance(c);
        if (y < cLo) { cLo = y; cLoC = c; }
        if (y > cHi) { cHi = y; cHiC = c; }
      }
    }
    const px = d.length / 4;
    return { lightest: hexOf(hiC), darkest: hexOf(loC), plateLightest: hexOf(cHiC), plateDarkest: hexOf(cLoC), mean: hexOf([r / px, g / px, b / px]), meanY: sum / px };
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  // What lies under a word: the picture's pixel `p`, the shade `s` over it, then the plate at `a`, then a tile of ink.
  const seen = (p, shadeRgb, s, plate, a, ink) => mixRgb(mixRgb(mixRgb(p, shadeRgb, s), plate, a), ink, TILE);

  // The weakest (shade, plate) under which every ink reads at `min` over every extreme. Shade is the last resort:
  // the plate is raised to its limit before any shade is added. `shadeFloor` is what the person's Dim asks for.
  function solvePlate({ inks, plate, extremes, shadeFloor = 0, min = AIM }) {
    const fg = inks[0];
    const worstAt = (s, a) => {
      let worst = Infinity;
      for (const p of extremes) { const u = seen(p, plate, s, plate, a, fg); for (const ink of inks) worst = Math.min(worst, contrast(ink, u)); }
      return worst;
    };
    const lo = Math.round(Math.min(SHADE_MAX, shadeFloor) * 100);
    for (let si = lo; si <= SHADE_MAX * 100; si++) {
      for (let ai = PLATE_MIN * 100; ai <= PLATE_MAX * 100; ai++) {
        if (worstAt(si / 100, ai / 100) >= min) return { shade: si / 100, plate: ai / 100, ok: true, worst: worstAt(si / 100, ai / 100) };
      }
    }
    return { shade: Math.max(SHADE_MAX, shadeFloor), plate: PLATE_MAX, ok: false, worst: worstAt(Math.max(SHADE_MAX, shadeFloor), PLATE_MAX) };
  }

  // The accent (links, the quote's source, the wordmark) lifted towards the scheme's ink until it reads on the plate too.
  function liftAccent(accent, comps, target, ink, min = AIM) {
    for (let t = 0; t <= 100; t++) {
      const c = mixRgb(accent, target, t / 100);
      if (comps.every(u => contrast(c, u) >= min)) return c;
    }
    return target;
  }

  // Everything the New Tab (and the store's preview) needs for one picture, from numbers only.
  //   summary  { lightest, darkest, plateLightest?, plateDarkest?, mean? }  (hex)
  //   accent   [r, g, b] the page's own accent colour
  //   dim, auto, scheme ('dark' | 'light' to force one; else picked)
  function plan({ summary, accent, dim = 0, auto = true, scheme }) {
    if (!summary || !summary.lightest || !summary.darkest) throw new Error('plan needs the picture\'s lightest and darkest colours');
    const extremes = [hexRgb(summary.plateLightest || summary.lightest), hexRgb(summary.plateDarkest || summary.darkest)];
    const mean = summary.mean ? hexRgb(summary.mean) : null;
    const acc = accent || [128, 128, 128];
    const one = (name) => {
      const S = SCHEMES[name];
      const plate = mean ? mixRgb(S.plate, mean, TINT) : S.plate.slice();
      const inks = [S.primary, S.secondary, S.muted];
      let r;
      if (auto) r = solvePlate({ inks, plate, extremes, shadeFloor: dim });
      else r = { shade: dim, plate: 0.6, ok: false, worst: Infinity };
      const comps = extremes.map(p => seen(p, plate, r.shade, plate, r.plate, S.primary));
      const accentOut = liftAccent(acc, comps, S.primary, S.primary);
      const worst = Math.min(r.worst || Infinity, ...comps.map(u => contrast(accentOut, u)), ...comps.flatMap(u => inks.map(i => contrast(i, u))));
      return { scheme: name, plate, plateAlpha: r.plate, shade: r.shade, required: r.shade, inks, accent: accentOut, worst, ok: worst >= AA };
    };
    if (scheme) { if (!SCHEMES[scheme]) throw new Error('Unknown scheme ' + scheme); return one(scheme); }
    const d = one('dark'), l = one('light');
    const cost = (x) => (x.ok ? 0 : 100) + x.shade * 10 + x.plateAlpha;
    const light = summary.meanY != null ? summary.meanY > 0.35 : (luminance(extremes[0]) + luminance(extremes[1])) / 2 > 0.35;
    if (Math.abs(cost(d) - cost(l)) <= 0.04) return light ? l : d;
    return cost(d) < cost(l) ? d : l;
  }

  const rgbCss = (c, a) => 'rgb(' + c.map(v => Math.round(v)).join(' ') + (a == null ? '' : ' / ' + Number(a).toFixed(3)) + ')';

  // The CSS that gives the New Tab its plates. `sel` names the blocks of the page; the tokens are set on those
  // blocks only (they inherit into everything inside), so a menu or a pet drawn elsewhere keeps its own colours.
  const PLATED = ['.greeting-section', '.logo-section', '.handoff-section', '.shortcuts-section', '.brief-section', '.today-section', '.tools-section', '.weather-section', '.recent-section', '.gh-activity-section'];
  const FLOATS = ['.search-bar', '.theme-toggle-btn'];
  const MENUS = ['#start-suggestions', '.engine-menu'];
  function plateCss(p) {
    const fg = p.inks[0], A = 'html[data-wallpaper][data-wallpaper][data-wallpaper] ';
    const on = (list) => list.map(s => A + s).join(',\n');
    const tokens = [
      '--vex-text-primary: ' + rgbCss(p.inks[0]), '--vex-text-secondary: ' + rgbCss(p.inks[1]), '--vex-text-muted: ' + rgbCss(p.inks[2]),
      '--vex-accent: ' + rgbCss(p.accent), '--vex-border-accent: ' + rgbCss(p.accent, 0.55), '--vex-border-accent-strong: ' + rgbCss(p.accent),
      '--vex-accent-dim: ' + rgbCss(p.accent, 0.22), '--vex-accent-glow: ' + rgbCss(p.accent, 0.16),
      '--on-primary: ' + rgbCss(p.scheme === 'dark' ? SCHEMES.dark.plate : [255, 255, 255]),
      '--vex-glass-strong: ' + rgbCss(fg, TILE), '--vex-glass-medium: ' + rgbCss(fg, TILE * 0.75), '--vex-glass-light: ' + rgbCss(fg, TILE * 0.5), '--vex-glass-input: ' + rgbCss(fg, TILE),
      '--vex-border-subtle: ' + rgbCss(fg, 0.14), '--vex-border-medium: ' + rgbCss(fg, 0.2), '--vex-border-strong: ' + rgbCss(fg, 0.3),
      '--vex-blur-medium: none', '--vex-blur-light: none', 'color-scheme: ' + p.scheme,
    ].join(';\n  ') + ';';
    const glass = 'backdrop-filter: blur(' + BLUR + 'px) saturate(125%); -webkit-backdrop-filter: blur(' + BLUR + 'px) saturate(125%);';
    const edge = 'border: 1px solid ' + rgbCss(fg, 0.16) + '; box-shadow: 0 8px 28px rgb(0 0 0 / ' + (p.scheme === 'dark' ? '0.28' : '0.10') + ');';
    return [
      on(PLATED.concat(FLOATS, MENUS)) + ' {\n  ' + tokens + '\n}',
      on(PLATED) + ' {\n  background: ' + rgbCss(p.plate, p.plateAlpha) + '; ' + glass + ' ' + edge + ' border-radius: 16px; padding: 18px 22px;\n}',
      on(['.logo-section']) + ' { padding: 6px 22px; margin-bottom: 20px; }',
      on(FLOATS) + ' {\n  background: ' + rgbCss(p.plate, p.plateAlpha) + '; ' + glass + ' ' + edge + '\n}',
      on(MENUS) + ' {\n  background: ' + rgbCss(p.plate, Math.max(0.96, p.plateAlpha)) + '; ' + edge + '\n}',
      on(['.vex-wordmark']) + ' { background: none; -webkit-text-fill-color: ' + rgbCss(p.accent) + '; opacity: 1; }',
      on(['.shortcut-card']) + ' { box-shadow: none; }',
    ].join('\n');
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
    return { scrim, inks, accent: inks[3] };
  }

  // The page's own accent, read with our plate colours taken off for a moment (they replace --vex-accent on the plates).
  function pageAccent() {
    const st = root.document.getElementById(PLATE_STYLE_ID);
    const css = st ? st.textContent : '';
    if (st) st.textContent = '';
    try { return pageColours().accent; } finally { if (st) st.textContent = css; }
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
    last = { id: spec.id || '', src: spec.src, lightest: spec.lightest, darkest: spec.darkest, plateLightest: spec.plateLightest, plateDarkest: spec.plateDarkest, mean: spec.mean, meanY: spec.meanY, dim, blur, auto };
    html.setAttribute('data-wallpaper', String(spec.id || 'custom'));
    pic.style.backgroundImage = 'url("' + spec.src + '")';
    pic.style.filter = blur ? 'blur(' + blur + 'px)' : '';
    pic.style.inset = blur ? '-' + (blur * 2) + 'px' : '0';
    return measure(scrim);
  }

  // Works out the plates and the shade for the colours the page wears now and lays them.
  function measure(scrimEl) {
    if (!last) return null;
    const scrim = scrimEl || root.document.getElementById('vex-wallpaper-scrim');
    if (!scrim) return null;
    const p = plan({ summary: last, accent: pageAccent(), dim: last.dim, auto: last.auto });
    let st = root.document.getElementById(PLATE_STYLE_ID);
    if (!st) { st = root.document.createElement('style'); st.id = PLATE_STYLE_ID; root.document.body.appendChild(st); }
    st.textContent = plateCss(p);
    root.document.documentElement.setAttribute('data-wp-scheme', p.scheme);
    // The shade is laid in the plate's colour, so the plate on top of it is what the contrast above was worked out for.
    scrim.style.backgroundColor = rgbCss(p.plate, p.shade);
    return { alpha: p.shade, required: p.required, worst: p.worst, ok: p.ok, readable: p.ok, scheme: p.scheme, plate: p.plateAlpha };
  }

  // The colours of the page change (theme, look, light and dark): the plates follow.
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
    doc.getElementById(PLATE_STYLE_ID)?.remove();
    doc.documentElement.removeAttribute('data-wallpaper');
    doc.documentElement.removeAttribute('data-wp-scheme');
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(timer);
  }

  const api = {
    AIM, AA, PLATE_MIN, PLATE_MAX, SHADE_MAX, SCHEMES, contrast, luminance, mixRgb, hexRgb, neededScrim, worstContrast, judge,
    summarisePixels, solvePlate, plan, plateCss, rgbCss,
    paint(spec) { const out = paint(spec); watch(); return out; },
    measure: () => measure(), pageColours, pageAccent, clear, current: () => (last ? { ...last } : null),
  };
  if (typeof window !== 'undefined') window.WallpaperPaint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { WallpaperPaint: api };
})(typeof window !== 'undefined' ? window : globalThis);
