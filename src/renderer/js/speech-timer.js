// === Speech timer and speakers-list HUD (T3-076) ===================================
//
// A small floating timer for a debate: presets of 30, 60, 90 and 120 seconds (or your own),
// start / pause / reset, and a speakers list with a one-line note for each speaker. "Next
// speaker" starts the clock for the next name and writes down how long the last one took.
//
// It is part of the Vex window: drag it anywhere, close it with the x, open it again from
// Ctrl+K ("Speech timer"). Because it lives inside the window it can never come up over
// another program, and it does not open by itself. A game running does not matter: nothing
// is shown unless you opened it. It sounds nothing and sends nothing; when time is up the
// clock turns red and says "Time" (the screen reader hears it too).
//
// Kept on this computer: vex.speechTimer (the speakers, the preset, where you put it).
//
//   VexSpeechTimer.fmt(seconds)               pure -> "1:05"
//   VexSpeechTimer.remaining(state, now)      pure -> ms left
//   VexSpeechTimer.PRESETS                    [30, 60, 90, 120]
const VexSpeechTimer = {
  KEY: 'vex.speechTimer',
  PREF: 'vex.speechTimer.enabled',
  PRESETS: [30, 60, 90, 120],
  MAX_SPEAKERS: 60,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); if (!on) this.close(); },

  fmt(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },
  // state: { total (ms), left (ms, when paused), startedAt (ms, when running) }
  remaining(state, now = Date.now()) {
    if (state.startedAt) return Math.max(0, state.left - (now - state.startedAt));
    return state.left;
  },

  // ---- saved data ------------------------------------------------------------------------
  _st() { return VexStudyKit.store(this.KEY, { v: 1, preset: 60, speakers: [], pos: null }); },
  _read() {
    const d = this._st().get();
    d.speakers = Array.isArray(d.speakers) ? d.speakers : [];
    if (!this.PRESETS.includes(d.preset) && !(Number.isInteger(d.preset) && d.preset > 0 && d.preset <= 3600)) d.preset = 60;
    return d;
  },
  addSpeaker(name, note) {
    const n = String(name || '').trim();
    if (!n) throw new Error('Write the speaker\'s name first');
    const d = this._read();
    if (d.speakers.length >= this.MAX_SPEAKERS) throw new Error('The list is full (' + this.MAX_SPEAKERS + ' speakers). Clear it first.');
    d.speakers.push({ id: 'sp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name: n.slice(0, 60), note: String(note || '').trim().slice(0, 200), spoke: null });
    this._st().set(d);
    return d.speakers;
  },
  setNote(id, note) {
    const d = this._read();
    const s = d.speakers.find(x => x.id === id);
    if (!s) throw new Error('That speaker is gone');
    s.note = String(note || '').trim().slice(0, 200);
    this._st().set(d);
  },
  removeSpeaker(id) { const d = this._read(); d.speakers = d.speakers.filter(s => s.id !== id); this._st().set(d); },
  clearSpeakers() { const d = this._read(); d.speakers = []; this._st().set(d); },
  setPreset(sec) {
    const n = Math.round(Number(sec));
    if (!Number.isFinite(n) || n < 5 || n > 3600) throw new Error('A speaking time is 5 to 3600 seconds');
    const d = this._read(); d.preset = n; this._st().set(d);
    return n;
  },
  // The speaker whose turn it is: the first one who has not spoken.
  nextUp() { return this._read().speakers.find(s => s.spoke == null) || null; },
  recordLap(id, seconds) {
    const d = this._read();
    const s = d.speakers.find(x => x.id === id);
    if (!s) throw new Error('That speaker is gone');
    s.spoke = Math.max(0, Math.round(seconds));
    this._st().set(d);
  },

  // ---- the HUD ---------------------------------------------------------------------------
  _hud: null,
  _run: null,      // { state, timer, current }
  isOpen() { return !!(this._hud && this._hud.isConnected); },
  close() {
    if (this._run && this._run.timer) clearTimeout(this._run.timer);
    this._run = null;
    if (this._hud) this._hud.remove();
    this._hud = null;
  },

  open() {
    if (!this.enabled()) throw new Error('The speech timer is switched off in Settings');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('speech-timer');
    if (this.isOpen()) { this._hud.querySelector('[data-start]')?.focus(); return; }
    const K = VexStudyKit;
    const d = this._read();
    this._run = { state: { total: d.preset * 1000, left: d.preset * 1000, startedAt: 0 }, timer: 0, current: null };
    const clock = K.el('div', { 'data-clock': true, style: 'font:600 34px/1 var(--vex-font-mono,monospace);text-align:center;margin:4px 0' });
    const live = K.el('div', { 'aria-live': 'assertive', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' });
    const who = K.el('div', { 'data-who': true, style: 'text-align:center;font-size:12px;opacity:.8;min-height:16px' });
    const presets = K.el('div', { style: 'display:flex;gap:4px;justify-content:center;flex-wrap:wrap' },
      this.PRESETS.map(p => K.el('button', { type: 'button', class: 'btn-secondary', 'data-preset': String(p), text: p + 's', style: 'padding:2px 8px', onclick: K.guard(() => { this._applyPreset(p); }) })));
    const start = K.el('button', { type: 'button', class: 'btn-primary', 'data-start': true, text: 'Start', style: 'flex:1', onclick: K.guard(() => this._toggle()) });
    const reset = K.el('button', { type: 'button', class: 'btn-secondary', text: 'Reset', onclick: K.guard(() => this._reset()) });
    const next = K.el('button', { type: 'button', class: 'btn-secondary', text: 'Next speaker', onclick: K.guard(() => this._nextSpeaker()) });
    const list = K.el('div', { 'data-list': true, style: 'max-height:150px;overflow:auto;margin-top:6px;font-size:12px' });
    const name = K.el('input', { type: 'text', placeholder: 'Add a speaker', 'aria-label': 'Speaker name', style: 'flex:1;min-width:0' });
    const add = () => { this.addSpeaker(name.value, ''); name.value = ''; this._drawList(); };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') K.guard(add)(); });
    const close = K.el('button', { type: 'button', 'aria-label': 'Close the timer', title: 'Close', class: 'btn-secondary', text: 'x', style: 'padding:0 8px', onclick: () => this.close() });
    const head = K.el('div', { 'data-drag': true, style: 'display:flex;justify-content:space-between;align-items:center;cursor:move;font-size:12px;opacity:.85' }, K.el('span', { text: 'Speech timer' }), close);
    const hud = K.el('div', { id: 'vex-speech-hud', role: 'region', 'aria-label': 'Speech timer',
      style: 'position:fixed;z-index:9000;width:230px;padding:8px 10px;border-radius:10px;background:var(--bg-secondary,#1b1d26);color:var(--text-primary,#f3f4f8);border:1px solid var(--border,rgba(255,255,255,.15));box-shadow:0 8px 28px rgba(0,0,0,.35)' },
      head, clock, who, presets, K.el('div', { style: 'display:flex;gap:4px;margin-top:6px' }, start, reset, next), list, K.el('div', { style: 'display:flex;gap:4px;margin-top:6px' }, name, K.el('button', { type: 'button', class: 'btn-secondary', text: 'Add', onclick: K.guard(add) })), live);
    const pos = d.pos && Number.isFinite(d.pos.x) && Number.isFinite(d.pos.y) ? d.pos : { x: window.innerWidth - 260, y: window.innerHeight - 340 };
    hud.style.left = Math.max(0, Math.min(pos.x, window.innerWidth - 120)) + 'px';
    hud.style.top = Math.max(0, Math.min(pos.y, window.innerHeight - 80)) + 'px';
    this._drag(head, hud);
    document.body.appendChild(hud);
    this._hud = hud;
    this._draw();
    this._drawList();
  },

  _drag(handle, hud) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const dx = e.clientX - hud.offsetLeft, dy = e.clientY - hud.offsetTop;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        hud.style.left = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 60)) + 'px';
        hud.style.top = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40)) + 'px';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        try { const d = this._read(); d.pos = { x: hud.offsetLeft, y: hud.offsetTop }; this._st().set(d); } catch (err) { console.error('[SpeechTimer] position not saved:', err); }
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
  },

  _draw() {
    if (!this.isOpen()) return;
    const r = this._run, left = this.remaining(r.state);
    const clock = this._hud.querySelector('[data-clock]');
    clock.textContent = this.fmt(left / 1000);
    const over = r.state.startedAt === 0 && r.state.left === 0;
    clock.style.color = over ? '#ef4444' : (left <= 10000 && r.state.startedAt ? '#eab308' : '');
    this._hud.querySelector('[data-start]').textContent = r.state.startedAt ? 'Pause' : (over ? 'Again' : 'Start');
    this._hud.querySelector('[data-who]').textContent = r.current ? 'Speaking: ' + r.current.name : '';
    for (const b of this._hud.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(Number(b.dataset.preset) * 1000 === r.state.total));
  },
  _loop() {
    const r = this._run;
    if (!r || !this.isOpen()) return;
    if (r.state.startedAt && this.remaining(r.state) <= 0) {
      r.state.left = 0; r.state.startedAt = 0;
      this._hud.querySelector('[aria-live]').textContent = 'Time';
      this._draw();
      return;
    }
    this._draw();
    if (r.state.startedAt) r.timer = setTimeout(() => this._loop(), 200);
  },
  _toggle() {
    const r = this._run, s = r.state;
    if (s.startedAt) { s.left = this.remaining(s); s.startedAt = 0; clearTimeout(r.timer); }
    else {
      if (s.left <= 0) s.left = s.total;
      this._hud.querySelector('[aria-live]').textContent = '';
      s.startedAt = Date.now();
      this._loop();
      return;
    }
    this._draw();
  },
  _reset() { const r = this._run; clearTimeout(r.timer); r.state.startedAt = 0; r.state.left = r.state.total; this._hud.querySelector('[aria-live]').textContent = ''; this._draw(); },
  _applyPreset(sec) {
    const r = this._run;
    this.setPreset(sec);
    clearTimeout(r.timer);
    r.state = { total: sec * 1000, left: sec * 1000, startedAt: 0 };
    this._draw();
  },
  _nextSpeaker() {
    const r = this._run;
    if (r.current) {
      const used = (r.state.total - this.remaining(r.state)) / 1000;
      this.recordLap(r.current.id, used);
    }
    clearTimeout(r.timer);
    r.current = this.nextUp();
    if (!r.current) { r.state.startedAt = 0; r.state.left = r.state.total; this._draw(); this._drawList(); throw new Error('The list is finished: no one is waiting'); }
    r.state.left = r.state.total; r.state.startedAt = Date.now();
    this._hud.querySelector('[aria-live]').textContent = '';
    this._loop();
    this._drawList();
  },
  _drawList() {
    if (!this.isOpen()) return;
    const K = VexStudyKit;
    const box = this._hud.querySelector('[data-list]');
    box.textContent = '';
    const cur = this._run && this._run.current;
    for (const s of this._read().speakers) {
      const note = K.el('input', { type: 'text', value: s.note, placeholder: 'note', 'aria-label': 'Note for ' + s.name, style: 'width:100%;font-size:11px;margin-top:2px' });
      note.addEventListener('change', K.guard(() => this.setNote(s.id, note.value)));
      box.appendChild(K.el('div', { style: 'padding:3px 0;border-top:1px solid var(--border,rgba(255,255,255,.1))' + (cur && cur.id === s.id ? ';font-weight:600' : '') },
        K.el('div', { style: 'display:flex;justify-content:space-between;gap:6px' }, K.el('span', { text: s.name }), K.el('span', { text: s.spoke != null ? this.fmt(s.spoke) : '', style: 'opacity:.7' }),
          K.el('button', { type: 'button', 'aria-label': 'Remove ' + s.name, class: 'btn-secondary', text: 'x', style: 'padding:0 6px', onclick: K.guard(() => { this.removeSpeaker(s.id); this._drawList(); }) })), note));
    }
    if (!box.firstChild) box.appendChild(K.el('div', { class: 'vex-platform-note', text: 'No speakers yet.' }));
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('A small floating timer with 30, 60, 90 and 120 second presets and a speakers list with a note for each. It stays inside the Vex window, opens only when you ask, and makes no sound.'));
    el.appendChild(G.button('Open the speech timer', VexStudyKit.guard(() => this.open()), { primary: true }));
    el.appendChild(G.button('Clear the speakers list', VexStudyKit.guard(async () => { if (await window.vexConfirm({ title: 'Clear the speakers list?', okLabel: 'Clear', danger: true })) { this.clearSpeakers(); this._drawList(); } }), { danger: true }));
  },
};

if (typeof window !== 'undefined') window.VexSpeechTimer = VexSpeechTimer;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSpeechTimer };
