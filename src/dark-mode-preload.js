// === Dark mode for websites: the page side ==================================
//
// A guest preload of its own (a sandboxed webview preload can only require
// 'electron', so it cannot be required from preload-webview.js; see
// site-tweaks.js). Main decides whether THIS page gets dark mode
// (renderer/js/dark-mode.js, the same rules the Settings page edits); this file
// only does it. Off, it costs one synchronous question to main and returns.
//
// The smart engine is a small "dynamic" one, in the way Dark Reader works:
//   1. at document start, before the first paint: `color-scheme: dark` on the
//      root (dark scrollbars, form controls, default canvas and text) and a
//      dark root background, so nothing flashes white;
//   2. every style rule of the page that sets a colour is copied, with the
//      colour moved to a dark tone (backgrounds darker, text lighter, borders
//      softer), into constructed stylesheets that sit after the page's own.
//      Nothing of the page is edited: removing those sheets is the whole undo.
//      CSS variables are converted at their definition, so var(--bg) follows;
//   3. what rules cannot see (style="" attributes, legacy bgcolor/<font>, sheets
//      of another origin, colours a script sets) is found afterwards by reading
//      computed styles in idle slices; a short table of data-vexdm-* attributes
//      carries those fixes, and a contrast check keeps text readable;
//   4. a page that is already dark (its own dark theme, or prefers-color-scheme)
//      is left alone, and picked up again when the page switches to light;
//   5. photos, video, canvas and iframes are never touched; a small transparent
//      dark logo is inverted (when its pixels can be read).
// The simple engine is the old invert-the-page filter, kept as a fallback.
//
// Never runs in: chrome-extension:// frames (the PDF viewer), file:// (Vex's own
// pages), any frame but the top one, and any page that is not HTML.
'use strict';

(function () {
  // --- colour math (pure; exported for the tests) -----------------------------
  const NAMED = {};
  ('aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,'
  + 'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,'
  + 'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,'
  + 'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,'
  + 'darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,'
  + 'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,'
  + 'deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,'
  + 'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,'
  + 'grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,'
  + 'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,'
  + 'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,'
  + 'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,'
  + 'lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,'
  + 'mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,'
  + 'mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,'
  + 'navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,'
  + 'palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,'
  + 'pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,'
  + 'saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,'
  + 'slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,'
  + 'thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,'
  + 'yellowgreen:9acd32').split(',').forEach((p) => {
    const i = p.indexOf(':'); const h = p.slice(i + 1);
    NAMED[p.slice(0, i)] = { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  });
  NAMED.transparent = { r: 0, g: 0, b: 0, a: 0 };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function parseNumber(s, pctScale) {
    s = String(s).trim();
    if (!s) return NaN;
    if (s.endsWith('%')) return parseFloat(s) / 100 * pctScale;
    return parseFloat(s);
  }
  function parseHue(s) {
    s = String(s).trim().toLowerCase();
    let v = parseFloat(s);
    if (isNaN(v)) return NaN;
    if (s.endsWith('turn')) v *= 360; else if (s.endsWith('rad')) v = v * 180 / Math.PI; else if (s.endsWith('grad')) v = v * 0.9;
    return ((v % 360) + 360) % 360;
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255) };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
  }

  // A CSS colour in text -> {r,g,b,a}, or null for anything not understood
  // (var(), color-mix(), lab(), currentcolor, system colours ...).
  function parseColor(str) {
    if (typeof str !== 'string') return null;
    const s = str.trim().toLowerCase();
    if (!s) return null;
    if (s[0] === '#') {
      const h = s.slice(1);
      if (!/^[0-9a-f]+$/.test(h)) return null;
      if (h.length === 3 || h.length === 4) {
        return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1 };
      }
      if (h.length === 6 || h.length === 8) {
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
      }
      return null;
    }
    const m = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(s);
    if (m) {
      const parts = m[2].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3 || parts.length > 4) return null;
      let a = 1;
      if (parts[3] !== undefined) { a = parseNumber(parts[3], 1); if (isNaN(a)) return null; }
      if (m[1][0] === 'r') {
        const r = parseNumber(parts[0], 255); const g = parseNumber(parts[1], 255); const b = parseNumber(parts[2], 255);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        return { r: Math.round(clamp(r, 0, 255)), g: Math.round(clamp(g, 0, 255)), b: Math.round(clamp(b, 0, 255)), a: clamp(a, 0, 1) };
      }
      const h = parseHue(parts[0]); const sat = parseNumber(parts[1], 1); const l = parseNumber(parts[2], 1);
      if (isNaN(h) || isNaN(sat) || isNaN(l)) return null;
      const c = hslToRgb(h, clamp(sat, 0, 1), clamp(l, 0, 1));
      c.a = clamp(a, 0, 1);
      return c;
    }
    return NAMED[s] ? { ...NAMED[s] } : null;
  }

  const hex2 = (v) => { const s = Math.round(clamp(v, 0, 255)).toString(16); return s.length < 2 ? '0' + s : s; };
  function toCss(c) {
    if (c.a >= 0.999) return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
    return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + (Math.round(c.a * 1000) / 1000) + ')';
  }

  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  function contrast(a, b) {
    const la = luminance(a); const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // `top` painted over the opaque `under`.
  function over(top, under) {
    const a = top.a === undefined ? 1 : top.a;
    return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
  }

  // The look: brightness / contrast / sepia (percent) as in CSS filters.
  const DEFAULT_LOOK = { brightness: 100, contrast: 100, sepia: 0 };
  function tone(c, look) {
    if (!look || (look.brightness === 100 && look.contrast === 100 && !look.sepia)) return c;
    let { r, g, b } = c;
    const br = (look.brightness == null ? 100 : look.brightness) / 100;
    const ct = (look.contrast == null ? 100 : look.contrast) / 100;
    const sp = clamp((look.sepia || 0) / 100, 0, 1);
    r *= br; g *= br; b *= br;
    r = (r - 127.5) * ct + 127.5; g = (g - 127.5) * ct + 127.5; b = (b - 127.5) * ct + 127.5;
    if (sp > 0) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b; const sg = 0.349 * r + 0.686 * g + 0.168 * b; const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = r + (sr - r) * sp; g = g + (sg - g) * sp; b = b + (sb - b) * sp;
    }
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: c.a };
  }

  // Lightness maps. l is HSL lightness 0..1. A light background goes dark and a
  // dark one stays; text and borders move the other way, never below a floor
  // that keeps text at >= 4.5:1 on the darkest backgrounds.
  const BG_FLOOR = 0.11;
  const TINT_BG = { h: 200, s: 0.06 };
  const TINT_FG = { h: 40, s: 0.1 };
  // The darkest ground text meets: a white page, converted.
  const BASE_BG = { r: 26, g: 29, b: 30, a: 1 };
  function mapBackground(c) {
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    let l2 = l; let s2 = s; let h2 = h;
    if (l > 0.5) {
      const k = (l - 0.5) / 0.5;
      l2 = BG_FLOOR + (0.5 - BG_FLOOR) * Math.pow(1 - k, 1.6);
      s2 = s * (1 - 0.45 * k);
    }
    if (s < 0.1) { h2 = TINT_BG.h; s2 = TINT_BG.s * (l > 0.5 ? 1 : l * 2); }
    const rgb = hslToRgb(h2, clamp(s2, 0, 1), clamp(l2, 0, 1));
    return { ...rgb, a: c.a };
  }
  function mapForeground(c) {
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    let l2; let s2 = s; let h2 = h;
    if (l < 0.5) { l2 = 0.92 - 0.6 * l; s2 = s * 0.85; } else { l2 = Math.max(l, 0.62); }
    if (s < 0.1) { h2 = TINT_FG.h; s2 = TINT_FG.s; }
    let rgb = hslToRgb(h2, clamp(s2, 0, 1), clamp(l2, 0, 1));
    // Lightness is not brightness: pure blue at 64% is still too dim. Text is
    // lifted until it reads at 4.5:1 on the darkest ground it can meet.
    for (let step = 0; step < 24 && contrast(rgb, BASE_BG) < 4.6; step++) {
      l2 = Math.min(1, l2 + 0.02);
      rgb = hslToRgb(h2, clamp(s2 * (1 - step * 0.01), 0, 1), l2);
    }
    return { ...rgb, a: c.a };
  }
  function mapBorder(c) {
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    let l2; let s2 = s; let h2 = h;
    if (l >= 0.5) { l2 = 0.13 + (1 - l) * 0.55; s2 = s * 0.6; } else { l2 = 0.25 + l * 0.5; }
    if (s < 0.1) { h2 = TINT_BG.h; s2 = 0.05; }
    const rgb = hslToRgb(h2, clamp(s2, 0, 1), clamp(l2, 0, 1));
    return { ...rgb, a: c.a };
  }
  const MAPS = { bg: mapBackground, fg: mapForeground, bd: mapBorder };

  function convertColor(c, role, look) {
    if (c.a === 0) return c;
    return tone(MAPS[role](c), look);
  }

  // --- CSS text helpers --------------------------------------------------------
  function matchParen(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"' || ch === "'") { i = skipString(s, i) - 1; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) return i; }
    }
    return s.length - 1;
  }
  function skipString(s, i) {
    const q = s[i];
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === q) return j + 1;
    }
    return s.length;
  }
  function splitTop(s, sep) {
    // no bracket and no quote in the text: the native split is the whole answer
    if (s.indexOf('(') < 0 && s.indexOf('"') < 0 && s.indexOf("'") < 0) return s.split(sep);
    const out = []; let depth = 0; let start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"' || ch === "'") { i = skipString(s, i) - 1; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    }
    out.push(s.slice(start));
    return out;
  }
  // "a: b; --c: d(e;f);" -> [{name, value, important}]
  function parseDeclarations(text) {
    const out = [];
    for (const part of splitTop(text, ';')) {
      const i = part.indexOf(':');
      if (i < 1) continue;
      const name = part.slice(0, i).trim();
      let value = part.slice(i + 1).trim();
      let important = false;
      const im = /\s*!\s*important\s*$/i.exec(value);
      if (im) { important = true; value = value.slice(0, im.index); }
      if (name) out.push({ name: name.startsWith('--') ? name : name.toLowerCase(), value, important });
    }
    return out;
  }

  // The converted colour as text, or the page's own text when nothing changes
  // (transparent, black on black ...): no rule is written for a no-op.
  function emitColor(c, raw, role, look) {
    if (c.a === 0) return raw;
    const r = convertColor(c, role, look);
    if (r.r === c.r && r.g === c.g && r.b === c.b && r.a === c.a) return raw;
    return toCss(r);
  }
  const isIdentStart = (ch) => /[a-zA-Z_-]/.test(ch);
  const isIdentChar = (ch) => /[\w-]/.test(ch);
  const UNSUPPORTED_COLOR_FN = /^(hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)$/;

  // Replaces every colour in a CSS value. `role` picks the map (bg/fg/bd);
  // `look` the brightness/contrast/sepia. var(--x) becomes
  // var(--vexdm-ROLE--x, var(--x)): the converted twin of the variable
  // (see defineVarTwins) when there is one, the page's own value when not.
  const valueCache = new Map();
  function convertValue(value, role, look) {
    const key = role + (look ? look.brightness + ',' + look.contrast + ',' + look.sepia : '') + '|' + value;
    const hit = valueCache.get(key);
    if (hit !== undefined) return hit;
    const result = convertValueUncached(value, role, look);
    if (valueCache.size > 6000) valueCache.clear();
    valueCache.set(key, result);
    return result;
  }
  function convertValueUncached(value, role, look) {
    const out = [];
    let i = 0; const n = value.length;
    while (i < n) {
      const ch = value[i];
      if (ch === '"' || ch === "'") { const j = skipString(value, i); out.push(value.slice(i, j)); i = j; continue; }
      if (ch === '#') {
        const m = /^#[0-9a-fA-F]{3,8}(?![\w-])/.exec(value.slice(i, i + 10));
        if (m) {
          const c = parseColor(m[0]);
          out.push(c ? emitColor(c, m[0], role, look) : m[0]);
          i += m[0].length; continue;
        }
      }
      if (isIdentStart(ch) && (i === 0 || !isIdentChar(value[i - 1]))) {
        let j = i + 1;
        while (j < n && isIdentChar(value[j])) j++;
        const name = value.slice(i, j).toLowerCase();
        if (value[j] === '(') {
          const end = matchParen(value, j);
          const inner = value.slice(j + 1, end);
          if (name === 'url' || name === 'image-set' || name === 'src') { out.push(value.slice(i, end + 1)); i = end + 1; continue; }
          if (name === 'var') { out.push(rewriteVar(inner, role, look)); i = end + 1; continue; }
          if (/^(rgb|rgba|hsl|hsla)$/.test(name)) {
            if (inner.indexOf('var(') >= 0) out.push(name + '(' + rewriteVarsIn(inner, role, look) + ')');
            else {
              const raw = value.slice(i, end + 1);
              const c = parseColor(raw);
              out.push(c ? emitColor(c, raw, role, look) : raw);
            }
            i = end + 1; continue;
          }
          if (UNSUPPORTED_COLOR_FN.test(name)) { out.push(value.slice(i, end + 1)); i = end + 1; continue; }
          out.push(value.slice(i, j + 1) + convertValue(inner, role, look) + ')');
          i = end + 1; continue;
        }
        const named = NAMED[name];
        out.push(named ? emitColor({ ...named }, value.slice(i, j), role, look) : value.slice(i, j));
        i = j; continue;
      }
      out.push(ch); i++;
    }
    return out.join('');
  }
  function rewriteVar(inner, role, look) {
    const parts = splitTop(inner, ',');
    const name = parts[0].trim();
    if (!/^--/.test(name)) return 'var(' + inner + ')';
    const orig = parts.length > 1
      ? 'var(' + name + ',' + convertValue(parts.slice(1).join(','), role, look).trim() + ')'
      : 'var(' + name + ')';
    return 'var(--vexdm-' + role + '-' + name.slice(2) + ',' + orig + ')';
  }
  function rewriteVarsIn(text, role, look) {
    let out = ''; let i = 0;
    while (i < text.length) {
      const k = text.indexOf('var(', i);
      if (k < 0) { out += text.slice(i); break; }
      if (k > 0 && isIdentChar(text[k - 1])) { out += text.slice(i, k + 4); i = k + 4; continue; }
      const end = matchParen(text, k + 3);
      out += text.slice(i, k) + rewriteVar(text.slice(k + 4, end), role, look);
      i = end + 1;
    }
    return out;
  }

  // "0 0% 100%" / "210, 40%, 98%" (shadcn, Tailwind) or "255 255 255": the
  // channels of a colour kept in a variable, to be used as hsl(var(--x)).
  function parseChannelTriple(value) {
    const v = String(value).trim();
    let m = /^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%$/.exec(v);
    if (m) return { kind: 'hsl', comma: v.indexOf(',') >= 0, c: { ...hslToRgb(parseFloat(m[1]), clamp(parseFloat(m[2]) / 100, 0, 1), clamp(parseFloat(m[3]) / 100, 0, 1)), a: 1 } };
    m = /^(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)$/.exec(v);
    if (m) return { kind: 'rgb', comma: v.indexOf(',') >= 0, c: { r: clamp(+m[1], 0, 255), g: clamp(+m[2], 0, 255), b: clamp(+m[3], 0, 255), a: 1 } };
    return null;
  }
  function formatChannelTriple(kind, comma, c) {
    const sep = comma ? ', ' : ' ';
    if (kind === 'rgb') return Math.round(c.r) + sep + Math.round(c.g) + sep + Math.round(c.b);
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    return Math.round(h) + sep + Math.round(s * 1000) / 10 + '%' + sep + Math.round(l * 1000) / 10 + '%';
  }

  // The converted twins of one custom property definition:
  //   --x: #fff  ->  --vexdm-bg-x / --vexdm-fg-x / --vexdm-bd-x
  function varTwins(name, value, look) {
    const out = [];
    const triple = parseChannelTriple(value);
    const key = name.slice(2);
    for (const role of ['bg', 'fg', 'bd']) {
      let twin;
      if (triple) twin = formatChannelTriple(triple.kind, triple.comma, convertColor(triple.c, role, look));
      else {
        twin = convertValue(value, role, look);
        if (twin === value) continue;
      }
      out.push('--vexdm-' + role + '-' + key + ':' + twin);
    }
    return out;
  }

  // For a variable the site itself defined for its dark design: the twins carry its own value for every role, so a
  // use of the variable reads the dark value and not a converted twin of the same name from the light rules.
  const COLORVAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|gradient\(|var\(|\b(?:white|black|gr[ae]y|red|blue|green|yellow|orange|purple|pink|navy|teal|silver|maroon|olive|lime|aqua|fuchsia|transparent)\b/i;
  function identityTwins(name, value) {
    if (!COLORVAL.test(value)) return [];
    const key = name.slice(2);
    return ['bg', 'fg', 'bd'].map((role) => '--vexdm-' + role + '-' + key + ':' + value);
  }

  // --- which declarations carry colours ---------------------------------------
  const BORDER_PROP = /^(?:border|outline|column-rule)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?$/;
  const FG_PROPS = new Set(['color', 'caret-color', 'text-decoration', 'text-decoration-color', 'text-emphasis', 'text-emphasis-color',
    '-webkit-text-fill-color', '-webkit-text-stroke-color', '-webkit-text-stroke', 'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color']);
  const BG_PROPS = new Set(['background', 'background-color', 'background-image']);

  // An icon kept in the stylesheet itself (background: url("data:image/svg+xml,...")) is a dark drawing on a page
  // that is about to be dark: its fills and strokes get the colour a dark page gives text. An address is never
  // rewritten (a relative one would mean something else here), so a value with any url() that is not such an
  // icon returns null.
  function convertSvgUrls(value, look) {
    let out = ''; let i = 0; let found = false;
    const re = /url\(/gi;
    let m;
    while ((m = re.exec(value))) {
      const open = m.index + 3;
      const end = matchParen(value, open);
      let inner = value.slice(open + 1, end).trim();
      if ((inner[0] === '"' || inner[0] === "'") && inner[inner.length - 1] === inner[0]) inner = inner.slice(1, -1);
      if (!/^data:image\/svg\+xml/i.test(inner)) return null;
      const converted = convertSvgDataUrl(inner, look);
      out += value.slice(i, m.index) + (converted || value.slice(m.index, end + 1));
      if (converted) found = true;
      i = end + 1;
      re.lastIndex = i;
    }
    return found ? out + value.slice(i) : value;
  }
  function convertSvgDataUrl(url, look) {
    const comma = url.indexOf(',');
    if (comma < 0) return null;
    const head = url.slice(0, comma); const payload = url.slice(comma + 1);
    let svg;
    try {
      if (/;base64/i.test(head)) svg = new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)));
      else { try { svg = decodeURIComponent(payload); } catch (err) { svg = payload; /* vex-allow-empty-catch: a data URL that is not percent-encoded is already the drawing */ } }
    } catch (err) { return null; }
    const ink = toCss(convertColor({ r: 0, g: 0, b: 0, a: 1 }, 'fg', look));
    let touched = false;
    svg = svg.replace(/(\b(?:fill|stroke|stop-color|flood-color|color)\s*[=:]\s*)(["']?)([^"';>\s]+)\2/gi, (all, pre, q, val) => {
      if (/^(none|inherit|url\(.*)$/i.test(val)) return all;
      if (/^currentcolor$/i.test(val)) { touched = true; return pre + q + ink + q; }
      const next = convertValue(val, 'fg', look);
      if (next !== val) touched = true;
      return pre + q + next + q;
    });
    // a drawing that names no colour is black: give its root the text colour
    if (!/\b(?:fill|stroke)\s*[=:]/i.test(svg) && /<(?:path|circle|rect|polygon|ellipse|line|polyline|g)\b/i.test(svg)) {
      svg = svg.replace(/<svg\b/i, '<svg fill="' + ink + '"');
      touched = true;
    }
    return touched ? 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")' : null;
  }

  // One declaration -> the overriding declaration text, or '' for none.
  function overrideDeclaration(d, look, keepImages) {
    const { name } = d; const value = d.value;
    if (name === 'color-scheme') return 'color-scheme:dark!important';
    if (name.startsWith('--')) return '';
    if (BG_PROPS.has(name)) {
      if (/^(none|initial|inherit|unset|revert)$/i.test(value)) return '';
      if (name === 'background-color') {
        const v = convertValue(value, 'bg', look);
        return v === value ? '' : 'background-color:' + v + '!important';
      }
      const hasUrl = /url\(|image-set\(/i.test(value);
      if (hasUrl && /data:image\/svg\+xml/i.test(value) && !/image-set\(/i.test(value)) {
        const svgOnly = convertSvgUrls(value, look);
        if (svgOnly !== null && svgOnly !== value) {
          const v = convertValue(svgOnly, 'bg', look);
          return (name === 'background-image' ? 'background-image:' : 'background:') + v + '!important';
        }
      }
      if (name === 'background-image') {
        if (hasUrl) return '';
        const v = convertValue(value, 'bg', look);
        return v === value ? '' : 'background-image:' + v + '!important';
      }
      // The background shorthand: its colour is in the last comma layer. A
      // url() is never copied (its relative address would mean something else
      // in our sheet), so a layer list with a picture only gets its colour
      // converted; a list of gradients only gets background-image too.
      const layers = splitTop(value, ',');
      const bits = [];
      if (!hasUrl && /gradient\(/i.test(value)) {
        const imgs = layers.map(l => extractFunctions(l, /gradient$/i) || 'none');
        const conv = convertValue(imgs.join(','), 'bg', look);
        if (conv !== imgs.join(',')) bits.push('background-image:' + conv + '!important');
      }
      const lastLayer = removeFunctions(layers[layers.length - 1], /^(?:url|image-set|[a-z-]*gradient)$/i);
      const c = firstColorToken(lastLayer);
      if (c) {
        const cv = convertValue(c, 'bg', look);
        if (cv !== c) bits.push('background-color:' + cv + '!important');
      }
      return bits.join(';');
    }
    if (FG_PROPS.has(name)) {
      if (/^(none|currentcolor|inherit|initial|unset|revert|context-fill|context-stroke)$/i.test(value)) return '';
      const v = convertValue(value, 'fg', look);
      return v === value ? '' : name + ':' + v + '!important';
    }
    if (BORDER_PROP.test(name) || name === 'scrollbar-color') {
      if (/^(none|inherit|initial|unset|revert)$/i.test(value)) return '';
      const v = convertValue(value, 'bd', look);
      return v === value ? '' : name + ':' + v + '!important';
    }
    return '';
  }
  // `text` without the functions whose name matches (url(...), gradients ...)
  function removeFunctions(text, nameRe) { return walkFunctions(text, nameRe, false); }
  // only those functions, joined by a space ('' when none)
  function extractFunctions(text, nameRe) { return walkFunctions(text, nameRe, true).trim(); }
  function walkFunctions(text, nameRe, keep) {
    let out = ''; let i = 0;
    const re = /[a-zA-Z-]+\(/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[0].slice(0, -1);
      if (!nameRe.test(name)) continue;
      const open = m.index + m[0].length - 1;
      const end = matchParen(text, open);
      if (keep) out += text.slice(m.index, end + 1) + ' '; else out += text.slice(i, m.index);
      i = end + 1;
      re.lastIndex = i;
    }
    if (!keep) out += text.slice(i);
    return out;
  }
  // the first colour (literal, name, or var()) of a shorthand layer, as text
  function firstColorToken(layer) {
    const re = /#[0-9a-fA-F]{3,8}(?![\w-])|(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)|var\((?:[^()]|\([^()]*\))*\)|[a-zA-Z]+/g;
    let m;
    while ((m = re.exec(layer))) {
      const t = m[0];
      if (t[0] === '#' || /^(rgb|hsl)/i.test(t) || /^var\(/i.test(t)) return t;
      if (NAMED[t.toLowerCase()]) return t;
    }
    return '';
  }

  // The declarations of one rule's style -> override text ('' when nothing).
  // wantVar(name): does anything use this variable as a colour? (a twin for every variable of a big design
  // system would be most of the output); undefined means every one.
  function overrideBlock(styleText, look, keepImages, wantVar) {
    const decls = parseDeclarations(styleText);
    const out = [];
    for (const d of decls) {
      if (d.name.startsWith('--')) {
        if (!wantVar || wantVar(d.name)) for (const t of varTwins(d.name, d.value, look)) out.push(t);
        continue;
      }
      const o = overrideDeclaration(d, look, keepImages);
      if (o) out.push(o);
    }
    return out.join(';');
  }

  const COLORISH = /color|background|border|outline|fill|stroke|stop-|column-rule|text-decoration|text-emphasis|--/;
  const isColorProp = (name) => BG_PROPS.has(name) || FG_PROPS.has(name) || BORDER_PROP.test(name) || name === 'scrollbar-color';
  const VAR_REF = /var\(\s*(--[\w-]+)/g;
  function varRefs(value) {
    const out = []; let m;
    VAR_REF.lastIndex = 0;
    while ((m = VAR_REF.exec(value))) out.push(m[1]);
    return out;
  }

  // --- the engine (needs a DOM) ------------------------------------------------
  const SIMPLE_CSS = 'html{filter:invert(1) hue-rotate(180deg) FILTERS;background:#0a0c10!important}'
    + 'img,video,canvas,picture,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}';

  function createEngine(env) {
    const win = env.window; const doc = env.document;
    const report = env.report || function () {};
    let cfg = null;
    let active = false;
    let paused = null; // null, or why the page is left alone ('already-dark', 'dark-reader')
    let simpleSheet = null;
    const roots = new Map(); // Document | ShadowRoot -> rootState
    let sheetOut = new WeakMap(); // source CSSStyleSheet -> { out, count }
    const ours = new Set();
    let observer = null; let attrObserver = null;
    let pollTimer = 0; let auditTimer = 0; let recheckTimer = 0;
    const auditQueue = []; let auditQueued = new WeakSet(); let auditDone = new WeakSet();
    const palette = { bg: new Map(), fg: new Map(), bd: new Map(), fill: new Map() };
    const ATTR_KINDS = ['bg', 'fg', 'bd', 'fill', 'img'];
    const marked = new Set(); // elements carrying a data-vexdm-* attribute
    const stats = { ms: 0, msBrowserParse: 0, outChars: 0, msSheets: 0, msAudit: 0, msDetect: 0, rules: 0, sheets: 0, audited: 0, fixes: 0, logos: 0, passes: 0 };
    let lastStateKey = '';

    const nowMs = () => (win.performance ? win.performance.now() : Date.now());
    const look = () => cfg.look;

    // baseUrl: where a relative url() in the copy points (the address of the stylesheet it was copied from)
    function makeSheet(text, baseUrl) {
      const s = baseUrl ? new win.CSSStyleSheet({ baseURL: baseUrl }) : new win.CSSStyleSheet();
      s.replaceSync(text);
      ours.add(s);
      return s;
    }
    function rootState(root) {
      let st = roots.get(root);
      if (st) return st;
      st = { root, base: null, tail: null, sheets: new Set(), keep: [] };
      roots.set(root, st);
      return st;
    }
    function setAdopted(root, list) {
      try { root.adoptedStyleSheets = list; } catch (err) { env.error('could not adopt a stylesheet', err); }
    }
    // The veil: html hidden (on a dark canvas) while a stylesheet that has just arrived is being copied dark.
    let veilSheet = null; let veilCount = 0; let veilTimer = 0;
    function veilHold() {
      if (!active || paused) return;
      veilCount++;
      if (!veilSheet) { veilSheet = makeSheet('', null); syncRoot(rootState(doc)); }
      veilSheet.replaceSync('html{visibility:hidden!important}');
      if (veilTimer) win.clearTimeout(veilTimer);
      veilTimer = win.setTimeout(() => { veilCount = 0; veilRelease(); }, 1000);
    }
    function veilRelease() {
      if (veilCount > 0) veilCount--;
      if (veilCount > 0 || !veilSheet) return;
      if (veilTimer) { win.clearTimeout(veilTimer); veilTimer = 0; }
      veilSheet.replaceSync('');
    }
    // Our sheets live at the end of the adopted list: after the page's own.
    function syncRoot(st) {
      const page = Array.from(st.root.adoptedStyleSheets || []).filter((s) => !ours.has(s));
      const mine = [];
      if (st.base) mine.push(st.base);
      for (const src of st.sheets) { const o = sheetOut.get(src); if (o && o.out) mine.push(o.out); }
      if (st.tail) mine.push(st.tail);
      if (st.root === doc && veilSheet) mine.push(veilSheet);
      setAdopted(st.root, page.concat(mine));
    }

    function baseCss(settled) {
      const bg = toCss(convertColor({ r: 255, g: 255, b: 255, a: 1 }, 'bg', look()));
      const fg = toCss(convertColor({ r: 0, g: 0, b: 0, a: 1 }, 'fg', look()));
      const sel = 'rgba(80,140,230,.45)';
      return (settled ? ':where(html){background-color:' + bg + '}' : 'html{background-color:' + bg + '!important}')
        + ':root{color-scheme:dark!important}'
        + ':where(body){color:' + fg + '}'
        + 'input:-webkit-autofill,textarea:-webkit-autofill,select:-webkit-autofill{-webkit-text-fill-color:' + fg + '!important;box-shadow:0 0 0 1000px ' + bg + ' inset!important}'
        + '::selection{background-color:' + sel + '!important;color:#fff!important}'
        + (cfg.keepImages ? '' : 'img,picture,video{filter:brightness(.82) contrast(1.05)}');
    }

    // ---- stylesheet rewriting ----
    function ruleText(rule, depthGuard) {
      if (depthGuard > 8) return '';
      const T = rule.type;
      if (T === 1) { // style rule
        // most rules only lay things out: one test of the text spares reading them declaration by declaration
        const css = rule.style.cssText;
        const body = COLORISH.test(css) ? overrideBlock(css, look(), cfg.keepImages, wantVar) : '';
        let nested = '';
        if (rule.cssRules && rule.cssRules.length) for (const r of rule.cssRules) nested += ruleText(r, depthGuard + 1);
        if (!body && !nested) return '';
        stats.rules++;
        return rule.selectorText + '{' + body + (body && nested ? ';' : '') + nested + '}';
      }
      if (T === 3) { // @import
        const sh = rule.styleSheet;
        if (!sh) return '';
        const inner = sheetText(sh, depthGuard + 1);
        if (!inner) return '';
        const mt = rule.media && rule.media.mediaText;
        return mt && mt !== 'all' ? '@media ' + mt + '{' + inner + '}' : inner;
      }
      if (T === 4) { // the site's own dark design: @media (prefers-color-scheme: dark) is taken as true, light as false
        const scheme = schemeBlock(rule, depthGuard);
        if (scheme !== null) return scheme;
      }
      if (T === 4 || T === 12 || rule.constructor.name === 'CSSContainerRule' || rule.constructor.name === 'CSSScopeRule') { // media / supports / container
        let inner = '';
        for (const r of rule.cssRules) inner += ruleText(r, depthGuard + 1);
        if (!inner) return '';
        const head = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
        return head + '{' + inner + '}';
      }
      if (rule.constructor.name === 'CSSLayerBlockRule') {
        let inner = '';
        for (const r of rule.cssRules) inner += ruleText(r, depthGuard + 1);
        return inner;
      }
      if (T === 7) { // keyframes: the colours of an animation
        let frames = '';
        for (const fr of rule.cssRules) {
          const decls = parseDeclarations(fr.style.cssText);
          const parts = decls.map((d) => {
            const o = overrideDeclaration(d, look(), cfg.keepImages);
            return o ? o.replace(/!important$/, '') : d.name + ':' + d.value;
          });
          frames += fr.keyText + '{' + parts.join(';') + '}';
        }
        return /color|background|fill|stroke|border/i.test(rule.cssText) ? '@keyframes ' + rule.name + '{' + frames + '}' : '';
      }
      return '';
    }
    // A site that ships a dark theme keeps it in @media (prefers-color-scheme: dark). Those rules are what the
    // site's own designers made for dark, so they are applied as they are (every declaration important, to stand
    // above our own converted copy of the light rules), with the dark condition taken as true; a block for light
    // is dropped. Returns null for a media rule that has nothing to do with the colour scheme (or that says it
    // in a way not understood: a list, "not").
    function schemeBlock(rule, depthGuard) {
      const cond = String(rule.conditionText || (rule.media && rule.media.mediaText) || '');
      const m = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/i.exec(cond);
      if (!m || cond.indexOf(',') >= 0 || /\bnot\b|\bor\b/i.test(cond)) return null;
      if (m[1].toLowerCase() === 'light') return '';
      const rest = cond.split(/\s+and\s+/i).map(p => p.trim()).filter(p => !/^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i.test(p)).join(' and ');
      let inner = '';
      for (const r of rule.cssRules) inner += nativeText(r, depthGuard + 1);
      if (!inner) return '';
      return rest ? '@media ' + rest + '{' + inner + '}' : inner;
    }
    function nativeText(rule, depthGuard) {
      if (depthGuard > 8) return '';
      if (rule.type === 1) {
        const decls = parseDeclarations(rule.style.cssText);
        const out = [];
        for (const d of decls) {
          out.push(d.name + ':' + d.value + '!important');
          if (d.name.startsWith('--') && wantVar(d.name)) for (const t of identityTwins(d.name, d.value)) out.push(t);
        }
        return out.length ? rule.selectorText + '{' + out.join(';') + '}' : '';
      }
      if (rule.cssRules && (rule.type === 4 || rule.type === 12 || rule.constructor.name === 'CSSContainerRule')) {
        let inner = '';
        for (const r of rule.cssRules) inner += nativeText(r, depthGuard + 1);
        if (!inner) return '';
        return rule.cssText.slice(0, rule.cssText.indexOf('{')).trim() + '{' + inner + '}';
      }
      return '';
    }
    function sheetText(sheet, depthGuard) {
      let rules;
      try { rules = sheet.cssRules; } catch (err) { return null; }
      let text = '';
      for (const r of rules) text += ruleText(r, depthGuard);
      return text;
    }
    function sheetMedia(sheet) {
      try { return String((sheet.media && sheet.media.mediaText) || '').trim(); } catch (err) { return ''; }
    }
    const DARK_ONLY = /^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i;
    const LIGHT_ONLY = /^\(\s*prefers-color-scheme\s*:\s*light\s*\)$/i;
    function mediaWrap(mt, text) {
      if (!mt || mt === 'all' || DARK_ONLY.test(mt)) return text;
      if (/^print$/i.test(mt)) return '';
      return '@media ' + mt + '{' + text + '}';
    }

    function processSheet(st, sheet) {
      if (ours.has(sheet) || sheet.disabled) return;
      let count = -1;
      try { count = sheet.cssRules.length; } catch (err) { count = -1; }
      if (count < 0) { unreadable(st, sheet); return; }
      const prev = sheetOut.get(sheet);
      if (prev && prev.count === count && prev.key === cfg.key) return;
      const t0 = nowMs();
      const mt = sheetMedia(sheet);
      let text = '';
      if (DARK_ONLY.test(mt)) { for (const r of sheet.cssRules) text += nativeText(r, 0); } // a stylesheet the site made for dark
      else if (!LIGHT_ONLY.test(mt)) text = sheetText(sheet, 0);
      const wrapped = mediaWrap(mt, text || '');
      let o = prev;
      if (!o) { o = { out: makeSheet('', sheet.href), count: 0, key: '' }; sheetOut.set(sheet, o); }
      const tSync = nowMs();
      try { o.out.replaceSync(wrapped); } catch (err) { env.error('could not build the dark copy of a stylesheet', err); }
      stats.msBrowserParse += nowMs() - tSync; stats.outChars += wrapped.length;
      if (env.debug) (stats.log || (stats.log = [])).push({ href: String(sheet.href || 'inline').slice(-48), rules: count, ms: Math.round((nowMs() - t0) * 10) / 10, out: wrapped.length, redo: !!prev });
      o.count = count; o.key = cfg.key;
      st.sheets.add(sheet);
      stats.sheets = st.sheets.size;
      stats.ms += nowMs() - t0;
      stats.msSheets += nowMs() - t0;
      stats.passes++;
    }
    // A sheet another origin owns cannot be read rule by rule. The audit pass
    // (computed styles) covers what it styles.
    function unreadable(st, sheet) { st.unreadable = (st.unreadable || 0) + 1; }

    // ---- which variables need a converted twin ----
    // A design system defines thousands of variables and a page uses a few hundred as colours. A twin is written
    // only for a variable that some colour declaration uses (directly or through another variable's value).
    const usedVars = new Set(); const defRefs = new Map(); const defIndex = new Map();
    let newlyUsed = []; let scanned = new WeakMap();
    const wantVar = (name) => usedVars.has(name);
    function markUsed(name) {
      if (usedVars.has(name)) return;
      usedVars.add(name); newlyUsed.push(name);
      const refs = defRefs.get(name);
      if (refs) for (const r of refs) markUsed(r);
    }
    function noteDeclaration(d, sheet) {
      if (d.name.startsWith('--')) {
        let owners = defIndex.get(d.name);
        if (!owners) defIndex.set(d.name, owners = new Set());
        owners.add(sheet);
        if (d.value.indexOf('var(') >= 0) {
          let refs = defRefs.get(d.name);
          for (const r of varRefs(d.value)) {
            if (!refs) defRefs.set(d.name, refs = new Set());
            refs.add(r);
            if (usedVars.has(d.name)) markUsed(r);
          }
        }
      } else if (d.value.indexOf('var(') >= 0 && isColorProp(d.name)) {
        for (const r of varRefs(d.value)) markUsed(r);
      }
    }
    function scanRules(rules, sheet, depth) {
      if (depth > 8) return;
      for (const rule of rules) {
        if (rule.type === 1) {
          const css = rule.style.cssText;
          if (COLORISH.test(css)) for (const d of parseDeclarations(css)) noteDeclaration(d, sheet);
          if (rule.cssRules && rule.cssRules.length) scanRules(rule.cssRules, sheet, depth + 1);
        } else if (rule.type === 3) { if (rule.styleSheet) scanSheet(rule.styleSheet, sheet, depth + 1); }
        else if (rule.cssRules && rule.type !== 7) scanRules(rule.cssRules, sheet, depth + 1);
      }
    }
    function scanSheet(sheet, owner, depth) {
      let rules;
      try { rules = sheet.cssRules; } catch (err) { return; }
      scanRules(rules, owner || sheet, depth || 0);
    }
    function scanNew(sheet) {
      let n = -1;
      try { n = sheet.cssRules.length; } catch (err) { return; }
      if (scanned.get(sheet) === n) return;
      scanned.set(sheet, n);
      const t0 = nowMs();
      scanSheet(sheet, null, 0);
      stats.msSheets += nowMs() - t0; stats.ms += nowMs() - t0;
    }
    // A sheet already copied that defines a variable which has become used since needs its copy again.
    function dirtyForNewVars() {
      if (!newlyUsed.length) return;
      for (const name of newlyUsed) {
        const owners = defIndex.get(name);
        if (owners) for (const s of owners) { const o = sheetOut.get(s); if (o) o.count = -1; }
      }
      newlyUsed = [];
    }

    function collectSheets(st) {
      const list = st.root.styleSheets;
      const adopted = st.root.adoptedStyleSheets;
      for (let i = 0; i < list.length; i++) if (!ours.has(list[i]) && !list[i].disabled) scanNew(list[i]);
      for (let i = 0; i < adopted.length; i++) if (!ours.has(adopted[i])) scanNew(adopted[i]);
      dirtyForNewVars();
      for (let i = 0; i < list.length; i++) processSheet(st, list[i]);
      // an adopted sheet of the page's own
      for (let i = 0; i < adopted.length; i++) if (!ours.has(adopted[i])) processSheet(st, adopted[i]);
      // sheets removed from the page: forget them
      for (const s of Array.from(st.sheets)) {
        let live = false;
        for (let i = 0; i < list.length; i++) if (list[i] === s) { live = true; break; }
        if (!live) for (let i = 0; i < adopted.length; i++) if (adopted[i] === s) { live = true; break; }
        if (!live) st.sheets.delete(s);
      }
      syncRoot(st);
    }
    function collectAll() {
      for (const st of roots.values()) collectSheets(st);
      if (nowMs() - lastDiscover > 300) discoverShadowRoots();
    }

    let lastDiscover = -1000;
    function discoverShadowRoots() {
      lastDiscover = nowMs();
      let found = false;
      // custom elements first: the cheap check that finds nearly every shadow root
      const customs = doc.querySelectorAll('*');
      for (let i = 0; i < customs.length; i++) {
        const el = customs[i];
        if (el.localName.indexOf('-') < 0 && !el.shadowRoot) continue;
        const sr = el.shadowRoot;
        if (sr && !roots.has(sr)) { adopt(sr); found = true; }
      }
      return found;
    }
    function adopt(root) {
      const st = rootState(root);
      st.base = makeSheet(baseCssFor(root));
      st.tail = makeSheet('');
      collectSheets(st);
      if (observer) { try { observer.observe(root, { childList: true, subtree: true }); } catch (err) { env.error('cannot watch a shadow root', err); } }
      for (const el of root.querySelectorAll('*')) queueAudit(el);
      scheduleAudit();
    }
    function baseCssFor(root) {
      if (root === doc) return baseCss(false);
      return ':host{color-scheme:dark}';
    }

    // ---- the audit: what rules did not reach ----
    function queueAudit(el) {
      if (auditQueued.has(el)) return;
      auditQueued.add(el);
      auditQueue.push(el);
    }
    function scheduleAudit(delay) {
      if (auditTimer || !active || paused) return;
      const run = () => { auditTimer = 0; runAudit(); };
      auditTimer = win.setTimeout(run, delay == null ? 30 : delay);
    }
    // What is painted behind an element's text, as an opaque colour; null when a
    // picture or gradient is behind it (not knowable from here).
    // Remembered for the length of one audit slice (an element's answer builds on its parent's).
    let bgMemo = new WeakMap();
    function effectiveBackground(el) {
      if (!el || el.nodeType !== 1) return base();
      if (bgMemo.has(el)) return bgMemo.get(el);
      const cs = win.getComputedStyle(el);
      let result;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') result = null;
      else {
        const c = parseColor(cs.backgroundColor);
        if (c && c.a >= 0.99) result = c;
        else {
          let parent = el.parentNode;
          if (parent && parent.nodeType === 11) parent = parent.host;
          const under = parent && parent.nodeType === 1 ? effectiveBackground(parent) : base();
          result = under === null ? null : (c && c.a > 0 ? over(c, under) : under);
        }
      }
      bgMemo.set(el, result);
      return result;
    }
    function base() { return convertColor({ r: 255, g: 255, b: 255, a: 1 }, 'bg', look()); }
    const RAISE = ':not(#vexdm):not(#vexdm):not(#vexdm)';
    const PALETTE_PROP = { bg: 'background-color', fg: 'color', bd: 'border-color', fill: 'fill' };
    function paletteAttr(kind, rgbaText) {
      const map = palette[kind];
      let idx = map.get(rgbaText);
      if (idx === undefined) {
        idx = map.size + 1;
        map.set(rgbaText, idx);
        const prop = PALETTE_PROP[kind];
        // The :not(#x) terms only raise the specificity (an id each): this fix must beat the copy of the page's own rule it follows.
        const rule = '[data-vexdm-' + kind + '="' + idx + '"]' + RAISE + '{' + prop + ':' + rgbaText + '!important}';
        const st = roots.get(doc);
        pendingTail.push(rule);
        if (st) flushTail();
      }
      return idx;
    }
    const pendingTail = [];
    let tailText = '';
    function flushTail() {
      if (!pendingTail.length) return;
      tailText += pendingTail.splice(0).join('');
      for (const st of roots.values()) if (st.tail) { try { st.tail.replaceSync(tailText); } catch (err) { env.error('cannot update the fix table', err); } }
    }
    function mark(el, kind, idx) {
      el.setAttribute('data-vexdm-' + kind, String(idx));
      marked.add(el);
      stats.fixes++;
    }
    function nearlyBlankText(el) {
      for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return false;
      return true;
    }

    function auditElement(el) {
      if (el.nodeType !== 1) return;
      const tag = el.localName;
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'head' || tag === 'title' || tag === 'noscript') return;
      if (tag === 'img' || tag === 'picture' || tag === 'video' || tag === 'canvas' || tag === 'iframe' || tag === 'embed' || tag === 'object') {
        if (tag === 'img') auditImage(el);
        return;
      }
      stats.audited++;
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none') return;
      // legacy attributes and inline styles that no rule covers are seen here
      // too: the computed value is the truth.
      const bgc = parseColor(cs.backgroundColor);
      if (bgc && bgc.a > 0.6 && cs.backgroundImage === 'none') {
        const l = rgbToHsl(bgc.r, bgc.g, bgc.b).l;
        if (l > 0.55) {
          const conv = toCss(convertColor(bgc, 'bg', look()));
          mark(el, 'bg', paletteAttr('bg', conv));
          bgMemo.delete(el); // its own answer has changed; its children ask after it
        }
      }
      if (!nearlyBlankText(el) || el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select' || el.localName === 'button') {
        const fg = parseColor(cs.color);
        if (fg) {
          const bg = effectiveBackground(el);
          if (bg) {
            const ratio = contrast(over(fg, bg), bg);
            if (ratio < 4.0) {
              const fixed = readableOn(fg, bg);
              if (fixed) mark(el, 'fg', paletteAttr('fg', toCss(fixed)));
            }
          }
        }
      }
      const bd = parseColor(cs.borderTopColor);
      if (bd && bd.a > 0.5 && parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') {
        const l = rgbToHsl(bd.r, bd.g, bd.b).l;
        if (l > 0.55) mark(el, 'bd', paletteAttr('bd', toCss(convertColor(bd, 'bd', look()))));
      }
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && /^(path|circle|rect|polygon|ellipse|line|polyline|g|text|use)$/.test(tag)) {
        const f = parseColor(cs.fill);
        if (f && f.a > 0.5 && rgbToHsl(f.r, f.g, f.b).l < 0.35) {
          const bgSvg = effectiveBackground(el);
          if (bgSvg && luminance(bgSvg) < 0.4) mark(el, 'fill', paletteAttr('fill', toCss(mapForeground(f))));
        }
      }
    }
    // the lightest change that gives text 4.5:1 on its background
    // Lighter on a dark ground, darker on a light one (a yellow button keeps dark text).
    function readableOn(fg, bg) {
      const hsl = rgbToHsl(fg.r, fg.g, fg.b);
      const lighter = luminance(bg) <= 0.179;
      for (let step = 0; step <= 24; step++) {
        const l = clamp(lighter ? Math.max(hsl.l, 0.4) + step * 0.025 : Math.min(hsl.l, 0.6) - step * 0.025, 0, 1);
        const c = hslToRgb(hsl.h, hsl.s * 0.9, l);
        if (contrast(c, bg) >= 4.5) return { ...c, a: 1 };
      }
      return lighter ? { r: 236, g: 233, b: 228, a: 1 } : { r: 20, g: 20, b: 20, a: 1 };
    }

    function runAudit() {
      if (!active || paused) return;
      const t0 = nowMs();
      let n = 0;
      bgMemo = new WeakMap();
      while (auditQueue.length && nowMs() - t0 < 8 && n < 600) {
        const el = auditQueue.shift();
        n++;
        if (!el.isConnected || auditDone.has(el)) continue;
        auditDone.add(el);
        try { auditElement(el); } catch (err) { env.error('audit of an element failed', err); }
      }
      flushTail();
      stats.ms += nowMs() - t0;
      stats.msAudit += nowMs() - t0;
      if (auditQueue.length) scheduleAudit(16);
      else reportState();
    }
    function queueSubtree(node) {
      if (node.nodeType !== 1) return;
      queueAudit(node);
      const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      const cap = Math.min(all.length, 4000);
      for (let i = 0; i < cap; i++) queueAudit(all[i]);
    }

    // ---- logos: a small transparent dark image gets inverted ----
    const imageVerdict = new Map(); // src -> 'logo' | 'photo'
    function auditImage(img) {
      if (!cfg.invertLogos) return;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:image/gif')) return;
      if (imageVerdict.has(src)) { if (imageVerdict.get(src) === 'logo') applyLogo(img); return; }
      const run = () => {
        if (imageVerdict.has(src)) { if (imageVerdict.get(src) === 'logo') applyLogo(img); return; }
        const w = img.naturalWidth; const h = img.naturalHeight;
        if (!w || !h || w > 700 || h > 400) { imageVerdict.set(src, 'photo'); return; }
        analyseImage(img, src).then((v) => {
          imageVerdict.set(src, v);
          if (v === 'logo') applyLogo(img);
        }, () => { imageVerdict.set(src, 'photo'); });
      };
      if (img.complete) run(); else img.addEventListener('load', run, { once: true });
    }
    function applyLogo(img) {
      if (img.hasAttribute('data-vexdm-img')) return;
      img.setAttribute('data-vexdm-img', 'logo');
      marked.add(img);
      stats.logos++;
      logoRule();
    }
    let logoRuleOn = false;
    function logoRule() {
      if (logoRuleOn) return;
      logoRuleOn = true;
      pendingTail.push('img[data-vexdm-img="logo"]' + RAISE + '{filter:invert(1) hue-rotate(180deg)!important}');
      flushTail();
    }
    // 'logo' (line art on transparency, dark ink) or 'photo'. Throws when the
    // pixels cannot be read (a tainted canvas: a picture of another origin).
    function classifyPixels(im) {
      const cw = 48; const ch = Math.min(96, Math.max(8, Math.round(48 * (im.naturalHeight / im.naturalWidth))));
      const cv = doc.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(im, 0, 0, cw, ch);
      const px = ctx.getImageData(0, 0, cw, ch).data;
      let opaque = 0; let transparent = 0; let lumSum = 0; let colorful = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 40) { transparent++; continue; }
        opaque++;
        lumSum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 60) colorful++;
      }
      if (!opaque) return 'photo';
      // line art: a lot of transparency, dark ink, not mostly colour
      return transparent / (cw * ch) > 0.25 && lumSum / opaque < 0.4 && colorful / opaque < 0.6 ? 'logo' : 'photo';
    }
    function analyseImage(img, src) {
      return new Promise((resolve, reject) => {
        let verdict = null;
        try { verdict = classifyPixels(img); } catch (err) { verdict = null; /* vex-allow-empty-catch: a picture of another origin cannot be read; a copy loaded with CORS is the second try below */ }
        if (verdict) { resolve(verdict); return; }
        const copy = new win.Image();
        copy.crossOrigin = 'anonymous';
        copy.onload = () => { try { resolve(classifyPixels(copy)); } catch (err) { reject(err); } };
        copy.onerror = () => reject(new Error('the picture cannot be read'));
        copy.src = src;
      });
    }

    // ---- is the page dark already? ----
    function suspendOurs() {
      const saved = [];
      for (const st of roots.values()) {
        const list = Array.from(st.root.adoptedStyleSheets || []);
        saved.push([st, list]);
        setAdopted(st.root, list.filter((s) => !ours.has(s)));
      }
      const attrs = [];
      for (const el of marked) {
        for (const k of ATTR_KINDS) { const v = el.getAttribute('data-vexdm-' + k); if (v !== null) { attrs.push([el, k, v]); el.removeAttribute('data-vexdm-' + k); } }
      }
      return () => { for (const [st, list] of saved) setAdopted(st.root, list); for (const [el, k, v] of attrs) el.setAttribute('data-vexdm-' + k, v); };
    }
    function isDarkBg(c) { return luminance(c) < 0.16; }
    function pageIsDark() {
      const html = doc.documentElement; const body = doc.body;
      if (!html) return false;
      const hcs = win.getComputedStyle(html);
      const scheme = (hcs.colorScheme || '');
      let canvas = /dark/.test(scheme) && !/light/.test(scheme.replace(/dark/, '')) ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
      // The canvas is the root's background, or the body's when the root has none (it is handed up).
      const rootBg = parseColor(hcs.backgroundColor);
      const bodyBg = body ? parseColor(win.getComputedStyle(body).backgroundColor) : null;
      if (rootBg && rootBg.a > 0.99) canvas = rootBg;
      else if (bodyBg && bodyBg.a > 0.99) canvas = bodyBg;
      const samples = [];
      const pts = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.5, 0.8], [0.15, 0.6], [0.85, 0.6]];
      const vw = win.innerWidth || 800; const vh = win.innerHeight || 600;
      for (const [fx, fy] of pts) {
        let el = null;
        try { el = doc.elementFromPoint(vw * fx, vh * fy); } catch (err) { el = null; }
        if (!el) continue;
        samples.push(chainBackground(el, canvas));
      }
      if (body) samples.push(chainBackground(body, canvas));
      const known = samples.filter(Boolean);
      if (!known.length) return false;
      const dark = known.filter(isDarkBg).length;
      return dark / known.length >= 0.6;
    }
    function chainBackground(el, canvas) {
      let cur = el; let acc = null; let d = 0;
      while (cur && cur.nodeType === 1 && d < 60) {
        const cs = win.getComputedStyle(cur);
        if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/^linear-gradient|^radial-gradient/.test(cs.backgroundImage)) return null;
        const c = parseColor(cs.backgroundColor);
        if (c && c.a > 0) {
          acc = acc ? over(acc, over(c, canvas)) : c;
          if (acc.a >= 0.99) return over(acc, canvas);
        }
        cur = cur.parentElement; d++;
      }
      return acc ? over(acc, canvas) : canvas;
    }
    function checkPageDark() {
      if (!active) return;
      const darkReader = !!doc.querySelector('meta[name="darkreader"]');
      if (darkReader) { setPaused('dark-reader'); return; }
      if (paused === 'dark-reader') setPaused(null); // it went away: judge the page as any other
      const t0 = nowMs();
      lastJudged = t0;
      const restore = suspendOurs();
      let dark = false;
      try { dark = pageIsDark(); } catch (err) { env.error('could not tell whether the page is dark', err); }
      restore();
      stats.msDetect += nowMs() - t0;
      if (dark && !paused) setPaused('already-dark');
      else if (!dark && paused === 'already-dark') setPaused(null);
    }
    function clearMarks() {
      for (const el of marked) { for (const k of ATTR_KINDS) el.removeAttribute('data-vexdm-' + k); }
      marked.clear();
    }
    function dropOurSheets() {
      for (const st of roots.values()) setAdopted(st.root, Array.from(st.root.adoptedStyleSheets || []).filter((s) => !ours.has(s)));
    }
    function setPaused(why) {
      if (why === paused) return;
      paused = why;
      if (why) {
        dropOurSheets();
        clearMarks();
        auditDone = new WeakSet(); auditQueued = new WeakSet(); auditQueue.length = 0;
        stopWork();
        // while left alone, only Dark Reader's marker coming or going is worth hearing about
        observer = new win.MutationObserver((records) => {
          for (const rec of records) for (const n of [...rec.removedNodes, ...rec.addedNodes]) if (n.nodeType === 1 && n.localName === 'meta' && n.name === 'darkreader') { scheduleRecheck(0); return; }
        });
        if (doc.head) observer.observe(doc.head, { childList: true });
      } else {
        for (const st of roots.values()) syncRoot(st);
        collectAll();
        queueSubtree(doc.documentElement);
        watchDom();
        scheduleAudit(0);
      }
      reportState();
    }
    // Judging the page means taking our sheets off and putting them back: at most about once a second.
    let lastJudged = -10000;
    function scheduleRecheck(delay) {
      if (recheckTimer || !active) return;
      const wait = Math.max(delay == null ? 120 : delay, lastJudged + 1000 - nowMs());
      recheckTimer = win.setTimeout(() => { recheckTimer = 0; checkPageDark(); }, wait);
    }

    // ---- watching the page ----
    const THEME_ATTRS = ['class', 'data-theme', 'data-color-mode', 'data-bs-theme', 'data-mode', 'data-color-scheme', 'theme', 'style', 'color-scheme'];
    function stopWork() {
      if (observer) { observer.disconnect(); observer = null; }
      if (pollTimer) { win.clearInterval(pollTimer); pollTimer = 0; }
      if (auditTimer) { win.clearTimeout(auditTimer); auditTimer = 0; }
    }
    // The page switching its own dark mode shows on the root or the body.
    // Only a change that can be the site's own light/dark switch is worth judging the page again: a class or style
    // that toggles on the body all the time (a menu open, scrolling locked) is not.
    const THEMEISH = /dark|light|theme|night|mode|scheme|contrast|colou?r|bg|background/i;
    function themeRelevant(rec) {
      const name = rec.attributeName;
      const now = rec.target.getAttribute(name) || '';
      const before = rec.oldValue || '';
      if (now === before) return false;
      if (name === 'class') {
        const a = new Set(before.split(/\s+/)); const b = new Set(now.split(/\s+/));
        for (const t of a) if (!b.has(t) && THEMEISH.test(t)) return true;
        for (const t of b) if (!a.has(t) && THEMEISH.test(t)) return true;
        return false;
      }
      if (name === 'style') return /color-scheme|background|--/i.test(before) || /color-scheme|background|--/i.test(now);
      return true; // data-theme, data-color-mode ...: a switch by its very name
    }
    function watchAttrs() {
      if (attrObserver) attrObserver.disconnect();
      attrObserver = new win.MutationObserver((records) => { for (const rec of records) if (themeRelevant(rec)) { scheduleRecheck(); break; } });
      const opts = { attributes: true, attributeFilter: THEME_ATTRS, attributeOldValue: true };
      if (doc.documentElement) attrObserver.observe(doc.documentElement, opts);
      if (doc.body) { attrObserver.observe(doc.body, opts); watchedBody = doc.body; }
    }
    let watchedBody = null;
    function watchDom() {
      if (observer) observer.disconnect();
      observer = new win.MutationObserver((records) => {
        let sheetsChanged = false;
        for (const rec of records) {
          const tgt = rec.target;
          if (tgt.localName === 'style' || tgt.localName === 'link') sheetsChanged = true;
          for (const node of rec.removedNodes) if (node.nodeType === 1 && node.localName === 'meta' && node.name === 'darkreader') scheduleRecheck(0); // Dark Reader left
          for (const node of rec.addedNodes) {
            if (node.nodeType !== 1) continue;
            const ln = node.localName;
            if (ln === 'style' || (ln === 'link' && /stylesheet/i.test(node.rel || ''))) {
              sheetsChanged = true;
              if (ln === 'link' && !node.sheet && !paused) {
                // A stylesheet that lands can be painted a frame before its load event lets us copy it dark: the page
                // is held out of sight (the canvas is dark already) until it has been, or for a second at most.
                veilHold();
                const done = () => { if (active && !paused) collectAll(); veilRelease(); };
                node.addEventListener('load', done, { once: true });
                node.addEventListener('error', veilRelease, { once: true });
              }
            } else if (ln === 'meta' && node.name === 'darkreader') scheduleRecheck(0); // Dark Reader arrived on the page
            else queueSubtree(node);
          }
        }
        if (sheetsChanged) collectAll();
        if (auditQueue.length) scheduleAudit();
        if (doc.body && doc.body !== watchedBody) watchAttrs();
      });
      observer.observe(doc, { childList: true, subtree: true });
      for (const st of roots.values()) if (st.root !== doc) { try { observer.observe(st.root, { childList: true, subtree: true }); } catch (err) { env.error('cannot watch a shadow root', err); } }
      // CSS-in-JS grows a sheet without touching the DOM, and a shadow root
      // appears without a mutation: a slow poll of cheap counters covers both.
      if (pollTimer) win.clearInterval(pollTimer);
      let ticks = 0;
      pollTimer = win.setInterval(() => {
        if (doc.hidden) return;
        ticks++;
        let changed = false;
        for (const st of roots.values()) {
          for (const s of st.sheets) {
            const o = sheetOut.get(s);
            let c = -1; try { c = s.cssRules.length; } catch (err) { c = -1; }
            if (o && c >= 0 && c !== o.count) { changed = true; break; }
          }
          if (changed) break;
          const live = st.root.styleSheets ? st.root.styleSheets.length : 0;
          if (live !== (st.liveCount || 0)) { st.liveCount = live; changed = true; break; }
        }
        if (changed) collectAll();
        else if (ticks < 12 || ticks % 6 === 0) discoverShadowRoots();
      }, 1200);
    }

    // ---- life cycle ----
    function applySimple() {
      const f = [];
      const b = cfg.look.brightness; const c = cfg.look.contrast; const s = cfg.look.sepia;
      if (b !== 100) f.push('brightness(' + b / 100 + ')');
      if (c !== 100) f.push('contrast(' + c / 100 + ')');
      if (s) f.push('sepia(' + s / 100 + ')');
      let css = SIMPLE_CSS.replace(' FILTERS', f.length ? ' ' + f.join(' ') : '');
      if (!cfg.keepImages) css = css.split('}')[0] + '}';
      const sheet = simpleSheet || (simpleSheet = new win.CSSStyleSheet());
      sheet.replaceSync(css);
      const list = Array.from(doc.adoptedStyleSheets || []).filter((s2) => s2 !== sheet);
      setAdopted(doc, list.concat([sheet]));
    }
    function dropSimple() {
      if (!simpleSheet) return;
      const sheet = simpleSheet;
      simpleSheet = null;
      setAdopted(doc, Array.from(doc.adoptedStyleSheets || []).filter((s) => s !== sheet));
    }
    function start(next) {
      if (!doc.documentElement) throw new Error('start() needs the root element');
      const wasActive = active;
      const keyOf = (c) => [c.engine, c.look.brightness, c.look.contrast, c.look.sepia, c.keepImages, c.invertLogos].join('|');
      const prevKey = cfg ? cfg.key : null;
      cfg = Object.assign({ engine: 'smart', look: DEFAULT_LOOK, keepImages: true, invertLogos: true }, next);
      cfg.look = Object.assign({}, DEFAULT_LOOK, next.look || {});
      cfg.key = keyOf(cfg);
      active = true;
      if (cfg.engine === 'simple') {
        teardownSmart();
        applySimple();
        reportState();
        return;
      }
      dropSimple();
      if (wasActive && prevKey === cfg.key) { reportState(); return; }
      if (wasActive) teardownSmart();
      const st = rootState(doc);
      st.base = makeSheet(baseCss(false));
      st.tail = makeSheet('');
      tailText = ''; pendingTail.length = 0; logoRuleOn = false;
      for (const k of Object.keys(palette)) palette[k].clear();
      syncRoot(st);
      collectAll();
      watchAttrs();
      watchDom();
      queueSubtree(doc.documentElement);
      scheduleAudit(0);
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', afterParsed, { once: true });
      else afterParsed();
      win.addEventListener('load', afterLoad, { once: true });
      reportState();
    }
    function afterParsed() {
      if (!active) return;
      collectAll();
      discoverShadowRoots();
      checkPageDark();
      // the page's first sheets are in: the base can settle (no !important root colour)
      const st = roots.get(doc);
      if (st && st.base && !paused) { try { st.base.replaceSync(baseCss(true)); } catch (err) { env.error('cannot settle the base sheet', err); } }
      scheduleAudit(0);
      reportState();
    }
    // A page that builds itself with script is judged again once it has drawn.
    function afterLoad() {
      if (!active) return;
      collectAll();
      discoverShadowRoots();
      queueSubtree(doc.documentElement);
      scheduleAudit(0);
      scheduleRecheck(700);
      reportState();
    }
    function teardownSmart() {
      stopWork();
      if (attrObserver) { attrObserver.disconnect(); attrObserver = null; }
      watchedBody = null;
      if (recheckTimer) { win.clearTimeout(recheckTimer); recheckTimer = 0; }
      dropOurSheets();
      clearMarks();
      roots.clear();
      ours.clear();
      sheetOut = new WeakMap();
      if (veilTimer) { win.clearTimeout(veilTimer); veilTimer = 0; }
      veilSheet = null; veilCount = 0;
      usedVars.clear(); defRefs.clear(); defIndex.clear(); newlyUsed = []; scanned = new WeakMap();
      auditQueue.length = 0; auditQueued = new WeakSet(); auditDone = new WeakSet();
      imageVerdict.clear();
      paused = null;
    }
    function stop() {
      if (!active) return;
      teardownSmart();
      dropSimple();
      active = false;
      reportState();
    }
    function reportState() {
      const st = active ? { active: true, paused, engine: cfg.engine, rules: stats.rules, sheets: stats.sheets, audited: stats.audited, fixes: stats.fixes, logos: stats.logos, ms: Math.round(stats.ms * 10) / 10 } : { active: false };
      const key = JSON.stringify(st);
      if (key === lastStateKey) return;
      lastStateKey = key;
      report(st);
    }
    const self = { start, stop, state: () => ({ active, paused, stats: { ...stats }, queued: auditQueue.length, sheets: Array.from(roots.values()).map((r) => r.sheets.size) }) };
    if (env.debug) self._debug = { runAudit, collectAll };
    return self;
  }

  const api = {
    parseColor, toCss, convertColor, convertValue, overrideBlock, overrideDeclaration, parseDeclarations, varTwins,
    parseChannelTriple, mapBackground, mapForeground, mapBorder, contrast, luminance, tone, createEngine, DEFAULT_LOOK, NAMED,
  };
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') { module.exports = api; return; }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --- the preload ----------------------------------------------------------
  if (typeof window === 'undefined' || typeof location === 'undefined' || typeof document === 'undefined') return;
  // Never in an extension's page (the PDF viewer broke exactly because
  // preloads ran in its frame), Vex's own pages, a sub-frame, or a page that is
  // not HTML.
  if (window.top !== window) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  const ctype = document.contentType;
  if (ctype && ctype !== 'text/html' && ctype !== 'application/xhtml+xml') return;
  let ipcRenderer;
  try { ({ ipcRenderer } = require('electron')); } catch (err) { return; }
  if (!ipcRenderer) return;

  let decision = null;
  try { decision = ipcRenderer.sendSync('darkmode:page'); } catch (err) { console.error('[Dark mode] could not ask Vex whether this page gets dark mode:', err && err.message); return; }

  let engine = null;
  const env = {
    window, document,
    report: (s) => { try { ipcRenderer.sendToHost('vex-darkmode:state', s); } catch (err) { console.error('[Dark mode] could not tell the tab:', err && err.message); } },
    error: (what, err) => console.error('[Dark mode] ' + what + ':', err && err.message),
    // Only a probe sets this (a decision with debug: true); it leaves the engine in this preload's own world, out of the page's sight.
    debug: !!(decision && decision.debug),
  };
  function get() {
    if (!engine) { engine = createEngine(env); if (env.debug) window.__vexdm = engine; }
    return engine;
  }
  function whenRoot(fn) {
    if (document.documentElement) { fn(); return; }
    const obs = new MutationObserver(() => {
      if (!document.documentElement) return;
      obs.disconnect();
      fn();
    });
    obs.observe(document, { childList: true });
  }
  function apply(d) {
    if (!d || !d.on) { if (engine) engine.stop(); return; }
    whenRoot(() => { try { get().start(d); } catch (err) { console.error('[Dark mode] could not start:', err && err.message); } });
  }
  // A toggle, a Settings change or Preview: the tab sends the new decision for
  // this very page.
  ipcRenderer.on('vex-darkmode:set', (_event, d) => apply(d));
  ipcRenderer.on('vex-darkmode:ping', () => { if (engine) { const s = engine.state(); env.report(s.active ? { active: true, paused: s.paused, ...s.stats } : { active: false }); } else env.report({ active: false }); });
  if (decision && decision.on) apply(decision);
})();
