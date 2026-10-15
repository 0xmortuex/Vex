// @vitest-environment jsdom
//
// Minimal Vex (js/vex-minimal-mode.js): one switch turns off every registered
// feature and hides its Settings section; switching back restores each one to
// exactly the state it was in, so a feature that was already off stays off.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexUsage, VexMinimalMode;

function load() {
  vi.resetModules();
  delete window.__vexUsageQueue;
  VexUsage = fresh('../../src/renderer/js/vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
  globalThis.VexSettingsGroups = fresh('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
  VexMinimalMode = fresh('../../src/renderer/js/vex-minimal-mode.js').VexMinimalMode;
}
function feature(id, { on = true, group = '', fails = false, noIsEnabled = false } = {}) {
  const s = { on };
  const spec = {
    id, title: 'F ' + id, group,
    disable: vi.fn(() => { if (fails) throw new Error('stuck'); s.on = false; }),
    enable: vi.fn(() => { s.on = true; }),
  };
  if (!noIsEnabled) spec.isEnabled = () => s.on;
  return { s, spec };
}
const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content">'
    + '<div class="setting-group"><label class="setting-label">General</label></div>'
    + '<div class="setting-group"><label class="setting-label">Morning brief</label></div></div></div>';
  load();
});

describe('Minimal Vex', () => {
  it('turns off every registered feature and hides its Settings section', async () => {
    const a = feature('a', { group: 'Morning brief' });
    const b = feature('b');
    VexUsage.register(a.spec);
    VexUsage.register(b.spec);
    const r = await VexMinimalMode.enter();
    expect(r.failed).toEqual([]);
    expect(a.s.on).toBe(false);
    expect(b.s.on).toBe(false);
    expect(VexMinimalMode.isOn()).toBe(true);
    const groups = [...document.querySelectorAll('.setting-group')];
    expect(groups[1].classList.contains('vex-usage-hidden')).toBe(true);
    expect(groups[0].classList.contains('vex-usage-hidden')).toBe(false);
  });

  it('switching back restores exactly: what was off before stays off', async () => {
    const was = feature('was-on');
    const wasOff = feature('was-off', { on: false });
    const dash = feature('dash');                       // switched off from the dashboard
    VexUsage.register(was.spec); VexUsage.register(wasOff.spec); VexUsage.register(dash.spec);
    await VexUsage.disable('dash');
    await VexMinimalMode.enter();
    expect(wasOff.spec.disable).not.toHaveBeenCalled();
    const r = await VexMinimalMode.leave();
    expect(r.restored).toEqual(['F was-on']);
    expect(was.s.on).toBe(true);
    expect(wasOff.s.on).toBe(false);
    expect(dash.s.on).toBe(false);
    expect(wasOff.spec.enable).not.toHaveBeenCalled();
    expect(dash.spec.enable).not.toHaveBeenCalled();
    expect(VexMinimalMode.isOn()).toBe(false);
    expect(document.querySelector('.vex-usage-hidden')).toBeNull();
  });

  it('a feature that would not switch off is reported, left as it was, and not "restored"', async () => {
    const stuck = feature('stuck', { fails: true });
    const fine = feature('fine');
    VexUsage.register(stuck.spec); VexUsage.register(fine.spec);
    const r = await VexMinimalMode.enter();
    expect(r.failed).toEqual([{ id: 'stuck', error: 'stuck' }]);
    expect(stuck.s.on).toBe(true);
    const back = await VexMinimalMode.leave();
    expect(back.restored).toEqual(['F fine']);
    expect(stuck.spec.enable).not.toHaveBeenCalled();
  });

  it('a feature that registers while it is on is taken out of play, and put back on leaving', async () => {
    VexUsage.register(feature('first').spec);
    await VexMinimalMode.enter();
    const late = feature('late');
    VexUsage.register(late.spec);
    await tick();
    expect(late.s.on).toBe(false);
    await VexMinimalMode.leave();
    expect(late.s.on).toBe(true);
  });

  it('survives a restart: the module that switches itself on at start is told off again', async () => {
    const a = feature('a');
    VexUsage.register(a.spec);
    await VexMinimalMode.enter();
    load();                                              // restart
    const again = feature('a', { on: true });            // the module's own start turns it on
    VexUsage.register(again.spec);
    await tick();
    expect(again.spec.disable).toHaveBeenCalled();
    expect(VexMinimalMode.isOn()).toBe(true);
    await VexMinimalMode.leave();
    expect(again.s.on).toBe(true);
  });

  it('a feature that was not loaded when it was switched back is restored when it registers', async () => {
    VexUsage.register(feature('gone').spec);
    await VexMinimalMode.enter();
    VexUsage.unregister('gone');
    await VexMinimalMode.leave();
    const back = feature('gone', { on: false });
    VexUsage.register(back.spec);
    await tick();
    expect(back.spec.enable).toHaveBeenCalled();
  });

  it('turning it on twice does not lose the first record of what was on', async () => {
    const a = feature('a');
    VexUsage.register(a.spec);
    await VexMinimalMode.enter();
    await VexMinimalMode.enter();
    await VexMinimalMode.leave();
    expect(a.s.on).toBe(true);
  });

  it('an unreadable note raises, never silently reads as "off"', () => {
    localStorage.setItem('vex.minimalMode', '{bad');
    expect(() => VexMinimalMode.isOn()).toThrow(/not readable/);
  });

  it('the Settings section carries one switch that drives it', async () => {
    VexUsage.register(feature('a').spec);
    VexMinimalMode.group(document.body.appendChild(document.createElement('div')));
    const box = document.getElementById('setting-minimal-vex');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(VexMinimalMode.isOn()).toBe(true));
  });
});
