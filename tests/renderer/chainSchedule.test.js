// @vitest-environment jsdom
//
// The Scheduler's "chain" action: a named command chain run on a schedule. Steps that only open,
// time, mute or wait run freely; a plain command-bar step needs the person's approval of the exact
// steps first (the same rule as a recorded page script), and editing the chain cancels it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let Scheduler, CommandChains, run;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.showToast = vi.fn();
  run = vi.fn();
  globalThis.VexClock = { addTimer: vi.fn(async () => {}) };
  globalThis.CommandBar = { commands: [{ id: 'closeduplicates', label: 'Close Duplicate Tabs', action: run }] };
  globalThis.TabManager = { tabs: [], createTab: vi.fn() };
  await import('../../src/renderer/js/resume-workday.js');
  await import('../../src/renderer/js/compose-chains.js');
  await import('../../src/renderer/js/chain-steps.js');
  Scheduler = (await import('../../src/renderer/js/scheduler.js')).default;
  CommandChains = window.CommandChains;
  CommandChains.chains = [
    { id: 'safe', name: 'Standup', steps: ['open:https://a.test/', 'timer:15 min'] },
    { id: 'writes', name: 'Tidy', steps: ['closeduplicates', 'open:https://a.test/'] },
  ];
  // The chain runner waits between steps; the test does not need to.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
});

afterEach(() => {
  for (const k of ['VexClock', 'CommandBar', 'TabManager']) delete globalThis[k];
  vi.restoreAllMocks();
});

describe('the chain action', () => {
  it('is offered, asks for a chain, and refuses one that is gone', () => {
    expect(Scheduler.ACTIONS.chain.label).toMatch(/chain/i);
    expect(Scheduler.ACTIONS.chain.validate({})).toEqual(['Pick a chain']);
    expect(Scheduler.ACTIONS.chain.validate({ chainId: 'nope' })).toEqual(['That chain no longer exists']);
    expect(Scheduler.ACTIONS.chain.validate({ chainId: 'safe' })).toEqual([]);
    expect(Scheduler.ACTIONS.chain.summary({ chainId: 'safe' })).toBe('Run chain: Standup');
  });
});

describe('what may run with nobody watching', () => {
  it('a chain of open, timer, mute, focus, session and wait steps needs no approval', async () => {
    expect(CommandChains.unattendedRefusal(CommandChains.chains[0])).toBe('');
    const summary = await Scheduler.ACTIONS.chain.run({ action: { chainId: 'safe' } });
    expect(summary).toMatch(/Standup.*2 steps done/);
    expect(TabManager.createTab).toHaveBeenCalledWith('https://a.test/', false);
    expect(VexClock.addTimer).toHaveBeenCalledWith('15 min', '');
  });

  it('a command-bar step is refused until the exact steps were approved, and runs nothing', async () => {
    expect(CommandChains.unattendedRefusal(CommandChains.chains[1])).toMatch(/not approved/);
    await expect(Scheduler.ACTIONS.chain.run({ action: { chainId: 'writes' } })).rejects.toThrow(/was not run.*not approved/);
    expect(run).not.toHaveBeenCalled();
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });

  it('approving lists the command steps, then it runs; editing the chain cancels the approval', async () => {
    window.vexConfirm = vi.fn(async () => true);
    expect(await CommandChains.approveUnattended('writes')).toBe(true);
    const msg = window.vexConfirm.mock.calls[0][0].message;
    expect(msg).toContain('Close Duplicate Tabs');
    expect(msg).not.toContain('a.test');                         // the safe step is not a thing to approve
    await Scheduler.ACTIONS.chain.run({ action: { chainId: 'writes' } });
    expect(run).toHaveBeenCalledTimes(1);

    CommandChains.chains[1].steps.push('open:https://b.test/');  // an edit
    await expect(Scheduler.ACTIONS.chain.run({ action: { chainId: 'writes' } })).rejects.toThrow(/not approved/);
  });

  it('declining the approval changes nothing', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await CommandChains.approveUnattended('writes')).toBe(false);
    expect(CommandChains.chains[1].scheduleApproval).toBeUndefined();
  });

  it('a chain with a failing step is reported as failed, not as done', async () => {
    CommandChains.chains[0].steps.push('mute:nothing-open-matches');
    await expect(Scheduler.ACTIONS.chain.run({ action: { chainId: 'safe' } })).rejects.toThrow(/finished with problems/);
  });

  it('the Scheduler validates a whole chain task', () => {
    const data = { name: 'Standup', schedule: { type: 'daily', time: '09:00' }, action: { type: 'chain', chainId: 'safe' } };
    expect(Scheduler.validate(data)).toEqual([]);
    expect(Scheduler.validate({ ...data, action: { type: 'chain', chainId: '' } })).toEqual(['Pick a chain']);
  });
});
