// === Reminders tied to a page =================================================
//
// A time is the wrong trigger for "check this when the order page changes" or
// "do not let me close the tab before I have replied". A page reminder is a
// line of text on a page (or a whole site) that speaks up on one of three events:
//
//   visit   the next time you open that page, in any tab
//   leave   when the tab on that page goes somewhere else (the page changes)
//   close   when you close that tab without having pressed "Done with this page"
//
// and, if you chose one, offers an action on the notice: open a page, or run a
// command from Ctrl+K. The action is a button on the notice; it is never carried
// out for you. A reminder fires once. Only the address up to the "?" is kept, on
// this computer; private and Tor tabs are not watched.
//
//   Ctrl+K › Remind me about this page     make one for the page in front
//   Ctrl+K › Done with this page           clears the "close" reminders of this page
//   Ctrl+K › Page reminders                the list
//
//   VexPageReminders.normalize(url)            pure
//   VexPageReminders.matches(reminder, url)    pure

const VexPageReminders = {
  KEY: 'vex.pageReminders',
  PREF: 'vex.pageReminders.enabled',   // 'off': nothing is watched
  MAX: 60,
  ARM_MS: 60 * 1000,                   // a "visit" reminder ignores the page it was made on for a minute
  TRIGGERS: ['visit', 'leave', 'close'],
  TRIGGER_LABEL: { visit: 'next time I visit', leave: 'when the page changes', close: 'if I close the tab without Done' },

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- pure ----------------------------------------------------------------------------
  normalize(url) {
    let u;
    try { u = new URL(String(url == null ? '' : url)); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
    return u.protocol + '//' + u.host.toLowerCase() + u.pathname.replace(/\/+$/, '');
  },
  hostOf(url) { try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; } },
  matches(r, url) {
    if (!r || !url) return false;
    return r.scope === 'host' ? this.hostOf(url) === r.host : this.normalize(url) === r.url;
  },
  make({ text, url, scope, trigger, action, now = Date.now(), id } = {}, commands = []) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('Write what to remind you of');
    if (t.length > 140) throw new Error('Keep it to 140 characters');
    const n = this.normalize(url);
    if (!n) throw new Error('Only a web page can have a reminder');
    if (!this.TRIGGERS.includes(trigger)) throw new Error('Pick when it should speak up');
    const sc = scope === 'host' ? 'host' : 'url';
    let act = null;
    if (action && action.kind === 'open') {
      const target = this.normalize(action.value);
      if (!target) throw new Error('The page to open must be a web address');
      act = { kind: 'open', value: new URL(action.value).href.slice(0, 2048) };
    } else if (action && action.kind === 'command') {
      const cid = String(action.value || '');
      if (!cid || !commands.some(c => c.id === cid)) throw new Error('"' + cid + '" is not a command in Ctrl+K');
      act = { kind: 'command', value: cid };
    } else if (action && action.kind) throw new Error('Unknown action ' + action.kind);
    return { id: id || 'pr_' + now.toString(36) + Math.random().toString(36).slice(2, 6), text: t, url: n, host: this.hostOf(url), scope: sc, trigger, action: act, createdAt: now, armedAt: now + this.ARM_MS, doneAt: 0, firedAt: 0 };
  },

  // ---- storage -----------------------------------------------------------------------------
  list() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your page reminders could not be read: ' + err.message); }
    return (Array.isArray(v) ? v : []).filter(r => r && r.id && typeof r.text === 'string' && this.TRIGGERS.includes(r.trigger));
  },
  _save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(-this.MAX))); }
    catch (err) { throw new Error('Your page reminders could not be saved: ' + err.message); }
  },
  _commands() { return typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands) ? CommandBar.commands : []; },
  add(fields) {
    const list = this.list();
    if (list.filter(r => !r.firedAt && !r.doneAt).length >= this.MAX) throw new Error('That is ' + this.MAX + ' waiting page reminders; remove some first');
    const r = this.make(fields, this._commands());
    list.push(r);
    this._save(list);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('page-reminders');
    return r;
  },
  remove(id) {
    const list = this.list();
    if (!list.some(r => r.id === id)) throw new Error('That reminder is gone');
    this._save(list.filter(r => r.id !== id));
  },
  // "Done with this page": the "close" reminders for it will not speak up.
  markDone(url, now = Date.now()) {
    const list = this.list();
    let n = 0;
    for (const r of list) if (!r.firedAt && !r.doneAt && this.matches(r, url)) { r.doneAt = now; n++; }
    if (n) this._save(list);
    return n;
  },

  // ---- the events ------------------------------------------------------------------------------
  _tabUrl: new Map(),
  // -> the reminders that speak up for this change of address in this tab.
  onNavigate(tabId, newUrl, now = Date.now()) {
    const oldUrl = this._tabUrl.get(tabId) || '';
    this._tabUrl.set(tabId, newUrl);
    if (!this.enabled()) return [];
    const list = this.list();
    const hits = [];
    for (const r of list) {
      if (r.firedAt || r.doneAt) continue;
      if (r.trigger === 'leave' && oldUrl && this.matches(r, oldUrl) && !this.matches(r, newUrl)) hits.push(r);
      else if (r.trigger === 'visit' && now >= r.armedAt && this.matches(r, newUrl) && !(oldUrl && this.matches(r, oldUrl))) hits.push(r);
    }
    return this._fire(list, hits, now);
  },
  onClose(tabId, fallbackUrl, now = Date.now()) {
    const url = this._tabUrl.get(tabId) || fallbackUrl || '';
    this._tabUrl.delete(tabId);
    if (!this.enabled() || !url) return [];
    const list = this.list();
    const hits = list.filter(r => !r.firedAt && !r.doneAt && r.trigger === 'close' && this.matches(r, url));
    return this._fire(list, hits, now, url);
  },
  _fire(list, hits, now, closedUrl) {
    if (!hits.length) return [];
    for (const r of hits) r.firedAt = now;
    this._save(list);
    for (const r of hits) this._speak(r, closedUrl);
    return hits;
  },
  _speak(r, closedUrl) {
    const actions = [];
    if (r.action && r.action.kind === 'open') actions.push({ label: 'Open the page', run: () => { try { TabManager.createTab(r.action.value, true); } catch (err) { window.showToast?.(err.message, 'error'); } } });
    if (r.action && r.action.kind === 'command') {
      const cmd = this._commands().find(c => c.id === r.action.value);
      actions.push({ label: 'Run ' + (cmd ? cmd.label : r.action.value), run: async () => { try { if (!cmd) throw new Error('"' + r.action.value + '" is not a command any more'); await cmd.action(); } catch (err) { window.showToast?.(err.message, 'error'); } } });
    }
    if (r.trigger === 'close' && closedUrl) actions.push({ label: 'Reopen the page', run: () => { try { TabManager.createTab(closedUrl, true); } catch (err) { window.showToast?.(err.message, 'error'); } } });
    const title = r.text;
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    // You asked to be told about this page, so it is the "asked" class.
    VexAttention.notify({ feature: 'page-reminders', label: 'Page reminders', urgency: 'asked', id: r.id, title }, () => window.showToast?.(title, 'info', 15000, actions.length ? { actions: actions.slice(0, 2) } : undefined));
  },

  // ---- the screens ------------------------------------------------------------------------------
  make_dialog() {
    if (!this.enabled()) { window.showToast?.('Page reminders are switched off in Settings', 'info'); return; }
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!t || !this.normalize(t.url)) { window.showToast?.('Open a web page first', 'error'); return; }
    if (t.partition && t.partition !== 'persist:main' && !/^persist:container-/.test(t.partition)) { window.showToast?.('Private and Tor tabs are not watched', 'error'); return; }
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-page-reminder', title: 'Remind me about this page', sub: t.url.length > 90 ? t.url.slice(0, 90) + '…' : t.url });
    const mk = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const text = mk('input', { type: 'text', maxLength: 140, placeholder: 'Reply to the landlord before leaving' }); text.setAttribute('aria-label', 'Reminder');
    const trig = mk('select'); trig.setAttribute('aria-label', 'When');
    for (const k of this.TRIGGERS) trig.append(new Option(this.TRIGGER_LABEL[k], k));
    const scope = mk('select'); scope.setAttribute('aria-label', 'For');
    scope.append(new Option('this page', 'url'), new Option('this whole site', 'host'));
    const act = mk('select'); act.setAttribute('aria-label', 'Offer an action');
    act.append(new Option('no action', ''), new Option('offer to open a page', 'open'), new Option('offer to run a command', 'command'));
    const val = mk('input', { type: 'text', placeholder: 'https://… or a command', hidden: true }); val.setAttribute('aria-label', 'Action target'); val.setAttribute('list', 'vex-pr-cmds');
    const dl = mk('datalist', { id: 'vex-pr-cmds' }); for (const c of this._commands().slice(0, 400)) dl.append(new Option(c.id, c.id));
    act.addEventListener('change', () => { val.hidden = !act.value; val.placeholder = act.value === 'open' ? 'https://…' : 'command id, like due-now'; });
    const form = mk('div'); form.className = 'vexsr-rule'; form.style.flexWrap = 'wrap';
    form.append(text, trig, scope, act, val, dl);
    body.appendChild(form);
    body.appendChild(VexSettingsGroups.note('The action appears as a button on the notice. Vex does not carry it out for you.'));
    body.appendChild(VexSettingsGroups.button('Save', () => {
      try {
        this.add({ text: text.value, url: t.url, scope: scope.value, trigger: trig.value, action: act.value ? { kind: act.value, value: val.value } : null });
        close();
        window.showToast?.('Saved: ' + this.TRIGGER_LABEL[trig.value], 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true }));
    text.focus();
  },
  doneHere() {
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!t) { window.showToast?.('Open a page first', 'error'); return; }
    try {
      const n = this.markDone(t.url);
      window.showToast?.(n ? n + ' reminder' + (n === 1 ? '' : 's') + ' cleared for this page' : 'No waiting reminder for this page', 'info');
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },
  open() {
    if (!this.enabled()) { window.showToast?.('Page reminders are switched off in Settings', 'info'); return; }
    const { body } = VexSettingsGroups.dialog({ id: 'vex-page-reminders', title: 'Page reminders', sub: 'Each speaks up once. Remove the ones you no longer need.' });
    const draw = () => {
      body.textContent = '';
      let list; try { list = this.list(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      if (!list.length) body.appendChild(VexSettingsGroups.note('None yet. Open a page and run Ctrl+K › Remind me about this page.'));
      for (const r of list.slice().reverse()) {
        const row = document.createElement('div'); row.className = 'vexsr-rule';
        const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal';
        t.textContent = r.text + '  (' + this.TRIGGER_LABEL[r.trigger] + ', ' + (r.scope === 'host' ? r.host : r.url) + (r.firedAt ? ', spoke up' : r.doneAt ? ', marked done' : ', waiting') + ')';
        row.append(t, VexSettingsGroups.button('Remove', () => { try { this.remove(r.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove: ' + r.text }));
        body.appendChild(row);
      }
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Attach a reminder to a page or site. It speaks up the next time you visit it, when the page changes, or if you close its tab without pressing Done, with an optional button to open a page or run a command. Private and Tor tabs are not watched.'));
    el.appendChild(VexSettingsGroups.button('Remind me about this page', () => this.make_dialog(), { primary: true }));
    el.appendChild(VexSettingsGroups.button('See page reminders', () => this.open()));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof TabManager !== 'undefined') for (const t of TabManager.tabs) if (t.url) this._tabUrl.set(t.id, t.url);
    document.addEventListener('vex:tab-navigated', (e) => {
      const d = e.detail || {};
      if (d.failed || !d.tabId || !d.url) return;
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === d.tabId) : null;
      if (tab && tab.partition && tab.partition !== 'persist:main' && !/^persist:container-/.test(tab.partition)) return;
      try { this.onNavigate(d.tabId, d.url); }
      catch (err) { window.VexProblems?.note('Page reminders', 'A page reminder could not be checked', err); }
    });
    document.addEventListener('vex:tab-closed', (e) => {
      const id = e.detail && e.detail.tabId;
      if (!id) return;
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === id) : null;
      if (tab && tab.partition && tab.partition !== 'persist:main' && !/^persist:container-/.test(tab.partition)) { this._tabUrl.delete(id); return; }
      try { this.onClose(id, tab && tab.url); }
      catch (err) { window.VexProblems?.note('Page reminders', 'A page reminder could not be checked', err); }
    });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexPageReminders = VexPageReminders;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'page-reminders', title: 'Page reminders', keywords: 'page reminder url visit close tab leave change done action command', before: 'about', build: (el) => VexPageReminders.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'page-reminder', label: 'Remind me about this page', hint: 'Speaks up on your next visit, when the page changes, or if you close the tab without Done', icon: 'bell', action: () => VexPageReminders.make_dialog() });
    VexExtras.registerCommand({ id: 'page-reminder-done', label: 'Done with this page', hint: 'Clears the close-without-done reminders for the page in front', icon: 'check', action: () => VexPageReminders.doneHere() });
    VexExtras.registerCommand({ id: 'page-reminders', label: 'Page reminders', hint: 'The reminders tied to pages and sites', icon: 'bell', action: () => VexPageReminders.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPageReminders };
