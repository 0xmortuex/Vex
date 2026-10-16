// === Developer desk: open a file or a terminal, from folders you granted ======
//
// Two things the browser cannot do by itself and a developer wants a click for:
//
//   openFile      open the file a stack trace points to, in your editor, at the line
//   openTerminal  open Windows Terminal in a repository's folder
//   branch        read the branch name of a repository (only <folder>/.git/HEAD)
//
// This starts a program, so it is built to be hard to misuse:
//
//   - OFF until you switch it on, and the switch is kept here (not in a window):
//     a page or a compromised window cannot turn it on, only Vex's own window can,
//     through a channel the pages cannot reach.
//   - The programs are an allowlist of two editors and one terminal. You pick which
//     one; there is no way to name another program or to add arguments.
//   - It starts the program with an argument ARRAY and never a shell, so a path with
//     spaces, quotes or & in it is only a path.
//   - A folder counts only after you picked it in the folder dialog. A file or a
//     folder outside every granted folder is refused (links are resolved first, so
//     a link inside a granted folder cannot lead out of it).
//   - Nothing in a file is read. The only file this module reads is .git/HEAD, at most
//     512 bytes.
//
// createDevDesk({ store, launch, fs, path, env }) so tests pass local stand-ins:
//   store:  { read(key), write(key, value) }   (main/file-store.js JsonStore)
//   launch: (exe, args) -> Promise             starts the program, never through a shell

const KEY = 'devdesk';
const MAX_ROOTS = 20;
const EDITORS = {
  vscode: { label: 'Visual Studio Code', find: (env) => [
    env.LOCALAPPDATA && env.LOCALAPPDATA + '\\Programs\\Microsoft VS Code\\Code.exe',
    env.ProgramFiles && env.ProgramFiles + '\\Microsoft VS Code\\Code.exe',
  ], args: (file, line, col) => ['--goto', file + (line ? ':' + line + (col ? ':' + col : '') : '')] },
  notepad: { label: 'Notepad', find: (env) => [(env.SystemRoot || 'C:\\Windows') + '\\System32\\notepad.exe'], args: (file) => [file] },
};
const TERMINALS = {
  wt: { label: 'Windows Terminal', find: (env) => [env.LOCALAPPDATA && env.LOCALAPPDATA + '\\Microsoft\\WindowsApps\\wt.exe'], args: (dir) => ['-d', dir] },
};

function createDevDesk({ store, launch, fs, path, env = {} } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') throw new Error('createDevDesk needs a store');
  if (typeof launch !== 'function') throw new Error('createDevDesk needs a launch function');
  if (!fs || !path) throw new Error('createDevDesk needs fs and path');

  async function load() {
    const v = await store.read(KEY);
    const c = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return {
      enabled: c.enabled === true,
      editor: Object.prototype.hasOwnProperty.call(EDITORS, c.editor) ? c.editor : '',
      terminal: Object.prototype.hasOwnProperty.call(TERMINALS, c.terminal) ? c.terminal : '',
      roots: Array.isArray(c.roots) ? c.roots.filter(r => typeof r === 'string' && r) : [],
    };
  }
  const save = (c) => store.write(KEY, c);

  async function config() {
    const c = await load();
    return { ...c, editors: Object.entries(EDITORS).map(([id, e]) => ({ id, label: e.label })), terminals: Object.entries(TERMINALS).map(([id, t]) => ({ id, label: t.label })) };
  }

  async function setConfig(patch) {
    const c = await load();
    if (patch && patch.enabled != null) c.enabled = patch.enabled === true;
    if (patch && patch.editor != null) {
      if (patch.editor !== '' && !Object.prototype.hasOwnProperty.call(EDITORS, patch.editor)) throw new Error('That editor is not on the list');
      c.editor = patch.editor;
    }
    if (patch && patch.terminal != null) {
      if (patch.terminal !== '' && !Object.prototype.hasOwnProperty.call(TERMINALS, patch.terminal)) throw new Error('That terminal is not on the list');
      c.terminal = patch.terminal;
    }
    await save(c);
    return config();
  }

  function realDir(dir) {
    const s = String(dir == null ? '' : dir);
    if (!s || s.length > 500 || /[\0\r\n]/.test(s)) throw new Error('That folder path is not valid');
    if (/^\\\\/.test(s)) throw new Error('A network folder cannot be granted');
    if (!path.isAbsolute(s)) throw new Error('The folder path must be a full path');
    const real = fs.realpathSync(s);
    if (!fs.statSync(real).isDirectory()) throw new Error('That is not a folder');
    return real;
  }

  // Called with the ONE path main's folder dialog returned.
  async function grantRoot(dir) {
    const real = realDir(dir);
    if (path.parse(real).root === real) throw new Error('A whole drive cannot be granted - choose the repository folder');
    const c = await load();
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    if (c.roots.some(r => same(r, real))) return config();
    if (c.roots.length >= MAX_ROOTS) throw new Error('At most ' + MAX_ROOTS + ' folders - revoke one first');
    c.roots.push(real);
    await save(c);
    return config();
  }
  async function revokeRoot(dir) {
    const c = await load();
    const next = c.roots.filter(r => r.toLowerCase() !== String(dir).toLowerCase());
    if (next.length === c.roots.length) throw new Error('That folder is not granted');
    c.roots = next;
    await save(c);
    return config();
  }

  // A real path that lies inside a granted folder, or throws why not.
  function within(roots, target) {
    for (const root of roots) {
      let realRoot;
      try { realRoot = fs.realpathSync(root); } catch { continue; }
      const rel = path.relative(realRoot, target);
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return realRoot;
    }
    throw new Error('That path is not inside a folder you granted');
  }

  function program(table, id, what) {
    if (!id) throw new Error('Choose ' + what + ' first (Settings > Developer desk)');
    for (const candidate of table[id].find(env)) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    throw new Error(table[id].label + ' was not found on this computer');
  }

  const intIn = (v, max) => (v == null || v === '' ? 0 : (Number.isInteger(v) && v >= 1 && v <= max ? v : (() => { throw new Error('That line number is not valid'); })()));

  async function openFile({ path: file, line, col } = {}) {
    const c = await load();
    if (!c.enabled) throw new Error('Open in editor is switched off (Settings > Developer desk)');
    const s = String(file == null ? '' : file);
    if (!s || s.length > 500 || /[\0\r\n]/.test(s) || /^\\\\/.test(s) || !path.isAbsolute(s)) throw new Error('That file path is not valid');
    let real;
    try { real = fs.realpathSync(s); } catch { throw new Error('That file does not exist'); }
    within(c.roots, real);
    if (!fs.statSync(real).isFile()) throw new Error('That is not a file');
    const exe = program(EDITORS, c.editor, 'an editor');
    await launch(exe, EDITORS[c.editor].args(real, intIn(line, 10000000), intIn(col, 100000)));
    return { ok: true, editor: c.editor };
  }

  async function openTerminal(dir) {
    const c = await load();
    if (!c.enabled) throw new Error('Open terminal is switched off (Settings > Developer desk)');
    const real = realDir(dir);
    within(c.roots, real);
    const exe = program(TERMINALS, c.terminal, 'a terminal');
    await launch(exe, TERMINALS[c.terminal].args(real));
    return { ok: true, terminal: c.terminal };
  }

  // The branch of a granted repository: .git/HEAD and nothing else.
  async function branch(dir) {
    const c = await load();
    if (!c.enabled) throw new Error('The branch chip is switched off (Settings > Developer desk)');
    const real = realDir(dir);
    within(c.roots, real);
    const head = path.join(real, '.git', 'HEAD');
    let text;
    try {
      const fd = fs.openSync(head, 'r');
      try { const buf = Buffer.alloc(512); const n = fs.readSync(fd, buf, 0, 512, 0); text = buf.subarray(0, n).toString('utf8').trim(); }
      finally { fs.closeSync(fd); }
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, branch: '', detached: false, note: 'No .git/HEAD here (a worktree, or not a repository)' };
      throw err;
    }
    const ref = /^ref:\s*refs\/heads\/(.{1,200})$/.exec(text);
    if (ref) return { ok: true, branch: ref[1], detached: false };
    if (/^[0-9a-f]{40}$/i.test(text)) return { ok: true, branch: text.slice(0, 7), detached: true };
    throw new Error('.git/HEAD is not in a form Vex understands');
  }

  return { config, setConfig, grantRoot, revokeRoot, openFile, openTerminal, branch };
}

module.exports = { createDevDesk, EDITORS, TERMINALS, KEY };
