// === Sleep timer for media =======================================================
//
// "Stop playing in 15 / 30 / 60 / 90 minutes, or when this video ends." Started only
// by a press (Ctrl+K "Sleep Timer", or the Now Playing card); nothing here runs until
// then, and the clock is in memory only, so closing Vex ends it cleanly: there is
// nothing saved that could pause something next week.
//
// While it counts down, one timer ticks once a second. In the last 15 seconds every
// player that is making sound is turned down a little more each tick (the element's
// own volume, never the page's slider), and at the end every playing <video> and
// <audio> in every open tab and panel is paused and its volume put back, so pressing
// play later is at the level it was. Optionally the tabs are muted as well.
//
// It never wakes a sleeping tab and never calls play(): a tab that is asleep has no
// page to pause, and one that is woken later loads as it always does. A tab opened
// after the timer ends is not touched.
//
// "When this video ends" watches the player of the tab in front: its own `ended`
// event pauses everything at once. A site that starts the next video by itself a few
// seconds later (autoplay next) is stopped again by the same watcher, because the
// watcher stays on the first player; a site that swaps in a new player element is not.
const VexSleepTimer = {
  FEATURE: 'sleep-timer',
  PREF: 'vex.sleepTimer.prefs',      // { mute } - the only thing remembered
  PRESETS: [15, 30, 60, 90],         // minutes
  EXTEND_MIN: 15,
  FADE_MS: 15000,
  TICK_MS: 1000,
  MAX_END_WAIT_MS: 8 * 3600 * 1000,  // "when the video ends" gives up after this
  EVAL_MS: 2500,

  _s: null,          // { mode: 'minutes' | 'end', startedAt, endsAt, tabId, label }
  _iv: null,
  _faded: new Set(), // webviews whose volume was turned down and must be put back
  _busy: false,
  _now() { return Date.now(); },

  // ---- pure ---------------------------------------------------------------------------
  // 1 until the last `fadeMs`, then down to 0 along a curve that sounds even to the ear.
  fadeFactor(remainingMs, fadeMs = this.FADE_MS) {
    if (!Number.isFinite(remainingMs)) throw new Error('fadeFactor needs a number of milliseconds');
    if (remainingMs >= fadeMs) return 1;
    if (remainingMs <= 0) return 0;
    const f = remainingMs / fadeMs;
    return f * f;
  },
  format(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  },
  // The toast when it stops; whole sentences, so each can be translated.
  endMessage(paused, muted) {
    if (!paused) return muted ? 'Sleep timer: nothing was playing; the tabs are muted' : 'Sleep timer: nothing was playing';
    if (paused === 1) return muted ? 'Sleep timer: paused 1 player and muted the tabs' : 'Sleep timer: paused 1 player';
    return muted ? 'Sleep timer: paused ' + paused + ' players and muted the tabs' : 'Sleep timer: paused ' + paused + ' players';
  },
  parseMinutes(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 24 * 60) throw new Error('A sleep timer is between 1 minute and 24 hours');
    return Math.round(n);
  },

  // ---- page-side scripts (fixed text; nothing from a page is put into them) ----------
  // Turn every playing element down to `factor` of the level it had; remembers that level once.
  fadeScript(factor) {
    const f = Math.max(0, Math.min(1, Number(factor)));
    return '(() => { let n = 0; for (const m of document.querySelectorAll("video,audio")) { if (m.paused) continue; if (m.__vexSleepBase === undefined) m.__vexSleepBase = m.volume; try { m.volume = m.__vexSleepBase * ' + f + '; n++; } catch (e) {} } return n; })()';
  },
  // Put the level back on every element the fade touched (paused ones too, so play later is at the old level).
  restoreScript() {
    return '(() => { let n = 0; for (const m of document.querySelectorAll("video,audio")) { if (m.__vexSleepBase === undefined) continue; try { m.volume = m.__vexSleepBase; n++; } catch (e) {} delete m.__vexSleepBase; } return n; })()';
  },
  // Watch the player in front for its end. -> true when a player is being watched.
  endWatchScript() {
    return '(() => { const list = Array.from(document.querySelectorAll("video,audio")).filter(m => m.duration || !m.paused); const v = list.find(m => !m.paused) || list[0]; if (!v) return false; if (v.__vexSleepEnd) return true; v.__vexSleepEnd = true; window.__vexSleepEnded = false; const on = () => { window.__vexSleepEnded = true; for (const m of document.querySelectorAll("video,audio")) if (!m.paused) m.pause(); }; v.addEventListener("ended", on); window.__vexSleepUnwatch = () => { v.removeEventListener("ended", on); delete v.__vexSleepEnd; window.__vexSleepEnded = undefined; }; return true; })()';
  },
  endPollScript() { return '(() => window.__vexSleepEnded === true ? "ended" : (window.__vexSleepUnwatch ? "waiting" : "none"))()'; },
  endUnwatchScript() { return '(() => { if (window.__vexSleepUnwatch) { window.__vexSleepUnwatch(); delete window.__vexSleepUnwatch; return true; } return false; })()'; },

  // ---- remembered choice ----------------------------------------------------------------
  muteAtEnd() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !!(raw && raw.mute); }
    catch (err) { console.error('[SleepTimer] the setting could not be read:', err.message); return false; }
  },
  setMuteAtEnd(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ mute: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },

  // ---- state ----------------------------------------------------------------------------
  active() { return !!this._s; },
  state() { return this._s ? { ...this._s } : null; },
  remainingMs() { return this._s && this._s.mode === 'minutes' ? Math.max(0, this._s.endsAt - this._now()) : null; },
  // One line for the Now Playing card, Ctrl+K and the dialog.
  describe() {
    if (!this._s) return '';
    if (this._s.mode === 'end') return 'Sleep timer: stops when this video ends';
    return 'Sleep timer: ' + this.format(this.remainingMs()) + ' left';
  },

  // ---- the live pages --------------------------------------------------------------------
  // Every page that has a player to pause: open tabs that are awake, and panels. A sleeping tab has no page
  // and is left asleep.
  _pages() {
    const out = [];
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined' && WebviewManager.webviews) {
      for (const t of TabManager.tabs || []) {
        if (!t || t.sleeping) continue;
        const wv = WebviewManager.webviews.get(t.id);
        if (wv) out.push({ kind: 'tab', id: t.id, label: t.title || t.url || 'A tab', wv, audible: !!t.audible && !t.muted });
      }
    }
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
      for (const name of Object.keys(SidebarManager.panelWebviews)) {
        const wv = SidebarManager.panelWebviews[name];
        if (!wv) continue;
        let audible = false;
        try { audible = !!(typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()); } catch (err) { window.VexProblems?.note('Sleep timer', 'Could not ask the ' + name + ' panel whether it is playing', err); }
        out.push({ kind: 'panel', id: name, label: name, wv, audible });
      }
    }
    return out;
  },

  async _runAll(page, script) {
    const r = await window.vexGuestEvalFrames(page.wv, script, false, this.EVAL_MS);
    let n = 0;
    for (const f of r.results || []) if (f && f.ok && Number.isFinite(Number(f.value))) n += Number(f.value);
    return n;
  },

  async _pauseScript() {
    if (!window.VexMediaControl && typeof VexLazy !== 'undefined') await VexLazy.ensure('js/media-control.js');
    if (!window.VexMediaControl) throw new Error('The player controls are not loaded');
    return window.VexMediaControl.mediaScript('pause');
  },

  async _fade(factor) {
    for (const p of this._pages()) {
      if (!p.audible && !this._faded.has(p.wv)) continue;
      try { await this._runAll(p, this.fadeScript(factor)); this._faded.add(p.wv); }
      catch (err) { window.VexProblems?.note('Sleep timer', 'Could not turn ' + p.label + ' down', err); }
    }
  },

  async _restore() {
    const set = [...this._faded];
    this._faded.clear();
    for (const wv of set) {
      try { await this._runAll({ wv }, this.restoreScript()); }
      catch (err) { window.VexProblems?.note('Sleep timer', 'Could not put a page\'s volume back', err); }
    }
  },

  // ---- starting, changing, ending ------------------------------------------------------
  async start({ minutes, untilEnd = false } = {}) {
    if (this._s) await this.cancel(true);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const now = this._now();
    if (untilEnd) {
      const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
      const wv = tab && typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
      if (!tab || !wv) throw new Error('Open the video first, then start the timer');
      const found = await this._runAllValue(wv, this.endWatchScript());
      if (!found) throw new Error('This tab has no video or sound to wait for');
      this._s = { mode: 'end', startedAt: now, endsAt: null, tabId: tab.id };
    } else {
      const m = this.parseMinutes(minutes);
      this._s = { mode: 'minutes', startedAt: now, endsAt: now + m * 60000, tabId: null, minutes: m };
    }
    this._start();
    window.showToast?.(untilEnd ? 'Sleep timer: everything stops when this video ends' : 'Sleep timer: everything stops in ' + this._s.minutes + ' minutes', 'info');
    this._paint();
    return this.state();
  },

  async _runAllValue(wv, script) {
    const r = await window.vexGuestEvalFrames(wv, script, false, this.EVAL_MS);
    return (r.results || []).some(f => f && f.ok && f.value);
  },

  // A chain of one-second timeouts, not VexJobs: a timer the person started must keep counting while Vex is hidden or a game
  // is running (js/jobs.js holds jobs then), and it ends the moment it is stopped.
  _start() {
    clearTimeout(this._iv);
    const step = () => {
      this._iv = setTimeout(async () => {
        try { await this._tick(); }
        catch (err) { window.VexProblems?.note('Sleep timer', 'The timer could not check the time', err); }
        if (this._s) step();
      }, this.TICK_MS);
    };
    step();
  },
  _stop() { clearTimeout(this._iv); this._iv = null; },

  extend(minutes = this.EXTEND_MIN) {
    if (!this._s) throw new Error('There is no sleep timer to add time to');
    if (this._s.mode !== 'minutes') throw new Error('Adding time works on a timed sleep timer; start a new one instead');
    const m = this.parseMinutes(minutes);
    const wasFading = this.remainingMs() <= this.FADE_MS;
    this._s.endsAt += m * 60000;
    if (wasFading) this._restore().catch(err => window.VexProblems?.note('Sleep timer', 'Could not put the volume back', err));
    window.showToast?.('Sleep timer: ' + m + ' more minutes (' + this.format(this.remainingMs()) + ' left)', 'info');
    this._paint();
    return this.state();
  },

  async cancel(quiet = false) {
    if (!this._s) return false;
    const s = this._s;
    this._s = null;
    this._stop();
    if (s.mode === 'end') {
      const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(s.tabId) : null;
      if (wv) await this._runAll({ wv }, this.endUnwatchScript()).catch(err => window.VexProblems?.note('Sleep timer', 'Could not stop watching the video', err));
    }
    await this._restore();
    if (!quiet) window.showToast?.('Sleep timer cancelled', 'info');
    this._paint();
    return true;
  },

  async _tick() {
    const s = this._s;
    if (!s || this._busy) return;
    this._busy = true;
    try {
      if (s.mode === 'end') {
        if (this._now() - s.startedAt > this.MAX_END_WAIT_MS) { await this.cancel(true); window.showToast?.('Sleep timer: gave up waiting for the video to end', 'info'); return; }
        const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(s.tabId) : null;
        if (!wv) { await this.cancel(true); window.showToast?.('Sleep timer: the video\'s tab was closed, so the timer was cancelled', 'info'); return; }
        const r = await window.vexGuestEvalFrames(wv, this.endPollScript(), false, this.EVAL_MS);
        const vals = (r.results || []).filter(f => f && f.ok).map(f => f.value);
        if (vals.includes('ended')) await this._expire('The video ended');
        else if (!vals.includes('waiting')) await this._runAllValue(wv, this.endWatchScript());   // the page was reloaded: watch the new player
        return;
      }
      const left = this.remainingMs();
      this._paint();
      if (left <= 0) { await this._expire('The time is up'); return; }
      if (left <= this.FADE_MS) await this._fade(this.fadeFactor(left));
    } finally { this._busy = false; }
  },

  // Pause everything that is playing, put the volume back, optionally mute. Never plays, never wakes.
  async _expire(why) {
    this._s = null;
    this._stop();
    let paused = 0;
    const mute = this.muteAtEnd();
    let script;
    try { script = await this._pauseScript(); }
    catch (err) { window.VexProblems?.note('Sleep timer', 'Could not get the pause script', err); this._paint(); return 0; }
    for (const p of this._pages()) {
      try { paused += await this._runAll(p, script); }
      catch (err) { window.VexProblems?.note('Sleep timer', 'Could not pause ' + p.label, err); }
      if (mute && p.kind === 'tab' && typeof p.wv.setAudioMuted === 'function') {
        try {
          p.wv.setAudioMuted(true);
          const t = typeof TabManager !== 'undefined' ? (TabManager.tabs || []).find(x => x.id === p.id) : null;
          if (t) { t.muted = true; TabManager.renderTabUpdate?.(t); }
        } catch (err) { window.VexProblems?.note('Sleep timer', 'Could not mute ' + p.label, err); }
      }
    }
    await this._restore();
    this.lastEnd = { at: this._now(), why, paused, muted: mute };
    window.showToast?.(this.endMessage(paused, mute), 'info');
    this._paint();
    return paused;
  },

  // ---- showing it -------------------------------------------------------------------------
  // The small row in the Now Playing card (js/tab-ai-media.js asks for it each time it draws).
  chip() {
    if (!this._s) return null;
    const row = document.createElement('div');
    row.className = 'vex-sleep-chip';
    row.style.cssText = 'display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:5px 10px;font-size:11px;color:var(--text)';
    const text = document.createElement('span');
    text.className = 'vex-sleep-chip-text';
    text.style.cssText = 'flex:1;min-width:0';
    text.textContent = this.describe();
    row.appendChild(text);
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = 'border:none;background:var(--bg);color:var(--text);border-radius:6px;padding:2px 7px;cursor:pointer;font-size:11px'; b.addEventListener('click', (e) => { e.stopPropagation(); Promise.resolve().then(fn).catch(err => window.showToast?.(err.message, 'error')); }); return b; };
    if (this._s.mode === 'minutes') row.appendChild(mk('+' + this.EXTEND_MIN + ' min', async () => { this.extend(); }));
    row.appendChild(mk('Cancel', () => this.cancel()));
    return row;
  },
  _paint() {
    if (typeof document === 'undefined') return;
    for (const el of document.querySelectorAll('.vex-sleep-chip-text')) el.textContent = this.describe();
    if (typeof NowPlaying !== 'undefined' && typeof NowPlaying._render === 'function') {
      const has = !!document.querySelector('.vex-sleep-chip');
      if (has !== !!this._s) NowPlaying._render();
    }
  },

  async open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-sleep-timer', title: 'Sleep timer', sub: 'Stop playing after a while. The sound fades out over the last 15 seconds, then everything that is playing is paused.' });
    const draw = () => {
      body.textContent = '';
      const fail = (err) => window.showToast?.(err.message, 'error');
      if (this._s) {
        body.appendChild(VexSettingsGroups.note(this.describe()));
        const row = document.createElement('div');
        row.className = 'vexsr-row';
        if (this._s.mode === 'minutes') row.appendChild(VexSettingsGroups.button('Add ' + this.EXTEND_MIN + ' minutes', () => { try { this.extend(); } catch (err) { fail(err); } draw(); }, { primary: true }));
        row.appendChild(VexSettingsGroups.button('Cancel the timer', async () => { try { await this.cancel(); } catch (err) { fail(err); } draw(); }, { danger: true }));
        body.appendChild(row);
      }
      const label = document.createElement('div');
      label.className = 'vex-platform-note';
      label.textContent = this._s ? 'Or start a new one:' : 'Stop playing in:';
      body.appendChild(label);
      const presets = document.createElement('div');
      presets.className = 'vexsr-row';
      for (const m of this.PRESETS) presets.appendChild(VexSettingsGroups.button(m === 60 ? '1 hour' : m === 90 ? '1 hour 30 minutes' : m + ' minutes', async () => { try { await this.start({ minutes: m }); close(); } catch (err) { fail(err); } }));
      presets.appendChild(VexSettingsGroups.button('When this video ends', async () => { try { await this.start({ untilEnd: true }); close(); } catch (err) { fail(err); } }));
      body.appendChild(presets);
      const lab = document.createElement('label');
      lab.className = 'vex-platform-note';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.muteAtEnd();
      box.addEventListener('change', () => { try { this.setMuteAtEnd(box.checked); } catch (err) { fail(err); box.checked = !box.checked; } });
      lab.appendChild(box);
      lab.appendChild(document.createTextNode(' Also mute the tabs when it stops'));
      body.appendChild(lab);
    };
    draw();
    return body;
  },
};

if (typeof window !== 'undefined') {
  window.VexSleepTimer = VexSleepTimer;
  // Quitting Vex or closing the window ends it: nothing is saved, so there is nothing to clean up but the clock.
  window.addEventListener('beforeunload', () => { VexSleepTimer._stop(); });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSleepTimer };
