// === Install-command and shell translator ======================================
//
// Select a command on a page (npm install zod, pip install httpx, ls -la) and
// "Translate command..." shows the same thing for the tool you use: pnpm for npm
// and yarn, uv for pip, PowerShell for bash (and back the other way for the
// idioms below). It only rewrites TEXT, which you then copy:
//
//   * it never runs anything and never reads a file;
//   * a line that looks dangerous (rm -rf, curl | sh, iex, Invoke-Expression,
//     Remove-Item -Recurse -Force, chmod -R 777, dd, mkfs, a fork bomb ...) is NOT
//     rewritten: it is shown unchanged with a red flag saying why. The danger
//     check runs on the whole line before any rewriting;
//   * a line it has no rule for is shown unchanged and said so;
//   * everything happens in this window; nothing is sent anywhere.
//
// How it works: package-manager commands are parsed into one neutral form
// (add / remove / install / run ...) and written out for the target, so npm,
// pnpm and yarn all convert to each other through the same code. pip and uv have
// their own small tables. Shell idioms are a table of about twenty commands.
//
// Pure functions first (tested in tests/renderer/snippetTranslator.test.js).
const VexShellTranslate = {
  ENABLED_KEY: 'vex.snippetTranslator.enabled',
  MAX_LINES: 60,
  MAX_CHARS: 6000,
  TARGETS: ['auto', 'pnpm', 'npm', 'uv', 'pip', 'powershell', 'bash'],

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; }
    catch (err) { console.error('[Translate] the switch could not be read:', err); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); },

  // ---- the danger lint ---------------------------------------------------------------
  DANGER: [
    [/(^|[\s;&|(])sudo\s+rm\b/, 'sudo rm deletes files as administrator'],
    [/(^|[\s;&|(])rm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*(?:[rR][a-zA-Z]*f|f[a-zA-Z]*[rR])[a-zA-Z]*(?=\s|$)/, 'rm -rf deletes a folder and everything in it without asking'],
    [/(^|[\s;&|(])rm\s+(?:-[a-zA-Z]+\s+)*(?:-r\b|--recursive\b)(?:\s+-[a-zA-Z]+)*\s+(?:-f\b|--force\b)/, 'rm with -r and -f deletes a folder without asking'],
    [/(^|[\s;&|(])rm\s+(?:-[a-zA-Z]+\s+)*(?:-f\b|--force\b)(?:\s+-[a-zA-Z]+)*\s+(?:-r\b|--recursive\b)/, 'rm with -r and -f deletes a folder without asking'],
    [/(^|[\s;&|(])rm\s+[^|;&]*--no-preserve-root/, 'rm --no-preserve-root can delete the whole disk'],
    [/\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i, 'pipes a download straight into a shell'],
    [/\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(?:iex|Invoke-Expression)\b/i, 'pipes a download straight into Invoke-Expression'],
    [/\$\(\s*(?:curl|wget)\b/, 'runs the output of a download as commands'],
    [/(^|[\s;&|(])(?:iex|Invoke-Expression)(?=\s|$|\()/i, 'iex / Invoke-Expression runs text as code'],
    [/\bRemove-Item\b(?=[^\n]*-Recurse)(?=[^\n]*-Force)/i, 'Remove-Item -Recurse -Force deletes a folder without asking'],
    [/(^|[\s;&|(])(?:del|erase)\s+[^\n]*\/s\b/i, 'del /s deletes files in every sub-folder'],
    [/(^|[\s;&|(])(?:rd|rmdir)\s+[^\n]*\/s\b/i, 'rd /s deletes a folder and everything in it'],
    [/\bchmod\s+(?:-R\s+)?[0-7]*777\b/, 'chmod 777 makes files writable by everyone'],
    [/(^|[\s;&|(])dd\s+[^\n]*\bof=/, 'dd can overwrite a disk'],
    [/\bmkfs(?:\.\w+)?\b/, 'mkfs formats a disk'],
    [/>\s*\/dev\/(?:sd|nvme|hd)/, 'writes straight to a disk device'],
    [/:\s*\(\s*\)\s*\{/, 'looks like a fork bomb'],
    [/\b(?:Format-Volume|Clear-Disk|Remove-Partition)\b/i, 'changes disks or partitions'],
    [/\bSet-ExecutionPolicy\s+(?:-\w+\s+)*(?:Bypass|Unrestricted)\b/i, 'turns off PowerShell\'s script protection'],
  ],
  // -> the reason a line is dangerous, or '' when no rule matches.
  danger(line) {
    for (const [re, why] of this.DANGER) if (re.test(line)) return why;
    return '';
  },

  // ---- splitting a line into pieces ---------------------------------------------------
  // Pieces separated by && ; or | outside quotes: [{ text, sep }] where sep is what follows it.
  split(line) {
    const out = [];
    let cur = '', q = '';
    const push = (sep) => { out.push({ text: cur.trim(), sep }); cur = ''; };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { cur += c; if (c === q && line[i - 1] !== '\\') q = ''; continue; }
      if (c === '"' || c === '\'') { q = c; cur += c; continue; }
      if (c === '&' && line[i + 1] === '&') { push('&&'); i++; continue; }
      if (c === '|' && line[i + 1] === '|') { push('||'); i++; continue; }
      if (c === '|') { push('|'); continue; }
      if (c === ';') { push(';'); continue; }
      cur += c;
    }
    if (cur.trim() || !out.length) out.push({ text: cur.trim(), sep: '' });
    return out;
  },
  tokens(text) { return String(text).match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) || []; },
  _join(pieces) { return pieces.map((p, i) => p.text + (p.sep && i < pieces.length - 1 ? ' ' + p.sep + ' ' : '')).join(''); },

  // ---- package managers (npm, pnpm, yarn) through one neutral form --------------------
  _NODE_ALIASES: { install: 'install', i: 'install', in: 'install', add: 'add', ci: 'ci', 'clean-install': 'ci', uninstall: 'remove', un: 'remove', rm: 'remove', r: 'remove', remove: 'remove', update: 'update', up: 'update', upgrade: 'update', run: 'run', 'run-script': 'run', t: 'test', test: 'test', start: 'start', ls: 'list', list: 'list' },
  _NODE_PLAIN: new Set(['init', 'publish', 'outdated', 'audit', 'link', 'pack', 'version', 'whoami', 'login', 'logout']),

  // "npm install -D a b" -> { tool, op, pkgs, dev, global, exact, optional, script, rest, drop } or null.
  parseNode(tokens) {
    const tool = tokens[0];
    let t = tokens.slice(1);
    const ir = { tool, op: '', pkgs: [], dev: false, global: false, exact: false, optional: false, script: '', rest: [], drop: [], note: [] };
    if (tool === 'npx') { ir.op = 'dlx'; ir.pkgs = t.filter(x => !x.startsWith('-')).slice(0, 1); ir.rest = t.filter(x => !x.startsWith('-')).slice(1); if (!ir.pkgs.length) return null; return ir; }
    if (tool === 'yarn' && t[0] === 'global') { ir.global = true; t = t.slice(1); }
    if (!t.length) { if (tool === 'yarn') { ir.op = 'install'; return ir; } return null; }
    let cmd = t[0];
    let rest = t.slice(1);
    if (tool === 'yarn' && cmd === 'dlx') { ir.op = 'dlx'; ir.pkgs = rest.slice(0, 1); ir.rest = rest.slice(1); return ir.pkgs.length ? ir : null; }
    if (tool === 'pnpm' && (cmd === 'dlx')) { ir.op = 'dlx'; ir.pkgs = rest.slice(0, 1); ir.rest = rest.slice(1); return ir.pkgs.length ? ir : null; }
    if (tool === 'pnpm' && cmd === 'exec') { ir.op = 'dlx'; ir.pkgs = rest.slice(0, 1); ir.rest = rest.slice(1); ir.note.push('pnpm exec runs an installed tool; the translation uses the download-and-run form'); return ir.pkgs.length ? ir : null; }
    if (tool === 'pnpm' && cmd === 'install') cmd = 'install';
    let op = this._NODE_ALIASES[cmd];
    if (tool === 'pnpm' && cmd === 'add') op = 'add';
    if (tool === 'yarn' && !op && !this._NODE_PLAIN.has(cmd) && !cmd.startsWith('-')) { ir.op = 'run'; ir.script = cmd; ir.rest = rest; return ir; }
    if (!op && this._NODE_PLAIN.has(cmd)) { ir.op = 'plain'; ir.script = cmd; ir.rest = rest; return ir; }
    if (!op) return null;
    ir.op = op;
    if (op === 'run') { ir.script = rest[0] || ''; rest = rest.slice(1); if (!ir.script) return null; if (rest[0] === '--') rest = rest.slice(1); ir.rest = rest; return ir; }
    if (op === 'test' || op === 'start' || op === 'list') { ir.rest = rest; return ir; }
    for (const a of rest) {
      if (a === '-D' || a === '--save-dev' || a === '--dev') ir.dev = true;
      else if (a === '-g' || a === '--global') ir.global = true;
      else if (a === '-E' || a === '--save-exact' || a === '--exact') ir.exact = true;
      else if (a === '-O' || a === '--save-optional' || a === '--optional') ir.optional = true;
      else if (a === '-S' || a === '--save' || a === '--save-prod') ir.drop.push(a);
      else if (a === '--frozen-lockfile' && op === 'install') ir.op = 'ci';
      else if (a.startsWith('-')) ir.note.push('the flag ' + a + ' was kept as it is and may not exist in the other tool');
      else ir.pkgs.push(a);
      if (a.startsWith('-') && !['-D', '--save-dev', '--dev', '-g', '--global', '-E', '--save-exact', '--exact', '-O', '--save-optional', '--optional', '-S', '--save', '--save-prod', '--frozen-lockfile'].includes(a)) ir.rest.push(a);
    }
    if (ir.op === 'install' && ir.pkgs.length) ir.op = 'add';
    if (ir.op === 'add' && !ir.pkgs.length) ir.op = 'install';
    return ir;
  },
  emitNode(ir, target) {
    const flags = [ir.dev ? '-D' : '', ir.global ? '-g' : '', ir.exact ? '-E' : '', ir.optional ? '-O' : ''].filter(Boolean);
    const pk = ir.pkgs, rest = ir.rest;
    const J = (...a) => a.flat().filter(x => x !== '' && x != null).join(' ');
    if (target === 'pnpm') {
      switch (ir.op) {
        case 'install': return J('pnpm install', rest);
        case 'ci': return J('pnpm install --frozen-lockfile', rest);
        case 'add': return J('pnpm add', pk, flags, rest);
        case 'remove': return J('pnpm remove', pk, ir.global ? '-g' : '', rest);
        case 'update': return J('pnpm update', pk, ir.global ? '-g' : '', rest);
        case 'run': return J('pnpm run', ir.script, rest);
        case 'dlx': return J('pnpm dlx', pk, rest);
        case 'test': return J('pnpm test', rest);
        case 'start': return J('pnpm start', rest);
        case 'list': return J('pnpm list', rest);
        case 'plain': return J('pnpm', ir.script, rest);
        default: return null;
      }
    }
    switch (ir.op) {   // npm
      case 'install': return J('npm install', rest);
      case 'ci': return J('npm ci', rest);
      case 'add': return J('npm install', pk, flags, rest);
      case 'remove': return J('npm uninstall', pk, ir.global ? '-g' : '', rest);
      case 'update': return J('npm update', pk, ir.global ? '-g' : '', rest);
      case 'run': return J('npm run', ir.script, rest.length ? ['--', ...rest] : '');
      case 'dlx': return J('npx', pk, rest);
      case 'test': return J('npm test', rest);
      case 'start': return J('npm start', rest);
      case 'list': return J('npm ls', rest);
      case 'plain': return J('npm', ir.script, rest);
      default: return null;
    }
  },

  // ---- pip <-> uv ---------------------------------------------------------------------
  _pipArgs(tokens) {
    // pip, pip3, python -m pip, python3 -m pip, py -m pip
    if (/^pip3?$/.test(tokens[0])) return tokens.slice(1);
    if (/^(?:python3?|py)$/.test(tokens[0]) && tokens[1] === '-m' && tokens[2] === 'pip') return tokens.slice(3);
    return null;
  },
  pipToUv(tokens) {
    const a = this._pipArgs(tokens);
    if (a) {
      const cmd = a[0], rest = a.slice(1);
      if (cmd === 'install') {
        const specs = rest.filter(x => !x.startsWith('-'));
        const flags = rest.filter(x => x.startsWith('-'));
        const plain = flags.every(f => f === '-U' || f === '--upgrade') && specs.length > 0 && !rest.some((x, i) => ['-r', '-e', '-c', '--requirement', '--editable'].includes(rest[i - 1]));
        if (plain) return { out: 'uv add ' + [...flags.map(() => '--upgrade').slice(0, 1), ...specs].join(' ').trim(), note: 'uv add records the package in pyproject.toml; to only install into the active environment use: uv pip install ' + rest.join(' ') };
        return { out: 'uv pip install ' + rest.join(' '), note: 'installs into the active environment without touching pyproject.toml' };
      }
      if (cmd === 'uninstall') { const specs = rest.filter(x => !x.startsWith('-')); return specs.length ? { out: 'uv remove ' + specs.join(' '), note: 'uv remove edits pyproject.toml; use uv pip uninstall for the active environment' } : null; }
      if (['freeze', 'list', 'show', 'check'].includes(cmd)) return { out: ('uv pip ' + cmd + ' ' + rest.join(' ')).trim() };
      return null;
    }
    if (/^(?:python3?|py)$/.test(tokens[0]) && tokens[1] === '-m' && tokens[2] === 'venv') return { out: ('uv venv ' + tokens.slice(3).join(' ')).trim() };
    return null;
  },
  uvToPip(tokens) {
    if (tokens[0] !== 'uv') return null;
    const cmd = tokens[1], rest = tokens.slice(2);
    if (cmd === 'add') return { out: ('pip install ' + rest.join(' ')).trim() };
    if (cmd === 'remove') return { out: ('pip uninstall -y ' + rest.join(' ')).trim() };
    if (cmd === 'pip') return { out: ('pip ' + rest.join(' ')).trim() };
    if (cmd === 'venv') return { out: ('python -m venv ' + rest.join(' ')).trim() };
    if (cmd === 'run') return { out: ('python ' + rest.join(' ')).trim() };
    return null;
  },

  // ---- bash <-> PowerShell ------------------------------------------------------------
  _flags(args) {   // -la -> {l,a}; long flags by name
    const f = new Set(); const rest = [];
    for (const a of args) {
      if (/^-[a-zA-Z]+$/.test(a)) for (const ch of a.slice(1)) f.add(ch);
      else if (/^--[a-z-]+$/.test(a)) f.add(a.slice(2));
      else rest.push(a);
    }
    return { f, rest };
  },
  bashToPs(tokens, piped) {
    const cmd = tokens[0];
    const { f, rest } = this._flags(tokens.slice(1));
    const J = (...a) => a.filter(x => x !== '' && x != null).join(' ');
    switch (cmd) {
      case 'ls': case 'll': return { out: J('Get-ChildItem', (f.has('a') || f.has('A') || cmd === 'll') ? '-Force' : '', rest.join(' ')) };
      case 'cat': return piped ? null : { out: J('Get-Content', rest.join(' ')) };
      case 'pwd': return { out: 'Get-Location' };
      case 'clear': return { out: 'Clear-Host' };
      case 'cd': return null;
      case 'mkdir': return rest.length ? { out: J('New-Item -ItemType Directory', f.has('p') ? '-Force' : '', '-Path', rest.join(', ')) } : null;
      case 'touch': return rest.length ? { out: J('New-Item -ItemType File -Path', rest.join(', ')), note: 'touch also updates the time of a file that exists; New-Item stops with an error if it exists' } : null;
      case 'cp': return rest.length >= 2 ? { out: J('Copy-Item', (f.has('r') || f.has('R') || f.has('recursive')) ? '-Recurse' : '', rest.join(' ')) } : null;
      case 'mv': return rest.length >= 2 ? { out: J('Move-Item', rest.join(' ')) } : null;
      case 'rm': {
        if (f.has('r') || f.has('R') || f.has('recursive')) return rest.length ? { out: J('Remove-Item -Recurse', f.has('f') ? '-Force' : '', rest.join(' ')) } : null;
        return rest.length ? { out: J('Remove-Item', f.has('f') ? '-Force' : '', rest.join(' ')) } : null;
      }
      case 'which': return rest.length === 1 ? { out: '(Get-Command ' + rest[0] + ').Source' } : null;
      case 'echo': return rest.some(x => /^[<>]|^\d?>/.test(x)) ? null : { out: J('Write-Output', rest.join(' ')) };
      case 'grep': {
        const pat = rest[0]; const files = rest.slice(1);
        if (!pat) return null;
        const cs = f.has('i') ? '' : '-CaseSensitive';
        if (!files.length && !piped) return null;
        return { out: J('Select-String', cs, '-Pattern', pat, files.length ? '-Path ' + files.join(', ') : ''), note: 'Select-String matches regular expressions like grep -E' };
      }
      case 'head': case 'tail': {
        let n = null; const others = [];
        const raw = tokens.slice(1);
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === '-n' && /^\d+$/.test(raw[i + 1] || '')) { n = raw[++i]; }
          else if (/^-\d+$/.test(raw[i])) n = raw[i].slice(1);
          else others.push(raw[i]);
        }
        if (n === null) n = '10';
        if (piped && !others.length) return { out: 'Select-Object ' + (cmd === 'head' ? '-First ' : '-Last ') + n };
        return others.length === 1 ? { out: 'Get-Content ' + others[0] + (cmd === 'head' ? ' -TotalCount ' : ' -Tail ') + n } : null;
      }
      case 'wc': {
        if (!f.has('l')) return null;
        if (piped && !rest.length) return { out: 'Measure-Object -Line' };
        return rest.length === 1 ? { out: '(Get-Content ' + rest[0] + ' | Measure-Object -Line).Lines' } : null;
      }
      case 'find': {
        const dir = rest[0] && !rest[0].startsWith('-') ? rest[0] : '.';
        const ni = tokens.indexOf('-name');
        if (ni === -1 || !tokens[ni + 1] || tokens.length > ni + 2) return null;
        return { out: 'Get-ChildItem -Path ' + dir + ' -Recurse -Filter ' + tokens[ni + 1] };
      }
      case 'curl': case 'wget': {
        const raw = tokens.slice(1);
        const url = raw.find(x => /^["']?https?:\/\//i.test(x));
        if (!url) return null;
        const oi = raw.findIndex(x => x === '-o' || x === '-O' || x === '--output' || x === '-o-' );
        if (cmd === 'curl' && raw.some(x => /^-[a-zA-Z]*[XdHu]/.test(x) || x === '--data' || x === '--header' || x === '--user')) return null;
        if (cmd === 'curl' && oi !== -1 && raw[oi] !== '-O' && raw[oi + 1]) return { out: 'Invoke-WebRequest -Uri ' + url + ' -OutFile ' + raw[oi + 1] };
        if (cmd === 'curl' && raw.includes('-O')) return { out: 'Invoke-WebRequest -Uri ' + url + ' -OutFile (Split-Path ' + url + ' -Leaf)' };
        if (cmd === 'curl') return { out: 'Invoke-RestMethod -Uri ' + url };
        return { out: 'Invoke-WebRequest -Uri ' + url + ' -OutFile (Split-Path ' + url + ' -Leaf)' };
      }
      case 'export': {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(tokens[1] || '');
        if (!m || tokens.length !== 2 || /[:$`]/.test(m[2])) return null;
        const v = m[2].replace(/^(["'])(.*)\1$/, '$2');
        return { out: '$env:' + m[1] + ' = "' + v.replace(/"/g, '`"') + '"', note: 'lasts for this PowerShell session only' };
      }
      default: return null;
    }
  },
  psToBash(tokens) {
    const cmd = tokens[0].toLowerCase();
    const rest = tokens.slice(1);
    const hasFlag = (name) => rest.some(x => x.toLowerCase() === name);
    const plain = rest.filter(x => !x.startsWith('-'));
    const J = (...a) => a.filter(Boolean).join(' ');
    switch (cmd) {
      case 'get-childitem': case 'gci': return { out: J('ls', hasFlag('-force') ? '-a' : '', plain.join(' ')) };
      case 'get-content': case 'gc': {
        const ti = rest.findIndex(x => x.toLowerCase() === '-totalcount'); const tl = rest.findIndex(x => x.toLowerCase() === '-tail');
        if (ti !== -1 && plain.length >= 2) return { out: 'head -n ' + rest[ti + 1] + ' ' + plain.filter(x => x !== rest[ti + 1])[0] };
        if (tl !== -1 && plain.length >= 2) return { out: 'tail -n ' + rest[tl + 1] + ' ' + plain.filter(x => x !== rest[tl + 1])[0] };
        return { out: J('cat', plain.join(' ')) };
      }
      case 'get-location': case 'gl': return { out: 'pwd' };
      case 'clear-host': case 'cls': return { out: 'clear' };
      case 'copy-item': case 'cp': case 'copy': return plain.length >= 2 ? { out: J('cp', hasFlag('-recurse') ? '-r' : '', plain.join(' ')) } : null;
      case 'move-item': case 'mv': case 'move': return plain.length >= 2 ? { out: 'mv ' + plain.join(' ') } : null;
      case 'remove-item': case 'ri': case 'del': return plain.length ? { out: J('rm', hasFlag('-recurse') ? '-r' : '', plain.join(' ')) } : null;
      case 'write-output': case 'write-host': return { out: 'echo ' + rest.join(' ') };
      case 'set-location': case 'sl': return plain.length === 1 ? { out: 'cd ' + plain[0] } : null;
      case 'select-string': {
        const pi = rest.findIndex(x => x.toLowerCase() === '-pattern'); const pa = rest.findIndex(x => x.toLowerCase() === '-path');
        if (pi === -1 || !rest[pi + 1]) return null;
        return { out: J('grep', hasFlag('-casesensitive') ? '' : '-i', rest[pi + 1], pa !== -1 ? rest[pa + 1] : '') };
      }
      case 'new-item': {
        const pi = rest.findIndex(x => x.toLowerCase() === '-path'); const path = pi !== -1 ? rest[pi + 1] : plain[0];
        const ti = rest.findIndex(x => x.toLowerCase() === '-itemtype'); const kind = ti !== -1 ? String(rest[ti + 1]).toLowerCase() : '';
        if (!path) return null;
        if (kind === 'directory') return { out: 'mkdir -p ' + path };
        if (kind === 'file') return { out: 'touch ' + path };
        return null;
      }
      default: {
        const m = /^\$env:([A-Za-z_][A-Za-z0-9_]*)$/i.exec(tokens[0]);
        if (m && tokens[1] === '=' && tokens.length === 3) return { out: 'export ' + m[1] + '=' + tokens[2], note: 'lasts for this shell session only' };
        return null;
      }
    }
  },

  // ---- one line ------------------------------------------------------------------------
  // -> { input, output, status: 'changed'|'same'|'unknown'|'danger', notes: [string] }
  translateLine(line, target = 'auto') {
    const input = String(line);
    const trimmed = input.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return { input, output: input, status: 'same', notes: [] };
    const why = this.danger(trimmed);
    if (why) return { input, output: input, status: 'danger', notes: ['Not rewritten: ' + why + '. Check it yourself before running it.'] };
    const indent = /^\s*/.exec(input)[0];
    // A "$ " prompt copied from a page.
    const promptM = /^(\$|>|PS [^>]*>)\s+/.exec(trimmed);
    const body = promptM ? trimmed.slice(promptM[0].length) : trimmed;
    const pieces = this.split(body);
    const notes = []; let changed = 0, unknown = 0;
    const out = pieces.map((p, idx) => {
      if (!p.text) return p;
      const piped = idx > 0 && pieces[idx - 1].sep === '|';
      const r = this._piece(p.text, target, piped);
      if (r && r.out != null) { changed++; if (r.note) notes.push(r.note); return { text: r.out, sep: p.sep }; }
      unknown++;
      return p;
    });
    if (!changed) return { input, output: input, status: 'unknown', notes: ['No rule for this line, so it is shown as it was.'] };
    if (unknown) notes.push('Some parts have no rule and were left as they were.');
    const hasAnd = out.some((p, i) => p.sep === '&&' && i < out.length - 1);
    if (hasAnd && /^(?:powershell|auto)$/.test(target) && out.some(p => /^(?:Get-|Set-|New-|Remove-|Copy-|Move-|Select-|Write-|Invoke-|Clear-|Measure-|\(Get-|\$env:)/.test(p.text))) notes.push('&& needs PowerShell 7 or newer.');
    return { input, output: indent + this._join(out), status: 'changed', notes };
  },
  _piece(text, target, piped) {
    const tokens = this.tokens(text);
    if (!tokens.length) return null;
    const head = tokens[0];
    const want = (...names) => target === 'auto' || names.includes(target);
    if (/^(?:npm|pnpm|yarn|npx)$/.test(head) && (want('pnpm', 'npm'))) {
      const to = target === 'auto' ? (head === 'pnpm' ? 'npm' : 'pnpm') : target;
      if (head === to) return null;
      const ir = this.parseNode(tokens);
      if (!ir) return null;
      const out = this.emitNode(ir, to);
      return out ? { out, note: ir.note.length ? ir.note.join('; ') : '' } : null;
    }
    if ((/^(?:pip3?|python3?|py)$/.test(head)) && want('uv')) return this.pipToUv(tokens);
    if (head === 'uv' && want('pip')) return this.uvToPip(tokens);
    if (target === 'auto' || target === 'powershell') {
      const r = this.bashToPs(tokens, piped);
      if (r) return r;
    }
    if (target === 'bash' || (target === 'auto' && (/^[A-Za-z]+-[A-Za-z]+$/.test(head) || /^\$env:/i.test(head)))) {
      const r = this.psToBash(tokens);
      if (r) return r;
    }
    return null;
  },

  // ---- many lines ------------------------------------------------------------------------
  translate(text, target = 'auto') {
    if (!this.TARGETS.includes(target)) throw new Error('Unknown target "' + target + '": use ' + this.TARGETS.join(', '));
    const src = String(text == null ? '' : text);
    if (src.length > this.MAX_CHARS) throw new Error('That is too long to translate (at most ' + this.MAX_CHARS + ' characters)');
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > this.MAX_LINES) throw new Error('That is too many lines to translate (at most ' + this.MAX_LINES + ')');
    const results = lines.map(l => this.translateLine(l, target));
    return {
      lines: results,
      text: results.map(r => r.output).join('\n'),
      changed: results.some(r => r.status === 'changed'),
      danger: results.some(r => r.status === 'danger'),
    };
  },
  // Does a selection look like a command this could translate? (cheap, for the menu)
  looksLikeCommand(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s || s.length > this.MAX_CHARS || s.split('\n').length > this.MAX_LINES) return false;
    return /(^|\n)\s*(?:[$>]\s+)?(?:npm|pnpm|yarn|npx|pip3?|uv|python3?\s+-m\s+(?:pip|venv)|ls|cat|rm|cp|mv|mkdir|touch|export|curl|wget|grep|find|Get-[A-Z]\w+|Remove-Item|Copy-Item|New-Item)\b/.test(s);
  },

  // ---- the card -------------------------------------------------------------------------
  open(text) {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('snippet-translator');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-translate', title: 'Translate command', sub: 'Rewrites the text only. It never runs anything. Dangerous lines are left as they are.' });
    const input = document.createElement('textarea');
    input.className = 'set-input';
    input.rows = 4;
    input.value = String(text == null ? '' : text).slice(0, this.MAX_CHARS);
    input.setAttribute('aria-label', 'The command to translate');
    input.style.cssText = "width:100%;box-sizing:border-box;font-family:'JetBrains Mono',monospace;font-size:12px";
    const sel = document.createElement('select');
    sel.className = 'set-input';
    sel.setAttribute('aria-label', 'Translate to');
    const names = { auto: 'Automatic', pnpm: 'pnpm', npm: 'npm', uv: 'uv', pip: 'pip', powershell: 'PowerShell', bash: 'bash' };
    for (const t of this.TARGETS) { const o = document.createElement('option'); o.value = t; o.textContent = names[t]; sel.appendChild(o); }
    const out = document.createElement('div');
    const draw = () => {
      out.textContent = '';
      let res;
      try { res = this.translate(input.value, sel.value); }
      catch (err) { out.appendChild(VexSettingsGroups.note(err.message)); return; }
      const pre = document.createElement('pre');
      pre.style.cssText = "margin:8px 0;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;user-select:text";
      pre.textContent = res.text;
      out.appendChild(pre);
      res.lines.forEach((l, i) => {
        if (!l.notes.length && l.status !== 'danger') return;
        const p = document.createElement('div');
        p.style.cssText = 'font-size:12px;margin:2px 0;color:' + (l.status === 'danger' ? 'var(--danger,#c0392b)' : 'var(--text-muted)');
        p.textContent = (l.status === 'danger' ? 'Warning, line ' : 'Line ') + (i + 1) + ': ' + l.notes.join(' ');
        out.appendChild(p);
      });
      const copy = VexSettingsGroups.button('Copy result', async () => {
        try { await navigator.clipboard.writeText(res.text); window.showToast?.('Copied'); }
        catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
      }, { primary: true });
      out.appendChild(copy);
    };
    input.addEventListener('input', draw);
    sel.addEventListener('change', draw);
    body.append(input, sel, out);
    draw();
  },

  settingsRows(body) {
    body.appendChild(VexSettingsGroup.toggle('Translate command', this.enabled(), (on) => this.setEnabled(on), 'right-click a selected npm, pip or shell command'));
  },
};

if (typeof window !== 'undefined') window.VexShellTranslate = VexShellTranslate;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexShellTranslate };
