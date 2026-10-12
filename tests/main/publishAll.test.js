// scripts/publish-all.ps1: the owner's three-step publish stops at the first
// failure, names the step, resumes from a state file, retries wrangler only on
// network/5xx errors, and never prints the token. Driven with fake step
// commands through -StepsFile; no wrangler, npm or GitHub is touched.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'publish-all.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0;

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-publish-all-test-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// A fake step: appends to <name>.log each time it runs; fails (printing
// `msg`) while <name>.fail holds a number > 0, counting it down.
function fakeStep(name, { retry = false } = {}) {
  const script = path.join(dir, 'fake.js');
  if (!fs.existsSync(script)) {
    fs.writeFileSync(script, [
      "const fs = require('fs'); const [name, dir, msg] = process.argv.slice(2);",
      "fs.appendFileSync(dir + '/' + name + '.log', 'x');",
      "const f = dir + '/' + name + '.fail';",
      "if (fs.existsSync(f)) { const n = Number(fs.readFileSync(f, 'utf8')); if (n > 0) { fs.writeFileSync(f, String(n - 1)); console.error(msg || 'boom'); process.exit(1); } }",
      "console.log('ok ' + name + ' ' + (process.env.GH_TOKEN || ''));",
    ].join('\n'));
  }
  return { name, command: `& '${process.execPath}' '${script}' ${name} '${dir}' 'ERR_MSG'`, cwd: '.', retry };
}
const fails = (name, n) => fs.writeFileSync(path.join(dir, name + '.fail'), String(n));
const runs = name => { const p = path.join(dir, name + '.log'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').length : 0; };
const state = () => path.join(dir, 'state.json');

function publish(steps, extra = [], env = {}) {
  const stepsFile = path.join(dir, 'steps.json');
  fs.writeFileSync(stepsFile, JSON.stringify(steps));
  const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-StepsFile', stepsFile, '-StateFile', state(), '-Version', '9.9.9', '-Backoff', '0,0', ...extra],
    { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const three = () => [fakeStep('sync', { retry: true }), fakeStep('publish'), fakeStep('ai', { retry: true })];
// The fake prints ERR_MSG literally unless replaced: make the message a real one.
function withMsg(steps, msg) { return steps.map(s => ({ ...s, command: s.command.replace('ERR_MSG', msg) })); }

describe.skipIf(!hasPwsh)('publish-all.ps1', { timeout: 90000 }, () => {
  it('runs the three steps in order and records them', () => {
    const r = publish(three());
    expect(r.code).toBe(0);
    expect(runs('sync') + runs('publish') + runs('ai')).toBe(3);
    expect(JSON.parse(fs.readFileSync(state(), 'utf8')).done).toEqual(['sync', 'publish', 'ai']);
  });

  it('stops at the first failure, names the step, and resumes there on rerun', () => {
    fails('publish', 1);
    const first = publish(withMsg(three(), 'build exploded'));
    expect(first.code).toBe(1);
    expect(first.out).toMatch(/FAILED at step 2\/3 publish/);
    expect(runs('ai')).toBe(0);
    expect(JSON.parse(fs.readFileSync(state(), 'utf8')).done).toEqual(['sync']);

    const second = publish(three());
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/step 1\/3 sync already done, skipping/);
    expect(runs('sync')).toBe(1);
    expect(runs('publish')).toBe(2);
    expect(runs('ai')).toBe(1);
  });

  it('retries a deploy on a 504 and then succeeds', () => {
    fails('sync', 2);
    const r = publish(withMsg(three(), 'HTTP 504 Gateway Timeout'));
    expect(r.code).toBe(0);
    expect(runs('sync')).toBe(3);
  });

  it('gives up after three attempts', () => {
    fails('sync', 9);
    const r = publish(withMsg(three(), 'fetch failed ECONNRESET'));
    expect(r.code).toBe(1);
    expect(runs('sync')).toBe(3);
    expect(r.out).toMatch(/FAILED at step 1\/3 sync/);
    expect(runs('publish')).toBe(0);
  });

  it('does not retry an error that is not a network/5xx failure', () => {
    fails('sync', 9);
    const r = publish(withMsg(three(), 'Authentication error code 10000 worker is 512 KiB'));
    expect(r.code).toBe(1);
    expect(runs('sync')).toBe(1);
  });

  it('never retries a step not marked retry', () => {
    fails('publish', 9);
    const r = publish(withMsg(three(), 'HTTP 502 Bad Gateway'));
    expect(r.code).toBe(1);
    expect(runs('publish')).toBe(1);
  });

  it('never prints the token', () => {
    const token = 'ghp_' + 'Ab1'.repeat(12);
    const r = publish(three(), [], { GH_TOKEN: token });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(token);
    expect(r.out).toContain('ok sync ***');
  });

  it('a dry run runs nothing and writes no state', () => {
    const r = publish(three(), ['-DryRun']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/would run/);
    expect(runs('sync')).toBe(0);
    expect(fs.existsSync(state())).toBe(false);
  });

  it('progress of another version does not skip steps', () => {
    fs.writeFileSync(state(), JSON.stringify({ version: '1.0.0', done: ['sync', 'publish', 'ai'] }));
    const r = publish(three());
    expect(r.code).toBe(0);
    expect(runs('sync')).toBe(1);
  });

  it('-Reset forgets finished progress', () => {
    publish(three());
    const r = publish(three(), ['-Reset']);
    expect(r.code).toBe(0);
    expect(runs('sync')).toBe(2);
  });
});
