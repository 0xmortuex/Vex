const path = require('path');
const { atomicWrite } = require('./file-store');
const { weakReasons, ageDays } = require('./password-strength');
const OLD_PASSWORD_DAYS = 365;
// dialog / windowFor: the CSV export's save dialog. breachCheckOn: whether the
// person turned on the breach check ('vex.breachCheck'); nothing is sent to
// Have I Been Pwned unless it is. fetchRange(prefix) -> the range API's text
// (a stand-in in tests; never called live there). onChange() runs after every
// save, so Vex Sync sends the change (main/sync-secrets.js).
function createVaultService({ app, safeStorage, ipcMain, isLocked = () => false, dialog = null, windowFor = () => null, breachCheckOn = () => false, fetchRange = null, onChange = () => {}, breachCooldownMs = 60 * 1000, breachNow = () => Date.now() }) {
let vaultCache = null;
let writes = Promise.resolve();
// === Password vault — encrypted at rest with safeStorage (OS keychain/DPAPI) ===
// The renderer never sees the file; plaintext secrets only cross IPC when the
// user autofills/copies. If safeStorage is unavailable (rare: no keychain),
// the vault refuses to save rather than writing plaintext.
const VAULT_FILE = () => path.join(app.getPath('userData'), 'vault.dat');
function vaultLoad() {
  // Lock Vex covers the vault too: a private window opened from the lock
  // screen could list and read every password (found 2026-09-29).
  if (isLocked()) throw new Error('Vex is locked — unlock it to use saved passwords');
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
  onChange();
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
//
// Nothing is filled until the person clicks or types in a login field of the
// popup: the saved login was typed into every sign-in popup any page opened,
// at once, where every script on that page could read it (security scan M3).
// The code runs in an isolated world, so page scripts can neither see it nor
// hand it a fake click, and the site is checked again at the moment of filling.
const POPUP_FILL_WORLD = 1018;
function _popupAutofillJs(username, password, host) {
  return `(function(){try{
    var U=${JSON.stringify(username)},P=${JSON.stringify(password)},H=${JSON.stringify(host)};
    var here=function(){return location.protocol==='https:'&&location.hostname.replace(/^www\\./,'')===H;};
    if(!here()||window.__vexPopupFill)return;window.__vexPopupFill=1;
    var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
    var fire=function(el,val){try{el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}};
    var vis=function(el){try{var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(e){return false;}};
    var meta=function(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}};
    var searchy=function(el){var t=(el.type||'').toLowerCase();if(t==='search')return true;var role=(el.getAttribute('role')||'').toLowerCase();if(role==='search'||role==='searchbox'||role==='combobox')return true;return /search|find|filter|query/.test(meta(el));};
    var loginSig=function(el){var t=(el.type||'').toLowerCase();if(t==='email')return true;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='username'||ac==='email')return true;return /e-?mail|user-?name|userid|login|phone|account|identifier/.test(meta(el));};
    var userField=function(pw){var scope=(pw&&pw.form)||document;var c=scope.querySelectorAll('input[type=text],input[type=email],input[type=tel],input:not([type])');var sig=null,plain=null;for(var i=0;i<c.length;i++){var el=c[i];if(!vis(el)||searchy(el))continue;if(loginSig(el)){sig=el;break;}if(!plain)plain=el;}return sig||(pw?plain:null);};
    var fill=function(){if(!here())return;var pw=document.querySelector('input[type=password]');var u=userField(pw);if(u&&(pw||loginSig(u))&&!u.value)fire(u,U);if(pw&&!pw.value)fire(pw,P);};
    // A real click or key press (isTrusted) in a password or login field.
    var onUser=function(ev){try{if(!ev.isTrusted)return;var t=ev.target;if(!t||t.tagName!=='INPUT')return;if((t.type||'').toLowerCase()!=='password'&&!loginSig(t))return;fill();}catch(e){}};
    document.addEventListener('pointerdown',onUser,true);
    document.addEventListener('keydown',onUser,true);
  }catch(e){}})();`;
}
// opts.partition: the popup's session. A private window's, an off-the-record,
// burner or Tor tab's popup is never offered the main vault (scan M3).
function _autofillPopup(wc, opts = {}) {
  try {
    if (!wc || wc.isDestroyed()) return;
    const partition = typeof opts.partition === 'string' ? opts.partition : '';
    if (!partition.startsWith('persist:') || partition === 'persist:route-tor' || (wc.session && wc.session.__vexTor)) return;
    const u = wc.getURL();
    let host = '';
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { return; }
    if (!host || !/^https:/i.test(u)) return;
    const creds = vaultLoad().filter(e => e.host === host);
    if (creds.length !== 1) return;
    const c = creds[0];
    wc.executeJavaScriptInIsolatedWorld(POPUP_FILL_WORLD, [{ code: _popupAutofillJs(c.username, c.password, host) }])
      .catch(err => console.error('[popup-autofill] could not offer the saved login:', err && err.message));
  } catch (err) { console.error('[popup-autofill] failed:', err && err.message); }
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
    // Weak: the pattern checks in main/password-strength.js (short, digits
    // only, a common password or a small change to one, a repeat or a simple
    // sequence, the username or the site name inside it).
    const weak = [];
    for (const e of arr) {
      if (!e || !e.password) continue;
      const reasons = weakReasons({ password: e.password, host: e.host, username: e.username });
      if (reasons.length) weak.push({ host: e.host, username: e.username, reasons });
    }
    // Old: not changed for a year. The date is when Vex saved or last changed
    // it (an import counts from the day it was imported).
    const old = [];
    for (const e of arr) {
      if (!e || !e.password) continue;
      const days = ageDays(e.updatedAt);
      if (days !== null && days >= OLD_PASSWORD_DAYS) old.push({ host: e.host, username: e.username, days });
    }
    old.sort((x, y) => y.days - x.days);
    return { total: arr.length, reused, weak, old };
  } catch (e) {
    return { total: 0, reused: [], weak: [], old: [], error: e && e.message };
  }
});
ipcMain.handle('vault:save', async (_e, entry) => {
  const { host, username, password, note } = entry || {};
  if (!host || !username || !password) return { ok: false, error: 'Missing fields' };
  try {
    const arr = vaultLoad();
    const existing = arr.find(e => e.host === host && e.username === username);
    if (existing) { existing.password = password; existing.updatedAt = new Date().toISOString(); }
    else arr.push({ host, username, password, updatedAt: new Date().toISOString() });
    // A note only from Settings › Passwords › Add; a site's save card has none.
    if (typeof note === 'string' && note) (existing || arr[arr.length - 1]).note = note;
    await vaultSave(arr);
    return { ok: true, updated: !!existing };
  } catch (err) { return { ok: false, error: err.message }; }
});
// Settings › Passwords › Edit: the username, the password (left empty: kept)
// and the note ('' removes it) of one saved login.
ipcMain.handle('vault:update', async (_e, { host, username, newUsername, password, note } = {}) => {
  try {
    // A login may have no username (one imported from a CSV, as Chrome saves them).
    if (!host || typeof username !== 'string' || typeof newUsername !== 'string') return { ok: false, error: 'Missing fields' };
    const arr = vaultLoad();
    const entry = arr.find(e => e.host === host && e.username === username);
    if (!entry) return { ok: false, error: 'That saved login is no longer in the vault' };
    if (newUsername !== username && arr.some(e => e.host === host && e.username === newUsername)) {
      return { ok: false, error: `There is already a saved login for ${newUsername} on ${host}` };
    }
    entry.username = newUsername;
    if (password) entry.password = password;
    if (typeof note === 'string') { if (note) entry.note = note; else delete entry.note; }
    entry.updatedAt = new Date().toISOString();
    await vaultSave(arr);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// Chrome's password CSV (name,url,username,password,note), so it imports into
// Chrome, Edge, Firefox, Bitwarden and Vex itself. Written here, after the
// person picks where: the passwords never cross to the window for this.
function csvField(value) {
  const s = String(value == null ? '' : value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toChromeCsv(entries) {
  const rows = [['name', 'url', 'username', 'password', 'note']];
  for (const e of entries) rows.push([e.host, 'https://' + e.host + '/', e.username, e.password, e.note || '']);
  return rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
ipcMain.handle('vault:export-csv', async (e) => {
  const arr = vaultLoad();
  if (!arr.length) return { ok: false, error: 'There are no saved passwords to export' };
  if (!dialog) throw new Error('Exporting is not available here');
  const win = windowFor(e);
  const opts = { title: 'Export passwords', defaultPath: path.join(app.getPath('documents'), 'Vex Passwords.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] };
  const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
  await require('fs').promises.writeFile(picked.filePath, toChromeCsv(arr), 'utf8');
  return { ok: true, count: arr.length, path: picked.filePath };
});

// Breach check (Password Health), only when the person turned it on: each
// password's SHA-1 is worked out here and only its first five hex characters
// are sent to Have I Been Pwned's range API, which answers with every breached
// hash starting with them; the match is made here (k-anonymity). Neither the
// password nor its full hash leaves the computer.
const crypto = require('crypto');
async function defaultFetchRange(prefix) {
  const { net } = require('electron');
  const res = await net.fetch('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true', 'User-Agent': 'Vex-browser' } });
  // Recorded in the "what left this computer" ledger: the host and sizes only.
  const ledger = require('./egress-ledger').getShared();
  const text = res.ok ? await res.text() : '';
  if (ledger) ledger.record({ feature: 'Password breach check', url: 'https://api.pwnedpasswords.com/range/', kind: 'breach', bytesOut: 5, bytesIn: Buffer.byteLength(text), ok: res.ok, status: res.status });
  if (!res.ok) throw new Error('Have I Been Pwned answered ' + res.status);
  return text;
}
// A run asks the range API once per distinct hash prefix, so a button pressed
// again and again would be a burst of requests to a free service. One run per
// cooldown (a failed run counts too: the requests were made).
let lastBreachRun = 0;
ipcMain.handle('vault:breach-check', async () => {
  if (!breachCheckOn()) throw new Error('The breach check is off. Turn it on in Password Health first.');
  const started = breachNow();
  if (lastBreachRun && started - lastBreachRun < breachCooldownMs) {
    throw new Error('The breach check ran a moment ago. Wait ' + Math.ceil((breachCooldownMs - (started - lastBreachRun)) / 1000) + ' seconds before running it again.');
  }
  lastBreachRun = started;
  const arr = vaultLoad();
  const byPrefix = new Map();
  for (const e of arr) {
    if (!e || !e.password) continue;
    const sha = crypto.createHash('sha1').update(e.password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha.slice(0, 5);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push({ suffix: sha.slice(5), host: e.host, username: e.username });
  }
  const fetcher = fetchRange || defaultFetchRange;
  const breached = [];
  for (const [prefix, list] of byPrefix) {
    const text = await fetcher(prefix);
    const counts = new Map();
    for (const line of String(text).split(/\r?\n/)) {
      const [suffix, count] = line.trim().split(':');
      const n = parseInt(count, 10);
      if (suffix && n > 0) counts.set(suffix.toUpperCase(), n);   // padding lines carry 0
    }
    for (const item of list) {
      if (counts.has(item.suffix)) breached.push({ host: item.host, username: item.username, count: counts.get(item.suffix) });
    }
  }
  breached.sort((a, b) => b.count - a.count);
  return { checked: arr.filter(e => e && e.password).length, breached };
});

ipcMain.handle('vault:delete', async (_e, { host, username } = {}) => {
  try {
    await vaultSave(vaultLoad().filter(e => !(e.host === host && e.username === username)));
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});


// Logins brought over from another browser's CSV export (main/browser-import.js).
// Only a host + username the vault does not already have is added: a saved
// password is never overwritten by an import, so undoing it (vault:delete of
// exactly what is returned) puts the vault back as it was.
async function addMissing(entries) {
  const arr = vaultLoad();
  const seen = new Set(arr.map(e => e.host + '\n' + e.username));
  const added = [];
  let duplicates = 0;
  const now = new Date().toISOString();
  for (const { host, username, password, note, updatedAt } of entries) {
    const k = host + '\n' + username;
    if (seen.has(k)) { duplicates++; continue; }
    seen.add(k);
    // The file's own "password changed" date is kept when it had one, so an
    // old password imported from Firefox still shows as old in Password Health.
    const stamp = typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : now;
    const entry = { host, username, password, updatedAt: stamp };
    if (typeof note === 'string' && note) entry.note = note;
    arr.push(entry);
    // updatedAt lets an undo tell a login still as imported from one the
    // person has changed since (vault:list reports the same value).
    added.push({ host, username, updatedAt: stamp });
  }
  if (added.length) await vaultSave(arr);
  return { added, duplicates };
}

return { _WEBAUTHN_DISABLE_JS, _autofillPopup, flushVault: () => writes, addMissing, toChromeCsv, load: vaultLoad, save: vaultSave };
}
module.exports = { createVaultService };
