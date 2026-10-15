// @vitest-environment node
//
// "Start Vex when I sign in to Windows": the switch reports what Windows
// holds (read back after every write), the installed app only, one entry per
// profile, and "start minimised" is part of the entry itself. The real
// startup list is never touched: Electron's app is a fake here.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const { createLoginItem, isLoginLaunch, wantsMinimised, entryName, entryArgs } = require('../../src/main/login-item.js');

// A stand-in for Electron's app: a registry of name -> command line.
function fakeApp({ refuse = false } = {}) {
  const run = new Map();
  return {
    run,
    setLoginItemSettings({ openAtLogin, path: p, args, name }) {
      if (refuse) return;
      if (openAtLogin) run.set(name, JSON.stringify([p, ...args])); else run.delete(name);
    },
    getLoginItemSettings({ path: p, args, name }) {
      const on = run.get(name) === JSON.stringify([p, ...args]);
      return { openAtLogin: on, executableWillLaunchAtLogin: on };
    },
  };
}
const make = (over = {}) => createLoginItem({ app: fakeApp(), packaged: true, platform: 'win32', execPath: 'C:\\Vex\\Vex.exe', ...over });

describe('what is supported', () => {
  it('says why when this is a copy run from source', () => {
    const s = make({ packaged: false }).read();
    expect(s.supported).toBe(false);
    expect(s.reason).toMatch(/source folder/);
    expect(() => make({ packaged: false }).write(true, false)).toThrow(/source folder/);
  });
  it('is Windows only', () => {
    expect(make({ platform: 'linux' }).read().supported).toBe(false);
  });
});

describe('turning it on and off', () => {
  it('writes the entry and reads it back from the system', () => {
    const app = fakeApp();
    const li = createLoginItem({ app, packaged: true, platform: 'win32', execPath: 'C:\\Vex\\Vex.exe' });
    expect(li.read()).toMatchObject({ supported: true, openAtLogin: false, startMinimised: false });
    expect(li.write(true, false)).toMatchObject({ openAtLogin: true, startMinimised: false });
    expect(app.run.get('Vex')).toBe(JSON.stringify(['C:\\Vex\\Vex.exe', '--vex-login-start']));
    expect(li.write(true, true)).toMatchObject({ openAtLogin: true, startMinimised: true });
    expect(JSON.parse(app.run.get('Vex'))).toContain('--vex-start-minimised');
    expect(li.write(false, true)).toMatchObject({ openAtLogin: false, startMinimised: false });
    expect(app.run.has('Vex')).toBe(false);
  });
  it('shows an entry removed behind Vex’s back as off', () => {
    const app = fakeApp();
    const li = createLoginItem({ app, packaged: true, platform: 'win32', execPath: 'C:\\Vex\\Vex.exe' });
    li.write(true, false);
    app.run.clear();
    expect(li.read().openAtLogin).toBe(false);
  });
  it('raises an error when Windows did not take the entry, instead of saying it is on', () => {
    const li = createLoginItem({ app: fakeApp({ refuse: true }), packaged: true, platform: 'win32', execPath: 'C:\\Vex\\Vex.exe' });
    expect(() => li.write(true, false)).toThrow(/did not accept/);
  });
  it('wants two real switches', () => {
    expect(() => make().write('yes', false)).toThrow(/two on\/off values/);
  });
});

describe('profiles and the stub', () => {
  it('each profile has its own entry and its own profile argument', () => {
    expect(entryName('default')).toBe('Vex');
    expect(entryName('p-abcd1234')).toBe('Vex p-abcd1234');
    expect(entryArgs('p-abcd1234', true)).toEqual(['--vex-login-start', '--profile=p-abcd1234', '--vex-start-minimised']);
    expect(() => entryName('../x')).toThrow(/not safe/);
  });
  it('the stub keeps state in memory and never calls the system', () => {
    const app = { setLoginItemSettings() { throw new Error('touched the system'); }, getLoginItemSettings() { throw new Error('touched the system'); } };
    const li = createLoginItem({ app, packaged: false, platform: 'win32', stub: true });
    expect(li.write(true, true)).toMatchObject({ supported: true, openAtLogin: true, startMinimised: true, stub: true });
    expect(li.read().openAtLogin).toBe(true);
  });
});

describe('the launch it causes', () => {
  it('is told from a person starting Vex, and only minimises when asked', () => {
    expect(isLoginLaunch(['Vex.exe', '--vex-login-start'])).toBe(true);
    expect(isLoginLaunch(['Vex.exe'])).toBe(false);
    expect(wantsMinimised(['Vex.exe', '--vex-login-start', '--vex-start-minimised'])).toBe(true);
    expect(wantsMinimised(['Vex.exe', '--vex-start-minimised'])).toBe(false);
  });
  const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('does nothing to a running Vex, and is not carried into a restart', () => {
    expect(main).toMatch(/_loginItem\.isLoginLaunch\(commandLine\)\) \{[\s\S]{0,200}return;/);
    expect(main).not.toMatch(/app\.relaunch\(\);/);
    expect(main).toContain('_restartArgs()');
  });
});
