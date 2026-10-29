// @vitest-environment jsdom
//
// "Mouse gestures" is a feature with its own on/off switch (2026-10-30). The Mouse gesture editor only chooses what each stroke does; turning the
// editor off left every stroke working, and the strokes themselves had no switch in Settings > Feature switches.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let VexUsage, VexRegistry, VexUsageRegistry, MouseGestures;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<input type="checkbox" id="setting-gestures" checked>';
  vi.resetModules();
  delete window.__vexUsageQueue;
  VexUsage = fresh('../../src/renderer/js/vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
  VexRegistry = fresh('../../src/renderer/js/feature-registry.js').VexRegistry;
  globalThis.VexRegistry = VexRegistry;
  fresh('../../src/renderer/js/feature-manifests.js');
  MouseGestures = fresh('../../src/renderer/js/gestures.js').MouseGestures;
  globalThis.MouseGestures = MouseGestures;
  VexUsageRegistry = fresh('../../src/renderer/js/vex-usage-registry.js').VexUsageRegistry;
});

describe('Mouse gestures', () => {
  it('is a feature with a manifest, and the usage registry can switch it', () => {
    expect(VexRegistry.get('mouse-gestures').title).toBe('Mouse gestures');
    expect(VexUsageRegistry.register(VexUsage, ['mouse-gestures'])).toEqual(['mouse-gestures']);
    expect(VexUsage.isEnabled('mouse-gestures')).toBe(true);
  });
  it('off really stops the strokes (MouseGestures.enabled says no), is remembered, and the Settings checkbox follows; on puts it back', async () => {
    VexUsageRegistry.register(VexUsage, ['mouse-gestures']);
    await VexUsage.disable('mouse-gestures');
    expect(MouseGestures.enabled()).toBe(false);
    expect(localStorage.getItem('vex.gesturesEnabled')).toBe('off');
    expect(document.getElementById('setting-gestures').checked).toBe(false);
    await VexUsage.enable('mouse-gestures');
    expect(MouseGestures.enabled()).toBe(true);
    expect(document.getElementById('setting-gestures').checked).toBe(true);
  });
  it('the editor is a separate switch: turning it off leaves the strokes working, which is why Mouse gestures has its own', () => {
    VexUsageRegistry.register(VexUsage, ['mouse-gestures', 'gesture-editor']);
    expect(VexRegistry.get('gesture-editor').title).toBe('Mouse gesture editor');
    expect(VexRegistry.get('mouse-gestures').storageKeys).toEqual(['vex.gesturesEnabled']);
    expect(VexRegistry.get('gesture-editor').storageKeys).not.toContain('vex.gesturesEnabled');
  });
  it('a setting that cannot be saved is an error, not a silent no-op', async () => {
    VexUsageRegistry.register(VexUsage, ['mouse-gestures']);
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('full'); };
    try { await expect(VexUsage.disable('mouse-gestures')).rejects.toThrow(/could not be saved/); }
    finally { Storage.prototype.setItem = real; }
  });
});
