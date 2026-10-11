// @vitest-environment jsdom
// Settings › Passwords: add, edit (username, password, note), show and copy
// behind a re-check, search, CSV export behind a plain warning, and undoing
// the "Never save" and authenticator "don't fill here" choices.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
const { PasswordVault } = require('../../src/renderer/js/passwords.js');

const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
let vault, container;

beforeEach(() => {
  document.body.innerHTML = '<div id="c"></div>';
  container = document.getElementById('c');
  localStorage.clear();
  PasswordVault._recheckedUntil = 0;
  vault = [
    { host: 'github.com', username: 'octo', password: 'gh-pass', note: 'backup codes in drawer' },
    { host: 'example.com', username: 'ann', password: 'ex-pass' },
  ];
  window.showToast = vi.fn();
  window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
  window.vexCopySecret = vi.fn(async () => true);
  window.VexLock = { hasPin: () => false, recheck: vi.fn(async () => true) };
  window.vex = {
    vaultList: vi.fn(async () => vault.map(({ host, username }) => ({ host, username }))),
    vaultGet: vi.fn(async (host) => vault.filter(e => e.host === host).map(e => ({ ...e }))),
    vaultSave: vi.fn(async (e) => { vault.push({ ...e }); return { ok: true }; }),
    vaultUpdate: vi.fn(async (q) => { const e = vault.find(x => x.host === q.host && x.username === q.username); e.username = q.newUsername; if (q.password) e.password = q.password; e.note = q.note; return { ok: true }; }),
    vaultDelete: vi.fn(async () => ({ ok: true })),
    vaultExportCsv: vi.fn(async () => ({ ok: true, count: 2, path: 'x.csv' })),
  };
});

const rowFor = (host) => [...container.querySelectorAll('#pw-rows > div')].find(r => r.textContent.includes(host));

describe('Settings › Passwords', () => {
  it('search narrows the list by site or username', async () => {
    await PasswordVault.renderPanel(container);
    const search = container.querySelector('#pw-search');
    search.value = 'octo';
    search.dispatchEvent(new Event('input'));
    expect(rowFor('github.com').style.display).toBe('');
    expect(rowFor('example.com').style.display).toBe('none');
    search.value = 'nothing-like-this';
    search.dispatchEvent(new Event('input'));
    expect(container.textContent).toMatch(/No saved password matches that/);
  });

  it('shows a password (and its note) only after the re-check', async () => {
    await PasswordVault.renderPanel(container);
    window.VexLock.recheck = vi.fn(async () => false);
    rowFor('github.com').querySelector('[data-reveal]').click();
    await tick();
    expect(rowFor('github.com').querySelector('[data-shown]').style.display).toBe('none');
    expect(window.vex.vaultGet).not.toHaveBeenCalled();

    window.VexLock.recheck = vi.fn(async () => true);
    rowFor('github.com').querySelector('[data-reveal]').click();
    await tick();
    const shown = rowFor('github.com').querySelector('[data-shown]');
    expect(shown.textContent).toBe('gh-pass\nbackup codes in drawer');
    // Copy right after does not ask again (one check covers two minutes).
    rowFor('github.com').querySelector('[data-copy]').click();
    await tick();
    expect(window.VexLock.recheck).toHaveBeenCalledTimes(1);
    expect(window.vexCopySecret).toHaveBeenCalledWith('gh-pass', 'Password copied');
  });

  it('copy asks first too', async () => {
    await PasswordVault.renderPanel(container);
    window.VexLock.recheck = vi.fn(async () => false);
    rowFor('example.com').querySelector('[data-copy]').click();
    await tick();
    expect(window.vexCopySecret).not.toHaveBeenCalled();
  });

  it('adds a login with a note, taking the site from a full address', async () => {
    await PasswordVault.renderPanel(container);
    container.querySelector('#pw-add').click();
    await tick();
    const d = document.querySelector('.vex-dialog');
    expect(d.getAttribute('role')).toBe('dialog');
    d.querySelector('#vex-pwedit-host').value = 'https://www.Shop.example/login';
    d.querySelector('#vex-pwedit-user').value = 'me@shop.example';
    d.querySelector('#vex-pwedit-pass').value = 's3cret';
    d.querySelector('#vex-pwedit-note').value = 'PIN 0000';
    d.querySelector('[data-ok]').click();
    await tick();
    expect(window.vex.vaultSave).toHaveBeenCalledWith({ host: 'shop.example', username: 'me@shop.example', password: 's3cret', note: 'PIN 0000' });
    expect(rowFor('shop.example')).toBeTruthy();
  });

  it('add refuses an empty password, and a login that already exists', async () => {
    await PasswordVault.renderPanel(container);
    container.querySelector('#pw-add').click();
    await tick();
    let d = document.querySelector('.vex-dialog');
    d.querySelector('#vex-pwedit-host').value = 'example.com';
    d.querySelector('#vex-pwedit-user').value = 'ann';
    d.querySelector('[data-ok]').click();
    expect(d.querySelector('#vex-pwedit-error').textContent).toBe('Enter the password');
    d.querySelector('#vex-pwedit-pass').value = 'x';
    d.querySelector('[data-ok]').click();
    await tick();
    expect(window.vex.vaultSave).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('There is already a saved login for ann on example.com: edit that one', 'error');
  });

  it('edits username, password and note after the re-check', async () => {
    await PasswordVault.renderPanel(container);
    rowFor('github.com').querySelector('[data-edit]').click();
    await tick();
    expect(window.VexLock.recheck).toHaveBeenCalled();
    const d = document.querySelector('.vex-dialog');
    expect(d.querySelector('#vex-pwedit-host').readOnly).toBe(true);
    expect(d.querySelector('#vex-pwedit-pass').type).toBe('password');
    expect(d.querySelector('#vex-pwedit-pass').value).toBe('gh-pass');
    expect(d.querySelector('#vex-pwedit-note').value).toBe('backup codes in drawer');
    d.querySelector('#vex-pwedit-show').click();
    expect(d.querySelector('#vex-pwedit-pass').type).toBe('text');
    d.querySelector('#vex-pwedit-user').value = 'octocat';
    d.querySelector('#vex-pwedit-pass').value = 'new-pass';
    d.querySelector('#vex-pwedit-note').value = '';
    d.querySelector('[data-ok]').click();
    await tick();
    expect(window.vex.vaultUpdate).toHaveBeenCalledWith({ host: 'github.com', username: 'octo', newUsername: 'octocat', password: 'new-pass', note: '' });
    expect(rowFor('github.com').textContent).toMatch(/octocat/);
  });

  // Found 2026-10-11 in a live probe: a login with no username (kept from a
  // browser's CSV since this release) could not be edited at all: Save said
  // "Enter the username or email", though main accepts an empty one.
  it('edits a login that has no username, without making one up', async () => {
    vault.push({ host: 'pin.example', username: '', password: 'Pin-only-77' });
    await PasswordVault.renderPanel(container);
    rowFor('pin.example').querySelector('[data-edit]').click();
    await tick();
    const d = document.querySelector('.vex-dialog');
    expect(d.querySelector('#vex-pwedit-user').value).toBe('');
    d.querySelector('#vex-pwedit-pass').value = 'Pin-new-88';
    d.querySelector('[data-ok]').click();
    await tick();
    expect(d.querySelector('#vex-pwedit-error').style.display).not.toBe('block');
    expect(window.vex.vaultUpdate).toHaveBeenCalledWith({ host: 'pin.example', username: '', newUsername: '', password: 'Pin-new-88', note: '' });
    expect(vault.find(e => e.host === 'pin.example').password).toBe('Pin-new-88');
  });

  it('a login that has a username still needs one when edited', async () => {
    await PasswordVault.renderPanel(container);
    rowFor('github.com').querySelector('[data-edit]').click();
    await tick();
    const d = document.querySelector('.vex-dialog');
    d.querySelector('#vex-pwedit-user').value = '  ';
    d.querySelector('[data-ok]').click();
    await tick();
    expect(d.querySelector('#vex-pwedit-error').textContent).toBe('Enter the username or email');
    expect(window.vex.vaultUpdate).not.toHaveBeenCalled();
  });

  it('export warns plainly first, and does nothing if the warning is declined', async () => {
    await PasswordVault.renderPanel(container);
    window.vexConfirm = vi.fn(async () => false);
    container.querySelector('#pw-export').click();
    await tick();
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/plain text/);
    expect(window.vexConfirm.mock.calls[0][0].danger).toBe(true);
    expect(window.vex.vaultExportCsv).not.toHaveBeenCalled();
    window.vexConfirm = vi.fn(async () => true);
    container.querySelector('#pw-export').click();
    await tick();
    expect(window.vex.vaultExportCsv).toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('Exported 2 passwords — delete the file once you have used it');
  });

  it('lists the "Never save" sites and the authenticator "don\'t fill here" answers, each with Remove', async () => {
    localStorage.setItem('vex.pwNever', JSON.stringify(['bank.example', 'forum.example']));
    localStorage.setItem('vex.totpSites', JSON.stringify({ 'github@github.io': false, 'roblox@roblox.com': true }));
    await PasswordVault.renderPanel(container);
    const box = container.querySelector('#pw-choices');
    expect(box.textContent).toMatch(/Never offered to save on/);
    expect(box.textContent).toMatch(/bank\.example/);
    expect(box.textContent).toMatch(/Authenticator codes not filled on/);
    expect(box.textContent).toMatch(/github\.io \(github\)/);
    expect(box.textContent).not.toMatch(/roblox/);
    box.querySelector('[aria-label="Remove bank.example"]').click();
    await tick();
    expect(JSON.parse(localStorage.getItem('vex.pwNever'))).toEqual(['forum.example']);
    container.querySelector('[aria-label="Remove github.io (github)"]').click();
    await tick();
    expect(JSON.parse(localStorage.getItem('vex.totpSites'))).toEqual({ 'roblox@roblox.com': true });
  });
});
