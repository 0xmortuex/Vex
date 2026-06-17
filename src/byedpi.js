// === Vex ByeDPI integration — strong, userspace DPI bypass for Discord ===
//
// ByeDPI (ciadpi) is an open-source userspace SOCKS5 proxy that performs the same
// connection-desync tricks as Zapret/GoodbyeDPI (split / disorder / fake-TTL /
// tlsrec / oob) WITHOUT admin rights or WinDivert — so a sandboxed Electron app
// can drive it. We download the official Windows x64 build on demand into
// userData, run it on a local port, and route the Discord session through it.
// Source: https://github.com/hufrea/byedpi (v0.17.3). Flags from its README.
//
// Which desync defeats a given ISP's DPI varies, so main.js AUTO-TUNES across
// these presets (testing whether Discord's TLS handshake actually completes) and
// the user can also force a preset or paste custom flags. ciadpi's stdout/stderr
// is logged to userData/byedpi/ciadpi.log for diagnosis.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const BYEDPI_URL = 'https://github.com/hufrea/byedpi/releases/download/v0.17.3/byedpi-17.3-x86_64-w64.zip';

// Ordered best-first. Index 0 is the combo that worked for the first tester
// (fake low-TTL packet + TLS-record split). Auto-tune walks the list in order.
const PRESETS = [
  ['--fake', '-1', '--ttl', '8', '--tlsrec', '1+s'],                 // 0  fake + tlsrec  (known-good)
  ['--fake', '-1', '--ttl', '6', '--tlsrec', '1+s', '--disorder', '1'], // 1  fake + tlsrec + disorder
  ['--disorder', '1', '--auto=torst', '--fake', '-1', '--ttl', '8'],  // 2  disorder + fake (auto)
  ['--auto=torst', '--tlsrec', '1+s', '--disorder', '1'],            // 3  auto + tlsrec + disorder
  ['--split', '1+s', '--disorder', '3+s'],                           // 4  README "Windows"
  ['--fake', '-1', '--ttl', '10'],                                   // 5  plain fake, higher TTL
  ['--oob', '1', '--tlsrec', '1+s'],                                 // 6  OOB + tlsrec
  ['--disorder', '1+s'],                                             // 7  disorder at SNI
  ['--tlsrec', '1+s', '--split', '2'],                               // 8  tlsrec + split
  ['--fake', '-1', '--ttl', '4', '--tlsrec', '1+s', '--split', '1+s'], // 9  aggressive combo
];

let _proc = null;
let _port = 0;

function _freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.on('error', () => resolve(0));
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Parse a custom flags string into argv (respecting simple double-quotes).
function parseFlags(str) {
  return (String(str || '').match(/[^\s"]+|"[^"]*"/g) || []).map((s) => s.replace(/^"|"$/g, ''));
}

// Wait until ciadpi accepts connections on its port (it's up), or the process
// dies / we time out.
function _waitListening(port, deadlineMs) {
  return new Promise((resolve) => {
    const end = Date.now() + deadlineMs;
    const tryOnce = () => {
      if (!_proc) return resolve(false);
      const c = net.connect({ host: '127.0.0.1', port }, () => { c.destroy(); resolve(true); });
      c.on('error', () => { try { c.destroy(); } catch {} (Date.now() > end) ? resolve(false) : setTimeout(tryOnce, 150); });
    };
    tryOnce();
  });
}

async function ensureBinary(userDataDir, downloadBuffer) {
  const dir = path.join(userDataDir, 'byedpi');
  const exe = path.join(dir, 'ciadpi.exe');
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(dir, { recursive: true });
  const buf = await downloadBuffer(BYEDPI_URL);
  if (!buf || buf.length < 10000) throw new Error('ByeDPI download failed');
  let AdmZip;
  try { AdmZip = require('adm-zip'); } catch { throw new Error('adm-zip missing'); }
  const zip = new AdmZip(buf);
  let chosen = null;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const base = path.basename(e.entryName);
    if (/\.exe$/i.test(base)) {
      const out = path.join(dir, base);
      fs.writeFileSync(out, e.getData());
      if (/ciadpi/i.test(base) || !chosen) chosen = out;
    }
  }
  if (!chosen) throw new Error('no .exe inside ByeDPI archive');
  if (path.resolve(chosen) !== path.resolve(exe)) { try { fs.copyFileSync(chosen, exe); } catch { return chosen; } }
  return exe;
}

function stop() {
  if (_proc) { try { _proc.kill(); } catch {} try { _proc.kill('SIGKILL'); } catch {} _proc = null; }
  _port = 0;
}

// Launch ciadpi with a preset (or custom flags) on a free port; verify it's
// listening, retrying once. Returns the SOCKS5 port. Throws on failure.
async function start(userDataDir, downloadBuffer, presetIndex, customFlags) {
  stop();
  const exe = await ensureBinary(userDataDir, downloadBuffer);
  const logPath = path.join(path.dirname(exe), 'ciadpi.log');
  const flags = (customFlags && String(customFlags).trim()) ? parseFlags(customFlags) : (PRESETS[presetIndex] || PRESETS[0]);
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await _freePort();
    if (!port) { lastErr = 'no free port'; continue; }
    let logFd = null;
    try { logFd = fs.openSync(logPath, 'a'); fs.writeSync(logFd, `\n[${new Date().toISOString()}] -p ${port} ${flags.join(' ')}\n`); } catch {}
    try {
      _proc = spawn(exe, ['-i', '127.0.0.1', '-p', String(port), ...flags], { windowsHide: true, stdio: ['ignore', logFd || 'ignore', logFd || 'ignore'] });
    } catch (e) { lastErr = 'spawn: ' + (e && e.message); continue; }
    _proc.on('error', () => { _proc = null; _port = 0; });
    _proc.on('exit', () => { _proc = null; _port = 0; });
    _port = port;
    const up = await _waitListening(port, 3500);
    if (up && _proc) return port;
    lastErr = _proc ? 'not listening' : 'exited immediately (check ciadpi.log / antivirus)';
    stop();
  }
  throw new Error('ByeDPI ' + lastErr);
}

module.exports = { start, stop, ensureBinary, parseFlags, PRESETS, BYEDPI_URL, getPort: () => _port, isRunning: () => !!_proc };
