// Audit (2026-10): up to 20 PDFs of 60 MB each were parsed by pdf-lib on the main event loop. A run is now
// capped at LIMITS.totalBytes together, with a plain error before anything is read.
// pdf-lib is replaced by a stand-in here (the limit is checked before it is used), so this runs without it.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'pdf-lib') return { PDFDocument: { load: async () => ({ getPageCount: () => 1 }), create: async () => { throw new Error('must not be reached'); } } };
  return realLoad.call(this, request, ...rest);
};
const T = require('../../src/main/pdf-toolkit.js');
// pdf-toolkit requires pdf-lib when it runs, not when it loads, so the stand-in stays until the file is done.
afterAll(() => { Module._load = realLoad; });

const MB = 1024 * 1024;
function setup({ sizes, readLength }) {
  const handlers = new Map();
  const readFile = vi.fn(async () => (readLength ? { length: readLength } : Buffer.from('%PDF-1.4\n%%EOF')));
  const pickReads = { n: 0 };
  const fsImpl = {
    existsSync: () => false,
    promises: {
      stat: async (f) => ({ isFile: () => true, size: sizes[f] }),
      readFile: async (f) => { pickReads.n++; return Buffer.from('%PDF-1.4\n%%EOF'); },
      writeFile: async () => { throw new Error('must not write'); },
      rename: async () => { throw new Error('must not write'); },
    },
  };
  const files = Object.keys(sizes);
  T.registerPdfToolkit({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: files }), showSaveDialog: async () => { throw new Error('must not ask to save'); } },
    windowFor: () => null,
    fsImpl,
  });
  return { handlers, fsImpl, pickReads, readFile };
}

describe('a PDF run is capped in total', () => {
  it('the limit is 200 MB', () => {
    expect(T.LIMITS.totalBytes).toBe(200 * MB);
  });

  it('four 55 MB files are refused before any of them is read again', async () => {
    const sizes = { 'C:\\a.pdf': 55 * MB, 'C:\\b.pdf': 55 * MB, 'C:\\c.pdf': 55 * MB, 'C:\\d.pdf': 55 * MB };
    const { handlers, pickReads } = setup({ sizes });
    const picked = await handlers.get('pdftool:pick-files')({});
    expect(picked.files).toHaveLength(4);
    const readsAfterPick = pickReads.n;
    const r = await handlers.get('pdftool:run')({}, { op: 'merge', tokens: picked.files.map(f => f.token) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/add up to more than 200 MB/);
    expect(pickReads.n).toBe(readsAfterPick);
  });

  it('files that fit are not refused by the total (they get as far as pdf-lib)', async () => {
    const sizes = { 'C:\\a.pdf': 50 * MB, 'C:\\b.pdf': 50 * MB };
    const { handlers } = setup({ sizes });
    const picked = await handlers.get('pdftool:pick-files')({});
    const r = await handlers.get('pdftool:run')({}, { op: 'merge', tokens: picked.files.map(f => f.token) });
    expect(r.error || '').not.toMatch(/add up to more than/);
  });

  it('a file that grew after it was chosen is caught when it is read', async () => {
    const sizes = { 'C:\\a.pdf': 10 * MB, 'C:\\b.pdf': 10 * MB };
    const { handlers, fsImpl } = setup({ sizes });
    const picked = await handlers.get('pdftool:pick-files')({});
    fsImpl.promises.readFile = async () => ({ length: 150 * MB });
    const r = await handlers.get('pdftool:run')({}, { op: 'merge', tokens: picked.files.map(f => f.token) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/add up to more than 200 MB/);
  });
});
