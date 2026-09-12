// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordVault } from '../../src/renderer/js/passwords.js';

// A fake <webview> that records ipc-message listeners so a test can replay what
// preload-webview.js actually sends on a login submit.
function fakeWebview(url) {
  const listeners = {};
  return {
    getURL: () => url,
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    emit: async (name, event) => { for (const fn of listeners[name] || []) await fn(event); },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (value) => String(value == null ? '' : value);
  window.showToast = vi.fn();
  window.VexTabPolicy = undefined;
  window.vex = { vaultGet: vi.fn(async () => []), vaultSave: vi.fn(async () => ({ ok: true })) };
});

describe('password vault host handling', () => {
  it('normalizes a host the same way everywhere', () => {
    expect(PasswordVault._host('www.Example.com')).toBe('example.com');
    expect(PasswordVault._host('example.com')).toBe('example.com');
    // Only the literal "www." label, never a host that merely starts with www.
    expect(PasswordVault._host('wwwx.example.com')).toBe('wwwx.example.com');
  });

  // The preload reports the page host with "www." already stripped. Comparing it
  // to the raw hostname meant the save offer never appeared on a www. site.
  it('offers to save a login submitted from a www. page', async () => {
    const webview = fakeWebview('https://www.example.com/login');
    PasswordVault.attach(webview);
    await webview.emit('ipc-message', { channel: 'vex-cred-submit', args: [{ host: 'example.com', username: 'a@b.test', password: 'hunter2' }] });
    expect(document.getElementById('vex-pw-offer')).not.toBeNull();
    expect(window.vex.vaultGet).toHaveBeenCalledWith('example.com');
  });

  it('saves under the canonical host so autofill can find it again', async () => {
    const webview = fakeWebview('https://www.example.com/login');
    PasswordVault.attach(webview);
    await webview.emit('ipc-message', { channel: 'vex-cred-submit', args: [{ host: 'example.com', username: 'a@b.test', password: 'hunter2' }] });
    document.querySelector('#vex-pw-offer [data-save]').click();
    await Promise.resolve(); await Promise.resolve();
    expect(window.vex.vaultSave).toHaveBeenCalledWith(expect.objectContaining({ host: 'example.com', username: 'a@b.test' }));
  });

  it('remembers the login email on a www. page', async () => {
    const webview = fakeWebview('https://www.example.com/login');
    PasswordVault.attach(webview);
    await webview.emit('ipc-message', { channel: 'vex-login-email', args: [{ host: 'example.com', email: 'a@b.test' }] });
    expect(PasswordVault._rememberedEmail('example.com')).toBe('a@b.test');
  });

  it('ignores a message whose host is not the page we are on', async () => {
    const webview = fakeWebview('https://www.example.com/login');
    PasswordVault.attach(webview);
    await webview.emit('ipc-message', { channel: 'vex-cred-submit', args: [{ host: 'evil.test', username: 'a@b.test', password: 'hunter2' }] });
    expect(document.getElementById('vex-pw-offer')).toBeNull();
  });

  it('ignores anything arriving over plain http', async () => {
    const webview = fakeWebview('http://www.example.com/login');
    PasswordVault.attach(webview);
    await webview.emit('ipc-message', { channel: 'vex-cred-submit', args: [{ host: 'example.com', username: 'a@b.test', password: 'hunter2' }] });
    expect(document.getElementById('vex-pw-offer')).toBeNull();
  });
});

describe('choosing between several saved logins', () => {
  const creds = [{ username: 'alice@b.test', password: 'x' }, { username: 'bob@b.test', password: 'y' }];

  it('does not ask on a page with no login form', async () => {
    const webview = { _navigationGeneration: 1, getURL: () => 'https://example.com/articles', executeJavaScript: vi.fn(async () => false) };
    window.vex.vaultGet = vi.fn(async () => creds);
    await PasswordVault.autofill(webview, 'https://example.com/articles');
    expect(document.getElementById('vex-pw-pick')).toBeNull();
  });

  it('asks with a real list once a login form is on screen', async () => {
    const webview = { _navigationGeneration: 1, getURL: () => 'https://example.com/login', executeJavaScript: vi.fn(async () => true) };
    window.vex.vaultGet = vi.fn(async () => creds);
    const pending = PasswordVault.autofill(webview, 'https://example.com/login');
    await vi.waitFor(() => expect(document.getElementById('vex-pw-pick')).not.toBeNull());
    const options = [...document.querySelectorAll('#pwpick-list button')].map(b => b.textContent);
    expect(options).toEqual(['alice@b.test', 'bob@b.test']);
    document.querySelectorAll('#pwpick-list button')[1].click();
    await pending;
    // The injected filler carries the chosen account, and only that one.
    const injected = webview.executeJavaScript.mock.calls.at(-1)[0];
    expect(injected).toContain('bob@b.test');
    expect(injected).not.toContain('alice@b.test');
  });

  it('fills nothing when the picker is dismissed', async () => {
    const webview = { _navigationGeneration: 1, getURL: () => 'https://example.com/login', executeJavaScript: vi.fn(async () => true) };
    window.vex.vaultGet = vi.fn(async () => creds);
    const pending = PasswordVault.autofill(webview, 'https://example.com/login');
    await vi.waitFor(() => expect(document.getElementById('vex-pw-pick')).not.toBeNull());
    const callsBefore = webview.executeJavaScript.mock.calls.length;
    document.getElementById('pwpick-cancel').click();
    await pending;
    expect(webview.executeJavaScript.mock.calls.length).toBe(callsBefore);
  });
});
