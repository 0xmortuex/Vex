// === Plugin dev loop: an unpacked extension that reloads when you save ===========
//
// Pick the folder of an extension you are writing (the folder dialog). Vex loads it
// from that folder, watches it, and reloads it when a file changes. Next to the status
// it lists every chrome.* namespace your source uses that Vex does not provide
// (history, bookmarks, sidePanel...), so a missing API is a line in a list and not an
// extension that does nothing.
//
// The Vencord part lists the Vencord builds Vex has installed (version, time, size, a SHA-256 of the
// bundle) so you can tell which one is loaded, and has two tools for YOUR OWN local Vencord checkout
// (main/discord-dev.js): "Reload my build" puts the dist/browser.js you pick in place of the installed
// bundle and reloads the Discord panel (the original is kept and can be put back), and the console tray
// shows the Discord panel's console lines (redacted, in memory only). A file that is not the browser.js of a
// Vencord source checkout is refused. Vex never builds or downloads anything here.
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

  // ---- your own Vencord build (T2-018) -----------------------------------------------------------------
  async vencordPick() {
    if (!this.enabled()) throw new Error('The plugin dev loop is switched off (Settings > Developer desk)');
    const r = await DevDeskUtil.bridge('devextVencordPick')();
    if (r && r.canceled) return null;
    DevDeskUtil.touch(this.FEATURE);
    return r;
  },
  async vencordReload() {
    if (!this.enabled()) throw new Error('The plugin dev loop is switched off (Settings > Developer desk)');
    const st = await DevDeskUtil.bridge('devextVencordStatus')();
    if (!st.granted) throw new Error('Pick your browser.js first');
    const ok = await vexConfirm({ title: 'Reload your Vencord build?', message: 'Vex puts ' + st.granted.file + ' in place of the bundle of the installed Vencord and reloads the Discord panel. The original is kept; "Put the original back" restores it.', okLabel: 'Reload' });
    if (!ok) return null;
    DevDeskUtil.touch(this.FEATURE);
    const r = await DevDeskUtil.bridge('devextVencordReload')();
    window.showToast?.('Reloaded your build in ' + r.panelsReloaded + ' Discord page(s)');
    return r;
  },
  async vencordRestore() {
    const ok = await vexConfirm({ title: 'Put the original Vencord back?', message: 'The bundle Vex kept the first time is copied back and the Discord panel reloads.', okLabel: 'Put it back' });
    if (!ok) return null;
    const r = await DevDeskUtil.bridge('devextVencordRestore')();
    window.showToast?.('The original Vencord bundle is back');
    return r;
  },
  async consoleStart() { return DevDeskUtil.bridge('devextConsoleStart')(); },
  async consoleStop() { return DevDeskUtil.bridge('devextConsoleStop')(); },
  async consoleClear() { return DevDeskUtil.bridge('devextConsoleClear')(); },
  async consoleList(level, since) { return DevDeskUtil.bridge('devextConsoleList')(level || 'verbose', since || 0); },
  // The text of the tray for Copy (one line per entry).
  consoleText(lines) { return lines.map(l => new Date(l.t).toLocaleTimeString() + ' [' + l.level + '] ' + l.text + (l.source ? ' (' + l.source + ':' + l.line + ')' : '')).join('\n'); },

  // ---- the screen ----------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) throw new Error('The plugin dev loop is switched off (Settings > Developer desk)');
    DevDeskUtil.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-plugin-dev', title: 'Plugin dev loop', sub: 'An unpacked extension, loaded from its folder and reloaded when you save. Vencord below is read-only.' });
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
    let vencord;
    try { vencord = await DevDeskUtil.bridge('devextVencord')(); } catch (err) { vencord = { error: err.message }; }
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
    const head = DevDeskUtil.el('div', '', 'Vencord builds installed in Vex (read-only)');
    head.style.cssText = 'font-weight:600;margin-top:14px';
    body.appendChild(head);
    if (vencord.error) body.appendChild(S.note('Could not list them: ' + vencord.error));
    else if (!vencord.length) body.appendChild(S.note('No Vencord build is installed.'));
    else {
      for (const v of vencord) {
        body.appendChild(S.note(v.folder + (v.loadable ? '' : ' - cannot load (no readable manifest.json)') + ' - version ' + (v.version || '?') + ' - ' + new Date(v.modified).toLocaleString()
          + (v.bundle ? ' - ' + v.bundle + ' ' + Math.round(v.bytes / 1024) + ' KB' : '') + (v.sha256 ? ' - SHA-256 ' + v.sha256.slice(0, 16) + '...' : '')));
      }
      body.appendChild(S.note('To check your own build is the loaded one, compare the SHA-256 above with: certutil -hashfile <your bundle> SHA256.'));
    }
    await this.drawVencordDev(body, act);
  },

  // Reload my build + the Discord console tray.
  async drawVencordDev(body, act) {
    const S = VexSettingsGroups;
    const st = await DevDeskUtil.bridge('devextVencordStatus')();
    const head = DevDeskUtil.el('div', '', 'Your own Vencord build');
    head.style.cssText = 'font-weight:600;margin-top:14px';
    body.appendChild(head);
    body.appendChild(S.note('Pick the dist/browser.js of your Vencord source checkout (the folder above dist must hold a package.json named vencord). Reload puts it in place of the installed bundle and reloads the Discord panel; the original is kept. Any other file is refused.'));
    if (st.error) body.appendChild(S.note(st.error));
    if (st.granted) body.appendChild(S.note('Picked: ' + st.granted.file + ' (' + st.granted.name + ' ' + st.granted.version + ', ' + Math.round(st.granted.bytes / 1024) + ' KB, SHA-256 ' + st.granted.sha256.slice(0, 16) + '...)'));
    if (st.installed) body.appendChild(S.note('Installed: ' + st.installed.folder + ' / ' + st.installed.bundle + (st.replaced ? ' (replaced by your build; the original is kept)' : ' (original)')));
    const bar = DevDeskUtil.el('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    bar.append(act(st.granted ? 'Pick another browser.js' : 'Pick my browser.js', () => this.vencordPick()));
    if (st.granted) bar.append(act('Reload my build', () => this.vencordReload(), { primary: true }));
    if (st.replaced) bar.append(act('Put the original back', () => this.vencordRestore(), { danger: true }));
    body.appendChild(bar);

    const th = DevDeskUtil.el('div', '', 'Discord console');
    th.style.cssText = 'font-weight:600;margin-top:14px';
    body.appendChild(th);
    const tray = await this.consoleList(this._level, 0);
    body.appendChild(S.note(tray.state.on
      ? 'Listening to ' + tray.state.panels + ' Discord page(s) until ' + new Date(tray.state.until).toLocaleTimeString() + '. Lines are redacted and kept in memory only (' + tray.state.lines + ').'
      : 'Off. While on, the Discord panel console lines are kept in memory (redacted, at most 300, not written to disk) for 30 minutes.'));
    const tb = DevDeskUtil.el('div');
    tb.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    if (!tray.state.on) tb.append(act('Start the console tray', () => this.consoleStart()));
    else {
      tb.append(act('Stop', () => this.consoleStop()), act('Clear', () => this.consoleClear()));
      for (const lv of ['verbose', 'warning', 'error']) {
        const b = act(lv === 'verbose' ? 'All' : lv === 'warning' ? 'Warnings and errors' : 'Errors', async () => { this._level = lv; }, { label: 'Show ' + lv });
        b.setAttribute('aria-pressed', String((this._level || 'verbose') === lv));
        tb.append(b);
      }
      tb.append(act('Copy', async () => { await navigator.clipboard.writeText(this.consoleText(tray.lines)); window.showToast?.('Console lines copied'); }));
    }
    body.appendChild(tb);
    if (tray.state.on) {
      const box = DevDeskUtil.el('pre');
      box.style.cssText = "max-height:220px;overflow:auto;margin:8px 0 0;padding:8px;border:1px solid var(--border);border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:11.5px;white-space:pre-wrap;word-break:break-word;user-select:text";
      box.setAttribute('role', 'log');
      box.setAttribute('aria-label', 'Discord console lines');
      box.textContent = tray.lines.length ? this.consoleText(tray.lines.slice(-80)) : 'Nothing logged yet.';
      body.appendChild(box);
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
    body.appendChild(S.note('Plugin dev loop: load an unpacked extension from its folder, reload it when you save, and see which chrome.* APIs it uses that Vex lacks. Also lists installed Vencord builds (read-only). Not kept across restarts.'));
    body.appendChild(S.toggle('Plugin dev loop', this.enabled(), (on) => { this.setEnabled(on); this.registerCommands(); VexSettingsGroup.refresh('setting-dev-desk'); }));
    if (this.enabled()) body.appendChild(S.button('Open the plugin dev loop', () => { this.open().catch(err => DevDeskUtil.fail('Plugin dev loop', err)); }));
  },
};

if (typeof window !== 'undefined') {
  window.PluginDev = PluginDev;
  PluginDev.registerCommands();
  document.addEventListener('DOMContentLoaded', () => PluginDev.registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PluginDev };
