// === "Many of your logins look gone": the window's half ======================
//
// main/mass-signout.js compares, once at start, how many sites you are signed in
// to with what the last run saw. When it fell by more than half, main tells this
// window once, and the Attention Inbox gets one item that points at the newest
// backup that checks out. Opening it opens Settings > Back up everything, where the
// backups are listed with Restore and Test.
//
// Said honestly in the item: a backup holds your settings, rules and notes, not the
// sign-in cookies of the sites (those are the sites' to give back), so signing in
// again is still needed; saved logins and authenticator codes come back from an
// encrypted secrets file, if you made one.
const VexMassSignout = {
  FEATURE: 'mass-signout',

  _api() { return window.vex && window.vex.signins ? window.vex.signins : null; },

  start() {
    const api = this._api();
    if (!api || window.VexTabPolicy?.isPrivateWindow) return;
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.FEATURE, (key) => {
        if (key === 'open' && window.VexBackup) window.VexBackup.open();
      });
    }
    // Once the inbox has it, main forgets it, so a reloaded window does not add it again after it was dismissed.
    const take = (info) => {
      if (this.note(info)) return api.dismiss().catch(err => window.VexProblems?.note('mass-signout', 'Could not tell main the notice was filed', err));
      return undefined;
    };
    api.onMassDrop((info) => take(info));
    // The notice may have been sent before this module loaded: ask once.
    api.pending().then((info) => (info ? take(info) : undefined))
      .catch(err => window.VexProblems?.note('mass-signout', 'Could not ask whether many sign-ins were lost', err));
  },

  // info: { before, now, backup: { name, at } | null } -> true when the inbox took it
  note(info) {
    if (!info || !Number.isInteger(info.before) || !Number.isInteger(info.now)) return false;
    if (typeof AttentionInbox === 'undefined') { window.VexProblems?.note('mass-signout', 'The Attention Inbox is not loaded, so the lost sign-ins were not announced'); return false; }
    const tr = (t) => (window.vexTr ? window.vexTr(t) : t);
    const where = info.backup && Number.isFinite(info.backup.at)
      ? tr('The newest backup that checks out is from') + ' ' + new Date(info.backup.at).toLocaleString() + '. '
      : tr('Vex has no backup that checks out yet.') + ' ';
    const body = tr('Sites you were signed in to') + ': ' + info.before + ' → ' + info.now + '. ' + where
      + tr('A backup brings back your settings and rules, not the sites’ sign-in cookies; saved logins come back from an encrypted secrets file.');
    return AttentionInbox.add({ feature: this.FEATURE, id: 'drop', label: 'Sign-ins', title: 'Many of your sign-ins look gone', body, action: { label: 'Open backups', key: 'open' } });
  },
};

if (typeof window !== 'undefined') {
  window.VexMassSignout = VexMassSignout;
  VexMassSignout.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMassSignout };
