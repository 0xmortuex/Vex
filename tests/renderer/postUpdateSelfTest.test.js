// @vitest-environment jsdom
//
// T0-015: the check after an update (js/post-update-selftest.js). On the first
// start of a version it counts the features that failed to start, scans the
// health check (changing nothing) and names crash kinds new in this version;
// it speaks only when something is wrong, once per version, and offers a
// report, the settings from before the update, and the Health check. No
// updater or installer is touched: the preload API is a stand-in.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const { newKinds } = require('../../src/main/crash-log.js');

let Test, problems;
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms));

function setup({ version = '9.1.0', scan, diag } = {}) {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  window.VexProblems = problems = fresh('../../src/renderer/js/problems.js').VexProblems;
  problems.setVersion(version);
  window.vex = {
    getAppVersion: async () => version,
    health: { scan: vi.fn(async () => scan || { ok: true, findings: [] }) },
    diagnostics: vi.fn(async () => diag || { version, crashKindsNew: [] }),
  };
  window.showToast = vi.fn();
  globalThis.VexSettingsGroups = fresh('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
  globalThis.VexReport = { open: vi.fn(async () => true) };
  globalThis.VexUpdateSafetyNet = { open: vi.fn() };
  globalThis.VexHealth = { open: vi.fn() };
  delete globalThis.VexAttention;
  Test = fresh('../../src/renderer/js/post-update-selftest.js').VexSelfTest;
}

describe('crash kinds new in a version (main)', () => {
  it('names the kinds this version has that no earlier one recorded', () => {
    const entries = [
      { kind: 'page crashed', version: '9.0.0' },
      { kind: 'page crashed', version: '9.1.0' },
      { kind: 'helper process gone', version: '9.1.0' },
      { kind: 'helper process gone', version: '9.1.0' },
      { kind: 'page hung', version: '9.0.0' },
      { kind: 5, version: '9.1.0' },
      null,
    ];
    expect(newKinds(entries, '9.1.0')).toEqual([{ kind: 'helper process gone', n: 2 }]);
    expect(newKinds(entries, '9.2.0')).toEqual([]);
    expect(newKinds('nope', '9.1.0')).toEqual([]);
  });
});

describe('the check after an update', () => {
  beforeEach(() => setup());

  it('counts features that failed to start, by feature, and ignores other problems', () => {
    problems.note('AI news', 'Could not start', 'boom');
    problems.note('AI news', 'Could not start', 'boom');
    problems.note('Patch radar', 'Could not start', new Error('nope'));
    problems.note('Sync', 'Pull failed', 'offline');
    problems.note('Game session', 'Failed to start the watcher');
    const failed = Test.startFailures();
    expect(failed.map(f => f.area).sort()).toEqual(['AI news', 'Game session', 'Patch radar']);
    expect(failed.find(f => f.area === 'AI news').n).toBe(2);
  });

  it('is quiet when all is well, runs once per version, and keeps the result', async () => {
    const r = await Test.maybeRun();
    expect(r.ok).toBe(true);
    expect(window.showToast).not.toHaveBeenCalled();
    expect(Test.last().version).toBe('9.1.0');
    expect(window.vex.health.scan).toHaveBeenCalledTimes(1);
    expect(await Test.maybeRun()).toBeNull();
    expect(window.vex.health.scan).toHaveBeenCalledTimes(1);
    window.vex.getAppVersion = async () => '9.2.0';
    expect((await Test.maybeRun()).version).toBe('9.2.0');
  });

  it('says "N features failed to start; they are off" with a way to the details', async () => {
    problems.note('AI news', 'Could not start', 'x');
    problems.note('Patch radar', 'Could not start', 'y');
    const r = await Test.maybeRun();
    expect(r.ok).toBe(false);
    expect(r.failed).toHaveLength(2);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    const [text, kind, , opts] = window.showToast.mock.calls[0];
    expect(text).toBe('2 features failed to start; they are off: AI news, Patch radar.');
    expect(kind).toBe('error');
    expect(opts.action.label).toBe('See what failed');
  });

  it('says it in the singular for one feature', () => {
    expect(Test.lines({ failed: [{ area: 'AI news' }], health: [], crashKinds: [] })[0]).toBe('1 feature failed to start; it is off: AI news.');
  });

  it('reports health errors (not warnings) and crash kinds new in this version', async () => {
    setup({
      scan: { ok: true, findings: [{ id: 'file-corrupt:x.json', severity: 'error', title: 'x.json is damaged' }, { id: 'key-big:k', severity: 'warn', title: 'big' }] },
      diag: { crashKindsNew: [{ kind: 'page crashed', n: 3 }] },
    });
    const r = await Test.maybeRun();
    expect(r.health.map(h => h.id)).toEqual(['file-corrupt:x.json']);
    expect(r.crashKinds).toEqual([{ kind: 'page crashed', n: 3 }]);
    const lines = Test.lines(r);
    expect(lines.some(l => /health check found 1 problem: x\.json is damaged/.test(l))).toBe(true);
    expect(lines.some(l => /page crashed \(x3\)/.test(l))).toBe(true);
  });

  it('never changes anything: the scan is the only health call', async () => {
    window.vex.health.fix = vi.fn(); window.vex.health.undo = vi.fn();
    await Test.maybeRun();
    expect(window.vex.health.fix).not.toHaveBeenCalled();
    expect(window.vex.health.undo).not.toHaveBeenCalled();
  });

  it('a part that cannot be read is said, not skipped', async () => {
    window.vex.health.scan = vi.fn(async () => ({ ok: false, error: 'disk gone' }));
    window.vex.diagnostics = vi.fn(async () => { throw new Error('no diag'); });
    const r = await Test.maybeRun();
    expect(r.errors).toEqual(['Health check: disk gone', 'Crash kinds: no diag']);
    expect(problems.all().map(p => p.message)).toContain('The health check could not be run');
  });

  it('does nothing when switched off or in a private window', async () => {
    Test.setEnabled(false);
    expect(await Test.maybeRun()).toBeNull();
    Test.setEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await Test.maybeRun()).toBeNull();
    delete window.VexTabPolicy;
    expect(window.vex.health.scan).not.toHaveBeenCalled();
  });

  it('the card offers a report, the settings from before the update, and the Health check', async () => {
    problems.note('AI news', 'Could not start', 'x');
    const r = await Test.maybeRun();
    const dlg = Test.open(r);
    const buttons = [...document.querySelectorAll('#vex-selftest-dialog button')].filter(b => !b.classList.contains('vexsr-x'));
    const by = (re) => buttons.find(b => re.test(b.textContent));
    by(/Report this problem/).click();
    expect(VexReport.open).toHaveBeenCalled();
    by(/before the update/).click();
    expect(VexUpdateSafetyNet.open).toHaveBeenCalled();
    Test.open(r);
    [...document.querySelectorAll('#vex-selftest-dialog button')].find(b => /health check/i.test(b.textContent)).click();
    expect(VexHealth.open).toHaveBeenCalled();
    expect(dlg).toBeTruthy();
  });

  it('the toast action opens the card', async () => {
    problems.note('AI news', 'Could not start', 'x');
    await Test.maybeRun();
    window.showToast.mock.calls[0][3].action.run();
    expect(document.getElementById('vex-selftest-dialog')).not.toBeNull();
    await wait();
  });
});
