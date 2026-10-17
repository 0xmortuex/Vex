// @vitest-environment jsdom
//
// T2-008: the release pre-flight (js/release-checklist.js VexReleasePreflight): GitHub-proven ticks and a
// checklist per repository. GitHub is a local stand-in; nothing is sent.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
let P, vault, routes;

const b64 = (o) => ({ encoding: 'base64', content: btoa(JSON.stringify(o)) });
const run = (id, wf, status, conclusion) => ({ id, workflow_id: wf, name: 'wf' + wf, status, conclusion });

beforeEach(() => {
  localStorage.clear();
  delete require.cache[require.resolve(JS + 'release-checklist.js')];
  routes = {};
  vault = { json: vi.fn(async (p) => { const k = Object.keys(routes).find(r => p.startsWith(r)); if (!k) throw new Error('unexpected ' + p); const v = routes[k]; if (v instanceof Error) throw v; return v; }) };
  globalThis.GitHubVault = vault;
  window.showToast = vi.fn();
  ({ VexReleasePreflight: P } = require(JS + 'release-checklist.js'));
});

describe('Actions on main = success', () => {
  const url = '/repos/o/r/actions/runs?branch=main';
  it('passes when the newest run of every workflow on main is green', async () => {
    routes[url] = { workflow_runs: [run(5, 1, 'completed', 'success'), run(4, 1, 'completed', 'failure'), run(3, 2, 'completed', 'success')] };
    const r = await P.checkActions('o/r');
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('2 workflow');
  });
  it('fails when one workflow\'s newest run is red, naming it, and when a run is still going', async () => {
    routes[url] = { workflow_runs: [run(5, 1, 'completed', 'failure'), run(3, 2, 'completed', 'success')] };
    expect(await P.checkActions('o/r')).toMatchObject({ ok: false, detail: expect.stringContaining('wf1 failure') });
    routes[url] = { workflow_runs: [run(6, 1, 'in_progress', null), run(5, 1, 'completed', 'success')] };
    expect(await P.checkActions('o/r')).toMatchObject({ ok: false, detail: expect.stringContaining('Still running') });
    routes[url] = { workflow_runs: [] };
    expect((await P.checkActions('o/r')).ok).toBe(false);
  });
});

describe('latest tag == package.json version', () => {
  const tags = '/repos/o/r/tags', pkg = '/repos/o/r/contents/package.json?ref=main';
  it('passes when the highest version tag equals package.json (numbers compared, not text)', async () => {
    routes[tags] = [{ name: 'v1.9.0' }, { name: 'v1.10.0' }, { name: 'nightly' }];
    routes[pkg] = b64({ version: '1.10.0' });
    expect((await P.checkTag('o/r')).ok).toBe(true);
  });
  it('fails with both versions named when they differ, and when there is no tag', async () => {
    routes[tags] = [{ name: 'v22.24.5' }];
    routes[pkg] = b64({ version: '22.24.6' });
    const r = await P.checkTag('o/r');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('v22.24.5');
    expect(r.detail).toContain('22.24.6');
    routes[tags] = [{ name: 'nightly' }];
    expect((await P.checkTag('o/r')).detail).toMatch(/no version tag/);
  });
});

describe('run() keeps answers, and a failed read is a failed check with its reason, never a pass', () => {
  it('records both checks; one failing to read does not stop the other', async () => {
    routes['/repos/o/r/actions/runs?branch=main'] = new Error('GitHub is limiting requests');
    routes['/repos/o/r/tags'] = [{ name: 'v1.0.0' }];
    routes['/repos/o/r/contents/package.json'] = b64({ version: '1.0.0' });
    const out = await P.run('o/r');
    expect(out.results['actions-main']).toMatchObject({ ok: false, error: true });
    expect(out.results['actions-main'].detail).toContain('limiting');
    expect(out.results['tag-matches'].ok).toBe(true);
    expect(P.results('o/r').results['tag-matches'].ok).toBe(true);
    await expect(P.run('not a repo')).rejects.toThrow(/not a repository/);
  });
});

describe('the checklist per repository', () => {
  it('lists the Vex repository until one is added, then only the listed ones', () => {
    expect(P.repos()).toEqual(['0xmortuex/Vex']);
    P.addRepo('https://github.com/a/b');
    expect(P.repos().sort()).toEqual(['0xmortuex/Vex', 'a/b']);
    expect(() => P.addRepo('a/b')).toThrow(/already/);
    expect(() => P.addRepo('nonsense')).toThrow(/owner\/repo/);
    P.removeRepo('0xmortuex/Vex');
    expect(P.repos()).toEqual(['a/b']);
  });
  it('keeps the person\'s own lines and ticks, and refuses an empty line or a tick for a line that is not there', () => {
    const id = P.addCustom('o/r', '  Smoke-test the installer  ');
    expect(P.custom('o/r')).toEqual([{ id, text: 'Smoke-test the installer' }]);
    P.setCustomTick('o/r', id, true);
    expect(P.customTicked('o/r')[id]).toBeGreaterThan(0);
    expect(() => P.addCustom('o/r', '   ')).toThrow(/Write the line/);
    expect(() => P.setCustomTick('o/r', 'nope', true)).toThrow(/not on the list/);
    P.removeCustom('o/r', id);
    expect(P.custom('o/r')).toEqual([]);
    expect(P.customTicked('o/r')[id]).toBeUndefined();
  });
  it('opens the GitHub pages of the checks that did not pass, and nothing when all passed', async () => {
    routes['/repos/o/r/actions/runs?branch=main'] = { workflow_runs: [run(5, 1, 'completed', 'failure')] };
    routes['/repos/o/r/tags'] = [{ name: 'v1.0.0' }];
    routes['/repos/o/r/contents/package.json'] = b64({ version: '1.0.0' });
    await P.run('o/r');
    expect(P.remainingPages('o/r')).toEqual(['https://github.com/o/r/actions?query=branch%3Amain']);
    const opened = [];
    globalThis.TabManager = { createTab: (u) => opened.push(u) };
    expect(P.openRemaining('o/r')).toBe(1);
    expect(opened).toEqual(['https://github.com/o/r/actions?query=branch%3Amain']);
    routes['/repos/o/r/actions/runs?branch=main'] = { workflow_runs: [run(6, 1, 'completed', 'success')] };
    await P.run('o/r');
    expect(P.openRemaining('o/r')).toBe(0);
    delete globalThis.TabManager;
  });
  it('writes the checklist as markdown', async () => {
    routes['/repos/o/r/actions/runs?branch=main'] = { workflow_runs: [run(5, 1, 'completed', 'success')] };
    routes['/repos/o/r/tags'] = [{ name: 'v2.0.0' }];
    routes['/repos/o/r/contents/package.json'] = b64({ version: '2.0.1' });
    await P.run('o/r');
    P.addCustom('o/r', 'Check the update feed');
    const md = P.markdown('o/r');
    expect(md).toContain('- [x] Actions on main = success');
    expect(md).toContain('- [ ] Latest tag = package.json version (Latest tag is v2.0.0 but package.json says 2.0.1)');
    expect(md).toContain('- [ ] Check the update feed');
  });
});
