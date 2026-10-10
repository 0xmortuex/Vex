// @vitest-environment jsdom
// The TOTP filler wired its click-to-fill listener once per page, closed over
// the code of that moment. Clicking an emptied 2FA field later re-filled that
// code, long after it expired (codes last 30 s), even after a newer code had
// been injected. Now a click asks Vex for the code of that moment.
import { describe, it, expect, beforeEach } from 'vitest';
import { TotpAutofill } from '../../src/renderer/js/totp-autofill.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

describe('TOTP click-to-fill', () => {
  beforeEach(() => { delete window.__vexTotpFocusWired; delete window.__vexTotpWant; delete window.VexTabPolicy; });

  it('fills the current code on a click into the emptied field, not the first one', async () => {
    Element.prototype.getBoundingClientRect = function () { return { width: 120, height: 30, top: 0, left: 0, right: 120, bottom: 30 }; };
    document.body.innerHTML = '<p>Enter the code from your authenticator app</p><input id="otp" autocomplete="one-time-code"><input id="other">';
    const url = location.href;
    let current = '333333';
    let asked = 0;
    window.vex = { totpCodes: async () => { asked++; return [{ id: 'a', code: current }]; } };
    const webview = { isConnected: true, getURL: () => location.href, executeJavaScript: (js) => Promise.resolve(window.eval(js)) };
    const account = { id: 'a', issuer: 'GitHub' };
    const otp = document.getElementById('otp');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

    TotpAutofill._inject(webview, '111111', url, account);
    await wait(10);
    expect(otp.value).toBe('111111');

    setter.call(otp, '');
    TotpAutofill._inject(webview, '222222', url, account);
    await wait(10);
    expect(otp.value).toBe('222222');

    // The user clears it and clicks into the field: Vex is asked once, for now.
    setter.call(otp, '');
    document.getElementById('other').focus();
    otp.focus();
    await wait(50);
    expect(asked).toBe(1);
    expect(otp.value).toBe('333333');

    // And again, later, with yet another code.
    current = '444444';
    setter.call(otp, '');
    document.getElementById('other').focus();
    otp.focus();
    await wait(50);
    expect(asked).toBe(2);
    expect(otp.value).toBe('444444');
  });

  it('a script-made focus event does not ask for a code', async () => {
    document.body.innerHTML = '<p>Enter the code from your authenticator app</p><input id="otp" autocomplete="one-time-code">';
    let asked = 0;
    window.vex = { totpCodes: async () => { asked++; return [{ id: 'a', code: '555555' }]; } };
    const webview = { isConnected: true, getURL: () => location.href, executeJavaScript: (js) => Promise.resolve(window.eval(js)) };
    TotpAutofill._inject(webview, '111111', location.href, { id: 'a' });
    await wait(10);
    const otp = document.getElementById('otp');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(otp, '');
    otp.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await wait(50);
    expect(asked).toBe(0);
    expect(otp.value).toBe('');
  });
});
