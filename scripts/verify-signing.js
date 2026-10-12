#!/usr/bin/env node
// After the build, before anything is uploaded: are the files signed the way
// the environment says they should be? (scripts/code-signing.js)
//
//   node scripts/verify-signing.js [--dir <build output>] [--release]
//
// Unsigned build (no certificate configured): prints "unsigned build" and
// passes, exactly as releases went out before signing existed.
//
// Signed build: every .exe in win-unpacked (Vex.exe and the helpers
// electron-builder signs), Vex-Setup.exe, and the Vex.exe packed inside it
// (taken out with electron-builder's own 7-Zip) must be signed, timestamped,
// Valid, and all by the same name (VEX_WIN_PUBLISHER when set); the packed
// Vex.exe and Vex.exe.sig must be byte for byte the win-unpacked ones that
// vmp-sign.js verified. Anything else exits non-zero, which stops
// `npm run publish` before ensure-release / upload-release.
//
// --release refuses VEX_SIGN_ALLOW_UNTRUSTED=1 (self-signed test certificates).
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const codeSigning = require('./code-signing');

const root = path.join(__dirname, '..');

function exesIn(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.exe$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// The app the installer will really put on disk: electron-builder's 7-Zip
// opens Vex-Setup.exe through the app archive packed inside it. (It cannot
// reach the NSIS uninstaller; that one is covered by forceCodeSigning, which
// makes electron-builder throw if it cannot sign it.)
async function extractShipped(installer, names) {
  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
  const sevenZip = await getPath7za();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-verify-signing-'));
  execFileSync(sevenZip, ['e', '-y', `-o${tmp}`, installer, ...names], { stdio: ['ignore', 'pipe', 'pipe'] });
  const files = {};
  for (const name of names) files[name] = path.join(tmp, name);   // a missing one is reported by the caller
  return { files, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const dirArg = argv.indexOf('--dir');
  const out = path.resolve(root, dirArg >= 0 ? argv[dirArg + 1] : 'dist');
  const release = argv.includes('--release');
  const setup = codeSigning.setupFromEnv(env);
  if (setup.mode === 'none') {
    console.log(codeSigning.describe(setup) + ': nothing to verify');
    return true;
  }
  console.log(codeSigning.describe(setup));
  if (release && setup.allowUntrusted) throw new Error('VEX_SIGN_ALLOW_UNTRUSTED=1 is for test builds; a release must be signed by a trusted certificate. Unset it.');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const productName = pkg.build.productName;
  const unpacked = path.join(out, 'win-unpacked');
  if (!fs.existsSync(unpacked)) throw new Error('no win-unpacked folder in ' + out);
  const files = exesIn(unpacked).map(file => ({ name: path.relative(out, file), file }));
  const installer = path.join(out, pkg.build.win.artifactName.replace('${ext}', 'exe'));
  const exeName = `${productName}.exe`;
  let shipped = null;
  if (fs.existsSync(installer)) {
    files.push({ name: path.basename(installer), file: installer });
    shipped = await extractShipped(installer, [exeName, exeName + '.sig']);
    files.push({ name: `${exeName} inside ${path.basename(installer)}`, file: shipped.files[exeName] });
  } else if (release) {
    throw new Error(path.basename(installer) + ' is missing from ' + out);
  }
  try {
    const offline = env.ELECTRON_BUILDER_OFFLINE === 'true';
    const result = await codeSigning.checkSigned(files, setup, codeSigning.signatureReader(), { offline });
    console.log('[Sign] signatures in ' + path.relative(root, out) + ':');
    for (const line of result.lines) console.log(line);
    // What the installer ships must be the very Vex.exe vmp-sign.js checked,
    // with the VMP signature made after its Authenticode signature.
    if (shipped) {
      for (const name of [exeName, exeName + '.sig']) {
        const built = path.join(unpacked, name);
        if (!fs.existsSync(built)) result.problems.push(`win-unpacked has no ${name}`);
        else if (!fs.existsSync(shipped.files[name])) result.problems.push(`${name} is not inside ${path.basename(installer)}`);
        else if (sha256(built) !== sha256(shipped.files[name])) result.problems.push(`${name} inside ${path.basename(installer)} is not the one in win-unpacked`);
      }
    }
    if (result.problems.length) {
      throw new Error('this build is NOT signed as configured, so it must not be published:\n  - ' + result.problems.join('\n  - '));
    }
    console.log(`[Sign] all ${files.length} files are signed by "${result.signers[0]}"` + (offline ? '' : ' and timestamped') +
      (shipped ? `; the installer ships the same ${exeName} and ${exeName}.sig` : ''));
    return true;
  } finally {
    if (shipped) shipped.cleanup();
  }
}

if (require.main === module) {
  main().catch(err => { console.error('verify-signing: ' + ((err && err.message) || err)); process.exit(1); });
}

module.exports = { main, exesIn };
