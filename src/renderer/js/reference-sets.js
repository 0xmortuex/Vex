// === Reference sets: doc pages and snippets pinned to a project ================
//
// A project space (or, without project spaces, the workspace you are in) can have a
// REFERENCE SET: the doc pages you keep going back to (the UEFI spec, the Electron
// docs, the OSDev wiki page for the thing you are building) and short snippets (a
// command, an address, a register layout). One click opens all the pages together,
// in a tab group called "Reference: <name>", or beside the page in front in a split.
//
// A set can also stand alone, not tied to anything: a named DOC SET ("OSDev wiki")
// you open when you need it.
//
// What is kept (this computer only, in vex.referenceSets): set names, page addresses
// and titles, snippet text you typed or pasted. Nothing is fetched, indexed or sent.
//
// Offline copies and search (T1-016): "Keep offline" opens each page of a set one after the other (a tab that is
// closed again when it is done), keeps a copy of it in the archive library exactly as "Make This Page Available
// Offline" does for one page (the same refusals: private, Tor, sign-in, bank, mail and health pages), and marks it
// in the offline list. "Search this set" looks only inside the copies of the pages of one set (the archive
// library's own index, nothing new is indexed) and in the snippets you typed. A page of the set that has no copy
// yet is said to be missing from the search, never silently skipped.
//
// Pure functions are tested in tests/renderer/referenceSets.test.js.
const VexReferenceSets = {
  KEY: 'vex.referenceSets',
  ENABLED_KEY: 'vex.referenceSets.enabled',
  MAX_SETS: 30,
  MAX_ITEMS: 40,
  MAX_TEXT: 4000,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; }
    catch (err) { console.error('[RefSets] the switch could not be read:', err); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  _id(prefix) { return prefix + '_' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 6); },

  // ---- the store -----------------------------------------------------------------------
  _readStrict() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('Your reference sets are not readable, so they were not changed');
    return list.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.items));
  },
  sets() {
    try { return this._readStrict(); }
    catch (err) { console.error('[RefSets] the sets could not be read:', err.message); return []; }
  },
  _write(list) {
    if (list.length > this.MAX_SETS) throw new Error('At most ' + this.MAX_SETS + ' reference sets - delete one first');
    localStorage.setItem(this.KEY, JSON.stringify(list));
    this.registerCommands();
  },
  get(id) { return this.sets().find(s => s.id === id) || null; },

  // The project space you are in, else the workspace: { id, name } or null.
  scope() {
    if (typeof ProjectSpaces !== 'undefined' && typeof ProjectSpaces.active === 'function') {
      const s = ProjectSpaces.active();
      if (s) return { id: 'space:' + s.id, name: s.name };
    }
    if (typeof WorkspaceManager !== 'undefined' && WorkspaceManager.workspaces && WorkspaceManager.workspaces.length) {
      const w = WorkspaceManager.workspaces.find(x => x.id === WorkspaceManager.activeId);
      if (w) return { id: 'ws:' + w.id, name: w.name };
    }
    return null;
  },
  forScope(scopeId) { return this.sets().find(s => s.scope === scopeId) || null; },

  cleanUrl(url) {
    const s = String(url == null ? '' : url).trim();
    let u;
    try { u = new URL(s); } catch { throw new Error('That is not a web address'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https pages can be pinned');
    if (u.username || u.password) throw new Error('An address with a user name or password in it cannot be pinned');
    return u.toString();
  },

  create(name, { scope = '' } = {}) {
    const n = String(name == null ? '' : name).trim();
    if (!n) throw new Error('Give the set a name');
    if (n.length > 80) throw new Error('That name is too long');
    const list = this._readStrict();
    if (list.some(s => s.name.toLowerCase() === n.toLowerCase())) throw new Error('There is already a set called "' + n + '"');
    if (scope && list.some(s => s.scope === scope)) throw new Error('That project already has a reference set');
    const set = { id: this._id('rs'), name: n, scope: scope || '', items: [], at: Date.now() };
    list.push(set);
    this._write(list);
    return set;
  },
  remove(id) {
    const list = this._readStrict();
    const next = list.filter(s => s.id !== id);
    if (next.length === list.length) throw new Error('That set is gone');
    this._write(next);
  },
  addPage(id, { url, title }) {
    const clean = this.cleanUrl(url);
    const list = this._readStrict();
    const set = list.find(s => s.id === id);
    if (!set) throw new Error('That set is gone');
    if (set.items.some(i => i.kind === 'page' && i.url === clean)) throw new Error('That page is already in "' + set.name + '"');
    if (set.items.length >= this.MAX_ITEMS) throw new Error('A set holds at most ' + this.MAX_ITEMS + ' items');
    set.items.push({ id: this._id('ri'), kind: 'page', url: clean, title: String(title || clean).slice(0, 140), at: Date.now() });
    this._write(list);
  },
  addSnippet(id, { text, title }) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) throw new Error('The snippet is empty');
    if (t.length > this.MAX_TEXT) throw new Error('A snippet holds at most ' + this.MAX_TEXT + ' characters');
    const list = this._readStrict();
    const set = list.find(s => s.id === id);
    if (!set) throw new Error('That set is gone');
    if (set.items.length >= this.MAX_ITEMS) throw new Error('A set holds at most ' + this.MAX_ITEMS + ' items');
    set.items.push({ id: this._id('ri'), kind: 'snippet', text: t, title: String(title || t.split('\n')[0]).slice(0, 80), at: Date.now() });
    this._write(list);
  },
  removeItem(id, itemId) {
    const list = this._readStrict();
    const set = list.find(s => s.id === id);
    if (!set) throw new Error('That set is gone');
    const n = set.items.length;
    set.items = set.items.filter(i => i.id !== itemId);
    if (set.items.length === n) throw new Error('That item is gone');
    this._write(list);
  },

  // ---- opening -----------------------------------------------------------------------------
  // Every page of the set as tabs in the group "Reference: <name>". With split, the first page
  // is shown beside the tab in front. -> the ids of the new tabs.
  openAll(id, { split = false } = {}) {
    const set = this.get(id);
    if (!set) throw new Error('That set is gone');
    const pages = set.items.filter(i => i.kind === 'page');
    if (!pages.length) throw new Error('"' + set.name + '" has no pages yet');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('reference-sets');
    const before = TabManager.activeTabId;
    const groupName = 'Reference: ' + set.name;
    let group = TabManager.groups.find(g => g.name === groupName);
    if (!group) {
      group = { id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: groupName.slice(0, 60), color: (TabManager._themeGroupPalette ? (TabManager._themeGroupPalette()[0] || {}).ref : '') || 'indigo', collapsed: false };
      TabManager.groups.push(group);
      VexStorage.saveGroups(TabManager.groups);
    }
    const ids = pages.map((p, i) => TabManager.createTab(p.url, i === 0 && !split, group.id));
    TabManager.rebuildAllTabs();
    if (split) {
      if (typeof SplitScreen === 'undefined' || typeof SplitScreen.restore !== 'function') throw new Error('Split screen is not available');
      if (!before) throw new Error('There is no tab in front to put the page beside');
      if (!SplitScreen.restore([before, ids[0]], 0.5)) throw new Error('The split could not be made');
    }
    return ids;
  },
  async copySnippet(item) {
    await navigator.clipboard.writeText(item.text);
    window.showToast?.('Copied "' + item.title + '"');
  },

  // Add the page in front to the set of this project (made if there is none).
  async addCurrentPage() {
    const tab = TabManager.getActiveTab();
    if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Open a web page first');
    const sc = this.scope();
    let set = sc ? this.forScope(sc.id) : null;
    if (!set) {
      const name = await window.vexPrompt({ title: 'Reference set', message: sc ? 'This project has no reference set yet.' : 'Name the set (a doc set, not tied to a project).', label: 'Name', value: sc ? sc.name + ' reference' : '' });
      if (name == null) return;
      set = this.create(name, { scope: sc ? sc.id : '' });
    }
    this.addPage(set.id, { url: tab.url, title: tab.title });
    window.showToast?.('Pinned to "' + set.name + '"');
  },

  // ---- offline copies and search inside a set (T1-016) ------------------------------------------------
  // The address as the archive library keeps it: no fragment, no trailing slash, lower-case host.
  urlKey(url) {
    try { const u = new URL(String(url)); u.hash = ''; return (u.origin.toLowerCase() + u.pathname.replace(/\/+$/, '') + u.search); } catch { return String(url || ''); }
  },
  pagesOf(set) { return set.items.filter(i => i.kind === 'page'); },
  inSet(set, url) { const k = this.urlKey(url); return this.pagesOf(set).some(p => this.urlKey(p.url) === k); },
  // -> { total, kept, missing: [item] }
  offlineStatus(set) {
    const pages = this.pagesOf(set);
    const kept = typeof VexOfflinePages !== 'undefined' ? pages.filter(p => VexOfflinePages.isOffline(p.url)) : [];
    return { total: pages.length, kept: kept.length, missing: pages.filter(p => !kept.includes(p)) };
  },
  _settle(tabId, ms = 30000) {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(timer); document.removeEventListener('vex:tab-settled', on); fn(v); };
      const on = (e) => { if (e.detail && e.detail.tabId === tabId) done(resolve); };
      const timer = setTimeout(() => done(reject, new Error('The page did not finish loading in ' + Math.round(ms / 1000) + ' seconds')), ms);
      document.addEventListener('vex:tab-settled', on);
    });
  },
  // Keeps a copy of every page of the set that has none, one at a time. -> { kept, already, failed: [{ title, reason }] }
  async keepOffline(id, { onProgress, settleMs } = {}) {
    const set = this.get(id);
    if (!set) throw new Error('That set is gone');
    if (typeof TabManager === 'undefined' || typeof VexOfflinePages === 'undefined') throw new Error('Offline pages are not available here');
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) throw new Error('A private window keeps no copies');
    const { missing, total } = this.offlineStatus(set);
    if (!total) throw new Error('"' + set.name + '" has no pages yet');
    const result = { kept: 0, already: total - missing.length, failed: [] };
    const front = TabManager.activeTabId;
    let n = 0;
    for (const page of missing) {
      n++;
      if (onProgress) onProgress(n, missing.length, page);
      const before = new Set(TabManager.tabs.map(t => t.id));
      let tabId = null, opened = false;
      try {
        tabId = TabManager.createTab(page.url, true, null, { allowDuplicate: true });
        opened = !before.has(tabId);
        if (!opened) TabManager.switchTab(tabId);
        await this._settle(tabId, settleMs);
        await VexOfflinePages.markActive();
        result.kept++;
      } catch (err) {
        result.failed.push({ title: page.title, reason: err.message });
      } finally {
        if (opened && tabId) TabManager.closeTab(tabId);
      }
    }
    if (front && TabManager.tabs.some(t => t.id === front)) TabManager.switchTab(front);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('reference-sets');
    return result;
  },
  // Words of the query that must all appear (case-insensitive) in a snippet.
  searchSnippets(set, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return set.items.filter(i => i.kind === 'snippet').filter(i => { const t = (i.title + ' ' + i.text).toLowerCase(); return words.every(w => t.includes(w)); });
  },
  // Only inside this set: its page copies (the archive library's index) and its snippets.
  // -> { pages: [{ id, title, url, snippet }], snippets: [item], missing: [item] }
  async searchSet(id, query) {
    const set = this.get(id);
    if (!set) throw new Error('That set is gone');
    const q = String(query == null ? '' : query).trim();
    if (!q) throw new Error('Type what to look for');
    if (!window.vex || typeof window.vex.pageArchiveSearch !== 'function') throw new Error('The archive library is not available here');
    const r = await window.vex.pageArchiveSearch(q);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The search did not work');
    const hits = ((r.result && r.result.hits) || []).filter(h => this.inSet(set, h.url));
    if (typeof VexUsage !== 'undefined') VexUsage.touch('reference-sets');
    return { pages: hits.map(h => ({ id: h.id, title: h.title, url: h.url, snippet: Array.isArray(h.snippet) ? h.snippet.join(' ... ') : String(h.snippet || '') })), snippets: this.searchSnippets(set, q), missing: this.offlineStatus(set).missing };
  },
  async searchDialog(id) {
    const set = this.get(id);
    if (!set) throw new Error('That set is gone');
    const q = await window.vexPrompt({ title: 'Search "' + set.name + '"', label: 'Look for', placeholder: 'a word or phrase' });
    if (q == null) return null;
    const r = await this.searchSet(id, q);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-refsets-search', title: 'In "' + set.name + '": ' + q, sub: 'Only the copies of this set\'s pages and its snippets were searched.' });
    for (const p of r.pages) {
      const row = document.createElement('div'); row.className = 'vexsr-rule';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal'; t.textContent = p.title + (p.snippet ? ' - ' + p.snippet : '');
      row.append(t, VexSettingsGroups.button('Open copy', () => { (typeof ArchiveLibrary !== 'undefined' ? ArchiveLibrary.openCopy(p.id) : Promise.reject(new Error('The archive library is not available here'))).catch(err => window.showToast?.(err.message, 'error')); }));
      body.appendChild(row);
    }
    for (const s of r.snippets) {
      const row = document.createElement('div'); row.className = 'vexsr-rule';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal'; t.textContent = 'Snippet: ' + s.title;
      row.append(t, VexSettingsGroups.button('Copy', () => { this.copySnippet(s).catch(err => window.showToast?.(err.message, 'error')); }));
      body.appendChild(row);
    }
    if (!r.pages.length && !r.snippets.length) body.appendChild(VexSettingsGroups.note('Nothing in this set matched.'));
    if (r.missing.length) body.appendChild(VexSettingsGroups.note(r.missing.length + ' page' + (r.missing.length === 1 ? ' has' : 's have') + ' no offline copy yet, so ' + (r.missing.length === 1 ? 'it was' : 'they were') + ' not searched: ' + r.missing.map(m => m.title).slice(0, 5).join(', ') + '. Press Keep offline on the set.'));
    return r;
  },

  // ---- Ctrl+K ----------------------------------------------------------------------------------
  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const fail = (err) => window.showToast?.((err && err.message) || 'That did not work', 'error');
    const list = [];
    if (this.enabled()) {
      list.push(
        { id: 'refsets:manage', label: 'Reference sets', icon: 'book', hint: 'Doc pages and snippets pinned to a project', action: () => this.open() },
        { id: 'refsets:search', label: 'Search inside a reference set', icon: 'search', hint: 'Looks only in the offline copies and snippets of one set', action: () => { const sc = this.scope(); const s = (sc ? this.forScope(sc.id) : null) || this.sets()[0]; if (!s) throw new Error('There is no reference set yet'); this.searchDialog(s.id).catch(fail); } },
        { id: 'refsets:add', label: 'Pin this page to the reference set', icon: 'pin', hint: 'Adds the page in front to this project\'s set', action: () => { this.addCurrentPage().catch(fail); } },
        {
          id: 'refsets:open', label: 'Open the reference set of this project', icon: 'book-open', hint: 'All its pages, together in a group',
          action: () => { const sc = this.scope(); const s = sc ? this.forScope(sc.id) : null; if (!s) throw new Error('This project has no reference set - pin a page first'); this.openAll(s.id); },
        },
      );
      for (const s of this.sets().filter(x => x.items.some(i => i.kind === 'page'))) {
        list.push({ id: 'refsets:set:' + s.id, label: 'Docs: ' + s.name, icon: 'book-open', hint: 'Open all ' + s.items.filter(i => i.kind === 'page').length + ' pages', action: () => this.openAll(s.id) });
      }
    }
    VexModuleCommands.set('refsets:', list);
    return true;
  },

  // ---- the manager -------------------------------------------------------------------------------
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('reference-sets');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-refsets', title: 'Reference sets', sub: 'Doc pages and snippets for a project. Kept on this computer only.' });
    const fail = (err) => window.showToast?.((err && err.message) || 'That did not work', 'error');
    const draw = () => {
      body.textContent = '';
      const sc = this.scope();
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px';
      top.appendChild(VexSettingsGroups.button('New set...', () => {
        (async () => {
          const name = await window.vexPrompt({ title: 'New reference set', label: 'Name', placeholder: 'OSDev wiki' });
          if (name == null) return;
          let scope = '';
          if (sc && !this.forScope(sc.id)) scope = (await window.vexConfirm({ title: 'Tie it to "' + sc.name + '"?', message: 'A set tied to a project opens with Ctrl+K > Open the reference set of this project.', okLabel: 'Tie it', cancelLabel: 'Keep it separate' })) ? sc.id : '';
          this.create(name, { scope });
          draw();
        })().catch(fail);
      }, { primary: true }));
      body.appendChild(top);
      const sets = this.sets();
      if (!sets.length) body.appendChild(VexSettingsGroups.note('No reference sets yet. Make one, then pin pages to it with Ctrl+K > Pin this page to the reference set.'));
      for (const s of sets) {
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:0 0 10px';
        const h = document.createElement('div');
        h.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px';
        const nm = document.createElement('strong');
        nm.style.cssText = 'flex:1;min-width:120px;font-size:13px';
        nm.textContent = s.name + (s.scope && sc && s.scope === sc.id ? '  (this project)' : '');
        h.appendChild(nm);
        const act = (text, fn) => h.appendChild(VexSettingsGroups.button(text, () => { Promise.resolve().then(fn).catch(fail); }));
        act('Open all', () => this.openAll(s.id));
        act('Open in split', () => this.openAll(s.id, { split: true }));
        const st = this.offlineStatus(s);
        if (st.total) {
          act(st.kept === st.total ? 'Offline: all kept' : 'Keep offline (' + st.kept + ' of ' + st.total + ')', async () => {
            if (!st.missing.length) { window.showToast?.('Every page of this set already has an offline copy'); return; }
            const ok = await window.vexConfirm({ title: 'Keep ' + st.missing.length + ' page' + VexPlural.s(st.missing.length) + ' offline?', message: 'Vex opens each page of "' + s.name + '" that has no copy yet, one after the other, keeps a copy of it in the archive library, and closes it again. Pages that are private, sign-in, bank, mail or health pages are refused. The copies stay on this computer.', okLabel: 'Keep them' });
            if (!ok) return;
            const r = await this.keepOffline(s.id, { onProgress: (n, of, p) => window.showToast?.('Keeping ' + n + ' of ' + of + ': ' + String(p.title).slice(0, 50)) });
            window.showToast?.(r.kept + ' kept' + (r.failed.length ? ', ' + r.failed.length + ' not kept: ' + r.failed.map(f => f.title.slice(0, 30) + ' (' + f.reason + ')').join('; ').slice(0, 300) : ''), r.failed.length ? 'error' : 'success', 9000);
            draw();
          });
          act('Search this set', () => this.searchDialog(s.id));
        }
        act('Add snippet', async () => {
          const text = await window.vexPrompt({ title: 'Add a snippet to ' + s.name, label: 'Text', multiline: true, wide: true });
          if (text == null) return;
          this.addSnippet(s.id, { text });
          draw();
        });
        act('Delete', async () => {
          const ok = await window.vexConfirm({ title: 'Delete the set "' + s.name + '"?', message: 'Only the list goes. The pages stay where they are.', okLabel: 'Delete', danger: true });
          if (ok) { this.remove(s.id); draw(); }
        });
        card.appendChild(h);
        for (const it of s.items) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:3px 0;font-size:12px';
          const t = document.createElement('span');
          t.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          t.textContent = (it.kind === 'page' ? it.title + ' - ' + it.url : 'Snippet: ' + it.title);
          t.title = t.textContent;
          row.appendChild(t);
          const b = (text, fn) => row.appendChild(VexSettingsGroups.button(text, () => { Promise.resolve().then(fn).catch(fail); }));
          if (it.kind === 'page') b('Open', () => TabManager.createTab(it.url, true)); else b('Copy', () => this.copySnippet(it));
          b('Remove', () => { this.removeItem(s.id, it.id); draw(); });
          card.appendChild(row);
        }
        body.appendChild(card);
      }
    };
    draw();
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.toggle('Reference sets', this.enabled(), (on) => this.setEnabled(on), 'doc pages and snippets pinned to a project'));
    body.appendChild(S.button('Open reference sets', () => this.open()));
  },
};

if (typeof window !== 'undefined') {
  window.VexReferenceSets = VexReferenceSets;
  VexReferenceSets.registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexReferenceSets.registerCommands());
  document.addEventListener('vex:space-changed', () => VexReferenceSets.registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReferenceSets };
