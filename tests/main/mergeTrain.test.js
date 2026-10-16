// T0-001: the merge train (scripts/merge-train.js).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('../../scripts/merge-train.js');

describe('chunk and bisect', () => {
  it('cuts batches of at most 10 and refuses more', () => {
    expect(T.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(T.chunk(Array.from({ length: 25 }, (_, i) => i), 10).map(b => b.length)).toEqual([10, 10, 5]);
    expect(() => T.chunk([1], 11)).toThrow(/1 to 10/);
    expect(() => T.chunk([1], 0)).toThrow();
  });
  it('finds the first failing prefix in about log2(n) runs', () => {
    for (let culprit = 1; culprit <= 10; culprit++) {
      let calls = 0;
      const k = T.firstFailingPrefix(10, (n) => { calls++; return n >= culprit; });
      expect(k).toBe(culprit);
      expect(calls).toBeLessThanOrEqual(4);
    }
    expect(T.firstFailingPrefix(1, () => true)).toBe(1);
  });
  it('reads a branch list from commas, lines and comments', () => {
    expect(T.parseBranchList('a, b\n# skip\nc # why\n\nb')).toEqual(['a', 'b', 'c']);
  });
});

describe('safety', () => {
  it('only a train/ branch may be built on, never main or master', () => {
    expect(() => T.assertTrainTarget('train/20261016')).not.toThrow();
    for (const b of ['main', 'master', 'origin/main', 'integration-2', 'train/', 'feature/x']) expect(() => T.assertTrainTarget(b), b).toThrow();
  });
  it('the script never pushes, publishes or releases', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'merge-train.js'), 'utf8')
      .split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(src).not.toMatch(/['"]push['"]/);
    expect(src).not.toMatch(/release\.js|npm run publish|['"]publish['"]|upload-release/);
    expect(src).not.toMatch(/--force|-f['"]/);
  });
  it('the CI sequence is the workflow\'s, in order, on Node 22', () => {
    const names = T.ciSteps({ vitestPath: 'x' }).map(s => s.name);
    expect(names).toEqual(['check:source', 'check:types', 'lint', 'tests (Node 22)', 'smoke', 'smoke:restart', 'audit (prod)']);
    expect(T.ciSteps({ vitestPath: 'x', withPack: true }).map(s => s.name)).toContain('pack');
  });
});

// A fake git: HEAD is the list of merged branches; `conflict` branches fail to merge.
function fakeRepo({ conflict = [], bad = [] } = {}) {
  let head = [];
  const snapshots = new Map([['S0', []]]);
  const git = (args) => {
    const [cmd] = args;
    if (cmd === 'rev-parse') { const id = 'S' + head.join('+'); snapshots.set(id, head.slice()); return { status: 0, stdout: id, stderr: '' }; }
    if (cmd === 'reset') { head = snapshots.get(args[2]).slice(); return { status: 0, stdout: '', stderr: '' }; }
    if (cmd === 'merge' && args[1] === '--abort') return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'merge') { const b = args[args.length - 1]; if (conflict.includes(b)) return { status: 1, stdout: '', stderr: 'CONFLICT' }; head.push(b); return { status: 0, stdout: '', stderr: '' }; }
    throw new Error('unexpected git ' + args.join(' '));
  };
  let ciRuns = 0;
  const ci = () => { ciRuns++; const b = head.find(x => bad.includes(x)); return b ? { ok: false, step: 'tests (Node 22)' } : { ok: true }; };
  return { git, ci, runs: () => ciRuns, head: () => head.slice() };
}
const names = (n) => Array.from({ length: n }, (_, i) => 'b' + (i + 1));

describe('runTrain with a fake repository', () => {
  it('runs CI once per green batch of 10 and keeps every branch', () => {
    const r = fakeRepo();
    const report = T.runTrain({ ...r, premerge: () => ({ ok: true }), branches: names(25) });
    expect(report.batches.map(b => b.result)).toEqual(['green', 'green', 'green']);
    expect(r.runs()).toBe(3);
    expect(r.head()).toHaveLength(25);
    expect(report.halted).toBe(null);
  });
  it('skips a conflicting branch and an unranked one, and says why', () => {
    const r = fakeRepo({ conflict: ['b2'] });
    const report = T.runTrain({ ...r, premerge: (b) => b === 'b3' ? { ok: false, reason: 'unranked' } : { ok: true }, branches: names(4) });
    expect(report.skipped.map(s => [s.branch, s.reason])).toEqual([['b3', 'unranked'], ['b2', 'merge conflict']]);
    expect(r.head()).toEqual(['b1', 'b4']);
  });
  it('bisects a red batch to the branch that broke it, drops it and goes on', () => {
    const r = fakeRepo({ bad: ['b7'] });
    const report = T.runTrain({ ...r, premerge: () => ({ ok: true }), branches: names(12) });
    expect(report.quarantined).toEqual([{ branch: 'b7', batch: 1, step: 'tests (Node 22)' }]);
    expect(report.batches[0].result).toBe('green without b7');
    expect(report.batches[0].merged).not.toContain('b7');
    expect(report.batches[1].result).toBe('green');
    expect(r.head()).toEqual(names(12).filter(b => b !== 'b7'));
    // 1 (red) + at most 4 bisect runs + 1 re-run, then 1 for the second batch.
    expect(r.runs()).toBeLessThanOrEqual(7);
  });
  it('halts when removing one branch does not turn the batch green', () => {
    const r = fakeRepo({ bad: ['b2', 'b9'] });
    const report = T.runTrain({ ...r, premerge: () => ({ ok: true }), branches: names(12) });
    expect(report.halted).toMatch(/still red/);
    expect(report.batches).toHaveLength(1);
  });
  it('writes a report that says nothing was pushed', () => {
    const r = fakeRepo({ bad: ['b2'] });
    const report = T.runTrain({ ...r, premerge: () => ({ ok: true }), branches: names(3) });
    const text = T.renderReport(report, { train: 'train/x', base: 'origin/integration-2' });
    expect(text).toContain('Left out because the batch went red');
    expect(text).toContain('Nothing was pushed or published');
  });
});

describe('runTrain with real git in a temp repository', () => {
  it('merges clean branches, drops a conflicting one and a red one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-train-test-'));
    const run = (args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(args.join(' ') + ': ' + r.stderr); return r; };
    const commit = (file, text, msg) => { fs.writeFileSync(path.join(dir, file), text); run(['add', '-A']); run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg]); };
    try {
      run(['init', '-q', '-b', 'base']);
      commit('shared.txt', 'one\n', 'base');
      for (const [name, file, text] of [['a', 'a.txt', 'a\n'], ['conf', 'shared.txt', 'conf\n'], ['bad', 'bad.txt', 'BAD\n'], ['c', 'c.txt', 'c\n']]) {
        run(['checkout', '-q', '-b', name, 'base']); commit(file, text, name); run(['checkout', '-q', 'base']);
      }
      commit('shared.txt', 'base-changed\n', 'base moves');
      run(['checkout', '-q', '-b', 'train/test', 'base']);
      const git = (args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; };
      const ci = () => fs.existsSync(path.join(dir, 'bad.txt')) ? { ok: false, step: 'tests' } : { ok: true };
      const report = T.runTrain({ git, ci, premerge: () => ({ ok: true }), branches: ['a', 'conf', 'bad', 'c'] });
      expect(report.skipped.map(s => s.branch)).toEqual(['conf']);
      expect(report.quarantined.map(q => q.branch)).toEqual(['bad']);
      expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'c.txt'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'bad.txt'))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
