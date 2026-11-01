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
//   * the theme itself (the synced theme) is worn only while "Everything else" is on, in a look
//     that takes its colours from the theme. A browser look in its OWN colours (Firefox grey,
//     Chrome white...) is never switched to the theme's colours: "Everything else" and "Accent
//     colour" are painted by our <style> on <body> instead; and in every look an area that is off keeps the look's
//     own colours (the real value of every token, captured once before the first switch), so a switch changes only what it says;
//   * the New Tab page gets its colours from ThemeManager / tabs.js through newTabOverride();
//   * before the first switch Vex remembers the theme you wore (its nine colours and, in a
//     browser look, whether the window used the look's own colours); Undo puts exactly that back
//     and removes the synced theme and our <style>.
// In a browser look wearing its own colours the contrast numbers are worked out against the
// look's real colours (read from <body> once), not against the theme that happens to be picked.
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
  // area, and the theme itself). `fill`: a part of the area that has no background of its own (the
  // panels are drawn over the window's), so it gets the area's background, else its text would sit
  // on the colour of the window around it.
  const AREAS = [
    { id: 'newtab', label: 'New Tab page', hint: 'The page you see in a new tab' },
    { id: 'tabs', label: 'Tabs', hint: 'The tab strip and the tab list', selector: '#top-tab-bar, #tabs-sidebar' },
    { id: 'toolbar', label: 'Toolbar and search bar', hint: 'The address and search bar and the buttons around it', selector: '#top-bar, #gui-shortcuts-bar' },
    { id: 'sidebar', label: 'Side bar and panels', hint: 'The icon rail and the panels, Settings included', selector: '#icon-sidebar, #panels-container, #ai-panel', fill: '#panels-container' },
    { id: 'accent', label: 'Accent colour', hint: 'Buttons, links and switches' },
    { id: 'rest', label: 'Everything else', hint: 'The window behind, menus and dialogs' },
  ];
  const AREA_IDS = AREAS.map(a => a.id);
  const SCOPED = AREAS.filter(a => a.selector);
  // Browser looks that bring their own colours-from-the-theme block (css/gui-browser.css, section 6):
  // the generic one is not repeated for them, so their own shapes of it keep working.
  const OWN_THEME_BLOCK = ['safari', 'xp', 'win98', 'fluent', 'fluent-dark', 'glossy', 'neobrutal', 'terminal'];
  // What the accent is made of, on its own (the theme's tokens that carry the accent colour).
  const ACCENT_KEYS = ['--vex-accent', '--vex-accent-dim', '--vex-accent-glow', '--vex-border-accent', '--vex-border-accent-strong', '--vex-text-accent', '--primary', '--primary-hover', '--accent', '--on-primary'];
  const BROWSER_ACCENT = ['--b-accent: var(--vex-accent)', '--b-accent-ring: var(--vex-accent)', '--b-url-focus-border: var(--vex-accent)'];
  // A value read back from the window (a look's colour) is only ever written if it is plain colour text.
  const SAFE_VALUE = /^[#a-zA-Z0-9(),.%\s/+-]+$/;

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
//   keep    what an area that is OFF still wears while "rest" is on: yours
  // `own` and `wallpaper` are colour sets; `areas` a list of area ids. Pure.
  function compose(own, wallpaper, areas) {
    const C = ct();
    const on = new Set(cleanAreas(areas));
    const mine = C.complete(own), wp = C.complete(wallpaper);
    const accent = on.has('accent') ? wp.primary : mine.primary;
    const wearing = (base) => (accent === base.primary ? base : withAccent(base, accent));
    const out = { root: wearing(on.has('rest') ? wp : mine), areas: {}, newtab: on.has('newtab') ? wearing(wp) : mine, keep: wearing(mine) };
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

  // The theme the window wears while this state is on: the synced theme only when "Everything else"
  // is on in a look that takes its colours from the theme; otherwise the theme you wore all along.
  function expectedTheme(s) { return s.rooted === false ? s.prevTheme : THEME_ID; }

  // What an area that is OFF keeps while the window around it is matched: the real value of every
  // token a match can move (and, in a browser look, every --b-* it draws from), read from <body> once,
  // before the first switch. Written back on the area as plain values, so it looks exactly as it did
  // whatever skin it has (a hand-made theme, Glass, a browser look's own colours).
  const SAMPLE = { background: '#101010', surface: '#202020', text: '#f0f0f0', primary: '#4080ff' };
  function keepNames() {
    const names = Object.keys(ct().derive(SAMPLE).chrome).concat(['--vex-hover-fill', '--vex-shadow-color', '--vex-accent-fg']);
    return Array.from(new Set(names));
  }
  function captureKeep(browser, lookMode) {
    const body = root.document.body;
    const cs = root.getComputedStyle(body);
    const out = {};
    for (const n of keepNames().concat(browser ? LOOK_VARS : [], browser ? LOOK_EXTRA : [])) {
      const v = cs.getPropertyValue(n).trim();
      if (!v) continue;
      if (!SAFE_VALUE.test(v)) {
        // A look's own decoration written with quotes or urls cannot be kept: it stays as the window's, never half-written.
        if (LOOK_EXTRA.includes(n)) continue;
        throw new Error('Refusing the value of ' + n + ' to keep it: ' + v);
      }
      out[n] = v;
    }
    for (const n of ['--vex-bg-base', '--vex-text-primary', '--vex-accent'].concat(lookMode ? LOOK_REQUIRED : [])) {
      if (!out[n]) throw new Error('The window does not define ' + n + ', so the parts left off cannot keep their colours');
    }
    return out;
  }
  // The colour behind the panels now (the first background above them), kept for the same reason.
  function captureFill() {
    const a = SCOPED.find(x => x.fill);
    const el = a && root.document.querySelector(a.fill);
    if (!el) return null;
    for (let e = el; e; e = e.parentElement) {
      const c = root.getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/,\s*0\)$/.test(c)) {
        if (!SAFE_VALUE.test(c)) throw new Error('Refusing the colour behind the panels to keep it: ' + c);
        return c;
      }
    }
    return null;
  }
  // The look's real colours as a theme's nine, so every contrast number is against what is on screen.
  function lookColours(keep) {
    const C = ct();
    const pick = (n) => {
      const v = C.normHex(keep[n]);
      if (!v) throw new Error('The look\'s ' + n + ' is not a plain colour: ' + keep[n]);
      return v;
    };
    return C.complete({ background: pick('--b-page'), surface: pick('--b-toolbar'), text: pick('--b-text'), muted: pick('--b-text-dim'), primary: pick('--b-accent'), border: pick('--b-border') });
  }

  function guiLook() {
    const G = root.VexGuiStyle;
    return G && typeof G.isBrowserLook === 'function' && G.isBrowserLook() ? G : null;
  }

  // --- painting the areas ----------------------------------------------------------------------

  // The same mapping css/gui-browser.css (section 6) makes on <body> in "colours from the theme"
  // mode, repeated on an area so a browser look's own shapes read the area's tokens.
  const BROWSER_LINES = [
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
  ];
  const BROWSER_BLOCK = BROWSER_LINES.map(x => '  ' + x + ';').join('\n');

  // The --b-* variables of a browser look: read with the rest of what an area keeps (captureKeep).
  const LOOK_VARS = BROWSER_LINES.map(x => x.slice(0, x.indexOf(':'))).concat(['--b-surface-deep', '--b-on-accent']);
  // Colours only some looks draw on (the rail's chosen icon, caption buttons, XP's band, 98's bevels...).
  const LOOK_EXTRA = ['--b-rail-active', '--b-close-bg', '--b-close-hover', '--b-close-hover-fg', '--b-caption-bg', '--b-caption-fg', '--b-caption-hover', '--b-caption-border',
    '--b-url-shadow', '--b-url-underline', '--b-tab-shadow', '--b-tab-rest-shadow', '--b-gloss', '--b-sheen', '--b-xp-band', '--b-glossy-band', '--b-98-face',
    '--b-bevel-hi', '--b-bevel-hi2', '--b-bevel-lo', '--b-bevel-lo2', '--b-nb-ink', '--b-nb-fill', '--b-nb-shadow', '--b-nb-on-accent', '--b-t-line', '--b-t-bright'];
  const LOOK_REQUIRED = ['--b-page', '--b-toolbar', '--b-text', '--b-text-dim', '--b-accent', '--b-border'];

  // Every token of a set of colours, written only from checked values, like a theme's.
  function chromeLines(colors, only) {
    const C = ct();
    const chrome = { ...C.derive(colors).chrome };
    if (!chrome['--vex-hover-fill']) {
      chrome['--vex-hover-fill'] = 'rgba(255, 255, 255, 0.06)';
      chrome['--vex-shadow-color'] = 'rgba(0, 0, 0, 0.5)';
    }
    return Object.entries(chrome).filter(([k]) => !only || only.includes(k)).map(([k, v]) => {
      if (!/^--[a-z0-9-]+$/.test(k)) throw new Error('Refusing a theme token: ' + k);
      return '  ' + k + ': ' + C._cssValue(v) + ';';
    });
  }
  const OWN = OWN_THEME_BLOCK.map(x => ':not([data-gui-style="' + x + '"])').join('');
  const BROWSER_BODY = 'html body[data-gui-family="browser"][data-gui-style]';
  const split = (selector) => selector.split(',').map(x => x.trim());

  // The CSS of one area: every token of its colours, and the colour of its own text (an area that
  // is matched must not borrow the text colour of the window around it).
  function areaCss(selector, colors, fill) {
    const body = chromeLines(colors);
    body.push('  --vex-accent-fg: color-mix(in oklab, var(--vex-accent) 65%, var(--vex-text-primary));');
    body.push('  color: var(--vex-text-primary);');
    const sels = split(selector);
    const browser = sels.map(x => 'html body[data-gui-family="browser"]' + OWN + ' ' + x);
    // The chosen icon of the rail is a tint of the accent, worked out on <body> (css/gui-browser.css,
    // css/gui-glass.css): on an area with its own accent it has to be worked out again.
    const rail = (look, pct) => sels.map(x => 'html body[data-gui-style="' + look + '"] ' + x).join(',\n') + ' {\n  --b-rail-active: color-mix(in srgb, var(--vex-accent) ' + pct + '%, transparent);\n}';
    return sels.map(x => 'html body ' + x).join(',\n') + ' {\n' + body.join('\n') + '\n}\n' + browser.join(',\n') + ' {\n' + BROWSER_BLOCK + '\n}\n'
      + rail('firefox', 16) + '\n' + rail('firefox-dark', 16) + '\n' + rail('glass', 22)
      + (fill ? '\nhtml body ' + fill + ' {\n  background: var(--vex-bg-base);\n}' : '');
  }

  // An area that is off while "Everything else" is on: its own colours, as captured. `accent` is the
  // lines of the matched accent when "Accent colour" is on (it is one colour for the whole window).
  function keepCss(selector, keep, browser, accent, fill, fillBg) {
    const vals = { ...keep };
    // A variable this look does not define must not inherit the matched window's value either.
    if (browser) for (const n of LOOK_VARS.concat(LOOK_EXTRA)) if (!(n in vals)) vals[n] = 'initial';
    const lines = Object.entries(vals).map(([k, v]) => '  ' + k + ': ' + v + ';').concat(accent || [], ['  color: var(--vex-text-primary);']);
    return split(selector).map(x => 'html body ' + x).join(',\n') + ' {\n' + lines.join('\n') + '\n}'
      + (fill && fillBg ? '\nhtml body ' + fill + ' {\n  background: ' + fillBg + ';\n}' : '');
  }

  // The window itself (<body>) in a look that keeps its own colours: all of the matched colours when
  // "Everything else" is on, or only the accent. On <body> the look's own bridge (--vex-*: var(--b-*))
  // must be out-ranked, so these rules are one step more specific than it is.
  function bodyCss(colors, full) {
    const C = ct();
    const tokens = chromeLines(colors, full ? null : ACCENT_KEYS);
    tokens.push('  --vex-accent-fg: color-mix(in oklab, var(--vex-accent) 65%, var(--vex-text-primary));');
    const onAccent = C.derive(colors).chrome['--on-primary'];
    const accentLines = BROWSER_ACCENT.concat(['--b-on-accent: ' + C._cssValue(onAccent)]).map(x => '  ' + x + ';');
    const out = [
      'html body:not([data-gui-family="browser"]) {\n' + tokens.join('\n') + '\n}',
      BROWSER_BODY + ' {\n' + tokens.concat(accentLines).join('\n') + '\n}',
    ];
    if (full) out.push(BROWSER_BODY + OWN + ' {\n' + BROWSER_BLOCK + '\n}');
    return out.join('\n');
  }

  function composed(s) {
    return compose(s.lookMode ? lookColours(s.keep) : s.own, s.palette, s.areas);
  }

  // The whole sheet for a saved state.
  function sheetCss(s) {
    const c = composed(s);
    const on = new Set(s.areas);
    const parts = [];
    if (s.rooted === false) {
      if (on.has('rest')) parts.push(bodyCss(c.root, true));
      else if (on.has('accent')) parts.push(bodyCss(c.root, false));
    }
    if (on.has('rest')) {
      let accent = null;
      if (on.has('accent')) {
        const C = ct();
        accent = chromeLines(c.root, ACCENT_KEYS);
        if (s.browser) accent = accent.concat(['--b-accent', '--b-accent-ring', '--b-url-focus-border'].map(n => '  ' + n + ': ' + C._cssValue(c.root.primary) + ';'), ['  --b-on-accent: ' + C._cssValue(C.derive(c.root).chrome['--on-primary']) + ';']);
      }
      for (const a of SCOPED) if (!on.has(a.id)) parts.push(keepCss(a.selector, s.keep, s.browser, accent, a.fill, s.fillBg));
    }
    for (const a of SCOPED) if (on.has(a.id)) parts.push(areaCss(a.selector, c.areas[a.id], a.fill));
    return parts.join('\n');
  }

  // Write (or remove) our <style> from the saved state. Only while the theme that goes with it is worn.
  function render() {
    const doc = root.document;
    if (!doc) return;
    let style = doc.getElementById(STYLE_ID);
    const s = state();
    const M = mgr();
    const wearing = s && s.own && s.palette && M && M.getCurrentTheme() === expectedTheme(s);
    if (!wearing) { if (style) style.remove(); return; }
    const css = sheetCss(s);
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
    const s = state();
    if (!s || !s.own || !s.palette || theme !== expectedTheme(s)) return null;
    if (s.areas.includes('newtab')) return { id: THEME_ID, colors: composed(s).newtab };
    // The synced theme is worn but this page is not matched: it keeps the theme worn before.
    return s.rooted === false ? null : { id: s.prevTheme, colors: ownColorsOf(s) };
  }
  // True while the New Tab page wears the wallpaper: a browser look must not paint its own palette over it.
  function newTabWorn() {
    const s = state(), M = mgr();
    return !!(s && s.areas.includes('newtab') && M && M.getCurrentTheme() === expectedTheme(s));
  }
  // The colours of the theme worn before: for a theme of your own the New Tab carries them as ?tc=.
  function ownColorsOf(s) {
    const S = studio();
    return S && S.record && S.record(s.prevTheme) ? s.own : null;
  }

  function repaintNewTabs() {
    const M = mgr();
    if (M && typeof M.paintStartPages === 'function') M.paintStartPages(M.getCurrentTheme());
    // A browser look in its own colours paints its palette on the page; that follows our switch.
    if (root.VexGuiStyle && typeof root.VexGuiStyle.paintStartPages === 'function') root.VexGuiStyle.paintStartPages();
  }

  async function apply(id, areas) {
    const C = ct(), M = mgr(), S = studio();
    if (!M || !S) throw new Error('Themes are not loaded');
    if (S.isEditing && S.isEditing()) throw new Error('Finish or cancel the theme editor first');
    const set = cleanAreas(areas === undefined ? AREA_IDS : areas);
    if (!set.length) throw new Error('Turn on at least one area, or use Undo');
    const d = store().get(id);
    if (!d) throw new Error('There is no wallpaper called "' + id + '"');
    // Glass draws its own dark glass whatever the colours are: it is matched with the wallpaper's dark side.
    const darkOnly = !!root.document && !!root.document.body && root.document.body.dataset.guiStyle === 'glass';
    const pal = await paletteFor(id, darkOnly ? false : undefined);
    if (pal.unresolved.length) throw new Error('The colours for "' + d.title + '" cannot all be made readable: ' + pal.unresolved.map(x => x.label).join(', '));

    // What Undo restores: taken once, at the first switch (a later one keeps the first's), unless
    // another theme was picked since: that pick is what is kept then.
    const had = state();
    const G = guiLook();
    const cur = M.getCurrentTheme();
    const reuse = !!had && cur === expectedTheme(had);
    const prevTheme = reuse ? had.prevTheme : cur;
    // A browser look in its own colours stays as it is: its colours are read once and the areas
    // that are off keep them. Only a look that takes the theme's colours wears the synced theme.
    const lookMode = !!G && G.getColors() === 'look';
    const browser = !!G;
    const keep = reuse && had.keep ? had.keep : captureKeep(browser, lookMode);
    const fillBg = reuse && had.keep ? had.fillBg : captureFill();
    const theme = reuse && had.own ? had.own : C.complete(S.colorsFromTheme(cur === THEME_ID ? prevTheme : cur));
    const own = lookMode ? lookColours(keep) : theme;
    const mix = compose(own, pal.colors, set);
    const rooted = set.includes('rest') && !lookMode;

    const name = ('Synced: ' + d.title).slice(0, C.NAME_MAX).trim();
    const rec = C.validateRecord({ id: THEME_ID, name, colors: C.complete(mix.root), updated: Date.now() });
    const list = S.records().filter(r => r.id !== THEME_ID);
    if (rooted) list.push(rec);
    C.saveList(list);
    saveState({ prevTheme, wallpaper: d.id, title: d.title, at: Date.now(), areas: set, own: theme, palette: C.complete(pal.colors), rooted, lookMode, browser, keep, fillBg });
    savePref(d.id, set);
    S._changed();
    if (rooted) M.applyTheme(THEME_ID);
    else if (cur === THEME_ID) M.applyTheme(prevTheme, { auto: true });   // "Everything else" went off: the theme worn before comes back
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
    // Only the synced theme has to be taken off; a look's own colours were never touched.
    const wearing = s.rooted !== false && M.getCurrentTheme() === THEME_ID;
    if (wearing) {
      const back = M.availableThemes.includes(s.prevTheme) ? s.prevTheme : M.DEFAULT_THEME;
      M.applyTheme(back, { auto: true });
    }
    C.saveList(S.records().filter(r => r.id !== THEME_ID));
    root.localStorage.removeItem(KEY);
    if (s.wallpaper) savePref(s.wallpaper, []);
    const style = root.document && root.document.getElementById(STYLE_ID);
    if (style) style.remove();
    S._changed();
    repaintNewTabs();
    return true;
  }

  const api = { KEY, PREFS_KEY, THEME_ID, STYLE_ID, AREAS, AREA_IDS, ACCENT_KEYS, keepNames, LOOK_VARS, LOOK_EXTRA, BROWSER_LINES, paletteForGenerated, paletteFor, compose, areaCss, apply, setAreas, areasFor, undo, state, canUndo: () => !!state(), clustersOf, render, newTabOverride, newTabWorn };
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
