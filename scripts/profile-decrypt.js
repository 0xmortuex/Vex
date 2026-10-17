#!/usr/bin/env node
// Gets an encrypted Vex profile (T3-123) back to plain files WITHOUT Vex: the way out that does not
// depend on the interface working. Close Vex first.
//
//   set VEX_PROFILE_PASSPHRASE=<your passphrase>     (or VEX_PROFILE_RECOVERY=<your recovery code>)
//   node scripts/profile-decrypt.js --profile "<profile folder>" [--status]
//
// The profile folder is the one with profile-lock.json in it (normally %APPDATA%\vex). Every file is decrypted
// to a temp file, compared, and only then swapped in; an encrypted copy is kept until all are done; any failure
// puts the encrypted files back. The secret is read from the environment so it is not left in the shell history.
const fs = require('fs');
const path = require('path');
const { createProfileCrypt } = require('../src/main/profile-crypt');
const { STORAGE_KEYS, validate } = require('../src/main/profile-lock-ipc');

async function main(argv, env) {
  const at = argv.indexOf('--profile');
  if (at < 0 || !argv[at + 1]) throw new Error('Usage: node scripts/profile-decrypt.js --profile "<profile folder>" [--status]');
  const userDataPath = path.resolve(argv[at + 1]);
  if (!fs.statSync(userDataPath).isDirectory()) throw new Error(userDataPath + ' is not a folder');
  const engine = createProfileCrypt({ userDataPath });
  const status = engine.status();
  if (argv.includes('--status')) return JSON.stringify(status);
  if (!status.enabled) return 'This profile is not encrypted. Nothing to do.';
  if (status.state === 'migrating') {
    engine.recover();
    return 'An encryption that never finished was undone: the profile is plain text again.';
  }
  const passphrase = env.VEX_PROFILE_PASSPHRASE, recoveryCode = env.VEX_PROFILE_RECOVERY;
  if (!passphrase && !recoveryCode) throw new Error('Set VEX_PROFILE_PASSPHRASE (or VEX_PROFILE_RECOVERY) first');
  const r = await engine.disable({ passphrase, recoveryCode: passphrase ? undefined : recoveryCode, files: engine.profileFiles(STORAGE_KEYS), validate });
  return 'Decrypted ' + r.files.length + ' file(s). The profile is plain text again; you can start Vex.';
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).then((m) => { console.log(m); }, (e) => { console.error('profile-decrypt: ' + e.message); process.exitCode = 1; });
}
module.exports = { main };
