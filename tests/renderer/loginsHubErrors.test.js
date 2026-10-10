// @vitest-environment jsdom
// The Logins & Codes hub showed "0 · None yet" when the vault or the
// authenticator could not be read (an empty catch), and said codes "will fill
// automatically" with the email-code master switch turned off.
import { describe, it, expect, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/logins-hub.js');

const tick = () => new Promise(r => setTimeout(r, 0));

async function openHub() {
  await window.LoginsHub.open();
  for (let i = 0; i < 5; i++) await tick();
  return document.getElementById('lh-body');
}

describe('Logins & Codes hub', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    globalThis.TabManager = { tabs: [{ id: 't1', url: 'https://mail.google.com/mail/u/0/' }], _isKeptAwake: () => true };
    globalThis.WebviewManager = { webviews: new Map([['t1', {}]]) };
  });

  it('says the vault and the authenticator could not be read, instead of "None yet"', async () => {
    window.vex = {
      vaultList: async () => { throw new Error("Error invoking remote method 'vault:list': Error: Vex is locked — unlock it to use saved passwords"); },
      totpList: async () => { throw new Error('Cannot read the authenticator'); },
    };
    const body = await openHub();
    const text = body.textContent;
    expect(text).toMatch(/Could not read saved passwords: Vex is locked — unlock it to use saved passwords/);
    expect(text).toMatch(/Could not read the authenticator: Cannot read the authenticator/);
    expect(text).not.toMatch(/None yet/);
    expect(text).not.toMatch(/Saved passwords\s*· 0/);
    expect(body.querySelectorAll('[role=alert]').length).toBe(2);
  });

  it('follows the email-code master switch, and can turn it back on', async () => {
    window.vex = { vaultList: async () => [], totpList: async () => [] };
    localStorage.setItem('vex.emailCodeAutofill', '0');
    let body = await openHub();
    expect(body.textContent).toMatch(/Automatic email-code fill is off/);
    expect(body.textContent).not.toMatch(/codes will fill automatically/);
    const box = body.querySelector('#lh-codes-on');
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    for (let i = 0; i < 5; i++) await tick();
    expect(localStorage.getItem('vex.emailCodeAutofill')).toBe('1');
    body = document.getElementById('lh-body');
    expect(body.textContent).toMatch(/codes will fill automatically/);
  });
});
