// @vitest-environment jsdom
// Settings › Passwords: a password that was shown hides itself, and a login's
// username can be copied on its own.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
const { PasswordVault } = require('../../src/renderer/js/passwords.js');

let container;
const row = () => container.querySelector('#pw-rows > div');
const tick = async (n = 5) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="c"></div>';
  container = document.getElementById('c');
  localStorage.clear();
  PasswordVault._recheckedUntil = 0;
  window.showToast = vi.fn();
  window.VexLock = { hasPin: () => false, recheck: vi.fn(async () => true) };
  window.vex = {
    vaultList: vi.fn(async () => [{ host: 'github.com', username: 'octo' }]),
    vaultGet: vi.fn(async () => [{ host: 'github.com', username: 'octo', password: 'gh-secret-pass' }]),
    vaultHealth: vi.fn(async () => ({ total: 1, reused: [], weak: [], old: [] })),
  };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
});
afterEach(() => { vi.useRealTimers(); });

describe('Settings › Passwords', () => {
  it('hides a shown password again after a while', async () => {
    await PasswordVault.renderPanel(container);
    const shown = row().querySelector('[data-shown]');
    row().querySelector('[data-reveal]').click();
    await tick(10);
    expect(shown.textContent).toBe('gh-secret-pass');
    vi.advanceTimersByTime(PasswordVault.REVEAL_MS - 1000);
    expect(shown.textContent).toBe('gh-secret-pass');
    vi.advanceTimersByTime(2000);
    expect(shown.textContent).toBe('');
    expect(shown.style.display).toBe('none');
    expect(row().querySelector('[data-reveal]').getAttribute('aria-pressed')).toBe('false');
  });

  it('copies just the username, with no password involved', async () => {
    await PasswordVault.renderPanel(container);
    row().querySelector('[data-copyuser]').click();
    await tick();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('octo');
    expect(window.vex.vaultGet).not.toHaveBeenCalled();
  });
});
