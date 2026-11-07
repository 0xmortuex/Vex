// @vitest-environment node
//
// The signed update feed (src/main/update-signature.js + src/main/updates.js).
// Every key here is generated at test time and thrown away; no real key exists in the repo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const sig = require('../../src/main/update-signature.js');
const { createUpdater } = require('../../src/main/updates.js');

const newKey = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: sig.publicKeyToB64(publicKey), sign: buf => crypto.sign(null, buf, privateKey).toString('base64') };
};
const INSTALLER = Buffer.alloc(64 * 1024, 3);
const sha = b => crypto.createHash('sha512').update(b).digest('base64');
const ymlText = (version = '2.35.0') => `version: ${version}
files:
  - url: Vex-Setup.exe
    sha512: ${sha(INSTALLER)}
    size: ${INSTALLER.length}
path: Vex-Setup.exe
sha512: ${sha(INSTALLER)}
releaseDate: '2026-10-02T10:00:00.000Z'
`;
const GH = 'https://github.com/0xmortuex/Vex/releases/latest/download/';

describe('verifyFeed', () => {
  const k = newKey(), other = newKey();
  const feed = Buffer.from(ymlText());
  it('accepts a valid signature and says which key matched', () => {
    expect(sig.verifyFeed(feed, k.sign(feed), [k.pub])).toBe(sig.keyId(k.pub));
    expect(sig.verifyFeed(feed, '  ' + k.sign(feed) + '\r\n', [k.pub])).toBe(sig.keyId(k.pub));
  });
  it('refuses a tampered feed (one byte)', () => {
    const s = k.sign(feed);
    const bad = Buffer.from(feed); bad[10] ^= 1;
    expect(() => sig.verifyFeed(bad, s, [k.pub])).toThrow(expect.objectContaining({ code: 'invalid' }));
  });
  it('refuses a missing signature, a wrong key, and malformed signatures', () => {
    expect(() => sig.verifyFeed(feed, null, [k.pub])).toThrow(expect.objectContaining({ code: 'missing' }));
    expect(() => sig.verifyFeed(feed, other.sign(feed), [k.pub])).toThrow(expect.objectContaining({ code: 'invalid' }));
    for (const junk of ['', 'abc', '!'.repeat(88), k.sign(feed).slice(0, 80), 'x'.repeat(5000), k.sign(feed) + 'AA']) {
      expect(() => sig.verifyFeed(feed, junk, [k.pub]), junk.slice(0, 10)).toThrow(sig.SignatureError);
    }
    // An all-zero signature of the right shape is simply invalid.
    expect(() => sig.verifyFeed(feed, Buffer.alloc(64).toString('base64'), [k.pub])).toThrow(expect.objectContaining({ code: 'invalid' }));
  });
  it('accepts either key of a rotation pair, and refuses once the old one is removed', () => {
    const oldK = newKey(), newK = newKey();
    expect(sig.verifyFeed(feed, oldK.sign(feed), [oldK.pub, newK.pub])).toBe(sig.keyId(oldK.pub));
    expect(sig.verifyFeed(feed, newK.sign(feed), [oldK.pub, newK.pub])).toBe(sig.keyId(newK.pub));
    expect(() => sig.verifyFeed(feed, oldK.sign(feed), [newK.pub])).toThrow(expect.objectContaining({ code: 'invalid' }));
  });
  it('refuses an oversized feed without hashing it, and never verifies against no keys', () => {
    const big = Buffer.alloc(sig.MAX_FEED_BYTES + 1, 1);
    expect(() => sig.verifyFeed(big, k.sign(big), [k.pub])).toThrow(expect.objectContaining({ code: 'too-large' }));
    expect(() => sig.verifyFeed(feed, k.sign(feed), [])).toThrow(expect.objectContaining({ code: 'no-keys' }));
  });
  it('rejects a malformed key list instead of treating it as empty', () => {
    expect(sig.keysFrom({ keys: [] })).toEqual([]);
    expect(() => sig.keysFrom({})).toThrow(/keys/);
    expect(() => sig.keysFrom({ keys: ['short'] })).toThrow(sig.SignatureError);
    expect(() => sig.keysFrom({ keys: [k.pub, k.pub] })).toThrow(/twice/);
    expect(() => sig.keysFrom({ keys: [1, 2, 3, 4, 5].map(() => newKey().pub) })).toThrow(/more than/);
  });
  it('ships with no key embedded', () => {
    expect(sig.keysFrom(JSON.parse(fs.readFileSync(path.join(__dirname, '../../src/main/update-pubkeys.json'), 'utf8')))).toEqual([]);
  });
});

describe('the updater with a signed feed', () => {
  let dir, routes, log;
  const requested = [];
  const respond = (body, status = 200) => new Response(body, { status });
  const make = (over = {}) => createUpdater({
    fetch: async url => { requested.push(url); return routes.has(url) ? routes.get(url)() : respond('nope', 404); },
    fs, dir, currentVersion: '2.34.5', env: {}, spawn: vi.fn(), log, platform: 'win32', ...over,
  });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sigtest-'));
    routes = new Map();
    requested.length = 0;
    log = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const serve = (text, sigBody) => {
    routes.set(GH + 'latest.yml', () => respond(text));
    if (sigBody !== undefined) routes.set(GH + 'latest.yml.sig', () => respond(sigBody));
  };

  it('with NO key embedded, behaves as before: no signature is even requested', async () => {
    serve(ymlText());
    const r = await make({ pubKeys: [] }).check();
    expect(r).toMatchObject({ ok: true, hasUpdate: true, signature: 'off' });
    expect(requested.some(u => u.endsWith('.sig'))).toBe(false);
  });
  it('ships with the real embedded list empty, so a plain updater is unchanged', async () => {
    serve(ymlText());
    expect(await make().check()).toMatchObject({ ok: true, signature: 'off' });
  });
  it('accepts a feed with a valid signature', async () => {
    const k = newKey(); const text = ymlText();
    serve(text, k.sign(Buffer.from(text)));
    expect(await make({ pubKeys: [k.pub] }).check()).toMatchObject({ ok: true, hasUpdate: true, latest: '2.35.0', signature: 'verified' });
  });
  it('refuses a tampered feed (installer hash swapped after signing)', async () => {
    const k = newKey(); const good = ymlText();
    serve(good.replaceAll(sha(INSTALLER), sha(Buffer.from('evil'))), k.sign(Buffer.from(good)));
    const r = await make({ pubKeys: [k.pub] }).check();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/signature check/);
  });
  it('refuses a release with no signature file when a key is embedded', async () => {
    const k = newKey();
    serve(ymlText());
    const r = await make({ pubKeys: [k.pub] }).check();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not signed/);
  });
  it('refuses a feed signed with another key, and a malformed signature file', async () => {
    const k = newKey(), evil = newKey(); const text = ymlText();
    serve(text, evil.sign(Buffer.from(text)));
    expect((await make({ pubKeys: [k.pub] }).check()).ok).toBe(false);
    serve(text, 'not a signature');
    expect((await make({ pubKeys: [k.pub] }).check()).error).toMatch(/malformed/);
  });
  it('accepts the second key of a rotation pair', async () => {
    const a = newKey(), b = newKey(); const text = ymlText();
    serve(text, b.sign(Buffer.from(text)));
    expect((await make({ pubKeys: [a.pub, b.pub] }).check()).signature).toBe('verified');
  });
  it('treats a validly signed OLDER feed as no update and flags the downgrade; download is refused', async () => {
    const k = newKey(); const text = ymlText('2.30.0');
    serve(text, k.sign(Buffer.from(text)));
    const u = make({ pubKeys: [k.pub] });
    expect(await u.check()).toMatchObject({ ok: true, hasUpdate: false, downgrade: true, latest: '2.30.0' });
    await expect(u.download('2.30.0')).rejects.toMatchObject({ code: 'stale' });
  });
  it('fails closed when the key list itself is broken', async () => {
    serve(ymlText());
    const r = await make({ pubKeys: ['broken'] }).check();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/update keys/);
  });
  it('rejects a huge signature body instead of reading it', async () => {
    const k = newKey();
    serve(ymlText(), 'A'.repeat(100000));
    expect((await make({ pubKeys: [k.pub] }).check()).ok).toBe(false);
  });
});
