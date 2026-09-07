// @vitest-environment jsdom
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PasswordVault } from '../../src/renderer/js/passwords.js';
import { TotpAutofill } from '../../src/renderer/js/totp-autofill.js';
import { EmailCodeAutofill } from '../../src/renderer/js/email-code-autofill.js';
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); delete window.VexTabPolicy; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function page(html, href = 'https://github.com/login') {
  document.body.innerHTML = html;
  const location = { href, origin: new URL(href).origin };
  for (const input of document.querySelectorAll('input')) input.getBoundingClientRect = () => ({ width: 100, height: 20 });
  return { location, webview: { getURL: () => location.href, executeJavaScript: vi.fn(async script => vm.runInNewContext(script, { document, window, location, URL, Event, getComputedStyle, setInterval, clearInterval, setTimeout, clearTimeout })) } };
}
it('rejects lookalike mail providers and private email readers', () => {
  const gmail = EmailCodeAutofill._PROVIDERS[0];
  expect(EmailCodeAutofill._matchesProvider(gmail, 'https://mail.google.com.evil.test/')).toBe(false);
  expect(EmailCodeAutofill._matchesProvider(gmail, 'https://mail.google.com/mail/u/0')).toBe(true);
  window.VexTabPolicy = { isPrivateWindow: true };
  expect(EmailCodeAutofill._findMailWebview()).toBeNull();
  expect(EmailCodeAutofill._ensureHiddenGmail()).toBeNull();
});
it('does not erase newer clipboard content when a copied password expires', async () => {
  let clipboard = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: vi.fn(async value => { clipboard = value; }), readText: async () => clipboard,
  } });
  await PasswordVault._copyPassword('secret');
  clipboard = 'Newly copied text';
  await vi.advanceTimersByTimeAsync(30000);
  expect(clipboard).toBe('Newly copied text');
  await PasswordVault._copyPassword('secret');
  await vi.advanceTimersByTimeAsync(30000);
  expect(clipboard).toBe('');
});
it('email codes ignore hidden or cross-origin forms and stale pages', async () => {
  const { webview, location } = page('<form action="https://evil.test"><input autocomplete="one-time-code"></form><input style="visibility:hidden" autocomplete="one-time-code"><input id="safe" autocomplete="one-time-code">');
  await EmailCodeAutofill._injectCode(webview, '123456', location.href);
  expect([...document.querySelectorAll('input')].map(x => x.value)).toEqual(['', '', '123456']);
  document.querySelector('#safe').value = '';
  await EmailCodeAutofill._injectCode(webview, '654321', 'https://github.com/previous');
  expect(document.querySelector('#safe').value).toBe('');
});
it('does not autofill TOTP on a hostname that merely resembles the issuer', async () => {
  window.vex = { totpList: async () => [{ id: 'a', issuer: 'GitHub' }], totpCodes: vi.fn() };
  const { webview } = page('<input autocomplete="one-time-code">', 'https://github.evil/login');
  await TotpAutofill.autofill(webview, webview.getURL());
  expect(window.vex.totpCodes).not.toHaveBeenCalled(); expect(webview.executeJavaScript).not.toHaveBeenCalled();
});
it('rejects TOTP after a navigation while reading codes', async () => {
  const { location, webview } = page('<input autocomplete="one-time-code">');
  window.vex = { totpList: async () => [{ id: 'a', issuer: 'GitHub' }], totpCodes: async () => { location.href = 'https://evil.test'; return [{ id: 'a', code: '123456' }]; } };
  await TotpAutofill.autofill(webview, 'https://github.com/login');
  expect(webview.executeJavaScript).not.toHaveBeenCalled();
});
it('fills only visible same-origin forms and stops TOTP retries after SPA navigation', async () => {
  const { location, webview } = page('<form action="https://evil.test"><input autocomplete="one-time-code"></form><input style="visibility:hidden" autocomplete="one-time-code"><input id="safe" autocomplete="one-time-code"><iframe></iframe>');
  TotpAutofill._inject(webview, '123456', location.href);
  expect([...document.querySelectorAll('input')].map(x => x.value)).toEqual(['', '', '123456']);
  document.querySelector('#safe').value = ''; location.href = 'https://github.com/other';
  await vi.advanceTimersByTimeAsync(4000);
  expect(document.querySelector('#safe').value).toBe('');
});
it('password filling ignores hidden fields and changed form actions', async () => {
  window.vex = { vaultGet: async () => [{ username: 'alice', password: 'secret' }] };
  const { webview } = page('<form action="https://evil.test"><input type="email"><input type="password"></form><input type="password" style="visibility:hidden">');
  await PasswordVault.autofill(webview, webview.getURL());
  expect([...document.querySelectorAll('input')].every(x => x.value === '')).toBe(true);
});
