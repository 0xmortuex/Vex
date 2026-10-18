// @vitest-environment jsdom
//
// A feature held off in the registry (staged enablement, or switched off in Feature usage) and then
// switched ON from its OWN Settings switch must stay on after a restart. That switch calls the module's
// setEnabled and VexUsage.touch, never VexUsage.enable, so the registry's "switched off here" mark was
// left behind and register() switched the feature off again at the next start.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let VexUsage;
let flag;

function load() {
  vi.resetModules();
  delete window.__vexUsageQueue;
  VexUsage = fresh('../../src/renderer/js/vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
}
// One feature the way a module registers itself: its own flag, read and written through enabled/disable/enable.
function spec(id) {
  return { id, title: id, group: '', keys: [], isEnabled: () => flag.on, disable: vi.fn(() => { flag.on = false; }), enable: vi.fn(() => { flag.on = true; }) };
}
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  flag = { on: true };
  delete globalThis.VexFeatures; delete globalThis.VexUsageCounters; delete globalThis.VexFeatureSheet;
  load();
});

describe('a feature switched on from its own Settings switch', () => {
  it('stays on after a restart (the stale off mark is cleared when the feature is used)', async () => {
    const s = spec('guest-session');
    VexUsage.register(s);
    await VexUsage.disable('guest-session');           // staged enablement holds it off
    expect(flag.on).toBe(false);
    flag.on = true;                                      // the module's own Settings switch: setEnabled(true) ...
    VexUsage.touch('guest-session');                     // ... then VexUsage.touch, exactly as the switches do
    VexUsage._save();

    // A restart: a fresh registry reads the saved state, the module reads its own flag (still on), registers.
    load();
    const again = spec('guest-session');
    VexUsage.register(again);
    await settle();
    expect(again.disable).not.toHaveBeenCalled();
    expect(flag.on).toBe(true);
  });

  it('still switches a feature off again when it was never turned back on', async () => {
    const s = spec('slot-watcher');
    VexUsage.register(s);
    await VexUsage.disable('slot-watcher');
    VexUsage._save();
    // The module's own start-up turns itself on again (a default-on module): the dashboard's off mark wins.
    flag.on = true;
    load();
    const again = spec('slot-watcher');
    VexUsage.register(again);
    await settle();
    expect(again.disable).toHaveBeenCalledTimes(1);
  });

  it('does not clear the mark when the feature is off (a use of something switched off)', async () => {
    const s = spec('photo-prep');
    VexUsage.register(s);
    await VexUsage.disable('photo-prep');
    VexUsage.touch('photo-prep');
    VexUsage._save();
    load();
    const again = spec('photo-prep');
    flag.on = false;
    VexUsage.register(again);
    await settle();
    expect(JSON.parse(localStorage.getItem('vex.featureUsage')).off['photo-prep']).toBeTruthy();
  });

  it('does not clear the mark for a feature Minimal mode holds hidden', async () => {
    const s = spec('form-assist');
    VexUsage.register(s);
    await VexUsage.disable('form-assist');
    flag.on = true;
    VexUsage.setForcedHidden(['form-assist']);
    VexUsage.touch('form-assist');
    VexUsage._save();
    expect(JSON.parse(localStorage.getItem('vex.featureUsage')).off['form-assist']).toBeTruthy();
  });
});
