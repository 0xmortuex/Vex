// T3-111: "Extract archive here" for a finished download: confirmed by main, zip-slip safe, mark of the web carried.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const tar = require('tar');
const archive = require('../../src/main/archive-security.js');
const { createDownloadFiles } = require('../../src/main/download-files.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function makeZip(name, entries) {
  const z = new AdmZip();
  for (const [n, body] of Object.entries(entries)) z.addFile(n, Buffer.from(body));
  const file = path.join(dir, name);
  z.writeZip(file);
  return file;
}
// adm-zip cleans a name it is given, so a hostile zip is made by writing a same-length placeholder and swapping the
// bytes of the name in the local header and in the central directory.
function hostileZip(file, placeholder, real) {
  if (placeholder.length !== real.length) throw new Error('same length please');
  const z = new AdmZip();
  z.addFile('ok.txt', Buffer.from('x'));
  z.addFile(placeholder, Buffer.from('boom'));
  const tmp = path.join(dir, 'tmp-' + Math.random().toString(36).slice(2) + '.zip');
  z.writeZip(tmp);
  const bytes = fs.readFileSync(tmp).toString('latin1').split(placeholder).join(real);
  fs.writeFileSync(file, Buffer.from(bytes, 'latin1'));
  fs.rmSync(tmp);
  return file;
}
const service = (over = {}) => {
  const motw = { propagate: vi.fn((a, files) => ({ carried: true, marked: files.length, failed: [] })) };
  const confirm = vi.fn(async () => true);
  const files = createDownloadFiles({ fs, shell: {}, getFileIcon: () => null, isDownloadedFile: () => true, archive, confirm, motw, ...over });
  return { files, motw, confirm };
};

describe('archive-security.extractZip', () => {
  it('writes the files under the destination and carries the mark onto each', async () => {
    const zip = makeZip('a.zip', { 'readme.txt': 'hi', 'bin/tool.exe': 'MZ' });
    const motw = { propagate: vi.fn(() => ({ carried: true, marked: 2, failed: [] })) };
    const r = await archive.extractZip(zip, path.join(dir, 'out'), undefined, { motw });
    expect(r.files).toBe(2);
    expect(fs.readFileSync(path.join(dir, 'out', 'bin', 'tool.exe'), 'utf8')).toBe('MZ');
    expect(motw.propagate).toHaveBeenCalledTimes(1);
    expect(motw.propagate.mock.calls[0][0]).toBe(zip);
    expect(motw.propagate.mock.calls[0][1].map(f => path.basename(f)).sort()).toEqual(['readme.txt', 'tool.exe']);
  });

  it('refuses a zip-slip entry and writes nothing outside the destination', async () => {
    const zip = hostileZip(path.join(dir, 'slip.zip'), 'xx/evil.txt', '../evil.txt');
    await expect(archive.extractZip(zip, path.join(dir, 'out'))).rejects.toThrow(/archive/i);
    expect(fs.existsSync(path.join(dir, 'evil.txt'))).toBe(false);
  });

  it('refuses an absolute path, a drive path and a backslash path', async () => {
    for (const [placeholder, bad] of [['xetc/passwd', '/etc/passwd'], ['CC/Windows/x.txt', 'C:/Windows/x.txt'], ['aXdirXx.txt', 'a\\dir\\x.txt'], ['xx/yy/x', '../../x']]) {
      if (placeholder.length !== bad.length) throw new Error('test setup: ' + placeholder);
      const zip = hostileZip(path.join(dir, 'bad.zip'), placeholder, bad);
      await expect(archive.extractZip(zip, path.join(dir, 'out-' + Math.random().toString(36).slice(2)))).rejects.toThrow();
    }
  });

  it('never overwrites a file that is already there', async () => {
    const zip = makeZip('a.zip', { 'readme.txt': 'new' });
    fs.mkdirSync(path.join(dir, 'out'));
    fs.writeFileSync(path.join(dir, 'out', 'readme.txt'), 'mine');
    await expect(archive.extractZip(zip, path.join(dir, 'out'))).rejects.toThrow(/EEXIST/);
    expect(fs.readFileSync(path.join(dir, 'out', 'readme.txt'), 'utf8')).toBe('mine');
  });

  it('inspectZip counts files and bytes after the same checks', () => {
    const zip = makeZip('a.zip', { 'a.txt': 'hello', 'd/b.txt': 'world!' });
    expect(archive.inspectZip(zip)).toEqual({ count: 2, bytes: 11 });
  });
});

describe('extractHere', () => {
  it('asks first, naming the exact new folder and the file count, then extracts and carries the mark', async () => {
    const zip = makeZip('tools.zip', { 'a.txt': 'a', 'b.txt': 'b' });
    const { files, motw, confirm } = service();
    const r = await files.extractHere(zip);
    expect(confirm).toHaveBeenCalledTimes(1);
    const ask = confirm.mock.calls[0][0];
    expect(ask.title).toBe('Extract tools.zip here?');
    expect(ask.detail).toContain(path.join(dir, 'tools'));
    expect(ask.detail).toContain('2 files');
    expect(r).toMatchObject({ ok: true, folder: path.join(dir, 'tools'), files: 2 });
    expect(r.motw).toMatchObject({ carried: true, marked: 2 });
    expect(motw.propagate).toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'tools', 'a.txt'))).toBe(true);
  });

  it('does nothing when the person says no', async () => {
    const zip = makeZip('tools.zip', { 'a.txt': 'a' });
    const { files } = service({ confirm: vi.fn(async () => false) });
    expect(await files.extractHere(zip)).toEqual({ ok: false, cancelled: true });
    expect(fs.existsSync(path.join(dir, 'tools'))).toBe(false);
  });

  it('uses a fresh folder name when one is taken, and never writes into the old one', async () => {
    const zip = makeZip('tools.zip', { 'a.txt': 'a' });
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.writeFileSync(path.join(dir, 'tools', 'keep.txt'), 'keep');
    const { files } = service();
    const r = await files.extractHere(zip);
    expect(r.folder).toBe(path.join(dir, 'tools (2)'));
    expect(fs.readdirSync(path.join(dir, 'tools'))).toEqual(['keep.txt']);
  });

  it('refuses a file Vex did not download, a missing file and a type it cannot unpack', async () => {
    const zip = makeZip('tools.zip', { 'a.txt': 'a' });
    expect((await service({ isDownloadedFile: () => false }).files.extractHere(zip)).error).toMatch(/only does this to files it downloaded/);
    expect((await service().files.extractHere(path.join(dir, 'gone.zip'))).error).toMatch(/not there/);
    const rar = path.join(dir, 'x.rar'); fs.writeFileSync(rar, 'Rar!');
    expect((await service().files.extractHere(rar)).error).toMatch(/\.zip, \.tar, \.tgz/);
  });

  it('removes the half-made folder, and only that one, when the archive is unsafe', async () => {
    const zip = hostileZip(path.join(dir, 'slip.zip'), 'xx/evil.txt', '../evil.txt');
    fs.writeFileSync(path.join(dir, 'neighbour.txt'), 'n');
    const { files, confirm } = service();
    const r = await files.extractHere(zip);
    // the unsafe name is caught while the archive is inspected, before anything is asked or made
    expect(r.ok === false || r.error).toBeTruthy();
    expect(fs.existsSync(path.join(dir, 'slip'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'neighbour.txt'))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('unpacks a .tgz through the tar extractor, with the mark', async () => {
    const src = path.join(dir, 'src'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'one.txt'), '1');
    const tgz = path.join(dir, 'pack.tgz');
    await tar.c({ gzip: true, file: tgz, cwd: src }, ['one.txt']);
    const { files, motw } = service();
    const r = await files.extractHere(tgz);
    expect(r).toMatchObject({ ok: true, folder: path.join(dir, 'pack'), files: 1 });
    expect(fs.readFileSync(path.join(dir, 'pack', 'one.txt'), 'utf8')).toBe('1');
    expect(motw.propagate).toHaveBeenCalled();
  });

  it('names the kinds it unpacks', () => {
    const { files } = service();
    expect(files.kindOf('a.tar.gz')).toEqual({ kind: 'tar', base: 'a' });
    expect(files.kindOf('a.TGZ')).toEqual({ kind: 'tar', base: 'a' });
    expect(files.kindOf('a.zip')).toEqual({ kind: 'zip', base: 'a' });
    expect(files.kindOf('a.7z')).toBeNull();
  });
});

describe('wiring', () => {
  const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');
  it('main shows the confirmation, the channel has a schema and a preload entry, and the panel has the button', () => {
    const main = read('src', 'main.js');
    expect(main).toMatch(/downloads:extract-here/);
    expect(main).toMatch(/dialog\.showMessageBox\(win, opts\)[\s\S]{0,80}response === 0/);
    expect(read('src', 'preload.js')).toMatch(/downloadsExtractHere/);
    expect(read('src', 'main', 'ipc-schemas.js')).toMatch(/downloads:extract-here/);
    expect(read('src', 'renderer', 'js', 'downloads-panel.js')).toMatch(/data-action="extract-here"/);
  });
});
