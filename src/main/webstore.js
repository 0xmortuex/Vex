// === Installing from the Chrome Web Store ==================================
// Vex fetches an extension's package from Google's own update server, the one
// Chrome, Brave and Vivaldi use, and installs it only when its signatures
// check out. It does not go through a third-party "CRX downloader".
//
// A Web Store package is a CRX3 file (components/crx_file/crx3.proto):
//   "Cr24"  uint32le 3  uint32le header_size  CrxFileHeader  zip archive
//   CrxFileHeader {
//     repeated AsymmetricKeyProof sha256_with_rsa   = 2;
//     repeated AsymmetricKeyProof sha256_with_ecdsa = 3;
//     bytes signed_header_data = 10000;            // a SignedData { bytes crx_id = 1; }
//   }
//   AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }
// Every proof signs "CRX3 SignedData\x00" + uint32le(len(signed_header_data))
// + signed_header_data + the archive. The extension id is the first 16 bytes
// of the SHA-256 of the developer's public key, one letter a-p per hex digit.
//
// What Vex requires, as Chrome does for a Web Store install
// (components/crx_file/crx_verifier.cc, CRX3_WITH_PUBLISHER_PROOF):
//   * every proof in the header verifies;
//   * the signed crx_id is the id that was asked for;
//   * one proof's key hashes to that id (the developer's signature);
//   * one proof's key is the Web Store's own publisher key, which Chrome pins
//     by the SHA-256 below (its "ecdsa_2017_public" key).
// Anything else is refused and nothing is written to disk.
const crypto = require('crypto');
const { extensionIdFrom } = require('../renderer/js/web-store-link');

const MAGIC = 'Cr24';
const SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\x00', 'latin1');
// Chromium's kPublisherKeyHash (crx_verifier.cc).
const WEBSTORE_PUBLISHER_KEY_SHA256 = '61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf';
const MAX_CRX_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120000;
// A package downloaded for the permissions dialog is installed from memory
// when the user agrees, if they agree within this long.
const PREVIEW_TTL_MS = 10 * 60 * 1000;

class WebStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'WebStoreError'; this.code = code; }
}

function updateUrl(id, chromeVersion) {
  if (!/^[a-p]{32}$/.test(String(id))) throw new WebStoreError('bad-input', 'Not an extension id: ' + id);
  if (!/^\d+(\.\d+){0,3}$/.test(String(chromeVersion))) throw new TypeError('updateUrl: chromeVersion must look like 148.0.1234.5');
  return 'https://clients2.google.com/service/update2/crx?response=redirect'
    + '&prodversion=' + chromeVersion
    + '&acceptformat=crx2,crx3'
    + '&x=id%3D' + id + '%26installsource%3Dondemand%26uc';
}

function idFromPublicKey(der) {
  const hex = crypto.createHash('sha256').update(der).digest().subarray(0, 16).toString('hex');
  return idFromHex(hex);
}
function idFromHex(hex) {
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// ---- protobuf, just enough of it -------------------------------------------
function readVarint(buf, pos) {
  let value = 0, mul = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new WebStoreError('bad-header', 'The package header is cut short.');
    const b = buf[pos++];
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) {
      if (!Number.isSafeInteger(value)) throw new WebStoreError('bad-header', 'The package header has a number too large to read.');
      return [value, pos];
    }
    mul *= 128;
  }
  throw new WebStoreError('bad-header', 'The package header has a malformed number.');
}

// [{ field, value: Buffer }] for the length-delimited fields; other wire types
// are skipped, as a reader of an older proto would.
function readFields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key; [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8), wire = key % 8;
    if (field === 0) throw new WebStoreError('bad-header', 'The package header is malformed.');
    if (wire === 0) { [, pos] = readVarint(buf, pos); continue; }
    if (wire === 1) { pos += 8; }
    else if (wire === 5) { pos += 4; }
    else if (wire === 2) {
      let len; [len, pos] = readVarint(buf, pos);
      if (pos + len > buf.length) throw new WebStoreError('bad-header', 'The package header is cut short.');
      out.push({ field, value: buf.subarray(pos, pos + len) });
      pos += len;
      continue;
    } else throw new WebStoreError('bad-header', 'The package header is malformed.');
    if (pos > buf.length) throw new WebStoreError('bad-header', 'The package header is cut short.');
  }
  return out;
}

function readProof(buf) {
  const proof = { publicKey: null, signature: null };
  for (const { field, value } of readFields(buf)) {
    if (field === 1) proof.publicKey = value;
    else if (field === 2) proof.signature = value;
  }
  return proof;
}

// Splits a CRX3 file into its proofs, the signed header data and the archive.
// Throws a WebStoreError with code 'not-crx' / 'crx2' / 'crx-version' /
// 'bad-header' when it is not a CRX3 package.
function parseCrx3(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('parseCrx3: expected a Buffer');
  if (buf.length < 12 || buf.subarray(0, 4).toString('latin1') !== MAGIC) {
    throw new WebStoreError('not-crx', 'What Google sent is not an extension package.');
  }
  const version = buf.readUInt32LE(4);
  if (version === 2) throw new WebStoreError('crx2', 'This extension is packed in the old CRX2 format, which Chrome itself no longer installs, so it cannot be checked. Nothing was installed.');
  if (version !== 3) throw new WebStoreError('crx-version', `This extension package is in a format Vex does not know (CRX version ${version}).`);
  const headerSize = buf.readUInt32LE(8);
  if (12 + headerSize > buf.length) throw new WebStoreError('bad-header', 'The package is cut short.');
  const header = buf.subarray(12, 12 + headerSize);
  const archive = buf.subarray(12 + headerSize);
  const rsa = [], ecdsa = [];
  let signedHeaderData = null;
  for (const { field, value } of readFields(header)) {
    if (field === 2) rsa.push(readProof(value));
    else if (field === 3) ecdsa.push(readProof(value));
    else if (field === 10000) signedHeaderData = value;
  }
  let crxId = null;
  if (signedHeaderData) {
    for (const { field, value } of readFields(signedHeaderData)) if (field === 1) crxId = value;
  }
  return { version, rsa, ecdsa, signedHeaderData, crxId, archive };
}

function signedMessage(signedHeaderData, archive) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(signedHeaderData.length);
  return Buffer.concat([SIGNED_DATA_PREFIX, len, signedHeaderData, archive]);
}

function verifyProof(proof, message) {
  if (!proof.publicKey || !proof.signature) return false;
  let key;
  try { key = crypto.createPublicKey({ key: proof.publicKey, format: 'der', type: 'spki' }); }
  catch { return false; }
  try { return crypto.verify('sha256', message, key, proof.signature); }
  catch { return false; }
}

// Returns { id, publicKey, archive } for a package whose signatures check out
// for expectedId; throws WebStoreError otherwise. publisherKeySha256 null
// skips the publisher check (only the tests' own packages need that).
function verifyCrx3(buf, { expectedId, publisherKeySha256 = WEBSTORE_PUBLISHER_KEY_SHA256 } = {}) {
  if (!/^[a-p]{32}$/.test(String(expectedId))) throw new TypeError('verifyCrx3: expectedId must be an extension id');
  const crx = parseCrx3(buf);
  const failed = (why) => new WebStoreError('bad-signature', `The package's signature does not check out (${why}). It may have been changed on the way. Nothing was installed.`);
  if (!crx.signedHeaderData || !crx.crxId || crx.crxId.length !== 16) throw failed('it names no extension id');
  const signedId = idFromHex(crx.crxId.toString('hex'));
  if (signedId !== expectedId) {
    throw new WebStoreError('wrong-id', `Google sent a different extension (${signedId}) from the one asked for (${expectedId}). Nothing was installed.`);
  }
  const proofs = [...crx.rsa.map(p => ({ ...p, kind: 'rsa' })), ...crx.ecdsa.map(p => ({ ...p, kind: 'ecdsa' }))];
  if (!proofs.length) throw failed('it is not signed');
  const message = signedMessage(crx.signedHeaderData, crx.archive);
  for (const proof of proofs) {
    if (!verifyProof(proof, message)) throw failed('a signature does not match its contents');
  }
  const developer = proofs.find(p => idFromPublicKey(p.publicKey) === expectedId);
  if (!developer) throw failed('it is not signed by the extension\'s own key');
  if (publisherKeySha256) {
    const fromStore = proofs.some(p => crypto.createHash('sha256').update(p.publicKey).digest('hex') === publisherKeySha256);
    if (!fromStore) throw failed('it is not signed by the Chrome Web Store');
  }
  return { id: expectedId, publicKey: Buffer.from(developer.publicKey), archive: Buffer.from(crx.archive) };
}

// ---- a .crx picked from disk ---------------------------------------------------
// Settings › Extensions › "Install from .zip / .crx". The file names its own
// id (the signed crx_id), so there is no id to expect; otherwise the same
// rules as above: every proof verifies and one is the developer's, whose key
// hashes to that id. fromWebStore says whether the Web Store's own key signed
// it too. A CRX2 file is refused by parseCrx3.
function verifyLocalCrx(buf, { publisherKeySha256 = WEBSTORE_PUBLISHER_KEY_SHA256 } = {}) {
  const crx = parseCrx3(buf);
  const failed = (why) => new WebStoreError('bad-signature', `This package's signature does not check out (${why}). It may have been changed after it was made. Nothing was installed.`);
  if (!crx.signedHeaderData || !crx.crxId || crx.crxId.length !== 16) throw failed('it names no extension id');
  const id = idFromHex(crx.crxId.toString('hex'));
  const proofs = [...crx.rsa, ...crx.ecdsa];
  if (!proofs.length) throw failed('it is not signed');
  const message = signedMessage(crx.signedHeaderData, crx.archive);
  for (const proof of proofs) {
    if (!verifyProof(proof, message)) throw failed('a signature does not match its contents');
  }
  const developer = proofs.find(p => idFromPublicKey(p.publicKey) === id);
  if (!developer) throw failed('it is not signed by the extension\'s own key');
  const fromWebStore = !!publisherKeySha256 && proofs.some(p => crypto.createHash('sha256').update(p.publicKey).digest('hex') === publisherKeySha256);
  return { id, publicKey: Buffer.from(developer.publicKey), archive: Buffer.from(crx.archive), fromWebStore };
}

// Whether a package presents itself as a Chrome Web Store one: the store
// writes its update address into the manifest and its hashes into
// _metadata/verified_contents.json. Such a package must carry the store's
// signature; a developer's own .crx has neither.
function claimsWebStore(manifest, entryNames) {
  const u = manifest && typeof manifest.update_url === 'string' ? manifest.update_url : '';
  // No update_url, or not an address: no claim by it.
  const url = URL.canParse(u) ? new URL(u) : null;
  const fromGoogle = !!url && /(^|\.)google\.com$/i.test(url.hostname) && /\/service\/update2\/crx/.test(url.pathname);
  return fromGoogle || (Array.isArray(entryNames) && entryNames.includes('_metadata/verified_contents.json'));
}

// The whole check of a picked .crx: signatures, the store claim, the manifest.
// Returns what the permissions dialog shows plus what installing needs.
function inspectLocalCrx(buf, { AdmZip, validateZip, publisherKeySha256 = WEBSTORE_PUBLISHER_KEY_SHA256 }) {
  const verified = verifyLocalCrx(buf, { publisherKeySha256 });
  const pkg = readPackage(verified.archive, { AdmZip, validateZip });
  const names = new AdmZip(verified.archive).getEntries().map(e => e.entryName);
  if (!verified.fromWebStore && claimsWebStore(pkg.manifest, names)) {
    throw new WebStoreError('bad-signature', 'This package says it comes from the Chrome Web Store, but the Chrome Web Store did not sign it. It may have been changed after it was downloaded. Nothing was installed.');
  }
  return { ...verified, manifest: pkg.manifest, messages: pkg.messages, info: describe(pkg.manifest, pkg.messages) };
}

// ---- downloading -------------------------------------------------------------
// fetch is Vex's bounded net.fetch (src/renderer/js/network.js): it follows
// redirects and stops at maxBytes and timeoutMs.
async function downloadCrx({ fetch, id, chromeVersion, maxBytes = MAX_CRX_BYTES, timeoutMs = DOWNLOAD_TIMEOUT_MS }) {
  if (typeof fetch !== 'function') throw new TypeError('downloadCrx: fetch is required');
  const url = updateUrl(id, chromeVersion);
  let res;
  try {
    // No cookies either way: Google learns the id, the version and the IP, nothing more.
    res = await fetch(url, { maxBytes, timeoutMs, redirect: 'follow', credentials: 'omit', headers: { Accept: 'application/x-chrome-extension, application/octet-stream' } });
  } catch (err) {
    const why = (err && err.message) || String(err);
    if (/too large/i.test(why)) throw new WebStoreError('too-large', `The package is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, so Vex stopped downloading it.`);
    if (/timed out/i.test(why)) throw new WebStoreError('network', 'The download from Google took too long and was stopped. Try again.');
    throw new WebStoreError('network', `Could not reach Google's extension server: ${why}`);
  }
  if (res.status === 204 || res.status === 404 || res.status === 410) {
    throw new WebStoreError('not-found', 'The Chrome Web Store has no extension with that id. It may have been removed from the store, or it is not public.');
  }
  if (!res.ok) throw new WebStoreError('download', `The download failed: Google's server answered ${res.status}.`);
  const finalUrl = String(res.url || url);
  if (!/^https:\/\//i.test(finalUrl)) throw new WebStoreError('insecure', 'Google sent the download over an unencrypted connection, so Vex refused it.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new WebStoreError('not-found', 'The Chrome Web Store has no extension with that id. It may have been removed from the store, or it is not public.');
  return buf;
}

// ---- what the package is -------------------------------------------------------
// The manifest and its _locales messages, read from the verified archive.
// validateZip is src/main/archive-security.js's checker.
function readPackage(archive, { AdmZip, validateZip }) {
  let zip;
  try { zip = new AdmZip(archive); }
  catch (err) { throw new WebStoreError('not-zip', `The package's contents are not a readable archive (${err.message}).`); }
  const entries = validateZip(zip);
  const manifestEntry = entries.find(e => e.entryName === 'manifest.json');
  if (!manifestEntry) throw new WebStoreError('no-manifest', 'The package has no manifest.json, so it is not an extension Vex can install.');
  let manifest;
  try { manifest = JSON.parse(stripBom(manifestEntry.getData().toString('utf-8'))); }
  catch (err) { throw new WebStoreError('no-manifest', `The package's manifest.json cannot be read (${err.message}).`); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new WebStoreError('no-manifest', 'The package\'s manifest.json is not an object.');
  const messages = Object.create(null);
  for (const locale of [manifest.default_locale, 'en'].filter(l => typeof l === 'string' && l)) {
    const entry = entries.find(e => e.entryName === `_locales/${locale}/messages.json`);
    if (!entry) continue;
    let parsed;
    try { parsed = JSON.parse(stripBom(entry.getData().toString('utf-8'))); }
    catch (err) { throw new WebStoreError('no-manifest', `The package's _locales/${locale}/messages.json cannot be read (${err.message}).`); }
    for (const [key, value] of Object.entries(parsed || {})) {
      if (value && typeof value.message === 'string') messages[key] = value.message;
    }
    break;
  }
  return { manifest, messages };
}
function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

const strings = (v) => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []);

// What may not work here, in words, from the manifest. Checked against what
// Vex's stand-ins really provide (src/preload-webview.js,
// src/preload-extension-sw.js): tabs.create/remove, storage.sync and
// permissions work; these do not.
function cautions(manifest) {
  const m = manifest || {};
  const perms = new Set([...strings(m.permissions), ...strings(m.optional_permissions)]);
  const has = (...names) => names.some(n => perms.has(n));
  const out = [];
  if (has('declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'declarativeNetRequestFeedback', 'webRequestBlocking')) {
    out.push('It cannot block or redirect requests here (declarativeNetRequest, blocking webRequest): Electron gives extensions no request blocking. Vex\'s own blocker does that.');
  }
  if (m.commands && typeof m.commands === 'object' && Object.values(m.commands).some(c => c && c.global === true)) out.push('Its shortcuts work only while Vex is in front, not from other programs (global commands).');
  if (has('userScripts')) out.push('Its user scripts will not run: Electron has no chrome.userScripts.');
  if (has('cookies')) out.push('It cannot read or change cookies here (cookies).');
  if (has('webNavigation')) out.push('It is not told when pages navigate (webNavigation).');
  if (has('sidePanel') || m.side_panel) out.push('Its side panel will not open (sidePanel).');
  if (has('nativeMessaging')) out.push('It cannot talk to programs on this machine (nativeMessaging).');
  if (has('identity')) out.push('Signing in through it (identity) will not work.');
  return out;
}

// Why Vex will not install it at all, or null.
// A Chrome theme is never loaded as an extension: Vex adds it to the user's
// themes instead (main/chrome-theme.js). One whose manifest also declares
// extension parts (a background script, content scripts…) is an extension
// as well, and may be installed as one; its theme is then not used.
function refusal(manifest) {
  const m = manifest || {};
  if (m.theme && !require('./chrome-theme').codeIn(m, []).keys.length) {
    return 'This is a Chrome theme, not an extension. Vex adds it to your themes instead: use Add to Vex on its Web Store page, or Settings › Appearance › Chrome theme.';
  }
  if (m.app) return 'This is a Chrome app, not an extension. Chrome apps do not run in Vex.';
  if (m.manifest_version !== 2 && m.manifest_version !== 3) return `This package's manifest version (${m.manifest_version}) is not one Vex can load.`;
  return null;
}

function localize(value, messages) {
  if (typeof value !== 'string') return value;
  return value.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (token, key) =>
    (messages && Object.prototype.hasOwnProperty.call(messages, key)) ? messages[key] : token);
}

// Everything the permissions dialog shows.
function describe(manifest, messages, { audit } = {}) {
  const m = manifest || {};
  const auditor = audit || require('./extension-audit');
  const permissions = strings(m.permissions).filter(p => !/:\/\/|^<all_urls>$/.test(p));
  const hostPermissions = [...strings(m.host_permissions), ...strings(m.permissions).filter(p => /:\/\/|^<all_urls>$/.test(p))];
  return {
    name: localize(m.name, messages) || 'Unnamed extension',
    version: typeof m.version === 'string' ? m.version : '',
    description: localize(m.description, messages) || '',
    manifestVersion: m.manifest_version,
    isTheme: !!(m.theme && typeof m.theme === 'object'),
    permissions,
    optionalPermissions: strings(m.optional_permissions),
    hostPermissions,
    reach: auditor.reach(m),
    powers: auditor.powers(m),
    cautions: cautions(m),
    refuse: refusal(m),
  };
}

// ---- the whole flow ---------------------------------------------------------
// preview(input): download, verify and describe; the verified package is kept
//   in memory for PREVIEW_TTL_MS so installing does not download it again.
// take(input): the verified package for installing (downloaded again when
//   the preview is older than that), and forgotten here.
// Both throw WebStoreError with a sentence fit to show.
function createWebStoreInstaller({ fetch, chromeVersion, AdmZip, validateZip, now = Date.now, ttlMs = PREVIEW_TTL_MS, publisherKeySha256 = WEBSTORE_PUBLISHER_KEY_SHA256 }) {
  if (typeof fetch !== 'function') throw new TypeError('createWebStoreInstaller: fetch is required');
  if (typeof AdmZip !== 'function' || typeof validateZip !== 'function') throw new TypeError('createWebStoreInstaller: AdmZip and validateZip are required');
  const cache = new Map();
  async function load(input) {
    let id;
    try { id = extensionIdFrom(input); }
    catch (err) { throw new WebStoreError('bad-input', err.message); }
    const hit = cache.get(id);
    if (hit && now() - hit.at < ttlMs) return hit;
    cache.delete(id);
    const crx = await downloadCrx({ fetch, id, chromeVersion });
    const verified = verifyCrx3(crx, { expectedId: id, publisherKeySha256 });
    const pkg = readPackage(verified.archive, { AdmZip, validateZip });
    const entry = { id, at: now(), archive: verified.archive, publicKey: verified.publicKey, manifest: pkg.manifest, messages: pkg.messages, info: describe(pkg.manifest, pkg.messages) };
    cache.set(id, entry);
    return entry;
  }
  return {
    async preview(input) {
      const e = await load(input);
      return { id: e.id, ...e.info };
    },
    async take(input) {
      const e = await load(input);
      cache.delete(e.id);
      if (e.info.refuse) throw new WebStoreError('incompatible', e.info.refuse);
      return e;
    },
    // A theme's colours and pictures, read from the same verified package
    // (main/chrome-theme.js themePreview). Nothing is installed here: the
    // window makes it one of the user's themes.
    async theme(input) {
      const e = await load(input);
      if (!e.info.isTheme) throw new WebStoreError('not-theme', 'This package is not a Chrome theme.');
      return require('./chrome-theme').themePreview(e.archive, { AdmZip, validateZip });
    },
  };
}

module.exports = {
  WEBSTORE_PUBLISHER_KEY_SHA256, MAX_CRX_BYTES, PREVIEW_TTL_MS, WebStoreError,
  extensionIdFrom, updateUrl, idFromPublicKey, parseCrx3, verifyCrx3, signedMessage,
  verifyLocalCrx, claimsWebStore, inspectLocalCrx,
  downloadCrx, readPackage, cautions, refusal, describe, createWebStoreInstaller,
};
