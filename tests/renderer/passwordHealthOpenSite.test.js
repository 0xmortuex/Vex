// @vitest-environment jsdom
// Password Health findings are actionable: each row has a button that opens
// that site in a new tab so the password can be changed there.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
const { PasswordHealth } = require('../../src/renderer/js/password-health.js');

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  PasswordHealth._breach = null;
  globalThis.TabManager = { createTab: vi.fn() };
  window.showToast = vi.fn();
  window.vex = {
    vaultHealth: vi.fn(async () => ({
      total: 3,
      reused: [{ count: 2, entries: [{ host: 'a.example', username: 'me' }, { host: 'b.example', username: 'me' }] }],
      weak: [{ host: 'c.example', username: 'me', reasons: ['too short'] }],
      old: [{ host: 'd.example', username: 'me', days: 800 }],
    })),
    vaultList: vi.fn(async () => [{ host: 'a.example', username: 'me' }, { host: 'c.example', username: 'me' }]),
    totpList: vi.fn(async () => []),
  };
});

describe('Password Health › open the site', () => {
  it('every finding has a button, and it opens that site and closes the report', async () => {
    await PasswordHealth.open();
    await tick();
    const hosts = [...document.querySelectorAll('[data-open-host]')].map(b => b.getAttribute('data-open-host'));
    expect(hosts).toEqual(expect.arrayContaining(['a.example', 'c.example', 'd.example']));
    document.querySelector('[data-open-host="c.example"]').click();
    expect(globalThis.TabManager.createTab).toHaveBeenCalledWith('https://c.example/', true);
    expect(document.getElementById('vex-pwhealth')).toBeNull();
  });
});
