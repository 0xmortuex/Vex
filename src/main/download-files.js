// === A finished download's file, from the Downloads panel ===================
//
// Delete it (to the Recycle Bin, so it can still be got back) and drag it out
// of the panel into a folder, a mail or a chat. Both take a path from the
// interface, so both act only on a file Vex itself downloaded
// (downloads.js isDownloadedFile), as Open does.
//
// Extract here (T3-111): a downloaded .zip, .tar, .tgz or .tar.gz is unpacked into a NEW folder next to it, after a
// confirmation made by the main process (the exact folder is named), through main/archive-security.js (unsafe paths,
// links, size and expansion limits; nothing is overwritten) and with the archive's "downloaded from the internet"
// mark copied onto every file written. A failure removes the folder it created and nothing else.
//
// shell: Electron's (trashItem). getFileIcon: app.getFileIcon, the picture
// shown under the pointer while dragging. archive: main/archive-security.js. confirm({ title, detail, ok, cancel })
// -> Promise<boolean>, a dialog the main process shows. motw: main/mark-of-the-web.js.
function createDownloadFiles({ fs, shell, getFileIcon, isDownloadedFile, path = require('path'), archive = null, confirm = null, motw = null }) {
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

  const KINDS = [[/\.tar\.gz$/i, 'tar', 7], [/\.tgz$/i, 'tar', 4], [/\.tar$/i, 'tar', 4], [/\.zip$/i, 'zip', 4]];
  const kindOf = (name) => { for (const [re, kind, cut] of KINDS) if (re.test(name)) return { kind, base: name.slice(0, name.length - cut) }; return null; };

  // A folder name that does not exist yet next to the archive: "name", "name (2)", ...
  function freshFolder(dir, base) {
    const clean = (base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'archive').slice(0, 80);
    for (let n = 1; n < 100; n++) {
      const candidate = path.join(dir, n === 1 ? clean : clean + ' (' + n + ')');
      if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error('There are too many folders called ' + clean + ' next to the archive');
  }

  // -> { ok, folder, files, motw } | { ok: false, cancelled: true } | { ok: false, error }
  async function extractHere(filePath) {
    if (!archive || typeof confirm !== 'function') return { ok: false, error: 'Unpacking is not set up' };
    if (typeof filePath !== 'string' || !isDownloadedFile(filePath)) return { ok: false, error: NOT_OURS };
    if (!fs.existsSync(filePath)) return { ok: false, error: 'That file is not there any more' };
    const k = kindOf(path.basename(filePath));
    if (!k) return { ok: false, error: 'Vex unpacks .zip, .tar, .tgz and .tar.gz files here' };
    let inside = '';
    if (k.kind === 'zip') {
      let info;
      try { info = archive.inspectZip(filePath); }
      catch (err) { return { ok: false, error: 'Vex will not unpack this archive: ' + err.message }; }
      const size = info.bytes >= 1048576 ? (info.bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(info.bytes / 1024)) + ' KB';
      inside = info.count + ' file' + (info.count === 1 ? '' : 's') + ', ' + size + ' when unpacked.\n\n';
    }
    const folder = freshFolder(path.dirname(filePath), k.base);
    const yes = await confirm({
      title: 'Extract ' + path.basename(filePath) + ' here?',
      detail: inside + 'It will be unpacked into a new folder:\n' + folder + '\n\nVex refuses unsafe paths and links, never overwrites a file, and keeps the "downloaded from the internet" mark on what it writes, so Windows still checks a program that comes out of it.',
      ok: 'Extract', cancel: 'Cancel',
    });
    if (!yes) return { ok: false, cancelled: true };
    try {
      const r = k.kind === 'zip' ? await archive.extractZip(filePath, folder, undefined, { motw }) : await archive.extractTar(filePath, folder, undefined, { motw });
      return { ok: true, folder, files: r.files, motw: r.motw };
    } catch (err) {
      // Only the folder this call created is removed.
      try { fs.rmSync(folder, { recursive: true, force: true }); }
      catch (cleanup) { return { ok: false, error: err.message + ' (and the half-made folder could not be removed: ' + cleanup.message + ')' }; }
      return { ok: false, error: err.message };
    }
  }

  return { deleteFile, startDrag, extractHere, kindOf };
}

module.exports = { createDownloadFiles };
