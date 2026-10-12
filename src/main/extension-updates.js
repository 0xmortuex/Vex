// === Keeping installed extensions up to date ===============================
//
// Chrome checks its extensions for updates every few hours and installs a new
// version on its own, unless the new version asks for more than the person
// agreed to; then it switches the extension off and asks. Vex did neither: an
// extension stayed at the version it was installed with until someone pressed
// "Update from Web Store" by hand.
//
// What is checked, and how:
//   * a Web Store install (extensions/sources.json { webstore: id }): Google's
//     update server, the protocol Chrome uses. The request names the installed
//     version; the answer is <updatecheck status="noupdate"/> or the new
//     version with the package's address and SHA-256. The package must match
//     that hash and pass the same CRX3 checks as an install (webstore.js
//     verifyCrx3: the developer's signature AND the Web Store's).
//   * a catalogue install ({ catalog: id }): the publisher's latest GitHub
//     release (extension-sources.js). It is not signed the way a store package
//     is, so the downloaded file must match the digest GitHub publishes for it
//     whenever GitHub has one.
//   * anything else (a .zip, a folder, a developer's own .crx) has nowhere to
//     be fetched from again, and is left alone.
//
// A newer version that asks for more (a permission with a warning, or sites it
// could not read before) is NOT installed; it waits in `pending` for the
// person to approve it on the extension's card.
//
// When: a first check two minutes after start, then every six hours; one
// extension at a time, a little apart; never while offline or on a metered
// connection (a person's "Check now" still checks on a metered one). Private
// windows have no extensions and cannot reach any of this (ipc-policy.js:
// every extensions: channel is refused there).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPDATE_SERVER = 'https://clients2.google.com/service/update2/crx';
const FIRST_CHECK_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const STAGGER_MS = 15 * 1000;
const STATE_FILE = 'updates.json';
const HISTORY_MAX = 40;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;

// ---- versions ------------------------------------------------------------------
// Chrome's extension versions: one to four dot-separated whole numbers.
function parseVersion(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{1,9}(\.\d{1,9}){0,3}$/.test(s)) return null;
  return s.split('.').map(Number);
}
// <0, 0, >0 as a is older, the same, newer than b. Throws on a version that
// is not one, rather than calling it older or newer.
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x) throw new Error(`Not an extension version: "${a}"`);
  if (!y) throw new Error(`Not an extension version: "${b}"`);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---- the Web Store's update protocol ----------------------------------------------
function checkUrl(id, version, chromeVersion) {
  if (!/^[a-p]{32}$/.test(String(id))) throw new TypeError('checkUrl: not an extension id: ' + id);
  if (!parseVersion(version)) throw new TypeError('checkUrl: not an extension version: ' + version);
  if (!/^\d+(\.\d+){0,3}$/.test(String(chromeVersion))) throw new TypeError('checkUrl: chromeVersion must look like 148.0.1234.5');
  return UPDATE_SERVER + '?prodversion=' + chromeVersion + '&acceptformat=crx3'
    + '&x=' + encodeURIComponent('id=' + id + '&v=' + version + '&uc');
}

function attrs(tag) {
  const out = {};
  const re = /([A-Za-z_][\w:-]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return out;
}

// { status: 'noupdate' } or { status: 'update', version, codebase, sha256 }.
// Anything else the server says is thrown, in words.
function parseUpdateResponse(xml, id) {
  const text = String(xml || '');
  const apps = text.match(/<app\b[^>]*?(?:\/>|>[\s\S]*?<\/app>)/g) || [];
  const app = apps.find(a => attrs(a.match(/<app\b[^>]*>/)[0]).appid === id);
  if (!app) throw new Error('Google\'s update server did not answer about this extension.');
  const appAttrs = attrs(app.match(/<app\b[^>]*>/)[0]);
  if (appAttrs.status && appAttrs.status !== 'ok') {
    if (appAttrs.status === 'error-unknownApplication') throw new Error('The Chrome Web Store no longer offers this extension, so there are no updates for it.');
    throw new Error(`Google's update server refused the check (${appAttrs.status}).`);
  }
  const uc = app.match(/<updatecheck\b[^>]*>/);
  if (!uc) throw new Error('Google\'s update server sent no update answer for this extension.');
  const u = attrs(uc[0]);
  if (u.status === 'noupdate') return { status: 'noupdate' };
  if (u.status !== 'ok') throw new Error(`Google's update server could not give an update (${u.status || 'no status'}).`);
  if (!parseVersion(u.version)) throw new Error('Google\'s update server named no usable version.');
  if (!codebaseAllowed(u.codebase)) throw new Error('Google\'s update server pointed the download somewhere other than Google, so Vex did not follow it.');
  const sha256 = /^[0-9a-f]{64}$/i.test(u.hash_sha256 || '') ? u.hash_sha256.toLowerCase() : null;
  return { status: 'update', version: u.version, codebase: u.codebase, sha256 };
}

// Only Google's own hosts, over https.
function codebaseAllowed(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return /(^|\.)(google\.com|googleusercontent\.com)$/i.test(u.hostname);
}

// ---- did it ask for more? --------------------------------------------------------
// Permissions Chrome installs without a word (no warning), so a new version
// adding one is updated like any other.
const SILENT = new Set(['activeTab', 'alarms', 'background', 'contextMenus', 'declarativeContent', 'fontSettings', 'gcm',
  'idle', 'offscreen', 'power', 'scripting', 'sidePanel', 'storage', 'unlimitedStorage']);
const HOSTLIKE = /:\/\/|^<all_urls>$/;
const strs = (v) => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []);

// What a new manifest asks for that the installed one did not, in words:
// [{ id, says }]. Optional permissions are not counted (they are asked for
// when used). Sites count when the old version could not already read them.
function addedPermissions(oldManifest, newManifest, { audit } = {}) {
  const auditor = audit || require('./extension-audit');
  const o = oldManifest || {}, n = newManifest || {};
  const apiOf = (m) => new Set(strs(m.permissions).filter(p => !HOSTLIKE.test(p)).map(p => p.split('.')[0]));
  const before = apiOf(o);
  const out = [];
  for (const p of apiOf(n)) {
    if (before.has(p) || SILENT.has(p)) continue;
    out.push({ id: p, says: (auditor.POWERS[p] && auditor.POWERS[p].says) || `Use chrome.${p}` });
  }
  const oldHosts = auditor.hostsOf(o), newHosts = auditor.hostsOf(n);
  if (!oldHosts.all) {
    if (newHosts.all) out.push({ id: '<all_urls>', says: 'Read and change every page you open' });
    else {
      const had = new Set(oldHosts.hosts);
      const more = newHosts.hosts.filter(h => !had.has(h));
      if (more.length) out.push({ id: 'hosts', says: 'Read and change pages on ' + more.join(', ') });
    }
  }
  return out;
}

// ---- the state file ----------------------------------------------------------
// extensions/updates.json:
//   auto      update on its own (Settings › Extensions › "Update extensions
//             automatically"), on unless switched off
//   lastCheck when the last check finished, and lastOutcome what it found
//   pending   { <folder>: { version, added: [{id, says}], at } } waiting for approval
//   errors    { <folder>: why its last check failed }
//   history   the updates installed, newest last: { at, folder, name, from, to, how }
function defaultState() {
  return { auto: true, lastCheck: null, lastOutcome: '', pending: {}, errors: {}, history: [] };
}
function statePath(extensionsDir) { return path.join(extensionsDir, STATE_FILE); }
function readState(extensionsDir) {
  const file = statePath(extensionsDir);
  if (!fs.existsSync(file)) return defaultState();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Extension update file is corrupt: expected an object');
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    auto: parsed.auto !== false,
    lastCheck: Number.isFinite(parsed.lastCheck) ? parsed.lastCheck : null,
    lastOutcome: typeof parsed.lastOutcome === 'string' ? parsed.lastOutcome : '',
    pending: obj(parsed.pending),
    errors: obj(parsed.errors),
    history: Array.isArray(parsed.history) ? parsed.history.filter(h => h && typeof h === 'object').slice(-HISTORY_MAX) : [],
  };
}
function writeState(extensionsDir, state) {
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(statePath(extensionsDir), JSON.stringify({ ...state, history: (state.history || []).slice(-HISTORY_MAX) }, null, 2));
}

// ---- metered connection ------------------------------------------------------------
// Windows says whether the connection costs per byte (Fixed / Variable) or
// not (Unrestricted). Resolves true / false; rejects when it cannot tell.
function isMeteredWindows({ execFile = require('child_process').execFile } = {}) {
  const script = '[void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime];'
    + '$p=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile();'
    + 'if ($p) { $c=$p.GetConnectionCost(); "$($c.NetworkCostType) $($c.Roaming) $($c.OverDataLimit)" } else { "None False False" }';
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) { reject(new Error('Windows did not say whether the connection is metered: ' + err.message)); return; }
      const [cost, roaming, over] = String(stdout || '').trim().split(/\s+/);
      if (!cost) { reject(new Error('Windows did not say whether the connection is metered')); return; }
      resolve(cost === 'Fixed' || cost === 'Variable' || roaming === 'True' || over === 'True');
    });
  });
}

// ---- finding an update -------------------------------------------------------------
// null when the installed version is current; else the verified new package.
async function findWebStoreUpdate({ id, installedVersion, fetch, chromeVersion, webstore, AdmZip, validateZip, publisherKeySha256 }) {
  const ws = webstore || require('./webstore');
  const res = await fetch(checkUrl(id, installedVersion, chromeVersion), { maxBytes: 256 * 1024, timeoutMs: 30000, credentials: 'omit' });
  if (!res.ok) throw new Error(`Google's update server answered ${res.status}.`);
  const answer = parseUpdateResponse(await res.text(), id);
  if (answer.status === 'noupdate') return null;
  if (compareVersions(answer.version, installedVersion) <= 0) return null;
  const pkg = await fetch(answer.codebase, { maxBytes: MAX_PACKAGE_BYTES, timeoutMs: 120000, credentials: 'omit', redirect: 'follow' });
  if (!pkg.ok) throw new Error(`The new version's download failed: Google's server answered ${pkg.status}.`);
  if (!codebaseAllowed(pkg.url || answer.codebase)) throw new Error('The new version\'s download ended somewhere other than Google, so Vex refused it.');
  const buf = Buffer.from(await pkg.arrayBuffer());
  if (answer.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== answer.sha256) {
    throw new Error('The downloaded package is not the one Google\'s update server described (its SHA-256 differs). Nothing was installed.');
  }
  const verified = ws.verifyCrx3(buf, publisherKeySha256 === undefined ? { expectedId: id } : { expectedId: id, publisherKeySha256 });
  const { manifest, messages } = ws.readPackage(verified.archive, { AdmZip, validateZip });
  const refuse = ws.refusal(manifest);
  if (refuse) throw new Error(refuse);
  if (!parseVersion(manifest.version) || compareVersions(manifest.version, installedVersion) <= 0) return null;
  return { version: manifest.version, archive: verified.archive, publicKey: verified.publicKey, manifest, messages, id };
}

// The manifest inside a release .zip: at the root, or in the shallowest
// folder that has one (uBlock's "uBlock0.chromium/manifest.json").
function zipManifest(buffer, { AdmZip, validateZip }) {
  const entries = validateZip(new AdmZip(buffer));
  let entry = entries.find(e => e.entryName === 'manifest.json');
  if (!entry) {
    entry = entries.filter(e => !e.isDirectory && e.entryName.endsWith('/manifest.json'))
      .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length)[0];
  }
  if (!entry) throw new Error('The release file has no manifest.json.');
  return JSON.parse(entry.getData().toString('utf-8').replace(/^\uFEFF/, ''));
}

async function findCatalogUpdate({ catalogId, installedVersion, fetch, sources, AdmZip, validateZip }) {
  const src = sources || require('./extension-sources');
  if (!Object.prototype.hasOwnProperty.call(src.SOURCES, catalogId)) throw new Error('Vex does not fetch "' + catalogId + '" by itself any more');
  const res = await fetch(src.latestReleaseUrl(catalogId), { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vex' }, maxBytes: 2 * 1024 * 1024, timeoutMs: 20000 });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('GitHub answered ' + res.status);
  const release = await res.json();
  const asset = src.pickAsset(release, src.SOURCES[catalogId].asset);
  if (!asset) throw new Error('The latest release (' + (release.tag_name || '?') + ') has no Chrome build');
  const dl = await fetch(asset.browser_download_url, { maxBytes: 64 * 1024 * 1024, timeoutMs: 60000 });
  if (!dl.ok) throw new Error('The release download failed: GitHub answered ' + dl.status);
  const buffer = Buffer.from(await dl.arrayBuffer());
  const digest = src.checkAssetDigest(buffer, asset);
  const manifest = zipManifest(buffer, { AdmZip, validateZip });
  if (!parseVersion(manifest.version) || compareVersions(manifest.version, installedVersion) <= 0) return null;
  return { version: manifest.version, buffer, manifest, tag: String(release.tag_name || ''), file: asset.name, digest };
}

// ---- the schedule ------------------------------------------------------------------
// deps:
//   list()                    [{ folder, name, version, manifest, source }] installed now
//   find(item)                the new package for item, or null (findWebStoreUpdate / findCatalogUpdate)
//   install(item, found)      { ok, version, error } — the same in-place update as a manual one
//   readState() / writeState(state)
//   isOnline()                boolean
//   isMetered()               Promise<boolean>; rejects when it cannot tell
//   onUpdated({ folder, name, from, to, how })   e.g. a line in diagnostics
//   now, setTimeout, clearTimeout, sleep(ms)    for the tests
function createExtensionUpdater(deps) {
  const d = { now: Date.now, setTimeout, clearTimeout, sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    firstCheckMs: FIRST_CHECK_MS, everyMs: CHECK_EVERY_MS, staggerMs: STAGGER_MS, onUpdated: () => {}, ...deps };
  for (const k of ['list', 'find', 'install', 'readState', 'writeState', 'isOnline', 'isMetered']) {
    if (typeof d[k] !== 'function') throw new TypeError('createExtensionUpdater: ' + k + ' is required');
  }
  let timer = null;
  let running = null;
  let started = false;

  function mutate(fn) {
    const s = d.readState();
    fn(s);
    d.writeState(s);
    return s;
  }

  async function installOne(item, found, how) {
    const r = await d.install(item, found);
    if (!r || !r.ok) throw new Error((r && r.error) || 'the new version did not install');
    const record = { at: d.now(), folder: item.folder, name: item.name, from: item.version, to: r.version || found.version, how };
    mutate(s => {
      delete s.pending[item.folder];
      delete s.errors[item.folder];
      s.history.push(record);
    });
    d.onUpdated(record);
    return record;
  }

  async function run({ manual }) {
    const state = d.readState();
    if (!manual && !state.auto) return { skipped: 'off' };
    if (!d.isOnline()) {
      mutate(s => { s.lastOutcome = 'Not checked: Vex is offline.'; });
      return { skipped: 'offline' };
    }
    if (!manual) {
      let metered;
      try { metered = await d.isMetered(); }
      catch (err) {
        mutate(s => { s.lastOutcome = 'Not checked: ' + err.message + '. "Check now" checks anyway.'; });
        return { skipped: 'metered-unknown', error: err.message };
      }
      if (metered) {
        mutate(s => { s.lastOutcome = 'Not checked: the connection is metered. "Check now" checks anyway.'; });
        return { skipped: 'metered' };
      }
    }
    const items = d.list().filter(i => i.source && (i.source.webstore || i.source.catalog));
    const updated = [], waiting = [], failed = [];
    let first = true;
    for (const item of items) {
      if (!first && d.staggerMs > 0) await d.sleep(d.staggerMs);
      first = false;
      try {
        const found = await d.find(item);
        if (!found) {
          mutate(s => { delete s.pending[item.folder]; delete s.errors[item.folder]; });
          continue;
        }
        const added = addedPermissions(item.manifest, found.manifest);
        if (added.length) {
          mutate(s => { s.pending[item.folder] = { version: found.version, added, at: d.now() }; delete s.errors[item.folder]; });
          waiting.push({ folder: item.folder, name: item.name, version: found.version, added });
          continue;
        }
        updated.push(await installOne(item, found, manual ? 'check' : 'auto'));
      } catch (err) {
        const why = (err && err.message) || String(err);
        mutate(s => { s.errors[item.folder] = why; });
        failed.push({ folder: item.folder, name: item.name, error: why });
      }
    }
    const parts = [];
    if (!items.length) parts.push('No extension here can be updated by Vex (only Web Store and catalogue installs can).');
    else if (!updated.length && !waiting.length && !failed.length) parts.push('Every extension is up to date.');
    if (updated.length) parts.push('Updated: ' + updated.map(u => `${u.name} ${u.from} → ${u.to}`).join(', ') + '.');
    if (waiting.length) parts.push('Waiting for your approval: ' + waiting.map(w => w.name).join(', ') + '.');
    if (failed.length) parts.push('Could not check: ' + failed.map(f => f.name).join(', ') + '.');
    mutate(s => { s.lastCheck = d.now(); s.lastOutcome = parts.join(' '); });
    return { checked: items.length, updated, waiting, failed };
  }

  function checkNow({ manual = false } = {}) {
    if (running) return running;
    running = run({ manual }).finally(() => { running = null; });
    return running;
  }

  function schedule(ms) {
    if (timer) d.clearTimeout(timer);
    timer = d.setTimeout(async () => {
      timer = null;
      try { await checkNow({ manual: false }); }
      catch (err) { console.error('[Extensions] the update check failed:', err.message); }
      if (started) schedule(d.everyMs);
    }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    start() { if (started) return; started = true; schedule(d.firstCheckMs); },
    stop() { started = false; if (timer) d.clearTimeout(timer); timer = null; },
    checkNow,
    get checking() { return !!running; },
    // The person approved a version that asks for more: fetched again (the
    // newest one) and installed, whatever it asks for — they saw the list.
    async approve(folder) {
      const item = d.list().find(i => i.folder === folder);
      if (!item) throw new Error('No installed extension in folder ' + folder);
      if (!item.source || !(item.source.webstore || item.source.catalog)) throw new Error('Vex cannot fetch this extension again: it was not installed from the Chrome Web Store or the catalogue.');
      const found = await d.find(item);
      if (!found) {
        mutate(s => { delete s.pending[folder]; });
        return { ok: true, current: true, version: item.version };
      }
      // What was approved is what the card listed; a still newer version that
      // asks for something beyond that is listed again instead.
      const shown = new Set(((d.readState().pending[folder] || {}).added || []).map(a => a.says));
      const added = addedPermissions(item.manifest, found.manifest);
      if (added.some(a => !shown.has(a.says))) {
        mutate(s => { s.pending[folder] = { version: found.version, added, at: d.now() }; });
        return { ok: false, needsApproval: true, version: found.version, added, error: `Version ${found.version} asks for more than what you approved. Look at the list again.` };
      }
      const record = await installOne(item, found, 'approved');
      return { ok: true, version: record.to, from: record.from, name: record.name };
    },
  };
}

module.exports = {
  UPDATE_SERVER, FIRST_CHECK_MS, CHECK_EVERY_MS, STAGGER_MS, STATE_FILE,
  parseVersion, compareVersions, checkUrl, parseUpdateResponse, codebaseAllowed,
  addedPermissions, defaultState, readState, writeState, isMeteredWindows,
  findWebStoreUpdate, findCatalogUpdate, zipManifest, createExtensionUpdater,
};
