// @vitest-environment jsdom
// Wave 4: pinned agent tasks and the plan estimate (js/agent-pins.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let A, macros;
beforeEach(() => {
  localStorage.clear();
  macros = [
    { id: 'm1', name: 'Check the rota', calls: [{ tool: 'navigate', parameters: { url: 'https://rota.test/' } }, { tool: 'click_text', parameters: { text: 'This week' } }, { tool: 'type_text', parameters: { selector: '#password', text: 'hunter2' } }] },
    { id: 'm2', name: 'Other', calls: [{ tool: 'scroll', parameters: {} }] },
  ];
  globalThis.AgentLoop = { macros: () => macros, runMacro: vi.fn().mockResolvedValue({ done: [], failed: null }) };
  globalThis.CommandBar = { commands: [{ id: 'keep' }] };
  window.vexConfirm = vi.fn().mockResolvedValue(true);
  ({ VexAgentPins: A } = fresh(JS + 'agent-pins.js'));
  A._wired = false;
});

describe('the estimate', () => {
  it('matches the measured local speed: 82 steps took about 518 s', () => {
    const e = A.estimate(82, { backend: 'local' });
    expect(Math.abs(e.seconds - 518)).toBeLessThanOrEqual(2);
    expect(e.text).toMatch(/^About 8 min \d+ s for 82 steps on the local model/);
  });
  it('says when the plan is longer than the time budget', () => {
    const e = A.estimate(82, { backend: 'local', maxMinutes: 5 });
    expect(e.overBudget).toBe(true);
    expect(e.text).toMatch(/more than your 5 minute budget/);
    expect(A.estimate(10, { backend: 'local', maxMinutes: 10 }).overBudget).toBe(false);
  });
  it('invents no number for the cloud', () => {
    const e = A.estimate(10, { backend: 'cloud' });
    expect(e.seconds).toBeNull();
    expect(e.text).toMatch(/not been measured/);
  });
  it('formats durations', () => {
    expect(A.duration(45)).toBe('45 s');
    expect(A.duration(120)).toBe('2 min');
    expect(A.duration(125)).toBe('2 min 5 s');
  });
});

describe('the cloud offer goes only through the owner setting', () => {
  it('is made for a long local run when the cloud is the AI backend and the agent setting is off', () => {
    const o = A.cloudOffer({ est: A.estimate(82, { backend: 'local' }), backend: 'local', prefs: { useCloud: false }, status: { forceCloud: true } });
    expect(o.text).toMatch(/sensitivity gate/);
  });
  it('is not made when the setting is already on, the cloud is not the backend, the run is short or it already runs on the cloud', () => {
    const est = A.estimate(82, { backend: 'local' });
    expect(A.cloudOffer({ est, backend: 'local', prefs: { useCloud: true }, status: { forceCloud: true } })).toBeNull();
    expect(A.cloudOffer({ est, backend: 'local', prefs: { useCloud: false }, status: { forceCloud: false } })).toBeNull();
    expect(A.cloudOffer({ est: A.estimate(5, { backend: 'local' }), backend: 'local', prefs: { useCloud: false }, status: { forceCloud: true } })).toBeNull();
    expect(A.cloudOffer({ est: A.estimate(82, { backend: 'cloud' }), backend: 'cloud', prefs: { useCloud: true }, status: { forceCloud: true } })).toBeNull();
    expect(A.cloudOffer({ est, backend: 'local', prefs: {}, status: null })).toBeNull();
  });
  it('changes the setting only after a yes', async () => {
    const setPrefs = vi.fn();
    globalThis.AgentSafety = { setPrefs };
    window.vexConfirm = vi.fn().mockResolvedValue(false);
    expect(await A.allowCloud()).toBe(false);
    expect(setPrefs).not.toHaveBeenCalled();
    window.vexConfirm = vi.fn().mockResolvedValue(true);
    expect(await A.allowCloud()).toBe(true);
    expect(setPrefs).toHaveBeenCalledWith({ useCloud: true });
    delete globalThis.AgentSafety;
  });
  it('draws the line and, when offered, a button', () => {
    const on = vi.fn();
    const box = A.planNote({ stepCount: 82, backend: 'local', prefs: { maxMinutes: 10, useCloud: false }, status: { forceCloud: true }, onOffer: on });
    expect(box.textContent).toMatch(/About 8 min/);
    box.querySelector('button').click();
    expect(on).toHaveBeenCalled();
    expect(A.planNote({ stepCount: 3, backend: 'local', prefs: {}, status: {}, onOffer: on }).querySelector('button')).toBeNull();
  });
});

describe('the dry run', () => {
  it('lists every step and hides what looks like a secret', () => {
    const d = A.dryRun(macros[0]);
    expect(d.count).toBe(3);
    expect(d.lines[0]).toBe('1. Open https://rota.test/');
    expect(d.lines[1]).toBe('2. Click "This week"');
    expect(d.text).not.toContain('hunter2');
    expect(d.lines[2]).toContain('value hidden');
    expect(() => A.dryRun({ calls: [] })).toThrow(/no steps/);
  });
});

describe('pinned tasks', () => {
  it('pins a task as a command, once, and removes it again', () => {
    expect(A.pin('m1')).toBe(true);
    expect(A.pin('m1')).toBe(false);
    expect(CommandBar.commands.map(c => c.id)).toEqual(['keep', 'agent-pin:m1']);
    expect(CommandBar.commands[1].label).toBe('Run task: Check the rota');
    A.unpin('m1');
    expect(CommandBar.commands.map(c => c.id)).toEqual(['keep']);
  });
  it('refuses a task that is gone and a thirteenth pin', () => {
    expect(() => A.pin('nope')).toThrow(/gone/);
    macros = Array.from({ length: 13 }, (_, i) => ({ id: 'x' + i, name: 'x' + i, calls: [{ tool: 'wait', parameters: {} }] }));
    for (let i = 0; i < 12; i++) A.pin('x' + i);
    expect(() => A.pin('x12')).toThrow(/At most 12/);
  });
  it('shows the dry run first, and runs the ordinary replay only after Run it', async () => {
    A.pin('m1');
    window.vexConfirm = vi.fn().mockResolvedValue(false);
    expect(await A.runPinned('m1')).toBeNull();
    expect(AgentLoop.runMacro).not.toHaveBeenCalled();
    expect(window.vexConfirm.mock.calls[0][0].message).toContain('1. Open https://rota.test/');
    window.vexConfirm = vi.fn().mockResolvedValue(true);
    await A.runPinned('m1');
    expect(AgentLoop.runMacro).toHaveBeenCalledWith('m1');
  });
  it('drops the pin and says so when the task was deleted', async () => {
    A.pin('m2');
    macros = [macros[0]];
    await expect(A.runPinned('m2')).rejects.toThrow(/gone, so its command was removed/);
    expect(A.pinned()).toEqual([]);
  });
  it('removes the commands while it is switched off', () => {
    A.pin('m1');
    A.setEnabled(false);
    expect(CommandBar.commands.map(c => c.id)).toEqual(['keep']);
    A.setEnabled(true);
    expect(CommandBar.commands.map(c => c.id)).toEqual(['keep', 'agent-pin:m1']);
  });
  it('says when the saved pins are damaged', () => {
    localStorage.setItem('vex.agentPins.ids', '{bad');
    expect(() => A.pinned()).toThrow(/damaged/);
  });
});
