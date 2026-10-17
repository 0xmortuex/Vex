// Real-Electron boot smoke test. Launches the ACTUAL Vex app (main.js) with
// VEX_SMOKE=1 and a throwaway user-data-dir (so it never collides with a running
// Vex's single-instance lock or touches your profile). main.js boots, asserts
// the renderer initialized in real Chromium — tab system created a tab + a
// <webview> rendered, core managers defined — and prints "SMOKE: PASS|FAIL",
// which we relay as exit 0/1.
//
// This is the vertical slice the jsdom unit tests can't cover: it would catch a
// syntax error in any renderer script, a failed init, or a boot-time main crash.
//
// Run:  node scripts/verify-smoke-boot.js   (or: npm run smoke)

const path = require('path');
const fs = require('fs');

const harness = require('./lib/probe-harness');
const projectRoot = path.resolve(__dirname, '..');

let settled = false;
// The harness starts only this app, with a temp profile and VEX_NO_OS_SCHEDULE=1,
// and stops only this PID (and its verified descendants).
const probe = harness.launch({
  exe: process.env.VEX_SMOKE_EXECUTABLE || undefined,
  args: process.env.VEX_SMOKE_EXECUTABLE ? [] : ['.'],
  cwd: projectRoot,
  env: { VEX_SMOKE: '1', VEX_SKIP_VMP_VERIFY: '1' },
});
const child = probe.child;
const userDataDir = probe.userDataDir;

let buf = '';
const onData = (d) => {
  const s = d.toString();
  buf += s;
  const m = buf.match(/SMOKE:\s+(PASS|FAIL)([^\n]*)\n/);
  if (m) {
    let ok = m[1] === 'PASS', detail = (m[2] || '').trim();
    // The boot marks and the DOM size of this start, held against scripts/startup-budget.json (T3-066).
    const b = buf.match(/SMOKE:\s+BOOT\s+(\{[^\r\n]*\})\r?\n/);
    if (ok && b) {
      const errors = require('./startup-budget.js').checkBoot(JSON.parse(b[1]));
      if (errors.length) { ok = false; detail = errors.join('; '); }
      else detail += ' boot=' + JSON.stringify(JSON.parse(b[1]).marks) + ' nodes=' + JSON.parse(b[1]).nodes;
    }
    finish(ok, detail);
  }
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);

// The DRM check waits for the Widevine component to download on a fresh profile.
const harnessMs = process.env.VEX_DRM_SMOKE === '1' ? 240000 : 60000;
const timer = setTimeout(() => finish(false, `harness timeout (no SMOKE line in ${harnessMs / 1000}s)`), harnessMs);

// Kill the app, wait for it to really be gone, then drop its profile.
// Removing it the instant after the kill lost the race with Vex's exiting
// child processes every time (EPERM), and left the folder in Temp for good —
// 85 of them had piled up.
async function cleanup() {
  const dead = new Promise(r => { if (child.exitCode !== null || child.signalCode) return r(); child.once('exit', r); setTimeout(r, 4000); });
  try { harness.stopOwned(probe); } catch (err) { console.warn('smoke: ' + err.message); }
  await dead;
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return; }
    catch (err) { if (i === 11) { console.warn('could not remove ' + userDataDir + ': ' + err.message); return; } await new Promise(r => setTimeout(r, 500)); }
  }
}

function finish(ok, detail) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  console.log(`\nRESULT: ${ok ? 'PASS' : 'FAIL'} — ${detail || ''}`);
  if (!ok) {
    const tail = buf.split('\n').slice(-25).join('\n');
    console.log('--- last output ---\n' + tail);
  }
  cleanup().then(() => process.exit(ok ? 0 : 1));
}

child.on('exit', (code) => {
  // App exited before printing a SMOKE line → treat as failure.
  if (!settled) finish(false, `electron exited (code ${code}) without a SMOKE result`);
});
child.on('error', (err) => finish(false, 'spawn error: ' + err.message));
