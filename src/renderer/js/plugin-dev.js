// === Plugin dev loop: an unpacked extension that reloads when you save ===========
//
// Pick the folder of an extension you are writing (the folder dialog). Vex loads it
// from that folder, watches it, and reloads it when a file changes. Next to the status
// it lists every chrome.* namespace your source uses that Vex does not provide
// (history, bookmarks, sidePanel...), so a missing API is a line in a list and not an
// extension that does nothing.
//
// The work is in the main process (src/main/dev-extension.js). Off until switched on.
const PluginDev = {
  FEATURE: 'plugin-dev',
  KEY: 'vex.pluginDev.enabled',
  enabled() { return DevDeskUtil.switchFor(this.KEY).enabled(); },
  // Off means the loop stops too: the extension is unloaded from the profile.
  setEnabled(on) {
    DevDeskUtil.switchFor(this.KEY).setEnabled(on);
    if (!on && window.vex && typeof window.vex.devextStop === 'function') {
      window.vex.devextStop().catch((err) => DevDeskUtil.fail('Plugin dev loop', err));
    }
    // On every route that flips the switch (not only the Settings toggle): the commands follow it.
    this.registerCommands();
  },

  async pick() {
    if (!this.enabled()) throw new Error('The plugin dev loop is switched off (Settings > Developer desk)');
    const r = await DevDeskUtil.bridge('devextPick')();
    if (r && r.canceled) return null;
    DevDeskUtil.touch(this.FEATURE);
    return r;
  },
  status() { return DevDeskUtil.bridge('devextStatus')(); },
  async reload() { return DevDeskUtil.bridge('devextReload')(); },
  async stop() { return DevDeskUtil.bridge('devextStop')(); },

  // ---- the screen ----------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) throw new Error('The plugin dev loop is switched off (Settings > Developer desk)');
    DevDeskUtil.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-plugin-dev', title: 'Plugin dev loop', sub: 'An unpacked extension, loaded from its folder and reloaded when you save.' });
    this._body = body;
    await this.draw();
    this._schedule();
  },
  _schedule() {
    setTimeout(() => {
      if (!this._body || !this._body.isConnected) return;
      this.draw().catch(err => DevDeskUtil.fail('Plugin dev loop', err)).finally(() => this._schedule());
    }, 3000);
  },
  async draw() {
    const body = this._body;
    if (!body || !body.isConnected) return;
    const S = VexSettingsGroups;
    const st = await this.status();
    body.textContent = '';
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); await this.draw(); } catch (err) { DevDeskUtil.fail(text, err); } }, opts);
    const bar = DevDeskUtil.el('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
    bar.append(act(st.active ? 'Pick another folder' : 'Pick the extension folder', () => this.pick(), { primary: true }));
    if (st.active) bar.append(act('Reload now', () => this.reload()), act('Stop', () => this.stop(), { danger: true }));
    body.appendChild(bar);
    if (!st.active) {
      body.appendChild(S.note('No extension is being developed. Pick the folder that holds its manifest.json.'));
    } else {
      body.appendChild(S.note(st.name + ' ' + st.version + ' (manifest v' + st.manifestVersion + ') from ' + st.folder));
      body.appendChild(S.note('Reloaded ' + st.reloads + ' time' + VexPlural.s(st.reloads) + (st.loadedAt ? ', last ' + DevDeskUtil.ago(st.loadedAt) : '') + '.'));
      if (st.lastError) {
        const e = S.note('Last problem: ' + st.lastError);
        e.style.color = 'var(--danger, #e5484d)';
        body.appendChild(e);
      }
      const rep = st.report;
      if (rep) {
        body.appendChild(S.note('Read ' + rep.filesRead + ' source file' + VexPlural.s(rep.filesRead) + (rep.truncated ? ' (more were skipped: too many or too large)' : '') + '.'));
        if (!rep.unsupported.length) body.appendChild(S.note('Nothing in the source uses an API Vex lacks.'));
        for (const u of rep.unsupported) {
          const row = DevDeskUtil.el('div', 'vexsr-rule');
          const t = DevDeskUtil.el('span', 'vexsr-host');
          t.appendChild(DevDeskUtil.el('div', '', 'chrome.' + u.api + ' - ' + u.what));
          t.appendChild(DevDeskUtil.el('div', 'vexsr-mode', u.manifestOnly ? 'Only declared in the manifest' : u.hits.map(h => h.file + ':' + h.line).join(', ')));
          row.appendChild(t);
          body.appendChild(row);
        }
        for (const c of rep.cautions) body.appendChild(S.note(c));
      }
    }
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('plugindev:', this.enabled() ? [{
      id: 'plugindev:open', label: 'Plugin dev loop', icon: 'code', hint: 'Load an unpacked extension folder and reload it on save',
      action: () => { this.open().catch(err => DevDeskUtil.fail('Plugin dev loop', err)); },
    }] : []);
    return true;
  },
  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Plugin dev loop: load an unpacked extension from its folder, reload it when you save, and see which chrome.* APIs it uses that Vex lacks. Not kept across restarts.'));
    body.appendChild(S.toggle('Plugin dev loop', this.enabled(), (on) => { this.setEnabled(on); VexSettingsGroup.refresh('setting-dev-desk'); }));
    if (this.enabled()) body.appendChild(S.button('Open the plugin dev loop', () => { this.open().catch(err => DevDeskUtil.fail('Plugin dev loop', err)); }));
  },
};

if (typeof window !== 'undefined') {
  window.PluginDev = PluginDev;
  PluginDev.registerCommands();
  document.addEventListener('DOMContentLoaded', () => PluginDev.registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PluginDev };
