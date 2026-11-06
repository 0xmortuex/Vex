// === Tiles, woven patterns and botanical prints, drawn by code (Wallpaper Store) =========
//
// Moroccan and Ottoman tile geometry, Japanese wave and hemp-leaf patterns, kilim and ikat
// weaving, art deco, mid-century shapes, stained glass, mosaic, damask, paisley and leaf
// prints. Like every wallpaper Vex draws, each is a small SVG made from an id, a seed and
// five colours; the five colours are used from dark to light (sorted by brightness) so any
// palette gives a sensible picture. Repeats are SVG <pattern>s, so a picture of 12 KB can
// cover a 4K screen.
//
// Loads after js/wallpaper-materials.js (it uses its toolkit, WallpaperGenerators.kit).

(function (root) {
  'use strict';

  // Files that load late (js/lazy-boot.js) can arrive in any order: this one waits for the materials toolkit if it is not here yet.
  function build(G) {
    const K = G.kit;
    const { f, mix, along, WIDTH: W, HEIGHT: H } = G;
    const { tones, turb, gray, soft, arith, lit, fil, lg, rg, box, seedOf, sheen, vig, toAlpha, diffuse } = K;

    const P = (x, y) => f(x) + ' ' + f(y);
    const fillOf = (id) => '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + ')"/>';
    const pat = (id, w, h, inner, extra) => '<pattern id="' + id + '" width="' + f(w) + '" height="' + f(h) + '" patternUnits="userSpaceOnUse"' + (extra || '') + '>' + inner + '</pattern>';
    // The grain of glaze, paper or thread, lit from the side, over everything inside the group.
    const grainFilter = (id, r, freq, scale, o) => {
      o = o || {};
      return fil(id, turb('n', 'fractalNoise', freq, freq, o.oct || 3, seedOf(r)) + gray('n', 'ng', o.gain || 1.3, o.bias == null ? -0.15 : o.bias)
        + toAlpha('ng', 'hn') + diffuse('hn', 'Ln', scale, 225, 58) + arith('SourceGraphic', 'Ln', 'lt', 1 / Math.sin(58 * Math.PI / 180), 0, 0, 0)
        + soft('n', 'mt', o.mottle == null ? 0.16 : o.mottle) + arith('lt', 'mt', 'out', 1, 0, 0, 0));
    };

    // --- Voronoi cells (stained glass, cobblestones, cracked glaze) ----------------------------

    function clip(poly, a, b, cx, cy) {   // keep the side of the line that is nearer (cx,cy) than (a,b): a half-plane
      const mx = (a + cx) / 2, my = (b + cy) / 2, nx = cx - a, ny = cy - b, out = [];
      const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny;   // < 0: on the (a,b) side
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], n = poly[(i + 1) % poly.length], sp = side(p), sn = side(n);
        if (sp <= 0) out.push(p);
        if ((sp < 0) !== (sn < 0) && sp !== sn) { const t = sp / (sp - sn); out.push([p[0] + (n[0] - p[0]) * t, p[1] + (n[1] - p[1]) * t]); }
      }
      return out;
    }
    function voronoi(pts, x0, y0, x1, y1) {
      return pts.map((p, i) => {
        let poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        for (let j = 0; j < pts.length && poly.length; j++) if (j !== i) poly = clip(poly, p[0], p[1], pts[j][0], pts[j][1]);
        return poly;
      });
    }
    const centroid = (poly) => { let x = 0, y = 0; poly.forEach(p => { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length]; };
    // Points on a jittered grid (stagger: every other row moves half a cell, like bricks), relaxed once so the cells are even.
    function cellPoints(r, cols, rows, jitter, stagger, relax) {
      const cw = W / cols, ch = H / rows, pts = [];
      for (let j = -1; j <= rows; j++) for (let i = -1; i <= cols; i++) pts.push([(i + 0.5 + (stagger && j % 2 ? 0.5 : 0) + (r() - 0.5) * jitter) * cw, (j + 0.5 + (r() - 0.5) * jitter) * ch]);
      if (!relax) return pts;
      const cells = voronoi(pts, -cw * 2, -ch * 2, W + cw * 2, H + ch * 2);
      return pts.map((p, i) => (cells[i].length > 2 ? centroid(cells[i]) : p));
    }
    const inset = (poly, k) => { const c = centroid(poly); return poly.map(p => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]); };
    const polyD = (poly) => 'M' + poly.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z';
    const visible = (poly) => poly.some(p => p[0] > -60 && p[0] < W + 60 && p[1] > -60 && p[1] < H + 60);

    const GEN = {
      // Stained glass: coloured panes held by dark lead lines, lit from behind.
      glass(r, c, o) {
        const t = tones(c), n = o.n || 56, pts = [];
        for (let tries = 0; pts.length < n && tries < 4000; tries++) {
          const p = [r() * W, r() * H];
          if (pts.every(a => Math.hypot(a[0] - p[0], a[1] - p[1]) > (o.gap || 112))) pts.push(p);
        }
        const cells = voronoi(pts, -2, -2, W + 2, H + 2);
        let defs = '', body = '';
        t.forEach((col, i) => { defs += rg('g' + i, 0.5, 0.45, 0.75, [[0, mix(col, '#ffffff', 0.35)], [0.7, col], [1, mix(col, '#000000', 0.35)]]); });
        let lead = '';
        cells.forEach((poly) => {
          if (poly.length < 3) return;
          const idx = Math.floor(r() * 5);
          body += '<path d="' + polyD(poly) + '" fill="url(#g' + idx + ')"/>';
          lead += polyD(poly);
        });
        return '<defs>' + defs + grainFilter('gf', r, 0.03, 1.4, { gain: 1.6, mottle: 0.3 }) + rg('bk', 0.5, 0.5, 0.7, [[0, '#ffffff', 0.34], [1, '#ffffff', 0]]) + '</defs>'
          + '<g filter="url(#gf)">' + box(t[0]) + body + '</g>' + box('url(#bk)')
          + '<path d="' + lead + '" fill="none" stroke="#0b0b0d" stroke-width="' + (o.lead || 8) + '" stroke-linejoin="round"/><path d="' + lead + '" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.4" stroke-linejoin="round" transform="translate(-2 -2)"/>' + vig('vg', 0.25);
      },

      // Stones. o.mode: cobble (rounded stones in a staggered bed), crack (crazed glaze or dried mud), pave (flat slabs).
      stones(r, c, o) {
        const t = tones(c), mode = o.mode || 'cobble';
        const cols = o.cols || (mode === 'cobble' ? 15 : mode === 'pave' ? 7 : 13), rows = o.rows || (mode === 'cobble' ? 8 : mode === 'pave' ? 4 : 8);
        const pts = cellPoints(r, cols, rows, mode === 'pave' ? 0.2 : 0.55, mode === 'cobble', true);
        const cells = voronoi(pts, -300, -300, W + 300, H + 300);
        const buckets = ['', '', '', '', ''];
        let gaps = '';
        cells.forEach((poly) => {
          if (poly.length < 3 || !visible(poly)) return;
          const k = Math.floor(Math.pow(r(), 1.1) * 5);
          const shaped = mode === 'cobble' ? inset(poly, 0.86) : mode === 'pave' ? inset(poly, 0.965) : inset(poly, 0.985);
          buckets[k] += polyD(shaped);
          gaps += '';
        });
        const round = mode === 'cobble' ? 12 : 0;
        const fillTones = [0, 1, 2, 3, 4].map(i => along(t.slice(1), 0.12 + i * 0.2));
        const stones = buckets.map((d, i) => '<path d="' + d + '" fill="' + fillTones[i] + '"' + (round ? ' stroke="' + fillTones[i] + '" stroke-width="' + round + '" stroke-linejoin="round"' : '') + '/>').join('');
        const bed = mode === 'crack' ? mix(t[0], '#000000', 0.5) : t[0];
        return '<defs>' + grainFilter('sk', r, mode === 'cobble' ? 0.3 : 0.4, mode === 'cobble' ? 2.4 : 1.6, { mottle: 0.34 }) + '</defs><g filter="url(#sk)">' + box(bed) + stones + '</g>' + vig('vg', 0.34);
      },

      // Mosaic: small square pieces in colours that drift across the picture.
      mosaic(r, c, o) {
        const t = tones(c), cs = o.cs || 40, cols = Math.ceil(W / cs), rows = Math.ceil(H / cs);
        const a = r() * 6.28, b = r() * 6.28, fq = o.fq || 1, ph = [r() * 100, r() * 100, r() * 100];
        const val = (x, y) => 0.5 + 0.2 * Math.sin(x * 0.17 * fq + ph[0] + Math.sin(y * 0.11 + a)) + 0.18 * Math.sin(y * 0.23 * fq + ph[1] + Math.cos(x * 0.09 + b)) + 0.12 * Math.sin((x + y) * 0.31 + ph[2]);
        const buckets = ['', '', '', '', '', '', ''];
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const v = Math.max(0, Math.min(0.999, val(i, j) + (r() - 0.5) * 0.22));
          const k = Math.floor(v * 7), jx = Math.round((r() - 0.5) * 2), jy = Math.round((r() - 0.5) * 2);
          buckets[k] += 'M' + (i * cs + 2 + jx) + ' ' + (j * cs + 2 + jy) + 'h' + (cs - 4) + 'v' + (cs - 4) + 'h' + -(cs - 4) + 'z';
        }
        const tess = buckets.map((d, i) => '<path d="' + d + '" fill="' + along(t, i / 6) + '"/>').join('');
        return '<defs>' + grainFilter('sk', r, 0.5, 2.2, { mottle: 0.2 }) + '</defs><g filter="url(#sk)">' + box(mix(t[0], '#000000', 0.45)) + tess + '</g>' + sheen('sh', 0.1) + vig('vg', 0.3);
      },

      // Tiles on a wall or floor. o.mode: subway (brick bond, glazed), hex, penny (round), square.
      tile(r, c, o) {
        const t = tones(c), mode = o.mode || 'subway', grout = o.grout || mix(t[0], t[1], 0.5);
        let tiles = '', gloss = '', defs = '';
        const buckets = ['', '', '', '', ''];
        const pick = (x, y, d) => { const k = Math.floor(Math.pow(r(), o.flat ? 3 : 1) * 5); buckets[o.flat ? 0 : k] += d; };
        if (mode === 'subway') {
          const bw = o.w || 150, bh = o.h || 70, g = 6;
          for (let j = 0; j * (bh + g) < H + bh; j++) for (let x = (j % 2 ? -bw / 2 - g / 2 : 0), i = 0; x < W; x += bw + g, i++) pick(x, j, 'M' + f(x + g / 2) + ' ' + (j * (bh + g) + g / 2) + 'h' + (bw - g) + 'v' + (bh - g) + 'h' + -(bw - g) + 'z');
          defs += lg('gl', 0, 0, 1, 1, [[0, '#ffffff', 0.35], [0.3, '#ffffff', 0.05], [0.6, '#000000', 0.0], [1, '#000000', 0.22]])
            + pat('gp', bw + g, (bh + g) * 2, '<rect x="' + g / 2 + '" y="' + g / 2 + '" width="' + (bw - g) + '" height="' + (bh - g) + '" rx="3" fill="url(#gl)"/><rect x="' + f(g / 2 - bw / 2 - g / 2 + bw + g) + '" y="' + (bh + g + g / 2) + '" width="' + (bw - g) + '" height="' + (bh - g) + '" rx="3" fill="url(#gl)"/><rect x="' + f(g / 2 - bw / 2 - g / 2) + '" y="' + (bh + g + g / 2) + '" width="' + (bw - g) + '" height="' + (bh - g) + '" rx="3" fill="url(#gl)"/>');
          gloss = fillOf('gp');
        } else if (mode === 'hex') {
          const s = o.s || 54, w = Math.sqrt(3) * s, hh = 1.5 * s;
          for (let j = -1; j * hh < H + s; j++) for (let i = -1; i * w < W + w; i++) {
            const cx = i * w + (j % 2 ? w / 2 : 0), cy = j * hh; let d = '';
            for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); d += (k ? 'L' : 'M') + f(cx + (s - 3) * Math.cos(a)) + ' ' + f(cy + (s - 3) * Math.sin(a)); }
            pick(cx, cy, d + 'Z');
          }
          defs += lg('gl', 0, 0, 1, 1, [[0, '#ffffff', 0.3], [0.5, '#ffffff', 0], [1, '#000000', 0.25]]);
          gloss = sheen('sh', 0.14);
        } else if (mode === 'penny') {
          const s = o.s || 34, w = s * 2;
          for (let j = -1; j * s * 1.732 < H + s; j++) for (let i = -1; i * w < W + w; i++) { const cx = i * w + (j % 2 ? s : 0), cy = j * s * 1.732; pick(cx, cy, 'M' + f(cx - s + 2) + ' ' + f(cy) + 'a' + (s - 2) + ' ' + (s - 2) + ' 0 1 0 ' + (2 * s - 4) + ' 0a' + (s - 2) + ' ' + (s - 2) + ' 0 1 0 ' + -(2 * s - 4) + ' 0z'); }
          gloss = sheen('sh', 0.12);
        } else {
          const s = o.s || 100, g = 6;
          for (let j = 0; j * s < H; j++) for (let i = 0; i * s < W; i++) pick(i, j, 'M' + (i * s + g / 2) + ' ' + (j * s + g / 2) + 'h' + (s - g) + 'v' + (s - g) + 'h' + -(s - g) + 'z');
          gloss = sheen('sh', 0.12);
        }
        tiles = buckets.map((d, i) => '<path d="' + d + '" fill="' + along(t.slice(1), 0.1 + i * 0.2) + '"/>').join('');
        return '<defs>' + defs + grainFilter('sk', r, 0.04, 1.0, { gain: 1.4, mottle: 0.2 }) + '</defs><g filter="url(#sk)">' + box(grout) + tiles + '</g>' + gloss + vig('vg', 0.25);
      },

    };

    // Seigaiha, the Japanese wave scales (o.fan: art deco fans with ribs); o.R is the radius of one wave.
    GEN.scales = function (r, c, o) {
      const t = tones(c), R = o.R || 56, rings = o.rings || 5, fan = !!o.fan;
      const cols = [t[1], t[2], t[3], t[2], t[3]];
      let tile = '';
      for (let k = -2; k <= 3; k++) for (let x = -2 * R; x <= 4 * R; x += 2 * R) {
        const cx = x + (k % 2 ? R : 0), cy = k * R / 2;
        for (let i = 0; i < rings; i++) {
          const rr = R * (1 - i / rings);
          tile += '<circle cx="' + cx + '" cy="' + cy + '" r="' + f(rr) + '" fill="' + (i === rings - 1 ? t[4] : cols[i % cols.length]) + '" stroke="' + (fan ? t[4] : t[4]) + '" stroke-opacity="' + (fan ? 0.9 : 0.55) + '" stroke-width="' + (fan ? 2.2 : 1.6) + '"/>';
        }
        if (fan) { let d = ''; for (let a = -80; a <= 80; a += 20) { const an = (a - 90) * Math.PI / 180; d += 'M' + f(cx + Math.cos(an) * R * 0.2) + ' ' + f(cy + Math.sin(an) * R * 0.2) + 'L' + f(cx + Math.cos(an) * R * 0.78) + ' ' + f(cy + Math.sin(an) * R * 0.78); } tile += '<path d="' + d + '" stroke="' + t[4] + '" stroke-opacity="0.7" stroke-width="1.4" fill="none"/>'; }
      }
      return '<defs>' + pat('sc', 2 * R, R, tile) + grainFilter('sk', r, o.grain || 0.55, 1.1, { mottle: 0.16 }) + '</defs><g filter="url(#sk)">' + box(t[0]) + fillOf('sc') + '</g>' + vig('vg', 0.25);
    };

    // Shippo: circles that overlap into four-pointed stars (the "seven treasures" lattice).
    GEN.shippo = function (r, c, o) {
      const t = tones(c), s = o.s || 96, rr = s / Math.SQRT2;
      let tile = '';
      for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) tile += '<circle cx="' + x + '" cy="' + y + '" r="' + f(rr) + '" fill="' + t[2] + '" fill-opacity="0.34" stroke="' + t[4] + '" stroke-opacity="0.9" stroke-width="2.2"/>';
      for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) tile += '<circle cx="' + x + '" cy="' + y + '" r="' + f(rr * 0.5) + '" fill="none" stroke="' + t[3] + '" stroke-opacity="0.7" stroke-width="1.6"/>';
      tile += '<path d="M' + P(s / 2, s / 2 - 12) + 'L' + P(s / 2 + 5, s / 2) + 'L' + P(s / 2, s / 2 + 12) + 'L' + P(s / 2 - 5, s / 2) + 'Z" fill="' + t[4] + '" fill-opacity="0.9"/>';
      return '<defs>' + pat('sp', s, s, tile) + grainFilter('sk', r, 0.5, 1.0, { mottle: 0.16 }) + '</defs><g filter="url(#sk)">' + box(t[0]) + fillOf('sp') + '</g>' + vig('vg', 0.25);
    };

    // Asanoha, the hemp-leaf lattice: every triangle holds a six-pointed star of lines.
    GEN.asanoha = function (r, c, o) {
      const t = tones(c), a = o.a || 84, h = a * Math.sqrt(3) / 2;
      const X = (i, j) => i * a + (j % 2 ? a / 2 : 0);
      let polys = '', lines = '';
      for (let j = 0; j < 2; j++) for (let i = -1; i <= 1; i++) {
        const tris = [
          [[X(i, j), j * h], [X(i + 1, j), j * h], [(X(i, j) + X(i + 1, j)) / 2, (j + 1) * h]],
          [[X(i, j + 1), (j + 1) * h], [X(i + 1, j + 1), (j + 1) * h], [(X(i, j + 1) + X(i + 1, j + 1)) / 2, j * h]],
        ];
        tris.forEach((tr, ti) => {
          const g = [(tr[0][0] + tr[1][0] + tr[2][0]) / 3, (tr[0][1] + tr[1][1] + tr[2][1]) / 3];
          for (let k = 0; k < 3; k++) {
            const v1 = tr[k], v2 = tr[(k + 1) % 3], m = [(v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2];
            polys += '<path d="M' + P(g[0], g[1]) + 'L' + P(v1[0], v1[1]) + 'L' + P(m[0], m[1]) + 'Z" fill="' + t[1 + (k + ti) % 2] + '"/><path d="M' + P(g[0], g[1]) + 'L' + P(m[0], m[1]) + 'L' + P(v2[0], v2[1]) + 'Z" fill="' + t[2 + (k + ti + 1) % 3 % 2] + '"/>';
            lines += 'M' + P(g[0], g[1]) + 'L' + P(v1[0], v1[1]) + 'M' + P(g[0], g[1]) + 'L' + P(m[0], m[1]);
          }
        });
      }
      return '<defs>' + pat('as', a, 2 * h, polys + '<path d="' + lines + '" stroke="' + t[4] + '" stroke-opacity="0.85" stroke-width="1.5" fill="none" stroke-linejoin="round"/>') + grainFilter('sk', r, 0.6, 1.0, { mottle: 0.12 }) + '</defs><g filter="url(#sk)">' + box(t[0]) + fillOf('as') + '</g>' + vig('vg', 0.28);
    };

    // Moroccan zellige: eight-pointed stars that touch tip to tip, two colours, with grout and a rosette in each.
    GEN.zellige = function (r, c, o) {
      const t = tones(c), s = o.s || 150, R = s / 2, Ri = R * (o.pinch || 0.58);
      const star = (cx, cy, rad, ri, rot) => { let d = ''; for (let k = 0; k < 16; k++) { const a = rot + k * Math.PI / 8, rr = k % 2 ? ri : rad; d += (k ? 'L' : 'M') + P(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } return d + 'Z'; };
      let tile = '';
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) {
        const x = i * s, y = j * s, par = (i + j) % 2;
        tile += '<path d="' + star(x, y, R, Ri, 0) + '" fill="' + (par ? t[3] : t[2]) + '" stroke="' + t[0] + '" stroke-width="3" stroke-linejoin="round"/>'
          + '<path d="' + star(x, y, R * 0.62, Ri * 0.62, Math.PI / 8) + '" fill="' + (par ? t[2] : t[3]) + '" stroke="' + t[0] + '" stroke-width="2" stroke-linejoin="round"/>'
          + '<circle cx="' + x + '" cy="' + y + '" r="' + f(R * 0.2) + '" fill="' + t[4] + '" stroke="' + t[0] + '" stroke-width="2"/>';
      }
      let diamonds = '';
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) { const cx = i * s + s / 2, cy = j * s + s / 2; diamonds += '<path d="M' + P(cx, cy - R * 0.3) + 'L' + P(cx + R * 0.3, cy) + 'L' + P(cx, cy + R * 0.3) + 'L' + P(cx - R * 0.3, cy) + 'Z" fill="' + t[1] + '" stroke="' + t[0] + '" stroke-width="2"/>'; }
      return '<defs>' + pat('zl', 2 * s, 2 * s, '<rect width="' + 2 * s + '" height="' + 2 * s + '" fill="' + t[0] + '"/>' + diamonds + tile) + grainFilter('sk', r, 0.05, 1.2, { gain: 1.6, mottle: 0.2 }) + '</defs><g filter="url(#sk)">' + fillOf('zl') + '</g>' + sheen('sh', 0.16) + vig('vg', 0.3);
    };

    // Iznik tile: a rosette, four tulips and curling leaves in cobalt, turquoise and red on a white ground.
    GEN.iznik = function (r, c, o) {
      const t = tones(c), T = o.T || 400, h = T / 2, ground = t[4], blue = t[1], turq = t[2], red = t[3], line = t[0];
      const tulip = (x, y, rot, sc) => '<g transform="translate(' + P(x, y) + ') rotate(' + rot + ') scale(' + sc + ')"><path d="M0 0C-16 -8 -22 -40 -10 -66L-5 -50L0 -72L5 -50L10 -66C22 -40 16 -8 0 0Z" fill="' + red + '" stroke="' + line + '" stroke-width="2.2"/><path d="M0 0C-5 -16 -4 -36 0 -56C4 -36 5 -16 0 0Z" fill="' + ground + '" fill-opacity="0.8"/><path d="M0 0L0 24" stroke="' + turq + '" stroke-width="3"/></g>';
      const leaf = (x, y, rot, sc) => '<g transform="translate(' + P(x, y) + ') rotate(' + rot + ') scale(' + sc + ')"><path d="M0 0C30 -30 56 -34 74 -20C58 -16 52 -6 56 8C34 8 12 6 0 0Z" fill="' + turq + '" stroke="' + line + '" stroke-width="2.2"/><path d="M4 -2C26 -16 48 -22 62 -14" stroke="' + blue + '" stroke-width="1.8" fill="none"/></g>';
      const rosette = (x, y, n, rad) => { let s = ''; for (let k = 0; k < n; k++) s += '<g transform="translate(' + P(x, y) + ') rotate(' + f(k * 360 / n) + ')"><path d="M0 -' + f(rad * 0.22) + 'C' + f(rad * 0.2) + ' -' + f(rad * 0.4) + ' ' + f(rad * 0.18) + ' -' + f(rad * 0.8) + ' 0 -' + f(rad) + 'C-' + f(rad * 0.18) + ' -' + f(rad * 0.8) + ' -' + f(rad * 0.2) + ' -' + f(rad * 0.4) + ' 0 -' + f(rad * 0.22) + 'Z" fill="' + (k % 2 ? blue : turq) + '" stroke="' + line + '" stroke-width="2"/></g>'; return s + '<circle cx="' + x + '" cy="' + y + '" r="' + f(rad * 0.24) + '" fill="' + red + '" stroke="' + line + '" stroke-width="2.4"/><circle cx="' + x + '" cy="' + y + '" r="' + f(rad * 0.1) + '" fill="' + ground + '"/>'; };
      let tile = '<rect width="' + T + '" height="' + T + '" fill="' + ground + '"/>';
      for (const [dx, dy] of [[0, 0], [T, 0], [0, T], [T, T]]) tile += rosette(dx, dy, 12, h * 0.62);
      tile += rosette(h, h, 16, h * 0.55);
      for (const [x, y, rot] of [[h, 0, 180], [h, T, 0], [0, h, 90], [T, h, 270]]) tile += tulip(x, y, rot, 1.5);
      for (const [x, y, rot] of [[h - 70, h - 70, 200], [h + 70, h - 70, 290], [h + 70, h + 70, 20], [h - 70, h + 70, 110]]) tile += leaf(x, y, rot, 1.05);
      tile += '<rect x="3" y="3" width="' + (T - 6) + '" height="' + (T - 6) + '" fill="none" stroke="' + blue + '" stroke-width="5"/><rect x="12" y="12" width="' + (T - 24) + '" height="' + (T - 24) + '" fill="none" stroke="' + turq + '" stroke-width="2"/>';
      return '<defs>' + pat('iz', T, T, tile) + grainFilter('sk', r, 0.05, 1.3, { gain: 1.6, mottle: 0.22 }) + '</defs><g filter="url(#sk)">' + fillOf('iz') + '</g>' + sheen('sh', 0.18) + vig('vg', 0.18);
    };

    // Kilim: bands of stepped diamonds, zigzags, hooks and stripes, woven in a few colours.
    GEN.kilim = function (r, c, o) {
      const t = tones(c), u = o.u || 14;
      const kinds = ['diamond', 'zigzag', 'hooks', 'stripe', 'chain', 'tri'];
      let defs = '', body = '', y = 0, n = 0;
      while (y < H) {
        const kind = kinds[Math.floor(r() * kinds.length)], rows = kind === 'stripe' ? 2 + Math.floor(r() * 2) : kind === 'diamond' ? 11 + 2 * Math.floor(r() * 3) : 6 + Math.floor(r() * 4), cols = kind === 'diamond' ? rows + 1 : kind === 'chain' ? 8 : 12;
        const ground = 1 + Math.floor(r() * 3), a = (ground + 2 + Math.floor(r() * 2)) % 5, b = (a + 1 + Math.floor(r() * 3)) % 5;
        let cells = '';
        for (let j = 0; j < rows; j++) {
          let run = 0, cur = -1, x0 = 0;
          const col = (i) => {
            const cx = cols / 2 - 0.5, dx = Math.abs(i - cx), dy = Math.abs(j - (rows - 1) / 2);
            if (kind === 'diamond') return dx + dy <= (rows - 1) / 2 ? (Math.floor(dx + dy) % 2 ? a : b) : ground;
            if (kind === 'zigzag') return (Math.abs(((i + j) % 8) - 4) < 2) ? a : ground;
            if (kind === 'hooks') return ((i % 6 < 3 && j === 0) || (i % 6 === 2 && j < rows - 1) || (i % 6 >= 3 && j >= rows - 2) || (i % 6 === 3 && j > 0)) ? a : ground;
            if (kind === 'chain') return (Math.abs(i - cx) + Math.abs(j - (rows - 1) / 2) < (rows / 2 - 0.5) && (i + j) % 2 === 0) ? a : (Math.abs(i - cx) < 1 ? b : ground);
            if (kind === 'tri') return (i % 6) < (j + 1) * 6 / rows ? a : ground;
            return j % 2 ? a : ground;
          };
          const emit = () => { if (cur >= 0 && run) cells += '<rect x="' + x0 * u + '" y="' + j * u + '" width="' + run * u + '" height="' + u + '" fill="' + t[cur] + '"/>'; };
          for (let i = 0; i < cols; i++) {
            const v = col(i);
            if (v !== cur) { emit(); cur = v; x0 = i; run = 0; }
            run++;
          }
          emit();
        }
        const id = 'k' + n++, bandH = rows * u;
        defs += pat(id, cols * u, bandH, '<rect width="' + cols * u + '" height="' + bandH + '" fill="' + t[ground] + '"/>' + cells);
        body += '<rect y="' + y + '" width="' + W + '" height="' + bandH + '" fill="url(#' + id + ')"/>';
        y += bandH;
        const sep = 1 + Math.floor(r() * 2);
        body += '<rect y="' + y + '" width="' + W + '" height="' + sep * u + '" fill="' + t[Math.floor(r() * 5)] + '"/>';
        y += sep * u;
      }
      const weave = pat('wv', 5, 5, '<path d="M0 2.5H5" stroke="#000000" stroke-opacity="0.2" stroke-width="1.4"/><path d="M2.5 0V5" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1"/>');
      const wob = fil('wb', turb('n', 'fractalNoise', 0.06, 0.06, 2, seedOf(r)) + '<feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/>' + turb('g', 'fractalNoise', 0.8, 0.35, 2, seedOf(r)) + gray('g', 'gg', 1.3, -0.15) + lit('d', 'gg', 'out', 1.3, 225, 58), 8);
      return '<defs>' + defs + weave + wob + '</defs><g filter="url(#wb)">' + box(t[1]) + body + '</g>' + fillOf('wv') + vig('vg', 0.3);
    };

    // Ikat: nested diamonds whose edges feather, as if the yarn was dyed before it was woven.
    GEN.ikat = function (r, c, o) {
      const t = tones(c), S = o.S || 260, n = 5;
      let d = '', tile = '<rect width="' + S + '" height="' + S + '" fill="' + t[0] + '"/>';
      for (let k = 0; k < n; k++) {
        const rr = S / 2 * (1 - k / n) * 1.02;
        for (const [cx, cy] of [[S / 2, S / 2], [0, 0], [S, 0], [0, S], [S, S]]) tile += '<path d="M' + P(cx, cy - rr) + 'L' + P(cx + rr, cy) + 'L' + P(cx, cy + rr) + 'L' + P(cx - rr, cy) + 'Z" fill="' + t[[4, 2, 3, 1, 4][k]] + '"/>';
      }
      for (let k = 0; k < 6; k++) tile += '<rect x="' + (k * S / 6 + 6) + '" y="' + (S / 2 - 4) + '" width="8" height="8" fill="' + t[0] + '"/>';
      const inner = '<feGaussianBlur in="SourceGraphic" stdDeviation="6 0.8" result="b"/>' + turb('n', 'fractalNoise', 0.02, 0.4, 2, seedOf(r)) + '<feDisplacementMap in="b" in2="n" scale="14" xChannelSelector="R" yChannelSelector="B" result="d"/>'
        + turb('g', 'fractalNoise', 0.9, 0.3, 2, seedOf(r)) + gray('g', 'gg', 1.3, -0.15) + lit('d', 'gg', 'out', 1.2, 225, 58);
      return '<defs>' + pat('ik', S, S, tile) + fil('ikf', inner, 10) + '</defs><g filter="url(#ikf)"><rect x="-10" y="-10" width="' + (W + 20) + '" height="' + (H + 20) + '" fill="url(#ik)"/></g>' + vig('vg', 0.3);
    };

    // Art deco. o.mode: burst (a sunburst rising from the bottom), steps (nested stepped chevrons).
    GEN.deco = function (r, c, o) {
      const t = tones(c), mode = o.mode || 'burst';
      if (mode === 'burst') {
        const cx = W / 2, cy = H + 60, n = o.n || 28;
        let rays = '', arcs = '';
        for (let k = 0; k < n; k++) {
          const a0 = Math.PI + k * Math.PI / n, a1 = a0 + Math.PI / n;
          rays += '<path d="M' + P(cx, cy) + 'L' + P(cx + Math.cos(a0) * 2000, cy + Math.sin(a0) * 2000) + 'L' + P(cx + Math.cos(a1) * 2000, cy + Math.sin(a1) * 2000) + 'Z" fill="' + (k % 2 ? t[1] : t[2]) + '"/>';
        }
        for (let k = 1; k < 9; k++) arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + k * 120 + '" fill="none" stroke="' + t[4] + '" stroke-opacity="' + (k % 2 ? 0.85 : 0.5) + '" stroke-width="' + (k % 2 ? 3 : 1.5) + '"/>';
        return '<defs>' + grainFilter('sk', r, 0.5, 1.0, { mottle: 0.12 }) + rg('hl', 0.5, 1, 0.9, [[0, t[4], 0.5], [1, t[4], 0]]) + '</defs><g filter="url(#sk)">' + box(t[0]) + rays + '</g>' + box('url(#hl)') + arcs
          + '<circle cx="' + cx + '" cy="' + cy + '" r="150" fill="' + t[0] + '" stroke="' + t[4] + '" stroke-width="5"/>' + vig('vg', 0.3);
      }
      const w = 132, hh = 66, st = 12;
      let tile = '<rect width="' + w + '" height="' + hh + '" fill="' + t[0] + '"/>';
      for (let k = 0; k < 5; k++) {
        let d = '';
        for (const oy of [-hh, 0, hh]) { const y0 = oy + hh - k * 8; d += 'M-2 ' + (y0 + 40); for (let i = 0; i < 3; i++) d += 'h' + (w / 2 / 3) + 'v' + -st; for (let i = 0; i < 3; i++) d += 'h' + (w / 2 / 3) + 'v' + st; }
        tile += '<path d="' + d + '" fill="none" stroke="' + t[k < 2 ? 4 : 3] + '" stroke-opacity="' + f(0.95 - k * 0.15) + '" stroke-width="' + (k === 0 ? 3.2 : 2) + '" stroke-linejoin="miter"/>';
      }
      return '<defs>' + pat('ds', w, hh, tile) + grainFilter('sk', r, 0.5, 1.0, { mottle: 0.12 }) + '</defs><g filter="url(#sk)">' + fillOf('ds') + '</g>' + vig('vg', 0.3);
    };

    // Mid-century modern: boomerangs, starbursts and soft blobs scattered over a plain ground.
    GEN.midcentury = function (r, c, o) {
      const t = tones(c), light = !!o.light, ground = light ? t[4] : t[0], inks = light ? [t[0], t[1], t[2], t[3]] : [t[1], t[2], t[3], t[4]];
      let body = '';
      const blob = (cx, cy, rad, col, op) => { const m = 9, pts = []; for (let i = 0; i < m; i++) { const a = i / m * 6.28, rr = rad * (0.7 + r() * 0.5); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } let d = 'M' + P((pts[m - 1][0] + pts[0][0]) / 2, (pts[m - 1][1] + pts[0][1]) / 2); for (let i = 0; i < m; i++) { const nx = pts[(i + 1) % m]; d += 'Q' + P(pts[i][0], pts[i][1]) + ' ' + P((pts[i][0] + nx[0]) / 2, (pts[i][1] + nx[1]) / 2); } return '<path d="' + d + 'Z" fill="' + col + '" fill-opacity="' + op + '"/>'; };
      for (let i = 0; i < 9; i++) body += blob(r() * W, r() * H, 110 + r() * 150, inks[Math.floor(r() * 4)], 0.22);
      const cols = 11, rows = 6;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = (i + 0.5 + (r() - 0.5) * 0.5) * W / cols, y = (j + 0.5 + (r() - 0.5) * 0.5) * H / rows, s = 0.7 + r() * 0.7, rot = r() * 360, col = inks[Math.floor(r() * 4)], k = Math.floor(r() * 4);
        const tf = ' transform="translate(' + P(x, y) + ') rotate(' + f(rot) + ') scale(' + f(s) + ')"';
        if (k === 0) body += '<path d="M-44 8C-24 -30 24 -30 44 8C22 -6 -22 -6 -44 8Z"' + tf + ' fill="' + col + '"/>';
        else if (k === 1) { let d = ''; for (let a = 0; a < 8; a++) { const an = a * Math.PI / 4; d += 'M0 0L' + P(Math.cos(an) * 30, Math.sin(an) * 30); } body += '<g' + tf + '><path d="' + d + '" stroke="' + col + '" stroke-width="3" stroke-linecap="round"/>' + [0, 1, 2, 3, 4, 5, 6, 7].map(a => '<circle cx="' + f(Math.cos(a * Math.PI / 4) * 36) + '" cy="' + f(Math.sin(a * Math.PI / 4) * 36) + '" r="4.5" fill="' + col + '"/>').join('') + '<circle r="7" fill="' + col + '"/></g>'; }
        else if (k === 2) body += '<g' + tf + '><circle r="16" fill="none" stroke="' + col + '" stroke-width="5"/><circle r="5" fill="' + col + '"/></g>';
        else body += '<path d="M0 -30C22 -14 22 14 0 30C-22 14 -22 -14 0 -30Z"' + tf + ' fill="' + col + '"/>';
      }
      return '<defs>' + grainFilter('sk', r, 0.6, 0.9, { mottle: 0.1 }) + '</defs><g filter="url(#sk)">' + box(ground) + body + '</g>' + vig('vg', 0.16);
    };

    // Chevron stripes. o.n: how many colours; o.w: width of one zigzag.
    GEN.chevron = function (r, c, o) {
      const t = tones(c), w = o.w || 160, d = o.d || 56, sh = o.sh || 24, n = o.n || 5, per = n * sh;
      let tile = '';
      for (let k = -1; k < 2; k++) for (let i = 0; i < n; i++) {
        const y = k * per + i * sh;
        tile += '<path d="M0 ' + y + 'L' + P(w / 2, y + d) + 'L' + P(w, y) + 'V' + (y + sh) + 'L' + P(w / 2, y + d + sh) + 'L0 ' + (y + sh) + 'Z" fill="' + t[(i + (o.shift || 0)) % 5] + '"/>';
      }
      return '<defs>' + pat('ch', w, per, tile) + grainFilter('sk', r, o.grain || 0.5, 1.2, { mottle: 0.14 }) + '</defs><g filter="url(#sk)">' + fillOf('ch') + '</g>' + vig('vg', 0.22);
    };

    G.extend(GEN);
    const api = { voronoi };
    if (typeof window !== 'undefined') window.WallpaperPatterns = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = { WallpaperPatterns: api };

  }

  const have = root.WallpaperGenerators && root.WallpaperGenerators.kit ? root.WallpaperGenerators : (typeof require === 'function' ? (require('./wallpaper-materials.js'), require('./wallpaper-generators.js').WallpaperGenerators) : null);
  if (have) build(have);
  else if (root.VexLazy) {
    // The generators and the materials file may still be on their way: load both, then wait for the toolkit the materials file puts on the generators.
    const ready = () => root.WallpaperGenerators && root.WallpaperGenerators.kit;
    root.VexLazy.ensure('js/wallpaper-generators.js').then(() => root.VexLazy.ensure('js/wallpaper-materials.js')).then(() => {
      let tries = 0;
      const wait = () => {
        if (ready()) { build(root.WallpaperGenerators); return; }
        if (++tries > 250) throw new Error('js/wallpaper-materials.js did not set up its toolkit, so js/wallpaper-patterns.js has nothing to draw with');
        setTimeout(wait, 20);
      };
      wait();
    });
  }
  else throw new Error('js/wallpaper-materials.js must be loaded before js/wallpaper-patterns.js');
})(typeof window !== 'undefined' ? window : globalThis);
