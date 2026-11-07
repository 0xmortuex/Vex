// === Pause all downloads / resume all downloads ===========================================================
//
// Two Ctrl+K commands for the person who needs the connection for a moment (a call, a game, a page that will not load) and does not
// want to find every download in the panel. They only press Pause or Resume on the transfers that are running; nothing is cancelled,
// nothing is scheduled, nothing runs by itself.
//
// Why not "limit download speed to N MB/s": Chromium has no speed limit for one download. The only throttle in Electron,
// session.enableNetworkEmulation, applies to the whole session, so every page load would be slowed too. A limit that makes browsing
// slow is worse than none, so it was not built; stopping and starting is what can be done honestly.
const VexDownloadPause = {
  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // The sentence for a result from main: { changed, failed }. Pure.
  say(paused, r) {
    const changed = Number(r && r.changed) || 0, failed = Number(r && r.failed) || 0;
    if (!changed && !failed) return this._t(paused ? 'No download is running' : 'No download is paused');
    const head = this._t(paused ? 'Downloads paused: {1}' : 'Downloads resumed: {1}').replace('{1}', String(changed));
    return failed ? head + '. ' + this._t('Could not change: {1}').replace('{1}', String(failed)) : head;
  },

  async set(paused) {
    const v = window.vex;
    if (!v || typeof v.downloadsSetAllPaused !== 'function') throw new Error('Downloads cannot be paused in this window');
    const r = await v.downloadsSetAllPaused(!!paused);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The downloads could not be changed');
    window.showToast?.(this.say(!!paused, r), r.failed ? 'warn' : 'info');
    return r;
  },
};

if (typeof window !== 'undefined') {
  window.VexDownloadPause = VexDownloadPause;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'downloads-pause-all', label: 'Pause All Downloads', hint: 'Pauses every download that is running, so the connection is free; nothing is cancelled', icon: 'download', action: () => { VexDownloadPause.set(true).catch((err) => { window.VexProblems?.note('Downloads', 'the downloads could not be paused', err); window.showToast?.(err.message, 'error'); }); } });
    VexExtras.registerCommand({ id: 'downloads-resume-all', label: 'Resume All Downloads', hint: 'Starts every paused download again', icon: 'download', action: () => { VexDownloadPause.set(false).catch((err) => { window.VexProblems?.note('Downloads', 'the downloads could not be resumed', err); window.showToast?.(err.message, 'error'); }); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDownloadPause };
