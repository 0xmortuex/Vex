// Carrying on a download after Vex was closed (src/main/download-resume.js): the hard link that
// outlives Chromium's cleanup, the record, and what is refused. Real files in a temp folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createResumeStore, MIN_BYTES, MAX_AGE_MS } = require('../../src/main/download-resume.js');
const prefsMod = require('../../src/main/download-prefs.js');
const rules = require('../../src/main/download-rules.js');

let dir, file, clock, store;
const make = (name, bytes) => { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.alloc(bytes, 7)); return p; };
const rec = (over = {}) => ({ id: 'dl_1', savePath: path.join(dir, 'big.bin'), fileName: 'big.bin', partition: 'persist:main', urlChain: ['https://x.test/big.bin'], mimeType: 'application/octet-stream', totalBytes: MIN_BYTES * 2, eTag: '"a"', lastModified: '', startTime: 1, ...over });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-resume-test-'));
  file = path.join(dir, 'resumable.json');
  clock = 1000000;
  store = createResumeStore({ fs, file, now: () => clock });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('which downloads are kept', () => {
  const ok = { url: 'https://x.test/a', totalBytes: MIN_BYTES, eTag: '"a"', lastModified: '', ephemeral: false };
  it('needs a known size, a validator and a normal profile', () => {
    expect(store.eligible(ok)).toBe('');
    expect(store.eligible({ ...ok, ephemeral: true })).toMatch(/private/);
    expect(store.eligible({ ...ok, totalBytes: 0 })).toMatch(/size/);
    expect(store.eligible({ ...ok, totalBytes: 1000 })).toMatch(/small/);
    expect(store.eligible({ ...ok, eTag: '', lastModified: '' })).toMatch(/unchanged/);
    expect(store.eligible({ ...ok, eTag: '', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' })).toBe('');
    expect(store.eligible({ ...ok, url: 'file:///c:/x' })).toMatch(/http/);
  });
});

describe('the second name', () => {
  it('survives the deletion of the original and carries the bytes written so far', () => {
    const src = make('big.bin', 1234);
    const r = store.track(rec(), src);
    expect(r.partPath).toBe(src + '.vexpart-1');
    fs.unlinkSync(src);                                  // what Chromium does when Vex quits
    expect(fs.statSync(r.partPath).size).toBe(1234);
    const plan = store.plan(store.all()[0]);
    expect(plan).toMatchObject({ path: r.partPath, offset: 1234, eTag: '"a"', urlChain: ['https://x.test/big.bin'] });
  });

  it('a link follows the file as it grows, so the offset is what was really written', () => {
    const src = make('big.bin', 100);
    const r = store.track(rec(), src);
    fs.appendFileSync(src, Buffer.alloc(50, 1));
    expect(store.plan(r).offset).toBe(150);
  });

  it('a picked-up download gets the next name, because the one Chromium writes to is the one it deletes', () => {
    const src = make('big.bin', 10);
    const first = store.track(rec(), src);
    const second = store.track(rec({ id: 'dl_2' }), first.partPath, 2);
    expect(second.partPath).toBe(src + '.vexpart-2');
    fs.unlinkSync(first.partPath);
    expect(fs.existsSync(second.partPath)).toBe(true);
  });

  it('forgetting removes the record and the file it made, and nothing else', () => {
    const src = make('big.bin', 10);
    const r = store.track(rec(), src);
    expect(store.forget('dl_1')).toBe(true);
    expect(fs.existsSync(r.partPath)).toBe(false);
    expect(fs.existsSync(src)).toBe(true);
    expect(store.all()).toEqual([]);
    expect(store.forget('dl_1')).toBe(false);
    expect(() => store.dropPart(src)).toThrow(/Not one of the carry-on files/);
    expect(fs.existsSync(src)).toBe(true);
  });

  it('is written to the record file and read back by a new store', () => {
    store.track(rec(), make('big.bin', 10));
    const again = createResumeStore({ fs, file, now: () => clock });
    expect(again.all().map(r => r.id)).toEqual(['dl_1']);
  });

  it('says so when the drive has no hard links (the source is missing here)', () => {
    expect(() => store.track(rec(), path.join(dir, 'nope.bin'))).toThrow(/ENOENT/);
  });
});

describe('refusing to carry on', () => {
  it('a partial file that is gone, empty, or already whole', () => {
    const src = make('big.bin', 10);
    const r = store.track(rec({ totalBytes: 10 }), src);
    expect(() => store.plan(r)).toThrow(/not smaller/);
    fs.writeFileSync(r.partPath, '');
    expect(() => store.plan(r)).toThrow(/empty/);
    fs.unlinkSync(r.partPath);
    expect(() => store.plan(r)).toThrow(/is gone/);
  });

  it('a record with no validator', () => {
    const r = store.track(rec({ eTag: '', lastModified: '' }), make('big.bin', 10));
    expect(() => store.plan(r)).toThrow(/unchanged/);
  });

  it('a damaged record file starts a new list and says so', () => {
    fs.writeFileSync(file, '{not json');
    const spy = [];
    const old = console.error; console.error = (...a) => spy.push(a.join(' '));
    try { expect(createResumeStore({ fs, file }).all()).toEqual([]); } finally { console.error = old; }
    expect(spy.join('\n')).toMatch(/could not read the list/);
  });
});

describe('sweeping', () => {
  it('drops records a week old or whose file is gone, keeping the rest', () => {
    const a = store.track(rec({ id: 'old', savePath: path.join(dir, 'a.bin') }), make('a.bin', 10));
    clock += MAX_AGE_MS + 1;
    const b = store.track(rec({ id: 'fresh', savePath: path.join(dir, 'b.bin') }), make('b.bin', 10));
    const c = store.track(rec({ id: 'lost', savePath: path.join(dir, 'c.bin') }), make('c.bin', 10));
    fs.unlinkSync(c.partPath);
    const gone = store.sweep();
    expect(gone.map(g => g.id).sort()).toEqual(['lost', 'old']);
    expect(store.all().map(r => r.id)).toEqual(['fresh']);
    expect(fs.existsSync(a.partPath)).toBe(false);
    expect(fs.existsSync(b.partPath)).toBe(true);
  });
});

describe('the setting', () => {
  it('is off by default, saved when turned on, and cleared by a reset', () => {
    const f = path.join(dir, 'prefs.json');
    const mk = () => prefsMod.createDownloadPrefs({ fs, file: f, defaultFolder: () => dir });
    const p = mk();
    expect(p.current().resume).toBe(false);
    expect(() => p.setResume('yes')).toThrow(/on or off/);
    p.setResume(true);
    expect(mk().current().resume).toBe(true);
    p.reset();
    expect(mk().current().resume).toBe(false);
  });
});

describe('a default folder per kind of file', () => {
  it('a kind written by name stands for its extensions, and an own rule above wins', () => {
    const list = [{ id: 'mine', ext: 'pdf', site: 'github.com', folder: 'Invoices' }, ...rules.typeDefaults()];
    expect(rules.place(list, { filename: 'a.pdf', url: 'https://github.com/a' }).folder).toBe('Invoices');
    expect(rules.place(list, { filename: 'a.pdf', url: 'https://other.test/a' }).folder).toBe('Documents');
    expect(rules.place(list, { filename: 'p.PNG', url: 'https://other.test/p' }).folder).toBe('Images');
    expect(rules.place(list, { filename: 'a.zip', url: 'https://other.test/a' }).folder).toBe('Archives');
    expect(rules.place(list, { filename: 'a.xyz', url: 'https://other.test/a' }).folder).toBe('');
    expect(rules.matches({ ext: 'images, mp3' }, { filename: 'a.mp3', url: '' })).toBe(true);
  });
});
