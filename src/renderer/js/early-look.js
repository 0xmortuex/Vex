// === The window's look, painted from its very first frame =====================
//
// Vex's window was shown when index.html had painted once, and index.html paints before its 670 scripts have run: so every start showed the
// default cream theme and the Classic look, then the saved theme, then the saved look (three changes in a row, measured in a real window with a
// screencast of a reload, 2026-10-25). The scripts that apply the theme and the look cannot run earlier: they build the toolbar and read stores.
//
// So the window keeps a SNAPSHOT of how it looked, and this script (the first thing in <head>, before anything is drawn) puts it back at once:
//   - the colour theme and its light or dark flag (<html data-theme, data-scheme>) and the theme's own custom properties;
//   - the look and its layout (<body data-gui-style, data-gui-family, data-gui-colors, data-sb-side, data-sb-launcher, data-tab-layout, data-ui-mode>);
//   - the custom properties on <html> and <body> (the font, the scale, the density, the sidebar width...).
// The snapshot is not a second copy of the logic: it is read back from the page itself. Once the window has settled (VexBoot.marks.settled), an
// observer on those attributes writes it again whenever any of them changes, so every way of changing the theme or the look is covered, now and
// later. A window with no snapshot (the first run, a private window, which keeps its own storage) starts as before.
//
// This file must stay small, synchronous and free of everything else: it runs in <head>, before the rest of the page exists.
(function () {
  'use strict';
  var KEY = 'vex.bootLook';
  var HTML_ATTRS = ['data-theme', 'data-scheme', 'data-look'];
  var BODY_ATTRS = ['data-gui-style', 'data-gui-family', 'data-gui-colors', 'data-sb-side', 'data-sb-launcher', 'data-tab-layout', 'data-ui-mode'];

  function customProps(el) {
    var out = {};
    var st = el.style;
    for (var i = 0; i < st.length; i++) {
      var name = st[i];
      if (name.indexOf('--') === 0) out[name] = st.getPropertyValue(name);
    }
    return out;
  }

  function read(el, attrs) {
    var out = {};
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v !== null) out[attrs[i]] = v;
    }
    return out;
  }

  function snapshot() {
    var html = document.documentElement;
    var body = document.body;
    return { v: 1, html: { attrs: read(html, HTML_ATTRS), vars: customProps(html) }, body: { attrs: read(body, BODY_ATTRS), vars: customProps(body) } };
  }

  function put(el, part, allowed) {
    if (!part || typeof part !== 'object') return;
    var attrs = part.attrs || {};
    for (var i = 0; i < allowed.length; i++) {
      var name = allowed[i];
      if (typeof attrs[name] === 'string' && attrs[name].length <= 80) el.setAttribute(name, attrs[name]);
    }
    var vars = part.vars || {};
    for (var key in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, key) && key.indexOf('--') === 0 && typeof vars[key] === 'string' && vars[key].length <= 400) {
        el.style.setProperty(key, vars[key]);
      }
    }
  }

  // The look a window was opened with: a private window keeps its own storage, so the window it was opened from puts its snapshot in the
  // address (?boot=). Null when there is none, or it is not a snapshot.
  function carried() {
    var raw = null;
    try { raw = new URLSearchParams(location.search).get('boot'); } catch (err) { console.error('[EarlyLook] the address could not be read:', err); return null; }
    if (!raw || raw.length > 4000) return null;
    try {
      var snap = JSON.parse(raw);
      return snap && snap.v === 1 ? snap : null;
    } catch (err) { console.error('[EarlyLook] the look in the address is not valid JSON, ignoring it:', err); return null; }
  }

  // This window's look as text, for a window it opens.
  function forNewWindow() {
    try { return JSON.stringify(snapshot()); } catch (err) { console.error('[EarlyLook] could not describe the window look:', err); return undefined; }
  }

  // Put the saved look back. Returns true when there was one.
  function apply() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (err) { console.error('[EarlyLook] saved look unreadable:', err); return false; }
    if (!raw) {
      var given = carried();
      if (!given) return false;
      raw = JSON.stringify(given);
    }
    var snap;
    try { snap = JSON.parse(raw); } catch (err) { console.error('[EarlyLook] the saved look is not valid JSON, ignoring it:', err); return false; }
    if (!snap || snap.v !== 1) return false;
    put(document.documentElement, snap.html, HTML_ATTRS);
    // This script runs in <head>, so <body> does not exist yet: it is dressed the moment the parser creates it (a mutation callback runs
    // before the next paint), not at the end of the page.
    if (document.body) put(document.body, snap.body, BODY_ATTRS);
    else {
      var waiting = new MutationObserver(function () {
        if (!document.body) return;
        waiting.disconnect();
        put(document.body, snap.body, BODY_ATTRS);
      });
      waiting.observe(document.documentElement, { childList: true });
    }
    return true;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); }
    catch (err) { console.error('[EarlyLook] could not save the window look:', err); }
  }

  // Keep the snapshot current once the window is settled (before that, the page passes through its defaults on the way to the saved look).
  function watch() {
    var timer = null;
    var later = function () { clearTimeout(timer); timer = setTimeout(save, 400); };
    var opts = function (attrs) { return { attributes: true, attributeFilter: attrs.concat(['style']) }; };
    new MutationObserver(later).observe(document.documentElement, opts(HTML_ATTRS));
    new MutationObserver(later).observe(document.body, opts(BODY_ATTRS));
    save();
  }

  function whenSettled() {
    var tries = 0;
    // A chain of short timeouts, not an interval: this runs before the job scheduler (js/jobs.js) exists, and stops by itself.
    var poll = function () {
      tries++;
      var settled = typeof VexBoot !== 'undefined' && VexBoot && VexBoot.marks && VexBoot.marks.settled;
      if (settled) watch();
      else if (tries > 240) console.error('[EarlyLook] the window never settled, so its look was not saved');
      else setTimeout(poll, 500);
    };
    setTimeout(poll, 500);
  }

  var applied = false;
  try { applied = apply(); } catch (err) { console.error('[EarlyLook] could not put the saved look back:', err); }
  window.VexEarlyLook = { KEY: KEY, HTML_ATTRS: HTML_ATTRS, BODY_ATTRS: BODY_ATTRS, applied: applied, apply: apply, save: save, snapshot: snapshot, carried: carried, forNewWindow: forNewWindow };
  window.addEventListener('DOMContentLoaded', whenSettled, { once: true });
})();
