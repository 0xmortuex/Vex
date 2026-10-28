// The debugger switch on an extension's card (src/main/extension-grants.js), 2026-10-28: off until the person turns it on, per extension.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const G = createRequire(import.meta.url)('../../src/main/extension-grants.js');
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-grants-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the grants file', () => {
  it('nothing is allowed when there is no file yet', () => {
    expect(G.read(dir)).toEqual({ debugger: {}, nativeMessaging: {} });
    expect(G.has(G.read(dir), 'debugger', 'claude-1')).toBe(false);
  });
  it('turning it on and off for one extension, and the file keeps it', () => {
    let s = G.set(G.read(dir), 'debugger', 'claude-1', true);
    G.write(dir, s);
    expect(G.has(G.read(dir), 'debugger', 'claude-1')).toBe(true);
    expect(G.has(G.read(dir), 'debugger', 'other-2')).toBe(false);
    s = G.set(G.read(dir), 'debugger', 'claude-1', false);
    G.write(dir, s);
    expect(G.read(dir)).toEqual({ debugger: {}, nativeMessaging: {} });
  });
  it('turning one on leaves another extension\'s switch as it was', () => {
    let s = G.set(G.read(dir), 'debugger', 'a-1', true);
    s = G.set(s, 'debugger', 'b-2', true);
    s = G.set(s, 'debugger', 'a-1', false);
    expect(s.debugger).toEqual({ 'b-2': true });
  });
  it('only a literal true counts: a file edited to "yes", 1 or "true" allows nothing', () => {
    fs.writeFileSync(path.join(dir, G.FILE), JSON.stringify({ debugger: { a: 'yes', b: 1, c: 'true', d: true, e: false } }));
    expect(G.read(dir)).toEqual({ debugger: { d: true }, nativeMessaging: {} });
  });
  it('a corrupt file is an error to report, never a silent allow', () => {
    fs.writeFileSync(path.join(dir, G.FILE), '[1,2]');
    expect(() => G.read(dir)).toThrow(/corrupt/);
    fs.writeFileSync(path.join(dir, G.FILE), '{not json');
    expect(() => G.read(dir)).toThrow();
  });
  it('refuses a grant it does not know and a missing extension', () => {
    expect(() => G.set({ debugger: {} }, 'cookies', 'a', true)).toThrow(/Unknown grant/);
    expect(() => G.set({ debugger: {} }, 'debugger', '', true)).toThrow(/needs an extension/);
  });
  it('writing leaves no half-written file behind', () => {
    G.write(dir, { debugger: { a: true } });
    expect(fs.readdirSync(dir)).toEqual([G.FILE]);
  });
});

describe('the wiring in the main process', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('the debugger operations check the permission and use the switch; the list tells the card', () => {
    expect(main).toMatch(/case 'debugger\.attach': case 'debugger\.detach': case 'debugger\.sendCommand': case 'debugger\.getTargets': \{\s*needPerm\('debugger'\);/);
    expect(main).toMatch(/allowed: \(folder\) => _extGrants\.has\(_extGrantState\(\), 'debugger', folder\)/);
    expect(main).toMatch(/wantsDebugger: .*includes\('debugger'\)/);
    expect(main).toMatch(/debuggerAllowed: _extGrants\.has\(_extGrantState\(\), 'debugger', e\.folder\)/);
  });
  it('switching it off, and unloading an extension, let go of every tab it holds', () => {
    expect(main).toMatch(/if \(request\.grant === 'debugger' && request\.on !== true\) _extDebugger\.stop\(\{ folder \}\);/);
    expect(main).toMatch(/function _unloadFromAllSessions\(extPath\) \{\r?\n  _extDebugger\.stop\(\{ folder: path\.basename\(extPath\) \}\);/);
  });
  it('the channels are declared and only the window can use them', () => {
    const { validate } = createRequire(import.meta.url)('../../src/main/ipc-schemas.js');
    expect(() => validate('extensions:set-grant', [{ folder: 'claude-1', grant: 'debugger', on: true }])).not.toThrow();
    expect(() => validate('extensions:set-grant', [{ folder: 'claude-1', grant: 'cookies', on: true }])).toThrow();
    expect(() => validate('extensions:debug-stop', [{ tabId: 6, extId: 'abc' }])).not.toThrow();
    expect(() => validate('extensions:debug-stop', [{ tabId: 'six', extId: 'abc' }])).toThrow();
  });
});
