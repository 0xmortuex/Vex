// === Why am I here ==========================================================
//
// Twenty tabs in, a tab with no obvious purpose is either a thing you still
// need or a thing you forgot. A tab can hold a one-line reason ("waiting on
// the quote", "compare with the other one") — the note a tab already has
// (Tab menu › Add a note to this tab, or Ctrl+K › Why Am I Here). This file
// adds two things to it:
//
//   * the reason is in the tooltip of the tab, after its title;
//   * a tab you come back to after a week (7 days; 3 to 30 in Settings) says
//     what you opened it for and asks whether it is still needed: keep it,
//     change the reason, or close the tab.
//
// When each tab was last in front is kept on this computer in localStorage,
// by tab id, and never for a private, off-the-record, Tor or routed tab: those
// are refused here, the same way Clipboard History and price history refuse
// them (js/tab-policy.js canReadWebview).
const VexTabReason = {
  KEY: 'vex.tabReasons',
  PREFS_KEY: 'vex.tabReasons.prefs',
  MAX_TABS: 300,
  DAY_MS: 86400000,
  DEFAULT_PREFS: { revisit: true, days: 7 },

  cleanPrefs(p) {
    const o = (p && typeof p === 'object') ? p : {};
    const d = Math.round(Number(o.days));
    return {
      revisit: o.revisit === undefined ? this.DEFAULT_PREFS.revisit : o.revisit === true,
      days: Number.isFinite(d) ? Math.min(30, Math.max(3, d)) : this.DEFAULT_PREFS.days,
    };
  },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREFS_KEY) || 'null'); } catch { raw = null; }
    return this.cleanPrefs(raw);
  },
  savePrefs(patch) {
    const next = this.cleanPrefs({ ...this.prefs(), ...patch });
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(next));
    return next;
  },

  // Whether this tab's reason may be kept and shown here. A tab in a session
  // of its own (a private window, off-the-record, Tor, a route or a container
  // with one) is not.
  capturable(tab) {
    if (!tab) return false;
    const pol = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    const part = String(tab.partition || '');
    if (part && !part.startsWith('persist:')) return false;
    if (!pol) return !part || part.startsWith('persist:');
    if (pol.isPrivateWindow) return false;
    return !pol.isRouted(part || 'persist:main');
  },

  // ---- the store: { tabId: { text, at, seen } } ----
  all() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch (err) { throw new Error('The reasons you gave your tabs could not be read', { cause: err }); }
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  },
  _save(all) {
    const ids = Object.keys(all);
    if (ids.length > this.MAX_TABS) {
      ids.sort((a, b) => (all[a].seen || 0) - (all[b].seen || 0)).slice(0, ids.length - this.MAX_TABS).forEach(id => delete all[id]);
    }
    localStorage.setItem(this.KEY, JSON.stringify(all));
  },

  _tab(id) {
    return (typeof TabManager !== 'undefined' && TabManager.tabs) ? TabManager.tabs.find(t => t.id === id) || null : null;
  },

  reasonOf(tab) { return this.capturable(tab) ? String((tab && tab.note) || '').trim() : ''; },

  // The words added to a tab's tooltip, or ''.
  tooltip(tab) {
    const r = this.reasonOf(tab);
    return r ? 'Why: ' + r : '';
  },

  // The tab was in front at `now`. Returns what to ask, or null:
  //   { tab, text, days }   the reason, and how long it has been
  touch(tab, now = Date.now()) {
    if (!tab || !tab.id) return null;
    const text = this.reasonOf(tab);
    const all = this.all();
    const e = all[tab.id];
    if (!text) {
      if (e) { delete all[tab.id]; this._save(all); }
      return null;
    }
    // A reason that has changed since it was recorded is a new reason: it
    // starts counting from now.
    if (!e || e.text !== text) {
      all[tab.id] = { text, at: now, seen: now };
      this._save(all);
      return null;
    }
    const p = this.prefs();
    const gap = now - (e.seen || e.at || now);
    e.seen = now;
    this._save(all);
    if (!p.revisit || gap < p.days * this.DAY_MS) return null;
    return { tab, text, days: Math.floor(gap / this.DAY_MS) };
  },

  forget(tabId) {
    const all = this.all();
    if (!(tabId in all)) return false;
    delete all[tabId];
    this._save(all);
    return true;
  },
  forgetAll() { localStorage.removeItem(this.KEY); },

  // ---- asking ----
  ask(due) {
    if (typeof window === 'undefined' || typeof window.showToast !== 'function') return null;
    const id = due.tab.id;
    const short = due.text.length > 70 ? due.text.slice(0, 69) + '…' : due.text;
    return window.showToast('You opened this tab ' + due.days + ' days ago for: ' + short, 'info', 15000, {
      actions: [
        { label: 'Still needed', title: 'Keep the tab and the reason', run: () => {} },
        { label: 'Change the reason', title: 'Say why it is open now', run: () => { this._edit(id); } },
        { label: 'Close the tab', title: 'You are done with it', run: () => { try { TabManager.closeTab(id); } catch (err) { window.showToast('That tab could not be closed: ' + err.message, 'error'); } } },
      ],
    });
  },

  async _edit(id) {
    try {
      const text = await TabManager.editTabNote(id);
      const tab = this._tab(id);
      if (text !== null && tab) this.touch(tab);
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },

  // Ctrl+K › Why Am I Here.
  async editActive() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab) throw new Error('Open a tab first');
    if (!this.capturable(tab)) throw new Error('A private, off-the-record or Tor tab does not keep a reason');
    await this._edit(tab.id);
  },

  onActivated(tabId) {
    const tab = this._tab(tabId);
    if (!tab) return null;
    let due = null;
    try { due = this.touch(tab); }
    catch (err) { console.error('[TabReason]', err); return null; }
    if (due) this.ask(due);
    return due;
  },

  // ---- wiring, Settings, command ----
  buildSettings(body) {
    const G = window.VexSettingsGroup;
    const p = this.prefs();
    body.append(G.toggle('Ask about a tab I come back to after a while', p.revisit, (on) => { this.savePrefs({ revisit: on }); }));
    const days = document.createElement('input');
    days.type = 'number'; days.min = '3'; days.max = '30'; days.value = String(p.days); days.className = 'set-input'; days.style.maxWidth = '90px';
    days.addEventListener('change', () => { this.savePrefs({ days: days.value }); G.refresh('settings-tabreason'); });
    body.append(G.field('After this many days', days));
    let n = 0;
    try { n = Object.keys(this.all()).length; } catch (err) { body.append(G.note(err.message)); }
    body.append(G.note(n + ' tab' + (n === 1 ? '' : 's') + ' with a reason noted. Kept on this computer only, and never for private, off-the-record or Tor tabs.'));
    body.append(G.button('Forget when I last saw each tab', async () => {
      try {
        if (!(await window.vexConfirm({ title: 'Forget these dates?', message: 'The reasons stay on your tabs; only the record of when you last had each one in front goes.', okLabel: 'Forget', danger: true }))) return;
        this.forgetAll();
        G.refresh('settings-tabreason');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, 'danger'));
  },

  mount() {
    window.addEventListener('vex:tab-activated', (e) => { if (e && e.detail) this.onActivated(e.detail.tabId); });
    document.addEventListener('vex:tab-closed', (e) => {
      try { if (e && e.detail) this.forget(e.detail.tabId); } catch (err) { console.error('[TabReason]', err); }
    });
    if (window.VexSettingsGroup) {
      window.VexSettingsGroup.add({ id: 'settings-tabreason', title: 'Why a tab is open', info: 'A tab’s one-line reason shows in its tooltip, and a tab you return to after a week asks whether it is still needed.', build: (body) => this.buildSettings(body) });
    }
    if (typeof CommandBar !== 'undefined' && CommandBar.commands && !CommandBar.commands.some(c => c.id === 'tab-reason')) {
      CommandBar.commands.push({ id: 'tab-reason', label: 'Why Am I Here (Note on This Tab)', hint: 'One line on why this tab is open — shown when you hover it, and asked about again if you come back after a week', icon: 'note',
        action: async () => { try { await this.editActive(); } catch (err) { window.showToast?.(err.message, 'error'); } } });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexTabReason = VexTabReason;
  if (typeof document !== 'undefined' && document.getElementById('command-overlay')) VexTabReason.mount();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabReason };
