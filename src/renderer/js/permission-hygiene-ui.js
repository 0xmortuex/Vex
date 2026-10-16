// === Permission hygiene - the part you see (T2-084) ==============================
//
// The rules live in main (src/main/permission-hygiene.js). This file is:
//   - Settings > Permission hygiene: the switch, how many days a kept camera,
//     microphone, location, notification, screen or clipboard grant lasts, the
//     trap guard and the indicator, a list of what is allowed with a Pin button
//     (a pinned grant never ends), and the weekly line "3 sites can use your mic";
//   - a pill in the address bar while the tab in front has just been given or used
//     the camera, microphone, location or screen, with a Stop button;
//   - the Attention Inbox rows: a prompt the trap guard quieted (with an Allow
//     button), the grants about to end (with a Keep button) and the weekly line.
//
// Off for a profile that existed before this feature until it is switched on (the
// registry's staged enablement); the settings are pushed to main on start and on
// every change, and main keeps them in its own file so they hold before this loads.
const VexPermHygiene = {
  KEY: 'vex.permHygiene.enabled',      // '0' = off
  CFG: 'vex.permHygiene.config',       // { expiryDays, expiry, trapGuard, indicator }
  WEEKLY: 'vex.permHygiene.weekly',    // ms of the last weekly line
  FEATURE: 'perm-hygiene',
  WEEK_MS: 7 * 24 * 3600 * 1000,
  DAYS: [7, 14, 30, 60, 90, 180],
  DEFAULTS: { expiryDays: 30, expiry: true, trapGuard: true, indicator: true },
  _live: new Map(),                    // contents id -> { origin, parts }
  _lastPushed: '',

  enabled() { try { return localStorage.getItem(this.KEY) !== '0'; } catch (err) { console.error('[PermHygiene] the switch could not be read:', err.message); return true; } },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    this.sync().catch(err => window.showToast?.('Permission hygiene could not be switched: ' + err.message, 'error'));
  },

  config() {
    let saved = {};
    const raw = localStorage.getItem(this.CFG);
    if (raw) {
      try { saved = JSON.parse(raw); }
      catch (err) { throw new Error('The saved permission hygiene settings are not readable: ' + err.message); }
    }
    return { ...this.DEFAULTS, ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) };
  },
  setConfig(patch) {
    const next = { ...this.config(), ...patch };
    localStorage.setItem(this.CFG, JSON.stringify(next));
    return this.sync();
  },

  // Tell main what is switched on. Skipped when nothing changed since the last push.
  async sync() {
    if (!window.vex || typeof window.vex.hygienePermConfig !== 'function') throw new Error('Permission hygiene is not available in this window');
    const payload = { enabled: this.enabled(), ...this.config() };
    const text = JSON.stringify(payload);
    if (text === this._lastPushed) return payload;
    const saved = await window.vex.hygienePermConfig(payload);
    this._lastPushed = text;
    return saved;
  },

  // ---- pure helpers (tests) -------------------------------------------------------
  whenText(ms, now = Date.now()) {
    if (ms == null) return 'until you change it';
    const days = Math.ceil((ms - now) / 86400000);
    return days <= 0 ? 'ends today' : 'ends in ' + days + (days === 1 ? ' day' : ' days');
  },
  weeklyDue(last, now = Date.now()) { return !Number.isFinite(last) || now - last >= this.WEEK_MS; },
  partsText(parts) {
    const names = { camera: 'camera', microphone: 'microphone', geolocation: 'location', 'display-capture': 'screen' };
    return (parts || []).map(p => names[p] || p).join(' and ');
  },

  // ---- the indicator in the address bar -------------------------------------------------
  _pill: null,
  _activeId() {
    const wv = typeof WebviewManager !== 'undefined' && typeof WebviewManager.getActiveWebview === 'function' ? WebviewManager.getActiveWebview() : null;
    if (!wv || typeof wv.getWebContentsId !== 'function') return null;
    try { return wv.getWebContentsId(); } catch { return null; }   // vex-allow-empty-catch: a <webview> throws until its page is attached; no page, no indicator
  },
  updatePill() {
    const pill = this._pill;
    if (!pill) return;
    const rec = this.enabled() && this.config().indicator ? this._live.get(this._activeId()) : null;
    pill.hidden = !rec || !rec.parts.length;
    if (pill.hidden) return;
    const text = this.partsText(rec.parts);
    pill.textContent = '';
    pill.insertAdjacentHTML('afterbegin', VexIcons.svg(rec.parts.includes('camera') ? 'camera' : rec.parts.includes('microphone') ? 'mic' : rec.parts.includes('display-capture') ? 'monitor' : 'pin', { size: 12 }));
    const label = document.createElement('span');
    label.textContent = text;
    pill.appendChild(label);
    pill.title = rec.origin + ' was given your ' + text + ' in this tab. Click to stop it.';
    pill.setAttribute('aria-label', rec.origin + ' was given your ' + text + ' in this tab. Stop it');
  },
  async stopActive() {
    const id = this._activeId();
    const rec = this._live.get(id);
    if (!rec) return false;
    const ok = await vexConfirm({ title: 'Stop ' + this.partsText(rec.parts) + ' for this tab?', message: rec.origin + ' will be blocked from your ' + this.partsText(rec.parts) + ' and the page reloads, which ends it. You can allow it again from the site panel.', okLabel: 'Block and reload', danger: true });
    if (!ok) return false;
    await window.vex.hygienePermStop(id);
    return true;
  },

  initPill() {
    const bar = document.getElementById('url-bar');
    if (!bar) throw new Error('[PermHygiene] #url-bar missing');
    const pill = document.createElement('button');
    pill.id = 'url-perm-live';
    pill.type = 'button';
    pill.hidden = true;
    pill.addEventListener('click', () => this.stopActive().catch(err => window.showToast?.('Could not stop it: ' + err.message, 'error')));
    const before = document.getElementById('url-zoom') || document.getElementById('btn-copy-url');
    if (before && before.parentElement === bar) bar.insertBefore(pill, before); else bar.appendChild(pill);
    this._pill = pill;
    const refresh = () => this.updatePill();
    window.addEventListener('vex:tab-activated', refresh);
    document.addEventListener('vex:tab-navigated', refresh);
    window.vex.onHygieneLive((e) => {
      if (e && Array.isArray(e.parts) && e.parts.length) this._live.set(e.contentsId, { origin: e.origin, parts: e.parts });
      else if (e) this._live.delete(e.contentsId);
      refresh();
    });
  },

  // ---- the Attention Inbox rows -------------------------------------------------------------
  initInbox() {
    if (typeof AttentionInbox === 'undefined') return;
    AttentionInbox.handle(this.FEATURE, (key, row) => {
      if (key === 'allow') return window.vex.hygienePermDecide(row.sub, 'allow').then(() => window.showToast?.('Allowed')).catch(err => window.showToast?.(err.message, 'error'));
      if (key === 'keep') return this.pinSoon().catch(err => window.showToast?.(err.message, 'error'));
      throw new Error('Permission hygiene has no button called ' + key);
    });
    window.vex.onHygieneQuieted((q) => {
      if (!this.enabled() || !q) return;
      const what = { notifications: 'send you notifications', geolocation: 'know your location', 'clipboard-read': 'read your clipboard', midi: 'use your MIDI devices', midiSysex: 'use your MIDI devices' }[q.permission] || q.permission;
      VexAttention.suggest({ feature: this.FEATURE, label: 'Permission hygiene', id: q.id, title: q.origin + ' asked to ' + what + ' without a click. Vex said no.', body: 'Nothing was saved. Allow it only if you wanted this.', action: { label: 'Allow it', key: 'allow' } });
    });
  },
  async pinSoon() {
    const s = await window.vex.hygienePermSummary();
    for (const r of s.soon) await window.vex.hygienePermPin(r.key, true);
    window.showToast?.(s.soon.length ? 'Kept ' + s.soon.length + (s.soon.length === 1 ? ' permission' : ' permissions') : 'Nothing was about to end');
  },
  // The weekly line and the "about to end" row. Said at most once a week / once a loss.
  async weekly(now = Date.now()) {
    if (!this.enabled()) return false;
    const s = await window.vex.hygienePermSummary();
    let said = false;
    if (s.soonLines.length) {
      VexAttention.suggest({ feature: this.FEATURE, label: 'Permission hygiene', id: 'soon', title: s.soonLines[0] + (s.soonLines.length > 1 ? ' (and ' + (s.soonLines.length - 1) + ' more)' : '') + '.', body: 'After that the site asks again. Keep it if you still use it.', action: { label: 'Keep them', key: 'keep' } });
      said = true;
    }
    const last = Number(localStorage.getItem(this.WEEKLY));
    if (s.lines.length && this.weeklyDue(last, now)) {
      VexAttention.suggest({ feature: this.FEATURE, label: 'Permission hygiene', id: 'weekly', title: s.lines.slice(0, 3).join('; ') + '.', body: 'Settings > Permission hygiene lists them.' });
      localStorage.setItem(this.WEEKLY, String(now));
      said = true;
    }
    return said;
  },

  // ---- Settings --------------------------------------------------------------------------------
  async render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const redraw = () => this.render(body).catch(fail);
    body.appendChild(el('p', 'setting-info', 'A camera, microphone, location, notification, screen or clipboard permission you kept for good can end by itself, a prompt that nobody triggered can be answered no, and a badge shows which tab has just been given your camera, microphone, location or screen. Off for existing profiles until you switch it on. Permissions you already gave are left alone; only new ones can end.'));
    const toggle = (label, get, set) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = get(); input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { try { set(input.checked); } catch (err) { input.checked = !input.checked; fail(err); } });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', label), lab);
      body.appendChild(row);
    };
    toggle('Permission hygiene', () => this.enabled(), (on) => { this.setEnabled(on); setTimeout(redraw, 150); });
    if (!this.enabled()) return;
    const cfg = this.config();
    toggle('Kept permissions end by themselves', () => cfg.expiry, (on) => this.setConfig({ expiry: on }).catch(fail));
    const dayRow = el('div', 'setting-row');
    dayRow.appendChild(el('span', '', 'Kept permissions last'));
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Days a kept permission lasts');
    for (const d of this.DAYS) { const o = document.createElement('option'); o.value = String(d); o.textContent = d + ' days'; if (d === cfg.expiryDays) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => this.setConfig({ expiryDays: Number(sel.value) }).catch(fail));
    dayRow.appendChild(sel);
    body.appendChild(dayRow);
    toggle('Quiet a prompt nobody triggered', () => cfg.trapGuard, (on) => this.setConfig({ trapGuard: on }).catch(fail));
    toggle('Show which tab is using the camera, microphone, location or screen', () => cfg.indicator, (on) => this.setConfig({ indicator: on }).catch(fail));

    const s = await window.vex.hygienePermSummary();
    const box = el('div', 'attention-list');
    box.appendChild(el('div', 'setting-label', 'Allowed now'));
    if (!s.lines.length) box.appendChild(el('p', 'setting-info', 'No site can use your camera, microphone, location, screen, clipboard or notifications.'));
    for (const l of s.lines) box.appendChild(el('p', 'setting-info', l));
    const allowed = s.rows.filter(r => r.decision === 'allow');
    for (const r of allowed) {
      const row = el('div', 'setting-row');
      row.appendChild(el('span', '', r.origin + (r.where ? ' (' + r.where + ')' : '') + ': ' + r.permission + ', ' + (r.pinned ? 'pinned, never ends' : this.whenText(r.until))));
      const b = el('button', 'btn-secondary', r.pinned ? 'Unpin' : 'Pin'); b.type = 'button';
      b.setAttribute('aria-label', (r.pinned ? 'Unpin ' : 'Pin ') + r.origin + ' ' + r.permission);
      b.addEventListener('click', () => window.vex.hygienePermPin(r.key, !r.pinned).then(redraw).catch(fail));
      row.appendChild(b);
      box.appendChild(row);
    }
    body.appendChild(box);
  },

  init() {
    this.sync().catch(err => console.error('[PermHygiene] main could not be told the settings:', err));
    window.addEventListener('vex-usage-changed', () => this.sync().catch(err => console.error('[PermHygiene] main could not be told the settings:', err)));
    this.initPill();
    this.initInbox();
    // A first look a minute after start, then hourly; a week passing is checked inside.
    setTimeout(() => this.weekly().catch(err => console.error('[PermHygiene] the weekly line failed:', err)), 60000);
    if (typeof VexJobs !== 'undefined') VexJobs.every('Permission summary', 3600 * 1000, () => this.weekly(), { when: 'background', feature: this.FEATURE });
  },
};

if (typeof window !== 'undefined') {
  window.VexPermHygiene = VexPermHygiene;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'perm-hygiene', title: 'Permission hygiene', keywords: 'permissions expire camera microphone location notifications pin trap indicator weekly', render: (body) => { VexPermHygiene.render(body).catch(err => { body.textContent = 'This section could not be shown: ' + err.message; }); } });
  }
  // A private window gets none of it: its channels are closed there (ipc-policy.js).
  if (window.vex && typeof window.vex.hygienePermConfig === 'function' && document.getElementById('url-bar') && !(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow)) VexPermHygiene.init();
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'perm-hygiene', label: 'Permission hygiene', hint: 'Which sites can use your camera, microphone or location, and for how long', icon: 'shield', action: () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('setting-perm-hygiene'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPermHygiene };
