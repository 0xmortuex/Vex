// === Match Vex to a wallpaper, area by area ====================================
//
// Every wallpaper has a short list of switches: New Tab, Tabs, Toolbar and search bar, Side bar
// and panels, Accent colour, Everything else. You turn on the areas you want in the wallpaper's
// colours (each switch works at once), or press "Match everything" for all of them. An area that
// is off keeps the colours of the theme you wore. Nothing changes by itself: choosing or applying
// a wallpaper never touches the colours, only these switches and the button.
//
// How it is built:
//   * the colours are an ordinary theme of your own (js/theme-custom.js), kept as "Synced:
//     <wallpaper>" in the theme list; it holds the colours of the window as a whole (the wallpaper's
//     when "Everything else" is on, else your own theme's, with the wallpaper's accent when
//     "Accent colour" is on);
//   * Tabs, Toolbar and Side bar are painted on top of that, each as its own set of tokens on its
//     own part of the window (a <style> of ours), so the text of an area is always computed
//     against the background that area really has;
//   * the New Tab page gets its colours from ThemeManager / tabs.js through newTabOverride();
//   * before the first switch Vex remembers the theme you wore (its nine colours and, in a
//     browser look, whether the window used the look's own colours); Undo puts exactly that back
//     and removes the synced theme and our <style>.
// A browser look wearing its own colours is switched to the theme's colours while an area is
// matched (the same as the old single "Sync" button): only then are the contrast numbers known.
//
// Where a wallpaper's palette comes from:
//   * a wallpaper drawn by Vex: its own five colours, run through the same palette maker
//     as "a theme from a picture" (ThemeFromImage.palette) with its colours as the picture's
//     groups. No picture is read, so it is the same palette every time and can be tested;
//   * a photo or a picture of your own: the picture itself is read and summarised
//     (ThemeFromImage.sample), the same as the theme editor does.
// Every colour goes through CustomThemes.fixContrast; a mix of your colours and the wallpaper's is
// made per area from complete, checked sets (compose()), so no area mixes the two inside itself.
//
//   VexWallpaperSync.AREAS                           -> [{ id, label, hint }]
//   VexWallpaperSync.paletteForGenerated(d, light?)  -> { colors, light, unresolved }   (sync)
//   VexWallpaperSync.paletteFor(id, light?)          -> the same, for any wallpaper      (async)
//   VexWallpaperSync.compose(own, wallpaper, areas)  -> { root, areas: {tabs,..}, newtab }  (pure)
//   VexWallpaperSync.apply(id, areas?)               -> the saved theme record (areas: all by default)
//   VexWallpaperSync.setAreas(id, areas)             -> switches on/off at once; none left = undo
//   VexWallpaperSync.areasFor(id)                    -> the areas on for this wallpaper now
//   VexWallpaperSync.undo()                          -> true when something was undone
//   VexWallpaperSync.state()                         -> { ... } or null (what Undo would restore)

(function (root) {
  'use strict';

  const KEY = 'vex.wallpaper.sync';
  const PREFS_KEY = 'vex.wallpaper.sync.areas';   // { wallpaperId: [area, ...] }, what each wallpaper last had on
  const THEME_ID = 'user-wallpapersync';
  const STYLE_ID = 'vex-wallpaper-areas';
  // How much each of a wallpaper's five colours counts as one of the "groups" of a picture.
  const WEIGHTS = [0.4, 0.25, 0.15, 0.12, 0.08];

  // The parts of the window that can wear the wallpaper on their own. `selector` is where an area
  // lives in the real window; newtab, accent and rest have none (the page, the accent in every
  // area, and the theme itself).
  const AREAS = [
    { id: 'newtab', label: 'New Tab page', hint: 'The page you see in a new tab' },
    { id: 'tabs', label: 'Tabs', hint: 'The tab strip and the tab list', selector: '#top-tab-bar, #tabs-sidebar' },
    { id: 'toolbar', label: 'Toolbar and search bar', hint: 'The address and search bar and the buttons around it', selector: '#top-bar, #gui-shortcuts-bar' },
    { id: 'sidebar', label: 'Side bar and panels', hint: 'The icon rail and the panels, Settings included', selector: '#icon-sidebar, #panels-container, #ai-panel' },
    { id: 'accent', label: 'Accent colour', hint: 'Buttons, links and switches' },
    { id: 'rest', label: 'Everything else', hint: 'The window behind, menus and dialogs' },
  ];
  const AREA_IDS = AREAS.map(a => a.id);
  const SCOPED = AREAS.filter(a => a.selector);
  // Browser looks that bring their own colours-from-the-theme block (css/gui-browser.css, section 6):
  // the generic one is not repeated for them, so their own shapes of it keep working.
  const OWN_THEME_BLOCK = ['safari', 'xp', 'win98', 'fluent', 'fluent-dark', 'glossy', 'neobrutal', 'terminal'];

  const ct = () => {
    if (!root.CustomThemes) throw new Error('CustomThemes (js/theme-custom.js) is not loaded');
    return root.CustomThemes;
  };
  const tfi = () => {
    if (!root.ThemeFromImage) throw new Error('ThemeFromImage (js/theme-from-image.js) is not loaded');
    return root.ThemeFromImage;
  };
  const mgr = () => (typeof ThemeManager !== 'undefined' ? ThemeManager : root.ThemeManager);
  const studio = () => (typeof ThemeStudio !== 'undefined' ? ThemeStudio : root.ThemeStudio);
  const store = () => {
    if (!root.VexWallpapers) throw new Error('The wallpaper store is not loaded');
    return root.VexWallpapers;
  };

  // The five colours of a wallpaper -> the "groups" a palette is made from. The group that
  // sets the hue of the background is the more colourful of the two base tones (a pastel
  // wallpaper's base is almost white, its second tone carries the tint).
  function clustersOf(colors) {
    const C = ct();
    const groups = colors.map((hex, i) => {
      const [L, Ch, h] = C.toOklch(hex);
      return { L, a: Ch * Math.cos(h * Math.PI / 180), b: Ch * Math.sin(h * Math.PI / 180), C: Ch, h, weight: WEIGHTS[i] || 0.05, hex };
    });
    if (groups.length > 1 && groups[1].C > groups[0].C) [groups[0], groups[1]] = [groups[1], groups[0]];
    return groups;
  }

  function paletteForGenerated(d, light) {
    if (!d || !Array.isArray(d.colors) || !d.colors.length) throw new Error('That wallpaper has no colours to sync to');
    const side = light === undefined ? !!d.light : !!light;
    const p = tfi().palette({ clusters: clustersOf(d.colors) }, { light: side, style: 'calm' });
    return { colors: p.colors, light: side, unresolved: p.unresolved };
  }

  // Any wallpaper: drawn by Vex -> from its colours; photo or your own picture -> from the picture.
  async function paletteFor(id, light) {
    const V = store();
    const d = V.get(id);
    if (!d) throw new Error('There is no wallpaper called "' + id + '"');
    if (d.source === 'generated') return paletteForGenerated(d, light);
    const file = await V.rasterFile(id);
    const T = tfi();
    const summary = await T.sample(file);
    const side = light === undefined ? T.isLightPicture(summary) : !!light;
    const p = T.palette(summary, { light: side, style: 'calm' });
    return { colors: p.colors, light: side, unresolved: p.unresolved };
  }

  // --- mixing your colours with the wallpaper's, area by area ---------------------------------

  function cleanAreas(list) {
    if (!Array.isArray(list)) throw new Error('The areas must be a list');
    for (const a of list) if (!AREA_IDS.includes(a)) throw new Error('Not an area of the window: ' + a);
    return AREA_IDS.filter(a => list.includes(a));
  }

  // `colors` with its accent replaced by `primary` and made readable on this set's own backgrounds
  // (and the text on the accent too). Only the accent moves; every other colour is kept as given.
  function withAccent(colors, primary) {
    const C = ct();
    const c = C.complete({ ...colors, primary });
    const fixed = C.fixContrast(c);
    if (fixed.unresolved.length) throw new Error('The colours cannot be made readable here: ' + fixed.unresolved.map(x => x.label).join(', '));
    // The New Tab's glow is made from the accent, so a new accent can move the text's contrast
    // too: the fixer may nudge the text colours' lightness, never the background, surface or borders.
    return { ...c, primary: fixed.colors.primary, text: fixed.colors.text, muted: fixed.colors.muted, success: fixed.colors.success, warning: fixed.colors.warning, danger: fixed.colors.danger };
  }

  // The colours each part of the window wears, as complete sets of nine:
  //   root    the theme itself (window behind, menus, dialogs): the wallpaper's when "rest" is on,
  //           else yours; the accent is the wallpaper's when "accent" is on, else yours
  //   areas   tabs / toolbar / sidebar: the wallpaper's own set, but with YOUR accent when
  //           "accent" is off (so an area never has a half-and-half background and text)
  //   newtab  the New Tab page, same rule as an area; yours when "newtab" is off
  // `own` and `wallpaper` are colour sets; `areas` a list of area ids. Pure.
  function compose(own, wallpaper, areas) {
    const C = ct();
    const on = new Set(cleanAreas(areas));
    const mine = C.complete(own), wp = C.complete(wallpaper);
    const accent = on.has('accent') ? wp.primary : mine.primary;
    const wearing = (base) => (accent === base.primary ? base : withAccent(base, accent));
    const out = { root: wearing(on.has('rest') ? wp : mine), areas: {}, newtab: on.has('newtab') ? wearing(wp) : mine };
    for (const a of SCOPED) if (on.has(a.id)) out.areas[a.id] = wearing(wp);
    return out;
  }

  // --- what is saved ---------------------------------------------------------------------------

  function state() {
    let raw;
    try { raw = JSON.parse(root.localStorage.getItem(KEY) || 'null'); }
    catch (err) { throw new Error('The saved sync state is damaged: ' + err.message, { cause: err }); }
    if (raw == null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw) || typeof raw.prevTheme !== 'string') throw new Error('The saved sync state is not what Vex wrote');
    return raw;
  }
  function saveState(s) { root.localStorage.setItem(KEY, JSON.stringify(s)); }

  function prefs() {
    let raw;
    try { raw = JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}'); }
    catch (err) { throw new Error('The saved wallpaper areas are damaged: ' + err.message, { cause: err }); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The saved wallpaper areas are not what Vex wrote');
    return raw;
  }
  function savePref(id, areas) {
    const p = prefs();
    if (areas.length) p[id] = areas; else delete p[id];
    if (Object.keys(p).length) root.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); else root.localStorage.removeItem(PREFS_KEY);
  }

  // The areas on for this wallpaper now: what is applied when it is the synced one, else what it
  // last had (nothing, for a wallpaper never matched).
  function areasFor(id) {
    const s = state();
    if (s && s.wallpaper === id) return cleanAreas(s.areas || AREA_IDS);
    const p = prefs()[id];
    return p ? cleanAreas(p) : [];
  }

  function guiLook() {
    const G = root.VexGuiStyle;
    return G && typeof G.isBrowserLook === 'function' && G.isBrowserLook() ? G : null;
  }

  // --- painting the areas ----------------------------------------------------------------------

  // The same mapping css/gui-browser.css (section 6) makes on <body> in "colours from the theme"
  // mode, repeated on an area so a browser look's own shapes read the area's tokens.
  const BROWSER_BLOCK = [
    '--b-frame: var(--vex-bg-deep, var(--vex-bg-base))', '--b-frame-solid: var(--vex-bg-deep, var(--vex-bg-base))',
    '--b-strip-fg: var(--vex-text-secondary)', '--b-strip-hover: color-mix(in srgb, var(--vex-text-primary) 12%, transparent)',
    '--b-tab: transparent', '--b-tab-hover: color-mix(in srgb, var(--vex-text-primary) 9%, transparent)',
    '--b-tab-active: var(--vex-bg-elevated)', '--b-tab-text: var(--vex-text-secondary)', '--b-tab-sep: var(--vex-border-medium)',
    '--b-tab-border: transparent', '--b-tab-active-border: transparent',
    '--b-toolbar: var(--vex-bg-elevated)', '--b-toolbar-border: var(--vex-border-subtle)',
    '--b-btn-hover: color-mix(in srgb, var(--vex-text-primary) 12%, transparent)', '--b-btn-hover-border: transparent',
    '--b-icon: var(--vex-text-secondary)', '--b-icon-disabled: var(--vex-text-muted)',
    '--b-url-bg: var(--vex-bg-base)', '--b-url-bg-focus: var(--vex-bg-base)',
    '--b-url-border: transparent', '--b-url-focus-border: var(--vex-accent)',
    '--b-accent: var(--vex-accent)', '--b-accent-ring: var(--vex-accent)',
    '--b-text: var(--vex-text-primary)', '--b-text-dim: var(--vex-text-secondary)',
    '--b-border: var(--vex-border-medium)', '--b-menu: var(--vex-bg-elevated)', '--b-page: var(--vex-bg-base)',
  ].map(x => '  ' + x + ';').join('\n');

  // The CSS of one area: every token of its colours (written only from checked values, like a theme's).
  function areaCss(selector, colors) {
    const C = ct();
    const chrome = { ...C.derive(colors).chrome };
    if (!chrome['--vex-hover-fill']) {
      chrome['--vex-hover-fill'] = 'rgba(255, 255, 255, 0.06)';
      chrome['--vex-shadow-color'] = 'rgba(0, 0, 0, 0.5)';
    }
    const body = Object.entries(chrome).map(([k, v]) => {
      if (!/^--[a-z0-9-]+$/.test(k)) throw new Error('Refusing a theme token: ' + k);
      return '  ' + k + ': ' + C._cssValue(v) + ';';
    });
    body.push('  --vex-accent-fg: color-mix(in oklab, var(--vex-accent) 65%, var(--vex-text-primary));');
    const sel = selector.split(',').map(x => 'html body ' + x.trim());
    const own = OWN_THEME_BLOCK.map(x => ':not([data-gui-style="' + x + '"])').join('');
    const browser = selector.split(',').map(x => 'html body[data-gui-family="browser"][data-gui-colors="theme"]' + own + ' ' + x.trim());
    return sel.join(',\n') + ' {\n' + body.join('\n') + '\n}\n' + browser.join(',\n') + ' {\n' + BROWSER_BLOCK + '\n}';
  }

  function composed(s) {
    return compose(s.own, s.palette, s.areas);
  }

  // Write (or remove) our <style> from the saved state. Only while the synced theme is the one worn.
  function render() {
    const doc = root.document;
    if (!doc) return;
    let style = doc.getElementById(STYLE_ID);
    const s = state();
    const M = mgr();
    const wearing = s && s.own && s.palette && M && M.getCurrentTheme() === THEME_ID;
    if (!wearing) { if (style) style.remove(); return; }
    const c = composed(s);
    const css = SCOPED.filter(a => c.areas[a.id]).map(a => areaCss(a.selector, c.areas[a.id])).join('\n');
    if (!css) { if (style) style.remove(); return; }
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }
    style.textContent = css;
  }

  // What a New Tab should wear while the synced theme is worn: { id, colors }, or null when
  // nothing is synced. `theme` is the theme the window wears; any other means no override.
  // New Tab on -> the wallpaper's colours as the synced theme; off -> the theme you wore before.
  function newTabOverride(theme) {
    if (theme !== THEME_ID) return null;
    const s = state();
    if (!s || !s.own || !s.palette) return null;
    if (s.areas.includes('newtab')) return { id: THEME_ID, colors: composed(s).newtab };
    return { id: s.prevTheme, colors: ownColorsOf(s) };
  }
  // The colours of the theme worn before: for a theme of your own the New Tab carries them as ?tc=.
  function ownColorsOf(s) {
    const S = studio();
    return S && S.record && S.record(s.prevTheme) ? s.own : null;
  }

  function repaintNewTabs() {
    const M = mgr();
    if (M && typeof M.paintStartPages === 'function') M.paintStartPages(M.getCurrentTheme());
  }

  async function apply(id, areas) {
    const C = ct(), M = mgr(), S = studio();
    if (!M || !S) throw new Error('Themes are not loaded');
    if (S.isEditing && S.isEditing()) throw new Error('Finish or cancel the theme editor first');
    const set = cleanAreas(areas === undefined ? AREA_IDS : areas);
    if (!set.length) throw new Error('Turn on at least one area, or use Undo');
    const d = store().get(id);
    if (!d) throw new Error('There is no wallpaper called "' + id + '"');
    const pal = await paletteFor(id);
    if (pal.unresolved.length) throw new Error('The colours for "' + d.title + '" cannot all be made readable: ' + pal.unresolved.map(x => x.label).join(', '));

    // What Undo restores: taken once, at the first switch (a later one keeps the first's), unless
    // another theme was picked since: that pick is what is kept then.
    const had = state();
    const G = guiLook();
    const cur = M.getCurrentTheme();
    const reuse = had && cur === THEME_ID;
    const keep = reuse ? had : { prevTheme: cur, prevGuiColors: G ? G.getColors() : null };
    const own = reuse && had.own ? had.own : C.complete(S.colorsFromTheme(cur === THEME_ID ? keep.prevTheme : cur));
    const mix = compose(own, pal.colors, set);

    const name = ('Synced: ' + d.title).slice(0, C.NAME_MAX).trim();
    const rec = C.validateRecord({ id: THEME_ID, name, colors: C.complete(mix.root), updated: Date.now() });
    const list = S.records().filter(r => r.id !== THEME_ID);
    list.push(rec);
    C.saveList(list);
    saveState({ prevTheme: keep.prevTheme, prevGuiColors: keep.prevGuiColors, wallpaper: d.id, title: d.title, at: Date.now(), areas: set, own, palette: C.complete(pal.colors) });
    savePref(d.id, set);
    S._changed();
    // In a browser look the window only wears a theme's colours when the look is set to them.
    if (G && G.getColors() === 'look') G.setColors('theme');
    M.applyTheme(THEME_ID);
    render();
    repaintNewTabs();
    return rec;
  }

  // Switch areas on and off at once for a wallpaper. Nothing left on = Undo (when that wallpaper
  // is the one applied); a wallpaper that is not applied only remembers the list.
  async function setAreas(id, areas) {
    const set = cleanAreas(areas);
    if (set.length) return apply(id, set);
    const s = state();
    if (s && s.wallpaper === id) { await undo(); return null; }
    savePref(id, []);
    return null;
  }

  // Put back the theme worn before the first switch and take the synced theme out of the list.
  // If another theme has been picked since, that pick stays and only the synced theme goes.
  async function undo() {
    const C = ct(), M = mgr(), S = studio();
    if (!M || !S) throw new Error('Themes are not loaded');
    const s = state();
    if (!s) return false;
    const wearing = M.getCurrentTheme() === THEME_ID;
    if (wearing) {
      const back = M.availableThemes.includes(s.prevTheme) ? s.prevTheme : M.DEFAULT_THEME;
      M.applyTheme(back, { auto: true });
      const G = guiLook();
      if (G && s.prevGuiColors === 'look') G.setColors('look');
    }
    C.saveList(S.records().filter(r => r.id !== THEME_ID));
    root.localStorage.removeItem(KEY);
    if (s.wallpaper) savePref(s.wallpaper, []);
    const style = root.document && root.document.getElementById(STYLE_ID);
    if (style) style.remove();
    S._changed();
    return true;
  }

  const api = { KEY, PREFS_KEY, THEME_ID, STYLE_ID, AREAS, AREA_IDS, paletteForGenerated, paletteFor, compose, areaCss, apply, setAreas, areasFor, undo, state, canUndo: () => !!state(), clustersOf, render, newTabOverride };
  root.VexWallpaperSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexWallpaperSync: api };

  // The areas follow the theme worn: gone when another theme is picked, back at start-up and when
  // the synced theme is worn again. Only the window; this module never picks a theme.
  if (root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('theme-changed', () => {
      try { render(); } catch (err) { root.console.error('[wallpaper-sync]', err); }
    });
    root.addEventListener('vex:gui-colors', () => { try { render(); } catch (err) { root.console.error('[wallpaper-sync]', err); } });
    // Loaded late: the New Tabs already open were coloured before this file existed.
    try {
      const s = state();
      if (s && s.own) { render(); repaintNewTabs(); }
    } catch (err) { root.console.error('[wallpaper-sync]', err); }
  }
})(typeof window !== 'undefined' ? window : globalThis);
