// === "When X happens in Vex, run this program" =================================
//
// An opt-in hook from a few Vex events to ONE program per event that the person chose. It is a
// system-level effect, so it is closed in every way that matters (compare main/local-services.js and
// main/after-downloads.js, whose rules it follows):
//
//   - OFF until the person switches it on, in a box MAIN shows (a window script cannot press it).
//   - The events are a fixed list: a download finished, a reminder fired, exam mode armed, a CI run
//     went red. Nothing else can trigger it, and a page, an extension or the AI cannot reach it: the
//     channels are for Vex's own window only, and the window may only report exam-armed and ci-red.
//   - The program is picked in a system file dialog that main opens (never typed, never sent by a
//     window), by its full path. There is NO lookup on PATH. On Windows it has to be an .exe, and
//     shells and script hosts (cmd, powershell, wscript, mshta, rundll32 ...) are refused: a script
//     cannot be started without a shell.
//   - The arguments are a list the person typed once; they are fixed from then on. spawn(file, args,
//     { shell: false }); there is never a shell string. NOTHING from the event is put on the command
//     line. The program is given the event name (VEX_EVENT) and, for a download, the file name only
//     (VEX_FILE_NAME, cleaned: no folder, no control characters, no shell characters, 120 characters)
//     as environment variables, together with a small fixed set of ordinary Windows variables.
//   - Adding a rule shows the full path, its SHA-256 and the arguments in a main-raised confirm. The
//     SHA-256 is checked again before EVERY run; when the file has changed it is NOT run until the
//     person has seen the old and new hash in another confirm (a "no" is remembered for the session).
//   - It NEVER runs for a private window, a Tor tab or a routed tab: the download hook skips a
//     download that came from one, and the window's own events are refused from a private window.
//   - A run has a timeout (the program is ended), an output cap (the rest is thrown away; what is kept
//     is only shown to the person, in memory, never sent anywhere), one run at a time, and a pause
//     between runs of the same event.
//
// Everything outside (the file system, spawn, the hash, the dialogs, the clock) is injected so it runs
// under test without starting anything. Tests never run a real program.

'use strict';

const nodePath = require('path');

const EVENTS = Object.freeze(['download-finished', 'reminder-fired', 'exam-armed', 'ci-red']);
// The two a window may report (the other two start in main).
const WINDOW_EVENTS = Object.freeze(['exam-armed', 'ci-red']);
const EVENT_LABEL = Object.freeze({ 'download-finished': 'A download finished', 'reminder-fired': 'A reminder fired', 'exam-armed': 'Exam mode was armed', 'ci-red': 'A CI run went red' });
const FORBIDDEN_PROGRAMS = new Set(['cmd', 'powershell', 'pwsh', 'powershell_ise', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'msiexec', 'wmic', 'forfiles', 'bitsadmin', 'certutil', 'bash', 'wsl', 'sh', 'conhost', 'schtasks', 'at', 'cscript', 'msbuild', 'installutil', 'regasm', 'regsvcs', 'odbcconf', 'pcalua', 'explorer']);
const MAX_ARGS = 8;
const MAX_ARG_CHARS = 200;
const MAX_FILE_NAME = 120;
const MAX_OUTPUT = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const COOLDOWN_MS = 5000;
const KILL_GRACE_MS = 5000;
const GRANT_MS = 5 * 60 * 1000;
const MAX_HASH_BYTES = 256 * 1024 * 1024;
// The only variables a program is given besides the two of ours: ordinary Windows ones, so a normal program starts.
const ENV_PASS = Object.freeze(['SystemRoot', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'PATH', 'OS', 'PROCESSOR_ARCHITECTURE']);

// A download's name as the program gets it: no folder, no control or shell characters, short.
function sanitizeFileName(name) {
  const base = String(name == null ? '' : name).split(/[\\/]/).pop();
  const cleaned = base.replace(/[^\p{L}\p{N} ._()+-]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, MAX_FILE_NAME);
  return cleaned || '_';
}

// The environment of a run: the fixed Windows variables plus VEX_EVENT (and VEX_FILE_NAME for a download).
function buildEnv(event, data, baseEnv) {
  const env = {};
  for (const key of ENV_PASS) if (typeof baseEnv[key] === 'string') env[key] = baseEnv[key];
  env.VEX_EVENT = event;
  if (event === 'download-finished') env.VEX_FILE_NAME = sanitizeFileName(data && data.fileName);
  return env;
}

// A download from a private window, a Tor tab or a routed tab never starts the hook.
function quietPartition(partition, ephemeral) {
  if (ephemeral) return true;
  const p = String(partition || '');
  return !p.startsWith('persist:') || /^persist:(?:route-|container-tor-)/.test(p);
}

// What the person may put as arguments: a short list of plain text (no NUL, no line break).
function checkArgs(args) {
  if (args == null) return [];
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw new Error('Arguments are a list of at most ' + MAX_ARGS + ' words');
  for (const a of args) {
    if (typeof a !== 'string' || a.length > MAX_ARG_CHARS || /[\u0000\r\n]/.test(a)) throw new Error('An argument is plain text of at most ' + MAX_ARG_CHARS + ' characters, on one line');
  }
  return args.slice();
}

const shortHash = (h) => String(h || '').slice(0, 16);

function createOsHook({
  fs, path = nodePath, platform = process.platform, env = process.env, spawn, hashFile, confirm, pickProgramDialog,
  load, save, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, randomId = () => require('crypto').randomBytes(8).toString('hex'),
  tmpDir = require('os').tmpdir(), timeoutMs = DEFAULT_TIMEOUT_MS, log = (m) => console.error(m),
}) {
  for (const [n, f] of Object.entries({ fs, spawn, hashFile, confirm, pickProgramDialog, load, save })) if (!f) throw new Error('createOsHook needs ' + n);
  const win = platform === 'win32';
  let config = null;                       // { v, enabled, rules: { [event]: { program, sha256, args } } }
  let grant = null;                        // { token, program, at }
  let running = false;
  const lastStart = new Map();             // event -> time of its last run
  const lastRun = new Map();               // event -> { at, code, signal, timedOut, error, output }
  const declinedHash = new Map();          // event -> the changed hash the person said no to this session
  let asking = false;

  async function cfg() {
    if (config) return config;
    const raw = await load();
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rules = {};
    for (const event of EVENTS) {
      const r = c.rules && c.rules[event];
      if (r && typeof r.program === 'string' && /^[0-9a-f]{64}$/.test(r.sha256 || '')) {
        try { rules[event] = { program: r.program, sha256: r.sha256, args: checkArgs(r.args) }; }
        catch (err) { log('[OsHook] a saved rule for ' + event + ' was dropped: ' + err.message); }
      }
    }
    config = { v: 1, enabled: c.enabled === true, rules };
    return config;
  }
  const persist = async () => { await save(config); };

  function checkProgram(file) {
    const p = String(file || '');
    if (!path.isAbsolute(p)) throw new Error('Choose the program in the file dialog');
    const base = path.basename(p).toLowerCase();
    const stem = base.replace(/\.[^.]*$/, '');
    if (win && !base.endsWith('.exe')) throw new Error('Choose an .exe program (a script needs a shell, which Vex never uses)');
    if (FORBIDDEN_PROGRAMS.has(stem)) throw new Error(stem + ' is a shell or script host, which Vex will not start');
    return p;
  }

  async function status() {
    const c = await cfg();
    return {
      enabled: c.enabled,
      events: EVENTS.map((event) => {
        const r = c.rules[event];
        const last = lastRun.get(event) || null;
        return { event, label: EVENT_LABEL[event], windowEvent: WINDOW_EVENTS.includes(event), rule: r ? { program: r.program, args: r.args.slice(), sha256: shortHash(r.sha256) } : null, last };
      }),
    };
  }

  async function setEnabled(on) {
    const c = await cfg();
    if (on !== true) { c.enabled = false; await persist(); return status(); }
    if (c.enabled) return status();
    const yes = await confirm({
      title: 'Run a program when something happens in Vex?',
      message: 'Vex will be allowed to start the programs you choose, one per event, when that event happens (a download finishes, a reminder fires, exam mode is armed, a CI run goes red). Each program is picked by you, started with the arguments you type and no shell, and told only the event name and, for a download, the file name. It never runs for private or Tor windows, and it is not started if its file has changed since you approved it. You can turn this off at any time.',
      okLabel: 'Turn on',
    });
    if (!yes) return { ...(await status()), canceled: true };
    c.enabled = true;
    await persist();
    return status();
  }

  // A program picked in a system dialog that main opens. Returns a one-use token for add().
  async function pickProgram() {
    const c = await cfg();
    if (!c.enabled) throw new Error('Switch the program hook on first');
    const r = await pickProgramDialog();
    if (!r || r.canceled || !r.path) return { canceled: true };
    const program = checkProgram(r.path);
    const st = await fs.promises.stat(program);
    if (!st.isFile()) throw new Error('That is not a file');
    grant = { token: randomId(), program, at: now() };
    return { canceled: false, token: grant.token, program };
  }

  async function add({ event, token, args }) {
    const c = await cfg();
    if (!c.enabled) throw new Error('Switch the program hook on first');
    if (!EVENTS.includes(event)) throw new Error('That is not an event Vex can run a program for');
    const list = checkArgs(args);
    if (!grant || grant.token !== token || now() - grant.at > GRANT_MS) { grant = null; throw new Error('Choose the program again'); }
    const program = grant.program;
    grant = null;
    checkProgram(program);
    const h = await hashFile(program);
    const yes = await confirm({
      title: 'Allow this program to run when this happens?',
      message: 'Event: ' + EVENT_LABEL[event] + '\nProgram: ' + program + '\nSHA-256: ' + h.sha256 + '\nArguments: ' + (list.length ? list.join(' | ') : '(none)')
        + '\n\nVex starts exactly this file with exactly these arguments, with no shell. It is given the event name' + (event === 'download-finished' ? ' and the file name' : '') + ' as environment variables only. It never runs for private or Tor windows. If the file changes, Vex asks again before running it.',
      okLabel: 'Allow',
    });
    if (!yes) return { ...(await status()), canceled: true };
    c.rules[event] = { program, sha256: h.sha256, args: list };
    declinedHash.delete(event);
    await persist();
    return status();
  }

  async function remove(event) {
    const c = await cfg();
    if (!EVENTS.includes(event)) throw new Error('That is not an event Vex can run a program for');
    delete c.rules[event];
    lastRun.delete(event);
    await persist();
    return status();
  }

  // The event happened. Resolves to { ran, why } when the run is over (main does not wait for it).
  async function fire(event, data = {}) {
    if (!EVENTS.includes(event)) return { ran: false, why: 'unknown-event' };
    const c = await cfg();
    if (!c.enabled) return { ran: false, why: 'off' };
    const rule = c.rules[event];
    if (!rule) return { ran: false, why: 'no-rule' };
    // A download must say where it came from; one that does not is treated as private (fail closed).
    const hasOrigin = data.partition !== undefined || data.ephemeral !== undefined;
    if ((event === 'download-finished' || hasOrigin) && quietPartition(data.partition, data.ephemeral)) return { ran: false, why: 'private' };
    if (running || asking) return { ran: false, why: 'busy' };
    const t = now();
    if (lastStart.has(event) && t - lastStart.get(event) < COOLDOWN_MS) return { ran: false, why: 'cooldown' };
    running = true;
    lastStart.set(event, t);
    try {
      // The file as it is now against the file the person approved.
      let h;
      try { checkProgram(rule.program); h = await hashFile(rule.program); }
      catch (err) { lastRun.set(event, { at: t, error: 'The program could not be checked: ' + err.message }); log('[OsHook] ' + event + ': the program could not be checked: ' + err.message); return { ran: false, why: 'unreadable' }; }
      if (h.sha256 !== rule.sha256) {
        if (declinedHash.get(event) === h.sha256) return { ran: false, why: 'changed' };
        asking = true;
        let yes = false;
        try {
          yes = await confirm({
            title: 'The program for this event has changed',
            message: 'Event: ' + EVENT_LABEL[event] + '\nProgram: ' + rule.program + '\nApproved: ' + rule.sha256 + '\nNow: ' + h.sha256 + '\n\nVex has not started it. Start it and trust this version from now on?',
            okLabel: 'Run and trust',
          });
        } finally { asking = false; }
        if (!yes) { declinedHash.set(event, h.sha256); lastRun.set(event, { at: t, error: 'The program changed and was not run' }); return { ran: false, why: 'changed' }; }
        rule.sha256 = h.sha256;
        await persist();
      }
      return await run(event, rule, data, t);
    } finally { running = false; }
  }

  function run(event, rule, data, startedAt) {
    return new Promise((resolve) => {
      let child;
      const record = (patch) => { lastRun.set(event, { at: startedAt, ...patch }); };
      try {
        child = spawn(rule.program, rule.args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: buildEnv(event, data, env), cwd: tmpDir });
      } catch (err) { record({ error: err.message }); log('[OsHook] ' + event + ': could not start: ' + err.message); resolve({ ran: false, why: 'spawn-failed' }); return; }
      let output = '';
      let timedOut = false;
      let done = false;
      const take = (chunk) => { if (output.length < MAX_OUTPUT) output += String(chunk).slice(0, MAX_OUTPUT - output.length); };
      if (child.stdout) child.stdout.on('data', take);
      if (child.stderr) child.stderr.on('data', take);
      let giveUp = null;
      const timer = setTimer(() => {
        timedOut = true;
        try { child.kill(); } catch (err) { log('[OsHook] could not end ' + rule.program + ': ' + err.message); }
        // A program that will not end must not block the next run for ever.
        giveUp = setTimer(() => finish({ error: 'The program did not end after it was told to stop' }, 'timeout'), KILL_GRACE_MS);
      }, timeoutMs);
      const finish = (patch, why) => { if (done) return; done = true; clearTimer(timer); if (giveUp) clearTimer(giveUp); record({ output, timedOut, ...patch }); resolve({ ran: true, why }); };
      child.on('error', (err) => { log('[OsHook] ' + event + ': ' + err.message); finish({ error: err.message }, 'error'); });
      child.on('close', (code, signal) => finish({ code, signal: signal || null }, timedOut ? 'timeout' : 'done'));
    });
  }

  return { status, setEnabled, pickProgram, add, remove, fire };
}

// SHA-256 of a file, read as a stream so a big program is never held in memory. Over the size limit it is refused,
// not hashed in part. `fs` and `crypto` are injected for tests.
function createFileHasher({ fs, crypto = require('crypto'), maxBytes = MAX_HASH_BYTES }) {
  return async function hashFile(file) {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) throw new Error('It is not a file');
    if (st.size > maxBytes) throw new Error('It is too large to check (over ' + Math.round(maxBytes / 1048576) + ' MB)');
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const stream = fs.createReadStream(file);
      stream.on('data', (chunk) => h.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve({ sha256: h.digest('hex'), size: st.size }));
    });
  };
}

function registerOsHookIpc({ ipcMain, hook }) {
  const reply = async (fn) => { try { return { ok: true, ...(await fn()) }; } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; } };
  ipcMain.handle('oshook:status', () => reply(() => hook.status()));
  ipcMain.handle('oshook:set-enabled', (_e, on) => reply(() => hook.setEnabled(on === true)));
  ipcMain.handle('oshook:pick-program', () => reply(() => hook.pickProgram()));
  ipcMain.handle('oshook:add', (_e, req) => reply(() => hook.add({ event: req && req.event, token: req && req.token, args: req && req.args })));
  ipcMain.handle('oshook:remove', (_e, event) => reply(() => hook.remove(event)));
  // The window can only report the two events that start there; it cannot name a file or a program.
  ipcMain.handle('oshook:event', (_e, req) => reply(async () => {
    if (!req || !WINDOW_EVENTS.includes(req.event)) throw new Error('That event is not one a window can report');
    hook.fire(req.event, {}).catch((err) => console.error('[OsHook] a run failed:', err && err.message));
    return {};
  }));
}

module.exports = { createOsHook, createFileHasher, registerOsHookIpc, sanitizeFileName, buildEnv, quietPartition, checkArgs, EVENTS, WINDOW_EVENTS, EVENT_LABEL, FORBIDDEN_PROGRAMS, MAX_OUTPUT, COOLDOWN_MS, KILL_GRACE_MS, ENV_PASS, MAX_HASH_BYTES };
