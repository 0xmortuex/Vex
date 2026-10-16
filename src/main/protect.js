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
  watchedSessions = () => ({}), trackerHosts = () => [], extensionEntries = () => [], extensionUpdates = () => ({}), statMtime = () => null,
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
  ipcMain.handle('privacy:report-clean', (_e, domains) => { guard(); signout.noteAction('privacy-cleanup', domains); return report.clean(domains); });

  // --- "Why was I signed out?" (signout-why.js) -----------------------------
  // Read-only over the cookie jar's metadata (names, session flag, expiry; no
  // values). watchedSessions() -> { 'persist:main': () => session, ... }.
  const signout = require('./signout-why').createSignoutWhy({ store: jsonStore, now, log });
  for (const [name, getWatched] of Object.entries(watchedSessions())) {
    try {
      const ses = getWatched();
      ses.cookies.on('changed', (_e, cookie, cause, removed) => {
        signout.onCookieChanged(name, cookie, cause, removed).catch(err => note('[SignoutWhy] ' + err.message));
      });
      const look = async (first) => {
        const cookies = await ses.cookies.get({});
        if (first) await signout.compareAtStart(name, cookies);
        await signout.snapshot(name, cookies);
      };
      // After the jar has had time to load; then every ten minutes, so a close
      // loses at most ten minutes of what is known.
      const kick = setTimeout(() => look(true).catch(err => note('[SignoutWhy] could not read ' + name + ': ' + err.message)), 15000);
      const every = setInterval(() => look(false).catch(err => note('[SignoutWhy] could not read ' + name + ': ' + err.message)), 10 * 60 * 1000);
      if (typeof kick.unref === 'function') kick.unref();
      if (typeof every.unref === 'function') every.unref();
    } catch (err) { note('[SignoutWhy] ' + name + ' is not being watched: ' + err.message); }
  }
  ipcMain.handle('signout:why', (_e, host) => { guard(); return signout.explain(host || null); });

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
  const quiet = require('./quiet-hours').createQuietHours({ store: jsonStore, show: realShow, now, log });
  // Everything that shows a toast calls notifier.show at the moment it needs
  // one, so replacing the property puts every sender behind the quiet window.
  notifier.show = quiet.gated;
  quiet.init().then(() => quiet.start()).catch(err => note('[QuietHours] could not read its settings: ' + err.message));
  ipcMain.handle('quiet:get', () => quiet.getConfig());
  ipcMain.handle('quiet:set', (_e, cfg) => { guard(); return quiet.setConfig(cfg); });
  ipcMain.handle('quiet:held', () => { guard(); return quiet.heldList(); });
  ipcMain.handle('quiet:release', () => { guard(); return quiet.release(); });
  ipcMain.handle('quiet:drop', () => { guard(); return quiet.dropHeld(); });

  return { report, usage, snapshots, quiet, tally, signout };
}

module.exports = { registerProtect };
