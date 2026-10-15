// === Vex Focus Scenes =======================================================
//
// Ambient scenes for focus sessions: rain on a window, a fireplace, a coffee
// shop, deep space. A scene is two independent halves:
//
//   * a canvas visual (FocusScenes.mount(el) / unmount(): same quiet rules as
//     every living layer), and
//   * a soundscape synthesised live with WebAudio: filtered noise, oscillators
//     and a handful of randomly timed events. No audio file is bundled or
//     fetched.
//
// Sound is only ever started by you (play()), or, if you switched it on
// (Settings > Living Vex > "Start the scene with a focus session"), when a
// focus session starts. It stops by itself when that session ends (FocusMode's
// timer or Ctrl+K > Focus again, or a Focus Flow ending), and it NEVER plays
// during Game mode: play() refuses, and a game starting fades it out.
//
// An AudioContext is only created on play() and closed on stop(): an idle
// Vex holds no audio device and no timer.

const FocusScenes = (() => {
  const VL = () => (typeof VexLiving !== 'undefined' ? VexLiving : require('./living-core.js').VexLiving);

  const SCENES = Object.freeze(['rain', 'fire', 'cafe', 'space']);
  const LABEL = Object.freeze({ rain: 'Rain on a window', fire: 'Fireplace', cafe: 'Coffee shop', space: 'Deep space' });
  const FADE_S = 2.5;

  // ---- pure helpers (unit-tested) -------------------------------------------
  // Why a scene may not start. '' = it may.
  function playBlock(env, scene) {
    if (!SCENES.includes(scene)) return 'unknown-scene';
    if (env && env.gameActive) return 'game-mode';
    return '';
  }

  // Milliseconds until a focus session's end, or null when there is no end to
  // wait for (a flow with no timer: it is stopped by its own end()).
  function planAutoStop(nowMs, untilMs) {
    if (!Number.isFinite(untilMs) || untilMs <= 0) return null;
    return Math.max(0, untilMs - nowMs);
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  // A perceptual-ish curve: the slider is linear, loudness is not.
  const gainFor = (volume) => Math.pow(clamp01(volume), 2) * 0.9;

  // Gap until the scene's next random event (a drop, a crackle, a clink).
  function nextEventMs(scene, rand) {
    const r = rand();
    switch (scene) {
      case 'rain': return 40 + r * 160;
      case 'fire': return 60 + r * r * 700;
      case 'cafe': return 3000 + r * 9000;
      case 'space': return 6000 + r * 14000;
      default: throw new Error('Unknown scene ' + scene);
    }
  }

  // Noise generators fill a Float32Array in place (so they run on a fake too).
  function fillNoise(data, kind, rand) {
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = rand() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
      } else if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else data[i] = white * 0.5;
    }
    return data;
  }

  // ---- the audio graph ------------------------------------------------------
  // ctx is a real AudioContext, or a fake with the same factory methods (tests).
  function noiseSource(ctx, kind, rand, seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * (seconds || 4)));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    fillNoise(buf.getChannelData(0), kind, rand);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }
  function filter(ctx, type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q;
    return f;
  }
  function gain(ctx, v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function lfo(ctx, rate, depth, target) {
    const o = ctx.createOscillator(); o.frequency.value = rate;
    const g = gain(ctx, depth);
    o.connect(g); g.connect(target);
    o.start();
    return o;
  }

  // One short sound event: a ping (sine with an exponential tail) or a noise tick.
  function ping(ctx, out, freq, level, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.frequency.value = freq;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function tick(ctx, out, bufferSrc, level, dur) {
    // a one-shot of the shared noise buffer, high-passed, with a fast decay
    const s = ctx.createBufferSource(), g = ctx.createGain(), hp = filter(ctx, 'highpass', 1400, 0.7), t = ctx.currentTime;
    s.buffer = bufferSrc.buffer;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(hp); hp.connect(g); g.connect(out);
    s.start(t, 0, dur + 0.02);
  }

  function buildScene(ctx, scene, out, rand) {
    const stoppable = [];
    const bed = (kind, ftype, freq, q, level) => {
      const s = noiseSource(ctx, kind, rand, 4), f = filter(ctx, ftype, freq, q), g = gain(ctx, level);
      s.connect(f); f.connect(g); g.connect(out); s.start();
      stoppable.push(s);
      return { s, f, g };
    };
    let eventFn = null;
    if (scene === 'rain') {
      bed('pink', 'highpass', 700, 0.5, 0.5);
      bed('brown', 'lowpass', 380, 0.5, 0.35);
      eventFn = () => ping(ctx, out, 1400 + rand() * 2600, 0.02 + rand() * 0.03, 0.05);
    } else if (scene === 'fire') {
      const b = bed('brown', 'lowpass', 650, 0.7, 0.8);
      stoppable.push(lfo(ctx, 0.23, 0.15, b.g.gain));
      const crackle = noiseSource(ctx, 'white', rand, 1);
      crackle.start(); stoppable.push(crackle);
      eventFn = () => tick(ctx, out, crackle, 0.12 + rand() * 0.25, 0.012 + rand() * 0.03);
    } else if (scene === 'cafe') {
      const b = bed('pink', 'bandpass', 520, 0.6, 0.45);
      stoppable.push(lfo(ctx, 0.11, 0.12, b.g.gain));
      eventFn = () => { const f = 2200 + rand() * 1400; ping(ctx, out, f, 0.025, 0.5); ping(ctx, out, f * 1.51, 0.012, 0.35); };
    } else if (scene === 'space') {
      const lp = filter(ctx, 'lowpass', 320, 0.7), g = gain(ctx, 0.35);
      lp.connect(g); g.connect(out);
      for (const f of [55, 55.35, 82.4, 110.2]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const og = gain(ctx, 0.18); o.connect(og); og.connect(lp); o.start(); stoppable.push(o);
      }
      stoppable.push(lfo(ctx, 0.05, 0.12, g.gain));
      bed('pink', 'lowpass', 220, 0.5, 0.06);
      eventFn = () => ping(ctx, out, 220 + rand() * 440, 0.012, 4);
    } else throw new Error('Unknown scene ' + scene);
    return { stoppable, eventFn };
  }

  // ---- the player -----------------------------------------------------------
  const state = { scene: '', playing: false, volume: 0.35, startedAt: 0, autoStopAt: 0 };
  let ctx = null, master = null, built = null, eventTimer = null, autoTimer = null, closeTimer = null;
  let rand = Math.random;

  function _events() {
    if (!built || !built.eventFn) return;
    try { built.eventFn(); } catch (err) { console.error('[FocusScenes] sound event failed:', err); }
    eventTimer = setTimeout(_events, nextEventMs(state.scene, rand));
  }

  function _teardown() {
    clearTimeout(eventTimer); eventTimer = null;
    clearTimeout(autoTimer); autoTimer = null;
    clearTimeout(closeTimer); closeTimer = null;
    if (built) for (const n of built.stoppable) { try { n.stop(); } catch { /* already stopped */ } }
    built = null;
    const c = ctx; ctx = null; master = null;
    if (c && typeof c.close === 'function') c.close().catch((err) => console.error('[FocusScenes] closing audio:', err));
  }

  // opts: { volume?, untilMs?, ctxFactory?, env?, random? }
  async function play(scene, opts) {
    const o = opts || {};
    const block = playBlock(o.env || VL().readEnv(), scene);
    if (block) throw new Error(block === 'game-mode' ? 'Scenes stay silent in Game mode' : 'Unknown scene ' + scene);
    if (state.playing) stop('replaced', { immediate: true });
    if (ctx) _teardown();                      // a scene still fading out is cut, not left to close the new one
    rand = o.random || Math.random;
    const make = o.ctxFactory || (() => new (window.AudioContext || window.webkitAudioContext)());
    ctx = make();
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') await ctx.resume();
    } catch (err) { _teardown(); throw new Error('The sound device could not start: ' + (err && err.message)); }
    state.volume = clamp01(o.volume != null ? o.volume : state.volume);
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    built = buildScene(ctx, scene, master, rand);
    master.gain.linearRampToValueAtTime(gainFor(state.volume), ctx.currentTime + FADE_S);
    state.scene = scene; state.playing = true; state.startedAt = Date.now();
    eventTimer = setTimeout(_events, nextEventMs(scene, rand));
    const wait = planAutoStop(Date.now(), o.untilMs);
    state.autoStopAt = wait === null ? 0 : Date.now() + wait;
    if (wait !== null) autoTimer = setTimeout(() => stop('session-ended'), wait);
    return true;
  }

  function setVolume(v) {
    state.volume = clamp01(v);
    if (master && ctx) master.gain.linearRampToValueAtTime(gainFor(state.volume), ctx.currentTime + 0.15);
    return state.volume;
  }

  function stop(why, o) {
    if (!state.playing) return false;
    state.playing = false;
    state.autoStopAt = 0;
    const immediate = !!(o && o.immediate);
    if (!immediate && master && ctx) {
      clearTimeout(eventTimer); eventTimer = null;
      clearTimeout(autoTimer); autoTimer = null;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_S);
      closeTimer = setTimeout(_teardown, FADE_S * 1000 + 100);
    } else _teardown();
    state.lastStop = why || 'stopped';
    return true;
  }

  // ---- focus + game hooks ---------------------------------------------------
  let _installed = false;
  function _toast(msg, kind) { try { if (typeof window !== 'undefined' && window.showToast) window.showToast(msg, kind); } catch { /* no toast */ } }

  function _startWithFocus(untilMs) {
    const s = VL().read();
    if (!s.sceneWithFocus || s.scene === 'off') return;
    play(s.scene, { volume: s.sceneVolume, untilMs }).catch((err) => _toast('Focus scene sound did not start: ' + err.message, 'error'));
  }

  // Wraps the existing focus entry points once; each wrapper runs the original
  // first and cannot stop a focus session from starting or ending.
  function install(deps) {
    if (_installed) return false;
    const d = deps || {};
    const FM = d.FocusMode || (typeof FocusMode !== 'undefined' ? FocusMode : null);
    const FF = d.FocusFlows || (typeof FocusFlows !== 'undefined' ? FocusFlows : null);
    if (!FM && !FF) return false;
    _installed = true;
    const wrap = (obj, name, after) => {
      if (!obj || typeof obj[name] !== 'function') return;
      const orig = obj[name].bind(obj);
      obj[name] = function (...a) {
        const r = orig(...a);
        try { after(r, a); } catch (err) { console.error('[FocusScenes] ' + name + ' hook:', err); }
        return r;
      };
    };
    wrap(FM, 'start', () => _startWithFocus(FM.until));
    wrap(FM, 'stop', () => stop('session-ended'));
    wrap(FF, 'activate', () => _startWithFocus(0));
    wrap(FF, 'end', () => stop('session-ended'));
    if (typeof document !== 'undefined') {
      document.addEventListener('vex:game-mode', (e) => { if (e.detail && e.detail.active) stop('game-mode'); });
    }
    return true;
  }

  // ---- the visuals ----------------------------------------------------------
  function buildVisual(scene, w, h, seed) {
    const r = VL().rng(seed);
    let t = 0;
    const N = { rain: 28, fire: 22, cafe: 14, space: 90 }[scene];
    const parts = [];
    for (let i = 0; i < N; i++) parts.push({ x: r() * w, y: r() * h, s: 0.4 + r() * 1.2, ph: r() * 6.28, v: 6 + r() * 30 });
    const bg = { rain: ['#16202e', '#0c121b'], fire: ['#1d0f08', '#0b0604'], cafe: ['#2a1b12', '#150d08'], space: ['#070916', '#020308'] }[scene];
    return {
      w, h, meta: { count: N, scene },
      step(dt, still) {
        if (still) return;
        t += dt;
        for (const p of parts) {
          if (scene === 'rain') { p.y += p.v * dt * 3; if (p.y > h) { p.y = -10; p.x = r() * w; } }
          else if (scene === 'fire') { p.y -= p.v * dt * 1.5; p.x += Math.sin(t * 2 + p.ph) * 8 * dt; if (p.y < h * 0.3) { p.y = h * 0.95; p.x = w * (0.35 + r() * 0.3); } }
          else if (scene === 'cafe') { p.y -= p.v * dt * 0.4; if (p.y < -20) { p.y = h + 10; p.x = r() * w; } }
          else { p.x -= p.v * dt * 0.15; if (p.x < 0) p.x = w; }
        }
      },
      paint(ctx, cw, ch) {
        const g = ctx.createLinearGradient(0, 0, 0, ch);
        g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
        if (scene === 'rain') {
          ctx.fillStyle = '#9db8d8';
          for (const p of parts) {
            ctx.globalAlpha = 0.3;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, 1.4 * p.s, 3 * p.s, 0, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = 0.1; ctx.fillRect(p.x - 0.4, p.y - 22 * p.s, 0.8, 22 * p.s);
          }
        } else if (scene === 'fire') {
          const fl = 0.85 + 0.15 * Math.sin(t * 7) * Math.sin(t * 3.1);
          const fg = ctx.createRadialGradient(cw / 2, ch, 0, cw / 2, ch, ch * 0.9 * fl);
          fg.addColorStop(0, 'rgba(255,170,60,0.55)'); fg.addColorStop(0.5, 'rgba(200,70,20,0.22)'); fg.addColorStop(1, 'rgba(120,30,10,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.fillRect(0, 0, cw, ch);
          ctx.fillStyle = '#ffb454';
          for (const p of parts) { ctx.globalAlpha = Math.max(0, (p.y / ch) - 0.2); ctx.fillRect(p.x, p.y, 1.5 * p.s, 1.5 * p.s); }
        } else if (scene === 'cafe') {
          for (const p of parts) {
            ctx.globalAlpha = 0.07 + 0.05 * Math.sin(t + p.ph);
            ctx.fillStyle = '#ffcf8a';
            ctx.beginPath(); ctx.arc(p.x, p.y, 10 + 14 * p.s, 0, 6.2832); ctx.fill();
          }
        } else {
          ctx.fillStyle = '#dfe6ff';
          for (const p of parts) {
            ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 0.6 + p.ph);
            ctx.fillRect(p.x, p.y, p.s, p.s);
          }
          const ng = ctx.createRadialGradient(cw * 0.7, ch * 0.4, 0, cw * 0.7, ch * 0.4, cw * 0.5);
          ng.addColorStop(0, 'rgba(90,70,160,0.18)'); ng.addColorStop(1, 'rgba(90,70,160,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = ng; ctx.fillRect(0, 0, cw, ch);
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  let layer = null;
  const _layer = () => layer || (layer = VL().createLayer({
    id: 'scene', fps: 24,
    variant: (settings, opts) => (opts && opts.scene && SCENES.includes(opts.scene)) ? opts.scene : (SCENES.includes(settings.scene) ? settings.scene : ''),
    build: buildVisual
  }));

  return {
    SCENES, LABEL, playBlock, planAutoStop, gainFor, nextEventMs, fillNoise, buildScene, buildVisual,
    play, stop, setVolume, install,
    state: () => ({ ...state }),
    mount: (el, opts) => _layer().mount(el, opts),
    unmount: () => _layer().unmount(),
    snapshot: () => ({ ..._layer().snapshot(), audio: { playing: state.playing, scene: state.scene, volume: state.volume, autoStopAt: state.autoStopAt } }),
    _reset() { stop('reset', { immediate: true }); _installed = false; state.scene = ''; state.lastStop = undefined; }
  };
})();

if (typeof window !== 'undefined') {
  window.FocusScenes = FocusScenes;
  if (typeof VexLiving !== 'undefined') {
    VexLiving.registerSettings([
      { key: 'scene', label: 'Focus scene', type: 'select', options: [['off', 'Off'], ['rain', 'Rain on a window'], ['fire', 'Fireplace'], ['cafe', 'Coffee shop'], ['space', 'Deep space']] },
      { key: 'sceneVolume', label: 'Scene volume', type: 'range' },
      { key: 'sceneWithFocus', label: 'Start the scene when a focus session starts', type: 'toggle' }
    ]);
    document.addEventListener('DOMContentLoaded', () => FocusScenes.install());
    if (document.readyState !== 'loading') FocusScenes.install();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { FocusScenes };
