// src/main/local-services.js (T3-033): the launcher starts only what the owner added through a
// confirm box main shows, with spawn(file, argv[], { shell: false }), and stops only a process it
// started after checking the live process against what it started.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createLocalServices, displayCommand } = require('../../src/main/local-services.js');

let root, bin, work;

function fakeChild(pid) {
  const c = new EventEmitter();
  c.pid = pid;
  c.exitCode = null;
  c.signalCode = null;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  return c;
}

function make(over = {}) {
  const calls = { spawn: [], confirm: [], kill: [], inspect: [], saved: [] };
  let nextPid = 4000;
  const children = [];
  const deps = {
    fs, path, platform: 'win32',
    env: { PATH: bin, VEX_SECRET: 'x', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', KEEP: 'yes' },
    spawn: (file, argv, opts) => { const c = fakeChild(nextPid++); calls.spawn.push({ file, argv, opts, child: c }); children.push(c); return c; },
    inspect: async (pid) => {
      calls.inspect.push(pid);
      const s = calls.spawn.find(x => x.child.pid === pid);
      return over.live === undefined ? { executablePath: s.file, commandLine: '"' + s.file + '" ' + s.argv.join(' '), createdMs: Date.now() } : over.live;
    },
    killTree: async (pid) => { calls.kill.push(pid); const s = calls.spawn.find(x => x.child.pid === pid); s.child.exitCode = 1; s.child.emit('exit', 1, null); },
    knock: async (port) => port === 5173,
    confirm: async (o) => { calls.confirm.push(o); return over.answer === undefined ? true : over.answer; },
    pickFolderDialog: async () => ({ canceled: false, path: work }),
    load: async () => over.stored || null,
    save: async (cfg) => { calls.saved.push(JSON.parse(JSON.stringify(cfg))); },
    now: () => (over.now ? over.now() : Date.now()),
  };
  const svc = createLocalServices({ ...deps, ...(over.deps || {}) });
  return { svc, calls, children };
}

async function addPnpm(svc, extra = {}) {
  await svc.arm(true);
  const g = await svc.pickFolder();
  return svc.add({ name: 'Vex site', token: g.token, template: 'pnpm-script', params: { script: 'dev' }, port: 5173, ...extra });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-localsvc-'));
  bin = path.join(root, 'bin');
  work = path.join(root, 'work');
  fs.mkdirSync(bin); fs.mkdirSync(work);
  for (const n of ['pnpm.exe', 'node.exe', 'python.exe', 'uv.exe', 'npm.exe']) fs.writeFileSync(path.join(bin, n), '');
  fs.writeFileSync(path.join(work, 'manage.py'), '');
  fs.writeFileSync(path.join(work, 'server.js'), '');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('off until armed, and armed only through a box main shows', () => {
  it('refuses to pick a folder, add or start before it is allowed', async () => {
    const { svc } = make();
    await expect(svc.pickFolder()).rejects.toThrow(/Allow local services first/);
    await expect(svc.add({ name: 'x', token: 't', template: 'pnpm-script', params: { script: 'dev' } })).rejects.toThrow(/Allow local services first/);
    await expect(svc.start('svc_x')).rejects.toThrow(/not allowed/);
  });

  it('stays unarmed when the box is declined, arms and saves on a yes', async () => {
    const no = make({ answer: false });
    expect((await no.svc.arm(true)).armed).toBe(false);
    expect(no.calls.saved.length).toBe(0);
    const yes = make();
    expect((await yes.svc.arm(true)).armed).toBe(true);
    expect(yes.calls.saved[0].armed).toBe(true);
    expect(yes.calls.confirm[0].message).toMatch(/never by itself/);
  });

  it('arming can be taken back without a box', async () => {
    const { svc, calls } = make();
    await svc.arm(true);
    const n = calls.confirm.length;
    expect((await svc.arm(false)).armed).toBe(false);
    expect(calls.confirm.length).toBe(n);
  });
});

describe('adding a service', () => {
  it('needs the folder grant from the dialog, once, for five minutes', async () => {
    let t = 1000;
    const { svc } = make({ now: () => t });
    await svc.arm(true);
    await expect(svc.add({ name: 'A', token: 'forged', template: 'pnpm-script', params: { script: 'dev' } })).rejects.toThrow(/Choose the folder again/);
    const g = await svc.pickFolder();
    t += 6 * 60 * 1000;
    await expect(svc.add({ name: 'A', token: g.token, template: 'pnpm-script', params: { script: 'dev' } })).rejects.toThrow(/Choose the folder again/);
    const g2 = await svc.pickFolder();
    await svc.add({ name: 'A', token: g2.token, template: 'pnpm-script', params: { script: 'dev' } });
    await expect(svc.add({ name: 'B', token: g2.token, template: 'pnpm-script', params: { script: 'dev' } })).rejects.toThrow(/Choose the folder again/);
  });

  it('shows the exact program, arguments and folder, and saves only after a yes', async () => {
    const { svc, calls } = make();
    const r = await addPnpm(svc);
    expect(r.ok).toBe(true);
    const box = calls.confirm.at(-1);
    expect(box.message).toContain('pnpm run dev');
    expect(box.message).toContain(fs.realpathSync(work));
    expect(box.message).toContain('pnpm.exe');
    expect(calls.saved.at(-1).services[0]).toMatchObject({ name: 'Vex site', template: 'pnpm-script', params: { script: 'dev' }, port: 5173 });
  });

  it('is not saved when the box is declined', async () => {
    let answers = [true, false];
    const { svc, calls } = make({ deps: { confirm: async () => answers.shift() } });
    const r = await addPnpm(svc);
    expect(r).toEqual({ canceled: true });
    expect(calls.saved.at(-1).services).toEqual([]);
  });

  it.each([
    ['a script with a shell character', 'pnpm-script', { script: 'dev; calc' }, /script name/],
    ['a script that starts with a dash', 'npm-script', { script: '-rf' }, /script name/],
    ['a python script outside the folder', 'python-script', { file: '../evil.py', args: [] }, /inside the folder|path inside/],
    ['an absolute python script', 'python-script', { file: 'C:/Windows/x.py', args: [] }, /path inside/],
    ['a script that is not there', 'node-script', { file: 'nope.js', args: [] }, /not in that folder/],
    ['a script of the wrong kind', 'node-script', { file: 'manage.py', args: [] }, /kind of file/],
    ['a word with a space or quote', 'uv-run', { args: ['a"b'] }, /not allowed/],
    ['uv run with nothing to run', 'uv-run', { args: [] }, /what to run/],
    ['more than six words', 'uv-run', { args: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, /At most 6/],
    ['a program name as a template', 'cmd', { script: 'dev' }, /not one of the commands/],
  ])('refuses %s', async (_label, template, params, message) => {
    const { svc, calls } = make();
    await svc.arm(true);
    const g = await svc.pickFolder();
    await expect(svc.add({ name: 'X', token: g.token, template, params })).rejects.toThrow(message);
    expect(calls.saved.at(-1).services).toEqual([]);
  });

  it('refuses a port outside 1024-65535 and a duplicate name', async () => {
    const { svc } = make();
    await svc.arm(true);
    let g = await svc.pickFolder();
    await expect(svc.add({ name: 'A', token: g.token, template: 'pnpm-script', params: { script: 'dev' }, port: 80 })).rejects.toThrow(/1024 to 65535/);
    g = await svc.pickFolder();
    await svc.add({ name: 'A', token: g.token, template: 'pnpm-script', params: { script: 'dev' } });
    g = await svc.pickFolder();
    await expect(svc.add({ name: 'a', token: g.token, template: 'pnpm-script', params: { script: 'dev' } })).rejects.toThrow(/already a service/);
  });

  it('builds python and node commands with the script first and the words after it', async () => {
    const { svc, calls } = make();
    await svc.arm(true);
    let g = await svc.pickFolder();
    await svc.add({ name: 'Django', token: g.token, template: 'python-script', params: { file: 'manage.py', args: 'runserver 0.0.0.0:8000' } });
    expect(calls.confirm.at(-1).message).toContain('python manage.py runserver 0.0.0.0:8000');
    g = await svc.pickFolder();
    await svc.add({ name: 'Node', token: g.token, template: 'node-script', params: { file: 'server.js', args: [] } });
    expect(calls.confirm.at(-1).message).toContain('node server.js');
  });

  it('does not use a program from the granted folder, even when the folder is on PATH', async () => {
    fs.writeFileSync(path.join(work, 'pnpm.exe'), '');
    fs.unlinkSync(path.join(bin, 'pnpm.exe'));
    const { svc } = make({ deps: { env: { PATH: work + ';' + bin } } });
    await svc.arm(true);
    const g = await svc.pickFolder();
    await expect(svc.add({ name: 'A', token: g.token, template: 'pnpm-script', params: { script: 'dev' } })).rejects.toThrow(/pnpm was not found/);
  });

  it('follows an npm-style .cmd shim to the node script and never uses a shell', async () => {
    fs.unlinkSync(path.join(bin, 'pnpm.exe'));
    fs.mkdirSync(path.join(bin, 'node_modules', 'wrangler', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(bin, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), '');
    fs.writeFileSync(path.join(bin, 'wrangler.cmd'), '@ECHO off\r\nSETLOCAL\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\wrangler\\bin\\wrangler.js" %*\r\n');
    const { svc, calls } = make();
    await svc.arm(true);
    const g = await svc.pickFolder();
    const r = await svc.add({ name: 'Worker', token: g.token, template: 'wrangler-dev', params: {}, port: 8787 });
    await svc.start(r.id);
    expect(calls.spawn[0].file).toBe(path.join(bin, 'node.exe'));
    expect(calls.spawn[0].argv).toEqual([path.join(bin, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--port', '8787']);
    expect(calls.spawn[0].opts.shell).toBe(false);
  });

  it('refuses a .cmd it cannot follow, and says no shell is used', async () => {
    fs.unlinkSync(path.join(bin, 'pnpm.exe'));
    fs.writeFileSync(path.join(bin, 'pnpm.cmd'), '@echo off\r\ncorepack pnpm %*\r\n');
    const { svc } = make();
    await svc.arm(true);
    const g = await svc.pickFolder();
    await expect(svc.add({ name: 'A', token: g.token, template: 'pnpm-script', params: { script: 'dev' } })).rejects.toThrow(/never starts programs through a shell/);
  });
});

describe('starting', () => {
  it('spawns the argument array with shell false, in the granted folder, without Vex-only environment', async () => {
    const { svc, calls } = make();
    const r = await addPnpm(svc);
    const s = await svc.start(r.id);
    expect(s.ok).toBe(true);
    const sp = calls.spawn[0];
    expect(sp.file).toBe(path.join(bin, 'pnpm.exe'));
    expect(sp.argv).toEqual(['run', 'dev']);
    expect(sp.opts).toMatchObject({ shell: false, cwd: fs.realpathSync(work), windowsHide: true });
    expect(Array.isArray(sp.argv)).toBe(true);
    expect(sp.opts.env.KEEP).toBe('yes');
    expect(sp.opts.env.VEX_SECRET).toBeUndefined();
    expect(sp.opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(sp.opts.env.NODE_OPTIONS).toBeUndefined();
  });

  it('asks again with the exact line on the first start of the session only, and a no starts nothing', async () => {
    let answers = [true, true, false];
    const { svc, calls } = make({ deps: { confirm: async (o) => { calls.confirm.push(o); return answers.shift() !== false; } } });
    const r = await addPnpm(svc);       // arm yes, add yes
    answers = [false];
    expect(await svc.start(r.id)).toEqual({ canceled: true });
    expect(calls.spawn.length).toBe(0);
    answers = [true];
    await svc.start(r.id);
    expect(calls.confirm.at(-1).message).toContain('pnpm run dev');
    const n = calls.confirm.length;
    await svc.stop(r.id);
    await svc.start(r.id);
    expect(calls.confirm.length).toBe(n);
    expect(calls.spawn.length).toBe(2);
  });

  it('will not start a second copy, and keeps the output of the running one', async () => {
    const { svc, calls } = make();
    const r = await addPnpm(svc);
    await svc.start(r.id);
    await expect(svc.start(r.id)).rejects.toThrow(/already running/);
    calls.spawn[0].child.stdout.emit('data', 'ready on 5173\nsecond line\n');
    expect(svc.logs(r.id)).toEqual({ lines: ['ready on 5173', 'second line'], running: true });
  });

  it('reports state, the process and whether the declared port answers', async () => {
    const { svc } = make();
    const r = await addPnpm(svc);
    let st = await svc.status();
    expect(st.services[0]).toMatchObject({ name: 'Vex site', state: 'stopped', command: 'pnpm run dev', port: 5173, listening: false });
    await svc.start(r.id);
    st = await svc.status();
    expect(st.services[0]).toMatchObject({ state: 'running', pid: 4000, listening: true });
  });

  it('records why a service ended', async () => {
    const { svc, calls } = make();
    const r = await addPnpm(svc);
    await svc.start(r.id);
    calls.spawn[0].child.exitCode = 2;
    calls.spawn[0].child.emit('exit', 2, null);
    const st = await svc.status();
    expect(st.services[0].state).toBe('stopped');
    expect(st.services[0].exit.code).toBe(2);
  });

  it('cannot remove a running service', async () => {
    const { svc } = make();
    const r = await addPnpm(svc);
    await svc.start(r.id);
    await expect(svc.remove(r.id)).rejects.toThrow(/Stop it first/);
  });
});

describe('stopping', () => {
  it('stops only a process it started, after the live process matches', async () => {
    const { svc, calls } = make();
    const r = await addPnpm(svc);
    await expect(svc.stop(r.id)).rejects.toThrow(/only stops what it started/);
    await svc.start(r.id);
    const out = await svc.stop(r.id);
    expect(out.ok).toBe(true);
    expect(calls.inspect).toEqual([4000]);
    expect(calls.kill).toEqual([4000]);
  });

  it.each([
    ['another program under the same number', (file) => ({ executablePath: 'C:\Windows\notepad.exe', commandLine: 'notepad run dev', createdMs: Date.now() }), /not the program Vex started/],
    ['the same program with another command line', (file) => ({ executablePath: file, commandLine: file + ' other', createdMs: Date.now() }), /command line/],
    ['a process created long before', (file) => ({ executablePath: file, commandLine: file + ' run dev', createdMs: Date.now() - 3600 * 1000 }), /was not started when Vex started/],
  ])('leaves %s alone', async (_label, liveFor, message) => {
    const { svc, calls } = make({ live: liveFor(path.join(bin, 'pnpm.exe')) });
    const r = await addPnpm(svc);
    await svc.start(r.id);
    await expect(svc.stop(r.id)).rejects.toThrow(message);
    expect(calls.kill).toEqual([]);
  });

  it('treats a process that is already gone as stopped', async () => {
    const { svc, calls } = make({ live: null });
    const r = await addPnpm(svc);
    await svc.start(r.id);
    const out = await svc.stop(r.id);
    expect(out).toMatchObject({ ok: true, already: true });
    expect(calls.kill).toEqual([]);
    expect((await svc.status()).services[0].state).toBe('stopped');
  });

  it('stopAll goes through the same check for every running service', async () => {
    const { svc, calls } = make();
    const a = await addPnpm(svc);
    await svc.start(a.id);
    const out = await svc.stopAll();
    expect(out).toEqual([{ id: a.id, ok: true }]);
    expect(calls.kill).toEqual([4000]);
    expect(svc.hasRunning()).toBe(false);
  });
});

describe('the fixed set', () => {
  it('shows a command the way it will run', () => {
    expect(displayCommand('python', ['manage.py', 'runserver', '8000'])).toBe('python manage.py runserver 8000');
    expect(displayCommand('node', ['my app.js'])).toBe('node "my app.js"');
  });

  it('has no template that takes a program or a free command line', () => {
    const { svc } = make();
    for (const [id, t] of Object.entries(svc.TEMPLATES)) {
      expect(['pnpm', 'npm', 'wrangler', 'python', 'node', 'uv'], id).toContain(t.exe);
      expect(t.fields.every(f => ['script', 'file', 'args'].includes(f)), id).toBe(true);
    }
  });
});
