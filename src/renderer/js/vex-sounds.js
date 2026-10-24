// === Sound packs: soft sounds for small actions ============================
//
// Off by default. A tab closing, a timer finishing, an empty inbox and a medal
// can each make a short, quiet sound. There are no audio files: every sound is
// a few sine/triangle notes made with WebAudio when it is asked for, so there
// is nothing to download and nothing to license.
//
// Other features call
//     VexSounds.play('tabClose')
// or fire the event they already fire (vex:medal-earned, vex:timer-done, vex:inbox-zero, vex:tab-closed).
//
// A sound is made only when VexSounds.decide() says so: the packs are switched
// on, the quiet switch is off, Game mode is off, it is not within quiet hours,
// and the volume is above zero. decide() is pure and tested.
const VexSounds = {
  VOLUME_KEY: 'vex.sounds.volume',     // 0..1, default 0.4
  PACK_KEY: 'vex.sounds.pack',         // 'soft' | 'wood' | 'glass'
  HOURS_KEY: 'vex.sounds.hours',       // { enabled, from, to }

  NAMES: ['tabClose', 'timerDone', 'inboxZero', 'medal'],
  PACKS: {
    soft: { label: 'Soft', wave: 'sine', length: 1 },
    wood: { label: 'Wood', wave: 'triangle', length: 0.6 },
    glass: { label: 'Glass', wave: 'sine', length: 1.5, lift: 2 },
  },

  // Notes: f = Hz, t = start (s), d = length (s), g = relative loudness.
  // Short on purpose: nothing here lasts more than about a second.
  RECIPES: {
    tabClose: [{ f: 440, t: 0, d: 0.09, g: 0.5 }, { f: 330, t: 0.06, d: 0.12, g: 0.4 }],
    timerDone: [{ f: 523.25, t: 0, d: 0.28, g: 0.6 }, { f: 659.25, t: 0.2, d: 0.28, g: 0.6 }, { f: 783.99, t: 0.4, d: 0.45, g: 0.6 }],
    inboxZero: [{ f: 392, t: 0, d: 0.22, g: 0.5 }, { f: 587.33, t: 0.14, d: 0.4, g: 0.5 }],
    medal: [{ f: 659.25, t: 0, d: 0.16, g: 0.55 }, { f: 880, t: 0.12, d: 0.16, g: 0.55 }, { f: 1318.5, t: 0.24, d: 0.5, g: 0.5 }],
  },

  // Pure. minutes since midnight of "HH:MM"; null if it is not one.
  _minutes(hhmm) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  },

  // Pure. Are we within quiet hours at `now` (a Date)? A range that crosses
  // midnight (22:00 to 08:00) is handled; from === to is "never".
  inQuietHours(now, hours) {
    if (!hours || !hours.enabled) return false;
    const from = this._minutes(hours.from);
    const to = this._minutes(hours.to);
    if (from === null || to === null || from === to) return false;
    const d = now instanceof Date ? now : new Date(now);
    const at = d.getHours() * 60 + d.getMinutes();
    return from < to ? (at >= from && at < to) : (at >= from || at < to);
  },

  // Pure. '' when the sound may play, else the reason it may not.
  decide({ name, enabled, quiet, gaming, volume, hours, now, preview } = {}) {
    if (!this.RECIPES[name]) return 'unknown sound';
    if (gaming) return 'Game mode is on';
    if (quiet) return 'quiet switch is on';
    if (!enabled && !preview) return 'sounds are off';
    if (!(Number(volume) > 0)) return 'volume is zero';
    if (!preview && this.inQuietHours(now || new Date(), hours)) return 'quiet hours';
    return '';
  },

  // Pure. The notes a pack makes of a sound, with length and pitch applied.
  notesFor(name, pack) {
    const recipe = this.RECIPES[name];
    if (!recipe) throw new Error('Unknown sound ' + name);
    const p = this.PACKS[pack] || this.PACKS.soft;
    return recipe.map(n => ({ f: n.f * (p.lift || 1), t: n.t * p.length, d: n.d * p.length, g: n.g, wave: p.wave }));
  },

  // ---- saved settings ------------------------------------------------------
  volume() {
    const v = Number(VexFun._read(this.VOLUME_KEY));
    return VexFun._read(this.VOLUME_KEY) === null || !Number.isFinite(v) ? 0.4 : Math.min(1, Math.max(0, v));
  },
  setVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('Volume must be between 0 and 1');
    VexFun._write(this.VOLUME_KEY, String(n));
  },
  pack() {
    const p = VexFun._read(this.PACK_KEY);
    return this.PACKS[p] ? p : 'soft';
  },
  setPack(p) {
    if (!this.PACKS[p]) throw new Error('Unknown sound pack ' + p);
    VexFun._write(this.PACK_KEY, p);
  },
  hours() {
    let o = null;
    try { o = JSON.parse(VexFun._read(this.HOURS_KEY) || 'null'); } catch { o = null; }
    const d = { enabled: true, from: '22:00', to: '08:00' };
    if (!o || typeof o !== 'object') return d;
    return {
      enabled: o.enabled !== false,
      from: this._minutes(o.from) === null ? d.from : o.from,
      to: this._minutes(o.to) === null ? d.to : o.to,
    };
  },
  setHours(h) {
    const cur = this.hours();
    const next = { enabled: h.enabled === undefined ? cur.enabled : !!h.enabled, from: h.from === undefined ? cur.from : h.from, to: h.to === undefined ? cur.to : h.to };
    if (this._minutes(next.from) === null || this._minutes(next.to) === null) throw new Error('Quiet hours need times like 22:00');
    VexFun._write(this.HOURS_KEY, JSON.stringify(next));
  },

  // ---- playing -------------------------------------------------------------
  why(name, opts = {}) {
    const reason = this.decide({
      name,
      enabled: VexFun.flag('sounds'),
      quiet: VexFun.quiet(),
      gaming: VexFun.gaming(),
      volume: this.volume(),
      hours: this.hours(),
      now: new Date(),
      preview: !!opts.preview,
    });
    if (reason) return reason;
    // The master level (js/vex-playfulness.js): a sound needs Full, and never plays in Simple mode, Focus, a meeting or Game mode.
    // A preview is the person pressing "Play a sample" and is let through; it is not an ambient sound.
    if (!opts.preview && typeof VexPlayfulness !== 'undefined' && !VexPlayfulness.allowed('sound')) return VexPlayfulness.why('sound');
    return '';
  },

  _ctx: null,
  _context() {
    if (this._ctx) return this._ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('This window has no WebAudio');
    this._ctx = new Ctx();
    return this._ctx;
  },

  // Plays a sound if the rules allow. Returns true when it was started.
  // A refusal is not an error (it is the rules working); a sound that cannot
  // be made at all is, and is reported.
  play(name, opts = {}) {
    if (!this.RECIPES[name]) throw new Error('Unknown sound ' + name);
    const reason = this.why(name, opts);
    this.lastReason = reason;
    if (reason) return false;
    const notes = this.notesFor(name, this.pack());
    // 0.25 keeps full volume still gentle; the slider is a fraction of that.
    const peak = 0.25 * this.volume();
    try {
      const ctx = this._context();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = n.wave;
        osc.frequency.value = n.f;
        const start = t0 + n.t;
        const level = Math.max(0.0002, peak * n.g);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(level, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch { /* already gone */ } };
        osc.start(start);
        osc.stop(start + n.d + 0.03);
      }
      return true;
    } catch (err) {
      console.error('[Sounds] could not play ' + name + ':', err);
      window.showToast?.('Could not play the sound: ' + ((err && err.message) || err), 'error');
      return false;
    }
  },

  // ---- wiring --------------------------------------------------------------
  _lastClose: 0,
  init() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    // (There was a generic 'vex:sound' listener here that nothing ever dispatched; dropped. A
    // module that wants a sound calls VexSounds.play(name), or fires one of the events below.)
    // Things that already announce themselves.
    document.addEventListener('vex:medal-earned', () => this.play('medal'));
    document.addEventListener('vex:timer-done', () => this.play('timerDone'));
    document.addEventListener('vex:inbox-zero', () => this.play('inboxZero'));
    document.addEventListener('vex:tab-closed', () => {
      // The interface sounds (js/ui-sounds.js) play the tab-close sound while they are on: never two.
      if (typeof VexUiSounds !== 'undefined' && VexUiSounds.tabsOn()) return;
      // Closing twenty tabs at once is one soft sound, not twenty.
      const now = Date.now();
      if (now - this._lastClose < 700) return;
      this._lastClose = now;
      this.play('tabClose');
    });
    VexFun.group('play-sounds-settings', 'Play: sound packs', (g) => {
      VexFun.switchRow(g, 'sounds', 'Soft sounds', 'a short, quiet sound when a tab closes, a timer finishes, the inbox is empty or you earn a medal. Made on the spot; nothing is downloaded');
      const volRow = document.createElement('div');
      volRow.className = 'setting-toggle-row';
      const volLabel = document.createElement('span');
      volLabel.textContent = 'Volume';
      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '5';
      vol.value = String(Math.round(this.volume() * 100));
      vol.setAttribute('aria-label', 'Sound volume');
      vol.addEventListener('change', () => this.setVolume(Number(vol.value) / 100));
      volRow.append(volLabel, vol);
      g.appendChild(volRow);
      const packRow = document.createElement('div');
      packRow.className = 'setting-toggle-row';
      const packLabel = document.createElement('span');
      packLabel.textContent = 'Pack';
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Sound pack');
      for (const [id, p] of Object.entries(this.PACKS)) {
        const o = document.createElement('option');
        o.value = id; o.textContent = p.label;
        sel.appendChild(o);
      }
      sel.value = this.pack();
      sel.addEventListener('change', () => this.setPack(sel.value));
      packRow.append(packLabel, sel);
      g.appendChild(packRow);
      const h = this.hours();
      VexFun.toggleRow(g, { label: 'Quiet hours', hint: 'no sounds between the times below', get: () => this.hours().enabled, set: (on) => this.setHours({ enabled: on }) });
      const timeRow = document.createElement('div');
      timeRow.className = 'setting-toggle-row';
      const mk = (value, label, key) => {
        const i = document.createElement('input');
        i.type = 'time'; i.value = value;
        i.setAttribute('aria-label', label);
        i.addEventListener('change', () => {
          try { this.setHours({ [key]: i.value }); } catch (err) { window.showToast?.(err.message, 'error'); i.value = this.hours()[key]; }
        });
        return i;
      };
      const from = document.createElement('span'); from.textContent = 'From';
      const to = document.createElement('span'); to.textContent = 'to';
      timeRow.append(from, mk(h.from, 'Quiet hours start', 'from'), to, mk(h.to, 'Quiet hours end', 'to'));
      g.appendChild(timeRow);
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'btn-secondary';
      prev.style.marginTop = '8px';
      prev.textContent = 'Play a sample';
      prev.addEventListener('click', () => {
        const ok = this.play('medal', { preview: true });
        if (!ok && this.lastReason) window.showToast?.('No sample: ' + this.lastReason);
      });
      g.appendChild(prev);
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexSounds = VexSounds;
  if (typeof document !== 'undefined' && typeof VexFun !== 'undefined') {
    try { VexSounds.init(); } catch (err) { console.error('[Sounds] could not start:', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSounds };
