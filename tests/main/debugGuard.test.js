// @vitest-environment node
//
// Refusing remote debugging of a real profile (src/main/debug-guard.js).
// Which command-line spellings Chromium really treats as the switch was
// measured in real Electron (see the commit message): "--n=v", "--n v", "-N=v",
// "/n=v" are all seen by app.commandLine, "--" ends the switches.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const g = require('../../src/main/debug-guard.js');
const probe = require('../../scripts/lib/probe-profile.js');

const EXE = 'C:\\Program Files\\Vex\\Vex.exe';
let tmp, profile, env;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-dbgguard-'));
  profile = path.join(tmp, 'profile');
  // Real Vex folders of an imaginary user, outside the temp folder (tests that need them under it say so).
  env = { APPDATA: 'C:\Users\nobody\AppData\Roaming', LOCALAPPDATA: 'C:\Users\nobody\AppData\Local' };
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const decide = (over) => g.decide({ packaged: true, argv: [EXE], userData: profile, env, tmpdir: os.tmpdir(), fs, ...over });

describe('which arguments count as a debugging switch', () => {
  const names = (argv) => g.debugSwitchesIn([EXE, ...argv]).map(s => s.name);
  it('sees every spelling Chromium accepts', () => {
    expect(names(['--remote-debugging-port=9222'])).toEqual(['remote-debugging-port']);
    expect(names(['--remote-debugging-port', '9222'])).toEqual(['remote-debugging-port']);
    expect(names(['-Remote-Debugging-Port=9222'])).toEqual(['remote-debugging-port']);
    expect(names(['/remote-debugging-port=9222'])).toEqual(['remote-debugging-port']);
    expect(names(['--remote-debugging-pipe'])).toEqual(['remote-debugging-pipe']);
    expect(names(['--remote-allow-origins=*'])).toEqual(['remote-allow-origins']);
    expect(names(['--remote-debugging-address=0.0.0.0'])).toEqual(['remote-debugging-address']);
    expect(names(['--inspect'])).toEqual(['inspect']);
    expect(names(['--inspect=9229', '--inspect-brk=9230', '--inspect_brk'])).toEqual(['inspect', 'inspect-brk', 'inspect-brk']);
    expect(names(['--inspect-port=1', '--inspect-publish-uid=http', '--debug-brk'])).toEqual(['inspect-port', 'inspect-publish-uid', 'debug-brk']);
  });
  it('ignores everything else, and anything after a bare "--"', () => {
    expect(names(['--user-data-dir=C:\\x', '--profile=work', '--updated', 'https://example.com/?remote-debugging-port=1', '--inspector-skin'])).toEqual([]);
    expect(names(['--', '--remote-debugging-port=9222'])).toEqual([]);
    expect(names([])).toEqual([]);
    expect(g.debugSwitchesIn(undefined)).toEqual([]);
  });
});

describe('the decision', () => {
  it('lets a launch with no debugging switch through, packaged or not', () => {
    expect(decide({ argv: [EXE, '--profile=work'] })).toMatchObject({ action: 'allow', found: [] });
    expect(decide({ packaged: false, argv: [EXE] }).action).toBe('allow');
  });
  it('does not touch a source/dev run, whatever the profile', () => {
    expect(decide({ packaged: false, argv: [EXE, '.', '--remote-debugging-port=9222'] })).toMatchObject({ action: 'allow', reason: 'not a packaged build' });
  });
  it('refuses a packaged build on the default profile, for each flag', () => {
    for (const flag of ['--remote-debugging-port=9222', '--remote-debugging-port 9222'.split(' ')[0], '--remote-debugging-pipe', '--remote-allow-origins=*', '--inspect', '--inspect-brk=1', '/remote-debugging-port=1']) {
      const d = decide({ argv: [EXE, flag] });
      expect(d.action, flag).toBe('refuse');
      expect(d.found.length).toBe(1);
    }
    expect(g.refusalMessage(decide({ argv: [EXE, '--remote-debugging-port=1'] }))).toMatch(/will not start with --remote-debugging-port/);
  });
  it('refuses a temp profile that was not made by the harness (no marker, wrong nonce, nonce missing)', () => {
    fs.mkdirSync(profile);
    const argv = [EXE, '--user-data-dir=' + profile, '--remote-debugging-port=9222'];
    expect(decide({ argv }).action).toBe('refuse');
    const prep = probe.prepare(profile);
    expect(decide({ argv, env: { ...env, ...prep.env } }).action).toBe('allow');
    expect(decide({ argv, env }).action).toBe('refuse');
    expect(decide({ argv, env: { ...env, VEX_PROBE_NONCE: 'f'.repeat(32) } }).action).toBe('refuse');
    // a marker that is not the harness format
    fs.writeFileSync(path.join(profile, g.PROBE_MARKER), '{"v":1,"nonce":"short"}');
    expect(decide({ argv, env: { ...env, VEX_PROBE_NONCE: 'short' } }).action).toBe('refuse');
    fs.writeFileSync(path.join(profile, g.PROBE_MARKER), 'not json');
    expect(decide({ argv, env: { ...env, VEX_PROBE_NONCE: 'x' } }).action).toBe('refuse');
  });
  it('allows the harness profile in each switch spelling', () => {
    const prep = probe.prepare(profile);
    const e = { ...env, ...prep.env };
    for (const dbg of [['--remote-debugging-port=0'], ['--remote-debugging-port', '0'], ['-Remote-Debugging-Port=0'], ['--remote-debugging-pipe'], ['--inspect=0']]) {
      expect(decide({ argv: [EXE, '--user-data-dir=' + profile, ...dbg], env: e }).action, dbg.join(' ')).toBe('allow');
    }
  });
  it('requires --user-data-dir on the command line, naming the profile actually in use', () => {
    const e = { ...env, ...probe.prepare(profile).env };
    expect(decide({ argv: [EXE, '--remote-debugging-port=1'], env: e }).reason).toMatch(/not given with --user-data-dir/);
    expect(decide({ argv: [EXE, '--user-data-dir=' + path.join(tmp, 'other'), '--remote-debugging-port=1'], env: e }).reason).toMatch(/does not name the profile in use/);
    expect(decide({ argv: [EXE, '--user-data-dir=', '--remote-debugging-port=1'], env: e }).action).toBe('refuse');
  });
  it('refuses a profile outside the temp folder, even with a valid marker', () => {
    const outside = path.join(os.homedir(), 'vex-dbgguard-notmp-' + process.pid);
    try {
      fs.mkdirSync(outside, { recursive: true });
      const marker = JSON.stringify({ v: 1, nonce: 'a'.repeat(32) });
      fs.writeFileSync(path.join(outside, g.PROBE_MARKER), marker);
      const d = decide({ userData: outside, env: { ...env, VEX_PROBE_NONCE: 'a'.repeat(32) }, argv: [EXE, '--user-data-dir=' + outside, '--remote-debugging-port=1'] });
      expect(d).toMatchObject({ action: 'refuse', reason: 'the profile is not inside the temp folder' });
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
  it('refuses a profile inside a real Vex folder even when that folder is under the temp folder', () => {
    const inTmp = { APPDATA: path.join(tmp, 'Roaming'), LOCALAPPDATA: path.join(tmp, 'Local') };
    const real = path.join(inTmp.APPDATA, 'Vex');
    fs.mkdirSync(real, { recursive: true });
    const e = { ...inTmp, VEX_PROBE_NONCE: 'b'.repeat(32) };
    fs.writeFileSync(path.join(real, g.PROBE_MARKER), JSON.stringify({ v: 1, nonce: 'b'.repeat(32) }));
    const d = decide({ userData: real, env: e, argv: [EXE, '--user-data-dir=' + real, '--remote-debugging-port=1'] });
    expect(d).toMatchObject({ action: 'refuse', reason: 'the profile is inside a real Vex folder' });
  });
  it('distrusts a temp folder that contains the real Vex folders (TEMP pointed at the profile parent)', () => {
    const e = { ...probe.prepare(profile).env, APPDATA: path.join(tmp, 'Roaming'), LOCALAPPDATA: path.join(tmp, 'Local') };
    fs.mkdirSync(path.join(tmp, 'Roaming', 'Vex'), { recursive: true });
    // tmp itself plays the role of the OS temp folder, and it holds %APPDATA%\Vex
    const d = g.decide({ packaged: true, argv: [EXE, '--user-data-dir=' + profile, '--remote-debugging-port=1'], userData: profile, env: e, tmpdir: tmp, fs });
    expect(d).toMatchObject({ action: 'refuse', reason: 'the temp folder contains a real Vex folder' });
  });
  it('judges a junction/symlink by where it really points', () => {
    const outside = path.join(os.homedir(), 'vex-dbgguard-real-' + process.pid);
    const inTmp = { APPDATA: path.join(outside, 'Roaming'), LOCALAPPDATA: path.join(outside, 'Local') };
    const real = path.join(inTmp.APPDATA, 'Vex');
    fs.mkdirSync(real, { recursive: true });
    const link = path.join(tmp, 'looks-temporary');
    try {
      fs.symlinkSync(real, link, 'junction');
      const e = { ...inTmp, ...probe.prepare(link).env };
      const d = decide({ userData: link, env: e, tmpdir: os.tmpdir(), argv: [EXE, '--user-data-dir=' + link, '--remote-debugging-port=1'] });
      expect(d).toMatchObject({ action: 'refuse', reason: 'the profile is not inside the temp folder' });   // its real location is outside the temp folder
    } finally { fs.rmSync(link, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  });
});

describe('the stale DevToolsActivePort file', () => {
  it('is deleted when present, and quietly left alone when absent', () => {
    fs.mkdirSync(profile);
    const file = path.join(profile, 'DevToolsActivePort');
    fs.writeFileSync(file, '9222\n/devtools/browser/abc');
    const log = { warn: () => {} };
    expect(g.removeStaleDevToolsPort({ fs, userData: profile, log })).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(g.removeStaleDevToolsPort({ fs, userData: profile, log })).toBe(false);
  });
  it('reports a deletion that fails instead of throwing or stopping Vex', () => {
    const warned = [];
    const failing = { existsSync: () => true, rmSync: () => { throw new Error('EBUSY'); } };
    expect(g.removeStaleDevToolsPort({ fs: failing, userData: profile, log: { warn: (...a) => warned.push(a.join(' ')) } })).toBe(false);
    expect(warned.join()).toMatch(/EBUSY/);
  });
});

describe('the harness and the dev scripts', () => {
  it('prepare() refuses a folder outside the temp folder and a real profile', () => {
    expect(() => probe.prepare(path.join(os.homedir(), 'not-temp'))).toThrow(/must be a folder under/);
    expect(() => probe.prepare(path.join(process.env.APPDATA || os.homedir(), 'vex', 'x'))).toThrow();
  });
  it('every script that opens a debugging port marks its throwaway profile', () => {
    const root = path.join(__dirname, '..', '..');
    for (const rel of ['scripts/lib/probe-harness.js', 'scripts/verify-reminders.js', 'scripts/turkish-scan/cdp.mjs', 'scripts/turkish-scan/start.mjs']) {
      expect(fs.readFileSync(path.join(root, rel), 'utf8'), rel).toMatch(/probe-profile/);
    }
  });
  it('the marker name and env name match between the app and the harness', () => {
    expect(probe.MARKER).toBe(g.PROBE_MARKER);
    expect(probe.NONCE_ENV).toBe(g.NONCE_ENV);
  });
  it('main.js runs the guard right after the profile is chosen and before the first window', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
    const at = src.indexOf("require('./main/debug-guard')");
    expect(at).toBeGreaterThan(src.indexOf("'[Profiles] this is profile'"));
    expect(at).toBeLessThan(src.indexOf('new BrowserWindow('));
    expect(at).toBeLessThan(src.indexOf('app.whenReady()'));
  });
});
