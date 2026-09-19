// src/main/game-watch.js — noticing a full-screen game the way Windows does.

import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const { createGameWatch, interpret, script } = require('../../src/main/game-watch.js');

function fakeSpawn() {
  const made = [];
  const spawn = vi.fn((cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.kill = vi.fn(() => child.emit('exit', 0));
    made.push({ cmd, args, opts, child });
    return child;
  });
  return { spawn, made };
}

describe('reading Windows\' answer', () => {
  it('exclusive full screen and borderless full screen are both a game', () => {
    expect(interpret('3|FortniteClient-Win64-Shipping', ['Vex'])).toMatchObject({ game: true, app: 'FortniteClient-Win64-Shipping' });
    expect(interpret('2|RobloxPlayerBeta', ['Vex'])).toMatchObject({ game: true });
  });
  it('an ordinary desktop is not', () => {
    for (const s of ['5|explorer', '1|', '6|Code', '4|POWERPNT']) expect(interpret(s, ['Vex']).game, s).toBe(false);
  });
  it('Vex itself going full screen (a video in a tab) is not a game', () => {
    expect(interpret('2|Vex', ['Vex', 'electron']).game).toBe(false);
    expect(interpret('2|electron', ['Vex', 'electron']).game).toBe(false);
    expect(interpret('2|vex', ['Vex']).game).toBe(false);          // case-insensitive
  });
  it('full screen with no window owner known is not claimed as a game', () => {
    expect(interpret('3|', []).game).toBe(false);
  });
});

describe('the helper process', () => {
  it('is hidden, runs the native check, and exits by itself when Vex is gone', () => {
    const src = script(4242);
    expect(src).toContain('SHQueryUserNotificationState');
    expect(src).toContain('Get-Process -Id 4242');
    expect(src).toMatch(/\{ exit \}/);
    const { spawn, made } = fakeSpawn();
    createGameWatch({ spawn, platform: 'win32', parentPid: 4242 }).start();
    expect(made[0].opts.windowsHide).toBe(true);
    expect(made[0].args).toContain('-EncodedCommand');
    const encoded = made[0].args[made[0].args.indexOf('-EncodedCommand') + 1];
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(src);
  });

  it('starts once, and not at all off Windows', async () => {
    const { spawn } = fakeSpawn();
    const w = createGameWatch({ spawn, platform: 'win32' });
    await w.start(); await w.start();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(await createGameWatch({ spawn, platform: 'linux' }).start()).toBe(false);
  });

  it('reports a change, and only a change', () => {
    const { spawn, made } = fakeSpawn();
    const onChange = vi.fn();
    const w = createGameWatch({ spawn, platform: 'win32', ownNames: ['Vex'], onChange });
    w.start();
    const out = made[0].child.stdout;
    out.emit('data', '5|explorer\n');
    out.emit('data', '3|Valo');           // split across chunks
    out.emit('data', 'rant\n');
    out.emit('data', '3|Valorant\n');
    out.emit('data', '5|Vex\n');
    expect(onChange.mock.calls.map(c => c[0])).toEqual([{ game: true, app: 'Valorant' }, { game: false, app: 'Vex' }]);
    expect(w.state()).toEqual({ game: false, app: 'Vex' });
  });

  it('a helper that dies mid-game must not leave Vex thinking the game is still on', () => {
    const { spawn, made } = fakeSpawn();
    const onChange = vi.fn();
    const w = createGameWatch({ spawn, platform: 'win32', onChange });
    w.start();
    made[0].child.stdout.emit('data', '3|Game\n');
    made[0].child.emit('exit', 1);
    expect(w.state().game).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith({ game: false, app: '' });
    expect(w.running()).toBe(false);
  });

  it('stopping kills the helper', () => {
    const { spawn, made } = fakeSpawn();
    const w = createGameWatch({ spawn, platform: 'win32' });
    w.start(); w.stop();
    expect(made[0].child.kill).toHaveBeenCalled();
    expect(w.running()).toBe(false);
  });
});

describe('the compiled helper', () => {
  const { ensureHelper, CSHARP } = require('../../src/main/game-watch.js');
  const path = require('path');
  const crypto = require('crypto');

  function memFs(files = {}) {
    return {
      files,
      existsSync: (p) => p in files,
      readFileSync: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
      writeFileSync: (p, d) => { files[p] = String(d); },
      mkdirSync: () => {},
    };
  }
  const CSC = path.join('C:/Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

  it('is compiled once with Windows\' own C# compiler, then reused', async () => {
    const fs = memFs({ [CSC]: '' });
    const execFile = vi.fn((cmd, args, opts, cb) => { fs.files[args.find(a => a.startsWith('/out:')).slice(5)] = 'MZ'; cb(null); });
    const deps = { fs, path, crypto, execFile, dir: 'D:/vex/helpers', windir: 'C:/Windows' };
    const exe = await ensureHelper(deps);
    expect(exe).toBe(path.join('D:/vex/helpers', 'vex-game-watch.exe'));
    expect(execFile.mock.calls[0][0]).toBe(CSC);
    expect(execFile.mock.calls[0][2].windowsHide).toBe(true);
    expect(await ensureHelper(deps)).toBe(exe);
    expect(execFile).toHaveBeenCalledTimes(1);                 // reused, not rebuilt
  });

  it('is rebuilt when its source changes', async () => {
    const fs = memFs({ [CSC]: '', [path.join('D', 'vex-game-watch.exe')]: 'MZ', [path.join('D', 'vex-game-watch.exe.sha256')]: 'an-old-hash' });
    const execFile = vi.fn((c, a, o, cb) => cb(null));
    await ensureHelper({ fs, path, crypto, execFile, dir: 'D', windir: 'C:/Windows' });
    expect(execFile).toHaveBeenCalled();
    expect(fs.files[path.join('D', 'vex-game-watch.exe.sha256')]).toBe(crypto.createHash('sha256').update(CSHARP).digest('hex'));
  });

  it('no compiler, or a failed build, means null — and the PowerShell fallback', async () => {
    expect(await ensureHelper({ fs: memFs(), path, crypto, execFile: vi.fn(), dir: 'D', windir: 'C:/Windows' })).toBe(null);
    const failing = vi.fn((c, a, o, cb) => cb(new Error('csc exploded')));
    expect(await ensureHelper({ fs: memFs({ [CSC]: '' }), path, crypto, execFile: failing, dir: 'D', windir: 'C:/Windows' })).toBe(null);
  });

  it('the watcher runs the helper when there is one, PowerShell when not', async () => {
    const a = fakeSpawn();
    await createGameWatch({ spawn: a.spawn, platform: 'win32', parentPid: 99, helper: async () => 'D:/h/vex-game-watch.exe' }).start();
    expect(a.made[0].cmd).toBe('D:/h/vex-game-watch.exe');
    expect(a.made[0].args).toEqual(['99', '5']);
    expect(a.made[0].opts.windowsHide).toBe(true);
    const b = fakeSpawn();
    await createGameWatch({ spawn: b.spawn, platform: 'win32', helper: async () => null }).start();
    expect(b.made[0].cmd).toBe('powershell.exe');
  });

  it('two starts while the helper is still building launch ONE process, the light one', async () => {
    const { spawn, made } = fakeSpawn();
    let finish;
    const w = createGameWatch({ spawn, platform: 'win32', helper: () => new Promise(r => { finish = r; }) });
    const p1 = w.start();
    const p2 = w.start();
    finish('D:/h/vex-game-watch.exe');
    await Promise.all([p1, p2]);
    expect(made).toHaveLength(1);
    expect(made[0].cmd).toBe('D:/h/vex-game-watch.exe');
  });

  it('the C# source checks the same two things, and exits when Vex is gone', () => {
    expect(CSHARP).toContain('SHQueryUserNotificationState');
    expect(CSHARP).toContain('GetForegroundWindow');
    expect(CSHARP).toMatch(/GetProcessById\(parent\); \} catch \{ return 0; \}/);
  });
});
