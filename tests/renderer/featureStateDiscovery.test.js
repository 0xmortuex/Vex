// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const { VexFeatures: C } = require('../../src/renderer/js/feature-catalog.js');
const { VexUsage: U } = require('../../src/renderer/js/vex-usage.js');
const { FeatureLibrary: L } = require('../../src/renderer/js/feature-library.js');
const { VexDiscover: D } = require('../../src/renderer/js/discover.js');
const { VexActivation: A } = require('../../src/renderer/js/feature-catalog.js');
const { VexSettingsGroups: G } = require('../../src/renderer/js/vex-settings-groups.js');
const tick = () => new Promise(r => setTimeout(r, 0));
const dialogButton = (label) => [...document.querySelectorAll('#vex-activation button')].find(b => b.textContent === label);
const { build } = require('../../scripts/gen-features-doc.js');
const manifests = new Set(build().manifests.map(m => m.id));
const entries = C.ITEMS.filter(f => manifests.has(f.feature || f.id));
let flags;
beforeEach(() => {
  localStorage.clear(); document.body.textContent = '';
  U.flush(); U._features.clear(); U._state = null; U._forcedHidden.clear(); flags = new Map();
  vi.stubGlobal('VexUsage', U); vi.stubGlobal('VexFeatures', C); vi.stubGlobal('VexActivation', A); vi.stubGlobal('VexSettingsGroups', G);
  vi.stubGlobal('CommandBar', { commands: [{ id: C.get('tab-intent').cmd, label: 'x', action: vi.fn() }], _execute: vi.fn() });
  window.showToast = vi.fn();
});
afterEach(() => { U.flush(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function register(f, enabled = false, enable) {
  const id = f.feature || f.id; flags.set(id, enabled);
  U.register({ id, title: f.name || id, isEnabled: () => flags.get(id), disable: () => flags.set(id, false), enable: enable || (() => flags.set(id, true)) });
  return id;
}
describe('catalogue runtime state coverage', () => {
  it.each(entries.map(f => [f.id, f]))('%s reads and enables its registered runtime flag without a Settings checkbox', async (_id, f) => {
    const id = register(f);
    const state = C.offState(f); expect(state, f.id).not.toBeNull();
    expect(U.isEnabled(id)).toBe(false); // Looking at the catalogue must not opt in.
    await state.enable(); expect(U.isEnabled(id)).toBe(true); expect(C.offState(f)).toBeNull();
  });
  it('trusts a registered runtime flag over a stale static checkbox', () => {
    const f = C.ITEMS.find(x => x.setting?.id); register(f, true);
    const box = document.createElement('input'); box.type = 'checkbox'; box.id = f.setting.id; document.body.append(box);
    expect(C.offState(f)).toBeNull();
  });
  it('does not turn a feature on behind Minimal Vex', async () => {
    const f = C.get('tab-intent'); register(f); vi.stubGlobal('VexMinimalMode', { isOn: () => true });
    await expect(C.offState(f).enable()).rejects.toThrow(/Minimal Vex/); expect(flags.get('tab-intent')).toBe(false);
  });
  it('does not report success when the setter fails to enable the feature', async () => {
    const f = C.get('tab-intent'); register(f, false, () => {});
    await expect(C.offState(f).enable()).rejects.toThrow(/still held off/);
  });
});
describe('feature discovery UI', () => {
  it('shows the actual off state in the Library, introduces the feature, and enables only on "Turn on and open"', async () => {
    const f = C.get('tab-intent'); register(f);
    document.body.innerHTML = L._cardHtml(L.card(f)); L._wireCards(document.body);
    const button = document.querySelector('[data-feature-enable]'); expect(button).not.toBeNull();
    expect(flags.get('tab-intent')).toBe(false);
    const done = L.enableFeature(f.id, button);
    await tick(); await tick();
    expect(document.getElementById('vex-activation')).not.toBeNull();         // the introduction, not a silent switch-on
    expect(flags.get('tab-intent')).toBe(false);                              // looking and clicking Turn on has enabled nothing
    dialogButton('Turn on and open').click();
    await done;
    expect(flags.get('tab-intent')).toBe(true); expect(document.querySelector('[data-feature-enable]')).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('is on'), 'success');
    expect(CommandBar._execute).toHaveBeenCalledTimes(1);                     // the way to open it ran once, through the shared dispatcher
  });
  it('Cancel in the Library introduction leaves the feature off and runs nothing', async () => {
    const f = C.get('tab-intent'); register(f);
    document.body.innerHTML = L._cardHtml(L.card(f)); L._wireCards(document.body);
    const done = L.enableFeature(f.id, document.querySelector('[data-feature-enable]'));
    await tick(); await tick();
    dialogButton('Cancel').click();
    await done;
    expect(flags.get('tab-intent')).toBe(false);
    expect(CommandBar._execute).not.toHaveBeenCalled();
  });
  it('Discover waits for the enable result and reports an error rather than false success', async () => {
    const f = C.get('tab-intent'); register(f, false, async () => { throw new Error('disk full'); });
    const done = D.turnOn(f.id);
    await tick(); await tick();
    dialogButton('Turn on and open').click();
    await tick(); await tick();
    expect(document.getElementById('vex-activation').textContent).toMatch(/could not be turned on: disk full/);
    expect(flags.get('tab-intent')).toBe(false);
    expect(window.showToast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    dialogButton('Cancel').click();
    await done;
  });
});
