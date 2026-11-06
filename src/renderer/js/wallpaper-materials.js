// === Wallpapers that look like real materials (Wallpaper Store) ================
//
// Marble, wood, fabric, paper, stone and metal, drawn by code. Every one is still a
// small SVG made from an id, a kind, a seed and five colours (see wallpaper-generators.js):
// no photograph, no download, the same id always gives the same picture. The look comes
// from the SVG filter primitives the browser already has: feTurbulence (noise), a colour
// table that turns the noise into the palette, and feDiffuseLighting, which lights the
// noise as if it were a bump map. The browser draws it at the size of the screen, so the
// result is as sharp at 3840 x 2160 as at 1920 x 1080.
//
// The five colours are used as a ramp from dark to light (they are sorted by brightness),
// so any palette, also the ones a theme brings, gives a sensible material.
//
// This file loads after wallpaper-generators.js (late, see lazy-boot.js) and adds its kinds
// with WallpaperGenerators.extend. It also puts the small drawing toolkit the other kind
// files use on WallpaperGenerators.kit.

(function (root) {
  'use strict';

  // Files that load late (js/lazy-boot.js) can arrive in any order: this one waits for the generators if they are not here yet.
  function build(G) {
    const { f, mix, along, luminance, rgb, WIDTH: W, HEIGHT: H } = G;

    // --- the toolkit ------------------------------------------------------------------------

    const q = (v) => String(Math.round(v * 10000) / 10000);
    const tones = (c) => c.slice().sort((a, b) => luminance(a) - luminance(b));
    const unit = (hex) => rgb(hex).map(v => v / 255);

    // Colours -> the three tables of a feComponentTransfer ('table' is smooth, 'discrete' is stepped).
    function table(stops, type) {
      const ch = [0, 1, 2].map(k => stops.map(h => q(unit(h)[k])).join(' '));
      return ['R', 'G', 'B'].map((n, k) => '<feFunc' + n + ' type="' + (type || 'table') + '" tableValues="' + ch[k] + '"/>').join('');
    }
    const turb = (res, type, fx, fy, oct, seed) => '<feTurbulence type="' + type + '" baseFrequency="' + q(fx) + ' ' + q(fy) + '" numOctaves="' + oct + '" seed="' + seed + '" result="' + res + '"/>';
    // Noise -> one grey channel, stretched: grey = gain * R + bias.
    const gray = (inn, res, gain, bias) => { const row = q(gain) + ' 0 0 0 ' + q(bias) + ' '; return '<feColorMatrix in="' + inn + '" type="matrix" values="' + row + row + row + '0 0 0 0 1" result="' + res + '"/>'; };
    const tint = (inn, res, stops, type) => '<feComponentTransfer in="' + inn + '" result="' + res + '">' + table(stops, type) + '</feComponentTransfer>';
    // The same curve on all three colour channels (a grey -> grey shaping curve).
    const curve = (inn, res, vals) => { const t = ' type="table" tableValues="' + vals.map(q).join(' ') + '"/>'; return '<feComponentTransfer in="' + inn + '" result="' + res + '"><feFuncR' + t + '<feFuncG' + t + '<feFuncB' + t + '</feComponentTransfer>'; };
    // The grey of `inn` becomes the opacity (the height map the lighting filters read).
    const toAlpha = (inn, res) => '<feColorMatrix in="' + inn + '" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0" result="' + res + '"/>';
    const diffuse = (inn, res, scale, az, el, col) => '<feDiffuseLighting in="' + inn + '" surfaceScale="' + q(scale) + '" diffuseConstant="1" lighting-color="' + (col || '#ffffff') + '" result="' + res + '"><feDistantLight azimuth="' + az + '" elevation="' + el + '"/></feDiffuseLighting>';
    const specular = (inn, res, scale, expo, k, az, el, col) => '<feSpecularLighting in="' + inn + '" surfaceScale="' + q(scale) + '" specularConstant="' + q(k) + '" specularExponent="' + expo + '" lighting-color="' + (col || '#ffffff') + '" result="' + res + '"><feDistantLight azimuth="' + az + '" elevation="' + el + '"/></feSpecularLighting>';
    const arith = (a, b, res, k1, k2, k3, k4) => '<feComposite in="' + a + '" in2="' + b + '" operator="arithmetic" k1="' + q(k1) + '" k2="' + q(k2) + '" k3="' + q(k3) + '" k4="' + q(k4) + '" result="' + res + '"/>';
    const merge = (res, names) => '<feMerge result="' + res + '">' + names.map(n => '<feMergeNode in="' + n + '"/>').join('') + '</feMerge>';
    // Noise -> a layer of one colour whose opacity follows the noise: alpha = gain * R + bias.
    const veilOf = (inn, res, col, gain, bias) => { const u = unit(col); return '<feColorMatrix in="' + inn + '" type="matrix" values="0 0 0 0 ' + q(u[0]) + ' 0 0 0 0 ' + q(u[1]) + ' 0 0 0 0 ' + q(u[2]) + ' ' + q(gain) + ' 0 0 0 ' + q(bias) + '" result="' + res + '"/>'; };
    const alphaTo = (inn, res, vals) => '<feComponentTransfer in="' + inn + '" result="' + res + '"><feFuncA type="table" tableValues="' + vals.map(q).join(' ') + '"/></feComponentTransfer>';
    const alphaBy = (inn, res, k) => '<feComponentTransfer in="' + inn + '" result="' + res + '"><feFuncA type="linear" slope="' + q(k) + '"/></feComponentTransfer>';
    // Colour x lighting: a flat surface gets 1 / sin(elevation) back, so a flat colour stays itself.
    function lit(colour, height, res, scale, az, el, extra) {
      return toAlpha(height, 'h_' + res) + diffuse('h_' + res, 'L_' + res, scale, az, el) + arith(colour, 'L_' + res, res, 1 / Math.sin(el * Math.PI / 180) * (extra || 1), 0, 0, 0);
    }
    // A wave with n periods as a table: 0 -> 1 -> 0 ... (smooth), or a saw (0 -> 1, jump).
    function wave(n, steps) { const s = steps || 10, v = []; for (let i = 0; i <= n * s; i++) v.push(0.5 - 0.5 * Math.cos(2 * Math.PI * i / s)); return v; }
    // n lines per range: 1 at the start of each period, 0 after `w` of the period.
    function lines(n, w, steps) { const s = steps || 12, v = []; for (let i = 0; i <= n * s; i++) { const p = (i % s) / s; v.push(p < w ? 1 - p / w : 0); } return v; }

    // Noise -> a gentle grey around `centre`: the way a texture dims or lifts a colour without changing it.
    const soft = (inn, res, amt, centre) => gray(inn, res, amt, (centre == null ? 0.88 : centre) - 0.5 * amt);
    const fil = (id, inner, m) => '<filter id="' + id + '" x="' + -(m || 0) + '" y="' + -(m || 0) + '" width="' + (W + 2 * (m || 0)) + '" height="' + (H + 2 * (m || 0)) + '" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' + inner + '</filter>';
    const sheet = (id, m, extra) => '<rect x="' + -(m || 0) + '" y="' + -(m || 0) + '" width="' + (W + 2 * (m || 0)) + '" height="' + (H + 2 * (m || 0)) + '" fill="#808080" filter="url(#' + id + ')"' + (extra || '') + '/>';
    const stopOf = (s) => '<stop offset="' + q(s[0]) + '" stop-color="' + s[1] + '"' + (s[2] == null ? '' : ' stop-opacity="' + q(s[2]) + '"') + '/>';
    const lg = (id, x1, y1, x2, y2, stops) => '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' + stops.map(stopOf).join('') + '</linearGradient>';
    const rg = (id, cx, cy, rr, stops) => '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + rr + '">' + stops.map(stopOf).join('') + '</radialGradient>';
    const box = (fill, extra) => '<rect width="' + W + '" height="' + H + '" fill="' + fill + '"' + (extra || '') + '/>';
    const seedOf = (r) => 1 + Math.floor(r() * 997);
    // A glossy sheen across the whole picture.
    const sheen = (id, a) => '<defs>' + lg(id, 0, 0, 1, 1, [[0, '#ffffff', 0], [0.38, '#ffffff', 0], [0.5, '#ffffff', a], [0.62, '#ffffff', 0], [1, '#ffffff', 0]]) + '</defs>' + box('url(#' + id + ')');
    const vig = (id, a) => '<defs>' + rg(id, 0.5, 0.5, 0.78, [[0.5, '#000000', 0], [1, '#000000', a]]) + '</defs>' + box('url(#' + id + ')');

    // The toolkit for the kind files that follow (patterns, botanical, sky).
    const kit = { q, tones, unit, table, turb, gray, tint, curve, toAlpha, diffuse, specular, arith, merge, veilOf, alphaTo, alphaBy, lit, wave, lines, fil, sheet, stopOf, lg, rg, box, seedOf, sheen, vig };
    G.kit = kit;

    // --- marble and banded stone ---------------------------------------------------------------

    const GEN = {
      // White, black, green or pink marble with veins. o.dark: dark stone (light veins); o.s: scale of the veins;
      // o.warp: how far the veins wander; o.w: vein width (default 0); o.fine: finer second veins (1 = as strong as the main ones).
      marble(r, c, o) {
        const t = tones(c), dark = !!o.dark, s = o.s || 1, warp = o.warp || 220, wd = o.w || 0, fine = o.fine == null ? 1 : o.fine;
        const ground = dark ? [t[0], mix(t[0], t[1], 0.55), t[1], mix(t[1], t[2], 0.35)] : [t[4], t[4], mix(t[4], t[3], 0.7), t[3]];
        const vein = dark ? t[4] : t[0], vein2 = dark ? t[3] : t[1];
        const m = Math.ceil(warp / 2) + 10;
        const sharp = [0, 0, 0, 0, 0.02, 0.1 + wd * 0.25, 0.5 + wd * 0.3, 0.95, 1];
        const inner = turb('cl', 'fractalNoise', 0.0028 * s, 0.0036 * s, 4, seedOf(r)) + gray('cl', 'g1', 2.3, -0.65) + tint('g1', 'ground', ground)
          + turb('wn', 'fractalNoise', 0.0022, 0.0022, 2, seedOf(r))
          + turb('t1', 'turbulence', 0.0032 * s * (o.sx || 1), 0.0042 * s, 2, seedOf(r))
          + '<feDisplacementMap in="t1" in2="wn" scale="' + warp + '" xChannelSelector="R" yChannelSelector="G" result="d1"/>'
          + veilOf('d1', 'v1', vein, -3.4, 1) + alphaTo('v1', 'va', sharp)
          + '<feGaussianBlur in="va" stdDeviation="5" result="vb"/>' + alphaBy('vb', 'halo', 0.42)
          + turb('t2', 'turbulence', 0.0085 * s, 0.011 * s, 2, seedOf(r))
          + '<feDisplacementMap in="t2" in2="wn" scale="' + Math.round(warp * 0.7) + '" xChannelSelector="G" yChannelSelector="R" result="d2"/>'
          + veilOf('d2', 'v2', vein2, -4.6, 1) + alphaTo('v2', 'vc', [0, 0, 0, 0, 0.04, 0.24, 0.62, 0.95, 1]) + alphaBy('vc', 'vd', 0.62 * fine)
          + merge('out', ['ground', 'halo', 'va', 'vd']);
        return '<defs>' + fil('m', inner, m) + '</defs>' + box(ground[0]) + sheet('m', m) + sheen('sh', 0.2) + vig('vg', 0.16);
      },

      // Smooth bands of colour (onyx, agate), or stepped height colours (a relief map).
      // o.mode: 'onyx' | 'relief'; o.n: how many bands (onyx); o.s: scale of the shapes.
      bands(r, c, o) {
        const t = tones(c), s = o.s || 1, n = o.n || 9, mode = o.mode || 'onyx';
        if (mode === 'onyx') {
          const inner = turb('a', 'fractalNoise', 0.0016 * s, 0.0021 * s, 3, seedOf(r)) + gray('a', 'g', 1.9, -0.45)
            + curve('g', 'z', wave(n, 12)) + tint('z', 'col', [mix(t[0], t[1], 0.5), t[1], t[2], t[3], mix(t[3], t[4], 0.5)])
            + turb('b', 'fractalNoise', 0.2, 0.2, 2, seedOf(r)) + gray('b', 'gb', 1, 0)
            + lit('col', 'gb', 'out', 0.8, 235, 58);
          return '<defs>' + fil('o', inner) + '</defs>' + sheet('o') + sheen('sh', 0.24) + vig('vg', 0.28);
        }
        if (mode !== 'relief') throw new Error('Unknown bands mode: ' + mode);
        // Stepped height colours, like the tints of a relief map; the edges of the steps are lit a little.
        const inner = turb('a', 'fractalNoise', 0.0016 * s, 0.002 * s, 3, seedOf(r)) + gray('a', 'g', 2.2, -0.55) + tint('g', 'steps', [mix(t[0], t[1], 0.4), t[1], t[2], t[3], mix(t[3], t[4], 0.5)], 'discrete')
          + turb('p', 'fractalNoise', 0.004, 0.004, 3, seedOf(r)) + gray('p', 'pg', 0.5, 0.6) + arith('steps', 'pg', 'out', 1.1, 0, 0, 0);
        return '<defs>' + fil('o', inner) + '</defs>' + sheet('o') + vig('vg', 0.2);
      },
    };

    // --- wood -------------------------------------------------------------------------------------

    const filAt = (id, inner, x, y, w, h) => '<filter id="' + id + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' + inner + '</filter>';
    // A filter that works on the box of the element it is put on (the noise still reads user-space positions,
    // so two boards with the same filter at two places show two different bits of the grain).
    const filBox = (id, inner) => '<filter id="' + id + '" x="0" y="0" width="1" height="1" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' + inner + '</filter>';
    const rectD = (x, y, w, h) => 'M' + x + ' ' + y + 'h' + w + 'v' + h + 'h' + -w + 'z';

    // The grain of one board: long streaks, growth rings (a wave over slow noise) and fine pores, lit from the side.
    function woodInner(t, o, flat, sd) {
      const d = o.d || 0.06, k = o.k || 4, s = o.s || 1;
      const stops = [t[0], mix(t[0], t[1], 0.5), t[1], mix(t[1], t[2], 0.5), t[2], t[3], t[4]];
      const rings = flat
        ? turb('r1', 'fractalNoise', 0.0011 * s, 0.0046 * s, 3, sd[0]) + gray('r1', 'r2', 3.2, -1.1)
        : turb('r1', 'fractalNoise', 0.0013 * s, d * 0.2, 2, sd[0]) + gray('r1', 'r2', 2.6, -0.8);
      return rings + curve('r2', 'r3', wave(k, 8))
        + turb('s1', 'fractalNoise', 0.0035, d, 4, sd[1]) + gray('s1', 's2', 1.7, -0.36)
        + arith('r3', 's2', 'g0', 0, 0.55, 0.45, 0) + gray('g0', 'g1', 1.35, -0.14) + tint('g1', 'col', stops)
        + turb('p1', 'fractalNoise', 0.018, 0.55, 2, sd[2]) + gray('p1', 'pg', 1.1, -0.2)
        + lit('col', 'pg', 'out', 0.9, 200, 62);
    }
    const seeds3 = (r) => [seedOf(r), seedOf(r), seedOf(r)];
    const rotSq = ' transform="rotate(90 800 450)"';
    const SQ = { x: -150, y: -500, w: 1900, h: 1900 };

    GEN.wood = function (r, c, o) {
      const t = tones(c), mode = o.mode || 'long';
      if (mode === 'long' || mode === 'flat') {
        return '<defs>' + fil('w', woodInner(t, o, mode === 'flat', seeds3(r)), 0) + '</defs>' + sheet('w') + sheen('sh', 0.1) + vig('vg', 0.2);
      }
      if (mode === 'planks') {
        const ph = o.ph || 112, flat = !!o.flat;
        let defs = '', body = '', seam = '';
        for (let v = 0; v < 3; v++) defs += filBox('w' + v, woodInner(t, o, flat, seeds3(r)));
        for (let y = 0, j = 0; y < H; y += ph, j++) {
          let x = -r() * 460, last = -1;
          seam += 'M0 ' + y + 'h' + W;
          while (x < W) {
            const len = 380 + r() * 560, x0 = Math.max(0, x), x1 = Math.min(W, x + len);
            let v = Math.floor(r() * 3); if (v === last) v = (v + 1) % 3; last = v;
            body += '<rect x="' + f(x0) + '" y="' + y + '" width="' + f(x1 - x0) + '" height="' + Math.min(ph, H - y) + '" filter="url(#w' + v + ')"/>'
              + '<rect x="' + f(x0) + '" y="' + y + '" width="' + f(x1 - x0) + '" height="' + ph + '" fill="' + (r() < 0.5 ? '#000000' : '#ffffff') + '" fill-opacity="' + f(r() * 16) / 100 + '"/>';
            if (x > 0 && x < W) seam += 'M' + f(x) + ' ' + y + 'v' + ph;
            x += len;
          }
        }
        return '<defs>' + defs + '</defs>' + body
          + '<path d="' + seam + '" stroke="#000000" stroke-opacity="0.6" stroke-width="2.6" fill="none" transform="translate(0 1)"/><path d="' + seam + '" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1.2" fill="none" transform="translate(0 -1)"/>'
          + sheen('sh', 0.1) + vig('vg', 0.22);
      }
      if (mode === 'herring') {
        const w = o.w || 60, L = o.L || 4, cx = 800, cy = 450, Hs = [], Vs = [];
        for (let i = -48; i <= 48; i++) for (let j = -24; j <= 24; j++) {
          const hx = i + j * L, hy = i - j * L, vx = hx + L, vy = hy - (L - 1);
          const px = cx + hx * w, py = cy + hy * w;
          if (Math.hypot(px + L * w / 2 - cx, py - cy) < 1000) Hs.push([px, py, L * w, w]);
          const qx = cx + vx * w, qy = cy + vy * w;
          if (Math.hypot(qx - cx, qy + L * w / 2 - cy) < 1000) Vs.push([qx, qy, w, L * w]);
        }
        const bucket = (list) => { const b = ['', '', '']; list.forEach(p => { b[Math.floor(r() * 3)] += rectD(p[0], p[1], p[2], p[3]); }); return b; };
        const hb = bucket(Hs), vb = bucket(Vs), all = Hs.concat(Vs).map(p => rectD(p[0], p[1], p[2], p[3])).join('');
        const group = (cp, b, rot, fid) => '<g clip-path="url(#' + cp + ')"><rect x="' + SQ.x + '" y="' + SQ.y + '" width="' + SQ.w + '" height="' + SQ.h + '"' + (rot ? rotSq : '') + ' filter="url(#' + fid + ')"/>'
          + '<path d="' + b[0] + '" fill="#000000" fill-opacity="0.16"/><path d="' + b[1] + '" fill="#ffffff" fill-opacity="0.1"/><path d="' + b[2] + '" fill="#000000" fill-opacity="0.05"/></g>';
        return '<defs>' + filAt('wh', woodInner(t, o, false, seeds3(r)), SQ.x, SQ.y, SQ.w, SQ.h) + filAt('wv', woodInner(t, o, false, seeds3(r)), SQ.x, SQ.y, SQ.w, SQ.h)
          + '<clipPath id="ch"><path d="' + hb.join('') + '"/></clipPath><clipPath id="cv"><path d="' + vb.join('') + '"/></clipPath></defs>'
          + '<g transform="rotate(45 800 450)">' + group('ch', hb, false, 'wh') + group('cv', vb, true, 'wv')
          + '<path d="' + all + '" fill="none" stroke="#000000" stroke-opacity="0.55" stroke-width="2.2"/></g>' + sheen('sh', 0.12) + vig('vg', 0.25);
      }
      if (mode === 'basket') {
        const B = o.B || 180, n = o.n || 3, sl = B / n, he = [], ve = [];
        let hs = '', seam = '';
        for (let j = 0; j * B < H; j++) for (let i = 0; i * B < W; i++) {
          const x = i * B, y = j * B, horizontal = (i + j) % 2 === 0;
          (horizontal ? he : ve).push(rectD(x, y, B, B));
          for (let k = 1; k < n; k++) seam += horizontal ? 'M' + x + ' ' + (y + k * sl) + 'h' + B : 'M' + (x + k * sl) + ' ' + y + 'v' + B;
          seam += 'M' + x + ' ' + y + 'h' + B + 'M' + x + ' ' + y + 'v' + B;
        }
        const tintLayer = (list) => list.map(d => '<path d="' + d + '" fill="' + (r() < 0.5 ? '#000000' : '#ffffff') + '" fill-opacity="' + f(r() * 14) / 100 + '"/>').join('');
        return '<defs>' + filAt('wh', woodInner(t, o, false, seeds3(r)), 0, 0, W, H) + filAt('wv', woodInner(t, o, false, seeds3(r)), SQ.x, SQ.y, SQ.w, SQ.h)
          + '<clipPath id="ch"><path d="' + he.join('') + '"/></clipPath><clipPath id="cv"><path d="' + ve.join('') + '"/></clipPath></defs>'
          + '<g clip-path="url(#ch)"><rect width="' + W + '" height="' + H + '" filter="url(#wh)"/>' + tintLayer(he) + '</g>'
          + '<g clip-path="url(#cv)"><rect x="' + SQ.x + '" y="' + SQ.y + '" width="' + SQ.w + '" height="' + SQ.h + '"' + rotSq + ' filter="url(#wv)"/>' + tintLayer(ve) + '</g>'
          + '<path d="' + seam + '" fill="none" stroke="#000000" stroke-opacity="0.5" stroke-width="2.4"/>' + sheen('sh', 0.12) + vig('vg', 0.22);
      }
      if (mode === 'bamboo') {
        const cw = o.w || 96;
        let body = '', nodes = '';
        const defs = lg('cyl', 0, 0, 1, 0, [[0, '#000000', 0.5], [0.12, '#000000', 0.12], [0.38, '#ffffff', 0.2], [0.55, '#ffffff', 0.07], [0.88, '#000000', 0.2], [1, '#000000', 0.55]])
          + fil('fib', turb('a', 'fractalNoise', 0.9, 0.0035, 2, seedOf(r)) + gray('a', 'g', 2.2, -0.6) + veilOf('g', 'out', t[0], 0.5, -0.05))
          + lg('nd', 0, 0, 0, 1, [[0, '#000000', 0.0], [0.45, '#000000', 0.45], [0.55, '#000000', 0.5], [0.62, '#ffffff', 0.3], [1, '#ffffff', 0]]);
        for (let x = 0, i = 0; x < W; x += cw, i++) {
          const base = mix(t[2], t[3], r());
          body += '<rect x="' + x + '" width="' + cw + '" height="' + H + '" fill="' + base + '"/><rect x="' + x + '" width="' + cw + '" height="' + H + '" fill="url(#cyl)"/>';
          for (let y = -r() * 200; y < H; y += 250 + r() * 130) nodes += '<rect x="' + x + '" y="' + f(y) + '" width="' + cw + '" height="16" fill="url(#nd)"/>';
        }
        return '<defs>' + defs + '</defs>' + body + sheet('fib') + nodes + sheen('sh', 0.1) + vig('vg', 0.2);
      }
      throw new Error('Unknown wood mode: ' + mode);
    };

    // --- fabric ------------------------------------------------------------------------------------

    // The crossing of two thread directions as a repeating tile: p = thread width, twill = over two, under two.
    function weaveTile(id, p, o) {
      const n = o.twill ? 4 : 2, gap = o.gap || 0, a = o.shade || 0.34, b = o.glint || 0.24;
      const defs = lg(id + 'h', 0, 0, 0, 1, [[0, '#000000', a], [0.5, '#ffffff', b], [1, '#000000', a]]) + lg(id + 'v', 0, 0, 1, 0, [[0, '#000000', a], [0.5, '#ffffff', b], [1, '#000000', a]]);
      let cells = gap ? '<rect width="' + n * p + '" height="' + n * p + '" fill="#000000" fill-opacity="' + gap + '"/>' : '';
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const hOver = o.twill ? (i + j) % 4 < 2 : (i + j) % 2 === 0;
        cells += '<rect x="' + i * p + '" y="' + j * p + '" width="' + p + '" height="' + p + '" fill="url(#' + id + (hOver ? 'h' : 'v') + ')"/>';
      }
      return defs + '<pattern id="' + id + '" width="' + n * p + '" height="' + n * p + '" patternUnits="userSpaceOnUse">' + cells + '</pattern>';
    }
    const fill = (id) => '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + ')"/>';

    Object.assign(GEN, {
      // Plain-weave cloth: linen, canvas, burlap. o.p: thread width in px; o.slub: how uneven the yarn is; o.gap: dark showing between threads.
      linen(r, c, o) {
        const t = tones(c), p = o.p || 4.5, slub = o.slub == null ? 1 : o.slub;
        const base = turb('b', 'fractalNoise', 0.004, 0.004, 3, seedOf(r)) + gray('b', 'bg', 1.0, 0) + tint('bg', 'ground', [t[2], t[3], t[4], t[3]])
          + turb('h', 'fractalNoise', 0.01, 1 / p * 0.7, 2, seedOf(r)) + soft('h', 'hg', 0.9 * slub)
          + turb('v', 'fractalNoise', 1 / p * 0.7, 0.01, 2, seedOf(r)) + soft('v', 'vg', 0.9 * slub)
          + arith('hg', 'vg', 'hv', 0, 0.5, 0.5, 0) + arith('ground', 'hv', 'cl', 1.12, 0, 0, 0)
          + lit('cl', 'hv', 'out', 1.6, 225, 60);
        return '<defs>' + fil('l', base) + weaveTile('wv', p, { gap: o.gap }) + '</defs>' + sheet('l') + fill('wv') + vig('vg', 0.18);
      },

      // Blue jean cloth: diagonal twill, uneven weft, faded patches, optional seam of stitching.
      denim(r, c, o) {
        const t = tones(c);
        const inner = turb('b', 'fractalNoise', 0.003, 0.005, 4, seedOf(r)) + gray('b', 'bg', 1.25, -0.1) + tint('bg', 'ground', [t[0], t[1], t[2], t[3], t[4]])
          + turb('h', 'fractalNoise', 0.012, 0.5, 2, seedOf(r)) + gray('h', 'hg', 1.5, -0.3) + lit('ground', 'hg', 'out', 1.2, 215, 58);
        const tw = '<pattern id="tw" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-63)"><rect width="6" height="2.6" fill="#ffffff" fill-opacity="0.2"/><rect y="2.6" width="6" height="1" fill="#000000" fill-opacity="0.28"/></pattern>';
        let seam = '';
        if (o.seam) {
          const y = H * 0.7, dash = (yy, col, op, w) => '<path d="M0 ' + yy + 'H' + W + '" stroke="' + col + '" stroke-opacity="' + op + '" stroke-width="' + w + '" stroke-dasharray="26 12" stroke-linecap="round"/>';
          seam = '<path d="M0 ' + (y - 26) + 'H' + W + '" stroke="#000000" stroke-opacity="0.35" stroke-width="3"/>' + dash(y - 36, t[4], 0.9, 5) + dash(y - 16, t[4], 0.9, 5) + dash(y - 33, '#000000', 0.35, 5) + dash(y - 13, '#000000', 0.35, 5);
        }
        return '<defs>' + fil('d', inner) + tw + '</defs>' + sheet('d') + fill('tw') + seam + vig('vg', 0.22);
      },

      // Felt and wool: fuzzy, soft, lit from the side, with loose fibres.
      felt(r, c, o) {
        const t = tones(c);
        const inner = turb('b', 'fractalNoise', 0.005, 0.005, 3, seedOf(r)) + gray('b', 'bg', 1.4, -0.2) + tint('bg', 'ground', [t[1], t[2], t[3], t[2]])
          + turb('n', 'fractalNoise', o.f || 0.55, o.f || 0.55, 3, seedOf(r)) + gray('n', 'ng', 1.5, -0.25) + lit('ground', 'ng', 'out', o.bump || 2.4, 225, 55);
        let fib = '';
        for (let i = 0; i < (o.fibres == null ? 130 : o.fibres); i++) {
          const x = r() * W, y = r() * H, a = r() * 6.28, l = 12 + r() * 30, bend = (r() - 0.5) * 22;
          fib += '<path d="M' + f(x) + ' ' + f(y) + 'q' + f(Math.cos(a) * l / 2 - Math.sin(a) * bend) + ' ' + f(Math.sin(a) * l / 2 + Math.cos(a) * bend) + ' ' + f(Math.cos(a) * l) + ' ' + f(Math.sin(a) * l) + '" stroke="' + (r() < 0.5 ? t[4] : t[0]) + '" stroke-opacity="' + f(0.2 + r() * 3) / 10 + '"/>';
        }
        return '<defs>' + fil('fe', inner) + '</defs>' + sheet('fe') + '<g fill="none" stroke-width="1.3" stroke-linecap="round">' + fib + '</g>' + vig('vg', 0.3);
      },

      // Knitting. o.mode: 'stock' (rows of V stitches), 'rib' (vertical ribs), 'garter' (horizontal ridges); o.sz: stitch size.
      knit(r, c, o) {
        const t = tones(c), mode = o.mode || 'stock', s = o.sz || 1.7;
        let tile = '', w, h;
        if (mode === 'stock') {
          w = 24 * s; h = 30 * s;
          const leg = (x1, y1, x2, y2, dy) => {
            const d = 'M' + f(x1) + ' ' + f(y1 + dy) + 'Q' + f((x1 + x2) / 2 + (x1 < x2 ? 3 : -3) * s) + ' ' + f((y1 + y2) / 2 + dy) + ' ' + f(x2) + ' ' + f(y2 + dy);
            return '<path d="' + d + '" stroke="' + t[0] + '" stroke-width="' + f(11.5 * s) + '"/><path d="' + d + '" stroke="' + t[2] + '" stroke-width="' + f(8.4 * s) + '"/><path d="' + d + '" stroke="' + t[3] + '" stroke-width="' + f(3.6 * s) + '"/><path d="' + d + '" stroke="' + t[4] + '" stroke-opacity="0.55" stroke-width="' + f(1.4 * s) + '"/>';
          };
          for (const dy of [-h, 0, h]) tile += leg(5 * s, 3 * s, 12 * s, 27 * s, dy) + leg(19 * s, 3 * s, 12 * s, 27 * s, dy);
        } else if (mode === 'rib') {
          w = 26 * s; h = 40 * s;
          const cyl = (x, col) => '<rect x="' + f(x) + '" width="' + f(12 * s) + '" height="' + f(h) + '" fill="' + col + '"/>';
          tile = '<rect width="' + w + '" height="' + h + '" fill="' + t[0] + '"/>' + cyl(0, t[2]) + cyl(13 * s, t[1]) + '<rect x="' + f(3 * s) + '" width="' + f(4 * s) + '" height="' + f(h) + '" fill="' + t[4] + '" fill-opacity="0.35"/>';
          for (let y = 0; y < h; y += 8 * s) tile += '<path d="M0 ' + f(y) + 'l' + f(12 * s) + ' ' + f(3 * s) + '" stroke="' + t[0] + '" stroke-opacity="0.5" stroke-width="' + f(1.4 * s) + '"/>';
        } else {
          w = 40 * s; h = 22 * s;
          tile = '<rect width="' + w + '" height="' + h + '" fill="' + t[1] + '"/><rect y="' + f(1 * s) + '" width="' + w + '" height="' + f(9 * s) + '" rx="' + f(4 * s) + '" fill="' + t[3] + '"/><rect y="' + f(3 * s) + '" width="' + w + '" height="' + f(3 * s) + '" fill="' + t[4] + '" fill-opacity="0.5"/><rect y="' + f(12 * s) + '" width="' + w + '" height="' + f(9 * s) + '" rx="' + f(4 * s) + '" fill="' + t[2] + '"/>';
          for (let x = 0; x < w; x += 10 * s) tile += '<path d="M' + f(x) + ' ' + f(h) + 'l' + f(4 * s) + ' ' + f(-9 * s) + '" stroke="' + t[0] + '" stroke-opacity="0.35" stroke-width="' + f(1.4 * s) + '"/>';
        }
        const inner = turb('n', 'fractalNoise', 0.35, 0.35, 2, seedOf(r)) + '<feDisplacementMap in="SourceGraphic" in2="n" scale="' + f(3 * s) + '" xChannelSelector="R" yChannelSelector="G" result="d"/>'
          + turb('b', 'fractalNoise', 0.006, 0.006, 3, seedOf(r)) + soft('b', 'bg', 0.6) + arith('d', 'bg', 'out', 1.12, 0, 0, 0);
        return '<defs><pattern id="kt" width="' + f(w) + '" height="' + f(h) + '" patternUnits="userSpaceOnUse"><g fill="none" stroke-linecap="round">' + tile + '</g></pattern>' + fil('k', inner, 6) + '</defs>'
          + '<rect x="-6" y="-6" width="' + (W + 12) + '" height="' + (H + 12) + '" fill="url(#kt)" filter="url(#k)"/>' + vig('vg', 0.3);
      },

      // Woven checks: o.mode 'tartan' (plaid, a sett of coloured bands), 'gingham', 'hound' (houndstooth).
      check(r, c, o) {
        const t = tones(c), mode = o.mode || 'tartan';
        const finish = '<defs>' + weaveTile('wv', 3.4, { twill: true, shade: 0.3, glint: 0.18 }) + fil('fz', turb('n', 'fractalNoise', 0.5, 0.5, 2, seedOf(r)) + gray('n', 'ng', 1.3, -0.15) + veilOf('ng', 'out', '#000000', -0.7, 0.45)) + '</defs>';
        if (mode === 'hound') {
          const cs = o.cs || 11, n = 8, dark = t[0], light = t[4];
          let d = '';
          for (let y = 0; y < n; y++) { let run = -1; for (let x = 0; x <= n; x++) {
            const warpDark = (x % 8) < 4, weftDark = (y % 8) < 4, over = ((x + y) % 4) < 2, isDark = x < n && (over ? warpDark : weftDark);
            if (isDark && run < 0) run = x; if (!isDark && run >= 0) { d += 'M' + run * cs + ' ' + y * cs + 'h' + (x - run) * cs + 'v' + cs + 'h' + -(x - run) * cs + 'z'; run = -1; }
          } }
          return '<defs><pattern id="ht" width="' + n * cs + '" height="' + n * cs + '" patternUnits="userSpaceOnUse"><rect width="' + n * cs + '" height="' + n * cs + '" fill="' + light + '"/><path d="' + d + '" fill="' + dark + '"/></pattern></defs>' + fill('ht') + finish + fill('wv') + sheet('fz') + vig('vg', 0.2);
        }
        const bands = [];
        if (mode === 'gingham') { const wd = o.cs || 44; bands.push([t[1], wd * 2, 0.55], [t[4], wd, 0], [t[1], wd * 2, 0.55], [t[4], wd, 0]); }
        else { const cols = [t[1], t[2], t[3], t[0]]; let n = 5 + Math.floor(r() * 3); for (let i = 0; i < n; i++) bands.push([cols[i % 4], 8 + Math.floor(r() * 5) * 10, 0.5]); }
        const cycle = bands.reduce((a, b) => a + b[1], 0);
        let hs = '', vs = '';
        for (let x = 0; x < W + cycle; x += cycle) { let p = x; bands.forEach(b => { vs += '<rect x="' + p + '" width="' + b[1] + '" height="' + H + '" fill="' + b[0] + '"/>'; p += b[1]; }); }
        for (let y = 0; y < H + cycle; y += cycle) { let p = y; bands.forEach(b => { hs += '<rect y="' + p + '" width="' + W + '" height="' + b[1] + '" fill="' + b[0] + '"/>'; p += b[1]; }); }
        const ground = mode === 'gingham' ? t[4] : mix(t[0], t[1], 0.5);
        return finish + box(ground) + '<g opacity="0.62">' + vs + '</g><g opacity="0.62">' + hs + '</g>' + fill('wv') + sheet('fz') + vig('vg', 0.25);
      },

      // Satin, silk and velvet: soft folds of light. o.velvet: matt, darker in the folds.
      satin(r, c, o) {
        const t = tones(c), folds = o.folds || 2;
        const inner = turb('w', 'fractalNoise', 0.0006, 0.0013, 2, seedOf(r)) + gray('w', 'wg', 1.5, -0.25) + curve('wg', 'wz', wave(folds, 12))
          + tint('wz', 'col', o.velvet ? [t[0], t[1], t[2], t[3], mix(t[3], t[4], 0.5)] : [t[1], t[2], t[3], t[4], t[4]])
          + turb('g', 'fractalNoise', o.velvet ? 0.7 : 0.012, o.velvet ? 0.7 : 0.9, 2, seedOf(r)) + gray('g', 'gg', 1.3, -0.15) + lit('col', 'gg', 'out', o.velvet ? 0.9 : 0.4, 235, 62);
        return '<defs>' + fil('s', inner) + '</defs>' + sheet('s') + vig('vg', o.velvet ? 0.4 : 0.15);
      },

      // Corduroy: soft vertical ribs.
      cord(r, c, o) {
        const t = tones(c), p = o.p || 13;
        const rib = '<pattern id="cr" width="' + p + '" height="8" patternUnits="userSpaceOnUse">' + lg('cg', 0, 0, 1, 0, [[0, '#000000', 0.5], [0.25, '#000000', 0.05], [0.55, '#ffffff', 0.2], [0.8, '#000000', 0.08], [1, '#000000', 0.5]]) + '<rect width="' + p + '" height="8" fill="url(#cg)"/></pattern>';
        const inner = turb('b', 'fractalNoise', 0.004, 0.004, 3, seedOf(r)) + gray('b', 'bg', 0.9, 0.05) + tint('bg', 'ground', [t[1], t[2], t[3], t[2]])
          + turb('n', 'fractalNoise', 0.5, 0.06, 2, seedOf(r)) + gray('n', 'ng', 1.3, -0.15) + lit('ground', 'ng', 'out', 1.6, 215, 58);
        return '<defs>' + fil('c', inner) + rib + '</defs>' + sheet('c') + fill('cr') + vig('vg', 0.3);
      },
    });

    // --- paper and leather -----------------------------------------------------------------------

    // A filter that lights the grain of whatever is drawn in the group it is put on (SourceGraphic).
    function skin(id, r, f1, scale, o) {
      o = o || {};
      return fil(id, turb('n', 'fractalNoise', f1, f1, o.oct || 3, seedOf(r)) + gray('n', 'ng', o.gain || 1.3, o.bias == null ? -0.15 : o.bias)
        + toAlpha('ng', 'hn') + diffuse('hn', 'Ln', scale, 225, 58) + arith('SourceGraphic', 'Ln', 'lt', 1 / Math.sin(58 * Math.PI / 180), 0, 0, 0)
        + soft('n', 'mt', o.mottle == null ? 0.2 : o.mottle) + arith('lt', 'mt', 'out', 1, 0, 0, 0));
    }
    // A coloured fade at the edges.
    const edge = (id, col, a) => '<defs>' + rg(id, 0.5, 0.5, 0.75, [[0.45, col, 0], [1, col, a]]) + '</defs>' + box('url(#' + id + ')');

    Object.assign(GEN, {
      // Paper. o.mode: plain, kraft, cold (watercolour paper), hand (handmade, with fibres), parch (parchment), ruled, graph, dots.
      paper(r, c, o) {
        const t = tones(c), mode = o.mode || 'plain';
        const P = { plain: [0.7, 0.7, 0.7, 0.9], kraft: [0.55, 0.5, 1.1, 1.2], cold: [0.1, 0.1, 1.5, 0.9], hand: [0.2, 0.2, 2, 1.3], parch: [0.5, 0.5, 0.9, 2.4], ruled: [0.7, 0.7, 0.7, 0.9], graph: [0.7, 0.7, 0.7, 0.9], dots: [0.7, 0.7, 0.7, 0.9] }[mode];
        if (!P) throw new Error('Unknown paper mode: ' + mode);
        const stops = mode === 'parch' ? [t[0], t[1], t[2], t[3], t[4]] : [t[2], t[3], t[4], t[3]];
        const inner = turb('c', 'fractalNoise', 0.004, 0.004, 3, seedOf(r)) + gray('c', 'cg', P[3], (mode === 'parch' ? 0.1 : 0.15) - P[3] * 0.1) + tint('cg', 'ground', stops)
          + turb('n', 'fractalNoise', P[0], P[1], 3, seedOf(r)) + gray('n', 'ng', 1.3, -0.15) + lit('ground', 'ng', 'out', P[2], 225, 58);
        let body = '<defs>' + fil('p', inner) + '</defs>' + sheet('p');
        const fibres = o.fibres == null ? (mode === 'kraft' || mode === 'hand' ? 220 : 0) : o.fibres;
        if (fibres) {
          let d = '';
          for (let i = 0; i < fibres; i++) {
            const x = r() * W, y = r() * H, a = r() * 6.28, l = 16 + r() * 46, b = (r() - 0.5) * 26;
            d += 'M' + Math.round(x) + ' ' + Math.round(y) + 'q' + f(Math.cos(a) * l / 2 - Math.sin(a) * b) + ' ' + f(Math.sin(a) * l / 2 + Math.cos(a) * b) + ' ' + f(Math.cos(a) * l) + ' ' + f(Math.sin(a) * l);
          }
          body += '<path d="' + d + '" fill="none" stroke="' + t[4] + '" stroke-opacity="0.38" stroke-width="1.1" stroke-linecap="round"/>'
            + '<path d="' + d + '" fill="none" stroke="' + t[0] + '" stroke-opacity="0.16" stroke-width="0.8" stroke-linecap="round" transform="translate(1.4 1.2)"/>';
        }
        if (mode === 'parch') {
          let st = '';
          for (let i = 0; i < 7; i++) st += '<ellipse cx="' + f(r() * W) + '" cy="' + f(r() * H) + '" rx="' + f(120 + r() * 240) + '" ry="' + f(80 + r() * 160) + '" fill="' + t[0] + '" fill-opacity="' + f(0.8 + r() * 1.4) / 10 + '"/>';
          body += '<defs><filter id="bl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="40"/></filter></defs><g filter="url(#bl)">' + st + '</g>' + edge('eg', mix(t[0], '#000000', 0.3), 0.7);
        }
        if (mode === 'ruled') {
          let d = '';
          for (let y = 130; y < H; y += 38) d += 'M0 ' + y + 'H' + W;
          body += '<path d="' + d + '" stroke="' + t[1] + '" stroke-opacity="0.85" stroke-width="1.8" fill="none"/><path d="M214 0V' + H + 'M222 0V' + H + '" stroke="' + mix(t[1], '#c0392b', 0.7) + '" stroke-opacity="0.55" stroke-width="1.6" fill="none"/>';
        }
        if (mode === 'graph' || mode === 'dots') {
          const gp = '<pattern id="g1" width="24" height="24" patternUnits="userSpaceOnUse">' + (mode === 'graph' ? '<path d="M24 0H0V24" fill="none" stroke="' + t[1] + '" stroke-opacity="0.35" stroke-width="1"/>' : '<circle cx="12" cy="12" r="1.5" fill="' + t[1] + '" fill-opacity="0.55"/>') + '</pattern>'
            + '<pattern id="g2" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M120 0H0V120" fill="none" stroke="' + t[1] + '" stroke-opacity="0.55" stroke-width="1.4"/></pattern>';
          body += '<defs>' + gp + '</defs>' + fill('g1') + (mode === 'graph' ? fill('g2') : '');
        }
        return body + vig('vg', mode === 'parch' ? 0.1 : 0.12);
      },

      // Leather. o.mode: plain (grained), quilt (diamond-quilted, buttoned), seam (a stitched seam); o.f: size of the grain.
      leather(r, c, o) {
        const t = tones(c), mode = o.mode || 'plain', bump = o.bump || (mode === 'quilt' ? 0.9 : 1.7);
        const inner = turb('c', 'fractalNoise', 0.0045, 0.0045, 3, seedOf(r)) + gray('c', 'cg', 1.0, -0.05) + tint('cg', 'col', [t[0], t[1], t[2], t[3], t[3]])
          + turb('k', 'turbulence', o.f || 0.085, o.f || 0.085, 3, seedOf(r)) + gray('k', 'kg', 2.0, 0)
          + lit('col', 'kg', 'lt', bump, 225, 52) + toAlpha('kg', 'hk') + specular('hk', 'sp', bump, 22, 0.5, 225, 52, t[4]) + arith('lt', 'sp', 'out', 0, 1, 0.55, 0);
        let body = '<defs>' + fil('lt', inner) + '</defs>' + sheet('lt');
        if (mode === 'quilt') {
          const D = o.d || 120;
          body += '<defs>' + rg('pf', 0.5, 0.5, 0.72, [[0, '#ffffff', 0.3], [0.5, '#ffffff', 0], [1, '#000000', 0.78]]) + rg('bt', 0.5, 0.5, 0.5, [[0, '#000000', 0.7], [0.6, '#000000', 0.35], [1, '#000000', 0]])
            + '<pattern id="qp" width="' + D + '" height="' + D + '" patternUnits="userSpaceOnUse" patternTransform="rotate(45 800 450) translate(' + f(r() * D) + ' ' + f(r() * D) + ')"><rect width="' + D + '" height="' + D + '" fill="url(#pf)"/>'
            + '<rect x="3" y="3" width="' + (D - 6) + '" height="' + (D - 6) + '" fill="none" stroke="' + t[4] + '" stroke-opacity="0.45" stroke-width="1.6" stroke-dasharray="6 4"/><circle r="9" fill="url(#bt)"/><circle cx="' + D + '" r="9" fill="url(#bt)"/><circle cy="' + D + '" r="9" fill="url(#bt)"/><circle cx="' + D + '" cy="' + D + '" r="9" fill="url(#bt)"/></pattern></defs>'
            + '<rect x="-500" y="-500" width="' + (W + 1000) + '" height="' + (H + 1000) + '" fill="url(#qp)"/>';
        } else if (mode === 'seam') {
          const y = H * 0.6, dash = (yy, col, op, w) => '<path d="M0 ' + yy + 'H' + W + '" stroke="' + col + '" stroke-opacity="' + op + '" stroke-width="' + w + '" stroke-dasharray="30 14" stroke-linecap="round"/>';
          body += '<path d="M0 ' + y + 'H' + W + '" stroke="#000000" stroke-opacity="0.5" stroke-width="5"/><path d="M0 ' + (y + 5) + 'H' + W + '" stroke="' + t[4] + '" stroke-opacity="0.12" stroke-width="2"/>' + dash(y - 24, '#000000', 0.4, 6) + dash(y + 26, '#000000', 0.4, 6) + dash(y - 27, t[4], 0.95, 5) + dash(y + 23, t[4], 0.95, 5);
        }
        return body + vig('vg', 0.3);
      },
    });

    // --- stone, concrete, granite, cork ------------------------------------------------------------

    Object.assign(GEN, {
      // o.mode: concrete, plaster, slate, sandstone.  o.panels: formwork seams and tie holes (concrete).
      stone(r, c, o) {
        const t = tones(c), mode = o.mode || 'concrete';
        let inner, extra = '';
        if (mode === 'concrete' || mode === 'plaster') {
          const rough = mode === 'concrete';
          inner = turb('c', 'fractalNoise', rough ? 0.0035 : 0.0028, rough ? 0.0035 : 0.0028, 4, seedOf(r)) + gray('c', 'cg', rough ? 1.7 : 1.2, rough ? -0.3 : -0.1) + tint('cg', 'col', [t[1], t[2], t[3], t[3], t[4]])
            + turb('n', 'fractalNoise', rough ? 0.5 : 0.014, rough ? 0.5 : 0.014, rough ? 2 : 3, seedOf(r)) + gray('n', 'ng', 1.3, -0.15) + lit('col', 'ng', 'out', rough ? 1.6 : 1.5, 225, 58);
          if (rough) {
            for (let i = 0; i < 110; i++) { const x = r() * W, y = r() * H, rr = 1 + r() * r() * 5; extra += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(rr) + '" fill="#000000" fill-opacity="' + f(1 + r() * 3) / 10 + '"/><circle cx="' + f(x + rr * 0.6) + '" cy="' + f(y + rr * 0.7) + '" r="' + f(rr * 0.8) + '" fill="#ffffff" fill-opacity="0.07"/>'; }
            if (o.panels) {
              const pw = o.pw || 400, ph = o.ph || 300; let d = '', holes = '';
              for (let x = pw; x < W; x += pw) d += 'M' + x + ' 0V' + H;
              for (let y = ph; y < H; y += ph) d += 'M0 ' + y + 'H' + W;
              for (let x = pw / 2; x < W; x += pw) for (let y = ph / 2; y < H; y += ph) holes += '<circle cx="' + x + '" cy="' + y + '" r="9" fill="#000000" fill-opacity="0.4"/><circle cx="' + x + '" cy="' + (y + 2) + '" r="9" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5"/>';
              extra += '<path d="' + d + '" stroke="#000000" stroke-opacity="0.5" stroke-width="3" fill="none"/><path d="' + d + '" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5" fill="none" transform="translate(2 2)"/>' + holes;
            }
          }
        } else if (mode === 'slate') {
          inner = turb('c', 'fractalNoise', 0.0035, 0.02, 5, seedOf(r)) + gray('c', 'cg', 1.8, -0.4) + tint('cg', 'col', [t[0], t[1], t[2], t[3]])
            + lit('col', 'cg', 'out', 5.5, 205, 42);
          for (let i = 0; i < 9; i++) {
            let x = r() * W, y = r() * H, d = 'M' + f(x) + ' ' + f(y);
            for (let k = 0; k < 12; k++) { x += (r() - 0.35) * 70; y += (r() - 0.3) * 38; d += 'L' + f(x) + ' ' + f(y); }
            extra += '<path d="' + d + '" fill="none" stroke="#000000" stroke-opacity="' + f(0.2 + r() * 3) / 10 + '" stroke-width="' + f(1 + r() * 1.8) + '"/>';
          }
        } else if (mode === 'sandstone') {
          inner = turb('c', 'fractalNoise', 0.0003, 0.009, 3, seedOf(r)) + gray('c', 'cg', 1.6, -0.3) + curve('cg', 'cz', wave(o.n || 4, 10)) + tint('cz', 'col', [t[1], t[2], t[3], t[4]])
            + turb('n', 'fractalNoise', 0.6, 0.6, 2, seedOf(r)) + gray('n', 'ng', 1.4, -0.2) + lit('col', 'ng', 'out', 1.8, 215, 55);
        } else throw new Error('Unknown stone mode: ' + mode);
        return '<defs>' + fil('s', inner) + '</defs>' + sheet('s') + extra + vig('vg', 0.2);
      },

      // Speckled surfaces: granite, quartz, speckled ceramic, cork. o.f: size of the specks; o.dens: how many; o.g: which tone is the ground.
      speckle(r, c, o) {
        const t = tones(c), g = o.g == null ? 3 : o.g, f1 = o.f || 0.3, dens = o.dens || 1.7;
        const others = t.filter((_, i) => i !== g), gd = t[g];
        const steps = [others[0], others[1], gd, gd, gd, gd, gd, gd, gd, gd, others[2], others[3]];
        const inner = turb('c', 'fractalNoise', 0.003, 0.003, 3, seedOf(r)) + soft('c', 'cm', 0.3)
          + turb('s', 'fractalNoise', f1, f1, 2, seedOf(r)) + gray('s', 'sg', dens, 0.5 - 0.5 * dens) + tint('sg', 'sp', steps, 'discrete')
          + arith('sp', 'cm', 'col', 1.1, 0, 0, 0)
          + turb('n', 'fractalNoise', o.bf || 0.8, o.bf || 0.8, 2, seedOf(r)) + gray('n', 'ng', 1.3, -0.15) + lit('col', 'ng', 'out', o.bump || 1.2, 225, 58);
        let pits = '';
        for (let i = 0; i < (o.pits || 0); i++) { const x = r() * W, y = r() * H, rr = 1.2 + r() * 3.4; pits += '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(rr) + '" ry="' + f(rr * 0.8) + '" fill="#000000" fill-opacity="' + f(1.5 + r() * 3) / 10 + '"/>'; }
        return '<defs>' + fil('k', inner) + '</defs>' + sheet('k') + pits + sheen('sh', o.gloss == null ? 0.12 : o.gloss) + vig('vg', 0.16);
      },

      // Terrazzo: chips of marble and stone set in cement. o.g: tone of the cement; o.n: number of chips; o.big: size of the chips.
      terrazzo(r, c, o) {
        const t = tones(c), g = o.g == null ? 4 : o.g, pal = t.filter((_, i) => i !== g), buckets = pal.map(() => '');
        const n = o.n || 240, big = o.big || 1;
        for (let i = 0; i < n; i++) {
          const sz = (6 + Math.pow(r(), 2.6) * 70) * big, x = r() * W, y = r() * H, k = 5 + Math.floor(r() * 3), rot = r() * 6.28;
          let d = '';
          for (let v = 0; v < k; v++) {
            const a = rot + (v + (r() - 0.5) * 0.7) / k * 6.2832, rr = sz * (0.62 + r() * 0.38);
            d += (v ? 'L' : 'M') + Math.round(x + Math.cos(a) * rr * 1.15) + ' ' + Math.round(y + Math.sin(a) * rr * 0.85);
          }
          buckets[Math.floor(r() * pal.length)] += d + 'Z';
        }
        const chips = buckets.map((d, i) => '<path d="' + d + '" fill="' + pal[i] + '"/>').join('');
        return '<defs>' + skin('sk', r, 0.45, 1.3) + '</defs><g filter="url(#sk)">' + box(t[g]) + chips + '</g>' + sheen('sh', 0.14) + vig('vg', 0.16);
      },

      // Brick, running bond. o.w, o.h: brick size; o.gap: mortar joint.
      brick(r, c, o) {
        const t = tones(c), bw = o.w || 128, bh = o.h || 42, gap = o.gap || 7, mortar = o.mortar || mix(t[4], t[3], 0.5);
        const buckets = ['', '', '', '', '', ''];
        for (let y = 0, j = 0; y < H + bh; y += bh + gap, j++) for (let x = (j % 2 ? -bw / 2 - gap / 2 : 0); x < W; x += bw + gap) {
          const v = Math.floor(Math.pow(r(), 1.2) * 6);
          buckets[v] += rectD(f(x), y, bw, bh);
        }
        const bricks = buckets.map((d, i) => '<path d="' + d + '" fill="' + along(t.slice(0, 4), 0.2 + i * 0.16) + '"/>').join('');
        return '<defs>' + skin('sk', r, 0.35, 2.6, { mottle: 0.35 }) + '</defs><g filter="url(#sk)">' + box(mortar) + bricks + '</g>' + vig('vg', 0.3);
      },
    });

    // --- metal ---------------------------------------------------------------------------------------

    function brushedInner(r, t, o) {
      return turb('a', 'fractalNoise', 0.0014, o.f || 0.55, 3, seedOf(r)) + gray('a', 'ag', 1.5, -0.2)
        + turb('b', 'fractalNoise', 0.0006, 0.003, 2, seedOf(r)) + gray('b', 'bg', 2.4, -0.7)
        + arith('ag', 'bg', 'mg', 0, 0.45, 0.55, 0) + tint('mg', 'col', [t[0], t[1], t[2], t[3], t[4]]) + lit('col', 'ag', 'out', 0.8, 225, 62);
    }

    Object.assign(GEN, {
      // Metal. o.mode: brushed (default), hammered, patina (verdigris on copper), carbon (carbon fibre), plate (tread plate),
      // perf (perforated), flute (corrugated).
      metal(r, c, o) {
        const t = tones(c), mode = o.mode || 'brushed';
        const shine = sheen('sh', o.gloss == null ? 0.2 : o.gloss), vg = vig('vg', 0.26);
        if (mode === 'brushed') return '<defs>' + fil('b', brushedInner(r, t, o)) + '</defs>' + sheet('b') + shine + vg;
        if (mode === 'hammered') {
          const inner = turb('a', 'fractalNoise', 0.02, 0.02, 2, seedOf(r)) + gray('a', 'hg', 1.7, -0.35) + turb('b', 'fractalNoise', 0.003, 0.003, 3, seedOf(r)) + gray('b', 'bg', 1.4, -0.2)
            + tint('bg', 'col', [t[0], t[1], t[2], t[3], t[4]]) + lit('col', 'hg', 'lt', 5, 225, 45) + toAlpha('hg', 'hh') + specular('hh', 'sp', 5, 24, 0.55, 225, 45, t[4]) + arith('lt', 'sp', 'out', 0, 1, 0.6, 0);
          return '<defs>' + fil('b', inner) + '</defs>' + sheet('b') + shine + vg;
        }
        if (mode === 'patina') {
          const inner = brushedInner(r, [t[0], t[1], t[2], t[2], t[2]], o).replace(/result="out"/, 'result="cu"')
            + turb('m', 'fractalNoise', 0.0058, 0.0058, 5, seedOf(r)) + gray('m', 'mg2', 2.8, -0.95) + curve('mg2', 'mc', [0, 0, 0.08, 0.5, 0.9, 1, 1])
            + toAlpha('mc', 'ma') + tint('mc', 'tc', [t[3], t[3], t[4]]) + '<feComposite in="tc" in2="ma" operator="in" result="tin"/>'
            + turb('s', 'fractalNoise', 0.4, 0.4, 2, seedOf(r)) + gray('s', 'sg', 1.3, -0.15) + lit('tin', 'sg', 'tl', 1.6, 225, 58) + merge('out', ['cu', 'tl']);
          return '<defs>' + fil('b', inner) + '</defs>' + sheet('b') + shine + vg;
        }
        if (mode === 'carbon') {
          const p = o.p || 11;
          return '<defs>' + weaveTile('cb', p, { twill: true, shade: 0.5, glint: 0.42 }) + lg('gl', 0, 0, 1, 1, [[0, '#ffffff', 0.0], [0.3, '#ffffff', 0.0], [0.45, '#ffffff', 0.32], [0.55, '#ffffff', 0.0], [0.75, '#ffffff', 0.12], [1, '#ffffff', 0]]) + '</defs>'
            + box(t[0]) + '<rect width="' + W + '" height="' + H + '" fill="' + mix(t[1], t[0], 0.4) + '" fill-opacity="0.9"/>' + fill('cb') + box('url(#gl)') + vig('vg', 0.5);
        }
        if (mode === 'plate' || mode === 'perf' || mode === 'flute') {
          let pat;
          if (mode === 'plate') {
            const lens = (rot) => '<g transform="translate(28 28) rotate(' + rot + ')"><ellipse cx="1.5" cy="2" rx="20" ry="6" fill="#000000" fill-opacity="0.4"/><ellipse rx="20" ry="6" fill="url(#ln)"/></g>';
            pat = lg('ln', 0, 0, 0, 1, [[0, '#ffffff', 0.55], [0.5, '#ffffff', 0.1], [1, '#000000', 0.45]]) + '<pattern id="pt" width="56" height="56" patternUnits="userSpaceOnUse">' + lens(45) + '<g transform="translate(0 0)">' + lens(-45).replace('translate(28 28)', 'translate(0 0)') + lens(-45).replace('translate(28 28)', 'translate(56 0)') + lens(-45).replace('translate(28 28)', 'translate(0 56)') + lens(-45).replace('translate(28 28)', 'translate(56 56)') + '</g></pattern>';
          } else if (mode === 'perf') {
            const hole = (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="8.5" fill="#000000" fill-opacity="0.8"/><circle cx="' + x + '" cy="' + y + '" r="8.5" fill="url(#hl)"/><circle cx="' + x + '" cy="' + (y + 0.8) + '" r="9.6" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1.2"/>';
            pat = rg('hl', 0.5, 0.5, 0.5, [[0.5, '#000000', 0], [1, '#000000', 0.6]]) + '<pattern id="pt" width="34" height="34" patternUnits="userSpaceOnUse">' + hole(0, 0) + hole(34, 0) + hole(0, 34) + hole(34, 34) + hole(17, 17) + '</pattern>';
          } else {
            pat = lg('fl', 0, 0, 1, 0, [[0, '#000000', 0.55], [0.2, '#ffffff', 0.35], [0.45, '#000000', 0.05], [0.75, '#000000', 0.4], [1, '#000000', 0.55]]) + '<pattern id="pt" width="46" height="20" patternUnits="userSpaceOnUse"><rect width="46" height="20" fill="url(#fl)"/></pattern>';
          }
          return '<defs>' + fil('b', brushedInner(r, t, o)) + pat + '</defs>' + sheet('b') + fill('pt') + shine + vg;
        }
        throw new Error('Unknown metal mode: ' + mode);
      },
    });

    Object.assign(kit, { soft, filAt, filBox, rectD, skin, weaveTile, fill, edge });
    G.extend(GEN);
    const api = { kit, tones };
    if (typeof window !== 'undefined') window.WallpaperMaterials = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = { WallpaperMaterials: api };

  }

  const have = root.WallpaperGenerators || (typeof require === 'function' ? require('./wallpaper-generators.js').WallpaperGenerators : null);
  if (have) build(have);
  else if (root.VexLazy) root.VexLazy.ensure('js/wallpaper-generators.js').then(() => build(root.WallpaperGenerators));
  else throw new Error('js/wallpaper-generators.js must be loaded before js/wallpaper-materials.js');
})(typeof window !== 'undefined' ? window : globalThis);
