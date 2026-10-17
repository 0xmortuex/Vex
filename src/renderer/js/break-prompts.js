// === Breaks that follow your real active time =================================
//
// T2-036. A 20-20-20 eye break and a stretch, offered after you have ACTUALLY
// been at it, not on a clock: time counts only while you are using Vex (a key,
// the mouse, a scroll within the last minute). Sit away for five minutes and the
// count starts again, because that was a break. When the time comes it waits for
// a natural pause (nothing typed for a few seconds, no fullscreen video) and it
// is dropped, not queued, if this is a bad moment: Game mode, a meeting, a focus
// block, quiet hours, an exam day in the exam calendar.
//
// Gentle: a small card with Done / Skip, gone by itself after 30 seconds, no
// sound, never twice within five minutes. Taken, skipped and let-go are counted
// per day so you can see the habit, nothing is sent anywhere. Off until switched on.
const BreakPrompts = {
  KEY: 'vex.breaks',
  ON_KEY: 'vex.breaks.enabled',
  PREFS_KEY: 'vex.breaks.prefs',
  ACTIVE_WINDOW_MS: 60000,     // input within this makes the minute active
  AWAY_MS: 5 * 60000,          // idle this long = a natural break
  PAUSE_MS: 4000,              // "a natural pause": nothing typed for this long
  COOLDOWN_MS: 5 * 60000,
  TICK_MS: 15000,
  CARD_MS: 30000,

  _activeMs: 0,
  _lastInput: 0,
  _lastTick: 0,
  _lastPrompt: 0,
  _firedEye: false,
  _firedStretch: false,

  enabled() { return VexLifeKit.flag(this.ON_KEY, false); },
  setEnabled(on) { VexLifeKit.setFlag(this.ON_KEY, !!on); if (!on) { this._activeMs = 0; this._firedEye = this._firedStretch = false; } },
  prefs() {
    const p = VexLifeKit.read(this.PREFS_KEY, null) || {};
    return { eyeMin: p.eyeMin >= 10 && p.eyeMin <= 60 ? p.eyeMin : 20, stretchMin: p.stretchMin >= 45 && p.stretchMin <= 180 ? p.stretchMin : 90 };
  },
  setPrefs({ eyeMin, stretchMin }) {
    const e = Number(eyeMin), s = Number(stretchMin);
    if (!(e >= 10 && e <= 60)) throw new Error('The eye break is every 10 to 60 minutes');
    if (!(s >= 45 && s <= 180)) throw new Error('The stretch is every 45 to 180 minutes');
    VexLifeKit.write(this.PREFS_KEY, { eyeMin: e, stretchMin: s });
  },

  // ---- pure: what to do for this much active time --------------------------------
  // -> 'stretch' | 'eye' | null. Each kind fires once per run of activity.
  due(activeMs, prefs, fired) {
    if (activeMs >= prefs.stretchMin * 60000 && !fired.stretch) return 'stretch';
    if (activeMs >= prefs.eyeMin * 60000 && !fired.eye) return 'eye';
    return null;
  },

  noteInput(now = Date.now()) { this._lastInput = now; },

  // ---- one step ---------------------------------------------------------------------
  // Returns what it did: 'counted' | 'away' | 'prompted' | 'waiting' | 'held:<why>' | null.
  tick(now = Date.now()) {
    if (!this.enabled()) return null;
    const dt = this._lastTick ? Math.min(now - this._lastTick, this.TICK_MS * 4) : 0;
    this._lastTick = now;
    const idle = now - this._lastInput;
    if (this._lastInput && idle >= this.AWAY_MS) {
      if (this._activeMs > 0) { this._activeMs = 0; this._firedEye = this._firedStretch = false; }
      return 'away';
    }
    if (this._lastInput && idle < this.ACTIVE_WINDOW_MS) this._activeMs += dt;
    const kind = this.due(this._activeMs, this.prefs(), { eye: this._firedEye, stretch: this._firedStretch });
    if (!kind) return 'counted';
    const why = this.heldBecause(now);
    if (why) return 'held:' + why;
    if (idle < this.PAUSE_MS) return 'waiting';
    if (now - this._lastPrompt < this.COOLDOWN_MS) return 'waiting';
    this._lastPrompt = now;
    if (kind === 'eye') this._firedEye = true; else { this._firedStretch = true; this._firedEye = true; }
    this.prompt(kind);
    return 'prompted';
  },

  // Why this is a bad moment, or ''. Nothing is queued: the next tick asks again.
  heldBecause(now = Date.now()) {
    if (typeof document !== 'undefined' && document.fullscreenElement) return 'a video is fullscreen';
    if (typeof GameSession !== 'undefined' && GameSession.active) return 'Game mode';
    if (typeof FocusMode !== 'undefined' && FocusMode.active) return 'a focus session';
    if (typeof ExamCalendar !== 'undefined' && ExamCalendar.enabled() && ExamCalendar.examToday(now)) return 'an exam day';
    if (typeof AttentionState !== 'undefined') {
      const st = AttentionState.get();
      if (st && st.quiet) return st.reason || 'a quiet moment';
    }
    return '';
  },

  // ---- the card ----------------------------------------------------------------------
  day(now = Date.now()) { return VexLifeKit.dayString(now); },
  log(outcome, now = Date.now()) {
    const d = VexLifeKit.read(this.KEY, null) || { v: 1, days: {} };
    const day = this.day(now);
    const s = d.days[day] || (d.days[day] = { taken: 0, skipped: 0, ignored: 0 });
    s[outcome]++;
    for (const k of Object.keys(d.days).sort().slice(0, -30)) delete d.days[k];
    VexLifeKit.write(this.KEY, d);
  },
  today(now = Date.now()) {
    const d = VexLifeKit.read(this.KEY, null);
    return (d && d.days[this.day(now)]) || { taken: 0, skipped: 0, ignored: 0 };
  },

  prompt(kind) {
    const text = kind === 'eye'
      ? 'Look at something about 6 metres away for 20 seconds.'
      : 'You have been at it a while. Stand up, roll your shoulders, drink some water.';
    const show = () => this.showCard(kind, text);
    if (typeof VexAttention === 'undefined') { show(); return; }
    const d = VexAttention.notify({ feature: 'break-prompts', urgency: 'ambient', id: kind + Date.now(), title: kind === 'eye' ? 'Eye break' : 'Stretch break' }, show);
    if (d.route !== 'toast') this.log('ignored');
  },
  showCard(kind, text) {
    document.querySelector('.vex-break-card')?.remove();
    const card = document.createElement('div');
    card.className = 'vex-break-card';
    card.setAttribute('role', 'status');
    card.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:9000;width:min(320px,92vw);background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:12px 14px;box-shadow:0 14px 40px var(--vex-shadow-color,rgba(0,0,0,0.4))';
    const t = document.createElement('div');
    t.style.cssText = 'font-size:12.5px;margin-bottom:8px';
    t.textContent = text;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px';
    let timer = null;
    const end = (outcome) => { clearTimeout(timer); card.remove(); this.log(outcome); };
    row.append(VexSettingsGroups.button('Done', () => end('taken'), { primary: true }), VexSettingsGroups.button('Skip', () => end('skipped')));
    card.append(t, row);
    document.body.appendChild(card);
    if (typeof VexLayer !== 'undefined') VexLayer.track(card, { tier: 'panel', id: 'break-prompts', keep: true });
    timer = setTimeout(() => { if (card.isConnected) end('ignored'); }, this.CARD_MS);
    return card;
  },

  start() {
    if (this._wired) return;
    this._wired = true;
    const mark = () => this.noteInput();
    for (const ev of ['keydown', 'pointermove', 'pointerdown', 'wheel']) document.addEventListener(ev, mark, { capture: true, passive: true });
    if (typeof VexJobs !== 'undefined') VexJobs.every('Break prompts', this.TICK_MS, () => this.tick(), { when: 'ui', feature: 'break-prompts' });
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Eye and stretch breaks after your real active time (keys, mouse, scrolling), not the clock. Away for five minutes counts as a break. Held back during Game mode, meetings, focus sessions, quiet hours and exam days; a card goes by itself after 30 seconds.'));
    el.appendChild(VexSettingsGroups.button(this.enabled() ? 'Turn breaks off' : 'Turn breaks on', () => { this.setEnabled(!this.enabled()); VexSettingsGroups.inject(); }, { primary: !this.enabled() }));
    const p = this.prefs();
    const num = (label, value, min, max) => {
      const i = document.createElement('input');
      i.type = 'number'; i.min = String(min); i.max = String(max); i.value = String(value);
      i.setAttribute('aria-label', label);
      i.style.cssText = 'width:70px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 6px';
      return i;
    };
    const eye = num('Eye break every (minutes)', p.eyeMin, 10, 60), str = num('Stretch every (minutes)', p.stretchMin, 45, 180);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12.5px';
    row.append(document.createTextNode('Eye every'), eye, document.createTextNode('min, stretch every'), str, document.createTextNode('min'),
      VexSettingsGroups.button('Save', () => { try { this.setPrefs({ eyeMin: eye.value, stretchMin: str.value }); window.showToast?.('Saved'); } catch (err) { window.showToast?.(err.message, 'error'); } }));
    el.appendChild(row);
    const s = this.today();
    el.appendChild(VexSettingsGroups.note('Today: ' + s.taken + ' taken, ' + s.skipped + ' skipped, ' + s.ignored + ' let go.'));
  },
};

if (typeof window !== 'undefined') {
  window.BreakPrompts = BreakPrompts;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'break-prompts', title: 'Breaks', keywords: 'break eye 20-20-20 stretch posture rest active time', before: 'about', build: (el) => BreakPrompts.group(el) });
  }
  if (typeof VexLifeKit !== 'undefined' && typeof document !== 'undefined') BreakPrompts.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { BreakPrompts };
