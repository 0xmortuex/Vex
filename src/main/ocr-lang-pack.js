// === Copy Text from Image: the English and Turkish recognition data, downloaded on request =================
//
// Nothing here ships in the installer. The text-recognition engine (Tesseract, in vendor/runtime) is bundled, but its
// language data is not: the engine used to fetch eng.traineddata by itself from a CDN the first time any picture was read,
// without asking and without a line in the "what left this computer" ledger. Copy Text from Image needs Turkish too (ç ğ ı İ ö ş ü
// come out wrong with English alone), so both languages are ONE pack that the person agrees to once:
//
//   eng.traineddata.gz   2,952,873 bytes   tessdata_best (integer-quantised), English
//   tur.traineddata.gz   2,141,291 bytes   tessdata_best (integer-quantised), Turkish
//   total 5,094,164 bytes (about 4.9 MB), from cdn.jsdelivr.net, npm packages @tesseract.js-data/eng@1.0.0 and tur@1.0.0
//
// Licence: the data is Tesseract's "tessdata_best" (github.com/tesseract-ocr/tessdata_best), Apache License 2.0; the npm packages
// that carry it (github.com/naptha/tessdata) are MIT. See docs/ocr-languages.md.
//
// Both URLs name an exact package version, so the same bytes are served for ever, and both files are checked against a size and a
// SHA-256 written HERE before they are used. A wrong size or hash is deleted and the download fails out loud; there is no second
// host and no "use it anyway". The request goes through the app's egress-ledger fetch (feature "Text-from-image language pack").
// What this module never touches: the pictures. They are read in the window and never leave it.
//
// Where it lives: <profile>/ocr-lang/. "Remove" deletes the folder's two files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/';
const FILES = Object.freeze([
  Object.freeze({ code: 'eng', file: 'eng.traineddata.gz', url: BASE + 'eng@1.0.0/4.0.0_best_int/eng.traineddata.gz', bytes: 2952873, sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91' }),
  Object.freeze({ code: 'tur', file: 'tur.traineddata.gz', url: BASE + 'tur@1.0.0/4.0.0_best_int/tur.traineddata.gz', bytes: 2141291, sha256: '384ba0dc28040451b7818d7d60e0a88df0d3003fa5a01d713a468779bc3d8c04' }),
]);
const HOSTS = Object.freeze(['cdn.jsdelivr.net']);
const CODES = FILES.map(f => f.code);
const PROGRESS_EVERY_MS = 150;

function hostAllowed(url, hosts) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return hosts.some(h => host === h || host.endsWith('.' + h));
}

function createOcrLangStore({ dir, fetchImpl, catalogue, fsImpl = fs, now = Date.now } = {}) {
  if (!dir || typeof dir !== 'string') throw new Error('The language-data folder is missing');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch function is needed to download the language data');
  const files = (catalogue && catalogue.files) || FILES;
  const hosts = (catalogue && catalogue.hosts) || HOSTS;
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const verified = new Map();            // path -> `${size}:${mtimeMs}` that was hashed OK
  let active = null;                     // { controller }

  const entryOf = (code) => {
    const f = files.find(x => x.code === code);
    if (!f) throw new Error('Unknown language data: ' + String(code).slice(0, 20));
    return f;
  };
  const pathOf = (f) => path.join(dir, f.file);
  const sizeOf = (p) => { try { return fsImpl.statSync(p).size; } catch (err) { if (err && err.code === 'ENOENT') return -1; throw err; } };

  function status() {
    const list = files.map(f => ({ code: f.code, bytes: f.bytes, installed: sizeOf(pathOf(f)) === f.bytes }));
    return { dir, busy: !!active, totalBytes, source: new URL(files[0].url).hostname, installed: list.every(f => f.installed), files: list };
  }

  async function fetchPinned(f, onProgress, doneBefore, signal) {
    fsImpl.mkdirSync(dir, { recursive: true });
    const target = pathOf(f);
    const part = target + '.part';
    fsImpl.rmSync(part, { force: true });
    const res = await fetchImpl(f.url, { signal, redirect: 'follow' });
    if (!res || !res.ok) throw new Error('The download server answered ' + (res ? res.status : 'nothing') + '. Nothing was saved.');
    if (res.url && !hostAllowed(res.url, hosts)) throw new Error('The download was sent to an unexpected host (' + new URL(res.url).hostname + '). Nothing was saved.');
    const announced = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > 0 && announced !== f.bytes) throw new Error('The file on the server is ' + announced + ' bytes, not the ' + f.bytes + ' that were expected. Nothing was saved.');
    if (!res.body || typeof res.body.getReader !== 'function') throw new Error('The download had no body. Nothing was saved.');
    const hash = crypto.createHash('sha256');
    const handle = await fsImpl.promises.open(part, 'w', 0o600);
    let received = 0, lastTick = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > f.bytes) throw new Error('The download is larger than the ' + f.bytes + ' bytes that were expected. It was stopped and deleted.');
        hash.update(value);
        await handle.write(value);
        const t = now();
        if (onProgress && t - lastTick >= PROGRESS_EVERY_MS) { lastTick = t; onProgress({ code: f.code, received: doneBefore + received, total: totalBytes }); }
      }
    } catch (err) {
      await handle.close();
      fsImpl.rmSync(part, { force: true });
      throw err;
    }
    await handle.close();
    if (received !== f.bytes) { fsImpl.rmSync(part, { force: true }); throw new Error('The download ended after ' + received + ' of ' + f.bytes + ' bytes. It was deleted.'); }
    if (hash.digest('hex') !== f.sha256) { fsImpl.rmSync(part, { force: true }); throw new Error('The downloaded file did not match its pinned checksum (SHA-256). It was deleted and not used.'); }
    fsImpl.renameSync(part, target);
    if (onProgress) onProgress({ code: f.code, received: doneBefore + received, total: totalBytes });
  }

  // One download at a time; files already in place are kept. Resolves with the new status.
  async function download(onProgress) {
    if (active) throw new Error('The language data is already being downloaded');
    const controller = new AbortController();
    active = { controller };
    try {
      let done = 0;
      for (const f of files) {
        if (sizeOf(pathOf(f)) !== f.bytes) await fetchPinned(f, onProgress, done, controller.signal);
        done += f.bytes;
      }
    } finally { active = null; }
    return status();
  }
  function cancel() {
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  function remove() {
    if (active) throw new Error('Wait for the download to finish or cancel it first');
    for (const f of files) { fsImpl.rmSync(pathOf(f), { force: true }); fsImpl.rmSync(pathOf(f) + '.part', { force: true }); verified.delete(pathOf(f)); }
    return status();
  }

  // The gzip bytes of one language, re-checked against the pinned hash (once per file version).
  function read(code) {
    const f = entryOf(code);
    const p = pathOf(f);
    let st;
    try { st = fsImpl.statSync(p); } catch (err) { if (err && err.code === 'ENOENT') throw new Error('The language data is not downloaded', { cause: err }); throw err; }
    if (st.size !== f.bytes) throw new Error('The language data on disk is not the expected size; download it again');
    const stamp = st.size + ':' + st.mtimeMs;
    const bytes = fsImpl.readFileSync(p);
    if (verified.get(p) !== stamp) {
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw new Error('The language data on disk does not match its checksum; remove it and download it again');
      verified.set(p, stamp);
    }
    return bytes;
  }

  return { status, download, cancel, remove, read, FILES: files, CODES: files.map(f => f.code) };
}

// The window's side (ipc-policy.js: Vex's own windows only, never a page). Reading what is already downloaded works in any Vex window;
// downloading, cancelling and removing are the main window's, and closed in private windows. The window never names a path or a URL,
// only the ids 'eng' and 'tur'.
function registerOcrLang({ ipcMain, store, mainWindowOf }) {
  const fromMain = (e) => {
    const w = mainWindowOf();
    if (!w || w.isDestroyed() || e.sender !== w.webContents || e.senderFrame !== w.webContents.mainFrame) throw new Error('Only the main Vex window does this');
    return w;
  };
  ipcMain.handle('ocrlang:status', () => store.status());
  ipcMain.handle('ocrlang:download', async (e) => {
    const w = fromMain(e);
    return store.download((p) => { if (!w.isDestroyed()) w.webContents.send('ocrlang:progress', p); });
  });
  ipcMain.handle('ocrlang:cancel', (e) => { fromMain(e); return store.cancel(); });
  ipcMain.handle('ocrlang:remove', (e) => { fromMain(e); return store.remove(); });
  ipcMain.handle('ocrlang:read', (_e, code) => {
    if (!CODES.includes(code)) throw new Error('Unknown language data');
    return new Uint8Array(store.read(code));
  });
}

module.exports = { createOcrLangStore, registerOcrLang, FILES, HOSTS, CODES };
