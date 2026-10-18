// === Settings for links and windows: the window's half of T3-079 and T3-095 =====
//
// Two records main reads when it needs them (src/main/mini-window.js,
// src/main/window-set.js):
//   vex.miniWindow = { on, autoCloseMinutes }   links from other programs in a small window (off unless chosen)
//   vex.windowSet  = { on, apps }               the windows of last time come back
// plus the Ctrl+K command that brings back the latest closed window, and the
// "Links and windows" group in Settings that also holds the switches of connect-ahead
// (js/preconnect.js) and the taskbar actions (js/jump-actions.js).
const _linksReadPref = {
  read(key, defaults, label) {
    const raw = localStorage.getItem(key);
    if (raw === null) return { ...defaults };
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[' + label + '] the saved choices are damaged and start again:', err); return { ...defaults }; }
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...defaults, ...v } : { ...defaults };
  },
};

const VexMiniWindow = {
  KEY: 'vex.miniWindow',
  DEFAULTS: { on: false, autoCloseMinutes: 15 },
  prefs() { return _linksReadPref.read(this.KEY, this.DEFAULTS, 'MiniWindow'); },
  save(patch) {
    const next = { ...this.prefs(), ...patch };
    if (typeof next.on !== 'boolean') throw new Error('The mini window is on or off');
    if (!Number.isInteger(next.autoCloseMinutes) || next.autoCloseMinutes < 0 || next.autoCloseMinutes > 240) throw new Error('Auto-close is 0 (never) to 240 minutes');
    localStorage.setItem(this.KEY, JSON.stringify({ on: next.on, autoCloseMinutes: next.autoCloseMinutes }));
    return next;
  },
  enabled() { return this.prefs().on === true; },
  setEnabled(on) { this.save({ on: !!on }); },
};

const VexWindowSet = {
  KEY: 'vex.windowSet',
  DEFAULTS: { on: true, apps: true },
  prefs() { return _linksReadPref.read(this.KEY, this.DEFAULTS, 'WindowSet'); },
  save(patch) {
    const next = { ...this.prefs(), ...patch };
    if (typeof next.on !== 'boolean' || typeof next.apps !== 'boolean') throw new Error('These are on or off');
    localStorage.setItem(this.KEY, JSON.stringify({ on: next.on, apps: next.apps }));
    return next;
  },
  enabled() { return this.prefs().on !== false; },
  setEnabled(on) { this.save({ on: !!on }); },
  async reopenClosed() {
    if (!window.vex || typeof window.vex.windowsReopenClosed !== 'function') throw new Error('The window cannot reach the window list');
    // Nothing is recorded while the switch is off, so main would only say there is nothing to bring back.
    if (!this.enabled()) throw new Error('Remembering windows is switched off. Turn on "Remember my windows" in Settings > Links and windows.');
    const r = await window.vex.windowsReopenClosed();
    if (!r.ok) throw new Error(r.reason || 'No closed window to bring back');
    return r;
  },
};

const VexLinksWindowsSettings = {
  ID: 'links-windows',
  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const info = (t) => body.appendChild(el('p', 'setting-info', t));
    const toggle = (label, hint, on, set) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!on; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { try { set(input.checked); } catch (err) { input.checked = !input.checked; fail(err); } });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', label), lab);
      body.appendChild(row);
      if (hint) info(hint);
    };

    toggle('Connect ahead to links', 'Resting on a link for a moment opens the connection to its site early, so the click is quicker. Only for links to the same site as the page, or the sites below. Never in a private or Tor tab.', VexPreconnect.enabled(), (on) => VexPreconnect.setEnabled(on));
    const allow = el('textarea', 'set-input');
    allow.rows = 3; allow.value = VexPreconnect.prefs().allow.join('\n'); allow.setAttribute('aria-label', 'Sites that may be connected to from any page, one per line');
    allow.placeholder = 'example.com';
    allow.addEventListener('change', () => {
      try { VexPreconnect.save({ allow: allow.value.split(/\r?\n/) }); allow.value = VexPreconnect.prefs().allow.join('\n'); }
      catch (err) { fail(err); }
    });
    info('Sites that may be connected to from any page (one per line, with their subdomains):');
    body.appendChild(allow);

    toggle('Links from other programs open in a small window', 'A link clicked in Discord, Steam or a mail program opens in a small window instead of bringing Vex forward. Ctrl+Shift+Enter makes it a tab. Over a full-screen game it does not take the focus.', VexMiniWindow.enabled(), (on) => VexMiniWindow.setEnabled(on));
    const minutes = document.createElement('input');
    minutes.type = 'number'; minutes.min = '0'; minutes.max = '240'; minutes.className = 'set-input'; minutes.value = String(VexMiniWindow.prefs().autoCloseMinutes);
    minutes.setAttribute('aria-label', 'Minutes before an unused mini window closes itself (0 = never)');
    minutes.addEventListener('change', () => { try { VexMiniWindow.save({ autoCloseMinutes: parseInt(minutes.value, 10) }); } catch (err) { fail(err); minutes.value = String(VexMiniWindow.prefs().autoCloseMinutes); } });
    info('Minutes before one nobody is looking at closes itself (0 = never):');
    body.appendChild(minutes);

    toggle('Taskbar actions', 'Right-click Vex on the taskbar for New note, New workspace, Reopen last closed tab and Quick capture. (Installed Vex only.)', VexJumpActions.enabled(), (on) => VexJumpActions.setEnabled(on));

    toggle('Remember my windows', 'Vex opens where you left it, on the same monitor, and keeps the last ten windows you closed (Ctrl+K, "Reopen closed window").', VexWindowSet.enabled(), (on) => { VexWindowSet.setEnabled(on); this.render(body); });
    if (VexWindowSet.enabled()) toggle('Open the Open as App windows of last time again', '', VexWindowSet.prefs().apps, (on) => VexWindowSet.save({ apps: on }));
  },
  init() {
    if (this._inited) return;
    if (typeof VexSettingsGroups === 'undefined') throw new Error('VexSettingsGroups is not loaded');
    this._inited = true;
    VexSettingsGroups.register({ id: this.ID, title: 'Links and windows', keywords: 'preconnect link hover mini window external discord steam jump list taskbar restore windows monitor', render: (body) => this.render(body) });
    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      VexExtras.registerCommand({ id: 'reopen-window', label: 'Reopen closed window', hint: 'Bring back the Open as App window you closed last', icon: 'window', action: () => VexWindowSet.reopenClosed().catch(fail => window.showToast?.(fail.message, 'error')) });
    }
  },
};

if (typeof window !== 'undefined') { window.VexMiniWindow = VexMiniWindow; window.VexWindowSet = VexWindowSet; window.VexLinksWindowsSettings = VexLinksWindowsSettings; }
// This file loads after start-up (js/lazy-boot.js LATE_MODULES): app.js's own call to init() runs before it
// exists, so nobody else starts it. Without this the "Links and windows" section and Ctrl+K "Reopen closed
// window" were never registered. init() runs once however many callers there are.
if (typeof window !== 'undefined' && typeof VexSettingsGroups !== 'undefined') VexLinksWindowsSettings.init();
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMiniWindow, VexWindowSet, VexLinksWindowsSettings };
