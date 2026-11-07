// @vitest-environment jsdom
// The Actions board raises one Windows notification per red default-branch run (opt-in).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';
let B, A;
const run = (o = {}) => ({ id: 7, status: 'completed', conclusion: 'failure', name: 'CI', head_branch: 'main', updated_at: '2026-11-01T10:00:00Z', html_url: 'https://github.com/o/r/actions/runs/7', display_title: 'Fix it (#42)', ...o });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.vex = {};
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.DevDeskUtil = fresh(JS + 'dev-desk-util.js').DevDeskUtil;
  A = { suggest: vi.fn(() => true), osNotify: vi.fn(async () => ({ ok: true })) };
  globalThis.VexAttention = A;
  B = fresh(JS + 'actions-board.js').ActionsBoard;
});

describe('run to pull request', () => {
  it('reads the PR from GitHub or from the squash title', () => {
    expect(B.prNumber({ pull_requests: [{ number: 9 }] })).toBe(9);
    expect(B.prNumber({ display_title: 'Fix it (#42)' })).toBe(42);
    expect(B.prNumber({ display_title: 'No number here' })).toBe(0);
    expect(B.prUrl('o/r', B.summarize(run()))).toBe('https://github.com/o/r/pull/42');
    expect(B.prUrl('o/r', B.summarize(run({ display_title: 'plain' })))).toBe('');
  });
});

describe('Windows notification for a red run', () => {
  it('is off until switched on: only the inbox suggestion happens', () => {
    const s = B.state();
    B._tell('o/r', B.summarize(run()), s);
    expect(A.suggest).toHaveBeenCalledTimes(1);
    expect(A.osNotify).not.toHaveBeenCalled();
  });
  it('notifies once per run id, with Open run and Open PR', () => {
    B.setOsNotify(true);
    const s = B.state();
    const r = B.summarize(run());
    B._tell('o/r', r, s);
    B._tell('o/r', r, s);
    expect(A.osNotify).toHaveBeenCalledTimes(1);
    const call = A.osNotify.mock.calls[0][0];
    expect(call).toMatchObject({ feature: 'actions-board', urgency: 'useful', id: 'o/r#7', action: { label: 'Open run', key: 'run' } });
    expect(A.suggest.mock.calls.some(c => c[0].action && c[0].action.label === 'Open PR' && c[0].id === 'o/r#7:pr')).toBe(true);
    B._tell('o/r', B.summarize(run({ id: 8 })), s);
    expect(A.osNotify).toHaveBeenCalledTimes(2);
  });
  it('never for a run that did not fail', () => {
    B.setOsNotify(true);
    const s = B.state();
    expect(B.shouldOsNotify('o/r', B.summarize(run({ conclusion: 'success' })), s)).toBe(false);
  });
  it('the inbox button opens the run or the PR', () => {
    const s = B.state();
    s.rows['o/r'] = B.summarize(run());
    B.save(s);
    globalThis.TabManager = { createTab: vi.fn() };
    B.openFromInbox('run', { sub: 'o/r#7' });
    B.openFromInbox('pr', { sub: 'o/r#7:pr' });
    expect(globalThis.TabManager.createTab.mock.calls.map(c => c[0])).toEqual(['https://github.com/o/r/actions/runs/7', 'https://github.com/o/r/pull/42']);
    expect(() => B.openFromInbox('run', { sub: 'x/y#1' })).toThrow(/no longer/);
  });
});
