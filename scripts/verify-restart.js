const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function launch(profile, phase) {
  const executable = process.env.VEX_SMOKE_EXECUTABLE || require('electron');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...(process.env.VEX_SMOKE_EXECUTABLE ? [] : ['.']), '--user-data-dir=' + profile], {
      cwd: path.resolve(__dirname, '..'), windowsHide: true,
      // VEX_NO_OS_SCHEDULE: the fresh profile's weekly-review reminder used to
      // register a real Windows task, pointing at this temp profile, on every
      // run (one was left behind by each release gate).
      env: { ...process.env, VEX_SMOKE: '1', VEX_RESTART_PHASE: phase, VEX_SKIP_VMP_VERIFY: '1', VEX_NO_OS_SCHEDULE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
    const collect = chunk => { output = (output + chunk).slice(-100000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (!timedOut && code === 0 && /SMOKE: PASS/.test(output)) resolve();
      else reject(new Error(phase + ' failed: ' + output.slice(-3000)));
    });
  });
}
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-restart-'));
  try {
    await launch(profile, 'seed');
    await launch(profile, 'verify');
    console.log('PASS: two-process restart preserved tab identity/pin and preference deletion');
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
