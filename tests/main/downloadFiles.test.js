// Deleting and dragging out a finished download (src/main/download-files.js):
// both take a path from the interface, so both touch only files Vex downloaded.
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const { createDownloadFiles } = createRequire(import.meta.url)('../../src/main/download-files.js');

const OURS = 'C:/dl/report.pdf';
function make(exists = true) {
  const shell = { trashItem: vi.fn(async () => {}) };
  const getFileIcon = vi.fn(async () => ({ icon: true }));
  const files = createDownloadFiles({
    fs: { existsSync: () => exists }, shell, getFileIcon,
    isDownloadedFile: (p) => p === OURS,
  });
  return { files, shell, getFileIcon };
}

describe('Delete file', () => {
  it('sends a file Vex downloaded to the Recycle Bin', async () => {
    const { files, shell } = make();
    expect(await files.deleteFile(OURS)).toEqual({ ok: true });
    expect(shell.trashItem).toHaveBeenCalledWith(OURS);
  });
  it('refuses any other path', async () => {
    const { files, shell } = make();
    expect((await files.deleteFile('C:/Windows/system32/kernel32.dll')).ok).toBe(false);
    expect(shell.trashItem).not.toHaveBeenCalled();
  });
  it('says so when the file is already gone', async () => {
    const { files } = make(false);
    expect(await files.deleteFile(OURS)).toEqual({ ok: false, error: 'That file is not there any more' });
  });
});

describe('Drag out of the panel', () => {
  it('starts the system drag of the file, with its icon', async () => {
    const { files, getFileIcon } = make();
    const sender = { isDestroyed: () => false, startDrag: vi.fn() };
    expect(await files.startDrag(sender, OURS)).toEqual({ ok: true });
    expect(getFileIcon).toHaveBeenCalledWith(OURS, { size: 'normal' });
    expect(sender.startDrag).toHaveBeenCalledWith({ file: OURS, icon: { icon: true } });
  });
  it('drags nothing Vex did not download', async () => {
    const { files } = make();
    const sender = { isDestroyed: () => false, startDrag: vi.fn() };
    expect((await files.startDrag(sender, 'C:/secret.txt')).ok).toBe(false);
    expect(sender.startDrag).not.toHaveBeenCalled();
  });
});
