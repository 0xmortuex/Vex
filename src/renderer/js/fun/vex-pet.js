// === Vex Pet ==================================================================
//
// An optional New Tab companion with care reactions and saved appearance.
// Snacks, games and cuddles are play, never obligations: no hunger, decay,
// reminders or penalties. Off until turned on in Settings.
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
  OPTIONS: { species: ['cat', 'bunny', 'fox'], color: ['theme', '#e7ad80', '#a5bdde', '#b2c9a5', '#d2b4d6'], size: [64, 88, 112], accessory: ['none', 'bandana', 'bow'] },
  CHEER_MS: 90 * 1000,
  LABELS: {
    sleepy: 'Your pet is asleep',
    cheer: 'Your pet is cheering for you',
    calm: 'Your pet is keeping you company',
    cuddle: 'Your pet is enjoying a cuddle',
    feed: 'Your pet is enjoying a snack',
    play: 'Your pet is playing with you',
  },

  state() {
    const s = VexProgress.load(this.KEY, {}), p = s.prefs || {};
    const prefs = {
      name: typeof p.name === 'string' ? p.name.slice(0, 24) : 'Mochi',
      species: this.OPTIONS.species.includes(p.species) ? p.species : 'cat',
      color: this.OPTIONS.color.includes(p.color) ? p.color : 'theme',
      size: this.OPTIONS.size.includes(p.size) ? p.size : 88,
      accessory: this.OPTIONS.accessory.includes(p.accessory) ? p.accessory : 'none',
      hover: p.hover !== false, locked: p.locked === true,
      position: p.position && Number.isFinite(p.position.x) && Number.isFinite(p.position.y)
        ? { x: Math.max(0, Math.min(1, p.position.x)), y: Math.max(0, Math.min(1, p.position.y)) } : null,
    };
    const count = v => Math.max(0, Math.min(99999, Math.floor(Number(v) || 0)));
    return { ...s, prefs, snacks: count(s.snacks), plays: count(s.plays), cuddles: count(s.cuddles) };
  },

  interact(action, patch) {
    if (!VexProgress.enabled('pet') || !VexProgress.allows('pet')) return false;
    const s = this.state(), now = VexProgress.now();
    if (action === 'customize') {
      if (!patch || typeof patch !== 'object') return false;
      const p = s.prefs;
      if (typeof patch.name === 'string') p.name = patch.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Mochi';
      for (const key of ['species', 'color', 'size', 'accessory']) if (this.OPTIONS[key].includes(patch[key])) p[key] = patch[key];
      for (const key of ['hover', 'locked']) if (typeof patch[key] === 'boolean') p[key] = patch[key];
      if (patch.position === null) p.position = null;
      else if (!p.locked && patch.position && Number.isFinite(patch.position.x) && Number.isFinite(patch.position.y)) {
        p.position = { x: Math.max(0, Math.min(1, patch.position.x)), y: Math.max(0, Math.min(1, patch.position.y)) };
      }
    } else {
      if (!['feed', 'play', 'cuddle', 'sleep', 'wake'].includes(action)) return false;
      // Hover sends at most one cuddle every few seconds. No XP or penalties.
      if (action === 'cuddle' && now - (s.lastCuddle || 0) < 2500) return false;
      if (action === 'feed') s.snacks = Math.min(99999, s.snacks + 1);
      if (action === 'play') s.plays = Math.min(99999, s.plays + 1);
      if (action === 'cuddle') { s.cuddles = Math.min(99999, s.cuddles + 1); s.lastCuddle = now; }
      s.reaction = action === 'sleep' ? 'sleepy' : action === 'wake' ? 'calm' : action;
      s.reactionUntil = now + (action === 'sleep' ? 30 * 60000 : 8000);
    }
    VexProgress.save(this.KEY, s);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:pet-changed'));
    return true;
  },

  moodFor(o) {
    const hour = o.hour;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('moodFor needs an hour from 0 to 23');
    if (Number(o.cheerUntil) > Number(o.now)) return 'cheer';
    if (hour >= 22 || hour < 6) return 'sleepy';
    return 'calm';
  },

  _cheerUntil() {
    const s = VexProgress.load(this.KEY, {});
    return Number(s.cheerUntil) || 0;
  },

  // Starts the cheer. Works even while the pet is off; it simply is not shown.
  cheer() {
    VexProgress.save(this.KEY, { ...this.state(), cheerUntil: VexProgress.now() + this.CHEER_MS });
    try { document.dispatchEvent(new CustomEvent('vex:pet-changed')); } catch { /* no document */ }
  },

  mood() {
    const now = VexProgress.now();
    const s = this.state();
    if (s.reactionUntil > now && Object.hasOwn(this.LABELS, s.reaction)) return s.reaction;
    return this.moodFor({ hour: new Date(now).getHours(), cheerUntil: this._cheerUntil(), now });
  },

  // The drawing. Strokes use currentColor (the theme's text colour) and the
  // body takes the accent, so a light look and a dark look both read.
  art(mood, species = 'cat', accessory = 'none') {
    const reaction = mood;
    if (['cuddle', 'feed', 'play'].includes(mood)) mood = 'cheer';
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
        (species === 'bunny' ? '<path d="M21 25Q13 0 22 5L29 22M35 22Q42 0 47 5L43 26" class="vp-fill"/>' : '<path d="M18.4 26.4 16.6 11.8l11.4 8.2M45.6 26.4l1.8-14.6L36 20" class="vp-fill"/>') +
        (species === 'fox' ? '<path d="M47 47Q63 53 59 29Q48 35 49 44" class="vp-fill"/>' : '<path d="M49 46c5.6.6 8.4-2.4 8.2-7" class="vp-line"/>') +
        eyes +
        '<path d="M21 42.4h.1M43 42.4h.1" class="vp-cheek"/>' +
        mouth +
      '</g>' + (accessory === 'bandana' ? '<path d="M22 50H42L32 59Z" class="vp-ink"/>' : accessory === 'bow' ? '<path d="M23 50L32 53L41 50V57L32 54L23 57Z" class="vp-ink"/>' : '') + extra + (reaction === 'cuddle' ? '<path d="M7 26C1 20 5 15 9 20C13 15 17 20 9 27Z" class="vp-fill"/>' : reaction === 'feed' ? '<path d="M22 55H42L39 61H25Z" class="vp-fill"/>' : reaction === 'play' ? '<circle cx="53" cy="56" r="6" class="vp-fill"/><path d="M48 53L58 59" class="vp-line"/>' : '') + '</svg>';
  },

  snapshot() {
    const enabled = VexProgress.enabled('pet');
    const mood = this.mood();
    const s = this.state();
    return { enabled, mood, label: this.LABELS[mood], svg: enabled ? this.art(mood, s.prefs.species, s.prefs.accessory) : '', prefs: s.prefs, snacks: s.snacks, plays: s.plays, cuddles: s.cuddles, reactionUntil: s.reactionUntil || 0 };
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
      if (!s.enabled || !VexProgress.allows('pet')) { box.innerHTML = ''; box.hidden = true; box.removeAttribute('aria-label'); return; }
      box.hidden = false;
      box.setAttribute('aria-label', s.label);
      box.innerHTML = s.svg;
    };
    const onEvent = () => { try { update(); } catch (err) { VexProgress.report('The pet could not redraw', err); } };
    const evs = ['vex:pet-changed', 'vex:fun-changed', 'vex:game-mode'];
    evs.forEach(n => document.addEventListener(n, onEvent));
    window.addEventListener('storage', onEvent);
    // Mood follows the clock; a minute is fine-grained enough.
    const timer = VexJobs.every('Pet mood ' + Math.random().toString(36).slice(2, 8), 60000, onEvent, { feature: 'pet' });
    update();
    return {
      update,
      destroy() {
        timer.stop();
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
      try { this.cheer(); } catch (err) { VexProgress.report('The pet could not cheer', err); }
    });
  },
};

if (typeof document !== 'undefined') VexPet.init();
globalThis.VexPet = VexPet;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPet };
