// The updater's last word, for the Memory panel's Health section.
const state = { lastCheckAt: null, result: null, version: null, error: null };

// electron-updater's errors, in words a person can act on. They came through
// raw: a signature failure was PowerShell's JSON with the full path of the
// installer, a damaged download two sha512 strings (found 2026-09-29).
function plainUpdateError(error) {
  const message = String((error && error.message) || error || '');
  const code = error && error.code;
  if (code === 'ERR_UPDATER_INVALID_SIGNATURE' || /not signed by the application owner/i.test(message)) {
    return 'The downloaded update is not signed the way Vex expects, so it was not installed. Get it from the Vex releases page instead.';
  }
  if (/sha512 checksum mismatch/i.test(message)) return 'The downloaded update was damaged (it did not match its checksum), so it was not installed. Try again.';
  if (/Please check update first/i.test(message)) return 'Vex has not checked for this update yet. Check for updates, then download it.';
  // Anything else: its first line, without file paths.
  const line = message.split(/\r?\n/)[0].replace(/[A-Za-z]:\\[^\s"',]+/g, '(file)').trim();
  return (line.length > 200 ? line.slice(0, 199) + '…' : line) || 'unknown';
}

function bindUpdater(updater, getWindow) {
  if (!updater) return () => {};
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  const listeners = [];
  const bind = (event, channel, payload = value => value) => {
    const listener = value => {
      state.lastCheckAt = Date.now();
      state.result = event;
      if (value && value.version) state.version = value.version;
      state.error = event === 'error' ? plainUpdateError(value) : null;
      const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send(channel, payload(value));
    };
    updater.on(event, listener); listeners.push([event, listener]);
  };
  bind('update-available', 'update-available', value => ({ version: value.version, releaseNotes: value.releaseNotes }));
  bind('update-not-available', 'update-not-available', () => null);
  bind('download-progress', 'update-download-progress', value => ({ percent: Math.round(value.percent), transferred: value.transferred, total: value.total }));
  bind('update-downloaded', 'update-downloaded', value => ({ version: value.version }));
  bind('error', 'update-error', error => ({ message: plainUpdateError(error) }));
  return () => { for (const [event, listener] of listeners) updater.removeListener(event, listener); };
}
module.exports = { bindUpdater, state, plainUpdateError };
