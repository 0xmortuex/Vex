// The Safe Download Assistant's facts (src/main/download-facts.js) read from real synthetic files, and judged end to end.
// Every sample is a harmless file made here: a few bytes that look like a Windows program ("MZ"), a hand-written zip.
// Nothing is downloaded and nothing is run.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { gatherFacts, zipDirectory, sourceFacts } = require('../../src/main/download-facts');
const { judge } = require('../../src/main/download-verdict');
const { createFileCheck } = require('../../src/main/file-check');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-safedl-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const MZ = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
// A minimal, harmless, structurally valid 32-bit Windows program (one `ret`; it is never run). Windows reads it as a real
// program with no signature, which a few loose bytes starting with "MZ" are not.
function tinyPe() {
  const b = Buffer.alloc(0x400);
  b.write('MZ', 0); b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40);
  let p = 0x44;
  b.writeUInt16LE(0x14c, p); b.writeUInt16LE(1, p + 2); b.writeUInt16LE(0xe0, p + 16); b.writeUInt16LE(0x0102, p + 18);
  p = 0x58;
  b.writeUInt16LE(0x10b, p); b.writeUInt32LE(0x200, p + 4); b.writeUInt32LE(0x1000, p + 16); b.writeUInt32LE(0x1000, p + 20); b.writeUInt32LE(0x400000, p + 28);
  b.writeUInt32LE(0x1000, p + 32); b.writeUInt32LE(0x200, p + 36); b.writeUInt16LE(4, p + 40); b.writeUInt16LE(4, p + 48);
  b.writeUInt32LE(0x2000, p + 56); b.writeUInt32LE(0x200, p + 60); b.writeUInt16LE(3, p + 68); b.writeUInt32LE(0x100000, p + 72); b.writeUInt32LE(0x1000, p + 76);
  b.writeUInt32LE(0x100000, p + 80); b.writeUInt32LE(0x1000, p + 84); b.writeUInt32LE(16, p + 92);
  p = 0x58 + 0xe0;
  b.write('.text', p); b.writeUInt32LE(0x10, p + 8); b.writeUInt32LE(0x1000, p + 12); b.writeUInt32LE(0x200, p + 16); b.writeUInt32LE(0x200, p + 20); b.writeUInt32LE(0x60000020, p + 36);
  b[0x200] = 0xc3;
  return b;
}
const write = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
const run = async (name, buf, extra = {}) => {
  const file = write(name, buf);
  const facts = await gatherFacts({ fs, file, name, ...extra });
  return { facts, verdict: judge(facts) };
};

// A zip written by hand. `entries`: { name, data, encrypted, size (declared unpacked), packed (declared packed), zip64 }.
function makeZip(entries, { zip64End = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data || 'x');
    const flags = (e.encrypted ? 1 : 0) | 0x800;
    const packed = e.packed != null ? e.packed : data.length, size = e.size != null ? e.size : data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6);
    lh.writeUInt32LE(Math.min(packed, 0xffffffff), 18); lh.writeUInt32LE(Math.min(size, 0xffffffff), 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const big = size > 0xfffffffe || packed > 0xfffffffe;
    let extra = Buffer.alloc(0);
    if (big) { extra = Buffer.alloc(4 + 16); extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); extra.writeBigUInt64LE(BigInt(size), 4); extra.writeBigUInt64LE(BigInt(packed), 12); }
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(big ? 45 : 20, 4); ch.writeUInt16LE(big ? 45 : 20, 6); ch.writeUInt16LE(flags, 8);
    ch.writeUInt32LE(big ? 0xffffffff : packed, 20); ch.writeUInt32LE(big ? 0xffffffff : size, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(extra.length, 30); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name, extra);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const parts = [...locals, cd];
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  if (zip64End) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(entries.length), 24); z.writeBigUInt64LE(BigInt(entries.length), 32); z.writeBigUInt64LE(BigInt(cd.length), 40); z.writeBigUInt64LE(BigInt(offset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(offset + cd.length), 8); loc.writeUInt32LE(1, 16);
    parts.push(z, loc);
    end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
  } else {
    end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  }
  parts.push(end);
  return Buffer.concat(parts);
}

describe('type against content, from real bytes', () => {
  it('a Windows program named invoice.pdf is red', async () => {
    const { facts, verdict } = await run('invoice.pdf', MZ);
    expect(facts.detected).toBe('program');
    expect(verdict.level).toBe('red');
    expect(verdict.reasons.map(r => r.id)).toContain('disguised-program');
  });
  it('a real PDF header named report.pdf is green', async () => {
    const { verdict } = await run('report.pdf', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n'));
    expect(verdict.level).toBe('green');
  });
  it('a PNG, a JPEG and plain text are green', async () => {
    expect((await run('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).verdict.level).toBe('green');
    expect((await run('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]))).verdict.level).toBe('green');
    expect((await run('a.txt', Buffer.from('hello there'))).verdict.level).toBe('green');
  });
  it('invoice.pdf.exe and a right-to-left override name are red', async () => {
    expect((await run('invoice.pdf.exe', MZ)).verdict.level).toBe('red');
    expect((await run('invoice\u202Efdp.exe', MZ)).verdict.level).toBe('red');
  });
  it('a script wearing a picture name is red', async () => {
    expect((await run('cat.jpg', Buffer.from('#!/bin/sh\necho hi\n'))).verdict.level).toBe('red');
  });
  it('an empty file and a file that cannot be read are not called clean on a guess', async () => {
    expect((await run('empty.pdf', Buffer.alloc(0))).verdict.level).toBe('green');
    const missing = await gatherFacts({ fs, file: path.join(dir, 'gone.pdf'), name: 'gone.pdf' });
    expect(missing.checked).toBe(false);
    expect(judge(missing).level).toBe('gray');
    const folder = await gatherFacts({ fs, file: dir, name: 'x.pdf' });
    expect(judge(folder).level).toBe('gray');
  });
});

describe('zip listings (the central directory only)', () => {
  it('lists names and sizes and flags a program among few files', async () => {
    const { facts, verdict } = await run('mod.zip', makeZip([{ name: 'setup.exe', data: 'MZ' }]));
    expect(facts.archive.listed).toBe(true);
    expect(facts.archive.entries.map(e => e.name)).toEqual(['setup.exe']);
    expect(verdict.level).toBe('amber');
  });
  it('a zip with a program inside, named like a document, is red', async () => {
    const { verdict } = await run('files.zip', makeZip([{ name: 'readme.txt' }, { name: 'Invoice.pdf.exe', data: 'MZ' }]));
    expect(verdict.level).toBe('red');
  });
  it('path traversal names in a real zip are red', async () => {
    const { verdict } = await run('p.zip', makeZip([{ name: '../../Windows/evil.dll' }, { name: 'ok.txt' }]));
    expect(verdict.level).toBe('red');
    expect(verdict.reasons.map(r => r.id)).toContain('path-traversal');
  });
  it('a password-locked zip holding a program is red', async () => {
    const { verdict } = await run('locked.zip', makeZip([{ name: 'cheat.exe', encrypted: true }]));
    expect(verdict.level).toBe('red');
  });
  it('a zip bomb header (declared 60 GB from 1 MB, zip64) is red and never previewed, with nothing unpacked', async () => {
    const { facts, verdict } = await run('bomb.zip', makeZip([{ name: 'zeros.bin', size: 60 * 1024 ** 3, packed: 1024 * 1024 }], { zip64End: true }));
    expect(facts.archive.listed).toBe(true);
    expect(facts.archive.entries[0].size).toBe(60 * 1024 ** 3);
    expect(verdict.level).toBe('red');
    expect(verdict.noPreview).toBe(true);
    expect(fs.statSync(path.join(dir, 'bomb.zip')).size).toBeLessThan(2000);
  });
  it('a bomb with plain 32-bit sizes (4 GB from 4 MB) is caught too', async () => {
    const { verdict } = await run('bomb2.zip', makeZip([{ name: 'a.bin', size: 4 * 1024 ** 3 - 1, packed: 4 * 1024 * 1024 }]));
    expect(verdict.noPreview).toBe(true);
  });
  it('a damaged zip is reported as unlisted, not as clean files', async () => {
    const bad = makeZip([{ name: 'a.txt' }]);
    const { facts, verdict } = await run('broken.zip', bad.subarray(0, bad.length - 10));
    expect(facts.archive.listed).toBe(false);
    expect(verdict.reasons.map(r => r.id)).toContain('archive-unlisted');
  });
  it('an Office document (a zip inside) is not listed', async () => {
    const { facts, verdict } = await run('budget.docx', makeZip([{ name: '[Content_Types].xml' }, { name: 'word/document.xml' }]));
    expect(facts.archive).toBeNull();
    expect(verdict.level).toBe('green');
  });
  it('a .jar named .pdf is red; a real .jar is green with the mod caution', async () => {
    const jar = makeZip([{ name: 'META-INF/MANIFEST.MF' }, { name: 'Main.class' }]);
    expect((await run('manual.pdf', jar)).verdict.level).toBe('red');
    const real = await run('cool-mod.jar', jar);
    expect(real.verdict.level).toBe('green');
    expect(real.verdict.reasons.map(r => r.id)).toContain('mod-caution');
  });
  it('zipDirectory refuses a directory outside the file', () => {
    const z = makeZip([{ name: 'a.txt' }]);
    z.writeUInt32LE(0x7fffffff, z.length - 4);                 // central directory offset beyond the end
    const p = write('lie.zip', z);
    const fd = fs.openSync(p, 'r');
    try { expect(zipDirectory(fs, fd, z.length).note).toContain('outside'); } finally { fs.closeSync(fd); }
  });
});

describe('source facts', () => {
  const lookalikeOf = (h) => (h === 'dlscord.com' ? 'discord.com' : '');
  const threatCheck = (u) => (new URL(u).hostname === 'bad.example' ? { kind: 'domain' } : null);
  const registrable = (h) => h.split('.').slice(-2).join('.');
  const src = (o) => sourceFacts({ lookalikeOf, threatCheck, registrable, ...o });
  it('reads the host, scheme and flags', () => {
    expect(src({ url: 'http://dlscord.com/setup.exe', chain: [] })).toMatchObject({ scheme: 'http', host: 'dlscord.com', lookalike: 'discord.com', threat: false });
    expect(src({ url: 'https://bad.example/a.exe' }).threat).toBe(true);
  });
  it('a dangerous host anywhere in the redirect chain counts', () => {
    expect(src({ url: 'https://cdn.example.org/a.exe', chain: ['https://bad.example/go', 'https://cdn.example.org/a.exe'] }).threat).toBe(true);
  });
  it('github.com to githubusercontent.com is one site; three unrelated hosts are three', () => {
    expect(src({ url: 'https://objects.githubusercontent.com/x', chain: ['https://github.com/o/r/releases/download/v1/x', 'https://objects.githubusercontent.com/x'] }).sites.length).toBe(1);
    expect(src({ url: 'https://c.example.net/x', chain: ['https://a.example.org/x', 'https://b.example.com/x', 'https://c.example.net/x'] }).sites.length).toBe(3);
  });
  it('a mod host and a download with no click are carried through', () => {
    expect(src({ url: 'https://edge.forgecdn.net/files/a.zip' }).modHost).toBe(false);
    expect(src({ url: 'https://www.curseforge.com/a.zip' }).modHost).toBe(true);
    expect(src({ url: 'https://x.example.org/a.exe', noClick: true }).noClick).toBe(true);
  });
  it('a blob or data address has no source facts', () => {
    expect(src({ url: 'blob:https://x.example.org/abc' })).toBeNull();
    expect(src({ url: '' })).toBeNull();
  });
  it('end to end: a program from a look-alike host over http is red', async () => {
    const file = write('setup.exe', MZ);
    const facts = await gatherFacts({ fs, file, name: 'setup.exe', source: { url: 'http://dlscord.com/setup.exe', lookalikeOf, threatCheck, registrable }, signatureOf: async () => ({ status: 'NotSigned', signer: '' }) });
    const v = judge(facts);
    expect(v.level).toBe('red');
    expect(v.reasons.map(r => r.id)).toEqual(expect.arrayContaining(['lookalike-site', 'plain-http', 'not-signed']));
  });
});

describe('only the head and the tail of a big file are read', () => {
  it('a 2 GB file costs a few reads of a few hundred KB, never a scan', async () => {
    const size = 2 * 1024 ** 3;
    const zip = makeZip([{ name: 'a.bin', data: 'x' }]);
    const reads = [];
    const fake = {
      openSync: () => 99,
      closeSync: () => {},
      fstatSync: () => ({ size, isFile: () => true }),
      readSync: (_fd, buf, off, len, pos) => {
        reads.push({ len, pos });
        // the first bytes say zip; the end of the file holds a real end record and directory
        buf.fill(0, off, off + len);
        if (pos === 0) zip.copy(buf, off, 0, Math.min(len, zip.length));
        return len;
      },
    };
    const t0 = Date.now();
    const facts = await gatherFacts({ fs: fake, file: 'C:\\big.iso.zip', name: 'big.zip' });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(facts.checked).toBe(true);
    const total = reads.reduce((n, r) => n + r.len, 0);
    expect(total).toBeLessThan(1024 * 1024);
    for (const r of reads) expect(r.pos === 0 || r.pos >= size - 70000).toBe(true);
  });
  it('a real 40 MB file is judged without reading it all', async () => {
    const p = path.join(dir, 'big.pdf');
    const fd = fs.openSync(p, 'w');
    fs.writeSync(fd, Buffer.from('%PDF-1.7\n'));
    fs.ftruncateSync(fd, 40 * 1024 * 1024);
    fs.closeSync(fd);
    const t0 = Date.now();
    const facts = await gatherFacts({ fs, file: p, name: 'big.pdf' });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(judge(facts).level).toBe('green');
  });
});

describe('the Windows signature, read without a shell', () => {
  const win = process.platform === 'win32';
  it('puts the path in an environment variable, never in the script, whatever the name holds', async () => {
    const calls = [];
    const execFile = (exe, args, opts, cb) => { calls.push({ exe, args, env: opts.env }); cb(null, 'NotSigned\n\nFalse'); };
    const fc = createFileCheck({ fs, crypto, execFile, platform: 'win32' });
    const hostile = ['a;b.exe', 'a`b.exe', 'a$(calc).exe', "a'b.exe", 'a&b.exe', 'a%PATH%.exe', 'a^b.exe', 'ünï çödé 文件.exe', 'a b  c.exe', 'a|b.exe', '-ExecutionPolicy.exe', 'a\u202Eb.exe', '{x}.exe', 'a#b.exe'];
    for (const n of hostile) {
      const p = path.join(dir, n);
      await fc.signature(p);
      const c = calls[calls.length - 1];
      expect(c.args.join(' ')).not.toContain(n);
      expect(c.env.VEX_FILECHECK_PATH).toBe(p);
      expect(c.args).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', expect.any(String)]);
    }
    expect(calls.length).toBe(hostile.length);
  });
  it.skipIf(!win)('an unsigned program with hostile characters in its name is read for real and reported NotSigned, and nothing runs', async () => {
    const marker = path.join(dir, 'ran.txt');
    const names = ['semi;colon.exe', 'back`tick.exe', 'dollar$(New-Item ran.txt).exe', "quote'name.exe", 'amp&amp.exe', 'ünï çödé 文件.exe', 'spaces  and  more.exe', 'brace{x}.exe', 'percent%PATH%.exe', 'hash#1.exe'];
    const fc = createFileCheck({ fs, crypto, execFile: require('child_process').execFile, platform: 'win32' });
    for (const n of names) {
      const p = write(n, tinyPe());
      const sig = await fc.signature(p);
      expect(sig.status, n).toBe('NotSigned');
    }
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'ran.txt'))).toBe(false);
  }, 60000);
  it.skipIf(!win)('end to end: an unsigned program is amber, with the real signature reader', async () => {
    const fc = createFileCheck({ fs, crypto, execFile: require('child_process').execFile, platform: 'win32' });
    const file = write('setup.exe', tinyPe());
    const facts = await gatherFacts({ fs, file, name: 'setup.exe', signatureOf: (f) => fc.signature(f) });
    expect(facts.signature.status).toBe('NotSigned');
    const v = judge(facts);
    expect(v.level).toBe('amber');
    expect(v.reasons.map(r => r.id)).toContain('not-signed');
  }, 60000);
  it.skipIf(!win)('a small Windows binary that Microsoft signed is Valid (read only)', async () => {
    const target = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
    expect(fs.existsSync(target)).toBe(true);
    const fc = createFileCheck({ fs, crypto, execFile: require('child_process').execFile, platform: 'win32' });
    const sig = await fc.signature(target);
    expect(sig.status).toBe('Valid');
    expect(sig.signer).toMatch(/Microsoft/i);
    const facts = await gatherFacts({ fs, file: target, name: 'notepad.exe', signatureOf: (f) => fc.signature(f), source: { url: 'https://github.com/x/y/notepad.exe', registrable: (h) => h } });
    expect(judge(facts).level).toBe('green');
  }, 60000);
});
