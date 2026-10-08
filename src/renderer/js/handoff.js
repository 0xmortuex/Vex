// === Send to your devices (Vex Sync handoff) ===
//
// The one place tabs move between your devices. It sends through the Vex Sync
// mailbox (docs/SYNC_PROTOCOL.md §7, SyncEngine.dropSend/dropFetch) and is
// opened from the tab menu, the address bar's send button and Ctrl+K › Send
// to My Devices.
//
// What the protocol allows, and so what this does:
// - A handoff is {url, title}, encrypted with the account key. It has no
//   address: whichever of your other devices checks the mailbox first gets
//   it. The menu therefore lists the devices it can reach and has one Send
//   button; it does not pretend to send to one of them.
// - Fetching consumes the items on the server, so tabs sent here are kept on
//   this computer (INBOX_KEY) until you open or dismiss them. They show as
//   cards on the New Tab page and once as a desktop notification.
// - Only web pages from normal tabs are sent: never a private, Off-the-Record
//   or Tor tab, never a private window, never Vex's own pages.
// - The protocol carries no list of a phone's open tabs (storage:tabs is the
//   desktops' shared tab set, which a phone must not write, §6 rule 19), so
//   there is no "Continue from phone" list.
const Handoff = {
  INBOX_KEY: 'vex.handoffInbox',
  MAX_INBOX: 20,          // the server keeps the newest 20 too (§7)
  _seen: new Set(),       // server ids already taken in this session

  // ---- What may be sent ---------------------------------------------------
  // { ok: true } or { ok: false, why }. Callers show the option only when ok.
  sendable(tab) {
    if (!tab || typeof tab.url !== 'string' || !tab.url) return { ok: false, why: 'No page to send' };
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return { ok: false, why: 'Tabs in a private window are never sent' };
    const p = tab.partition ? String(tab.partition) : '';
    if (p && !p.startsWith('persist:')) return { ok: false, why: /^tor-/.test(p) ? 'Tor tabs are never sent' : 'Private tabs are never sent' };
    if (typeof isStartPage === 'function' && isStartPage(tab.url)) return { ok: false, why: 'Vex\'s own pages are not sent' };
    let u;
    try { u = new URL(tab.url); } catch { return { ok: false, why: 'This page has no web address' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, why: 'Only web pages can be sent' };
    return { ok: true };
  },

  // Signed in to Vex Sync with a server set.
  ready() {
    if (typeof SyncEngine === 'undefined' || !SyncEngine.isEnabled || !SyncEngine.isEnabled()) return false;
    return !!(window.VexConfig && window.VexConfig.syncWorkerUrl());
  },

  // A device name as the server stores it says nothing else about the device.
  // The icon is a guess from the name, for looks only.
  looksLikePhone(name) {
    return /\b(iphone|ipad|android|pixel|galaxy|phone|mobile|tablet|oneplus|xiaomi|redmi|huawei|nokia|motorola|moto)\b/i.test(String(name || ''));
  },

  // ---- Inbox: tabs sent to this computer ---------------------------------
  _validItem(i) {
    return !!i && typeof i === 'object' && typeof i.id === 'string' && i.id.length > 0 && i.id.length <= 64
      && typeof i.url === 'string' && /^https?:\/\//i.test(i.url) && i.url.length <= 2048
      && typeof i.title === 'string' && typeof i.from === 'string';
  },

  // Throws when the stored list cannot be read: an unreadable inbox is not an
  // empty one.
  inbox() {
    const raw = localStorage.getItem(this.INBOX_KEY);
    if (!raw) return [];
    let list;
    try { list = JSON.parse(raw); } catch { throw new Error('The tabs sent to this computer could not be read'); }
    if (!Array.isArray(list)) throw new Error('The tabs sent to this computer could not be read');
    return list.filter(i => this._validItem(i));
  },

  _save(list) {
    localStorage.setItem(this.INBOX_KEY, JSON.stringify(list.slice(-this.MAX_INBOX)));
  },

  // Items fetched from the mailbox (SyncEngine.dropFetch shape) → the ones
  // that are new. Kept before anything is shown: the server has already let
  // go of them.
  add(items, now = Date.now()) {
    const list = this.inbox();
    const have = new Set(list.map(i => i.id));
    const fresh = [];
    for (const it of items || []) {
      if (!it || typeof it.url !== 'string' || !/^https?:\/\//i.test(it.url)) continue;
      const id = 'h' + String(it.id || now.toString(36) + Math.random().toString(36).slice(2, 7)).replace(/[^\w-]/g, '').slice(0, 40);
      if (have.has(id) || this._seen.has(id)) continue;
      const entry = {
        id,
        url: it.url.slice(0, 2048),
        title: String(it.title || '').slice(0, 300),
        from: String(it.fromDeviceName || 'another device').slice(0, 120),
        at: typeof it.at === 'string' ? it.at : new Date(now).toISOString(),
        receivedAt: now,
      };
      have.add(id); this._seen.add(id);
      list.push(entry); fresh.push(entry);
    }
    if (fresh.length) this._save(list);
    return fresh;
  },

  take(id) {
    const list = this.inbox();
    const hit = list.find(i => i.id === id);
    if (!hit) return null;
    this._save(list.filter(i => i.id !== id));
    return hit;
  },

  // ---- Receiving -----------------------------------------------------------
  _busy: false,
  _lastError: '',
  async receive() {
    if (this._busy) return [];
    // A private window's renderer does not take tabs: they would land in a
    // window whose pages are forgotten.
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return [];
    if (!this.ready()) return [];
    this._busy = true;
    let fresh = [];
    try {
      const items = await SyncEngine.dropFetch();
      if (!items.length) { this._lastError = ''; return []; }
      fresh = this.add(items);
      this._lastError = '';
    } catch (err) {
      const msg = (err && err.message) || String(err);
      // Said once per kind of failure, not every two minutes.
      if (msg !== this._lastError) {
        this._lastError = msg;
        console.error('[Handoff] could not check for tabs sent from your devices:', msg);
        window.VexProblems?.note?.('Send to your devices', 'Could not check for tabs sent from your other devices', err);
      }
      return [];
    } finally { this._busy = false; }
    if (fresh.length) {
      this.pushAll();
      this.notify(fresh);
    }
    return fresh;
  },

  // One desktop notification per check, through the main process. Held while
  // a full-screen game runs (Settings › When a game is running): the cards
  // stay on the New Tab page for when you come back.
  notify(fresh) {
    if (!fresh.length) return null;
    if (typeof GameMode !== 'undefined' && GameMode.gaming) return null;
    if (!window.vex || typeof window.vex.notify !== 'function') return null;
    const one = fresh.length === 1 ? fresh[0] : null;
    const froms = [...new Set(fresh.map(i => i.from))];
    const title = one ? 'From ' + one.from : fresh.length + ' tabs from ' + (froms.length === 1 ? froms[0] : 'your devices');
    const body = (one ? (one.title || one.url) : fresh.map(i => i.title || i.url).slice(0, 3).join(' · ')) + ' — on your New Tab page';
    return Promise.resolve(window.vex.notify(title.slice(0, 200), body.slice(0, 2000)))
      .catch(err => window.VexProblems?.note?.('Send to your devices', 'Could not show the desktop notification', err));
  },

  // ---- The New Tab page ---------------------------------------------------
  // The start page runs in its own session and cannot read this renderer's
  // storage, so the list is handed to it, as js/today.js does.
  _cards() {
    try { return this.inbox().map(i => ({ id: i.id, url: i.url, title: i.title, from: i.from, at: i.at, phone: this.looksLikePhone(i.from) })); }
    catch (err) { console.error('[Handoff]', err.message); return []; }
  },

  push(webview) {
    if (!webview || typeof webview.executeJavaScript !== 'function') return false;
    let url = '';
    try { url = webview.getURL(); } catch { return false; }
    if (!/\/renderer\/start\.html(?:[?#]|$)/i.test(String(url || ''))) return false;
    // A private window's New Tab shows none of them.
    const cards = (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) ? [] : this._cards();
    const code = `(() => { window.__vexHandoff = ${JSON.stringify(cards)}; window.dispatchEvent(new Event('vex-handoff')); return true; })()`;
    webview.executeJavaScript(code).catch(err => console.error('[Handoff] could not hand the list to the New Tab page:', err && err.message));
    return true;
  },

  pushAll() {
    const wm = (typeof WebviewManager !== 'undefined') ? WebviewManager : null;
    if (!wm || !wm.webviews || typeof wm.webviews.values !== 'function') return 0;
    let n = 0;
    for (const wv of wm.webviews.values()) { try { if (this.push(wv)) n++; } catch (err) { console.error('[Handoff] push failed:', err && err.message); } }
    return n;
  },

  // VEX_CMD from the start page (webview.js): open or dismiss a card.
  onStartCommand(cmd, webview) {
    if (!cmd || typeof cmd.id !== 'string') return;
    let hit;
    try { hit = this.take(cmd.id); }
    catch (err) { window.showToast?.(err.message, 'error'); return; }
    this.pushAll();
    if (!hit || cmd.type !== 'handoff-open') return;
    // In the tab that showed the card, like a tile on that page.
    if (webview && typeof webview.loadURL === 'function') {
      Promise.resolve(webview.loadURL(hit.url)).catch(err => {
        const m = String((err && err.message) || err);
        if (!/ERR_ABORTED|\(-3\)/.test(m)) window.showToast?.('Could not open ' + hit.url + ': ' + m, 'error');
      });
    } else if (typeof TabManager !== 'undefined') {
      TabManager.createTab(hit.url, true);
    }
  },

  // ---- The address bar button ---------------------------------------------
  syncButton(tab) {
    const btn = document.getElementById('btn-send-device');
    if (!btn) return;
    btn.hidden = !this.sendable(tab || (typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null)).ok;
  },

  // ---- Sending ------------------------------------------------------------
  closeMenu() {
    const pop = document.getElementById('vex-handoff-pop');
    if (pop) { if (pop._cleanup) pop._cleanup(); pop.remove(); }
  },

  // anchor: an element (opens under it), {x, y} (opens there) or nothing
  // (centred near the top, for Ctrl+K).
  async openMenu(tab, anchor) {
    this.closeMenu();
    const can = this.sendable(tab);
    if (!can.ok) { window.showToast?.(can.why, 'warn'); return null; }
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const icon = (n, size = 16) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(n, { size }) : '');
    const pop = document.createElement('div');
    pop.id = 'vex-handoff-pop';
    pop.className = 'vex-handoff-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Send to your devices');
    let host = '';
    try { host = new URL(tab.url).host; } catch { host = ''; }
    const head = `<div class="hp-head">${icon('send', 15)}<span class="hp-title">Send to your devices</span>
      <button type="button" class="hp-close" aria-label="Close" title="Close">${icon('x', 14)}</button></div>
      <div class="hp-page"><div class="hp-page-title">${esc(tab.title || host || tab.url)}</div><div class="hp-page-host">${esc(host)}</div></div>`;
    if (!this.ready()) {
      pop.innerHTML = head + `<div class="hp-body">
          <p class="hp-text">Vex Sync sends this tab to your phone and your other computers, end-to-end encrypted.</p>
          <button type="button" class="hp-primary" data-act="setup">Set up Vex Sync</button>
          <button type="button" class="hp-link" data-act="qr">Show a QR code instead</button>
        </div>`;
    } else {
      pop.innerHTML = head + `<div class="hp-body">
          <div class="hp-devices" aria-live="polite"><div class="hp-muted">Loading your devices…</div></div>
          <p class="hp-note">Whichever of these opens Vex first gets it. Unopened tabs wait up to 7 days.</p>
          <div class="hp-error" role="alert" hidden></div>
          <button type="button" class="hp-primary" data-act="send">Send</button>
        </div>`;
    }
    document.body.appendChild(pop);
    this._place(pop, anchor);

    const close = () => this.closeMenu();
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); e.stopPropagation(); close(); } };
    const onDown = (e) => { if (!pop.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) close(); };
    document.addEventListener('keydown', onKey, true);
    // After this click has finished, or it would close the menu it opened.
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
    window.addEventListener('blur', close);
    pop._cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', close);
    };
    pop.querySelector('.hp-close').addEventListener('click', close);

    if (!this.ready()) {
      pop.querySelector('[data-act="setup"]').addEventListener('click', () => {
        close();
        if (window.SettingsUI && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('sync-panel-content');
        else window.showToast?.('Open Settings › Cloud › Vex Sync', 'info');
      });
      pop.querySelector('[data-act="qr"]').addEventListener('click', () => {
        close();
        if (window.SendToPhone) SendToPhone.open(tab.url);
      });
      pop.querySelector('[data-act="setup"]').focus();
      return pop;
    }

    const sendBtn = pop.querySelector('[data-act="send"]');
    const errBox = pop.querySelector('.hp-error');
    sendBtn.focus();
    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      errBox.hidden = true;
      try {
        await this.send(tab);
        close();
        window.showToast?.('Sent to your devices', 'success');
      } catch (err) {
        errBox.textContent = this._human(err);
        errBox.hidden = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Try again';
      }
    });
    this._fillDevices(pop);
    return pop;
  },

  _human(err) {
    const m = (err && err.message) || 'Send failed';
    return (window.SyncSettings && typeof SyncSettings.human === 'function') ? SyncSettings.human(m) : m;
  },

  async _fillDevices(pop) {
    const box = pop.querySelector('.hp-devices');
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
    const icon = (n) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(n, { size: 15 }) : '');
    let devices;
    try { devices = await SyncEngine.listDevices(); }
    catch (err) {
      if (!pop.isConnected) return;
      box.innerHTML = `<div class="hp-muted">${esc(this._human(err))}</div>`;
      return;
    }
    if (!pop.isConnected) return;
    const me = SyncEngine.getState().deviceId;
    const others = devices.filter(d => d && d.deviceId !== me);
    if (!others.length) {
      box.innerHTML = '<div class="hp-muted">No other device is signed in to this account yet. A tab you send waits for the next one you sign in.</div>';
      return;
    }
    box.innerHTML = others.map(d => `<div class="hp-device">${icon(this.looksLikePhone(d.deviceName) ? 'phone' : 'monitor')}<span class="hp-device-name">${esc(d.deviceName || 'Unnamed device')}</span><span class="hp-device-seen">${esc(this._ago(d.lastSeenAt))}</span></div>`).join('');
  },

  _ago(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'active now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  },

  _place(pop, anchor) {
    const W = window.innerWidth, H = window.innerHeight;
    const r = pop.getBoundingClientRect();
    let left, top;
    if (anchor instanceof Element) {
      const a = anchor.getBoundingClientRect();
      left = a.right - r.width; top = a.bottom + 6;
    } else if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      left = anchor.x; top = anchor.y;
    } else {
      left = (W - r.width) / 2; top = Math.min(120, H * 0.15);
    }
    left = Math.max(8, Math.min(left, W - r.width - 8));
    top = Math.max(8, Math.min(top, H - r.height - 8));
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  },

  // Throws, worded by SyncEngine, when it could not be sent.
  async send(tab) {
    const can = this.sendable(tab);
    if (!can.ok) throw new Error(can.why);
    if (typeof SyncEngine === 'undefined') throw new Error('Vex Sync is not available');
    return SyncEngine.dropSend(tab.url, tab.title || '');
  },

  init() {
    const btn = document.getElementById('btn-send-device');
    if (btn) {
      if (typeof VexIcons !== 'undefined') btn.innerHTML = VexIcons.svg('send', { size: 13 });
      btn.addEventListener('click', () => {
        if (document.getElementById('vex-handoff-pop')) { this.closeMenu(); return; }
        const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
        this.openMenu(t, btn);
      });
      this.syncButton();
      window.addEventListener('vex-tabs-changed', () => this.syncButton());
    }
    // Checked on focus, every 2 minutes, and shortly after launch (§5.6).
    const check = () => { this.receive(); };
    window.addEventListener('focus', check);
    if (typeof VexJobs !== 'undefined') VexJobs.every('Tabs sent from other devices', 2 * 60 * 1000, check, { when: 'background' });
    setTimeout(check, 8000);
  },
};

if (typeof window !== 'undefined') window.Handoff = Handoff;
if (typeof module !== 'undefined' && module.exports) module.exports = { Handoff };
