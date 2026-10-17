// === "Why was I signed out?" - the part you see ===============================
//
// main/signout-why.js keeps a local record of when a site's sign-in cookie went
// and which rule ended it (names, session flag and dates only, never a value).
// This file shows it:
//   - Ctrl+K > "Why was I signed out?" explains the open site (or the latest
//     losses of any site);
//   - when a saved password signs you in again on a site whose sign-in was lost
//     in the last three days, ONE line says why, once per loss, with a Details
//     button. Through VexAttention.gate, so never in Game mode or quiet.
// It clears nothing and changes no setting.
const VexSignoutWhy = {
  KEY: 'vex.signoutWhy',           // '0' = do not say it after a sign-in
  SAID_KEY: 'vex.signoutWhy.said', // { host: timestamp of the loss already announced }
  FRESH_MS: 3 * 24 * 3600 * 1000,

  enabled() { try { return localStorage.getItem(this.KEY) !== '0'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); },

  _said() {
    try { const v = JSON.parse(localStorage.getItem(this.SAID_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    catch (err) { console.error('[SignoutWhy] the list of announced losses is damaged and starts again:', err); return {}; }
  },
  _markSaid(host, t) {
    const said = this._said();
    said[host] = t;
    const keys = Object.keys(said);
    if (keys.length > 100) delete said[keys[0]];
    localStorage.setItem(this.SAID_KEY, JSON.stringify(said));
  },

  explain(host) { return window.vex.signoutWhy(host || null); },

  // The words for the dialog: one paragraph per loss.
  describe(report) {
    if (!report.lines.length) {
      return (report.domain ? 'Nothing was recorded about ' + report.domain + ' in the last ' + report.windowDays + ' days.' : 'No lost sign-ins were recorded in the last ' + report.windowDays + ' days.')
        + '\n\nVex is watching the sign-in cookies of ' + report.watching + ' site' + VexPlural.s(report.watching) + '. A sign-in that ends while Vex is closed shows up after the next start.';
    }
    return report.lines.map((l) => {
      const d = new Date(l.t).toISOString().slice(0, 10);
      return d + '  ' + l.line + (l.where ? '\nChange it: ' + l.where : '');
    }).join('\n\n');
  },
  async show(host) {
    const report = await this.explain(host);
    await window.vexAlert({ title: host ? 'Why was I signed out of ' + report.domain + '?' : 'Why was I signed out?', message: this.describe(report) });
    return report;
  },

  // After a password fill on `host`.
  async announce(host) {
    if (!this.enabled() || !host) return false;
    const report = await this.explain(host);
    const newest = report.lines[0];
    if (!newest || Date.now() - newest.t > this.FRESH_MS || (this._said()[report.domain] || 0) >= newest.t) return false;
    if (typeof VexAttention !== 'undefined' && !VexAttention.gate('signout-why', report.domain)) return false;
    this._markSaid(report.domain, newest.t);
    window.showToast?.(newest.line, 'info', 14000, { action: { label: 'Details', title: 'Everything recorded about ' + report.domain, run: () => this.show(host).catch(err => window.showToast?.(err.message, 'error')) } });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexSignoutWhy = VexSignoutWhy;
  window.addEventListener('vex:autofill-logged', (e) => {
    const d = e && e.detail;
    if (!d || d.kind !== 'password' || !d.ok || !window.vex || typeof window.vex.signoutWhy !== 'function') return;
    VexSignoutWhy.announce(d.host).catch(err => console.error('[SignoutWhy] could not look up why the sign-in was lost:', err));
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSignoutWhy };
