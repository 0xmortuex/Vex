// src/main/page-save.js — a page as a PDF, or as one file that opens offline.
// The page's own webContents does the work, so what is saved is what is on
// screen; nothing is re-fetched.

import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPageSave, safeFileName } = require('../../src/main/page-save.js');

function setup({ url = 'https://example.com/article', title = 'An article', savePath, destroyed = false, folder = null } = {}) {
  const wc = {
    isDestroyed: () => destroyed,
    getURL: () => url,
    getTitle: () => title,
    printToPDF: vi.fn(async () => Buffer.from('%PDF-1.7 fake')),
    savePage: vi.fn(async () => {}),
  };
  const dialog = { showSaveDialog: vi.fn(async (_w, opts) => (savePath === null ? { canceled: true } : { canceled: false, filePath: savePath || path.join(os.tmpdir(), 'vex-ps-' + Date.now() + '-' + opts.filters[0].extensions[0]) })) };
  const ps = createPageSave({
    webContents: { fromId: (id) => (id === 7 ? wc : null) },
    dialog, app: { getPath: () => 'C:/Users/me/Downloads' }, downloadFolder: () => folder,
  });
  return { ps, wc, dialog };
}

describe('file names from page titles', () => {
  it('keeps a readable title', () => {
    expect(safeFileName('How to fix a boiler', 'pdf')).toBe('How to fix a boiler.pdf');
  });
  it('removes what Windows refuses in a file name', () => {
    expect(safeFileName('A/B: "the" <truth>? | yes*', 'pdf')).toBe('A-B- -the- -truth- - yes-.pdf');
    expect(safeFileName('bad\u0000\u001fname', 'mhtml')).toBe('badname.mhtml');
  });
  it('falls back when nothing usable is left, or the name is reserved', () => {
    for (const t of ['', '   ', '...', 'CON', 'nul', 'COM1']) expect(safeFileName(t, 'pdf'), t).toBe('page.pdf');
  });
  it('does not produce an enormous name', () => {
    expect(safeFileName('x'.repeat(500), 'pdf').length).toBeLessThanOrEqual(104);
  });
});

describe('saving', () => {
  // Audit RD9, RD10 (2026-10-10): the dialog opened in Downloads whatever
  // folder was chosen, and over the main window when a private window asked.
  it('opens in the folder chosen in Settings, over the window that asked', async () => {
    const { ps, dialog } = setup({ folder: 'D:/Saved', savePath: null });
    const privateWin = { isDestroyed: () => false };
    await ps.save(7, 'pdf', 'An article', privateWin);
    expect(dialog.showSaveDialog.mock.calls[0][0]).toBe(privateWin);
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe(path.join('D:/Saved', 'An article.pdf'));
    const plain = setup({ savePath: null });
    await plain.ps.save(7, 'pdf', 'An article');
    expect(plain.dialog.showSaveDialog.mock.calls[0][1].defaultPath).toBe(path.join('C:/Users/me/Downloads', 'An article.pdf'));
  });

  it('as a PDF, with backgrounds, to where the user chose', async () => {
    const { ps, wc, dialog } = setup();
    const r = await ps.save(7, 'pdf', 'An article');
    expect(r.ok).toBe(true);
    expect(wc.printToPDF).toHaveBeenCalledWith(expect.objectContaining({ printBackground: true }));
    expect(fs.readFileSync(r.path, 'utf8')).toContain('%PDF');
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toMatch(/An article\.pdf$/);
    fs.unlinkSync(r.path);
  });

  it('as one MHTML file', async () => {
    const { ps, wc } = setup();
    const r = await ps.save(7, 'mhtml');
    expect(r.ok).toBe(true);
    expect(wc.savePage).toHaveBeenCalledWith(r.path, 'MHTML');
    expect(wc.printToPDF).not.toHaveBeenCalled();
  });

  it('uses the page title when none is passed', async () => {
    const { ps, dialog } = setup({ title: 'From the page' });
    await ps.save(7, 'mhtml');
    expect(dialog.showSaveDialog.mock.calls[0][1].defaultPath).toMatch(/From the page\.mhtml$/);
  });

  it('cancelling the dialog is not an error and writes nothing', async () => {
    const { ps, wc } = setup({ savePath: null });
    expect(await ps.save(7, 'pdf')).toEqual({ ok: false, cancelled: true });
    expect(wc.printToPDF).not.toHaveBeenCalled();
  });

  it('refuses what it cannot do, in words', async () => {
    const { ps } = setup();
    await expect(ps.save(7, 'docx')).rejects.toThrow(/PDF or as a single file/);
    await expect(ps.save(99, 'pdf')).rejects.toThrow(/tab has closed/);
    await expect(ps.save('7', 'pdf')).rejects.toThrow(/tab has closed/);
  });

  it('a closed tab, or Vex\'s own pages, are not saved', async () => {
    await expect(setup({ destroyed: true }).ps.save(7, 'pdf')).rejects.toThrow(/tab has closed/);
    await expect(setup({ url: 'file:///C:/app/start.html' }).ps.save(7, 'pdf')).rejects.toThrow(/Only a web page/);
  });
});

// Audit RD9, RD10: the e-book, the calendar/text file, the page and the
// recording are all saved through main.js the same way.
describe('main.js', () => {
  const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const block = (start, len = 900) => MAIN.slice(MAIN.indexOf(start), MAIN.indexOf(start) + len);
  it('every save dialog opens over the asking window, in the chosen folder', () => {
    expect(MAIN).not.toMatch(/showSaveDialog\(mainWindow/);
    for (const ch of ['page:save-epub', 'file:save-text']) {
      const b = block("ipcMain.handle('" + ch + "'");
      expect(b, ch).toContain('dialog.showSaveDialog(_askingWindow(_e),');
      expect(b, ch).toContain("_chosenDownloadFolder() || app.getPath('downloads')");
    }
    expect(block("ipcMain.handle('page:save'", 200)).toContain('_askingWindow(_e)');
    expect(block("ipcMain.handle('rec:finish'", 200)).toContain('_askingWindow(_e)');
    expect(MAIN).toContain('const _askingWindow = (e) => BrowserWindow.fromWebContents(e.sender) || undefined;');
  });
});
