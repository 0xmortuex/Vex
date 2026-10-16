// === Webhook inspector (T3-058) ================================================
//
// A temporary receiver that shows what a webhook sender (a Stripe or GitHub
// test, a curl) puts in a request, so a handler can be written against the real
// shape. Deliberately small and closed:
//
//   - Off until the owner starts it, on a port the owner types, for a number of
//     minutes the owner picks (1 to 60); it stops itself when they are up.
//   - Bound to 127.0.0.1 and nothing else. A request whose Host header is not
//     this address (a page trying a DNS rebind) is answered 421 and not listed.
//   - It never forwards, replays or relays anything. Every answer is the same
//     small JSON. There is no tunnel and no public address; sharing one is not
//     something this module can do.
//   - Size-capped: a body over 1 MiB is not kept (the request is answered 413
//     and listed as too large), at most 100 requests and 8 MiB of bodies are
//     held, oldest dropped first. Nothing is written to disk.
//   - What it holds is what a stranger on this computer (or a page in a browser
//     that can reach a loopback address) chose to send. The window shows it as
//     plain text only.
//
// createWebhookInspector({ http, now, setTimeout, clearTimeout })

const MAX_BODY = 1024 * 1024;
const MAX_REQUESTS = 100;
const MAX_TOTAL = 8 * 1024 * 1024;
const MAX_HEADERS = 100;
const MAX_HEADER_VALUE = 4096;
const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

function checkOptions({ port, minutes }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('A port is a number from 1024 to 65535');
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) throw new Error('Choose between ' + MIN_MINUTES + ' and ' + MAX_MINUTES + ' minutes');
}

function createWebhookInspector({ http, now = () => Date.now(), setTimeout: setT = setTimeout, clearTimeout: clearT = clearTimeout, log = () => {} }) {
  if (!http || typeof http.createServer !== 'function') throw new Error('createWebhookInspector needs http');
  let server = null;
  let port = 0;
  let startedAt = 0;
  let stopsAt = 0;
  let timer = null;
  let nextId = 1;
  let requests = [];
  let total = 0;

  const hostOk = (host) => {
    const h = String(host || '').toLowerCase();
    return h === '127.0.0.1:' + port || h === 'localhost:' + port || h === '127.0.0.1' || h === 'localhost';
  };

  function remember(rec) {
    requests.push(rec);
    total += rec.body.length;
    while (requests.length > MAX_REQUESTS || total > MAX_TOTAL) {
      const gone = requests.shift();
      total -= gone.body.length;
    }
  }

  function onRequest(req, res) {
    const reply = (code, text) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
      res.end(text);
    };
    if (!hostOk(req.headers.host)) { req.resume(); reply(421, '{"ok":false,"error":"wrong host"}'); return; }
    const headers = [];
    const raw = req.rawHeaders || [];
    for (let i = 0; i + 1 < raw.length && headers.length < MAX_HEADERS; i += 2) headers.push([String(raw[i]).slice(0, 100), String(raw[i + 1]).slice(0, MAX_HEADER_VALUE)]);
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (tooLarge) return;
      if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on('error', (err) => { log('[Webhook] a request failed: ' + err.message); });
    req.on('end', () => {
      const buf = tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks);
      let text = buf.toString('utf8');
      // A body that is not text is not shown as text.
      const binary = text.includes('�');
      if (binary) text = '';
      remember({
        id: nextId++, at: now(), method: String(req.method || '').slice(0, 20), path: String(req.url || '').slice(0, 2000),
        headers, size, tooLarge, binary, body: text,
        from: String(req.socket && req.socket.remoteAddress || '').slice(0, 60),
      });
      if (tooLarge) reply(413, '{"ok":false,"error":"too large"}');
      else reply(200, '{"ok":true}');
    });
  }

  function stop() {
    if (timer) { clearT(timer); timer = null; }
    const s = server;
    server = null; port = 0; startedAt = 0; stopsAt = 0;
    if (!s) return Promise.resolve({ running: false });
    return new Promise((resolve) => {
      s.close(() => resolve({ running: false }));
      if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    });
  }

  function start({ port: wanted, minutes }) {
    if (server) return Promise.reject(new Error('The inspector is already listening on port ' + port + '. Stop it first.'));
    try { checkOptions({ port: wanted, minutes }); } catch (err) { return Promise.reject(err); }
    return new Promise((resolve, reject) => {
      const s = http.createServer(onRequest);
      s.requestTimeout = 15000;
      s.headersTimeout = 10000;
      s.maxHeadersCount = MAX_HEADERS;
      s.once('error', (err) => {
        reject(new Error(err && err.code === 'EADDRINUSE' ? 'Port ' + wanted + ' is already in use. Choose another.' : 'Could not listen on port ' + wanted + ': ' + (err && err.message)));
      });
      s.listen(wanted, '127.0.0.1', () => {
        server = s; port = wanted; startedAt = now(); stopsAt = startedAt + minutes * 60000;
        requests = []; total = 0; nextId = 1;
        timer = setT(() => { stop().then(() => log('[Webhook] stopped by its timer')).catch((err) => log('[Webhook] could not stop on its timer: ' + err.message)); }, minutes * 60000);
        if (timer && typeof timer.unref === 'function') timer.unref();
        s.on('error', (err) => log('[Webhook] server error: ' + err.message));
        resolve(status());
      });
    });
  }

  function status() {
    return { running: !!server, port, host: '127.0.0.1', startedAt, stopsAt, count: requests.length, maxBody: MAX_BODY };
  }

  // Newest last. `since` is the last id the window already has.
  function list(since = 0) {
    return requests.filter(r => r.id > since).map(r => ({ id: r.id, at: r.at, method: r.method, path: r.path, size: r.size, tooLarge: r.tooLarge, binary: r.binary }));
  }

  function get(id) {
    const r = requests.find(x => x.id === id);
    if (!r) throw new Error('That request is gone (only the latest ' + MAX_REQUESTS + ' are kept)');
    return { ...r, headers: r.headers.map(h => h.slice()) };
  }

  function clear() { requests = []; total = 0; return { count: 0 }; }

  return { start, stop, status, list, get, clear, LIMITS: { MAX_BODY, MAX_REQUESTS, MAX_TOTAL, MIN_MINUTES, MAX_MINUTES } };
}

module.exports = { createWebhookInspector, MAX_BODY, MAX_REQUESTS, MAX_TOTAL, MIN_MINUTES, MAX_MINUTES };
