// === Offer "pick up unfinished downloads after a restart", once =================
//
// download-resume.js (main) can carry a download on after Vex was closed, but only when the person turned it on
// (Settings > Downloads, off by default). Nothing here turns it on. When a big download is interrupted and the
// setting is off, ONE quiet row waits in the Attention Inbox with a "Turn on" button; pressing the button is the
// choice. Once the row has been put in the Inbox the feature is muted there (the same "Never for this" the Inbox
// offers, listed in Settings > Attention with a way back), so it is not offered a second time.
//
// downloads-panel.js announces an interruption with the event vex:download-interrupted; this file loads after
// start-up (js/lazy-boot.js), so an interruption in the first seconds is simply not offered.
const VexDownloadResumeOffer = {
  FEATURE: 'download-resume',
  LABEL: 'Downloads',
  MIN_BYTES: 5 * 1024 * 1024,   // the size download-resume.js keeps a second name for; smaller files are fetched again

  // Pure: is this interruption worth the offer? detail = { totalBytes, canResume, ephemeral }.
  worthOffering(detail) {
    const d = detail || {};
    if (d.ephemeral) return false;                        // private, off-the-record and Tor downloads are never kept across a restart
    if (!d.canResume) return false;                       // the server did not promise a resumable file
    return Number.isFinite(d.totalBytes) && d.totalBytes >= this.MIN_BYTES;
  },

  rowFor() {
    return {
      feature: this.FEATURE, label: this.LABEL, id: 'offer',
      title: 'A download was interrupted',
      body: 'Vex can carry unfinished downloads on after a restart, if the site allows it. It is off now. Nothing changes unless you press the button.',
      action: { label: 'Turn on', key: 'turn-on' },
    };
  },

  // Returns true when the row was added. deps lets a test pass fakes.
  async offer(detail, deps = {}) {
    const api = deps.api || (typeof window !== 'undefined' && window.vex);
    const attention = deps.attention || (typeof VexAttention !== 'undefined' ? VexAttention : null);
    if (!this.worthOffering(detail) || !attention || !api || typeof api.downloadsPrefs !== 'function') return false;
    if (attention.isMuted(this.FEATURE)) return false;
    const prefs = await api.downloadsPrefs();
    if (!prefs || !prefs.ok) throw new Error((prefs && prefs.error) || 'Vex did not say whether unfinished downloads carry on');
    if (prefs.resume) return false;
    const added = attention.suggest(this.rowFor());
    if (added) attention.mute(this.FEATURE, this.LABEL);
    return !!added;
  },

  async handle(key, deps = {}) {
    if (key !== 'turn-on') return false;
    const api = deps.api || window.vex;
    const r = await api.downloadsSetResume(true);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Vex did not answer');
    const toast = deps.toast || window.showToast;
    if (typeof toast === 'function') toast('Unfinished downloads will now carry on after a restart', 'info');
    if (typeof DownloadsPanel !== 'undefined' && typeof DownloadsPanel.showPrefs === 'function') DownloadsPanel.showPrefs(r);
    return true;
  },

  start() {
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.FEATURE, (key) => this.handle(key).catch((err) => window.VexProblems?.note('Downloads', 'Could not turn on carrying on unfinished downloads', err)));
    }
    document.addEventListener('vex:download-interrupted', (e) => {
      this.offer(e.detail).catch((err) => window.VexProblems?.note('Downloads', 'Could not offer carrying on unfinished downloads', err));
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexDownloadResumeOffer = VexDownloadResumeOffer;
  VexDownloadResumeOffer.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDownloadResumeOffer };
