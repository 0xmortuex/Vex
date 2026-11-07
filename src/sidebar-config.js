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

const { unwrap } = require('./main/versioned-json');
const { atomicWriteSync } = require('./main/file-store');

const CONFIG_FILENAME = 'sidebar-config.json';
// The queue's read secret. It is a real secret: anyone who holds it can read the Queue (queue-bot) behind queueUrl,
// the Queue panel puts it in the request address. It used to sit in sidebar-config.json as plain text next to the
// address; it is now sealed by the operating system (Electron safeStorage, through main's SecretStore) in this file.
// The plain copy is read once for migration and removed only after the sealed copy has been written and read back.
const SEALED_FILENAME = 'queue-secret.enc';

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
    parsed = unwrap(JSON.parse(raw));
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
function validateQueueInput(input) {
  const queueUrl = String((input && input.queueUrl) || '').trim().replace(/\/+$/, '');
  const queueSecret = String((input && input.queueSecret) || '').trim();
  let url;
  try { url = new URL(queueUrl); } catch { throw new Error('That is not a web address. It looks like https://queue-bot.your-name.workers.dev'); }
  if (url.protocol !== 'https:') throw new Error('The queue address has to start with https://');
  if (queueSecret.length < 8) throw new Error('The read secret is missing or too short');
  return { queueUrl, queueSecret };
}

// The file as an object to change and write back (never replaced when it is not valid JSON).
function readCurrent(file) {
  let current = {};
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  if (raw !== null) {
    try { current = JSON.parse(raw); }
    catch (err) { throw new Error(CONFIG_FILENAME + ' is not valid JSON, so it was left as it is. Fix or delete it, then try again.', { cause: err }); }
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error(CONFIG_FILENAME + ' is not a JSON object, so it was left as it is.');
  }
  return current;
}

function saveQueueConfig(userDataPath, input) {
  const { queueUrl, queueSecret } = validateQueueInput(input);
  const file = path.join(userDataPath || '', CONFIG_FILENAME);
  const current = readCurrent(file);
  current.queueUrl = queueUrl;
  current.queueSecret = queueSecret;
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return { queueUrl, queueSecret };
}

// Takes the plain queueSecret out of sidebar-config.json, keeping every other key. Written without a .bak (a backup
// copy would keep the secret). A file that is not a JSON object is left as it is.
function removePlainSecret(userDataPath) {
  const file = path.join(userDataPath || '', CONFIG_FILENAME);
  const current = readCurrent(file);
  if (!('queueSecret' in current)) return false;
  delete current.queueSecret;
  atomicWriteSync(file, JSON.stringify(current, null, 2) + '\n', { backup: false });
  return true;
}

/**
 * The same as loadSidebarConfig, but the queue secret comes from the sealed file. `secrets` is main's SecretStore
 * (read(file, parseLegacy) / write(file, value)).
 *   - a sealed secret exists          -> it is the secret; a leftover plain copy is removed
 *   - only a plain secret exists      -> it is sealed, read back, and only then removed from the plain file; it keeps
 *                                        working all along. If sealing fails (no OS encryption) the plain copy stays and
 *                                        the failure is logged, so the Queue still works as before.
 */
async function loadSidebarConfigSealed(userDataPath, secrets) {
  const cfg = loadSidebarConfig(userDataPath);
  const sealedFile = path.join(userDataPath || '', SEALED_FILENAME);
  let sealed = null;
  try { sealed = await secrets.read(sealedFile, () => null); }
  catch (err) {
    if (!cfg.queueSecret) throw err;
    console.error('[sidebar-config] the sealed queue secret could not be read, using the plain one:', err.message);
    return cfg;
  }
  if (typeof sealed === 'string' && sealed) {
    cfg.queueSecret = sealed;
    try { removePlainSecret(userDataPath); }
    catch (err) { console.error('[sidebar-config] the old plain copy of the queue secret could not be removed:', err.message); }
    return cfg;
  }
  if (cfg.queueSecret) {
    try {
      await secrets.write(sealedFile, cfg.queueSecret);
      const back = await secrets.read(sealedFile, () => null);
      if (back !== cfg.queueSecret) throw new Error('the sealed copy did not read back the same');
      removePlainSecret(userDataPath);
    } catch (err) {
      console.error('[sidebar-config] the queue secret could not be moved to sealed storage, the plain copy stays for now:', err.message);
    }
  }
  return cfg;
}

/** Saves the Queue's address in sidebar-config.json and its secret in the sealed file (sealed FIRST; if that fails nothing else changes). */
async function saveQueueConfigSealed(userDataPath, input, secrets) {
  const { queueUrl, queueSecret } = validateQueueInput(input);
  const file = path.join(userDataPath || '', CONFIG_FILENAME);
  const current = readCurrent(file);
  await secrets.write(path.join(userDataPath || '', SEALED_FILENAME), queueSecret);
  current.queueUrl = queueUrl;
  delete current.queueSecret;
  atomicWriteSync(file, JSON.stringify(current, null, 2) + '\n', { backup: false });
  return { queueUrl, queueSecret };
}

/**
 * Register the IPC handlers the renderer uses.
 * `sidebar-config:get` -> resolves to the loaded config object.
 * `sidebar-config:set-queue` -> saves the Queue's address and secret, resolves to the loaded config object.
 */
function registerSidebarConfigIpc(ipcMain, userDataPath, getSecrets) {
  // With a way to the sealed store the queue secret is kept sealed; without one (a test) the plain file is used as before.
  const secrets = () => (typeof getSecrets === 'function' ? getSecrets() : null);
  ipcMain.handle('sidebar-config:get', () => { const s = secrets(); return s ? loadSidebarConfigSealed(userDataPath, s) : loadSidebarConfig(userDataPath); });
  ipcMain.handle('sidebar-config:set-queue', async (_e, input) => {
    const s = secrets();
    if (s) { await saveQueueConfigSealed(userDataPath, input, s); return loadSidebarConfigSealed(userDataPath, s); }
    saveQueueConfig(userDataPath, input);
    return loadSidebarConfig(userDataPath);
  });
}

module.exports = { DEFAULTS, CONFIG_FILENAME, SEALED_FILENAME, loadSidebarConfig, saveQueueConfig, loadSidebarConfigSealed, saveQueueConfigSealed, registerSidebarConfigIpc };
