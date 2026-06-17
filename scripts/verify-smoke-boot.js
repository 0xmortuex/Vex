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

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const electronPath = require('electron'); // string path when required from Node
const projectRoot = path.resolve(__dirname, '..');
const userDataDir = path.join(os.tmpdir(), 'vex-smoke-' + process.pid + '-' + Date.now());

let settled = false;
const child = spawn(electronPath, ['.', `--user-data-dir=${userDataDir}`], {
  cwd: projectRoot,
  env: { ...process.env, VEX_SMOKE: '1', VEX_SKIP_VMP_VERIFY: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let buf = '';
const onData = (d) => {
  const s = d.toString();
  buf += s;
  const m = s.match(/SMOKE:\s+(PASS|FAIL)([^\n]*)/);
  if (m) finish(m[1] === 'PASS', (m[2] || '').trim());
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);

const timer = setTimeout(() => finish(false, 'harness timeout (no SMOKE line in 60s)'), 60000);

function cleanup() {
  try { child.kill('SIGKILL'); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
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
  cleanup();
  process.exit(ok ? 0 : 1);
}

child.on('exit', (code) => {
  // App exited before printing a SMOKE line → treat as failure.
  if (!settled) finish(false, `electron exited (code ${code}) without a SMOKE result`);
});
child.on('error', (err) => finish(false, 'spawn error: ' + err.message));
