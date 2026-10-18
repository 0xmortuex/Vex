// === Credential-entry interlock (T2-089) ======================================
//
// When a password field takes focus on a page, Vex asks main (src/main/credential-guard.js)
// whether the page's address is somewhere a login belongs: a site you have a saved login for,
// one you use a lot, or a well-known brand's own address, is passed without a word. An address
// made to look like one of those (paypa1.com, roblox.com.verify-account.xyz, letters from two
// alphabets, a bare number address) stops here with a question, before anything is typed:
//
//   "This is not roblox.com. You are about to type a password on <address>."
//   [Leave this page]  [Continue anyway]
//
// It never blocks without saying so and never decides for you: Continue anyway is one click,
// and is remembered for that address in that tab until it navigates elsewhere. Nothing is
// looked up on the internet and the field's contents are never read.
const CredentialInterlock = {
  KEY: 'vex.credGuard.enabled',    // '0' = off
  FEATURE: 'credential-interlock',
  _passed: new Map(),              // webview -> Set of hosts the person chose to continue on
  _asking: new WeakSet(),

  enabled() { try { return localStorage.getItem(this.KEY) !== '0'; } catch (err) { console.error('[CredGuard] the switch could not be read:', err.message); return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); },

  // The words of the question, from the verdict. Pure.
  words(verdict) {
    const host = verdict.host;
    const title = verdict.resembles ? 'This is not ' + verdict.resembles : 'This address is not what it looks like';
    return { title, message: 'You are about to type a password on ' + host + '. ' + verdict.line + '\n\nIf you did not type this address yourself, leave. Real sites do not ask you to sign in from an address like this.' };
  },

  async onFocus(webview, data) {
    if (!this.enabled() || !webview || this._asking.has(webview)) return false;
    if (!window.vex || typeof window.vex.credguardCheck !== 'function') throw new Error('The password-field check is not available in this window');
    const host = String(data.host || '');
    // The page's own address is read from the tab, not taken from what the page reported.
    let actual;
    try { actual = new URL(webview.getURL()); } catch { return false; }   // vex-allow-empty-catch: a page with no readable address is not a website; nothing to check
    if (!/^https?:$/.test(actual.protocol) || actual.hostname.replace(/^www\./, '') !== host) return false;
    const passed = this._passed.get(webview) || new Set();
    if (passed.has(host)) return false;
    let verdict;
    try { verdict = await window.vex.credguardCheck(actual.href); }
    catch (err) { window.showToast?.('Could not check this sign-in page: ' + err.message, 'error'); return false; }
    if (verdict.verdict !== 'warn') return false;
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    this._asking.add(webview);
    try {
      const w = this.words(verdict);
      // The focused button (OK) is the safe choice, leaving; the risky one is Cancel, named plainly. Not 'danger':
      // that style would put the focus on Cancel, so Enter would continue.
      const leave = await vexConfirm({ title: w.title, message: w.message, okLabel: 'Leave this page', cancelLabel: 'Continue anyway' });
      if (leave) {
        try { if (webview.canGoBack && webview.canGoBack()) webview.goBack(); else if (typeof TabManager !== 'undefined') TabManager.closeTab(TabManager.activeTabId); }
        catch (err) { window.showToast?.('Could not leave the page: ' + err.message, 'error'); }
        return true;
      }
      passed.add(host);
      this._passed.set(webview, passed);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Credential guard', 'Continued to a password field on ' + host, verdict.line);
      return true;
    } finally { this._asking.delete(webview); }
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('When a password field takes focus on an address that is made to look like a site you have a login for, or a well-known brand, Vex asks before you type. Nothing is looked up online; the field is never read.'));
    el.appendChild(VexSettingsGroup.toggle('Ask before I type a password on a lookalike address', this.enabled(), (on) => {
      this.setEnabled(on);
      if (typeof VexUsage !== 'undefined') VexUsage.touch('credential-interlock');
    }));
  },
};

if (typeof window !== 'undefined') {
  window.CredentialInterlock = CredentialInterlock;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'credential-interlock', title: 'Password page check', keywords: 'phishing lookalike password field warn wrong site credential interlock', before: 'about', build: (el) => CredentialInterlock.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CredentialInterlock };
