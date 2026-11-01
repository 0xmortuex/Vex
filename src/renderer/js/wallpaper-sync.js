// === Sync Vex to a wallpaper ===================================================
//
// One click on "Sync Vex to this wallpaper" and the whole window (tabs, toolbar, search
// bar, panels, side bar, New Tab) wears colours made for that wallpaper. Nothing changes
// by itself: choosing or applying a wallpaper never touches the colours, only this button.
//
// The colours are an ordinary theme of your own (js/theme-custom.js), kept as the theme
// "Synced: <wallpaper>" in the theme list; a second sync replaces it. Before the first
// sync Vex remembers the theme you wore (and, in a browser look, whether the window used
// the look's own colours), and "Undo sync" puts exactly that back and removes the theme.
//
// Where the palette comes from:
//   * a wallpaper drawn by Vex: its own five colours, run through the same palette maker
//     as "a theme from a picture" (ThemeFromImage.palette) with its colours as the picture's
//     groups. No picture is read, so it is the same palette every time and can be tested;
//   * a photo or a picture of your own: the picture itself is read and summarised
//     (ThemeFromImage.sample), the same as the theme editor does.
// Either way every colour goes through CustomThemes.fixContrast, so all text reads at 4.5:1.
//
//   VexWallpaperSync.paletteForGenerated(d, light?)  -> { colors, light, unresolved }   (sync)
//   VexWallpaperSync.paletteFor(id, light?)          -> the same, for any wallpaper      (async)
//   VexWallpaperSync.apply(id)                       -> the saved theme record
//   VexWallpaperSync.undo()                          -> true when something was undone
//   VexWallpaperSync.state()                         -> { ... } or null (what Undo would restore)

(function (root) {
  'use strict';

  const KEY = 'vex.wallpaper.sync';
  const THEME_ID = 'user-wallpapersync';
  // How much each of a wallpaper's five colours counts as one of the "groups" of a picture.
  const WEIGHTS = [0.4, 0.25, 0.15, 0.12, 0.08];

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

  function state() {
    let raw;
    try { raw = JSON.parse(root.localStorage.getItem(KEY) || 'null'); }
    catch (err) { throw new Error('The saved sync state is damaged: ' + err.message, { cause: err }); }
    if (raw == null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw) || typeof raw.prevTheme !== 'string') throw new Error('The saved sync state is not what Vex wrote');
    return raw;
  }
  function saveState(s) { root.localStorage.setItem(KEY, JSON.stringify(s)); }

  function guiLook() {
    const G = root.VexGuiStyle;
    return G && typeof G.isBrowserLook === 'function' && G.isBrowserLook() ? G : null;
  }

  async function apply(id) {
    const C = ct(), M = mgr(), S = studio();
    if (!M || !S) throw new Error('Themes are not loaded');
    if (S.isEditing && S.isEditing()) throw new Error('Finish or cancel the theme editor first');
    const d = store().get(id);
    if (!d) throw new Error('There is no wallpaper called "' + id + '"');
    const pal = await paletteFor(id);
    if (pal.unresolved.length) throw new Error('The colours for "' + d.title + '" cannot all be made readable: ' + pal.unresolved.map(x => x.label).join(', '));

    // What Undo restores: taken once, at the first sync (a second sync keeps the first's).
    const had = state();
    const G = guiLook();
    const keep = had || { prevTheme: M.getCurrentTheme(), prevGuiColors: G ? G.getColors() : null };
    const name = ('Synced: ' + d.title).slice(0, C.NAME_MAX).trim();
    const rec = C.validateRecord({ id: THEME_ID, name, colors: C.complete(pal.colors), updated: Date.now() });
    const list = S.records().filter(r => r.id !== THEME_ID);
    list.push(rec);
    C.saveList(list);
    saveState({ prevTheme: keep.prevTheme, prevGuiColors: keep.prevGuiColors, wallpaper: d.id, title: d.title, at: Date.now() });
    S._changed();
    // In a browser look the window only wears a theme's colours when the look is set to them.
    if (G && G.getColors() === 'look') G.setColors('theme');
    M.applyTheme(THEME_ID);
    return rec;
  }

  // Put back the theme worn before the first sync and take the synced theme out of the list.
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
    S._changed();
    return true;
  }

  const api = { KEY, THEME_ID, paletteForGenerated, paletteFor, apply, undo, state, canUndo: () => !!state(), clustersOf };
  root.VexWallpaperSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexWallpaperSync: api };
})(typeof window !== 'undefined' ? window : globalThis);
