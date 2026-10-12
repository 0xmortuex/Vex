// @vitest-environment jsdom
// Settings › Passwords marks what Password Health found right in the list
// (reused, weak, not changed in a year) and says when each login was saved.
// The findings come from main; no password is involved.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
const { PasswordVault } = require('../../src/renderer/js/passwords.js');

let container;
const rowFor = (host) => [...container.querySelectorAll('#pw-rows > div')].find(r => r.textContent.includes(host));

beforeEach(() => {
  document.body.innerHTML = '<div id="c"></div>';
  container = document.getElementById('c');
  localStorage.clear();
  window.showToast = vi.fn();
  window.vex = {
    vaultList: vi.fn(async () => [
      { host: 'a.example', username: 'ann', updatedAt: '2024-03-05T10:00:00.000Z' },
      { host: 'b.example', username: 'bob', updatedAt: '2025-01-02T10:00:00.000Z' },
      { host: 'c.example', username: 'cy' },
    ]),
    vaultHealth: vi.fn(async () => ({
      total: 3,
      reused: [{ count: 2, entries: [{ host: 'a.example', username: 'ann' }, { host: 'b.example', username: 'bob' }] }],
      weak: [{ host: 'a.example', username: 'ann', reasons: ['too short'] }],
      old: [{ host: 'a.example', username: 'ann', days: 900 }],
    })),
  };
});

describe('Settings › Passwords marks', () => {
  it('marks reused, weak and old logins and leaves a clean one unmarked', async () => {
    await PasswordVault.renderPanel(container);
    const a = rowFor('a.example').querySelector('[data-flags]');
    expect(a.textContent).toBe('reused password · weak password · not changed in a year or more');
    expect(rowFor('b.example').querySelector('[data-flags]').textContent).toBe('reused password');
    expect(rowFor('c.example').querySelector('[data-flags]')).toBeNull();
  });

  it('says when a login was saved, and nothing when the date is unknown', async () => {
    await PasswordVault.renderPanel(container);
    expect(rowFor('a.example').textContent).toMatch(/saved .*2024/);
    expect(rowFor('c.example').textContent).not.toMatch(/saved/);
  });

  it('still lists everything when the health check fails', async () => {
    window.vex.vaultHealth = vi.fn(async () => { throw new Error('vault locked'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await PasswordVault.renderPanel(container);
    expect(container.querySelectorAll('#pw-rows > div')).toHaveLength(3);
    expect(container.querySelector('[data-flags]')).toBeNull();
    expect(err).toHaveBeenCalledWith('[Vault] could not mark weak or reused passwords:', 'vault locked');
  });
});
