// @vitest-environment jsdom
//
// The profile switcher (js/profiles-ui.js): which profile a window says it is,
// the menu's actions reaching window.vex.profiles, and deleting only after a
// confirmation. The processes and folders themselves are src/main/profiles.js
// (tests/main/profiles.test.js) and were driven live.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const ProfilesUI = require('../../src/renderer/js/profiles-ui.js');

const one = { current: 'default', profiles: [{ id: 'default', name: 'Default', color: '#6366f1', icon: 'user', isDefault: true, current: true, running: true }] };
const two = {
  current: 'p-12345678',
  profiles: [
    { id: 'default', name: 'Default', color: '#6366f1', icon: 'user', isDefault: true, current: false, running: true },
    { id: 'p-12345678', name: 'Work <b>', color: '#f97316', icon: 'briefcase', isDefault: false, current: true, running: true },
    { id: 'p-87654321', name: 'School', color: '#0ea5e9', icon: 'graduation', isDefault: false, current: false, running: false },
  ],
};

let api;
beforeEach(() => {
  document.body.innerHTML = '<div id="top-bar-right"><button id="btn-profile"></button></div>';
  document.title = 'Vex';
  ProfilesUI.close();
  ProfilesUI._state = null;
  api = { list: vi.fn(async () => two), create: vi.fn(), update: vi.fn(async () => two), open: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => one), createShortcut: vi.fn(async () => ({ ok: true, file: 'C:\\D\\Vex (Work).lnk' })) };
  window.vex = { profiles: api };
  window.VexTabPolicy = { isPrivateWindow: false };
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
});

describe('which profile this window is', () => {
  it('stays "Vex" with only the default profile, and names the profile otherwise', () => {
    expect(ProfilesUI.titleFor(one)).toBe('Vex');
    expect(ProfilesUI.titleFor(two)).toBe('Vex — Work <b>');
  });
  it('puts the name in the title and a dot in the profile colour on the button', async () => {
    await ProfilesUI.init();
    expect(document.title).toBe('Vex — Work <b>');
    const btn = document.getElementById('btn-profile');
    expect(btn.title).toBe('Profile: Work <b>');
    expect(btn.querySelector('.profile-btn-dot').getAttribute('style')).toContain('#f97316');
    expect(btn.innerHTML).not.toContain('<b>');
    expect(document.body.dataset.vexProfile).toBe('p-12345678');
  });
  it('has no menu in a private window', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    await ProfilesUI.init();
    expect(document.getElementById('btn-profile').hidden).toBe(true);
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe('the menu', () => {
  it('lists every profile, escapes names, and offers delete only for another non-default profile', async () => {
    await ProfilesUI.init();
    await ProfilesUI.open();
    const menu = document.querySelector('.profile-menu');
    expect([...menu.querySelectorAll('.pm-name')].map(n => n.textContent)).toEqual(['Default', 'Work <b>', 'School']);
    expect([...menu.querySelectorAll('[data-act="delete"]')].map(b => b.dataset.id)).toEqual(['p-87654321']);
    expect(menu.querySelector('.pm-row.current .pm-state').textContent).toBe('This window');
  });
  it('opens another profile in its own window', async () => {
    await ProfilesUI.init();
    await ProfilesUI.open();
    document.querySelector('[data-act="open"][data-id="p-87654321"]').click();
    await Promise.resolve(); await Promise.resolve();
    expect(api.open).toHaveBeenCalledWith('p-87654321');
  });
  it('deletes only after the person confirms, and says why it could not', async () => {
    await ProfilesUI.init();
    await ProfilesUI.open();
    window.vexConfirm = vi.fn(async () => false);
    await ProfilesUI.act('delete', 'p-87654321');
    expect(api.remove).not.toHaveBeenCalled();
    window.vexConfirm = vi.fn(async () => true);
    api.remove.mockRejectedValueOnce(new Error("Error invoking remote method 'profiles:delete': Error: That profile is open. Close its window first, then delete it."));
    await ProfilesUI.act('delete', 'p-87654321');
    expect(window.showToast).toHaveBeenLastCalledWith('Could not delete the profile: That profile is open. Close its window first, then delete it.', 'error', 6000);
  });
  it('will not add a profile without a name', async () => {
    await ProfilesUI.init();
    await ProfilesUI.open();
    ProfilesUI.renderForm(null);
    document.querySelector('.pm-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();
    expect(api.create).not.toHaveBeenCalled();
    expect(document.querySelector('.pm-error').hidden).toBe(false);
  });
});
