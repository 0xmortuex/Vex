// @vitest-environment jsdom
//
// Choosing a switched-off feature (Library, Discover, the feature search, a Ctrl+K command) introduces it first:
// what it does, how to use it, what it touches, how to turn it off. Only "Turn on and open" switches it on, the
// result is checked, and the original request runs once. Cancel, Escape and Open settings change nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexUsage, VexFeatures, VexActivation, flags, enableImpl, run;
const ID = 'workflow-release-radar';        // a real catalogue entry with a command, a Settings target and a manifest

function boot() {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  delete window.__vexUsageQueue;
  delete globalThis.VexMinimalMode;
  globalThis.SettingsUI = { openSection: vi.fn() };
  globalThis.VexSettingsGroups = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups;
  VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
  VexFeatures = fresh(JS + 'feature-catalog.js').VexFeatures;
  globalThis.VexFeatures = VexFeatures;
  const { VexRegistry } = fresh(JS + 'feature-registry.js');
  globalThis.VexRegistry = VexRegistry;
  VexRegistry.define({ id: ID, title: 'Release radar', group: 'Workflow', commands: ['release-radar'], permissions: { reads: ['the projects you follow'], writes: [], sends: ['the name of a project to GitHub'] } });
  VexActivation = fresh(JS + 'feature-catalog.js').VexActivation;
  flags = { [ID]: false };
  enableImpl = async () => { flags[ID] = true; };
  VexUsage.register({ id: ID, title: 'Release radar', group: 'Workflow', keys: [], isEnabled: () => flags[ID], disable: async () => { flags[ID] = false; }, enable: (...a) => enableImpl(...a) });
  run = vi.fn(async () => {});
}
const dialog = () => document.getElementById('vex-activation');
const button = (label) => [...document.querySelectorAll('#vex-activation button')].find(b => b.textContent === label);
const tick = () => new Promise(r => setTimeout(r, 0));
async function opened(extra = {}) {
  const p = VexActivation.offer({ entry: VexFeatures.get(ID), requested: 'Release radar', run, ...extra });
  await tick(); await tick();
  return p;
}

beforeEach(boot);

describe('an enabled feature', () => {
  it('runs the request at once with no dialog', async () => {
    flags[ID] = true;
    expect(await VexActivation.offer({ entry: VexFeatures.get(ID), run })).toBe('ran');
    expect(run).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});

describe('a switched-off feature is introduced, not refused', () => {
  it('shows what it does, how to use it, what it touches and how to turn it off, and enables nothing yet', async () => {
    const p = opened();
    await tick(); await tick();
    const text = dialog().textContent;
    expect(text).toMatch(/Release radar is switched off/);
    expect(text).toMatch(/What it does/);
    expect(text).toMatch(/Watches the projects you follow/);              // the catalogue's own sentence
    expect(text).toMatch(/How to use it/);
    expect(text).toMatch(/Ctrl\+K and run .Show what is new for me./);     // from the entry's real command
    expect(text).toMatch(/What it touches/);
    expect(text).toMatch(/Reads: the projects you follow/);                // the manifest's own lines
    expect(text).toMatch(/Sends off this computer: the name of a project to GitHub/);
    expect(text).toMatch(/Turning it off again/);
    expect(text).toMatch(/Settings > Workflow and chains/);
    expect([...dialog().querySelectorAll('button')].map(b => b.textContent)).toEqual(expect.arrayContaining(['Turn on and open', 'Open settings', 'Cancel']));
    expect(flags[ID]).toBe(false);
    expect(run).not.toHaveBeenCalled();
    button('Cancel').click();
    expect(await p).toBe('cancelled');
  });

  it('Cancel changes nothing and runs nothing', async () => {
    const p = opened();
    await tick(); await tick();
    button('Cancel').click();
    expect(await p).toBe('cancelled');
    expect(flags[ID]).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('Escape and closing the dialog are a Cancel', async () => {
    const p = opened();
    await tick(); await tick();
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (dialog()) dialog().remove();
    expect(await p).toBe('cancelled');
    expect(flags[ID]).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('Open settings goes to the feature’s Settings target and enables nothing', async () => {
    const p = opened();
    await tick(); await tick();
    button('Open settings').click();
    expect(await p).toBe('settings');
    expect(SettingsUI.openSection).toHaveBeenCalledWith('workflow-settings');
    expect(flags[ID]).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Turn on and open', () => {
  it('waits for the switch to finish, checks it, then runs the request exactly once', async () => {
    const order = [];
    enableImpl = async () => { order.push('enable-start'); await new Promise(r => setTimeout(r, 15)); flags[ID] = true; order.push('enable-done'); };
    run = vi.fn(async () => { order.push('run'); });
    const p = opened({ run });
    await tick(); await tick();
    button('Turn on and open').click();
    button('Turn on and open')?.click();                                  // a second press while it works is ignored
    expect(await p).toBe('ran');
    expect(order).toEqual(['enable-start', 'enable-done', 'run']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(flags[ID]).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('a failed switch-on says why, keeps the dialog, and does not run the request', async () => {
    enableImpl = async () => { throw new Error('the settings file is read-only'); };
    const p = opened();
    await tick(); await tick();
    button('Turn on and open').click();
    await tick(); await tick();
    expect(dialog().textContent).toMatch(/It could not be turned on: the settings file is read-only/);
    expect(button('Turn on and open').disabled).toBe(false);              // the person can try again or cancel
    expect(run).not.toHaveBeenCalled();
    button('Cancel').click();
    expect(await p).toBe('cancelled');
  });

  it('a feature that stays held off after switching on is reported, never overridden', async () => {
    enableImpl = async () => { /* accepted, but a quiet mode still holds it */ };
    const p = opened();
    await tick(); await tick();
    button('Turn on and open').click();
    await tick(); await tick();
    expect(dialog().textContent).toMatch(/still held off.*quiet modes/);
    expect(run).not.toHaveBeenCalled();
    button('Cancel').click();
    await p;
  });

  it('if the request itself fails after the switch-on, it says the feature is on but the request failed', async () => {
    run = vi.fn(async () => { throw new Error('Open a page first'); });
    const p = opened({ run });
    await tick(); await tick();
    button('Turn on and open').click();
    expect(await p).toBe('failed');
    expect(flags[ID]).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith('Release radar is on, but it could not open: Open a page first', 'error');
  });
});

describe('policy blocks are not overridden', () => {
  it('Minimal Vex: no Turn on button, a plain explanation, and a way to leave Minimal Vex', async () => {
    VexUsage.setForcedHidden([ID]);
    const p = opened();
    await tick(); await tick();
    expect(dialog().textContent).toMatch(/Minimal Vex is holding this feature off/);
    expect(button('Turn on and open')).toBeUndefined();
    expect(button('Open settings')).toBeTruthy();
    expect(flags[ID]).toBe(false);
    button('Cancel').click();
    await p;
    expect(run).not.toHaveBeenCalled();
  });

  it('only one introduction at a time', async () => {
    const first = opened();
    await tick(); await tick();
    expect(await VexActivation.offer({ entry: VexFeatures.get(ID), run })).toBe('busy');
    button('Cancel').click();
    await first;
  });
});

describe('a feature id without a catalogue entry still gets an introduction from its manifest', () => {
  it('names the feature and its data lines', async () => {
    const { VexRegistry } = require(JS + 'feature-registry.js');
    VexRegistry.define({ id: 'lone', title: 'Lone feature', group: 'Lone', permissions: { reads: ['one thing'], writes: [], sends: [] } });
    flags.lone = false;
    VexUsage.register({ id: 'lone', title: 'Lone feature', group: 'Lone', keys: [], isEnabled: () => flags.lone, disable: async () => { flags.lone = false; }, enable: async () => { flags.lone = true; } });
    const p = VexActivation.offer({ featureId: 'lone', requested: 'x', run });
    await tick(); await tick();
    expect(dialog().textContent).toMatch(/Lone feature is switched off/);
    expect(dialog().textContent).toMatch(/Reads: one thing/);
    expect(dialog().textContent).toMatch(/Sends nothing off this computer/);
    button('Turn on and open').click();
    expect(await p).toBe('ran');
    expect(flags.lone).toBe(true);
  });
});
