// === Discord in the Vex theme ===============================================
//
// "Match Discord to my Vex theme" (off by default; Settings › Appearance, and
// right-click the Discord button). Discord runs Vencord in Vex (the panel and
// Discord as a tab share persist:discord, so one Vencord and one set of
// Vencord settings), and this uses Vencord's OWN theme mechanism:
//
//   * a Vex theme named after a BetterDiscord theme (the 28 in REAL) adds that
//     theme's published CSS link to Vencord's Online Themes (themeLinks). The
//     Discord page itself fetches it, through the Discord session and its
//     bypass route, like any theme link the user pastes there. Vex's link ends
//     in LINK_MARK, so it is told apart from the user's own links;
//   * every other theme (and your own) becomes a Vencord theme file, FILE,
//     switched on in Vencord's Local Themes (enabledThemes). It sets every
//     colour variable Discord's own CSS defines and uses (js/discord-tokens.js,
//     from scripts/discord-tokens.js), in every Discord mode, so a light Vex
//     theme gives an all-light Discord even with Discord in dark mode; and
//     every text-on-background pairing Discord's rules make is checked to
//     4.5:1 (3:1 for icons).
//
// Only Vex's own entry is ever added, changed or removed: the user's links,
// their other theme files and their QuickCSS are left exactly as they are,
// with one exception, only ever on the user's click: when their own themes
// are also on (they can clash with the colours here) Vex says so, and
// "Pause my other themes while matching" takes them out, records exactly
// what it took, and puts exactly that back when matching turns off.
// Vencord re-reads themeLinks and enabledThemes the moment they change, so a
// theme change (or Light and dark switching) shows in Discord at once, with
// no reload. Turned off, Vex's entries are removed the same way — at once in
// an open Discord, or the next time Discord loads.

const DiscordTheme = {
  KEY: 'vex.discordMatchTheme',              // 'on' | anything else = off (the default)
  APPLIED_KEY: 'vex.discordMatchApplied',    // '1' while Discord may still hold Vex's entries
  PAUSED_KEY: 'vex.discordMatchPaused',      // JSON { themes, links, quickCss }: exactly what "Pause my other themes" took
  FILE: 'vex-theme-match.css',
  LINK_MARK: '#vex-theme-match',
  // The least a colour gets when Discord uses it in ways no lightness can
  // all serve at 3:1 on the theme's surfaces (see tokens()).
  BALANCED_FLOOR: 2.5,
  // How long a Discord page is given for Vencord to start.
  VENCORD_WAIT_MS: 15000,

  // Vex theme id -> the real BetterDiscord theme it is named after. url is the
  // theme's own published CSS (checked: 200, text/css), loaded by Discord.
  // Only the link is used: Vex never copies or ships the CSS. Checked
  // 2026-10-11; none is raw.githubusercontent.com (served as text/plain,
  // which Chromium refuses as a stylesheet, and Vex does not rewrite it).
  REAL: {
    clearvision:  { name: 'ClearVision', url: 'https://clearvision.github.io/ClearVision-v7/main.css', license: 'Apache-2.0', repo: 'https://github.com/ClearVision/ClearVision-v7' },
    darkmatter:   { name: 'Dark Matter', url: 'https://discordstyles.github.io/DarkMatter/DarkMatter.theme.css', license: 'MIT', repo: 'https://github.com/DiscordStyles/DarkMatter' },
    duskplus:     { name: 'Discord+', url: 'https://plusinsta.github.io/discord-plus/DiscordPlus.theme.css', license: 'MIT', repo: 'https://github.com/PlusInsta/discord-plus' },
    terminal:     { name: 'Fallout 4 Terminal', url: 'https://cdn.jsdelivr.net/gh/B4T3S/Fallout4TerminalTheme@main/Fallout4Terminal.theme.css', license: 'ISC (package.json)', repo: 'https://github.com/B4T3S/Fallout4TerminalTheme' },
    recordgreen:  { name: 'Spotify Discord', url: 'https://capnkitten.github.io/BetterDiscord/Themes/Spotify-Discord/css/source.css', license: 'none stated', repo: 'https://github.com/CapnKitten/Spotify-Discord' },
    darkneon:     { name: 'Dark Neon', url: 'https://cdn.jsdelivr.net/gh/B4T3S/DiscordDarkNeon@master/DarkNeon.theme.css', license: 'ISC (package.json)', repo: 'https://github.com/B4T3S/DiscordDarkNeon' },
    deepmidnight: { name: 'midnight', url: 'https://refact0r.github.io/midnight-discord/themes/midnight.theme.css', license: 'MIT', repo: 'https://github.com/refact0r/midnight-discord' },
    softx:        { name: 'SoftX', url: 'https://discordstyles.github.io/SoftX/SoftX.theme.css', license: 'MIT', repo: 'https://github.com/DiscordStyles/SoftX' },
    tokyonight:   { name: 'Tokyo Night', url: 'https://ashtrath.github.io/Tokyo-Night/src/main.css', license: 'MIT', repo: 'https://github.com/ashtrath/Tokyo-Night' },
    material:     { name: 'Material Discord', url: 'https://capnkitten.github.io/Material-Discord/Material-Discord.theme.css', license: 'none stated', repo: 'https://github.com/CapnKitten/Material-Discord' },
    androidbeige: { name: 'NieR: Automata YoRHa', url: 'https://accrazed.github.io/YoRHA-UI-BetterDiscord/NieR-Light-Source.theme.css', license: 'none stated', repo: 'https://github.com/AccraZed/YoRHA-UI-BetterDiscord' },
    kaleidoscope: { name: 'kaleidoscope', url: 'https://spinfish.github.io/kaleidoscope/source/support/kaleidoscope.compiled.css', license: 'MIT', repo: 'https://github.com/spinfish/kaleidoscope' },
    codedark:     { name: 'Discord Dark', url: 'https://syndishanx.github.io/Discord-Dark/discorddark.theme.css', license: 'none stated', repo: 'https://github.com/SyndiShanX/Discord-Dark' },
    synthesis:    { name: 'Synthesis', url: 'https://saltssaumure.github.io/synthesis-discord-theme/Synthesis.theme.css', license: 'AGPL-3.0-or-later', repo: 'https://github.com/Saltssaumure/synthesis-discord-theme' },
    virtualred:   { name: 'Virtual Boy', url: 'https://nexus-themes.github.io/Virtual-Boy/virtual-boy.theme.css', license: 'none stated', repo: 'https://github.com/Nexus-Themes/Virtual-Boy' },
    paperred:     { name: 'piOS', url: 'https://saltssaumure.github.io/pios-discord-theme/piOS.theme.css', license: 'AGPL-3.0-or-later', repo: 'https://github.com/Saltssaumure/pios-discord-theme' },
    noctisviola:  { name: 'Noctis Viola', url: 'https://chaseingebritson.github.io/noctis-viola-discord-theme/noctis-viola.css', license: 'ISC (package.json)', repo: 'https://github.com/ChaseIngebritson/noctis-viola-discord-theme' },
    wildberry:    { name: 'Wildberry', url: 'https://dagcord.github.io/Wildberry/wildberry.css', license: 'MIT', repo: 'https://github.com/DagCord/Wildberry' },
    gxred:        { name: 'OperaGX', url: 'https://hawkratio.github.io/OperaGXTheme/release/OperaGX.theme.css', license: 'MIT', repo: 'https://github.com/L-Ratio/OperaGXTheme' },
    gruvbox:      { name: 'Gruvbox Sharp', url: 'https://cdn.jsdelivr.net/gh/round-panda/gruvbox-sharp@main/GruvboxSharp.theme.css', license: 'MIT', repo: 'https://github.com/round-panda/gruvbox-sharp' },
    ezlight:      { name: 'EzLight', url: 'https://cdn.jsdelivr.net/gh/Inve1951/BetterDiscordStuff@master/themes/EzLight.theme.css', license: 'Design Science License', repo: 'https://github.com/Inve1951/BetterDiscordStuff' },
  },
  // Of the 28, the ones coloured by Vex instead, and why.
  GENERATED_INSTEAD: {
    darkplus: 'Dark+ is under a "Private Use License" that forbids making it available on a public platform',
    rosynight: 'RosyNight is under a "Private Use License" that forbids making it available on a public platform',
    azurite: 'Azurite is under a "Private Use License" that forbids making it available on a public platform',
    neptune: 'Neptune is under a "Private Use License" that forbids making it available on a public platform',
    neutron: 'Neutron\'s licence forbids redistributing it without the author\'s permission',
    nocturnal: 'Nocturnal\'s licence forbids redistributing it without the author\'s permission',
    amoled: 'AMOLED-Cord changes only Discord\'s Onyx mode, so in Discord\'s usual dark mode it would do nothing',
  },

  // Patterns the page script uses, as source text (so no backslash has to
  // survive being written inside the script's own template).
  GUEST_RE: {
    comment: /\/\*[\s\S]*?\*\//.source,
    // A colour or background property, or a custom property given a colour.
    colour: /(^|[;{\s])(color|background(-color|-image)?|--[\w-]+)\s*:[^;}]*(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|var\(|\b(white|black|transparent)\b)/.source,
    ext: /(\.theme)?\.css$/.source,
    prefix: /^@(light|dark)\s+/.source,
  },

  isOn() {
    try { return localStorage.getItem(this.KEY) === 'on'; } catch { return false; }
  },

  realFor(themeId) {
    return Object.prototype.hasOwnProperty.call(this.REAL, themeId) ? this.REAL[themeId] : null;
  },

  // ---- the colours ----------------------------------------------------------

  _ct() {
    const ct = (typeof CustomThemes !== 'undefined') ? CustomThemes : (typeof window !== 'undefined' ? window.CustomThemes : null);
    if (!ct) throw new Error('The theme colour maths (js/theme-custom.js) is not loaded');
    return ct;
  },

  _data() {
    const d = (typeof DiscordTokens !== 'undefined') ? DiscordTokens : (typeof window !== 'undefined' ? window.DiscordTokens : null);
    if (!d) throw new Error('Discord\'s colour variables (js/discord-tokens.js) are not loaded');
    return d;
  },

  // '#rrggbb' or '#rrggbbaa' -> { hex: '#rrggbb', a }.
  _parse(v) {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
    if (!m) throw new Error('Not a Discord colour value: ' + v);
    return { hex: '#' + m[1], a: m[2] ? Math.round(parseInt(m[2], 16) / 255 * 1000) / 1000 : 1 };
  },

  _over(fg, bgHex) {
    if (fg.a >= 1) return fg.hex;
    return this._ct().mix(bgHex, fg.hex, fg.a);
  },

  // Discord's colour `v` ({hex, a}) in the Vex theme. Greys are placed on the
  // theme's own ladder by where they sit on Discord's (its chat background,
  // muted text and text, in `axis`); Discord's blurple, red, green and amber
  // become the theme's accent, danger, success and warning, as much lighter
  // or darker than them as Discord's were than its own; other colours
  // (Nitro, chart and role colours) keep their hue and take the ladder's
  // lightness. `flip`: the colour comes from a Discord design of the other
  // brightness than the theme's.
  _map(v, axis, refs, vex, flip) {
    const ct = this._ct();
    const lab = (h) => ct.rgbToOklab(...ct.rgb(h));
    const [L, a, b] = lab(v.hex);
    const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    const [Lb, Lm, Lt] = axis.map(x => lab(x)[0]);
    const span = (Lt - Lb) || 1e-6;
    const s = (L - Lb) / span, sm = Math.min(0.95, Math.max(0.05, (Lm - Lb) / span));
    const V = vex.axis;
    const [A, B, u] = s <= sm ? [V[0], V[1], s / sm] : [V[1], V[2], (s - sm) / (1 - sm)];
    const ladderL = A[0] + u * (B[0] - A[0]);
    const out = (hex) => ({ hex, a: v.a });
    if (C < 0.035) {
      const k = Math.max(0, Math.min(1, u));
      const na = A[1] + k * (B[1] - A[1]), nb = A[2] + k * (B[2] - A[2]);
      return out(ct.fromOklch(ladderL, Math.hypot(na, nb), (Math.atan2(nb, na) * 180 / Math.PI + 360) % 360));
    }
    let best = null, bestD = 35;
    for (const fam of ['brand', 'danger', 'success', 'warning']) {
      const [, , rh] = ct.toOklch(refs[fam]);
      const d = Math.min(Math.abs(rh - h), 360 - Math.abs(rh - h));
      if (d < bestD) { bestD = d; best = fam; }
    }
    if (!best) return out(ct.fromOklch(ladderL, C, h));
    const [rL, rC] = ct.toOklch(refs[best]);
    const [tL, tC, tH] = ct.toOklch(vex[best]);
    const dL = (L - rL) * (flip ? -1 : 1);
    return out(ct.fromOklch(tL + dL, Math.min(tC * 1.5, tC * (rC > 0.01 ? C / rC : 1)), tH));
  },

  // Which of Discord's colours are text on the page (drawn straight on the
  // surfaces, or on a hover veil over them), and which are its inks: a theme
  // variable that is plain white or black in Discord's design and only ever
  // drawn on filled things (a button, a badge, a notice). Like Discord, Vex
  // keeps an ink white or black, and the fill moves until it reads, so every
  // label on the accent button agrees instead of each nudging it its own way.
  _kinds(light) {
    const D = this._data();
    const onSurfaces = new Set(D.freeText.map(f => f[0]));
    for (const [fg, bg] of D.pairs) if (D.floors.includes(bg) || D.layers.includes(bg)) onSurfaces.add(fg);
    const inks = new Set();
    for (const [fg] of D.pairs) {
      const raw = D.semantic[fg] && D.semantic[fg][light ? 1 : 0];
      if ((raw === '#ffffff' || raw === '#000000') && !onSurfaces.has(fg)) inks.add(fg);
    }
    return { onSurfaces, inks };
  },

  // The palette colours some of Discord's rules use for one mode only
  // (.theme-dark .x { color: var(--primary-300) }). Those are recoloured per
  // Discord mode, so a rule written for dark mode still reads when a light
  // theme turns that mode light; every other palette colour is recoloured
  // once, from Discord's design of the theme's own brightness, which keeps
  // the pairings Discord made with it (white on its grey and its blurple)
  // as readable as Discord made them.
  _modeBound() {
    const D = this._data();
    const out = new Set();
    for (const p of D.pairs) if (p[5]) for (const n of [p[0], p[1]]) if (Object.prototype.hasOwnProperty.call(D.primitive, n)) out.add(n);
    for (const f of D.freeText) if (f[3] && Object.prototype.hasOwnProperty.call(D.primitive, f[0])) out.add(f[0]);
    return out;
  },

  // Every text-on-background pairing to check for a light or dark theme, per
  // Discord mode: { fg, bg (null: the surfaces), min, fa, ba, m, discord }.
  // A pairing of colours taken from Discord's design of the theme's own
  // brightness is checked when that design means it to be read; a pairing
  // with a palette colour recoloured per mode (see _modeBound) is checked in
  // each mode where Discord's own colours read, when they also read in a
  // Discord mode as light or dark as the theme (a colour Discord uses both
  // as text on its white page and under white text cannot do both on a dark
  // page, so its light-mode-only use is not carried over to a dark theme,
  // and the other way round). `discord` is how well the pairing reads in
  // Discord itself.
  //
  // Two shapes are left out because no colour can satisfy them without
  // breaking the text people read most: one of Discord's text colours used
  // as the background of something (black text on a pill the colour of the
  // channel names), and page text unlike Discord's white or black ink drawn
  // on a fill that also carries that ink (the accent button with both a
  // white label and dark page text on it). The ink and the page text win.
  pairings(light) {
    const D = this._data();
    const own = light ? 'light' : 'dark';
    const sameKind = D.modes.filter(m => (m === 'light') === light);
    const { onSurfaces, inks } = this._kinds(light);
    const isInk = (n) => inks.has(n) || Object.prototype.hasOwnProperty.call(D.absolute, n);
    // Discord's own colour for a variable, in its design of this brightness.
    const raw = (n) => {
      const v = D.absolute[n] || (D.semantic[n] && D.semantic[n][light ? 1 : 0]) || D.primitive[n];
      return v ? this._parse(Array.isArray(v) ? v[D.modes.indexOf(own)] : v).hex : null;
    };
    const inksOn = new Map();
    for (const [fg, bg] of D.pairs) if (isInk(fg)) { if (!inksOn.has(bg)) inksOn.set(bg, []); inksOn.get(bg).push(raw(fg)); }
    const ct = this._ct();
    const fightsInk = (fg, bg) => inksOn.has(bg) && !isInk(fg) && onSurfaces.has(fg) && raw(fg)
      && inksOn.get(bg).some(ink => ct.contrast(ink, raw(fg)) > 3);
    const bound = this._modeBound();
    const want = [];
    const push = (w, modes, reads) => {
      if (w.bg && ((onSurfaces.has(w.bg) && /(^--|-)(text|icon)(-|$)/.test(w.bg)) || fightsInk(w.fg, w.bg))) return;
      const rd = reads.split(' ');
      const palette = [w.fg, w.bg].some(n => n && bound.has(n));
      const ms = modes ? modes.split(' ') : D.modes;
      if (palette) {
        if (!rd.some(m => sameKind.includes(m))) return;
        for (const m of ms) if (rd.includes(m)) want.push({ ...w, m, ref: m });
        return;
      }
      if (!(modes ? ms.some(m => rd.includes(m)) : rd.includes(own))) return;
      for (const m of ms) want.push({ ...w, m, ref: modes ? m : own });
    };
    for (const [fg, bg, min, fa, ba, modes, reads] of D.pairs) push({ fg, bg, min, fa, ba }, modes, reads);
    for (const [fg, min, fa, modes, reads] of D.freeText) push({ fg, bg: null, min, fa }, modes, reads);
    // How well each pairing reads in Discord itself: where no colour can
    // serve all of a colour's uses, Vex holds it to that (see tokens()).
    const inMode = (n, m) => {
      const v = D.absolute[n] || (D.semantic[n] && D.semantic[n][m === 'light' ? 1 : 0]) || D.primitive[n];
      return v ? this._parse(Array.isArray(v) ? v[D.modes.indexOf(m)] : v) : null;
    };
    for (const w of want) {
      const f = inMode(w.fg, w.ref);
      const fv = w.fa === null || w.fa === undefined ? f : { hex: f.hex, a: w.fa };
      const floors = D.floors.map(n => inMode(n, w.ref).hex);
      let bgs = floors;
      if (w.bg) {
        const b = inMode(w.bg, w.ref);
        const bv = w.ba === null || w.ba === undefined ? b : { hex: b.hex, a: w.ba };
        bgs = bv.a >= 1 ? [bv.hex] : floors.map(x => this._over(bv, x));
      }
      w.discord = Math.min(...bgs.map(b => ct.contrast(this._over(fv, b), b)));
    }
    return want;
  },

  // From a theme's colours (js/theme-custom.js's nine: background surface
  // text muted primary success warning danger border) to every colour
  // variable Discord's own CSS defines and uses (js/discord-tokens.js).
  // Returns { vars, modeVars, checks, light }: vars are Discord's theme
  // variables (the same in every Discord mode: a light Vex theme makes a
  // light Discord whichever mode Discord is in), modeVars its palette
  // colours its components use directly, per Discord mode; checks are every
  // text-on-background pairing Discord's rules make, after the fixes.
  tokens(colors) {
    const ct = this._ct(), D = this._data();
    const c = ct.complete(colors);
    const light = ct.isLight(c);
    const lab = (h) => ct.rgbToOklab(...ct.rgb(h));
    const vex = { axis: [c.background, c.muted, c.text].map(lab), brand: c.primary, danger: c.danger, success: c.success, warning: c.warning };
    const own = light ? 'light' : 'dark';
    const sem = {};
    for (const [n, vals] of Object.entries(D.semantic)) sem[n] = this._map(this._parse(vals[light ? 1 : 0]), D.axes[own], D.refs[own], vex, false);
    const prim = {};
    const bound = this._modeBound();
    const oi = D.modes.indexOf(own);
    D.modes.forEach((m, i) => {
      prim[m] = {};
      for (const [n, v] of Object.entries(D.primitive)) {
        prim[m][n] = bound.has(n)
          ? this._map(this._parse(Array.isArray(v) ? v[i] : v), D.axes[m], D.refs[m], vex, (m === 'light') !== light)
          : this._map(this._parse(Array.isArray(v) ? v[oi] : v), D.axes[own], D.refs[own], vex, false);
      }
    });
    const abs = {};
    for (const [n, v] of Object.entries(D.absolute)) abs[n] = this._parse(v);
    const { inks } = this._kinds(light);
    for (const n of inks) abs[n] = sem[n] = this._parse(D.semantic[n][light ? 1 : 0]);
    // A see-through black (a scrim behind a dialog, a shade over a picture)
    // stays black: it darkens what is under it in any theme.
    for (const [n, vals] of Object.entries(D.semantic)) if (/^#000000[0-9a-f]{2}$/.test(vals[light ? 1 : 0])) sem[n] = this._parse(vals[light ? 1 : 0]);
    const val = (n, m) => abs[n] || prim[m][n] || sem[n] || null;
    const want = this.pairings(light);
    // The surfaces never move (they are the theme), so each mode's set of
    // them is made once.
    const floorCache = {};
    const floorsOf = (m) => floorCache[m] || (floorCache[m] = [...new Set(D.floors.map(n => val(n, m).hex))]);
    const withAlpha = (v, a) => (a === null || a === undefined ? v : { hex: v.hex, a });
    const isAbs = (n) => Object.prototype.hasOwnProperty.call(abs, n);
    const owner = (n, m) => (prim[m][n] ? prim[m] : sem);
    const surfaces = new Set([...D.floors, ...D.layers]);
    const known = want.filter(w => val(w.fg, w.m) && (!w.bg || val(w.bg, w.m)));
    // The opaque colours a background stands for: the surfaces for text
    // drawn straight on them, a background itself, or a see-through one (a
    // hover or selection veil) over each surface.
    const bgsFor = (w, bgv) => {
      if (!w.bg) return floorsOf(w.m);
      const b = withAlpha(bgv, w.ba);
      return b.a >= 1 ? [b.hex] : floorsOf(w.m).map(f => this._over(b, f));
    };
    const worstOf = (fgv, bgs) => {
      let worst = Infinity, against = bgs[0];
      for (const b of bgs) { const r = ct.contrast(this._over(fgv, b), b); if (r < worst) { worst = r; against = b; } }
      return { worst, against };
    };
    // How well a pairing reads, as a share of what it needs (>= 1 is enough).
    // Relaxed, for a colour no lightness can serve in all its uses, it needs
    // 3:1 (the floor for large text and controls), or what Discord's own
    // colours give that pairing when that is less.
    const need = (w, relaxed) => (relaxed ? Math.min(w.min, w.discord, 3) : w.min);
    const score = (w, fgv, bgv, relaxed) => worstOf(withAlpha(fgv, w.fa), bgsFor(w, bgv)).worst / need(w, relaxed);
    // Each colour that can move (a theme variable once, a palette colour
    // once per Discord mode; never the surfaces, which are the theme, nor
    // Discord's fixed white and black), with every pairing it is in, as the
    // text or as what the text is drawn on.
    const keyOf = (n, m) => (owner(n, m) === sem ? n : n + '@' + m);
    const movable = (n) => !isAbs(n) && !surfaces.has(n);
    const roles = new Map();
    const add = (k, r) => { if (!roles.has(k)) roles.set(k, []); roles.get(k).push(r); };
    for (const w of known) {
      if (movable(w.fg)) add(keyOf(w.fg, w.m), { w, as: 'fg' });
      if (w.bg && movable(w.bg)) add(keyOf(w.bg, w.m), { w, as: 'bg' });
    }
    const conflicted = new Set();
    // Of those, the ones that cannot reach even the relaxed need (they read
    // as well as they can on all their uses at once).
    const impossible = new Set();
    // Move one colour's lightness, the least it can be, until every pairing
    // it is in reads. When no lightness can (Discord uses the same green as
    // text on the dark surfaces and under white text, and no colour is 4.5:1
    // from both), it takes the lightness that reads best on all of them, and
    // is remembered as a conflict.
    const settle = (k, bestEffort, only) => {
      const rs = only ? (roles.get(k) || []).filter(only) : roles.get(k);
      if (!rs || !rs.length) return;
      const { w, as } = rs[0];
      const n = as === 'fg' ? w.fg : w.bg;
      const store = owner(n, w.m);
      // The worst score over every pairing; it stops early once it is below
      // `floor` (that candidate can neither pass nor beat the best so far).
      const test = (cand, floor = -Infinity) => {
        let worst = Infinity;
        for (const r of rs) {
          const s = r.as === 'fg' ? score(r.w, cand, r.w.bg ? val(r.w.bg, r.w.m) : null, bestEffort) : score(r.w, val(r.w.fg, r.w.m), cand, bestEffort);
          if (s < worst) { worst = s; if (worst < floor) return worst; }
        }
        return worst;
      };
      const v = store[n];
      let best = v, bestScore = test(v);
      if (bestScore >= 0.999) { if (bestEffort) conflicted.add(k); return; }
      const [L, C, h] = ct.toOklch(v.hex);
      for (let step = 1; step <= 100; step++) {
        for (const dir of [-1, 1]) {
          const nl = L + dir * step * 0.01;
          if (nl < 0 || nl > 1) continue;
          const cand = { hex: ct.fromOklch(nl, C, h), a: v.a };
          const s = test(cand, bestScore);
          if (s >= 0.999) { store[n] = cand; if (bestEffort) conflicted.add(k); return; }
          if (s > bestScore) { best = cand; bestScore = s; }
        }
      }
      for (const ink of ['#ffffff', '#000000']) {
        const cand = { hex: ink, a: v.a };
        const s = test(cand, bestScore);
        if (s >= 0.999) { store[n] = cand; if (bestEffort) conflicted.add(k); return; }
        if (s > bestScore) { best = cand; bestScore = s; }
      }
      if (bestEffort) { store[n] = best; conflicted.add(k); impossible.add(k); }
    };
    const reads = (w) => score(w, val(w.fg, w.m), w.bg ? val(w.bg, w.m) : null) >= 0.999;
    // 1. A background under one of Discord's fixed inks (white text on a
    // button) moves until the ink reads; any other text on it follows below.
    const underInk = (r) => r.as === 'bg' && isAbs(r.w.fg);
    for (const k of new Set(known.filter(w => w.bg && isAbs(w.fg) && movable(w.bg)).map(w => keyOf(w.bg, w.m)))) settle(k, false, underInk);
    // 2. Every other text and icon colour moves until it reads on all it is
    // drawn on; the page's own text first reads on the page, whatever else
    // it is drawn on (the fills give way to it below).
    const texts = new Set(known.filter(w => movable(w.fg)).map(w => keyOf(w.fg, w.m)));
    const onPage = (r) => r.as === 'fg' && (!r.w.bg || surfaces.has(r.w.bg));
    for (const k of texts) settle(k, false, onPage);
    for (const k of texts) settle(k, false);
    // 3. Text that cannot read on every one of its backgrounds at once (the
    // same label on a grey hover and on a red or accent button): the
    // coloured background moves to suit it. What still cannot read takes the
    // best it can.
    for (let round = 0; round < 3; round++) {
      const bad = known.filter(w => !reads(w));
      if (!bad.length) break;
      // In the last round a fill gives way before the text does.
      for (const k of new Set(bad.filter(w => w.bg && movable(w.bg)).map(w => keyOf(w.bg, w.m)))) settle(k, round === 2);
      const still = bad.filter(w => !reads(w) && movable(w.fg));
      for (const k of new Set(still.map(w => keyOf(w.fg, w.m)))) settle(k, round === 2);
    }
    const checks = known.map((w) => {
      const fgv = withAlpha(val(w.fg, w.m), w.fa);
      const { worst, against } = worstOf(fgv, bgsFor(w, w.bg ? val(w.bg, w.m) : null));
      // A conflict: a colour that could not serve all its uses, or a pairing
      // of two of Discord's fixed colours (white on its see-through black)
      // over the theme's surfaces, where nothing can move.
      const conflict = worst < w.min - 0.005 && (conflicted.has(keyOf(w.fg, w.m)) || (!!w.bg && conflicted.has(keyOf(w.bg, w.m)))
        || (!movable(w.fg) && (!w.bg || !movable(w.bg))));
      const balanced = conflict && (impossible.has(keyOf(w.fg, w.m)) || (!!w.bg && impossible.has(keyOf(w.bg, w.m))));
      return {
        label: w.fg + ' on ' + (w.bg || 'the surfaces') + ' (' + w.m + ')', fg: fgv.hex, against,
        ratio: Math.round(worst * 100) / 100, min: w.min, discord: Math.round(w.discord * 100) / 100, conflict, balanced,
        // A conflict is held to 3:1, or what Discord itself gives that
        // pairing when that is less; one balanced between uses that cannot
        // all reach that, to BALANCED_FLOOR.
        ok: worst >= (balanced ? Math.min(need(w, true), this.BALANCED_FLOOR) : need(w, conflict)) - 0.01,
      };
    });
    const fmt = (n, v) => {
      if (n.endsWith('-hsl')) {
        const [h, s, l] = ct.toHsl(v.hex);
        return `${Math.round(h * 3600) / 10} ${Math.round(s * 1000) / 10}% ${Math.round(l * 1000) / 10}%`;
      }
      if (v.a >= 1) return v.hex;
      const [r, g, b] = ct.rgb(v.hex);
      return `rgb(${r} ${g} ${b} / ${Math.round(v.a * 1000) / 1000})`;
    };
    const vars = {};
    for (const [n, v] of Object.entries(sem)) vars[n] = fmt(n, v);
    const modeVars = {};
    for (const m of D.modes) { modeVars[m] = {}; for (const [n, v] of Object.entries(prim[m])) modeVars[m][n] = fmt(n, v); }
    return { vars, modeVars, checks, light };
  },

  // Discord's own variables are set on its .theme-dark / .theme-light /
  // .theme-darker / .theme-midnight elements (and again, more specific, for
  // high-contrast mode). This selector outranks both, on <html> and inside
  // it, and leaves people's Nitro profile themes alone.
  _modeSelector(m) { return `:root:root.theme-${m},\n:root:root .theme-${m}:not(.custom-user-profile-theme)`; },
  get SELECTOR() { return this._data().modes.map(m => this._modeSelector(m)).join(',\n'); },

  _cssValue(v) {
    if (/^#[0-9a-f]{6}$/.test(v) || /^rgb\(\d{1,3} \d{1,3} \d{1,3} \/ (0|1|0\.\d{1,3})\)$/.test(v)
      || /^\d{1,3}(\.\d)? \d{1,3}(\.\d)?% \d{1,3}(\.\d)?%$/.test(v)) return v;
    throw new Error('Refusing a Discord theme value: ' + v);
  },

  _block(selector, vars) {
    const body = Object.entries(vars).map(([k, v]) => {
      if (!/^--[a-z0-9_-]+$/i.test(k)) throw new Error('Refusing a Discord variable: ' + k);
      return `  ${k}: ${this._cssValue(v)} !important;`;
    }).join('\n');
    return `${selector} {\n${body}\n}\n`;
  },

  // The Vencord theme file for `colors`. `name` is the Vex theme's name, for
  // the header Vencord shows in its Themes list. Throws, naming them, when
  // some text could not be made to read.
  css(colors, name) {
    const { vars, modeVars, checks } = this.tokens(colors);
    // A palette colour balanced between uses that no colour can all serve
    // (see tokens()) reads as well as it can; anything else short is a bug.
    const bad = checks.filter(k => !k.ok && !k.balanced);
    if (bad.length) throw new Error('Some Discord text would not read in these colours: ' + bad.slice(0, 5).map(k => `${k.label} ${k.ratio}:1`).join('; '));
    const label = String(name || 'your theme').replace(/[^\w .+'-]/g, '').slice(0, 40) || 'your theme';
    let out = `/**\n * @name Vex theme match\n * @description Discord in the colours of the Vex theme "${label}". Written by Vex (Settings > Appearance > Match Discord to my Vex theme); turn that off to remove it.\n * @author Vex\n */\n`;
    out += this._block(this.SELECTOR, vars);
    for (const m of this._data().modes) out += this._block(this._modeSelector(m), modeVars[m]);
    return out;
  },

  // ---- what Discord should wear ---------------------------------------------

  // { link } for one of the 28, { css } for any other theme, null when off.
  plan(themeId) {
    if (!this.isOn()) return null;
    const id = themeId || (typeof ThemeManager !== 'undefined' ? ThemeManager.getCurrentTheme() : null);
    if (!id) throw new Error('No Vex theme to match');
    const real = this.realFor(id);
    if (real) return { link: real.url + this.LINK_MARK, theme: id };
    if (typeof ThemeStudio === 'undefined') throw new Error('The theme colours (js/theme-studio.js) are not loaded');
    const meta = typeof ThemeManager !== 'undefined' ? ThemeManager.getThemeMeta(id) : null;
    return { css: this.css(ThemeStudio.colorsFromTheme(id), meta ? meta.label : id), theme: id };
  },

  // The script run in the Discord page. It touches only Vex's own link (the
  // one ending in LINK_MARK) and Vex's own file (FILE) — except when the user
  // clicked "Pause my other themes while matching" (opts.pause), which takes
  // out their other enabled themes, links and QuickCSS and answers exactly
  // what it took, and the later opts.restore, which puts back exactly that.
  // It answers { ok, changed, others, paused } — others: the user's own
  // themes in force now ({ kind, id, name }), paused: what a pause took,
  // or { ok: false, reason: 'no-vencord' }.
  guestScript(plan, opts) {
    const want = { link: plan && plan.link ? plan.link : null, css: plan && typeof plan.css === 'string' ? plan.css : null };
    const act = { pause: !!(opts && opts.pause), restore: opts && opts.restore ? opts.restore : null };
    return `(async () => {
      const MARK = ${JSON.stringify(this.LINK_MARK)}, FILE = ${JSON.stringify(this.FILE)};
      const want = ${JSON.stringify(want)}, act = ${JSON.stringify(act)}, RE = ${JSON.stringify(this.GUEST_RE)};
      const until = Date.now() + ${Number(this.VENCORD_WAIT_MS)};
      const ready = () => window.Vencord && Vencord.Settings && window.VencordNative && VencordNative.themes;
      while (!ready()) {
        if (Date.now() > until) return { ok: false, reason: 'no-vencord' };
        await new Promise(r => setTimeout(r, 250));
      }
      const S = Vencord.Settings, T = VencordNative.themes;
      const oldLinks = Array.from(S.themeLinks || []);
      let links = oldLinks.filter(l => !String(l).endsWith(MARK));
      if (want.link) links.push(want.link);
      const oldThemes = Array.from(S.enabledThemes || []);
      let themes = oldThemes.filter(t => t !== FILE);
      // What the user's own QuickCSS does to colours (a colour or background
      // property, or a custom property given a colour).
      const quickCssColours = async () => {
        if (!S.useQuickCss || !VencordNative.quickCss || typeof VencordNative.quickCss.get !== 'function') return false;
        const css = String(await VencordNative.quickCss.get() || '').replace(new RegExp(RE.comment, 'g'), '');
        return new RegExp(RE.colour, 'i').test(css);
      };
      const wasQuick = !!S.useQuickCss;
      let quick = wasQuick, paused = null;
      if (act.restore) {
        const r = act.restore;
        themes = (r.themes || []).filter(t => t !== FILE && !themes.includes(t)).concat(themes);
        links = (r.links || []).filter(l => !String(l).endsWith(MARK) && !links.includes(l)).concat(links);
        if (r.quickCss) quick = true;
      }
      if (act.pause) {
        const hadColours = await quickCssColours();
        paused = { themes: themes.slice(), links: links.filter(l => !String(l).endsWith(MARK)), quickCss: hadColours };
        themes = [];
        links = links.filter(l => String(l).endsWith(MARK));
        if (hadColours) quick = false;
      }
      const had = await T.getThemeData(FILE);
      let changed = false;
      if (want.css !== null) {
        if (had !== want.css) { await T.uploadTheme(FILE, want.css); changed = true; }
        themes.push(FILE);
      } else if (had != null) {
        await T.deleteTheme(FILE); changed = true;
      }
      if (JSON.stringify(links) !== JSON.stringify(oldLinks)) { S.themeLinks = links; changed = true; }
      if (quick !== wasQuick) { S.useQuickCss = quick; changed = true; }
      // A new array even when only the file's text changed: that is what
      // makes Vencord read the file again.
      if (changed || JSON.stringify(themes) !== JSON.stringify(oldThemes)) S.enabledThemes = themes;
      // The user's own themes still in force, by the name they gave them.
      const list = typeof T.getThemesList === 'function' ? await T.getThemesList() : [];
      const others = [];
      for (const t of themes) {
        if (t === FILE) continue;
        const e = Array.isArray(list) ? list.find(x => x && x.fileName === t) : null;
        others.push({ kind: 'theme', id: t, name: (e && e.name) || String(t).replace(new RegExp(RE.ext, 'i'), '') });
      }
      for (const l of links) {
        if (String(l).endsWith(MARK)) continue;
        const url = String(l).replace(new RegExp(RE.prefix, 'i'), '');
        const seg = url.split('#')[0].split('?')[0].split('/').filter(Boolean).pop() || url;
        others.push({ kind: 'link', id: String(l), name: seg.replace(new RegExp(RE.ext, 'i'), '') });
      }
      if (quick && await quickCssColours()) others.push({ kind: 'quickcss', id: 'quickcss', name: 'QuickCSS' });
      return { ok: true, changed, others, paused };
    })()`;
  },

  // ---- the Discord pages ----------------------------------------------------

  isDiscordUrl(url) { return /^https:\/\/([a-z0-9-]+\.)?discord\.com\//i.test(String(url || '')); },

  // Every Discord page in this window: the panel, and Discord as a tab.
  pages() {
    const out = [];
    const sb = (typeof SidebarManager !== 'undefined') ? SidebarManager : null;
    if (sb && sb.panelWebviews && sb.panelWebviews.discord) out.push(sb.panelWebviews.discord);
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined' && WebviewManager.webviews) {
      for (const t of TabManager.tabs || []) {
        if (t.partition !== 'persist:discord' || !this.isDiscordUrl(t.url)) continue;
        const wv = WebviewManager.webviews.get(t.id);
        if (wv && !out.includes(wv)) out.push(wv);
      }
    }
    return out;
  },

  _url(wv) { return typeof vexGuestUrl === 'function' ? vexGuestUrl(wv) : (typeof window !== 'undefined' && window.vexGuestUrl ? window.vexGuestUrl(wv) : ''); },

  // Bring one Discord page to what it should wear. Resolves to the page's
  // answer; null when the page is not Discord.
  async applyTo(wv, plan, opts) {
    if (!this.isDiscordUrl(this._url(wv))) return null;
    if (plan === undefined) plan = this.plan();
    // Off: whatever a pause took comes back, along with Vex's entries going.
    const record = plan ? null : this.paused();
    const o = { ...(opts || {}) };
    if (record) o.restore = record;
    const r = await window.vexGuestEval(wv, this.guestScript(plan, o), false, this.VENCORD_WAIT_MS + 8000);
    if (r && r.ok) {
      try { if (plan) localStorage.setItem(this.APPLIED_KEY, '1'); else localStorage.removeItem(this.APPLIED_KEY); } catch {}
      if (record) localStorage.removeItem(this.PAUSED_KEY);
      if (r.paused) this._remember(r.paused);
    }
    this.lastResult = r;
    return r;
  },

  // What a pause took, as recorded (null: nothing is paused).
  paused() {
    let raw = null;
    try { raw = localStorage.getItem(this.PAUSED_KEY); } catch {}
    return raw ? JSON.parse(raw) : null;
  },

  // Keep what a pause took, with anything an earlier pause took.
  _remember(p) {
    const old = this.paused() || { themes: [], links: [], quickCss: false };
    const uniq = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    const rec = { themes: uniq(old.themes, p.themes), links: uniq(old.links, p.links), quickCss: !!(old.quickCss || p.quickCss) };
    if (!rec.themes.length && !rec.links.length && !rec.quickCss) return;
    localStorage.setItem(this.PAUSED_KEY, JSON.stringify(rec));
  },

  // The user's own themes that are also on (from the last Discord page that
  // answered), as { kind, id, name }.
  others: [],

  othersMessage() {
    const names = this.others.map(o => "'" + o.name + "'");
    if (!names.length) return '';
    return names.length === 1
      ? 'Your own Discord theme ' + names[0] + ' is also on; the colours may clash.'
      : 'Your own Discord themes ' + names.join(', ') + ' are also on; the colours may clash.';
  },

  // The button: take the user's own themes out while matching is on. They
  // are put back, exactly, when matching turns off.
  async pauseOthers() {
    if (!this.isOn()) throw new Error('Match Discord to my Vex theme is off');
    const plan = this.plan();
    let answered = false;
    for (const wv of this.pages()) {
      const r = await this.applyTo(wv, plan, { pause: true });
      if (r && r.ok) { answered = true; this.others = r.others || []; }
    }
    if (!answered) throw new Error('Open Discord (with Vencord running) to pause your other themes');
    this._renderState();
    return this.paused();
  },

  _announceOthers() {
    if (!this.others.length || typeof window.showToast !== 'function') return;
    window.showToast(this.othersMessage(), 'info', 15000, {
      action: {
        label: 'Pause my other themes while matching',
        run: () => this.pauseOthers().then(
          () => window.showToast?.('Your other Discord themes are paused until matching is turned off'),
          (err) => window.showToast?.('Not paused: ' + err.message, 'error')),
      },
    });
  },

  _chain: Promise.resolve(),
  _queued: false,
  // Every open Discord page, one run at a time; changes while one runs are
  // folded into the next.
  applyAll() {
    if (this._queued) return this._chain;
    this._queued = true;
    const run = this._chain.then(async () => {
      this._queued = false;
      const plan = this.plan();
      const out = [];
      for (const wv of this.pages()) {
        try {
          const r = await this.applyTo(wv, plan);
          if (r && r.ok) this.others = plan ? (r.others || []) : [];
          out.push(r);
        }
        catch (err) {
          console.error('[DiscordTheme] could not update Discord:', err);
          window.VexProblems?.note('Discord theme', 'Discord could not be given the Vex theme', err);
          out.push({ ok: false, reason: 'error', error: err.message });
        }
      }
      this._renderState();
      return out;
    });
    // A run that failed (a theme whose colours cannot be worked out) says so to
    // whoever asked, and must not end the chain: every later change would
    // otherwise be skipped for the rest of the session.
    this._chain = run.catch(() => {});
    return run;
  },

  // A Discord page finished loading (js/sidebar.js's panel, js/webview.js's
  // tab): give it the theme, or take Vex's away if the switch went off while
  // it was closed.
  onPageReady(wv) {
    if (!this.isDiscordUrl(this._url(wv))) return;
    let applied = false;
    try { applied = localStorage.getItem(this.APPLIED_KEY) === '1'; } catch {}
    if (!this.isOn() && !applied && !this.paused()) return;
    this.applyTo(wv).then(() => this._renderState(), (err) => {
      console.error('[DiscordTheme] could not update Discord:', err);
      window.VexProblems?.note('Discord theme', 'Discord could not be given the Vex theme', err);
    });
  },

  // Is a Vencord build installed in Vex? (Discord may not be open to ask.)
  async vencordInstalled() {
    if (!window.vex || typeof window.vex.extensionsList !== 'function') throw new Error('The extension list is not available in this window');
    const list = await window.vex.extensionsList();
    return Array.isArray(list) && list.some(e => /^vencord-/.test(e.folder || '') && e.enabled !== false);
  },

  // The switch. Turning it on without Vencord offers the one-click install.
  async setOn(on) {
    if (on) {
      if (!(await this.vencordInstalled())) {
        const ok = await window.vexConfirm({
          title: 'Discord needs Vencord for this',
          message: 'Vex changes how Discord looks through Vencord, the Discord mod that runs inside Vex\'s Discord. It is not installed yet. Install it now (a download from Vencord\'s GitHub releases) and turn this on?',
          okLabel: 'Install Vencord',
          cancelLabel: 'Not now',
        });
        if (!ok) return false;
        const sb = (typeof SidebarManager !== 'undefined') ? SidebarManager : null;
        if (!sb || typeof sb.installVencord !== 'function') throw new Error('The Vencord installer is not available in this window');
        const installed = await sb.installVencord();
        if (!installed) return false;
      }
      localStorage.setItem(this.KEY, 'on');
    } else {
      localStorage.removeItem(this.KEY);
    }
    await this.applyAll();
    if (this.isOn()) this._announceOthers();
    else this.others = [];
    return this.isOn();
  },

  // ---- Settings › Appearance ------------------------------------------------

  describe(themeId) {
    const id = themeId || (typeof ThemeManager !== 'undefined' ? ThemeManager.getCurrentTheme() : '');
    const real = this.realFor(id);
    if (real) return `the real ${real.name} theme, loaded from ${new URL(real.url).host}`;
    const meta = typeof ThemeManager !== 'undefined' ? ThemeManager.getThemeMeta(id) : null;
    return `the colours of ${meta ? meta.label : id}`;
  },

  _renderState() {
    const el = typeof document !== 'undefined' ? document.getElementById('discord-theme-state') : null;
    if (!el) return;
    const r = this.lastResult;
    this._renderOthers();
    if (!this.isOn()) { el.textContent = 'Off — Discord keeps its own look (and any Vencord themes of your own).'; return; }
    if (r && r.ok === false && r.reason === 'no-vencord') { el.textContent = 'Vencord is not running in Discord — install it from the Discord button\'s right-click menu, then reload Discord.'; return; }
    el.textContent = 'Now: Discord wears ' + this.describe() + '.';
  },

  // Settings row: the user's own themes that are also on, with the button,
  // and what is paused.
  _renderOthers() {
    const el = typeof document !== 'undefined' ? document.getElementById('discord-theme-others') : null;
    if (!el) return;
    el.textContent = '';
    const paused = this.paused();
    if (this.isOn() && this.others.length) {
      const p = document.createElement('div');
      p.textContent = this.othersMessage();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-secondary';
      b.id = 'discord-theme-pause';
      b.style.marginTop = '6px';
      b.textContent = 'Pause my other themes while matching';
      b.addEventListener('click', () => {
        b.disabled = true;
        this.pauseOthers().then(() => window.showToast?.('Your other Discord themes are paused until matching is turned off'), (err) => {
          b.disabled = false;
          window.showToast?.('Not paused: ' + err.message, 'error');
        });
      });
      el.append(p, b);
    } else if (paused) {
      const n = paused.themes.length + paused.links.length + (paused.quickCss ? 1 : 0);
      el.textContent = 'Your own Discord themes (' + n + ') are paused while matching is on, and come back when it is turned off.';
    }
  },

  renderSetting(host) {
    host = host || (typeof document !== 'undefined' ? document.getElementById('discord-theme-setting') : null);
    if (!host) return;
    host.innerHTML = `
      <div class="setting-toggle-row">
        <span>Match Discord to my Vex theme<br><span style="font-size:11.5px;color:var(--text-muted)">Discord in Vex (the panel or a tab) takes on your colour theme through Vencord, and changes with it. A theme named after a BetterDiscord theme loads that real theme: Discord downloads its CSS from the theme's own site (GitHub Pages, or jsDelivr for a few) — a request you did not click. Any other theme is coloured by Vex, nothing downloaded. Your own Vencord themes and QuickCSS are kept; off removes only what Vex added. Needs Vencord.</span></span>
        <label class="toggle" style="flex-shrink:0"><input type="checkbox" id="setting-discord-theme" aria-label="Match Discord to my Vex theme"><span class="toggle-slider"></span></label>
      </div>
      <div id="discord-theme-state" role="status" style="font-size:11.5px;color:var(--text-muted);margin-top:4px"></div>
      <div id="discord-theme-others" role="status" style="font-size:11.5px;color:var(--text-muted);margin-top:4px"></div>`;
    const box = host.querySelector('#setting-discord-theme');
    box.checked = this.isOn();
    box.addEventListener('change', () => {
      const want = box.checked;
      this.setOn(want).then((now) => {
        box.checked = now;
        this._renderState();
        if (want && now) window.showToast?.('Discord now follows your Vex theme');
      }, (err) => {
        box.checked = this.isOn();
        window.showToast?.('Discord theme not changed — ' + err.message, 'error');
      });
    });
    this._renderState();
  },

  init() {
    document.addEventListener('theme-changed', () => {
      if (!this.isOn()) return;
      this.applyAll().catch(err => console.error('[DiscordTheme] could not update Discord:', err));
    });
  },
};

if (typeof window !== 'undefined') {
  window.DiscordTheme = DiscordTheme;
  if (typeof document !== 'undefined') DiscordTheme.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordTheme };
