// === Vex Mobile — what went wrong, and what this phone is ===
//
// A browser that cannot say what it failed at is a browser nobody can report a
// bug about. Every uncaught error, every rejected promise and every failure the
// chrome catches on purpose lands here, with the last hundred kept on the device
// and nothing sent anywhere — there is no crash reporter in Vex and there is not
// going to be one.
//
// Beside them: what the WebView actually is. Half of what Vex does is
// conditional on it — private tabs need multi-profile, the fingerprint shield
// needs document-start scripts, dark pages need algorithmic darkening — so when
// one of them quietly does nothing, this is the page that says why.

const VexReport = (() => {
  const KEEP = 100;
  const recent = [];          // the newest first, in memory, for a panel to draw

  // URLs in an error message are usually the point, but a query string can carry
  // a session token and this is a list someone may well screenshot.
  function tidy(text) {
    return String(text || '')
      .replace(/([?&](?:token|key|auth|password|session|code)=)[^&\s]+/gi, '$1…')
      .slice(0, 600);
  }

  function record(kind, message, where) {
    const entry = {
      at: Date.now(),
      kind: String(kind || 'error'),
      message: tidy(message),
      where: tidy(where)
    };
    // A page in a reload loop throws the same thing over and over. Keep it in
    // memory, where it is cheap, but do not write a row for each one: the store
    // is pruned, and a hundred copies of one failure would push out the rest.
    const previous = recent[0];
    const repeat = previous && previous.kind === entry.kind && previous.message === entry.message
      && entry.at - previous.at < 5000;
    recent.unshift(entry);
    if (recent.length > KEEP) recent.length = KEEP;
    // Written behind the in-memory copy so a panel opened immediately after a
    // failure shows it even if the write is still in flight.
    if (!repeat) Promise.resolve(VexDB.add('errors', entry)).catch(() => {});
    return entry;
  }

  return {
    KEEP,
    record,

    /** Something Vex caught and handled, but which the person may still feel. */
    note(message, where) { return record('note', message, where); },

    async all(limit = KEEP) {
      const stored = await VexDB.scan('errors', { index: 'at', direction: 'prev', limit }).catch(() => []);
      const rows = (stored || []).slice();
      // The in-memory copy wins on ties: it is never behind.
      const seen = new Set(rows.map(row => row.at + '|' + row.message));
      for (const entry of recent) {
        if (!seen.has(entry.at + '|' + entry.message)) rows.push(entry);
      }
      return rows.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit);
    },

    async clear() {
      recent.length = 0;
      await VexDB.clear('errors').catch(() => {});
    },

    /** What the native side knows and the chrome cannot see. */
    async device() {
      const report = await VexBridge.deviceReport();
      return report || {};
    },

    /** Everything, as text, for pasting into a bug report. */
    async asText() {
      const device = await this.device();
      const errors = await this.all(20);
      const features = device.webviewFeatures || {};
      const lines = [
        'Vex for Android ' + (device.version || VexUI.version || '?'),
        'Device: ' + (device.device || '?') + ' · Android ' + (device.android || '?')
          + ' (API ' + (device.sdk || '?') + ') · ' + (device.abi || '?'),
        'WebView: ' + (device.webview || '?') + ' ' + (device.webviewVersion || ''),
        'WebView features: ' + Object.entries(features)
          .map(([name, has]) => name + (has ? ' yes' : ' NO')).join(', '),
        'On-device AI: ' + (typeof VexLocalAI === 'undefined' ? 'n/a'
          : (VexLocalAI.state.supported ? 'supported' : 'unsupported')
            + ', mode ' + VexLocalAI.mode() + ', Nano ' + VexLocalAI.state.nano),
        '',
        errors.length ? 'The last ' + errors.length + ' problems:' : 'No problems recorded.'
      ];
      for (const entry of errors) {
        lines.push('· ' + new Date(entry.at).toISOString() + ' [' + entry.kind + '] '
          + entry.message + (entry.where ? ' — ' + entry.where : ''));
      }
      return lines.join('\n');
    },

    /**
     * Catch what would otherwise vanish into the console. Called once at boot;
     * everything here is already a failure, so nothing here may throw.
     */
    bind() {
      window.addEventListener('error', event => {
        try {
          record('error', (event && event.message) || 'Something failed',
            event && event.filename ? event.filename + ':' + event.lineno : '');
        } catch { /* a recorder that throws is worse than no recorder */ }
      });
      window.addEventListener('unhandledrejection', event => {
        try {
          const reason = event && event.reason;
          record('promise', (reason && reason.message) || String(reason || 'rejected'), '');
        } catch { /* as above */ }
      });
    }
  };
})();

if (typeof window !== 'undefined') window.VexReport = VexReport;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReport };
