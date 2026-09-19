// src/main/page-save.js — a page as a PDF, or as one file that opens offline.
// The page's own webContents does the work, so what is saved is what is on
// screen; nothing is re-fetched.

import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPageSave, safeFileName } = require('../../src/main/page-save.js');

function setup({ url = 'https://example.com/article', title = 'An article', savePath, destroyed = false } = {}) {
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
    dialog, app: { getPath: () => 'C:/Users/me/Downloads' }, getWindow: () => null,
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
