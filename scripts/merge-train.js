#!/usr/bin/env node
// Merge train (T0-001): land many branches in batches of at most 10, run the
// whole CI sequence after each batch, and when a batch goes red find the branch
// that did it. See scripts/MERGE-TRAIN.md.
//
//   node scripts/merge-train.js --base origin/integration-2 --branches a,b,c      dry run (the default)
//   node scripts/merge-train.js --base origin/integration-2 --file branches.txt --run
//
// What it will never do: push anything, publish anything, touch main/master,
// or work in your checkout. It builds a NEW branch train/<stamp> in a NEW git
// worktree and leaves both for you to look at; moving a result anywhere is
// your decision, by hand.
//
// Dry run (no --run): for each branch it reports whether the branch exists,
// how many commits it adds, whether every commit has a Rank line (or a
// release-ranks.txt entry), and whether it would merge cleanly into the base
// (git merge-tree, which writes no files). Nothing is created.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const points = require('./version-points.js');

const REPO = path.resolve(__dirname, '..');
const MAX_BATCH = 10;
const FORBIDDEN_TARGETS = /^(?:main|master|origin\/main|origin\/master|refs\/heads\/(?:main|master))$/i;

// ---- pure parts -----------------------------------------------------------

function chunk(list, size) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH) throw new Error(`batch size must be 1 to ${MAX_BATCH}, got ${size}`);
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Smallest k in 1..n for which failsAt(k) is true, given failsAt(n) is true and
// the failure is monotonic (once the culprit is in, every longer prefix fails).
// Calls failsAt at most ceil(log2(n)) times.
function firstFailingPrefix(n, failsAt) {
  if (!(n >= 1)) throw new Error('nothing to bisect');
  let lo = 1, hi = n; // the answer is in [lo, hi]; hi is known to fail
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (failsAt(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

function assertTrainTarget(branch) {
  if (!/^train\/[\w.-]+$/.test(branch) || FORBIDDEN_TARGETS.test(branch)) throw new Error(`merge-train: refusing to build on "${branch}"; the train branch must be train/<name>`);
}

// The branch list from --branches / a file: one name per line or comma-separated, # comments.
function parseBranchList(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    for (const part of raw.replace(/#.*/, '').split(',')) { const b = part.trim(); if (b && !out.includes(b)) out.push(b); }
  }
  return out;
}

// commits [{hash,subject,body}] -> { ok, unranked: [{hash,subject}], points }
function rankCheck(commits, overrides) {
  const s = points.score(commits, overrides);
  return { ok: s.unranked.length === 0, unranked: s.unranked.map(c => ({ hash: c.hash, subject: c.subject })), points: s.total };
}

// The CI sequence of .github/workflows/verify.yml, minus the steps that need a
// built package (pass withPack for that). Each step: { name, cmd, args }.
function ciSteps({ vitestPath, withPack = false, node22 = true }) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const steps = [
    { name: 'check:source', cmd: npm, args: ['run', 'check:source'] },
    { name: 'check:types', cmd: npm, args: ['run', 'check:types'] },
    { name: 'lint', cmd: npm, args: ['run', 'lint'] },
    node22
      ? { name: 'tests (Node 22)', cmd: npx, args: ['-y', 'node@22', vitestPath, 'run', '--maxWorkers=4'] }
      : { name: 'tests', cmd: process.execPath, args: [vitestPath, 'run', '--maxWorkers=4'] },
    { name: 'smoke', cmd: npm, args: ['run', 'smoke'] },
    { name: 'smoke:restart', cmd: npm, args: ['run', 'smoke:restart'] },
    { name: 'audit (prod)', cmd: npm, args: ['audit', '--omit=dev', '--audit-level=high'] },
  ];
  if (withPack) steps.push({ name: 'pack', cmd: npm, args: ['run', 'pack', '--', '--config.directories.output=scratchpad/ci-package'] });
  return steps;
}

// ---- the train, with git and CI injected so tests need neither ---------------
// git(args) -> { status, stdout, stderr }; ci() -> { ok, step?, output? };
// premerge(branch) -> { ok, reason? } (rank check); log(line).
function runTrain({ git, ci, premerge, branches, batchSize = MAX_BATCH, log = () => {} }) {
  const report = { batches: [], skipped: [], quarantined: [], halted: null };
  const must = (args) => { const r = git(args); if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`); return r.stdout.trim(); };
  const mergeAll = (list) => {
    const merged = [], conflicts = [];
    for (const b of list) {
      const r = git(['merge', '--no-ff', '--no-edit', b]);
      if (r.status === 0) merged.push(b);
      else { git(['merge', '--abort']); conflicts.push(b); }
    }
    return { merged, conflicts };
  };

  chunk(branches, batchSize).forEach((batch, index) => {
    if (report.halted) return;
    const start = must(['rev-parse', 'HEAD']);
    const entry = { index: index + 1, branches: batch, merged: [], result: null };
    report.batches.push(entry);

    const eligible = [];
    for (const b of batch) {
      const pre = premerge(b);
      if (!pre.ok) { report.skipped.push({ branch: b, reason: pre.reason }); log(`skip ${b}: ${pre.reason}`); }
      else eligible.push(b);
    }
    const first = mergeAll(eligible);
    for (const b of first.conflicts) { report.skipped.push({ branch: b, reason: 'merge conflict' }); log(`skip ${b}: merge conflict`); }
    entry.merged = first.merged;
    if (!first.merged.length) { entry.result = 'nothing to merge'; return; }

    log(`batch ${entry.index}: merged ${first.merged.length}, running CI`);
    const run = ci();
    if (run.ok) { entry.result = 'green'; return; }

    entry.result = 'red';
    entry.failedStep = run.step;
    const failsAt = (k) => {
      must(['reset', '--hard', start]);
      mergeAll(first.merged.slice(0, k));
      const r = ci();
      return !r.ok;
    };
    const k = firstFailingPrefix(first.merged.length, failsAt);
    const culprit = first.merged[k - 1];
    report.quarantined.push({ branch: culprit, batch: entry.index, step: run.step });
    log(`batch ${entry.index}: red, first failing branch is ${culprit}`);

    must(['reset', '--hard', start]);
    const rest = mergeAll(first.merged.filter(b => b !== culprit));
    entry.merged = rest.merged;
    const again = rest.merged.length ? ci() : { ok: true };
    if (again.ok) { entry.result = 'green without ' + culprit; return; }
    entry.result = 'still red without ' + culprit;
    report.halted = `batch ${entry.index} is still red after removing ${culprit} (step ${again.step}); more than one branch is at fault, or the base itself is red`;
  });
  return report;
}

function renderReport(report, ctx = {}) {
  const out = [`# Merge train${ctx.train ? ' ' + ctx.train : ''}`, ''];
  if (ctx.base) out.push(`Base: ${ctx.base}`);
  if (ctx.head) out.push(`Train head: ${ctx.head}`);
  out.push('');
  for (const b of report.batches) {
    out.push(`## Batch ${b.index}: ${b.result}`);
    out.push(`Merged (${b.merged.length}): ${b.merged.join(', ') || 'none'}`);
    if (b.failedStep) out.push(`First red step: ${b.failedStep}`);
    out.push('');
  }
  if (report.quarantined.length) { out.push('## Left out because the batch went red with them'); for (const q of report.quarantined) out.push(`- ${q.branch} (batch ${q.batch}, step ${q.step})`); out.push(''); }
  if (report.skipped.length) { out.push('## Skipped'); for (const s of report.skipped) out.push(`- ${s.branch}: ${s.reason}`); out.push(''); }
  if (report.halted) out.push('## HALTED', report.halted, '');
  out.push('Nothing was pushed or published. Inspect the train branch and move it yourself.');
  return out.join('\n') + '\n';
}

// ---- the real git / CI runners ---------------------------------------------

function realGit(cwd) {
  return (args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
}

function realCi(cwd, steps, log) {
  return () => {
    for (const s of steps) {
      log(`  ci: ${s.name}`);
      const r = spawnSync(s.cmd, s.args, { cwd, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(s.cmd), maxBuffer: 256 * 1024 * 1024 });
      if (r.error || r.status !== 0) return { ok: false, step: s.name, output: String((r.error && r.error.message) || '') + String(r.stdout || '').slice(-4000) + String(r.stderr || '').slice(-4000) };
    }
    return { ok: true };
  };
}

function commitsBetween(git, from, to) {
  const r = git(['log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', `${from}..${to}`]);
  if (r.status !== 0) throw new Error(`git log ${from}..${to} failed: ${r.stderr.trim()}`);
  return r.stdout.split('\x1e').map(s => s.trim()).filter(Boolean).map(s => { const [hash, subject, body] = s.split('\x1f'); return { hash, subject, body: body || '' }; });
}

function parseArgs(argv) {
  const o = { run: false, batch: MAX_BATCH, branches: [], withPack: false, node22: true, base: null, file: null, report: null, allowUnranked: false, worktree: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--run') o.run = true;
    else if (a === '--base') o.base = next();
    else if (a === '--branches') o.branches.push(...parseBranchList(next()));
    else if (a === '--file') o.file = next();
    else if (a === '--batch-size') o.batch = Number(next());
    else if (a === '--with-pack') o.withPack = true;
    else if (a === '--no-node22') o.node22 = false;
    else if (a === '--allow-unranked') o.allowUnranked = true;
    else if (a === '--report') o.report = next();
    else if (a === '--worktree') o.worktree = next();
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.file) o.branches.push(...parseBranchList(fs.readFileSync(o.file, 'utf8')));
  o.branches = [...new Set(o.branches)];
  return o;
}

function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help || !o.base || !o.branches.length) {
    console.log('usage: node scripts/merge-train.js --base <ref> (--branches a,b | --file list.txt) [--batch-size N<=10] [--run] [--with-pack] [--no-node22] [--allow-unranked] [--report file] [--worktree dir]');
    return o.help ? 0 : 1;
  }
  if (FORBIDDEN_TARGETS.test(o.base) && o.run) console.warn(`note: ${o.base} is only the starting point; the train builds a new train/ branch and never changes it.`);
  chunk(o.branches, o.batch); // validates the size
  const repoGit = realGit(REPO);
  const overridesFile = path.join(REPO, 'release-ranks.txt');
  const overrides = points.readOverrides(fs.existsSync(overridesFile) ? fs.readFileSync(overridesFile, 'utf8') : '');

  // Dry run: read-only facts per branch.
  const facts = o.branches.map(b => {
    const exists = repoGit(['rev-parse', '--verify', '--quiet', b + '^{commit}']).status === 0;
    if (!exists) return { branch: b, exists: false };
    const commits = commitsBetween(repoGit, o.base, b);
    const rank = rankCheck(commits, overrides);
    const mt = repoGit(['merge-tree', '--write-tree', o.base, b]);
    return { branch: b, exists: true, commits: commits.length, rank, clean: mt.status === 0 };
  });
  if (!o.run) {
    console.log(`merge-train dry run: base ${o.base}, ${o.branches.length} branch(es) in ${chunk(o.branches, o.batch).length} batch(es) of at most ${o.batch}`);
    chunk(facts, o.batch).forEach((batch, i) => {
      console.log(`\nbatch ${i + 1}`);
      for (const f of batch) {
        if (!f.exists) { console.log(`  ${f.branch}: NOT FOUND`); continue; }
        const notes = [`${f.commits} commit(s)`, f.rank.ok ? `ranked (${f.rank.points} pts)` : `UNRANKED: ${f.rank.unranked.map(u => u.hash.slice(0, 7)).join(' ')}`, f.clean ? 'merges clean into base' : 'CONFLICTS with base'];
        console.log(`  ${f.branch}: ${notes.join('; ')}`);
      }
    });
    console.log('\nNothing was changed. Add --run to build the train in a new worktree.');
    return facts.some(f => !f.exists) ? 1 : 0;
  }

  const missing = facts.filter(f => !f.exists);
  if (missing.length) throw new Error('branches not found: ' + missing.map(f => f.branch).join(', '));
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const trainBranch = 'train/' + stamp;
  assertTrainTarget(trainBranch);
  const worktree = path.resolve(o.worktree || path.join(REPO, '.claude', 'worktrees', 'train-' + stamp));
  if (path.resolve(worktree) === REPO) throw new Error('merge-train: the train must not run in your checkout');
  const add = repoGit(['worktree', 'add', '-b', trainBranch, worktree, o.base]);
  if (add.status !== 0) throw new Error('git worktree add failed: ' + add.stderr.trim());
  console.log(`train branch ${trainBranch} in ${worktree}`);

  const git = realGit(worktree);
  const log = (l) => console.log(l);
  const vitestPath = require.resolve('vitest/vitest.mjs', { paths: [worktree, REPO] });
  const ci = realCi(worktree, [{ name: 'heavy gate', cmd: process.execPath, args: [path.join(REPO, 'scripts', 'heavy-gate.js'), 'merge-train'] }, ...ciSteps({ vitestPath, withPack: o.withPack, node22: o.node22 })], log);
  const premerge = (b) => {
    if (o.allowUnranked) return { ok: true };
    const r = rankCheck(commitsBetween(git, 'HEAD', b), overrides);
    return r.ok ? { ok: true } : { ok: false, reason: 'unranked commit(s): ' + r.unranked.map(u => u.hash.slice(0, 7)).join(' ') + ' (add Rank lines or release-ranks.txt entries)' };
  };
  const report = runTrain({ git, ci, premerge, branches: o.branches, batchSize: o.batch, log });
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  const text = renderReport(report, { train: trainBranch, base: o.base, head });
  const reportPath = path.resolve(o.report || path.join(os.tmpdir(), `vex-merge-train-${stamp}.md`));
  fs.writeFileSync(reportPath, text);
  console.log('\n' + text + 'report: ' + reportPath);
  return report.halted ? 1 : 0;
}

module.exports = { chunk, firstFailingPrefix, assertTrainTarget, parseBranchList, rankCheck, ciSteps, runTrain, renderReport, parseArgs, MAX_BATCH };

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (err) { console.error('merge-train: ' + err.message); process.exitCode = 1; }
}
