// === Proxy and root-certificate changes: the Settings row, "Look now" and Ctrl+K ==========
//
// The work is in the main process (src/main/network-drift.js): two read-only Windows commands, a fingerprint kept in the profile,
// and Attention Inbox rows for what is new. This file is only the switch (OFF until chosen), the "Check now" button and the words.
//
// Honest about itself: it can see the system proxy / setup script of this Windows user and the root certificates this Windows user
// trusts, and what was added since the last look. It cannot see the computer-wide certificate store, a change made and undone between
// two looks, or tell a school's proxy from a snoop's. A program running as you could also edit Vex's small record.
const VexNetworkDrift = {
  // What a look found, in one sentence.
  summary(r) {
    if (!r) throw new Error('The look did not answer');
    if (r.baseline) return 'First look done. Vex now knows your proxy setting and the root certificates you trust; from the next look it tells you what changed.';
    if (r.proxy === 'appeared' || r.proxy === 'changed' || r.added > 0) return 'Something changed since the last look. The Attention Inbox says what.';
    return 'Nothing changed since the last look.';
  },

  _api() {
    const api = window.vex && window.vex.netDrift;
    if (!api || typeof api.get !== 'function') throw new Error('The proxy and certificate look is not available in this window');
    return api;
  },
  async state() {
    const r = await this._api().get();
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not read the setting');
    return r;
  },
  async setOn(on) {
    const r = await this._api().set(on === true);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not change the setting');
    return r.enabled;
  },
  // Looks now, whatever the switch says: pressing the button is the permission.
  async checkNow() {
    const r = await this._api().check();
    if (!r || !r.ok) throw new Error((r && r.error) || 'The look failed');
    return r;
  },

  async runCommand() {
    const s = await this.state();
    if (!s.supported) { window.showToast?.('This check is for Windows only'); return; }
    window.showToast?.('Looking at the proxy and certificates...');
    window.showToast?.(this.summary(await this.checkNow()));
  },

  _t(text) { return typeof window.vexTr === 'function' ? window.vexTr(text) : text; },

  registerSettings() {
    const G = window.VexSettingsGroups;
    if (!G || this._registered) return;
    this._registered = true;
    G.register({
      id: 'network-drift', title: 'Security: proxy and certificate changes', keywords: 'proxy pac root certificate trust store school work antivirus vpn snoop network traffic',
      render: (body) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:block;margin:4px 0';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        label.append(cb, document.createTextNode(' ' + this._t('Look for proxy and certificate changes')));
        const status = document.createElement('div');
        status.setAttribute('role', 'status');
        status.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin:4px 0';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn-secondary'; btn.textContent = 'Check now';
        body.append(label, btn, status, G.note(this._t('Off until you switch it on. When on, a minute and a half after Vex starts it runs two read-only Windows commands (the Internet Settings registry key, and a list of the root certificates your Windows account trusts) and keeps only a fingerprint. If a proxy or proxy setup script appeared or changed, or a root certificate was added since the last look, the Attention Inbox tells you once. It could be your school or work, an antivirus or a VPN, or someone listening in: Vex cannot tell which, and never changes a Windows setting. It does not see certificates installed for the whole computer, or a change made and undone between two looks, and a program running as you could edit its record.')));
        const fail = (err) => { window.showToast?.(err.message, 'error'); };
        this.state().then((s) => {
          cb.checked = s.enabled;
          if (!s.supported) { cb.disabled = true; btn.disabled = true; status.textContent = this._t('This check is for Windows only'); }
          else status.textContent = s.hadBaseline ? this._t('Known: your proxy setting and the root certificates you trust.') : this._t('Nothing is recorded yet. The first look only records.');
        }, fail);
        cb.addEventListener('change', () => {
          this.setOn(cb.checked).then((now) => { cb.checked = now; }, (err) => { cb.checked = !cb.checked; fail(err); });
        });
        btn.addEventListener('click', () => {
          btn.disabled = true;
          this.checkNow().then((r) => { status.textContent = this._t(this.summary(r)); }, fail).finally(() => { btn.disabled = false; });
        });
      },
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexNetworkDrift = VexNetworkDrift;
  if (typeof document !== 'undefined' && window.vex) {
    try { VexNetworkDrift.registerSettings(); } catch (err) { window.VexProblems?.note('Network changes', 'The Settings section could not be added', err); }
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNetworkDrift };
