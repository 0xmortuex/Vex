// @vitest-environment jsdom
// Passkeys and security keys are refused on every site by default (so Windows'
// dialog never covers a password sign-in). A site that really signs in with a
// passkey then failed silently. Now the refusal is told to Vex, which shows a
// bar: "This site asked for a passkey or security key — Allow here", which
// adds the site to the allowed list and reloads it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_TWEAKS } from '../../src/site-tweaks.js';
import { PasswordVault } from '../../src/renderer/js/passwords.js';

const tweak = SITE_TWEAKS.find(t => t.name === 'disable-webauthn-passkey-prompt');

describe('page side', () => {
  beforeEach(() => {
    // A stand-in for the real API, then the tweak wraps it.
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: vi.fn(async () => 'real') } });
    window.eval(tweak.code);
  });

  it('refuses a passkey request and says so; the silent autofill probe and password requests are not reported', async () => {
    const heard = vi.fn();
    document.addEventListener('vex-passkey-refused', heard);
    await expect(navigator.credentials.get({ publicKey: {}, mediation: 'conditional' })).rejects.toThrow(/disabled in Vex/);
    expect(heard).not.toHaveBeenCalled();
    await expect(navigator.credentials.get({ password: true })).resolves.toBe('real');
    expect(heard).not.toHaveBeenCalled();
    await expect(navigator.credentials.get({ publicKey: { challenge: new Uint8Array(1) } })).rejects.toThrow(/disabled in Vex/);
    expect(heard).toHaveBeenCalledTimes(1);
    document.removeEventListener('vex-passkey-refused', heard);
  });

  it('names the event the preload passes on', () => {
    expect(tweak.notifies).toBe('vex-passkey-refused');
  });
});

describe('host side', () => {
  function fakeWebview(url) {
    const listeners = {};
    return {
      reload: vi.fn(),
      getURL: () => url,
      addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
      emit: async (name, event) => { for (const fn of listeners[name] || []) await fn(event); },
    };
  }
  const say = (wv, channel, payload) => wv.emit('ipc-message', { channel, args: [payload] });

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/</g, '&lt;');
    window.showToast = vi.fn();
    window.PersistentStorage = { _flush: vi.fn(async () => {}) };
    delete window.VexTabPolicy;
  });

  it('shows the bar once; Allow here adds the site, saves it, and reloads', async () => {
    const wv = fakeWebview('https://login.example.com/signin');
    PasswordVault.attach(wv);
    await say(wv, 'vex-passkey-refused', { host: 'login.example.com' });
    const card = document.getElementById('vex-passkey-offer');
    expect(card.textContent).toMatch(/This site asked for a passkey or security key/);
    expect(card.textContent).toMatch(/login\.example\.com/);
    card.remove();
    await say(wv, 'vex-passkey-refused', { host: 'login.example.com' });
    expect(document.getElementById('vex-passkey-offer')).toBeNull();   // once per site per tab

    const wv2 = fakeWebview('https://login.example.com/signin');
    PasswordVault.attach(wv2);
    await say(wv2, 'vex-passkey-refused', { host: 'login.example.com' });
    document.querySelector('#vex-passkey-offer [data-allow]').click();
    await vi.waitFor(() => expect(wv2.reload).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem('vex.passkeyAllowedHosts'))).toEqual(['login.example.com']);
    expect(window.PersistentStorage._flush).toHaveBeenCalled();

    // Allowed: never offered again.
    const wv3 = fakeWebview('https://login.example.com/signin');
    PasswordVault.attach(wv3);
    await say(wv3, 'vex-passkey-refused', { host: 'login.example.com' });
    expect(document.getElementById('vex-passkey-offer')).toBeNull();
  });

  it('Settings lists allowed sites and Remove takes one off', async () => {
    localStorage.setItem('vex.passkeyAllowedHosts', JSON.stringify(['a.example', 'b.example']));
    const box = document.createElement('div');
    document.body.appendChild(box);
    PasswordVault.renderPasskeyAllowed(box);
    expect(box.textContent).toMatch(/Passkeys allowed on:a\.exampleRemoveb\.exampleRemove/);
    box.querySelector('button').click();
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('vex.passkeyAllowedHosts'))).toEqual(['b.example']));
  });

  it('ignores a malformed host', async () => {
    const wv = fakeWebview('https://login.example.com/');
    PasswordVault.attach(wv);
    await say(wv, 'vex-passkey-refused', { host: '<img src=x>' });
    expect(document.getElementById('vex-passkey-offer')).toBeNull();
  });
});
