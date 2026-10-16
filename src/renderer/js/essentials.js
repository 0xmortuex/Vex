// === Essential tabs: shared across every workspace (T3-014) ====================
//
// Mail, the calendar and Discord are wanted in every workspace, and a workspace
// switch closed them with the rest. A tab made ESSENTIAL (right-click > "Make
// essential") is pinned once and then stays open through every workspace switch,
// in the same state (page, scroll, sound), instead of being saved into one
// workspace and rebuilt in another.
//
// How it fits the workspaces (js/workspaces.js):
//   * switchTo keeps essential tabs open the way it keeps Private and Tor tabs
//     (VexEssentials.stays), and saveCurrentState leaves them out of the
//     workspace's saved tabs (VexEssentials.leaveOut), so no workspace ever
//     holds a second copy of one.
//   * the flag is saved with the tab (js/tab-policy.js serialize), so the
//     essentials are the same after a restart.
//
// Only an ordinary signed-in tab can be essential. A private, Tor or burner tab
// belongs to no workspace and is never written down, so it is refused, out loud.
// Reached by one key from anywhere: Ctrl+Alt+E (or Ctrl+K, "Essential tabs")
// lists them; Enter goes to one.
const VexEssentials = {
  KEY: 'vex.essentials',          // '0' = off

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); },

  isEssential(tab) { return !!tab && tab.essential === true; },

  // Does a workspace switch leave this tab open?
  stays(tab) { return this.enabled() && this.isEssential(tab); },

  // The tabs a workspace should save as its own.
  leaveOut(tabs) { return this.enabled() ? tabs.filter(t => !this.isEssential(t)) : tabs; },

  list() { return (typeof TabManager !== 'undefined' ? TabManager.tabs : []).filter(t => this.isEssential(t)); },

  // → null when the tab can be essential, else the reason in plain words.
  refusal(tab) {
    if (!tab) return 'That tab is gone';
    if (typeof isStartPage === 'function' && isStartPage(tab.url)) return 'Open a page first: the New Tab page cannot be essential';
    if (!/^https?:/i.test(tab.url || '')) return 'Only a web page can be essential';
    const policy = window.VexTabPolicy;
    if (policy && policy.isPrivateWindow) return 'A private window has no workspaces';
    if (policy && !policy.canPersist(tab)) return 'A private, Tor or temporary tab belongs to no workspace, so it cannot be essential';
    return null;
  },

  make(id) {
    if (!this.enabled()) throw new Error('Essential tabs are switched off in Settings');
    const tab = TabManager.tabs.find(t => t.id === id);
    const why = this.refusal(tab);
    if (why) throw new Error(why);
    if (tab.essential === true) return tab;
    tab.essential = true;
    if (!tab.pinned) TabManager.pinTab(tab.id);
    // Workspaces that saved this tab before it became essential must not rebuild a second copy.
    if (typeof WorkspaceManager !== 'undefined' && Array.isArray(WorkspaceManager.workspaces)) {
      for (const ws of WorkspaceManager.workspaces) if (Array.isArray(ws.tabs)) ws.tabs = ws.tabs.filter(t => t.id !== tab.id);
      WorkspaceManager.save();
    }
    TabManager.persistTabs();
    return tab;
  },

  // It stays pinned and belongs to the workspace you are in from now on.
  remove(id) {
    const tab = TabManager.tabs.find(t => t.id === id);
    if (!tab) throw new Error('That tab is gone');
    if (tab.essential !== true) return tab;
    tab.essential = false;
    TabManager.persistTabs();
    return tab;
  },

  // Rows for the tab's right-click menu (js/tabs.js).
  menuItems(tab) {
    if (!this.enabled() || !tab) return [];
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    if (this.isEssential(tab)) {
      return [{ label: 'Remove from essentials', action: () => { try { this.remove(tab.id); window.showToast?.('No longer essential: it stays in this workspace'); } catch (err) { fail(err); } } }];
    }
    if (this.refusal(tab)) return [];
    return [{ label: 'Make essential (in every workspace)', action: () => { try { this.make(tab.id); window.showToast?.('Essential: it stays open in every workspace'); } catch (err) { fail(err); } } }];
  },

  rows(query) {
    const q = String(query || '').trim();
    const tr = globalThis.VexTr || null;
    const fold = (s) => (tr ? tr.fold(s) : String(s || '').toLowerCase());
    const needle = fold(q);
    return this.list()
      .filter(t => !needle || fold((t.title || '') + ' ' + (t.url || '')).includes(needle))
      .map(t => ({ id: t.id, title: t.title || t.url, sub: t.url, favicon: t.favicon || null, flags: t.sleeping ? ['sleep'] : [] }));
  },

  openPicker() {
    if (!this.enabled()) throw new Error('Essential tabs are switched off in Settings');
    if (!this.list().length) {
      window.showToast?.('No essential tabs yet: right-click a tab and choose "Make essential"', 'info', 5000);
      return false;
    }
    VexPickList.open({
      label: 'Essential tabs',
      placeholder: 'Essential tabs',
      hint: 'Enter to go, Esc to cancel',
      empty: 'No essential tab matches',
      source: (q) => this.rows(q),
      onPick: (row) => { if (TabManager.tabs.some(t => t.id === row.id)) TabManager.switchTab(row.id); },
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexEssentials = VexEssentials;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexEssentials };
