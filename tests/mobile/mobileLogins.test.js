// @vitest-environment jsdom
//
// The desktop's v19–v20 password features on the phone: the authenticator
// code filled into a page's code box (found the way the desktop finds it),
// logins edited, deleted with Undo, and moved in and out as CSV.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!window.crypto || !window.crypto.subtle) Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
if (!globalThis.crypto || !globalThis.crypto.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const store = {};
const secrets = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
// The page script runs in this document, as it would in the tab.
window.VexBridge = {
  vaultGet: async key => secrets[key] || '',
  vaultSet: async (key, value) => { secrets[key] = value; },
  authenticate: vi.fn(async () => ({ ok: true })),
  evaluate: vi.fn(async (id, script) => ({ result: JSON.stringify((0, eval)(script)) }))
};
window.VexSearch = { prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } } };
window.VexCollections = { id: prefix => prefix + Math.random().toString(36).slice(2, 8) };
require('../../mobile/www/js/sync-secrets.js');
const { VexVault } = require('../../mobile/www/js/vault.js');

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

// jsdom has no layout: every field is given a box, as a page on screen has.
function page(html, host = 'roblox.com') {
  document.body.innerHTML = html;
  for (const node of document.querySelectorAll('input')) node.getBoundingClientRect = () => ({ width: 120, height: 30 });
  Object.defineProperty(window, 'location', { value: new URL('https://www.' + host + '/settings'), configurable: true });
}

beforeEach(async () => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(secrets)) delete secrets[key];
  VexVault.lock();
  await VexVault.unlock();
  await VexVault.save({ host: 'roblox.com', username: 'me', password: 'pw', secret: SECRET });
});

describe('the authenticator code, into the page', () => {
  it('finds a code box by autocomplete, by its words, or as a row of one-digit boxes — not a phone field', async () => {
    page('<input name="phone" maxlength="10" inputmode="numeric"><label>Enter the 6-digit code<input id="c" maxlength="6"></label>');
    expect(await VexVault.pageHasCodeField('t1')).toBe(true);
    const entry = VexVault.codesFor('roblox.com')[0];
    expect(await VexVault.fillCode('t1', entry)).toBe('filled');
    const code = await VexVault.totp(SECRET, VexVault.codeOptions(entry));
    expect(document.getElementById('c').value).toBe(code);
    expect(document.querySelector('[name=phone]').value).toBe('');

    page('<div>Verification</div>' + '<input maxlength="1">'.repeat(6));
    expect(await VexVault.fillCode('t1', entry)).toBe('filled');
    expect([...document.querySelectorAll('input')].map(node => node.value).join('')).toBe(code);

    page('<input autocomplete="one-time-code">');
    expect(await VexVault.fillCode('t1', entry)).toBe('filled');

    page('<input name="search" placeholder="Search">');
    expect(await VexVault.pageHasCodeField('t1')).toBe(false);
  });

  it('finds one inside a shadow root', async () => {
    page('<div id="host"></div>');
    const root = document.getElementById('host').attachShadow({ mode: 'open' });
    root.innerHTML = '<input aria-label="Authenticator code" maxlength="6">';
    root.querySelector('input').getBoundingClientRect = () => ({ width: 100, height: 30 });
    expect(await VexVault.fillCode('t1', VexVault.codesFor('roblox.com')[0])).toBe('filled');
    expect(root.querySelector('input').value).toMatch(/^\d{6}$/);
  });

  it('fills nothing on another site, unless you picked the code for it', async () => {
    page('<input autocomplete="one-time-code">', 'evil.example');
    const entry = VexVault.codesFor('roblox.com')[0];
    expect(await VexVault.fillCode('t1', entry)).toBe('wrong-host');
    expect(document.querySelector('input').value).toBe('');
    expect(await VexVault.fillCode('t1', entry, { anyHost: true })).toBe('filled');
  });

  it('knows which sites have a code without being unlocked', () => {
    VexVault.lock();
    expect(VexVault.hasCodeFor('www.roblox.com')).toBe(true);
    expect(VexVault.hasCodeFor('auth.roblox.com')).toBe(true);
    expect(VexVault.hasCodeFor('example.com')).toBe(false);
  });
});

describe('managing logins', () => {
  it('edits a login in place, and Undo puts a deleted one back exactly', async () => {
    const [entry] = VexVault.all();
    await VexVault.update(entry.id, { username: 'me2', password: 'new', secret: '' });
    expect(VexVault.all()[0]).toMatchObject({ id: entry.id, username: 'me2', password: 'new', secret: '' });
    expect(VexVault.hasCodeFor('roblox.com')).toBe(false);
    const before = { ...VexVault.all()[0] };
    await VexVault.remove(before.id);
    expect(VexVault.all()).toHaveLength(0);
    await VexVault.restore(before);
    expect(VexVault.all()[0]).toEqual(before);
  });

  it('imports the CSV Chrome and Samsung Internet export, and skips what it already has', async () => {
    const csv = '﻿name,url,username,password,note\r\n'
      + 'GitHub,https://github.com/login,octo,"p,a""ss",\r\n'
      + 'Roblox,https://www.roblox.com/,me,pw,\r\n'
      + 'An app,android://abc@com.example.app/,x,y,\r\n';
    const rows = VexVault.loginsFromCsv(csv);
    expect(rows[0]).toEqual({ host: 'github.com', username: 'octo', password: 'p,a"ss' });
    expect(rows[2].host).toBe('');
    expect(await VexVault.importMany(rows)).toEqual({ added: 1, updated: 0, skipped: 2 });
    expect(VexVault.all().find(entry => entry.host === 'github.com').password).toBe('p,a"ss');
  });

  it('reads Firefox’s and Bitwarden’s column names too', () => {
    expect(VexVault.loginsFromCsv('"url","username","password","httpRealm"\n"https://a.example","u","p",""')[0])
      .toEqual({ host: 'a.example', username: 'u', password: 'p' });
    expect(VexVault.loginsFromCsv('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,A,,,,https://b.example/x,bu,bp,')[0])
      .toEqual({ host: 'b.example', username: 'bu', password: 'bp' });
    expect(() => VexVault.loginsFromCsv('a,b\n1,2')).toThrow(/no website and password columns/);
  });

  it('exports what it imports, quoting what needs it', () => {
    const csv = VexVault.loginsToCsv([{ host: 'x.example', username: 'a,b', password: 'q"t', label: 'X' }]);
    expect(csv).toBe('name,url,username,password,note\nX,https://x.example/,"a,b","q""t",\n');
    expect(VexVault.loginsFromCsv(csv)[0]).toEqual({ host: 'x.example', username: 'a,b', password: 'q"t' });
  });
});

describe('2FA codes from a backup or Google Authenticator', () => {
  it('adds what is new, onto the login for its site, and skips what is already here', async () => {
    await VexVault.save({ host: 'github.com', username: 'octo', password: 'pw' });
    const counts = await VexVault.importAccounts([
      { label: 'octo', issuer: 'GitHub', secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'sha1', digits: 6, period: 30 },
      { label: 'me', issuer: 'roblox.com', secret: SECRET, algorithm: 'sha1', digits: 6, period: 30 },
      { label: 'x', issuer: 'Bank', secret: 'not base32 !!', algorithm: 'sha1', digits: 6, period: 30 },
      { label: 'y', issuer: 'Elsewhere', secret: 'MFRGGZDF', algorithm: 'sha256', digits: 8, period: 30 }
    ]);
    expect(counts).toEqual({ added: 2, duplicates: 1, invalid: 1 });
    const github = VexVault.all().find(entry => entry.host === 'github.com');
    expect(github).toMatchObject({ password: 'pw', secret: 'GEZDGNBVGY3TQOJQ' });
    const other = VexVault.all().find(entry => entry.secret === 'MFRGGZDF');
    expect(other).toMatchObject({ password: '', username: 'y', label: 'Elsewhere', digits: 8, algorithm: 'SHA256' });
    expect(VexVault.accountsForBackup().map(account => account.issuer).sort()).toEqual(['Elsewhere', 'GitHub', 'roblox.com']);
  });
});
