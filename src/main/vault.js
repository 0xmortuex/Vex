const path = require('path');
const { atomicWrite } = require('./file-store');
function createVaultService({ app, safeStorage, ipcMain }) {
let vaultCache = null;
let writes = Promise.resolve();
// === Password vault — encrypted at rest with safeStorage (OS keychain/DPAPI) ===
// The renderer never sees the file; plaintext secrets only cross IPC when the
// user autofills/copies. If safeStorage is unavailable (rare: no keychain),
// the vault refuses to save rather than writing plaintext.
const VAULT_FILE = () => path.join(app.getPath('userData'), 'vault.dat');
function vaultLoad() {
  if (vaultCache) return structuredClone(vaultCache);
  try {
    const fsx = require('fs');
    if (!fsx.existsSync(VAULT_FILE())) return [];
    const enc = fsx.readFileSync(VAULT_FILE());
    const raw = safeStorage.decryptString(enc);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('Invalid vault format');
    vaultCache = arr;
    return structuredClone(arr);
  } catch (err) {
    console.error('[Vault] load failed:', err.message);
    throw new Error('Cannot read encrypted vault; existing data has been preserved', { cause: err });
  }
}
async function vaultSave(arr) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
  const bytes = safeStorage.encryptString(JSON.stringify(arr));
  vaultCache = structuredClone(arr);
  writes = writes.catch(() => {}).then(() => atomicWrite(VAULT_FILE(), bytes));
  try { await writes; } catch (error) { vaultCache = null; throw error; }
}
ipcMain.handle('vault:list', () => {
  // Metadata only — no passwords cross this channel.
  return vaultLoad().map(e => ({ host: e.host, username: e.username, updatedAt: e.updatedAt }));
});

// Disables WebAuthn get() (the passkey / "Windows Security → security key"
// prompt) in a page — injected into sign-in popups (mirrors the site-tweak that
// covers tabs/panels). Rejects publicKey requests so sign-in falls back, and
// reports no platform/conditional authenticator.
const _WEBAUTHN_DISABLE_JS = '(function(){try{' +
  'var nc=navigator.credentials;' +
  'if(nc&&typeof nc.get==="function"){var orig=nc.get.bind(nc);nc.get=function(opts){try{if(opts&&opts.publicKey){return Promise.reject(new DOMException("Passkey sign-in is disabled in Vex","NotAllowedError"));}}catch(e){}return orig(opts);};}' +
  'if(window.PublicKeyCredential){' +
    'try{window.PublicKeyCredential.isConditionalMediationAvailable=function(){return Promise.resolve(false);};}catch(e){}' +
    'try{window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable=function(){return Promise.resolve(false);};}catch(e){}' +
  '}' +
  '}catch(e){}})();';

// Autofill for OAuth / sign-in POPUP windows (separate BrowserWindows, so the
// renderer's PasswordVault can't reach them). Injected into the popup's own
// webContents on each load. Same hardened login-field logic as passwords.js:
// only a real login field is filled (email/username signal or a password field
// present) — never a search/combobox — and only when the popup's host exactly
// matches a saved credential (so a phishing popup can't harvest it).
function _popupAutofillJs(username, password) {
  return `(function(){try{
    var U=${JSON.stringify(username)},P=${JSON.stringify(password)};
    var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
    var fire=function(el,val){try{el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}};
    var vis=function(el){try{var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(e){return false;}};
    var meta=function(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}};
    var searchy=function(el){var t=(el.type||'').toLowerCase();if(t==='search')return true;var role=(el.getAttribute('role')||'').toLowerCase();if(role==='search'||role==='searchbox'||role==='combobox')return true;return /search|find|filter|query/.test(meta(el));};
    var loginSig=function(el){var t=(el.type||'').toLowerCase();if(t==='email')return true;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='username'||ac==='email')return true;return /e-?mail|user-?name|userid|login|phone|account|identifier/.test(meta(el));};
    var userField=function(pw){var scope=(pw&&pw.form)||document;var c=scope.querySelectorAll('input[type=text],input[type=email],input[type=tel],input:not([type])');var sig=null,plain=null;for(var i=0;i<c.length;i++){var el=c[i];if(!vis(el)||searchy(el))continue;if(loginSig(el)){sig=el;break;}if(!plain)plain=el;}return sig||(pw?plain:null);};
    var fill=function(){var pw=document.querySelector('input[type=password]');var u=userField(pw);if(u&&(pw||loginSig(u))&&!u.value)fire(u,U);if(pw&&!pw.value)fire(pw,P);};
    fill();
    // OAuth pages build their fields asynchronously (and step email→password on
    // the same URL), so retry for a few seconds.
    var n=0;var iv=setInterval(function(){fill();if(++n>10)clearInterval(iv);},400);
  }catch(e){}})();`;
}
function _autofillPopup(wc) {
  try {
    if (!wc || wc.isDestroyed()) return;
    const u = wc.getURL();
    let host = '';
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { return; }
    if (!host || !/^https:/i.test(u)) return;
    const creds = vaultLoad().filter(e => e.host === host);
    if (creds.length !== 1) return;
    const c = creds[0];
    wc.executeJavaScript(_popupAutofillJs(c.username, c.password)).catch(() => {});
  } catch {}
}
ipcMain.handle('vault:get', (_e, host) => {
  if (!host || typeof host !== 'string') return [];
  return vaultLoad().filter(e => e.host === host);
});
// Password health — analyze the vault IN THE MAIN PROCESS and return only the
// findings (which hosts reuse a password, which are weak). The passwords
// themselves NEVER cross the IPC boundary, matching vault:list's contract.
ipcMain.handle('vault:health', () => {
  try {
    const arr = vaultLoad();
    // Reuse: group hosts by identical password value (the value is never returned).
    const byPw = new Map();
    for (const e of arr) {
      if (!e || !e.password) continue;
      if (!byPw.has(e.password)) byPw.set(e.password, []);
      byPw.get(e.password).push({ host: e.host, username: e.username });
    }
    const reused = [];
    for (const list of byPw.values()) { if (list.length > 1) reused.push({ count: list.length, entries: list }); }
    reused.sort((a, b) => b.count - a.count);
    // Weak: short, digits-only, or a well-known common password.
    const COMMON = new Set(['password', '123456', '12345678', '1234567890', 'qwerty', '111111', '123123', 'abc123', 'password1', 'iloveyou', '000000', 'letmein', 'admin', 'welcome', 'monkey', 'dragon', 'football', 'qwerty123']);
    const weak = [];
    for (const e of arr) {
      if (!e || !e.password) continue;
      const reasons = [];
      if (e.password.length < 8) reasons.push('too short');
      if (/^\d+$/.test(e.password)) reasons.push('digits only');
      if (COMMON.has(e.password.toLowerCase())) reasons.push('common password');
      if (reasons.length) weak.push({ host: e.host, username: e.username, reasons });
    }
    return { total: arr.length, reused, weak };
  } catch (e) {
    return { total: 0, reused: [], weak: [], error: e && e.message };
  }
});
ipcMain.handle('vault:save', async (_e, entry) => {
  const { host, username, password } = entry || {};
  if (!host || !username || !password) return { ok: false, error: 'Missing fields' };
  try {
    const arr = vaultLoad();
    const existing = arr.find(e => e.host === host && e.username === username);
    if (existing) { existing.password = password; existing.updatedAt = new Date().toISOString(); }
    else arr.push({ host, username, password, updatedAt: new Date().toISOString() });
    await vaultSave(arr);
    return { ok: true, updated: !!existing };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('vault:delete', async (_e, { host, username } = {}) => {
  try {
    await vaultSave(vaultLoad().filter(e => !(e.host === host && e.username === username)));
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});


return { _WEBAUTHN_DISABLE_JS, _autofillPopup, flushVault: () => writes };
}
module.exports = { createVaultService };
