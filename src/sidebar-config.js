// === Vex sidebar config loader (main process) ===
//
// Loads <userData>/sidebar-config.json — a LOCAL, gitignored file that lets a
// user point sidebar tools at personalized URLs (e.g. an AI News Tracker URL
// carrying a secret `personalize` query param) without committing the secret
// to this public repo.
//
// Missing or malformed file -> public defaults. See sidebar-config.example.json.

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'sidebar-config.json';

// Public, secret-free defaults — safe to ship in the repo. All default to ''
// (not configured). Copy sidebar-config.example.json to <userData>/sidebar-config.json
// to set personal values locally without committing them. An empty value signals
// "not configured" (the Queue panel shows a setup hint; no AI News tool is added).
const DEFAULTS = Object.freeze({
  aiNewsUrl: '',
  queueUrl: '',
  queueSecret: '',
});

/**
 * Load and validate <userDataPath>/sidebar-config.json, merged over DEFAULTS.
 * Missing/unreadable file -> defaults (silent). Malformed or non-object JSON
 * -> defaults (error logged). Unknown keys (e.g. "_comment") are ignored.
 *
 * @param {string} userDataPath  typically app.getPath('userData')
 * @returns {{aiNewsUrl: string, queueUrl: string, queueSecret: string}}
 *          always a complete config object
 */
function loadSidebarConfig(userDataPath) {
  const file = path.join(userDataPath || '', CONFIG_FILENAME);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // Missing / unreadable is the normal case — most users never create it.
    return { ...DEFAULTS };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[sidebar-config] malformed ${CONFIG_FILENAME}, using defaults:`, err.message);
    return { ...DEFAULTS };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`[sidebar-config] ${CONFIG_FILENAME} is not a JSON object, using defaults`);
    return { ...DEFAULTS };
  }

  const merged = { ...DEFAULTS };
  if (typeof parsed.aiNewsUrl === 'string' && parsed.aiNewsUrl.trim()) {
    merged.aiNewsUrl = parsed.aiNewsUrl.trim();
  }
  if (typeof parsed.queueUrl === 'string' && parsed.queueUrl.trim()) {
    merged.queueUrl = parsed.queueUrl.trim();
  }
  if (typeof parsed.queueSecret === 'string' && parsed.queueSecret.trim()) {
    merged.queueSecret = parsed.queueSecret.trim();
  }
  return merged;
}

/**
 * Save the Queue's address and read secret (the Queue panel's setup form) into <userDataPath>/sidebar-config.json, keeping every other key
 * in the file. Throws, in words, for an address that is not https or a secret that is empty, and for a file that is not valid JSON (it is
 * never overwritten, so a hand-edited file is not lost).
 *
 * @returns {{queueUrl: string, queueSecret: string}} what was saved
 */
function saveQueueConfig(userDataPath, input) {
  const queueUrl = String((input && input.queueUrl) || '').trim().replace(/\/+$/, '');
  const queueSecret = String((input && input.queueSecret) || '').trim();
  let url;
  try { url = new URL(queueUrl); } catch { throw new Error('That is not a web address. It looks like https://queue-bot.your-name.workers.dev'); }
  if (url.protocol !== 'https:') throw new Error('The queue address has to start with https://');
  if (queueSecret.length < 8) throw new Error('The read secret is missing or too short');
  const file = path.join(userDataPath || '', CONFIG_FILENAME);
  let current = {};
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  if (raw !== null) {
    try { current = JSON.parse(raw); }
    catch (err) { throw new Error(CONFIG_FILENAME + ' is not valid JSON, so it was left as it is. Fix or delete it, then try again.', { cause: err }); }
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error(CONFIG_FILENAME + ' is not a JSON object, so it was left as it is.');
  }
  current.queueUrl = queueUrl;
  current.queueSecret = queueSecret;
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return { queueUrl, queueSecret };
}

/**
 * Register the IPC handlers the renderer uses.
 * `sidebar-config:get` -> resolves to the loaded config object.
 * `sidebar-config:set-queue` -> saves the Queue's address and secret, resolves to the loaded config object.
 */
function registerSidebarConfigIpc(ipcMain, userDataPath) {
  ipcMain.handle('sidebar-config:get', () => loadSidebarConfig(userDataPath));
  ipcMain.handle('sidebar-config:set-queue', (_e, input) => { saveQueueConfig(userDataPath, input); return loadSidebarConfig(userDataPath); });
}

module.exports = { DEFAULTS, CONFIG_FILENAME, loadSidebarConfig, saveQueueConfig, registerSidebarConfigIpc };
