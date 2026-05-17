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

// Public, secret-free defaults — safe to ship in the repo.
const DEFAULTS = Object.freeze({
  aiNewsUrl: 'https://0xmortuex.github.io/ai-news-tracker/',
});

/**
 * Load and validate <userDataPath>/sidebar-config.json, merged over DEFAULTS.
 * Missing/unreadable file -> defaults (silent). Malformed or non-object JSON
 * -> defaults (error logged). Unknown keys (e.g. "_comment") are ignored.
 *
 * @param {string} userDataPath  typically app.getPath('userData')
 * @returns {{aiNewsUrl: string}} always a complete config object
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
  return merged;
}

/**
 * Register the IPC handler the renderer uses to fetch the config.
 * Channel: `sidebar-config:get` -> resolves to the loaded config object.
 */
function registerSidebarConfigIpc(ipcMain, userDataPath) {
  ipcMain.handle('sidebar-config:get', () => loadSidebarConfig(userDataPath));
}

module.exports = { DEFAULTS, CONFIG_FILENAME, loadSidebarConfig, registerSidebarConfigIpc };
