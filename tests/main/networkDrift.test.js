// @vitest-environment node
//
// "Did a proxy or a new root certificate appear since the last time?" (src/main/network-drift.js): the Windows commands are replaced by
// a fake runner that answers with canned text, the record is a real file in a temp folder, nothing is ever started.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const nd = require('../../src/main/network-drift.js');
const { createNetworkDrift, parseProxy, parseCerts, REG_KEY, PS_ARGS } = nd;

const T1 = 'A'.repeat(40), T2 = 'B'.repeat(40), T3 = 'c'.repeat(40);
const regText = (enable, server, pac) => [
  '', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
  '    AutoDetect    REG_DWORD    0x1',
  enable == null ? '' : '    ProxyEnable    REG_DWORD    ' + enable,
  server == null ? '' : '    ProxyServer    REG_SZ    ' + server,
  pac == null ? '' : '    AutoConfigURL    REG_SZ    ' + pac, '',
].join('\r\n');
const certText = (list) => list.map(([t, s]) => t + '\t' + s).join('\r\n') + '\r\n';

let dir, file, answers, calls, log;
const make = (over = {}) => createNetworkDrift({
  file, platform: 'win32', now: () => 5000, log,
  run: async (name, args) => { calls.push([name, args]); if (answers.fail) throw new Error(answers.fail); return { stdout: name === 'reg' ? answers.reg : answers.certs }; },
  ...over,
});
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-netdrift-'));
  file = path.join(dir, 'network-drift.json');
  calls = [];
  log = { log() {}, warn() {}, error: vi.fn() };
  answers = { reg: regText('0x0', null, null), certs: certText([[T1, 'CN=Root One'], [T2, 'CN=Root Two']]) };
});

describe('parsing', () => {
  it('reads the proxy values and ignores the rest', () => {
    expect(parseProxy(regText('0x1', '127.0.0.1:8080', null))).toEqual({ on: true, server: '127.0.0.1:8080', pac: '' });
    expect(parseProxy(regText('0x0', '127.0.0.1:8080', null))).toEqual({ on: false, server: '', pac: '' });
    expect(parseProxy(regText('0x0', null, 'http://wpad.school.example/proxy.pac'))).toEqual({ on: true, server: '', pac: 'http://wpad.school.example/proxy.pac' });
    expect(parseProxy('')).toEqual({ on: false, server: '', pac: '' });
  });
  it('reads thumbprint and subject per line, in any line ending, sorted, and skips noise', () => {
    const list = parseCerts('\uFEFF' + certText([[T2, 'CN=Two'], [T3, 'CN=Three']]) + 'not a line\r\n');
    expect(list.map(c => c.thumbprint)).toEqual([T2, T3.toUpperCase()]);
    expect(list[1].subject).toBe('CN=Three');
  });
});

describe('what it runs', () => {
  it('only reg.exe with an argument list and one fixed encoded PowerShell command', async () => {
    await make().check();
    expect(calls[0]).toEqual(['reg', ['query', REG_KEY]]);
    expect(calls[1][0]).toBe('powershell.exe');
    expect(calls[1][1]).toBe(PS_ARGS);
    const script = Buffer.from(PS_ARGS[PS_ARGS.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
    expect(script).toMatch(/Get-ChildItem Cert:\\CurrentUser\\Root/);
    expect(script).not.toMatch(/Remove-|Set-|Import-|Add-|certutil|netsh/i);
  });
});

describe('the look', () => {
  it('the first look only records, and says nothing changed', async () => {
    const d = make();
    const r = await d.check();
    expect(r.baseline).toBe(true);
    expect(r.certs.added).toEqual([]);
    expect(d.notesFor(r)).toEqual([]);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.certs).toEqual([T1, T2]);
    expect(JSON.stringify(saved)).not.toMatch(/Root One|127\.0\.0\.1/);          // thumbprints and a hash only, no names or addresses
  });

  it('a second look with nothing new is quiet', async () => {
    await make().check();
    const d = make();
    const r = await d.check();
    expect(r).toMatchObject({ baseline: false, proxy: { status: 'same' }, certs: { added: [], count: 2 } });
    expect(d.notesFor(r)).toEqual([]);
  });

  it('reports only the ADDED certificates, with their subject names, once', async () => {
    await make().check();
    answers.certs = certText([[T1, 'CN=Root One'], [T3, 'CN=Evil Proxy CA'], [T2, 'CN=Root Two']]);
    const d = make();
    const r = await d.check();
    expect(r.certs.added).toEqual([{ thumbprint: T3.toUpperCase(), subject: 'CN=Evil Proxy CA' }]);
    const notes = d.notesFor(r);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ feature: 'network-drift', title: 'A new root certificate was added: “CN=Evil Proxy CA”' });
    expect(notes[0].body).toBe(nd.BODY_CERT);
    expect(notes[0].body.length).toBeLessThanOrEqual(300);
    const again = await make().check();
    expect(again.certs.added).toEqual([]);                                        // reported once
  });

  it('a removed certificate is not reported', async () => {
    await make().check();
    answers.certs = certText([[T1, 'CN=Root One']]);
    const r = await make().check();
    expect(r.certs.added).toEqual([]);
  });

  it('a proxy that appears, changes or goes away', async () => {
    await make().check();
    answers.reg = regText('0x1', '10.0.0.5:3128', null);
    let d = make(); let r = await d.check();
    expect(r.proxy.status).toBe('appeared');
    expect(d.notesFor(r)[0]).toMatchObject({ title: 'Windows now uses the proxy “10.0.0.5:3128”', body: nd.BODY_PROXY });
    answers.reg = regText('0x1', '10.0.0.9:3128', null);
    d = make(); r = await d.check();
    expect(r.proxy.status).toBe('changed');
    expect(d.notesFor(r)[0].title).toBe('The Windows proxy changed to “10.0.0.9:3128”');
    answers.reg = regText('0x1', '10.0.0.9:3128', null);
    expect((await make().check()).proxy.status).toBe('same');
    answers.reg = regText('0x0', null, null);
    d = make(); r = await d.check();
    expect(r.proxy.status).toBe('removed');
    expect(d.notesFor(r)).toEqual([]);
  });

  it('a proxy setup script is named by its host', async () => {
    await make().check();
    answers.reg = regText('0x0', null, 'http://wpad.school.example/proxy.pac');
    const d = make(); const r = await d.check();
    expect(r.proxy.status).toBe('appeared');
    expect(d.notesFor(r)[0]).toMatchObject({ title: 'Windows now uses a proxy setup script from “wpad.school.example”', body: nd.BODY_PAC });
  });

  it('lists at most five certificates and then says there are more', async () => {
    await make().check();
    answers.certs = certText([[T1, 'x'], [T2, 'x'], ...Array.from({ length: 8 }, (_, i) => [String(i).repeat(40), 'CN=New ' + i])]);
    const d = make(); const r = await d.check();
    const notes = d.notesFor(r);
    expect(r.certs.added).toHaveLength(8);
    expect(notes).toHaveLength(nd.MAX_SHOWN + 1);
    expect(notes[notes.length - 1].title).toBe('More new root certificates were added');
  });

  it('a failed command throws and keeps the old record, so a failure never looks like "nothing changed"', async () => {
    await make().check();
    const before = fs.readFileSync(file, 'utf8');
    answers.fail = 'timed out';
    await expect(make().check()).rejects.toThrow('timed out');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    answers.fail = null;
    answers.certs = '';
    await expect(make().check()).rejects.toThrow(/empty/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('the switch', () => {
  it('is off until chosen, persists, and is Windows only', async () => {
    const d = make();
    expect(d.get()).toMatchObject({ supported: true, enabled: false, hadBaseline: false });
    d.setEnabled(true);
    expect(make().get().enabled).toBe(true);
    await d.check();
    expect(make().get()).toMatchObject({ enabled: true, hadBaseline: true, knownCerts: 2, lastCheckedAt: 5000 });
    expect(() => d.setEnabled('yes')).toThrow();
    const linux = make({ platform: 'linux' });
    expect(linux.get()).toMatchObject({ supported: false, enabled: false });
    expect(() => linux.setEnabled(true)).toThrow(/Windows/);
    await expect(linux.check()).rejects.toThrow(/Windows/);
    expect(calls).toHaveLength(2);                                                // only the one Windows look ever ran anything
  });

  it('a damaged record is kept aside and the switch starts off', () => {
    fs.writeFileSync(file, '{broken');
    const d = make();
    expect(d.get().enabled).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it('needs a file and a runner', () => {
    expect(() => createNetworkDrift({ file })).toThrow();
  });
});
