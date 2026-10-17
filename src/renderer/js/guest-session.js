// === Guest session / public-computer mode (T3-116) ===========================
//
// A window that keeps nothing, for a library computer, a friend's laptop or a
// moment you do not want kept. It is Vex's existing private window (its own
// in-memory session: no history, no saved passwords or autofill, no sync, no
// recall index, no extensions, nothing written to the profile; the main process
// refuses those channels there and the window forgets all of it when it
// closes) with two things added so it cannot be mistaken for a normal window:
//   * a "Guest session" label that stays on screen, and
//   * "Forget this session": a receipt of what is about to be erased (tabs and
//     sites seen in this window), then the window closes.
//
// What it does NOT do: it does not hide you from the network, the computer's
// owner or the sites you visit, it does not clear the computer's DNS cache or
// Windows' own records, and it cannot erase a file you chose to download or
// save (those go where you put them). docs/security-tier3-threat-notes.md.
//
// The switch below only controls whether Ctrl+K offers "Guest session" in the
// main window; the label and the receipt always work in a window opened as a guest.
const VexGuest = {
  ENABLED_KEY: 'vex.guest.enabled',

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[Guest] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // True in a window opened by open-guest-window (main adds guest=true to its address).
  isGuestWindow() {
    try { return /[?&]guest=true(?:&|$)/.test(String(window.location.search)); }
    catch (err) { console.error('[Guest] the window address could not be read:', err); return false; }
  },

  // ---- pure ---------------------------------------------------------------------------
  // The distinct sites (host names) of a list of addresses, in order of first sight.
  hostsOf(urls) {
    const seen = new Set();
    for (const u of urls) {
      let h = '';
      try { const x = new URL(String(u)); if (x.protocol === 'http:' || x.protocol === 'https:') h = x.hostname.replace(/^www\./, ''); }
      catch { h = ''; }
      if (h) seen.add(h);
    }
    return [...seen];
  },
  // What the receipt says is about to go. tabs: number open now; hosts: sites seen in this window.
  receipt({ tabs, hosts }) {
    const t = Math.max(0, Number(tabs) || 0);
    const h = Array.isArray(hosts) ? hosts : [];
    return [
      t + (t === 1 ? ' open tab' : ' open tabs'),
      h.length + (h.length === 1 ? ' site' : ' sites') + ' visited in this window',
      'Cookies, logins, form entries, cache and history of this window',
      'Nothing was saved to this computer\'s Vex profile, so there is nothing else to clear',
    ];
  },

  // ---- main window: open one --------------------------------------------------------------
  async open() {
    if (!this.enabled()) throw new Error('Guest session is switched off in Settings');
    if (!window.vex || typeof window.vex.openGuestWindow !== 'function') throw new Error('This window cannot open a guest session');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('guest-session');
    const look = typeof VexGuiStyle !== 'undefined' ? VexGuiStyle.get() : undefined;
    const mode = typeof VexSimpleMode !== 'undefined' ? VexSimpleMode.mode() : undefined;
    await window.vex.openGuestWindow(look, mode);
  },

  // ---- throwaway workspace (in THIS window) ----------------------------------------------------
  // A set of tabs that share ONE in-memory session ("otr-throwaway-..."): a login made in one of them is
  // there in the others, nothing is written to the profile (no history, no restore, no sync), and when the last
  // of them closes, main erases the session's cookies, storage and cache (src/main/session-security.js).
  // "Erase it now" shows what goes (tabs, sites) and closes them all. It is not hidden from the network,
  // from the sites or from anything you download or save to disk.
  _tw: null,
  _twHosts: new Set(),
  throwawayActive() { return !!this._tw; },
  throwawayTabs() {
    if (!this._tw || typeof TabManager === 'undefined' || !Array.isArray(TabManager.tabs)) return [];
    return TabManager.tabs.filter(t => t && t.partition === this._tw.partition);
  },
  _twSample() { for (const t of this.throwawayTabs()) this._twHosts.add(t.url); },
  // Pure: the name of a new throwaway session.
  newPartition(now = Date.now(), rnd = Math.random()) {
    return 'otr-throwaway-' + now.toString(36) + rnd.toString(36).slice(2, 6);
  },
  startThrowaway(url) {
    if (!this.enabled()) throw new Error('Guest session is switched off in Settings');
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not loaded');
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) throw new Error('This window is already private, so nothing in it is kept');
    if (this._tw) return this.newThrowawayTab(url);
    this._tw = { partition: this.newPartition(), startedAt: Date.now() };
    this._twHosts = new Set();
    if (typeof VexUsage !== 'undefined') VexUsage.touch('guest-session');
    const id = TabManager.createTab(url || undefined, true, null, { partition: this._tw.partition });
    this._twBadge();
    this.registerCommands();
    return id;
  },
  newThrowawayTab(url) {
    if (!this._tw) throw new Error('There is no throwaway workspace open');
    const id = TabManager.createTab(url || undefined, true, null, { partition: this._tw.partition });
    this._twBadge();
    return id;
  },
  twReceipt() {
    this._twSample();
    return this.receipt({ tabs: this.throwawayTabs().length, hosts: this.hostsOf([...this._twHosts]) })
      .map(l => l.replace('visited in this window', 'visited in this workspace').replace('of this window', 'of this workspace').replace(/Nothing was saved.*/, 'Nothing from it was saved to your Vex profile'));
  },
  async eraseThrowaway() {
    if (!this._tw) throw new Error('There is no throwaway workspace open');
    const lines = this.twReceipt();
    const go = await window.vexConfirm({
      title: 'Erase the throwaway workspace?',
      message: 'These tabs will close and this will be erased:\n- ' + lines.join('\n- '),
      okLabel: 'Erase and close',
      danger: true,
    });
    if (!go) return false;
    for (const t of this.throwawayTabs()) TabManager.closeTab(t.id);
    this._twEnded();
    return true;
  },
  // The last tab of the workspace is gone (closed one by one, or erased): main clears the session; forget it here.
  _twEnded() {
    if (!this._tw) return;
    this._tw = null;
    this._twHosts = new Set();
    document.getElementById('vex-throwaway-badge')?.remove();
    this.registerCommands();
    window.showToast?.('The throwaway workspace was erased', 'success');
  },
  _twCheck() {
    if (!this._tw) return;
    if (!this.throwawayTabs().length) this._twEnded(); else this._twBadge();
  },
  _twBadge() {
    let el = document.getElementById('vex-throwaway-badge');
    const n = this.throwawayTabs().length;
    if (!el) {
      el = document.createElement('div');
      el.id = 'vex-throwaway-badge';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:100045;display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;font-size:12px;box-shadow:0 6px 20px var(--vex-shadow-color,rgba(0,0,0,0.35))';
      const icon = document.createElement('span');
      icon.style.cssText = 'display:inline-flex;line-height:0';
      if (typeof VexIcons !== 'undefined') icon.innerHTML = VexIcons.svg('user', { size: 14 });
      const text = document.createElement('span');
      text.className = 'vex-tw-text';
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'btn-secondary'; add.style.cssText = 'padding:3px 8px;font-size:11.5px';
      add.textContent = 'New tab here';
      add.addEventListener('click', () => { try { this.newThrowawayTab(); } catch (err) { window.showToast?.(err.message, 'error'); } });
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn-secondary'; btn.style.cssText = 'padding:3px 8px;font-size:11.5px';
      btn.textContent = 'Erase it now';
      btn.addEventListener('click', () => { this.eraseThrowaway().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); });
      el.append(icon, text, add, btn);
      document.body.appendChild(el);
      VexLayer.track(el, { tier: 'toast', id: 'throwaway-badge' });
    }
    el.querySelector('.vex-tw-text').textContent = 'Throwaway workspace (' + n + (n === 1 ? ' tab' : ' tabs') + '): erased when the last tab closes';
  },

  // ---- guest window: the label and the receipt ----------------------------------------------
  _seen: new Set(),
  _sample() {
    if (typeof TabManager === 'undefined' || !Array.isArray(TabManager.tabs)) return;
    for (const t of TabManager.tabs) if (t && t.url) this._seen.add(t.url);
  },
  tabCount() { return typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs) ? TabManager.tabs.length : 0; },

  showBadge() {
    if (document.getElementById('vex-guest-badge')) return;
    const el = document.createElement('div');
    el.id = 'vex-guest-badge';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:100045;display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;font-size:12px;box-shadow:0 6px 20px var(--vex-shadow-color,rgba(0,0,0,0.35))';
    const icon = document.createElement('span');
    icon.style.cssText = 'display:inline-flex;line-height:0';
    if (typeof VexIcons !== 'undefined') icon.innerHTML = VexIcons.svg('user', { size: 14 });
    const text = document.createElement('span');
    text.textContent = 'Guest session: nothing here is saved';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary';
    btn.style.cssText = 'padding:3px 8px;font-size:11.5px';
    btn.textContent = 'Forget this session';
    btn.addEventListener('click', () => { this.forget().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); });
    el.append(icon, text, btn);
    document.body.appendChild(el);
    VexLayer.track(el, { tier: 'toast', id: 'guest-badge' });
  },

  async forget() {
    if (!this.isGuestWindow()) throw new Error('This is not a guest window');
    this._sample();
    const lines = this.receipt({ tabs: this.tabCount(), hosts: this.hostsOf([...this._seen]) });
    const go = await window.vexConfirm({
      title: 'Forget this guest session?',
      message: 'This window will close and erase:\n- ' + lines.join('\n- '),
      okLabel: 'Erase and close',
      danger: true,
    });
    if (!go) return false;
    if (!window.vex || typeof window.vex.close !== 'function') throw new Error('The window could not be closed');
    window.vex.close();
    return true;
  },

  // ---- Ctrl+K and Settings ---------------------------------------------------------------------
  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const list = [];
    if (this.enabled()) {
      list.push({ id: 'guest:open', label: 'Guest session', icon: 'user', hint: 'A window that keeps nothing, for a public computer', action: () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } });
    }
    if (this.enabled() && !(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow)) {
      list.push({ id: 'guest:throwaway', label: this._tw ? 'New tab in the throwaway workspace' : 'Throwaway workspace', icon: 'user', hint: 'Tabs that share one session which is erased when the last one closes', action: () => { try { this.startThrowaway(); } catch (err) { window.showToast?.(err.message, 'error'); } } });
      if (this._tw) list.push({ id: 'guest:throwaway-erase', label: 'Erase the throwaway workspace', icon: 'trash', hint: 'Shows what will be erased, then closes its tabs', action: () => { this.eraseThrowaway().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } });
    }
    if (this.isGuestWindow()) {
      list.push({ id: 'guest:forget', label: 'Forget this guest session', icon: 'trash', hint: 'Shows what will be erased, then closes the window', action: () => { this.forget().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } });
    }
    VexModuleCommands.set('guest:', list);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('A window that keeps nothing: no history, saved passwords, autofill or sync, and everything is erased when it closes. It is a private window with a clear "Guest session" label and a receipt before it is erased. It does not hide you from the network, and files you download stay where you save them.'));
    body.appendChild(S.toggle('Guest session', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch('guest-session'); }, 'Ctrl+K > Guest session'));
    if (this.enabled()) body.appendChild(S.button('Start a throwaway workspace', () => { try { this.startThrowaway(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
    if (this.enabled()) body.appendChild(S.button('Open a guest session', () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); }));
  },

  init() {
    this.registerCommands();
    for (const ev of ['vex:tab-closed']) { document.addEventListener(ev, () => setTimeout(() => this._twCheck(), 0)); }
    document.addEventListener('vex:tab-navigated', () => { if (this._tw) { this._twSample(); this._twBadge(); } });
    if (this.isGuestWindow()) {
      document.body.classList.add('guest-mode');
      const start = () => { this.showBadge(); this._sample(); };
      if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
      for (const ev of ['vex:tab-activated', 'vex-tabs-changed']) window.addEventListener(ev, () => this._sample());
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexGuest = VexGuest;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'guest-session', title: 'Guest session', keywords: 'guest public computer library private temporary forget erase', before: 'about', render: (body) => VexGuest.settingsRows(body) });
  }
  document.addEventListener('DOMContentLoaded', () => { try { VexGuest.init(); } catch (err) { console.error('[Guest] could not start:', err); } });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGuest };
