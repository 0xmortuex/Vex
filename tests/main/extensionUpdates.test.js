// Installing a picked .crx with the Web Store's checks, automatic extension
// updates (src/main/extension-updates.js), catalogue downloads checked
// against GitHub's digest, and per-extension file:// access (security scan M6).
// Packages are built by hand the way Chrome builds them (crx3.proto), signed
// with keys made for the test; the network is a stub.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ws = require('../../src/main/webstore.js');
const upd = require('../../src/main/extension-updates.js');
const extHelpers = require('../../src/main/extensions.js');
const sources = require('../../src/main/extension-sources.js');
const AdmZip = require('adm-zip');
const { validateZip } = require('../../src/main/archive-security.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

// ---- building a CRX3 ---------------------------------------------------------
const varint = (n) => { const out = []; while (n > 127) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
const field = (num, bytes) => Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);
const spki = (key) => key.export({ type: 'spki', format: 'der' });
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const idOf = (der) => [...sha(der).subarray(0, 16).toString('hex')].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

const developer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const store = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const DEV_ID = idOf(spki(developer.publicKey));
const STORE_HASH = sha(spki(store.publicKey)).toString('hex');

function makeZip(files) {
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text));
  return zip.toBuffer();
}
const manifest = (over = {}) => ({ manifest_version: 3, name: 'Tester', version: '1.0.0', permissions: ['storage'], host_permissions: ['https://example.com/*'], ...over });
function makeCrx({ archive, signers = [developer], fromStore = false, version = 3 }) {
  const signedHeaderData = field(1, sha(spki(developer.publicKey)).subarray(0, 16));
  const message = ws.signedMessage(signedHeaderData, archive);
  const proofs = signers.map(pair => field(2, Buffer.concat([field(1, spki(pair.publicKey)), field(2, crypto.sign('sha256', message, pair.privateKey))])));
  if (fromStore) proofs.push(field(3, Buffer.concat([field(1, spki(store.publicKey)), field(2, crypto.sign('sha256', message, store.privateKey))])));
  const header = Buffer.concat([...proofs, field(10000, signedHeaderData)]);
  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'latin1');
  head.writeUInt32LE(version, 4);
  head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, archive]);
}
const codeOf = (fn) => { try { fn(); } catch (err) { return err.code || err.message; } return 'no error'; };

describe('a .crx picked from disk', () => {
  const plain = makeZip({ 'manifest.json': JSON.stringify(manifest()), 'a.js': '//' });
  const storeZip = makeZip({ 'manifest.json': JSON.stringify(manifest({ update_url: 'https://clients2.google.com/service/update2/crx' })), '_metadata/verified_contents.json': '[]' });

  it('accepts a developer-signed CRX3 and says it is not from the store', () => {
    const r = ws.verifyLocalCrx(makeCrx({ archive: plain }), { publisherKeySha256: STORE_HASH });
    expect(r.id).toBe(DEV_ID);
    expect(r.fromWebStore).toBe(false);
    const seen = ws.inspectLocalCrx(makeCrx({ archive: plain }), { AdmZip, validateZip, publisherKeySha256: STORE_HASH });
    expect(seen.info.name).toBe('Tester');
    expect(seen.publicKey.equals(Buffer.from(spki(developer.publicKey)))).toBe(true);
  });

  it('knows a store-signed package', () => {
    const seen = ws.inspectLocalCrx(makeCrx({ archive: storeZip, fromStore: true }), { AdmZip, validateZip, publisherKeySha256: STORE_HASH });
    expect(seen.fromWebStore).toBe(true);
    expect(seen.id).toBe(DEV_ID);
  });

  it('refuses a package that claims to be from the store without the store\'s signature', () => {
    expect(codeOf(() => ws.inspectLocalCrx(makeCrx({ archive: storeZip }), { AdmZip, validateZip, publisherKeySha256: STORE_HASH }))).toBe('bad-signature');
    // _metadata alone is a claim too, as is an update_url alone.
    const metaOnly = makeZip({ 'manifest.json': JSON.stringify(manifest()), '_metadata/verified_contents.json': '[]' });
    expect(codeOf(() => ws.inspectLocalCrx(makeCrx({ archive: metaOnly }), { AdmZip, validateZip, publisherKeySha256: STORE_HASH }))).toBe('bad-signature');
    expect(ws.claimsWebStore({ update_url: 'https://clients2.google.com/service/update2/crx' }, [])).toBe(true);
    expect(ws.claimsWebStore({ update_url: 'https://clients2.google.com.evil.example/service/update2/crx' }, [])).toBe(false);
    expect(ws.claimsWebStore({ update_url: 'https://example.com/updates.xml' }, [])).toBe(false);
  });

  it('refuses a tampered package', () => {
    const crx = makeCrx({ archive: plain });
    const bad = Buffer.from(crx);
    bad[bad.length - 30] ^= 0xff;
    expect(codeOf(() => ws.verifyLocalCrx(bad, { publisherKeySha256: STORE_HASH }))).toBe('bad-signature');
  });

  it('refuses a package signed only by a key other than the one its id names', () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(codeOf(() => ws.verifyLocalCrx(makeCrx({ archive: plain, signers: [other] }), { publisherKeySha256: STORE_HASH }))).toBe('bad-signature');
  });

  it('refuses CRX2 in plain words', () => {
    const crx2 = Buffer.concat([Buffer.from('Cr24', 'latin1'), Buffer.from([2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]), Buffer.alloc(8), plain]);
    expect(() => ws.verifyLocalCrx(crx2)).toThrow(/old CRX2 format/);
  });
});

describe('main.js: the picker goes through those checks', () => {
  const main = read('src/main.js');
  const between = (a, b) => { const i = main.indexOf(a); return main.slice(i, main.indexOf(b, i)); };
  it('no longer cuts a CRX header off unread anywhere', () => {
    expect(main).not.toMatch(/readUInt32LE\(8\) \+ zipBuffer\.readUInt32LE\(12\)/);
    expect(between('async function _installExtFromZipBuffer', '\n}\n')).toMatch(/'Cr24'\) return \{ ok: false/);
    expect(between('function _previewPickedFile', '\n}\n')).toMatch(/inspectLocalCrx/);
  });
  it('installs a picked package only after the dialog, by token, dropping _metadata and setting the key', () => {
    const h = between("ipcMain.handle('extensions:install-picked'", '\n});\n');
    expect(h).toMatch(/skipPrefixes: \['_metadata\/'\], manifestKey/);
    expect(h).toMatch(/_installWebStorePackage/);
    expect(between("ipcMain.handle('extensions:install-zip'", '\n});\n')).not.toMatch(/_installExtFromZipBuffer|_activateInstalledFolder/);
    expect(between("ipcMain.handle('extensions:install-folder'", '\n});\n')).not.toMatch(/_copyDirRecursive|_activateInstalledFolder/);
  });
  it('loads no extension with file access unless it was allowed', () => {
    expect(main).not.toMatch(/allowFileAccess: true/);
    expect((main.match(/_extLoadOptions\(/g) || []).length).toBeGreaterThanOrEqual(5);
  });
  it('every new channel has a contract and a preload method', () => {
    const { schemas } = require('../../src/main/ipc-schemas.js');
    const preload = read('src/preload.js');
    for (const ch of ['extensions:install-picked', 'extensions:update-status', 'extensions:update-check', 'extensions:set-auto-update', 'extensions:update-approve', 'extensions:set-file-access']) {
      expect(schemas.has(ch), ch).toBe(true);
      expect(preload).toContain(`'${ch}'`);
      expect(main).toContain(`ipcMain.handle('${ch}'`);
    }
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('extensions:install-picked', ['0123456789abcdef0123456789abcdef'])).not.toThrow();
    expect(() => validate('extensions:install-picked', ['../x'])).toThrow();
  });
});

describe('versions and the update protocol', () => {
  it('compares Chrome extension versions', () => {
    expect(upd.compareVersions('4.9.133', '4.9.99')).toBeGreaterThan(0);
    expect(upd.compareVersions('1.0', '1.0.0.0')).toBe(0);
    expect(upd.compareVersions('2', '10')).toBeLessThan(0);
    expect(() => upd.compareVersions('1.0-beta', '1.0')).toThrow(/Not an extension version/);
  });

  it('asks with the installed version', () => {
    const u = upd.checkUrl('eimadpbcbfnmbkopoojfekhnkhdbieeh', '4.9.1', '148.0.7778.0');
    expect(u).toBe('https://clients2.google.com/service/update2/crx?prodversion=148.0.7778.0&acceptformat=crx3&x=id%3Deimadpbcbfnmbkopoojfekhnkhdbieeh%26v%3D4.9.1%26uc');
  });

  // Answers as Google's server gave them on 2026-10-07.
  const ID = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
  it('reads "noupdate"', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0" server="prod"><daystart elapsed_days="7219" elapsed_seconds="16676"/><app appid="${ID}" cohort="1::" cohortname="" status="ok"><updatecheck _esbAllowlist="true" status="noupdate"/></app></gupdate>`;
    expect(upd.parseUpdateResponse(xml, ID)).toEqual({ status: 'noupdate' });
  });
  it('reads a new version with its address and hash', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0" server="prod"><app appid="${ID}" status="ok"><updatecheck _esbAllowlist="true" codebase="https://clients2.googleusercontent.com/crx/blobs/AZ/EIMADPBCBFNMBKOPOOJFEKHNKHDBIEEH_4_9_133_0.crx" fp="1.ee" hash_sha256="EE38F20D1D50789F4B482C9A1A5DADAB599B8682FD2A7DFB7DE21FAE8561B918" protected="0" size="851022" status="ok" version="4.9.133"/></app></gupdate>`;
    expect(upd.parseUpdateResponse(xml, ID)).toEqual({ status: 'update', version: '4.9.133', codebase: 'https://clients2.googleusercontent.com/crx/blobs/AZ/EIMADPBCBFNMBKOPOOJFEKHNKHDBIEEH_4_9_133_0.crx', sha256: 'ee38f20d1d50789f4b482c9a1a5dadab599b8682fd2a7dfb7de21fae8561b918' });
  });
  it('says when the store no longer has it, and refuses a download elsewhere', () => {
    expect(() => upd.parseUpdateResponse(`<gupdate><app appid="${ID}" status="error-unknownApplication"/></gupdate>`, ID)).toThrow(/no longer offers/);
    expect(() => upd.parseUpdateResponse(`<gupdate><app appid="${ID}" status="ok"><updatecheck codebase="https://evil.example/x.crx" status="ok" version="9.9"/></app></gupdate>`, ID)).toThrow(/somewhere other than Google/);
    expect(() => upd.parseUpdateResponse(`<gupdate><app appid="${ID}" status="ok"><updatecheck codebase="http://clients2.googleusercontent.com/x.crx" status="ok" version="9.9"/></app></gupdate>`, ID)).toThrow(/somewhere other than Google/);
    expect(() => upd.parseUpdateResponse('<gupdate></gupdate>', ID)).toThrow(/did not answer/);
    expect(upd.codebaseAllowed('https://googleusercontent.com.evil.example/x')).toBe(false);
  });
});

describe('a new version that asks for more', () => {
  it('lists new warning permissions and new sites, not silent ones', () => {
    const old = manifest();
    expect(upd.addedPermissions(old, manifest({ permissions: ['storage', 'alarms', 'scripting'] }))).toEqual([]);
    expect(upd.addedPermissions(old, manifest({ permissions: ['storage', 'cookies', 'downloads.open'] })).map(a => a.id)).toEqual(['cookies', 'downloads']);
    expect(upd.addedPermissions(old, manifest({ host_permissions: ['https://example.com/*', 'https://bank.example/*'] }))[0].says).toMatch(/bank\.example/);
    expect(upd.addedPermissions(old, manifest({ content_scripts: [{ matches: ['<all_urls>'], js: ['a.js'] }] }))[0].id).toBe('<all_urls>');
    // An extension that could already read every page asks for nothing more by naming a site.
    expect(upd.addedPermissions(manifest({ host_permissions: ['<all_urls>'] }), manifest({ host_permissions: ['https://x.example/*'] }))).toEqual([]);
    // Optional permissions are asked for when used.
    expect(upd.addedPermissions(old, manifest({ optional_permissions: ['history'] }))).toEqual([]);
  });
});

describe('finding a Web Store update', () => {
  const v1 = manifest({ version: '1.0.0' });
  function fakeFetch({ version = '2.0.0', archive, hash, crx }) {
    const pkg = crx || makeCrx({ archive: archive || makeZip({ 'manifest.json': JSON.stringify(manifest({ version })) }), fromStore: true });
    const h = hash === undefined ? crypto.createHash('sha256').update(pkg).digest('hex') : hash;
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      if (url.startsWith(upd.UPDATE_SERVER)) {
        const v = new URL(url).searchParams.get('x').match(/v=([^&]+)/)[1];
        const body = upd.compareVersions(version, v) > 0
          ? `<gupdate><app appid="${DEV_ID}" status="ok"><updatecheck codebase="https://clients2.googleusercontent.com/crx/blobs/x.crx" hash_sha256="${h}" status="ok" version="${version}"/></app></gupdate>`
          : `<gupdate><app appid="${DEV_ID}" status="ok"><updatecheck status="noupdate"/></app></gupdate>`;
        return new Response(body, { status: 200 });
      }
      const r = new Response(pkg, { status: 200 });
      Object.defineProperty(r, 'url', { value: url });
      return r;
    };
    return { fetch, calls };
  }
  const find = (fetch, installedVersion = '1.0.0') => upd.findWebStoreUpdate({ id: DEV_ID, installedVersion, fetch, chromeVersion: '148.0.0.0', AdmZip, validateZip, publisherKeySha256: STORE_HASH });

  it('returns null when Google says noupdate, without downloading', async () => {
    const f = fakeFetch({ version: '1.0.0' });
    expect(await find(f.fetch)).toBeNull();
    expect(f.calls).toHaveLength(1);
  });
  it('downloads, checks the hash and both signatures, and returns the new package', async () => {
    const found = await find(fakeFetch({ version: '2.0.0' }).fetch);
    expect(found.version).toBe('2.0.0');
    expect(found.id).toBe(DEV_ID);
    expect(upd.addedPermissions(v1, found.manifest)).toEqual([]);
  });
  it('refuses a package whose hash is not the one announced', async () => {
    await expect(find(fakeFetch({ hash: 'a'.repeat(64) }).fetch)).rejects.toThrow(/SHA-256 differs/);
  });
  it('refuses a package the store did not sign', async () => {
    const crx = makeCrx({ archive: makeZip({ 'manifest.json': JSON.stringify(manifest({ version: '2.0.0' })) }) });
    await expect(find(fakeFetch({ crx }).fetch)).rejects.toThrow(/not signed by the Chrome Web Store/);
  });
});

describe('catalogue downloads and GitHub\'s digest', () => {
  const zip = makeZip({ 'ext/manifest.json': JSON.stringify(manifest({ version: '3.1.0' })) });
  const digest = 'sha256:' + crypto.createHash('sha256').update(zip).digest('hex');
  it('accepts a matching digest, refuses a different one, and says when there is none', () => {
    expect(sources.checkAssetDigest(zip, { digest }).checked).toBe(true);
    expect(() => sources.checkAssetDigest(zip, { digest: 'sha256:' + '0'.repeat(64) })).toThrow(/not the one GitHub published/);
    expect(sources.checkAssetDigest(zip, {}).checked).toBe(false);
  });
  const release = (asset) => ({ tag_name: 'v3.1.0', assets: [{ name: 'darkreader-chrome.zip', browser_download_url: 'https://github.com/darkreader/darkreader/releases/download/v3.1.0/darkreader-chrome.zip', ...asset }] });
  const fetchFor = (rel) => async (url) => (url.startsWith('https://api.github.com/') ? new Response(JSON.stringify(rel), { status: 200 }) : new Response(zip, { status: 200 }));
  it('finds a newer release, reading the manifest inside a wrapper folder', async () => {
    const found = await upd.findCatalogUpdate({ catalogId: 'dark-reader', installedVersion: '3.0.0', fetch: fetchFor(release({ digest })), AdmZip, validateZip });
    expect(found).toMatchObject({ version: '3.1.0', tag: 'v3.1.0', file: 'darkreader-chrome.zip' });
    expect(found.digest.checked).toBe(true);
    expect(await upd.findCatalogUpdate({ catalogId: 'dark-reader', installedVersion: '3.1.0', fetch: fetchFor(release({ digest })), AdmZip, validateZip })).toBeNull();
  });
  it('refuses a release file that does not match its digest', async () => {
    await expect(upd.findCatalogUpdate({ catalogId: 'dark-reader', installedVersion: '3.0.0', fetch: fetchFor(release({ digest: 'sha256:' + '1'.repeat(64) })), AdmZip, validateZip })).rejects.toThrow(/not the one GitHub published/);
  });
});

describe('the update schedule', () => {
  let state;
  const base = (over = {}) => {
    state = upd.defaultState();
    const installed = [];
    const items = [{ folder: 'tester-1', name: 'Tester', version: '1.0.0', manifest: manifest(), source: { webstore: DEV_ID } },
      { folder: 'local-2', name: 'Local', version: '1.0.0', manifest: manifest(), source: null }];
    const updated = [];
    const deps = {
      list: () => items,
      find: async () => ({ version: '2.0.0', manifest: manifest({ version: '2.0.0' }) }),
      install: async (item, found) => { installed.push([item.folder, found.version]); return { ok: true, version: found.version }; },
      readState: () => JSON.parse(JSON.stringify(state)),
      writeState: (s) => { state = JSON.parse(JSON.stringify(s)); },
      isOnline: () => true,
      isMetered: async () => false,
      onUpdated: (r) => updated.push(r),
      staggerMs: 0,
      ...over,
    };
    return { updater: upd.createExtensionUpdater(deps), installed, updated };
  };

  it('updates what has a source, records it, and leaves the rest alone', async () => {
    const { updater, installed, updated } = base();
    const r = await updater.checkNow();
    expect(installed).toEqual([['tester-1', '2.0.0']]);
    expect(r.updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ folder: 'tester-1', from: '1.0.0', to: '2.0.0', how: 'auto' });
    expect(state.history.at(-1)).toMatchObject({ name: 'Tester', from: '1.0.0', to: '2.0.0' });
    expect(state.lastOutcome).toMatch(/Updated: Tester 1\.0\.0 → 2\.0\.0/);
    expect(state.lastCheck).toBeTypeOf('number');
  });

  it('does not install a version that asks for more: it waits for approval', async () => {
    const more = manifest({ version: '2.0.0', permissions: ['storage', 'cookies'] });
    const { updater, installed } = base({ find: async () => ({ version: '2.0.0', manifest: more }) });
    const r = await updater.checkNow();
    expect(installed).toEqual([]);
    expect(r.waiting[0].added.map(a => a.id)).toEqual(['cookies']);
    expect(state.pending['tester-1']).toMatchObject({ version: '2.0.0' });
    expect(state.lastOutcome).toMatch(/Waiting for your approval: Tester/);
    // Approved: installed, and no longer pending.
    const a = await updater.approve('tester-1');
    expect(a).toMatchObject({ ok: true, version: '2.0.0' });
    expect(installed).toEqual([['tester-1', '2.0.0']]);
    expect(state.pending['tester-1']).toBeUndefined();
    expect(state.history.at(-1).how).toBe('approved');
  });

  it('asks again when the version to approve asks for even more', async () => {
    let perms = ['storage', 'cookies'];
    const { updater, installed } = base({ find: async () => ({ version: '2.0.0', manifest: manifest({ version: '2.0.0', permissions: perms }) }) });
    await updater.checkNow();
    perms = ['storage', 'cookies', 'history'];
    const a = await updater.approve('tester-1');
    expect(a.ok).toBe(false);
    expect(a.needsApproval).toBe(true);
    expect(installed).toEqual([]);
    expect(state.pending['tester-1'].added.map(x => x.id)).toEqual(['cookies', 'history']);
  });

  it('skips when switched off, offline or metered; "Check now" still checks on a metered connection', async () => {
    let s = base();
    state.auto = false;
    expect(await s.updater.checkNow()).toEqual({ skipped: 'off' });
    expect(s.installed).toEqual([]);
    s = base({ isOnline: () => false });
    expect(await s.updater.checkNow({ manual: true })).toEqual({ skipped: 'offline' });
    s = base({ isMetered: async () => true });
    expect(await s.updater.checkNow()).toEqual({ skipped: 'metered' });
    expect(state.lastOutcome).toMatch(/metered/);
    expect(s.installed).toEqual([]);
    await s.updater.checkNow({ manual: true });
    expect(s.installed).toEqual([['tester-1', '2.0.0']]);
    s = base({ isMetered: async () => { throw new Error('Windows did not say'); } });
    expect((await s.updater.checkNow()).skipped).toBe('metered-unknown');
    expect(state.lastOutcome).toMatch(/Windows did not say/);
  });

  it('records a failed check against that extension, and a failed install', async () => {
    let s = base({ find: async () => { throw new Error('Google answered 503'); } });
    const r = await s.updater.checkNow();
    expect(r.failed[0]).toMatchObject({ folder: 'tester-1', error: 'Google answered 503' });
    expect(state.errors['tester-1']).toBe('Google answered 503');
    s = base({ install: async () => ({ ok: false, error: 'did not load' }) });
    await s.updater.checkNow();
    expect(state.errors['tester-1']).toBe('did not load');
    expect(state.history).toEqual([]);
  });

  it('runs one check at a time, first after two minutes and then every six hours', async () => {
    const timers = [];
    const { updater } = base({ setTimeout: (fn, ms) => { timers.push(ms); return { unref() {} }; }, clearTimeout: () => {} });
    updater.start();
    expect(timers).toEqual([upd.FIRST_CHECK_MS]);
    expect(upd.FIRST_CHECK_MS).toBe(120000);
    expect(upd.CHECK_EVERY_MS).toBe(6 * 3600 * 1000);
    const a = updater.checkNow(), b = updater.checkNow();
    expect(a).toBe(b);
    await a;
  });

  it('keeps its state in extensions/updates.json and refuses a corrupt one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-upd-'));
    try {
      expect(upd.readState(dir)).toEqual(upd.defaultState());
      upd.writeState(dir, { ...upd.defaultState(), auto: false });
      expect(upd.readState(dir).auto).toBe(false);
      fs.writeFileSync(path.join(dir, 'updates.json'), '[]');
      expect(() => upd.readState(dir)).toThrow(/corrupt/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('where an extension came from, and its access to files', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-ext-src-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('records catalogue installs next to Web Store ones', () => {
    extHelpers.writeSources(dir, { a: { webstore: DEV_ID }, b: { catalog: 'dark-reader', tag: 'v4.9.1', file: 'x.zip', digest: 'sha256:00' }, c: { catalog: '../x' } });
    expect(extHelpers.readSources(dir)).toEqual({ a: { webstore: DEV_ID }, b: { catalog: 'dark-reader', tag: 'v4.9.1', file: 'x.zip', digest: 'sha256:00' } });
  });

  it('names the file:// patterns a manifest asks for, not <all_urls>', () => {
    expect(extHelpers.fileUrlPatterns({ host_permissions: ['<all_urls>'] })).toEqual([]);
    expect(extHelpers.fileUrlPatterns({ content_scripts: [{ matches: ['file:///*.md'] }] })).toEqual(['file:///*.md']);
    expect(extHelpers.fileUrlPatterns({ permissions: ['file://*/*', 'tabs'] })).toEqual(['file://*/*']);
  });

  it('turns file access off for existing installs, except one whose job is files', () => {
    expect(extHelpers.readFileAccess(dir)).toBeNull();
    const state = extHelpers.migrateFileAccess([
      { folder: 'dark-reader-1', manifest: { host_permissions: ['<all_urls>'] } },
      { folder: 'markdown-viewer-2', manifest: { content_scripts: [{ matches: ['file:///*.md'] }] } },
      { folder: 'broken-3', manifest: null },
    ]);
    expect(state).toEqual({ allow: { 'markdown-viewer-2': true }, kept: { 'markdown-viewer-2': true } });
    extHelpers.writeFileAccess(dir, state);
    expect(extHelpers.readFileAccess(dir)).toEqual(state);
    fs.writeFileSync(path.join(dir, extHelpers.FILE_ACCESS_FILE), '"x"');
    expect(() => extHelpers.readFileAccess(dir)).toThrow(/corrupt/);
  });
});
