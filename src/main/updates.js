function bindUpdater(updater, getWindow) {
  if (!updater) return () => {};
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  const listeners = [];
  const bind = (event, channel, payload = value => value) => {
    const listener = value => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send(channel, payload(value)); };
    updater.on(event, listener); listeners.push([event, listener]);
  };
  bind('update-available', 'update-available', value => ({ version: value.version, releaseNotes: value.releaseNotes }));
  bind('update-not-available', 'update-not-available', () => null);
  bind('download-progress', 'update-download-progress', value => ({ percent: Math.round(value.percent), transferred: value.transferred, total: value.total }));
  bind('update-downloaded', 'update-downloaded', value => ({ version: value.version }));
  bind('error', 'update-error', error => ({ message: error.message }));
  return () => { for (const [event, listener] of listeners) updater.removeListener(event, listener); };
}
module.exports = { bindUpdater };
