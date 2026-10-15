// === Vex on battery ==========================================================
//
// Opt-in. When Windows says this PC is running on its battery, Vex asks less
// of it, and says so in one chip in the toolbar:
//
//   sleep sooner     the ONE idle-tab timer (TabManager.startAutoSleep) uses a
//                    shorter wait — 10 minutes, 5 when the charge is low. No
//                    new sleep path: the same timer, the same consent gate
//                    (js/sleep-consent.js) and the same _isKeptAwake check, so
//                    a tab that is playing sound, on a call, being recorded,
//                    pinned (when pinned tabs are excluded) or kept awake is
//                    left exactly as it was.
//   wait             background jobs that opted in (VexJobs { deferOnBattery })
//                    are HELD, the same way a game holds them, and each runs
//                    once when the PC is plugged in. Recall indexing and the
//                    sync pull are queued here (defer) and run then.
//   hold AI          background AI (history summaries, scheduled tasks) waits,
//                    as it does for a game. A question you ask is answered.
//   keep still       Vex's own animations stop (the same rule a game uses).
//
// What it cannot see: Electron does not expose Windows' Battery Saver switch,
// so this follows mains / battery and the charge level only. A PC with no
// battery (a desktop) is detected and nothing at all happens there.
//
// Mains <-> battery can flap (a loose plug, a docking station). A change of
// verdict is acted on only after it has held for SETTLE_MS; switching the mode
// off, or finding there is no battery, is immediate.
const BatteryMode = {
  KEYS: {
    enabled: 'vex.battery.enabled',        // '1' | absent        (default OFF)
    sleepSooner: 'vex.battery.sleepSooner', // 'off' | absent     (default on, once enabled)
    holdJobs: 'vex.battery.holdJobs',
    holdAi: 'vex.battery.holdAi',
    still: 'vex.battery.still',
    lowPercent: 'vex.battery.lowPercent',  // number
  },
  SETTLE_MS: 10000,
  LOW_DEFAULT: 20,
  FLUSH_GAP_MS: 3000,
  QUEUE_MAX: 60,

  // What the PC reported, and what has been acted on.
  hw: { hasBattery: null, onBattery: false, percent: null, error: '' },
  level: 'off',            // 'off' | 'unknown' | 'no-battery' | 'ac' | 'battery' | 'low'
  _pending: null,
  _timer: null,
  _settled: false,         // false until the first verdict is acted on at once
  _queue: new Map(),
  dropped: 0,
  _running: false,

  // ---- settings -----------------------------------------------------------
  enabled() { try { return localStorage.getItem(this.KEYS.enabled) === '1'; } catch { return false; } },
  setEnabled(on) {
    try { if (on) localStorage.setItem(this.KEYS.enabled, '1'); else localStorage.removeItem(this.KEYS.enabled); }
    catch (err) { window.VexProblems?.note('Battery', 'Could not save the setting', err); throw err; }
    return on ? this.start() : this.stop();
  },
  setting(name) {
    if (!['sleepSooner', 'holdJobs', 'holdAi', 'still'].includes(name)) throw new Error('Unknown battery setting ' + name);
    try { return localStorage.getItem(this.KEYS[name]) !== 'off'; } catch { return true; }
  },
  setSetting(name, on) {
    if (!['sleepSooner', 'holdJobs', 'holdAi', 'still'].includes(name)) throw new Error('Unknown battery setting ' + name);
    const before = { lean: this.isLean(), held: this.holdingJobs() };
    try { localStorage.setItem(this.KEYS[name], on ? 'on' : 'off'); } catch (err) { window.VexProblems?.note('Battery', 'Could not save the setting', err); throw err; }
    this._apply(before);
  },
  lowPercent() {
    let n = this.LOW_DEFAULT;
    try { const v = Number(localStorage.getItem(this.KEYS.lowPercent)); if (v >= 5 && v <= 50) n = v; } catch { /* default */ }
    return n;
  },
  setLowPercent(n) {
    const v = Number(n);
    if (!(v >= 5 && v <= 50)) throw new Error('The low-battery level must be between 5 and 50 percent');
    try { localStorage.setItem(this.KEYS.lowPercent, String(Math.round(v))); } catch (err) { window.VexProblems?.note('Battery', 'Could not save the setting', err); throw err; }
    this._evaluate();
  },

  // ---- the state machine --------------------------------------------------
  // Pure: what the inputs mean. 'unknown' = Windows has not said yet (or would
  // not), which is never treated as being on battery.
  verdict({ enabled, hasBattery, onBattery, percent, lowPercent }) {
    if (!enabled) return 'off';
    if (hasBattery === false) return 'no-battery';
    if (hasBattery !== true) return 'unknown';
    if (!onBattery) return 'ac';
    if (typeof percent === 'number' && percent <= lowPercent) return 'low';
    return 'battery';
  },
  leanLevel(level) { return level === 'battery' || level === 'low'; },
  isLean() { return this.leanLevel(this.level); },

  // Something new is known: { hasBattery, onBattery, percent, error }.
  ingest(partial) {
    this.hw = { ...this.hw, ...partial };
    this._evaluate();
  },

  _evaluate() {
    const target = this.verdict({
      enabled: this.enabled(), hasBattery: this.hw.hasBattery, onBattery: this.hw.onBattery,
      percent: this.hw.percent, lowPercent: this.lowPercent(),
    });
    if (target === this.level) { this._clearPending(); return this.level; }
    // At once: switching off, nothing to save here, or the very first answer
    // (starting up on battery should not wait ten seconds).
    if (target === 'off' || target === 'no-battery' || target === 'unknown' || !this._settled) {
      this._clearPending();
      if (target !== 'off' && target !== 'unknown') this._settled = true;
      return this._commit(target);
    }
    if (target === this._pending) return this.level;   // already counting towards it
    this._clearPending();
    this._pending = target;
    this._timer = setTimeout(() => {
      this._timer = null;
      const t = this._pending;
      this._pending = null;
      // Re-read: the answer may have gone back while the timer ran.
      const now = this.verdict({
        enabled: this.enabled(), hasBattery: this.hw.hasBattery, onBattery: this.hw.onBattery,
        percent: this.hw.percent, lowPercent: this.lowPercent(),
      });
      if (now === t) this._commit(t);
      else if (now !== this.level) this._evaluate();
    }, this.SETTLE_MS);
    return this.level;
  },

  _clearPending() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._pending = null;
  },

  _commit(level) {
    const before = { lean: this.isLean(), held: this.holdingJobs() };
    this.level = level;
    this._apply(before);
    return level;
  },

  // Make the screen, the jobs and main agree with this.level. Idempotent, so a
  // settings change while on battery calls it again. `before` is what was true
  // before the change, so only leaving the held state runs the owed work.
  _apply(before) {
    const lean = this.isLean();
    const jobsHeld = this.holdingJobs();
    const wasLean = before ? before.lean : lean;
    const wasHeld = before ? before.held : jobsHeld;
    if (typeof document !== 'undefined' && document.body) {
      document.body.dataset.batteryMode = this.level;
      document.body.classList.toggle('vex-battery-still', lean && this.setting('still'));
    }
    this._paintChip();
    try { if (window.vex && typeof window.vex.powerLean === 'function') Promise.resolve(window.vex.powerLean(jobsHeld)).catch(err => window.VexProblems?.note('Battery', 'Main did not take the battery state', err)); }
    catch (err) { window.VexProblems?.note('Battery', 'Could not tell the main process', err); }
    if (typeof VexJobs !== 'undefined') {
      // Entering: stop waking for jobs that are now held. Leaving, or no
      // longer holding: every owed job runs once.
      if (jobsHeld) VexJobs._arm(); else if (wasHeld) VexJobs.resume();
    }
    if (!jobsHeld && wasHeld) this._flush();
    if (typeof document !== 'undefined' && wasLean !== lean) {
      try { document.dispatchEvent(new CustomEvent('vex:battery-mode', { detail: { level: this.level, lean } })); } catch { /* no DOM events here */ }
    }
  },

  // ---- what the rest of Vex asks ------------------------------------------
  holdingJobs() { return this.isLean() && this.setting('holdJobs'); },
  holdingAi() { return this.isLean() && this.setting('holdAi'); },

  // The idle-tab timer's wait, given the one the user chose.
  sleepMinutes(base) {
    const b = Number(base) > 0 ? Number(base) : 30;
    if (!this.isLean() || !this.setting('sleepSooner')) return b;
    return Math.min(b, this.level === 'low' ? 5 : 10);
  },

  // Work with no schedule of its own (a page to index, a sync pull). Returns
  // true when it was put off — it runs once, when the PC is plugged in — and
  // false when the caller should just do it now. One entry per key: the latest
  // wins.
  defer(key, fn) {
    if (typeof fn !== 'function') throw new Error('BatteryMode.defer: ' + key + ' has no function');
    if (!this.holdingJobs()) return false;
    if (!this._queue.has(key) && this._queue.size >= this.QUEUE_MAX) {
      this._queue.delete(this._queue.keys().next().value);
      this.dropped++;
    }
    this._queue.delete(key);
    this._queue.set(key, fn);
    return true;
  },

  _flush() {
    if (!this._queue.size) return;
    const fns = [...this._queue.values()];
    this._queue.clear();
    fns.forEach((fn, i) => setTimeout(() => {
      // Plugged in again but gone back to battery meanwhile: put it back.
      try {
        const r = fn();
        if (r && typeof r.then === 'function') r.catch(err => window.VexProblems?.note('Battery', 'A put-off task failed', err));
      } catch (err) { window.VexProblems?.note('Battery', 'A put-off task failed', err); }
    }, i * this.FLUSH_GAP_MS));
  },

  // ---- the chip -----------------------------------------------------------
  _paintChip() {
    if (typeof document === 'undefined') return;
    const chip = document.getElementById('battery-saving');
    if (!chip) return;
    const lean = this.isLean();
    chip.hidden = !lean;
    if (!lean) return;
    const label = chip.querySelector('.battery-saving-label');
    if (label) label.textContent = this.level === 'low' ? 'Low battery — saving power' : 'Saving battery';
    const icon = chip.querySelector('.battery-saving-icon');
    if (icon && !icon.firstChild && typeof VexIcons !== 'undefined') icon.innerHTML = VexIcons.svg('battery', { size: 14 });
    chip.title = 'On battery: tabs sleep sooner, background checks wait and animations stop until the PC is plugged in.';
  },

  // ---- wiring -------------------------------------------------------------
  init() {
    if (this._inited) return false;
    this._inited = true;
    const chip = typeof document !== 'undefined' && document.getElementById('battery-saving-open');
    if (chip) chip.addEventListener('click', () => { if (typeof SettingsUI !== 'undefined') SettingsUI.openSection('settings-battery'); });
    if (this.enabled()) return this.start();
    return false;
  },

  async start() {
    const b = window.vex;
    if (!b || typeof b.powerWatch !== 'function') { this.ingest({ error: 'Battery state is not available in this window' }); return false; }
    if (this._running) return true;
    this._running = true;
    this._settled = false;
    if (typeof b.onPowerState === 'function' && !this._sub) {
      this._sub = b.onPowerState((s) => { if (s && typeof s.onBattery === 'boolean') this.ingest({ onBattery: s.onBattery }); });
    }
    try {
      const st = await b.powerWatch(true);
      this.ingest({ hasBattery: st.hasBattery, onBattery: !!st.onBattery, percent: st.percent, error: '' });
    } catch (err) {
      this.ingest({ hasBattery: null, error: (err && err.message) || String(err) });
      window.VexProblems?.note('Battery', 'Could not read the battery state', err);
    }
    this._watchCharge();
    return true;
  },

  stop() {
    this._running = false;
    this._clearPending();
    this._settled = false;
    if (this._charge) {
      try { this._charge.target.removeEventListener('levelchange', this._charge.handler); } catch { /* gone */ }
      this._charge = null;
    }
    try { if (window.vex && typeof window.vex.powerWatch === 'function') Promise.resolve(window.vex.powerWatch(false)).catch(err => window.VexProblems?.note('Battery', 'Could not stop watching', err)); }
    catch (err) { window.VexProblems?.note('Battery', 'Could not stop watching', err); }
    this._commit('off');
    return false;
  },

  // The charge level follows Chromium's own Battery Status API: no process.
  async _watchCharge() {
    if (this._charge || typeof navigator === 'undefined' || typeof navigator.getBattery !== 'function') return;
    try {
      const bat = await navigator.getBattery();
      if (!this._running || this._charge) return;
      const handler = () => this.ingest({ percent: Math.round(bat.level * 100) });
      bat.addEventListener('levelchange', handler);
      this._charge = { target: bat, handler };
      if (this.hw.hasBattery === true) handler();
    } catch (err) { window.VexProblems?.note('Battery', 'Could not follow the charge level', err); }
  },

  // ---- Settings -----------------------------------------------------------
  statusText() {
    if (!this.enabled()) return 'Off.';
    if (this.hw.error) return 'Could not read the battery: ' + this.hw.error;
    const pct = typeof this.hw.percent === 'number' ? ' (' + this.hw.percent + '%)' : '';
    switch (this.level) {
      case 'no-battery': return 'No battery detected on this PC, so this does nothing here.';
      case 'ac': return 'Plugged in' + pct + ' — Vex is running normally.';
      case 'battery': return 'On battery' + pct + ' — saving power.';
      case 'low': return 'Battery is low' + pct + ' — saving as much power as it can.';
      default: return 'Checking…';
    }
  },

  async renderSettings(host) {
    host = host || document.getElementById('battery-settings');
    if (!host) return;
    // A desktop is said so even before the mode is switched on.
    if (window.vex && typeof window.vex.powerStatus === 'function' && this.hw.hasBattery === null && !this.hw.error) {
      try { const st = await window.vex.powerStatus(); this.hw = { ...this.hw, hasBattery: st.hasBattery, percent: st.percent, onBattery: !!st.onBattery }; }
      catch (err) { this.hw = { ...this.hw, error: (err && err.message) || String(err) }; }
    }
    host.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'setting-info';
    note.id = 'battery-status';
    note.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin:4px 0 8px';
    host.appendChild(note);
    const paint = () => {
      note.textContent = (this.hw.hasBattery === false && !this.enabled())
        ? 'No battery detected on this PC, so turning this on would do nothing here.'
        : this.statusText();
    };
    paint();
    const row = (label, hint, checked, onChange, id) => {
      const r = document.createElement('div');
      r.className = 'setting-toggle-row';
      r.innerHTML = '<span></span><label class="toggle"><input type="checkbox" aria-label="Setting"><span class="toggle-slider"></span></label>';
      r.querySelector('span').textContent = label;
      if (hint) r.querySelector('span').title = hint;
      const box = r.querySelector('input');
      if (id) box.id = id;
      box.checked = checked;
      box.setAttribute('aria-label', label);
      box.addEventListener('change', () => onChange(box.checked, box));
      host.appendChild(r);
      return box;
    };
    row('Save power when this PC is on battery', 'Opt-in. Nothing changes while the PC is plugged in.', this.enabled(), (on, box) => {
      Promise.resolve(this.setEnabled(on)).then(() => { paint(); setTimeout(paint, 1500); })
        .catch(err => { box.checked = !on; window.showToast?.('Could not change it: ' + ((err && err.message) || err), 'error'); });
    }, 'setting-battery-enabled');
    const subs = [
      ['sleepSooner', 'Sleep idle tabs sooner', 'Tabs idle for 10 minutes sleep (5 when the battery is low) — only when Auto-sleep is on and “Before Vex puts anything to sleep on its own” allows it. Anything playing sound, on a call, recorded or kept awake is left alone.'],
      ['holdJobs', 'Wait with background checks', 'Page watches, GitHub watches, calendars, Read later, tabs sent from other devices, free-games and live-channel checks, Recall indexing, the sync pull and extension updates wait, then catch up once when the PC is plugged in. Uploading your own changes (sync push) and saving your workspace go on.'],
      ['holdAi', 'Hold background AI', 'Scheduled AI tasks and history summaries wait. A question you ask is still answered.'],
      ['still', 'Keep Vex still', 'Vex stops its own animations.'],
    ];
    for (const [key, label, hint] of subs) row(label, hint, this.setting(key), (on) => this.setSetting(key, on), 'setting-battery-' + key);
    const lowRow = document.createElement('div');
    lowRow.className = 'setting-toggle-row';
    lowRow.innerHTML = '<span>Count the battery as low at</span><select aria-label="Count the battery as low at" id="setting-battery-low"></select>';
    const sel = lowRow.querySelector('select');
    for (const v of [10, 15, 20, 30]) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = v + '%'; if (v === this.lowPercent()) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { try { this.setLowPercent(sel.value); paint(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    host.appendChild(lowRow);
    const fine = document.createElement('div');
    fine.className = 'setting-info';
    fine.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin-top:8px';
    fine.textContent = 'Vex follows mains and battery and the charge level. Windows’ own Battery Saver switch is not something Vex can see.';
    host.appendChild(fine);
    this._paintSettings = paint;
  },
};

if (typeof document !== 'undefined') {
  document.addEventListener('vex:battery-mode', () => { try { BatteryMode._paintSettings && BatteryMode._paintSettings(); } catch { /* settings not open */ } });
}
if (typeof window !== 'undefined') window.BatteryMode = BatteryMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { BatteryMode };
