// Audit A10: three graphics-process crashes switch hardware acceleration off at the NEXT start (before ready),
// safe mode starts with it off, and Settings can turn it back on. src/main/gpu-ladder.js, tested with an injected app.
import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGpuLadder, FILE } = require('../../src/main/gpu-ladder.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-gpu-')); });

function fakeApp(ready = false) {
  const a = { calls: 0, isReady: () => ready, disableHardwareAcceleration: () => { if (a.isReady()) throw new Error('too late'); a.calls++; } };
  return a;
}
const make = (over = {}) => createGpuLadder({ dir, fs, version: '1.2.3', now: () => 5000, log: () => {}, ...over });
const persist = (obj) => fs.writeFileSync(path.join(dir, 'vex-persist.json'), JSON.stringify(obj));

describe('counting', () => {
  it('writes the flag on the third crash of a session, not before', () => {
    const l = make();
    expect(l.noteGpuGone()).toEqual({ count: 1, tripped: false });
    expect(l.noteGpuGone().tripped).toBe(false);
    expect(fs.existsSync(path.join(dir, FILE))).toBe(false);
    expect(l.noteGpuGone()).toEqual({ count: 3, tripped: true });
    expect(JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'))).toMatchObject({ count: 3, version: '1.2.3', told: false });
    expect(l.noteGpuGone().tripped).toBe(false);          // written once
  });
  it('two crashes in each of two sessions do not add up (the count is per session)', () => {
    make().noteGpuGone(); make().noteGpuGone();
    expect(fs.existsSync(path.join(dir, FILE))).toBe(false);
  });
  it('an unwritable flag is reported and never throws', () => {
    const msgs = [];
    const bad = { ...fs, writeFileSync: () => { throw new Error('disk full'); } };
    const l = make({ fs: bad, log: (m) => msgs.push(m) });
    l.noteGpuGone(); l.noteGpuGone();
    expect(l.noteGpuGone().tripped).toBe(false);
    expect(msgs.join('\n')).toMatch(/could not write the fallback flag: disk full/);
  });
});

describe('the next start, before ready', () => {
  it('does nothing without a flag', () => {
    const app = fakeApp();
    expect(make().applyAtBoot({ app })).toEqual({ disabled: false, reason: null });
    expect(app.calls).toBe(0);
  });
  it('switches acceleration off when the flag is there', () => {
    const l = make(); l.noteGpuGone(); l.noteGpuGone(); l.noteGpuGone();
    const app = fakeApp();
    const r = make().applyAtBoot({ app });
    expect(r.disabled).toBe(true);
    expect(r.reason).toMatch(/crashed 3 times/);
    expect(app.calls).toBe(1);
  });
  it('--safe-mode and automatic safe mode start with it off, flag or not', () => {
    const a = fakeApp(), b = fakeApp();
    expect(make().applyAtBoot({ app: a, argv: ['x', '--safe-mode'] })).toMatchObject({ disabled: true, reason: 'safe mode' });
    expect(make().applyAtBoot({ app: b, safeMode: true })).toMatchObject({ disabled: true, reason: 'safe mode' });
    expect(a.calls + b.calls).toBe(2);
  });
  it('refuses to pretend after ready: reports it and does not call', () => {
    const app = fakeApp(true);
    const r = make().applyAtBoot({ app, safeMode: true });
    expect(r.disabled).toBe(false);
    expect(r.error).toMatch(/before Vex is ready/);
    expect(app.calls).toBe(0);
  });
  it('the Settings choice: on removes the flag and keeps acceleration, off keeps it off', () => {
    const l = make(); for (let i = 0; i < 3; i++) l.noteGpuGone();
    persist({ 'vex.gpuAccel': 'on' });
    const app = fakeApp();
    expect(make().applyAtBoot({ app }).disabled).toBe(false);
    expect(fs.existsSync(path.join(dir, FILE))).toBe(false);
    persist({ 'vex.gpuAccel': 'off' });
    expect(make().applyAtBoot({ app }).reason).toBe('you turned it off');
    expect(app.calls).toBe(1);
  });
  it('safe mode wins over the choice "on"', () => {
    persist({ 'vex.gpuAccel': 'on' });
    expect(make().applyAtBoot({ app: fakeApp(), safeMode: true }).disabled).toBe(true);
  });
  it('an unreadable flag or settings file never switches anything off, and says so', () => {
    const msgs = [];
    fs.writeFileSync(path.join(dir, FILE), '{nope');
    persist({});
    fs.writeFileSync(path.join(dir, 'vex-persist.json'), '{nope');
    const r = make({ log: (m) => msgs.push(m) }).applyAtBoot({ app: fakeApp() });
    expect(r.disabled).toBe(false);
    expect(msgs.join('\n')).toMatch(/not valid JSON/);
  });
});

describe('telling the owner once', () => {
  it('gives the notice once, then never again, and not for a choice', () => {
    const l = make(); for (let i = 0; i < 3; i++) l.noteGpuGone();
    const next = make();
    expect(next.takeNotice()).toEqual({ count: 3, at: 5000 });
    expect(make().takeNotice()).toBe(null);
    expect(fs.existsSync(path.join(dir, FILE))).toBe(true);     // still off until Settings says otherwise
  });
  it('does not say it when it cannot record that it did', () => {
    const l = make(); for (let i = 0; i < 3; i++) l.noteGpuGone();
    const bad = { ...fs, writeFileSync: () => { throw new Error('read-only'); } };
    expect(make({ fs: bad }).takeNotice()).toBe(null);
  });
  it('status tells Settings why', () => {
    const l = make(); for (let i = 0; i < 3; i++) l.noteGpuGone();
    expect(make().status()).toMatchObject({ crashFallback: true, count: 3 });
  });
});

describe('wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('is applied before ready, counts GPU children, and tells once through app:safe-mode', () => {
    const apply = main.indexOf('_gpuLadder.applyAtBoot');
    expect(apply).toBeGreaterThan(0);
    expect(apply).toBeLessThan(main.indexOf("_diagMark('app-ready')"));
    expect(main).toMatch(/if \(d\.type === 'GPU'\) _gpuLadder\.noteGpuGone\(\)/);
    expect(main).toMatch(/gpuNotice,\s*gpu: \{ off: _gpuBoot\.disabled/);
  });
  it('Settings has the switch and the manifest knows the key', () => {
    const ui = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/tabs-nav-settings.js'), 'utf8');
    expect(ui).toMatch(/'Hardware acceleration \(restart Vex to apply\)'/);
    expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/js/feature-manifests.js'), 'utf8')).toContain("'vex.gpuAccel'");
  });
});
