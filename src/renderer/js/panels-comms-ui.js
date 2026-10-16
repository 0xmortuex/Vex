// === Panels and messages: the screens, the commands and the Settings section ======
//
// One place for everything the person SEES of the panel features:
//
//   Needs me                     js/needs-me.js              Ctrl+K "Needs me"
//   Notifications from panels    js/panel-capture.js         Ctrl+K "Notifications from panels"
//   Panel ledger                 js/panel-state.js           Ctrl+K "Panel ledger"
//   Away mode summary            js/away-mode.js             Ctrl+K "Go away" / "I am back"
//   Settings > Panels and messages   every switch of the above, VIP rules, delivery
//                                windows and close-protect
//
// The logic lives in those modules; this only draws and wires. Every action
// reports a failure in a toast instead of swallowing it.
const PanelsCommsUI = {
  _fail(err) {
    console.error('[PanelsComms]', err);
    window.showToast?.((err && err.message) || String(err), 'error');
  },
  _guard(fn) {
    try { const r = fn(); if (r && typeof r.catch === 'function') r.catch((e) => this._fail(e)); } catch (e) { this._fail(e); }
  },
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _ago(ms) {
    const d = Date.now() - ms;
    if (d < 90 * 1000) return 'just now';
    if (d < 3600 * 1000) return Math.round(d / 60000) + ' min ago';
    if (d < 24 * 3600 * 1000) return Math.round(d / 3600000) + ' h ago';
    return Math.round(d / 86400000) + ' d ago';
  },
  _redrawOpen(prop, dialogId) {
    if (typeof this[prop] === 'function' && document.getElementById(dialogId)) this._guard(() => this[prop]());
  },
  _btn(text, fn, opts) { return VexSettingsGroups.button(text, () => this._guard(fn), opts); },

  // ---- Needs me --------------------------------------------------------------------------------
  async openNeedsMe() {
    if (typeof NeedsMe === 'undefined') throw new Error('Needs me is not loaded');
    const dlg = VexSettingsGroups.dialog({ id: 'needs-me-dialog', title: 'Needs me', sub: 'Everything waiting on you, with the reason. Newest-first is always one click away.' });
    const body = dlg.body;
    const draw = async () => {
      const ranked = NeedsMe.ranked();
      const res = await NeedsMe.collect({ ranked });
      if (!dlg.overlay.isConnected) return;
      body.textContent = '';
      const bar = this._el('div', 'setting-row');
      bar.append(this._btn(ranked ? 'Show newest first' : 'Rank by what matters', () => { NeedsMe.setRanked(!ranked); return draw(); }));
      bar.append(this._btn('Refresh', draw));
      body.appendChild(bar);
      for (const p of res.problems) body.appendChild(VexSettingsGroups.note('Could not read one source: ' + p));
      if (!res.rows.length) body.appendChild(VexSettingsGroups.note('Nothing is waiting on you.'));
      for (const row of res.rows) {
        const box = this._el('div', 'setting-group');
        box.appendChild(this._el('div', 'setting-label', (row.vip ? 'VIP: ' : '') + row.title));
        if (row.sub) box.appendChild(VexSettingsGroups.note(row.sub));
        box.appendChild(VexSettingsGroups.note('Why: ' + row.why.join('; ') + (ranked ? ' (' + Math.round(row.score) + ')' : '')));
        const btns = this._el('div', 'setting-row');
        btns.append(this._btn('Open', () => { NeedsMe.open(row); dlg.close(); }, { primary: true }));
        btns.append(this._btn('Dismiss', async () => { await NeedsMe.dismiss(row); return draw(); }));
        const snooze = this._el('select', 'select');
        snooze.setAttribute('aria-label', 'Snooze ' + row.title);
        for (const [v, t] of [['', 'Snooze...'], ['hour', 'For an hour'], ['evening', 'Until this evening'], ['tomorrow', 'Until tomorrow']]) { const o = this._el('option', '', t); o.value = v; snooze.appendChild(o); }
        snooze.addEventListener('change', () => { if (snooze.value) this._guard(() => { NeedsMe.snooze(row, snooze.value); return draw(); }); });
        btns.append(snooze);
        if (row.origin === 'panel' && row.ref.conversation) btns.append(this._btn('Mute 1 hour', () => { NeedsMe.muteConversation(row, 3600000); return draw(); }));
        box.appendChild(btns);
        body.appendChild(box);
      }
    };
    this._needsDraw = draw;
    await draw();
    return dlg;
  },

  // ---- the list of notifications panels raised ------------------------------------------------------
  openNotifications() {
    if (typeof PanelCapture === 'undefined') throw new Error('Notifications from panels are not loaded');
    const dlg = VexSettingsGroups.dialog({ id: 'panel-notifications-dialog', title: 'Notifications from panels', sub: 'What Discord and WhatsApp said, kept on this computer for 7 days. Only the sites you turned on.' });
    const draw = () => {
      const body = dlg.body;
      body.textContent = '';
      if (!PanelCapture.enabled()) body.appendChild(VexSettingsGroups.note('This is off. Turn it on in Settings, Panels and messages.'));
      const items = PanelCapture.list({ includeMuted: true });
      if (!items.length) body.appendChild(VexSettingsGroups.note('Nothing has been kept.'));
      for (const n of items.slice(0, 100)) {
        const box = this._el('div', 'setting-group');
        const muted = PanelCapture.isMuted(n.source, n.title);
        box.appendChild(this._el('div', 'setting-label', PanelCapture.label(n.source) + ': ' + n.title + (n.vip ? '  (VIP)' : '') + (muted ? '  (muted)' : '')));
        if (n.body) box.appendChild(VexSettingsGroups.note(n.body));
        box.appendChild(VexSettingsGroups.note(this._ago(n.ts) + (n.read ? ', read' : '')));
        const row = this._el('div', 'setting-row');
        if (!n.read) row.append(this._btn('Mark read', () => { PanelCapture.markRead(n.id); draw(); }));
        row.append(muted ? this._btn('Unmute', () => { PanelCapture.unmute(n.source, n.title); draw(); }) : this._btn('Mute 1 hour', () => { PanelCapture.mute(n.source, n.title, 3600000); draw(); }));
        if (typeof UnreadTask !== 'undefined' && UnreadTask.enabled()) row.append(this._btn('Make a task', () => { UnreadTask.fromNotification(n.id); window.showToast?.('Task added'); }));
        row.append(this._btn('Remove', () => { PanelCapture.remove(n.id); draw(); }));
        box.appendChild(row);
        body.appendChild(box);
      }
    };
    this._notifDraw = draw;
    draw();
    return dlg;
  },

  // ---- the unread ledger ---------------------------------------------------------------------------------
  openLedger() {
    if (typeof PanelState === 'undefined') throw new Error('The panel state is not loaded');
    const dlg = VexSettingsGroups.dialog({ id: 'panel-ledger-dialog', title: 'Panel ledger', sub: 'How each panel\'s unread count moved. Numbers and times only, kept on this computer.' });
    const hist = PanelState.history({ limit: 100 });
    if (!hist.length) dlg.body.appendChild(VexSettingsGroups.note('Nothing has changed yet.'));
    for (const e of hist) {
      dlg.body.appendChild(VexSettingsGroups.note(PanelState.label(e.p) + ' ' + e.from + ' to ' + e.to + ' at ' + new Date(e.ts).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })));
    }
    const row = this._el('div', 'setting-row');
    row.append(this._btn('Clear the ledger', () => { PanelState.clearLedger(); dlg.close(); }, { danger: true }));
    dlg.body.appendChild(row);
    return dlg;
  },

  // ---- the away summary ------------------------------------------------------------------------------------
  showAwaySummary(summary) {
    const dlg = VexSettingsGroups.dialog({ id: 'away-summary-dialog', title: 'Welcome back', sub: 'Made on this computer by counting, nothing was sent anywhere.' });
    for (const line of summary.lines) dlg.body.appendChild(VexSettingsGroups.note(line));
    const row = this._el('div', 'setting-row');
    row.append(this._btn('Open Needs me', () => { dlg.close(); return this.openNeedsMe(); }, { primary: true }));
    row.append(this._btn('Close', () => dlg.close()));
    dlg.body.appendChild(row);
    return dlg;
  },

  // ---- Settings ---------------------------------------------------------------------------------------------
  _toggle(body, label, get, set) {
    const row = this._el('div', 'setting-toggle-row');
    const lab = this._el('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!get(); input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      const want = input.checked;
      Promise.resolve().then(() => set(want)).then(() => { input.checked = !!get(); }).catch((err) => { input.checked = !!get(); this._fail(err); });
    });
    lab.append(input, this._el('span', 'toggle-slider'));
    row.append(this._el('span', 'setting-label-text', label), lab);
    body.appendChild(row);
    return input;
  },
  _heading(body, text) { body.appendChild(this._el('div', 'setting-label', text)); },

  render(body) {
    body.textContent = '';
    const redraw = () => this.render(body);
    const T = (label, get, set) => this._toggle(body, label, get, (v) => { set(v); });

    // Notifications from panels (T1-020)
    this._heading(body, 'Notifications from panels');
    body.appendChild(VexSettingsGroups.note('Keeps a short list of what Discord and WhatsApp notifications said (the title and the start of the text), on this computer only, for 7 days, so you can see what a panel said while its toast was held. It is off until you agree, and each site is separate. Never from private windows, Tor or routed tabs.'));
    this._toggle(body, 'Keep notifications from panels', () => PanelCapture.enabled(), async (v) => {
      if (v && !PanelCapture.enabled()) {
        const yes = await window.vexConfirm({ title: 'Keep notifications from panels?', message: 'Vex will keep the title and the first 300 characters of each Discord or WhatsApp notification you turn on below, for 7 days, on this computer. It is never sent anywhere, and "Forget" empties it. Private windows, Tor and routed tabs are never included.', okLabel: 'Keep them', cancelLabel: 'Not now' });
        if (!yes) return;
        PanelCapture.grant();
      } else PanelCapture.setEnabled(false);
      redraw();
    });
    for (const [site, name] of Object.entries(PanelCapture.SOURCES)) {
      const t = this._toggle(body, '  ' + name, () => PanelCapture.siteOn(site), (v) => PanelCapture.setSite(site, v));
      if (!PanelCapture.enabled()) t.disabled = true;
    }
    const capRow = this._el('div', 'setting-row');
    capRow.append(this._btn('See the list (' + PanelCapture.list({ includeMuted: true }).length + ')', () => this.openNotifications()));
    capRow.append(this._btn('Forget everything it kept', async () => {
      const yes = await window.vexConfirm({ title: 'Forget the notifications?', message: 'The list and the mutes are emptied. This cannot be undone.', okLabel: 'Forget', cancelLabel: 'Keep', danger: true });
      if (yes) { PanelCapture.forget(); redraw(); }
    }, { danger: true }));
    body.appendChild(capRow);

    // VIP rules (T1-033)
    this._heading(body, 'VIP people and words');
    body.appendChild(VexSettingsGroups.note('A VIP person, word or panel is shown first in Needs me, is let through Focus and quiet moments with one in-window toast, and is left out of the digest. Matches are whole words in the title or text of things Vex already holds.'));
    T('Use VIP rules', () => VipRules.enabled(), (v) => VipRules.setEnabled(v));
    const rules = VipRules.rules();
    const list = (title, items, describe, remove) => {
      for (const it of items) {
        const r = this._el('div', 'setting-row');
        r.append(this._el('span', '', title + ': ' + describe(it)));
        r.append(this._btn('Remove', () => { remove(it); redraw(); }));
        body.appendChild(r);
      }
    };
    list('Person', rules.people, p => p.name + (p.aliases.length ? ' (also ' + p.aliases.join(', ') + ')' : ''), p => VipRules.removePerson(p.name));
    list('Word', rules.keywords, k => k, k => VipRules.removeKeyword(k));
    list('Panel', rules.sites, s => PanelCapture.label(s), s => VipRules.removeSite(s));
    const add = this._el('div', 'setting-row');
    add.append(this._btn('Add a person', async () => {
      const name = await window.vexPrompt({ title: 'Add a VIP person', message: 'Their name as it appears in notifications.', okLabel: 'Next' });
      if (!name) return;
      const aliases = await window.vexPrompt({ title: 'Other names', message: 'Nicknames or handles, separated by commas (optional).', okLabel: 'Add' });
      VipRules.addPerson(name, aliases || ''); redraw();
    }));
    add.append(this._btn('Add a word', async () => {
      const w = await window.vexPrompt({ title: 'Add a VIP word', message: 'A whole word that always matters, for example "ban" or "deploy".', okLabel: 'Add' });
      if (w) { VipRules.addKeyword(w); redraw(); }
    }));
    add.append(this._btn('Add a panel', async () => {
      const s = await window.vexPrompt({ title: 'Add a VIP panel', message: 'The panel name, for example whatsapp.', okLabel: 'Add' });
      if (s) { VipRules.addSite(s); redraw(); }
    }));
    body.appendChild(add);

    // Needs me (T1-007)
    this._heading(body, 'Needs me');
    T('Needs me list', () => NeedsMe.enabled(), (v) => NeedsMe.setEnabled(v));
    const nm = this._el('div', 'setting-row');
    nm.append(this._btn('Open Needs me', () => this.openNeedsMe()));
    nm.append(this._btn('Forget what it learned', () => { NeedsMe.forgetLearning(); window.showToast?.('Forgotten'); }));
    body.appendChild(nm);

    // Panel state (T1-034)
    this._heading(body, 'Panel state and unread ledger');
    T('Show call, playing and unread state on panels', () => PanelState.enabled(), (v) => PanelState.setEnabled(v));
    T('Show a strip of panel state at the bottom', () => PanelState.stripOn(), (v) => PanelState.setStrip(v));
    const ps = this._el('div', 'setting-row');
    ps.append(this._btn('Open the ledger', () => this.openLedger()));
    body.appendChild(ps);

    // Away mode (T1-010)
    this._heading(body, 'Away mode');
    body.appendChild(VexSettingsGroups.note('While away Vex is quiet like in Focus, and when you come back it shows a five-line summary made on this computer.'));
    T('Allow away mode', () => AwayMode.enabled(), (v) => AwayMode.setEnabled(v));
    T('Go away by itself when Vex is locked', () => AwayMode.autoOnLock(), (v) => AwayMode.setAutoOnLock(v));

    // Delivery windows (T1-006)
    this._heading(body, 'Delivery windows');
    body.appendChild(VexSettingsGroups.note('Held items are told to you once, as one digest, at the times you choose, instead of one by one. Never during a game, a meeting, Focus or quiet hours.'));
    T('Use delivery windows', () => AttentionDigest.enabled(), (v) => AttentionDigest.setEnabled(v));
    T('Every hour and half hour', () => AttentionDigest.halfHours(), (v) => AttentionDigest.setHalfHours(v));
    T('When a Focus block ends', () => AttentionDigest.atFocusEnd(), (v) => AttentionDigest.setAtFocusEnd(v));
    const timesRow = this._el('div', 'setting-row');
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'input'; input.value = AttentionDigest.times().join(', ');
    input.placeholder = '12:30, 17:30'; input.setAttribute('aria-label', 'Digest times');
    input.addEventListener('change', () => this._guard(() => {
      const list2 = input.value.split(',').map(s => s.trim()).filter(Boolean);
      AttentionDigest.setTimes(list2);
      window.showToast?.('Digest times saved');
    }));
    timesRow.append(this._el('span', '', 'At these times:'), input);
    body.appendChild(timesRow);

    // Close-protect (T1-039)
    this._heading(body, 'Close-protect');
    body.appendChild(VexSettingsGroups.note('Asks once before closing a single tab that is playing sound, in a call, or holds text you typed. Reopen closed tab (Ctrl+Shift+T) still brings it back.'));
    T('Ask before closing a tab in use', () => CloseProtect.enabled(), (v) => CloseProtect.setEnabled(v));
  },
};

if (typeof window !== 'undefined') {
  window.PanelsCommsUI = PanelsCommsUI;
  window.NeedsMeUI = { open: () => PanelsCommsUI.openNeedsMe() };
  if (typeof document !== 'undefined') {
    document.addEventListener('vex:away-summary', (e) => PanelsCommsUI.showAwaySummary(e.detail));
    // A screen of this feature that is open shows a change at once.
    document.addEventListener('vex:panel-notification', () => PanelsCommsUI._redrawOpen('_notifDraw', 'panel-notifications-dialog'));
    document.addEventListener('vex:vip-changed', () => PanelsCommsUI._redrawOpen('_needsDraw', 'needs-me-dialog'));
  }
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'panels-comms', title: 'Panels and messages', keywords: 'discord whatsapp notifications vip needs me away digest close tab unread ledger call playing strip', render: (body) => PanelsCommsUI.render(body) });
  }
}
if (typeof window !== 'undefined' && typeof CommandBar !== 'undefined' && CommandBar.commands) {
  const add = (c) => { if (!CommandBar.commands.some(x => x.id === c.id)) CommandBar.commands.push({ ...c, action: () => PanelsCommsUI._guard(c.action) }); };
  add({ id: 'needs-me', label: 'Needs me', hint: 'Everything waiting on you, ranked, with the reason', icon: 'list',
    action: () => { if (!NeedsMe.enabled()) throw new Error('Needs me is switched off: Settings, Panels and messages'); return PanelsCommsUI.openNeedsMe(); } });
  add({ id: 'away-toggle', label: 'Go away / I am back', hint: 'Be quiet while away; on return, a five-line summary of what happened', icon: 'moon',
    action: () => {
      if (AwayMode.active()) { AwayMode.end(); return; }
      AwayMode.start('manual');
      window.showToast?.('Away. Press Ctrl+K and choose "Go away / I am back" to return.');
    } });
  add({ id: 'panel-notifications', label: 'Notifications from panels', hint: 'What Discord and WhatsApp said, kept on this computer', icon: 'bell', action: () => PanelsCommsUI.openNotifications() });
  add({ id: 'panel-ledger', label: 'Panel ledger', hint: 'How each panel\'s unread count moved', icon: 'clock', action: () => PanelsCommsUI.openLedger() });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PanelsCommsUI };
