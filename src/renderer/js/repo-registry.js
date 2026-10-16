// === Repo registry and repo-aware tab groups ===================================
//
// Your repositories, listed once: a name (owner/repo), and if you want one, the
// folder of your clone on this computer (chosen with a folder picker, kept as a
// path and nothing more).
//
// What it does with the list:
//   * a tab on one of those repositories (github.com/owner/repo and its issues,
//     pull requests, actions and files, raw.githubusercontent.com/owner/repo,
//     owner.github.io/repo for its docs) gets a SUGGESTION in the Attention Inbox:
//     "Group this tab under owner/repo". It is never grouped by itself. Taking it
//     puts the tab in the tab group called owner/repo, made if there is none;
//   * Ctrl+K > "Repo: owner/repo" goes to that group's first tab, or opens the
//     repository in a new tab in its group;
//   * the GitHub helpers (js/github-helpers.js) use the folder to build a local path.
//
// What it does NOT do: it never reads, lists, scans or opens the folder; only the path
// you picked is stored (the picker asks the main process to show a folder dialog and
// hands back that one path). It never runs git. No GitHub token and no network.
//
// Parsing is pure and tested in tests/renderer/repoRegistry.test.js.
const VexRepos = {
  KEY: 'vex.repos',
  ENABLED_KEY: 'vex.repos.enabled',
  MAX: 100,
  // github.com paths that are not owners.
  RESERVED: new Set(['settings', 'orgs', 'organizations', 'marketplace', 'notifications', 'login', 'logout', 'join', 'pulls', 'issues', 'explore', 'topics', 'sponsors', 'features', 'about', 'new', 'search', 'codespaces', 'apps', 'collections', 'trending', 'enterprise', 'pricing', 'security', 'customer-stories', 'readme', 'site', 'contact', 'copilot', 'github-copilot', 'dashboard', 'users', 'sessions', 'account', 'password_reset', 'signup', 'stars', 'watching', 'gist', 'gists']),
  _suggested: new Set(),
  _pending: new Map(),
  _seq: 0,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; }
    catch (err) { console.error('[Repos] the switch could not be read:', err); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // ---- parsing (pure) ----------------------------------------------------------------
  // "owner/name" or a github.com address of a repository (or a page in one) -> "owner/name".
  normalize(input) {
    const s = String(input == null ? '' : input).trim();
    const plain = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
    const hit = this.parseUrl(s) || (plain ? { owner: plain[1], repo: plain[2].replace(/\.git$/i, '') } : null);
    if (!hit || this.RESERVED.has(hit.owner.toLowerCase())) throw new Error('Write the repository as owner/name, or paste its github.com address');
    return hit.owner + '/' + hit.repo;
  },
  // A github.com / raw / github.io address -> { owner, repo, host, section, rest } or null.
  parseUrl(url) {
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean);
    if (host === 'github.com') {
      if (seg.length < 2 || this.RESERVED.has(seg[0].toLowerCase())) return null;
      return { owner: seg[0], repo: seg[1].replace(/\.git$/i, ''), host: 'github', section: seg[2] || '', rest: seg.slice(3) };
    }
    if (host === 'raw.githubusercontent.com') {
      return seg.length >= 2 ? { owner: seg[0], repo: seg[1], host: 'raw', section: 'raw', rest: seg.slice(2) } : null;
    }
    const pages = /^([a-z0-9-]+)\.github\.io$/.exec(host);
    if (pages) {
      // owner.github.io/repo/... is the repo's docs site; owner.github.io alone is the repo named owner.github.io
      if (seg.length) return { owner: pages[1], repo: seg[0], host: 'pages', section: 'docs', rest: seg.slice(1) };
      return { owner: pages[1], repo: pages[1] + '.github.io', host: 'pages', section: 'docs', rest: [] };
    }
    return null;
  },
  sameRepo(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); },

  // ---- the list --------------------------------------------------------------------------
  _readStrict() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('Your repository list is not readable, so it was not changed');
    return list.filter(r => r && typeof r.name === 'string');
  },
  list() {
    try { return this._readStrict(); }
    catch (err) { console.error('[Repos] the list could not be read:', err.message); return []; }
  },
  get(name) { return this.list().find(r => this.sameRepo(r.name, name)) || null; },
  _write(list) { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX))); this.registerCommands(); },

  add(input, { path = '' } = {}) {
    const name = this.normalize(input);
    const list = this._readStrict();
    if (list.some(r => this.sameRepo(r.name, name))) throw new Error(name + ' is already in your list');
    if (list.length >= this.MAX) throw new Error('At most ' + this.MAX + ' repositories - remove one first');
    list.push({ name, path: this._cleanPath(path), at: Date.now() });
    this._write(list);
    return name;
  },
  remove(name) {
    const list = this._readStrict();
    const next = list.filter(r => !this.sameRepo(r.name, name));
    if (next.length === list.length) throw new Error(name + ' is not in your list');
    this._write(next);
  },
  setPath(name, path) {
    const list = this._readStrict();
    const r = list.find(x => this.sameRepo(x.name, name));
    if (!r) throw new Error(name + ' is not in your list');
    r.path = this._cleanPath(path);
    this._write(list);
  },
  _cleanPath(p) {
    const s = String(p == null ? '' : p).trim();
    if (!s) return '';
    if (s.length > 500 || /[\r\n\0]/.test(s)) throw new Error('That folder path is not valid');
    if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(s)) throw new Error('The folder path must be a full path (like C:\\code\\repo)');
    return s;
  },

  // The registered repository an address belongs to, or null.
  match(url) {
    const p = this.parseUrl(url);
    if (!p) return null;
    return this.list().find(r => this.sameRepo(r.name, p.owner + '/' + p.repo)) || null;
  },

  // ---- the folder picker (the one place a path comes from) ----------------------------------
  async pickFolder() {
    if (!window.vex || typeof window.vex.reposPickFolder !== 'function') throw new Error('This window cannot show a folder picker');
    const r = await window.vex.reposPickFolder();
    if (!r || r.canceled) return '';
    if (!r.ok) throw new Error(r.error || 'The folder could not be chosen');
    return r.path;
  },

  // ---- tab groups ----------------------------------------------------------------------------
  groupFor(name) {
    if (typeof TabManager === 'undefined') return null;
    return TabManager.groups.find(g => g.name.toLowerCase() === String(name).toLowerCase()) || null;
  },
  ensureGroup(name) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    let g = this.groupFor(name);
    if (g) return g;
    const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const color = (TabManager._themeGroupPalette ? (TabManager._themeGroupPalette()[0] || {}).ref : '') || 'indigo';
    g = { id, name: String(name).slice(0, 60), color, collapsed: false };
    TabManager.groups.push(g);
    VexStorage.saveGroups(TabManager.groups);
    TabManager.rebuildAllTabs();
    return g;
  },
  groupTab(tabId, name) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) throw new Error('That tab is closed');
    const g = this.ensureGroup(name);
    if (!TabManager.moveTabToGroup(tabId, g.id)) throw new Error('The tab could not be moved into the group');
    VexStorage.saveGroups(TabManager.groups);
    TabManager.rebuildAllTabs();
    TabManager.persistTabs();
    return g;
  },
  // Ctrl+K "Repo: x": the group's first tab, or the repository in a new tab in its group.
  focus(name) {
    const r = this.get(name);
    if (!r) throw new Error(name + ' is not in your list');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('repo-registry');
    const g = this.groupFor(r.name);
    const first = g ? TabManager.tabs.find(t => t.groupId === g.id) : null;
    if (first) { TabManager.switchTab(first.id); return first.id; }
    const id = TabManager.createTab('https://github.com/' + r.name, true);
    this.groupTab(id, r.name);
    return id;
  },

  // ---- the suggestion ------------------------------------------------------------------------
  // Called for the tab in front. At most one suggestion per tab and repository per run.
  suggestFor(tab) {
    if (!this.enabled() || !tab || !tab.url || typeof VexAttention === 'undefined') return false;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;
    const r = this.match(tab.url);
    if (!r) return false;
    const g = this.groupFor(r.name);
    if (g && tab.groupId === g.id) return false;
    const key = tab.id + '|' + r.name.toLowerCase();
    if (this._suggested.has(key)) return false;
    this._suggested.add(key);
    const token = 'g' + (++this._seq);
    this._pending.set(token, { tabId: tab.id, name: r.name });
    return VexAttention.suggest({
      feature: 'repo-registry', label: 'Repository groups', id: key,
      title: 'Group this tab under ' + r.name + '?', body: 'It is one of your repositories. Nothing moves unless you choose.',
      action: { label: 'Group it', key: 'group:' + token },
    });
  },
  _onAction(key) {
    const m = /^group:(g\d+)$/.exec(String(key));
    if (!m) throw new Error('Unknown repository action ' + key);
    const p = this._pending.get(m[1]);
    if (!p) throw new Error('That suggestion is out of date - open the repository tab again');
    this._pending.delete(m[1]);
    const g = this.groupTab(p.tabId, p.name);
    window.showToast?.('Grouped under ' + g.name);
  },

  // ---- Ctrl+K ----------------------------------------------------------------------------------
  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const list = this.enabled() ? this.list().map(r => ({
      id: 'repos:' + r.name.toLowerCase(), label: 'Repo: ' + r.name, icon: 'git', hint: 'Go to its tab group, or open it on GitHub',
      action: () => this.focus(r.name),
    })) : [];
    if (this.enabled()) list.push({ id: 'repos:manage', label: 'Repositories', icon: 'git', hint: 'Your repository list and tab groups', action: () => this.openSettings() });
    VexModuleCommands.set('repos:', list);
    return true;
  },
  openSettings() {
    if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('setting-dev-helpers');
    else throw new Error('Settings is not available');
  },

  // ---- Settings -----------------------------------------------------------------------------------
  settingsRows(body) {
    const S = VexSettingsGroup;
    const redraw = () => window.VexSettingsGroups?.inject();
    const fail = (err) => window.showToast?.((err && err.message) || 'That did not work', 'error');
    body.appendChild(S.note('Your repositories. A tab on one of them gets a suggestion to join a tab group named after it, and Ctrl+K > Repo: goes to it. The folder is only a path you choose; Vex never reads or scans it.'));
    body.appendChild(S.toggle('Repository registry', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch('repo-registry'); }));
    for (const r of this.list()) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const label = document.createElement('span');
      const code = document.createElement('code');
      code.textContent = r.name;
      label.append(code, r.path ? ' ' + r.path : ' (no folder)');
      row.appendChild(label);
      const act = (text, fn) => row.appendChild(S.button(text, () => { Promise.resolve().then(fn).then(redraw).catch(fail); }));
      act(r.path ? 'Change folder' : 'Choose folder', async () => { const p = await this.pickFolder(); if (p) this.setPath(r.name, p); });
      if (r.path) act('Copy path', async () => { await navigator.clipboard.writeText(r.path); window.showToast?.('Copied the folder path'); });
      act('Remove', async () => {
        const ok = await window.vexConfirm({ title: 'Remove ' + r.name + '?', message: 'Only the entry goes. The tab group and the folder stay.', okLabel: 'Remove', danger: true });
        if (ok) this.remove(r.name);
      });
      body.appendChild(row);
    }
    body.appendChild(S.button('Add a repository...', () => {
      (async () => {
        const v = await window.vexPrompt({ title: 'Add a repository', label: 'owner/name, or its github.com address', placeholder: '0xmortuex/vex' });
        if (v == null) return;
        const name = this.add(v);
        const pick = await window.vexConfirm({ title: 'Choose the folder of ' + name + '?', message: 'Optional. Vex keeps the path only; it never reads the folder.', okLabel: 'Choose folder', cancelLabel: 'Skip' });
        if (pick) { const p = await this.pickFolder(); if (p) this.setPath(name, p); }
        redraw();
      })().catch(fail);
    }));
  },
};

if (typeof window !== 'undefined') {
  window.VexRepos = VexRepos;
  // The developer loop (js/dev-loop.js, loaded before this file) looks at the repositories
  // listed here as well as its own list. A switched-off registry hands over nothing.
  if (typeof DevLoopRepos !== 'undefined') DevLoopRepos.addSource(() => (VexRepos.enabled() ? VexRepos.list().map(r => r.name) : []));
  VexRepos.registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexRepos.registerCommands());
  const check = () => { try { if (typeof TabManager !== 'undefined' && TabManager.getActiveTab) VexRepos.suggestFor(TabManager.getActiveTab()); } catch (err) { console.error('[Repos] could not check the tab:', err); } };
  window.addEventListener('vex:tab-activated', check);
  window.addEventListener('vex-tabs-changed', check);
  if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('repo-registry', (key) => VexRepos._onAction(key));
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRepos };
