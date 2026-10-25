// The sound drawn while a file plays: bars (the spectrum) or a wave, on a canvas, from a Web Audio analyser.
//
// The analyser is fed without touching the sound people hear. If something else already routed this player's element through Web Audio
// (Master Volume, Night mode and the loudness leveller share one route in window.__vexAudio), the analyser listens to that route's
// source. Otherwise it listens to the element's captureStream(), which leaves the element's own output alone. A media element can be
// routed only once, so this never calls createMediaElementSource itself: it could silence the file or break Night mode.

export const MODES = ['bars', 'wave', 'off'];

export function createVisualiser({ canvas, media, color, onLevel }) {
  const ctx2d = canvas.getContext('2d');
  let mode = 'bars';
  let analyser = null, audioCtx = null, tap = null, ownCtx = null, via = '';
  let raf = 0, running = false;
  let freq = null, wave = null;
  let accent = '#888';

  function refreshColor() { accent = color(); }

  function connect() {
    const shared = window.__vexAudio;
    const route = shared && shared.nodes && shared.nodes.get(media);
    if (route && shared.ctx) {
      if (via === 'shared' && analyser) return true;
      disconnect();
      audioCtx = shared.ctx;
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;
      route.source.connect(analyser);
      tap = route.source;
      via = 'shared';
    } else {
      if (via === 'stream' && analyser) return true;
      if (typeof media.captureStream !== 'function') return false;
      const stream = media.captureStream();
      if (!stream.getAudioTracks().length) return false;
      ownCtx = ownCtx || new AudioContext();
      audioCtx = ownCtx;
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;
      tap = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      tap.connect(analyser);     // not connected on to the speakers: the file is already audible through the element
      via = 'stream';
    }
    freq = new Uint8Array(analyser.frequencyBinCount);
    wave = new Uint8Array(analyser.fftSize);
    return true;
  }

  function disconnect() {
    try { if (tap && analyser) tap.disconnect(analyser); } catch { /* vex-allow-empty-catch: it was never connected */ }
    analyser = null; tap = null; via = '';
  }

  function size() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function frame() {
    raf = 0;
    if (!running) return;
    size();
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    let level = 0;
    if (mode !== 'off' && connect()) {
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v; }
      level = Math.sqrt(sum / wave.length);
      ctx2d.fillStyle = accent; ctx2d.strokeStyle = accent;
      if (mode === 'bars') {
        analyser.getByteFrequencyData(freq);
        const bars = Math.max(16, Math.min(64, Math.floor(w / (14 * (window.devicePixelRatio || 1)))));
        const gap = Math.max(2, w / bars * 0.28), bw = w / bars - gap;
        const top = Math.floor(freq.length * 0.72);
        for (let i = 0; i < bars; i++) {
          // Low notes get more bars than high ones, as they do to the ear.
          const a = Math.floor(Math.pow(i / bars, 1.7) * top), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 1.7) * top));
          let peak = 0;
          for (let k = a; k < b; k++) peak = Math.max(peak, freq[k]);
          const bh = Math.max(3, (peak / 255) * h * 0.94);
          const x = i * (bw + gap) + gap / 2, r = Math.min(bw / 2, 6);
          ctx2d.beginPath();
          ctx2d.roundRect(x, h - bh, bw, bh, r);
          ctx2d.fill();
        }
      } else {
        ctx2d.lineWidth = Math.max(2, 2.5 * (window.devicePixelRatio || 1));
        ctx2d.lineJoin = 'round';
        ctx2d.beginPath();
        for (let i = 0; i < wave.length; i++) {
          const x = (i / (wave.length - 1)) * w, y = h / 2 + ((wave[i] - 128) / 128) * h * 0.46;
          if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
      }
    }
    canvas.dataset.level = level.toFixed(3);
    if (onLevel) onLevel(level);
    raf = requestAnimationFrame(frame);
  }

  return {
    get mode() { return mode; },
    setMode(next) {
      if (!MODES.includes(next)) throw new Error('Unknown visualiser mode: ' + next);
      mode = next;
      canvas.hidden = next === 'off';
      if (next === 'off') ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    },
    start() {
      refreshColor();
      if (running) return;
      running = true;
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    refreshColor,
    resume() { if (audioCtx && audioCtx.state === 'suspended' && via === 'stream') audioCtx.resume().catch((err) => console.warn('[Player] the visualiser could not start its audio context:', err.message)); },
    get via() { return via; },
  };
}
