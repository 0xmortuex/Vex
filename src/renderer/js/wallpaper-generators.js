// === Wallpapers drawn by code (Wallpaper Store) ================================
//
// Every generated wallpaper is a small SVG (2 to 25 KB) made from its id, a kind
// and five colours. Nothing is downloaded and nothing is stored: the same id
// always gives the same picture, byte for byte (a seeded random generator, no
// Math.random, no clock). The browser draws the SVG at the size of the screen,
// so no big bitmap is ever kept.
//
//   WallpaperGenerators.svg({ id, kind, seed, colors: [c0..c4], opts })  -> '<svg ...>'
//   kinds: mesh linear radial horizon waves mountains lowpoly tiles dots grid
//          rings topo stars grain solid bokeh
//
// colors[0] is the base, colors[1] its second tone, colors[2..4] are accents.

(function (root) {
  'use strict';

  const W = 1600, H = 900;
  const KINDS = ['mesh', 'linear', 'radial', 'horizon', 'waves', 'mountains', 'lowpoly', 'tiles', 'dots', 'grid', 'rings', 'topo', 'stars', 'grain', 'solid', 'bokeh'];

  // One decimal, always: the picture does not depend on how a number prints.
  const f = (x) => String(Math.round(x * 10) / 10);

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const HEX = /^#[0-9a-f]{6}$/i;
  function rgb(hex) {
    if (!HEX.test(hex)) throw new Error('A wallpaper colour must be #rrggbb, got ' + hex);
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function toHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  // t = 0 gives a, t = 1 gives b.
  function mix(a, b, t) { const x = rgb(a), y = rgb(b); return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); }
  // WCAG relative luminance.
  function luminance(hex) {
    return rgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  }
  // A position 0..1 along the palette's five colours.
  function along(c, t) {
    const x = Math.max(0, Math.min(0.9999, t)) * (c.length - 1), i = Math.floor(x);
    return mix(c[i], c[i + 1], x - i);
  }

  const stop = (o, col, op) => '<stop offset="' + o + '" stop-color="' + col + '"' + (op == null ? '' : ' stop-opacity="' + op + '"') + '/>';
  const glow = (id, col, a0, a1) => '<radialGradient id="' + id + '" cx="0.5" cy="0.5" r="0.5">' + stop(0, col, a0) + stop(1, col, a1) + '</radialGradient>';
  const lin = (id, stops, extra) => '<linearGradient id="' + id + '" ' + (extra || 'x1="0" y1="0" x2="0" y2="1"') + '>' + stops.map((s, i) => stop(f(i / (stops.length - 1)), s)).join('') + '</linearGradient>';
  const rect = (fill, extra) => '<rect width="' + W + '" height="' + H + '" fill="' + fill + '"' + (extra || '') + '/>';
  const vignette = (strength) => '<defs><radialGradient id="vg" cx="0.5" cy="0.5" r="0.75">' + stop(0.55, '#000000', 0) + stop(1, '#000000', strength) + '</radialGradient></defs>' + rect('url(#vg)');

  const GEN = {
    // Soft blobs of colour over a two-tone base (Aurora, Soft light). opts.ribbon: long tilted bands.
    mesh(r, c, o) {
      let defs = lin('b', [c[0], c[1]], 'x1="0" y1="0" x2="1" y2="1"'), body = rect('url(#b)');
      const n = 6 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const col = c[2 + (i % 3)];
        defs += glow('g' + i, col, o.ribbon ? 0.8 : 0.85, 0);
        const cx = r() * W, cy = o.ribbon ? H * (0.25 + r() * 0.55) : r() * H;
        const rx = o.ribbon ? 600 + r() * 500 : 330 + r() * 420, ry = o.ribbon ? 90 + r() * 120 : rx * (0.7 + r() * 0.5);
        const rot = o.ribbon ? -30 + r() * 60 : r() * 180;
        body += '<ellipse cx="' + f(cx) + '" cy="' + f(cy) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" transform="rotate(' + f(rot) + ' ' + f(cx) + ' ' + f(cy) + ')" fill="url(#g' + i + ')"/>';
      }
      return '<defs>' + defs + '</defs>' + body;
    },

    // A smooth multi-stop gradient at a seeded angle, with one glow.
    linear(r, c) {
      const ang = Math.floor(r() * 8) * 22.5 + 20;
      return '<defs>' + lin('a', [c[0], c[1], mix(c[1], c[2], 0.55), mix(c[2], c[3], 0.5)], 'x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(' + f(ang) + ' 0.5 0.5)"')
        + glow('s', c[4], 0.35, 0) + '</defs>' + rect('url(#a)')
        + '<ellipse cx="' + f(W * (0.2 + r() * 0.6)) + '" cy="' + f(H * (0.2 + r() * 0.6)) + '" rx="700" ry="520" fill="url(#s)"/>';
    },

    // A dark base with one big glow and a smaller second one, and a soft vignette.
    radial(r, c) {
      const x = W * (0.25 + r() * 0.5), y = H * (0.25 + r() * 0.5);
      return '<defs>' + lin('b', [c[0], c[1]], 'x1="0" y1="0" x2="1" y2="1"') + glow('g1', c[2], 0.85, 0) + glow('g2', c[3], 0.6, 0) + '</defs>'
        + rect('url(#b)')
        + '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="760" fill="url(#g1)"/>'
        + '<circle cx="' + f(W - x * 0.8) + '" cy="' + f(H - y * 0.7) + '" r="420" fill="url(#g2)"/>' + vignette(0.35);
    },

    // Sky, a low sun and dark ground.
    horizon(r, c) {
      const hy = H * (0.66 + r() * 0.08), sx = W * (0.25 + r() * 0.5), sr = 60 + r() * 50;
      return '<defs>' + lin('sky', [c[0], c[1], c[2], c[3], c[4]]) + glow('sg', c[3], 0.9, 0) + glow('ss', c[4], 1, 1)
        + lin('gd', [mix(c[0], '#000000', 0.45), mix(c[0], '#000000', 0.15)]) + '</defs>'
        + '<rect width="' + W + '" height="' + f(hy) + '" fill="url(#sky)"/>'
        + '<circle cx="' + f(sx) + '" cy="' + f(hy - sr * 0.3) + '" r="' + f(sr * 7) + '" fill="url(#sg)"/>'
        + '<circle cx="' + f(sx) + '" cy="' + f(hy - sr * 0.3) + '" r="' + f(sr) + '" fill="' + c[4] + '"/>'
        + '<rect y="' + f(hy) + '" width="' + W + '" height="' + f(H - hy) + '" fill="url(#gd)"/>'
        + '<rect y="' + f(hy - 1) + '" width="' + W + '" height="3" fill="' + c[4] + '" opacity="0.35"/>';
    },

    // Layers of sine waves from the back (high, faint) to the front.
    waves(r, c) {
      let s = '<defs>' + lin('b', [c[0], c[1]]) + '</defs>' + rect('url(#b)');
      const L = 5;
      for (let i = 0; i < L; i++) {
        const base = H * (0.38 + i * 0.11);
        const parts = [[18 + r() * 24, 0.004 + r() * 0.004, r() * 6.28], [8 + r() * 14, 0.011 + r() * 0.008, r() * 6.28]];
        let d = 'M0,' + H;
        for (let x = 0; x <= W; x += 20) {
          const y = base + parts.reduce((a, p) => a + p[0] * Math.sin(x * p[1] + p[2]), 0);
          d += ' L' + x + ',' + f(y);
        }
        d += ' L' + W + ',' + H + ' Z';
        s += '<path d="' + d + '" fill="' + c[2 + (i % 3)] + '" opacity="' + f(0.22 + i * 0.12) + '"/>';
      }
      return s;
    },

    // Sky, a sun or moon, and five ridgelines fading from hazy to dark.
    mountains(r, c) {
      let s = '<defs>' + lin('sky', [c[0], c[1], c[3]]) + glow('sg', c[4], 0.7, 0) + '</defs>' + rect('url(#sky)');
      const sx = W * (0.2 + r() * 0.6), sy = H * (0.2 + r() * 0.15);
      s += '<circle cx="' + f(sx) + '" cy="' + f(sy) + '" r="380" fill="url(#sg)"/><circle cx="' + f(sx) + '" cy="' + f(sy) + '" r="' + f(36 + r() * 24) + '" fill="' + c[4] + '" opacity="0.95"/>';
      const L = 5;
      for (let i = 0; i < L; i++) {
        const base = H * (0.52 + i * 0.09);
        const parts = [0, 1, 2, 3].map(k => [(70 - i * 8) / (k + 1) * (0.6 + r() * 0.8), (0.002 + r() * 0.003) * (k + 1), r() * 6.28]);
        let d = 'M0,' + H;
        for (let x = 0; x <= W; x += 16) {
          const y = base - parts.reduce((a, p) => a + Math.abs(p[0] * Math.sin(x * p[1] + p[2])), 0);
          d += ' L' + x + ',' + f(y);
        }
        d += ' L' + W + ',' + H + ' Z';
        s += '<path d="' + d + '" fill="' + mix(c[3], mix(c[0], '#000000', 0.5), (i + 1) / (L + 0.6)) + '"/>';
      }
      return s;
    },

    // Low-poly: a jittered grid of triangles coloured along the palette.
    lowpoly(r, c) {
      const cols = 14, rows = 8, cw = W / cols, rh = H / rows, pts = [];
      for (let j = 0; j <= rows; j++) {
        pts.push([]);
        for (let i = 0; i <= cols; i++) {
          const edge = i === 0 || j === 0 || i === cols || j === rows;
          pts[j].push([i * cw + (edge && (i === 0 || i === cols) ? 0 : (r() - 0.5) * cw * 0.7), j * rh + (edge && (j === 0 || j === rows) ? 0 : (r() - 0.5) * rh * 0.7)]);
        }
      }
      let s = rect(c[0]);
      const tri = (a, b, d) => {
        const t = ((a[0] + b[0] + d[0]) / 3 / W) * 0.65 + ((a[1] + b[1] + d[1]) / 3 / H) * 0.35 + (r() - 0.5) * 0.14;
        const col = mix(along(c, t), c[0], 0.25);
        return '<polygon points="' + [a, b, d].map(p => f(p[0]) + ',' + f(p[1])).join(' ') + '" fill="' + col + '" stroke="' + col + '" stroke-width="1"/>';
      };
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = pts[j][i], b = pts[j][i + 1], d = pts[j + 1][i], e = pts[j + 1][i + 1];
        if (r() < 0.5) { s += tri(a, b, d) + tri(b, e, d); } else { s += tri(a, b, e) + tri(a, e, d); }
      }
      return s;
    },

    // Rounded square tiles of different strengths on a dark base.
    tiles(r, c) {
      let s = '<defs>' + lin('b', [c[0], c[1]], 'x1="0" y1="0" x2="1" y2="1"') + '</defs>' + rect('url(#b)');
      const t = 100, g = 8;
      for (let j = 0; j < 9; j++) for (let i = 0; i < 16; i++) {
        const o = r();
        if (o < 0.28) continue;
        s += '<rect x="' + (i * t + g / 2) + '" y="' + (j * t + g / 2) + '" width="' + (t - g) + '" height="' + (t - g) + '" rx="12" fill="' + c[2 + Math.floor(r() * 3)] + '" opacity="' + f(0.04 + o * 0.22) + '"/>';
      }
      return s;
    },

    // A dot matrix that fades towards the edges.
    dots(r, c) {
      const x = f(0.3 + r() * 0.4), y = f(0.3 + r() * 0.4);
      return '<defs>' + lin('b', [c[0], c[1]], 'x1="0" y1="0" x2="1" y2="1"') + glow('g', c[2], 0.5, 0)
        + '<pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="16" cy="16" r="2.4" fill="' + c[3] + '"/></pattern>'
        + '<radialGradient id="mk" cx="' + x + '" cy="' + y + '" r="0.7">' + stop(0, '#ffffff', 1) + stop(1, '#ffffff', 0) + '</radialGradient>'
        + '<mask id="m"><rect width="' + W + '" height="' + H + '" fill="url(#mk)"/></mask></defs>'
        + rect('url(#b)') + '<ellipse cx="' + f(W * x) + '" cy="' + f(H * y) + '" rx="800" ry="500" fill="url(#g)"/>'
        + '<rect width="' + W + '" height="' + H + '" fill="url(#p)" mask="url(#m)" opacity="0.75"/>';
    },

    // A blueprint grid: fine lines every 20, stronger every 100.
    grid(r, c) {
      return '<defs>' + lin('b', [c[0], c[1]], 'x1="0" y1="0" x2="1" y2="1"') + glow('g', c[2], 0.45, 0)
        + '<pattern id="fine" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20,0 L0,0 0,20" fill="none" stroke="' + c[3] + '" stroke-opacity="0.13" stroke-width="1"/></pattern>'
        + '<pattern id="big" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100,0 L0,0 0,100" fill="none" stroke="' + c[4] + '" stroke-opacity="0.26" stroke-width="1.4"/></pattern></defs>'
        + rect('url(#b)') + '<ellipse cx="' + f(W * (0.3 + r() * 0.4)) + '" cy="' + f(H * 0.45) + '" rx="800" ry="460" fill="url(#g)"/>'
        + rect('url(#fine)') + rect('url(#big)');
    },

    // Concentric circles, like a sonar screen.
    rings(r, c) {
      const x = W * (0.3 + r() * 0.4), y = H * (0.35 + r() * 0.3);
      let s = '<defs><radialGradient id="b" cx="' + f(x / W) + '" cy="' + f(y / H) + '" r="0.8">' + stop(0, c[1]) + stop(1, c[0]) + '</radialGradient></defs>' + rect('url(#b)');
      for (let i = 1; i <= 20; i++) s += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + (i * 46) + '" fill="none" stroke="' + c[2 + (i % 3)] + '" stroke-opacity="' + f(Math.max(0.05, 0.5 - i * 0.022)) + '" stroke-width="' + (i % 5 === 0 ? 2.4 : 1.2) + '"/>';
      return s;
    },

    // Contour lines of two hills (rings with a wobbling radius).
    topo(r, c) {
      let s = '<defs>' + lin('b', [c[0], c[1]], 'x1="0" y1="0" x2="1" y2="1"') + '</defs>' + rect('url(#b)');
      const hills = [[W * (0.25 + r() * 0.2), H * (0.3 + r() * 0.3)], [W * (0.65 + r() * 0.2), H * (0.45 + r() * 0.3)]];
      hills.forEach((h, k) => {
        const p = [r() * 6.28, r() * 6.28, r() * 6.28];
        for (let i = 1; i <= 15; i++) {
          let d = '';
          for (let a = 0; a <= 72; a++) {
            const th = (a / 72) * 6.2832;
            const rad = i * (24 + k * 5) * (1 + 0.14 * Math.sin(3 * th + p[0] + i * 0.12) + 0.08 * Math.sin(5 * th + p[1]) + 0.05 * Math.sin(7 * th + p[2] - i * 0.1));
            d += (a ? ' L' : 'M') + f(h[0] + rad * 1.35 * Math.cos(th)) + ',' + f(h[1] + rad * Math.sin(th));
          }
          s += '<path d="' + d + ' Z" fill="none" stroke="' + c[2 + ((i + k) % 3)] + '" stroke-opacity="' + (i % 5 === 0 ? '0.6' : '0.28') + '" stroke-width="' + (i % 5 === 0 ? 1.8 : 1.1) + '"/>';
        }
      });
      return s;
    },

    // A night sky: nebula clouds and 260 stars.
    stars(r, c) {
      let s = '<defs><radialGradient id="b" cx="0.5" cy="0.4" r="0.9">' + stop(0, c[1]) + stop(1, c[0]) + '</radialGradient>' + glow('n0', c[2], 0.5, 0) + glow('n1', c[3], 0.4, 0) + '</defs>' + rect('url(#b)');
      for (let i = 0; i < 3; i++) s += '<ellipse cx="' + f(r() * W) + '" cy="' + f(r() * H) + '" rx="' + f(420 + r() * 300) + '" ry="' + f(200 + r() * 200) + '" fill="url(#n' + (i % 2) + ')" transform="rotate(' + f(r() * 180) + ' ' + f(W / 2) + ' ' + f(H / 2) + ')"/>';
      for (let i = 0; i < 260; i++) {
        const big = r() < 0.06;
        s += '<circle cx="' + f(r() * W) + '" cy="' + f(r() * H) + '" r="' + f(big ? 1.8 + r() : 0.5 + r() * 0.9) + '" fill="' + (r() < 0.2 ? c[4] : '#ffffff') + '" opacity="' + f(0.35 + r() * 0.65) + '"/>';
      }
      return s;
    },

    // A gradient with film grain (feTurbulence) laid over it.
    grain(r, c) {
      return '<defs>' + lin('b', [c[0], c[1], mix(c[1], c[2], 0.5)], 'x1="0" y1="0" x2="1" y2="1"') + glow('g', c[3], 0.35, 0)
        + '<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="' + (1 + Math.floor(r() * 90)) + '" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></defs>'
        + rect('url(#b)') + '<ellipse cx="' + f(W * (0.25 + r() * 0.5)) + '" cy="' + f(H * (0.2 + r() * 0.5)) + '" rx="760" ry="480" fill="url(#g)"/>'
        + rect('#808080', ' filter="url(#n)" opacity="0.28" style="mix-blend-mode:overlay"');
    },

    // One calm colour with a soft vignette and a faint accent disc.
    solid(r, c) {
      return '<defs>' + glow('g', c[2], 0.16, 0) + '<radialGradient id="b" cx="' + f(0.3 + r() * 0.4) + '" cy="0.35" r="0.9">' + stop(0, c[1]) + stop(1, c[0]) + '</radialGradient></defs>'
        + rect('url(#b)') + '<circle cx="' + f(W * (0.7 + r() * 0.2)) + '" cy="' + f(H * (0.65 + r() * 0.2)) + '" r="520" fill="url(#g)"/>';
    },

    // Out-of-focus discs on a light ground.
    bokeh(r, c) {
      let s = '<defs>' + lin('b', [c[0], c[1]], 'x1="0" y1="0" x2="1" y2="1"') + '<filter id="bl" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="10"/></filter></defs>' + rect('url(#b)') + '<g filter="url(#bl)">';
      for (let i = 0; i < 24; i++) s += '<circle cx="' + f(r() * W) + '" cy="' + f(r() * H) + '" r="' + f(40 + r() * 130) + '" fill="' + c[2 + (i % 3)] + '" opacity="' + f(0.22 + r() * 0.3) + '"/>';
      return s + '</g>';
    },
  };

  function svg(def) {
    if (!def || typeof def !== 'object') throw new Error('A wallpaper needs a definition');
    if (typeof def.id !== 'string' || !def.id) throw new Error('A wallpaper needs an id');
    if (!GEN[def.kind]) throw new Error('Unknown wallpaper kind: ' + def.kind);
    const c = def.colors;
    if (!Array.isArray(c) || c.length !== 5) throw new Error('A wallpaper needs five colours');
    c.forEach(rgb);
    const r = rng(hash(def.id) ^ (((def.seed | 0) * 2654435761) >>> 0));
    const body = GEN[def.kind](r, c, def.opts || {});
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice">' + body + '</svg>';
  }

  // An SVG string -> a data: URL the page can use as a CSS or <img> source.
  function dataUrl(markup) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  const api = { svg, dataUrl, KINDS, WIDTH: W, HEIGHT: H, hash, rng, mix, luminance, along };
  if (typeof window !== 'undefined') window.WallpaperGenerators = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { WallpaperGenerators: api };
})(typeof window !== 'undefined' ? window : globalThis);
