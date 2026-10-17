// T3-010 (Wave 6): the file list of a .rar and a .7z, read from the headers in plain JavaScript.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const A = require('../../src/main/archive-list.js');
const { inspectFile } = require('../../src/main/file-content-check.js');

const FX = path.resolve(__dirname, '../fixtures/archives');
const fx = (name) => fs.readFileSync(path.join(FX, name));
const list = (buf, kind) => A.listArchive(A.bufferReader(buf), kind);

// ---- RAR builders (from the published formats) ----------------------------------------------------------------
const vint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const RAR5 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]);
function rar5Block(type, fields = Buffer.alloc(0), dataSize = 0) {
  const body = Buffer.concat([vint(type), vint(dataSize ? 2 : 0), ...(dataSize ? [vint(dataSize)] : []), fields]);
  const size = vint(body.length);
  const crc = Buffer.alloc(4); crc.writeUInt32LE(A.crc32(Buffer.concat([size, body])));
  return Buffer.concat([crc, size, body, Buffer.alloc(dataSize, 0x61)]);
}
function rar5File(name, size, { dir = false, packed = 5 } = {}) {
  const nameBuf = Buffer.from(name, 'utf8');
  const fields = Buffer.concat([vint(dir ? 1 : 0), vint(size), vint(0x20), vint(0), vint(0), vint(nameBuf.length), nameBuf]);
  return rar5Block(2, fields, dir ? 0 : packed);
}
const rar5 = (...blocks) => Buffer.concat([RAR5, rar5Block(1, Buffer.concat([vint(0)])), ...blocks, rar5Block(5, vint(0))]);

const RAR4 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]);
function rar4Head(type, flags, rest) {
  const h = Buffer.alloc(7); h[2] = type; h.writeUInt16LE(flags, 3); h.writeUInt16LE(7 + rest.length, 5);
  return Buffer.concat([h, rest]);
}
function rar4File(name, size, { packed = 4, dir = false, wide = false } = {}) {
  const nameBuf = Buffer.from(name, 'latin1');
  const fixed = Buffer.alloc(25);
  fixed.writeUInt32LE(dir ? 0 : packed, 0); fixed.writeUInt32LE(size, 4); fixed.writeUInt16LE(nameBuf.length, 19);
  const flags = 0x8000 | (dir ? 0xE0 : 0) | (wide ? 0x100 : 0);
  const hi = wide ? Buffer.alloc(8) : Buffer.alloc(0);
  return Buffer.concat([rar4Head(0x74, flags, Buffer.concat([fixed, hi, nameBuf])), Buffer.alloc(dir ? 0 : packed, 0x62)]);
}
const rar4 = (...blocks) => Buffer.concat([RAR4, rar4Head(0x73, 0, Buffer.alloc(6)), ...blocks, rar4Head(0x7B, 0, Buffer.alloc(0))]);

describe('RAR 5', () => {
  it('lists names and unpacked sizes, folders marked, skipping the data between headers', () => {
    const r = list(rar5(rar5File('docs', 0, { dir: true }), rar5File('docs/türkçe.txt', 1234), rar5File('setup.exe', 99999, { packed: 40 })), 'rar');
    expect(r).toMatchObject({ ok: true, format: 'rar5', encrypted: false, truncated: false });
    expect(r.entries).toEqual([
      { name: 'docs', size: 0, dir: true },
      { name: 'docs/türkçe.txt', size: 1234, dir: false },
      { name: 'setup.exe', size: 99999, dir: false },
    ]);
  });
  it('says so when the headers are encrypted, and does not guess', () => {
    const r = list(Buffer.concat([RAR5, rar5Block(4, Buffer.concat([vint(0), Buffer.alloc(20)]))]), 'rar');
    expect(r).toMatchObject({ ok: true, encrypted: true, entries: [] });
    expect(r.note).toMatch(/password/);
  });
  it('refuses a header that fails its checksum or a file cut short, without throwing', () => {
    const good = rar5(rar5File('a.txt', 3));
    const bad = Buffer.from(good); bad[RAR5.length + 8 + 8] ^= 0xFF;
    expect(list(bad, 'rar')).toMatchObject({ ok: false, error: expect.stringMatching(/checksum|damaged|cannot be right/) });
    expect(list(good.subarray(0, RAR5.length + 20), 'rar')).toMatchObject({ ok: false, error: expect.stringMatching(/ends in the middle/) });
  });
  it('keeps to the entry limit and says it stopped', () => {
    const many = [];
    for (let i = 0; i < A.MAX_ENTRIES + 3; i++) many.push(rar5File('f' + i, 1, { packed: 0 }));
    const r = list(rar5(...many), 'rar');
    expect(r.entries).toHaveLength(A.MAX_ENTRIES);
    expect(r.truncated).toBe(true);
  });
});

describe('RAR 1.5-4.x', () => {
  it('lists names and sizes, folders marked, including the long-size form of a header', () => {
    const r = list(rar4(rar4File('docs\\readme.txt', 1000), rar4File('data', 0, { dir: true }), rar4File('big.iso', 5, { wide: true })), 'rar');
    expect(r).toMatchObject({ ok: true, format: 'rar4', encrypted: false });
    expect(r.entries.map(e => [e.name, e.size, e.dir])).toEqual([['docs/readme.txt', 1000, false], ['data', 0, true], ['big.iso', 5, false]]);
  });
  it('says so when the headers are encrypted', () => {
    const r = list(Buffer.concat([RAR4, rar4Head(0x73, 0x0080, Buffer.alloc(6))]), 'rar');
    expect(r).toMatchObject({ ok: true, encrypted: true, entries: [] });
  });
});

describe('7z', () => {
  it('lists an archive whose header 7-Zip compressed with LZMA (the default), with names, sizes and folders', () => {
    const r = list(fx('default.7z'), '7z');
    expect(r).toMatchObject({ ok: true, format: '7z', encrypted: false, truncated: false });
    expect(r.entries).toHaveLength(126);
    const by = Object.fromEntries(r.entries.map(e => [e.name, e]));
    expect(by['setup.exe']).toEqual({ name: 'setup.exe', size: 3004, dir: false });
    expect(by['docs/notes türkçe.txt'].size).toBe(3002);
    expect(by['docs/empty.txt']).toEqual({ name: 'docs/empty.txt', size: 0, dir: false });
    expect(by['empty-dir'].dir).toBe(true);
    expect(by['docs'].dir).toBe(true);
    expect(by['docs/chapter-120-part.txt'].size).toBeGreaterThan(0);
  });
  it('gives the same list from an archive with a plain header, which is the check on the LZMA decoder', () => {
    const lz = list(fx('default.7z'), '7z');
    const plain = list(fx('plainheader.7z'), '7z');
    expect(plain.ok).toBe(true);
    expect(lz.entries).toEqual(plain.entries);
  });
  it('says so when even the names are encrypted', () => {
    expect(list(fx('hdrenc.7z'), '7z')).toMatchObject({ ok: true, encrypted: true, entries: [] });
  });
  it('refuses a damaged start header, a damaged header and a cut-off file', () => {
    const good = fx('default.7z');
    const bad1 = Buffer.from(good); bad1[14] ^= 1;
    expect(list(bad1, '7z')).toMatchObject({ ok: false, error: expect.stringMatching(/start header failed its checksum/) });
    const bad2 = Buffer.from(good); bad2[good.length - 3] ^= 1;
    expect(list(bad2, '7z')).toMatchObject({ ok: false, error: expect.stringMatching(/header failed its checksum/) });
    expect(list(good.subarray(0, good.length - 30), '7z').ok).toBe(false);
  });
  it('decodes LZMA straight from a 7-Zip header stream, and refuses damaged input with an error', () => {
    const good = fx('default.7z');
    const tail = good.subarray(32 + Number(good.readBigUInt64LE(12)));
    expect(tail[0]).toBe(0x17);
    expect(() => A.lzmaDecode(Buffer.from([0x5D, 0, 0, 1, 0]), Buffer.from([1, 2, 3]), 10)).toThrow(/not valid|ends early/);
    expect(() => A.lzmaDecode(Buffer.from([255, 0, 0, 1, 0]), Buffer.from([0, 0, 0, 0, 0]), 10)).toThrow(/properties/);
  });
});

describe('the answer for anything else', () => {
  it('says plainly what it lists, and never throws', () => {
    expect(A.listArchive(A.bufferReader(Buffer.from('hello')), 'tar')).toMatchObject({ ok: false });
    expect(A.listArchive(A.bufferReader(Buffer.from('hello world, not an archive')), 'rar').ok).toBe(false);
    expect(A.listArchive(A.bufferReader(Buffer.from('hello world, not an archive, no')), '7z').ok).toBe(false);
  });
});

describe('the file check uses the list', () => {
  let dir;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });
  const check = (name, bytes) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclist-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    return inspectFile({ fs, file, name });
  };
  it('flags a program dressed as a document inside a .7z', () => {
    const r = check('download.7z', fx('decoy.7z'));
    expect(r.detected).toBe('7z');
    expect(r.findings.map(f => f.kind)).toContain('double-extension');
    expect(r.findings.find(f => f.kind === 'double-extension').text).toContain('Inside the archive');
  });
  it('flags a program that is the only thing in a .rar', () => {
    const r = check('tool.rar', rar5(rar5File('setup.exe', 5000)));
    expect(r.findings.map(f => f.kind)).toContain('single-program');
  });
  it('says a locked list is locked', () => {
    const r = check('hidden.7z', fx('hdrenc.7z'));
    expect(r.findings.map(f => f.kind)).toContain('locked-names');
    expect(r.note).toMatch(/names/);
  });
  it('a plain archive of ordinary files raises nothing', () => {
    const r = check('files.7z', fx('plainheader.7z'));
    expect(r.checked).toBe(true);
    expect(r.findings.filter(f => f.level === 'high')).toEqual([]);
  });
});
