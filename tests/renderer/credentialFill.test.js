// @vitest-environment jsdom
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PasswordVault } from '../../src/renderer/js/passwords.js';
import { TotpAutofill } from '../../src/renderer/js/totp-autofill.js';
import { EmailCodeAutofill } from '../../src/renderer/js/email-code-autofill.js';
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear();
  delete window.VexTabPolicy; delete window.vexConfirm; delete window.vexPrompt;
  // The injected scripts wire their focus handler once per document. jsdom shares
  // one window across tests, so without clearing these a later test would reuse
  // the previous test's handler (closed over its URL) instead of its own.
  delete window.__vexPwFocusWired; delete window.__vexTotpFocusWired; delete window.__vexEmailFocusWired;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function page(html, href = 'https://github.com/login') {
  document.body.innerHTML = html;
  // origin tracks href, the way a real Location does. The injected scripts gate
  // on origin, so a frozen origin would make same-origin drift untestable.
  const location = { href, get origin() { return new URL(this.href).origin; } };
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
it('email codes ignore hidden and cross-origin forms', async () => {
  const { webview, location } = page('<form action="https://evil.test"><input autocomplete="one-time-code"></form><input style="visibility:hidden" autocomplete="one-time-code"><input id="safe" autocomplete="one-time-code">');
  await EmailCodeAutofill._injectCode(webview, '123456', location.href);
  expect([...document.querySelectorAll('input')].map(x => x.value)).toEqual(['', '', '123456']);
});
it('email codes refuse a page that has moved to another origin', async () => {
  const { webview, location } = page('<input id="safe" autocomplete="one-time-code">');
  location.href = 'https://evil.test/login';
  await EmailCodeAutofill._injectCode(webview, '654321', 'https://github.com/login');
  expect(document.querySelector('#safe').value).toBe('');
});
it('email codes still fill after a same-origin step change', async () => {
  // Multi-step logins push a new URL between the email and code steps. Gating on
  // the full href meant the code step silently never filled.
  const { webview, location } = page('<input id="safe" autocomplete="one-time-code">');
  location.href = 'https://github.com/login?step=code&ctx=regenerated';
  await EmailCodeAutofill._injectCode(webview, '654321', 'https://github.com/login?ctx=original');
  expect(document.querySelector('#safe').value).toBe('654321');
});
it('does not autofill TOTP on a hostname that merely resembles the issuer', async () => {
  window.vex = { totpList: async () => [{ id: 'a', issuer: 'GitHub' }], totpCodes: vi.fn() };
  window.vexConfirm = vi.fn(async () => true);   // even if the user would say yes
  const { webview } = page('<input autocomplete="one-time-code">', 'https://github.com.evil.test/login');
  await TotpAutofill.autofill(webview, webview.getURL());
  expect(window.vexConfirm).not.toHaveBeenCalled();
  expect(window.vex.totpCodes).not.toHaveBeenCalled();
  expect(webview.executeJavaScript).not.toHaveBeenCalled();
});
it('rejects TOTP after a navigation while reading codes', async () => {
  const { location, webview } = page('<input autocomplete="one-time-code">');
  window.vex = { totpList: async () => [{ id: 'a', issuer: 'GitHub' }], totpCodes: async () => { location.href = 'https://evil.test'; return [{ id: 'a', code: '123456' }]; } };
  await TotpAutofill.autofill(webview, 'https://github.com/login');
  expect(webview.executeJavaScript).not.toHaveBeenCalled();
});
it('fills only visible same-origin forms and stops TOTP retries after leaving the origin', async () => {
  const { location, webview } = page('<form action="https://evil.test"><input autocomplete="one-time-code"></form><input style="visibility:hidden" autocomplete="one-time-code"><input id="safe" autocomplete="one-time-code"><iframe></iframe>');
  TotpAutofill._inject(webview, '123456', location.href);
  expect([...document.querySelectorAll('input')].map(x => x.value)).toEqual(['', '', '123456']);
  document.querySelector('#safe').value = ''; location.href = 'https://evil.test/other';
  await vi.advanceTimersByTimeAsync(4000);
  expect(document.querySelector('#safe').value).toBe('');
});
it('keeps retrying TOTP across a same-origin step change', async () => {
  // The 2FA field usually renders a beat after load, and the step change rewrites
  // the URL. Gating the retry on the full href meant it never got filled.
  const { location, webview } = page('<div id="host"></div>');
  TotpAutofill._inject(webview, '123456', location.href);
  location.href = 'https://github.com/login?step=2fa&ctx=regenerated';
  const field = document.createElement('input');
  field.setAttribute('autocomplete', 'one-time-code');
  field.getBoundingClientRect = () => ({ width: 100, height: 20 });
  document.body.append(field);
  await vi.advanceTimersByTimeAsync(1200);
  expect(field.value).toBe('123456');
});
it('password filling ignores hidden fields and changed form actions', async () => {
  window.vex = { vaultGet: async () => [{ username: 'alice', password: 'secret' }] };
  const { webview } = page('<form action="https://evil.test"><input type="email"><input type="password"></form><input type="password" style="visibility:hidden">');
  await PasswordVault.autofill(webview, webview.getURL());
  expect([...document.querySelectorAll('input')].every(x => x.value === '')).toBe(true);
});
it('password click-to-fill survives a rewritten query string', async () => {
  // Spotify rewrites flow_ctx between the email and password steps. Gating the
  // fill on the full href made every step after the first silently no-op.
  window.vex = { vaultGet: async () => [{ username: 'alice', password: 'secret' }] };
  const { webview, location } = page('<input type="email"><input type="password">', 'https://accounts.spotify.com/login?flow_ctx=first');
  await PasswordVault.autofill(webview, location.href);
  expect(document.querySelector('input[type=password]').value).toBe('secret');
  document.querySelector('input[type=email]').value = '';
  document.querySelector('input[type=password]').value = '';
  location.href = 'https://accounts.spotify.com/login?flow_ctx=regenerated';
  document.querySelector('input[type=password]').dispatchEvent(new Event('focusin', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(10);
  expect(document.querySelector('input[type=password]').value).toBe('secret');
});
it('password fill stops once the page has left the origin', async () => {
  window.vex = { vaultGet: async () => [{ username: 'alice', password: 'secret' }] };
  const { webview, location } = page('<input type="email"><input type="password">', 'https://accounts.spotify.com/login');
  await PasswordVault.autofill(webview, location.href);
  document.querySelector('input[type=password]').value = '';
  location.href = 'https://evil.test/login';
  document.querySelector('input[type=password]').dispatchEvent(new Event('focusin', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(10);
  expect(document.querySelector('input[type=password]').value).toBe('');
});
it('fills a TOTP for a site the curated map never listed, once confirmed', async () => {
  // Roblox is not one of the eight curated brands, so the allowlist could never
  // match it and 2FA autofill was dead for every site outside that list.
  window.vex = { totpList: async () => [{ id: 'r', issuer: 'Roblox', label: 'Roblox: me' }], totpCodes: async () => [{ id: 'r', code: '246813' }] };
  window.vexConfirm = vi.fn(async () => true);
  const { webview } = page('<input autocomplete="one-time-code">', 'https://www.roblox.com/login');
  await TotpAutofill.autofill(webview, webview.getURL());
  expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  expect(document.querySelector('input').value).toBe('246813');
});
it('remembers the confirmation so it only asks once', async () => {
  window.vex = { totpList: async () => [{ id: 'r', issuer: 'Roblox', label: 'Roblox: me' }], totpCodes: async () => [{ id: 'r', code: '246813' }] };
  window.vexConfirm = vi.fn(async () => true);
  const first = page('<input autocomplete="one-time-code">', 'https://www.roblox.com/login');
  await TotpAutofill.autofill(first.webview, first.webview.getURL());
  const second = page('<input autocomplete="one-time-code">', 'https://www.roblox.com/login');
  await TotpAutofill.autofill(second.webview, second.webview.getURL());
  expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  expect(document.querySelector('input').value).toBe('246813');
});
it('remembers a refusal and never fills or re-asks', async () => {
  window.vex = { totpList: async () => [{ id: 'r', issuer: 'Roblox' }], totpCodes: async () => [{ id: 'r', code: '246813' }] };
  window.vexConfirm = vi.fn(async () => false);
  const first = page('<input autocomplete="one-time-code">', 'https://www.roblox.com/login');
  await TotpAutofill.autofill(first.webview, first.webview.getURL());
  expect(document.querySelector('input').value).toBe('');
  const second = page('<input autocomplete="one-time-code">', 'https://www.roblox.com/login');
  await TotpAutofill.autofill(second.webview, second.webview.getURL());
  expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  expect(document.querySelector('input').value).toBe('');
});
it('does not prompt about a site that is not showing a 2FA field', async () => {
  // Otherwise every ordinary visit to roblox.com would pop a dialog.
  window.vex = { totpList: async () => [{ id: 'r', issuer: 'Roblox' }], totpCodes: vi.fn() };
  window.vexConfirm = vi.fn(async () => true);
  const { webview } = page('<input type="search" placeholder="Search Roblox"><input type="text" name="promo">', 'https://www.roblox.com/home');
  await TotpAutofill.autofill(webview, webview.getURL());
  expect(window.vexConfirm).not.toHaveBeenCalled();
  expect(window.vex.totpCodes).not.toHaveBeenCalled();
});
it('resolves the registrable label without being fooled by subdomains', () => {
  expect(TotpAutofill._label('roblox.com')).toBe('roblox');
  expect(TotpAutofill._label('accounts.roblox.com')).toBe('roblox');
  expect(TotpAutofill._label('github.com.evil.com')).toBe('evil');
  expect(TotpAutofill._label('example.co.uk')).toBe('example');
});
it('still fills a curated brand whose issuer is not its domain, with no prompt', async () => {
  window.vex = { totpList: async () => [{ id: 'm', issuer: 'Microsoft' }], totpCodes: async () => [{ id: 'm', code: '135790' }] };
  window.vexConfirm = vi.fn(async () => true);
  const { webview } = page('<input autocomplete="one-time-code">', 'https://login.live.com/oauth');
  await TotpAutofill.autofill(webview, webview.getURL());
  expect(window.vexConfirm).not.toHaveBeenCalled();
  expect(document.querySelector('input').value).toBe('135790');
});
