#!/usr/bin/env node
// Sign the built update feed: dist/latest.yml -> dist/latest.yml.sig.
//
//   node scripts/sign-update-feed.js [--feed dist/latest.yml] [--key <private.pem>]
//
// The private key path comes from --key or the environment variable
// VEX_UPDATE_SIGN_KEY (made by scripts/gen-update-key.js, kept offline). It is
// read, used and never printed or copied.
//
// OPT-IN, and safe on a machine with no key:
//   - no key given, and no public key embedded in src/main/update-pubkeys.json:
//       a LOUD warning, exit 0. The release goes out as before (unsigned feed).
//   - no key given, but a public key IS embedded: exit 1. Installed copies would
//       refuse an unsigned release, so shipping it would block every update.
//   - key given: the feed is signed, the signature is checked against the key
//       list embedded in this checkout (the key must be one of them, otherwise
//       installed copies would refuse it), and written next to latest.yml.
//
// Runs in "npm run publish" after the build and before the upload. Nothing here
// uploads anything; upload-release.js sends latest.yml.sig BEFORE latest.yml.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sig = require('../src/main/update-signature');

const root = path.join(__dirname, '..');
const KEY_FILE = path.join(root, 'src', 'main', 'update-pubkeys.json');

function embeddedKeys(file = KEY_FILE) {
  return sig.keysFrom(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// Decides what to do; returns { action: 'skip'|'sign', warning? } or throws.
function plan({ keyPath, keys }) {
  if (!keyPath) {
    if (keys.length) throw new Error('src/main/update-pubkeys.json holds a public key, so installed copies only accept a SIGNED feed, but no private key was given. Set VEX_UPDATE_SIGN_KEY (or pass --key) to the private key file. Not releasing an unsigned feed.');
    return { action: 'skip', warning: 'THE UPDATE FEED IS NOT SIGNED. No VEX_UPDATE_SIGN_KEY is set and no public key is embedded, so this release carries no independent signature (a stolen GitHub token could swap the installer). See RELEASING.md "Sign the update feed".' };
  }
  return { action: 'sign' };
}

function signFeed({ feedFile, keyPath, keys }) {
  const feed = fs.readFileSync(feedFile);
  if (feed.length > sig.MAX_FEED_BYTES) throw new Error(path.basename(feedFile) + ' is larger than the updater will read; not signing it.');
  const pem = fs.readFileSync(keyPath, 'utf8');
  const priv = crypto.createPrivateKey(pem);
  if (priv.asymmetricKeyType !== 'ed25519') throw new Error('the signing key is not an Ed25519 key');
  const pub = sig.publicKeyToB64(crypto.createPublicKey(priv));
  if (keys.length && !keys.includes(pub)) throw new Error(`this private key (id ${sig.keyId(pub)}) does not match any public key embedded in src/main/update-pubkeys.json, so installed copies would refuse the release. Use the matching key, or embed this one first.`);
  const signature = crypto.sign(null, feed, priv).toString('base64');
  // Prove it verifies before writing it.
  sig.verifyFeed(feed, signature, [pub]);
  const out = feedFile + '.sig';
  fs.writeFileSync(out, signature + '\n');
  return { out, id: sig.keyId(pub), embedded: keys.includes(pub) };
}

function main(argv = process.argv.slice(2), env = process.env) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const feedFile = path.resolve(root, arg('--feed') || path.join('dist', 'latest.yml'));
  const keyPath = arg('--key') || env.VEX_UPDATE_SIGN_KEY || '';
  const keys = embeddedKeys();
  const p = plan({ keyPath, keys });
  if (!fs.existsSync(feedFile)) throw new Error(feedFile + ' does not exist: build first');
  if (p.action === 'skip') {
    console.warn('\n!!!!!!!! sign-update-feed: ' + p.warning + '\n');
    // A stale signature from an earlier build would not match this feed: never leave one behind.
    if (fs.existsSync(feedFile + '.sig')) fs.rmSync(feedFile + '.sig');
    return;
  }
  const r = signFeed({ feedFile, keyPath, keys });
  console.log(`sign-update-feed: signed ${path.basename(feedFile)} with key ${r.id} -> ${path.basename(r.out)}`);
  if (!r.embedded) console.warn('sign-update-feed: this key is not embedded in the app yet, so installed copies do not check this signature (yet).');
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('sign-update-feed: ' + ((err && err.message) || err)); process.exit(1); }
}

module.exports = { plan, signFeed, embeddedKeys };
