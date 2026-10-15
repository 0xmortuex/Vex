// === Brief extra: Daily digest as audio ======================================
//
// Reads a short spoken digest of the day. The renderer already speaks with the
// Web Speech API (queue-podcast.js), and there is no separate local voice
// facility in Vex, so this uses the same window.speechSynthesis; nothing is
// sent anywhere.
//
// Opt-in: off until Settings > Brief extras > "Spoken digest" is on
// (vex.briefExtras.audio === true). It never starts by itself: play comes
// from the button or the keyboard's media play/pause key
// (navigator.mediaSession), so it works hands-free with no focus on the page.
//
// Section object for VexBrief.register: { id, title, build(), isEnabled() }.
// build() returns { id, title, icon, lines: [{ text, detail, actions }] } where
// the actions are Play / Pause / Resume / Stop for the current state.
const VexBriefAudio = {
  id: 'audio-digest',
  title: 'Listen to your day',
  icon: 'volume',
  SETTINGS_KEY: 'vex.briefExtras',
  MAX_CHUNK: 220,
  _token: 0,
  _state: 'idle',            // idle | playing | paused
  _wired: false,

  _json(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; }
    catch { return fb; }
  },

  // Opt-in: only an explicit true turns it on.
  isEnabled() {
    const s = this._json(this.SETTINGS_KEY, {});
    return !!(s && s.audio === true);
  },

  supported() { return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; },

  // Pure. Text of the digest from plain inputs: { reminders: [{message, at}],
  // events: [{summary, start}], news: [{title}], readLater: n, greeting? }.
  script({ reminders = [], events = [], news = [], readLater = 0, now = new Date() } = {}) {
    const t = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const parts = [];
    const h = now.getHours();
    parts.push(h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.');
    if (events.length) {
      parts.push(events.length === 1 ? 'You have one event today.' : 'You have ' + events.length + ' events today.');
      for (const e of events.slice(0, 4)) parts.push(e.summary + ' at ' + t(e.start) + '.');
    } else parts.push('No events on your calendar today.');
    if (reminders.length) {
      parts.push(reminders.length === 1 ? 'One reminder is due.' : reminders.length + ' reminders are due.');
      for (const r of reminders.slice(0, 4)) parts.push(r.message + '.');
    } else parts.push('No reminders are due.');
    if (readLater > 0) parts.push(readLater === 1 ? 'One saved page is waiting to be read.' : readLater + ' saved pages are waiting to be read.');
    if (news.length) {
      parts.push('In AI news.');
      for (const n of news.slice(0, 3)) parts.push(n.title.replace(/[.!?]+$/, '') + '.');
    }
    return parts.join(' ');
  },

  // Pure. Splits into sentences, grouped under MAX_CHUNK characters (long
  // utterances are cut off by some voices).
  chunks(text) {
    const sentences = String(text || '').match(/[^.!?]+[.!?]*/g) || [];
    const out = [];
    let cur = '';
    for (const s of sentences.map(x => x.trim()).filter(Boolean)) {
      if (cur && (cur + ' ' + s).length > this.MAX_CHUNK) { out.push(cur); cur = s; }
      else cur = cur ? cur + ' ' + s : s;
    }
    if (cur) out.push(cur);
    return out;
  },

  async gather(now = new Date(), deps = {}) {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 3600 * 1000;
    const errors = [];
    let reminders = [], events = [], news = [], readLater = 0;
    try {
      const b = deps.reminders || (window.vex && window.vex.reminders);
      if (b && typeof b.list === 'function') {
        reminders = (await b.list()).filter(r => !r.firedAt && r.kind !== 'review' && r.at != null && r.at < endOfDay);
      }
    } catch (err) { errors.push('reminders: ' + ((err && err.message) || 'unavailable')); }
    try {
      const C = deps.calendar || (typeof IcsCalendar !== 'undefined' ? IcsCalendar : null);
      if (C) events = C.between(startOfDay, endOfDay).filter(e => e.end > now.getTime());
    } catch (err) { errors.push('calendar: ' + ((err && err.message) || 'unavailable')); }
    try {
      const N = deps.news || (typeof AINews !== 'undefined' ? AINews : null);
      if (N) news = N.list().filter(i => !i.read).slice(0, 3);
    } catch (err) { errors.push('AI news: ' + ((err && err.message) || 'unavailable')); }
    try {
      const R = deps.readLater || (typeof ReadLater !== 'undefined' ? ReadLater.items : null);
      if (Array.isArray(R)) readLater = R.filter(i => i && !i.read).length;
    } catch (err) { errors.push('read later: ' + ((err && err.message) || 'unavailable')); }
    return { reminders, events, news, readLater, now, errors };
  },

  // ---- playback ---------------------------------------------------------------------
  state() { return this._state; },

  async play(now = new Date(), deps = {}) {
    if (!this.supported()) throw new Error('Spoken digests are not available: this window has no speech engine');
    const synth = deps.synth || window.speechSynthesis;
    const data = await this.gather(now, deps);
    const chunks = this.chunks(this.script(data));
    const token = ++this._token;
    try { synth.cancel(); } catch { /* nothing was speaking */ }
    this._state = 'playing';
    this._changed();
    let i = 0;
    const next = () => {
      if (token !== this._token) return;
      if (i >= chunks.length) { this._state = 'idle'; this._changed(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.onend = next;
      u.onerror = () => { if (token === this._token) { this._state = 'idle'; this._changed(); } };
      synth.speak(u);
    };
    next();
    this.wireMediaKeys();
    return chunks.length;
  },

  pause(deps = {}) {
    if (this._state !== 'playing') return;
    (deps.synth || window.speechSynthesis).pause();
    this._state = 'paused';
    this._changed();
  },

  resume(deps = {}) {
    if (this._state !== 'paused') return;
    (deps.synth || window.speechSynthesis).resume();
    this._state = 'playing';
    this._changed();
  },

  stop(deps = {}) {
    this._token++;
    try { (deps.synth || window.speechSynthesis).cancel(); } catch { /* no engine */ }
    this._state = 'idle';
    this._changed();
  },

  toggle() {
    if (this._state === 'playing') this.pause();
    else if (this._state === 'paused') this.resume();
    else return this.play();
  },

  // Media keys (play/pause/stop) drive it with no page focus: hands-free.
  wireMediaKeys() {
    if (this._wired) return;
    const ms = typeof navigator !== 'undefined' && navigator.mediaSession;
    if (!ms || typeof ms.setActionHandler !== 'function') return;
    this._wired = true;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* action not supported here */ } };
    set('play', () => { if (this._state === 'paused') this.resume(); else if (this._state === 'idle') this.play().catch(err => window.showToast?.(err.message, 'error')); });
    set('pause', () => this.pause());
    set('stop', () => this.stop());
  },

  _changed() { try { document.dispatchEvent(new CustomEvent('vex:brief-audio-changed', { detail: { state: this._state } })); } catch { /* no document */ } },

  build() {
    if (!this.supported()) return null;
    const actions = [];
    if (this._state === 'idle') actions.push({ label: 'Play digest', icon: 'play', run: () => this.play().catch(err => window.showToast?.(err.message, 'error')) });
    if (this._state === 'playing') actions.push({ label: 'Pause', icon: 'pause', run: () => this.pause() });
    if (this._state === 'paused') actions.push({ label: 'Resume', icon: 'play', run: () => this.resume() });
    if (this._state !== 'idle') actions.push({ label: 'Stop', icon: 'x', run: () => this.stop() });
    return {
      id: this.id, title: this.title, icon: this.icon,
      lines: [{ text: 'A spoken summary of today', detail: 'Uses this computer\'s voice. The play/pause media key controls it too.', actions }],
    };
  },
};

if (typeof window !== 'undefined') window.VexBriefAudio = VexBriefAudio;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBriefAudio };
