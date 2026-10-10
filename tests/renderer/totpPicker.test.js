// @vitest-environment jsdom
// Several authenticator accounts matching one site: a list to pick from (it
// was "type the account number" in a text box).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TotpAutofill } from '../../src/renderer/js/totp-autofill.js';

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

describe('TOTP account picker', () => {
  let webview, injected;
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.VexTabPolicy;
    window.vexPrompt = vi.fn();
    injected = [];
    webview = { isConnected: true, getURL: () => 'https://github.com/sessions/two-factor' };
    vi.spyOn(TotpAutofill, '_inject').mockImplementation((_wv, code) => injected.push(code));
    window.vex = { totpCodes: vi.fn(async () => [{ id: 'a', code: '111111' }, { id: 'b', code: '222222' }]) };
  });

  const matches = [
    { account: { id: 'a', issuer: 'GitHub', label: 'work@corp.example' }, kind: 'curated' },
    { account: { id: 'b', issuer: 'GitHub', label: 'me@home.example' }, kind: 'curated' },
  ];

  it('lists the accounts by name and fills the one picked', async () => {
    const done = TotpAutofill._fill(webview, webview.getURL(), 'github.com', matches);
    await tick();
    const picker = document.getElementById('vex-totp-pick');
    expect(picker.querySelector('[role=dialog]')).toBeTruthy();
    const buttons = [...picker.querySelectorAll('[data-list] button')];
    expect(buttons.map(b => b.textContent)).toEqual(['GitHub · work@corp.example', 'GitHub · me@home.example']);
    expect(document.activeElement).toBe(buttons[0]);
    buttons[1].click();
    await done;
    expect(injected).toEqual(['222222']);
    expect(window.vexPrompt).not.toHaveBeenCalled();
    expect(document.getElementById('vex-totp-pick')).toBeNull();
  });

  it('Escape or Not now fills nothing', async () => {
    let done = TotpAutofill._fill(webview, webview.getURL(), 'github.com', matches);
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await done;
    done = TotpAutofill._fill(webview, webview.getURL(), 'github.com', matches);
    await tick();
    document.querySelector('#vex-totp-pick [data-cancel]').click();
    await done;
    expect(injected).toEqual([]);
  });
});
