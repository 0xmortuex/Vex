// === Developer desk: open the file a trace points to, open a terminal, one Settings section ===
//
//   T2-019  Open the file a stack trace points to. Select a trace line (in a CI log, the
//           log reader, an issue, any page) > "Open in editor". The path must lie inside a
//           folder YOU granted in the folder dialog; Vex reads no file content.
//   T2-030  "Open terminal here" on a repository's tab group, and a branch name read from
//           that folder's .git/HEAD. Only Windows Terminal, only the folder, no command.
//
// The safety is in the main process (src/main/dev-desk.js): OFF by default, a two-editor and
// one-terminal allowlist, an argument array and never a shell, only inside granted folders.
// This file asks it; it cannot widen it. Everything here is switched off until the owner
// switches "Open in editor and terminal" on.
//
// This file also draws the ONE Settings section "Developer desk" with the rows of the other
// desk features (dev-ports-pair.js, actions-board.js, log-reader.js, plugin-dev.js,
// electron-ticker.js, secret-guard.js). Load order: after all of them, before vex-usage-registry.js.
const DevDesk = {
  FEATURE: 'dev-desk',
  _cfg: null,
  _branches: new Map(),     // repository name -> branch (cache for the group menu)

  // ---- the switch lives in the main process; this is a copy of what it said ----------------------
  enabled() { return !!(this._cfg && this._cfg.enabled); },
  setEnabled(on) {
    DevDeskUtil.bridge('devdeskSetConfig')({ enabled: !!on })
      .then((c) => { this._cfg = c; this._changed(); })
      .catch((err) => DevDeskUtil.fail('Open in editor and terminal', err));
    this._cfg = { ...(this._cfg || { roots: [], editors: [], terminals: [] }), enabled: !!on };
  },
  async refresh() {
    this._cfg = await DevDeskUtil.bridge('devdeskConfig')();
    this._changed();
    return this._cfg;
  },
  _changed() { this.registerCommands(); try { VexSettingsGroup.refresh('setting-dev-desk'); } catch (err) { console.error('[DevDesk] could not redraw Settings:', err); } },
  roots() { return (this._cfg && this._cfg.roots) || []; },
  isGranted(dir) {
    const d = String(dir || '').toLowerCase().replace(/[\\/]+$/, '');
    return !!d && this.roots().some(r => d === r.toLowerCase().replace(/[\\/]+$/, '') || d.startsWith(r.toLowerCase().replace(/[\\/]+$/, '') + '\\') || d.startsWith(r.toLowerCase().replace(/[\\/]+$/, '') + '/'));
  },

  // ---- T2-019: stack trace lines (pure, tested) ---------------------------------------------------------
  // text -> [{ path, line, col, relative }]  (at most 10, no repeats)
  parseTrace(text) {
    const s = String(text == null ? '' : text).slice(0, 20000);
    const out = [];
    const seen = new Set();
    const add = (p, line, col) => {
      let path = String(p).replace(/^file:\/\/\//i, '').replace(/\//g, '\\');
      try { if (/%[0-9a-f]{2}/i.test(path)) path = decodeURIComponent(path); } catch (err) { throw new Error('A path in the trace is not readable', { cause: err }); }
      const relative = !/^[A-Za-z]:\\/.test(path);
      if (relative && /(^|\\)\.\.(\\|$)/.test(path)) return;
      const l = Number(line), c = col == null ? 0 : Number(col);
      if (!Number.isInteger(l) || l < 1 || l > 10000000) return;
      const key = path.toLowerCase() + ':' + l + ':' + c;
      if (seen.has(key) || out.length >= 10) return;
      seen.add(key);
      out.push({ path, line: l, col: Number.isInteger(c) && c >= 1 && c <= 100000 ? c : 0, relative });
    };
    let m;
    const py = /File "([^"\r\n]{1,400})", line (\d{1,8})/g;
    while ((m = py.exec(s))) add(m[1], m[2], 0);
    const abs = /(?<![A-Za-z0-9])((?:file:\/\/\/)?[A-Za-z]:[\\/][^\s:"'()<>|*?]{1,400}?):(\d{1,8})(?::(\d{1,6}))?/g;
    while ((m = abs.exec(s))) add(m[1], m[2], m[3]);
    const rel = /(?:^|[\s(]|--> )((?:\.{1,2}[\\/])?[\w.@-]+(?:[\\/][\w.@-]+)*\.(?:rs|c|h|cc|cpp|hpp|py|js|mjs|cjs|ts|tsx|jsx|go|java|kt|cs|rb|php|vue|svelte)):(\d{1,8})(?::(\d{1,6}))?/gm;
    while ((m = rel.exec(s))) add(m[1], m[2], m[3]);
    return out;
  },

  // The absolute paths to try for one reference.
  candidates(ref) {
    if (!ref.relative) return [ref.path];
    const order = [];
    // A reference that names its repository (the CI card) looks in that repository's folder first.
    const hinted = ref.repo ? this.pathOf(ref.repo) : '';
    if (hinted) order.push(hinted);
    if (typeof VexRepos !== 'undefined' && typeof TabManager !== 'undefined') {
      const tab = TabManager.getActiveTab && TabManager.getActiveTab();
      const r = tab && tab.url ? VexRepos.match(tab.url) : null;
      if (r && r.path) order.push(r.path);
    }
    for (const root of this.roots()) if (!order.some(o => o.toLowerCase() === root.toLowerCase())) order.push(root);
    const rel = ref.path.replace(/^\.\\/, '');
    return order.map(root => root.replace(/[\\/]+$/, '') + '\\' + rel);
  },

  async openRef(ref) {
    if (!this.enabled()) throw new Error('Open in editor is switched off (Settings > Developer desk)');
    const open = DevDeskUtil.bridge('devdeskOpenFile');
    let last = null;
    for (const path of this.candidates(ref)) {
      try {
        const r = await open({ path, line: ref.line, col: ref.col || undefined });
        DevDeskUtil.touch(this.FEATURE);
        return r;
      } catch (err) {
        last = err;
        // A path that does not exist here is expected for a relative trace; anything else is real.
        if (!/does not exist|not inside a folder you granted/.test(err.message)) throw err;
      }
    }
    throw last || new Error('There is no folder to look in - grant a repository folder first');
  },
  async openFirstRef(text) {
    const refs = this.parseTrace(text);
    if (!refs.length) throw new Error('No file and line found in that text');
    const r = await this.openRef(refs[0]);
    window.showToast?.('Opened ' + refs[0].path.split('\\').pop() + ':' + refs[0].line);
    return r;
  },

  // Rows for the right-click menu on selected text.
  selectionItems(selection) {
    if (!this.enabled() || !this._cfg.editor) return [];
    const refs = this.parseTrace(selection).slice(0, 2);
    return refs.map(ref => ({
      label: 'Open in editor: ' + ref.path.split('\\').pop() + ':' + ref.line,
      action: () => { this.openRef(ref).then(() => window.showToast?.('Opened in your editor')).catch(err => DevDeskUtil.fail('Open in editor', err)); },
    }));
  },

  // ---- T2-030: terminal and branch for a repository group ------------------------------------------------------
  pathOf(repoName) {
    if (typeof VexRepos === 'undefined') return '';
    const r = VexRepos.get(repoName);
    return r && r.path ? r.path : '';
  },
  // For the tab group menu: { label } when the group is a repository with a granted folder.
  groupRow(groupName) {
    if (!this.enabled() || !this._cfg.terminal) return null;
    const p = this.pathOf(groupName);
    if (!p || !this.isGranted(p)) return null;
    this.warmBranch(groupName);
    const b = this._branches.get(String(groupName).toLowerCase());
    return { label: 'Open terminal here' + (b ? ' (' + b + ')' : '') };
  },
  warmBranch(name) {
    const p = this.pathOf(name);
    if (!p) return;
    DevDeskUtil.bridge('devdeskBranch')(p)
      .then(r => { if (r && r.branch) this._branches.set(String(name).toLowerCase(), r.branch); })
      .catch(err => console.error('[DevDesk] the branch of ' + name + ' could not be read:', err.message));
  },
  async openTerminalFor(repoName) {
    const p = this.pathOf(repoName);
    if (!p) throw new Error(repoName + ' has no folder in the repository registry');
    await DevDeskUtil.bridge('devdeskOpenTerminal')(p);
    DevDeskUtil.touch(this.FEATURE);
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const list = [];
    if (this.enabled() && this._cfg.terminal && typeof VexRepos !== 'undefined') {
      for (const r of VexRepos.list()) {
        if (!r.path || !this.isGranted(r.path)) continue;
        list.push({ id: 'devdesk:term:' + r.name.toLowerCase(), label: 'Terminal: ' + r.name, icon: 'code', hint: 'Open Windows Terminal in its folder',
          action: () => { this.openTerminalFor(r.name).catch(err => DevDeskUtil.fail('Open terminal', err)); } });
      }
    }
    VexModuleCommands.set('devdesk:', list);
    return true;
  },

  // ---- Settings: one section, a box per feature -------------------------------------------------------------------
  settingsRows(body) {
    const S = VexSettingsGroup;
    const fail = (err) => DevDeskUtil.fail('Open in editor and terminal', err);
    const cfg = this._cfg;
    body.appendChild(S.note('Open in editor and terminal: lets Vex start your editor at the line of a stack trace and Windows Terminal in a repository folder. OFF by default. It runs only the editor and terminal you choose below, never through a shell, and only for files and folders inside the folders you grant here.'));
    if (!cfg) { body.appendChild(S.note('Reading the current settings...')); this.refresh().catch(fail); return; }
    body.appendChild(S.toggle('Open in editor and terminal', cfg.enabled, (on) => this.setEnabled(on)));
    if (cfg.enabled) {
      const pick = (kind, list, current) => {
        const sel = DevDeskUtil.el('select', 'set-input');
        sel.appendChild(new Option('None', ''));
        for (const o of list) sel.appendChild(new Option(o.label, o.id));
        sel.value = current || '';
        sel.addEventListener('change', () => {
          DevDeskUtil.bridge('devdeskSetConfig')({ [kind]: sel.value }).then(c => { this._cfg = c; this._changed(); }).catch(fail);
        });
        return sel;
      };
      body.appendChild(S.field('Editor', pick('editor', cfg.editors, cfg.editor)));
      body.appendChild(S.field('Terminal', pick('terminal', cfg.terminals, cfg.terminal)));
      body.appendChild(S.note('Folders granted (a file or folder outside these is refused):'));
      for (const root of cfg.roots) {
        const row = DevDeskUtil.el('div', 'setting-toggle-row');
        row.append(DevDeskUtil.el('code', '', root), S.button('Revoke', () => { DevDeskUtil.bridge('devdeskRevokeRoot')(root).then(c => { this._cfg = c; this._changed(); }).catch(fail); }, 'danger'));
        body.appendChild(row);
      }
      body.appendChild(S.button('Grant a repository folder...', () => {
        DevDeskUtil.bridge('devdeskGrantRoot')().then(r => { if (r && !r.canceled) { this._cfg = r.config; this._changed(); } }).catch(fail);
      }));
    }
  },
};

const DevDeskSettings = {
  SECTIONS() {
    return [
      DevDesk,
      typeof DevPortsPair !== 'undefined' ? DevPortsPair : null,
      typeof ActionsBoard !== 'undefined' ? ActionsBoard : null,
      typeof LogReader !== 'undefined' ? LogReader : null,
      typeof PluginDev !== 'undefined' ? PluginDev : null,
      typeof ElectronTicker !== 'undefined' ? ElectronTicker : null,
      typeof SecretGuard !== 'undefined' ? SecretGuard : null,
    ].filter(Boolean);
  },
  build(body) {
    for (const s of this.SECTIONS()) {
      const box = DevDeskUtil.el('div');
      box.style.cssText = 'border-top:1px solid var(--border);padding-top:8px;margin-top:8px';
      try { s.settingsRows(box); }
      catch (err) {
        console.error('[DevDesk] a feature could not draw its settings:', err);
        box.textContent = 'This feature could not be shown: ' + ((err && err.message) || err);
      }
      body.appendChild(box);
    }
  },
};

if (typeof window !== 'undefined') {
  window.DevDesk = DevDesk;
  window.DevDeskSettings = DevDeskSettings;
  if (typeof VexSettingsGroup !== 'undefined') {
    VexSettingsGroup.add({
      id: 'setting-dev-desk', title: 'Developer desk',
      info: 'Dev ports, Actions board, log reader, plugin dev loop, Electron ticker, secret paste guard, and opening a file or terminal from a repository. Every one is off until you switch it on.',
      build: (body) => DevDeskSettings.build(body),
    });
  }
  if (window.vex && typeof window.vex.devdeskConfig === 'function') {
    DevDesk.refresh().catch((err) => DevDeskUtil.fail('Developer desk', err));
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DevDesk, DevDeskSettings };
