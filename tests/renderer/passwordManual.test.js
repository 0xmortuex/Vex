// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://shop.example.com/login" }
// Saving a password by hand and generating one for a field. Owner's report
// (2026-10-12): "when the auto save password doesn't work there is an option
// where the user can press a button to create a new password by right-clicking
// the website". The automatic card needs the page to submit a real form; sites
// that sign in by script never produce it, and the only way left was Settings.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import '../../src/renderer/js/password-gen.js';
import { PasswordVault } from '../../src/renderer/js/passwords.js';
import { VexPasswordManual } from '../../src/renderer/js/password-manual.js';

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const sized = () => { Element.prototype.getBoundingClientRect = function () { return { width: 120, height: 30, top: 0, left: 0, right: 120, bottom: 30 }; }; };
const guest = (href = 'https://shop.example.com/login', partition = 'persist:main') => ({
  isConnected: true,
  getURL: () => href,
  getAttribute: (name) => (name === 'partition' ? partition : null),
  executeJavaScript: (js) => Promise.resolve(window.eval(js)),
});
const src = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer/js', p), 'utf8');

describe('the generator behind the dialog', () => {
  beforeEach(() => { window.VexPasswordGen = window.VexPasswordGen || globalThis.VexPasswordGen; });

  it('keeps the length between 12 and 64', () => {
    expect(PasswordVault.generateLogin({ length: 5 }).password).toHaveLength(12);
    expect(PasswordVault.generateLogin({ length: 20 }).password).toHaveLength(20);
    expect(PasswordVault.generateLogin({ length: 500 }).password).toHaveLength(64);
  });

  it('honours the character options', () => {
    const lettersOnly = PasswordVault.generateLogin({ length: 40, letters: true, digits: false, symbols: false }).password;
    expect(lettersOnly).toMatch(/^[A-Za-z]+$/);
    expect(lettersOnly).toMatch(/[a-z]/);
    expect(lettersOnly).toMatch(/[A-Z]/);
    const digitsOnly = PasswordVault.generateLogin({ length: 30, letters: false, digits: true, symbols: false }).password;
    expect(digitsOnly).toMatch(/^[0-9]+$/);
    const all = PasswordVault.generateLogin({ length: 30 }).password;
    expect(all).toMatch(/[a-z]/); expect(all).toMatch(/[A-Z]/); expect(all).toMatch(/[0-9]/); expect(all).toMatch(/[^A-Za-z0-9]/);
  });

  it('leaves out lookalike characters on request', () => {
    for (let i = 0; i < 60; i++) {
      expect(PasswordVault.generateLogin({ length: 64, avoidAmbiguous: true }).password).not.toMatch(/[0O1lI|]/);
    }
  });

  it('refuses rather than falling back when nothing is chosen', () => {
    expect(() => PasswordVault.generateLogin({ letters: false, digits: false, symbols: false })).toThrow(/at least one/);
  });

  it('never returns the same password twice, and reports honest strength', () => {
    const seen = new Set();
    for (let i = 0; i < 300; i++) seen.add(PasswordVault.generateLogin({ length: 12 }).password);
    expect(seen.size).toBe(300);
    const strong = PasswordVault.generateLogin({ length: 20 });
    expect(strong.bits).toBeGreaterThan(100);
    expect(strong.strength.label).toBe('Very strong');
    expect(PasswordVault.generateLogin({ length: 12, letters: false, digits: true, symbols: false }).strength.label).toBe('Weak');
  });

  it('uses crypto.getRandomValues and never Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    PasswordVault.generateLogin({ length: 30 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('where saving by hand is allowed', () => {
  beforeEach(() => { delete window.VexTabPolicy; });
  afterEach(() => { delete window.VexTabPolicy; });
  it('allows a normal https tab', () => {
    expect(VexPasswordManual.savingRefusal(guest())).toBe('');
  });
  it('refuses a private or Tor tab and says why', () => {
    window.VexTabPolicy = { canFillWebview: () => false, isRouted: () => false };
    expect(VexPasswordManual.savingRefusal(guest())).toMatch(/private or Tor tab/);
  });
  it('refuses a tab routed through Tor or a proxy and says why', () => {
    window.VexTabPolicy = { canFillWebview: () => true, isRouted: (p) => /route-tor/.test(p) };
    expect(VexPasswordManual.savingRefusal(guest('https://shop.example.com/', 'persist:route-tor'))).toMatch(/routed through Tor or a proxy/);
    expect(VexPasswordManual.savingRefusal(guest('https://shop.example.com/', 'persist:main'))).toBe('');
  });
  it('refuses a page that is not https', () => {
    expect(VexPasswordManual.savingRefusal(guest('http://shop.example.com/'))).toMatch(/https/);
  });
});

describe('the Save a password dialog', () => {
  let toasts;
  beforeEach(() => {
    sized();
    delete window.VexTabPolicy;
    toasts = [];
    window.showToast = (m, k) => toasts.push([m, k]);
    document.body.innerHTML = '<input id="user" type="text" name="login" value="sam@example.com"><input id="pw" type="password" name="secret">';
    window.escapeHtml = window.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    window.vexConfirm = vi.fn(async () => true);
    window.vex = { vaultGet: vi.fn(async () => []), vaultSave: vi.fn(async () => ({ ok: true })) };
  });
  afterEach(() => { document.querySelectorAll('.vex-dialog-overlay').forEach(o => o.remove()); });

  const overlay = () => document.querySelector('.vex-dialog-overlay');

  it('opens with the site read-only and the username taken from the page', async () => {
    const pending = VexPasswordManual.saveForSite(guest());
    await wait(50);
    expect(overlay()).toBeTruthy();
    expect(overlay().querySelector('#vex-pwedit-host').value).toBe('shop.example.com');
    expect(overlay().querySelector('#vex-pwedit-host').hasAttribute('readonly')).toBe(true);
    expect(overlay().querySelector('#vex-pwedit-user').value).toBe('sam@example.com');
    expect(overlay().querySelector('#vex-pwedit-generate')).toBeTruthy();
    overlay().querySelector('[data-cancel]').click();
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
  });

  it('Generate fills a shown password and its strength, and Save writes it through the vault', async () => {
    const pending = VexPasswordManual.saveForSite(guest());
    await wait(50);
    const o = overlay();
    o.querySelector('#vex-pwedit-generate').click();
    const pass = o.querySelector('#vex-pwedit-pass');
    expect(pass.value).toHaveLength(20);
    expect(pass.type).toBe('text');
    expect(o.querySelector('#vex-pwedit-strength').textContent).toMatch(/Very strong · \d+ bits/);
    // The length slider re-makes it in place.
    const len = o.querySelector('#vex-pwedit-len');
    len.value = '32'; len.dispatchEvent(new Event('input', { bubbles: true }));
    expect(pass.value).toHaveLength(32);
    const made = pass.value;
    o.querySelector('[data-ok]').click();
    const r = await pending;
    expect(r.ok).toBe(true);
    expect(window.vex.vaultSave).toHaveBeenCalledWith({ host: 'shop.example.com', username: 'sam@example.com', password: made, note: '' });
    expect(toasts.at(-1)[0]).toBe('Password saved');
  });

  it('a typed password can be shown and hidden, and an empty one is refused', async () => {
    const pending = VexPasswordManual.saveForSite(guest());
    await wait(50);
    const o = overlay();
    o.querySelector('[data-ok]').click();
    expect(o.querySelector('#vex-pwedit-error').textContent).toMatch(/Enter the password/);
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
    const pass = o.querySelector('#vex-pwedit-pass');
    pass.value = 'my-own-secret';
    o.querySelector('#vex-pwedit-show').click();
    expect(pass.type).toBe('text');
    o.querySelector('#vex-pwedit-show').click();
    expect(pass.type).toBe('password');
    o.querySelector('[data-cancel]').click();
    await pending;
  });

  it('asks before replacing a different saved password, and not at all when it is identical', async () => {
    window.vex.vaultGet = vi.fn(async () => [{ host: 'shop.example.com', username: 'sam@example.com', password: 'old-one' }]);
    let pending = VexPasswordManual.saveForSite(guest());
    await wait(50);
    overlay().querySelector('#vex-pwedit-pass').value = 'new-one-123';
    overlay().querySelector('[data-ok]').click();
    let r = await pending;
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vexConfirm.mock.calls[0][0].title).toMatch(/Update the saved password/);
    expect(r).toEqual({ ok: true, updated: true });
    expect(window.vex.vaultSave).toHaveBeenCalledTimes(1);

    window.vexConfirm.mockClear();
    window.vex.vaultSave.mockClear();
    window.vexConfirm = vi.fn(async () => false);
    pending = VexPasswordManual.saveForSite(guest());
    await wait(50);
    overlay().querySelector('#vex-pwedit-pass').value = 'another-123';
    overlay().querySelector('[data-ok]').click();
    r = await pending;
    expect(r).toEqual({ ok: false, reason: 'declined' });
    expect(window.vex.vaultSave).not.toHaveBeenCalled();

    window.vex.vaultGet = vi.fn(async () => [{ host: 'shop.example.com', username: 'sam@example.com', password: 'same-123' }]);
    pending = VexPasswordManual.saveForSite(guest());
    await wait(50);
    overlay().querySelector('#vex-pwedit-pass').value = 'same-123';
    overlay().querySelector('[data-ok]').click();
    r = await pending;
    expect(r).toEqual({ ok: true, unchanged: true });
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
  });

  it('does not even open in a private or routed tab', async () => {
    window.VexTabPolicy = { canFillWebview: () => false, isRouted: () => false };
    const r = await VexPasswordManual.saveForSite(guest());
    expect(r.reason).toBe('refused');
    expect(overlay()).toBeNull();
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
    expect(toasts.at(-1)[1]).toBe('error');
  });

  it('says so when the vault cannot be written', async () => {
    window.vex.vaultSave = vi.fn(async () => ({ ok: false, error: 'Vex is locked' }));
    const pending = VexPasswordManual.saveForSite(guest());
    await wait(50);
    overlay().querySelector('#vex-pwedit-pass').value = 'abc-123-xyz';
    overlay().querySelector('[data-ok]').click();
    const r = await pending;
    expect(r.ok).toBe(false);
    expect(toasts.at(-1)[0]).toMatch(/Could not save it: Vex is locked/);
  });

  it('Settings > Passwords > Add has the generator too', async () => {
    const pending = PasswordVault._editDialog({ title: 'Add a password', okLabel: 'Save', hostEditable: true, generator: true });
    await wait(20);
    expect(overlay().querySelector('#vex-pwedit-generate')).toBeTruthy();
    expect(overlay().querySelector('#vex-pwedit-len').min).toBe('12');
    expect(overlay().querySelector('#vex-pwedit-len').max).toBe('64');
    overlay().querySelector('[data-cancel]').click();
    await pending;
    expect(src('passwords.js')).toMatch(/title: 'Add a password', okLabel: 'Save', hostEditable: true, generator: true/);
  });
});

describe('Generate a strong password into a field', () => {
  let toasts, written;
  beforeEach(() => {
    sized();
    delete window.VexTabPolicy;
    toasts = [];
    written = [];
    window.showToast = (m, k) => toasts.push([m, k]);
    window.escapeHtml = window.escapeHtml || ((s) => String(s));
    window.vex = { vaultGet: async () => [], vaultSave: vi.fn(async () => ({ ok: true })) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async (t) => { written.push(t); }) } });
  });
  afterEach(() => { document.getElementById('vex-pw-offer')?.remove(); });

  it('fills the focused new-password field and its confirm box, copies nothing, and offers to save it', async () => {
    document.body.innerHTML = '<form action="/signup"><input id="email" type="email"><input id="p1" type="password" autocomplete="new-password"><input id="p2" type="password" name="confirm_password" autocomplete="new-password"></form>';
    document.getElementById('p1').focus();
    const r = await VexPasswordManual.generateInField(guest());
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    const p1 = document.getElementById('p1').value;
    expect(p1).toHaveLength(20);
    expect(document.getElementById('p2').value).toBe(p1);
    expect(document.getElementById('email').value).toBe('');
    expect(document.querySelector('[data-vex-pwgen]')).toBeNull();      // no marker left behind
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(document.getElementById('vex-pw-offer')).toBeTruthy();       // "Save it"
    expect(toasts.at(-1)[0]).toMatch(/Strong password filled/);
  });

  it('fills only the one field when the others are not confirm boxes', async () => {
    document.body.innerHTML = '<form><input id="old" type="password" autocomplete="current-password" value="keep"><input id="new" type="password" autocomplete="new-password"></form>';
    document.getElementById('new').focus();
    const r = await VexPasswordManual.generateInField(guest());
    expect(r.count).toBe(1);
    expect(document.getElementById('old').value).toBe('keep');
  });

  it('respects a short maxlength and refuses one that is too short', async () => {
    document.body.innerHTML = '<input id="p" type="password" maxlength="10">';
    document.getElementById('p').focus();
    await VexPasswordManual.generateInField(guest());
    expect(document.getElementById('p').value).toHaveLength(10);
    document.body.innerHTML = '<input id="p" type="password" maxlength="6">';
    document.getElementById('p').focus();
    const r = await VexPasswordManual.generateInField(guest());
    expect(r.reason).toBe('too-short');
    expect(document.getElementById('p').value).toBe('');
  });

  it('says so when there is no password field, and never fills a cross-origin form', async () => {
    document.body.innerHTML = '<input id="t" type="text">';
    let r = await VexPasswordManual.generateInField(guest());
    expect(r.reason).toBe('no-field');
    document.body.innerHTML = '<form action="https://evil.test/steal"><input id="p" type="password"></form>';
    document.getElementById('p').focus();
    r = await VexPasswordManual.generateInField(guest());
    expect(r.reason).toBe('no-field');
    expect(document.getElementById('p').value).toBe('');
  });

  it('fills in a private tab but offers no save there', async () => {
    window.VexTabPolicy = { canFillWebview: () => false, isRouted: () => false };
    document.body.innerHTML = '<input id="p" type="password">';
    document.getElementById('p').focus();
    const r = await VexPasswordManual.generateInField(guest());
    expect(r.ok).toBe(true);
    expect(document.getElementById('p').value).toHaveLength(20);
    expect(document.getElementById('vex-pw-offer')).toBeNull();
  });
});

describe('wiring', () => {
  it('the page menu, This site, and Ctrl+K carry both actions', () => {
    const w = src('webview.js');
    expect(w).toMatch(/VexPasswordManual\.saveForSite\(webview\)/);
    expect(w).toMatch(/VexPasswordManual\.generateInField\(webview, at\(\)\)/);
    expect(w).toMatch(/formControlType === 'input-password'/);
    expect(w).toMatch(/siteItems\.unshift\(saveRow\)/);
    const c = src('command.js');
    expect(c).toMatch(/id: 'savepassword', label: 'Save a password for this site'/);
    expect(c).toMatch(/id: 'genpassword', label: 'Generate a strong password'/);
  });
  it('the module is loaded by the window, after the vault', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
    expect(html.indexOf('js/passwords.js')).toBeGreaterThan(0);
    expect(html.indexOf('js/password-manual.js')).toBeGreaterThan(html.indexOf('js/passwords.js'));
  });
  it('has Turkish for the rows and what they say', () => {
    const i = src('i18n.js');
    for (const key of ['menuSavePw', 'menuGenPw', 'pwPrivate', 'pwRouted', 'pwHttps', 'pwUpdateTitle', 'pwFilled', 'pwSaveIt']) {
      expect((i.match(new RegExp('\\b' + key + ':', 'g')) || []).length, key).toBeGreaterThanOrEqual(2);
    }
  });
});
