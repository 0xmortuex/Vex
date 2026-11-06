// @vitest-environment node
// Compare a download with the published checksum: the pure parser/comparison, then the streamed check on real temp files.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseExpected, sameChecksum, algorithmName } = require('../../src/main/checksum-compare.js');
const { createDownloadPeek } = require('../../src/main/download-peek.js');

const sha = (alg, data) => crypto.createHash(alg).update(data).digest('hex');
const EMPTY = { md5: 'd41d8cd98f00b204e9800998ecf8427e', sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  sha512: 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e' };

describe('algorithm from the length', () => {
  for (const [alg, hex] of Object.entries(EMPTY)) {
    it(alg + ' is ' + hex.length + ' digits', () => {
      expect(parseExpected(hex)).toEqual({ ok: true, algorithm: alg, expected: hex, name: null });
    });
  }
  it('other lengths are refused with the lengths Vex does handle', () => {
    for (const n of [31, 33, 39, 41, 63, 65, 127, 129]) {
      const r = parseExpected('a'.repeat(n));
      expect(r.ok, String(n)).toBe(false);
      expect(r.error).toMatch(/MD5 \(32 digits\), SHA-1 \(40\), SHA-256 \(64\) and SHA-512 \(128\)/);
    }
    expect(parseExpected('a'.repeat(56)).error).toMatch(/SHA-224/);
    expect(parseExpected('a'.repeat(96)).error).toMatch(/SHA-384/);
  });
});

describe('the many shapes people paste', () => {
  const H = EMPTY.sha256;
  it('case does not matter, and the answer is lower case', () => {
    expect(parseExpected(H.toUpperCase()).expected).toBe(H);
    expect(parseExpected('E3b0C44298Fc1C149afbf4c8996fb92427ae41e4649b934ca495991b7852b855').expected).toBe(H);
  });
  it('surrounding whitespace, tabs, newlines and a BOM are ignored', () => {
    expect(parseExpected('  \t' + H + ' \r\n\r\n').expected).toBe(H);
    expect(parseExpected('\uFEFF' + H).expected).toBe(H);
  });
  it('a grouped value (spaces, colons or dashes between groups)', () => {
    const grouped = H.match(/.{8}/g);
    expect(parseExpected(grouped.join(' ')).expected).toBe(H);
    expect(parseExpected(grouped.join(':')).expected).toBe(H);
    expect(parseExpected(grouped.join('-')).expected).toBe(H);
    expect(parseExpected(H.match(/.{2}/g).join(' ')).expected).toBe(H);
    expect(parseExpected(EMPTY.sha512.match(/.{16}/g).join(' ')).algorithm).toBe('sha512');
  });
  it('a sha256sum line, binary (*) or text mode, with a path or spaces in the name', () => {
    expect(parseExpected(H + ' *setup.exe')).toMatchObject({ ok: true, expected: H, name: 'setup.exe' });
    expect(parseExpected(H + '  setup.exe')).toMatchObject({ ok: true, expected: H, name: 'setup.exe' });
    expect(parseExpected(H + '  My Program 1.2 setup.exe')).toMatchObject({ name: 'My Program 1.2 setup.exe' });
    expect(parseExpected('\\' + H + ' *odd\\\\name.exe').ok).toBe(true);
    expect(parseExpected(EMPTY.md5 + '  a.iso')).toMatchObject({ algorithm: 'md5', name: 'a.iso' });
  });
  it('BSD style and sha256: prefixes', () => {
    expect(parseExpected('SHA256 (setup.exe) = ' + H)).toMatchObject({ ok: true, algorithm: 'sha256', expected: H, name: 'setup.exe' });
    expect(parseExpected('MD5 (a b.zip) = ' + EMPTY.md5)).toMatchObject({ algorithm: 'md5', name: 'a b.zip' });
    expect(parseExpected('sha256:' + H)).toMatchObject({ ok: true, algorithm: 'sha256', expected: H });
    expect(parseExpected('SHA-256: ' + H.toUpperCase())).toMatchObject({ ok: true, expected: H });
  });
  it('the Get-FileHash table and list output', () => {
    const table = 'Algorithm       Hash                                                                   Path\r\n---------       ----                                                                   ----\r\nSHA256          ' + H.toUpperCase() + '       C:\\Users\\me\\Downloads\\setup.exe\r\n';
    expect(parseExpected(table)).toMatchObject({ ok: true, algorithm: 'sha256', expected: H, name: 'setup.exe' });
    const list = '\r\nAlgorithm : SHA256\r\nHash      : ' + H.toUpperCase() + '\r\nPath      : C:\\Users\\me\\Downloads\\setup.exe\r\n';
    expect(parseExpected(list)).toMatchObject({ ok: true, algorithm: 'sha256', expected: H, name: 'setup.exe' });
    expect(parseExpected('SHA512    ' + EMPTY.sha512.toUpperCase() + '   C:\\a.iso').algorithm).toBe('sha512');
  });
  it('a sentence with one checksum in it', () => {
    expect(parseExpected('The SHA-256 checksum of the installer is ' + H + ' (verify it).').expected).toBe(H);
    expect(parseExpected('Checksum: ' + H + '.').ok).toBe(true);
  });
  it('a list of checksums: the line for this file wins; otherwise it asks for one', () => {
    const other = EMPTY.sha256.replace(/^e3/, 'aa');
    const list = other + ' *other.exe\n' + H + ' *setup.exe\n';
    expect(parseExpected(list, { fileName: 'setup.exe' }).expected).toBe(H);
    expect(parseExpected(list, { fileName: 'SETUP.EXE' }).expected).toBe(H);
    const r = parseExpected(list, { fileName: 'unrelated.exe' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/more than one checksum.*unrelated\.exe/);
    expect(parseExpected(list).ok).toBe(false);
    // the same value twice is not ambiguous
    expect(parseExpected(H + '\n' + H).expected).toBe(H);
  });
});

describe('malformed input is refused, never guessed at', () => {
  it('empty, whitespace, non-strings', () => {
    for (const v of ['', '   ', '\n\n', null, undefined, 42, {}, []]) {
      const r = parseExpected(v);
      expect(r.ok, String(v)).toBe(false);
      expect(r.error).toMatch(/Paste the checksum/);
    }
  });
  it('words and punctuation', () => {
    for (const v of ['hello', 'not a checksum at all', '12345', '----', '0x' + 'a'.repeat(64)]) expect(parseExpected(v).ok, v).toBe(false);
  });
  it('non-hex characters in a right-length value', () => {
    expect(parseExpected('g'.repeat(64)).ok).toBe(false);
    expect(parseExpected(EMPTY.sha256.slice(0, 63) + 'z').ok).toBe(false);
  });
  it('a declared algorithm that disagrees with the length', () => {
    const r = parseExpected('SHA256: ' + EMPTY.sha512);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/It says SHA-256 but the value is 128 digits long, which is SHA-512/);
    expect(parseExpected('Algorithm : MD5\nHash : ' + EMPTY.sha256).ok).toBe(false);
  });
  it('a paste that is far too long', () => {
    expect(parseExpected('a'.repeat(30000)).error).toMatch(/too long/);
  });
  it('control characters and NUL bytes do not get through', () => {
    expect(parseExpected(EMPTY.sha256.slice(0, 30) + '\0' + EMPTY.sha256.slice(30)).ok).toBe(false);
    expect(parseExpected('\0\0\0').ok).toBe(false);
  });
  it('two different checksums with no names are refused as ambiguous', () => {
    expect(parseExpected(EMPTY.sha256 + '\n' + EMPTY.sha256.replace(/^e3/, 'aa')).ok).toBe(false);
  });
  it('every refusal carries a template and its values for translation', () => {
    const r = parseExpected('a'.repeat(40 + 3));
    expect(r.template).toBe('That is {1} digits long. Vex compares MD5 (32 digits), SHA-1 (40), SHA-256 (64) and SHA-512 (128).');
    expect(r.args).toEqual([43]);
  });
});

describe('sameChecksum', () => {
  it('ignores case and whitespace, and never matches empty values', () => {
    expect(sameChecksum('ABCDEF', 'abcdef')).toBe(true);
    expect(sameChecksum(' ab cd\nef ', 'ABCDEF')).toBe(true);
    expect(sameChecksum('abcdef', 'abcdee')).toBe(false);
    expect(sameChecksum('abcdef', 'abcde')).toBe(false);
    expect(sameChecksum('', '')).toBe(false);
    expect(sameChecksum(null, undefined)).toBe(false);
  });
  it('algorithmName', () => {
    expect(algorithmName('SHA-256')).toBe('sha256');
    expect(algorithmName('sha_1')).toBe('sha1');
    expect(algorithmName('SHA384')).toBeNull();
    expect(algorithmName(undefined)).toBeNull();
  });
});

describe('the streamed comparison on real files (Match / Mismatch / cancel)', () => {
  let dir; const known = new Set();
  const make = (extra = {}) => createDownloadPeek({ fs: extra.fs || fs, path, crypto, isDownloadedFile: (p) => known.has(p), listArchive: async () => ({ ok: true, count: 0, entries: [] }), openZip: () => ({}), validateZip: () => {} });
  const file = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, data); known.add(p); return p; };
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sum-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('Match for each of the four algorithms, whatever the case or the line it came in', async () => {
    const data = Buffer.from('the quick brown fox');
    const p = file('fox.bin', data);
    for (const alg of ['md5', 'sha1', 'sha256', 'sha512']) {
      const h = sha(alg, data);
      for (const pasted of [h, h.toUpperCase(), ' ' + h + ' \n', h + ' *fox.bin']) {
        const r = await make().verify(p, pasted, { token: 't' + alg });
        expect(r, alg + pasted.length).toMatchObject({ ok: true, match: true, algorithm: alg, actual: h, size: data.length });
      }
    }
  });
  it('Mismatch says both values', async () => {
    const p = file('m.bin', 'abc');
    const wrong = sha('sha256', 'abd');
    const r = await make().verify(p, wrong, { token: 'm1' });
    expect(r).toMatchObject({ ok: true, match: false, algorithm: 'sha256', expected: wrong, actual: sha('sha256', 'abc'), label: 'SHA-256' });
  });
  it('a bad paste is refused before the file is read', async () => {
    const p = file('b.bin', 'abc');
    let opened = 0;
    const spyFs = { ...fs, createReadStream: (...a) => { opened++; return fs.createReadStream(...a); }, lstatSync: fs.lstatSync };
    const r = await make({ fs: spyFs }).verify(p, 'nonsense', { token: 'b1' });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/does not look like a checksum/);
    expect(opened).toBe(0);
  });
  it('only a file Vex downloaded, and needs a token', async () => {
    const stranger = path.join(dir, 'stranger.bin'); fs.writeFileSync(stranger, 'x');
    await expect(make().verify(stranger, EMPTY.sha256, { token: 's' })).rejects.toThrow(/only files Vex downloaded/);
    const p = file('t.bin', 'x');
    await expect(make().verify(p, EMPTY.sha256, {})).rejects.toThrow(/token/);
  });
  it('reads in chunks (never the whole file at once) and reports progress; a big file matches', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 7);
    const p = file('big.bin', big);
    const reads = [];
    const progress = [];
    const spyFs = { ...fs, readFileSync: () => { throw new Error('the whole file must not be read'); }, createReadStream: (f, o) => { const s = fs.createReadStream(f, { highWaterMark: 64 * 1024, ...o }); s.on('data', (c) => reads.push(c.length)); return s; }, lstatSync: fs.lstatSync };
    const r = await make({ fs: spyFs }).verify(p, sha('sha256', big), { token: 'big', onProgress: (x) => progress.push(x) });
    expect(r).toMatchObject({ ok: true, match: true });
    expect(Math.max(...reads)).toBeLessThanOrEqual(64 * 1024);
    expect(reads.length).toBeGreaterThan(50);
    expect(progress.at(-1)).toEqual({ read: big.length, total: big.length });
  });
  it('can be cancelled by token mid-way, and the token is free again afterwards', async () => {
    const big = Buffer.alloc(20 * 1024 * 1024, 1);
    const p = file('cancel.bin', big);
    const peek = make();
    let cancelled = false;
    const run = peek.verify(p, sha('sha256', big), { token: 'c1', onProgress: () => { if (!cancelled) { cancelled = true; expect(peek.cancel('c1')).toEqual({ ok: true, running: true }); } } });
    const r = await run;
    expect(r).toEqual({ ok: false, canceled: true });
    expect(peek.cancel('c1')).toEqual({ ok: true, running: false });
    const again = await peek.verify(p, sha('sha256', big), { token: 'c1' });
    expect(again).toMatchObject({ ok: true, match: true });
  });
  it('a second comparison with a token in use is refused', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 2);
    const p = file('dup.bin', big);
    const peek = make();
    const first = peek.verify(p, sha('sha256', big), { token: 'same' });
    await expect(peek.verify(p, sha('sha256', big), { token: 'same' })).rejects.toThrow(/already running/);
    expect((await first).ok).toBe(true);
  });
  it('a read error is reported, not swallowed', async () => {
    const p = file('err.bin', 'abc');
    const { Readable } = require('stream');
    const spyFs = { ...fs, createReadStream: () => new Readable({ read() { this.destroy(new Error('disk gone')); } }), lstatSync: fs.lstatSync };
    await expect(make({ fs: spyFs }).verify(p, sha('sha256', 'abc'), { token: 'e1' })).rejects.toThrow(/disk gone/);
  });
});

describe('wiring', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('main, schemas, policy and preload all know the two channels', () => {
    expect(read('src/main.js')).toMatch(/ipcMain\.handle\('downloads:checksum', async \(e, filePath, pasted, token\)/);
    expect(read('src/main.js')).toMatch(/ipcMain\.handle\('downloads:checksum-cancel'/);
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('downloads:checksum', \[string\(4096\), string\(20000\), string\(64\)\]\)/);
    expect(read('src/main/ipc-policy.js')).toMatch(/'downloads:checksum', 'downloads:checksum-cancel'/);
    expect(read('src/preload.js')).toMatch(/downloadsChecksum:/);
  });
});
