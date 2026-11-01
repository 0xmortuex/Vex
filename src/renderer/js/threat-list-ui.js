// === Dangerous sites: the Settings section and its two Ctrl+K commands ==========
//
// The check itself runs in the main process (src/main/threat-list.js): before a page opens, its
// address is looked up in a list of reported phishing and malware sites kept on this computer. The
// address is never sent anywhere. This file is only what the person touches: the switch, the list's
// date and size, "Update now", the test warning and the sites they told Vex to trust.
//
// Loaded late (lazy-boot.js LATE_MODULES); it starts itself when it loads.
const VexThreatListUI = {
  ID: 'threat-list',
  TITLE: 'Privacy & security: dangerous sites',

  _api() {
    const v = window.vex && window.vex.threat;
    if (!v) throw new Error('Dangerous-site protection is not available in this window');
    return v;
  },
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },

  // The tab the test opens: a name that never resolves and that the check always recognises.
  testAddress(status) { return 'https://' + ((status && status.testHost) || 'vex-safety-test.invalid') + '/'; },

  async openTest() {
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not ready yet');
    const status = await this._api().status();
    TabManager.createTab(this.testAddress(status), true);
  },

  openSettings() {
    if (typeof SettingsUI === 'undefined' || typeof SettingsUI.openSection !== 'function') throw new Error('Settings is not ready yet');
    SettingsUI.openSection('setting-threat-list');
  },

  _size(bytes) {
    if (!bytes) return '0 KB';
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  },

  render(body) {
    const PS = window.ProtectSettings;
    if (!PS) throw new Error('Settings helpers are not loaded');
    const api = this._api();
    body.textContent = '';
    const row = (label, value) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:8px;font-size:12.5px;margin:3px 0';
      const l = document.createElement('span'); l.style.cssText = 'min-width:150px;color:var(--text-muted)'; l.textContent = label;
      const v = document.createElement('span'); v.textContent = value;
      r.append(l, v);
      return r;
    };
    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:12px;color:var(--text-muted);margin:2px 0 8px';
    intro.textContent = 'Vex keeps a list of sites reported for phishing and malware. Before a page opens, its address is looked up in that list on this computer. The address is never sent anywhere.';
    const status = document.createElement('div'); status.setAttribute('role', 'status'); status.style.cssText = 'font-size:12px;margin:6px 0';
    const info = document.createElement('div');
    const trusted = document.createElement('div');
    const fail = (err) => { status.textContent = this._msg(err); window.showToast?.(this._msg(err), 'error'); };

    let enabledBox, autoBox;
    const draw = (s) => {
      enabledBox.checked = s.enabled;
      autoBox.checked = s.autoUpdate;
      info.textContent = '';
      info.append(
        row('Sites on the list', s.count ? s.count.toLocaleString() : 'No list downloaded yet'),
        row('Last updated', s.fetchedAt ? new Date(s.fetchedAt).toLocaleString() : 'Never'),
        row('Size on this computer', this._size(s.bytes)),
      );
      for (const src of s.sources.length ? s.sources : s.available) {
        const r = row('List used', src.name + ' (licence: ' + src.licence + ')');
        info.append(r);
      }
      status.textContent = s.lastError ? 'Problem: ' + s.lastError : (s.updating ? 'Updating the list...' : (s.enabled ? 'On. The last good list is kept if an update fails.' : 'Off. No site is checked.'));
      trusted.textContent = '';
      const h = document.createElement('div'); h.style.cssText = 'font-weight:600;font-size:12.5px;margin:12px 0 4px'; h.textContent = 'Sites you told Vex to stop warning about';
      trusted.append(h);
      if (!s.allow.length) {
        const none = document.createElement('div'); none.style.cssText = 'font-size:12px;color:var(--text-muted)'; none.textContent = 'None.';
        trusted.append(none);
      }
      for (const host of s.allow) {
        const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12.5px;margin:3px 0';
        const name = document.createElement('span'); name.style.flex = '1'; name.textContent = host;
        r.append(name, PS.button('Remove', async () => { try { draw(await api.forgetHost(host)); } catch (err) { fail(err); } }));
        trusted.append(r);
      }
    };

    const enabled = PS.toggle({ text: 'Warn me before opening a site reported as dangerous', checked: true, onChange: async (v) => { try { draw(await api.setEnabled(v)); } catch (err) { fail(err); } } });
    const auto = PS.toggle({ text: 'Download the list automatically, about once a day', hint: 'It is listed in What left this computer as "Safety list"', checked: true, onChange: async (v) => { try { draw(await api.setAutoUpdate(v)); } catch (err) { fail(err); } } });
    enabledBox = enabled.querySelector('input');
    autoBox = auto.querySelector('input');

    const update = PS.button('Update now', async () => {
      status.textContent = 'Updating the list...';
      try { draw(await api.update()); window.showToast?.('The list of dangerous sites is up to date.'); }
      catch (err) { fail(err); try { draw(await api.status()); } catch (e2) { console.error('[ThreatList] status after a failed update:', e2); } }
    }, { icon: 'refresh' });
    const test = PS.button('Show me the warning', async () => { try { await this.openTest(); } catch (err) { fail(err); } }, { icon: 'shield' });

    body.append(intro, enabled, info, auto, update, test, status, trusted);
    api.status().then(draw, fail);
    return body;
  },

  _commands() {
    const fail = (err) => window.showToast?.(this._msg(err), 'error');
    const run = (fn) => () => { Promise.resolve().then(fn).catch(fail); };
    return [
      { id: 'threat:settings', label: 'Dangerous Site Protection', hint: 'The switch, the list of reported phishing and malware sites, its date and Update now', icon: 'shield', action: run(() => this.openSettings()) },
      { id: 'threat:test', label: 'Test the Dangerous Site Warning', hint: 'Opens the warning page Vex shows for a reported site, without any real site', icon: 'shield', action: run(() => this.openTest()) },
    ];
  },

  init() {
    if (this._started) return false;
    this._started = true;
    if (!window.VexSettingsGroups) throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({
      id: 'threat-list', title: this.TITLE, before: 'about',
      keywords: 'dangerous sites phishing malware safe browsing blocklist reported warning scam fake site list update test',
      render: (body) => this.render(body),
    });
    if (window.VexModuleCommands) VexModuleCommands.set('threat:', this._commands());
    return true;
  },
};

if (typeof window !== 'undefined') { window.VexThreatListUI = VexThreatListUI; VexThreatListUI.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexThreatListUI };
