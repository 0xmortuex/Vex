// === Starting Ollama for the user ==========================================
//
// Local AI in Vex is Ollama's server on 127.0.0.1:11434. After a reboot that
// server is simply not running, so the first AI request of the day failed —
// "Cloud AI is not configured" when no AI Worker is set, since local was the
// only backend — until the user went and opened Ollama by hand. Vex now starts
// it: `ollama serve`, no window, left running afterwards exactly as Ollama's
// own tray app leaves it (a loaded model unloads itself after five idle
// minutes; the idle server is a few tens of MB).
//
// The renderer only says "make sure it is up" — it passes no path and no
// arguments. The executable is looked for in the places Ollama installs to.
// Everything is injected so this can be tested without starting anything.
const path = require('path');

const PORT = 11434;

function candidates({ platform, env }) {
  const out = [];
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) out.push(path.win32.join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
    if (env.ProgramFiles) out.push(path.win32.join(env.ProgramFiles, 'Ollama', 'ollama.exe'));
    for (const dir of String(env.PATH || env.Path || '').split(';')) if (dir.trim()) out.push(path.win32.join(dir.trim(), 'ollama.exe'));
  } else {
    if (platform === 'darwin') out.push('/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama');
    out.push('/usr/local/bin/ollama', '/usr/bin/ollama');
    for (const dir of String(env.PATH || '').split(':')) if (dir.trim()) out.push(path.posix.join(dir.trim(), 'ollama'));
  }
  return [...new Set(out)];
}

function createOllamaLauncher({ platform, env, exists, spawn, probe, sleep, log, waitMs = 20000 }) {
  const note = typeof log === 'function' ? log : () => {};
  let inFlight = null;

  async function start() {
    if (await probe()) return { running: true, started: false };
    const exe = candidates({ platform, env }).find(p => { try { return exists(p); } catch { return false; } });
    if (!exe) return { running: false, started: false, error: 'Ollama is not installed — Settings › AI has the install guide' };

    let failed = null;
    const child = spawn(exe, ['serve'], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.on('error', (err) => { failed = err; });
    // Exiting at once usually means another copy won the race for the port —
    // the probe below settles which.
    child.on('exit', (code) => { if (code) failed = failed || new Error('ollama serve exited with code ' + code); });
    if (typeof child.unref === 'function') child.unref();
    note('[Ollama] starting ' + exe);

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(400);
      if (await probe()) { note('[Ollama] is up'); return { running: true, started: true }; }
      if (failed && failed.code === 'ENOENT') break;
    }
    return { running: false, started: false, error: 'Ollama did not start: ' + ((failed && failed.message) || 'no answer on port ' + PORT + ' after ' + Math.round(waitMs / 1000) + ' s') };
  }

  return {
    // Two callers at once share one attempt.
    ensure() {
      if (!inFlight) inFlight = start().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

// Is anything answering as Ollama on the local port?
function httpProbe(http) {
  return () => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/version', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

module.exports = { createOllamaLauncher, candidates, httpProbe, PORT };
