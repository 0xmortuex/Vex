// === Vex Tor launcher — start Tor ourselves, no Tor Browser required ===
//
// Modeled on byedpi.js (the Discord DPI-bypass helper): download a small
// official binary on demand into userData, run it on a local port, and route a
// Vex session through it. Here it's the Tor Project's Expert Bundle — a
// standalone, statically-linked tor.exe (~10 MB) plus geoip files. We spawn it
// as a SOCKS5 client, parse its "Bootstrapped N%" log so the UI can show a real
// connection progress bar, and resolve once it reaches 100%.
//
// Source: https://www.torproject.org/download/tor/ (Expert Bundle, Windows x64).
// Only used when no Tor is already running (Tor Browser :9150 / tor service
// :9050) — the caller detects those first and prefers them.
const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// Pinned Expert Bundle. The archive keeps old versions indefinitely, so a
// pinned URL stays valid; bump it to ship a newer Tor.
const TOR_VERSION = '15.0.20';
const TOR_URL = `https://archive.torproject.org/tor-package-archive/torbrowser/${TOR_VERSION}/tor-expert-bundle-windows-x86_64-${TOR_VERSION}.tar.gz`;

let _proc = null;
let _port = 0;

function getPort() { return _port; }
function isRunning() { return !!_proc; }

function _freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.on('error', () => resolve(0));
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Streaming download that reports progress (bytes / total) via onProgress, and
// follows redirects. Resolves the full Buffer.
function _downloadWithProgress(url, onProgress, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 6) return reject(new Error('too many redirects'));
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'Vex' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(_downloadWithProgress(next, onProgress, depth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      const chunks = [];
      let got = 0;
      res.on('data', (c) => {
        chunks.push(c); got += c.length;
        if (onProgress) { try { onProgress(got, total); } catch {} }
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('download timed out')); });
  });
}

// Ensure tor.exe + geoip files exist on disk (download+extract once). onProgress
// is called during download with a 0..1 fraction. Returns { exe, geoip, geoip6 }.
async function ensureBinary(userDataDir, onProgress) {
  const dir = path.join(userDataDir, 'tor');
  const exe = path.join(dir, 'tor', 'tor.exe');
  const geoip = path.join(dir, 'data', 'geoip');
  const geoip6 = path.join(dir, 'data', 'geoip6');
  if (fs.existsSync(exe)) return { exe, geoip, geoip6 };
  fs.mkdirSync(dir, { recursive: true });
  const buf = await _downloadWithProgress(TOR_URL, (got, total) => {
    if (onProgress && total) onProgress(got / total);
  });
  if (!buf || buf.length < 1000000) throw new Error('Tor download failed (short response)');
  const tgz = path.join(dir, 'teb.tar.gz');
  fs.writeFileSync(tgz, buf);
  let tar;
  try { tar = require('tar'); } catch { throw new Error('tar module missing'); }
  await tar.x({ file: tgz, cwd: dir }); // auto-detects gzip; lays out tor/ and data/
  try { fs.unlinkSync(tgz); } catch {}
  if (!fs.existsSync(exe)) throw new Error('tor.exe not found after extract');
  return { exe, geoip, geoip6 };
}

function stop() {
  if (_proc) { try { _proc.kill(); } catch {} try { _proc.kill('SIGKILL'); } catch {} _proc = null; }
  _port = 0;
}

// Download (if needed) + launch tor.exe as a SOCKS client and wait until it's
// bootstrapped to 100%. onProgress(phase, value, detail):
//   phase 'download'  value = 0..1 download fraction
//   phase 'bootstrap' value = 0..100 tor bootstrap percent, detail = tag
// Resolves the SOCKS port. Rejects on failure/timeout.
async function start(userDataDir, onProgress) {
  if (_proc && _port) return _port; // already running
  stop();
  const emit = (phase, value, detail) => { if (onProgress) { try { onProgress(phase, value, detail); } catch {} } };

  const { exe, geoip, geoip6 } = await ensureBinary(userDataDir, (frac) => emit('download', frac));
  emit('download', 1);

  const port = await _freePort();
  if (!port) throw new Error('no free local port for Tor');
  const dataDir = path.join(userDataDir, 'tor', 'tordata');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  const logPath = path.join(userDataDir, 'tor', 'tor.log');
  let logFd = null;
  try { logFd = fs.openSync(logPath, 'a'); fs.writeSync(logFd, `\n[${new Date().toISOString()}] launching tor on :${port}\n`); } catch {}

  const args = [
    '--SocksPort', '127.0.0.1:' + port,
    '--DataDirectory', dataDir,
    '--Log', 'notice stdout',
    '--ClientOnly', '1',
    '--AvoidDiskWrites', '1',
  ];
  if (fs.existsSync(geoip)) args.push('--GeoIPFile', geoip);
  if (fs.existsSync(geoip6)) args.push('--GeoIPv6File', geoip6);

  return await new Promise((resolve, reject) => {
    try {
      _proc = spawn(exe, args, { windowsHide: true });
    } catch (e) { return reject(new Error('spawn tor: ' + (e && e.message))); }
    _port = port;
    let settled = false;
    const finishOk = () => { if (settled) return; settled = true; resolve(port); };
    const finishErr = (msg) => { if (settled) return; settled = true; stop(); reject(new Error(msg)); };

    const onLine = (line) => {
      try { if (logFd) fs.writeSync(logFd, line + '\n'); } catch {}
      const m = /Bootstrapped (\d+)%(?:\s*\(([^)]*)\))?/.exec(line);
      if (m) {
        const pct = parseInt(m[1], 10);
        emit('bootstrap', pct, m[2] || '');
        if (pct >= 100) finishOk();
      }
    };
    let buf = '';
    const feed = (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } };
    if (_proc.stdout) _proc.stdout.on('data', feed);
    if (_proc.stderr) _proc.stderr.on('data', feed);
    _proc.on('error', (e) => finishErr('tor error: ' + (e && e.message)));
    _proc.on('exit', (code) => { _proc = null; _port = 0; finishErr('tor exited (code ' + code + ') before bootstrap — see tor.log'); });
    // Bootstrapping can be slow on some networks; give it up to 2 minutes.
    setTimeout(() => finishErr('Tor took too long to connect (timed out) — check your network'), 120000);
  });
}

module.exports = { start, stop, ensureBinary, getPort, isRunning, TOR_URL, TOR_VERSION };
