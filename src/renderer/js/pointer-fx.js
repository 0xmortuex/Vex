// === A cursor of your own, and a little something when you click ==============
// vex-layer-exempt: the click-effect layer is pointer-events:none and never takes a click
//
// Two optional, off-by-default features that change how the pointer looks in Vex's own screens and on the New Tab page:
//
//   VexCursor   Settings > Mouse cursor. A cursor drawn in a shape, colour and size you choose, in place of the system arrow.
//   VexClickFx  Settings > Click effect. A short animation where you click: fireflies, ripples, confetti or a shockwave,
//               or "Surprise me", which picks a different one each click.
//
// Both are drawn by this file and only by this file: no image is downloaded, nothing is sent anywhere.
//
// What they do NOT reach, said plainly in Settings too: a website is a document of its own that Vex cannot style from the
// outside, so a page keeps its own cursors and shows no click effect. The New Tab page is Vex's own and is handed the choice
// (VexPointerFx.paintStartPages, and when a New Tab page loads, js/webview.js).
//
// The click effect stays still when "Reduce motion" is on in Vex or in Windows, in a hidden window, and while Game mode holds
// the interface still.
(function () {
  const store = {
    // A saved choice that cannot be read is ignored (the feature stays off), and said, not hidden.
    get(key) {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); }
      catch (err) {
        if (typeof VexProblems !== 'undefined') VexProblems.note('Pointer effects', 'a saved choice could not be read and is ignored', err);
        else console.error('[pointer-fx] a saved choice could not be read and is ignored:', err && err.message);
        return null;
      }
    },
    set(key, value) {
      try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); }
      catch (err) { throw new Error('Could not save that choice: ' + (err && err.message)); }
    },
  };

  // Words on the Settings screen are found through the app's dictionary (js/i18n-ui.js); the ones built here, in a function, go
  // through this so a Turkish Vex is Turkish all the way down.
  const L = (s) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup && VexI18nUI.lookup(s)) || s;

  // ---------------------------------------------------------------------------------------------------------------------
  const VexCursor = {
    KEY: 'vex.cursor',
    STYLES: ['arrow', 'dot', 'ring', 'cross', 'star'],
    NAMES: { arrow: 'Arrow', dot: 'Dot', ring: 'Ring', cross: 'Crosshair', star: 'Star' },
    COLORS: ['#ffffff', '#111111', '#6366f1', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#ec4899'],
    SIZES: { small: 24, medium: 32, large: 48 },
    STYLE_ID: 'vex-cursor-css',

    // null while it is off (the default), else { style, color, size }.
    read() {
      const v = store.get(this.KEY);
      if (!v || !this.STYLES.includes(v.style)) return null;
      return {
        style: v.style,
        color: /^#[0-9a-f]{6}$/i.test(String(v.color)) ? String(v.color).toLowerCase() : this.COLORS[2],
        size: this.SIZES[v.size] ? v.size : 'medium',
      };
    },
    enabled() { return !!this.read(); },
    save(choice) {
      if (!choice) { store.set(this.KEY, null); }
      else {
        if (!this.STYLES.includes(choice.style)) throw new Error('There is no cursor called "' + choice.style + '"');
        store.set(this.KEY, { style: choice.style, color: choice.color, size: choice.size });
      }
      this.apply();
      if (typeof VexPointerFx !== 'undefined') VexPointerFx.paintStartPages();
    },
    setEnabled(on) { this.save(on ? (this.read() || { style: 'arrow', color: this.COLORS[2], size: 'medium' }) : null); return !!on; },

    _outline(hex) {
      const n = parseInt(hex.slice(1), 16);
      const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
      return lum > 0.6 ? '#111111' : '#ffffff';
    },
    _starPath() {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 5.2 : 12, a = -Math.PI / 2 + i * Math.PI / 5;
        pts.push((16 + r * Math.cos(a)).toFixed(2) + ' ' + (16 + r * Math.sin(a)).toFixed(2));
      }
      return 'M' + pts.join('L') + 'Z';
    },

    // One cursor: { url, x, y }. `over` swaps fill and outline, the look it takes over something you can click.
    image(choice, over) {
      const fill = over ? this._outline(choice.color) : choice.color;
      const edge = over ? choice.color : this._outline(choice.color);
      const px = this.SIZES[choice.size];
      const shapes = {
        arrow: `<path d="M5 3 L5 24 L10.5 18.8 L14.2 27.5 L17.6 26 L13.9 17.5 L21.5 17.5 Z" fill="${fill}" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/>`,
        dot: `<circle cx="16" cy="16" r="7" fill="${fill}" stroke="${edge}" stroke-width="2"/>`,
        ring: `<circle cx="16" cy="16" r="9" fill="none" stroke="${edge}" stroke-width="5.5"/><circle cx="16" cy="16" r="9" fill="none" stroke="${fill}" stroke-width="2.8"/><circle cx="16" cy="16" r="1.6" fill="${fill}" stroke="${edge}" stroke-width="1"/>`,
        cross: `<path d="M16 3.5V28.5M3.5 16H28.5" stroke="${edge}" stroke-width="5" stroke-linecap="round"/><path d="M16 3.5V28.5M3.5 16H28.5" stroke="${fill}" stroke-width="2.2" stroke-linecap="round"/>`,
        star: `<path d="${this._starPath()}" fill="${fill}" stroke="${edge}" stroke-width="1.8" stroke-linejoin="round"/>`,
      };
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">${shapes[choice.style]}</svg>`;
      const hot = choice.style === 'arrow' ? [5, 3] : [16, 16];
      return {
        url: 'data:image/svg+xml,' + encodeURIComponent(svg),
        x: Math.round(hot[0] * px / 32), y: Math.round(hot[1] * px / 32),
      };
    },

    // Everywhere in Vex's own screens, except where a different cursor tells you something: typing in a box, dragging an edge.
    css(choice) {
      const a = this.image(choice, false), b = this.image(choice, true);
      const use = (i) => `url("${i.url}") ${i.x} ${i.y}, auto`;
      const keep = [
        'input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="password"], input[type="number"], input[type="tel"]',
        'textarea', '[contenteditable]:not([contenteditable="false"])', '[class*="resize"]', '[class*="splitter"]', '[id*="resize"]', '[id*="split"]',
        '[id*="shield"]', '[draggable="true"]', '.vex-sticker', '.vpc-avatar',
      ].join(', ');
      const click = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], summary, select, label, input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], input[type="reset"], input[type="range"], input[type="color"], input[type="file"], .sidebar-icon, .nav-btn';
      return `html, html *:not(${keep}) { cursor: ${use(a)} !important; }\n${click.split(', ').map(s => 'html ' + s).join(', ')} { cursor: ${use(b)} !important; }\n` +
        `html input:not([type]), html input[type="text"], html input[type="search"], html input[type="url"], html input[type="email"], html input[type="password"], html input[type="number"], html input[type="tel"], html textarea, html [contenteditable]:not([contenteditable="false"]) { cursor: text !important; }`;
    },

    apply(doc) {
      doc = doc || (typeof document !== 'undefined' ? document : null);
      if (!doc || !doc.head) return false;
      const choice = this.read();
      let el = doc.getElementById(this.STYLE_ID);
      if (!choice) { if (el) el.remove(); return false; }
      if (!el) { el = doc.createElement('style'); el.id = this.STYLE_ID; doc.head.appendChild(el); }
      el.textContent = this.css(choice);
      return true;
    },

    // Settings > Mouse cursor
    render(body) {
      const G = VexSettingsGroup;
      const cur = this.read();
      const redraw = () => { body.textContent = ''; this.render(body); };
      body.append(G.note(L('Draws your own pointer instead of the system arrow, in Vex\'s own screens and on the New Tab page. A website keeps its own cursors, because Vex cannot restyle another page from outside. Off until you pick a style.')));

      const styleSel = document.createElement('select');
      styleSel.className = 'set-input';
      styleSel.setAttribute('aria-label', L('Cursor style'));
      styleSel.appendChild(new Option(L('Off (the normal cursor)'), ''));
      for (const id of this.STYLES) styleSel.appendChild(new Option(L(this.NAMES[id]), id));
      styleSel.value = cur ? cur.style : '';
      styleSel.addEventListener('change', () => {
        try { this.save(styleSel.value ? { style: styleSel.value, color: (this.read() || {}).color || this.COLORS[2], size: (this.read() || {}).size || 'medium' } : null); redraw(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
      body.append(G.field(L('Cursor style'), styleSel));
      if (!cur) return;

      const swatches = document.createElement('div');
      swatches.setAttribute('role', 'group');
      swatches.setAttribute('aria-label', L('Cursor colour'));
      swatches.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
      const pick = (color) => { try { this.save({ ...this.read(), color }); redraw(); } catch (err) { window.showToast?.(err.message, 'error'); } };
      for (const color of this.COLORS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', color);
        b.setAttribute('aria-pressed', String(color === cur.color));
        b.style.cssText = `width:22px;height:22px;border-radius:50%;border:2px solid ${color === cur.color ? 'var(--primary,#6366f1)' : 'var(--border,rgba(127,127,127,.4))'};background:${color};padding:0`;
        b.addEventListener('click', () => pick(color));
        swatches.appendChild(b);
      }
      const custom = document.createElement('input');
      custom.type = 'color';
      custom.value = cur.color;
      custom.setAttribute('aria-label', L('Pick another colour'));
      custom.addEventListener('change', () => pick(custom.value));
      swatches.appendChild(custom);
      body.append(G.field(L('Cursor colour'), swatches));

      const sizeSel = document.createElement('select');
      sizeSel.className = 'set-input';
      sizeSel.setAttribute('aria-label', L('Cursor size'));
      for (const [id, name] of [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]) sizeSel.appendChild(new Option(L(name), id));
      sizeSel.value = cur.size;
      sizeSel.addEventListener('change', () => { try { this.save({ ...this.read(), size: sizeSel.value }); } catch (err) { window.showToast?.(err.message, 'error'); } });
      body.append(G.field(L('Cursor size'), sizeSel));

      const box = document.createElement('div');
      box.textContent = L('Move the mouse over this box to try it');
      box.style.cssText = 'padding:18px;border:1px dashed var(--border,rgba(127,127,127,.4));border-radius:10px;text-align:center;font-size:12px;color:var(--text-muted,#999)';
      body.append(box);
    },
  };

  // ---------------------------------------------------------------------------------------------------------------------
  const VexClickFx = {
    KEY: 'vex.clickFx',
    EFFECTS: ['fireflies', 'ripple', 'confetti', 'shockwave', 'surprise'],
    NAMES: { fireflies: 'Fireflies', ripple: 'Ripples', confetti: 'Confetti', shockwave: 'Shockwave', surprise: 'Surprise me' },
    COLOR_MODES: ['theme', 'rainbow'],
    RAINBOW: ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#ec4899'],
    LAYER_ID: 'vex-clickfx-layer',
    MIN_GAP_MS: 70,
    MAX_LIVE: 60,
    _last: 0,
    _wired: null,

    // null while it is off (the default), else { effect, color } where color is 'theme', 'rainbow' or '#rrggbb'.
    read() {
      const v = store.get(this.KEY);
      if (!v || !this.EFFECTS.includes(v.effect)) return null;
      return { effect: v.effect, color: (v.color === 'rainbow' || /^#[0-9a-f]{6}$/i.test(String(v.color))) ? v.color : 'theme', force: v.force === true };
    },
    enabled() { return !!this.read(); },
    save(choice) {
      if (!choice) store.set(this.KEY, null);
      else {
        if (!this.EFFECTS.includes(choice.effect)) throw new Error('There is no click effect called "' + choice.effect + '"');
        store.set(this.KEY, { effect: choice.effect, color: choice.color || 'theme', force: choice.force === true });
      }
      this.apply();
      if (typeof VexPointerFx !== 'undefined') VexPointerFx.paintStartPages();
    },
    setEnabled(on) { this.save(on ? (this.read() || { effect: 'fireflies', color: 'theme' }) : null); return !!on; },

    // Why nothing is drawn right now, or '' when it is fine: a hidden window, Reduce motion in Vex, Game mode holding the interface still, or
    // "Animation effects" off in Windows (found 2026-10-21: on a PC with it off the effect looked broken, so Settings now says why).
    whyStill(doc) {
      doc = doc || document;
      if (doc.hidden) return 'hidden';
      if (doc.documentElement.hasAttribute('data-reduce-motion')) return 'vex';
      if (doc.body && doc.body.classList.contains('game-still')) return 'game';
      if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'windows';
      return '';
    },
    // Someone who switched the effect on has asked for it, so "show it even though Windows has animations off" can be ticked; it overrides
    // only Windows' setting, never Vex's own Reduce motion, a hidden window or Game mode.
    stillNow(doc, choice) {
      const why = this.whyStill(doc);
      if (why === 'windows' && choice && choice.force) return false;
      return !!why;
    },

    _colorFor(choice, i) {
      if (choice.color === 'rainbow') return this.RAINBOW[i % this.RAINBOW.length];
      if (choice.color === 'theme') return 'var(--primary, #6366f1)';
      return choice.color;
    },
    _layer(doc) {
      let layer = doc.getElementById(this.LAYER_ID);
      if (!layer) {
        layer = doc.createElement('div');
        layer.id = this.LAYER_ID;
        layer.setAttribute('aria-hidden', 'true');
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483600;overflow:hidden';
        doc.body.appendChild(layer);
      }
      return layer;
    },
    _piece(doc, layer, css) {
      const el = doc.createElement('span');
      el.style.cssText = 'position:absolute;pointer-events:none;will-change:transform,opacity;' + css;
      layer.appendChild(el);
      return el;
    },
    _go(el, frames, ms, easing) {
      if (typeof el.animate !== 'function') { el.remove(); return; }
      const a = el.animate(frames, { duration: ms, easing: easing || 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      a.onfinish = a.oncancel = () => el.remove();
    },

    // One effect at x, y. `which` can be forced (the tests, and "Try it").
    burst(x, y, choice, which, doc) {
      doc = doc || document;
      const layer = this._layer(doc);
      if (layer.childElementCount > this.MAX_LIVE) return 0;
      const effect = which || (choice.effect === 'surprise' ? this.EFFECTS[Math.floor(Math.random() * 4)] : choice.effect);
      const rnd = (a, b) => a + Math.random() * (b - a);
      let n = 0;
      if (effect === 'ripple' || effect === 'shockwave') {
        const rings = effect === 'ripple' ? 2 : 1;
        for (let i = 0; i < rings; i++) {
          const size = effect === 'ripple' ? 18 : 10;
          const el = this._piece(doc, layer, `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;border:${effect === 'ripple' ? 2 : 3}px solid ${this._colorFor(choice, i)};box-sizing:border-box`);
          const to = effect === 'ripple' ? 5 + i * 3 : 16;
          this._go(el, [{ transform: 'scale(.2)', opacity: 0.9 }, { transform: `scale(${to})`, opacity: 0 }], (effect === 'ripple' ? 650 : 380) + i * 160, effect === 'ripple' ? undefined : 'cubic-bezier(.1,.8,.2,1)');
          n++;
        }
        if (effect === 'shockwave') {
          const flash = this._piece(doc, layer, `left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;background:${this._colorFor(choice, 0)}`);
          this._go(flash, [{ transform: 'scale(.4)', opacity: 0.55 }, { transform: 'scale(1.6)', opacity: 0 }], 260);
          n++;
        }
      } else if (effect === 'confetti') {
        for (let i = 0; i < 14; i++) {
          const w = rnd(4, 8), h = rnd(6, 11), ang = rnd(-Math.PI * 0.95, -Math.PI * 0.05), dist = rnd(34, 96), spin = rnd(-540, 540);
          const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
          const el = this._piece(doc, layer, `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${choice.color === 'theme' ? this.RAINBOW[i % this.RAINBOW.length] : this._colorFor(choice, i)};border-radius:1px`);
          this._go(el, [
            { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
            { transform: `translate(${dx}px,${dy}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx * 1.15}px,${dy + 70}px) rotate(${spin}deg)`, opacity: 0 },
          ], rnd(700, 1000));
          n++;
        }
      } else {
        // fireflies: small glowing dots that drift up and fade
        for (let i = 0; i < 9; i++) {
          const s = rnd(3, 6), dx = rnd(-46, 46), dy = rnd(-70, -18), c = this._colorFor(choice, i);
          const el = this._piece(doc, layer, `left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:${c};box-shadow:0 0 ${s * 2}px ${s / 2}px ${c}`);
          this._go(el, [{ transform: 'translate(0,0) scale(.4)', opacity: 0 }, { transform: `translate(${dx * 0.5}px,${dy * 0.5}px) scale(1)`, opacity: 1, offset: 0.3 }, { transform: `translate(${dx}px,${dy}px) scale(.3)`, opacity: 0 }], rnd(700, 1100));
          n++;
        }
      }
      return n;
    },

    onPointerDown(e) {
      const choice = VexClickFx.read();
      if (!choice) return;
      if (e.button !== 0 || e.isPrimary === false) return;
      const now = Date.now();
      if (now - VexClickFx._last < VexClickFx.MIN_GAP_MS) return;
      if (VexClickFx.stillNow(undefined, choice)) return;
      VexClickFx._last = now;
      try { VexClickFx.burst(e.clientX, e.clientY, choice); }
      catch (err) { console.error('[click-effect] could not draw the effect:', err); }
    },

    apply(doc) {
      doc = doc || (typeof document !== 'undefined' ? document : null);
      if (!doc) return false;
      const on = this.enabled();
      if (on && !this._wired) { doc.addEventListener('pointerdown', this.onPointerDown, true); this._wired = doc; }
      if (!on && this._wired) { this._wired.removeEventListener('pointerdown', this.onPointerDown, true); this._wired = null; const l = doc.getElementById(this.LAYER_ID); if (l) l.remove(); }
      return on;
    },

    // Settings > Click effect
    render(body) {
      const G = VexSettingsGroup;
      const cur = this.read();
      const redraw = () => { body.textContent = ''; this.render(body); };
      body.append(G.note(L('A short animation where you click, in Vex\'s own screens and on the New Tab page. A website shows none. It stays still when Reduce motion is on. Off until you switch it on.')));
      body.append(G.toggle(L('Show an animation when I click'), !!cur, (on) => { try { this.setEnabled(on); redraw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      if (!cur) return;

      const eff = document.createElement('select');
      eff.className = 'set-input';
      eff.setAttribute('aria-label', L('Click effect'));
      for (const id of this.EFFECTS) eff.appendChild(new Option(L(this.NAMES[id]), id));
      eff.value = cur.effect;
      eff.addEventListener('change', () => { try { this.save({ ...this.read(), effect: eff.value }); } catch (err) { window.showToast?.(err.message, 'error'); } });
      body.append(G.field(L('Click effect'), eff));

      const col = document.createElement('select');
      col.className = 'set-input';
      col.setAttribute('aria-label', L('Effect colour'));
      col.appendChild(new Option(L('Follow my theme'), 'theme'));
      col.appendChild(new Option(L('Rainbow'), 'rainbow'));
      for (const c of VexCursor.COLORS) col.appendChild(new Option(c, c));
      col.value = cur.color;
      col.addEventListener('change', () => { try { this.save({ ...this.read(), color: col.value }); } catch (err) { window.showToast?.(err.message, 'error'); } });
      body.append(G.field(L('Effect colour'), col));
      // Say plainly when nothing will show, and why, instead of leaving it to look broken.
      const why = this.whyStill();
      if (why === 'windows') {
        body.append(G.note(L('Windows has animations turned off (Settings › Accessibility › Visual effects › Animation effects), so no animation shows.')));
        body.append(G.toggle(L('Show it even though Windows has animations off'), !!cur.force, (on) => { try { this.save({ ...this.read(), force: on }); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      } else if (why === 'vex') {
        body.append(G.note(L('Reduce motion is on in Vex (Settings › Appearance), so no animation shows.')));
      } else {
        body.append(G.note(L('Click anywhere in Vex to see it.')));
      }
    },
  };

  // ---------------------------------------------------------------------------------------------------------------------
  // The glue: the two Settings groups, and handing the choices to the New Tab page, which has storage of its own.
  const VexPointerFx = {
    startPageJs() {
      const c = JSON.stringify(localStorage.getItem(VexCursor.KEY)), f = JSON.stringify(localStorage.getItem(VexClickFx.KEY));
      return `(() => { try {
        const set = (k, v) => { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); };
        set(${JSON.stringify(VexCursor.KEY)}, ${c}); set(${JSON.stringify(VexClickFx.KEY)}, ${f});
        window.dispatchEvent(new Event('vex-pointer-fx'));
      } catch (e) { console.error('[pointer-fx] the New Tab page could not be handed the choice:', e && e.message); } return true; })()`;
    },
    paintStartPage(webview) {
      return webview.executeJavaScript(this.startPageJs())
        .catch((err) => console.error('[pointer-fx] could not reach a New Tab page:', err && err.message));
    },
    paintStartPages() {
      if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews || typeof _isTrustedStartPage !== 'function') return;
      for (const wv of WebviewManager.webviews.values()) {
        let url = '';
        try { url = wv.getURL(); } catch (err) { /* vex-allow-empty-catch: a webview that has not finished attaching has no address yet; it is handed the choice when it loads (js/webview.js, dom-ready) */ }
        if (url && _isTrustedStartPage(url)) this.paintStartPage(wv);
      }
    },
    applyAll() { VexCursor.apply(); VexClickFx.apply(); },
  };

  const g = typeof window !== 'undefined' ? window : globalThis;
  g.VexCursor = VexCursor; g.VexClickFx = VexClickFx; g.VexPointerFx = VexPointerFx;
  globalThis.VexCursor = VexCursor; globalThis.VexClickFx = VexClickFx; globalThis.VexPointerFx = VexPointerFx;   // the same objects; named so a source check can see what this file declares

  if (typeof document !== 'undefined') {
    const start = () => {
      VexPointerFx.applyAll();
      // The New Tab page hears about a change from the browser; so does a Settings reset or a sync.
      window.addEventListener('vex-pointer-fx', () => VexPointerFx.applyAll());
      window.addEventListener('storage', (e) => { if (e.key === VexCursor.KEY || e.key === VexClickFx.KEY) VexPointerFx.applyAll(); });
      if (typeof VexSettingsGroups !== 'undefined') {
        VexSettingsGroups.register({ id: 'custom-cursor', title: 'Mouse cursor', keywords: 'cursor pointer mouse arrow dot ring crosshair star colour color size personal custom', render: (body) => VexCursor.render(body) });
        VexSettingsGroups.register({ id: 'click-effect', title: 'Click effect', keywords: 'click animation effect fireflies ripple confetti shockwave surprise sparkle fun mouse', render: (body) => VexClickFx.render(body) });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexCursor, VexClickFx, VexPointerFx };
})();
