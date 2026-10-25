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
//   node scripts/check-ui.js --theme=midnight  limit to one colour theme
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
//   3. The onboarding wizard never opens. Otherwise a full-window overlay
//      (#vex-onboarding, z-index 100060) sits over the whole chrome and NOTHING
//      is hittable. Dismissing it by script was a race: maybeStart() schedules
//      start() on a 900ms timer, and a run on a busy machine saw it come back
//      after the "clear for 1.2s" window and judged 0 colours. The throwaway
//      profile is now seeded with the wizard already done (seedProfile), the
//      way a profile that finished it looks, and the run fails loudly if the
//      overlay is there anyway.
//
// And the window must keep drawing while covered: Chromium stops painting a
// window another one hides, so every requestAnimationFrame below waited for
// minutes. scripts/check-ui-probe.js turns that off in the measured app.
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
const harness = require('./lib/probe-harness');
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
  {
    check: 'a11y-target-24',
    selector: '#btn-minimize, #btn-maximize, #btn-close',
    styles: ['win98'],
    reason: 'The same caption boxes: authentic 18x16 painted, 20x22 hit area, and they sit ' +
      'edge to edge as the real Windows 98 ones do. The 24x24 minimum (WCAG 2.5.8) is a ' +
      'trade this look makes on purpose; no other look is flagged.',
  },
  {
    check: 'contrast',
    selector: '#vex-logo > span',
    reason: 'The "Vex" wordmark beside the logo is the logotype, in the theme\'s accent. ' +
      'WCAG 1.4.3 exempts text that is part of a logo or brand name; it is ' +
      'not information, and the window\'s name is read out from its title.',
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

  // A whole surface — a panel, a menu, a dialog, a picker, the New Tab page —
  // judged for text only: every piece of text in it against what is painted
  // behind it. The bands above miss these, and so did the checker (cat-themes:
  // Settings chips, the command bar's selected row and the Glass panels all
  // failed while check:ui said clean). Large text (24px, or 18.66px bold)
  // needs 3:1 (WCAG 1.4.3), the rest 4.5:1.
  function scanSurface(exceptions, style, surface, sel) {
    freeze();
    var findings = [];
    var judged = 0;
    var roots = document.querySelectorAll(sel);
    var seen = {};
    function add(check, el, message, numbers) {
      for (var i = 0; i < exceptions.length; i++) {
        var ex = exceptions[i];
        if (ex.check !== check) continue;
        if (ex.styles && ex.styles.indexOf(style) === -1) continue;
        if (el.matches && el.matches(ex.selector)) return;
      }
      var key = check + '|' + describe(el) + '|' + message;
      if (seen[key]) return;
      seen[key] = 1;
      findings.push({ check: check, element: describe(el), message: message, numbers: numbers || {} });
    }
    for (var r = 0; r < roots.length; r++) {
      var all = [roots[r]].concat(Array.prototype.slice.call(roots[r].querySelectorAll('*')));
      for (var j = 0; j < all.length; j++) {
        var el = all[j];
        if (!hasOwnText(el)) continue;
        if (/^(SCRIPT|STYLE|OPTION|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
        if (!isVisible(el)) continue;
        if (el.closest('[disabled], [aria-disabled="true"]')) continue;
        var res = contrastOf(el, false);
        if (res.skipped) continue;
        judged++;
        if (res.unreadable) { add('contrast-unreadable', el, 'in ' + surface + ': could not read colour ' + JSON.stringify(res.unreadable)); continue; }
        var cs = getComputedStyle(el);
        var px = parseFloat(cs.fontSize);
        var min = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700)) ? 3 : TEXT_MIN;
        if (res.ratio + 0.05 < min) {
          add('contrast', el, 'in ' + surface + ': text ' + res.fg + ' on ' + res.bg + ' is ' + n(res.ratio) + ':1, under ' + min + ':1',
            { ratio: n(res.ratio), required: min, fg: res.fg, bg: res.bg, region: surface, opacity: n(res.opacity) });
        }
      }
    }
    return { roots: roots.length, judged: judged, findings: findings };
  }

  // Settings laid out in columns (SettingsUI._layout): no section over
  // another, no gap above a section larger than the spacing between two
  // (its margin and one grid row), no text cut off, no switch squeezed by a
  // long label. Full screen and a text-size change once broke all four
  // (the owner, 2026-10-12: "some gaps in settings and words were broken").
  function settingsLayout(exceptions, style, label, expect) {
    freeze();
    var findings = [];
    var seen = {};
    function add(check, el, message, numbers) {
      for (var i = 0; i < exceptions.length; i++) {
        var ex = exceptions[i];
        if (ex.check !== check) continue;
        if (ex.styles && ex.styles.indexOf(style) === -1) continue;
        if (el.matches && el.matches(ex.selector)) return;
      }
      var key = check + '|' + describe(el) + '|' + message;
      if (seen[key]) return;
      seen[key] = 1;
      findings.push({ check: check, element: describe(el), message: 'Settings (' + label + '): ' + message, numbers: numbers || {} });
    }
    var root = document.querySelector('#panel-settings .settings-content');
    if (!root || !root.clientWidth) return { blocks: 0, findings: findings };
    // Every section is inside the scroll area, and every section a module registered is there
    // and not squeezed (T2-058: groups once landed outside .settings-content, drawn apart).
    var allGroups = document.querySelectorAll('#panel-settings .setting-group');
    for (var og = 0; og < allGroups.length; og++) {
      if (!root.contains(allGroups[og])) add('settings-orphan', allGroups[og], 'is a Settings section outside the scroll area (.settings-content), so it is drawn apart from the others', {});
    }
    var registry = window.VexSettingsGroups;
    if (registry && registry._defs && typeof registry._defs.forEach === 'function') {
      registry._defs.forEach(function (def, gid) {
        var gel = document.getElementById(def.build ? 'vex-sg-' + gid : 'setting-' + gid);
        if (!gel || !root.contains(gel)) { add('settings-missing-group', root, 'the section "' + def.title + '" is registered but not in the scroll area', {}); return; }
        if (gel.getClientRects().length && gel.getBoundingClientRect().width < 200) add('settings-narrow-group', gel, 'the section "' + def.title + '" is only ' + n(gel.getBoundingClientRect().width) + 'px wide', { px: n(gel.getBoundingClientRect().width) });
      });
    }
    var zoom = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
    var blocks = Array.prototype.slice.call(root.children).filter(function (e) {
      return e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    });
    var R = blocks.map(function (e) {
      var b = e.getBoundingClientRect();
      return { e: e, l: b.left, r: b.right, t: b.top, b: b.bottom, mb: parseFloat(getComputedStyle(e).marginBottom) || 0 };
    });
    for (var i = 0; i < R.length; i++) {
      var above = null;
      for (var j = 0; j < R.length; j++) {
        if (i === j) continue;
        var ox = Math.min(R[i].r, R[j].r) - Math.max(R[i].l, R[j].l);
        var oy = Math.min(R[i].b, R[j].b) - Math.max(R[i].t, R[j].t);
        if (j > i && ox > 1 && oy > 1) {
          add('settings-overlap', R[i].e, describe(R[i].e) + ' and ' + describe(R[j].e) + ' overlap by ' + n(oy) + 'px', { px: n(oy) });
        }
        if (ox > 20 && R[j].b <= R[i].t + 2 && (!above || R[j].b > above.b)) above = R[j];
      }
      // The spacing between two sections: the upper one's margin, and up to
      // one grid row (4px) of rounding, in screen pixels.
      if (above) {
        var gap = R[i].t - above.b;
        // + 1px for the height SettingsUI._layout reads: offsetHeight is a whole
        // number, so a section can be given up to half a CSS pixel (times the
        // zoom) more room than it needs. On GitHub's windows-latest fonts, whose
        // line heights are fractional, that put 12 sections 0.1-0.6px past the
        // old limit (23.4px against 22.8px at Larger text) with identical CSS
        // and a local run clean (CI run 39035219543). A real fault is a whole
        // grid row or more beyond this.
        var most = (above.mb + 4) * zoom + 3;
        if (gap > most) add('settings-gap', R[i].e, 'a ' + n(gap) + 'px gap above it (most ' + n(most) + 'px)', { px: n(gap) });
      }
    }
    blocks.forEach(function (blk) {
      var bb = blk.getBoundingClientRect();
      var all = blk.querySelectorAll('*');
      for (var k = 0; k < all.length; k++) {
        var el = all[k];
        if (!el.getClientRects().length || /^(INPUT|SELECT|TEXTAREA|OPTION|svg|path|circle|rect|line|polyline|IMG|CANVAS|IFRAME|WEBVIEW)$/i.test(el.tagName)) continue;
        if (el.closest('details:not([open])') && !el.closest('summary')) continue;
        var inBox = false;
        for (var p = el.parentElement; p && p !== blk; p = p.parentElement) {
          var pc = getComputedStyle(p);
          if (pc.overflowX !== 'visible' || pc.overflowY !== 'visible') { inBox = true; break; }
        }
        if (inBox) continue;
        var cs = getComputedStyle(el);
        if (cs.position === 'absolute' || cs.position === 'fixed') continue;
        var r = el.getBoundingClientRect();
        if (r.bottom > bb.bottom + 1 || r.right > bb.right + 1) {
          add('settings-clipped', el, 'reaches ' + n(Math.max(r.bottom - bb.bottom, r.right - bb.right)) + 'px outside its section, which cuts it off', {});
          continue;
        }
        if (!hasOwnText(el) || /(auto|scroll)/.test(cs.overflowX + cs.overflowY)) continue;
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        if (cs.textOverflow === 'ellipsis' || parseInt(cs.webkitLineClamp, 10) > 0) continue;
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
          add('settings-clipped', el, 'its text is cut off (' + el.scrollWidth + 'x' + el.scrollHeight + ' in ' + el.clientWidth + 'x' + el.clientHeight + ')', {});
        }
      }
    });
    root.querySelectorAll('.toggle').forEach(function (t) {
      if (!t.getClientRects().length || t.closest('details:not([open])')) return;
      if (t.offsetWidth < 39) add('settings-squeezed', t, 'a switch squeezed to ' + t.offsetWidth + 'px wide by the label beside it', { px: t.offsetWidth });
    });
    // The layout asked for is the layout shown. "One column, full width"
    // shipped as a centred 780px column in a 1876px panel because nothing
    // measured how much of the width its sections use: every section is at
    // least 90% of the room the scroll area has, in both menu styles.
    if (expect && expect.columns === 'wide') {
      var rcs = getComputedStyle(root);
      var room = (root.clientWidth - (parseFloat(rcs.paddingLeft) || 0) - (parseFloat(rcs.paddingRight) || 0)) * zoom;
      blocks.forEach(function (blk) {
        if (!blk.classList.contains('setting-group')) return;
        var w = blk.getBoundingClientRect().width;
        if (w < room * 0.9) add('settings-not-wide', blk, 'is ' + n(w) + 'px wide in a ' + n(room) + 'px area (' + Math.round(w / room * 100) + '%), under 90%: "One column, full width" is not using the width', { px: n(w), room: n(room) });
      });
    }
    var panelEl = root.parentElement;
    if (expect && expect.nav) {
      var side = panelEl && panelEl.dataset.setNav === 'side';
      var asked = expect.nav === 'side';
      // The list on the left needs SideMin; narrower, chips are right.
      if (asked && !side && panelEl.clientWidth >= 900) add('settings-nav', panelEl, 'the category list was asked for on the left and the panel is ' + panelEl.clientWidth + 'px wide, but chips are shown', {});
      if (!asked && side) add('settings-nav', panelEl, 'chips were asked for and the category list is on the left', {});
    }
    return { blocks: blocks.length, findings: findings };
  }

  // A section changing height as script fills it (the local models list
  // arriving): in the very next frame nothing is over another and no gap has
  // opened. The size observer alone re-placed the blocks a frame later.
  function settingsGrow(exceptions, style, label, expect) {
    var raf = function () { return new Promise(function (r) { requestAnimationFrame(r); }); };
    var root = document.querySelector('#panel-settings .settings-content');
    var blk = root && Array.prototype.slice.call(root.querySelectorAll(':scope > .setting-group')).filter(function (e) { return e.getClientRects().length; })[0];
    if (!blk) return Promise.resolve({ blocks: 0, findings: [] });
    var pad = document.createElement('div');
    pad.style.height = '300px';
    return raf().then(function () {
      blk.appendChild(pad);
      return raf();
    }).then(function () {
      var res = settingsLayout(exceptions, style, label + ', the frame after a section grew by 300px', expect);
      pad.remove();
      return raf().then(function () { return res; });
    });
  }

  // The category menu: clicking an entry scrolls to its section and marks
  // that entry (aria-current). In two and three columns it marked the section
  // beside it that began higher in nearly every category.
  function settingsChips(style, label) {
    var panel = document.getElementById('panel-settings');
    var root = panel && panel.querySelector('.settings-content');
    var findings = [];
    if (!root || !root.clientWidth) return Promise.resolve({ blocks: 0, findings: findings });
    var chips = Array.prototype.slice.call(panel.querySelectorAll('.set-nav .set-nav-chip')).filter(function (c) { return c.getClientRects().length; });
    var pick = [3, 8, 14, chips.length - 4].filter(function (i, k, a) { return i >= 0 && i < chips.length && a.indexOf(i) === k; });
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var settle = function () {
      var last = -1, same = 0, n = 0;
      return new Promise(function (resolve) {
        (function tick() {
          wait(50).then(function () {
            n++;
            if (root.scrollTop === last) same++; else { same = 0; last = root.scrollTop; }
            if (same >= 4 || n > 80) resolve(); else tick();
          });
        })();
      });
    };
    var run = function (k) {
      if (k >= pick.length) return Promise.resolve({ blocks: chips.length, findings: findings });
      var c = chips[pick[k]];
      root.scrollTop = 0;
      return wait(60).then(function () {
        c.click();
        return settle();
      }).then(function () { return wait(120); }).then(function () {
        var cur = panel.querySelector('.set-nav-chip[aria-current]');
        var want = c.textContent.trim();
        var got = cur ? cur.textContent.trim() : null;
        if (want !== got) {
          findings.push({ check: 'settings-nav-mark', element: describe(c), message: 'Settings (' + label + '): clicking "' + want + '" scrolled to its section and the menu marks "' + got + '"', numbers: {} });
        }
        return run(k + 1);
      });
    };
    return run(0);
  }

  // --- keyboard and screen-reader structure ------------------------------
  // What a keyboard or screen-reader user meets, judged on the live DOM:
  // a control with no accessible name, a positive tabindex, a role=button that
  // Tab cannot reach, a focusable thing inside aria-hidden or parked off the
  // screen, a dialog that does not say it is one, and a focused control that
  // shows no ring (or a ring too faint against what is behind it, WCAG 2.4.7 /
  // 1.4.11).
  var FOCUSABLE_SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable=true]';
  var ROLE_WIDGET_SEL = '[role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=checkbox], [role=switch], [role=radio], [role=option], [role=slider], [role=combobox], [role=treeitem]';
  var RING_MIN = 3.0;      // WCAG 1.4.11
  var RING_SAMPLE = 60;    // controls focused per surface (a focus() is a real event)
  var TARGET_24 = 24;      // WCAG 2.5.8 floor, reported as its own check

  function textOf(el, depth) {
    if (depth > 8) return '';
    var out = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 3) { out += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      if (c.getAttribute('aria-hidden') === 'true') continue;
      var tag = c.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') continue;
      var al = (c.getAttribute('aria-label') || '').trim();
      if (al) { out += ' ' + al + ' '; continue; }
      if (tag === 'img') { out += ' ' + (c.getAttribute('alt') || '') + ' '; continue; }
      if (tag === 'svg') {
        var t = c.querySelector(':scope > title');
        out += ' ' + (t ? t.textContent : '') + ' ';
        continue;
      }
      if (getComputedStyle(c).display === 'none') continue;
      out += ' ' + textOf(c, (depth || 0) + 1) + ' ';
    }
    return out;
  }

  function accessibleName(el, depth) {
    depth = depth || 0;
    if (depth > 4) return '';
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var joined = by.split(/\\s+/).map(function (id) {
        var e = document.getElementById(id);
        return e ? (accessibleName(e, depth + 1) || e.textContent || '') : '';
      }).join(' ').trim();
      if (joined) return joined;
    }
    var al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    if (el.labels && el.labels.length) {
      for (var i = 0; i < el.labels.length; i++) {
        var lt = textOf(el.labels[i], 0).trim();
        if (lt) return lt;
      }
    }
    var tag = el.tagName;
    if (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) { if ((el.value || '').trim()) return el.value.trim(); }
    var own = textOf(el, 0).replace(/\\s+/g, ' ').trim();
    if (own) return own;
    var title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return (el.getAttribute('placeholder') || '').trim();
    return '';
  }

  // The real tab stops: focusable by default or by tabindex, not disabled.
  function tabbable(el) {
    if (el.disabled) return false;
    var ti = el.getAttribute('tabindex');
    if (ti !== null && parseInt(ti, 10) < 0) return false;
    return true;
  }

  function a11yScan(exceptions, style, surface, sel, asDialog) {
    freeze();
    var findings = [];
    var seen = {};
    var judged = 0;
    function add(check, el, message, numbers) {
      for (var i = 0; i < exceptions.length; i++) {
        var ex = exceptions[i];
        if (ex.check !== check) continue;
        if (ex.styles && ex.styles.indexOf(style) === -1) continue;
        if (el.matches && el.matches(ex.selector)) return;
      }
      var key = check + '|' + describe(el) + '|' + message;
      if (seen[key]) return;
      seen[key] = 1;
      findings.push({ check: check, element: describe(el), message: 'in ' + surface + ': ' + message, numbers: numbers || {} });
    }
    var roots = document.querySelectorAll(sel);
    var ringBudget = RING_SAMPLE;
    var ringsJudged = 0;
    var stopRects = null;
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      stopRects = null;
      var focusables = Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE_SEL));
      if (root.matches && root.matches(FOCUSABLE_SEL)) focusables.unshift(root);
      var widgets = Array.prototype.slice.call(root.querySelectorAll(ROLE_WIDGET_SEL));

      // role=button (etc.) that Tab skips: a mouse-only control.
      for (var w = 0; w < widgets.length; w++) {
        var we = widgets[w];
        if (we.matches(FOCUSABLE_SEL) || !isVisible(we)) continue;
        if (we.closest('[aria-hidden="true"], [inert]')) continue;
        if (we.closest('[role=menu], [role=listbox], [role=tablist], [role=radiogroup], [role=tree], [role=grid]')) continue; // roving tabindex: the group is the stop
        add('a11y-not-focusable', we, 'has role="' + we.getAttribute('role') + '" but no tabindex, so Tab and the keyboard cannot reach it');
      }

      for (var i = 0; i < focusables.length; i++) {
        var el = focusables[i];
        var ti = el.getAttribute('tabindex');
        if (ti !== null && parseInt(ti, 10) > 0) {
          add('a11y-tabindex', el, 'has tabindex="' + ti + '": a positive value jumps the whole page\\'s Tab order');
        }
        if (!isVisible(el)) continue;
        var inHidden = el.closest('[aria-hidden="true"]');
        if (inHidden && tabbable(el) && !el.closest('[inert]')) {
          add('a11y-hidden-focusable', el, 'can be tabbed to but sits inside aria-hidden="true" (' + describe(inHidden) + '): a screen reader says nothing while focus lands on it');
        }
        if (!tabbable(el)) continue;
        if (el.matches('input[type=radio]') && el.closest('[role=radiogroup]') && !el.checked) continue;
        judged++;
        if (!accessibleName(el)) {
          add('a11y-unnamed', el, 'has no accessible name (no text, aria-label, label, alt or title), so a screen reader says only its role');
        }
        var rr = rect(el);
        if (rr.width > 0 && rr.height > 0 && (rr.width < TARGET_24 || rr.height < TARGET_24) && !/^(INPUT)$/.test(el.tagName)) {
          // A control smaller than 24x24 CSS px (WCAG 2.5.8) is a miss for a
          // shaky hand; reported on its own so it can be weighed apart from
          // the 16px floor tiny-target already enforces.
          // WCAG 2.5.8's spacing exception: a small target is fine when a 24px
          // square centred on it touches no other target.
          if (!stopRects) {
            stopRects = focusables.filter(function (o) { return tabbable(o) && isVisible(o); }).map(function (o) { return { el: o, r: rect(o) }; });
          }
          var cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2;
          var probeBox = { left: cx - TARGET_24 / 2, right: cx + TARGET_24 / 2, top: cy - TARGET_24 / 2, bottom: cy + TARGET_24 / 2 };
          var crowdedBy = null;
          for (var sr = 0; sr < stopRects.length && !crowdedBy; sr++) {
            var other = stopRects[sr];
            if (other.el === el || el.contains(other.el) || other.el.contains(el)) continue;
            if (intersect(probeBox, other.r).area > 0) crowdedBy = other.el;
          }
          if (crowdedBy) {
            add('a11y-target-24', el, 'is ' + n(rr.width) + 'x' + n(rr.height) + 'px, under the 24x24 minimum target size, and ' + describe(crowdedBy) + ' is within 24px of it', { w: n(rr.width), h: n(rr.height) });
          }
        }
        // Parked off-screen but still a Tab stop: focus vanishes from view.
        if (rr.width > 0 && rr.height > 0 && (rr.right <= 0 || rr.bottom <= 0 || rr.left >= innerWidth || rr.top >= innerHeight)) {
          add('a11y-offscreen-focusable', el, 'is a Tab stop but is parked off the screen (' + n(rr.left) + ',' + n(rr.top) + '), so focus disappears when Tab lands on it');
        }
      }

      // Focus ring: focus a sample of the visible, hittable stops and read what it
      // paints. focusVisible:true asks for :focus-visible the way Tab would.
      for (var k = 0; k < focusables.length && ringBudget > 0; k++) {
        var fe = focusables[k];
        if (!isVisible(fe) || !isHittable(fe) || !tabbable(fe)) continue;
        if (fe.matches('input[type=hidden], input[type=file]') || (fe.tagName === 'INPUT' && fe.type === 'checkbox' && fe.closest('.toggle'))) continue;
        if (fe.closest('[aria-hidden="true"]')) continue;
        ringBudget--;
        // A field that already has the focus (the AI panel focuses its box a moment after it opens) would be read focused both before and after,
        // and look as if focus changed nothing: take the picture unfocused.
        if (document.activeElement === fe) { try { fe.blur(); } catch (e) { /* not blurrable: judged as it is */ } }
        var before = getComputedStyle(fe);
        var snap = before.outlineStyle + '|' + before.outlineWidth + '|' + before.outlineColor + '|' + before.boxShadow + '|' + before.borderTopColor + '|' + before.backgroundColor;
        // A field can show its ring on the box that wraps it (the address bar's
        // #url-bar:has(:focus-visible)); remember the nearest three ancestors too.
        var anc = [];
        for (var pa = fe.parentElement, qa = 0; pa && qa < 3; pa = pa.parentElement, qa++) {
          var pcs = getComputedStyle(pa);
          anc.push(pcs.outlineStyle + '|' + pcs.outlineWidth + '|' + pcs.outlineColor + '|' + pcs.boxShadow);
        }
        var prev = document.activeElement;
        try { fe.focus({ focusVisible: true, preventScroll: true }); } catch (e) { fe.focus(); }
        if (document.activeElement !== fe) continue;
        var vis = fe.matches(':focus-visible');
        if (vis) ringsJudged++;
        var cs = getComputedStyle(fe);
        var after = cs.outlineStyle + '|' + cs.outlineWidth + '|' + cs.outlineColor + '|' + cs.boxShadow + '|' + cs.borderTopColor + '|' + cs.backgroundColor;
        var ringW = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth);
        var ringColor = cs.outlineColor;
        var offset = parseFloat(cs.outlineOffset) || 0;
        var host = fe;
        if (vis && ringW > 0) {
          // The ring paints outside the box (offset >= 0): what is behind it is
          // the parent's background; inside (offset < 0): the control's own.
          var behind = bgBehind(offset >= 0 && fe.parentElement ? fe.parentElement : fe);
          var rc = toRgb(ringColor);
          if (!rc) {
            add('a11y-focus-ring-unreadable', fe, 'focus ring colour ' + JSON.stringify(ringColor) + ' could not be read');
          } else {
            var painted = over({ r: rc.r, g: rc.g, b: rc.b, a: rc.a }, behind.color);
            var ratio = contrast(painted, behind.color);
            if (ratio + 0.05 < RING_MIN) {
              add('a11y-focus-ring-contrast', fe, 'focus ring ' + ringColor + ' on ' + 'rgb(' + Math.round(behind.color.r) + ',' + Math.round(behind.color.g) + ',' + Math.round(behind.color.b) + ')' +
                ' is ' + n(ratio) + ':1, under ' + RING_MIN + ':1', { ratio: n(ratio), required: RING_MIN });
            }
          }
        } else if (vis && snap === after) {
          var viaParent = false;
          for (var pb = fe.parentElement, qb = 0; pb && qb < 3; pb = pb.parentElement, qb++) {
            var pcs2 = getComputedStyle(pb);
            if (pcs2.outlineStyle + '|' + pcs2.outlineWidth + '|' + pcs2.outlineColor + '|' + pcs2.boxShadow !== anc[qb]) viaParent = true;
          }
          if (!viaParent) add('a11y-focus-invisible', fe, 'shows nothing at all when it takes keyboard focus (no ring, shadow, border or fill change)');
        } else if (!vis) {
          // The browser would not match :focus-visible here; not a fault of the control.
        }
        try { fe.blur(); if (prev && prev !== document.body && prev.focus) prev.focus({ preventScroll: true }); } catch (e2) { /* focus restore is best effort in the checker only */ }
      }

      // Dialogs: say so, say they are modal, and have a name.
      var dialogs = root.querySelectorAll('.vex-dialog, [role=dialog], [role=alertdialog], dialog[open]');
      for (var d = 0; d < dialogs.length; d++) {
        var dg = dialogs[d];
        if (!isVisible(dg)) continue;
        var role = dg.getAttribute('role') || (dg.tagName === 'DIALOG' ? 'dialog' : '');
        var holder = dg.closest('.vex-dialog-overlay') || dg;
        var roleEl = role ? dg : (holder.getAttribute('role') ? holder : null);
        var rl = roleEl ? roleEl.getAttribute('role') : '';
        if (!/^(dialog|alertdialog)$/.test(rl) && dg.tagName !== 'DIALOG') {
          add('a11y-dialog-role', dg, 'is a dialog with no role="dialog" or role="alertdialog"');
          continue;
        }
        var modalEl = roleEl || dg;
        if (modalEl.getAttribute('aria-modal') !== 'true' && dg.tagName !== 'DIALOG') {
          add('a11y-dialog-modal', dg, 'is a dialog without aria-modal="true": a screen reader can wander out to the page behind it');
        }
        if (!accessibleName(modalEl) || (!modalEl.getAttribute('aria-label') && !modalEl.getAttribute('aria-labelledby'))) {
          add('a11y-dialog-name', dg, 'is a dialog with no aria-label or aria-labelledby: it is announced as just "dialog"');
        }
      }
    }
    // A surface that is a modal by design (a picker, a sheet, an editor): the
    // dialog role must be on it or inside it, with aria-modal and a name.
    if (asDialog) {
      for (var m = 0; m < roots.length; m++) {
        var mroot = roots[m];
        if (!isVisible(mroot)) continue;
        var found = mroot.matches('[role=dialog], [role=alertdialog]') ? [mroot] : Array.prototype.slice.call(mroot.querySelectorAll('[role=dialog], [role=alertdialog]'));
        var up = mroot.closest('[role=dialog], [role=alertdialog]');
        if (up && found.indexOf(up) === -1) found.push(up);
        if (!found.length) add('a11y-dialog-role', mroot, 'is a modal with no role="dialog" or role="alertdialog" on it or inside it');
        for (var q = 0; q < found.length; q++) {
          var fd = found[q];
          if (fd.getAttribute('aria-modal') !== 'true') add('a11y-dialog-modal', fd, 'is a dialog without aria-modal="true": a screen reader can wander out to the page behind it, and Tab is not held inside');
          if (!fd.getAttribute('aria-label') && !fd.getAttribute('aria-labelledby')) add('a11y-dialog-name', fd, 'is a dialog with no aria-label or aria-labelledby: it is announced as just "dialog"');
        }
      }
    }
    return { roots: roots.length, judged: judged, rings: ringsJudged, findings: findings };
  }

  return { audit: audit, freeze: freeze, scanSurface: scanSurface, settingsLayout: settingsLayout, settingsGrow: settingsGrow, settingsChips: settingsChips, a11yScan: a11yScan };
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
const themeArg = (args.find(a => a.startsWith('--theme=')) || '').split('=')[1] || null;
const FULL = flags.has('--full');
const JSON_OUT = flags.has('--json');
const KEEP_OPEN = flags.has('--keep-open');
// --sweep: after every surface it closes, run VexLayer.sweep() (js/vex-layer.js) and flag an overlay left
// covering the window or a point of the window that no longer reaches the page (T2-014). Off by default
// until it has run clean once on the owner's machine; --full turns it on.
const SWEEP = flags.has('--sweep') || FULL;

for (const a of args) {
  if (!/^--(full|json|keep-open|style=.+|theme=.+)$/.test(a)) fail('unknown argument: ' + a);
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

// ---------------------------------------------------------------------------
// SURFACES — what opens over the chrome. Each is opened by script, its text
// judged (scanSurface), and closed again, in the Firefox look (the owner's)
// and Glass, for every theme on --full. `open` and `close` run in Vex's window;
// the New Tab page is a separate document and is judged through its own target.
// ---------------------------------------------------------------------------
const SURFACE_STYLES = ['firefox', 'glass'];
const SURFACES = [
  { name: 'Settings', sel: '#panel-settings', open: "SidebarManager.openPanel('settings')", close: 'SidebarManager.hideActivePanel()' },
  { name: 'History', sel: '#panel-history', open: "SidebarManager.openPanel('history')", close: 'SidebarManager.hideActivePanel()' },
  { name: 'Downloads', sel: '#panel-downloads', open: "SidebarManager.openPanel('downloads')", close: 'SidebarManager.hideActivePanel()' },
  { name: 'the command bar', sel: '#command-bar', open: "CommandBar.open(); const i = document.querySelector('#command-input'); if (i) { i.value = 'set'; i.dispatchEvent(new Event('input', { bubbles: true })); }", close: 'CommandBar.close()' },
  { name: 'a dialog', dialog: true, sel: '.vex-dialog', open: "vexConfirm({ title: 'Check', message: 'A dialog the checker opened.' })", close: "document.querySelectorAll('.vex-dialog-overlay').forEach(o => o._vexCancel())" },
  { name: 'a toast', sel: '#toast-container', open: "showToast('A toast the checker opened', 'info', 60000)", close: "document.querySelectorAll('#toast-container > *').forEach(t => t.remove())" },
  { name: 'the tab menu', sel: '.tab-context-menu', open: "(() => { const t = document.querySelector('.top-tab, .tab-item'); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 })); })()", close: "document.querySelectorAll('.tab-context-menu, .context-menu-overlay').forEach(m => m.remove())" },
  { name: 'the theme picker', dialog: true, sel: '.vex-theme-picker', open: 'ThemePicker.open()', close: 'ThemePicker.close()' },
  { name: 'the font picker', dialog: true, sel: '.vexfont', open: 'VexFonts.open()', close: 'VexFonts.close()' },
  { name: 'the keys sheet', dialog: true, sel: '#vex-keys', open: 'KeysSheet.open()', close: 'KeysSheet.close()' },
];

// Judged for keyboard and screen-reader structure only (a11yScan): the whole
// window with nothing open, and each sidebar panel that is plain HTML.
const PANEL_IDS = ['bookmarks', 'notes', 'clock', 'memory', 'library', 'shortcuts', 'privacy', 'recall', 'annotations', 'authenticator', 'feeds', 'queue', 'devtools-dash'];
const A11Y_ONLY_SURFACES = [
  { name: 'the window', sel: 'body', open: 'SidebarManager.hideActivePanel()', close: 'true' },
  { name: 'the site panel', sel: '#vex-site-panel', open: 'SitePanel.open()', close: 'SitePanel.close()' },
  { name: 'the boost editor', dialog: true, sel: '#boost-edit-modal', open: "VexBoosts.openEditor('example.com')", close: "document.getElementById('boost-edit-modal')?.remove()" },
  { name: 'the developer dashboard', dialog: true, sel: '#vex-devdash', open: 'VexDevMode.openDashboard()', close: "document.getElementById('vex-devdash')?.remove()" },
  { name: 'the AI panel', sel: '#ai-panel', open: 'AIPanel.open()', close: 'AIPanel.close()' },
  { name: 'the passkey sheet', dialog: true, sel: '#vex-passkey-sheet', open: "PasskeyUI.openSheet({ id: 'check-ui', kind: 'create', host: 'example.com', rpName: 'Example', userName: 'ada', userDisplayName: 'Ada', uv: 'discouraged', hasPin: false })", close: "document.querySelectorAll('.vex-dialog-overlay').forEach(o => o._vexCancel && o._vexCancel())" },
  { name: 'the passkey picker', dialog: true, sel: '#vex-passkey-sheet', open: "PasskeyUI.openSheet({ id: 'check-ui', kind: 'get', host: 'example.com', rpName: 'Example', uv: 'discouraged', hasPin: false, accounts: [{ credentialId: 'a', userName: 'ada', userDisplayName: 'Ada', createdAt: '2026-01-01T00:00:00Z' }, { credentialId: 'b', userName: 'grace', userDisplayName: 'Grace', createdAt: '2026-01-02T00:00:00Z' }] })", close: "document.querySelectorAll('.vex-dialog-overlay').forEach(o => o._vexCancel && o._vexCancel())" },
  { name: 'a sidebar button menu', sel: '.tab-context-menu', open: "(() => { const b = document.querySelector('#icon-sidebar .sidebar-icon'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 })); })()", close: "document.querySelectorAll('.tab-context-menu, .context-menu-overlay').forEach(m => m.remove())" },
  ...PANEL_IDS.map(id => ({ name: 'the ' + id + ' panel', sel: '#panel-' + id, open: "SidebarManager.openPanel('" + id + "')", close: 'SidebarManager.hideActivePanel()' })),
  // Work became the strip at the top of the Toolbox.
  { name: 'the Toolbox', dialog: true, sel: '#vex-toolbox', open: 'Toolbox.open()', close: "document.getElementById('vex-toolbox')?.remove()" },
  // The former Schedules panel: the Clock panel's Scheduled tasks sub-tab.
  { name: 'the scheduled tasks tab', sel: '#panel-clock', open: "SidebarManager.openPanel('schedules')", close: 'SidebarManager.hideActivePanel()' },
];

// After a surface was closed: nothing may still take the window's clicks.
async function sweepClicks(cdp, surface, style, theme, findings) {
  const r = await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => r(window.VexLayer ? window.VexLayer.sweep() : null)))');
  if (!r) throw new Error('VexLayer is not loaded, so the click sweep would be reporting on nothing');
  for (const b of r.blockers) findings.push({ check: 'overlay-blocks-clicks', element: b.element, message: 'after closing ' + surface + ', ' + b.element + ' still covers ' + b.covers + '% of the window and takes clicks (z-index ' + b.zIndex + ')', numbers: { covers: b.covers }, style, colors: 'overlay sweep', theme });
  for (const p of r.blockedPoints) findings.push({ check: 'overlay-blocks-clicks', element: p.under || p.hit, message: 'after closing ' + surface + ', a click at ' + p.x + ',' + p.y + ' lands on ' + p.hit + (p.under ? ' inside ' + p.under : '') + ' instead of the page', numbers: { x: p.x, y: p.y }, style, colors: 'overlay sweep', theme });
}

async function scanSurfaces(cdp, port, exceptions, styles, themes, findings, summaries) {
  // The New Tab page: its own target, its own copy of the audit library. A
  // look change can reload it, so the library is put back whenever it is gone.
  let newTab = null;
  const newTabReady = async () => {
    if (newTab) {
      try { if (await evaluate(newTab, 'typeof window.__vexCheckUi') === 'object') return newTab; }
      catch { newTab.close(); newTab = null; }
    }
    if (!newTab) {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const start = list.find(t => /\/renderer\/start\.html/.test(t.url || ''));
      if (!start) throw new Error('no New Tab page to check — the first tab should be one');
      newTab = await connectCdp(start.webSocketDebuggerUrl);
      await newTab.send('Runtime.enable');
    }
    if (await evaluate(newTab, PAGE_LIB) !== 'installed') throw new Error('audit library did not install in the New Tab page');
    return newTab;
  };
  try {
    // The Toolbox draws once its tool packs are loaded; load them first so opening it below is immediate.
    await evaluate(cdp, "typeof Toolbox !== 'undefined' ? Toolbox.ensurePacks().then(() => true) : true");
    for (const style of styles) {
      await evaluate(cdp, 'window.VexGuiStyle.set(' + JSON.stringify(style) + ')');
      if (await evaluate(cdp, 'window.VexGuiStyle.isBrowserLook()')) await evaluate(cdp, "window.VexGuiStyle.setColors('theme')");
      await sleep(250);
      const judgedBy = {};
      let count = 0;
      for (const theme of themes) {
        await evaluate(cdp, 'window.ThemeManager.applyTheme(' + JSON.stringify(theme) + ', { persist: false })');
        for (const s of SURFACES) {
          await evaluate(cdp, '(() => { ' + s.open + '; return true; })()');
          await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
          await sleep(120);
          const res = await evaluate(cdp, 'window.__vexCheckUi.scanSurface(' + JSON.stringify(exceptions) + ', ' + JSON.stringify(style) + ', ' + JSON.stringify(s.name) + ', ' + JSON.stringify(s.sel) + ')');
          const ax = await runA11yScan(cdp, exceptions, style, s.name, s.sel, s.dialog);
          await evaluate(cdp, '(() => { ' + s.close + '; return true; })()');
          if (SWEEP) await sweepClicks(cdp, s.name, style, theme, findings);
          for (const f of ax.findings) findings.push({ ...f, style, colors: 'keyboard', theme });
          count += ax.findings.length;
          if (!res.roots || !res.judged) throw new Error('judged no text in ' + s.name + ' (' + style + '/' + theme + ') — it did not open, or the check would be reporting on nothing');
          judgedBy[s.name] = Math.max(judgedBy[s.name] || 0, res.judged);
          for (const f of res.findings) findings.push({ ...f, style, colors: 'surfaces', theme });
          count += res.findings.length;
        }
        for (const s of A11Y_ONLY_SURFACES) {
          await evaluate(cdp, '(() => { ' + s.open + '; return true; })()');
          await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
          await sleep(120);
          const ax = await runA11yScan(cdp, exceptions, style, s.name, s.sel, s.dialog);
          await evaluate(cdp, '(() => { ' + s.close + '; return true; })()');
          if (!ax.roots) throw new Error(s.name + ' did not open (' + style + '/' + theme + ') — the keyboard check would be reporting on nothing');
          for (const f of ax.findings) findings.push({ ...f, style, colors: 'keyboard', theme });
          count += ax.findings.length;
        }
        // The New Tab page follows the theme a beat later (it is recoloured
        // by script); wait until it wears this one.
        const t0 = Date.now();
        while (await evaluate(await newTabReady(), 'document.documentElement.getAttribute("data-theme")') !== theme) {
          if (Date.now() - t0 > 5000) throw new Error('the New Tab page never took the theme ' + theme);
          await sleep(100);
        }
        await sleep(150);
        const res = await evaluate(await newTabReady(), 'window.__vexCheckUi.scanSurface(' + JSON.stringify(exceptions) + ', ' + JSON.stringify(style) + ', "the New Tab page", "body")');
        if (!res.judged) throw new Error('judged no text on the New Tab page (' + style + '/' + theme + ')');
        judgedBy['the New Tab page'] = Math.max(judgedBy['the New Tab page'] || 0, res.judged);
        const axNew = await runA11yScan(await newTabReady(), exceptions, style, 'the New Tab page', 'body');
        for (const f of axNew.findings) findings.push({ ...f, style, colors: 'keyboard', theme });
        count += axNew.findings.length;
        for (const f of res.findings) findings.push({ ...f, style, colors: 'surfaces', theme });
        count += res.findings.length;
      }
      summaries.push({ style, colors: 'surfaces', themes: themes.length, controls: Object.keys(judgedBy).length, colours: Object.values(judgedBy).reduce((a, b) => a + b, 0), findings: count });
    }
  } finally {
    if (newTab) newTab.close();
  }
}

// ---------------------------------------------------------------------------
// SETTINGS LAYOUT — Settings at a 1920x1080 and a 2560x1440 window (the
// window's size emulated, the real one is whatever it is), in the default
// layout and the Settings layout choices, judged by settingsLayout() above.
// ---------------------------------------------------------------------------
const SETTINGS_SIZES = [[1280, 720], [1920, 1080], [2560, 1440]];
// Every Settings layout choice (SettingsUI.LAYOUT_CHOICES): columns x category
// menu x density. The sample takes every column choice with both menus and
// both densities (the density alternates, so each pairing meets each column
// choice at least once across the sample) at every size; --full takes all 20
// at every size, in every look. The default (nothing saved) is always in.
const SETTINGS_COLUMNS = ['auto', '1', 'wide', '2', '3'];
const SETTINGS_NAVS = ['chips', 'side'];
const SETTINGS_DENSITIES = ['comfortable', 'compact'];
const COLUMN_NAMES = { auto: 'automatic columns', 1: 'one column', wide: 'one column, full width', 2: 'two columns', 3: 'three columns' };
const NAV_NAMES = { chips: 'chips', side: 'list on the left' };
function settingsLayouts(full) {
  const out = [{ label: 'default layout', prefs: null, expect: { columns: 'auto' } }];
  for (const columns of SETTINGS_COLUMNS) {
    for (const nav of SETTINGS_NAVS) {
      for (const density of SETTINGS_DENSITIES) {
        // Sample: the density follows the column choice and the menu, so
        // 10 of the 20 run; --full runs all.
        if (!full && (SETTINGS_COLUMNS.indexOf(columns) + SETTINGS_NAVS.indexOf(nav) + SETTINGS_DENSITIES.indexOf(density)) % 2) continue;
        out.push({ label: COLUMN_NAMES[columns] + ', ' + NAV_NAMES[nav] + ', ' + density, prefs: { columns, nav, density }, expect: { columns, nav } });
      }
    }
  }
  return out;
}

// Settings places its blocks from observers that run a frame or two after a
// change; measured the instant they are due, a busy machine caught the blocks
// where they were before (an "overlap" that was gone 100ms later). Wait until
// no block has moved for 300ms, at most 3s, and judge what the person is left
// looking at. A layout that never settles, or settles wrong, is still flagged.
// While the sections draw, the placement is held (SettingsUI.holdLayout) and nothing moves, however long a slow machine takes: that is not settled.
async function settleSettingsLayout(cdp) {
  const sig = "Array.from(document.querySelectorAll('#panel-settings .settings-content > *')).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.left) + ':' + Math.round(r.top) + ':' + Math.round(r.height); }).join() + '|' + (SettingsUI._held || 0) + (SettingsUI._owed ? 'o' : '')";
  const until = Date.now() + 30000;
  let last = null, same = 0;
  while (Date.now() < until && same < 3) {
    const now = await evaluate(cdp, sig);
    same = now === last && /|0$/.test(now) ? same + 1 : 0;
    last = now;
    await sleep(100);
  }
}

async function scanSettingsLayout(cdp, exceptions, styles, findings, summaries) {
  try {
    for (const style of styles) {
      await evaluate(cdp, 'window.VexGuiStyle.set(' + JSON.stringify(style) + ')');
      await sleep(250);
      let count = 0, blocks = 0, runs = 0;
      // The owner's look gets every size; the others the 1920 window and, for
      // the full width choice, the rest (--full: every size in every look).
      // Larger and Largest text zoom the panel: fewer CSS pixels, a row of
      // the grid drawn in 1/64ths. Here a section ended 35-40px short of
      // where the next began until the zoom was read from the style.
      const base = settingsLayouts(FULL);
      const scenarios = [];
      for (const [width, height] of SETTINGS_SIZES) for (const layout of base) scenarios.push({ size: 'normal', width, height, layout });
      const textLayouts = [base[0], base.find(l => l.expect.columns === '2' && l.expect.nav === 'side') || base[1]];
      for (const size of ['larger', 'largest']) {
        for (const [width, height] of [[1920, 1080], [2560, 1440]]) for (const layout of textLayouts) scenarios.push({ size, width, height, layout });
      }
      let sized = null;
      let sizedAt = null;
      for (const { size, width, height, layout } of scenarios) {
        {
          if (!FULL && style !== 'firefox' && size === 'normal' && width !== 1920 && !(layout.expect.columns === 'wide')) continue;
          if (sizedAt !== width + 'x' + height) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            sizedAt = width + 'x' + height;
          }
          if (sized !== size) {
            await evaluate(cdp, 'VexFonts.setSize(' + JSON.stringify(size) + '); true');
            sized = size;
          }
          const label = width + 'x' + height + (size === 'normal' ? '' : ', ' + size + ' text') + ', ' + layout.label;
          await evaluate(cdp, '(() => { const p = ' + JSON.stringify(layout.prefs) + ';' +
            " if (p) localStorage.setItem('vex.settingsLayout', JSON.stringify(p)); else localStorage.removeItem('vex.settingsLayout');" +
            " SidebarManager.openPanel('settings'); SettingsUI.applyLayoutPrefs(); return true; })()");
          await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
          await sleep(150);
          runs++;
          await settleSettingsLayout(cdp);
          const res = await evaluate(cdp, 'window.__vexCheckUi.settingsLayout(' + JSON.stringify(exceptions) + ', ' + JSON.stringify(style) + ', ' + JSON.stringify(label) + ', ' + JSON.stringify(layout.expect) + ')');
          if (!res.blocks) throw new Error('Settings showed no sections (' + style + ', ' + label + ') — the check would be reporting on nothing');
          blocks = Math.max(blocks, res.blocks);
          for (const f of res.findings) findings.push({ ...f, style, colors: 'settings layout', theme: label });
          count += res.findings.length;
          // The frame after a section grows (the models list arriving).
          if (width === 1920) {
            const grown = await evaluate(cdp, 'window.__vexCheckUi.settingsGrow(' + JSON.stringify(exceptions) + ', ' + JSON.stringify(style) + ', ' + JSON.stringify(label) + ', ' + JSON.stringify(layout.expect) + ')');
            for (const f of grown.findings) findings.push({ ...f, style, colors: 'settings layout', theme: label });
            count += grown.findings.length;
            // The menu marks the entry clicked (the owner's look, default
            // and the first two column choices only: each click scrolls).
            if (style === 'firefox' && size === 'normal' && (layout.prefs === null || layout.expect.columns === '2' || layout.expect.columns === 'auto')) {
              const marked = await evaluate(cdp, 'window.__vexCheckUi.settingsChips(' + JSON.stringify(style) + ', ' + JSON.stringify(label) + ')');
              for (const f of marked.findings) findings.push({ ...f, style, colors: 'settings layout', theme: label });
              count += marked.findings.length;
            }
          }
        }
      }
      summaries.push({ style, colors: 'settings layout', themes: runs, controls: blocks, colours: 0, findings: count });
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await evaluate(cdp, "(VexFonts.setSize('normal'), localStorage.removeItem('vex.settingsLayout'), SettingsUI.applyLayoutPrefs(), SidebarManager.hideActivePanel(), true)");
  }
}

// The keyboard scan judges what Tab shows, so the page must be in keyboard
// modality: Chromium only matches :focus-visible on a script focus() after a
// key event (focus({ focusVisible: true }) is not honoured here). One real Tab
// key through the target, with focus parked first, does it.
async function runA11yScan(target, exceptions, style, name, sel, dialog) {
  // Focus a real control first, so the key goes to this document and not to a
  // page's guest that held the window's focus.
  await evaluate(target, '(() => { const e = Array.from(document.querySelectorAll("button, input, a[href], [tabindex]")).find(x => x.getClientRects().length && !x.disabled); if (e) e.focus(); return true; })()');
  await target.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await target.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  return evaluate(target, 'window.__vexCheckUi.a11yScan(' + JSON.stringify(exceptions) + ', ' + JSON.stringify(style) + ', ' + JSON.stringify(name) + ', ' + JSON.stringify(sel) + ', ' + JSON.stringify(!!dialog) + ')');
}

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

// The chrome is laid out more than once while Vex starts: about 2.3s in, the
// classic toolbar's right side collapsed for one frame (its buttons 16px wide,
// 195px of them in a 41px box) and the first sample, measured on that frame,
// reported six overlaps and two clipped buttons that are not there. Measure
// only once the chrome has held still for a while. Polling the boxes could miss
// a change that lasts one frame, so the page itself notes the time of every
// resize of a chrome element, of the window, and of a change to body's data-*
// switches (look, layout, theme colours).
async function waitForStableLayout(cdp, timeoutMs) {
  await evaluate(cdp, `(() => {
    if (window.__vexCheckUiMoves) return;
    const st = window.__vexCheckUiMoves = { last: performance.now() };
    const bump = () => { st.last = performance.now(); };
    const ro = new ResizeObserver(bump);
    for (const el of document.querySelectorAll('#top-bar, #top-bar *, #top-tab-bar, #top-tab-bar *, #icon-sidebar, #icon-sidebar *')) ro.observe(el);
    addEventListener('resize', bump);
    new MutationObserver(bump).observe(document.body, { attributes: true });
  })()`);
  const QUIET_MS = 1500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const quiet = await evaluate(cdp, 'performance.now() - window.__vexCheckUiMoves.last');
    if (quiet >= QUIET_MS) return;
    await sleep(Math.max(100, QUIET_MS - quiet));
  }
  throw new Error('the chrome never stopped moving — something in it changed size at least every ' + (QUIET_MS / 1000) + 's for ' + Math.round(timeoutMs / 1000) + 's, so no measurement would describe what the user sees');
}

// TRAP 3. The profile says the wizard is done before Vex starts, so it is never
// scheduled. The preference file is the one Vex hydrates localStorage from
// (js/storage.js) before app.js asks Onboarding.maybeStart().
const SEEDED_PREFERENCES = {
  'vex.onboardingDone': 'true',   // Onboarding.KEY
  'vex.tourSeen': '1',            // what finish() also sets: no tour offer either
  'vex.privacyDefaults': '1',     // Onboarding.PRIVACY_DEFAULTS_KEY: nothing to migrate or announce
  // The privacy policy and terms, accepted as a profile past first run would
  // have them (js/legal.js): otherwise their dialog covers the toolbar.
  'vex.legalAcceptedVersion': String(require('../src/renderer/js/legal.js').VexLegal.VERSION),
  // A profile that finished the wizard but never ran gets app.js's older
  // "Welcome to Vex" card instead (.welcome-overlay, z-index 100000) — the
  // cause of "judged 0 foreground colours at classic/oxford".
  'vex.hasRunBefore': 'true',
  // Game mode (js/game-session.js) asks "Turn on Game mode?" once, the moment
  // the OS reports a full-screen app in front. The checker runs on a desktop
  // somebody is using, so that dialog (z-index 2147483600) arrives mid-run and
  // covers the whole window: "judged 0 foreground colours". An answered
  // question is what a profile past its first game has.
  'vex.gameMode': 'off',
};

function seedProfile(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'vex-persist.json'), JSON.stringify(SEEDED_PREFERENCES));
}

// Proof the seed took, rather than hoping: the flag reads as set in the page,
// and the toolbar is what a click at its centre lands on — not the wizard, the
// welcome card or any other first-run sheet over the window.
async function assertNothingCovers(cdp) {
  const state = await evaluate(cdp, `(() => {
    const bar = document.querySelector('#top-bar');
    const r = bar ? bar.getBoundingClientRect() : null;
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    const top = hit && !(bar.contains(hit) || hit.contains(bar)) ? hit.closest('body > *') || hit : null;
    return {
      done: !!(window.Onboarding && window.Onboarding.done()),
      cover: top ? ((top.id ? '#' + top.id : '') + '.' + String(top.className || top.tagName)).slice(0, 80) : null
    };
  })()`);
  if (!state.done) throw new Error('the seeded profile did not mark onboarding done — vex-persist.json was not read');
  if (state.cover) throw new Error('something covers the toolbar (' + state.cover + ') in a profile seeded past first run — nothing under it could be measured');
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
  if (colors === 'surfaces') return style + ' (panels, menus, New Tab)';
  if (colors === 'settings layout') return style + ' (Settings layouts)';
  return colors ? style + ' (' + colors + ' colours)' : style;
}

// Every shortcut chip has fallen back to its letter (favicons are blocked in
// main()). A favicon still showing means the block leaked, and the run would
// again depend on the network — that is a harness failure, not a pass.
async function settleShortcutChips(cdp) {
  const left = await evaluate(cdp, `new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const imgs = document.querySelectorAll('#gui-shortcuts-bar .gsc .ic img');
      if (!imgs.length || performance.now() - t0 > 5000) resolve(imgs.length);
      else setTimeout(tick, 50);
    };
    tick();
  })`);
  if (left) throw new Error(left + ' shortcut favicon(s) loaded despite the block — the letter-chip contrast would depend on the network');
}

async function main() {
  const started = Date.now();
  const port = await freePort();
  const userDataDir = path.join(os.tmpdir(), 'vex-check-ui-' + process.pid + '-' + Date.now());
  seedProfile(userDataDir);

  // Equivalent to `npx electron . --user-data-dir=… --remote-debugging-port=…`,
  // but resolving the binary through require('electron') the way the repo's
  // other Electron harnesses do (no npx resolution step on Windows). `-r` loads
  // the probe into the main process before src/main.js (Electron's own option).
  // The harness (scripts/lib/probe-harness.js) forces VEX_NO_OS_SCHEDULE=1,
  // refuses a profile outside the temp folder and stops only this PID's tree.
  const probe = harness.launch({
    exe: electronPath,
    args: [
      '-r', path.join(__dirname, 'check-ui-probe.js'),
      '.',
      '--user-data-dir=' + userDataDir,
      '--remote-debugging-port=' + port,
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    cwd: REPO,
    // --keep-open is only useful if the app OUTLIVES this script, so there it
    // gets its own process group. It must also be given NO pipes: a detached
    // child holding inherited stdio keeps the launching shell waiting for EOF
    // long after this process exits, so the command looks like it hung. Losing
    // the app log in that one mode is the right trade for a debugging flag.
    stdio: KEEP_OPEN ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe'],
    detached: KEEP_OPEN,
  });
  const child = probe.child;

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
    // stopOwned verifies the PID is still the Vex this run started, then
    // kills it and the processes below it, each by PID.
    try { harness.stopOwned(probe); }
    catch (err) { console.warn('check-ui: ' + err.message); }
    // Nothing sweeps Temp on Windows: five quick retries lost to Vex's exiting
    // child processes and the profile stayed for good.
    // rmSync's own retries do not cover EPERM on a file Windows still holds
    // for the exiting processes, so it gave up at once and a profile was left
    // behind every run; a few seconds later the same delete succeeds.
    const until = Date.now() + 15000;
    for (;;) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); break; }
      catch (err) {
        if (Date.now() > until) { console.warn('could not remove ' + userDataDir + ': ' + err.message); break; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); // the 'exit' handler cannot await
      }
    }
  };

  // Always kill the app and drop the throwaway profile, including on failure.
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(2); });

  try {
    const target = await waitForTarget(port, 60000);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    // The shortcuts bar shows a site's favicon, or a coloured letter chip when
    // the favicon does not load. Which one a look got depended on the network
    // at that moment, so a letter-chip finding moved from look to look between
    // runs. No favicon is fetched here: every look judges the same letter chips
    // (the case that can fail contrast), every run.
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.setBlockedURLs', { urls: ['*/favicon.ico'] });
    await waitForRenderer(cdp, 60000);

    await waitForStableLayout(cdp, 30000);
    await assertNothingCovers(cdp);
    // The probe prints the list it handed Chromium each time main.js sets it.
    // Without it a covered window stalls the run for many minutes, so its
    // absence is a harness failure. (--keep-open drops the app's output.)
    if (!KEEP_OPEN) {
      const lists = appLog.split('\n').filter(l => l.includes('[check-ui-probe] disable-features='));
      if (!lists.length || !/\bCalculateNativeWinOcclusion\b/.test(lists[lists.length - 1])) {
        throw new Error('scripts/check-ui-probe.js did not run in the app — the window would stop drawing whenever it is covered');
      }
    }

    const installed = await evaluate(cdp, PAGE_LIB);
    if (installed !== 'installed') throw new Error('audit library did not install');

    const styles = await evaluate(cdp, '(window.VexGuiStyle && window.VexGuiStyle.styles()) || null');
    if (!Array.isArray(styles) || !styles.length) throw new Error('VexGuiStyle.styles() returned nothing — renderer not ready');

    const allThemes = await evaluate(cdp, '(window.ThemeManager && window.ThemeManager.availableThemes) || null');
    if (!Array.isArray(allThemes) || !allThemes.length) throw new Error('ThemeManager.availableThemes returned nothing');

    let themes = FULL ? allThemes : SAMPLE_THEMES.filter(t => allThemes.includes(t));
    if (themeArg) {
      if (!allThemes.includes(themeArg)) throw new Error('unknown theme "' + themeArg + '"');
      themes = [themeArg];
    }
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
      await settleShortcutChips(cdp);
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
          // Keyboard and screen-reader structure of the whole window in this
          // look and theme: names, Tab stops, and the focus ring each look draws.
          const ax = await runA11yScan(cdp, EXCEPTIONS, style, 'the window', 'body');
          if (!ax.judged || !ax.rings) throw new Error('judged no Tab stops or no focus ring at ' + at + ' — the keyboard check would be reporting on nothing');
          for (const f of ax.findings) findings.push({ ...f, style, colors, theme });
          count += ax.findings.length;
          count += result.findings.length;
        }
        summaries.push({ style, colors, themes: themes.length, controls, colours, findings: count });
      }
    }

    // Panels, menus, dialogs, pickers and the New Tab page, in the Firefox
    // look and Glass (or the one style asked for, if it is either).
    const surfaceStyles = SURFACE_STYLES.filter(s => runStyles.includes(s));
    if (surfaceStyles.length) await scanSurfaces(cdp, port, EXCEPTIONS, surfaceStyles, themes, findings, summaries);
    // Settings in columns and in each Settings layout, in the Firefox look
    // (the owner's), Glass and Classic.
    const layoutStyles = ['firefox', 'glass', 'classic'].filter(s => runStyles.includes(s));
    if (layoutStyles.length) await scanSettingsLayout(cdp, EXCEPTIONS, layoutStyles, findings, summaries);

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
        console.log('  ' + (s.findings ? 'FLAG' : ' ok ') + '  ' + label.padEnd(32) +
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
