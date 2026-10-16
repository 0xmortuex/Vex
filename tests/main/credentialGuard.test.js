// T2-089 (src/main/credential-guard.js) and T2-090's folder check (src/main/incident-scan.js).
import { describe, it, expect } from 'vitest';

const G = require('../../src/main/credential-guard.js');
const I = require('../../src/main/incident-scan.js');

describe('credential guard', () => {
  const saved = ['roblox.com', 'mybank.example'];
  it('says nothing on a site with a saved login, including its subdomains', () => {
    expect(G.check('https://www.roblox.com/login', { savedHosts: saved })).toMatchObject({ verdict: 'ok', reason: 'saved' });
    expect(G.check('login.mybank.example', { savedHosts: saved }).verdict).toBe('ok');
  });
  it('says nothing on an ordinary unrelated site', () => {
    expect(G.check('https://example.org', { savedHosts: saved }).verdict).toBe('ok');
  });
  it('warns on a lookalike of a brand and names it', () => {
    const r = G.check('paypa1.com', { savedHosts: [] });
    expect(r).toMatchObject({ verdict: 'warn', resembles: 'paypal.com' });
  });
  it('warns when a saved site\'s name leads a different address', () => {
    const r = G.check('https://roblox.com.verify-account.xyz/', { savedHosts: saved });
    expect(r).toMatchObject({ verdict: 'warn', kind: 'embeds-saved', resembles: 'roblox.com' });
  });
  it('warns on a bare number address, except this computer', () => {
    expect(G.check('http://203.0.113.9/login', {}).verdict).toBe('warn');
    expect(G.check('http://192.168.1.5/login', {}).verdict).toBe('ok');
  });
  it('refuses an address it cannot read', () => {
    expect(() => G.check('', {})).toThrow(/no address/);
  });
  it('the channel reports a locked vault and still checks', async () => {
    const handlers = new Map();
    G.registerCredentialGuard({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, savedHosts: () => { throw new Error('Vex is locked'); }, topHosts: () => [], allow: () => [] });
    const r = await handlers.get('credguard:check')({}, 'paypa1.com');
    expect(r.verdict).toBe('warn');
    expect(r.vault).toEqual({ ok: false, error: 'Vex is locked' });
  });
});

describe('incident scan', () => {
  const NOW = 100 * 86400000;
  const f = (name, ageDays) => ({ name, mtimeMs: NOW - ageDays * 86400000, size: 10 });
  it('flags disguised names, recent programs and scripts, and not old ones or plain files', () => {
    const r = I.scanNames([f('invoice.pdf.exe', 90), f('setup.exe', 2), f('old.exe', 90), f('run.ps1', 1), f('notes.txt', 1), f('photo.jpg', 1)], NOW);
    expect(r.flagged.map(x => x.name)).toEqual(['invoice.pdf.exe', 'run.ps1', 'setup.exe']);
    expect(r.flagged[0].kind).toBe('disguised');
    expect(r.total).toBe(6);
    expect(r.recent).toBe(4);
  });
  it('flags a reversed-text name', () => {
    expect(I.scanNames([f('report\u202Etxt.exe', 1)], NOW).flagged[0].kind).toBe('disguised');
  });
  it('reads only names, sizes and dates', () => {
    const fsMod = {
      readdirSync: () => ['a.exe', 'dir', 'gone.txt'],
      statSync: (p) => { if (p.endsWith('gone.txt')) { const e = new Error('x'); e.code = 'ENOENT'; throw e; } return { isFile: () => !p.endsWith('dir'), mtimeMs: NOW, size: 5 }; },
      readFileSync: () => { throw new Error('a file was opened'); },
    };
    const r = I.scanFolder('C:\\dl', fsMod, NOW);
    expect(r.flagged.map(x => x.name)).toEqual(['a.exe']);
    expect(r.total).toBe(1);
  });
  it('raises an error that is not "gone" and an empty folder name', () => {
    expect(() => I.scanFolder('', {})).toThrow(/no downloads folder/);
    expect(() => I.scanFolder('d', { readdirSync: () => ['a'], statSync: () => { const e = new Error('denied'); e.code = 'EPERM'; throw e; } })).toThrow(/denied/);
  });
});
