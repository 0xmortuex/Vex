#!/usr/bin/env node
// Start the app that is about to be uploaded, before it is uploaded.
//
// `npm run publish` built an installer and shipped it to everyone without ever
// running it. The unit tests cover the source, and the smoke test covers the
// source under Electron — neither touches the PACKAGED app, where the failures
// are of a different kind: a file left out of build.files, a runtime require()
// that is not a declared dependency ("module missing", which has happened
// here), an asar path that only breaks once packed. Fourteen versions went out
// in three days; one of them crashing on launch would have reached every
// installed copy with nothing in the way.
//
// So: build, boot the built app, and only then upload. The boot is the real
// smoke test (scripts/verify-smoke-boot.js) pointed at dist's Vex.exe with
// VEX_SMOKE_EXECUTABLE — it waits for main.js to assert the interface really
// started in Chromium (a tab, a <webview>, the managers defined).
//
// Exits non-zero if anything is missing or the app does not come up, which
// stops the publish.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// What must exist in dist/ before anything is uploaded: the app itself, the
// installer, its block map (differential updates) and latest.yml (how an
// installed copy learns there is a new version at all — v2.31.81 shipped
// without it and no one could update).
const REQUIRED = ['win-unpacked/Vex.exe', 'Vex-Setup.exe', 'Vex-Setup.exe.blockmap', 'latest.yml'];

function check() {
  const missing = REQUIRED.filter(rel => !fs.existsSync(path.join(dist, rel)));
  if (missing.length) throw new Error('the build is incomplete — missing from dist/: ' + missing.join(', '));

  const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
  const m = yml.match(/^version:\s*(.+)$/m);
  const built = m && m[1].trim();
  if (built !== pkg.version) throw new Error(`dist/ holds version ${built || '?'}, but package.json says ${pkg.version} — a stale build`);

  const exe = path.join(dist, 'win-unpacked', 'Vex.exe');
  console.log(`verify-packaged-boot: starting the built Vex ${pkg.version} …`);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'verify-smoke-boot.js')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, VEX_SMOKE_EXECUTABLE: exe, VEX_NO_OS_SCHEDULE: '1' },
  });
  if (r.status !== 0) throw new Error('the built Vex did not start — NOT uploading it. See the output above.');
  console.log(`verify-packaged-boot: v${pkg.version} starts and renders. Uploading.`);
}

if (require.main === module) {
  try { check(); } catch (err) { console.error('verify-packaged-boot: ' + ((err && err.message) || err)); process.exit(1); }
}

module.exports = { REQUIRED };
