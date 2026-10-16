// === Log tailer: one granted file or one local websocket ======================
//
// Watching a QEMU serial log, a build log or a dev server's output means a
// terminal tab kept open for a file the browser could show. This follows ONE
// thing the person granted, read-only:
//
//   * a file chosen with the file picker (the only way a path gets in), or
//   * a websocket on this computer (ws://localhost or 127.0.0.1) the person typed.
//
// It never opens a path it was not given, never writes, never starts a process
// and never sends a byte down a socket. The text kept is a ring of the last 2 MB
// (older text falls off the front), so a log that grows for days cannot grow Vex.
// The renderer (js/log-tailer.js) turns ANSI colours into styled text, searches
// and folds; this side only hands over new text since a position.

const { StringDecoder } = require('string_decoder');

const RING_CHARS = 2 * 1024 * 1024;
const FIRST_READ_BYTES = 64 * 1024;       // what a freshly granted file shows first
const MAX_READ_BYTES = 256 * 1024;        // at most this much per poll
const MAX_GRANTS = 4;
const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i;

function checkSocketUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error('That is not an address'); }
  if (u.protocol !== 'ws:') throw new Error('Only ws:// addresses on this computer can be followed (wss:// and remote hosts are refused)');
  if (!LOOPBACK.test(u.hostname)) throw new Error('Only localhost, 127.0.0.1 or [::1] can be followed');
  if (u.username || u.password) throw new Error('The address must not carry a user name or password');
  return u.href;
}

function createLogTail({ fs, WebSocketImpl, newId }) {
  const grants = new Map();
  let n = 0;
  const idOf = newId || (() => 'lt' + (++n) + '-' + Math.random().toString(36).slice(2, 8));

  function newRing() { return { text: '', total: 0 }; }
  function push(g, chunk) {
    if (!chunk) return;
    g.ring.text += chunk;
    g.ring.total += chunk.length;
    if (g.ring.text.length > RING_CHARS) g.ring.text = g.ring.text.slice(g.ring.text.length - RING_CHARS);
  }
  function room() {
    if (grants.size >= MAX_GRANTS) throw new Error('At most ' + MAX_GRANTS + ' logs can be followed at once; stop one first');
  }

  // A file the person chose. The first look is the end of it.
  function grantFile(filePath) {
    room();
    const p = String(filePath || '');
    const stat = fs.statSync(p);
    if (!stat.isFile()) throw new Error('That is not a file');
    const g = { id: idOf(), kind: 'file', path: p, name: p.split(/[\\/]/).pop(), offset: 0, ring: newRing(), decoder: new StringDecoder('utf8'), note: '' };
    g.offset = Math.max(0, stat.size - FIRST_READ_BYTES);
    grants.set(g.id, g);
    readFile(g, stat.size);
    return { id: g.id, kind: g.kind, name: g.name };
  }

  function readFile(g, size) {
    if (size < g.offset) {           // truncated or replaced: start again from the top
      g.offset = 0;
      g.decoder = new StringDecoder('utf8');
      push(g, '\n[the file was truncated or replaced; reading from the start]\n');
    }
    if (size === g.offset) return;
    let from = g.offset;
    if (size - from > MAX_READ_BYTES) {
      from = size - MAX_READ_BYTES;
      g.decoder = new StringDecoder('utf8');
      push(g, '\n[' + Math.round((from - g.offset) / 1024) + ' KB were skipped to keep up]\n');
    }
    const fd = fs.openSync(g.path, 'r');
    try {
      const len = size - from;
      const buf = Buffer.alloc(len);
      const got = fs.readSync(fd, buf, 0, len, from);
      push(g, g.decoder.write(buf.subarray(0, got)));
      g.offset = from + got;
    } finally { fs.closeSync(fd); }
  }

  // A websocket on this computer. Receive only: nothing is ever sent on it.
  function grantSocket(rawUrl) {
    room();
    if (typeof WebSocketImpl !== 'function') throw new Error('This version of Vex cannot follow a websocket');
    const url = checkSocketUrl(rawUrl);
    const g = { id: idOf(), kind: 'socket', url, name: url, ring: newRing(), note: 'connecting' };
    const ws = new WebSocketImpl(url);
    g.ws = ws;
    ws.onopen = () => { g.note = 'connected'; push(g, '[connected to ' + url + ']\n'); };
    ws.onmessage = (ev) => {
      const d = ev && ev.data;
      const text = typeof d === 'string' ? d : Buffer.isBuffer(d) ? d.toString('utf8') : d instanceof ArrayBuffer ? Buffer.from(d).toString('utf8') : '';
      push(g, text.endsWith('\n') ? text : text + '\n');
    };
    ws.onerror = () => { g.note = 'error'; push(g, '[the connection failed]\n'); };
    ws.onclose = () => { g.note = 'closed'; push(g, '[the connection closed]\n'); };
    grants.set(g.id, g);
    return { id: g.id, kind: g.kind, name: g.name };
  }

  // New text since `since` (a position from the last answer; 0 or undefined = all there is).
  function poll(id, since) {
    const g = grants.get(String(id));
    if (!g) throw new Error('That log is not being followed any more');
    if (g.kind === 'file') readFile(g, fs.statSync(g.path).size);
    const start = g.ring.total - g.ring.text.length;      // position of the first kept character
    const from = Math.max(Number.isFinite(since) ? since : 0, start);
    return { text: g.ring.text.slice(from - start), position: g.ring.total, dropped: from > (Number.isFinite(since) ? since : 0), kind: g.kind, name: g.name, note: g.note };
  }

  function close(id) {
    const g = grants.get(String(id));
    if (!g) return false;
    if (g.ws) { g.ws.onclose = null; try { g.ws.close(); } catch (err) { console.error('[LogTail] the socket did not close cleanly:', err.message); } }
    return grants.delete(g.id);
  }
  const list = () => [...grants.values()].map(g => ({ id: g.id, kind: g.kind, name: g.name, note: g.note }));
  const closeAll = () => { for (const id of [...grants.keys()]) close(id); };

  return { grantFile, grantSocket, poll, close, list, closeAll };
}

module.exports = { createLogTail, checkSocketUrl, RING_CHARS };
