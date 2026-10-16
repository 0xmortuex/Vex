// === Startup and focus-finish jingle composer ==================================
//
// Compose a tiny tune (up to 8 notes, a pentatonic scale so every combination
// sounds fine) on one of a few built-in WebAudio synth instruments, and have
// it play when Vex starts and/or when a focus session ends.
//
//   VexJingle.INSTRUMENTS, VexJingle.PRESETS
//   VexJingle.events(jingle)       pure: [{ at, dur, freq }] in seconds
//   VexJingle.get()                the saved settings
//   VexJingle.set(patch)           validated; throws on a bad value
//   VexJingle.preview(slot)        plays that slot's tune now, even while
//                                  nothing is switched on
//   VexJingle.playSlot(slot)       what startup / focus end call: plays only
//                                  when that slot is on and no game runs
//
// OFF by default, at both moments. Silent while a game is running. The only
// sound is the one tune you composed, at the volume you chose; there is no
// sound for anything else and no random sound.
//
// Storage: localStorage `vex.jingle`. Per device.
// Event in: `vex:focus-complete` (js/focus-mode.js, natural end of a session).
const VexJingle = {
  KEY: 'vex.jingle',
  SLOTS: ['startup', 'finish'],
  SLOT_NAMES: { startup: 'When Vex starts', finish: 'When a focus session ends' },
  MAX_NOTES: 8,
  MAX_DEGREE: 14,           // three octaves of a five-note scale
  PENT: [0, 2, 4, 7, 9],    // major pentatonic, in semitones from C
  BASE_HZ: 261.6256,        // C4
  STEP: 0.2,                // seconds per note at tempo 100

  INSTRUMENTS: [
    { id: 'bell', name: 'Bell', wave: 'sine', overtone: 2.76, overtoneGain: 0.35, attack: 0.005, decay: 1.4 },
    { id: 'marimba', name: 'Marimba', wave: 'triangle', overtone: 4, overtoneGain: 0.18, attack: 0.003, decay: 0.45 },
    { id: 'chip', name: 'Chip', wave: 'square', overtone: 0, overtoneGain: 0, attack: 0.002, decay: 0.22, level: 0.45 },
    { id: 'pad', name: 'Soft pad', wave: 'sawtooth', overtone: 0, overtoneGain: 0, attack: 0.08, decay: 0.9, lowpass: 1400, level: 0.5 },
    { id: 'pluck', name: 'Pluck', wave: 'triangle', overtone: 2, overtoneGain: 0.3, attack: 0.002, decay: 0.7, lowpass: 3200 },
  ],

  // Degrees into the scale; null is a rest.
  PRESETS: [
    { id: 'rise', name: 'Rising', notes: [0, 2, 4, 7] },
    { id: 'chime', name: 'Two chimes', notes: [7, null, 4] },
    { id: 'fanfare', name: 'Little fanfare', notes: [0, 2, 4, 7, 9, 12] },
    { id: 'calm', name: 'Settling down', notes: [9, 7, 4, 2, 0] },
    { id: 'hello', name: 'Hello', notes: [4, 7, null, 9] },
  ],

  DEFAULTS() {
    return {
      volume: 40,
      startup: { on: false, instrument: 'bell', notes: [0, 2, 4, 7] },
      finish: { on: false, instrument: 'marimba', notes: [9, 7, 4, 2, 0] },
    };
  },

  _validNotes(notes) {
    if (!Array.isArray(notes)) throw new Error('A jingle is a list of notes');
    if (notes.length < 1 || notes.length > this.MAX_NOTES) throw new Error('A jingle has 1 to ' + this.MAX_NOTES + ' notes');
    if (notes.every(n => n === null)) throw new Error('A jingle of only rests makes no sound');
    for (const n of notes) {
      if (n === null) continue;
      if (!Number.isInteger(n) || n < 0 || n > this.MAX_DEGREE) throw new Error('Each note is a rest or a whole number from 0 to ' + this.MAX_DEGREE);
    }
    return notes.slice();
  },

  get() {
    const d = this.DEFAULTS();
    const raw = VexExpression.read(this.KEY, null);
    if (!raw || typeof raw !== 'object') return d;
    const out = { volume: Number.isInteger(raw.volume) && raw.volume >= 0 && raw.volume <= 100 ? raw.volume : d.volume };
    for (const s of this.SLOTS) {
      const r = raw[s] && typeof raw[s] === 'object' ? raw[s] : {};
      let notes = d[s].notes;
      try { notes = this._validNotes(r.notes); } catch { /* keep the default tune */ }
      out[s] = {
        on: r.on === true,
        instrument: this.INSTRUMENTS.some(i => i.id === r.instrument) ? r.instrument : d[s].instrument,
        notes,
      };
    }
    return out;
  },

  // patch: { volume?, startup?: {on?, instrument?, notes?}, finish?: {...} }
  set(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('Nothing to save');
    const cur = this.get();
    if ('volume' in patch) {
      const v = Number(patch.volume);
      if (!Number.isInteger(v) || v < 0 || v > 100) throw new Error('Volume is a whole number from 0 to 100');
      cur.volume = v;
    }
    for (const s of this.SLOTS) {
      const p = patch[s];
      if (!p) continue;
      if ('on' in p) {
        if (typeof p.on !== 'boolean') throw new Error('On or off');
        cur[s].on = p.on;
      }
      if ('instrument' in p) {
        if (!this.INSTRUMENTS.some(i => i.id === p.instrument)) throw new Error('Unknown instrument: ' + p.instrument);
        cur[s].instrument = p.instrument;
      }
      if ('notes' in p) cur[s].notes = this._validNotes(p.notes);
    }
    VexExpression.write(this.KEY, cur);
    if (this.SLOTS.some(s => patch[s] && 'notes' in patch[s])) VexExpression.signal('jingle-composed');
    return cur;
  },

  freq(degree) {
    const oct = Math.floor(degree / this.PENT.length);
    return this.BASE_HZ * Math.pow(2, (this.PENT[degree % this.PENT.length] + 12 * oct) / 12);
  },

  // Pure. Times in seconds from the start.
  events(jingle) {
    const notes = this._validNotes(jingle.notes);
    const inst = this.INSTRUMENTS.find(i => i.id === jingle.instrument);
    if (!inst) throw new Error('Unknown instrument: ' + jingle.instrument);
    const out = [];
    notes.forEach((n, i) => {
      if (n === null) return;
      out.push({ at: Math.round(i * this.STEP * 1000) / 1000, dur: inst.decay, freq: Math.round(this.freq(n) * 100) / 100, instrument: inst.id });
    });
    return out;
  },

  // The whole length, so the context can be closed afterwards.
  length(jingle) {
    const inst = this.INSTRUMENTS.find(i => i.id === jingle.instrument);
    return jingle.notes.length * this.STEP + (inst ? inst.decay : 1);
  },

  _ctx: null,
  _context() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This window has no audio output');
    if (!this._ctx || this._ctx.state === 'closed') this._ctx = new AC();
    return this._ctx;
  },

  // Plays `jingle` ({ instrument, notes }) at `volume` 0-100. Returns the
  // number of notes scheduled.
  _play(jingle, volume) {
    const evs = this.events(jingle);
    const ctx = this._context();
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => { /* the user has not interacted yet */ });
    const master = ctx.createGain();
    // Quadratic: the slider's lower half is genuinely quiet.
    master.gain.value = Math.pow(Math.max(0, Math.min(100, volume)) / 100, 2) * 0.5;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.03;
    for (const e of evs) {
      const inst = this.INSTRUMENTS.find(i => i.id === e.instrument);
      const env = ctx.createGain();
      const start = t0 + e.at;
      const lvl = inst.level || 1;
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(lvl, start + inst.attack);
      env.gain.exponentialRampToValueAtTime(0.0001, start + inst.decay);
      let sink = env;
      if (inst.lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = inst.lowpass;
        f.connect(env);
        sink = f;
      }
      env.connect(master);
      const o = ctx.createOscillator();
      o.type = inst.wave; o.frequency.value = e.freq;
      o.connect(sink);
      o.start(start); o.stop(start + inst.decay + 0.05);
      if (inst.overtone) {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'sine'; o2.frequency.value = e.freq * inst.overtone;
        g2.gain.value = inst.overtoneGain;
        o2.connect(g2); g2.connect(sink);
        o2.start(start); o2.stop(start + inst.decay + 0.05);
      }
    }
    return evs.length;
  },

  // The explicit button: plays the saved tune of a slot, on or off.
  preview(slot) {
    if (!this.SLOTS.includes(slot)) throw new Error('Unknown jingle: ' + slot);
    const s = this.get();
    return this._play(s[slot], s.volume);
  },

  // What the moments themselves call.
  playSlot(slot) {
    if (!this.SLOTS.includes(slot)) throw new Error('Unknown jingle: ' + slot);
    const s = this.get();
    if (!s[slot].on) return false;
    if (VexExpression.gaming()) return false;
    // The master level (js/vex-playfulness.js): no tune in Simple mode, Focus, a meeting, on battery saver or with reduced motion.
    if (typeof VexPlayfulness !== 'undefined' && !VexPlayfulness.allowed('jingle')) return false;
    if (s.volume === 0) return false;
    this._play(s[slot], s.volume);
    return true;
  },

  // Called once when the window has loaded.
  startup(delayMs) {
    if (this._started) return false;
    this._started = true;
    let s;
    try { s = this.get(); } catch (err) { console.error('[VexJingle]', err); return false; }
    if (!s.startup.on) return false;
    setTimeout(() => {
      try { this.playSlot('startup'); }
      catch (err) { console.warn('[VexJingle] the startup jingle did not play:', err && err.message); }
    }, delayMs == null ? 1200 : delayMs);
    return true;
  },

  wire() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    document.addEventListener('vex:focus-complete', () => {
      try { this.playSlot('finish'); }
      catch (err) { console.warn('[VexJingle] the finish jingle did not play:', err && err.message); }
    });
  },

  // --- settings ----------------------------------------------------------------
  renderSettings(container) {
    const X = VexExpression;
    const draw = () => {
      const s = this.get();
      container.innerHTML = '';
      const intro = document.createElement('p');
      intro.className = 'setting-info muted';
      intro.style.margin = '0 0 8px';
      intro.textContent = 'Compose a short tune for Vex to play. Both are off until you turn them on, and nothing plays while a game is running.';
      container.appendChild(intro);

      const vol = document.createElement('label');
      vol.className = 'setting-toggle-row';
      vol.innerHTML = '<span>Volume</span><input type="range" min="0" max="100" step="5" aria-label="Jingle volume" style="width:160px">';
      const vr = vol.querySelector('input');
      vr.value = String(s.volume);
      vr.addEventListener('change', () => {
        try { this.set({ volume: Number(vr.value) }); }
        catch (err) { X.toast(err.message, 'error'); }
      });
      container.appendChild(vol);

      for (const slot of this.SLOTS) {
        const cfg = s[slot];
        const box = document.createElement('div');
        box.style.cssText = 'margin-top:10px';
        box.appendChild(X.toggleRow(this.SLOT_NAMES[slot], '', cfg.on, (on) => { this.set({ [slot]: { on } }); }));

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0';
        const inst = document.createElement('select');
        inst.className = 'set-input';
        inst.setAttribute('aria-label', this.SLOT_NAMES[slot] + ': instrument');
        inst.innerHTML = this.INSTRUMENTS.map(i => `<option value="${i.id}">${X.esc(i.name)}</option>`).join('');
        inst.value = cfg.instrument;
        inst.addEventListener('change', () => {
          try { this.set({ [slot]: { instrument: inst.value } }); } catch (err) { X.toast(err.message, 'error'); }
        });
        row.appendChild(inst);

        const pre = document.createElement('select');
        pre.className = 'set-input';
        pre.setAttribute('aria-label', this.SLOT_NAMES[slot] + ': start from a tune');
        pre.innerHTML = '<option value="">Start from a tune...</option>' + this.PRESETS.map(p => `<option value="${p.id}">${X.esc(p.name)}</option>`).join('');
        pre.addEventListener('change', () => {
          const p = this.PRESETS.find(x => x.id === pre.value);
          if (!p) return;
          try { this.set({ [slot]: { notes: p.notes } }); draw(); } catch (err) { X.toast(err.message, 'error'); }
        });
        row.appendChild(pre);

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn-secondary';
        play.textContent = 'Preview';
        play.addEventListener('click', () => {
          try { this.preview(slot); } catch (err) { X.toast(err.message, 'error'); }
        });
        row.appendChild(play);
        box.appendChild(row);

        // The eight steps.
        const steps = document.createElement('div');
        steps.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
        for (let i = 0; i < this.MAX_NOTES; i++) {
          const sel = document.createElement('select');
          sel.className = 'set-input';
          sel.style.width = '62px';
          sel.setAttribute('aria-label', this.SLOT_NAMES[slot] + ': note ' + (i + 1));
          let html = '<option value="end">(end)</option>';
          if (i < cfg.notes.length || i === cfg.notes.length) {
            html += '<option value="rest">rest</option>';
            for (let d = 0; d <= this.MAX_DEGREE; d++) html += `<option value="${d}">${d + 1}</option>`;
          }
          sel.innerHTML = html;
          sel.disabled = i > cfg.notes.length;
          sel.value = i >= cfg.notes.length ? 'end' : (cfg.notes[i] === null ? 'rest' : String(cfg.notes[i]));
          sel.addEventListener('change', () => {
            const notes = cfg.notes.slice();
            if (sel.value === 'end') notes.length = i;
            else notes[i] = sel.value === 'rest' ? null : Number(sel.value);
            try { this.set({ [slot]: { notes } }); draw(); }
            catch (err) { X.toast(err.message, 'error'); draw(); }
          });
          steps.appendChild(sel);
        }
        box.appendChild(steps);
        container.appendChild(box);
      }
      // The toggles above re-read through get() on the next change; draw()
      // is only needed when the notes change.
    };
    draw();
  },
};

if (typeof window !== 'undefined') window.VexJingle = VexJingle;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexJingle };
