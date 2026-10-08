// Installing from the Chrome Web Store (src/main/webstore.js): which extension
// a link names, the CRX3 format, its signatures, and the download-and-install
// flow with the network stubbed. The packages here are built by hand the way
// Google builds them (crx3.proto), signed with keys made for the test.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ws = require('../../src/main/webstore.js');
const link = require('../../src/renderer/js/web-store-link.js');
const AdmZip = require('adm-zip');
const { validateZip } = require('../../src/main/archive-security.js');
const extHelpers = require('../../src/main/extensions.js');

// ---- building a CRX3 ---------------------------------------------------------
const varint = (n) => { const out = []; while (n > 127) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
const field = (num, bytes) => Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);
const spki = (key) => key.export({ type: 'spki', format: 'der' });
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const idOf = (der) => [...sha(der).subarray(0, 16).toString('hex')].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

const developer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const store = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const DEV_ID = idOf(spki(developer.publicKey));
const STORE_HASH = sha(spki(store.publicKey)).toString('hex');

function makeZip(files) {
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text));
  return zip.toBuffer();
}
const MANIFEST = {
  manifest_version: 3, name: '__MSG_appName__', version: '1.2.3', default_locale: 'en', description: '__MSG_appDesc__',
  permissions: ['storage', 'contextMenus', 'cookies', 'declarativeNetRequest'], optional_permissions: ['downloads'],
  host_permissions: ['https://example.com/*'], commands: { toggle: { description: 'Toggle' } },
};
const ZIP = makeZip({
  'manifest.json': JSON.stringify(MANIFEST),
  '_locales/en/messages.json': JSON.stringify({ appName: { message: 'Test Helper' }, appDesc: { message: 'Helps tests' } }),
  '_metadata/verified_contents.json': '[]',
  'background.js': '// nothing',
});

// signers: [{ kind: 'rsa'|'ecdsa', pair }]; crxIdFrom: whose key the signed id names.
function makeCrx({ archive = ZIP, signers = [{ kind: 'rsa', pair: developer }, { kind: 'ecdsa', pair: store }], crxIdFrom = developer, version = 3 } = {}) {
  const crxId = sha(spki(crxIdFrom.publicKey)).subarray(0, 16);
  const signedHeaderData = field(1, crxId);
  const message = ws.signedMessage(signedHeaderData, archive);
  const proofs = signers.map(({ kind, pair }) => field(kind === 'rsa' ? 2 : 3,
    Buffer.concat([field(1, spki(pair.publicKey)), field(2, crypto.sign('sha256', message, pair.privateKey))])));
  const header = Buffer.concat([...proofs, field(10000, signedHeaderData)]);
  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'latin1');
  head.writeUInt32LE(version, 4);
  head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, archive]);
}
const verifyTest = (buf, expectedId = DEV_ID) => ws.verifyCrx3(buf, { expectedId, publisherKeySha256: STORE_HASH });
const codeOf = (fn) => { try { fn(); } catch (err) { return err.code || err.message; } return 'no error'; };

describe('which extension a link names', () => {
  const id = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
  it('reads the id from store links, old and new, and from a bare id', () => {
    expect(link.extensionIdFrom(`https://chromewebstore.google.com/detail/dark-reader/${id}`)).toBe(id);
    expect(link.extensionIdFrom(`https://chromewebstore.google.com/detail/${id}?hl=en&utm_source=x`)).toBe(id);
    expect(link.extensionIdFrom(`https://chromewebstore.google.com/detail/dark-reader/${id}/reviews`)).toBe(id);
    expect(link.extensionIdFrom(`https://chrome.google.com/webstore/detail/dark-reader/${id}`)).toBe(id);
    expect(link.extensionIdFrom(`  ${id.toUpperCase()}  `)).toBe(id);
    expect(link.extensionIdFrom(`HTTPS://ChromeWebStore.Google.com/detail/x/${id.toUpperCase()}`)).toBe(id);
    expect(ws.extensionIdFrom).toBe(link.extensionIdFrom);
  });
  it('refuses anything else, in words', () => {
    expect(() => link.extensionIdFrom('https://chromewebstore.google.com/')).toThrow(/not an extension's page/);
    expect(() => link.extensionIdFrom(`https://evil.example/detail/x/${id}`)).toThrow(/not a Chrome Web Store link/);
    expect(() => link.extensionIdFrom(`https://chromewebstore.google.com.evil.example/detail/${id}`)).toThrow(/not a Chrome Web Store link/);
    expect(() => link.extensionIdFrom(`javascript:alert('${id}')`)).toThrow();
    expect(() => link.extensionIdFrom('qrstuvwxqrstuvwxqrstuvwxqrstuvwx')).toThrow();   // letters past p
    expect(() => link.extensionIdFrom(id.slice(1))).toThrow();
    expect(() => link.extensionIdFrom('')).toThrow(/Paste/);
    expect(() => link.extensionIdFrom(42)).toThrow(TypeError);
  });
  it('tells a store extension page from every other page', () => {
    expect(link.idFromUrl(`https://chromewebstore.google.com/detail/dark-reader/${id}`)).toBe(id);
    expect(link.idFromUrl('https://chromewebstore.google.com/category/extensions')).toBeNull();
    expect(link.idFromUrl(`https://www.google.com/search?q=${id}`)).toBeNull();
    expect(link.idFromUrl('not a url')).toBeNull();
  });
  it('asks Google with the Chromium version and the id', () => {
    const url = ws.updateUrl(id, '148.0.7778.97');
    expect(url).toBe(`https://clients2.google.com/service/update2/crx?response=redirect&prodversion=148.0.7778.97&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`);
    expect(() => ws.updateUrl('nope', '148.0')).toThrow();
  });
});

describe('the CRX3 package', () => {
  it('reads the proofs, the signed id and the archive', () => {
    const crx = ws.parseCrx3(makeCrx());
    expect(crx.version).toBe(3);
    expect(crx.rsa).toHaveLength(1);
    expect(crx.ecdsa).toHaveLength(1);
    expect(Buffer.compare(crx.archive, ZIP)).toBe(0);
    expect(crx.crxId.toString('hex')).toBe(sha(spki(developer.publicKey)).subarray(0, 16).toString('hex'));
  });
  it('refuses CRX2, other versions, plain zips, garbage and a cut-short header', () => {
    const crx2 = Buffer.concat([Buffer.from('Cr24', 'latin1'), Buffer.from([2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]), Buffer.alloc(8), ZIP]);
    expect(codeOf(() => ws.parseCrx3(crx2))).toBe('crx2');
    expect(codeOf(() => ws.parseCrx3(makeCrx({ version: 4 })))).toBe('crx-version');
    expect(codeOf(() => ws.parseCrx3(ZIP))).toBe('not-crx');
    expect(codeOf(() => ws.parseCrx3(Buffer.from('<html>Not Found</html>')))).toBe('not-crx');
    expect(codeOf(() => ws.parseCrx3(Buffer.alloc(0)))).toBe('not-crx');
    const short = makeCrx().subarray(0, 40);
    expect(codeOf(() => ws.parseCrx3(short))).toBe('bad-header');
    const lying = Buffer.from(makeCrx());
    lying.writeUInt32LE(0xffffff, 8);
    expect(codeOf(() => ws.parseCrx3(lying))).toBe('bad-header');
    expect(ws.parseCrx3.bind(null, 'Cr24')).toThrow(TypeError);
  });
});

describe('the signatures', () => {
  it('a package signed by the developer and the store checks out', () => {
    const v = verifyTest(makeCrx());
    expect(v.id).toBe(DEV_ID);
    expect(Buffer.compare(v.archive, ZIP)).toBe(0);
    expect(idOf(v.publicKey)).toBe(DEV_ID);
    expect(ws.idFromPublicKey(v.publicKey)).toBe(DEV_ID);
  });
  it('one changed byte of the archive is refused', () => {
    const crx = Buffer.from(makeCrx());
    crx[crx.length - 30] ^= 0x01;
    expect(codeOf(() => verifyTest(crx))).toBe('bad-signature');
  });
  it('a changed signature is refused', () => {
    const crx = Buffer.from(makeCrx());
    crx[40] ^= 0x01;   // inside the first proof
    expect(['bad-signature', 'bad-header']).toContain(codeOf(() => verifyTest(crx)));
  });
  it('a package for another extension is refused', () => {
    expect(codeOf(() => verifyTest(makeCrx(), idOf(spki(stranger.publicKey))))).toBe('wrong-id');
  });
  it('a package signed with the wrong key is refused, even when it names the right id', () => {
    const forged = makeCrx({ signers: [{ kind: 'rsa', pair: stranger }, { kind: 'ecdsa', pair: store }], crxIdFrom: developer });
    expect(codeOf(() => verifyTest(forged))).toBe('bad-signature');
    expect(() => verifyTest(forged)).toThrow(/extension's own key/);
  });
  it('a package without the store\'s signature is refused', () => {
    const selfSigned = makeCrx({ signers: [{ kind: 'rsa', pair: developer }] });
    expect(() => verifyTest(selfSigned)).toThrow(/not signed by the Chrome Web Store/);
    // ...and the real Web Store key is the default: a test package never passes it.
    expect(() => ws.verifyCrx3(makeCrx(), { expectedId: DEV_ID })).toThrow(/not signed by the Chrome Web Store/);
    expect(ws.WEBSTORE_PUBLISHER_KEY_SHA256).toBe('61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf');
  });
  it('an unsigned package is refused', () => {
    expect(codeOf(() => verifyTest(makeCrx({ signers: [] })))).toBe('bad-signature');
  });
});

describe('what the dialog says', () => {
  it('names the permissions, the sites, and what will not work here', () => {
    const pkg = ws.readPackage(ZIP, { AdmZip, validateZip });
    const d = ws.describe(pkg.manifest, pkg.messages);
    expect(d.name).toBe('Test Helper');
    expect(d.description).toBe('Helps tests');
    expect(d.permissions).toEqual(['storage', 'contextMenus', 'cookies', 'declarativeNetRequest']);
    expect(d.optionalPermissions).toEqual(['downloads']);
    expect(d.hostPermissions).toEqual(['https://example.com/*']);
    expect(d.reach.level).toBe('some');
    expect(d.powers.map(p => p.id)).toContain('cookies');
    const all = d.cautions.join(' ');
    expect(all).toMatch(/cannot block/);
    // Right-click menu items and shortcuts work now; only global ones do not.
    expect(all).not.toMatch(/right-click menu|keyboard shortcuts are not bound/);
    expect(all).toMatch(/cookies/);
    expect(d.refuse).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('says nothing is missing for an extension that only uses what works', () => {
    expect(ws.cautions({ manifest_version: 3, permissions: ['storage', 'tabs', 'scripting', 'alarms'] })).toEqual([]);
  });
  it('refuses themes, apps and unknown manifest versions', () => {
    expect(ws.refusal({ manifest_version: 3, theme: { colors: {} } })).toMatch(/theme/);
    expect(ws.refusal({ manifest_version: 2, app: { launch: {} } })).toMatch(/Chrome app/);
    expect(ws.refusal({ manifest_version: 1 })).toMatch(/manifest version/);
  });
  it('a package without a manifest is not an extension', () => {
    expect(codeOf(() => ws.readPackage(makeZip({ 'a.txt': 'x' }), { AdmZip, validateZip }))).toBe('no-manifest');
    expect(codeOf(() => ws.readPackage(Buffer.from('not a zip'), { AdmZip, validateZip }))).toBe('not-zip');
  });
});

// ---- the download, with the network stubbed -------------------------------------
function stubFetch(answer) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    const a = typeof answer === 'function' ? answer(calls.length) : answer;
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, url: a.url || 'https://clients2.googleusercontent.com/crx/blobs/x.crx', arrayBuffer: async () => (a.body || Buffer.alloc(0)) };
  };
  return { fetch, calls };
}

describe('downloading from Google', () => {
  it('asks with a size limit and a timeout, and returns the bytes', async () => {
    const crx = makeCrx();
    const { fetch, calls } = stubFetch({ status: 200, body: crx });
    const got = await ws.downloadCrx({ fetch, id: DEV_ID, chromeVersion: '148.0.1.2' });
    expect(Buffer.compare(got, crx)).toBe(0);
    expect(calls[0].url).toContain('prodversion=148.0.1.2');
    expect(calls[0].url).toContain('x=id%3D' + DEV_ID);
    expect(calls[0].opts.maxBytes).toBe(100 * 1024 * 1024);
    expect(calls[0].opts.timeoutMs).toBeGreaterThan(0);
  });
  it('says plainly why it failed', async () => {
    const run = (answer) => ws.downloadCrx({ fetch: stubFetch(answer).fetch, id: DEV_ID, chromeVersion: '148.0' }).then(() => 'ok', e => e.code);
    expect(await run({ status: 404 })).toBe('not-found');
    expect(await run({ status: 204 })).toBe('not-found');
    expect(await run({ status: 200, body: Buffer.alloc(0) })).toBe('not-found');
    expect(await run({ status: 503 })).toBe('download');
    expect(await run(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('network');
    expect(await run(new Error('Request timed out'))).toBe('network');
    expect(await run(new Error('Response too large'))).toBe('too-large');
    expect(await run({ status: 200, body: makeCrx(), url: 'http://clients2.googleusercontent.com/x.crx' })).toBe('insecure');
  });
});

describe('preview, then install', () => {
  const make = (answer, extra = {}) => {
    const stub = stubFetch(answer);
    const installer = ws.createWebStoreInstaller({ fetch: stub.fetch, chromeVersion: '148.0', AdmZip, validateZip, publisherKeySha256: STORE_HASH, ...extra });
    return { installer, calls: stub.calls };
  };
  it('downloads once: the verified package shown is the one installed', async () => {
    const { installer, calls } = make({ status: 200, body: makeCrx() });
    const p = await installer.preview(`https://chromewebstore.google.com/detail/test-helper/${DEV_ID}`);
    expect(p).toMatchObject({ id: DEV_ID, name: 'Test Helper', version: '1.2.3', refuse: null });
    const pkg = await installer.take(DEV_ID);
    expect(calls).toHaveLength(1);
    expect(Buffer.compare(pkg.archive, ZIP)).toBe(0);
    expect(idOf(pkg.publicKey)).toBe(DEV_ID);
    // Taken once; a second install downloads again.
    await installer.take(DEV_ID);
    expect(calls).toHaveLength(2);
  });
  it('downloads again once the preview is old', async () => {
    let t = 0;
    const { installer, calls } = make({ status: 200, body: makeCrx() }, { now: () => t, ttlMs: 1000 });
    await installer.preview(DEV_ID);
    t = 5000;
    await installer.take(DEV_ID);
    expect(calls).toHaveLength(2);
  });
  it('a tampered download is refused and nothing is kept', async () => {
    const bad = Buffer.from(makeCrx());
    bad[bad.length - 10] ^= 0xff;
    const { installer, calls } = make((n) => ({ status: 200, body: n === 1 ? bad : makeCrx() }));
    await expect(installer.preview(DEV_ID)).rejects.toMatchObject({ code: 'bad-signature' });
    await expect(installer.take(DEV_ID)).resolves.toMatchObject({ id: DEV_ID });
    expect(calls).toHaveLength(2);
  });
  it('a link that is not the store never reaches the network', async () => {
    const { installer, calls } = make({ status: 200, body: makeCrx() });
    await expect(installer.preview('https://example.com/')).rejects.toMatchObject({ code: 'bad-input' });
    expect(calls).toHaveLength(0);
  });
  it('a theme is described, but not installed', async () => {
    const themeZip = makeZip({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Blue', version: '1', theme: { colors: {} } }) });
    const { installer } = make({ status: 200, body: makeCrx({ archive: themeZip }) });
    expect((await installer.preview(DEV_ID)).refuse).toMatch(/theme/);
    await expect(installer.take(DEV_ID)).rejects.toMatchObject({ code: 'incompatible' });
  });
  it('an extension removed from the store says so', async () => {
    const { installer } = make({ status: 404 });
    await expect(installer.preview(DEV_ID)).rejects.toThrow(/removed from the store/);
  });
});

describe('where an installed extension came from', () => {
  it('is kept per folder, and anything malformed in the file is dropped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-ext-sources-'));
    try {
      expect(extHelpers.readSources(dir)).toEqual({});
      extHelpers.writeSources(dir, { 'dark-reader-1': { webstore: DEV_ID }, junk: { webstore: 'nope' }, other: 7 });
      expect(extHelpers.readSources(dir)).toEqual({ 'dark-reader-1': { webstore: DEV_ID } });
      fs.writeFileSync(path.join(dir, extHelpers.SOURCES_FILE), '[]');
      expect(() => extHelpers.readSources(dir)).toThrow(/corrupt/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the IPC channels', () => {
  const { validate } = require('../../src/main/ipc-schemas.js');
  const { installIpcPolicy } = require('../../src/main/ipc-policy.js');
  it('take one string, a link or an id', () => {
    for (const ch of ['extensions:webstore-preview', 'extensions:install-webstore']) {
      expect(() => validate(ch, [`https://chromewebstore.google.com/detail/x/${DEV_ID}`])).not.toThrow();
      expect(() => validate(ch, [])).toThrow();
      expect(() => validate(ch, [42])).toThrow();
      expect(() => validate(ch, ['x'.repeat(5000)])).toThrow();
      expect(() => validate(ch, [DEV_ID, 'extra'])).toThrow();
    }
    const preload = fs.readFileSync('src/preload.js', 'utf8');
    expect(preload).toMatch(/extensionsWebStorePreview: \(input\) => ipcRenderer\.invoke\('extensions:webstore-preview', input\)/);
    expect(preload).toMatch(/extensionsInstallWebStore: \(input\) => ipcRenderer\.invoke\('extensions:install-webstore', input\)/);
  });
  it('are the main window\'s only: refused in a private window and from a web page', async () => {
    const run = async ({ ui, owner }) => {
      const handlers = new Map();
      const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
      installIpcPolicy(ipcMain, { isUiFrame: () => ui, owner: () => owner, isAuxiliary: () => false, ownsTarget: () => true });
      let reached = 0;
      ipcMain.handle('extensions:install-webstore', () => { reached++; return { ok: true }; });
      const out = await handlers.get('extensions:install-webstore')({ sender: {}, senderFrame: { url: 'file:///C:/vex/src/renderer/index.html' } }, DEV_ID).then(r => r, e => e.message);
      return { out, reached };
    };
    expect(await run({ ui: true, owner: { data: {}, persist: {} } })).toEqual({ out: { ok: true }, reached: 1 });
    expect(await run({ ui: true, owner: { privatePartition: 'private-1', data: {}, persist: {} } })).toEqual({ out: 'This operation is unavailable in a private window', reached: 0 });
    expect(await run({ ui: false, owner: null })).toEqual({ out: 'Untrusted IPC sender', reached: 0 });
  });
});
