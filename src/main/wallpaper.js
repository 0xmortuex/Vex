// "Use my Windows wallpaper" in the theme editor (js/theme-studio.js,
// js/theme-from-image.js): the picture Windows shows on the desktop now.
//
// READ ONLY. Two registry values are queried with reg.exe and one file is
// read; nothing in Windows is ever changed, and the picture goes nowhere but
// back to the window that asked:
//   HKCU\Control Panel\Desktop  WallPaper          the picture's file ('' = none)
//   HKCU\...\Explorer\Wallpapers BackgroundType    0 picture, 1 solid colour,
//                                                  2 slideshow, 3 Windows Spotlight
// When the file WallPaper names has gone, Windows' own copy of what it shows
// (%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper) is read instead.
// PNG and JPEG come back shrunk to FIT pixels as a JPEG; WebP and BMP, which
// nativeImage cannot read, come back as they are for Chromium to read.

const path = require('path');

const DESKTOP_KEY = 'HKCU\\Control Panel\\Desktop';
const WALLPAPERS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpapers';
const MAX_BYTES = 32 * 1024 * 1024;
const FIT = 1600;

function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}

// One value out of `reg query` output, or null when it is not there.
function regValue(stdout, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('^\\s*' + esc + '\\s+(REG_SZ|REG_EXPAND_SZ|REG_DWORD)[ \\t]*(.*)$', 'im').exec(String(stdout || ''));
  if (!m) return null;
  const v = m[2].trim();
  return m[1] === 'REG_DWORD' ? parseInt(v, 16) : v;
}

function expandEnv(s, env) {
  return s.replace(/%([^%]+)%/g, (all, k) => {
    const key = Object.keys(env).find(x => x.toLowerCase() === k.toLowerCase());
    return key ? env[key] : all;
  });
}

const fail = (reason, message) => ({ ok: false, reason, message });

function createWallpaperReader({ platform, env, execFile, fs, nativeImage }) {
  if (!execFile || !fs || !nativeImage || !env) throw new Error('createWallpaperReader needs execFile, fs, nativeImage and env');

  // reg.exe says "unable to find" with exit code 1 when a value is absent;
  // anything else is a real failure and is raised.
  const query = (key, name) => new Promise((resolve, reject) => {
    execFile('reg.exe', ['query', key, '/v', name], { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (!err) { resolve(regValue(stdout, name)); return; }
      if (err.code === 1) { resolve(null); return; }
      reject(new Error('Could not read the Windows setting ' + name + ': ' + String(stderr || err.message).trim()));
    });
  });

  const isFile = async (p) => {
    try { return (await fs.promises.stat(p)).isFile(); }
    catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; }
  };

  async function read() {
    if (platform !== 'win32') return fail('not-windows', 'Only Windows has a desktop wallpaper Vex can read.');
    const type = await query(WALLPAPERS_KEY, 'BackgroundType');
    if (type === 1) return fail('solid', 'Your desktop background is a solid colour, not a picture. Choose a picture instead.');
    const named = await query(DESKTOP_KEY, 'WallPaper');
    if (!named) return fail('none', 'Windows has no desktop picture set. Choose a picture instead.');
    const file = expandEnv(named, env);
    const transcoded = env.APPDATA ? path.join(env.APPDATA, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper') : null;
    let use = null;
    if (await isFile(file)) use = file;
    else if (transcoded && await isFile(transcoded)) use = transcoded;
    if (!use) return fail('missing', `Windows names a wallpaper file that is no longer there (${path.basename(file)}). Choose a picture instead.`);
    const size = (await fs.promises.stat(use)).size;
    if (size > MAX_BYTES) return fail('too-big', `Your wallpaper is too big to read (${Math.round(size / 1048576)} MB; ${MAX_BYTES / 1048576} MB at most).`);
    const buf = await fs.promises.readFile(use);
    const mime = sniff(buf);
    if (!mime) return fail('unsupported', 'Your wallpaper is not a PNG, JPEG, WebP or BMP picture, so Vex cannot read it.');
    let dataUrl;
    if (mime === 'image/png' || mime === 'image/jpeg') {
      let im = nativeImage.createFromBuffer(buf);
      if (im.isEmpty()) return fail('unreadable', 'Your wallpaper file could not be read as a picture — it may be damaged.');
      const { width, height } = im.getSize();
      if (Math.max(width, height) > FIT) im = width >= height ? im.resize({ width: FIT, quality: 'good' }) : im.resize({ height: FIT, quality: 'good' });
      dataUrl = 'data:image/jpeg;base64,' + im.toJPEG(90).toString('base64');
    } else {
      dataUrl = `data:${mime};base64,` + buf.toString('base64');
    }
    const note = type === 2 ? 'Your wallpaper is a slideshow, so Vex used the picture showing now.'
      : type === 3 ? 'Your desktop uses Windows Spotlight, so Vex used the picture showing now.'
        : '';
    return { ok: true, dataUrl, note };
  }

  return { read };
}

function registerWallpaper({ ipcMain, ...deps }) {
  if (!ipcMain) throw new Error('registerWallpaper needs ipcMain');
  const reader = createWallpaperReader(deps);
  ipcMain.handle('theme:read-wallpaper', () => reader.read());
  return reader;
}

module.exports = { registerWallpaper, createWallpaperReader, regValue, sniff, expandEnv };
