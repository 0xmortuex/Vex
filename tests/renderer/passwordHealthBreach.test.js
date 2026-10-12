// @vitest-environment jsdom
// Password Health's breach check: off by default (nothing is asked of main),
// turned on with a switch that says exactly what is sent, then run on demand.
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
  window.PersistentStorage = { _flush: vi.fn(async () => {}) };
  window.vex = {
    vaultHealth: vi.fn(async () => ({ total: 2, reused: [], weak: [] })),
    vaultList: vi.fn(async () => [{ host: 'a.example', username: 'me' }, { host: 'b.example', username: 'you' }]),
    totpList: vi.fn(async () => []),
    vaultBreachCheck: vi.fn(async () => ({ checked: 2, breached: [{ host: 'a.example', username: 'me', count: 9659365 }] })),
  };
});

describe('Password Health breach check', () => {
  it('is off by default and never runs; the switch says only a hash prefix is sent', async () => {
    await PasswordHealth.open();
    await tick();
    const body = document.getElementById('pwh-body');
    const toggle = body.querySelector('#pwh-breach-on');
    expect(toggle.checked).toBe(false);
    expect(body.textContent).toMatch(/first 5 characters of each password's SHA-1 hash to Have I Been Pwned/);
    expect(body.textContent).toMatch(/Nothing here leaves your machine/);
    expect(body.querySelector('#pwh-breach-run')).toBeNull();
    expect(window.vex.vaultBreachCheck).not.toHaveBeenCalled();
  });

  it('turned on, saves the switch before anything can run, then shows what was found', async () => {
    await PasswordHealth.open();
    await tick();
    const toggle = document.querySelector('#pwh-breach-on');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await tick();
    expect(localStorage.getItem('vex.breachCheck')).toBe('true');
    expect(window.PersistentStorage._flush).toHaveBeenCalled();
    expect(window.vex.vaultBreachCheck).not.toHaveBeenCalled();
    document.querySelector('#pwh-breach-run').click();
    await tick();
    const body = document.getElementById('pwh-body').textContent;
    expect(body).toMatch(/a\.example · me/);
    expect(body).toMatch(/seen 9,659,365×/);
    expect(body).toMatch(/Change each one on its site/);
  });

  it('says when the check failed', async () => {
    localStorage.setItem('vex.breachCheck', 'true');
    window.vex.vaultBreachCheck = vi.fn(async () => { throw new Error("Error invoking remote method 'vault:breach-check': Error: Have I Been Pwned answered 503"); });
    await PasswordHealth.open();
    await tick();
    document.querySelector('#pwh-breach-run').click();
    await tick();
    expect(document.getElementById('pwh-body').textContent).toMatch(/The breach check failed: Have I Been Pwned answered 503/);
  });

  it('turning it off forgets the result', async () => {
    localStorage.setItem('vex.breachCheck', 'true');
    await PasswordHealth.open();
    await tick();
    document.querySelector('#pwh-breach-run').click();
    await tick();
    const toggle = document.querySelector('#pwh-breach-on');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await tick();
    expect(localStorage.getItem('vex.breachCheck')).toBeNull();
    expect(document.getElementById('pwh-body').textContent).not.toMatch(/seen 9,659,365/);
  });
});
