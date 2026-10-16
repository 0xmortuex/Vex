// @vitest-environment jsdom
//
// js/vex-breaker.js: a feature that fails N times in a row, or runs over its budget,
// is switched off ALONE for the session with one ledger line, and tried again after
// a cool-down; a panel that cannot draw becomes an inline card; the feature that
// crashes start-up is left out by itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let clock, flags;
function mod() {
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  globalThis.VexLedger = fresh(JS + 'vex-ledger.js').VexLedger;
  globalThis.VexBreaker = fresh(JS + 'vex-breaker.js').VexBreaker;
  globalThis.VexJobs = fresh(JS + 'jobs.js').VexJobs;
}
function feature(id, on = true) {
  const f = { on, disabled: 0, enabled: 0 };
  VexUsage.register({ id, title: id, isEnabled: () => f.on, disable: () => { f.on = false; f.disabled++; }, enable: () => { f.on = true; f.enabled++; } });
  return f;
}
const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  clock = 1_000_000;
  flags = { hidden: false };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => flags.hidden });
  globalThis.GameMode = { gaming: false };
  window.VexProblems = globalThis.VexProblems = { note: vi.fn() };
  mod();
  VexBreaker._now = () => clock;
  VexLedger._now = () => clock;
  VexJobs._jobs.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { clearTimeout(VexJobs._tick); VexJobs._tick = null; vi.restoreAllMocks(); });

describe('the breaker', () => {
  it('counts consecutive failures and trips at MAX_FAILS, not before', () => {
    for (let i = 1; i < VexBreaker.MAX_FAILS; i++) expect(VexBreaker.fail('x', new Error('boom ' + i))).toBe(false);
    expect(VexBreaker.isTripped('x')).toBe(false);
    expect(VexBreaker.fail('x', new Error('boom'))).toBe(true);
    expect(VexBreaker.isTripped('x')).toBe(true);
  });

  it('a success in between resets the count', () => {
    for (let i = 0; i < VexBreaker.MAX_FAILS - 1; i++) VexBreaker.fail('x', new Error('boom'));
    VexBreaker.ok('x');
    for (let i = 0; i < VexBreaker.MAX_FAILS - 1; i++) VexBreaker.fail('x', new Error('boom'));
    expect(VexBreaker.isTripped('x')).toBe(false);
  });

  it('switches the one feature off with its own switch, and says so in the ledger with an undo', async () => {
    const a = feature('a'); const b = feature('b');
    for (let i = 0; i < VexBreaker.MAX_FAILS; i++) VexBreaker.fail('a', new Error('it broke'));
    await tick();
    expect(a.on).toBe(false);
    expect(b.on).toBe(true);
    const line = VexLedger.list()[0];
    expect(line).toMatchObject({ feature: 'a', undo: { kind: 'breaker-revive', id: 'a' } });
    expect(line.what).toMatch(/Switched off "a" for 10 minutes/);
    expect(line.why).toMatch(/failed 5 times in a row \(it broke\)/);
    expect(VexProblems.note).toHaveBeenCalled();
  });

  it('is session-only: nothing lands in the saved off list', async () => {
    feature('a');
    for (let i = 0; i < VexBreaker.MAX_FAILS; i++) VexBreaker.fail('a', new Error('x'));
    await tick();
    expect(VexUsage._load().off.a).toBeUndefined();
  });

  it('switches the feature back on after the cool-down, on probation, and a failure then doubles the wait', async () => {
    const a = feature('a');
    for (let i = 0; i < VexBreaker.MAX_FAILS; i++) VexBreaker.fail('a', new Error('x'));
    await tick();
    clock += VexBreaker.COOLDOWN_MS - 1;
    expect(VexBreaker.isTripped('a')).toBe(true);
    clock += 2;
    expect(VexBreaker.isTripped('a')).toBe(false);
    await tick();
    expect(a.on).toBe(true);
    expect(VexBreaker.fail('a', new Error('again'))).toBe(true);     // one failure on probation is enough
    const rec = VexBreaker.status().find(s => s.id === 'a');
    expect(rec.until - clock).toBe(2 * VexBreaker.COOLDOWN_MS);
  });

  it('a success on probation closes it for good', async () => {
    feature('a');
    for (let i = 0; i < VexBreaker.MAX_FAILS; i++) VexBreaker.fail('a', new Error('x'));
    clock += VexBreaker.COOLDOWN_MS + 1;
    VexBreaker.isTripped('a');
    VexBreaker.ok('a');
    for (let i = 0; i < VexBreaker.MAX_FAILS - 1; i++) VexBreaker.fail('a', new Error('x'));
    expect(VexBreaker.isTripped('a')).toBe(false);
  });

  it('never switches ON a feature that was off before it tripped', async () => {
    const a = feature('a', false);
    for (let i = 0; i < VexBreaker.MAX_FAILS; i++) VexBreaker.fail('a', new Error('x'));
    clock += VexBreaker.COOLDOWN_MS + 1;
    VexBreaker.sweep();
    await tick();
    expect(a.disabled).toBe(0);
    expect(a.enabled).toBe(0);
    expect(a.on).toBe(false);
  });

  it('trip() takes a reason other than throwing, and refuses an empty one', () => {
    expect(() => VexBreaker.trip('a', '')).toThrow(/needs a reason/);
    expect(VexBreaker.trip('a', 'it used too much')).toBe(true);
    expect(VexBreaker.trip('a', 'again')).toBe(false);
    expect(VexBreaker.status()[0].reason).toBe('it used too much');
  });

  it('the ledger undo brings it back before the cool-down ends', async () => {
    const a = feature('a');
    VexBreaker.trip('a', 'budget');
    await tick();
    expect(a.on).toBe(false);
    await VexLedger.undo(VexLedger.list()[0].id);
    await tick();
    expect(VexBreaker.isTripped('a')).toBe(false);
    expect(a.on).toBe(true);
  });
});

describe('VexJobs failure counting', () => {
  it('stops a job that fails five times in a row and runs it again after the cool-down', () => {
    const fn = vi.fn(() => { throw new Error('nope'); });
    VexJobs.every('flaky', 1000, fn);
    let t = Date.now();
    for (let i = 0; i < 8; i++) { t += 1001; VexJobs.tick(t); }
    expect(fn).toHaveBeenCalledTimes(VexBreaker.MAX_FAILS);
    expect(VexBreaker.isTripped('job:flaky')).toBe(true);
    clock += VexBreaker.COOLDOWN_MS + 1;
    t += 1001; VexJobs.tick(t);
    expect(fn).toHaveBeenCalledTimes(VexBreaker.MAX_FAILS + 1);
  });

  it('counts a rejected promise as a failure and a resolved one as a success', async () => {
    let n = 0;
    VexJobs.every('async', 1000, () => (++n % 2 ? Promise.reject(new Error('x')) : Promise.resolve()));
    let t = Date.now();
    for (let i = 0; i < 10; i++) { t += 1001; VexJobs.tick(t); await tick(); }
    expect(VexBreaker.isTripped('job:async')).toBe(false);       // never five in a row
    expect(n).toBe(10);
  });

  it('charges the failures to the job’s feature and switches only that feature off', async () => {
    VexRegistry.define({ id: 'owner', title: 'Owner', jobs: ['Owned job'] });
    const owner = feature('owner'); const other = feature('other');
    VexJobs.every('Owned job', 1000, () => { throw new Error('bad'); });
    let t = Date.now();
    for (let i = 0; i < 6; i++) { t += 1001; VexJobs.tick(t); }
    await tick();
    expect(VexBreaker.isTripped('owner')).toBe(true);
    expect(owner.on).toBe(false);
    expect(other.on).toBe(true);
  });

  it('does not run a tripped feature’s job and does not owe it a run', () => {
    VexRegistry.define({ id: 'owner', title: 'Owner', jobs: ['Owned job'] });
    const fn = vi.fn();
    VexJobs.every('Owned job', 1000, fn);
    VexBreaker.trip('owner', 'budget');
    let t = Date.now();
    for (let i = 0; i < 3; i++) { t += 1001; VexJobs.tick(t); }
    expect(fn).not.toHaveBeenCalled();
    expect([...VexJobs._jobs.values()][0].owed).toBe(false);
  });
});

describe('guardPanel', () => {
  it('turns a render that throws into an inline card with the reason and Try again', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let calls = 0;
    await VexBreaker.guardPanel(host, 'panel-x', 'Notes', () => { calls++; if (calls === 1) throw new Error('cannot draw notes'); host.textContent = 'drawn'; });
    expect(host.querySelector('.vex-panel-failed')).not.toBeNull();
    expect(host.textContent).toContain('The Notes panel failed to load');
    expect(host.textContent).toContain('cannot draw notes');
    host.querySelector('button').click();
    await tick();
    expect(host.textContent).toBe('drawn');
  });

  it('also catches a render whose promise rejects, and counts it against the feature', async () => {
    const host = document.createElement('div');
    for (let i = 0; i < VexBreaker.MAX_FAILS; i++) await VexBreaker.guardPanel(host, 'panel-y', 'Y', async () => { throw new Error('late'); });
    expect(VexBreaker.isTripped('panel-y')).toBe(true);
  });

  it('refuses a missing element or render function', async () => {
    await expect(VexBreaker.guardPanel(null, 'p', 'P', () => {})).rejects.toThrow(/element/);
    await expect(VexBreaker.guardPanel(document.createElement('div'), 'p', 'P', null)).rejects.toThrow(/render function/);
  });
});

describe('bootStep', () => {
  it('tells main before and after, and returns what the step returned', () => {
    const calls = [];
    window.vex = { bootFeature: (id, phase) => calls.push([id, phase]), bootDisabled: () => [] };
    expect(VexBreaker.bootStep('f', () => 42)).toBe(42);
    expect(calls).toEqual([['f', 'start'], ['f', 'done']]);
  });

  it('skips a feature main left out of this launch, keeps it off, and writes a ledger line', async () => {
    window.vex = { bootFeature: vi.fn(), bootDisabled: () => ['crashy'] };
    const f = feature('crashy');
    const step = vi.fn();
    expect(VexBreaker.bootStep('crashy', step)).toBeUndefined();
    expect(step).not.toHaveBeenCalled();
    expect(window.vex.bootFeature).not.toHaveBeenCalled();
    await tick();
    expect(f.on).toBe(false);
    expect(VexUsage._load().off.crashy).toBeGreaterThan(0);
    expect(VexLedger.list()[0].what).toMatch(/Left "crashy" out of this start/);
  });

  it('keeps a late-registering feature off too', async () => {
    window.vex = { bootFeature: vi.fn(), bootDisabled: () => ['late'] };
    VexBreaker.bootStep('late', () => {});
    const f = feature('late');
    await tick();
    expect(f.on).toBe(false);
  });

  it('reports a step that throws, counts it, and lets the launch go on', () => {
    window.vex = { bootFeature: vi.fn(), bootDisabled: () => [] };
    expect(() => VexBreaker.bootStep('f', () => { throw new Error('init failed'); })).not.toThrow();
    expect(VexProblems.note).toHaveBeenCalledWith('Feature', '"f" failed to start', expect.any(Error));
    expect(window.vex.bootFeature).toHaveBeenLastCalledWith('f', 'done');
  });

  it('says so when it cannot ask main which features are left out', () => {
    window.vex = { bootDisabled: () => { throw new Error('no ipc'); } };
    expect(VexBreaker.bootOff().size).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });
});
