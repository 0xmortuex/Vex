// === Vex Weather Layer ======================================================
//
// A soft weather backdrop for the New Tab page (rain, snow, fog, cloud, a
// quiet sun, a heavier rain for storms). It makes NO network request of its
// own. Where the weather comes from:
//
//   1. The start page's existing opt-in weather card. The user saved a city
//      there ("Set your city", vex.weatherLoc) and the page keeps its last
//      forecast in vex.weatherCache, with a description like "Light rain ·
//      Berlin". This layer only READS that cache. No saved city = nothing to
//      read = nothing drawn (it never asks for a location or looks one up).
//   2. A manual choice (Settings > Living Vex > Weather layer), which works
//      with no location at all.
//
// The cache lives in the START PAGE's storage (file://), a different origin
// from the chrome window's. Mount it from the start page, or pass
// opts.facilityStorage.
//
//   WeatherLayer.mount(el, { storage?, facilityStorage?, isQuiet?, seed? })
//   WeatherLayer.unmount() / WeatherLayer.snapshot()
//
// Off by default. Same quiet rules as every living layer (living-core.js).
// No lightning flashes: it is a backdrop, not an event.

const WeatherLayer = (() => {
  const VL = () => (typeof VexLiving !== 'undefined' ? VexLiving : require('./living-core.js').VexLiving);

  const CONDITIONS = Object.freeze(['clear', 'cloudy', 'rain', 'snow', 'fog', 'storm']);
  const LOC_KEY = 'vex.weatherLoc', CACHE_KEY = 'vex.weatherCache';
  const MAX_AGE_MS = 3 * 60 * 60 * 1000;     // the start page refreshes every 30 min; older than 3 h is not "now"

  // Words the start page's own WMO table produces (start.html `codes`).
  function conditionFromDescription(desc) {
    const s = String(desc || '').toLowerCase();
    if (!s) return '';
    if (/thunder|storm|violent/.test(s)) return 'storm';
    if (/snow/.test(s)) return 'snow';
    if (/rain|drizzle|shower/.test(s)) return 'rain';
    if (/fog|rime|mist/.test(s)) return 'fog';
    if (/overcast|cloud/.test(s)) return 'cloudy';
    if (/clear|sun/.test(s)) return 'clear';
    return '';
  }

  // Reads only what the start page already saved. Returns { condition, reason }.
  function readFacility(storage, now) {
    let s = storage;
    try { if (!s && typeof localStorage !== 'undefined') s = localStorage; } catch { s = null; }
    if (!s) return { condition: '', reason: 'no-storage' };
    let loc = null, cache = null;
    try { loc = JSON.parse(s.getItem(LOC_KEY) || 'null'); } catch { loc = null; }
    if (!loc || loc.lat == null || loc.lon == null) return { condition: '', reason: 'no-saved-city' };
    try { cache = JSON.parse(s.getItem(CACHE_KEY) || 'null'); } catch { cache = null; }
    if (!cache || typeof cache.desc !== 'string') return { condition: '', reason: 'no-forecast-yet' };
    if (typeof cache.t === 'number' && (now || Date.now()) - cache.t > MAX_AGE_MS) return { condition: '', reason: 'stale' };
    const condition = conditionFromDescription(cache.desc);
    return condition ? { condition, reason: 'facility' } : { condition: '', reason: 'unrecognised' };
  }

  // What to draw: the manual choice wins; "auto" uses the facility.
  function resolve(settings, opts) {
    if (!settings.weatherLayer) return { condition: '', reason: 'off' };
    if (settings.weatherManual && settings.weatherManual !== 'auto') return { condition: settings.weatherManual, reason: 'manual' };
    const f = readFacility((opts && opts.facilityStorage) || (opts && opts.storage), opts && opts.nowMs);
    return f;
  }
  const variantFor = (settings, opts) => resolve(settings, opts).condition;

  const COUNT = Object.freeze({ rain: 90, storm: 150, snow: 60, fog: 5, cloudy: 6, clear: 1 });
  function particleCount(cond, w, h) {
    if (!(cond in COUNT)) throw new Error('Unknown weather ' + cond);
    if (cond === 'fog' || cond === 'cloudy' || cond === 'clear') return COUNT[cond];
    return Math.max(20, Math.round(COUNT[cond] * Math.min(1, (w * h) / (1280 * 720))));
  }

  function build(cond, w, h, seed) {
    const rand = VL().rng(seed);
    const n = particleCount(cond, w, h);
    const parts = [];
    const rainy = cond === 'rain' || cond === 'storm';
    for (let i = 0; i < n; i++) {
      parts.push({
        x: rand() * (w + 100), y: rand() * h,
        len: rainy ? 8 + rand() * 12 : 0,
        v: rainy ? (cond === 'storm' ? 620 : 420) + rand() * 200 : cond === 'snow' ? 18 + rand() * 24 : 6 + rand() * 10,
        r: cond === 'snow' ? 1 + rand() * 2.2 : 90 + rand() * 140,
        ph: rand() * 6.28, a: 0.15 + rand() * 0.25
      });
    }
    let t = 0;
    return {
      w, h, meta: { count: n, condition: cond },
      step(dt, still) {
        if (still) return;
        t += dt;
        for (const p of parts) {
          if (rainy) { p.y += p.v * dt; p.x -= p.v * 0.18 * dt; if (p.y > h) { p.y = -p.len; p.x = rand() * (w + 100); } }
          else if (cond === 'snow') { p.y += p.v * dt; p.ph += dt; if (p.y > h) { p.y = -4; p.x = rand() * w; } }
          else if (cond === 'fog' || cond === 'cloudy') { p.x += p.v * dt; if (p.x - p.r > w) p.x = -p.r; }
        }
      },
      paint(ctx, cw, ch) {
        if (rainy) {
          ctx.strokeStyle = '#a9c4e8'; ctx.lineWidth = 1;
          for (const p of parts) {
            ctx.globalAlpha = p.a;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * 0.18, p.y + p.len); ctx.stroke();
          }
        } else if (cond === 'snow') {
          ctx.fillStyle = '#ffffff';
          for (const p of parts) {
            ctx.globalAlpha = 0.4 + p.a;
            ctx.beginPath(); ctx.arc(p.x + Math.sin(p.ph) * 10, p.y, p.r, 0, 6.2832); ctx.fill();
          }
        } else if (cond === 'fog' || cond === 'cloudy') {
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            const y = cond === 'fog' ? ch * (0.45 + 0.1 * i) : ch * (0.05 + 0.07 * i);
            const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, p.r * 1.6);
            const c = cond === 'fog' ? '220,226,234' : '200,208,220';
            g.addColorStop(0, 'rgba(' + c + ',' + (cond === 'fog' ? 0.18 : 0.14) + ')');
            g.addColorStop(1, 'rgba(' + c + ',0)');
            ctx.globalAlpha = 1; ctx.fillStyle = g;
            ctx.fillRect(p.x - p.r * 1.6, y - p.r * 1.6, p.r * 3.2, p.r * 3.2);
          }
        } else {                                   // clear: one slow-breathing warm glow, top right
          const breathe = 0.5 + 0.5 * Math.sin(t * 0.25);
          const g = ctx.createRadialGradient(cw * 0.9, ch * 0.05, 0, cw * 0.9, ch * 0.05, Math.max(cw, ch) * 0.45);
          g.addColorStop(0, 'rgba(255,214,140,' + (0.16 + 0.06 * breathe) + ')');
          g.addColorStop(1, 'rgba(255,214,140,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  let layer = null;
  const _layer = () => layer || (layer = VL().createLayer({ id: 'weather', fps: 30, variant: variantFor, build }));

  return {
    CONDITIONS, conditionFromDescription, readFacility, resolve, variantFor, particleCount, build,
    mount: (el, opts) => _layer().mount(el, opts),
    unmount: () => _layer().unmount(),
    snapshot: () => _layer().snapshot()
  };
})();

if (typeof window !== 'undefined') {
  window.WeatherLayer = WeatherLayer;
  if (typeof VexLiving !== 'undefined') {
    VexLiving.registerSettings([
      { key: 'weatherLayer', label: 'Weather layer on the New Tab page', type: 'toggle' },
      { key: 'weatherManual', label: 'Weather source', type: 'select', options: [['auto', 'Use the city saved on the New Tab weather card'], ['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['snow', 'Snow'], ['fog', 'Fog'], ['storm', 'Storm']] }
    ]);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { WeatherLayer };
