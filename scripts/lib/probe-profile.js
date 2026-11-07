// Marks a THROWAWAY profile as the test harness's own, so a packaged Vex will
// accept a debugging port on it (src/main/debug-guard.js refuses one on any
// other profile). Every script that starts Vex with --remote-debugging-port
// calls prepare(profileDir) and passes the returned env to the child:
//
//   const { env } = require('./lib/probe-profile').prepare(profile);
//   spawn(exe, [..., '--user-data-dir=' + profile, '--remote-debugging-port=' + port], { env: { ...process.env, ...env } });
//
// prepare() throws for a folder that is not under the OS temp directory or is a
// real Vex profile, so a probe can never be pointed at the person's data.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MARKER = '.vex-probe-profile';       // keep in step with src/main/debug-guard.js
const NONCE_ENV = 'VEX_PROBE_NONCE';

function prepare(profileDir) {
  const dir = require('./probe-harness').assertTempProfile(profileDir);   // lazy: probe-harness requires this file
  fs.mkdirSync(dir, { recursive: true });
  const nonce = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ v: 1, nonce, createdAt: new Date().toISOString() }));
  return { dir, nonce, env: { [NONCE_ENV]: nonce } };
}

module.exports = { prepare, MARKER, NONCE_ENV };
