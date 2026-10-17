// T3-122 (Wave 6): a scheduled task and a shortcut in a Startup folder are resolved to the program they start, so the
// signature check covers them too. Everything here is a stand-in: no registry, no Windows, no real task list.
import { describe, it, expect, vi } from 'vitest';
const sc = require('../../src/main/startup-check.js');

const files = new Set(['C:\\Program Files\\Backup\\run.exe', 'C:\\Tools\\sync.exe', 'C:\\Windows\\System32\\cmd.exe']);
const fakeFs = {
  statSync(p) {
    if (!files.has(p)) { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; }
    return { isFile: () => true };
  },
};
const env = { windir: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' };

describe('programFromCommand', () => {
  it('reads a quoted program, an unquoted one and an environment variable, and nothing from a non-program', () => {
    expect(sc.programFromCommand('"C:\\Program Files\\Backup\\run.exe" --nightly', env)).toBe('C:\\Program Files\\Backup\\run.exe');
    expect(sc.programFromCommand('C:\\Tools\\sync.exe /quiet', env)).toBe('C:\\Tools\\sync.exe');
    expect(sc.programFromCommand('%windir%\\System32\\cmd.exe /c something', env)).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(sc.programFromCommand('COM handler', env)).toBe('');
    expect(sc.programFromCommand('', env)).toBe('');
  });
});

describe('the verbose task list', () => {
  const line = (name, run) => ['HOST', name, 'N/A', 'Ready', 'Interactive only', 'N/A', '267011', 'Me', run, 'N/A', 'x'].map(c => '"' + c.replace(/"/g, '""') + '"').join(',');
  it('maps a task name to what it runs, the first row of a task winning', () => {
    const out = [line('\\Backup', '"C:\\Program Files\\Backup\\run.exe" --nightly'), line('\\Backup', 'other'), line('\\Odd', 'COM handler'), '', '"HostName","TaskName"'].join('\r\n');
    const m = sc.parseSchtasksCommands(out);
    expect(m.get('\\Backup')).toBe('"C:\\Program Files\\Backup\\run.exe" --nightly');
    expect(m.get('\\Odd')).toBe('COM handler');
    expect(m.size).toBe(2);
  });
  it('asks Windows with a fixed argument list, nothing from outside, and says why when it cannot', async () => {
    const execFile = vi.fn((file, args, opts, cb) => cb(null, line('\\Backup', 'C:\\Tools\\sync.exe'), ''));
    const m = await sc.taskCommands({ execFile });
    expect(execFile.mock.calls[0][0]).toBe('schtasks');
    expect(execFile.mock.calls[0][1]).toEqual(['/query', '/fo', 'csv', '/v', '/nh']);
    expect(m.get('\\Backup')).toBe('C:\\Tools\\sync.exe');
    const failing = vi.fn((file, args, opts, cb) => cb(new Error('denied'), '', 'ERROR: Access is denied'));
    await expect(sc.taskCommands({ execFile: failing })).rejects.toThrow(/could not be read/);
  });
});

describe('targetOf for tasks and shortcuts', () => {
  it('finds the program of a task from its command, with the way it was found', () => {
    expect(sc.targetOf({ kind: 'task', name: '\\Backup' }, { env, fsMod: fakeFs, taskCommand: '"C:\\Program Files\\Backup\\run.exe" --nightly' })).toEqual({ path: 'C:\\Program Files\\Backup\\run.exe', via: 'task' });
  });
  it('says why for a task with no command, a COM handler, several actions, or a program that is gone', () => {
    expect(sc.targetOf({ kind: 'task', name: '\\A' }, { env, fsMod: fakeFs }).why).toMatch(/not in the list/);
    expect(sc.targetOf({ kind: 'task', name: '\\A' }, { env, fsMod: fakeFs, taskCommand: 'COM handler' }).why).toMatch(/com handler/);
    expect(sc.targetOf({ kind: 'task', name: '\\A' }, { env, fsMod: fakeFs, taskCommand: 'Multiple actions' }).why).toMatch(/multiple actions/);
    expect(sc.targetOf({ kind: 'task', name: '\\A' }, { env, fsMod: fakeFs, taskCommand: '"C:\\Gone\\x.exe"' }).why).toMatch(/not there any more/);
  });
  it('resolves a shortcut to its target when it can be read, and says why when it cannot', () => {
    const item = { kind: 'folder', name: 'Sync.lnk', data: 'C:\\Users\\a\\Startup' };
    const ok = sc.targetOf(item, { env, fsMod: fakeFs, readShortcut: (f) => { expect(f).toBe('C:\\Users\\a\\Startup\\Sync.lnk'); return { target: 'C:\\Tools\\sync.exe', args: '/q' }; } });
    expect(ok).toEqual({ path: 'C:\\Tools\\sync.exe', via: 'shortcut' });
    expect(sc.targetOf(item, { env, fsMod: fakeFs, readShortcut: () => ({ target: '' }) }).why).toMatch(/does not point to a program/);
    expect(sc.targetOf(item, { env, fsMod: fakeFs, readShortcut: () => { throw new Error('bad link'); } }).why).toMatch(/could not be read \(bad link\)/);
    // with no reader the old answer stands, so nothing is guessed
    expect(sc.targetOf(item, { env, fsMod: fakeFs }).why).toMatch(/shortcut is not signed itself/);
  });
});

describe('checkSignatures covers tasks and shortcuts', () => {
  const items = [
    { id: 'task|b', kind: 'task', name: '\\Backup', data: '' },
    { id: 'task|c', kind: 'task', name: '\\Odd', data: '' },
    { id: 'folder|u|Sync.lnk', kind: 'folder', name: 'Sync.lnk', data: 'C:\\Users\\a\\Startup' },
  ];
  const run = (extra = {}) => sc.checkSignatures({
    scanFn: async () => ({ ok: true, items }), env, fsMod: fakeFs,
    signatureOf: vi.fn(async (p) => (p.endsWith('run.exe') ? { status: 'NotSigned', signer: '' } : { status: 'Valid', signer: 'Example Ltd' })),
    readShortcut: () => ({ target: 'C:\\Tools\\sync.exe' }),
    taskCommandsFn: async () => new Map([['\\Backup', '"C:\\Program Files\\Backup\\run.exe"'], ['\\Odd', 'COM handler']]),
    ...extra,
  });
  it('checks the program behind each, flags an unsigned one, and keeps a reason for the rest', async () => {
    const r = await run();
    const by = Object.fromEntries(r.results.map(x => [x.id, x]));
    expect(by['task|b']).toMatchObject({ path: 'C:\\Program Files\\Backup\\run.exe', via: 'task', status: 'NotSigned', unsigned: true });
    expect(by['folder|u|Sync.lnk']).toMatchObject({ path: 'C:\\Tools\\sync.exe', via: 'shortcut', status: 'Valid', signer: 'Example Ltd' });
    expect(by['task|c']).toMatchObject({ status: 'unchecked', unsigned: false });
    expect(by['task|c'].why).toMatch(/com handler/);
    expect(r).toMatchObject({ ok: true, checked: 2, unsigned: 1 });
  });
  it('does not ask for the task list when there is no task, and reports a failed read instead of hiding it', async () => {
    const taskCommandsFn = vi.fn(async () => new Map());
    await run({ taskCommandsFn, scanFn: async () => ({ ok: true, items: [items[2]] }) });
    expect(taskCommandsFn).not.toHaveBeenCalled();
    const r = await run({ taskCommandsFn: async () => { throw new Error('The programs the scheduled tasks run could not be read: denied'); } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/could not be read: denied/) });
  });
  it('without the new helpers the earlier behaviour is unchanged', async () => {
    const r = await run({ readShortcut: null, taskCommandsFn: null });
    expect(r.results.every(x => x.status === 'unchecked')).toBe(true);
  });
});
