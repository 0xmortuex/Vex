// Windows code signing, ready to switch on with environment variables
// (scripts/code-signing.js; RELEASING.md "Turn on code signing").
//
// Vex ships unsigned until the owner buys a certificate. With nothing set the
// build must be exactly what it was; with a certificate set every .exe, the
// installer and its uninstaller must come out signed and timestamped, and the
// Widevine (VMP) signature must be made AFTER the Authenticode one, because
// castLabs hashes the whole Vex.exe (vmp-resign.py, hash_pe0).

import { describe, it, expect } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '../..');
const pkg = require('../../package.json');
const signing = require('../../scripts/code-signing.js');
const { setupFromEnv, problemsWith, checkSigned } = signing;

const AZURE = {
  VEX_AZURE_SIGN_ENDPOINT: 'https://weu.codesigning.azure.net', VEX_AZURE_SIGN_ACCOUNT: 'vex', VEX_AZURE_SIGN_PROFILE: 'public',
  VEX_WIN_PUBLISHER: 'Fadi Raad', AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's',
};

describe('which signing the environment asks for', () => {
  it('nothing set: unsigned, and the build config is what package.json had before', () => {
    const s = setupFromEnv({});
    expect(s.mode).toBe('none');
    expect(s.win).toEqual({ signtoolOptions: { publisherName: '0xmortuex' } });
    expect(signing.describe(s)).toMatch(/^\[Sign\] unsigned build/);
  });

  it('a .pfx through CSC_LINK or WIN_CSC_LINK (electron-builder reads it itself), SHA-256 only', () => {
    for (const key of ['CSC_LINK', 'WIN_CSC_LINK']) {
      const s = setupFromEnv({ [key]: 'C:\\certs\\vex.pfx' });
      expect(s.mode).toBe('pfx');
      expect(s.win.signtoolOptions).toEqual({ signingHashAlgorithms: ['sha256'] });
    }
    expect(setupFromEnv({ CSC_LINK: 'x.pfx', VEX_WIN_PUBLISHER: 'Fadi Raad' }).win.signtoolOptions.publisherName).toBe('Fadi Raad');
  });

  it('a certificate in the Windows store (hardware token, cloud card) by thumbprint', () => {
    const s = setupFromEnv({ VEX_WIN_CERT_SHA1: 'ab cd ef 01 23 45 67 89 ab cd ef 01 23 45 67 89 ab cd ef 01' });
    expect(s.mode).toBe('store');
    expect(s.win.signtoolOptions.certificateSha1).toBe('ABCDEF0123456789ABCDEF0123456789ABCDEF01');
    expect(() => setupFromEnv({ VEX_WIN_CERT_SHA1: 'not-a-thumbprint' })).toThrow(/40-character/);
  });

  it('Azure Trusted Signing, only when every value is there', () => {
    const s = setupFromEnv(AZURE);
    expect(s.mode).toBe('azure');
    expect(s.win.azureSignOptions).toEqual({ endpoint: AZURE.VEX_AZURE_SIGN_ENDPOINT, codeSigningAccountName: 'vex', certificateProfileName: 'public', publisherName: 'Fadi Raad' });
    const { AZURE_CLIENT_SECRET: _drop, ...half } = AZURE;
    expect(() => setupFromEnv(half)).toThrow(/half set up; missing AZURE_CLIENT_SECRET/);
    expect(() => setupFromEnv({ VEX_AZURE_SIGN_ENDPOINT: 'x' })).toThrow(/VEX_AZURE_SIGN_ACCOUNT/);
  });

  it('two methods at once is an error, not a guess', () => {
    expect(() => setupFromEnv({ CSC_LINK: 'a.pfx', VEX_WIN_CERT_SHA1: 'A'.repeat(40) })).toThrow(/more than one signing method/);
    expect(() => setupFromEnv({ ...AZURE, WIN_CSC_LINK: 'a.pfx' })).toThrow(/more than one signing method/);
  });

  it('blank values count as not set', () => {
    expect(setupFromEnv({ CSC_LINK: '', VEX_WIN_CERT_SHA1: '  ' }).mode).toBe('none');
  });
});

describe('the electron-builder config', () => {
  it('package.json loads the signing options from scripts/code-signing.js and holds none itself', () => {
    expect(pkg.build.extends).toBe('./scripts/code-signing.js');
    expect(pkg.build.win.signtoolOptions).toBeUndefined();
    expect(pkg.build.win.azureSignOptions).toBeUndefined();
  });

  it('a configured build refuses to leave any file unsigned; an unsigned one is unchanged', () => {
    const run = (env) => {
      const saved = process.env;
      process.env = env;
      const log = console.log;
      const lines = [];
      console.log = (...a) => lines.push(a.join(' '));
      try { return { cfg: signing(), lines }; } finally { process.env = saved; console.log = log; }
    };
    const unsigned = run({});
    expect(unsigned.cfg).toEqual({ win: { signtoolOptions: { publisherName: '0xmortuex' } } });
    expect(unsigned.lines).toEqual(['[Sign] unsigned build: no code-signing certificate configured (RELEASING.md, "Turn on code signing")']);
    const signed = run({ CSC_LINK: 'x.pfx' });
    expect(signed.cfg.forceCodeSigning).toBe(true);
    expect(signed.lines[0]).toMatch(/code signing ON: certificate file \(CSC_LINK\)/);
  });

  it('VMP signing runs as afterSign, after electron-builder has Authenticode-signed the .exe files', () => {
    expect(pkg.build.afterSign).toBe('scripts/vmp-sign.js');
    expect(pkg.build.afterPack).toBeUndefined();
    const src = fs.readFileSync(path.join(root, 'scripts/vmp-sign.js'), 'utf8');
    // The Authenticode check comes before the castLabs call, and Vex.exe is
    // compared byte for byte across the VMP step.
    expect(src.indexOf("requireAuthenticode(exe, setup, 'before VMP signing')")).toBeGreaterThan(0);
    expect(src.indexOf("requireAuthenticode(exe, setup, 'before VMP signing')")).toBeLessThan(src.indexOf('castlabs_evs.vmp sign-pkg'));
    expect(src).toMatch(/sha256\(exe\) !== exeBefore/);
  });

  it('verify-signing passes an unsigned build without looking at it, and refuses test certificates for a release', async () => {
    const { main } = require('../../scripts/verify-signing.js');
    const log = console.log;
    const lines = [];
    console.log = (...a) => lines.push(a.join(' '));
    try {
      expect(await main(['--dir', 'no-such-folder', '--release'], {})).toBe(true);
      await expect(main(['--dir', 'no-such-folder', '--release'], { CSC_LINK: 'x.pfx', VEX_SIGN_ALLOW_UNTRUSTED: '1' })).rejects.toThrow(/for test builds/);
      await expect(main(['--dir', 'no-such-folder'], { CSC_LINK: 'x.pfx' })).rejects.toThrow(/no win-unpacked folder/);
    } finally { console.log = log; }
    expect(lines[0]).toMatch(/unsigned build.*nothing to verify/);
  });

  it('the publish pipeline checks the signatures before anything is uploaded', () => {
    const steps = pkg.scripts.publish.split('&&').map(s => s.trim());
    const build = steps.findIndex(s => s.includes('electron-builder'));
    const verify = steps.indexOf('node scripts/verify-signing.js --release');
    const ensure = steps.findIndex(s => s.includes('ensure-release'));
    expect(verify).toBeGreaterThan(build);
    expect(verify).toBeLessThan(ensure);
  });
});

describe('checking a signature', () => {
  const pfx = setupFromEnv({ CSC_LINK: 'x.pfx', VEX_WIN_PUBLISHER: 'Fadi Raad' });
  const good = { status: 'Valid', signer: 'Fadi Raad', timestamped: true };

  it('a valid, timestamped signature by the expected name passes', () => {
    expect(problemsWith('Vex.exe', good, pfx)).toEqual([]);
  });

  it('unsigned, tampered, unreadable, untimestamped or the wrong signer each fail', () => {
    expect(problemsWith('Vex.exe', { status: 'NotSigned', signer: '' }, pfx)).toEqual(['Vex.exe: NOT SIGNED']);
    expect(problemsWith('Vex.exe', { status: 'HashMismatch', signer: 'Fadi Raad' }, pfx)[0]).toMatch(/changed after signing/);
    expect(problemsWith('Vex.exe', { status: 'unknown', signer: '', why: 'the signature could not be read' }, pfx)[0]).toMatch(/could not be read/);
    expect(problemsWith('Vex.exe', { ...good, timestamped: false }, pfx)[0]).toMatch(/no timestamp/);
    expect(problemsWith('Vex.exe', { ...good, signer: 'Someone Else' }, pfx)[0]).toMatch(/expected "Fadi Raad"/);
  });

  it('a self-signed test certificate passes only with VEX_SIGN_ALLOW_UNTRUSTED=1', () => {
    const selfSigned = { status: 'UnknownError', signer: 'Fadi Raad', timestamped: true };
    expect(problemsWith('Vex.exe', selfSigned, pfx)[0]).toMatch(/status is UnknownError, not Valid/);
    const test = setupFromEnv({ CSC_LINK: 'x.pfx', VEX_WIN_PUBLISHER: 'Fadi Raad', VEX_SIGN_ALLOW_UNTRUSTED: '1' });
    expect(problemsWith('Vex.exe', selfSigned, test)).toEqual([]);
    expect(problemsWith('Vex.exe', { ...selfSigned, status: 'NotSigned' }, test)).toEqual(['Vex.exe: NOT SIGNED']);
  });

  it('an offline build (no timestamp server) is not failed for the missing timestamp', () => {
    expect(problemsWith('Vex.exe', { ...good, timestamped: false }, pfx, { offline: true })).toEqual([]);
  });

  it('every file is read, a missing one fails, and two different signers fail', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sign-'));
    try {
      const a = path.join(dir, 'Vex.exe'), b = path.join(dir, 'Vex-Setup.exe');
      fs.writeFileSync(a, 'a'); fs.writeFileSync(b, 'b');
      const setup = setupFromEnv({ CSC_LINK: 'x.pfx' });
      const sigs = { [a]: good, [b]: { ...good, signer: 'Other' } };
      const r = await checkSigned([{ name: 'Vex.exe', file: a }, { name: 'Vex-Setup.exe', file: b }, { name: 'gone.exe', file: path.join(dir, 'gone.exe') }], setup, async f => sigs[f]);
      expect(r.ok).toBe(false);
      expect(r.lines).toEqual(['  Vex.exe: Valid — Fadi Raad, timestamped', '  Vex-Setup.exe: Valid — Other, timestamped']);
      expect(r.problems.join('\n')).toMatch(/gone\.exe: missing/);
      expect(r.problems.join('\n')).toMatch(/signed by different names: Fadi Raad, Other/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
