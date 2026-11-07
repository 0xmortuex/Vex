#!/usr/bin/env node
// Make the Ed25519 key pair that signs Vex's update feed (latest.yml).
//
//   node scripts/gen-update-key.js <folder-you-choose>
//
// Run by the OWNER, once. The folder must be OUTSIDE this repository (a USB
// stick, an encrypted volume, a password manager's attachment...). Nothing here
// uploads or commits anything, and the private key is never printed.
//
// Writes:
//   <folder>/vex-update-private.pem   THE SECRET. Keep it offline. Never commit it.
//   <folder>/vex-update-public.txt    the public key (44 base64 characters). Safe to share.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { publicKeyToB64, keyId } = require('../src/main/update-signature');

const repoRoot = path.resolve(__dirname, '..');

function insideRepo(folder) {
  const rel = path.relative(repoRoot, path.resolve(folder));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Returns { privateFile, publicFile, publicKey, id }. Throws instead of overwriting or writing into the repo.
function generate(folder) {
  if (!folder) throw new Error('give the folder to write the key pair into, e.g. node scripts/gen-update-key.js D:\\vex-keys');
  if (insideRepo(folder)) throw new Error('that folder is inside the Vex repository. Pick a folder outside it so the private key can never be committed.');
  fs.mkdirSync(folder, { recursive: true });
  const privateFile = path.join(folder, 'vex-update-private.pem');
  const publicFile = path.join(folder, 'vex-update-public.txt');
  for (const f of [privateFile, publicFile]) if (fs.existsSync(f)) throw new Error(f + ' already exists. Vex will not overwrite a key; choose another folder.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKeyToB64(publicKey);
  // 'wx': fail rather than replace; 0o600 where the OS honours it.
  fs.writeFileSync(privateFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(publicFile, pub + '\n', { flag: 'wx' });
  return { privateFile, publicFile, publicKey: pub, id: keyId(pub) };
}

function main() {
  const r = generate(process.argv[2]);
  console.log(`
Update signing key created (id ${r.id}).

  PRIVATE key : ${r.privateFile}
  PUBLIC key  : ${r.publicFile}
  Public key text (safe to share):
    ${r.publicKey}

What to do now:
  1. Move the PRIVATE key to offline storage and make a second copy somewhere safe.
     If you lose it you cannot sign updates any more, and installed copies that
     carry only this key will refuse every future update until they are reinstalled.
     NEVER commit it, upload it, e-mail it or paste it anywhere.
  2. Put the PUBLIC key text into src/main/update-pubkeys.json:
        { "keys": [ "${r.publicKey}" ] }
     and ship that in a normal release. IMPORTANT: copies that already have this
     build update to it as before. From that build on, an update is accepted only
     if its latest.yml.sig verifies, so the NEXT release after it must be signed.
  3. To sign a release, set VEX_UPDATE_SIGN_KEY to the private key's path before
     "npm run publish" (PowerShell):
        $env:VEX_UPDATE_SIGN_KEY = "${r.privateFile.replace(/\\/g, '\\\\')}"
     then clear it afterwards.
  4. Rotating later: add the NEW public key next to the old one (up to 4 keys),
     ship, then sign with the new key, then remove the old key in a later release.
See RELEASING.md, "Sign the update feed".`);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('gen-update-key: ' + ((err && err.message) || err)); process.exit(1); }
}

module.exports = { generate, insideRepo };
