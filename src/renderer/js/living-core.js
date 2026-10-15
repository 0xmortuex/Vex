// === Vex Living: shared core ================================================
//
// The "living" layers (tab personalities, seasonal worlds, weather layer,
// focus scenes, sticker sheet) are delightful extras, not features you are
// meant to notice. Four rules hold for every one of them, and this file is the
// one place they are enforced so a layer cannot forget:
//
//   1. Optional and OFF by default. Each layer has its own switch.
//   2. Quiet means quiet. One master "animations" switch, the OS / Vex
//      reduce-motion setting, "Stay still while gaming" and Game mode all stop
//      every layer. Nothing here fights a game for the GPU.
//   3. No work while nobody is looking. A layer that is hidden, off or quiet
//      has NO animation frame scheduled at all (not a frame that returns
//      early). Visibility / quiet changes re-evaluate through events.
//   4. Nothing leaves the device. No network call lives in these files.
//
// Layers are standalone: `mount(el, opts)` / `unmount()` / `snapshot()`. The
// New Tab page (today.js / start.html, owned elsewhere) only has to call them.
//
// Classic script (no modules), same as the rest of the renderer; also
// require()-able so the logic is unit-tested without a browser.

const VexLiving = (() => {
  const KEY = 'vex.living';

  // Every key, with its default. Features default OFF; the master "animations"
  // switch defaults to allow, so turning one layer on needs nothing else.
  const DEFAULTS = Object.freeze({
    animations: true,          // master quiet switch (false = every layer is still)
    tabPersonality: false,     // micro-animation when a tab finishes loading
    tabDailyGlow: false,       // faint glow on sites visited most days
    world: 'off',              // off | autumn | snow | night | spring | auto
    weatherLayer: false,       // New Tab weather layer
    weatherManual: 'auto',     // auto (use the start page's saved forecast) | clear | cloudy | rain | snow | fog | storm
    scene: 'off',              // off | rain | fire | cafe | space
    sceneVolume: 0.35,         // 0..1
    sceneWithFocus: false,     // start the scene when a focus session starts
    stickers: false            // collect stickers from milestones
  });

  const ENUMS = Object.freeze({
    world: ['off', 'autumn', 'snow', 'night', 'spring', 'auto'],
    weatherManual: ['auto', 'clear', 'cloudy', 'rain', 'snow', 'fog', 'storm'],
    scene: ['off', 'rain', 'fire', 'cafe', 'space']
  });

  // ---- settings -------------------------------------------------------------
  function _store(storage) {
    if (storage) return storage;
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  }

  function normalize(raw) {
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;
    for (const k of Object.keys(DEFAULTS)) {
      if (!(k in raw)) continue;
      const v = raw[k], d = DEFAULTS[k];
      if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
      else if (typeof d === 'number') { if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v)); }
      else if (ENUMS[k]) { if (ENUMS[k].includes(v)) out[k] = v; }
    }
    return out;
  }

  function read(storage) {
    const s = _store(storage);
    if (!s) return { ...DEFAULTS };
    let raw = null;
    try { raw = JSON.parse(s.getItem(KEY) || 'null'); }
    catch (err) { console.warn('[Living] the saved settings could not be read:', err && err.message); }
    return normalize(raw);
  }

  // Throws on an unknown key or a value outside the key's type (a typo must
  // not be a silent no-op). Returns false only when storage refused the write,
  // so a caller never claims a save that did not happen.
  function write(patch, storage) {
    const cur = read(storage);
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS)) throw new Error('Unknown living setting ' + k);
      const d = DEFAULTS[k];
      if (typeof d === 'boolean' && typeof v !== 'boolean') throw new Error('Living setting ' + k + ' must be true or false');
      if (typeof d === 'number' && !(typeof v === 'number' && Number.isFinite(v))) throw new Error('Living setting ' + k + ' must be a number');
      if (ENUMS[k] && !ENUMS[k].includes(v)) throw new Error('Living setting ' + k + ' must be one of ' + ENUMS[k].join(', '));
      cur[k] = typeof d === 'number' ? Math.min(1, Math.max(0, v)) : v;
    }
    const s = _store(storage);
    if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(cur)); } catch { return false; }
    try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:living-changed', { detail: { patch } })); } catch { /* no DOM */ }
    return true;
  }

  // ---- the quiet gate -------------------------------------------------------
  // Pure: everything it needs is in `env`. Returns '' when a layer may animate,
  // else the reason. Order matters only for the reason that is reported.
  //   hard stops (no frame scheduled)   animations-off, game-mode, hidden
  //   soft stops (one still frame)      still, reduced-motion
  function quietReason(env) {
    const e = env || {};
    if (e.settings && e.settings.animations === false) return 'animations-off';
    if (e.quietSwitch) return 'quiet-switch';
    if (e.gameActive) return 'game-mode';
    if (e.hidden) return 'hidden';
    if (e.stillWhileGaming) return 'still';
    if (e.reducedMotion) return 'reduced-motion';
    if (e.custom) return 'custom';
    return '';
  }
  const HARD = Object.freeze(['animations-off', 'quiet-switch', 'game-mode', 'hidden', 'custom']);
  const isHardStop = (reason) => HARD.includes(reason);

  let _gameFlag = false;     // kept from the vex:game-mode event (start page has no GameSession)
  function readEnv(opts) {
    const o = opts || {};
    const env = { settings: o.settings || read(o.storage), gameActive: _gameFlag, hidden: false, reducedMotion: false, stillWhileGaming: false, custom: false, quietSwitch: false };
    // The ONE quiet switch (Settings > Play, js/vex-fun.js): vex.fun.quiet === '1'.
    try { const st = _store(o.storage); env.quietSwitch = !!st && st.getItem('vex.fun.quiet') === '1'; } catch { env.quietSwitch = false; }
    try {
      if (typeof GameSession !== 'undefined' && GameSession && GameSession.active) env.gameActive = true;
      if (typeof GameMode !== 'undefined' && GameMode && GameMode.gaming) env.gameActive = true;
    } catch { /* lexical global not defined here */ }
    try {
      if (typeof document !== 'undefined') {
        env.hidden = document.visibilityState === 'hidden' || document.hidden === true;
        env.stillWhileGaming = !!(document.body && document.body.classList.contains('vex-gaming-still'));
        if (document.documentElement && document.documentElement.hasAttribute('data-reduce-motion')) env.reducedMotion = true;
      }
      if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) env.reducedMotion = true;
    } catch { /* not a browser */ }
    if (typeof o.isQuiet === 'function') { try { env.custom = !!o.isQuiet(); } catch { env.custom = false; } }
    return env;
  }

  // ---- the frame loop -------------------------------------------------------
  // draw(dtSeconds, staticFrame). A hard stop cancels the frame request, so an
  // idle layer costs nothing; a soft stop paints one still frame and also
  // schedules nothing. evaluate() runs on events, never on a timer.
  function createLoop(o) {
    const raf = o.raf || ((f) => requestAnimationFrame(f));
    const caf = o.caf || ((h) => cancelAnimationFrame(h));
    const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    // Settings are parsed once per evaluate(), not once per frame.
    let cached = null;
    const env = o.env || (() => readEnv({ ...o, settings: cached || (cached = read(o.storage)) }));
    const minGap = 1000 / Math.max(1, o.fps || 30);
    let handle = null, last = 0, running = false, reason = 'stopped', painted = 0, stillPainted = false;

    function frame(t) {
      handle = null;
      if (!running) return;
      const r = quietReason(env());
      if (r) { evaluate(); return; }                 // conditions changed under us
      handle = raf(frame);
      if (t - last < minGap) return;                 // fps cap: skip, schedule nothing extra
      const dt = Math.min(0.1, last ? (t - last) / 1000 : 1 / 30);
      last = t;
      painted++;
      o.draw(dt, false);
    }
    function halt() { if (handle !== null) { caf(handle); handle = null; } }
    function evaluate() {
      cached = null;
      if (!running) return reason;
      reason = quietReason(env());
      if (!reason) { stillPainted = false; if (handle === null) { last = 0; handle = raf(frame); } return reason; }
      halt();
      if (!isHardStop(reason) && !stillPainted) { stillPainted = true; painted++; o.draw(0, true); }
      return reason;
    }
    function start() { running = true; return evaluate(); }
    function stop() { running = false; halt(); reason = 'stopped'; }
    return {
      start, stop, evaluate,
      snapshot: () => ({ running, reason, scheduled: handle !== null, framesPainted: painted, fps: Math.round(1000 / minGap) })
    };
  }

  // The events that can change the answer. Returns an unsubscribe.
  function watch(cb) {
    const offs = [];
    const add = (target, type, fn) => { try { target.addEventListener(type, fn); offs.push(() => target.removeEventListener(type, fn)); } catch { /* no target */ } };
    if (typeof document !== 'undefined') {
      add(document, 'visibilitychange', cb);
      add(document, 'vex:living-changed', cb);
      add(document, 'vex:battery-mode', cb);
      add(document, 'vex:game-mode', (e) => { _gameFlag = !!(e && e.detail && e.detail.active); cb(); });
    }
    try {
      if (typeof matchMedia === 'function') {
        const mq = matchMedia('(prefers-reduced-motion: reduce)');
        if (mq.addEventListener) { mq.addEventListener('change', cb); offs.push(() => mq.removeEventListener('change', cb)); }
      }
    } catch { /* no matchMedia */ }
    return () => offs.forEach(f => f());
  }

  // ---- deterministic randomness + particles ---------------------------------
  function rng(seed) {            // mulberry32
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A fixed-size pool: nothing is allocated per frame, the count never grows.
  function createField(o) {
    const rand = rng(o.seed || 1);
    const field = { w: o.w || 1, h: o.h || 1, parts: [], rand };
    for (let i = 0; i < o.count; i++) field.parts.push(o.init(rand, field, i));
    field.step = (dt) => { for (const p of field.parts) o.step(p, dt, field, rand); };
    return field;
  }

  // ---- a canvas layer -------------------------------------------------------
  // Shared by worlds and the weather layer. Pixel ratio is capped at 1: these
  // are soft backdrops, and a 4K display must not mean 4x the fill cost.
  function mountCanvas(host, extraClass) {
    if (!host || typeof document === 'undefined') throw new Error('mountCanvas needs an element');
    const canvas = document.createElement('canvas');
    canvas.className = 'vex-living-canvas ' + (extraClass || '');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');
    host.insertBefore(canvas, host.firstChild);
    host.classList.add('vex-living-host');
    let ro = null;
    const size = () => {
      const r = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width || host.clientWidth || 1));
      canvas.height = Math.max(1, Math.round(r.height || host.clientHeight || 1));
    };
    size();
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(size); ro.observe(host); }
    return { canvas, ctx: canvas.getContext && canvas.getContext('2d'), size, destroy() { if (ro) ro.disconnect(); canvas.remove(); host.classList.remove('vex-living-host'); } };
  }

  // A mountable canvas layer. def = {
  //   id, fps,
  //   variant(settings, opts) -> string | '' (''= this layer is switched off),
  //   build(variant, w, h, seed) -> { step(dt, still), paint(ctx, w, h), meta }
  // }
  // mount(host, opts) returns false when the layer's switch is off (nothing is
  // created, nothing scheduled). opts: { storage, isQuiet, seed }.
  function createLayer(def) {
    let m = null;
    const api = {
      id: def.id,
      mount(host, opts) {
        const o = opts || {};
        if (m) api.unmount();
        const settings = read(o.storage);
        if (!def.variant(settings, o)) return false;
        ensureStyles();
        const surface = mountCanvas(host, 'vex-living-' + def.id);
        m = { surface, o, variant: '', spec: null, off: null, loop: null };
        const rebuild = () => {
          const v = def.variant(read(o.storage), o);
          if (!v) { m.loop.stop(); const c = m.surface; if (c.ctx) c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height); m.variant = ''; return; }
          if (v !== m.variant) {
            m.variant = v;
            m.spec = def.build(v, m.surface.canvas.width, m.surface.canvas.height, o.seed || 1);
            m.loop.start();
          } else if (m.loop.snapshot().reason === 'stopped') m.loop.start();
          m.loop.evaluate();
        };
        m.loop = createLoop({
          fps: def.fps, storage: o.storage, isQuiet: o.isQuiet,
          draw: (dt, still) => {
            const c = m.surface;
            if (!c.ctx || !m.spec) return;
            if (m.spec.w !== c.canvas.width || m.spec.h !== c.canvas.height) m.spec = def.build(m.variant, c.canvas.width, c.canvas.height, o.seed || 1);
            c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
            m.spec.step(dt, still);
            m.spec.paint(c.ctx, c.canvas.width, c.canvas.height);
          }
        });
        m.off = watch(rebuild);
        rebuild();
        return true;
      },
      unmount() {
        if (!m) return false;
        m.loop.stop(); if (m.off) m.off(); m.surface.destroy(); m = null;
        return true;
      },
      snapshot() {
        if (!m) return { id: def.id, mounted: false };
        const s = m.loop.snapshot();
        return { id: def.id, mounted: true, variant: m.variant, running: s.running, reason: s.reason, scheduled: s.scheduled, framesPainted: s.framesPainted, fps: s.fps, particles: m.spec && m.spec.meta ? m.spec.meta.count : 0 };
      }
    };
    return api;
  }

  // The stylesheet is injected before a11y.css so a11y.css stays the LAST one.
  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById('vex-living-css')) return;
    let href = 'css/living.css';
    try {
      const me = document.currentScript && document.currentScript.src;
      if (me) href = me.replace(/js\/living-core\.js.*$/, 'css/living.css');
    } catch { /* keep the relative default */ }
    const link = document.createElement('link');
    link.id = 'vex-living-css'; link.rel = 'stylesheet'; link.href = href;
    const a11y = document.querySelector('link[href$="a11y.css"]');
    if (a11y && a11y.parentNode) a11y.parentNode.insertBefore(link, a11y);
    else document.head.appendChild(link);
  }

  // ---- Settings: one module-owned group, injected at runtime ---------------
  // Layers register rows; the group is built into .settings-content when it
  // exists. index.html needs only the <script> tags.
  const _rows = [];
  function registerSettings(rows) {
    for (const r of rows) {
      if (!r || !r.key || !(r.key in DEFAULTS)) throw new Error('registerSettings: unknown key ' + (r && r.key));
      if (!_rows.some(x => x.key === r.key)) _rows.push(r);
    }
    renderSettings();
  }

  function renderSettings(root) {
    if (typeof document === 'undefined') return null;
    const host = root || document.querySelector('.settings-content');
    if (!host) return null;
    let group = host.querySelector('#living-settings');
    if (!group) {
      group = document.createElement('div');
      group.className = 'setting-group';
      group.id = 'living-settings';
      host.appendChild(group);
    }
    group.textContent = '';
    const title = document.createElement('label');
    title.className = 'setting-label';
    title.textContent = 'Living Vex';
    const info = document.createElement('p');
    info.className = 'setting-info muted';
    info.textContent = 'Small, calm touches on the New Tab page, the tab strip and while you focus. All off until you turn one on. They stop by themselves in Game mode, with reduced motion, or when the window is hidden. Nothing here uses the network.';
    group.append(title, info);
    const cur = read();
    for (const def of _rows) {
      const row = document.createElement('div');
      row.className = 'living-row';
      const lab = document.createElement('span');
      lab.className = 'living-row-label';
      lab.textContent = def.label;
      const id = 'living-' + def.key;
      let input;
      if (def.type === 'select') {
        input = document.createElement('select');
        input.className = 'set-input';
        for (const [val, text] of def.options) {
          const o = document.createElement('option'); o.value = val; o.textContent = text; input.appendChild(o);
        }
        input.value = cur[def.key];
      } else if (def.type === 'range') {
        input = document.createElement('input');
        input.type = 'range'; input.min = '0'; input.max = '100';
        input.value = String(Math.round(cur[def.key] * 100));
      } else {
        const wrap = document.createElement('label');
        wrap.className = 'toggle';
        input = document.createElement('input');
        input.type = 'checkbox'; input.checked = !!cur[def.key];
        const slider = document.createElement('span'); slider.className = 'toggle-slider';
        wrap.append(input, slider);
        row.append(lab, wrap);
      }
      input.id = id;
      input.setAttribute('aria-label', def.label);
      if (def.type === 'select' || def.type === 'range') row.append(lab, input);
      input.addEventListener('change', () => {
        const v = def.type === 'range' ? Number(input.value) / 100 : def.type === 'select' ? input.value : input.checked;
        try { if (write({ [def.key]: v }) === false) throw new Error('storage refused the write'); }
        catch (err) { if (typeof window !== 'undefined' && window.showToast) window.showToast('Could not save: ' + err.message, 'error'); else throw err; }
      });
      group.appendChild(row);
    }
    return group;
  }

  return {
    KEY, DEFAULTS, ENUMS,
    read, write, normalize,
    quietReason, isHardStop, readEnv,
    createLoop, watch, rng, createField, mountCanvas, createLayer,
    ensureStyles, registerSettings, renderSettings,
    _rows
  };
})();

if (typeof window !== 'undefined') window.VexLiving = VexLiving;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLiving };
