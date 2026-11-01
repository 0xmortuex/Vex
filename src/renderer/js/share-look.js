// === Share my look: one small file (or link) that carries how Vex looks, never anything personal ============================================
//
// A look is the colour theme, the theme pack's parts (design, icons), the look (Classic, Firefox, Glass...) and its colour mode, the skin, the
// fonts BY NAME and the wallpaper CHOICE. It goes out as a .vexlook file (JSON) or as vex://look?d=<base64url of the same JSON>.
//
// What is never in it: a picture of yours (a wallpaper you picked yourself, the picture of a custom theme), font files, bookmarks, history,
// profile or account names, settings that are not about the look, secrets. The file is built field by field from the managers (capture()),
// never by copying storage, and it is rebuilt from the checked values on the way out (validate() returns a new object).
//
// Coming in, the text is treated as hostile: a size cap, exactly the fields listed here and no others, every id must exist in this build,
// every colour must be a plain hex colour and passes CustomThemes.fixContrast (4.5:1), and nothing is evaluated, inserted as HTML or fetched.
// A catalogue photo is only named by its id; it is shown only if the wallpaper store already lists it (its own rules decide the download).
//
// Wearing a look goes through the existing managers only (ThemeManager / ThemeStudio, VexThemePacks, VexIconPacks, VexSkins, VexFonts,
// VexGuiStyle, VexWallpapers). What was there before is remembered exactly (snapshot) so undo() puts it back.
//
//   VexShareLook.capture(name?)            -> a checked look from the window as it is now
//   VexShareLook.validate(data, env?)      -> a clean look, or an Error saying what is wrong
//   VexShareLook.parse(text, env?)         -> a clean look from a file's text or a vex://look?d=... link
//   VexShareLook.toFile(look) / toLink(look) / toText(look)
//   VexShareLook.apply(look)               -> Promise<{ skipped: [] }>  wears it, remembering the old look; rolls back on a failure
//   VexShareLook.undo() / hasUndo()        -> put the previous look back exactly
(function () {
  'use strict';
  var FORMAT = 'vex-look';
  var VERSION = 1;
  var FILE_MAX = 8 * 1024;
  var LINK_MAX = 2048;                       // bytes of JSON inside a link
  var LINK_PREFIX = 'vex://look?d=';
  var NAME_MAX = 30;
  var UNDO_KEY = 'vex.shareLook.undo';
  var FIELDS = ['format', 'version', 'name', 'colours', 'pack', 'design', 'icons', 'look', 'guiColors', 'skin', 'fonts', 'wallpaper'];
  var SKIN_KINDS = ['pattern', 'shape', 'glow', 'strength'];
  var WALL_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
  var PHOTO_RE = /^photo-[a-z0-9-]{1,56}$/;
  var COLOUR_MODES = ['look', 'theme'];

  var W = function () { return typeof window !== 'undefined' ? window : globalThis; };
  function themeManager() { return typeof ThemeManager !== 'undefined' ? ThemeManager : W().ThemeManager; }
  function themeStudio() { return typeof ThemeStudio !== 'undefined' ? ThemeStudio : W().ThemeStudio; }
  function need(name, obj) { if (!obj) throw new Error('Share my look needs ' + name + ' to be loaded'); return obj; }

  // ---- What this build knows: the ids a look may name ------------------------------------------------------------------------------------
  function ids(list) { return list.map(function (x) { return x.id; }); }
  function env() {
    var w = W();
    var TM = need('js/theme-manager.js', themeManager());
    var wp = w.VexWallpapers;
    var skins = need('js/skins.js', w.VexSkins);
    var fonts = need('js/fonts.js', w.VexFonts);
    return {
      CustomThemes: need('js/theme-custom.js', w.CustomThemes),
      themes: TM.THEMES.filter(function (t) { return !t.user; }).map(function (t) { return t.id; }),
      themeLabel: function (id) { var t = TM.THEMES.find(function (x) { return x.id === id; }); return t ? t.label : id; },
      packs: ids(need('js/theme-packs.js', w.VexThemePacks).PACKS),
      packName: function (id) { var p = w.VexThemePacks.pack(id); return p ? p.name : id; },
      designs: ids(w.VexThemePacks.DESIGNS),
      designName: function (id) { var d = w.VexThemePacks.design(id); return d ? d.name : id; },
      icons: ids(need('js/icon-packs.js', w.VexIconPacks).PACKS),
      iconName: function (id) { var p = w.VexIconPacks.get(id); return p ? p.name : id; },
      looks: need('js/gui-style.js', w.VexGuiStyle).styles(),
      skin: { pattern: ids(skins.PATTERNS), shape: ids(skins.SHAPES), glow: ids(skins.GLOWS), strength: ids(skins.STRENGTHS) },
      fonts: ids(fonts.FONTS),
      monoFonts: fonts.FONTS.filter(function (f) { return f.kind === 'mono'; }).map(function (f) { return f.id; }),
      fontName: function (id) { var f = fonts.get(id); return f ? f.name : id; },
      wallpapers: wp ? wp.list().filter(function (x) { return x.source === 'generated'; }).map(function (x) { return x.id; }) : [],
      wallpaperTitle: function (id) { var d = wp && wp.get(id); return d && d.title ? d.title : id; },
    };
  }

  // ---- Checking -----------------------------------------------------------------------------------------------------------------------------
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function onlyKeys(o, allowed, what) {
    Object.keys(o).forEach(function (k) {
      if (allowed.indexOf(k) < 0) throw new Error('That look has something a look does not (' + what + ': "' + String(k).slice(0, 30) + '")');
    });
  }
  function pick(list, v, what) {
    if (typeof v !== 'string' || list.indexOf(v) < 0) throw new Error('This version of Vex has no ' + what + ' called "' + String(v).slice(0, 40) + '"');
    return v;
  }
  function cleanName(name) {
    if (typeof name !== 'string') throw new Error('The name of a look must be text');
    var n = name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
    if (n.length > NAME_MAX) throw new Error('The name of a look is ' + NAME_MAX + ' characters at most');
    return n;
  }

  // Whatever came in -> a NEW object holding only checked values. `e` is the environment (see env()), injectable for tests.
  function validate(data, e) {
    e = e || env();
    if (!isObj(data)) throw new Error('That is not a Vex look');
    onlyKeys(data, FIELDS, 'field');
    if (data.format !== FORMAT) throw new Error('That is not a Vex look');
    if (!Number.isInteger(data.version) || data.version < 1) throw new Error('That look has no version');
    if (data.version > VERSION) throw new Error('That look was made by a newer Vex: update Vex to open it');
    var out = { format: FORMAT, version: VERSION };
    if (data.name != null) { var n = cleanName(data.name); if (n) out.name = n; }

    var c = data.colours;
    if (typeof c === 'string') {
      out.colours = pick(e.themes, c, 'colour theme');
    } else if (isObj(c)) {
      onlyKeys(c, ['name', 'colors'], 'theme field');
      var C = e.CustomThemes;
      var raw = C._colorsStrict(c.colors, C.REQUIRED);
      var fixed = C.fixContrast(C.complete(raw));
      if (fixed.unresolved.length) throw new Error('Those colours cannot be made readable (' + fixed.unresolved.map(function (f) { return f.label.toLowerCase(); }).join(', ') + ')');
      out.colours = { name: C.cleanName(c.name), colors: fixed.colors };
    } else throw new Error('That look has no colours');

    if (data.pack != null) out.pack = pick(e.packs, data.pack, 'theme pack');
    out.design = pick(e.designs, data.design, 'design');
    out.icons = pick(e.icons, data.icons, 'icon pack');
    out.look = pick(e.looks, data.look, 'look');
    out.guiColors = pick(COLOUR_MODES, data.guiColors, 'colour mode');

    if (!isObj(data.skin)) throw new Error('That look has no skin');
    onlyKeys(data.skin, SKIN_KINDS, 'skin field');
    out.skin = {};
    SKIN_KINDS.forEach(function (k) { out.skin[k] = pick(e.skin[k], data.skin[k], 'skin ' + k); });

    if (!isObj(data.fonts)) throw new Error('That look has no fonts');
    onlyKeys(data.fonts, ['ui', 'mono'], 'font field');
    out.fonts = { ui: pick(e.fonts, data.fonts.ui, 'font'), mono: pick(e.monoFonts, data.fonts.mono, 'code font') };

    if (data.wallpaper != null) {
      if (!isObj(data.wallpaper)) throw new Error('The wallpaper of that look is not a choice');
      onlyKeys(data.wallpaper, ['id'], 'wallpaper field');
      var id = data.wallpaper.id;
      if (typeof id !== 'string' || !WALL_RE.test(id)) throw new Error('That is not a wallpaper id');
      if (/^my-/.test(id)) throw new Error('A picture of your own is never part of a look');
      // A drawn wallpaper must exist in this build. A catalogue photo is only named here; apply() shows it only if the store lists it.
      if (!(PHOTO_RE.test(id) || e.wallpapers.indexOf(id) >= 0)) throw new Error('This version of Vex has no wallpaper called "' + id.slice(0, 40) + '"');
      out.wallpaper = { id: id };
    }
    return out;
  }

  // ---- Text <-> look -----------------------------------------------------------------------------------------------------------------------
  function utf8(s) { return new TextEncoder().encode(s); }
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('That link is damaged (it has characters a look link never has)');
    var s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
  function toFile(look) { return JSON.stringify(validate(look), null, 2) + '\n'; }
  function toLink(look) {
    var bytes = utf8(JSON.stringify(validate(look)));
    if (bytes.length > LINK_MAX) throw new Error('This look is too big for a link (' + bytes.length + ' bytes, ' + LINK_MAX + ' at most). Share the file instead');
    return LINK_PREFIX + b64url(bytes);
  }
  function isLink(text) { return typeof text === 'string' && text.trim().indexOf(LINK_PREFIX) === 0; }
  function describe(look, e) {
    e = e || env();
    var colours = typeof look.colours === 'string' ? e.themeLabel(look.colours) : look.colours.name + ' (own colours)';
    var lines = [
      ['Colours', colours],
      ['Theme pack', look.pack ? e.packName(look.pack) : 'Custom'],
      ['Design', e.designName(look.design)],
      ['Icons', e.iconName(look.icons)],
      ['Look', look.look],
      ['Font', e.fontName(look.fonts.ui) + ', code ' + e.fontName(look.fonts.mono)],
      ['Wallpaper', look.wallpaper ? e.wallpaperTitle(look.wallpaper.id) : 'none (yours stays)'],
    ];
    var who = look.name ? look.name + '’s look' : 'A shared look';
    return { title: who, lines: lines, summary: who + ': colours ' + colours + ', pack ' + lines[1][1] + ', wallpaper ' + lines[6][1] };
  }
  function toText(look, e) {
    var d = describe(validate(look, e), e);
    return d.summary + '\nOpen it in Vex: paste this into Ctrl+K or the address bar\n' + toLink(look);
  }
  function parse(text, e) {
    if (typeof text !== 'string') throw new Error('That is not a Vex look');
    var t = text.trim();
    var json;
    if (isLink(t)) {
      var rest = t.slice(LINK_PREFIX.length);
      if (rest.length > Math.ceil(LINK_MAX * 4 / 3) + 4) throw new Error('That link is too big to be a look');
      var bytes = unb64url(rest);
      if (bytes.length > LINK_MAX) throw new Error('That link is too big to be a look');
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (err) { throw new Error('That link is damaged (it is not text)', { cause: err }); }
    } else {
      if (text.length > FILE_MAX) throw new Error('That file is too big to be a look');
      json = t;
    }
    var data;
    try { data = JSON.parse(json); } catch (err) { throw new Error('That is not a Vex look (it is not JSON)', { cause: err }); }
    return validate(data, e);
  }

  // ---- The window as it is now -> a look ------------------------------------------------------------------------------------------------------
  function capture(name) {
    var w = W();
    var TM = need('js/theme-manager.js', themeManager());
    var cur = TM.getCurrentTheme();
    var colours;
    var meta = TM.THEMES.find(function (t) { return t.id === cur; });
    if (meta && meta.user) {
      var rec = need('js/theme-studio.js', themeStudio()).record(cur);
      if (!rec) throw new Error('Your own theme "' + cur + '" could not be read');
      colours = { name: rec.name, colors: rec.colors };     // its colours only: the picture of a custom theme is never shared
    } else colours = cur;
    var P = need('js/theme-packs.js', w.VexThemePacks).current();
    var S = need('js/skins.js', w.VexSkins);
    var F = need('js/fonts.js', w.VexFonts);
    var wall = w.VexWallpapers && w.VexWallpapers.current();
    var look = {
      format: FORMAT, version: VERSION,
      colours: colours,
      design: P.design, icons: need('js/icon-packs.js', w.VexIconPacks).current().id,
      look: need('js/gui-style.js', w.VexGuiStyle).get(), guiColors: w.VexGuiStyle.getColors(),
      skin: { pattern: S.pattern().id, shape: S.shape().id, glow: S.glow().id, strength: S.strength().id },
      fonts: { ui: F.current().id, mono: F.currentMono().id },
    };
    if (P.pack) look.pack = P.pack;
    if (name != null && String(name).trim()) look.name = name;
    // A picture of the person's own is left out (the person is told in the dialog). A listed photo goes by its id.
    if (wall && !/^my-/.test(wall.id)) look.wallpaper = { id: wall.id };
    return validate(look);
  }

  // ---- Remembering the old look, and putting it back -------------------------------------------------------------------------------------------
  function lsGet(k) { return W().localStorage.getItem(k); }
  function lsPut(k, v) { if (v === null || v === undefined) W().localStorage.removeItem(k); else W().localStorage.setItem(k, v); }

  function snapshot() {
    var w = W();
    var S = need('js/skins.js', w.VexSkins), F = need('js/fonts.js', w.VexFonts);
    var cur = w.VexWallpapers && w.VexWallpapers.current();
    return {
      v: 1,
      colours: need('js/theme-manager.js', themeManager()).getCurrentTheme(),
      store: {
        pack: lsGet(w.VexThemePacks.KEY), icons: lsGet(w.VexIconPacks.KEY), font: lsGet(F.KEY), mono: lsGet(F.MONO_KEY),
        pattern: lsGet(S.PATTERN_KEY), shape: lsGet(S.SHAPE_KEY), glow: lsGet(S.GLOW_KEY), strength: lsGet(S.STRENGTH_KEY),
      },
      look: w.VexGuiStyle.get(), guiColors: w.VexGuiStyle.getColors(),
      wallpaper: cur ? { id: cur.id, dim: cur.dim, blur: cur.blur, auto: cur.auto } : null,
      added: null,
    };
  }
  function saveUndo(snap, label) {
    try { W().localStorage.setItem(UNDO_KEY, JSON.stringify({ snap: snap, label: label, at: Date.now() })); }
    catch (err) { throw new Error('Could not remember your current look for Undo: ' + err.message, { cause: err }); }
  }
  function readUndo() {
    var raw = lsGet(UNDO_KEY);
    if (!raw) return null;
    var rec;
    try { rec = JSON.parse(raw); } catch (err) { throw new Error('The saved look for Undo is damaged', { cause: err }); }
    if (!isObj(rec) || !isObj(rec.snap) || rec.snap.v !== 1) throw new Error('The saved look for Undo is damaged');
    return rec;
  }
  function hasUndo() { return !!lsGet(UNDO_KEY); }

  async function restore(snap) {
    var w = W();
    var e = env();
    var st = snap.store || {};
    var S = w.VexSkins, F = w.VexFonts;
    // The saved values go back verbatim (a missing key goes back to missing), then each manager repaints from its own storage.
    lsPut(w.VexThemePacks.KEY, st.pack); lsPut(w.VexIconPacks.KEY, st.icons); lsPut(F.KEY, st.font); lsPut(F.MONO_KEY, st.mono);
    lsPut(S.PATTERN_KEY, st.pattern); lsPut(S.SHAPE_KEY, st.shape); lsPut(S.GLOW_KEY, st.glow); lsPut(S.STRENGTH_KEY, st.strength);
    w.VexThemePacks.apply(); w.VexIconPacks.apply(); F.apply(); S.apply();
    if (w.document) w.document.dispatchEvent(new w.CustomEvent('vex:theme-pack-changed', { detail: { part: 'share-look' } }));
    var TM = themeManager();
    if (TM.availableThemes.indexOf(snap.colours) >= 0) TM.applyTheme(snap.colours);
    else throw new Error('The colour theme you had ("' + String(snap.colours).slice(0, 40) + '") is gone');
    pick(e.looks, snap.look, 'look');
    await w.VexGuiStyle.set(snap.look);
    w.VexGuiStyle.setColors(pick(COLOUR_MODES, snap.guiColors, 'colour mode'));
    if (w.VexWallpapers) {
      if (snap.wallpaper) await w.VexWallpapers.apply(snap.wallpaper.id, { dim: snap.wallpaper.dim, blur: snap.wallpaper.blur, auto: snap.wallpaper.auto });
      else if (w.VexWallpapers.current()) await w.VexWallpapers.remove();
    }
    // The theme the import added is removed last (the colours of before are already back, so nothing falls back to anything).
    if (snap.added) {
      if (!/^user-[a-z]{4,24}$/.test(snap.added)) throw new Error('The saved look for Undo names a theme that is not one of yours');
      if (themeStudio() && themeStudio().record(snap.added)) await themeStudio().remove(snap.added, { quiet: true });
    }
  }

  async function undo() {
    var rec = readUndo();
    if (!rec) throw new Error('There is no shared look to undo');
    await restore(rec.snap);
    W().localStorage.removeItem(UNDO_KEY);
    return rec.label || null;
  }

  // ---- Wearing a look --------------------------------------------------------------------------------------------------------------------------
  async function apply(look) {
    var w = W();
    var e = env();
    var v = validate(look, e);
    var snap = snapshot();
    var skipped = [];
    saveUndo(snap, describe(v, e).title);
    try {
      var P = w.VexThemePacks, TM = themeManager();
      if (v.pack) P.applyPack(v.pack);
      if (P.current().design !== v.design) P.setDesign(v.design);
      SKIN_KINDS.forEach(function (k) { if (w.VexSkins[k]().id !== v.skin[k]) w.VexSkins.set(k, v.skin[k]); });

      if (typeof v.colours === 'string') {
        TM.applyTheme(v.colours);
      } else {
        var TS = need('js/theme-studio.js', themeStudio());
        var same = TS.records().find(function (r) { return JSON.stringify(r.colors) === JSON.stringify(e.CustomThemes.complete(v.colours.colors)); });
        if (same) TM.applyTheme(same.id);
        else {
          var rec = await TS.addTheme({ name: v.colours.name, colors: v.colours.colors }, { wear: true });
          snap.added = rec.id;
          saveUndo(snap, describe(v, e).title);
        }
      }
      if (w.VexIconPacks.current().id !== v.icons) w.VexIconPacks.set(v.icons);
      if (w.VexFonts.current().id !== v.fonts.ui) w.VexFonts.set(v.fonts.ui);
      if (w.VexFonts.currentMono().id !== v.fonts.mono) w.VexFonts.setMono(v.fonts.mono);
      if (w.VexGuiStyle.get() !== v.look) await w.VexGuiStyle.set(v.look);
      if (w.VexGuiStyle.getColors() !== v.guiColors) w.VexGuiStyle.setColors(v.guiColors);

      if (v.wallpaper) {
        var WP = w.VexWallpapers;
        if (!WP) skipped.push('The wallpaper store is not loaded, so the wallpaper was left as it is');
        else {
          var d = WP.get(v.wallpaper.id);
          // A photo is shown only if the store already lists it (its own rules decide what may be downloaded): never fetched on a file's say-so.
          if (!d || d.stub || (d.source === 'catalogue' && !WP.list().some(function (x) { return x.id === v.wallpaper.id; }))) {
            skipped.push('The photo "' + v.wallpaper.id.slice(0, 40) + '" is not in your wallpaper list, so your wallpaper was left as it is');
          } else await WP.apply(v.wallpaper.id);
        }
      }
      if (w.document) w.document.dispatchEvent(new w.CustomEvent('vex:theme-pack-changed', { detail: { part: 'share-look' } }));
    } catch (err) {
      // Half a look is worse than none: the old one goes back, then the failure is raised.
      try { await restore(snap); w.localStorage.removeItem(UNDO_KEY); }
      catch (back) { throw new Error('Could not wear that look (' + err.message + ') and could not put yours back (' + back.message + ')', { cause: err }); }
      throw err;
    }
    return { skipped: skipped };
  }

  var api = {
    FORMAT: FORMAT, VERSION: VERSION, FILE_MAX: FILE_MAX, LINK_MAX: LINK_MAX, LINK_PREFIX: LINK_PREFIX, UNDO_KEY: UNDO_KEY, NAME_MAX: NAME_MAX, FIELDS: FIELDS,
    env: env, validate: validate, parse: parse, isLink: isLink, capture: capture, describe: describe,
    toFile: toFile, toLink: toLink, toText: toText, snapshot: snapshot, apply: apply, undo: undo, hasUndo: hasUndo, cleanName: cleanName,
  };
  if (typeof window !== 'undefined') window.VexShareLook = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexShareLook: api };
})();
