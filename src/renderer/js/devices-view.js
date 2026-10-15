// === Devices: one browser across your devices ================================
//
// Lists every device on the Vex Sync account with its open tabs. A tab opens
// here with one click, or is sent to one device (an addressed handoff,
// js/handoff.js), and "Continue where I left off" offers the tabs of the
// device you used last while this one sat idle. Reads the last document this
// device synced (SyncEngine.devicesView); nothing is fetched to draw it.
// The pure parts (clock, redaction, ordering) are js/live-session.js.
const DevicesView = {
  OFFER_KEY: 'vex.devicesOffered',
  RELAY_KEY: 'vex.companionRelayUrl',
  _overlay: null,

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  _icon(name, size = 15) { return typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : ''; },

  ready() { return typeof SyncEngine !== 'undefined' && SyncEngine.isEnabled && SyncEngine.isEnabled() && typeof SyncEngine.devicesView === 'function'; },
  liveOn() { try { return SyncEngine.syncTypes().some(t => t.id === 'liveTabs' && t.on); } catch { return false; } },

  view() { return this.ready() ? SyncEngine.devicesView() : []; },

  // Own last use: the newest tab activity this device has.
  selfLastActive() {
    const own = this.view().find(d => d.self);
    if (own && own.lastActive) return own.lastActive;
    const tabs = typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs) ? TabManager.tabs : [];
    return tabs.reduce((m, t) => Math.max(m, Number.isFinite(t.lastViewedAt) ? t.lastViewedAt : 0), 0);
  },

  continueOffer(now = Date.now()) {
    const live = window.VexLiveSession;
    if (!live) return null;
    return live.continueWhereLeftOff(this.view(), { now, selfLastActive: this.selfLastActive() });
  },

  _ago(ms, now = Date.now()) {
    if (!ms) return 'never';
    const s = Math.max(0, (now - ms) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  },

  openHere(url) {
    if (!/^https?:\/\//i.test(String(url))) return false;
    if (typeof TabManager === 'undefined') return false;
    TabManager.createTab(url, true);
    return true;
  },

  async sendTo(deviceId, tab) {
    try {
      await Handoff.send({ url: tab.url, title: tab.title, partition: '' }, deviceId);
      window.showToast?.('Sent', 'success');
    } catch (err) {
      window.showToast?.(Handoff._human ? Handoff._human(err) : String((err && err.message) || err), 'error');
    }
  },

  async openAll(offer) {
    const tabs = offer.tabs.slice(0, 20);
    if (tabs.length > 8 && typeof vexConfirm === 'function') {
      const yes = await vexConfirm({ title: 'Open ' + tabs.length + ' tabs here', message: 'Open the tabs from ' + offer.device.name + ' on this device?', okLabel: 'Open them' });
      if (!yes) return 0;
    }
    let n = 0;
    for (const t of tabs) if (this.openHere(t.url)) n++;
    return n;
  },

  close() {
    if (this._overlay) { this._overlay.remove(); this._overlay = null; }
    document.removeEventListener('keydown', this._onKey, true);
  },

  render() {
    const e = s => this._esc(s);
    const view = this.view();
    const now = Date.now();
    const offer = this.continueOffer(now);
    const liveOff = !this.liveOn();
    const targets = view.filter(d => !d.self);
    const banner = offer ? `<div class="dv-continue" role="status">
        <div class="dv-continue-text">${this._icon('arrow-right', 15)}<span><strong>Continue where you left off</strong> on ${e(offer.device.name)}: ${offer.tabs.length} tab${offer.tabs.length === 1 ? '' : 's'}, used ${e(this._ago(offer.device.lastActive, now))}</span></div>
        <button type="button" class="dv-btn dv-primary" data-act="continue">Open here</button></div>` : '';
    const note = liveOff ? `<p class="dv-note">${this._icon('shield', 14)}<span>Live tabs is off, so other devices see only addresses and titles. Turn it on in Settings › Vex Sync › Choose what to sync to also share each tab's icon, group, pinned state and when you last used it. Private, Tor and routed tabs and sensitive sites are never shared.</span></p>` : '';
    const devices = view.length ? view.map(d => {
      const tabs = d.tabs.length ? d.tabs.map((t, i) => `<li class="dv-tab" data-device="${e(d.deviceId)}" data-tab="${i}">
          <button type="button" class="dv-open" data-act="open" title="${d.self ? 'Switch to this tab' : 'Open here'}">
            ${t.favicon ? `<img class="dv-fav" src="${e(t.favicon)}" alt="" width="14" height="14" referrerpolicy="no-referrer">` : this._icon('globe', 14)}
            <span class="dv-tab-title">${e(t.title)}</span>${t.pinned ? `<span class="dv-pin" title="Pinned">${this._icon('pin', 11)}</span>` : ''}${t.group ? `<span class="dv-group">${e(t.group)}</span>` : ''}
          </button>
          <span class="dv-send">${targets.filter(x => x.deviceId !== d.deviceId).slice(0, 4).map(x => `<button type="button" class="dv-btn dv-mini" data-act="send" data-to="${e(x.deviceId)}" title="Send to ${e(x.name)}" aria-label="Send to ${e(x.name)}">${this._icon(x.kind === 'phone' ? 'phone' : 'monitor', 12)}${this._icon('send', 11)}</button>`).join('')}</span>
        </li>`).join('') : `<li class="dv-empty">No tabs shared${d.self ? '' : ' by this device yet'}.</li>`;
      return `<section class="dv-device${d.self ? ' dv-self' : ''}${d.stale ? ' dv-stale' : ''}" aria-label="${e(d.name)}">
        <header class="dv-device-head">${this._icon(d.kind === 'phone' ? 'phone' : 'monitor', 16)}
          <span class="dv-device-name">${e(d.name)}${d.self ? ' <span class="dv-tag">this device</span>' : ''}</span>
          <span class="dv-device-seen">${d.self ? 'active now' : 'seen ' + e(this._ago(d.lastSeen, now))}</span></header>
        <ul class="dv-tabs">${tabs}</ul>
        ${d.cut ? `<div class="dv-more">and ${d.cut} more not shown</div>` : ''}
      </section>`;
    }).join('') : `<p class="dv-empty">${this.ready() ? 'No devices yet. Sign in to Vex Sync on another device.' : 'Sign in to Vex Sync (Settings › Vex Sync) to see your devices here.'}</p>`;
    return `<div class="dv-card" role="dialog" aria-modal="true" aria-label="Devices">
        <header class="dv-head">${this._icon('monitor', 17)}<h2 class="dv-title">Devices</h2>
          <button type="button" class="dv-close" data-act="close" aria-label="Close" title="Close">${this._icon('x', 15)}</button></header>
        ${banner}${note}<div class="dv-list">${devices}</div></div>`;
  },

  async open() {
    this.close();
    // The device list as the server has it now (a removed device goes, a new
    // one appears); the view still draws from the last synced document if the
    // server cannot be asked.
    if (this.ready() && typeof SyncEngine.listDevices === 'function') {
      try { await SyncEngine.listDevices(); }
      catch (err) { console.error('[Devices] could not refresh the device list:', err && err.message); }
    }
    const overlay = document.createElement('div');
    overlay.className = 'dv-overlay';
    overlay.innerHTML = this.render();
    document.body.appendChild(overlay);
    this._overlay = overlay;
    this._onKey = ev => { if (ev.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { ev.preventDefault(); ev.stopPropagation(); this.close(); } };
    document.addEventListener('keydown', this._onKey, true);
    overlay.addEventListener('mousedown', ev => { if (ev.target === overlay) this.close(); });
    overlay.addEventListener('click', async ev => {
      const el = ev.target.closest('[data-act]');
      if (!el || !overlay.contains(el)) return;
      const act = el.dataset.act;
      if (act === 'close') return this.close();
      if (act === 'continue') {
        const offer = this.continueOffer();
        if (offer && await this.openAll(offer)) this.close();
        return;
      }
      const row = el.closest('.dv-tab');
      if (!row) return;
      const device = this.view().find(d => d.deviceId === row.dataset.device);
      const tab = device && device.tabs[Number(row.dataset.tab)];
      if (!tab) return;
      if (act === 'open') { if (this.openHere(tab.url)) this.close(); }
      else if (act === 'send') await this.sendTo(el.dataset.to, tab);
    });
    const first = overlay.querySelector('.dv-close');
    if (first) first.focus();
    return overlay;
  },

  // "Continue where I left off", offered once per use of the other device, a
  // while after this one has been idle (a toast; the Devices view has the tabs).
  maybeOffer(now = Date.now()) {
    if (!this.ready() || !this.liveOn()) return null;
    const offer = this.continueOffer(now);
    if (!offer) return null;
    let seen = 0;
    try { seen = Number(localStorage.getItem(this.OFFER_KEY)) || 0; } catch { seen = 0; }
    if (seen >= offer.device.lastActive) return null;
    try { localStorage.setItem(this.OFFER_KEY, String(offer.device.lastActive)); } catch { /* an offer made twice is harmless */ }
    window.showToast?.('Continue where you left off on ' + offer.device.name + ' (' + offer.tabs.length + ' tab' + (offer.tabs.length === 1 ? '' : 's') + '): Ctrl+K › Devices', 'info', 12000);
    return offer;
  },

  // ---- Phone browser (companion/) ----------------------------------------------
  relayUrl() { try { return (localStorage.getItem(this.RELAY_KEY) || '').trim(); } catch { return ''; } },

  // The Devices view as the companion page shows it (src/main/companion.js
  // re-checks every address).
  companionView() {
    let queue = [];
    try { const q = JSON.parse(localStorage.getItem('vex.readLater') || '[]'); if (Array.isArray(q)) queue = q.filter(i => i && !i.read && !i.ownSession); } catch { queue = []; }
    return { devices: this.view(), readingQueue: queue.map(i => ({ url: i.url, title: i.title })) };
  },

  async pair() {
    if (!window.vex || typeof window.vex.companionStart !== 'function') { window.showToast?.('The phone browser is not available in this window', 'error'); return null; }
    if (!this.ready()) { window.showToast?.('Sign in to Vex Sync first', 'warn'); return null; }
    let relayUrl = this.relayUrl();
    if (!relayUrl && typeof vexPrompt === 'function') {
      relayUrl = String(await vexPrompt({ title: 'Companion relay', message: 'The address of the relay you deployed (workers/companion). Nothing is sent until you confirm.', placeholder: 'https://vex-companion.example.workers.dev', okLabel: 'Use this relay' }) || '').trim();
      if (!relayUrl) return null;
    }
    try {
      const res = await window.vex.companionStart({ relayUrl, view: this.companionView() });
      try { localStorage.setItem(this.RELAY_KEY, relayUrl); } catch { /* asked again next time */ }
      if (typeof vexConfirm === 'function') {
        await vexConfirm({ title: 'Pair a phone browser', message: 'On the phone open the companion page and enter this code within 5 minutes:\n\n' + res.code + '\n\nRelay: ' + res.relay + '\n\nThe phone sees your devices and their tabs, read only, until you stop it in Settings › Vex Sync.', okLabel: 'Done', cancelLabel: 'Stop pairing' })
          || await window.vex.companionStop();
      }
      return res;
    } catch (err) {
      window.showToast?.(String((err && err.message) || err), 'error');
      return null;
    }
  },

  async stopPairing() {
    if (!window.vex || typeof window.vex.companionStop !== 'function') return;
    try { await window.vex.companionStop(); window.showToast?.('The phone browser was disconnected', 'success'); }
    catch (err) { window.showToast?.(String((err && err.message) || err), 'error'); }
  },

  // Keeps a paired phone's snapshot current after each sync round.
  _watch() {
    let timer = null;
    window.addEventListener('vex-sync-data-applied', () => {
      if (!window.vex || typeof window.vex.companionStatus !== 'function') return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const s = await window.vex.companionStatus();
          if (s && s.paired) await window.vex.companionPublish(this.companionView());
        } catch (err) { console.error('[Devices] could not refresh the phone browser:', err && err.message); }
      }, 3000);
    });
  },

  init() {
    this._watch();
    // Back at the keyboard after a while away: offer where you left off.
    window.addEventListener('focus', () => { try { this.maybeOffer(); } catch (err) { console.error('[Devices]', err && err.message); } });
  },
};

if (typeof window !== 'undefined') window.DevicesView = DevicesView;
if (typeof module !== 'undefined' && module.exports) module.exports = { DevicesView };
