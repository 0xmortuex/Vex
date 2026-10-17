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
// Wave 6 adds two things, both inside the same rules (armed, main-raised confirms, shell:false,
// verified stop, never started by itself):
//   - the owner's OWN ALLOWLIST: an entry is a name, ONE program picked in a system file dialog that
//     main opens (never typed, never sent by a window), the arguments the owner typed once (fixed from
//     then on), and the working folder from the folder dialog. The exact command is shown in a main
//     confirm when it is added and at the first start of every session. Shells and script hosts
//     (cmd, powershell, wscript, mshta, rundll32 ...) are refused: for scripts use the node/python
//     templates, which run the script file itself.
//   - QEMU recipes as FIXED templates (qemu-vm): main builds every argument from checked fields (a disk
//     image and an optional ISO inside the folder, memory, cpus, acceleration, display, network none/user).
//     There is no field for -monitor, -serial, -chardev, -kernel, hostfwd, vnc or a raw option.
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
// The owner's allowlist entries: free words he typed himself, still never a shell.
const MAX_CUSTOM_ARGS = 16;
const MAX_CUSTOM_ARG_CHARS = 200;
const FORBIDDEN_PROGRAMS = new Set(['cmd', 'powershell', 'pwsh', 'powershell_ise', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'msiexec', 'wmic', 'forfiles', 'bitsadmin', 'certutil', 'bash', 'wsl', 'sh', 'conhost', 'schtasks', 'at']);
const QEMU_DISK_EXT = { '.qcow2': 'qcow2', '.img': 'raw', '.raw': 'raw', '.vdi': 'vdi', '.vhd': 'vpc', '.vhdx': 'vhdx' };

const CUSTOM = 'custom';
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
    label: 'uv run <tool> [words]', exe: 'uv', fields: ['args'], needArgs: true,
    // `uv run cmd /c ...` would make uv a general launcher: the first word is one of a few Python tools,
    // and no word has a path or drive character.
    firstWords: ['python', 'pytest', 'ruff', 'mypy', 'black', 'flake8'],
    argRe: /^[A-Za-z0-9_.=@-]{1,80}$/,
    build: (p) => ['run', ...p.args],
  },
  // A virtual machine from a disk image in the folder. Every argument is built here from checked fields.
  'qemu-vm': {
    label: 'QEMU virtual machine (disk image in the folder)', exe: 'qemu-system-x86_64', fields: ['vmname', 'disk', 'iso', 'memory', 'cpus', 'accel', 'display', 'net'],
    exeDirs: (env) => (env.ProgramFiles ? [nodePath.join(env.ProgramFiles, 'qemu')] : []),
    build: (p) => {
      const argv = ['-name', p.vmname, '-m', String(p.memory), '-smp', String(p.cpus), '-accel', p.accel, '-display', p.display, '-monitor', 'none',
        '-drive', 'file=' + p.disk + ',format=' + QEMU_DISK_EXT[nodePath.extname(p.disk).toLowerCase()] + ',if=virtio'];
      if (p.iso) argv.push('-cdrom', p.iso, '-boot', 'd');
      argv.push('-nic', p.net === 'user' ? 'user,model=virtio-net-pci' : 'none');
      return argv;
    },
  },
};

const quoteForDisplay = (s) => (/[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s);
const displayCommand = (exe, argv) => [exe, ...argv].map(quoteForDisplay).join(' ');

function createLocalServices({
  fs, path = nodePath, platform = process.platform, env = process.env,
  spawn, inspect, killTree, knock, confirm, load, save,
  now = () => Date.now(), randomId = () => require('crypto').randomBytes(8).toString('hex'),
  pickFolderDialog, pickProgramDialog, log = () => {},
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
  let programGrant = null;               // { token, program, at }: a program the owner picked in a dialog main opened

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
      const wordRe = t.argRe || ARG_RE;
      for (const a of raw) if (typeof a !== 'string' || !wordRe.test(a)) throw new Error('"' + String(a).slice(0, 30) + '" has a character that is not allowed (words only, no spaces or quotes)');
      if (t.needArgs && !raw.length) throw new Error('Type what to run after the command');
      if (t.firstWords && raw.length && !t.firstWords.includes(raw[0])) throw new Error('The first word must be one of: ' + t.firstWords.join(', '));
      out.args = raw.slice();
    }
    if (t.fields.includes('vmname')) {
      const n = String(p.vmname == null ? '' : p.vmname).trim();
      if (!NAME_RE.test(n)) throw new Error('Give the machine a short name of letters, digits, spaces and . _ -');
      out.vmname = n;
    }
    if (t.fields.includes('disk')) out.disk = insideFolderFile(folder, p.disk, /\.(?:qcow2|img|raw|vdi|vhd|vhdx)$/i, 'The disk image', true);
    if (t.fields.includes('iso')) {
      const has = String(p.iso == null ? '' : p.iso).trim();
      if (has) out.iso = insideFolderFile(folder, has, /\.iso$/i, 'The ISO', true);
    }
    const whole = (key, label, lo, hi, dflt) => {
      const raw = p[key] == null || String(p[key]).trim() === '' ? dflt : Number(String(p[key]).trim());
      if (!Number.isInteger(raw) || raw < lo || raw > hi) throw new Error(label + ' is a whole number from ' + lo + ' to ' + hi);
      return raw;
    };
    const choice = (key, label, options, dflt) => {
      const v = p[key] == null || String(p[key]).trim() === '' ? dflt : String(p[key]).trim().toLowerCase();
      if (!options.includes(v)) throw new Error(label + ' is one of: ' + options.join(', '));
      return v;
    };
    if (t.fields.includes('memory')) out.memory = whole('memory', 'Memory in MB', 256, 65536, 2048);
    if (t.fields.includes('cpus')) out.cpus = whole('cpus', 'The number of processors', 1, 32, 2);
    if (t.fields.includes('accel')) out.accel = choice('accel', 'Acceleration', ['whpx', 'tcg'], 'whpx');
    if (t.fields.includes('display')) out.display = choice('display', 'Display', ['gtk', 'sdl'], 'gtk');
    if (t.fields.includes('net')) out.net = choice('net', 'Network', ['none', 'user'], 'none');
    return out;
  }

  // A file named inside the granted folder, as a relative path with forward slashes: the checks every "file" field shares.
  function insideFolderFile(folder, value, extRe, what, required) {
    const f = String(value == null ? '' : value).trim().replace(/\\/g, '/');
    if (!f) { if (required) throw new Error(what + ' is needed'); return ''; }
    if (f.length > 120 || f.startsWith('/') || /^[A-Za-z]:/.test(f) || f.split('/').some(seg => seg === '..' || seg === '' || seg === '.')) throw new Error('Name ' + what.toLowerCase() + ' as a path inside the folder, like disk.qcow2 or images/disk.qcow2');
    if (!extRe.test(f)) throw new Error(what + ' is not the kind of file this command uses');
    if (!/^[A-Za-z0-9_./ -]+$/.test(f)) throw new Error('The path of ' + what.toLowerCase() + ' has a character that is not allowed');
    let real;
    try { real = fs.realpathSync(path.resolve(folder, f)); } catch { throw new Error(f + ' is not in that folder'); }
    if (!insideRoot(folder, norm(real)) || !fs.statSync(real).isFile()) throw new Error(f + ' is not a file inside that folder');
    return f;
  }

  // The owner's own entry: a program he picked and words he typed. Checked again every time it is built.
  function cleanCustomArgs(args) {
    if (!Array.isArray(args)) throw new Error('The arguments are a list of words');
    if (args.length > MAX_CUSTOM_ARGS) throw new Error('At most ' + MAX_CUSTOM_ARGS + ' arguments');
    return args.map((a) => {
      if (typeof a !== 'string' || !a || a.length > MAX_CUSTOM_ARG_CHARS) throw new Error('Each argument is 1 to ' + MAX_CUSTOM_ARG_CHARS + ' characters');
      if (/["\r\n\0]/.test(a)) throw new Error('An argument cannot hold a quote mark or a line break (' + JSON.stringify(a.slice(0, 20)) + ')');
      return a;
    });
  }
  function checkProgram(file) {
    const f = String(file == null ? '' : file);
    if (!path.isAbsolute(f)) throw new Error('The program must be a full path chosen in the dialog');
    let real;
    try { real = fs.realpathSync(f); } catch { throw new Error('The program is not there any more: ' + f); }
    if (!fs.statSync(real).isFile()) throw new Error('The program is not a file');
    const ext = path.extname(real).toLowerCase();
    if (winPath && ext !== '.exe') throw new Error('Only a .exe program can be added. For a script, use the node or python command with the script itself.');
    const base = path.basename(real, ext).toLowerCase();
    if (FORBIDDEN_PROGRAMS.has(base)) throw new Error(path.basename(real) + ' runs whatever it is told, so it is not allowed here. Add the actual program, or use the node or python command for a script.');
    return norm(real);
  }

  // PATH, looked at by main: only absolute folders, never the granted folder
  // (a clone could hold a program of the same name).
  function pathDirs(folder) {
    const sep = winPath ? ';' : ':';
    const dirs = String(env.PATH || env.Path || '').split(sep).map(d => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
    return dirs.filter(d => path.isAbsolute(d) && !insideRoot(folder, norm(d)));
  }

  function findOnPath(name, folder, exts, extraDirs = []) {
    const fixed = extraDirs.filter(d => path.isAbsolute(d) && !insideRoot(folder, norm(d)));
    for (const dir of [...pathDirs(folder), ...fixed]) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* vex-allow-empty-catch: a name that is not in this PATH folder is the normal case; the next folder is tried */ }
      }
    }
    return '';
  }

  // The file to start and the argument array for it.
  function resolveProgram(exeName, argv, folder, extraDirs = []) {
    if (!winPath) {
      const found = findOnPath(exeName, folder, [''], extraDirs);
      if (!found) throw new Error(exeName + ' was not found on this computer\'s PATH');
      return { file: found, argv };
    }
    const found = findOnPath(exeName, folder, ['.exe', '.com', '.cmd', '.bat'], extraDirs);
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
    const port = service.port == null || service.port === '' ? 0 : Number(service.port);
    if (port && !isPort(port)) throw new Error('A port is a number from 1024 to 65535');
    if (service.template === CUSTOM) {
      const file = checkProgram(service.program);
      const argv = cleanCustomArgs(service.args);
      return { folder, params: {}, port, shown: displayCommand(file, argv), file, runArgv: argv };
    }
    const params = cleanParams(service.template, service.params, folder);
    const t = TEMPLATES[service.template];
    const argv = t.build(params, port);
    const program = resolveProgram(t.exe, argv, folder, typeof t.exeDirs === 'function' ? t.exeDirs(env) : []);
    return { folder, params, port, shown: displayCommand(t.exe, argv), file: program.file, runArgv: program.argv };
  }

  const publicOf = async (s) => {
    const r = running.get(s.id);
    const ex = lastExit.get(s.id) || null;
    let shown;
    try {
      shown = s.template === CUSTOM ? displayCommand(s.program, s.args || []) : displayCommand(TEMPLATES[s.template].exe, TEMPLATES[s.template].build(s.params || {}, s.port || 0));
    } catch { shown = '(this entry is not valid any more)'; }   // vex-allow-empty-catch: the entry is shown as invalid, and Start refuses it with the real reason
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

  // The system file dialog for ONE program; the answer is held here for one addCustom(). The window never names a program.
  async function pickProgram() {
    const c = await cfg();
    if (!c.armed) throw new Error('Allow local services first');
    if (typeof pickProgramDialog !== 'function') throw new Error('createLocalServices needs pickProgramDialog');
    const r = await pickProgramDialog();
    if (!r || r.canceled || !r.path) return { canceled: true };
    const program = checkProgram(r.path);
    programGrant = { token: randomId(), program, at: now() };
    return { ok: true, token: programGrant.token, program };
  }

  // An entry of the owner's own allowlist: the program from pickProgram(), the folder from pickFolder(), and the arguments he typed.
  async function addCustom({ name, token, programToken, args, port }) {
    const c = await cfg();
    if (!c.armed) throw new Error('Allow local services first');
    if (!grant || grant.token !== token || now() - grant.at > GRANT_MS) throw new Error('Choose the folder again (the choice is good for five minutes, once)');
    if (!programGrant || programGrant.token !== programToken || now() - programGrant.at > GRANT_MS) throw new Error('Choose the program again (the choice is good for five minutes, once)');
    const folder = grant.folder; const program = programGrant.program;
    grant = null; programGrant = null;
    const label = String(name == null ? '' : name).trim();
    if (!NAME_RE.test(label)) throw new Error('Give it a short name of letters, digits, spaces and . _ -');
    if (c.services.length >= MAX_SERVICES) throw new Error('At most ' + MAX_SERVICES + ' services');
    if (c.services.some(s => s.name.toLowerCase() === label.toLowerCase())) throw new Error('There is already a service called ' + label);
    const service = { id: 'svc_' + randomId(), name: label, folder, template: CUSTOM, program, args: cleanCustomArgs(args == null ? [] : args), port: port == null || port === '' ? 0 : Number(port), createdAt: now() };
    const b = build(service);
    const yes = await confirm({
      title: 'Add "' + label + '" to your own list of programs?',
      message: 'Vex will run exactly this, with no shell:\n\n' + b.shown + '\n\nin the folder:\n' + b.folder + '\n\nThe arguments are fixed from now on. It is started only when you press Start, and the exact command is shown again the first time in each session.',
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

  return { status, arm, pickFolder, pickProgram, add, addCustom, remove, start, stop, stopAll, logs, TEMPLATES, _build: build, isRunning: (id) => running.has(id), hasRunning: () => running.size > 0 };
}

module.exports = { createLocalServices, TEMPLATES, displayCommand, ARG_RE, SCRIPT_NAME_RE, MAX_SERVICES };
