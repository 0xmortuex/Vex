// === A theme from a picture, or from your Windows wallpaper ===
//
// Pick a picture (or drop one on the theme editor, or take the one Windows
// shows on the desktop) and Vex makes a theme that suits it. The picture is
// decoded off the page's thread already shrunk to SAMPLE_MAX pixels a side,
// its colours are grouped (k-means in OKLab, the maths in js/theme-custom.js),
// and the nine theme colours are chosen from the groups: a light theme for a
// light picture and a dark one for a dark picture, with the other offered too.
// Every palette goes through CustomThemes.fixContrast before anyone sees it,
// so all its text reads at 4.5:1 or better.
//
// The theme editor (js/theme-studio.js) shows the palettes and wears the one
// you pick; the picture becomes the theme's New Tab picture, toned towards
// the theme's background just enough that the New Tab's text still reads over
// its brightest (or darkest) part. Nothing is sent anywhere: the picture is
// read here, and kept with the theme in Vex's own folder like any other.

const ThemeFromImage = (function (root) {
  const ct = () => {
    if (!root.CustomThemes) throw new Error('CustomThemes (js/theme-custom.js) is not loaded');
    return root.CustomThemes;
  };

  // sRGB 0..255 -> linear, for the WCAG luminance of every pixel.
  const LIN = new Float64Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

  // The same small random numbers every time, so a picture always gives the
  // same palette.
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const T = {
    SAMPLE_MAX: 128,
    CLUSTERS: 6,
    // A picked file, before it is read at all.
    FILE_MAX: 30 * 1024 * 1024,
    // The scrim start.html lays over a theme's picture (paintThemeImage).
    NEWTAB_SCRIM: 0.62,
    // A little over 4.5:1, for the rounding of the JPEG and of the compositing.
    NEWTAB_MIN: 4.7,

    // The first bytes of a file -> its picture type, or null.
    sniff(b) {
      if (!b || b.length < 12) return null;
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
      if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
      if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
      return null;
    },

    // --- the picture's colours ---------------------------------------------

    // RGBA pixels -> { n, meanL, clusters (heaviest first), lightest, darkest }.
    // Pixels more than half transparent are left out.
    summarize(rgba, { k = this.CLUSTERS } = {}) {
      const C = ct();
      const total = Math.floor(rgba.length / 4);
      const lab = new Float32Array(total * 3);
      let n = 0, sumL = 0, maxY = -1, minY = 2, lightest = null, darkest = null;
      for (let i = 0; i < total; i++) {
        const p = i * 4;
        if (rgba[p + 3] < 128) continue;
        const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        const [L, A, B] = C.rgbToOklab(r, g, b);
        lab[n * 3] = L; lab[n * 3 + 1] = A; lab[n * 3 + 2] = B;
        sumL += L;
        n++;
        const y = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
        if (y > maxY) { maxY = y; lightest = [r, g, b]; }
        if (y < minY) { minY = y; darkest = [r, g, b]; }
      }
      if (!n) throw new Error('That picture is see-through all over — there are no colours to use');
      return {
        n,
        meanL: sumL / n,
        clusters: this.kmeans(lab, n, k),
        lightest: C.hex(...lightest),
        darkest: C.hex(...darkest),
      };
    },

    // k-means (k-means++ start) over n OKLab points. -> [{ L, a, b, C, h, weight, hex }].
    kmeans(lab, n, k, iterations = 14) {
      const C = ct();
      k = Math.max(1, Math.min(k, n));
      const rand = seeded(0x5eed);
      const cen = new Float64Array(k * 3);
      const d2 = new Float64Array(n).fill(Infinity);
      const dist = (i, c) => {
        const dl = lab[i * 3] - cen[c * 3], da = lab[i * 3 + 1] - cen[c * 3 + 1], db = lab[i * 3 + 2] - cen[c * 3 + 2];
        return dl * dl + da * da + db * db;
      };
      const put = (c, i) => { cen[c * 3] = lab[i * 3]; cen[c * 3 + 1] = lab[i * 3 + 1]; cen[c * 3 + 2] = lab[i * 3 + 2]; };
      put(0, Math.floor(rand() * n));
      let used = 1;
      for (; used < k; used++) {
        let sum = 0;
        for (let i = 0; i < n; i++) { const d = dist(i, used - 1); if (d < d2[i]) d2[i] = d; sum += d2[i]; }
        if (sum <= 1e-12) break;             // every pixel is one colour already
        let r = rand() * sum, pick = n - 1;
        for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
        put(used, pick);
      }
      k = used;
      const assign = new Int32Array(n).fill(-1);
      const acc = new Float64Array(k * 4);
      for (let it = 0; it < iterations; it++) {
        let moved = 0;
        for (let i = 0; i < n; i++) {
          let best = 0, bd = Infinity;
          for (let c = 0; c < k; c++) { const d = dist(i, c); if (d < bd) { bd = d; best = c; } }
          if (assign[i] !== best) { assign[i] = best; moved++; }
        }
        acc.fill(0);
        for (let i = 0; i < n; i++) {
          const c = assign[i];
          acc[c * 4] += lab[i * 3]; acc[c * 4 + 1] += lab[i * 3 + 1]; acc[c * 4 + 2] += lab[i * 3 + 2]; acc[c * 4 + 3]++;
        }
        for (let c = 0; c < k; c++) {
          const m = acc[c * 4 + 3];
          if (m) { cen[c * 3] = acc[c * 4] / m; cen[c * 3 + 1] = acc[c * 4 + 1] / m; cen[c * 3 + 2] = acc[c * 4 + 2] / m; }
        }
        if (!moved) break;
      }
      const out = [];
      for (let c = 0; c < k; c++) {
        const m = acc[c * 4 + 3];
        if (!m) continue;
        const L = cen[c * 3], a = cen[c * 3 + 1], b = cen[c * 3 + 2];
        const chroma = Math.hypot(a, b), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
        out.push({ L, a, b, C: chroma, h, weight: m / n, hex: C.fromOklch(L, chroma, h) });
      }
      return out.sort((x, y) => y.weight - x.weight);
    },

    // --- from the colours to a theme -----------------------------------------

    // Is this picture light enough for a light theme?
    isLightPicture(summary) { return summary.meanL >= 0.6; },

    // One palette: { colors (all nine, contrast fixed), unresolved }.
    // style 'calm': a background barely tinted by the picture's main colour and
    // the accent its most present colourful one. 'vivid': a deeper tint and the
    // accent its most saturated colour, made stronger.
    palette(summary, { light, style = 'calm' }) {
      const C = ct();
      const cl = summary.clusters;
      if (!cl || !cl.length) throw new Error('The picture has no colours');
      const vivid = style === 'vivid';
      const main = cl[0];
      // A near-grey picture has no hue worth tinting with.
      const hue = main.h;
      const tint = (max) => (main.C < 0.012 ? 0 : Math.min(main.C, max));
      const bgC = vivid ? 0.07 : 0.028;
      const bgL = light ? (vivid ? 0.95 : 0.975) : (vivid ? 0.22 : 0.19);
      const colors = {
        background: C.fromOklch(bgL, tint(bgC), hue),
        surface: C.fromOklch(light ? Math.min(0.995, bgL + 0.018) : bgL + 0.05, tint(bgC * 0.85), hue),
        border: C.fromOklch(light ? bgL - 0.13 : bgL + 0.13, tint(bgC * 0.9), hue),
        text: C.fromOklch(light ? 0.24 : 0.94, tint(0.02), hue),
        muted: C.fromOklch(light ? 0.5 : 0.75, tint(0.035), hue),
      };
      // The accent: a colourful group of the picture (one clearly coloured
      // counts for more), down to the faint tints of a pastel picture; a
      // quiet blue when there is no hue at all.
      // (Vivid leans on saturation, but not on specks under 1% of the picture.)
      const candidates = cl.filter(c => c.C >= 0.015 && (!vivid || c.weight >= 0.01));
      let accH, accC;
      if (candidates.length) {
        // On a light theme the accent is dark, and a dark yellow is brown or
        // olive: yellows only win there when nothing else is near.
        const muddy = (c) => (light && c.h > 65 && c.h < 115 ? 0.25 : 1);
        const vividish = (c) => (c.C >= 0.045 ? 1.5 : 1);
        const score = vivid ? (c) => c.C ** 3 * c.weight ** 0.25 * muddy(c) : (c) => c.C * c.weight * vividish(c) * muddy(c);
        const pick = candidates.reduce((best, c) => (score(c) > score(best) ? c : best));
        accH = pick.h;
        accC = vivid ? clamp(pick.C * 1.25, 0.15, 0.3) : clamp(pick.C, 0.08, 0.14);
      } else {
        accH = 255;
        accC = vivid ? 0.14 : 0.09;
      }
      colors.primary = C.fromOklch(light ? 0.52 : 0.74, accC, accH);
      colors.success = C.fromOklch(light ? 0.5 : 0.78, 0.15, 150);
      colors.warning = C.fromOklch(light ? 0.55 : 0.83, 0.15, 75);
      colors.danger = C.fromOklch(light ? 0.52 : 0.72, 0.18, 27);
      return C.fixContrast(colors);
    },

    // The palettes the editor offers: Calm and Vivid on the picture's own side
    // (light or dark), and Calm on the other side.
    palettes(summary) {
      const light = this.isLightPicture(summary);
      const make = (id, label, l, style) => {
        const p = this.palette(summary, { light: l, style });
        return { id, label, light: l, colors: p.colors, unresolved: p.unresolved };
      };
      return [
        make('calm', 'Calm', light, 'calm'),
        make('vivid', 'Vivid', light, 'vivid'),
        make('flip', light ? 'Dark' : 'Light', !light, 'calm'),
      ];
    },

    // How much of the theme's background to lay over the picture, under the
    // New Tab's own scrim, so its text, muted text and the text it draws in
    // the accent (the wordmark, links) read over the picture's most contrary
    // pixel. 0 = the picture as it is.
    pictureTint(colors, summary) {
      const C = ct();
      const c = C.complete(colors);
      const worst = C.isLight(c) ? summary.darkest : summary.lightest;
      const reads = (alpha) => {
        const under = C.mix(worst, c.background, alpha);
        return [c.text, c.muted, c.primary].every(ink => C.contrast(ink, under) >= this.NEWTAB_MIN);
      };
      if (reads(this.NEWTAB_SCRIM)) return 0;
      let a = this.NEWTAB_SCRIM;
      while (a < 1 && !reads(a)) a = Math.min(1, a + 0.01);
      // Over the picture: first the tint t, then the scrim s; together
      // 1 - a = (1 - t)(1 - s).
      return clamp(1 - (1 - a) / (1 - this.NEWTAB_SCRIM), 0, 1);
    },

    // A file's name -> a theme name ("dark-lake_2.jpg" -> "Dark lake 2").
    nameFor(fileName) {
      const C = ct();
      const stem = String(fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
      const n = stem ? stem[0].toUpperCase() + stem.slice(1) : 'From a picture';
      return n.slice(0, C.NAME_MAX).trim();
    },

    // --- in the window ---------------------------------------------------------

    // A picked or dropped file -> the same bytes as a Blob of its real type.
    // BMP only from the wallpaper (Windows keeps some wallpapers as BMP).
    async checkFile(file, { allowBmp = false } = {}) {
      if (!file || typeof file.slice !== 'function') throw new Error('No picture was given');
      if (file.size > this.FILE_MAX) throw new Error(`That picture is too big (${Math.round(file.size / 1048576)} MB; ${Math.round(this.FILE_MAX / 1048576)} MB at most)`);
      const type = this.sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
      if (!type || (type === 'image/bmp' && !allowBmp)) throw new Error('Vex makes themes from PNG, JPEG and WebP pictures');
      return file.type === type ? file : new Blob([file], { type });
    },

    // Decoded off the page's thread, already shrunk; -> summarize().
    async sample(blob) {
      let bmp;
      try {
        bmp = await root.createImageBitmap(blob, { resizeWidth: this.SAMPLE_MAX, resizeQuality: 'high' });
      } catch (err) {
        throw new Error('That picture could not be read — it may be damaged', { cause: err });
      }
      try {
        let w = bmp.width, h = bmp.height;
        // A tall picture: SAMPLE_MAX on its long side too.
        if (h > this.SAMPLE_MAX) { w = Math.max(1, Math.round(w * this.SAMPLE_MAX / h)); h = this.SAMPLE_MAX; }
        const cv = new root.OffscreenCanvas(w, h);
        const x = cv.getContext('2d', { willReadFrequently: true });
        x.drawImage(bmp, 0, 0, w, h);
        return this.summarize(x.getImageData(0, 0, w, h).data);
      } finally {
        bmp.close();
      }
    },

    // The picture (a data: URL already fitted by ThemeStudio._fitImage) with
    // pictureTint() of the background laid over it, as a JPEG.
    async bake(picture, colors, summary) {
      const C = ct();
      const t = this.pictureTint(colors, summary);
      if (!t) return picture;
      const img = await new Promise((resolve, reject) => {
        const im = new root.Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('The picture could not be shown'));
        im.src = picture;
      });
      const cv = root.document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const x = cv.getContext('2d');
      x.drawImage(img, 0, 0);
      const [r, g, b] = C.rgb(C.complete(colors).background);
      x.fillStyle = `rgba(${r}, ${g}, ${b}, ${t.toFixed(3)})`;
      x.fillRect(0, 0, cv.width, cv.height);
      for (const q of [0.86, 0.74, 0.62]) {
        const out = cv.toDataURL('image/jpeg', q);
        if (out.length <= C.IMAGE_MAX) return out;
      }
      throw new Error('That picture is too big to keep with the theme');
    },

    // The wallpaper Windows shows now, read by the main process (read only).
    // -> { blob, note }.
    async wallpaper() {
      const vex = root.vex;
      if (!vex || typeof vex.readWallpaper !== 'function') throw new Error('Your wallpaper cannot be read from here');
      const r = await vex.readWallpaper();
      if (!r || typeof r !== 'object') throw new Error('Vex got no answer reading your wallpaper');
      if (!r.ok) throw new Error(r.message || 'Your wallpaper could not be read');
      const m = /^data:(image\/(?:png|jpeg|webp|bmp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(r.dataUrl || '');
      if (!m) throw new Error('Your wallpaper came back in a form Vex does not read');
      const bin = root.atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { blob: new Blob([bytes], { type: m[1] }), note: r.note || '' };
    },
  };
  return T;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof window !== 'undefined') window.ThemeFromImage = ThemeFromImage;
if (typeof module !== 'undefined' && module.exports) module.exports = { ThemeFromImage };
