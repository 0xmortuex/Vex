// T3-033 (Wave 6): the owner's own allowlist (program from a main-owned dialog, fixed arguments) and the QEMU recipe.
// Same fakes as localServices.test.js: no process is started.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createLocalServices } = require('../../src/main/local-services.js');

let root, bin, work, tools;

function fakeChild(pid) {
  const c = new EventEmitter(); c.pid = pid; c.exitCode = null; c.signalCode = null;
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  return c;
}
function make(over = {}) {
  const calls = { spawn: [], confirm: [], saved: [], kill: [] };
  let pid = 5000; let picked = over.program || path.join(tools, 'game-server.exe');
  const svc = createLocalServices({
    fs, path, platform: 'win32', env: { PATH: bin, ProgramFiles: path.join(root, 'pf') },
    spawn: (file, argv, opts) => { const c = fakeChild(pid++); calls.spawn.push({ file, argv, opts, child: c }); return c; },
    inspect: async (p) => { const s = calls.spawn.find(x => x.child.pid === p); return { executablePath: s.file, commandLine: '"' + s.file + '" ' + s.argv.join(' '), createdMs: Date.now() }; },
    killTree: async (p) => { calls.kill.push(p); const s = calls.spawn.find(x => x.child.pid === p); s.child.exitCode = 1; s.child.emit('exit', 1, null); },
    knock: async () => false,
    confirm: async (o) => { calls.confirm.push(o); return over.answer === undefined ? true : over.answer; },
    pickFolderDialog: async () => ({ canceled: false, path: work }),
    pickProgramDialog: async () => ({ canceled: !picked, path: picked }),
    load: async () => over.stored || null, save: async (c) => { calls.saved.push(JSON.parse(JSON.stringify(c))); },
    ...(over.deps || {}),
  });
  return { svc, calls, setPicked: (p) => { picked = p; } };
}
async function addCustom(svc, extra = {}) {
  await svc.arm(true);
  const g = await svc.pickFolder(); const p = await svc.pickProgram();
  return svc.addCustom({ name: 'Game server', token: g.token, programToken: p.token, args: ['--port', '27015', '+map de_dust2'], ...extra });
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-w6svc-'));
  bin = path.join(root, 'bin'); work = path.join(root, 'work'); tools = path.join(root, 'tools');
  for (const d of [bin, work, tools, path.join(root, 'pf', 'qemu')]) fs.mkdirSync(d, { recursive: true });
  for (const n of ['game-server.exe', 'cmd.exe', 'powershell.exe', 'notes.txt', 'run.bat']) fs.writeFileSync(path.join(tools, n), '');
  fs.writeFileSync(path.join(work, 'disk.qcow2'), ''); fs.writeFileSync(path.join(work, 'boot.iso'), '');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('the owner\'s own allowlist', () => {
  it('needs the folder and the program from main-owned dialogs, once, and a yes in a main confirm that shows the exact command', async () => {
    const { svc, calls } = make();
    await svc.arm(true);
    await expect(svc.addCustom({ name: 'X', token: 'forged', programToken: 'forged', args: [] })).rejects.toThrow(/Choose the folder again/);
    const g = await svc.pickFolder();
    await expect(svc.addCustom({ name: 'X', token: g.token, programToken: 'forged', args: [] })).rejects.toThrow(/Choose the program again/);
    const g2 = await svc.pickFolder(); const p = await svc.pickProgram();
    const r = await svc.addCustom({ name: 'Game server', token: g2.token, programToken: p.token, args: ['--port', '27015'] });
    expect(r.ok).toBe(true);
    const box = calls.confirm.at(-1);
    expect(box.message).toContain(path.join(tools, 'game-server.exe') + ' --port 27015');
    expect(box.message).toContain('no shell');
    expect(calls.saved.at(-1).services[0]).toMatchObject({ template: 'custom', program: path.join(tools, 'game-server.exe'), args: ['--port', '27015'] });
    await expect(svc.addCustom({ name: 'Y', token: g2.token, programToken: p.token, args: [] })).rejects.toThrow(/Choose the folder again/);   // tokens are one use
  });

  it('is not saved when the box is declined, and nothing works before it is armed', async () => {
    const off = make();
    await expect(off.svc.pickProgram()).rejects.toThrow(/Allow local services first/);
    // The first box (arming) is answered yes, the second (adding) no.
    let answers = [true, false];
    const m = make({ deps: { confirm: async () => answers.shift() } });
    await m.svc.arm(true);
    const g2 = await m.svc.pickFolder(); const p2 = await m.svc.pickProgram();
    expect(await m.svc.addCustom({ name: 'A', token: g2.token, programToken: p2.token, args: [] })).toEqual({ canceled: true });
    expect(m.calls.saved.at(-1).services).toEqual([]);
  });

  it.each([
    ['cmd.exe', 'cmd.exe', /runs whatever it is told/],
    ['powershell.exe', 'powershell.exe', /runs whatever it is told/],
    ['a batch file', 'run.bat', /Only a .exe/],
    ['a text file', 'notes.txt', /Only a .exe/],
  ])('refuses %s as the program', async (_l, file, message) => {
    const { svc } = make({ program: path.join(tools, file) });
    await svc.arm(true);
    await expect(svc.pickProgram()).rejects.toThrow(message);
  });

  it.each([
    ['a quote mark', ['a"b'], /quote mark/],
    ['a line break', ['a\nb'], /quote mark or a line break/],
    ['an empty argument', [''], /1 to 200/],
    ['a long argument', ['x'.repeat(201)], /1 to 200/],
    ['too many arguments', Array.from({ length: 17 }, (_, i) => 'a' + i), /At most 16/],
    ['a non-list', 'not a list', /list of words/],
  ])('refuses %s', async (_l, args, message) => {
    const { svc, calls } = make();
    await expect(addCustom(svc, { args })).rejects.toThrow(message);
    expect(calls.saved.at(-1).services).toEqual([]);
  });

  it('starts it with spawn(shell:false) in the folder after the per-session confirm, and stops it only after the live check', async () => {
    const { svc, calls } = make();
    const r = await addCustom(svc);
    const s = await svc.start(r.id);
    expect(s.ok).toBe(true);
    expect(calls.confirm.at(-1).title).toMatch(/Start "Game server"/);
    expect(calls.spawn[0].file).toBe(path.join(tools, 'game-server.exe'));
    expect(calls.spawn[0].argv).toEqual(['--port', '27015', '+map de_dust2']);
    expect(calls.spawn[0].opts).toMatchObject({ shell: false, cwd: fs.realpathSync(work) });
    await svc.stop(r.id);
    expect(calls.kill).toEqual([calls.spawn[0].child.pid]);
  });

  it('judges a hand-edited list file again before it runs', async () => {
    const stored = { v: 1, armed: true, services: [{ id: 'svc_x', name: 'Evil', folder: work, template: 'custom', program: path.join(tools, 'cmd.exe'), args: ['/c', 'calc'], port: 0 }] };
    const { svc, calls } = make({ stored });
    await expect(svc.start('svc_x')).rejects.toThrow(/runs whatever it is told/);
    expect(calls.spawn).toHaveLength(0);
    const st = await svc.status();
    expect(st.services[0].command).toContain('cmd.exe');       // shown to the owner as it is stored
  });

  it('the generic add() still refuses "custom" as a template (a window cannot name a program)', async () => {
    const { svc } = make();
    await svc.arm(true);
    const g = await svc.pickFolder();
    await expect(svc.add({ name: 'X', token: g.token, template: 'custom', params: { program: 'C:/Windows/System32/calc.exe' } })).rejects.toThrow(/not one of the commands/);
  });
});

describe('QEMU recipe', () => {
  const qemu = () => path.join(root, 'pf', 'qemu', 'qemu-system-x86_64.exe');
  const addVm = async (svc, params) => {
    await svc.arm(true);
    const g = await svc.pickFolder();
    return svc.add({ name: 'Test VM', token: g.token, template: 'qemu-vm', params });
  };

  it('builds only checked arguments, finds qemu in Program Files, and shows them', async () => {
    fs.writeFileSync(qemu(), '');
    const { svc, calls } = make();
    const r = await addVm(svc, { vmname: 'Test VM', disk: 'disk.qcow2', iso: 'boot.iso', memory: '4096', cpus: '4', accel: 'tcg', display: 'sdl', net: 'user' });
    expect(r.ok).toBe(true);
    const box = calls.confirm.at(-1);
    expect(box.message).toContain('qemu-system-x86_64 -name "Test VM" -m 4096 -smp 4 -accel tcg -display sdl -monitor none -drive file=disk.qcow2,format=qcow2,if=virtio -cdrom boot.iso -boot d -nic user,model=virtio-net-pci');
    expect(box.message).toContain(qemu());
    await svc.start(r.id);
    expect(calls.spawn[0].file).toBe(qemu());
    expect(calls.spawn[0].argv).toEqual(['-name', 'Test VM', '-m', '4096', '-smp', '4', '-accel', 'tcg', '-display', 'sdl', '-monitor', 'none', '-drive', 'file=disk.qcow2,format=qcow2,if=virtio', '-cdrom', 'boot.iso', '-boot', 'd', '-nic', 'user,model=virtio-net-pci']);
    expect(calls.spawn[0].opts.shell).toBe(false);
  });

  it('has safe defaults: whpx, gtk, no network, 2048 MB, 2 processors', async () => {
    fs.writeFileSync(qemu(), '');
    const { svc, calls } = make();
    await addVm(svc, { vmname: 'VM', disk: 'disk.qcow2' });
    expect(calls.confirm.at(-1).message).toContain('-m 2048 -smp 2 -accel whpx -display gtk -monitor none -drive file=disk.qcow2,format=qcow2,if=virtio -nic none');
  });

  it.each([
    ['a missing disk', { vmname: 'VM' }, /disk image is needed/],
    ['a disk outside the folder', { vmname: 'VM', disk: '../x.qcow2' }, /path inside the folder/],
    ['an option smuggled in with a comma', { vmname: 'VM', disk: 'disk.qcow2,file=C:/x' }, /not allowed|not the kind/],
    ['a disk of the wrong kind', { vmname: 'VM', disk: 'boot.iso' }, /not the kind of file/],
    ['an ISO that is not there', { vmname: 'VM', disk: 'disk.qcow2', iso: 'nope.iso' }, /not in that folder/],
    ['too little memory', { vmname: 'VM', disk: 'disk.qcow2', memory: '64' }, /whole number from 256/],
    ['too many processors', { vmname: 'VM', disk: 'disk.qcow2', cpus: '99' }, /whole number from 1 to 32/],
    ['a network mode with a forward', { vmname: 'VM', disk: 'disk.qcow2', net: 'user,hostfwd=tcp::22-:22' }, /one of: none, user/],
    ['a vnc display', { vmname: 'VM', disk: 'disk.qcow2', display: 'vnc=:0' }, /one of: gtk, sdl/],
    ['a name with a comma', { vmname: 'a,b', disk: 'disk.qcow2' }, /short name/],
  ])('refuses %s', async (_l, params, message) => {
    fs.writeFileSync(qemu(), '');
    const { svc, calls } = make();
    await expect(addVm(svc, params)).rejects.toThrow(message);
    expect(calls.saved.at(-1).services).toEqual([]);
  });

  it('says plainly when QEMU is not installed', async () => {
    const { svc } = make();
    await expect(addVm(svc, { vmname: 'VM', disk: 'disk.qcow2' })).rejects.toThrow(/qemu-system-x86_64 was not found/);
  });

  it('has no template field for raw options', () => {
    const { TEMPLATES } = require('../../src/main/local-services.js');
    expect(TEMPLATES['qemu-vm'].fields).toEqual(['vmname', 'disk', 'iso', 'memory', 'cpus', 'accel', 'display', 'net']);
  });
});

describe('wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('the new channels are in main, preload, schemas and policy, and take no program or path', () => {
    for (const ch of ['localsvc:pick-program', 'localsvc:add-custom']) {
      expect(src('src/main.js')).toContain("ipcMain.handle('" + ch + "'");
      expect(src('src/preload.js')).toContain("'" + ch + "'");
      expect(src('src/main/ipc-schemas.js')).toContain(ch);
      expect(src('src/main/ipc-policy.js')).toContain("'" + ch + "'");
    }
    const { validatePayload } = require('../../src/main/ipc-policy.js');
    expect(() => validatePayload('localsvc:add-custom', [{ name: 'A', token: 't', programToken: 'p', args: ['a'] }])).not.toThrow();
    expect(() => validatePayload('localsvc:add-custom', [{ name: 'A', token: 't', programToken: 'p', args: [1] }])).toThrow();
    expect(() => validatePayload('localsvc:add-custom', [{ name: 'A', token: 't' }])).toThrow();
    expect(() => validatePayload('localsvc:pick-program', ['C:/x.exe'])).toThrow();
  });
});
