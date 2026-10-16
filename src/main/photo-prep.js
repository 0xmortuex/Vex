// === Photo preparer (T3-105): the file dialogs, and nothing else ===============
//
// The picture work (resize, crop, convert, strip location and camera details)
// is done in the window with a canvas (js/photo-prep.js): re-drawing a picture
// drops everything the file carried besides the pixels, and the browser applies
// the camera's rotation first. Main's part is the two dialogs:
//   photoprep:open   the person picks ONE picture; main reads that one file and
//                    hands its bytes to the window. No folder is browsed.
//   photoprep:save   the finished bytes are written to a NEW file chosen in a
//                    save dialog. The original is never touched, and an
//                    existing file is replaced only if the person confirms it
//                    in the dialog itself.
// Nothing is uploaded; there is no network code in this file.
const fs = require('fs');
const path = require('path');

const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 40 * 1024 * 1024;
const IMAGE_EXT = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']);

function mimeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' }[ext] || '';
}

async function openPicture({ dialog, win, fsMod = fs }) {
  const pick = await dialog.showOpenDialog(win, {
    title: 'Choose a picture to prepare',
    properties: ['openFile'],
    filters: [{ name: 'Pictures', extensions: IMAGE_EXT.slice() }],
  });
  if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: true, canceled: true };
  const file = pick.filePaths[0];
  const mime = mimeOf(file);
  if (!mime) throw new Error('That is not a picture Vex can read (use JPG, PNG, WebP, BMP or GIF)');
  const st = await fsMod.promises.stat(file);
  if (!st.isFile()) throw new Error('That is not a file');
  if (st.size > MAX_INPUT_BYTES) throw new Error('That picture is larger than ' + Math.round(MAX_INPUT_BYTES / 1048576) + ' MB');
  const bytes = await fsMod.promises.readFile(file);
  return { ok: true, name: path.basename(file), mime, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

async function savePicture({ dialog, win, bytes, suggestedName, fsMod = fs }) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('There is no picture to save');
  if (bytes.length > MAX_OUTPUT_BYTES) throw new Error('The picture is larger than ' + Math.round(MAX_OUTPUT_BYTES / 1048576) + ' MB');
  const name = String(suggestedName || 'photo.jpg').replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120) || 'photo.jpg';
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!IMAGE_EXT.includes(ext)) throw new Error('The saved file has to end in .jpg or .png');
  const out = await dialog.showSaveDialog(win, { title: 'Save the prepared picture as a new file', defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (out.canceled || !out.filePath) return { ok: true, canceled: true };
  // The dialog may only ever write a picture file, never overwrite a program
  // or a script because the person typed another extension.
  if (!IMAGE_EXT.includes(path.extname(out.filePath).slice(1).toLowerCase())) throw new Error('The saved file has to end in .jpg or .png');
  await fsMod.promises.writeFile(out.filePath, bytes);
  return { ok: true, path: out.filePath, bytes: bytes.length };
}

// Policy: ipc-policy.js (UI_ONLY, closed in a private window).
function registerPhotoPrep({ ipcMain, dialog, windowFor }) {
  ipcMain.handle('photoprep:open', (e) => openPicture({ dialog, win: windowFor(e) }));
  ipcMain.handle('photoprep:save', (e, bytes, suggestedName) => savePicture({ dialog, win: windowFor(e), bytes, suggestedName }));
}

module.exports = { openPicture, savePicture, registerPhotoPrep, mimeOf, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, IMAGE_EXT };
