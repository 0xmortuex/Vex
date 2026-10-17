// Wave 5: T3-122 the unsigned flag on the startup check, and T3-111 the mark of the web carried onto
// files unpacked from a downloaded archive. Both read-only against the system; nothing here touches
// the registry, Windows, or the owner's profile.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const sc = require('../../src/main/startup-check.js');
const { createMarkOfTheWeb } = require('../../src/main/mark-of-the-web.js');
const { extractTar } = require('../../src/main/archive-security.js');

function fakeFs(files) {
  return {
    statSync(p) {
      if (!files.has(p)) { const e = new Error('no such file ' + p); e.code = 'ENOENT'; throw e; }
      return { isFile: () => true };
    },
  };
}
const env = { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', ProgramFiles: 'C:\\Program Files' };

describe('which program an entry starts', () => {
  const have = fakeFs(new Set(['C:\\Program Files\\X\\x.exe', 'C:\\Users\\a\\AppData\\Roaming\\tool.exe', 'C:\\Users\\a\\Startup\\run.bat']));
  const t = (item) => sc.targetOf(item, { env, fsMod: have });
  it('reads a quoted path with arguments, an unquoted one, and environment variables', () => {
    expect(t({ kind: 'registry', data: '"C:\\Program Files\\X\\x.exe" --background' }).path).toBe('C:\\Program Files\\X\\x.exe');
    expect(t({ kind: 'registry', data: '%ProgramFiles%\\X\\x.exe /s' }).path).toBe('C:\\Program Files\\X\\x.exe');
    expect(t({ kind: 'registry', data: '%APPDATA%\\tool.exe' }).path).toBe('C:\\Users\\a\\AppData\\Roaming\\tool.exe');
  });
  it('says why it cannot know, instead of guessing', () => {
    expect(t({ kind: 'task', name: '\\MyBackup' }).why).toMatch(/not in the list/);
    expect(t({ kind: 'folder', name: 'x.lnk', data: 'C:\\Users\\a\\Startup' }).why).toMatch(/shortcut/);
    expect(t({ kind: 'registry', data: 'notepad' }).why).toMatch(/no program path/);
    expect(t({ kind: 'registry', data: 'tool.exe' }).why).toMatch(/full path/);
    expect(t({ kind: 'registry', data: '"C:\\gone\\y.exe"' }).why).toMatch(/not there any more/);
  });
  it('finds a program in a Startup folder', () => {
    expect(t({ kind: 'folder', name: 'run.bat', data: 'C:\\Users\\a\\Startup' }).path).toBe(path.join('C:\\Users\\a\\Startup', 'run.bat'));
  });
});

describe('checkSignatures', () => {
  const items = [
    { id: 'reg|a', kind: 'registry', name: 'A', data: '"C:\\Program Files\\X\\x.exe"' },
    { id: 'reg|b', kind: 'registry', name: 'B', data: '"C:\\Users\\a\\AppData\\Roaming\\tool.exe"' },
    { id: 'reg|c', kind: 'registry', name: 'C', data: '"C:\\Program Files\\X\\x.exe" --again' },
    { id: 'task|t', kind: 'task', name: '\\MyBackup', data: '' },
  ];
  const files = new Set(['C:\\Program Files\\X\\x.exe', 'C:\\Users\\a\\AppData\\Roaming\\tool.exe']);
  it('flags NotSigned, reports the signer of a valid one, asks once per program, and leaves tasks unchecked', async () => {
    const signatureOf = vi.fn(async (p) => (p.endsWith('tool.exe') ? { status: 'NotSigned', signer: '' } : { status: 'Valid', signer: 'Example Ltd' }));
    const r = await sc.checkSignatures({ scanFn: async () => ({ ok: true, items }), signatureOf, env, fsMod: fakeFs(files) });
    expect(signatureOf).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: true, checked: 3, unsigned: 1 });
    const by = Object.fromEntries(r.results.map(x => [x.id, x]));
    expect(by['reg|b']).toMatchObject({ status: 'NotSigned', unsigned: true });
    expect(by['reg|a']).toMatchObject({ status: 'Valid', signer: 'Example Ltd', unsigned: false });
    expect(by['reg|c'].status).toBe('Valid');
    expect(by['task|t']).toMatchObject({ status: 'unchecked', unsigned: false });
  });
  it('is bounded: past forty programs the rest are reported unchecked', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ id: 'reg|' + i, kind: 'registry', name: 'n' + i, data: '"C:\\p\\f' + i + '.exe"' }));
    const all = new Set(many.map((_, i) => 'C:\\p\\f' + i + '.exe'));
    const signatureOf = vi.fn(async () => ({ status: 'Valid', signer: 'X' }));
    const r = await sc.checkSignatures({ scanFn: async () => ({ ok: true, items: many }), signatureOf, env, fsMod: fakeFs(all) });
    expect(signatureOf).toHaveBeenCalledTimes(40);
    expect(r.results.filter(x => x.status === 'unchecked')).toHaveLength(5);
  });
  it('raises when there is no way to read signatures, and passes a scan failure on', async () => {
    await expect(sc.checkSignatures({ scanFn: async () => ({ ok: true, items: [] }) })).rejects.toThrow(/no way to read signatures/);
    const r = await sc.checkSignatures({ scanFn: async () => ({ ok: false, error: 'only on Windows' }), signatureOf: async () => ({}) });
    expect(r).toMatchObject({ ok: false, error: 'only on Windows' });
  });
  it('registers the channel next to startup:list', async () => {
    const handlers = {};
    sc.registerStartupCheck({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, scanFn: async () => ({ ok: true, items }), signatureOf: async () => ({ status: 'Valid', signer: 'Z' }) });
    expect(Object.keys(handlers).sort()).toEqual(['startup:list', 'startup:signatures']);
  });
});

describe('the window shows it', () => {
  it('turns results into plain lines and marks the unsigned ones', () => {
    const { VexStartupCheck } = require('../../src/renderer/js/startup-check.js');
    const m = VexStartupCheck.signatureNotes([
      { id: 'a', status: 'Valid', signer: 'Example Ltd' }, { id: 'b', status: 'NotSigned' },
      { id: 'c', status: 'unchecked', why: 'a shortcut is not signed itself' }, { id: 'd', status: 'HashMismatch', signer: 'Evil' },
    ]);
    expect(m.get('a')).toEqual({ text: 'Signed by Example Ltd', unsigned: false });
    expect(m.get('b').unsigned).toBe(true);
    expect(m.get('c')).toEqual({ text: 'Not checked: a shortcut is not signed itself', unsigned: false });
    expect(m.get('d').unsigned).toBe(true);
  });
});

describe('mark of the web: propagate', () => {
  function adsFs(initial) {
    const store = new Map(Object.entries(initial));
    return {
      store,
      readFileSync(p) { if (!store.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return store.get(p); },
      writeFileSync(p, t) { if (p.startsWith('D:\\')) { const e = new Error('The filename, directory name, or volume label syntax is incorrect'); e.code = 'EINVAL'; throw e; } store.set(p, t); },
    };
  }
  it('copies the archive mark onto each extracted file and nothing else', () => {
    const fsx = adsFs({ 'C:\\dl\\a.zip:Zone.Identifier': '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://x.example/a.zip\r\n' });
    const m = createMarkOfTheWeb({ fs: fsx, platform: 'win32' });
    const r = m.propagate('C:\\dl\\a.zip', ['C:\\out\\setup.exe', 'C:\\out\\readme.txt']);
    expect(r).toEqual({ carried: true, marked: 2, failed: [] });
    expect(fsx.store.get('C:\\out\\setup.exe:Zone.Identifier')).toContain('HostUrl=https://x.example/a.zip');
  });
  it('writes no mark when the archive has none, and none off Windows', () => {
    const none = adsFs({});
    expect(createMarkOfTheWeb({ fs: none, platform: 'win32' }).propagate('C:\\dl\\a.zip', ['C:\\out\\x.exe'])).toEqual({ carried: false });
    expect(none.store.size).toBe(0);
    const local = adsFs({ 'C:\\dl\\a.zip:Zone.Identifier': 'ZoneId=2' });
    expect(createMarkOfTheWeb({ fs: local, platform: 'win32' }).propagate('C:\\dl\\a.zip', ['C:\\out\\x.exe'])).toEqual({ carried: false });
    expect(createMarkOfTheWeb({ fs: adsFs({}), platform: 'linux' }).propagate('/a.zip', ['/x'])).toEqual({ carried: false });
  });
  it('lists a file that could not take the stream instead of hiding it', () => {
    const fsx = adsFs({ 'C:\\dl\\a.zip:Zone.Identifier': 'ZoneId=3' });
    const log = vi.fn();
    const r = createMarkOfTheWeb({ fs: fsx, platform: 'win32', log }).propagate('C:\\dl\\a.zip', ['C:\\out\\ok.exe', 'D:\\usb\\bad.exe']);
    expect(r.marked).toBe(1);
    expect(r.failed).toEqual([{ file: 'D:\\usb\\bad.exe', error: expect.stringMatching(/syntax is incorrect/) }]);
    expect(log).toHaveBeenCalled();
  });
});

describe('mark of the web: extractTar passes its files through', () => {
  it('hands the extracted file paths (not folders) and the archive to the propagator', async () => {
    const tar = require('tar');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-motw-'));
    try {
      const src = path.join(work, 'src'); fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(src, 'a.txt'), 'a'); fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'b');
      const archive = path.join(work, 'x.tar');
      await tar.c({ file: archive, cwd: src }, ['a.txt', 'sub']);
      const dest = path.join(work, 'out');
      const motw = { propagate: vi.fn(() => ({ carried: true, marked: 2, failed: [] })) };
      const r = await extractTar(archive, dest, undefined, { motw });
      expect(r.files).toBe(2);
      expect(motw.propagate).toHaveBeenCalledTimes(1);
      const [from, files] = motw.propagate.mock.calls[0];
      expect(from).toBe(archive);
      expect(files.map(f => path.relative(dest, f)).sort()).toEqual(['a.txt', path.join('sub', 'b.txt')]);
      expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('a');
      const plain = await extractTar(archive, path.join(work, 'out2'));
      expect(plain.motw).toBe(null);
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  });
});
