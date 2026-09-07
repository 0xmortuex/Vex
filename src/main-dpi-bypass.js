// === Vex DPI-bypass proxy — reach SNI/DNS-blocked sites (e.g. Discord in TR) ===
//
// A tiny local HTTP CONNECT proxy that defeats the two common state-censorship
// techniques without any external tool, VPN, or account:
//
//   1. DNS blocking  → resolves the target host over DNS-over-HTTPS (Cloudflare
//      1.1.1.1), so a poisoned/blocked system resolver is bypassed.
//   2. SNI / DPI     → splits the TLS ClientHello into two TCP segments *inside*
//      the SNI hostname (with Nagle off), so the Deep-Packet-Inspection box can't
//      reassemble the server name in a single packet and lets the connection
//      through. This is the same "split"/fragmentation idea as GoodbyeDPI /
//      ByeDPI / Zapret.
//
// It is a pass-through tunnel — it never decrypts traffic, only fragments the
// handshake bytes. Vex points the Discord panel's session at it (persist:discord),
// so normal browsing is unaffected. Best-effort: simple fragmentation defeats
// many DPI systems but not all; a stubborn DPI may still need a dedicated tool.

const net = require('net');
const https = require('https');

const _dohCache = new Map(); // host -> { ip, exp }

function dohResolve(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.indexOf(':') !== -1) return Promise.resolve(host);
  const c = _dohCache.get(host);
  if (c && c.exp > Date.now()) return Promise.resolve(c.ip);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ip) => { if (done) return; done = true; if (ip) _dohCache.set(host, { ip, exp: Date.now() + 300000 }); resolve(ip); };
    try {
      const req = https.request({
        host: '1.1.1.1', servername: 'cloudflare-dns.com', port: 443,
        path: '/dns-query?type=A&name=' + encodeURIComponent(host),
        headers: { accept: 'application/dns-json' }, timeout: 5000,
      }, (res) => {
        let d = '';
        res.on('data', (x) => { d += x; if (d.length > 65536) try { req.destroy(); } catch {} });
        res.on('end', () => { try { const j = JSON.parse(d); const a = (j.Answer || []).filter(e => e.type === 1).map(e => e.data); finish(a[0] || null); } catch { finish(null); } });
      });
      req.on('timeout', () => { try { req.destroy(); } catch {} finish(null); });
      req.on('error', () => finish(null));
      req.end();
    } catch { finish(null); }
  });
}

// Pick a TCP split point INSIDE the TLS ClientHello SNI hostname (so the server
// name straddles two segments). Falls back to a tiny offset if it can't parse.
function sniSplit(buf) {
  try {
    if (!buf || buf.length < 45 || buf[0] !== 0x16) return buf ? Math.min(3, buf.length) : 0;
    let p = 5;
    if (buf[p] !== 0x01) return Math.min(3, buf.length); // not a ClientHello
    p += 4 + 2 + 32;                 // handshake header(4) + client version(2) + random(32)
    p += 1 + buf[p];                 // session id
    p += 2 + buf.readUInt16BE(p);    // cipher suites
    p += 1 + buf[p];                 // compression methods
    if (p + 2 > buf.length) return 3;
    const extEnd = p + 2 + buf.readUInt16BE(p); p += 2;
    while (p + 4 <= Math.min(extEnd, buf.length)) {
      const type = buf.readUInt16BE(p), len = buf.readUInt16BE(p + 2); p += 4;
      if (type === 0x0000 && len >= 5) {                 // server_name extension
        const nameLen = buf.readUInt16BE(p + 3);
        const nameStart = p + 5;
        if (nameLen > 1 && nameStart + nameLen <= buf.length) return nameStart + Math.floor(nameLen / 2);
      }
      p += len;
    }
  } catch { /* fall through */ }
  return Math.min(3, buf.length);
}

// Start the proxy. Resolves to the listening port (0 on failure → caller skips
// it and the site loads directly = fail-open).
function startDpiBypassProxy() {
  return new Promise((resolve) => {
    let started = false;
    const server = net.createServer(client => require('./main/connect-tunnel').handleConnect(client, { resolve: dohResolve, split: sniSplit }));
    server.on('error', () => { if (!started) { started = true; resolve(0); } });
    server.listen(0, '127.0.0.1', () => { started = true; resolve(server.address().port); });
  });
}

module.exports = { startDpiBypassProxy, sniSplit, dohResolve };
