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
//     written from the theme's colours onto Discord's own colour variables
//     with every text colour checked to 4.5:1, and switched on in Vencord's
//     Local Themes (enabledThemes).
//
// Only Vex's own entry is ever added, changed or removed: the user's links,
// their other theme files and their QuickCSS are left exactly as they are.
// Vencord re-reads themeLinks and enabledThemes the moment they change, so a
// theme change (or Light and dark switching) shows in Discord at once, with
// no reload. Turned off, Vex's entries are removed the same way — at once in
// an open Discord, or the next time Discord loads.

const DiscordTheme = {
  KEY: 'vex.discordMatchTheme',              // 'on' | anything else = off (the default)
  APPLIED_KEY: 'vex.discordMatchApplied',    // '1' while Discord may still hold Vex's entries
  FILE: 'vex-theme-match.css',
  LINK_MARK: '#vex-theme-match',
  MIN_CONTRAST: 4.5,
  // How long a Discord page is given for Vencord to start.
  VENCORD_WAIT_MS: 15000,

  // Vex theme id -> the real BetterDiscord theme it is named after. url is the
  // theme's own published CSS (checked: 200, text/css), loaded by Discord.
  REAL: {},
  // Of the 28, the ones coloured by Vex instead, and why (no stable official
  // link, or a licence that does not allow it).
  GENERATED_INSTEAD: {},

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

  // `fg` moved in lightness, the least it can be, until it reads at
  // MIN_CONTRAST on every one of `bgs`. Throws when no lightness can.
  _readable(fg, bgs) {
    const ct = this._ct();
    const worst = (c) => Math.min(...bgs.map(b => ct.contrast(c, b)));
    if (worst(fg) >= this.MIN_CONTRAST) return fg;
    const [h, s, l] = ct.toHsl(fg);
    for (let step = 1; step <= 200; step++) {
      for (const dir of [-1, 1]) {
        const nl = l + dir * step * 0.005;
        if (nl < 0 || nl > 1) continue;
        const cand = ct.fromHsl(h, s, nl);
        if (worst(cand) >= this.MIN_CONTRAST) return cand;
      }
    }
    for (const ink of ['#ffffff', '#000000']) if (worst(ink) >= this.MIN_CONTRAST) return ink;
    throw new Error('No text colour reads on these backgrounds: ' + bgs.join(', '));
  },

  // From a theme's colours (js/theme-custom.js's nine: background surface
  // text muted primary success warning danger border) to Discord's colour
  // variables. Returns { vars, checks, light }: checks lists every text
  // colour against what it is drawn on.
  tokens(colors) {
    const ct = this._ct();
    const c = ct.complete(colors);
    const light = ct.isLight(c);
    const bg = c.background, surf = c.surface;
    // Discord's ladder, darkest to lightest in dark mode: the server rail,
    // the channel list, the chat, then popouts and modals above it.
    const lowest = light ? ct.mix(bg, c.text, 0.08) : ct.mix(bg, '#000000', 0.3);
    const lower = light ? ct.mix(bg, c.text, 0.04) : ct.mix(bg, '#000000', 0.15);
    const higher = ct.mix(surf, c.text, 0.04);
    const highest = ct.mix(surf, c.text, 0.08);
    const floors = [lowest, lower, bg, surf, higher, highest];
    const text = this._readable(c.text, floors);
    const strong = this._readable(light ? ct.mix(text, '#000000', 0.4) : ct.mix(text, '#ffffff', 0.4), floors);
    const muted = this._readable(c.muted, floors);
    const subtle = this._readable(ct.mix(text, muted, 0.5), floors);
    const link = this._readable(c.primary, [lowest, lower, bg, surf, higher]);
    // The accent as a button: white or black text, whichever reads; the
    // button itself darkened or lightened until it does.
    let button = c.primary, onButton;
    const pickInk = (b) => (ct.contrast('#ffffff', b) >= ct.contrast('#000000', b) ? '#ffffff' : '#000000');
    onButton = pickInk(button);
    if (ct.contrast(onButton, button) < this.MIN_CONTRAST) {
      const [h, s, l] = ct.toHsl(button);
      const dir = onButton === '#ffffff' ? -1 : 1;
      for (let step = 1; step <= 200 && ct.contrast(onButton, button) < this.MIN_CONTRAST; step++) button = ct.fromHsl(h, s, Math.max(0, Math.min(1, l + dir * step * 0.005)));
    }
    const buttonHover = ct.mix(button, onButton === '#ffffff' ? '#000000' : '#ffffff', 0.1);
    const buttonActive = ct.mix(button, onButton === '#ffffff' ? '#000000' : '#ffffff', 0.2);
    const success = this._readable(c.success, [lowest, lower, bg, surf]);
    const warning = this._readable(c.warning, [lowest, lower, bg, surf]);
    const danger = this._readable(c.danger, [lowest, lower, bg, surf]);
    const [tr, tg, tb] = ct.rgb(text);
    const veil = (a) => `rgb(${tr} ${tg} ${tb} / ${a})`;
    const [pr, pg, pb] = ct.rgb(button);
    const tint = (a) => `rgb(${pr} ${pg} ${pb} / ${a})`;
    const vars = {
      // backgrounds
      '--background-base-lowest': lowest, '--background-base-lower': lower, '--background-base-low': bg,
      '--background-surface-high': surf, '--background-surface-higher': higher, '--background-surface-highest': highest,
      '--background-secondary-alt': lower, '--background-accent': button, '--background-brand': button,
      '--app-frame-background': lowest, '--panel-bg': lower, '--channel-background-default': lower,
      '--chat-background': bg, '--chat-background-default': bg, '--channeltextarea-background': surf,
      '--bg-surface-raised': surf, '--card-background-default': surf,
      '--modal-background': surf, '--modal-footer-background': higher,
      // hover and selection veils, from the text colour so they show on any floor
      '--background-mod-muted': veil(0.04), '--background-mod-subtle': veil(0.08),
      '--background-mod-normal': veil(0.12), '--background-mod-strong': veil(0.16),
      '--interactive-background-default': veil(0.04), '--interactive-background-hover': veil(0.08),
      '--interactive-background-active': veil(0.12), '--interactive-background-selected': veil(0.16),
      '--message-background-hover': veil(0.04),
      // text and icons
      '--text-default': text, '--text-strong': strong, '--text-subtle': subtle, '--text-muted': muted,
      '--text-invert': bg, '--text-brand': link, '--text-link': link,
      '--text-feedback-positive': success, '--text-feedback-warning': warning, '--text-feedback-critical': danger,
      '--channels-default': subtle, '--channel-icon': muted, '--chat-text-muted': muted,
      '--channel-text-area-placeholder': muted, '--input-placeholder-text-default': muted, '--input-text-default': text,
      '--interactive-text-default': subtle, '--interactive-text-hover': text, '--interactive-text-active': strong,
      '--interactive-icon-default': subtle, '--interactive-icon-hover': text, '--interactive-icon-active': strong,
      '--icon-default': text, '--icon-strong': strong, '--icon-subtle': subtle, '--icon-muted': muted,
      '--icon-brand': link, '--icon-link': link,
      '--mention-foreground': link, '--control-brand-foreground': link, '--control-brand-foreground-new': link,
      // the accent
      '--brand-500': button, '--brand-560': buttonHover, '--brand-600': buttonActive,
      '--control-primary-background-default': button, '--control-primary-background-hover': buttonHover,
      '--control-primary-background-active': buttonActive,
      '--control-primary-text-default': onButton, '--control-primary-text-hover': onButton, '--control-primary-text-active': onButton,
      '--control-primary-icon-default': onButton, '--control-primary-icon-hover': onButton, '--control-primary-icon-active': onButton,
      '--interactive-accent-background-hover': button, '--interactive-accent-background-selected': button,
      '--interactive-accent-background-active': buttonActive,
      '--badge-background-brand': button, '--badge-text-brand': onButton,
      '--input-border-active': button, '--border-focus': button,
      '--mention-background': tint(0.24), '--message-highlight-background-default': tint(0.16),
      '--message-highlight-background-hover': tint(0.12),
      '--scrollbar-auto-thumb': c.border, '--scrollbar-thin-thumb': c.border,
    };
    const named = { [lowest]: 'the server list', [lower]: 'the channel list', [bg]: 'the chat', [surf]: 'popouts', [higher]: 'raised popouts', [highest]: 'the highest popouts' };
    const pairs = [
      ['Text', text, floors], ['Strong text', strong, floors], ['Muted text', muted, floors],
      ['Channel names', subtle, floors], ['Links and the accent as text', link, [lowest, lower, bg, surf, higher]],
      ['Text on the accent', onButton, [button, buttonHover, buttonActive]],
      ['Success', success, [lowest, lower, bg, surf]], ['Warning', warning, [lowest, lower, bg, surf]], ['Danger', danger, [lowest, lower, bg, surf]],
    ];
    const checks = pairs.map(([label, fg, on]) => {
      let worst = Infinity, against = on[0];
      for (const b of on) { const r = ct.contrast(fg, b); if (r < worst) { worst = r; against = b; } }
      return { label, fg, against, againstName: named[against] || against, ratio: Math.round(worst * 100) / 100, ok: worst >= this.MIN_CONTRAST };
    });
    return { vars, checks, light };
  },

  // Discord's own variables are set on its .theme-dark / .theme-light /
  // .theme-darker / .theme-midnight elements (and again, more specific, for
  // high-contrast mode). This selector outranks both, on <html> and inside
  // it, and leaves people's Nitro profile themes alone.
  SELECTOR: [':root:root.theme-dark', ':root:root.theme-light', ':root:root.theme-darker', ':root:root.theme-midnight',
    ':root:root .theme-dark:not(.custom-user-profile-theme)', ':root:root .theme-light:not(.custom-user-profile-theme)',
    ':root:root .theme-darker:not(.custom-user-profile-theme)', ':root:root .theme-midnight:not(.custom-user-profile-theme)'].join(',\n'),

  _cssValue(v) {
    if (/^#[0-9a-f]{6}$/.test(v) || /^rgb\(\d{1,3} \d{1,3} \d{1,3} \/ 0\.\d{1,2}\)$/.test(v)) return v;
    throw new Error('Refusing a Discord theme value: ' + v);
  },

  // The Vencord theme file for `colors`. `name` is the Vex theme's name, for
  // the header Vencord shows in its Themes list.
  css(colors, name) {
    const { vars } = this.tokens(colors);
    const label = String(name || 'your theme').replace(/[^\w .+'-]/g, '').slice(0, 40) || 'your theme';
    const body = Object.entries(vars).map(([k, v]) => {
      if (!/^--[a-z0-9-]+$/.test(k)) throw new Error('Refusing a Discord variable: ' + k);
      return `  ${k}: ${this._cssValue(v)} !important;`;
    }).join('\n');
    return `/**\n * @name Vex theme match\n * @description Discord in the colours of the Vex theme "${label}". Written by Vex (Settings > Appearance > Match Discord to my Vex theme); turn that off to remove it.\n * @author Vex\n */\n${this.SELECTOR} {\n${body}\n}\n`;
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
  // one ending in LINK_MARK) and Vex's own file (FILE); it answers
  // { ok, changed } or { ok: false, reason: 'no-vencord' }.
  guestScript(plan) {
    const want = { link: plan && plan.link ? plan.link : null, css: plan && typeof plan.css === 'string' ? plan.css : null };
    return `(async () => {
      const MARK = ${JSON.stringify(this.LINK_MARK)}, FILE = ${JSON.stringify(this.FILE)};
      const want = ${JSON.stringify(want)};
      const until = Date.now() + ${Number(this.VENCORD_WAIT_MS)};
      const ready = () => window.Vencord && Vencord.Settings && window.VencordNative && VencordNative.themes;
      while (!ready()) {
        if (Date.now() > until) return { ok: false, reason: 'no-vencord' };
        await new Promise(r => setTimeout(r, 250));
      }
      const S = Vencord.Settings, T = VencordNative.themes;
      const oldLinks = Array.from(S.themeLinks || []);
      const links = oldLinks.filter(l => !String(l).endsWith(MARK));
      if (want.link) links.push(want.link);
      const oldThemes = Array.from(S.enabledThemes || []);
      const themes = oldThemes.filter(t => t !== FILE);
      const had = await T.getThemeData(FILE);
      let changed = false;
      if (want.css !== null) {
        if (had !== want.css) { await T.uploadTheme(FILE, want.css); changed = true; }
        themes.push(FILE);
      } else if (had != null) {
        await T.deleteTheme(FILE); changed = true;
      }
      if (JSON.stringify(links) !== JSON.stringify(oldLinks)) { S.themeLinks = links; changed = true; }
      // A new array even when only the file's text changed: that is what
      // makes Vencord read the file again.
      if (changed || JSON.stringify(themes) !== JSON.stringify(oldThemes)) S.enabledThemes = themes;
      return { ok: true, changed };
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
  async applyTo(wv, plan) {
    if (!this.isDiscordUrl(this._url(wv))) return null;
    if (plan === undefined) plan = this.plan();
    const r = await window.vexGuestEval(wv, this.guestScript(plan), false, this.VENCORD_WAIT_MS + 8000);
    if (r && r.ok) {
      try { if (plan) localStorage.setItem(this.APPLIED_KEY, '1'); else localStorage.removeItem(this.APPLIED_KEY); } catch {}
    }
    this.lastResult = r;
    return r;
  },

  _chain: Promise.resolve(),
  _queued: false,
  // Every open Discord page, one run at a time; changes while one runs are
  // folded into the next.
  applyAll() {
    if (this._queued) return this._chain;
    this._queued = true;
    this._chain = this._chain.then(async () => {
      this._queued = false;
      const plan = this.plan();
      const out = [];
      for (const wv of this.pages()) {
        try { out.push(await this.applyTo(wv, plan)); }
        catch (err) {
          console.error('[DiscordTheme] could not update Discord:', err);
          window.VexProblems?.note('Discord theme', 'Discord could not be given the Vex theme', err);
          out.push({ ok: false, reason: 'error', error: err.message });
        }
      }
      this._renderState();
      return out;
    });
    return this._chain;
  },

  // A Discord page finished loading (js/sidebar.js's panel, js/webview.js's
  // tab): give it the theme, or take Vex's away if the switch went off while
  // it was closed.
  onPageReady(wv) {
    if (!this.isDiscordUrl(this._url(wv))) return;
    let applied = false;
    try { applied = localStorage.getItem(this.APPLIED_KEY) === '1'; } catch {}
    if (!this.isOn() && !applied) return;
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
    if (!this.isOn()) { el.textContent = 'Off — Discord keeps its own look (and any Vencord themes of your own).'; return; }
    if (r && r.ok === false && r.reason === 'no-vencord') { el.textContent = 'Vencord is not running in Discord — install it from the Discord button\'s right-click menu, then reload Discord.'; return; }
    el.textContent = 'Now: Discord wears ' + this.describe() + '.';
  },

  renderSetting(host) {
    host = host || (typeof document !== 'undefined' ? document.getElementById('discord-theme-setting') : null);
    if (!host) return;
    host.innerHTML = `
      <div class="setting-toggle-row">
        <span>Match Discord to my Vex theme<br><span style="font-size:11.5px;color:var(--text-muted)">Discord in Vex (the panel or a tab) takes on your colour theme through Vencord, and changes with it. A theme named after a BetterDiscord theme loads that real theme: Discord downloads its CSS from the theme's own site (GitHub Pages or its author's site) — a request you did not click. Any other theme is coloured by Vex, nothing downloaded. Your own Vencord themes and QuickCSS are kept; off removes only what Vex added. Needs Vencord.</span></span>
        <label class="toggle" style="flex-shrink:0"><input type="checkbox" id="setting-discord-theme" aria-label="Match Discord to my Vex theme"><span class="toggle-slider"></span></label>
      </div>
      <div id="discord-theme-state" role="status" style="font-size:11.5px;color:var(--text-muted);margin-top:4px"></div>`;
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
