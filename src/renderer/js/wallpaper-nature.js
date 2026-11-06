// === Sky, water, landscape and botanical prints, drawn by code (Wallpaper Store) =========
//
// Clouds, pool-light and rain on glass, city bokeh, nebulae, aurora over snow, misty pine
// forests, sand dunes, and repeating leaf prints (palm, fern, monstera, ginkgo, olive,
// eucalyptus, banana, daisies). Each is a small SVG made from an id, a seed and five colours
// (dark to light after sorting), the same every time. See js/wallpaper-generators.js.
//
// Loads after js/wallpaper-materials.js and js/wallpaper-patterns.js.

(function (root) {
  'use strict';

  // Files that load late (js/lazy-boot.js) can arrive in any order: this one waits for the materials toolkit if it is not here yet.
  function build(G) {
    const K = G.kit;
    const { f, mix, along, WIDTH: W, HEIGHT: H } = G;
    const { tones, turb, gray, soft, arith, lit, fil, lg, rg, box, seedOf, sheen, vig, toAlpha, diffuse, tint, curve, merge, veilOf, wave } = K;

    const P = (x, y) => f(x) + ' ' + f(y);
    const blurDef = (id, sd) => '<filter id="' + id + '" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="' + sd + '"/></filter>';
    const starField = (r, t, n, big) => {
      let s = '';
      for (let i = 0; i < n; i++) {
        const b = r() < big;
        s += '<circle cx="' + f(r() * W) + '" cy="' + f(r() * H) + '" r="' + f(b ? 1.5 + r() * 1.2 : 0.5 + r() * 0.9) + '" fill="' + (r() < 0.25 ? t[4] : '#ffffff') + '" fill-opacity="' + f(0.35 + r() * 0.65) + '"/>';
      }
      return s;
    };

    const GEN = {
      // Sky with clouds. o.cirrus: long thin streaks; o.cover: more (>0) or less (<0) cloud; o.sun: a low sun on the horizon.
      clouds(r, c, o) {
        const t = tones(c), cover = o.cover || 0, cir = !!o.cirrus;
        const inner = turb('n', 'fractalNoise', cir ? 0.0009 : 0.0016, cir ? 0.0065 : 0.0034, cir ? 4 : 5, seedOf(r)) + gray('n', 'g', 2.2, -0.82 + cover) + curve('g', 'd0', [0, 0, 0.02, 0.18, 0.5, 0.82, 0.96, 1, 1])
          + '<feGaussianBlur in="d0" stdDeviation="' + (cir ? 2 : 4) + '" result="d"/>' + toAlpha('d', 'dh') + diffuse('dh', 'L', cir ? 2 : 4, 300, 42) + tint('L', 'cc', [t[1], t[2], t[3], t[4], t[4]]) + '<feComposite in="cc" in2="dh" operator="in" result="out"/>';
        const sky = lg('sk', 0, 0, 0, 1, [[0, t[0]], [0.55, mix(t[0], t[2], 0.6)], [1, mix(t[2], t[3], 0.5)]]) + (o.sun ? rg('sn', o.sx || 0.7, 0.86, 0.45, [[0, t[4], 0.9], [0.3, t[3], 0.35], [1, t[3], 0]]) : '');
        return '<defs>' + sky + fil('c', inner) + '</defs>' + box('url(#sk)') + (o.sun ? box('url(#sn)') : '') + K.sheet('c');
      },

      // Light dancing on the floor of a pool.
      water(r, c, o) {
        const t = tones(c), mode = o.mode || 'caustic';
        if (mode === 'caustic') {
          const inner = turb('a', 'turbulence', 0.011, 0.014, 2, seedOf(r)) + gray('a', 'ag', -2.3, 1.05) + curve('ag', 'as', [0, 0, 0.05, 0.3, 0.8, 1])
            + turb('b', 'turbulence', 0.017, 0.012, 2, seedOf(r)) + gray('b', 'bg', -2.3, 1.05) + curve('bg', 'bs', [0, 0, 0.05, 0.3, 0.8, 1])
            + arith('as', 'bs', 'sum', 0, 0.62, 0.55, 0) + turb('c', 'fractalNoise', 0.002, 0.002, 3, seedOf(r)) + gray('c', 'cg', 0.8, 0.0) + arith('sum', 'cg', 'mx', 0, 0.8, 0.5, -0.2)
            + tint('mx', 'out', [t[0], t[1], t[2], t[3], t[4], t[4]]);
          return '<defs>' + fil('w', inner) + rg('li', 0.5, 0, 0.9, [[0, '#ffffff', 0.25], [1, '#ffffff', 0]]) + '</defs>' + K.sheet('w') + box('url(#li)') + vig('vg', 0.3);
        }
        throw new Error('Unknown water mode: ' + mode);
      },

      // Rain running down a window, with a night city blurred behind it.
      rain(r, c, o) {
        const t = tones(c);
        let blobs = '', drops = '', trails = '';
        for (let i = 0; i < 26; i++) blobs += '<circle cx="' + f(r() * W) + '" cy="' + f(H * 0.25 + r() * H * 0.75) + '" r="' + f(24 + r() * 90) + '" fill="' + t[2 + Math.floor(r() * 3)] + '" fill-opacity="' + f(0.25 + r() * 0.45) + '"/>';
        for (let i = 0; i < 52; i++) {
          const x = r() * W, y = r() * H, rr = 7 + Math.pow(r(), 2) * 28, col = t[2 + Math.floor(r() * 3)];
          if (rr > 13 && r() < 0.5) trails += '<path d="M' + P(x, y - rr) + 'V' + f(y - rr - 30 - r() * 120) + '" stroke="#ffffff" stroke-opacity="0.07" stroke-width="' + f(rr * 0.5) + '" stroke-linecap="round"/>';
          drops += '<g transform="translate(' + P(x, y) + ')"><ellipse rx="' + f(rr * 0.82) + '" ry="' + f(rr) + '" fill="url(#dg)" stroke="#ffffff" stroke-opacity="0.22" stroke-width="0.8"/><ellipse cx="0" cy="' + f(rr * 0.12) + '" rx="' + f(rr * 0.45) + '" ry="' + f(rr * 0.42) + '" fill="' + col + '" fill-opacity="0.5"/><ellipse cx="' + f(-rr * 0.28) + '" cy="' + f(-rr * 0.45) + '" rx="' + f(rr * 0.18) + '" ry="' + f(rr * 0.12) + '" fill="#ffffff" fill-opacity="0.65"/></g>';
        }
        return '<defs>' + lg('bg', 0, 0, 0, 1, [[0, t[0]], [1, t[1]]]) + blurDef('bl', 22) + blurDef('fr', 5) + rg('dg', 0.5, 0.5, 0.5, [[0, '#ffffff', 0.04], [0.7, '#000000', 0.05], [1, '#000000', 0.42]]) + '</defs>'
          + box('url(#bg)') + '<g filter="url(#bl)">' + blobs + '</g>' + '<rect width="' + W + '" height="' + H + '" fill="' + t[1] + '" fill-opacity="0.18"/>' + trails + drops + vig('vg', 0.3);
      },

      // Out-of-focus city lights at night.
      citylights(r, c, o) {
        const t = tones(c);
        let far = '', mid = '', near = '';
        for (let i = 0; i < 70; i++) far += '<circle cx="' + f(r() * W) + '" cy="' + f(H * 0.3 + r() * H * 0.7) + '" r="' + f(8 + r() * 22) + '" fill="' + t[2 + Math.floor(r() * 3)] + '" fill-opacity="' + f(0.3 + r() * 0.4) + '"/>';
        for (let i = 0; i < 34; i++) mid += '<circle cx="' + f(r() * W) + '" cy="' + f(H * 0.2 + r() * H * 0.8) + '" r="' + f(26 + r() * 46) + '" fill="' + t[2 + Math.floor(r() * 3)] + '" fill-opacity="' + f(0.25 + r() * 0.35) + '"/>';
        for (let i = 0; i < 12; i++) { const rr = 70 + r() * 80, x = r() * W, y = r() * H; near += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(rr) + '" fill="' + t[2 + Math.floor(r() * 3)] + '" fill-opacity="0.22"/><circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(rr) + '" fill="none" stroke="' + t[4] + '" stroke-opacity="0.3" stroke-width="3"/>'; }
        return '<defs>' + lg('bg', 0, 0, 0, 1, [[0, t[0]], [0.6, t[1]], [1, mix(t[1], t[2], 0.5)]]) + blurDef('b1', 3) + blurDef('b2', 8) + blurDef('b3', 14) + rg('hz', 0.5, 1, 0.9, [[0, t[3], 0.4], [1, t[3], 0]]) + '</defs>'
          + box('url(#bg)') + box('url(#hz)') + '<g filter="url(#b1)">' + far + '</g><g filter="url(#b2)">' + mid + '</g><g filter="url(#b3)">' + near + '</g>' + vig('vg', 0.35);
      },

      // A nebula: glowing gas and dust lanes among the stars. o.band: a Milky Way across the picture.
      nebula(r, c, o) {
        const t = tones(c);
        const layer = (id, seed, fx, col) => turb(id + 'n', 'fractalNoise', fx, fx * 1.2, 5, seed) + gray(id + 'n', id + 'g', 2.3, -0.5) + curve(id + 'g', id + 'c', [0, 0, 0.06, 0.28, 0.62, 0.9, 1])
          + toAlpha(id + 'c', id + 'a') + tint(id + 'c', id + 'x', col) + '<feComposite in="' + id + 'x" in2="' + id + 'a" operator="in" result="' + id + 'o"/>';
        const inner = layer('p', seedOf(r), 0.0021, [t[1], t[2], t[3], t[4]]) + layer('q', seedOf(r), 0.0034, [t[1], t[1], t[2], t[3]]) + turb('d', 'fractalNoise', 0.004, 0.006, 4, seedOf(r)) + gray('d', 'dg', 2.6, -0.8)
          + veilOf('dg', 'dv', '#000000', 1.0, 0) + merge('out', ['po', 'qo', 'dv']);
        const mask = o.band ? '<mask id="mk"><rect width="' + W + '" height="' + H + '" fill="#000"/><g filter="url(#bm)"><ellipse cx="800" cy="450" rx="1100" ry="170" transform="rotate(' + (o.tilt || -24) + ' 800 450)" fill="#fff"/></g></mask>' + blurDef('bm', 60) : '';
        const nebula = '<g' + (o.band ? ' mask="url(#mk)"' : '') + '>' + K.sheet('n') + '</g>';
        return '<defs>' + rg('bg', 0.5, 0.4, 0.9, [[0, t[0]], [1, mix(t[0], '#000000', 0.7)]]) + fil('n', inner) + mask + '</defs>' + box('url(#bg)') + nebula + starField(r, t, o.stars || 340, 0.05);
      },

      // Aurora curtains over a snowy ridge with pines.
      aurora(r, c, o) {
        const t = tones(c), cols = [t[3], t[4], t[2]];
        let defs = lg('sky', 0, 0, 0, 1, [[0, mix(t[0], '#000000', 0.5)], [0.6, t[0]], [1, t[1]]]) + blurDef('bl', 16) + blurDef('bs', 4);
        let curtains = '';
        for (let k = 0; k < 3; k++) {
          const col = cols[k], y0 = H * (0.22 + k * 0.07), ph = r() * 6.28, amp = 40 + r() * 50, fq = 0.004 + r() * 0.004, hgt = 230 + r() * 140;
          defs += lg('au' + k, 0, 0, 0, 1, [[0, col, 0], [0.35, col, 0.8], [1, col, 0]]);
          let top = '', bot = '';
          for (let x = -20; x <= W + 20; x += 20) { const y = y0 + Math.sin(x * fq + ph) * amp + Math.sin(x * fq * 2.3 + ph) * amp * 0.4; top += (x < 0 ? 'M' : 'L') + P(x, y); bot = 'L' + P(x, y + hgt) + bot; }
          curtains += '<g filter="url(#bl)"><path d="' + top + bot + 'Z" fill="url(#au' + k + ')" fill-opacity="0.8"/></g>';
          let rays = '';
          for (let x = 0; x < W; x += 9 + r() * 12) { const y = y0 + Math.sin(x * fq + ph) * amp + Math.sin(x * fq * 2.3 + ph) * amp * 0.4; rays += 'M' + P(x, y + 20) + 'V' + f(y + hgt * (0.6 + r() * 0.5)); }
          curtains += '<g filter="url(#bs)"><path d="' + rays + '" stroke="' + col + '" stroke-opacity="0.22" stroke-width="3" fill="none"/></g>';
        }
        let ground = '', trees = '';
        for (let k = 0; k < 3; k++) {
          const base = H * (0.72 + k * 0.09), ph = r() * 6.28, amp = 28 - k * 4;
          let d = 'M0 ' + H;
          for (let x = 0; x <= W; x += 16) d += 'L' + P(x, base - Math.abs(Math.sin(x * 0.0038 + ph)) * amp - Math.sin(x * 0.011 + ph) * 8);
          ground += '<path d="' + d + 'L' + W + ' ' + H + 'Z" fill="url(#sn' + k + ')"/>';
          defs += lg('sn' + k, 0, 0, 0, 1, [[0, mix(t[4], t[2], 0.25 + k * 0.2)], [1, mix(t[1], t[2], 0.3)]]);
          if (k < 2) for (let i = 0; i < 20; i++) {
            const x = r() * W, y = base - Math.abs(Math.sin(x * 0.0038 + ph)) * amp - Math.sin(x * 0.011 + ph) * 8 + 4, hh = 40 + r() * 70 - k * 20;
            trees += '<path d="M' + P(x, y) + 'l' + f(-hh * 0.2) + ' 0l' + f(hh * 0.06) + ' ' + f(-hh * 0.3) + 'l' + f(-hh * 0.12) + ' 0l' + f(hh * 0.07) + ' ' + f(-hh * 0.3) + 'l' + f(-hh * 0.09) + ' 0l' + f(hh * 0.18) + ' ' + f(-hh * 0.4) + 'l' + f(hh * 0.18) + ' ' + f(hh * 0.4) + 'l' + f(-hh * 0.09) + ' 0l' + f(hh * 0.07) + ' ' + f(hh * 0.3) + 'l' + f(-hh * 0.12) + ' 0l' + f(hh * 0.06) + ' ' + f(hh * 0.3) + 'Z" fill="' + mix(t[0], '#000000', 0.5) + '"/>';
          }
        }
        return '<defs>' + defs + rg('gl', 0.5, 0.9, 0.7, [[0, t[3], 0.25], [1, t[3], 0]]) + '</defs>' + box('url(#sky)') + starField(r, t, 160, 0.03) + curtains + ground + trees + box('url(#gl)') + vig('vg', 0.3);
      },

      // Pine forest in mist: layers of fir trees fading into fog.
      pines(r, c, o) {
        const t = tones(c), n = o.layers || 5;
        let s = '<defs>' + lg('sky', 0, 0, 0, 1, [[0, t[3]], [1, t[4]]]) + lg('fg', 0, 0, 0, 1, [[0, t[4], 0], [0.5, t[4], 0.6], [1, t[4], 0]]) + rg('sun', o.sx || 0.7, 0.38, 0.5, [[0, '#ffffff', 0.6], [1, '#ffffff', 0]]) + '</defs>' + box('url(#sky)') + box('url(#sun)');
        for (let k = 0; k < n; k++) {
          const base = H * (0.52 + k * 0.1), depth = k / (n - 1), col = mix(mix(t[3], t[2], 0.5), t[0], 0.1 + depth * 0.9), size = 70 + k * 36;
          let d = 'M0 ' + H + 'V' + f(base);
          for (let x = -30; x < W + 40; x += size * (0.5 + r() * 0.45)) {
            const hh = size * (0.9 + r() * 1.6), w = hh * 0.34, y = base + r() * 12;
            d += 'L' + P(x - w, y) + 'L' + P(x - w * 0.55, y - hh * 0.3) + 'L' + P(x - w * 0.8, y - hh * 0.3) + 'L' + P(x - w * 0.4, y - hh * 0.62) + 'L' + P(x - w * 0.6, y - hh * 0.62) + 'L' + P(x, y - hh) + 'L' + P(x + w * 0.6, y - hh * 0.62) + 'L' + P(x + w * 0.4, y - hh * 0.62) + 'L' + P(x + w * 0.8, y - hh * 0.3) + 'L' + P(x + w * 0.55, y - hh * 0.3) + 'L' + P(x + w, y);
          }
          s += '<path d="' + d + 'V' + H + 'Z" fill="' + col + '"/><rect y="' + f(base - size * 1.2) + '" width="' + W + '" height="' + f(size * 1.9) + '" fill="url(#fg)" opacity="' + f(0.9 - depth * 0.5) + '"/>';
        }
        return s + vig('vg', 0.2);
      },

      // Sand dunes at golden hour: long soft ridges, each lit on top and shaded below, with wind ripples. o.sx: where the sun is.
      dunes(r, c, o) {
        const t = tones(c), n = o.layers || 5;
        let defs = lg('sky', 0, 0, 0, 1, [[0, t[3]], [1, mix(t[4], t[3], 0.3)]]) + rg('sun', o.sx || 0.25, 0.5, 0.6, [[0, '#ffffff', 0.7], [1, '#ffffff', 0]]), body = '';
        for (let k = 0; k < n; k++) {
          const base = H * (0.42 + k * 0.11), A = 34 + k * 12, f1 = 0.0028 + r() * 0.0014, ph = r() * 6.28, f2 = f1 * 2.3, ph2 = r() * 6.28, depth = k / (n - 1);
          const top = mix(t[4], t[3], 0.2 + depth * 0.5), bottom = mix(t[1], t[0], 0.1 + depth * 0.7);
          defs += lg('dg' + k, 0, 0, 0, 1, [[0, top], [0.35, mix(top, bottom, 0.45)], [1, bottom]]);
          let d = 'M0 ' + H;
          for (let x = 0; x <= W; x += 10) { const th = x * f1 + ph, y = base - A * (0.5 + 0.5 * Math.sin(th + 0.7 * Math.sin(th))) - 10 * Math.sin(x * f2 + ph2); d += 'L' + x + ' ' + f(y); }
          body += '<path d="' + d + 'V' + H + 'Z" fill="url(#dg' + k + ')"/><path d="' + d.slice(d.indexOf('L')) + '" fill="none" stroke="' + t[4] + '" stroke-opacity="' + f(0.55 - depth * 0.3) + '" stroke-width="2"/>';
        }
        const rip = fil('rp', turb('a', 'fractalNoise', 0.004, 0.16, 2, seedOf(r)) + gray('a', 'ag', 1.2, -0.1) + lit('SourceGraphic', 'ag', 'out', 0.4, 215, 55));
        return '<defs>' + defs + rip + '</defs>' + box('url(#sky)') + box('url(#sun)') + '<g filter="url(#rp)">' + body + '</g>' + vig('vg', 0.2);
      },
    };

    // --- botanical repeat prints ------------------------------------------------------------------

    const lens = (len, wid) => 'M0 0C' + f(wid * 0.9) + ' ' + f(-len * 0.28) + ' ' + f(wid * 0.9) + ' ' + f(-len * 0.72) + ' 0 ' + f(-len) + 'C' + f(-wid * 0.9) + ' ' + f(-len * 0.72) + ' ' + f(-wid * 0.9) + ' ' + f(-len * 0.28) + ' 0 0Z';
    const rot = (px, py, a, d) => [px + Math.cos(a) * d, py + Math.sin(a) * d];

    // Each shape draws itself pointing up from (0,0): returns [markup in two layers: fill paths, line paths]; col = fill colour.
    const SHAPES = {
      palm(r, col, line) {
        let fills = '', lines = 'M0 0Q8 -90 -14 -170';
        const N = 7;
        for (let i = 1; i <= N; i++) {
          const u = i / (N + 1), px = 8 * 2 * u * (1 - u) * 2 - 14 * u * u, py = -170 * u, len = 82 * Math.sin(Math.PI * (0.2 + 0.8 * (1 - u))) + 16;
          for (const s of [-1, 1]) { const a = s * (1.1 - u * 0.35); fills += '<path transform="translate(' + P(px, py) + ') rotate(' + f(a * 57.3) + ')" d="' + lens(len, 9) + '"/>'; }
        }
        fills += '<path d="' + lens(46, 8) + '" transform="translate(-14 -170) rotate(-6)"/>';
        return '<g fill="' + col + '">' + fills + '</g><path d="' + lines + '" stroke="' + line + '" stroke-width="3" fill="none"/>';
      },
      fern(r, col, line) {
        let fills = '';
        const N = 9;
        for (let i = 1; i <= N; i++) { const u = i / (N + 1), len = 72 * Math.sin(Math.PI * (0.1 + 0.9 * (1 - u))) + 8; for (const s of [-1, 1]) fills += '<path transform="translate(0 ' + f(-u * 190) + ') rotate(' + f(s * (68 - u * 18)) + ')" d="' + lens(len, 6) + '"/>'; }
        return '<g fill="' + col + '">' + fills + '<path d="' + lens(40, 5) + '" transform="translate(0 -190)"/></g><path d="M0 8V-190" stroke="' + line + '" stroke-width="2.4"/>';
      },
      monstera(r, col, line) {
        const pts = [];
        for (let a = -178; a <= 178; a += 4) {
          const th = a * Math.PI / 180, base = 74 * (1 - 0.18 * Math.cos(th + Math.PI)) * (1 + 0.1 * Math.cos(2 * th));
          let rr = base;
          for (const nt of [-140, -108, -76, -44, 44, 76, 108, 140]) { const d = Math.abs(a - nt); if (d < 8) rr = base * (0.3 + 0.7 * d / 8); }
          pts.push([Math.sin(th) * rr, -Math.cos(th) * rr + 62]);
        }
        let veins = '';
        for (const nt of [-124, -92, -60, 60, 92, 124]) { const th = nt * Math.PI / 180; veins += 'M0 0L' + P(Math.sin(th) * 62, -Math.cos(th) * 62 + 62 - 62 + 0); }
        return '<path d="M' + pts.map(p => P(p[0], p[1])).join('L') + 'Z" fill="' + col + '" transform="translate(0 -62)"/><path d="M0 0V-124" stroke="' + line + '" stroke-width="2.2"/>';
      },
      ginkgo(r, col, line) {
        let d = 'M0 0';
        for (let a = -62; a <= 62; a += 6) { const th = a * Math.PI / 180, rr = 74 * (Math.abs(a) < 7 ? 0.62 + Math.abs(a) / 7 * 0.38 : 1); d += 'L' + P(Math.sin(th) * rr, -Math.cos(th) * rr - 18); }
        let v = ''; for (let a = -54; a <= 54; a += 18) { const th = a * Math.PI / 180; v += 'M0 -18L' + P(Math.sin(th) * 60, -Math.cos(th) * 60 - 18); }
        return '<path d="' + d + 'Z" fill="' + col + '"/><path d="M0 0V-20' + v + '" stroke="' + line + '" stroke-width="1.6" fill="none"/>';
      },
      olive(r, col, line) {
        let fills = '', olives = '';
        for (let i = 1; i <= 8; i++) { const u = i / 9, y = -u * 160, x = Math.sin(u * 3) * 14; for (const s of [-1, 1]) fills += '<path transform="translate(' + P(x, y) + ') rotate(' + f(s * (58 - u * 10) + (i % 2) * 6) + ')" d="' + lens(48 - u * 14, 8) + '"/>'; if (i % 3 === 0) olives += '<ellipse cx="' + f(x + (i % 2 ? 12 : -12)) + '" cy="' + f(y + 8) + '" rx="6" ry="8.5"/>'; }
        return '<g fill="' + col + '">' + fills + '</g><g fill="' + line + '">' + olives + '</g><path d="M0 0Q' + P(20, -80) + ' ' + P(Math.sin(3) * 14, -170) + '" stroke="' + line + '" stroke-width="2.2" fill="none"/>';
      },
      banana(r, col, line) {
        let veins = '';
        for (let i = 1; i < 12; i++) { const y = -i * 18; veins += 'M0 ' + y + 'L' + P(34 - i, y - 14) + 'M0 ' + y + 'L' + P(-34 + i, y - 14); }
        return '<path d="' + lens(216, 54) + '" fill="' + col + '"/><path d="M0 8V-216' + veins + '" stroke="' + line + '" stroke-opacity="0.5" stroke-width="1.6" fill="none"/>';
      },
      daisy(r, col, line) {
        let petals = '';
        for (let i = 0; i < 13; i++) petals += '<ellipse cx="0" cy="-26" rx="8" ry="23" transform="rotate(' + f(i * 360 / 13) + ')"/>';
        return '<g transform="translate(0 -70)"><g fill="' + col + '">' + petals + '</g><circle r="12" fill="' + line + '"/></g><path d="M0 0Q-10 -34 0 -60" stroke="' + line + '" stroke-width="3" fill="none"/><path d="' + lens(40, 10) + '" fill="' + line + '" transform="translate(2 -14) rotate(52)"/>';
      },
    };

    GEN.leaves = function (r, c, o) {
      const t = tones(c), kind = o.leaf || 'palm', shape = SHAPES[kind];
      if (!shape) throw new Error('Unknown leaf shape: ' + kind);
      const light = !!o.light, ground = light ? t[4] : t[0], T = o.T || 470, TH = Math.round(T * 0.74), n = o.n || 6;
      const inks = light ? [t[0], t[1], t[2], t[3]] : [t[1], t[2], t[3], t[4]];
      const reach = o.reach || 140;
      let body = '';
      for (let k = 0; k < n; k++) {
        const x = r() * T, y = r() * TH, a = (r() - 0.5) * 300 + (k % 2 ? 180 : 0), s = (o.sc || 1) * (0.75 + r() * 0.55), col = inks[Math.floor(r() * 4)], line = light ? t[0] : t[4];
        const one = shape(r, col, mix(col, light ? '#000000' : '#ffffff', 0.45));
        for (const dx of [-T, 0, T]) for (const dy of [-TH, 0, TH]) {
          const px = x + dx, py = y + dy;
          if (px > -reach * s && px < T + reach * s && py > -reach * s && py < TH + reach * s) body += '<g transform="translate(' + P(px, py) + ') rotate(' + f(a) + ') scale(' + f(s) + ')">' + one + '</g>';
        }
      }
      return '<defs><pattern id="lv" width="' + T + '" height="' + TH + '" patternUnits="userSpaceOnUse">' + body + '</pattern>' + K.skin('sk', r, 0.55, 0.8, { mottle: 0.1 }) + '</defs><g filter="url(#sk)">' + box(ground) + '<rect width="' + W + '" height="' + H + '" fill="url(#lv)"/></g>' + vig('vg', 0.2);
    };

    G.extend(GEN);
    const api = { SHAPES };
    if (typeof window !== 'undefined') window.WallpaperNature = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = { WallpaperNature: api };

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
        if (++tries > 250) throw new Error('js/wallpaper-materials.js did not set up its toolkit, so js/wallpaper-nature.js has nothing to draw with');
        setTimeout(wait, 20);
      };
      wait();
    });
  }
  else throw new Error('js/wallpaper-materials.js must be loaded before js/wallpaper-nature.js');
})(typeof window !== 'undefined' ? window : globalThis);
