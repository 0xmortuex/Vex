// src/main/file-check.js — what a downloaded file is, before it is run.
//
// An installer is the one thing a browser hands you that can do anything to the
// machine, and the browser says nothing about it. Windows asks "are you sure"
// and names the publisher — after the double-click, and only if it is signed.
//
// Vex is not an antivirus and does not pretend to be: it reports what can be
// known locally — who signed it, where it came from, its fingerprint — and the
// user decides. Nothing is sent anywhere.

import { describe, it, expect, vi } from 'vitest';
const realFs = require('fs');
const realCrypto = require('crypto');
const os = require('os');
const path = require('path');
const { createFileCheck, RUNNABLE } = require('../../src/main/file-check.js');

function check(over = {}) {
  return createFileCheck({
    fs: realFs, crypto: realCrypto, platform: 'win32',
    execFile: (cmd, args, opts, cb) => cb(null, 'Valid\nCN=Example Ltd, O=Example Ltd, C=GB'),
    ...over,
  });
}

function tempFile(name, contents = 'hello') {
  const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'vex-fc-'));
  const p = path.join(dir, name);
  realFs.writeFileSync(p, contents);
  return p;
}

describe('which files are worth stopping for', () => {
  it('anything that can run itself', () => {
    const fc = check();
    for (const n of ['setup.exe', 'a.msi', 'x.bat', 'y.ps1', 'z.jar', 'app.dmg', 'thing.apk', 'lib.dll']) {
      expect(fc.kindOf('/d/' + n), n).toBe('runnable');
    }
    for (const n of ['photo.jpg', 'report.pdf', 'notes.txt', 'data.csv']) expect(fc.kindOf('/d/' + n), n).toBe('ordinary');
    for (const n of ['bundle.zip', 'x.tar.gz', 'drivers.cab']) expect(fc.kindOf('/d/' + n), n).toBe('archive');
  });

  // Audit RD3 (2026-10-10): the check before Open let these through as
  // "ordinary", so they opened without a word. Chrome warns about each.
  it('shortcuts, snap-ins, help files, ClickOnce, script hosts, add-ins and disk images', () => {
    const fc = check();
    for (const n of ['invoice.lnk', 'site.url', 'x.scf', 'old.pif', 'a.website', 'f.library-ms', 'q.search-ms', 'c.searchconnector-ms', 's.settingcontent-ms',
      'tool.cpl', 'console.msc', 'manual.chm', 'old.hlp', 'patch.msp', 't.mst', 'app.application', 'app.appref-ms', 'x.xbap',
      'a.vb', 'a.vbe', 'a.wsc', 'a.ws', 'a.sct', 'a.shb', 'a.shs', 'a.ps1xml', 'a.psc1', 'a.msh',
      'setup.inf', 'a.ins', 'a.isp', 'addin.xll', 'ctl.ocx', 'w.gadget', 'notes.one', 'start.jnlp',
      'disk.iso', 'disk.img', 'disk.vhd', 'disk.vhdx', 'Invoice.PDF.LNK']) {
      expect(fc.kindOf('C:/Downloads/' + n), n).toBe('runnable');
    }
    // Not over-reaching: names that merely contain one of these.
    for (const n of ['onepager.pdf', 'urlnotes.txt', 'image.png', 'lnk.txt', 'inference.csv']) expect(fc.kindOf('C:/Downloads/' + n), n).toBe('ordinary');
  });

  it('is not fooled by the case of the extension', () => {
    expect(check().kindOf('C:/d/Setup.EXE')).toBe('runnable');
    expect(RUNNABLE.test('installer.MSI')).toBe(true);
  });
});

// Audit RD4 (2026-10-10): Open read the whole of an ordinary file (a film, a
// disk backup) to fingerprint it before opening it, which nobody asked for.
describe('the fingerprint', () => {
  it('is taken of programs and archives, not of an ordinary file', async () => {
    const read = vi.fn((...a) => realFs.createReadStream(...a));
    const fc = check({ fs: { ...realFs, createReadStream: read } });
    const film = await fc.inspect(tempFile('film.mkv', 'x'.repeat(1000)), 'https://example.com/film.mkv');
    expect(read).not.toHaveBeenCalled();
    expect(film.sha256).toBe('');
    expect(film.lines.join('\n')).not.toMatch(/SHA-256/);
    expect(film.verdict).toBe('ordinary');
    const zip = await fc.inspect(tempFile('b.zip', 'zz'), '');
    expect(zip.sha256).toBe(realCrypto.createHash('sha256').update('zz').digest('hex'));
    const exe = await fc.inspect(tempFile('a.lnk', 'L'), '');
    expect(exe.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('inspecting one', () => {
  it('reports the size, the source, the signer and the fingerprint', async () => {
    const p = tempFile('setup.exe', 'pretend installer');
    const out = await check().inspect(p, 'https://downloads.example.com/setup.exe');
    expect(out.verdict).toBe('signed');
    expect(out.signature).toEqual({ status: 'Valid', signer: 'Example Ltd', timestamped: false, why: '' });
    expect(out.sha256).toBe(realCrypto.createHash('sha256').update('pretend installer').digest('hex'));
    expect(out.lines[1]).toBe('Downloaded from downloads.example.com');
    expect(out.lines[2]).toBe('Signed by Example Ltd');
    expect(out.lines[3]).toContain(out.sha256);
  });

  it('reads whether the signature is timestamped (the release build requires it)', async () => {
    const fc = check({ execFile: (c, a, o, cb) => cb(null, 'Valid\nCN=Example Ltd, O=Example Ltd\nTrue') });
    expect(await fc.signature(tempFile('setup.exe'))).toEqual({ status: 'Valid', signer: 'Example Ltd', timestamped: true, why: '' });
  });

  it('an unsigned program says exactly that — it is the common case, not an accusation', async () => {
    const fc = check({ execFile: (c, a, o, cb) => cb(null, 'NotSigned\n') });
    const out = await fc.inspect(tempFile('tool.exe'), 'https://example.com/tool.exe');
    expect(out.verdict).toBe('unsigned');
    expect(out.lines[2]).toBe('Not signed — nobody has put their name to this file');
  });

  it('a signature that cannot be read is "unclear", never "safe"', async () => {
    const fc = check({ execFile: (c, a, o, cb) => cb(new Error('powershell missing')) });
    const out = await fc.inspect(tempFile('tool.exe'), '');
    expect(out.verdict).toBe('unclear');
    expect(out.lines[1]).toBe('No record of where this came from');
    expect(out.lines[2]).toMatch(/could not be checked/);
  });

  it('an ordinary file is not dressed up as a risk', async () => {
    const out = await check().inspect(tempFile('report.pdf'), 'https://example.com/report.pdf');
    expect(out.verdict).toBe('ordinary');
    expect(out.signature).toBe(null);
    expect(out.lines[2]).toBe('Not a program');
  });

  it('an archive says plainly that what is inside is not checked', async () => {
    const out = await check().inspect(tempFile('bundle.zip'), 'https://example.com/b.zip');
    expect(out.verdict).toBe('archive');
    expect(out.lines[2]).toMatch(/what is inside it is not checked/);
  });

  it('signatures are only claimed where they can be read', async () => {
    const fc = check({ platform: 'linux', execFile: () => { throw new Error('should not run'); } });
    const out = await fc.inspect(tempFile('thing.sh'), '');
    expect(out.signature).toMatchObject({ status: 'unknown', why: 'signatures are only read on Windows' });
    expect(out.verdict).toBe('unclear');
  });

  it('a file that has since been deleted says so', async () => {
    await expect(check().inspect('C:/nowhere/gone.exe', '')).rejects.toThrow(/not there any more/);
  });

  it('the file itself is never run to inspect it', async () => {
    const calls = [];
    const fc = check({ execFile: (cmd, args, o, cb) => { calls.push([cmd, args]); cb(null, 'Valid\nCN=X'); } });
    const p = tempFile('setup.exe');
    await fc.inspect(p, '');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatch(/powershell\.exe$/i);
    expect(calls[0][1].join(' ')).toContain('Get-AuthenticodeSignature');
    expect(calls[0][1].join(' ')).not.toMatch(/Start-Process|Invoke-Item/);
  });
});
