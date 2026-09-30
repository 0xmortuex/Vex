// === Vex Tor Session — maximum-security private tab over Tor ===
//
// Like an Off-the-Record/private tab, but every request (and DNS lookup) is
// routed through Tor, WebRTC is disabled, all site permissions are denied, and
// the session is in-memory (wiped on close). Vex launches Tor ITSELF — it
// downloads the Tor Expert Bundle on first use and runs tor.exe in the
// background (no Tor Browser required), showing live download + bootstrap
// progress, then opens the Tor tab once Tor is fully connected. If you already
// have Tor Browser (:9150) or a tor service (:9050) running, it uses that
// instead (instant). Opened from the onion button in the top-right toolbar.

const TorSession = {
  // The Tor tab lands on a SEARCH page so you can browse right away — DuckDuckGo
  // (Google over Tor buries you in CAPTCHAs). Verified in the background.
  SEARCH_URL: 'https://duckduckgo.com/',

  _busy: false,

  async open() {
    // Every tab in a private window is in that window's own session, so a
    // "Tor tab" opened there went direct while Vex said "Connected to Tor"
    // (found 2026-09-30: check.torproject.org said IsTor false).
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) {
      window.showToast?.('Open a Tor tab from a normal Vex window — every tab in a private window uses the private window’s own connection', 'error');
      return;
    }
    if (this._busy) return;
    this._busy = true;
    const ui = this._showProgress();
    let unsub = null;
    try { unsub = window.vex?.onTorProgress?.((p) => ui.update(p)); } catch {}

    let r;
    try { r = await window.vex?.createTor?.(); } catch { r = null; }
    if (unsub) { try { unsub(); } catch {} }
    this._busy = false;

    if (ui.cancelled) { ui.close(); return; }        // user backed out mid-launch

    if (r && r.ok && r.partition) {
      ui.finish();                                    // flip bars to 100% / "Connected"
      try {
        TabManager.createTab(this.SEARCH_URL, true, null, { partition: r.partition });
      } catch { ui.close(); window.showToast?.('Could not open Tor tab', 'error'); return; }
      setTimeout(() => ui.close(), 500);
      window.showToast?.(`Tor tab via 127.0.0.1:${r.port} — checking connection…`);
      try {
        const v = await window.vex?.verifyTor?.(r.partition);
        if (v && v.ok && v.isTor) window.showToast?.(`Connected to Tor · exit IP ${v.ip || '?'}`);
        else if (v && v.ok && !v.isTor) window.showToast?.('That proxy works but it isn’t Tor.', 'error');
        else window.showToast?.('Tor’s port is open but traffic didn’t go through yet — give it a moment.', 'error');
      } catch {}
      return;
    }
    ui.close();
    this._guide(r);
  },

  // Humanize Tor's bootstrap stage tags into a short status line.
  _stageText(tag) {
    const map = {
      starting: 'Starting Tor', conn: 'Connecting to a relay', conn_done: 'Connected to a relay',
      handshake: 'Negotiating encryption', handshake_done: 'Encryption established',
      onehop_create: 'Building first circuit', requesting_status: 'Fetching network status',
      loading_status: 'Loading network status', loading_keys: 'Loading authority keys',
      requesting_descriptors: 'Requesting relay list', loading_descriptors: 'Loading relay list',
      enough_dirinfo: 'Have enough of the network', ap_handshake_done: 'Establishing a circuit',
      circuit_create: 'Building a Tor circuit', done: 'Connected to Tor',
    };
    return map[tag] || (tag ? tag.replace(/_/g, ' ') : '');
  },

  _showProgress() {
    document.getElementById('vex-tor-progress')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-tor-progress';
    m.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
    const bar = (id, label) => `
      <div id="${id}-row" style="margin-top:14px;display:none">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text);margin-bottom:6px">
          <span>${label}</span><span id="${id}-pct" style="color:var(--text-muted);font-variant-numeric:tabular-nums">0%</span>
        </div>
        <div style="height:8px;background:rgba(127,127,127,.18);border-radius:5px;overflow:hidden">
          <div id="${id}-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#7c3aed,#a855f7);border-radius:5px;transition:width .25s ease"></div>
        </div>
        <div id="${id}-stage" style="font-size:10.5px;color:var(--text-muted);margin-top:5px;min-height:13px"></div>
      </div>`;
    m.innerHTML = `<div style="width:420px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.55);padding:22px">
        <div style="font-size:16px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px">${VexIcons.svg('onion', { size: 17 })}Connecting to Tor</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-top:6px">Starting Tor in the background — no Tor Browser needed. This can take a few seconds the first time (it downloads Tor once).</div>
        ${bar('tor-dl', 'Downloading Tor')}
        ${bar('tor-bs', 'Connecting to the Tor network')}
        <div style="display:flex;justify-content:flex-end;margin-top:18px">
          <button id="tor-prog-cancel" style="padding:7px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12.5px;font-family:inherit">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const api = {
      cancelled: false,
      close: () => m.remove(),
      update: (p) => {
        if (!p) return;
        const id = p.phase === 'download' ? 'tor-dl' : 'tor-bs';
        const pct = p.phase === 'download' ? Math.round((p.value || 0) * 100) : Math.round(p.value || 0);
        const row = m.querySelector('#' + id + '-row'); if (row) row.style.display = 'block';
        const fill = m.querySelector('#' + id + '-fill'); if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
        const pctEl = m.querySelector('#' + id + '-pct'); if (pctEl) pctEl.textContent = pct + '%';
        if (p.phase === 'bootstrap') { const st = m.querySelector('#tor-bs-stage'); if (st) st.textContent = TorSession._stageText(p.detail); }
      },
      finish: (said = 'Connected — opening your Tor tab…') => {
        ['tor-dl', 'tor-bs'].forEach(id => {
          const row = m.querySelector('#' + id + '-row');
          if (row && row.style.display !== 'none') {
            const f = m.querySelector('#' + id + '-fill'); if (f) f.style.width = '100%';
            const p = m.querySelector('#' + id + '-pct'); if (p) p.textContent = '100%';
          }
        });
        const st = m.querySelector('#tor-bs-stage'); if (st) st.textContent = said;
      },
    };
    // Cancel stops the Tor Vex is launching, not just this dialog: closing it
    // alone left the download and tor.exe running (found 2026-09-29).
    m.querySelector('#tor-prog-cancel').addEventListener('click', () => {
      api.cancelled = true; api.close();
      Promise.resolve(window.vex?.cancelTor?.()).catch(err => window.showToast?.('Tor could not be stopped: ' + err.message, 'error'));
    });
    return api;
  },

  _guide(r) {
    document.getElementById('vex-tor-guide')?.remove();
    const reason = (r && r.reason === 'launch-failed')
      ? `Vex couldn’t start Tor${r.error ? ` (${this._esc(r.error)})` : ''}.`
      : (r && r.reason === 'error')
        ? `Something went wrong starting the Tor session${r.error ? ` (${this._esc(r.error)})` : ''}.`
        : 'Vex couldn’t start Tor.';
    const m = document.createElement('div');
    m.id = 'vex-tor-guide';
    m.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:460px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.55);padding:22px">
      <div style="font-size:16px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;margin-bottom:6px">${VexIcons.svg('onion', { size: 17 })}Tor session</div>
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.55;margin-bottom:14px">
        ${reason}<br><br>
        This usually means the one-time Tor download couldn’t reach the network. Check your connection and click Retry. If you already run <b>Tor Browser</b> (port 9150) or the <b>tor</b> service (9050), Vex will use that instead.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="tor-retry" style="padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12.5px">Retry</button>
        <button id="tor-cancel" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12.5px">Close</button>
      </div></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#tor-cancel').addEventListener('click', close);
    m.querySelector('#tor-retry').addEventListener('click', () => { close(); this.open(); });
  },

  _esc(s) { return window.escapeHtml(s); },

  // "Tor is running" in the top bar, with Stop. Vex's own Tor kept running
  // after the last Tor tab closed, with nothing on screen to say so
  // (found 2026-09-30); main now stops it by itself once nothing uses it,
  // and this shows it while it runs.
  initIndicator() {
    const el = document.getElementById('tor-running');
    if (!el) throw new Error('The Tor indicator is missing from the window');
    el.querySelector('.tor-running-icon').innerHTML = VexIcons.svg('onion', { size: 14 });
    el.querySelector('#tor-running-stop').addEventListener('click', () => {
      this.stop().catch(err => window.showToast?.('Tor could not be stopped: ' + err.message, 'error'));
    });
    window.vex.onTorState((s) => { el.hidden = !(s && s.running); });
    window.vex.torStatus()
      .then((s) => { el.hidden = !(s && s.running); })
      .catch(err => console.error('[tor] could not read whether Tor is running:', err));
    window.vex.onTorReviving(() => this._reviving());
    window.vex.onTorRevived((r) => this._revived(r));
    window.vex.onTorPageDown((p) => WebviewManager.showTorDown(p.id, p.state, p.error));
  },

  // A Tor route (a container, a burner, a site rule) whose Tor had stopped
  // starts it again when one of its pages loads (main, _reviveTor): the same
  // progress as opening a Tor tab, and Cancel stops it the same way.
  _reviveUi: null,
  _reviving() {
    if (this._reviveUi || this._busy) return;   // a Tor tab opening shows the same start already
    const ui = this._showProgress();
    ui.unsub = window.vex.onTorProgress((p) => ui.update(p));
    this._reviveUi = ui;
  },
  _revived(r) {
    const ui = this._reviveUi;
    if (!ui) return;
    this._reviveUi = null;
    ui.unsub();
    if (r && r.ok) { ui.finish('Connected — loading your page…'); setTimeout(() => ui.close(), 500); return; }
    ui.close();
    if (!ui.cancelled && !(r && r.cancelled)) window.showToast?.('Tor could not start: ' + ((r && r.error) || 'no answer from Vex'), 'error');
  },

  // The Tor tabs in this window, asleep ones too (they have no page). Only
  // real Tor tabs: a container, burner or site rule routed through Tor was
  // closed with them (found 2026-09-30); it stays open, and its next page
  // starts Tor again (main, _reviveTor).
  _torTabs() {
    return TabManager.tabs.filter(t => /^tor-/.test(String(t.partition || '')));
  },

  // Main asks every Vex window these when Tor stops (tor:status, tor:stop).
  countTorTabs() { return this._torTabs().length; },
  closeTorTabs() {
    const tabs = this._torTabs();
    tabs.forEach(t => TabManager.closeTab(t.id));
    return tabs.length;
  },

  // What Stop says it will do, counted over every window: it closed the Tor
  // tabs of the window it was clicked in only (found 2026-09-30). The pages
  // going through Tor that are not Tor tabs stay open, and it says so.
  _stopMessage({ tabs, windows, routed }) {
    const where = windows > 1 ? ` in ${windows} windows` : '';
    const closing = tabs === 1 ? 'The Tor tab will close.' : tabs ? `The ${tabs} Tor tabs will close${where}.` : '';
    const others = routed === 1 ? '1 page going through Tor (a container, site rule or burner) stops loading until you use it again.'
      : routed ? `${routed} pages going through Tor (containers, site rules, burners) stop loading until you use them again.` : '';
    return [closing, others].filter(Boolean).join(' ');
  },

  // Stop asks first when Tor pages are open; main closes the Tor tabs in
  // every window, then stops Tor: a Tor tab left open after Tor stops loads
  // nothing.
  async stop() {
    const status = await window.vex.torStatus();
    if (status.tabs || status.routed) {
      const message = this._stopMessage(status);
      const ok = await window.vexConfirm({ title: 'Stop Tor?', message, okLabel: 'Stop Tor', danger: true });
      if (!ok) return false;
    }
    const r = await window.vex.stopTor();
    if (!r || !r.ok) throw new Error((r && r.error) || 'no answer from Vex');
    window.showToast?.('Tor stopped');
    return true;
  },
};

if (typeof window !== 'undefined') window.TorSession = TorSession;
if (typeof document !== 'undefined' && document.getElementById('tor-running')) TorSession.initIndicator();
if (typeof module !== 'undefined' && module.exports) module.exports = { TorSession };
