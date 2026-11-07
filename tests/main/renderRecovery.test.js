// Audit A1: the Vex window's own renderer dying left a blank window and Task Manager as the only exit.
// src/main/render-recovery.js decides (pure) and acts (fake window here; the real-Electron proof is a probe).
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { decideRecovery, createRenderRecovery } = require('../../src/main/render-recovery.js');
const { createExitWatch } = require('../../src/main/exit-kinds.js');

const NOW = 1_000_000_000;
const crashed = { reason: 'crashed', exitCode: -1073741819 };

describe('decideRecovery', () => {
  it('ignores what is not a crash', () => {
    expect(decideRecovery({ details: { reason: 'clean-exit', exitCode: 0 }, now: NOW, notCrash: 'it exited cleanly' }).action).toBe('ignore');
    expect(decideRecovery({ details: crashed, now: NOW, notCrash: 'Vex was quitting' }).action).toBe('ignore');
    expect(decideRecovery({ details: null, now: NOW }).action).toBe('ignore');
  });
  it('reloads the first crash', () => {
    expect(decideRecovery({ details: crashed, history: [], now: NOW }).action).toBe('reload');
    expect(decideRecovery({ details: { reason: 'oom', exitCode: 0 }, history: [], now: NOW }).action).toBe('reload');
  });
  it('offers safe mode on the second crash within five minutes, never a reload', () => {
    const d = decideRecovery({ details: crashed, history: [NOW - 4 * 60000], now: NOW });
    expect(d.action).toBe('offer-safe-mode');
    expect(d.recent).toBe(2);
    expect(decideRecovery({ details: crashed, history: [NOW - 1000, NOW - 500], now: NOW }).action).toBe('offer-safe-mode');
  });
  it('a crash more than five minutes after the last one is a first crash again', () => {
    expect(decideRecovery({ details: crashed, history: [NOW - 5 * 60000 - 1], now: NOW }).action).toBe('reload');
  });
  it('makes the window again when it cannot be reloaded', () => {
    expect(decideRecovery({ details: crashed, history: [], now: NOW, alive: false }).action).toBe('recreate');
  });
  it('needs a time', () => { expect(() => decideRecovery({ details: crashed })).toThrow(/time/); });
});

function rig(over = {}) {
  const wc = new EventEmitter();
  wc.reloads = 0;
  wc.reload = over.reload || (() => { wc.reloads++; });
  const win = { webContents: wc, isDestroyed: () => !!over.destroyed };
  const calls = { recreate: 0, safe: 0, logged: [] };
  let t = NOW;
  const exitWatch = over.exitWatch || createExitWatch();
  const history = over.history || [];
  const answers = over.answers || [1];
  const guard = createRenderRecovery({
    win, history, exitWatch,
    dialog: { showMessageBox: async () => ({ response: answers.shift() }) },
    crashLog: { add: (k, d) => calls.logged.push([k, d]) },
    recreate: () => { calls.recreate++; }, restartSafe: () => { calls.safe++; },
    closing: () => !!over.closing, now: () => t, log: () => {},
  });
  return { wc, guard, calls, history, advance: (ms) => { t += ms; } };
}

describe('createRenderRecovery', () => {
  it('reloads the window once and writes it in the crash log', () => {
    const r = rig();
    r.wc.emit('render-process-gone', {}, crashed);
    expect(r.wc.reloads).toBe(1);
    expect(r.calls.logged[0][0]).toBe('Vex window recovered');
  });
  it('does not touch a clean exit, nor a window that is closing for good', () => {
    const r = rig({ closing: true });
    r.wc.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    r.wc.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 });
    expect(r.wc.reloads).toBe(0);
    expect(r.calls.logged).toEqual([]);
    const q = rig();
    q.guard.onGone({ reason: 'killed', exitCode: 1 });         // not closing: a crash
    expect(q.wc.reloads).toBe(1);
  });
  it('does nothing for a destroyed window', () => {
    const r = rig({ destroyed: true });
    expect(r.guard.onGone(crashed).action).toBe('ignore');
    expect(r.wc.reloads).toBe(0);
  });
  it('never loops: the second crash asks instead of reloading', async () => {
    const r = rig({ answers: [2] });
    r.guard.onGone(crashed);
    r.advance(30000);
    const d = r.guard.onGone(crashed);
    expect(d.action).toBe('offer-safe-mode');
    await new Promise(res => setTimeout(res, 5));
    expect(r.wc.reloads).toBe(1);
    expect(r.calls.recreate + r.calls.safe).toBe(0);           // "Do nothing" does nothing
  });
  it('the answers: safe mode restarts, fresh window makes it again', async () => {
    for (const [answer, safe, fresh] of [[0, 1, 0], [1, 0, 1]]) {
      const r = rig({ answers: [answer], history: [NOW - 1000] });
      r.guard.onGone(crashed);
      await new Promise(res => setTimeout(res, 5));
      expect([r.calls.safe, r.calls.recreate]).toEqual([safe, fresh]);
    }
  });
  it('a crash Vex caused itself (the hang guard) is not counted', () => {
    const r = rig();
    r.guard.expectCrash();
    expect(r.guard.onGone(crashed).action).toBe('ignore');
    expect(r.history).toEqual([]);
    expect(r.guard.onGone(crashed).action).toBe('reload');
  });
  it('a reload that throws makes the window again instead of staying blank', () => {
    const r = rig({ reload: () => { throw new Error('gone'); } });
    r.guard.onGone(crashed);
    expect(r.calls.recreate).toBe(1);
  });
  it('the history is shared, so a window made again keeps the count', () => {
    const history = [];
    const a = rig({ history });
    a.guard.onGone(crashed);
    const b = rig({ history, answers: [2] });
    expect(b.guard.onGone(crashed).action).toBe('offer-safe-mode');
  });
});

describe('wiring in main.js', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('is attached to the main window, ahead of the hang guard, and the hang guard announces its forced crash', () => {
    expect(main).toMatch(/createRenderRecovery\(\{[\s\S]*createWindowHangGuard\(\{[^]*beforeForcedCrash/);
    expect(main).toMatch(/if \(mainWindow === _thisWin\) mainWindow = null/);
    const hang = fs.readFileSync(path.join(__dirname, '../../src/main/window-hang.js'), 'utf8');
    expect(hang.indexOf('beforeForcedCrash()')).toBeLessThan(hang.indexOf('forcefullyCrashRenderer()'));
  });
});
