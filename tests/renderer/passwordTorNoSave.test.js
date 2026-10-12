// @vitest-environment jsdom
//
// A page in a private window, an off-the-record or Tor tab never adds to the
// saved passwords (js/tab-policy.js canReadWebview: its partition is not
// persist:). A site routed through Tor by a site rule is in persist:route-tor,
// which passed that check, so Vex offered to save a login typed there into
// the vault every other tab fills from, and (with Passwords on in Vex Sync)
// sent it to every device (found 2026-10-11). Sign-in popups already refuse
// it (main/vault.js _autofillPopup).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordVault } from '../../src/renderer/js/passwords.js';

function fakeWebview(url, partition) {
  const listeners = {};
  return {
    getURL: () => url,
    getAttribute: (name) => (name === 'partition' ? partition : null),
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    emit: async (name, event) => { for (const fn of listeners[name] || []) await fn(event); },
  };
}
const submit = { channel: 'vex-cred-submit', args: [{ host: 'example.com', username: 'a@b.test', password: 'hunter2' }] };

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (value) => String(value == null ? '' : value);
  window.showToast = vi.fn();
  window.VexDataContracts = { url: () => true };
  require('../../src/renderer/js/tab-policy.js');
  window.vex = { vaultGet: vi.fn(async () => []), vaultSave: vi.fn(async () => ({ ok: true })) };
});

describe('no password is saved from a Tor or private page', () => {
  it('offers to save in a normal tab', async () => {
    const webview = fakeWebview('https://example.com/login', 'persist:main');
    PasswordVault.attach(webview);
    await webview.emit('ipc-message', submit);
    expect(document.getElementById('vex-pw-offer')).not.toBeNull();
  });

  it('never offers in a Tor tab or an off-the-record tab', async () => {
    for (const partition of ['tor-123', 'otr-1']) {
      const webview = fakeWebview('https://example.com/login', partition);
      PasswordVault.attach(webview);
      await webview.emit('ipc-message', submit);
      expect(document.getElementById('vex-pw-offer')).toBeNull();
    }
  });

  it('never offers on a site routed through Tor, nor saves a suggested password there', async () => {
    const webview = fakeWebview('https://example.com/login', 'persist:route-tor');
    webview._vexPwSuggestion = { accepted: true, host: 'example.com', password: 'hunter2' };
    PasswordVault.attach(webview);
    await webview.emit('ipc-message', submit);
    expect(document.getElementById('vex-pw-offer')).toBeNull();
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
  });
});
