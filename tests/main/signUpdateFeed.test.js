// @vitest-environment node
//
// The release-side tools of the signed update feed: scripts/gen-update-key.js,
// scripts/sign-update-feed.js and the upload order. Keys are generated into a
// temp folder here and deleted; nothing touches dist/ or the network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const gen = require('../../scripts/gen-update-key.js');
const signer = require('../../scripts/sign-update-feed.js');
const upload = require('../../scripts/upload-release.js');
const post = require('../../scripts/post-publish.js');
const sig = require('../../src/main/update-signature.js');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-signtool-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('gen-update-key', () => {
  it('writes a key pair outside the repo and never overwrites', () => {
    const r = gen.generate(path.join(tmp, 'keys'));
    expect(fs.readFileSync(r.privateFile, 'utf8')).toMatch(/BEGIN PRIVATE KEY/);
    expect(fs.readFileSync(r.publicFile, 'utf8').trim()).toBe(r.publicKey);
    expect(sig.keysFrom({ keys: [r.publicKey] })).toEqual([r.publicKey]);
    expect(() => gen.generate(path.join(tmp, 'keys'))).toThrow(/already exists/);
  });
  it('refuses a folder inside the repository (so the private key cannot be committed)', () => {
    expect(gen.insideRepo(path.join(__dirname, '..', '..', 'keys'))).toBe(true);
    expect(() => gen.generate(path.join(__dirname, '..', '..', 'some-key-folder'))).toThrow(/inside the Vex repository/);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'some-key-folder'))).toBe(false);
    expect(() => gen.generate('')).toThrow(/give the folder/);
  });
});

describe('sign-update-feed', () => {
  it('no key and no embedded public key: skip with a loud warning, never fail', () => {
    const p = signer.plan({ keyPath: '', keys: [] });
    expect(p.action).toBe('skip');
    expect(p.warning).toMatch(/NOT SIGNED/);
  });
  it('no key but an embedded public key: refuses (an unsigned release would block every update)', () => {
    expect(() => signer.plan({ keyPath: '', keys: ['x'] })).toThrow(/Not releasing an unsigned feed/);
  });
  it('signs latest.yml so that the app-side check accepts it, and rejects a non-matching key', () => {
    const r = gen.generate(path.join(tmp, 'k'));
    const feed = path.join(tmp, 'latest.yml');
    fs.writeFileSync(feed, 'version: 9.9.9\n');
    const out = signer.signFeed({ feedFile: feed, keyPath: r.privateFile, keys: [r.publicKey] });
    expect(out.embedded).toBe(true);
    expect(sig.verifyFeed(fs.readFileSync(feed), fs.readFileSync(out.out, 'utf8'), [r.publicKey])).toBe(r.id);
    // Altering the feed afterwards invalidates it.
    fs.appendFileSync(feed, 'x');
    expect(() => sig.verifyFeed(fs.readFileSync(feed), fs.readFileSync(out.out, 'utf8'), [r.publicKey])).toThrow(/does not match/);
    // A key that is not the embedded one would produce a release nobody accepts.
    const other = gen.generate(path.join(tmp, 'k2'));
    expect(() => signer.signFeed({ feedFile: feed, keyPath: r.privateFile, keys: [other.publicKey] })).toThrow(/does not match any public key/);
  });
  it('the repo ships with no embedded key, so "npm run publish" still works without one', () => {
    expect(signer.embeddedKeys()).toEqual([]);
  });
});

describe('release wiring', () => {
  it('uploads latest.yml.sig before latest.yml, only when it exists', () => {
    expect(upload.assetsFor(tmp)).toEqual(['Vex-Setup.exe', 'Vex-Setup.exe.blockmap', 'latest.yml']);
    fs.writeFileSync(path.join(tmp, 'latest.yml.sig'), 'x');
    expect(upload.assetsFor(tmp)).toEqual(['Vex-Setup.exe', 'Vex-Setup.exe.blockmap', 'latest.yml.sig', 'latest.yml']);
  });
  it('npm run publish signs after the build checks and before the release is created', () => {
    const publish = require('../../package.json').scripts.publish;
    const steps = publish.split('&&').map(s => s.trim());
    const at = name => steps.findIndex(s => s.includes(name));
    expect(at('sign-update-feed')).toBeGreaterThan(at('verify-signing'));
    expect(at('sign-update-feed')).toBeLessThan(at('ensure-release'));
  });
  it('post-publish wants the signature asset only when the app embeds a key', () => {
    const base = { tagName: 'v1.0.0', isDraft: false, assets: ['latest.yml', 'Vex-Setup.exe', 'Vex-Setup.exe.blockmap'].map(name => ({ name, size: 5 })) };
    expect(post.problems(base, 'v1.0.0')).toEqual([]);
    expect(post.problems(base, 'v1.0.0', { requireSig: true })).toEqual(['latest.yml.sig is missing']);
  });
});
