// === Voice control: the window's side (IPC) ====================================================
//
// Vex's own main window only (ipc-policy.js UI_ONLY, closed in private windows): a web page, a popup or a viewer can neither
// start a download, nor feed the engine, nor read what was said. The window never names a path, a URL or a program: the files
// it may ask for are the ids 'engine', 'base' and 'small', and the URLs are in voice-model.js.
//
// TEST SEAM (voice:test-clip): lets a real-window test hand a pre-recorded WAV to the same pipeline instead of the microphone.
// It exists only when the app is NOT packaged AND VEX_VOICE_TEST_DIR names a folder; registerVoice() decides that from
// `isPackaged`, which main.js takes from app.isPackaged, so no packaged build can register it whatever its environment says.
// The seam reads a WAV by plain file name from that one folder; it can not open the microphone (it is the absence of one).
const fs = require('fs');
const path = require('path');

const IDS = ['engine', 'base', 'small'];

// The samples of a 16 kHz mono 16-bit WAV, as bytes. Throws for anything else.
function wavToPcm(buf) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('That is not a WAV file');
  let at = 12, fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4), size = buf.readUInt32LE(at + 4), body = at + 8;
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(body), ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt || fmt.tag !== 1 || fmt.ch !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) throw new Error('The clip must be 16 kHz, mono, 16-bit');
      return new Uint8Array(buf.subarray(body, Math.min(buf.length, body + size)));
    }
    at = body + size + (size % 2);
  }
  throw new Error('The WAV file has no audio');
}

function registerVoice({ ipcMain, store, engine, mainWindowOf, isPackaged, testDir = '', fsImpl = fs }) {
  const fromMain = (e) => {
    const w = mainWindowOf();
    if (!w || w.isDestroyed() || e.sender !== w.webContents || e.senderFrame !== w.webContents.mainFrame) throw new Error('Only the main Vex window does this');
    return w;
  };
  const seamOn = !isPackaged && !!testDir;

  ipcMain.handle('voice:status', (e) => { fromMain(e); return { ...store.status(), testSeam: seamOn, platformOk: process.platform === 'win32' }; });
  ipcMain.handle('voice:download', async (e, id) => {
    const w = fromMain(e);
    if (!IDS.includes(id)) throw new Error('Unknown voice file');
    return store.download(id, (p) => { if (!w.isDestroyed()) w.webContents.send('voice:progress', p); });
  });
  ipcMain.handle('voice:cancel-download', (e) => { fromMain(e); return store.cancel(); });
  ipcMain.handle('voice:remove', (e, which) => {
    fromMain(e);
    if (which !== 'all' && !IDS.includes(which)) throw new Error('Unknown voice file');
    if (which === 'engine') throw new Error('Delete the engine together with the models (Delete voice model)');
    return store.remove(which);
  });
  ipcMain.handle('voice:transcribe', async (e, pcm, opts) => { fromMain(e); return engine.transcribe(pcm, opts); });
  ipcMain.handle('voice:cancel', (e) => { fromMain(e); return engine.cancel(); });
  if (seamOn) {
    ipcMain.handle('voice:test-clip', (e, name) => {
      fromMain(e);
      if (!/^[A-Za-z0-9._-]{1,80}\.wav$/.test(name)) throw new Error('A clip is a plain file name ending in .wav');
      return wavToPcm(fsImpl.readFileSync(path.join(testDir, name)));
    });
  }
  return { seamOn };
}

module.exports = { registerVoice, wavToPcm, IDS };
