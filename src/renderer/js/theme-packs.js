// === Theme packs: a theme that is a design, a set of icons and colours, not only colours ===================================================
//
// Vex's themes were all palettes. A theme pack bundles four things that can be chosen one by one:
//   colours   a colour theme (js/theme-manager.js; the pack only names it, ThemeManager applies it)
//   design    the shape of the window: tabs, toolbar, panels and cards, density, plus a skin (corners, light, texture; js/skins.js)
//   icons     an icon pack (js/icon-packs.js)
//   fonts     optional: { ui, mono? } ids from js/fonts.js
//   wallpaper optional: { id } | null. The wallpaper store is a separate module: if window.VexWallpapers.apply exists it is called with the id.
//
// A pack never changes the look (Classic, Firefox, Chrome...). `look` only says which look the pack was drawn for; the person's own look
// choice, and the setup wizard's, stay as they are.
//
// Saved in localStorage 'vex.themePack' as { v, pack, design, prev }:
//   pack    the id of the pack last applied, or null once any part has been picked by hand ("Custom")
//   design  the design in force ('default' = as Vex ships)
//   prev    what the pack replaced, so Reset can give it back: { skin: {pattern,shape,glow,strength}, fonts: {ui,mono} }
// The colours and the icons are saved by ThemeManager and VexIconPacks in their own keys.
// The design's attributes sit on <html> and js/early-look.js carries them over to the next start, so the first frame already wears them.
(function () {
  'use strict';
  var KEY = 'vex.themePack';

  // ---- Designs -------------------------------------------------------------------------------------------------------------------------------
  // tabs / bar / surface / density: the four attributes of css/theme-packs.css ('default' = not set). skin: kinds and ids of js/skins.js.
  var DESIGNS = [
    { id: 'default',   name: 'Vex',        note: 'The window as Vex ships it', tabs: 'default', bar: 'default', surface: 'default', density: 'default', skin: null },
    { id: 'capsule',   name: 'Capsule',    note: 'Pill tabs, round corners, panels that lift', tabs: 'pill', bar: 'default', surface: 'lift', density: 'default', skin: { shape: 'round', glow: 'lift', pattern: 'none' } },
    { id: 'slab',      name: 'Slab',       note: 'Square blocks, thick outlines, hard shadows', tabs: 'block', bar: 'line', surface: 'paper', density: 'default', skin: { shape: 'heavy', glow: 'flat', pattern: 'none' } },
    { id: 'frosted',   name: 'Frosted',    note: 'See-through panels over a floating toolbar', tabs: 'soft', bar: 'float', surface: 'glass', density: 'default', skin: { shape: 'soft', glow: 'halo', pattern: 'none' } },
    { id: 'folio',     name: 'Folio',      note: 'Folder tabs joined to a flat toolbar', tabs: 'folder', bar: 'flat', surface: 'sheet', density: 'default', skin: { shape: 'soft', glow: 'normal', pattern: 'none' } },
    { id: 'broadsheet', name: 'Broadsheet', note: 'Underlined tabs, hairlines, no shadows', tabs: 'underline', bar: 'flat', surface: 'flat', density: 'default', skin: { shape: 'sharp', glow: 'flat', pattern: 'none' } },
    { id: 'workbench', name: 'Workbench',  note: 'Everything a little smaller, more on screen', tabs: 'soft', bar: 'flat', surface: 'flat', density: 'compact', skin: { shape: 'tight', glow: 'flat', pattern: 'none' } },
    { id: 'islands',   name: 'Islands',    note: 'A toolbar that floats, panels that sit above the page', tabs: 'soft', bar: 'float', surface: 'lift', density: 'default', skin: { shape: 'round', glow: 'lift', pattern: 'none' } },
    { id: 'mainframe', name: 'Mainframe',  note: 'Outlined panels over scan lines', tabs: 'block', bar: 'line', surface: 'outline', density: 'default', skin: { shape: 'sharp', glow: 'flat', pattern: 'lines', strength: 'soft' } },
    { id: 'daybreak',  name: 'Daybreak',   note: 'Soft cards on a grain of paper', tabs: 'folder', bar: 'flat', surface: 'sheet', density: 'default', skin: { shape: 'soft', glow: 'normal', pattern: 'noise', strength: 'soft' } },
    { id: 'clear',     name: 'Airy',       note: 'Big targets and space between them', tabs: 'soft', bar: 'default', surface: 'flat', density: 'roomy', skin: { shape: 'round', glow: 'normal', pattern: 'none' } },
  ];

  // ---- Packs ---------------------------------------------------------------------------------------------------------------------------------
  // `look`: the look the pack was drawn for (an id of js/gui-style.js). The design also works in the other looks that put the tabs on top; in
  // Classic with the tab list at the side, the tab shapes show on the side tabs' corners only.
  var PACKS = [
    { id: 'arcade',     name: 'Arcade',      note: 'Hard shadows, blocky icons, neon on night', look: 'neobrutal', colours: 'vaporwave', design: 'slab',      icons: 'pixel',   fonts: { ui: 'cascadia' }, wallpaper: null },
    { id: 'mainframe',  name: 'Mainframe',   note: 'Green phosphor, scan lines, square everything', look: 'terminal', colours: 'terminal', design: 'mainframe', icons: 'sharp',   fonts: { ui: 'consolas', mono: 'consolas' }, wallpaper: null },
    { id: 'frost',      name: 'Frost',       note: 'Glass panels, a floating toolbar, tinted icons', look: 'glass',    colours: 'mica-dark', design: 'frosted',   icons: 'duotone', fonts: null, wallpaper: null },
    { id: 'capsule',    name: 'Capsule',     note: 'Pills and circles in warm rose', look: 'firefox',  colours: 'sakura',    design: 'capsule',   icons: 'soft',    fonts: { ui: 'candara' }, wallpaper: null },
    { id: 'broadsheet', name: 'Broadsheet',  note: 'A newspaper: serif type, hairlines, ink on cream', look: 'classic', colours: 'oxford',    design: 'broadsheet', icons: 'outline', fonts: { ui: 'georgia' }, wallpaper: null },
    { id: 'workbench',  name: 'Workbench',   note: 'Dense and quick, for people who live in the browser', look: 'chrome',  colours: 'slate',     design: 'workbench', icons: 'bold',    fonts: { ui: 'segoe' }, wallpaper: null },
    { id: 'islands',    name: 'Islands',     note: 'Floating toolbar, deep blue, filled icons', look: 'fluent',  colours: 'midnight',  design: 'islands',   icons: 'solid',   fonts: null, wallpaper: null },
    { id: 'folio',      name: 'Folio',       note: 'Folder tabs and a leather-brown desk', look: 'chrome',  colours: 'mocha',     design: 'folio',     icons: 'sharp',   fonts: { ui: 'garamond' }, wallpaper: null },
    { id: 'daybreak',   name: 'Daybreak',    note: 'Light, grainy, friendly: paper cards and solid icons', look: 'firefox', colours: 'firefox-light', design: 'daybreak', icons: 'solid', fonts: null, wallpaper: null },
    { id: 'clearbold',  name: 'Clear & Bold', note: 'High contrast, big targets, heavy icons', look: 'classic', colours: 'contrast-dark', design: 'clear', icons: 'bold',    fonts: { ui: 'verdana' }, wallpaper: null },
  ];

  var AXES = { tabs: 'data-pk-tabs', bar: 'data-pk-bar', surface: 'data-pk-surface', density: 'data-pk-density' };
  var ATTRS = Object.keys(AXES).map(function (k) { return AXES[k]; });

  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function design(id) { return byId(DESIGNS, id); }
  function pack(id) { return byId(PACKS, id); }

  function read() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (err) { console.error('[ThemePacks] the saved pack could not be read:', err); return { v: 1, pack: null, design: 'default', prev: null }; }
    if (!raw) return { v: 1, pack: null, design: 'default', prev: null };
    var s;
    try { s = JSON.parse(raw); } catch (err) { console.error('[ThemePacks] the saved pack is not valid JSON, ignoring it:', err); return { v: 1, pack: null, design: 'default', prev: null }; }
    if (!s || s.v !== 1) return { v: 1, pack: null, design: 'default', prev: null };
    return { v: 1, pack: pack(s.pack) ? s.pack : null, design: design(s.design) ? s.design : 'default', prev: s.prev && typeof s.prev === 'object' ? s.prev : null };
  }
  function write(s) {
    try {
      if (s.pack === null && s.design === 'default' && !s.prev) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(s));
    } catch (err) { console.error('[ThemePacks] could not save the pack:', err); throw err; }
  }

  // Put a design's four attributes on <html>. Pure DOM, no storage: also used at start-up.
  function paintAttrs(d) {
    var root = document.documentElement;
    Object.keys(AXES).forEach(function (axis) {
      var v = d[axis];
      if (!v || v === 'default') root.removeAttribute(AXES[axis]); else root.setAttribute(AXES[axis], v);
    });
  }

  function skins() { return typeof window !== 'undefined' ? window.VexSkins : undefined; }
  function fontsApi() { return typeof window !== 'undefined' ? window.VexFonts : undefined; }

  function captureSkin(s) {
    var S = skins();
    if (!S || (s.prev && s.prev.skin)) return;
    s.prev = s.prev || {};
    s.prev.skin = { pattern: S.pattern().id, shape: S.shape().id, glow: S.glow().id, strength: S.strength().id };
  }

  function applySkin(d, s) {
    var S = skins();
    if (!S) throw new Error('Themes need js/skins.js loaded');
    if (!d.skin) {
      if (s.prev && s.prev.skin) { var p = s.prev.skin; Object.keys(p).forEach(function (k) { S.set(k, p[k]); }); s.prev.skin = undefined; delete s.prev.skin; }
      return;
    }
    captureSkin(s);
    var want = { pattern: d.skin.pattern || 'none', shape: d.skin.shape || 'soft', glow: d.skin.glow || 'normal', strength: d.skin.strength || (s.prev && s.prev.skin && s.prev.skin.strength) || 'soft' };
    Object.keys(want).forEach(function (k) { S.set(k, want[k]); });
  }

  function applyFonts(p, s) {
    var F = fontsApi();
    if (!F) throw new Error('Themes need js/fonts.js loaded');
    if (!p || !p.fonts) {
      if (s.prev && s.prev.fonts) { F.set(s.prev.fonts.ui); F.setMono(s.prev.fonts.mono); delete s.prev.fonts; }
      return;
    }
    if (!(s.prev && s.prev.fonts)) { s.prev = s.prev || {}; s.prev.fonts = { ui: F.current().id, mono: F.currentMono().id }; }
    F.set(p.fonts.ui);
    F.setMono(p.fonts.mono || (s.prev.fonts && s.prev.fonts.mono) || 'jetbrains');
  }

  function cleanPrev(s) { if (s.prev && !s.prev.skin && !s.prev.fonts) s.prev = null; }

  function emit(detail) {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:theme-pack-changed', { detail: detail }));
  }

  // ---- The parts, one by one ----------------------------------------------------------------------------------------------------------------
  function setDesign(id) {
    var d = design(id);
    if (!d) throw new Error('There is no design called "' + id + '"');
    var s = read();
    paintAttrs(d);
    applySkin(d, s);
    s.design = d.id;
    s.pack = null;
    cleanPrev(s);
    write(s);
    emit({ part: 'design', design: d.id });
    return d;
  }

  function setIcons(id) {
    if (!window.VexIconPacks) throw new Error('Themes need js/icon-packs.js loaded');
    var r = window.VexIconPacks.set(id);
    var s = read(); s.pack = null; write(s);
    emit({ part: 'icons', icons: id });
    return r;
  }

  function setColours(id) {
    if (typeof ThemeManager === 'undefined') throw new Error('Themes need js/theme-manager.js loaded');
    if (ThemeManager.availableThemes.indexOf(id) < 0) throw new Error('There is no colour theme called "' + id + '"');
    ThemeManager.applyTheme(id);
    var s = read(); s.pack = null; write(s);
    emit({ part: 'colours', colours: id });
  }

  // ---- A whole pack -------------------------------------------------------------------------------------------------------------------------
  function applyPack(id) {
    var p = pack(id);
    if (!p) throw new Error('There is no theme pack called "' + id + '"');
    var d = design(p.design);
    if (!d) throw new Error('The pack "' + id + '" names a design that does not exist: ' + p.design);
    if (!window.VexIconPacks || !window.VexIconPacks.get(p.icons)) throw new Error('The pack "' + id + '" names an icon pack that does not exist: ' + p.icons);
    var s = read();
    paintAttrs(d);
    applySkin(d, s);
    applyFonts(p, s);
    window.VexIconPacks.set(p.icons);
    if (typeof ThemeManager !== 'undefined') ThemeManager.applyTheme(p.colours);
    if (p.wallpaper && p.wallpaper.id) {
      var W = window.VexWallpapers;
      if (W && typeof W.apply === 'function') W.apply(p.wallpaper.id);
      else console.warn('[ThemePacks] the pack "' + id + '" names the wallpaper "' + p.wallpaper.id + '" but the wallpaper store is not loaded');
    }
    s.pack = p.id;
    s.design = d.id;
    cleanPrev(s);
    write(s);
    emit({ part: 'pack', pack: p.id });
    return p;
  }

  // Back to the window as Vex ships it: no design, the default icons, and the skin and fonts the person had before a pack replaced them.
  // The colour theme and the look are left alone (they are the person's own choices).
  function reset() {
    var s = read();
    paintAttrs(design('default'));
    applySkin(design('default'), s);
    applyFonts(null, s);
    if (window.VexIconPacks) window.VexIconPacks.set(window.VexIconPacks.DEFAULT);
    s.pack = null; s.design = 'default'; cleanPrev(s);
    write(s);
    emit({ part: 'reset' });
  }

  // At start-up: the saved design's attributes (the skin and fonts persist in their own keys).
  // A private window has storage of its own (nothing saved), so it wears the design of the window it was opened from, which js/early-look.js
  // already put on <html> from the address: painting the empty default over it would strip it.
  function apply() {
    var s = read();
    var given = typeof window !== 'undefined' && window.VexEarlyLook ? window.VexEarlyLook.carried() : null;
    if (given && given.html && given.html.attrs && !localStorage.getItem(KEY)) {
      var a = given.html.attrs;
      paintAttrs({ tabs: a['data-pk-tabs'], bar: a['data-pk-bar'], surface: a['data-pk-surface'], density: a['data-pk-density'] });
      return s;
    }
    paintAttrs(design(s.design));
    return s;
  }

  function current() {
    var s = read();
    return { pack: s.pack, design: s.design, icons: window.VexIconPacks ? window.VexIconPacks.current().id : 'outline', colours: typeof ThemeManager !== 'undefined' ? ThemeManager.getCurrentTheme() : null };
  }

  var api = { KEY: KEY, AXES: AXES, ATTRS: ATTRS, DESIGNS: DESIGNS, PACKS: PACKS, design: design, pack: pack, setDesign: setDesign, setIcons: setIcons, setColours: setColours,
    applyPack: applyPack, reset: reset, apply: apply, current: current, paintAttrs: paintAttrs };
  if (typeof window !== 'undefined') window.VexThemePacks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexThemePacks: api };
  if (typeof document !== 'undefined') {
    // Attributes only; the saved skin and font have their own start-up code.
    try { apply(); } catch (err) { console.error('[ThemePacks] could not put the saved design back:', err); }
  }
})();
