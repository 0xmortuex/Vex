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
// Deferred: capping the resolution of a background stream. A page's video player can
// only be steered by that site's own code, and nothing here may script third-party
// players during a game; pausing the tab is what the memory guard already does.
const VexNetCourtesy = {
  KEYS: { on: 'vex.netCourtesy.enabled', last: 'vex.netCourtesy.last' },
  FEATURE: 'net-courtesy',
  live: new Map(),            // download id -> { paused }
  run: null,                  // { start, app, paused: Set<id>, tabBytes0 }
  _wired: false,
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, false); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },

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
    let n = 0;
    for (const id of [...this.live.keys()]) if (await this._pause(id)) n++;
    if (n && typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: this.FEATURE, what: 'Paused ' + n + ' download' + VexPlural.s(n) + ' while a game runs', why: 'Network courtesy mode is on; they resume when the game ends', undo: { kind: 'net-courtesy-resume', ids: [...run.paused].slice(0, 20) } });
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
    let last = null;
    try { last = K.read(this.KEYS.last, null); } catch (err) { body.appendChild(K.info(err.message)); }
    if (last && last.text) body.appendChild(K.info('Last game: ' + last.text));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    this._track();
    document.addEventListener('vex:game-mode', (e) => {
      const d = e.detail || {};
      (d.active ? this.begin(d.app) : this.end()).catch((err) => VexMediaKit.problem('Network courtesy', 'Could not follow the game', err));
    });
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('net-courtesy-resume', async (token) => {
        const r = await this._resumeAll(Array.isArray(token.ids) ? token.ids : []);
        if (r.failed) throw new Error(r.failed + ' download' + VexPlural.s(r.failed) + ' could not be resumed');
      });
    }
    VexMediaKit.register({ id: 'net-courtesy', title: 'Network courtesy mode', keywords: 'game network downloads pause bandwidth megabytes', render: (b) => this.render(b) });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexNetCourtesy = VexNetCourtesy;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNetCourtesy };
