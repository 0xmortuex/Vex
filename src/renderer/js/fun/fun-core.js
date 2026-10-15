// === Fun and progress: shared core ===========================================
//
// The four optional "fun" modules (Vex Pet, Discovery log, Browser levels,
// Daily challenge) share this small file: the on/off switches, one storage
// helper, the day key, the Game-mode guard and the medal signal.
//
// Principles (the owner's delegate wrote them down; every module obeys them):
//   - Everything is OFF until the person turns it on in Settings.
//   - Nothing is lost by not using it: no streak that breaks, no "you missed".
//   - Nothing is shown while Game mode is active.
//   - No notification, no nag: at most a quiet toast for something you just did.
//
// Storage: localStorage key vex.fun is { pet, discovery, levels, challenge }
// booleans (absent = off). Each module keeps its own data under vex.fun.<name>.
//
// Medals are somebody else's job (branch batch5-medals). This only says
// "this happened" by dispatching
//   document 'vex:medal-signal'  detail { id }
// once per id, ever, on this profile.
const VexFun = {
  KEY: 'vex.fun',
  FLAGS: ['pet', 'discovery', 'levels', 'challenge'],
  LABELS: {
    pet: { label: 'Vex Pet', hint: 'A small companion on the New Tab page. It is only decoration: sleepy at night, cheerful after a focus session.' },
    discovery: { label: 'Discovery log', hint: 'Keeps a list of the Vex features you have tried, and counts how many are left to find.' },
    levels: { label: 'Browser levels', hint: 'Points for useful things: tidying tabs, clearing the inbox, finishing the reading queue, writing notes. Never for time spent.' },
    challenge: { label: 'Daily one-minute challenge', hint: 'One small idea a day, such as closing five tabs you do not need. Skip it any time: nothing happens.' },
  },

  // Tests replace this.
  now() { return Date.now(); },

  // The local calendar day as YYYY-MM-DD.
  today(ms) {
    const d = new Date(ms === undefined ? this.now() : ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  // Reads a JSON object from storage. A damaged value is an error, not a
  // silent reset: the person would lose their progress without knowing why.
  load(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { throw new Error('The saved data "' + key + '" could not be read', { cause: err }); }
    return (v && typeof v === 'object') ? v : fallback;
  },
  save(key, value) { localStorage.setItem(key, JSON.stringify(value)); },

  flags() {
    const f = this.load(this.KEY, {});
    return Array.isArray(f) ? {} : f;
  },
  enabled(flag) {
    if (!this.FLAGS.includes(flag)) throw new Error('Unknown fun setting: ' + flag);
    return this.flags()[flag] === true;
  },
  setEnabled(flag, on) {
    if (!this.FLAGS.includes(flag)) throw new Error('Unknown fun setting: ' + flag);
    if (typeof on !== 'boolean') throw new Error(this.LABELS[flag].label + ' is on or off');
    const f = this.flags();
    f[flag] = on;
    this.save(this.KEY, f);
    try { document.dispatchEvent(new CustomEvent('vex:fun-changed', { detail: { flag, on } })); } catch { /* no document */ }
    return f;
  },

  // True while a game is running and Game mode is holding Vex quiet. Tracks
  // both the live session object and the broadcast, since either may be the
  // only one present (the start page has no GameSession).
  _gameFlag: false,
  gameActive() {
    if (this._gameFlag) return true;
    try { if (typeof GameSession !== 'undefined' && GameSession && GameSession.active) return true; } catch { /* not loaded */ }
    return false;
  },

  // Whether a module should be doing anything visible right now.
  live(flag) { return this.enabled(flag) && !this.gameActive(); },

  reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch { return false; }
  },

  // Dispatches the medal signal once per id. Returns true when it was sent.
  medal(id) {
    if (typeof id !== 'string' || !id) throw new Error('A medal signal needs an id');
    const sent = this.load('vex.fun.medals', {});
    if (sent[id]) return false;
    sent[id] = this.today();
    this.save('vex.fun.medals', sent);
    try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id } })); } catch { /* no document */ }
    return true;
  },

  esc(v) {
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // Surfaces a failure from an event handler, where nothing can catch it.
  report(what, err) {
    try { console.error('[fun] ' + what, err); } catch { /* no console */ }
    try { document.dispatchEvent(new CustomEvent('vex:problem', { detail: { source: 'fun', message: what + ': ' + (err && err.message) } })); } catch { /* no document */ }
  },
};

if (typeof document !== 'undefined') {
  document.addEventListener('vex:game-mode', (e) => {
    VexFun._gameFlag = !!(e && e.detail && e.detail.active);
  });
}

globalThis.VexFun = VexFun;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFun };
