// @vitest-environment jsdom
//
// js/threat-list-ui.js: the Settings section for the dangerous-site list. It starts itself when it loads late, shows the
// list's date and size, turns the check on and off, updates by hand, and opens the test warning in a new tab.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const STATUS = { enabled: true, autoUpdate: true, count: 386533, bytes: 3092264, fetchedAt: 1_800_000_000_000, sources: [{ id: 'a', name: 'Phishing.Database', licence: 'MIT', count: 386533 }], available: [], updating: false, lastError: '', allow: ['trusted.example.com'], testHost: 'vex-safety-test.invalid' };

let api, groups, cmds;
beforeEach(() => {
  document.body.innerHTML = '';
  api = {
    status: vi.fn(async () => ({ ...STATUS })), setEnabled: vi.fn(async (on) => ({ ...STATUS, enabled: on })), setAutoUpdate: vi.fn(async (on) => ({ ...STATUS, autoUpdate: on })),
    update: vi.fn(async () => ({ ...STATUS })), forgetHost: vi.fn(async () => ({ ...STATUS, allow: [] })), continueLog: vi.fn(async () => []),
  };
  window.vex = { threat: api };
  window.showToast = vi.fn();
  groups = { register: vi.fn() };
  cmds = { set: vi.fn() };
  globalThis.VexSettingsGroups = groups; window.VexSettingsGroups = groups;
  window.VexModuleCommands = cmds;
  window.ProtectSettings = fresh('../../src/renderer/js/protect-settings.js').ProtectSettings || globalThis.ProtectSettings;
  globalThis.TabManager = { createTab: vi.fn() };
});

describe('VexThreatListUI', () => {
  it('registers its section and two commands when it loads, once', () => {
    const { VexThreatListUI } = fresh('../../src/renderer/js/threat-list-ui.js');
    expect(groups.register).toHaveBeenCalledTimes(1);
    expect(groups.register.mock.calls[0][0]).toMatchObject({ id: 'threat-list', title: 'Privacy & security: dangerous sites' });
    VexThreatListUI.init();
    expect(groups.register).toHaveBeenCalledTimes(1);
    const list = cmds.set.mock.calls[0][1];
    expect(list.map(c => c.id)).toEqual(['threat:settings', 'threat:test']);
  });

  it('shows the count, the date and the size, and the trusted sites', async () => {
    const { VexThreatListUI } = fresh('../../src/renderer/js/threat-list-ui.js');
    const body = document.createElement('div');
    VexThreatListUI.render(body);
    await vi.waitFor(() => expect(body.textContent).toContain('386,533'));
    expect(body.textContent).toContain('2.9 MB');
    expect(body.textContent).toContain('trusted.example.com');
    expect(body.textContent).toContain('licence: MIT');
  });

  it('the switch and Update now call main, and a failed update says why', async () => {
    const { VexThreatListUI } = fresh('../../src/renderer/js/threat-list-ui.js');
    const body = document.createElement('div');
    VexThreatListUI.render(body);
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
    const boxes = body.querySelectorAll('input[type=checkbox]');
    boxes[0].checked = false; boxes[0].dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(false));
    const update = [...body.querySelectorAll('button')].find(b => b.textContent.includes('Update now'));
    api.update.mockRejectedValueOnce(new Error('offline'));
    api.status.mockResolvedValue({ ...STATUS, lastError: 'offline' });   // main keeps the reason
    update.click();
    await vi.waitFor(() => expect(body.textContent).toContain('offline'));
    expect(window.showToast).toHaveBeenCalledWith('offline', 'error');
  });

  it('the test opens the address main always recognises, in a new tab', async () => {
    const { VexThreatListUI } = fresh('../../src/renderer/js/threat-list-ui.js');
    await VexThreatListUI.openTest();
    expect(globalThis.TabManager.createTab).toHaveBeenCalledWith('https://vex-safety-test.invalid/', true);
  });

  it('raises an error instead of staying quiet when main has no such API', () => {
    window.vex = {};
    const { VexThreatListUI } = fresh('../../src/renderer/js/threat-list-ui.js');
    expect(() => VexThreatListUI.render(document.createElement('div'))).toThrow(/not available/);
  });
});
