// Refuse remote debugging of the REAL profile.
//
// The standard infostealer trick against a Chromium browser is to start it with
// --remote-debugging-port (or -pipe) and read every cookie over the DevTools
// protocol, already decrypted. Vex never needed such a port in a packaged
// install, so a packaged Vex that is started with one (or with a Node
// --inspect flag, or --remote-allow-origins that lets a web page talk to the
// port) now exits before it opens a window, unless it is running on a profile
// the project's own test harness made for it (see isHarnessProfile).
//
// This module is pure: main.js hands it argv/userData/env and an fs. Tested in
// tests/main/debugGuard.test.js; the facts it relies on (the flags really show
// up in process.argv and app.commandLine, in the spellings Chromium accepts)
// were measured in real Electron.
'use strict';
const nodePath = require('path');

// Names (lowercase, '_' read as '-'). Chromium: remote-debugging-*; Node: inspect*, debug*.
const DEBUG_SWITCHES = Object.freeze([
  'remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'remote-allow-origins',
  'inspect', 'inspect-brk', 'inspect-wait', 'inspect-port', 'inspect-publish-uid', 'inspect-brk-node',
  'debug', 'debug-brk', 'debug-port',
]);
const PROBE_MARKER = '.vex-probe-profile';
const NONCE_ENV = 'VEX_PROBE_NONCE';
const NONCE = /^[0-9a-f]{32}$/;

// Chromium on Windows accepts "--name", "-name" and "/name", any case, and
// "name=value" (a value given as the NEXT argument is just a loose argument,
// but the switch itself is set). Everything after a bare "--" is not a switch.
function switchesIn(argv) {
  const found = [];
  for (const raw of Array.isArray(argv) ? argv.slice(1) : []) {
    const arg = String(raw);
    if (arg === '--') break;
    const m = /^(?:--|-|\/)([A-Za-z][A-Za-z0-9_-]*)(?:[=:]([\s\S]*))?$/.exec(arg);
    if (!m) continue;
    found.push({ name: m[1].toLowerCase().replace(/_/g, '-'), value: m[2] === undefined ? null : m[2], arg });
  }
  return found;
}
const debugSwitchesIn = (argv) => switchesIn(argv).filter(s => DEBUG_SWITCHES.includes(s.name));

const norm = (p) => nodePath.resolve(String(p)).toLowerCase();
const isInside = (child, parent) => { const c = norm(child), p = norm(parent); return c === p || c.startsWith(p + nodePath.sep); };

// The folders that hold a real Vex profile or install.
function realRoots(env = process.env) {
  const out = [];
  const appData = env.APPDATA || (env.USERPROFILE ? nodePath.join(env.USERPROFILE, 'AppData', 'Roaming') : '');
  if (appData) out.push(nodePath.join(appData, 'vex'), nodePath.join(appData, 'Vex'), nodePath.join(appData, 'game-control-center'));
  const local = env.LOCALAPPDATA || '';
  if (local) out.push(nodePath.join(local, 'vex'), nodePath.join(local, 'Programs', 'Vex'));
  return out;
}

// Is `userData` a profile the test harness (scripts/lib/probe-profile.js) made
// for this very launch? ALL of these must hold:
//   1. --user-data-dir=<same folder> was given explicitly on the command line
//      (not the default profile, not a --profile= profile);
//   2. that folder is inside the OS temp directory, and neither it nor its real
//      location (junctions/symlinks resolved) is inside a real Vex folder, and
//      no real Vex folder is inside the temp directory (TEMP pointed at the
//      profile's parent);
//   3. it holds the marker file written by the harness with a random nonce, and
//      the launch environment carries the same nonce (VEX_PROBE_NONCE).
// Same-user malware that reads this file can imitate it for a profile of its
// own making; what it can no longer do is point a debug port at the person's
// real profile with one command line, which is the whole infostealer recipe.
function isHarnessProfile({ argv, userData, env = process.env, tmpdir, fs }) {
  if (!userData || !tmpdir) return { ok: false, reason: 'no profile folder or temp folder is known' };
  const arg = switchesIn(argv).find(s => s.name === 'user-data-dir');
  if (!arg || !arg.value) return { ok: false, reason: 'the profile was not given with --user-data-dir' };
  if (norm(arg.value) !== norm(userData)) return { ok: false, reason: '--user-data-dir does not name the profile in use' };
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; /* vex-allow-empty-catch: a path that cannot be resolved is judged as written; the marker read below still has to succeed */ } };
  const dir = real(userData), tmp = real(tmpdir);
  if (norm(dir) === norm(tmp) || !isInside(dir, tmp)) return { ok: false, reason: 'the profile is not inside the temp folder' };
  for (const root of realRoots(env)) {
    if (isInside(dir, root) || isInside(userData, root)) return { ok: false, reason: 'the profile is inside a real Vex folder' };
    if (isInside(real(root), tmp) || isInside(root, tmp)) return { ok: false, reason: 'the temp folder contains a real Vex folder' };
  }
  let marker;
  try { marker = JSON.parse(fs.readFileSync(nodePath.join(userData, PROBE_MARKER), 'utf8')); }
  catch { return { ok: false, reason: 'the profile has no readable ' + PROBE_MARKER + ' marker' }; }
  const nonce = env[NONCE_ENV];
  if (!marker || marker.v !== 1 || !NONCE.test(String(marker.nonce)) || typeof nonce !== 'string' || nonce !== marker.nonce) {
    return { ok: false, reason: 'the marker does not match ' + NONCE_ENV };
  }
  return { ok: true, reason: 'harness profile' };
}

// { action: 'allow' | 'refuse', found: [switch names], reason }
function decide({ packaged, argv, userData, env = process.env, tmpdir, fs }) {
  const found = debugSwitchesIn(argv);
  if (!found.length) return { action: 'allow', found: [], reason: 'no debugging switch' };
  const names = [...new Set(found.map(f => f.name))];
  if (!packaged) return { action: 'allow', found: names, reason: 'not a packaged build' };
  const h = isHarnessProfile({ argv, userData, env, tmpdir, fs });
  if (h.ok) return { action: 'allow', found: names, reason: h.reason };
  return { action: 'refuse', found: names, reason: h.reason };
}

// Chromium writes <userData>/DevToolsActivePort (port + browser path) when a
// debug port opens and does not always remove it. A leftover one is a map to a
// port that is not there, and proof that one was open once. Only called when
// THIS launch has no debugging switch, so any such file is stale. A failure to
// delete it is reported, never thrown (starting Vex matters more).
function removeStaleDevToolsPort({ fs, userData, log = console }) {
  const file = nodePath.join(userData, 'DevToolsActivePort');
  try {
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file, { force: true });
    log.warn('[Security] removed a stale DevToolsActivePort file: a debugging port was open on this profile once');
    return true;
  } catch (err) {
    log.warn('[Security] could not remove the stale DevToolsActivePort file:', err.message);
    return false;
  }
}

const refusalMessage = (d) => 'Vex will not start with ' + d.found.map(n => '--' + n).join(', ') + ' on a real profile (' + d.reason + '). A debugging port lets any program on this computer read your logged-in sessions. Close this window and start Vex normally.';

module.exports = { DEBUG_SWITCHES, PROBE_MARKER, NONCE_ENV, switchesIn, debugSwitchesIn, isHarnessProfile, decide, removeStaleDevToolsPort, refusalMessage, realRoots };
