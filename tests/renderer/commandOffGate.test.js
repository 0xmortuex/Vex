// @vitest-environment jsdom
//
// A Ctrl+K command that a manifest lists for a feature must not run while that feature is switched off.
// Many built-in commands (Find a Page I Lost, Snooze This Tab, the Pull Requests desk, Copy a Table...)
// called their module whatever the feature's switch said, so a switch that appeared to turn the feature off
// changed nothing for the command. The runner now asks the registry, and the refusal says how to turn it on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';

let CommandBar, VexUsage, flags, action;
function load() {
  vi.resetModules();
  delete window.__vexUsageQueue;
  ({ CommandBar } = fresh(JS + 'command.js'));
  VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
  globalThis.VexRegistry = { forCommand: (id) => ({ 'github-desk': 'brief-github-desk', 'snooze-current': 'brief-snooze', 'table-extract': 'table-extract' }[id] || null) };
}
function feature(id, title) {
  flags[id] = true;
  VexUsage.register({ id, title, group: '', keys: [], isEnabled: () => flags[id], disable: () => { flags[id] = false; }, enable: () => { flags[id] = true; } });
}
const run = async (id) => { CommandBar._execute({ id, label: id, action }); await Promise.resolve(); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="command-overlay"></div><input id="command-input"><div id="command-results"></div>';
  window.showToast = vi.fn();
  flags = {};
  action = vi.fn();
  delete globalThis.VexUsageCounters; delete globalThis.VexFeatureSheet; delete globalThis.VexReleaseChecklist; delete globalThis.VexAliases;
  load();
});

describe('a command of a feature that is switched off', () => {
  it('runs when the feature is on', async () => {
    feature('brief-github-desk', 'GitHub desk');
    await run('github-desk');
    expect(action).toHaveBeenCalledTimes(1);
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('does not run, and says where to turn the feature on', async () => {
    feature('brief-github-desk', 'GitHub desk');
    await VexUsage.disable('brief-github-desk');
    await run('github-desk');
    expect(action).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toBe('GitHub desk is switched off. Turn it on in Settings > Feature usage.');
  });

  it('runs again once the feature is back on', async () => {
    feature('brief-snooze', 'Snooze');
    await VexUsage.disable('brief-snooze');
    await run('snooze-current');
    expect(action).not.toHaveBeenCalled();
    await VexUsage.enable('brief-snooze');
    await run('snooze-current');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('names Minimal Vex when that is what holds it off', async () => {
    feature('table-extract', 'Table extract');
    VexUsage.setForcedHidden(['table-extract']);
    await run('table-extract');
    expect(action).not.toHaveBeenCalled();
    expect(window.showToast.mock.calls[0][0]).toMatch(/held off by Minimal Vex/);
  });

  it('does not stop a command with no owning feature, or whose feature the registry does not know', async () => {
    await run('freegames');                  // no owner
    globalThis.VexRegistry = { forCommand: () => 'not-registered-with-usage' };
    await run('anything');
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('lets a command that says runsWhenOff through', async () => {
    feature('brief-github-desk', 'GitHub desk');
    await VexUsage.disable('brief-github-desk');
    CommandBar._execute({ id: 'github-desk', label: 'x', runsWhenOff: true, action });
    await Promise.resolve();
    expect(action).toHaveBeenCalledTimes(1);
  });
});

// With the shared introduction loaded (VexActivation in js/feature-catalog.js), a switched-off command is introduced and offered,
// not just refused: the command runs once, through the same dispatcher, only after "Turn on and open".
describe('a Ctrl+K command of a feature that is switched off, with the introduction available', () => {
  let offer;
  beforeEach(() => {
    offer = vi.fn(async () => 'cancelled');
    globalThis.VexActivation = { offer };
  });
  afterEach(() => { delete globalThis.VexActivation; });

  it('offers the feature instead of running the command or showing a bare refusal', async () => {
    feature('brief-github-desk', 'GitHub desk');
    await VexUsage.disable('brief-github-desk');
    await run('github-desk');
    expect(action).not.toHaveBeenCalled();
    expect(window.showToast).not.toHaveBeenCalled();
    expect(offer).toHaveBeenCalledTimes(1);
    expect(offer.mock.calls[0][0]).toMatchObject({ featureId: 'brief-github-desk', requested: 'github-desk' });
  });

  it('runs the live command exactly once after the feature is turned on, without asking again', async () => {
    feature('brief-github-desk', 'GitHub desk');
    await VexUsage.disable('brief-github-desk');
    const live = { id: 'github-desk', label: 'GitHub desk', action: vi.fn() };
    CommandBar.commands = [live];
    offer.mockImplementation(async ({ run: go }) => { await VexUsage.enable('brief-github-desk'); await go(); return 'ran'; });
    await run('github-desk');
    await Promise.resolve();
    expect(live.action).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();                       // the stale item was replaced by the live one
    expect(offer).toHaveBeenCalledTimes(1);                      // no second introduction
  });

  it('a feature that is on never meets the introduction', async () => {
    feature('brief-github-desk', 'GitHub desk');
    await run('github-desk');
    expect(action).toHaveBeenCalledTimes(1);
    expect(offer).not.toHaveBeenCalled();
  });
});
