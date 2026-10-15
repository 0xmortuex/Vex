// === Vex Seasonal Worlds ====================================================
//
// Calm, drawn-in-canvas backdrops for the New Tab page: autumn leaves, snow,
// a night sky of stars, spring petals. Nothing is downloaded: every shape is a
// few canvas paths. A world is only a BACKDROP layer: it never changes the
// theme (mood themes / seasonal themes are a separate layer), it sits behind
// the page content with pointer-events none.
//
//   SeasonalWorlds.mount(el, { storage?, isQuiet?, seed?, hemisphere?, now? })
//   SeasonalWorlds.unmount()
//   SeasonalWorlds.snapshot()  -> { mounted, variant, running, reason, scheduled, particles, ... }
//
// Off by default (Settings > Living Vex > World). mount() returns false and
// does nothing while the switch is off. Capped at 30 fps and at a fixed
// particle count; a hidden page, Game mode, reduced motion or the master
// "animations" switch stops it (see living-core.js).

const SeasonalWorlds = (() => {
  const VL = () => (typeof VexLiving !== 'undefined' ? VexLiving : require('./living-core.js').VexLiving);

  const WORLDS = Object.freeze(['autumn', 'snow', 'night', 'spring']);
  const MAX = Object.freeze({ autumn: 26, snow: 70, night: 110, spring: 30 });
  const MIN = Object.freeze({ autumn: 8, snow: 20, night: 30, spring: 10 });

  // "Auto": night between 21:00 and 05:00, otherwise the northern season by
  // month (southern flips it). June to August has no weather to draw, so it
  // gets the star sky too.
  function autoWorld(date, hemisphere) {
    const d = date instanceof Date ? date : new Date(date);
    const h = d.getHours();
    if (h >= 21 || h < 5) return 'night';
    let m = d.getMonth();                              // 0 = January
    if (hemisphere === 'south') m = (m + 6) % 12;
    if (m === 11 || m <= 1) return 'snow';
    if (m >= 2 && m <= 4) return 'spring';
    if (m >= 8 && m <= 10) return 'autumn';
    return 'night';
  }

  // Count scales with the area, between a floor and a hard cap.
  function particleCount(world, w, h) {
    if (!MAX[world]) throw new Error('Unknown world ' + world);
    const k = Math.min(1, (w * h) / (1280 * 720));
    return Math.max(MIN[world], Math.round(MAX[world] * k));
  }

  function variantFor(settings, opts) {
    const w = settings.world;
    if (!w || w === 'off') return '';
    if (w === 'auto') return autoWorld((opts && opts.now) || new Date(), opts && opts.hemisphere);
    return WORLDS.includes(w) ? w : '';
  }

  // ---- the four worlds ------------------------------------------------------
  const LEAF = ['#c2571a', '#d98b2b', '#a63d1f', '#8c5a2b'];
  const PETAL = ['#f4b6c8', '#f8d0dc', '#fbe3ea'];

  function build(world, w, h, seed) {
    const rand = VL().rng(seed);
    const n = particleCount(world, w, h);
    const parts = [];
    for (let i = 0; i < n; i++) {
      parts.push({
        x: rand() * w, y: rand() * h,
        r: world === 'night' ? 0.4 + rand() * 1.3 : world === 'snow' ? 1 + rand() * 2.4 : 5 + rand() * 6,
        v: world === 'night' ? 0 : world === 'snow' ? 14 + rand() * 20 : 18 + rand() * 22,   // px per second
        ph: rand() * Math.PI * 2,                 // phase
        sw: 8 + rand() * 18,                      // sway width
        rot: rand() * Math.PI * 2, spin: (rand() - 0.5) * 1.2,
        c: world === 'autumn' ? LEAF[i % LEAF.length] : PETAL[i % PETAL.length],
        a: 0.35 + rand() * 0.4
      });
    }
    let t = 0;
    const spec = {
      w, h, meta: { count: n, world },
      step(dt, still) {
        if (still) return;
        t += dt;
        if (world === 'night') return;
        for (const p of parts) {
          p.y += p.v * dt;
          p.ph += dt * 0.9;
          p.rot += p.spin * dt;
          if (p.y - p.r > h) { p.y = -p.r * 2; p.x = rand() * w; }
        }
      },
      paint(ctx, cw, ch) {
        if (world === 'night') {
          for (const p of parts) {
            const tw = 0.55 + 0.45 * Math.sin(t * 0.8 + p.ph);
            ctx.globalAlpha = p.a * tw;
            ctx.fillStyle = '#e8ecff';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
          }
          ctx.globalAlpha = 1;
          return;
        }
        for (const p of parts) {
          const x = p.x + Math.sin(p.ph) * p.sw;
          ctx.globalAlpha = p.a;
          if (world === 'snow') {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, 6.2832); ctx.fill();
          } else {
            ctx.save();
            ctx.translate(x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.c;
            ctx.beginPath();
            // a leaf is a pointed oval; a petal a rounder one
            const len = p.r, wid = world === 'autumn' ? p.r * 0.55 : p.r * 0.7;
            ctx.moveTo(-len, 0);
            ctx.quadraticCurveTo(0, -wid * 1.6, len, 0);
            ctx.quadraticCurveTo(0, wid * 1.6, -len, 0);
            ctx.fill();
            ctx.restore();
          }
        }
        ctx.globalAlpha = 1;
      }
    };
    return spec;
  }

  let layer = null;
  function _layer() {
    if (layer) return layer;
    layer = VL().createLayer({ id: 'world', fps: 30, variant: variantFor, build });
    return layer;
  }

  return {
    WORLDS, autoWorld, particleCount, variantFor, build,
    mount: (el, opts) => _layer().mount(el, opts),
    unmount: () => _layer().unmount(),
    snapshot: () => _layer().snapshot()
  };
})();

if (typeof window !== 'undefined') {
  window.SeasonalWorlds = SeasonalWorlds;
  if (typeof VexLiving !== 'undefined') {
    VexLiving.registerSettings([
      { key: 'world', label: 'New Tab world', type: 'select', options: [['off', 'Off'], ['auto', 'Follow the season and time of day'], ['autumn', 'Autumn leaves'], ['snow', 'Snow'], ['night', 'Night sky'], ['spring', 'Spring petals']] }
    ]);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SeasonalWorlds };
