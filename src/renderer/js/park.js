// === Park and resume ==========================================================
//
// Switching context costs minutes of "where was I?". Ctrl+K › Park writes one
// line and keeps, under the current workspace, the tabs that were open, which
// one was in front and how far down it was scrolled. Coming back to that
// workspace shows a small card with the line and a Resume button until you
// dismiss it.
//
//   Park           Ctrl+K › Park: one line  (asks for the line; Esc cancels)
//   Resume         reopens the parked tabs next to the ones you have (nothing is
//                  closed), the front tab at its scroll position
//   Parked cards   Ctrl+K › Parked cards: the list, Resume or Remove each
//
// Both Park and Resume are written to the Ledger ("Why did that happen?") with
// an Undo: undoing a park removes the card, undoing a resume closes the tabs it
// opened. Private and Tor tabs are never kept (they are not part of a
// workspace either). Cards stay on this computer; they are not synced.
//
//   VexPark.capture(note, tabs, active, scroll, wsId, now)   pure: a card
//   VexPark.cardFor(cards, wsId)                             pure: the one to show

const VexPark = {
  KEY: 'vex.park',               // [card]
  PREF: 'vex.park.enabled',      // 'off' hides the commands and the card
  MAX_CARDS: 20,
  MAX_TABS: 40,
  MAX_NOTE: 200,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    if (!on) this.hideBanner();
    return !!on;
  },

  // ---- pure ----------------------------------------------------------------------
  capture({ note, tabs, activeUrl, scroll, wsId, wsName, now = Date.now(), id }) {
    const text = String(note == null ? '' : note).replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Write one line about where you are');
    if (text.length > this.MAX_NOTE) throw new Error('Keep it to one line: ' + this.MAX_NOTE + ' characters at most');
    if (!wsId) throw new Error('There is no workspace to park under');
    const list = (Array.isArray(tabs) ? tabs : []).filter(t => t && /^(https?|file):/i.test(String(t.url || ''))).slice(0, this.MAX_TABS)
      .map(t => ({ url: String(t.url).slice(0, 2048), title: String(t.title || t.url).slice(0, 160) }));
    const front = list.findIndex(t => t.url === activeUrl);
    const sc = scroll && Number.isFinite(scroll.x) && Number.isFinite(scroll.y) ? { x: Math.max(0, scroll.x), y: Math.max(0, scroll.y) } : null;
    return { id: id || 'pk_' + now.toString(36) + Math.random().toString(36).slice(2, 6), wsId, wsName: String(wsName || '').slice(0, 60), note: text, at: now, tabs: list, front: front >= 0 ? front : 0, scroll: front >= 0 ? sc : null, dismissedAt: 0, resumedAt: 0 };
  },
  // Newest card of the workspace that is neither resumed nor dismissed.
  cardFor(cards, wsId) {
    return (Array.isArray(cards) ? cards : []).filter(c => c && c.wsId === wsId && !c.resumedAt && !c.dismissedAt).sort((a, b) => b.at - a.at)[0] || null;
  },

  // ---- storage --------------------------------------------------------------------
  cards() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The parked cards could not be read: ' + err.message); }
    return Array.isArray(v) ? v.filter(c => c && c.id && Array.isArray(c.tabs)) : [];
  },
  _save(list) {
    const kept = list.slice().sort((a, b) => b.at - a.at).slice(0, this.MAX_CARDS);
    localStorage.setItem(this.KEY, JSON.stringify(kept));
    return kept;
  },
  _patch(id, patch) {
    const list = this.cards();
    const c = list.find(x => x.id === id);
    if (!c) throw new Error('That parked card is gone');
    Object.assign(c, patch);
    this._save(list);
    return c;
  },
  remove(id) {
    const list = this.cards();
    const card = list.find(x => x.id === id);
    if (!card) return null;
    this._save(list.filter(x => x.id !== id));
    return card;
  },

  // ---- park -----------------------------------------------------------------------------
  async _frontScroll() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
    const wv = WebviewManager.getActiveWebview?.();
    if (!wv || typeof wv.executeJavaScript !== 'function') return null;
    const pos = await Promise.race([
      wv.executeJavaScript('({x: window.scrollX, y: window.scrollY})'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('the page did not answer in time')), 800)),
    ]);
    return pos;
  },

  async park(note) {
    if (typeof TabManager === 'undefined' || typeof WorkspaceManager === 'undefined') throw new Error('Tabs are not loaded');
    const policy = window.VexTabPolicy;
    const tabs = TabManager.tabs.filter(t => !policy || policy.canRestore(t));
    const front = TabManager.getActiveTab?.();
    let scroll = null;
    try { scroll = await this._frontScroll(); }
    catch (err) { window.VexProblems?.note('Park', 'Parked without the scroll position of the front tab', err); }
    const ws = WorkspaceManager.getActive() || {};
    const card = this.capture({ note, tabs, activeUrl: front && front.url, scroll, wsId: WorkspaceManager.activeId, wsName: ws.name });
    this._save([card, ...this.cards()]);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('park-resume');
    VexLedger.note({ feature: 'park-resume', what: 'Parked "' + card.note.slice(0, 80) + '" with ' + card.tabs.length + ' tab' + VexPlural.s(card.tabs.length), why: 'You asked to park where you were in ' + (card.wsName || 'this workspace'), undo: { kind: 'park-delete', id: card.id } });
    return card;
  },

  async resume(id, { now = Date.now() } = {}) {
    const card = this.cards().find(c => c.id === id);
    if (!card) throw new Error('That parked card is gone');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    if (!card.tabs.length) throw new Error('That card holds no tabs to reopen');
    const opened = [];
    card.tabs.forEach((t, i) => {
      const isFront = i === card.front;
      const tabId = TabManager.createTab(t.url, isFront, null, { allowDuplicate: true, ...(isFront && card.scroll ? { scrollPosition: card.scroll } : {}) });
      if (tabId) opened.push(tabId);
    });
    this._patch(id, { resumedAt: now });
    this.hideBanner();
    VexLedger.note({ feature: 'park-resume', what: 'Resumed "' + card.note.slice(0, 80) + '" (' + opened.length + ' tabs)', why: 'You pressed Resume on a parked card', undo: { kind: 'park-unresume', id, tabIds: opened } });
    return opened;
  },

  // ---- the card on return -----------------------------------------------------------------
  hideBanner() { document.getElementById('vex-park-banner')?.remove(); },
  showBannerFor(wsId) {
    this.hideBanner();
    if (!this.enabled()) return false;
    const card = this.cardFor(this.cards(), wsId);
    if (!card) return false;
    const el = document.createElement('div');
    el.id = 'vex-park-banner';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9000;max-width:min(420px,90vw);display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px var(--vex-shadow-color,rgba(0,0,0,0.4))';
    const text = document.createElement('span');
    text.style.cssText = 'flex:1 1 180px;font-size:13px';
    text.textContent = 'You parked: ' + card.note;
    const go = VexSettingsGroups.button('Resume', () => { this.resume(card.id).catch(err => window.showToast?.(err.message, 'error')); }, { primary: true, label: 'Resume where you were' });
    const no = VexSettingsGroups.button('Dismiss', () => { try { this._patch(card.id, { dismissedAt: Date.now() }); } catch (err) { window.showToast?.(err.message, 'error'); } this.hideBanner(); }, { label: 'Dismiss the parked card' });
    el.append(text, go, no);
    document.body.appendChild(el);
    return true;
  },

  // ---- the list -------------------------------------------------------------------------------
  open() {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-park', title: 'Parked cards', sub: 'Where you were, kept under each workspace. Resume reopens the tabs next to the ones you have.' });
    const draw = () => {
      body.textContent = '';
      let cards;
      try { cards = this.cards(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      if (!cards.length) body.appendChild(VexSettingsGroups.note('Nothing is parked. Ctrl+K › Park: one line.'));
      for (const c of cards.sort((a, b) => b.at - a.at)) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = c.note + '  (' + (c.wsName || 'workspace') + ', ' + c.tabs.length + ' tabs, ' + new Date(c.at).toLocaleString() + (c.resumedAt ? ', resumed' : '') + ')';
        const go = VexSettingsGroups.button('Resume', () => { this.resume(c.id).then(draw, err => window.showToast?.(err.message, 'error')); }, { label: 'Resume ' + c.note });
        const rm = VexSettingsGroups.button('Remove', () => { try { this.remove(c.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove ' + c.note });
        row.append(text, go, rm);
        body.appendChild(row);
      }
    };
    draw();
  },

  async parkCommand() {
    if (!this.enabled()) { window.showToast?.('Park is switched off in Settings', 'info'); return; }
    const note = await window.vexPrompt({ title: 'Park where you are', message: 'One line: what you were doing and what comes next. Your open tabs are kept with it.', placeholder: 'Reading the UEFI spec, next: section 7.2', okLabel: 'Park' });
    if (note == null) return;
    try {
      const card = await this.park(note);
      window.showToast?.('Parked: ' + card.note, 'info', 5000);
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    VexLedger.registerUndo('park-delete', async (token) => { if (!this.remove(token.id)) throw new Error('That parked card is already gone'); });
    VexLedger.registerUndo('park-unresume', async (token) => {
      for (const id of token.tabIds || []) if (TabManager.tabs.some(t => t.id === id)) TabManager.closeTab(id);
      this._patch(token.id, { resumedAt: 0, dismissedAt: 0 });
    });
    document.addEventListener('vex:workspace-switched', (e) => this.showBannerFor((e.detail && e.detail.id) || WorkspaceManager.activeId));
    if (typeof WorkspaceManager !== 'undefined') this.showBannerFor(WorkspaceManager.activeId);
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Park a line and your open tabs under the current workspace; a small card brings you back to it. Ctrl+K › Park: one line.'));
    el.appendChild(VexSettingsGroups.button('Park where I am', () => this.parkCommand(), { primary: true }));
    el.appendChild(VexSettingsGroups.button('See parked cards', () => this.open()));
  },
};

if (typeof window !== 'undefined') {
  window.VexPark = VexPark;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'park-resume', title: 'Park and resume', keywords: 'park resume where i was context switch tabs card banner', before: 'about', build: (el) => VexPark.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'park-here', label: 'Park: one line', hint: 'Keep where you are and the open tabs, come back with one click', icon: 'pin', action: () => VexPark.parkCommand() });
    VexExtras.registerCommand({ id: 'park-list', label: 'Parked cards', hint: 'Resume or remove what you parked', icon: 'pin', action: () => VexPark.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPark };
