// === Privacy and safety features, wired to the main process =================
//
// One place that builds the five modules below and registers their IPC, so
// main.js needs a single line for all of them:
//
//   privacy-report.js     weekly cookie report and one-click cleanup
//   extension-usage.js    last update / last use of each extension
//   tab-snapshots.js      crash-proof scroll position and form text
//   quiet-hours.js        hold and release desktop toasts
//
// (The breach check lives in vault.js; it predates this and only got a
// rate limit.) Every channel here is UI-only and refused in private windows
// (ipc-policy.js), and every payload has a schema (ipc-schemas.js).
'use strict';

const path = require('path');

function registerProtect({
  ipcMain, getSession, notifier, jsonStore, secretStore, secretsDir, encryptionAvailable,
  trackerHosts = () => [], extensionEntries = () => [], extensionUpdates = () => ({}), statMtime = () => null,
  isLocked = () => false, now = () => Date.now(), log,
}) {
  const note = typeof log === 'function' ? log : () => {};
  const guard = () => { if (isLocked()) throw new Error('Vex is locked'); };

  // --- Privacy report card ---------------------------------------------------
  const rep = require('./privacy-report');
  const tally = rep.createCookieTally({ store: jsonStore, now, log });
  const report = rep.createPrivacyReport({ getCookieJar: () => getSession().cookies, trackerHosts, tally, now, log });
  try {
    getSession().cookies.on('changed', (_e, cookie, cause, removed) => {
      tally.record(cookie, cause, removed).catch(err => note('[PrivacyReport] tally: ' + err.message));
    });
  } catch (err) { note('[PrivacyReport] cookie changes are not being counted: ' + err.message); }
  ipcMain.handle('privacy:report', () => { guard(); return report.report(); });
  ipcMain.handle('privacy:report-clean', (_e, domains) => { guard(); return report.clean(domains); });

  // --- Extension usage -------------------------------------------------------
  const usage = require('./extension-usage').createExtensionUsage({ store: jsonStore, now, log });
  ipcMain.handle('extensions:usage-audit', () => {
    guard();
    return usage.audit(extensionEntries(), { statMtime, updates: extensionUpdates() });
  });

  // --- Crash-proof tabs ------------------------------------------------------
  const snaps = require('./tab-snapshots');
  const snapshots = snaps.createTabSnapshots({
    secrets: secretStore, plain: jsonStore, file: path.join(secretsDir, snaps.ENC_FILE), encryptionAvailable, now, log,
  });
  ipcMain.handle('tabsnap:save', (_e, payload) => { guard(); return snapshots.save(payload); });
  ipcMain.handle('tabsnap:load', () => { guard(); return snapshots.load(); });
  ipcMain.handle('tabsnap:clear', () => snapshots.clear());

  // --- Quiet hours -----------------------------------------------------------
  const realShow = notifier.show.bind(notifier);
  // The Attention Budget for OS toasts (notify.js): urgency classes, caps, dedupe
  // and the attention state the window reports. Quiet hours sits in front of it.
  const attention = require('./notify').createNotifyGate({ show: realShow, now, log });
  const quiet = require('./quiet-hours').createQuietHours({ store: jsonStore, show: attention.gated, now, log });
  // Everything that shows a toast calls notifier.show at the moment it needs
  // one, so replacing the property puts every sender behind the quiet window.
  notifier.show = quiet.gated;
  quiet.init().then(() => quiet.start()).catch(err => note('[QuietHours] could not read its settings: ' + err.message));
  ipcMain.handle('quiet:get', () => quiet.getConfig());
  ipcMain.handle('quiet:set', (_e, cfg) => { guard(); return quiet.setConfig(cfg); });
  ipcMain.handle('quiet:held', () => { guard(); return quiet.heldList(); });
  ipcMain.handle('quiet:release', () => { guard(); return quiet.release(); });
  ipcMain.handle('quiet:drop', () => { guard(); return quiet.dropHeld(); });

  ipcMain.handle('attention:state', (_e, s) => { guard(); return attention.setState(s); });
  ipcMain.handle('attention:denied', () => { guard(); return attention.denied(); });
  ipcMain.handle('attention:clear-denied', () => { guard(); attention.clearDenied(); return true; });

  return { report, usage, snapshots, quiet, tally, attention };
}

module.exports = { registerProtect };
