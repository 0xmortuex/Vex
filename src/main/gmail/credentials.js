// Encrypted local storage for Gmail credentials (email + app password).
// Uses Electron safeStorage which on Windows binds the ciphertext to the
// user's DPAPI master key — copying the .enc file to another account or
// machine won't decrypt.

const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');

function credsPath() {
  return path.join(app.getPath('userData'), 'gmail-creds.enc');
}

function saveCredentials({ email, appPassword }) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption unavailable — cannot securely save credentials');
  }
  if (!email || !appPassword) throw new Error('email and appPassword required');
  const payload = JSON.stringify({ email, appPassword });
  const encrypted = safeStorage.encryptString(payload);
  fs.writeFileSync(credsPath(), encrypted);
}

function loadCredentials() {
  const p = credsPath();
  if (!fs.existsSync(p)) return null;
  try {
    const encrypted = fs.readFileSync(p);
    const json = safeStorage.decryptString(encrypted);
    return JSON.parse(json);
  } catch {
    // Corrupt or wrong user — treat as absent so onboarding reappears.
    return null;
  }
}

function clearCredentials() {
  const p = credsPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { saveCredentials, loadCredentials, clearCredentials };
