// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const P = require('../../src/renderer/js/profiles-ui');
let state, personal, api;
beforeEach(() => {
  document.body.innerHTML = '<button id="btn-profile"></button>';
  P._btn = document.getElementById('btn-profile'); P._state = null;
  state = { profiles: [{ id: 'default', name: 'Default', current: true, isDefault: true, color: '#6366f1', icon: 'user' }, { id: 'work', name: 'Work', current: false }] };
  personal = { name: 'Fadi', avatar: 'leaf' };
  window.VexMedals = { profile: () => personal, setProfile: p => Object.assign(personal, p), avatarSvg: (avatar, size) => `<svg data-avatar="${avatar}" width="${size}"></svg>` };
  api = { list: vi.fn(async () => state), update: vi.fn(async (id, patch) => { Object.assign(state.profiles.find(p => p.id === id), patch); return state; }) };
  window.vex = { profiles: api };
  window.VexProfile = { open: vi.fn(), close: vi.fn(), isOpen: () => false };
});
afterEach(() => { P.close(); delete window.VexMedals; delete window.VexProfile; });
describe('one profile entry point and identity', () => {
  it('opens the medals/profile hub from the toolbar path', async () => {
    await P.open(); expect(window.VexProfile.open).toHaveBeenCalledOnce();
    expect(document.querySelector('.profile-menu')).toBeNull();
  });
  it('adopts the existing personalized name instead of continuing to show Default', async () => {
    await P.refresh(); expect(state.profiles[0].name).toBe('Fadi');
    expect(P._btn.title).toBe('Profile: Fadi');
    expect(P._btn.querySelector('svg').dataset.avatar).toBe('leaf');
  });
  it('updates both records when renamed without touching another browser profile', async () => {
    await P.refresh(); await P.saveIdentity('Nova');
    expect(personal.name).toBe('Nova'); expect(state.profiles[0].name).toBe('Nova'); expect(state.profiles[1].name).toBe('Work');
    expect(api.update).toHaveBeenLastCalledWith('default', { name: 'Nova' });
  });
  it('keeps the prior identity if saving the browser name fails', async () => {
    await P.refresh(); api.update.mockRejectedValueOnce(new Error('disk full'));
    await expect(P.saveIdentity('Nova')).rejects.toThrow('disk full');
    expect(personal.name).toBe('Fadi');
  });
  it('uses an existing browser-profile name when no personal name was chosen', async () => {
    personal.name = ''; state.profiles[0].name = 'Gaming'; await P.refresh();
    expect(personal.name).toBe('Gaming'); expect(api.update).not.toHaveBeenCalled();
  });
});
