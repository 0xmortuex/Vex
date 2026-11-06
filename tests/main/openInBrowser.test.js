// Open an address in another browser (src/main/open-in-browser.js): what may leave, which browsers are found, and that the
// address reaches the program as ONE argument. Nothing here starts a browser: spawn and the default opener are fakes.
import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const ob = require('../../src/main/open-in-browser');

const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };

function fakeSpawn(fail) {
  const calls = [];
  const spawn = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    const child = new EventEmitter();
    child.unref = vi.fn();
    setImmediate(() => (fail ? child.emit('error', new Error('ENOENT')) : child.emit('spawn')));
    return child;
  };
  return { spawn, calls };
}

describe('checkUrl', () => {
  it('accepts http and https and returns the normalised address', () => {
    expect(ob.checkUrl('https://example.com/a b?x=1#f')).toBe('https://example.com/a%20b?x=1#f');
    expect(ob.checkUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
  });
  it('refuses everything else', () => {
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-settings:network', 'calc.exe', '', null, 42, 'vex://settings', 'ftp://x/y', '-url https://x'])
      expect(() => ob.checkUrl(bad)).toThrow();
  });
  it('refuses an address over 8192 characters', () => {
    expect(() => ob.checkUrl('https://example.com/' + 'a'.repeat(9000))).toThrow(/8192/);
  });
  it('leaves no quote or space in what is handed over', () => {
    const href = ob.checkUrl('https://example.com/p"q r?x="y z"');
    expect(href).not.toMatch(/["\s]/);
  });
});

describe('detect', () => {
  it('finds a browser at its fixed path and takes the first path that exists', () => {
    const present = new Set(['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe']);
    const found = ob.detect({ env, exists: (p) => present.has(p) });
    expect(found.map(b => b.id)).toEqual(['edge', 'chrome']);
    expect(found[1].exe).toBe('C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
  });
  it('finds none when nothing exists, and ignores a relative base from the environment', () => {
    expect(ob.detect({ env, exists: () => false })).toEqual([]);
    expect(ob.detect({ env: { ProgramFiles: 'relative\\dir' }, exists: () => true })).toEqual([]);
  });
});

describe('createOpener', () => {
  const installed = [{ id: 'firefox', name: 'Mozilla Firefox', exe: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' }];
  it('hands the default browser the checked address', async () => {
    const openDefault = vi.fn(async () => {});
    const { spawn, calls } = fakeSpawn();
    const o = ob.createOpener({ openDefault, spawn, detectImpl: () => installed });
    expect(await o.open('https://example.com/x', 'default')).toEqual({ ok: true });
    expect(openDefault).toHaveBeenCalledWith('https://example.com/x');
    expect(calls).toEqual([]);
  });
  it('starts a named browser with the address as one argument, no shell', async () => {
    const { spawn, calls } = fakeSpawn();
    const o = ob.createOpener({ openDefault: vi.fn(), spawn, detectImpl: () => installed });
    const hostile = 'https://example.com/?a=1&b=%22%20--new-window%20calc.exe&c=|whoami';
    expect(await o.open(hostile, 'firefox')).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].exe).toBe(installed[0].exe);
    expect(calls[0].args).toHaveLength(1);
    expect(calls[0].args[0]).toBe(new URL(hostile).href);
    expect(calls[0].opts.shell).toBe(false);
  });
  it('refuses a browser that is not installed, a bad address, and does not start anything', async () => {
    const openDefault = vi.fn();
    const { spawn, calls } = fakeSpawn();
    const o = ob.createOpener({ openDefault, spawn, detectImpl: () => installed });
    expect((await o.open('https://example.com/', 'edge')).ok).toBe(false);
    expect((await o.open('file:///C:/x', 'firefox')).ok).toBe(false);
    expect((await o.open('file:///C:/x', 'default')).ok).toBe(false);
    expect((await o.open('https://example.com/', '../../evil')).ok).toBe(false);
    expect(calls).toEqual([]);
    expect(openDefault).not.toHaveBeenCalled();
  });
  it('says so when the program cannot be started', async () => {
    const { spawn } = fakeSpawn(true);
    const o = ob.createOpener({ openDefault: vi.fn(), spawn, detectImpl: () => installed });
    const r = await o.open('https://example.com/', 'firefox');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not be started/);
  });
  it('lists ids and names but never a path', () => {
    const o = ob.createOpener({ openDefault: vi.fn(), spawn: vi.fn(), detectImpl: () => installed });
    expect(o.list()).toEqual([{ id: 'firefox', name: 'Mozilla Firefox' }]);
  });
});

describe('the channels', () => {
  const fs = require('fs'), path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  it('are described, exposed and limited to Vex’s own window', () => {
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('browsers:open'/);
    expect(read('src/preload.js')).toMatch(/invoke\('browsers:open'/);
    expect(read('src/main/ipc-policy.js')).toMatch(/'browsers:list', 'browsers:open'/);
  });
});
