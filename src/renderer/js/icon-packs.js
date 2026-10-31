// === Icon packs: one icon set, drawn in more than one style ===================
//
// Every icon in Vex is a VexIcons SVG (js/vex-icons.js). An icon pack is a style the WHOLE app can wear at run time without any call site
// changing: VexIcons.svg('home') still returns the same <svg>, but this file tells it which markup to use and tags it so a pack change can
// repaint the icons already on screen.
//
// A pack works in up to three ways, from cheap to dramatic:
//   1. css/icon-packs.css restyles every .vex-icon by attribute (stroke weight, round or square ends, corner radius of the rects, a tint in
//      the closed shapes). Bold, Duotone, Soft and Sharp are only this.
//   2. `glyphs` swaps the drawing of named icons for another one drawn on the same 24x24 box (Solid draws filled shapes, Pixel draws on a
//      12x12 grid of 2px squares). An icon a pack does not redraw keeps the default drawing, restyled by (1), so every pack has every icon.
//   3. `data-fill` marks the icons made of one closed shape, so the Duotone tint and the Solid fallback only fill shapes that look right filled.
//
// The glyphs below are original drawings made for Vex; no outside icon set is copied here.
//
// Public API (window.VexIconPacks):
//   PACKS, get(id), current(), set(id)   set() throws on an unknown id, saves the choice and repaints
//   apply()                              puts the saved choice on the page (run once at load; safe to run again)
//   refresh(root)                        redraws the VexIcons already inside `root` for the pack in force
//   glyphFor(name, id)                   the redrawn markup of an icon in a pack, or null when the pack keeps the default
(function () {
  'use strict';
  var KEY = 'vex.iconPack';
  var DEFAULT = 'outline';
  var ICONS = (typeof window !== 'undefined' && window.VexIcons) || null;
  if (!ICONS) throw new Error('icon-packs.js needs js/vex-icons.js loaded first');

  // ---- The icons made of one closed shape: the ones a tint or a fill suits --------------------------------------------------------------
  var CLOSED = {};
  ('home folder folder-open file file-text file-pdf file-sheet file-slides note book book-open newspaper clipboard receipt box database save bookmark star tag ' +
    'window tabs sidebar sidebar-right split monitor tv phone image video camera mail message bell shield lock unlock key user users mask robot brain cloud moon sun ' +
    'heart flame zap bulb droplet leaf pin gift briefcase card calendar clock alarm timer globe compass target flag flask palette gamepad cpu battery archive trash ' +
    'printer puzzle toolbox rocket graduation scale stethoscope coffee dice table grid cart onion incognito sparkles').split(' ').forEach(function (n) { CLOSED[n] = 1; });

  // ---- Solid: filled drawings, by hand, on the 24x24 box --------------------------------------------------------------------------------
  // `F` is a filled shape whose corners are rounded by a thin stroke of the same colour; `C` is a filled shape that has holes (even-odd), so it
  // is not stroked (the stroke would eat the holes).
  function F(d) { return '<path d="' + d + '" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'; }
  function C(d) { return '<path fill-rule="evenodd" d="' + d + '" fill="currentColor" stroke="none"/>'; }
  var SOLID = {
    'home':      F('M12 3.4 3.8 10.4V19.2a1.2 1.2 0 0 0 1.2 1.2H9.6V14.6h4.8v5.8H19a1.2 1.2 0 0 0 1.2-1.2V10.4z'),
    'star':      F('M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'),
    'heart':     F('M12 20.4S3.8 15.4 3.8 9.5A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.2 2.9c0 5.9-8.2 10.9-8.2 10.9z'),
    'bookmark':  F('M6.8 3.8h10.4v16.4L12 16.5l-5.2 3.7z'),
    'bell':      C('M12 2.8a6.6 6.6 0 0 0-6.6 6.6c0 5.2-2 6.6-2 6.6h17.2s-2-1.4-2-6.6A6.6 6.6 0 0 0 12 2.8zM9.4 17.6h5.2a2.6 2.6 0 0 1-5.2 0z'),
    'lock':      C('M6.5 10h11a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10zM12 13a1.7 1.7 0 0 0-.9 3.1V18h1.8v-1.9A1.7 1.7 0 0 0 12 13z') +
                 '<path d="M7.8 10V7.6a4.2 4.2 0 0 1 8.4 0V10" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    'shield':    F('M12 3.2 19.6 6v6c0 4.2-3 7.2-7.6 8.6C7.4 19.2 4.4 16.2 4.4 12V6z'),
    'folder':    F('M4.6 5.2h4.5l2.2 2.4h8A1.2 1.2 0 0 1 20.5 8.8v9.4a1.2 1.2 0 0 1-1.2 1.2H4.6a1.2 1.2 0 0 1-1.2-1.2V6.4a1.2 1.2 0 0 1 1.2-1.2z'),
    'file':      F('M6.8 3.6h6.6l4.6 4.6v11.4a1 1 0 0 1-1 1H6.8a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1z'),
    'user':      '<circle cx="12" cy="7.8" r="4.2" fill="currentColor" stroke="none"/><path d="M3.6 21a8.4 8.4 0 0 1 16.8 0z" fill="currentColor" stroke="none"/>',
    'clock':     C('M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4zM11 6.8h2v5.2l3.3 2-1 1.7-4.3-2.6z'),
    'settings':  C('M10.3 2.8h3.4l.5 2.4 1.5.7 2-1.4 2.4 2.4-1.4 2 .7 1.5 2.4.5v3.4l-2.4.5-.7 1.5 1.4 2-2.4 2.4-2-1.4-1.5.7-.5 2.4h-3.4l-.5-2.4-1.5-.7-2 1.4-2.4-2.4 1.4-2-.7-1.5-2.4-.5v-3.4l2.4-.5.7-1.5-1.4-2 2.4-2.4 2 1.4 1.5-.7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'),
    'mail':      C('M4.5 4.8h15A2.5 2.5 0 0 1 22 7.3v9.4a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.7V7.3a2.5 2.5 0 0 1 2.5-2.5zM3.6 7.1l8.4 5.7 8.4-5.7V8.9L12 14.6 3.6 8.9z'),
    'camera':    C('M8.6 3.8h6.8l1.7 2.4h2.4A2.5 2.5 0 0 1 22 8.7v9.8A2.5 2.5 0 0 1 19.5 21h-15A2.5 2.5 0 0 1 2 18.5V8.7a2.5 2.5 0 0 1 2.5-2.5h2.4zM12 9.4a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2z'),
    'trash':     F('M9.2 3.6h5.6l.7 1.7H20v1.9H4V5.3h4.5z') + F('M5.6 9h12.8l-.9 10.6a1.6 1.6 0 0 1-1.6 1.4H8.1a1.6 1.6 0 0 1-1.6-1.4z'),
    'calendar':  C('M7.2 2.8h1.8v1.8h6V2.8h1.8v1.8h1.7A2.5 2.5 0 0 1 21 7.1v11.4a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V7.1a2.5 2.5 0 0 1 2.5-2.5h1.7zM5.2 10.4v7.9a.8.8 0 0 0 .8.8h12a.8.8 0 0 0 .8-.8v-7.9z'),
    'window':    C('M5 4.5h14A2.5 2.5 0 0 1 21.5 7v10a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17V7A2.5 2.5 0 0 1 5 4.5zM4.8 9.4v7.4a.6.6 0 0 0 .6.6h13.2a.6.6 0 0 0 .6-.6V9.4z'),
    'card':      C('M5 5.5h14a2.8 2.8 0 0 1 2.8 2.8v7.4A2.8 2.8 0 0 1 19 18.5H5a2.8 2.8 0 0 1-2.8-2.8V8.3A2.8 2.8 0 0 1 5 5.5zM2.2 9.4v2.2h19.6V9.4z'),
    'zap':       F('M13.6 3.2 5.2 13.4h5.8l-.6 7.4 8.4-10.2h-5.8z'),
    'sparkles':  F('M10.4 3.4l1.7 4.6 4.6 1.7-4.6 1.7-1.7 4.6-1.7-4.6-4.6-1.7 4.6-1.7z') + F('M18.4 14.4l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z'),
    'pin':       C('M12 21.6s7-6.2 7-11.6a7 7 0 1 0-14 0c0 5.4 7 11.6 7 11.6zM12 7.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z'),
    'play':      F('M7.6 4.6 19 12 7.6 19.4z'),
    'eye':       C('M12 5.4C6.6 5.4 3 10.4 2.2 12 3 13.6 6.6 18.6 12 18.6S21 13.6 21.8 12C21 10.4 17.4 5.4 12 5.4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'),
    'sun':       '<circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none"/><path d="M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4" stroke-width="2"/>',
    'moon':      F('M20 14.6A8.4 8.4 0 0 1 9.4 4 8.5 8.5 0 1 0 20 14.6z'),
  };

  // ---- Pixel: drawn on a 12x12 grid, a '#' is a 2px square ------------------------------------------------------------------------------
  var ART = {
    'chevron-right': ['............', '..##........', '...##.......', '....##......', '.....##.....', '......##....', '......##....', '.....##.....', '....##......', '...##.......', '..##........', '............'],
    'arrow-right':   ['............', '............', '.......#....', '........#...', '.........#..', '.###########', '.###########', '.........#..', '........#...', '.......#....', '............', '............'],
    'check':         ['............', '............', '..........##', '.........##.', '........##..', '##.....##...', '.##...##....', '..##.##.....', '...###......', '....#.......', '............', '............'],
    'x':             ['............', '.##......##.', '..##....##..', '...##..##...', '....####....', '.....##.....', '....####....', '...##..##...', '..##....##..', '.##......##.', '............', '............'],
    'plus':          ['............', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.##########.', '.##########.', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............'],
    'minus':         ['............', '............', '............', '............', '............', '.##########.', '.##########.', '............', '............', '............', '............', '............'],
    'arrow-up':      ['............', '.....##.....', '....####....', '...######...', '..########..', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............', '............'],
    'home':          ['............', '.....##.....', '....####....', '...######...', '..########..', '.##########.', '..########..', '..###..###..', '..###..###..', '..###..###..', '............', '............'],
    'heart':         ['............', '..##....##..', '.####..####.', '.##########.', '.##########.', '.##########.', '..########..', '...######...', '....####....', '.....##.....', '............', '............'],
    'star':          ['.....##.....', '.....##.....', '....####....', '.##########.', '..########..', '...######...', '...######...', '..###..###..', '..##....##..', '............', '............', '............'],
    'search':        ['............', '..#####.....', '.##...##....', '.#.....#....', '.#.....#....', '.#.....#....', '.##...##....', '..#####.....', '.......##...', '........##..', '.........##.', '............'],
    'folder':        ['............', '.####.......', '.#####......', '.##########.', '.##########.', '.##########.', '.##########.', '.##########.', '.##########.', '.##########.', '............', '............'],
    'file':          ['............', '..######....', '..#######...', '..########..', '..########..', '..########..', '..########..', '..########..', '..########..', '..########..', '............', '............'],
    'user':          ['............', '....####....', '...######...', '...######...', '....####....', '............', '..########..', '.##########.', '.##########.', '.##########.', '............', '............'],
    'download':      ['.....##.....', '.....##.....', '.....##.....', '.....##.....', '.##..##..##.', '..##.##.##..', '...#####....', '....###.....', '.....#......', '............', '.##########.', '.##########.'],
    'refresh':       ['............', '...######...', '..##....##..', '.##......##.', '.##......###', '.##.......#.', '.##.........', '.##......##.', '..##....##..', '...######...', '............', '............'],
  };
  // The other three chevrons and the left arrow are the first ones turned over.
  function flipX(rows) { return rows.map(function (r) { return r.split('').reverse().join(''); }); }
  function transpose(rows) { return rows[0].split('').map(function (_, c) { return rows.map(function (r) { return r[c]; }).join(''); }); }
  ART['chevron-left'] = flipX(ART['chevron-right']);
  ART['chevron-down'] = transpose(ART['chevron-right']);
  ART['chevron-up'] = ART['chevron-down'].slice().reverse();
  ART['arrow-left'] = flipX(ART['arrow-right']);

  function pixels(rows) {
    var d = '';
    rows.forEach(function (row, y) {
      var x = 0;
      while (x < row.length) {
        if (row[x] !== '#') { x++; continue; }
        var s = x;
        while (x < row.length && row[x] === '#') x++;
        d += 'M' + s * 2 + ' ' + (y * 2) + 'h' + (x - s) * 2 + 'v2h-' + (x - s) * 2 + 'z';
      }
    });
    return '<path d="' + d + '" fill="currentColor" stroke="none" shape-rendering="crispEdges"/>';
  }
  var PIXEL = {};
  Object.keys(ART).forEach(function (n) { PIXEL[n] = pixels(ART[n]); });

  // ---- The packs --------------------------------------------------------------------------------------------------------------------------
  var PACKS = [
    { id: 'outline',  name: 'Outline',  note: 'Vex’s own thin line icons',                   glyphs: null },
    { id: 'bold',     name: 'Bold',     note: 'The same icons, drawn with a heavy line',      glyphs: null },
    { id: 'duotone',  name: 'Duotone',  note: 'A line with a soft tint inside every shape',   glyphs: null },
    { id: 'soft',     name: 'Soft',     note: 'Rounder corners and a calm, even line',        glyphs: null },
    { id: 'sharp',    name: 'Sharp',    note: 'Square ends, square corners, a technical feel', glyphs: null },
    { id: 'solid',    name: 'Solid',    note: 'Filled shapes you can read from across the room', glyphs: SOLID },
    { id: 'pixel',    name: 'Pixel',    note: 'Blocky icons drawn square by square',          glyphs: PIXEL },
  ];

  function get(id) { for (var i = 0; i < PACKS.length; i++) if (PACKS[i].id === id) return PACKS[i]; return null; }

  var state = { id: DEFAULT };
  function stored() {
    try { var v = localStorage.getItem(KEY); return get(v) ? v : DEFAULT; } catch (err) { console.error('[IconPacks] the saved icon pack could not be read:', err); return DEFAULT; }
  }

  function glyphFor(name, id) {
    var pack = get(id || state.id);
    return pack && pack.glyphs && pack.glyphs[name] ? pack.glyphs[name] : null;
  }

  // The hooks VexIcons.svg() calls.
  ICONS.glyph = function (name) { return glyphFor(name); };
  ICONS.decorate = function (name) { return CLOSED[name] ? ' data-fill="1"' : ''; };

  // The toolbar's own buttons were drawn straight into index.html, so a pack could not reach them. While a pack other than the default is on,
  // each one swaps its drawing for the VexIcons one of the same name; the original comes back with the default pack.
  var STATIC = {
    '#btn-back': 'chevron-left', '#btn-forward': 'chevron-right', '#btn-reload': 'refresh', '#btn-onboarding': 'sparkles',
    '#btn-incognito': 'incognito', '#btn-tor': 'onion', '#btn-notes-top': 'note', '#btn-downloads-top': 'download',
    '#btn-extensions': 'puzzle', '#btn-toggle-tabs-left': 'sidebar',
  };
  var originals = {};
  function paintStatic() {
    if (typeof document === 'undefined') return;
    Object.keys(STATIC).forEach(function (sel) {
      var btn = document.querySelector(sel);
      if (!btn) return;
      var svg = btn.querySelector(':scope > svg');
      if (state.id === DEFAULT) {
        if (originals[sel]) { var back = originals[sel]; delete originals[sel]; var cur = btn.querySelector(':scope > svg'); if (cur) cur.replaceWith(back); }
        return;
      }
      if (svg && !svg.hasAttribute('data-vex-icon')) {
        originals[sel] = svg;
        var holder = document.createElement('template');
        holder.innerHTML = ICONS.svg(STATIC[sel], { size: Number(svg.getAttribute('width')) || 16 });
        svg.replaceWith(holder.content.firstElementChild);
      } else if (svg && originals[sel]) {
        svg.innerHTML = ICONS.has(STATIC[sel]) ? (glyphFor(STATIC[sel]) || ICONS.icons[STATIC[sel]]) : svg.innerHTML;
        svg.toggleAttribute('data-fill', !!CLOSED[STATIC[sel]]);
      }
    });
  }

  // Redraw the icons already in the page for the pack in force.
  function refresh(root) {
    if (typeof document === 'undefined') return 0;
    var scope = root || document;
    var n = 0;
    scope.querySelectorAll('svg[data-vex-icon]').forEach(function (svg) {
      var name = svg.getAttribute('data-vex-icon');
      if (!ICONS.has(name)) return;
      svg.innerHTML = glyphFor(name) || ICONS.icons[name];
      if (CLOSED[name]) svg.setAttribute('data-fill', '1'); else svg.removeAttribute('data-fill');
      n++;
    });
    return n;
  }

  function apply(id) {
    state.id = id || stored();
    if (typeof document !== 'undefined') {
      var root = document.documentElement;
      if (state.id === DEFAULT) root.removeAttribute('data-icon-pack'); else root.setAttribute('data-icon-pack', state.id);
      paintStatic();
      refresh(document);
      document.dispatchEvent(new CustomEvent('vex:icon-pack-changed', { detail: { pack: state.id } }));
    }
    return state.id;
  }

  function set(id) {
    var pack = get(id);
    if (!pack) throw new Error('There is no icon pack called "' + id + '"');
    try {
      if (id === DEFAULT) localStorage.removeItem(KEY); else localStorage.setItem(KEY, id);
    } catch (err) { console.error('[IconPacks] could not save the icon pack:', err); throw err; }
    apply(id);
    return pack;
  }

  // Drawn at the right size in a card: markup of one icon in ANY pack, without touching the page.
  function preview(name, id, size) {
    var pack = get(id);
    if (!pack) throw new Error('There is no icon pack called "' + id + '"');
    var inner = (pack.glyphs && pack.glyphs[name]) || ICONS.icons[name];
    if (!inner) throw new Error('There is no icon called "' + name + '"');
    return '<svg class="vex-icon" data-vex-icon="' + name + '"' + (CLOSED[name] ? ' data-fill="1"' : '') + ' width="' + (size || 20) + '" height="' + (size || 20) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      ' style="flex:none;display:inline-block;vertical-align:middle">' + inner + '</svg>';
  }

  var api = { KEY: KEY, DEFAULT: DEFAULT, PACKS: PACKS, CLOSED: CLOSED, get: get, current: function () { return get(state.id); }, set: set, apply: apply, refresh: refresh, glyphFor: glyphFor, preview: preview };
  state.id = stored();
  if (typeof window !== 'undefined') window.VexIconPacks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexIconPacks: api };
  if (typeof document !== 'undefined') {
    // The page's own icons are drawn when their scripts run; the toolbar buttons exist once the body is parsed.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); }, { once: true });
    else apply();
  }
})();
