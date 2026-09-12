#!/usr/bin/env node
// UI self-check: launches the REAL Vex app and measures the REAL rendered chrome
// across every GUI style and a sample of colour themes, looking for the classes
// of fault we kept finding by hand — an icon that vanishes on some themes, two
// buttons overlapping, an unread badge sitting on top of its icon, a target too
// small to hit, a control clipped by its container, and colour clashes between
// the GUI "looks" and the colour themes.
//
// Usage:
//   node scripts/check-ui.js               (or: npm run check:ui)
//   node scripts/check-ui.js --full        sweep every ThemeManager theme
//   node scripts/check-ui.js --style=win98 limit to one GUI style
//   node scripts/check-ui.js --json        machine-readable findings
//   node scripts/check-ui.js --keep-open   leave the app running to poke at
//
// Exit codes (the two failure kinds are deliberately distinguishable):
//   0  clean
//   1  UI findings were flagged
//   2  harness failure (couldn't launch, couldn't connect, page threw)
//
// THREE MEASUREMENT TRAPS, learned the hard way. Break any of them and the
// numbers below are fiction:
//
//   1. Transitions/animations are disabled before measuring. A window that is
//      hidden or occluded never advances its animations, so getBoundingClientRect
//      freezes mid-transition and reports half-grown controls as "overlapping"
//      or "too small". We pin every element to its final state first.
//   2. We never screenshot. A minimised window cannot be captured and
//      Page.captureScreenshot simply HANGS forever instead of failing. Every
//      measurement here comes from the DOM.
//   3. The onboarding wizard is finished first, and kept finished. Otherwise a
//      full-window overlay (#vex-onboarding, z-index 100060) sits over the whole
//      chrome and NOTHING is hittable. Calling finish() once is not enough:
//      maybeStart() schedules start() on a 900ms timer, so an early dismissal is
//      silently undone when that timer fires. This cost a debugging cycle — the
//      check "passed" on browser looks purely because it was measuring an overlay.
//
// And a fourth rule that keeps findings honest: we only judge an element that
// document.elementFromPoint actually resolves to at its own centre (or to a
// descendant/ancestor of it). An element buried under a panel is not a fault
// the user can see, and flagging it is how a checker earns its ignore list.

'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');

const electronPath = require('electron');
const REPO = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// KNOWN-GOOD EXCEPTIONS — the single list. Every entry needs a reason.
// A finding is dropped when its check, its element selector and (optionally)
// the GUI style all match an entry here.
// ---------------------------------------------------------------------------
const EXCEPTIONS = [
  {
    check: 'tiny-target',
    selector: '#look-sb-max, #look-sb-close',
    styles: ['win98'],
    reason: 'The Windows-98 look\'s caption boxes are authentic at 16x14. ' +
      'gui-browser.css gives each an ::after with inset -4px -2px, so the real ' +
      'hit area is 20x22 — bigger than the 16x16 floor even though the painted box is not.',
  },
];

// ---------------------------------------------------------------------------
// Page-side audit library. Installed once per page, then re-run per sample.
// Deliberately written without template literals so it can live in one here.
// ---------------------------------------------------------------------------
const PAGE_LIB = `
window.__vexCheckUi = (function () {
  'use strict';

  var CLICKABLE = 'button, [role=button], a[href], input, select, .sidebar-icon, .tool-icon, .top-tab, .gsc, .tab-close, .new-tab-btn';

  // The horizontal bands of chrome whose text/icons must read against whatever
  // is painted behind them. Vex has no bookmarks BAR (bookmarks are a sidebar
  // panel), so the closest real analogues are the panel launcher and the
  // browser-look shortcuts row that sits where a bookmarks bar would.
  var REGIONS = [
    { name: 'tab strip', sel: '#top-tab-bar' },
    { name: 'toolbar', sel: '#top-bar' },
    { name: 'sidebar', sel: '#icon-sidebar' },
    { name: 'panel launcher', sel: '#tools-bar' },
    { name: 'shortcuts bar', sel: '#gui-shortcuts-bar' }
  ];

  var TEXT_MIN = 4.5;   // WCAG AA, normal text
  var ICON_MIN = 3.0;   // WCAG AA, non-text/graphical objects
  var MIN_TARGET = 16;  // CSS px floor for a clickable
  var OVERLAP_TOL = 2;  // px of overlap we forgive in BOTH axes
  var BADGE_MAX = 0.30; // a badge may cover at most 30% of its icon

  var canvas = null;

  // --- geometry ----------------------------------------------------------
  function rect(el) { return el.getBoundingClientRect(); }

  function isVisible(el) {
    var r = rect(el);
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (effectiveOpacity(el) <= 0.01) return false;
    // Off-screen chrome is not on trial.
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    return true;
  }

  // TRAP 4: only judge what the user can actually reach. elementFromPoint at
  // the centre must land on the element itself, a descendant (its own svg/span)
  // or an ancestor (a wrapper that swallows the hit).
  function isHittable(el) {
    var r = rect(el);
    var x = Math.round(r.left + r.width / 2);
    var y = Math.round(r.top + r.height / 2);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    var hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    return hit === el || el.contains(hit) || hit.contains(el);
  }

  function effectiveOpacity(el) {
    var o = 1, node = el;
    while (node && node.nodeType === 1) {
      var v = parseFloat(getComputedStyle(node).opacity);
      if (!isNaN(v)) o *= v;
      node = node.parentElement;
    }
    return o;
  }

  function intersect(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return { w: w, h: h, area: (w > 0 && h > 0) ? w * h : 0 };
  }

  function describe(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    var label = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
    if (!label) label = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
    if (label) s += ' "' + label + '"';
    // A bare <svg> is indistinguishable from every other bare <svg> in a report,
    // so name the control it sits in.
    if (!el.id && !cls.length && !label) {
      var host = el.closest('button, a, [role=button], .sidebar-icon, .tool-icon, .top-tab');
      if (host && host !== el) {
        var hl = (host.getAttribute('title') || host.getAttribute('aria-label') || '').trim();
        s += ' in ' + host.tagName.toLowerCase() + (host.id ? '#' + host.id : '') + (hl ? ' "' + hl + '"' : '');
      }
    }
    return s;
  }

  function n(v) { return Math.round(v * 10) / 10; }

  // --- colour ------------------------------------------------------------
  // Parse anything getComputedStyle can hand back. rgb()/rgba() is the fast
  // path; oklch() and friends go through a 1x1 canvas, which always yields
  // sRGB bytes. A colour we genuinely cannot read is REPORTED, never skipped
  // silently — a contrast checker that quietly ignores colours is worthless.
  function toRgb(str) {
    str = String(str || '').trim();
    if (!str || str === 'none') return null;
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    var m = str.match(/^rgba?\\(([^)]+)\\)$/);
    if (m) {
      var p = m[1].split(/[,\\/\\s]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3 && p.every(function (x) { return !isNaN(x); })) {
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
    }
    if (!canvas) { canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; }
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    var before = ctx.fillStyle;
    ctx.fillStyle = str;
    if (ctx.fillStyle === before && !/^#0{3,8}$|^black$/i.test(str)) return null; // rejected
    ctx.fillRect(0, 0, 1, 1);
    var d = ctx.getImageData(0, 0, 1, 1).data;
    var a = d[3] / 255;
    // getImageData is premultiplied; undo it so blending below stays correct.
    return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: clamp255(d[0] / a), g: clamp255(d[1] / a), b: clamp255(d[2] / a), a: a };
  }

  // Clamp: un-premultiplying a canvas read (below) can overshoot 255 by a
  // rounding step, and an out-of-gamut background made real ratios nonsense —
  // rgb(36,259,298) reported a readable icon as 1.1:1.
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
  function over(top, under) {
    return {
      r: clamp255(top.r * top.a + under.r * (1 - top.a)),
      g: clamp255(top.g * top.a + under.g * (1 - top.a)),
      b: clamp255(top.b * top.a + under.b * (1 - top.a)),
      a: 1
    };
  }

  // What is ACTUALLY painted behind this element: walk ancestors collecting
  // background layers until something opaque stops us, then composite.
  // A gradient ancestor (XP's and 98's title bands) has no single colour, so
  // the look publishes --b-frame-solid for exactly this purpose.
  function bgBehind(el) {
    var layers = [];
    // Start at the element itself: a chip or pill paints its own background, and
    // that is what sits behind its text. Starting at the parent judged the
    // shortcut bar's white letters against the bar instead of their coloured
    // chip, reporting 1:1 on perfectly readable labels.
    var node = el;
    var usedFrameSolid = false;
    while (node && node.nodeType === 1) {
      var cs = getComputedStyle(node);
      var bi = cs.backgroundImage;
      if (bi && bi !== 'none' && bi.indexOf('gradient') !== -1) {
        var solid = toRgb(cs.getPropertyValue('--b-frame-solid'));
        if (solid && solid.a > 0) { layers.push({ r: solid.r, g: solid.g, b: solid.b, a: 1 }); usedFrameSolid = true; break; }
      }
      var c = toRgb(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    if (!layers.length) return { color: { r: 255, g: 255, b: 255, a: 1 }, assumed: true, usedFrameSolid: usedFrameSolid };
    var out = layers[layers.length - 1];
    if (out.a < 0.999) out = over(out, { r: 255, g: 255, b: 255, a: 1 });
    for (var i = layers.length - 2; i >= 0; i--) out = over(layers[i], out);
    return { color: out, assumed: false, usedFrameSolid: usedFrameSolid };
  }

  function luminance(c) {
    var ch = [c.r, c.g, c.b].map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(fg, bg) {
    var a = luminance(fg) + 0.05, b = luminance(bg) + 0.05;
    return a > b ? a / b : b / a;
  }

  // --- the checks --------------------------------------------------------

  function clickables() {
    return Array.prototype.slice.call(document.querySelectorAll(CLICKABLE))
      .filter(isVisible).filter(isHittable);
  }

  // Overlap needs a WIDER net than the other checks. When one control covers
  // another, the covered one stops being hittable — so filtering by hittability
  // first would drop it and the overlap would go unreported. (Proved: shifting
  // a toolbar button over its neighbour produced no finding until this existed.)
  // Being covered AT YOUR OWN CENTRE BY ANOTHER CLICKABLE is precisely the
  // fault, so such elements stay in; things buried under a panel or webview
  // still drop out, because whatever covers them is not a clickable.
  function overlapCandidates() {
    return Array.prototype.slice.call(document.querySelectorAll(CLICKABLE))
      .filter(isVisible)
      .filter(function (el) {
        if (isHittable(el)) return true;
        var r = rect(el);
        var x = Math.round(r.left + r.width / 2);
        var y = Math.round(r.top + r.height / 2);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        var hit = document.elementFromPoint(x, y);
        return !!(hit && hit.closest && hit.closest(CLICKABLE));
      });
  }

  function checkOverlap(add, els) {
    for (var i = 0; i < els.length; i++) {
      for (var j = i + 1; j < els.length; j++) {
        var a = els[i], b = els[j];
        if (a.contains(b) || b.contains(a)) continue;          // nesting is not overlap
        var ra = rect(a), rb = rect(b);
        var hit = intersect(ra, rb);
        if (hit.w <= OVERLAP_TOL || hit.h <= OVERLAP_TOL) continue;
        add('overlap', describe(a),
          'overlaps ' + describe(b) + ' by ' + n(hit.w) + 'x' + n(hit.h) + 'px',
          { ax: n(ra.left), ay: n(ra.top), aw: n(ra.width), ah: n(ra.height),
            bx: n(rb.left), by: n(rb.top), bw: n(rb.width), bh: n(rb.height) });
      }
    }
  }

  function checkBadges(add) {
    var badges = document.querySelectorAll('.panel-badge, .icon-badge');
    for (var i = 0; i < badges.length; i++) {
      var badge = badges[i];
      if (!isVisible(badge)) continue;
      var host = badge.closest('button, .sidebar-icon, .tool-icon');
      if (!host) continue;
      var icon = host.querySelector('svg, img');
      if (!icon || !isVisible(icon)) continue;
      var ri = rect(icon), rb = rect(badge);
      var area = ri.width * ri.height;
      if (area <= 0) continue;
      var covered = intersect(rb, ri).area / area;
      if (covered > BADGE_MAX) {
        add('badge', describe(badge),
          'covers ' + Math.round(covered * 100) + '% of the icon in ' + describe(host) +
          ' (limit ' + Math.round(BADGE_MAX * 100) + '%)',
          { iconW: n(ri.width), iconH: n(ri.height), badgeW: n(rb.width), badgeH: n(rb.height) });
      }
    }
  }

  function checkTiny(add, els) {
    for (var i = 0; i < els.length; i++) {
      var r = rect(els[i]);
      if (r.width >= MIN_TARGET && r.height >= MIN_TARGET) continue;
      add('tiny-target', describe(els[i]),
        'is ' + n(r.width) + 'x' + n(r.height) + 'px, under the ' + MIN_TARGET + 'x' + MIN_TARGET + ' floor',
        { w: n(r.width), h: n(r.height) }, els[i]);
    }
  }

  function checkUnnamed(add, els) {
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') continue;
      if ((el.textContent || '').trim()) continue;
      if ((el.getAttribute('title') || '').trim()) continue;
      if ((el.getAttribute('aria-label') || '').trim()) continue;
      var by = el.getAttribute('aria-labelledby');
      if (by && document.getElementById(by)) continue;
      add('unnamed', describe(el), 'is an icon-only button with no text, title or aria-label', {}, el);
    }
  }

  // An element poking out of an ancestor that HIDES overflow is clipped.
  // A scrollable ancestor (auto/scroll) is not a fault — that content is reachable.
  function checkClipping(add, els) {
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var r = rect(el);
      var node = el.parentElement;
      while (node && node.nodeType === 1 && node !== document.body) {
        var cs = getComputedStyle(node);
        var ox = cs.overflowX, oy = cs.overflowY;
        var clipsX = (ox === 'hidden' || ox === 'clip');
        var clipsY = (oy === 'hidden' || oy === 'clip');
        if (clipsX || clipsY) {
          var rp = rect(node);
          var outLeft = clipsX ? rp.left - r.left : 0;
          var outRight = clipsX ? r.right - rp.right : 0;
          var outTop = clipsY ? rp.top - r.top : 0;
          var outBottom = clipsY ? r.bottom - rp.bottom : 0;
          var worst = Math.max(outLeft, outRight, outTop, outBottom);
          if (worst > 1) {
            var side = worst === outLeft ? 'left' : worst === outRight ? 'right' : worst === outTop ? 'top' : 'bottom';
            add('clipped', describe(el),
              'sticks ' + n(worst) + 'px past the ' + side + ' edge of ' + describe(node) + ', which hides overflow',
              { overflowPx: n(worst), side: side }, el);
            break;
          }
        }
        node = node.parentElement;
      }
    }
  }

  // What an <svg> icon actually PAINTS with. The computed 'fill' of an <svg>
  // root is black by default, which is NOT what you see: Vex's chrome icons
  // declare stroke/fill="currentColor" and inherit the theme's text colour.
  // Reading cs.fill reported every icon as black-on-dark and was pure noise.
  // Fixed multi-colour artwork (the Vex logo: gradients + hard-coded hex) has
  // no single foreground colour, so one ratio cannot describe it — we skip it
  // rather than invent a number.
  function iconColor(svg) {
    var nodes = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')));
    var sawCurrent = false, sawExplicit = false;
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].getAttribute) continue;
      var vals = [nodes[i].getAttribute('fill'), nodes[i].getAttribute('stroke')];
      for (var k = 0; k < vals.length; k++) {
        var v = vals[k];
        if (!v || v === 'none') continue;
        if (/^currentcolor$/i.test(v)) sawCurrent = true;
        else sawExplicit = true;
      }
    }
    if (sawCurrent) return getComputedStyle(svg).color;
    if (sawExplicit) return null;            // fixed artwork — not judgeable as one colour
    return getComputedStyle(svg).fill;       // no paint attributes at all: the default really does paint
  }

  function contrastOf(el, isIcon) {
    var cs = getComputedStyle(el);
    var fgRaw = isIcon ? iconColor(el) : cs.color;
    if (fgRaw === null) return { skipped: true };
    var fg = toRgb(fgRaw);
    if (!fg) return { unreadable: fgRaw };
    var back = bgBehind(el);
    // The element's own alpha AND its inherited opacity chain both fade it.
    var alpha = fg.a * effectiveOpacity(el);
    var painted = over({ r: fg.r, g: fg.g, b: fg.b, a: Math.max(0, Math.min(1, alpha)) }, back.color);
    return {
      ratio: contrast(painted, back.color),
      fg: fgRaw, bg: 'rgb(' + Math.round(back.color.r) + ',' + Math.round(back.color.g) + ',' + Math.round(back.color.b) + ')',
      opacity: effectiveOpacity(el), assumed: back.assumed, usedFrameSolid: back.usedFrameSolid
    };
  }

  function hasOwnText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3 && node.nodeValue.trim()) return true;
    }
    return false;
  }

  function checkContrast(add, stats) {
    for (var i = 0; i < REGIONS.length; i++) {
      var root = document.querySelector(REGIONS[i].sel);
      if (!root || !isVisible(root)) continue;
      var region = REGIONS[i].name;
      var all = root.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        var el = all[j];
        var isIcon = el.tagName.toLowerCase() === 'svg';
        var isText = !isIcon && hasOwnText(el);
        if (!isIcon && !isText) continue;
        if (!isVisible(el) || !isHittable(el)) continue;
        var res = contrastOf(el, isIcon);
        if (res.skipped) { stats.skippedArtwork++; continue; }
        stats.colorsJudged++;
        if (res.unreadable) {
          add('contrast-unreadable', describe(el),
            'in the ' + region + ': could not read colour ' + JSON.stringify(res.unreadable), {}, el);
          continue;
        }
        var min = isIcon ? ICON_MIN : TEXT_MIN;
        if (res.ratio + 0.05 < min) {
          add('contrast', describe(el),
            'in the ' + region + ': ' + (isIcon ? 'icon' : 'text') + ' ' + res.fg + ' on ' + res.bg +
            ' is ' + n(res.ratio) + ':1, under ' + min + ':1',
            { ratio: n(res.ratio), required: min, fg: res.fg, bg: res.bg,
              region: region, opacity: n(res.opacity), viaFrameSolid: res.usedFrameSolid }, el);
        }
      }
    }
  }

  // The sleeping-tab moon. A fresh profile has no sleeping tab, so we mark a
  // real tab sleeping and insert the exact markup tabs.js/horizontal-tabs.js
  // render — the CSS cascade then applies for real, which is the whole point:
  // the moon regressed once to a faded 10px outline that vanished on most themes.
  var MOON_HTML = '<span class="sleep-indicator" title="Sleeping"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></span>';

  function checkMoon(add) {
    var probe = null;
    var moon = document.querySelector('.sleep-indicator');
    if (!moon) {
      var tab = document.querySelector('.top-tab, .tab-item');
      if (!tab) return;
      tab.classList.add('sleeping');
      tab.insertAdjacentHTML('beforeend', MOON_HTML);
      probe = { tab: tab, moon: tab.querySelector(':scope > .sleep-indicator') };
      moon = probe.moon;
    }
    try {
      if (!moon || !isVisible(moon)) return;
      var svg = moon.querySelector('svg') || moon;
      var op = effectiveOpacity(moon);
      // It must be at FULL strength — the fade belongs to the title and favicon only.
      if (op < 0.999) {
        add('moon-opacity', describe(moon),
          'the sleeping-tab moon renders at ' + n(op * 100) + '% opacity; it must be fully opaque',
          { opacity: n(op) }, moon);
      }
      var res = contrastOf(svg, true);
      if (res.skipped) return;
      if (res.unreadable) {
        add('contrast-unreadable', describe(svg), 'sleeping-tab moon: could not read colour ' + JSON.stringify(res.unreadable), {}, svg);
      } else if (res.ratio + 0.05 < ICON_MIN) {
        add('contrast', describe(moon),
          'sleeping-tab moon ' + res.fg + ' on ' + res.bg + ' is ' + n(res.ratio) + ':1, under ' + ICON_MIN + ':1',
          { ratio: n(res.ratio), required: ICON_MIN, fg: res.fg, bg: res.bg, region: 'tab strip' }, moon);
      }
    } finally {
      if (probe) { probe.moon.remove(); probe.tab.classList.remove('sleeping'); }
    }
  }

  // --- driver ------------------------------------------------------------

  // TRAP 1: pin every element to its final visual state. A hidden or occluded
  // window never advances transitions/animations, so without this we measure
  // half-grown controls. Re-asserted (and moved last in <head>) every sample,
  // because switching a GUI style appends new stylesheets after ours.
  function freeze() {
    var st = document.getElementById('vex-check-ui-freeze');
    if (!st) {
      st = document.createElement('style');
      st.id = 'vex-check-ui-freeze';
      st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    }
    document.head.appendChild(st);
  }

  function audit(exceptions, style) {
    freeze();
    var findings = [];
    function add(check, element, message, numbers, el) {
      // Drop known-good cases. Matching is by selector on the live element, so
      // an exception can never silently swallow a DIFFERENT element.
      for (var i = 0; i < exceptions.length; i++) {
        var ex = exceptions[i];
        if (ex.check !== check) continue;
        if (ex.styles && ex.styles.indexOf(style) === -1) continue;
        if (el && el.matches && el.matches(ex.selector)) return;
      }
      findings.push({ check: check, element: element, message: message, numbers: numbers || {} });
    }

    var stats = { colorsJudged: 0, skippedArtwork: 0 };
    var els = clickables();
    checkOverlap(add, overlapCandidates());
    checkBadges(add);
    checkTiny(add, els);
    checkUnnamed(add, els);
    checkClipping(add, els);
    checkContrast(add, stats);
    checkMoon(add);
    return {
      findings: findings,
      measured: els.length,
      colorsJudged: stats.colorsJudged,
      skippedArtwork: stats.skippedArtwork
    };
  }

  return { audit: audit, freeze: freeze };
})();
'installed';
`;

// ---------------------------------------------------------------------------
// Host side
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error('check-ui: ' + msg);
  process.exit(2); // harness failure — never confused with "UI has findings"
}

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--') && !a.includes('=')));
const styleArg = (args.find(a => a.startsWith('--style=')) || '').split('=')[1] || null;
const FULL = flags.has('--full');
const JSON_OUT = flags.has('--json');
const KEEP_OPEN = flags.has('--keep-open');

for (const a of args) {
  if (!/^--(full|json|keep-open|style=.+)$/.test(a)) fail('unknown argument: ' + a);
}

// A handful of representative themes: the default, a near-black, a saturated
// mono, a light pastel and a low-contrast classic. --full sweeps all of them.
const SAMPLE_THEMES = ['oxford', 'midnight', 'matrix', 'sakura', 'solarized'];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && /src\/renderer\/index\.html$/.test((t.url || '').split('?')[0]));
      if (page && page.webSocketDebuggerUrl) return page;
      lastErr = 'renderer window not listed yet (' + list.length + ' targets)';
    } catch (err) {
      lastErr = err.message;
    }
    await sleep(400);
  }
  throw new Error('timed out waiting for the Vex renderer on the debugging port: ' + lastErr);
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    let open = false;

    ws.addEventListener('open', () => { open = true; resolve({ send, close: () => ws.close() }); });
    ws.addEventListener('error', () => {
      const err = new Error('CDP websocket error');
      if (!open) return reject(err);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    });
    ws.addEventListener('close', () => {
      const err = new Error('CDP websocket closed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id || !pending.has(msg.id)) return; // an event, not a reply
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.method + ': ' + msg.error.message));
      else p.resolve(msg.result);
    });

    function send(method, params) {
      return new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    }
  });
}

// The renderer pulls in ~100 script tags, and /json/list announces the target
// long before any of them have run. Attaching early is exactly what made the
// first version of this check flaky: sometimes VexGuiStyle simply did not exist
// yet, and a run that measured a half-built page reported different findings
// than one that didn't. Gate on the real API surface — plus a tab actually
// existing, or the tab-strip contrast check would measure an empty strip.
async function waitForRenderer(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'never evaluated';
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `(() => ({
      ready: document.readyState,
      gui: !!(window.VexGuiStyle && window.VexGuiStyle.styles),
      theme: !!(window.ThemeManager && window.ThemeManager.availableThemes),
      onboarding: !!(window.Onboarding && window.Onboarding.finish),
      chrome: !!document.querySelector('#top-bar'),
      tabs: document.querySelectorAll('.top-tab, .tab-item').length
    }))()`);
    if (state.ready === 'complete' && state.gui && state.theme && state.onboarding && state.chrome && state.tabs > 0) return state;
    last = JSON.stringify(state);
    await sleep(300);
  }
  throw new Error('the renderer never finished starting up: ' + last);
}

// TRAP 3. Onboarding.finish() removes #vex-onboarding, but maybeStart() has
// already scheduled start() on a 900ms timer and start() does not re-check the
// "done" flag — so a single early finish() is undone a moment later. Dismiss
// repeatedly until the overlay STAYS gone.
async function dismissOnboarding(cdp) {
  const deadline = Date.now() + 15000;
  let clearPolls = 0;
  while (Date.now() < deadline) {
    const present = await evaluate(cdp, `(() => {
      try { localStorage.setItem('vex.onboardingDone', 'true'); } catch (e) { /* storage blocked */ }
      const el = document.getElementById('vex-onboarding');
      if (el && window.Onboarding && window.Onboarding.finish) window.Onboarding.finish();
      return !!el;
    })()`);
    clearPolls = present ? 0 : clearPolls + 1;
    if (clearPolls >= 6) return; // ~1.2s clear: comfortably past the 900ms timer
    await sleep(200);
  }
  throw new Error('the onboarding wizard would not stay dismissed — it covers the whole window, so nothing could be measured');
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('page threw: ' + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
}

function styleLabel(style, colors) {
  return colors ? style + ' (' + colors + ' colours)' : style;
}

async function main() {
  const started = Date.now();
  const port = await freePort();
  const userDataDir = path.join(os.tmpdir(), 'vex-check-ui-' + process.pid + '-' + Date.now());

  // Equivalent to `npx electron . --user-data-dir=… --remote-debugging-port=…`,
  // but resolving the binary through require('electron') the way the repo's
  // other Electron harnesses do (no npx resolution step on Windows).
  const child = spawn(electronPath, [
    '.',
    '--user-data-dir=' + userDataDir,
    '--remote-debugging-port=' + port,
  ], {
    cwd: REPO,
    // --keep-open is only useful if the app OUTLIVES this script, so there it
    // gets its own process group. It must also be given NO pipes: a detached
    // child holding inherited stdio keeps the launching shell waiting for EOF
    // long after this process exits, so the command looks like it hung. Losing
    // the app log in that one mode is the right trade for a debugging flag.
    stdio: KEEP_OPEN ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe'],
    detached: KEEP_OPEN,
  });

  let appLog = '';
  const capture = (d) => { appLog += d.toString(); };
  if (child.stdout) child.stdout.on('data', capture); // absent under --keep-open
  if (child.stderr) child.stderr.on('data', capture);
  child.on('error', (err) => fail('could not launch Electron: ' + err.message));

  let cdp = null;
  let exitCode = 2;

  const cleanup = () => {
    if (KEEP_OPEN) {
      try { child.unref(); } catch { /* already gone */ }
      console.log('\n--keep-open: leaving Vex running (pid ' + child.pid + '), profile at ' + userDataDir);
      console.log('DevTools: http://127.0.0.1:' + port);
      console.log('Stop it with:  taskkill /F /PID ' + child.pid);
      return;
    }
    try { if (cdp) cdp.close(); } catch { /* socket already gone */ }
    // Electron is a process TREE (browser + renderer + GPU + utility). Killing
    // only the top process can strand the rest; they pile up across runs and
    // eventually starve the machine — a dozen strays once made a later run time
    // out waiting for the renderer, which looks exactly like a real failure.
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
      } else {
        child.kill('SIGKILL');
      }
    } catch { /* already dead */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* profile lock; tmp sweeps it */ }
  };

  // Always kill the app and drop the throwaway profile, including on failure.
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(2); });

  try {
    const target = await waitForTarget(port, 60000);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await waitForRenderer(cdp, 60000);

    await dismissOnboarding(cdp);

    const installed = await evaluate(cdp, PAGE_LIB);
    if (installed !== 'installed') throw new Error('audit library did not install');

    const styles = await evaluate(cdp, '(window.VexGuiStyle && window.VexGuiStyle.styles()) || null');
    if (!Array.isArray(styles) || !styles.length) throw new Error('VexGuiStyle.styles() returned nothing — renderer not ready');

    const allThemes = await evaluate(cdp, '(window.ThemeManager && window.ThemeManager.availableThemes) || null');
    if (!Array.isArray(allThemes) || !allThemes.length) throw new Error('ThemeManager.availableThemes returned nothing');

    let themes = FULL ? allThemes : SAMPLE_THEMES.filter(t => allThemes.includes(t));
    if (!themes.length) throw new Error('none of the sample themes exist in ThemeManager');

    let runStyles = styles;
    if (styleArg) {
      if (!styles.includes(styleArg)) throw new Error('unknown GUI style "' + styleArg + '" (have: ' + styles.join(', ') + ')');
      runStyles = [styleArg];
    }

    const findings = [];
    const summaries = [];

    for (const style of runStyles) {
      await evaluate(cdp, 'window.VexGuiStyle.set(' + JSON.stringify(style) + ')');
      await sleep(250);
      const isLook = await evaluate(cdp, 'window.VexGuiStyle.isBrowserLook()');
      // A browser look can wear its own palette or the colour theme's; both
      // ship, so both are checked. classic/glass have only the one.
      const colorModes = isLook ? ['look', 'theme'] : [null];

      for (const colors of colorModes) {
        if (colors) { await evaluate(cdp, 'window.VexGuiStyle.setColors(' + JSON.stringify(colors) + ')'); await sleep(120); }
        let count = 0, controls = 0, colours = 0;
        for (const theme of themes) {
          await evaluate(cdp, 'window.ThemeManager.applyTheme(' + JSON.stringify(theme) + ', { persist: false })');
          // Two frames + a beat: layout settles, and with transitions frozen
          // every box is already at its final size.
          await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
          await sleep(80);

          const result = await evaluate(cdp,
            'window.__vexCheckUi.audit(' + JSON.stringify(EXCEPTIONS) + ', ' + JSON.stringify(style) + ')');
          // A sample that measured nothing would report "clean" forever — the one
          // result this checker must never print. Treat it as a harness failure,
          // not as a pass.
          const at = styleLabel(style, colors) + '/' + theme;
          if (!result.measured) throw new Error('measured 0 hittable controls at ' + at + ' — the check would be reporting on nothing');
          if (!result.colorsJudged) throw new Error('judged 0 foreground colours at ' + at + ' — the contrast check would be reporting on nothing');
          controls = Math.max(controls, result.measured);
          colours = Math.max(colours, result.colorsJudged);
          for (const f of result.findings) findings.push({ ...f, style, colors, theme });
          count += result.findings.length;
        }
        summaries.push({ style, colors, themes: themes.length, controls, colours, findings: count });
      }
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (JSON_OUT) {
      console.log(JSON.stringify({
        ok: findings.length === 0,
        seconds: Number(seconds),
        styles: runStyles, themes, full: FULL,
        summaries, findings,
      }, null, 2));
    } else {
      console.log('Vex UI self-check — ' + runStyles.length + ' GUI style(s), ' +
        themes.length + ' theme(s)' + (FULL ? ' (full sweep)' : ' (sample; --full for all)'));
      console.log('');
      for (const s of summaries) {
        const label = styleLabel(s.style, s.colors);
        console.log('  ' + (s.findings ? 'FLAG' : ' ok ') + '  ' + label.padEnd(26) +
          String(s.themes).padStart(2) + ' themes  ' + String(s.controls).padStart(3) + ' controls  ' +
          String(s.colours).padStart(3) + ' colours  ' + (s.findings ? s.findings + ' finding(s)' : 'clean'));
      }
      console.log('');

      if (findings.length) {
        // Group identical faults so one bad rule across 35 themes reads as one
        // problem with a theme list, not 35 problems.
        const groups = new Map();
        for (const f of findings) {
          const key = f.check + '|' + f.element + '|' + f.message;
          if (!groups.has(key)) groups.set(key, { ...f, where: new Set() });
          groups.get(key).where.add(styleLabel(f.style, f.colors) + '/' + f.theme);
        }
        const byCheck = new Map();
        for (const g of groups.values()) {
          if (!byCheck.has(g.check)) byCheck.set(g.check, []);
          byCheck.get(g.check).push(g);
        }
        for (const [check, list] of byCheck) {
          console.log(check.toUpperCase() + ' (' + list.length + ')');
          for (const g of list) {
            console.log('  ' + g.element);
            console.log('    ' + g.message);
            const where = Array.from(g.where);
            console.log('    seen in: ' + where.slice(0, 4).join(', ') +
              (where.length > 4 ? ' and ' + (where.length - 4) + ' more' : ''));
          }
          console.log('');
        }
      }

      console.log(findings.length
        ? 'TOTAL: ' + findings.length + ' finding(s) across ' + summaries.length + ' style/colour combination(s) in ' + seconds + 's'
        : 'TOTAL: clean — nothing flagged in ' + seconds + 's');
    }

    exitCode = findings.length ? 1 : 0;
  } catch (err) {
    console.error('check-ui: ' + err.message);
    if (appLog.trim()) console.error('--- last app output ---\n' + appLog.split('\n').slice(-15).join('\n'));
    exitCode = 2;
  }

  process.exit(exitCode);
}

main().catch(err => fail(err.stack || err.message));
