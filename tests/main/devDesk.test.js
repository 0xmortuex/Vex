// The developer desk's main-process rules (src/main/dev-desk.js): off by default, an allowlist of
// programs, an argument array, only inside granted folders. Real temp folders, a recording launcher.
// The program finders build Windows paths, so these tests run on the Windows host Vex ships on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDevDesk } = require('../../src/main/dev-desk');

let dir, repo, outside, saved, launched, desk, env;
const memStore = () => ({
  read: async () => (saved == null ? null : JSON.parse(JSON.stringify(saved))),
  write: async (k, v) => { saved = JSON.parse(JSON.stringify(v)); return true; },
});

beforeEach(() => {
  saved = null; launched = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-devdesk-'));
  repo = path.join(dir, 'my repo & co');
  outside = path.join(dir, 'outside');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'x');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(path.join(bin, 'Programs', 'Microsoft VS Code'), { recursive: true });
  fs.mkdirSync(path.join(bin, 'Microsoft', 'WindowsApps'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'Programs', 'Microsoft VS Code', 'Code.exe'), '');
  fs.writeFileSync(path.join(bin, 'Microsoft', 'WindowsApps', 'wt.exe'), '');
  env = { LOCALAPPDATA: bin };
  desk = createDevDesk({ store: memStore(), launch: async (exe, args) => { launched.push({ exe, args }); }, fs, path, env });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const codeExe = () => env.LOCALAPPDATA + '\\Programs\\Microsoft VS Code\\Code.exe';

describe('switch and allowlist', () => {
  it('is off by default and refuses everything', async () => {
    await desk.grantRoot(repo);
    await expect(desk.openFile({ path: path.join(repo, 'src', 'a.js') })).rejects.toThrow(/switched off/);
    await expect(desk.openTerminal(repo)).rejects.toThrow(/switched off/);
    await expect(desk.branch(repo)).rejects.toThrow(/switched off/);
    expect(launched).toEqual([]);
  });
  it('refuses a program that is not on the list', async () => {
    await expect(desk.setConfig({ editor: 'powershell' })).rejects.toThrow(/not on the list/);
    await expect(desk.setConfig({ terminal: 'cmd' })).rejects.toThrow(/not on the list/);
  });
  it('refuses a drive root and a network folder as a grant', async () => {
    await expect(desk.grantRoot(path.parse(repo).root)).rejects.toThrow(/whole drive/);
    await expect(desk.grantRoot('\\\\server\\share')).rejects.toThrow(/network/);
  });
});

describe('opening', () => {
  beforeEach(async () => {
    await desk.grantRoot(repo);
    await desk.setConfig({ enabled: true, editor: 'vscode', terminal: 'wt' });
  });

  it('refuses a file outside the granted folders', async () => {
    await expect(desk.openFile({ path: path.join(outside, 'secret.txt') })).rejects.toThrow(/not inside a folder you granted/);
    expect(launched).toEqual([]);
  });
  it('refuses a relative path, a missing file and a folder', async () => {
    await expect(desk.openFile({ path: 'src/a.js' })).rejects.toThrow(/not valid/);
    await expect(desk.openFile({ path: path.join(repo, 'nope.js') })).rejects.toThrow(/does not exist/);
    await expect(desk.openFile({ path: path.join(repo, 'src') })).rejects.toThrow(/not a file/);
  });
  it('refuses a ..-escape that resolves outside', async () => {
    await expect(desk.openFile({ path: path.join(repo, '..', 'outside', 'secret.txt') })).rejects.toThrow(/not inside a folder you granted/);
  });
  it('starts the editor with an argument array, a path with spaces and & stays one argument', async () => {
    await desk.openFile({ path: path.join(repo, 'src', 'a.js'), line: 12, col: 3 });
    expect(launched).toHaveLength(1);
    expect(launched[0].exe).toBe(codeExe());
    expect(launched[0].args[0]).toBe('--goto');
    expect(launched[0].args).toHaveLength(2);
    expect(launched[0].args[1].endsWith('a.js:12:3')).toBe(true);
    expect(launched[0].args[1]).toContain('my repo & co');
  });
  it('rejects a bad line number', async () => {
    await expect(desk.openFile({ path: path.join(repo, 'src', 'a.js'), line: -4 })).rejects.toThrow(/line number/);
  });
  it('opens a terminal in a granted folder only', async () => {
    await desk.openTerminal(repo);
    expect(launched[0].args).toEqual(['-d', fs.realpathSync(repo)]);
    await expect(desk.openTerminal(outside)).rejects.toThrow(/not inside a folder you granted/);
  });
  it('reads the branch from .git/HEAD only', async () => {
    expect(await desk.branch(repo)).toMatchObject({ ok: true, branch: 'feature/x', detached: false });
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'a'.repeat(40) + '\n');
    expect(await desk.branch(repo)).toMatchObject({ branch: 'aaaaaaa', detached: true });
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'garbage');
    await expect(desk.branch(repo)).rejects.toThrow(/not in a form/);
  });
  it('names the missing program instead of failing quietly', async () => {
    fs.rmSync(path.join(env.LOCALAPPDATA, 'Programs'), { recursive: true });
    await expect(desk.openFile({ path: path.join(repo, 'src', 'a.js') })).rejects.toThrow(/was not found/);
  });
  it('revoking a folder closes it again', async () => {
    await desk.revokeRoot(fs.realpathSync(repo));
    await expect(desk.openTerminal(repo)).rejects.toThrow(/not inside a folder you granted/);
  });
});
