// === Network courtesy mode (T3-035) ==========================================
//
// A game's network needs are small and steady and a download is neither. While a game
// runs this holds Vex's own background network use back and tells you afterwards what
// Vex used:
//
//   downloads   the ones in progress are paused when the game starts, and a download
//               that starts during the game is paused too; when the game ends exactly
//               those are resumed (a download you paused yourself is left alone)
//   watches     page watches, RSS, live-channel checks, news, sync and the status
//               check are VexJobs, and VexJobs already holds every job while a game
//               runs (js/jobs.js heldBecause), so there is nothing more to hold; this
//               says so in Settings instead of pretending to do it twice
//   count       "Vex used 14 MB during this game": Vex's own requests (the egress
//               ledger, main/egress-ledger.js) and what its tabs moved (tab-cost)
//
// Everything is Vex's own. There is no firewall rule, no QoS policy, no change to
// Windows or to the game's connection, and nothing about the game is read: only that
// Game mode (which knows by process name) says one started and ended.
//
// Background video quality cap (Wave 6, the owner approved it; a second OFF-by-default switch):
//   A tab that is not in front and plays a video on a site with a quality API is asked, by that site's
//   OWN player API, to stay at a low quality, and is put back to automatic quality the moment it comes to the front,
//   when the game ends, when the switch goes off, or on the ledger's Undo. Sites handled today (the list in
//   VexNetCourtesy.VIDEO_SITES, shown in Settings): YouTube (www.youtube.com, m.youtube.com, youtube.com).
//   It runs one short script in that page only; it reads whether the player is playing, and changes nothing else.
//   It never touches a site that is not on the list, nor a paused video, nor a tab that was not in the background
//   for 30 seconds. While a game runs the tabs are capped at once, the one in front included (Vex is behind the game).
//   Limits, said plainly: the player's quality range call is the site's own and may change; restoring returns to
//   AUTOMATIC quality, so a quality you picked by hand on that video is not remembered; an ad or a stream that
//   ignores the call is not changed. This part has been written against the documented player methods and has
//   NOT been run against a live page.
const VexNetCourtesy = {
  KEYS: { on: 'vex.netCourtesy.enabled', last: 'vex.netCourtesy.last', cap: 'vex.netCourtesy.videoCap' },
  CAP_DELAY_MS: 30000,
  // The sites whose player has a quality call Vex may use. cap/restore run in the page and return { ok, reason? }.
  VIDEO_SITES: [{
    id: 'youtube', name: 'YouTube',
    match: (u) => u.protocol === 'https:' && /^(?:www\.|m\.)?youtube\.com$/i.test(u.hostname) && /^\/(?:watch|shorts|live)\b/.test(u.pathname),
    cap: "(function(){var p=document.getElementById('movie_player');if(!p||typeof p.setPlaybackQualityRange!=='function')return{ok:false,reason:'no-player'};if(!p.getPlayerState||p.getPlayerState()!==1)return{ok:false,reason:'not-playing'};window.__vexVideoCap={prior:p.getPlaybackQuality?p.getPlaybackQuality():''};p.setPlaybackQualityRange('tiny','small');return{ok:true};})()",
    restore: "(function(){if(!window.__vexVideoCap)return{ok:false,reason:'not-capped'};var p=document.getElementById('movie_player');delete window.__vexVideoCap;if(!p||typeof p.setPlaybackQualityRange!=='function')return{ok:false,reason:'no-player'};p.setPlaybackQualityRange('tiny','highres');return{ok:true};})()",
  }],
  capped: new Map(),          // tab id -> site id
  _capTimers: new Map(),      // tab id -> timer
  _capWired: false,
  FEATURE: 'net-courtesy',
  live: new Map(),            // download id -> { paused }
  run: null,                  // { start, app, paused: Set<id>, tabBytes0 }
  _wired: false,
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, false); },
  setEnabled(on) {
    VexMediaKit.setFlag(this.KEYS.on, !!on);
    if (!on) this.restoreAllCapped().catch((err) => VexMediaKit.problem('Network courtesy', 'Could not put the video quality back', err));
  },

  // ---- background video quality cap -------------------------------------------------------------------
  capEnabled() { return this.enabled() && VexMediaKit.flag(this.KEYS.cap, false); },
  setCapEnabled(on) {
    VexMediaKit.setFlag(this.KEYS.cap, !!on);
    if (!on) this.restoreAllCapped().catch((err) => VexMediaKit.problem('Network courtesy', 'Could not put the video quality back', err));
  },
  siteFor(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return null; }   // vex-allow-empty-catch: an address that is not a URL (a blank tab) is simply not a handled site
    return this.VIDEO_SITES.find((s) => s.match(u)) || null;
  },
  _webview(tabId) {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) throw new Error('Tabs are not available');
    const wv = WebviewManager.webviews.get(tabId);
    return wv && wv.isConnected && typeof wv.executeJavaScript === 'function' ? wv : null;
  },
  _tab(tabId) { return typeof TabManager !== 'undefined' ? TabManager.tabs.find((t) => t.id === tabId) : null; },
  // Ask one tab's player to stay low. -> true when it was changed.
  async capTab(tabId) {
    if (!this.capEnabled() || this.capped.has(tabId)) return false;
    const tab = this._tab(tabId);
    const site = tab ? this.siteFor(tab.url) : null;
    const wv = site ? this._webview(tabId) : null;
    if (!site || !wv) return false;
    const r = await wv.executeJavaScript(site.cap);
    if (!r || !r.ok) return false;                           // nothing playing, or no player: nothing was changed
    this.capped.set(tabId, site.id);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: this.FEATURE, what: 'Lowered the video quality of a background ' + site.name + ' tab', why: 'Network courtesy: the background video cap is on; it goes back to automatic when the tab is in front', undo: { kind: 'video-cap-restore', tabIds: [tabId] } });
    }
    return true;
  },
  async restoreTab(tabId) {
    const id = this.capped.get(tabId);
    if (!id) return false;
    this.capped.delete(tabId);
    const site = this.VIDEO_SITES.find((s) => s.id === id);
    const wv = this._webview(tabId);
    if (!site || !wv) return false;                          // the tab is gone or asleep: its page is new when it wakes
    const r = await wv.executeJavaScript(site.restore);
    return !!(r && r.ok);
  },
  async restoreAllCapped() {
    for (const t of this._capTimers.values()) clearTimeout(t);
    this._capTimers.clear();
    let n = 0;
    for (const id of [...this.capped.keys()]) if (await this.restoreTab(id)) n++;
    return n;
  },
  // Cap the tabs that are not in front (all of them while a game runs). -> how many were changed.
  async capBackground({ includeActive = false } = {}) {
    if (!this.capEnabled() || typeof TabManager === 'undefined') return 0;
    let n = 0;
    for (const t of TabManager.tabs) {
      if (!includeActive && t.id === TabManager.activeTabId) continue;
      if (await this.capTab(t.id)) n++;
    }
    return n;
  },
  // A tab came to the front: it is restored at once; every other handled tab is capped after a while in the background.
  _onActivated(tabId) {
    this._clearTimer(tabId);
    this.restoreTab(tabId).catch((err) => VexMediaKit.problem('Network courtesy', 'Could not put the video quality back', err));
    if (!this.capEnabled() || typeof TabManager === 'undefined') return;
    for (const t of TabManager.tabs) {
      if (t.id === tabId || this.capped.has(t.id) || this._capTimers.has(t.id) || !this.siteFor(t.url)) continue;
      this._capTimers.set(t.id, setTimeout(() => {
        this._capTimers.delete(t.id);
        if (TabManager.activeTabId === t.id) return;
        this.capTab(t.id).catch((err) => VexMediaKit.problem('Network courtesy', 'Could not lower the video quality', err));
      }, this.CAP_DELAY_MS));
    }
  },
  _clearTimer(tabId) { const t = this._capTimers.get(tabId); if (t) { clearTimeout(t); this._capTimers.delete(tabId); } },
  _wireCap() {
    if (this._capWired) return;
    this._capWired = true;
    window.addEventListener('vex:tab-activated', (e) => { if (e.detail && e.detail.tabId != null) this._onActivated(e.detail.tabId); });
    document.addEventListener('vex:tab-closed', (e) => { const id = e.detail && e.detail.tabId; this._clearTimer(id); this.capped.delete(id); });
  },

  // ---- pure ------------------------------------------------------------------------------
  mb(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024 * 1024) return Math.max(0.1, Math.round(n / 102.4) / 10).toFixed(1) + ' MB';
    return (Math.round(n / 104857.6) / 10).toFixed(1) + ' MB';
  },
  summary({ app, ownBytes, tabBytes, paused, resumed, failed }) {
    const total = (Number(ownBytes) || 0) + (Number(tabBytes) || 0);
    const parts = ['Vex used ' + this.mb(total) + ' of network during ' + (app || 'the game') + ' (' + this.mb(ownBytes) + ' its own requests, ' + this.mb(tabBytes) + ' in tabs)'];
    if (paused) parts.push(paused + ' download' + (paused === 1 ? ' was' : 's were') + ' paused and ' + (resumed === paused ? 'resumed' : resumed + ' resumed'));
    if (failed) parts.push(failed + ' could not be resumed, open Downloads');
    return parts.join('. ') + '.';
  },

  // ---- downloads ---------------------------------------------------------------------------
  _api() {
    const v = window.vex;
    if (!v || typeof v.downloadsControl !== 'function') throw new Error('Downloads cannot be paused in this window');
    return v;
  },
  _track() {
    const v = window.vex;
    if (!v || typeof v.onDownloadStarted !== 'function') return;
    v.onDownloadStarted((d) => {
      if (!d || typeof d.id !== 'string') return;
      this.live.set(d.id, { paused: false });
      if (this.run && this.enabled()) this._pause(d.id).catch((err) => VexMediaKit.problem('Network courtesy', 'Could not hold a download', err));
    });
    if (typeof v.onDownloadProgress !== 'function' || typeof v.onDownloadComplete !== 'function') throw new Error('Download events are not available in this window');
    v.onDownloadProgress((d) => {
      if (!d || typeof d.id !== 'string') return;
      const e = this.live.get(d.id) || { paused: false };
      e.paused = !!d.paused;
      this.live.set(d.id, e);
    });
    v.onDownloadComplete((d) => { if (d && typeof d.id === 'string') { this.live.delete(d.id); if (this.run) this.run.paused.delete(d.id); } });
  },
  async _pause(id) {
    const e = this.live.get(id);
    if (!e || e.paused || !this.run) return false;      // already paused by the person: not ours to resume
    const r = await this._api().downloadsControl(id, 'pause');
    if (!r || !r.ok) return false;                         // finished meanwhile
    e.paused = true;
    this.run.paused.add(id);
    return true;
  },
  async _resumeAll(ids) {
    let resumed = 0, failed = 0;
    for (const id of ids) {
      const r = await this._api().downloadsControl(id, 'resume');
      if (r && r.ok) resumed++;
      else if (r && /finished/.test(String(r.error || ''))) continue;      // done meanwhile: nothing to resume
      else failed++;
    }
    return { resumed, failed };
  },

  // ---- the game --------------------------------------------------------------------------------
  async begin(app) {
    if (!this.enabled() || this.run) return null;
    const run = { start: this._now(), app: String(app || '').replace(/\.exe$/i, ''), paused: new Set(), tabBytes0: 0 };
    this.run = run;
    run.tabBytes0 = await this._tabBytes();
    if (this.capEnabled()) this.capBackground({ includeActive: true }).catch((err) => VexMediaKit.problem('Network courtesy', 'Could not lower the video quality', err));
    let n = 0;
    for (const id of [...this.live.keys()]) if (await this._pause(id)) n++;
    if (n && typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: this.FEATURE, what: 'Paused ' + n + ' download' + (n === 1 ? '' : 's') + ' while a game runs', why: 'Network courtesy mode is on; they resume when the game ends', undo: { kind: 'net-courtesy-resume', ids: [...run.paused].slice(0, 20) } });
    }
    return n;
  },
  async _tabBytes() {
    if (typeof TabCost === 'undefined') return 0;
    await TabCost.sample();
    return TabCost.snapshot({ scope: 'session' }).totals.netBytes || 0;
  },
  async end() {
    const run = this.run;
    if (!run) return null;
    this.run = null;
    // The videos go back to automatic quality before anything else; a failure is reported, not allowed to hide the summary.
    await this.restoreAllCapped().catch((err) => VexMediaKit.problem('Network courtesy', 'Could not put the video quality back', err));
    const paused = [...run.paused];
    const { resumed, failed } = await this._resumeAll(paused);
    for (const id of paused) { const e = this.live.get(id); if (e) e.paused = false; }
    const elapsed = Math.max(1000, this._now() - run.start);
    if (!window.vex || typeof window.vex.egressSummary !== 'function') throw new Error('The network ledger is not available in this window');
    const eg = await window.vex.egressSummary(elapsed);
    const ownBytes = (eg && (Number(eg.bytesOut) + Number(eg.bytesIn))) || 0;
    const tabBytes = Math.max(0, (await this._tabBytes()) - run.tabBytes0);
    const text = this.summary({ app: run.app, ownBytes, tabBytes, paused: paused.length, resumed, failed });
    VexMediaKit.write(this.KEYS.last, { at: this._now(), text });
    const show = () => VexMediaKit.toast(text, 'info', 12000);
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: this.FEATURE, urgency: 'useful', id: 'end' + run.start, title: text }, show);
    else show();
    return text;
  },

  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('While a game runs: downloads in progress are paused and resumed when it ends, and Vex tells you how much network it used. Page watches, feeds, news, sync and the status check already wait during a game. No firewall or Windows network setting is changed.'));
    body.appendChild(K.switchRow('Network courtesy mode', this.enabled(), (on) => this.setEnabled(on)));
    body.appendChild(K.info('Optional: keep the video of a tab that is not in front at a low quality (' + this.VIDEO_SITES.map((s) => s.name).join(', ') + ' only, and only a video that is playing). It goes back to automatic quality when you open the tab, when a game ends or when you switch this off. While a game runs, every such tab is lowered at once. Needs Network courtesy mode.'));
    body.appendChild(K.switchRow('Lower the quality of background videos', VexMediaKit.flag(this.KEYS.cap, false), (on) => this.setCapEnabled(on)));
    let last = null;
    try { last = K.read(this.KEYS.last, null); } catch (err) { body.appendChild(K.info(err.message)); }
    if (last && last.text) body.appendChild(K.info('Last game: ' + last.text));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    this._track();
    this._wireCap();
    document.addEventListener('vex:game-mode', (e) => {
      const d = e.detail || {};
      (d.active ? this.begin(d.app) : this.end()).catch((err) => VexMediaKit.problem('Network courtesy', 'Could not follow the game', err));
    });
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('video-cap-restore', async (token) => {
        for (const id of Array.isArray(token.tabIds) ? token.tabIds : []) await this.restoreTab(id);
      });
      VexLedger.registerUndo('net-courtesy-resume', async (token) => {
        const r = await this._resumeAll(Array.isArray(token.ids) ? token.ids : []);
        if (r.failed) throw new Error(r.failed + ' download' + (r.failed === 1 ? '' : 's') + ' could not be resumed');
      });
    }
    VexMediaKit.register({ id: 'net-courtesy', title: 'Network courtesy mode', keywords: 'game network downloads pause bandwidth megabytes', render: (b) => this.render(b) });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexNetCourtesy = VexNetCourtesy;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNetCourtesy };
