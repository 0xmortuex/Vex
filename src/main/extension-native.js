// === Native messaging for an extension (2026-10-28) ============================
//
// chrome.runtime.connectNative / sendNativeMessage: an extension talks to a program on this computer that the program's installer registered for
// it. The Claude extension talks to Claude Code and to the Claude desktop app this way. Chrome's protocol, kept exactly so the installed hosts work:
//
//   - a host is registered under HKCU/HKLM \\Software\\Google\\Chrome\\NativeMessagingHosts\\<name> (and Chromium's) whose default value is the
//     path of a JSON manifest { name, type: "stdio", path, allowed_origins: ["chrome-extension://<id>/"] };
//   - Vex starts the host only when the manifest names this extension in allowed_origins, with the extension's origin as its first argument;
//   - messages both ways are JSON preceded by their length as 4 bytes, little-endian, on the host's stdin and stdout;
//     the host may send up to 1 MiB at once, the extension up to 64 MiB.
// Vex's own rule on top, as for the debugger: OFF until the person turns on "Allow it to talk to programs on this computer" on the
// extension's card (main/extension-grants.js), and every host is stopped the moment it goes off or the extension is unloaded.
//
// createExtensionNative is pure over what it is given (spawn, the registry and file reads), so it is tested against fakes:
//   spawn(cmd, args, opts) -> a child process       findManifest(name) -> { file, manifest } or null
//   allowed(folder) -> the person's switch          emit(ses, extId, type, args) -> tells the extension
const path = require('path');

const NAME_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const MAX_FROM_HOST = 1024 * 1024;
const MAX_TO_HOST = 64 * 1024 * 1024;
const ONCE_MS = 30000;

const MSG = Object.freeze({
  notFound: 'Specified native messaging host not found.',
  forbidden: 'Access to the specified native messaging host is forbidden.',
  invalidName: 'Invalid native messaging host name specified.',
  exited: 'Native host has exited.',
  tooBig: 'Native host has exceeded maximum message size.',
  closed: 'Attempting to use a disconnected port object',
  denied: 'Vex has not let this extension talk to programs on this computer. Turn on "Allow it to talk to programs on this computer" on its card in Settings > Extensions.',
});

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_TO_HOST) throw new Error('Message length exceeded maximum allowed length.');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

// Splits what a host writes into messages. onMessage(object); onError(text) for a frame that is too big or not JSON, after which it stops.
function createReader(onMessage, onError) {
  let buf = Buffer.alloc(0);
  let broken = false;
  return {
    push(chunk) {
      if (broken) return;
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (len > MAX_FROM_HOST) { broken = true; onError(MSG.tooBig); return; }
        if (buf.length < 4 + len) return;
        const body = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        let message;
        try { message = JSON.parse(body.toString('utf8')); }
        catch { broken = true; onError(MSG.exited); return; }
        onMessage(message);
      }
    },
  };
}

// The command line for a host: a .bat or .cmd runs through cmd.exe (Node refuses to start one directly), anything else directly.
function commandFor(file, origin, comspec = process.env.ComSpec || 'cmd.exe') {
  if (/\.(bat|cmd)$/i.test(file)) {
    if (/["%^&|<>]/.test(file)) throw new Error(MSG.forbidden);
    return { cmd: comspec, args: ['/d', '/s', '/c', '""' + file + '" "' + origin + '""'], verbatim: true };
  }
  return { cmd: file, args: [origin], verbatim: false };
}

function createExtensionNative({ spawn, findManifest, allowed, emit, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const ports = new Map();   // `${key}|${portId}` -> { child, ses, extId, folder, key, portId, closed }
  const slot = (key, portId) => key + '|' + portId;

  async function start({ extId, folder, name }) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(MSG.invalidName);
    if (!allowed(folder)) throw new Error(MSG.denied);
    const found = await findManifest(name);
    if (!found) throw new Error(MSG.notFound);
    const m = found.manifest || {};
    const origin = 'chrome-extension://' + extId + '/';
    if (m.name !== name || m.type !== 'stdio' || typeof m.path !== 'string' || !m.path) throw new Error(MSG.notFound);
    if (!Array.isArray(m.allowed_origins) || !m.allowed_origins.includes(origin)) throw new Error(MSG.forbidden);
    const file = path.win32.isAbsolute(m.path) ? m.path : path.win32.resolve(path.win32.dirname(found.file), m.path);
    const { cmd, args, verbatim } = commandFor(file, origin);
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: verbatim, cwd: path.win32.dirname(file) });
    return child;
  }

  // connectNative: the port is the extension's (it made the id); everything that happens is told to it.
  async function connect({ ses, key, extId, folder, portId, name }) {
    const tell = (type, args) => { try { emit(ses, extId, type, args); } catch (err) { console.error('[Extensions] ' + type + ' did not reach ' + extId + ':', err.message); } };
    let child;
    try { child = await start({ extId, folder, name }); }
    catch (err) { tell('native.onDisconnect', [portId, err.message]); return false; }
    const p = { child, ses, extId, folder, key, portId, closed: false };
    ports.set(slot(key, portId), p);
    const close = (message) => {
      if (p.closed) return;
      p.closed = true;
      ports.delete(slot(key, portId));
      try { child.kill(); } catch (err) { console.error('[Extensions] could not stop a native host:', err.message); }
      tell('native.onDisconnect', [portId, message || null]);
    };
    const reader = createReader((message) => tell('native.onMessage', [portId, message]), (text) => close(text));
    child.stdout.on('data', (chunk) => reader.push(chunk));
    child.stderr.on('data', () => { /* a host's own log: not kept, not shown */ });
    child.on('error', () => close(MSG.exited));
    child.on('exit', () => close(null));
    child.stdin.on('error', () => close(MSG.exited));
    return true;
  }

  function send({ key, portId, message }) {
    const p = ports.get(slot(key, portId));
    if (!p || p.closed) throw new Error(MSG.closed);
    p.child.stdin.write(frame(message));
    return undefined;
  }

  function disconnect({ key, portId }) {
    const p = ports.get(slot(key, portId));
    if (!p) return undefined;
    p.closed = true;
    ports.delete(slot(key, portId));
    try { p.child.stdin.end(); } catch (err) { console.error('[Extensions] could not close a native host\'s input:', err.message); }
    try { p.child.kill(); } catch (err) { console.error('[Extensions] could not stop a native host:', err.message); }
    return undefined;
  }

  // sendNativeMessage: one message out, the first one back, then the host is stopped.
  async function sendOnce({ extId, folder, name, message }) {
    const child = await start({ extId, folder, name });
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeoutFn(() => end(new Error(MSG.exited)), ONCE_MS);
      const end = (err, value) => {
        if (done) return;
        done = true;
        clearTimeoutFn(timer);
        try { child.kill(); } catch (e) { console.error('[Extensions] could not stop a native host:', e.message); }
        if (err) reject(err); else resolve(value);
      };
      const reader = createReader((m) => end(null, m), (text) => end(new Error(text)));
      child.stdout.on('data', (chunk) => reader.push(chunk));
      child.stderr.on('data', () => { /* a host's own log */ });
      child.on('error', () => end(new Error(MSG.exited)));
      child.on('exit', () => end(new Error(MSG.exited)));
      child.stdin.on('error', () => end(new Error(MSG.exited)));
      try { child.stdin.write(frame(message)); } catch (err) { end(err); }
    });
  }

  // The switch went off, or the extension was unloaded or removed: every host it started is stopped.
  function stop({ extId, folder }) {
    let n = 0;
    for (const p of [...ports.values()]) {
      if ((extId != null && p.extId !== extId) || (folder != null && p.folder !== folder)) continue;
      p.closed = true;
      ports.delete(slot(p.key, p.portId));
      try { p.child.kill(); } catch (err) { console.error('[Extensions] could not stop a native host:', err.message); }
      try { emit(p.ses, p.extId, 'native.onDisconnect', [p.portId, MSG.exited]); } catch (err) { console.error('[Extensions] native.onDisconnect did not reach ' + p.extId + ':', err.message); }
      n++;
    }
    return n;
  }

  return { connect, send, disconnect, sendOnce, stop, count: () => ports.size, _ports: ports };
}

// Chrome's keys for hosts, newest owner first; the value of each is the path of the manifest. Reads through reg.exe (no native module).
const REGISTRY_KEYS = Object.freeze([
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\',
  'HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\',
  'HKCU\\Software\\Chromium\\NativeMessagingHosts\\',
  'HKLM\\Software\\Chromium\\NativeMessagingHosts\\',
]);
function parseRegQuery(output) {
  const m = /\(Default\)\s+REG_SZ\s+(.+)/i.exec(String(output || '')) || /<NO NAME>\s+REG_SZ\s+(.+)/i.exec(String(output || ''));
  return m ? m[1].trim() : null;
}

module.exports = { createExtensionNative, createReader, frame, commandFor, parseRegQuery, NAME_RE, MSG, REGISTRY_KEYS, MAX_FROM_HOST, MAX_TO_HOST };
