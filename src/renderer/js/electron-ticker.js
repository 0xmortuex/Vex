// === Electron / castLabs compatibility ticker =====================================
//
// Vex is built on one castLabs Electron (the build with Widevine and VMP signing). A
// security release, or a VMP-signing rebuild, is easy to miss. This compares the version
// this build runs with castlabs/electron-releases' public tag list and says
// "N behind".
//
//   - one bounded GET to api.github.com in the main process (src/main/castlabs-ticker.js),
//     no credentials, cached six hours; the ask is listed in the egress ledger;
//   - "behind" = releases newer than yours on the SAME major line; a newer major is
//     mentioned separately, because moving to one is a decision, not a catch-up;
//   - a new "behind" number is a suggestion in the Attention Inbox, never a toast;
//   - a failed check is said out loud, never turned into "0 behind".
//
// Off until switched on.
const ElectronTicker = {
  KEY: 'vex.electronTicker',
  FEATURE: 'electron-ticker',
  EVERY_MS: 6 * 3600 * 1000,
  ...DevDeskUtil.switchFor('vex.electronTicker.enabled'),
  last: null,

  // The sentence for a result (pure, tested).
  describe(r) {
    if (!r) return 'Not checked yet';
    const line = 'Vex runs Electron ' + r.pinned + (r.chrome ? ' (Chromium ' + String(r.chrome).split('.')[0] + ')' : '');
    const behind = r.behind === 0 ? 'up to date on the ' + r.pinned.split('.')[0] + ' line' : r.behind + ' behind (newest of the line: ' + r.latestSameMajor + ')';
    const major = r.newerMajor > 0 ? '; a newer major exists (' + r.latest + ')' : '';
    const unlisted = r.pinnedListed ? '' : '; this exact version is not in the castLabs list';
    return line + ': ' + behind + major + unlisted;
  },

  async check(force = false) {
    if (!this.enabled()) throw new Error('The Electron ticker is switched off (Settings > Developer desk)');
    DevDeskUtil.touch(this.FEATURE);
    const r = await DevDeskUtil.bridge('castlabsBehind')(force);
    this.last = r;
    const s = DevDeskUtil.read(this.KEY, () => ({}));
    const told = s.told || '';
    const mark = r.pinned + '>' + r.latestSameMajor;
    if (r.behind > 0 && told !== mark) {
      if (typeof VexAttention !== 'undefined') {
        VexAttention.suggest({ feature: this.FEATURE, label: 'Electron ticker', id: mark, title: 'Electron is ' + r.behind + ' behind on castLabs', body: this.describe(r) });
      }
      s.told = mark;
      DevDeskUtil.write(this.KEY, s);
    }
    document.dispatchEvent(new CustomEvent('vex:electron-ticker'));
    return r;
  },

  start() {
    if (this._job || typeof VexJobs === 'undefined') return;
    this._job = VexJobs.every('Electron ticker', this.EVERY_MS, () => (this.enabled() ? this.check() : Promise.resolve()).catch((err) => DevDeskUtil.fail('Electron ticker', err)), { feature: this.FEATURE, when: 'background' });
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } },
  sync() { if (this.enabled()) this.start(); else this.stop(); },
  // Runs on every route that flips the switch (DevDeskUtil.switchFor).
  followEnabled() { this.sync(); this.registerCommands(); },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('electronticker:', this.enabled() ? [{
      id: 'electronticker:check', label: 'Electron: how far behind castLabs', icon: 'code', hint: this.last ? this.describe(this.last) : 'Compare this Electron with the newest castLabs release',
      action: () => { this.check(true).then(r => window.showToast?.(this.describe(r))).catch(err => DevDeskUtil.fail('Electron ticker', err)); },
    }] : []);
    return true;
  },
  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Electron ticker: compares the Electron this Vex runs with the newest castLabs releases (one public GitHub request every six hours, no account). A new "behind" number is a suggestion in the Attention Inbox.'));
    body.appendChild(S.toggle('Electron ticker', this.enabled(), (on) => { this.setEnabled(on); VexSettingsGroup.refresh('setting-dev-desk'); }));
    if (!this.enabled()) return;
    body.appendChild(S.note(this.describe(this.last)));
    body.appendChild(S.button('Check now', () => { this.check(true).then(() => VexSettingsGroup.refresh('setting-dev-desk')).catch(err => DevDeskUtil.fail('Electron ticker', err)); }));
  },
};

if (typeof window !== 'undefined') {
  window.ElectronTicker = ElectronTicker;
  ElectronTicker.sync();
  ElectronTicker.registerCommands();
  document.addEventListener('DOMContentLoaded', () => { ElectronTicker.sync(); ElectronTicker.registerCommands(); });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ElectronTicker };
