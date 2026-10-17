// === One control for everything that is making sound ============================
//
// T3-015. A tab is playing something, a panel is playing something else, a third
// tab is playing an ad, and finding which is which means opening each. This lists
// every tab and panel that is audible right now, with what it says it is playing
// (the title and artist a page publishes through the media session, the same
// thing the lock screen shows), and gives each of them the same four buttons:
// play/pause, next, mute, and "go to it". Two bulk actions sit on top:
//
//   Only this one     mutes every other audible source (with an Undo that un-mutes exactly those)
//   Pause the rest    pauses the other sources' players (they are paused, not closed or reloaded)
//
// How it works, honestly: play/pause and the title use the page's own <audio>/<video>
// elements and navigator.mediaSession.metadata, read with fixed scripts when you open
// the list or press a button. Mute is the tab's or panel's own audio switch, so it works
// on any page. "Next" presses the player's own Next button, found by its label or by the
// ids YouTube and Spotify ship (the same lookup the music panels use); a page that has none
// is told about, not guessed at. A page cannot be asked to run its media-session handlers
// from outside, so a player that offers next only through the media keys is not reachable
// that way.
//
// Nothing runs in the background: the list is read when you open it or press Refresh.
// A private or Tor tab is listed (it is making sound in front of you) but its page is not
// read for a title, and the list is never stored.

const VexMediaControl = {
  PREF: 'vex.mediaControl.prefs',          // { enabled }
  FEATURE: 'media-control',
  READ_MS: 2000,

  META_SCRIPT: '(() => { const s = navigator.mediaSession; const m = s && s.metadata; return { title: m ? String(m.title || "").slice(0, 120) : "", artist: m ? String(m.artist || "").slice(0, 120) : "", state: s ? String(s.playbackState || "") : "" }; })()',
  NEXT: ['.ytp-next-button', '[data-testid="control-button-skip-forward"]', 'button[aria-label*="Next" i]', 'button[title*="Next" i]', '.ytmusic-player-bar .next-button', '.skipControl__next'],

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[MediaControl] the setting could not be read:', err.message); return false; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },

  // ---- pure: the page-side scripts ------------------------------------------------------
  // what: 'toggle' | 'pause'. Returns "playing" / "paused" / null (no player) or a count for pause.
  mediaScript(what) {
    const body = what === 'pause'
      ? 'let n = 0; for (const m of list) if (!m.paused) { m.pause(); n++; } return n;'
      : 'const m = list.find(x => !x.paused) || list[0]; if (!m) return null; if (m.paused) m.play(); else m.pause(); return m.paused ? "paused" : "playing";';
    return '(() => { const list = Array.from(document.querySelectorAll("video,audio")).filter(m => m.duration || m.currentTime || !m.paused); ' + body + ' })()';
  },
  clickScript(selectors) {
    return '(() => { const f = ' + JSON.stringify(selectors) + '.map(s => document.querySelector(s)).find(Boolean); if (!f) return false; f.click(); return true; })()';
  },

  // The sources, from plain data (so it can be tested): tabs = [{ id, title, audible, muted, active, private }],
  // panels = [{ name, label, audible, muted }]. Only audible ones, the front tab last-resort first.
  rows({ tabs = [], panels = [] } = {}) {
    const out = [];
    for (const t of tabs) if (t && t.audible) out.push({ kind: 'tab', id: t.id, label: String(t.title || 'A tab'), muted: !!t.muted, active: !!t.active, private: !!t.private });
    for (const p of panels) if (p && p.audible) out.push({ kind: 'panel', id: p.name, label: String(p.label || p.name), muted: !!p.muted, active: false, private: false });
    return out;
  },
  // Which of the rows "only this one" would mute: every other row that is not muted already.
  othersToMute(rows, keep) { return rows.filter(r => !(r.kind === keep.kind && r.id === keep.id) && !r.muted); },

  // ---- the live sources -------------------------------------------------------------------
  _webviewOf(row) {
    if (row.kind === 'tab') return typeof WebviewManager !== 'undefined' ? (WebviewManager.webviews && WebviewManager.webviews.get(row.id)) || null : null;
    const mgr = typeof SidebarManager !== 'undefined' ? SidebarManager : null;
    if (!mgr) return null;
    const el = document.getElementById('panel-' + row.id);
    return (el && el.querySelector && el.querySelector('webview')) || (mgr.panelWebviews && mgr.panelWebviews[row.id]) || null;
  },

  live() {
    const tabs = [];
    if (typeof TabManager !== 'undefined') {
      for (const t of TabManager.tabs || []) {
        if (!t || !t.audible) continue;
        const p = t.partition ? String(t.partition) : '';
        tabs.push({ id: t.id, title: t.title || t.url, audible: true, muted: !!t.muted, active: t.id === TabManager.activeTabId, private: !!p && !p.startsWith('persist:') });
      }
    }
    const panels = [];
    const mgr = typeof SidebarManager !== 'undefined' ? SidebarManager : null;
    if (mgr && mgr.panelWebviews) {
      for (const name of Object.keys(mgr.panelWebviews)) {
        const wv = this._webviewOf({ kind: 'panel', id: name });
        let audible = false;
        let muted = false;
        try { audible = !!(wv && typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()); muted = !!(wv && typeof wv.isAudioMuted === 'function' && wv.isAudioMuted()); }
        catch (err) { window.VexProblems?.note('Media control', 'Could not ask the ' + name + ' panel whether it is playing', err); }
        if (audible) panels.push({ name, label: typeof mgr.panelLabel === 'function' ? mgr.panelLabel(name) : name, audible, muted });
      }
    }
    return this.rows({ tabs, panels });
  },

  async describe(row) {
    const wv = this._webviewOf(row);
    if (!wv) return { ...row, now: '' };
    if (row.private || (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv))) return { ...row, now: '' };
    try {
      const meta = await window.vexGuestEval(wv, this.META_SCRIPT, false, this.READ_MS);
      const now = [meta && meta.artist, meta && meta.title].filter(Boolean).join(' - ');
      return { ...row, now };
    } catch (err) {
      window.VexProblems?.note('Media control', 'Could not read what ' + row.label + ' is playing', err);
      return { ...row, now: '' };
    }
  },

  // ---- actions ------------------------------------------------------------------------------
  async _run(row, script) {
    const wv = this._webviewOf(row);
    if (!wv) throw new Error(row.label + ' is not open any more');
    return window.vexGuestEval(wv, script, true, this.READ_MS);
  },
  async playPause(row) {
    const state = await this._run(row, this.mediaScript('toggle'));
    if (state == null) throw new Error('Nothing in ' + row.label + ' can be paused or played from here');
    return state;
  },
  async next(row) {
    if (!(await this._run(row, this.clickScript(this.NEXT)))) throw new Error(row.label + ' has no Next button Vex can find');
    return true;
  },
  setMuted(row, muted) {
    const wv = this._webviewOf(row);
    if (!wv || typeof wv.setAudioMuted !== 'function') throw new Error(row.label + ' is not open any more');
    wv.setAudioMuted(!!muted);
    if (row.kind === 'tab' && typeof TabManager !== 'undefined') {
      const tab = (TabManager.tabs || []).find(t => t.id === row.id);
      if (tab) { tab.muted = !!muted; TabManager.renderTabUpdate?.(tab); }
    }
    return !!muted;
  },
  goTo(row) {
    if (row.kind === 'tab') { if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded'); TabManager.switchTab(row.id); return; }
    if (typeof SidebarManager === 'undefined') throw new Error('Panels are not loaded');
    SidebarManager.showPanel(row.id);
  },

  // Mute every other audible source. The Undo un-mutes exactly those, nothing else.
  onlyThis(keep, rows = this.live()) {
    const targets = this.othersToMute(rows, keep);
    if (!targets.length) { window.showToast?.('Nothing else is making sound', 'info'); return []; }
    const done = [];
    for (const r of targets) {
      try { this.setMuted(r, true); done.push(r); }
      catch (err) { window.VexProblems?.note('Media control', 'Could not mute ' + r.label, err); }
    }
    if (done.length) {
      window.VexUndo.offer({
        message: 'Muted ' + done.length + ' other ' + (done.length === 1 ? 'source' : 'sources'),
        undo: () => { for (const r of done) this.setMuted(r, false); },
      });
    }
    return done;
  },

  async pauseOthers(keep, rows = this.live()) {
    let n = 0;
    for (const r of rows) {
      if (keep && r.kind === keep.kind && r.id === keep.id) continue;
      try { const c = await this._run(r, this.mediaScript('pause')); n += Number(c) || 0; }
      catch (err) { window.VexProblems?.note('Media control', 'Could not pause ' + r.label, err); }
    }
    window.showToast?.(n ? 'Paused ' + n + ' player' + VexPlural.s(n) : 'Nothing else was playing', 'info');
    return n;
  },

  // ---- the list ---------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('Media control is switched off in Settings', 'info'); return null; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-media-control', title: 'Everything making sound', sub: 'Tabs and panels that are playing audio right now. Mute and pause act on the page\'s own player.' });
    const draw = async () => {
      body.textContent = '';
      let rows;
      try { rows = await Promise.all(this.live().map(r => this.describe(r))); }
      catch (err) { body.appendChild(VexSettingsGroups.note('Could not list what is playing: ' + err.message)); return; }
      const top = document.createElement('div');
      top.className = 'vexsr-row';
      top.appendChild(VexSettingsGroups.button('Refresh', () => { draw(); }, { primary: true }));
      body.appendChild(top);
      if (!rows.length) { body.appendChild(VexSettingsGroups.note('Nothing is making sound right now.')); return; }
      const act = (row, label, fn, opts) => VexSettingsGroups.button(label, async () => {
        try { await fn(); } catch (err) { window.showToast?.(err.message, 'error'); }
        setTimeout(() => { if (body.isConnected) draw(); }, 400);
      }, opts);
      for (const row of rows) {
        const line = document.createElement('div');
        line.className = 'vexsr-rule';
        line.style.flexWrap = 'wrap';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = (row.kind === 'panel' ? 'Panel: ' : (row.active ? 'This tab: ' : 'Tab: ')) + row.label + (row.now ? '  -  ' + row.now : '') + (row.muted ? '  (muted)' : '');
        line.appendChild(text);
        line.appendChild(act(row, 'Play / pause', () => this.playPause(row), { label: 'Play or pause ' + row.label }));
        line.appendChild(act(row, 'Next', () => this.next(row), { label: 'Next track in ' + row.label }));
        line.appendChild(act(row, row.muted ? 'Unmute' : 'Mute', () => this.setMuted(row, !row.muted), { label: (row.muted ? 'Unmute ' : 'Mute ') + row.label }));
        line.appendChild(act(row, 'Only this', () => this.onlyThis(row, rows), { label: 'Mute everything except ' + row.label }));
        line.appendChild(act(row, 'Pause the rest', () => this.pauseOthers(row, rows), { label: 'Pause everything except ' + row.label }));
        line.appendChild(act(row, 'Go to', () => this.goTo(row), { label: 'Go to ' + row.label }));
        body.appendChild(line);
      }
    };
    await draw();
    return body;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('One list of every tab and panel that is making sound, with what it is playing, play/pause, next, mute, "only this one" and "pause the rest". Read when you open it; nothing runs in the background.'));
    el.appendChild(VexSettingsGroups.button('Open media control', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexMediaControl = VexMediaControl;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'media-control', title: 'Media control', keywords: 'media sound audio mute pause play noisy tab music panel next track', before: 'about', build: (el) => VexMediaControl.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'media-control', label: 'Media control: what is making sound', hint: 'Every audible tab and panel: play/pause, next, mute, only this one', icon: 'volume', action: () => VexMediaControl.open() });
    VexExtras.registerCommand({ id: 'media-only-this-tab', label: 'Mute everything except this tab', hint: 'Mute every other tab and panel that is making sound', icon: 'mute', action: () => {
      if (!VexMediaControl.enabled()) { window.showToast?.('Media control is switched off in Settings', 'info'); return; }
      const front = typeof TabManager !== 'undefined' ? TabManager.activeTabId : null;
      VexMediaControl.onlyThis({ kind: 'tab', id: front });
    } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMediaControl };
