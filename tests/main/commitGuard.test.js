// T0-018: the commit-charge guard reads Windows' commit headroom and only ever
// reports a level; the response (Vex's own tabs, AI, background work) is the
// interface's, and no other program is touched.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const { readCommit, classify, thresholds, createCommitGuard } = require('../../src/main/commit-guard.js');

// getSystemMemoryInfo, as measured on the owner's machine (KB).
const owner = (freeGB, limitGB = 32.8) => ({ total: 16582764, free: 6503980, swapTotal: Math.round(limitGB * 1048576), swapFree: Math.round(freeGB * 1048576) });

describe('readCommit', () => {
  it('turns swapTotal/swapFree into the commit limit and what is left', () => {
    const s = readCommit(owner(20.7));
    expect(s.limitMB).toBe(33587);
    expect(s.availMB).toBe(Math.round(20.7 * 1024));
    expect(s.usedPct).toBeGreaterThan(30);
    expect(s.usedPct).toBeLessThan(45);
  });
  it('raises when Windows reports nothing usable, instead of guessing', () => {
    expect(() => readCommit({ total: 1, free: 1 })).toThrow(/did not report the commit limit/);
    expect(() => readCommit({ swapTotal: 0, swapFree: 0 })).toThrow(/did not report/);
  });
});

describe('classify', () => {
  it("the owner's 15 Oct numbers (33 GB limit, 6.7 GB left) are high", () => {
    expect(classify(readCommit(owner(6.7, 33)), 'ok')).toBe('high');
  });
  it('plenty left is ok, little left is critical', () => {
    expect(classify(readCommit(owner(21)), 'ok')).toBe('ok');
    expect(classify(readCommit(owner(3.2)), 'ok')).toBe('critical');
  });
  it('scales the lines on a small limit (a 16 GB limit has no 8 GB to spare)', () => {
    const t = thresholds(16 * 1024);
    expect(t.high).toBe(4);
    expect(t.critical).toBeCloseTo(1.92, 1);
  });
  it('a level is left only 1.5 GB above its line, so a hovering number does not flap', () => {
    expect(classify(readCommit(owner(8.5)), 'high')).toBe('high');
    expect(classify(readCommit(owner(9.6)), 'high')).toBe('ok');
    expect(classify(readCommit(owner(8.5)), 'ok')).toBe('ok');
    expect(classify(readCommit(owner(4.9)), 'critical')).toBe('critical');
    expect(classify(readCommit(owner(5.6)), 'critical')).toBe('high');
  });
});

describe('createCommitGuard', () => {
  it('reports each change of level once and nothing while the level holds', () => {
    let free = 21;
    const seen = [];
    const g = createCommitGuard({ info: () => owner(free), onLevel: (s) => seen.push(s.previous + '>' + s.level) });
    g.poll(); g.poll();
    free = 7; g.poll(); g.poll();
    free = 3; g.poll();
    free = 21; g.poll();
    expect(seen).toEqual(['ok>high', 'high>critical', 'critical>ok']);
    expect(g.state().level).toBe('ok');
  });
  it('raises when the read fails, and logs it', () => {
    const log = vi.fn();
    const g = createCommitGuard({ info: () => ({}), log });
    expect(() => g.poll()).toThrow(/did not report/);
    expect(log).toHaveBeenCalled();
  });
  it('a listener that throws does not stop the guard', () => {
    const log = vi.fn();
    const g = createCommitGuard({ info: () => owner(2), onLevel: () => { throw new Error('boom'); }, log });
    expect(g.poll().level).toBe('critical');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('listener failed'));
  });
});

describe('the guard in main.js never touches another program', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
  const block = src.slice(src.indexOf('const _commitGuard'), src.indexOf("app.on('will-quit', () => { try { _gameWatch.stop()"));
  it('does not kill, stop, signal or lower any process', () => {
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/\.kill\(|taskkill|setPriority|process\.kill|Stop-Process|exec\(/);
  });
  it('the module itself has no way to', () => {
    const mod = fs.readFileSync(path.resolve(__dirname, '../../src/main/commit-guard.js'), 'utf8');
    expect(mod).not.toMatch(/require\(|child_process|\.kill\(|setPriority/);
  });
});
