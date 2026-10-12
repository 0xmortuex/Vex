// Item #3: "Use my Windows wallpaper" (src/main/wallpaper.js). It reads two
// registry values with `reg query` and one file, and changes nothing; only
// Vex's own window may ask (ipc-policy UI_ONLY_CHANNELS).
import { describe, it, expect } from 'vitest';
const path = require('path');
const { createWallpaperReader, registerWallpaper, regValue, sniff, expandEnv } = require('../../src/main/wallpaper.js');
const { installIpcPolicy, UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
const { validate } = require('../../src/main/ipc-schemas.js');

const APPDATA = 'C:\\Users\\Someone\\AppData\\Roaming';
const TRANSCODED = path.join(APPDATA, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40)]);
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(40)]);

const regOut = (key, name, type, data) => `\r\n${key}\r\n    ${name}    ${type}    ${data}\r\n\r\n`;

// reg: { BackgroundType: number|undefined, WallPaper: string|undefined }
function setup({ platform = 'win32', reg = {}, files = {}, regFails = false, image = { w: 3840, h: 2160 } } = {}) {
  const calls = [];
  const execFile = (cmd, args, opts, cb) => {
    calls.push([cmd, ...args]);
    if (regFails) { const e = new Error('spawn reg.exe ENOENT'); e.code = 'ENOENT'; cb(e, '', ''); return; }
    const name = args[3];
    const v = reg[name];
    if (v === undefined) { const e = new Error('exit 1'); e.code = 1; cb(e, '', 'ERROR: The system was unable to find the specified registry key or value.'); return; }
    cb(null, typeof v === 'number' ? regOut(args[1], name, 'REG_DWORD', '0x' + v.toString(16)) : regOut(args[1], name, 'REG_SZ', v), '');
  };
  const reads = [];
  const fs = {
    promises: {
      stat: async (p) => {
        if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
        return { isFile: () => true, size: files[p].size ?? files[p].length };
      },
      readFile: async (p) => { reads.push(p); return files[p]; },
    },
  };
  const resized = [];
  const nativeImage = {
    createFromBuffer: (buf) => {
      let size = { width: image.w, height: image.h };
      const im = {
        isEmpty: () => image.empty === true,
        getSize: () => size,
        resize: (o) => { resized.push(o); size = o.width ? { width: o.width, height: Math.round(size.height * o.width / size.width) } : { width: Math.round(size.width * o.height / size.height), height: o.height }; return im; },
        toJPEG: (q) => Buffer.from('jpeg-' + q + '-' + size.width + 'x' + size.height),
      };
      return im;
    },
  };
  const reader = createWallpaperReader({ platform, env: { APPDATA }, execFile, fs, nativeImage });
  return { reader, calls, reads, resized };
}

describe('reading the registry', () => {
  it('finds a value in reg query output', () => {
    expect(regValue(regOut('HKCU\\Control Panel\\Desktop', 'WallPaper', 'REG_SZ', 'C:\\Pics\\a b.jpg'), 'WallPaper')).toBe('C:\\Pics\\a b.jpg');
    expect(regValue(regOut('HKCU\\x', 'WallPaper', 'REG_SZ', ''), 'WallPaper')).toBe('');
    expect(regValue(regOut('HKCU\\x', 'BackgroundType', 'REG_DWORD', '0x2'), 'BackgroundType')).toBe(2);
    expect(regValue('nothing here', 'WallPaper')).toBe(null);
    expect(expandEnv('%AppData%\\x.png', { APPDATA: 'C:\\R' })).toBe('C:\\R\\x.png');
    expect(expandEnv('%NOPE%\\x.png', {})).toBe('%NOPE%\\x.png');
  });
  it('knows a picture by its bytes', () => {
    expect([PNG, JPEG, WEBP, BMP, Buffer.from('GIF89a......')].map(sniff)).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/bmp', null]);
  });
});

describe('the wallpaper', () => {
  it('a picture: read, shrunk to 1600 pixels and handed back as a JPEG — only queries, only reads', async () => {
    const { reader, calls, reads, resized } = setup({ reg: { BackgroundType: 0, WallPaper: 'C:\\Pics\\lake.png' }, files: { 'C:\\Pics\\lake.png': PNG } });
    const r = await reader.read();
    expect(r).toEqual({ ok: true, dataUrl: 'data:image/jpeg;base64,' + Buffer.from('jpeg-90-1600x900').toString('base64'), note: '' });
    expect(resized).toEqual([{ width: 1600, quality: 'good' }]);
    expect(reads).toEqual(['C:\\Pics\\lake.png']);
    for (const c of calls) expect(c.slice(0, 2)).toEqual(['reg.exe', 'query']);
  });

  it('a tall picture is shrunk by its height; a small one is not shrunk', async () => {
    let s = setup({ reg: { WallPaper: 'C:\\p.jpg' }, files: { 'C:\\p.jpg': JPEG }, image: { w: 1080, h: 2400 } });
    await s.reader.read();
    expect(s.resized).toEqual([{ height: 1600, quality: 'good' }]);
    s = setup({ reg: { WallPaper: 'C:\\p.jpg' }, files: { 'C:\\p.jpg': JPEG }, image: { w: 800, h: 600 } });
    await s.reader.read();
    expect(s.resized).toEqual([]);
  });

  it('a slideshow or Spotlight: the picture showing now, and it says so', async () => {
    const slide = setup({ reg: { BackgroundType: 2, WallPaper: TRANSCODED }, files: { [TRANSCODED]: JPEG } });
    expect(await slide.reader.read()).toMatchObject({ ok: true, note: 'Your wallpaper is a slideshow, so Vex used the picture showing now.' });
    const spot = setup({ reg: { BackgroundType: 3, WallPaper: TRANSCODED }, files: { [TRANSCODED]: JPEG } });
    expect((await spot.reader.read()).note).toMatch(/Windows Spotlight/);
  });

  it('the file Windows names has gone: Windows’ own copy of what it shows', async () => {
    const { reader, reads } = setup({ reg: { WallPaper: 'D:\\Gone\\old.jpg' }, files: { [TRANSCODED]: JPEG } });
    expect((await reader.read()).ok).toBe(true);
    expect(reads).toEqual([TRANSCODED]);
  });

  it('WebP and BMP come back as they are, for Chromium to read', async () => {
    const w = setup({ reg: { WallPaper: 'C:\\a.webp' }, files: { 'C:\\a.webp': WEBP } });
    expect((await w.reader.read()).dataUrl).toBe('data:image/webp;base64,' + WEBP.toString('base64'));
    const b = setup({ reg: { WallPaper: 'C:\\a.bmp' }, files: { 'C:\\a.bmp': BMP } });
    expect((await b.reader.read()).dataUrl).toBe('data:image/bmp;base64,' + BMP.toString('base64'));
  });

  it('says plainly when there is no picture to use', async () => {
    const cases = [
      [{ platform: 'linux' }, 'not-windows', /Only Windows/],
      [{ reg: { BackgroundType: 1, WallPaper: 'C:\\x.jpg' }, files: { 'C:\\x.jpg': JPEG } }, 'solid', /solid colour/],
      [{ reg: { BackgroundType: 0, WallPaper: '' } }, 'none', /no desktop picture/],
      [{ reg: {} }, 'none', /no desktop picture/],
      [{ reg: { WallPaper: 'D:\\Gone\\old.jpg' } }, 'missing', /no longer there \(old\.jpg\)/],
      [{ reg: { WallPaper: 'C:\\a.gif' }, files: { 'C:\\a.gif': Buffer.from('GIF89a' + 'x'.repeat(20)) } }, 'unsupported', /not a PNG, JPEG, WebP or BMP/],
      [{ reg: { WallPaper: 'C:\\big.png' }, files: { 'C:\\big.png': Object.assign(Buffer.from(PNG), { size: 33 * 1024 * 1024 }) } }, 'too-big', /too big to read \(33 MB; 32 MB at most\)/],
      [{ reg: { WallPaper: 'C:\\bad.png' }, files: { 'C:\\bad.png': PNG }, image: { empty: true } }, 'unreadable', /damaged/],
    ];
    for (const [opts, reason, message] of cases) {
      const r = await setup(opts).reader.read();
      expect(r).toMatchObject({ ok: false, reason });
      expect(r.message).toMatch(message);
    }
  });

  it('a big file is refused before it is read', async () => {
    const s = setup({ reg: { WallPaper: 'C:\\big.png' }, files: { 'C:\\big.png': Object.assign(Buffer.from(PNG), { size: 33 * 1024 * 1024 }) } });
    await s.reader.read();
    expect(s.reads).toEqual([]);
  });

  it('a registry read that really fails is raised, not taken as "no wallpaper"', async () => {
    await expect(setup({ regFails: true }).reader.read()).rejects.toThrow(/Could not read the Windows setting BackgroundType/);
  });
});

describe('theme:read-wallpaper over IPC', () => {
  function wire({ ui = false, owner = null, auxiliary = false } = {}) {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
    installIpcPolicy(ipcMain, { isUiFrame: () => ui, owner: () => owner, isAuxiliary: () => auxiliary, ownsTarget: () => true });
    registerWallpaper({ ipcMain, platform: 'linux', env: {}, execFile: () => {}, fs: { promises: {} }, nativeImage: {} });
    return (...args) => handlers.get('theme:read-wallpaper')({ sender: {}, senderFrame: { url: 'https://page.example/' } }, ...args);
  }
  it('answers Vex’s own window', async () => {
    expect(await wire({ ui: true, owner: { id: 1 } })()).toMatchObject({ ok: false, reason: 'not-windows' });
  });
  it('is refused to a page and to an auxiliary window', async () => {
    await expect(wire({ owner: { id: 1 } })()).rejects.toThrow('Untrusted IPC sender');
    await expect(wire({ auxiliary: true })()).rejects.toThrow(/outside Vex’s own window/);
    expect(UI_ONLY_CHANNELS.has('theme:read-wallpaper')).toBe(true);
  });
  it('takes no arguments', () => {
    expect(() => validate('theme:read-wallpaper', [])).not.toThrow();
    expect(() => validate('theme:read-wallpaper', ['C:\\Windows\\x.jpg'])).toThrow(/Invalid payload/);
  });
});
