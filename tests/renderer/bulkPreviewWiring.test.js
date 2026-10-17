// @vitest-environment jsdom
//
// T3-051: the shared dry-run list (VexPlan) now stands in front of an automation being added and an
// agent run with several changes, on top of tab closes and command chains (see undoConversions /
// chainSteps tests).
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
});

describe('VexPlan.confirmSteps', () => {
  it('asks the shared dialog for a read-only list and answers with a plain boolean', async () => {
    const { VexPlan } = require('../../src/renderer/js/plan-preview.js');
    const spy = vi.spyOn(VexPlan, 'confirm').mockResolvedValue({ ok: true, chosen: ['s0'] });
    const yes = await VexPlan.confirmSteps({ title: 'T', steps: [{ label: 'one', detail: 'd' }, { label: 'two' }], okLabel: 'Go' });
    expect(yes).toBe(true);
    expect(spy.mock.calls[0][0]).toMatchObject({ selectable: false, items: [{ id: 's0', label: 'one', detail: 'd' }, { id: 's1', label: 'two', detail: '' }] });
    spy.mockResolvedValue({ ok: false });
    expect(await VexPlan.confirmSteps({ title: 'T', steps: [] })).toBe(false);
    await expect(VexPlan.confirmSteps({ title: 'T' })).rejects.toThrow(/list of steps/);
  });
});

describe('Automations: a rule is shown before it exists', () => {
  async function open(confirmSteps) {
    globalThis.VexPlan = { BULK_MIN: 3, confirmSteps };
    globalThis.TabManager = { tabs: [{ id: 1, url: 'https://mail.example.com/inbox', title: 'Inbox' }, { id: 2, url: 'https://other.test/', title: 'Other' }] };
    globalThis.VexIcons = { svg: () => '' };
    globalThis.vexId = (p) => p + '1';
    window.vexId = globalThis.vexId;
    require('../../src/renderer/js/automations.js');
    const Automations = window.Automations;
    Automations.open();
    const q = (s) => document.querySelector(s);
    q('#au-trigval').value = 'mail.example.com';
    q('#au-actval').value = 'https://calendar.example.com';
    q('#au-add').click();
    await new Promise(r => setTimeout(r, 0));
    return Automations;
  }

  it('lists the rule and the open tabs it would match, and saves only after yes', async () => {
    const confirmSteps = vi.fn(async () => true);
    const A = await open(confirmSteps);
    const steps = confirmSteps.mock.calls[0][0].steps;
    expect(steps[0].label).toBe('when a URL contains "mail.example.com" → open https://calendar.example.com');
    expect(steps.slice(1).map(s => s.label)).toEqual(['Inbox']);
    expect(A._load()).toHaveLength(1);
  });

  it('saves nothing when the person says no', async () => {
    const A = await open(vi.fn(async () => false));
    expect(A._load()).toHaveLength(0);
  });
});

describe('Agent task: a run with several changes lists them first', () => {
  function load(confirmSteps) {
    globalThis.VexPlan = { BULK_MIN: 3, confirmSteps };
    globalThis.AgentSafety = { enabled: () => true, prefs: () => ({ maxSteps: 10, maxMinutes: 5 }) };
    globalThis.AgentBudget = class { };
    const started = [];
    globalThis.TaskRun = class { constructor(o) { this.o = o; started.push(o); } async run() { this.status = 'done'; } };
    globalThis.AgentTaskRunner = { describeStep: (s) => 'do ' + s.id };
    window.showToast = vi.fn();
    const { AgentTaskPanel } = require('../../src/renderer/js/agent-task-panel.js');
    Object.assign(AgentTaskPanel, { _deps: () => ({}), _renderRun: vi.fn(), _renderMeta: vi.fn(), _persist: vi.fn() });
    return { P: AgentTaskPanel, started };
  }
  const plan = (kinds) => ({ goal: 'g', steps: kinds.map((kind, i) => ({ id: i + 1, kind })), backend: 'local' });

  it('three changes are listed, and nothing starts until the person agrees', async () => {
    const confirmSteps = vi.fn(async () => false);
    const { P, started } = load(confirmSteps);
    P._plan = plan(['read', 'write', 'write', 'write']);
    await P.startRun();
    expect(confirmSteps).toHaveBeenCalledTimes(1);
    expect(confirmSteps.mock.calls[0][0].steps.map(s => s.label)).toEqual(['do 2', 'do 3', 'do 4']);
    expect(started).toHaveLength(0);
    expect(P._plan).not.toBeNull();            // the plan is still there to approve again or discard
    confirmSteps.mockResolvedValue(true);
    await P.startRun();
    expect(started).toHaveLength(1);
  });

  it('fewer than three changes, or a read-only run, start without the list', async () => {
    const confirmSteps = vi.fn(async () => true);
    const { P, started } = load(confirmSteps);
    P._plan = plan(['write', 'write']);
    await P.startRun();
    P._plan = { ...plan(['write', 'write', 'write', 'write']), readOnly: true };
    await P.startRun();
    expect(confirmSteps).not.toHaveBeenCalled();
    expect(started).toHaveLength(2);
  });
});
