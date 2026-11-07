// src/main/os-hook.js: "when X happens in Vex, run this program". A fake spawn, a fake hash, fake dialogs, a fake
// clock and fake timers: no real program is ever started and no real file is read.
import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const H = require('../../src/main/os-hook.js');

const EXE = 'C:\\Tools\\notify.exe';
const HASH1 = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);
const BASE_ENV = { SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', PATH: 'C:\\Windows', SECRET_TOKEN: 'do-not-pass', ELECTRON_RUN_AS_NODE: '1', AWS_SECRET_ACCESS_KEY: 'nope' };

// A fake child: the test decides when it ends.
function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = () => { c.killed = true; };
  return c;
}

function build({ confirmAnswer = true, hash = HASH1, files = {}, pickPath = EXE, platform = 'win32', saved = null, spawnThrows = null } = {}) {
  let t = 1_000_000;
  const timers = [];
  const children = [];
  const spawnCalls = [];
  const confirms = [];
  const state = { hash, saved };
  const hook = H.createOsHook({
    fs: { promises: { stat: async () => ({ isFile: () => true }) } },
    platform, path: require('path').win32, env: BASE_ENV, tmpDir: 'C:\\Temp',
    spawn: (file, args, opts) => { spawnCalls.push({ file, args, opts }); if (spawnThrows) throw spawnThrows; const c = fakeChild(); children.push(c); return c; },
    hashFile: async () => { if (state.hash instanceof Error) throw state.hash; return { sha256: state.hash, size: 10 }; },
    confirm: async (o) => { confirms.push(o); return typeof confirmAnswer === 'function' ? confirmAnswer(o) : confirmAnswer; },
    pickProgramDialog: async () => ({ canceled: pickPath === null, path: pickPath }),
    load: async () => state.saved,
    save: async (cfg) => { state.saved = JSON.parse(JSON.stringify(cfg)); },
    now: () => t, randomId: () => 'tok1',
    setTimer: (fn, ms) => { const id = timers.length; timers.push({ fn, ms, cleared: false }); return id; },
    clearTimer: (id) => { if (timers[id]) timers[id].cleared = true; },
    log: () => {}, timeoutMs: 30000,
  });
  return { hook, advance: (ms) => { t += ms; }, timers, children, spawnCalls, confirms, state, files };
}

// Switch on, pick, add a rule for `event`.
async function setUp(t, event = 'download-finished', args = ['--flag', 'value with space']) {
  await t.hook.setEnabled(true);
  const picked = await t.hook.pickProgram();
  await t.hook.add({ event, token: picked.token, args });
}

describe('sanitizeFileName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['C:\\Users\\me\\Downloads\\report.pdf', 'report.pdf'],
    ['/home/me/report (1).pdf', 'report (1).pdf'],
    ['a;rm -rf *.txt', 'a_rm -rf _.txt'],
    ['a&b|c>d<e.zip', 'a_b_c_d_e.zip'],
    ['tab\tnew\nline\u0000nul.txt', 'tab_new_line_nul.txt'],
    ['Türkçe dosya ğüşiöç.txt', 'Türkçe dosya ğüşiöç.txt'],
    ['', '_'],
    [undefined, '_'],
    ['///', '_'],
  ])('%j -> %j', (input, expected) => { expect(H.sanitizeFileName(input)).toBe(expected); });
  it('is at most 120 characters', () => { expect(H.sanitizeFileName('a'.repeat(500) + '.zip')).toHaveLength(120); });
});

describe('buildEnv: what the program is told', () => {
  it('passes only the ordinary variables plus VEX_EVENT; nothing secret from the environment', () => {
    const env = H.buildEnv('reminder-fired', { fileName: 'ignored.txt' }, BASE_ENV);
    expect(env).toEqual({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', PATH: 'C:\\Windows', VEX_EVENT: 'reminder-fired' });
    expect(JSON.stringify(env)).not.toContain('do-not-pass');
  });
  it('a download adds the cleaned file name, and only a download does', () => {
    expect(H.buildEnv('download-finished', { fileName: 'C:\\x\\a;b.zip' }, BASE_ENV).VEX_FILE_NAME).toBe('a_b.zip');
    expect(H.buildEnv('exam-armed', { fileName: 'a.zip' }, BASE_ENV).VEX_FILE_NAME).toBeUndefined();
  });
});

describe('quietPartition: private, Tor and routed sessions', () => {
  it.each([
    ['persist:main', false, false],
    ['persist:container-work', false, false],
    ['private-abc123', false, true],
    ['tor-1', false, true],
    ['persist:route-tor', false, true],
    ['persist:container-tor-1', false, true],
    [undefined, false, true],
    ['', false, true],
    ['persist:main', true, true],
  ])('%j (ephemeral %j) -> %j', (partition, ephemeral, quiet) => { expect(H.quietPartition(partition, ephemeral)).toBe(quiet); });
});

describe('checkArgs', () => {
  it('a short list of plain text', () => {
    expect(H.checkArgs(['a', 'b c'])).toEqual(['a', 'b c']);
    expect(H.checkArgs(undefined)).toEqual([]);
  });
  it.each([['not a list'], [Array(9).fill('x')], [[5]], [['x'.repeat(201)]], [['line\nbreak']], [['nul\u0000']]])('refuses %j', (args) => {
    expect(() => H.checkArgs(args)).toThrow();
  });
});

describe('switching on, picking, adding', () => {
  it('is off by default and does nothing until switched on', async () => {
    const t = build();
    expect((await t.hook.status()).enabled).toBe(false);
    expect(await t.hook.fire('download-finished', { fileName: 'a.zip', partition: 'persist:main' })).toEqual({ ran: false, why: 'off' });
    await expect(t.hook.pickProgram()).rejects.toThrow(/switch the program hook on/i);
    expect(t.spawnCalls).toHaveLength(0);
  });

  it('switching on asks in a box of main\'s; a no leaves it off and saves nothing', async () => {
    const t = build({ confirmAnswer: false });
    const r = await t.hook.setEnabled(true);
    expect(r.canceled).toBe(true);
    expect(r.enabled).toBe(false);
    expect(t.confirms).toHaveLength(1);
    expect(t.state.saved).toBeNull();
  });

  it('adding shows the full path, the SHA-256 and every argument, and saves only after a yes', async () => {
    const t = build();
    await setUp(t);
    const add = t.confirms[1];
    expect(add.message).toContain('Program: ' + EXE);
    expect(add.message).toContain('SHA-256: ' + HASH1);
    expect(add.message).toContain('--flag | value with space');
    expect(add.message).toContain('Event: A download finished');
    expect(add.message).toContain('the file name');
    expect(t.state.saved.rules['download-finished']).toEqual({ program: EXE, sha256: HASH1, args: ['--flag', 'value with space'] });
    expect(t.state.saved.enabled).toBe(true);
  });

  it('a no on the add box saves no rule', async () => {
    const t = build({ confirmAnswer: (o) => !/^Allow this program/.test(o.title) });
    await t.hook.setEnabled(true);
    const picked = await t.hook.pickProgram();
    const r = await t.hook.add({ event: 'ci-red', token: picked.token, args: [] });
    expect(r.canceled).toBe(true);
    expect(t.state.saved.rules).toEqual({});
  });

  it('the program has to come from the dialog: a token is single-use, wrong tokens and old tokens fail', async () => {
    const t = build();
    await t.hook.setEnabled(true);
    const picked = await t.hook.pickProgram();
    await expect(t.hook.add({ event: 'ci-red', token: 'guess', args: [] })).rejects.toThrow(/choose the program again/i);
    const again = await t.hook.pickProgram();
    t.advance(6 * 60 * 1000);
    await expect(t.hook.add({ event: 'ci-red', token: again.token, args: [] })).rejects.toThrow(/choose the program again/i);
    expect(picked.token).toBe('tok1');
    const third = await t.hook.pickProgram();
    await t.hook.add({ event: 'ci-red', token: third.token, args: [] });
    await expect(t.hook.add({ event: 'exam-armed', token: third.token, args: [] })).rejects.toThrow(/choose the program again/i);
  });

  it('refuses shells and script hosts, scripts, relative paths and anything that is not an .exe', async () => {
    for (const bad of ['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Windows\\System32\\wscript.exe', 'C:\\Windows\\System32\\mshta.exe', 'C:\\Windows\\System32\\rundll32.exe', 'C:\\Tools\\run.bat', 'C:\\Tools\\run.cmd', 'C:\\Tools\\run.ps1', 'C:\\Tools\\run.vbs', 'C:\\Tools\\run.js', 'notify.exe', 'tools\\notify.exe']) {
      const t = build({ pickPath: bad });
      await t.hook.setEnabled(true);
      await expect(t.hook.pickProgram(), bad).rejects.toThrow();
    }
  });

  it('a cancelled dialog is not an error', async () => {
    const t = build({ pickPath: null });
    await t.hook.setEnabled(true);
    expect(await t.hook.pickProgram()).toEqual({ canceled: true });
  });

  it('only the four events exist, and arguments are checked again in main', async () => {
    const t = build();
    await t.hook.setEnabled(true);
    const picked = await t.hook.pickProgram();
    await expect(t.hook.add({ event: 'app-quit', token: picked.token, args: [] })).rejects.toThrow(/not an event/);
    await expect(t.hook.add({ event: 'ci-red', token: picked.token, args: ['a\nb'] })).rejects.toThrow(/argument/i);
  });

  it('remove forgets a rule', async () => {
    const t = build();
    await setUp(t);
    await t.hook.remove('download-finished');
    expect(t.state.saved.rules).toEqual({});
    await expect(t.hook.remove('nope')).rejects.toThrow();
  });

  it('a damaged saved rule is dropped, not trusted', async () => {
    const t = build({ saved: { enabled: true, rules: { 'ci-red': { program: EXE, sha256: 'short', args: [] }, 'exam-armed': { program: EXE, sha256: HASH1, args: ['a\nb'] } } } });
    const st = await t.hook.status();
    expect(st.enabled).toBe(true);
    expect(st.events.every(e => e.rule === null)).toBe(true);
  });
});

describe('fire: when the event happens', () => {
  const download = { fileName: 'C:\\Users\\me\\Downloads\\a;b.zip', partition: 'persist:main', ephemeral: false };

  it('starts exactly the approved file with exactly the approved arguments, no shell, and nothing from the event on the command line', async () => {
    const t = build();
    await setUp(t);
    const done = t.hook.fire('download-finished', download);
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(1));
    const call = t.spawnCalls[0];
    expect(call.file).toBe(EXE);
    expect(call.args).toEqual(['--flag', 'value with space']);
    expect(call.opts.shell).toBe(false);
    expect(call.opts.windowsHide).toBe(true);
    expect(call.opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(call.opts.env).toEqual({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', PATH: 'C:\\Windows', VEX_EVENT: 'download-finished', VEX_FILE_NAME: 'a_b.zip' });
    expect(JSON.stringify(call.args)).not.toContain('a_b');
    expect(JSON.stringify(call.args)).not.toContain('zip');
    t.children[0].emit('close', 0, null);
    expect(await done).toEqual({ ran: true, why: 'done' });
    expect((await t.hook.status()).events[0].last).toMatchObject({ code: 0, timedOut: false });
  });

  it.each([
    ['a private window download', { fileName: 'a.zip', partition: 'private-abc', ephemeral: true }],
    ['a Tor tab download', { fileName: 'a.zip', partition: 'tor-1', ephemeral: true }],
    ['a routed tab download', { fileName: 'a.zip', partition: 'persist:route-tor', ephemeral: false }],
    ['a download that does not say where it came from', { fileName: 'a.zip' }],
  ])('never runs for %s', async (_label, data) => {
    const t = build();
    await setUp(t);
    expect(await t.hook.fire('download-finished', data)).toEqual({ ran: false, why: 'private' });
    expect(t.spawnCalls).toHaveLength(0);
  });

  it('an event with no rule, an unknown event, or a hook that is off runs nothing', async () => {
    const t = build();
    await setUp(t);
    expect(await t.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'no-rule' });
    expect(await t.hook.fire('app-quit', {})).toEqual({ ran: false, why: 'unknown-event' });
    const off = build({ saved: { enabled: false, rules: { 'ci-red': { program: EXE, sha256: HASH1, args: [] } } } });
    expect(await off.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'off' });
    expect(t.spawnCalls.length + off.spawnCalls.length).toBe(0);
  });

  it('one run at a time, and a pause between runs of the same event', async () => {
    const t = build();
    await setUp(t, 'ci-red', []);
    const first = t.hook.fire('ci-red', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(1));
    expect(await t.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'busy' });
    t.children[0].emit('close', 0, null);
    await first;
    t.advance(H.COOLDOWN_MS - 1);
    expect(await t.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'cooldown' });
    t.advance(2);
    const third = t.hook.fire('ci-red', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(2));
    t.children[1].emit('close', 0, null);
    expect((await third).ran).toBe(true);
  });

  it('caps the output it keeps', async () => {
    const t = build();
    await setUp(t, 'exam-armed', []);
    const done = t.hook.fire('exam-armed', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(1));
    t.children[0].stdout.emit('data', 'x'.repeat(H.MAX_OUTPUT));
    t.children[0].stderr.emit('data', 'y'.repeat(5000));
    t.children[0].emit('close', 1, null);
    await done;
    const last = (await t.hook.status()).events.find(e => e.event === 'exam-armed').last;
    expect(last.output).toHaveLength(H.MAX_OUTPUT);
    expect(last.code).toBe(1);
  });

  it('a program that runs too long is ended and the next run is not blocked', async () => {
    const t = build();
    await setUp(t, 'reminder-fired', []);
    const done = t.hook.fire('reminder-fired', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(1));
    expect(t.timers[0].ms).toBe(30000);
    t.timers[0].fn();                         // the deadline
    expect(t.children[0].killed).toBe(true);
    t.children[0].emit('close', null, 'SIGTERM');
    expect(await done).toEqual({ ran: true, why: 'timeout' });
    expect((await t.hook.status()).events.find(e => e.event === 'reminder-fired').last.timedOut).toBe(true);
  });

  it('a program that will not end is given up on after a grace period', async () => {
    const t = build();
    await setUp(t, 'reminder-fired', []);
    const done = t.hook.fire('reminder-fired', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(1));
    t.timers[0].fn();
    expect(t.timers[1].ms).toBe(H.KILL_GRACE_MS);
    t.timers[1].fn();                         // it never closed
    expect(await done).toEqual({ ran: true, why: 'timeout' });
    t.advance(H.COOLDOWN_MS + 1);
    const next = t.hook.fire('reminder-fired', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(2));
    t.children[1].emit('close', 0, null);
    expect((await next).why).toBe('done');
  });

  it('a program that cannot start is reported, not thrown', async () => {
    const t2 = build({ spawnThrows: new Error('EACCES') });
    await setUp(t2, 'ci-red', []);
    expect(await t2.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'spawn-failed' });
    expect((await t2.hook.status()).events.find(e => e.event === 'ci-red').last.error).toMatch(/EACCES/);
  });

  it('an error event from the child ends the run', async () => {
    const t = build();
    await setUp(t, 'ci-red', []);
    const done = t.hook.fire('ci-red', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(1));
    t.children[0].emit('error', new Error('ENOENT'));
    expect(await done).toEqual({ ran: true, why: 'error' });
  });
});

describe('fire: the file is checked against the approved SHA-256 every time', () => {
  it('a changed file is NOT run; the person sees both hashes; a no is remembered for the session', async () => {
    const t = build({ confirmAnswer: (o) => !/has changed/.test(o.title) });
    await setUp(t, 'ci-red', []);
    t.state.hash = HASH2;
    t.confirms.length = 0;
    expect(await t.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'changed' });
    expect(t.spawnCalls).toHaveLength(0);
    expect(t.confirms).toHaveLength(1);
    expect(t.confirms[0].message).toContain('Approved: ' + HASH1);
    expect(t.confirms[0].message).toContain('Now: ' + HASH2);
    expect(t.confirms[0].message).toContain('Program: ' + EXE);
    // Asked once: the same changed file is not asked about again this session.
    t.advance(H.COOLDOWN_MS + 1);
    expect(await t.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'changed' });
    expect(t.confirms).toHaveLength(1);
    expect(t.spawnCalls).toHaveLength(0);
  });

  it('a yes runs it and trusts the new hash from then on', async () => {
    const t = build();
    await setUp(t, 'ci-red', []);
    t.state.hash = HASH2;
    t.confirms.length = 0;
    const done = t.hook.fire('ci-red', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(1));
    t.children[0].emit('close', 0, null);
    await done;
    expect(t.confirms).toHaveLength(1);
    expect(t.state.saved.rules['ci-red'].sha256).toBe(HASH2);
    t.advance(H.COOLDOWN_MS + 1);
    const again = t.hook.fire('ci-red', {});
    await vi.waitFor(() => expect(t.spawnCalls).toHaveLength(2));
    t.children[1].emit('close', 0, null);
    await again;
    expect(t.confirms).toHaveLength(1);
  });

  it('a file that is gone or unreadable is not run and says why', async () => {
    const t = build();
    await setUp(t, 'ci-red', []);
    t.state.hash = new Error('ENOENT: no such file');
    expect(await t.hook.fire('ci-red', {})).toEqual({ ran: false, why: 'unreadable' });
    expect(t.spawnCalls).toHaveLength(0);
    expect((await t.hook.status()).events.find(e => e.event === 'ci-red').last.error).toMatch(/could not be checked/);
  });
});

describe('createFileHasher', () => {
  const makeFs = (size, chunks, failWith) => ({
    promises: { stat: async () => ({ isFile: () => size >= 0, size }) },
    createReadStream: () => {
      const s = new EventEmitter();
      setImmediate(() => { if (failWith) { s.emit('error', failWith); return; } for (const c of chunks) s.emit('data', Buffer.from(c)); s.emit('end'); });
      return s;
    },
  });
  it('hashes the whole file, chunk by chunk', async () => {
    const hash = H.createFileHasher({ fs: makeFs(6, ['abc', 'def']) });
    const expected = require('crypto').createHash('sha256').update('abcdef').digest('hex');
    expect(await hash('x.exe')).toEqual({ sha256: expected, size: 6 });
  });
  it('refuses a file over the limit rather than hashing part of it', async () => {
    const hash = H.createFileHasher({ fs: makeFs(100, ['x']), maxBytes: 50 });
    await expect(hash('x.exe')).rejects.toThrow(/too large/);
  });
  it('refuses something that is not a file, and passes a read error on', async () => {
    await expect(H.createFileHasher({ fs: makeFs(-1, []) })('x')).rejects.toThrow(/not a file/);
    await expect(H.createFileHasher({ fs: makeFs(3, [], new Error('EIO')) })('x')).rejects.toThrow(/EIO/);
  });
});

describe('the channels', () => {
  it('the window can report only exam-armed and ci-red, and never names a program or a file', async () => {
    const handlers = new Map();
    const hook = { fire: vi.fn(async () => ({ ran: false })), status: vi.fn(async () => ({})), setEnabled: vi.fn(async () => ({})), pickProgram: vi.fn(async () => ({})), add: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) };
    H.registerOsHookIpc({ ipcMain: { handle: (n, f) => handlers.set(n, f) }, hook });
    expect([...handlers.keys()].sort()).toEqual(['oshook:add', 'oshook:event', 'oshook:pick-program', 'oshook:remove', 'oshook:set-enabled', 'oshook:status']);
    expect(await handlers.get('oshook:event')({}, { event: 'download-finished' })).toMatchObject({ ok: false });
    expect(await handlers.get('oshook:event')({}, { event: 'reminder-fired' })).toMatchObject({ ok: false });
    expect(await handlers.get('oshook:event')({}, null)).toMatchObject({ ok: false });
    expect(hook.fire).not.toHaveBeenCalled();
    expect(await handlers.get('oshook:event')({}, { event: 'ci-red', program: 'C:\\evil.exe', fileName: 'x' })).toEqual({ ok: true });
    expect(hook.fire).toHaveBeenCalledWith('ci-red', {});
    await handlers.get('oshook:add')({}, { event: 'ci-red', token: 't', args: ['a'], program: 'C:\\evil.exe' });
    expect(hook.add).toHaveBeenCalledWith({ event: 'ci-red', token: 't', args: ['a'] });
    await handlers.get('oshook:set-enabled')({}, 'yes');
    expect(hook.setEnabled).toHaveBeenCalledWith(false);
  });
});
