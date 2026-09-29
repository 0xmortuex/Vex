// src/main/file-check.js — the downloaded file's name is the site's choice, so
// it must never become PowerShell code. It used to sit inside a double-quoted
// string in the script, where PowerShell runs $(…) (found 2026-09-29).

import { describe, it, expect } from 'vitest';
const realFs = require('fs');
const realCrypto = require('crypto');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createFileCheck } = require('../../src/main/file-check.js');

const HOSTILE = 'setup$(exit 7)`$x";.exe';

function tempFile(name, contents = 'MZ not really') {
  const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'vex-fc-'));
  const p = path.join(dir, name);
  realFs.writeFileSync(p, contents);
  return p;
}

describe('the file name is data, never script', () => {
  it('keeps the path out of the script text and hands it over in the environment', async () => {
    let seen;
    const fc = createFileCheck({
      fs: realFs, crypto: realCrypto, platform: 'win32',
      execFile: (cmd, args, opts, cb) => { seen = { args, opts }; cb(null, 'NotSigned\n'); },
    });
    const p = 'C:/Downloads/' + HOSTILE;
    await fc.signature(p);
    const script = seen.args[seen.args.length - 1];
    expect(script).not.toContain('exit 7');
    expect(script).not.toContain(HOSTILE);
    expect(script).toContain('$env:VEX_FILECHECK_PATH');
    expect(seen.opts.env.VEX_FILECHECK_PATH).toBe(p);
  });

  // The real thing: if PowerShell ran the name, "$(exit 7)" would end the
  // script with code 7 and the check would fail; read as data, the file is
  // simply not signed (a .ps1, since a fake .exe reads as UnknownError). The
  // double quote cannot be in a Windows file name, so the on-disk name drops it.
  it.runIf(process.platform === 'win32')('real PowerShell reads a hostile name as a file name', async () => {
    const p = tempFile('setup$(exit 7)`$x;.ps1', 'Write-Output 1');
    const fc = createFileCheck({ fs: realFs, crypto: realCrypto, execFile, platform: 'win32' });
    const sig = await fc.signature(p);
    expect(sig.status).toBe('NotSigned');
  }, 20000);
});
