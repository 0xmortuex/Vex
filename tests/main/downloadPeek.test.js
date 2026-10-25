// Quick look at a download: what main will read, and what it refuses (src/main/download-peek.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { createDownloadPeek, kindOf, xmlText, TEXT_CAP } = require('../../src/main/download-peek');

let dir; const known = new Set();
const file = (name, data) => { const p = path.join(dir, name); fs.writeFileSync(p, data); known.add(p); return p; };
const make = (extra = {}) => createDownloadPeek({
  fs, path, crypto, isDownloadedFile: (p) => known.has(p),
  listArchive: async () => ({ ok: true, count: 2, entries: [{ name: 'a.txt', size: 3, dir: false }, { name: 'd/', size: 0, dir: true }] }),
  openZip: (f) => new AdmZip(f), validateZip: () => {}, ...extra,
});

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-peek-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('which files it will serve', () => {
  it('refuses a file Vex did not download, even an existing one', async () => {
    const p = path.join(dir, 'stranger.txt'); fs.writeFileSync(p, 'hi');
    await expect(make().peek(p)).rejects.toThrow(/only files Vex downloaded/);
    await expect(make().hash(p)).rejects.toThrow(/only files Vex downloaded/);
  });
  it('refuses relative paths, NUL bytes, non-strings and folders', async () => {
    const peek = make();
    await expect(peek.peek('notes.txt')).rejects.toThrow(/full file path/);
    await expect(peek.peek(path.join(dir, 'a\0b'))).rejects.toThrow(/not a file path/);
    await expect(peek.peek(42)).rejects.toThrow(/not a file path/);
    known.add(dir);
    await expect(peek.peek(dir)).rejects.toThrow(/not a file/);
  });
  it('says so when the file has gone', async () => {
    const p = file('gone.txt', 'x'); fs.unlinkSync(p);
    await expect(make().peek(p)).rejects.toThrow(/not there any more/);
  });
  it('does not follow a link', async () => {
    const target = file('real.txt', 'secret');
    const link = path.join(dir, 'link.txt');
    try { fs.symlinkSync(target, link); } catch { return; }          // no privilege to make links: nothing to test
    known.add(link);
    await expect(make().peek(link)).rejects.toThrow(/does not follow links/);
  });
});

describe('kinds', () => {
  it('names programs by every extension that can run, in any case', () => {
    for (const n of ['a.exe', 'a.MSI', 'a.bat', 'a.cmd', 'a.ps1', 'a.scr', 'a.lnk', 'a.jar', 'a.vbs', 'a.hta']) expect(kindOf(n)).toBe('program');
    expect(kindOf('a.png')).toBe('image'); expect(kindOf('a.pdf')).toBe('pdf'); expect(kindOf('a.7z')).toBe('archive');
    expect(kindOf('a.docx')).toBe('office'); expect(kindOf('a.mp3')).toBe('audio'); expect(kindOf('a.xyz')).toBe('other');
    expect(kindOf('noext')).toBe('other');
  });
  it('never reads a program: only its name, size and date come back', async () => {
    const p = file('setup.exe', 'MZ this would be a program');
    const reads = [];
    const spy = { ...fs, readFileSync: (...a) => { reads.push(a[0]); return fs.readFileSync(...a); }, openSync: (...a) => { reads.push(a[0]); return fs.openSync(...a); }, createReadStream: (...a) => { reads.push(a[0]); return fs.createReadStream(...a); } };
    const r = await make({ fs: spy }).peek(p);
    expect(r).toMatchObject({ ok: true, kind: 'program', name: 'setup.exe', size: 26 });
    expect(r.bytes).toBeUndefined(); expect(r.text).toBeUndefined();
    expect(reads).toEqual([]);
  });
  it('a program named like a document is still a program, by its last extension', async () => {
    const p = file('invoice.pdf.exe', 'MZ');
    expect((await make().peek(p)).kind).toBe('program');
  });
});

describe('what it returns', () => {
  it('a picture and a PDF come back as bytes with a type, up to their cap', async () => {
    const p = file('a.png', Buffer.from([137, 80, 78, 71]));
    const r = await make().peek(p);
    expect(r.kind).toBe('image'); expect(r.mime).toBe('image/png'); expect(Buffer.from(r.bytes).length).toBe(4);
  });
  it('a file over its cap is not read at all', async () => {
    const p = file('big.png', Buffer.alloc(1024));
    const peek = make();
    // The cap is a module constant; a sparse file just over it avoids writing 20 MB.
    fs.truncateSync(p, 20 * 1024 * 1024 + 1);
    const r = await peek.peek(p);
    expect(r.tooBig).toBe(20 * 1024 * 1024); expect(r.bytes).toBeUndefined();
  });
  it('text is cut at 200 KB and flagged, a BOM is dropped', async () => {
    const p = file('big.log', '﻿' + 'x'.repeat(TEXT_CAP + 500));
    const r = await make().peek(p);
    expect(r.kind).toBe('text'); expect(r.truncated).toBe(true); expect(r.text.startsWith('x')).toBe(true);
    expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(TEXT_CAP);
  });
  it('a "text" file with NUL bytes is not shown as text', async () => {
    const p = file('fake.txt', Buffer.from([65, 0, 66, 0, 67]));
    const r = await make().peek(p);
    expect(r.kind).toBe('other'); expect(r.note).toBe('binary'); expect(r.text).toBeUndefined();
  });
  it('an archive comes back as names and sizes from the listing', async () => {
    const p = file('pack.zip', 'PK');
    const r = await make().peek(p);
    expect(r.kind).toBe('archive'); expect(r.count).toBe(2); expect(r.entries[0]).toEqual({ name: 'a.txt', size: 3, dir: false });
  });
  it('a listing that fails is reported, not thrown', async () => {
    const p = file('bad.zip', 'PK');
    const r = await make({ listArchive: async () => ({ ok: false, error: 'that file could not be read as a .zip' }) }).peek(p);
    expect(r.listError).toMatch(/could not be read/);
  });
  it('a .docx gives its first text; an unreadable one gives an error line', async () => {
    const z = new AdmZip();
    z.addFile('word/document.xml', Buffer.from('<w:document><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:document>'));
    const p = path.join(dir, 'letter.docx'); z.writeZip(p); known.add(p);
    const r = await make().peek(p);
    expect(r.kind).toBe('office'); expect(r.text).toBe('Hello & welcome\nSecond');
    const bad = file('broken.docx', 'not a zip');
    expect((await make().peek(bad)).listError).toBeTruthy();
  });
  it('xmlText drops tags and decodes entities', () => {
    expect(xmlText('<a:p><a:t>1 &lt; 2</a:t></a:p>')).toBe('1 < 2');
  });
});

describe('the hash', () => {
  it('is the SHA-256 of the file, streamed, on request', async () => {
    const p = file('h.bin', 'abc');
    const r = await make().hash(p);
    expect(r.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('wiring', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  it('the channels have a strict schema, a policy entry and a preload bridge, and only the interface may call them', () => {
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('downloads:peek downloads:peek-hash', \[string\(4096\)\]\)/);
    expect(read('src/main/ipc-policy.js')).toMatch(/'downloads:peek', 'downloads:peek-hash'/);
    const pre = read('src/preload.js');
    expect(pre).toMatch(/downloadsPeek:\s+\(filePath\) => ipcRenderer\.invoke\('downloads:peek', filePath\)/);
    expect(pre).toMatch(/downloadsPeekHash:/);
    const main = read('src/main.js');
    expect(main).toMatch(/ipcMain\.handle\('downloads:peek', async/);
    expect(main).toMatch(/isDownloadedFile: \(p\) => _downloadService\.isDownloadedFile\(p\)[^\n]*\n\s*listArchive/);
  });
});
