// === Local-service launcher (T3-033) =========================================
//
// Starts and stops the dev servers the owner names, and ONLY those. The threat
// model is in docs/local-services-threat-model.md; the short version:
//
//   - Off until the owner arms it, with a confirm box that main itself shows
//     (a window script cannot press it).
//   - Nothing is ever started by itself, on a schedule, by a page, an
//     extension or the AI: only the IPC channels in main.js reach this, and
//     they are for Vex's own window.
//   - The owner picks a folder with the system folder dialog (a one-use grant
//     held here), chooses ONE of a fixed set of command templates and types its
//     few words once. Main builds the argument array itself, shows the exact
//     program, arguments and folder in a confirm box, and saves only after a
//     yes. The window never supplies a program name or a path.
//   - A program is started with spawn(file, argv[], { shell: false, cwd }) and
//     never through a shell. The working folder is the granted folder. The
//     program is looked up on PATH by main, never in the working folder, and
//     a .cmd shim is followed to the node script it runs (a shell is never used
//     for it either).
//   - The first start of each service in a Vex session shows the exact
//     program and arguments again.
//   - Stop only ever touches a process this module started and still holds:
//     its live ExecutablePath, CommandLine and start time are checked against
//     what was started before it is ended.
//
// Everything outside is injected, so it runs under test without starting a
// process.

const nodePath = require('path');

const MAX_SERVICES = 8;
const LOG_LINES = 200;
const LOG_LINE_CHARS = 400;
const GRANT_MS = 5 * 60 * 1000;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,39}$/;
// One word of arguments after a script: no space, quote or shell character.
const ARG_RE = /^[A-Za-z0-9_.:=@\\/-]{1,80}$/;
const MAX_ARGS = 6;

const isPort = (n) => Number.isInteger(n) && n >= 1024 && n <= 65535;

// The fixed set. Each template names its program and builds the argument array
// from checked words; there is no template that takes a program or a free line.
const TEMPLATES = {
  'pnpm-script': {
    label: 'pnpm run <script>', exe: 'pnpm', fields: ['script'],
    build: (p) => ['run', p.script],
  },
  'npm-script': {
    label: 'npm run <script>', exe: 'npm', fields: ['script'],
    build: (p) => ['run', p.script],
  },
  'wrangler-dev': {
    label: 'wrangler dev', exe: 'wrangler', fields: [],
    build: (p, port) => ['dev', ...(port ? ['--port', String(port)] : [])],
  },
  'python-script': {
    label: 'python <script.py> [words]', exe: 'python', fields: ['file', 'args'], fileExt: /\.py$/i,
    build: (p) => [p.file, ...p.args],
  },
  'node-script': {
    label: 'node <script.js> [words]', exe: 'node', fields: ['file', 'args'], fileExt: /\.(?:c|m)?js$/i,
    build: (p) => [p.file, ...p.args],
  },
  'uv-run': {
    label: 'uv run <words>', exe: 'uv', fields: ['args'], needArgs: true,
    build: (p) => ['run', ...p.args],
  },
};

const quoteForDisplay = (s) => (/[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s);
const displayCommand = (exe, argv) => [exe, ...argv].map(quoteForDisplay).join(' ');

function createLocalServices({
  fs, path = nodePath, platform = process.platform, env = process.env,
  spawn, inspect, killTree, knock, confirm, load, save,
  now = () => Date.now(), randomId = () => require('crypto').randomBytes(8).toString('hex'),
  pickFolderDialog, log = () => {},
}) {
  for (const [n, f] of Object.entries({ fs, spawn, inspect, killTree, knock, confirm, load, save, pickFolderDialog })) {
    if (!f) throw new Error('createLocalServices needs ' + n);
  }
  const winPath = platform === 'win32';
  const sameFile = (a, b) => (winPath ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);
  const norm = (p) => path.resolve(String(p));

  let config = null;                     // { v, armed, services: [] }
  const running = new Map();             // service id -> { child, pid, exe, argv, cwd, startedAt, logs, exit }
  const lastExit = new Map();            // service id -> { code, signal, at, error }
  const confirmedThisSession = new Set();
  let grant = null;                      // { token, folder, at }

  // ---- storage -----------------------------------------------------------------
  async function cfg() {
    if (config) return config;
    const raw = await load();
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    config = { v: 1, armed: c.armed === true, services: Array.isArray(c.services) ? c.services.filter(s => s && typeof s.id === 'string') : [] };
    return config;
  }
  const persist = async () => { await save(config); };

  // ---- helpers -----------------------------------------------------------------
  function insideRoot(root, target) {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  // The granted folder, as the system names it (symlinks followed), still a folder.
  function realFolder(folder) {
    let real;
    try { real = fs.realpathSync(String(folder)); } catch { throw new Error('The folder is not there any more. Choose it again.'); }
    if (!fs.statSync(real).isDirectory()) throw new Error('That is not a folder');
    return norm(real);
  }

  function cleanParams(templateId, params, folder) {
    const t = TEMPLATES[templateId];
    if (!t) throw new Error('That is not one of the commands Vex can start');
    const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
    const out = {};
    if (t.fields.includes('script')) {
      const s = String(p.script == null ? '' : p.script).trim();
      if (!SCRIPT_NAME_RE.test(s)) throw new Error('A script name is letters, digits, : _ . and - (for example dev)');
      out.script = s;
    }
    if (t.fields.includes('file')) {
      const f = String(p.file == null ? '' : p.file).trim().replace(/\\/g, '/');
      if (!f || f.length > 120 || f.startsWith('/') || /^[A-Za-z]:/.test(f) || f.split('/').some(seg => seg === '..' || seg === '' || seg === '.')) throw new Error('Name the script as a path inside the folder, like manage.py or src/server.js');
      if (!t.fileExt.test(f)) throw new Error('That is not the kind of file this command runs');
      if (!/^[A-Za-z0-9_./ -]+$/.test(f)) throw new Error('The script path has a character that is not allowed');
      const abs = path.resolve(folder, f);
      let real;
      try { real = fs.realpathSync(abs); } catch { throw new Error(f + ' is not in that folder'); }
      if (!insideRoot(folder, norm(real)) || !fs.statSync(real).isFile()) throw new Error(f + ' is not a file inside that folder');
      out.file = f;
    }
    if (t.fields.includes('args')) {
      const raw = Array.isArray(p.args) ? p.args : String(p.args == null ? '' : p.args).split(/\s+/).filter(Boolean);
      if (raw.length > MAX_ARGS) throw new Error('At most ' + MAX_ARGS + ' words after the command');
      for (const a of raw) if (typeof a !== 'string' || !ARG_RE.test(a)) throw new Error('"' + String(a).slice(0, 30) + '" has a character that is not allowed (words only, no spaces or quotes)');
      if (t.needArgs && !raw.length) throw new Error('Type what to run after the command');
      out.args = raw.slice();
    }
    return out;
  }

  // PATH, looked at by main: only absolute folders, never the granted folder
  // (a clone could hold a program of the same name).
  function pathDirs(folder) {
    const sep = winPath ? ';' : ':';
    const dirs = String(env.PATH || env.Path || '').split(sep).map(d => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
    return dirs.filter(d => path.isAbsolute(d) && !insideRoot(folder, norm(d)));
  }

  function findOnPath(name, folder, exts) {
    for (const dir of pathDirs(folder)) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* vex-allow-empty-catch: a name that is not in this PATH folder is the normal case; the next folder is tried */ }
      }
    }
    return '';
  }

  // The file to start and the argument array for it.
  function resolveProgram(exeName, argv, folder) {
    if (!winPath) {
      const found = findOnPath(exeName, folder, ['']);
      if (!found) throw new Error(exeName + ' was not found on this computer\'s PATH');
      return { file: found, argv };
    }
    const found = findOnPath(exeName, folder, ['.exe', '.com', '.cmd', '.bat']);
    if (!found) throw new Error(exeName + ' was not found on this computer\'s PATH');
    const ext = path.extname(found).toLowerCase();
    if (ext === '.exe' || ext === '.com') return { file: found, argv };
    if (ext === '.cmd') {
      // The npm-style shim names the node script it runs; Vex runs that script with node.exe itself.
      let text;
      try { text = fs.readFileSync(found, 'utf8').slice(0, 20000); } catch (err) { throw new Error(exeName + ' could not be read: ' + err.message, { cause: err }); }
      const m = /"%(?:~dp0|dp0)%?\\([^"%\r\n]+\.(?:c|m)?js)"/i.exec(text);
      if (m) {
        const script = path.resolve(path.dirname(found), m[1]);
        let ok;
        try { ok = insideRoot(path.dirname(found), script) && fs.statSync(script).isFile(); } catch { ok = false; }
        if (ok) {
          const near = path.join(path.dirname(found), 'node.exe');
          let nodeFile = '';
          try { if (fs.statSync(near).isFile()) nodeFile = near; } catch { nodeFile = ''; }
          nodeFile = nodeFile || findOnPath('node', folder, ['.exe']);
          if (!nodeFile) throw new Error('node.exe was not found, which ' + exeName + ' needs');
          return { file: nodeFile, argv: [script, ...argv] };
        }
      }
    }
    throw new Error(exeName + ' on this computer is a ' + ext + ' file, and Vex never starts programs through a shell. Install the standalone ' + exeName + '.exe, or use the node or python command with the script itself.');
  }

  // template + params + folder -> everything needed to show and start it.
  function build(service) {
    const folder = realFolder(service.folder);
    const params = cleanParams(service.template, service.params, folder);
    const t = TEMPLATES[service.template];
    const port = service.port == null || service.port === '' ? 0 : Number(service.port);
    if (port && !isPort(port)) throw new Error('A port is a number from 1024 to 65535');
    const argv = t.build(params, port);
    const program = resolveProgram(t.exe, argv, folder);
    return { folder, params, port, shown: displayCommand(t.exe, argv), file: program.file, runArgv: program.argv };
  }

  const publicOf = async (s) => {
    const r = running.get(s.id);
    const ex = lastExit.get(s.id) || null;
    let shown;
    try { shown = displayCommand(TEMPLATES[s.template].exe, TEMPLATES[s.template].build(s.params || {}, s.port || 0)); } catch { shown = '(this entry is not valid any more)'; }
    return {
      id: s.id, name: s.name, folder: s.folder, template: s.template, command: shown, port: s.port || 0,
      state: r ? 'running' : 'stopped', pid: r ? r.pid : 0, startedAt: r ? r.startedAt : 0,
      listening: r && s.port ? await knock(s.port) : false,
      exit: ex,
    };
  };

  // ---- the owner's side --------------------------------------------------------
  async function status() {
    const c = await cfg();
    return {
      supported: winPath, armed: c.armed,
      templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, fields: t.fields.slice() })),
      services: await Promise.all(c.services.map(publicOf)),
    };
  }

  async function arm(on) {
    const c = await cfg();
    if (!on) { c.armed = false; await persist(); return { armed: false }; }
    if (!winPath) throw new Error('Local services can be started on Windows only');
    const yes = await confirm({
      title: 'Allow Vex to start programs?',
      message: 'Vex may start and stop the dev servers you list here: only the commands you add yourself, each in the folder you choose, and never by itself or for a web page. You are shown the exact program and arguments before anything is saved or started.',
      okLabel: 'Allow',
    });
    if (!yes) return { armed: c.armed };
    c.armed = true;
    await persist();
    return { armed: true };
  }

  // The system folder dialog; the path it returns is held here for one add().
  async function pickFolder() {
    const c = await cfg();
    if (!c.armed) throw new Error('Allow local services first');
    const r = await pickFolderDialog();
    if (!r || r.canceled || !r.path) return { canceled: true };
    const folder = realFolder(r.path);
    grant = { token: randomId(), folder, at: now() };
    return { ok: true, token: grant.token, folder };
  }

  async function add({ name, token, template, params, port }) {
    const c = await cfg();
    if (!c.armed) throw new Error('Allow local services first');
    if (!grant || grant.token !== token || now() - grant.at > GRANT_MS) throw new Error('Choose the folder again (the choice is good for five minutes, once)');
    const folder = grant.folder;
    grant = null;
    const label = String(name == null ? '' : name).trim();
    if (!NAME_RE.test(label)) throw new Error('Give it a short name of letters, digits, spaces and . _ -');
    if (c.services.length >= MAX_SERVICES) throw new Error('At most ' + MAX_SERVICES + ' services');
    if (c.services.some(s => s.name.toLowerCase() === label.toLowerCase())) throw new Error('There is already a service called ' + label);
    const service = { id: 'svc_' + randomId(), name: label, folder, template: String(template || ''), params: cleanParams(String(template || ''), params, folder), port: port == null || port === '' ? 0 : Number(port), createdAt: now() };
    const b = build(service);
    const yes = await confirm({
      title: 'Add "' + label + '" to your local services?',
      message: 'Vex will run exactly this, with no shell:\n\n' + b.shown + '\n\nin the folder:\n' + b.folder + '\n\nProgram: ' + b.file + '\n\nIt is started only when you press Start.',
      okLabel: 'Add',
    });
    if (!yes) return { canceled: true };
    c.services.push(service);
    await persist();
    return { ok: true, id: service.id };
  }

  async function remove(id) {
    const c = await cfg();
    if (running.has(id)) throw new Error('Stop it first');
    const before = c.services.length;
    c.services = c.services.filter(s => s.id !== id);
    if (c.services.length === before) throw new Error('That service is not in the list');
    confirmedThisSession.delete(id);
    lastExit.delete(id);
    await persist();
    return { ok: true };
  }

  async function start(id) {
    const c = await cfg();
    if (!c.armed) throw new Error('Local services are not allowed (switch them on in Settings)');
    const service = c.services.find(s => s.id === id);
    if (!service) throw new Error('That service is not in the list');
    if (running.has(id)) throw new Error(service.name + ' is already running');
    const b = build(service);
    if (!confirmedThisSession.has(id)) {
      const yes = await confirm({
        title: 'Start "' + service.name + '"?',
        message: 'Vex will run exactly this, with no shell:\n\n' + b.shown + '\n\nin the folder:\n' + b.folder + '\n\nProgram: ' + b.file,
        okLabel: 'Start',
      });
      if (!yes) return { canceled: true };
      confirmedThisSession.add(id);
    }
    const cleanEnv = {};
    for (const [k, v] of Object.entries(env)) if (!/^(?:ELECTRON_|VEX_)/i.test(k) && k !== 'NODE_OPTIONS') cleanEnv[k] = v;
    const startedAt = now();
    const entry = { child: null, pid: 0, file: b.file, argv: b.runArgv, cwd: b.folder, startedAt, logs: [], exitInfo: null };
    const child = spawn(b.file, b.runArgv, { shell: false, cwd: b.folder, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv });
    entry.child = child;
    entry.pid = child.pid || 0;
    const pushLogs = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line) continue;
        entry.logs.push(line.slice(0, LOG_LINE_CHARS));
        if (entry.logs.length > LOG_LINES) entry.logs.shift();
      }
    };
    if (child.stdout) child.stdout.on('data', pushLogs);
    if (child.stderr) child.stderr.on('data', pushLogs);
    child.on('error', (err) => {
      lastExit.set(id, { code: null, signal: null, at: now(), error: err.message });
      running.delete(id);
      log('[LocalServices] ' + service.name + ' could not start: ' + err.message);
    });
    child.on('exit', (code, signal) => {
      lastExit.set(id, { code, signal: signal || null, at: now(), error: '' });
      if (running.get(id) === entry) running.delete(id);
    });
    if (!entry.pid) {
      // spawn() reports a program that cannot be started through 'error', which has fired or will.
      const err = (lastExit.get(id) || {}).error;
      throw new Error(err || ('Could not start ' + service.name));
    }
    running.set(id, entry);
    lastExit.delete(id);
    log('[LocalServices] started ' + service.name + ' (pid ' + entry.pid + ')');
    return { ok: true, pid: entry.pid };
  }

  // Ends a process this module started, after checking it is still that process.
  async function verifyAndStop(id, entry) {
    const child = entry.child;
    if (child.exitCode !== null || child.signalCode !== null) { running.delete(id); return { ok: true, already: true }; }
    const live = await inspect(entry.pid);
    if (!live) { running.delete(id); return { ok: true, already: true }; }
    if (!live.executablePath || !sameFile(norm(live.executablePath), norm(entry.file))) throw new Error('Not stopped: process ' + entry.pid + ' is not the program Vex started (' + (live.executablePath || 'unknown') + '), so it was left alone');
    const cmd = String(live.commandLine || '');
    for (const a of entry.argv) if (!cmd.includes(a)) throw new Error('Not stopped: the command line of process ' + entry.pid + ' is not the one Vex started, so it was left alone');
    if (!(Number.isFinite(live.createdMs) && Math.abs(live.createdMs - entry.startedAt) < 60000)) throw new Error('Not stopped: process ' + entry.pid + ' was not started when Vex started this service, so it was left alone');
    await killTree(entry.pid);
    for (let i = 0; i < 50 && running.get(id) === entry; i++) await new Promise(r => setTimeout(r, 100));
    if (running.get(id) === entry) throw new Error('The service did not stop. Close it from where it runs.');
    return { ok: true };
  }

  async function stop(id) {
    const entry = running.get(id);
    if (!entry) throw new Error('That service is not running (Vex only stops what it started)');
    return verifyAndStop(id, entry);
  }

  async function stopAll() {
    const out = [];
    for (const [id, entry] of [...running]) {
      try { out.push({ id, ...(await verifyAndStop(id, entry)) }); }
      catch (err) { out.push({ id, ok: false, error: err.message }); log('[LocalServices] ' + err.message); }
    }
    return out;
  }

  function logs(id) {
    const entry = running.get(id);
    if (entry) return { lines: entry.logs.slice(), running: true };
    return { lines: [], running: false };
  }

  return { status, arm, pickFolder, add, remove, start, stop, stopAll, logs, TEMPLATES, _build: build, isRunning: (id) => running.has(id), hasRunning: () => running.size > 0 };
}

module.exports = { createLocalServices, TEMPLATES, displayCommand, ARG_RE, SCRIPT_NAME_RE, MAX_SERVICES };
