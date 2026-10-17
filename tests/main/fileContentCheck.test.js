// What a downloaded file IS (src/main/file-content-check.js), against real files written to a temporary folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectFile } = require('../../src/main/file-content-check');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-filecheck-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// A zip written by hand: stored entries, a central directory and an end record. Nothing is compressed.
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data || 'x');
    const flags = (e.encrypted ? 1 : 0) | 0x800;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(e.size != null ? e.size : data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(e.size != null ? e.size : data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
const check = (name, buf) => inspectFile({ fs, file: write(name, buf), name });
const PE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
const kinds = (r) => r.findings.map(f => f.kind);

describe('header against name', () => {
  it('a PDF, picture or text file that is really a Windows program is a high finding', () => {
    for (const n of ['invoice.pdf', 'photo.jpg', 'notes.txt', 'song.mp3']) {
      const r = check(n, PE);
      expect(r.worst, n).toBe('high');
      expect(kinds(r), n).toEqual(['disguised-program']);
    }
  });
  it('a real PDF, PNG and plain text are clean', () => {
    expect(check('a.pdf', Buffer.from('%PDF-1.7\n' + 'x'.repeat(100))).findings).toEqual([]);
    expect(check('a.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50)])).findings).toEqual([]);
    const t = check('a.txt', Buffer.from('hello world, nothing to see'));
    expect(t.checked).toBe(true);
    expect(t.findings).toEqual([]);
  });
  it('an office document is a zip by design and is not flagged for it', () => {
    expect(check('report.docx', makeZip([{ name: '[Content_Types].xml' }, { name: 'word/document.xml' }])).findings).toEqual([]);
  });
  it('a picture that is really an archive is medium; an .exe that is not a program is medium', () => {
    expect(kinds(check('cat.jpg', makeZip([{ name: 'a.txt' }, { name: 'b.txt' }])))).toEqual(['disguised-archive']);
    const r = check('setup.exe', Buffer.from('%PDF-1.7 not a program, just text '.repeat(10)));
    expect(kinds(r)).toEqual(['not-a-program']);
    expect(r.worst).toBe('medium');
  });
  it('a script behind a document name is high', () => {
    expect(check('readme.txt', Buffer.from('#!/bin/sh\nrm -rf x\n' + 'y'.repeat(20))).worst).toBe('high');
  });
});

describe('zip shapes', () => {
  it('a password-locked zip that holds a program is high', () => {
    const r = check('doc.zip', makeZip([{ name: 'invoice.exe', encrypted: true }, { name: 'readme.txt' }]));
    expect(kinds(r)).toContain('locked-program');
    expect(r.worst).toBe('high');
  });
  it('a program hidden behind a document ending inside a zip is high', () => {
    expect(kinds(check('files.zip', makeZip([{ name: 'tax/Invoice-2026.pdf.exe' }, { name: 'a.txt' }])))).toContain('double-extension');
  });
  it('a path that climbs out of the folder is high', () => {
    expect(kinds(check('x.zip', makeZip([{ name: '../../Startup/run.bat' }, { name: 'a.txt' }])))).toContain('path-escape');
    expect(kinds(check('y.zip', makeZip([{ name: 'C:/Windows/x.dll' }, { name: 'a.txt' }])))).toContain('path-escape');
  });
  it('a zip that holds just one program, or a shortcut, is medium', () => {
    const one = check('free-thing.zip', makeZip([{ name: 'setup.exe' }]));
    expect(kinds(one)).toEqual(['single-program']);
    expect(one.worst).toBe('medium');
    expect(kinds(check('pics.zip', makeZip([{ name: 'photos.lnk' }, { name: 'a.jpg' }, { name: 'b.jpg' }])))).toEqual(['shortcut-or-script']);
  });
  it('a normal zip of source code or photos is clean, and a zip bomb shape is medium', () => {
    expect(check('src.zip', makeZip([{ name: 'src/a.js' }, { name: 'src/b.js' }, { name: 'README.md' }, { name: 'package.json' }, { name: 'lib/c.js' }, { name: 'lib/d.js' }])).findings).toEqual([]);
    const bomb = check('big.zip', makeZip([{ name: 'zeros.bin', data: 'x', size: 3 * 1024 * 1024 * 1024 }]));
    expect(kinds(bomb)).toContain('expansion');
  });
  it('a damaged or zip64 file is said not to be listed, never reported as clean-and-checked silently', () => {
    const cut = makeZip([{ name: 'a.txt' }]).subarray(0, 40);
    const r = check('broken.zip', cut);
    expect(r.checked).toBe(true);
    expect(r.note).toMatch(/missing or damaged/);
  });
});

describe('failure is not "clean"', () => {
  it('a file that cannot be opened is reported as not checked, with the reason', () => {
    const r = inspectFile({ fs, file: path.join(dir, 'missing.pdf'), name: 'missing.pdf' });
    expect(r.checked).toBe(false);
    expect(r.note).toMatch(/could not be checked/);
    expect(r.findings).toEqual([]);
  });
  it('a folder is not a file', () => {
    const r = inspectFile({ fs, file: dir, name: 'x.pdf' });
    expect(r.checked).toBe(false);
  });
  it('reads only the start of a big file', () => {
    const big = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300 * 1024, 2)]);
    expect(check('huge.jpg', big).worst).toBe('high');
  });
});
