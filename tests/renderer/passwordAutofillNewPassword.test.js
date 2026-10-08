// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://shop.example/join"}
// The saved-login filler, run for real in the page: it must leave a field that
// asks for a NEW password alone (sign-up / change-password forms).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordVault } from '../../src/renderer/js/passwords.js';

beforeEach(() => {
  localStorage.clear();
  window.VexTabPolicy = undefined;
  window.AutofillLog = { record: vi.fn() };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, bottom: 20, right: 200, width: 200, height: 20 });
  window.vex = { vaultGet: vi.fn(async () => [{ username: 'saved@user.test', password: 'saved-secret-value' }]) };
});

async function runAutofill() {
  const url = location.href;
  let ran = null;
  const webview = {
    _navigationGeneration: 1,
    getURL: () => url,
    // eslint-disable-next-line no-eval
    executeJavaScript: vi.fn(async (js) => { ran = (0, eval)(js); return ran; }),
  };
  await PasswordVault.autofill(webview, url);
  await Promise.resolve();
  return ran;
}

describe('saved-login autofill and new-password fields', () => {
  it('fills a login form', async () => {
    document.body.innerHTML = '<form><input type="email" id="u"><input type="password" id="p"></form>';
    await runAutofill();
    expect(document.getElementById('u').value).toBe('saved@user.test');
    expect(document.getElementById('p').value).toBe('saved-secret-value');
  });

  it('never puts the saved password into a sign-up form', async () => {
    document.body.innerHTML = '<form><input type="email" id="u"><input type="password" id="p1" autocomplete="new-password"><input type="password" id="p2" autocomplete="new-password"></form>';
    await runAutofill();
    expect(document.getElementById('p1').value).toBe('');
    expect(document.getElementById('p2').value).toBe('');
  });

  it('on a change-password form fills only the current password', async () => {
    document.body.innerHTML = '<form><input type="text" id="u" autocomplete="username"><input type="password" id="cur" autocomplete="current-password"><input type="password" id="n" autocomplete="new-password"></form>';
    await runAutofill();
    expect(document.getElementById('cur').value).toBe('saved-secret-value');
    expect(document.getElementById('n').value).toBe('');
  });
});
