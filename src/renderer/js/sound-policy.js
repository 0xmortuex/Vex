// === One sound at a time, and quiet during calls =================================
//
// Two opt-in rules, both OFF until you switch them on (Ctrl+K "One Sound at a Time"):
//
//   One sound at a time   When a tab or panel starts playing, the others that are playing are
//                         paused. Undo is in the toast; "resume afterwards" plays them again when
//                         the one that took over stops.
//   Quiet during calls    When a tab or panel starts using the microphone (a Discord, Meet, Zoom or
//                         Teams call, or any page recording your voice; the same signal as the
//                         microphone badge on the tab), everything else that is playing is paused,
//                         and played again when the call ends.
//
// Rules of the road:
//   - The call tab itself is never paused, and neither is any other tab that is using the microphone.
//   - A source on the exempt list (a music panel, a site) is outside both rules: it is never
//     paused and it never pauses anything.
//   - Only this window's tabs and panels are touched (each window runs its own copy).
//   - Pausing is the page's own pause(); a resume plays only the elements this paused, and only
//     if nobody pressed play on them in the meantime.
//   - Every pause is written to a log in memory (and to "Why did that happen?", with private and
//     Tor tabs named only as "a private tab") so "why did that stop?" has an answer.
//
// It listens for the tab's own events; there is no timer polling the pages.
const VexSoundPolicy = {
  FEATURE: 'sound-policy',
  PREF: 'vex.soundPolicy.prefs',   // { oneAtATime, pauseOnCalls, resume, resumeAfterCall, exempt: ['panel:spotify', 'host:music.youtube.com'] }
  COOLDOWN_MS: 3000,               // a source we just paused or resumed cannot trigger a pause
  RESUME_DELAY_MS: 2500,           // the one that took over must stay stopped this long before the others resume
  LOG_MAX: 50,
  EVAL_MS: 2500,

  _log: [],
  _held: new Map(),     // trigger key -> [{ key, label }] paused because of it
  _calls: new Set(),    // keys of sources using the microphone right now
  _ignore: new Map(),   // key -> time until which it cannot trigger
  _wired: false,
  _now() { return Date.now(); },

  // ---- prefs -----------------------------------------------------------------------------
  DEFAULTS: Object.freeze({ oneAtATime: false, pauseOnCalls: false, resume: false, resumeAfterCall: true, exempt: [] }),
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); }
    catch (err) { console.error('[SoundPolicy] the settings could not be read, so the rules stay off:', err.message); return { ...this.DEFAULTS }; }
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
      oneAtATime: o.oneAtATime === true,
      pauseOnCalls: o.pauseOnCalls === true,
      resume: o.resume === true,
      resumeAfterCall: o.resumeAfterCall !== false,
      exempt: Array.isArray(o.exempt) ? o.exempt.filter(e => typeof e === 'string' && /^(panel|host):[^\s]{1,200}$/.test(e)).slice(0, 100) : [],
    };
  },
  setPref(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.DEFAULTS, name)) throw new Error('Unknown sound setting: ' + name);
    const p = this.prefs();
    if (name === 'exempt') {
      if (!Array.isArray(value) || value.some(e => !/^(panel|host):[^\s]{1,200}$/.test(String(e)))) throw new Error('The exempt list holds panel:name and host:site entries');
      p.exempt = [...new Set(value.map(String))].slice(0, 100);
    } else p[name] = !!value;
    try { localStorage.setItem(this.PREF, JSON.stringify(p)); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    this.wire();
    return p;
  },
  enabled() { const p = this.prefs(); return p.oneAtATime || p.pauseOnCalls; },

  // ---- pure ------------------------------------------------------------------------------
  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  isExempt(source, exempt) {
    if (!source) return false;
    for (const e of exempt || []) {
      if (e === 'panel:' + source.id && source.kind === 'panel') return true;
      if (e.startsWith('host:') && source.host) { const h = e.slice(5); if (source.host === h || source.host.endsWith('.' + h)) return true; }
    }
    return false;
  },
  // Which sources to pause because `trigger` took over. sources: [{ key, kind, id, host, audible, capturingMic }].
  // Never the trigger, never anything exempt, never a source that is using the microphone, only what is playing.
  decide({ trigger, sources, exempt = [], ignore = {}, now = 0 } = {}) {
    if (!trigger) return [];
    return (sources || []).filter(s => s.key !== trigger.key && s.audible && !s.capturingMic && !this.isExempt(s, exempt) && !((ignore[s.key] || 0) > now));
  },
  // A page script: pause what is playing, remember which elements it paused so a resume plays only those.
  pauseScript() {
    return '(() => { let n = 0; for (const m of document.querySelectorAll("video,audio")) { if (!m.paused && !m.ended) { m.__vexSP = true; m.pause(); n++; } } return n; })()';
  },
  resumeScript() {
    return '(() => { let n = 0; for (const m of document.querySelectorAll("video,audio")) { if (!m.__vexSP) continue; delete m.__vexSP; if (m.paused) { const p = m.play(); if (p && typeof p.catch === "function") p.catch(function (e) { window.__vexSPError = String(e && e.name); }); n++; } } return n; })()';
  },

  // ---- the live sources --------------------------------------------------------------------
  _isPrivate(wv) {
    try { return !!(window.VexTabPolicy && wv && !window.VexTabPolicy.canReadWebview(wv)); } catch { return true; }
  },
  sources() {
    const out = [];
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined' && WebviewManager.webviews) {
      for (const t of TabManager.tabs || []) {
        if (!t || t.sleeping) continue;
        const wv = WebviewManager.webviews.get(t.id);
        if (!wv) continue;
        const priv = this._isPrivate(wv);
        out.push({ key: 'tab:' + t.id, kind: 'tab', id: t.id, wv, host: this.hostOf(t.url), label: priv ? 'a private tab' : (t.title || t.url || 'A tab'), private: priv, audible: !!t.audible && !t.muted, muted: !!t.muted, capturingMic: !!(t.capturing && t.capturing.mic) });
      }
    }
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
      for (const name of Object.keys(SidebarManager.panelWebviews)) {
        const wv = SidebarManager.panelWebviews[name];
        if (!wv) continue;
        let audible = false;
        try { audible = !!(typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()) && !(typeof wv.isAudioMuted === 'function' && wv.isAudioMuted()); }
        catch (err) { window.VexProblems?.note('Sound rules', 'Could not ask the ' + name + ' panel whether it is playing', err); }
        let muted = false;
        try { muted = !!(typeof wv.isAudioMuted === 'function' && wv.isAudioMuted()); } catch (err) { window.VexProblems?.note('Sound rules', 'Could not ask the ' + name + ' panel whether it is muted', err); }
        const cap = SidebarManager.panelCapture && SidebarManager.panelCapture[name];
        out.push({ key: 'panel:' + name, kind: 'panel', id: name, wv, host: this.hostOf(this._urlOf(wv)), label: typeof SidebarManager.panelLabel === 'function' ? SidebarManager.panelLabel(name) : name, private: false, audible, muted, capturingMic: !!(cap && cap.mic) });
      }
    }
    return out;
  },
  _urlOf(wv) { try { return typeof window.vexGuestUrl === 'function' ? window.vexGuestUrl(wv) : wv.getURL(); } catch { return ''; } },
  // The source a <webview> element belongs to.
  sourceOfWebview(wv) {
    return this.sources().find(s => s.wv === wv) || null;
  },
  sourceByKey(key) { return this.sources().find(s => s.key === key) || null; },

  async _run(source, script) {
    const r = await window.vexGuestEvalFrames(source.wv, script, true, this.EVAL_MS);
    let n = 0;
    for (const f of r.results || []) if (f && f.ok && Number.isFinite(Number(f.value))) n += Number(f.value);
    return n;
  },

  // ---- events --------------------------------------------------------------------------------
  wire() {
    const want = this.enabled();
    if (want && !this._wired) {
      this._wired = true;
      this._onStart = (ev) => this._guard(() => this.onStarted(ev), 'start');
      this._onStop = (ev) => this._guard(() => this.onStopped(ev), 'stop');
      this._onCapture = (ev) => this._guard(() => this.onCapture(ev && ev.detail), 'microphone');
      this._onClosed = (ev) => this._guard(() => this.onClosed(ev && ev.detail), 'close');
      // <webview> events do not bubble but pass the document on the way down: one capturing listener hears every tab and panel.
      document.addEventListener('media-started-playing', this._onStart, true);
      document.addEventListener('media-paused', this._onStop, true);
      document.addEventListener('vex:media-capture', this._onCapture);
      document.addEventListener('vex:tab-closed', this._onClosed);
    } else if (!want && this._wired) {
      this._wired = false;
      document.removeEventListener('media-started-playing', this._onStart, true);
      document.removeEventListener('media-paused', this._onStop, true);
      document.removeEventListener('vex:media-capture', this._onCapture);
      document.removeEventListener('vex:tab-closed', this._onClosed);
      this._held.clear(); this._calls.clear();
    }
    return this._wired;
  },
  _guard(fn, what) {
    Promise.resolve().then(fn).catch(err => window.VexProblems?.note('Sound rules', 'The ' + what + ' rule failed', err));
  },

  // A tab or panel started playing.
  async onStarted(ev) {
    const wv = ev && ev.target;
    if (!wv || wv.tagName !== 'WEBVIEW') return [];
    const p = this.prefs();
    if (!p.oneAtATime) return [];
    const all = this.sources();
    const src = all.find(s => s.wv === wv);
    if (!src) return [];
    // Pressing play on something we paused takes it off every waiting list.
    for (const [k, list] of this._held) { const rest = list.filter(h => h.key !== src.key); if (rest.length) this._held.set(k, rest); else this._held.delete(k); }
    this._held.delete(src.key);
    const now = this._now();
    const ignore = Object.fromEntries(this._ignore);
    if ((ignore[src.key] || 0) > now) return [];
    if (src.muted || this.isExempt(src, p.exempt)) return [];
    const targets = this.decide({ trigger: src, sources: all, exempt: p.exempt, ignore, now });
    if (!targets.length) return [];
    return this._pause(targets, src, 'one-at-a-time', p.resume);
  },

  // A tab or panel stopped playing: what it had paused may come back (when "resume afterwards" is on).
  async onStopped(ev) {
    const wv = ev && ev.target;
    if (!wv || wv.tagName !== 'WEBVIEW') return;
    const src = this.sourceOfWebview(wv);
    if (!src || !this._held.has(src.key) || this._calls.has(src.key)) return;
    const key = src.key;
    // The player may only be between two tracks: it must stay stopped for a moment.
    setTimeout(() => { this._guard(async () => {
      const again = this.sourceByKey(key);
      if (again && again.audible) return;
      await this._resume(key, 'The one that took over has stopped');
    }, 'resume'); }, this.RESUME_DELAY_MS);
  },

  // Microphone started or stopped in a tab or panel.
  async onCapture(d) {
    if (!d || d.kind !== 'mic' || (d.where !== 'tab' && d.where !== 'panel')) return [];
    const key = (d.where === 'tab' ? 'tab:' : 'panel:') + d.id;
    const p = this.prefs();
    if (!d.active) {
      if (!this._calls.delete(key)) return [];
      if (p.resumeAfterCall) await this._resume(key, 'The call ended');
      else this._held.delete(key);
      return [];
    }
    this._calls.add(key);
    if (!p.pauseOnCalls) return [];
    const all = this.sources();
    const src = all.find(s => s.key === key) || { key, kind: d.where, id: d.id, host: '', label: 'A call', audible: false, capturingMic: true };
    if (this.isExempt(src, p.exempt)) return [];
    const targets = this.decide({ trigger: src, sources: all, exempt: p.exempt, ignore: Object.fromEntries(this._ignore), now: this._now() });
    if (!targets.length) return [];
    return this._pause(targets, src, 'call', p.resumeAfterCall);
  },

  // A tab was closed. A call tab that is closed ended the call (no stop event comes from a page that is gone), and a tab that
  // had taken over has stopped: what it paused comes back if the matching "play them again" switch is on.
  async onClosed(d) {
    const key = 'tab:' + (d && d.tabId);
    const wasCall = this._calls.delete(key);
    if (!this._held.has(key)) return;
    const p = this.prefs();
    if (wasCall ? p.resumeAfterCall : p.resume) await this._resume(key, 'The tab was closed');
    else this._held.delete(key);
  },

  // ---- acting --------------------------------------------------------------------------------
  async _pause(targets, trigger, kind, remember) {
    const done = [];
    const now = this._now();
    for (const t of targets) {
      try {
        const n = await this._run(t, this.pauseScript());
        this._ignore.set(t.key, now + this.COOLDOWN_MS);
        if (n > 0) done.push({ key: t.key, label: t.label, private: t.private });
      } catch (err) { window.VexProblems?.note('Sound rules', 'Could not pause ' + t.label, err); }
    }
    if (!done.length) return [];
    if (remember) this._held.set(trigger.key, done.map(d => ({ key: d.key, label: d.label })));
    const names = done.map(d => d.label);
    const why = kind === 'call' ? trigger.label + ' started using the microphone' : trigger.label + ' started playing';
    this._record(kind, 'Paused ' + names.join(', '), why, done.map(d => d.private), trigger);
    const msg = kind === 'call' ? (done.length === 1 ? 'Paused 1 player for the call' : 'Paused ' + done.length + ' players for the call') : (done.length === 1 ? 'Paused 1 other player' : 'Paused ' + done.length + ' other players');
    if (window.VexUndo && typeof window.VexUndo.offer === 'function') {
      window.VexUndo.offer({ message: msg, undo: () => { this._guard(() => this._resumeSources(done.map(d => d.key)), 'undo'); this._held.delete(trigger.key); } });
    } else window.showToast?.(msg, 'info');
    return done;
  },

  async _resume(triggerKey, why) {
    const list = this._held.get(triggerKey);
    this._held.delete(triggerKey);
    if (!list || !list.length) return 0;
    const n = await this._resumeSources(list.map(h => h.key));
    if (n) this._record('resume', 'Resumed ' + n + ' player' + VexPlural.s(n), why, [], null);
    return n;
  },

  // Plays again what we paused: only elements still flagged, only in sources that are not playing anything now.
  async _resumeSources(keys) {
    let n = 0;
    const now = this._now();
    for (const key of keys) {
      const s = this.sourceByKey(key);
      if (!s || s.audible) continue;
      try { this._ignore.set(key, now + this.COOLDOWN_MS); n += await this._run(s, this.resumeScript()); }
      catch (err) { window.VexProblems?.note('Sound rules', 'Could not resume ' + s.label, err); }
    }
    return n;
  },

  // ---- the log: "why did that stop?" -----------------------------------------------------------------
  _record(kind, what, why, privateFlags, trigger) {
    const entry = { at: this._now(), kind, what, why };
    this._log.push(entry);
    if (this._log.length > this.LOG_MAX) this._log.splice(0, this._log.length - this.LOG_MAX);
    const hidden = (privateFlags || []).some(Boolean) || (trigger && trigger.private) || (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow);
    // The ledger keeps its lines on disk, so a private or Tor tab is never named in it, and a private window writes none.
    if (!hidden && kind !== 'resume' && window.VexLedger && typeof window.VexLedger.note === 'function') {
      window.VexLedger.note({ feature: this.FEATURE, what, why, stop: { kind: 'sound-policy-off' } });
    }
    return entry;
  },
  events() { return this._log.slice().reverse(); },
  // The newest reason a tab with this label (or any tab, with no label) was paused.
  explain(label) {
    const hit = this._log.slice().reverse().find(e => e.kind !== 'resume' && (!label || e.what.includes(label)));
    return hit ? hit.what + ': ' + hit.why + '.' : 'Nothing was paused by the sound rules in this window.';
  },

  // ---- Settings and Ctrl+K ----------------------------------------------------------------------------
  // The exempt-list candidates: open panels, the sites of tabs that make sound now, and what is saved.
  candidates() {
    const p = this.prefs();
    const out = new Map();
    const add = (entry, label) => { if (!out.has(entry)) out.set(entry, label); };
    for (const s of this.sources()) {
      if (s.kind === 'panel') add('panel:' + s.id, 'Panel: ' + s.label);
      else if (s.host && s.audible && !s.private) add('host:' + s.host, 'Site: ' + s.host);
    }
    for (const e of p.exempt) add(e, e.startsWith('panel:') ? 'Panel: ' + e.slice(6) : 'Site: ' + e.slice(5));
    return [...out].map(([entry, label]) => ({ entry, label }));
  },

  group(el) {
    const p = this.prefs();
    const fail = (err) => window.showToast?.(err.message, 'error');
    const sw = (label, name, hint) => {
      el.appendChild(VexSettingsGroup.toggle(label, p[name], (on) => { try { this.setPref(name, on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); } catch (err) { fail(err); } }));
      if (hint) el.appendChild(VexSettingsGroups.note(hint));
    };
    el.appendChild(VexSettingsGroups.note('Both rules are off until you switch them on. They pause the page\'s own players with pause() and never close or reload anything. Only this window\'s tabs and panels are touched.'));
    sw('One sound at a time', 'oneAtATime', 'When a tab or panel starts playing, the others that are playing are paused. The toast has an Undo.');
    sw('Play them again when the one that took over stops', 'resume');
    sw('Pause other media during calls', 'pauseOnCalls', 'When a tab or panel starts using the microphone (Discord, Meet, Zoom, Teams, or any page recording your voice) everything else that is playing is paused. The call tab itself is never paused.');
    sw('Play them again when the call ends', 'resumeAfterCall');
    el.appendChild(VexSettingsGroups.note('Never touch these (they are not paused and they do not pause anything):'));
    const cands = this.candidates();
    if (!cands.length) el.appendChild(VexSettingsGroups.note('Nothing to choose from yet: open a panel, or play something in a tab.'));
    for (const c of cands) {
      el.appendChild(VexSettingsGroup.toggle(c.label, p.exempt.includes(c.entry), (on) => {
        try { const cur = this.prefs().exempt.filter(e => e !== c.entry); this.setPref('exempt', on ? [...cur, c.entry] : cur); }
        catch (err) { fail(err); }
      }));
    }
    el.appendChild(VexSettingsGroups.button('Why did that stop?', () => this.openLog()));
  },

  async open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-sound-policy', title: 'One sound at a time', sub: 'Pause the other players when one starts, and during calls. Off until you switch it on.' });
    this.group(body);
    return body;
  },

  async openLog() {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-sound-log', title: 'Why did that stop?', sub: 'What the sound rules paused in this window since Vex opened. This list is not saved.' });
    const list = this.events();
    if (!list.length) { body.appendChild(VexSettingsGroups.note('Nothing was paused by the sound rules.')); return body; }
    for (const e of list) {
      const line = document.createElement('div');
      line.className = 'vex-platform-note';
      line.textContent = new Date(e.at).toLocaleTimeString() + '  ' + e.what + ' - ' + e.why;
      body.appendChild(line);
    }
    return body;
  },
};

if (typeof window !== 'undefined') {
  window.VexSoundPolicy = VexSoundPolicy;
  if (window.VexLedger && typeof window.VexLedger.registerStop === 'function') {
    // "Stop doing this" in Why did that happen?: both rules off.
    window.VexLedger.registerStop('sound-policy-off', () => { VexSoundPolicy.setPref('oneAtATime', false); VexSoundPolicy.setPref('pauseOnCalls', false); });
  }
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'sound-policy', title: 'One sound at a time', keywords: 'one sound at a time pause other tabs auto pause calls microphone discord meet zoom teams music pause when call resume exempt', before: 'about', build: (el) => VexSoundPolicy.group(el) });
  }
  // Switched on in an earlier session: listen again (nothing is attached while both rules are off).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexSoundPolicy.wire(), { once: true });
  else VexSoundPolicy.wire();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSoundPolicy };
