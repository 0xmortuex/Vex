// === Vex Pet ==================================================================
//
// A small, purely decorative companion for the New Tab page. It reacts to a
// few real things and does nothing else: no needs, no hunger, no way to
// neglect it. Off until turned on in Settings.
//
// Wiring for the page that shows it (the integrator adds the script tags):
//   const pet = VexPet.mount(containerElement);   // { update(), destroy() }
//   VexPet.snapshot()                              // { enabled, mood, label, svg }
//
// Moods (VexPet.moodFor is pure and tested):
//   sleepy   10 pm to 6 am, local time
//   cheer    for 90 seconds after a focus session ends
//   calm     otherwise
//
// A focus session ending is announced by dispatching
//   document 'vex:focus-complete'  detail { minutes? }
// or by calling VexPet.cheer(). The cheer is also written to localStorage so
// the New Tab page, which is a separate document, hears about it through the
// 'storage' event.
//
// The art is hand-drawn SVG that takes its colours from the theme
// (--vex-accent, --vex-text), so it follows every look. Animations stop under
// prefers-reduced-motion. Nothing is shown during Game mode.
const VexPet = {
  KEY: 'vex.fun.pet',
  CHEER_MS: 90 * 1000,
  LABELS: {
    sleepy: 'Your pet is asleep',
    cheer: 'Your pet is cheering for you',
    calm: 'Your pet is keeping you company',
  },

  moodFor(o) {
    const hour = o.hour;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('moodFor needs an hour from 0 to 23');
    if (Number(o.cheerUntil) > Number(o.now)) return 'cheer';
    if (hour >= 22 || hour < 6) return 'sleepy';
    return 'calm';
  },

  _cheerUntil() {
    const s = VexFun.load(this.KEY, {});
    return Number(s.cheerUntil) || 0;
  },

  // Starts the cheer. Works even while the pet is off; it simply is not shown.
  cheer() {
    VexFun.save(this.KEY, { cheerUntil: VexFun.now() + this.CHEER_MS });
    try { document.dispatchEvent(new CustomEvent('vex:pet-changed')); } catch { /* no document */ }
  },

  mood() {
    const now = VexFun.now();
    return this.moodFor({ hour: new Date(now).getHours(), cheerUntil: this._cheerUntil(), now });
  },

  // The drawing. Strokes use currentColor (the theme's text colour) and the
  // body takes the accent, so a light look and a dark look both read.
  art(mood) {
    const eyes = mood === 'sleepy'
      ? '<path d="M22.5 37.5q3.2 3 6.4 0M35.1 37.5q3.2 3 6.4 0" class="vp-line"/>'
      : mood === 'cheer'
        ? '<path d="M22.5 38.5q3.2-4.4 6.4 0M35.1 38.5q3.2-4.4 6.4 0" class="vp-line"/>'
        : '<circle cx="25.7" cy="37" r="2.5" class="vp-ink"/><circle cx="38.3" cy="37" r="2.5" class="vp-ink"/>';
    const mouth = mood === 'cheer'
      ? '<path d="M28 43.5q4 6.2 8 0z" class="vp-ink"/>'
      : '<path d="M29 44q3 2.6 6 0" class="vp-line"/>';
    const extra = mood === 'sleepy'
      ? '<g class="vp-z"><path d="M46 14h6l-6 7h6" class="vp-line"/><path d="M54 5h4l-4 4.6h4" class="vp-line"/></g>'
      : mood === 'cheer'
        ? '<g class="vp-spark"><path d="M10 12v6M7 15h6" class="vp-line"/><path d="M54 8v6M51 11h6" class="vp-line"/><path d="M52 26v4M50 28h4" class="vp-line"/></g>'
        : '';
    return '<svg class="vex-pet-art vex-pet-' + mood + '" viewBox="0 0 64 64" width="64" height="64" fill="none" aria-hidden="true">' +
      '<g class="vp-body">' +
        '<path d="M15 42c0-12.4 7.6-22 17-22s17 9.6 17 22c0 7.2-7.4 11.6-17 11.6S15 49.2 15 42z" class="vp-fill"/>' +
        '<path d="M18.4 26.4 16.6 11.8l11.4 8.2M45.6 26.4l1.8-14.6L36 20" class="vp-fill"/>' +
        '<path d="M49 46c5.6.6 8.4-2.4 8.2-7" class="vp-line"/>' +
        eyes +
        '<path d="M21 42.4h.1M43 42.4h.1" class="vp-cheek"/>' +
        mouth +
      '</g>' + extra + '</svg>';
  },

  snapshot() {
    const enabled = VexFun.enabled('pet');
    const mood = this.mood();
    return { enabled, mood, label: this.LABELS[mood], svg: enabled ? this.art(mood) : '' };
  },

  _styled: false,
  _style() {
    if (this._styled || typeof document === 'undefined') return;
    this._styled = true;
    const st = document.createElement('style');
    st.id = 'vex-pet-style';
    st.textContent =
      '.vex-pet{display:inline-block;line-height:0;color:var(--vex-text,currentColor)}' +
      '.vex-pet svg{display:block}' +
      '.vex-pet .vp-fill{fill:var(--vex-accent,#7aa2ff);fill-opacity:.9;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round}' +
      '.vex-pet .vp-line{stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none}' +
      '.vex-pet .vp-ink{fill:currentColor}' +
      '.vex-pet .vp-cheek{stroke:currentColor;stroke-opacity:.35;stroke-width:5;stroke-linecap:round}' +
      '.vex-pet .vp-body{transform-origin:32px 54px;animation:vex-pet-breathe 4.2s ease-in-out infinite}' +
      '.vex-pet .vex-pet-cheer .vp-body{animation:vex-pet-hop .7s ease-in-out 3}' +
      '.vex-pet .vp-z,.vex-pet .vp-spark{animation:vex-pet-float 3s ease-in-out infinite}' +
      '@keyframes vex-pet-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03,.98)}}' +
      '@keyframes vex-pet-hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}' +
      '@keyframes vex-pet-float{0%,100%{opacity:.55}50%{opacity:1}}' +
      '@media (prefers-reduced-motion:reduce){.vex-pet *{animation:none!important}}';
    document.head.appendChild(st);
  },

  // Draws the pet into `el` and keeps it current. Returns { update, destroy }.
  mount(el) {
    if (!el || typeof el.appendChild !== 'function') throw new Error('The pet needs an element to live in');
    this._style();
    const box = document.createElement('div');
    box.className = 'vex-pet';
    box.setAttribute('role', 'img');
    el.appendChild(box);
    const update = () => {
      const s = this.snapshot();
      // Off, or a game is running: draw nothing at all.
      if (!s.enabled || VexFun.gameActive()) { box.innerHTML = ''; box.hidden = true; box.removeAttribute('aria-label'); return; }
      box.hidden = false;
      box.setAttribute('aria-label', s.label);
      box.innerHTML = s.svg;
    };
    const onEvent = () => { try { update(); } catch (err) { VexFun.report('The pet could not redraw', err); } };
    const evs = ['vex:pet-changed', 'vex:fun-changed', 'vex:game-mode'];
    evs.forEach(n => document.addEventListener(n, onEvent));
    window.addEventListener('storage', onEvent);
    // Mood follows the clock; a minute is fine-grained enough.
    const timer = setInterval(onEvent, 60000);
    update();
    return {
      update,
      destroy() {
        clearInterval(timer);
        evs.forEach(n => document.removeEventListener(n, onEvent));
        window.removeEventListener('storage', onEvent);
        box.remove();
      },
    };
  },

  init() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    document.addEventListener('vex:focus-complete', () => {
      try { this.cheer(); } catch (err) { VexFun.report('The pet could not cheer', err); }
    });
  },
};

if (typeof document !== 'undefined') VexPet.init();
globalThis.VexPet = VexPet;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPet };
