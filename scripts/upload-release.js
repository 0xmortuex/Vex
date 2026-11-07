#!/usr/bin/env node
// Upload the built release to GitHub, after it has been proved to start.
//
// electron-builder used to build AND upload in one step (`--publish always`),
// which left no moment in between to check the thing being shipped — and ran
// two publisher tasks that raced to create the release (the 422 that lost
// v2.31.81 and cost an afternoon of hand-uploading). The publish is now:
//
//   ensure-release  →  build (--publish never)  →  verify-packaged-boot  →  here
//
// so nothing reaches an installed copy that has not started on this machine
// first, and one uploader touches the release.
//
// Needs the gh CLI signed in (or GH_TOKEN, which gh honours).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = 'v' + pkg.version;

// latest.yml LAST: it is what an installed Vex reads to decide there is an
// update, so it must never appear before the files it points at.
const ASSETS = ['Vex-Setup.exe', 'Vex-Setup.exe.blockmap', 'latest.yml'];
// The signature of latest.yml (scripts/sign-update-feed.js), when there is one,
// goes up BEFORE latest.yml for the same reason latest.yml goes last: an
// installed copy that sees the new latest.yml must find its signature.
const SIG = 'latest.yml.sig';
function assetsFor(distDir) {
  const list = [...ASSETS];
  if (fs.existsSync(path.join(distDir, SIG))) list.splice(list.indexOf('latest.yml'), 0, SIG);
  return list;
}

function main() {
  const assets = assetsFor(dist);
  const files = assets.map(name => {
    const p = path.join(dist, name);
    if (!fs.existsSync(p)) throw new Error(name + ' is not in dist/ — run the build first');
    return p;
  });
  for (const file of files) {
    console.log('upload-release: ' + tag + ' ← ' + path.basename(file));
    execFileSync('gh', ['release', 'upload', tag, file, '--clobber'], { cwd: root, stdio: 'inherit' });
  }
  console.log('upload-release: ' + tag + ' uploaded (' + assets.join(', ') + ')');
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('upload-release: ' + ((err && err.message) || err)); process.exit(1); }
}

module.exports = { ASSETS, SIG, assetsFor };
