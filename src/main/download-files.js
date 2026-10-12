// === A finished download's file, from the Downloads panel ===================
//
// Delete it (to the Recycle Bin, so it can still be got back) and drag it out
// of the panel into a folder, a mail or a chat. Both take a path from the
// interface, so both act only on a file Vex itself downloaded
// (downloads.js isDownloadedFile), as Open does.
//
// shell: Electron's (trashItem). getFileIcon: app.getFileIcon, the picture
// shown under the pointer while dragging.
function createDownloadFiles({ fs, shell, getFileIcon, isDownloadedFile }) {
  const NOT_OURS = 'Vex only does this to files it downloaded itself.';

  async function deleteFile(filePath) {
    if (!isDownloadedFile(filePath)) return { ok: false, error: NOT_OURS };
    if (!fs.existsSync(filePath)) return { ok: false, error: 'That file is not there any more' };
    await shell.trashItem(filePath);
    return { ok: true };
  }

  // Must run while the mouse button that started the drag is still down: the
  // panel asks for it from its dragstart.
  async function startDrag(sender, filePath) {
    if (!sender || sender.isDestroyed()) return { ok: false, error: 'The window is gone' };
    if (!isDownloadedFile(filePath)) return { ok: false, error: NOT_OURS };
    if (!fs.existsSync(filePath)) return { ok: false, error: 'That file is not there any more' };
    const icon = await getFileIcon(filePath, { size: 'normal' });
    sender.startDrag({ file: filePath, icon });
    return { ok: true };
  }

  return { deleteFile, startDrag };
}

module.exports = { createDownloadFiles };
